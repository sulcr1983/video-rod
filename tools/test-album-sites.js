/**
 * 站点图集适配表单测（js/album-sites.js）
 *
 * 只测纯 URL 规则，不碰 DOM、不发请求 —— 所以用例里的 URL 都是各站**真实形态**，
 * 在无登录态下也能复现。
 *
 * 用法：node tools/test-album-sites.js
 */
'use strict';

const A = require('../js/album-sites.js');

let pass = 0;
let fail = 0;

function ok(name, got, expect) {
    const same = JSON.stringify(got) === JSON.stringify(expect);
    if (same) {
        pass++;
    } else {
        fail++;
        console.log('FAIL  ' + name);
        console.log('      got    = ' + JSON.stringify(got));
        console.log('      expect = ' + JSON.stringify(expect));
    }
}

function eq(name, got, expect) { ok(name, got, expect); }

/* ---------------- A. 站点识别 ---------------- */
eq('A1 微博 weibo.com', A.matchSite('https://weibo.com/u/1234567890').key, 'weibo');
eq('A2 微博 m.weibo.cn', A.matchSite('https://m.weibo.cn/u/1234567890').key, 'weibo');
eq('A3 微博二级域', A.matchSite('https://weibo.com/aj/v6/photo').key, 'weibo');
eq('A4 豆瓣相册', A.matchSite('https://www.douban.com/photos/album/123456/').key, 'douban');
eq('A5 豆瓣单图页', A.matchSite('https://www.douban.com/photos/photo/2600000000/').key, 'douban');
eq('A6 堆糖', A.matchSite('https://www.duitang.com/blog/?id=123456').key, 'duitang');
eq('A7 花瓣', A.matchSite('https://huaban.com/boards/12345678').key, 'huaban');
eq('A8 图虫', A.matchSite('https://tuchong.com/123456/9876543/').key, 'tuchong');
eq('A9 未适配站点', A.matchSite('https://example.com/gallery'), null);
eq('A10 非法 URL', A.matchSite('not a url'), null);
eq('A11 空值', A.matchSite(''), null);
/* 关键：不能被形似域名骗过（子串匹配会误判） */
eq('A12 伪微博域名', A.matchSite('https://notweibo.com/x'), null);
eq('A13 伪豆瓣域名', A.matchSite('https://fakedouban.com/photos/'), null);

/* ---------------- B. 微博原图派生 ---------------- */
eq('B1 orj360 → large',
    A.originalOf('https://wx1.sinaimg.cn/orj360/abc123.jpg'),
    'https://wx3.sinaimg.cn/large/abc123.jpg');
eq('B2 thumbnail → large',
    A.originalOf('https://wx2.sinaimg.cn/thumbnail/abc123.jpg'),
    'https://wx3.sinaimg.cn/large/abc123.jpg');
eq('B3 mw600 → large',
    A.originalOf('https://wx4.sinaimg.cn/mw600/abc123.jpg'),
    'https://wx3.sinaimg.cn/large/abc123.jpg');
eq('B4 bmiddle → large',
    A.originalOf('https://wx1.sinaimg.cn/bmiddle/abc123.jpg'),
    'https://wx3.sinaimg.cn/large/abc123.jpg');
eq('B5 已是 large 不派生',
    A.originalOf('https://wx3.sinaimg.cn/large/abc123.jpg'), '');
eq('B6 非 sinaimg 不派生',
    A.originalOf('https://example.com/a.jpg'), '');

/* ---------------- C. 豆瓣原图派生 ---------------- */
eq('C1 thumb → raw',
    A.originalOf('https://img1.doubanio.com/view/photo/thumb/public/p1234567.jpg'),
    'https://img1.doubanio.com/view/photo/raw/public/p1234567.jpg');
eq('C2 median → raw',
    A.originalOf('https://img3.doubanio.com/view/photo/median/public/p1234567.jpg'),
    'https://img3.doubanio.com/view/photo/raw/public/p1234567.jpg');
eq('C3 m → raw',
    A.originalOf('https://img2.doubanio.com/view/photo/m/public/p1234567.jpg'),
    'https://img2.doubanio.com/view/photo/raw/public/p1234567.jpg');
eq('C4 raw 不派生',
    A.originalOf('https://img1.doubanio.com/view/photo/raw/public/p1234567.jpg'), '');
eq('C5 非豆瓣 CDN 不派生',
    A.originalOf('https://example.com/view/photo/thumb/x.jpg'), '');

/* ---------------- D. 堆糖原图派生 ---------------- */
eq('D1 _300 → 原图',
    A.originalOf('https://img.duitang.com/uploads/item/2020/01/01/abc_300.jpg'),
    'https://img.duitang.com/uploads/item/2020/01/01/abc.jpg');
eq('D2 _600 → 原图',
    A.originalOf('https://img.duitang.com/uploads/item/2020/01/01/abc_600.png'),
    'https://img.duitang.com/uploads/item/2020/01/01/abc.png');
eq('D3 无尺寸后缀不派生',
    A.originalOf('https://img.duitang.com/uploads/item/2020/01/01/abc.jpg'), '');

/* ---------------- E. 花瓣原图派生 ---------------- */
/* 真实形态见 2026-11-07 实测：尺寸与格式连写 `_fw480webp`，中间没有点。 */
eq('E1 _fw658 → 原图',
    A.originalOf('https://hbimg.huaban.com/abc123_fw658'),
    'https://hbimg.huaban.com/abc123');
eq('E2 _sq75.jpg → 原图（剥掉尺寸与扩展）',
    A.originalOf('https://hbimg.huaban.com/abc123_sq75.jpg'),
    'https://hbimg.huaban.com/abc123');
eq('E2b 真实 _fw480webp → 原图',
    A.originalOf('https://gd-hbimg.huaban.com/595342ef154445ad-Nd0Ts3_fw480webp'),
    'https://gd-hbimg.huaban.com/595342ef154445ad-Nd0Ts3');
eq('E2c 真实 _fw192webp → 原图',
    A.originalOf('https://gd-hbimg.huaban.com/6bc81fc04a-dont0l_fw192webp'),
    'https://gd-hbimg.huaban.com/6bc81fc04a-dont0l');
eq('E3 无尺寸段不派生',
    A.originalOf('https://hbimg.huaban.com/abc123.jpg'), '');

/* ---------------- F. 分页 ---------------- */
const douban = A.matchSite('https://www.douban.com/photos/album/123456/');
eq('F1 豆瓣首屏 → start=30',
    A.nextPageUrl('https://www.douban.com/photos/album/123456/', douban, {}),
    'https://www.douban.com/photos/album/123456/?start=30');
eq('F2 豆瓣第 2 屏 → start=60',
    A.nextPageUrl('https://www.douban.com/photos/album/123456/?start=30', douban, {}),
    'https://www.douban.com/photos/album/123456/?start=60');
eq('F3 豆瓣保留其他参数',
    A.nextPageUrl('https://www.douban.com/photos/album/123456/?type=all&start=30', douban, {}),
    'https://www.douban.com/photos/album/123456/?type=all&start=60');

/* 花瓣是游标式：没有 nextCursor 就必须返回空，不能瞎加数字 */
const huaban = A.matchSite('https://huaban.com/boards/12345678');
eq('F4 花瓣无游标 → 空', A.nextPageUrl('https://huaban.com/boards/12345678', huaban, {}), '');
eq('F5 花瓣有游标',
    A.nextPageUrl('https://huaban.com/boards/12345678?max=999', huaban, { nextCursor: '888' }),
    'https://huaban.com/boards/12345678?max=888');

/* next 策略 / 未适配站点：都只认页面给的 rel=next */
eq('F6 图虫无 nextHref → 空',
    A.nextPageUrl('https://tuchong.com/123456/9876543/', A.matchSite('https://tuchong.com/123456/9876543/'), {}), '');
eq('F7 图虫有 nextHref',
    A.nextPageUrl('https://tuchong.com/123456/9876543/',
        A.matchSite('https://tuchong.com/123456/9876543/'), { nextHref: '/123456/9876544/' }),
    'https://tuchong.com/123456/9876544/');
eq('F8 未适配站点有 nextHref',
    A.nextPageUrl('https://example.com/gallery?p=1', null, { nextHref: '?p=2' }),
    'https://example.com/gallery?p=2');

/* 微博只有滚动，不编造分页 */
eq('F9 微博无 nextHref → 空',
    A.nextPageUrl('https://weibo.com/u/1234567890', A.matchSite('https://weibo.com/u/1234567890'), {}), '');

/* ---------------- G. 下一页候选挑选 ---------------- */
eq('G1 rel=next 优先',
    A.pickNext([
        { href: '/p/2', text: '2' },
        { href: '/p/next', text: '随便', rel: 'next' }
    ]), '/p/next');
eq('G2 中文「下一页」',
    A.pickNext([{ href: '/p/2', text: '下一页' }]), '/p/2');
eq('G3 「下页」',
    A.pickNext([{ href: '/p/3', text: '下页' }]), '/p/3');
eq('G4 next 英文',
    A.pickNext([{ href: '/p/3', text: 'Next' }]), '/p/3');
eq('G5 都没有 → 空', A.pickNext([{ href: '/p/2', text: '2' }]), '');
eq('G6 非数组 → 空', A.pickNext(null), '');
/* 反例：页码数字不能当成「下一页」，否则会误判 */
eq('G7 纯数字不算下一页', A.pickNext([{ href: '/p/5', text: '5' }]), '');

/* ---------------- H. 图片/页面判别 ---------------- */
eq('H1 .jpg 是图片', A.looksLikeAlbumPage('https://x.com/a.jpg'), false);
eq('H2 带参数的图仍是图片', A.looksLikeAlbumPage('https://x.com/a.jpg?w=300'), false);
eq('H3 相册页不是图片', A.looksLikeAlbumPage('https://www.douban.com/photos/album/123/'), true);
eq('H4 webp 是图片', A.looksLikeAlbumPage('https://x.com/a.webp'), false);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + '  ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
