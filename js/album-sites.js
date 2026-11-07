/* ==========================================================
 * VRAlbumSites —— 站点图集适配表与分页规则（纯逻辑，可 Node 单测）
 *
 * 职责：
 *   · 按 URL 识别站点，给出「下一页怎么找」「原图怎么换」
 *   · 全部是纯函数：不碰 chrome.*、不读 DOM、不发请求
 *   · 浏览器/内容脚本/SW 挂 self.VRAlbumSites；Node 走 module.exports
 *
 * 为什么先做「URL 规则层」而不是「DOM 选择器层」：
 *   DOM 选择器随站点改版天天变，且本地无法在登录态下逐站实测；
 *   URL 规则（豆瓣 thumb→large、分页 ?start=、微博 since_id）是稳定的，
 *   可以写成单测逐条验证。DOM 只作为「通用兜底」，不冒充已实测适配。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRAlbumSites = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    /* ---------------- 站点表 -----------------------------
     * host:   域名正则
     * name:   展示名
     * page:   分页策略
     *           'query'  —— 翻页靠 URL 查询参数（豆瓣 start=、花瓣 max=）
     *           'next'   —— 页面上有「下一页」链接（通用兜底）
     *           'scroll' —— 只能滚动/接口，没有可靠分页
     * pageParam:  query 策略下要改的参数名
     * pageStep:   每次递增的步长（豆瓣相册 30 张一页）
     * original:   从缩略图 URL 派生原图的规则（见 originalOf）
     */
    var SITES = [
        {
            key: 'weibo',
            name: '微博',
            host: /(^|\.)weibo\.(com|cn)$/i,
            page: 'scroll',
            original: 'sinaimg'
        },
        {
            key: 'douban',
            name: '豆瓣',
            host: /(^|\.)douban\.com$/i,
            page: 'query',
            pageParam: 'start',
            pageStep: 30,
            // 相册列表页 /photos/ 与单张 /photos/photo/ 都要认
            albumPath: /\/photos?\//i,
            original: 'douban'
        },
        {
            key: 'duitang',
            name: '堆糖',
            host: /(^|\.)duitang\.com$/i,
            page: 'scroll',
            original: 'duitang'
        },
        {
            key: 'huaban',
            name: '花瓣',
            host: /(^|\.)huaban\.com$/i,
            page: 'query',
            pageParam: 'max',
            pageStep: 0,          // 花瓣是游标（最后一枚 pin id），不是偏移量
            original: 'huaban'
        },
        {
            key: 'tuchong',
            name: '图虫',
            host: /(^|\.)tuchong\.com$/i,
            page: 'next',
            original: 'tuchong'
        }
    ];

    /* ---------------- 站点识别 ---------------- */

    function hostOf(url) {
        try {
            return String(new URL(String(url || '')).hostname || '');
        } catch (e) { return ''; }
    }

    function matchSite(url) {
        var h = hostOf(url);
        if (!h) { return null; }
        for (var i = 0; i < SITES.length; i++) {
            if (SITES[i].host.test(h)) { return SITES[i]; }
        }
        return null;
    }

    /* ---------------- 原图派生 -------------
     * 各家 CDN 的缩略图→原图映射。规则来自公开的 URL 形态，逐条可测。
     */

    /* 微博：orj360/thumbnail/original 都是同一 pid，换前缀即可拿到原图。
     *   https://wx1.sinaimg.cn/orj360/abc123.jpg  →  .../large/abc123.jpg */
    function sinaimgOriginal(url) {
        var s = String(url || '');
        var m = /^https?:\/\/[^/]+\.sinaimg\.cn\/(?:orj\d*|thumbnail|crop\.\d+\.\d+\.\d+\.\d+|mw\d+|bmiddle|small)\/(.+)$/i.exec(s);
        if (!m) { return ''; }
        return 'https://wx3.sinaimg.cn/large/' + m[1];
    }

    /* 豆瓣相册：thumb / median / raw 三种尺寸，raw 即原图。
     *   .../view/photo/thumb/public/p1234567.jpg → .../view/photo/raw/public/p1234567.jpg
     *   .../view/photo/m/public/p1234567.jpg     → .../view/photo/raw/public/p1234567.jpg
     * 必须校验 CDN 域名：只看路径会把任意站点的 /view/photo/thumb/x.jpg 也改写掉（单测踩过）。 */
    function doubanOriginal(url) {
        var s = String(url || '');
        var m = /^https?:\/\/([^/]+)\/view\/photo\/(thumb|median|small|m|l|s)\/(.+)$/i.exec(s);
        if (!m) { return ''; }
        if (!/doubanio\.com|douban\.com/i.test(m[1])) { return ''; }
        return 'https://' + m[1] + '/view/photo/raw/' + m[3];
    }

    /* 堆糖：_300 / _600 之类的后缀在**文件名末尾**，去掉即原图。
     *   .../uploads/item/2020/01/01/abc_300.jpg → .../abc.jpg */
    function duitangOriginal(url) {
        var s = String(url || '');
        if (!/^https?:\/\/[^/]*duitang\.com\//i.test(s)) { return ''; }
        var m = /^(.+?)(_\d{2,4})(\.(?:jpg|jpeg|png|webp|gif))$/i.exec(s);
        if (!m) { return ''; }
        return m[1] + m[3];
    }

    /* 花瓣：hbimg.huaban.com/<hash>_<尺寸+格式>，去掉尺寸段即原图。
     * 真实形态（2026-11-07 实测 huaban.com 首页）：
     *   .../595342ef..._fw480webp    ← 480 宽 webp
     *   .../6bc81fc0..._fw192webp    ← 192 宽 webp
     *   .../abc_fw658                ← 无格式后缀
     * 早先的正则要求 `_fw\d+` 后紧跟可选 `.<ext>`，遇到 `_fw480webp`
     * （格式写在数字后面、没有点）就完全匹配不上 → 一张原图都派生不出来。
     * 现在把「数字后面的字母」也当作可选的格式段一起剥掉。 */
    function huabanOriginal(url) {
        var s = String(url || '');
        if (!/^https?:\/\/[^/]*hbimg\.huaban\.com\//i.test(s)) { return ''; }
        var m = /^(.+?)_(?:fw|sq|thumb|hd)\d+(?:[a-z]{2,5})?(?:\.[a-z]+)?$/i.exec(s);
        if (!m) { return ''; }
        return m[1];
    }

    /* 图虫：图片走 tuchong 自己的 CDN，常见 ?w= 降采样，交给通用去参数 */
    function tuchongOriginal(url) {
        var s = String(url || '');
        if (!/^https?:\/\/[^/]*tuchong\.com\//i.test(s)) { return ''; }
        return s;
    }

    var ORIGINAL_RULES = {
        sinaimg: sinaimgOriginal,
        douban: doubanOriginal,
        duitang: duitangOriginal,
        huaban: huabanOriginal,
        tuchong: tuchongOriginal
    };

    /**
     * 按站点规则派生原图地址。派生不出时返回 ''（调用方保留原 URL）。
     *
     * 关键：**不能只按站点域名选规则**。
     * 页面在 weibo.com，但图片在 wx1.sinaimg.cn；页面在 huaban.com，
     * 图片在 hbimg.huaban.com。先 matchSite 再查规则会全部落空（单测踩过 8 条）。
     * 正确做法：优先用站点指定的规则，失败再按 CDN 特征逐条尝试。
     */
    function originalOf(url, site) {
        var s = String(url || '');
        if (!s) { return ''; }
        var st = site || matchSite(s);
        var tried = Object.create(null);
        var out = '';

        // ① 站点指定的规则优先
        var key = st && st.original;
        if (key && ORIGINAL_RULES[key]) {
            tried[key] = 1;
            try { out = ORIGINAL_RULES[key](s) || ''; } catch (e) { out = ''; }
            if (out && out !== s) { return out; }
        }
        // ② 回退：按 URL 自身的 CDN 特征逐条尝试（跨域 CDN 是常态）
        for (var k in ORIGINAL_RULES) {
            if (!Object.prototype.hasOwnProperty.call(ORIGINAL_RULES, k)) { continue; }
            if (tried[k]) { continue; }
            try { out = ORIGINAL_RULES[k](s) || ''; } catch (e) { out = ''; }
            if (out && out !== s) { return out; }
        }
        return '';
    }

    /* ---------------- 分页 ---------------- */

    /**
     * 由当前页 URL 算出下一页 URL。
     * @param {string} url  当前页地址
     * @param {object} site matchSite 的结果（可为 null）
     * @param {object} opt  { nextHref: 页面里找到的「下一页」链接 }
     * @returns {string} 下一页绝对地址；没有下一页返回 ''
     */
    function nextPageUrl(url, site, opt) {
        var o = opt || {};
        var st = site || matchSite(url);
        if (!st) {
            // 无适配站点：只认页面自己给的 rel=next
            return o.nextHref ? abs(url, o.nextHref) : '';
        }
        if (st.page === 'query') {
            var cur = 0;
            try {
                var u = new URL(url);
                cur = Number(u.searchParams.get(st.pageParam)) || 0;
                if (st.pageStep === 0) {
                    // 游标式（花瓣 max=）：必须由页面提供下一枚游标，不能瞎加
                    if (!o.nextCursor) { return ''; }
                    u.searchParams.set(st.pageParam, String(o.nextCursor));
                } else {
                    u.searchParams.set(st.pageParam, String(cur + st.pageStep));
                }
                u.hash = '';
                return u.toString();
            } catch (e) { return ''; }
        }
        // 'next' / 'scroll'：靠页面里的下一页链接
        return o.nextHref ? abs(url, o.nextHref) : '';
    }

    function abs(base, href) {
        try { return new URL(String(href), String(base)).toString(); } catch (e) { return ''; }
    }

    /**
     * 从页面里抽「下一页」候选（纯字符串处理，调用方传入已解析的候选数组）。
     * 之所以不在这里读 DOM：SW 没有 DOM，页面侧才读；这里只做归一与去重。
     * @param {Array} candidates [{href, text, rel}]
     */
    function pickNext(candidates) {
        var list = Array.isArray(candidates) ? candidates : [];
        for (var i = 0; i < list.length; i++) {
            var c = list[i] || {};
            if (c.rel && /next/i.test(c.rel) && c.href) { return c.href; }
        }
        for (var j = 0; j < list.length; j++) {
            var d = list[j] || {};
            var t = String(d.text || '').trim();
            if (d.href && (/^(下一页|下页|next|›|»|→)$/i.test(t) || /下一页/.test(t))) { return d.href; }
        }
        return '';
    }

    /**
     * 判断某 URL 是否属于「图片地址」而非详情页——分页时用来避免把详情页当下一页。
     */
    function looksLikeAlbumPage(url) {
        var s = String(url || '');
        if (!s) { return false; }
        if (/\.(jpg|jpeg|png|webp|gif|avif|bmp)$/i.test(s.split('?')[0])) { return false; }
        return true;
    }

    return {
        SITES: SITES,
        matchSite: matchSite,
        hostOf: hostOf,
        originalOf: originalOf,
        nextPageUrl: nextPageUrl,
        pickNext: pickNext,
        looksLikeAlbumPage: looksLikeAlbumPage,
        ORIGINAL_RULES: ORIGINAL_RULES
    };
});
