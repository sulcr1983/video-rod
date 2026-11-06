/* ==========================================================
 * VRMovePicker —— 应用内文件夹选择器（移动素材用）
 *
 * 为什么不用 window.prompt / showDirectoryPicker：
 *   - 让用户手写文件夹名既反直觉又容易建错层级；
 *   - 系统目录选择器可以选到素材库外面，移动后索引与物理位置脱节。
 * 这里只遍历「资源库根句柄」下的目录，选中哪层就移动到哪层。
 *
 * 依赖：VRTrash.moveFile、VRDB、app 提供的 hooks
 * 零依赖、ES5+async，挂 self.VRMovePicker。
 * ========================================================== */
(function (root) {
    'use strict';

    var SKIP = { _verify: 1, _回收站: 1, _library: 1, _migration: 1, _selftest: 1 };
    var M = { handle: null, prefix: '', absRoot: '', stack: [], items: [], busy: false };
    var H = {};                      // 本次打开传入的 hooks

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }
    function toast(msg) {
        try { if (typeof H.toast === 'function') { H.toast(msg); } } catch (e) { /* 忽略 */ }
    }
    function show(on) {
        var m = $('moveMask');
        if (m) { m.classList.toggle('show', !!on); }
    }
    function current() {
        return M.stack.length ? M.stack[M.stack.length - 1].handle : M.handle;
    }
    function targetRel() {
        return M.stack.map(function (x) { return x.name; }).join('/');
    }
    /** 面包屑：每一段都能点，直接跳回那一层。
     *  原来只有一句纯文本 + 「上一级」，几十个目录时要一层层退回去。 */
    function paintPath() {
        var box = $('moveCrumbs');
        if (!box) { return; }
        var segs = [];
        segs.push('<button type="button" class="mv-crumb' + (M.stack.length ? '' : ' on') + '" data-mv-crumb="-1">资源库根目录</button>');
        M.stack.forEach(function (x, i) {
            segs.push('<span class="mv-sep">/</span>');
            segs.push('<button type="button" class="mv-crumb' + (i === M.stack.length - 1 ? ' on' : '') +
                '" data-mv-crumb="' + i + '">' + esc(x.name) + '</button>');
        });
        box.innerHTML = segs.join('');
        box.title = targetRel() || '资源库根目录';
    }

    async function listDirs(handle) {
        var dirs = [];
        try {
            for await (var entry of handle.entries()) {
                var name = entry[0], h = entry[1];
                if (h.kind !== 'directory') { continue; }
                if (!name || name.charAt(0) === '.' || SKIP[name]) { continue; }
                dirs.push({ name: name, handle: h });
            }
        } catch (e) { /* 某层读不了就跳过，不影响其它结果 */ }
        dirs.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); });
        return dirs;
    }

    /** 递归找匹配的文件夹（限深 3 层）：库里目录常常是「平台/作者/类型」三级，
     *  只搜当前层的话，搜「视频」根本找不到深层目录。 */
    async function searchDeep(handle, q, depth, trail) {
        var out = [];
        var dirs = await listDirs(handle);
        for (var i = 0; i < dirs.length; i++) {
            var path = trail.concat([dirs[i].name]);
            if (dirs[i].name.toLowerCase().indexOf(q) >= 0) {
                out.push({ path: path, handle: dirs[i].handle });
            }
            if (depth > 1) {
                var sub = await searchDeep(dirs[i].handle, q, depth - 1, path);
                for (var j = 0; j < sub.length; j++) { out.push(sub[j]); }
            }
        }
        return out;
    }

    async function render() {
        var list = $('moveList');
        if (!list) { return; }
        var cur = current();
        if (!cur) { list.innerHTML = '<div class="mv-empty">目录未授权</div>'; return; }
        list.innerHTML = '<div class="mv-empty">读取中…</div>';
        var rows = [];
        var dirs = [];
        var q = String(M.filter || '').trim().toLowerCase();

        if (q) {
            /* 搜索态：递归匹配，直接列出完整路径，点一下就能进到那一层 */
            var hits = await searchDeep(cur, q, 3, M.stack.map(function (x) { return x.name; }));
            dirs = hits.map(function (h) {
                return { name: h.path.join('/'), handle: h.handle, trail: h.path };
            });
            if (!dirs.length) {
                list.innerHTML = '<div class="mv-empty">没有匹配「' + esc(q) + '」的文件夹</div>';
                list._dirs = [];
                paintPath();
                return;
            }
            dirs.forEach(function (d) {
                rows.push('<button class="mv-row" data-mv-dir="' + esc(d.name) + '">' +
                    '<svg class="i"><use href="#i-folder"/></svg>' +
                    '<span class="mv-name">' + esc(d.name) + '</span>' +
                    '<span class="mv-sub">跳转</span></button>');
            });
        } else {
            if (M.stack.length) {
                rows.push('<button class="mv-row" data-mv-up="1"><svg class="i"><use href="#i-chevron-up"/></svg><span class="mv-name">上一级</span></button>');
            }
            dirs = await listDirs(cur);
            dirs.forEach(function (d) {
                rows.push('<button class="mv-row" data-mv-dir="' + esc(d.name) + '">' +
                    '<svg class="i"><use href="#i-folder"/></svg>' +
                    '<span class="mv-name">' + esc(d.name) + '</span>' +
                    '<span class="mv-sub">进入</span></button>');
            });
            if (!dirs.length && !M.stack.length) {
                rows.push('<div class="mv-empty">这个目录下还没有文件夹，可以点左下角新建</div>');
            }
        }
        list.innerHTML = rows.join('');
        list._dirs = dirs;
        paintPath();
    }

    async function createFromInput() {
        if (M.busy) { return; }
        var inp = $('moveNewName');
        var name = String((inp && inp.value) || '')
            .replace(/[\\/:*?"<>|]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').trim();
        if (!name) { toast('文件夹名不能为空'); return; }
        var cur = current();
        if (!cur) { return; }
        try {
            var h = await cur.getDirectoryHandle(name, { create: true });
            M.stack.push({ name: name, handle: h });
            if (inp) { inp.value = ''; }
            var row = $('moveNewRow'); if (row) { row.classList.add('hidden'); }
            await render();
            toast('已创建并进入「' + name + '」');
        } catch (e) {
            toast('新建文件夹失败：' + ((e && e.message) || e));
        }
    }

    async function doMove() {
        if (M.busy || !M.items.length) { return; }
        M.busy = true;
        var pfx = M.prefix;
        var target = targetRel();
        var absRoot = M.absRoot;
        var stripPfx = function (rel) {
            var p = pfx ? (pfx + '/') : '';
            return (p && rel.indexOf(p) === 0) ? rel.slice(p.length) : rel;
        };
        var getEntry = typeof H.getEntry === 'function' ? H.getEntry : function () { return null; };
        var okN = 0, failN = 0, skipN = 0;
        var failures = [];
        var total = M.items.length;
        var progress = function (n) {
            /* 大目录移动可能要几十秒；没有进度时用户会以为卡死并重复点。 */
            if (n === 1 || n % 5 === 0 || n === total) {
                toast('正在移动 ' + n + '/' + total + '…');
            }
        };
        toast('正在移动 0/' + total + '…');

        for (var i = 0; i < M.items.length; i++) {
            var f = M.items[i];
            var name = String(f.relPath).split('/').pop();
            var toFs = target ? (target + '/' + name) : name;
            var newRel = (pfx ? pfx + '/' : '') + toFs;
            if (newRel === f.relPath) { skipN++; progress(i + 1); continue; }
            if (getEntry(newRel)) { failN++; failures.push(name + '（目标已存在）'); progress(i + 1); continue; }
            var fromFs = stripPfx(f.relPath);
            if (fromFs === toFs) { skipN++; progress(i + 1); continue; }

            var moved = false, dbWritten = false;
            try {
                await root.VRTrash.moveFile(M.handle, fromFs, toFs, { noOverwrite: true });
                moved = true;
                var old = getEntry(f.relPath) || {};
                if (root.VRDB && root.VRDB.putFiles) {
                    var next = Object.assign({}, old, {
                        relPath: newRel,
                        absPath: absRoot ? (absRoot + '\\' + toFs.replace(/\//g, '\\')) : (old.absPath || ''),
                        thumbKey: null,
                        state: 'ok'
                    });
                    await root.VRDB.putFiles([next]);
                    dbWritten = true;
                    await root.VRDB.deleteFiles([f.relPath]);
                }
                okN++;
            } catch (e) {
                /* 物理已移动但 DB 没写成功：尽量移回去，别让索引和磁盘脱节 */
                if (moved && !dbWritten) {
                    try { await root.VRTrash.moveFile(M.handle, toFs, fromFs, { noOverwrite: true }); }
                    catch (e2) { /* 回滚失败，保留失败计数 */ }
                }
                failN++;
                failures.push(name + '（' + (e && e.message ? String(e.message).slice(0, 20) : '失败') + '）');
            }
            progress(i + 1);
        }

        M.busy = false;
        show(false);
        var msg = '移动完成：' + okN + ' 项' +
            (skipN ? ('，跳过 ' + skipN) : '') +
            (failN ? ('，失败 ' + failN) : '');
        if (failures.length) { msg += '（' + failures.slice(0, 2).join('、') + (failures.length > 2 ? ' 等' : '') + '）'; }
        toast(msg);
        try { if (typeof H.onDone === 'function') { await H.onDone(); } }
        catch (e) {
            /* 移动已经落盘，但调用方的收尾（重载列表/清空选择）失败：
             * 界面会停在旧状态，用户以为没移动成功。至少要留痕。 */
            console.warn('[move] 收尾回调失败：', e && e.message);
        }
    }

    /**
     * @param {Array} items 卡片模型（至少含 relPath）
     * @param {object} hooks { getEntry(relPath), onDone(), onNeedAuth(), toast(msg) }
     */
    async function open(items, hooks) {
        items = (items || []).filter(Boolean);
        if (!items.length) { return; }
        H = hooks || {};
        var rr = null;
        try {
            if (root.VRTrash && root.VRTrash.resolveRoot) { rr = await root.VRTrash.resolveRoot(); }
        } catch (e) { rr = null; }
        if (!rr || !rr.handle) {
            if (typeof H.onNeedAuth === 'function') { H.onNeedAuth(); }
            else { toast('移动素材要先授权素材目录'); }
            return;
        }
        if (rr.handle.queryPermission) {
            try {
                if ((await rr.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                    toast('目录写权限已失效：先在顶部横幅点「恢复写入」');
                    return;
                }
            } catch (e) { /* 真正写盘时还会再校验 */ }
        }

        M.handle = rr.handle;
        M.prefix = String(rr.prefix || '').replace(/^\/+|\/+$/g, '');
        M.absRoot = String(rr.absRoot || '').replace(/[\\/]+$/, '');
        M.stack = [];
        M.items = items;
        M.busy = false;

        var row = $('moveNewRow'); if (row) { row.classList.add('hidden'); }
        var inp = $('moveNewName'); if (inp) { inp.value = ''; }
        M.filter = '';
        var sBox = $('moveSearch'); if (sBox) { sBox.value = ''; }
        show(true);
        var hint = $('moveHint');
        if (hint) { hint.textContent = '将移动 ' + items.length + ' 项；选好目标文件夹后点「移动到这里」。'; }
        await render();
    }

    function init() {
        var cancel = $('moveCancel');
        if (cancel) { cancel.addEventListener('click', function () { show(false); }); }
        var ok = $('moveOk');
        if (ok) { ok.addEventListener('click', doMove); }
        var newBtn = $('moveNewBtn');
        if (newBtn) {
            newBtn.addEventListener('click', function () {
                var row = $('moveNewRow');
                if (!row) { return; }
                row.classList.toggle('hidden');
                if (!row.classList.contains('hidden')) {
                    var inp = $('moveNewName');
                    if (inp) { inp.focus(); }
                }
            });
        }
        var newOk = $('moveNewOk');
        if (newOk) { newOk.addEventListener('click', createFromInput); }
        var newInput = $('moveNewName');
        if (newInput) {
            newInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); createFromInput(); }
            });
        }
        /* 面包屑：点任意一段直接回到那一层 */
        var crumbBox = $('moveCrumbs');
        if (crumbBox) {
            crumbBox.addEventListener('click', function (e) {
                var b = e.target.closest('[data-mv-crumb]');
                if (!b) { return; }
                var idx = Number(b.getAttribute('data-mv-crumb'));
                if (isNaN(idx)) { return; }
                M.stack = M.stack.slice(0, idx + 1);
                M.filter = '';
                var inp0 = $('moveSearch'); if (inp0) { inp0.value = ''; }
                render();
            });
        }
        /* 搜索框：输入即过滤（不必回车），回车跳到第一个结果 */
        var sInp = $('moveSearch');
        if (sInp) {
            var sTimer = 0;
            sInp.addEventListener('input', function () {
                clearTimeout(sTimer);
                sTimer = setTimeout(function () {
                    M.filter = sInp.value || '';
                    render();
                }, 150);
            });
            sInp.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter') { return; }
                e.preventDefault();
                var list = $('moveList');
                var first = list && list.querySelector('[data-mv-dir]');
                if (first) { first.click(); }
            });
        }
        var list = $('moveList');
        if (list) {
            list.addEventListener('click', function (e) {
                var up = e.target.closest('[data-mv-up]');
                if (up) { M.stack.pop(); render(); return; }
                var row = e.target.closest('[data-mv-dir]');
                if (!row) { return; }
                var name = row.getAttribute('data-mv-dir');
                var dirs = list._dirs || [];
                for (var i = 0; i < dirs.length; i++) {
                    if (dirs[i].name !== name) { continue; }
                    if (dirs[i].trail) {
                        /* 搜索结果：直接把整条路径压栈，并清空搜索回到普通浏览 */
                        M.stack = dirs[i].trail.map(function (n) { return { name: n, handle: null }; });
                        M.stack[M.stack.length - 1].handle = dirs[i].handle;
                        M.filter = '';
                        var inp1 = $('moveSearch'); if (inp1) { inp1.value = ''; }
                        render();
                        return;
                    }
                    M.stack.push({ name: dirs[i].name, handle: dirs[i].handle });
                    render();
                    return;
                }
            });
        }
        var mask = $('moveMask');
        if (mask) {
            mask.addEventListener('click', function (e) { if (e.target === mask) { show(false); } });
        }
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
    else { init(); }

    root.VRMovePicker = {
        open: open,
        /* 自动化测试用：跳过权限检查，给定句柄直接挂载并渲染。
         * 正常流程一律走 open()，这个入口不会在 UI 上暴露。 */
        _testMount: async function (handle, filter) {
            M.handle = handle;
            M.prefix = '';
            M.absRoot = '';
            M.stack = [];
            M.items = [{ relPath: 'x/probe.jpg' }];
            M.busy = false;
            M.filter = filter || '';
            show(true);
            await render();
            return M.filter;
        },
        _state: function () {
            return { filter: M.filter, depth: M.stack.length, items: M.items.length };
        }
    };
})(typeof self !== 'undefined' ? self : this);
