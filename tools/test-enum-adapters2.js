/**
 * 枚举 Adapter 单测（续）—— 抖音 / X / 小红书 / 微博
 *
 * 每个 adapter 都验证三件事：
 *   ① 已注册、能力正确
 *   ② firstPage 是纯构造（不发请求、参数正确）
 *   ③ parsePage 能吃真实响应结构，产出统一 item
 *
 * 全部 fixture，不联网。跑法：node tools/test-enum-adapters2.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

globalThis.self = globalThis;
const base = path.join(__dirname, '..', 'js', 'enumerate');
require(path.join(base, 'bili-wbi.js'));
require(path.join(base, 'adapters', 'index.js'));
require(path.join(base, 'adapters', 'bilibili.js'));
require(path.join(base, 'adapters', 'douyin.js'));
require(path.join(base, 'adapters', 'x.js'));
require(path.join(base, 'adapters', 'xiaohongshu.js'));
require(path.join(base, 'adapters', 'weibo.js'));

const A = globalThis.VREnumAdapters;
const DY = globalThis.VRDouyinAdapter;
const X = globalThis.VRXAdapter;
const XHS = globalThis.VRXhsAdapter;
const WB = globalThis.VRWeiboAdapter;

test('注册表：5 个平台全部就位', () => {
    const ps = A.platforms().sort();
    assert.deepEqual(ps, ['bilibili', 'douyin', 'weibo', 'x', 'xiaohongshu'].sort());
});

/* ---------------- 抖音 ---------------- */

test('抖音：firstPage 带专用版本号 290100', () => {
    const u = DY.firstPage({ ownerId: 'MS4wLjABAAAAtest', count: 20 });
    assert.ok(u.includes('/aweme/v1/web/aweme/post/'));
    assert.ok(u.includes('sec_user_id=MS4wLjABAAAAtest'));
    assert.ok(u.includes('max_cursor=0'));
    assert.ok(u.includes('version_code=290100'), '博主作品接口版本号必须是 290100');
});

test('抖音：parsePage 图文 → 多 item（每张图一条）', () => {
    const j = {
        status_code: 0,
        has_more: 1,
        max_cursor: 1690000000,
        aweme_list: [{
            aweme_id: '7300000000000000001',
            desc: '一组图文',
            create_time: 1699999999,
            author: { nickname: '某博主', sec_uid: 'SEC123', unique_id: 'abc' },
            images: [
                { url_list: ['https://p3.douyinpic.com/a~tplv-x.webp', 'https://p9.douyinpic.com/a~tplv-y.webp'] },
                { url_list: ['https://p3.douyinpic.com/b~tplv-x.webp'] }
            ]
        }]
    };
    const r = DY.parsePage(j, { ownerName: '某博主', ownerId: 'SEC123' });
    assert.equal(r.items.length, 2, '两张图应产出两个 item');
    assert.equal(r.hasMore, true);
    assert.equal(r.cursor.maxCursor, 1690000000);
    const it = r.items[0];
    assert.equal(it.kind, 'image');
    assert.ok(it.url.includes('douyinpic.com'));
    assert.equal(it.authorId, 'SEC123');
    assert.equal(it.awemeId, '7300000000000000001');
});

test('抖音：parsePage 视频 → 取 url_list 最后一个（最高清）', () => {
    const j = {
        status_code: 0, has_more: 0,
        aweme_list: [{
            aweme_id: '7300000000000000002',
            desc: '一个视频',
            author: { nickname: 'UP', sec_uid: 'S' },
            video: {
                play_addr: { url_list: ['https://v.douyin.com/low.mp4', 'https://v.douyin.com/high.mp4'] },
                cover: { url_list: ['https://p3.douyinpic.com/cover.jpg'] }
            }
        }]
    };
    const r = DY.parsePage(j);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].kind, 'video');
    assert.ok(r.items[0].url.endsWith('high.mp4'), '应取列表最后一个');
    assert.equal(r.hasMore, false);
});

test('抖音：未登录是独立状态（抖珍藏的失败三态）', () => {
    const r = DY.parsePage({ status_code: 0, status_msg: '用户未登录', aweme_list: [] });
    assert.ok(r.error.startsWith('not_logged_in'), '未登录必须能被上层识别');
});

test('抖音：脏输入不崩', () => {
    [null, {}, { status_code: 0 }].forEach((j) => {
        const r = DY.parsePage(j);
        assert.equal(r.items.length, 0);
    });
});

/* ---------------- X ---------------- */

function xFixture(bottomCursor) {
    const entries = [{
        entryId: 'profile-grid-0',
        content: {
            itemContent: {
                tweet_results: {
                    result: {
                        rest_id: '1700000000000000001',
                        core: { user_results: { result: { rest_id: 'U1', core: { screen_name: 'someone' } } } },
                        legacy: {
                            full_text: '一条推文',
                            created_at: 'Mon Nov 17 10:00:00 +0000 2026',
                            extended_entities: {
                                media: [
                                    { type: 'photo', id_str: 'm1', media_url_https: 'https://pbs.twimg.com/media/a.jpg' },
                                    { type: 'video', id_str: 'm2', video_info: { variants: [
                                        { bitrate: 256000, url: 'https://v.twimg.com/low.mp4' },
                                        { bitrate: 2176000, url: 'https://v.twimg.com/high.mp4' },
                                        { bitrate: 0, url: 'https://v.twimg.com/x.m3u8' }
                                    ] } }
                                ]
                            }
                        }
                    }
                }
            }
        }
    }];
    if (bottomCursor) {
        entries.push({ content: { cursorType: 'Bottom', value: bottomCursor } });
    }
    return { data: { user: { result: { timeline_v2: { timeline: { instructions: [
        { type: 'TimelineAddEntries', entries: entries }
    ] } } } } } };
}

test('X：firstPage 无 queryId 时返回 null（走被动拦截）', () => {
    assert.equal(X.firstPage({ ownerId: 'someone' }), null);
});

test('X：firstPage 有 queryId 时产出 UserMedia 地址', () => {
    const u = X.firstPage({ ownerId: 'U1', queryId: 'ABC123', subTab: 'media', count: 20 });
    assert.ok(u.includes('/ABC123/UserMedia'));
    assert.ok(u.includes('variables='));
});

test('X：parsePage 解出图片与视频（跳过 m3u8）', () => {
    const r = X.parsePage(xFixture('CUR2'), { ownerName: 'someone', ownerId: 'U1' });
    assert.equal(r.items.length, 2, '一图一视频');
    const img = r.items.find(i => i.kind === 'image');
    const vid = r.items.find(i => i.kind === 'video');
    assert.ok(img.url.includes('name=orig'), '图片应要原图');
    assert.ok(vid.url.endsWith('high.mp4'), '视频应取最高码率');
    assert.equal(r.hasMore, true);
    assert.equal(r.cursor.cursor, 'CUR2');
});

test('X：无 Bottom 游标时终止（Plucker 实证的判据）', () => {
    const r = X.parsePage(xFixture(''), {});
    assert.equal(r.hasMore, false);
    assert.equal(r.cursor, null);
});

test('X：GraphQL 错误结构被识别', () => {
    const r = X.parsePage({ errors: [{ message: 'Rate limit exceeded' }] });
    assert.equal(r.items.length, 0);
    assert.ok(r.error.includes('Rate limit'));
});

/* ---------------- 小红书 ---------------- */

test('小红书：firstPage 带 user_id / cursor / num', () => {
    const u = XHS.firstPage({ ownerId: '5f1a2b3c4d5e6f7a8b9c0d1e', count: 20 });
    assert.ok(u.includes('user_posted'));
    assert.ok(u.includes('user_id=5f1a2b3c4d5e6f7a8b9c0d1e'));
    assert.ok(u.includes('num=20'));
});

test('小红书：parsePage 图文 → 图片 item', () => {
    const j = { code: 0, data: { has_more: true, cursor: 'CUR1', notes: [{
        note_id: '66aabbccddeeff0011223344', display_title: '一篇笔记', type: 'normal',
        user: { user_id: 'U9', nickname: '博主' },
        cover: { url_default: 'https://sns-img.xhscdn.com/a.jpg' }
    }] } };
    const r = XHS.parsePage(j, { ownerName: '博主', ownerId: 'U9' });
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].kind, 'image');
    assert.equal(r.items[0].noteId, '66aabbccddeeff0011223344');
    assert.equal(r.hasMore, true);
    assert.equal(r.cursor.cursor, 'CUR1');
});

test('小红书：parsePage 视频 → 取最高码率 h264', () => {
    const j = { code: 0, data: { has_more: false, notes: [{
        note_id: 'N1', display_title: '视频笔记', type: 'video',
        user: { user_id: 'U', nickname: 'B' },
        video: { media: { stream: { h264: [
            { master_url: 'https://sns-v.xhscdn.com/low.mp4', avg_bitrate: 500000 },
            { master_url: 'https://sns-v.xhscdn.com/high.mp4', avg_bitrate: 3000000 }
        ] } } }
    }] } };
    const r = XHS.parsePage(j);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].kind, 'video');
    assert.ok(r.items[0].url.endsWith('high.mp4'));
});

test('小红书：兼容 SSR 结构（无 data 外层）', () => {
    const r = XHS.parsePage({ notes: [{ note_id: 'N2', cover: { url_default: 'https://sns-img.xhscdn.com/b.jpg' } }], has_more: false });
    assert.equal(r.items.length, 1);
});

/* ---------------- 微博 ---------------- */

test('微博：firstPage 带 uid / page，sinceId 可选', () => {
    const u1 = WB.firstPage({ ownerId: '1234567890', pageNo: 1 });
    assert.ok(u1.includes('mymblog'));
    assert.ok(u1.includes('uid=1234567890'));
    assert.ok(u1.includes('page=1'));
    assert.ok(!u1.includes('since_id'));
    const u2 = WB.firstPage({ ownerId: '1', pageNo: 2, sinceId: 'S0' });
    assert.ok(u2.includes('since_id=S0'));
});

test('微博：parsePage 图片按 large 取', () => {
    const j = { ok: 1, data: { since_id: 'S1', list: [{
        idstr: '4900000000000001', text_raw: '一条微博',
        user: { id: 1234567890, screen_name: '博主' },
        pics: [{ large: { url: 'https://wx1.sinaimg.cn/large/a.jpg' } }]
    }] } };
    const r = WB.parsePage(j, { pageNo: 1 });
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].kind, 'image');
    assert.ok(r.items[0].url.includes('/large/'));
    assert.equal(r.items[0].statusId, '4900000000000001');
    assert.equal(r.hasMore, true);
    assert.equal(r.cursor.sinceId, 'S1');
});

test('微博：parsePage 视频按 1080>720>hd>sd 取', () => {
    const j = { ok: 1, data: { since_id: 'S2', list: [{
        idstr: 'M1', text_raw: '视频', user: { id: 1, screen_name: 'B' },
        page_info: { media_info: { mp4_720p_mp4: 'https://f.video.weibocdn.com/720.mp4',
                                   mp4_1080p_mp4: 'https://f.video.weibocdn.com/1080.mp4' } }
    }] } };
    const r = WB.parsePage(j);
    assert.equal(r.items.length, 1);
    assert.ok(r.items[0].url.includes('1080.mp4'), '应优先 1080');
});

test('微博：since_id 不变时终止（防死循环）', () => {
    const j = { ok: 1, data: { since_id: 'SAME', list: [{ idstr: '1', pics: [] }] } };
    const r = WB.parsePage(j, { sinceId: 'SAME' });
    assert.equal(r.hasMore, false);
});

test('微博：ok != 1 时识别未登录', () => {
    const r = WB.parsePage({ ok: 0, msg: '请先登录', url: 'https://passport.weibo.com/login' });
    assert.ok(r.error.startsWith('not_logged_in'));
});

/* ---------------- 统一契约 ---------------- */

test('所有 adapter 的 item 都具备下载链路必需字段', () => {
    const items = []
        .concat(DY.parsePage({ status_code: 0, aweme_list: [{ aweme_id: '1', video: { play_addr: { url_list: ['https://a/b.mp4'] } }, author: {} }] }).items)
        .concat(XHS.parsePage({ code: 0, data: { notes: [{ note_id: 'N', cover: { url_default: 'https://a/b.jpg' } }] } }).items)
        .concat(WB.parsePage({ ok: 1, data: { since_id: 'Z', list: [{ idstr: '9', pics: [{ url: 'https://a/c.jpg' }], user: {} }] } }).items);

    assert.ok(items.length >= 3);
    items.forEach((it) => {
        ['url', 'kind', 'title', 'pageUrl', 'author', 'authorId'].forEach((k) => {
            assert.ok(k in it, 'item 缺字段 ' + k);
        });
        assert.ok(/^https?:/i.test(it.url) || it.url === '', 'url 应是 http(s)');
    });
});
