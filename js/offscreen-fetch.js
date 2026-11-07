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

    /* 分段下载参数。
     * 参考 Chrono 下载管理器 v0.13.12 的 max_threads_config: 5（星愿里实测该值可用），
     * 但浏览器扩展上下文里同时开 5 条 fetch 对 CDN 压力偏大，取 4。 */
    var CHUNK_THREADS = 4;
    var MIN_CHUNK_BYTES = 1024 * 1024;      // 小于 1MB 不值得分段

    /**
     * 用 Range 分段并发取流，拼成一个 Blob。
     *
     * 为什么值得做：单次全量 fetch 有两个硬伤 ——
     *   ① 大文件一次性占满内存，且中途失败要从头再来；
     *   ② 单连接带宽利用率低，CDN 限速时明显更慢。
     * 分段后每段失败可单独重试，总耗时也接近多倍带宽（受站点限速上限约束）。
     *
     * 前提：服务端必须声明 `Accept-Ranges: bytes`（206 才认）。
     * 不支持就静默回退单次全量 —— 不能因为想分段而把原本能下的地址搞挂。
     *
     * @param {string} url
     * @param {number} total 总字节数
     * @returns {Promise<{ok:boolean, blob?:Blob, reason?:string}>}
     */
    async function rangeFetch(url, total) {
        var threads = Math.min(CHUNK_THREADS, Math.ceil(total / MIN_CHUNK_BYTES));
        if (threads < 2) { return { ok: false, reason: 'too-small-to-split' }; }

        var size = Math.ceil(total / threads);
        var jobs = [];
        for (var i = 0; i < threads; i++) {
            var start = i * size;
            var end = Math.min(start + size - 1, total - 1);
            if (start > end) { continue; }
            jobs.push(fetchRangePart(url, start, end));
        }

        var parts = await Promise.all(jobs);
        for (var j = 0; j < parts.length; j++) {
            if (!parts[j] || !parts[j].ok) {
                return { ok: false, reason: (parts[j] && parts[j].reason) || 'part-failed' };
            }
        }
        var blobs = parts.map(function (p) { return p.blob; });
        return { ok: true, blob: new Blob(blobs, { type: parts[0].type || 'application/octet-stream' }) };
    }

    /** 取单段；失败重试一次（换连接，不改区间） */
    function fetchRangePart(url, start, end) {
        function once(attempt) {
            return fetch(url, {
                credentials: 'include',
                headers: { Range: 'bytes=' + start + '-' + end }
            }).then(function (r) {
                if (r.status !== 206) {
                    return { ok: false, reason: 'not-partial-' + r.status };
                }
                return r.blob().then(function (b) {
                    return { ok: true, blob: b, type: r.headers.get('content-type') || '' };
                });
            }).catch(function (e) {
                if (attempt < 1) { return once(attempt + 1); }
                return { ok: false, reason: String(e).slice(0, 120) };
            });
        }
        return once(0);
    }

    chrome.runtime.onMessage.addListener(function (Message, sender, sendResponse) {
        if (!Message || Message.Message !== 'vrOffscreenDownload') { return; }

        var url = String(Message.url || '');
        var filename = String(Message.filename || 'video.mp4');
        if (!/^https?:/i.test(url)) {
            reply(sendResponse, { ok: false, reason: 'bad-url' });
            return true;
        }

        /* 先探一次拿总长度与 Accept-Ranges（HEAD 多数 CDN 支持）；
         * 探测失败就直接走原来的单次全量，不额外增加失败面。 */
        var probe = fetch(url, { method: 'HEAD', credentials: 'include' })
            .then(function (r) {
                var len = Number(r.headers.get('content-length')) || 0;
                var ranges = String(r.headers.get('accept-ranges') || '').toLowerCase();
                return { ok: r.ok, total: len, ranges: ranges };
            })
            .catch(function () { return { ok: false, total: 0, ranges: '' }; });

        probe.then(function (info) {
            if (info.ok && info.total >= MIN_CHUNK_BYTES && info.ranges.indexOf('bytes') >= 0) {
                return rangeFetch(url, info.total).then(function (res) {
                    if (res.ok && res.blob && res.blob.size) {
                        var bu0 = URL.createObjectURL(res.blob);
                        return { ok: true, blobUrl: bu0, bytes: res.blob.size,
                            type: res.blob.type || '', via: 'range' };
                    }
                    return null;      // 分段失败 → 回退单次
                });
            }
            return null;              // 不支持 Range / 太小 → 单次
        }).then(function (segRes) {
            if (segRes) { return segRes; }
            return fetch(url, { credentials: 'include' }).then(function (r) {
                if (!r.ok) { return { ok: false, reason: 'http-' + r.status }; }
                return r.blob().then(function (blob) {
                    if (!blob || !blob.size) { return { ok: false, reason: 'empty-body' }; }
                    var bu = URL.createObjectURL(blob);
                    return { ok: true, blobUrl: bu, bytes: blob.size, type: blob.type || '', via: 'single' };
                });
            });
        }).catch(function (e) {
            return { ok: false, reason: String(e).slice(0, 160) };
        }).then(function (res) {
            reply(sendResponse, res);
        });

        return true;      // 异步响应
    });
})();
