/**
 * B站番剧枚举单测（审计 D10）
 *
 * 端点实测（2026-11-18，Edge 9480 登录态）：
 *   GET api.bilibili.com/pgc/view/web/season?season_id=355139  → code 0，18 集
 *   GET api.bilibili.com/pgc/view/web/season?ep_id=7702131     → code 0，18 集（同 season）
 *   · 免登录可用（不需要 wbi 签名），与合集端点同性质
 *   · ⚠️ `episodes[].duration` 单位是**毫秒**（421000 = 421 秒），与整博主
 *     `vlist[].length`（"4:21" 字符串）口径不同 —— 本测试专门钉住这个换算。
 *   · 研究文档记的 `pgc/view/web/ep/list` 也能用，但结构不含 season_id/total，
 *     故选结构更全的 `pgc/view/web/season`。
 *
 * 跑法：node tools/test-enum-bangumi.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

globalThis.self = globalThis;

const T = require(path.join(__dirname, '..', 'js', 'enumerate', 'targets.js'));
/* ⑤b 要核对 store.buildKey 与 targets.targetKey 规则一致，必须加载 store */
require(path.join(__dirname, '..', 'js', 'enumerate', 'store.js'));
require(path.join(__dirname, '..', 'js', 'enumerate', 'adapters', 'index.js'));
require(path.join(__dirname, '..', 'js', 'enumerate', 'adapters', 'bilibili.js'));
const A = globalThis.VRBiliAdapter;

/* ---------------- ① targets：番剧 URL 识别 ---------------- */

test('① 番剧 ss 链接 → targetKind=bangumi + seasonId', () => {
    const r = T.detectOwnerTarget('https://www.bilibili.com/bangumi/play/ss355139');
    assert.ok(r, '应识别出目标');
    assert.equal(r.targetKind, 'bangumi');
    assert.equal(r.seasonId, '355139');
    assert.equal(r.epId, '');
    assert.equal(r.platform, 'bilibili');
});

test('①b 番剧 ep 链接 → targetKind=bangumi + epId', () => {
    const r = T.detectOwnerTarget('https://www.bilibili.com/bangumi/play/ep7702131');
    assert.ok(r);
    assert.equal(r.targetKind, 'bangumi');
    assert.equal(r.epId, '7702131');
    assert.equal(r.seasonId, '');
});

test('①c 番剧页不会被误判成普通稿件（关键回归）', () => {
    /* 番剧页必须**先于**「普通稿件页返回 null」判定，
     * 否则 /bangumi/play/ss123 会被直接丢掉，整季一集都拿不到。 */
    const r = T.detectOwnerTarget('https://www.bilibili.com/bangumi/play/ss355139');
    assert.notEqual(r, null, '番剧页不能返回 null');
});

test('①d 带尾斜杠的番剧链接也能识别', () => {
    const r = T.detectOwnerTarget('https://www.bilibili.com/bangumi/play/ss355139/');
    assert.ok(r);
    assert.equal(r.seasonId, '355139');
});

test('①e 普通视频页仍返回 null（番剧分支不误伤）', () => {
    assert.equal(T.detectOwnerTarget('https://www.bilibili.com/video/BV1gN411M7kh'), null);
});

test('①f 合集页仍是 collection（番剧分支不抢）', () => {
    const r = T.detectOwnerTarget('https://space.bilibili.com/163637592/channel/collectiondetail?sid=1950143');
    assert.equal(r.targetKind, 'collection');
});

/* ---------------- ② adapter：端点构造 ---------------- */

test('② 番剧 season 模式构造 pgc/view/web/season?season_id=', () => {
    const url = A.firstPage({ targetKind: 'bangumi', seasonId: '355139', epId: '', ownerId: '355139' });
    assert.ok(url.indexOf('pgc/view/web/season') > 0, '应走 season 端点：' + url);
    assert.ok(url.indexOf('season_id=355139') > 0);
});

test('②b 只有 epId 时用 ep_id 参数（实测也能返回整季）', () => {
    const url = A.firstPage({ targetKind: 'bangumi', seasonId: '', epId: '7702131', ownerId: '7702131' });
    assert.ok(url.indexOf('ep_id=7702131') > 0, '应带 ep_id：' + url);
    assert.ok(url.indexOf('season_id') < 0, '不该同时带 season_id');
});

test('②c 番剧不需要 wbi 签名', () => {
    const url = A.firstPage({ targetKind: 'bangumi', seasonId: '355139', ownerId: '355139' });
    assert.ok(url && url.indexOf('?') > 0);
    assert.ok(url.indexOf('w_rid') < 0, '番剧端点不签名');
});

test('②d 两者都没有时返回空串（不构造半成品 URL）', () => {
    const url = A.firstPage({ targetKind: 'bangumi', seasonId: '', epId: '', ownerId: '' });
    assert.equal(url, '');
});

test('②e 整博主端点不受影响（回归）', () => {
    const url = A.firstPage({ ownerId: '163637592', pageNo: 1 });
    assert.ok(url.indexOf('arc/search') > 0, '整博主仍走 arc/search：' + url);
});

test('②f 合集端点不受影响（回归）', () => {
    const url = A.firstPage({ targetKind: 'collection', collectionId: '1950143', ownerId: '2' });
    assert.ok(url.indexOf('seasons_archives_list') > 0);
});

/* ---------------- ③ adapter：响应解析（实测结构） ---------------- */

/** 实测响应裁剪版（season_id=355139，18 集取 3 条） */
const SAMPLE = {
    code: 0,
    message: 'success',
    result: {
        season_id: 355139,
        season_title: '测试番剧',
        total: 18,
        episodes: [
            {
                id: 7702131, ep_id: 7702131, aid: 117585987242252,
                bvid: 'BV1nQWt6yE1W', cid: 1,
                title: '1', long_title: '第一话',
                cover: 'http://i0.hdslb.com/bfs/archive/9823e93169d2',
                duration: 421000,        /* ← 毫秒 */
                pub_time: 1794448800
            },
            {
                id: 7702132, ep_id: 7702132, aid: 117585970465791,
                bvid: 'BV1n9Wt6VEMb', cid: 2,
                title: '2', long_title: '',
                cover: '//i1.hdslb.com/bfs/archive/f5cf818e2e4b',
                duration: 1380000,       /* ← 23 分钟 */
                pub_time: 1794448800
            }
        ]
    }
};

test('③ 解析番剧响应 → item 字段正确', () => {
    const r = A.parsePage(SAMPLE, { targetKind: 'bangumi', ownerName: '', ownerId: '355139' });
    assert.equal(r.error, undefined);
    assert.equal(r.items.length, 2);
    assert.equal(r.total, 2);

    const it = r.items[0];
    assert.equal(it.mediaId, 'BV1nQWt6yE1W', 'mediaId 应是 bvid');
    assert.equal(it.bvid, 'BV1nQWt6yE1W');
    assert.equal(it.pageUrl, 'https://www.bilibili.com/video/BV1nQWt6yE1W');
    assert.equal(it.title, '1');
    assert.equal(it.epId, 7702131);
    assert.equal(it.aid, 117585987242252);
    assert.equal(it.createdAt, 1794448800);
});

test('③b **duration 毫秒 → 秒**（关键换算）', () => {
    /* 实测 episodes[].duration = 421000 表示 421 秒。
     * 若不做换算，下游会把「421 秒」当成「421000 秒」（97 小时）。 */
    const r = A.parsePage(SAMPLE, { targetKind: 'bangumi', ownerId: '355139' });
    assert.equal(r.items[0].duration, '421', '421000ms → 421s');
    assert.equal(r.items[1].duration, '1380', '1380000ms → 1380s');
});

test('③c 封面 // 开头补协议', () => {
    const r = A.parsePage(SAMPLE, { targetKind: 'bangumi', ownerId: '355139' });
    assert.ok(r.items[1].url.indexOf('https://') === 0, '// 开头要补 https：' + r.items[1].url);
});

test('③d 番剧整季一次给全：hasMore=false（不分页）', () => {
    const r = A.parsePage(SAMPLE, { targetKind: 'bangumi', ownerId: '355139' });
    assert.equal(r.hasMore, false, '整季一次性返回，没有下一页');
    assert.equal(r.cursor, null);
});

test('③e 作者来自 ctx（番剧响应里没有 UP 主字段，需调用方传）', () => {
    const r = A.parsePage(SAMPLE, { targetKind: 'bangumi', ownerName: '某番剧', ownerId: '355139' });
    assert.equal(r.items[0].author, '某番剧');
    assert.equal(r.items[0].authorId, '355139');
});

test('③f code≠0 时返回错误（不静默空页）', () => {
    const r = A.parsePage({ code: -404, message: '啥都木有' }, { targetKind: 'bangumi' });
    assert.equal(r.items.length, 0);
    assert.ok(r.error && r.error.indexOf('-404') > 0);
});

test('③g 没有 episodes 时不崩', () => {
    const r = A.parsePage({ code: 0, result: {} }, { targetKind: 'bangumi' });
    assert.deepEqual(r.items, []);
    assert.equal(r.hasMore, false);
});

/* ---------------- ④ 端到端：targets → pager → adapter ---------------- */

test('④ 番剧 URL → pager → pgc 端点 URL', () => {
    const P = require(path.join(__dirname, '..', 'js', 'enumerate', 'pager.js'));
    const target = T.detectOwnerTarget('https://www.bilibili.com/bangumi/play/ss355139');
    const pager = P.createPager({
        platform: target.platform,
        ownerId: target.ownerId,
        targetKind: target.targetKind,
        seasonId: target.seasonId,
        epId: target.epId
    });
    assert.equal(pager.supported, true);
    const url = pager.start();
    assert.ok(url.indexOf('pgc/view/web/season') > 0, 'pager 应产出番剧端点：' + url);
    assert.ok(url.indexOf('season_id=355139') > 0);

    /* advance 吃整季后应该没有下一页 */
    const next = pager.advance(SAMPLE);
    assert.equal(next, null, '整季返回后不该有下一页');
    assert.equal(pager.items().length, 2);
});

/* ---------------- ⑤ 三种 targetKind 互不干扰 ---------------- */

test('⑤ owner / collection / bangumi 三态互斥 + 任务键各不相同', () => {
    const own = T.detectOwnerTarget('https://space.bilibili.com/163637592/video');
    const col = T.detectOwnerTarget('https://space.bilibili.com/163637592/channel/collectiondetail?sid=1950143');
    const ban = T.detectOwnerTarget('https://www.bilibili.com/bangumi/play/ss355139');

    assert.equal(own.targetKind, 'owner');
    assert.equal(col.targetKind, 'collection');
    assert.equal(ban.targetKind, 'bangumi');

    /* ⚠️ ownerId 相同是**正确设计**：合集属于该 UP 主，归档路径要用它的 mid。
     * 真正会冲突的是**任务键**（断点/快照按它存），所以断言 taskKey。 */
    assert.equal(col.ownerId, own.ownerId, '合集与整博主同 ownerId（归档需要 mid）');

    const keys = [T.targetKey(own), T.targetKey(col), T.targetKey(ban)];
    assert.equal(new Set(keys).size, 3, '三个任务键必须各不相同：' + keys.join(' | '));

    /* 整博主保持原键形（不破坏已有断点） */
    assert.equal(keys[0], 'bilibili:163637592');
    assert.ok(keys[1].indexOf(':c1950143') > 0, '合集键应带合集后缀：' + keys[1]);
    assert.ok(keys[2].indexOf(':b') > 0, '番剧键应带番剧后缀：' + keys[2]);
});

test('⑤b store.buildKey 与 targets.targetKey 规则一致（否则任务读不到）', () => {
    const S = globalThis.VREnumStore;
    const cases = [
        { platform: 'bilibili', ownerId: '163637592', targetKind: 'owner' },
        { platform: 'bilibili', ownerId: '163637592', targetKind: 'collection', collectionId: '1950143' },
        { platform: 'bilibili', ownerId: '355139', targetKind: 'bangumi' }
    ];
    cases.forEach((t) => {
        assert.equal(S.buildKey(t), T.targetKey(t),
            '两边规则必须一致：' + JSON.stringify(t));
    });
});