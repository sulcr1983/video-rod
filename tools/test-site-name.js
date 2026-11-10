#!/usr/bin/env node
/* 站点名称链路单测：node tools/test-site-name.js
 *
 * 覆盖三块纯逻辑（全部不联网、不碰 chrome.*）：
 *   1. site-name.js    —— 页面提取优先级、噪音清洗、可注册域名、HTML 解析
 *   2. site-registry.js —— manual > preset > learned > 域名，重名去重
 *   3. indexer 推断     —— 按目录路径反解站点/作者，老 web 结构自动纠正
 *
 * 为什么单列一个文件：这三块决定「下载落到哪个目录」「左栏怎么分组」，
 * 任何一处回退都会让用户看到一堆 huaban.com 而不是「花瓣」。
 */
'use strict';

const path = require('path');

/* 按浏览器/内容脚本的真实加载顺序装配全局。
 * indexer.js 与 path.js 都用 `typeof self !== 'undefined' ? self : this` 找 root，
 * Node 里必须先把 self 指到 globalThis，否则它们挂在 module.exports 上、
 * 彼此看不见对方的模块。 */
global.self = global;

const ROOT = path.join(__dirname, '..');
const SN = require(path.join(ROOT, 'js', 'site-name.js'));
global.VRSiteName = SN;

const PP = require(path.join(ROOT, 'js', 'library', 'site-names-preset.js'));
global.VRSiteNamesPreset = PP;

/* 可切换的 store：默认空，用例里按需要替换 snapshot */
let learned = {};
global.VRSiteNameStore = {
    snapshot: () => learned,
    ready: () => Promise.resolve(learned),
    peek: (h) => learned[h] || null,
    nameOf: (h) => (learned[h] || {}).name || '',
    normHost: (h) => String(h || '').toLowerCase().replace(/^www\./, '')
};

const V = require(path.join(ROOT, 'js', 'library', 'path.js')).VRPath;
global.VRPath = V;

const R = require(path.join(ROOT, 'js', 'library', 'site-registry.js'));
global.VRSiteRegistry = R;

/* indexer.js 用 `typeof self !== 'undefined' ? self : this` 找 root；
 * 上面已把 self 指向 globalThis，所以它挂在 global 上，不在 module.exports。 */
require(path.join(ROOT, 'js', 'library', 'indexer.js'));
const I = global.VRIndex;

let pass = 0, fail = 0;
const fails = [];

function eq(name, got, expect) {
    const ok = JSON.stringify(got) === JSON.stringify(expect);
    if (ok) { pass++; return; }
    fail++;
    fails.push(`${name}\n    got:    ${JSON.stringify(got)}\n    expect: ${JSON.stringify(expect)}`);
}
function ok(name, cond) {
    if (cond) { pass++; return; }
    fail++;
    fails.push(`${name}\n    expect truthy: ${JSON.stringify(cond)}`);
}

function section(title) { console.log('\n[' + title + ']'); }

/* ================= 1. 可注册域名 ================= */
section('可注册域名');

eq('普通域名', SN.registrableDomain('www.huaban.com'), 'huaban.com');
eq('v.qq.com 独立保留', SN.registrableDomain('v.qq.com'), 'v.qq.com');
eq('com.cn 保留三级', SN.registrableDomain('a.example.com.cn'), 'example.com.cn');
eq('co.uk 保留三级', SN.registrableDomain('www.bbc.co.uk'), 'bbc.co.uk');
eq('深层子域归并', SN.registrableDomain('img.static.pixabay.com'), 'pixabay.com');
eq('IPv4 原样', SN.registrableDomain('127.0.0.1'), '127.0.0.1');
eq('localhost 原样', SN.registrableDomain('localhost'), 'localhost');

/* ================= 2. 站名清洗 ================= */
section('站名清洗');

eq('剥「官方网站」', SN.cleanName('花瓣网 - 官方网站'), '花瓣网');
eq('剥 Home', SN.cleanName('Unsplash | Home'), 'Unsplash');
eq('纯噪音判空', SN.cleanName('首页'), '');
eq('超长判空', SN.cleanName('x'.repeat(31)), '');
eq('纯符号判空', SN.cleanName('---'), '');
eq('去 emoji', SN.cleanName('Pixabay 🎨'), 'Pixabay');
eq('日文保留', SN.cleanName('ニコニコ'), 'ニコニコ');
eq('韩文保留', SN.cleanName('네이버'), '네이버');

/* ================= 3. title 提取（真实站点形态） ================= */
section('title 提取');

eq('花瓣网 - 灵感之源…', SN.fromTitle('花瓣网 - 灵感之源，花瓣之间（创意图片大全）', 'huaban.com'), '花瓣网');
eq('知乎 - 有问题…', SN.fromTitle('知乎 - 有问题，就会有答案', 'zhihu.com'), '知乎');
eq('豆瓣（单段）', SN.fromTitle('豆瓣', 'douban.com'), '豆瓣');
eq('GitHub · Change is constant', SN.fromTitle('GitHub · Change is constant', 'github.com'), 'GitHub');
eq('序号不当站名', SN.fromTitle('标题 - 01', 'huaban.com'), '');
eq('单段过长判空', SN.fromTitle('这是一个非常非常长的单段标题不应该当站名', 'a.com'), '');

/* ================= 4. 页面提取优先级 ================= */
section('页面提取优先级');

function fakeDoc(map, title) {
    return {
        title: title || '',
        baseURI: 'https://example.com/',
        querySelector(sel) { return map[sel] || null; },
        querySelectorAll(sel) { return map['all:' + sel] || []; }
    };
}
function meta(content) { return { getAttribute: () => content }; }

eq('og:site_name 最优先',
    SN.screen(fakeDoc({ 'meta[property="og:site_name"]': meta('花瓣网') }, 'x'), 'https://huaban.com/').name,
    '花瓣网');
eq('application-name 次之',
    SN.screen(fakeDoc({ 'meta[name="application-name"]': meta('Pixso') }, 'x'), 'https://pixso.cn/').name,
    'Pixso');
eq('apple 标题第三',
    SN.screen(fakeDoc({ 'meta[name="apple-mobile-web-app-title"]': meta('Pixabay') }, 'x'), 'https://pixabay.com/').name,
    'Pixabay');
eq('取不到返回空（不拿域名冒充）',
    SN.screen(fakeDoc({}, ''), 'https://unknown-site.xyz/a').name,
    '');

/* ================= 5. 后台 HTML 解析（无 DOM） ================= */
section('HTML 解析');

const html1 = '<html><head><meta property="og:site_name" content="Pixso" /><title>设计</title></head></html>';
eq('HTML og:site_name', SN.parseHtmlInfo(html1, 'https://pixso.cn/').name, 'Pixso');

const html2 = '<html><head><title>知乎 - 有问题，就会有答案</title></head></html>';
eq('HTML 只有 title', SN.parseHtmlInfo(html2, 'https://zhihu.com/').name, '知乎');

const html3 = '<html><head><meta content="花瓣网" property="og:site_name"/></head></html>';
eq('HTML 属性顺序无关', SN.parseHtmlInfo(html3, 'https://huaban.com/').name, '花瓣网');

eq('HTML 无声明返回空', SN.parseHtmlInfo('<html><head><title></title></head></html>', 'https://x.com/').name, '');

/* ================= 6. 优先级链 ================= */
section('优先级链');

learned = {};
R._reset();
eq('预置命中', R.detect('https://huaban.com/x').name, '花瓣');
eq('预置来源', R.detect('https://huaban.com/x').src, 'preset');
eq('未收录用域名', R.detect('https://never.xyz/a').dir, 'never.xyz');

learned = { 'huaban.com': { name: 'Huaban', src: 'og', at: 1 } };
R._reset();
eq('预置压过自动学习', R.detect('https://huaban.com/x').name, '花瓣');

learned = { 'small-art.cn': { name: '小画室', src: 'title', at: 2 } };
R._reset();
eq('未收录站用自动学习', R.detect('https://small-art.cn/x').name, '小画室');
eq('自动学习的目录名', R.detect('https://small-art.cn/x').dir, '小画室');

learned = { 'huaban.com': { name: '花瓣设计', src: 'manual', at: 3, manual: 1 } };
R._reset();
eq('手改压过预置', R.detect('https://huaban.com/x').name, '花瓣设计');
eq('手改来源', R.detect('https://huaban.com/x').src, 'manual');

/* 重名：不同站点同名 → 双方都加域名后缀 */
learned = {
    'a-site.com': { name: '图片站', src: 'manual', at: 4, manual: 1 },
    'b-site.com': { name: '图片站', src: 'manual', at: 5, manual: 1 }
};
R._reset();
eq('重名目录带后缀', R.detect('https://a-site.com/x').dir, '图片站 (a-site.com)');
eq('重名仍显示原名', R.detect('https://a-site.com/x').name, '图片站');

/* 同站点多域名不互相冲突（B站 的 bilibili.com / b23.tv） */
learned = {};
R._reset();
eq('同站多域名不拆开', R.detect('https://bilibili.com/x').dir, 'B站');
eq('b23.tv 同目录', R.detect('https://b23.tv/x').dir, 'B站');

/* nameOf/dirOf 域名归一（2026-11-10 BUG-2）：
 * 库里老条目的 platform 可能是 www. 开头，而字典键是归一后的可注册域名。 */
learned = { 'bizhi66.com': { name: '4k壁纸', src: 'title', at: 6 } };
R._reset();
eq('www 前缀命中预置表', R.nameOf('www.xiaohongshu.com'), '小红书');
eq('www 前缀命中自动学习', R.nameOf('www.bizhi66.com'), '4k壁纸');
eq('www 前缀 dirOf', R.dirOf('www.bizhi66.com'), '4k壁纸');
eq('子域归并命中', R.nameOf('img.static.bizhi66.com'), '4k壁纸');
eq('带协议与路径也能归一', R.nameOf('https://www.bizhi66.com/a/b'), '4k壁纸');
eq('老平台 key 别名不回归', R.nameOf('weibo'), '微博');
eq('v.qq.com 独立产品不被误并', R.nameOf('v.qq.com'), '腾讯视频');
eq('确实未知的域名仍返回空', R.nameOf('never-seen.xyz'), '');

/* ================= 7. 目录拼装 ================= */
section('目录拼装');

learned = {};
R._reset();

eq('图片视频同目录',
    V.buildRelDir({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'jpg' }),
    V.buildRelDir({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'mp4' }));
eq('B站 目录', V.buildRelDir({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'mp4' }),
    'video-rod/B站/影视飓风(@946974)');
eq('多P 分层', V.buildRelDir({
    pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'mp4', part: '第1话 开场'
}), 'video-rod/B站/影视飓风(@946974)/第1话 开场');
eq('未收录站域名成一级', V.buildRelDir({ pageUrl: 'https://example.com/post/1', ext: 'jpg' }), 'video-rod/example.com');
eq('站名优先', V.buildRelDir({
    pageUrl: 'https://huaban.com/pins/1', siteName: '花瓣', authorFull: '某设计师', ext: 'jpg'
}), 'video-rod/花瓣/某设计师');

/* ================= 8. 路径反解 ================= */
section('路径反解');

const pr1 = V.parseRelPath('video-rod/B站/影视飓风(@946974)/第1话 开场/a.mp4');
eq('反解 站点', pr1.platform, 'bilibili');
eq('反解 作者', pr1.creatorFull, '影视飓风(@946974)');
eq('反解 作者ID', pr1.creatorId, '946974');
eq('反解 分P', pr1.part, '第1话 开场');
eq('反解 类型按扩展名', pr1.type, 'video');

const pr2 = V.parseRelPath('video-rod/其他网页/huaban.com/图片/b.jpg');
eq('老结构 站点落到域名', pr2.platform, 'huaban.com');
eq('老结构 博主段不误吞域名', pr2.creatorFull, '');

const pr3 = V.parseRelPath('video-rod/花瓣/某设计师/a.jpg');
eq('站名反解成 key', pr3.platform, 'huaban.com');

/* ================= 9. 索引按目录推断（不联网） ================= */
section('索引推断');

const e1 = I._entryFromRel('video-rod/花瓣/某设计师/a.jpg', '', 100, 1);
eq('索引 站点', e1.platform, 'huaban.com');
eq('索引 站点显示名', e1.platformName, '花瓣');
eq('索引 作者（来自目录）', e1.creatorFull, '某设计师');
eq('索引 不算未整理', e1.untracked, 0);
eq('索引 类型', e1.type, 'image');

const e2 = I._entryFromRel('video-rod/其他网页/huaban.com/图片/b.jpg', '', 1, 1);
eq('老 web 结构纠正为域名', e2.platform, 'huaban.com');
eq('老 web 结构显示名换人话', e2.platformName, '花瓣');

learned = { 'small-art.cn': { name: '小画室', src: 'title', at: 1 } };
R._reset();
const e3 = I._entryFromRel('video-rod/小画室/作者B/c.jpg', '', 1, 1);
eq('学习过的站名 → key', e3.platform, 'small-art.cn');
eq('学习过的站名 → 显示名', e3.platformName, '小画室');
eq('学习过的站名 作者仍在', e3.creatorFull, '作者B');

learned = {};
R._reset();
eq('platformNameOf 本地预置', I._platformNameOf('bilibili'), 'B站');
eq('platformNameOf 域名', I._platformNameOf('huaban.com'), '花瓣');

/* ================= 10. 历史目录映射（磁盘整理） ================= */
section('历史目录映射');

require(path.join(ROOT, 'js', 'library', 'migrate.js'));
const M = global.VRMigrate;

function remap(rel) {
    const r = M.remapRelPath(rel);
    return r ? r.to : null;
}

/* 老结构「其他网页/域名/类型」→ 站名（用户选定：已收录用站名，未收录用域名） */
eq('映射 其他网页/域名 → 站名',
    remap('video-rod/其他网页/huaban.com/图片/x_01.jpg'),
    'video-rod/花瓣/x_01.jpg');
eq('映射 未收录域名保持域名',
    remap('video-rod/其他网页/example.com/图片/h.jpg'),
    'video-rod/example.com/h.jpg');
eq('映射 去类型层',
    remap('video-rod/B站/影视飓风(@946974)/视频/a.mp4'),
    'video-rod/B站/影视飓风(@946974)/a.mp4');
/* 英文老目录合并到中文站名 */
eq('映射 英文别名合并（xiaohongshu）',
    remap('video-rod/xiaohongshu/星球档案馆(@6ac)/images/b.webp'),
    'video-rod/小红书/星球档案馆(@6ac)/b.webp');
eq('映射 英文别名合并（instagram）',
    remap('video-rod/instagram/NASA/images/f.jpg'),
    'video-rod/Instagram/NASA/f.jpg');
/* 冗余重复层拍平 */
eq('映射 拍平 微博/weibo',
    remap('video-rod/微博/weibo/视频/c.mp4'),
    'video-rod/微博/c.mp4');
eq('映射 拍平 小红书/xiaohongshu',
    remap('video-rod/小红书/xiaohongshu/图片/e.jpg'),
    'video-rod/小红书/e.jpg');
eq('映射 拍平 域名占作者位',
    remap('video-rod/pixso.cn/pixso.cn/图片/d.png'),
    'video-rod/Pixso/d.png');
/* 已在目标结构 → 不动 */
eq('映射 已合规不动',
    remap('video-rod/花瓣/某设计师/e.jpg'), null);
eq('映射 认不出不动',
    remap('video-rod/杂项/a.jpg'), null);

/* ---------- 无子目录前缀（磁盘实测最常见形态）----------
 * 2026-11-07 实测：老文件大多相对资源库根、不带 video-rod/ 前缀，
 * 旧实现假定首段是子目录，结果 18 个视频全部被判「原地不动」。
 */
eq('映射 无前缀 B站 视频',
    remap('B站/人民空军(@360421127)/视频/a.mp4'),
    'B站/人民空军(@360421127)/a.mp4');
eq('映射 无前缀 YouTube',
    remap('YouTube/Exploropia/视频/b.mp4'),
    'YouTube/Exploropia/b.mp4');
eq('映射 无前缀 X',
    remap('x/NASA(@NASA)/videos/c.mp4'),
    'X/NASA(@NASA)/c.mp4');
eq('映射 无前缀 小红书英文目录',
    remap('xiaohongshu/星球档案馆(@6ac)/videos/d.mp4'),
    '小红书/星球档案馆(@6ac)/d.mp4');
/* 作者位是「同站点域名」→ 拍平（www.instagram.com / weibo.com） */
eq('映射 拍平 域名占作者位（www）',
    remap('instagram/www.instagram.com/视频/e.mp4'),
    'Instagram/e.mp4');
eq('映射 拍平 域名占作者位（weibo.com）',
    remap('微博/weibo.com/视频/f.mp4'),
    '微博/f.mp4');
/* 「其他网页」容器段要去掉，站点段换成人话名字 */
eq('映射 其他网页去容器段（v.qq.com）',
    remap('其他网页/v.qq.com/视频/g.mp4'),
    '腾讯视频/g.mp4');
eq('映射 已在目标结构（无前缀）',
    remap('小红书/数字物种志/h.mp4'), null);

/* ================= 汇总 ================= */
console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail) {
    console.log('\n失败明细：');
    fails.forEach((f, i) => console.log(`${i + 1}. ${f}`));
    process.exit(1);
}
console.log('ALL_PASS');
