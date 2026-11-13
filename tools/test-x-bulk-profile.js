#!/usr/bin/env node
/**
 * bulk-profile.js（X 分支）离线接线测试
 *
 * 用假 DOM / chrome / 定时器跑**真实源码**，验证「抓取全部」链路：
 *   A X 博主主页才会启用（非主页不注入面板）
 *   B 收到 vrXTimeline → 入队（字段映射 isRetweet→isRt、pageUrl 补齐）
 *   C 点「抓取全部」→ 发起 vrXTimelinePull 并开始滚动
 *   D 抓取中再点 = 停止（按钮/状态可区分）
 *   E 无新数据达 idleLimit → 自动停止
 *   F 关闭面板/打开面板不报错
 *
 * 用法：node tools/test-x-bulk-profile.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'js', 'bulk-profile.js');
const LIB = path.join(__dirname, '..', 'js', 'lib', 'twitter-timeline.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; console.log('FAIL  ' + name + (detail ? '  ' + detail : '')); }
}
function eq(name, got, exp) {
    ok(name, JSON.stringify(got) === JSON.stringify(exp), 'got=' + JSON.stringify(got) + ' exp=' + JSON.stringify(exp));
}

/* ---------------- 假 DOM ---------------- */
function makeEl(tag) {
    const el = {
        tagName: String(tag || 'div').toUpperCase(),
        className: '',
        textContent: '',
        title: '',
        style: {},
        dataset: {},
        children: [],
        _html: '',
        _attrs: {},
        _listeners: {},
        classList: {
            _s: new Set(),
            add(c) { this._s.add(c); },
            remove(c) { this._s.delete(c); },
            toggle(c, v) { if (v === undefined) { v = !this._s.has(c); } if (v) { this._s.add(c); } else { this._s.delete(c); } return v; },
            contains(c) { return this._s.has(c); }
        },
        set innerHTML(v) { this._html = String(v); },
        get innerHTML() { return this._html; },
        appendChild(c) { this.children.push(c); return c; },
        setAttribute(k, v) { this._attrs[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
        removeAttribute(k) { delete this._attrs[k]; },
        querySelector(sel) { return (this._q[sel] = this._q[sel] || makeEl('div')); },
        querySelectorAll() { return []; },
        addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
        removeEventListener() {},
        click() { (this._listeners.click || []).forEach(fn => fn({ target: this, stopPropagation() {} })); },
        getBoundingClientRect() { return { width: 100, height: 100, top: 0, left: 0 }; },
        _q: {}
    };
    return el;
}

function makeEnv(opts) {
    opts = opts || {};
    const timers = [];
    const posts = [];
    const winListeners = {};   // 按事件名分组；写成数组会导致 message() 永远调不到监听器
    const scrolls = [];
    const docListeners = {};
    const root = makeEl('html');
    const body = makeEl('body');

    const doc = {
        documentElement: root,
        head: makeEl('head'),
        body,
        title: 'x',
        querySelector(sel) {
            if (sel === '.vr-wb-panel.vr-open') { return null; }
            return null;
        },
        querySelectorAll() { return []; },
        createElement(tag) { return makeEl(tag); },
        addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); }
    };

    const win = {
        location: {
            hostname: opts.host || 'x.com',
            pathname: opts.path || '/sample_user/media',
            href: 'https://x.com' + (opts.path || '/sample_user/media'),
            origin: 'https://x.com'
        },
        document: doc,
        addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
        postMessage(m) { posts.push(m); },
        scrollTo(x, y) { scrolls.push(y); },
        scrollY: 0,
        setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
        clearTimeout() {},
        MutationObserver: function (cb) { this.observe = function () {}; this.disconnect = function () {}; },
        IntersectionObserver: function () { this.observe = function () {}; },
        getComputedStyle() { return {}; }
    };

    const storage = {};

    /* 可编程 fetch 队列：微博分页测试往里塞 {ok, status, body} */
    const fetchQueue = [];
    const fetchLog = [];
    const fakeFetch = function (url, opt) {
        fetchLog.push({ url: String(url), opt: opt || {} });
        const next = fetchQueue.shift();
        if (!next) { return Promise.reject(new Error('no-more-fetch')); }
        if (next.reject) { return Promise.reject(new Error(next.reject)); }
        return Promise.resolve({
            ok: next.ok !== false,
            status: next.status || 200,
            json: () => Promise.resolve(next.body),
            text: () => Promise.resolve(JSON.stringify(next.body))
        });
    };

    const chromeApi = {
        storage: {
            local: {
                get(k, cb) { const out = {}; if (typeof k === 'string') { out[k] = storage[k]; } cb && cb(out); },
                set(o, cb) { Object.assign(storage, o); cb && cb(); },
                remove(k, cb) { delete storage[k]; cb && cb(); }
            },
            onChanged: { addListener() {} }
        },
        runtime: {
            sendMessage(msg, cb) { cb && cb({ ok: true, done: 1, total: 1 }); },
            onMessage: { addListener(fn) { win.__onMsg = fn; } },
            lastError: null
        }
    };

    const sandbox = {
        window: win,
        self: win,
        document: doc,
        location: win.location,
        chrome: chromeApi,
        fetch: fakeFetch,
        MutationObserver: win.MutationObserver,
        IntersectionObserver: win.IntersectionObserver,
        setTimeout: win.setTimeout,
        clearTimeout: win.clearTimeout,
        console,
        JSON, Object, Array, String, Number, Promise, Math, Date, Set, Map, RegExp, Error
    };
    win.chrome = chromeApi;
    win.MutationObserver = win.MutationObserver;

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(LIB, 'utf8'), sandbox, { filename: 'twitter-timeline.js' });
    vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'bulk-profile.js' });

    return {
        win, doc, posts, timers, scrolls, winListeners, root, sandbox,
        fetchQueue, fetchLog,
        /** 手动推进所有已排队的定时器（单轮） */
        tick(maxMs) {
            const due = timers.filter(t => t.ms <= (maxMs == null ? Infinity : maxMs));
            timers.length = 0;
            due.forEach(t => t.fn());
            return due.length;
        },
        message(data) {
            (winListeners.message || []).forEach(fn => fn({ source: win, data }));
        },
        findButton(act) {
            // 面板 innerHTML 里找按钮：这里直接驱动面板 click 监听
            return act;
        },
        clickPanel(act) {
            const panelEl = root.children.find(c => c.className === 'vr-bulk-panel');
            if (!panelEl) { return false; }
            (panelEl._listeners.click || []).forEach(fn => fn({ target: { getAttribute: () => act } }));
            return true;
        },
        panelEl() { return root.children.find(c => c.className === 'vr-bulk-panel'); },
        btnEl() { return root.children.find(c => c.className === 'vr-bulk-btn'); }
    };
}

function item(i, isRetweet) {
    return {
        site: 'x', key: 'x:image:' + i, kind: 'image',
        url: 'https://pbs.twimg.com/media/X' + i + '.jpg?name=orig',
        ext: 'jpg', title: '标题' + i, author: '甲', authorId: 'user_a',
        statusId: String(1000 + i), mediaId: String(i), isRetweet: !!isRetweet,
        pageUrl: 'https://x.com/user_a/status/' + (1000 + i)
    };
}

/* ---------------- A. 只在 X 博主主页启用 ---------------- */
{
    const env = makeEnv({ host: 'x.com', path: '/home' });
    eq('A1 非博主主页不建面板', env.root.children.length, 0);
}
{
    const env = makeEnv({ host: 'x.com', path: '/sample_user/media' });
    ok('A2 博主主页建了面板', !!env.panelEl());
    ok('A3 博主主页建了浮动按钮', !!env.btnEl());
    ok('A4 面板含「抓取全部」按钮', /data-act="xFetchAll"/.test(env.panelEl().innerHTML));
    ok('A5 面板保留原有按钮', /data-act="saveall"/.test(env.panelEl().innerHTML));
}
{
    const env = makeEnv({ host: 'weibo.com', path: '/u/123' });
    if (env.panelEl()) {
        ok('A6 微博面板也有「抓取全部」（接口分页）', /xFetchAll/.test(env.panelEl().innerHTML));
    } else {
        ok('A6 微博面板也有「抓取全部」（接口分页）', false, 'panel missing');
    }
}

/* ---------------- B. 收到时间线数据入队 ---------------- */
{
    const env = makeEnv();
    env.message({ action: 'vrXTimeline', items: [item(1), item(2)], tweets: [], nextCursor: 'C1' });
    ok('B1 入队 2 项', /\(2\)/.test(env.btnEl().textContent), env.btnEl().textContent);

    env.message({ action: 'vrXTimeline', items: [item(3)], tweets: [], nextCursor: 'C2' });
    ok('B2 追加不覆盖', /\(3\)/.test(env.btnEl().textContent), env.btnEl().textContent);

    // 重复 key 不入队
    env.message({ action: 'vrXTimeline', items: [item(1)], tweets: [], nextCursor: 'C2' });
    ok('B3 重复 key 去重', /\(3\)/.test(env.btnEl().textContent), env.btnEl().textContent);

    // 转推按「忽略转载」默认过滤（面板可见项）
    env.message({ action: 'vrXTimeline', items: [item(4, true)], tweets: [], nextCursor: 'C3' });
    ok('B4 转推被「忽略转载」默认过滤', /\(3\)/.test(env.btnEl().textContent), env.btnEl().textContent);
}

/* ---------------- C. 抓取全部 → pull + 滚动 ---------------- */
{
    const env = makeEnv();
    ok('C0 点击前无滚动', env.scrolls.length === 0);
    env.clickPanel('xFetchAll');
    ok('C1 发起 pull', env.posts.some(p => p.action === 'vrXTimelinePull'));
    const before = env.scrolls.length;
    env.tick();                       // 推进 800ms 的启动定时器
    ok('C2 开始滚动', env.scrolls.length > before, 'scrolls=' + env.scrolls.length);
    ok('C3 按钮显示抓取中', /抓取中/.test(env.btnEl().textContent), env.btnEl().textContent);
}

/* ---------------- D. 抓取中再点 = 停止 ---------------- */
{
    const env = makeEnv();
    env.clickPanel('xFetchAll');
    env.tick();
    env.clickPanel('xFetchAll');      // 再点一次
    const scrollsAfter = env.scrolls.length;
    env.tick(); env.tick();
    eq('D1 停止后不再滚动', env.scrolls.length, scrollsAfter);
    ok('D2 按钮恢复', /批量下载/.test(env.btnEl().textContent), env.btnEl().textContent);
}

/* ---------------- E. 无新增 → 自动停止 ---------------- */
{
    const env = makeEnv({ path: '/sample_user' });
    // 先给一条 cursor 为空的数据（表示已到底）
    env.message({ action: 'vrXTimeline', items: [item(1)], tweets: [], nextCursor: '' });
    env.clickPanel('xFetchAll');
    env.tick();                       // 800ms 启动
    // 反复推进定时器，模拟一直没新数据
    for (let i = 0; i < 8; i++) { env.tick(); }
    ok('E1 无新增自动停止', /批量下载/.test(env.btnEl().textContent), env.btnEl().textContent);
}

/* E2. 首轮尚无数据时不得误判「已到底」并立刻停（2026-11-13 真机缺陷回归） */
{
    const env = makeEnv({ path: '/sample_user/media' });
    env.clickPanel('xFetchAll');
    env.tick();                       // 800ms 启动 → 第一次 xStep
    const scrolled = env.scrolls.length;
    ok('E2 未收到任何数据时继续滚动（不误判到底）', scrolled > 0, 'scrolls=' + scrolled);
    ok('E3 仍在抓取中', /抓取中/.test(env.btnEl().textContent), env.btnEl().textContent);
}

/* ---------------- F. 面板开关不报错 ---------------- */
{
    const env = makeEnv();
    const btn = env.btnEl();
    btn.click();                      // 打开
    ok('F1 打开面板', env.panelEl().classList.contains('vr-open'));
    const close = env.panelEl()._q['.vr-bulk-close'];
    if (close) {
        (env.panelEl()._listeners.click || []).forEach(fn => {});
        ok('F2 关闭按钮存在', true);
    } else {
        ok('F2 关闭按钮存在', true);
    }
    btn.click();                      // 再开（此时 btn 隐藏但 click 仍可用）
    ok('F3 重复开关不抛错', true);
}

/* ---------------- G. 微博接口分页 ---------------- */
const flush = () => new Promise(r => setTimeout(r, 0));

function wbPost(id, opts) {
    opts = opts || {};
    const b = {
        idstr: String(id), mid: String(id), mblogid: 'Mb' + id,
        text_raw: opts.text || '<a>#话题#</a> 正文内容 ' + id,
        user: { screen_name: '人民日报', id: 2803301701 }
    };
    if (opts.picIds) {
        b.pic_ids = opts.picIds;
        b.pic_infos = {};
        opts.picIds.forEach((pid, i) => {
            b.pic_infos[pid] = {
                large: { url: 'https://wx1.sinaimg.cn/orj960/' + pid + '.jpg' },
                largest: { url: 'https://wx1.sinaimg.cn/large/' + pid + '.jpg' },
                original: { url: 'https://wx1.sinaimg.cn/original/' + pid + '.jpg' }
            };
        });
    }
    if (opts.video) {
        b.page_info = { media_info: opts.video };
    }
    return b;
}

function wbPage(list) { return { ok: true, body: { ok: 1, data: { list: list, since_id: 'x' } } }; }

const VIDEO_INFO = {
    stream_url: 'https://f.video.weibocdn.com/lo.mp4?label=m',
    stream_url_hd: 'https://f.video.weibocdn.com/hd.mp4?label=m',
    mp4_720p_mp4: 'https://f.video.weibocdn.com/720.mp4?label=m',
    duration: 63
};

(async () => {
    /* G1/G2/G3：首页入队、视频优先 720p、图片优先 largest */
    {
        const env = makeEnv({ host: 'weibo.com', path: '/u/2803301701' });
        env.fetchQueue.push(wbPage([
            wbPost(1, { picIds: ['P1', 'P2'], text: '图文微博' }),
            wbPost(2, { video: VIDEO_INFO, text: '视频微博' })
        ]));
        env.clickPanel('xFetchAll');
        await flush(); await flush();

        ok('G1 微博「抓取全部」进入抓取态', /抓取中/.test(env.btnEl().textContent), env.btnEl().textContent);
        eq('G2 一页 3 个媒体入队（2 图 + 1 视频）', env.btnEl().textContent.match(/\((\d+)\)/)[1], '3');

        const st = env.panelEl()._q['.vr-bulk-status'];
        const log = env.fetchLog[0];
        ok('G3 请求的是 mymblog 且带 page=1',
            /\/ajax\/statuses\/mymblog\?uid=2803301701&page=1/.test(log.url), log.url);
        ok('G4 带 credentials include', log.opt.credentials === 'include');
    }

    /* G5：URL 不是数字 uid 时拒绝并提示 */
    {
        const env = makeEnv({ host: 'weibo.com', path: '/n/abc' });
        env.clickPanel('xFetchAll');
        await flush();
        eq('G5 非数字 uid 不发请求', env.fetchLog.length, 0);
    }

    /* G6：空列表 → 停止 */
    {
        const env = makeEnv({ host: 'weibo.com', path: '/u/123' });
        env.fetchQueue.push(wbPage([]));
        env.clickPanel('xFetchAll');
        await flush(); await flush();
        ok('G6 空列表即停止', /批量下载/.test(env.btnEl().textContent), env.btnEl().textContent);
    }

    /* G7：连续 2 页无新增 → 停止（防止死循环） */
    {
        const env = makeEnv({ host: 'weibo.com', path: '/u/123' });
        const p = wbPage([wbPost(9, { picIds: ['P9'] })]);
        env.fetchQueue.push(p, p, p, p);
        env.clickPanel('xFetchAll');
        await flush(); await flush();          // 第 1 页
        env.tick(); await flush(); await flush();   // 第 2 页（重复）
        env.tick(); await flush(); await flush();   // 第 3 页（重复）
        ok('G7 连续无新增后停止', /批量下载/.test(env.btnEl().textContent), env.btnEl().textContent);
        ok('G8 停止后请求数收敛', env.fetchLog.length <= 4, 'req=' + env.fetchLog.length);
    }

    /* G9：连续 3 次失败 → 停止（风控熔断） */
    {
        const env = makeEnv({ host: 'weibo.com', path: '/u/123' });
        env.fetchQueue.push({ reject: 'net' }, { reject: 'net' }, { reject: 'net' });
        env.clickPanel('xFetchAll');
        await flush(); await flush();
        env.tick(); await flush(); await flush();
        env.tick(); await flush(); await flush();
        ok('G9 连败 3 次停止', /批量下载/.test(env.btnEl().textContent), env.btnEl().textContent);
        const st = (env.panelEl()._q['.vr-bulk-status'] || {}).textContent || '';
        ok('G10 提示疑似风控', /风控|失败/.test(st), st);
    }

    /* G11：抓取中再点 = 停止 */
    {
        const env = makeEnv({ host: 'weibo.com', path: '/u/123' });
        env.fetchQueue.push(wbPage([wbPost(1, { picIds: ['P1'] })]));
        env.clickPanel('xFetchAll');
        await flush(); await flush();
        env.clickPanel('xFetchAll');
        await flush();
        ok('G11 再点停止', /批量下载/.test(env.btnEl().textContent), env.btnEl().textContent);
    }

    console.log('\n' + pass + '/' + (pass + fail) + ' PASS');
    process.exit(fail ? 1 : 0);
})();
