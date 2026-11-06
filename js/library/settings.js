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

    function $(id) { return document.getElementById(id); }

    function text(id, msg, color) {
        var el = $(id);
        if (!el) { return; }
        el.textContent = msg || '';
        el.style.color = color || '';
    }

    /* ---------------- 存储 ---------------- */

    function load(cb) {
        chrome.storage.local.get(KEY, function (obj) {
            state = Object.assign({}, DEFAULTS, obj && obj[KEY]);
            cb(state);
        });
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
