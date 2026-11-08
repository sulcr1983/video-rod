#!/usr/bin/env node
/**
 * 图片尺寸档位纯逻辑单测（I4）
 *
 * 测 VRImageUtil 里的 shortSide / parseTierMin / tierCounts /
 * filterByTier / filterByKeyword / sortItems，不碰 DOM。
 *
 * 用法：node tools/test-image-tier.js
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

function okTrue(name, cond, extra) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; fails.push(name); console.log('FAIL  ' + name + (extra ? '  ' + extra : '')); }
}

/* ---------- A. shortSide ---------- */
ok('A1 横图取高', U.shortSide(1200, 800), 800);
ok('A2 竖图取宽', U.shortSide(600, 2000), 600);
ok('A3 方图', U.shortSide(500, 500), 500);
ok('A4 宽为 0', U.shortSide(0, 800), 0);
ok('A5 高为 0', U.shortSide(800, 0), 0);
ok('A6 负数', U.shortSide(-10, 800), 0);
ok('A7 非数字', U.shortSide('abc', 800), 0);
ok('A8 字符串数字', U.shortSide('640', '480'), 480);
ok('A9 浮点', U.shortSide(100.9, 200.4), 100.9);

/* ---------- B. 档位阈值边界 ---------- */
const T = U.TIERS;
ok('B1 四档定义', T.map(t => t.min), [100, 500, 1200, 2000]);
ok('B2 档位 key 顺序', T.map(t => t.key), ['small', 'medium', 'large', 'huge']);

function tierOf(w, h) {
    const ss = U.shortSide(w, h);
    let key = '';
    for (const t of T) { if (ss >= t.min) { key = t.key; } }
    return key;
}
ok('B3 99 不算小', tierOf(99, 99), '');
ok('B4 100 算小', tierOf(100, 100), 'small');
ok('B5 499 只算小', tierOf(499, 499), 'small');
ok('B6 500 算中', tierOf(500, 500), 'medium');
ok('B7 1199 只算中', tierOf(1199, 1199), 'medium');
ok('B8 1200 算大', tierOf(1200, 1200), 'large');
ok('B9 1999 只算大', tierOf(1999, 1999), 'large');
ok('B10 2000 算超大', tierOf(2000, 2000), 'huge');

/* ---------- C. 竖图按短边判 ---------- */
ok('C1 600×2000 竖图算中', tierOf(600, 2000), 'medium');
ok('C2 2000×600 横图算中', tierOf(2000, 600), 'medium');
okTrue('C3 竖图不会误判成超大', tierOf(600, 3000) !== 'huge');

/* ---------- D. tierCounts ---------- */
const items = [
    { url: 'a', w: 640, h: 480 },      // ss 480 → 小
    { url: 'b', w: 1200, h: 800 },     // ss 800 → 中
    { url: 'c', w: 2000, h: 1500 },    // ss 1500 → 大
    { url: 'd', w: 3000, h: 2500 },    // ss 2500 → 超大
    { url: 'e', w: 80, h: 80 },        // ss 80 → 无档
    { url: 'f', w: 600, h: 2000 }      // ss 600 → 中
];
const c = U.tierCounts(items);
// items 共 6 项：短边 480/800/1500/2500/80/600
ok('D1 小 5 张（80px 那张不算）', c.small, 5);
ok('D2 中 4 张（800/1500/2500/600）', c.medium, 4);
ok('D3 大 2 张（1500/2500）', c.large, 2);
ok('D4 超大 1 张（2500）', c.huge, 1);
// total 是「扫描到的全部张数」（含 80px 这种不达任何档的），
// 各档位才是「达到该阈值的张数」——两者语义不同，别混
ok('D5 total 含 80px 共 6 张', c.total, 6);
ok('D6 空数组', U.tierCounts([]), { small: 0, medium: 0, large: 0, huge: 0, unknown: 0, total: 0 });
ok('D7 null 安全', U.tierCounts(null), { small: 0, medium: 0, large: 0, huge: 0, unknown: 0, total: 0 });
// 2026-11-08 审计 M-3 语义修正：懒加载未解码（w/h=0）以前被 continue 掉，
// 小红书首页 70 张会让四档全显示 0（面板看起来「一张都没有」，只能全下没得选）。
const unknownItems = items.concat([{ url: 'u1', w: 0, h: 0 }, { url: 'u2', w: 0 }]);
const cu = U.tierCounts(unknownItems);
ok('D8 尺寸未知计入 unknown', cu.unknown, 2);
ok('D9 尺寸未知计入 total（8 张）', cu.total, 8);
ok('D10 尺寸未知不冒充任何档', [cu.small, cu.medium, cu.large, cu.huge], [5, 4, 2, 1]);

/* ---------- E. filterByTier ---------- */
ok('E1 下限 0 返回全部', U.filterByTier(items, 0).length, 6);
ok('E2 下限 500 过滤', U.filterByTier(items, 500).map(x => x.url), ['b', 'c', 'd', 'f']);
ok('E3 下限 1200', U.filterByTier(items, 1200).map(x => x.url), ['c', 'd']);
ok('E4 下限 2000', U.filterByTier(items, 2000).map(x => x.url), ['d']);
ok('E5 下限 9999 空', U.filterByTier(items, 9999).length, 0);
ok('E6 负数当 0', U.filterByTier(items, -5).length, 6);

/* ---------- F. parseTierMin ---------- */
ok('F1 正常整数', U.parseTierMin('800'), 800);
ok('F2 带空格', U.parseTierMin('  640  '), 640);
ok('F3 空串', U.parseTierMin(''), 0);
ok('F4 0', U.parseTierMin('0'), 0);
ok('F5 负数', U.parseTierMin('-100'), 0);
ok('F6 非数字', U.parseTierMin('abc'), 0);
ok('F7 null', U.parseTierMin(null), 0);
ok('F8 小数截断', U.parseTierMin('1200.9'), 1200);
ok('F9 带单位不认', U.parseTierMin('800px'), 800);   // parseInt 会取到 800

/* ---------- G. filterByKeyword ---------- */
const kws = [
    { url: 'https://a.com/Cover.JPG' },
    { url: 'https://a.com/thumb.png' },
    { url: 'https://b.com/photo-1.jpg' }
];
ok('G1 空关键词返回全部', U.filterByKeyword(kws, '').length, 3);
ok('G2 大小写不敏感', U.filterByKeyword(kws, 'cover').map(x => x.url), ['https://a.com/Cover.JPG']);
ok('G3 子串匹配', U.filterByKeyword(kws, 'photo').length, 1);
ok('G4 无命中', U.filterByKeyword(kws, 'zzz').length, 0);
ok('G5 null 安全', U.filterByKeyword(null, 'x').length, 0);

/* ---------- H. sortItems ---------- */
const ss = [
    { url: 'x', w: 400, h: 300 },     // ss 300
    { url: 'y', w: 1600, h: 900 },    // ss 900
    { url: 'z', w: 800, h: 800 },     // ss 800
    { url: 'w', w: 900, h: 1600 }     // ss 900（长边 1600）
];
ok('H1 page 顺序不变', U.sortItems(ss, 'page').map(i => i.url), ['x', 'y', 'z', 'w']);
ok('H2 尺寸降序', U.sortItems(ss, 'size-desc').map(i => i.url), ['y', 'w', 'z', 'x']);
// 升序：短边 300 → 800 → 900(y) → 900(w)；同短边时长边小的在前
ok('H3 尺寸升序', U.sortItems(ss, 'size-asc').map(i => i.url), ['x', 'z', 'y', 'w']);
ok('H4 不改原数组', ss.map(i => i.url), ['x', 'y', 'z', 'w']);
ok('H5 相同短边按长边降序', U.sortItems(ss, 'size-desc').slice(0, 2).map(i => i.url), ['y', 'w']);

/* ---------- I. 组合：档位 + 关键词 ---------- */
{
    const combo = U.filterByKeyword(U.filterByTier(items, 500), 'c');
    ok('I1 档位与关键词取交集', combo.map(x => x.url), ['c']);
}

/* ---------- J. 空输入 ---------- */
ok('J1 sortItems(null)', U.sortItems(null, 'size-desc').length, 0);
ok('J2 filterByTier(null)', U.filterByTier(null, 500).length, 0);

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) {
    console.log('失败项：' + fails.join('、'));
    process.exit(1);
}
