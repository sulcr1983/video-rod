/* ==========================================================
 * SW 下载出口（从 background.js 抽出，第 0.2 步）
 *
 * 抽出原则（2026-11-18）：
 *   · 先搬**自包含**的函数：只依赖 chrome.downloads，不依赖本文件其他状态
 *   · 搬完在 background.js 留同名包装（委托），保证调用点零改动
 *   · 状态与强耦合逻辑（如 vrPendingNameByUrl 记账组）暂不搬 —— 它们和
 *     onDeterminingFilename 监听深度绑定，贸然搬动会断掉命名保护
 *
 * 为什么先搬这两个：vrWaitDownload / vrDropDownload 被 5 组依赖（各 7 次），
 * 是拆分时最容易被散落的公共依赖。
 * ========================================================== */
(function (root) {
    'use strict';

    /**
     * 等一个 downloads 任务到终态（complete / interrupted），或超时。
     *
     * 防御：id 必须是数字。FSA 直写会返回 {__fsa:true,path} 这种对象，
     * 一旦传进来，downloads.search({id}) 会抛 TypeError 并把整个调用链搞崩
     * （表现是「文件下好了按钮却报失败」）。这里直接当「不是下载器任务」处理。
     *
     * @param {number} id   chrome.downloads 的 downloadId
     * @param {number} ms   最长等待毫秒
     * @returns {Promise<object|null>} 终态的 DownloadItem，或 null
     */
    function vrWaitDownload(id, ms) {
        return new Promise(function (resolve) {
            if (typeof id !== 'number' || !isFinite(id)) { resolve(null); return; }
            const until = Date.now() + ms;
            function tick() {
                chrome.downloads.search({ id: id }, function (items) {
                    const it = items && items[0];
                    if (!it) { resolve(null); return; }
                    if (it.state === 'complete' || it.state === 'interrupted') { resolve(it); return; }
                    if (Date.now() >= until) { resolve(null); return; }
                    setTimeout(tick, 250);
                });
            }
            tick();
        });
    }

    /**
     * 丢弃一个下载（删文件 + 抹记录），并**如实报告清理结果**。
     *
     * 2026-11-18（审计 C2，借鉴 VDH 的 aborted_no_partial）：
     *   原实现是 fire-and-forget —— 调了 `removeFile` 就当清理成功，
     *   既不检查 `chrome.runtime.lastError`，也不复核文件是否真没了。
     *   于是「下载失败」这件事在用户侧只有一种表现，分不清：
     *     · 失败且盘上干净（可以放心重试）
     *     · 失败但留下 0 字节 / .htm / 半截文件（下次扫描会把它当素材收进来）
     *   第二种在微博 403 场景真实发生（见 background.js 快速失败那段注释）。
     *
     * 三态（返回值里的 cleanup）：
     *   'ok'      无残留：要么本来就没文件，要么删成功且复核确认已消失
     *   'failed'  有残留：removeFile 报错，或删完复核发现文件还在
     *   'unknown' 无法判定：环境不支持复核（极少见）
     *
     * 兼容性：原实现返回 undefined 且同步完成。现在返回 Promise，
     * 现有调用方都是「调了就走」不 await，行为不变；要结果的调用方可以 await。
     *
     * @param {number} id chrome.downloads 的 downloadId
     * @returns {Promise<{dropped:boolean, cleanup:string, reason?:string}>}
     */
    function vrDropDownload(id) {
        return new Promise(function (resolve) {
            if (typeof id !== 'number' || !isFinite(id)) {
                resolve({ dropped: false, cleanup: 'ok', reason: 'not-a-download' });
                return;
            }
            if (!root.chrome || !root.chrome.downloads || !root.chrome.downloads.search) {
                resolve({ dropped: false, cleanup: 'unknown', reason: 'no-downloads-api' });
                return;
            }
            /* ① 先查当前状态：记录不在 / 文件本来就没有 → 无需删，直接算干净 */
            try {
                root.chrome.downloads.search({ id: id }, function (items) {
                    void root.chrome.runtime.lastError;
                    var it = items && items[0];
                    if (!it) {
                        resolve({ dropped: false, cleanup: 'ok', reason: 'no-record' });
                        return;
                    }
                    if (it.exists === false) {
                        try { root.chrome.downloads.erase({ id: id }); } catch (e) { /* ignore */ }
                        resolve({ dropped: false, cleanup: 'ok', reason: 'no-file' });
                        return;
                    }
                    /* ② 有文件 → 删，然后复核 */
                    try {
                        root.chrome.downloads.removeFile(id, function () {
                            var rmErr = root.chrome.runtime.lastError;
                            try {
                                root.chrome.downloads.search({ id: id }, function (after) {
                                    void root.chrome.runtime.lastError;
                                    var a = after && after[0];
                                    var gone = !a || a.exists === false;
                                    try { root.chrome.downloads.erase({ id: id }); } catch (e) { /* ignore */ }
                                    if (gone) {
                                        resolve({ dropped: true, cleanup: 'ok' });
                                    } else {
                                        resolve({
                                            dropped: false, cleanup: 'failed',
                                            reason: (rmErr && rmErr.message) || 'file-remains'
                                        });
                                    }
                                });
                            } catch (e2) {
                                /* 复核不了：删调用本身没报错，按 unknown 报，不谎报成功 */
                                resolve({
                                    dropped: true, cleanup: 'unknown',
                                    reason: (rmErr && rmErr.message) || 'cannot-verify'
                                });
                            }
                        });
                    } catch (e) {
                        resolve({ dropped: false, cleanup: 'failed', reason: e && e.message });
                    }
                });
            } catch (e) {
                resolve({ dropped: false, cleanup: 'failed', reason: e && e.message });
            }
        });
    }

    root.VRSwDownload = {
        vrWaitDownload: vrWaitDownload,
        vrDropDownload: vrDropDownload
    };
})(typeof globalThis !== 'undefined' ? globalThis
    : (typeof self !== 'undefined' ? self
        : (typeof window !== 'undefined' ? window : this)));
