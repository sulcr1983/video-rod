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
            sourceUrl: m.sourceUrl || '',
            pageUrl: m.pageUrl || '',
            title: m.title || '',
            downloadId: 0,
            starred: 0,
            tags: [],
            state: 'ok'
        };

        // 同名重下时保留星标与标签（与 writeOne 同口径）
        return root.VRDB.getFile(rel).then(function (old) {
            if (old) {
                if (old.starred) { item.starred = old.starred; }
                if (old.tags && old.tags.length) { item.tags = old.tags; }
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
            if (!rel && meta && meta.relPath) {
                // 兜底：没有探测到下载根目录时，用预登记目录 + 实际文件名
                // （实际文件名能反映 uniquify 改名后的 (1) 后缀）
                var mDir = String(meta.relPath).split('/').slice(0, -1).join('/');
                var absFile = String(d.filename || '').split(/[\\\/]/).pop();
                rel = mDir ? (mDir + '/' + absFile) : absFile;
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
                sourceUrl: d.url || '',
                pageUrl: m.pageUrl || '',
                title: m.title || '',
                downloadId: d.id,
                starred: 0,
                tags: [],
                state: 'ok'
            };

            // 同一 relPath 再次入库（用户重下同名文件）时，保留已打的星标/标签
            return root.VRDB.getFile(rel).then(function (old) {
                if (old) {
                    if (old.starred) { item.starred = old.starred; }
                    if (old.tags && old.tags.length) { item.tags = old.tags; }
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
                enqueue(key ? p[key] : null, d, key);
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
