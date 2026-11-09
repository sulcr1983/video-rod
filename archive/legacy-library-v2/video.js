/* ==========================================================
 * VRVideo —— 查看器视频控制（S4）
 *
 * 自绘控件：播放/暂停、进度、时间、音量、倍速、全屏、连播。
 * 不使用原生 controls（原生控件会吞 ↑↓，也不好和队列统一）。
 * 依赖：无，挂 self.VRVideo。
 * ========================================================== */
(function (root) {
    'use strict';

    var el = null;
    var onEnded = null;
    var bound = false;
    var seeking = false;

    var bar, btnPlay, seek, time, btnMute, vol, rate, auto, btnFull;

    function $(id) { return document.getElementById(id); }

    function fmt(sec) {
        sec = Math.max(0, Math.floor(Number(sec) || 0));
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        if (h) { return h + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2); }
        return m + ':' + ('0' + s).slice(-2);
    }

    function bindUi() {
        if (bound) { return; }
        bar = $('libVideoCtl');
        btnPlay = $('libVideoPlay');
        seek = $('libVideoSeek');
        time = $('libVideoTime');
        btnMute = $('libVideoMute');
        vol = $('libVideoVol');
        rate = $('libVideoRate');
        auto = $('libVideoAuto');
        btnFull = $('libVideoFull');
        if (!bar) { return; }
        bound = true;

        btnPlay.addEventListener('click', function () { toggle(); });
        btnMute.addEventListener('click', function () {
            if (!el) { return; }
            el.muted = !el.muted;
            if (!el.muted && el.volume === 0) { el.volume = 1; vol.value = '100'; }
            paintMute();
        });

        vol.addEventListener('input', function () {
            if (!el) { return; }
            el.volume = Number(this.value) / 100;
            el.muted = Number(this.value) === 0;
            paintMute();
        });

        rate.addEventListener('change', function () {
            if (el) { el.playbackRate = Number(this.value); }
        });

        btnFull.addEventListener('click', function () {
            var box = $('libViewer');
            if (!box) { return; }
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(function () { /* 忽略 */ });
            } else if (box.requestFullscreen) {
                box.requestFullscreen().catch(function () { /* 忽略 */ });
            }
        });

        seek.addEventListener('pointerdown', function () { seeking = true; });
        seek.addEventListener('pointerup', function () { seeking = false; });
        seek.addEventListener('change', function () { seeking = false; });
        seek.addEventListener('input', function () {
            if (!el || !isFinite(el.duration) || el.duration <= 0) { return; }
            el.currentTime = (Number(this.value) / 1000) * el.duration;
            paintTime();
        });
    }

    function paintTime() {
        if (!el) { return; }
        var dur = isFinite(el.duration) ? el.duration : 0;
        var cur = Number(el.currentTime) || 0;
        time.textContent = fmt(cur) + ' / ' + fmt(dur);
        if (!seeking && dur > 0) {
            seek.value = String(Math.round((cur / dur) * 1000));
        }
    }

    function paintPlay() {
        if (!btnPlay) { return; }
        btnPlay.textContent = el && !el.paused ? '❚❚' : '▶';
    }

    function paintMute() {
        if (!btnMute || !el) { return; }
        btnMute.textContent = (el.muted || el.volume === 0) ? '🔇' : '🔊';
    }

    function handleEnded() {
        paintPlay();
        if (auto && auto.checked && typeof onEnded === 'function') { onEnded(); }
    }

    function attach(video, opts) {
        bindUi();
        el = video;
        onEnded = opts && opts.onEnded;
        if (!bar) { return; }

        bar.hidden = false;
        if (auto) { auto.checked = true; }
        if (rate) { rate.value = '1'; }
        if (vol) { vol.value = '100'; }
        seek.value = '0';
        time.textContent = '0:00 / 0:00';

        video.addEventListener('timeupdate', paintTime);
        video.addEventListener('durationchange', paintTime);
        video.addEventListener('loadedmetadata', paintTime);
        video.addEventListener('play', paintPlay);
        video.addEventListener('pause', paintPlay);
        video.addEventListener('ended', handleEnded);
        video.addEventListener('click', function () { toggle(); });
        video.addEventListener('volumechange', paintMute);

        paintPlay();
        paintMute();
        paintTime();
    }

    function destroy() {
        if (el) {
            try {
                el.pause();
                el.removeAttribute('src');
                el.load();
            } catch (e) { /* 忽略 */ }
        }
        el = null;
        onEnded = null;
        if (bar) { bar.hidden = true; }
    }

    function toggle() {
        if (!el) { return; }
        if (el.paused) {
            var p = el.play();
            if (p && p.catch) { p.catch(function () { /* 自动播放被拦截时保持暂停 */ }); }
        } else {
            el.pause();
        }
    }

    function calcSeek(curTime, duration, delta) {
        var dur = isFinite(duration) && duration > 0 ? duration : 0;
        var next = (Number(curTime) || 0) + delta;
        if (dur > 0) { return Math.min(dur - 0.05, Math.max(0, next)); }
        return Math.max(0, next);
    }

    function seekBy(delta) {
        if (!el) { return; }
        el.currentTime = calcSeek(el.currentTime, el.duration, delta);
        paintTime();
    }

    function seekTo(t) {
        if (!el) { return; }
        el.currentTime = Math.max(0, Number(t) || 0);
        paintTime();
    }

    root.VRVideo = {
        attach: attach,
        destroy: destroy,
        toggle: toggle,
        seekBy: seekBy,
        seekTo: seekTo,
        current: function () { return el; },
        isActive: function () { return !!el; },
        _calc: calcSeek
    };
})(typeof self !== 'undefined' ? self : this);
