/**
 * B站合集枚举单测（审计 E2）
 *
 * 实测结论（2026-11-18，Edge 9480 登录态）：
 *   · 正确端点 = x/polymer/web-space/seasons_archives_list
 *     （不是竞品用的 x/v2/medialist/resource/list —— 后者 pn 翻页无效、
 *       next_start_key 为空、oid 游标 -400、total 与合集总数不符）
 *   · 分页正常：page_size=10 → 第 1 页 10 条 + 第 2 页 1 条（合集共 11）
 *   · **免登录也可用**（不带 credentials 仍 code 0）→ 不需要 wbi 签名
 *   · 合集列表端点 = x/polymer/web-space/seasons_series_list
 *     （返回该 UP 主的合集 sid / 名字 / 条数）
 *
 * 跑法：node tools/test-enum-collection.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

/* adapter 的 UMD 是 `typeof self !== 'undefined' ? self : this`。
 * Node 模块作用域里 this === module.exports，所以**必须**先把 self 指向
 * globalThis，否则注册表会挂到一次性的 exports 对象上，
 * pager 找不到 adapter 就退回内置策略（arc/search）—— 表现为「合集枚举
 * 静默变成整博主枚举」，不报错但结果全错。 */
globalThis.self = globalThis;

const T = require(path.join(__dirname, '..', 'js', 'enumerate', 'targets.js'));
require(path.join(__dirname, '..', 'js', 'enumerate', 'adapters', 'index.js'));
require(path.join(__dirname, '..', 'js', 'enumerate', 'adapters', 'bilibili.js'));
const A = globalThis.VRBiliAdapter;

/* ---------------- ① targets：合集 URL 识别 ---------------- */

test('targets：UP 主空间的合集页识别为 collection', () => {
    const r = T.detectOwnerTarget('https://space.bilibili.com/163637592/channel/collectiondetail?sid=1950143');
    assert.ok(r, '应识别出目标');
    assert.equal(r.targetKind, 'collection');
    assert.equal(r.ownerId, '163637592');
    assert.equal(r.collectionId, '1950143');
});

test('targets：合集页不会被误判成整博主（关键回归）', () => {
    /* 合集页 pathname 是 /<mid>/channel/collectiondetail，
     * 若先走 parseBilibili 就会变成「整博主」，枚举出 UP 全部作品而非该合集。 */
    const r = T.detectOwnerTarget('https://space.bilibili.com/163637592/channel/collectiondetail?sid=1950143');
    assert.notEqual(r.targetKind, 'owner');
});

test('targets：medialist 独立详情页识别为 collection', () => {
    const r = T.detectOwnerTarget('https://www.bilibili.com/medialist/detail/ml1950143');
    assert.ok(r);
    assert.equal(r.targetKind, 'collection');
    assert.equal(r.collectionId, '1950143');
});

test('targets：普通 UP 主空间仍是 owner（合集判定不误伤）', () => {
    const r = T.detectOwnerTarget('https://space.bilibili.com/163637592/video');
    assert.ok(r);
    assert.notEqual(r.targetKind, 'collection');
    assert.equal(r.ownerId, '163637592');
});

test('targets：普通视频页不识别为目标', () => {
    assert.equal(T.detectOwnerTarget('https://www.bilibili.com/video/BV1gN411M7kh'), null);
});

test('targets：合集页缺 sid 或 sid 非法时回退为 owner', () => {
    assert.equal(
        T.detectOwnerTarget('https://space.bilibili.com/163637592/channel/collectiondetail?sid=abc').targetKind,
        'owner');
    assert.equal(
        T.detectOwnerTarget('https://space.bilibili.com/163637592/channel/collectiondetail').targetKind,
        'owner');
});

test('targets：合集目标与整博主目标共用 ownerId，但**任务键不同**', () => {
    const col = T.detectOwnerTarget('https://space.bilibili.com/163637592/channel/collectiondetail?sid=1950143');
    const own = T.detectOwnerTarget('https://space.bilibili.com/163637592/video');
    /* ownerId 相同是正确设计：合集属于该 UP 主，归档路径要用它的 mid。 */
    assert.equal(T.sameTarget(col, own), true, 'sameTarget 仍按博主判定');

    /* ⚠️ 2026-11-18（D10 连带修复）：原来断言 targetKey(col) === 'bilibili:163637592'，
     * 那正是**撞键 bug** —— 同一 UP 主的整博主与它的某个合集共用一个任务键，
     * 断点 cursor 与 masterIds 快照互相覆盖（合集 11 条会把整博主上千条压掉）。
     * 现在合集键带 :c<collectionId> 后缀，两者不再相同。 */
    assert.equal(T.targetKey(own), 'bilibili:163637592', '整博主保持原键形（不破坏已有断点）');
    assert.equal(T.targetKey(col), 'bilibili:163637592:c1950143');
    assert.notEqual(T.targetKey(col), T.targetKey(own), '两个任务键必须不同');
});

/* ---------------- ② adapter：端点构造 ---------------- */

test('adapter：合集模式构造 seasons_archives_list（不是 medialist）', () => {
    const url = A.firstPage({
        targetKind: 'collection', collectionId: '1950143',
        ownerId: '163637592', pageNo: 1, count: 30
    });
    assert.ok(url.indexOf('seasons_archives_list') > 0, '应走 seasons_archives_list：' + url);
    assert.ok(url.indexOf('medialist') < 0, '不该用 medialist：' + url);
    assert.ok(url.indexOf('season_id=1950143') > 0, '应带 season_id');
    assert.ok(url.indexOf('mid=163637592') > 0, '应带 mid');
    assert.ok(url.indexOf('page_num=1') > 0, '应带 page_num');
});

test('adapter：合集模式不需要 wbi 签名（免登录可用）', () => {
    /* 不给 mixinKey 也必须能构造出可用 URL */
    const url = A.firstPage({
        targetKind: 'collection', collectionId: '1950143',
        ownerId: '163637592', pageNo: 1
    });
    assert.ok(url && url.indexOf('?') > 0);
    assert.ok(url.indexOf('w_rid') < 0, '合集端点不签名');
});

test('adapter：整博主模式仍走 arc/search（回归）', () => {
    const url = A.firstPage({ ownerId: '163637592', pageNo: 1, count: 20 });
    assert.ok(url.indexOf('arc/search') > 0, '整博主端点不该变：' + url);
});

test('adapter：合集模式翻页时 page_num 递增', () => {
    const u1 = A.firstPage({ targetKind: 'collection', collectionId: '1', ownerId: '2', pageNo: 1, count: 30 });
    const u2 = A.firstPage({ targetKind: 'collection', collectionId: '1', ownerId: '2', pageNo: 2, count: 30 });
    assert.ok(u1.indexOf('page_num=1') > 0);
    assert.ok(u2.indexOf('page_num=2') > 0);
});

/* ---------------- ③ adapter：响应解析（实测结构） ---------------- */

/** 实测响应样本（何同学 sid=1950143，page_size=10 第 1 页） */
const SAMPLE = {
    code: 0,
    message: 'OK',
    data: {
        aids: [1, 2, 3],
        archives: [
            {
                aid: 1, bvid: 'BV1gN411M7kh', ctime: 1700740326,
                duration: 84, pic: 'http://i2.hdslb.com/bfs/archive/ffdf6f144e33',
                pubdate: 1700740326, title: '动态视频｜我们用记忆金属做了一盆花',
                type: 1, state: 0, mid: 163637592
            },
            {
                aid: 2, bvid: 'BV1bh4y1Y7Jv', ctime: 1694664459,
                duration: 131, pic: 'http://i1.hdslb.com/bfs/archive/54a40e4dbffd',
                pubdate: 1694664459, title: '动态视频 | 两年半没见，库克还认识我吗',
                type: 1, state: 0
            }
        ],
        meta: { mid: 163637592, season_id: 1950143 },
        page: { page_num: 1, page_size: 10, total: 11 }
    }
};

test('adapter：解析合集响应 → item 字段正确', () => {
    const r = A.parsePage(SAMPLE, {
        targetKind: 'collection', collectionId: '1950143',
        ownerName: '何同学', ownerId: '163637592'
    });
    assert.equal(r.error, undefined, '不该有错误');
    assert.equal(r.items.length, 2);
    assert.equal(r.total, 11, '总数应来自 page.total');
    const it = r.items[0];
    assert.equal(it.mediaId, 'BV1gN411M7kh', 'mediaId 应是 bvid');
    assert.equal(it.bvid, 'BV1gN411M7kh');
    assert.equal(it.pageUrl, 'https://www.bilibili.com/video/BV1gN411M7kh');
    assert.equal(it.author, '何同学');
    assert.equal(it.authorId, '163637592');
    assert.equal(it.createdAt, 1700740326);
    assert.equal(it.duration, '84');
    assert.ok(it.url.indexOf('hdslb.com') > 0, '封面地址应保留');
});

test('adapter：合集响应分页游标正确（第 1 页 → pageNo 2，仍有下一页）', () => {
    const r = A.parsePage(SAMPLE, { targetKind: 'collection', ownerName: '何同学', ownerId: '163637592' });
    assert.deepEqual(r.cursor, { pageNo: 2 });
    assert.equal(r.hasMore, true, 'total=11, ps=10 → 第 1 页后还有第 2 页');
});

test('adapter：最后一页 hasMore=false', () => {
    const last = JSON.parse(JSON.stringify(SAMPLE));
    last.data.page = { page_num: 2, page_size: 10, total: 11 };
    last.data.archives = last.data.archives.slice(0, 1);
    const r = A.parsePage(last, { targetKind: 'collection', ownerId: '1' });
    assert.equal(r.hasMore, false, '第 2 页是末页');
    assert.deepEqual(r.cursor, { pageNo: 3 });
});

test('adapter：合集响应 code≠0 时返回错误（不静默空页）', () => {
    const r = A.parsePage({ code: -404, message: '啥都木有' }, { targetKind: 'collection' });
    assert.equal(r.items.length, 0);
    assert.ok(r.error, '应带错误说明');
    assert.ok(r.error.indexOf('-404') > 0);
});

test('adapter：整博主模式不受合集分支影响（回归）', () => {
    const ownerSample = {
        code: 0,
        data: {
            list: { vlist: [{ bvid: 'BV1x', aid: 9, title: '作品', pic: '//i0.hdslb.com/a.jpg', author: 'UP', mid: 5 }] },
            page: { pn: 1, ps: 20, count: 1 }
        }
    };
    const r = A.parsePage(ownerSample, { ownerName: 'UP', ownerId: '5' });
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].mediaId, 'BV1x');
    assert.ok(r.items[0].url.indexOf('https://') === 0, '// 开头要补协议');
});

/* ---------------- ④ 端到端：targets → pager → adapter ---------------- */

test('端到端：合集 URL → pager → 合集端点 URL', () => {
    const P = require(path.join(__dirname, '..', 'js', 'enumerate', 'pager.js'));
    const target = T.detectOwnerTarget(
        'https://space.bilibili.com/163637592/channel/collectiondetail?sid=1950143');

    const pager = P.createPager({
        platform: target.platform,
        ownerId: target.ownerId,
        ownerName: '何同学',
        targetKind: target.targetKind,
        collectionId: target.collectionId,
        count: 30
    });
    assert.equal(pager.supported, true);
    const url = pager.start();
    assert.ok(url.indexOf('seasons_archives_list') > 0, 'pager 应产出合集端点：' + url);
    assert.ok(url.indexOf('season_id=1950143') > 0);

    /* advance 吃一页 → 产出下一页 */
    const next = pager.advance(SAMPLE);
    assert.ok(next, '应还有下一页');
    assert.ok(next.indexOf('page_num=2') > 0, '下一页 page_num=2：' + next);
    assert.equal(pager.items().length, 2, 'items 应来自本页');
    assert.deepEqual(pager.cursor(), { pageNo: 2 });
});

test('端到端：合集断点恢复后从第 2 页继续', () => {
    const P = require(path.join(__dirname, '..', 'js', 'enumerate', 'pager.js'));
    const pager = P.createPager({
        platform: 'bilibili', ownerId: '163637592',
        targetKind: 'collection', collectionId: '1950143', count: 30
    });
    pager.restore({ pageNo: 2 });
    const url = pager.start();
    assert.ok(url.indexOf('page_num=2') > 0, '恢复后应从第 2 页开始：' + url);
});
