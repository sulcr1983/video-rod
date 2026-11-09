/* ==========================================================
 * VRBatch —— 批量选择（S5b）
 *
 * 只负责选择状态、底部浮条与批量删除编排；卡片/行渲染仍归 ui.js。
 * 依赖：VRTrash（删除）、VRTrashUI（确认框/Toast，可选）；挂 self.VRBatch。
 * ========================================================== */
(function (root) {
    'use strict';

    var cb = {};
    var on = false;
    var selected = {};
    var order = [];
    var bound = false;

    function $(id) { return document.getElementById(id); }

    function nodes() {
        return document.querySelectorAll('#libGrid [data-rel], #libList [data-rel]');
    }

    function active() { return on; }

    function count() { return order.length; }

    function list() { return order.slice(); }

    function toast(msg) {
        if (root.VRTrashUI && root.VRTrashUI.toast) { root.VRTrashUI.toast(msg); }
    }

    function errText(err) {
        var code = (err && err.code) || '';
        if (code === 'LIB_E_NO_PERM') {
            return '需要目录写权限：去设置页点「授权目录并全量扫描」后再试';
        }
        return (err && err.message) || '操作失败';
    }

    /* ---------------- 计数与选中态 ---------------- */

    function paint() {
        var cnt = $('libBatchCount');
        if (cnt) { cnt.textContent = '已选 ' + order.length + ' 项'; }
        var trash = $('libBatchTrash');
        if (trash) { trash.disabled = order.length === 0; }
        var all = $('libBatchAll');
        if (all) { all.disabled = !(cb.getRendered && cb.getRendered().length); }
        [].forEach.call(nodes(), function (node) {
            node.classList.toggle('sel', !!selected[node.getAttribute('data-rel')]);
        });
    }

    function refresh() { paint(); }

    /* ---------------- 进入 / 退出 ---------------- */

    function enter() {
        if (on) { return; }
        if (root.VRViewer && root.VRViewer.isOpen()) { root.VRViewer.close(); }
        on = true;
        selected = {};
        order = [];
        document.body.classList.add('batch-mode');
        var bar = $('libBatchBar');
        if (bar) { bar.hidden = false; }
        var btn = $('libBatch');
        if (btn) {
            btn.classList.add('on');
            btn.setAttribute('aria-pressed', 'true');
            btn.title = '退出批量选择';
        }
        paint();
    }

    function exit() {
        if (!on) { return; }
        on = false;
        selected = {};
        order = [];
        document.body.classList.remove('batch-mode');
        var bar = $('libBatchBar');
        if (bar) { bar.hidden = true; }
        var btn = $('libBatch');
        if (btn) {
            btn.classList.remove('on');
            btn.setAttribute('aria-pressed', 'false');
            btn.title = '批量选择';
        }
        paint();
    }

    function toggle(rel) {
        if (!rel) { return; }
        if (selected[rel]) {
            delete selected[rel];
            order = order.filter(function (r) { return r !== rel; });
        } else {
            selected[rel] = 1;
            order.push(rel);
        }
        paint();
    }

    function clearSelection() {
        if (!order.length) { return; }
        selected = {};
        order = [];
        paint();
    }

    function selectAll() {
        var items = (cb.getRendered && cb.getRendered()) || [];
        items.forEach(function (e) {
            var rel = e && e.relPath;
            if (!rel || selected[rel]) { return; }
            selected[rel] = 1;
            order.push(rel);
        });
        paint();
    }

    /* ---------------- 批量删除 ---------------- */

    async function removeSelected() {
        if (!order.length) { return; }
        if (!root.VRTrash) { toast('删除模块未加载'); return; }

        var n = order.length;
        var ok = true;
        if (root.VRTrashUI && typeof root.VRTrashUI.confirm === 'function') {
            ok = await root.VRTrashUI.confirm({
                title: '批量移到回收站',
                text: '已选 ' + n + ' 项将移到 _回收站，之后可以从回收站恢复。',
                ok: '移到回收站'
            });
        } else {
            ok = window.confirm('已选 ' + n + ' 项将移到回收站，继续？');
        }
        if (!ok) { return; }

        var paths = order.slice();
        if (root.VRViewer && root.VRViewer.isOpen()) { root.VRViewer.close(); }

        try {
            var r = await root.VRTrash.remove(paths);
            var done = r.moved + r.cleaned;
            exit();
            if (done > 0) {
                toast('已移到回收站 ' + done + ' 项');
                if (cb.reload) { cb.reload(); }
                if (root.VRTrashUI) { root.VRTrashUI.refreshBadge(); }
            } else {
                toast(r.failed.length ? errText(r.failed[0]) : '没有可删除的文件');
            }
        } catch (err) {
            toast(errText(err));
        }
    }

    /* ---------------- 事件 ---------------- */

    function bind() {
        if (bound) { return; }
        bound = true;

        var btn = $('libBatch');
        if (btn) {
            btn.addEventListener('click', function () {
                if (on) { exit(); } else { enter(); }
            });
        }
        var all = $('libBatchAll');
        if (all) { all.addEventListener('click', selectAll); }
        var clear = $('libBatchClear');
        if (clear) { clear.addEventListener('click', clearSelection); }
        var trash = $('libBatchTrash');
        if (trash) { trash.addEventListener('click', removeSelected); }
        var quit = $('libBatchExit');
        if (quit) { quit.addEventListener('click', exit); }

        // 捕获阶段处理 Esc：确认框/菜单/重命名弹窗/查看器开着时让给它们
        document.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Escape' || !on) { return; }
            if ($('libConfirmMask') && !$('libConfirmMask').hidden) { return; }
            if ($('libCtxMenu') && !$('libCtxMenu').hidden) { return; }
            if ($('libRenameMask') && !$('libRenameMask').hidden) { return; }
            if (root.VRViewer && root.VRViewer.isOpen()) { return; }
            ev.preventDefault();
            exit();
        }, true);
    }

    function init(options) {
        cb = options || {};
        bind();
        paint();
    }

    root.VRBatch = {
        init: init,
        active: active,
        count: count,
        list: list,
        enter: enter,
        exit: exit,
        toggle: toggle,
        selectAll: selectAll,
        clearSelection: clearSelection,
        refresh: refresh,
        _remove: removeSelected
    };
})(typeof self !== 'undefined' ? self : this);
