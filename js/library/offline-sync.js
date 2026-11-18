/* ==========================================================
 * 离线库自动维护（防抖同步）
 *
 * 为什么需要（2026-11-18 需求确认）：
 *   用户场景是「电脑坏了 / 放移动硬盘，直接打开看」——
 *   这意味着**离线库必须随时是最新状态**，否则看到的是过期数据。
 *   手动点「生成」不可靠：用户不会记得。
 *
 * 做法（与 indexer.scheduleSnapshot 同构）：
 *   索引变化 → 防抖 30 秒 → 重写 data.js（109KB，<20ms）→ index.html 不动
 *
 * 边界：
 *   · 只写 _library/_offline/data.js 与库根 离线库.html（首次）
 *   · 不碰素材本体，不碰缩略图
 *   · FSA 句柄拿不到时静默跳过（用户没授权就不同步，不报错打扰）
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VROfflineSync = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    var DIR = '_offline';
    var DATA_FILE = 'data.js';
    var ENTRY_FILE = '离线库.html';
    var HTML_FILE = 'index.html';
    var DEFAULT_DELAY = 30000;

    var pending = false;
    var timer = 0;
    var writing = false;
    var lastError = '';
    var lastAt = 0;

    function now() { return Date.now(); }

    /** 拿库根句柄。
     *  优先 VRSave.probeEnv（SW/正式链路）；库页没有 save.js 时
     *  直接用 VRDB.getHandle('root') —— 实测库页里句柄可用且 permission=granted。 */
    async function getRoot() {
        try {
            if (root.VRSave && typeof root.VRSave.probeEnv === 'function') {
                var env = await root.VRSave.probeEnv();
                if (env && env.root) { return env.root; }
            }
        } catch (e) { /* 落到下一条路径 */ }
        try {
            if (root.VRDB && typeof root.VRDB.getHandle === 'function') {
                var h = await root.VRDB.getHandle('root');
                if (h && typeof h.getDirectoryHandle === 'function') {
                    /* 有句柄还要确认权限 —— 未授权时写盘会抛，提前判掉 */
                    if (typeof h.queryPermission === 'function') {
                        var p = await h.queryPermission({ mode: 'readwrite' });
                        if (p !== 'granted') { return null; }
                    }
                    return h;
                }
            }
        } catch (e2) { /* 无句柄 */ }
        return null;
    }

    /** 写一个文本文件到 <root>/<dirs...>/<name> */
    async function writeText(rootHandle, dirs, name, text) {
        var d = rootHandle;
        for (var i = 0; i < dirs.length; i++) {
            d = await d.getDirectoryHandle(dirs[i], { create: true });
        }
        var fh = await d.getFileHandle(name, { create: true });
        var w = await fh.createWritable();
        await w.write(text);
        await w.close();
    }

    /** 读一个文本文件（不存在返回 null） */
    async function readText(rootHandle, dirs, name) {
        try {
            var d = rootHandle;
            for (var i = 0; i < dirs.length; i++) {
                d = await d.getDirectoryHandle(dirs[i], { create: false });
            }
            var fh = await d.getFileHandle(name, { create: false });
            var f = await fh.getFile();
            return await f.text();
        } catch (e) { return null; }
    }

    /**
     * 立即同步一次（不防抖）。给「导出」按钮和首次安装用。
     * @returns {Promise<{ok:boolean, count?:number, bytes?:number, error?:string}>}
     */
    async function syncNow(opt) {
        var o = opt || {};
        if (writing) { return { ok: false, error: 'busy' }; }
        writing = true;
        try {
            if (!root.VROfflineExport || typeof root.VROfflineExport.buildBundle !== 'function') {
                return { ok: false, error: 'no-export-module' };
            }
            var rh = await getRoot();
            if (!rh) { return { ok: false, error: 'no-root-handle' }; }

            /* ① 取全量索引 */
            var files = [];
            if (root.VRDB && typeof root.VRDB.getAllFiles === 'function') {
                files = await root.VRDB.getAllFiles();
            }
            var prefix = '';
            try {
                prefix = await root.VRDB.getSetting('rootPrefix', '');
            } catch (e) { prefix = ''; }

            var snap = {
                schema: 2, version: 1, at: now(),
                root: '', subdir: String(prefix || ''),
                count: files.length, favorites: [], files: files
            };

            /* ② 生成三个文件 */
            var bundle = await root.VROfflineExport.buildBundle(snap, null, {
                title: o.title || '本地媒体库（离线）'
            });

            /* ③ 写盘 */
            await writeText(rh, ['_library', DIR], DATA_FILE, bundle.dataJs);

            /* index.html 只在不存在或显式要求时写（它几乎不变，省 IO） */
            var forceHtml = !!o.forceHtml;
            if (forceHtml) {
                await writeText(rh, ['_library', DIR], HTML_FILE, bundle.html);
            } else {
                var existing = await readText(rh, ['_library', DIR], HTML_FILE);
                if (!existing) {
                    await writeText(rh, ['_library', DIR], HTML_FILE, bundle.html);
                }
            }

            /* 库根入口页：只在不存在时写 */
            var entry = await readText(rh, [], ENTRY_FILE);
            if (!entry) {
                await writeText(rh, [], ENTRY_FILE, bundle.rootEntry);
            }

            lastAt = now();
            lastError = '';
            return { ok: true, count: bundle.count, bytes: bundle.bytes, where: ENTRY_FILE };
        } catch (e) {
            lastError = String((e && e.message) || e);
            return { ok: false, error: lastError };
        } finally {
            writing = false;
        }
    }

    /**
     * 防抖调度：索引变化后 delayMs 内合并成一次同步。
     * @param {number} [delayMs] 默认 30 秒
     */
    function schedule(delayMs) {
        var ms = Number(delayMs);
        if (!isFinite(ms) || ms <= 0) { ms = DEFAULT_DELAY; }
        pending = true;
        if (timer) { return { scheduled: true, merged: true }; }
        timer = setTimeout(function () {
            timer = 0;
            if (!pending) { return; }
            pending = false;
            syncNow({}).catch(function () { /* 失败下次再试，不打扰用户 */ });
        }, ms);
        return { scheduled: true, merged: false };
    }

    /** 立即把待写的刷掉（测试/退出前） */
    async function flush() {
        if (timer) { clearTimeout(timer); timer = 0; }
        if (!pending) { return null; }
        pending = false;
        return syncNow({});
    }

    function status() {
        return {
            pending: pending,
            writing: writing,
            lastAt: lastAt,
            lastError: lastError
        };
    }

    return {
        syncNow: syncNow,
        schedule: schedule,
        flush: flush,
        status: status,
        _DIR: DIR,
        _ENTRY: ENTRY_FILE,
        _DEFAULT_DELAY: DEFAULT_DELAY
    };
});
