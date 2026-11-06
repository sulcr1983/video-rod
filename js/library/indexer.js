/* ==========================================================
 * VRIndex —— 资源库索引服务（S2，页面上下文）
 *
 * 为什么在页面侧：快照与全量扫描都要 FSA 目录句柄，SW 拿不到
 * （同 migrate.js 的结论，见 LIBRARY-PLAN §13.10/§13.11）。
 *
 * 三个来源：
 *   downloads : chrome.downloads 历史里落在资源库根下的条目（无需授权）
 *   snapshot  : <根>/_library/index-YYYYMMDD.json（需句柄）
 *   full      : 遍历整棵根目录（需句柄）
 *
 * 口径（ADR-030）：
 *   - downloads 只 upsert，不判定缺失
 *   - snapshot / full 扫不到的旧条目 → state:'missing'，永不自动删除
 *   - 重建索引必须保留 starred / tags / thumbKey / title 等用户数据
 *
 * 依赖：VRDB、VRPath（可缺省时降级，但不建议）
 * 零依赖、ES5+async，挂 self.VRIndex。
 * ========================================================== */
(function (root) {
    'use strict';

    var SNAP_DIR = '_library';
    var SNAP_RE = /^index-(\d{8})\.json$/;
    var KEEP_SNAPSHOTS = 7;
    var MAX_ITEMS = 20000;
    var MAX_DEPTH = 8;
    var DL_LIMIT = 5000;

    var SKIP_DIRS = { '_verify': 1, '_回收站': 1, '_library': 1, '_migration': 1, '_selftest': 1 };
    var SKIP_SUFFIX = /\.(part|crdownload|tmp)$/i;

    var memHandle = null;
    var memRoot = '';
    var memPrefix = '';

    /* ---------------- 小工具 ---------------- */

    function makeErr(code, msg) {
        var e = new Error(msg || code);
        e.vrCode = code;
        return e;
    }

    function errCode(e) {
        if (e && e.vrCode) { return e.vrCode; }
        var n = e && e.name;
        if (n === 'QuotaExceededError') { return 'LIB_E_ENOSPC'; }
        if (n === 'NotAllowedError' || n === 'SecurityError') { return 'LIB_E_NO_PERM'; }
        return 'LIB_E_UNKNOWN';
    }

    function normAbs(p) {
        return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
    }

    function splitRel(rel) {
        return String(rel || '').split('/').filter(Boolean);
    }

    function dbReady() {
        return typeof root.VRDB !== 'undefined' && root.VRDB && typeof root.VRDB.putFiles === 'function';
    }

    function getSettings() {
        return new Promise(function (resolve) {
            try {
                chrome.storage.local.get('vrLibSettings', function (o) {
                    resolve((o && o.vrLibSettings) || {});
                });
            } catch (e) { resolve({}); }
        });
    }

    function absRootFromSettings(st) {
        st = st || {};
        var isCustom = (st.mode || 'system') === 'custom';
        var custom = isCustom ? normAbs(st.customRoot) : '';
        /* 自选文件夹的路径可能拿不到（FSA 只给句柄）。这时 absRoot 就是空，
         * 不能回退到系统下载目录——那会把 handle 里的文件指到错误路径。 */
        if (isCustom) { return custom; }
        var base = normAbs(st.detectedRoot);
        if (!base) { return ''; }
        return base + '/' + String(st.subdir || 'video-rod').replace(/^\/+|\/+$/g, '');
    }

    function stamp() {
        var d = new Date();
        var m = ('0' + (d.getMonth() + 1)).slice(-2);
        var day = ('0' + d.getDate()).slice(-2);
        return '' + d.getFullYear() + m + day;
    }

    function skipName(name) {
        if (!name) { return true; }
        if (name.charAt(0) === '.') { return true; }
        if (name.charAt(0) === '~' && name.charAt(1) === '$') { return true; }
        if (SKIP_DIRS[name]) { return true; }
        if (SKIP_SUFFIX.test(name)) { return true; }
        return false;
    }

    function skipRel(rel) {
        var segs = splitRel(rel);
        if (!segs.length) { return true; }
        for (var i = 0; i < segs.length; i++) {
            if (skipName(segs[i])) { return true; }
        }
        return false;
    }

    function relFromAbs(abs, absRoot) {
        var a = normAbs(abs);
        var r = normAbs(absRoot);
        if (!a || !r) { return ''; }
        if (a.indexOf(r + '/') === 0) { return a.slice(r.length + 1); }
        return '';
    }

    /** 去掉索引 key 的首段（subdir），得到相对资源库根的路径 */
    function stripPrefix(rel, prefix) {
        var p = prefix ? (prefix + '/') : '';
        if (p && rel.indexOf(p) === 0) { return rel.slice(p.length); }
        return rel;
    }

    /* ---------------- 根解析 ---------------- */

    /** settings.js 的旧授权库（独立 IDB：vr-lib-handle → kv.root） */
    function legacyHandle() {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('vr-lib-handle', 1);
                req.onupgradeneeded = function () {
                    var db = req.result;
                    if (!db.objectStoreNames.contains('kv')) { db.createObjectStore('kv'); }
                };
                req.onsuccess = function () {
                    var db = req.result;
                    try {
                        var g = db.transaction('kv', 'readonly').objectStore('kv').get('root');
                        g.onsuccess = function () { resolve(g.result || null); };
                        g.onerror = function () { resolve(null); };
                    } catch (e) { resolve(null); }
                };
                req.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }

    /**
     * 根解析三档：内存 → VRDB handle/rootAbs → 旧授权库（仅 custom）
     * 约定：handle 指向「资源库根」（A 模式 = 下载目录/subdir；B 模式 = customRoot），
     *       索引 key 首段固定为 subdir（A 为真实目录，B 为虚拟前缀，与 §13.10 迁移口径一致）。
     */
    async function resolveRoot() {
        var st = await getSettings();
        var handle = memHandle || null;
        var absRoot = memRoot;
        var prefix = memPrefix || '';
        var source = (memHandle || memRoot) ? 'memory' : 'settings';

        if (!absRoot && dbReady() && typeof root.VRDB.getSetting === 'function') {
            try { absRoot = normAbs(await root.VRDB.getSetting('rootAbs', '')); } catch (e) { /* 忽略 */ }
        }
        if (!prefix && dbReady() && typeof root.VRDB.getSetting === 'function') {
            try { prefix = String(await root.VRDB.getSetting('rootPrefix', '') || ''); } catch (e) { /* 忽略 */ }
        }
        if (!absRoot) { absRoot = absRootFromSettings(st); }
        if (!prefix) { prefix = String(st.subdir || 'video-rod').replace(/^\/+|\/+$/g, ''); }

        if (!handle && dbReady() && typeof root.VRDB.getHandle === 'function') {
            try {
                handle = await root.VRDB.getHandle('root');
                if (handle) { source = 'db'; }
            } catch (e) { /* 忽略 */ }
        }
        // 旧授权库只在 custom 模式复用：settings.js 只在「自定义目录」按钮里写句柄
        if (!handle && st.mode === 'custom') {
            var lh = await legacyHandle();
            if (lh) { handle = lh; source = 'legacy'; }
        }
        return { handle: handle, absRoot: absRoot, prefix: prefix, source: source };
    }

    /** 存根句柄 + 绝对路径 + 索引首段；handle 传 null 表示只记路径 */
    async function setRoot(handle, absRoot, prefix) {
        memHandle = handle || null;
        if (absRoot !== undefined) { memRoot = normAbs(absRoot); }
        if (prefix !== undefined) { memPrefix = String(prefix || '').replace(/^\/+|\/+$/g, ''); }
        if (dbReady()) {
            try {
                if (typeof root.VRDB.setHandle === 'function') { await root.VRDB.setHandle('root', memHandle); }
                if (absRoot !== undefined && memRoot && typeof root.VRDB.setSetting === 'function') {
                    await root.VRDB.setSetting('rootAbs', memRoot);
                }
                /* 自选文件夹可能没有绝对路径：显式清掉旧 rootAbs，别让上一次的位置
                 * 污染本次索引（absPath 会全部指到错目录）。 */
                if (absRoot !== undefined && !memRoot && typeof root.VRDB.setSetting === 'function') {
                    await root.VRDB.setSetting('rootAbs', '');
                }
                if (memPrefix && typeof root.VRDB.setSetting === 'function') {
                    await root.VRDB.setSetting('rootPrefix', memPrefix);
                }
            } catch (e) { /* 内存可用即可，落库失败不阻断本次 */ }
        }
        return { absRoot: memRoot, prefix: memPrefix };
    }

    async function ensureRead(handle) {
        if (!handle || typeof handle.queryPermission !== 'function') { return true; }
        var st;
        try { st = await handle.queryPermission({ mode: 'read' }); } catch (e) { return true; }
        if (st === 'granted') { return true; }
        try { st = await handle.requestPermission({ mode: 'read' }); } catch (e) { st = 'denied'; }
        if (st !== 'granted') { throw makeErr('LIB_E_AUTH_LOST', '目录授权已失效，请重新授权'); }
        return true;
    }

    /* ---------------- 条目映射 ---------------- */

    function entryFromRel(relPath, absPath, size, mtime) {
        var parsed = {};
        try { parsed = (root.VRPath && root.VRPath.parseRelPath(relPath)) || {}; } catch (e) { parsed = {}; }
        var fileName = parsed.fileName || splitRel(relPath).pop() || '';
        return {
            relPath: relPath,
            absPath: absPath ? normAbs(absPath) : '',
            platform: parsed.platform || '',
            platformName: parsed.platformName || '',
            creatorFull: parsed.creatorFull || '',
            creatorId: parsed.creatorId || '',
            type: parsed.type || (root.VRPath ? root.VRPath.typeOf({ fileName: fileName }) : ''),
            fileName: fileName,
            size: size || 0,
            mtime: mtime || 0,
            mime: '',
            sourceUrl: '',
            downloadId: null,
            starred: 0,
            tags: [],
            state: 'ok',
            /* 1 = 从文件系统扫到、但认不出平台/来源；资源库左栏单独归到「未整理」。
             * 下载/快照来源会按平台重新计算，不由旧值继承。 */
            untracked: 0
        };
    }

    function platformNameOf(p) {
        if (!p) { return ''; }
        try {
            return (root.VRPath && root.VRPath.PLATFORM_DIR && root.VRPath.PLATFORM_DIR[p]) || p;
        } catch (e) { return p; }
    }

    function baseName(p) {
        return String(p || '').replace(/\\/g, '/').split('/').pop() || '';
    }

    function dlKey(name, size) {
        return String(name || '').toLowerCase() + '|' + (Number(size) || 0);
    }

    /** 全量扫描时用下载记录补元数据：先按绝对路径，再按「文件名+大小」兜底 */
    function matchDownload(idx, absPath, name, size) {
        if (!idx) { return null; }
        if (absPath) {
            var byPath = idx.byPath[normAbs(absPath)];
            if (byPath) { return byPath; }
        }
        return idx.byKey[dlKey(name, size)] || null;
    }

    async function buildDownloadIndex() {
        var list;
        try {
            list = await searchDownloads({ limit: DL_LIMIT, orderBy: ['-startTime'] });
        } catch (e) {
            return null;
        }
        var byPath = {}, byKey = {};
        list.forEach(function (d) {
            if (!d || d.state !== 'complete' || !d.filename) { return; }
            var p = normAbs(d.filename);
            byPath[p] = d;
            var k = dlKey(baseName(p), d.fileSize || d.totalBytes || 0);
            if (!byKey[k]) { byKey[k] = d; }
        });
        return { byPath: byPath, byKey: byKey };
    }

    function entryFromDownload(d, relPath) {
        var item = entryFromRel(relPath, d.filename, d.fileSize || d.totalBytes || 0,
            (d.endTime && Date.parse(d.endTime)) || (d.startTime && Date.parse(d.startTime)) || Date.now());
        item.mime = d.mime || '';
        item.sourceUrl = d.url || d.finalUrl || '';
        item.downloadId = d.id;
        // 绝对路径：缩略图/指纹都要靠它读文件（2026-11-05：漏了这个字段，
        // 结果库里所有缩略图都是灰块，因为 thumbs.js 拿 entry.absPath 去 fetch）
        item.absPath = d.filename || '';
        item.untracked = 0;
        return item;
    }

    /** 重建时保住用户数据（ADR-030） */
    function mergeEntry(old, item) {
        var out = Object.assign({}, item);
        if (!old) { return out; }
        out.starred = old.starred || 0;
        out.tags = Array.isArray(old.tags) ? old.tags : [];
        /* R2：重命名只改 displayName。重建索引时若不保留，
         * 用户改的名字会在下一次扫描后静默回退。 */
        if (old.displayName) { out.displayName = old.displayName; }
        if (old.thumbKey) { out.thumbKey = old.thumbKey; }
        ['width', 'height', 'duration'].forEach(function (k) {
            if (old[k]) { out[k] = old[k]; }
        });
        if (!out.title && old.title) { out.title = old.title; }
        if (!out.platform && old.platform) { out.platform = old.platform; }
        if (!out.platformName && old.platformName) { out.platformName = old.platformName; }
        if (!out.creatorFull && old.creatorFull) { out.creatorFull = old.creatorFull; }
        if (!out.creatorId && old.creatorId) { out.creatorId = old.creatorId; }
        if (!out.type && old.type) { out.type = old.type; }
        if (!out.mime && old.mime) { out.mime = old.mime; }
        if (!out.sourceUrl && old.sourceUrl) { out.sourceUrl = old.sourceUrl; }
        if (!out.absPath && old.absPath) { out.absPath = old.absPath; }
        /* F2 溯源：重建索引时保住「原帖/直链/作者ID/作品ID」，
           否则重建一次索引，来源就全变「未记录」了（ADR-052 铁律） */
        ['pageUrl', 'mediaUrl', 'authorUid', 'authorHandle', 'authorState', 'workId', 'dlAt'].forEach(function (k) {
            if (!out[k] && old[k]) { out[k] = old[k]; }
        });
        if (out.downloadId === null && old.downloadId !== undefined) { out.downloadId = old.downloadId; }
        out.state = 'ok';
        /* 未整理状态每次扫描重新计算：下载/快照源带平台，文件系统源认不出才置 1。
         * 置 1 时清掉旧平台，避免旧值把未整理条目又塞回某个平台。 */
        out.untracked = item.untracked ? 1 : 0;
        if (out.untracked) {
            out.platform = '';
            out.platformName = '';
            out.creatorFull = '';
            out.creatorId = '';
        }
        return out;
    }

    /* ---------------- 源一：downloads ---------------- */

    function searchDownloads(query) {
        return new Promise(function (resolve, reject) {
            try {
                chrome.downloads.search(query, function (list) {
                    var le = chrome.runtime.lastError;
                    if (le) { reject(makeErr('LIB_E_SW_DOWN', String(le.message || le))); return; }
                    resolve(list || []);
                });
            } catch (e) { reject(e); }
        });
    }

    async function scanDownloads(absRoot, prefix, onProgress) {
        var list = await searchDownloads({ limit: DL_LIMIT, orderBy: ['-startTime'] });
        var out = [];
        out.truncated = list.length >= DL_LIMIT;
        for (var i = 0; i < list.length; i++) {
            var d = list[i];
            if (!d || d.state !== 'complete' || !d.filename) { continue; }
            // 幽灵条目过滤：下载记录还在、文件已被删/移走的话，别把空壳塞进库
            // （2026-11-05：测试残留让资源库显示一堆点开是空的条目）
            if (d.exists === false) { continue; }
            var relFromRoot = relFromAbs(d.filename, absRoot);
            if (!relFromRoot || skipRel(relFromRoot)) { continue; }
            if (root.VRPath && root.VRPath.typeOf({ fileName: relFromRoot }) === 'other') { continue; }
            var relPath = prefix ? (prefix + '/' + relFromRoot) : relFromRoot;
            out.push(entryFromDownload(d, relPath));
            if (onProgress && i % 50 === 0) {
                onProgress({ phase: 'downloads', done: i + 1, total: list.length });
            }
        }
        return out;
    }

    /* ---------------- 源二：快照 ---------------- */

    async function latestSnapshot(handle) {
        var dir;
        try {
            dir = await handle.getDirectoryHandle(SNAP_DIR);
        } catch (e) {
            throw makeErr('LIB_E_NO_SNAPSHOT', '没有找到 _library 快照目录');
        }
        var names = [];
        for await (var entry of dir.entries()) {
            if (entry[1].kind === 'file' && SNAP_RE.test(entry[0])) { names.push(entry[0]); }
        }
        if (!names.length) { throw makeErr('LIB_E_NO_SNAPSHOT', '没有可用快照'); }
        names.sort().reverse();

        var parseErr = null;
        for (var i = 0; i < names.length; i++) {
            try {
                var f = await (await dir.getFileHandle(names[i])).getFile();
                var json = JSON.parse(await f.text());
                if (!json || !Array.isArray(json.files)) { throw new Error('缺少 files 数组'); }
                return { name: names[i], json: json };
            } catch (e) { parseErr = e; }
        }
        throw makeErr('LIB_E_SNAPSHOT_PARSE', '快照损坏：' + (parseErr && parseErr.message));
    }

    async function scanSnapshot(handle, absRoot, prefix, onProgress) {
        var snap = await latestSnapshot(handle);
        var files = snap.json.files || [];
        var out = [];
        var pfx = prefix ? (prefix + '/') : '';
        for (var i = 0; i < files.length; i++) {
            var f = files[i] || {};
            var relPath = String(f.relPath || '').replace(/\\/g, '/');
            if (!relPath || skipRel(relPath) || splitRel(relPath).indexOf('..') !== -1) { continue; }
            var relFromRoot = (pfx && relPath.indexOf(pfx) === 0) ? relPath.slice(pfx.length) : relPath;
            var item = entryFromRel(relPath, (absRoot ? absRoot + '/' + relFromRoot : ''), f.size, f.mtime);
            if (f.platform) { item.platform = f.platform; item.platformName = platformNameOf(f.platform); }
            if (f.creatorId) { item.creatorId = f.creatorId; }
            if (f.type) { item.type = f.type; }
            if (f.fileName) { item.fileName = f.fileName; }
            item.starred = f.starred ? 1 : 0;
            item.tags = Array.isArray(f.tags) ? f.tags : [];
            item.untracked = item.platform ? 0 : 1;
            out.push(item);
            if (onProgress && i % 100 === 0) {
                onProgress({ phase: 'snapshot', done: i + 1, total: files.length });
            }
        }
        return out;
    }

    /* ---------------- 源三：全量扫描 ---------------- */

    async function walk(dir, prefix, out, depth) {
        if (out.length >= MAX_ITEMS || depth > MAX_DEPTH) { return; }
        var entries = [];
        for await (var e of dir.entries()) {
            entries.push(e);
            if (entries.length > MAX_ITEMS) { break; }
        }
        for (var i = 0; i < entries.length; i++) {
            if (out.length >= MAX_ITEMS) { return; }
            var name = entries[i][0];
            var h = entries[i][1];
            if (skipName(name)) { continue; }
            var rel = prefix ? prefix + '/' + name : name;
            if (h.kind === 'file') {
                if (root.VRPath && root.VRPath.typeOf({ fileName: name }) === 'other') { continue; }
                var f = await h.getFile();
                out.push({ rel: rel, name: name, size: f.size, mtime: f.lastModified });
            } else {
                await walk(h, rel, out, depth + 1);
            }
        }
    }

    async function scanFull(handle, absRoot, prefix, dlIdx, onProgress) {
        var raw = [];
        await walk(handle, '', raw, 0);
        var out = [];
        for (var i = 0; i < raw.length; i++) {
            var relFromRoot = raw[i].rel;
            if (skipRel(relFromRoot)) { continue; }
            var relPath = prefix ? (prefix + '/' + relFromRoot) : relFromRoot;
            var absPath = absRoot ? (absRoot + '/' + relFromRoot) : '';
            var item = entryFromRel(relPath, absPath, raw[i].size, raw[i].mtime);
            /* 「自选文件夹」里的历史素材：能从下载记录对上就补回来源；
             * 认不出平台/来源的，交给资源库的「未整理」入口。 */
            var d = matchDownload(dlIdx, absPath, raw[i].name, raw[i].size);
            if (d) {
                item.mime = d.mime || '';
                item.sourceUrl = d.url || d.finalUrl || '';
                item.downloadId = d.id;
                if (!item.absPath && d.filename) { item.absPath = d.filename; }
                var plat = '';
                try { plat = root.VRPath ? root.VRPath.detectPlatform(d.referrer || d.finalUrl || d.url || '') : ''; } catch (e2) { plat = ''; }
                if (plat && (plat !== 'web' || !item.platform)) {
                    item.platform = plat;
                    item.platformName = platformNameOf(plat);
                }
            }
            item.untracked = item.platform ? 0 : 1;
            if (item.untracked) { item.platformName = ''; }
            out.push(item);
            if (onProgress && i % 50 === 0) {
                onProgress({ phase: 'full', done: i + 1, total: raw.length });
            }
        }
        return out;
    }

    /* ---------------- 建索引 ---------------- */

    async function build(opts) {
        opts = opts || {};
        var mode = opts.mode || 'downloads';
        var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
        if (!dbReady()) { throw makeErr('LIB_E_DB', 'VRDB 未加载'); }

        var rr = await resolveRoot();
        var absRoot = rr.absRoot;
        var oldFiles = await root.VRDB.getAllFiles();
        var oldMap = {};
        oldFiles.forEach(function (f) { if (f && f.relPath) { oldMap[f.relPath] = f; } });

        var scanned;
        if (mode === 'downloads') {
            if (!absRoot) { throw makeErr('LIB_E_NO_PERM', '缺少资源库根目录（先点「校验落盘」）'); }
            scanned = await scanDownloads(absRoot, rr.prefix, onProgress);
        } else if (mode === 'snapshot') {
            if (!rr.handle) { throw makeErr('LIB_E_NO_PERM', '需要一次目录授权才能读快照'); }
            if (!absRoot) { throw makeErr('LIB_E_NO_PERM', '缺少资源库根目录（先点「校验落盘」）'); }
            await ensureRead(rr.handle);
            scanned = await scanSnapshot(rr.handle, absRoot, rr.prefix, onProgress);
        } else if (mode === 'full') {
            if (!rr.handle) { throw makeErr('LIB_E_NO_PERM', '需要一次目录授权才能全量扫描'); }
            await ensureRead(rr.handle);
            /* 自选文件夹可能拿不到绝对路径（FSA 不给路径），handle 本身就是根；
             * 此时 absPath 留空，由 VRFile 用句柄读文件生成预览。 */
            var dlIdx = await buildDownloadIndex();
            scanned = await scanFull(rr.handle, absRoot, rr.prefix, dlIdx, onProgress);
        } else {
            throw makeErr('LIB_E_UNKNOWN', '未知索引模式：' + mode);
        }

        onProgress({ phase: 'merge', done: 0, total: scanned.length });

        var seen = {};
        var out = [];
        scanned.forEach(function (it) {
            if (!it || !it.relPath) { return; }
            seen[it.relPath] = 1;
            out.push(mergeEntry(oldMap[it.relPath], it));
        });

        // 全量源扫不到的旧条目：标 missing，不删除（ADR-030）
        var missing = 0;
        if (mode !== 'downloads' && opts.markMissing !== false) {
            oldFiles.forEach(function (f) {
                if (!f || !f.relPath || seen[f.relPath]) { return; }
                missing++;
                if (f.state === 'missing') { return; }
                out.push(Object.assign({}, f, { state: 'missing' }));
            });
        }

        if (out.length) { await root.VRDB.putFiles(out); }
        if (typeof root.VRDB.log === 'function') {
            try {
                await root.VRDB.log('index.build', { mode: mode },
                    { total: scanned.length, missing: missing });
            } catch (e) { /* 日志失败不影响索引 */ }
        }
        return {
            total: scanned.length,
            ok: scanned.length,
            missing: missing,
            mode: mode,
            truncated: !!scanned.truncated
        };
    }

    /* ---------------- 物理存在性校对 ---------------- */

    async function fileExists(handle, rel) {
        var segs = splitRel(rel);
        if (!segs.length || segs.indexOf('..') !== -1) { return false; }
        var name = segs.pop();
        var dir = handle;
        for (var i = 0; i < segs.length; i++) {
            try { dir = await dir.getDirectoryHandle(segs[i]); } catch (e) { return false; }
        }
        try { await dir.getFileHandle(name); return true; } catch (e) { return false; }
    }

    async function reconcile() {
        if (!dbReady()) { throw makeErr('LIB_E_DB', 'VRDB 未加载'); }
        var files = await root.VRDB.getAllFiles();
        var rr = await resolveRoot();

        var byId = {};
        try {
            var recent = await searchDownloads({ limit: DL_LIMIT, orderBy: ['-startTime'] });
            recent.forEach(function (d) { byId[d.id] = d; });
        } catch (e) { /* 没有下载权限/接口时退到 FSA */ }

        var missing = [];
        var patches = [];
        var checked = 0;
        var unknown = 0;

        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (!f || !f.relPath) { continue; }
            var state = null;
            var d = (f.downloadId !== undefined && f.downloadId !== null) ? byId[f.downloadId] : null;
            if (d) {
                state = (d.exists === false) ? 'missing' : 'ok';
            } else if (rr.handle) {
                state = (await fileExists(rr.handle, stripPrefix(f.relPath, rr.prefix))) ? 'ok' : 'missing';
            }
            if (!state) { unknown++; continue; }
            checked++;
            if (state === 'missing') { missing.push(f.relPath); }
            if ((f.state || 'ok') !== state) {
                patches.push({ relPath: f.relPath, state: state });
            }
        }

        if (patches.length) {
            var list = [];
            for (var j = 0; j < patches.length; j++) {
                var cur = await root.VRDB.getFile(patches[j].relPath);
                if (!cur) { continue; }
                cur.state = patches[j].state;
                list.push(cur);
            }
            if (list.length) { await root.VRDB.putFiles(list); }
        }
        return { missing: missing, checked: checked, unknown: unknown };
    }

    /* ---------------- 快照 ---------------- */

    async function pruneSnapshots(dir) {
        var names = [];
        for await (var entry of dir.entries()) {
            if (entry[1].kind === 'file' && SNAP_RE.test(entry[0])) { names.push(entry[0]); }
        }
        names.sort().reverse();
        for (var i = KEEP_SNAPSHOTS; i < names.length; i++) {
            try { await dir.removeEntry(names[i]); } catch (e) { /* 清不掉不影响本次 */ }
        }
    }

    async function snapshot() {
        if (!dbReady()) { throw makeErr('LIB_E_DB', 'VRDB 未加载'); }
        var rr = await resolveRoot();
        if (!rr.handle) { throw makeErr('LIB_E_NO_PERM', '需要一次目录授权才能写快照'); }
        if (!rr.absRoot) { throw makeErr('LIB_E_NO_PERM', '缺少资源库根目录（先点「校验落盘」）'); }
        await ensureRead(rr.handle);

        var files = await root.VRDB.getAllFiles();
        var payload = {
            version: 1,
            at: Date.now(),
            root: rr.absRoot,
            subdir: rr.prefix,
            count: files.length,
            files: files.map(function (f) {
                return {
                    relPath: f.relPath,
                    size: f.size || 0,
                    mtime: f.mtime || 0,
                    platform: f.platform || '',
                    creatorId: f.creatorId || '',
                    type: f.type || '',
                    fileName: f.fileName || '',
                    starred: f.starred || 0,
                    tags: Array.isArray(f.tags) ? f.tags : []
                };
            })
        };

        var dir = await rr.handle.getDirectoryHandle(SNAP_DIR, { create: true });
        var name = 'index-' + stamp() + '.json';
        var fh = await dir.getFileHandle(name, { create: true });
        var w = await fh.createWritable();
        try {
            await w.write(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
            await w.close();
        } catch (e) {
            try { await w.abort(); } catch (e2) { /* 忽略 */ }
            try { await dir.removeEntry(name); } catch (e3) { /* 忽略 */ }
            throw e;
        }
        await pruneSnapshots(dir);
        try { await root.VRDB.setSetting('snapshotAt', payload.at); } catch (e) { /* 忽略 */ }

        return rr.absRoot + '/' + SNAP_DIR + '/' + name;
    }

    /* ---------------- 状态 ---------------- */

    async function status() {
        var files = dbReady() ? await root.VRDB.getAllFiles() : [];
        var rr = await resolveRoot();
        var snapAt = 0;
        if (dbReady()) {
            try { snapAt = await root.VRDB.getSetting('snapshotAt', 0); } catch (e) { /* 忽略 */ }
        }
        return {
            count: files.length,
            missing: files.filter(function (f) { return f && f.state === 'missing'; }).length,
            hasRoot: !!rr.handle,
            absRoot: rr.absRoot,
            prefix: rr.prefix,
            source: rr.source,
            snapshotAt: snapAt || 0
        };
    }

    root.VRIndex = {
        SNAP_DIR: SNAP_DIR,
        build: build,
        reconcile: reconcile,
        snapshot: snapshot,
        setRoot: setRoot,
        resolveRoot: resolveRoot,
        status: status,
        errCode: errCode,
        // 测试用：只清内存，不动已落库的句柄
        _resetRoot: function () { memHandle = null; memRoot = ''; memPrefix = ''; },
        _skipRel: skipRel
    };
})(typeof self !== 'undefined' ? self : this);
