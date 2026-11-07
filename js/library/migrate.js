/* ==========================================================
 * VRMigrate —— 资源库迁移引擎（S1b，页面上下文）
 *
 * 为什么在页面侧：扩展没有通用文件读写权限，chrome.downloads 只能
 * 从 URL 写、读不了本地文件；唯一可行的是 FSA 目录句柄，而
 * showDirectoryPicker / 句柄读写只能在扩展页面（options / library）里做。
 *
 * 三种形态共用一套流程：
 *   扫描 → 预演（plan）→ 复制 → 校验 → 删源 → 日志 → 回滚
 * 差别只在「目标相对路径怎么算」：
 *   rename-subdir : newName/<原相对路径>
 *   rebase        : 相对路径不变（只换根）
 *   restructure   : VRPath.buildRelPath() 按下载历史反查平台
 *
 * 规范见 docs/LIBRARY-PLAN.md §13.10。
 * 依赖：VRPath（路径拼装/类型判断）、VRDB（日志与索引同步，可缺省）
 * ========================================================== */
(function (root) {
    'use strict';

    var MAX_ITEMS = 20000;
    var MAX_DEPTH = 8;
    var SAMPLE = 64 * 1024;

    var SKIP_EXACT = { '_migration': 1, '_回收站': 1, '_verify': 1 };
    var SKIP_SUFFIX = /\.(part|crdownload|tmp)$/i;

    /* ---------------- 小工具 ---------------- */

    function uid(prefix) {
        return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function makeErr(code, msg) {
        var e = new Error(msg || code);
        e.vrCode = code;
        return e;
    }

    function errCode(e) {
        if (e && e.vrCode) { return e.vrCode; }
        var n = e && e.name;
        if (n === 'QuotaExceededError') { return 'LIB_E_ENOSPC'; }
        if (n === 'NoModificationAllowedError' || n === 'NotReadableError') { return 'LIB_E_EBUSY'; }
        if (n === 'NotAllowedError' || n === 'SecurityError') { return 'LIB_E_NO_PERM'; }
        return 'LIB_E_UNKNOWN';
    }

    function formatBytes(n) {
        n = Number(n) || 0;
        if (n < 1024) { return n + ' B'; }
        var units = ['KB', 'MB', 'GB', 'TB'];
        var i = -1;
        do { n = n / 1024; i++; } while (n >= 1024 && i < units.length - 1);
        return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + units[i];
    }

    function shouldSkip(name) {
        if (!name) { return true; }
        if (name.charAt(0) === '.') { return true; }
        if (name.charAt(0) === '~' && name.charAt(1) === '$') { return true; }
        if (SKIP_EXACT[name]) { return true; }
        if (SKIP_SUFFIX.test(name)) { return true; }
        return false;
    }

    function isMedia(name) {
        return !!(root.VRPath && root.VRPath.typeOf({ fileName: name }) !== 'other');
    }

    function splitRel(rel) {
        return String(rel || '').split('/').filter(Boolean);
    }

    /* ---------------- 目录遍历 ---------------- */

    /**
     * 递归收集媒体文件
     * @param {FileSystemDirectoryHandle} dir
     * @param {string} prefix 相对路径前缀（'' 表示根）
     * @param {Array} out
     */
    async function walk(dir, prefix, out) {
        if (out.length >= MAX_ITEMS) { return; }
        var pending = [];
        for await (var entry of dir.entries()) {
            pending.push(entry);
            if (pending.length > MAX_ITEMS) { break; }
        }
        for (var i = 0; i < pending.length; i++) {
            if (out.length >= MAX_ITEMS) { return; }
            var name = pending[i][0];
            var handle = pending[i][1];
            if (shouldSkip(name)) { continue; }
            var rel = prefix ? prefix + '/' + name : name;
            if (handle.kind === 'file') {
                if (!isMedia(name)) { continue; }
                var f = await handle.getFile();
                out.push({ rel: rel, name: name, size: f.size, mtime: f.lastModified, handle: handle, parent: dir });
            } else {
                if (splitRel(rel).length >= MAX_DEPTH) { continue; }
                await walk(handle, rel, out);
            }
        }
    }

    async function listFiles(dirHandle) {
        var out = [];
        await walk(dirHandle, '', out);
        return out;
    }

    /* ---------------- 目录操作 ---------------- */

    async function ensureDir(rootHandle, segs) {
        var dir = rootHandle;
        for (var i = 0; i < segs.length; i++) {
            dir = await dir.getDirectoryHandle(segs[i], { create: true });
        }
        return dir;
    }

    async function getDir(rootHandle, segs) {
        var dir = rootHandle;
        for (var i = 0; i < segs.length; i++) {
            dir = await dir.getDirectoryHandle(segs[i]);
        }
        return dir;
    }

    /** 目标已存在则返回 File（含 size），否则 null */
    async function findFile(rootHandle, rel) {
        var segs = splitRel(rel);
        if (!segs.length) { return null; }
        var name = segs.pop();
        var dir;
        try { dir = await getDir(rootHandle, segs); } catch (e) { return null; }
        try {
            var h = await dir.getFileHandle(name);
            return await h.getFile();
        } catch (e) {
            return null;
        }
    }

    /* ---------------- 计划 ---------------- */

    function emptyPlan(kind, srcName, dstName) {
        return {
            id: uid('plan-'), kind: kind, at: Date.now(),
            srcName: srcName || '', dstName: dstName || '',
            items: [], counts: { move: 0, skip: 0, conflict: 0, blocked: 0 },
            totalBytes: 0
        };
    }

    async function classify(dstHandle, from, to, srcSize, sameRoot) {
        // 只有「同一个根」里 from === to 才算路径未变；换根时两边的相对路径本就相同
        if (sameRoot && from === to) { return { action: 'skip', reason: '路径未变' }; }
        var check = root.VRPath ? root.VRPath.checkLength(to) : { ok: true };
        if (!check.ok) { return { action: 'blocked', reason: '路径过长（' + check.total + '）' }; }
        var exist = await findFile(dstHandle, to);
        if (!exist) { return { action: 'move' }; }
        if (exist.size === srcSize) { return { action: 'skip', reason: '目标已有同大小文件' }; }
        return { action: 'conflict', reason: '目标同名但大小不同' };
    }

    function tally(plan, items) {
        plan.items = items;
        plan.counts = { move: 0, skip: 0, conflict: 0, blocked: 0 };
        plan.totalBytes = 0;
        items.forEach(function (it) {
            plan.counts[it.action] = (plan.counts[it.action] || 0) + 1;
            if (it.action === 'move') { plan.totalBytes += it.size || 0; }
        });
        return plan;
    }

    /**
     * 形态一：改子目录名（父目录授权 → 旧子目录整体换成新名字）
     */
    async function planRenameSubdir(parentHandle, oldName, newName) {
        oldName = String(oldName || '').replace(/^\/+|\/+$/g, '');
        newName = (root.VRPath ? root.VRPath.cleanSeg(newName) : String(newName || '')).replace(/^\/+|\/+$/g, '');
        var plan = emptyPlan('rename-subdir', oldName, newName);
        plan.oldName = oldName;
        plan.newName = newName;
        plan.parentHandle = parentHandle;
        if (!oldName || !newName || oldName === newName) {
            plan.reason = oldName === newName ? '新旧名字相同' : '名字为空';
            return plan;
        }
        var oldDir;
        try {
            oldDir = await parentHandle.getDirectoryHandle(oldName);
        } catch (e) {
            plan.reason = '父目录下没有「' + oldName + '」';
            return plan;
        }
        var files = await listFiles(oldDir);
        var items = [];
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            var r = await classify(parentHandle, oldName + '/' + f.rel, newName + '/' + f.rel, f.size, false);
            items.push({ from: oldName + '/' + f.rel, to: newName + '/' + f.rel, action: r.action,
                reason: r.reason, size: f.size, srcHandle: f.handle, srcParent: f.parent, name: f.name });
        }
        plan.srcHandle = oldDir;
        plan.dstHandle = parentHandle;
        return tally(plan, items);
    }

    /**
     * 形态二：换根（源根 → 目标根，相对路径不变）
     * @param {object} opts { targetMode: 'system'|'custom' }（仅用于迁移后索引同步）
     */
    async function planRebase(srcHandle, dstHandle, opts) {
        opts = opts || {};
        var plan = emptyPlan('rebase', srcHandle ? srcHandle.name : '', dstHandle ? dstHandle.name : '');
        plan.srcHandle = srcHandle;
        plan.dstHandle = dstHandle;
        plan.targetMode = opts.targetMode || '';
        var files = await listFiles(srcHandle);
        var items = [];
        var sameRoot = (srcHandle === dstHandle);
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            var r = await classify(dstHandle, f.rel, f.rel, f.size, sameRoot);
            items.push({ from: f.rel, to: f.rel, action: r.action, reason: r.reason,
                size: f.size, srcHandle: f.handle, srcParent: f.parent, name: f.name });
        }
        return tally(plan, items);
    }

    /**
     * 形态三：整理旧文件（散文件 → 子目录/平台/博主/类型）
     * @param {Array} history [{filename, url}]，用于 basename → 平台反查
     */
    async function planRestructure(srcHandle, history) {
        var subdir = 'video-rod';
        try {
            var st = await getSettings();
            subdir = st.subdir || subdir;
        } catch (e) { /* 用默认 */ }

        var platformByBase = {};
        (history || []).forEach(function (h) {
            var base = String(h && h.filename || '').split(/[\\\/]/).pop().toLowerCase();
            if (!base || platformByBase[base]) { return; }
            var p = root.VRPath ? root.VRPath.detectPlatform(h.url || '') : 'web';
            platformByBase[base] = p;
        });

        var plan = emptyPlan('restructure', srcHandle ? srcHandle.name : '', subdir);
        plan.srcHandle = srcHandle;
        plan.dstHandle = srcHandle;      // 结构整理在同一根内完成
        plan.subdir = subdir;

        var files = await listFiles(srcHandle);
        var items = [];
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            var platform = platformByBase[f.name.toLowerCase()] || 'web';
            var to = root.VRPath.buildRelPath({
                platform: platform,
                creatorFull: '',
                creatorId: '',
                type: root.VRPath.typeOf({ fileName: f.name }),
                fileName: f.name,
                subdir: subdir
            });
            var r = await classify(srcHandle, f.rel, to, f.size, true);
            items.push({ from: f.rel, to: to, action: r.action, reason: r.reason,
                size: f.size, srcHandle: f.handle, srcParent: f.parent, name: f.name });
        }
        return tally(plan, items);
    }

    /* ---------------- 复制与校验 ---------------- */

    async function bytesAt(file, start, len) {
        var buf = await file.slice(start, start + len).arrayBuffer();
        return new Uint8Array(buf);
    }

    function sameBytes(a, b) {
        if (a.length !== b.length) { return false; }
        for (var i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) { return false; }
        }
        return true;
    }

    /** 首尾各 64KB 采样比对 */
    async function sampleEqual(a, b) {
        if (a.size !== b.size) { return false; }
        if (a.size === 0) { return true; }
        var len = Math.min(SAMPLE, a.size);
        if (!sameBytes(await bytesAt(a, 0, len), await bytesAt(b, 0, len))) { return false; }
        if (!sameBytes(await bytesAt(a, a.size - len, len), await bytesAt(b, b.size - len, len))) { return false; }
        return true;
    }

    async function sha256(file) {
        var buf = await file.arrayBuffer();
        var digest = await crypto.subtle.digest('SHA-256', buf);
        var arr = new Uint8Array(digest);
        var s = '';
        for (var i = 0; i < arr.length; i++) { s += ('0' + arr[i].toString(16)).slice(-2); }
        return s;
    }

    /**
     * 复制单个文件到目标目录并校验，成功后删源
     * @param {object} it 计划条目（含 srcHandle / srcParent / name）
     * @param {object} dstRoot 目标根
     * @param {function} onChunk 已写字节回调
     */
    async function copyOne(it, dstRoot, deepVerify, onChunk) {
        var toSegs = splitRel(it.to);
        var fileName = toSegs.pop();
        var srcFile = await it.srcHandle.getFile();

        var dstDir = await ensureDir(dstRoot, toSegs);
        var dstFileHandle = await dstDir.getFileHandle(fileName, { create: true });

        var writable = null;
        var written = 0;
        try {
            writable = await dstFileHandle.createWritable();
            var reader = srcFile.stream().getReader();
            while (true) {
                var r = await reader.read();
                if (r.done) { break; }
                await writable.write(r.value);
                written += r.value.byteLength || 0;
                if (onChunk) { onChunk(written); }
            }
            await writable.close();
            writable = null;

            var back = await dstFileHandle.getFile();
            if (back.size !== srcFile.size) {
                throw makeErr('LIB_E_HASH_MISMATCH', '大小不一致：源 ' + srcFile.size + ' / 目标 ' + back.size);
            }
            if (!(await sampleEqual(srcFile, back))) {
                throw makeErr('LIB_E_HASH_MISMATCH', '首尾采样不一致');
            }
            if (deepVerify) {
                var h1 = await sha256(srcFile);
                var h2 = await sha256(back);
                if (h1 !== h2) { throw makeErr('LIB_E_HASH_MISMATCH', 'SHA-256 不一致'); }
            }
        } catch (e) {
            try { if (writable) { await writable.abort(); } } catch (e2) { /* 忽略 */ }
            // 校验失败或写入失败都清掉半成品，避免留下残缺文件
            try { await dstDir.removeEntry(fileName); } catch (e3) { /* 忽略 */ }
            throw e;
        }

        // 校验通过才删源——宁可不搬，不可丢文件
        await it.srcParent.removeEntry(it.name);
        return written;
    }

    /* ---------------- 设置 / 日志 ---------------- */

    function getSettings() {
        return new Promise(function (resolve) {
            try {
                chrome.storage.local.get('vrLibSettings', function (o) {
                    resolve((o && o.vrLibSettings) || {});
                });
            } catch (e) {
                resolve({});
            }
        });
    }

    function dbReady() {
        return typeof root.VRDB !== 'undefined' && root.VRDB && typeof root.VRDB.setSetting === 'function';
    }

    function saveLog(log) {
        if (!dbReady()) { return Promise.resolve(false); }
        return root.VRDB.setSetting('migrateLog:' + log.id, log).then(function () {
            return root.VRDB.setSetting('migrateLog:last', log);
        }).then(function () { return true; }).catch(function () { return false; });
    }

    function lastLog() {
        if (!dbReady()) { return Promise.resolve(null); }
        return root.VRDB.getSetting('migrateLog:last', null);
    }

    /* ---------------- 执行 ---------------- */

    async function run(plan, onProgress) {
        if (!plan || !plan.items) { throw makeErr('LIB_E_UNKNOWN', '计划为空'); }
        var moves = plan.items.filter(function (it) { return it.action === 'move'; });
        var deep = false;
        try { deep = !!(await getSettings()).deepVerify; } catch (e) { /* 默认浅校验 */ }

        var log = {
            id: uid('mig-'), planId: plan.id, kind: plan.kind, at: Date.now(),
            srcName: plan.srcName, dstName: plan.dstName,
            srcHandle: plan.srcHandle, dstHandle: plan.dstHandle,
            done: [], failed: [], aborted: false, rolledBack: false,
            preBytes: plan.totalBytes, postBytes: 0,
            counts: plan.counts
        };
        await saveLog(log);

        var processed = 0;
        for (var i = 0; i < moves.length; i++) {
            var it = moves[i];
            var base = processed;
            try {
                await copyOne(it, plan.dstHandle, deep, function (n) {
                    if (onProgress) {
                        onProgress({ index: i + 1, total: moves.length,
                            doneBytes: base + n, totalBytes: plan.totalBytes, item: it });
                    }
                });
                processed += it.size || 0;
                log.done.push({ from: it.from, to: it.to, size: it.size || 0 });
            } catch (e) {
                var code = errCode(e);
                log.failed.push({ from: it.from, to: it.to, code: code,
                    message: String(e && e.message ? e.message : e) });
                log.aborted = true;      // 停止后续，源一律不删
                break;
            }
            await saveLog(log);          // 每条都落盘，页面崩了也能回滚
        }

        log.postBytes = processed;

        // 改子目录名成功后：清理旧目录里的空子目录（只删空），旧目录空了也一并删掉
        if (plan.kind === 'rename-subdir' && log.done.length && !log.failed.length && plan.srcHandle) {
            try {
                await pruneEmpty(plan.srcHandle);
                var stillHas = false;
                for await (var _ of plan.srcHandle.entries()) { stillHas = true; break; }
                if (!stillHas && plan.parentHandle) {
                    await plan.parentHandle.removeEntry(plan.oldName);
                }
            } catch (e) { /* 清不掉不影响迁移结果 */ }
        }

        try { await applyIndex(plan, log); } catch (e) { log.indexError = String(e && e.message || e); }
        await saveLog(log);

        if (dbReady() && root.VRDB.log) {
            try {
                await root.VRDB.log('migrate', { planId: plan.id, kind: plan.kind, counts: plan.counts,
                    aborted: log.aborted }, { done: log.done.length, failed: log.failed.length });
            } catch (e) { /* 日志失败不影响结果 */ }
        }
        return log;
    }

    /** 递归删空子目录（不删根） */
    async function pruneEmpty(dir) {
        var names = [];
        for await (var entry of dir.entries()) { names.push(entry[0]); }
        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            if (shouldSkip(name)) { continue; }
            var sub = null;
            try { sub = await dir.getDirectoryHandle(name); } catch (e) { continue; }
            await pruneEmpty(sub);
            var empty = true;
            for await (var e2 of sub.entries()) { empty = false; break; }
            if (empty) {
                try { await dir.removeEntry(name); } catch (e3) { /* 忽略 */ }
            }
        }
    }

    /* ---------------- 站点结构整理（2026-11-07） ---------------- */

    /** 老结构里的类型段（要丢掉，新结构不再按类型分目录） */
    function typeSegOf(seg) {
        var t = String(seg || '');
        var d = root.VRPath && root.VRPath.TYPE_DIR;
        if (d) {
            for (var k in d) { if (d[k] === t) { return k; } }
        }
        var a = root.VRPath && root.VRPath.TYPE_ALIAS;
        if (a && a[t.toLowerCase()]) { return a[t.toLowerCase()]; }
        return '';
    }

    /**
     * 识别一个目录段属于哪个站点。
     * 顺序：域名(先归一到平台 key) → 英文别名 → 站名反查。
     * @returns {string} 站点 key；认不出返回空串
     */
    function identifySite(seg) {
        var s = String(seg || '').trim();
        if (!s) { return ''; }
        var V = root.VRPath;
        var R = root.VRSiteRegistry;
        var PP = root.VRSiteNamesPreset;

        /* ① 域名形态：必须先归一成平台 key，否则会得到 www.instagram.com
         * 这种查不到任何名字、也与「instagram」对不上的键。 */
        if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s)) {
            var host = s.toLowerCase();
            if (V && V.detectPlatform) {
                try {
                    var p = V.detectPlatform('https://' + host + '/');
                    if (p && p !== 'web') { return p; }
                } catch (e) { /* 继续 */ }
            }
            if (R && R.detect) {
                try {
                    var d = R.detect('https://' + host + '/');
                    if (d && d.key) { return d.key; }
                } catch (e) { /* 继续 */ }
            }
            return host;
        }

        /* ② 英文别名目录（weibo / xiaohongshu / instagram / x / douyin…） */
        var alias = V && V.PLATFORM_ALIAS && V.PLATFORM_ALIAS[s.toLowerCase()];
        if (alias) { return alias; }

        /* ③ 站名反查（花瓣 / B站 / 小红书 / Pixso…） */
        if (R && R.keyOfName) {
            try { var k = R.keyOfName(s); if (k) { return k; } } catch (e) { /* 继续 */ }
        }
        if (PP && PP.byName) {
            try {
                var it = PP.byName(s);
                if (it && it.h && it.h.length) { return String(it.h[0]).toLowerCase(); }
            } catch (e) { /* 继续 */ }
        }
        return '';
    }

    /** 站点 key → 目录段（人话名字） */
    function resolveSiteDir(siteKey, siteSeg) {
        var V = root.VRPath;
        var R = root.VRSiteRegistry;
        var PP = root.VRSiteNamesPreset;
        var n = '';
        if (R && R.nameOf) {
            try { n = R.nameOf(siteKey) || ''; } catch (e) { n = ''; }
        }
        if (!n && V && V.PLATFORM_DIR && V.PLATFORM_DIR[siteKey]) { n = V.PLATFORM_DIR[siteKey]; }
        if (!n && PP && PP.byName) {
            try {
                var it = PP.byName(siteSeg);
                if (it && it.n) { n = it.n; }
            } catch (e) { /* 忽略 */ }
        }
        if (!n) { n = (V && V.cleanSeg) ? V.cleanSeg(siteSeg) : String(siteSeg || ''); }
        return n;
    }

    /**
     * 老相对路径 → 新相对路径（纯函数，可单测）。
     *
     * 目标结构：video-rod/<站名>/<作者或域名>/[<分P>/]<文件>
     *
     * 已知的老形态：
     *   A 其他网页/<域名>/<类型>/f        → <站名>/<域名>/f
     *   C <中文平台>/<作者>/<类型>/f       → <站名>/<作者>/f
     *   D <英文别名>/<作者>/images/f      → <站名>/<作者>/f
     *   E 微博/weibo/<类型>/f             → 微博/weibo/f（拍平冗余层）
     *
     * 返回 null 表示「认不出来，不要动」——宁可留在原地，也不猜错位置。
     */
    function remapRelPath(rel) {
        var segs = splitRel(rel);
        if (segs.length < 2) { return null; }
        var fileName = segs[segs.length - 1];
        /* 磁盘实测：老文件大多**没有** video-rod 前缀（相对资源库根），
         * 所以这里不假定首段是子目录，全部目录段一起参与站点识别。 */
        var mid = segs.slice(0, segs.length - 1);

        /* 站点段 = mid 的第一个「可识别为站点」的段 */
        var R = root.VRSiteRegistry;
        var PP = root.VRSiteNamesPreset;
        var siteSegIdx = -1;
        var siteKey = '', siteDir = '';

        for (var i = 0; i < mid.length; i++) {
            var seg = mid[i];
            var key = '';

            /* 域名形态（未收录站点当年直接以域名成目录） */
            if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(seg)) { key = seg.toLowerCase(); }

            /* 英文别名目录（xiaohongshu / instagram / weibo / douyin / x…）：
             * 这些是更早期的落盘形态，必须一并认出来，否则整批保持原地
             * （2026-11-07 实测：xiaohongshu/作者/images 被漏掉）。 */
            if (!key) {
                var alias = root.VRPath && root.VRPath.PLATFORM_ALIAS;
                if (alias && alias[String(seg).toLowerCase()]) { key = alias[String(seg).toLowerCase()]; }
            }

            /* 站名反查（花瓣 / B站 / 小红书…） */
            if (!key) {
                if (R && R.keyOfName) {
                    try { key = R.keyOfName(seg) || ''; } catch (e) { key = ''; }
                }
                if (!key && PP && PP.byName) {
                    try {
                        var hit = PP.byName(seg);
                        if (hit && hit.h && hit.h.length) { key = String(hit.h[0]).toLowerCase(); }
                    } catch (e) { key = ''; }
                }
            }
            if (!key) { continue; }
            siteSegIdx = i;
            siteKey = key;
            break;
        }

        if (siteSegIdx < 0) { return null; }

        /* 「其他网页」不是站点，是当年的兜底段：它后面那段域名才是站点 */
        var siteSeg = mid[siteSegIdx];
        var rest = mid.slice(siteSegIdx + 1);
        if (siteSeg === '其他网页' && rest.length) {
            siteKey = String(rest[0]).toLowerCase();
            siteSeg = rest[0];
            rest = rest.slice(1);
        }

        /* 站名：把「平台 key / 别名 / 域名」统一解析成人话名字。
         * 顺序：站点字典(host) → 站名反查 → 内置平台中文名 → 原段。
         * 2026-11-07 实测：xiaohongshu / instagram 这类英文别名目录
         * 若直接回落到原段，就永远合并不成「小红书 / Instagram」。 */
        siteDir = '';
        var hostKey = siteKey;
        if (R && R.keyOfName) {
            try { hostKey = R.keyOfName(siteSeg) || siteKey; } catch (e) { hostKey = siteKey; }
        }
        if (R && R.nameOf) {
            try {
                siteDir = R.nameOf(siteKey) || R.nameOf(hostKey) || '';
            } catch (e) { siteDir = ''; }
        }
        if (!siteDir) {
            var PD = root.VRPath && root.VRPath.PLATFORM_DIR;
            if (PD && PD[siteKey]) { siteDir = PD[siteKey]; }
        }
        if (!siteDir && PP && PP.byName) {
            try {
                var hitN = PP.byName(siteSeg);
                if (hitN && hitN.n) { siteDir = hitN.n; }
            } catch (e) { /* 忽略 */ }
        }
        if (!siteDir) { siteDir = root.VRPath ? root.VRPath.cleanSeg(siteSeg) : siteSeg; }

        /* 剩余段：过滤类型段，剩下的是 作者 / 分P */
        var kept = [];
        var sawType = false;
        for (var j = 0; j < rest.length; j++) {
            if (typeSegOf(rest[j])) { sawType = true; continue; }
            kept.push(rest[j]);
        }

        /* 域名当年被当作「作者位」写进目录：新结构里站点段已经是站名，
         * 这一段若是域名就保留（它是这条素材唯一的来源线索）。 */
        var authorSeg = kept[0] || '';
        var partSeg = kept[1] || '';

        /* 作者段若其实就是「同一个站点」（weibo.com / www.instagram.com /
         * pixso.cn / 微博），丢掉 —— 那一层只是站点的另一种写法。 */
        if (authorSeg) {
            var aLow = String(authorSeg).toLowerCase();
            var sameSite = (aLow === String(siteDir).toLowerCase()
                || aLow === String(siteKey).toLowerCase()
                || aLow === String(siteSeg).toLowerCase());
            if (!sameSite && identifySite(authorSeg)) {
                /* 作者位写的是域名/别名：归一到站点 key 后与当前站点比对 */
                try {
                    var aKey = identifySite(authorSeg);
                    if (String(aKey).toLowerCase() === String(siteKey).toLowerCase()) { sameSite = true; }
                } catch (e) { /* 忽略 */ }
            }
            if (!sameSite) {
                var aliasMap = root.VRPath && root.VRPath.PLATFORM_ALIAS;
                var ak = aliasMap && aliasMap[aLow];
                if (ak) {
                    var akName = (root.VRPath && root.VRPath.PLATFORM_DIR && root.VRPath.PLATFORM_DIR[ak]) || '';
                    sameSite = (ak === siteKey) || (akName && akName === siteDir);
                }
            }
            if (sameSite) { authorSeg = ''; }
        }

        /* 站点段之前的段：只保留真正的整体前缀（如 video-rod），
         * 丢掉与站点重复的段、类型段、以及「其他网页」容器段 ——
         * 否则会得到「其他网页/花瓣/」「微博/微博/」。 */
        var webContainer = (root.VRPath && root.VRPath.PLATFORM_DIR &&
            root.VRPath.PLATFORM_DIR.web) || '其他网页';
        var before = [];
        for (var b = 0; b < siteSegIdx; b++) {
            var bs = mid[b];
            var bl = String(bs).toLowerCase();
            if (bl === String(siteDir).toLowerCase()) { continue; }
            if (bl === String(siteKey).toLowerCase()) { continue; }
            if (bs === webContainer || bs === '其他网页' || bs === 'web') { continue; }
            if (typeSegOf(bs)) { continue; }
            before.push(bs);
        }

        var out = before.concat([siteDir]);
        if (authorSeg) { out.push(authorSeg); }
        if (partSeg) { out.push(partSeg); }
        out.push(fileName);

        var next = out.join('/');
        if (next === rel) { return null; }   // 已经在目标位置
        return { to: next, siteKey: siteKey, siteName: siteDir, hadType: sawType };
    }

    /** 目标已存在同名文件时，给文件名加 _2 / _3 … 后缀，保留两份都不丢 */
    async function uniqueTarget(rootHandle, rel, srcSize) {
        var segs = splitRel(rel);
        var name = segs.pop() || '';
        var dot = name.lastIndexOf('.');
        var stem = dot > 0 ? name.slice(0, dot) : name;
        var ext = dot > 0 ? name.slice(dot) : '';
        for (var n = 2; n <= 99; n++) {
            var cand = segs.concat([stem + '_' + n + ext]).join('/');
            var exist = await findFile(rootHandle, cand);
            /* 没有同名 → 可直接用；有同名但大小相同 → 视为同一文件，不重复搬 */
            if (!exist) { return { to: cand, dup: false }; }
            if (exist.size === srcSize) { return { to: cand, dup: true }; }
        }
        return { to: rel, dup: false };
    }

    /**
     * 整理历史目录：把老结构整体映射到「站点/作者」结构。
     * 只出计划不动文件；执行走 run()，日志与回滚完全复用现有管线。
     */
    async function planSiteRestructure(srcHandle) {
        var plan = emptyPlan('site-restructure', srcHandle ? srcHandle.name : '', '');
        plan.srcHandle = srcHandle;
        plan.dstHandle = srcHandle;      // 同一个根内完成
        plan.pending = [];               // 认不出归属的，列出来给用户看
        plan.renamed = 0;                // 同名冲突被加后缀的条数

        var files;
        try { files = await listFiles(srcHandle); } catch (e) { plan.reason = String(e && e.message || e); return plan; }

        var items = [];
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            var m = null;
            try { m = remapRelPath(f.rel); } catch (e) { m = null; }
            if (!m) {
                plan.pending.push({ rel: f.rel, reason: '认不出站点（保持原地）' });
                continue;
            }
            var r = await classify(srcHandle, f.rel, m.to, f.size, true);
            var to = m.to;

            /* 同名冲突：加 _2 / _3 后缀，两份都保留（用户 2026-11-07 要求） */
            if (r.action === 'conflict') {
                var u = await uniqueTarget(srcHandle, m.to, f.size);
                if (u.dup) {
                    r = { action: 'skip', reason: '目标已有同大小文件' };
                } else {
                    to = u.to;
                    r = await classify(srcHandle, f.rel, to, f.size, true);
                    if (r.action === 'move') { plan.renamed++; }
                }
            }

            items.push({
                from: f.rel, to: to, action: r.action, reason: r.reason,
                size: f.size, srcHandle: f.handle, srcParent: f.parent, name: f.name,
                siteName: m.siteName
            });
        }
        return tally(plan, items);
    }


    async function applyIndex(plan, log) {
        if (!dbReady() || !root.VRDB.getAllFiles) { return { updated: 0 }; }
        if (!log.done.length) { return { updated: 0 }; }

        var st = await getSettings();
        var rootDir = String(st.detectedRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        var customRoot = String(st.customRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        var files = await root.VRDB.getAllFiles();
        var patches = [];
        var map = {};
        log.done.forEach(function (d) { map[d.from] = d.to; });

        files.forEach(function (f) {
            var rel = f.relPath || '';
            var next = null;
            if (plan.kind === 'rename-subdir') {
                if (rel.indexOf(plan.oldName + '/') === 0) {
                    next = plan.newName + rel.slice(plan.oldName.length);
                }
            } else if (plan.kind === 'restructure') {
                var first = rel.split('/')[0];
                var rest = rel.split('/').slice(1).join('/');
                if (map[rest]) { next = first + '/' + map[rest]; }
            }
            if (!next || next === rel) { return; }

            var abs = f.absPath || '';
            var absNext = '';
            var useCustom = (plan.kind === 'rebase' && plan.targetMode === 'custom') || st.mode === 'custom';
            if (useCustom && customRoot) {
                absNext = customRoot + '/' + next.split('/').slice(1).join('/');
            } else if (rootDir) {
                absNext = rootDir + '/' + next;
            }
            patches.push({ relPath: rel, next: next, absNext: absNext || abs });
        });

        if (!patches.length) { return { updated: 0 }; }

        // 按 relPath 重写：先删旧键再写新键（key 就是 relPath，改不了只能重建）
        var list = [];
        for (var i = 0; i < patches.length; i++) {
            var p = patches[i];
            var cur = await root.VRDB.getFile(p.relPath);
            if (!cur) { continue; }
            cur.relPath = p.next;
            cur.absPath = p.absNext;
            cur.movedAt = Date.now();
            list.push(cur);
        }
        if (list.length) { await root.VRDB.putFiles(list); }
        await root.VRDB.deleteFiles(patches.map(function (p) { return p.relPath; }));
        return { updated: list.length };
    }

    /* ---------------- 回滚 ---------------- */

    async function rollback(logId) {
        var log = null;
        if (dbReady()) { log = await root.VRDB.getSetting('migrateLog:' + logId, null); }
        if (!log) { throw makeErr('LIB_E_UNKNOWN', '找不到迁移日志：' + logId); }
        if (!log.done || !log.done.length) { throw makeErr('LIB_E_UNKNOWN', '这条日志没有可回滚的条目'); }

        var failed = [];
        var restored = 0;
        for (var i = log.done.length - 1; i >= 0; i--) {
            var d = log.done[i];
            try {
                var toSegs = splitRel(d.to);
                var toName = toSegs.pop();
                var fromSegs = splitRel(d.from);
                var fromName = fromSegs.pop();

                var srcDir = await getDir(log.dstHandle, toSegs);
                var srcHandle = await srcDir.getFileHandle(toName);
                var srcFile = await srcHandle.getFile();

                var dstDir = await ensureDir(log.srcHandle, fromSegs);
                var backHandle = await dstDir.getFileHandle(fromName, { create: true });
                var w = await backHandle.createWritable();
                try {
                    var reader = srcFile.stream().getReader();
                    while (true) {
                        var r = await reader.read();
                        if (r.done) { break; }
                        await w.write(r.value);
                    }
                    await w.close();
                } catch (e2) {
                    try { await w.abort(); } catch (e3) { /* 忽略 */ }
                    try { await dstDir.removeEntry(fromName); } catch (e4) { /* 忽略 */ }
                    throw e2;
                }

                var back = await backHandle.getFile();
                if (back.size !== srcFile.size || !(await sampleEqual(srcFile, back))) {
                    throw makeErr('LIB_E_HASH_MISMATCH', '回滚校验失败');
                }
                await srcDir.removeEntry(toName);
                restored++;
            } catch (e) {
                failed.push({ from: d.from, to: d.to, code: errCode(e) });
                break;
            }
        }

        log.rolledBack = (failed.length === 0);
        log.rollbackAt = Date.now();
        log.restored = restored;
        await saveLog(log);

        if (log.rolledBack) {
            try { await revertIndex(log); } catch (e) { /* 索引回退失败不影响文件 */ }
        }
        return { rolledBack: log.rolledBack, failed: failed, restored: restored, log: log };
    }

    async function revertIndex(log) {
        if (!dbReady()) { return; }
        var st = await getSettings();
        var rootDir = String(st.detectedRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        var files = await root.VRDB.getAllFiles();
        var map = {};
        log.done.forEach(function (d) { map[d.to] = d.from; });
        var patches = [];
        files.forEach(function (f) {
            var rel = f.relPath || '';
            var first = rel.split('/')[0];
            var rest = rel.split('/').slice(1).join('/');
            if (!map[rest]) { return; }
            var next = first + '/' + map[rest];
            patches.push({ old: rel, next: next, absNext: rootDir ? (rootDir + '/' + next) : f.absPath });
        });
        if (!patches.length) { return; }
        var list = [];
        for (var i = 0; i < patches.length; i++) {
            var cur = await root.VRDB.getFile(patches[i].old);
            if (!cur) { continue; }
            cur.relPath = patches[i].next;
            cur.absPath = patches[i].absNext;
            list.push(cur);
        }
        if (list.length) { await root.VRDB.putFiles(list); }
        await root.VRDB.deleteFiles(patches.map(function (p) { return p.old; }));
    }

    root.VRMigrate = {
        MAX_ITEMS: MAX_ITEMS,
        SAMPLE: SAMPLE,
        listFiles: listFiles,
        planRenameSubdir: planRenameSubdir,
        planRebase: planRebase,
        planRestructure: planRestructure,
        planSiteRestructure: planSiteRestructure,
        remapRelPath: remapRelPath,
        run: run,
        rollback: rollback,
        lastLog: lastLog,
        applyIndex: applyIndex,
        formatBytes: formatBytes,
        errCode: errCode,
        // 测试用：直接验一个目标文件与源文件是否一致
        _sampleEqual: sampleEqual,
        _sha256: sha256
    };
})(typeof self !== 'undefined' ? self : this);
