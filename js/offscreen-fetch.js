/* ==========================================================
 * 离屏文档：直连下载（防盗链站点的最后一条路）
 *
 * 为什么需要它（2026-11-05 抖音实测结论）：
 *   抖音 CDN 直链 `douyinvod.com` 的响应：
 *     不带 Referer → 403 SERVER_FORBIDDEN
 *     带 Referer   → 206 正常
 *   但三条常规路都过不去：
 *     ① chrome.downloads.download —— DNR 的 modifyHeaders 对它不生效，拿不到 Referer
 *     ② 页面主世界 fetch        —— 跨域被 CORS 拦（TypeError: Failed to fetch）
 *     ③ service worker fetch    —— 能带 Referer，但 SW 里建不出 blob URL 给下载器
 *   所以放到离屏文档：扩展上下文 fetch（有 host_permissions，不受 CORS 限制，
 *   DNR 的 Referer 规则对 fetch 生效）→ blob → blob URL → downloads API 落盘。
 *
 * 只在本文件里做「取字节 + 交下载器」，命名/归属/入库仍由 background 统一处理。
 * ========================================================== */
(function () {
    'use strict';

    function reply(sendResponse, obj) {
        try { sendResponse(obj); } catch (e) { /* 通道已关 */ }
    }

    chrome.runtime.onMessage.addListener(function (Message, sender, sendResponse) {
        if (!Message || Message.Message !== 'vrOffscreenDownload') { return; }

        var url = String(Message.url || '');
        var filename = String(Message.filename || 'video.mp4');
        if (!/^https?:/i.test(url)) {
            reply(sendResponse, { ok: false, reason: 'bad-url' });
            return true;
        }

        fetch(url, { credentials: 'include' }).then(function (r) {
            if (!r.ok) { return { ok: false, reason: 'http-' + r.status }; }
            return r.blob().then(function (blob) {
                if (!blob || !blob.size) { return { ok: false, reason: 'empty-body' }; }
                // 只负责「取字节」，落盘交给 background 的统一入口 vrDownloadWithName：
                // 那里有文件名记账（onDeterminingFilename）、归档子目录、资源库入库。
                // ⚠️ 不能在这里用 <a download> —— 实测会落到「下载」根目录、丢掉子目录、
                //    也不进资源库（苏哥 2026-11-05 明确否决这条路）。
                var bu = URL.createObjectURL(blob);
                return { ok: true, blobUrl: bu, bytes: blob.size, type: blob.type || '' };
            });
        }).catch(function (e) {
            return { ok: false, reason: String(e).slice(0, 160) };
        }).then(function (res) {
            reply(sendResponse, res);
        });

        return true;      // 异步响应
    });
})();
