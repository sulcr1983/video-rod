/**
 * 库根内容校验单测（审计 D1）
 *
 * 背景：
 *   root-guard 的 resolveDir 只回答「这是不是库根」，**不回答「这个目录对不对」**。
 *   用户在设置里选错目录（选到 Downloads 根、或选到一个不相干的目录）时，
 *   旧流程照样授权成功，等到扫描才发现「库里全是别人的东西」或「一条也扫不到」。
 *
 *   借鉴抖珍藏的目录状态机（`docs/research/extensions/DouZhenCang-媒体库与目录状态机.md` §3），
 *   但只保留**我们语义成立**的几态 —— 不照搬它与抖音账号绑定的
 *   `belongs_to_another_douyin_account`（我们鼓励「拷文件夹到移动硬盘」，
 *   路径不同不是错误）。
 *
 * 覆盖 6 态：
 *   not_provided / awaiting_permission / unexpectedly_empty
 *   content_seems_wrong / corrupted / success
 *
 * 跑法：node tools/test-root-guard-inspect.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

globalThis.self = globalThis;
require(path.join(__dirname, '..', 'js', 'library', 'root-guard.js'));

const G = globalThis.VRRootGuard;
const S = G.FOLDER_STATUS;

/* ---------------- 桩：最小 FSA 目录 ---------------- */

/**
 * 造一个目录句柄。
 * @param {object} o
 *   o.entries   一层条目名数组
 *   o.perm      queryPermission 返回值（默认 'granted'）
 *   o.permissionThrows
 *   o.valuesThrows  遍历时抛错（模拟读不了）
 *   o.index       index.json 的内容（字符串；null 表示文件不存在）
 */
function dirHandle(o) {
    const opt = o || {};
    const h = {
        kind: 'directory',
        name: opt.name || 'video-rod',
        async queryPermission() {
            if (opt.permissionThrows) { throw new Error('Permissions check failed'); }
            return opt.perm || 'granted';
        },
        async getDirectoryHandle(n) {
            if ((opt.entries || []).indexOf(n) < 0) {
                const e = new Error('not found'); e.name = 'NotFoundError'; throw e;
            }
            /* 关键：`_library` 子句柄要继承 index 内容 ——
             * inspectRoot 是「先进 _library，再读里面的 index.json」两层结构。
             * 桩若不传递，子句柄永远读不到索引 → 全部误判成 corrupted
             * （本测试第一版就踩了这个坑）。 */
            return dirHandle({
                name: n,
                entries: [],
                index: (n === '_library') ? opt.index : undefined,
                perm: opt.perm,
                permissionThrows: opt.permissionThrows
            });
        },
        async getFileHandle(n) {
            if (n !== 'index.json' || opt.index == null) {
                const e = new Error('not found'); e.name = 'NotFoundError'; throw e;
            }
            return {
                async getFile() {
                    return { async text() { return opt.index; } };
                }
            };
        }
    };
    /* values() 返回异步迭代器 */
    h.values = function () {
        if (opt.valuesThrows) {
            return {
                [Symbol.asyncIterator]() { return this; },
                async next() { throw new Error('read failed'); }
            };
        }
        const names = (opt.entries || []).slice();
        let i = 0;
        return {
            [Symbol.asyncIterator]() { return this; },
            async next() {
                if (i >= names.length) { return { done: true, value: undefined }; }
                return { done: false, value: { name: names[i++] } };
            }
        };
    };
    return h;
}

const GOOD_INDEX = JSON.stringify({
    schema: 2, version: 1, at: 1794919275338,
    root: 'D:/personal/Downloads/video-rod', subdir: 'video-rod', count: 264
});

/* ---------------- ① not_provided ---------------- */

test('① 没有目录：not_provided', async () => {
    const r = await G.inspectRoot(null);
    assert.equal(r.status, S.NOT_PROVIDED);
    assert.ok(r.detail);
});

test('①b 非句柄对象：not_provided（不抛错）', async () => {
    const r = await G.inspectRoot({ foo: 1 });
    assert.equal(r.status, S.NOT_PROVIDED);
});

/* ---------------- ② awaiting_permission ---------------- */

test('② 权限被拒：awaiting_permission', async () => {
    const r = await G.inspectRoot(dirHandle({ perm: 'denied', entries: ['_library'] }));
    assert.equal(r.status, S.AWAITING_PERMISSION);
});

test('②b 遍历目录抛错：awaiting_permission（不崩）', async () => {
    const r = await G.inspectRoot(dirHandle({ valuesThrows: true }));
    assert.equal(r.status, S.AWAITING_PERMISSION);
});

test('②c queryPermission 抛错不拦（继续往后判）', async () => {
    /* 权限查询失败时不该直接判死 —— 有的实现会抛，但读取仍可能成功 */
    const r = await G.inspectRoot(dirHandle({
        permissionThrows: true,
        entries: ['_library'],
        index: GOOD_INDEX
    }));
    assert.equal(r.status, S.SUCCESS, '权限查询抛错不该影响最终判定');
});

/* ---------------- ③ unexpectedly_empty ---------------- */

test('③ 空目录：unexpectedly_empty（新建库的正常状态）', async () => {
    const r = await G.inspectRoot(dirHandle({ entries: [] }));
    assert.equal(r.status, S.UNEXPECTEDLY_EMPTY);
    assert.ok(r.detail);
});

/* ---------------- ④ content_seems_wrong ---------------- */

test('④ 非空但没有 _library：content_seems_wrong', async () => {
    const r = await G.inspectRoot(dirHandle({
        entries: ['我的下载', 'a.jpg', 'b.mp4']
    }));
    assert.equal(r.status, S.CONTENT_SEEMS_WRONG);
    assert.ok(r.detail.indexOf('_library') >= 0, '提示应点明缺什么');
});

test('④b content_seems_wrong 时带回现场条目（便于诊断）', async () => {
    const r = await G.inspectRoot(dirHandle({ entries: ['x', 'y'] }));
    assert.ok(Array.isArray(r.meta.entries));
    assert.equal(r.meta.entries.length, 2);
});

/* ---------------- ⑤ corrupted ---------------- */

test('⑤ 有 _library 但缺 index.json：corrupted', async () => {
    const r = await G.inspectRoot(dirHandle({ entries: ['_library'], index: null }));
    assert.equal(r.status, S.CORRUPTED);
    assert.ok(r.detail.indexOf('index.json') >= 0 || r.detail.indexOf('损坏') >= 0);
});

test('⑤b index.json 不是合法 JSON：corrupted', async () => {
    const r = await G.inspectRoot(dirHandle({ entries: ['_library'], index: '{broken' }));
    assert.equal(r.status, S.CORRUPTED);
});

test('⑤c index.json 是 "null"：corrupted（不是有效对象）', async () => {
    const r = await G.inspectRoot(dirHandle({ entries: ['_library'], index: 'null' }));
    assert.equal(r.status, S.CORRUPTED);
});

/* ---------------- ⑥ success ---------------- */

test('⑥ 正常库：success 并带回索引元信息', async () => {
    const r = await G.inspectRoot(dirHandle({ entries: ['_library', 'B站', 'YouTube'], index: GOOD_INDEX }));
    assert.equal(r.status, S.SUCCESS);
    assert.equal(r.meta.schema, 2);
    assert.equal(r.meta.count, 264);
    assert.equal(r.meta.subdir, 'video-rod');
    assert.ok(r.meta.recordedRoot.indexOf('video-rod') >= 0);
});

test('⑥b 换机器/换盘导致 recordedRoot 不同：仍是 success（不是错误）', async () => {
    /* 用户明确要「拷文件夹到移动硬盘 / 换电脑直接打开」，
     * 所以路径不同绝不能判失败 —— 只在 meta 里作为提示带回。 */
    const idx = JSON.stringify({
        schema: 2, root: 'E:/backup/别的名字', subdir: 'video-rod', count: 10
    });
    const r = await G.inspectRoot(dirHandle({ entries: ['_library'], index: idx }));
    assert.equal(r.status, S.SUCCESS);
    assert.equal(r.meta.recordedRoot, 'E:/backup/别的名字');
});

/* ---------------- ⑦ 导出与常量 ---------------- */

test('⑦ FOLDER_STATUS 常量齐全', () => {
    ['NOT_PROVIDED', 'AWAITING_PERMISSION', 'UNEXPECTEDLY_EMPTY',
     'CONTENT_SEEMS_WRONG', 'CORRUPTED', 'SUCCESS'].forEach((k) => {
        assert.ok(S[k], '缺少状态常量 ' + k);
    });
    assert.equal(S.SUCCESS, 'success');
});

test('⑦b 函数已导出', () => {
    assert.equal(typeof G.inspectRoot, 'function');
    assert.equal(typeof G.listEntryNames, 'function');
});

/* ---------------- ⑧ 只读，不写盘 ---------------- */

test('⑧ inspectRoot 不调用任何写方法', async () => {
    let wrote = false;
    const h = dirHandle({ entries: ['_library'], index: GOOD_INDEX });
    /* 任何 create:true 或写入都算越界 */
    const origGetDir = h.getDirectoryHandle;
    h.getDirectoryHandle = async function (n, opt2) {
        if (opt2 && opt2.create) { wrote = true; }
        return origGetDir.call(h, n, opt2);
    };
    await G.inspectRoot(h);
    assert.equal(wrote, false, '校验必须是纯读，不能建目录');
});