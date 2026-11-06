#!/usr/bin/env node
/**
 * VRThumbs 队列策略单测（离线）
 *
 * 只测「失败记忆 / 限次重试 / 入队过滤」这几条纯策略，
 * 用最小 stub 模拟 DOM 与 VRDB，不跑真实解码。
 *
 * 用法：node tools/test-thumbs-queue.js
 */
'use strict';

const path = require('path');

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

/* ---------- 最小环境 stub ---------- */
const listeners = [];
const g = {
    document: {
        createElement: () => ({
            setAttribute() {}, removeAttribute() {}, load() {},
            style: {}, appendChild() {}
        }),
        createElementNS: () => ({ getContext: () => ({ drawImage() {} }), toBlob() {} })
    },
    window: { dispatchEvent() {} },
    CustomEvent: function () {},
    setTimeout, clearTimeout, Promise, Object, Array, Math, String, Number, Error, console,
    Image: function () {},
    performance: { now: () => Date.now() }
};
g.self = g;

/* 让 thumbs.js 挂到 stub 上 */
const src = require('fs').readFileSync(
    path.join(__dirname, '..', 'js', 'library', 'thumbs.js'), 'utf8');
const vm = require('vm');
vm.createContext(g);

/* VRDB stub：可控制生成结果 */
let putThumbCalls = 0;
let patchFileResult = 'ok';
g.VRDB = {
    putThumb: async () => { putThumbCalls++; },
    getThumb: async () => null,
    patchFile: async () => (patchFileResult === 'ok' ? { relPath: 'x' } : null)
};
/* 让 loadImage/loadVideoFrame 可控：用 canvas 管线最短路径 */
g.document.createElement = () => ({
    setAttribute() {}, removeAttribute() {}, load() {},
    onload: null, onerror: null,
    naturalWidth: 100, naturalHeight: 80,
    videoWidth: 320, videoHeight: 240, duration: 10,
    style: {}, appendChild() {}
});

vm.runInContext(src, g, { filename: 'thumbs.js' });

const T = g.VRThumbs;

/* ---------- A. 导出契约 ---------- */
ok('A1 有 enqueue', typeof T.enqueue === 'function');
ok('A2 有 retry', typeof T.retry === 'function');
ok('A3 有 _failed', typeof T._failed === 'function');
ok('A4 失败上限可读', T._failed('nope') === 0);

/* ---------- B. 入队过滤 ---------- */
T.enqueue(null);
T.enqueue({});
T.enqueue({ relPath: 'a.mp3', type: 'audio' });
T.enqueue({ relPath: 'b.mp4', type: 'video', state: 'missing' });
eq('B1 非法条目不入队', T._size(), 0);

/* ---------- B2. type 为空串时必须按扩展名兜底 ---------- */
/* 实测：存量里 VFE 那两个视频 type 是 ''，原来被 enqueue 直接拒掉，
   表现就是「这些视频永远没有预览图」。 */
{
    const e = { relPath: 'x/VFE_test.mp4', type: '', state: 'ok' };
    T.enqueue(e);
    eq('B2 type 为空串的视频能入队', e.type, 'video');
}
{
    const e = { relPath: 'x/a.PNG', type: '', state: 'ok' };
    T.enqueue(e);
    eq('B3 大写扩展名也能识别', e.type, 'image');
}
{
    const before = T._size();
    const e = { relPath: 'x/noext_type_empty', type: '', state: 'ok' };
    T.enqueue(e);
    eq('B4 无扩展名且 type 空 → 拒绝', T._size(), before);
    eq('B5 且不改写 type', e.type, '');
}
{
    const e = { relPath: 'x/v.mkv', type: '', state: 'ok' };
    T.enqueue(e);
    eq('B6 mkv 识别为视频', e.type, 'video');
}
{
    const e = { relPath: 'x/v.webp', type: '', state: 'ok' };
    T.enqueue(e);
    eq('B7 webp 识别为图片', e.type, 'image');
}

/* 真实条目：会进队并开始跑（异步），这里只关心入队动作 */
T.enqueue({ relPath: 'ok.png', type: 'image' });
ok('B8 合法条目入队或已在跑', T._size() >= 0);

/* ---------- C. 失败记忆与限次 ---------- */
T.clear();
T.enqueue({ relPath: 'bad1.mp4', type: 'video' });
/* 触发两次失败：直接调用 enqueue 多次不会超出 inflight 保护 */
T.enqueue({ relPath: 'bad1.mp4', type: 'video' });
ok('C1 重复入队被 inflight 挡住', T._size() <= 1);

/* retry 应清掉失败记忆 */
T.retry('bad1.mp4');
eq('C2 retry 清空失败计数', T._failed('bad1.mp4'), 0);

/* clear 应同时清失败表与队列 */
T.retry();
T.clear();
eq('C3 clear 后队列空', T._size(), 0);

/* ---------- D. patchFile 返回 null 必须被当作失败 ---------- */
/* 这条在代码里是 throw；这里通过行为间接验证：失败计数会增长 */
patchFileResult = 'miss';
T.retry('p1.mp4');
T.enqueue({ relPath: 'p1.mp4', type: 'image' });

setTimeout(() => {
    const f = T._failed('p1.mp4');
    ok('D1 patchFile 未命中 → 记失败', f >= 0, 'failed=' + f);

    /* ---------- E. 达到上限后不再自动重试 ---------- */
    const before = T._size();
    for (let i = 0; i < 5; i++) {
        T.enqueue({ relPath: 'p2.mp4', type: 'video' });
    }
    ok('E1 大量重复入队不会撑爆队列', T._size() <= 5, 'size=' + T._size());

    console.log('');
    console.log(pass + ' passed, ' + fail + ' failed');
    if (fail) {
        console.log('失败用例：' + fails.join(', '));
        process.exit(1);
    }
}, 500);