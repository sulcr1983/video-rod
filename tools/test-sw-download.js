/**
 * SW 下载出口单测（审计 C2：aborted_no_partial 三态）
 *
 * 背景（代码实证）：
 *   `vrDropDownload` 原来是 fire-and-forget —— 调了 removeFile 就当清理成功，
 *   不检查 lastError、不复核文件是否真没了。于是「下载失败」在用户侧只有一种表现，
 *   分不清「盘上干净」和「留下 0 字节/.htm/半截文件」（下次扫描会把它当素材收进来）。
 *
 * 本测试用 mock chrome.downloads 覆盖四种结局：
 *   ① 记录不存在              → cleanup='ok'     reason='no-record'
 *   ② 记录在但文件已不存在    → cleanup='ok'     reason='no-file'
 *   ③ 删除成功且复核确认消失  → cleanup='ok'     dropped=true
 *   ④ 删除失败 / 复核仍在     → cleanup='failed'
 *   ⑤ 无 downloads API        → cleanup='unknown'
 *
 * 跑法：node tools/test-sw-download.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const SRC_PATH = path.join(__dirname, '..', 'js', 'sw-download.js');

/**
 * 造一个 chrome.downloads mock，并在独立模块实例里加载 sw-download.js。
 * 用 delete require.cache 保证每次拿到全新实例（避免闭包里的 root 串味）。
 *
 * @param {object} opts
 *   opts.record     下载记录（null 表示不存在）
 *   opts.removeOk    removeFile 是否成功（false 时造 lastError）
 *   opts.afterExists 删除后复核时 exists 的值
 *   opts.noApi      不提供 chrome.downloads
 */
function loadWith(opts) {
    const o = opts || {};
    const calls = { removeFile: 0, erase: 0, search: 0 };

    delete require.cache[require.resolve(SRC_PATH)];

    if (o.noApi) {
        globalThis.chrome = undefined;
    } else {
        let searched = 0;
        globalThis.chrome = {
            runtime: { lastError: null },
            downloads: {
                search(_q, cb) {
                    calls.search++;
                    searched++;
                    /* 第一次 search：给「当前记录」；之后：给「删除后记录」 */
                    const isFirst = searched === 1;
                    const rec = isFirst
                        ? (o.record === undefined ? { id: 1, exists: true } : o.record)
                        : (o.afterRecord === undefined
                            ? { id: 1, exists: o.afterExists === undefined ? false : o.afterExists }
                            : o.afterRecord);
                    setTimeout(() => cb(rec ? [rec] : []), 0);
                },
                removeFile(_id, cb) {
                    calls.removeFile++;
                    if (o.removeOk === false) {
                        globalThis.chrome.runtime.lastError = { message: 'remove failed' };
                    }
                    setTimeout(() => {
                        cb && cb();
                        globalThis.chrome.runtime.lastError = null;
                    }, 0);
                },
                erase(_q, cb) {
                    calls.erase++;
                    if (cb) { setTimeout(cb, 0); }
                }
            }
        };
    }

    require(SRC_PATH);
    return { api: globalThis.VRSwDownload, calls };
}

/* ---------------- ① 非下载 id ---------------- */

test('非数字 id：不碰 API，直接报 not-a-download', async () => {
    const { api, calls } = loadWith({ record: { id: 1, exists: true } });
    const r = await api.vrDropDownload('abc');
    assert.equal(r.cleanup, 'ok');
    assert.equal(r.reason, 'not-a-download');
    assert.equal(calls.removeFile, 0, '不该对非下载 id 调 removeFile');
});

test('FSA 直写返回的对象：不当下载 id（防 TypeError 崩链路）', async () => {
    const { api, calls } = loadWith({ record: { id: 1, exists: true } });
    const r = await api.vrDropDownload({ __fsa: true, path: 'a/b.mp4' });
    assert.equal(r.cleanup, 'ok');
    assert.equal(calls.removeFile, 0);
});

/* ---------------- ② 记录不存在 / 文件已不存在 ---------------- */

test('记录不存在：视为盘上干净（no-record）', async () => {
    const { api, calls } = loadWith({ record: null });
    const r = await api.vrDropDownload(42);
    assert.equal(r.cleanup, 'ok');
    assert.equal(r.reason, 'no-record');
    assert.equal(calls.removeFile, 0);
});

test('记录在但文件已不存在：擦掉记录，算干净（no-file）', async () => {
    const { api, calls } = loadWith({ record: { id: 7, exists: false } });
    const r = await api.vrDropDownload(7);
    assert.equal(r.cleanup, 'ok');
    assert.equal(r.reason, 'no-file');
    assert.equal(calls.removeFile, 0, '文件本来就没了，不该再调 removeFile');
    assert.equal(calls.erase, 1, '记录应被擦掉');
});

/* ---------------- ③ 删除成功 ---------------- */

test('删除成功且复核已消失：cleanup=ok, dropped=true', async () => {
    const { api, calls } = loadWith({
        record: { id: 9, exists: true },
        removeOk: true,
        afterExists: false
    });
    const r = await api.vrDropDownload(9);
    assert.equal(r.cleanup, 'ok');
    assert.equal(r.dropped, true);
    assert.equal(calls.removeFile, 1);
    assert.equal(calls.search, 2, '应查两次：删前 + 删后复核');
});

/* ---------------- ④ 删除失败 / 复核发现仍在 ---------------- */

test('removeFile 报错且文件仍在：cleanup=failed（不谎报成功）', async () => {
    const { api } = loadWith({
        record: { id: 3, exists: true },
        removeOk: false,
        afterExists: true
    });
    const r = await api.vrDropDownload(3);
    assert.equal(r.cleanup, 'failed');
    assert.equal(r.dropped, false);
    assert.ok(r.reason, '应带原因');
});

test('removeFile 没报错但复核发现文件还在：仍判 failed', async () => {
    /* 这是最关键的一条：Chrome 的 removeFile 可以在不报错的情况下没真正删掉
     * （与 save.js:794 记录的 DELETE 假成功同源），只信回调不够。 */
    const { api } = loadWith({
        record: { id: 4, exists: true },
        removeOk: true,
        afterExists: true
    });
    const r = await api.vrDropDownload(4);
    assert.equal(r.cleanup, 'failed');
    assert.equal(r.reason, 'file-remains');
});

/* ---------------- ⑤ 环境不支持 ---------------- */

test('没有 downloads API：cleanup=unknown（不假设成功）', async () => {
    const { api } = loadWith({ noApi: true });
    const r = await api.vrDropDownload(5);
    assert.equal(r.cleanup, 'unknown');
    assert.equal(r.reason, 'no-downloads-api');
});

/* ---------------- 向后兼容：fire-and-forget 调用方不受影响 ---------------- */

test('不 await 也不抛（现有 8 处调用点都是调了就走）', () => {
    const { api } = loadWith({ record: { id: 2, exists: true }, removeOk: true, afterExists: false });
    assert.doesNotThrow(() => { api.vrDropDownload(2); });
});

test('返回 Promise 且永不 reject（避免 unhandled rejection）', async () => {
    const { api } = loadWith({ noApi: true });
    const p = api.vrDropDownload(6);
    assert.ok(p && typeof p.then === 'function', '应返回 Promise');
    await assert.doesNotReject(p);
});

/* ---------------- vrWaitDownload 顺带回归 ---------------- */

test('vrWaitDownload：非数字 id 立即返回 null', async () => {
    const { api } = loadWith({ record: { id: 1, exists: true } });
    assert.equal(await api.vrWaitDownload({ __fsa: true }, 100), null);
    assert.equal(await api.vrWaitDownload(undefined, 100), null);
});
