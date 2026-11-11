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

/* ---------- H. 字节分片地址还原（苏哥 2026-11-09「MSN 下载不了」） ----------
 * 播放器把单个 MP4 按字节切片反复拉（206 + Content-Range），
 * 直接下这个地址只会得到碎片。必须剥掉分片参数向同一地址要完整文件。
 * 铁律：只在确认是分片时才动手，签名参数一律保留。 */
{
    // 实测 MSN：https://msn2.go2yd.com/video/xxx.mp4_bd.mp4?start=0&end=15&_t=1794229126342
    const h1 = Q.unsegmentUrl('https://msn2.go2yd.com/video/abc.mp4_bd.mp4?start=0&end=15&_t=1794229126342');
    eq('H1 MSN 分片→识别', h1.segmented, true);
    eq('H2 MSN 分片→还原干净地址', h1.url, 'https://msn2.go2yd.com/video/abc.mp4_bd.mp4');
    eq('H3 MSN 分片→记录剥掉的键', h1.removed.sort(), ['_t', 'end', 'start']);

    // Instagram：bytestart/byteend 是分片，但 efg/oh 是签名，必须留
    const h4 = Q.unsegmentUrl('https://scontent.cdninstagram.com/v/t50/x.mp4?bytestart=0&byteend=99999&efg=AbCdEf&oh=0123abcd');
    eq('H4 IG 分片→识别', h4.segmented, true);
    eq('H5 IG 分片→保留签名参数', h4.url, 'https://scontent.cdninstagram.com/v/t50/x.mp4?efg=AbCdEf&oh=0123abcd');

    // 只有 start 没有 end：可能是业务参数（播放起点），不许动
    const h6 = Q.unsegmentUrl('https://x.com/v.mp4?start=30');
    eq('H6 单个 start 不动', h6.segmented, false);
    eq('H7 单个 start 原样返回', h6.url, 'https://x.com/v.mp4?start=30');

    // start/end 不是纯数字（ISO 时间戳等）：不是字节分片，不许动
    const h8 = Q.unsegmentUrl('https://x.com/v.mp4?start=2026-11-09T00:00:00Z&end=2026-11-10T00:00:00Z');
    eq('H8 非数字 start/end 不动', h8.segmented, false);

    // end <= start：不是有效的字节区间，不许动
    const h9 = Q.unsegmentUrl('https://x.com/v.mp4?start=100&end=50');
    eq('H9 区间非法不动', h9.segmented, false);

    // 普通签名地址（B站/抖音）：一个参数都不能少
    const h10 = Q.unsegmentUrl('https://upos.example.com/v.mp4?a=6383&mime_type=video_mp4&token=abc');
    eq('H10 普通地址不动', h10.segmented, false);
    eq('H11 普通地址原样返回', h10.url, 'https://upos.example.com/v.mp4?a=6383&mime_type=video_mp4&token=abc');

    // range=0-1234 的 query 形式
    const h12 = Q.unsegmentUrl('https://cdn.x.com/v.mp4?range=0-1048575&sig=zzz');
    eq('H12 range 形式→识别', h12.segmented, true);
    eq('H13 range 形式→剥 range 留签名', h12.url, 'https://cdn.x.com/v.mp4?sig=zzz');

    // 无 query / 空串 / 非 http：一律原样
    eq('H14 无 query 不动', Q.unsegmentUrl('https://x.com/v.mp4').segmented, false);
    eq('H15 空串不动', Q.unsegmentUrl('').url, '');
    eq('H16 blob: 不动', Q.unsegmentUrl('blob:https://x.com/abc').segmented, false);

    // 带 hash 的地址：hash 要留在末尾
    const h17 = Q.unsegmentUrl('https://x.com/v.mp4?bytestart=0&byteend=9#t=3');
    eq('H18 分片还原保留 hash', h17.url, 'https://x.com/v.mp4#t=3');
}

/* ---------- I. 同媒体变体（苏哥 2026-11-09「MSN 下不了」的根因） ----------
 * 原始直链有签名墙，转码变体免签。实测：xxx.mp4 → 403，xxx.mp4_bd.mp4 → 206 完整。 */
{
    eq('I1 mp4 变体', Q.variantUrls('https://msn2.go2yd.com/video/abc.mp4'),
        ['https://msn2.go2yd.com/video/abc.mp4_bd.mp4']);
    eq('I2 带 query 时先剥掉', Q.variantUrls('https://cdn.x.com/v/abc.mp4?token=1'),
        ['https://cdn.x.com/v/abc.mp4_bd.mp4']);
    eq('I3 webm 也适用', Q.variantUrls('https://x.com/a.webm'),
        ['https://x.com/a.webm_bd.webm']);
    eq('I4 m3u8 不适用（清单不是文件）', Q.variantUrls('https://x.com/a.m3u8'), []);
    eq('I5 无扩展名不适用', Q.variantUrls('https://x.com/video/tos/abc'), []);
    eq('I6 空串', Q.variantUrls(''), []);
    eq('I7 非 http', Q.variantUrls('blob:https://x.com/a.mp4'), []);
}

// J 段：两段式选源（2026-11-11 苏哥报「小红书下到的不是我点那个视频」）
(async function () {
    console.log('');
    // J1 同族（同 pathname，换 CDN 节点/码率）→ 仍归到「正在播放」这一条，且族内取最高
    {
        const playing = 'https://sns-video-ak.xhscdn.com/stream/1/110/268/abc_268.mp4?sign=x';
        const list = [
            { url: 'https://sns-video-bd.xhscdn.com/stream/1/110/268/other_4k.mp4', height: 2160, size: 900 },
            { url: playing, height: 720, size: 100 },
            { url: 'https://sns-video-bd.xhscdn.com/stream/1/110/268/abc_268.mp4', height: 1080, size: 300 }
        ];
        const out = Q.prioritizePlaying(list, playing);
        eq('J1 同族排前且族内取最高（换节点也算同一条）',
            [out[0].height, out[1].height, out[2].height], [1080, 720, 2160]);
    }
    // J2 跨素材：正在播放的是 A（低清），B 是 4K —— A 必须排第一（这是「下错」的核心）
    {
        const playing = 'https://sns-video-ak.xhscdn.com/stream/1/110/268/aaa_268.mp4';
        const list = [
            { url: 'https://sns-video-bd.xhscdn.com/stream/1/110/999/bbb_4k.mp4', height: 2160, size: 9000 },
            { url: playing, height: 720, size: 100 }
        ];
        const out = Q.prioritizePlaying(list, playing);
        eq('J2 正在播放的 A 压过更高清的 B', out[0].url, playing);
    }
    // J3 没有 playing → 保持全局按分辨率（老行为，别退化）
    {
        const list = [
            { url: 'https://a.com/1.mp4', height: 720, size: 10 },
            { url: 'https://a.com/2.mp4', height: 1080, size: 20 }
        ];
        const out = Q.prioritizePlaying(list, '');
        eq('J3 无 playing 时按分辨率降序', out[0].height, 1080);
    }
    // J4 playing 是 MSE blob → 不该崩，也不该把列表清空
    {
        const list = [{ url: 'https://a.com/1.mp4', height: 720, size: 10 }];
        const out = Q.prioritizePlaying(list, 'blob:https://www.xiaohongshu.com/abc');
        eq('J4 blob playing 不崩且列表不丢', out.length, 1);
    }
    // J5 familyKey 归一各种 CDN 节点
    {
        const a = Q.familyKey('https://sns-video-ak.xhscdn.com/stream/1/abc.mp4');
        const b = Q.familyKey('https://sns-video-bd.xhscdn.com/stream/1/abc.mp4?sign=2');
        const c = Q.familyKey('https://sns-video-bd.xhscdn.com/stream/1/zzz.mp4');
        ok('J5a 同 pathname 不同节点 → 同族', a === b, a + ' vs ' + b);
        ok('J5b 不同 pathname → 不同族', b !== c);
        const p1 = Q.familyKey('https://p3-pc-sign.douyinpic.com/tos-cn-i/x/video.mp4');
        const p2 = Q.familyKey('https://p9-pc-sign.douyinpic.com/tos-cn-i/x/video.mp4');
        ok('J5c 抖音图床节点归一', p1 === p2, p1 + ' vs ' + p2);
        const w1 = Q.familyKey('https://wx1.sinaimg.cn/large/a.mp4');
        const w2 = Q.familyKey('https://wx4.sinaimg.cn/large/a.mp4');
        ok('J5d 微博图床节点归一', w1 === w2, w1 + ' vs ' + w2);
    }
    // K 段：文档归属键（嗅探缓存按 tab 累积，SPA 切内容不清 → 必须按文档过滤）
    {
        const A = 'https://www.xiaohongshu.com/explore/6af2f64d000000002b01a0b6?xsec_token=AAA&xsec_source=pc_feed';
        const A2 = 'https://www.xiaohongshu.com/explore/6af2f64d000000002b01a0b6?xsec_token=BBB';
        const B = 'https://www.xiaohongshu.com/explore/6ae5e4fd0000000025013c39?xsec_token=AAA';
        ok('K1 同一篇笔记换 token → 同键', Q.docKey(A) === Q.docKey(A2), Q.docKey(A));
        ok('K2 不同笔记 → 不同键', Q.docKey(A) !== Q.docKey(B));
        eq('K3 小红书笔记键忽略 token', Q.docKey(A),
            'xiaohongshu.com/explore/6af2f64d000000002b01a0b6');
        const Y1 = 'https://www.youtube.com/watch?v=abc123&t=30';
        const Y2 = 'https://www.youtube.com/watch?v=abc123&list=xyz';
        const Y3 = 'https://www.youtube.com/watch?v=zzz999';
        ok('K4 YouTube 同视频不同参数 → 同键', Q.docKey(Y1) === Q.docKey(Y2), Q.docKey(Y1));
        ok('K5 YouTube 不同视频 → 不同键', Q.docKey(Y1) !== Q.docKey(Y3));
        ok('K6 微博同页不同滚动位置 → 同键',
            Q.docKey('https://weibo.com/u/123?page=2') === Q.docKey('https://weibo.com/u/123'),
            Q.docKey('https://weibo.com/u/123?page=2'));
        ok('K7 www 前缀归一', Q.docKey('https://www.douyin.com/video/123') === Q.docKey('https://douyin.com/video/123'));
        eq('K8 非 http 返回空', Q.docKey('blob:https://x.com/a'), '');
        eq('K9 垃圾输入不崩', Q.docKey(''), '');
    }

    // J6 空输入
    eq('J6a 空列表', Q.prioritizePlaying([], 'https://a.com/1.mp4'), []);
    eq('J6b 空 playing 空列表', Q.prioritizePlaying(null, ''), []);

    console.log('');
    console.log(pass + ' passed, ' + fail + ' failed');
    if (fail) {
        console.log('失败用例：' + fails.join(', '));
        process.exit(1);
    }
})();
