/* ==========================================================
 * VRRootGuard —— 库根层级守卫（2026-11-14）
 *
 * 为什么需要这一层（苏哥 2026-11-14 报「明明说只扫自己和下属，
 * 连上级下载文件夹里的图都收进库了」）：
 *   库根不是一个抽象概念，它由**磁盘上的某一层目录**决定：
 *     system 模式 = <下载根>/<subdir>     （subdir 默认 video-rod）
 *     custom 模式 = 用户授权的那个目录（customRoot）
 *   而索引里的 relPath 首段永远写成 subdir（见 save.js 的 relForDb）。
 *   只要「句柄所在层」与「relPath 首段」对不上，就会同时错三件事：
 *     ① 写盘：stripPrefix 以为已经到库根，把 video-rod 当已到达层剥掉，
 *        文件直接落进上级目录（实测：D:\personal\下载\xxx.png）；
 *     ② 入库：relPath 仍带 video-rod 前缀，与磁盘错位一层；
 *     ③ 识别：路径只剩两段，parseRelPath 找不到站点段 → platform 空
 *        → UI 兜底成「网页」，用户完全看不出这是脏数据。
 *   三条通道各有各的「根」口径（indexer 用 absRoot、save 用句柄、
 *   sw-library 用 detectedRoot），于是谁都没拦住越界。本模块把这套判据
 *   收敛成**纯函数 + 一次目录解析**，三处共用。
 *
 * 设计约束：
 *   · 纯逻辑（normName / expectedName / classifyRel / inRoot / plan）不碰 FSA，
 *     供 tools/test-root-guard.js 在 Node 里逐条钉死；
 *   · FSA 只做「定位到期望层」，**绝不向上找父目录** —— 浏览器不提供父句柄，
 *     任何「猜上级」的实现都会把错误层合法化，那正是本轮的病灶；
 *   · 找不到期望层时如实返回原因，由调用方决定提示还是降级，不静默放行。
 *
 * 零依赖、ES5+async，挂 self.VRRootGuard。
 * ========================================================== */
(function (root) {
    'use strict';

    var DEFAULT_SUBDIR = 'video-rod';

    /* ==========================================================
     * 一、纯逻辑（Node 可测）
     * ========================================================== */

    function normName(s) {
        return String(s == null ? '' : s)
            .replace(/\\/g, '/')
            .replace(/^\/+|\/+$/g, '')
            .trim();
    }

    /** 名字比较：Windows 磁盘不区分大小写，尾斜杠/空白一律忽略 */
    function sameName(a, b) {
        var x = normName(a), y = normName(b);
        if (!x || !y) { return false; }
        return x.toLowerCase() === y.toLowerCase();
    }

    /** 绝对路径末段（拿不到返回空串） */
    function lastSeg(p) {
        var s = String(p == null ? '' : p).replace(/\\/g, '/').replace(/\/+$/, '');
        if (!s) { return ''; }
        var segs = s.split('/').filter(Boolean);
        return segs.length ? segs[segs.length - 1] : '';
    }

    /** 索引 key 的首段（subdir / rootPrefix），统一清洗 */
    function normPrefix(p) {
        return normName(p) || '';
    }

    /**
     * 库根那一层「应该叫什么」。
     *
     * 与 indexer.resolveRoot 的口径一致，额外补上一个**历史漏洞**：
     * custom 模式下 customRoot 可能为空（换目录时下钻失败、只记了
     * customName），原实现这时直接不校验句柄，任何目录都被当成库根。
     * 这里退到 customName，再退到 prefix，保证「永远有一个期望值」。
     *
     * @param {object} st  vrLibSettings
     * @param {string} absRoot 库根绝对路径（可为空）
     * @returns {string} 期望的目录名；无法确定时返回 ''
     */
    function expectedName(st, absRoot) {
        var s = st || {};
        var abs = String(absRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        if (abs) { return lastSeg(abs); }
        if (String(s.mode || 'system') === 'custom') {
            /* 自选目录可以叫任何名字：customRoot 由用户填、customName 是刚选那次的目录名。
             * 两者都没有时返回空串 = 「无法判定，接受任意目录」，而不是退回 subdir ——
             * 退回会在「用户刚选完新文件夹、还没填路径」时把正确选择误判成非法。 */
            return normName(s.customName) || '';
        }
        var sub = normName(s.subdir) || DEFAULT_SUBDIR;
        return sub;
    }

    /**
     * 条目是不是「落在库根之外」的越界数据？
     *
     * 2026-11-14 收敛：这个判定在 app / sw-library / dedup / trash / indexer 里
     * 各写了一遍（`state === 'outOfRoot' || e.outOfRoot`），改状态名就会漏改。
     * 与「下载根合法性判据」同一类问题，统一收在这里。
     * 兼容两种写法：新条目写 state，老数据可能只带 outOfRoot 标记。
     */
    function isOutOfRoot(e) {
        return !!e && (e.state === 'outOfRoot' || e.outOfRoot === 1 || e.outOfRoot === true);
    }

    /**
     * 条目能不能算「库里的活跃素材」？
     * 回收站（trashed）与越界（outOfRoot）都不算 —— 前者是用户显式删除，
     * 后者指向库外文件。查重、引用计数、列表、统计都该用这一个判据。
     */
    function isActiveEntry(e) {
        return !!e && e.state !== 'trashed' && !isOutOfRoot(e);
    }

    /**
     * 这个绝对路径「像不像用户真的下载根」？
     *
     * 判据刻意保守 —— 只拦「明显不该是下载根」的值，避免把用户的真实目录否掉：
     *   · 必须是绝对路径（盘符 / UNC / 以 / 开头）
     *   · 不能是浏览器 profile 内部目录（…/User Data/…、….edge-*）：那是浏览器自己的家目录
     *   · 不能是 Webstore Downloads 这类受管默认名（历史上把测试浏览器目录当成用户下载位置）
     *
     * 2026-11-14 收敛：这段判据原先在 app.js / indexer.js / save.js 各写一份，
     * 三份逐字相同却互不知情 —— 改一处漏两处的风险就是本轮问题的同一类成因。
     * 现在唯一真源在这里，三处都调它。
     */
    var BAD_ROOT_RE = /\/(User Data|\.edge-[^/]+|Default)\//i;
    var MANAGED_ROOT_RE = /Webstore Downloads/i;

    function isPlausibleDownloadRoot(p) {
        var s = String(p == null ? '' : p).replace(/\\/g, '/');
        if (!s) { return false; }
        if (!/^([A-Za-z]:\/|\/\/|\/)/.test(s)) { return false; }
        if (BAD_ROOT_RE.test(s + '/')) { return false; }
        if (MANAGED_ROOT_RE.test(s)) { return false; }
        return true;
    }

    /**
     * 库内相对路径是否合法（**只用 '/'**，与 VRDB key 同口径）。
     *
     * 合法 = 以 prefix 开头、且 prefix 之后至少还有一个文件名段。
     *   prefix 为空时只要求「路径干净」——那是 custom 平铺模式的约定。
     *
     * @returns {'ok'|'empty'|'escaping'|'absolute'|'unprefixed'|'no-file'}
     */
    function classifyRel(rel, prefix) {
        var segs = String(rel == null ? '' : rel).replace(/\\/g, '/').split('/').filter(Boolean);
        if (!segs.length) { return 'empty'; }
        for (var i = 0; i < segs.length; i++) {
            if (segs[i] === '..') { return 'escaping'; }
        }
        /* 盘符段（C:, D:）说明这是一条绝对路径，绝不该出现在库里 */
        if (/^[A-Za-z]:$/.test(segs[0])) { return 'absolute'; }

        var p = normPrefix(prefix);
        if (!p) { return segs.length >= 2 ? 'ok' : 'no-file'; }
        var ps = p.split('/').filter(Boolean);
        /* 先判前缀再判「有没有文件名」：`a.png` 这类路径的问题在于
         * 它根本不属于本库（首段被当成 subdir），而不是「缺文件名」。 */
        for (var j = 0; j < ps.length; j++) {
            if (segs[j] !== ps[j]) { return 'unprefixed'; }
        }
        if (segs.length <= ps.length) { return 'no-file'; }
        return 'ok';
    }

    /**
     * 绝对路径 → 库内相对路径（**不含** prefix），不在库根之下返回 ''。
     *
     * 为什么不复用 indexer.relFromAbs：那个函数不区分「库根」与「下载根」，
     * 而本轮的两处越界恰恰是把下载根当成库根。这里显式判段边界，
     * 防止 `D:/下载/video-rod-old/...` 被 `D:/下载/video-rod` 前缀误吃。
     */
    function relFromRoot(absFile, absRoot) {
        var a = String(absFile == null ? '' : absFile).replace(/\\/g, '/');
        var r = String(absRoot == null ? '' : absRoot).replace(/\\/g, '/').replace(/\/+$/, '');
        if (!a || !r) { return ''; }
        if (a.toLowerCase().indexOf(r.toLowerCase() + '/') !== 0) { return ''; }
        return a.slice(r.length + 1);
    }

    /** 文件是否落在库根之下（absRoot 为空时返回 false —— 不猜） */
    function inRoot(absFile, absRoot) {
        return !!relFromRoot(absFile, absRoot);
    }

    /**
     * 从设置里算出「库根绝对路径」与「索引首段」。
     *
     * 口径与 indexer.absRootFromSettings / save.resolveAbsRoot 完全一致，
     * 三处共用这一个函数，避免再次出现「各算各的根」。
     *
     * @returns {{mode:'system'|'custom', absRoot:string, prefix:string, expected:string, downloadRoot:string}}
     */
    function contextFromSettings(st) {
        var s = st || {};
        var mode = (String(s.mode || 'system') === 'custom') ? 'custom' : 'system';
        var sub = normName(s.subdir) || DEFAULT_SUBDIR;
        var downloadRoot = String(s.detectedRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        var absRoot = '';
        if (mode === 'custom') {
            absRoot = String(s.customRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        } else if (downloadRoot) {
            absRoot = downloadRoot + '/' + sub;
        }
        return {
            mode: mode,
            absRoot: absRoot,
            prefix: sub,
            expected: expectedName(s, absRoot),
            downloadRoot: downloadRoot
        };
    }

    /* ==========================================================
     * 二、FSA 目录解析（只在浏览器上下文可用）
     * ========================================================== */

    var SNAP_DIR = '_library';
    var SNAP_FILE = 'index.json';

    function noHandle(reason, detail) {
        return { handle: null, layer: 'none', reason: reason || 'NO_HANDLE', detail: detail || '' };
    }

    /**
     * 「这一层是本库根」的物理证据：里面有 `_library/index.json`。
     *
     * 为什么还要这层判据：句柄名不可靠 —— 历史脏句柄名是 `download`
     * 而内容其实是 video-rod（indexer.resolveRoot 的注释记过同一件事）。
     * 名字不符、又下钻不到期望层时，用「有没有本库的固定快照」来确认，
     * 比单纯靠名字更接近事实；且只有这种情况下才多这两次 IO。
     */
    async function hasRootMarker(dir) {
        if (!dir || typeof dir.getDirectoryHandle !== 'function') { return false; }
        try {
            var lib = await dir.getDirectoryHandle(SNAP_DIR, { create: false });
            if (!lib || typeof lib.getFileHandle !== 'function') { return false; }
            await lib.getFileHandle(SNAP_FILE, { create: false });
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * 把句柄定位到「期望的那一层」。
     *
     * 只允许三种结果：
     *   · layer='self'    句柄本来就在期望层（名字相符，或带本库物理标记）
     *   · layer='drilled' 句柄是它的直接上级，向下钻了一层
     *   · layer='unknown' 没有期望值可比（不拦死历史可用环境）
     * 其余一律 handle=null —— **绝不把上级目录当成库根继续用**。
     *
     * @param {FileSystemDirectoryHandle} handle
     * @param {string|object} want 期望层名，或 contextFromSettings() 的返回值
     * @param {object} opt { create:boolean }
     * @returns {Promise<{handle, layer, reason, detail}>}
     */
    async function resolveDir(handle, want, opt) {
        var o = opt || {};
        var expect = '';
        if (want && typeof want === 'object') {
            expect = normName(want.expected);
            o = Object.assign({}, want, o);
        } else {
            expect = normName(want);
        }
        if (!handle || typeof handle.getDirectoryHandle !== 'function') {
            return noHandle('NO_HANDLE');
        }
        var name = normName(handle.name);
        if (!expect) {
            /* 没有期望值：无法证明它就是库根，但也不该拦死历史可用环境。
             * 返回 unknown 让调用方自行决定（旧行为兼容位）。 */
            return { handle: handle, layer: 'unknown', reason: '', detail: '' };
        }
        if (sameName(name, expect)) {
            return { handle: handle, layer: 'self', reason: '', detail: '' };
        }

        /* 名字不符：先笨办法下钻一层。
         * create 只在「写盘」链路给 true；扫描/授权用 false，
         * 以免在用户的上级目录里凭空造一个 video-rod 出来。 */
        var create = !!o.create;
        var child = null;
        try {
            child = await handle.getDirectoryHandle(expect, { create: create });
        } catch (e) {
            var nm = (e && e.name) || '';
            if (nm !== 'NotFoundError') {
                if (nm === 'NotAllowedError' || nm === 'SecurityError') {
                    return noHandle('NO_PERM', '没有权限在「' + name + '」下打开「' + expect + '」');
                }
                if (nm === 'TypeMismatchError') {
                    return noHandle('NOT_DIR', '「' + name + '/' + expect + '」不是文件夹');
                }
                return noHandle('ERR', String((e && e.message) || e || ''));
            }
            /* 下钻不到：再用物理标记确认句柄自己是不是库根（句柄名可能过时）。 */
            if (!create && await hasRootMarker(handle)) {
                return { handle: handle, layer: 'self', reason: 'marker', detail: '' };
            }
            return noHandle('NOT_FOUND', '「' + name + '」下没有「' + expect + '」');
        }
        if (!child || typeof child.getDirectoryHandle !== 'function') {
            return noHandle('NOT_DIR', '「' + name + '/' + expect + '」不是文件夹');
        }
        return { handle: child, layer: 'drilled', reason: '', detail: '' };
    }

    /** 读 vrLibSettings（页面/SW 都可用） */
    function readSettings() {
        return new Promise(function (resolve) {
            try {
                var st = root.chrome && root.chrome.storage && root.chrome.storage.local;
                if (!st) { resolve({}); return; }
                st.get('vrLibSettings', function (o) {
                    resolve((o && o.vrLibSettings) || {});
                });
            } catch (e) { resolve({}); }
        });
    }

    /**
     * 浏览器侧：把**已给出的句柄**定位到库根层，并带回根路径/索引首段。
     *
     * 与 resolveContext 的区别：句柄由调用方提供（save.js 的 probeEnv 已经有句柄），
     * 不必再去 IDB 读一次。返回的上下文与 resolveContext 同形，调用方可直接用。
     *
     * @param {FileSystemDirectoryHandle} handle
     * @param {object} opt { create:boolean }
     */
    async function resolveHandle(handle, opt) {
        var st = await readSettings();
        var ctx = contextFromSettings(st);
        if (!handle) {
            ctx.handle = null;
            ctx.layer = 'none';
            ctx.reason = 'NO_HANDLE';
            return ctx;
        }
        var hit = await resolveDir(handle, ctx.expected, { create: !!(opt && opt.create) });
        ctx.handle = hit.handle;
        ctx.layer = hit.layer;
        ctx.reason = hit.reason;
        ctx.detail = hit.detail;
        return ctx;
    }

    /* ==========================================================
     * 三、对外
     * ========================================================== */

    root.VRRootGuard = {
        DEFAULT_SUBDIR: DEFAULT_SUBDIR,
        /* 纯逻辑（tools/test-root-guard.js） */
        normName: normName,
        normPrefix: normPrefix,
        sameName: sameName,
        lastSeg: lastSeg,
        expectedName: expectedName,
        isPlausibleDownloadRoot: isPlausibleDownloadRoot,
        isOutOfRoot: isOutOfRoot,
        isActiveEntry: isActiveEntry,
        classifyRel: classifyRel,
        relFromRoot: relFromRoot,
        inRoot: inRoot,
        contextFromSettings: contextFromSettings,
        /* FSA */
        resolveDir: resolveDir,
        resolveHandle: resolveHandle
    };
})(typeof self !== 'undefined' ? self : this);