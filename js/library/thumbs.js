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
    /* 视频文件比图片大得多，moov atom 在尾部的 MP4 要读到文件末尾才有 metadata。
     * 实测 93MB / 18.5MB 两个真机下载文件 10s 内连 loadedmetadata 都不触发，
     * 8s 超时必然失败 → 单独给视频 30s，图片仍用 8s。 */
    var VIDEO_TIMEOUT = 30000;

    var queue = [];
    var running = 0;
    var inflight = {};

    /* 失败记忆：同一文件失败到上限就不再自动重试。
     * 原实现失败后一干二净（delete inflight），下次重绘又从头烧一遍超时 ——
     * 虚拟滚动反复重绘时，一个坏文件能把队列堵满。 */
    var MAX_ATTEMPT = 2;
    var failed = Object.create(null);   // relPath -> 已失败次数

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
        var v = document.createElement('video');
        var settled = false;
        var graceful = 0;

        function cleanup() {
            try { v.removeAttribute('src'); v.load(); } catch (e) { /* 忽略 */ }
        }

        return Promise.race([
            /* 超时兜底：必须把 <video> 一起拆掉。
             * 原实现只 reject，挂着的 <video> 仍占着 MAX_RUNNING=2 的并发槽，
             * 后续条目排队等到天荒地老 —— 大文件连续失败时整库都不出图。 */
            timeout(VIDEO_TIMEOUT).catch(function (e) {
                if (!settled) { settled = true; cleanup(); }
                throw e;
            }),
            new Promise(function (resolve, reject) {
                function fail() {
                    if (settled) { return; }
                    settled = true;
                    clearTimeout(graceful);
                    cleanup();
                    reject(new Error('video frame failed'));
                }

                function draw() {
                    if (settled) { return; }
                    settled = true;
                    clearTimeout(graceful);
                    /* 先把解码好的这一帧交给调用方画进 canvas，再清 src。
                     * 原实现先 cleanup() 会清掉帧 → 画出来空白。 */
                    resolve(v);
                    setTimeout(cleanup, 0);
                }

                /* 首帧已可画：大文件等 seek 太慢时直接用它兜底 */
                function drawFirst() {
                    if (settled || !v.videoWidth) { return; }
                    draw();
                }

                /* seek 到 1/3 处拿更有代表性的一帧；失败就退回首帧 */
                function seekFor() {
                    if (settled) { return; }
                    try {
                        var t = Math.min(1, Math.max(0, (v.duration || 2) / 3));
                        if (Math.abs((v.currentTime || 0) - t) < 0.05) { drawFirst(); return; }
                        v.currentTime = t;
                    } catch (e) {
                        drawFirst();
                    }
                }

                v.muted = true;
                v.preload = 'auto';
                v.onerror = fail;

                /* 关键顺序：loadeddata 之后**先去 seek**，等 onseeked 再 draw。
                 * 若在这里直接 drawFirst()，会立刻以首帧结算，
                 * seek 出来的那一帧永远用不上（settled 已置位）。 */
                v.onloadeddata = function () {
                    if (settled) { return; }
                    seekFor();
                    /* 3 秒内 seek 还没回来就用当前首帧兜底 —— 比原来无条件盲等 3 秒快，
                     * 只在真卡住时才等满。 */
                    graceful = setTimeout(drawFirst, 3000);
                };

                v.onseeked = draw;

                v.src = url;
            })
        ]);
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
        if (!entry || entry.state === 'missing') { return null; }
        if (entry.type !== 'image' && entry.type !== 'video') { return null; }
        /* 自选文件夹没有绝对路径；VRFile 会用目录句柄读文件并生成 object URL。
         * 用完必须 revoke，否则每次重扫都漏一个 Blob URL。 */
        var resolved = root.VRFile ? await root.VRFile.resolve(entry) : null;
        if (!resolved || !resolved.url) { return null; }

        var source;
        var w = 0;
        var h = 0;
        try {
            if (entry.type === 'image') {
                source = await loadImage(resolved.url);
                w = source.naturalWidth;
                h = source.naturalHeight;
            } else {
                source = await loadVideoFrame(resolved.url);
                w = source.videoWidth;
                h = source.videoHeight;
            }
            if (!w || !h) { return null; }

            var canvas = toCanvas(source, w, h);
            var blob = await canvasToBlob(canvas);
            if (!blob) { return null; }

            var thumbKey = 't:' + entry.relPath;
            if (!dbReady()) {
                /* 库没准备好时不能算成功：原实现照样 return 对象，
                 * UI 有图但刷新即失，条目也永远没有 thumbKey。 */
                return null;
            }
            await root.VRDB.putThumb(thumbKey, blob, canvas.width, canvas.height);
            /* F1 分辨率回写：这里是唯一能拿到「原始宽高」的时刻（解码文件时），
               错过之后要重解码全库才能补，所以顺手写进条目（DB 白名单已在 mergeEntry 保留） */
            var patch = { thumbKey: thumbKey, width: w, height: h };
            if (entry.type === 'video' && source && source.duration) {
                patch.duration = Math.round(source.duration * 10) / 10;
            }
            /* patchFile 失败不能吞：吞了就会出现「thumb 表里有 blob、条目却没 thumbKey」，
             * 于是 cached() 永不命中，每次进视口都重新抽 30 秒。
             * 注意 db.js:104-110 在条目不存在时返回 null 而不是抛错，必须显式检查。 */
            var saved = await root.VRDB.patchFile(entry.relPath, patch);
            if (!saved) {
                throw new Error('patchFile missed: ' + entry.relPath);
            }
            return { blob: blob, w: canvas.width, h: canvas.height, thumbKey: thumbKey };
        } finally {
            if (resolved.revoke) { resolved.revoke(); }
        }
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
                                if (made) {
                                    failed[it.relPath] = 0;   // 成功即清零
                                    announce(it.relPath, made);
                                }
                            });
                        });
                    })
                    .catch(function (err) {
                        /* 记一次失败并留痕（原来纯静默，排查时完全看不到原因）。
                         * 达到上限后 enqueue 会直接跳过，不再反复烧超时。 */
                        failed[it.relPath] = (failed[it.relPath] || 0) + 1;
                        try {
                            if (failed[it.relPath] === 1) {
                                console.warn('[video-rod] 缩略图生成失败',
                                    it.relPath, (err && err.message) || err);
                            }
                        } catch (e) { /* 忽略 */ }
                    })
                    .then(function () {
                        running--;
                        delete inflight[it.relPath];
                        pump();
                    });
            })(entry);
        }
    }

    /** 条目是否可生成缩略图：type 缺失时按扩展名兜底。
     *  实测有存量条目的 type 是空串（如 VFE 那两个），原来会被直接拒之门外，
     *  表现就是「这些视频永远没有预览图」。 */
    function kindOf(entry) {
        if (!entry) { return ''; }
        if (entry.type === 'image' || entry.type === 'video') { return entry.type; }
        var p = String(entry.relPath || '').toLowerCase();
        if (/\.(jpe?g|png|gif|webp|avif|bmp|svg|heic)$/.test(p)) { return 'image'; }
        if (/\.(mp4|m4v|mov|webm|mkv|avi|flv|ts)$/.test(p)) { return 'video'; }
        return '';
    }

    /** 加入队列；重复入队/音频/缺失条目直接忽略 */
    function enqueue(entry) {
        if (!entry || !entry.relPath) { return; }
        if (inflight[entry.relPath]) { return; }
        var kind = kindOf(entry);
        if (!kind) { return; }
        /* 把推断结果写回 entry：generate() 里按 entry.type 分流，空串会走错分支 */
        if (!entry.type) { entry.type = kind; }
        if (entry.state === 'missing') { return; }
        /* 失败到上限就不再自动重试：避免每次重绘都重烧 30 秒超时。
         * 手动重试走 retry()，会清掉失败计数。 */
        if ((failed[entry.relPath] || 0) >= MAX_ATTEMPT) { return; }
        inflight[entry.relPath] = 1;
        queue.push(entry);
        pump();
    }

    /** 清掉某条（或全部）的失败记忆，让它下次能被重新尝试 */
    function retry(relPath) {
        if (relPath) {
            delete failed[relPath];
        } else {
            failed = Object.create(null);
        }
    }

    root.VRThumbs = {
        enqueue: enqueue,
        retry: retry,
        clear: function () { queue.length = 0; failed = Object.create(null); },
        // 测试用
        _size: function () { return queue.length; },
        _failed: function (relPath) { return failed[relPath] || 0; }
    };
})(typeof self !== 'undefined' ? self : this);
