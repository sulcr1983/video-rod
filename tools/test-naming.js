#!/usr/bin/env node
/**
 * 苏哥的钓鱼竿 video-rod — M0 智能起名引擎测试（tools/test-naming.js）
 * 跑法：node tools/test-naming.js
 * 内容：微型 DOM 解析器 + 10 个复刻真实站点结构的样本页 + TESTING.md N1-N8 用例断言。
 * 说明：页面提取选择器在 Node 里用迷你 DOM 验证；真实站点 DOM 会漂移，
 *       终极验证在 M1 装上扩展后用真实页面跑（有头浏览器测试阶段）。
 */
'use strict';

/* ================= 微型 DOM（仅测试用，不进扩展） ================= */

function parseHTML(html) {
    const root = { tag: '#root', attrs: {}, children: [], parent: null };
    const stack = [root];
    const VOID = new Set(['meta', 'link', 'br', 'img', 'input', 'hr', 'source']);
    const tokenRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\/?>|([^<]+)/g;
    let m;
    while ((m = tokenRe.exec(html)) !== null) {
        if (m[0].startsWith('<!--')) { continue; }
        if (m[3] !== undefined) {
            if (m[3].trim()) { stack[stack.length - 1].children.push({ tag: '#text', text: m[3], parent: stack[stack.length - 1] }); }
            continue;
        }
        const tag = m[1].toLowerCase();
        if (m[0].startsWith('</')) {
            for (let i = stack.length - 1; i > 0; i--) {
                if (stack[i].tag === tag) { stack.length = i; break; }
            }
            continue;
        }
        const attrs = {};
        const attrRe = /([a-zA-Z][a-zA-Z0-9_-]*)(?:="([^"]*)"|='([^']*)')?/g;
        let am;
        while ((am = attrRe.exec(m[2] || '')) !== null) {
            attrs[am[1].toLowerCase()] = am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : '');
        }
        const node = { tag, attrs, children: [], parent: stack[stack.length - 1] };
        stack[stack.length - 1].children.push(node);
        if (!VOID.has(tag) && !m[0].endsWith('/>')) { stack.push(node); }
    }
    // 挂 textContent / getAttribute / 后代遍历
    const all = [];
    (function walk(n) {
        all.push(n);
        if (n.children) { n.children.forEach(walk); }
    })(root);
    for (const n of all) {
        Object.defineProperty(n, 'textContent', {
            get() { return n.children.map(c => c.tag === '#text' ? c.text : c.textContent).join(''); }
        });
        n.getAttribute = name => (n.attrs[name] !== undefined ? n.attrs[name] : null);
    }
    const titleNode = all.find(n => n.tag === 'title');
    const bodyNode = all.find(n => n.tag === 'body');
    return {
        get title() { return titleNode ? titleNode.textContent.trim() : ''; },
        get body() { return bodyNode || null; },
        querySelector(sel) { return queryAll(all, root, sel)[0] || null; },
        querySelectorAll(sel) { return queryAll(all, root, sel); }
    };
}

function matchPart(node, part) {
    // part: tag / #id / .class / [attr] / [attr="v"] / [attr*="s"] 的任意组合
    const re = /([a-zA-Z][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:([*^$]?=)\s*"([^"]*)"\s*)?\]/g;
    let mm, ok = true, matched = false;
    while ((mm = re.exec(part)) !== null) {
        matched = true;
        if (mm[1] && node.tag !== mm[1].toLowerCase()) { ok = false; break; }
        if (mm[2] && node.attrs.id !== mm[2]) { ok = false; break; }
        if (mm[3]) {
            const cls = (node.attrs.class || '').split(/\s+/);
            if (!cls.includes(mm[3])) { ok = false; break; }
        }
        if (mm[4]) {
            const v = node.attrs[mm[4].toLowerCase()];
            if (v === undefined) { ok = false; break; }
            if (mm[5]) {
                if (mm[5] === '=' && v !== mm[6]) { ok = false; break; }
                if (mm[5] === '*=' && !v.includes(mm[6])) { ok = false; break; }
                if (mm[5] === '^=' && !v.startsWith(mm[6])) { ok = false; break; }
                if (mm[5] === '$=' && !v.endsWith(mm[6])) { ok = false; break; }
            }
        }
    }
    return matched && ok;
}

function queryAll(all, root, sel) {
    const parts = sel.trim().split(/\s+/);
    const last = parts[parts.length - 1];
    return all.filter(n => n !== root && n.tag !== '#text' && matchPart(n, last))
        .filter(n => {
            // 祖先链满足前面各部分（后代组合器）
            let p = n.parent, i = parts.length - 2;
            while (p && i >= 0) {
                if (matchPart(p, parts[i])) { i--; }
                p = p.parent;
            }
            return i < 0;
        });
}

/* ================= 样本页面（复刻真实站点关键结构） ================= */

const SAMPLES = {
    // 1. 新闻文章页：有 og:title，应优先取且无尾巴
    news: {
        url: 'https://www.example-news.com/2026/some-article.html',
        html: `<html><head><title>某科技发布会 actual 标题_example 新闻网</title>
            <meta property="og:title" content="某科技发布会 actual 标题">
            <meta name="author" content="记者甲">
            <meta property="og:description" content="这是文章摘要内容。"></head>
            <body><article><h1>某科技发布会 actual 标题</h1><p>正文……</p></article></body></html>`
    },
    // 2. 文章页无 og：h1 优先；再退 document.title 剥尾巴
    newsNoOg: {
        url: 'https://news-portal.cn/a/b.html',
        html: `<html><head><title>深度调查：某行业背后_新闻频道_新闻门户网</title></head>
            <body><h1>深度调查：某行业背后</h1></body></html>`
    },
    newsTitleOnly: {
        url: 'https://www.chinanews.com.cn/lxsh/2026/10-01/x.shtml',
        html: `<html><head><title>中国新闻周刊：某事件调查_chinanews_中国新闻网</title></head>
            <body><div>no h1 here</div></body></html>`
    },
    // 3. 推特推文页：tweetText + User-Name（显示名+@handle）
    tweet: {
        url: 'https://x.com/someuser/status/1789000000000000000',
        html: `<html><head><title>某推主 在 X: "这是一条推文正文 https://t.co/abc123 第二行"</title></head>
            <body><div data-testid="tweetText">这是一条推文正文 https://t.co/abc123 第二行</div>
            <div data-testid="User-Name"><div><span>某推主显示名</span></div><div><span>@someuser</span></div></div>
            </body></html>`
    },
    // 4. 推特无作者块（兜底 title 清洗）
    tweetNoUser: {
        url: 'https://twitter.com/anon/status/123',
        html: `<html><head><title>无名氏 在 X: "只有标题能用的推文"</title></head>
            <body><div>no tweet text</div></body></html>`
    },
    // 5. 小红书笔记页
    xhs: {
        url: 'https://www.xiaohongshu.com/explore/66f1a2b3c000000000000000',
        html: `<html><head><title>周末露营装备清单_小红书</title></head>
            <body><div id="detail-title">周末露营装备清单</div>
            <div id="detail-desc">这次露营带了这些装备……#露营 #户外</div>
            <div class="username">露营小能手</div>
            <div class="user-id">小红书号：5f3a9c2b1d</div></body></html>`
    },
    // 6. B站视频页
    bili: {
        url: 'https://www.bilibili.com/video/BV1xx411c7mD',
        html: `<html><head><title>【纪录片】深蓝之境 第 1 集_哔哩哔哩_bilibili</title></head>
            <body><h1 class="video-title">【纪录片】深蓝之境 第 1 集</h1>
            <div class="up-info"><span class="name">深海纪录频道</span>
            <a href="https://space.bilibili.com/67890">个人空间</a></div></body></html>`
    },
    // 7. 普通页面：无结构信息，认不出退网页标题
    plain: {
        url: 'https://obscure-site.example/page',
        html: `<html><head><title>某个普通网页标题</title></head><body><p>hi</p></body></html>`
    },
    // 8. 标题超长（100 字）
    longTitle: {
        url: 'https://www.example-news.com/long.html',
        html: `<html><head><meta property="og:title" content="${'超长标题'.repeat(25)}"></head><body></body></html>`
    },
    // 9. emoji + 非法字符 + 换行
    dirty: {
        url: 'https://x.com/dirty/status/999',
        html: `<html><head><title>dirty 在 X: "test"</title></head>
            <body><div data-testid="tweetText">🎣 周末钓鱼🎣 大丰收 <script>alert(1)</script> a/b:c*d?e"f<g>h|i</div></body></html>`
    },
    // 10. 抖音视频详情页（结构按 2026-10-19 实站）
    douyin: {
        url: 'https://www.douyin.com/video/7682668289420880313',
        html: `<html><head><title>放慢脚步，幸福会追上你！ #瑜伽裤穿搭 #散步随拍 #户外拍摄 - 抖音</title></head>
            <body><div data-e2e="video-detail">
              <div data-e2e="user-info">
                <a href="//www.douyin.com/user/MS4wLjABAAAAHiSLq5THwCh2hNbyHpqtdqDYzSnd1GHHEJ4ajz1lZMe-8zRLZ57bVEvV62X5grdp?author_id=3151627183989326">
                  <img alt="东方街拍" src="https://example.com/a.jpeg">
                </a>
              </div>
              <div data-e2e="detail-video-info">
                <h1><span>放慢脚步，幸福会追上你！ #瑜伽裤穿搭 #散步随拍 #户外拍摄</span></h1>
              </div>
            </div></body></html>`
    }
};

/* ================= 断言框架 ================= */

let pass = 0, fail = 0;
const failures = [];
function eq(actual, expected, label) {
    if (actual === expected) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; failures.push({ label, actual, expected }); console.log(`  ❌ ${label}\n     期望: ${JSON.stringify(expected)}\n     实际: ${JSON.stringify(actual)}`); }
}

/* ================= 跑用例 ================= */

const Naming = require('../js/naming.js');
const { buildName, fillTemplate, sanitizeName, dedupeNames, extractPageInfo } = Naming;

console.log('\n===== N1 文章页取名（og:title 优先，无尾巴） =====');
{
    const doc = parseHTML(SAMPLES.news.html);
    eq(buildName(doc, SAMPLES.news.url, { tpl: '${title}', ext: 'mp4' }), '某科技发布会 actual 标题.mp4', 'og:title 优先');
    eq(buildName(doc, SAMPLES.news.url, { tpl: '${author}_${title}', ext: 'mp4' }), '记者甲_某科技发布会 actual 标题.mp4', '作者前缀');
}
console.log('\n===== N1b 无 og：h1 优先 / title 剥网站名尾巴 =====');
{
    eq(buildName(parseHTML(SAMPLES.newsNoOg.html), SAMPLES.newsNoOg.url, { tpl: '${title}', ext: 'mp4' }),
        '深度调查：某行业背后.mp4', 'h1 优先');
    eq(buildName(parseHTML(SAMPLES.newsTitleOnly.html), SAMPLES.newsTitleOnly.url, { tpl: '${title}', ext: 'mp4' }),
        '中国新闻周刊：某事件调查.mp4', 'title 剥尾巴「_频道_网站」');
}
console.log('\n===== N2 推特页取名（正文 + 去 t.co + 去前缀） =====');
{
    const doc = parseHTML(SAMPLES.tweet.html);
    eq(buildName(doc, SAMPLES.tweet.url, { tpl: '${title}', ext: 'mp4' }),
        '这是一条推文正文 第二行.mp4', 'tweetText 正文 + t.co 链接已去');
}
console.log('\n===== N3 推特作者前缀 昵称(@handle) =====');
{
    const doc = parseHTML(SAMPLES.tweet.html);
    eq(buildName(doc, SAMPLES.tweet.url, { tpl: '${author}_${title}', ext: 'mp4' }),
        '某推主显示名(@someuser)_这是一条推文正文 第二行.mp4', '昵称(@handle)_标题');
}
console.log('\n===== N4 作者缺失不留空下划线 =====');
{
    eq(buildName(parseHTML(SAMPLES.plain.html), SAMPLES.plain.url, { tpl: '${author}_${title}', ext: 'mp4' }),
        '某个普通网页标题.mp4', 'test.mp4 而非 _test.mp4');
    eq(buildName(parseHTML(SAMPLES.tweetNoUser.html), SAMPLES.tweetNoUser.url, { tpl: '${author}_${title}', ext: 'mp4' }),
        '只有标题能用的推文.mp4', '推特无作者块：title 兜底且无空前缀');
}
console.log('\n===== N5 超长截断 60 字 + … =====');
{
    const name = buildName(parseHTML(SAMPLES.longTitle.html), SAMPLES.longTitle.url, { tpl: '${title}', ext: 'mp4' });
    eq(Array.from(name.replace('.mp4', '')).length, 61, '标题部分 60 字 + …');
    eq(name.endsWith('.mp4') && name.includes('…'), true, '截断标记 + 扩展名保留');
}
console.log('\n===== N6 重名加序号 =====');
{
    eq(dedupeNames(['a.mp4', 'a.mp4', 'b.mp4', 'a.mp4']).join(' | '),
        'a.mp4 | a_01.mp4 | b.mp4 | a_02.mp4', '_01/_02 序号');
}
console.log('\n===== N7 认不出退网页标题 =====');
{
    eq(buildName(parseHTML(SAMPLES.plain.html), SAMPLES.plain.url, { tpl: '${title}', ext: 'mp4' }),
        '某个普通网页标题.mp4', '普通页退网页标题');
}
console.log('\n===== N8 模板变量（author/site/index/post） =====');
{
    const doc = parseHTML(SAMPLES.xhs.html);
    eq(buildName(doc, SAMPLES.xhs.url, { tpl: '${author}_${title}', ext: 'mp4' }),
        '露营小能手(@5f3a9c2b1d)_周末露营装备清单.mp4', '小红书 昵称(@小红书号)');
    eq(buildName(parseHTML(SAMPLES.bili.html), SAMPLES.bili.url, { tpl: '${author}_${title}', ext: 'mp4' }),
        '深海纪录频道(@67890)_【纪录片】深蓝之境 第 1 集.mp4', 'B站 昵称(@mid)');
    eq(buildName(doc, SAMPLES.xhs.url, { tpl: '${site}/${index}_${title}', ext: 'mp4', index: 0 }),
        'xiaohongshu/01_周末露营装备清单.mp4', 'site+index 目录变量');
    eq(fillTemplate('${author}_${title}', { author: '', title: 'test' }), 'test', '空 author 折叠');
    eq(fillTemplate('${site}_${author}_${title}', { site: 'x', author: '', title: 'test' }), 'x_test', '中间空段折叠');
    eq(fillTemplate('${post}', { post: '这是正文', title: 't' }), '这是正文', 'post 变量');
}
console.log('\n===== 清洗：emoji/非法字符/保留名 =====');
{
    const dirty = buildName(parseHTML(SAMPLES.dirty.html), SAMPLES.dirty.url, { tpl: '${title}', ext: 'mp4' });
    // 注：真实浏览器中 [data-testid="tweetText"] 的 textContent 同样包含 <script> 内文本
    // 与 <g> 被当未知标签的切分——迷你 DOM 与浏览器行为一致，故期望值按浏览器真实行为写。
    eq(dirty, '周末钓鱼 大丰收 alert(1) a_b_c_d_e_fh_i.mp4', 'emoji 删 + 非法字符换 _');
    eq(sanitizeName('CON'), '_CON', 'Windows 保留名前缀');
    eq(sanitizeName('a. '), 'a', '尾点尾空格清除');
    eq(sanitizeName('周末钓鱼🎣'), '周末钓鱼', 'emoji 单独删除');
    eq(sanitizeName('a🎣b', { keepEmoji: true }), 'a🎣b', 'keepEmoji 选项');
}
console.log('\n===== 页面识别结构 =====');
{
    const info = extractPageInfo(parseHTML(SAMPLES.tweet.html), SAMPLES.tweet.url);
    eq(info.pageType, 'twitter', '识别推特');
    eq(info.authorFull, '某推主显示名(@someuser)', 'authorFull 组装');
    const info2 = extractPageInfo(parseHTML(SAMPLES.bili.html), SAMPLES.bili.url);
    eq(info2.pageType, 'bilibili', '识别 B站');
    eq(info2.title, '【纪录片】深蓝之境 第 1 集', 'B站标题去尾巴');
}
console.log('\n===== 页面识别：抖音 =====');
{
    const doc = parseHTML(SAMPLES.douyin.html);
    const info = extractPageInfo(doc, SAMPLES.douyin.url);
    eq(info.pageType, 'douyin', '识别抖音');
    eq(info.author, '东方街拍', '抖音作者昵称');
    eq(info.authorId, '3151627183989326', '抖音作者数字 UID');
    eq(info.title, '放慢脚步，幸福会追上你！ #瑜伽裤穿搭 #散步随拍 #户外拍摄', '抖音描述作为标题');
    eq(buildName(doc, SAMPLES.douyin.url, { tpl: '${author}_${title}', ext: 'mp4' }),
        '东方街拍(@3151627183989326)_放慢脚步，幸福会追上你！ #瑜伽裤穿搭 #散步随拍 #户外拍摄.mp4',
        '抖音文件名 昵称(@UID)_描述');
}

/* ================= N9 AIX / Fatkun 风格占位符 ================= */

console.log('\n===== N9 AIX 占位符（{NO001}/{PAGETITLE}/{DATE}） =====');
{
    const V = { title: '某页标题', author: '某人', site: 'weibo', index: '7', date: '20261106', ext: 'jpg' };

    eq(Naming.fillTemplate('pic_{NO}.{EXT}', V), 'pic_7.jpg', '{NO}/{EXT} 归一');
    eq(Naming.fillTemplate('pic_{NO01}.{EXT}', V), 'pic_07.jpg', '{NO01} 补零到 2 位');
    eq(Naming.fillTemplate('pic_{NO001}.{EXT}', V), 'pic_007.jpg', '{NO001} 补零到 3 位');
    eq(Naming.fillTemplate('{PAGETITLE}_{NO001}', V), '某页标题_007', '{PAGETITLE} → title');
    eq(Naming.fillTemplate('{DATE}_{NAME}', V), '20261106_某页标题', '{DATE}/{NAME}');
    eq(Naming.fillTemplate('{author}_{NO}', V), '某人_7', '小写 AIX 占位符也认');
    eq(Naming.fillTemplate('{FOO}_x', V), '{FOO}_x', '未知占位符原样保留');

    /* 与项目模板混用：这是迁移用户最可能的写法 */
    eq(Naming.fillTemplate('${author}_{NO001}.${ext}', V), '某人_007.jpg',
        'AIX 与 ${} 混用');
    /* 关键回归：${author} 不能被 {author} 的替换吃掉一个 $（曾打挂 11 条断言） */
    eq(Naming.fillTemplate('${author}_${title}', V), '某人_某页标题',
        '${...} 不被 AIX 替换误伤');
    /* ${NO} 不是项目变量：既有的「未识别 ${...} 一律清空」规则会把它删掉。
     * 这里断言的是**不会变成半截的 $7**（那才是误伤），而不是「原样保留」——
     * 原样保留从来不是本项目语义（见 fillTemplate 的「残余变量清掉」）。 */
    eq(Naming.fillTemplate('${NO}', V), '', '${NO} 不被 AIX 替换成半截 $7');

    /* index 缺失时不留下孤零零的 {NO} */
    eq(Naming.fillTemplate('pic_{NO}.jpg', { title: 't' }), 'pic_.jpg', 'index 缺失时 {NO} 为空');
}

/* ================= 汇总 ================= */

console.log(`\n=========================================`);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
    console.log('失败项：');
    failures.forEach(f => console.log(`  - ${f.label}: 期望 ${JSON.stringify(f.expected)} 实际 ${JSON.stringify(f.actual)}`));
    process.exit(1);
}
console.log('M0 起名引擎全部用例通过 ✅');
process.exit(0);
