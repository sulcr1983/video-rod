/* ==========================================================
 * VRTrash —— 删除与回收站（S5）
 *
 * 口径：默认软删除到 <根>/_回收站/<批次>/<原相对路径>，批次内写
 * _manifest.json；恢复原路径空着才写回；彻底删除只删回收站副本。
 * 依赖：VRDB、VRIndex（resolveRoot 可选）；挂 self.VRTrash。
 * ========================================================== */
(function (root) {
    'use strict';

    var TRASH = '_回收站';
    var LOG_DIR = '_migration';
    var MANIFEST = '_manifest.json';

    function makeErr(code, msg) {
        var e = new Error(msg || code);
        e.code = code;
        return e;
    }

    function errCode(e) {
        return (e && e.code) || 'LIB_E_TRASH';
    }

    function split(rel) {
        return String(rel || '').replace(/\\/g, '/').split('/').filter(Boolean);
    }

    /** 索引 relPath 首段是 subdir（video-rod），FSA 句柄指向库根，物理操作要剥掉首段。 */
    function stripPrefix(rel, prefix) {
        var p = prefix ? (String(prefix).replace(/^\/+|\/+$/g, '') + '/') : '';
        return (p && String(rel).indexOf(p) === 0) ? String(rel).slice(p.length) : rel;
    }

    function stamp() {
        var d = new Date();
        function p(n) { return ('0' + n).slice(-2); }
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
            p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '-' +
            Math.random().toString(36).slice(2, 6);
    }

    function dbReady() {
        return typeof root.VRDB !== 'undefined' && root.VRDB;
    }

    /* ---------------- 根目录与权限 ---------------- */

    async function resolveRoot() {
        if (root.VRIndex && typeof root.VRIndex.resolveRoot === 'function') {
            return root.VRIndex.resolveRoot();
        }
        var handle = null;
        var absRoot = '';
        if (dbReady()) {
            try { handle = await root.VRDB.getHandle('root'); } catch (e) { /* 忽略 */ }
            try { absRoot = await root.VRDB.getSetting('rootAbs', ''); } catch (e) { /* 忽略 */ }
        }
        return { handle: handle || null, absRoot: absRoot || '', source: 'db' };
    }

    async function ensureRW(handle) {
        if (!handle) {
            throw makeErr('LIB_E_NO_PERM', '需要一次目录授权才能删除');
        }
        if (typeof handle.queryPermission !== 'function') { return; }
        var state = 'prompt';
        try {
            state = await handle.queryPermission({ mode: 'readwrite' });
        } catch (e) {
            // 陈旧/跨档案的目录句柄会抛 "Permissions check failed"，包成可读错误别冒到按钮上
            throw makeErr('LIB_E_NO_PERM', '目录句柄已失效，请到设置里重新选一次目录');
        }
        if (state === 'granted') { return; }
        if (typeof handle.requestPermission === 'function') {
            try { state = await handle.requestPermission({ mode: 'readwrite' }); }
            catch (e2) { state = 'denied'; }
        }
        if (state !== 'granted') {
            throw makeErr('LIB_E_NO_PERM', '目录写权限未授权');
        }
    }

    /* ---------------- 文件系统小工具 ---------------- */

    async function dirAt(rootHandle, segs, create) {
        var dir = rootHandle;
        for (var i = 0; i < segs.length; i++) {
            dir = await dir.getDirectoryHandle(segs[i], { create: !!create });
        }
        return dir;
    }

    async function fileAt(rootHandle, rel) {
        var segs = split(rel);
        var name = segs.pop();
        if (!name) { throw makeErr('LIB_E_PATH', '空路径'); }
        var dir = await dirAt(rootHandle, segs, false);
        return dir.getFileHandle(name, { create: false });
    }

    async function exists(rootHandle, rel) {
        try {
            await fileAt(rootHandle, rel);
            return true;
        } catch (e) {
            return false;
        }
    }

    async function writeText(rootHandle, rel, text) {
        var segs = split(rel);
        var name = segs.pop();
        var dir = await dirAt(rootHandle, segs, true);
        var handle = await dir.getFileHandle(name, { create: true });
        var w = await handle.createWritable();
        try {
            await w.write(text);
        } finally {
            await w.close();
        }
    }

    async function readJson(rootHandle, rel) {
        try {
            var handle = await fileAt(rootHandle, rel);
            var file = await handle.getFile();
            return JSON.parse(await file.text());
        } catch (e) {
            return null;
        }
    }

    async function writeManifest(rootHandle, batchRel, manifest) {
        await writeText(rootHandle, batchRel + '/' + MANIFEST, JSON.stringify(manifest, null, 2));
    }

    async function removeBatchDir(rootHandle, batch) {
        try {
            var trashDir = await dirAt(rootHandle, [TRASH], false);
            await trashDir.removeEntry(batch, { recursive: true });
        } catch (e) { /* 已不存在 */ }
    }

    /** 复制 → 校验大小 → 删源；不依赖 FSA move() */
    async function moveFile(rootHandle, fromRel, toRel, opts) {
        opts = opts || {};
        /* 移动也是写盘操作：必须和删除一样先确认句柄/S 权限。
         * 原实现没有这一步，授权过期时会在 createWritable 才失败。 */
        await ensureRW(rootHandle);
        if (opts.noOverwrite && await exists(rootHandle, toRel)) {
            throw makeErr('LIB_E_EXISTS', '目标已存在，未覆盖：' + toRel);
        }
        var srcHandle = await fileAt(rootHandle, fromRel);
        var srcFile = await srcHandle.getFile();

        var segs = split(toRel);
        var name = segs.pop();
        var dstDir = await dirAt(rootHandle, segs, true);
        var dstHandle = await dstDir.getFileHandle(name, { create: true });
        var w = await dstHandle.createWritable();
        try {
            await w.write(srcFile);
        } finally {
            await w.close();
        }

        var dstFile = await dstHandle.getFile();
        if (dstFile.size !== srcFile.size) {
            try { await dstDir.removeEntry(name); } catch (e) { /* 忽略 */ }
            throw makeErr('LIB_E_COPY', '复制后大小不一致');
        }

        var srcSegs = split(fromRel);
        var srcName = srcSegs.pop();
        var srcDir = await dirAt(rootHandle, srcSegs, false);
        await srcDir.removeEntry(srcName);
        return { size: srcFile.size };
    }

    async function writeOps(rootHandle, action, payload) {
        try {
            var rel = LOG_DIR + '/ops-' + stamp() + '.json';
            await writeText(rootHandle, rel, JSON.stringify({
                action: action,
                at: Date.now(),
                payload: payload
            }, null, 2));
        } catch (e) { /* 日志失败不阻断 */ }
    }

    /* ---------------- 删除 ---------------- */

    async function remove(relPaths, opt) {
        var o = opt || {};
        var onProgress = typeof o.onProgress === 'function' ? o.onProgress : null;
        var batch = stamp();
        var batchRel = TRASH + '/' + batch;
        var list = (relPaths || []).filter(Boolean);

        var rr = await resolveRoot();
        await ensureRW(rr.handle);

        var items = [];
        var failed = [];
        var cleaned = 0;

        for (var i = 0; i < list.length; i++) {
            var rel = list[i];
            var fsRel = stripPrefix(rel, rr.prefix);
            /* 进度必须在每次进入下一条之前报一次。原来只有「正常走完」才报，
             * 而「文件已不存在」「只减引用」两条分支是 continue，会漏报，
             * 大批量下进度条卡住不动（2026-11-06 自查）。 */
            function tick() {
                if (!onProgress) { return; }
                try { onProgress({ done: i + 1, total: list.length, relPath: rel }); } catch (e2) { /* 忽略 */ }
            }
            try {
                if (!(await exists(rr.handle, fsRel))) {
                    if (dbReady()) { await root.VRDB.deleteFiles([rel]); }
                    /* 顺手清掉磁盘缩略图（红队 b-2）：否则落盘后每个删除都留一个孤儿文件 */
                    try {
                        if (root.VRThumbs && root.VRThumbs.deleteFor) {
                            await root.VRThumbs.deleteFor([rel]);
                        }
                    } catch (e3) { /* 删除失败不影响主流程 */ }
                    cleaned++;
                    tick();
                    continue;
                }
                var entry = null;
                if (dbReady()) {
                    try { entry = await root.VRDB.getFile(rel); }
                    catch (e) {
                        /* 拿不到条目就拿不到 sha256/引用数，后面只能按普通删除走 */
                        console.warn('[trash] 读取条目失败：', rel, e && e.message);
                    }
                }
                // F5 R1：删除 = 只减引用。同指纹还有别的引用时，物理文件留在原地不动
                // （只把这一条移到回收站）；最后一条引用被清空时才真正删物理文件。
                if (entry && entry.sha256 && root.VRDedup) {
                    try {
                        var cnt = await root.VRDedup.refCount(entry.sha256);
                        if (cnt > 1) {
                            // 还有别的引用在用同一个物理文件 → 只删库条目，不动文件
                            await root.VRDB.deleteFiles([rel]);
                            /* 缩略图按 relPath 存，与该条目一一对应，所以也要清（b-2） */
                            try {
                                if (root.VRThumbs && root.VRThumbs.deleteFor) {
                                    await root.VRThumbs.deleteFor([rel]);
                                }
                            } catch (e4) { /* 忽略 */ }
                            items.push(Object.assign({}, entry, {
                                fileName: split(rel).pop(),
                                state: 'ok',
                                isRefOnly: true,
                                refRemaining: cnt - 1
                            }));
                            tick();
                            continue;
                        }
                    } catch (e) {
                        /* 判重失败会退回「普通删除」，可能把别的引用还在用的物理文件删掉。
                         * 静默吞掉等于丢数据无痕，这里至少留一条可追的日志。 */
                        console.warn('[trash] 引用计数失败，按普通删除处理：', rel, e && e.message);
                    }
                }
                await moveFile(rr.handle, fsRel, batchRel + '/' + fsRel);
                items.push(entry || { relPath: rel, fileName: split(rel).pop(), state: 'ok' });
            } catch (e) {
                failed.push({ relPath: rel, code: errCode(e), message: e.message || '' });
            }
            tick();
        }

        if (items.length) {
            await writeManifest(rr.handle, batchRel, {
                version: 1,
                batch: batch,
                at: Date.now(),
                root: rr.absRoot || '',
                items: items
            });
            if (dbReady()) {
                await root.VRDB.deleteFiles(items.map(function (it) { return it.relPath; }));
                /* 批量删除同样要清缩略图（b-2），否则一次删几百条会留几百个孤儿文件 */
                try {
                    if (root.VRThumbs && root.VRThumbs.deleteFor) {
                        await root.VRThumbs.deleteFor(items.map(function (it) { return it.relPath; }));
                    }
                } catch (e4) { /* 忽略 */ }
                try {
                    await root.VRDB.log('trash.remove', { batch: batch, count: items.length },
                        { moved: items.length, cleaned: cleaned, failed: failed.length });
                } catch (e) { /* 忽略 */ }
            }
        } else {
            await removeBatchDir(rr.handle, batch);
        }

        await writeOps(rr.handle, 'delete', {
            batch: batch,
            moved: items.map(function (it) { return it.relPath; }),
            cleaned: cleaned,
            failed: failed
        });

        return { batch: batch, moved: items.length, cleaned: cleaned, failed: failed };
    }

    /* ---------------- 列表 ---------------- */

    async function list() {
        var rr = await resolveRoot();
        if (!rr.handle) { return []; }

        var trashDir;
        try {
            trashDir = await dirAt(rr.handle, [TRASH], false);
        } catch (e) {
            return [];
        }

        var out = [];
        for await (var pair of trashDir.entries()) {
            var name = pair[0];
            var handle = pair[1];
            if (!handle || handle.kind !== 'directory') { continue; }
            var manifest = await readJson(rr.handle, TRASH + '/' + name + '/' + MANIFEST);
            var items = (manifest && manifest.items) || [];
            out.push({
                batch: name,
                at: (manifest && manifest.at) || 0,
                size: items.reduce(function (n, it) { return n + (Number(it.size) || 0); }, 0),
                items: items
            });
        }
        out.sort(function (a, b) { return String(b.batch).localeCompare(String(a.batch)); });
        return out;
    }

    async function status() {
        var batches = await list();
        var count = 0;
        var size = 0;
        batches.forEach(function (b) {
            count += b.items.length;
            size += b.size;
        });
        return { count: count, size: size, batches: batches.length };
    }

    /* ---------------- 恢复 ---------------- */

    async function restore(batch, relPath) {
        var rr = await resolveRoot();
        await ensureRW(rr.handle);

        var batchRel = TRASH + '/' + batch;
        var manifest = await readJson(rr.handle, batchRel + '/' + MANIFEST);
        if (!manifest || !Array.isArray(manifest.items)) {
            throw makeErr('LIB_E_TRASH', '回收站批次不存在或清单损坏');
        }

        var targets = relPath
            ? manifest.items.filter(function (it) { return it.relPath === relPath; })
            : manifest.items.slice();
        if (!targets.length) {
            throw makeErr('LIB_E_TRASH', '回收站里找不到该条目');
        }

        var restored = [];
        var failed = [];

        for (var i = 0; i < targets.length; i++) {
            var it = targets[i];
            var fsRel = stripPrefix(it.relPath, rr.prefix);
            try {
                if (await exists(rr.handle, fsRel)) {
                    throw makeErr('LIB_E_EXISTS', '原位置已有同名文件');
                }
                await moveFile(rr.handle, batchRel + '/' + fsRel, fsRel);
                restored.push(it);
            } catch (e) {
                failed.push({ relPath: it.relPath, code: errCode(e), message: e.message || '' });
            }
        }

        if (restored.length) {
            var done = {};
            restored.forEach(function (it) { done[it.relPath] = 1; });
            var remain = manifest.items.filter(function (it) { return !done[it.relPath]; });
            if (remain.length) {
                manifest.items = remain;
                await writeManifest(rr.handle, batchRel, manifest);
            } else {
                await removeBatchDir(rr.handle, batch);
            }

            if (dbReady()) {
                await root.VRDB.putFiles(restored.map(function (it) {
                    var copy = {};
                    Object.keys(it).forEach(function (k) { copy[k] = it[k]; });
                    copy.state = 'ok';
                    return copy;
                }));
                try {
                    await root.VRDB.log('trash.restore', { batch: batch, count: restored.length },
                        { restored: restored.length, failed: failed.length });
                } catch (e) { /* 忽略 */ }
            }
        }

        await writeOps(rr.handle, 'restore', {
            batch: batch,
            restored: restored.map(function (it) { return it.relPath; }),
            failed: failed
        });

        return { restored: restored.length, failed: failed };
    }

    /* ---------------- 彻底删除 ---------------- */

    async function purge(batch, relPath) {
        var rr = await resolveRoot();
        await ensureRW(rr.handle);

        var batchRel = TRASH + '/' + batch;

        if (!relPath) {
            await removeBatchDir(rr.handle, batch);
            await writeOps(rr.handle, 'purge-batch', { batch: batch });
            return { purged: 1, failed: [] };
        }

        var manifest = await readJson(rr.handle, batchRel + '/' + MANIFEST);
        if (!manifest || !Array.isArray(manifest.items)) {
            throw makeErr('LIB_E_TRASH', '回收站批次不存在或清单损坏');
        }
        if (!manifest.items.some(function (it) { return it.relPath === relPath; })) {
            throw makeErr('LIB_E_TRASH', '回收站里找不到该条目');
        }

        try {
            var segs = split(batchRel + '/' + stripPrefix(relPath, rr.prefix));
            var name = segs.pop();
            var dir = await dirAt(rr.handle, segs, false);
            await dir.removeEntry(name);
        } catch (e) {
            /* 文件已不在，继续清清单 */
        }

        manifest.items = manifest.items.filter(function (it) { return it.relPath !== relPath; });
        if (manifest.items.length) {
            await writeManifest(rr.handle, batchRel, manifest);
        } else {
            await removeBatchDir(rr.handle, batch);
        }

        await writeOps(rr.handle, 'purge', { batch: batch, relPath: relPath });
        return { purged: 1, failed: [] };
    }

    /** 恢复前预检：只读，不移动任何文件。
     *  返回待恢复总数与「原位置已有同名文件」的冲突清单。
     *  restore() 遇到冲突会把该条记进 failed，用户事先不知道会恢复不了几条，
     *  所以「全部恢复」前必须先跑这一步并告知（2026-11-06 UX 审查 P0-3）。 */
    async function preflightRestore() {
        var rr = await resolveRoot();
        if (!rr.handle) { return { total: 0, conflicts: [], batches: 0 }; }
        var batches = await list();
        var total = 0;
        var conflicts = [];
        for (var i = 0; i < batches.length; i++) {
            var items = batches[i].items || [];
            for (var j = 0; j < items.length; j++) {
                total++;
                var fsRel = stripPrefix(items[j].relPath, rr.prefix);
                try {
                    if (await exists(rr.handle, fsRel)) { conflicts.push(items[j].relPath); }
                } catch (e) { /* 单条读不了按无冲突处理，restore 里仍会兜住 */ }
            }
        }
        return { total: total, conflicts: conflicts, batches: batches.length };
    }

    async function empty() {
        var rr = await resolveRoot();
        await ensureRW(rr.handle);

        var batches = await list();
        var n = 0;
        for (var i = 0; i < batches.length; i++) {
            await removeBatchDir(rr.handle, batches[i].batch);
            n++;
        }

        if (dbReady()) {
            try { await root.VRDB.log('trash.empty', { batches: n }, { purged: n }); } catch (e) { /* 忽略 */ }
        }
        await writeOps(rr.handle, 'empty', { batches: n });
        return { batches: n, purged: n };
    }

    root.VRTrash = {
        TRASH_DIR: TRASH,
        remove: remove,
        list: list,
        status: status,
        restore: restore,
        purge: purge,
        empty: empty,
        resolveRoot: resolveRoot,
        preflightRestore: preflightRestore,
        /* app.js 的「移动到…」需要；原实现调用未导出的 moveFile，必然失败。 */
        moveFile: moveFile,
        exists: exists
    };
})(typeof self !== 'undefined' ? self : this);
