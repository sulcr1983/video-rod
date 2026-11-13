/* ==========================================================
 * 图片管线纯逻辑（可被 Service Worker / Node 单测共用）
 * 不碰 chrome.* / DOM；所有函数都是同步纯函数，便于反证测试。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRImgPipelineCore = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    var CT_EXT = {
        'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
        'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp',
        'image/heic': 'heic', 'image/heif': 'heif'
    };

    /** 文件头 → 扩展名；0 字节不会被 content-type 骗过 */
    function sniffImageHead(buf, mime) {
        var b = buf;
        try {
            if (b instanceof ArrayBuffer) { b = new Uint8Array(b); }
            else if (ArrayBuffer.isView && ArrayBuffer.isView(b)) {
                b = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
            } else if (Array.isArray(b)) { b = Uint8Array.from(b); }
        } catch (e) { return ''; }
        if (!b || !b.length) { return ''; }
        if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) { return 'jpg'; }
        if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) { return 'png'; }
        if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) { return 'gif'; }
        if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
            b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) { return 'webp'; }
        if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
            var brand = '';
            for (var i = 8; i < 12; i++) { brand += String.fromCharCode(b[i]); }
            if (/avif|avis/i.test(brand)) { return 'avif'; }
            if (/heic|heix|hevc|hevx|mif1|msf1/i.test(brand)) { return 'heic'; }
        }
        if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4D) { return 'bmp'; }
        var ct = String(mime || '').split(';')[0].trim().toLowerCase();
        return CT_EXT[ct] || '';
    }

    /** 候选去重、过滤明显非图片、限制数量 */
    function dedupeCandidates(candidates, fallback, max) {
        var list = Array.isArray(candidates) ? candidates : [];
        var cap = Math.max(1, Number(max) || 8);
        var seen = Object.create(null);
        var out = [];
        function push(raw) {
            var s = String(raw == null ? '' : raw).trim();
            if (!s || seen[s]) { return; }
            if (!/^(?:https?:|data:image\/)/i.test(s)) { return; }
            if (/^data:image\/svg/i.test(s)) { return; }
            if (out.length >= cap) { return; }
            seen[s] = 1;
            out.push(s);
        }
        for (var i = 0; i < list.length; i++) { push(list[i]); }
        push(fallback);
        return out;
    }

    /** 把 vrImg.batch 的回执归一成 UI 可直接消费的「真实结果」 */
    function normalizeBatchResult(res, total) {
        var r = res || {};
        var code = String(r.code || (r.needGrant ? 'IMG_E_FSA_PERM' : '') || '');
        var hard = r.ok === false || !!code;
        var fail = Number(r.fail) || 0;
        var n = Number(total) || 0;
        if (hard && !fail && n) { fail = n; }
        var failures = Array.isArray(r.failures) ? r.failures.slice() : [];
        if (hard && !failures.length && code) {
            failures.push({ url: '', code: code, message: String(r.message || '') });
        }
        var out = {
            ok: !hard && fail === 0,
            succeeded: Number(r.succeeded) || 0,
            fail: fail,
            skipped: Number(r.skipped) || 0,
            failures: failures,
            paths: Array.isArray(r.paths) ? r.paths.slice() : [],
            canceled: !!r.canceled,
            needGrant: !!r.needGrant
        };
        if (code) { out.code = code; }
        if (r.message) { out.message = r.message; }
        return out;
    }

    /** 两套设置里任一显式为 false 即关；任一显式为 true 即开；否则用默认 */
    function boolSettings(a, b, key, def) {
        var av = a ? a[key] : undefined;
        var bv = b ? b[key] : undefined;
        if (av === false || bv === false) { return false; }
        if (av === true || bv === true) { return true; }
        return !!def;
    }

    return {
        CT_EXT: CT_EXT,
        sniffImageHead: sniffImageHead,
        dedupeCandidates: dedupeCandidates,
        normalizeBatchResult: normalizeBatchResult,
        boolSettings: boolSettings
    };
});
