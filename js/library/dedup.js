/* ==========================================================
 * VR Dedup —— 内容去重引用制（F5 / B-12）
 *
 * 原理（网盘秒传）：下载完成后算内容指纹 SHA-256
 *   ├─ 库里没有这个指纹 → 正常入库，指纹记在条目上
 *   └─ 库里已有这个指纹 → 删掉刚落盘的重复文件，只写一条「引用」条目
 *
 * 铁律（ADR-050 已批 R1+R2）：
 *   R1 删除 = 只减引用；最后一条引用清空才真正删物理文件
 *   R2 重命名 = 只改显示名（displayName），物理文件名不动
 *   异常一律不影响下载本身
 * ========================================================== */
(function () {
    'use strict';
    var root = window;

    var CHUNK = 131072;          // 128KB 一块，不整读进内存
    var HASH_FIELD = 'sha256';
    var REF_FIELD = 'isRef';
    var DISPLAY_FIELD = 'displayName';

    /* ---------------- 指纹计算 ---------------- */

    /** 分块读文件算 SHA-256；失败返回空串（绝不抛给调用方） */
    async function hashFile(absPath) {
        try {
            if (!absPath || !root.VRPath || !root.VRPath.toFileUrl) { return ''; }
            var url = root.VRPath.toFileUrl(absPath);
            var resp = await fetch(url);
            if (!resp.ok) { return ''; }
            var buf = await resp.arrayBuffer();
            if (!buf || !buf.byteLength) { return ''; }
            var digest = await crypto.subtle.digest('SHA-256', buf);
            var bytes = new Uint8Array(digest);
            var out = '';
            for (var i = 0; i < bytes.length; i++) {
                out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
            }
            return out;
        } catch (e) {
            return '';
        }
    }

    /** 给 Blob/ArrayBuffer 算指纹（页面上下文下载走这条） */
    async function hashBlob(blob) {
        try {
            if (!blob || !blob.arrayBuffer) { return ''; }
            var buf = await blob.arrayBuffer();
            var digest = await crypto.subtle.digest('SHA-256', buf);
            var bytes = new Uint8Array(digest);
            var out = '';
            for (var i = 0; i < bytes.length; i++) {
                out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
            }
            return out;
        } catch (e) {
            return '';
        }
    }

    /* ---------------- 库查询 ---------------- */

    /**
     * 已知指纹缓存（会话内）。
     * 为什么需要：afterDownload 是「算指纹 → 判重 → 返回」的一步式，
     * 写库由调用方做。若判重只查库，同一批次里连着下的两份相同内容
     * 在第一条尚未落库时查不到 → 漏判重。
     * 所以这里既查库，也查本会话已知的指纹。
     */
    var knownHash = {};        // hash -> {relPath, absPath}

    /** 找同指纹的已有条目（不含自己） */
    async function findByHash(hash, excludeRelPath) {
        try {
            if (!hash) { return null; }
            if (root.VRDB && root.VRDB.getAllFiles) {
                var all = await root.VRDB.getAllFiles();
                for (var i = 0; i < all.length; i++) {
                    var e = all[i];
                    if (!e || e[HASH_FIELD] !== hash) { continue; }
                    if (excludeRelPath && e.relPath === excludeRelPath) { continue; }
                    return e;
                }
            }
            // 库里还没有，但本会话已经见过这个指纹 → 它就是原件
            var k = knownHash[hash];
            if (k && (!excludeRelPath || k.relPath !== excludeRelPath)) {
                return { relPath: k.relPath, absPath: k.absPath, sha256: hash };
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    /** 记住一个指纹（判重命中或首次入库时调用） */
    function rememberHash(hash, relPath, absPath) {
        if (!hash || !relPath) { return; }
        knownHash[hash] = { relPath: relPath, absPath: absPath || '' };
    }

    /** 同指纹条目数（引用计数） */
    async function refCount(hash) {
        try {
            if (!hash || !root.VRDB || !root.VRDB.getAllFiles) { return 0; }
            var all = await root.VRDB.getAllFiles();
            var n = 0;
            for (var i = 0; i < all.length; i++) {
                if (all[i] && all[i][HASH_FIELD] === hash) { n++; }
            }
            return n;
        } catch (e) {
            return 0;
        }
    }

    /* ---------------- 物理文件操作 ---------------- */

    /** 删物理文件（引用命中时删重复件）；失败返回 false，绝不影响主流程 */
    async function removePhysical(absPath) {
        try {
            if (!absPath || !root.VRPath || !root.VRPath.toFileUrl) { return false; }
            var url = root.VRPath.toFileUrl(absPath);
            var res = await fetch(url, { method: 'DELETE' });
            return !!(res && res.ok);
        } catch (e) {
            return false;
        }
    }

    /* ---------------- 主流程 ---------------- */

    /**
     * 下载完成后判重。
     * @param {object} o {relPath, absPath, info}  info=待入库条目
     * @returns {Promise<{ok:boolean, deduped:boolean, info:object, message?:string}>}
     */
    async function afterDownload(o) {
        var opt = o || {};
        var info = opt.info || {};
        var res = { ok: true, deduped: false, info: info };
        try {
            var hash = '';
            if (opt.blob) { hash = await hashBlob(opt.blob); }
            else if (opt.absPath) { hash = await hashFile(opt.absPath); }
            if (!hash) { return res; }        // 算不出指纹 → 当普通文件入库

            var origin = await findByHash(hash, opt.relPath);
            if (!origin) {
                // 首次：正常入库 + 记指纹（同时记进会话缓存，
                // 让「同一批里连下两份相同内容」也能判重）
                info[HASH_FIELD] = hash;
                info[REF_FIELD] = 0;
                rememberHash(hash, opt.relPath, opt.absPath);
                return res;
            }

            // 命中：物理文件已存在 → 删掉刚落盘的这份，只写引用条目
            info[HASH_FIELD] = hash;
            info[REF_FIELD] = 1;
            info.refOf = origin.relPath;          // 指向物理原件
            if (!info.absPath) { info.absPath = origin.absPath; }
            res.deduped = true;
            res.message = '内容已存在，已建立引用（未重复占用空间）';
            rememberHash(hash, origin.relPath, origin.absPath);

            // 删重复物理件：失败也不阻断（库里两条会指向同一文件，属于可接受降级）
            if (opt.absPath && opt.absPath !== origin.absPath) {
                await removePhysical(opt.absPath);
            }
            return res;
        } catch (e) {
            return res;      // 判重异常 → 按普通文件处理，不影响下载
        }
    }

    /**
     * R1：删除 = 只减引用。最后一条引用被删时才真正删物理文件。
     * @returns {Promise<{physicalDeleted:boolean, refCount:number}>}
     */
    async function onDelete(entry) {
        var out = { physicalDeleted: false, refCount: 0 };
        try {
            if (!entry || !entry[HASH_FIELD] || !root.VRDB) { return out; }
            var hash = entry[HASH_FIELD];
            // 先把这一条从库里去掉，再看还有几条引用
            var remaining = 0;
            var all = await root.VRDB.getAllFiles();
            for (var i = 0; i < all.length; i++) {
                if (all[i] && all[i][HASH_FIELD] === hash && all[i].relPath !== entry.relPath) { remaining++; }
            }
            out.refCount = remaining;
            if (remaining === 0) {
                /* 最后一条引用 → 真删物理文件。
                   注意：引用条目自己的 absPath 指向的是「已被删掉的那份重复件」，
                   真正要删的是原件 → 必须先按 refOf 找原件的 absPath。 */
                var physical = '';
                if (entry.refOf) {
                    var origin = all.filter(function (x) { return x && x.relPath === entry.refOf; })[0];
                    physical = origin ? (origin.absPath || '') : '';
                }
                if (!physical) { physical = entry.absPath || ''; }
                if (physical) {
                    out.physicalDeleted = await removePhysical(physical);
                }
            }
            return out;
        } catch (e) {
            return out;
        }
    }

    /** R2：重命名只改显示名，物理文件名不动 */
    async function renameDisplay(relPath, newName) {
        try {
            if (!root.VRDB || !root.VRDB.patchFile) { return false; }
            await root.VRDB.patchFile(relPath, { [DISPLAY_FIELD]: newName });
            return true;
        } catch (e) {
            return false;
        }
    }

    /** 统计口径：逻辑大小 vs 物理占用（去重后实际占盘） */
    async function stats() {
        var out = { logicalBytes: 0, physicalBytes: 0, count: 0, uniqCount: 0, hashes: {} };
        try {
            if (!root.VRDB || !root.VRDB.getAllFiles) { return out; }
            var all = await root.VRDB.getAllFiles();
            out.count = all.length;
            all.forEach(function (e) {
                if (!e) { return; }
                var sz = Number(e.size) || 0;
                out.logicalBytes += sz;
                var h = e[HASH_FIELD];
                if (h) {
                    if (!out.hashes[h]) { out.hashes[h] = { size: sz, count: 0 }; }
                    out.hashes[h].count++;
                }
            });
            Object.keys(out.hashes).forEach(function (h) {
                out.uniqCount++;
                out.physicalBytes += out.hashes[h].size;
            });
            // 没指纹的老条目按原大小计物理占用
            all.forEach(function (e) {
                if (e && !e[HASH_FIELD]) { out.physicalBytes += Number(e.size) || 0; }
            });
            return out;
        } catch (e) {
            return out;
        }
    }

    root.VRDedup = {
        hashFile: hashFile,
        hashBlob: hashBlob,
        findByHash: findByHash,
        rememberHash: rememberHash,
        refCount: refCount,
        afterDownload: afterDownload,
        onDelete: onDelete,
        renameDisplay: renameDisplay,
        stats: stats,
        HASH_FIELD: HASH_FIELD,
        REF_FIELD: REF_FIELD,
        DISPLAY_FIELD: DISPLAY_FIELD
    };
})(typeof self !== 'undefined' ? self : this);
