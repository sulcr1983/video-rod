#!/usr/bin/env node
/* 预置站点名称表校验：node tools/check-site-names.js
 *
 * 校验项：
 *   1. host 格式合法（纯 ASCII、无路径、无端口、无驼峰）
 *   2. host 唯一（同一域名不能被两个站认领）
 *   3. 显示名唯一（重名会让两个站的素材挤进同一个目录）
 *   4. host 必须是「可注册域名」（v.qq.com 等 KEEP_SUBDOMAIN 例外除外），
 *      否则 VRSiteName.registrableDomain() 归一后查不到
 *   5. 显示名通过 cleanName() 后与原文一致（否则落盘目录名会被改写）
 *   6. 分类必须在 CAT 里
 *   7. 体积上限（防止有人把整张 PSL 塞进来）
 *
 * 退出码：0 全通过；1 有问题。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRESET_FILE = path.join(ROOT, 'js', 'library', 'site-names-preset.js');
const NAME_FILE = path.join(ROOT, 'js', 'site-name.js');

const SIZE_LIMIT = 200 * 1024;   // 200KB：远超当前体积，不是给人卡数的

let pass = 0;
const fails = [];

function ok(label) { pass++; console.log('  PASS  ' + label); }
function bad(label, detail) {
    fails.push(label + (detail ? '\n        ' + detail : ''));
    console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
}

/* ---------- 载入 ---------- */

const Preset = require(PRESET_FILE);
const SiteName = require(NAME_FILE);

const list = (Preset.list ? Preset.list() : (Preset.LIST || []));
const CAT = Preset.CAT || {};

if (!list.length) {
    console.error('预置表为空，无法校验');
    process.exit(1);
}

/* ---------- 1. 体积 ---------- */

console.log('\n[1] 体积');
const size = fs.statSync(PRESET_FILE).size;
if (size <= SIZE_LIMIT) {
    ok(`文件 ${(size / 1024).toFixed(1)}KB ≤ 上限 ${SIZE_LIMIT / 1024}KB`);
} else {
    bad(`文件 ${(size / 1024).toFixed(1)}KB 超过上限 ${SIZE_LIMIT / 1024}KB`);
}

/* ---------- 2. host 格式 ---------- */

console.log('\n[2] host 格式');
const HOST_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
let hostCount = 0;
const seenHost = new Map();

list.forEach((it, i) => {
    const label = `#${i} ${it.n}`;
    if (!it.n || typeof it.n !== 'string') { bad(`${label} 缺少显示名`); return; }
    if (!Array.isArray(it.h) || !it.h.length) { bad(`${label} 缺少 hosts`); return; }
    it.h.forEach(h => {
        hostCount++;
        if (/[^\x00-\x7F]/.test(h)) { bad(`${label} host 含非 ASCII：${h}`); return; }
        if (h.indexOf('/') >= 0) { bad(`${label} host 含路径：${h}`); return; }
        if (/[A-Z]/.test(h)) { bad(`${label} host 含大写：${h}`); return; }
        if (!HOST_RE.test(h)) { bad(`${label} host 格式非法：${h}`); return; }
        if (seenHost.has(h)) {
            bad(`${label} host 重复：${h}（已被「${seenHost.get(h)}」占用）`);
        } else {
            seenHost.set(h, it.n);
        }
    });
});
if (!fails.length) { ok(`${list.length} 条 / ${hostCount} 个 host 格式全部合法`); }

/* ---------- 3. 显示名唯一 + 可落盘 ---------- */

console.log('\n[3] 显示名');
const seenName = new Map();
list.forEach((it, i) => {
    const n = String(it.n || '');
    if (seenName.has(n)) {
        bad(`显示名重复：「${n}」(#${seenName.get(n)} 与 #${i})`);
        return;
    }
    seenName.set(n, i);
    const cleaned = SiteName.cleanName(n);
    if (cleaned !== n) {
        bad(`显示名会被清洗改写：「${n}」→ 「${cleaned}」`);
    }
    if (!it.c || !CAT[it.c]) {
        bad(`分类缺失或未知：「${n}」c=${JSON.stringify(it.c)}`);
    }
});
if (!fails.length) { ok(`${seenName.size} 个显示名唯一、可原样落盘、分类合法`); }

/* ---------- 4. host 必须是可注册域名 ---------- */

console.log('\n[4] 可注册域名一致性');
let regBad = 0;
seenHost.forEach((name, h) => {
    const reg = SiteName.registrableDomain(h);
    if (reg !== h) {
        regBad++;
        bad(`「${name}」的 host ${h} 不是可注册域名（归一后为 ${reg}），查表会落空`);
    }
});
if (!regBad) { ok(`${seenHost.size} 个 host 均已是可注册域名`); }

/* ---------- 5. 反查自检 ---------- */

console.log('\n[5] 索引可用性');
let lookupBad = 0;
list.forEach(it => {
    it.h.forEach(h => {
        const hit = Preset.byHost(h);
        if (!hit || hit.n !== it.n) {
            lookupBad++;
            bad(`byHost('${h}') 未命中「${it.n}」`);
        }
    });
    const byN = Preset.byName(it.n);
    if (!byN || byN.n !== it.n) {
        lookupBad++;
        bad(`byName('${it.n}') 未命中`);
    }
});
if (!lookupBad) { ok('byHost / byName 全部自反命中'); }

/* ---------- 汇总 ---------- */

console.log('\n========== 汇总 ==========');
console.log(`站点条数：${list.length}`);
console.log(`唯一 host：${seenHost.size}`);
console.log(`唯一站名：${seenName.size}`);
console.log(`文件体积：${(size / 1024).toFixed(1)}KB`);
console.log(`通过断言：${pass}`);
if (fails.length) {
    console.log(`\n失败 ${fails.length} 项：`);
    fails.forEach(f => console.log('  · ' + f));
    process.exit(1);
}
console.log('\nALL_PASS');
