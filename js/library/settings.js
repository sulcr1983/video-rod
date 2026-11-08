/* ==========================================================
 * VRSettings —— 资源库设置页（S1a）
 *
 * 职责：
 *   1. 读写 chrome.storage.local 的 vrLibSettings
 *   2. 渲染 options.html「资源库」分区
 *   3. 「校验落盘」：发 1KB 微下载 → 反推真实下载根目录 → 清理
 *   4. 「选择文件夹并授权」：FSA 句柄存 IndexedDB（供 S1b 搬移/迁移用）
 *
 * 说明：FSA 只给目录句柄，拿不到绝对路径，所以「自定义目录」的路径要手填；
 *       选择文件夹仅用于授权。零依赖，ES5，挂 window.VRSettings。
 * ========================================================== */
(function (root) {
    'use strict';

    var KEY = 'vrLibSettings';
    var DEFAULTS = {
        mode: 'system',        // system | custom
        subdir: 'video-rod',
        customRoot: '',
        detectedRoot: '',
        verifyPassed: false,
        lastVerifyAt: 0,
        // 迁移时是否对源/目标文件做完整 SHA-256 比对（migrate.js 读这个键）。
        // 默认关：大文件要读两遍，代价明显；浅校验（首尾采样）已能挡住绝大多数问题。
        deepVerify: false
    };

    var state = null;

    /* 站点名称面板的状态。**必须在这里声明**：init() 在 defer 脚本执行时
     * 可能同步运行（document.readyState 已是 interactive），而 var 只提升
     * 声明不提升赋值 —— 若写在 init 之后，首帧读到的是 undefined。
     * （2026-11-07 实测：siteQuery.toLowerCase 直接抛错，面板空白） */
    var siteRows = [];        // 当前展示的行（已筛选）
    var siteQuery = '';

    function $(id) { return document.getElementById(id); }

    function text(id, msg, color) {
        var el = $(id);
        if (!el) { return; }
        el.textContent = msg || '';
        el.style.color = color || '';
    }

    /* ---------------- 存储 ---------------- */

    /**
     * 读设置。storage 不可用（旧浏览器/权限收回/本地直接打开页面）时必须
     * 用默认值继续，**不能抛**：本函数在 defer 脚本末尾被 init() 同步调用，
     * 一旦异常就会中断整个 IIFE，后面的 SRC_LABEL、root.VRSettings 全部
     * 不会被赋值（2026-11-07 实测：站点名称面板空白 + VRSettings undefined）。
     */
    function load(cb) {
        var fallback = function () {
            setTimeout(function () {
                state = Object.assign({}, DEFAULTS);
                cb(state);
            }, 0);
        };
        try {
            chrome.storage.local.get(KEY, function (obj) {
                state = Object.assign({}, DEFAULTS, obj && obj[KEY]);
                cb(state);
            });
        } catch (e) {
            /* 必须异步回调：init() 在 defer 脚本末尾同步调用 load()，
             * 若这里同步执行 cb，init 会在 IIFE 还没跑完时执行，
             * 后面的 LIB_FIELDS / SRC_LABEL / root.VRSettings 全都没赋值
             * （2026-11-07 实测：面板空白 + VRSettings undefined）。 */
            fallback();
        }
    }

    /**
     * 写设置：先读一遍存储再合并 patch。
     * 为什么不是直接覆盖内存 state：这份 vrLibSettings 与图片设置（imgHover/imgMinSize…）
     * 共用同一个键，内存里的 state 只装资源库自己的字段；
     * 整体覆盖会把别人刚写进去的键抹掉（用户在图片面板改完再回来点这个开关就丢）。
     */
    function save(patch, cb) {
        chrome.storage.local.get(KEY, function (obj) {
            var cur = Object.assign({}, obj && obj[KEY], patch);
            state = Object.assign({}, DEFAULTS, cur);
            var o = {};
            o[KEY] = cur;
            chrome.storage.local.set(o, function () {
                if (cb) { cb(state); }
            });
        });
    }

    /* ---------------- FSA 句柄（IndexedDB） ---------------- */

    function openIdb() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open('vr-lib-handle', 1);
            req.onupgradeneeded = function () {
                if (!req.result.objectStoreNames.contains('kv')) {
                    req.result.createObjectStore('kv');
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function idbPut(key, val) {
        return openIdb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('kv', 'readwrite');
                tx.objectStore('kv').put(val, key);
                tx.oncomplete = function () { resolve(true); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function idbGet(key) {
        return openIdb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('kv', 'readonly');
                var req = tx.objectStore('kv').get(key);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    /* ---------------- 索引状态（验证自动入库） ---------------- */

    function escHtml(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function refreshIndex() {
        chrome.runtime.sendMessage({ Message: 'vrLib.stats' }, function (r) {
            if (chrome.runtime.lastError || !r || !r.ok) {
                text('vrLibIndex', '未就绪（SW 未响应）', '#b26a00');
                return;
            }
            text('vrLibIndex', '已入库 ' + r.count + ' 条', r.count > 0 ? '#2e7d32' : '#666');
        });
        if (root.VRIndex && root.VRIndex.status) {
            root.VRIndex.status().then(function (s) {
                var msg = '已入库 ' + s.count + ' 条';
                if (s.missing) { msg += ' · 缺失 ' + s.missing; }
                if (s.snapshotAt) {
                    var d = new Date(s.snapshotAt);
                    msg += ' · 快照 ' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' +
                        ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
                }
                text('vrLibIndex', msg, s.count > 0 ? '#2e7d32' : '#666');
            }).catch(function () { /* 状态失败不覆盖原文案 */ });
        }
        chrome.runtime.sendMessage({ Message: 'vrLib.list' }, function (r) {
            if (chrome.runtime.lastError || !r || !r.ok) { return; }
            var el = $('vrLibRecent');
            if (!el) { return; }
            var list = (r.list || []).slice().sort(function (a, b) {
                return (b.mtime || 0) - (a.mtime || 0);
            }).slice(0, 5);
            el.innerHTML = list.length
                ? list.map(function (it) {
                    var rel = escHtml(it.relPath);
                    return '<div class="recent-item" title="' + rel + '">' + rel + '</div>';
                }).join('')
                : '—';
        });
    }

    /* ---------------- 渲染 ---------------- */

    var uiMode = '';             // 未保存前用户点选的模式；保存后与 state.mode 对齐
    var pendingHandle = null;    // 本次选择、尚未保存的目录句柄
    var pendingName = '';
    var pendingCount = null;
    var handleName = '';         // 已保存目录句柄的显示名（FSA 拿不到绝对路径）
    var scanBusy = false;

    function modeOf() {
        return (state && state.mode === 'custom') ? 'custom' : 'system';
    }

    function currentMode() {
        return uiMode || modeOf();
    }

    function baseNameOf(p) {
        return String(p || '').replace(/\\/g, '/').split('/').pop() || '';
    }

    /** 与库页 app.js 的 ensureRoot 同口径：从下载记录反推下载根目录 */
    function guessBase(list, subdir) {
        var want = '/' + String(subdir || 'video-rod') + '/';
        var i;
        for (i = 0; i < list.length; i++) {
            var f = String((list[i] || {}).filename || '').replace(/\\/g, '/');
            var k = f.indexOf(want);
            if (k > 0) { return f.slice(0, k); }
        }
        for (i = 0; i < list.length; i++) {
            var g = String((list[i] || {}).filename || '').replace(/\\/g, '/');
            var dir = g.slice(0, g.lastIndexOf('/'));
            if (dir) { return dir; }
        }
        return '';
    }

    /** 首次打开就把默认位置算出来；算不到也允许保存，首次下载时浏览器会自动建目录 */
    function resolveDetectedRoot(cb) {
        if (state.detectedRoot) { if (cb) { cb(state.detectedRoot); } return; }
        try {
            chrome.downloads.search({ limit: 50, orderBy: ['-startTime'] }, function (list) {
                var base = guessBase(list || [], (state && state.subdir) || 'video-rod');
                if (!base) { if (cb) { cb(''); } return; }
                save({ detectedRoot: base }, function () {
                    render();
                    if (cb) { cb(base); }
                });
            });
        } catch (e) { if (cb) { cb(''); } }
    }

    function render() {
        if (!state) { return; }
        var mode = currentMode();

        var sub = $('vrLibSubdir');
        if (sub && document.activeElement !== sub) { sub.value = state.subdir || 'video-rod'; }

        var sys = $('vrLibModeSystem'), cus = $('vrLibModeCustom');
        if (sys) { sys.checked = mode === 'system'; }
        if (cus) { cus.checked = mode === 'custom'; }
        var optS = $('vrLibOptSystem'), optC = $('vrLibOptCustom');
        if (optS) { optS.classList.toggle('on', mode === 'system'); }
        if (optC) { optC.classList.toggle('on', mode === 'custom'); }

        var box = $('vrLibCustomBox');
        if (box) { box.hidden = mode !== 'custom'; }
        var subBox = $('vrLibSubdirBox');
        if (subBox) { subBox.hidden = mode === 'custom'; }
        var authBox = $('vrLibAuthBox');
        if (authBox) { authBox.hidden = mode === 'custom'; }

        var custom = $('vrLibCustomRoot');
        if (custom && document.activeElement !== custom) { custom.value = state.customRoot || ''; }

        var rootEl = $('vrLibRoot');
        if (rootEl) {
            var subdir = state.subdir || 'video-rod';
            if (state.detectedRoot) {
                var shown = String(state.detectedRoot + '\\' + subdir).replace(/\//g, '\\');
                rootEl.textContent = shown;
                rootEl.title = shown;
            } else {
                rootEl.textContent = '系统下载目录\\' + subdir + '（首次下载时自动创建）';
                rootEl.title = '';
            }
        }

        var nameEl = $('vrLibCustomName');
        if (nameEl) {
            var nm = pendingName || (state.mode === 'custom'
                ? (state.customRoot ? baseNameOf(state.customRoot) : handleName)
                : '');
            if (mode !== 'custom') {
                nameEl.textContent = '把素材存到你指定的文件夹；已有内容会扫描入库';
            } else if (!nm) {
                nameEl.textContent = '未选择（点下方「选择文件夹…」）';
            } else {
                nameEl.textContent = '已选择：' + nm +
                    (pendingCount != null ? ('，发现 ' + pendingCount + (pendingCount >= 5000 ? '+' : '') + ' 个媒体文件') : '');
            }
        }

        renderLibSettings();
    }

    /* ---------------- 保存位置：选择 / 扫描 / 保存 ---------------- */

    var SKIP_DIRS = { _verify: 1, _回收站: 1, _library: 1, _migration: 1, _selftest: 1 };

    function skipDirName(name) {
        return !name || name.charAt(0) === '.' || SKIP_DIRS[name] || /\.(part|crdownload|tmp)$/i.test(name);
    }

    function isMediaName(name) {
        try { return root.VRPath.typeOf({ fileName: name }) !== 'other'; } catch (e) { return false; }
    }

    /** 选目录时先数一下会导入多少，别让用户点保存后才发现很大 */
    async function countMediaInHandle(handle, limit) {
        var cap = limit || 5000;
        var n = 0;
        async function walk(dir, depth) {
            if (n >= cap || depth > 6) { return; }
            for await (var entry of dir.entries()) {
                var name = entry[0], eh = entry[1];
                if (skipDirName(name)) { continue; }
                if (eh.kind === 'file') {
                    if (isMediaName(name)) { n++; }
                } else {
                    await walk(eh, depth + 1);
                }
                if (n >= cap) { return; }
            }
        }
        await walk(handle, 0);
        return n;
    }

    /**
     * FSA 只给目录句柄，拿不到绝对路径。这里用「文件名 + 大小」对一遍下载记录：
     * 只要目录里有任意一个文件是浏览器下载过的，就能反推出这个目录的绝对路径。
     * 对不上就返回空——预览走句柄，不阻塞保存。
     */
    async function inferAbsRoot(handle) {
        var list = await new Promise(function (resolve) {
            try {
                chrome.downloads.search({ limit: 5000, orderBy: ['-startTime'] }, function (l) {
                    void chrome.runtime.lastError;
                    resolve(l || []);
                });
            } catch (e) { resolve([]); }
        });
        var byKey = {};
        list.forEach(function (d) {
            if (!d || d.state !== 'complete' || !d.filename) { return; }
            var k = baseNameOf(d.filename).toLowerCase() + '|' + (d.fileSize || d.totalBytes || 0);
            if (!byKey[k]) { byKey[k] = d.filename; }
        });
        if (!Object.keys(byKey).length) { return ''; }

        var hit = null, seen = 0;
        async function walk(dir, rel, depth) {
            if (hit || depth > 5 || seen > 500) { return; }
            for await (var entry of dir.entries()) {
                var name = entry[0], eh = entry[1];
                if (skipDirName(name)) { continue; }
                var r = rel ? (rel + '/' + name) : name;
                if (eh.kind === 'file') {
                    seen++;
                    try {
                        var f = await eh.getFile();
                        var k = name.toLowerCase() + '|' + f.size;
                        if (byKey[k]) { hit = { abs: byKey[k], rel: r }; return; }
                    } catch (e) { /* 跳过读不了的文件 */ }
                } else {
                    await walk(eh, r, depth + 1);
                }
                if (hit || seen > 500) { return; }
            }
        }
        try { await walk(handle, '', 0); } catch (e) { return ''; }
        if (!hit) { return ''; }

        var dir = String(hit.abs).replace(/\\/g, '/');
        var cut = dir.lastIndexOf('/');
        if (cut > 0) { dir = dir.slice(0, cut); }
        var segs = hit.rel.split('/');
        segs.pop();                                  // 去掉文件名
        for (var i = 0; i < segs.length; i++) {
            var k2 = dir.lastIndexOf('/');
            if (k2 <= 2) { break; }                   // 别把盘符削掉
            dir = dir.slice(0, k2);
        }
        return dir.replace(/\//g, '\\');
    }

    function pickCustom() {
        if (typeof root.showDirectoryPicker !== 'function') {
            text('vrLibCustomMsg', '此浏览器不支持目录选择（需 Chrome 86+）', '#c0392b');
            return;
        }
        root.showDirectoryPicker({ mode: 'readwrite' }).then(function (h) {
            var display = h.name || '已选文件夹';
            pendingHandle = h;
            pendingName = display;
            pendingCount = null;
            uiMode = 'custom';
            render();
            text('vrLibCustomMsg', '已选择：' + display + '，正在检查已有文件…', '#666');
            return idbPut('root', h).catch(function () { return null; }).then(function () {
                return countMediaInHandle(h).catch(function () { return null; });
            }).then(function (n) {
                pendingCount = n;
                render();
                return inferAbsRoot(h).catch(function () { return ''; });
            }).then(function (abs) {
                if (abs) {
                    var input = $('vrLibCustomRoot');
                    if (input && !String(input.value || '').trim()) { input.value = abs; }
                }
                text('vrLibCustomMsg',
                    '已选择：' + display +
                    (pendingCount != null ? ('，发现 ' + pendingCount + (pendingCount >= 5000 ? '+' : '') + ' 个媒体文件') : '') +
                    '；点「保存并使用」开始入库', '#2e7d32');
            });
        }).catch(function (e) {
            if (e && e.name === 'AbortError') { return; }   // 用户取消
            text('vrLibCustomMsg', '选择失败：' + ((e && e.message) || e), '#c0392b');
        });
    }

    /** 默认位置授权：已有句柄先尝试恢复权限；没有才弹目录选择 */
    async function authDefault() {
        var sub = cleanSeg($('vrLibSubdir') ? $('vrLibSubdir').value : state.subdir);
        var base = state.detectedRoot
            ? (String(state.detectedRoot).replace(/\/+$/, '') + '/' + sub)
            : '';
        var parent = state.detectedRoot ? baseNameOf(state.detectedRoot) : '';
        var h = null;
        try { h = await root.VRDB.getHandle('root'); } catch (e) { /* 忽略 */ }
        if (!h) { try { h = await idbGet('root'); } catch (e) { /* 忽略 */ } }
        /* 旧版本可能存了错目录的句柄（如 download）。只接受本目录或它的上级，
         * 否则「授权写入」会去申请一个错句柄，恢复完仍然不能写。 */
        if (h && h.name !== sub && (!parent || h.name !== parent)) { h = null; }
        if (h) {
            try {
                /* 先对已有句柄申请权限，再下钻子目录；顺序反了会在 prompt 状态
                 * 直接因为「不能创建目录」失败，白白把用户踢去重选。 */
                var grant = (typeof h.requestPermission !== 'function')
                    ? 'granted'
                    : await h.requestPermission({ mode: 'readwrite' });
                if (grant === 'granted') {
                    if (h.name !== sub) {
                        try { h = await h.getDirectoryHandle(sub, { create: true }); }
                        catch (e2) { h = null; }
                    }
                    if (h) {
                        await root.VRIndex.setRoot(h, base, sub);
                        await idbPut('root', h);
                        handleName = h.name || handleName;
                        render();
                        text('vrLibAuthMsg', '已恢复写入权限' +
                            (base ? ('：' + base.replace(/\//g, '\\')) : ''), '#2e7d32');
                        refreshAuthState();
                        return;
                    }
                }
            } catch (e) { /* 落到重新选择 */ }
        }
        if (typeof root.showDirectoryPicker !== 'function') {
            text('vrLibAuthMsg', '此浏览器不支持目录选择（需 Chrome 86+）', '#c0392b');
            return;
        }
        try {
            var picked = await root.showDirectoryPicker({ mode: 'readwrite' });
            if (picked.name !== sub) {
                if (!parent || picked.name !== parent) {
                    text('vrLibAuthMsg', '请选择「' + sub + '」文件夹' +
                        (parent ? ('，或它的上级「' + parent + '」') : ''), '#c0392b');
                    return;
                }
                try { picked = await picked.getDirectoryHandle(sub, { create: true }); }
                catch (e2) {
                    text('vrLibAuthMsg', '无法打开或创建「' + sub + '」文件夹', '#c0392b');
                    return;
                }
            }
            await root.VRIndex.setRoot(picked, base, sub);
            await idbPut('root', picked);
            handleName = picked.name || handleName;
            render();
            text('vrLibAuthMsg', '已授权写入' +
                (base ? ('：' + base.replace(/\//g, '\\')) : ('：' + picked.name)), '#2e7d32');
            refreshAuthState();
        } catch (e) {
            if (e && e.name === 'AbortError') { return; }
            text('vrLibAuthMsg', '授权失败：' + ((e && e.message) || e), '#c0392b');
        }
    }

    /** 设置页显示当前写入授权状态；浏览器收回权限时给出可操作提示 */
    async function refreshAuthState() {
        var msg = $('vrLibAuthMsg');
        if (!msg || !state) { return; }
        var h = null;
        try { h = await root.VRDB.getHandle('root'); } catch (e) { /* 忽略 */ }
        if (!h) { try { h = await idbGet('root'); } catch (e) { /* 忽略 */ } }
        if (!h) {
            msg.textContent = '未授权写入（可选）；下载和浏览不受影响';
            msg.style.color = '';
            return;
        }
        var sub = cleanSeg(($('vrLibSubdir') && $('vrLibSubdir').value) || (state && state.subdir));
        var parent = state.detectedRoot ? baseNameOf(state.detectedRoot) : '';
        if (h.name !== sub && (!parent || h.name !== parent)) {
            msg.textContent = '当前授权的是「' + h.name + '」，不是「' + sub + '」；点「授权写入」重新选择';
            msg.style.color = '#b26a00';
            return;
        }
        var st = 'granted';
        try {
            if (h.queryPermission) { st = await h.queryPermission({ mode: 'readwrite' }); }
        } catch (e) { st = 'error'; }
        if (st === 'granted') {
            var p = state.detectedRoot
                ? (state.detectedRoot + '\\' + (state.subdir || 'video-rod')).replace(/\//g, '\\')
                : (h.name || '');
            msg.textContent = '已授权写入：' + p;
            msg.style.color = '#2e7d32';
        } else {
            msg.textContent = '已选过目录，但浏览器暂时收回了写入权限；点「授权写入」恢复，不用重选';
            msg.style.color = '#b26a00';
        }
    }

    function dropRootHandle() {
        pendingHandle = null;
        pendingName = '';
        pendingCount = null;
        handleName = '';
        try { idbPut('root', null); } catch (e) { /* 忽略 */ }
        try {
            if (root.VRIndex && root.VRIndex.setRoot) { root.VRIndex.setRoot(null, '', ''); }
        } catch (e) { /* 忽略 */ }
    }

    function saveAll() {
        if (scanBusy || !state) { return; }
        var mode = currentMode();
        var subEl = $('vrLibSubdir');
        var sub = cleanSeg(subEl ? subEl.value : state.subdir);

        if (mode === 'system') {
            var wasCustom = state.mode === 'custom';
            save({ mode: 'system', subdir: sub }, function () {
                uiMode = 'system';
                if (wasCustom) { dropRootHandle(); }
                render();
                text('vrLibSaveMsg', '正在识别下载目录…', '#666');
                resolveDetectedRoot(function (base) {
                    var target = base ? (String(base).replace(/\//g, '\\') + '\\' + sub) : ('系统下载目录\\' + sub);
                    text('vrLibSaveMsg',
                        '已保存：' + target + (base ? '' : '（首次下载时自动创建）'), '#2e7d32');
                });
            });
            return;
        }

        var h = pendingHandle;
        var absEl = $('vrLibCustomRoot');
        var abs = String((absEl && absEl.value) || state.customRoot || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
        if (!h) {
            if (state.mode !== 'custom') {
                text('vrLibSaveMsg', '请先点「选择文件夹…」选一个目录', '#b26a00');
                return;
            }
            idbGet('root').then(function (saved) {
                if (!saved) {
                    text('vrLibSaveMsg', '请先点「选择文件夹…」选一个目录', '#b26a00');
                    return;
                }
                pendingHandle = saved;
                saveCustom(saved, abs, sub);
            }).catch(function () {
                text('vrLibSaveMsg', '请先点「选择文件夹…」选一个目录', '#b26a00');
            });
            return;
        }
        saveCustom(h, abs, sub);
    }

    function saveCustom(handle, abs, sub) {
        scanBusy = true;
        handleName = handle.name || handleName;
        text('vrLibSaveMsg', '正在保存…', '#666');
        save({ mode: 'custom', customRoot: abs, subdir: sub }, async function () {
            uiMode = 'custom';
            render();
            try { await idbPut('root', handle); } catch (e) { /* 忽略 */ }
            try {
                if (root.VRIndex && root.VRIndex.setRoot) {
                    await root.VRIndex.setRoot(handle, abs, sub);
                }
            } catch (e) { /* 内存态失败不影响本次扫描，下面会报错 */ }

            text('vrLibSaveMsg', '已保存，正在扫描已有素材…', '#666');
            try {
                if (!root.VRIndex) { throw new Error('索引模块未加载'); }
                var r = await root.VRIndex.build({
                    mode: 'full',
                    /* 首次导入自选文件夹时不要把旧位置的条目判成缺失：
                     * 这不是「文件被删」，只是换了库根。保留旧条目，用户可切回。 */
                    markMissing: false,
                    onProgress: function (p) {
                        if (p && p.total) {
                            text('vrLibSaveMsg', '正在扫描 ' + p.done + ' / ' + p.total + '…', '#666');
                        }
                    }
                });
                var un = 0;
                try {
                    var all = await root.VRDB.getAllFiles();
                    un = all.filter(function (f) { return f && f.untracked; }).length;
                } catch (e) { /* 统计失败不影响结果 */ }
                text('vrLibSaveMsg',
                    '已保存并入库：' + (r.ok || 0) + ' 个文件' +
                    (un ? ('，其中 ' + un + ' 个在「未整理」') : '') +
                    '。原有文件未移动。', '#2e7d32');
                refreshIndex();
            } catch (e) {
                text('vrLibSaveMsg', '已保存，但扫描失败：' + ((e && e.message) || e), '#c0392b');
            } finally {
                scanBusy = false;
                pendingHandle = null;
                pendingName = '';
                pendingCount = null;
                render();
            }
        });
    }

    /* ---------------- 校验落盘 ---------------- */

    function cleanSeg(s) {
        return String(s || '').replace(/[<>:"|?*\\\/\u0000-\u001F]/g, '_').trim() || 'video-rod';
    }

    function verify() {
        var sub = cleanSeg(state.subdir);
        var ts = Date.now();
        var rel = sub + '/_verify/' + ts + '.txt';
        var body = 'video-rod verify ' + new Date().toISOString();
        var url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(body);

        text('vrLibVerifyMsg', '正在写入微下载…', '#666');
        chrome.downloads.download({ url: url, filename: rel, conflictAction: 'overwrite' }, function (id) {
            if (!id) {
                var le = chrome.runtime.lastError;
                text('vrLibVerifyMsg', '失败：' + (le ? le.message : '无法发起下载'), '#c0392b');
                return;
            }
            var tries = 0;
            var timer = setInterval(function () {
                chrome.downloads.search({ id: id }, function (list) {
                    var d = list && list[0];
                    if (!d) {
                        clearInterval(timer);
                        text('vrLibVerifyMsg', '失败：下载记录丢失', '#c0392b');
                        return;
                    }
                    if (d.state !== 'complete' && d.state !== 'interrupted') {
                        if (++tries > 60) {
                            clearInterval(timer);
                            text('vrLibVerifyMsg', '超时：文件未写完', '#c0392b');
                        }
                        return;
                    }
                    clearInterval(timer);
                    finish(d, rel);
                });
            }, 300);
        });
    }

    function finish(d, rel) {
        var abs = String(d.filename || '').replace(/\\/g, '/');
        var tail = '/' + rel;
        var rootDir = '';
        if (abs.length > tail.length && abs.slice(-tail.length) === tail) {
            rootDir = abs.slice(0, abs.length - tail.length);
        }

        chrome.downloads.removeFile(d.id, function () {
            chrome.downloads.erase({ id: d.id }, function () { /* 记录一并清掉 */ });
        });

        if (d.state === 'interrupted') {
            text('vrLibVerifyMsg', '写入被中断：' + (d.error || '未知原因'), '#c0392b');
            return;
        }
        if (!rootDir) {
            text('vrLibVerifyMsg', '写入成功但无法反推根目录：' + abs, '#c0392b');
            return;
        }

        var okSub = abs.indexOf('/' + rel) !== -1;
        save({
            detectedRoot: rootDir,
            verifyPassed: okSub,
            lastVerifyAt: Date.now()
        }, function (s) {
            render();
            text('vrLibVerifyMsg',
                okSub ? ('通过：实际落盘 ' + abs + '（根目录 ' + rootDir + '）')
                      : ('异常：落点不在子目录内 ' + abs),
                okSub ? '#2e7d32' : '#c0392b');
        });
    }

    /* ---------------- 索引维护（S2） ---------------- */

    function absRootNow() {
        if ((state.mode || 'system') === 'custom') {
            return String(state.customRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        }
        var rootDir = String(state.detectedRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        return rootDir ? (rootDir + '/' + (state.subdir || 'video-rod')) : '';
    }

    function bindIndex() {
        var build = $('vrLibIdxBuild');
        if (build) {
            build.addEventListener('click', function () {
                if (!root.VRIndex) { text('vrLibIdxMsg', '索引模块未加载', '#c0392b'); return; }
                text('vrLibIdxMsg', '正在从下载记录重建…', '#666');
                root.VRIndex.build({ mode: 'downloads' }).then(function (r) {
                    text('vrLibIdxMsg', '重建完成：' + r.ok + ' 条' +
                        (r.missing ? '（标记缺失 ' + r.missing + '）' : ''), '#2e7d32');
                    refreshIndex();
                }).catch(function (e) {
                    text('vrLibIdxMsg', '失败：' + (e && e.message || e), '#c0392b');
                });
            });
        }

        var snap = $('vrLibIdxSnap');
        if (snap) {
            snap.addEventListener('click', function () {
                if (!root.VRIndex) { text('vrLibIdxMsg', '索引模块未加载', '#c0392b'); return; }
                text('vrLibIdxMsg', '正在写快照…', '#666');
                root.VRIndex.snapshot().then(function (p) {
                    text('vrLibIdxMsg', '快照已写入 ' + p, '#2e7d32');
                    refreshIndex();
                }).catch(function (e) {
                    text('vrLibIdxMsg', '失败：' + (e && e.message || e), '#c0392b');
                });
            });
        }

        var full = $('vrLibIdxFull');
        if (full) {
            full.addEventListener('click', function () {
                if (!root.VRIndex) { text('vrLibIdxMsg', '索引模块未加载', '#c0392b'); return; }
                if (typeof root.showDirectoryPicker !== 'function') {
                    text('vrLibIdxMsg', '此浏览器不支持目录选择（需 Chrome 86+）', '#c0392b');
                    return;
                }
                var abs = absRootNow();
                if (!abs) {
                    text('vrLibIdxMsg', '请先点「校验落盘」确定根目录（自定义模式请先填路径）', '#b26a00');
                    return;
                }
                root.showDirectoryPicker({ mode: 'read' }).then(function (h) {
                    return root.VRIndex.setRoot(h, abs).then(function () {
                        return root.VRIndex.build({ mode: 'full' });
                    });
                }).then(function (r) {
                    text('vrLibIdxMsg', '全量扫描完成：' + r.ok + ' 条' +
                        (r.missing ? '（标记缺失 ' + r.missing + '）' : ''), '#2e7d32');
                    refreshIndex();
                }).catch(function (e) {
                    if (e && e.name === 'AbortError') { return; }
                    text('vrLibIdxMsg', '失败：' + (e && e.message || e), '#c0392b');
                });
            });
        }

        /* 备份/恢复按钮（阶段 4） */
        try { bindBackup(); } catch (e) { /* 按钮不存在时忽略 */ }
    }

    /* ---------------- 备份 / 恢复（阶段 4） ----------------
     *
     * 为什么需要这两个按钮：
     *   用户真实的备份动作是「把整个素材文件夹拷到移动硬盘」。
     *   但 `_library/` 里是散落的 index.json + thumbs/*.webp，
     *   没有工具时难以确认「到底备份全了没有」。
     *   导出一个整包 zip，恢复时直接读回，是最不容易出错的形态。
     *
     * 口径：
     *   · 导出 = 只打包 `_library/`（索引 + 收藏夹 + 缩略图），不碰素材本体
     *   · 恢复 = 从已授权的目录读 `_library/index.json` 重放，不删任何东西
     */

    /** 列出一组目录下所有文件（递归，仅文件） */
    async function listFiles(dir, prefix) {
        var out = [];
        try {
            for await (var e of dir.entries()) {
                var name = e[0], h = e[1];
                var rel = prefix ? (prefix + '/' + name) : name;
                if (h.kind === 'file') {
                    out.push({ rel: rel, handle: h });
                } else {
                    var sub = await listFiles(h, rel);
                    out = out.concat(sub);
                }
            }
        } catch (err) { /* 单个子目录读不到不影响其余 */ }
        return out;
    }

    function bindBackup() {
        var exp = $('vrLibExport');
        if (exp) {
            exp.addEventListener('click', function () {
                if (typeof root.showDirectoryPicker !== 'function') {
                    text('vrLibIdxMsg', '此浏览器不支持目录选择', '#c0392b');
                    return;
                }
                text('vrLibIdxMsg', '请选择资源库根目录（含 _library 的那一层）…', '#666');
                root.showDirectoryPicker({ mode: 'read' }).then(async function (h) {
                    var lib;
                    try {
                        lib = await h.getDirectoryHandle('_library');
                    } catch (e) {
                        throw new Error('这个目录里没有 _library 子目录');
                    }
                    var files = await listFiles(lib, '');
                    if (!files.length) { throw new Error('_library 里没有文件'); }

                    text('vrLibIdxMsg', '正在打包 ' + files.length + ' 个文件…', '#666');
                    /* 零依赖打包：用最简 STORE（不压缩）zip，避免引入库。
                     * 索引是 JSON、缩略图已是 webp，再压缩收益很小。 */
                    var entries = [];
                    for (var i = 0; i < files.length; i++) {
                        var f = await files[i].handle.getFile();
                        entries.push({ name: '_library/' + files[i].rel, file: f });
                    }
                    var blob = await makeZip(entries);
                    downloadBlob(blob, '_library-backup.zip');
                    text('vrLibIdxMsg', '已导出 ' + files.length + ' 个文件（' +
                        Math.round(blob.size / 1048576 * 10) / 10 + ' MB）', '#2e7d32');
                }).catch(function (e) {
                    if (e && e.name === 'AbortError') { return; }
                    text('vrLibIdxMsg', '导出失败：' + (e && e.message || e), '#c0392b');
                });
            });
        }

        var res = $('vrLibRestore');
        if (res) {
            res.addEventListener('click', function () {
                if (!root.VRIndex) { text('vrLibIdxMsg', '索引模块未加载', '#c0392b'); return; }
                if (typeof root.showDirectoryPicker !== 'function') {
                    text('vrLibIdxMsg', '此浏览器不支持目录选择', '#c0392b');
                    return;
                }
                text('vrLibIdxMsg', '请选择资源库根目录（含 _library 的那一层）…', '#666');
                root.showDirectoryPicker({ mode: 'read' }).then(function (h) {
                    return root.VRIndex.setRoot(h, absRootNow()).then(function () {
                        return root.VRIndex.build({ mode: 'snapshot' });
                    });
                }).then(function (r) {
                    text('vrLibIdxMsg', '恢复完成：读回 ' + r.ok + ' 条' +
                        (r.missing ? '（其中 ' + r.missing + ' 条标记缺失）' : ''), '#2e7d32');
                    refreshIndex();
                }).catch(function (e) {
                    if (e && e.name === 'AbortError') { return; }
                    text('vrLibIdxMsg', '恢复失败：' + (e && e.message || e), '#c0392b');
                });
            });
        }
    }

    /** 极简 STORE 模式 zip：实现在 js/library/zip.js（可单测），这里只做 Blob 包装。
     *  为什么不内联：zip 头部字段错一个字节解压就报损坏，而这类错平时不会被发现，
     *  必须靠 tools/test-zip.js 的结构化断言兜住。 */
    async function makeZip(entries) {
        if (!root.VRZip) { throw new Error('zip 模块未加载（js/library/zip.js）'); }
        var list = [];
        for (var i = 0; i < entries.length; i++) {
            var data = new Uint8Array(await entries[i].file.arrayBuffer());
            list.push({ name: entries[i].name, data: data });
        }
        return new Blob([root.VRZip.build(list)], { type: 'application/zip' });
    }

    function downloadBlob(blob, filename) {
        try {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
                if (a.parentNode) { a.parentNode.removeChild(a); }
            }, 1000);
        } catch (e) {
            text('vrLibIdxMsg', '下载触发失败：' + (e && e.message || e), '#c0392b');
        }
    }

    /* ---------------- 事件绑定 ---------------- */

    function bind() {
        var sub = $('vrLibSubdir');
        var saveBtn = $('vrLibSaveSubdir');
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                var v = cleanSeg(sub && sub.value);
                if (sub) { sub.value = v; }
                saveAll();
            });
        }

        ['vrLibModeSystem', 'vrLibModeCustom'].forEach(function (id) {
            var radio = $(id);
            if (!radio) { return; }
            radio.addEventListener('change', function () {
                if (!radio.checked) { return; }
                uiMode = radio.value;
                render();
                if (uiMode === 'custom') {
                    text('vrLibCustomMsg', pendingHandle ? '点「保存并使用」开始入库'
                        : '先点「选择文件夹…」选一个目录', '#666');
                }
            });
        });

        var custom = $('vrLibCustomRoot');
        if (custom) {
            custom.addEventListener('change', function () {
                if (currentMode() !== 'custom') { return; }
                save({ customRoot: String(custom.value || '').trim() });
            });
        }

        var pick = $('vrLibPickDir');
        if (pick) { pick.addEventListener('click', pickCustom); }

        var authBtn = $('vrLibAuthDefault');
        if (authBtn) { authBtn.addEventListener('click', authDefault); }

        var verifyBtn = $('vrLibVerify');
        if (verifyBtn) { verifyBtn.addEventListener('click', verify); }

        var refresh = $('vrLibRefresh');
        if (refresh) { refresh.addEventListener('click', refreshIndex); }

        var openPage = $('vrLibOpenPage');
        if (openPage) {
            openPage.addEventListener('click', function () {
                chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
            });
        }

        /* 直达链接（2026-11-08）：扩展没有固定 key，ID 随加载路径变，
         * 所以地址必须运行时取，不能写死在 HTML 里。 */
        var urlBox = $('vrLibUrl');
        var libUrl = '';
        try { libUrl = chrome.runtime.getURL('library.html'); } catch (e) { libUrl = ''; }
        if (urlBox && libUrl) { urlBox.value = libUrl; }

        var copyBtn = $('vrLibUrlCopy');
        if (copyBtn) {
            copyBtn.addEventListener('click', async function () {
                if (!libUrl) { return; }
                try {
                    await navigator.clipboard.writeText(libUrl);
                    copyBtn.textContent = '已复制';
                    setTimeout(function () { copyBtn.textContent = '复制'; }, 1500);
                } catch (e) {
                    /* 剪贴板被拒（窗口没聚焦 / 无权限）时退回手选，别让用户卡住 */
                    if (urlBox) { urlBox.focus(); urlBox.select(); }
                    copyBtn.textContent = '请按 Ctrl+C';
                    setTimeout(function () { copyBtn.textContent = '复制'; }, 2500);
                }
            });
        }

        /* 加书签：chrome.bookmarks 需要 "bookmarks" 权限。
         * 没权限时明确告诉用户，而不是静默失败。 */
        var bmBtn = $('vrLibUrlBookmark');
        if (bmBtn) {
            bmBtn.addEventListener('click', function () {
                if (!libUrl) { return; }
                var api = chrome.bookmarks;
                if (!api || typeof api.create !== 'function') {
                    bmBtn.textContent = '无书签权限';
                    setTimeout(function () { bmBtn.textContent = '加书签'; }, 2500);
                    return;
                }
                try {
                    api.create({ title: '媒体库 · 苏哥的钓鱼竿', url: libUrl }, function (node) {
                        var err = chrome.runtime.lastError;
                        if (err) {
                            bmBtn.textContent = '添加失败';
                            setTimeout(function () { bmBtn.textContent = '加书签'; }, 2500);
                            return;
                        }
                        bmBtn.textContent = '已加书签';
                        setTimeout(function () { bmBtn.textContent = '加书签'; }, 2000);
                    });
                } catch (e) {
                    bmBtn.textContent = '添加失败';
                    setTimeout(function () { bmBtn.textContent = '加书签'; }, 2500);
                }
            });
        }

        // 资源库页面/SW 广播有新条目时自动刷新
        try {
            chrome.runtime.onMessage.addListener(function (msg) {
                if (msg && msg.Message === 'vrLib.added') { refreshIndex(); }
            });
        } catch (e) { /* 忽略 */ }
    }

    /* ---------------- 启动 ---------------- */

    function init() {
        if (!$('anchorLibrary')) { return; }       // 不是 options 页
        /* 站点名称面板只读 vrSiteNames，与 vrLibSettings 无关。
         * 放在 load() 之前绑定：vrLibSettings 读取异常时（旧浏览器 / 权限收回）
         * 不能让整块面板停在「正在读取…」。 */
        bindSiteNames();
        load(function () {
            uiMode = state.mode === 'custom' ? 'custom' : 'system';
            render();
            bind();
            bindIndex();
            bindLibSettings();
            refreshIndex();
            /* 目录句柄只有名字（FSA 不给绝对路径），显示出来让用户知道选的是哪个 */
            idbGet('root').then(function (h) {
                if (h && h.name) {
                    handleName = h.name;
                    if (currentMode() === 'custom') { render(); }
                }
            }).catch(function () { /* 无句柄属正常 */ });
            /* 首次打开：默认位置也要立刻显示真实路径，不能停在「未探测」 */
            if (currentMode() === 'system') { resolveDetectedRoot(); }
            refreshAuthState();
            // 图片下载设置（I5）：控件在 #anchorImage，与清单面板同一份存储
            if ($('anchorImage')) {
                bindImageSettings();
                renderImageSettings();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /* ---------------- 图片下载设置（I5） ---------------- */

    /* 资源库自身的开关（非图片）。
     * 单独一张表：这些键由 migrate.js / indexer.js 直接读原始 storage，
     * 不经过 VRImageUtil.mergeSettings，混进 IMG_FIELDS 会让「图片设置」语义变模糊。 */
    var LIB_FIELDS = [
        { id: 'DeepVerify', key: 'deepVerify', type: 'bool' }
    ];

    /** 把存储里的资源库开关刷到控件上（state 已在 init 里 load 过） */
    function renderLibSettings() {
        if (!state) { return; }
        LIB_FIELDS.forEach(function (f) {
            var el = $(f.id);
            if (el) { el.checked = !!state[f.key]; }
        });
    }

    function bindLibSettings() {
        LIB_FIELDS.forEach(function (f) {
            var el = $(f.id);
            if (!el) { return; }
            el.addEventListener('change', function () {
                var patch = {};
                patch[f.key] = !!el.checked;
                save(patch);
            });
        });
    }

    /* ---------------- 站点名称面板 ---------------- */

    /** 一行 = 一个站点。手改/自动记录以 vrSiteNames 为准，预置表只做补充。 */
    function collectSiteRows() {
        var ST = root.VRSiteNameStore;
        var PP = root.VRSiteNamesPreset;
        var out = {};
        var recall = (ST && ST.snapshot) ? ST.snapshot() : null;

        /* 预置表：先铺底（source = preset） */
        var presetList = (PP && PP.list) ? PP.list() : [];
        presetList.forEach(function (it) {
            (it.h || []).forEach(function (h) {
                if (!out[h]) {
                    out[h] = { host: h, name: it.n, src: 'preset', at: 0, manual: 0, cat: it.c };
                }
            });
        });

        /* 自动学习 / 手改：覆盖预置（source = learned / manual） */
        if (recall && typeof recall === 'object') {
            Object.keys(recall).forEach(function (h) {
                var r = recall[h] || {};
                if (!r.name) { return; }
                out[h] = {
                    host: h,
                    name: r.name,
                    src: r.manual ? 'manual' : (r.src || 'learned'),
                    at: r.at || 0,
                    manual: r.manual || 0,
                    cat: (out[h] && out[h].cat) || ''
                };
            });
        }
        return Object.keys(out).map(function (h) { return out[h]; });
    }

    var SRC_LABEL = {
        manual: '手改', preset: '预置', learned: '自动',
        og: '自动', meta: '自动', manifest: '自动', jsonld: '自动', title: '自动',
        page: '自动', tab: '自动', cache: '自动', import: '导入'
    };

    function srcBadge(src) {
        var label = SRC_LABEL[src] || (src === 'preset' ? '预置' : '自动');
        var cls = (src === 'manual' || src === 'import') ? 'manual'
            : (src === 'preset' ? 'preset' : 'auto');
        return '<span class="site-src site-src-' + cls + '">' + escHtml(label) + '</span>';
    }

    function fmtSiteTime(ts) {
        if (!ts) { return '—'; }
        var d = new Date(Number(ts));
        if (isNaN(d.getTime())) { return '—'; }
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    function renderSiteNames() {
        var box = $('vrSiteNameList');
        if (!box) { return; }
        var q = siteQuery.toLowerCase().trim();
        var rows = collectSiteRows().filter(function (r) {
            if (!q) { return true; }
            return (r.host || '').toLowerCase().indexOf(q) >= 0
                || (r.name || '').toLowerCase().indexOf(q) >= 0;
        });
        /* 手改优先，其次自动，再预置；同类按域名排 */
        var rank = { manual: 0, import: 0, learned: 1, preset: 2 };
        rows.sort(function (a, b) {
            var ra = rank[a.src] == null ? 1 : rank[a.src];
            var rb = rank[b.src] == null ? 1 : rank[b.src];
            if (ra !== rb) { return ra - rb; }
            return String(a.host).localeCompare(String(b.host));
        });
        siteRows = rows;

        var cnt = $('vrSiteNameCount');
        if (cnt) {
            var learned = rows.filter(function (r) { return r.src !== 'preset'; }).length;
            cnt.textContent = '共 ' + rows.length + ' 个站点，其中 ' + learned + ' 个有手改或自动记录';
        }

        if (!rows.length) {
            box.innerHTML = '<span class="explain">没有匹配的站点。下载任意网站的素材后，这里会自动出现。</span>';
            return;
        }

        /* 只渲染前 300 行：全量 400+ 行一次性铺 DOM 会明显卡顿，搜索可缩小范围 */
        var shown = rows.slice(0, 300);
        box.innerHTML = shown.map(function (r) {
            var host = escHtml(r.host);
            /* 站名在前、域名在后：人认名字，不认域名。
             * 名字为空时输入框显示空、用 placeholder 提示会回退域名。 */
            return '<div class="site-name-row" data-host="' + host + '">' +
                '<input type="text" class="site-name-input" data-host="' + host + '" ' +
                    'value="' + escHtml(r.name) + '" placeholder="（未命名，将用域名）" />' +
                '<code class="site-name-host" title="' + host + '">' + host + '</code>' +
                srcBadge(r.src) +
                '<span class="site-name-time">' + fmtSiteTime(r.at) + '</span>' +
                '<button type="button" class="button2 site-name-reset" data-host="' + host + '" ' +
                    (r.src === 'preset' ? 'disabled' : '') + '>还原</button>' +
                '</div>';
        }).join('') +
        (rows.length > shown.length
            ? '<div class="explain site-name-more">还有 ' + (rows.length - shown.length) + ' 个未显示，请在上方搜索缩小范围。</div>'
            : '');
    }

    function bindSiteNames() {
        var box = $('vrSiteNameList');
        if (!box) { return; }
        var msg = function (t, color) { text('vrSiteNameMsg', t, color); };
        var ST = root.VRSiteNameStore;
        if (!ST) {
            msg('站点名称模块未加载', '#c0392b');
            return;
        }

        /* 用 change 而不是 input：避免每敲一个字就写一次存储 */
        box.addEventListener('change', function (ev) {
            var el = ev.target;
            if (!el || !el.classList.contains('site-name-input')) { return; }
            var host = el.getAttribute('data-host');
            var name = String(el.value || '').trim();
            if (!name) {
                /* 清空 = 还原成「没有记录」，回退预置或域名 */
                ST.remove(host).then(function () {
                    msg('已还原 ' + host + '（将使用预置名或域名）', '#2e7d32');
                    renderSiteNames();
                });
                return;
            }
            if (!ST.normHost(host)) { return; }
            ST.rename(host, name).then(function () {
                msg('已保存：' + host + ' → ' + name, '#2e7d32');
                renderSiteNames();
            });
        });

        box.addEventListener('click', function (ev) {
            var btn = ev.target;
            if (!btn || !btn.classList || !btn.classList.contains('site-name-reset')) { return; }
            var host = btn.getAttribute('data-host');
            if (!host) { return; }
            ST.remove(host).then(function () {
                msg('已还原 ' + host, '#2e7d32');
                renderSiteNames();
            });
        });

        var search = $('vrSiteNameSearch');
        if (search) {
            search.addEventListener('input', function () {
                siteQuery = search.value || '';
                renderSiteNames();
            });
        }

        /* 「输入域名 → 获取站名并加入」：跨域抓取必须走后台（CORS）。 */
        var probeBtn = $('vrSiteNameProbe');
        var probeInput = $('vrSiteNameAdd');
        if (probeBtn && probeInput) {
            var doProbe = function () {
                var d = String(probeInput.value || '').trim();
                if (!d) { text('vrSiteNameProbeMsg', '请先输入域名', '#b26a00'); return; }
                probeBtn.disabled = true;
                text('vrSiteNameProbeMsg', '正在抓取页面…', '#666');
                try {
                    chrome.runtime.sendMessage({ Message: 'vrSiteName.probe', action: 'vrSiteNameProbe', domain: d }, function (res) {
                        probeBtn.disabled = false;
                        void (chrome.runtime.lastError);
                        if (!res) { text('vrSiteNameProbeMsg', '后台没有响应', '#c0392b'); return; }
                        if (res.name) {
                            text('vrSiteNameProbeMsg',
                                '已加入：' + res.host + ' → ' + res.name + (res.preset ? '（与预置表一致）' : ''),
                                '#2e7d32');
                        } else if (res.ok) {
                            text('vrSiteNameProbeMsg',
                                '已加入 ' + res.host + '，但页面没有声明站名，请在列表里手填',
                                '#b26a00');
                        } else {
                            text('vrSiteNameProbeMsg',
                                '加入失败：' + (res.message || '未知原因'), '#c0392b');
                        }
                        ST.ready().then(function () { renderSiteNames(); });
                        if (res.name) { probeInput.value = ''; }
                    });
                } catch (e) {
                    probeBtn.disabled = false;
                    text('vrSiteNameProbeMsg', '发送失败：' + e, '#c0392b');
                }
            };
            probeBtn.addEventListener('click', doProbe);
            probeInput.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter') { ev.preventDefault(); doProbe(); }
            });
        }

        var refresh = $('vrSiteNameRefresh');
        if (refresh) {
            refresh.addEventListener('click', function () {
                ST.ready().then(function () { renderSiteNames(); msg('已刷新', '#666'); });
            });
        }

        var exp = $('vrSiteNameExport');
        if (exp) {
            exp.addEventListener('click', function () {
                ST.exportAll().then(function (data) {
                    var keys = Object.keys(data || {});
                    if (!keys.length) { msg('还没有自动学习到任何站名，无需导出', '#b26a00'); return; }
                    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    var a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'vr-site-names-' + Date.now() + '.json';
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(function () {
                        URL.revokeObjectURL(a.href);
                        a.remove();
                    }, 1000);
                    msg('已导出 ' + keys.length + ' 条', '#2e7d32');
                });
            });
        }

        var imp = $('vrSiteNameImport');
        var impFile = $('vrSiteNameImportFile');
        if (imp && impFile) {
            imp.addEventListener('click', function () { impFile.click(); });
            impFile.addEventListener('change', function () {
                var f = impFile.files && impFile.files[0];
                if (!f) { return; }
                var reader = new FileReader();
                reader.onload = function () {
                    var obj;
                    try { obj = JSON.parse(String(reader.result || '')); }
                    catch (e) { msg('JSON 解析失败', '#c0392b'); impFile.value = ''; return; }
                    ST.importAll(obj).then(function (r) {
                        msg('导入完成：新增 ' + r.added + ' 条，更新 ' + r.updated + ' 条', '#2e7d32');
                        renderSiteNames();
                        impFile.value = '';
                    });
                };
                reader.onerror = function () { msg('文件读取失败', '#c0392b'); impFile.value = ''; };
                reader.readAsText(f);
            });
        }

        ST.ready().then(function () { renderSiteNames(); });
    }

    /* 与清单面板共用同一份 vrLibSettings；这里只做「把控件和存储对上」这件事。 */
    var IMG_FIELDS = [
        { id: 'ImgHover', key: 'imgHover', type: 'bool' },
        { id: 'ImgBatch', key: 'imgBatch', type: 'bool' },
        { id: 'ImgPanel', key: 'imgPanel', type: 'bool' },
        { id: 'ImgPreferOriginal', key: 'imgPreferOriginal', type: 'bool' },
        { id: 'ImgBgScan', key: 'imgBgScan', type: 'bool' },
        { id: 'ImgHoverMinSize', key: 'imgHoverMinSize', type: 'num' },
        { id: 'ImgHotkeys', key: 'imgHotkeys', type: 'bool' },
        { id: 'ImgMinSize', key: 'imgMinSize', type: 'num' },
        { id: 'ImgHoverDelay', key: 'imgHoverDelay', type: 'num' },
        { id: 'ImgConcurrency', key: 'imgConcurrency', type: 'num' },
        { id: 'ImgBatchLimit', key: 'imgBatchLimit', type: 'num' }
    ];

    function imgUtil() {
        return root.VRImageUtil || null;
    }

    /** 把存储里的图片设置刷到设置页控件上 */
    function renderImageSettings() {
        var U = imgUtil();
        if (!U) { return; }
        chrome.storage.local.get(KEY, function (obj) {
            var m = U.mergeSettings((obj && obj[KEY]) || {});
            IMG_FIELDS.forEach(function (f) {
                var el = $(f.id);
                if (!el) { return; }
                if (f.type === 'bool') {
                    el.checked = !!m[f.key];
                } else if (document.activeElement !== el) {
                    el.value = String(m[f.key]);
                }
            });
        });
    }

    /** 写一项图片设置（数值越界就夹住，非法就回滚到原值） */
    function saveImageSetting(field, raw) {
        var U = imgUtil();
        if (!U) { return; }
        var val;
        if (field.type === 'bool') {
            val = !!raw;
        } else {
            var v = U.validateSetting(field.key, raw);
            if (!v.ok) {
                // 非法：把控件回滚成当前值，并给个就地提示
                var el = $(field.id);
                if (el) {
                    var rg = U.RANGES[field.key] || [];
                    el.title = v.reason + (rg.length ? '（' + rg[0] + '–' + rg[1] + '）' : '');
                    el.classList.add('vr-bad');
                    setTimeout(function () { el.classList.remove('vr-bad'); }, 1600);
                    chrome.storage.local.get(KEY, function (o) {
                        var cur = U.mergeSettings((o && o[KEY]) || {});
                        el.value = String(cur[field.key]);
                    });
                }
                return;
            }
            val = v.value;
        }
        chrome.storage.local.get(KEY, function (o) {
            var merged = U.mergeSettings(Object.assign({}, (o && o[KEY]) || {}, {}));
            merged[field.key] = val;
            var put = {};
            put[KEY] = merged;
            chrome.storage.local.set(put, function () {
                // 与资源库设置模块的内存态保持同步
                state = Object.assign({}, state || {}, {});
            });
        });
    }

    function bindImageSettings() {
        IMG_FIELDS.forEach(function (f) {
            var el = $(f.id);
            if (!el) { return; }
            var ev = f.type === 'bool' ? 'change' : 'change';
            el.addEventListener(ev, function () {
                saveImageSetting(f, f.type === 'bool' ? el.checked : el.value);
            });
        });
    }

    root.VRImgSettings = {
        render: renderImageSettings,
        bind: bindImageSettings,
        fields: IMG_FIELDS
    };

    root.VRSettings = {
        DEFAULTS: DEFAULTS,
        LIB_FIELDS: LIB_FIELDS,
        get: function () { return state ? Object.assign({}, state) : null; },
        reload: function (cb) { load(cb || function () {}); },
        verify: verify,
        // 迁移后同步子目录名（migrate-ui 调用）
        setSubdir: function (name, cb) {
            var v = cleanSeg(name);
            if (!state) {
                load(function () { root.VRSettings.setSubdir(v, cb); });
                return;
            }
            save({ subdir: v }, function () {
                render();
                var sub = $('vrLibSubdir');
                if (sub) { sub.value = v; }
                if (cb) { cb(v); }
            });
        }
    };
})(typeof self !== 'undefined' ? self : this);
