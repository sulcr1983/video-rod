#!/usr/bin/env node
/**
 * Range 分段下载 —— 分段边界计算单测
 *
 * 被测逻辑与 js/offscreen-fetch.js 的 rangeFetch() 保持一致：
 * 把总字节数切成 N 段，首尾相接、无缝隙、无重叠、不越界。
 *
 * 背景：分段下载是为解决「大文件单次 fetch 占满内存 + 失败要重来」。
 * 参考 Chrono 下载管理器 v0.13.12 的 max_threads_config: 5（取其思路）。
 *
 * 用法：node tools/test-range-split.js
 */
'use strict';

const THREADS = 4;
const MIN_CHUNK = 1024 * 1024;

let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, detail) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; fails.push(name); console.log('FAIL  ' + name + (detail ? '  ' + detail : '')); }
}
function eq(name, got, expect) {
    const a = JSON.stringify(got), b = JSON.stringify(expect);
    ok(name, a === b, 'got=' + a + ' vs ' + b);
}

/** 与 offscreen-fetch.js 同款的边界计算 */
function split(total, threads) {
    if (!(total > 0)) { return []; }
    const n = Math.min(threads, Math.ceil(total / MIN_CHUNK));
    if (n < 2) { return [[0, total - 1]]; }
    const size = Math.ceil(total / n);
    const out = [];
    for (let i = 0; i < n; i++) {
        const start = i * size;
        const end = Math.min(start + size - 1, total - 1);
        if (start > end) { continue; }
        out.push([start, end]);
    }
    return out;
}

/** 段是否完整覆盖且无重叠 */
function coversExactly(segs, total) {
    if (!segs.length) { return false; }
    if (segs[0][0] !== 0) { return false; }
    if (segs[segs.length - 1][1] !== total - 1) { return false; }
    for (let i = 1; i < segs.length; i++) {
        if (segs[i][0] !== segs[i - 1][1] + 1) { return false; }
    }
    return true;
}

/* ---------- A. 覆盖完整性 ---------- */
{
    const cases = [1048576, 1048577, 5000000, 10000000, 123456789, 7777777];
    for (const t of cases) {
        const segs = split(t, THREADS);
        ok('A 完整覆盖 ' + t, coversExactly(segs, t), JSON.stringify(segs));
    }
}

/* ---------- B. 线程数 ---------- */
eq('B1 1MB 最多 1 段（未超过分片阈值）', split(1048576, THREADS).length, 1);
eq('B1b 刚好超 1MB 分 2 段', split(1048577, THREADS).length, 2);
eq('B2 4MB 分 4 段', split(4 * 1048576, THREADS).length, 4);
eq('B3 10MB 分 4 段', split(10 * 1048576, THREADS).length, 4);
eq('B4 500KB 不分段', split(500000, THREADS).length, 1);
eq('B5 0 字节不分段', split(0, THREADS).length, 0);
eq('B6 负数安全', split(-1, THREADS).length, 0);

/* ---------- C. 边界值 ---------- */
{
    const segs = split(1048577, THREADS);
    ok('C1 不整除时最后一段收尾', segs[segs.length - 1][1] === 1048577 - 1);
    ok('C2 首段从 0 开始', segs[0][0] === 0);
}
{
    const segs = split(3 * 1048576, THREADS);
    ok('C3 3MB 分 3 段且覆盖', coversExactly(segs, 3 * 1048576), JSON.stringify(segs));
}

/* ---------- D. 单段情形 ---------- */
{
    const segs = split(800000, THREADS);
    eq('D1 小文件单段', segs, [[0, 799999]]);
    ok('D2 单段也算完整覆盖', coversExactly(segs, 800000));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
    console.log('失败用例：' + fails.join(', '));
    process.exit(1);
}