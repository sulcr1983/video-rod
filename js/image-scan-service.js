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

    /**
     * 图片所属「卡片/笔记」的文本指纹（B-46 图片版，2026-11-15）。
     *
     * 问题：首页 feed（微博/小红书/Twitter）里每张图属于**不同**笔记，
     * 而批量命名用的是单一 `document.title` + 序号 → 一批下载下来全同名，
     * 用户分不清哪张属于哪条。视频侧早已用 vrExtractCardMeta 解决（按卡片锚定）。
     *
     * 做法：从 <img> 往上找最近的「像卡片」的祖先，取它的可见文本前 40 字
     * 当分组键。找不到就返回空串（调用方退回原命名，行为不变）。
     *
     * 为什么用文本而不是选择器：各站 DOM 结构完全不同，硬编码 article/[data-*]
     * 只能覆盖少数站；「最近的、包含足够文本的祖先」是跨站通用且零配置的近似。
     */
    function cardKeyOf(el) {
        try {
            if (!el || !el.closest) { return ''; }
            var node = el;
            for (var depth = 0; depth < 6 && node; depth++) {
                node = node.parentElement;
                if (!node || node === document.body || node === document.documentElement) { break; }
                var tag = String(node.tagName || '').toLowerCase();
                /* 明显的卡片容器语义（各站常见）：article / li / [data-*卡片] */
                var looksCard = tag === 'article' || tag === 'li' ||
                    node.hasAttribute('data-testid') || node.hasAttribute('data-id') ||
                    node.hasAttribute('data-note-id') || node.hasAttribute('data-mid');
                var txt = String(node.innerText || node.textContent || '').trim();
                if (looksCard && txt.length >= 8) {
                    return txt.replace(/\s+/g, ' ').slice(0, 40);
                }
            }
        } catch (e) { /* 跨域/结构异常就当作没有卡片信息 */ }
        return '';
    }

    function makePush(U, MIN, cap, have, out) {
        /* 视频/音频扩展名一律不进图片清单（2026-11-15 修 local-image 回归）。
         * 起因：夹具里 `<img id="broken" src="media/test.mp4">`（模拟坏图），
         * 采集时只看标签不看目标类型，于是这条 mp4 被当成图片收进清单 ——
         * 侧栏多出一张「MP4 · 0.0MB」且无尺寸，local-image 的 maxUnknown=0 直接破。
         * 原来只有 `<a href>` 分支（collectDomAllUrls）做了扩展名白名单，
         * `<img>` / 背景图 / 源码通道全都没做。这里统一兜住：
         * 图片标签指向音视频文件本身就是坏图，不该占一格。 */
        var AV_RE = /[.](?:mp4|m4v|mov|webm|mkv|avi|flv|ts|m3u8|mpd|mp3|m4a|aac|wav|ogg|flac)(?:[?#]|$)/i;
        /* 图片扩展名白名单：用于「同域 + 无扩展名」的排除判定 */
        var IMG_EXT_RE = /[.](?:jpe?g|png|gif|webp|avif|bmp|heic|heif|tiff?|ico)(?:[?#]|$)/i;
        return function push(url, w, h, cands, bg, srcOnly, source, el) {
            var u = U.absolutize(url, location.href);
            if (!u || /^data:/i.test(u)) { return; }
            /* 图床跳转页剥壳（2026-11-18）。
             *
             * 为什么要在这里做：`IMG_EXT_RE` 下面的判定看的是**整条 URL**，
             * 而 `https://23img.com/l/?i=/i/2026/11/15/aphrl4.jpg` 这种包装页
             * query 里带着 `.jpg`，于是被当成「有图片扩展名」放行 ——
             * 结果清单里多出一条 0×0、点开打不开的条目
             * （t66y 真机实测：25 条里 7 条是这种，占 28%）。
             * 剥成真图后，若真图本来就在结果里，会被 keyOf+have 去重挡住，
             * 正好实现「包装页消失、真图保留」。 */
            try {
                if (typeof U.unwrapImageWrapper === 'function') {
                    var realU = U.unwrapImageWrapper(u);
                    if (realU) { u = realU; }
                }
            } catch (eUnwrap) { /* 剥壳失败就用原地址，不影响采集 */ }
            if (AV_RE.test(u)) { return; }
            if (U.isSvgUrl(u) || U.isPlaceholderUrl(u)) { return; }
            if (u === location.href || u === document.URL) { return; }
            /* 同域 + 无图片扩展名 → 几乎一定是页面/接口，不是图（2026-11-16）。
             *
             * 真机证据（微博首页 39 张图 / 17 张缩略图裂）：坏格子里混着
             *   https://weibo.com/5751412092/RrEaA1x4k       ← 微博详情页
             *   https://weibo.cn/sinaurl?u=http%3A%2F%2F...   ← 跳转链接
             *   https://s.weibo.com/weibo?q=%23...            ← 搜索页
             * 它们来自 DOM 通道（<img>/背景图等），而锚点通道与源码通道都要求
             * 带图片扩展名，唯独 makePush 这一层没有这层保护。
             *
             * 判据取舍：真实图片绝大多数放在独立 CDN 域（sinaimg.cn / xhscdn.com /
             * pbs.twimg.com…），与页面同域又没扩展名的地址是页面/接口的概率极高。
             * 代价是可能漏掉极少数「同域动态图床」（如 /img?id=1）——
             * 但这类地址在扩展页里同样会因缺扩展名/Content-Type 而难辨，
             * 留着只会变成裂图格子，不如让位给能确认的图。 */
            if (!IMG_EXT_RE.test(u)) {
                var sameHost = false;
                try { sameHost = new URL(u).hostname === location.hostname; } catch (e) { sameHost = false; }
                if (sameHost) { return; }
                if (U.looksLikePage && U.looksLikePage(u)) { return; }
            }
            var k = keyOf(U, u);
            if (!k || have[k]) { return; }
            if (out.length >= cap) { return; }
            /* ==========================================================
             * 确定性判死（2026-11-18，修「同一页面每次扫描结果都不一样」）
             * ----------------------------------------------------------
             * 真机证据：同一页面、同一份代码，连扫 6 次 → 条数
             *   15 → 17 → 16 → 19 → 18 → 17
             *   并集 20 条，但**每次都出现的只有 12 条**。
             * 用户点两次看到不同数量，自然会觉得「嗅探不准 / 漏图」。
             *
             * 根因不在这一层，而在 finishSizes：它用「网络预载 + 2500ms 超时」
             * 判死 —— 网络快就把死链判掉，网络慢就当超时保留，
             * 于是**结果随网络抖动**。
             *
             * DOM 本身就带确定性信号：
             *   el.complete === true && naturalWidth === 0
             *   → 这个 <img> 已经「加载完毕但没有任何像素」，即页面自己都没取到。
             *     这是浏览器已经做过的判定，不需要我们再发一次请求去猜。
             * 反过来 complete === false 表示**还在加载**，绝不能判死。
             *
             * 只对 DOM 通道生效（bg / srcOnly / network 没有 el）：
             * 那些本来就没有元素可问，保持原有逻辑。
             *
             * 必须排除「懒加载占位」：占位图本身就是 complete + 0 像素，
             * 但真地址在 data-src/srcset 里 —— 判死会把真图整批误杀。
             * ========================================================== */
            if (el && !bg && !srcOnly) {
                try {
                    var lazyish = !!(el.getAttribute('data-src') ||
                        el.getAttribute('data-original') ||
                        el.getAttribute('data-lazy-src') ||
                        el.getAttribute('data-original-src') ||
                        (el.srcset && String(el.srcset).trim()));
                    if (el.complete === true && (Number(el.naturalWidth) || 0) === 0 && !lazyish) {
                        return;   /* 页面自己都没加载出来，且没有懒加载兜底 → 确定死图 */
                    }
                } catch (eDead) { /* 判死失败就照常收，不因异常丢图 */ }
            }
            have[k] = 1;
            var item = {
                url: u,
                w: Number(w) || 0,
                h: Number(h) || 0,
                bg: !!bg,
                srcOnly: !!srcOnly,
                source: source || (bg ? 'bg' : 'dom'),
                candidates: (cands && cands.length) ? cands.slice() : [u]
            };
            /* B-46 图片版：带上「这张图属于哪条笔记/卡片」的分组键。
             * 只有 DOM 来源能定位到元素；网络缓存/源码通道没有元素，留空即可。 */
            if (el) {
                var ck = cardKeyOf(el);
                if (ck) { item.cardKey = ck; }
            }
            out.push(item);
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
            }).forEach(function (it) { push(it.url, it.w, it.h, it.candidates, false, false, 'dom', it.el); });
        } catch (e) { /* 忽略 */ }
        if (o.bgScan !== false) {
            try {
                U.scanBackgrounds(document, { minShow: U.PANEL_MIN_SHOW, dedupe: true })
                    .forEach(function (it) { push(it.url, it.w, it.h, it.candidates, true, false, 'bg', it.el); });
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
                push(it.url, it.w, it.h, it.candidates, false, false, it.source || 'dom', it.el);
            });
        } catch (e) { /* 单通道失败不影响其它 */ }

        if (o.bgScan !== false) {
            try {
                U.scanBackgrounds(document, { minShow: U.PANEL_MIN_SHOW, dedupe: true })
                    .forEach(function (it) { push(it.url, it.w, it.h, it.candidates, true, false, 'bg', it.el); });
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
