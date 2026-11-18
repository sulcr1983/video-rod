/**
 * VREnumTargets 单测 —— 博主主页 URL 识别
 *
 * 为什么要有这一层测试：
 * 枚举层的第一步是「给定 URL 判断这是不是一个博主的作品列表页」。
 * 判错会把「作品详情页」当博主（无尽翻页），或把「博主页」当普通页（枚举不出来）。
 * 这两个错误在真实站点上都很难人工发现，必须在纯函数层钉死。
 *
 * 跑法：node tools/test-enum-targets.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

globalThis.self = globalThis;
require(path.join(__dirname, '..', 'js', 'enumerate', 'targets.js'));

const T = globalThis.VREnumTargets;

function ok(url) {
    const t = T.detectOwnerTarget(url);
    assert.ok(t, `应识别为博主页：${url}`);
    return t;
}
function no(url) {
    const t = T.detectOwnerTarget(url);
    assert.equal(t, null, `不应识别为博主页：${url}`);
}

/* ---------------- X / Twitter ---------------- */

test('X：单段路径识别为博主', () => {
    const t = ok('https://x.com/elonmusk');
    assert.equal(t.platform, 'x');
    assert.equal(t.ownerId, 'elonmusk');
    assert.equal(t.ownerKind, 'screen_name');
});

test('X：twitter.com 同域识别', () => {
    const t = ok('https://twitter.com/jack');
    assert.equal(t.platform, 'x');
    assert.equal(t.ownerId, 'jack');
});

test('X：/media 子页仍属同一博主，且标注 subTab', () => {
    const t = ok('https://x.com/elonmusk/media');
    assert.equal(t.ownerId, 'elonmusk');
    assert.equal(t.subTab, 'media');
});

test('X：作品详情页不是博主页', () => {
    no('https://x.com/elonmusk/status/1234567890123456789');
});

test('X：保留字路径不是博主（home/explore/i/settings…）', () => {
    ['home', 'explore', 'notifications', 'messages', 'i', 'search',
     'settings', 'compose', 'login', 'hashtag', 'bookmarks'].forEach((k) => {
        no('https://x.com/' + k);
    });
});

test('X：根路径不是博主', () => {
    no('https://x.com/');
});

test('X：非法字符的路径不是博主', () => {
    no('https://x.com/带空格 名字');
});

/* ---------------- 抖音 ---------------- */

test('抖音：/user/<sec_uid> 识别', () => {
    const t = ok('https://www.douyin.com/user/MS4wLjABAAAAabcd1234EFGH5678ijkl');
    assert.equal(t.platform, 'douyin');
    assert.equal(t.ownerId, 'MS4wLjABAAAAabcd1234EFGH5678ijkl');
    assert.equal(t.ownerKind, 'sec_uid');
});

test('抖音：作品页（/video/<id>）不是博主', () => {
    no('https://www.douyin.com/video/7300000000000000000');
});

test('抖音：图文页（/note/<id>）不是博主', () => {
    no('https://www.douyin.com/note/7300000000000000000');
});

test('抖音：/user/ 后面太短不认（防误判）', () => {
    no('https://www.douyin.com/user/abc');
});

/* ---------------- B站 ---------------- */

test('B站：space.bilibili.com/<mid> 识别', () => {
    const t = ok('https://space.bilibili.com/12345678');
    assert.equal(t.platform, 'bilibili');
    assert.equal(t.ownerId, '12345678');
    assert.equal(t.ownerKind, 'mid');
});

test('B站：space 子页（/video）仍属同一 UP 主', () => {
    const t = ok('https://space.bilibili.com/12345678/video');
    assert.equal(t.ownerId, '12345678');
});

test('B站：普通稿件页不是博主页', () => {
    no('https://www.bilibili.com/video/BV1xx411c7mD');
});

test('B站：番剧页识别为 bangumi（不是博主页，也不是普通稿件）', () => {
    /* 2026-11-18（D10）语义变更：番剧页原来被判为「不是博主页」返回 null，
     * 那时它没有枚举路径。现在有了合法路径（pgc/view/web/season），
     * 所以应识别为 targetKind='bangumi' —— 但仍**不是** owner。
     * 把这条从 no() 改成「认出且不是 owner」，避免下次有人误把它改回 null。 */
    const t = T.detectOwnerTarget('https://www.bilibili.com/bangumi/play/ep123456');
    assert.ok(t, '番剧页应识别出目标');
    assert.equal(t.targetKind, 'bangumi');
    assert.notEqual(t.targetKind, 'owner');
    assert.equal(t.epId, '123456');
});

test('B站：space 根没有 mid 时不认', () => {
    no('https://space.bilibili.com/');
});

/* ---------------- 小红书 ---------------- */

test('小红书：/user/profile/<user_id> 识别', () => {
    const t = ok('https://www.xiaohongshu.com/user/profile/5f1a2b3c4d5e6f7a8b9c0d1e');
    assert.equal(t.platform, 'xiaohongshu');
    assert.equal(t.ownerId, '5f1a2b3c4d5e6f7a8b9c0d1e');
    assert.equal(t.ownerKind, 'user_id');
});

test('小红书：笔记详情页不是博主页', () => {
    no('https://www.xiaohongshu.com/explore/66aabbccddeeff0011223344');
});

test('小红书：短链（xhslink.com）不认（无博主信息）', () => {
    no('https://xhslink.com/a/abc123');
});

/* ---------------- 微博 ---------------- */

test('微博：/u/<uid> 识别', () => {
    const t = ok('https://weibo.com/u/1234567890');
    assert.equal(t.platform, 'weibo');
    assert.equal(t.ownerId, '1234567890');
    assert.equal(t.ownerKind, 'uid');
});

test('微博：裸 uid 路径识别', () => {
    const t = ok('https://weibo.com/1234567890');
    assert.equal(t.ownerId, '1234567890');
});

test('微博：详情页（/detail/<id>）不是博主', () => {
    no('https://weibo.com/detail/4900000000000000');
});

test('微博：uid 太短不认', () => {
    no('https://weibo.com/u/123');
});

/* ---------------- YouTube ---------------- */

test('YouTube：/@handle 识别', () => {
    const t = ok('https://www.youtube.com/@veritasium');
    assert.equal(t.platform, 'youtube');
    assert.equal(t.ownerId, '@veritasium');
    assert.equal(t.ownerKind, 'handle');
});

test('YouTube：/channel/<UC…> 识别', () => {
    const t = ok('https://www.youtube.com/channel/UCUZHFZ9jIKrLroW8LcU3kTQ');
    assert.equal(t.ownerKind, 'channel_id');
});

test('YouTube：/c/<name> 识别', () => {
    const t = ok('https://www.youtube.com/c/SomeChannel');
    assert.equal(t.ownerKind, 'c_name');
});

test('YouTube：watch 页不是博主页', () => {
    no('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
});

test('YouTube：/results 搜索页不是博主', () => {
    no('https://www.youtube.com/results?search_query=test');
});

/* ---------------- 通用边界 ---------------- */

test('空 / 非法 URL 一律返回 null', () => {
    [null, undefined, '', '   ', 'not-a-url', 'ftp://x.com/a', 'file:///D:/a.mp4'].forEach((u) => {
        assert.equal(T.detectOwnerTarget(u), null, `应拒绝：${u}`);
    });
});

test('非目标平台返回 null', () => {
    ['https://example.com/user/123', 'https://instagram.com/foo',
     'https://tiktok.com/@foo', 'https://douban.com/people/123/'].forEach(no);
});

/* ---------------- 同目标判定 / 任务键 ---------------- */

test('sameTarget：同平台同 ID 为真', () => {
    const a = ok('https://x.com/elonmusk');
    const b = ok('https://x.com/elonmusk/media');
    assert.equal(T.sameTarget(a, b), true);
});

test('sameTarget：不同 ID / 不同平台为假', () => {
    const a = ok('https://x.com/elonmusk');
    const b = ok('https://x.com/jack');
    const c = ok('https://space.bilibili.com/12345678');
    assert.equal(T.sameTarget(a, b), false);
    assert.equal(T.sameTarget(a, c), false);
    assert.equal(T.sameTarget(a, null), false);
});

test('targetKey：帖子页与媒体页共用同一任务键', () => {
    const a = ok('https://x.com/elonmusk');
    const b = ok('https://x.com/elonmusk/media');
    assert.equal(T.targetKey(a), T.targetKey(b));
    assert.equal(T.targetKey(a), 'x:elonmusk');
    assert.equal(T.targetKey(null), '');
});