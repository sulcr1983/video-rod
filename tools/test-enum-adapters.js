/**
 * 枚举 Adapter 单测（注册表 + B站 adapter）
 *
 * 为什么必须先测 adapter：
 *   枚举层的价值在于「产出的 item 能被下载链路直接消费」。
 *   adapter 是唯一与站点打交道的地方，它的输出格式错了，
 *   下游不会报错，只会静默下载 0 条——这是最难查的一类 bug。
 *
 * 本测试不联网：全部用 fixture（真实响应结构的裁剪版）。
 * 跑法：node tools/test-enum-adapters.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

globalThis.self = globalThis;
require(path.join(__dirname, '..', 'js', 'enumerate', 'bili-wbi.js'));
require(path.join(__dirname, '..', 'js', 'enumerate', 'adapters', 'index.js'));
require(path.join(__dirname, '..', 'js', 'enumerate', 'adapters', 'bilibili.js'));

const A = globalThis.VREnumAdapters;
const B = globalThis.VRBiliAdapter;

/* ---------------- 注册表契约 ---------------- */

test('注册表：B站已自动注册', () => {
    assert.ok(A.platforms().includes('bilibili'));
});

test('注册表：get 未注册平台返回 null（不返回半个对象）', () => {
    assert.equal(A.get('nonexistent'), null);
});

test('注册表：supports 判定能力', () => {
    assert.equal(A.supports('bilibili', 'owner'), true);
    assert.equal(A.supports('bilibili', 'video'), false);
    assert.equal(A.supports('nonexistent', 'owner'), false);
    assert.equal(A.supports('bilibili'), true);
});

test('注册表：缺 firstPage / parsePage 时注册失败', () => {
    assert.equal(A.register({ platform: 'x1' }), false);
    assert.equal(A.register({ platform: 'x2', firstPage: () => null }), false);
    assert.equal(A.register({}), false);
});

test('注册表：adapter 记录 requiresAuth 与 helpers', () => {
    const a = A.get('bilibili');
    assert.equal(a.requiresAuth, false);
    assert.equal(a.helpers.signer, 'bili-wbi');
    assert.equal(a.helpers.needsMixinKey, true);
});

/* ---------------- B站 firstPage：纯构造 ---------------- */

test('B站 firstPage：不带 mixinKey 时产出未签名 URL（便于诊断）', () => {
    const u = B.firstPage({ ownerId: '12345678', count: 20 });
    assert.ok(u.includes('/x/space/wbi/arc/search'));
    assert.ok(u.includes('mid=12345678'));
    assert.ok(u.includes('pn=1'));
    assert.ok(u.includes('ps=20'));
    assert.ok(!u.includes('w_rid'), '没有 mixinKey 就不该有签名');
});

test('B站 firstPage：带 mixinKey 时自动签名', () => {
    const u = B.firstPage({
        ownerId: '12345678', count: 20, pageNo: 2,
        mixinKey: '0123456789abcdef0123456789abcdef',
        wts: 1700000000
    });
    assert.ok(u.includes('w_rid='), '应带 w_rid');
    assert.ok(u.includes('wts=1700000000'), '应带 wts');
    assert.ok(u.includes('pn=2'));
});

test('B站 firstPage：翻页只改 pn', () => {
    const u1 = B.firstPage({ ownerId: '1', count: 20, pageNo: 1 });
    const u3 = B.firstPage({ ownerId: '1', count: 20, pageNo: 3 });
    assert.ok(u1.includes('pn=1'));
    assert.ok(u3.includes('pn=3'));
});

/* ---------------- B站 parsePage：真实响应结构 ---------------- */

function fixture(total, pn, ps, n) {
    const vlist = [];
    for (let i = 0; i < n; i++) {
        vlist.push({
            bvid: 'BV1' + String(i).padStart(9, '0'),
            aid: 100000 + i,
            title: '视频标题 ' + i,
            pic: '//i0.hdslb.com/bfs/archive/cover' + i + '.jpg',
            author: '某个UP主',
            mid: 12345678,
            created: 1699999999,
            length: '05:30',
            description: '简介'
        });
    }
    return {
        code: 0,
        data: {
            list: { vlist: vlist },
            page: { pn: pn, ps: ps, count: total }
        }
    };
}

test('B站 parsePage：code 非 0 返回 error 且不给 items', () => {
    const r = B.parsePage({ code: -352, message: '风控校验失败' });
    assert.equal(r.items.length, 0);
    assert.equal(r.hasMore, false);
    assert.ok(r.error.includes('-352'));
    assert.ok(r.error.includes('风控'));
});

test('B站 parsePage：正常一页 → 统一 item', () => {
    const r = B.parsePage(fixture(100, 1, 20, 20), { ownerName: '某个UP主', ownerId: '12345678' });
    assert.equal(r.items.length, 20);
    assert.equal(r.total, 100);
    const it = r.items[0];
    /* 契约字段：url / kind / title / pageUrl / author / authorId / mediaId */
    assert.ok(it.url.startsWith('https://i0.hdslb.com/'), '无协议封面应补 https');
    assert.equal(it.kind, 'image');
    assert.equal(it.title, '视频标题 0');
    assert.ok(it.pageUrl.includes('BV1'));
    assert.equal(it.author, '某个UP主');
    assert.equal(it.authorId, '12345678');
    assert.ok(it.mediaId.startsWith('BV1'));
});

test('B站 parsePage：分页推进与终止', () => {
    /* 100 条 / 20 每页 = 5 页 */
    const p1 = B.parsePage(fixture(100, 1, 20, 20));
    assert.equal(p1.hasMore, true);
    assert.equal(p1.cursor.pageNo, 2);

    const p5 = B.parsePage(fixture(100, 5, 20, 20));
    assert.equal(p5.hasMore, false, '第 5 页是最后一页');
});

test('B站 parsePage：空列表终止', () => {
    const r = B.parsePage(fixture(100, 3, 20, 0));
    assert.equal(r.items.length, 0);
    assert.equal(r.hasMore, false);
});

test('B站 parsePage：count 为 0 时不瞎翻', () => {
    const r = B.parsePage({ code: 0, data: { list: { vlist: [] }, page: { pn: 1, ps: 20, count: 0 } } });
    assert.equal(r.hasMore, false);
});

test('B站 parsePage：脏输入不崩', () => {
    [null, undefined, {}, { code: 0 }, { code: 0, data: null }].forEach((j) => {
        const r = B.parsePage(j);
        assert.equal(r.items.length, 0);
        assert.equal(r.hasMore, false);
    });
});

test('B站 toItem：字段完整且可直接喂给 normalize', () => {
    const it = B.toItem({
        bvid: 'BV1xx411c7mD', aid: 2, title: 'T', pic: '//i0.hdslb.com/a.jpg',
        author: 'UP', mid: 99, created: 1700000000, length: '01:02'
    }, 'UP', '99');
    ['url', 'kind', 'title', 'pageUrl', 'author', 'authorId', 'mediaId'].forEach((k) => {
        assert.ok(k in it, '缺字段 ' + k);
    });
    assert.equal(it.aid, 2);
    assert.equal(it.duration, '01:02');
});
