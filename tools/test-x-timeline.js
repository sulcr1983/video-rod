#!/usr/bin/env node
/**
 * 推特时间线解析与自动滚动判定单测
 *
 * 覆盖 VRTwitterTimeline（js/lib/twitter-timeline.js）：
 *   A 基本解析（置顶/排序/cursor/最高码率/图片提档）
 *   B 转推     C 引用     D 卡片媒体兜底    E 无媒体推文保留
 *   F 模块内推文（会话线程）  G 去重     H 非时间线响应
 *   I parseMediaItems 扁平化与类型过滤
 *   J scrollStep 终止条件（停止/上限/无新增/到底）
 *   K 图片地址提档两种形态
 *
 * 背景（ADR-084）：推特「博主全部下载」走「自动滚动 + 旁读 X 自身响应」，
 * 不抓 Authorization、不代发私有请求。解析必须在**同一条响应**里处理
 * 可见性包装、转推、引用、卡片四种媒体来源 —— 这些分支全部在这里钉死。
 *
 * 样本全部为手工构造的脱敏结构（字段名/嵌套层级照 X GraphQL 实响应，
 * 账号与推文 ID 均为虚构数字），不含任何真实用户数据。
 *
 * 用法：node tools/test-x-timeline.js
 */
'use strict';

const T = require('../js/lib/twitter-timeline.js');

let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, detail) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; fails.push(name); console.log('FAIL  ' + name + (detail ? '  ' + detail : '')); }
}
function eq(name, got, expect) {
    const a = JSON.stringify(got), b = JSON.stringify(expect);
    ok(name, a === b, 'got=' + a + ' expect=' + b);
}

/* ---------------- 脱敏样本构造器 ---------------- */

function tweet(id, o) {
    o = o || {};
    const t = {
        __typename: 'Tweet',
        rest_id: String(id),
        core: {
            user_results: {
                result: { legacy: { name: o.name || '作者甲', screen_name: o.handle || 'user_a' } }
            }
        },
        legacy: {
            full_text: o.text || '',
            created_at: o.created || 'Sat Nov 01 00:00:00 +0000 2025',
            user_id_str: String(o.uid || 900000001)
        }
    };
    if (o.media) { t.legacy.extended_entities = { media: o.media }; }
    if (o.rt) { t.legacy.retweeted_status_result = { result: o.rt }; }
    if (o.quote) { t.quoted_status_result = { result: o.quote }; }
    if (o.card) { t.card = o.card; }
    if (o.quoteFlag) { t.legacy.is_quote_status = true; }
    if (o.visibility) { return { __typename: 'TweetWithVisibilityResults', tweet: t }; }
    return t;
}

function entry(id, sortIndex, res) {
    return {
        sortIndex: String(sortIndex),
        content: {
            entryType: 'TimelineTimelineItem',
            itemType: 'TimelineTweet',
            itemContent: { tweet_results: { result: res } }
        }
    };
}

function payload(instructions) {
    /* 保留真实响应的外层嵌套：data.user.result.timeline_v2.timeline.instructions，
     * 解析器靠「递归找 instructions」，这里验证它确实能找到这一层。 */
    return { data: { user: { result: { timeline_v2: { timeline: { instructions } } } } } };
}

const PHOTO = {
    type: 'photo', id_str: '9001',
    media_url_https: 'https://pbs.twimg.com/media/PHOTO_A.jpg'
};
const VIDEO = {
    type: 'video', id_str: '9002',
    media_url_https: 'https://pbs.twimg.com/media/THUMB_A.jpg',
    video_info: {
        variants: [
            { content_type: 'video/mp4', bitrate: 100000, url: 'https://video.twimg.com/lo.mp4' },
            { content_type: 'video/mp4', bitrate: 900000, url: 'https://video.twimg.com/hi.mp4' },
            { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/pl.m3u8' }
        ]
    }
};
const GIF = {
    type: 'animated_gif', id_str: '9003',
    media_url_https: 'https://pbs.twimg.com/media/GIF_A.jpg',
    video_info: { variants: [{ content_type: 'video/mp4', bitrate: 0, url: 'https://video.twimg.com/gif.mp4' }] }
};

/* ---------------- A. 基本解析 ---------------- */
{
    const r = T.parseTimeline(payload([
        { type: 'TimelinePinEntry', entry: entry(111111, 10, tweet(111111, { media: [PHOTO], text: '置顶推文' })) },
        {
            type: 'TimelineAddEntries', entries: [
                entry(222222, 9, tweet(222222, {
                    media: [VIDEO], text: '视频推文 https://t.co/abc',
                    name: '作者乙', handle: 'user_b', visibility: true
                })),
                { content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'CURSOR_1' } }
            ]
        }
    ]));
    eq('A1 推文条数', r.tweets.length, 2);
    eq('A2 置顶排首位', r.tweets[0].statusId, '111111');
    eq('A3 置顶标记', r.tweets[0].isPinned, true);
    eq('A4 Bottom cursor', r.nextCursor, 'CURSOR_1');
    eq('A5 视频取最高码率 mp4（忽略 m3u8）', r.tweets[1].media[0].url, 'https://video.twimg.com/hi.mp4');
    eq('A6 t.co 尾巴截断', r.tweets[1].text, '视频推文');
    eq('A7 图片提档到 name=orig', r.tweets[0].media[0].url, 'https://pbs.twimg.com/media/PHOTO_A.jpg?name=orig');
    eq('A8 可见性包装解包后取到作者', r.tweets[1].author, '作者乙');
    eq('A9 扩展名', [r.tweets[0].media[0].ext, r.tweets[1].media[0].ext], ['jpg', 'mp4']);
    eq('A10 图片缩略图用 name=small', r.tweets[0].media[0].thumb, 'https://pbs.twimg.com/media/PHOTO_A.jpg?name=small');
}

/* 动图按视频处理（X 的 animated_gif 实际是 mp4） */
{
    const r = T.parseTimeline(payload([
        { type: 'TimelineAddEntries', entries: [entry(333333, 8, tweet(333333, { media: [GIF] }))] }
    ]));
    eq('A11 动图归为视频', r.tweets[0].media[0].kind, 'video');
    eq('A12 动图取 mp4', r.tweets[0].media[0].url, 'https://video.twimg.com/gif.mp4');
}

/* ---------------- B. 转推 ---------------- */
{
    const orig = tweet(444444, {
        media: [PHOTO], text: '原推正文', name: '原作者丙', handle: 'user_c', uid: 777777
    });
    const r = T.parseTimeline(payload([
        { type: 'TimelineAddEntries', entries: [entry(555555, 5, tweet(555555, { rt: orig, text: 'RT @user_c: 原推正文' }))] }
    ]));
    eq('B1 转推标记', r.tweets[0].isRetweet, true);
    eq('B2 作者取原推作者', r.tweets[0].author, '原作者丙');
    eq('B3 正文去掉 RT 前缀', r.tweets[0].text, '原推正文');
    eq('B4 转推带媒体', r.tweets[0].media.length, 1);
    eq('B5 记录被转推的 id', r.tweets[0].retweetOf, '444444');
}

/* ---------------- C. 引用 ---------------- */
{
    const quoted = tweet(666666, { media: [PHOTO], text: '被引用内容' });
    const r = T.parseTimeline(payload([
        { type: 'TimelineAddEntries', entries: [entry(777777, 4, tweet(777777, { quote: quoted, text: '引用它' }))] }
    ]));
    eq('C1 引用标记', r.tweets[0].isQuote, true);
    eq('C2 本体无媒体时回退引用媒体', r.tweets[0].media.length, 1);
}

/* 本体有媒体时不串到引用媒体 */
{
    const quoted = tweet(666667, { media: [VIDEO] });
    const r = T.parseTimeline(payload([
        { type: 'TimelineAddEntries', entries: [entry(777778, 4, tweet(777778, { quote: quoted, media: [PHOTO] }))] }
    ]));
    eq('C3 本体优先于引用', r.tweets[0].media.length, 1);
    eq('C4 且是本体那张图', r.tweets[0].media[0].kind, 'image');
}

/* ---------------- D. 卡片媒体兜底 ---------------- */
{
    const card = {
        legacy: {
            binding_values: [
                { value: { string_value: '这不是 JSON' } },
                { value: { string_value: JSON.stringify({ media_entities: { k1: PHOTO } }) } }
            ]
        }
    };
    const r = T.parseTimeline(payload([
        { type: 'TimelineAddEntries', entries: [entry(888888, 3, tweet(888888, { card: card, text: '卡片推文' }))] }
    ]));
    eq('D1 卡片 media_entities 兜底', r.tweets[0].media.length, 1);
    eq('D2 非 JSON 的 binding value 被跳过', r.tweets[0].media[0].kind, 'image');
}

/* ---------------- E. 无媒体推文 ---------------- */
{
    const r = T.parseTimeline(payload([
        { type: 'TimelineAddEntries', entries: [entry(999999, 2, tweet(999999, { text: '纯文字推文' }))] }
    ]));
    eq('E1 纯文字推文保留（计总数用）', r.tweets.length, 1);
    eq('E2 媒体为空', r.tweets[0].media.length, 0);
}

/* ---------------- F. 模块内推文（会话线程） ---------------- */
{
    const r = T.parseTimeline(payload([
        {
            type: 'TimelineAddToModule', moduleItems: [
                { item: { itemContent: { tweet_results: { result: tweet(121212, { media: [PHOTO], text: '线程内' }) } } } }
            ]
        }
    ]));
    eq('F1 TimelineAddToModule 内推文被收下', r.tweets.length, 1);

    const r2 = T.parseTimeline(payload([
        {
            type: 'TimelineAddEntries', entries: [{
                content: {
                    __typename: 'TimelineTimelineModule',
                    entryType: 'TimelineTimelineModule',
                    items: [
                        { item: { itemContent: { tweet_results: { result: tweet(131313, { media: [PHOTO] }) } } } },
                        { item: { itemContent: { tweet_results: { result: tweet(141414, { media: [VIDEO] }) } } } }
                    ]
                }
            }]
        }
    ]));
    eq('F2 TimelineTimelineModule 内两条都收下', r2.tweets.length, 2);
}

/* ---------------- G. 去重 ---------------- */
{
    const same = entry(151515, 1, tweet(151515, { text: '同一条' }));
    const r = T.parseTimeline(payload([{ type: 'TimelineAddEntries', entries: [same, same] }]));
    eq('G1 同 statusId 只保留一条', r.tweets.length, 1);
}

/* ---------------- M. 同一推文重复出现 → 合并补全（照抄 Plucker） ----------------
 * 场景（真实会发生）：X 分页里同一条推文出现两次，第一次只带 media_url_https
 * （封面），第二次才带 video_info.variants（真流）。
 * 我们原来 `if (seen[tid]) continue` 直接丢后到的 → 「有视频却只下到封面」。
 * Plucker 是建 Map(by id) 逐字段补全，这里把行为钉死。
 */
{
    /* 第一次：video 类型但**没有** variants（拿不到可播地址） */
    const noVariants = {
        type: 'video', id_str: 'M7001',
        media_url_https: 'https://pbs.twimg.com/media/THUMB_7.jpg'
    };
    const withVariants = {
        type: 'video', id_str: 'M7001',
        media_url_https: 'https://pbs.twimg.com/media/THUMB_7.jpg',
        video_info: {
            variants: [
                { content_type: 'video/mp4', bitrate: 200000, url: 'https://video.twimg.com/a.mp4' },
                { content_type: 'video/mp4', bitrate: 2000000, url: 'https://video.twimg.com/b.mp4' }
            ]
        }
    };
    const r = T.parseTimeline(payload([{
        type: 'TimelineAddEntries',
        entries: [
            entry(171717, 2, tweet(171717, { media: [noVariants], text: '一条视频' })),
            entry(171717, 2, tweet(171717, { media: [withVariants], text: '一条视频' }))
        ]
    }]));
    eq('M1 仍只有一条', r.tweets.length, 1);
    eq('M2 合并后拿到真视频流（不是封面）',
        r.tweets[0].media[0].url, 'https://video.twimg.com/b.mp4');
    eq('M3 合并后 kind 是 video', r.tweets[0].media[0].kind, 'video');
}
{
    /* 反向顺序：先有真流，后到的那份只有封面 —— 不能把已有真流冲掉 */
    const r = T.parseTimeline(payload([{
        type: 'TimelineAddEntries',
        entries: [
            entry(181818, 3, tweet(181818, {
                text: '先全后残',
                media: [{
                    type: 'video', id_str: 'M7002',
                    media_url_https: 'https://pbs.twimg.com/media/T8.jpg',
                    video_info: {
                        variants: [{ content_type: 'video/mp4', bitrate: 500000, url: 'https://video.twimg.com/keep.mp4' }]
                    }
                }]
            })),
            entry(181818, 3, tweet(181818, {
                text: '先全后残',
                media: [{ type: 'video', id_str: 'M7002', media_url_https: 'https://pbs.twimg.com/media/T8.jpg' }]
            }))
        ]
    }]));
    eq('M4 后到的残缺数据不覆盖已有真流',
        r.tweets[0].media[0].url, 'https://video.twimg.com/keep.mp4');
}
{
    /* 两次各带一张**不同**的图 → 合并后应有两张（不是只留第一张） */
    const r = T.parseTimeline(payload([{
        type: 'TimelineAddEntries',
        entries: [
            entry(191919, 4, tweet(191919, { text: '多图分批', media: [PHOTO] })),
            entry(191919, 4, tweet(191919, {
                text: '多图分批',
                media: [{ type: 'photo', id_str: '9009', media_url_https: 'https://pbs.twimg.com/media/P9.jpg' }]
            }))
        ]
    }]));
    eq('M5 分批出现的两张图合并后都在', r.tweets[0].media.length, 2);
    eq('M6 第一张保留', r.tweets[0].media[0].id, '9001');
    eq('M7 第二张也保留', r.tweets[0].media[1].id, '9009');
}
{
    /* 置顶/引用标记是「或」关系，合并后不能被后到的 false 冲掉 */
    const r = T.parseTimeline(payload([
        {
            type: 'TimelinePinEntry',
            entry: entry(202020, 5, tweet(202020, { text: '置顶' }))
        },
        {
            type: 'TimelineAddEntries',
            entries: [entry(202020, 5, tweet(202020, { text: '置顶' }))]
        }
    ]));
    eq('M8 合并后仍标记为置顶', r.tweets[0].isPinned, true);
}

/* ---------------- H. 非时间线响应 ---------------- */
{
    eq('H1 空对象不抛错', T.parseTimeline({}).tweets.length, 0);
    eq('H2 null 不抛错', T.parseTimeline(null).tweets.length, 0);
    eq('H3 字符串不抛错', T.parseTimeline('nope').tweets.length, 0);
    eq('H4 用户资料响应无推文', T.parseTimeline({ data: { user: { result: { __typename: 'User', rest_id: '1' } } } }).tweets.length, 0);
}

/* ---------------- I. parseMediaItems ---------------- */
{
    const r = T.parseMediaItems(payload([
        { type: 'TimelineAddEntries', entries: [entry(161616, 9, tweet(161616, { media: [PHOTO, PHOTO], text: '两张图', handle: 'user_d' }))] }
    ]));
    eq('I1 一张图一条下载项', r.items.length, 2);
    eq('I2 site=x', r.items[0].site, 'x');
    eq('I3 pageUrl 由作者+statusId 拼出', r.items[0].pageUrl, 'https://x.com/user_d/status/161616');
    eq('I4 key 形式', r.items[0].key, 'x:image:9001');

    const onlyVideo = T.parseMediaItems(payload([
        { type: 'TimelineAddEntries', entries: [entry(171717, 9, tweet(171717, { media: [PHOTO, VIDEO] }))] }
    ]), { kind: 'video' });
    eq('I5 kind=video 过滤', onlyVideo.items.length, 1);
    eq('I6 过滤后是视频', onlyVideo.items[0].kind, 'video');

    const onlyImage = T.parseMediaItems(payload([
        { type: 'TimelineAddEntries', entries: [entry(181818, 9, tweet(181818, { media: [PHOTO, VIDEO] }))] }
    ]), { kind: 'image' });
    eq('I7 kind=image 过滤', onlyImage.items.length, 1);
}

/* ---------------- J. scrollStep 终止条件 ---------------- */
{
    let s = { maxItems: 100, idleLimit: 3 };
    const acts = [];
    for (const c of [0, 1, 2, 3, 3, 3, 3]) {
        const o = T.scrollStep(s, { count: c, atBottom: false });
        s = o.state;
        acts.push(o.action + (o.reason ? ':' + o.reason : ''));
        if (o.action === 'stop') { break; }
    }
    eq('J1 连续 3 轮无新增即停', acts[acts.length - 1], 'stop:idle');
    eq('J2 有新增时前几轮都是 continue', acts.slice(0, 3), ['continue', 'continue', 'continue']);
}
{
    const o = T.scrollStep({ stopped: true, rounds: 1 }, { count: 9 });
    eq('J3 用户点停止', [o.action, o.reason], ['stop', 'stopped']);
}
{
    eq('J4 达到条目上限', T.scrollStep({ maxItems: 5, rounds: 0 }, { count: 5 }).reason, 'max-items');
}
{
    eq('J5 达到轮次上限', T.scrollStep({ maxRounds: 2, rounds: 1 }, { count: 1 }).reason, 'max-rounds');
}
{
    let o = T.scrollStep({ idleLimit: 5 }, { count: 0, atBottom: false });
    o = T.scrollStep(o.state, { count: 0, atBottom: true });
    eq('J6 到底且本轮无新增即停', o.reason, 'bottom');
}
{
    /* 首轮页面还没吐出数据时不计 idle —— 否则点开始就少一次容错额度 */
    const o = T.scrollStep({ idleLimit: 1 }, { count: 0, atBottom: false });
    eq('J7 首轮无数据不算 idle', [o.action, o.state.idleRounds], ['continue', 0]);
}

/* ---------------- K. 图片地址提档 ---------------- */
{
    const I = T._internal;
    eq('K1 带 format 参数时保留 format',
        I.upgradeImage('https://pbs.twimg.com/media/X?format=jpg&name=medium'),
        'https://pbs.twimg.com/media/X?format=jpg&name=orig');
    eq('K2 带后缀时不补 format',
        I.upgradeImage('https://pbs.twimg.com/media/X.jpg'),
        'https://pbs.twimg.com/media/X.jpg?name=orig');
    eq('K3 视频地址不处理', I.upgradeImage('https://video.twimg.com/x.mp4', true), 'https://video.twimg.com/x.mp4');
    eq('K4 png 保留 png', I.upgradeImage('https://pbs.twimg.com/media/X.png'), 'https://pbs.twimg.com/media/X.png?name=orig');
}

/* ---------------- L. 真机结构样本（脱敏回填） ---------------- */
/* 来源：2026-11-13 探针 x.com/NASA/media → UserVideoTimeline。
 * 钉死两个真实结构事实：
 *   ① instructions[0] 是 TimelineClearCache（只有 type，没有 entries）
 *   ② 媒体在 legacy.extended_entities.media[]，变体在 media.video_info.variants[]
 * 若哪天解析器改坏成「只看 instructions[0]」，这组会立刻红。 */
{
    let real = null;
    try {
        real = JSON.parse(require('fs').readFileSync(
            require('path').join(__dirname, '..', 'test-site', 'fixtures',
                'x-timeline-userVideoTimeline.json'), 'utf8'));
    } catch (e) {
        ok('L0 样本文件可读', false, String(e));
    }
    if (real) {
        const r = T.parseTimeline(real);
        eq('L1 跳过 ClearCache 找到 entries', r.tweets.length, 2);
        eq('L2 视频推文取到最高码率 3840×2160',
            r.tweets[0].media[0].url,
            'https://video.twimg.com/amplify_video/2222222222222222222/vid/avc1/3840x2160/FIXTURE.mp4');
        eq('L3 视频归为 video', r.tweets[0].media[0].kind, 'video');
        eq('L4 t.co 尾巴截断', r.tweets[0].text, '这条推文带一个视频');
        eq('L5 可见性包装的纯文字推文也保留', r.tweets[1].media.length, 0);
        eq('L6 Bottom cursor 取到', r.nextCursor, 'FIXTURE_CURSOR_NEXT');
    }
}

/* ---------------- N. 驼峰/蛇形双读（照抄 Plucker XBD） ----------------
 * 背景：X 的 GraphQL 响应在不同版本/端点下混用两种命名，实测 Plucker 每处都写
 * `a || b`（cursorType||cursor_type、moduleItems||module_items、
 * sortIndex||sort_index、entryType||__typename）。我们原来只认驼峰，
 * 一旦 X 换命名，解析会**静默返回空** —— 不报错、只是「什么都抓不到」。
 * 这里把两种命名的解析结果钉成一致。
 */
{
    /* 同一条响应，只切换字段命名风格 */
    function mk(naming) {
        const n = (camel, snake) => (naming === 'camel' ? camel : snake);
        const media = {
            id_str: 'M1',
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/media/N1.jpg'
        };
        return {
            data: {
                user: {
                    mediaTimeline: {
                        timeline: {
                            instructions: [{
                                type: 'TimelineAddEntries',
                                entries: [
                                    {
                                        content: {
                                            [n('entryType', '__typename')]: 'TimelineTimelineItem',
                                            itemContent: {
                                                tweet_results: {
                                                    result: {
                                                        __typename: 'Tweet',
                                                        rest_id: 'N9001',
                                                        legacy: {
                                                            full_text: '蛇形字段测试',
                                                            created_at: 'Wed Nov 18 10:00:00 +0000 2026',
                                                            extended_entities: { media: [media] }
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                        [n('sortIndex', 'sort_index')]: '100'
                                    },
                                    {
                                        content: {
                                            [n('entryType', '__typename')]: 'TimelineTimelineCursor',
                                            [n('cursorType', 'cursor_type')]: 'Bottom',
                                            value: 'CURSOR_BOTTOM'
                                        }
                                    }
                                ]
                            }]
                        }
                    }
                }
            }
        };
    }

    const camelR = T.parseTimeline(mk('camel'));
    const snakeR = T.parseTimeline(mk('snake'));

    eq('N1 蛇形 cursor_type 也能取到底部游标', snakeR.nextCursor, 'CURSOR_BOTTOM');
    eq('N2 驼峰与蛇形解析出同样条数',
        snakeR.tweets.length, camelR.tweets.length);
    eq('N3 驼峰与蛇形都解析出 1 条', snakeR.tweets.length, 1);
    eq('N4 驼峰与蛇形取到同一媒体 URL',
        (snakeR.tweets[0] && snakeR.tweets[0].media[0] && snakeR.tweets[0].media[0].url),
        (camelR.tweets[0] && camelR.tweets[0].media[0] && camelR.tweets[0].media[0].url));
}
{
    /* 模块内推文（会话线程）：Plucker 写 ins.moduleItems || ins.module_items */
    function mkModule(naming) {
        const key = naming === 'camel' ? 'moduleItems' : 'module_items';
        return {
            data: {
                instructions: [{
                    type: 'TimelineAddToModule',
                    [key]: [{
                        item: {
                            itemContent: {
                                tweet_results: {
                                    result: {
                                        __typename: 'Tweet',
                                        rest_id: 'N9002',
                                        legacy: {
                                            full_text: '模块内推文',
                                            created_at: 'Wed Nov 18 11:00:00 +0000 2026',
                                            extended_entities: {
                                                media: [{
                                                    id_str: 'M2',
                                                    type: 'photo',
                                                    media_url_https: 'https://pbs.twimg.com/media/N2.jpg'
                                                }]
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }]
                }]
            }
        };
    }
    eq('N5 驼峰 moduleItems 能解析模块内推文',
        T.parseTimeline(mkModule('camel')).tweets.length, 1);
    eq('N6 蛇形 module_items 同样能解析',
        T.parseTimeline(mkModule('snake')).tweets.length, 1);
}
{
    /* pick2 自身语义：驼峰为空串时要让位给蛇形（X 会用 '' 表示「没有」） */
    const I = T._internal;
    eq('N7 pick2 驼峰优先', I.pick2({ a: 1, b: 2 }, 'a', 'b'), 1);
    eq('N8 pick2 驼峰缺失回退蛇形', I.pick2({ a: undefined, b: 2 }, 'a', 'b'), 2);
    eq('N9 pick2 驼峰空串回退蛇形', I.pick2({ a: '', b: 2 }, 'a', 'b'), 2);
    eq('N10 pick2 都缺失返回 undefined', I.pick2({}, 'a', 'b'), undefined);
    eq('N11 pick2 非对象不抛错', I.pick2(null, 'a', 'b'), undefined);
}

console.log('\n' + pass + '/' + (pass + fail) + ' PASS');
if (fail) { console.log('失败项：' + fails.join('、')); }
process.exit(fail ? 1 : 0);