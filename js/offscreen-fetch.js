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
                // 离屏文档没有 chrome.downloads（实测 undefined），也不能靠 SW 下载 blob URL
                // —— blob 落盘会被 Chrome 改成一串 UUID（ADR-040 同一坑）。
                // 用 <a download> 触发浏览器下载：download 属性里的文件名会被保留。
                var bu = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = bu;
                a.download = filename;
                a.rel = 'noopener';
                (document.body || document.documentElement).appendChild(a);
                a.click();
                a.remove();
                setTimeout(function () {
                    try { URL.revokeObjectURL(bu); } catch (e) { /* ignore */ }
                }, 300000);
                return { ok: true, bytes: blob.size, type: blob.type || '', via: 'a-download' };
            });
        }).catch(function (e) {
            return { ok: false, reason: String(e).slice(0, 160) };
        }).then(function (res) {
            reply(sendResponse, res);
        });

        return true;      // 异步响应
    });
})();
