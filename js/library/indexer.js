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
    /* 固定名快照：给「先读索引出画面」与「重装后路径自恢复」用。
     * 注意 SNAP_RE 不匹配它（无日期段），所以定期清理/取最新都不会误伤。 */
    var FIXED_SNAP = 'index.json';
    var KEEP_SNAPSHOTS = 7;
    /* 上限统一收到 LIMITS（原本散在 MAX_ITEMS/MAX_DEPTH 里，
     * 超限时静默 return，用户完全不知道少扫了东西）。 */
    var DL_LIMIT = 5000;

    var SKIP_DIRS = { '_verify': 1, '_回收站': 1, '_library': 1, '_migration': 1, '_selftest': 1 };
    var SKIP_SUFFIX = /\.(part|crdownload|tmp)$/i;

    var memHandle = null;
    var memRoot = '';
    var memPrefix = '';

    /* 快照写入串行化（红队 a-5）。
     * 同一页面里多个 tab / 多次连续入库可能同时触发 snapshot()，
     * 并发 createWritable 同一文件会互相截断。用队列保证「一次只写一份」。 */
    var snapQueue = Promise.resolve();

    function serializeSnapshot(fn) {
        var run = snapQueue.then(function () { return fn(); },
            function () { return fn(); });   /* 上一次失败也要继续跑下一次 */
        /* 队列本身吞掉异常，避免一次失败导致后续全部不执行；
         * 单次调用的异常仍通过返回的 promise 抛给调用方。 */
        snapQueue = run.then(function () { return null; }, function () { return null; });
        return run;
    }

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
        /* 旧版本可能把浏览器 profile 内部目录（…\User Data\… / …\.edge-xxx\…）
         * 或受管默认名（Webstore Downloads）当成下载根并持久化。
         * 那不是用户的下载位置，直接当没有——宁可不索引，也不要指错目录。 */
        if (!isPlausibleDownloadRoot(base)) { return ''; }
        return base + '/' + String(st.subdir || 'video-rod').replace(/^\/+|\/+$/g, '');
    }

    /** 判据与 app.js 的 isPlausibleRoot 同口径：只拦明显不该是下载根的值 */
    function isPlausibleDownloadRoot(p) {
        var s = String(p || '').replace(/\\/g, '/');
        if (!s) { return false; }
        if (!/^([A-Za-z]:\/|\/\/|\/)/.test(s)) { return false; }
        if (/\/(User Data|\.edge-[^/]+|Default)\//i.test(s + '/')) { return false; }
        if (/Webstore Downloads/i.test(s)) { return false; }
        return true;
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

    /** 根句柄（2026-11-10 存储梳理）：统一走 VRHandleStore，
     *  它内部会先读主库 vr-library/handle，并自动完成旧库 vr-lib-handle 的一次性搬迁。 */
    function legacyHandle() {
        var HS = root.VRHandleStore;
        if (!HS) { return Promise.resolve(null); }
        return HS.get('root').catch(function () { return null; });
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

        /* 兜底：设置里没有任何路径时（典型场景＝重装系统后 chrome.storage 被清空），
         * 用磁盘快照里记录的 root 自恢复（红队 a-2）。
         * 原实现只写不读 payload.root，导致这份数据白存。 */
        if (!absRoot && handle && dbReady()) {
            try {
                var snap = await latestSnapshot(handle);
                if (snap && snap.json && snap.json.root) {
                    absRoot = normAbs(snap.json.root);
                    if (!memPrefix && snap.json.subdir) {
                        prefix = String(snap.json.subdir).replace(/^\/+|\/+$/g, '');
                    }
                    source = 'snapshot';
                }
            } catch (e) { /* 没有快照/读不到就维持空，由上层提示授权 */ }
        }

        if (!handle && dbReady() && typeof root.VRDB.getHandle === 'function') {
            try {
                handle = await root.VRDB.getHandle('root');
                if (handle) { source = 'db'; }
            } catch (e) { /* 忽略 */ }
        }
        /* 句柄必须真的指向当前库根。历史上出现过句柄名是 download、
         * absRoot 却是 …/video-rod 的情况：恢复权限后所有写操作都会落到错目录。
         * 名字不符就丢弃并清掉 DB 句柄，让用户重新授权，而不是「恢复」一个错句柄。 */
        var expectedHandleName = '';
        if (String(st.mode || 'system') === 'custom') {
            if (absRoot) { expectedHandleName = absRoot.split('/').pop(); }
        } else {
            expectedHandleName = String(prefix || st.subdir || 'video-rod').replace(/^\/+|\/+$/g, '');
        }
        if (handle && expectedHandleName && handle.name !== expectedHandleName) {
            if (source === 'db' && dbReady() && typeof root.VRDB.setHandle === 'function') {
                try { await root.VRDB.setHandle('root', null); } catch (e) { /* 忽略 */ }
            }
            if (source === 'memory') { memHandle = null; }
            handle = null;
            source = '';
        }
        /* 旧授权库（vr-lib-handle）也复用：
         * 之前「选择文件夹并授权」只写这里，system 模式完全读不到 → 用户明明选过目录，
         * 库页仍提示只读。system 模式只接受名字与当前子目录一致的句柄，避免旧句柄指错目录。 */
        if (!handle) {
            var lh = await legacyHandle();
            if (lh) {
                var expected = String(expectedHandleName || prefix || '').replace(/^\/+|\/+$/g, '');
                if (!expected || lh.name === expected) {
                    handle = lh;
                    source = 'legacy';
                }
            }
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

    /* ==========================================================
     * 持久化：纯逻辑（Node 可测）
     *
     * 这一组函数刻意不碰 FSA / IDB，只做「数据 → 数据结构」的变换，
     * 这样 tools/test-persistence.js 能在 Node 里把字段完整性钉死。
     * 一旦这里写错，用户重装后就是**静默数据丢失**，所以必须可测。
     * ========================================================== */

    /** 扫描/保存上限（可被 build() 的 opts 覆盖） */
    var LIMITS = {
        MAX_ITEMS: 100000,   /* 原 20000：用户库已上万条，2 万会静默截断 */
        MAX_DEPTH: 12,       /* 原 8：深层「站点/博主/作品/类型」四段很常见 */
        DL_LIMIT: 5000
    };

    /**
     * 构造快照 payload。
     *
     * 只写「换机器仍有效」的字段：
     *   · 不写 absPath（换盘符就错）
     *   · 不写 downloadId（换机器无意义）
     *   · 不写 state（每次扫描重算）
     *
     * @param {Array} files  VRDB 里的条目
     * @param {Array} favorites 收藏夹数组（setting.vrFavs）
     * @param {object} meta { root, prefix }
     * @returns {object} 可直接 JSON.stringify 的 payload
     */
    function snapshotPayload(files, favorites, meta) {
        var m = meta || {};
        /* 2026-11-09：回收站条目（state='trashed'）不写进快照。
         * 快照的用途是「换浏览器/重装后凭它把库恢复出来」，
         * 而 trashed 条目的文件已经搬进 _回收站，写进去只会让新浏览器里
         * 凭空多出一批点开就空的卡片（跨浏览器也没有回收站 UI 去处理它们）。 */
        var list = (Array.isArray(files) ? files : []).filter(function (f) {
            return f && f.relPath && f.state !== 'trashed';
        });
        var out = {
            schema: 2,
            version: 1,
            at: Date.now(),
            root: m.root ? normAbs(m.root) : '',
            subdir: String(m.prefix || ''),
            count: list.length,
            favorites: Array.isArray(favorites) ? favorites : [],
            files: list.map(function (f) {
                var row = {
                    relPath: String(f.relPath || ''),
                    size: Number(f.size) || 0,
                    mtime: Number(f.mtime) || 0,
                    platform: f.platform || '',
                    creatorId: f.creatorId || '',
                    type: f.type || '',
                    fileName: f.fileName || '',
                    starred: f.starred ? 1 : 0,
                    tags: Array.isArray(f.tags) ? f.tags : []
                };
                /* 新增字段：有值才写，避免把 undefined/null 塞进 JSON
                 * （读回时无法区分「没这个字段」和「值为空」） */
                if (f.displayName) { row.displayName = String(f.displayName); }
                if (f.width) { row.width = Number(f.width) || 0; }
                if (f.height) { row.height = Number(f.height) || 0; }
                if (f.duration != null) { row.duration = Number(f.duration) || 0; }
                if (f.mime) { row.mime = String(f.mime); }
                if (f.sourceUrl) { row.sourceUrl = String(f.sourceUrl); }
                if (f.mediaUrl) { row.mediaUrl = String(f.mediaUrl); }
                if (f.pageUrl) { row.pageUrl = String(f.pageUrl); }
                if (f.creatorFull) { row.creatorFull = String(f.creatorFull); }
                if (f.title) { row.title = String(f.title); }
                if (f.thumbFile) { row.thumbFile = String(f.thumbFile); }
                if (f.thumbSrc && f.thumbSrc.mtime != null && f.thumbSrc.size != null) {
                    row.thumbSrc = { mtime: Number(f.thumbSrc.mtime), size: Number(f.thumbSrc.size) };
                }
                return row;
            })
        };
        return out;
    }

    /**
     * 从快照恢复资源库根路径。
     *
     * 为什么必须做这件事（红队 a-2）：
     *   payload.root 从第一版就在写，但**全仓库没有任何代码读它**。
     *   于是重装后路径只能依赖 chrome.storage.detectedRoot，
     *   而那份数据同样会被清掉 —— 快照里的 root 白存了。
     *
     * 优先级：设置里的明确配置 > 快照记录的 root。
     * custom 模式以 customRoot 为准（那是用户显式选的，不能被旧快照盖掉）。
     *
     * @param {object} snap 快照 json（至少含 root / subdir）
     * @param {object} st   vrLibSettings
     * @returns {string} 绝对路径；无法确定时返回 ''
     */
    function absRootFromSnapshot(snap, st) {
        var s = st || {};
        var isCustom = (s.mode || 'system') === 'custom';
        if (isCustom) {
            return normAbs(s.customRoot) || '';
        }
        var base = normAbs(s.detectedRoot);
        if (base) {
            return base + '/' + String(s.subdir || 'video-rod').replace(/^\/+|\/+$/g, '');
        }
        /* 关键回退：设置空了（典型场景＝重装系统），用快照里记的 root */
        var fromSnap = normAbs((snap && snap.root) || '');
        return fromSnap;
    }

    /**
     * 遍历目录树，**带截断上报**。
     *
     * 为什么重写 walk()（红队 c-1/c-2）：
     *   原实现在超限/超深时直接 return，调用方拿到的是「恰好 MAX_ITEMS 条」的
     *   假数据，用户以为素材丢了却毫无提示。
     *   这里返回 {items, scanned, truncated, skipped, depthLimited}，
     *   让上层能明确告诉用户「还有多少没扫」。
     *
     * @param {FileSystemDirectoryHandle} dir
     * @param {object} opts { maxItems, maxDepth }
     * @returns {Promise<object>} 见上
     */
    async function collectTree(dir, opts) {
        var o = opts || {};
        var maxItems = Number(o.maxItems) || LIMITS.MAX_ITEMS;
        var maxDepth = Number(o.maxDepth) || LIMITS.MAX_DEPTH;

        var items = [];
        var scanned = 0;
        var truncated = false;
        var skipped = 0;
        var depthLimited = false;

        async function walk(node, prefix, depth) {
            if (depth > maxDepth) {
                depthLimited = true;
                return;
            }
            var entries = [];
            for await (var e of node.entries()) {
                entries.push(e);
            }
            for (var i = 0; i < entries.length; i++) {
                var name = entries[i][0];
                var h = entries[i][1];
                if (skipName(name)) { continue; }
                var rel = prefix ? prefix + '/' + name : name;
                if (h.kind === 'file') {
                    if (root.VRPath && root.VRPath.typeOf({ fileName: name }) === 'other') { continue; }
                    scanned++;
                    if (items.length >= maxItems) {
                        truncated = true;
                        skipped++;
                        continue;      /* 继续数，才知道到底少了多少 */
                    }
                    items.push({ rel: rel, name: name, handle: h });
                } else {
                    await walk(h, rel, depth + 1);
                }
            }
        }

        await walk(dir, '', 0);

        return {
            items: items,
            scanned: scanned,
            truncated: truncated,
            skipped: skipped,
            truncatedReason: truncated ? 'LIB_E_TRUNCATED' : '',
            depthLimited: depthLimited,
            depthReason: depthLimited ? 'LIB_E_DEPTH' : ''
        };
    }

    function entryFromRel(relPath, absPath, size, mtime) {
        var parsed = {};
        try { parsed = (root.VRPath && root.VRPath.parseRelPath(relPath)) || {}; } catch (e) { parsed = {}; }
        var fileName = parsed.fileName || splitRel(relPath).pop() || '';
        /* 「未整理」判定的唯一来源（B-47 / 苏哥 2026-11-09 报的跨浏览器空白）：
         * 路径里认不出站点 = 这条素材没有任何来源线索 → untracked=1。
         * 历史实现里这里恒置 0，而 resolveSite 也恒置 0，全仓库没有任何路径
         * 能把 untracked 置 1 —— 左栏「未整理」入口是个永远为空的死节点。
         * 下载记录来源（entryFromDownload）与匹配到下载记录的条目会显式清 0。 */
        var knownSite = !!(parsed.platform || parsed.siteHost);
        var item = {
            relPath: relPath,
            absPath: absPath ? normAbs(absPath) : '',
            platform: parsed.platform || '',
            platformName: parsed.platformName || '',
            creatorFull: parsed.creatorFull || '',
            creatorId: parsed.creatorId || '',
            part: parsed.part || '',
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
            untracked: knownSite ? 0 : 1
        };
        /* 站点标识与显示名统一在这里落定（含老 'web' 条目的自动纠正）。
         * 作者名完全靠目录推断 —— 重扫时没有网页可读，不能依赖抓取。 */
        return resolveSite(item);
    }

    /**
     * 站点标识 → 显示名。
     *
     * 优先级（与目录层一致）：
     *   站点字典（手改 / 预置 / 自动学习，含域名归一）
     *   → 内置平台中文名（B站 / 小红书…）
     *   → 标识本身（域名或平台 key）
     *
     * 这一步只读本地数据，**不发网络请求** —— 资源库重扫时页面早就关了，
     * 靠抓取补名字是不可能的；名字要么来自目录，要么来自已存的学习结果。
     */
    function platformNameOf(p) {
        if (!p) { return ''; }
        var R = root.VRSiteRegistry;
        if (R && typeof R.nameOf === 'function') {
            try {
                var n = R.nameOf(p);
                if (n) { return n; }
            } catch (e) { /* 落回下面的字典 */ }
        }
        try {
            return (root.VRPath && root.VRPath.PLATFORM_DIR && root.VRPath.PLATFORM_DIR[p]) || p;
        } catch (e) { return p; }
    }

    /**
     * 条目落定站点标识与显示名。
     *
     * 老数据里 platform 可能还是 'web'（当年没有站点概念），
     * 这里按「路径里的站点段」重新识别一次：
     *   其他网页/huaban.com/图片/a.jpg → platform=huaban.com, platformName=花瓣
     * 这样历史素材重扫后自动归到正确站点，不需要手工迁移。
     */
    function resolveSite(item) {
        var plat = String(item.platform || '');
        var R = root.VRSiteRegistry;
        var path = String(item.relPath || '');
        var host = '';

        /* 先从路径第三段/域名段找线索（parseRelPath 已解析到 siteHost） */
        var parsed = {};
        try { parsed = (root.VRPath && root.VRPath.parseRelPath(path)) || {}; } catch (e) { parsed = {}; }
        if (parsed.siteHost) { host = parsed.siteHost; }

        var isDomainLike = plat && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(plat);
        if (!plat || plat === 'web') {
            /* 老 'web' 或空：改用路径里的真实站点 */
            if (host) { plat = host; }
            else if (parsed.platform) { plat = parsed.platform; }
        }
        if (!plat) { return item; }

        item.platform = plat;
        /* 认出了站点就不再是「未整理」——这是 untracked 唯一的清零点。
         * 原实现无条件清零，把 entryFromRel 刚判出来的未整理又盖掉了。 */
        item.untracked = 0;
        /* 域名形式的标识：尽量换了人话名字 */
        if (!item.platformName || item.platformName === 'web' || isDomainLike) {
            item.platformName = platformNameOf(plat) || parsed.platformName || plat;
        }
        item.siteHost = isDomainLike ? plat : (host || '');
        item.untracked = 0;
        return item;
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
        /* 2026-11-09 去重根因（苏哥报「点几次下几份」）：
         * 这里原来不保留内容指纹与引用标记 —— 重建一次索引，所有 sha256 全丢，
         * 于是「不同平台同图只留一份」的内容去重彻底失效，历史重复也再也认不出来。
         * 指纹/引用必须跟条目同生共死。 */
        if (old.sha256 && !out.sha256) { out.sha256 = old.sha256; }
        if (old.hashKind && !out.hashKind) { out.hashKind = old.hashKind; }
        if (old.refOf && !out.refOf) { out.refOf = old.refOf; }
        /* isRef：只有「磁盘上真的出现了这个路径的文件」（item.absPath 与旧值不同）
         * 才说明它不再是引用；否则保持引用语义，避免把虚拟路径当实体卡。 */
        var refNowReal = item.absPath && old.absPath && item.absPath !== old.absPath;
        out.isRef = (old.isRef && !refNowReal) ? 1 : 0;
        /* F2 溯源：重建索引时保住「原帖/直链/作者ID/作品ID」，
           否则重建一次索引，来源就全变「未记录」了（ADR-052 铁律） */
        ['pageUrl', 'mediaUrl', 'authorUid', 'authorHandle', 'authorState', 'workId', 'dlAt'].forEach(function (k) {
            if (!out[k] && old[k]) { out[k] = old[k]; }
        });
        if (out.downloadId === null && old.downloadId !== undefined) { out.downloadId = old.downloadId; }
        out.state = 'ok';
        /* 2026-11-09：回收站条目（state='trashed'）在索引里**保留行**，
         * 只有文件重新出现在磁盘上（full/reconcile 真的扫到了）才算恢复。
         * 这里负责把 trashed 标记清掉，否则恢复出来的条目会一直藏在回收站里。 */
        if (old.state === 'trashed') {
            out.state = 'ok';
            out.trashBatch = '';
            out.trashedAt = 0;
            out.trashNoFile = 0;
        }
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
        /* 固定名优先：它由每次入库自动刷新，永远比按日快照新（阶段 1）。
         * SNAP_RE 不匹配它，所以不会被 pruneSnapshots 删掉。 */
        try {
            var ff = await (await dir.getFileHandle(FIXED_SNAP)).getFile();
            var fjson = JSON.parse(await ff.text());
            if (fjson && Array.isArray(fjson.files)) {
                return { name: FIXED_SNAP, json: fjson };
            }
        } catch (e) { /* 没有固定名快照 → 退回按日快照 */ }

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
        var vanished = 0;
        for (var i = 0; i < files.length; i++) {
            var f = files[i] || {};
            var relPath = String(f.relPath || '').replace(/\\/g, '/');
            if (!relPath || skipRel(relPath) || splitRel(relPath).indexOf('..') !== -1) { continue; }
            var relFromRoot = (pfx && relPath.indexOf(pfx) === 0) ? relPath.slice(pfx.length) : relPath;
            /* 2026-11-09：快照只是**线索**，磁盘才是真相。
             * 快照可能是删/清空之前写的，直接照抄会把已删素材复活
             * （「清空回收站后一开库页又回来了」的第二个通道）。
             * 这里逐个探一次文件是否存在；读不到（unknown）时保守保留。 */
            var probe = await fileExists(handle, relFromRoot);
            if (probe === 'missing') { vanished++; continue; }
            var item = entryFromRel(relPath, (absRoot ? absRoot + '/' + relFromRoot : ''), f.size, f.mtime);
            if (f.platform) {
                /* 快照里的平台也走同一条解析：老快照可能存的是 'web'，
                 * 直接赋值会把 entryFromRel 按目录推断出的站点又盖回去。 */
                item.platform = f.platform;
                item.platformName = platformNameOf(f.platform);
                item = resolveSite(item);
            }
            if (f.creatorId) { item.creatorId = f.creatorId; }
            if (f.type) { item.type = f.type; }
            if (f.fileName) { item.fileName = f.fileName; }
            item.starred = f.starred ? 1 : 0;
            item.tags = Array.isArray(f.tags) ? f.tags : [];

            /* 还原 v2 新增字段（B-32 核心）：这些就是「重装后会丢」的东西。
             * 只还原快照里真实存在的键，缺键保持 entryFromRel 的默认值。 */
            if (f.displayName) { item.displayName = String(f.displayName); }
            if (f.width) { item.width = Number(f.width) || 0; }
            if (f.height) { item.height = Number(f.height) || 0; }
            if (f.duration != null) { item.duration = Number(f.duration) || 0; }
            if (f.mime) { item.mime = String(f.mime); }
            if (f.sourceUrl) { item.sourceUrl = String(f.sourceUrl); }
            if (f.mediaUrl) { item.mediaUrl = String(f.mediaUrl); }
            /* 指纹与引用：快照是跨浏览器/重装后的唯一来源，丢了就再也认不出重复 */
            if (f.sha256) { item.sha256 = String(f.sha256); }
            if (f.hashKind) { item.hashKind = String(f.hashKind); }
            if (f.refOf) { item.refOf = String(f.refOf); }
            if (f.isRef) { item.isRef = 1; }
            if (f.pageUrl) { item.pageUrl = String(f.pageUrl); }
            if (f.creatorFull) { item.creatorFull = String(f.creatorFull); }
            if (f.title) { item.title = String(f.title); }
            if (f.thumbFile) { item.thumbFile = String(f.thumbFile); }
            if (f.thumbSrc && f.thumbSrc.mtime != null && f.thumbSrc.size != null) {
                item.thumbSrc = { mtime: Number(f.thumbSrc.mtime), size: Number(f.thumbSrc.size) };
                /* 恢复时缩略图已落盘 → 让 UI 直接按 thumbFile 取，不必重新生成 */
                if (f.thumbFile) { item.thumbKey = 't:' + relPath; }
            }

            out.push(item);
            if (onProgress && i % 100 === 0) {
                onProgress({ phase: 'snapshot', done: i + 1, total: files.length });
            }
        }
        out.vanished = vanished;      /* 快照里有、磁盘上已经没有的条数（不上报给用户，只记日志） */
        return out;
    }

    /* ---------------- 源三：全量扫描 ---------------- */

    async function walk(dir, prefix, out, depth, limits) {
        /* 统一走 collectTree 的「可上报」遍历：
         * 旧的 walk 在超限时直接 return，调用方只拿到恰好 MAX_ITEMS 条，
         * 无法知道「还有多少没扫」，用户会以为素材丢了。 */
        var res = await collectTree(dir, {
            maxItems: (limits && limits.maxItems) || LIMITS.MAX_ITEMS,
            maxDepth: (limits && limits.maxDepth) || LIMITS.MAX_DEPTH
        });
        for (var i = 0; i < res.items.length; i++) {
            var it = res.items[i];
            var rel = prefix ? prefix + '/' + it.rel : it.rel;
            var f = await it.handle.getFile();
            out.push({ rel: rel, name: it.name, size: f.size, mtime: f.lastModified });
        }
        out.scanned = res.scanned;
        out.truncated = res.truncated;
        out.skipped = res.skipped;
        out.depthLimited = res.depthLimited;
        return res;
    }

    async function scanFull(handle, absRoot, prefix, dlIdx, onProgress, limits) {
        var raw = [];
        var tree = await walk(handle, '', raw, 0, limits);
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
                if (plat && plat !== 'web') {
                    item.platform = plat;
                    item.platformName = platformNameOf(plat);
                }
            }
            /* 不再覆盖 untracked：resolveSite() 已按路径判过。
             * 旧代码在这里用 `item.platform ? 0 : 1` 会把「路径里有站点、
             * 但下载记录认不出」的素材错判成未整理。 */
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
        } else if (mode === 'reconcile') {
            /* 增量对账（B-34 / 红队 c-4）：
             * 与 full 的区别是「以快照为基线，只补差异」：
             *   · 先用快照里已有的条目填底（磁盘没变就不用重扫）
             *   · 再扫一遍目录树拿到真实文件集合
             *   · 只对「新增 / 消失」做增删，未变化的条目原样保留
             * 代价仍是一次目录遍历，但不再对每个文件 getFile() 取完整元数据，
             * 只取 size/mtime —— 上万条时这是主要省下来的那块。 */
            if (!rr.handle) { throw makeErr('LIB_E_NO_PERM', '需要一次目录授权才能对账'); }
            await ensureRead(rr.handle);
            var base = [];
            try {
                var snap = await latestSnapshot(rr.handle);
                base = (snap && snap.json && snap.json.files) || [];
            } catch (e) { base = []; }
            var dlIdx2 = await buildDownloadIndex();
            scanned = await scanFull(rr.handle, absRoot, rr.prefix, dlIdx2, onProgress);
            /* 用快照兜住「扫不到的旧条目」：full 会标 missing，
             * 但 reconcile 的语义是「磁盘才是真相」，扫不到就是真的没了。 */
            scanned.fromSnapshot = base.length;
        } else {
            throw makeErr('LIB_E_UNKNOWN', '未知索引模式：' + mode);
        }

        onProgress({ phase: 'merge', done: 0, total: scanned.length });

        var seen = {};
        var out = [];
        var skippedTrashed = 0;
        var skippedGhost = 0;
        for (var si = 0; si < scanned.length; si++) {
            var it = scanned[si];
            if (!it || !it.relPath) { continue; }
            var old = oldMap[it.relPath];
            /* 2026-11-09：回收站条目不许被「没有磁盘证据」的源复活。
             * downloads（chrome.downloads 历史）与 snapshot（_library/index.json）
             * 都不校验文件是否还在，Edge 实测 d.exists 在文件已删时仍返回 true，
             * 一旦掺进来，用户清空回收站后一开库页素材就"自己回来了"。
             * full / reconcile 是遍历磁盘得到的，扫到即文件存在，走 mergeEntry 正常恢复。 */
            if (old && old.state === 'trashed' && (mode === 'downloads' || mode === 'snapshot')) {
                skippedTrashed++;
                continue;
            }
            /* downloads 源里「库里没有过」的条目 = 新下载，也可能是删掉之后下载记录还没清。
             * 只对这类做一次真实探盘（成本只跟新增条数走），别再信 d.exists。
             *
             * 2026-11-09（B-67）扩展：**旧条目也要探**。原来只在 !old 时探，于是
             * 「文件删了、下载记录还在」的条目会被原样复活成 state=ok 的实体卡
             * —— 实测库里出现 30 条卡片、磁盘只有 15 个文件，多出来的全是打不开的幽灵。
             * 探盘成本只跟下载记录条数走（几十~几百），可以接受。 */
            if (mode === 'downloads' && rr.handle) {
                var ghost = await fileExists(rr.handle, stripPrefix(it.relPath, rr.prefix));
                if (ghost === 'missing') { skippedGhost++; continue; }
            }
            seen[it.relPath] = 1;
            out.push(mergeEntry(old, it));
        }
        if (skippedGhost) {
            try { console.info('[vrLib] 下载记录里有', skippedGhost, '条文件已不存在，已跳过'); } catch (eG) { /* 忽略 */ }
        }

        // 全量源扫不到的旧条目：标 missing，不删除（ADR-030）
        // ADR-070 例外：下载器兜底条目（relPath 无目录层级 / pendingArchive）
        // 本来就不在库根树里，扫描永远扫不到 —— 不得标「文件缺失」，保持「待归档」。
        // 2026-11-09：回收站条目（state='trashed'）既不参与 missing 判定，也不许被覆盖，
        // 它已经搬去 _回收站 了，磁盘上本来就扫不到。
        var missing = 0;
        if (mode !== 'downloads' && opts.markMissing !== false) {
            oldFiles.forEach(function (f) {
                if (!f || !f.relPath || seen[f.relPath]) { return; }
                if (f.state === 'trashed') { return; }
                /* 引用条目（isRef）本来就没有自己的物理文件：它的 relPath 是虚拟路径，
                 * 实体在 refOf 指向的原件上。扫不到是正常的，标 missing 会让用户
                 * 看到一条「文件缺失」的死卡 —— 保持原样放回。 */
                if (f.isRef) { out.push(Object.assign({}, f)); return; }
                var rel = String(f.relPath).replace(/\\/g, '/');
                if (f.pendingArchive || rel.indexOf('/') < 0) {
                    if (f.state === 'missing' || !f.pendingArchive) {
                        out.push(Object.assign({}, f, { pendingArchive: 1, state: 'ok' }));
                    }
                    return;
                }
                missing++;
                if (f.state === 'missing') { return; }
                out.push(Object.assign({}, f, { state: 'missing' }));
            });
        } else if (mode === 'downloads') {
            /* 2026-11-09 严重缺陷修复：downloads 模式原来**丢弃所有不在下载记录里的条目**。
             * 而 FSA 直写的素材（YouTube / 抖音图文 / 小红书批量…）根本没有 chrome.downloads
             * 记录 —— 一次「重建索引」就把它们从库里抹掉（实测 109 条 → 8 条，磁盘文件还在）。
             * downloads 源「没看到」不等于「文件没了」，照 ADR-030 一律保留原样。 */
            oldFiles.forEach(function (f) {
                if (!f || !f.relPath || seen[f.relPath]) { return; }
                out.push(Object.assign({}, f));
            });
        }

        if (out.length) { await root.VRDB.putFiles(out); }

        /* 2026-11-09（B-67）：重建索引后补一次内容指纹。
         * 为什么必须补：downloads / snapshot 源里没有 sha256，而旧条目可能已经被删过，
         * 于是「同内容不同 URL」的判重链就断了 —— 用户点一次下载又落一份（苏哥报的现象，
         * 实测库里 15 张作品图全是「无 fingerprint、无 sourceUrl」的裸条目）。
         * 只补前 200 条、且不 await：不能让库页为了几千次读盘卡住；补不上就靠下载时兜底。 */
        try {
            if (root.VRDedup && typeof root.VRDedup.hashMissing === 'function') {
                Promise.resolve().then(function () {
                    return root.VRDedup.hashMissing({ maxHash: 200 });
                }).catch(function () { /* 补不上不影响索引结果 */ });
            }
        } catch (eH) { /* 去重模块未加载 */ }
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
            skippedTrashed: skippedTrashed,
            mode: mode,
            truncated: !!scanned.truncated,
            /* 超限/超深必须上报（红队 c-1/c-2）：
             * 原实现静默截断，用户看到「刚好 20000 条」却不知道还有多少没进来。 */
            skipped: Number(scanned.skipped) || 0,
            depthLimited: !!scanned.depthLimited,
            truncatedReason: scanned.truncated ? 'LIB_E_TRUNCATED'
                : (scanned.depthLimited ? 'LIB_E_DEPTH' : ''),
            limit: {
                maxItems: (opts.limits && opts.limits.maxItems) || LIMITS.MAX_ITEMS,
                maxDepth: (opts.limits && opts.limits.maxDepth) || LIMITS.MAX_DEPTH
            }
        };
    }

    /* ---------------- 物理存在性校对 ---------------- */

    async function fileExists(handle, rel) {
        var segs = splitRel(rel);
        if (!segs.length || segs.indexOf('..') !== -1) { return 'invalid'; }
        var name = segs.pop();
        var dir = handle;
        for (var i = 0; i < segs.length; i++) {
            try { dir = await dir.getDirectoryHandle(segs[i]); }
            catch (e) {
                if (isNotFound(e)) { return 'missing'; }
                return 'unknown';       /* 权限/IO 问题 → 不能断定文件没了 */
            }
        }
        try {
            await dir.getFileHandle(name);
            return 'ok';
        } catch (e) {
            return isNotFound(e) ? 'missing' : 'unknown';
        }
    }

    /**
     * 判断 FSA 异常是否真的是「这条路径不存在」。
     *
     * 为什么必须区分（红队 a-3）：
     *   原实现把**所有**异常都当作「文件不存在」，于是把「目录读不到」
     *   （句柄失效、权限回收、磁盘报错）也标成 missing。
     *   一旦被标 missing，用户会以为素材丢了；而 missing 语义是
     *   「永不自动删除」（ADR-030），错标会一直留着。
     */
    function isNotFound(e) {
        var n = e && e.name;
        return n === 'NotFoundError' || n === 'TypeMismatchError';
    }

    async function reconcile() {
        if (!dbReady()) { throw makeErr('LIB_E_DB', 'VRDB 未加载'); }
        /* 回收站条目（state='trashed'）不参与存在性对账：
         * 它们的文件已经搬进 _回收站，按「磁盘上找不到」处理会被标成 missing，
         * 于是又变回主页上的一张卡片（2026-11-09）。 */
        var files = (await root.VRDB.getAllFiles()).filter(function (f) {
            return f && f.state !== 'trashed';
        });
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
            /* 引用条目没有自己的物理文件，存在性对账会把它们全标 missing（同 missing 段）。 */
            if (f.isRef) { continue; }
            var state = null;
            var d = (f.downloadId !== undefined && f.downloadId !== null) ? byId[f.downloadId] : null;
            if (d) {
                state = (d.exists === false) ? 'missing' : 'ok';
            } else if (rr.handle) {
                /* 三态：ok / missing / unknown。
                 * unknown 不能当 missing —— 那是「读不到」而非「文件没了」，
                 * 错标会把用户的素材永久挂成「失联」（ADR-030 不自动删除）。 */
                var st = await fileExists(rr.handle, stripPrefix(f.relPath, rr.prefix));
                state = (st === 'ok' || st === 'missing') ? st : null;
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

    /* 对外入口：串行化，避免并发 createWritable 互相截断（红队 a-5） */
    function snapshot() {
        return serializeSnapshot(function () { return snapshotInner(); });
    }

    /* ---------------- 快照自动化（红队 a-5 / US-3） ---------------- */

    var autoTimer = 0;
    var autoPending = false;

    /**
     * 触发一次「延迟合并」的快照写入。
     *
     * 为什么需要（US-3）：
     *   VRIndex.snapshot() 原来全仓库只有一个调用点——设置页的手动按钮。
     *   于是本地/磁盘快照永远停在「上次手点」那一刻，
     *   用户下载完新素材再打开资源库，看到的还是旧列表。
     *
     * 为什么要节流：
     *   每次入库都写 2 万条 ≈ 8MB，连续批量下载会明显拖慢。
     *   30 秒窗口内多次入库合并成一次写；IDB 才是即时真相，快照是派生数据，
     *   短暂落后不影响当前使用。
     *
     * @param {number} delayMs 合并窗口，默认 30 秒
     */
    function scheduleSnapshot(delayMs) {
        var ms = Number(delayMs);
        if (!isFinite(ms) || ms <= 0) { ms = 30000; }
        autoPending = true;
        if (autoTimer) { return { scheduled: true, merged: true }; }
        autoTimer = setTimeout(function () {
            autoTimer = 0;
            if (!autoPending) { return; }
            autoPending = false;
            snapshot().catch(function () { /* 失败下次入库再试，不打扰用户 */ });
        }, ms);
        return { scheduled: true, merged: false };
    }

    /** 测试/退出前强制立即写一次；没有待写任务时返回 null */
    function flushSnapshot() {
        if (!autoPending) { return Promise.resolve(null); }
        autoPending = false;
        if (autoTimer) { clearTimeout(autoTimer); autoTimer = 0; }
        return snapshot();
    }

    async function snapshotInner() {
        if (!dbReady()) { throw makeErr('LIB_E_DB', 'VRDB 未加载'); }
        var rr = await resolveRoot();
        if (!rr.handle) { throw makeErr('LIB_E_NO_PERM', '需要一次目录授权才能写快照'); }
        if (!rr.absRoot) { throw makeErr('LIB_E_NO_PERM', '缺少资源库根目录（先点「校验落盘」）'); }
        await ensureRead(rr.handle);

        var files = await root.VRDB.getAllFiles();
        var favs = [];
        try {
            var v = await root.VRDB.getSetting('vrFavs', []);
            if (Array.isArray(v)) { favs = v; }
        } catch (e) { /* 没有收藏夹不影响写快照 */ }

        var payload = snapshotPayload(files, favs, { root: rr.absRoot, prefix: rr.prefix });
        var dir = await rr.handle.getDirectoryHandle(SNAP_DIR, { create: true });

        /* ① 按日快照（保留 7 份，现有行为不变） */
        var name = 'index-' + stamp() + '.json';
        await writeJsonAtomic(dir, name, payload);
        await pruneSnapshots(dir);

        /* ② 固定名快照（供「先读索引」与重装恢复用，永不参与轮转） */
        try {
            await writeJsonAtomic(dir, FIXED_SNAP, payload);
        } catch (e) { /* 固定名失败不影响按日快照，下次再补 */ }

        try { await root.VRDB.setSetting('snapshotAt', payload.at); } catch (e) { /* 忽略 */ }

        return rr.absRoot + '/' + SNAP_DIR + '/' + name;
    }

    /**
     * 原子写一个 JSON 文件。
     *
     * 关于「原子性」（红队 a-1，结论经检索修正）：
     *   `createWritable()` **本身**就是「写临时文件 → close 时才替换原文件」
     *   （MDN：writes are not in-place, they use a temporary file;
     *    the original is not modified unless it passes all security checks）。
     *   所以**不能也不需要**自行实现「写 .tmp 再 rename」——
     *   `FileSystemHandle.move()` 至今未发布（chromestatus: In development）。
     *
     * 因此这里的正确做法是：
     *   · 默认不用 keepExistingData（保持文件大小可收缩，避免残留尾巴）
     *   · 失败时 abort()，原文件因从未被替换而完好
     */
    async function writeJsonAtomic(dir, name, payload) {
        var fh = await dir.getFileHandle(name, { create: true });
        var w = await fh.createWritable();
        try {
            await w.write(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
            await w.close();
        } catch (e) {
            try { await w.abort(); } catch (e2) { /* 已关闭则忽略 */ }
            throw e;
        }
        return name;
    }

    /* ---------------- 状态 ---------------- */

    async function status() {
        var all = dbReady() ? await root.VRDB.getAllFiles() : [];
        /* 「库里有几项」只算活跃条目：回收站条目不删行，算进来会让计数虚高 */
        var files = all.filter(function (f) { return f && f.state !== 'trashed'; });
        var rr = await resolveRoot();
        var snapAt = 0;
        if (dbReady()) {
            try { snapAt = await root.VRDB.getSetting('snapshotAt', 0); } catch (e) { /* 忽略 */ }
        }
        return {
            count: files.length,
            trashed: all.length - files.length,
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
        scheduleSnapshot: scheduleSnapshot,
        flushSnapshot: flushSnapshot,
        setRoot: setRoot,
        resolveRoot: resolveRoot,
        status: status,
        errCode: errCode,
        /* 持久化纯逻辑（供 Node 单测与内部复用） */
        LIMITS: LIMITS,
        snapshotPayload: snapshotPayload,
        absRootFromSnapshot: absRootFromSnapshot,
        collectTree: collectTree,
        // 测试用：只清内存，不动已落库的句柄
        _resetRoot: function () { memHandle = null; memRoot = ''; memPrefix = ''; },
        _skipRel: skipRel,
        /* 测试用：暴露纯函数，便于在 Node 里验证「按目录推断站点/作者」。
         * 生产代码不调用这两个。 */
        _entryFromRel: entryFromRel,
        _platformNameOf: platformNameOf,
        _resolveSite: resolveSite
    };
})(typeof self !== 'undefined' ? self : this);
