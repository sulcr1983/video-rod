/* ==========================================================
 * VRRename —— 单条重命名（S5b）
 *
 * 口径：目录不变，只改文件名；同目录内「复制 → 校验大小 → 删源」
 * （FSA 没有 move），再换索引 key（旧删新写），thumbKey 置空触发重建。
 * 依赖：VRDB、VRTrash.resolveRoot（或 VRIndex.resolveRoot）；挂 self.VRRename。
 * ========================================================== */
(function (root) {
    'use strict';

    var LOG_DIR = '_migration';
    var ILLEGAL = /[\\/:*?"<>|]/;

    var cb = {};
    var rnRel = '';
    var busy = false;
    var bound = false;

    function $(id) { return document.getElementById(id); }

    function makeErr(code, msg) {
        var e = new Error(msg || code);
        e.code = code;
        e.vrCode = code;
        return e;
    }

    function split(rel) {
        return String(rel || '').replace(/\\/g, '/').split('/').filter(Boolean);
    }

    function extOf(name) {
        var m = /(\.[^.\\/]+)$/.exec(String(name || ''));
        return m ? m[1] : '';
    }

    function dbReady() {
        return typeof root.VRDB !== 'undefined' && root.VRDB;
    }

    function stamp() {
        var d = new Date();
        function p(n) { return ('0' + n).slice(-2); }
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
            p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    /* ---------------- 根目录与权限 ---------------- */

    async function resolveRoot() {
        if (root.VRTrash && typeof root.VRTrash.resolveRoot === 'function') {
            return root.VRTrash.resolveRoot();
        }
        if (root.VRIndex && typeof root.VRIndex.resolveRoot === 'function') {
            return root.VRIndex.resolveRoot();
        }
        var handle = null;
        var absRoot = '';
        if (dbReady()) {
            try { handle = await root.VRDB.getHandle('root'); } catch (e) { /* 忽略 */ }
            try { absRoot = await root.VRDB.getSetting('rootAbs', ''); } catch (e) { /* 忽略 */ }
        }
        return { handle: handle || null, absRoot: absRoot || '', prefix: '' };
    }

    async function ensureRW(handle) {
        if (!handle) {
            throw makeErr('LIB_E_NO_PERM', '需要一次目录授权才能重命名');
        }
        if (typeof handle.queryPermission !== 'function') { return; }
        var state = await handle.queryPermission({ mode: 'readwrite' });
        if (state === 'granted') { return; }
        if (typeof handle.requestPermission === 'function') {
            state = await handle.requestPermission({ mode: 'readwrite' });
        }
        if (state !== 'granted') {
            throw makeErr('LIB_E_NO_PERM', '目录写权限未授权');
        }
    }

    /* ---------------- 文件系统小工具 ---------------- */

    async function dirAt(rootHandle, segs, create) {
        var dir = rootHandle;
        for (var i = 0; i < segs.length; i++) {
            dir = await dir.getDirectoryHandle(segs[i], { create: !!create });
        }
        return dir;
    }

    async function fileAt(rootHandle, rel) {
        var segs = split(rel);
        var name = segs.pop();
        if (!name) { throw makeErr('LIB_E_NAME', '空路径'); }
        var dir = await dirAt(rootHandle, segs, false);
        return dir.getFileHandle(name, { create: false });
    }

    async function exists(rootHandle, rel) {
        try {
            await fileAt(rootHandle, rel);
            return true;
        } catch (e) {
            return false;
        }
    }

    async function writeText(rootHandle, rel, text) {
        var segs = split(rel);
        var name = segs.pop();
        var dir = await dirAt(rootHandle, segs, true);
        var handle = await dir.getFileHandle(name, { create: true });
        var w = await handle.createWritable();
        try {
            await w.write(text);
        } finally {
            await w.close();
        }
    }

    /**
     * 索引 key 首段是 subdir，句柄可能指向资源库根（无首段）或下载目录（有首段）。
     * 先剥前缀、再原样，取第一个真实存在的路径。
     */
    function candidates(rel, prefix) {
        var out = [];
        var p = prefix ? String(prefix).replace(/^\/+|\/+$/g, '') + '/' : '';
        if (p && rel.indexOf(p) === 0) {
            var stripped = rel.slice(p.length);
            if (stripped) { out.push(stripped); }
        }
        if (out.indexOf(rel) === -1) { out.push(rel); }
        return out;
    }

    async function resolveFs(rootHandle, rel, prefix) {
        var list = candidates(rel, prefix);
        for (var i = 0; i < list.length; i++) {
            if (await exists(rootHandle, list[i])) { return list[i]; }
        }
        return '';
    }

    async function writeOps(rootHandle, action, payload) {
        try {
            await writeText(rootHandle, LOG_DIR + '/ops-' + stamp() + '.json', JSON.stringify({
                action: action,
                at: Date.now(),
                payload: payload
            }, null, 2));
        } catch (e) { /* 日志失败不阻断 */ }
    }

    /* ---------------- 校验 ---------------- */

    /** 返回最终文件名；不合法直接抛错 */
    function validate(input, oldName) {
        var name = String(input == null ? '' : input).trim();
        if (!name) {
            throw makeErr('LIB_E_NAME', '文件名不能为空');
        }
        if (ILLEGAL.test(name)) {
            throw makeErr('LIB_E_NAME', '文件名不能包含 \\ / : * ? " < > |');
        }
        if (/[\u0000-\u001f]/.test(name)) {
            throw makeErr('LIB_E_NAME', '文件名不能包含控制字符');
        }
        if (name === '.' || name === '..') {
            throw makeErr('LIB_E_NAME', '文件名不能是 . 或 ..');
        }
        if (/[. ]$/.test(name)) {
            throw makeErr('LIB_E_NAME', '文件名不能以点或空格结尾');
        }
        var ext = extOf(oldName);
        if (ext && name.indexOf('.') === -1) { name += ext; }
        if (name.toLowerCase() === String(oldName || '').toLowerCase()) {
            throw makeErr('LIB_E_NAME', '与原文件名相同');
        }
        return name;
    }

    /* ---------------- 重命名 ---------------- */

    async function rename(relPath, newName) {
        var oldRel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
        var segs = split(oldRel);
        var oldName = segs.pop();
        if (!oldName) {
            throw makeErr('LIB_E_NAME', '路径里没有文件名');
        }
        var name = validate(newName, oldName);
        var newRel = segs.concat([name]).join('/');

        var rr = await resolveRoot();
        await ensureRW(rr.handle);

        var oldFs = await resolveFs(rr.handle, oldRel, rr.prefix);
        if (!oldFs) {
            throw makeErr('LIB_E_NOT_FOUND', '文件不存在，可能已被移动或删除');
        }
        var fsSegs = split(oldFs);
        var fsOldName = fsSegs.pop();
        var newFs = fsSegs.concat([name]).join('/');

        if (await exists(rr.handle, newFs)) {
            throw makeErr('LIB_E_EXISTS', '同目录已有同名文件');
        }

        // 复制 → 校验大小 → 删源
        var srcHandle = await fileAt(rr.handle, oldFs);
        var srcFile = await srcHandle.getFile();
        var dir = await dirAt(rr.handle, fsSegs, false);
        var dstHandle = await dir.getFileHandle(name, { create: true });
        var w = await dstHandle.createWritable();
        try {
            await w.write(srcFile);
        } finally {
            await w.close();
        }

        var dstFile = await dstHandle.getFile();
        if (dstFile.size !== srcFile.size) {
            try { await dir.removeEntry(name); } catch (e) { /* 忽略 */ }
            throw makeErr('LIB_E_COPY', '复制后大小不一致，已保留原文件');
        }

        try {
            await dir.removeEntry(fsOldName);
        } catch (e) {
            try { await dir.removeEntry(name); } catch (e2) { /* 忽略 */ }
            throw makeErr('LIB_E_COPY', '源文件删除失败，已回滚副本');
        }

        // 索引：写新 key → 删旧 key（先写后删，避免中途失败丢条目）
        if (dbReady()) {
            var old = null;
            try { old = await root.VRDB.getFile(oldRel); } catch (e) { /* 忽略 */ }
            var next = Object.assign({}, old || {}, {
                relPath: newRel,
                fileName: name,
                state: 'ok',
                thumbKey: ''
            });
            if (!old) {
                // 索引里没有旧条目（磁盘有、索引缺）：按路径反解补齐元数据
                if (root.VRPath && root.VRPath.parseRelPath) {
                    try { Object.assign(next, root.VRPath.parseRelPath(newRel) || {}); } catch (e) { /* 忽略 */ }
                }
                next.size = srcFile.size;
                next.mtime = srcFile.lastModified || Date.now();
                next.starred = 0;
                next.tags = [];
            }
            if (old && old.absPath) {
                next.absPath = old.absPath.replace(/[\\/][^\\/]*$/, '') + '/' + name;
            } else if (rr.absRoot) {
                var relFromRoot = newRel;
                var p = rr.prefix ? (rr.prefix + '/') : '';
                if (p && newRel.indexOf(p) === 0) { relFromRoot = newRel.slice(p.length); }
                next.absPath = rr.absRoot.replace(/[\\/]+$/, '') + '/' + relFromRoot;
            }
            if (root.VRPath) {
                try {
                    var t = root.VRPath.typeOf({ fileName: name });
                    if (t) { next.type = t; }
                } catch (e) { /* 忽略 */ }
            }
            try {
                await root.VRDB.putFiles([next]);
                await root.VRDB.deleteFiles([oldRel]);
            } catch (e) {
                throw makeErr('LIB_E_DB', '文件已改名，但索引更新失败：请刷新列表');
            }
            try {
                await root.VRDB.log('rename', { from: oldRel, to: newRel }, { size: srcFile.size });
            } catch (e) { /* 忽略 */ }
        }

        await writeOps(rr.handle, 'rename', { from: oldRel, to: newRel, size: srcFile.size });
        return { relPath: newRel, fileName: name };
    }

    /* ---------------- 弹窗 ---------------- */

    function errText(err) {
        var code = (err && err.code) || '';
        if (code === 'LIB_E_NAME') { return (err && err.message) || '文件名不合法'; }
        if (code === 'LIB_E_EXISTS') { return '同目录已有同名文件，未覆盖'; }
        if (code === 'LIB_E_NO_PERM') {
            return '需要目录写权限：去设置页点「授权目录并全量扫描」后再试';
        }
        if (code === 'LIB_E_NOT_FOUND') { return '文件不存在，可能已被移动或删除'; }
        if (code === 'LIB_E_COPY') { return (err && err.message) || '复制校验失败，已保留原文件'; }
        if (code === 'LIB_E_DB') { return (err && err.message) || '索引更新失败'; }
        return (err && err.message) || '重命名失败';
    }

    function showError(msg) {
        var el = $('libRenameError');
        if (!el) { return; }
        el.textContent = msg || '';
        el.hidden = !msg;
    }

    function currentEntry() {
        if (cb.getEntry) { return cb.getEntry(rnRel) || null; }
        return null;
    }

    function currentName() {
        var e = currentEntry();
        return (e && e.fileName) || split(rnRel).pop() || '';
    }

    function open(relPath) {
        if (!relPath) { return; }
        rnRel = relPath;
        var input = $('libRenameInput');
        if (!input) { return; }
        var name = currentName();
        var base = name.replace(/\.[^.]+$/, '');
        input.value = name;
        $('libRenameMask').hidden = false;
        showError('');
        var dirEl = $('libRenameDir');
        if (dirEl) {
            var segs = split(relPath);
            segs.pop();
            dirEl.textContent = '目录：' + (segs.join('/') || '/') + '/';
        }
        input.focus();
        input.setSelectionRange(0, base.length);
    }

    function close() {
        var mask = $('libRenameMask');
        if (mask) { mask.hidden = true; }
        rnRel = '';
        showError('');
    }

    async function submit() {
        if (busy || !rnRel) { return; }
        var input = $('libRenameInput');
        var okBtn = $('libRenameOk');
        busy = true;
        if (okBtn) { okBtn.disabled = true; }
        try {
            // 先关查看器，释放 Windows 上的文件占用
            if (root.VRViewer && root.VRViewer.isOpen()) { root.VRViewer.close(); }
            var r = await rename(rnRel, input ? input.value : '');
            close();
            if (root.VRTrashUI && root.VRTrashUI.toast) {
                root.VRTrashUI.toast('已重命名：' + r.fileName);
            }
            if (cb.reload) { cb.reload(); }
        } catch (err) {
            showError(errText(err));
        } finally {
            busy = false;
            if (okBtn) { okBtn.disabled = false; }
        }
    }

    /* ---------------- 事件绑定 ---------------- */

    function bind() {
        if (bound) { return; }
        bound = true;

        var mask = $('libRenameMask');
        if (!mask) { return; }

        $('libRenameOk').addEventListener('click', submit);
        $('libRenameCancel').addEventListener('click', close);
        mask.addEventListener('click', function (ev) {
            if (ev.target === mask) { close(); }
        });

        var input = $('libRenameInput');
        input.addEventListener('input', function () { showError(''); });
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                submit();
                return;
            }
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                close();
            }
        });

        // 焦点不在输入框时的 Esc 也能关；用捕获阶段，先于其它全局 Esc 处理
        document.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Escape') { return; }
            if (mask.hidden) { return; }
            ev.preventDefault();
            ev.stopPropagation();
            close();
        }, true);
    }

    function init(options) {
        cb = options || {};
        bind();
    }

    root.VRRename = {
        rename: rename,
        open: open,
        close: close,
        init: init,
        _validate: validate,
        _candidates: candidates
    };
})(typeof self !== 'undefined' ? self : this);
