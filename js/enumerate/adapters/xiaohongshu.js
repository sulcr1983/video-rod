/* ==========================================================
 * Adapter · 小红书（博主笔记枚举）
 *
 * 端点：
 *   GET edith.xiaohongshu.com/api/sns/web/v1/user_posted
 *       ?num=<n>&cursor=<c>&user_id=<id>
 *   ⚠️ 必须带 `x-s` / `x-t` 签名头（前端 JS 算），且要登录态 cookie。
 *      纯扩展难伪造 → 实际走「页面上下文 fetch」（我们已有 xhs-media.js / xhs-ssr.js）
 *
 * 响应结构：
 *   { code:0, data:{ notes:[{ note_id, display_title, type:'normal'|'video',
 *                            cover:{ url_default, url_pre },
 *                            video:{ media:{ stream:{ h264:[{master_url}] } } },
 *                            user:{ user_id, nickname } }],
 *                   cursor:'<str>', has_more:true } }
 *
 * 兼容 SSR 快路径：页面 __INITIAL_STATE__ 里 user.notes 是同样的结构。
 * ========================================================== */
(function (root) {
    'use strict';

    var API = 'https://edith.xiaohongshu.com/api/sns/web/v1/user_posted';

    function toItems(note, ownerName, ownerId) {
        var n = note || {};
        var out = [];
        var user = n.user || {};
        var noteId = String(n.note_id || n.id || '');
        var title = String(n.display_title || n.title || '');
        var pageUrl = noteId ? ('https://www.xiaohongshu.com/explore/' + noteId) : '';
        var common = {
            title: title,
            pageUrl: pageUrl,
            author: String(user.nickname || ownerName || ''),
            authorId: String(user.user_id || ownerId || ''),
            noteId: noteId,
            createdAt: Number(n.time || 0) || 0
        };

        var isVideo = String(n.type || '') === 'video';

        /* 视频：优先取 h264 最高档 */
        if (isVideo) {
            var streams = (n.video && n.video.media && n.video.media.stream) || {};
            var h264 = streams.h264 || [];
            var best = '';
            var bestBr = -1;
            h264.forEach(function (s) {
                var u = String((s && s.master_url) || '');
                if (!u) { return; }
                var br = Number(s.avg_bitrate || s.video_bitrate || 0) || 0;
                if (br > bestBr) { bestBr = br; best = u; }
            });
            if (best) {
                out.push(Object.assign({}, common, {
                    url: best, kind: 'video', mediaId: noteId
                }));
                return out;
            }
        }

        /* 图片：cover.url_default（原图优先 url_pre） */
        var cover = n.cover || {};
        var imgUrl = String(cover.url_default || cover.url_pre || n.url || '');
        if (imgUrl) {
            out.push(Object.assign({}, common, {
                url: imgUrl, kind: 'image', mediaId: noteId
            }));
        }
        return out;
    }

    function firstPage(state) {
        var s = state || {};
        var params = {
            num: String(s.count || 20),
            cursor: String(s.cursor || ''),
            user_id: String(s.ownerId || '')
        };
        var q = Object.keys(params).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
        return API + '?' + q;
    }

    function parsePage(json, ctx) {
        var j = json || {};
        var c = ctx || {};
        if (j.code != null && j.code !== 0) {
            var msg = j.msg || j.message || '';
            var isLogin = /登录|login/i.test(String(msg));
            return {
                items: [], cursor: null, hasMore: false,
                error: (isLogin ? 'not_logged_in: ' : 'code:' + j.code + ' ') + msg
            };
        }
        /* 兼容两种外层：{data:{notes}} 或直接 {notes}（SSR） */
        var d = j.data || j;
        var notes = d.notes || d.items || [];
        var items = [];
        notes.forEach(function (n) { items = items.concat(toItems(n, c.ownerName, c.ownerId)); });

        var hasMore = !!(d.has_more === true || d.has_more === 1);
        var cur = String(d.cursor || '');
        return {
            items: items,
            cursor: hasMore && cur ? { cursor: cur } : null,
            hasMore: hasMore && items.length > 0
        };
    }

    var spec = {
        platform: 'xiaohongshu',
        supports: ['owner'],
        requiresAuth: true,
        firstPage: firstPage,
        parsePage: parsePage,
        helpers: { needsSignHeaders: true, ssrFastPath: '__INITIAL_STATE__' }
    };

    var A = root.VREnumAdapters;
    if (A && typeof A.register === 'function') { A.register(spec); }

    root.VRXhsAdapter = {
        spec: spec, firstPage: firstPage, parsePage: parsePage,
        toItems: toItems, _API: API
    };
})(typeof self !== 'undefined' ? self : this);
