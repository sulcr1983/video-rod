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
    // ⚠️ 本文件同时被 background service worker（importScripts）和资源库页面加载。
    //    SW 里没有 window，写死 window 会让 importScripts 抛 ReferenceError，
    //    进而整个 background.js 中断、chrome.runtime.onMessage 从未注册 —— 表现为
    //    「资源库看着正常、页面悬浮按钮也在，但点下载毫无反应」。2026-11-05 实测踩过。
    var root = (typeof window !== 'undefined') ? window
        : ((typeof self !== 'undefined') ? self : this);

    var CHUNK = 131072;          // 128KB 一块，不整读进内存
    var HASH_FIELD = 'sha256';
    var HASH_KIND_FIELD = 'hashKind';   // 'sha256' 完整 / 'sampled' 大文件采样
    var REF_FIELD = 'isRef';
    var DISPLAY_FIELD = 'displayName';

    /* 大文件策略：
     *   ≤ FULL_LIMIT → 完整 SHA-256（一次 digest，内存上限可控）
     *   >  FULL_LIMIT → 采样指纹（size + 首/中/尾各 4MB），标 hashKind='sampled'
     *
     * 为什么不做「增量 SHA-256」：WebCrypto 的 subtle.digest 不支持 update，
     * 要增量就得手写 SHA-256（易错且慢）。采样已经达到目的——**不再把 1GB
     * 视频整读进内存**，内存从「文件大小」降到约 12MB。
     * 代价是弱指纹可能碰撞，所以它只用于「报告」、不自动合并（见 merge()）。 */
    var FULL_LIMIT = 64 * 1024 * 1024;
    var SAMPLE_BYTES = 4 * 1024 * 1024;

    /** ArrayBuffer → 64 位小写 hex */
    async function hexDigest(buf) {
        var digest = await crypto.subtle.digest('SHA-256', buf);
        var bytes = new Uint8Array(digest);
        var out = '';
        for (var i = 0; i < bytes.length; i++) {
            out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
        }
        return out;
    }

    /** 纯 ASCII 字符串 → Uint8Array（不依赖 TextEncoder，vm/旧环境也能跑） */
    function asciiBytes(s) {
        var str = String(s);
        var out = new Uint8Array(str.length);
        for (var i = 0; i < str.length; i++) { out[i] = str.charCodeAt(i) & 0xff; }
        return out;
    }

    /** 多个 ArrayBuffer/TypedArray 拼成一个（不依赖 Blob） */
    function concatBytes(parts) {
        var total = 0;
        var i;
        for (i = 0; i < parts.length; i++) { total += parts[i].byteLength; }
        var out = new Uint8Array(total);
        var off = 0;
        for (i = 0; i < parts.length; i++) {
            out.set(new Uint8Array(parts[i]), off);
            off += parts[i].byteLength;
        }
        return out.buffer;
    }

    /**
     * 打开文件为「可分区读取」的源。
     *
     * 两种形态都要支持：
     *   - fetch 返回可按 slice 惰性读的 Blob（真实浏览器 / file://）→ 大文件只读需要的区间
     *   - 只给 arrayBuffer 的实现（测试桩、老代码路径）→ 退化为整读
     * 这样指纹逻辑不依赖全局 Blob/TextEncoder，Node 里也能直接测。
     *
     * @returns {Promise<{size:number, part:function, whole:function}|null>}
     */
    async function openSource(absPath) {
        if (!absPath || !root.VRPath || !root.VRPath.toFileUrl) { return null; }
        var url = root.VRPath.toFileUrl(absPath);
        var resp = await fetch(url);
        if (!resp || !resp.ok) { return null; }

        if (typeof resp.blob === 'function') {
            try {
                var b = await resp.blob();
                if (b && b.size) {
                    return {
                        size: Number(b.size),
                        part: function (s, e) { return b.slice(s, e).arrayBuffer(); },
                        whole: function () { return b.arrayBuffer(); }
                    };
                }
            } catch (e) { /* 落到 arrayBuffer 兜底 */ }
        }
        var buf = await resp.arrayBuffer();
        if (!buf || !buf.byteLength) { return null; }
        return {
            size: buf.byteLength,
            part: function (s, e) { return Promise.resolve(buf.slice(s, e)); },
            whole: function () { return Promise.resolve(buf); }
        };
    }

    /**
     * 算内容指纹。
     * @returns {Promise<{hash:string, kind:string, size:number}>} 失败时 hash=''
     */
    async function fingerprint(absPath) {
        try {
            var src = await openSource(absPath);
            if (!src || !src.size) { return { hash: '', kind: '', size: 0 }; }

            if (src.size <= FULL_LIMIT) {
                var whole = await src.whole();
                if (!whole || !whole.byteLength) { return { hash: '', kind: '', size: 0 }; }
                return { hash: await hexDigest(whole), kind: 'sha256', size: src.size };
            }

            /* 采样：把 size 一起喂进摘要 —— 大小不同必然判不同，
             * 避免「首尾相同但长度不同」的误判。 */
            var midStart = Math.max(0, Math.floor(src.size / 2) - (SAMPLE_BYTES / 2));
            var parts = [
                asciiBytes('vr-sample-v1|' + src.size + '|'),
                await src.part(0, Math.min(SAMPLE_BYTES, src.size)),
                await src.part(midStart, Math.min(midStart + SAMPLE_BYTES, src.size)),
                await src.part(Math.max(0, src.size - SAMPLE_BYTES), src.size)
            ];
            return { hash: await hexDigest(concatBytes(parts)), kind: 'sampled', size: src.size };
        } catch (e) {
            return { hash: '', kind: '', size: 0 };
        }
    }

    /** 分块/采样算指纹，返回 hex；失败返回空串（绝不抛给调用方） */
    async function hashFile(absPath) {
        var fp = await fingerprint(absPath);
        return fp.hash;
    }

    /** 给 Blob/ArrayBuffer 算指纹（页面上下文下载走这条，内容已在内存里） */
    async function hashBlob(blob) {
        try {
            if (!blob || !blob.arrayBuffer) { return ''; }
            var buf = await blob.arrayBuffer();
            if (!buf || !buf.byteLength) { return ''; }
            return await hexDigest(buf);
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
    /**
     * 全库重复扫描（只读）：按内容指纹分组，返回 ≥2 条的同内容组。
     * 只报告，不删文件；合并仍由下载时的 afterDownload / 删除时的 onDelete 语义处理。
     * @returns {Promise<{groups:Array, items:number, files:number, reclaimBytes:number}>}
     */
    async function scan() {
        var out = { groups: [], items: 0, files: 0, reclaimBytes: 0 };
        try {
            if (!root.VRDB || !root.VRDB.getAllFiles) { return out; }
            var all = await root.VRDB.getAllFiles();
            out.files = (all || []).length;
            var by = {};
            (all || []).forEach(function (e) {
                var h = e && e[HASH_FIELD];
                if (!h) { return; }
                (by[h] = by[h] || []).push(e);
            });
            Object.keys(by).forEach(function (h) {
                var g = by[h];
                if (g.length < 2) { return; }
                out.groups.push({ hash: h, items: g });
                out.items += g.length;
                /* 物理只留一份，其余是引用：可回收 = (n-1) × 单条大小 */
                out.reclaimBytes += (g.length - 1) * (Number(g[0].size) || 0);
            });
            return out;
        } catch (e) {
            return out;
        }
    }

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
        scan: scan,
        stats: stats,
        HASH_FIELD: HASH_FIELD,
        REF_FIELD: REF_FIELD,
        DISPLAY_FIELD: DISPLAY_FIELD
    };
})(typeof self !== 'undefined' ? self : this);
