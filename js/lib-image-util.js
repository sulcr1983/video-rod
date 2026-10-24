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

    return {
        MIN_SIZE: MIN_SIZE,
        IMAGE_EXT: IMAGE_EXT,
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
