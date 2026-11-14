/* ==========================================================
 * VRSettings —— 资源库设置页（S1a）
 *
 * 职责：
 *   1. 读写 chrome.storage.local 的 vrLibSettings
 *   2. 渲染 options.html「资源库」分区
 *   3. 「校验落盘」：发 1KB 微下载 → 反推真实下载根目录 → 清理
 *   4. 「选择文件夹并授权」：FSA 句柄存 IndexedDB（供 S1b 搬移/迁移用）
 *
 * 说明：FSA 只给目录句柄，拿不到绝对路径，所以「自定义目录」的路径要手填；
 *       选择文件夹仅用于授权。零依赖，ES5，挂 window.VRSettings。
 * ========================================================== */
(function (root) {
    'use strict';

    var KEY = 'vrLibSettings';
    var DEFAULTS = {
        mode: 'system',        // system | custom
        subdir: 'video-rod',
        customRoot: '',
        detectedRoot: '',
        verifyPassed: false,
        lastVerifyAt: 0,
        // 迁移时是否对源/目标文件做完整 SHA-256 比对（migrate.js 读这个键）。
        // 默认关：大文件要读两遍，代价明显；浅校验（首尾采样）已能挡住绝大多数问题。
        deepVerify: false
    };

    var state = null;

    /* 站点名称面板的状态。**必须在这里声明**：init() 在 defer 脚本执行时
     * 可能同步运行（document.readyState 已是 interactive），而 var 只提升
     * 声明不提升赋值 —— 若写在 init 之后，首帧读到的是 undefined。
     * （2026-11-07 实测：siteQuery.toLowerCase 直接抛错，面板空白） */
    var siteRows = [];        // 当前展示的行（已筛选）
    var siteQuery = '';

    function $(id) { return document.getElementById(id); }

    function text(id, msg, color) {
        var el = $(id);
        if (!el) { return; }
        el.textContent = msg || '';
        el.style.color = color || '';
    }

    /* ---------------- 存储 ---------------- */

    /**
     * 读设置。storage 不可用（旧浏览器/权限收回/本地直接打开页面）时必须
     * 用默认值继续，**不能抛**：本函数在 defer 脚本末尾被 init() 同步调用，
     * 一旦异常就会中断整个 IIFE，后面的 SRC_LABEL、root.VRSettings 全部
     * 不会被赋值（2026-11-07 实测：站点名称面板空白 + VRSettings undefined）。
     */
    function load(cb) {
        var fallback = function () {
            setTimeout(function () {
                state = Object.assign({}, DEFAULTS);
                cb(state);
            }, 0);
        };
        try {
            chrome.storage.local.get(KEY, function (obj) {
                state = Object.assign({}, DEFAULTS, obj && obj[KEY]);
                cb(state);
            });
        } catch (e) {
            /* 必须异步回调：init() 在 defer 脚本末尾同步调用 load()，
             * 若这里同步执行 cb，init 会在 IIFE 还没跑完时执行，
             * 后面的 LIB_FIELDS / SRC_LABEL / root.VRSettings 全都没赋值
             * （2026-11-07 实测：面板空白 + VRSettings undefined）。 */
            fallback();
        }
    }

    /**
     * 写设置：先读一遍存储再合并 patch。
     * 为什么不是直接覆盖内存 state：这份 vrLibSettings 与图片设置（imgHover/imgMinSize…）
     * 共用同一个键，内存里的 state 只装资源库自己的字段；
     * 整体覆盖会把别人刚写进去的键抹掉（用户在图片面板改完再回来点这个开关就丢）。
     */
    function save(patch, cb) {
        chrome.storage.local.get(KEY, function (obj) {
            var cur = Object.assign({}, obj && obj[KEY], patch);
            state = Object.assign({}, DEFAULTS, cur);
            var o = {};
            o[KEY] = cur;
            chrome.storage.local.set(o, function () {
                if (cb) { cb(state); }
            });
        });
    }

    /* ---------------- FSA 句柄（IndexedDB） ---------------- */

    /* 2026-11-10 存储梳理：句柄统一存主库 vr-library/handle，
       旧独立库 vr-lib-handle 的读写实现已迁到 handle-store.js（一次性搬迁 + 兼容读取）。 */
    function idbPut(key, val) {
        var HS = root.VRHandleStore;
        if (!HS) { return Promise.resolve(null); }
        return HS.put(key, val).then(function () { return true; }, function () { return null; });
    }

    function idbGet(key) {
        var HS = root.VRHandleStore;
        if (!HS) { return Promise.resolve(null); }
        return HS.get(key).catch(function () { return null; });
    }

    /* ---------------- 索引状态（验证自动入库） ---------------- */

    function escHtml(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function refreshIndex() {
        chrome.runtime.sendMessage({ Message: 'vrLib.stats' }, function (r) {
            if (chrome.runtime.lastError || !r || !r.ok) {
                text('vrLibIndex', '未就绪（SW 未响应）', '#b26a00');
                return;
            }
            text('vrLibIndex', '已入库 ' + r.count + ' 条', r.count > 0 ? '#2e7d32' : '#666');
        });
        if (root.VRIndex && root.VRIndex.status) {
            root.VRIndex.status().then(function (s) {
                var msg = '已入库 ' + s.count + ' 条';
                if (s.missing) { msg += ' · 缺失 ' + s.missing; }
                /* 2026-11-14：越界条目单独报，不能混进「缺失」（那是两件事）。
                 * 用户需要知道「有 N 条素材不在素材库文件夹里，所以没被算进来」，
                 * 否则他会以为这些文件凭空消失了。 */
                if (s.outOfRoot) { msg += ' · 库外 ' + s.outOfRoot + ' 条（不计入）'; }
                if (s.snapshotAt) {
                    var d = new Date(s.snapshotAt);
                    msg += ' · 快照 ' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' +
                        ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
                }
                text('vrLibIndex', msg, s.count > 0 ? '#2e7d32' : '#666');
            }).catch(function () { /* 状态失败不覆盖原文案 */ });
        }
        chrome.runtime.sendMessage({ Message: 'vrLib.list' }, function (r) {
            if (chrome.runtime.lastError || !r || !r.ok) { return; }
            var el = $('vrLibRecent');
            if (!el) { return; }
            var list = (r.list || []).slice().sort(function (a, b) {
                return (b.mtime || 0) - (a.mtime || 0);
            }).slice(0, 5);
            el.innerHTML = list.length
                ? list.map(function (it) {
                    var rel = escHtml(it.relPath);
                    return '<div class="recent-item" title="' + rel + '">' + rel + '</div>';
                }).join('')
                : '—';
        });
    }

    /* ---------------- 渲染 ---------------- */

    var uiMode = '';             // 未保存前用户点选的模式；保存后与 state.mode 对齐
    var pendingHandle = null;    // 本次选择、尚未保存的目录句柄
    var pendingName = '';
    var pendingCount = null;
    var handleName = '';         // 已保存目录句柄的显示名（FSA 拿不到绝对路径）
    var scanBusy = false;
    /* 推导出的下载根绝对路径：只活在内存里，不落库（见 resolveDetectedRoot 注释）。
     * 换机器/换系统后这里自然重算，不会留下污染设置的脏值。 */
    var detectedRootCache = '';
    /* 已保存的目录句柄内存副本：让「恢复上次授权」点击时**同步**拿到句柄，
     * 不必在点下按钮后再 await IndexedDB（那样会丢掉用户手势）。
     * 由 refreshAuthState() 在页面加载/授权后顺带填。 */
    var savedRootHandle = null;

    function modeOf() {
        return (state && state.mode === 'custom') ? 'custom' : 'system';
    }

    function currentMode() {
        return uiMode || modeOf();
    }

    function baseNameOf(p) {
        return String(p || '').replace(/\\/g, '/').split('/').pop() || '';
    }

    /** 与库页 app.js 的 ensureRoot 同口径：从下载记录反推下载根目录 */
    function guessBase(list, subdir) {
        var want = '/' + String(subdir || 'video-rod') + '/';
        var i;
        for (i = 0; i < list.length; i++) {
            var f = String((list[i] || {}).filename || '').replace(/\\/g, '/');
            var k = f.indexOf(want);
            if (k > 0) { return f.slice(0, k); }
        }
        /* 2026-11-08 修：原来这里是「拿最近任意一条下载的父目录当下载根」。
         * 实测后果：测试浏览器的 …\.edge-login-profile\Webstore Downloads 被当成
         * 用户的下载目录，并 save() 进 vrLibSettings.detectedRoot，
         * 用户看到「系统默认下载文件夹被改了」。
         *
         * chrome.downloads 没有「系统默认下载目录」这个接口，只能从记录推断；
         * 而任意一条记录可能来自手动另存、临时目录或别的浏览器实例，
         * 不足以代表下载根。所以只认「路径里含 /<subdir>/」这条硬证据，
         * 没有就返回空 → 显示「未探测」，让用户自己确认。 */
        return '';
    }

    /**
     * 推导默认位置（仅供本次显示/索引使用，**不持久化**）。
     *
     * 2026-11-08 苏哥定调：「不要写死！要相对路径！相对路径就是系统默认的下载文件夹，
     * 不同系统是不同的。」
     *
     * 所以这里的关键变化：推导出来的绝对路径只放进内存缓存（detectedRootCache），
     * 不再 save() 进 vrLibSettings。理由：
     *   · 真正的下载位置由浏览器/系统决定，扩展无权也无必要记住它；
     *     chrome.downloads 的 filename 传的是相对路径，天然跨平台。
     *   · 一旦把绝对路径持久化，换机器/换系统/换下载目录后它就成了脏数据，
     *     还会被误当成「用户设置」，看起来像扩展改了他的下载文件夹。
     *   · 需要绝对路径只为了给索引/缩略图拼 file://，那是一个可丢弃的推导结果，
     *     每次按需重算即可，代价只是一次 downloads.search。
     */
    function resolveDetectedRoot(cb) {
        if (detectedRootCache) { if (cb) { cb(detectedRootCache); } return; }
        try {
            chrome.downloads.search({ limit: 50, orderBy: ['-startTime'] }, function (list) {
                detectedRootCache = guessBase(list || [], (state && state.subdir) || 'video-rod');
                render();
                if (cb) { cb(detectedRootCache); }
            });
        } catch (e) { if (cb) { cb(''); } }
    }

    function render() {
        if (!state) { return; }
        var mode = currentMode();

        var sub = $('vrLibSubdir');
        if (sub && document.activeElement !== sub) { sub.value = state.subdir || 'video-rod'; }

        var sys = $('vrLibModeSystem'), cus = $('vrLibModeCustom');
        if (sys) { sys.checked = mode === 'system'; }
        if (cus) { cus.checked = mode === 'custom'; }
        var optS = $('vrLibOptSystem'), optC = $('vrLibOptCustom');
        if (optS) { optS.classList.toggle('on', mode === 'system'); }
        if (optC) { optC.classList.toggle('on', mode === 'custom'); }

        var box = $('vrLibCustomBox');
        if (box) { box.hidden = mode !== 'custom'; }
        var subBox = $('vrLibSubdirBox');
        if (subBox) { subBox.hidden = mode === 'custom'; }
        var authBox = $('vrLibAuthBox');
        if (authBox) { authBox.hidden = mode === 'custom'; }

        var custom = $('vrLibCustomRoot');
        if (custom && document.activeElement !== custom) { custom.value = state.customRoot || ''; }

        var rootEl = $('vrLibRoot');
        if (rootEl) {
            var subdir = state.subdir || 'video-rod';
            /* 显示口径：有推导值就显示完整路径供参考；没有就明说「系统下载目录\<subdir>」。
             * 这里读的是内存缓存，不是持久化设置——扩展从不“记住”用户的下载根。 */
            var dr = detectedRootCache || '';
            if (dr) {
                var shown = String(dr + '\\' + subdir).replace(/\//g, '\\');
                rootEl.textContent = shown;
                rootEl.title = shown;
            } else {
                rootEl.textContent = '系统下载目录\\' + subdir + '（首次下载时自动创建）';
                rootEl.title = '';
            }
        }

        var nameEl = $('vrLibCustomName');
        if (nameEl) {
            var nm = pendingName || (state.mode === 'custom'
                ? (state.customRoot ? baseNameOf(state.customRoot) : handleName)
                : '');
            if (mode !== 'custom') {
                nameEl.textContent = '把素材存到你指定的文件夹；已有内容会扫描入库';
            } else if (!nm) {
                nameEl.textContent = '未选择（点下方「选择文件夹…」）';
            } else {
                nameEl.textContent = '已选择：' + nm +
                    (pendingCount != null ? ('，发现 ' + pendingCount + (pendingCount >= 5000 ? '+' : '') + ' 个媒体文件') : '');
            }
        }

        renderLibSettings();
    }

    /* ---------------- 保存位置：选择 / 扫描 / 保存 ---------------- */

    var SKIP_DIRS = { _verify: 1, _回收站: 1, _library: 1, _migration: 1, _selftest: 1 };

    function skipDirName(name) {
        return !name || name.charAt(0) === '.' || SKIP_DIRS[name] || /\.(part|crdownload|tmp)$/i.test(name);
    }

    function isMediaName(name) {
        try { return root.VRPath.typeOf({ fileName: name }) !== 'other'; } catch (e) { return false; }
    }

    /** 选目录时先数一下会导入多少，别让用户点保存后才发现很大 */
    async function countMediaInHandle(handle, limit) {
        var cap = limit || 5000;
        var n = 0;
        async function walk(dir, depth) {
            if (n >= cap || depth > 6) { return; }
            for await (var entry of dir.entries()) {
                var name = entry[0], eh = entry[1];
                if (skipDirName(name)) { continue; }
                if (eh.kind === 'file') {
                    if (isMediaName(name)) { n++; }
                } else {
                    await walk(eh, depth + 1);
                }
                if (n >= cap) { return; }
            }
        }
        await walk(handle, 0);
        return n;
    }

    /**
     * FSA 只给目录句柄，拿不到绝对路径。这里用「文件名 + 大小」对一遍下载记录：
     * 只要目录里有任意一个文件是浏览器下载过的，就能反推出这个目录的绝对路径。
     * 对不上就返回空——预览走句柄，不阻塞保存。
     */
    async function inferAbsRoot(handle) {
        var list = await new Promise(function (resolve) {
            try {
                chrome.downloads.search({ limit: 5000, orderBy: ['-startTime'] }, function (l) {
                    void chrome.runtime.lastError;
                    resolve(l || []);
                });
            } catch (e) { resolve([]); }
        });
        var byKey = {};
        list.forEach(function (d) {
            if (!d || d.state !== 'complete' || !d.filename) { return; }
            var k = baseNameOf(d.filename).toLowerCase() + '|' + (d.fileSize || d.totalBytes || 0);
            if (!byKey[k]) { byKey[k] = d.filename; }
        });
        if (!Object.keys(byKey).length) { return ''; }

        var hit = null, seen = 0;
        async function walk(dir, rel, depth) {
            if (hit || depth > 5 || seen > 500) { return; }
            for await (var entry of dir.entries()) {
                var name = entry[0], eh = entry[1];
                if (skipDirName(name)) { continue; }
                var r = rel ? (rel + '/' + name) : name;
                if (eh.kind === 'file') {
                    seen++;
                    try {
                        var f = await eh.getFile();
                        var k = name.toLowerCase() + '|' + f.size;
                        if (byKey[k]) { hit = { abs: byKey[k], rel: r }; return; }
                    } catch (e) { /* 跳过读不了的文件 */ }
                } else {
                    await walk(eh, r, depth + 1);
                }
                if (hit || seen > 500) { return; }
            }
        }
        try { await walk(handle, '', 0); } catch (e) { return ''; }
        if (!hit) { return ''; }

        var dir = String(hit.abs).replace(/\\/g, '/');
        var cut = dir.lastIndexOf('/');
        if (cut > 0) { dir = dir.slice(0, cut); }
        var segs = hit.rel.split('/');
        segs.pop();                                  // 去掉文件名
        for (var i = 0; i < segs.length; i++) {
            var k2 = dir.lastIndexOf('/');
            if (k2 <= 2) { break; }                   // 别把盘符削掉
            dir = dir.slice(0, k2);
        }
        return dir.replace(/\//g, '\\');
    }

    function pickCustom() {
        if (typeof root.showDirectoryPicker !== 'function') {
            text('vrLibCustomMsg', '此浏览器不支持目录选择（需 Chrome 86+）', '#c0392b');
            return;
        }
        root.showDirectoryPicker({ mode: 'readwrite' }).then(function (h) {
            var display = h.name || '已选文件夹';
            pendingHandle = h;
            pendingName = display;
            pendingCount = null;
            uiMode = 'custom';
            render();
            text('vrLibCustomMsg', '已选择：' + display + '，正在检查已有文件…', '#666');
            return idbPut('root', h).catch(function () { return null; }).then(function () {
                return countMediaInHandle(h).catch(function () { return null; });
            }).then(function (n) {
                pendingCount = n;
                render();
                return inferAbsRoot(h).catch(function () { return ''; });
            }).then(function (abs) {
                if (abs) {
                    var input = $('vrLibCustomRoot');
                    if (input && !String(input.value || '').trim()) { input.value = abs; }
                }
                text('vrLibCustomMsg',
                    '已选择：' + display +
                    (pendingCount != null ? ('，发现 ' + pendingCount + (pendingCount >= 5000 ? '+' : '') + ' 个媒体文件') : '') +
                    '；点「保存并使用」开始入库', '#2e7d32');
            });
        }).catch(function (e) {
            if (e && e.name === 'AbortError') { return; }   // 用户取消
            text('vrLibCustomMsg', '选择失败：' + ((e && e.message) || e), '#c0392b');
        });
    }

    /** 授权成功 → 顺便问要不要备份扩展程序（苏哥 2026-11-10）。
     *  用设置页的 vrLibAuthMsg 作为反馈位；备份失败绝不干扰授权本身。 */
    function offerKitBackup(handle) {
        try {
            var K = root.VRExportKit;
            if (!K || typeof K.offerBackup !== 'function') { return; }
            K.offerBackup(handle, function (m, kind) {
                text('vrLibAuthMsg', m, kind === 'ok' ? '#2e7d32' : (kind === 'err' ? '#c0392b' : '#666'));
            });
        } catch (e) { /* 忽略 */ }
    }

    /** 浏览器「文件编辑」权限页的本地地址。目录选择被站点设置拦死时，
     *  只能请用户自己去改，给对路径才有人能照做（Chrome 与 Edge 前缀不同）。 */
    function fileEditingSettingsUrl() {
        var ua = '';
        try { ua = String(navigator.userAgent || ''); } catch (e) { ua = ''; }
        return /Edg\//.test(ua)
            ? 'edge://settings/content/fileEditing'
            : 'chrome://settings/content/fileEditing';
    }

    /** 把 showDirectoryPicker 的报错翻成**用户能照做**的中文。
     *
     *  为什么不能直接甩原文（2026-11-13 苏哥报障复盘）：
     *  原样显示就是一句英文 "The request is not allowed by the user agent or the
     *  platform in the current context."，用户看不出该改哪、还以为扩展坏了。
     *
     *  这句兜底文案的成因要分清（按可能性排）：
     *   1) 用户激活已过期 —— content 层 `kConsumeTransientActivation` 失败返回
     *      kPermissionDenied；新内核带 "User activation required."，**较老内核
     *      不带 message，就落到这句 DOMException 默认文案**。判断依据：
     *      同一个 origin 下同步调用的「选择文件夹…」能正常弹框 → 说明不是权限被禁。
     *   2) 站点设置把「文件编辑」设成「阻止」—— 该 origin 的 fileEditing 权限
     *      不是 ASK/ALLOW，选择器根本不弹（此时「选择文件夹…」也会一起失败）。
     *  两种出路完全不同，所以先让用户重试（1），再给设置页路径（2）兜底。
     */
    function describePickerError(e) {
        var name = (e && e.name) || '';
        var msg = String((e && e.message) || e || '');
        if (/user gesture|user activation/i.test(msg)) {
            return '浏览器没把这次点击算作有效操作。请刷新本页后**立刻**再点一次按钮' +
                '（点击后别停留、别切到别的窗口）。';
        }
        if (name === 'NotAllowedError') {
            return '浏览器没同意这次目录请求。最常见的原因是点击后等待太久、' +
                '这次操作已不再被认可 —— 先刷新本页并立刻重试。' +
                '若反复如此，再检查浏览器设置：打开 ' + fileEditingSettingsUrl() +
                ' 确认「文件编辑」是「允许」或「询问」，改完完全退出浏览器再重开；' +
                'Edge 的「增强安全性模式」若为「严格」，调成「平衡」。';
        }
        if (name === 'SecurityError') {
            return '当前页面不被允许选择目录（可能被安全策略限制）。' +
                '请确认这是从扩展设置页打开的页面，并给该扩展放开「文件编辑」权限：' +
                fileEditingSettingsUrl();
        }
        return msg;
    }

    /** 默认位置授权：**先同步弹出目录选择器**，拿到句柄后再做异步处理。
     *
     * 为什么选择器要放最前（2026-11-13，苏哥 Win11 报错后复盘）：
     *   showDirectoryPicker() 要求调用时仍在 transient activation（用户手势）内。
     *   旧实现先 await VRDB.getHandle → idbGet（内含 handle-store 的旧库迁移）
     *   → 有句柄时再 await requestPermission，之后才弹选择器。IndexedDB 一慢，
     *   激活期就过了。同仓库 js/library/app.js 的 authorizeRoot() 与下面的
     *   pickCustom() 早就是「先弹选择器」，只有这里漏改。
     *
     * 报错文案怎么读（Chromium 源码取证，别再猜）：
     *   · `NotAllowedError` + "The request is not allowed by the user agent or the
     *     platform in the current context." —— 这是 DOMException 的**兜底文案**，
     *     出现在 kPermissionDenied 且没带自定义 message 时。典型成因：
     *       (a) 站点内容设置把「文件编辑」设成了「阻止」（该 origin 的
     *           fileEditing 权限不是 ASK/ALLOW，浏览器直接不弹选择器）；
     *       (b) 较老内核里 content 层的手势检查同样走 kPermissionDenied 无文案。
     *   · `SecurityError` + "Must be handling a user gesture to show a file picker."
     *     —— 渲染层的手势检查，即「await 把激活期耗掉了」。
     *   · `NotAllowedError` + "User activation required." —— 新内核 content 层的手势检查。
     *   三种要分别处理：前两种要先修浏览器设置，最后一种才是调整调用顺序。
     *
     * 已有句柄的静默恢复已拆到 restoreAuth()，不再占用本条链路的用户手势。
     */
    async function authDefault() {
        if (typeof root.showDirectoryPicker !== 'function') {
            text('vrLibAuthMsg', '此浏览器不支持目录选择（需 Chrome 86+）', '#c0392b');
            return;
        }
        var sub = cleanSeg($('vrLibSubdir') ? $('vrLibSubdir').value : state.subdir);
        var base = detectedRootCache
            ? (String(detectedRootCache).replace(/\/+$/, '') + '/' + sub)
            : '';
        var parent = detectedRootCache ? baseNameOf(detectedRootCache) : '';
        /* ↑ 以上全是同步计算。在下面这行 await 之前**不许插入任何 await**，
         *   否则就是本次要修的那个 bug。 */
        var picked;
        try {
            picked = await root.showDirectoryPicker({ mode: 'readwrite' });
        } catch (e) {
            /* 用户取消：静默；其余翻成人话，别让用户对着英文原文猜 */
            if (e && e.name === 'AbortError') { return; }
            text('vrLibAuthMsg', '授权失败：' + describePickerError(e), '#c0392b');
            return;
        }
        /* 以下是选择器返回之后的处理，所有 await 都在激活期之外，安全 */
        if (picked.name !== sub) {
            if (!parent || picked.name !== parent) {
                text('vrLibAuthMsg', '请选择「' + sub + '」文件夹' +
                    (parent ? ('，或它的上级「' + parent + '」') : ''), '#c0392b');
                return;
            }
            try { picked = await picked.getDirectoryHandle(sub, { create: true }); }
            catch (e2) {
                text('vrLibAuthMsg', '无法打开或创建「' + sub + '」文件夹', '#c0392b');
                return;
            }
        }
        try {
            await root.VRIndex.setRoot(picked, base, sub);
            await idbPut('root', picked);
            savedRootHandle = picked;
            handleName = picked.name || handleName;
            render();
            text('vrLibAuthMsg', '已授权写入' +
                (base ? ('：' + base.replace(/\//g, '\\')) : ('：' + picked.name)), '#2e7d32');
            refreshAuthState();
            offerKitBackup(picked);
        } catch (e) {
            text('vrLibAuthMsg', '授权失败：' + ((e && e.message) || e), '#c0392b');
        }
    }

    /** 恢复上次授权：不弹选择器，直接对**已缓存**的句柄 requestPermission。
     *
     * 为什么单拆成按钮（2026-11-13）：
     *   旧实现把「静默恢复」塞在「授权写入」开头，导致用户每点一次都要先等一串
     *   IndexedDB 读取（含旧句柄库迁移），手势过期后选择器直接报
     *   NotAllowedError——结果恢复没做成、选目录也做不了，两个功能一起坏。
     *   现在句柄由 refreshAuthState() 事先读进内存（那次读取发生在页面加载，
     *   不要求手势），点击这里时同步调用 requestPermission()，不会错过激活期。
     */
    function restoreAuth() {
        var sub = cleanSeg($('vrLibSubdir') ? $('vrLibSubdir').value : state.subdir);
        var base = detectedRootCache
            ? (String(detectedRootCache).replace(/\/+$/, '') + '/' + sub)
            : '';
        var parent = detectedRootCache ? baseNameOf(detectedRootCache) : '';
        var h = savedRootHandle;
        if (!h) {
            text('vrLibAuthMsg', '没有可恢复的授权，请点「授权写入」选择文件夹', '#b26a00');
            showRestore(false);
            return;
        }
        /* 旧版本可能存了错目录的句柄（如 download）。只接受本目录或它的上级，
         * 否则恢复完仍然不能写，还会把用户困在「已授权」的假象里。
         * （原 authDefault() 里同一条校验，拆函数时一并搬过来。） */
        if (h.name !== sub && (!parent || h.name !== parent)) {
            text('vrLibAuthMsg', '上次授权的是「' + h.name + '」，不是「' + sub +
                '」；点「授权写入」重新选择', '#b26a00');
            showRestore(false);
            return;
        }
        text('vrLibAuthMsg', '正在恢复权限…', '#666');
        /* 用户手势内同步发起；前面不许 await 任何读取 */
        var p = (typeof h.requestPermission === 'function')
            ? h.requestPermission({ mode: 'readwrite' })
            : Promise.resolve('granted');
        p.then(function (grant) {
            if (grant !== 'granted') {
                text('vrLibAuthMsg', '恢复失败：浏览器没有放行（' + grant +
                    '）；点「授权写入」重新选择', '#c0392b');
                refreshAuthState();
                return;
            }
            return (async function () {
                var dir = h;
                if (dir.name !== sub) {
                    try { dir = await dir.getDirectoryHandle(sub, { create: true }); }
                    catch (e) { dir = null; }
                    if (!dir) {
                        text('vrLibAuthMsg', '无法打开或创建「' + sub + '」文件夹', '#c0392b');
                        return;
                    }
                }
                await root.VRIndex.setRoot(dir, base, sub);
                await idbPut('root', dir);
                savedRootHandle = dir;
                handleName = dir.name || handleName;
                render();
                text('vrLibAuthMsg', '已恢复写入权限' +
                    (base ? ('：' + base.replace(/\//g, '\\')) : ''), '#2e7d32');
                refreshAuthState();
                offerKitBackup(dir);
            })();
        }).catch(function (e) {
            text('vrLibAuthMsg', '恢复失败：' + ((e && e.message) || e), '#c0392b');
            refreshAuthState();
        });
    }

    /** 「恢复上次授权」按钮只在「有句柄但权限被收回」时出现 */
    function showRestore(on) {
        var b = $('vrLibAuthRestore');
        if (b) { b.hidden = !on; }
    }

    /** 设置页显示当前写入授权状态；浏览器收回权限时给出可操作提示 */
    async function refreshAuthState() {
        var msg = $('vrLibAuthMsg');
        if (!msg || !state) { return; }
        var h = null;
        try { h = await root.VRDB.getHandle('root'); } catch (e) { /* 忽略 */ }
        if (!h) { try { h = await idbGet('root'); } catch (e) { /* 忽略 */ } }
        /* 顺手缓存给 restoreAuth()：那次点击里不许再 await 读取，
         * 否则用户手势会在 IndexedDB 往返中过期（本次 bug 的成因）。
         * 页面加载时 refreshAuthState() 本来就会跑一遍，这里读到的就是最新句柄。 */
        savedRootHandle = h || null;
        if (!h) {
            msg.textContent = '未授权写入（可选）；下载和浏览不受影响';
            msg.style.color = '';
            showRestore(false);
            return;
        }
        var sub = cleanSeg(($('vrLibSubdir') && $('vrLibSubdir').value) || (state && state.subdir));
        var parent = detectedRootCache ? baseNameOf(detectedRootCache) : '';
        if (h.name !== sub && (!parent || h.name !== parent)) {
            msg.textContent = '当前授权的是「' + h.name + '」，不是「' + sub + '」；点「授权写入」重新选择';
            msg.style.color = '#b26a00';
            /* 错目录不能恢复，只能重选 */
            showRestore(false);
            return;
        }
        var st = 'granted';
        try {
            if (h.queryPermission) { st = await h.queryPermission({ mode: 'readwrite' }); }
        } catch (e) { st = 'error'; }
        if (st === 'granted') {
            var p = detectedRootCache
                ? (detectedRootCache + '\\' + (state.subdir || 'video-rod')).replace(/\//g, '\\')
                : (h.name || '');
            msg.textContent = '已授权写入：' + p;
            msg.style.color = '#2e7d32';
            showRestore(false);
        } else {
            msg.textContent = '已选过目录，但浏览器暂时收回了写入权限；点「恢复上次授权」即可，不用重选';
            msg.style.color = '#b26a00';
            /* 句柄还在、只是权限变成 prompt/denied：这才值得亮出恢复按钮 */
            showRestore(true);
        }
    }

    function dropRootHandle() {
        pendingHandle = null;
        pendingName = '';
        pendingCount = null;
        handleName = '';
        /* 句柄已丢弃，恢复按钮与缓存必须同步清掉，否则会出现「点了没反应」 */
        savedRootHandle = null;
        showRestore(false);
        try { idbPut('root', null); } catch (e) { /* 忽略 */ }
        try {
            if (root.VRIndex && root.VRIndex.setRoot) { root.VRIndex.setRoot(null, '', ''); }
        } catch (e) { /* 忽略 */ }
    }

    function saveAll() {
        if (scanBusy || !state) { return; }
        var mode = currentMode();
        var subEl = $('vrLibSubdir');
        var sub = cleanSeg(subEl ? subEl.value : state.subdir);

        if (mode === 'system') {
            var wasCustom = state.mode === 'custom';
            save({ mode: 'system', subdir: sub }, function () {
                uiMode = 'system';
                if (wasCustom) { dropRootHandle(); }
                render();
                text('vrLibSaveMsg', '正在识别下载目录…', '#666');
                resolveDetectedRoot(function (base) {
                    var target = base ? (String(base).replace(/\//g, '\\') + '\\' + sub) : ('系统下载目录\\' + sub);
                    text('vrLibSaveMsg',
                        '已保存：' + target + (base ? '' : '（首次下载时自动创建）'), '#2e7d32');
                });
            });
            return;
        }

        var h = pendingHandle;
        var absEl = $('vrLibCustomRoot');
        var abs = String((absEl && absEl.value) || state.customRoot || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
        if (!h) {
            if (state.mode !== 'custom') {
                text('vrLibSaveMsg', '请先点「选择文件夹…」选一个目录', '#b26a00');
                return;
            }
            idbGet('root').then(function (saved) {
                if (!saved) {
                    text('vrLibSaveMsg', '请先点「选择文件夹…」选一个目录', '#b26a00');
                    return;
                }
                pendingHandle = saved;
                saveCustom(saved, abs, sub);
            }).catch(function () {
                text('vrLibSaveMsg', '请先点「选择文件夹…」选一个目录', '#b26a00');
            });
            return;
        }
        saveCustom(h, abs, sub);
    }

    function saveCustom(handle, abs, sub) {
        scanBusy = true;
        handleName = handle.name || handleName;
        text('vrLibSaveMsg', '正在保存…', '#666');
        save({ mode: 'custom', customRoot: abs, subdir: sub }, async function () {
            uiMode = 'custom';
            render();
            try { await idbPut('root', handle); } catch (e) { /* 忽略 */ }
            try {
                if (root.VRIndex && root.VRIndex.setRoot) {
                    /* 2026-11-14：这是**用户显式换库**（设置页「选择文件夹…」），
                     * 必须走 rebase —— 否则「旧 customRoot 还留着、这次选了另一个目录」
                     * 会被当成层级错误拒绝，用户明明选对了却存不进去。
                     * rebase 不做名字校验，但会带回 layer，扫描范围因此如实可见。 */
                    await root.VRIndex.setRoot(handle, abs, sub, { mode: 'rebase' });
                }
            } catch (e) { /* 内存态失败不影响本次扫描，下面会报错 */ }

            text('vrLibSaveMsg', '已保存，正在扫描已有素材…', '#666');
            try {
                if (!root.VRIndex) { throw new Error('索引模块未加载'); }
                var r = await root.VRIndex.build({
                    mode: 'full',
                    /* 首次导入自选文件夹时不要把旧位置的条目判成缺失：
                     * 这不是「文件被删」，只是换了库根。保留旧条目，用户可切回。 */
                    markMissing: false,
                    onProgress: function (p) {
                        if (p && p.total) {
                            text('vrLibSaveMsg', '正在扫描 ' + p.done + ' / ' + p.total + '…', '#666');
                        }
                    }
                });
                var un = 0;
                try {
                    var all = await root.VRDB.getAllFiles();
                    un = all.filter(function (f) { return f && f.untracked; }).length;
                } catch (e) { /* 统计失败不影响结果 */ }
                text('vrLibSaveMsg',
                    '已保存并入库：' + (r.ok || 0) + ' 个文件' +
                    (un ? ('，其中 ' + un + ' 个在「未整理」') : '') +
                    '。原有文件未移动。', '#2e7d32');
                refreshIndex();
            } catch (e) {
                text('vrLibSaveMsg', '已保存，但扫描失败：' + ((e && e.message) || e), '#c0392b');
            } finally {
                scanBusy = false;
                pendingHandle = null;
                pendingName = '';
                pendingCount = null;
                render();
            }
        });
    }

    /* ---------------- 校验落盘 ---------------- */

    function cleanSeg(s) {
        return String(s || '').replace(/[<>:"|?*\\\/\u0000-\u001F]/g, '_').trim() || 'video-rod';
    }

    function verify() {
        var sub = cleanSeg(state.subdir);
        var ts = Date.now();
        var rel = sub + '/_verify/' + ts + '.txt';
        var body = 'video-rod verify ' + new Date().toISOString();
        var url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(body);

        text('vrLibVerifyMsg', '正在写入微下载…', '#666');
        chrome.downloads.download({ url: url, filename: rel, conflictAction: 'overwrite' }, function (id) {
            if (!id) {
                var le = chrome.runtime.lastError;
                text('vrLibVerifyMsg', '失败：' + (le ? le.message : '无法发起下载'), '#c0392b');
                return;
            }
            var tries = 0;
            var timer = setInterval(function () {
                chrome.downloads.search({ id: id }, function (list) {
                    var d = list && list[0];
                    if (!d) {
                        clearInterval(timer);
                        text('vrLibVerifyMsg', '失败：下载记录丢失', '#c0392b');
                        return;
                    }
                    if (d.state !== 'complete' && d.state !== 'interrupted') {
                        if (++tries > 60) {
                            clearInterval(timer);
                            text('vrLibVerifyMsg', '超时：文件未写完', '#c0392b');
                        }
                        return;
                    }
                    clearInterval(timer);
                    finish(d, rel);
                });
            }, 300);
        });
    }

    function finish(d, rel) {
        var abs = String(d.filename || '').replace(/\\/g, '/');
        var tail = '/' + rel;
        var rootDir = '';
        if (abs.length > tail.length && abs.slice(-tail.length) === tail) {
            rootDir = abs.slice(0, abs.length - tail.length);
        }

        chrome.downloads.removeFile(d.id, function () {
            chrome.downloads.erase({ id: d.id }, function () { /* 记录一并清掉 */ });
        });

        if (d.state === 'interrupted') {
            text('vrLibVerifyMsg', '写入被中断：' + (d.error || '未知原因'), '#c0392b');
            return;
        }
        if (!rootDir) {
            text('vrLibVerifyMsg', '写入成功但无法反推根目录：' + abs, '#c0392b');
            return;
        }

        var okSub = abs.indexOf('/' + rel) !== -1;
        save({
            detectedRoot: rootDir,
            verifyPassed: okSub,
            lastVerifyAt: Date.now()
        }, function (s) {
            render();
            text('vrLibVerifyMsg',
                okSub ? ('通过：实际落盘 ' + abs + '（根目录 ' + rootDir + '）')
                      : ('异常：落点不在子目录内 ' + abs),
                okSub ? '#2e7d32' : '#c0392b');
        });
    }

    /* ---------------- 索引维护（S2） ---------------- */

    function absRootNow() {
        if ((state.mode || 'system') === 'custom') {
            return String(state.customRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        }
        var rootDir = String(detectedRootCache || '').replace(/\\/g, '/').replace(/\/+$/, '');
        return rootDir ? (rootDir + '/' + (state.subdir || 'video-rod')) : '';
    }

    function bindIndex() {
        var build = $('vrLibIdxBuild');
        if (build) {
            build.addEventListener('click', function () {
                if (!root.VRIndex) { text('vrLibIdxMsg', '索引模块未加载', '#c0392b'); return; }
                text('vrLibIdxMsg', '正在从下载记录重建…', '#666');
                root.VRIndex.build({ mode: 'downloads' }).then(function (r) {
                    text('vrLibIdxMsg', '重建完成：' + r.ok + ' 条' +
                        (r.missing ? '（标记缺失 ' + r.missing + '）' : ''), '#2e7d32');
                    refreshIndex();
                }).catch(function (e) {
                    text('vrLibIdxMsg', '失败：' + (e && e.message || e), '#c0392b');
                });
            });
        }

        var snap = $('vrLibIdxSnap');
        if (snap) {
            snap.addEventListener('click', function () {
                if (!root.VRIndex) { text('vrLibIdxMsg', '索引模块未加载', '#c0392b'); return; }
                text('vrLibIdxMsg', '正在写快照…', '#666');
                root.VRIndex.snapshot().then(function (p) {
                    text('vrLibIdxMsg', '快照已写入 ' + p, '#2e7d32');
                    refreshIndex();
                }).catch(function (e) {
                    text('vrLibIdxMsg', '失败：' + (e && e.message || e), '#c0392b');
                });
            });
        }

        var full = $('vrLibIdxFull');
        if (full) {
            full.addEventListener('click', function () {
                if (!root.VRIndex) { text('vrLibIdxMsg', '索引模块未加载', '#c0392b'); return; }
                if (typeof root.showDirectoryPicker !== 'function') {
                    text('vrLibIdxMsg', '此浏览器不支持目录选择（需 Chrome 86+）', '#c0392b');
                    return;
                }
                var abs = absRootNow();
                if (!abs) {
                    text('vrLibIdxMsg', '请先点「校验落盘」确定根目录（自定义模式请先填路径）', '#b26a00');
                    return;
                }
                root.showDirectoryPicker({ mode: 'read' }).then(function (h) {
                    /* 2026-11-14：补上 prefix —— 不传的话 setRoot 拿不到「期望层名」，
                     * 校验会被跳过，选到上级目录也能直接开始扫（正是越界入口之一）。 */
                    return root.VRIndex.setRoot(h, abs, state.subdir || 'video-rod').then(function () {
                        return root.VRIndex.build({ mode: 'full' });
                    });
                }).then(function (r) {
                    text('vrLibIdxMsg', '全量扫描完成：' + r.ok + ' 条' +
                        (r.missing ? '（标记缺失 ' + r.missing + '）' : ''), '#2e7d32');
                    refreshIndex();
                }).catch(function (e) {
                    if (e && e.name === 'AbortError') { return; }
                    text('vrLibIdxMsg', '失败：' + (e && e.message || e), '#c0392b');
                });
            });
        }

        /* 备份/恢复按钮（阶段 4） */
        try { bindBackup(); } catch (e) { /* 按钮不存在时忽略 */ }
    }

    /* ---------------- 备份 / 恢复（阶段 4） ----------------
     *
     * 为什么需要这两个按钮：
     *   用户真实的备份动作是「把整个素材文件夹拷到移动硬盘」。
     *   但 `_library/` 里是散落的 index.json + thumbs/*.webp，
     *   没有工具时难以确认「到底备份全了没有」。
     *   导出一个整包 zip，恢复时直接读回，是最不容易出错的形态。
     *
     * 口径：
     *   · 导出 = 只打包 `_library/`（索引 + 收藏夹 + 缩略图），不碰素材本体
     *   · 恢复 = 从已授权的目录读 `_library/index.json` 重放，不删任何东西
     */

    /** 列出一组目录下所有文件（递归，仅文件） */
    async function listFiles(dir, prefix) {
        var out = [];
        try {
            for await (var e of dir.entries()) {
                var name = e[0], h = e[1];
                var rel = prefix ? (prefix + '/' + name) : name;
                if (h.kind === 'file') {
                    out.push({ rel: rel, handle: h });
                } else {
                    var sub = await listFiles(h, rel);
                    out = out.concat(sub);
                }
            }
        } catch (err) { /* 单个子目录读不到不影响其余 */ }
        return out;
    }

    function bindBackup() {
        var exp = $('vrLibExport');
        if (exp) {
            exp.addEventListener('click', function () {
                if (typeof root.showDirectoryPicker !== 'function') {
                    text('vrLibIdxMsg', '此浏览器不支持目录选择', '#c0392b');
                    return;
                }
                text('vrLibIdxMsg', '请选择资源库根目录（含 _library 的那一层）…', '#666');
                root.showDirectoryPicker({ mode: 'read' }).then(async function (h) {
                    var lib;
                    try {
                        lib = await h.getDirectoryHandle('_library');
                    } catch (e) {
                        throw new Error('这个目录里没有 _library 子目录');
                    }
                    var files = await listFiles(lib, '');
                    if (!files.length) { throw new Error('_library 里没有文件'); }

                    text('vrLibIdxMsg', '正在打包 ' + files.length + ' 个文件…', '#666');
                    /* 零依赖打包：用最简 STORE（不压缩）zip，避免引入库。
                     * 索引是 JSON、缩略图已是 webp，再压缩收益很小。 */
                    var entries = [];
                    for (var i = 0; i < files.length; i++) {
                        var f = await files[i].handle.getFile();
                        entries.push({ name: '_library/' + files[i].rel, file: f });
                    }
                    var blob = await makeZip(entries);
                    downloadBlob(blob, '_library-backup.zip');
                    text('vrLibIdxMsg', '已导出 ' + files.length + ' 个文件（' +
                        Math.round(blob.size / 1048576 * 10) / 10 + ' MB）', '#2e7d32');
                }).catch(function (e) {
                    if (e && e.name === 'AbortError') { return; }
                    text('vrLibIdxMsg', '导出失败：' + (e && e.message || e), '#c0392b');
                });
            });
        }

        var res = $('vrLibRestore');
        if (res) {
            res.addEventListener('click', function () {
                if (!root.VRIndex) { text('vrLibIdxMsg', '索引模块未加载', '#c0392b'); return; }
                if (typeof root.showDirectoryPicker !== 'function') {
                    text('vrLibIdxMsg', '此浏览器不支持目录选择', '#c0392b');
                    return;
                }
                text('vrLibIdxMsg', '请选择资源库根目录（含 _library 的那一层）…', '#666');
                root.showDirectoryPicker({ mode: 'read' }).then(function (h) {
                    /* 同上：恢复快照也必须确认句柄落在库根层，
                     * 否则会从上级目录读快照 / 把上级当成库根。 */
                    return root.VRIndex.setRoot(h, absRootNow(), state.subdir || 'video-rod').then(function () {
                        return root.VRIndex.build({ mode: 'snapshot' });
                    });
                }).then(function (r) {
                    text('vrLibIdxMsg', '恢复完成：读回 ' + r.ok + ' 条' +
                        (r.missing ? '（其中 ' + r.missing + ' 条标记缺失）' : ''), '#2e7d32');
                    refreshIndex();
                }).catch(function (e) {
                    if (e && e.name === 'AbortError') { return; }
                    text('vrLibIdxMsg', '恢复失败：' + (e && e.message || e), '#c0392b');
                });
            });
        }
    }

    /** 极简 STORE 模式 zip：实现在 js/library/zip.js（可单测），这里只做 Blob 包装。
     *  为什么不内联：zip 头部字段错一个字节解压就报损坏，而这类错平时不会被发现，
     *  必须靠 tools/test-zip.js 的结构化断言兜住。 */
    async function makeZip(entries) {
        if (!root.VRZip) { throw new Error('zip 模块未加载（js/library/zip.js）'); }
        var list = [];
        for (var i = 0; i < entries.length; i++) {
            var data = new Uint8Array(await entries[i].file.arrayBuffer());
            list.push({ name: entries[i].name, data: data });
        }
        return new Blob([root.VRZip.build(list)], { type: 'application/zip' });
    }

    function downloadBlob(blob, filename) {
        try {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
                if (a.parentNode) { a.parentNode.removeChild(a); }
            }, 1000);
        } catch (e) {
            text('vrLibIdxMsg', '下载触发失败：' + (e && e.message || e), '#c0392b');
        }
    }

    /* ---------------- 事件绑定 ---------------- */

    function bind() {
        var sub = $('vrLibSubdir');
        var saveBtn = $('vrLibSaveSubdir');
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                var v = cleanSeg(sub && sub.value);
                if (sub) { sub.value = v; }
                saveAll();
            });
        }

        ['vrLibModeSystem', 'vrLibModeCustom'].forEach(function (id) {
            var radio = $(id);
            if (!radio) { return; }
            radio.addEventListener('change', function () {
                if (!radio.checked) { return; }
                uiMode = radio.value;
                render();
                if (uiMode === 'custom') {
                    text('vrLibCustomMsg', pendingHandle ? '点「保存并使用」开始入库'
                        : '先点「选择文件夹…」选一个目录', '#666');
                }
            });
        });

        var custom = $('vrLibCustomRoot');
        if (custom) {
            custom.addEventListener('change', function () {
                if (currentMode() !== 'custom') { return; }
                save({ customRoot: String(custom.value || '').trim() });
            });
        }

        var pick = $('vrLibPickDir');
        if (pick) { pick.addEventListener('click', pickCustom); }

        var authBtn = $('vrLibAuthDefault');
        if (authBtn) { authBtn.addEventListener('click', authDefault); }

        /* 恢复上次授权：不弹选择器，所以不占用户手势，单独一个按钮 */
        var restoreBtn = $('vrLibAuthRestore');
        if (restoreBtn) { restoreBtn.addEventListener('click', restoreAuth); }

        var verifyBtn = $('vrLibVerify');
        if (verifyBtn) { verifyBtn.addEventListener('click', verify); }

        var refresh = $('vrLibRefresh');
        if (refresh) { refresh.addEventListener('click', refreshIndex); }

        var openPage = $('vrLibOpenPage');
        if (openPage) {
            openPage.addEventListener('click', function () {
                chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
            });
        }

        /* 直达链接（2026-11-08）：扩展没有固定 key，ID 随加载路径变，
         * 所以地址必须运行时取，不能写死在 HTML 里。 */
        var urlBox = $('vrLibUrl');
        var libUrl = '';
        try { libUrl = chrome.runtime.getURL('library.html'); } catch (e) { libUrl = ''; }
        if (urlBox && libUrl) { urlBox.value = libUrl; }

        var copyBtn = $('vrLibUrlCopy');
        if (copyBtn) {
            copyBtn.addEventListener('click', async function () {
                if (!libUrl) { return; }
                try {
                    await navigator.clipboard.writeText(libUrl);
                    copyBtn.textContent = '已复制';
                    setTimeout(function () { copyBtn.textContent = '复制'; }, 1500);
                } catch (e) {
                    /* 剪贴板被拒（窗口没聚焦 / 无权限）时退回手选，别让用户卡住 */
                    if (urlBox) { urlBox.focus(); urlBox.select(); }
                    copyBtn.textContent = '请按 Ctrl+C';
                    setTimeout(function () { copyBtn.textContent = '复制'; }, 2500);
                }
            });
        }

        /* 加书签：chrome.bookmarks 需要 "bookmarks" 权限。
         * 没权限时明确告诉用户，而不是静默失败。 */
        var bmBtn = $('vrLibUrlBookmark');
        if (bmBtn) {
            bmBtn.addEventListener('click', function () {
                if (!libUrl) { return; }
                var api = chrome.bookmarks;
                if (!api || typeof api.create !== 'function') {
                    bmBtn.textContent = '无书签权限';
                    setTimeout(function () { bmBtn.textContent = '加书签'; }, 2500);
                    return;
                }
                try {
                    api.create({ title: '媒体库 · 苏哥的钓鱼竿', url: libUrl }, function (node) {
                        var err = chrome.runtime.lastError;
                        if (err) {
                            bmBtn.textContent = '添加失败';
                            setTimeout(function () { bmBtn.textContent = '加书签'; }, 2500);
                            return;
                        }
                        bmBtn.textContent = '已加书签';
                        setTimeout(function () { bmBtn.textContent = '加书签'; }, 2000);
                    });
                } catch (e) {
                    bmBtn.textContent = '添加失败';
                    setTimeout(function () { bmBtn.textContent = '加书签'; }, 2500);
                }
            });
        }

        // 资源库页面/SW 广播有新条目时自动刷新
        try {
            chrome.runtime.onMessage.addListener(function (msg) {
                if (msg && msg.Message === 'vrLib.added') { refreshIndex(); }
            });
        } catch (e) { /* 忽略 */ }
    }

    /* ---------------- 启动 ---------------- */

    function init() {
        if (!$('anchorLibrary')) { return; }       // 不是 options 页
        /* 站点名称面板只读 vrSiteNames，与 vrLibSettings 无关。
         * 放在 load() 之前绑定：vrLibSettings 读取异常时（旧浏览器 / 权限收回）
         * 不能让整块面板停在「正在读取…」。 */
        bindSiteNames();
        load(function () {
            uiMode = state.mode === 'custom' ? 'custom' : 'system';
            render();
            bind();
            bindIndex();
            bindLibSettings();
            refreshIndex();
            /* 目录句柄只有名字（FSA 不给绝对路径），显示出来让用户知道选的是哪个 */
            idbGet('root').then(function (h) {
                if (h && h.name) {
                    handleName = h.name;
                    if (currentMode() === 'custom') { render(); }
                }
            }).catch(function () { /* 无句柄属正常 */ });
            /* 首次打开：默认位置也要立刻显示真实路径，不能停在「未探测」 */
            if (currentMode() === 'system') { resolveDetectedRoot(); }
            refreshAuthState();
            // 图片下载设置（I5）：控件在 #anchorImage，与清单面板同一份存储
            if ($('anchorImage')) {
                bindImageSettings();
                renderImageSettings();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /* ---------------- 图片下载设置（I5） ---------------- */

    /* 资源库自身的开关（非图片）。
     * 单独一张表：这些键由 migrate.js / indexer.js 直接读原始 storage，
     * 不经过 VRImageUtil.mergeSettings，混进 IMG_FIELDS 会让「图片设置」语义变模糊。 */
    var LIB_FIELDS = [
        { id: 'DeepVerify', key: 'deepVerify', type: 'bool' }
    ];

    /** 把存储里的资源库开关刷到控件上（state 已在 init 里 load 过） */
    function renderLibSettings() {
        if (!state) { return; }
        LIB_FIELDS.forEach(function (f) {
            var el = $(f.id);
            if (el) { el.checked = !!state[f.key]; }
        });
    }

    function bindLibSettings() {
        LIB_FIELDS.forEach(function (f) {
            var el = $(f.id);
            if (!el) { return; }
            el.addEventListener('change', function () {
                var patch = {};
                patch[f.key] = !!el.checked;
                save(patch);
            });
        });
    }

    /* ---------------- 站点名称面板 ---------------- */

    /** 一行 = 一个站点。手改/自动记录以 vrSiteNames 为准，预置表只做补充。 */
    function collectSiteRows() {
        var ST = root.VRSiteNameStore;
        var PP = root.VRSiteNamesPreset;
        var out = {};
        var recall = (ST && ST.snapshot) ? ST.snapshot() : null;

        /* 预置表：先铺底（source = preset） */
        var presetList = (PP && PP.list) ? PP.list() : [];
        presetList.forEach(function (it) {
            (it.h || []).forEach(function (h) {
                if (!out[h]) {
                    out[h] = { host: h, name: it.n, src: 'preset', at: 0, manual: 0, cat: it.c };
                }
            });
        });

        /* 自动学习 / 手改：覆盖预置（source = learned / manual） */
        if (recall && typeof recall === 'object') {
            Object.keys(recall).forEach(function (h) {
                var r = recall[h] || {};
                if (!r.name) { return; }
                out[h] = {
                    host: h,
                    name: r.name,
                    src: r.manual ? 'manual' : (r.src || 'learned'),
                    at: r.at || 0,
                    manual: r.manual || 0,
                    cat: (out[h] && out[h].cat) || ''
                };
            });
        }
        return Object.keys(out).map(function (h) { return out[h]; });
    }

    var SRC_LABEL = {
        manual: '手改', preset: '预置', learned: '自动',
        og: '自动', meta: '自动', manifest: '自动', jsonld: '自动', title: '自动',
        page: '自动', tab: '自动', cache: '自动', import: '导入'
    };

    function srcBadge(src) {
        var label = SRC_LABEL[src] || (src === 'preset' ? '预置' : '自动');
        var cls = (src === 'manual' || src === 'import') ? 'manual'
            : (src === 'preset' ? 'preset' : 'auto');
        return '<span class="site-src site-src-' + cls + '">' + escHtml(label) + '</span>';
    }

    function fmtSiteTime(ts) {
        if (!ts) { return '—'; }
        var d = new Date(Number(ts));
        if (isNaN(d.getTime())) { return '—'; }
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    function renderSiteNames() {
        var box = $('vrSiteNameList');
        if (!box) { return; }
        var q = siteQuery.toLowerCase().trim();
        var rows = collectSiteRows().filter(function (r) {
            if (!q) { return true; }
            return (r.host || '').toLowerCase().indexOf(q) >= 0
                || (r.name || '').toLowerCase().indexOf(q) >= 0;
        });
        /* 手改优先，其次自动，再预置；同类按域名排 */
        var rank = { manual: 0, import: 0, learned: 1, preset: 2 };
        rows.sort(function (a, b) {
            var ra = rank[a.src] == null ? 1 : rank[a.src];
            var rb = rank[b.src] == null ? 1 : rank[b.src];
            if (ra !== rb) { return ra - rb; }
            return String(a.host).localeCompare(String(b.host));
        });
        siteRows = rows;

        var cnt = $('vrSiteNameCount');
        if (cnt) {
            var learned = rows.filter(function (r) { return r.src !== 'preset'; }).length;
            cnt.textContent = '共 ' + rows.length + ' 个站点，其中 ' + learned + ' 个有手改或自动记录';
        }

        if (!rows.length) {
            box.innerHTML = '<span class="explain">没有匹配的站点。下载任意网站的素材后，这里会自动出现。</span>';
            return;
        }

        /* 只渲染前 300 行：全量 400+ 行一次性铺 DOM 会明显卡顿，搜索可缩小范围 */
        var shown = rows.slice(0, 300);
        box.innerHTML = shown.map(function (r) {
            var host = escHtml(r.host);
            /* 站名在前、域名在后：人认名字，不认域名。
             * 名字为空时输入框显示空、用 placeholder 提示会回退域名。 */
            return '<div class="site-name-row" data-host="' + host + '">' +
                '<input type="text" class="site-name-input" data-host="' + host + '" ' +
                    'value="' + escHtml(r.name) + '" placeholder="（未命名，将用域名）" />' +
                '<code class="site-name-host" title="' + host + '">' + host + '</code>' +
                srcBadge(r.src) +
                '<span class="site-name-time">' + fmtSiteTime(r.at) + '</span>' +
                '<button type="button" class="button2 site-name-reset" data-host="' + host + '" ' +
                    (r.src === 'preset' ? 'disabled' : '') + '>还原</button>' +
                '</div>';
        }).join('') +
        (rows.length > shown.length
            ? '<div class="explain site-name-more">还有 ' + (rows.length - shown.length) + ' 个未显示，请在上方搜索缩小范围。</div>'
            : '');
    }

    function bindSiteNames() {
        var box = $('vrSiteNameList');
        if (!box) { return; }
        var msg = function (t, color) { text('vrSiteNameMsg', t, color); };
        var ST = root.VRSiteNameStore;
        if (!ST) {
            msg('站点名称模块未加载', '#c0392b');
            return;
        }

        /* 用 change 而不是 input：避免每敲一个字就写一次存储 */
        box.addEventListener('change', function (ev) {
            var el = ev.target;
            if (!el || !el.classList.contains('site-name-input')) { return; }
            var host = el.getAttribute('data-host');
            var name = String(el.value || '').trim();
            if (!name) {
                /* 清空 = 还原成「没有记录」，回退预置或域名 */
                ST.remove(host).then(function () {
                    msg('已还原 ' + host + '（将使用预置名或域名）', '#2e7d32');
                    renderSiteNames();
                });
                return;
            }
            if (!ST.normHost(host)) { return; }
            ST.rename(host, name).then(function () {
                msg('已保存：' + host + ' → ' + name, '#2e7d32');
                renderSiteNames();
            });
        });

        box.addEventListener('click', function (ev) {
            var btn = ev.target;
            if (!btn || !btn.classList || !btn.classList.contains('site-name-reset')) { return; }
            var host = btn.getAttribute('data-host');
            if (!host) { return; }
            ST.remove(host).then(function () {
                msg('已还原 ' + host, '#2e7d32');
                renderSiteNames();
            });
        });

        var search = $('vrSiteNameSearch');
        if (search) {
            search.addEventListener('input', function () {
                siteQuery = search.value || '';
                renderSiteNames();
            });
        }

        /* 「输入域名 → 获取站名并加入」：跨域抓取必须走后台（CORS）。 */
        var probeBtn = $('vrSiteNameProbe');
        var probeInput = $('vrSiteNameAdd');
        if (probeBtn && probeInput) {
            var doProbe = function () {
                var d = String(probeInput.value || '').trim();
                if (!d) { text('vrSiteNameProbeMsg', '请先输入域名', '#b26a00'); return; }
                probeBtn.disabled = true;
                text('vrSiteNameProbeMsg', '正在抓取页面…', '#666');
                try {
                    chrome.runtime.sendMessage({ Message: 'vrSiteName.probe', action: 'vrSiteNameProbe', domain: d }, function (res) {
                        probeBtn.disabled = false;
                        void (chrome.runtime.lastError);
                        if (!res) { text('vrSiteNameProbeMsg', '后台没有响应', '#c0392b'); return; }
                        if (res.name) {
                            text('vrSiteNameProbeMsg',
                                '已加入：' + res.host + ' → ' + res.name + (res.preset ? '（与预置表一致）' : ''),
                                '#2e7d32');
                        } else if (res.ok) {
                            text('vrSiteNameProbeMsg',
                                '已加入 ' + res.host + '，但页面没有声明站名，请在列表里手填',
                                '#b26a00');
                        } else {
                            text('vrSiteNameProbeMsg',
                                '加入失败：' + (res.message || '未知原因'), '#c0392b');
                        }
                        ST.ready().then(function () { renderSiteNames(); });
                        if (res.name) { probeInput.value = ''; }
                    });
                } catch (e) {
                    probeBtn.disabled = false;
                    text('vrSiteNameProbeMsg', '发送失败：' + e, '#c0392b');
                }
            };
            probeBtn.addEventListener('click', doProbe);
            probeInput.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter') { ev.preventDefault(); doProbe(); }
            });
        }

        var refresh = $('vrSiteNameRefresh');
        if (refresh) {
            refresh.addEventListener('click', function () {
                ST.ready().then(function () { renderSiteNames(); msg('已刷新', '#666'); });
            });
        }

        var exp = $('vrSiteNameExport');
        if (exp) {
            exp.addEventListener('click', function () {
                ST.exportAll().then(function (data) {
                    var keys = Object.keys(data || {});
                    if (!keys.length) { msg('还没有自动学习到任何站名，无需导出', '#b26a00'); return; }
                    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    var a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'vr-site-names-' + Date.now() + '.json';
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(function () {
                        URL.revokeObjectURL(a.href);
                        a.remove();
                    }, 1000);
                    msg('已导出 ' + keys.length + ' 条', '#2e7d32');
                });
            });
        }

        var imp = $('vrSiteNameImport');
        var impFile = $('vrSiteNameImportFile');
        if (imp && impFile) {
            imp.addEventListener('click', function () { impFile.click(); });
            impFile.addEventListener('change', function () {
                var f = impFile.files && impFile.files[0];
                if (!f) { return; }
                var reader = new FileReader();
                reader.onload = function () {
                    var obj;
                    try { obj = JSON.parse(String(reader.result || '')); }
                    catch (e) { msg('JSON 解析失败', '#c0392b'); impFile.value = ''; return; }
                    ST.importAll(obj).then(function (r) {
                        msg('导入完成：新增 ' + r.added + ' 条，更新 ' + r.updated + ' 条', '#2e7d32');
                        renderSiteNames();
                        impFile.value = '';
                    });
                };
                reader.onerror = function () { msg('文件读取失败', '#c0392b'); impFile.value = ''; };
                reader.readAsText(f);
            });
        }

        ST.ready().then(function () { renderSiteNames(); });
    }

    /* 与清单面板共用同一份 vrLibSettings；这里只做「把控件和存储对上」这件事。 */
    var IMG_FIELDS = [
        { id: 'ImgHover', key: 'imgHover', type: 'bool' },
        { id: 'ImgBatch', key: 'imgBatch', type: 'bool' },
        { id: 'ImgPanel', key: 'imgPanel', type: 'bool' },
        { id: 'ImgPreferOriginal', key: 'imgPreferOriginal', type: 'bool' },
        { id: 'ImgBgScan', key: 'imgBgScan', type: 'bool' },
        { id: 'ImgHoverMinSize', key: 'imgHoverMinSize', type: 'num' },
        { id: 'ImgHotkeys', key: 'imgHotkeys', type: 'bool' },
        { id: 'ImgMinSize', key: 'imgMinSize', type: 'num' },
        { id: 'ImgHoverDelay', key: 'imgHoverDelay', type: 'num' },
        { id: 'ImgConcurrency', key: 'imgConcurrency', type: 'num' },
        { id: 'ImgBatchLimit', key: 'imgBatchLimit', type: 'num' }
    ];

    function imgUtil() {
        return root.VRImageUtil || null;
    }

    /** 把存储里的图片设置刷到设置页控件上 */
    function renderImageSettings() {
        var U = imgUtil();
        if (!U) { return; }
        chrome.storage.local.get(KEY, function (obj) {
            var m = U.mergeSettings((obj && obj[KEY]) || {});
            IMG_FIELDS.forEach(function (f) {
                var el = $(f.id);
                if (!el) { return; }
                if (f.type === 'bool') {
                    el.checked = !!m[f.key];
                } else if (document.activeElement !== el) {
                    el.value = String(m[f.key]);
                }
            });
        });
    }

    /** 写一项图片设置（数值越界就夹住，非法就回滚到原值） */
    function saveImageSetting(field, raw) {
        var U = imgUtil();
        if (!U) { return; }
        var val;
        if (field.type === 'bool') {
            val = !!raw;
        } else {
            var v = U.validateSetting(field.key, raw);
            if (!v.ok) {
                // 非法：把控件回滚成当前值，并给个就地提示
                var el = $(field.id);
                if (el) {
                    var rg = U.RANGES[field.key] || [];
                    el.title = v.reason + (rg.length ? '（' + rg[0] + '–' + rg[1] + '）' : '');
                    el.classList.add('vr-bad');
                    setTimeout(function () { el.classList.remove('vr-bad'); }, 1600);
                    chrome.storage.local.get(KEY, function (o) {
                        var cur = U.mergeSettings((o && o[KEY]) || {});
                        el.value = String(cur[field.key]);
                    });
                }
                return;
            }
            val = v.value;
        }
        chrome.storage.local.get(KEY, function (o) {
            var merged = U.mergeSettings(Object.assign({}, (o && o[KEY]) || {}, {}));
            merged[field.key] = val;
            var put = {};
            put[KEY] = merged;
            chrome.storage.local.set(put, function () {
                // 与资源库设置模块的内存态保持同步
                state = Object.assign({}, state || {}, {});
            });
        });
    }

    function bindImageSettings() {
        IMG_FIELDS.forEach(function (f) {
            var el = $(f.id);
            if (!el) { return; }
            var ev = f.type === 'bool' ? 'change' : 'change';
            el.addEventListener(ev, function () {
                saveImageSetting(f, f.type === 'bool' ? el.checked : el.value);
            });
        });
    }

    root.VRImgSettings = {
        render: renderImageSettings,
        bind: bindImageSettings,
        fields: IMG_FIELDS
    };

    root.VRSettings = {
        DEFAULTS: DEFAULTS,
        LIB_FIELDS: LIB_FIELDS,
        get: function () { return state ? Object.assign({}, state) : null; },
        reload: function (cb) { load(cb || function () {}); },
        verify: verify,
        // 迁移后同步子目录名（migrate-ui 调用）
        setSubdir: function (name, cb) {
            var v = cleanSeg(name);
            if (!state) {
                load(function () { root.VRSettings.setSubdir(v, cb); });
                return;
            }
            save({ subdir: v }, function () {
                render();
                var sub = $('vrLibSubdir');
                if (sub) { sub.value = v; }
                if (cb) { cb(v); }
            });
        }
    };
})(typeof self !== 'undefined' ? self : this);
