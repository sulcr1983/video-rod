/* ==========================================================
 * B站 wbi 签名（纯函数，可 Node 单测）
 *
 * 背景（2026-11-18 实测）：
 *   · x/player/playurl（取流）    → 不需要签名，code 0 可用
 *   · x/space/wbi/arc/search（枚举）→ 不带签名返回 -352 风控校验失败
 *   所以「整博主枚举」必须签名，否则 100% 失败。
 *
 * 算法（社区公开）：
 *   1. 从 /x/web-interface/nav 拿 wbi_img.img_url / sub_url
 *   2. 取文件名（去路径去扩展名）→ imgKey + subKey
 *   3. 按 64 位置换表重排 → mixinKey（32 字符）
 *   4. 参数按 key 字典序排序，过滤 !'()* 字符 → query
 *   5. wts = 秒级时间戳
 *   6. w_rid = md5(query + mixinKey)
 *
 * 本文件不碰 chrome.* / DOM / fetch：只做「给定 key + 参数 → 签名字串」。
 * 取 nav 的 fetch 由调用方注入。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRBiliWbi = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    /* 64 位置换表（B站固定，2023 起未变） */
    var MIXIN_KEY_ENC_TAB = [
        46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
        27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
        37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
        22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
    ];

    /* ---------------- MD5（纯 JS，RFC 1321） ---------------- */

    function toUtf8Bytes(str) {
        var s = String(str == null ? '' : str);
        var out = [];
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if (c < 0x80) { out.push(c); }
            else if (c < 0x800) {
                out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
            } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
                var c2 = s.charCodeAt(i + 1);
                if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
                    var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
                    out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
                             0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
                    i++;
                    continue;
                }
                out.push(0xEF, 0xBF, 0xBD);   // 孤立代理 → U+FFFD
            } else if (c >= 0xD800 && c <= 0xDFFF) {
                out.push(0xEF, 0xBF, 0xBD);
            } else {
                out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
            }
        }
        return out;
    }

    var MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
                 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
                 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
                 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

    var MD5_K = (function () {
        var k = [], i;
        for (i = 0; i < 64; i++) {
            k[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0;
        }
        return k;
    })();

    function md5(str) {
        var bytes = toUtf8Bytes(str);
        var len = bytes.length;
        var bitLen = len * 8;
        // padding：0x80 + 若干 0，最后 8 字节长度（小端）
        bytes.push(0x80);
        while (bytes.length % 64 !== 56) { bytes.push(0); }
        // 64 位长度（低 32 位足够，高位补 0；输入不会超 4GB）
        bytes.push(bitLen & 0xFF, (bitLen >>> 8) & 0xFF, (bitLen >>> 16) & 0xFF,
                   (bitLen >>> 24) & 0xFF, 0, 0, 0, 0);

        var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

        for (var off = 0; off < bytes.length; off += 64) {
            var M = [];
            for (var j = 0; j < 16; j++) {
                M[j] = bytes[off + j * 4] |
                       (bytes[off + j * 4 + 1] << 8) |
                       (bytes[off + j * 4 + 2] << 16) |
                       (bytes[off + j * 4 + 3] << 24);
            }
            var A = a0, B = b0, C = c0, D = d0;
            for (var i = 0; i < 64; i++) {
                var F, g;
                if (i < 16) { F = (B & C) | (~B & D); g = i; }
                else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
                else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
                else { F = C ^ (B | ~D); g = (7 * i) % 16; }
                F = (F + A + MD5_K[i] + M[g]) | 0;
                A = D;
                D = C;
                C = B;
                B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) | 0;
            }
            a0 = (a0 + A) | 0; b0 = (b0 + B) | 0;
            c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
        }

        function hexLE(x) {
            var s = '';
            for (var i = 0; i < 4; i++) {
                s += ('0' + ((x >>> (i * 8)) & 0xFF).toString(16)).slice(-2);
            }
            return s;
        }
        return hexLE(a0) + hexLE(b0) + hexLE(c0) + hexLE(d0);
    }

    /* ---------------- wbi 核心 ---------------- */

    /**
     * 从 nav 响应的 img_url / sub_url 提取 key。
     * 例：https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png → 7cd0849…
     */
    function keyFromUrl(url) {
        var s = String(url || '');
        if (!s) { return ''; }
        var name = s.split('?')[0].split('/').pop() || '';
        var dot = name.lastIndexOf('.');
        return dot > 0 ? name.slice(0, dot) : name;
    }

    /** 由 imgKey + subKey 生成 mixinKey（32 字符） */
    function mixinKey(imgKey, subKey) {
        var raw = String(imgKey || '') + String(subKey || '');
        var out = '';
        for (var i = 0; i < MIXIN_KEY_ENC_TAB.length && i < 32; i++) {
            var idx = MIXIN_KEY_ENC_TAB[i];
            if (idx < raw.length) { out += raw.charAt(idx); }
        }
        return out;
    }

    /** 从 nav JSON 直接取 mixinKey */
    function mixinKeyFromNav(nav) {
        var w = (nav && (nav.data && nav.data.wbi_img)) || nav || {};
        return mixinKey(keyFromUrl(w.img_url), keyFromUrl(w.sub_url));
    }

    /* 参数过滤：B站要求去掉 !'()* 这些字符 */
    var FILTER_CHARS = /[!'()*]/g;

    /**
     * 对参数签名。
     * @param {object} params  业务参数（会被排序，不改原对象）
     * @param {string} mixin   mixinKey
     * @param {number} wts     秒级时间戳（不传则用 Date.now()）
     * @returns {{query:string, wts:number, w_rid:string}}
     */
    function sign(params, mixin, wts) {
        var t = (wts == null) ? Math.floor(Date.now() / 1000) : Math.floor(Number(wts));
        var all = {};
        Object.keys(params || {}).forEach(function (k) {
            if (k === 'w_rid' || k === 'wts') { return; }
            var v = params[k];
            if (v == null) { return; }
            all[k] = String(v).replace(FILTER_CHARS, '');
        });
        all.wts = String(t);

        var keys = Object.keys(all).sort();
        var parts = [];
        for (var i = 0; i < keys.length; i++) {
            parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(all[keys[i]]));
        }
        var query = parts.join('&');
        var w_rid = md5(query + String(mixin || ''));
        return { query: query, wts: t, w_rid: w_rid };
    }

    /**
     * 直接产出带签名的完整 URL。
     * @param {string} baseUrl  不含 wts/w_rid 的 URL
     * @param {object} params   业务参数
     * @param {string} mixin    mixinKey
     * @param {number} wts      可选时间戳
     */
    function signUrl(baseUrl, params, mixin, wts) {
        var s = sign(params, mixin, wts);
        var u = String(baseUrl || '');
        var sep = u.indexOf('?') >= 0 ? '&' : '?';
        return u + sep + s.query + '&w_rid=' + s.w_rid;
    }

    return {
        md5: md5,
        keyFromUrl: keyFromUrl,
        mixinKey: mixinKey,
        mixinKeyFromNav: mixinKeyFromNav,
        sign: sign,
        signUrl: signUrl,
        _MIXIN_KEY_ENC_TAB: MIXIN_KEY_ENC_TAB,
        _toUtf8Bytes: toUtf8Bytes
    };
});
