/* ==========================================================
 * Adapter · X / Twitter（博主媒体枚举）
 *
 * 路线选择（Plucker XBD 6.0 实证，见 DEEP-08-Plucker.md）：
 *   X 的 GraphQL **必须**带 `X-Client-Transaction-Id` 等签名头，
 *   纯扩展伪造极难 → 采用**被动拦截**：捕获页面自己发出的 UserMedia/UserTweets 响应。
 *
 *   本 adapter 因此提供两种模式：
 *     A. 主动：firstPage 产出逻辑地址（需调用方在页面上下文补签名）
 *     B. 被动：parsePage 可直接吃页面响应（推荐）
 *
 * 端点（被动拦截识别）：
 *   /graphql/<queryId>/UserMedia     → 用户媒体时间线（profile「媒体」标签）
 *   /graphql/<queryId>/UserTweets    → 用户推文时间线（profile 主标签）
 *   /graphql/<queryId>/UserByScreenName → 屏幕名 → user_id
 *
 * 分页终止（Plucker 实证）：
 *   响应里找 content.cursorType === "Bottom" 的 entry → 到底，取它的 value 作 nextCursorId
 *
 * 响应结构：
 *   { data:{ user:{ result:{ timeline_v2:{ timeline:{ instructions:[
 *       { type:'TimelineAddEntries', entries:[
 *           { entryId:'profile-grid-0', content:{ itemContent:{ tweet_results:{ result:{
 *               rest_id, legacy:{ full_text, extended_entities:{ media:[
 *                   { type:'photo', media_url_https, ext_media_availability },
 *                   { type:'video', video_info:{ variants:[{bitrate,url}] } } ] } } } } } } } },
 *           { content:{ cursorType:'Bottom', value:'<cursor>' } } ] } ] } } } } }
 * ========================================================== */
(function (root) {
    'use strict';

    var API = 'https://x.com/i/api/graphql';

    /** 从 variants 里取最高码率 */
    function bestVariant(variants) {
        if (!Array.isArray(variants) || !variants.length) { return ''; }
        var best = '';
        var bestBr = -1;
        variants.forEach(function (v) {
            var u = String((v && v.url) || '');
            if (!u) { return; }
            /* m3u8 不适合直接下载，跳过（留给视频流处理） */
            if (/\.m3u8/i.test(u)) { return; }
            var br = Number(v.bitrate) || 0;
            if (br > bestBr) { bestBr = br; best = u; }
        });
        return best;
    }

    /** 一条 tweet → 统一 items（可能多图 + 一个视频） */
    function toItems(tweet, ownerName, ownerId) {
        var t = tweet || {};
        var L = t.legacy || {};
        var out = [];
        var screen = '';
        var userId = '';
        try {
            var u = t.core && t.core.user_results && t.core.user_results.result;
            screen = (u && u.core && u.core.screen_name) || (u && u.legacy && u.legacy.screen_name) || '';
            userId = (u && u.rest_id) || '';
        } catch (e) { /* 结构变了就留空 */ }

        var text = String(L.full_text || '');
        var media = (L.extended_entities && L.extended_entities.media) ||
                    (L.entities && L.entities.media) || [];
        var restId = String(t.rest_id || '');
        var pageUrl = (screen && restId) ? ('https://x.com/' + screen + '/status/' + restId) : '';

        var common = {
            title: text.slice(0, 120),
            pageUrl: pageUrl,
            author: screen || ownerName || '',
            authorId: userId || ownerId || '',
            statusId: restId,
            createdAt: Number(L.created_at ? Date.parse(L.created_at) : 0) || 0
        };

        media.forEach(function (m, i) {
            var type = String((m && m.type) || '');
            var id = String((m && m.id_str) || (restId + '-' + i));
            if (type === 'photo') {
                var pu = String(m.media_url_https || '');
                if (!pu) { return; }
                /* 原图：把 name=small 之类后缀去掉（X 的 CDN 支持 ?name=orig） */
                out.push(Object.assign({}, common, {
                    url: pu + (pu.indexOf('?') >= 0 ? '&' : '?') + 'name=orig',
                    kind: 'image', mediaId: id
                }));
                return;
            }
            if (type === 'video' || type === 'animated_gif') {
                var vi = (m && m.video_info) || {};
                var vu = bestVariant(vi.variants);
                if (!vu) { return; }
                out.push(Object.assign({}, common, {
                    url: vu, kind: 'video', mediaId: id
                }));
            }
        });
        return out;
    }

    /**
     * 产出逻辑地址。
     * ⚠️ 主动模式需要 queryId（X 的 GraphQL 路径里那段哈希），
     *    没有就返回 null —— 由调用方走被动拦截。
     */
    function firstPage(state) {
        var s = state || {};
        if (!s.queryId) { return null; }
        var kind = (s.subTab === 'media') ? 'UserMedia' : 'UserTweets';
        var variables = {
            userId: String(s.ownerId || ''),
            count: Number(s.count || 20),
            includePromotedContent: false
        };
        if (s.cursor) { variables.cursor = String(s.cursor); }
        var q = 'variables=' + encodeURIComponent(JSON.stringify(variables));
        return API + '/' + s.queryId + '/' + kind + '?' + q;
    }

    /** 在 instructions 里找 cursorType === 'Bottom'（Plucker 实证的终止判据） */
    function findBottomCursor(instructions) {
        var arr = Array.isArray(instructions) ? instructions : [];
        for (var i = 0; i < arr.length; i++) {
            var entries = (arr[i] && arr[i].entries) || [];
            for (var j = 0; j < entries.length; j++) {
                var c = entries[j] && entries[j].content;
                if (c && (c.cursorType === 'Bottom' || c.cursor_type === 'Bottom')) {
                    return String(c.value || '');
                }
            }
        }
        return '';
    }

    function parsePage(json, ctx) {
        var j = json || {};
        var c = ctx || {};
        /* GraphQL 错误结构 */
        if (Array.isArray(j.errors) && j.errors.length) {
            var e0 = j.errors[0] || {};
            return {
                items: [], cursor: null, hasMore: false,
                error: 'graphql:' + String(e0.message || '').slice(0, 80)
            };
        }
        var timeline = null;
        try {
            timeline = j.data.user.result.timeline_v2.timeline;
        } catch (e) {
            /* 也兼容 timeline（旧版） */
            try { timeline = j.data.user.result.timeline.timeline; } catch (e2) { timeline = null; }
        }
        if (!timeline) {
            return { items: [], cursor: null, hasMore: false, error: 'no-timeline' };
        }
        var instructions = timeline.instructions || [];
        var items = [];
        instructions.forEach(function (ins) {
            var entries = (ins && ins.entries) || [];
            entries.forEach(function (en) {
                var res = en && en.content && en.content.itemContent &&
                          en.content.itemContent.tweet_results &&
                          en.content.itemContent.tweet_results.result;
                if (!res) { return; }
                items = items.concat(toItems(res, c.ownerName, c.ownerId));
            });
        });

        var bottom = findBottomCursor(instructions);
        return {
            items: items,
            cursor: bottom ? { cursor: bottom, subTab: c.subTab || 'posts' } : null,
            hasMore: !!bottom && items.length > 0
        };
    }

    var spec = {
        platform: 'x',
        supports: ['owner'],
        requiresAuth: true,
        firstPage: firstPage,
        parsePage: parsePage,
        helpers: { passiveCapture: true, needsQueryId: true }
    };

    var A = root.VREnumAdapters;
    if (A && typeof A.register === 'function') { A.register(spec); }

    root.VRXAdapter = {
        spec: spec, firstPage: firstPage, parsePage: parsePage,
        toItems: toItems, bestVariant: bestVariant,
        findBottomCursor: findBottomCursor, _API: API
    };
})(typeof self !== 'undefined' ? self : this);
