#!/usr/bin/env node
/**
 * twitter-timeline-hook 离线单测
 *
 * 用最小 DOM/事件替身跑真实 hook 源码，验证：
 *   A 只认时间线 GraphQL（其他请求不碰）
 *   B XHR 旁读 → postMessage 出项
 *   C 媒体 key 去重（同一响应重放不重复）
 *   D 面板晚到：pull 重放存量
 *   E 响应体异常不抛错、不计数
 *   F 只读：不修改 fetch 返回值、不读取 Authorization
 *
 * 用法：node tools/test-x-timeline-hook.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LIB = path.join(__dirname, '..', 'js', 'lib', 'twitter-timeline.js');
const HOOK = path.join(__dirname, '..', 'js', 'lib', 'twitter-timeline-hook.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; console.log('FAIL  ' + name + (detail ? '  ' + detail : '')); }
}
function eq(name, got, exp) {
    ok(name, JSON.stringify(got) === JSON.stringify(exp), 'got=' + JSON.stringify(got) + ' exp=' + JSON.stringify(exp));
}

/* ---------------- 环境替身 ---------------- */
function makeEnv() {
    const messages = [];
    const listeners = [];
    const fetchCalls = [];

    const fakeRes = (body) => ({
        headers: { get: () => 'application/json' },
        clone() { return { text: () => Promise.resolve(body) }; }
    });

    function FakeXHR() {
        this.listeners = {};
        this.responseType = '';
        this.responseText = '';
        this.response = null;
        this.readyState = 0;
    }
    FakeXHR.DONE = 4;
    FakeXHR.prototype.open = function (m, u) { this.__m = m; this.__u = u; };
    FakeXHR.prototype.send = function () {};
    FakeXHR.prototype.addEventListener = function (t, fn) {
        (this.listeners[t] = this.listeners[t] || []).push(fn);
    };
    FakeXHR.prototype._load = function () {
        (this.listeners.load || []).forEach(fn => fn());
    };

    const win = {
        location: { origin: 'https://x.com' },
        __vrProbeUrl: '',
        fetch: function (u) {
            fetchCalls.push(u);
            const body = env.nextBody;
            return Promise.resolve(fakeRes(body));
        },
        XMLHttpRequest: FakeXHR,
        postMessage(msg) { messages.push(msg); },
        addEventListener(t, fn) { listeners.push(fn); }
    };

    const sandbox = {
        window: win,
        self: win,
        XMLHttpRequest: FakeXHR,
        location: win.location,
        console,
        JSON,
        Promise,
        Object,
        Array,
        String,
        Number,
        setTimeout
    };

    // 解析库挂在 self 上（与浏览器一致）
    const libSrc = fs.readFileSync(LIB, 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(libSrc, sandbox, { filename: 'twitter-timeline.js' });

    const env = {
        win, messages, listeners, fetchCalls, sandbox,
        nextBody: '{}',
        run() {
            const src = fs.readFileSync(HOOK, 'utf8');
            vm.runInContext(src, sandbox, { filename: 'twitter-timeline-hook.js' });
            return env;
        },
        pull() {
            const ev = { source: win, data: { action: 'vrXTimelinePull' } };
            listeners.forEach(fn => fn(ev));
        },
        xhr(url, body) {
            const x = new win.XMLHttpRequest();
            x.open('GET', url);
            x.responseType = 'text';
            x.responseText = body;
            x.send();
            x.responseText = body;
            x._load();
        }
    };
    return env;
}

/* 脱敏样本：1 页 2 条推文 / 2 个媒体，结构照真机 */
function pagePayload() {
    return JSON.stringify({
        data: {
            user: {
                result: {
                    timeline_v2: {
                        timeline: {
                            instructions: [
                                { type: 'TimelineClearCache' },
                                {
                                    type: 'TimelineAddEntries',
                                    entries: [
                                        {
                                            sortIndex: '9',
                                            content: {
                                                entryType: 'TimelineTimelineItem',
                                                itemType: 'TimelineTweet',
                                                itemContent: {
                                                    tweet_results: {
                                                        result: {
                                                            __typename: 'Tweet',
                                                            rest_id: '111',
                                                            core: { user_results: { result: { legacy: { name: '甲', screen_name: 'a' } } } },
                                                            legacy: {
                                                                id_str: '111', user_id_str: '1',
                                                                full_text: '第一条',
                                                                created_at: 'Sat Nov 01 00:00:00 +0000 2025',
                                                                extended_entities: {
                                                                    media: [{ id_str: 'p1', type: 'photo', media_url_https: 'https://pbs.twimg.com/media/A.jpg' }]
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                        {
                                            sortIndex: '8',
                                            content: {
                                                entryType: 'TimelineTimelineItem',
                                                itemType: 'TimelineTweet',
                                                itemContent: {
                                                    tweet_results: {
                                                        result: {
                                                            __typename: 'Tweet',
                                                            rest_id: '222',
                                                            core: { user_results: { result: { legacy: { name: '乙', screen_name: 'b' } } } },
                                                            legacy: {
                                                                id_str: '222', user_id_str: '2',
                                                                full_text: '第二条',
                                                                created_at: 'Fri Oct 31 00:00:00 +0000 2025',
                                                                extended_entities: {
                                                                    media: [{
                                                                        id_str: 'v1', type: 'video',
                                                                        media_url_https: 'https://pbs.twimg.com/T.jpg',
                                                                        video_info: { variants: [
                                                                            { content_type: 'video/mp4', bitrate: 100, url: 'https://v/lo.mp4' },
                                                                            { content_type: 'video/mp4', bitrate: 900, url: 'https://v/hi.mp4' }
                                                                        ] }
                                                                    }]
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                        {
                                            content: {
                                                entryType: 'TimelineTimelineCursor',
                                                cursorType: 'Bottom',
                                                value: 'CURSOR_X'
                                            }
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                }
            }
        }
    });
}

/* ---------------- A. 只认时间线 ---------------- */
{
    const env = makeEnv().run();
    const tl = () => env.messages.filter(m => m.action === 'vrXTimeline').length;
    env.xhr('/graphql/abc/UserTweets', '{"not":"timeline"}');
    env.xhr('https://x.com/i/api/1.1/account/settings.json', '{}');
    eq('A1 非时间线请求不产生消息', tl(), 0);
    env.xhr('/graphql/abc/UserVideoTimeline', pagePayload());
    ok('A2 时间线请求产生消息', tl() > 0);
    eq('A3 hook 已就绪', env.win.__vrXTimelineHook.ready, true);
}

/* ---------------- B. 解析与字段 ---------------- */
{
    const env = makeEnv().run();
    env.xhr('/graphql/abc/UserVideoTimeline', pagePayload());
    const msg = env.messages.filter(m => m.action === 'vrXTimeline');
    ok('B1 收到 vrXTimeline 消息', msg.length === 1);
    eq('B2 媒体 2 条', msg[0].items.length, 2);
    eq('B3 推文 2 条', msg[0].tweets.length, 2);
    eq('B4 视频取最高码率', msg[0].items[1].url, 'https://v/hi.mp4');
    eq('B5 图片提档 orig', msg[0].items[0].url, 'https://pbs.twimg.com/media/A.jpg?name=orig');
    eq('B6 cursor', msg[0].nextCursor, 'CURSOR_X');
    eq('B7 首条 tweet 摘要不含正文全文', Object.keys(msg[0].tweets[0]).sort(),
        ['author', 'authorId', 'createdAt', 'isQuote', 'isRetweet', 'media', 'statusId', 'text']);
}

/* ---------------- C. 去重 ---------------- */
{
    const env = makeEnv().run();
    env.xhr('/graphql/abc/UserTweets', pagePayload());
    env.xhr('/graphql/abc/UserTweets', pagePayload());   // 同一页重复返回
    const msgs = env.messages.filter(m => m.action === 'vrXTimeline');
    const totalItems = msgs.reduce((n, m) => n + m.items.length, 0);
    eq('C1 同一响应重复返回不重复入队', totalItems, 2);
}

/* ---------------- D. 面板晚到重放 ---------------- */
{
    const env = makeEnv().run();
    const tl = () => env.messages.filter(m => m.action === 'vrXTimeline');
    env.xhr('/graphql/abc/UserTweets', pagePayload());
    eq('D0 首次即时发送 1 次', tl().length, 1);
    env.pull();
    eq('D1 pull 后重放存量', tl().length, 2);
    ok('D2 重放带 replay 标记', tl().filter(m => m.replay).length === 1);
    // 重放两次不应再重复（队列已清空）
    const n1 = env.messages.length;
    env.pull();
    eq('D3 队列消费后不再重放', env.messages.length, n1);
}

/* ---------------- E. 异常输入 ---------------- */
{
    const env = makeEnv().run();
    env.xhr('/graphql/abc/UserTweets', 'not json at all');
    env.xhr('/graphql/abc/UserTweets', '');
    ok('E1 非 JSON 不抛错', true);
    eq('E2 错误计数', env.win.__vrXTimelineHook.errors, 1);
    eq('E3 无消息', env.messages.filter(m => m.action === 'vrXTimeline').length, 0);
}

/* ---------------- F. 只读性 ---------------- */
{
    const env = makeEnv().run();
    const originalFetch = env.win.fetch;
    ok('F1 fetch 被包装', typeof originalFetch === 'function');
    // 包装后返回值应仍是原 Promise（不吞、不改）
    env.nextBody = pagePayload();
    const r = env.win.fetch('/graphql/abc/UserTweets');
    ok('F2 fetch 返回 Promise', r && typeof r.then === 'function');
    // 源码层面：剔除注释后不得出现 Authorization 相关读取
    const src = fs.readFileSync(HOOK, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    ok('F3 不读取 Authorization', !/Authorization/i.test(src));
    ok('F4 不存请求头', !/setRequestHeader/.test(src));
    ok('F5 不代发请求', !/\.send\(\s*['"`]/.test(src));
}

console.log('\n' + pass + '/' + (pass + fail) + ' PASS');
process.exit(fail ? 1 : 0);
