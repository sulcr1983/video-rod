/* ==========================================================
 * vrLib —— 下载完成自动入库（Service Worker 侧）
 *
 * 机制（对应 docs/IMAGE-AUTO-INDEX-RESEARCH.md）：
 *   ① 下载发起前：页面把元数据经 vrQueueName/vrLib.record 预登记到
 *      chrome.storage.session（SW 重启不丢，关浏览器即清）
 *   ② 下载完成时：downloads.onChanged(state=complete) → downloads.search
 *      拿「最终」filename（uniquify 改名后以它为准）→ 写 IndexedDB
 *   ③ 广播 vrLib.added，资源库页增量加卡片
 *
 * 边界：只收录预登记过的下载；用户日常下载不会被吸进资源库。
 * 零依赖，ES5+Promise，挂 self.VRLib。
 * ========================================================== */
(function (root) {
    'use strict';

    var SESSION = chrome.storage.session || chrome.storage.local;
    var PENDING_KEY = 'vrPendingMeta';
    var TTL = 10 * 60 * 1000;      // 元数据保留 10 分钟
    var MAX_PENDING = 500;

    var pending = null;            // 内存缓存（懒加载）
    var saveTimer = 0;
    var writeQueue = Promise.resolve();
    var rootCache = null;

    /* ---------- 预登记 ---------- */

    function loadPending() {
        if (pending) { return Promise.resolve(pending); }
        return new Promise(function (resolve) {
            SESSION.get(PENDING_KEY, function (o) {
                pending = (o && o[PENDING_KEY]) || {};
                resolve(pending);
            });
        });
    }

    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            var o = {};
            o[PENDING_KEY] = pending;
            try { SESSION.set(o); } catch (e) { /* 配额异常不阻断 */ }
        }, 200);
    }

    function prune() {
        var now = Date.now();
        var keys = Object.keys(pending);
        keys.forEach(function (k) {
            if (now - (pending[k].at || 0) > TTL) { delete pending[k]; }
        });
        var left = Object.keys(pending);
        if (left.length > MAX_PENDING) {
            left.sort(function (a, b) { return (pending[a].at || 0) - (pending[b].at || 0); });
            while (left.length > MAX_PENDING) { delete pending[left.shift()]; }
        }
    }

    /**
     * 预登记一条下载的上下文
     * @param {string} url 媒体 URL（与 downloads 记录的 url 对应）
     * @param {object} meta { relPath, platform, platformName, creatorFull, creatorId, type, title, pageUrl }
     */
    function record(url, meta) {
        if (!url) { return; }
        loadPending().then(function (p) {
            var m = Object.assign({ at: Date.now() }, meta || {});
            if (!m.relPath && m.filename) { m.relPath = m.filename; }
            p[url] = m;
            prune();
            scheduleSave();
        });
    }

    /* ---------- 来源字段 ---------- */

    /**
     * 挑一个「可作为查重键」的 URL。
     *
     * 为什么不能直接用 downloads 记录的 url：blob: 只有本次会话有效，
     * 写进库后以后永远查不到重复（历史库里的 `blob:chrome-extension://…`
     * 就是这么来的）。所以预登记 meta 的 http(s) 源优先，blob 一律丢弃。
     */
    function pickSourceUrl(metaUrl, dlUrl) {
        var m = String(metaUrl || '').trim();
        if (/^https?:/i.test(m)) { return m; }
        var d = String(dlUrl || '').trim();
        if (/^https?:/i.test(d)) { return d; }
        return m || '';      // meta 里的 data:/其它非 http 源仍保留，便于人工追溯
    }

    /* ---------- 相对路径换算 ---------- */

    function getRoot() {
        if (rootCache) { return Promise.resolve(rootCache); }
        return new Promise(function (resolve) {
            chrome.storage.local.get('vrLibSettings', function (o) {
                var s = (o && o.vrLibSettings) || {};
                rootCache = String(s.detectedRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
                resolve(rootCache);
            });
        });
    }

    function relFromAbs(abs, rootDir) {
        var a = String(abs || '').replace(/\\/g, '/');
        if (rootDir && a.indexOf(rootDir + '/') === 0) { return a.slice(rootDir.length + 1); }
        return '';
    }

    /* ---------- 入库 ---------- */

    function skippedRel(rel) {
        // 临时目录/回收站不进索引
        return /^_verify\//.test(rel) || /^_回收站\//.test(rel) || /(^|\/)_verify\//.test(rel);
    }

    /**
     * 直接入库一条「已经写到磁盘上的文件」。
     *
     * 为什么需要这条：常规入库靠 chrome.downloads 的 complete 事件（writeOne 用 d.filename
     * 反推相对路径）。但 YouTube 下载走 File System Access 直写（ADR-040），
     * **根本没有下载事件**，等下载器那条链路永远等不到 —— 资源库里就不会出现这张卡。
     *
     * 入参由调用方给全（relPath 是相对资源库根的路径，已剥掉前缀），
     * 这里只补 size/mtime 这类能从磁盘拿的信息。
     *
     * @param {object} info { relPath, platform, platformName, creatorFull, creatorId,
     *                        type, title, pageUrl, size, mtime, mime, sourceUrl }
     * @returns {Promise<object|null>} 入库后的 item（跳过则 null）
     */
    function ingestDirect(info) {
        var m = info || {};
        var rel = String(m.relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (!rel || skippedRel(rel)) { return Promise.resolve(null); }

        var parsed = {};
        if (root.VRPath && root.VRPath.parseRelPath) {
            try { parsed = root.VRPath.parseRelPath(rel) || {}; } catch (e) { parsed = {}; }
        }

        var item = {
            relPath: rel,
            absPath: m.absPath || '',
            platform: m.platform || parsed.platform || '',
            platformName: m.platformName || parsed.platformName || '',
            creatorFull: m.creatorFull || parsed.creatorFull || '',
            creatorId: m.creatorId || parsed.creatorId || '',
            type: m.type || parsed.type || '',
            fileName: parsed.fileName || rel.split('/').pop(),
            size: Number(m.size) || 0,
            mtime: Number(m.mtime) || Date.now(),
            mime: m.mime || '',
            /* sourceUrl / mediaUrl 都是查重键：只填了其中一个也要能命中，
             * 所以互为兜底；blob: 一律不落库（存进去就是死键）。 */
            sourceUrl: pickSourceUrl(m.sourceUrl || m.mediaUrl, ''),
            mediaUrl: pickSourceUrl(m.mediaUrl || m.sourceUrl, ''),
            pageUrl: m.pageUrl || '',
            title: m.title || '',
            downloadId: 0,
            starred: 0,
            tags: [],
            state: 'ok'
        };

        // F5：FSA 直写路径同样判重
        return Promise.resolve()
            .then(function () {
                if (!root.VRDedup) { return null; }
                return root.VRDedup.afterDownload({
                    relPath: rel, absPath: m.absPath || '', info: item
                });
            })
            .catch(function () { return null; })
            .then(function (dedup) {
                if (dedup && dedup.info) { Object.assign(item, dedup.info); }
                /* YouTube 同一视频重下：内容指纹命中时不再写第二张「引用」卡，
                 * 否则库里仍会出现两张同名卡片。图片仍保留引用制。 */
                if (dedup && dedup.deduped && item.platform === 'youtube') {
                    return null;
                }
                // 同名重下时保留星标与标签（与 writeOne 同口径）
                return root.VRDB.getFile(rel);
            })
            .then(function (old) {
                if (old) {
                    if (old.starred) { item.starred = old.starred; }
                    if (old.tags && old.tags.length) { item.tags = old.tags; }
                    if (old.sha256 && !item.sha256) { item.sha256 = old.sha256; }
                    if (old.isRef && !item.isRef) { item.isRef = old.isRef; }
                }
                return root.VRDB.putFiles([item]);
            }).then(function () {
            notify(item);
            return item;
        }).catch(function (e) {
            console.warn('[vrLib] 直接入库失败', e);
            return null;
        });
    }

    function writeOne(meta, d, key) {
        return getRoot().then(function (rootDir) {
            var rel = relFromAbs(d.filename, rootDir);
            var pendingArchive = 0;
            if (!rel && meta && meta.relPath) {
                /* ADR-070：真实落点不在库根下（下载器兜底丢目录前缀）时，relPath
                 * 只能记真实文件名，并标 pendingArchive —— 不许伪造归档目录。
                 * 2026-11-08 实测：Chrome 147+ 兜底下载丢目录，旧逻辑仍按预登记
                 * 目录记账，导致 37/50 条「文件缺失」。 */
                var absFile = String(d.filename || '').split(/[\\\/]/).pop();
                if (rootDir && absFile) {
                    rel = absFile;
                    pendingArchive = 1;
                } else {
                    // 探测不到下载根目录：沿用预登记目录（行为不变），但如实标待归档
                    var mDir = String(meta.relPath).split('/').slice(0, -1).join('/');
                    rel = mDir ? (mDir + '/' + absFile) : absFile;
                    pendingArchive = 1;
                }
            }
            if (!rel || skippedRel(rel)) { return null; }

            var m = meta || {};
            var parsed = {};
            if (root.VRPath && root.VRPath.parseRelPath) {
                try { parsed = root.VRPath.parseRelPath(rel) || {}; } catch (e) { parsed = {}; }
            }

            var item = {
                relPath: rel,
                absPath: d.filename,
                platform: m.platform || parsed.platform || '',
                platformName: m.platformName || parsed.platformName || '',
                creatorFull: m.creatorFull || parsed.creatorFull || '',
                creatorId: m.creatorId || parsed.creatorId || '',
                type: m.type || parsed.type || '',
                fileName: parsed.fileName || rel.split('/').pop(),
                size: d.fileSize || d.totalBytes || 0,
                mtime: d.endTime ? Date.parse(d.endTime) : Date.now(),
                mime: d.mime || '',
                /* 预登记 meta 的 http(s) 源优先：d.url 可能是 blob:（B站/抖音合成、
                 * 离屏 fetch 中转），写进库就是死键，以后永远查不到重复。 */
                sourceUrl: pickSourceUrl(m.sourceUrl, d.url),
                pageUrl: m.pageUrl || '',
                title: m.title || '',
                downloadId: d.id,
                starred: 0,
                tags: [],
                state: 'ok'
            };
            if (pendingArchive) { item.pendingArchive = 1; }
            // F5 内容去重：先算指纹；命中已有条目就只写引用，不重复占盘。
            // 判重异常一律按普通文件处理（不影响下载与入库）。
            return Promise.resolve()
                .then(function () {
                    if (!root.VRDedup) { return null; }
                    return root.VRDedup.afterDownload({
                        relPath: rel, absPath: d.filename, info: item
                    });
                })
                .catch(function () { return null; })
                .then(function (dedup) {
                    if (dedup && dedup.info) {
                        // 去重模块可能补了 sha256/isRef 等字段
                        Object.assign(item, dedup.info);
                    }
                    /* 同 YouTube 视频重下命中内容指纹：不写引用卡，避免两条相同。 */
                    if (dedup && dedup.deduped && item.platform === 'youtube') {
                        if (key) { delete pending[key]; scheduleSave(); }
                        return null;
                    }
                    // 同一 relPath 再次入库（用户重下同名文件）时，保留已打的星标/标签
                    return root.VRDB.getFile(rel);
                })
                .then(function (old) {
                    if (old) {
                        if (old.starred) { item.starred = old.starred; }
                        if (old.tags && old.tags.length) { item.tags = old.tags; }
                        if (old.sha256 && !item.sha256) { item.sha256 = old.sha256; }
                        if (old.isRef && !item.isRef) { item.isRef = old.isRef; }
                    }
                    return root.VRDB.putFiles([item]);
                }).then(function () {
                if (key) {
                    delete pending[key];
                    scheduleSave();
                }
                notify(item);
                return item;
            });
        }).catch(function (e) {
            console.warn('[vrLib] 入库失败', e);
            return null;
        });
    }

    function enqueue(meta, d, key) {
        writeQueue = writeQueue.then(function () {
            return writeOne(meta, d, key);
        }).catch(function (e) {
            console.warn('[vrLib] 队列异常', e);
        });
    }

    function notify(item) {
        try {
            chrome.runtime.sendMessage({ Message: 'vrLib.added', item: item }, function () {
                // 没有接收方（资源库页没开）属正常，读一下 lastError 避免未捕获
                void chrome.runtime.lastError;
            });
        } catch (e) { /* 忽略 */ }
    }

    function handleComplete(id) {
        chrome.downloads.search({ id: id }, function (list) {
            var d = list && list[0];
            if (!d || d.state !== 'complete') { return; }
            loadPending().then(function (p) {
                // 下载记录的 URL 可能被规范化过，finalUrl 兜底再试一次
                var key = null;
                if (d.url && p[d.url]) { key = d.url; }
                else if (d.finalUrl && p[d.finalUrl]) { key = d.finalUrl; }

                if (key) { enqueue(p[key], d, key); return; }

                /* 找不到 URL 键时的兜底：页面内合成的 blob 下载（B站 durl/dash）
                 * URL 每次都是新的，没法预登记。用「文件名」反查预登记记录 ——
                 * 下载前调用方用 vrPendingBiliName 的 relPath 登记过一条。 */
                var base = String(d.filename || '').split(/[\\/]/).pop() || '';
                var baseStem = base.replace(/ \(\d+\)(\.[a-z0-9]+)$/i, '$1');
                var hitKey = null;
                Object.keys(p).forEach(function (k) {
                    if (hitKey) { return; }
                    var r = String((p[k] && p[k].relPath) || '').replace(/\\/g, '/');
                    if (!r) { return; }
                    var rBase = r.split('/').pop() || '';
                    if (rBase === base || rBase === baseStem) { hitKey = k; }
                });
                if (hitKey) {
                    var m = p[hitKey];
                    var copy = Object.assign({}, m);
                    /* 用真实落盘文件名替换预登记名，保留目录 */
                    var dir = String(m.relPath || '').split('/').slice(0, -1).join('/');
                    copy.relPath = dir ? (dir + '/' + base) : base;
                    delete p[hitKey];
                    scheduleSave();
                    enqueue(copy, d, null);
                    return;
                }
                enqueue(null, d, null);
            });
        });
    }


    chrome.downloads.onChanged.addListener(function (delta) {
        if (!delta || !delta.state) { return; }
        if (delta.state.current === 'complete') {
            handleComplete(delta.id);
        }
        // interrupted：不入库，避免产生"幽灵卡片"
    });

    /* ---------- 消息处理（由 background.js 顶部转发过来） ---------- */

    function handleMessage(Message, sendResponse) {
        var t = Message && Message.Message;
        if (t === 'vrLib.record') {
            record(Message.url, Message.meta || {});
            sendResponse({ ok: true });
            return true;
        }
        // FSA 直写的文件没有下载事件，由写入方调这个直接入库（YouTube 用）
        if (t === 'vrLib.ingest') {
            ingestDirect(Message.info || {}).then(function (item) {
                /* 入库成功 → 触发自动快照（B-32 阶段 1.5）。
                 * 这条路径与 save.js 的直调并列：FSA 直写（YouTube / 图片）走这里，
                 * 漏了它就会出现「下载完但快照没更新」，重装后看不到新素材。 */
                try {
                    if (root.VRIndex && typeof root.VRIndex.scheduleSnapshot === 'function') {
                        root.VRIndex.scheduleSnapshot(30000);
                    }
                } catch (e0) { /* 索引层未加载时忽略 */ }
                sendResponse({ ok: !!item, item: item });
            }).catch(function (e) {
                sendResponse({ ok: false, code: 'LIB_E_DB', message: String(e) });
            });
            return true;
        }
        if (t === 'vrLib.list') {
            root.VRDB.getAllFiles().then(function (list) {
                sendResponse({ ok: true, list: list });
            }).catch(function (e) {
                sendResponse({ ok: false, code: 'LIB_E_DB', message: String(e) });
            });
            return true;
        }
        if (t === 'vrLib.stats') {
            root.VRDB.count().then(function (n) {
                sendResponse({ ok: true, count: n });
            }).catch(function (e) {
                sendResponse({ ok: false, code: 'LIB_E_DB', message: String(e) });
            });
            return true;
        }
        /* ADR-069 单写盘通道：popup 批量下载统一入口。
         * 页面侧不再直调 chrome.downloads，而是逐条发这里，由 SW 走 VRSave
         * （FSA 优先；兜底走下载器并如实标 pendingArchive）。 */
        if (t === 'vrLib.saveOne') {
            var save = root.VRSave;
            if (!save || typeof save.saveFile !== 'function') {
                sendResponse({ ok: false, code: 'LIB_E_NO_SAVE' });
                return true;
            }
            save.saveFile({
                relPath: Message.relPath || '',
                blobOrUrl: Message.url,
                mime: Message.mime || '',
                meta: Message.meta || null,
                referrer: Message.referrer || '',
                prefer: 'auto'
            }).then(function (r) {
                sendResponse({
                    ok: !!(r && r.ok),
                    mode: (r && r.mode) || 'none',
                    path: (r && r.path) || '',
                    downloadId: (r && r.downloadId) || null,
                    code: (r && r.code) || ''
                });
            }).catch(function (e) {
                sendResponse({ ok: false, code: 'LIB_E_SAVE', message: String(e) });
            });
            return true;
        }
        if (t === 'vrLib.clear') {
            root.VRDB.clearAll().then(function () {
                sendResponse({ ok: true });
            }).catch(function (e) {
                sendResponse({ ok: false, code: 'LIB_E_DB', message: String(e) });
            });
            return true;
        }
        // 未知动作也要应答，否则调用方回调永远不触发
        sendResponse({ ok: false, code: 'LIB_E_ACTION', message: 'unknown action: ' + t });
        return true;
    }

    root.VRLib = {
        record: record,
        ingestDirect: ingestDirect,
        handleMessage: handleMessage,
        // 测试用：清空 pending 缓存（不影响磁盘索引）
        _resetRootCache: function () { rootCache = null; }
    };
})(typeof self !== 'undefined' ? self : this);
