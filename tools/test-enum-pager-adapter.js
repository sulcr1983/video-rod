/**
 * pager → adapter 接线单测
 *
 * 目的：验证「有 adapter 时走 adapter 路径，没有时退回内置策略」。
 * 这是架构调整的核心契约 —— 如果这里错了，enumerate 层会用错数据源。
 *
 * 跑法：node tools/test-enum-pager-adapter.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

globalThis.self = globalThis;

const base = path.join(__dirname, '..', 'js', 'enumerate');
/* 注意顺序：pager 先加载（此时没有 adapter），后面再加载 adapter。
 * 这模拟真实场景：pager 是通用模块，adapter 是可插拔的。 */
require(path.join(base, 'pager.js'));
require(path.join(base, 'bili-wbi.js'));
require(path.join(base, 'adapters', 'index.js'));
require(path.join(base, 'adapters', 'bilibili.js'));

const P = globalThis.VREnumPager;
const A = globalThis.VREnumAdapters;

/* ---------------- 路由判定 ---------------- */

test('有 adapter 的平台：走 adapter 路径', () => {
    const p = P.createPager({ platform: 'bilibili', ownerId: '12345678' });
    assert.equal(p.supported, true);
    assert.equal(p._via, 'adapter', 'B站有 adapter，必须走 adapter 路径');
});

test('无 adapter 的平台：退回内置策略', () => {
    const p = P.createPager({ platform: 'douyin', ownerId: 'MS4wABC' });
    assert.equal(p.supported, true);
    assert.equal(p._via, 'builtin', '抖音没加载 adapter，应退回内置策略');
});

test('未知平台：两条路都不通时 supported=false', () => {
    const p = P.createPager({ platform: 'nonexistent', ownerId: 'x' });
    assert.equal(p.supported, false);
});

/* ---------------- adapter 路径的行为 ---------------- */

test('adapter 路径：start() 产出带 mid 的 URL', () => {
    const p = P.createPager({ platform: 'bilibili', ownerId: '12345678', count: 30 });
    const u = p.start();
    assert.ok(u, '应产出首页 URL');
    assert.ok(u.includes('mid=12345678'));
    assert.ok(u.includes('ps=30'));
});

test('adapter 路径：advance 解析响应并产出下一页', () => {
    const p = P.createPager({ platform: 'bilibili', ownerId: '12345678', count: 20 });
    p.start();
    const page1 = {
        code: 0,
        data: {
            list: { vlist: [{ bvid: 'BV1xx411c7mD', title: 'T', pic: '//i0.hdslb.com/a.jpg', author: 'UP', mid: 1 }] },
            page: { pn: 1, ps: 20, count: 60 }
        }
    };
    const next = p.advance(page1);
    assert.ok(next, '3 页数据，第 1 页后应有下一页');
    assert.ok(next.includes('pn=2'));
    assert.equal(p.items().length, 1, 'items() 应能取到本页解析结果');
});

test('adapter 路径：末页后 hasMore=false', () => {
    const p = P.createPager({ platform: 'bilibili', ownerId: '1', count: 20 });
    p.start();
    const last = {
        code: 0,
        data: { list: { vlist: [{ bvid: 'BV1', pic: '//i0.hdslb.com/a.jpg' }] },
                page: { pn: 3, ps: 20, count: 60 } }
    };
    const next = p.advance(last);
    assert.equal(next, null);
    assert.equal(p.hasMore(), false);
});

test('adapter 路径：错误响应能被 error() 取到', () => {
    const p = P.createPager({ platform: 'bilibili', ownerId: '1' });
    p.start();
    p.advance({ code: -352, message: '风控校验失败' });
    assert.ok(p.error().includes('-352'));
});

test('adapter 路径：cursor() 可持久化，restore() 后继续', () => {
    const p = P.createPager({ platform: 'bilibili', ownerId: '1', count: 20 });
    p.start();
    p.advance({ code: 0, data: { list: { vlist: [{ bvid: 'BV1', pic: '//x/a.jpg' }] },
                                  page: { pn: 1, ps: 20, count: 100 } } });
    const c = p.cursor();
    assert.ok(c && c.pageNo, 'cursor 应记录页码');

    const p2 = P.createPager({ platform: 'bilibili', ownerId: '1', count: 20 });
    p2.restore(c);
    assert.equal(p2.hasMore(), true, 'restore 后应可继续');
});

test('adapter 路径：带 mixinKey 时首 URL 自动签名', () => {
    const p = P.createPager({
        platform: 'bilibili', ownerId: '1',
        mixinKey: '0123456789abcdef0123456789abcdef', wts: 1700000000
    });
    const u = p.start();
    assert.ok(u.includes('w_rid='), '有 mixinKey 就必须签名');
    assert.ok(u.includes('wts=1700000000'));
});

/* ---------------- 两条路互不干扰 ---------------- */

test('未注册 adapter 的平台不受 adapter 路径影响', () => {
    /* 抖音没加载 adapter → 内置策略必须照常工作 */
    const p = P.createPager({ platform: 'douyin', ownerId: 'MS4wX', count: 20 });
    assert.equal(p._via, 'builtin');
    const u = p.start();
    assert.ok(u.includes('aweme/post'));
    assert.ok(u.includes('sec_user_id=MS4wX'));
});

test('注册表 platforms() 能看到已注册的 adapter', () => {
    assert.ok(A.platforms().includes('bilibili'));
    assert.equal(A.platforms().includes('douyin'), false, '本测试只加载了 bilibili adapter');
});
