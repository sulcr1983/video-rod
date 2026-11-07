/* ==========================================================
 * VRAlbumExport —— 导出图片链接 / ZIP 只存储打包 / 模板变量归一
 * （纯逻辑，可 Node 单测）
 *
 * 职责：
 *   · buildExport(items, fmt)  导出 txt / csv 链接清单
 *   · zipStore(files)          用 STORE（不压缩）打 ZIP，零依赖
 *   · normalizeTemplate(tpl)   AIX 风格 {NO}/{PAGETITLE}/{DATE} → 本项目 ${...}
 *   · jpegName(name)           WEBP→JPG 时的文件名改写
 *
 * 为什么 ZIP 自己写而不是引 JSZip：
 *   图片本身已是压缩格式，再 deflate 一遍基本不减小体积，却要多背 ~100KB 依赖。
 *   STORE 模式（method=0）足以满足「一次下载多张、避开浏览器多文件确认弹窗」的诉求。
 *
 * 约定：不碰 chrome.*、不读 DOM、不发请求；浏览器挂 self.VRAlbumExport，
 *       Node 走 module.exports；ES5 为主。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRAlbumExport = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    /* ---------------- CRC32（ZIP 必需） ---------------- */

    var CRC_TABLE = null;

    function crcTable() {
        if (CRC_TABLE) { return CRC_TABLE; }
        var t = new Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            t[n] = c >>> 0;
        }
        CRC_TABLE = t;
        return t;
    }

    /** @param {Uint8Array} bytes @returns {number} 无符号 32 位 */
    function crc32(bytes) {
        var t = crcTable();
        var c = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) {
            c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        }
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    /* ---------------- ZIP（STORE，method=0） ---------------- */

    function dosDateTime(d) {
        var dt = d instanceof Date ? d : new Date();
        var year = dt.getFullYear();
        if (year < 1980) { year = 1980; }
        var time = ((dt.getHours() & 0x1F) << 11) |
                   ((dt.getMinutes() & 0x3F) << 5) |
                   ((Math.floor(dt.getSeconds() / 2)) & 0x1F);
        var date = (((year - 1980) & 0x7F) << 9) |
                   (((dt.getMonth() + 1) & 0x0F) << 5) |
                   (dt.getDate() & 0x1F);
        return { time: time, date: date };
    }

    function utf8Bytes(str) {
        var s = String(str == null ? '' : str);
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(s);
        }
        // Node 兜底（老版本无 TextEncoder 的场景）
        var out = [];
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if (c < 0x80) { out.push(c); }
            else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
            else {
                out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
            }
        }
        return Uint8Array.from ? Uint8Array.from(out) : new Uint8Array(out);
    }

    /**
     * 打 ZIP（STORE）。
     * @param {Array<{name:string, data:Uint8Array|ArrayBuffer}>} files
     * @param {object} opt { date }
     * @returns {Uint8Array}
     */
    function zipStore(files, opt) {
        var list = Array.isArray(files) ? files : [];
        var o = opt || {};
        var dt = dosDateTime(o.date);
        var chunks = [];
        var central = [];
        var offset = 0;

        for (var i = 0; i < list.length; i++) {
            var f = list[i] || {};
            var name = String(f.name || ('file' + i));
            var raw = f.data;
            var bytes;
            if (raw instanceof Uint8Array) { bytes = raw; }
            else if (raw && raw.byteLength !== undefined) { bytes = new Uint8Array(raw); }
            else { bytes = utf8Bytes(String(raw == null ? '' : raw)); }

            var nameBytes = utf8Bytes(name);
            var crc = crc32(bytes);
            var size = bytes.length;

            /* 通用标志位 0x0800：文件名按 UTF-8 编码（中文名不乱码的关键） */
            var flags = 0x0800;
            var method = 0;

            var local = new Uint8Array(30 + nameBytes.length);
            var dv = new DataView(local.buffer);
            dv.setUint32(0, 0x04034b50, true);      // PK\x03\x04
            dv.setUint16(4, 20, true);              // version needed
            dv.setUint16(6, flags, true);
            dv.setUint16(8, method, true);
            dv.setUint16(10, dt.time, true);
            dv.setUint16(12, dt.date, true);
            dv.setUint32(14, crc, true);
            dv.setUint32(18, size, true);           // compressed size（STORE 相等）
            dv.setUint32(22, size, true);           // uncompressed size
            dv.setUint16(26, nameBytes.length, true);
            dv.setUint16(28, 0, true);              // extra len
            local.set(nameBytes, 30);

            chunks.push(local, bytes);

            var cen = new Uint8Array(46 + nameBytes.length);
            var cv = new DataView(cen.buffer);
            cv.setUint32(0, 0x02014b50, true);      // PK\x01\x02
            cv.setUint16(4, 20, true);              // version made by
            cv.setUint16(6, 20, true);              // version needed
            cv.setUint16(8, flags, true);
            cv.setUint16(10, method, true);
            cv.setUint16(12, dt.time, true);
            cv.setUint16(14, dt.date, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, size, true);
            cv.setUint32(24, size, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint16(30, 0, true);              // extra
            cv.setUint16(32, 0, true);              // comment
            cv.setUint16(34, 0, true);              // disk number
            cv.setUint16(36, 0, true);              // internal attrs
            cv.setUint32(38, 0, true);              // external attrs
            cv.setUint32(42, offset, true);         // local header offset
            cen.set(nameBytes, 46);
            central.push(cen);

            offset += local.length + size;
        }

        var cenStart = offset;
        var cenLen = 0;
        for (var j = 0; j < central.length; j++) { cenLen += central[j].length; }

        var eocd = new Uint8Array(22);
        var ev = new DataView(eocd.buffer);
        ev.setUint32(0, 0x06054b50, true);          // PK\x05\x06
        ev.setUint16(4, 0, true);
        ev.setUint16(6, 0, true);
        ev.setUint16(8, central.length, true);
        ev.setUint16(10, central.length, true);
        ev.setUint32(12, cenLen, true);
        ev.setUint32(16, cenStart, true);
        ev.setUint16(20, 0, true);

        var total = cenStart + cenLen + eocd.length;
        var out = new Uint8Array(total);
        var p = 0;
        for (var a = 0; a < chunks.length; a++) { out.set(chunks[a], p); p += chunks[a].length; }
        for (var b = 0; b < central.length; b++) { out.set(central[b], p); p += central[b].length; }
        out.set(eocd, p);
        return out;
    }

    /* ---------------- 链接导出 ---------------- */

    function csvCell(v) {
        var s = String(v == null ? '' : v);
        if (/[",\r\n]/.test(s)) { return '"' + s.replace(/"/g, '""') + '"'; }
        return s;
    }

    /**
     * 导出图片链接清单。
     * @param {Array} items [{url, w, h, orig?, name?}]
     * @param {string} fmt 'txt' | 'csv'
     * @returns {string}
     */
    function buildExport(items, fmt) {
        var list = Array.isArray(items) ? items : [];
        var f = String(fmt || 'txt').toLowerCase();
        if (f === 'csv') {
            var rows = ['序号,宽,高,文件名,图片地址'];
            for (var i = 0; i < list.length; i++) {
                var it = list[i] || {};
                rows.push([
                    i + 1,
                    Number(it.w) || 0,
                    Number(it.h) || 0,
                    csvCell(it.name || ''),
                    csvCell(it.orig || it.url || '')
                ].join(','));
            }
            return rows.join('\r\n') + '\r\n';
        }
        // txt：一行一个地址，最省事也最通用（可直接喂给下载器/脚本）
        var lines = [];
        for (var j = 0; j < list.length; j++) {
            var u = (list[j] && (list[j].orig || list[j].url)) || '';
            if (u) { lines.push(u); }
        }
        return lines.join('\n') + (lines.length ? '\n' : '');
    }

    /* ---------------- 模板变量归一（AIX 兼容） ---------------- */

    /**
     * AIX / Fatkun 风格的占位符 → 本项目模板变量。
     *   {NO}       → ${index}
     *   {NO01}     → ${index}（补零到 2 位，本项目 ${index} 本身就是 2 位）
     *   {NO001}    → ${index}（本项目固定 2 位，3 位需求靠调用方格式化，这里只归一）
     *   {PAGETITLE}→ ${title}
     *   {NAME}     → ${title}
     *   {DATE}     → ${date}
     *   {EXT}      → ${ext}
     * 不认识的占位符原样保留，不吞掉用户的字面文本。
     */
    function normalizeTemplate(tpl) {
        var s = String(tpl == null ? '' : tpl);
        return s
            .replace(/\{NO(\d{0,3})\}/gi, '${index}')
            .replace(/\{PAGETITLE\}/gi, '${title}')
            .replace(/\{NAME\}/gi, '${title}')
            .replace(/\{DATE\}/gi, '${date}')
            .replace(/\{EXT\}/gi, '${ext}')
            .replace(/\{URL\}/gi, '${url}')
            .replace(/\{AUTHOR\}/gi, '${author}')
            .replace(/\{SITE\}/gi, '${site}');
    }

    /** 判断模板是否已经是本项目 ${} 风格（避免重复归一） */
    function isProjectTemplate(tpl) {
        return /\$\{[a-zA-Z]+\}/.test(String(tpl || ''));
    }

    /**
     * 序号补零。模板要 {NO001} 时给 3 位，{NO01} 给 2 位，{NO} 给不补零。
     * 之所以单独提供：${index} 在 naming.js 里固定 2 位，无法表达 3 位。
     * @returns {number} 需要的位数（0 表示不补零）
     */
    function indexPadOf(tpl) {
        var m = /\{NO(\d{0,3})\}/i.exec(String(tpl || ''));
        if (!m) { return null; }
        return m[1] ? m[1].length : 0;
    }

    /** 按位数补零 */
    function padIndex(n, width) {
        var v = Number(n) || 0;
        var w = Number(width) || 0;
        var s = String(v);
        while (s.length < w) { s = '0' + s; }
        return s;
    }

    /* ---------------- WEBP→JPG 文件名 ---------------- */

    /** 把 .webp 换成 .jpg；本来就是 jpg 则不变 */
    function jpegName(name) {
        var s = String(name || '');
        if (/\.webp$/i.test(s)) { return s.replace(/\.webp$/i, '.jpg'); }
        return s;
    }

    /** 是否需要转换（只对 webp/avif 有意义，png 转 jpg 会丢透明通道，不自动做） */
    function needsJpeg(url) {
        var s = String(url || '').split('?')[0].split('#')[0];
        return /\.(webp|avif)$/i.test(s);
    }

    return {
        crc32: crc32,
        zipStore: zipStore,
        buildExport: buildExport,
        csvCell: csvCell,
        normalizeTemplate: normalizeTemplate,
        isProjectTemplate: isProjectTemplate,
        indexPadOf: indexPadOf,
        padIndex: padIndex,
        jpegName: jpegName,
        needsJpeg: needsJpeg,
        utf8Bytes: utf8Bytes
    };
});
