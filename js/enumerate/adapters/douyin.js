/* ==========================================================
 * Adapter · 抖音（博主作品枚举）
 *
 * 端点（抖珍藏 2.8.58 协议，见 docs/research/extensions/DEEP-07-DouZhenCang.md）：
 *   GET www.douyin.com/aweme/v1/web/aweme/post/
 *       ?sec_user_id=<sec_uid>&count=<n>&max_cursor=<cursor>
 *       &device_platform=webapp&aid=6383&channel=channel_pc_web
 *       &version_code=290100&version_name=29.1.0
 *   ⚠️ 版本号 290100/29.1.0 与其它接口不同（抖珍藏 In() 实证）
 *
 * 响应结构（我们 js/douyin.js 已有同构解析）：
 *   { status_code:0, aweme_list:[{ aweme_id, desc, author:{nickname,sec_uid,unique_id},
 *                                  video:{play_addr:{url_list:[]}, cover:{url_list:[]}},
 *                                  images:[{url_list:[]}], create_time }],
 *     has_more:1, max_cursor:<n> }
 *
 * 必须在页面上下文 fetch（带登录态 cookie），否则风控。
 * ========================================================== */
(function (root) {
    'use strict';

    var API = 'https://www.douyin.com/aweme/v1/web/aweme/post/';

    /** 取 url_list 里最后一个（抖音把最高清放最后，与我们 douyin.js 一致） */
    function pickUrl(list) {
        if (!Array.isArray(list) || !list.length) { return ''; }
        return String(list[list.length - 1] || '');
    }

    /** aweme 条目 → 统一 item；图文返回多条（每条图一个 item） */
    function toItems(a, ownerName, ownerId) {
        var m = a || {};
        var out = [];
        var author = m.author || {};
        var title = String(m.desc || '');
        var pageUrl = m.aweme_id ? ('https://www.douyin.com/video/' + m.aweme_id) : '';
        var common = {
            title: title,
            pageUrl: pageUrl,
            author: String(author.nickname || ownerName || ''),
            authorId: String(author.sec_uid || ownerId || ''),
            awemeId: String(m.aweme_id || ''),
            createdAt: Number(m.create_time) || 0
        };

        /* 图文：images 有多张 → 每条一个 item */
        if (Array.isArray(m.images) && m.images.length) {
            m.images.forEach(function (img) {
                var u = pickUrl(img && img.url_list);
                if (!u) { return; }
                out.push(Object.assign({}, common, {
                    url: u, kind: 'image', mediaId: common.awemeId + '-img'
                }));
            });
            if (out.length) { return out; }
        }

        /* 视频：play_addr 优先，退 cover */
        var v = m.video || {};
        var vurl = pickUrl(v.play_addr && v.play_addr.url_list) ||
                   pickUrl(v.cover && v.cover.url_list);
        if (vurl) {
            out.push(Object.assign({}, common, {
                url: vurl, kind: 'video', mediaId: common.awemeId
            }));
        }
        return out;
    }

    function firstPage(state) {
        var s = state || {};
        var params = {
            sec_user_id: String(s.ownerId || ''),
            count: String(s.count || 20),
            max_cursor: String(s.maxCursor || 0),
            device_platform: 'webapp',
            aid: '6383',
            channel: 'channel_pc_web',
            /* 博主作品接口专用版本号（与其他接口不同） */
            version_code: '290100',
            version_name: '29.1.0'
        };
        var q = Object.keys(params).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
        return API + '?' + q;
    }

    function parsePage(json, ctx) {
        var j = json || {};
        var c = ctx || {};
        /* 抖音用 status_code，不是 code */
        var code = (j.status_code != null) ? j.status_code : j.code;
        var msg = j.status_msg || j.message || '';

        /* ⚠️ 抖音的特殊之处：status_code 可能仍是 0，但 status_msg 明确说未登录。
         * 抖珍藏的失败三态里 'not_logged_in' 是独立状态，不能只看 code。
         * （2026-11-18 单测抓到：只判 code 会把「未登录 + 空列表」当成正常空页） */
        var isLoginMsg = /未登录|not.?login/i.test(String(msg));
        if (isLoginMsg) {
            return {
                items: [], cursor: null, hasMore: false,
                error: 'not_logged_in: ' + msg
            };
        }
        if (code !== 0 && code != null) {
            return {
                items: [], cursor: null, hasMore: false,
                error: 'code:' + code + ' ' + msg
            };
        }
        var list = j.aweme_list || [];
        var items = [];
        list.forEach(function (a) {
            items = items.concat(toItems(a, c.ownerName, c.ownerId));
        });
        var hasMore = !!(j.has_more === 1 || j.has_more === true);
        var cur = Number(j.max_cursor);
        return {
            items: items,
            cursor: hasMore && isFinite(cur) ? { maxCursor: cur } : null,
            hasMore: hasMore && items.length > 0
        };
    }

    var spec = {
        platform: 'douyin',
        supports: ['owner'],
        requiresAuth: true,           // 博主作品列表要登录态
        firstPage: firstPage,
        parsePage: parsePage,
        helpers: { versionCode: '290100' }
    };

    var A = root.VREnumAdapters;
    if (A && typeof A.register === 'function') { A.register(spec); }

    root.VRDouyinAdapter = {
        spec: spec, firstPage: firstPage, parsePage: parsePage,
        toItems: toItems, _API: API
    };
})(typeof self !== 'undefined' ? self : this);
