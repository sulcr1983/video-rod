/* ==========================================================
 * VRSiteRegistry —— 站点字典（单一真源）
 *
 * 解决什么问题：
 *   过去「哪个网站」「叫什么名」散落在 4 份写死的 PLAT 字典里
 *   （path.js / app.js / ui.js / lightbox.js），新增站点要改 4 处。
 *   现在统一在这里解析：域名 → 站点 key → 显示名 → 目录段。
 *
 * 名字优先级（高 → 低）：
 *   用户手改(manual) > 预置(preset) > 自动学习(learned) > 可注册域名(host)
 *
 * 为什么预置压过自动学习：
 *   B站 的 og:site_name 可能是 "bilibili"，抖音可能是小写拼音。
 *   预置名是人工校正过的（「B站」「抖音」），必须能盖住这些不适合做目录的自动结果。
 *   小网站不在预置表里，自动学习的结果自然生效 —— 正是用户要的行为。
 *
 * 重名处理：
 *   两个不同域名解析出同一个显示名时，目录段追加域名后缀：
 *      图片站 (a.com) / 图片站 (b.com)
 *   规则是「冲突时双方都加」，而不是「第一个保留原名」—— 后者会在新增
 *   一个同名站点时，让已有目录突然改名，文件被拆成两处。
 *
 * 同步性：
 *   buildRelDir() 是同步的，而 storage 是异步的。这里读
 *   VRSiteNameStore.snapshot()（内存镜像），未 ready 时退化为
 *   预置表 + 域名，同样可用。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRSiteRegistry = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    var index = null;      // host -> { key, host, name, src, dir }
    var byName = null;     // 显示名 -> host
    var byKey = null;      // key(host) -> row

    /**
     * 平台 key → 代表域名。
     *
     * 为什么需要：库里老条目的 platform 存的是平台 key（`weibo` / `bilibili`），
     * 而站点索引按域名建键。缺了这层映射，`nameOf('weibo')` 会返回空，
     * 左栏就会把「weibo」和「weibo.com」当成两个站点，出现两个「微博」
     * （2026-11-07 真机实测）。
     *
     * 只放「确定属于同一站点」的代表域名；不确定的不写，宁可显示 key。
     */
    var PLATFORM_KEY_HOST = {
        weibo: 'weibo.com',
        bilibili: 'bilibili.com',
        xiaohongshu: 'xiaohongshu.com',
        x: 'x.com',
        youtube: 'youtube.com',
        douyin: 'douyin.com',
        instagram: 'instagram.com',
        tiktok: 'tiktok.com'
    };

    /* ---------------- 依赖 ---------------- */

    function SN() { return root.VRSiteName; }
    function PP() { return root.VRSiteNamesPreset; }
    function ST() { return root.VRSiteNameStore; }

    function hostOf(url) {
        var S = SN();
        if (S && S.hostOf) {
            try { return S.hostOf(url); } catch (e) { /* 落回简化 */ }
        }
        var s = String(url || '');
        try { return new URL(s).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) {
            var m = s.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
            return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
        }
    }

    function registrable(host) {
        var S = SN();
        if (S && S.registrableDomain) {
            try { return S.registrableDomain(host); } catch (e) { /* 落回 */ }
        }
        var h = String(host || '').toLowerCase().replace(/^www\./, '');
        var segs = h.split('.');
        return segs.length > 2 ? segs.slice(-2).join('.') : h;
    }

    /* ---------------- 索引构建 ---------------- */

    /**
     * 收集所有已知站点，按优先级合并成 host -> 行。
     * 不依赖 storage 是否 ready：快照为空时只缺 learned 层，manifest/preset 照常。
     */
    function buildRows() {
        var rows = Object.create(null);
        var preset = PP();
        var store = ST();
        var snap = null;
        if (store && typeof store.snapshot === 'function') {
            try { snap = store.snapshot(); } catch (e) { snap = null; }
        }

        /* ① 预置层 */
        var plist = (preset && typeof preset.list === 'function') ? preset.list() : [];
        var groupHosts = Object.create(null);   // group 名 -> [host]
        var hostGroup = Object.create(null);    // host -> group 名
        for (var i = 0; i < plist.length; i++) {
            var it = plist[i];
            if (!it || !it.n || !it.h) { continue; }
            if (!groupHosts[it.n]) { groupHosts[it.n] = []; }
            for (var j = 0; j < it.h.length; j++) {
                var h = String(it.h[j] || '').toLowerCase();
                if (!h || h.indexOf('/') >= 0) { continue; }
                /* group = 预置条目身份。B站 同时有 bilibili.com / b23.tv
                 * 两个域名，它们属于**同一个站点**，重名判定必须按 group 去重，
                 * 否则会被当成两个「B站」抢同一个目录名。 */
                rows[h] = { key: h, host: h, name: it.n, src: 'preset', manual: 0, at: 0, group: it.n };
                groupHosts[it.n].push(h);
                hostGroup[h] = it.n;
            }
        }

        /* ② 自动学习 / 手改层 */
        if (snap && typeof snap === 'object') {
            Object.keys(snap).forEach(function (rawKey) {
                var rec = snap[rawKey] || {};
                var h = String(rawKey || '').toLowerCase();
                if (!h) { return; }
                var cur = rows[h];
                if (rec.manual) {
                    var nm = rec.name || (cur && cur.name) || h;
                    /* 手改的域名若属于某个预置站点（bilibili.com / b23.tv），
                     * 整组一起改名 —— 否则同一个 B站 会分裂成两个目录：
                     * bilibili.com 叫「哔哩哔哩」、b23.tv 还叫「B站」。 */
                    var g = hostGroup[h];
                    if (g && groupHosts[g]) {
                        groupHosts[g].forEach(function (gh) {
                            if (!rows[gh]) { return; }
                            rows[gh].name = nm;
                            rows[gh].src = 'manual';
                            rows[gh].manual = 1;
                            rows[gh].at = rec.at || 0;
                            /* group 保持 g：整组仍共享同一个目录 */
                        });
                        return;
                    }
                    rows[h] = {
                        key: h, host: h, name: nm,
                        src: 'manual', manual: 1, at: rec.at || 0,
                        /* 非预置站点：手改即独立站点 */
                        group: h
                    };
                    return;
                }
                if (!cur && rec.name) {
                    rows[h] = {
                        key: h, host: h, name: rec.name,
                        src: rec.src || 'learned', manual: 0, at: rec.at || 0,
                        group: h
                    };
                }
            });
        }
        return rows;
    }

    /**
     * 重名处理：**不同站点**（不同 group）解析出同一显示名时，双方都追加域名后缀。
     * 同一站点的多个域名（B站 的 bilibili.com / b23.tv）共享同一 group，
     * 不参与冲突判定 —— 否则每个预置站都会被自己拆成两个目录。
     */
    function applyDedup(rows) {
        /* name -> { group -> true }：统计「有多少个不同的站点用了这个名字」 */
        var groups = Object.create(null);
        Object.keys(rows).forEach(function (h) {
            var r = rows[h];
            var n = r.name;
            if (!n) { return; }
            if (!groups[n]) { groups[n] = Object.create(null); }
            groups[n][r.group || h] = 1;
        });
        Object.keys(rows).forEach(function (h) {
            var r = rows[h];
            var n = r.name || h;                 // 没名字的直接用域名
            var g = groups[n] ? Object.keys(groups[n]).length : 0;
            r.baseName = n;
            r.dir = (g > 1) ? (n + ' (' + h + ')') : n;
            r.conflict = g > 1;
        });
        return rows;
    }

    /** 重建索引；写盘路径与界面渲染前都可调用（幂等） */
    function refresh() {
        var rows = applyDedup(buildRows());
        index = rows;
        byName = Object.create(null);
        byKey = Object.create(null);
        Object.keys(rows).forEach(function (h) {
            var r = rows[h];
            if (!byName[r.baseName]) { byName[r.baseName] = h; }
            byKey[r.key] = r;
        });
        return index;
    }

    function ensure() {
        if (!index) { refresh(); }
        return index;
    }

    /* ---------------- 对外查询 ---------------- */

    /**
     * 识别一个页面 URL 所属站点。
     * @param {string} url
     * @param {string} [hint]  本次刚抓到的站名（下载链路会传）
     * @returns {{key:string, host:string, name:string, dir:string, src:string}}
     */
    function detect(url, hint) {
        ensure();
        var host = hostOf(url);
        if (!host) {
            return { key: '', host: '', name: hint || '', dir: hint || '', src: hint ? 'page' : '' };
        }
        var key = registrable(host);

        /* 独立产品子域（v.qq.com 等）在 registrableDomain 里已保留，
         * 这里再用 host 本身兜一次，防止旧版 site-name.js 未加载。 */
        var row = index[key] || index[host] || null;

        if (!row) {
            /* 未收录：域名兜底。hint 有名字时优先用它 —— 这正是
             * 「小网站靠自动学习」的入口。 */
            var nm = String(hint || '').trim();
            return {
                key: key, host: key,
                name: nm, dir: nm || key,
                src: nm ? 'page' : 'host',
                conflict: false
            };
        }

        /* 已收录：按优先级决定最终名字。
         * manual / preset 压过 hint；hint 只为 learned 缺失时补位。 */
        var src = row.src;
        var name = row.name;
        var h = String(hint || '').trim();
        if (h && src !== 'manual' && src !== 'preset') {
            src = 'learned';
            name = h;
        }
        var dir = name || key;
        if (row.conflict && name === row.baseName) {
            dir = row.dir;                        // 重名时用带后缀的目录段
        }
        return {
            key: row.key, host: row.host,
            name: name, dir: dir,
            src: src,
            conflict: !!row.conflict
        };
    }

    /** 按 key 取名 */
    function nameOf(key) {
        ensure();
        var k = String(key || '').toLowerCase();
        var row = index[k];
        if (row) { return row.name; }
        /* 老条目存的是平台 key（weibo / bilibili / xiaohongshu），
         * 索引按域名建键，直接用 key 查会落空 —— 那时左栏就会把
         * 「weibo」和「weibo.com」拆成两个节点（2026-11-07 真机实测）。
         * 这里补一层：平台 key → 该平台首个域名的条目。 */
        var alias = PLATFORM_KEY_HOST[k];
        if (alias) {
            var r2 = index[alias] || index[registrable(alias)];
            if (r2) { return r2.name; }
        }
        return '';
    }

    /** 按显示名反查 key（目录反解用） */
    function keyOfName(name) {
        ensure();
        var n = String(name || '').trim();
        if (!n) { return ''; }
        if (byName[n]) { return byName[n]; }
        /* 带重名后缀的形式：「图片站 (a.com)」 */
        var m = n.match(/^(.*?)\s*\(([^()]+)\)$/);
        if (m && byName[m[1]] && m[2].indexOf('.') >= 0) {
            return String(m[2]).toLowerCase();
        }
        return '';
    }

    /** 目录段：重名时带域名后缀 */
    function dirOf(key) {
        ensure();
        var k = String(key || '').toLowerCase();
        var row = index[k];
        if (row) { return row.dir; }
        var alias = PLATFORM_KEY_HOST[k];
        if (alias) {
            var r2 = index[alias] || index[registrable(alias)];
            if (r2) { return r2.dir; }
        }
        return '';
    }

    /** 全部站点（界面左栏用） */
    function all() {
        ensure();
        return Object.keys(index).map(function (k) { return index[k]; });
    }

    /** 测试用：清掉索引，下次调用重建 */
    function _reset() { index = null; byName = null; byKey = null; }

    return {
        refresh: refresh,
        detect: detect,
        nameOf: nameOf,
        dirOf: dirOf,
        keyOfName: keyOfName,
        all: all,
        hostOf: hostOf,
        registrable: registrable,
        _reset: _reset
    };
});
