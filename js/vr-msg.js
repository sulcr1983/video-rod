/* ==========================================================
 * VRMsg —— 内容脚本 ↔ 后台 的消息助手（B-52「下载统一组件」）
 *
 * 为什么单独抽出来：
 *   image-hover.js 和 image-batch.js 里各有一份**逐字相同**的 send()，
 *   都在处理「chrome.runtime.lastError 必须读一次」「扩展重载后同步抛
 *   Extension context invalidated」「回执可能永不到达」这三件同样的事。
 *   各写一份的结果是超时值不一致（8s / 120s）、漏读 lastError 的地方偶尔漏一个。
 *
 * 约定：
 *   · 只做消息收发，不碰 DOM、不碰下载逻辑
 *   · 回执一定只回调一次（真实应答 / 错误 / 超时 三选一）
 *   · 超时后回调 null，调用方按「失败但可重试」处理
 * ========================================================== */
(function (root) {
    'use strict';

    /**
     * 发消息给后台，带 lastError 处理与超时兜底。
     * @param {object} msg 消息体（必须有 Message 字段）
     * @param {function|null} cb 回执，参数为后台返回值或 null
     * @param {number} [timeoutMs=8000] 超时；批量类任务请显式给大值
     */
    function send(msg, cb, timeoutMs) {
        let done = false;
        const finish = function (res) {
            if (done) { return; }
            done = true;
            if (typeof cb === 'function') { cb(res); }
        };
        const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : 8000;

        try {
            chrome.runtime.sendMessage(msg, function (res) {
                /* 必须读一次 lastError：不读会在控制台留下
                 * "Unchecked runtime.lastError"，且在扩展重载后表现为静默无回执。 */
                const err = chrome.runtime.lastError;
                finish(err ? null : res);
            });
        } catch (e) {
            /* 扩展被更新/重载后，旧页面的 content script 成为孤儿，
             * sendMessage 会**同步抛** "Extension context invalidated."。
             * 包住它，让调用方拿到 null 而不是一条未捕获异常。 */
            finish(null);
            return;
        }
        setTimeout(function () { finish(null); }, ms);
    }

    /** Promise 版，方便 async 函数里用 */
    function request(msg, timeoutMs) {
        return new Promise(function (resolve) {
            send(msg, function (res) { resolve(res); }, timeoutMs);
        });
    }

    root.VRMsg = { send: send, request: request };
})(typeof self !== 'undefined' ? self : this);
