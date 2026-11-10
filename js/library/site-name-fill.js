/* ==========================================================
 * VRSiteNameFill —— 历史站点「自动补齐网站名字」（资源库页专用）
 *
 * 解决什么问题（2026-11-10 苏哥拍板 F4）：
 *   ADR-061 规定站名只在「下载那一刻」抓（那时有 DOM）。所以库里在
 *   站名功能上线之前下载的条目，以及从别处拷进来的文件夹，platform
 *   里只有域名，左栏永远显示 yidianzixun.com 这类字符串。
 *   预置表能救常见站，但救不了长尾站 —— 苏哥明确要求**名字靠自动探测**，
 *   不要人工写死。
 *
 * 怎么补：
 *   库页启动后异步扫一遍 FILES，挑出「左栏还显示成域名」的站点，
 *   串行交给后台 vrSiteNameProbe（SW 抓公开首页 → parseHtmlInfo 提取
 *   og:site_name / meta / <title>），学到的名字写回 vrSiteNames，
 *   重建站点字典并刷新左栏。
 *
 * 约束（都是踩过的坑）：
 *   · 只在资源库页跑，首屏渲染之后延迟启动，**失败绝不影响浏览**；
 *   · 串行 + 间隔 + 单轮上限，不对外部站点突发请求；
 *   · 后台探测 credentials:'omit'，不带任何登录态；
 *   · 探测过（成功或失败）就登记，7 天内不重复外发；manual 永不覆盖；
 *   · 只改显示名，**不搬动磁盘上已有目录**；
 *   · SW 与库页是两个上下文，cache 不共享：SW 写盘之后，库页必须再
 *     写一次自己的镜像，否则 RG.refresh() 读到的还是旧快照。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRSiteNameFill = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    var MAX_PER_RUN = 20;                     // 单轮最多探测多少个域名
    var GAP_MS = 300;                         // 两条之间的间隔
    var PROBE_TIMEOUT = 12000;                // 单条超时（SW 内 fetch 自带 8 秒）
    var RETRY_MS = 7 * 24 * 3600 * 1000;      // 空名记录 7 天后才允许重试
    var BOOT_DELAY = 1500;                    // 首屏之后才开工

    function SN() { return root.VRSiteName; }
    function ST() { return root.VRSiteNameStore; }
    function RG() { return root.VRSiteRegistry; }
    function APP() { return root.VRApp; }

    /** 只有域名形态的 platform 才值得探测；平台 key / 分组键 / IP 都跳过 */
    function hostLike(s) {
        var v = String(s || '').toLowerCase().trim();
        if (!v || v.charAt(0) === '@') { return false; }
        if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v)) { return false; }
        if (!/[a-z]{2,}$/i.test(v)) { return false; }
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) { return false; }
        if (v === 'localhost') { return false; }
        return true;
    }

    /** 归一成与 vrSiteNames / 预置表一致的键（去 www、子域归并、v.qq.com 保留） */
    function normKey(plat) {
        var S = SN();
        var h = String(plat || '').toLowerCase().trim();
        if (!S) { return h.replace(/^www\./, ''); }
        try {
            h = S.hostOf(h) || h;
            return S.registrableDomain(h) || h;
        } catch (e) { return h.replace(/^www\./, ''); }
    }

    /** 之前探测过但没拿到名字：短期内不再外发请求（避免每次开库都抓一遍） */
    function probedRecently(key, store) {
        var st = store || ST();
        if (!st || typeof st.peek !== 'function') { return false; }
        var rec = null;
        try { rec = st.peek(key); } catch (e) { return false; }
        if (!rec || rec.name) { return false; }
        var at = Number(rec.at) || 0;
        return at > 0 && (Date.now() - at) < RETRY_MS;
    }

    /**
     * 收集「左栏还显示成域名」的站点键。纯逻辑，可 Node 单测。
     * @param {Array} files VRApp.getFiles() 的结果（只读 plat/platform）
     * @param {object} opt  { max, store, registry, normKey, ignoreProbed }
     * @returns {Array<string>} 归一后的域名键，去重、限量
     */
    function collectUnknown(files, opt) {
        var o = opt || {};
        var max = Number(o.max) > 0 ? Number(o.max) : MAX_PER_RUN;
        var rg = o.registry || RG();
        var seen = Object.create(null);
        var out = [];
        (files || []).forEach(function (f) {
            var p = String((f && (f.plat || f.platform)) || '').trim().toLowerCase();
            if (!p || p === 'web' || p === 'untracked' || !hostLike(p)) { return; }
            if (rg && typeof rg.nameOf === 'function') {
                try { if (rg.nameOf(p)) { return; } } catch (e) { /* 当作未知继续 */ }
            }
            var key = o.normKey ? o.normKey(p) : normKey(p);
            if (!key || seen[key]) { return; }
            seen[key] = 1;
            if (!o.ignoreProbed && probedRecently(key, o.store)) { return; }
            if (out.length < max) { out.push(key); }
        });
        return out;
    }

    /** 单条后台探测；超时也 resolve，绝不挂死整条队列 */
    function sendProbe(key) {
        return new Promise(function (resolve) {
            var done = false;
            var finish = function (v) { if (done) { return; } done = true; resolve(v || null); };
            var timer = setTimeout(function () { finish(null); }, PROBE_TIMEOUT);
            try {
                chrome.runtime.sendMessage(
                    { Message: 'vrSiteName.probe', action: 'vrSiteName.probe', domain: key },
                    function (res) {
                        void (chrome.runtime && chrome.runtime.lastError);
                        clearTimeout(timer);
                        finish(res);
                    }
                );
            } catch (e) {
                clearTimeout(timer);
                finish(null);
            }
        });
    }

    /** 把结果写进库页自己的 store 镜像（SW 已写盘，这里不能省） */
    function applyResult(key, res) {
        var st = ST();
        if (!st) { return Promise.resolve(false); }
        var host = (res && res.host) || key;
        var name = res && res.name ? String(res.name).trim() : '';
        var p;
        if (name) {
            p = st.put(host, name, res.src || 'probe', { override: true });
        } else {
            p = st.addHost(host, 'probe');
        }
        return Promise.resolve(p).then(function () { return !!name; }, function () { return !!name; });
    }

    /** 重建字典 + 重绘左栏与货架行头；不动磁盘文件 */
    function refreshUI(learned) {
        var rg = RG();
        var app = APP();
        try { if (rg && rg.refresh) { rg.refresh(); } } catch (e) { /* 不阻断 */ }
        try { if (app && app.renderTree) { app.renderTree(); } } catch (e) { /* 不阻断 */ }
        try { if (app && app.render) { app.render(); } } catch (e) { /* 不阻断 */ }
        if (learned > 0 && app && app.toast) {
            try { app.toast('已自动识别 ' + learned + ' 个网站名称'); } catch (e) { /* 不阻断 */ }
        }
    }

    var state = { running: false, done: false, scanned: 0, learned: 0, failed: 0, keys: [], results: [] };
    function publish() { try { root.__vrSiteFill = state; } catch (e) { /* 忽略 */ } }

    /**
     * 跑一轮补齐。
     * @param {object} opt { files, max, gapMs, force, delayMs }
     *   force=true 时忽略「7 天内已探测」的记录（手动重试用）
     */
    async function run(opt) {
        if (state.running) { return state; }
        var o = opt || {};
        state = { running: true, done: false, scanned: 0, learned: 0, failed: 0, keys: [], results: [] };
        publish();
        try {
            var st = ST();
            if (st && typeof st.ready === 'function') { await st.ready(); }

            var files = o.files;
            if (!files) {
                var app0 = APP();
                try { files = (app0 && app0.getFiles && app0.getFiles()) || []; } catch (e) { files = []; }
            }
            var collectOpt = {
                max: o.max,
                ignoreProbed: !!o.force,
                store: st,
                normKey: o.normKey
            };
            var keys = collectUnknown(files, collectOpt);
            state.keys = keys;
            state.scanned = keys.length;

            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var res = null;
                try { res = await sendProbe(key); } catch (e) { res = null; }
                var ok = false;
                try { ok = await applyResult(key, res); } catch (e) { ok = false; }
                if (ok) { state.learned++; } else { state.failed++; }
                state.results.push({ host: key, name: (res && res.name) || '', ok: ok });
                publish();
                if (i < keys.length - 1) { await sleep(o.gapMs != null ? o.gapMs : GAP_MS); }
            }
            if (state.learned > 0) { refreshUI(state.learned); }
            try { console.info('[site-name-fill] 补齐完成', JSON.stringify(state.results)); } catch (e) { /* 忽略 */ }
        } catch (e) {
            try { console.warn('[site-name-fill] 本轮失败（不影响浏览）', e); } catch (e2) { /* 忽略 */ }
        } finally {
            state.running = false;
            state.done = true;
            publish();
        }
        return state;
    }

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    /** 首屏之后延迟启动一次；返回 true 表示已排程 */
    function start(opt) {
        var o = opt || {};
        setTimeout(function () { run(o); }, o.delayMs != null ? o.delayMs : BOOT_DELAY);
        return true;
    }

    function status() { return state; }

    return {
        MAX_PER_RUN: MAX_PER_RUN,
        GAP_MS: GAP_MS,
        RETRY_MS: RETRY_MS,
        hostLike: hostLike,
        normKey: normKey,
        probedRecently: probedRecently,
        collectUnknown: collectUnknown,
        run: run,
        start: start,
        status: status
    };
});
