/* ==========================================================
 * VRImageUtil —— 图片扫描与原图候选解析（I1）
 *
 * 职责（全部为纯函数，可 Node 单测）：
 *   · 五级优先级收集原图候选（a[href] → srcset 最大 → data-* → data-ri → currentSrc）
 *   · 扫描页面 <img> 并按尺寸/占位/格式/重复过滤
 *   · URL 规范化与扩展名推断（SW 下载命名复用）
 *
 * 约定：
 *   - 不碰 chrome.*、不写 DOM、任何异常都降级为空值
 *   - 浏览器/内容脚本/SW 挂 self.VRImageUtil；Node 走 module.exports
 *   - 零依赖，ES5 为主；URL 由浏览器/Node 全局提供
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRImageUtil = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    var MIN_SIZE = 100;
    /* 显示尺寸门槛：图标/按钮普遍 16–40px，内容图基本 > 100px。
     * 判显示尺寸而不是原始像素，是因为一张 500px 的图标被 CSS 缩成 16px 显示时，
     * 原始尺寸仍然够大，只看 naturalWidth 会满屏冒按钮（用户实测反馈）。 */
    var MIN_SHOW = 48;
    /* 细长装饰条的门槛：用「短边/长边」比来判断，不用面积。
     * 面积法会误杀正常的方形小图（48×48=2304 比 400×2=800 还大，
     * 任何固定面积阈值都同时拦不住细条又放过方图 —— 踩过两次）。
     * 短边 ≥ 48 已经挡掉了图标；这里只需要再挡「长宽比 > 6:1」的条状图。 */
    var MAX_ASPECT = 6;

    /** 可下载的位图扩展名（svg 不算：多为图标） */
    var IMAGE_EXT = {
        jpg: 1, jpeg: 1, jpe: 1, jfif: 1, png: 1, apng: 1, webp: 1, gif: 1,
        avif: 1, bmp: 1, heic: 1, heif: 1, tif: 1, tiff: 1, ico: 1
    };

    var CT_EXT = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/pjpeg': 'jpg',
        'image/png': 'png',
        'image/apng': 'apng',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/avif': 'avif',
        'image/bmp': 'bmp',
        'image/x-ms-bmp': 'bmp',
        'image/heic': 'heic',
        'image/heif': 'heif',
        'image/tiff': 'tif',
        'image/x-icon': 'ico',
        'image/vnd.microsoft.icon': 'ico',
        'image/svg+xml': 'svg'
    };

    var DATA_ATTRS = ['data-src', 'data-original-src', 'data-iurl', 'data-lazy-src', 'data-actualsrc'];

    /* ---------------- URL 规范化 ---------------- */

    function absolutize(url, baseUrl) {
        var s = String(url == null ? '' : url).trim();
        if (!s) { return ''; }
        // 伪协议一律丢弃（javascript:void(0)、about:blank、mailto:…）
        if (/^(javascript|about|mailto|tel|blob):/i.test(s)) { return ''; }
        try {
            return new URL(s, baseUrl || undefined).href;
        } catch (e) { /* 相对地址且无 base */ }
        if (/^(https?:|data:)/i.test(s)) { return s; }
        return '';
    }

    function isDataUri(url) {
        return /^data:/i.test(String(url || ''));
    }

    function isSvgUrl(url) {
        var s = String(url || '');
        if (/^data:image\/svg\+xml/i.test(s)) { return true; }
        return /\.svg(?:[?#]|$)/i.test(s);
    }

    function isPlaceholderUrl(url) {
        var s = String(url || '').trim().toLowerCase();
        if (!s) { return true; }
        if (/(?:^|[/_.\-?&=])(?:placeholder|loading|spacer|transparent|blank|1x1|pixel)(?:[/_.\-?&=]|$)/.test(s)) {
            return true;
        }
        return /blank\.(?:gif|png)(?:[?#]|$)/.test(s);
    }

    function extFromUrl(url) {
        var s = String(url || '').split(/[?#]/)[0];
        var m = s.match(/\.([a-z0-9]{2,5})$/i);
        return m ? m[1].toLowerCase() : '';
    }

    function extFromContentType(ct) {
        var s = String(ct || '').split(';')[0].trim().toLowerCase();
        return CT_EXT[s] || '';
    }

    /**
     * 「大概是图片」：data:image/*、位图扩展名、或无扩展名的 http(s) 地址。
     * 明确非图（.html/.js/.mp4…）与 svg 返回 false。
     */
    function isProbablyImage(url) {
        var s = String(url || '').trim();
        if (!s) { return false; }
        if (isDataUri(s)) { return /^data:image\//i.test(s) && !isSvgUrl(s); }
        if (!/^https?:\/\//i.test(s)) { return false; }
        if (isSvgUrl(s)) { return false; }
        var ext = extFromUrl(s);
        if (!ext) { return true; }   // 动态图片地址（/img?id=1）无法从 URL 判断
        return !!IMAGE_EXT[ext];
    }

    /* ---------------- srcset ---------------- */

    /**
     * 取 srcset 里尺寸最大的一项（w 优先，其次 x，无描述符取最后一项）。
     * @returns {string} 绝对 URL；解析不出时返回 ''
     */
    function pickLargestSrcset(srcset, baseUrl) {
        var raw = String(srcset || '').trim();
        if (!raw) { return ''; }
        var parts = raw.split(',');
        var bestW = -1, bestWurl = '', bestX = -1, bestXurl = '', last = '';
        for (var i = 0; i < parts.length; i++) {
            var seg = parts[i].trim();
            if (!seg) { continue; }
            var tokens = seg.split(/\s+/);
            var url = tokens[0];
            if (!url || url === ',') { continue; }
            last = url;
            var desc = tokens[1] || '';
            var m = desc.match(/^(\d+(?:\.\d+)?)w$/i);
            if (m) {
                var w = parseFloat(m[1]);
                if (w > bestW) { bestW = w; bestWurl = url; }
                continue;
            }
            m = desc.match(/^(\d+(?:\.\d+)?)x$/i);
            if (m) {
                var x = parseFloat(m[1]);
                if (x > bestX) { bestX = x; bestXurl = url; }
            }
        }
        var pick = bestWurl || bestXurl || last;
        return pick ? absolutize(pick, baseUrl) : '';
    }

    /* ---------------- 尺寸 ---------------- */

    function sizeOf(img) {
        if (!img) { return { w: 0, h: 0 }; }
        var nw = Number(img.naturalWidth) || 0;
        var nh = Number(img.naturalHeight) || 0;
        if (nw > 0 && nh > 0) { return { w: nw, h: nh }; }
        var w = 0, h = 0;
        try {
            w = parseInt(img.getAttribute && img.getAttribute('width'), 10) || 0;
            h = parseInt(img.getAttribute && img.getAttribute('height'), 10) || 0;
        } catch (e) { /* ignore */ }
        if (!w) { w = Number(img.width) || 0; }
        if (!h) { h = Number(img.height) || 0; }
        return { w: w, h: h };
    }

    /* ---------------- 候选解析 ---------------- */

    function baseOf(doc) {
        if (doc) {
            if (doc.baseURI) { return doc.baseURI; }
            if (doc.location && doc.location.href) { return doc.location.href; }
            if (doc.URL) { return doc.URL; }
        }
        return (typeof location !== 'undefined' && location.href) ? location.href : '';
    }

    function closestLink(img) {
        var a = null;
        try {
            if (img.closest) { a = img.closest('a[href]'); }
        } catch (e) { a = null; }
        if (a) { return a; }
        // 兜底：手工向上走（优先 closest; 这里覆盖极少见的伪元素对象）
        var node = img.parentElement;
        var guard = 0;
        while (node && guard < 12) {
            if (String(node.tagName || '').toUpperCase() === 'A' && node.getAttribute && node.getAttribute('href')) {
                return node;
            }
            node = node.parentElement;
            guard++;
        }
        return null;
    }

    /** 从 [data-ri] 的 JSON/文本里挖原图 URL（Google Images 形态） */
    function urlsFromDataRi(raw, baseUrl) {
        var out = [];
        var text = String(raw == null ? '' : raw).trim();
        if (!text) { return out; }
        var obj = null;
        try { obj = JSON.parse(text); } catch (e) { obj = null; }
        if (obj && typeof obj === 'object') {
            var preferred = ['ou', 'origUrl', 'original', 'src', 'url'];
            for (var i = 0; i < preferred.length; i++) {
                var v = obj[preferred[i]];
                if (typeof v === 'string' && v) { out.push(v); }
            }
            // 单层扁平对象里的其它字符串字段兜底
            for (var k in obj) {
                if (!Object.prototype.hasOwnProperty.call(obj, k)) { continue; }
                if (preferred.indexOf(k) >= 0) { continue; }
                var val = obj[k];
                if (typeof val === 'string' && /^(https?:)?\/\//i.test(val)) { out.push(val); }
            }
        }
        // JSON 里嵌在别的字段/转义串里的图片绝对地址（先还原 JSON 的 \/ 转义）
        var scan = text.replace(/\\\//g, '/');
        var m = scan.match(/https?:\/\/[^"'\s\\]+?\.(?:jpe?g|png|webp|gif|avif)(?:\?[^"'\s\\]*)?/ig);
        if (m) { out = out.concat(m); }
        var seen = {};
        var res = [];
        for (var j = 0; j < out.length; j++) {
            var abs = absolutize(out[j], baseUrl);
            if (!abs || seen[abs]) { continue; }
            seen[abs] = 1;
            res.push(abs);
        }
        return res;
    }

    function dataRiCandidates(img, baseUrl) {
        var node = img && img.parentElement;
        var depth = 0;
        while (node && depth < 6) {
            var raw = null;
            try { raw = node.getAttribute && node.getAttribute('data-ri'); } catch (e) { raw = null; }
            if (raw) {
                var urls = urlsFromDataRi(raw, baseUrl);
                if (urls.length) { return urls; }
            }
            node = node.parentElement;
            depth++;
        }
        return [];
    }

    function attr(img, name) {
        try {
            if (!img.getAttribute) { return ''; }
            var v = img.getAttribute(name);
            return typeof v === 'string' ? v : '';
        } catch (e) { return ''; }
    }

    /**
     * 五级优先级候选（PLAN §2.3）：
     *   ① a[href] ② srcset 最大 ③ data-* ④ 祖先 [data-ri] ⑤ currentSrc/src
     * @returns {string[]} 绝对 URL，去重，按优先级排序
     */
    function collectCandidates(img, doc) {
        if (!img) { return []; }
        var base = baseOf(doc);
        var out = [];
        var seen = Object.create(null);

        function add(raw) {
            var abs = absolutize(raw, base);
            if (!abs || seen[abs]) { return; }
            if (isPlaceholderUrl(abs)) { return; }
            if (isSvgUrl(abs)) { return; }
            seen[abs] = 1;
            out.push(abs);
        }

        try {
            // ① 被链接包裹
            var a = closestLink(img);
            if (a) {
                var href = attr(a, 'href');
                if (href && href.charAt(0) !== '#') { add(href); }
            }
            // ② srcset 最大项
            add(pickLargestSrcset(attr(img, 'srcset') || img.srcset || '', base));
            // ③ 懒加载原始地址
            for (var i = 0; i < DATA_ATTRS.length; i++) {
                add(attr(img, DATA_ATTRS[i]));
            }
            // ④ 父级 data-ri 元数据
            var meta = dataRiCandidates(img, base);
            for (var j = 0; j < meta.length; j++) { add(meta[j]); }
            // ⑤ 页面实际显示
            add(img.currentSrc || '');
            add(attr(img, 'src'));
            add(img.src || '');
        } catch (e) { /* 单级异常不影响其它级 */ }

        return out;
    }

    /* ---------------- 扫描 ---------------- */

    /**
     * 扫描文档内 <img>，返回通过过滤的条目。
     * @param {Document} doc
     * @param {object} opts {minWidth, minHeight, dedupe, limit}
     * @returns {Array<{el, url, w, h, ok, candidates}>}
     */
    /**
     * 取图片的显示尺寸（CSS 像素）。优先 getBoundingClientRect（含 transform 缩放）。
     * @returns {{w:number, h:number}} 未布局/隐藏时为 0
     */
    function shownSize(el) {
        var w = 0;
        var h = 0;
        var measured = false;
        try {
            if (el.getBoundingClientRect) {
                var r = el.getBoundingClientRect();
                w = Math.round(r.width);
                h = Math.round(r.height);
                measured = true;
            }
        } catch (e) { /* 忽略 */ }
        if (measured && (!w || !h)) {
            w = el.clientWidth || 0;
            h = el.clientHeight || 0;
        }
        // 没有布局信息的环境（Node 单测的假 DOM、或 display:none 的子元素）
        // 退回原始像素：不能因为「量不到」就把图判死，否则单测和懒加载场景全挂。
        if (!w || !h) {
            w = Number(el.naturalWidth) || 0;
            h = Number(el.naturalHeight) || 0;
        }
        return { w: w, h: h };
    }

    /**
     * 这张图是否值得下载（悬停与面板共用同一套规则，避免两边口径不一致）。
     * @param {Element} el img
     * @param {object} opts { minNatural, minShow, maxAspect }
     */
    function isWorthDownloading(el, opts) {
        if (!el || el.tagName !== 'IMG') { return false; }
        var o = opts || {};
        var minNatural = o.minNatural == null ? MIN_SIZE : Number(o.minNatural);
        var minShow = o.minShow == null ? MIN_SHOW : Number(o.minShow);
        var maxAspect = o.maxAspect == null ? MAX_ASPECT : Number(o.maxAspect);
        var nw = Number(el.naturalWidth) || 0;
        var nh = Number(el.naturalHeight) || 0;
        if (nw < minNatural || nh < minNatural) { return false; }
        var sh = shownSize(el);
        if (sh.w <= 0 || sh.h <= 0) { return false; }
        if (Math.min(sh.w, sh.h) < minShow) { return false; }
        // 长宽比过大的条状图（400×2 分隔线、横幅装饰）不认
        var ratio = Math.max(sh.w, sh.h) / Math.min(sh.w, sh.h);
        if (ratio > maxAspect) { return false; }
        return true;
    }

    function scanImages(doc, opts) {
        if (!doc || !doc.querySelectorAll) { return []; }
        var o = opts || {};
        var minW = o.minWidth == null ? MIN_SIZE : Number(o.minWidth);
        var minH = o.minHeight == null ? MIN_SIZE : Number(o.minHeight);
        var dedupe = o.dedupe !== false;
        var limit = Number(o.limit) || 0;
        var base = baseOf(doc);
        var list;
        try { list = doc.querySelectorAll('img'); } catch (e) { return []; }
        if (!list) { return []; }

        var out = [];
        var seen = Object.create(null);
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            try {
                // 未加载完/加载失败（natural 为 0）一律跳过：宽高属性可能只是占位
                var nw = Number(el.naturalWidth) || 0;
                var nh = Number(el.naturalHeight) || 0;
                if (nw <= 0 || nh <= 0) { continue; }
                var url = absolutize(el.currentSrc || el.src || attr(el, 'src'), base);
                if (!url) { continue; }
                if (isDataUri(url) || isSvgUrl(url) || isPlaceholderUrl(url)) { continue; }
                if (nw < minW || nh < minH) { continue; }
                // 显示尺寸过滤：小图标/按钮/表情不进列表（默认开，可传 checkShow:false 关掉）
                if (o.checkShow !== false && !isWorthDownloading(el, {
                    minNatural: minW, minShow: o.minShow, maxAspect: o.maxAspect
                })) { continue; }
                if (dedupe && seen[url]) { continue; }
                seen[url] = 1;
                out.push({
                    el: el,
                    url: url,
                    w: nw,
                    h: nh,
                    ok: true,
                    candidates: collectCandidates(el, doc)
                });
                if (limit > 0 && out.length >= limit) { break; }
            } catch (e) { /* 单张失败跳过 */ }
        }
        return out;
    }

    /* ---------------- 尺寸档位（I4 清单面板用） ---------------- */

    /* 按「短边」判定档位：竖图 600×2000 应算「中」，不能按宽或长边算成「大」。 */
    var TIERS = [
        { key: 'small', label: '小', min: 100 },
        { key: 'medium', label: '中', min: 500 },
        { key: 'large', label: '大', min: 1200 },
        { key: 'huge', label: '超大', min: 2000 }
    ];

    function shortSide(w, h) {
        var a = Number(w) || 0;
        var b = Number(h) || 0;
        if (a <= 0 || b <= 0) { return 0; }
        return Math.min(a, b);
    }

    /** 自定义阈值合法性：正整数才有效，否则返回 0 */
    function parseTierMin(raw) {
        var n = parseInt(String(raw == null ? '' : raw).trim(), 10);
        if (!isFinite(n) || n <= 0) { return 0; }
        return n;
    }

    /**
     * 每个档位的命中数。
     * items: [{w, h}] 或 scanImages 结果；返回 { small: n, medium: n, large: n, huge: n, total: n }
     */
    function tierCounts(items) {
        var out = { small: 0, medium: 0, large: 0, huge: 0, total: 0 };
        var arr = items || [];
        for (var i = 0; i < arr.length; i++) {
            var ss = shortSide(arr[i] && arr[i].w, arr[i] && arr[i].h);
            if (!ss) { continue; }
            out.total++;
            for (var j = 0; j < TIERS.length; j++) {
                if (ss >= TIERS[j].min) { out[TIERS[j].key]++; }
            }
        }
        return out;
    }

    /** 按档位过滤：min 为短边下限（0 表示不过滤） */
    function filterByTier(items, min) {
        var m = Number(min) || 0;
        var arr = items || [];
        if (m <= 0) { return arr.slice(); }
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var ss = shortSide(arr[i] && arr[i].w, arr[i] && arr[i].h);
            if (ss >= m) { out.push(arr[i]); }
        }
        return out;
    }

    /** URL 关键词过滤（大小写不敏感子串）；关键词为空则原样返回 */
    function filterByKeyword(items, kw) {
        var k = String(kw == null ? '' : kw).trim().toLowerCase();
        var arr = items || [];
        if (!k) { return arr.slice(); }
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var u = String((arr[i] && arr[i].url) || '').toLowerCase();
            if (u.indexOf(k) >= 0) { out.push(arr[i]); }
        }
        return out;
    }

    /** 排序：'page' 页面顺序（稳定）/ 'size-desc' / 'size-asc' */
    function sortItems(items, mode) {
        var arr = (items || []).slice();
        if (mode !== 'size-desc' && mode !== 'size-asc') { return arr; }
        var dir = mode === 'size-desc' ? -1 : 1;
        arr.sort(function (a, b) {
            var sa = shortSide(a && a.w, a && a.h);
            var sb = shortSide(b && b.w, b && b.h);
            if (sa !== sb) { return (sa - sb) * dir; }
            var la = Math.max(Number(a && a.w) || 0, Number(a && a.h) || 0);
            var lb = Math.max(Number(b && b.w) || 0, Number(b && b.h) || 0);
            return (la - lb) * dir;
        });
        return arr;
    }

    /* ---------------- 设置项（I5） ---------------- */

    /* 缺省值。改这里等于改「恢复默认」的目标，也等于所有读取方的兜底。 */
    var DEFAULT_SETTINGS = {
        imgHover: true,
        imgBatch: true,
        /* 右下角浮标默认关：批量下载是低频操作，不该占常驻 UI。
         * 业界（Image Downloader / Image Harvest）都把批量放在扩展自己的界面里，
         * 页面上不放常驻入口。需要时点扩展 → 「抓图」即可，设置里可开回。
         * 依据见 docs/RESEARCH-COMPETITOR-IMAGE.md §2。 */
        imgPanel: false,
        imgMinSize: 100,
        imgPreferOriginal: true,
        imgConcurrency: 3,
        imgBatchLimit: 200,
        imgHotkeys: true,
        imgHoverDelay: 300
    };

    /* 每个数值项的范围。超出就夹到边界，不静默丢弃（用户填 9999 应得到 4096 而不是 100）。 */
    var RANGES = {
        imgMinSize: [16, 4096],
        imgConcurrency: [1, 8],
        imgBatchLimit: [1, 2000],
        imgHoverDelay: [0, 1500]
    };

    /**
     * 把任意输入解析成 [min,max] 内的整数。
     * 非法（空/非数字）返回 fallback；超范围夹到边界。
     */
    function parseIntRange(raw, min, max, fallback) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) { return fallback; }
        var n = parseInt(s, 10);
        if (!isFinite(n) || isNaN(n)) { return fallback; }
        if (n < min) { return min; }
        if (n > max) { return max; }
        return n;
    }

    /** 校验单项，返回 {ok, value, reason}。UI 用它决定要不要红字。 */
    function validateSetting(key, raw) {
        if (!(key in DEFAULT_SETTINGS)) {
            return { ok: false, value: null, reason: '未知设置项' };
        }
        var def = DEFAULT_SETTINGS[key];
        if (typeof def === 'boolean') {
            return { ok: true, value: !!raw, reason: '' };
        }
        var rg = RANGES[key] || [0, 999999];
        var s = String(raw == null ? '' : raw).trim();
        if (!s) { return { ok: false, value: def, reason: '不能为空' }; }
        if (!/^-?\d+$/.test(s)) { return { ok: false, value: def, reason: '请输入整数' }; }
        var n = parseInt(s, 10);
        if (n < rg[0] || n > rg[1]) {
            return { ok: false, value: def, reason: '范围 ' + rg[0] + '–' + rg[1] };
        }
        return { ok: true, value: n, reason: '' };
    }

    /**
     * 把外部传入的设置合并到缺省值上。
     * · 缺的键补默认
     * · 数值键夹到范围
     * · 布尔键强制布尔
     * · 未知键保留（别丢用户数据，也方便将来加项）
     */
    function mergeSettings(raw) {
        var out = {};
        var k;
        for (k in DEFAULT_SETTINGS) {
            if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) {
                out[k] = DEFAULT_SETTINGS[k];
            }
        }
        var src = raw || {};
        for (k in src) {
            if (!Object.prototype.hasOwnProperty.call(src, k)) { continue; }
            if (k in DEFAULT_SETTINGS) {
                var def = DEFAULT_SETTINGS[k];
                if (typeof def === 'boolean') {
                    out[k] = !!src[k];
                } else {
                    var rg = RANGES[k] || [0, 999999];
                    out[k] = parseIntRange(src[k], rg[0], rg[1], def);
                }
            } else {
                out[k] = src[k];
            }
        }
        return out;
    }

    return {
        MIN_SIZE: MIN_SIZE,
        MIN_SHOW: MIN_SHOW,
        MAX_ASPECT: MAX_ASPECT,
        shownSize: shownSize,
        isWorthDownloading: isWorthDownloading,
        IMAGE_EXT: IMAGE_EXT,
        DEFAULT_SETTINGS: DEFAULT_SETTINGS,
        RANGES: RANGES,
        parseIntRange: parseIntRange,
        validateSetting: validateSetting,
        mergeSettings: mergeSettings,
        TIERS: TIERS,
        shortSide: shortSide,
        parseTierMin: parseTierMin,
        tierCounts: tierCounts,
        filterByTier: filterByTier,
        filterByKeyword: filterByKeyword,
        sortItems: sortItems,
        absolutize: absolutize,
        isDataUri: isDataUri,
        isSvgUrl: isSvgUrl,
        isPlaceholderUrl: isPlaceholderUrl,
        isProbablyImage: isProbablyImage,
        extFromUrl: extFromUrl,
        extFromContentType: extFromContentType,
        pickLargestSrcset: pickLargestSrcset,
        sizeOf: sizeOf,
        collectCandidates: collectCandidates,
        scanImages: scanImages
    };
});
