/* 图片工具单测（I1）：node tools/test-image-util.js
 * 覆盖 URL 规范化 / srcset / 扩展名 / 占位与格式判断 / 五级候选 / 扫描过滤。
 * 用手写 fake 元素，不引 jsdom。
 */
'use strict';

const U = require('../js/lib-image-util.js').VRImageUtil || require('../js/lib-image-util.js');

const BASE = 'https://example.com/post/1';

let pass = 0, fail = 0;
const fails = [];

function eq(name, got, expect) {
    const ok = got === expect;
    if (ok) { pass++; } else { fail++; fails.push(`${name}\n    got:    ${JSON.stringify(got)}\n    expect: ${JSON.stringify(expect)}`); }
}
function ok(name, cond) {
    if (cond) { pass++; } else { fail++; fails.push(`${name}\n    expect truthy: ${JSON.stringify(cond)}`); }
}
function arr(name, got, expect) {
    const a = JSON.stringify(got), b = JSON.stringify(expect);
    const good = a === b;
    if (good) { pass++; } else { fail++; fails.push(`${name}\n    got:    ${a}\n    expect: ${b}`); }
}

/* ---------------- fake DOM ---------------- */
function El(tag, attrs, parent) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = attrs || {};
    this.parentElement = parent || null;
    this.children = [];
    if (parent) { parent.children.push(this); }
}
El.prototype.getAttribute = function (name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? String(this.attrs[name]) : null;
};
El.prototype.closest = function (sel) {
    const wantA = /^a\[href\]$/i.test(sel);
    let n = this;
    while (n) {
        if (wantA) {
            if (n.tagName === 'A' && n.attrs.href != null && String(n.attrs.href) !== '') { return n; }
        } else if (n.tagName === String(sel).toUpperCase()) {
            return n;
        }
        n = n.parentElement;
    }
    return null;
};

function abs(u) {
    try { return new URL(u, BASE).href; } catch (e) { return u; }
}

function makeImg(attrs) {
    const a = attrs || {};
    const el = new El('img', a, a.parent || null);
    el.src = a.src ? abs(a.src) : '';
    el.srcset = a.srcset || '';
    el.currentSrc = a.currentSrc != null ? (a.currentSrc ? abs(a.currentSrc) : '') : el.src;
    el.naturalWidth = a.nw == null ? 0 : a.nw;
    el.naturalHeight = a.nh == null ? 0 : a.nh;
    el.width = a.cw == null ? 0 : a.cw;
    el.height = a.ch == null ? 0 : a.ch;
    return el;
}

function makeDoc(imgs) {
    return {
        baseURI: BASE,
        location: { href: BASE },
        querySelectorAll(sel) { return sel === 'img' ? imgs : []; }
    };
}

/* ---------------- absolutize ---------------- */
eq('绝对化 相对路径', U.absolutize('media/a.png', BASE), 'https://example.com/post/media/a.png');
eq('绝对化 绝对地址不变', U.absolutize('https://cdn.x.com/a.jpg', BASE), 'https://cdn.x.com/a.jpg');
eq('绝对化 协议相对', U.absolutize('//cdn.x.com/a.jpg', BASE), 'https://cdn.x.com/a.jpg');
eq('绝对化 javascript 丢弃', U.absolutize('javascript:void(0)', BASE), '');
eq('绝对化 about 丢弃', U.absolutize('about:blank', BASE), '');
eq('绝对化 空值', U.absolutize('', BASE), '');
eq('绝对化 无 base 的相对地址丢弃', U.absolutize('a.png', ''), '');

/* ---------------- srcset ---------------- */
eq('srcset 取最大 w', U.pickLargestSrcset('a-400.png 400w, a-1200.png 1200w, a-800.png 800w', BASE),
    'https://example.com/post/a-1200.png');
eq('srcset 取最大 x', U.pickLargestSrcset('a.png 1x, b.png 3x, c.png 2x', BASE), 'https://example.com/post/b.png');
eq('srcset 无描述符取最后', U.pickLargestSrcset('a.png, b.png', BASE), 'https://example.com/post/b.png');
eq('srcset 空串', U.pickLargestSrcset('', BASE), '');
eq('srcset 单值', U.pickLargestSrcset('only.webp 1x', BASE), 'https://example.com/post/only.webp');
eq('srcset w 优先于 x', U.pickLargestSrcset('a.png 2x, b.png 500w', BASE), 'https://example.com/post/b.png');
eq('srcset 多余空白', U.pickLargestSrcset('  a.png   800w ,  b.png   1600w  ', BASE), 'https://example.com/post/b.png');

/* ---------------- 扩展名 ---------------- */
eq('扩展名 大小写+查询串', U.extFromUrl('https://x.com/a/Big.JPG?w=100'), 'jpg');
eq('扩展名 无', U.extFromUrl('https://x.com/img/12345'), '');
eq('扩展名 内容类型 jpeg', U.extFromContentType('image/jpeg; charset=binary'), 'jpg');
eq('扩展名 内容类型 webp', U.extFromContentType('image/webp'), 'webp');
eq('扩展名 内容类型 html', U.extFromContentType('text/html'), '');
eq('扩展名 内容类型 svg', U.extFromContentType('image/svg+xml'), 'svg');

/* ---------------- 格式/占位判断 ---------------- */
eq('data URI 识别', U.isDataUri('data:image/png;base64,AAAA'), true);
eq('SVG 识别（带查询）', U.isSvgUrl('https://x.com/i.svg?v=2'), true);
eq('SVG 识别（data）', U.isSvgUrl('data:image/svg+xml;utf8,<svg/>'), true);
eq('占位图 placeholder', U.isPlaceholderUrl('https://x.com/placeholder.png'), true);
eq('占位图 loading.svg', U.isPlaceholderUrl('https://x.com/loading.gif'), true);
eq('占位图 正常图', U.isPlaceholderUrl('https://x.com/photo/2026/a.jpg'), false);
eq('占位图 空', U.isPlaceholderUrl(''), true);
eq('像图片 jpg', U.isProbablyImage('https://x.com/a.jpg'), true);
eq('像图片 无扩展名', U.isProbablyImage('https://x.com/img?id=9'), true);
eq('像图片 mp4 否', U.isProbablyImage('https://x.com/a.mp4'), false);
eq('像图片 svg 否', U.isProbablyImage('https://x.com/i.svg'), false);
eq('像图片 data png', U.isProbablyImage('data:image/png;base64,AA'), true);
eq('像图片 data svg 否', U.isProbablyImage('data:image/svg+xml;utf8,<svg/>'), false);
eq('像图片 相对地址否', U.isProbablyImage('media/a.png'), false);

/* 无扩展名的「网页路径」必须排除（2026-11-07 花瓣实测：详情页被当成原图，
 * 导致大图预览加载空白）。这类地址与真实的 hash 结尾 CDN 图必须能区分。 */
eq('像图片 花瓣详情页否', U.isProbablyImage('https://huaban.com/pins/6019884'), false);
eq('像图片 花瓣详情页带斜杠否', U.isProbablyImage('https://huaban.com/pins/6019884/'), false);
eq('像图片 花瓣空间页否', U.isProbablyImage('https://huaban.com/huaban/space/273749334/1146/3'), false);
eq('像图片 站根否', U.isProbablyImage('https://example.com/'), false);
eq('像图片 搜索页否', U.isProbablyImage('https://example.com/search?q=a'), false);
eq('像图片 花瓣真实CDN图是', U.isProbablyImage('https://gd-hbimg-edge.huaban.com/664203abc'), true);
eq('looksLikePage 详情页', U.looksLikePage('https://huaban.com/pins/6019884'), true);
eq('looksLikePage CDN图', U.looksLikePage('https://gd-hbimg-edge.huaban.com/664203abc'), false);

/* ---------------- sizeOf ---------------- */
const s1 = U.sizeOf(makeImg({ src: 'a.png', nw: 640, nh: 480 }));
arr('尺寸 自然尺寸', [s1.w, s1.h], [640, 480]);
const s2 = U.sizeOf(makeImg({ src: 'a.png', width: 320, height: 200 }));
arr('尺寸 属性回退', [s2.w, s2.h], [320, 200]);
const s3 = U.sizeOf(makeImg({ src: 'a.png', cw: 220, ch: 110 }));
arr('尺寸 渲染尺寸回退', [s3.w, s3.h], [220, 110]);

/* ---------------- collectCandidates ---------------- */
const link = new El('a', { href: '/originals/big.png' });
const linkedImg = makeImg({ src: '/thumb/s.png', parent: link });
arr('候选 ①a[href] 最优先', U.collectCandidates(linkedImg, makeDoc([])),
    ['https://example.com/originals/big.png', 'https://example.com/thumb/s.png']);

const plain = makeImg({
    src: '/thumb/s.png',
    srcset: '/w/400.png 400w, /w/1600.png 1600w',
    'data-src': '/lazy/original.webp',
    nw: 800, nh: 600
});
arr('候选 ②srcset 先于 data-*', U.collectCandidates(plain, makeDoc([])), [
    'https://example.com/w/1600.png',
    'https://example.com/lazy/original.webp',
    'https://example.com/thumb/s.png'
]);

const lazy = makeImg({ src: '/thumb/s.jpg', 'data-original-src': '/o/a.jpg', 'data-iurl': '/o/b.jpg', nw: 500, nh: 500 });
arr('候选 ③data-* 固定顺序', U.collectCandidates(lazy, makeDoc([])),
    ['https://example.com/o/a.jpg', 'https://example.com/o/b.jpg', 'https://example.com/thumb/s.jpg']);

const riBox = new El('div', { 'data-ri': JSON.stringify({ ou: 'https://img.example.org/orig.jpg', title: 'x' }) });
const riImg = makeImg({ src: '/thumb/t.jpg', parent: riBox });
arr('候选 ④data-ri JSON 的 ou', U.collectCandidates(riImg, makeDoc([])),
    ['https://img.example.org/orig.jpg', 'https://example.com/thumb/t.jpg']);

const riBox2 = new El('div', { 'data-ri': '{"meta":"see https:\\/\\/cdn.example.org\\/raw.png now"}' });
const riImg2 = makeImg({ src: '/thumb/u.jpg', parent: riBox2 });
arr('候选 ④data-ri 文本里的裸 URL', U.collectCandidates(riImg2, makeDoc([])),
    ['https://cdn.example.org/raw.png', 'https://example.com/thumb/u.jpg']);

const dedupeImg = makeImg({
    src: 'https://cdn.example.com/same.jpg',
    srcset: 'https://cdn.example.com/same.jpg 1200w',
    currentSrc: 'https://cdn.example.com/same.jpg'
});
arr('候选 去重保留首次', U.collectCandidates(dedupeImg, makeDoc([])), ['https://cdn.example.com/same.jpg']);

const hashLink = new El('a', { href: '#' });
const hashImg = makeImg({ src: '/a.jpg', parent: hashLink });
arr('候选 跳过 # 链接', U.collectCandidates(hashImg, makeDoc([])), ['https://example.com/a.jpg']);

const phImg = makeImg({ src: '/img/placeholder.png', 'data-src': '/real/photo.jpg' });
arr('候选 跳过占位图', U.collectCandidates(phImg, makeDoc([])), ['https://example.com/real/photo.jpg']);

const svgImg = makeImg({ src: '/icons/star.svg' });
arr('候选 跳过 SVG', U.collectCandidates(svgImg, makeDoc([])), []);
eq('候选 img 为空', JSON.stringify(U.collectCandidates(null, makeDoc([]))), '[]');

const onlyCurrent = makeImg({ src: '/x.jpg', currentSrc: '/y.jpg' });
arr('候选 ⑤currentSrc 先于 src', U.collectCandidates(onlyCurrent, makeDoc([])),
    ['https://example.com/y.jpg', 'https://example.com/x.jpg']);

/* ---------------- 微博图床原图升级（2026-11-12 B-79） ---------------- */
/* 背景：微博 /mw690/ /thumb150/ 是压缩图，直接存下来只有 690px。
 * 用户要「存原图」，而清晰度写在**路径段**里，stripResizeParams 那套够不到。
 * 注意：升级地址必须是 candidates 的**首位** —— 后台按顺序 fetch，第一个
 * 拿到 image/* 的就定案，排末尾等于永远用不上。 */
eq('微博 mw690 → large',
   U.upgradeSinaimg('https://wx1.sinaimg.cn/mw690/abc123.jpg'),
   'https://wx1.sinaimg.cn/large/abc123.jpg');
eq('微博 thumb150 → large',
   U.upgradeSinaimg('https://wx4.sinaimg.cn/thumb150/abc.jpg'),
   'https://wx4.sinaimg.cn/large/abc.jpg');
eq('微博 bmiddle → large',
   U.upgradeSinaimg('https://wx2.sinaimg.cn/bmiddle/abc.gif'),
   'https://wx2.sinaimg.cn/large/abc.gif');
eq('微博 已是 large 不重复升级',
   U.upgradeSinaimg('https://wx1.sinaimg.cn/large/abc.jpg'), '');
eq('微博 未知路径段不动',
   U.upgradeSinaimg('https://wx1.sinaimg.cn/something/abc.jpg'), '');
eq('非微博图床不动',
   U.upgradeSinaimg('https://cdn.example.com/mw690/abc.jpg'), '');
eq('空值安全', U.upgradeSinaimg(''), '');

const weiboImg = makeImg({ src: 'https://wx1.sinaimg.cn/mw690/abc.jpg', nw: 690, nh: 460 });
arr('微博 原图候选排最前', U.collectCandidates(weiboImg, makeDoc([])),
    ['https://wx1.sinaimg.cn/large/abc.jpg', 'https://wx1.sinaimg.cn/mw690/abc.jpg']);

/* ---------------- bestCandidate（2026-11-08 统一择优） ---------------- */
/* 背景：这段逻辑原先只在 image-page.js 里有一份，三处批量下载直接用 it.url，
 * 导致「单张下是原图、批量下是缩略图」。抽成公共函数后必须锁住语义。 */
{
    const chain = ['https://a.com/post/123', 'https://a.com/big.jpg', 'https://a.com/small.jpg'];
    eq('best 跳过网页路径取图', U.bestCandidate(chain, 'https://a.com/small.jpg'),
        'https://a.com/big.jpg');
    eq('best 取第一个像图的（大图优先）', U.bestCandidate(
        ['https://a.com/1.jpg', 'https://a.com/2.jpg'], ''), 'https://a.com/1.jpg');
    eq('best 空链退回 fallback', U.bestCandidate([], 'https://a.com/x.jpg'),
        'https://a.com/x.jpg');
    eq('best 全不像图退回首个候选', U.bestCandidate(['https://a.com/p/1'], ''),
        'https://a.com/p/1');
    eq('best 无 fallback 且空链返回空串', U.bestCandidate([], ''), '');
    eq('best data URI 作兜底', U.bestCandidate(['data:image/png;base64,xx'], ''),
        'data:image/png;base64,xx');
    eq('best 跳过 svg', U.bestCandidate(['https://a.com/i.svg', 'https://a.com/p.jpg'], ''),
        'https://a.com/p.jpg');
    eq('best 非数组安全', U.bestCandidate(null, 'https://a.com/y.jpg'),
        'https://a.com/y.jpg');
    /* 小红书实测形态：候选链里只有 sns-*.xhscdn.com（预览档 + 去参裸地址），
     * **没有** ci.xiaohongshu.com 原图 —— 原图推导在 js/xhs-media.js，
     * 但它不在图片内容脚本组里，collectCandidates 用不到（见 B-37）。
     * 所以这里取到的是链首的预览档，这是当前的真实行为，不是期望行为。 */
    const xhs = [
        'https://sns-na-i4.xhscdn.com/notes_pre_post/1040g2sg?imageView2/2/w/640/format/webp',
        'https://sns-na-i4.xhscdn.com/notes_pre_post/1040g2sg'
    ];
    eq('best 小红书当前取链首（原图未接入，见 B-37）',
        U.bestCandidate(xhs, xhs[0]), xhs[0]);
}

/* ---------------- scanImages ---------------- */
const big1 = makeImg({ src: '/media/a.jpg', nw: 1200, nh: 900 });
const big2 = makeImg({ src: '/media/b.png', nw: 800, nh: 800 });
const tiny = makeImg({ src: '/media/tiny.png', nw: 16, nh: 16 });
const dup = makeImg({ src: '/media/a.jpg', nw: 1200, nh: 900 });
const dataImg = makeImg({ src: '/media/c.jpg', currentSrc: 'data:image/png;base64,AAAA', nw: 400, nh: 400 });
const svgImg2 = makeImg({ src: '/media/icon.svg', nw: 400, nh: 400 });
const phImg2 = makeImg({ src: '/media/placeholder.png', nw: 400, nh: 400 });
const broken = makeImg({ src: '/media/broken.jpg', nw: 0, nh: 0, width: 640, height: 480 });

const doc = makeDoc([big1, big2, tiny, dup, dataImg, svgImg2, phImg2, broken]);
const found = U.scanImages(doc, {});
arr('扫描 过滤后 2 张', found.map(x => x.url),
    ['https://example.com/media/a.jpg', 'https://example.com/media/b.png']);
eq('扫描 首张尺寸', `${found[0].w}x${found[0].h}`, '1200x900');
eq('扫描 ok 标记', found[0].ok, true);
ok('扫描 附带候选', Array.isArray(found[0].candidates) && found[0].candidates.length === 1);
ok('扫描 坏图（natural=0）虽有宽高属性也跳过', !found.some(x => x.url.indexOf('broken') >= 0));

const noDedupe = U.scanImages(doc, { dedupe: false });
arr('扫描 关闭去重 3 张', noDedupe.map(x => x.url),
    ['https://example.com/media/a.jpg', 'https://example.com/media/b.png', 'https://example.com/media/a.jpg']);

// 阈值提到 850：a.jpg(1200x900) 过，b.png(800x800) 被筛掉
arr('扫描 提高阈值', U.scanImages(doc, { minWidth: 850, minHeight: 850 }).map(x => x.url),
    ['https://example.com/media/a.jpg']);
arr('扫描 limit 生效', U.scanImages(doc, { limit: 1 }).map(x => x.url),
    ['https://example.com/media/a.jpg']);
arr('扫描 无 doc', U.scanImages(null, {}), []);
arr('扫描 空文档', U.scanImages(makeDoc([]), {}), []);

/* ---------------- 占位 src + data-src 真图（2026-11-12 B-79） ---------------- */
/* 真占位型懒加载：src 是 1x1 透明图，真地址只在 data-src。
 * 旧逻辑把整张图判成「占位」丢掉 → 页面 80 张图扫出 0 张。 */
const phSrcImg = makeImg({ src: '/img/1x1.png', 'data-src': '/real/photo.jpg', nw: 800, nh: 600 });
arr('占位 src 回退 data-src', U.scanImages(makeDoc([phSrcImg]), {}).map(x => x.url),
    ['https://example.com/real/photo.jpg']);
const blankSrcImg = makeImg({ src: '/img/blank.gif', 'data-original-src': '/real/b.png', nw: 800, nh: 600 });
arr('blank.gif 回退 data-original-src', U.scanImages(makeDoc([blankSrcImg]), {}).map(x => x.url),
    ['https://example.com/real/b.png']);

/* ---------------- 500 长边门槛 + 200 短边底线 ---------------- */
// 判「显示尺寸」：长边 ≥500 且短边 ≥200 才出下载按钮（2026-11-05 用户反馈横图被 600 门槛全挡后调整）
function withBox(nw, nh, sw, sh) {
    const e = makeImg({ src: '/media/t.png', nw: nw, nh: nh });
    e.getBoundingClientRect = () => ({ width: sw, height: sh, x: 0, y: 0, right: sw, bottom: sh });
    e.clientWidth = sw;
    e.clientHeight = sh;
    return e;
}
eq('门槛 MIN_SHOW = 500', U.MIN_SHOW, 500);
ok('500x500 刚好通过', U.isWorthDownloading(withBox(500, 500, 500, 500), {}));
ok('800x600 通过', U.isWorthDownloading(withBox(800, 600, 800, 600), {}));
ok('499x499 不通过（长边不够）', !U.isWorthDownloading(withBox(499, 499, 499, 499), {}));
ok('600x199 不通过（短边不够）', !U.isWorthDownloading(withBox(600, 199, 600, 199), {}));
ok('500x500 显示通过（原图 3000x3000）',
   U.isWorthDownloading(withBox(3000, 3000, 500, 500), {}));
ok('16x16 图标不通过', !U.isWorthDownloading(withBox(640, 480, 16, 16), {}));
ok('1200x150 横幅不通过（长宽比 8:1）',
   !U.isWorthDownloading(withBox(1200, 150, 1200, 150), {}));
ok('1000x600 通过（比例 1.67 在允许范围）',
   U.isWorthDownloading(withBox(1000, 600, 1000, 600), {}));
// 量不到显示尺寸时退回原始像素兜底
ok('无 getBoundingClientRect 时按原始像素判：1200x900 通过',
   U.isWorthDownloading(makeImg({ src: '/media/t.png', nw: 1200, nh: 900 }), {}));
ok('无 getBoundingClientRect 时按原始像素判：300x300 不通过',
   !U.isWorthDownloading(makeImg({ src: '/media/t.png', nw: 300, nh: 300 }), {}));

/* ---------------- 去 resize 参数拿原图 ---------------- */
// 各家 CDN 的降分辨率参数写法不同，都要能剥掉
eq('resize 微博 ?w=300',
   U.stripResizeParams('https://wx1.sinaimg.cn/large/abc.jpg?w=300'),
   'https://wx1.sinaimg.cn/large/abc.jpg');
eq('resize 七牛 imageView2',
   U.stripResizeParams('https://cdn.com/a.jpg?imageView2/2/w/300'),
   'https://cdn.com/a.jpg');
eq('resize 阿里 OSS x-oss-process',
   U.stripResizeParams('https://b.oss.com/a.jpg?x-oss-process=image/resize,w_300'),
   'https://b.oss.com/a.jpg');
eq('resize 多参数只剥尺寸，保留其它',
   U.stripResizeParams('https://cdn.com/a.jpg?w=300&v=2&quality=80'),
   'https://cdn.com/a.jpg?v=2');
eq('resize 没有尺寸参数返回空',
   U.stripResizeParams('https://cdn.com/a.jpg?v=2&t=1'), '');
eq('resize 无查询串返回空',
   U.stripResizeParams('https://cdn.com/a.jpg'), '');
eq('resize 非 http 返回空',
   U.stripResizeParams('data:image/png;base64,xx'), '');
eq('resize 空值返回空', U.stripResizeParams(''), '');
eq('resize 大小写不敏感',
   U.stripResizeParams('https://cdn.com/a.jpg?W=300'), 'https://cdn.com/a.jpg');
// 只剥查询参数，路径里的尺寸段不动（风险高）：
// ?v=1 不含尺寸参数 → 本来就返回空串（不改动原地址）
eq('resize 路径里的尺寸不动且无尺寸参数时返回空',
   U.stripResizeParams('https://cdn.com/300x300/a.jpg?v=1'), '');

/* ---------------- 背景图解析 ---------------- */
eq('bg 普通 url',
   U.parseBgImage('url("https://cdn.com/a.jpg")', 'https://x.com/'), 'https://cdn.com/a.jpg');
eq('bg 无引号',
   U.parseBgImage('url(https://cdn.com/a.jpg)', 'https://x.com/'), 'https://cdn.com/a.jpg');
eq('bg 相对地址补全',
   U.parseBgImage('url("/img/a.jpg")', 'https://x.com/p/1'), 'https://x.com/img/a.jpg');
eq('bg none 返回空', U.parseBgImage('none', 'https://x.com/'), '');
eq('bg 渐变无 url 返回空',
   U.parseBgImage('linear-gradient(red, blue)', 'https://x.com/'), '');
eq('bg 空值返回空', U.parseBgImage('', 'https://x.com/'), '');
ok('bg SVG 不算（矢量不可当图片存）',
   U.parseBgImage('url("data:image/svg+xml,<svg/>")', 'https://x.com/') === '');

/* ---------------- 正则过滤 ---------------- */
const pool = [
    { url: 'https://wx1.sinaimg.cn/a.jpg' },
    { url: 'https://cdn.other.com/b.png' },
    { url: 'https://wx2.sinaimg.cn/c.webp' }
];
arr('过滤 子串', U.filterByKeyword(pool, 'sinaimg').map(x => x.url),
    ['https://wx1.sinaimg.cn/a.jpg', 'https://wx2.sinaimg.cn/c.webp']);
arr('过滤 正则', U.filterByKeyword(pool, '/sinaimg\\.cn/').map(x => x.url),
    ['https://wx1.sinaimg.cn/a.jpg', 'https://wx2.sinaimg.cn/c.webp']);
arr('过滤 正则带 flags', U.filterByKeyword(pool, '/\\.PNG$/i').map(x => x.url),
    ['https://cdn.other.com/b.png']);
arr('过滤 正则不匹配', U.filterByKeyword(pool, '/^https://////zzz/'), []);
arr('过滤 正则写错退回子串', U.filterByKeyword(pool, '/[unclosed').map(x => x.url), []);
arr('过滤 空关键字返回全部', U.filterByKeyword(pool, '').length, 3);
arr('过滤 空列表', U.filterByKeyword([], 'x'), []);

/* ---------------- <picture> 的 source ---------------- */
eq('picture srcset 最大 w 值', U.largestSrcsetPixels('a.jpg 400w, b.jpg 1200w, c.jpg 800w'), 1200);
eq('picture srcset 用 x 描述符', U.largestSrcsetPixels('a.jpg 1x, b.jpg 2x'), 2000);
eq('picture srcset 无描述符', U.largestSrcsetPixels('a.jpg'), 0);
eq('picture srcset 空', U.largestSrcsetPixels(''), 0);

// 模拟 <picture><source><img></picture>
const picParent = {
    tagName: 'PICTURE',
    querySelectorAll: () => [
        { getAttribute: (n) => n === 'srcset' ? 'small.webp 400w, big.webp 1200w' : null },
        { getAttribute: (n) => n === 'srcset' ? 'mid.webp 800w' : null }
    ]
};
const picImg = { tagName: 'IMG', parentNode: picParent };
eq('picture 取最大 source',
   U.pickLargestPictureSource(picImg, 'https://x.com/p/'),
   'https://x.com/p/big.webp');
eq('picture 非 picture 父级返回空',
   U.pickLargestPictureSource({ tagName: 'IMG', parentNode: { tagName: 'DIV' } }, 'https://x.com/'), '');
eq('picture 无父级返回空', U.pickLargestPictureSource({ tagName: 'IMG' }, 'https://x.com/'), '');

/* ---------------- 汇总 ---------------- */
console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail) {
    console.log('\n失败明细：');
    fails.forEach((f, i) => console.log(`${i + 1}. ${f}`));
    process.exit(1);
}
