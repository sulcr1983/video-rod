/* ==========================================================
 * VRDB —— 资源库 IndexedDB 封装（SW 与页面通用）
 *
 * 库：vr-library ｜ version 1
 *   file    keyPath relPath   索引 platform / creatorId / type / mtime / starred
 *   thumb   keyPath thumbKey
 *   setting keyPath key
 *   handle  keyPath key
 *   oplog   keyPath id (autoIncrement)
 *
 * 注意：Service Worker 也有 indexedDB，本文件不依赖 document。
 * 零依赖、ES5+Promise，挂 self.VRDB。
 * ========================================================== */
(function (root) {
    'use strict';

    var DB_NAME = 'vr-library';
    var DB_VERSION = 1;
    var dbPromise = null;      // 连接缓存：避免每次操作新开连接（泄漏 + 阻塞未来版本升级）

    function open() {
        if (dbPromise) { return dbPromise; }
        dbPromise = new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains('file')) {
                    var f = db.createObjectStore('file', { keyPath: 'relPath' });
                    f.createIndex('platform', 'platform');
                    f.createIndex('creatorId', 'creatorId');
                    f.createIndex('type', 'type');
                    f.createIndex('mtime', 'mtime');
                    f.createIndex('starred', 'starred');
                }
                if (!db.objectStoreNames.contains('thumb')) {
                    db.createObjectStore('thumb', { keyPath: 'thumbKey' });
                }
                if (!db.objectStoreNames.contains('setting')) {
                    db.createObjectStore('setting', { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains('handle')) {
                    db.createObjectStore('handle', { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains('oplog')) {
                    db.createObjectStore('oplog', { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = function () {
                var db = req.result;
                // 别处要升级版本时主动让路，否则升级会一直 blocked
                db.onversionchange = function () { try { db.close(); } catch (e) { /* 忽略 */ } dbPromise = null; };
                db.onclose = function () { dbPromise = null; };
                resolve(db);
            };
            req.onerror = function () { dbPromise = null; reject(req.error || new Error('IDB open failed')); };
        });
        return dbPromise;
    }

    function tx(db, stores, mode, fn) {
        return new Promise(function (resolve, reject) {
            var t = db.transaction(stores, mode);
            var result;
            try { result = fn(t); } catch (e) { reject(e); return; }
            t.oncomplete = function () { resolve(result); };
            t.onerror = function () { reject(t.error || new Error('IDB tx error')); };
            t.onabort = function () { reject(t.error || new Error('IDB tx abort')); };
        });
    }

    /** 批量写文件条目（已存在则覆盖） */
    function putFiles(files) {
        if (!files || !files.length) { return Promise.resolve(0); }
        return open().then(function (db) {
            return tx(db, ['file'], 'readwrite', function (t) {
                var s = t.objectStore('file');
                files.forEach(function (f) { s.put(f); });
            }).then(function () { return files.length; });
        });
    }

    function getAllFiles() {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(['file'], 'readonly');
                var req = t.objectStore('file').getAll();
                req.onsuccess = function () { resolve(req.result || []); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function getFile(relPath) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(['file'], 'readonly');
                var req = t.objectStore('file').get(relPath);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function patchFile(relPath, patch) {
        return getFile(relPath).then(function (cur) {
            if (!cur) { return null; }
            var next = Object.assign({}, cur, patch);
            return putFiles([next]).then(function () { return next; });
        });
    }

    function deleteFiles(relPaths) {
        if (!relPaths || !relPaths.length) { return Promise.resolve(0); }
        return open().then(function (db) {
            return tx(db, ['file'], 'readwrite', function (t) {
                var s = t.objectStore('file');
                relPaths.forEach(function (k) { s.delete(k); });
            }).then(function () { return relPaths.length; });
        });
    }

    /** 清空索引（仅测试/重置用） */
    function clearAll() {
        return open().then(function (db) {
            return tx(db, ['file', 'thumb'], 'readwrite', function (t) {
                t.objectStore('file').clear();
                t.objectStore('thumb').clear();
            });
        }).then(function () { return true; });
    }

    function count() {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(['file'], 'readonly');
                var req = t.objectStore('file').count();
                req.onsuccess = function () { resolve(req.result || 0); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    /* ---------- 缩略图 ---------- */

    function putThumb(thumbKey, blob, w, h) {
        return open().then(function (db) {
            return tx(db, ['thumb'], 'readwrite', function (t) {
                t.objectStore('thumb').put({ thumbKey: thumbKey, blob: blob, w: w, h: h, at: Date.now() });
            });
        });
    }

    function getThumb(thumbKey) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(['thumb'], 'readonly');
                var req = t.objectStore('thumb').get(thumbKey);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    /**
     * 批量删除缩略图。
     *
     * 为什么必须有（红队 b-1）：
     *   thumb store 原来只有 clear / put / get，**没有任何删除接口**。
     *   于是删除素材、改名、移动素材时（trash.js / rename.js / move-picker.js）
     *   都只删 file 条目、把 thumbKey 置空，旧 blob 永久残留。
     *   缩略图一旦落盘，这些残留就会变成磁盘上看得见的垃圾文件。
     *
     * @param {string[]} thumbKeys
     * @returns {Promise<number>} 删除条数
     */
    function deleteThumbs(thumbKeys) {
        var keys = (thumbKeys || []).filter(Boolean);
        if (!keys.length) { return Promise.resolve(0); }
        return open().then(function (db) {
            return tx(db, ['thumb'], 'readwrite', function (t) {
                var s = t.objectStore('thumb');
                keys.forEach(function (k) { s.delete(k); });
            }).then(function () { return keys.length; });
        });
    }

    /**
     * 按条件查询条目（走已有索引，不全表读）。
     *
     * 为什么需要（红队 c-3）：
     *   getAllFiles() 在 6 处被无条件调用（app.js:897/904、
     *   dedup.js:172/202/284/329），上万条时每次都是全表读进内存。
     *   db.js 建库时已声明 platform / creatorId / type / mtime / starred 索引，
     *   却几乎没用上。
     *
     * 语义：所有条件取交集；未给的条件不参与过滤。
     * limit/offset 用于分页（资源库首屏只取第一页）。
     *
     * @param {object} q { platform, creatorId, type, starred, limit, offset }
     * @returns {Promise<Array>}
     */
    function queryFiles(q) {
        var opt = q || {};
        return open().then(function (db) {
            /* 能用索引就只取索引命中的区间，避免 getAll 全表 */
            var indexed = ('starred' in opt && opt.starred !== undefined && opt.starred !== null)
                ? 'starred'
                : (opt.platform ? 'platform'
                    : (opt.creatorId ? 'creatorId'
                        : (opt.type ? 'type' : null)));
            var key = indexed ? opt[indexed] : undefined;
            if (indexed === 'starred') { key = opt.starred ? 1 : 0; }

            return new Promise(function (resolve, reject) {
                var t = db.transaction(['file'], 'readonly');
                var store = t.objectStore('file');
                var req = indexed
                    ? store.index(indexed).getAll(IDBKeyRange.only(key))
                    : store.getAll();
                req.onsuccess = function () {
                    var rows = req.result || [];
                    /* 索引命中的结果再按其余条件精筛 */
                    rows = rows.filter(function (f) {
                        if (!f) { return false; }
                        if (opt.platform && f.platform !== opt.platform) { return false; }
                        if (opt.creatorId && f.creatorId !== opt.creatorId) { return false; }
                        if (opt.type && f.type !== opt.type) { return false; }
                        if (opt.starred !== undefined && opt.starred !== null) {
                            if ((f.starred ? 1 : 0) !== (opt.starred ? 1 : 0)) { return false; }
                        }
                        return true;
                    });
                    var off = Number(opt.offset) || 0;
                    var lim = Number(opt.limit) || 0;
                    if (off > 0 || lim > 0) {
                        rows = rows.slice(off, lim > 0 ? off + lim : undefined);
                    }
                    resolve(rows);
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    /**
     * 按字段值做游标式筛选（不在内存里攒全表）。
     *
     * 为什么需要（红队 c-3）：
     *   dedup.js 有多处「getAllFiles() 然后按 sha256 线性扫」——
     *   查重每次下载都跑，上万条时反复把整表拉进内存。
     *   这里用 IDB 游标逐条比对，命中即回调，内存占用 O(1)。
     *
     * @param {string} field 比较的字段名（如 'sha256'）
     * @param {*} value 期望值
     * @param {object} opts { limit, excludeRelPath }
     * @returns {Promise<Array>} 命中的条目（最多 limit 条）
     */
    function findBy(field, value, opts) {
        var o = opts || {};
        var limit = Number(o.limit) || 1;
        if (!field) { return Promise.resolve([]); }
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(['file'], 'readonly');
                var store = t.objectStore('file');
                var out = [];
                var req = store.openCursor();
                req.onsuccess = function () {
                    var cur = req.result;
                    if (!cur || out.length >= limit) { resolve(out); return; }
                    var v = cur.value;
                    if (v && v[field] === value && v.relPath !== o.excludeRelPath) {
                        out.push(v);
                    }
                    cur.continue();
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    /** 统计某字段等于 value 的条目数（引用计数用，恒定内存） */
    function countBy(field, value) {
        if (!field) { return Promise.resolve(0); }
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(['file'], 'readonly');
                var req = t.objectStore('file').openCursor();
                var n = 0;
                req.onsuccess = function () {
                    var cur = req.result;
                    if (!cur) { resolve(n); return; }
                    if (cur.value && cur.value[field] === value) { n++; }
                    cur.continue();
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    /* ---------- 设置 ---------- */

    function getSetting(key, def) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(['setting'], 'readonly');
                var req = t.objectStore('setting').get(key);
                req.onsuccess = function () {
                    var r = req.result;
                    resolve(r ? r.value : def);
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function setSetting(key, value) {
        return open().then(function (db) {
            return tx(db, ['setting'], 'readwrite', function (t) {
                t.objectStore('setting').put({ key: key, value: value });
            });
        });
    }

    /* ---------- 操作日志 ---------- */

    function log(op, payload, result) {
        return open().then(function (db) {
            return tx(db, ['oplog'], 'readwrite', function (t) {
                t.objectStore('oplog').put({ at: Date.now(), op: op, payload: payload, result: result });
            });
        });
    }

    /* ---------- 目录句柄 ---------- */

    /** 取 FSA 目录句柄（key 默认 'root'）；没有则 null */
    function getHandle(key) {
        key = key || 'root';
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(['handle'], 'readonly');
                var req = t.objectStore('handle').get(key);
                req.onsuccess = function () {
                    var r = req.result;
                    resolve(r ? r.handle : null);
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    /** 存/清 FSA 目录句柄；handle 传 null 表示删除 */
    function setHandle(key, handle) {
        if (key && typeof key === 'object') { handle = key; key = 'root'; }
        key = key || 'root';
        return open().then(function (db) {
            return tx(db, ['handle'], 'readwrite', function (t) {
                var s = t.objectStore('handle');
                if (handle) { s.put({ key: key, handle: handle }); }
                else { s.delete(key); }
            });
        }).then(function () { return true; });
    }

    root.VRDB = {
        open: open,
        putFiles: putFiles,
        getAllFiles: getAllFiles,
        getFile: getFile,
        patchFile: patchFile,
        deleteFiles: deleteFiles,
        clearAll: clearAll,
        count: count,
        putThumb: putThumb,
        getThumb: getThumb,
        deleteThumbs: deleteThumbs,
        queryFiles: queryFiles,
        findBy: findBy,
        countBy: countBy,
        getSetting: getSetting,
        setSetting: setSetting,
        log: log,
        getHandle: getHandle,
        setHandle: setHandle
    };
})(typeof self !== 'undefined' ? self : this);
