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
    /* 显示尺寸门槛（2026-11-05 v2）：
     * 历史 48 → 600（2026-10-25 用户要「小图别冒按钮」）。
     * 但「宽高都 ≥600」把横图全挡了 —— 微博正文图常见 542×305、B站封面 640×360，
     * 高度永远到不了 600，用户反馈「很多图片点不到按钮」。
     * 现改为：**长边 ≥ MIN_SHOW(500) 且短边 ≥ MIN_SHORT(200)**。
     *   542×305 → 长 542 短 305 ✅    52×52 头像 ❌    800×3 装饰条（短边 3）❌
     * 判的是**显示尺寸**不是原始像素：页面上看着够大才值得下，缩略图列表不打扰。 */
    var MIN_SHOW = 500;
    var MIN_SHORT = 200;
    /* 清单面板的「显示尺寸」门槛：只用来挡图标/按钮，与 imgMinSize 无关。
     * 面板判的是**原始像素**（imgMinSize），显示尺寸这层固定 48 就够 ——
     * 若跟着 imgMinSize 走，设 1200 时会把「原图 1200 但显示 160px」的图全挡掉。 */
    var PANEL_MIN_SHOW = 48;
    /* 细长装饰条的门槛：用「短边/长边」比来判断，不用面积。
     * 面积法会误杀正常的方形图（600×600=36万 比 1200×6=7200 还大，
     * 任何固定面积阈值都同时拦不住细条又放过方图 —— 踩过两次）。
     * 短边 ≥ 200 + 长边 ≥ 500 已挡掉绝大多数装饰；这里再挡「长宽比 > 6:1」的条状图。 */
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
     *
     * ⚠️ 无扩展名不能一概当成图片（2026-11-07 实测）：
     * 花瓣的「详情页」地址 `https://huaban.com/pins/6019884` 也没有扩展名，
     * 于是被判成图片，`bestCandidate` 取它当原图 → 大图预览**加载不出来**
     * （用户截图里「候选链: https://huaban.com/pins/6019884…」就是这个）。
     * 所以先按路径特征排除「明显的网页」，再退回「无扩展名当图片」的宽容策略。
     */
    var PAGE_PATH_RE = /(^|\/)(?:pins?|photos?|notes?|status|posts?|articles?|detail|watch|video|album|board|user|profile|space|explore|discovery|search|tag|topic)(?:\/|$)/i;

    function looksLikePage(url) {
        var s = String(url || '');
        var path = '';
        try { path = new URL(s).pathname || ''; } catch (e) {
            path = s.split(/[?#]/)[0];
        }
        if (!path || path === '/') { return true; }
        /* 末段是纯数字 / uuid，通常就是详情页 id（/pins/6019884、/note/abc123） */
        var last = path.split('/').filter(Boolean).pop() || '';
        if (/^\d{3,}$/.test(last)) { return true; }
        return PAGE_PATH_RE.test(path);
    }

    function isProbablyImage(url) {
        var s = String(url || '').trim();
        if (!s) { return false; }
        if (isDataUri(s)) { return /^data:image\//i.test(s) && !isSvgUrl(s); }
        if (!/^https?:\/\//i.test(s)) { return false; }
        if (isSvgUrl(s)) { return false; }
        var ext = extFromUrl(s);
        if (ext) { return !!IMAGE_EXT[ext]; }
        /* 无扩展名：像网页路径的一律排除，其余按「动态图片地址」宽容放行 */
        if (looksLikePage(s)) { return false; }
        return true;   // 例如 /img?id=1、hbimg 的 hash 结尾
    }

    /**
     * 从候选链里挑「最可能是原图」的那一条。
     *
     * 为什么要抽成公共函数：这段逻辑原先只写在 `image-page.js` 里，
     * 结果**侧边栏批量用 it.url（页面显示的 640 预览版）、单张下载用 it.orig**，
     * 同一张图在两条路径下落盘尺寸不同（2026-11-08 苏哥报「嗅探不准确」）。
     * 现在统一走这里，三条批量入口和单张下载口径一致。
     *
     * 关键坑：候选链第 ① 级是包裹图片的 `a[href]`，那**可能是详情页而不是图片**。
     * 所以必须先用 isProbablyImage 过滤，不能盲取首项 ——
     * 否则会把网页存成图片（「下载到的不是自己想要的」最常见成因）。
     *
     * @param {string[]} candidates 候选链（已按大图优先排序）
     * @param {string} [fallback] 全都不像图片时的兜底（通常是页面显示地址）
     * @returns {string}
     */
    function bestCandidate(candidates, fallback) {
        var list = Array.isArray(candidates) ? candidates : [];
        var fb = '';
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (!c) { continue; }
            if (c.indexOf('data:') === 0) {
                if (!fb) { fb = c; }
                continue;
            }
            var ok = false;
            try { ok = isProbablyImage(c); } catch (e) { ok = false; }
            if (ok) { return c; }
            if (!fb) { fb = c; }
        }
        /* 一个都不像图片时退回兜底：至少是页面真正渲染出来的那张 */
        return fb || String(fallback || '');
    }

    /* ---------------- srcset ---------------- */

    /**
     * 取 srcset 里尺寸最大的一项（w 优先，其次 x，无描述符取最后一项）。
     * @returns {string} 绝对 URL；解析不出时返回 ''
     */
    /* 各家 CDN 用查询参数降分辨率的写法（社区通用做法，IDC 2.8 也做这条）：
     *   微博/知乎  imageView2/2/w/300、?w=300
     *   通用       width/height/size/quality/resize/scale/crop
     *   阿里 OSS   x-oss-process=image/resize,w_300
     *   七牛       ?imageView2/2/w/300
     * 去掉这些参数往往就能拿到原图；有些站点还会在路径里写尺寸（/300x300/），
     * 那部分风险高，先不动，只处理查询参数。
     */
    var RESIZE_KEYS = [
        'w', 'h', 'width', 'height', 'size', 'quality', 'q',
        'resize', 'scale', 'crop', 'fit', 'thumb', 'thumbnail',
        'imageview2', 'imageview', 'x-oss-process', 'x-oss-image',
        'type', 'mode', 'interlace', 'sharpen', 'watermark'
    ];
    var RESIZE_RE = new RegExp(
        '^(?:' + RESIZE_KEYS.map(function (k) {
            return k.replace(/[-]/g, '\\-');
        }).join('|') + ')$', 'i');

    /**
     * 去掉 URL 查询串里「降分辨率」相关的参数，尝试拿到原图。
     * @returns {string} 与原地址不同才返回，否则返回空串
     */
    function stripResizeParams(url) {
        var s = String(url || '');
        if (!/^https?:/i.test(s)) { return ''; }
        var qAt = s.indexOf('?');
        if (qAt < 0) { return ''; }
        var head = s.slice(0, qAt);
        var query = s.slice(qAt + 1);
        if (!query) { return ''; }

        var kept = [];
        var dropped = 0;
        var parts = query.split('&');
        for (var i = 0; i < parts.length; i++) {
            var seg = parts[i];
            if (!seg) { continue; }
            var eq = seg.indexOf('=');
            var key = eq < 0 ? seg : seg.slice(0, eq);
            var bare = key.split('?')[0];
            // 七牛/又拍这类写法把参数塞进键里：imageView2/2/w/300、!/fw/300
            // 只匹配「整键」会漏，取第一个 / 之前的部分做前缀判断。
            // 只有「键里真的含 /」时才做前缀判断（七牛 imageView2/2/w/300）；
            // 否则 quality=80 这类普通键会被 head 误判成 quality 而删掉（踩过）。
            var slashAt = bare.indexOf('/');
            var keyHead = slashAt > 0 ? bare.slice(0, slashAt) : '';
            if (RESIZE_RE.test(bare) || (keyHead && RESIZE_RE.test(keyHead))) {
                dropped++;
                continue;
            }
            kept.push(seg);
        }
        if (!dropped) { return ''; }
        var out = kept.length ? (head + '?' + kept.join('&')) : head;
        return out === s ? '' : out;
    }

    /**
     * 从 <picture> 的兄弟 <source> 里挑最大的一张。
     * 响应式站点的典型结构：
     *   <picture>
     *     <source srcset="big.webp 1200w, mid.webp 800w" type="image/webp">
     *     <img src="small.jpg">        ← 只有兜底小图
     *   </picture>
     * 只看 img.src 会拿到最小的那张。
     *
     * @returns {string} 绝对地址；没有则空串
     */
    function pickLargestPictureSource(img, baseUrl) {
        if (!img || !img.parentNode) { return ''; }
        var parent = img.parentNode;
        if (!parent || String(parent.tagName || '').toUpperCase() !== 'PICTURE') { return ''; }
        var sources;
        try { sources = parent.querySelectorAll('source'); } catch (e) { return ''; }
        if (!sources || !sources.length) { return ''; }

        var best = '';
        var bestPixels = -1;
        for (var i = 0; i < sources.length; i++) {
            var ss = attr(sources[i], 'srcset');
            if (!ss) { continue; }
            var one = pickLargestSrcset(ss, baseUrl);
            if (!one) { continue; }
            // 用 srcset 里的最大 w 值做比较；拿不到就用序号靠前的
            var pixels = largestSrcsetPixels(ss);
            if (pixels > bestPixels) { bestPixels = pixels; best = one; }
        }
        return best;
    }

    /** srcset 里最大的 w 描述符；没有 w 就用 x * 1000 近似 */
    function largestSrcsetPixels(srcset) {
        var parts = String(srcset || '').split(',');
        var max = 0;
        for (var i = 0; i < parts.length; i++) {
            var t = parts[i].trim().split(/\s+/);
            var d = String(t[1] || '');
            var m = d.match(/^([\d.]+)(w|x)$/i);
            if (!m) { continue; }
            var n = parseFloat(m[1]) || 0;
            if (m[2].toLowerCase() === 'x') { n = n * 1000; }
            if (n > max) { max = n; }
        }
        return max;
    }

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
            // ②b <picture> 里的 <source srcset>：img 自身常常只有兜底小图，
            //    真正的大图写在兄弟 source 上（响应式站点普遍这么做）。
            add(pickLargestPictureSource(img, base));
            // ③ 懒加载原始地址
            for (var i = 0; i < DATA_ATTRS.length; i++) {
                add(attr(img, DATA_ATTRS[i]));
            }
            // ④ 父级 data-ri 元数据（不能丢：有些站点把原图地址写在祖先属性里）
            var meta = dataRiCandidates(img, base);
            for (var j = 0; j < meta.length; j++) { add(meta[j]); }
            // ⑤ 页面实际显示（必须先加进来，下面的派生才有对象可派生）
            add(img.currentSrc || '');
            add(attr(img, 'src'));
            add(img.src || '');
            // ⑥ 去掉 resize 参数拿原图（很多 CDN 用 ?w=300 降分辨率）
            //    放在最后，但整体顺序仍是「大图优先」：
            //    派生结果会插到对应原地址之后，校验时先试大图、失败再退回显示地址。
            var derived = out.slice();
            for (var k = 0; k < derived.length; k++) {
                var big = stripResizeParams(derived[k]);
                if (big) { add(big); }
            }
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
        // 短边硬底线（挡图标、头像、细装饰条）
        if (Math.min(sh.w, sh.h) < MIN_SHORT) { return false; }
        // 长边门槛（用户可配 imgHoverMinSize；挡缩略图列表里的中小图）
        if (Math.max(sh.w, sh.h) < minShow) { return false; }
        // 长宽比过大的条状图（400×2 分隔线、横幅装饰）不认
        var ratio = Math.max(sh.w, sh.h) / Math.min(sh.w, sh.h);
        if (ratio > maxAspect) { return false; }
        return true;
    }

    /**
     * 从 CSS background-image 里抠出图片地址。
     * 站点常把封面做成 div 的背景图（img 标签里根本没有），只看 <img> 会整片漏掉。
     *
     * 只取一个 url()：多层背景里第一层才是可见内容图，后面的多是渐变/装饰。
     * 也顺手处理 -webkit-image-set 与 image-set（取第一项）。
     *
     * @param {string} css background-image 的 computed 值
     * @returns {string} 绝对地址；没有则空串
     */
    function parseBgImage(css, baseUrl) {
        var v = String(css || '');
        if (!v || v === 'none') { return ''; }
        // image-set(...) 里也是 url()，统一按 url() 抓第一个
        var m = v.match(/url\(\s*["']?([^"')]+)["']?\s*\)/i);
        if (!m) { return ''; }
        var raw = m[1].trim();
        if (!raw || /^data:image\/svg/i.test(raw)) { return ''; }
        return absolutize(raw, baseUrl);
    }

    /**
     * 扫描页面上「用背景图显示」的元素。
     * 与 <img> 共用同一套尺寸规则：容器显示尺寸够大才认。
     *
     * 性能：getComputedStyle 会强制样式计算，所以先按标签白名单 + 面积预筛，
     * 只对「可能是内容容器」的元素取值，避免在长页面上把主线程卡死。
     */
    function scanBackgrounds(doc, opts) {
        if (!doc || !doc.querySelectorAll) { return []; }
        var o = opts || {};
        var minShow = o.minShow == null ? MIN_SHOW : Number(o.minShow);
        var maxAspect = o.maxAspect == null ? MAX_ASPECT : Number(o.maxAspect);
        var dedupe = o.dedupe !== false;
        var limit = Number(o.limit) || 0;
        var base = baseOf(doc);
        var win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
        if (!win || !win.getComputedStyle) { return []; }

        var SEL = 'div,section,article,a,span,figure,li,td,header';
        var nodes;
        try { nodes = doc.querySelectorAll(SEL); } catch (e) { return []; }
        if (!nodes) { return []; }

        var out = [];
        var seen = Object.create(null);
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            try {
                // 面积预筛：小容器直接跳过，省掉昂贵的 getComputedStyle
                var box = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
                if (!box || box.width < minShow || box.height < minShow) { continue; }
                var dw = Math.round(box.width);
                var dh = Math.round(box.height);
                var ratio = Math.max(dw, dh) / Math.min(dw, dh);
                if (ratio > maxAspect) { continue; }

                var css = win.getComputedStyle(el).backgroundImage;
                var url = parseBgImage(css, base);
                if (!url) { continue; }
                if (isDataUri(url) || isSvgUrl(url) || isPlaceholderUrl(url)) { continue; }
                if (dedupe && seen[url]) { continue; }
                seen[url] = 1;
                out.push({
                    el: el,
                    url: url,
                    w: dw,
                    h: dh,
                    ok: true,
                    bg: true,                       // 标记来源，面板可区分
                    candidates: [url]
                });
                if (limit > 0 && out.length >= limit) { break; }
            } catch (e) { /* 单个元素失败跳过 */ }
        }
        return out;
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
        var pending = 0;          // 未解码数量，供调用方决定要不要等
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            try {
                /* 未解码时 naturalWidth 为 0 —— 这在懒加载站点上是常态而不是异常：
                 * 实测花瓣首页 557 张 <img> 里 540 张 naturalWidth=0（还没进视口）。
                 * 早先一律 `continue`，于是「本页 80 张图」只能扫出 6 张。
                 *
                 * 处理原则：**没解码不等于不存在**。
                 *   · 有 width/height 属性 → 用属性当尺寸依据（占位图常带真实宽高）
                 *   · 两者都没有 → 记进 pending，仍把 URL 收进来（尺寸标 0），
                 *     由调用方决定是否展示为「尺寸未知」，而不是直接丢掉。 */
                var nw = Number(el.naturalWidth) || 0;
                var nh = Number(el.naturalHeight) || 0;
                var undecoded = (nw <= 0 || nh <= 0);
                if (undecoded) {
                    var aw = Number(el.getAttribute('width')) || 0;
                    var ah = Number(el.getAttribute('height')) || 0;
                    if (aw > 0 && ah > 0) { nw = aw; nh = ah; }
                    else { pending++; }
                }
                var url = absolutize(el.currentSrc || el.src || attr(el, 'src'), base);
                if (!url) { continue; }
                if (isDataUri(url) || isSvgUrl(url) || isPlaceholderUrl(url)) { continue; }
                /* 尺寸已知才做门槛过滤；尺寸未知（懒加载且无属性）先放进来，
                 * 否则长页面上大半张图会被无声吞掉。 */
                var sized = (nw > 0 && nh > 0);
                if (sized && (nw < minW || nh < minH)) { continue; }
                // 显示尺寸过滤：小图标/按钮/表情不进列表（默认开，可传 checkShow:false 关掉）
                if (sized && o.checkShow !== false && !isWorthDownloading(el, {
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
                    undecoded: !sized,
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
    /**
     * 按关键字过滤 URL。
     *
     * 输入以 `/` 开头且以 `/` 结尾（可带 flags，如 `/sinaimg\.cn/i`）时按**正则**处理，
     * 否则按子串。不加开关：抓素材时「只要某域名的大图」用正则最直接，
     * 而多一个开关就多一份要解释的 UI（IDC 做了三模式，我们用这一个约定就够）。
     *
     * @param {Array} items [{url, ...}]
     * @param {string} kw 关键字或 /regex/flags
     */
    function filterByKeyword(items, kw) {
        var k = String(kw == null ? '' : kw).trim();
        var arr = items || [];
        if (!k) { return arr.slice(); }

        var re = null;
        if (k.length >= 2 && k.charAt(0) === '/') {
            var end = k.lastIndexOf('/');
            if (end > 0) {
                try {
                    re = new RegExp(k.slice(1, end), k.slice(end + 1));
                } catch (e) {
                    re = null;   // 正则写错就退回子串匹配，不要抛错让面板崩
                }
            }
        }

        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var u = String((arr[i] && arr[i].url) || '');
            if (re) {
                re.lastIndex = 0;
                if (re.test(u)) { out.push(arr[i]); }
            } else if (u.toLowerCase().indexOf(k.toLowerCase()) >= 0) {
                out.push(arr[i]);
            }
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
        /* 清单面板是否也扫 CSS 背景图。很多站点把封面做成 div 的 background-image，
         * 只看 <img> 会整片漏掉；但背景图扫描要 getComputedStyle，长页面上有开销，
         * 所以给一个可关的开关（默认开）。 */
        imgBgScan: true,
        imgMinSize: 100,
        imgPreferOriginal: true,
        imgConcurrency: 3,
        imgBatchLimit: 200,
        imgHotkeys: true,
        imgHoverDelay: 300,
        /* 悬停按钮的显示尺寸门槛（宽高都要 ≥ 此值）。可配是为了适配不同场景：
         * 有人只想要大图（600 甚至更高），有人在密集图墙里想放宽到 200。
         * 注意与 imgMinSize 是两个东西：那个判**原始像素**（面板用），
         * 这个判**显示尺寸**（悬停用）。 */
        imgHoverMinSize: 600,  // 长边门槛（ADR 定为 600，与 image-hover 的判定一致）
        /* 拖拽下载：把图拖到右下角接收区即存。默认开 —— 但只在真的开始拖图时才出 UI，
         * 平时完全不占页面（与浮标那种常驻 UI 不同）。 */
        imgDragDownload: true,
        /* 框选下载：必须按住 Alt 才生效，避免和站点自己的拖拽/选文字打架。 */
        imgBoxSelect: true,
        /* 图片过滤规则（域名 + 正则，命中即不进清单）。结构与语义见 js/img-filter.js。 */
        imgFilterRules: [],
        /* WEBP/AVIF → JPG：只在打包 ZIP 时按需转，不改变单张下载的原始字节。 */
        imgWebpToJpg: false,
        /* 侧边栏图片页的尺寸档位（短边阈值）。0 = 「全部」。
         * 与 imgMinSize(100) 是两个东西：那个是页面浮标/清单面板的门槛，
         * 这个是侧边栏列表自身的筛选，默认全显示（懒加载站点大量图尺寸未知）。 */
        imgTierMin: 0
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
                } else if (typeof def === 'number') {
                    /* 只有**数值型**默认值才做范围解析。
                     * 早先对所有非布尔项一律 parseIntRange，结果新加的
                     * 数组型 imgFilterRules 会被转成数字（规则全丢），
                     * 字符串项也会被吞成 NaN。 */
                    var rg = RANGES[k] || [0, 999999];
                    out[k] = parseIntRange(src[k], rg[0], rg[1], def);
                } else if (Array.isArray(def)) {
                    out[k] = Array.isArray(src[k]) ? src[k].slice() : def.slice();
                } else {
                    out[k] = (src[k] === undefined || src[k] === null) ? def : src[k];
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
        MIN_SHORT: MIN_SHORT,
        PANEL_MIN_SHOW: PANEL_MIN_SHOW,
        MAX_ASPECT: MAX_ASPECT,
        shownSize: shownSize,
        stripResizeParams: stripResizeParams,
        parseBgImage: parseBgImage,
        pickLargestPictureSource: pickLargestPictureSource,
        largestSrcsetPixels: largestSrcsetPixels,
        scanBackgrounds: scanBackgrounds,
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
        bestCandidate: bestCandidate,
        looksLikePage: looksLikePage,
        extFromUrl: extFromUrl,
        extFromContentType: extFromContentType,
        pickLargestSrcset: pickLargestSrcset,
        sizeOf: sizeOf,
        collectCandidates: collectCandidates,
        scanImages: scanImages
    };
});
