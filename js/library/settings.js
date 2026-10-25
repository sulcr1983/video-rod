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

    function render() {
        if (!state) { return; }
        var sub = $('vrLibSubdir');
        if (sub && document.activeElement !== sub) { sub.value = state.subdir || 'video-rod'; }

        var mode = $('vrLibMode');
        if (mode) { mode.value = state.mode || 'system'; }

        var custom = $('vrLibCustomRoot');
        if (custom && document.activeElement !== custom) { custom.value = state.customRoot || ''; }
        if (custom) { custom.disabled = (state.mode || 'system') !== 'custom'; }

        var pick = $('vrLibPickDir');
        if (pick) { pick.disabled = (state.mode || 'system') !== 'custom'; }

        var rootEl = $('vrLibRoot');
        if (rootEl) {
            rootEl.textContent = state.detectedRoot
                ? (state.detectedRoot + '\\' + (state.subdir || 'video-rod'))
                : '未探测（点下方「校验落盘」）';
        }

        idbGet('root').then(function (h) {
            if (h && h.name) { text('vrLibCustomMsg', '已授权目录：' + h.name, '#2e7d32'); }
        }).catch(function () { /* 无句柄属正常 */ });

        renderLibSettings();
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
                save({ subdir: v }, function () {
                    if (sub) { sub.value = v; }
                    render();
                    text('vrLibSubdirMsg', '已保存；新下载生效（旧文件需在 S1b 迁移）', '#2e7d32');
                });
            });
        }

        var mode = $('vrLibMode');
        if (mode) {
            mode.addEventListener('change', function () {
                save({ mode: mode.value }, function (s) {
                    render();
                    if (s.mode === 'custom') {
                        text('vrLibCustomMsg', '自定义模式需在设置里填路径并授权；搬移在 S1b 实现', '#b26a00');
                    }
                });
            });
        }

        var custom = $('vrLibCustomRoot');
        if (custom) {
            custom.addEventListener('change', function () {
                save({ customRoot: String(custom.value || '').trim() });
            });
        }

        var pick = $('vrLibPickDir');
        if (pick) {
            pick.addEventListener('click', function () {
                if (typeof root.showDirectoryPicker !== 'function') {
                    text('vrLibCustomMsg', '此浏览器不支持目录选择（需 Chrome 86+）', '#c0392b');
                    return;
                }
                root.showDirectoryPicker({ mode: 'readwrite' }).then(function (h) {
                    return idbPut('root', h).then(function () {
                        text('vrLibCustomMsg', '已授权：' + h.name + '（路径请在上方输入框填完整）', '#2e7d32');
                    });
                }).catch(function (e) {
                    if (e && e.name === 'AbortError') { return; }   // 用户取消
                    text('vrLibCustomMsg', '授权失败：' + (e && e.message ? e.message : e), '#c0392b');
                });
            });
        }

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
            render();
            bind();
            bindIndex();
            bindLibSettings();
            refreshIndex();
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
