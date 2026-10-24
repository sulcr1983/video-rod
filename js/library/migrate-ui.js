/* ==========================================================
 * VRMigrateUI —— 设置页「迁移」面板（S1b）
 *
 * 只在 options.html 里跑（FSA 目录选择器与句柄读写都需要页面上下文）。
 * 引擎在 js/library/migrate.js，本文件只管交互：
 *   选目录 → 预演 → 执行（进度）→ 回滚
 * 句柄存 IDB `vr-lib-handle` 的 kv（键 migrate:parent / migrate:src / migrate:dst）。
 * ========================================================== */
(function (root) {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };

    var st = {
        parent: null,
        src: null,
        dst: null,
        plan: null,
        log: null,
        running: false
    };

    function text(id, msg, color) {
        var el = $(id);
        if (!el) { return; }
        el.textContent = msg || '';
        el.style.color = color || '';
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /* ---------------- IDB（与 settings.js 同一个库） ---------------- */

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

    function restoreHandles() {
        return Promise.all([idbGet('migrate:parent'), idbGet('migrate:src'), idbGet('migrate:dst')])
            .then(function (r) {
                st.parent = r[0] || st.parent;
                st.src = r[1] || st.src;
                st.dst = r[2] || st.dst;
                renderPicked();
            }).catch(function () { /* 无缓存属正常 */ });
    }

    function renderPicked() {
        var parts = [];
        if (st.parent) { parts.push('父目录：' + st.parent.name); }
        if (st.src) { parts.push('源目录：' + st.src.name); }
        if (st.dst) { parts.push('目标目录：' + st.dst.name); }
        text('vrLibMigDirMsg', parts.length ? parts.join(' ｜ ') + '（已授权）' : '', parts.length ? '#2e7d32' : '');
    }

    /* ---------------- 显示控制 ---------------- */

    function currentKind() {
        var el = $('vrLibMigKind');
        return el ? el.value : 'rename-subdir';
    }

    function renderKind() {
        var kind = currentKind();
        var blocks = document.querySelectorAll('#vrLibMigPanel [data-kind]');
        for (var i = 0; i < blocks.length; i++) {
            blocks[i].style.display = (blocks[i].getAttribute('data-kind') === kind) ? '' : 'none';
        }
        if (kind === 'rename-subdir') {
            var s = root.VRSettings && root.VRSettings.get ? root.VRSettings.get() : null;
            var old = $('vrLibMigOld');
            if (old && !old.value) { old.value = (s && s.subdir) || 'video-rod'; }
        }
        renderPlan(st.plan && st.plan.kind === kind ? st.plan : null);
    }

    function togglePanel() {
        var p = $('vrLibMigPanel');
        if (!p) { return; }
        p.hidden = !p.hidden;
        if (!p.hidden) {
            renderKind();
            refreshRollback();
        }
    }

    /* ---------------- 预演 ---------------- */

    function renderPlan(plan) {
        st.plan = plan;
        var box = $('vrLibMigPreview');
        var runBtn = $('vrLibMigRun');
        if (!box) { return; }
        if (!plan) {
            box.innerHTML = '';
            if (runBtn) { runBtn.disabled = true; }
            return;
        }
        var c = plan.counts || {};
        var head = '<div style="margin-bottom:6px"><b>可迁移 ' + (c.move || 0) + '</b> ｜ 跳过 ' +
            (c.skip || 0) + ' ｜ 冲突 ' + (c.conflict || 0) + ' ｜ 阻断 ' + (c.blocked || 0) +
            ' ｜ 总计 ' + root.VRMigrate.formatBytes(plan.totalBytes || 0) + '</div>';
        if (plan.reason) {
            head += '<div style="color:#c0392b">' + esc(plan.reason) + '</div>';
        }
        var moves = (plan.items || []).filter(function (it) { return it.action === 'move'; });
        var rows = moves.slice(0, 50).map(function (it) {
            return '<tr><td style="padding:1px 6px;word-break:break-all">' + esc(it.from) +
                '</td><td style="padding:1px 6px">→</td><td style="padding:1px 6px;word-break:break-all">' +
                esc(it.to) + '</td><td style="padding:1px 6px;text-align:right">' +
                root.VRMigrate.formatBytes(it.size) + '</td></tr>';
        }).join('');
        var tail = moves.length > 50 ? '<div>… 另有 ' + (moves.length - 50) + ' 条</div>' : '';
        box.innerHTML = head + (rows
            ? '<table style="font-size:10.5px;border-collapse:collapse">' + rows + '</table>' + tail
            : '<div>没有可迁移的文件</div>');
        if (runBtn) { runBtn.disabled = !(c.move > 0) || st.running; }
    }

    async function doPlan() {
        var kind = currentKind();
        text('vrLibMigState', '正在扫描…', '#666');
        try {
            var plan;
            if (kind === 'rename-subdir') {
                if (!st.parent) { throw new Error('请先选择父目录并授权'); }
                var oldName = ($('vrLibMigOld') && $('vrLibMigOld').value.trim()) || 'video-rod';
                var newName = ($('vrLibMigNew') && $('vrLibMigNew').value.trim()) || '';
                if (!newName) { throw new Error('请填写新子目录名'); }
                plan = await root.VRMigrate.planRenameSubdir(st.parent, oldName, newName);
            } else if (kind === 'rebase') {
                if (!st.src || !st.dst) { throw new Error('请先选择源目录和目标目录'); }
                var s = root.VRSettings && root.VRSettings.get ? root.VRSettings.get() : {};
                plan = await root.VRMigrate.planRebase(st.src, st.dst,
                    { targetMode: (s.mode === 'custom') ? 'custom' : 'system' });
            } else {
                if (!st.src) { throw new Error('请先选择要整理的目录'); }
                var hist = await new Promise(function (resolve) {
                    chrome.downloads.search({ limit: 5000, orderBy: ['-startTime'] }, function (list) {
                        resolve(list || []);
                    });
                });
                plan = await root.VRMigrate.planRestructure(st.src, hist);
            }
            renderPlan(plan);
            text('vrLibMigState', '预演完成，未改动任何文件', '#2e7d32');
        } catch (e) {
            text('vrLibMigState', '预演失败：' + (e && e.message ? e.message : e), '#c0392b');
        }
    }

    /* ---------------- 执行 ---------------- */

    async function doRun() {
        if (st.running || !st.plan) { return; }
        var plan = st.plan;
        var n = (plan.counts && plan.counts.move) || 0;
        if (!n) { return; }
        var ok = confirm('将迁移 ' + n + ' 个文件（' + root.VRMigrate.formatBytes(plan.totalBytes) +
            '）。\n\n流程：复制 → 校验 → 校验通过后才删除源文件。\n失败会立即停止且不删任何源文件。\n\n继续？');
        if (!ok) { return; }

        st.running = true;
        var bar = $('vrLibMigBar');
        var runBtn = $('vrLibMigRun');
        if (runBtn) { runBtn.disabled = true; }
        text('vrLibMigState', '迁移中…', '#b26a00');

        try {
            var log = await root.VRMigrate.run(plan, function (p) {
                var pct = p.totalBytes ? Math.floor(p.doneBytes / p.totalBytes * 100) : 0;
                if (bar) { bar.max = 100; bar.value = Math.min(100, pct); }
                text('vrLibMigProgTxt', p.index + '/' + p.total + ' · ' +
                    root.VRMigrate.formatBytes(p.doneBytes) + ' / ' +
                    root.VRMigrate.formatBytes(p.totalBytes) + ' · ' + p.item.to.split('/').pop(), '#666');
            });
            st.log = log;
            if (log.aborted) {
                text('vrLibMigState', '已中止：完成 ' + log.done.length + ' 条，失败 ' +
                    (log.failed[0] ? log.failed[0].code : '') + '；源文件均未删除，可回滚', '#c0392b');
            } else if (log.failed.length) {
                text('vrLibMigState', '完成 ' + log.done.length + ' 条，失败 ' + log.failed.length + ' 条', '#b26a00');
            } else {
                text('vrLibMigState', '完成：迁移 ' + log.done.length + ' 条，校验通过', '#2e7d32');
            }
            if (bar) { bar.value = 100; }

            // 改子目录名成功后，把设置里的子目录名同步成新名字（新下载才落到新目录）
            if (plan.kind === 'rename-subdir' && !log.aborted && log.done.length &&
                root.VRSettings && root.VRSettings.setSubdir) {
                root.VRSettings.setSubdir(plan.newName, function () {
                    var el = $('vrLibMigOld');
                    if (el) { el.value = plan.newName; }
                });
            }
            refreshRollback();
        } catch (e) {
            text('vrLibMigState', '执行异常：' + (e && e.message ? e.message : e), '#c0392b');
        } finally {
            st.running = false;
            if (runBtn) { runBtn.disabled = !((st.plan && st.plan.counts && st.plan.counts.move) > 0); }
        }
    }

    /* ---------------- 回滚 ---------------- */

    function refreshRollback() {
        var btn = $('vrLibMigRollback');
        root.VRMigrate.lastLog().then(function (log) {
            st.log = log;
            var can = !!(log && log.done && log.done.length && !log.rolledBack);
            if (btn) { btn.disabled = !can; }
            if (can) {
                text('vrLibMigRollbackMsg', '可回滚：' + log.done.length + ' 条（' +
                    new Date(log.at).toLocaleString() + '）', '#666');
            } else {
                text('vrLibMigRollbackMsg', '', '');
            }
        }).catch(function () {});
    }

    async function doRollback() {
        if (st.running) { return; }
        var log = st.log;
        if (!log) { return; }
        if (!confirm('回滚会把已迁移的 ' + log.done.length + ' 个文件复制回原位置并删除新位置的文件。\n继续？')) {
            return;
        }
        st.running = true;
        text('vrLibMigState', '回滚中…', '#b26a00');
        try {
            var r = await root.VRMigrate.rollback(log.id);
            text('vrLibMigState', r.rolledBack
                ? ('回滚完成：' + r.restored + ' 条')
                : ('回滚中止：已完成 ' + r.restored + ' 条，' + (r.failed[0] ? r.failed[0].code : '')),
                r.rolledBack ? '#2e7d32' : '#c0392b');
        } catch (e) {
            text('vrLibMigState', '回滚失败：' + (e && e.message ? e.message : e), '#c0392b');
        } finally {
            st.running = false;
            refreshRollback();
        }
    }

    /* ---------------- 选目录 ---------------- */

    function pick(which) {
        if (typeof root.showDirectoryPicker !== 'function') {
            text('vrLibMigDirMsg', '此浏览器不支持目录选择（需 Chrome 86+）', '#c0392b');
            return;
        }
        root.showDirectoryPicker({ mode: 'readwrite' }).then(function (h) {
            st[which] = h;
            renderPicked();
            return idbPut('migrate:' + which, h);
        }).catch(function (e) {
            if (e && e.name === 'AbortError') { return; }   // 用户取消
            text('vrLibMigDirMsg', '授权失败：' + (e && e.message ? e.message : e), '#c0392b');
        });
    }

    /* ---------------- 绑定 ---------------- */

    function bind() {
        var openBtn = $('vrLibMigrate');
        if (!openBtn) { return; }
        openBtn.addEventListener('click', togglePanel);
        var kindSel = $('vrLibMigKind');
        if (kindSel) { kindSel.addEventListener('change', renderKind); }

        var p1 = $('vrLibMigPickParent');
        if (p1) { p1.addEventListener('click', function () { pick('parent'); }); }
        var p2 = $('vrLibMigPickSrc');
        if (p2) { p2.addEventListener('click', function () { pick('src'); }); }
        var p3 = $('vrLibMigPickDst');
        if (p3) { p3.addEventListener('click', function () { pick('dst'); }); }
        var p4 = $('vrLibMigPickSrc2');
        if (p4) { p4.addEventListener('click', function () { pick('src'); }); }

        var planBtn = $('vrLibMigPlan');
        if (planBtn) { planBtn.addEventListener('click', doPlan); }
        var runBtn = $('vrLibMigRun');
        if (runBtn) { runBtn.addEventListener('click', doRun); }
        var rollBtn = $('vrLibMigRollback');
        if (rollBtn) { rollBtn.addEventListener('click', doRollback); }

        restoreHandles();
    }

    function init() {
        if (!$('anchorLibrary')) { return; }        // 不是 options 页
        if (!root.VRMigrate) { return; }           // 引擎没加载
        bind();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof self !== 'undefined' ? self : this);
