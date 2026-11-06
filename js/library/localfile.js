/* ==========================================================
 * VRFile —— 本地文件 URL 解析（绝对路径优先，目录句柄兜底）
 *
 * 背景：
 *   自选文件夹走 File System Access，浏览器只给目录句柄，**拿不到绝对路径**。
 *   缩略图和详情预览原本只认 entry.absPath，导致「自选文件夹」里的素材
 *   全部灰块 / 点开提示没有本地路径。这里用句柄按 relPath 取 File，
 *   生成 object URL 给 <img>/<video> 用。
 *
 * 口径：
 *   - 有 absPath → 直接用 file:// URL（原有行为不变）
 *   - 没 absPath → 读 VRDB 的 root 句柄，剥掉 rootPrefix（与 save.js 一致）后逐段查找
 *   - 返回 { url, revoke }；调用方用完必须 revoke，避免 object URL 泄漏
 *   - 拿不到就当不可预览，不抛异常打断列表
 *
 * 零依赖、ES5+Promise，挂 self.VRFile。
 * ========================================================== */
(function (root) {
    'use strict';

    function norm(p) {
        return String(p || '').replace(/\\/g, '/');
    }

    function stripPrefix(rel, prefix) {
        var r = norm(rel);
        var p = norm(prefix).replace(/^\/+|\/+$/g, '');
        if (p && r.indexOf(p + '/') === 0) { return r.slice(p.length + 1); }
        return r;
    }

    async function readByHandle(entry) {
        if (!root.VRDB || typeof root.VRDB.getHandle !== 'function') { return null; }
        var handle;
        try { handle = await root.VRDB.getHandle('root'); } catch (e) { return null; }
        if (!handle || typeof handle.getDirectoryHandle !== 'function') { return null; }

        if (typeof handle.queryPermission === 'function') {
            var st = 'granted';
            try { st = await handle.queryPermission({ mode: 'read' }); } catch (e) { st = 'granted'; }
            if (st !== 'granted') {
                try { st = await handle.requestPermission({ mode: 'read' }); } catch (e2) { st = 'denied'; }
            }
            if (st !== 'granted') { return null; }
        }

        var prefix = '';
        try { prefix = String(await root.VRDB.getSetting('rootPrefix', '') || ''); } catch (e) { /* 忽略 */ }

        var rels = [stripPrefix(entry.relPath, prefix), norm(entry.relPath)];
        for (var n = 0; n < rels.length; n++) {
            var rel = rels[n];
            var segs = rel.split('/').filter(Boolean);
            if (!segs.length) { continue; }
            var name = segs.pop();
            try {
                var dir = handle;
                for (var i = 0; i < segs.length; i++) {
                    dir = await dir.getDirectoryHandle(segs[i]);
                }
                var fh = await dir.getFileHandle(name);
                return await fh.getFile();
            } catch (e3) { /* 换下一种 rel 口径 */ }
        }
        return null;
    }

    /**
     * @param {object} entry 资源库条目或卡片模型（需要 relPath / absPath）
     * @returns {Promise<{url:string, revoke:Function}|null>}
     */
    async function resolve(entry) {
        if (!entry) { return null; }
        if (entry.absPath && root.VRPath && root.VRPath.toFileUrl) {
            try {
                return { url: root.VRPath.toFileUrl(entry.absPath), revoke: function () {} };
            } catch (e) { /* 落到句柄兜底 */ }
        }
        var file;
        try { file = await readByHandle(entry); } catch (e) { file = null; }
        if (!file) { return null; }
        var url = URL.createObjectURL(file);
        return {
            url: url,
            file: file,
            revoke: function () { try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ } }
        };
    }

    root.VRFile = {
        resolve: resolve,
        _stripPrefix: stripPrefix
    };
})(typeof self !== 'undefined' ? self : this);
