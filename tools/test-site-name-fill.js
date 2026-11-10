#!/usr/bin/env node
/* 站点名自动补齐（VRSiteNameFill）单测：node tools/test-site-name-fill.js
 *
 * 只测纯逻辑（不联网、不碰 chrome.runtime）：
 *   1. 哪些 platform 值得探测（域名形态 / 排除项）
 *   2. 域名归一（去 www / 子域归并 / v.qq.com 保留）
 *   3. 收集队列：已有名字跳过、去重、限量、7 天内已探测跳过、force 重试
 *
 * 网络探测本身（sendProbe / applyResult）在真机验收里测，不放离线套件。
 */
'use strict';

const path = require('path');
global.self = global;

const ROOT = path.join(__dirname, '..');
global.VRSiteName = require(path.join(ROOT, 'js', 'site-name.js'));
global.VRSiteNamesPreset = require(path.join(ROOT, 'js', 'library', 'site-names-preset.js'));
global.VRPath = require(path.join(ROOT, 'js', 'library', 'path.js')).VRPath;

let learned = {};
global.VRSiteNameStore = {
    snapshot: () => learned,
    ready: () => Promise.resolve(learned),
    peek: (h) => learned[h] || null,
    nameOf: (h) => (learned[h] || {}).name || ''
};

const RG = require(path.join(ROOT, 'js', 'library', 'site-registry.js'));
global.VRSiteRegistry = RG;
const Fill = require(path.join(ROOT, 'js', 'library', 'site-name-fill.js'));
global.VRSiteNameFill = Fill;

let pass = 0, fail = 0;
const fails = [];
function eq(name, actual, expected) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a === b) { pass++; return; }
    fail++; fails.push(`${name}: 得到 ${a}，期望 ${b}`);
}
function section(t) { console.log(`\n[${t}]`); }

/* ---------------- 1. 域名形态 ---------------- */
section('hostLike');
[
    ['普通域名', 'yidianzixun.com', true],
    ['带 www', 'www.bizhi66.com', true],
    ['多级子域', 'img.static.pixabay.com', true],
    ['中文站域名', 'example.com.cn', true],
    ['平台 key', 'weibo', false],
    ['分组键', '@小红书', false],
    ['未整理', 'untracked', false],
    ['占位 web', 'web', false],
    ['IPv4', '127.0.0.1', false],
    ['localhost', 'localhost', false],
    ['空值', '', false],
    ['带路径', 'https://a.com/x', false]
].forEach(([n, v, want]) => eq(n, Fill.hostLike(v), want));

/* ---------------- 2. 域名归一 ---------------- */
section('normKey');
eq('去 www', Fill.normKey('www.bizhi66.com'), 'bizhi66.com');
eq('子域归并', Fill.normKey('img.static.pixabay.com'), 'pixabay.com');
eq('com.cn 保留三级', Fill.normKey('a.example.com.cn'), 'example.com.cn');
eq('独立产品子域保留', Fill.normKey('v.qq.com'), 'v.qq.com');
eq('普通域名不变', Fill.normKey('yidianzixun.com'), 'yidianzixun.com');

/* ---------------- 3. 收集队列 ---------------- */
section('collectUnknown');
learned = {};
RG._reset();
const files = [
    { plat: 'xiaohongshu.com' },          // 预置表命中 → 跳过
    { plat: 'bilibili.com' },             // 预置表命中 → 跳过
    { plat: 'yidianzixun.com' },          // 未知 → 收
    { plat: 'www.bizhi66.com' },          // 未知 → 归一后收
    { plat: 'bizhi66.com' },              // 与上一条同站 → 去重
    { plat: 'www.baibian365.com' },       // 未知 → 收
    { plat: 'web' }, { plat: 'untracked' }, { plat: '@小红书' }, { plat: '127.0.0.1' },
    { plat: 'https://x.com/a' }
];
eq('三个未知域名（归一去重）',
    Fill.collectUnknown(files, { store: global.VRSiteNameStore }),
    ['yidianzixun.com', 'bizhi66.com', 'baibian365.com']);
eq('单轮上限生效',
    Fill.collectUnknown(files, { max: 2, store: global.VRSiteNameStore }),
    ['yidianzixun.com', 'bizhi66.com']);

/* F2 修好后，字典里已有名字的站不再进队列 */
learned = { 'bizhi66.com': { name: '4k壁纸', src: 'title', at: Date.now() } };
RG._reset();
eq('已学到的站名不再探测',
    Fill.collectUnknown(files, { store: global.VRSiteNameStore }),
    ['yidianzixun.com', 'baibian365.com']);
eq('带 www 的同一站也不再探测',
    Fill.collectUnknown([{ plat: 'www.bizhi66.com' }], { store: global.VRSiteNameStore }),
    []);

/* 空名记录（探测失败）= 7 天内不重复外发；过期可重试 */
section('probedRecently');
const now = Date.now();
learned = {};
RG._reset();
eq('无记录不跳过', Fill.probedRecently('a.com', global.VRSiteNameStore), false);
learned = { 'a.com': { name: '', src: 'probe', at: now - 1000 } };
eq('刚探测失败的跳过', Fill.probedRecently('a.com', global.VRSiteNameStore), true);
learned = { 'a.com': { name: '', src: 'probe', at: now - 8 * 24 * 3600 * 1000 } };
eq('超过 7 天允许重试', Fill.probedRecently('a.com', global.VRSiteNameStore), false);
learned = { 'a.com': { name: '已有名字', src: 'og', at: now } };
eq('有名字不算失败记录', Fill.probedRecently('a.com', global.VRSiteNameStore), false);

learned = { 'yidianzixun.com': { name: '', src: 'probe', at: now - 1000 } };
RG._reset();
eq('队列跳过近期失败记录',
    Fill.collectUnknown(files, { store: global.VRSiteNameStore }),
    ['bizhi66.com', 'baibian365.com']);
eq('force 忽略失败记录',
    Fill.collectUnknown(files, { force: true, ignoreProbed: true, store: global.VRSiteNameStore }),
    ['yidianzixun.com', 'bizhi66.com', 'baibian365.com']);

console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail) {
    console.log('\n失败明细：');
    fails.forEach((f, i) => console.log(`${i + 1}. ${f}`));
    process.exit(1);
}
console.log('ALL_PASS');
