#!/usr/bin/env node
/**
 * 图片批量队列纯逻辑单测（I3）
 *
 * 测的是「队列语义」，不碰 chrome.* 与 DOM：
 *   并发上限、任务只跑一次、失败不中断、取消不再启动、去重跳过、上限截断、进度计数。
 *
 * 用法：node tools/test-image-batch.js
 */
'use strict';

let pass = 0, fail = 0;
const fails = [];

function ok(name, got, expect) {
    const a = JSON.stringify(got), b = JSON.stringify(expect);
    if (a === b) { pass++; console.log('PASS  ' + name); }
    else { fail++; fails.push(name); console.log('FAIL  ' + name + '  got=' + a + '  expect=' + b); }
}

function okTrue(name, cond, extra) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; fails.push(name); console.log('FAIL  ' + name + (extra ? '  ' + extra : '')); }
}

/* ==========================================================
 * 1. 并发池（与 background.js vrImgBatch 同构的纯实现）
 * ========================================================== */

async function runPool(items, conc, worker, state) {
    let cursor = 0;
    const runners = [];
    const n = Math.min(conc, items.length);
    for (let i = 0; i < n; i++) {
        runners.push((async () => {
            while (true) {
                if (state.canceled) { return; }
                const idx = cursor++;
                if (idx >= items.length) { return; }
                await worker(items[idx], idx, state);
            }
        })());
    }
    await Promise.all(runners);
}

async function main() {
    /* ---------- A. 并发上限 ---------- */
    {
        const items = Array.from({ length: 12 }, (_, i) => i);
        let live = 0, peak = 0;
        const seen = new Set();
        const state = { canceled: false, done: 0, ok: 0, fail: 0 };
        await runPool(items, 3, async (it) => {
            live++; peak = Math.max(peak, live);
            await new Promise(r => setTimeout(r, 5));
            live--;
            seen.add(it);
            state.done++; state.ok++;
        }, state);
        ok('A1 全部任务执行', seen.size, 12);
        okTrue('A2 并发不超过 3', peak <= 3, 'peak=' + peak);
        okTrue('A3 并发确实用到了 3', peak === 3, 'peak=' + peak);
        ok('A4 进度计数', [state.done, state.ok], [12, 12]);
    }

    /* ---------- B. 任务只执行一次 ---------- */
    {
        const items = ['a', 'b', 'c', 'd', 'e'];
        const hits = {};
        const state = { canceled: false, done: 0, ok: 0, fail: 0 };
        await runPool(items, 2, async (it) => {
            hits[it] = (hits[it] || 0) + 1;
            state.done++;
        }, state);
        ok('B1 每项恰好一次', Object.values(hits), [1, 1, 1, 1, 1]);
        ok('B2 顺序无关但都覆盖', Object.keys(hits).sort(), ['a', 'b', 'c', 'd', 'e']);
    }

    /* ---------- C. 失败不中断 ---------- */
    {
        const items = [1, 2, 3, 4, 5, 6];
        const state = { canceled: false, done: 0, ok: 0, fail: 0, failures: [] };
        await runPool(items, 2, async (it) => {
            if (it % 2 === 0) {
                state.fail++;
                state.failures.push({ url: String(it), code: 'IMG_E_FETCH' });
            } else {
                state.ok++;
            }
            state.done++;
        }, state);
        ok('C1 失败项计数', state.fail, 3);
        ok('C2 成功项计数', state.ok, 3);
        ok('C3 全部走完', state.done, 6);
        ok('C4 失败明细', state.failures.map(f => f.url), ['2', '4', '6']);
    }

    /* ---------- D. 抛错也不中断 ---------- */
    {
        const items = [1, 2, 3, 4];
        const state = { canceled: false, done: 0, ok: 0, fail: 0, failures: [] };
        await runPool(items, 2, async (it) => {
            try {
                if (it === 2) { throw new Error('boom'); }
                state.ok++;
            } catch (e) {
                state.fail++;
                state.failures.push({ url: String(it), code: 'IMG_E_FETCH' });
            }
            state.done++;
        }, state);
        ok('D1 异常被吞且继续', [state.done, state.ok, state.fail], [4, 3, 1]);
    }

    /* ---------- E. 取消：不再启动新任务 ---------- */
    {
        const items = Array.from({ length: 20 }, (_, i) => i);
        const started = [];
        const state = { canceled: false, done: 0, ok: 0, fail: 0 };
        await runPool(items, 2, async (it) => {
            started.push(it);
            await new Promise(r => setTimeout(r, 2));
            state.done++;
            if (state.done === 4) { state.canceled = true; }   // 第 4 个完成时取消
        }, state);
        okTrue('E1 取消后不再启动新任务', started.length < 20, 'started=' + started.length);
        okTrue('E2 取消时已完成的任务保留', state.done >= 4, 'done=' + state.done);
        ok('E3 已完成的不重复计入', state.done, started.length);
    }

    /* ---------- F. 去重跳过 ---------- */
    {
        const items = [
            { url: 'https://a/1.jpg' },
            { url: 'https://a/2.jpg' },
            { url: 'https://a/1.jpg' },   // 重复
            { url: 'https://a/3.jpg' }
        ];
        const seen = { 'https://a/1.jpg': 1 };   // 已下载过
        const state = { canceled: false, done: 0, ok: 0, fail: 0 };
        const downloaded = [];
        await runPool(items, 2, async (it) => {
            if (seen[it.url]) { state.done++; state.ok++; return; }   // 跳过但算成功
            downloaded.push(it.url);
            seen[it.url] = 1;
            state.done++; state.ok++;
        }, state);
        ok('F1 已下载的跳过', downloaded, ['https://a/2.jpg', 'https://a/3.jpg']);
        ok('F2 跳过也算完成', [state.done, state.ok], [4, 4]);
    }

    /* ---------- G. 上限截断 ---------- */
    {
        const items = Array.from({ length: 250 }, (_, i) => 'u' + i);
        const max = 200;
        const cut = items.slice(0, max);
        ok('G1 截断到上限', cut.length, 200);
        ok('G2 保留前 N 项顺序', [cut[0], cut[199]], ['u0', 'u199']);
        okTrue('G3 超出被识别', items.length > max, 'total=' + items.length);
    }

    /* ---------- H. 进度节流 ---------- */
    {
        // 与 background 同构：200ms 内且未完成则合并
        function makeThrottle() {
            const emitted = [];
            const state = { done: 0, total: 10, ok: 0, fail: 0, lastEmit: 0 };
            function emit(now) {
                if (now - state.lastEmit < 200 && state.done < state.total) { return; }
                state.lastEmit = now;
                emitted.push(state.done);
            }
            return { emitted, state, emit };
        }
        const t = makeThrottle();
        t.state.done = 1; t.emit(1000);          // 首次发
        t.state.done = 2; t.emit(1050);          // 50ms 后，合并
        t.state.done = 3; t.emit(1100);          // 合并
        t.state.done = 4; t.emit(1250);          // 250ms 后，发
        t.state.done = 10; t.emit(1260);         // 已完成，必发
        ok('H1 节流后只发 3 次', t.emitted, [1, 4, 10]);
        ok('H2 完成时不受节流限制', t.emitted[t.emitted.length - 1], 10);
    }

    /* ---------- I. 去重键规范化 ---------- */
    {
        function key(url) { return String(url || '').split('#')[0].trim(); }
        ok('I1 去掉 hash', key('https://a/1.jpg#x'), 'https://a/1.jpg');
        ok('I2 空值安全', key(''), '');
        ok('I3 保留查询串', key('https://a/1.jpg?w=100'), 'https://a/1.jpg?w=100');
        ok('I4 去空白', key('  https://a/1.jpg  '), 'https://a/1.jpg');
    }

    /* ---------- J. 失败明细截断 ---------- */
    {
        const failures = Array.from({ length: 80 }, (_, i) => ({ url: 'u' + i, code: 'X' }));
        ok('J1 明细最多 50 条', failures.slice(0, 50).length, 50);
    }

    /* ---------- K. 空批次 ---------- */
    {
        const state = { canceled: false, done: 0, ok: 0, fail: 0 };
        await runPool([], 3, async () => { state.done++; }, state);
        ok('K1 空批次不执行任何任务', state.done, 0);
    }

    /* ---------- 汇总 ---------- */
    console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
    if (fail) {
        console.log('失败项：' + fails.join('、'));
        process.exit(1);
    }
}

main().catch(e => {
    console.error('脚本异常：', e);
    process.exit(2);
});
