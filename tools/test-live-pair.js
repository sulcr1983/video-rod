// 实况配对与动图归类单测（2026-11-11，B-71 的第二问）
//
// 苏哥问「其他平台的 gif 动图支持了吗？筛选图片时会支持 live 图吗？」
// 这两件事都落在「库里怎么归类一条素材」上，纯逻辑，可以直接测：
//   1. 照片 + 同前缀 `_live.mp4` 成对 → 归成 live（筛选能单独选出来）
//   2. 只有照片、没有配对视频 → 仍是普通图片，绝不挂「实况」角标
//   3. 只有 `_live.mp4`、没有照片 → 是视频，不是实况
//   4. gif / apng 归动图；webp 只能算图片（小红书大量静态 webp）
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; fails.push(name); console.log('FAIL  ' + name + (detail ? '  ' + detail : '')); }
}

// ---- 从 app.js 里抠出纯逻辑（它是 IIFE 挂 window，不能在 Node 里直接 require）----
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'library', 'app.js'), 'utf8');

function cut(startMark, endMark) {
    const i = src.indexOf(startMark);
    if (i < 0) { throw new Error('找不到起点: ' + startMark); }
    const j = src.indexOf(endMark, i);
    if (j < 0) { throw new Error('找不到终点: ' + endMark); }
    return src.slice(i, j);
}

const code = [
    'var EXT_ANIM = /^(gif|apng)$/i;',
    cut('var EXT_LIVE =', 'function markLivePairs'),
    cut('function markLivePairs', '    /* ---------- 统计 ---------- */')
].join('\n');

// eslint-disable-next-line no-new-func
const factory = new Function(code + '\nreturn { EXT_LIVE, EXT_ANIM, livePathOf, markLivePairs };');
const M = factory();

// ---- A 段：实况路径推导 ----
ok('A1 jpg → _live.mp4', M.livePathOf('a/b/001.jpg') === 'a/b/001_live.mp4', M.livePathOf('a/b/001.jpg'));
ok('A2 本身已是 _live.mp4 → 空', M.livePathOf('a/001_live.mp4') === '', M.livePathOf('a/001_live.mp4'));
ok('A3 无扩展名 → 空（不猜）', M.livePathOf('a/b/c') === '', M.livePathOf('a/b/c'));
ok('A4 空串 → 空', M.livePathOf('') === '');

// ---- B 段：整表配对 ----
function mk(rel, kind) {
    var k = kind || 'image';
    return { relPath: rel, kind: k, livePair: k === 'image' ? M.livePathOf(rel) : '' };
}
{
    const list = [
        mk('x/001.jpg'),
        { relPath: 'x/001_live.mp4', kind: 'video', livePair: '' },
        mk('x/002.jpg')                       // 没有配对视频
    ];
    M.markLivePairs(list);
    ok('B1 有配对 → 照片归 live', list[0].kind === 'live', list[0].kind);
    ok('B2 无配对 → 保持 image', list[2].kind === 'image', list[2].kind);
    ok('B3 无配对时清掉 livePair（避免预览去找不存在的文件）', list[2].livePair === '', list[2].livePair);
    ok('B4 实况 mp4 本身仍是视频', list[1].kind === 'video', list[1].kind);
}
{
    const list = [{ relPath: 'x/003_live.mp4', kind: 'video', livePair: '' }];
    M.markLivePairs(list);
    ok('B5 只有 _live.mp4 没有照片 → 仍是视频', list[0].kind === 'video', list[0].kind);
}
{
    const list = [mk('X/001.JPG')];
    list[0].livePair = M.livePathOf('X/001.JPG');
    list.push({ relPath: 'x/001_live.mp4', kind: 'video', livePair: '' });
    M.markLivePairs(list);
    /* 大小写：Windows 上 001.JPG 和 x/001_live.mp4 目录大小写不一致也该配上 */
    ok('B6 目录/扩展名大小写不敏感', list[0].kind === 'live', list[0].kind);
}

// ---- C 段：动图归类 ----
ok('C1 gif 是动图', M.EXT_ANIM.test('gif'));
ok('C2 apng 是动图', M.EXT_ANIM.test('apng'));
ok('C3 webp 不是动图（静态 webp 很多）', !M.EXT_ANIM.test('webp'));
ok('C4 png 不是动图', !M.EXT_ANIM.test('png'));
ok('C5 大小写不敏感', M.EXT_ANIM.test('GIF'));
ok('C6 _live.mp4 命中实况正则', M.EXT_LIVE.test('a/001_live.mp4'));
ok('C7 普通 mp4 不命中', !M.EXT_LIVE.test('a/001.mp4'));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
    console.log('失败用例：' + fails.join(', '));
    process.exit(1);
}
