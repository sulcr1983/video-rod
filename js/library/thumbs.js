/* ==========================================================
 * VRThumbs —— 资源库缩略图队列（S3）
 *
 * 口径：并发 2、懒生成、WebP 缓存到 IDB thumb store；失败只留占位，
 * 不重试超过 1 次，不阻塞列表渲染。
 * 依赖：VRDB、VRPath；零依赖，挂 self.VRThumbs。
 * ========================================================== */
(function (root) {
    'use strict';

    var MAX_RUNNING = 2;
    var MAX_EDGE = 400;   /* F8：卡片最宽 268px，400 已够 1.5x，5 万张约省 30-40% */
    var QUALITY = 0.66;
    var TIMEOUT = 8000;

    var queue = [];
    var running = 0;
    var inflight = {};

    function dbReady() {
        return typeof root.VRDB !== 'undefined' && root.VRDB && typeof root.VRDB.putThumb === 'function';
    }

    function timeout(ms) {
        return new Promise(function (_, reject) {
            setTimeout(function () { reject(new Error('thumb timeout')); }, ms);
        });
    }

    function loadImage(url) {
        return Promise.race([timeout(TIMEOUT), new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('image load failed')); };
            img.src = url;
        })]);
    }

    function loadVideoFrame(url) {
        return Promise.race([timeout(TIMEOUT), new Promise(function (resolve, reject) {
            var v = document.createElement('video');
            var settled = false;

            function fail() {
                if (settled) { return; }
                settled = true;
                cleanup();
                reject(new Error('video frame failed'));
            }

            function cleanup() {
                try { v.removeAttribute('src'); v.load(); } catch (e) { /* 忽略 */ }
            }

            function draw() {
                if (settled) { return; }
                settled = true;
                cleanup();
                resolve(v);
            }

            v.muted = true;
            v.preload = 'metadata';
            v.onerror = fail;
            v.onloadeddata = function () {
                try {
                    var t = Math.min(1, Math.max(0, (v.duration || 2) / 3));
                    v.currentTime = t;
                } catch (e) {
                    draw();
                }
            };
            v.onseeked = draw;
            v.src = url;
        })]);
    }

    function toCanvas(source, w, h) {
        var scale = Math.min(1, MAX_EDGE / Math.max(w || 1, h || 1));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((w || 1) * scale));
        canvas.height = Math.max(1, Math.round((h || 1) * scale));
        var ctx = canvas.getContext('2d');
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        return canvas;
    }

    function canvasToBlob(canvas) {
        return new Promise(function (resolve) {
            if (!canvas.toBlob) { resolve(null); return; }
            canvas.toBlob(function (b) { resolve(b); }, 'image/webp', QUALITY);
        });
    }

    function announce(relPath, payload) {
        try {
            window.dispatchEvent(new CustomEvent('vrthumb', {
                detail: Object.assign({ relPath: relPath }, payload)
            }));
        } catch (e) { /* 忽略 */ }
    }

    async function cached(entry) {
        if (!entry || !entry.thumbKey || !dbReady()) { return null; }
        try {
            var t = await root.VRDB.getThumb(entry.thumbKey);
            if (t && t.blob) { return t; }
        } catch (e) { /* 继续生成 */ }
        return null;
    }

    async function generate(entry) {
        if (!entry || !entry.absPath || entry.state === 'missing') { return null; }
        if (!root.VRPath || !root.VRPath.toFileUrl) { return null; }
        if (entry.type !== 'image' && entry.type !== 'video') { return null; }

        var url = root.VRPath.toFileUrl(entry.absPath);
        var source;
        var w = 0;
        var h = 0;

        if (entry.type === 'image') {
            source = await loadImage(url);
            w = source.naturalWidth;
            h = source.naturalHeight;
        } else {
            source = await loadVideoFrame(url);
            w = source.videoWidth;
            h = source.videoHeight;
        }
        if (!w || !h) { return null; }

        var canvas = toCanvas(source, w, h);
        var blob = await canvasToBlob(canvas);
        if (!blob) { return null; }

        var thumbKey = 't:' + entry.relPath;
        if (dbReady()) {
            await root.VRDB.putThumb(thumbKey, blob, canvas.width, canvas.height);
            /* F1 分辨率回写：这里是唯一能拿到「原始宽高」的时刻（解码文件时），
               错过之后要重解码全库才能补，所以顺手写进条目（DB 白名单已在 mergeEntry 保留） */
            var patch = { thumbKey: thumbKey, width: w, height: h };
            if (entry.type === 'video' && source && source.duration) {
                patch.duration = Math.round(source.duration * 10) / 10;
            }
            try { await root.VRDB.patchFile(entry.relPath, patch); } catch (e) { /* 忽略 */ }
        }
        return { blob: blob, w: canvas.width, h: canvas.height, thumbKey: thumbKey };
    }

    function pump() {
        while (running < MAX_RUNNING && queue.length) {
            var entry = queue.shift();
            running++;
            (function (it) {
                Promise.resolve()
                    .then(function () {
                        return cached(it).then(function (hit) {
                            if (hit) {
                                announce(it.relPath, hit);
                                return null;
                            }
                            return generate(it).then(function (made) {
                                if (made) { announce(it.relPath, made); }
                            });
                        });
                    })
                    .catch(function () { /* 单条失败静默，保留占位 */ })
                    .then(function () {
                        running--;
                        delete inflight[it.relPath];
                        pump();
                    });
            })(entry);
        }
    }

    /** 加入队列；重复入队/音频/缺失条目直接忽略 */
    function enqueue(entry) {
        if (!entry || !entry.relPath) { return; }
        if (inflight[entry.relPath]) { return; }
        if (entry.type !== 'image' && entry.type !== 'video') { return; }
        if (entry.state === 'missing') { return; }
        inflight[entry.relPath] = 1;
        queue.push(entry);
        pump();
    }

    root.VRThumbs = {
        enqueue: enqueue,
        clear: function () { queue.length = 0; },
        // 测试用
        _size: function () { return queue.length; }
    };
})(typeof self !== 'undefined' ? self : this);
