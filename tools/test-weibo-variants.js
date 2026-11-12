#!/usr/bin/env node
/**
 * 微博多码率档位单测（2026-11-12，B-76）
 *
 * 苏哥报：「微博最高清不是 4K，默认最高就是 1080，应该以探测到的最高清为准，
 * 需要低清晰度的话用户自己选」。
 *
 * 根因两层，本文件各覆盖一段：
 *   ① 老实现只按固定字段名挑一条（mp4_1080p_url > mp4_hd_url > …），
 *      而微博 4K/2K 只在 `media_info.playback_list` 里 → 永远封顶 1080p。
 *   ② familyKey 用「域名+pathname」归族，微博各码率的文件名不同，
 *      4K 被当成「另一个视频」，prioritizePlaying 只会在 720p 那一族里取最高。
 *
 * 用法：node tools/test-weibo-variants.js
 */
'use strict';

const Q = require('../js/video-quality.js');

let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail === undefined ? '' : '  → ' + JSON.stringify(detail))); }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want }); }

/* 真实形态的 playback_list（字段照 Apifox / 实测返回，URL 参数截短不影响解析） */
function mkUrl(label, tmpl, mid) {
    return 'https://f.video.weibocdn.com/u0/ABC' + label + '.mp4?label=' + label +
        '&template=' + tmpl + '&media_id=' + mid + '&Expires=1793898051';
}

const DETAIL = {
    page_info: {
        media_info: {
            name: '测试视频',
            playback_list: [
                {
                    meta: { label: 'mp4_720p', quality_index: 720, quality_desc: '高清',
                        quality_label: '720p', quality_class: 'SD', type: 1 },
                    play_info: { type: 1, mime: 'video/mp4', label: 'mp4_720p',
                        url: mkUrl('mp4_720p', '1280x720.24.0', '5105103758360579'),
                        width: 1280, height: 720, size: 12000000, bitrate: 1500000,
                        video_codecs: 'avc1.4d001f' }
                },
                {
                    meta: { label: 'mp4_2160p', quality_index: 2160, quality_desc: '超清',
                        quality_label: '4K', quality_class: 'HD', type: 1 },
                    play_info: { type: 1, mime: 'video/mp4', label: 'mp4_2160p',
                        url: mkUrl('mp4_2160p', '3840x2160.25.0', '5105103758360579'),
                        width: 3840, height: 2160, size: 90749634, bitrate: 5411984,
                        video_codecs: 'avc1.640033' }
                },
                {
                    meta: { label: 'mp4_1080p', quality_index: 1080, quality_desc: '高清',
                        quality_label: '1080p', quality_class: 'HD', type: 1 },
                    play_info: { type: 1, mime: 'video/mp4', label: 'mp4_1080p',
                        url: mkUrl('mp4_1080p', '1920x1080.25.0', '5105103758360579'),
                        width: 1920, height: 1080, size: 45000000, bitrate: 3000000,
                        video_codecs: 'avc1.640028' }
                },
                {
                    /* 封面缩略图：type=3，不是视频档位，必须剔除 */
                    meta: { label: 'thumb', quality_label: '封面', type: 3 },
                    play_info: { type: 1, url: 'https://f.video.weibocdn.com/u0/thumb.jpg',
                        width: 480, height: 270 }
                },
                {
                    meta: { label: 'mp4_1440p', quality_index: 1440, quality_desc: '超清',
                        quality_label: '2K', quality_class: 'HD', type: 1 },
                    play_info: { type: 1, mime: 'video/mp4', label: 'mp4_1440p',
                        url: mkUrl('mp4_1440p', '2560x1440.25.0', '5105103758360579'),
                        width: 2560, height: 1440, size: 60000000, bitrate: 4200000,
                        video_codecs: 'avc1.640032' }
                }
            ]
        }
    }
};

console.log('\nA. weiboVariants —— 全档位解析（核心：4K 必须出现且排第一）');

{
    const vs = Q.weiboVariants(DETAIL);
    eq('A1 档位数（剔除封面缩略图）', vs.length, 4);
    eq('A2 顺序按高度降序', vs.map(v => v.height), [2160, 1440, 1080, 720]);
    eq('A3 最高清是 4K/2160p', [vs[0].height, vs[0].quality], [2160, '4K']);
    ok('A4 4K 直链正确', /label=mp4_2160p/.test(vs[0].url), vs[0].url);
    ok('A5 带体积（用于显示 MB）', vs[0].size === 90749634, vs[0].size);
    ok('A6 带码率（同高度时排序用）', vs[0].bitrate === 5411984, vs[0].bitrate);
    eq('A7 封面图被剔除（无 270p 档）', vs.some(v => v.height === 270), false);
    eq('A8 没有重复 URL', new Set(vs.map(v => v.url)).size, vs.length);
}

console.log('\nB. 老字段兜底（没有 playback_list 的老视频/转发帖）');

{
    const old = {
        page_info: {
            media_info: {
                stream_url: 'https://f.video.weibocdn.com/x.mp4?label=mp4_720p',
                stream_url_hd: 'https://f.video.weibocdn.com/y.mp4?label=mp4_1080p',
                mp4_1080p_url: 'https://f.video.weibocdn.com/z.mp4?label=mp4_1080p',
                size: 8800000
            }
        }
    };
    const vs = Q.weiboVariants(old);
    ok('B1 老字段仍能取到档位', vs.length >= 1, vs.length);
    ok('B2 优先取 mp4_1080p_url', /\/z\.mp4/.test(vs[0].url), vs[0].url);
    eq('B3 pickWeiboHdUrl 与 variants[0] 一致', Q.pickWeiboHdUrl(old), vs[0].url);
    ok('B4 playback_list 为空数组时也走兜底', Q.weiboVariants({ page_info: { media_info: { playback_list: [], stream_url: 'https://f.video.weibocdn.com/s.mp4' } } }).length === 1);
}

console.log('\nC. 脏数据不能崩');

{
    eq('C1 null 返回空数组', Q.weiboVariants(null), []);
    eq('C2 无 media_info 返回空', Q.weiboVariants({ page_info: {} }), []);
    eq('C3 playback_list 非数组', Q.weiboVariants({ page_info: { media_info: { playback_list: 'x' } } }), []);
    eq('C4 条目缺 url 被跳过', Q.weiboVariants({
        page_info: { media_info: { playback_list: [{ meta: { type: 1 }, play_info: {} }] } }
    }), []);
    ok('C5 只有 type=3 时返回空（不把封面当视频）', Q.weiboVariants({
        page_info: { media_info: { playback_list: [
            { meta: { type: 3 }, play_info: { url: 'https://f.video.weibocdn.com/a.jpg' } }
        ] } }
    }).length === 0);
    eq('C6 pickWeiboHdUrl 空输入不崩', Q.pickWeiboHdUrl(null), '');
}

console.log('\nD. familyKey —— 同一视频的各码率必须同族（第二层根因）');

{
    const u720 = mkUrl('mp4_720p', '1280x720.24.0', '5105103758360579');
    const u4k = mkUrl('mp4_2160p', '3840x2160.25.0', '5105103758360579');
    const uOther = mkUrl('mp4_720p', '1280x720.24.0', '9999999999999999');
    ok('D1 720p 与 4K 同族（文件名不同也无所谓）',
        Q.familyKey(u720) === Q.familyKey(u4k),
        { a: Q.familyKey(u720), b: Q.familyKey(u4k) });
    ok('D2 不同 media_id 不同族', Q.familyKey(u720) !== Q.familyKey(uOther));
    ok('D3 族键带 media_id', /media_id=5105103758360579/.test(Q.familyKey(u4k)), Q.familyKey(u4k));
}

console.log('\nE. prioritizePlaying —— 正在播 720p，最高必须给 4K');

{
    /* 模拟信息流：tab 里既有当前视频的 720p（正在播放），也有别的视频的 4K */
    const other4k = mkUrl('mp4_2160p', '3840x2160.25.0', '1111111111111111');
    const list = [
        { url: other4k, ext: 'mp4', height: 2160 },
        { url: mkUrl('mp4_720p', '1280x720.24.0', '5105103758360579'), ext: 'mp4', height: 720 },
        { url: mkUrl('mp4_2160p', '3840x2160.25.0', '5105103758360579'), ext: 'mp4', height: 2160 },
        { url: mkUrl('mp4_1080p', '1920x1080.25.0', '5105103758360579'), ext: 'mp4', height: 1080 }
    ];
    const playing = mkUrl('mp4_720p', '1280x720.24.0', '5105103758360579');
    const sorted = Q.prioritizePlaying(list, playing);
    eq('E1 锁当前作品，且族内取最高 → 4K 第一', sorted[0].height, 2160);
    ok('E2 第一项属于当前作品（media_id 相同）',
        /media_id=5105103758360579/.test(sorted[0].url), sorted[0].url);
    ok('E3 别的视频的 4K 不排第一', !/media_id=1111111111111111/.test(sorted[0].url), sorted[0].url);
    eq('E4 当前作品的档位都在前面（3 档）',
        sorted.slice(0, 3).map(m => m.height).sort((a, b) => b - a), [2160, 1080, 720]);
}

console.log('\nF. 端到端：探针数据 → 候选池顺序（模拟 background 的处理）');
{
    /* 复刻 background 里「全部入池 + prioritizePlaying」两步 */
    const vs = Q.weiboVariants(DETAIL);
    const playing = vs.find(v => v.height === 720).url;   // 页面正在播 720p
    let list = vs.map(v => ({ url: v.url, ext: 'mp4', size: v.size, height: v.height, bitrate: v.bitrate }));
    list = Q.prioritizePlaying(list, playing);
    eq('F1 一键下载取到 4K', list[0].height, 2160);
    ok('F2 4K 标签显示 2160p', Q.labelOf(list[0]).indexOf('2160p') === 0, Q.labelOf(list[0]));
    eq('F3 低清档仍保留，用户可自选', list.length, 4);
    eq('F4 全部档位从高到低', list.map(m => m.height), [2160, 1440, 1080, 720]);
}

console.log('\nG. 竖屏按短边算档位 + 同档位去重（2026-11-12 真机踩到）');

{
    /* 竖屏视频：width=1080 height=1920。按 height 当档位会显示「1920p」，
     * 还会在排序时压过真正的横屏 1440p —— 必须按短边（quality_index 优先）。 */
    const vertical = {
        page_info: { media_info: { playback_list: [
            { meta: { label: 'mp4_1080p', quality_index: 1080, quality_label: '1080p', type: 1 },
              play_info: { url: 'https://f.video.weibocdn.com/v1.mp4?media_id=777',
                width: 1080, height: 1920, size: 5000000, bitrate: 2000000 } },
            { meta: { label: 'mp4_720p', quality_index: 720, quality_label: '720p', type: 1 },
              play_info: { url: 'https://f.video.weibocdn.com/v2.mp4?media_id=777',
                width: 720, height: 1280, size: 3000000, bitrate: 1200000 } }
        ] } }
    };
    const vs = Q.weiboVariants(vertical);
    eq('G1 竖屏 1080x1920 记为 1080p（不是 1920p）', vs.map(v => v.height), [1080, 720]);

    /* 同分辨率给多条（不同编码/节点）时只留一条，否则面板出现两个「1080p」 */
    const dup = {
        page_info: { media_info: { playback_list: [
            { meta: { quality_index: 1080, quality_label: '1080p', type: 1 },
              play_info: { url: 'https://f.video.weibocdn.com/a1.mp4?media_id=888',
                width: 1920, height: 1080, size: 50000000, bitrate: 4000000 } },
            { meta: { quality_index: 1080, quality_label: '1080p', type: 1 },
              play_info: { url: 'https://f.video.weibocdn.com/a2.mp4?media_id=888',
                width: 1920, height: 1080, size: 40000000, bitrate: 3000000 } },
            { meta: { quality_index: 720, quality_label: '720p', type: 1 },
              play_info: { url: 'https://f.video.weibocdn.com/a3.mp4?media_id=888',
                width: 1280, height: 720, size: 20000000, bitrate: 1500000 } }
        ] } }
    };
    const dv = Q.weiboVariants(dup);
    eq('G2 同档位只留一条', dv.map(v => v.height), [1080, 720]);
    ok('G3 留下的是码率更高那条', /a1\.mp4/.test(dv[0].url), dv[0].url);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
    console.log('失败用例：' + fails.join(', '));
    process.exit(1);
}
