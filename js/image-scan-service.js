/* ==========================================================
 * VRImageScanService —— 页面侧统一图片发现服务
 *
 * 四个入口（侧栏 / popup 抓图 / 图集 / 面板）都复用这一份：
 *   · VRImageUtil：DOM / Shadow / poster / link / SVG / 背景 / 伪元素
 *   · VRDownloadScan：源码 / JSON 兜底
 *   · 图片网络缓存：SW 的 vrImg.netCache（滚过/已移除/懒加载前请求过的图）
 *   · fillSizesV2：并发预载 + 失败重试 + 尺寸回填
 *
 * 只产出可序列化的 plain object；不持有 DOM、不碰下载、不改页面行为。
 * ========================================================== */
(function (root) {
    'use strict';
    if (root.VRImageScanService) { return; }

    function keyOf(U, url) {
        var s = String(url || '').split('#')[0];
        try { return U.stripResizeParams(s) || s; } catch (e) { return s; }
    }

    function boolSettings(a, b, key, def) {
        var C = root.VRImgPipelineCore;
        if (C && typeof C.boolSettings === 'function') { return C.boolSettings(a, b, key, def); }
        var av = a ? a[key] : undefined, bv = b ? b[key] : undefined;
        if (av === false || bv === false) { return false; }
        if (av === true || bv === true) { return true; }
        return !!def;
    }

    function readSettings() {
        return new Promise(function (resolve) {
            try {
                chrome.storage.local.get(['vrLibSettings', 'vrSettings'], function (o) {
                    var a = (o && o.vrLibSettings) || {};
                    var b = (o && o.vrSettings) || {};
                    resolve({
                        imgPipelineV2: boolSettings(a, b, 'imgPipelineV2', true),
                        imgSniff: boolSettings(a, b, 'imgSniff', true),
                        imgScanMax: Math.max(1, Number(a.imgScanMax || b.imgScanMax || 400) || 400)
                    });
                });
            } catch (e) {
                resolve({ imgPipelineV2: true, imgSniff: true, imgScanMax: 400 });
            }
        });
    }

    function netCache(o) {
        if (!o || o.netScan === false) { return Promise.resolve([]); }
        return new Promise(function (resolve) {
            try {
                var msg = { Message: 'vrImg.netCache', action: 'vrImg.netCache' };
                if (o && o.tabId) { msg.tabId = o.tabId; }
                chrome.runtime.sendMessage(msg, function (r) {
                    void chrome.runtime.lastError;
                    resolve((r && Array.isArray(r.items)) ? r.items : []);
                });
            } catch (e) { resolve([]); }
        });
    }

    function collectDomAllUrls(U) {
        var out = Object.create(null);
        try {
            var nodes = document.querySelectorAll('img, video[poster], image, a[href]');
            for (var i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                var isAnchor = String(el.tagName || '').toUpperCase() === 'A';
                var attrs = ['src', 'currentSrc', 'srcset', 'poster', 'href', 'xlink:href',
                             'data-src', 'data-original', 'data-original-src', 'data-lazy-src'];
                for (var j = 0; j < attrs.length; j++) {
                    var v = el.getAttribute ? el.getAttribute(attrs[j]) : '';
                    if (!v) { continue; }
                    v = String(v).trim();
                    if (v.indexOf('data:') === 0) { continue; }
                    var parts = v.split(/\s+/);
                    for (var p = 0; p < parts.length; p++) {
                        var u = U.absolutize(parts[p], location.href);
                        if (!u) { continue; }
                        /* <a href> 只在「指向图片」时才算一条图（2026-11-13 实测回归）：
                         * 无脑收全部 href 会把 /author/admin/、/category/nba/、文章 slug
                         * 全塞进清单 —— 真实站点 33 行里 16 行是页面链接，缩略图全裂。
                         * 这里比 isProbablyImage 更严：**必须有图片扩展名**。
                         * isProbablyImage 对无扩展名地址是宽容放行的（为 /img?id=1 这类
                         * 动态图床服务），但 <a href> 指向无扩展名路径时几乎都是文章页
                         * （实测 /bruno-fernandes-speaks-out-about-.../ 就是这么混进来的）。 */
                        if (isAnchor && !U.isProbablyImage(u)) { continue; }
                        if (isAnchor && !/[.](?:jpe?g|png|gif|webp|avif|bmp)(?:[?#]|$)/i.test(u)) { continue; }
                        out[keyOf(U, u)] = 1;
                    }
                }
            }
        } catch (e) { /* 单个节点失败忽略 */ }
        return out;
    }

    function makePush(U, MIN, cap, have, out) {
        return function push(url, w, h, cands, bg, srcOnly, source) {
            var u = U.absolutize(url, location.href);
            if (!u || /^data:/i.test(u)) { return; }
            if (U.isSvgUrl(u) || U.isPlaceholderUrl(u)) { return; }
            if (u === location.href || u === document.URL) { return; }
            var k = keyOf(U, u);
            if (!k || have[k]) { return; }
            if (out.length >= cap) { return; }
            have[k] = 1;
            out.push({
                url: u,
                w: Number(w) || 0,
                h: Number(h) || 0,
                bg: !!bg,
                srcOnly: !!srcOnly,
                source: source || (bg ? 'bg' : 'dom'),
                candidates: (cands && cands.length) ? cands.slice() : [u]
            });
        };
    }

    async function finishSizes(U, out, MIN, cap) {
        var dropped = 0, tiny = 0;
        try {
            var miss = [];
            for (var i = 0; i < out.length; i++) {
                if (!(out[i].w > 0 && out[i].h > 0)) { miss.push(out[i].url); }
            }
            var got = {};
            if (miss.length && typeof U.fillSizesV2 === 'function') {
                got = await U.fillSizesV2(miss, {
                    max: cap, concurrency: 8, timeout: 2500, retry: 1, budget: 5000
                });
            }
            var alive = [];
            for (var q = 0; q < out.length; q++) {
                var x = out[q];
                if (x.w > 0 && x.h > 0) { alive.push(x); continue; }
                var sz = got[x.url];
                if (sz && sz.w > 0 && sz.h > 0) {
                    if (sz.w < MIN || sz.h < MIN) { tiny++; continue; }
                    x.w = sz.w; x.h = sz.h;
                    alive.push(x);
                } else if (sz && sz.fail) {
                    dropped++;
                } else {
                    alive.push(x);              // 超时未探到尺寸的保留，不因慢判死
                }
            }
            out = alive;
        } catch (e) { /* 回填失败保持现状 */ }
        return { items: out, dropped: dropped, tiny: tiny };
    }

    /** 灰度回退：imgPipelineV2=false 时只走旧 DOM/背景快照，不启用源码/网络/Mutation 新链路。 */
    async function legacyCollect(U, o, MIN, cap) {
        var have = Object.create(null), out = [];
        var push = makePush(U, MIN, cap, have, out);
        try {
            U.scanImages(document, {
                minWidth: MIN, minHeight: MIN, minShow: U.PANEL_MIN_SHOW, dedupe: true
            }).forEach(function (it) { push(it.url, it.w, it.h, it.candidates, false, false, 'dom'); });
        } catch (e) { /* 忽略 */ }
        if (o.bgScan !== false) {
            try {
                U.scanBackgrounds(document, { minShow: U.PANEL_MIN_SHOW, dedupe: true })
                    .forEach(function (it) { push(it.url, it.w, it.h, it.candidates, true, false, 'bg'); });
            } catch (e) { /* 忽略 */ }
        }
        return finishSizes(U, out, MIN, cap);
    }

    /** 主入口：在单个 frame 里执行。o: {minSize,bgScan,srcScan,netScan,tabId,max} */
    async function collect(o) {
        o = o || {};
        var U = root.VRImageUtil;
        if (!U) { return { __noUtil: true, items: [], dropped: 0, tiny: 0 }; }
        var cfg = await readSettings();
        var MIN = Math.max(16, Number(o.minSize) || U.MIN_SIZE || 100);
        var cap = Math.max(1, Number(o.max || cfg.imgScanMax) || 400);
        if (cfg.imgPipelineV2 === false) { return legacyCollect(U, o, MIN, cap); }

        var have = Object.create(null), out = [];
        var push = makePush(U, MIN, cap, have, out);
        var domAll = collectDomAllUrls(U);

        try {
            U.scanImages(document, {
                minWidth: MIN, minHeight: MIN,
                minShow: U.PANEL_MIN_SHOW, dedupe: true
            }).forEach(function (it) {
                push(it.url, it.w, it.h, it.candidates, false, false, it.source || 'dom');
            });
        } catch (e) { /* 单通道失败不影响其它 */ }

        if (o.bgScan !== false) {
            try {
                U.scanBackgrounds(document, { minShow: U.PANEL_MIN_SHOW, dedupe: true })
                    .forEach(function (it) { push(it.url, it.w, it.h, it.candidates, true, false, 'bg'); });
            } catch (e) { /* 同上 */ }
        }

        /* 源码/JSON：只补充 DOM 过滤掉/未出现过的地址；明确失败或小图在 finishSizes 剔除。 */
        if (o.srcScan) {
            try {
                var S = root.VRDownloadScan;
                var body = document.body ? document.body.innerHTML : '';
                var urls = (S && S.extractUrlsFromHtml) ? S.extractUrlsFromHtml(body, location.href, cap) : [];
                for (var si = 0; si < urls.length; si++) {
                    var su = U.absolutize(urls[si], location.href);
                    if (!su || !U.isProbablyImage(su)) { continue; }
                    /* 源码通道只认「有图片扩展名」的地址（2026-11-13 实测回归）：
                     * 从 innerHTML 正则捞出来的无扩展名地址，绝大多数是文章/分类页
                     * （实测 /lebron-james-suspected-stalker-…、/category/uncategorized/
                     * 被 isProbablyImage 的宽容策略放行，变成 5 个裂图空框）。
                     * 源码通道本就是兜底（DOM 有货时不跑），收紧不会漏真图。 */
                    if (!/[.](?:jpe?g|png|gif|webp|avif|bmp)(?:[?#]|$)/i.test(su)) { continue; }
                    if (/(?:^|[/_.-])(?:avatars?|icons?|logos?|emoji|sprites?|spacer|loading|placeholder|badge)(?:[/_.-]|$)/i.test(su)) { continue; }
                    if (domAll[keyOf(U, su)]) { continue; }
                    push(su, 0, 0, [su], false, true, 'src');
                }
            } catch (e) { /* 同上 */ }
        }

        try {
            var net = await netCache(o);
            for (var ni = 0; ni < net.length; ni++) {
                var it0 = net[ni] || {};
                if (!it0.url) { continue; }
                push(it0.url, 0, 0, [it0.url], false, false, 'network');
            }
        } catch (e) { /* 同上 */ }

        return finishSizes(U, out, MIN, cap);
    }

    root.VRImageScanService = { collect: collect };
})(typeof self !== 'undefined' ? self : this);
