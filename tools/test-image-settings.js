#!/usr/bin/env node
/**
 * 图片设置项纯逻辑单测（I5）
 *
 * 测 parseIntRange / validateSetting / mergeSettings / DEFAULT_SETTINGS / RANGES，
 * 不碰 DOM、不碰 chrome API。
 *
 * 用法：node tools/test-image-settings.js
 */
'use strict';

const U = require('../js/lib-image-util.js');

let pass = 0, fail = 0;
const fails = [];

function ok(name, got, expect) {
    const a = JSON.stringify(got), b = JSON.stringify(expect);
    if (a === b) { pass++; console.log('PASS  ' + name); }
    else { fail++; fails.push(name); console.log('FAIL  ' + name + '  got=' + a + '  expect=' + b); }
}

/* ---------- A. DEFAULT_SETTINGS ---------- */
const D = U.DEFAULT_SETTINGS;
// 注意排序：imgHotkeys 在 imgHover 之前（大写 H 的码位小于小写 o）
ok('A1 键齐全', Object.keys(D).sort(), [
    'imgBatch', 'imgBatchLimit', 'imgBgScan', 'imgConcurrency', 'imgHotkeys', 'imgHover',
    'imgHoverDelay', 'imgHoverMinSize', 'imgMinSize', 'imgPanel', 'imgPreferOriginal'
]);
// 悬停门槛可配：默认 600，与面板的 imgMinSize(100) 是两个独立口径
ok('A1b 悬停门槛默认 600', D.imgHoverMinSize, 600);
ok('A1c 面板门槛默认 100（与悬停不同）', D.imgMinSize, 100);
// 浮标默认关（批量是低频操作，不该占常驻 UI，见 docs/RESEARCH-COMPETITOR-IMAGE.md）
ok('A2 布尔项默认值', [D.imgHover, D.imgBatch, D.imgPanel, D.imgPreferOriginal, D.imgHotkeys],
    [true, true, false, true, true]);
ok('A2b 右下浮标默认关闭', D.imgPanel, false);
ok('A3 数值缺省', [D.imgMinSize, D.imgConcurrency, D.imgBatchLimit, D.imgHoverDelay],
    [100, 3, 200, 300]);
ok('A4 类型正确', [
    typeof D.imgHover, typeof D.imgMinSize
], ['boolean', 'number']);

/* ---------- B. RANGES ---------- */
ok('B1 范围定义', U.RANGES, {
    imgMinSize: [16, 4096],
    imgConcurrency: [1, 8],
    imgBatchLimit: [1, 2000],
    imgHoverDelay: [0, 1500]
});
ok('B2 每个数值项都有范围', Object.keys(U.RANGES).sort(),
    ['imgBatchLimit', 'imgConcurrency', 'imgHoverDelay', 'imgMinSize']);

/* ---------- C. parseIntRange ---------- */
ok('C1 正常整数', U.parseIntRange('300', 0, 1000, 0), 300);
ok('C2 带空格', U.parseIntRange('  250 ', 0, 1000, 0), 250);
ok('C3 空串取 fallback', U.parseIntRange('', 0, 1000, 77), 77);
ok('C4 null 取 fallback', U.parseIntRange(null, 0, 1000, 77), 77);
ok('C5 非数字取 fallback', U.parseIntRange('abc', 0, 1000, 77), 77);
ok('C6 低于下限夹到下限', U.parseIntRange('5', 16, 4096, 100), 16);
ok('C7 高于上限夹到上限', U.parseIntRange('9999', 16, 4096, 100), 4096);
ok('C8 小数截断', U.parseIntRange('120.9', 0, 2000, 0), 120);
ok('C9 负数夹到下限', U.parseIntRange('-5', 0, 100, 50), 0);
ok('C10 0 在下限内', U.parseIntRange('0', 0, 1500, 300), 0);

/* ---------- D. validateSetting · 布尔项 ---------- */
ok('D1 布尔 true', U.validateSetting('imgHover', true), { ok: true, value: true, reason: '' });
ok('D2 布尔 false', U.validateSetting('imgHover', false), { ok: true, value: false, reason: '' });
ok('D3 布尔 truthy 归一', U.validateSetting('imgPanel', 1), { ok: true, value: true, reason: '' });
ok('D4 布尔 falsy 归一', U.validateSetting('imgPanel', 0), { ok: true, value: false, reason: '' });

/* ---------- E. validateSetting · 数值项 ---------- */
ok('E1 合法值', U.validateSetting('imgMinSize', '500'), { ok: true, value: 500, reason: '' });
ok('E2 空值报错', U.validateSetting('imgMinSize', ''), { ok: false, value: 100, reason: '不能为空' });
ok('E3 非数字报错', U.validateSetting('imgMinSize', 'abc'), { ok: false, value: 100, reason: '请输入整数' });
ok('E4 超上限报错', U.validateSetting('imgMinSize', '9999'), { ok: false, value: 100, reason: '范围 16–4096' });
ok('E5 低于下限报错', U.validateSetting('imgConcurrency', '0'), { ok: false, value: 3, reason: '范围 1–8' });
ok('E6 未知项', U.validateSetting('nope', '1'), { ok: false, value: null, reason: '未知设置项' });
ok('E7 小数不算整数', U.validateSetting('imgMinSize', '12.5'), { ok: false, value: 100, reason: '请输入整数' });
ok('E8 负数报错', U.validateSetting('imgHoverDelay', '-1'), { ok: false, value: 300, reason: '范围 0–1500' });
ok('E9 边界值 16 合法', U.validateSetting('imgMinSize', '16'), { ok: true, value: 16, reason: '' });
ok('E10 边界值 4096 合法', U.validateSetting('imgMinSize', '4096'), { ok: true, value: 4096, reason: '' });
ok('E11 并发上限 8 合法', U.validateSetting('imgConcurrency', '8'), { ok: true, value: 8, reason: '' });
ok('E12 延迟 0 合法', U.validateSetting('imgHoverDelay', '0'), { ok: true, value: 0, reason: '' });

/* ---------- F. mergeSettings ---------- */
ok('F1 空对象得全默认', U.mergeSettings({}), D);
ok('F2 null 得全默认', U.mergeSettings(null), D);
ok('F3 部分键覆盖', U.mergeSettings({ imgMinSize: 500 }).imgMinSize, 500);
ok('F4 未覆盖的键仍是默认', U.mergeSettings({ imgMinSize: 500 }).imgConcurrency, 3);
ok('F5 超范围被夹住', U.mergeSettings({ imgMinSize: 99999 }).imgMinSize, 4096);
ok('F6 低于范围被夹住', U.mergeSettings({ imgConcurrency: 0 }).imgConcurrency, 1);
ok('F7 非数字回默认', U.mergeSettings({ imgMinSize: 'abc' }).imgMinSize, 100);
ok('F8 布尔被强制', U.mergeSettings({ imgHover: 'yes' }).imgHover, true);
ok('F9 布尔 0 变 false', U.mergeSettings({ imgHover: 0 }).imgHover, false);
ok('F10 未知键保留', U.mergeSettings({ someOtherKey: 'keep' }).someOtherKey, 'keep');
ok('F11 未知键不影响已知键', U.mergeSettings({ someOtherKey: 1, imgPanel: false }).imgPanel, false);
ok('F12 不修改入参', (function () {
    const src = { imgMinSize: 800 };
    U.mergeSettings(src);
    return src.imgMinSize;
})(), 800);
ok('F13 返回对象键数不少于默认', Object.keys(U.mergeSettings({ x: 1 })).length >= 9, true);

/* ---------- G. 组合场景 ---------- */
ok('G1 面板改尺寸后并发不变', (function () {
    const m = U.mergeSettings({ imgMinSize: 1200, imgConcurrency: 5 });
    return [m.imgMinSize, m.imgConcurrency];
})(), [1200, 5]);
ok('G2 全部关掉功能开关', (function () {
    const m = U.mergeSettings({ imgHover: false, imgBatch: false, imgPanel: false });
    return [m.imgHover, m.imgBatch, m.imgPanel];
})(), [false, false, false]);

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) {
    console.log('失败项：' + fails.join('、'));
    process.exit(1);
}
