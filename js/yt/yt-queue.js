/* ==========================================================
 * VRYtQueue —— YouTube 下载串行队列（纯逻辑，可 Node 单测）
 *
 * 需求（苏哥 2026-11-08）：YouTube 不允许同时下载多个，要排队。
 * 理由：
 *   ① 多个 4K 并发互相抢带宽，每个都变得极慢；
 *   ② 同时对 googlevideo 开多条大流量连接更容易触发限流。
 *
 * 语义：
 *   · 同一 videoId 不重复入队（正在跑的也拦）
 *   · 同一时间只有 1 个 active
 *   · 任务结束（成功/失败/页面被关）才放行下一个
 *   · 启动失败不能让队列永久卡死（必须继续下一个）
 *
 * 约定：不碰 chrome.*，启动动作由调用方注入 startFn。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRYtQueue = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    /**
     * @param {object} opt { startFn(job), delayMs }
     * @returns {object} 队列 API
     */
    function create(opt) {
        var o = opt || {};
        var startFn = typeof o.startFn === 'function' ? o.startFn : function () {};
        var delayMs = Number(o.delayMs) >= 0 ? Number(o.delayMs) : 0;

        var queue = [];
        var active = null;

        function pump() {
            if (active) { return { started: false, job: null }; }
            var job = queue.shift();
            if (!job) { return { started: false, job: null }; }
            active = job;
            try {
                startFn(job);
            } catch (e) {
                /* 启动抛错：不能把队列卡死，立刻释放并继续 */
                active = null;
                return pump();
            }
            return { started: true, job: job };
        }

        /**
         * 入队。
         * @returns {{ok:boolean, reason:string, queued:boolean, position:number, started:boolean}}
         */
        function push(job) {
            var j = job || {};
            if (!j.videoId) {
                return { ok: false, reason: 'no-video-id', queued: false, position: -1, started: false };
            }
            if (active && active.videoId === j.videoId) {
                return { ok: true, reason: 'already-downloading', queued: false, position: 0, started: false };
            }
            for (var i = 0; i < queue.length; i++) {
                if (queue[i].videoId === j.videoId) {
                    return { ok: true, reason: 'already-queued', queued: true, position: i + 1, started: false };
                }
            }
            queue.push(j);
            var r = pump();
            return {
                ok: true,
                reason: r.started ? 'started' : 'queued',
                queued: !r.started,
                position: r.started ? 0 : queue.length,
                started: r.started
            };
        }

        /** 任务结束：释放队列位并启动下一个 */
        function release() {
            if (!active) { return false; }
            active = null;
            /* delayMs > 0 时延后启动（给浏览器一点回收时间）；
             * 否则立刻启动 —— 不能只清 active 就完事，那样下一个永远不会跑。 */
            if (delayMs > 0 && typeof setTimeout === 'function') {
                setTimeout(function () { pump(); }, delayMs);
            } else {
                pump();
            }
            return true;
        }

        function status() {
            return {
                active: active ? active.videoId : '',
                queued: queue.length,
                list: queue.map(function (x) { return x.videoId; })
            };
        }

        return {
            push: push,
            release: release,
            pump: pump,
            status: status,
            _queue: function () { return queue.slice(); },
            _active: function () { return active; }
        };
    }

    return { create: create };
});