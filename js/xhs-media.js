/* ==========================================================
 * VRXhsMedia —— 小红书媒体地址规则（纯逻辑，可 Node 单测）
 *
 * 来源：拆解星愿里装的「小红书下载助手 - 图片视频下载」v1.0.2
 *      （扩展 ID edeaccoppfnefdnpdgmmamcgibbgkdpl）
 *      · 原图推导：它的 sourceImageUrl()（background.js:325-335）
 *      · 候选优先级：它的 selectImageResource()（background.js:430-451）
 *
 * 解决的问题：
 *   小红书 CDN 地址带 `!nd_dft_wlteh_webp_3` 这类处理指令，拿到的是
 *   CDN 压缩过的 webp，不是原图。`ci.xiaohongshu.com` 才是原始资源。
 *   我们此前只在 infoList 里挑 WB_DFT 并保留后缀，永远拿不到原图。
 *
 * 约定：
 *   - 不碰 chrome.*、不发请求、零依赖
 *   - 浏览器/内容脚本/SW 挂 self.VRXhsMedia；Node 走 module.exports
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRXhsMedia = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    function https(u) {
        return String(u || '').replace(/^http:\/\//i, 'https://');
    }

    /**
     * 推导小红书原图地址。
     *
     * 规则（对方向量实测可用）：
     *   1. pathname 按 `!` 截断（丢掉 CDN 处理指令）
     *   2. `.../notes_pre_post/<key>` 或 `.../spectrum/<key>` → ci 域同路径
     *   3. 最后一段像素材 ID（1040 开头的长串）→ ci 域 + 该 ID
     *
     * @param {string} raw
     * @returns {string} 原图 URL；推导不出返回 ''
     */
    function originalUrl(raw) {
        var s = String(raw || '');
        if (!s) { return ''; }
        var path = '';
        try {
            path = new URL(https(s)).pathname.split('!')[0];
        } catch (e) {
            path = s.split('?')[0].split('!')[0];
        }
        var named = path.match(/\/(notes_pre_post|spectrum)\/([a-z0-9_-]+)$/i);
        if (named) {
            return 'https://ci.xiaohongshu.com/' + named[1] + '/' + named[2];
        }
        var id = path.split('/').pop() || '';
        if (/^1040[a-z0-9_-]{16,100}$/i.test(id)) {
            return 'https://ci.xiaohongshu.com/' + id;
        }
        return '';
    }

    /** 图片扩展名（从地址推断，`!` 后缀里的 webp 也要认出来） */
    function imgExt(u) {
        var s = String(u || '');
        var m = s.match(/\.(jpe?g|png|webp|gif|heic|avif)(?=[!?#]|$)/i);
        if (m) {
            var e = m[1].toLowerCase();
            return e === 'jpeg' ? 'jpg' : e;
        }
        /* `!nd_dft_wlteh_webp_3` 这类指令里写明了实际格式 */
        if (/!?nd_[a-z0-9_]*webp/i.test(s)) { return 'webp'; }
        return 'jpg';
    }

    /**
     * 为一张图构造候选链：原图 → 现有地址 → 更低档兜底。
     *
     * 顺序依据对方的择优逻辑（original 优先，其次像素，最后 priority），
     * 但我们**不探测文件头**（那要每张多一次请求），改为按顺序尝试 + 失败回退。
     *
     * ⚠️ 2026-11-07 实测修正：`ci.xiaohongshu.com` 对**部分**素材 ID 返回 404
     *    （例：`1040g2sg3271c1gng6qdg491k3adll5k` → 404 text/plain）。
     *    对方之所以安全，是因为它用 probeImage 逐个探测、原图失败自然被排除。
     *    我们不探测，所以**不能盲目把原图放首位** —— 否则每张图都白跑一次 404。
     *    正确做法见 buildImageChain()：原图只作为「额外候选」，由调用侧探测后再决定首选。
     *
     * @param {object} im note.imageList 的一项
     * @returns {{url:string, ext:string, urlFallback:string, extFallback:string, originalUrl:string}|null}
     */
    function imageCandidate(im) {
        var o = im || {};
        var info = Array.isArray(o.infoList) ? o.infoList : [];

        var dft = null;
        var any = null;
        for (var i = 0; i < info.length; i++) {
            var it = info[i] || {};
            if (!it.url) { continue; }
            if (!any) { any = it; }
            if (it.imageScene === 'WB_DFT') { dft = it; break; }
        }
        var raw = (dft && dft.url) || (any && any.url) ||
            o.urlDefault || o.url || o.urlPre || '';
        if (!raw) { return null; }

        var served = https(raw);
        var original = originalUrl(served) || originalUrl(o.urlDefault || o.url || '');
        var pre = https(o.urlPre || o.url || '');

        return {
            /* 首选仍是「现有可用地址」—— 这是实测一直能用的路径，不动它。 */
            url: served,
            ext: imgExt(served),
            urlFallback: (pre && pre !== served) ? pre : '',
            extFallback: (pre && pre !== served) ? imgExt(pre) : '',
            /* 原图作为**额外候选**：调用侧探测 200 才升为首选，404 就忽略。 */
            originalUrl: (original && original !== served) ? original : ''
        };
    }

    /**
     * 探测原图是否真的存在（HEAD，只看状态码）。
     *
     * 为什么必须探测：实测有素材 ID 在 ci 域是 404。不探测就把它放首位，
     * 等于每张图先白跑一次失败再回退 —— 比原来更慢，属于负优化。
     *
     * @param {string} url
     * @param {number} timeoutMs
     * @returns {Promise<boolean>}
     */
    function probeOriginal(url, timeoutMs) {
        if (!url) { return Promise.resolve(false); }
        if (typeof fetch !== 'function') { return Promise.resolve(false); }
        var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = 0;
        if (ctrl) {
            timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { /* ignore */ } },
                Number(timeoutMs) || 3000);
        }
        return fetch(url, {
            method: 'HEAD',
            credentials: 'omit',
            signal: ctrl ? ctrl.signal : undefined
        }).then(function (r) {
            if (timer) { clearTimeout(timer); }
            return !!r && r.ok;
        }).catch(function () {
            if (timer) { clearTimeout(timer); }
            return false;
        });
    }

    return {
        https: https,
        originalUrl: originalUrl,
        imgExt: imgExt,
        imageCandidate: imageCandidate,
        probeOriginal: probeOriginal
    };
});