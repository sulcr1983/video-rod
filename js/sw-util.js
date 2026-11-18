/* ==========================================================
 * SW 公共工具（我们自己的代码，从 background.js 抽出）
 *
 * 抽出原则（2026-11-18）：
 *   · 只搬「我们写的、被多组依赖」的工具函数
 *   · **不搬猫抓内核逻辑**（CheckExtension / CheckType / operatorCheck 等，
 *     它们依赖内核全局 G，属 ADR-015 禁改区的延伸，留在 background.js）
 *
 * 为什么先抽它：vrWithTimeout 被 9 个函数组依赖（11 次调用），
 * 是拆分时最容易被散落的公共依赖。先落地，后面各组搬迁时不必互相引用。
 * ========================================================== */
(function (root) {
    'use strict';

    /**
     * 给可能卡死的异步步骤加硬超时。
     *
     * 2026-11-05 实测：抖音详情接口偶发不返回，executeScript 会一直 pending，
     * 面板就永远停在「正在问这个网站能下哪些清晰度…」，用户只能看着转圈。
     * 超时后抛错 → 上层 catch 落到下一个分支（最差也有嗅探缓存可用）。
     *
     * @param {Promise} promise 要包的超时
     * @param {number} ms       毫秒
     * @param {string} label    错误信息里的标签（便于定位是哪个步骤超时）
     * @returns {Promise}
     */
    function vrWithTimeout(promise, ms, label) {
        return Promise.race([
            promise,
            new Promise(function (_, reject) {
                setTimeout(function () {
                    reject(new Error('timeout:' + label + ':' + ms));
                }, ms);
            })
        ]);
    }

    root.VRSwUtil = {
        vrWithTimeout: vrWithTimeout
    };
})(typeof self !== 'undefined' ? self : this);
