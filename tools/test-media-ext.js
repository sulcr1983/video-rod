#!/usr/bin/env node
/**
 * 媒体后缀判定单测（VRMediaExt）
 *
 * 起因：xx.knit.bid 的视频下不了，星愿能下。
 * 实测（docs/HLS-SITE-DIAGNOSIS.md）：缓存 14 条（2 个 m3u8 + 12 个 ts），
 * 候选过滤把两个 m3u8 全丢了，只剩 12 个 ts 分片当「MP4」选项 ——
 * 点哪个都只下到一个 12MB 碎片。
 *
 * 根因：VR_VIDEO_EXT 缺 m3u8/mpd。本模块把这条判据抽成纯逻辑并覆盖测试。
 *
 * 用法：node tools/test-media-ext.js
 */
'use strict';

const M = require('../js/media-ext.js');

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

/* ---------- A. 后缀提取 ---------- */
eq('A1 普通 mp4', M.extOf('https://a.com/v/x.mp4'), 'mp4');
eq('A2 带查询串', M.extOf('https://a.com/v/x.m3u8?token=1&t=2'), 'm3u8');
eq('A3 带锚点', M.extOf('https://a.com/v/x.ts#frag'), 'ts');
eq('A4 大写转小写', M.extOf('https://a.com/v/X.MP4'), 'mp4');
eq('A5 无后缀', M.extOf('https://a.com/v/stream'), '');
eq('A6 空串', M.extOf(''), '');
eq('A7 以点结尾', M.extOf('https://a.com/v/x.'), '');

/* ---------- B. 候选后缀白名单（本次修复的核心） ---------- */
ok('B1 mp4 可作候选', M.isCandidateExt('mp4'));
ok('B2 m3u8 可作候选（原来缺这个）', M.isCandidateExt('m3u8'));
ok('B3 mpd 可作候选（原来缺这个）', M.isCandidateExt('mpd'));
ok('B4 ts 可作候选', M.isCandidateExt('ts'));
ok('B5 m4s 可作候选', M.isCandidateExt('m4s'));
ok('B6 webm 可作候选', M.isCandidateExt('webm'));
ok('B7 jpg 不可作候选', M.isCandidateExt('jpg') === false);
ok('B8 空后缀不可作候选', M.isCandidateExt('') === false);
ok('B9 大小写不敏感', M.isCandidateExt('M3U8'));

/* ---------- C. 播放列表判定 ---------- */
ok('C1 m3u8 → 播放列表', M.isPlaylist('m3u8'));
ok('C2 mpd → 播放列表', M.isPlaylist('mpd'));
ok('C3 完整 URL → 播放列表', M.isPlaylist('https://media.knit.bid/play/12a2.m3u8'));
ok('C4 带查询串的 m3u8', M.isPlaylist('https://a.com/p.m3u8?x=1'));
ok('C5 mp4 不是播放列表', M.isPlaylist('mp4') === false);
ok('C6 ts 不是播放列表', M.isPlaylist('ts') === false);
ok('C7 空串不是播放列表', M.isPlaylist('') === false);

/* ---------- D. 分片判定 ---------- */
ok('D1 ts → 分片', M.isSegment('ts'));
ok('D2 m4s → 分片', M.isSegment('m4s'));
ok('D3 完整 ts URL', M.isSegment('https://r2-media.knit.bid/uploads/a/9/9/a99.ts'));
ok('D4 m3u8 不是分片', M.isSegment('m3u8') === false);
ok('D5 mp4 不是分片', M.isSegment('mp4') === false);

/* ---------- E. 折叠规则（本次修复的第二半） ---------- */
{
    /* 真实场景：2 个 m3u8 + 12 个 ts → 只留 m3u8 */
    const list = [
        { url: 'https://media.knit.bid/play/12a2fbff065d3fc0.m3u8', ext: 'm3u8' },
        { url: 'https://media.knit.bid/play/7ed2fb73c1c1d55a.m3u8', ext: 'm3u8' },
        { url: 'https://r2-media.knit.bid/uploads/a/9/9/a9965f4e.ts', ext: 'ts' },
        { url: 'https://r2-media.knit.bid/uploads/4/7/1/471e153f.ts', ext: 'ts' },
        { url: 'https://r2-media.knit.bid/uploads/1/2/d/12d0c1f5.ts', ext: 'ts' }
    ];
    const out = M.foldSegments(list);
    eq('E1 有播放列表时分片被折叠', out.length, 2);
    ok('E2 留下的是 m3u8', out.every(x => x.ext === 'm3u8'), JSON.stringify(out.map(x => x.ext)));
    ok('E3 不修改入参', list.length === 5, 'list.length=' + list.length);
}

{
    /* 反例：没有播放列表时，分片必须保留（否则用户什么都下不了） */
    const list = [
        { url: 'https://a.com/1.ts', ext: 'ts' },
        { url: 'https://a.com/2.ts', ext: 'ts' }
    ];
    eq('E4 无播放列表时保留分片', M.foldSegments(list).length, 2);
}

{
    /* 混合：mp4 直链 + m3u8 + ts → mp4 与 m3u8 都留，ts 丢 */
    const list = [
        { url: 'https://a.com/v.mp4', ext: 'mp4' },
        { url: 'https://a.com/p.m3u8', ext: 'm3u8' },
        { url: 'https://a.com/s1.ts', ext: 'ts' }
    ];
    const out = M.foldSegments(list);
    eq('E5 混合场景长度', out.length, 2);
    eq('E6 保留的扩展名', out.map(x => x.ext), ['mp4', 'm3u8']);
}

{
    /* DASH：mpd + m4s 分片同理 */
    const list = [
        { url: 'https://a.com/p.mpd', ext: 'mpd' },
        { url: 'https://a.com/1.m4s', ext: 'm4s' }
    ];
    eq('E7 DASH 折叠分片', M.foldSegments(list).length, 1);
    eq('E8 留下 mpd', M.foldSegments(list)[0].ext, 'mpd');
}

{
    /* 边界：ext 缺失时按 URL 判断 */
    const list = [
        { url: 'https://a.com/p.m3u8' },
        { url: 'https://a.com/s1.ts' }
    ];
    eq('E9 ext 缺失也能判定', M.foldSegments(list).length, 1);
}

eq('E10 空列表', M.foldSegments([]), []);
eq('E11 null 输入', M.foldSegments(null), []);

/* ---------- F. 回归：本次 bug 的反向断言 ---------- */
{
    /* 修复前：m3u8 不在白名单 → 被判成非视频 → 整个播放列表消失。
     * 这条断言如果失败，说明我们又退回了老 bug。 */
    const pl = 'https://media.knit.bid/play/12a2fbff065d3fc0.m3u8';
    ok('F1 knit.bid 播放列表必须被接受', M.isCandidateExt(M.extOf(pl)),
        'ext=' + M.extOf(pl));
    ok('F2 且被识别为播放列表', M.isPlaylist(pl));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
    console.log('失败用例：' + fails.join(', '));
    process.exit(1);
}
