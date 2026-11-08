#!/usr/bin/env node
/**
 * YouTube 档位列表纯逻辑单测
 *
 * 覆盖 VRYtOptions：体积格式化、清晰度标签、档位构造、按 key 找下标。
 *
 * 为什么要测：苏哥点下载后静默拉 15.66GB —— 根因是「没人问他要哪一档」。
 * 改成用户选档后，这段逻辑成了主路径：标签错了会选错档，体积错了会误判，
 * 找下标错了会点成别的档位。三种错都会直接浪费用户几十 GB 流量。
 *
 * 用法：node tools/test-yt-options.js
 */
'use strict';

const O = require('../js/yt/yt-options.js');

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

/* ---------- A. 体积格式化 ---------- */
eq('A1 未知体积写「大小未知」', O.sizeText(0), '大小未知');
eq('A2 null 也写「大小未知」', O.sizeText(null), '大小未知');
eq('A3 负数同样未知', O.sizeText(-5), '大小未知');
eq('A4 NaN 未知', O.sizeText('abc'), '大小未知');
eq('A5 小体积按 MB', O.sizeText(4 * 1048576), '4 MB');
eq('A6 926MB 用例（苏哥截图那个）', O.sizeText(926 * 1048576), '926 MB');
eq('A7 超 1GB 用 GB 两位小数', O.sizeText(2.5 * 1073741824), '2.50 GB');
eq('A8 15.66GB 用例', O.sizeText(15.66 * 1073741824), '15.66 GB');
ok('A9 恰好 1GB 走 GB 分支', O.sizeText(1073741824).indexOf('GB') > 0, O.sizeText(1073741824));

/* ---------- B. 清晰度标签 ---------- */
eq('B1 2160 → 4K', O.qualityLabel(2160), '4K');
eq('B2 4320 → 8K（不再误标成 4K）', O.qualityLabel(4320), '8K');
eq('B3 2880 → 5K', O.qualityLabel(2880), '5K');
eq('B4 1440 → 2K', O.qualityLabel(1440), '2K');
eq('B5 1080 → 1080p', O.qualityLabel(1080), '1080p');
eq('B6 720 → 720p', O.qualityLabel(720), '720p');
eq('B7 高帧率追加数字', O.qualityLabel(1080, 60), '1080p60');
eq('B8 低于 50 帧不追加', O.qualityLabel(1080, 30), '1080p');
eq('B9 未知高度', O.qualityLabel(0), '未知');

/* ---------- C. 档位构造 ---------- */
{
    const list = O.buildAll({
        video: [
            { itag: 313, height: 2160, fps: 30, size: 900 * 1048576 },
            { itag: 137, height: 1080, fps: 30, size: 200 * 1048576 }
        ],
        audio: { size: 10 * 1048576 },
        muxed: null
    });
    eq('C1 两档视频 + 一档音频', list.length, 3);
    eq('C2 第一档 key', list[0].key, 'v313');
    eq('C3 第一档含音频体积', list[0].size, 910 * 1048576);
    eq('C4 第一档体积文案', list[0].sizeText, '910 MB');
    eq('C5 第一档标签', list[0].label, '4K');
    eq('C6 最高档带徽标', list[0].badge, '最高');
    eq('C7 第二档无徽标', list[1].badge, '');
    eq('C8 第二档也含音频', list[1].size, 210 * 1048576);
    eq('C9 音频档 key', list[2].key, 'a');
    eq('C10 音频档标签', list[2].label, '仅音频');
    eq('C11 音频不叠加视频体积', list[2].size, 10 * 1048576);
    eq('C12 kind 区分', [list[0].kind, list[2].kind], ['video', 'audio']);
}

{
    /* 无音频轨：体积就是视频本身 */
    const list = O.buildAll({
        video: [{ itag: 18, height: 360, fps: 30, size: 5 * 1048576 }],
        audio: null
    });
    eq('C13 无音频时体积不变', list[0].size, 5 * 1048576);
    eq('C14 只有一档', list.length, 1);
}

{
    /* muxed：自带音轨，体积单独算，徽标「免合并」 */
    const list = O.buildAll({
        video: [],
        audio: { size: 3 * 1048576 },
        muxed: { itag: 18, height: 360, fps: 30, size: 7 * 1048576 }
    });
    const m = list.filter(x => x.kind === 'muxed')[0];
    eq('C15 muxed key', m && m.key, 'm18');
    eq('C16 muxed 徽标', m && m.badge, '免合并');
    eq('C17 muxed 体积不叠加音频', m && m.size, 7 * 1048576);
}

/* ---------- D. 体积缺失 ---------- */
{
    /* YouTube 有时不给 contentLength —— 必须显示「大小未知」而不是空白或 0 MB */
    const list = O.buildAll({
        video: [{ itag: 137, height: 1080, fps: 30, size: 0 }],
        audio: { size: 0 }
    });
    eq('D1 体积缺失文案', list[0].sizeText, '大小未知');
    eq('D2 size 归一为 0', list[0].size, 0);
}

/* ---------- E. 空输入 ---------- */
eq('E1 空对象返回空数组', O.buildAll({}), []);
eq('E2 null 返回空数组', O.buildAll(null), []);
eq('E3 无 itag 的项被跳过', O.buildAll({ video: [{ height: 1080 }] }), []);

/* ---------- F. 按 key 找下标 ---------- */
{
    const list = O.buildAll({
        video: [
            { itag: 313, height: 2160, size: 900 * 1048576 },
            { itag: 137, height: 1080, size: 200 * 1048576 }
        ],
        audio: { size: 10485760 }
    });
    eq('F1 找第一档', O.indexOfKey(list, 'v313'), 0);
    eq('F2 找第二档', O.indexOfKey(list, 'v137'), 1);
    eq('F3 找音频', O.indexOfKey(list, 'a'), 2);
    eq('F4 不存在的 key 返回 -1', O.indexOfKey(list, 'v999'), -1);
    eq('F5 空 key 返回 -1', O.indexOfKey(list, ''), -1);
    eq('F6 null 列表返回 -1', O.indexOfKey(null, 'v313'), -1);
}

/* ---------- G. 大文件提醒（不拦截） ---------- */
ok('G1 926MB 不算大', O.isBig(926 * 1048576) === false);
ok('G2 3GB 算大', O.isBig(3 * 1073741824) === true);
ok('G3 15.66GB 算大', O.isBig(15.66 * 1073741824) === true);
ok('G4 自定义阈值', O.isBig(3 * 1073741824, 4 * 1073741824) === false);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
    console.log('失败用例：' + fails.join(', '));
    process.exit(1);
}