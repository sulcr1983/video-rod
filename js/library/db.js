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
        getSetting: getSetting,
        setSetting: setSetting,
        log: log,
        getHandle: getHandle,
        setHandle: setHandle
    };
})(typeof self !== 'undefined' ? self : this);
