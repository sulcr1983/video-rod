/* ==========================================================
 * VRSiteNameStore —— 站点名缓存（chrome.storage.local.vrSiteNames）
 *
 * 为什么要有这一层：
 *   站名只能在「有网页 DOM 的时候」抓到（下载那一刻），但资源库的重扫、
 *   迁移、重建索引都没有 DOM。抓到的站名必须落盘，否则下次扫描就退回域名。
 *
 * 存储形态：
 *   vrSiteNames = {
 *     "huaban.com": { name: "花瓣网", src: "og", at: 1762..., manual: 0 },
 *     "my-blog.xyz": { name: "我的小站", src: "title", at: 1762... }
 *   }
 *   键 = 可注册域名（v.qq.com / example.com.cn 这类边界由 VRSiteName 处理）
 *   只存「学到的」和「手改的」；预置表不进 storage，避免版本更新后被旧值盖住。
 *
 * 两个关键约束：
 *   1. buildRelDir() 是同步的，storage 是异步的 —— 所以维护一份内存镜像，
 *      同步读用 peek()，异步准备用 ready()。
 *   2. 同一 host 已有记录就跳过（用户手改的 manual:1 永不自动覆盖）。
 *      多个上下文同时写有极小概率丢一条 learned，下次下载会补回来，
 *      不为此引入锁服务。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRSiteNameStore = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    var KEY = 'vrSiteNames';
    /* 防御性上限：正常使用几百条，长期累积到几万条说明学进了垃圾域名。
     * 超限时优先淘汰最旧的 learned，manual 永不淘汰。 */
    var MAX_ENTRIES = 20000;
    var TRIM_TO = 18000;

    var cache = null;          // host -> {name, src, at, manual}
    var loading = null;        // Promise，避免并发反复读
    var chain = Promise.resolve();   // 写串行化，防止同上下文并发读改写丢更新

    function hasStorage() {
        try {
            return !!(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local);
        } catch (e) { return false; }
    }

    /** 复用 VRSiteName 的域名归一；缺失时退化为去 www 的小写 */
    function normHost(host) {
        var h = String(host || '').trim().toLowerCase();
        if (!h) { return ''; }
        var SN = root && root.VRSiteName;
        if (SN && typeof SN.registrableDomain === 'function') {
            try { return SN.registrableDomain(SN.hostOf(h) || h); } catch (e) { /* 落回下面的简化 */ }
        }
        return h.replace(/^www\./, '').replace(/\.$/, '');
    }

    /** 站名清洗：优先用 VRSiteName.cleanName，保证与路径层口径一致 */
    function clean(name) {
        var s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
        if (!s) { return ''; }
        var SN = root && root.VRSiteName;
        if (SN && typeof SN.cleanName === 'function') {
            try {
                var c = SN.cleanName(s);
                return c || '';
            } catch (e) { /* 落回原值 */ }
        }
        return s;
    }

    function readRaw() {
        return new Promise(function (resolve) {
            if (!hasStorage()) { resolve({}); return; }
            try {
                chrome.storage.local.get(KEY, function (obj) {
                    void (chrome.runtime && chrome.runtime.lastError);
                    var v = obj && obj[KEY];
                    resolve(v && typeof v === 'object' ? v : {});
                });
            } catch (e) { resolve({}); }
        });
    }

    function writeRaw(map) {
        return new Promise(function (resolve) {
            if (!hasStorage()) { resolve(false); return; }
            try {
                var o = {};
                o[KEY] = map;
                chrome.storage.local.set(o, function () {
                    void (chrome.runtime && chrome.runtime.lastError);
                    resolve(true);
                });
            } catch (e) { resolve(false); }
        });
    }

    /** 把 storage 读进内存镜像；重复调用复用同一个 Promise */
    function ready() {
        if (cache) { return Promise.resolve(cache); }
        if (loading) { return loading; }
        loading = readRaw().then(function (raw) {
            cache = raw;
            loading = null;
            return cache;
        }, function () {
            cache = {};
            loading = null;
            return cache;
        });
        return loading;
    }

    /** 同步读：未 ready 时返回 null（调用方回退域名即可） */
    function peek(host) {
        if (!cache) { return null; }
        var k = normHost(host);
        if (!k) { return null; }
        return cache[k] || null;
    }

    /** 同步读站名，拿不到返回空串 */
    function nameOf(host) {
        var rec = peek(host);
        return rec && rec.name ? rec.name : '';
    }

    function trim(map) {
        var keys = Object.keys(map);
        if (keys.length <= MAX_ENTRIES) { return map; }
        var learned = keys.filter(function (k) { return !map[k].manual; })
            .sort(function (a, b) { return (map[a].at || 0) - (map[b].at || 0); });
        var need = keys.length - TRIM_TO;
        for (var i = 0; i < learned.length && need > 0; i++, need--) {
            delete map[learned[i]];
        }
        return map;
    }

    /**
     * 写入一条站名（读-合并-写，串行执行）。
     * @param {string} host
     * @param {string} name
     * @param {string} src   og | meta | manifest | jsonld | title | manual
     * @param {object} opt   { override:true } 时覆盖已有非 manual 记录
     */
    function put(host, name, src, opt) {
        var o = opt || {};
        var k = normHost(host);
        var n = clean(name);
        /* allowEmpty：允许登记「已知域名但还没拿到站名」的条目。
         * 面板里显示为空输入框，方便用户手填；探测到名字后会被自动补上。 */
        if (!k) { return Promise.resolve(null); }
        if (!n && !o.allowEmpty) { return Promise.resolve(null); }
        chain = chain.then(function () {
            return readRaw().then(function (map) {
                var cur = map[k];
                /* 已有记录：manual 永不覆盖；非 manual 默认跳过（用户要的「同一站点只抓一次」） */
                if (cur && cur.name) {
                    if (cur.manual) { return cur; }
                    if (!o.override) { return cur; }
                }
                map[k] = {
                    name: n || '',
                    src: src || 'learned',
                    at: Date.now(),
                    manual: o.manual ? 1 : 0
                };
                trim(map);
                cache = map;
                return writeRaw(map).then(function () { return map[k]; });
            });
        });
        return chain.catch(function () { return null; });
    }

    /** 登记一个只有域名、还没有名字的站点 */
    function addHost(host, src) {
        return put(host, '', src || 'probe', { allowEmpty: true });
    }

    /** 记住自动学到的站名（已存在则跳过） */
    function learn(host, name, src) {
        return put(host, name, src || 'learned');
    }

    /** 用户手改：覆盖一切，含之前学到的值 */
    function rename(host, name) {
        return put(host, name, 'manual', { override: true, manual: true });
    }

    /** 删除一条（回到「没有记录」→ 回退预置或域名） */
    function remove(host) {
        var k = normHost(host);
        if (!k) { return Promise.resolve(false); }
        chain = chain.then(function () {
            return readRaw().then(function (map) {
                if (!map[k]) { return false; }
                delete map[k];
                cache = map;
                return writeRaw(map);
            });
        });
        return chain.catch(function () { return false; });
    }

    /** 全量导出（设置页「导入/导出」用） */
    function exportAll() {
        return ready().then(function (map) { return JSON.parse(JSON.stringify(map || {})); });
    }

    /**
     * 全量导入：与现有记录合并。
     * 规则：导入的 manual 优先；其余只补空缺，避免一次导入把当前学习结果冲掉。
     */
    function importAll(obj) {
        if (!obj || typeof obj !== 'object') { return Promise.resolve({ added: 0, updated: 0 }); }
        chain = chain.then(function () {
            return readRaw().then(function (map) {
                var added = 0, updated = 0;
                Object.keys(obj).forEach(function (rawKey) {
                    var k = normHost(rawKey);
                    var v = obj[rawKey];
                    if (!k || !v || typeof v !== 'object') { return; }
                    var n = clean(v.name);
                    if (!n) { return; }
                    var cur = map[k];
                    var rec = {
                        name: n,
                        src: v.src || 'import',
                        at: Number(v.at) || Date.now(),
                        manual: v.manual ? 1 : 0
                    };
                    if (!cur) { map[k] = rec; added++; return; }
                    if (cur.manual && !rec.manual) { return; }
                    if (rec.manual && !cur.manual) { map[k] = rec; updated++; return; }
                    if (!cur.name) { map[k] = rec; added++; }
                });
                cache = map;
                return writeRaw(map).then(function () { return { added: added, updated: updated }; });
            });
        });
        return chain.catch(function () { return { added: 0, updated: 0 }; });
    }

    /** 同步读全量（未 ready 时返回 null）—— 设置页列表要同步渲染 */
    function snapshot() {
        return cache ? cache : null;
    }

    /** 测试用：清空内存镜像（不写 storage） */
    function _resetCache() { cache = null; loading = null; chain = Promise.resolve(); }

    return {
        KEY: KEY,
        normHost: normHost,
        ready: ready,
        peek: peek,
        nameOf: nameOf,
        snapshot: snapshot,
        put: put,
        learn: learn,
        rename: rename,
        remove: remove,
        exportAll: exportAll,
        importAll: importAll,
        _resetCache: _resetCache
    };
});
