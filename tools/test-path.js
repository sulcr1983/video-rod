/* 资源库路径引擎单测（S1a）：node tools/test-path.js
 * 覆盖 平台识别 / 类型推断 / 博主段 / 目录拼装 / 长度保护 / file:// 编码。
 */
'use strict';

const path = require('../js/library/path.js');
const V = path.VRPath || path;

let pass = 0, fail = 0;
const fails = [];

function eq(name, got, expect) {
    const ok = got === expect;
    if (ok) { pass++; } else { fail++; fails.push(`${name}\n    got:    ${JSON.stringify(got)}\n    expect: ${JSON.stringify(expect)}`); }
}
function ok(name, cond) {
    if (cond) { pass++; } else { fail++; fails.push(`${name}\n    expect truthy: ${JSON.stringify(cond)}`); }
}
function has(name, s, sub) {
    ok(name + `（含 ${sub}）`, String(s).indexOf(sub) !== -1);
}

/* ---------- 平台识别 ---------- */
eq('平台 bilibili', V.detectPlatform('https://www.bilibili.com/video/BV1xx411c7mD'), 'bilibili');
eq('平台 b23.tv', V.detectPlatform('https://b23.tv/abcd'), 'bilibili');
eq('平台 小红书', V.detectPlatform('https://www.xiaohongshu.com/explore/65a'), 'xiaohongshu');
eq('平台 x.com', V.detectPlatform('https://x.com/ken_shoots/status/1'), 'x');
eq('平台 twitter', V.detectPlatform('https://twitter.com/ken/status/1'), 'x');
eq('平台 YouTube', V.detectPlatform('https://www.youtube.com/watch?v=abc'), 'youtube');
eq('平台 youtu.be', V.detectPlatform('https://youtu.be/abc'), 'youtube');
eq('平台 普通网页', V.detectPlatform('https://example.com/post/1'), 'web');
eq('平台 空 URL', V.detectPlatform(''), 'web');

/* ---------- 类型推断 ---------- */
eq('类型 mp4', V.typeOf({ ext: 'mp4' }), 'video');
eq('类型 webm', V.typeOf({ ext: '.webm' }), 'video');
eq('类型 jpg', V.typeOf({ ext: 'jpg' }), 'image');
eq('类型 webp', V.typeOf({ ext: 'webp' }), 'image');
eq('类型 m4a', V.typeOf({ ext: 'm4a' }), 'audio');
eq('类型 未知', V.typeOf({ ext: 'xyz' }), 'other');
eq('类型 从文件名推断', V.typeOf({ fileName: 'a.mp4' }), 'video');
eq('类型 显式优先', V.typeOf({ type: 'image', ext: 'mp4' }), 'image');

/* ---------- 博主 ID 提取 ---------- */
eq('ID 小红书 profile', V.creatorIdFromUrl('https://www.xiaohongshu.com/user/profile/5f8abc'), '5f8abc');
eq('ID B站空间', V.creatorIdFromUrl('https://space.bilibili.com/946974'), '946974');
eq('ID YouTube channel', V.creatorIdFromUrl('https://www.youtube.com/channel/UCabc'), 'UCabc');
eq('ID YouTube @handle', V.creatorIdFromUrl('https://www.youtube.com/@veritasium'), '@veritasium');
eq('ID X handle', V.creatorIdFromUrl('https://x.com/ken_shoots/status/1'), '@ken_shoots');
eq('ID X 非用户路径', V.creatorIdFromUrl('https://x.com/explore'), '');
eq('ID 无', V.creatorIdFromUrl('https://example.com/a'), '');

/* ---------- 博主段 ---------- */
eq('博主 完整', V.creatorSegment('影视飓风(@946974)'), '影视飓风(@946974)');
eq('博主 仅昵称', V.creatorSegment('影视飓风'), '影视飓风');
eq('博主 都有缺失', V.creatorSegment('', ''), '待整理');
eq('博主 只有 ID', V.creatorSegment('', '946974'), '待整理(@946974)');

/* ---------- 目录拼装 ---------- */
eq('目录 B站',
    V.buildRelDir({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'mp4' }),
    'video-rod/B站/影视飓风(@946974)/视频');

eq('目录 小红书（从 URL 提 ID）',
    V.buildRelDir({ pageUrl: 'https://www.xiaohongshu.com/user/profile/5f8abc', ext: 'jpg' }),
    'video-rod/小红书/待整理(@5f8abc)/图片');

eq('目录 X（从 URL 提 handle）',
    V.buildRelDir({ pageUrl: 'https://x.com/ken_shoots/status/1', ext: 'mp4' }),
    'video-rod/X/待整理(@ken_shoots)/视频');

eq('目录 普通网页（域名占位）',
    V.buildRelDir({ pageUrl: 'https://example.com/post/1', ext: 'jpg' }),
    'video-rod/其他网页/example.com/图片');

eq('目录 自定义子目录',
    V.buildRelDir({ subdir: '我的库', pageUrl: 'https://youtu.be/a', ext: 'mp4' }),
    '我的库/YouTube/待整理/视频');

eq('目录 音频',
    V.buildRelDir({ pageUrl: 'https://example.com/a', ext: 'm4a' }),
    'video-rod/其他网页/example.com/音频');

/* ---------- 完整路径与长度 ---------- */
eq('完整路径',
    V.buildRelPath({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'mp4', fileName: '20261024_一次看懂HDR_2160p.mp4' }),
    'video-rod/B站/影视飓风(@946974)/视频/20261024_一次看懂HDR_2160p.mp4');

const longName = '很长的标题'.repeat(40) + '.mp4';
const longRel = V.buildRelPath({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'mp4', fileName: longName });
ok('超长路径被截断到 170 以内', longRel.length <= V.MAX_REL_LEN);
ok('截断后仍保留扩展名', /\.mp4$/.test(longRel));
ok('截断后目录结构不变', longRel.indexOf('video-rod/B站/影视飓风(@946974)/视频/') === 0);

const len = V.checkLength(longRel);
ok('checkLength 判定通过', len.ok === true);
ok('checkLength 溢出计算', V.checkLength('a'.repeat(200)).overflow === 30);

/* ---------- 清洗 ---------- */
eq('清洗 非法字符', V.cleanSeg('a<b>c:d"e|f?g*h'), 'a_b_c_d_e_f_g_h');
eq('清洗 保留名', V.cleanSeg('CON'), '_CON');
eq('清洗 尾点空格', V.cleanSeg('abc. . '), 'abc');
eq('清洗 空', V.cleanSeg(''), '');

/* ---------- file:// 编码 ---------- */
const fu = V.toFileUrl('D:\\Media\\视频 素材\\a#b%c.jpg');
ok('file:// 前缀', fu.indexOf('file:///D:/Media/') === 0);
ok('file:// 不含裸空格', fu.indexOf(' ') === -1);
ok('file:// # 已转义', fu.indexOf('#') === -1);
ok('file:// 可反解回原路径',
    decodeURIComponent(fu.replace('file:///', '')).replace(/\//g, '\\') === 'D:\\Media\\视频 素材\\a#b%c.jpg');

/* ---------- 汇总 ---------- */
console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail) {
    console.log('\n失败明细：');
    fails.forEach((f, i) => console.log(`${i + 1}. ${f}`));
    process.exit(1);
}
