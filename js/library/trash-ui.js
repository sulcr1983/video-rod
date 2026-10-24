/* ==========================================================
 * VRTrashUI —— 右键菜单 / 回收站抽屉 / 确认框 / Toast（S5）
 *
 * 只做界面与调用编排，文件操作全部走 VRTrash。
 * 依赖：VRTrash、VRViewer（可选）；挂 self.VRTrashUI。
 * ========================================================== */
(function (root) {
    'use strict';

    var cb = {};
    var menuRel = '';
    var confirmResolve = null;
    var toastTimer = 0;

    function $(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function bytes(n) {
        n = Number(n) || 0;
        if (n < 1024) { return n + ' B'; }
        var u = ['KB', 'MB', 'GB', 'TB'];
        var i = -1;
        do { n = n / 1024; i++; } while (n >= 1024 && i < u.length - 1);
        return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
    }

    function batchTime(name) {
        var m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(String(name || ''));
        if (!m) { return name || '未知批次'; }
        return m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5];
    }

    function errText(err) {
        var code = (err && err.code) || '';
        if (code === 'LIB_E_NO_PERM') {
            return '需要目录写权限：去设置页点「授权目录并全量扫描」后再试';
        }
        if (code === 'LIB_E_EXISTS') { return '原位置已有同名文件，未覆盖'; }
        return (err && err.message) || '操作失败';
    }

    function toast(msg) {
        var el = $('libToast');
        if (!el) { return; }
        el.textContent = msg;
        el.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.hidden = true; }, 3000);
    }

    /* ---------------- 确认框 ---------------- */

    function confirmBox(opts) {
        return new Promise(function (resolve) {
            confirmResolve = resolve;
            $('libConfirmTitle').textContent = opts.title || '确认操作';
            $('libConfirmText').textContent = opts.text || '';
            $('libConfirmOk').textContent = opts.ok || '确定';
            $('libConfirmOk').classList.toggle('danger', opts.danger !== false);
            $('libConfirmMask').hidden = false;
            $('libConfirmOk').focus();
        });
    }

    function closeConfirm(value) {
        $('libConfirmMask').hidden = true;
        if (confirmResolve) {
            var fn = confirmResolve;
            confirmResolve = null;
            fn(!!value);
        }
    }

    /* ---------------- 右键菜单 ---------------- */

    function entryOf(rel) {
        return (cb.getEntry && cb.getEntry(rel)) || { relPath: rel };
    }

    function openMenu(rel, x, y, anchor) {
        var menu = $('libCtxMenu');
        if (!menu) { return; }
        menuRel = rel;
        var e = entryOf(rel);
        var starBtn = menu.querySelector('[data-act="star"]');
        if (starBtn) {
            starBtn.textContent = e.starred ? '取消星标' : '加星标';
        }
        menu.hidden = false;

        var w = menu.offsetWidth || 180;
        var h = menu.offsetHeight || 200;
        var left = x;
        var top = y;
        if (left + w > innerWidth - 8) { left = innerWidth - w - 8; }
        if (top + h > innerHeight - 8) { top = innerHeight - h - 8; }
        menu.style.left = Math.max(8, left) + 'px';
        menu.style.top = Math.max(8, top) + 'px';

        if (anchor) { anchor.setAttribute('aria-expanded', 'true'); }
    }

    function closeMenu() {
        var menu = $('libCtxMenu');
        if (menu) { menu.hidden = true; }
        menuRel = '';
    }

    async function menuAction(act) {
        var rel = menuRel;
        if (!rel) { return; }
        var e = entryOf(rel);
        closeMenu();

        if (act === 'preview') {
            if (cb.openViewer) { cb.openViewer(rel); }
            return;
        }
        if (act === 'open') {
            if (cb.openEntry) { cb.openEntry(rel); }
            return;
        }
        if (act === 'copy') {
            try {
                await navigator.clipboard.writeText(e.absPath || e.relPath || rel);
                toast('路径已复制');
            } catch (err) {
                toast('复制失败');
            }
            return;
        }
        if (act === 'star') {
            if (cb.toggleStar) { await cb.toggleStar(rel); }
            return;
        }
        if (act === 'trash') {
            await trashOne(rel);
        }
    }

    async function trashOne(rel) {
        var e = entryOf(rel);
        var name = (cb.fileName && cb.fileName(e)) || e.fileName || rel;
        var ok = await confirmBox({
            title: '移到回收站',
            text: '「' + name + '」将移到 _回收站，之后可以从回收站恢复。',
            ok: '移到回收站'
        });
        if (!ok) { return; }

        // 先关查看器，释放视频/图片对文件的占用，避免 Windows 上移动失败
        if (root.VRViewer && root.VRViewer.isOpen()) { root.VRViewer.close(); }

        try {
            var r = await root.VRTrash.remove([rel]);
            var done = r.moved + r.cleaned;
            if (done > 0) {
                toast('已移到回收站');
                if (cb.reload) { cb.reload(); }
                refreshBadge();
            } else {
                toast(r.failed.length ? errText(r.failed[0]) : '没有可删除的文件');
            }
        } catch (err) {
            toast(errText(err));
        }
    }

    /* ---------------- 回收站抽屉 ---------------- */

    async function refreshBadge() {
        var el = $('libTrashCount');
        if (!el || !root.VRTrash) { return; }
        try {
            var s = await root.VRTrash.status();
            el.textContent = s.count;
            el.hidden = !s.count;
        } catch (e) { /* 忽略 */ }
    }

    async function openDrawer() {
        $('libTrashMask').hidden = false;
        $('libTrashDrawer').hidden = false;
        document.body.classList.add('trash-open');
        await renderDrawer();
    }

    function closeDrawer() {
        $('libTrashMask').hidden = true;
        $('libTrashDrawer').hidden = true;
        document.body.classList.remove('trash-open');
    }

    async function renderDrawer() {
        var box = $('libTrashList');
        var meta = $('libTrashMeta');
        if (!box) { return; }

        var batches = [];
        try {
            batches = await root.VRTrash.list();
        } catch (e) {
            box.innerHTML = '<div class="trash-empty">读取回收站失败：' + esc(errText(e)) + '</div>';
            return;
        }

        var count = 0;
        var size = 0;
        batches.forEach(function (b) {
            count += b.items.length;
            size += b.size;
        });
        if (meta) { meta.textContent = count + ' 项 · ' + bytes(size) + ' · ' + batches.length + ' 个批次'; }

        if (!batches.length) {
            box.innerHTML = '<div class="trash-empty">回收站是空的</div>';
            return;
        }

        box.innerHTML = batches.map(function (b) {
            var items = b.items.map(function (it) {
                var name = it.fileName || String(it.relPath || '').split('/').pop();
                return '<li class="trash-item">' +
                    '<span class="tn" title="' + esc(it.relPath) + '">' + esc(name) + '</span>' +
                    '<span class="ts">' + bytes(it.size) + '</span>' +
                    '<button type="button" class="tbtn" data-restore-item="' + esc(it.relPath) + '" ' +
                    'data-batch="' + esc(b.batch) + '">恢复</button>' +
                    '<button type="button" class="tbtn danger" data-purge-item="' + esc(it.relPath) + '" ' +
                    'data-batch="' + esc(b.batch) + '">彻底删除</button>' +
                    '</li>';
            }).join('');

            return '<section class="trash-batch">' +
                '<header><div class="tb-meta"><b>' + esc(batchTime(b.batch)) + '</b>' +
                '<span>' + b.items.length + ' 项 · ' + bytes(b.size) + '</span></div>' +
                '<div class="tb-acts">' +
                '<button type="button" class="tbtn" data-restore-batch="' + esc(b.batch) + '">全部恢复</button>' +
                '<button type="button" class="tbtn danger" data-purge-batch="' + esc(b.batch) + '">删除本批</button>' +
                '</div></header>' +
                '<ul>' + items + '</ul>' +
                '</section>';
        }).join('');
    }

    async function afterTrashChange() {
        await renderDrawer();
        await refreshBadge();
        if (cb.reload) { cb.reload(); }
    }

    async function restoreItem(batch, relPath) {
        try {
            var r = await root.VRTrash.restore(batch, relPath);
            if (r.restored) {
                toast('已恢复');
                await afterTrashChange();
            } else {
                toast(r.failed.length ? errText(r.failed[0]) : '恢复失败');
            }
        } catch (err) {
            toast(errText(err));
        }
    }

    async function restoreBatch(batch) {
        try {
            var r = await root.VRTrash.restore(batch);
            if (r.restored) {
                toast('已恢复 ' + r.restored + ' 项');
                await afterTrashChange();
            } else {
                toast(r.failed.length ? errText(r.failed[0]) : '恢复失败');
            }
        } catch (err) {
            toast(errText(err));
        }
    }

    async function purgeItem(batch, relPath) {
        var ok = await confirmBox({
            title: '彻底删除',
            text: '「' + String(relPath).split('/').pop() + '」将被永久删除，不可恢复。',
            ok: '永久删除'
        });
        if (!ok) { return; }
        try {
            await root.VRTrash.purge(batch, relPath);
            toast('已永久删除');
            await afterTrashChange();
        } catch (err) {
            toast(errText(err));
        }
    }

    async function purgeBatch(batch) {
        var ok = await confirmBox({
            title: '删除本批',
            text: '这一批文件将被永久删除，不可恢复。',
            ok: '永久删除'
        });
        if (!ok) { return; }
        try {
            await root.VRTrash.purge(batch);
            toast('已删除本批');
            await afterTrashChange();
        } catch (err) {
            toast(errText(err));
        }
    }

    async function emptyAll() {
        var ok = await confirmBox({
            title: '清空回收站',
            text: '回收站里的全部文件将被永久删除，不可恢复。',
            ok: '清空'
        });
        if (!ok) { return; }
        try {
            var r = await root.VRTrash.empty();
            toast('已清空 ' + r.purged + ' 个批次');
            await afterTrashChange();
        } catch (err) {
            toast(errText(err));
        }
    }

    /* ---------------- 事件绑定 ---------------- */

    function bind() {
        var menu = $('libCtxMenu');
        if (menu) {
            menu.addEventListener('click', function (ev) {
                var b = ev.target.closest('[data-act]');
                if (b) { menuAction(b.dataset.act); }
            });
        }

        document.addEventListener('contextmenu', function (ev) {
            var card = ev.target.closest('#libGrid [data-rel], #libList [data-rel]');
            if (!card) { return; }
            ev.preventDefault();
            openMenu(card.getAttribute('data-rel'), ev.clientX, ev.clientY);
        });

        document.addEventListener('click', function (ev) {
            if (ev.target.closest('#libCtxMenu')) { return; }
            var more = ev.target.closest('[data-more]');
            if (more) {
                ev.preventDefault();
                ev.stopPropagation();
                var r = more.getBoundingClientRect();
                openMenu(more.getAttribute('data-more'), r.left, r.bottom + 4, more);
                return;
            }
            closeMenu();
        });

        document.addEventListener('scroll', closeMenu, true);

        document.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Escape') { return; }
            if (!$('libConfirmMask').hidden) { closeConfirm(false); return; }
            if (!$('libCtxMenu').hidden) { closeMenu(); return; }
            if (!$('libTrashDrawer').hidden) { closeDrawer(); }
        });

        $('libConfirmOk').addEventListener('click', function () { closeConfirm(true); });
        $('libConfirmCancel').addEventListener('click', function () { closeConfirm(false); });
        $('libConfirmMask').addEventListener('click', function (ev) {
            if (ev.target === $('libConfirmMask')) { closeConfirm(false); }
        });

        var openBtn = $('libTrashOpen');
        if (openBtn) { openBtn.addEventListener('click', openDrawer); }
        $('libTrashClose').addEventListener('click', closeDrawer);
        $('libTrashMask').addEventListener('click', closeDrawer);
        $('libTrashEmpty').addEventListener('click', emptyAll);

        $('libTrashList').addEventListener('click', function (ev) {
            var rest = ev.target.closest('[data-restore-item]');
            if (rest) { restoreItem(rest.dataset.batch, rest.dataset.restoreItem); return; }
            var restB = ev.target.closest('[data-restore-batch]');
            if (restB) { restoreBatch(restB.dataset.restoreBatch); return; }
            var purge = ev.target.closest('[data-purge-item]');
            if (purge) { purgeItem(purge.dataset.batch, purge.dataset.purgeItem); return; }
            var purgeB = ev.target.closest('[data-purge-batch]');
            if (purgeB) { purgeBatch(purgeB.dataset.purgeBatch); }
        });

        var vTrash = $('libViewerTrash');
        if (vTrash) {
            vTrash.addEventListener('click', function () {
                var cur = root.VRViewer && root.VRViewer.current ? root.VRViewer.current() : null;
                if (cur) { trashOne(cur.relPath); }
            });
        }
    }

    function init(options) {
        cb = options || {};
        bind();
        refreshBadge();
    }

    root.VRTrashUI = {
        init: init,
        refreshBadge: refreshBadge,
        openDrawer: openDrawer,
        closeDrawer: closeDrawer,
        toast: toast,
        confirm: confirmBox,
        _trashOne: trashOne
    };
})(typeof self !== 'undefined' ? self : this);
