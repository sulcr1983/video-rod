/* 抓图口径离线验证（2026-11-12 B-79）
 *
 * 背景：苏哥微博页 53 张图，「抓图」弹窗只列 2 张、还都是裂图。
 * 根因是 popup 自己抄的扫描器用了「显示尺寸短边 ≥ 600」当门槛，
 * 而信息流图片显示宽就 300~500 —— 一张都过不了。
 *
 * 这个脚本用 fake DOM 复刻那个页面形态，验证修复后的口径
 * （原始像素 ≥100、显示尺寸只挡图标 48px）能全部收进来。
 * 不启动浏览器，所以能进单测门禁，不占实例配额。
 *
 * 跑法：node tools/test-grab-scan.js
 */
'use strict';

const U = require('../js/lib-image-util.js').VRImageUtil || require('../js/lib-image-util.js');

let pass = 0, fail = 0;
const fails = [];
function eq(name, got, expect) {
    const ok = JSON.stringify(got) === JSON.stringify(expect);
    if (ok) { pass++; } else { fail++; fails.push(`${name}\n    got:    ${JSON.stringify(got)}\n    expect: ${JSON.stringify(expect)}`); }
}
function ok(name, cond) {
    if (cond) { pass++; } else { fail++; fails.push(`${name}\n    expect truthy, got ${JSON.stringify(cond)}`); }
}

const BASE = 'https://weibo.com/u/1234';

/** fake <img>：显示尺寸用 box，原始像素用 nw/nh */
function Img(src, nw, nh, sw, sh, attrs) {
    this.tagName = 'IMG';
    this.src = src;
    this.currentSrc = src;
    this.naturalWidth = nw;
    this.naturalHeight = nh;
    this._attrs = Object.assign({ src: src }, attrs || {});
    this._box = { width: sw, height: sh, x: 0, y: 0, right: sw, bottom: sh };
    this.clientWidth = sw;
    this.clientHeight = sh;
    this.parentElement = null;
}
Img.prototype.getAttribute = function (n) {
    return Object.prototype.hasOwnProperty.call(this._attrs, n) ? String(this._attrs[n]) : null;
};
Img.prototype.getBoundingClientRect = function () { return this._box; };
Img.prototype.closest = function () { return null; };

/** fake 背景图节点 */
function Box(bg, sw, sh) {
    this.tagName = 'DIV';
    this._bg = bg;
    this._box = { width: sw, height: sh, x: 0, y: 0, right: sw, bottom: sh };
    this.parentElement = null;
}
Box.prototype.getAttribute = function () { return null; };
Box.prototype.getBoundingClientRect = function () { return this._box; };
Box.prototype.closest = function () { return null; };

function makeDoc(nodes) {
    const doc = {
        _nodes: nodes,
        baseURI: BASE,
        querySelectorAll(sel) {
            // 只需要区分 img 与「背景扫描选择器」两类
            if (/^img$/i.test(sel)) { return nodes.filter(n => n.tagName === 'IMG'); }
            if (/IMG/i.test(sel) && sel.indexOf('img') === 0) { return nodes.filter(n => n.tagName === 'IMG'); }
            return nodes.filter(n => n.tagName !== 'IMG');
        },
        title: '夹具页'
    };
    doc.defaultView = {
        getComputedStyle(el) {
            return { backgroundImage: el._bg || 'none' };
        }
    };
    doc.documentElement = { baseURI: BASE };
    return doc;
}

/* ---------------- 复刻微博信息流的形态 ----------------
 * 5 张「显示小、原图大」：显示 320×240，原图 800×600 —— 老门槛全砍
 * 1 张图标 32×32 显示：应当被挡
 * 1 张占位 src + data-src：应当回退到 data-src 收进来
 */
const nodes = [
    new Img('https://wx1.sinaimg.cn/mw690/a.jpg', 800, 600, 320, 240),
    new Img('https://wx2.sinaimg.cn/mw690/b.jpg', 900, 700, 300, 233),
    new Img('https://wx3.sinaimg.cn/mw690/c.jpg', 1024, 768, 320, 240),
    new Img('https://wx4.sinaimg.cn/mw690/d.jpg', 1200, 800, 320, 213),
    new Img('https://wx1.sinaimg.cn/mw690/e.jpg', 700, 900, 240, 308),
    // 图标：显示 32×32，原图也小
    new Img('https://wx1.sinaimg.cn/thumb150/icon.jpg', 40, 40, 32, 32),
    // 真占位型懒加载：src 是 1×1，真图在 data-src
    new Img('https://weibo.com/img/1x1.png', 1, 1, 320, 240, { 'data-src': 'https://wx3.sinaimg.cn/mw690/f.jpg' }),
    // CSS 背景图（信息流封面）
    new Box('url("https://wx2.sinaimg.cn/mw690/g.jpg")', 420, 300)
];

const doc = makeDoc(nodes);

/* 修复后的调用参数（与 popup / 侧栏清单一致） */
const imgs = U.scanImages(doc, { minWidth: 100, minHeight: 100, minShow: U.PANEL_MIN_SHOW, dedupe: true });
const bgs = U.scanBackgrounds(doc, { minShow: U.PANEL_MIN_SHOW, dedupe: true });

const all = imgs.concat(bgs).map(x => x.url);

eq('显示小/原图大 5 张全部收进来', imgs.length, 6);   // 5 张 + 1 张占位回退
ok('背景图收进来', bgs.length === 1);
eq('总计 7 张', all.length, 7);
ok('图标被挡（32×32 显示 / 40×40 原图）', !all.some(u => u.indexOf('icon') >= 0));
ok('占位 1x1 没混入', !all.some(u => u.indexOf('1x1') >= 0));
ok('占位图回退到 data-src', all.some(u => u.indexOf('/f.jpg') >= 0));
ok('背景图地址正确', all.some(u => u.indexOf('/g.jpg') >= 0));

/* 老门槛对照：判的是**显示尺寸**短边 ≥600。
 * 这页图片显示 320×240 左右 → 一张都过不了，这就是苏哥看到的「只剩广告位」。 */
function oldGate(list) {
    return list.filter(x => Math.min(x.clientWidth || 0, x.clientHeight || 0) >= 600);
}
eq('老门槛（显示短边≥600）一张都收不到', oldGate(nodes.filter(n => n.tagName === 'IMG')).length, 0);

/* 微博原图升级：候选首位必须是 /large/ */
const first = imgs.find(x => x.url.indexOf('/mw690/a.jpg') >= 0);
ok('原图候选排第一', first && first.candidates[0] === 'https://wx1.sinaimg.cn/large/a.jpg');
eq('候选里同时保留显示地址', first && first.candidates[1], 'https://wx1.sinaimg.cn/mw690/a.jpg');

/* ---------------- 未解码图也要按显示尺寸过滤（2026-11-18） ----------------
 * 真机证据（t66y，同一页面连扫 6 次）：
 *   修复前：15 → 17 → 16 → 19 → 18 → 17 条（并集 20，每次都出现的只有 12）
 *   修复后：11 → 12 → 12 → 12 → 12 条
 * 差异来自「站点图标这类**不懒加载**的图」：首扫时还没解码（naturalWidth=0），
 * 原来直接跳过尺寸门槛 → 收进清单；后续扫描解码完成 → 又被挡掉。
 * 用户看到的就是「第一次 15 张，之后 12 张」，以为嗅探不准。
 *
 * 判据改用 **CSS 显示尺寸**（getBoundingClientRect）：DOM 一就绪就确定，
 * 与图片是否下载完无关。
 */
{
    const lazyDoc = makeDoc([
        /* 未解码 + 显示 32×32 的站点图标 → 必须挡（原来会混进来） */
        new Img('https://cdn.example.com/icon-32.png', 0, 0, 32, 32),
        /* 未解码 + 显示 980×620 的正文大图 → 必须留 */
        new Img('https://cdn.example.com/body-big.jpg', 0, 0, 980, 620),
        /* 未解码 + 显示很小，但有 data-src 懒加载兜底 → 必须留（真图在后面） */
        new Img('https://cdn.example.com/1x1.gif', 0, 0, 24, 24,
            { 'data-src': 'https://cdn.example.com/real-large.jpg' }),
        /* 未解码 + 显示 1200×120 的细长横幅 → 长宽比 10 > 6，必须挡 */
        new Img('https://cdn.example.com/banner-thin.png', 0, 0, 1200, 120)
    ]);
    const got = U.scanImages(lazyDoc, {
        minWidth: 100, minHeight: 100, minShow: U.PANEL_MIN_SHOW, dedupe: true
    }).map(x => x.url);

    ok('未解码的小图标被挡（尺寸未解码不等于放行）',
        !got.some(u => u.indexOf('icon-32') >= 0));
    ok('未解码的正文大图保留',
        got.some(u => u.indexOf('body-big') >= 0));
    ok('未解码但有 data-src 的懒加载图保留',
        got.some(u => u.indexOf('real-large') >= 0));
    ok('未解码的细长横幅被挡（长宽比超限）',
        !got.some(u => u.indexOf('banner-thin') >= 0));
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail) {
    console.log('\n失败明细：');
    fails.forEach((f, i) => console.log(`${i + 1}. ${f}`));
    process.exit(1);
}
