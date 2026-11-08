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

    /**
     * 缩略图是否需要重建（mtime + size 双校验）。
     *
     * 为什么必须两个字段一起比：
     *   freedesktop Thumbnail Managing Standard §7 明确写了「仅靠 mtime 不够」——
     *   文件被别的文件覆盖时 mtime 可能**变小**，只判 `file.mtime > thumb.mtime`
     *   就会漏判，用户看到的是旧图。
     *   同理只比 size 会漏掉「同尺寸不同内容」。
     *
     * 缺字段时保守返回 true：宁可多生成一次，也不要显示错图。
     *
     * @param {object} entry   条目（需 mtime / size）
     * @param {object|null} src 已存记录 {mtime, size}
     * @returns {boolean} true = 需要重建
     */
    function shouldRefresh(entry, src) {
        if (!entry) { return true; }
        if (!src) { return true; }
        if (src.mtime == null || src.size == null) { return true; }
        if (Number(src.mtime) !== Number(entry.mtime)) { return true; }
        if (Number(src.size) !== Number(entry.size)) { return true; }
        return false;
    }

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

    /* ---------------- 落盘（B-33） ----------------
 *
 * 为什么要落盘：
 *   缩略图原来只存在 IDB 的 thumb store 里，重装系统即失，
 *   必须对全部素材重新解码（上万条非常慢）。
 *   写进 <根>/_library/thumbs/<hash>.webp 后跟着素材文件夹走。
 *
 * 为什么用 hash 文件名而不是 relPath：
 *   relPath 含中文、@、#、斜杠，不能直接当文件名。
 *   这是 freedesktop Thumbnail Managing Standard 的做法。
 *
 * 为什么所有落盘失败都静默降级：
 *   磁盘满 / 无权限 / 未授权目录时，用户仍应能正常浏览（哪怕图片是现生成的）。
 *   缩略图是性能优化，不是数据本身。
 */

var THUMB_DIR = 'thumbs';
var THUMB_EXT = '.webp';

/** 拿 <根>/_library/thumbs 目录句柄；没有授权目录时返回 null */
async function thumbDirHandle(create) {
    if (typeof root.VRDB === 'undefined' || !root.VRDB || typeof root.VRDB.getHandle !== 'function') {
        return null;
    }
    var handle = null;
    try { handle = await root.VRDB.getHandle('root'); } catch (e) { return null; }
    if (!handle || typeof handle.getDirectoryHandle !== 'function') { return null; }
    try {
        var lib = await handle.getDirectoryHandle('_library', { create: !!create });
        return await lib.getDirectoryHandle(THUMB_DIR, { create: !!create });
    } catch (e) {
        return null;
    }
}

/**
 * 把缩略图写进磁盘。
 * @param {string} relPath
 * @param {Blob} blob
 * @returns {Promise<string|null>} 成功返回文件名（不含扩展名），失败 null
 */
async function saveToDisk(relPath, blob) {
    if (!blob || !relPath) { return null; }
    try {
        var dir = await thumbDirHandle(true);
        if (!dir) { return null; }
        var name = await root.VRPath.thumbFileName(relPath);
        var fh = await dir.getFileHandle(name + THUMB_EXT, { create: true });
        var w = await fh.createWritable();
        try {
            await w.write(blob);
            await w.close();
        } catch (e) {
            try { await w.abort(); } catch (e2) { /* 已关闭则忽略 */ }
            throw e;
        }
        return name;
    } catch (e) {
        return null;        /* 静默降级：不影响浏览 */
    }
}

/**
 * 从磁盘读回缩略图。
 * @returns {Promise<Blob|null>}
 */
async function loadFromDisk(relPath) {
    if (!relPath) { return null; }
    try {
        var dir = await thumbDirHandle(false);
        if (!dir) { return null; }
        var name = await root.VRPath.thumbFileName(relPath);
        var fh = await dir.getFileHandle(name + THUMB_EXT);
        var f = await fh.getFile();
        return f && f.size ? f : null;
    } catch (e) {
        return null;
    }
}

/**
 * 删除某条目对应的磁盘缩略图（rename / move / delete 时必须调）。
 *
 * 为什么必须有（红队 b-2/b-3/b-4）：
 *   改名、移动、删除素材时，原实现只清 thumbKey 或只删 file 条目，
 *   磁盘上的 .webp 会永远留着 —— 落盘后每个孤儿都是一个真实文件。
 *
 * @param {string|string[]} relPaths
 * @returns {Promise<number>} 成功删除数
 */
async function deleteFor(relPaths) {
    var list = Array.isArray(relPaths) ? relPaths : [relPaths];
    list = list.filter(Boolean);
    if (!list.length) { return 0; }
    var dir = null;
    try { dir = await thumbDirHandle(false); } catch (e) { return 0; }
    if (!dir) { return 0; }
    var n = 0;
    for (var i = 0; i < list.length; i++) {
        try {
            var name = await root.VRPath.thumbFileName(list[i]);
            await dir.removeEntry(name + THUMB_EXT);
            n++;
        } catch (e) { /* 不存在就算了 */ }
    }
    return n;
}

/**
 * 清理孤儿缩略图：磁盘上有、但没有任何条目引用。
 *
 * @param {object} opts { entries, dryRun }
 *        entries = 当前库全部条目（用于算出「哪些 hash 是活的」）
 * @returns {Promise<{removed:number, kept:number, failed:number}>}
 */
async function gc(opts) {
    var o = opts || {};
    var entries = Array.isArray(o.entries) ? o.entries : [];
    var dir = null;
    try { dir = await thumbDirHandle(false); } catch (e) { return { removed: 0, kept: 0, failed: 0 }; }
    if (!dir) { return { removed: 0, kept: 0, failed: 0 }; }

    var live = Object.create(null);
    for (var i = 0; i < entries.length; i++) {
        var rp = entries[i] && entries[i].relPath;
        if (!rp) { continue; }
        try { live[await root.VRPath.thumbFileName(rp)] = 1; } catch (e) { /* 忽略 */ }
    }

    var removed = 0, kept = 0, failed = 0;
    try {
        for await (var e of dir.entries()) {
            var nm = e[0];
            if (e[1].kind !== 'file' || !/\.webp$/i.test(nm)) { continue; }
            var key = nm.replace(/\.webp$/i, '');
            if (live[key]) { kept++; continue; }
            if (o.dryRun) { removed++; continue; }
            try { await dir.removeEntry(nm); removed++; }
            catch (err) { failed++; }
        }
    } catch (err2) {
        return { removed: removed, kept: kept, failed: failed + 1 };
    }
    return { removed: removed, kept: kept, failed: failed };
}

function announce(relPath, payload) {
        try {
            window.dispatchEvent(new CustomEvent('vrthumb', {
                detail: Object.assign({ relPath: relPath }, payload)
            }));
        } catch (e) { /* 忽略 */ }
    }

    async function cached(entry) {
        if (!entry || !dbReady()) { return null; }
        /* 失效判定（B-33 / freedesktop 规范 §7）：
         * 源文件的 mtime 或 size 变了，说明内容已换，旧缩略图必须作废。
         * 缺 thumbSrc（老数据）时保守视为需重建 —— 宁可多生成一次，也不显示错图。 */
        if (entry.thumbSrc && shouldRefresh(entry, entry.thumbSrc)) {
            return null;        /* 交给 generate 重建，并覆盖磁盘文件 */
        }
        /* ① IDB 命中：最快路径，正常浏览都走这里 */
        if (entry.thumbKey) {
            try {
                var t = await root.VRDB.getThumb(entry.thumbKey);
                if (t && t.blob) { return t; }
            } catch (e) { /* 继续往下 */ }
        }
        /* ② IDB 没有 → 读磁盘（重装系统后走这条，避免重新解码上万条） */
        try {
            var blob = await loadFromDisk(entry.relPath);
            if (blob) {
                /* 回填 IDB，下次可直接命中；失败不影响本次显示 */
                var key = 't:' + entry.relPath;
                try { await root.VRDB.putThumb(key, blob, 0, 0); } catch (e2) { /* 忽略 */ }
                return { blob: blob, w: 0, h: 0, thumbKey: key };
            }
        } catch (e3) { /* 继续生成 */ }
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
            /* 先落盘，再写记录（红队 a-4：原来 putThumb 与 patchFile 非原子，
             * 中途失败会留下「thumb 表有 blob、条目无 thumbKey」的僵尸态）。
             * 顺序理由：
             *   · 落盘失败 → 只写 IDB，功能照常，只是重装后要重新生成（静默降级）
             *   · 落盘成功 → 记录 thumbFile + thumbSrc，重装后可直接读盘
             * 两者都不会留下「引用了不存在的文件」的状态。 */
            var thumbFile = await saveToDisk(entry.relPath, blob);
            if (thumbFile) {
                patch.thumbFile = thumbFile;
                patch.thumbSrc = {
                    mtime: Number(entry.mtime) || 0,
                    size: Number(entry.size) || 0
                };
            }
            await root.VRDB.putThumb(thumbKey, blob, canvas.width, canvas.height);
            /* patchFile 失败不能吞：吞了就会出现「thumb 表里有 blob、条目却没 thumbKey」，
             * 于是 cached() 永不命中，每次进视口都重新抽 30 秒。
             * 注意 db.js:104-110 在条目不存在时返回 null 而不是抛错，必须显式检查。 */
            var saved = await root.VRDB.patchFile(entry.relPath, patch);
            if (!saved) {
                throw new Error('patchFile missed: ' + entry.relPath);
            }
            return {
                blob: blob, w: canvas.width, h: canvas.height,
                thumbKey: thumbKey, thumbFile: thumbFile || ''
            };
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
        shouldRefresh: shouldRefresh,
        /* 落盘能力（B-33） */
        saveToDisk: saveToDisk,
        loadFromDisk: loadFromDisk,
        deleteFor: deleteFor,
        gc: gc,
        THUMB_DIR: THUMB_DIR,
        THUMB_EXT: THUMB_EXT,
        // 测试用
        _size: function () { return queue.length; },
        _failed: function (relPath) { return failed[relPath] || 0; }
    };
})(typeof self !== 'undefined' ? self : this);
