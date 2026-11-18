/**
 * masterIds / disappeared 单测（审计 D3）
 *
 * 借鉴抖珍藏的 `masterList` + `disappeared`：
 *   masterIds   = 上一次枚举到的作品 ID 全集（权威快照）
 *   disappeared = 上次有、这次没了的 ID
 *
 * 真正的价值：**博主删了，用户本地还留着** ——
 * 这是「备份」相对于「在线收藏」唯一的实质优势。
 *
 * 本测试用内存 store，不联网。重点覆盖：
 *   ① 首次枚举：写入 masterIds，disappeared 为空
 *   ② 再次枚举少了几条：disappeared 精确列出消失的 ID
 *   ③ ⚠️ 中断（用户取消）：**不更新快照** —— 没枚举到 ≠ 被删了
 *   ④ ⚠️ 出错：同上，不更新
 *   ⑤ 上限保护：超过 MAX_IDS 时截断，不撑爆 storage
 *   ⑥ 同一 ID 重复出现只记一次
 *
 * 跑法：node tools/test-enum-disappeared.js
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

/** 造一页响应，bvids 由调用方给定（便于精确控制「哪些还在」） */
function pageOf(bvids, pn, total) {
    return {
        code: 0,
        data: {
            list: {
                vlist: bvids.map((bv, i) => ({
                    bvid: bv, title: 'T-' + bv,
                    pic: '//i0.hdslb.com/' + bv + '.jpg',
                    author: 'UP主', mid: 12345678
                }))
            },
            page: { pn: pn || 1, ps: 20, count: total != null ? total : bvids.length }
        }
    };
}

/** 只返回一页（总数=条数，所以 hasMore=false） */
function onePageFetcher(bvids) {
    return async () => pageOf(bvids, 1, bvids.length);
}

function mkStore() {
    return S.create({ backend: S.createMemoryBackend() });
}

/* ---------------- ① 首次枚举 ---------------- */

test('① 首次枚举：写入 masterIds，disappeared 为空', async () => {
    const store = mkStore();
    const r = await R.run({
        target: TARGET, store, delay: 0,
        fetchJson: onePageFetcher(['BV1', 'BV2', 'BV3'])
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.disappeared, [], '首次没有历史快照，不该报消失');

    const task = await store.get('bilibili:12345678');
    assert.equal(task.masterIds.length, 3);
    assert.deepEqual(task.masterIds.slice().sort(), ['BV1', 'BV2', 'BV3']);
    assert.ok(Number(task.lastRun) > 0, '应记录 lastRun');
});

/* ---------------- ② 再次枚举，少了几条 ---------------- */

test('② 再次枚举少 2 条：disappeared 精确列出消失的 ID', async () => {
    const store = mkStore();
    await R.run({ target: TARGET, store, delay: 0, fetchJson: onePageFetcher(['BV1', 'BV2', 'BV3']) });

    /* 第二次只剩 BV1 */
    const r2 = await R.run({
        target: TARGET, store, delay: 0,
        fetchJson: onePageFetcher(['BV1'])
    });
    assert.equal(r2.ok, true);
    assert.deepEqual(r2.disappeared.slice().sort(), ['BV2', 'BV3'],
        '消失的应是 BV2/BV3');

    const task = await store.get('bilibili:12345678');
    assert.deepEqual(task.masterIds.slice().sort(), ['BV1'], '快照应更新为本次结果');
    assert.deepEqual(task.disappeared.slice().sort(), ['BV2', 'BV3']);
});

test('②b 再次枚举多了几条：disappeared 为空', async () => {
    const store = mkStore();
    await R.run({ target: TARGET, store, delay: 0, fetchJson: onePageFetcher(['BV1']) });

    const r2 = await R.run({
        target: TARGET, store, delay: 0,
        fetchJson: onePageFetcher(['BV1', 'BV2', 'BV9'])
    });
    assert.deepEqual(r2.disappeared, [], '只增不减时不该有消失项');
});

/* ---------------- ③ 中断不更新快照（最关键） ---------------- */

test('③ 用户取消中断：**不更新**快照（没枚举到 ≠ 被删了）', async () => {
    const store = mkStore();
    /* 第一轮：3 条都记下 */
    await R.run({ target: TARGET, store, delay: 0, fetchJson: onePageFetcher(['BV1', 'BV2', 'BV3']) });
    const before = await store.get('bilibili:12345678');

    /* 第二轮：调用方在第一页后立刻取消 → 只看到 BV1 */
    let stopped = false;
    const r2 = await R.run({
        target: TARGET, store, delay: 0,
        fetchJson: onePageFetcher(['BV1']),
        shouldStop: () => {
            /* 第一次检查返回 false（让它跑一页），之后返回 true */
            if (stopped) { return true; }
            stopped = true;
            return false;
        }
    });

    const after = await store.get('bilibili:12345678');
    assert.deepEqual(after.masterIds.slice().sort(), before.masterIds.slice().sort(),
        '中断时 masterIds 必须保持不变');
    assert.deepEqual(after.disappeared, before.disappeared,
        '中断时 disappeared 必须保持原样，不能凭空标成「已消失」');
});

/* ---------------- ④ 出错不更新快照 ---------------- */

test('④ 拉取失败：**不更新**快照', async () => {
    const store = mkStore();
    await R.run({ target: TARGET, store, delay: 0, fetchJson: onePageFetcher(['BV1', 'BV2']) });
    const before = await store.get('bilibili:12345678');

    /* 第二轮：一开页就抛错 */
    const r2 = await R.run({
        target: TARGET, store, delay: 0,
        fetchJson: async () => { throw new Error('network down'); }
    });
    assert.equal(r2.ok, false);

    const after = await store.get('bilibili:12345678');
    assert.deepEqual(after.masterIds.slice().sort(), before.masterIds.slice().sort(),
        '出错时不该动 masterIds');
    assert.deepEqual(after.disappeared, before.disappeared);
});

/* ---------------- ⑤ 上限保护 ---------------- */

test('⑤ masterIds 超过上限时截断（不撑爆 storage）', async () => {
    const store = mkStore();
    /* 造 2100 个 ID，超过 MAX_IDS=2000 */
    const many = [];
    for (let i = 0; i < 2100; i++) {
        many.push('BV' + String(i).padStart(8, '0'));
    }
    /* 分页：每页 20 条，共 105 页 —— 但 limit 默认 500，
     * 所以这里把 limit 提高，让所有条目都进来 */
    const r = await R.run({
        target: TARGET, store, delay: 0, limit: 3000, maxPages: 200,
        fetchJson: async (url) => {
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            const slice = many.slice((pn - 1) * 20, pn * 20);
            return pageOf(slice, pn, many.length);
        }
    });
    assert.equal(r.ok, true);
    const task = await store.get('bilibili:12345678');
    assert.equal(task.masterIds.length, 2000, '应截断到 MAX_IDS');
});

/* ---------------- ⑥ 同一 ID 重复只记一次 ---------------- */

test('⑥ 同一 mediaId 跨页重复出现：masterIds 去重', async () => {
    const store = mkStore();
    /* 两页都下发 BV1/BV2（模拟站点跨页重复），各自再带一个当页独有的。
     *
     * 注意这里**必须按请求里的 pn 正确推进**：
     * 原来无条件返回 `pageOf(..., 1, 40)` —— 于是每页响应都自称 pn=1、
     * count=40，`hasMore` 永远为真，一路翻满 maxPages 才会停。
     * 那属于「撞页数上限被截断」，按现在的口径**不写快照**（见 runner 注释：
     * 截断时写快照会把没翻到的作品误标成“博主已删”），
     * 于是 store.get 拿不到任务 —— 但这不是分页去重该背的锅。 */
    await R.run({
        target: TARGET, store, delay: 0, limit: 100, maxPages: 5,
        fetchJson: async (url) => {
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            return pageOf(['BV1', 'BV2', 'BVP' + pn], pn, 40);
        }
    });
    const task = await store.get('bilibili:12345678');
    assert.deepEqual(task.masterIds.slice().sort(),
        ['BV1', 'BV2', 'BVP1', 'BVP2'],
        '重复 ID 不该被记两次（BV1/BV2 各只记一次）');
});

/* ---------------- ⑦ 字段与默认值 ---------------- */

test('⑦ 新任务默认带 masterIds/disappeared/lastRun 字段', async () => {
    const store = mkStore();
    const t = await store.start({ platform: 'bilibili', ownerId: '99' });
    assert.ok(Array.isArray(t.masterIds), '应有 masterIds 数组');
    assert.ok(Array.isArray(t.disappeared), '应有 disappeared 数组');
    assert.equal(t.lastRun, 0, '初始 lastRun 应为 0');
});

test('⑦b 不传 store 时不崩（纯枚举模式）', async () => {
    const r = await R.run({
        target: TARGET, delay: 0,
        fetchJson: onePageFetcher(['BV1'])
    });
    assert.equal(r.ok, true);
    assert.equal(r.disappeared, undefined, '无 store 时不该有 disappeared 字段');
});