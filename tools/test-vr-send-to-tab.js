/**
 * 标签页消息降级封装单测（审计 D5）
 *
 * 背景：
 *   内容脚本不在时 chrome.tabs.sendMessage 直接失败，用户侧表现是
 *   「按钮点了没反应」——没有任何提示，也不知道该刷新页面。
 *
 *   竞品做法是 getContexts 三级降级，但**实测 Edge 157 上
 *   chrome.runtime.getContexts({contextTypes:['TAB']}) 返回 0 个 context**，
 *   即使页面里内容脚本确实在跑 —— 拿它当判据会把「正常」误判成「没注入」。
 *   所以本实现改为：发 → 失败且属「无接收端」类 → 补注入 → 重发一次。
 *
 * 覆盖：
 *   ① 首次成功 → 不补注入
 *   ② 首次失败（无接收端）→ 补注入 → 重发成功 → recovered=true
 *   ③ 首次失败（其它原因，如 tab 已关）→ **不**补注入，直接返回
 *   ④ 补注入后仍失败 → 返回失败（不无限重试）
 *   ⑤ 无 tabId → 直接返回 no-tab
 *   ⑥ 补注入抛错（如 chrome:// 页面）→ 返回原失败
 *
 * 跑法：node tools/test-vr-send-to-tab.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'background.js'), 'utf8');

/** 从 background.js 里抠出 vrSendToTab 及其依赖的源码，单独求值 */
function loadVrSendToTab(mockChrome) {
    /* 2026-11-18：vrSendToTab 现在依赖 vrThawTab / vrExecWithThaw
     * （冻结页解冻：frozen 标签页上 executeScript 永不回调，实测 8019ms 不 settle）。
     * 沙箱必须把这两个一起带进来，否则 ReferenceError 会被内部 catch 吞掉，
     * 表现为「补注入没发生、只发了 1 次」——那是**沙箱缺依赖**，不是产品行为。
     * 三个函数在 background.js 里是连续的，按顺序截取。 */
    function grab(name, nextNames) {
        const start = SRC.indexOf('async function ' + name);
        assert.ok(start > 0, 'background.js 里应能找到 ' + name);
        const rest = SRC.slice(start);
        let end = rest.length;
        for (const nx of (nextNames || [])) {
            const at = rest.indexOf('async function ' + nx + '(');
            if (at > 0 && at < end) { end = at; }
        }
        /* 若后面没有更强的锚点，就退到「顶格 } 行」 */
        const topLevel = rest.indexOf('\n}\n');
        if (topLevel > 0 && topLevel + 3 < end) { end = topLevel + 3; }
        return rest.slice(0, end);
    }

    const thaw = grab('vrThawTab', ['vrExecWithThaw']);
    const execThaw = grab('vrExecWithThaw', ['vrSendToTab']);
    const body = grab('vrSendToTab', []);

    const sandbox = { chrome: mockChrome, console, setTimeout, Promise };
    /* eslint-disable no-new-func */
    const fn = new Function(
        'chrome', 'setTimeout', 'Promise', 'console',
        thaw + '\n' + execThaw + '\n' + 'return (' + body.trim() + ');'
    );
    return fn(mockChrome, setTimeout, Promise, console);
}

/**
 * @param {object} o
 *   o.sendResults  每次 sendMessage 的结果序列（按调用次序）
 *   o.injectThrows executeScript 是否抛错
 *   o.noScripting  不提供 chrome.scripting
 */
function makeChrome(o) {
    const opt = o || {};
    const calls = { send: 0, inject: 0 };
    let seq = 0;
    const results = opt.sendResults || [];

    const mock = {
        runtime: { lastError: null },
        tabs: {
            sendMessage(_id, _msg, cb) {
                calls.send++;
                const r = results[seq++] || { fail: 'Could not establish connection. Receiving end does not exist.' };
                setTimeout(() => {
                    if (r.fail) {
                        mock.runtime.lastError = { message: r.fail };
                        cb(undefined);
                    } else {
                        mock.runtime.lastError = null;
                        cb(r.res);
                    }
                }, 0);
            }
        },
        scripting: {
            async executeScript() {
                calls.inject++;
                if (opt.injectThrows) {
                    const e = new Error('Cannot access contents of the page');
                    throw e;
                }
                return [];
            }
        }
    };
    if (opt.noScripting) { delete mock.scripting; }
    return { mock, calls };
}

/* ---------------- ① 首次成功 ---------------- */

test('① 首次发送成功：直接返回，不补注入', async () => {
    const { mock, calls } = makeChrome({ sendResults: [{ res: { ok: true } }] });
    const fn = loadVrSendToTab(mock);
    const r = await fn(123, { Message: 'x' });
    assert.equal(r.ok, true);
    assert.equal(r.delivered, true);
    assert.equal(calls.send, 1);
    assert.equal(calls.inject, 0, '成功时不该补注入');
});

/* ---------------- ② 失败→补注入→重发成功 ---------------- */

test('② 无接收端 → 补注入 → 重发成功（recovered=true）', async () => {
    const { mock, calls } = makeChrome({
        sendResults: [
            { fail: 'Could not establish connection. Receiving end does not exist.' },
            { res: { ok: true } }
        ]
    });
    const fn = loadVrSendToTab(mock);
    const r = await fn(123, { Message: 'x' });
    assert.equal(r.ok, true);
    assert.equal(r.recovered, true, '应标记为「补注入后恢复」');
    assert.equal(calls.send, 2, '应发两次');
    assert.equal(calls.inject, 1, '应补注入一次');
});

test('②b 补注入只做一次，不无限重试', async () => {
    const { mock, calls } = makeChrome({
        sendResults: [
            { fail: 'Receiving end does not exist.' },
            { fail: 'Receiving end does not exist.' }
        ]
    });
    const fn = loadVrSendToTab(mock);
    const r = await fn(123, { Message: 'x' });
    assert.equal(r.ok, false);
    assert.equal(calls.send, 2, '最多发两次');
    assert.equal(calls.inject, 1, '最多补注入一次');
});

/* ---------------- ③ 非「无接收端」的失败不补注入 ---------------- */

test('③ 其它原因失败（如 tab 已关闭）：不补注入', async () => {
    const { mock, calls } = makeChrome({
        sendResults: [{ fail: 'The tab was closed.' }]
    });
    const fn = loadVrSendToTab(mock);
    const r = await fn(123, { Message: 'x' });
    assert.equal(r.ok, false);
    assert.equal(calls.inject, 0, '不该为「tab 已关」补注入');
    assert.equal(calls.send, 1);
});

/* ---------------- ④ 补注入抛错 ---------------- */

test('④ 补注入抛错（chrome:// 页面）：返回原失败，不崩', async () => {
    const { mock, calls } = makeChrome({
        sendResults: [{ fail: 'Could not establish connection. Receiving end does not exist.' }],
        injectThrows: true
    });
    const fn = loadVrSendToTab(mock);
    const r = await fn(123, { Message: 'x' });
    assert.equal(r.ok, false);
    assert.ok(r.reason, '应保留原因');
    assert.equal(calls.inject, 1);
});

test('④b 没有 scripting API：返回原失败', async () => {
    const { mock, calls } = makeChrome({
        sendResults: [{ fail: 'Could not establish connection. Receiving end does not exist.' }],
        noScripting: true
    });
    const fn = loadVrSendToTab(mock);
    const r = await fn(123, { Message: 'x' });
    assert.equal(r.ok, false);
    assert.equal(calls.inject, 0);
});

/* ---------------- ⑤ 无 tabId ---------------- */

test('⑤ tabId 非法：直接返回 no-tab，不发不注', async () => {
    const { mock, calls } = makeChrome({});
    const fn = loadVrSendToTab(mock);
    const r = await fn(0, { Message: 'x' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no-tab');
    assert.equal(calls.send, 0);
    assert.equal(calls.inject, 0);
});

/* ---------------- ⑥ noRetry 选项 ---------------- */

test('⑥ noRetry=true 时不补注入', async () => {
    const { mock, calls } = makeChrome({
        sendResults: [{ fail: 'Could not establish connection. Receiving end does not exist.' }]
    });
    const fn = loadVrSendToTab(mock);
    const r = await fn(123, { Message: 'x' }, { noRetry: true });
    assert.equal(r.ok, false);
    assert.equal(calls.inject, 0);
    assert.equal(calls.send, 1);
});

/* ---------------- ⑦ 接线核对 ---------------- */

test('⑦ 5 处指令下发已改走 vrSendToTab', () => {
    /* 这 5 条是「按钮点了没反应」类的指令下发；
     * 进度上报（vrVideoProgress 等）失败无所谓，不改。 */
    ['vrYtCancel', 'vrYtChoose', 'vrYtRequestOptions', 'vrYtOptions', 'vrImg.hotkey']
        .forEach((name) => {
            const i = SRC.indexOf("Message: '" + name + "'");
            assert.ok(i > 0, '应能找到 ' + name);
            /* 该消息所在的 sendMessage 调用前 300 字符内应出现 vrSendToTab */
            const before = SRC.slice(Math.max(0, i - 300), i);
            assert.ok(before.indexOf('vrSendToTab') > 0,
                name + ' 应改走 vrSendToTab');
        });
});

test('⑦b ffmpegConfig 相关两处未改动（ADR-015 禁改区延伸）', () => {
    /* G.ffmpegConfig 属于猫抓内核配置，不在本轮改动范围 */
    const f1 = SRC.indexOf('G.ffmpegConfig.cacheData.push(data);');
    const f2 = SRC.indexOf('chrome.tabs.sendMessage(details.tabId, data);');
    assert.ok(f1 > 0 && f2 > 0, '两处应仍存在');
});
