/* ==========================================================
 * VRTrash —— 删除与回收站（S5 / ADR-033 修订版）
 *
 * 口径（2026-11-09 拍板，A+B 方案）：
 *   1. 索引是回收站的真源：删到回收站 = 索引行打 state='trashed'
 *      （**不再删行**），物理文件搬到 <根>/_回收站/<批次>/<原相对路径>；
 *      _manifest.json 作为跨浏览器备份（IDB 被清后仍可恢复，ADR-033）。
 *   2. 清空/彻底删除 = 一个函数里做完「删物理文件 → 删缩略图 → 删索引行」，
 *      可重入、幂等：任何一步上次没做完，这次接着做。
 *   3. 顺序按 freedesktop Trash 规范：清单先写（pending），再搬文件，
 *      搬完回写终态；搬失败逐条回滚索引，不留「卡片在、文件没了」的死状态。
 *   4. 缩略图必须两处一起清：IDB thumb 表（t:<relPath>）+ 磁盘 webp。
 *      原实现只清磁盘，IDB 里永久泄漏。
 *
 * 依赖：VRDB、VRIndex（resolveRoot 可选）、VRThumbs（可选）；挂 self.VRTrash。
 * ========================================================== */
(function (root) {
    'use strict';

    var TRASH = '_回收站';
    var LOG_DIR = '_migration';
    var MANIFEST = '_manifest.json';
    var ST_TRASHED = 'trashed';
    var NO_BATCH = '_未分批';

    function makeErr(code, msg) {
        var e = new Error(msg || code);
        e.code = code;
        return e;
    }

    function errCode(e) {
        return (e && e.code) || 'LIB_E_TRASH';
    }

    /** FSA 的「句柄缓存和磁盘对不上」：Windows 上偶发，重试一次通常就好。 */
    function isStaleState(e) {
        return !!e && (e.name === 'InvalidStateError' || e.code === 11);
    }

    /** 失败详情带原生错误名，ops 日志才能看出是「状态抖动」还是别的。 */
    function failInfo(rel, e) {
        return {
            relPath: rel,
            code: errCode(e),
            error: (e && e.name) || '',
            message: (e && e.message) || ''
        };
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

    function isTrashed(e) { return !!e && e.state === ST_TRASHED; }

    function baseName(rel) {
        return String(rel || '').replace(/\\/g, '/').split('/').pop() || '';
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
            /* 只有「确实找不到」才算不存在。权限抖动 / InvalidStateError
             * 一律上抛：否则会被当成「文件已不在」，走 cleaned 分支把索引行
             * 悄悄删掉，文件却还躺在磁盘上（静默假删，2026-11-10 复盘）。 */
            if (isNotFoundErr(e)) { return false; }
            throw e;
        }
    }

    /**
     * 读某个相对路径的文件内容指纹（SHA-256）。
     * 只在恢复遇到同名冲突时用：判断「原位那份」与「回收站这份」是不是同一个文件。
     * 算不出来（文件读不到 / 无 WebCrypto）返回空串 —— 调用方按「内容不同」处理，
     * 走改名恢复，绝不覆盖，也不会因为算指纹失败就把用户挡在门外。
     */
    async function hashAt(rootHandle, rel) {
        try {
            var fh = await fileAt(rootHandle, rel);
            var file = await fh.getFile();
            if (root.VRDedup && typeof root.VRDedup.hashBlob === 'function') {
                return (await root.VRDedup.hashBlob(file)) || '';
            }
        } catch (e) { /* 见函数头：失败一律当不同 */ }
        return '';
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

    /**
     * 复制 → 校验大小 → 删源；不依赖 FSA move()。
     *
     * Chromium 的 FSA 句柄会缓存目录状态。Windows 上偶发
     * InvalidStateError「An operation that depends on state cached in an
     * interface object ...」—— 文件其实好好的，只是句柄和磁盘对不上
     * （2026-11-10 真实库 12:26 抓到：113.7MB 微博视频删除失败，
     * 文件在、权限 granted、句柄链也全 ok，纯状态抖动）。
     * 对策：重新解析根目录句柄 + 退避重试，最多 3 次；不是这类错误立刻抛。
     */
    async function moveFile(rootHandle, fromRel, toRel, opts) {
        opts = opts || {};
        var last = null;
        for (var attempt = 0; attempt < 3; attempt++) {
            var h = rootHandle;
            if (attempt > 0) {
                await new Promise(function (resolve) { setTimeout(resolve, 120 * attempt); });
                if (typeof opts.resolveRoot === 'function') {
                    try {
                        var rr2 = await opts.resolveRoot();
                        if (rr2 && rr2.handle) { h = rr2.handle; }
                    } catch (e3) { /* 拿不到新句柄就用旧句柄再试 */ }
                }
            }
            try {
                return await moveFileOnce(h, fromRel, toRel, opts);
            } catch (e) {
                last = e;
                if (!isStaleState(e)) { throw e; }
                console.warn('[trash] 目录状态抖动，重试搬文件 ' +
                    (attempt + 1) + '/3：' + fromRel, (e && e.message) || '');
            }
        }
        throw last;
    }

    async function moveFileOnce(rootHandle, fromRel, toRel, opts) {
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

    /* ---------------- 空目录收尾 ---------------- */

    /** 这些顶层目录即使空了也不许删（里面是程序自己的账本/回收站） */
    var KEEP_TOP = { '_回收站': 1, '_library': 1, '_migration': 1, '_selftest': 1 };

    /**
     * 把「被搬空的目录」从下往上删掉，遇到第一个非空目录就停。
     *
     * 为什么必须有：删除只会把文件搬进 `_回收站`，源目录空了却留在磁盘上。
     * 删几十条之后用户的素材夹里全是空壳目录（2026-11-09 实测真实库有 20+ 个空目录），
     * 看起来像"删了个寂寞"。资源管理器删文件是会顺手收尾的，这里对齐。
     *
     * @param {string} dirRel 被搬空目录的相对路径（相对库根，已剥 subdir 前缀）
     * @returns {Promise<number>} 删掉的目录数
     */
    async function pruneEmptyDirs(rootHandle, dirRel) {
        var segs = split(dirRel);
        if (!segs.length) { return 0; }
        var chain = [rootHandle];
        var cur = rootHandle;
        for (var i = 0; i < segs.length; i++) {
            try { cur = await cur.getDirectoryHandle(segs[i], { create: false }); }
            catch (e) { return 0; }        // 目录已经不在了
            chain.push(cur);
        }
        var removed = 0;
        for (var j = segs.length; j >= 1; j--) {
            if (j === 1 && KEEP_TOP[segs[0]]) { break; }   // 程序账本目录不删
            var empty = true;
            try {
                for await (var e of chain[j].entries()) { empty = false; break; }
            } catch (e2) { break; }
            if (!empty) { break; }
            try { await chain[j - 1].removeEntry(segs[j - 1]); }
            catch (e3) { break; }
            removed++;
        }
        return removed;
    }

    /* ---------------- 缩略图 ---------------- */

    /** 删除缩略图：IDB thumb 表（t:<relPath>）+ 磁盘 webp 一起清。
     *  原实现只调 VRThumbs.deleteFor（只删磁盘），IDB blob 永久泄漏。 */
    async function dropThumbs(relPaths) {
        var list = (relPaths || []).filter(Boolean);
        if (!list.length) { return 0; }
        var n = 0;
        if (dbReady() && typeof root.VRDB.deleteThumbs === 'function') {
            try {
                n += await root.VRDB.deleteThumbs(list.map(function (r) { return 't:' + r; }));
            } catch (e) { /* 忽略 */ }
        }
        try {
            if (root.VRThumbs && typeof root.VRThumbs.deleteFor === 'function') {
                await root.VRThumbs.deleteFor(list);
            }
        } catch (e2) { /* 忽略 */ }
        return n;
    }

    /** 只有「路径明确不存在」才返回 true。权限/IO 抖动一律返回 false，
     *  绝不允许据此删索引行（ADR-030：错删比留着更糟）。 */
    function isNotFoundErr(e) {
        var n = e && e.name;
        return n === 'NotFoundError' || n === 'TypeMismatchError';
    }

    async function pathGone(handle, rel) {
        var segs = split(rel);
        if (!segs.length || segs.indexOf('..') !== -1) { return false; }
        var name = segs.pop();
        var dir = handle;
        for (var i = 0; i < segs.length; i++) {
            try { dir = await dir.getDirectoryHandle(segs[i]); }
            catch (e) { return isNotFoundErr(e); }
        }
        try { await dir.getFileHandle(name); return false; }
        catch (e2) { return isNotFoundErr(e2); }
    }

    /**
     * 清「活死卡」：索引行还在（没标 trashed），但磁盘上原路径的文件确实没了，
     * 回收站清单里也没有它。这类行点开必然报错，苏哥说的「清空后索引还有出现」
     * 就是它们 —— 文件随清空删掉了，行却因为删行失败 / 状态被改回 / 清单孤儿而留下。
     *
     * 安全边界：
     *  - 只认 pathGone()（明确 NotFound）；权限/IO 抖动不动；
     *  - pendingArchive（待归档）、isRef（虚拟引用）、trashed 行跳过；
     *  - 回收站清单里还挂着的 relPath 跳过（它归回收站管，别越权删）；
     *  - includeMissing=false 时不碰 state='missing'（ADR-030 铁律：自动自愈不许删）；
     *    true 只在用户显式点「清空回收站」时用，那时语义就是「彻底清干净」。
     * @returns {Promise<number>} 清掉的索引行数
     */
    async function dropDeadCards(rr, opt) {
        var o = opt || {};
        if (!rr || !rr.handle || !dbReady()) { return 0; }
        var protectedRels = {};
        try {
            var disks = await diskBatches(rr);
            disks.forEach(function (d) {
                (d.items || []).forEach(function (it) {
                    if (it && it.relPath) { protectedRels[it.relPath] = 1; }
                });
            });
        } catch (e) { /* 读不到清单就当没有保护项，下面仍有 pathGone 兜底 */ }

        var rows = await allRows();
        var candidates = rows.filter(function (r) {
            if (!r || !r.relPath || isTrashed(r)) { return false; }
            if (r.pendingArchive || r.isRef) { return false; }
            /* 2026-11-14：越界条目（outOfRoot）也跳过。
             * 它的文件在库根**外面**，按库根拼路径去探盘必然 NotFound，
             * 于是会被当成「活死卡」静默删掉 —— 那份星标 / 标签就丢了。
             * 它不是要清理的垃圾，而是「位置判定」的产物：用户把文件移进来
             * 或换回原库根，它自己会变回 ok（见 indexer.mergeEntry）。
             * 按 ADR-030 的铁律：自动自愈不许替用户做不可逆的删除。 */
            var Gj = root.VRRootGuard;
            var isOut = (Gj && typeof Gj.isOutOfRoot === 'function')
                ? Gj.isOutOfRoot(r)
                : !!(r.state === 'outOfRoot' || r.outOfRoot);
            if (isOut) { return false; }
            if (!o.includeMissing && r.state === 'missing') { return false; }
            if (protectedRels[r.relPath]) { return false; }
            return true;
        });
        var dead = [];
        /* 分批并发探盘：大库不能一条条 await，否则开页自愈会拖住首屏。 */
        var CHUNK = 16;
        for (var i = 0; i < candidates.length; i += CHUNK) {
            var chunk = candidates.slice(i, i + CHUNK);
            var probes = await Promise.all(chunk.map(function (r) {
                return pathGone(rr.handle, stripPrefix(r.relPath, rr.prefix));
            }));
            for (var k = 0; k < chunk.length; k++) {
                if (probes[k]) { dead.push(chunk[k].relPath); }
            }
        }
        if (!dead.length) { return 0; }
        try { await root.VRDB.deleteFiles(dead); } catch (e) { return 0; }
        await dropThumbs(dead);
        return dead.length;
    }

    /* ---------------- 索引读写 ---------------- */

    async function allRows() {
        if (!dbReady() || typeof root.VRDB.getAllFiles !== 'function') { return []; }
        try { return (await root.VRDB.getAllFiles()) || []; }
        catch (e) { return []; }
    }

    async function trashedRows() {
        return (await allRows()).filter(isTrashed);
    }

    async function patchRow(relPath, patch) {
        if (!dbReady() || typeof root.VRDB.patchFile !== 'function') { return null; }
        try { return await root.VRDB.patchFile(relPath, patch); }
        catch (e) { return null; }
    }

    /** 一条索引行 → 回收站列表项（UI 只认这个形状） */
    function rowToItem(r) {
        var rel = String(r.relPath || '');
        var name = r.fileName || baseName(rel);
        var ext = (String(name).match(/\.([a-z0-9]{2,5})$/i) || [])[1] || '';
        var type = r.type || '';
        if (!type) {
            if (/^(jpg|jpeg|png|webp|gif|bmp|avif|heic|heif|svg)$/i.test(ext)) { type = 'image'; }
            else if (/^(mp4|m4v|mov|webm|mkv|avi|flv|ts)$/i.test(ext)) { type = 'video'; }
            else { type = 'other'; }
        }
        return {
            relPath: rel,
            fileName: name,
            ext: String(ext).toUpperCase(),
            size: Number(r.size) || 0,
            type: type,
            kind: type,
            noFile: !!r.trashNoFile,
            at: Number(r.trashedAt) || 0,
            source: 'index',
            /* 清单要能恢复：带上索引快照（ADR-033 第 2 条） */
            entry: r
        };
    }

    /* ---------------- 删除 ---------------- */

    /**
     * 删除到回收站。
     *
     * 每一行按「先打标 → 再搬文件 → 失败回滚打标」走：
     * 宁可出现「索引说在回收站、文件还在原处」（sweep 一次就能自愈），
     * 也不要出现「卡片还在、文件没了」（原实现的死卡现象）。
     */
    async function remove(relPaths, opt) {
        var o = opt || {};
        var onProgress = typeof o.onProgress === 'function' ? o.onProgress : null;
        var batch = stamp();
        var batchRel = TRASH + '/' + batch;
        var list = (relPaths || []).filter(Boolean);

        var rr = await resolveRoot();
        await ensureRW(rr.handle);

        var items = [];       // 真正进回收站的
        var failed = [];
        var cleaned = 0;      // 磁盘上已经没有、顺手清索引的

        /* ① 清单先落盘（pending）：搬文件过程中崩了也知道这批在动什么 */
        try {
            await writeManifest(rr.handle, batchRel, {
                version: 2, status: 'pending', batch: batch, at: Date.now(),
                root: rr.absRoot || '', items: []
            });
        } catch (e) { /* 清单写不了不阻断（可能是权限抖动），终态再补 */ }

        for (var i = 0; i < list.length; i++) {
            var rel = list[i];
            var fsRel = stripPrefix(rel, rr.prefix);
            /* 进度必须在每次进入下一条之前报一次。原来只有「正常走完」才报，
             * 而「文件已不存在」「只减引用」两条分支是 continue，会漏报，
             * 大批量下进度条卡住不动（2026-11-06 自查）。 */
            (function (idx) {
                if (!onProgress) { return; }
                try {
                    onProgress({ done: idx + 1, total: list.length, relPath: list[idx] });
                } catch (e2) { /* 忽略 */ }
            })(i);

            try {
                if (!(await exists(rr.handle, fsRel))) {
                    /* 已经在回收站里的条目被再删一次：原位置当然没文件。
                     * 必须连回收站副本一起彻底删掉，否则只删索引行会留下
                     * 一个没有清单主人的孤儿批次（2026-11-10 端到端实测抓到：
                     * empty() 报 purged=0，却悄悄删掉了一整个批次目录）。 */
                    var prior = null;
                    if (dbReady()) {
                        try { prior = await root.VRDB.getFile(rel); } catch (eG) { prior = null; }
                    }
                    if (isTrashed(prior)) {
                        await purgeOne(rr, prior.trashBatch || NO_BATCH, rel);
                    } else {
                        /* 磁盘上本来就没有：不进回收站，索引和缩略图一起清掉 */
                        if (dbReady()) { await root.VRDB.deleteFiles([rel]); }
                        await dropThumbs([rel]);
                    }
                    cleaned++;
                    continue;
                }
                var entry = null;
                if (dbReady()) {
                    try { entry = await root.VRDB.getFile(rel); }
                    catch (e) { console.warn('[trash] 读取条目失败：', rel, e && e.message); }
                }

                /* 同指纹还有别的**活跃**引用时，物理文件留在原地，只把这条移进回收站。
                 * 注意 countBy 要排除 trashed：否则回收站里的条目也会被算成「还有人用」，
                 * 最后一条活跃引用被删时文件永远删不掉。
                 *
                 * 【语义铁律，2026-11-13】refOnly 的判据是**索引层**的「同 sha256 还有别的
                 * 活跃条目」，不是磁盘层的「文件还在原位」。文件留在原处只是因为另一个
                 * 条目还在用它，跟「这一条没被删」完全是两回事。
                 * 所以：trashNoFile=1 是「本条无独立实体」的唯一判据；
                 * 任何「文件在原位 → 说明没删」的推断都是错的（sweep 曾据此把条目打回 ok）；
                 * 扫描侧则一律跳过 trashed 行，不看磁盘。
                 * 反例（苏哥 2026-11-13 报「删了全量刷新又出现」）：删掉同图 A 条、
                 * B 条仍活跃 → 文件留在原位 → 全量扫描扫到 → A 复活。 */
                var refOnly = false;
                if (entry && entry.sha256 && root.VRDedup) {
                    try {
                        var cnt = await root.VRDedup.refCount(entry.sha256);
                        if (cnt > 1) { refOnly = true; }
                    } catch (e) {
                        console.warn('[trash] 引用计数失败，按普通删除处理：', rel, e && e.message);
                    }
                }
                if (refOnly) {
                    console.info('[trash] 只减引用：同内容仍有活跃条目，物理文件保留在原位', rel);
                }

                /* ② 先给索引打标（这一步失败就不动文件，避免死状态） */
                var marked = true;
                if (dbReady() && entry) {
                    var patched = await patchRow(rel, {
                        state: ST_TRASHED,
                        trashBatch: batch,
                        trashedAt: Date.now(),
                        trashNoFile: refOnly ? 1 : 0,
                        /* 正在搬的标记：sweep() 在这个窗口里不能判定「文件还在原位 →
                         * 打回 ok」，否则会把刚删的条目复活成一张死卡
                         * （2026-11-09 压力测试抓到：启动自愈正好撞上删除动作）。 */
                        trashPending: 1
                    });
                    if (!patched) { marked = false; }
                }
                if (!marked) {
                    failed.push({ relPath: rel, code: 'LIB_E_DB', message: '索引不可写，未移动文件' });
                    continue;
                }

                /* ③ 搬文件：refOnly 不搬（原件还被活跃条目用着） */
                if (!refOnly) {
                    try {
                        await moveFile(rr.handle, fsRel, batchRel + '/' + fsRel,
                            { resolveRoot: resolveRoot });
                    } catch (e) {
                        /* 回滚打标：文件没搬成，索引必须回到 ok，否则卡片凭空消失 */
                        if (dbReady() && entry) {
                            await patchRow(rel, {
                                state: 'ok', trashBatch: '', trashedAt: 0,
                                trashNoFile: 0, trashPending: 0
                            });
                        }
                        failed.push(failInfo(rel, e));
                        continue;
                    }
                }
                /* 搬完了，撤掉「正在搬」标记 */
                await patchRow(rel, { trashPending: 0 });
                /* 源目录空了就顺手收掉（从下往上，遇到非空即停） */
                var dirRel = split(fsRel).slice(0, -1).join('/');
                if (dirRel) {
                    try { await pruneEmptyDirs(rr.handle, dirRel); } catch (eD) { /* 收尾失败不影响删除 */ }
                }

                var it = rowToItem(Object.assign({}, entry || {}, {
                    relPath: rel,
                    fileName: (entry && entry.fileName) || baseName(rel),
                    state: ST_TRASHED,
                    trashBatch: batch,
                    trashNoFile: refOnly ? 1 : 0
                }));
                items.push(it);
            } catch (e) {
                failed.push(failInfo(rel, e));
            }
        }

        if (items.length) {
            /* ④ 终态清单：恢复按它走，IDB 被清也能救回来（ADR-033） */
            try {
                await writeManifest(rr.handle, batchRel, {
                    version: 2, status: 'ok', batch: batch, at: Date.now(),
                    root: rr.absRoot || '',
                    items: items.map(function (it) {
                        return Object.assign({}, it.entry || {}, {
                            relPath: it.relPath, fileName: it.fileName, size: it.size,
                            trashNoFile: it.noFile ? 1 : 0
                        });
                    })
                });
            } catch (e2) { /* 清单失败不阻断：索引是真源 */ }
            try {
                if (dbReady()) {
                    await root.VRDB.log('trash.remove', { batch: batch, count: items.length },
                        { moved: items.length, cleaned: cleaned, failed: failed.length });
                }
            } catch (e3) { /* 忽略 */ }
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

    /** 磁盘上的批次目录（含没有索引行的孤儿批次，供跨浏览器恢复） */
    async function diskBatches(rr) {
        var out = [];
        if (!rr.handle) { return out; }
        var trashDir;
        try { trashDir = await dirAt(rr.handle, [TRASH], false); }
        catch (e) { return out; }
        for await (var pair of trashDir.entries()) {
            var name = pair[0];
            var h = pair[1];
            if (!h || h.kind !== 'directory') { continue; }
            var manifest = await readJson(rr.handle, TRASH + '/' + name + '/' + MANIFEST);
            out.push({
                batch: name,
                at: (manifest && manifest.at) || 0,
                items: (manifest && manifest.items) || []
            });
        }
        return out;
    }

    async function list() {
        var rr = await resolveRoot();
        var buckets = {};
        var order = [];

        function bucket(id, at) {
            if (!buckets[id]) {
                buckets[id] = { batch: id, at: Number(at) || 0, size: 0, items: [] };
                order.push(id);
            } else if (at && (!buckets[id].at || Number(at) > buckets[id].at)) {
                buckets[id].at = Number(at);
            }
            return buckets[id];
        }

        /* ① 索引（真源） */
        var rows = await trashedRows();
        rows.forEach(function (r) {
            var b = r.trashBatch || NO_BATCH;
            var it = rowToItem(r);
            var bk = bucket(b, it.at);
            bk.items.push(it);
            bk.size += it.size;
        });

        /* ② 磁盘清单兜底（索引被清过 / 别的浏览器删的） */
        var disks = await diskBatches(rr);
        disks.forEach(function (d) {
            if (!d.items.length) { return; }        // 空目录不单列
            var bk = bucket(d.batch, d.at);
            var seen = {};
            bk.items.forEach(function (x) { seen[x.relPath] = 1; });
            d.items.forEach(function (m) {
                if (!m || !m.relPath || seen[m.relPath]) { return; }
                var it = rowToItem(m);
                it.source = 'manifest';
                bk.items.push(it);
                bk.size += it.size;
            });
        });

        var out = [];
        order.forEach(function (id) {
            var bk = buckets[id];
            if (!bk.items.length) { return; }
            out.push(bk);
        });
        out.sort(function (a, b) {
            if (b.at !== a.at) { return b.at - a.at; }
            return String(b.batch).localeCompare(String(a.batch));
        });
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

    /** 批次空了就把目录删掉（索引与磁盘都算） */
    async function dropBatchIfEmpty(rr, batch) {
        if (!batch || batch === NO_BATCH) { return; }
        var rows = (await trashedRows()).filter(function (r) {
            return (r.trashBatch || NO_BATCH) === batch;
        });
        if (rows.length) { return; }
        var manifest = await readJson(rr.handle, TRASH + '/' + batch + '/' + MANIFEST);
        if (manifest && Array.isArray(manifest.items) && manifest.items.length) { return; }
        await removeBatchDir(rr.handle, batch);
    }

    async function restore(batch, relPath) {
        var rr = await resolveRoot();
        await ensureRW(rr.handle);

        var targets = [];
        if (relPath) {
            targets = [{ batch: batch, relPath: relPath }];
        } else {
            var rows0 = (await trashedRows()).filter(function (r) {
                return (r.trashBatch || NO_BATCH) === batch;
            });
            targets = rows0.map(function (r) { return { batch: batch, relPath: r.relPath }; });
            if (!targets.length) {
                /* 只有清单的批次：按清单恢复 */
                var man = await readJson(rr.handle, TRASH + '/' + batch + '/' + MANIFEST);
                targets = ((man && man.items) || []).map(function (m) {
                    return { batch: batch, relPath: m.relPath, item: m };
                });
            }
        }
        if (!targets.length) {
            throw makeErr('LIB_E_TRASH', '回收站批次不存在或清单损坏');
        }

        var restored = [];
        var failed = [];
        var renamed = [];
        var deduped = [];
        /* 清单里记的是原 relPath，改名恢复后 restored[].relPath 会变，
         * 所以收缩清单要用这份「原始键」，不能拿新路径去对。 */
        var touchedRel = [];

        for (var i = 0; i < targets.length; i++) {
            var t = targets[i];
            var rel = t.relPath;
            var fsRel = stripPrefix(rel, rr.prefix);
            try {
                var row = null;
                if (dbReady()) {
                    try { row = await root.VRDB.getFile(rel); } catch (e) { row = null; }
                }
                var noFile = row ? !!row.trashNoFile : !!(t.item && t.item.trashNoFile);

                var movedRel = rel;
                if (!noFile) {
                    var fromRel = TRASH + '/' + t.batch + '/' + fsRel;
                    if (await exists(rr.handle, fsRel)) {
                        /* 2026-11-12：同名不再直接判失败。
                         * 原位那份内容相同 → 说明已经回来了，删掉回收站副本即可；
                         * 内容不同 → 改名恢复，绝不覆盖（覆盖等于用旧版顶掉新版）。 */
                        var hSrc = await hashAt(rr.handle, fromRel);
                        var hDst = await hashAt(rr.handle, fsRel);
                        if (hSrc && hSrc === hDst) {
                            await removeAt(fromRel);
                            deduped.push(rel);
                        } else {
                            var altFs = '';
                            for (var k = 1; k <= 99; k++) {
                                var cand = root.VRPath.restoreAltName(fsRel, k);
                                if (!(await exists(rr.handle, cand))) { altFs = cand; break; }
                            }
                            if (!altFs) {
                                throw makeErr('LIB_E_EXISTS', '原位置同名且改名 99 次仍冲突');
                            }
                            await moveFile(rr.handle, fromRel, altFs, { resolveRoot: resolveRoot });
                            movedRel = rr.prefix ? (rr.prefix + '/' + altFs) : altFs;
                            renamed.push({ from: rel, to: movedRel });
                        }
                    } else {
                        await moveFile(rr.handle, fromRel, fsRel, { resolveRoot: resolveRoot });
                    }
                }

                var item = row || t.item || { relPath: rel, fileName: baseName(rel) };
                var next = Object.assign({}, item, {
                    relPath: movedRel,
                    fileName: baseName(movedRel),
                    state: 'ok',
                    trashBatch: '',
                    trashedAt: 0,
                    trashNoFile: 0
                });
                if (movedRel !== rel) {
                    /* 改名恢复：主键就是 relPath，旧行不删会留下指向空路径的死卡 */
                    var oldAbs = String(next.absPath || '');
                    var oldName = baseName(rel);
                    if (oldAbs && oldName && oldAbs.slice(-oldName.length) === oldName) {
                        next.absPath = oldAbs.slice(0, oldAbs.length - oldName.length) + baseName(movedRel);
                    }
                    if (dbReady()) {
                        await root.VRDB.deleteFiles([rel]);
                        await root.VRDB.putFiles([next]);
                        await dropThumbs([rel]);
                    }
                } else if (row) {
                    await patchRow(rel, { state: 'ok', trashBatch: '', trashedAt: 0, trashNoFile: 0 });
                } else if (dbReady()) {
                    await root.VRDB.putFiles([next]);
                }
                restored.push(next);
                touchedRel.push(rel);
            } catch (e) {
                failed.push(failInfo(rel, e));
            }
        }

        if (restored.length && dbReady()) {
            try {
                await root.VRDB.log('trash.restore', { batch: batch, count: restored.length },
                    { restored: restored.length, failed: failed.length });
            } catch (e2) { /* 忽略 */ }
        }
        /* 清单同步收缩：清单是跨浏览器恢复的备份，恢复走完了还留着条目，
         * 下次「按清单恢复」会指到已经搬回原位的文件（ENOENT）。
         * 顺带让 dropBatchIfEmpty 能据此判断整批是否已空。 */
        if (restored.length) {
            try {
                if (batch && batch !== NO_BATCH) {
                    var man = await readJson(rr.handle, TRASH + '/' + batch + '/' + MANIFEST);
                    if (man && Array.isArray(man.items)) {
                        var doneSet = {};
                        /* 用原始键（改名恢复后 relPath 已变，拿新路径对不上清单条目） */
                        touchedRel.forEach(function (r0) { doneSet[r0] = 1; });
                        var left = man.items.filter(function (it) { return !doneSet[it.relPath]; });
                        /* 全部恢复完也要写回空清单（2026-11-12）：原来只在 left 非空时写，
                         * 全恢复后清单仍列着已搬回原位的文件 → dropBatchIfEmpty 认为批次还有货，
                         * 目录与清单永久残留，下次「按清单恢复」还会指到已存在的文件（ENOENT）。 */
                        man.items = left;
                        await writeManifest(rr.handle, TRASH + '/' + batch, man);
                    }
                }
            } catch (e3) { /* 清单更新失败不阻断恢复 */ }
        }
        await dropBatchIfEmpty(rr, batch);

        await writeOps(rr.handle, 'restore', {
            batch: batch,
            restored: restored.map(function (it) { return it.relPath; }),
            renamed: renamed,
            deduped: deduped,
            failed: failed
        });

        /* renamed / deduped 是 2026-11-12 新增的如实口径：
         *   deduped = 原位已有同一份内容，删掉回收站副本（用户视角「已回来」）
         *   renamed = 原位被别的内容占着，改名救回（用户视角「回来了，但改了名」）
         * 老调用方只读 restored / failed，不受影响。 */
        return {
            restored: restored.length,
            failed: failed,
            renamed: renamed,
            deduped: deduped
        };
    }

    /* ---------------- 彻底删除 ---------------- */

    async function purgeOne(rr, batch, relPath) {
        var fsRel = stripPrefix(relPath, rr.prefix);
        /* 只删回收站里的副本；原件即使还在也不能碰（可能被别的活跃条目引用） */
        var path = TRASH + '/' + batch + '/' + fsRel;
        try {
            var segs = split(path);
            var name = segs.pop();
            var dir = await dirAt(rr.handle, segs, false);
            await dir.removeEntry(name);
        } catch (e) { /* 文件已不在，继续清索引 */ }

        if (dbReady()) {
            try {
                await root.VRDB.deleteFiles([relPath]);
                /* 读回验证：删不掉就再试一次。原来这里 catch 里啥也不做，
                 * 索引行就这么静默留下来了（empty() 末尾另有统一重删+核验）。 */
                var leftRow = await root.VRDB.getFile(relPath);
                if (leftRow) { await root.VRDB.deleteFiles([relPath]); }
            } catch (e2) { /* 忽略 */ }
        }
        await dropThumbs([relPath]);
    }

    function normAbs(p) { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); }

    /**
     * 清掉「指向同一个已消失物理文件」的残留索引行。
     *
     * 为什么必须有：存量库里同一文件可能有两条索引（老版本没有 subdir 前缀）。
     * 删掉其中一条、再清空回收站后，另一条还标着 ok、指向的原路径已经空了，
     * 就变成主页上一张点开就报错、又删不掉（删的又是它自己）的死卡。
     * 只在「absPath 与刚被彻底删除的那批相同」且「磁盘上确实没有这个文件」时才删。
     * @param {string[]} absPaths 刚被彻底删除条目的绝对路径
     * @returns {Promise<number>} 清掉的残留行数
     */
    async function dropGhostRows(rr, absPaths) {
        var marks = {};
        (absPaths || []).forEach(function (p) {
            var k = normAbs(p);
            if (k) { marks[k] = 1; }
        });
        if (!Object.keys(marks).length) { return 0; }
        var rows = await allRows();
        var dead = [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (!r || !r.relPath || isTrashed(r)) { continue; }
            if (!marks[normAbs(r.absPath)]) { continue; }
            if (await exists(rr.handle, stripPrefix(r.relPath, rr.prefix))) { continue; }
            dead.push(r.relPath);
        }
        if (!dead.length) { return 0; }
        if (dbReady()) {
            try { await root.VRDB.deleteFiles(dead); } catch (e) { /* 忽略 */ }
        }
        await dropThumbs(dead);
        return dead.length;
    }

    async function purge(batch, relPath) {
        var rr = await resolveRoot();
        await ensureRW(rr.handle);

        if (!relPath) {
            var rows = (await trashedRows()).filter(function (r) {
                return (r.trashBatch || NO_BATCH) === batch;
            });
            for (var i = 0; i < rows.length; i++) { await purgeOne(rr, batch, rows[i].relPath); }
            await removeBatchDir(rr.handle, batch);
            var goneAbs = rows.map(function (r) { return r.absPath; });
            var goneN = await dropGhostRows(rr, goneAbs);
            await writeOps(rr.handle, 'purge-batch', { batch: batch, ghosts: goneN });
            return { purged: rows.length, failed: [], ghosts: goneN };
        }

        var row = null;
        if (dbReady()) {
            try { row = await root.VRDB.getFile(relPath); } catch (e) { row = null; }
        }
        var manifest = await readJson(rr.handle, TRASH + '/' + batch + '/' + MANIFEST);
        var inManifest = !!(manifest && Array.isArray(manifest.items) &&
            manifest.items.some(function (it) { return it.relPath === relPath; }));
        if (!isTrashed(row) && !inManifest) {
            throw makeErr('LIB_E_TRASH', '回收站里找不到该条目');
        }

        await purgeOne(rr, batch, relPath);

        var ghostSrc = row ? row.absPath
            : (manifest && manifest.items ? (manifest.items.filter(function (it) {
                return it.relPath === relPath;
            })[0] || {}).absPath : '');
        var ghosts = await dropGhostRows(rr, [ghostSrc]);

        if (inManifest) {
            manifest.items = manifest.items.filter(function (it) { return it.relPath !== relPath; });
            if (manifest.items.length) {
                await writeManifest(rr.handle, TRASH + '/' + batch, manifest);
            } else {
                await removeBatchDir(rr.handle, batch);
            }
        } else {
            await dropBatchIfEmpty(rr, batch);
        }

        await writeOps(rr.handle, 'purge', { batch: batch, relPath: relPath, ghosts: ghosts });
        return { purged: 1, failed: [], ghosts: ghosts };
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
                if (items[j].noFile) { continue; }
                var fsRel = stripPrefix(items[j].relPath, rr.prefix);
                try {
                    if (await exists(rr.handle, fsRel)) { conflicts.push(items[j].relPath); }
                } catch (e) { /* 单条读不了按无冲突处理，restore 里仍会兜住 */ }
            }
        }
        return { total: total, conflicts: conflicts, batches: batches.length };
    }

    /**
     * 清空回收站：删物理文件 → 删缩略图 → 删索引行，然后清掉所有批次目录。
     * 幂等：上次做到一半（缩略图没删干净、目录没删掉），再点一次会继续收尾。
     * 原实现只删目录，索引和缩略图一条不碰 —— 「清空了但卡片还在」的根因。
     */
    async function empty() {
        var rr = await resolveRoot();
        await ensureRW(rr.handle);

        var rows = await trashedRows();
        var disks = await diskBatches(rr);
        var n = 0;
        var purgedAbs = [];
        for (var i = 0; i < rows.length; i++) {
            try {
                purgedAbs.push(rows[i].absPath);
                await purgeOne(rr, rows[i].trashBatch || NO_BATCH, rows[i].relPath);
                n++;
            } catch (e) { /* 单条失败继续，最后统一重删 */ }
        }

        /* 清理集合 = 索引里的回收站行 ∪ 磁盘清单里的孤儿条目。
         * 清单是跨浏览器备份：索引行可能因为删行失败 / 状态被改回 / 老版本
         * 只写清单不打标而「活着」，只按 trashedRows() 清就会漏掉它们。 */
        var kill = {};
        rows.forEach(function (r) { if (r.relPath) { kill[r.relPath] = 1; } });
        disks.forEach(function (d) {
            (d.items || []).forEach(function (it) {
                if (it && it.relPath) { kill[it.relPath] = 1; }
            });
        });
        var killRels = Object.keys(kill);

        /* 死卡收尾：同一物理文件可能还有一条「无前缀」的活跃索引，
         * 文件已经跟着这次清空没了，它就成了点开报错、删也删不掉的卡片。
         * 只在 absPath 相同且磁盘确实没有该文件时清，不误伤别的条目。 */
        var ghosts = await dropGhostRows(rr, purgedAbs);

        /* 目录兜底：没有索引行的孤儿批次也一并删掉 */
        for (var j = 0; j < disks.length; j++) {
            await removeBatchDir(rr.handle, disks[j].batch);
        }

        /* 批量重删 + 验证：purgeOne 里的 deleteFiles 是逐条且吞错的，
         * 一旦 IDB 事务抖动就会「文件删了、行还在」，而 ops 照样报 purged=N
         * （苏哥最忌讳的静默失效）。这里统一再删一遍并读库核对。 */
        var verified = 0;
        var leftover = 0;
        if (killRels.length && dbReady()) {
            try { await root.VRDB.deleteFiles(killRels); } catch (eD) { /* 下面验证会抓到 */ }
            var still = (await allRows()).filter(function (r) { return kill[r.relPath]; });
            if (still.length) {
                try {
                    await root.VRDB.deleteFiles(still.map(function (r) { return r.relPath; }));
                } catch (eD2) { /* 忽略，交给验证 */ }
            }
            var after = (await allRows()).filter(function (r) { return kill[r.relPath]; });
            leftover = after.length;
            verified = killRels.length - leftover;
            await dropThumbs(killRels);
            if (leftover) { console.warn('[trash] 清空后仍有 ' + leftover + ' 条索引删不掉'); }
        }

        /* 最后一道：文件已随清空消失、索引行却还挂在 ok/missing 上的「活死卡」。
         * 只有用户显式点「清空回收站」才连 missing 一起清（语义即彻底清干净）；
         * 平时启动自愈的 sweep() 用保守口径，绝不碰 missing（ADR-030）。 */
        var dead = await dropDeadCards(rr, { includeMissing: true });

        if (dbReady()) {
            try {
                await root.VRDB.log('trash.empty',
                    { batches: disks.length, items: n, ghosts: ghosts, verified: verified, dead: dead },
                    { purged: n, leftover: leftover });
            } catch (e) { /* 忽略 */ }
        }
        await writeOps(rr.handle, 'empty', {
            batches: disks.length, items: n, ghosts: ghosts,
            verified: verified, dead: dead, leftover: leftover
        });
        return {
            batches: disks.length, purged: n, ghosts: ghosts,
            verified: verified, dead: dead, leftover: leftover
        };
    }

    /**
     * 对账自愈：启动/授权后跑一次，修三类历史脏数据（只动索引，不动文件）。
     *   a) state='trashed' 但回收站里没有实体（且不是 refOnly）→ 已无可恢复内容，清掉；
     *   b) state='trashed' 但文件还在原位置（上次搬失败回滚没做干净）→ 打回 ok；
     *   c) 同一文件两条索引（有/无 subdir 前缀）→ 保留带前缀的那条，合并星标/标签；
     *   d) 被搬空的空壳目录 → 从下往上删掉（对齐资源管理器行为）；
     *   e) 「活死卡」：state=ok 但文件确实不在磁盘、回收站清单里也没有 → 删行+缩略图；
     *   f) 「被扫描复活」的存量条目：回收站清单里有、批次目录还在、mtime 也吻合，
     *      但索引行是活跃态 → 打回 trashed（ADR-085，用清单当删除的权威记录）。
     * @returns {Promise<{revived:number, dropped:number, merged:number, thumbs:number, pruned:number, dead:number, requarantined:number}>}
     */
    async function sweep() {
        var out = { revived: 0, dropped: 0, merged: 0, thumbs: 0, pruned: 0, dead: 0, requarantined: 0 };
        var rr = await resolveRoot();
        if (!rr.handle || !dbReady()) { return out; }

        var rows = await allRows();
        var byRel = {};
        rows.forEach(function (r) { if (r && r.relPath) { byRel[r.relPath] = r; } });
        var deadThumbs = [];

        /* a/b：修回收站状态 */
        var trashRows = rows.filter(isTrashed);
        var FRESH_MS = 15000;      /* 刚打标的先不判，等这一轮删除彻底走完 */
        for (var i = 0; i < trashRows.length; i++) {
            var r = trashRows[i];
            /* 正在搬运（或在搬运途中崩了，标记还在）→ 这一轮跳过。
             * 原实现没有这个保护：sweep 在启动 2.5s 后跑，正好撞上用户刚点的删除，
             * 看到「已打标、文件还没搬走」就把条目打回 ok，结果是文件进了回收站、
             * 卡片却留在主页 —— 自己造出一个死卡（2026-11-09 压测复现）。 */
            if (r.trashPending) { continue; }
            if (Number(r.trashedAt) && Date.now() - Number(r.trashedAt) < FRESH_MS) { continue; }
            /* 只减引用（refOnly）：文件**本来**就留在原位，因为同内容的活跃条目还在用它。
             * 这不是「没搬走」，不能据此打回 ok。
             * 2026-11-13 修复：原来这一行写在 exists() 之后，于是 refOnly 条目每次启动
             * 自愈都被判成「文件还在原位」→ 打回 ok → 苏哥看到「删了又出现」。
             * 判据只看索引层，不看磁盘。 */
            if (r.trashNoFile) { continue; }
            var fsRel = stripPrefix(r.relPath, rr.prefix);
            var batchId = r.trashBatch || NO_BATCH;
            var copyRel = TRASH + '/' + batchId + '/' + fsRel;
            /* 回滚只有一个合法条件：**搬运真的没完成**（回收站里没有副本）+ 文件还在原位。
             * 副本已经存在 = 删除已经生效，无论原位又出现了什么（别的条目重新落盘、
             * 用户手工拷回），都不能替用户撤销删除 —— 要恢复请走 restore()。 */
            var copyHere = await exists(rr.handle, copyRel);
            if (!copyHere && await exists(rr.handle, fsRel)) {
                await patchRow(r.relPath, { state: 'ok', trashBatch: '', trashedAt: 0, trashNoFile: 0 });
                out.revived++;
                continue;
            }
            if (copyHere) { continue; }
            var batch = batchId;
            /* 文件不见了，但批次目录还在 → 可能只是路径口径不同（老版本/手工整理过），
             * 不动它，留给用户在回收站里自己判断；只有「连批次目录都没了」
             * 才是确定无可恢复内容的死条目。 */
            var batchAlive = false;
            try {
                await dirAt(rr.handle, [TRASH, batch], false);
                batchAlive = true;
            } catch (eB) { batchAlive = false; }
            if (batchAlive) { continue; }
            try { await root.VRDB.deleteFiles([r.relPath]); } catch (e) { /* 忽略 */ }
            deadThumbs.push(r.relPath);
            out.dropped++;
        }
        if (deadThumbs.length) { out.thumbs = await dropThumbs(deadThumbs); }

        /* c：前缀重复索引 */
        var prefix = String(rr.prefix || '').replace(/^\/+|\/+$/g, '');
        if (prefix) {
            var pfx = prefix + '/';
            var rels = Object.keys(byRel);
            for (var j = 0; j < rels.length; j++) {
                var shortRel = rels[j];
                if (!shortRel || shortRel.indexOf(pfx) === 0) { continue; }
                var canonRel = pfx + shortRel;
                var canon = byRel[canonRel];
                var dup = byRel[shortRel];
                if (!canon || !dup) { continue; }
                if (isTrashed(canon) !== isTrashed(dup)) {
                    /* 半边在回收站、半边还挂在主页 —— 这正是苏哥看到的死卡形态：
                     * 删的是带前缀那条（文件已搬走），无前缀那条还标着 ok，
                     * 指向的原路径已经空了，于是「文件没了、卡片还在」。
                     * 只在「两条 absPath 相同」且「主页那条的文件确实不存在」时才动，
                     * 避免把真正还没删的文件误清。 */
                    var canonAbs = String(canon.absPath || '').replace(/\\/g, '/').toLowerCase();
                    var dupAbs = String(dup.absPath || '').replace(/\\/g, '/').toLowerCase();
                    if (isTrashed(canon) && !isTrashed(dup) && canonAbs && canonAbs === dupAbs) {
                        var dupHere = await exists(rr.handle, stripPrefix(dup.relPath, rr.prefix));
                        if (!dupHere) {
                            try { await root.VRDB.deleteFiles([shortRel]); } catch (eD) { continue; }
                            await dropThumbs([shortRel]);
                            delete byRel[shortRel];
                            out.merged++;
                        }
                    }
                    continue;
                }
                /* 保留带前缀的规范条目，把用户数据并过去 */
                var keep = Object.assign({}, canon, {
                    starred: (canon.starred || 0) || (dup.starred || 0),
                    tags: (Array.isArray(canon.tags) && canon.tags.length) ? canon.tags : (dup.tags || []),
                    displayName: canon.displayName || dup.displayName || '',
                    state: isTrashed(canon) ? ST_TRASHED : 'ok'
                });
                try { await root.VRDB.putFiles([keep]); } catch (e2) { continue; }
                try { await root.VRDB.deleteFiles([shortRel]); } catch (e3) { continue; }
                await dropThumbs([shortRel]);
                delete byRel[shortRel];
                out.merged++;
            }
        }

        /* f：用回收站清单修「被扫描复活」的存量条目（2026-11-13，ADR-085）。
         * 判据全部来自**独立证据**，不靠猜：
         *   ① 磁盘上还有这个批次目录（目录没了就没法恢复，清单也不再可信）；
         *   ② 清单里记着该 relPath（跨浏览器备份，等价于「删除确实发生过」）；
         *   ③ 索引行现在是活跃态（ok / missing），说明它被某次扫描放回了主页；
         *   ④ 磁盘上那份文件与清单记录的是同一份（mtime 一致，容差 1s）。
         * ④ 是关键反例保护：删掉后又重新下载了同名文件，mtime 必然变，那是新文件，
         * 不能因为清单里有旧记录就把它打进回收站。
         * 对已经因此复活的存量库，下一次开库就能自动回到正确状态。 */
        var requarantined = 0;
        try {
            var disks2 = await diskBatches(rr);
            for (var di = 0; di < disks2.length; di++) {
                var dk = disks2[di];
                var mItems = dk.items || [];
                for (var mi = 0; mi < mItems.length; mi++) {
                    var m = mItems[mi] || {};
                    var mRel = String(m.relPath || '');
                    if (!mRel) { continue; }
                    var row = byRel[mRel];
                    if (!row || isTrashed(row)) { continue; }
                    /* 引用卡与待归档条目本来就没有独立实体，不适用这条规则 */
                    if (row.isRef || row.pendingArchive) { continue; }
                    var mTime = Number(m.mtime) || 0;
                    var rTime = Number(row.mtime) || 0;
                    if (mTime && rTime && Math.abs(mTime - rTime) > 1000) { continue; }
                    /* ⑤ 回收站里那份副本必须还在。
                     * restore() 是「把副本搬回原位」，搬完副本就没了；清单收缩万一
                     * 没写成功（那里是 catch 静默），这条判据能防止把用户刚恢复的
                     * 条目再打回回收站。refOnly 条目本来就没有副本，同样不命中。 */
                    var fsRel0 = stripPrefix(mRel, rr.prefix);
                    if (!(await exists(rr.handle, TRASH + '/' + dk.batch + '/' + fsRel0))) { continue; }
                    var patched = await patchRow(mRel, {
                        state: ST_TRASHED,
                        trashBatch: dk.batch,
                        trashedAt: Number(m.trashedAt) || Number(dk.at) || Date.now(),
                        trashNoFile: m.trashNoFile ? 1 : 0,
                        trashPending: 0
                    });
                    if (!patched) { continue; }   /* 索引不可写：下一轮再修 */
                    row.state = ST_TRASHED;
                    requarantined++;
                }
            }
        } catch (eF) { /* 清单读不到就跳过，不阻断其它自愈 */ }
        out.requarantined = requarantined;

        /* e：活死卡自愈，保守口径 —— 只清 state=ok 且文件确实不存在的行，
         * 绝不碰 missing（ADR-030 铁律：自动对账不许删用户已知缺失的条目）。
         * 这样就算上次清空时删行静默失败 / 状态被改回，下次开库也能自愈。 */
        out.dead = await dropDeadCards(rr, { includeMissing: false });

        if (out.revived || out.dropped || out.merged || out.pruned || out.dead || out.requarantined) {
            try { await root.VRDB.log('trash.sweep', {}, out); } catch (e4) { /* 忽略 */ }
        }

        /* d：顺手把「被搬空的目录」收掉（历史遗留的空壳目录靠这一趟清掉）。
         * 只对回收站条目的原目录动手，且 pruneEmptyDirs 本身遇到非空即停，不会误删。 */
        var pruned = 0;
        for (var k = 0; k < trashRows.length; k++) {
            var dRel = split(stripPrefix(trashRows[k].relPath, rr.prefix)).slice(0, -1).join('/');
            if (!dRel) { continue; }
            try { pruned += await pruneEmptyDirs(rr.handle, dRel); } catch (eP) { /* 忽略 */ }
        }
        out.pruned = pruned;

        return out;
    }

    /**
     * 按「库内相对路径」删一个物理文件（去重整理专用）。
     * 只删文件、不碰索引；调用方负责确认这份文件确实是多余的副本。
     * @returns {Promise<boolean>} 文件最终确实不在了 → true
     */
    async function removeAt(relPath) {
        try {
            var rr = await resolveRoot();
            if (!rr || !rr.handle) { return false; }
            await ensureRW(rr.handle);
            var fsRel = stripPrefix(String(relPath || ''), rr.prefix);
            var segs = split(fsRel);
            var name = segs.pop();
            if (!name) { return false; }
            var dir = segs.length ? await dirAt(rr.handle, segs, false) : rr.handle;
            if (!dir) { return false; }
            try { await dir.removeEntry(name); } catch (e1) { /* 可能已经不在了 */ }
            /* 以「文件确实不存在」为成功判据：removeEntry 偶发静默失败时不能谎报 */
            return !(await exists(rr.handle, fsRel));
        } catch (e) {
            return false;
        }
    }

    root.VRTrash = {
        TRASH_DIR: TRASH,
        STATE: ST_TRASHED,
        isTrashed: isTrashed,
        remove: remove,
        list: list,
        status: status,
        restore: restore,
        purge: purge,
        empty: empty,
        sweep: sweep,
        dropDeadCards: dropDeadCards,
        pruneEmptyDirs: pruneEmptyDirs,
        resolveRoot: resolveRoot,
        preflightRestore: preflightRestore,
        /* app.js 的「移动到…」需要；原实现调用未导出的 moveFile，必然失败。 */
        moveFile: moveFile,
        exists: exists,
        removeAt: removeAt
    };
})(typeof self !== 'undefined' ? self : this);
