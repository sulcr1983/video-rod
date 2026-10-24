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

/* ---------------- scanImages ---------------- */
const big1 = makeImg({ src: '/media/a.jpg', nw: 640, nh: 480 });
const big2 = makeImg({ src: '/media/b.png', nw: 300, nh: 300 });
const tiny = makeImg({ src: '/media/tiny.png', nw: 16, nh: 16 });
const dup = makeImg({ src: '/media/a.jpg', nw: 640, nh: 480 });
const dataImg = makeImg({ src: '/media/c.jpg', currentSrc: 'data:image/png;base64,AAAA', nw: 400, nh: 400 });
const svgImg2 = makeImg({ src: '/media/icon.svg', nw: 400, nh: 400 });
const phImg2 = makeImg({ src: '/media/placeholder.png', nw: 400, nh: 400 });
const broken = makeImg({ src: '/media/broken.jpg', nw: 0, nh: 0, width: 640, height: 480 });

const doc = makeDoc([big1, big2, tiny, dup, dataImg, svgImg2, phImg2, broken]);
const found = U.scanImages(doc, {});
arr('扫描 过滤后 2 张', found.map(x => x.url),
    ['https://example.com/media/a.jpg', 'https://example.com/media/b.png']);
eq('扫描 首张尺寸', `${found[0].w}x${found[0].h}`, '640x480');
eq('扫描 ok 标记', found[0].ok, true);
ok('扫描 附带候选', Array.isArray(found[0].candidates) && found[0].candidates.length === 1);
ok('扫描 坏图（natural=0）虽有宽高属性也跳过', !found.some(x => x.url.indexOf('broken') >= 0));

const noDedupe = U.scanImages(doc, { dedupe: false });
arr('扫描 关闭去重 3 张', noDedupe.map(x => x.url),
    ['https://example.com/media/a.jpg', 'https://example.com/media/b.png', 'https://example.com/media/a.jpg']);

arr('扫描 提高阈值', U.scanImages(doc, { minWidth: 450, minHeight: 450 }).map(x => x.url),
    ['https://example.com/media/a.jpg']);
arr('扫描 limit 生效', U.scanImages(doc, { limit: 1 }).map(x => x.url),
    ['https://example.com/media/a.jpg']);
arr('扫描 无 doc', U.scanImages(null, {}), []);
arr('扫描 空文档', U.scanImages(makeDoc([]), {}), []);

/* ---------------- 汇总 ---------------- */
console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail) {
    console.log('\n失败明细：');
    fails.forEach((f, i) => console.log(`${i + 1}. ${f}`));
    process.exit(1);
}
