/* ==========================================================
 * VRSiteName —— 网站名称自动提取（纯逻辑，可 Node 单测）
 *
 * 为什么需要它：
 *   资源库左栏的「来源」过去只有一个写死的 8 站平台字典，其余全落进
 *   「其他网页」。而几乎所有站点（中英文都一样）都在页面里声明了站名：
 *   og:site_name / application-name / PWA manifest / JSON-LD publisher。
 *   这些数据一直没人读，导致「花瓣」「Pixso」只能显示成 huaban.com。
 *
 * 设计约束：
 *   · 纯函数，不碰 chrome.*、不发请求。manifest 需要 fetch，拆成两步：
 *     screen() 同步出候选 + manifest 地址，调用方取回 JSON 后再 applyManifest()。
 *   · 提取优先级从「站点自己声明」到「猜」：
 *       og:site_name → application-name → apple-mobile-web-app-title
 *       → PWA manifest → JSON-LD publisher → <title> 尾部
 *   · 拿不准就返回空串，绝不用域名冒充站名 —— 由调用方决定回退。
 *   · 浏览器/内容脚本/Node 三处可用：挂 self.VRSiteName，Node 走 module.exports。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRSiteName = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    /** 站名长度上限：超了基本不是名字而是标题，判为不可信 */
    var MAX_NAME_LEN = 30;

    /* ---------------- 主机 / 可注册域名 ---------------- */

    /**
     * 多级公共后缀。目的只有一个：别把 v.qq.com 归到 qq.com、
     * 别把 example.com.cn 砍成 com.cn。
     * 不追求完整 PSL（那要几十 KB 数据），覆盖常见中文/国际后缀即可。
     */
    var MULTI_SUFFIX = {
        'com.cn': 1, 'net.cn': 1, 'org.cn': 1, 'gov.cn': 1, 'edu.cn': 1, 'ac.cn': 1,
        'co.uk': 1, 'org.uk': 1, 'ac.uk': 1, 'gov.uk': 1, 'me.uk': 1, 'ltd.uk': 1,
        'co.jp': 1, 'ne.jp': 1, 'or.jp': 1, 'ac.jp': 1,
        'com.hk': 1, 'org.hk': 1, 'net.hk': 1, 'edu.hk': 1,
        'com.tw': 1, 'org.tw': 1, 'net.tw': 1,
        'com.sg': 1, 'com.my': 1, 'com.ph': 1, 'com.vn': 1, 'co.th': 1,
        'com.au': 1, 'net.au': 1, 'org.au': 1, 'co.nz': 1,
        'com.br': 1, 'com.mx': 1, 'com.ar': 1, 'com.co': 1,
        'co.kr': 1, 'or.kr': 1,
        'co.in': 1, 'net.in': 1, 'org.in': 1,
        'co.za': 1, 'com.tr': 1, 'com.ua': 1, 'com.ru': 1,
        'com.sa': 1, 'com.eg': 1, 'co.il': 1
    };

    /**
     * 「独立产品子域」：按可注册域名会被归并到主域，但它们是不同产品，
     * 归并后会让资源库把两种素材混进一个站点。只收录确有其事的，
     * 不追求覆盖 —— 这是归并规则的边界修正，不是分类白名单。
     *   v.qq.com   腾讯视频（磁盘上已有 其他网页/v.qq.com/）
     *   y.qq.com   QQ音乐
     *   music.163.com 网易云音乐
     * 注意：m.weibo.cn / www.xxx.com 这类「同一产品的另一个入口」不在此列，
     *       它们应当正常归并到 weibo.cn / xxx.com。
     */
    var KEEP_SUBDOMAIN = {
        'v.qq.com': 1,
        'y.qq.com': 1,
        'music.163.com': 1
    };

    function hostOf(url) {
        var s = String(url || '').trim();
        if (!s) { return ''; }
        var h = '';
        try {
            h = new URL(s).hostname || '';
        } catch (e) {
            var m = s.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
            if (m) { h = m[1].replace(/^[^@]*@/, '').replace(/:\d+$/, ''); }
            else if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.split('/')[0])) { h = s.split('/')[0].split(':')[0]; }
        }
        h = String(h || '').toLowerCase().replace(/\.$/, '');
        return h.replace(/^www\./, '');
    }

    function isIp(host) {
        return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.indexOf(':') >= 0
            || host === 'localhost' || /^\[/.test(host);
    }

    /**
     * 可注册域名：huaban.com / pixso.cn / example.com.cn / v.qq.com。
     * IP、localhost 原样返回（不能按点切）。
     */
    function registrableDomain(host) {
        var h = String(host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
        if (!h || isIp(h)) { return h; }
        if (KEEP_SUBDOMAIN[h]) { return h; }
        var segs = h.split('.');
        if (segs.length <= 2) { return h; }
        var last2 = segs.slice(-2).join('.');
        if (MULTI_SUFFIX[last2] && segs.length >= 3) { return segs.slice(-3).join('.'); }
        return last2;
    }

    /* ---------------- 名称清洗 ---------------- */

    var EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu;

    /** 整段就是噪音的，直接判死 */
    var NOISE_ALL = /^(首页|主页|官网|官方网站|网站首页|home|homepage|home\s*page|index|official\s*(site|website)?|untitled|无标题|加载中|loading|欢迎光临|欢迎)$/i;

    /** 名字尾巴上的噪音：「xxx官网」「xxx 官方网站」「xxx - Home」 */
    var NOISE_TAIL = /(?:\s*[-–—|·]\s*)?(?:官方网站|官网|网站首页|首页|主页|official\s*(?:web)?site|home\s*page|home)\s*$/i;

    var WRAP_RE = /^[\s\-–—|·:：,，.。'"“”‘’`《》()（）\[\]【】<>]+|[\s\-–—|·:：,，.。'"“”‘’`《》()（）\[\]【】<>]+$/g;

    /**
     * 清洗候选站名。返回空串表示「不可信」。
     * 注意不能把「花瓣网」这类含「网」的真名误删 —— 只删完整的噪音短语。
     */
    function cleanName(raw) {
        var s = String(raw == null ? '' : raw);
        if (!s) { return ''; }
        s = s.replace(/[\u0000-\u001F\u007F]/g, ' ');
        try { s = s.replace(EMOJI_RE, ''); } catch (e) { /* 旧引擎不支持 u 标志 */ }
        s = s.replace(/\s+/g, ' ').trim();
        s = s.replace(WRAP_RE, '');
        if (!s || NOISE_ALL.test(s)) { return ''; }

        /* 尾巴噪音最多剥两层：「花瓣网 - 官方网站」→「花瓣网」 */
        for (var i = 0; i < 2; i++) {
            var t = s.replace(NOISE_TAIL, '').replace(WRAP_RE, '');
            if (t === s) { break; }
            s = t;
        }
        if (!s || NOISE_ALL.test(s)) { return ''; }
        if (s.length > MAX_NAME_LEN) { return ''; }
        /* 至少含一个字母或文字：纯符号/纯数字不是站名。
         * 中日韩都要放行 —— 只认汉字会把「ニコニコ」「네이버」判死
         * （2026-11-07 校验脚本实测发现）。这里不用 \p{L}：那是 ES2018 语法，
         * 项目其余部分按 ES5 写，显式列范围最稳。 */
        if (!/[A-Za-z0-9\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(s)) { return ''; }
        return s;
    }

    /* ---------------- 页面提取 ---------------- */

    function q(doc, sel) {
        try { return doc && doc.querySelector ? doc.querySelector(sel) : null; } catch (e) { return null; }
    }
    function qa(doc, sel) {
        try { return doc && doc.querySelectorAll ? Array.prototype.slice.call(doc.querySelectorAll(sel)) : []; } catch (e) { return []; }
    }
    function attrOf(el, name) {
        return el && typeof el.getAttribute === 'function' ? (el.getAttribute(name) || '') : '';
    }
    function metaContent(doc, sel) {
        return String(attrOf(q(doc, sel), 'content') || '').trim();
    }

    /** <link rel="manifest"> 的绝对地址；调用方负责 fetch */
    function manifestHref(doc, pageUrl) {
        var el = q(doc, 'link[rel="manifest"]');
        var href = String(attrOf(el, 'href') || '').trim();
        if (!href) { return ''; }
        try { return new URL(href, pageUrl || (doc && doc.baseURI) || '').href; } catch (e) { return href; }
    }

    /** JSON-LD：publisher.name（也认 publisher 直接是字符串、@graph 嵌套） */
    function fromJsonLd(doc) {
        var list = qa(doc, 'script[type="application/ld+json"]');
        for (var i = 0; i < list.length; i++) {
            var raw = '';
            try { raw = String(list[i].textContent || '').trim(); } catch (e) { raw = ''; }
            if (!raw) { continue; }
            var data;
            try { data = JSON.parse(raw); } catch (e) { continue; }
            var found = findPublisher(data, 0);
            if (found) { return found; }
        }
        return '';
    }

    function findPublisher(node, depth) {
        if (!node || depth > 4) { return ''; }
        if (Array.isArray(node)) {
            for (var i = 0; i < node.length; i++) {
                var r = findPublisher(node[i], depth + 1);
                if (r) { return r; }
            }
            return '';
        }
        if (typeof node !== 'object') { return ''; }
        var pub = node.publisher;
        if (typeof pub === 'string' && pub.trim()) { return pub.trim(); }
        if (pub && typeof pub === 'object') {
            var n = typeof pub.name === 'string' ? pub.name : '';
            if (n && n.trim()) { return n.trim(); }
        }
        if (node['@graph']) {
            var g = findPublisher(node['@graph'], depth + 1);
            if (g) { return g; }
        }
        return '';
    }

    /**
     * <title> → 站名候选。
     *
     * 真实站点实测（2026-11-07）四种形态都要覆盖：
     *   「花瓣网 - 灵感之源，花瓣之间（创意图片大全…）」→ 首段「花瓣网」
     *   「知乎 - 有问题，就会有答案」                    → 首段「知乎」
     *   「豆瓣」                                          → 单段「豆瓣」
     *   「GitHub · Change is constant…」                  → 首段「GitHub」
     * 原先只取尾段且要求与域名主名重合，导致前三类全部落空（10 个站只成 2 个）。
     *
     * 误判防护：候选限长、含句读降权、纯数字否决、单段只认 ≤8 字且非日期。
     */
    function fromTitle(title, host) {
        var t = String(title || '').replace(/\s+/g, ' ').trim();
        if (!t) { return ''; }
        var parts = t.split(/\s*[-–—|·_]\s*/).filter(function (s) { return !!s; });
        if (!parts.length) { return ''; }

        /* 「标题 - 01」是批量命名/序号形态，不是「内容 - 站名」。
         * 这种情况整条都不采信：无论取哪段都不是站点名。 */
        if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1].trim())) {
            return '';
        }

        var base = String(host || '').split('.')[0].toLowerCase();
        var score = function (n) {
            if (!n || n.length < 2) { return -99; }
            var s = 0;
            if (n.length <= 8) { s += 3; }
            else if (n.length <= 12) { s += 1; }
            else { s -= 4; }
            /* 逗号/句号 = 更像描述句，不是站名 */
            if (/[，。！？、；：]/.test(n)) { s -= 4; }
            if (/^\d+$/.test(n)) { s -= 8; }
            if (/\d{4}\s*[年\-/]/.test(n)) { s -= 4; }
            var low = n.toLowerCase().replace(/\s+/g, '');
            if (base && (low.indexOf(base) >= 0 || base.indexOf(low) >= 0)) { s += 3; }
            return s;
        };

        if (parts.length === 1) {
            /* 单段标题：只有很短、不带句读、不像日期时才当站名 */
            var one = cleanName(parts[0]);
            if (!one || one.length > 8) { return ''; }
            if (/[，。！？、；：]/.test(one)) { return ''; }
            if (/\d{4}\s*[年\-/]/.test(one)) { return ''; }
            return one;
        }

        var cands = [];
        var pushCand = function (raw, order) {
            var n = cleanName(raw);
            if (!n) { return; }
            cands.push({ name: n, score: score(n), order: order });
        };
        pushCand(parts[0], 0);
        pushCand(parts[parts.length - 1], 1);

        cands.sort(function (a, b) {
            if (b.score !== a.score) { return b.score - a.score; }
            return a.order - b.order;     // 同分时优先首段
        });
        var best = cands[0];
        if (!best || best.score < 1) { return ''; }
        return best.name;
    }

    /** 兼容旧调用名：现在与 fromTitle 等价（同时认首段/尾段/单段） */
    function fromTitleTail(title, host) {
        return fromTitle(title, host);
    }

    /**
     * 同步扫描页面，给出站名候选。
     * @param {Document} doc
     * @param {string} pageUrl
     * @returns {{host:string, name:string, src:string, manifest:string, candidates:Array}}
     *   src: og | meta | jsonld | title | ''
     */
    function screen(doc, pageUrl) {
        var host = hostOf(pageUrl || (doc && doc.location && doc.location.href) || '');
        var candidates = [
            { src: 'og', name: cleanName(metaContent(doc, 'meta[property="og:site_name"]')) },
            { src: 'meta', name: cleanName(metaContent(doc, 'meta[name="application-name"]')) },
            { src: 'meta', name: cleanName(metaContent(doc, 'meta[name="apple-mobile-web-app-title"]')) },
            { src: 'jsonld', name: cleanName(fromJsonLd(doc)) },
            { src: 'title', name: fromTitleTail(doc && doc.title, host) }
        ];
        var picked = null;
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i].name) { picked = candidates[i]; break; }
        }
        return {
            host: host,
            name: picked ? picked.name : '',
            src: picked ? picked.src : '',
            manifest: manifestHref(doc, pageUrl),
            candidates: candidates.filter(function (c) { return !!c.name; })
        };
    }

    /**
     * 把 fetch 回来的 manifest JSON 合进 screen() 的结果。
     * manifest 名字比 <title> 猜出来的可信：只在当前来源为空或来自 title 时替换。
     */
    function applyManifest(result, manifestJson) {
        var out = result || { host: '', name: '', src: '', manifest: '', candidates: [] };
        if (!manifestJson || typeof manifestJson !== 'object') { return out; }
        var name = cleanName(manifestJson.short_name) || cleanName(manifestJson.name);
        if (!name) { return out; }
        if (out.name && out.src !== 'title') { return out; }
        out.name = name;
        out.src = 'manifest';
        out.candidates = (out.candidates || []).concat([{ src: 'manifest', name: name }]);
        return out;
    }

    /**
     * 从「原始 HTML 文本」提取站名（后台探测用，无 DOM）。
     * 为什么不用 DOMParser：service worker 里没有 DOM，也不值得为此引入解析库。
     * 站点声明这些 meta 的写法很固定，正则足够，且属性顺序不定要兼容。
     *
     * @param {string} html
     * @param {string} pageUrl
     * @returns {{host:string, name:string, src:string, title:string}}
     */
    function parseHtmlInfo(html, pageUrl) {
        var s = String(html || '');
        var host = hostOf(pageUrl || '');
        var titleEl = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        var title = titleEl ? decodeEntities(titleEl[1]).replace(/\s+/g, ' ').trim() : '';

        /* 收集所有 meta 标签，按 property/name → content 建立映射。
         * 属性顺序不固定（content 可能在 property 前），必须逐个解析。 */
        var metas = {};
        var re = /<meta\b[^>]*>/gi;
        var m;
        while ((m = re.exec(s)) !== null) {
            var tag = m[0];
            var key = attrVal(tag, 'property') || attrVal(tag, 'name');
            var val = attrVal(tag, 'content');
            if (!key || !val) { continue; }
            var k = key.toLowerCase();
            if (!metas[k]) { metas[k] = val; }
        }

        var cands = [
            { src: 'og', name: cleanName(metas['og:site_name']) },
            { src: 'meta', name: cleanName(metas['application-name']) },
            { src: 'meta', name: cleanName(metas['apple-mobile-web-app-title']) },
            { src: 'title', name: fromTitleTail(title, host) }
        ];
        for (var i = 0; i < cands.length; i++) {
            if (cands[i].name) {
                return { host: host, name: cands[i].name, src: cands[i].src, title: title };
            }
        }
        return { host: host, name: '', src: '', title: title };
    }

    /** 取某个标签里某属性的值（支持双引号/单引号/无引号） */
    function attrVal(tag, name) {
        var re = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i');
        var m = re.exec(tag);
        if (!m) { return ''; }
        return String(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]) || '');
    }

    /** 只处理最常见的几种实体，避免引入完整解码表 */
    function decodeEntities(s) {
        return String(s || '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ');
    }

    /**
     * 页面级缓存入口：内容脚本一次页面生命周期内重复调用只解析一次。
     * SPA 换页时 URL 变了会重新提取，不会把上一页的站名带过去。
     * @returns {string} 站名；取不到返回空串（绝不回退域名）
     */
    var _lastUrl = '';
    var _lastName = '';
    var _lastScreen = null;
    function pageSiteName(doc, url) {
        var u = String(url || '');
        if (u && u === _lastUrl && _lastScreen) { return _lastName; }
        var r;
        try { r = screen(doc, u); } catch (e) { r = { name: '', host: '', src: '', manifest: '', candidates: [] }; }
        _lastUrl = u;
        _lastName = r.name;
        _lastScreen = r;
        return _lastName;
    }

    return {
        MAX_NAME_LEN: MAX_NAME_LEN,
        hostOf: hostOf,
        isIp: isIp,
        registrableDomain: registrableDomain,
        cleanName: cleanName,
        fromTitle: fromTitle,
        fromTitleTail: fromTitleTail,
        fromJsonLd: fromJsonLd,
        manifestHref: manifestHref,
        screen: screen,
        pageSiteName: pageSiteName,
        parseHtmlInfo: parseHtmlInfo,
        applyManifest: applyManifest
    };
});
