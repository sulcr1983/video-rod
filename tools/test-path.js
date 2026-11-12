/* 资源库路径引擎单测（S1a）：node tools/test-path.js
 * 覆盖 平台识别 / 类型推断 / 博主段 / 目录拼装 / 长度保护 / file:// 编码。
 */
'use strict';

/* 按浏览器/内容脚本的真实加载顺序装配全局：
 * path.js 会优先问 VRSiteRegistry（站名优先），拿不到才退回白名单。
 * 这里不加载 registry 的测试仍能验证降级链，但站名相关断言需要它们。 */
const SN = require('../js/site-name.js');
const PP = require('../js/library/site-names-preset.js');
global.VRSiteName = SN;
global.VRSiteNamesPreset = PP;
/* VRSiteNameStore 在 Node 里没有 chrome.storage，给一个空实现即可 */
global.VRSiteNameStore = {
    snapshot: () => null,
    ready: () => Promise.resolve({}),
    peek: () => null,
    nameOf: () => ''
};

const path = require('../js/library/path.js');
const V = path.VRPath || path;
const R = require('../js/library/site-registry.js');
global.VRSiteRegistry = R;

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
eq('博主 都有缺失', V.creatorSegment('', ''), '');
eq('博主 只有 ID', V.creatorSegment('', '946974'), '@946974');

/* ---------- 目录拼装 ----------
 * 2026-11-07 按用户要求调整：
 *   · 图片与视频共用同一作者目录，不再写「视频 / 图片 / 音频」这一段
 *   · 多P / 多集视频在作者下再单独一层
 *   · 未收录站点直接以站点名/域名成一级目录，不再套「其他网页」
 */
eq('目录 B站（不含类型段）',
    V.buildRelDir({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'mp4' }),
    'video-rod/B站/影视飓风(@946974)');

eq('目录 小红书（从 URL 提 ID）',
    V.buildRelDir({ pageUrl: 'https://www.xiaohongshu.com/user/profile/5f8abc', ext: 'jpg' }),
    'video-rod/小红书/@5f8abc');

eq('目录 X（从 URL 提 handle）',
    V.buildRelDir({ pageUrl: 'https://x.com/ken_shoots/status/1', ext: 'mp4' }),
    'video-rod/X/@ken_shoots');

eq('目录 未收录站点（域名成一级）',
    V.buildRelDir({ pageUrl: 'https://example.com/post/1', ext: 'jpg' }),
    'video-rod/example.com');

eq('目录 自定义子目录',
    V.buildRelDir({ subdir: '我的库', pageUrl: 'https://youtu.be/a', ext: 'mp4' }),
    '我的库/YouTube/youtu.be');

eq('目录 音频（与图片视频同层）',
    V.buildRelDir({ pageUrl: 'https://example.com/a', ext: 'm4a' }),
    'video-rod/example.com');

/* 图片与视频必须落在**同一个**目录：这是用户明确的要求 */
eq('图片与视频目录一致',
    V.buildRelDir({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'jpg' }),
    V.buildRelDir({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'mp4' }));

/* 多P：作者目录下再分一层 */
eq('目录 多P 分集',
    V.buildRelDir({
        pageUrl: 'https://www.bilibili.com/video/BV1',
        authorFull: '影视飓风(@946974)', ext: 'mp4', part: '第1话 开场'
    }),
    'video-rod/B站/影视飓风(@946974)/第1话 开场');

/* 站名优先于域名 */
eq('目录 用站名成一级',
    V.buildRelDir({
        pageUrl: 'https://huaban.com/pins/1', siteName: '花瓣',
        authorFull: '某设计师', ext: 'jpg'
    }),
    'video-rod/花瓣/某设计师');

/* 预置表里的站名，即使调用方没传 hint 也能命中 */
eq('目录 预置站名（未传 hint）',
    V.buildRelDir({ pageUrl: 'https://pixso.cn/app/1', authorFull: '团队', ext: 'png' }),
    'video-rod/Pixso/团队');

/* v.qq.com 是独立产品子域，不能并到 qq.com */
eq('目录 独立产品子域',
    V.buildRelDir({ pageUrl: 'https://v.qq.com/x/cover/a.html', authorFull: '腾讯', ext: 'mp4' }),
    'video-rod/腾讯视频/腾讯');

/* ---------- 网页分组（用户 2026-11-07 要求）----------
 * 同一网页的一批图收进以标题命名的子文件夹；
 * 文件名保持原规则「日期_标题.ext」——用户明确要求不要 01/02 这种默认序号，
 * 拿不到标题时走原有回退（站点名 → URL 末段 → 「图片」），不另外造名字。
 */
const PAGE_T = '免费图片网站推荐：摄影、插画和模板去哪找';
eq('网页分组 建子文件夹',
    V.buildRelPath({
        pageUrl: 'https://pixso.cn/a', type: 'image', ext: 'png',
        part: PAGE_T, fileName: '20261107_' + PAGE_T + '_01.png'
    }),
    'video-rod/Pixso/pixso.cn/' + PAGE_T + '/20261107_' + PAGE_T + '_01.png');
eq('网页分组 九张同目录',
    V.buildRelDir({ pageUrl: 'https://pixso.cn/a', ext: 'png', part: PAGE_T }),
    V.buildRelDir({ pageUrl: 'https://pixso.cn/a', ext: 'jpg', part: PAGE_T }));
/* 文件名不做任何改写：即使与文件夹名重复也照原样保留 */
eq('网页分组 文件名原样保留',
    V.buildRelPath({
        pageUrl: 'https://pixso.cn/a', type: 'image', ext: 'png',
        part: PAGE_T, fileName: '20261107_' + PAGE_T + '_09.png'
    }),
    'video-rod/Pixso/pixso.cn/' + PAGE_T + '/20261107_' + PAGE_T + '_09.png');
eq('分组名与站点同名时不重复建层',
    V.buildRelDir({ pageUrl: 'https://douban.com/a', ext: 'jpg', part: '豆瓣' }),
    'video-rod/豆瓣/douban.com');
/* 没有分组时不剥文件名：此时文件名是唯一辨识依据，剥了会只剩日期 */
eq('无分组保留完整文件名',
    V.buildRelPath({
        pageUrl: 'https://pixso.cn/a', type: 'image', ext: 'png',
        fileName: '20261107_某篇文章_01.png'
    }),
    'video-rod/Pixso/pixso.cn/20261107_某篇文章_01.png');

/* ---------- 完整路径与长度 ---------- */
eq('完整路径',
    V.buildRelPath({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'mp4', fileName: '20261024_一次看懂HDR_2160p.mp4' }),
    'video-rod/B站/影视飓风(@946974)/20261024_一次看懂HDR_2160p.mp4');

const longName = '很长的标题'.repeat(40) + '.mp4';
const longRel = V.buildRelPath({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'mp4', fileName: longName });
ok('超长路径被截断到 170 以内', longRel.length <= V.MAX_REL_LEN);
ok('截断后仍保留扩展名', /\.mp4$/.test(longRel));
ok('截断后目录结构不变', longRel.indexOf('video-rod/B站/影视飓风(@946974)/') === 0);

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

/* ---------- 路径反解（入库用） ---------- */
const pr1 = V.parseRelPath('video-rod/B站/影视飓风(@946974)/视频/a.mp4');
eq('反解 平台', pr1.platform, 'bilibili');
eq('反解 平台名', pr1.platformName, 'B站');
eq('反解 博主', pr1.creatorFull, '影视飓风(@946974)');
eq('反解 博主 ID', pr1.creatorId, '946974');
eq('反解 类型', pr1.type, 'video');
eq('反解 文件名', pr1.fileName, 'a.mp4');

/* 老结构「其他网页/<域名>/…」：站点应落到域名上，而不是笼统的 web。
 * 这样历史素材重扫后能自动按站点分组（用户要的「每个网站一个目录」）。 */
const pr2 = V.parseRelPath('video-rod/其他网页/example.com/图片/b.jpg');
eq('反解 老结构站点落到域名', pr2.platform, 'example.com');
eq('反解 老结构站点名', pr2.platformName, 'example.com');
eq('反解 老结构 siteHost', pr2.siteHost, 'example.com');
eq('反解 老结构 博主段不误吞域名',
    V.parseRelPath('video-rod/其他网页/huaban.com/图片/c.jpg').creatorFull, '');

/* 新结构：站名 → 站点 key */
const pr3 = V.parseRelPath('video-rod/花瓣/某设计师/a.jpg');
eq('反解 站名成站点', pr3.platform, 'huaban.com');
eq('反解 新结构 作者', pr3.creatorFull, '某设计师');
eq('反解 新结构 类型按扩展名', pr3.type, 'image');

/* 新结构：多P 层 */
const pr4 = V.parseRelPath('video-rod/B站/影视飓风(@946974)/第1话 开场/a.mp4');
eq('反解 多P 作者', pr4.creatorFull, '影视飓风(@946974)');
eq('反解 多P 分集', pr4.part, '第1话 开场');

/* 域名段直接成站点（未收录站点） */
const pr5 = V.parseRelPath('video-rod/pixso.cn/团队/a.png');
eq('反解 域名成站点', pr5.platform, 'pixso.cn');

eq('反解 无平台段', V.parseRelPath('video-rod/杂项/a.jpg').platform, '');

/* ---------- 多级后缀 / IP ----------
 * 这些直接决定「一个网站一个目录」的边界：砍错一层就会把
 * v.qq.com 并到 qq.com、把 example.com.cn 砍成 com.cn。
 */
eq('域名 huaban.com 不砍',
    SN.registrableDomain('www.huaban.com'), 'huaban.com');
eq('域名 v.qq.com 保留（独立产品子域）',
    SN.registrableDomain('v.qq.com'), 'v.qq.com');
eq('域名 v.qq.com 的子页也保留',
    SN.registrableDomain('v.qq.com'), 'v.qq.com');
eq('域名 example.com.cn 保留三级',
    SN.registrableDomain('a.example.com.cn'), 'example.com.cn');
eq('域名 bbc.co.uk 保留三级',
    SN.registrableDomain('www.bbc.co.uk'), 'bbc.co.uk');
eq('域名 深层子域归并',
    SN.registrableDomain('img.static.pixabay.com'), 'pixabay.com');
eq('域名 IP 原样',
    SN.registrableDomain('127.0.0.1'), '127.0.0.1');
eq('目录 IP 不作站点名',
    /* 站点段已是 127.0.0.1，作者兜底再去重一次 —— 不产生 127.0.0.1/127.0.0.1 */
    V.buildRelDir({ pageUrl: 'http://127.0.0.1:8080/a.jpg', ext: 'jpg' }),
    'video-rod/127.0.0.1');

/* ---------- 优先级链：manual > preset > learned > 域名 ----------
 * 用一个带状态的最小 store 模拟 storage，验证真实优先级。
 */
const presetHit = V.detectSite('https://huaban.com/pins/1');
eq('优先级 未学习时用预置名', presetHit.name, '花瓣');

/* 模拟「自动学习」：registry 读 store.snapshot() */
const learnedStore = { 'huaban.com': { name: 'Huaban', src: 'og', at: 1, manual: 0 } };
global.VRSiteNameStore = {
    snapshot: () => learnedStore,
    ready: () => Promise.resolve(learnedStore),
    peek: (h) => learnedStore[h] || null,
    nameOf: (h) => (learnedStore[h] || {}).name || ''
};
R._reset();
eq('优先级 预置压过自动学习', V.detectSite('https://huaban.com/x').name, '花瓣');

/* 未收录站点：自动学习必须生效（小网站靠这条路） */
learnedStore['small-art.cn'] = { name: '小画室', src: 'title', at: 2, manual: 0 };
R._reset();
eq('优先级 未收录站点用自动学习', V.detectSite('https://small-art.cn/x').name, '小画室');
eq('优先级 未收录站点目录名', V.detectSite('https://small-art.cn/x').dir, '小画室');

/* 手改压过预置 */
learnedStore['huaban.com'] = { name: '花瓣设计', src: 'manual', at: 3, manual: 1 };
R._reset();
eq('优先级 手改压过预置', V.detectSite('https://huaban.com/x').name, '花瓣设计');

/* 三层都没有 → 域名兜底 */
R._reset();
const bare = V.detectSite('https://never-learned.xyz/a');
eq('优先级 全无时用域名', bare.dir, 'never-learned.xyz');
eq('优先级 全无时 name 为空', bare.name, '');

/* ---------- 恢复改名（DEF-02 后续：同名不再判失败） ---------- */
eq('恢复改名 基本形态',
   V.restoreAltName('video-rod/x/NASA/图.webp', 1), 'video-rod/x/NASA/图_restored.webp');
eq('恢复改名 第二次冲突',
   V.restoreAltName('video-rod/x/NASA/图.webp', 2), 'video-rod/x/NASA/图_restored_2.webp');
eq('恢复改名 无扩展名',
   V.restoreAltName('video-rod/x/NASA/README', 1), 'video-rod/x/NASA/README_restored');
eq('恢复改名 隐藏文件不切扩展名',
   V.restoreAltName('video-rod/.gitignore', 1), 'video-rod/.gitignore_restored');
eq('恢复改名 点开头带扩展名',
   V.restoreAltName('video-rod/.env.local', 1), 'video-rod/.env_restored.local');
eq('恢复改名 多点名只切最后一段',
   V.restoreAltName('a/b/c.tar.gz', 1), 'a/b/c.tar_restored.gz');
eq('恢复改名 只有文件名无目录',
   V.restoreAltName('图.jpg', 1), '图_restored.jpg');
eq('恢复改名 空串原样返回', V.restoreAltName('', 1), '');
eq('恢复改名 n 非法回落 1', V.restoreAltName('a.jpg', 0), 'a_restored.jpg');
eq('恢复改名 n 小数取整', V.restoreAltName('a.jpg', 2.9), 'a_restored_2.jpg');

/* ---------- 汇总 ---------- */
console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail) {
    console.log('\n失败明细：');
    fails.forEach((f, i) => console.log(`${i + 1}. ${f}`));
    process.exit(1);
}
