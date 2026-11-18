/* ==========================================================
 * Adapter · 微博（博主时间线枚举）
 *
 * 端点：
 *   GET weibo.com/ajax/statuses/mymblog?uid=<uid>&page=<n>&feature=0[&since_id=<s>]
 *   需要登录态 cookie（否则返回未登录页）
 *
 * 响应结构：
 *   { ok:1, data:{ list:[{ id, idstr, text_raw, created_at,
 *                          user:{ id, screen_name },
 *                          pic_ids:[], pics:[{ url, large:{url} }],
 *                          page_info:{ media_info:{ mp4_1080p_mp4, mp4_720p_mp4,
 *                                                  stream_url_hd, stream_url } } }],
 *                  since_id:'<str>' } }
 *
 * 我们已有 weibo-album-core.js / weibo-backup.js 处理同类结构，
 * 字段名保持一致，避免两套解析。
 * ========================================================== */
(function (root) {
    'use strict';

    var API = 'https://weibo.com/ajax/statuses/mymblog';

    /** 微博图片：large 优先，退原图 url */
    function picUrl(p) {
        if (!p) { return ''; }
        if (typeof p === 'string') { return p; }
        if (p.large && p.large.url) { return String(p.large.url); }
        if (p.url) { return String(p.url); }
        return '';
    }

    /** 微博视频：1080 > 720 > hd > sd（与 weibo-backup.js 同序） */
    function videoUrl(mi) {
        var m = mi || {};
        return String(m.mp4_1080p_mp4 || m.mp4_720p_mp4 ||
                      m.stream_url_hd || m.stream_url || '');
    }

    function toItems(post, ownerName, ownerId) {
        var p = post || {};
        var out = [];
        var user = p.user || {};
        var mid = String(p.idstr || p.id || p.mid || '');
        var uid = String(user.id || ownerId || '');
        var text = String(p.text_raw || p.text || '');
        var pageUrl = mid ? ('https://weibo.com/' + uid + '/' + mid) : '';
        var common = {
            title: text.slice(0, 120),
            pageUrl: pageUrl,
            author: String(user.screen_name || ownerName || ''),
            authorId: uid,
            statusId: mid,
            createdAt: Number(p.created_at ? Date.parse(p.created_at) : 0) || 0
        };

        /* 视频优先（有 video 就下视频，图片另算） */
        var mi = (p.page_info && p.page_info.media_info) || null;
        var vu = videoUrl(mi);
        if (vu) {
            out.push(Object.assign({}, common, {
                url: vu, kind: 'video', mediaId: mid
            }));
        }

        /* 图片：pics 里逐个 */
        var pics = p.pics || [];
        if (Array.isArray(pics) && pics.length) {
            pics.forEach(function (pic, i) {
                var u = picUrl(pic);
                if (!u) { return; }
                out.push(Object.assign({}, common, {
                    url: u, kind: 'image', mediaId: mid + '-img' + i
                }));
            });
        }
        return out;
    }

    function firstPage(state) {
        var s = state || {};
        var params = {
            uid: String(s.ownerId || ''),
            page: String(s.pageNo || 1),
            feature: '0'
        };
        if (s.sinceId) { params.since_id = String(s.sinceId); }
        var q = Object.keys(params).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
        return API + '?' + q;
    }

    function parsePage(json, ctx) {
        var j = json || {};
        var c = ctx || {};
        if (j.ok != null && j.ok !== 1) {
            var msg = j.msg || j.message || '';
            var isLogin = /登录|login/i.test(String(msg)) || /login/i.test(String(j.url || ''));
            return {
                items: [], cursor: null, hasMore: false,
                error: (isLogin ? 'not_logged_in: ' : 'not_ok: ') + msg
            };
        }
        var d = j.data || {};
        var list = d.list || [];
        var items = [];
        list.forEach(function (p) { items = items.concat(toItems(p, c.ownerName, c.ownerId)); });

        var since = String(d.since_id || '');
        var hasMore = !!since && since !== String(c.sinceId || '');
        return {
            items: items,
            cursor: hasMore ? { sinceId: since, pageNo: (Number(c.pageNo) || 1) + 1 } : null,
            hasMore: hasMore && items.length > 0
        };
    }

    var spec = {
        platform: 'weibo',
        supports: ['owner'],
        requiresAuth: true,
        firstPage: firstPage,
        parsePage: parsePage,
        helpers: { pageMode: 'since_id' }
    };

    var A = root.VREnumAdapters;
    if (A && typeof A.register === 'function') { A.register(spec); }

    root.VRWeiboAdapter = {
        spec: spec, firstPage: firstPage, parsePage: parsePage,
        toItems: toItems, picUrl: picUrl, videoUrl: videoUrl, _API: API
    };
})(typeof self !== 'undefined' ? self : this);
