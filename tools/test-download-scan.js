/* eslint-disable */
/**
 * VRDownloadScan 单测
 *
 * 覆盖 2026-11-07 从星愿浏览器两个扩展移植过来的算法：
 *   · Download Master：扩展名合法性、文件名清洗、全链接扫描、自定义过滤
 *   · 图片下载器：源码正则抓图
 *
 * 跑法：node tools/test-download-scan.js
 */
const D = require('../js/lib-download-scan.js');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
    if (cond) { pass++; return; }
    fail++; fails.push(name);
    console.log('FAIL  ' + name + (extra ? '  ' + extra : ''));
}
function eq(name, got, expect) {
    const a = JSON.stringify(got), b = JSON.stringify(expect);
    ok(name, a === b, a === b ? '' : 'got=' + a + ' expect=' + b);
}

/* ---------- A. 扩展名合法性（抄 Download Master isExtensionLegal） ---------- */
ok('A1 pdf 合法', D.isLegalExt('pdf') === true);
ok('A2 webp 合法（4 位）', D.isLegalExt('webp') === true);
ok('A3 大写自动归一', D.isLegalExt('PDF') === true);
ok('A4 空不算合法', D.isLegalExt('') === false);
ok('A5 纯数字不算扩展名', D.isLegalExt('12') === false, '（/photo/2023.12/ 这类路径会被误判）');
ok('A6 超长不算', D.isLegalExt('abcdefg') === false);
ok('A7 含符号不合法', D.isLegalExt('j-pg') === false);
ok('A8 null 安全', D.isLegalExt(null) === false);

/* ---------- B. 扩展名分类 ---------- */
eq('B1 图片类', D.kindOfExt('jpg'), 'image');
eq('B2 svg 也算图片', D.kindOfExt('svg'), 'image');
eq('B3 文档类', D.kindOfExt('pdf'), 'doc');
eq('B4 压缩包归文档', D.kindOfExt('zip'), 'doc');
eq('B5 视频归 media', D.kindOfExt('mp4'), 'media');
eq('B6 音频归 media', D.kindOfExt('mp3'), 'media');
eq('B7 未知扩展名空串', D.kindOfExt('xyz'), '');
eq('B8 空输入空串', D.kindOfExt(''), '');

/* ---------- C. URL 取扩展名与文件名 ---------- */
eq('C1 带 query 仍能取扩展名', D.extOf('https://a.com/x/y.PDF?v=1&t=2'), 'pdf');
eq('C2 带 hash', D.extOf('https://a.com/y.webp#frag'), 'webp');
eq('C3 无扩展名', D.extOf('https://a.com/path/'), '');
eq('C4 取文件名', D.fileNameFromUrl('https://a.com/dir/report.pdf'), 'report.pdf');
eq('C5 切掉 query', D.fileNameFromUrl('https://a.com/d.pdf?x=1'), 'd.pdf');
eq('C6 目录名不算文件名', D.fileNameFromUrl('https://a.com/dir/'), '');
eq('C7 中文名解码', D.fileNameFromUrl('https://a.com/%E5%B9%B4%E6%8A%A5.pdf'), '年报.pdf');
eq('C8 无点不算文件名', D.fileNameFromUrl('https://a.com/downloadphp'), '');

/* ---------- D. 文件名清洗（抄 sanitizeFilename） ---------- */
eq('D1 Windows 非法字符转 _', D.sanitizeFilename('a\\b/c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
eq('D2 去掉首尾点与空白', D.sanitizeFilename('  ..name.pdf..  '), 'name.pdf');
eq('D3 控制字符转 _', D.sanitizeFilename('a\u0001b.png'), 'a_b.png');
ok('D4 超长截到 200', D.sanitizeFilename('x'.repeat(500)).length === 200);
eq('D5 空输入', D.sanitizeFilename(''), '');

/* ---------- E. 落盘文件名（抄 getDownloadFilename） ---------- */
eq('E1 优先 URL 里的真名', D.downloadName('https://a.com/r.pdf', '点我'), 'r.pdf');
eq('E2 URL 是 php 时丢弃，改用链接文字',
    D.downloadName('https://a.com/get.php?id=1', '年报.pdf'), '年报.pdf');
eq('E3 两边都不可用返回空', D.downloadName('https://a.com/get.php?id=1', '点我'), '');
ok('E4 链接文字无合法扩展名则不采用',
    D.downloadName('https://a.com/get.php', '随便写写') === '');
eq('E5 中文文件名保留', D.downloadName('https://a.com/%E6%8A%A5%E5%91%8A.docx'), '报告.docx');

/* ---------- F. 是否像可下载文件（抄 isSuspectGoodLink） ---------- */
ok('F1 正常文件', D.looksDownloadable('https://a.com/x/report.pdf') === true);
ok('F2 纯页面地址排除', D.looksDownloadable('https://a.com/article/123') === false);
ok('F3 目录排除', D.looksDownloadable('https://a.com/dir/') === false);
ok('F4 非 http 排除', D.looksDownloadable('ftp://a.com/x.pdf') === false);
ok('F5 blob 排除', D.looksDownloadable('blob:https://a.com/abc') === false);
ok('F6 隐藏文件（.pdf）排除', D.looksDownloadable('https://a.com/.pdf') === false,
    '（fileNameFromUrl 要求点在 0 之后）');
ok('F7 纯数字扩展名排除', D.looksDownloadable('https://a.com/photo.12') === false);

/* ---------- G. 源码正则抓图（抄图片下载器） ---------- */
{
    const html = `
      <div data-src="https://pic.test/a.jpg"></div>
      var x = "https://pic.test/b.webp?w=800";
      <img src="https://pic.test/c.png">
      <img src="https://pic.test/c.png">   // 重复
      <span>https://pic.test/loading.gif</span>   // 占位图
    `;
    const got = D.extractUrlsFromHtml(html, 'https://pic.test/');
    eq('G1 从源码抓到 3 张（去重+过滤占位）', got.length, 3);
    ok('G2 含 a.jpg', got.indexOf('https://pic.test/a.jpg') >= 0);
    ok('G3 含带 query 的 webp', got.some(u => u.indexOf('b.webp?w=800') > 0));
    ok('G4 占位图被排除', !got.some(u => /loading\.gif/.test(u)));
}
{
    const html = '<img src="https://a.com/x.jpg?a=1&amp;b=2">';
    const got = D.extractUrlsFromHtml(html, 'https://a.com/');
    ok('G5 &amp; 还原成 &', got[0] && got[0].indexOf('a=1&b=2') > 0);
}
{
    /* 必须用**不同**地址：同一个 URL 会被去重，测不到 limit */
    const html = Array.from({ length: 50 }, (_, i) => `https://a.com/p${i}.jpg`).join(' ');
    ok('G6 limit 生效', D.extractUrlsFromHtml(html, '', 5).length === 5);
}
eq('G7 空源码空数组', D.extractUrlsFromHtml('', ''), []);
{
    const got = D.extractUrlsFromHtml('<img src="data:image/png;base64,xxx">', '');
    eq('G8 data URI 排除', got.length, 0);
}
{
    /* 2026-11-07 实机发现：原式只认 https?:// ，下面这两种真实写法全漏。
       测试页实测只抓到 1/3 张，就是因为它俩。 */
    const html = `
      var a = "/media/inside.jpg";
      var b = "//cdn.test/proto-relative.webp";
    `;
    const got = D.extractUrlsFromHtml(html, 'https://site.test/dir/page.html');
    ok('G9 单斜杠站内绝对路径被解析为站点根',
        got.indexOf('https://site.test/media/inside.jpg') >= 0, JSON.stringify(got));
    ok('G10 协议相对地址按页面协议补全',
        got.indexOf('https://cdn.test/proto-relative.webp') >= 0, JSON.stringify(got));
    eq('G11 两种写法各抓一条，不重复计数', got.length, 2);
}

/* ---------- H. 全链接扫描（抄 Download Master retreiveDownloadableFiles） ---------- */
function fakeDoc(html) {
    const anchors = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/g)]
        .map(m => ({ getAttribute: (k) => (k === 'href' ? m[1] : null), textContent: m[2] }));
    const vids = [...html.matchAll(/<video[^>]+src="([^"]+)"/g)]
        .map(m => ({ getAttribute: (k) => (k === 'src' ? m[1] : null) }));
    const objs = [...html.matchAll(/<object[^>]+data="([^"]+)"/g)]
        .map(m => ({ getAttribute: (k) => (k === 'data' ? m[1] : null) }));
    return {
        querySelectorAll(sel) {
            if (sel === 'a[href]') { return anchors; }
            if (sel === 'video[src]') { return vids; }
            if (sel === 'object[data]') { return objs; }
            return [];
        }
    };
}
{
    const doc = fakeDoc(`
      <a href="https://a.com/docs/report.pdf">年报.pdf</a>
      <a href="https://a.com/post/123">一篇普通文章</a>
      <a href="https://a.com/pack.zip">打包下载</a>
      <video src="https://a.com/v/movie.mp4"></video>
      <object data="https://a.com/doc/white-paper.docx"></object>
    `);
    const got = D.collectLinks(doc, { base: 'https://a.com/' });
    eq('H1 只留合法扩展名（pdf/zip/mp4/docx）', got.length, 4);
    ok('H2 普通文章页被排除', !got.some(x => /\/post\/123/.test(x.url)));
    ok('H3 pdf 分类正确', got.some(x => x.url.indexOf('report.pdf') > 0 && x.kind === 'doc'));
    ok('H4 视频来源标记 video', got.some(x => x.kind === 'media' && x.source === 'video'));
    ok('H5 object 的 data 也收', got.some(x => x.url.indexOf('white-paper.docx') > 0));
}
{
    const doc = fakeDoc('<a href="https://a.com/a">x</a><a href="https://a.com/a">x</a>');
    const got = D.collectLinks(doc, { base: 'https://a.com/', all: true });
    eq('H6 去重', got.length, 1);
}
{
    const doc = fakeDoc('<a href="/pics/1.jpg">图</a>');
    const got = D.collectLinks(doc, { base: 'https://a.com/dir/page.html' });
    eq('H7 相对地址补全', got[0].url, 'https://a.com/pics/1.jpg');
}
{
    const doc = fakeDoc('<a href="blob:https://a.com/x">x</a>');
    eq('H8 blob 跳过', D.collectLinks(doc, { base: 'https://a.com/', all: true }).length, 0);
}
eq('H9 空 doc 安全', D.collectLinks(null, {}), []);

/* ---------- I. 自定义过滤（抄 applyCustomFilter，含非法正则兜底） ---------- */
ok('I1 空表达式全通过', D.matchesFilter('https://a.com/x.pdf', '', '') === true);
ok('I2 子串命中 URL', D.matchesFilter('https://a.com/report.pdf', '', 'report') === true);
ok('I3 子串命中文件名', D.matchesFilter('https://a.com/x', '年报.pdf', '年报') === true);
ok('I4 子串大小写不敏感', D.matchesFilter('https://a.com/REPORT.pdf', '', 'report') === true);
ok('I5 正则语法', D.matchesFilter('https://a.com/x/123.pdf', '', '/\\d+\\.pdf$/') === true);
ok('I6 正则不命中', D.matchesFilter('https://a.com/x/abc.pdf', '', '/\\d+\\.pdf$/') === false);
ok('I7 非法正则退回子串（不炸）',
    D.matchesFilter('https://a.com/x.pdf', '', '/([a-z/') === false, '（子串也不命中，但不抛错）');
ok('I8 非法正则时子串仍可用',
    D.matchesFilter('https://a.com/report.pdf', '', '/report') === true);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
    console.log('失败用例：' + fails.join(', '));
    process.exit(1);
}