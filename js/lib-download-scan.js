/* ==========================================================
 * VRDownloadScan —— 页面「可下载文件」扫描与文件名清洗
 *
 * 来源（2026-11-07 逆向星愿浏览器上装的两个扩展，照搬成熟做法）：
 *
 *   ① Download Master（ameobllgfelffdengghkfoeagpohnhjk 2026.10.14.0）
 *      · content.js: retreiveDownloadableFiles()
 *          document.links 全量 + video[src] / audio[src] / source[src]
 *          / embed[src] / object[data]
 *      · utils.js: isExtensionLegal / getFileName / getFileNameFromUrl
 *          / sanitizeFilename / getDownloadFilename
 *      · handlers.js: applyCustomFilter() —— 子串 + /正则/ 语法
 *      · background.js: downloadQueue() —— 串行 + 300ms 间隔 + 去 filename 重试
 *      结论：人家不区分「图 / 视频 / 文档」，一律先扫出**所有带合法扩展名的地址**，
 *      再由过滤器交给用户挑。这正是我们缺的那块（我们只扫图）。
 *
 *   ② 图片下载器（flbolonkboilcbnohjlchlfgdalomdpl 4.0.0）
 *      · contentScript.js: y() 里除了 <img>/srcset/background-image，
 *        还拿 document.body.innerHTML 跑一条正则，把「只出现在源码里的图片地址」
 *        也捞出来（懒加载站点点开后才有的地址常属于这种情况）。
 *      · 同文件还处理 iframe：向子文档注入 iFrame.js，用 postMessage 收回结果。
 *      · 尺寸门槛用的是 naturalWidth/naturalHeight < 96 才丢（很宽松）。
 *
 * 为什么值得抄：这两条收集通道（源码正则、全链接扫描）我们都没有，
 * 而它们恰是「页面上明明有文件、扩展却扫不到」的主要成因。
 *
 * 约定：
 *   - 纯逻辑，不碰 chrome.*、不写 DOM、不发请求
 *   - 浏览器挂 self.VRDownloadScan；Node 走 module.exports
 *   - ES5 为主（与 lib-image-util.js 保持一致）
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRDownloadScan = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    /* ---------------- 扩展名白名单 ---------------- */

    /* 图片：与 lib-image-util.IMAGE_EXT 同口径，这里独立列一份是为了
     * 让本模块能单独跑 Node 单测，不依赖另一个模块加载顺序。 */
    var IMG_EXT = {
        jpg: 1, jpeg: 1, jpe: 1, jfif: 1, png: 1, apng: 1, webp: 1, gif: 1,
        avif: 1, bmp: 1, heic: 1, heif: 1, tif: 1, tiff: 1, ico: 1, svg: 1
    };

    /* 文档 / 压缩包 / 音视频 / 字幕 —— 抄 Download Master 的「不区分类型」思路，
     * 但把清单补全到常见办公与素材格式，避免只认图片。 */
    var DOC_EXT = {
        pdf: 1, doc: 1, docx: 1, xls: 1, xlsx: 1, ppt: 1, pptx: 1, rtf: 1, txt: 1,
        md: 1, epub: 1, mobi: 1, azw3: 1, djvu: 1, csv: 1, odt: 1, ods: 1, odp: 1,
        zip: 1, rar: 1, '7z': 1, tar: 1, gz: 1, bz2: 1, xz: 1, tgz: 1, cab: 1,
        psd: 1, ai: 1, eps: 1, indd: 1, cdr: 1, sketch: 1, fig: 1, xd: 1,
        mp4: 1, mkv: 1, webm: 1, mov: 1, avi: 1, flv: 1, m4v: 1, ts: 1, m4a: 1,
        mp3: 1, wav: 1, flac: 1, aac: 1, ogg: 1, opus: 1, m3u8: 1, mpd: 1,
        srt: 1, ass: 1, vtt: 1, json: 1, xml: 1
    };

    /* 动态脚本类扩展名不算「文件名」：URL 是 /download.php?id=1 时，
     * 拿 php 当扩展名会把文件名定成 "download.php"，落盘毫无意义。
     * 抄 Download Master 的 SERVER_SCRIPT_EXTENSIONS。 */
    var SERVER_SCRIPT_EXT = { php: 1, asp: 1, aspx: 1, jsp: 1, cgi: 1, pl: 1, do: 1, action: 1 };

    /**
     * 扩展名是否合法。
     *
     * 抄 Download Master utils.isExtensionLegal：
     *   长度 1~4、只含字母数字、不能是纯数字。
     * 为什么长度限 4：webp/jpeg/avif/tiff 都是 4 位，再长多半是页面路径片段。
     * 为什么排除纯数字：`/photo/2023.12/` 这类路径会被误判成扩展名 12。
     */
    function isLegalExt(ext) {
        var s = String(ext == null ? '' : ext).trim().toLowerCase();
        if (!s || s.length > 5) { return false; }
        if (!/^[a-z0-9]+$/.test(s)) { return false; }
        if (!isNaN(Number(s))) { return false; }
        return true;
    }

    /** 扩展名分类：'image' | 'doc' | 'media' | 'other' | '' */
    function kindOfExt(ext) {
        var s = String(ext || '').toLowerCase();
        if (IMG_EXT[s]) { return 'image'; }
        if (DOC_EXT[s]) {
            if (/^(mp4|mkv|webm|mov|avi|flv|m4v|ts|mp3|wav|flac|aac|ogg|opus|m3u8|mpd)$/.test(s)) {
                return 'media';
            }
            return 'doc';
        }
        return '';
    }

    /** URL 的扩展名（不含点）；取不到返回空串 */
    function extOf(url) {
        var s = String(url || '').split(/[?#]/)[0];
        var m = s.match(/\.([A-Za-z0-9]{1,5})$/);
        return m ? m[1].toLowerCase() : '';
    }

    /**
     * 从 URL 取文件名。
     * 抄 Download Master utils.getFileNameFromUrl：先切掉 ? 与 #，再取最后一段，
     * 且必须含点（否则是目录名）。最后 decodeURIComponent 还原中文名。
     */
    function fileNameFromUrl(url) {
        var s = String(url || '');
        if (!s) { return ''; }
        var parts = s.split('?')[0].split('#')[0].split('/');
        var last = parts.length ? parts[parts.length - 1] : '';
        if (!last || last.indexOf('.') <= 0) { return ''; }
        try { return decodeURIComponent(last); } catch (e) { return last; }
    }

    /**
     * 文件名清洗。抄 Download Master utils.sanitizeFilename：
     *   Windows 非法字符与控制字符转 _，去掉首尾的点与空白，限长 200。
     * 限长很重要：服务器返回的超长文件名会让下载直接失败。
     */
    function sanitizeFilename(name) {
        var s = String(name || '');
        if (!s) { return ''; }
        s = s.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
            .replace(/^[.\s]+|[.\s]+$/g, '');
        return s.length > 200 ? s.slice(0, 200) : s;
    }

    /**
     * 决定落盘文件名：优先 URL 里的真名，不行再用页面上的链接文字。
     * 抄 Download Master utils.getDownloadFilename（含 php 类扩展名丢弃逻辑）。
     *
     * @param {string} url
     * @param {string} [linkName] 页面上链接的文字，如「年度报告.pdf」
     */
    function downloadName(url, linkName) {
        var fromUrl = sanitizeFilename(fileNameFromUrl(url));
        if (fromUrl && SERVER_SCRIPT_EXT[extOf(fromUrl)]) { fromUrl = ''; }
        if (fromUrl) { return fromUrl; }
        var fromName = sanitizeFilename(linkName);
        if (fromName && isLegalExt(extOf(fromName))) { return fromName; }
        return '';
    }

    /**
     * 这个 URL 看起来是个可下载文件吗？
     * 抄 Download Master utils.isSuspectGoodLink：
     *   文件名至少 3 个字符 + 扩展名合法。
     * 额外加一道：纯页面地址（无扩展名、以 / 结尾）明确排除。
     */
    function looksDownloadable(url) {
        var s = String(url || '');
        if (!/^https?:/i.test(s)) { return false; }
        var name = fileNameFromUrl(s);
        if (name.length < 3) { return false; }
        return isLegalExt(extOf(s));
    }

    /* ---------------- 源码正则抓图（抄图片下载器） ---------------- */

    /* 图片下载器 contentScript.js 的原式，扩展名清单一字未改。
     * 用途：懒加载站点里，图片地址常常只存在于脚本/JSON 里，DOM 上还没有 <img>。
     *
     * 与原式的差异（2026-11-07 实测后补的两条，原式会整批漏掉）：
     *   ① `https?://` 改为可选 → 兼容协议相对地址 `//cdn.x.com/a.jpg`
     *   ② 增加单斜杠分支 `\/(?!\/)` → 兼容站内绝对路径 `/media/a.jpg`
     *      这类写法在真实站点的 JSON / HTML 属性里最常见
     *      （实测测试页只抓到 1/3 张，就是因为少了这条）。
     * `(?!\/)` 保证不会把 `//host` 拆成单斜杠匹配，两个分支不会打架。 */
    var HTML_IMG_RE = /(?:(?:https?:)?\/\/|\/(?!\/))[^"'\s\\)<>]+?\.(?:jpg|jpeg|png|gif|webp|bmp|svg|tiff|avif|ico|jfif|heic)(?:[?#][^"'\s\\)<>]*)?/gi;

    /**
     * 从 HTML 源码里捞图片/文件地址。
     *
     * 抄图片下载器的 `document.body.innerHTML.match(正则)`，但做了两点必要收敛：
     *   ① 上限（默认 400 条）：深度长页面的源码可能有几十 MB，不设上限会卡死主线程；
     *   ② 去重 + 过滤占位图/1x1/内联 svg。
     *
     * @param {string} html 页面源码（innerHTML 即可）
     * @param {string} base 相对地址基准（源码里通常是绝对地址，仍兜一层）
     * @returns {string[]}
     */
    function extractUrlsFromHtml(html, base, limit) {
        var src = String(html || '');
        if (!src) { return []; }
        var cap = Number(limit) || 400;
        var out = [];
        var seen = Object.create(null);
        /* 把 &amp; 还原成 &，否则 query 里带 &amp; 的地址会取不到 */
        var text = src.replace(/&amp;/gi, '&');
        var m;
        HTML_IMG_RE.lastIndex = 0;
        while ((m = HTML_IMG_RE.exec(text)) !== null) {
            var raw = m[0];
            var abs = absolutize(raw, base);
            if (!abs || seen[abs]) { continue; }
            if (isJunkUrl(abs)) { continue; }
            seen[abs] = 1;
            out.push(abs);
            if (out.length >= cap) { break; }
        }
        return out;
    }

    /** 1x1 / 透明占位 / 内联 svg 这些不该进列表 */
    function isJunkUrl(url) {
        var s = String(url || '').toLowerCase();
        if (/^data:/i.test(s)) { return true; }
        if (/(?:^|[/_.\-?&=])(?:placeholder|loading|spacer|transparent|blank|1x1|pixel)(?:[/_.\-?=&]|$)/.test(s)) {
            return true;
        }
        return /blank\.(?:gif|png)(?:[?#]|$)/.test(s);
    }

    function absolutize(url, baseUrl) {
        var s = String(url == null ? '' : url).trim();
        if (!s) { return ''; }
        if (/^(javascript|about|mailto|tel|blob):/i.test(s)) { return ''; }
        try {
            return new URL(s, baseUrl || undefined).href;
        } catch (e) {
            /* 老环境没有 URL 构造函数：只接受绝对地址 */
            return /^https?:/i.test(s) ? s : '';
        }
    }

    /* ---------------- 全链接扫描（抄 Download Master） ---------------- */

    /* 抄 Download Master content.js 里那张表：页面里能承载媒体的标签。
     * 顺序与人家一致，便于日后对照。 */
    var MEDIA_SELECTORS = [
        { sel: 'video[src]', attr: 'src', label: 'video' },
        { sel: 'audio[src]', attr: 'src', label: 'audio' },
        { sel: 'source[src]', attr: 'src', label: 'source' },
        { sel: 'embed[src]', attr: 'src', label: 'embed' },
        { sel: 'object[data]', attr: 'data', label: 'object' }
    ];

    /**
     * 扫描页面里**所有**可下载文件地址。
     *
     * 抄 Download Master content.js retreiveDownloadableFiles()：
     *   · document.links 全量（不是只挑图片）
     *   · 加上 video/audio/source/embed/object 的 src|data
     *   · blob: 开头的跳过（那是内存对象，下载器取不到）
     *
     * 与它的差异（有意为之，不是偷懒）：
     *   · 用 querySelectorAll('a[href]') 而不是 document.links ——
     *     后者在 svg 里会把 <a> 也混进来，且老环境行为不一致；
     *   · 结果带上 kind（image/doc/media）与建议文件名，UI 直接可用；
     *   · 默认只留「扩展名合法」的，避免整页链接把面板淹掉（可传 all:true 关掉）。
     *
     * @param {Document} doc
     * @param {object} [opts] { base, all, limit }
     * @returns {Array<{url, name, kind, ext, source}>}
     */
    function collectLinks(doc, opts) {
        if (!doc || !doc.querySelectorAll) { return []; }
        var o = opts || {};
        var base = o.base || '';
        var keepAll = o.all === true;
        var limit = Number(o.limit) || 2000;
        var out = [];
        var seen = Object.create(null);

        function add(rawUrl, linkName, source) {
            var abs = absolutize(rawUrl, base);
            if (!abs || seen[abs]) { return; }
            if (/^blob:/i.test(String(rawUrl || ''))) { return; }
            var ext = extOf(abs);
            if (!keepAll && !looksDownloadable(abs)) { return; }
            if (isJunkUrl(abs)) { return; }
            seen[abs] = 1;
            out.push({
                url: abs,
                name: downloadName(abs, linkName),
                kind: kindOfExt(ext) || 'other',
                ext: ext,
                source: source || 'a'
            });
        }

        var as;
        try { as = doc.querySelectorAll('a[href]'); } catch (e) { as = []; }
        for (var i = 0; i < as.length && out.length < limit; i++) {
            var a = as[i];
            var href = a.getAttribute && a.getAttribute('href');
            if (!href || href.charAt(0) === '#') { continue; }
            var txt = '';
            try { txt = String(a.textContent || a.innerText || ''); } catch (e) { txt = ''; }
            add(href, txt, 'a');
        }

        for (var k = 0; k < MEDIA_SELECTORS.length && out.length < limit; k++) {
            var spec = MEDIA_SELECTORS[k];
            var nodes;
            try { nodes = doc.querySelectorAll(spec.sel); } catch (e) { nodes = []; }
            for (var j = 0; j < nodes.length && out.length < limit; j++) {
                var v = nodes[j].getAttribute && nodes[j].getAttribute(spec.attr);
                if (!v) { continue; }
                add(v, '[' + spec.label + ']', spec.label);
            }
        }
        return out;
    }

    /**
     * 自定义过滤。抄 Download Master handlers.js applyCustomFilter：
     *   普通文字 = 子串匹配；写成 /re/i = 正则。
     * 修掉了它的一处毛病：原实现先 set 正则再判空，非法正则会直接抛错；
     * 这里正则建不出来就退回纯子串，不炸整个过滤。
     *
     * @param {string} url
     * @param {string} name
     * @param {string} expr 用户输入
     * @returns {boolean} true = 显示
     */
    function matchesFilter(url, name, expr) {
        var raw = String(expr == null ? '' : expr).trim();
        if (!raw) { return true; }
        var m = raw.match(/^\/(.*)\/([gimuy]*)$/);
        if (m) {
            try {
                var re = new RegExp(m[1], m[2].replace('g', ''));
                /* 正则**分别**作用在 url 与 name 上，不拼成一个字符串。
                 * 早先拼成 "url name" 再测，末尾的空格让 `/\.pdf$/` 这类
                 * 锚定结尾的正则永远不命中（实测 I5 用例抓到）。 */
                return re.test(String(url || '').toLowerCase()) ||
                       re.test(String(name || '').toLowerCase());
            } catch (e) {
                /* 非法正则：退回子串，不让整个面板报错 */
            }
        }
        var hay = (String(url || '') + ' ' + String(name || '')).toLowerCase();
        return hay.indexOf(raw.toLowerCase()) >= 0;
    }

    return {
        IMG_EXT: IMG_EXT,
        DOC_EXT: DOC_EXT,
        SERVER_SCRIPT_EXT: SERVER_SCRIPT_EXT,
        MEDIA_SELECTORS: MEDIA_SELECTORS,
        isLegalExt: isLegalExt,
        kindOfExt: kindOfExt,
        extOf: extOf,
        fileNameFromUrl: fileNameFromUrl,
        sanitizeFilename: sanitizeFilename,
        downloadName: downloadName,
        looksDownloadable: looksDownloadable,
        extractUrlsFromHtml: extractUrlsFromHtml,
        collectLinks: collectLinks,
        matchesFilter: matchesFilter,
        absolutize: absolutize
    };
});