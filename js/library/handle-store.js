/**
 * ==========================================================
 * 统一句柄存储（2026-11-10 存储梳理）
 *
 * 问题：`vr-lib-handle` 这个独立 IDB 曾被三处各写一份实现
 *   - settings.js    : openIdb/idbPut/idbGet（键 root / migrate:*）
 *   - indexer.js     : legacyHandle()（只读 root）
 *   - migrate-ui.js  : openDb + 自建 kv（键 migrate:parent/src/dst）
 * 而主库 `vr-library` 本身就有 `handle` 表（keyPath:key），
 * 等于同一件事存了两个库、三份代码——升级/迁移时必然对不上。
 *
 * 现在：
 *   1. 唯一真源 = 主库 `vr-library` / store `handle`（经 VRDB.getHandle/setHandle）
 *   2. 旧库 `vr-lib-handle` 只**只读**一次，把 kv 里的键搬到主库，之后不再打开
 *   3. 所有调用方统一走 VRHandleStore.get/put/del
 *
 * 兼容：老用户升级后第一次读自动触发一次性搬迁（幂等，标记存 chrome.storage.local）。
 * ========================================================== */
(function (root) {
    'use strict';

    var LEGACY_DB = 'vr-lib-handle';
    var LEGACY_STORE = 'kv';
    var MIGRATED_FLAG = 'vrHandleMigrated';

    function vrdb() {
        return root.VRDB || null;
    }

    /* ---------------- 旧库只读访问（仅迁移用） ---------------- */

    function openLegacy() {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open(LEGACY_DB, 1);
                req.onupgradeneeded = function () {
                    /* 库不存在时这里会被调用：立刻关闭并删除，不"复活"一个空库 */
                    try { req.transaction.abort(); } catch (e) { /* 忽略 */ }
                    try { req.result.close(); } catch (e) { /* 忽略 */ }
                    try { indexedDB.deleteDatabase(LEGACY_DB); } catch (e) { /* 忽略 */ }
                };
                req.onsuccess = function () {
                    var db = req.result;
                    if (!db.objectStoreNames.contains(LEGACY_STORE)) {
                        try { db.close(); } catch (e) { /* 忽略 */ }
                        resolve(null); return;
                    }
                    resolve(db);
                };
                req.onerror = function () { resolve(null); };
                req.onblocked = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }

    function legacyGetAll() {
        return openLegacy().then(function (db) {
            if (!db) { return []; }
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(LEGACY_STORE, 'readonly');
                    var store = tx.objectStore(LEGACY_STORE);
                    var keysReq = store.getAllKeys();
                    var valsReq = store.getAll();
                    tx.oncomplete = function () {
                        var ks = keysReq.result || [];
                        var vs = valsReq.result || [];
                        var out = [];
                        for (var i = 0; i < ks.length; i++) { out.push({ key: ks[i], val: vs[i] }); }
                        try { db.close(); } catch (e) { /* 忽略 */ }
                        resolve(out);
                    };
                    tx.onerror = function () { try { db.close(); } catch (e) { } resolve([]); };
                } catch (e) { try { db.close(); } catch (e2) { } resolve([]); }
            });
        });
    }

    /* ---------------- 迁移标记（chrome.storage.local） ---------------- */

    function readFlag() {
        return new Promise(function (resolve) {
            try {
                chrome.storage.local.get(MIGRATED_FLAG, function (o) {
                    resolve(!!(o && o[MIGRATED_FLAG]));
                });
            } catch (e) { resolve(false); }
        });
    }

    function writeFlag() {
        return new Promise(function (resolve) {
            try {
                var o = {}; o[MIGRATED_FLAG] = 1;
                chrome.storage.local.set(o, function () { resolve(true); });
            } catch (e) { resolve(false); }
        });
    }

    /* ---------------- 一次性迁移 ---------------- */

    var migratePromise = null;

    /** 把旧库 kv 里的所有键搬到主库 handle 表。幂等：已搬过直接返回。 */
    function migrateLegacy() {
        if (migratePromise) { return migratePromise; }
        migratePromise = (async function () {
            var DB = vrdb();
            if (!DB) { return { moved: 0, skipped: 'no-vrdb' }; }
            if (await readFlag()) { return { moved: 0, skipped: 'already' }; }

            var pairs = [];
            try { pairs = await legacyGetAll(); } catch (e) { pairs = []; }
            var moved = 0;
            for (var i = 0; i < pairs.length; i++) {
                var k = pairs[i].key, v = pairs[i].val;
                if (!k || v === undefined || v === null) { continue; }
                /* 主库已有同名键则不覆盖（主库更新） */
                var cur = null;
                try { cur = await DB.getHandle(k); } catch (e) { cur = null; }
                if (cur) { continue; }
                try { await DB.setHandle(k, v); moved++; } catch (e) { /* 单条失败不阻断 */ }
            }
            await writeFlag();
            if (moved) {
                try { console.info('[VRHandleStore] 旧句柄库已迁移 ' + moved + ' 项到主库'); } catch (e) { /* 忽略 */ }
            }
            return { moved: moved };
        })();
        return migratePromise;
    }

    /* ---------------- 对外 API ---------------- */

    function DB() {
        var d = vrdb();
        if (!d) { throw new Error('VRDB 未加载'); }
        return d;
    }

    /** 读句柄（key 默认 root）。主库没有时兜底查旧库，查到顺手搬过来。 */
    async function get(key) {
        key = key || 'root';
        await migrateLegacy();
        var v = null;
        try { v = await DB().getHandle(key); } catch (e) { v = null; }
        if (v) { return v; }
        try {
            var pairs = await legacyGetAll();
            for (var i = 0; i < pairs.length; i++) {
                if (pairs[i].key === key && pairs[i].val) {
                    try { await DB().setHandle(key, pairs[i].val); } catch (e) { /* 忽略 */ }
                    return pairs[i].val;
                }
            }
        } catch (e) { /* 忽略 */ }
        return null;
    }

    /** 写句柄；val 传 null 表示删除 */
    function put(key, val) {
        return DB().setHandle(key || 'root', val);
    }

    root.VRHandleStore = {
        get: get,
        put: put,
        migrateLegacy: migrateLegacy,
        LEGACY_DB: LEGACY_DB
    };
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
