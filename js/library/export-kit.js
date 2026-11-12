/* ==========================================================
 * VRExportKit —— 运行时把「扩展程序本身」备份到用户文件夹
 *
 * 苏哥 2026-11-10 提的需求：
 *   用户授权素材目录时，顺便问一句「要不要把扩展程序也备份一份到这里」。
 *   这样用户以后重装系统 / 换电脑，从自己选的文件夹里就能重新导入扩展，
 *   不用纠结「扩展从哪儿来」。
 *
 * 为什么能「复制自己」（关键可行性，实测验证过）：
 *   扩展页面可以 fetch 自己的 chrome-extension:// 资源
 *   （fetch(chrome.runtime.getURL('js/background.js')) 返回 200）。
 *   所以思路是：读构建期生成的清单 _vr_export.json → 按清单逐个
 *   fetch 自己 → 用 File System Access 句柄逐文件写进用户目录。
 *
 * 为什么不能靠 manifest.json 枚举文件：
 *   background.js 里有 importScripts / 动态注入（dedup.js、xhs-media.js 等），
 *   manifest 列不全。所以清单由 build-dist.js 用「白名单整目录拷贝」的
 *   结果生成（tools/build-dist.js 的 EXPORT_MANIFEST），保证 100% 完整。
 *
 * 边界（写进说明书）：
 *   备份的是「当前版本」的快照；以后扩展升级了，这份备份还是旧的，
 *   重装后手动更新一次即可。
 *
 * 零依赖、ES2017+ async（只在扩展页面上下文运行，Chrome 86+ 都有）。
 * 挂 self.VRExportKit。
 * ========================================================== */
(function (root) {
    'use strict';

    var EXPORT_MANIFEST = 'vr-export.json';
    var BACKUP_DIR = '钓鱼竿扩展程序备份';
    var EXT_DIR = 'extension';
    var MANUAL_NAME = '使用说明.html';

    /** 把相对路径切成目录段 + 文件名（用 / 分割，Windows 句柄也认 /） */
    function splitRel(rel) {
        var p = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
        var segs = p.split('/').filter(Boolean);
        return { dirs: segs.slice(0, -1), name: segs[segs.length - 1] };
    }

    /** 在 handle 下按 relPath 逐段建目录，写入 bytes */
    async function writeRel(handle, relPath, bytes) {
        var sp = splitRel(relPath);
        var dir = handle;
        for (var i = 0; i < sp.dirs.length; i++) {
            dir = await dir.getDirectoryHandle(sp.dirs[i], { create: true });
        }
        var fh = await dir.getFileHandle(sp.name, { create: true });
        var w = await fh.createWritable();
        await w.write(bytes);
        await w.close();
    }

    /** 读构建期生成的导出清单（失败返回 null） */
    async function readList() {
        try {
            var r = await fetch(root.chrome.runtime.getURL(EXPORT_MANIFEST));
            if (!r.ok) { return null; }
            var arr = await r.json();
            if (!Array.isArray(arr) || !arr.length) { return null; }
            return arr;
        } catch (e) {
            return null;
        }
    }

    /** 说明书（精简版）：教用户重装时怎么加载这份备份。版本号动态填。 */
    function manualHtml(ver) {
        return [
            '<!DOCTYPE html>',
            '<html lang="zh-CN"><head><meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width,initial-scale=1">',
            '<title>钓鱼竿扩展程序 · 备份</title>',
            '<style>',
            'body{margin:0;background:#0B0A09;color:#F2EDE4;font:15px/1.8 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;padding:40px 20px}',
            '.w{max-width:640px;margin:0 auto}',
            'h1{font-size:24px;margin:0 0 6px}',
            '.v{color:#B98A32;font-size:12px;margin:0 0 22px}',
            '.c{background:#100F0E;border:1px solid rgba(242,237,228,.11);border-radius:14px;padding:22px 24px;margin:0 0 18px}',
            '.c h2{font-size:16px;margin:0 0 10px;display:flex;gap:10px;align-items:center}',
            '.n{width:22px;height:22px;border-radius:7px;background:rgba(232,176,75,.14);color:#E8B04B;font-size:12px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}',
            'code{font:12.5px/1.5 ui-monospace,Consolas,monospace;background:#1A1815;padding:2px 7px;border-radius:5px;color:#E8B04B}',
            '.note{background:rgba(232,176,75,.07);border:1px solid rgba(232,176,75,.2);border-radius:10px;padding:13px 15px;font-size:13.5px;color:rgba(242,237,228,.72)}',
            'b{color:#F2EDE4}',
            '</style></head><body><div class="w">',
            '<h1>这是「钓鱼竿」扩展程序的备份</h1>',
            '<p class="v">版本 ' + String(ver || '') + ' · Edge / Chrome 通用</p>',
            '<div class="c"><h2><span class="n">1</span>什么时候用到它</h2>',
            '<p>重装系统、换电脑、或扩展误删之后。这个文件夹里装着一份完整的扩展程序，照下面三步就能装回来。</p></div>',
            '<div class="c"><h2><span class="n">2</span>怎么装回来</h2>',
            '<p>① 浏览器地址栏粘贴 <code>edge://extensions</code>（Chrome 用 <code>chrome://extensions</code>），回车；<br>',
            '② 打开「开发者模式」开关；<br>',
            '③ 点「加载解压缩的扩展」，选本文件夹里的 <code>extension</code> 子文件夹。</p>',
            '<p>判断标准：能直接看到 <code>manifest.json</code> 的那一层就是对的。</p></div>',
            '<div class="c"><h2><span class="n">3</span>装完确认</h2>',
            '<p>列表里出现「苏哥的钓鱼竿」就成功了。点浏览器右上角拼图图标，把它固定到工具栏。</p></div>',
            '<div class="note">⚠️ 这份备份是<b>当时的版本</b>快照；扩展后来升级过的话，装回来后到扩展页点一次「重新加载」或手动更新。<br>',
            '这个文件夹只是备份，删掉不影响正在用的扩展。</div>',
            '</div></body></html>'
        ].join('');
    }

    /**
     * 把完整扩展 + 说明书备份到 handle 下的「钓鱼竿扩展程序备份」目录。
     * @returns Promise<{ok, count, bytes, dir, error}>
     */
    async function backup(handle, onProgress) {
        if (!handle || typeof handle.getDirectoryHandle !== 'function') {
            return { ok: false, error: '无效的目录句柄' };
        }
        var list = await readList();
        if (!list) {
            return { ok: false, error: '读不到导出清单（扩展版本过旧，请先更新扩展）' };
        }

        var ver = '';
        try { ver = root.chrome.runtime.getManifest().version || ''; } catch (e) { /* 忽略 */ }

        var top = null;
        try { top = await handle.getDirectoryHandle(BACKUP_DIR, { create: true }); }
        catch (e) { return { ok: false, error: '无法创建备份目录：' + (e && e.message) }; }

        var extDir = null;
        try { extDir = await top.getDirectoryHandle(EXT_DIR, { create: true }); }
        catch (e) { return { ok: false, error: '无法创建 extension 目录：' + (e && e.message) }; }

        var count = 0, bytes = 0, failed = 0, firstErr = '';
        for (var i = 0; i < list.length; i++) {
            var rel = list[i];
            try {
                var r = await fetch(root.chrome.runtime.getURL(rel));
                if (!r.ok) { failed++; if (!firstErr) { firstErr = rel + ' HTTP ' + r.status; } continue; }
                var buf = await r.arrayBuffer();
                await writeRel(extDir, rel, buf);
                count++;
                bytes += buf.byteLength;
            } catch (e) {
                failed++;
                if (!firstErr) { firstErr = rel + ': ' + (e && e.message); }
            }
            if (onProgress && (i % 20 === 0 || i === list.length - 1)) {
                try { onProgress({ done: i + 1, total: list.length }); } catch (e2) { /* 忽略 */ }
            }
        }

        /* 说明书：只有扩展本体一个不漏都成功，才写说明书，避免误导「装不上」 */
        if (failed === 0) {
            try { await writeRel(top, MANUAL_NAME, manualHtml(ver)); }
            catch (e) { /* 说明书写失败不影响扩展本体 */ }
        }

        return {
            ok: failed === 0,
            count: count,
            bytes: bytes,
            failed: failed,
            dir: BACKUP_DIR + '/' + EXT_DIR,
            error: failed ? ('有 ' + failed + ' 个文件没备份成功' + (firstErr ? '（' + firstErr + '）' : '')) : ''
        };
    }

    /**
     * 「授权成功 → 顺便问要不要备份」的统一入口。
     * @param handle  素材目录句柄（备份会放到它下面的 BACKUP_DIR）
     * @param notify  (msg, kind) => void，kind: 'info'|'ok'|'err'，各页面用自己的 toast 实现
     * @returns Promise<boolean> 是否真的执行了备份
     */
    async function offerBackup(handle, notify) {
        if (!handle) { return false; }
        var say = function (m, k) { try { notify && notify(m, k); } catch (e) { /* 忽略 */ } };

        var want = false;
        try {
            want = window.confirm(
                '素材目录已授权。要不要把「钓鱼竿」扩展程序也备份一份到这个文件夹？\n\n' +
                '以后重装系统 / 换电脑，从这个文件夹里的「' + BACKUP_DIR + '」就能重新导入，' +
                '不用再找扩展从哪儿来。\n（约 4.5MB，备份的是当前版本）'
            );
        } catch (e) { want = false; }
        if (!want) { return false; }

        say('正在备份扩展程序…', 'info');
        var r = await backup(handle, function (p) {
            if (p.done % 40 === 0) {
                say('正在备份扩展程序… ' + Math.round(p.done / p.total * 100) + '%', 'info');
            }
        });
        if (r.ok) {
            say('已备份扩展程序到「' + BACKUP_DIR + '」', 'ok');
        } else {
            say('备份扩展程序失败：' + (r.error || '未知错误'), 'err');
        }
        return r.ok;
    }

    root.VRExportKit = {
        BACKUP_DIR: BACKUP_DIR,
        EXT_DIR: EXT_DIR,
        backup: backup,
        offerBackup: offerBackup
    };
})(typeof self !== 'undefined' ? self : this);
