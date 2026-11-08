/* ==========================================================
 * VRZip —— 极简 STORE 模式 zip 打包（零依赖）
 *
 * 为什么自己写：
 *   备份「_library 整包」只需要把一堆文件塞进一个 zip，
 *   用 STORE（不压缩）模式即可 —— 索引是 JSON、缩略图已是 webp，
 *   再压缩收益很小。为这点功能引入 fflate/jszip 不划算（项目铁律：零依赖优先）。
 *
 * 为什么抽成独立模块：
 *   内联在 settings.js 的 IIFE 里没法单测，而 zip 头部字段错一个字节
 *   解压就会失败 —— 这种「看不见的错」必须有测试兜住。
 *
 * 格式要点（PKWARE APPNOTE 6.3）：
 *   · 全部小端序（little-endian）
 *   · 本地文件头签名 0x04034b50，中央目录 0x02014b50，结束记录 0x06054b50
 *   · 通用标志位 0x0800 = 文件名按 UTF-8 编码（中文目录名不乱码）
 *   · STORE 模式压缩方法 = 0，压缩前后大小相同
 *
 * 挂 self.VRZip。
 * ========================================================== */
(function (root) {
    'use strict';

    var SIG_LOCAL = 0x04034b50;
    var SIG_CENTRAL = 0x02014b50;
    var SIG_END = 0x06054b50;
    var FLAG_UTF8 = 0x0800;
    var METHOD_STORE = 0;

    var crcTable = null;

    /** CRC-32（IEEE 802.3，zip 用的就是它） */
    function crc32(bytes) {
        if (!crcTable) {
            crcTable = new Uint32Array(256);
            for (var n = 0; n < 256; n++) {
                var c = n;
                for (var k = 0; k < 8; k++) {
                    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                }
                crcTable[n] = c >>> 0;
            }
        }
        var crc = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) {
            crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    /**
     * 打包。
     * @param {Array<{name:string, data:Uint8Array}>} entries
     *        name 用 `/` 分隔；data 是原始字节
     * @returns {Uint8Array} 完整 zip 字节
     */
    function build(entries) {
        var list = Array.isArray(entries) ? entries : [];
        var parts = [];
        var central = [];
        var offset = 0;

        for (var i = 0; i < list.length; i++) {
            var nameBytes = new TextEncoder().encode(String(list[i].name || ''));
            var data = list[i].data || new Uint8Array(0);
            var crc = crc32(data);

            /* ---- 本地文件头（30 字节 + 文件名） ---- */
            var lh = new Uint8Array(30 + nameBytes.length);
            var dv = new DataView(lh.buffer);
            dv.setUint32(0, SIG_LOCAL, true);
            dv.setUint16(4, 20, true);          /* 解压所需版本 2.0 */
            dv.setUint16(6, FLAG_UTF8, true);   /* UTF-8 文件名 */
            dv.setUint16(8, METHOD_STORE, true);
            dv.setUint16(10, 0, true);          /* 修改时间 */
            dv.setUint16(12, 0, true);          /* 修改日期 */
            dv.setUint32(14, crc, true);
            dv.setUint32(18, data.length, true);/* 压缩后大小 */
            dv.setUint32(22, data.length, true);/* 原始大小（STORE 相同） */
            dv.setUint16(26, nameBytes.length, true);
            dv.setUint16(28, 0, true);          /* 扩展字段长度 */
            lh.set(nameBytes, 30);

            parts.push(lh, data);

            /* ---- 中央目录项（46 字节 + 文件名） ---- */
            var ch = new Uint8Array(46 + nameBytes.length);
            var cv = new DataView(ch.buffer);
            cv.setUint32(0, SIG_CENTRAL, true);
            cv.setUint16(4, 20, true);          /* 创建版本 */
            cv.setUint16(6, 20, true);          /* 解压所需版本 */
            cv.setUint16(8, FLAG_UTF8, true);
            cv.setUint16(10, METHOD_STORE, true);
            cv.setUint16(12, 0, true);
            cv.setUint16(14, 0, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, data.length, true);
            cv.setUint32(24, data.length, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint16(30, 0, true);          /* 扩展字段 */
            cv.setUint16(32, 0, true);          /* 注释 */
            cv.setUint16(34, 0, true);          /* 起始磁盘号 */
            cv.setUint16(36, 0, true);          /* 内部属性 */
            cv.setUint32(38, 0, true);          /* 外部属性 */
            cv.setUint32(42, offset, true);     /* 本地头偏移 */
            ch.set(nameBytes, 46);
            central.push(ch);

            offset += lh.length + data.length;
        }

        var centralSize = central.reduce(function (a, b) { return a + b.length; }, 0);

        /* ---- 结束记录（22 字节） ---- */
        var end = new Uint8Array(22);
        var ev = new DataView(end.buffer);
        ev.setUint32(0, SIG_END, true);
        ev.setUint16(4, 0, true);               /* 本磁盘号 */
        ev.setUint16(6, 0, true);               /* 中央目录起始磁盘 */
        ev.setUint16(8, list.length, true);     /* 本磁盘条目数 */
        ev.setUint16(10, list.length, true);    /* 总条目数 */
        ev.setUint32(12, centralSize, true);
        ev.setUint32(16, offset, true);         /* 中央目录偏移 */
        ev.setUint16(20, 0, true);              /* 注释长度 */

        var all = parts.concat(central, [end]);
        var total = all.reduce(function (a, b) { return a + b.length; }, 0);
        var out = new Uint8Array(total);
        var pos = 0;
        for (var j = 0; j < all.length; j++) {
            out.set(all[j], pos);
            pos += all[j].length;
        }
        return out;
    }

    /**
     * 解析（只覆盖本模块产出的 STORE zip，用于自校验与测试）。
     * @returns {{entries:Array<{name,crc,size,offset}>, comment:string}}
     */
    function parse(bytes) {
        var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        var out = { entries: [], comment: '' };

        /* 从尾部找结束记录（本实现注释为空，所以就在最后 22 字节） */
        var endPos = -1;
        for (var i = bytes.length - 22; i >= 0; i--) {
            if (dv.getUint32(i, true) === SIG_END) { endPos = i; break; }
        }
        if (endPos < 0) { throw new Error('不是合法 zip：找不到结束记录'); }

        var count = dv.getUint16(endPos + 10, true);
        var cdOffset = dv.getUint32(endPos + 16, true);
        var cdSize = dv.getUint32(endPos + 12, true);
        if (cdOffset + cdSize > bytes.length) { throw new Error('中央目录越界'); }

        var p = cdOffset;
        for (var n = 0; n < count; n++) {
            if (dv.getUint32(p, true) !== SIG_CENTRAL) { throw new Error('中央目录项签名错'); }
            var nameLen = dv.getUint16(p + 28, true);
            var name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
            out.entries.push({
                name: name,
                crc: dv.getUint32(p + 16, true),
                size: dv.getUint32(p + 24, true),
                compressedSize: dv.getUint32(p + 20, true),
                method: dv.getUint16(p + 10, true),
                flags: dv.getUint16(p + 8, true),
                offset: dv.getUint32(p + 42, true)
            });
            p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
        }
        return out;
    }

    root.VRZip = {
        crc32: crc32,
        build: build,
        parse: parse,
        SIG_LOCAL: SIG_LOCAL,
        SIG_CENTRAL: SIG_CENTRAL,
        SIG_END: SIG_END,
        FLAG_UTF8: FLAG_UTF8
    };
    if (typeof module === 'object' && module.exports) { module.exports.VRZip = root.VRZip; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));