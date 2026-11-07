#!/usr/bin/env node
/**
 * 视频清晰度解析与候选排序单测
 *
 * 覆盖 VRVideoQuality：
 *   A 分辨率解析   B 候选排序   C 同素材归组   D 标签文案
 *
 * 背景：微博信息流默认播 720p，旧排序把「正在播放」无条件置顶，
 * 导致一键下载永远只拿 720p。这里固定「分辨率优先」的通用规则。
 *
 * 用法：node tools/test-video-quality.js
 */
'use strict';

const Q = require('../js/video-quality.js');

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

/* ---------- A. 分辨率解析 ---------- */
eq('A1 微博 label=mp4_1080p', Q.heightFromUrl('https://f.video.weibocdn.com/x.mp4?label=mp4_1080p&a=1'), 1080);
eq('A2 微博 label=mp4_720p', Q.heightFromUrl('https://f.video.weibocdn.com/x.mp4?label=mp4_720p'), 720);
eq('A3 微博 label=mp4_hd 无数字', Q.heightFromUrl('https://f.video.weibocdn.com/x.mp4?label=mp4_hd'), 720);
eq('A4 quality=1080p', Q.heightFromUrl('https://x.com/v.mp4?quality=1080p'), 1080);
eq('A5 height 参数', Q.heightFromUrl('https://x.com/v.mp4?height=2160'), 2160);
eq('A6 h 参数', Q.heightFromUrl('https://x.com/v.mp4?h=480'), 480);
eq('A7 路径里的 720p', Q.heightFromUrl('https://x.com/hd/720p/video.mp4'), 720);
eq('A8 短标记 uhd', Q.heightFromUrl('https://x.com/uhd/v.mp4'), 2160);
eq('A9 短标记 hd', Q.heightFromUrl('https://x.com/hd/v.mp4'), 720);
eq('A10 无信息返回 0', Q.heightFromUrl('https://x.com/video.mp4'), 0);
eq('A11 空串返回 0', Q.heightFromUrl(''), 0);
eq('A12 非法高度被拒', Q.heightFromUrl('https://x.com/v.mp4?height=99'), 0);

/* 关键：微博真实 URL 形态 */
{
    const real = 'https://f.video.weibocdn.com/o0/qEHvp9p0lx08C9oVYReo010412003jxE0E010.mp4?label=mp4_720p&template=720x1280.24.0&media_id=5362210344468552';
    eq('A13 微博真实 URL 识别 720p', Q.heightFromUrl(real), 720);
    const u1080 = real.replace('mp4_720p', 'mp4_1080p');
    eq('A14 换成 1080p 能识别', Q.heightFromUrl(u1080), 1080);
}

/* ---------- B. 候选排序 ---------- */
{
    /* 旧规则的坑：720p 是「正在播放」，会被置顶拿到一键下载 */
    const list = [
        { url: 'https://x.com/v.mp4?label=mp4_720p', size: 4.0 * 1048576 },
        { url: 'https://x.com/v.mp4?label=mp4_1080p', size: 45.6 * 1048576 },
        { url: 'https://x.com/v.mp4?label=mp4_480p', size: 2.1 * 1048576 }
    ];
    const playing = 'https://x.com/v.mp4?label=mp4_720p';
    const sorted = Q.sortCandidates(list, playing);
    ok('B1 最高清排第一（不是正在播放的）',
        sorted[0].url.indexOf('1080p') > 0, sorted[0].url);
    eq('B2 分辨率降序', sorted.map((x) => x.height), [1080, 720, 480]);
    ok('B3 不修改入参', list[0].url.indexOf('720p') > 0);
}
{
    /* 同分辨率时按体积 */
    const list = [
        { url: 'https://x.com/a.mp4', size: 10, height: 1080 },
        { url: 'https://x.com/b.mp4', size: 30, height: 1080 }
    ];
    eq('B4 同分辨率按体积降序', Q.sortCandidates(list, '')[0].url, 'https://x.com/b.mp4');
}
{
    /* 分辨率与体积都相同时，才偏好正在播放 */
    const list = [
        { url: 'https://x.com/a.mp4', size: 10, height: 1080 },
        { url: 'https://x.com/b.mp4', size: 10, height: 1080 }
    ];
    eq('B5 其余相同时偏好当前播放', Q.sortCandidates(list, 'https://x.com/b.mp4')[0].url,
        'https://x.com/b.mp4');
}
{
    /* 解析不到分辨率的（size 大）不该压过已知高清档 */
    const list = [
        { url: 'https://x.com/unknown.mp4', size: 999 * 1048576 },
        { url: 'https://x.com/v.mp4?label=mp4_1080p', size: 10 * 1048576 }
    ];
    eq('B6 已知分辨率优先于未知', Q.sortCandidates(list, '')[0].height, 1080);
}
eq('B7 空列表安全', Q.sortCandidates([], '').length, 0);
eq('B8 非数组安全', Q.sortCandidates(null, '').length, 0);

/* ---------- C. 同素材归组 ---------- */
{
    /* 微博同一个视频的多个码率：pathname 相同，只有 label 不同 */
    const list = [
        { url: 'https://f.video.weibocdn.com/o0/abc123.mp4?label=mp4_720p', size: 4 * 1048576 },
        { url: 'https://f.video.weibocdn.com/o0/abc123.mp4?label=mp4_1080p', size: 45 * 1048576 },
        { url: 'https://f.video.weibocdn.com/o0/def456.mp4?label=mp4_720p', size: 8 * 1048576 }
    ];
    const collapsed = Q.collapseByAsset(list);
    eq('C1 两个素材归成两条', collapsed.length, 2);
    ok('C2 保留的是高清那条', collapsed[0].url.indexOf('1080p') > 0, collapsed[0].url);
}
eq('C3 空列表安全', Q.collapseByAsset([]).length, 0);
eq('C4 无 url 的条目被跳过', Q.collapseByAsset([{ size: 1 }]).length, 0);

/* ---------- D. 标签文案 ---------- */
eq('D1 有分辨率与体积', Q.labelOf({ url: 'https://x/a.mp4?label=mp4_1080p', size: 45.6 * 1048576 }), '1080p · 45.6MB');
eq('D2 无分辨率只有体积', Q.labelOf({ url: 'https://x/a.mp4', size: 4 * 1048576 }), 'MP4 · 4.0MB');
eq('D3 都没有', Q.labelOf({ url: 'https://x/a.mp4' }), 'MP4');

/* ---------- E. 微博 mid 提取与高清直链挑选 ---------- */
{
    const real720 = 'https://f.video.weibocdn.com/o0/qEHvp9p0lx08C9oVYReo010412003jxE0E010.mp4' +
        '?label=mp4_720p&template=720x1280.24.0&media_id=5362210344468552&a=1';
    eq('E1 从微博 URL 提取 mid', Q.weiboMidFromUrl(real720), '5362210344468552');

    const real1080 = real720.replace('mp4_720p', 'mp4_1080p').replace('5362210344468552', '5362288048144419');
    eq('E2 换 id 也能提取', Q.weiboMidFromUrl(real1080), '5362288048144419');

    eq('E3 非微博域名不提取', Q.weiboMidFromUrl('https://x.com/v.mp4?media_id=12345678901'), '');
    eq('E4 空串', Q.weiboMidFromUrl(''), '');
    eq('E5 无 media_id 参数', Q.weiboMidFromUrl('https://f.video.weibocdn.com/o0/a.mp4'), '');
}
{
    /* 字段优先级抄笃笃 v0.16.14 的 I()：mp4_hd_url > stream_url_hd > mp4_sd_url > stream_url */
    const d1 = { page_info: { media_info: {
        mp4_hd_url: 'https://x/hd.mp4', stream_url: 'https://x/sd.mp4' } } };
    eq('E6 优先 mp4_hd_url', Q.pickWeiboHdUrl(d1), 'https://x/hd.mp4');

    const d2 = { page_info: { media_info: {
        stream_url_hd: 'https://x/stream_hd.mp4', mp4_sd_url: 'https://x/sd.mp4' } } };
    eq('E7 退回 stream_url_hd', Q.pickWeiboHdUrl(d2), 'https://x/stream_hd.mp4');

    const d3 = { page_info: { media_info: { mp4_sd_url: 'https://x/sd.mp4' } } };
    eq('E8 再退回 mp4_sd_url', Q.pickWeiboHdUrl(d3), 'https://x/sd.mp4');

    eq('E9 无 media_info 返回空', Q.pickWeiboHdUrl({}), '');
    eq('E10 空对象安全', Q.pickWeiboHdUrl(null), '');

    /* 新版字段优先 */
    const d4 = { page_info: { media_info: {
        mp4_1080p_url: 'https://x/1080.mp4', mp4_hd_url: 'https://x/hd.mp4' } } };
    eq('E11 有 1080p 字段时优先它', Q.pickWeiboHdUrl(d4), 'https://x/1080.mp4');
}

/* ---------- F. HLS master 解析（抄 Video Downloader Plus v4.0.0） ---------- */
{
    const master = [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
        'low/index.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
        'https://cdn.example.com/hd/index.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720',
        '/mid/index.m3u8'
    ].join(String.fromCharCode(10));

    const vs = Q.parseHlsMaster(master, 'https://cdn.example.com/path/master.m3u8');
    eq('F1 解析出 3 个 variant', vs.length, 3);
    eq('F2 相对地址补成绝对',
        vs[0].url, 'https://cdn.example.com/path/low/index.m3u8');
    eq('F3 绝对地址原样', vs[1].url, 'https://cdn.example.com/hd/index.m3u8');
    eq('F4 根路径补全', vs[2].url, 'https://cdn.example.com/mid/index.m3u8');
    eq('F5 解析 RESOLUTION', vs[1].height, 1080);
    eq('F6 解析 BANDWIDTH', vs[1].bandwidth, 5000000);

    const best = Q.pickBestVariant(vs);
    eq('F7 挑出最高清 1080p', best.height, 1080);

    eq('F8 非 m3u8 返回空', Q.parseHlsMaster('not a playlist', ''), []);
    eq('F9 空输入返回空', Q.parseHlsMaster('', ''), []);
    eq('F10 空 variants 挑不出', Q.pickBestVariant([]), null);
}

/* ---------- G. DASH MPD 解析（抄 Video Downloader Pro v0.1.11 的格式覆盖） ---------- */
{
    const mpd = [
        '<?xml version="1.0"?>',
        '<MPD><Period><AdaptationSet mimeType="video/mp4">',
        '<Representation id="v1" bandwidth="800000" width="640" height="360" codecs="avc1"/>',
        '<Representation id="v2" bandwidth="5000000" width="1920" height="1080" codecs="avc1"/>',
        '</AdaptationSet><AdaptationSet mimeType="audio/mp4">',
        '<Representation id="a1" bandwidth="128000" codecs="mp4a"/>',
        '</AdaptationSet></Period></MPD>'
    ].join(String.fromCharCode(10));

    const reps = Q.parseDashMpd(mpd);
    eq('G1 只收视频轨（音频跳过）', reps.length, 2);
    eq('G2 width 不被 bandwidth 误伤', reps[0].width, 640);
    eq('G3 bandwidth 正确', reps[0].bandwidth, 800000);
    eq('G4 解析 height', reps[1].height, 1080);
    eq('G5 挑出最高清', Q.pickBestVariant(reps).id, 'v2');

    eq('G6 非 MPD 返回空', Q.parseDashMpd('<html/>'), []);
    eq('G7 空输入返回空', Q.parseDashMpd(''), []);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
    console.log('失败用例：' + fails.join(', '));
    process.exit(1);
}