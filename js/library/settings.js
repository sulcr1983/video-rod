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
        lastVerifyAt: 0
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

    function save(patch, cb) {
        state = Object.assign({}, state, patch);
        var o = {};
        o[KEY] = state;
        chrome.storage.local.set(o, function () {
            if (cb) { cb(state); }
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
        chrome.runtime.sendMessage({ Message: 'vrLib.list' }, function (r) {
            if (chrome.runtime.lastError || !r || !r.ok) { return; }
            var el = $('vrLibRecent');
            if (!el) { return; }
            var list = (r.list || []).slice().sort(function (a, b) {
                return (b.mtime || 0) - (a.mtime || 0);
            }).slice(0, 5);
            el.innerHTML = list.length
                ? list.map(function (it) {
                    return '<div style="font-family:Consolas,monospace;font-size:10.5px;line-height:1.6">' +
                        escHtml(it.relPath) + '</div>';
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
            refreshIndex();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    root.VRSettings = {
        DEFAULTS: DEFAULTS,
        get: function () { return state ? Object.assign({}, state) : null; },
        reload: function (cb) { load(cb || function () {}); },
        verify: verify
    };
})(typeof self !== 'undefined' ? self : this);
