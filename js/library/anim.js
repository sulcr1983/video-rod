/* ==========================================================
 * VR Anim —— 动图逐帧控制（F6 / B-08 的动图部分）
 *
 * 真源原型：gifbar（暂停 / 帧号 / 循环 / 倍速）
 * 实现选择：优先浏览器原生 ImageDecoder（WebCodecs，Chrome/Edge 94+），
 *   不引 gifuct-js —— 原生能覆盖 GIF/WebP/APNG 时就不该加 3KB 依赖（离线、零构建）。
 *   不支持则优雅退回静态图（不报错、不影响其它类型预览）。
 * ========================================================== */
(function () {
    'use strict';
    var root = window;

    var MIME = {
        GIF: 'image/gif',
        WEBP: 'image/webp',
        APNG: 'image/apng',
        PNG: 'image/apng'
    };

    function supported() {
        return typeof root.ImageDecoder === 'function';
    }

    /**
     * 挂载动图播放器
     * @param {object} o {url, ext, rate, loop, onFrame(n,total), onReady(total), onError()}
     * @returns {object|null} controller
     */
    async function attach(o) {
        var opt = o || {};
        if (!opt.url || !supported()) { return null; }

        var mime = MIME[String(opt.ext || 'GIF').toUpperCase()] || 'image/gif';
        var decoder = null;
        var frames = 0;
        var canvas = null;
        var ctx = null;
        var playing = true;
        var idx = 0;
        var timer = 0;
        var rate = Number(opt.rate) || 1;
        var loopMode = opt.loop || 'infinite';     // infinite | once | pingpong
        var dir = 1;
        var destroyed = false;

        try {
            var resp = await fetch(opt.url);
            if (!resp.ok) { throw new Error('fetch failed'); }
            var buf = await resp.arrayBuffer();
            decoder = new root.ImageDecoder({ data: buf, type: mime });
            await decoder.completed;
            /* GIF/WebP 的 track 元数据可能在 completed 之后才 ready；
             * 旧实现直接读 selectedTrack.frameCount，部分文件会得到 1，
             * 表现为“动图只能看第一帧、逐帧按钮无效”。 */
            try { if (decoder.tracks && decoder.tracks.ready) { await decoder.tracks.ready; } } catch (e) { /* ignore */ }
            var track = decoder.tracks && (decoder.tracks.selectedTrack || decoder.tracks[0]);
            frames = (track && track.frameCount) || 1;
        } catch (e) {
            try { if (decoder) { decoder.close(); } } catch (e2) { /* ignore */ }
            if (opt.onError) { opt.onError(); }
            return null;
        }

        canvas = document.createElement('canvas');
        ctx = canvas.getContext('2d');

        async function draw(i) {
            try {
                var res = await decoder.decode({ frameIndex: i });
                var fr = res && res.image;
                if (!fr) { return; }
                if (canvas.width !== fr.displayWidth || canvas.height !== fr.displayHeight) {
                    canvas.width = fr.displayWidth;
                    canvas.height = fr.displayHeight;
                }
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(fr, 0, 0);
                try { fr.close(); } catch (e) { /* ignore */ }
                if (opt.onFrame) { opt.onFrame(i + 1, frames); }
            } catch (e) { /* 单帧解码失败不打断播放 */ }
        }

        function tick() {
            if (destroyed || !playing) { return; }
            var step = 1;
            if (loopMode === 'pingpong') {
                if (idx + dir >= frames || idx + dir < 0) { dir = -dir; }
                step = dir;
            }
            idx = idx + step;
            if (idx >= frames) {
                if (loopMode === 'once') { idx = frames - 1; playing = false; draw(idx); return; }
                idx = 0;
            }
            if (idx < 0) { idx = 0; }
            draw(idx);
            timer = setTimeout(tick, Math.max(20, Math.round(100 / rate)));
        }

        function play() {
            if (playing) { return; }
            playing = true;
            tick();
        }
        function pause() {
            playing = false;
            clearTimeout(timer);
        }
        function toggle() { if (playing) { pause(); } else { play(); } }
        function seek(n) {
            idx = Math.max(0, Math.min(frames - 1, Number(n) || 0));
            draw(idx);
        }
        function setRate(r) {
            rate = Number(r) || 1;
            if (playing) { clearTimeout(timer); timer = setTimeout(tick, Math.max(20, Math.round(100 / rate))); }
        }
        function setLoop(m) { loopMode = m || 'infinite'; }
        function destroy() {
            destroyed = true;
            playing = false;
            clearTimeout(timer);
            try { decoder.close(); } catch (e) { /* ignore */ }
        }

        await draw(0);
        if (opt.onReady) { opt.onReady(frames); }
        tick();

        return {
            canvas: canvas,
            play: play,
            pause: pause,
            toggle: toggle,
            seek: seek,
            setRate: setRate,
            setLoop: setLoop,
            destroy: destroy,
            isPlaying: function () { return playing; },
            frame: function () { return idx + 1; },
            total: function () { return frames; }
        };
    }

    root.VRAnim = { attach: attach, supported: supported };
})();
