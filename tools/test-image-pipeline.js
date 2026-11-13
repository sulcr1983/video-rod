#!/usr/bin/env node
/**
 * 图片管线 v2 纯逻辑单测（候选判头 / 候选去重 / 批量回执 / 灰度开关）。
 * 只 require js/image-pipeline-core.js，不碰 chrome.* 与 DOM。
 */
'use strict';
const assert = require('assert');
const C = require('../js/image-pipeline-core.js');
let pass = 0, fail = 0;
function ok(name, got, expect) {
    try {
        assert.deepStrictEqual(got, expect);
        pass++; console.log('PASS  ' + name);
    } catch (e) {
        fail++; console.log('FAIL  ' + name + '  got=' + JSON.stringify(got) + ' expect=' + JSON.stringify(expect));
    }
}
function okTrue(name, cond) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; console.log('FAIL  ' + name); }
}

ok('A1 JPEG 文件头', C.sniffImageHead([0xFF, 0xD8, 0xFF, 0xE0], ''), 'jpg');
ok('A2 PNG 文件头', C.sniffImageHead([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], ''), 'png');
ok('A3 WebP 文件头', C.sniffImageHead(
    [0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], ''), 'webp');
ok('A4 空文件不被 content-type 骗过', C.sniffImageHead([], 'image/jpeg'), '');
ok('A5 content-type 只用于扩展名，不单独判图片', C.sniffImageHead([0, 0, 0, 0], 'image/webp'), 'webp');

ok('B1 候选保序去重', C.dedupeCandidates([
    'https://a/1.jpg', 'https://a/1.jpg', 'https://a/2.jpg'
], 'https://a/2.jpg', 8), ['https://a/1.jpg', 'https://a/2.jpg']);
ok('B2 非图片协议过滤', C.dedupeCandidates([
    'javascript:alert(1)', 'data:image/svg+xml;base64,AA', 'https://a/1.jpg'
], '', 8), ['https://a/1.jpg']);
ok('B3 候选最多 8 条', C.dedupeCandidates(
    Array.from({ length: 12 }, (_, i) => `https://a/${i}.jpg`), '', 8).length, 8);
ok('B4 fallback 追加到末尾', C.dedupeCandidates(['https://a/1.jpg'], 'https://a/2.jpg', 8),
    ['https://a/1.jpg', 'https://a/2.jpg']);

ok('C1 成功回执', C.normalizeBatchResult({ ok: true, succeeded: 3, fail: 0, skipped: 1 }, 4), {
    ok: true, succeeded: 3, fail: 0, skipped: 1, failures: [], paths: [], canceled: false, needGrant: false
});
ok('C2 有失败就不算成功', C.normalizeBatchResult({ ok: true, succeeded: 2, fail: 1 }, 3).ok, false);
ok('C3 FSA_PERM 硬失败补齐 fail', (() => {
    const r = C.normalizeBatchResult({ ok: false, code: 'IMG_E_FSA_PERM', needGrant: true, succeeded: 0 }, 5);
    return [r.ok, r.fail, r.failures[0].code, r.needGrant];
})(), [false, 5, 'IMG_E_FSA_PERM', true]);
ok('C4 失败详情保留', C.normalizeBatchResult({
    ok: true, succeeded: 1, fail: 1, failures: [{ url: 'https://a/1.jpg', code: 'IMG_E_HTTP' }]
}, 2).failures.length, 1);

ok('D1 任一设置 false 即关', C.boolSettings({ x: true }, { x: false }, 'x', true), false);
ok('D2 显式 true 打开', C.boolSettings({ x: true }, {}, 'x', false), true);
ok('D3 未设置走默认', C.boolSettings({}, {}, 'x', true), true);

console.log(`${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
