/**
 * 苏哥的钓鱼竿 video-rod 智能起名引擎（M0 地基）
 * ---------------------------------------------------------------
 * 职责：从页面信息提取「标题/正文/作者」→ 套命名模板 → 清洗 → 输出干净文件名。
 * 设计约束（ADR-015 外壳大改内核不动）：本文件是独立新模块，不改猫抓任何内核；
 * 纯函数 + 提取函数分离，浏览器（真 document）与 Node（测试迷你 DOM）双环境可用。
 *
 * 已拍板规则（PLAN.md / ADR-004/016）：
 *   - 文章页取标题剥网站名尾巴；推特页取推文正文；认不出退网页标题
 *   - 作者前缀 昵称(@账号)_标题；拿不到作者自动跳过该段（不留空下划线）
 *   - 非法字符换下划线；emoji 默认删除；超长截 60 字+「…」；重名 _01 _02
 *   - 模板变量：${title} ${post} ${author} ${site} ${index} ${date} ${ext} ${url}
 */
(function (root, factory) {
    const Naming = factory();
    if (typeof module !== 'undefined' && module.exports) { module.exports = Naming; }
    else { root.VideoRodNaming = Naming; }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MAX_NAME_LEN = 60;                 // ADR-016：超长截断
    const ILLEGAL_RE = /[<>:"|?*\\/]/g;      // Windows/各系统文件名非法字符
    const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;  // Windows 保留设备名

    /* ==========================================================
     * 一、页面识别：从 document 提取结构化信息
     * 每个提取器只依赖 querySelector/getAttribute/textContent，
     * 浏览器与测试用迷你 DOM 都能跑。
     * ========================================================== */

    function textOf(el) {
        return el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    }
    function attrOf(el, name) {
        return el && typeof el.getAttribute === 'function' ? (el.getAttribute(name) || '') : '';
    }
    function q(doc, sel) { return doc && doc.querySelector ? doc.querySelector(sel) : null; }
    function qa(doc, sel) { return doc && doc.querySelectorAll ? Array.from(doc.querySelectorAll(sel)) : []; }

    /** 文章页兜底提取：og:title → h1 → document.title，并剥网站名尾巴 */
    /**
     * 「无意义标题」识别：这类标题是站点的访客墙/登录墙/反爬页留下的，
     * 不是内容标题，直接拿来命名会得到 `Sina Visitor System.mp4`、
     * `Just a moment....mp4`、`登录 - 微博.mp4` 这种垃圾文件名。
     *
     * 实测（2026-11-07）：未登录访问 weibo.com/newlogin 会被 302 到
     * passport.weibo.com/visitor/visitor，页面 <title> 就是 `Sina Visitor System`，
     * 既无 og:title 也无 author —— 通用 extractArticle 的 doc.title 兜底就把它当标题了。
     *
     * 命中时返回 true，调用方应把标题留空，交给上层按 URL 末段/时间戳兜底命名。
     */
    const USELESS_TITLE_RE = new RegExp([
        '^Sina Visitor System$',
        '^Just a moment\\.*\\.?$',
        '^Attention Required!',
        '^Access Denied$',
        '^Forbidden$',
        '^404\\b', '^403\\b', '^500\\b',
        '^无标题$', '^未命名$', '^新建网页',
        '^(登录|登入|注册)\\s*[-_–—]',
        '^Sign in\\s*[-_–—]',
        '^Log in\\s*[-_–—]'
    ].join('|'), 'i');

    function isUselessTitle(title) {
        const t = String(title || '').trim();
        if (!t) { return true; }
        if (USELESS_TITLE_RE.test(t)) { return true; }
        /* 标题只剩扩展名/纯标点也算无意义（例如空模板兜底出来的 "mp4"） */
        if (/^[\s\p{P}\p{S}]+$/u.test(t)) { return true; }
        if (/^(mp4|webm|mov|jpg|jpeg|png|gif|webp)$/i.test(t)) { return true; }
        return false;
    }

    function extractArticle(doc, host) {
        let title = attrOf(q(doc, 'meta[property="og:title"]'), 'content')
            || textOf(q(doc, 'h1'))
            || (doc && doc.title ? doc.title.trim() : '');
        title = stripSiteTail(title, host);
        /* 访客墙/登录墙页面没有内容标题：宁可留空让上层用 URL/时间戳兜底，
         * 也不要把 `Sina Visitor System` 这种站点名当成作品名。 */
        if (isUselessTitle(title)) { title = ''; }
        const author = attrOf(q(doc, 'meta[name="author"]'), 'content')
            || textOf(q(doc, '[rel="author"]'))
            || textOf(q(doc, '.author'))
            || textOf(q(doc, '.byline'))
            || '';
        let post = attrOf(q(doc, 'meta[property="og:description"]'), 'content')
            || attrOf(q(doc, 'meta[name="description"]'), 'content')
            || '';
        if (isUselessTitle(post)) { post = ''; }
        return { title, author, authorId: '', post, pageType: 'article' };
    }

    /** 推特/X：正文取 [data-testid="tweetText"]；作者取 User-Name 块 */
    function extractTwitter(doc, host) {
        const tweetEl = q(doc, '[data-testid="tweetText"]');
        let post = textOf(tweetEl);
        // 清理推文：去 t.co/pic 短链、换行压空格（textOf 已压）、去首尾引号
        post = post
            .replace(/https?:\/\/t\.co\/\w+/g, '')
            .replace(/https?:\/\/pic\.twitter\.com\/\w+/g, '')
            .replace(/https?:\/\/x\.com\/\w+/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^["'"'"']+|["'"'"']+$/g, '');

        // 作者：User-Name 块内，显示名 + @handle
        const userBlock = q(doc, '[data-testid="User-Name"]');
        let displayName = '', handle = '';
        if (userBlock) {
            const spans = qa(doc, '[data-testid="User-Name"] span').length
                ? qa(doc, '[data-testid="User-Name"] span')
                : [userBlock];
            for (const s of spans) {
                const t = textOf(s);
                if (!t) continue;
                const m = t.match(/@([A-Za-z0-9_]{1,15})/);
                if (m && !handle) { handle = m[1]; }
                else if (!displayName && !t.startsWith('@')) { displayName = t; }
            }
        }
        // 兜底：从 document.title 剥「某人 在 X: 」/「Name on X: 」前缀
        let title = post;
        if (!title && doc && doc.title) {
            title = doc.title.replace(/^.+?\s+(?:在|on)\s+X[:：]\s*/, '').replace(/^["'"'"']|["'"'"']$/g, '').trim();
        }
        return {
            title: truncate(title, MAX_NAME_LEN),
            author: displayName,
            authorId: handle,
            post,
            pageType: 'twitter'
        };
    }

    /** 小红书：标题/正文取详情区，作者取用户卡片（昵称+小红书号） */
    function extractXiaohongshu(doc, host) {
        let title = textOf(q(doc, '#detail-title')) || textOf(q(doc, '.title')) || '';
        if (!title && doc && doc.title) { title = stripSiteTail(doc.title, host); }
        const post = textOf(q(doc, '#detail-desc')) || textOf(q(doc, '.desc')) || '';
        const author = textOf(q(doc, '.username')) || textOf(q(doc, '.user-name'))
            || textOf(q(doc, '[class*="author"] .name')) || textOf(q(doc, '[class*="author"]')) || '';
        // 小红书号：页面文本「小红书号：xxxx」或用户 ID 元素
        let authorId = '';
        const idEl = q(doc, '.user-id') || q(doc, '[class*="red-id"]') || q(doc, '[class*="userid"]');
        if (idEl) { authorId = textOf(idEl).replace(/^小红书号[:：]\s*/, ''); }
        if (!authorId) {
            const bodyText = doc && doc.body ? textOf(doc.body) : '';
            const m = bodyText.match(/小红书号[:：]\s*([A-Za-z0-9_-]{4,})/);
            if (m) { authorId = m[1]; }
        }
        return { title, author, authorId, post, pageType: 'xiaohongshu' };
    }

    /** B站：标题取 video-title，作者取 UP 主信息（昵称 + mid） */
    function extractBilibili(doc, host) {
        let title = textOf(q(doc, 'h1.video-title')) || textOf(q(doc, '[class*="video-title"]')) || '';
        if (!title && doc && doc.title) { title = stripSiteTail(doc.title, host); }
        const author = textOf(q(doc, '.up-name')) || textOf(q(doc, '[class*="up-info"] .name'))
            || textOf(q(doc, '[class*="up-info"] a')) || '';
        // UP mid：space.bilibili.com/<mid>
        let authorId = '';
        const spaceA = q(doc, 'a[href*="space.bilibili.com"]');
        if (spaceA) {
            const m = attrOf(spaceA, 'href').match(/space\.bilibili\.com\/(\d+)/);
            if (m) { authorId = m[1]; }
        }
        return { title, author, authorId, post: '', pageType: 'bilibili' };
    }

    /** 抖音：描述取详情区 h1，作者取 user-info（昵称 + 抖音号/UID）
     *  选择器只用 data-e2e 锚点，抖音的 class 是哈希值，随时会变。 */
    function extractDouyin(doc, host) {
        // 视频描述：详情区 h1（实测 [data-e2e="detail-video-info"] 稳定）
        let post = textOf(q(doc, '[data-e2e="detail-video-info"] h1'))
            || textOf(q(doc, '[data-e2e="video-detail"] h1'))
            || '';
        // 作者昵称：头像 alt 最稳；其次作者链接里的文本
        const author = attrOf(q(doc, '[data-e2e="user-info"] img[alt]'), 'alt')
            || textOf(q(doc, '[data-e2e="user-info"] a[href*="/user/"]'))
            || '';
        // 作者 ID：作者链接里的 author_id（数字 UID）；没有就退 sec_uid。
        // 注意：抖音号（unique_id）不在详情页 DOM 里，下载时由后台详情接口补上。
        let authorId = '';
        const userA = q(doc, '[data-e2e="user-info"] a[href*="/user/"]');
        const href = attrOf(userA, 'href');
        const mUid = href.match(/[?&]author_id=(\d+)/);
        if (mUid) { authorId = mUid[1]; }
        else {
            const mSec = href.match(/\/user\/([A-Za-z0-9_-]+)/);
            if (mSec) { authorId = mSec[1]; }
        }
        // 标题：描述优先；没有就从 document.title 剥「 - 抖音」
        let title = post;
        if (!title && doc && doc.title) {
            title = doc.title.replace(/\s*[-_|—–]\s*抖音\s*$/, '').trim();
        }
        return { title, author, authorId, post, pageType: 'douyin' };
    }

    /** 站点规则表：按 hostname 匹配，article 是兜底 */
    const SITE_RULES = [
        { name: 'twitter', match: /(^|\.)(twitter\.com|x\.com)$/, extract: extractTwitter },
        { name: 'xiaohongshu', match: /(^|\.)(xiaohongshu\.com|xhslink\.com)$/, extract: extractXiaohongshu },
        { name: 'bilibili', match: /(^|\.)(bilibili\.com|b23\.tv)$/, extract: extractBilibili },
        { name: 'douyin', match: /(^|\.)(douyin\.com|iesdouyin\.com)$/, extract: extractDouyin },
        { name: 'article', match: /.*/, extract: extractArticle }
    ];

    /**
     * 页面识别入口：输入 document + 完整 URL，输出结构化信息
     * @returns {{title, post, author, authorId, site, pageType}}
     */
    function extractPageInfo(doc, url) {
        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* url 非法时 host 为空 */ }
        const rule = SITE_RULES.find(r => r.match.test(host)) || SITE_RULES[SITE_RULES.length - 1];
        const info = rule.extract(doc, host);
        const site = host.split('.')[0] || '';
        // 作者 ID 统一成 @handle 形式（推特天然 handle；小红书/B站为数字 ID）
        const author = (info.author || '').trim();
        const authorId = (info.authorId || '').trim();
        return {
            title: (info.title || '').trim(),
            post: (info.post || '').trim(),
            author,
            authorId,
            authorFull: buildAuthorFull(author, authorId),
            site,
            pageType: rule.name
        };
    }

    /** 作者完整形式：昵称(@ID)；拿不到 ID 就只有昵称；都没有返回空 */
    function buildAuthorFull(name, id) {
        const n = (name || '').trim();
        const i = (id || '').trim().replace(/^@/, '');
        if (n && i) { return `${n}(@${i})`; }
        return n;
    }

    /** 剥网站名尾巴：「标题_网站名」「标题 - 网站名」「标题_频道_网站名」 */
    function stripSiteTail(title, host) {
        if (!title) { return ''; }
        const siteWord = host ? host.split('.')[0] : '';
        let parts = title.split(/[_|\-—–]\s*/);
        while (parts.length > 1) {
            const tail = parts[parts.length - 1].trim();
            // 尾段像站点名（含站点主名、或很短且是常见频道名样式）才剥
            const looksLikeSite = tail.length <= 20 && (
                (siteWord && tail.includes(siteWord)) ||
                /^(网|站|新闻|门户|首页|官方|频道版?)$/.test(tail) ||
                /(新闻|网|TV|视频|社区|门户)$/.test(tail)
            );
            if (looksLikeSite) { parts.pop(); } else { break; }
        }
        return parts.join('_').trim();
    }

    /* ==========================================================
     * 二、模板填充：变量替换 + 空段清理
     * ========================================================== */

    /**
     * 填充命名模板。
     * 变量：${title} 智能标题 ${post} 正文/推文全文 ${author} 昵称(@ID)
     *       ${site} 站点主名 ${index} 序号 ${date} 日期 ${ext} 扩展名 ${url} 原地址
     * 拿不到的变量不留空下划线：折叠连续下划线并去首尾。
     */
    function fillTemplate(tpl, vars) {
        const v = vars || {};
        const val = (key, fallback) => {
            const x = v[key];
            return (x === undefined || x === null) ? (fallback || '') : String(x);
        };
        const map = {
            title: val('title'),
            post: val('post'),
            author: val('author'),
            site: val('site'),
            index: val('index'),
            date: val('date'),
            ext: val('ext'),
            url: val('url')
        };
        let name = String(tpl || '${title}.${ext}');

        /* AIX / Fatkun 风格占位符（2026-11-06 补）：
         * 用户从那些扩展迁移过来时，模板里写的是 {NO001} / {PAGETITLE} / {DATE}。
         * 直接不认会得到「{NO001}」这样的字面文件名，所以在这里先做一次归一。
         *
         * {NOnnn} 的补零位数要真的生效 —— 本项目 ${index} 固定 2 位，
         * 表达不了 3 位，所以按占位符里 0 的个数就地格式化 index。
         *
         * ⚠️ 两条铁律（都踩过）：
         *   1) 必须先替换 ${...}，再处理 AIX 的 {...}；
         *      反过来 `{author}` 会命中 `${author}` 的花括号，留下孤零零的 `$`
         *      （实测打挂 11 条既有断言）。
         *   2) AIX 的正则必须加「前面不是 $」的负向后视 `(?<!\$)`；
         *      否则 `${NO}` 会被 `{NO}` 命中变成 `$7`，同样是半截替换。
         *      lookbehind 需要 Chrome 62+，本项目 minimum_chrome_version 是 93，安全。 */
        name = name.replace(/(?<!\$)\{NO(\d{0,3})\}/gi, (m, zeros) => {
            const raw = v.index;
            if (raw === undefined || raw === null || raw === '') { return ''; }
            const num = Number(raw);
            if (!isFinite(num)) { return String(raw); }
            const width = zeros ? zeros.length : 0;
            return width > 0 ? String(num).padStart(width, '0') : String(num);
        });

        for (const key of Object.keys(map)) {
            name = name.split('${' + key + '}').join(map[key]);
        }

        /* 别名（大小写都认）。同样排除 `${...}` 的情况，避免二次误伤。 */
        const alias = {
            PAGETITLE: 'title', NAME: 'title', DATE: 'date', EXT: 'ext',
            URL: 'url', AUTHOR: 'author', SITE: 'site', POST: 'post'
        };
        name = name.replace(/(?<!\$)\{(PAGETITLE|NAME|DATE|EXT|URL|AUTHOR|SITE|POST)\}/gi,
            (m, key) => val(alias[String(key).toUpperCase()]));

        // 未替换的残余变量清掉；空段清理
        name = name.replace(/\$\{\w+\}/g, '');
        name = name.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
        return name;
    }

    /* ==========================================================
     * 三、清洗：非法字符/emoji/保留名/截断
     * ========================================================== */

    /**
     * 变量预清洗：只清「内容 hostile」字符（控制/零宽/emoji/非法字符含斜杠），
     * 不做截断和保留名处理（那是最终名的活）。
     * 语义：变量内容里的 / 一律不当目录分隔符——目录符只来自模板字面量。
     */
    function cleanVar(s) {
        let v = String(s || '');
        v = v.replace(/[\u0000-\u001F\u007F]/g, '');
        v = v.replace(/[\u200B-\u200D\uFEFF]/g, '');
        v = v.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '');
        v = v.replace(ILLEGAL_RE, '_');
        v = v.replace(/\s+/g, ' ').trim();
        return v;
    }

    function truncate(str, max) {
        if (!str) { return ''; }
        const arr = Array.from(str);
        return arr.length > max ? arr.slice(0, max).join('') + '…' : str;
    }

    /**
     * 文件名清洗（ADR-004/016 + Windows 边界）：
     * 控制字符/零宽清除 → emoji 删除（默认）→ 非法字符换 _ →
     * 保留设备名加前缀 → 去首尾 _ . 空格 → 截断 60 字+…
     * opts.keepPath=true 时保留 / 作为目录分隔符（逐段清洗）——
     * 这是「下载到文件夹」相对猫抓的核心改造（猫抓把斜杠转义成实体）。
     */
    function sanitizeName(name, opts) {
        const options = opts || {};
        let s = String(name || '');
        s = s.replace(/[\u0000-\u001F\u007F]/g, '');          // 控制字符
        s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');          // 零宽字符
        if (options.keepEmoji !== true) {
            // emoji 及变体选择符/ZWJ 序列整体删除
            s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '');
        }
        if (options.keepPath === true) {
            return s.split('/').map(seg => cleanSegment(seg, options)).filter((seg, i, arr) =>
                // 去掉空段（模板空变量导致的 // 或首尾 /），但保留段间单斜杠
                !(seg === '' && (i === 0 || i === arr.length - 1))
            ).join('/').replace(/\/{2,}/g, '/');
        }
        return cleanSegment(s, options);
    }

    /** 单段（无目录分隔符）清洗 */
    function cleanSegment(s, options) {
        s = s.replace(ILLEGAL_RE, '_');                       // 非法字符（段内无 /）
        s = s.replace(/\s+/g, ' ').trim();
        s = s.replace(/^[_.\s]+|[_.\s]+$/g, '');              // 首尾不能是 _ . 空格
        const dotIdx = s.lastIndexOf('.');
        const stem = dotIdx > 0 ? s.slice(0, dotIdx) : s;
        const ext = dotIdx > 0 ? s.slice(dotIdx) : '';
        if (RESERVED_NAMES.test(stem)) { s = '_' + s; }       // CON/PRN/COM1 等保留名
        s = stem.length + ext.length > MAX_NAME_LEN + 1 ? truncate(stem, MAX_NAME_LEN) + ext : s;
        return s;
    }

    /* ==========================================================
     * 四、批量：重名加序号（ADR-016）
     * ========================================================== */

    /** 对一批文件名去重：同名第二个起加 _01 _02（两位数序号） */
    function dedupeNames(names) {
        const seen = new Map();
        return names.map(raw => {
            const name = String(raw || '');
            const dotIdx = name.lastIndexOf('.');
            const stem = dotIdx > 0 ? name.slice(0, dotIdx) : name;
            const ext = dotIdx > 0 ? name.slice(dotIdx) : '';
            const count = seen.get(stem) || 0;
            seen.set(stem, count + 1);
            return count === 0 ? name : `${stem}_${String(count).padStart(2, '0')}${ext}`;
        });
    }

    /* ==========================================================
     * 五、便捷入口：一步到位 页面信息 → 最终文件名
     * ========================================================== */

    /**
     * 单个媒体的最终文件名（起名主入口）
     * @param {Document} doc 页面 document
     * @param {string} url 媒体地址（用于站点识别）
     * @param {object} opts { tpl, ext, index, date, keepEmoji }
     */
    function buildName(doc, url, opts) {
        return buildNameFromInfo(extractPageInfo(doc, url), url, opts);
    }

    /**
     * 同上，但页面信息已经提取过（popup 场景：内容脚本一次性提取，多条媒体复用）
     * @param {{title, post, authorFull, site}} info extractPageInfo 的返回值
     */
    function buildNameFromInfo(info, url, opts) {
        const o = opts || {};
        const p = info || {};
        const vars = {
            title: cleanVar(p.title),
            post: cleanVar(p.post || p.title),
            author: cleanVar(p.authorFull),
            site: cleanVar(p.site),
            index: o.index !== undefined
                ? (typeof o.index === 'number' ? String(o.index + 1).padStart(2, '0') : String(o.index))
                : '',
            date: o.date || new Date().toISOString().slice(0, 10).replace(/-/g, ''),
            ext: cleanVar(o.ext || 'mp4'),
            url: cleanVar(url)
        };
        const tpl = o.tpl || '${author}_${title}';
        let filled = fillTemplate(tpl, vars);
        // 自动补扩展名（原型行为：用户模板默认不写 ${ext}，引擎兜底追加）
        const ext = o.ext || 'mp4';
        if (!filled.toLowerCase().endsWith('.' + ext.toLowerCase()) && !tpl.includes('${ext}')) {
            filled += '.' + ext;
        }
        filled = sanitizeName(filled, { keepEmoji: o.keepEmoji, keepPath: true });

        /* 模板变量全空时的兜底。
         * 典型场景：未登录/访客墙页面 title 与 author 都取不到，
         * `${author}_${title}` 填空后只剩扩展名 `mp4` —— 落盘得到一个叫 mp4 的文件。
         * 这里按「URL 末段 → 时间戳」降级，保证文件名总有意义。 */
        if (isDegenerateName(filled, ext)) {
            filled = fallbackNameFromUrl(url, ext, o.date);
        }
        return filled;
    }

    /** 文件名是否退化（只有扩展名 / 只剩标点与连接符） */
    function isDegenerateName(name, ext) {
        const s = String(name || '').trim();
        if (!s) { return true; }
        const e = String(ext || 'mp4').toLowerCase();
        let core = s;
        /* 形如 "mp4"（没有点，本身就只是扩展名）也要算退化 */
        if (core.toLowerCase() === e) { return true; }
        if (core.toLowerCase().endsWith('.' + e)) { core = core.slice(0, -(e.length + 1)); }
        core = core.replace(/[\s_\-–—·.]+/g, '').trim();
        return core.length === 0;
    }

    /** 从 URL 末段取一个可读名字；取不到就用日期时间 */
    function fallbackNameFromUrl(url, ext, date) {
        const e = String(ext || 'mp4');
        let base = '';
        try {
            const u = new URL(String(url || ''));
            const segs = u.pathname.split('/').filter(Boolean);
            base = segs.length ? decodeURIComponent(segs[segs.length - 1]) : '';
            if (base.indexOf('.') > 0) { base = base.slice(0, base.lastIndexOf('.')); }
        } catch (ev) { base = ''; }
        base = cleanVar(base).replace(/[\s_\-–—·.]+$/g, '');
        /* 纯哈希/纯数字的末段没有可读性，不如用时间戳 */
        if (!base || /^[0-9a-f]{8,}$/i.test(base) || /^[0-9]+$/.test(base)) {
            const d = date || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
            base = 'media_' + d;
        }
        return sanitizeName(base + '.' + e, { keepEmoji: true, keepPath: true });
    }

    return {
        // 页面识别
        extractPageInfo, extractArticle, extractTwitter, extractXiaohongshu, extractBilibili,
        extractDouyin,
        stripSiteTail, buildAuthorFull, SITE_RULES,
        // 模板与清洗
        fillTemplate, sanitizeName, dedupeNames, truncate,
        // 便捷入口
        buildName, buildNameFromInfo,
        MAX_NAME_LEN
    };
});
