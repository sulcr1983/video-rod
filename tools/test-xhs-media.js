#!/usr/bin/env node
/**
 * 小红书媒体地址规则单测
 *
 * 覆盖 VRXhsMedia：原图推导 / 扩展名推断 / 候选链构造
 *
 * 来源：拆解「小红书下载助手」v1.0.2（edeaccoppfnefdnpdgmmamcgibbgkdpl）
 * 背景：我们此前保留 `!nd_dft_` 后缀拿压缩图，从未拿到 ci 域原图。
 *
 * 用法：node tools/test-xhs-media.js
 */
'use strict';

const X = require('../js/xhs-media.js');
const assert = require('assert');

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

/* ---------- A. 原图推导 ---------- */
eq('A1 notes_pre_post 段',
    X.originalUrl('https://sns-webpic-qc.xhscdn.com/202611071234/abc/notes_pre_post/1040g2t0xyz!nd_dft_wlteh_webp_3'),
    'https://ci.xiaohongshu.com/notes_pre_post/1040g2t0xyz');

eq('A2 spectrum 段',
    X.originalUrl('https://sns-img-qc.xhscdn.com/spectrum/1040g34o3205sjv8tk8605!nd_dft_wgth_webp_3'),
    'https://ci.xiaohongshu.com/spectrum/1040g34o3205sjv8tk8605');

eq('A3 纯素材 ID',
    X.originalUrl('https://sns-webpic-qc.xhscdn.com/202611071234/abc/1040g2t0abcdefghij123456'),
    'https://ci.xiaohongshu.com/1040g2t0abcdefghij123456');

eq('A4 http 升级到 https',
    X.originalUrl('http://sns-img-qc.xhscdn.com/spectrum/1040g34o3205sjv8tk8605'),
    'https://ci.xiaohongshu.com/spectrum/1040g34o3205sjv8tk8605');

eq('A5 非小红书地址不推导', X.originalUrl('https://example.com/a/b.jpg'), '');
eq('A6 空串', X.originalUrl(''), '');
eq('A7 段名不在白名单', X.originalUrl('https://x.com/other/1040g2t0abc'), '');

/* ---------- B. 扩展名推断 ---------- */
eq('B1 普通 jpg', X.imgExt('https://a.com/x.jpg'), 'jpg');
eq('B2 jpeg 归一为 jpg', X.imgExt('https://a.com/x.jpeg'), 'jpg');
eq('B3 webp 后缀', X.imgExt('https://a.com/x.webp'), 'webp');
eq('B4 带 ! 后缀的 webp', X.imgExt('https://a.com/x!nd_dft_wlteh_webp_3'), 'webp');
eq('B5 png', X.imgExt('https://a.com/x.png'), 'png');
eq('B6 无后缀默认 jpg', X.imgExt('https://a.com/x'), 'jpg');

/* ---------- C. 候选链构造 ---------- */
{
    const im = {
        infoList: [
            { imageScene: 'CRD_WM_WEBP', url: 'https://sns-img-qc.xhscdn.com/spectrum/1040g34oAAA!nd_dft_wgth_webp_3' },
            { imageScene: 'WB_DFT', url: 'https://sns-webpic-qc.xhscdn.com/2026/abc/notes_pre_post/1040g2t0XYZ!nd_dft_wlteh_webp_3' }
        ],
        urlDefault: 'https://sns-webpic-qc.xhscdn.com/2026/abc/notes_pre_post/1040g2t0XYZ!nd_dft_wlteh_webp_3'
    };
    const c = X.imageCandidate(im);
    /* 2026-11-07 实测修正：首选必须是「原有可用地址」，不能是未探测的 ci 原图。
     * ci 对部分素材 ID 返回 404，盲目首选会让每张图白跑一次失败。 */
    ok('C1 首选是原有可用地址（不是未探测的原图）',
        c.url.indexOf('https://sns-webpic-qc') === 0, c.url);
    eq('C2 原图作为额外候选', c.originalUrl,
        'https://ci.xiaohongshu.com/notes_pre_post/1040g2t0XYZ');
    eq('C3 首选扩展名按实际地址', c.ext, 'webp');
    ok('C4 有 urlPre 兜底或空', typeof c.urlFallback === 'string');
}

/* C5 探测函数放到末尾异步跑（不可达地址必须返回 false，不能抛） */

{
    /* 无法推导原图时：直接用现有地址，urlPre 作兜底 */
    const im = {
        infoList: [{ imageScene: 'WB_DFT', url: 'https://sns-webpic-qc.xhscdn.com/2026/abc/plain.jpg' }],
        urlPre: 'https://sns-webpic-qc.xhscdn.com/2026/abc/plain_pre.jpg'
    };
    const c = X.imageCandidate(im);
    eq('C6 无原图时用现有地址', c.url, 'https://sns-webpic-qc.xhscdn.com/2026/abc/plain.jpg');
    eq('C7 urlPre 作兜底', c.urlFallback, 'https://sns-webpic-qc.xhscdn.com/2026/abc/plain_pre.jpg');
    eq('C8 扩展名正确', c.ext, 'jpg');
}

{
    const c = X.imageCandidate({});
    eq('C9 空条目返回 null', c, null);
}

{
    /* infoList 全空但 urlDefault 有值 */
    const c = X.imageCandidate({ infoList: [], urlDefault: 'https://sns-img.xhscdn.com/spectrum/1040g34oZZZ' });
    eq('C10 urlDefault 作首选（原地址优先）', c.url, 'https://sns-img.xhscdn.com/spectrum/1040g34oZZZ');
    eq('C10b 同时给出原图候选', c.originalUrl, 'https://ci.xiaohongshu.com/spectrum/1040g34oZZZ');
}

/* ---------- C5 探测（异步） ---------- */
X.probeOriginal('https://ci.xiaohongshu.com/404-not-exist-xyz', 800).then(function (r) {
    eq('C5 探测失败返回 false', r, false);
    return X.probeOriginal('', 500);
}).then(function (r) {
    eq('C6 空地址返回 false', r, false);

    console.log('');
    console.log(pass + ' passed, ' + fail + ' failed');
    if (fail) {
        console.log('失败用例：' + fails.join(', '));
        process.exit(1);
    }
}).catch(function (e) {
    console.log('单测异常：' + e);
    process.exit(2);
});