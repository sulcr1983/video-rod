/**
 * 增量同步单测（审计 D2）
 *
 * 借鉴抖珍藏的 `masterList` 增量思路：已知内容不必重翻。
 * 但**不能照抄它的语义**——抖珍藏是后台定时任务，我们是用户手动触发，且要同时兼容 D3。
 *
 * 核心设计约束（本文件就是来钉住它的）：
 *   ① 增量模式：整页都是「上一轮已枚举过」→ 提前停翻页
 *   ② 增量模式：masterIds **合并**（旧 ∪ 新），不覆盖
 *   ③ 增量模式：**绝不更新 disappeared** —— 提前停之后「没枚举到」≠「被删了」
 *   ④ 全量模式：行为不变，照常算 disappeared
 *   ⑤ 任务已存在但还没有 masterIds：不能被 store.start() 覆盖掉 cursor
 *
 * 跑法：node tools/test-enum-incremental.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

globalThis.self = globalThis;
const base = path.join(__dirname, '..', 'js', 'enumerate');
require(path.join(base, 'pager.js'));
require(path.join(base, 'bili-wbi.js'));
require(path.join(base, 'store.js'));
require(path.join(base, 'runner.js'));
require(path.join(base, 'adapters', 'index.js'));
require(path.join(base, 'adapters', 'bilibili.js'));

const R = globalThis.VREnumRunner;
const S = globalThis.VREnumStore;

const TARGET = {
    platform: 'bilibili', ownerId: '12345678', ownerName: 'UP主',
    pageUrl: 'https://space.bilibili.com/12345678'
};

function pageOf(bvids, pn, total, ps) {
    return {
        code: 0,
        data: {
            list: {
                vlist: bvids.map((bv) => ({
                    bvid: bv, title: 'T-' + bv,
                    pic: '//i0.hdslb.com/' + bv + '.jpg',
                    author: 'UP主', mid: 12345678
                }))
            },
            page: { pn: pn || 1, ps: ps || 20, count: total != null ? total : bvids.length }
        }
    };
}

function mkStore() {
    return S.create({ backend: S.createMemoryBackend() });
}

/**
 * 造一个分页 fetcher：pages 是数组的数组（每页 bvids）。
 * 记录实际请求了几页，用于验证「提前停」。
 */
function pagedFetcher(pages) {
    const state = { calls: 0 };
    const PS = 20;
    /* total 必须与本桩**实际能提供的页数**一致：
     * 原来写成固定的 999，adapter 会算出 ceil(999/20)=50 页，
     * 于是「一直有下一页」把测试拖到 50 次调用（本测试第一版就踩了）。
     * 这里让 total 恰好等于 pages.length × ps，hasMore 只由页数决定。 */
    const total = pages.length * PS;
    return {
        state,
        fetch: async (url) => {
            state.calls++;
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            const idx = Math.min(pn - 1, pages.length - 1);
            return pageOf(pages[idx], pn, total, PS);
        }
    };
}

/* ---------------- ① 增量：整页已知就提前停 ---------------- */

test('① 增量模式：第 2 页整页已知 → 提前停，不再翻第 3 页', async () => {
    const store = mkStore();
    /* 上一轮快照：BV1..BV4 */
    await store.start(TARGET);
    await store.patch('bilibili:12345678', { masterIds: ['BV1', 'BV2', 'BV3', 'BV4'] });

    /* 本轮：第 1 页有 2 条新的，第 2 页全是旧的，第 3 页不该被请求 */
    const f = pagedFetcher([
        ['BV9', 'BV8'],
        ['BV1', 'BV2'],
        ['BV3', 'BV4']
    ]);
    const r = await R.run({
        target: TARGET, store, delay: 0, incremental: true,
        fetchJson: f.fetch
    });

    assert.equal(r.incrementalStopped, true, '应标记为「增量提前停」');
    assert.equal(f.state.calls, 2, '只该请求 2 页（第 3 页整页旧，没意义）');
    assert.deepEqual(r.items.map((i) => i.mediaId).sort(), ['BV1', 'BV2', 'BV8', 'BV9'],
        '已知页也照样收进 items');
});

test('①b 增量模式：第 1 页就有新的 → 正常继续（不误停）', async () => {
    const store = mkStore();
    await store.start(TARGET);
    await store.patch('bilibili:12345678', { masterIds: ['BV1'] });

    const f = pagedFetcher([
        ['BV9', 'BV1'],     // 有新的 BV9，不该停
        ['BV2', 'BV3']
    ]);
    const r = await R.run({
        target: TARGET, store, delay: 0, incremental: true, fetchJson: f.fetch
    });
    assert.equal(r.incrementalStopped, undefined, '有新增时不该提前停');
    assert.equal(f.state.calls, 2);
});

/* ---------------- ② 增量：masterIds 合并而非覆盖 ---------------- */

test('② 增量模式：masterIds 合并（旧 ∪ 新），旧的不丢', async () => {
    const store = mkStore();
    await store.start(TARGET);
    await store.patch('bilibili:12345678', { masterIds: ['BV1', 'BV2'] });

    await R.run({
        target: TARGET, store, delay: 0, incremental: true,
        fetchJson: async () => pageOf(['BV9', 'BV1'], 1, 2)
    });

    const task = await store.get('bilibili:12345678');
    assert.deepEqual(task.masterIds.slice().sort(), ['BV1', 'BV2', 'BV9'],
        '应保留旧的 BV2（本轮没枚举到），并加入新的 BV9');
});

/* ---------------- ③ 增量：绝不更新 disappeared ---------------- */

test('③ 增量模式：**不更新** disappeared（提前停 ≠ 被删了）', async () => {
    const store = mkStore();
    await store.start(TARGET);
    /* 上一轮全量算出的 disappeared */
    await store.patch('bilibili:12345678', {
        masterIds: ['BV1', 'BV2', 'BV3'],
        disappeared: ['BVX']
    });

    /* 本轮增量只看到 BV1 → 若错误地算差集，会把 BV2/BV3 也标成消失 */
    await R.run({
        target: TARGET, store, delay: 0, incremental: true,
        fetchJson: async () => pageOf(['BV1'], 1, 1)
    });

    const task = await store.get('bilibili:12345678');
    assert.deepEqual(task.disappeared, ['BVX'],
        'disappeared 必须保持上一次全量的结果，不能被增量覆盖');
});

test('③b 增量模式下 out.disappeared 不该出现', async () => {
    const store = mkStore();
    await store.start(TARGET);
    await store.patch('bilibili:12345678', { masterIds: ['BV1'] });
    const r = await R.run({
        target: TARGET, store, delay: 0, incremental: true,
        fetchJson: async () => pageOf(['BV1'], 1, 1)
    });
    assert.equal(r.disappeared, undefined, '增量模式不该产出 disappeared');
    assert.equal(r.incremental, true);
});

/* ---------------- ④ 全量模式行为不变 ---------------- */

test('④ 全量模式：照常算 disappeared（回归 D3）', async () => {
    const store = mkStore();
    await store.start(TARGET);
    await store.patch('bilibili:12345678', { masterIds: ['BV1', 'BV2', 'BV3'] });

    const r = await R.run({
        target: TARGET, store, delay: 0,     // 不传 incremental
        fetchJson: async () => pageOf(['BV1'], 1, 1)
    });
    assert.deepEqual(r.disappeared.slice().sort(), ['BV2', 'BV3']);
    const task = await store.get('bilibili:12345678');
    assert.deepEqual(task.masterIds, ['BV1'], '全量应覆盖快照');
});

/* ---------------- ⑤ 不覆盖已有任务 ---------------- */

test('⑤ 任务已存在但没有 masterIds：不能被 start 覆盖掉 cursor', async () => {
    const store = mkStore();
    const t = await store.start(TARGET);
    /* 模拟「跑到一半中断」：有 cursor、没有 masterIds */
    await store.patch('bilibili:12345678', {
        cursor: { pageNo: 7 },
        done: 42,
        status: 'interrupted'
    });

    await R.run({
        target: TARGET, store, delay: 0,
        fetchJson: async () => pageOf(['BV1'], 1, 1)
    });

    const after = await store.get('bilibili:12345678');
    /* 只验证「任务本体没被重建」：
     * done 会被枚举进度正常覆盖（那是既有语义，不是本功能引入的），
     * 所以不拿 done 当判据 —— 拿它当判据会得到假失败。 */
    assert.equal(after.taskId, t.taskId, 'taskId 不该变（说明没被 start 重建）');
    assert.ok(Number(after.startedAt) === Number(t.startedAt), 'startedAt 不该变');
    assert.ok(Array.isArray(after.masterIds), '本轮应写入 masterIds');
});

/* ---------------- ⑥ 没有历史快照时增量模式等价全量 ---------------- */

test('⑥ 首次运行（无快照）：增量模式也能正常拿全量', async () => {
    const store = mkStore();
    const f = pagedFetcher([['BV1', 'BV2'], ['BV3']]);
    const r = await R.run({
        target: TARGET, store, delay: 0, incremental: true, fetchJson: f.fetch
    });
    assert.equal(r.items.length, 3, '没有历史快照时不该提前停');
    assert.equal(f.state.calls, 2);
});

/* ---------------- ⑦ 参数默认值 ---------------- */

test('⑦ 不传 incremental 时是 undefined（默认全量）', async () => {
    const store = mkStore();
    const r = await R.run({
        target: TARGET, store, delay: 0,
        fetchJson: async () => pageOf(['BV1'], 1, 1)
    });
    assert.equal(r.incremental, undefined);
});