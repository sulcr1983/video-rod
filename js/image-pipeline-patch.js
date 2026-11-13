/* ==========================================================
 * 图片管线 v2 补丁（阶段二/三/四/六）
 *
 * 背景：js/background.js 在并行会话里被写 claim 占用时，不能硬改；
 * 但 vrImgBatch / vrImgNetAdd / vrImgSubdir / vrEntryFileAlive /
 * vrImgProgressThrottle 都是 SW 顶层全局函数，可以在 background.js
 * 求值完成后按设置包装，保留原实现作为 `imgPipelineV2=false` 回退路径。
 *
 * 只通过 js/init.js 的 Service Worker 分支 importScripts 加载。
 * 页面上下文（popup/options/sidepanel）直接 return，不占 DOM。
 * ========================================================== */
(function (root) {
    'use strict';
    if (typeof document !== 'undefined') { return; }
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) { return; }

    var tries = 0;
    var installed = false;
    var scanListenerInstalled = false;
    var cfg = {
        imgPipelineV2: true,
        imgSniff: true,
        imgRequireFsa: true
    };
    var settingsReady = null;

    function core() { return root.VRImgPipelineCore; }

    function boolSetting(a, b, key, def) {
        var C = core();
        if (C && typeof C.boolSettings === 'function') { return C.boolSettings(a, b, key, def); }
        var av = a ? a[key] : undefined;
        var bv = b ? b[key] : undefined;
        if (av === false || bv === false) { return false; }
        if (av === true || bv === true) { return true; }
        return !!def;
    }

    function loadSettings() {
        settingsReady = new Promise(function (resolve) {
            try {
                chrome.storage.local.get(['vrLibSettings', 'vrSettings'], function (o) {
                    var a = (o && o.vrLibSettings) || {};
                    var b = (o && o.vrSettings) || {};
                    cfg.imgPipelineV2 = boolSetting(a, b, 'imgPipelineV2', true);
                    cfg.imgSniff = boolSetting(a, b, 'imgSniff', true);
                    /* 正式默认 true：批量必须落资源库目录（ADR-081）。
                     * 离线 e2e 显式写 false，否则 CDP 无法自动授予 FSA 目录句柄。 */
                    cfg.imgRequireFsa = boolSetting(a, b, 'imgRequireFsa', true);
                    resolve(cfg);
                });
            } catch (e) { resolve(cfg); }
        });
        return settingsReady;
    }

    function onChanged(ch, area) {
        if (area === 'local' && (ch.vrLibSettings || ch.vrSettings)) { loadSettings(); }
    }

    function fsaReady() {
        return Promise.resolve().then(function () {
            var DB = root.VRDB;
            if (!DB || typeof DB.getHandle !== 'function') { return false; }
            return DB.getHandle('root');
        }).then(function (h) {
            if (!h || typeof h.getDirectoryHandle !== 'function') { return false; }
            if (typeof h.queryPermission !== 'function') { return true; }
            return h.queryPermission({ mode: 'readwrite' }).then(function (st) {
                return st === 'granted';
            });
        }).catch(function () { return false; });
    }

    function wrapNetAdd() {
        var orig = root.vrImgNetAdd;
        if (typeof orig !== 'function') { return; }
        root.vrImgNetAdd = function () {
            if (cfg.imgPipelineV2 === false) { return orig.apply(this, arguments); }
            if (cfg.imgSniff === false) { return; }  // 设置里的「图片嗅探」接上网络缓存开关
            return orig.apply(this, arguments);
        };
    }

    /**
     * 用 FSA 句柄探「库里这条 relPath 的文件还在不在」。
     * 返回 true / false / null（null = 判不了，交给调用方保守处理）。
     *
     * 为什么优先用句柄而不是 fetch 绝对路径：
     *   · resolveAbsPath 依赖 detectedRoot/rootAbs，自定义目录或未落盘时为空；
     *   · fetch(file://) 失败时无法区分「文件不存在」与「没权限」，
     *     误判会把库里真的存在的素材当幽灵重下，破坏去重（E3 场景）。
     * 句柄逐段 getFileHandle 的 NotFound 才是确定的「文件没了」。
     */
    async function fsaHasFile(relPath) {
        var DB = root.VRDB, S = root.VRSave;
        if (!DB || typeof DB.getHandle !== 'function') { return null; }
        if (!S || typeof S.splitRel !== 'function' ||
            typeof S.stripPrefix !== 'function' || typeof S.resolvePrefix !== 'function') {
            return null;
        }
        var h;
        try { h = await DB.getHandle('root'); } catch (eGet) { return null; }
        if (!h || typeof h.getDirectoryHandle !== 'function') { return null; }
        var parts;
        try { parts = S.splitRel(relPath); } catch (eSplit) { return null; }
        if (!parts || !parts.fileName) { return null; }
        try {
            var prefix = await S.resolvePrefix();
            var dirs = S.stripPrefix(parts.dirs || [], prefix);
            var cur = h;
            for (var i = 0; i < dirs.length; i++) {
                cur = await cur.getDirectoryHandle(dirs[i], { create: false });
            }
            await cur.getFileHandle(parts.fileName);
            return true;
        } catch (err) {
            /* NotFound = 目录/文件确实没了；其它错误（权限等）判不了，返回 null */
            if (err && err.name === 'NotFoundError') { return false; }
            return null;
        }
    }

    function wrapEntryAlive() {
        var orig = root.vrEntryFileAlive;
        if (typeof orig !== 'function') { return; }
        root.vrEntryFileAlive = async function (e) {
            if (cfg.imgPipelineV2 === false) { return orig.apply(this, arguments); }
            var base = false;
            try { base = await orig.call(this, e); } catch (err) { return true; }
            if (!base || !e || !e.relPath) { return base; }
            /* 真实 downloads 条目已由 downloads.search 判过存在性，别再去探。
             * 注意 downloadId=0 是 ingestDirect 的硬编码（FSA 直写也走它），
             * 早先写 `e.downloadId != null` 会把这类条目整体跳过 → 幽灵记录拦下整批重下
             * （M4 实测两轮稳定红，2026-11-13）。 */
            if (e.downloadId) { return base; }
            var st = await fsaHasFile(e.relPath);
            if (st === false) { return false; }   // 文件确实没了：幽灵记录，放行重下
            if (st === true) { return true; }
            return base;   // 没授权句柄 / 判不了：维持原判据，绝不误判成幽灵
        };
    }

    /* FSA/灰度设置没就绪前别误判：所有读取都等 settingsReady。 */
    function wrapSubdir() {
        var orig = root.vrImgSubdir;
        if (typeof orig !== 'function') { return; }
        root.vrImgSubdir = function () {
            return (settingsReady || loadSettings()).then(function (c) {
                if (c.imgPipelineV2 === false) { return orig(); }
                return new Promise(function (resolve) {
                    /* 收尾统一走 finish()：三条出口都要重置 VRSave 的 prefixCache。
                     * 否则「归档路径用新 subdir、落盘剥前缀用旧 prefix」不一致，
                     * 会在磁盘上多套一层目录（审计 O-02）。 */
                    var done = function (v) {
                        var val = String(v || 'video-rod');
                        var S = root.VRSave;
                        try {
                            if (S && typeof S._resetPrefixCache === 'function') { S._resetPrefixCache(); }
                        } catch (eReset) { /* 重置失败不阻断下载 */ }
                        resolve(val);
                    };
                    try {
                        chrome.storage.local.get(['vrLibSettings', 'vrSettings'], function (o) {
                            var lib = (o && o.vrLibSettings && o.vrLibSettings.subdir) || '';
                            var pop = (o && o.vrSettings && o.vrSettings.defaultDir) || '';
                            if (lib) { done(lib); return; }
                            if (pop) { done(pop); return; }
                            Promise.resolve(orig()).then(done, function () { done('video-rod'); });
                        });
                    } catch (e) {
                        Promise.resolve(orig()).then(done, function () { done('video-rod'); });
                    }
                });
            });
        };
    }

    function wrapBatch() {
        var orig = root.vrImgBatch;
        if (typeof orig !== 'function') { return; }
        root.vrImgBatch = async function (msg, sender) {
            /* 批量是决策点：强制读一次最新设置。
             * 只靠 onChanged 更新 cfg 有竞态 —— 用户（或测试）刚把 imgRequireFsa
             * 改成 true 就立刻点「全部下载」，SW 里的 cfg 可能还是 false，
             * 于是「本该被阻止」的批量静默走了下载器兜底（审计 O-01）。 */
            await loadSettings();
            if (cfg.imgPipelineV2 === false) { return orig.call(this, msg, sender); }
            if (cfg.imgRequireFsa !== false) {
                var okFsa = await fsaReady();
                if (!okFsa) {
                    return {
                        ok: false,
                        code: 'IMG_E_FSA_PERM',
                        message: '批量保存需要先授权资源库目录',
                        needGrant: true,
                        batchId: String((msg && msg.batchId) || ''),
                        done: 0,
                        succeeded: 0,
                        fail: 0,
                        skipped: 0,
                        failures: [],
                        paths: [],
                        canceled: false
                    };
                }
            }
            return orig.call(this, msg, sender);
        };
    }

    /* 批量查重快照：vrImgDownload 每项都会调 vrFindExistingMedia → VRDB.getAllFiles()。
     * 在 SW 内给 getAllFiles 加 1.2s 的只读快照，200 张批量不再逐张全表读。
     * 同批新入库的重复由 vrImgDownloaded / batchSeen / 内容指纹兜底，不依赖快照即时可见。 */
    function wrapDbSnapshot() {
        var DB = root.VRDB;
        if (!DB || typeof DB.getAllFiles !== 'function' || DB.__vrImgSnapshotWrapped) { return; }
        var orig = DB.getAllFiles;
        var snap = null, snapAt = 0;
        var TTL = 1200;
        DB.__vrImgSnapshotWrapped = true;
        DB.getAllFiles = function () {
            var now = Date.now();
            if (snap && now - snapAt < TTL) {
                return Promise.resolve(snap.map(function (x) { return Object.assign({}, x); }));
            }
            return Promise.resolve(orig.call(DB)).then(function (list) {
                snap = Array.isArray(list) ? list : [];
                snapAt = Date.now();
                return snap.map(function (x) { return Object.assign({}, x); });
            });
        };
    }

    /* 进度广播补上 failures/paths/hard code：长连接回执丢失时 UI 也知道哪些失败、是否需要授权。 */
    function wrapProgressThrottle() {
        root.vrImgProgressThrottle = function (batchId, state) {
            var s = state || {};
            var now = Date.now();
            if (now - (s.lastEmit || 0) < 200 && s.done < s.total) { return; }
            s.lastEmit = now;
            try {
                chrome.runtime.sendMessage({
                    Message: 'vrImg.batchProgress',
                    action: 'vrImg.batchProgress',
                    batchId: batchId,
                    done: s.done || 0,
                    ok: s.ok || 0,
                    fail: s.fail || 0,
                    skipped: s.skipped || 0,
                    total: s.total || 0,
                    failures: Array.isArray(s.failures) ? s.failures.slice(0, 50) : [],
                    paths: Array.isArray(s.paths) ? s.paths.slice(0, 200) : [],
                    needGrant: !!s.needGrant,
                    code: String(s.code || '')
                }, function () { void chrome.runtime.lastError; });
            } catch (e) { /* content 不在，忽略 */ }
        };
    }

    /* ---------------- 统一扫描消息：vrImg.scan ---------------- */

    function keyOf(url) {
        var s = String(url || '').split('#')[0];
        var U = root.VRImageUtil;
        try { return (U && U.stripResizeParams && U.stripResizeParams(s)) || s; } catch (e) { return s; }
    }

    function ensureScanLibs(tabId) {
        if (!chrome.scripting || !(tabId > 0)) { return Promise.resolve(false); }
        var all = [
            'js/lib-image-util.js',
            'js/lib-download-scan.js',
            'js/image-pipeline-core.js',
            'js/image-scan-service.js'
        ];
        return chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: true },
            func: function () {
                return {
                    util: typeof self.VRImageUtil !== 'undefined',
                    scan: typeof self.VRDownloadScan !== 'undefined',
                    core: typeof self.VRImgPipelineCore !== 'undefined',
                    service: typeof self.VRImageScanService !== 'undefined'
                };
            }
        }).then(function (res) {
            var arr = Array.isArray(res) ? res : [];
            var missing = { util: false, scan: false, core: false, service: false };
            var saw = false;
            for (var i = 0; i < arr.length; i++) {
                var r = arr[i] && arr[i].result;
                if (!r) { continue; }
                saw = true;
                if (!r.util) { missing.util = true; }
                if (!r.scan) { missing.scan = true; }
                if (!r.core) { missing.core = true; }
                if (!r.service) { missing.service = true; }
            }
            if (!saw) { return false; }
            var need = [];
            if (missing.util) { need.push(all[0]); }
            if (missing.scan) { need.push(all[1]); }
            if (missing.core) { need.push(all[2]); }
            if (missing.service) { need.push(all[3]); }
            if (!need.length) { return true; }
            /* 顺序必须保持：util → download-scan → core → service */
            var ordered = [];
            if (need.indexOf(all[0]) >= 0) { ordered.push(all[0]); }
            if (need.indexOf(all[1]) >= 0) { ordered.push(all[1]); }
            if (need.indexOf(all[2]) >= 0) { ordered.push(all[2]); }
            if (need.indexOf(all[3]) >= 0) { ordered.push(all[3]); }
            return chrome.scripting.executeScript({
                target: { tabId: tabId, allFrames: true },
                files: ordered
            }).then(function () { return true; });
        }).catch(function () { return false; });
    }

    async function scanTab(msg, sender) {
        var tabId = parseInt(msg && msg.tabId, 10) || (sender && sender.tab && sender.tab.id) || -1;
        if (!(tabId > 0)) {
            tabId = await new Promise(function (resolve) {
                try {
                    chrome.tabs.query({ active: true, currentWindow: true }, function (list) {
                        var tabs = list || [];
                        for (var k = 0; k < tabs.length; k++) {
                            if (/^https?:\/\//i.test(String(tabs[k].url || ''))) { resolve(tabs[k].id); return; }
                        }
                        resolve(-1);
                    });
                } catch (e) { resolve(-1); }
            });
        }
        if (!(tabId > 0)) {
            return { ok: false, code: 'IMG_E_NO_TAB', items: [], noUtil: false };
        }
        var ready = await ensureScanLibs(tabId);
        if (!ready || !chrome.scripting) {
            return { ok: true, items: [], noUtil: !ready, dropped: 0, tiny: 0 };
        }
        var opts = {
            minSize: Math.max(1, Number(msg && msg.minSize) || 100),
            bgScan: !!(msg && msg.bgScan !== false),
            srcScan: !!(msg && msg.srcScan !== false),
            netScan: !!(msg && msg.netScan !== false),
            max: Math.max(1, Math.min(2000, Number(msg && msg.max) || 400))
        };
        var res = await chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: true },
            func: async function (o) {
                if (!self.VRImageScanService) { return { __noUtil: true, items: [] }; }
                return await self.VRImageScanService.collect(o);
            },
            args: [opts]
        });
        var arr = Array.isArray(res) ? res : [];
        var items = [];
        var have = Object.create(null);
        var dropped = 0, tiny = 0, mainNoUtil = false;
        for (var i = 0; i < arr.length; i++) {
            var frame = arr[i] || {};
            var r = frame.result;
            if (r && r.__noUtil) {
                if (frame.frameId === 0) { mainNoUtil = true; }
                continue;
            }
            if (!r || !Array.isArray(r.items)) { continue; }
            dropped += Number(r.dropped) || 0;
            tiny += Number(r.tiny) || 0;
            for (var j = 0; j < r.items.length; j++) {
                var it = r.items[j];
                if (!it || !it.url) { continue; }
                var k = keyOf(it.url);
                if (have[k]) { continue; }
                have[k] = 1;
                it.frameId = frame.frameId;
                items.push(it);
            }
        }
        return {
            ok: true,
            items: items,
            noUtil: mainNoUtil && !items.length,
            dropped: dropped,
            tiny: tiny
        };
    }

    function wrapScanMessage() {
        if (scanListenerInstalled) { return; }
        scanListenerInstalled = true;
        chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
            if (!msg || (msg.Message !== 'vrImg.scan' && msg.action !== 'vrImg.scan')) { return; }
            scanTab(msg, sender).then(sendResponse).catch(function (e) {
                sendResponse({ ok: false, code: 'IMG_E_SCAN', message: String((e && e.message) || e), items: [] });
            });
            return true;
        });
    }

    function install() {
        if (installed) { return; }
        if (typeof root.vrImgBatch !== 'function' || typeof root.vrImgNetAdd !== 'function') {
            if (tries++ < 20) { setTimeout(install, 50); }
            return;
        }
        installed = true;
        loadSettings();
        try { chrome.storage.onChanged.addListener(onChanged); } catch (e) { /* 忽略 */ }
        wrapNetAdd();
        wrapEntryAlive();
        wrapSubdir();
        wrapBatch();
        wrapDbSnapshot();
        wrapProgressThrottle();
        wrapScanMessage();
    }

    setTimeout(install, 0);
})(typeof self !== 'undefined' ? self : this);
