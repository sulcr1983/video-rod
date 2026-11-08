#!/usr/bin/env node
/**
 * YouTube 下载串行队列单测
 *
 * 需求（苏哥 2026-11-08）：YouTube 不允许同时下载，要排队。
 * 关键语义：同一时间只有一个 active；重复不重复入队；结束才放行；
 *          启动失败不能把队列卡死。
 *
 * 用法：node tools/test-yt-queue.js
 */
'use strict';

const Q = require('../js/yt/yt-queue.js');

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

/* ---------- A. 基本语义：一次只跑一个 ---------- */
{
    const started = [];
    const q = Q.create({ startFn: (j) => started.push(j.videoId), delayMs: 0 });

    const r1 = q.push({ videoId: 'aaaaaaaaaaa' });
    eq('A1 第一个直接启动', r1.reason, 'started');
    eq('A2 started 标志', r1.started, true);
    eq('A3 只有一个在跑', started, ['aaaaaaaaaaa']);

    const r2 = q.push({ videoId: 'bbbbbbbbbbb' });
    eq('A4 第二个进队列', r2.reason, 'queued');
    eq('A5 排队位置为 1', r2.position, 1);
    eq('A6 第二个还没启动', started, ['aaaaaaaaaaa']);
    eq('A7 队列长度', q.status().queued, 1);
    eq('A8 active 是第一个', q.status().active, 'aaaaaaaaaaa');
}

/* ---------- B. 释放后自动启动下一个 ---------- */
{
    const started = [];
    const q = Q.create({ startFn: (j) => started.push(j.videoId), delayMs: 0 });

    q.push({ videoId: 'a'.repeat(11) });
    q.push({ videoId: 'b'.repeat(11) });
    q.push({ videoId: 'c'.repeat(11) });
    eq('B1 只有 a 在跑', started, ['a'.repeat(11)]);

    q.release();
    eq('B2 释放后 b 启动', started, ['a'.repeat(11), 'b'.repeat(11)]);
    eq('B3 队列剩 1', q.status().queued, 1);

    q.release();
    eq('B4 再释放 c 启动', started.length, 3);
    eq('B5 队列空', q.status().queued, 0);
    eq('B6 active 为 c', q.status().active, 'c'.repeat(11));
}

/* ---------- C. 去重 ---------- */
{
    const started = [];
    const q = Q.create({ startFn: (j) => started.push(j.videoId), delayMs: 0 });

    q.push({ videoId: 'dupdupdupdu' });
    const same = q.push({ videoId: 'dupdupdupdu' });
    eq('C1 正在跑的重复入队被拒', same.reason, 'already-downloading');
    eq('C2 不重复启动', started.length, 1);

    q.push({ videoId: 'othervideo1' });
    const dup2 = q.push({ videoId: 'othervideo1' });
    eq('C3 队列中的重复被拒', dup2.reason, 'already-queued');
    eq('C4 队列长度仍为 1', q.status().queued, 1);
}

/* ---------- D. 无 videoId ---------- */
{
    const q = Q.create({ startFn: () => {}, delayMs: 0 });
    const r = q.push({});
    eq('D1 空 id 拒绝', r.ok, false);
    eq('D2 原因', r.reason, 'no-video-id');
    eq('D3 不入队', q.status().queued, 0);
    eq('D4 不启动', q.status().active, '');
}

/* ---------- E. 启动失败不能卡死队列 ---------- */
{
    let calls = 0;
    const q = Q.create({
        startFn: () => { calls++; if (calls === 1) { throw new Error('boom'); } },
        delayMs: 0
    });
    /* 第一个抛错 → 应当自动继续下一个 */
    q.push({ videoId: 'failfailfai' });
    q.push({ videoId: 'okokokokoko' });
    ok('E1 启动抛错后继续下一个', calls >= 2, 'calls=' + calls);
    ok('E2 队列没卡死', q.status().active !== '', JSON.stringify(q.status()));
}

/* ---------- F. 空队列释放 ---------- */
{
    const q = Q.create({ startFn: () => {}, delayMs: 0 });
    eq('F1 空队列 release 返回 false', q.release(), false);
    eq('F2 空队列 pump 不启动', q.pump().started, false);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
    console.log('失败用例：' + fails.join(', '));
    process.exit(1);
}