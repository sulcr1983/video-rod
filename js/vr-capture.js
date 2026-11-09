/**
 * 视频录制兜底（content script，注入所有 frame）
 * -------------------------------------------------------------
 * 抄谁：Video Downloader Pro v0.1.11 的 RecorderController
 *       （assets/js/helper.*.js 里 `video.captureStream()` + `new MediaRecorder(...)`）
 *
 * 为什么需要：有一部分视频**根本拿不到可用的下载地址** ——
 *   · MSE / blob: 流（地址是临时的，抓到了也不可复用）
 *   · 加密但能正常播放的
 *   · 签名几秒就过期
 *   · 只肯给分片、不给完整地址
 * 这些情况下唯一的路就是「把画面录下来」。这是「什么都能下」的最后一张牌。
 *
 * 设计原则（苏哥：不同情况才触发不同模块）：
 *   1. **只有当下载链路全部失败时才会被后台唤起** —— 不参与正常路径，零开销；
 *   2. 也可以由用户在菜单里主动点（放在最后一项，明确写「要播完」）；
 *   3. 全程 try/catch，任何异常都不得影响页面播放。
 *
 * 数据怎么传出去（关键约束）：
 *   录制结果可能有几百 MB，不能等录完一次性扔给后台（页面内存 + 消息体积都撑不住）。
 *   所以用 MediaRecorder 的 timeslice（每 2 秒一个 chunk），边录边把分片 base64
 *   推给后台，后台按序累积。停止时后台拼成一个 Blob 落盘。
 */
(function () {
    'use strict';
    if (window.__vrCapReady) { return; }
    window.__vrCapReady = true;

    var rec = null;
    var chunks = [];          // Blob[]（页面侧只留最近一小段，防止内存翻倍）
    var video = null;
    var startedAt = 0;
    var seq = 0;
    var mimeType = '';
    var keepOriginalMuted = null;   // 录制不改用户静音状态，但我们也不去动它

    function pickVideo() {
        var vs;
        try { vs = Array.prototype.slice.call(document.querySelectorAll('video')); }
        catch (e) { return null; }
        if (!vs.length) { return null; }
        /* 优先级：在播的 > 有画面的 > 任何 readyState>=2 的。
         * 不能只取第一个 —— 信息流页面上一堆预加载的 0 尺寸 video。 */
        var playing = vs.filter(function (v) { return v.currentSrc && !v.paused; });
        if (playing.length) { return playing[0]; }
        var ready = vs.filter(function (v) { return v.currentSrc && v.readyState >= 2; });
        if (ready.length) { return ready[0]; }
        var any = vs.filter(function (v) { return v.readyState >= 2; });
        return any[0] || null;
    }

    function pickMimeType() {
        var list = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
            'video/mp4;codecs=avc1,mp4a',
            'video/mp4'
        ];
        for (var i = 0; i < list.length; i++) {
            try {
                if (window.MediaRecorder && MediaRecorder.isTypeSupported(list[i])) { return list[i]; }
            } catch (e) { /* 忽略 */ }
        }
        return '';
    }

    /* 直接读成 ArrayBuffer，走 Port 的结构化克隆 —— 不过 base64。
     * 早先走 base64 + sendMessage，实测 atob 一直报「not correctly encoded」，
     * 说明字符串在传输环节被改了；结构化克隆是二进制直传，没有这个坑。 */
    function toBuf(blob) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = function () { reject(new Error('read-failed')); };
            fr.readAsArrayBuffer(blob);
        });
    }

    /* 端口会随 SW 回收断开，断了就重连（录制是长任务，必须能自愈） */
    var port = null;
    var lastErr = '';
    function ensurePort() {
        if (port) { return port; }
        try {
            port = chrome.runtime.connect({ name: 'vrCap' });
            port.onDisconnect.addListener(function () {
                var e2 = chrome.runtime.lastError;
                lastErr = 'disc:' + String((e2 && e2.message) || '');
                port = null;
            });
        } catch (e) {
            lastErr = 'conn:' + String((e && e.message) || e);
            port = null;
        }
        return port;
    }

    function flush() {
        if (!chunks.length) { return Promise.resolve(0); }
        var batch = chunks;
        chunks = [];
        var n = 0;
        /* 串行发：保证后台按序拼接 */
        return batch.reduce(function (p, b) {
            return p.then(function () {
                return toBuf(b).then(function (buf) {
                    if (!buf || !buf.byteLength) { return; }
                    var pt = ensurePort();
                    if (!pt) { return; }
                    /* ⚠️ Chrome 扩展的消息是 **JSON 序列化**，不是结构化克隆：
                     * 直接 postMessage(ArrayBuffer) 到对面会变成空对象（实测 parts 恒为 0）。
                     * 所以转成数字数组 —— 体积会膨胀到 3~4 倍，但 2 秒一块完全扛得住，
                     * 而且不会像 base64 那样在传输中被改坏。 */
                    try {
                        pt.postMessage({ type: 'chunk', bytes: Array.prototype.slice.call(new Uint8Array(buf)), n: ++seq });
                        n++;
                    } catch (e) { lastErr = 'post:' + String((e && e.message) || e); port = null; }
                });
            });
        }, Promise.resolve()).then(function () { return n; });
    }

    var ended = false;
    /** 统一收尾（幂等）：主动 stop 和「视频播完自动 stop」都走这里。
     *  视频播完时 MediaRecorder 会自己停 —— 不处理的话录到的东西全烂在页面里。 */
    function finishOnce() {
        if (ended) { return Promise.resolve(); }
        ended = true;
        return flush().then(function () {
            var pt = ensurePort();
            if (!pt) { return; }
            try {
                pt.postMessage({
                    type: 'done', mimeType: mimeType,
                    ms: startedAt ? (Date.now() - startedAt) : 0, chunks: seq
                });
            } catch (e) { /* 端口没了，后台收不到 done 但分片已在 */ }
        });
    }

    function start() {
        if (rec && rec.state === 'recording') {
            return { ok: true, already: true, mimeType: mimeType, startedAt: startedAt };
        }
        video = pickVideo();
        if (!video) { return { ok: false, error: 'NO_VIDEO', message: '这个页面没有可录的视频' }; }
        if (typeof video.captureStream !== 'function') {
            return { ok: false, error: 'CAPTURESTREAM_UNSUPPORTED', message: '这个浏览器不支持视频画面捕获' };
        }
        if (video.readyState < 2) {
            return { ok: false, error: 'NOT_READY', message: '视频还没准备好，先点一下播放' };
        }
        var stream;
        try { stream = video.captureStream(); }
        catch (e) { return { ok: false, error: 'CAPTURE_FAILED', message: '捕获画面失败：' + ((e && e.message) || e) }; }

        var mt = pickMimeType();
        try {
            rec = mt ? new MediaRecorder(stream, { mimeType: mt }) : new MediaRecorder(stream);
        } catch (e1) {
            try { rec = new MediaRecorder(stream); }     // 某些流不吃 mimeType，退一步
            catch (e2) { return { ok: false, error: 'RECORDER_FAILED', message: '录制器启动失败' }; }
        }
        mimeType = rec.mimeType || mt || 'video/webm';
        chunks = [];
        seq = 0;
        ended = false;
        startedAt = Date.now();

        rec.ondataavailable = function (ev) {
            if (ev.data && ev.data.size) {
                chunks.push(ev.data);
                /* 来一块推一块（每块约 2 秒）：页面侧内存不堆积，单条消息也不会过大。
                 * 早先攒 8 块才发，短视频往往攒不满 —— 全压在 stop 那一发，
                 * 一旦那一发失败就整段白录（实测踩到）。 */
                flush();
            }
        };
        rec.onerror = function (ev) {
            var pt = ensurePort();
            if (pt) {
                try { pt.postMessage({ type: 'error', message: String((ev && ev.error && ev.error.name) || 'rec-error') }); }
                catch (e) { /* ignore */ }
            }
        };

        /* 自动停止（视频播完 / 流结束）也要落盘，不能只认用户点停止 */
        rec.onstop = function () { finishOnce(); };

        try { rec.start(2000); }
        catch (e) { return { ok: false, error: 'START_FAILED', message: '开始录制失败' }; }
        return { ok: true, mimeType: mimeType, startedAt: startedAt };
    }

    function stop() {
        var ms = startedAt ? (Date.now() - startedAt) : 0;
        /* 已经在自动停止流程里，或者压根没开始 → 只把已录的收尾 */
        if (!rec || rec.state === 'inactive') {
            return finishOnce().then(function () {
                return { ok: true, autoStopped: true, mimeType: mimeType, ms: ms };
            });
        }
        var p = finishOnce();
        try { rec.stop(); } catch (e) { /* onstop 会兜底 */ }
        /* 兜底：某些 MSE 流 stop 后不触发 onstop（实测存在） */
        setTimeout(function () { finishOnce(); }, 4000);
        return p.then(function () {
            return { ok: true, mimeType: mimeType, ms: ms };
        });
    }

    function state() {
        return {
            recording: !!(rec && rec.state === 'recording'),
            mimeType: mimeType,
            ms: startedAt ? (Date.now() - startedAt) : 0,
            hasVideo: !!pickVideo(),
            /* 诊断用：还没推上去的分片数 / 已推上去的分片数 / 端口是否活着 / 上次失败原因 */
            pendingChunks: chunks.length,
            sentChunks: seq,
            portOk: !!port,
            lastErr: lastErr
        };
    }

    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (!msg || !msg.Message) { return; }
        if (msg.Message === 'vrCap.state') {
            sendResponse(state());
            return;
        }
        if (msg.Message === 'vrCap.start') {
            sendResponse(start());
            return;
        }
        if (msg.Message === 'vrCap.stop') {
            stop().then(function (r) { sendResponse(r); });
            return true;      // 异步
        }
    });

    /* 对外接口：video-overlay.js 与本脚本同在隔离世界，直接共享 window。
     * 比多绕一层 chrome.tabs.sendMessage 简单可靠（也避免跨 frame 发错）。 */
    window.__vrCap = {
        state: state,
        start: start,
        stop: stop
    };
})();
