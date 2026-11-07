/**
 * 图片过滤规则单测（js/img-filter.js）
 * 跑法：node tools/test-img-filter.js
 */
'use strict';

const F = require('../js/img-filter.js');

let pass = 0;
let fail = 0;
function ok(name, got, expect) {
    const same = JSON.stringify(got) === JSON.stringify(expect);
    if (same) { pass++; }
    else { fail++; console.log('FAIL  ' + name + '\n      got=' + JSON.stringify(got) + '\n      exp=' + JSON.stringify(expect)); }
}

/* ---------------- A. 域名匹配 ---------------- */
ok('A1 * 匹配全网', F.hostMatches('*', 'https://a.com/x.jpg'), true);
ok('A2 空域名 = 全网', F.hostMatches('', 'https://a.com/x.jpg'), true);
ok('A3 精确域', F.hostMatches('example.com', 'https://example.com/x.jpg'), true);
ok('A4 子域命中', F.hostMatches('example.com', 'https://www.example.com/x.jpg'), true);
ok('A5 深层子域命中', F.hostMatches('example.com', 'https://a.b.example.com/x.jpg'), true);
ok('A6 不同域不命中', F.hostMatches('example.com', 'https://example.org/x.jpg'), false);
/* 关键反例：evil-example.com 不能被 example.com 命中 */
ok('A7 后缀相似但不同域不命中', F.hostMatches('example.com', 'https://evil-example.com/x.jpg'), false);
ok('A8 伪域名不命中', F.hostMatches('example.com', 'https://example.com.evil.net/x.jpg'), false);
ok('A9 *. 前缀等价于裸域', F.hostMatches('*.example.com', 'https://www.example.com/x.jpg'), true);
ok('A10 大写域名', F.hostMatches('EXAMPLE.COM', 'https://WWW.example.com/x.jpg'), true);
/* 用户常整条 URL 粘进域名框 */
ok('A11 粘整条 URL 自动取 host', F.hostMatches('https://www.example.com/a/b', 'https://www.example.com/x.jpg'), true);
ok('A12 非法 URL 不命中', F.hostMatches('example.com', 'not a url'), false);

/* ---------------- B. 正则 ---------------- */
ok('B1 空正则 = 全过滤', F.patternMatches('', 'https://a.com/x.jpg'), true);
ok('B2 .* = 全过滤', F.patternMatches('.*', 'https://a.com/x.jpg'), true);
ok('B3 .*? = 全过滤', F.patternMatches('.*?', 'https://a.com/x.jpg'), true);
ok('B4 子串正则命中', F.patternMatches('ad_', 'https://a.com/ad_1.jpg'), true);
ok('B5 子串正则不命中', F.patternMatches('ad_', 'https://a.com/cover.jpg'), false);
ok('B6 /re/ 写法', F.patternMatches('/\\.gif$/i', 'https://a.com/x.GIF'), true);
ok('B7 裸正则带斜杠', F.patternMatches('sinaimg\\.cn', 'https://wx1.sinaimg.cn/a.jpg'), true);
/* 写错的正则不能把图全吞掉，只是不生效 */
ok('B8 非法正则不生效', F.patternMatches('[', 'https://a.com/x.jpg'), false);
ok('B9 g 标志不导致状态残留', (() => {
    const r = [];
    for (let i = 0; i < 3; i++) { r.push(F.patternMatches('/a/g', 'https://x/a.jpg')); }
    return r;
})(), [true, true, true]);

/* ---------------- C. 规则判定 ---------------- */
ok('C1 域名+正则都命中', F.ruleHits({ host: 'a.com', re: 'ad_' }, 'https://a.com/ad_1.jpg'), true);
ok('C2 域名命中正则不命中', F.ruleHits({ host: 'a.com', re: 'ad_' }, 'https://a.com/cover.jpg'), false);
ok('C3 域名不命中', F.ruleHits({ host: 'b.com', re: 'ad_' }, 'https://a.com/ad_1.jpg'), false);
ok('C4 停用的规则不生效', F.ruleHits({ host: 'a.com', re: 'ad_', enabled: false }, 'https://a.com/ad_1.jpg'), false);
ok('C5 规则缺失', F.ruleHits(null, 'https://a.com/x.jpg'), false);

/* ---------------- D. 批量过滤 ---------------- */
const rules = [
    { host: 'a.com', re: 'ad_' },
    { host: '*', re: '\\.gif$', enabled: false },     // 停用，不该生效
    { host: 'c.com', re: '' }                          // 该域全过滤
];
const items = [
    { url: 'https://a.com/ad_1.jpg' },
    { url: 'https://a.com/cover.jpg' },
    { url: 'https://x.com/anim.gif' },
    { url: 'https://c.com/anything.png' }
];
const res = F.apply(items, rules);
ok('D1 保留数', res.kept.map(x => x.url), [
    'https://a.com/cover.jpg',
    'https://x.com/anim.gif'
]);
ok('D2 过滤数', res.removed.length, 2);
ok('D3 空规则全保留', F.apply(items, []).kept.length, 4);
ok('D4 非数组入参', F.apply(null, null), { kept: [], removed: [] });
ok('D5 isFiltered 单点判断', F.isFiltered('https://a.com/ad_9.jpg', rules), true);

/* ---------------- E. 规则清洗 ---------------- */
ok('E1 补默认 enabled', F.normalizeRule({ host: 'a.com', re: 'x' }),
    { host: 'a.com', re: 'x', enabled: true });
ok('E2 空域名补 *', F.normalizeRule({ re: 'x' }), { host: '*', re: 'x', enabled: true });
ok('E3 全空规则丢弃', F.normalizeRule({ host: '', re: '' }), null);
ok('E4 非对象丢弃', F.normalizeRule('abc'), null);
ok('E5 去首尾空白', F.normalizeRule({ host: '  a.com ', re: ' x ' }),
    { host: 'a.com', re: 'x', enabled: true });
ok('E6 enabled:false 保留', F.normalizeRule({ host: 'a.com', re: 'x', enabled: false }).enabled, false);

/* ---------------- F. 导入导出 ---------------- */
const dump = F.exportRules([{ host: 'a.com', re: 'ad_', enabled: true }]);
const parsed = JSON.parse(dump);
ok('F1 导出带版本号', parsed.v, 1);
ok('F2 导出规则数', parsed.rules.length, 1);
const imp = F.importRules(dump);
ok('F3 导入往返', imp.rules, [{ host: 'a.com', re: 'ad_', enabled: true }]);
ok('F4 裸数组也能导入', F.importRules(JSON.stringify([{ host: 'b.com', re: '' }])).rules.length, 1);
ok('F5 坏 JSON 报错', F.importRules('{oops').error, 'JSON 解析失败');
ok('F6 坏条目跳过并计数',
    F.importRules(JSON.stringify([{ host: '', re: '' }, { host: 'a.com', re: 'x' }])),
    { rules: [{ host: 'a.com', re: 'x', enabled: true }], skipped: 1 });
ok('F7 超量截断', F.normalizeRules(new Array(300).fill({ host: 'a.com', re: 'x' })).length, F.MAX_RULES);

/* ---------------- G. 展示文案 ---------------- */
ok('G1 全域+空正则', F.describe({ host: '', re: '' }), '');
ok('G2 全网所有图', F.describe({ host: '*', re: '' }), '全网 · 所有图片');
ok('G3 指定域+正则', F.describe({ host: 'a.com', re: 'ad_' }), 'a.com · ad_');

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + '  ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);