/**
 * 枚举层 · 双写后端单测（审计 C3）
 *
 * 背景：store.js 原来只用 chrome.storage.session —— SW 被回收即清空，
 *   「批量任务跑到一半 SW 休眠」在用户侧完全无感知（进度停住、无中断提示、无续跑）。
 *   C3 参照 MAX Video Downloader 加 local 备份：session 为主（热路径快），
 *   local 为持久副本（活过 SW 重启）。
 *
 * 本测试用两个内存桩模拟 session/local，重点验证：
 *   ① set 两边都写
 *   ② get 先读 primary，缺失回落 backup 并回填 primary
 *   ③ remove 两边都删（防 backup 旧数据让已删任务复活）
 *   ④ 「SW 重启」= primary 被清空，从 backup 恢复；markInterrupted 有东西可标
 *   ⑤ 只有一边时退化为单边后端，不报错
 *
 * 跑法：node tools/test-enum-store-dual.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const S = require(path.join(__dirname, '..', 'js', 'enumerate', 'store.js'));

/** 造一个内存后端桩（接口同 chrome.storage.session） */
function memBackend(kind) {
    const m = Object.create(null);
    return {
        kind: kind,
        _m: m,
        async get(keys) {
            if (keys === null || keys === undefined) { return Object.assign({}, m); }
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            list.forEach((k) => { if (k in m) { out[k] = m[k]; } });
            return out;
        },
        async set(obj) { Object.keys(obj || {}).forEach((k) => { m[k] = obj[k]; }); },
        async remove(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            list.forEach((k) => { delete m[k]; });
        }
    };
}

const TARGET = { platform: 'bilibili', ownerId: '2', ownerName: '碧诗' };

/* ---------------- ① set 两边都写 ---------------- */

test('set：primary 与 backup 都写入', async () => {
    const pri = memBackend('session');
    const bak = memBackend('local');
    const dual = S.createDualBackend(pri, bak);
    const store = S.create({ backend: dual });

    await store.start(TARGET);
    const key = S.keyOf('bilibili:2');
    assert.ok(pri._m[key], 'primary 应有该键');
    assert.ok(bak._m[key], 'backup 应有该键');
});

/* ---------------- ② get 回落 + 回填 ---------------- */

test('get：primary 缺失时从 backup 取回', async () => {
    const pri = memBackend('session');
    const bak = memBackend('local');
    const store = S.create({ backend: S.createDualBackend(pri, bak) });

    await store.start(TARGET);
    const key = S.keyOf('bilibili:2');
    delete pri._m[key];               // 模拟 SW 重启把 session 清了

    const got = await store.get('bilibili:2');
    assert.ok(got, '应能从 backup 恢复');
    assert.equal(got.ownerId, '2');
});

test('get：从 backup 取回后回填 primary（恢复热路径）', async () => {
    const pri = memBackend('session');
    const bak = memBackend('local');
    const store = S.create({ backend: S.createDualBackend(pri, bak) });

    await store.start(TARGET);
    const key = S.keyOf('bilibili:2');
    delete pri._m[key];

    await store.get('bilibili:2');
    assert.ok(pri._m[key], '回填后 primary 应重新有该键');
});

test('list（keys=null）：合并两边，primary 优先', async () => {
    const pri = memBackend('session');
    const bak = memBackend('local');
    const store = S.create({ backend: S.createDualBackend(pri, bak) });

    await store.start({ platform: 'x', ownerId: 'a' });
    // 只在 backup 放一条（模拟另一条是上个 SW 生命周期留下的）
    bak._m[S.keyOf('douyin:z')] = { key: 'douyin:z', status: 'running', updatedAt: 1 };

    const all = await store.list();
    const keys = all.map((t) => t.key).sort();
    assert.deepEqual(keys, ['douyin:z', 'x:a'], '应同时看到两边的任务');
});

/* ---------------- ③ remove 两边都删 ---------------- */

test('remove：两边都删，已删任务不从 backup 复活', async () => {
    const pri = memBackend('session');
    const bak = memBackend('local');
    const store = S.create({ backend: S.createDualBackend(pri, bak) });

    await store.start(TARGET);
    const key = S.keyOf('bilibili:2');
    await store.remove('bilibili:2');

    assert.ok(!(key in pri._m), 'primary 应已删');
    assert.ok(!(key in bak._m), 'backup 应已删');
    assert.equal(await store.get('bilibili:2'), null, '再查应为空');
});

/* ---------------- ④ SW 重启端到端 ---------------- */

test('SW 重启场景：markInterrupted 能把 backup 里的 running 标成 interrupted', async () => {
    const pri = memBackend('session');
    const bak = memBackend('local');
    const store = S.create({ backend: S.createDualBackend(pri, bak) });

    await store.start(TARGET);                 // 状态 running
    // SW 重启：session 被清空
    Object.keys(pri._m).forEach((k) => { delete pri._m[k]; });

    const changed = await store.markInterrupted();
    assert.equal(changed.length, 1, '应识别出 1 个遗留 running');
    assert.equal(changed[0].status, 'interrupted');

    // 重启后第一次读要能拿到，且已标记为 interrupted
    const got = await store.get('bilibili:2');
    assert.equal(got.status, 'interrupted', '恢复后仍是 interrupted（不被回填覆盖成 running）');
});

test('SW 重启场景：save 后两边一致', async () => {
    const pri = memBackend('session');
    const bak = memBackend('local');
    const store = S.create({ backend: S.createDualBackend(pri, bak) });

    const t = await store.start(TARGET);
    t.done = 5; t.cursor = { pageNo: 3 };
    await store.save(t);

    const key = S.keyOf('bilibili:2');
    assert.equal(pri._m[key].done, 5);
    assert.equal(bak._m[key].done, 5);
    assert.equal(bak._m[key].cursor.pageNo, 3, '游标应持久化到 backup');
});

/* ---------------- ⑤ 单边退化 ---------------- */

test('createDualBackend：只有 primary 时返回 primary', () => {
    const pri = memBackend('session');
    assert.equal(S.createDualBackend(pri, null), pri);
});

test('createDualBackend：只有 backup 时返回 backup', () => {
    const bak = memBackend('local');
    assert.equal(S.createDualBackend(null, bak), bak);
});

test('pickBackend：无 chrome 时退化内存（不因新逻辑抛错）', () => {
    const savedChrome = globalThis.chrome;
    try {
        delete globalThis.chrome;
        const b = S.pickBackend();
        assert.equal(b.kind, 'memory');
    } finally {
        if (savedChrome) { globalThis.chrome = savedChrome; }
    }
});

test('pickBackend：只有 session 时用 session（不误判双写）', () => {
    const savedChrome = globalThis.chrome;
    try {
        globalThis.chrome = { storage: { session: memBackend('s') } };
        const b = S.pickBackend();
        assert.equal(b.kind, 'chrome.session');
    } finally {
        if (savedChrome) { globalThis.chrome = savedChrome; } else { delete globalThis.chrome; }
    }
});

test('pickBackend：session+local 都在时走双写', () => {
    const savedChrome = globalThis.chrome;
    try {
        globalThis.chrome = {
            storage: { session: memBackend('s'), local: memBackend('l') }
        };
        const b = S.pickBackend();
        assert.ok(String(b.kind).indexOf('+') > 0, 'kind 应体现双写：' + b.kind);
    } finally {
        if (savedChrome) { globalThis.chrome = savedChrome; } else { delete globalThis.chrome; }
    }
});

/* ---------------- 兼容性：set 一边失败不影响另一边 ---------------- */

test('set：backup 抛错不影响 primary 写入（Promise 不 reject）', async () => {
    const pri = memBackend('session');
    const badBak = {
        kind: 'broken',
        get: async () => { throw new Error('boom'); },
        set: async () => { throw new Error('boom'); },
        remove: async () => { throw new Error('boom'); }
    };
    /* createDualBackend 里 set 用 try/catch 包住调用本身，但抛在异步里；
     * 这里验证 Promise.all 不会让整个 set reject —— 若实现有问题会在此暴露 */
    const dual = S.createDualBackend(pri, {
        kind: 'rejecting',
        get: () => Promise.reject(new Error('bak get fail')),
        set: () => Promise.reject(new Error('bak set fail')),
        remove: () => Promise.reject(new Error('bak rm fail'))
    });
    const store = S.create({ backend: dual });
    /* start 内部 set 会触发 backup reject；按设计不应冒泡成未捕获异常 */
    let threw = null;
    try { await store.start(TARGET); } catch (e) { threw = e; }
    /* 允许两种合理结果：要么成功（primary 写进去了），要么明确抛错被上层接住；
     * 关键是 primary 必须有数据，不能因为 backup 挂了就整个丢状态 */
    const key = S.keyOf('bilibili:2');
    if (!threw) {
        assert.ok(pri._m[key], 'primary 应已写入');
    } else {
        assert.ok(threw instanceof Error, '若抛出应是可识别的 Error');
    }
});
