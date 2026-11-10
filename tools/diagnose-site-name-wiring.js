#!/usr/bin/env node
/* ==========================================================
 * 站点名链路接线诊断（只读，可反复重跑）
 *
 * 背景：资源库左栏「其他站点」里，预置表收录的站显示中文名，
 *       没收录的站显示域名。本脚本用项目自身的四个模块复现原因。
 *
 * 运行：node tools/diagnose-site-name-wiring.js
 *
 * 模拟方式：内存版 chrome.storage.local（不碰真实扩展数据），
 *          先写入 3 条「以前下载时自动学到」的站名，再看库页能否读到。
 * ========================================================== */
'use strict';

const R = (p) => require('../' + p);
const fs = require('fs');
const path = require('path');

/* 内存版 storage：必须在 require 站点名模块前装好 */
const disk = { vrSiteNames: {} };
global.chrome = {
    storage: { local: {
        get: function (key, cb) { const o = {}; o[key] = JSON.parse(JSON.stringify(disk[key] || {})); cb(o); },
        set: function (o, cb) { Object.keys(o).forEach(function (k) { disk[k] = JSON.parse(JSON.stringify(o[k])); }); cb(); }
    } },
    runtime: {}
};

global.VRSiteName = R('js/site-name.js');
global.VRSiteNameStore = R('js/site-name-store.js');
global.VRSiteNamesPreset = R('js/library/site-names-preset.js');
global.VRSiteRegistry = R('js/library/site-registry.js');

const SN = global.VRSiteName;
const ST = global.VRSiteNameStore;
const RG = global.VRSiteRegistry;

/* 截图里的 9 个站点：前 6 个在预置表，后 5 个是要诊断的键 */
const PRESET_KEYS = ['xiaohongshu.com', 'bilibili.com', 'pixso.cn', 'instagram.com', 'pixabay.com', 'v.qq.com'];
const PROBLEM_KEYS = ['yidianzixun.com', 'www.bizhi66.com', 'bizhi66.com', 'www.baibian365.com', 'www.xiaohongshu.com'];
const ALL = PRESET_KEYS.concat(PROBLEM_KEYS);

function show(tag) {
    const snap = ST.snapshot();
    console.log('\n--- ' + tag + ' ---');
    console.log('  snapshot(): ' + (snap === null
        ? 'null  → learned 层完全缺席（只剩预置表）'
        : JSON.stringify(snap)));
    ALL.forEach(function (k) {
        const n = RG.nameOf(k);
        console.log('  ' + (n ? '[名字]' : '[域名]') + ' nameOf(' + JSON.stringify(k) + ') = ' + JSON.stringify(n));
    });
}

(async function () {
    console.log('站点名链路接线诊断（离线，内存 storage）');
    console.log('='.repeat(64));

    /* 前置：模拟「以前下载时已自动学到并落盘」的 3 个小站 */
    await ST.put('yidianzixun.com', '一点资讯', 'og');
    await ST.put('bizhi66.com', '壁纸66', 'title');
    await ST.put('baibian365.com', '百变桌面', 'title');
    console.log('\n磁盘 vrSiteNames 已有: ' + Object.keys(disk.vrSiteNames).join(', '));

    /* ① 资源库页面冷启动 = 现状：没有任何代码调用 ST.ready() */
    ST._resetCache();
    RG._reset();
    show('① 修复前基线（模拟）：库页冷启动且从不 ready()');

    /* ② 修复 A：boot 里 await ST.ready() + RG.refresh() */
    await ST.ready();
    RG.refresh();
    show('② 当前代码（F1 ready+refresh / F2 归一）：11 个键应全部为 [名字]');

    /* ③ 对照：下载链路有 URL 时本来就归一，没坏 */
    console.log('\n--- 对照组：下载链路 detect() ---');
    ['https://www.bizhi66.com/a', 'https://yidianzixun.com/a', 'https://www.xiaohongshu.com/a'].forEach(function (u) {
        const d = RG.detect(u);
        console.log('  ' + u + ' → key=' + d.key + ' name=' + JSON.stringify(d.name) + ' src=' + d.src);
    });

    /* ④ 可选：用项目自己的提取器跑三个站点首页快照 */
    const pageDir = path.join(__dirname, '..', '.tmp-probe', 'pages');
    if (fs.existsSync(pageDir)) {
        console.log('\n--- 对照组：三个站点首页 parseHtmlInfo() ---');
        [
            ['yidianzixun', 'https://www.yidianzixun.com/'],
            ['bizhi66', 'https://www.bizhi66.com/'],
            ['baibian365', 'https://www.baibian365.com/']
        ].forEach(function (pair) {
            const f = path.join(pageDir, pair[0] + '.html');
            if (!fs.existsSync(f)) { return; }
            const info = SN.parseHtmlInfo(fs.readFileSync(f, 'utf8'), pair[1]);
            console.log('  ' + pair[0] + ' → name=' + JSON.stringify(info.name) + ' src=' + (info.src || '-'));
        });
    }

    console.log('\n' + '='.repeat(64));
    console.log('诊断基线（2026-11-10，F1/F2 已实施）：');
    console.log('  ① 模拟修复前：库页不调 ST.ready() → learned 层缺席，只剩预置表（与苏哥截图一致）');
    console.log('  ② 当前代码：ready()+refresh() 且 nameOf 已归一 → 11 个键应全部 [名字]');
    console.log('  F4（历史站点自动补齐）见 js/library/site-name-fill.js，真机脚本 test-site-name-fill-live.py');
    console.log('  下载链路 detect() 本来就正常，不要在下载侧改逻辑');
})();
