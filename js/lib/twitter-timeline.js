/* ==========================================================
 * VRTwitterTimeline —— X(推特) 时间线响应解析 + 自动滚动判定（纯逻辑）
 *
 * 职责：
 *   · parseTimeline(payload)   ：把 X GraphQL 响应解析成「推文 + 媒体」扁平列表
 *   · parseEntries(payload)    ：只取 entries（推文条目与 cursor）
 *   · scrollStep(state, view)  ：判断自动滚动下一步（继续 / 等待 / 停止）
 *
 * 为什么要有这个模块（ADR-084）：
 *   Plucker 的做法是「抓 queryId + Authorization 后由扩展主动分页」，
 *   复用登录态主动发私有请求，风控面大。我们改为「自动滚动 + 旁读 X 自己发出的
 *   时间线响应」—— 于是解析必须能处理**同一条响应里**的所有数据结构：
 *   可见性包装、转推、引用、卡片媒体。纯逻辑放这里，便于 Node 单测，
 *   MAIN world 只负责 hook 与转发（js/lib/twitter-timeline-hook.js）。
 *
 * 数据来源（实读 Plucker 5.9 injected.js，见 docs/COMPETITOR-PLUCKER.md §3.2）：
 *   data.user.result...                       用户资料
 *   instructions[].entries[]                  TimelineAddEntries / TimelinePinEntry
 *   entry.content.itemContent.tweet_results.result
 *   moduleItems[] / TimelineTimelineModule    会话与模块内推文
 *   TimelineTimelineCursor(Bottom)            nextCursorId
 *
 * 约定：
 *   - 不碰 chrome.*、不写 DOM、零依赖
 *   - 浏览器/内容脚本挂 self.VRTwitterTimeline；Node 走 module.exports
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRTwitterTimeline = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    var MAX_TEXT = 120;          // 正文截断（文件名上限，与 naming.js 同口径）
    var MAX_WALK_DEPTH = 12;     // 递归找 instructions 的深度上限

    /* ---------------- 基础工具 ---------------- */

    /**
     * 驼峰/蛇形双读（2026-11-18，照抄 Plucker XBD 的字段容错）。
     *
     * 为什么必须有：X 的 GraphQL 响应在不同版本/不同端点下，
     * 同一个字段会以两种命名出现 —— `cursorType` 与 `cursor_type`、
     * `moduleItems` 与 `module_items`、`sortIndex` 与 `sort_index`。
     * Plucker（`injected.js`）对每一处都写成 `a || b` 双读：
     *     "Bottom"===(e?.cursorType || e?.cursor_type)
     *     e.moduleItems || e.module_items
     *     y.sortIndex || y.sort_index
     *     "TimelineTimelineItem"===(e?.entryType || e?.__typename)
     *
     * 我们原来只认驼峰。一旦 X 换成蛇形，解析会**静默返回空**（不报错、
     * 只是「什么都抓不到」），这类失败最难查。照抄它的双读即可免疫。
     *
     * @param {object} o  目标对象
     * @param {string} camel 驼峰名
     * @param {string} snake 蛇形名
     * @returns {*} 先取驼峰，为空再取蛇形
     */
    function pick2(o, camel, snake) {
        if (!o || typeof o !== 'object') { return undefined; }
        var v = o[camel];
        if (v !== undefined && v !== null && v !== '') { return v; }
        var w = o[snake];
        if (w !== undefined && w !== null && w !== '') { return w; }
        return v;
    }

    /** 深度优先收集所有名为 prop 的值（只走对象/数组，限制深度防环） */
    function collect(obj, prop, out, depth) {
        out = out || [];
        depth = depth || 0;
        if (!obj || typeof obj !== 'object' || depth > MAX_WALK_DEPTH) { return out; }
        if (Object.prototype.hasOwnProperty.call(obj, prop)) { out.push(obj[prop]); }
        if (Array.isArray(obj)) {
            for (var i = 0; i < obj.length; i++) { collect(obj[i], prop, out, depth + 1); }
        } else {
            for (var k in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, k)) {
                    collect(obj[k], prop, out, depth + 1);
                }
            }
        }
        return out;
    }

    /** 解包 TweetWithVisibilityResults（X 的「可能含敏感内容」包装） */
    function unwrapTweet(t) {
        if (!t || typeof t !== 'object') { return null; }
        if (t.__typename === 'TweetWithVisibilityResults' && t.tweet) { return t.tweet; }
        return t;
    }

    /** 去掉 t.co 短链尾巴、压缩换行 */
    function cleanText(s) {
        var t = String(s || '');
        var i = t.indexOf('https://t.co');
        if (i >= 0) { t = t.slice(0, i); }
        return t.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function toEpoch(v) {
        var d = new Date(v);
        return isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000);
    }

    function truncate(s, n) {
        var t = String(s || '');
        return t.length > n ? t.slice(0, n) : t;
    }

    /* ---------------- 媒体 ---------------- */

    /**
     * 从一个 media 对象提取我们需要的字段。
     * 视频取 video/mp4 里 bitrate 最高的一条（与 Plucker 同款排序）。
     */
    function normalizeMedia(m) {
        if (!m || typeof m !== 'object') { return null; }
        var type = String(m.type || '');
        var isVideo = type === 'video' || type === 'animated_gif';
        var url = '';

        if (isVideo) {
            var vs = (m.video_info && Array.isArray(m.video_info.variants))
                ? m.video_info.variants : [];
            var mp4 = vs.filter(function (v) {
                return v && /video\/mp4/i.test(String(v.content_type || '')) && v.url;
            });
            mp4.sort(function (a, b) { return (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0); });
            url = mp4.length ? String(mp4[0].url) : '';
        } else {
            url = String(m.media_url_https || '');
        }
        if (!url) { return null; }

        var id = String(m.id_str || m.media_key || '');
        return {
            id: id,
            mediaId: id,
            kind: isVideo ? 'video' : 'image',
            /* X 图片是 pbs.twimg.com/media/<id>?format=jpg&name=xxx；
             * 保留原样并把 name 提到 orig（下载要原图） */
            url: upgradeImage(url, isVideo),
            thumb: isVideo
                ? String(m.media_url_https || '')
                : upgradeImage(url, false).replace('name=orig', 'name=small'),
            ext: isVideo ? 'mp4' : imageExt(url),
            bitrate: isVideo ? Number((m.video_info && m.video_info.variants || []).reduce(function (mx, v) {
                return Math.max(mx, Number(v && v.bitrate) || 0);
            }, 0)) : 0
        };
    }

    function imageExt(url) {
        var s = String(url || '');
        var m = s.match(/[?&]format=([a-z0-9]+)/i);
        if (m) { return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase(); }
        m = s.match(/\.([a-z0-9]{2,4})(?:\?|$)/i);
        return m ? m[1].toLowerCase() : 'jpg';
    }

    /**
     * 图片地址提档到原图。
     * 两种形态都要照顾（2026-11-05 踩过的坑，见 bulk-profile.js:235）：
     *   .../HWSp9nzXsAAazfF?format=jpg&name=medium   → 保留 format，换 name=orig
     *   .../HWTE5NjXsAA5oDT.jpg                      → 保留后缀，补 ?name=orig
     */
    function upgradeImage(url, isVideo) {
        if (isVideo) { return String(url || ''); }
        var raw = String(url || '');
        if (!raw) { return ''; }
        var stem = raw.split('?')[0];
        var fmt = (raw.match(/[?&]format=([a-z0-9]+)/i) || [])[1] ||
            (/\.\w+$/.test(stem) ? stem.split('.').pop().toLowerCase() : 'jpg');
        if (fmt === 'jpeg') { fmt = 'jpg'; }
        if (/\.\w+$/.test(stem)) { return stem + '?name=orig'; }
        return stem + '?format=' + fmt + '&name=orig';
    }

    /**
     * 从一条 Tweet（已解包）里提取媒体，按优先级回退：
     *   ① 转推 → ② 本体 → ③ 引用 → ④ 卡片
     * 每一级都可能为空，取到第一个非空集合为止。
     */
    function extractMedia(tweet, isRetweet) {
        var lists = [];
        var rt = tweet && tweet.legacy && tweet.legacy.retweeted_status_result &&
            tweet.legacy.retweeted_status_result.result;
        var qt = tweet && tweet.quoted_status_result && tweet.quoted_status_result.result;
        var rtT = unwrapTweet(rt);
        var qtT = unwrapTweet(qt);

        if (rtT && rtT.legacy && rtT.legacy.extended_entities) {
            lists.push(rtT.legacy.extended_entities.media);
        }
        if (tweet && tweet.legacy && tweet.legacy.extended_entities) {
            lists.push(tweet.legacy.extended_entities.media);
        }
        if (qtT && qtT.legacy && qtT.legacy.extended_entities) {
            lists.push(qtT.legacy.extended_entities.media);
        }

        for (var i = 0; i < lists.length; i++) {
            if (Array.isArray(lists[i]) && lists[i].length) { return lists[i]; }
        }

        /* 卡片媒体：card.legacy.binding_values[].value.string_value 里是 JSON */
        var bv = (tweet && tweet.card && tweet.card.legacy && tweet.card.legacy.binding_values) || [];
        for (var j = 0; j < bv.length; j++) {
            var sv = bv[j] && bv[j].value && bv[j].value.string_value;
            if (!sv) { continue; }
            try {
                var parsed = JSON.parse(sv);
                if (parsed && parsed.media_entities) {
                    var arr = Object.keys(parsed.media_entities).map(function (k) {
                        return parsed.media_entities[k];
                    });
                    if (arr.length) { return arr; }
                }
            } catch (e) { /* 不是 JSON 的 binding value，跳过 */ }
        }
        return [];
    }

    /* ---------------- 推文 ---------------- */

    /** 规范化一条推文 → 我们内部的 item（不含 cursor 信息） */
    function normalizeTweet(raw, opts) {
        opts = opts || {};
        var t = unwrapTweet(raw);
        if (!t || (t.__typename && t.__typename !== 'Tweet' &&
            t.__typename !== 'TweetWithVisibilityResults')) { return null; }
        var legacy = t.legacy || {};
        var id = String(t.rest_id || legacy.id_str || '');
        if (!id) { return null; }

        var user = (t.core && t.core.user_results && t.core.user_results.result) ||
            (legacy.retweeted_status_result ? null : null) || {};
        var uLegacy = user.legacy || {};

        var rt = legacy.retweeted_status_result && legacy.retweeted_status_result.result;
        var rtT = unwrapTweet(rt);
        var isRetweet = !!rtT;

        /* 转推时：作者取原推作者；正文取原推 */
        var authorName = isRetweet
            ? ((rtT.core && rtT.core.user_results && rtT.core.user_results.result &&
                rtT.core.user_results.result.legacy && rtT.core.user_results.result.legacy.name) || '')
            : (uLegacy.name || '');
        var authorHandle = isRetweet
            ? ((rtT.core && rtT.core.user_results && rtT.core.user_results.result &&
                rtT.core.user_results.result.legacy &&
                rtT.core.user_results.result.legacy.screen_name) ||
                (rtT.legacy && rtT.legacy.user_id_str) || '')
            : (uLegacy.screen_name || '');
        var authorId = isRetweet
            ? String((rtT.legacy && rtT.legacy.user_id_str) || '')
            : String((legacy.user_id_str) ||
                (user.rest_id) || (uLegacy.id_str) || '');

        var text = cleanText(legacy.full_text);
        var rtText = isRetweet ? cleanText(rtT.legacy && rtT.legacy.full_text) : '';
        var displayText = rtText || text;
        /* 去掉 "RT @xxx: " 前缀 */
        displayText = displayText.replace(/^RT @\w+:\s*/, '').trim();

        var media = extractMedia(t, isRetweet).map(normalizeMedia).filter(Boolean);

        return {
            statusId: id,
            text: truncate(displayText, MAX_TEXT),
            post: displayText,
            author: authorName,
            authorId: authorHandle || authorId,
            retweetOf: isRetweet ? String((rtT.rest_id) || '') : '',
            isRetweet: isRetweet,
            isQuote: !!(legacy.is_quote_status || (t.quoted_status_result &&
                t.quoted_status_result.result)),
            createdAt: toEpoch(legacy.created_at),
            createdAtStr: String(legacy.created_at || ''),
            isPinned: !!opts.pinned,
            sortKey: opts.sortKey == null ? '' : String(opts.sortKey),
            media: media
        };
    }

    /**
     * 合并同一条推文的两次出现（2026-11-18，照抄 Plucker XBD 的 entityId 合并）。
     *
     * 为什么必须合并而不是「先到先得」：
     *   X 的分页响应里同一条推文可能出现在多批数据中，且**两批的媒体字段并不等价** ——
     *   一次只带 `media_url_https`（封面），另一次才带 `video_info.variants`（真流）。
     *   Plucker 的做法是建 `Map(medias by id)`，逐字段取「谁有值用谁」：
     *       i.set(e.id, t ? {...t, video: t.video || e.video,
     *                          photoDownloadUrl: t.photoDownloadUrl || e.photoDownloadUrl} : e)
     *       is_pinned: Boolean(n.is_pinned || t.is_pinned)
     *       is_quote:  Boolean(n.is_quote  || t.is_quote)
     *   我们原来 `if (seen[tid]) continue` 直接丢弃后到的数据，
     *   后果是「明明有视频却只下到一张封面」——这类静默降级很难被用户察觉。
     *
     * 注意类型升级：图片→视频时 URL 必须跟着换，否则会拿 jpg 地址当 mp4 下。
     *
     * @param {object} prev 已收录的条目
     * @param {object} raw  新出现的原始推文
     * @param {object} opts 与 normalizeTweet 相同
     * @returns {object} 合并后的条目
     */
    function mergeTweet(prev, raw, opts) {
        var next = normalizeTweet(raw, opts);
        if (!prev) { return next; }
        if (!next) { return prev; }

        var byId = Object.create(null);
        var order = [];
        (prev.media || []).forEach(function (m) {
            if (!m || !m.id) { return; }
            if (!byId[m.id]) { order.push(m.id); }
            byId[m.id] = m;
        });
        (next.media || []).forEach(function (m) {
            if (!m || !m.id) { return; }
            var old = byId[m.id];
            if (!old) {
                order.push(m.id);
                byId[m.id] = m;
                return;
            }
            /* 字段级补全，不整条覆盖 */
            var kind = old.kind;
            var url = old.url;
            var ext = old.ext;
            var br = Number(old.bitrate) || 0;
            var mBr = Number(m.bitrate) || 0;
            if (m.kind === 'video' && (kind !== 'video' || mBr > br)) {
                kind = 'video';
                url = m.url || url;
                ext = m.ext || ext;
                br = mBr;
            }
            byId[m.id] = {
                id: old.id,
                mediaId: old.mediaId || m.mediaId,
                kind: kind,
                url: url,
                thumb: old.thumb || m.thumb,
                ext: ext,
                bitrate: br
            };
        });

        var merged = {};
        Object.keys(prev).forEach(function (k) { merged[k] = prev[k]; });
        merged.media = order.map(function (id) { return byId[id]; });
        merged.isPinned = !!(prev.isPinned || next.isPinned);
        merged.isQuote = !!(prev.isQuote || next.isQuote);
        if (!merged.text && next.text) { merged.text = next.text; }
        if (!merged.post && next.post) { merged.post = next.post; }
        if (!merged.author && next.author) { merged.author = next.author; }
        if (!merged.authorId && next.authorId) { merged.authorId = next.authorId; }
        if (!merged.sortKey && next.sortKey) { merged.sortKey = next.sortKey; }
        return merged;
    }

    function isTweetResult(r) {
        if (!r || typeof r !== 'object') { return false; }
        return r.__typename === 'Tweet' || r.__typename === 'TweetWithVisibilityResults';
    }

    /* ---------------- 时间线 ---------------- */

    /**
     * 解析 GraphQL 响应体 → { tweets: [...], nextCursor: '' }
     *
     * 只认 instructions 里出现的时间线结构；其余响应（用户资料等）返回空。
     */
    function parseTimeline(payload) {
        var empty = { tweets: [], nextCursor: '' };
        if (!payload || typeof payload !== 'object') { return empty; }

        var instrs = collect(payload, 'instructions').filter(function (x) {
            return Array.isArray(x) && x.length;
        });
        if (!instrs.length) { return empty; }

        var entries = [];
        var pinnedIds = Object.create(null);
        var nextCursor = '';

        for (var i = 0; i < instrs.length; i++) {
            var arr = instrs[i];
            for (var j = 0; j < arr.length; j++) {
                var ins = arr[j];
                if (!ins || typeof ins !== 'object') { continue; }
                if (ins.type === 'TimelinePinEntry' && ins.entry) {
                    var pt = ins.entry.content && ins.entry.content.itemContent &&
                        ins.entry.content.itemContent.tweet_results &&
                        ins.entry.content.itemContent.tweet_results.result;
                    var pid = pt && (pt.rest_id || (unwrapTweet(pt) || {}).rest_id);
                    if (pid) { pinnedIds[String(pid)] = true; }
                    entries.push(ins.entry);
                } else if (ins.type === 'TimelineAddEntries' && Array.isArray(ins.entries)) {
                    entries = entries.concat(ins.entries);
                } else if (ins.type === 'TimelineAddToModule' &&
                    Array.isArray(pick2(ins, 'moduleItems', 'module_items'))) {
                    /* 模块内的推文（会话线程）—— 字段名双读，照抄 Plucker */
                    var mItems = pick2(ins, 'moduleItems', 'module_items');
                    for (var k = 0; k < mItems.length; k++) {
                        var mi = mItems[k];
                        if (mi && mi.item && mi.item.itemContent) {
                            entries.push({
                                content: {
                                    entryType: 'TimelineTimelineItem',
                                    itemContent: mi.item.itemContent
                                }
                            });
                        }
                    }
                }
            }
        }

        var tweets = [];
        var seen = Object.create(null);   // statusId → tweets 数组下标（用于合并）

        for (var e = 0; e < entries.length; e++) {
            var entry = entries[e];
            var content = entry && entry.content;
            if (!content) { continue; }

            /* 底部 cursor：`TimelineTimelineCursor` + cursorType=Bottom
             * 字段名双读（照抄 Plucker）：X 不同版本的响应里
             * entryType/__typename、cursorType/cursor_type 两种命名都出现过。 */
            if (pick2(content, 'entryType', '__typename') === 'TimelineTimelineCursor' &&
                pick2(content, 'cursorType', 'cursor_type') === 'Bottom' && content.value) {
                nextCursor = String(content.value);
                continue;
            }

            var results = [];
            if (content.itemContent && content.itemContent.tweet_results &&
                content.itemContent.tweet_results.result) {
                results.push(content.itemContent.tweet_results.result);
            }
            if (content.__typename === 'TimelineTimelineModule' && Array.isArray(content.items)) {
                for (var c = 0; c < content.items.length; c++) {
                    var it = content.items[c];
                    if (it && it.item && it.item.itemContent && it.item.itemContent.tweet_results) {
                        results.push(it.item.itemContent.tweet_results.result);
                    }
                }
            }
            if (content.itemType !== 'TimelineTweet' &&
                content.__typename !== 'TimelineTimelineModule' &&
                !(content.itemContent && content.itemContent.tweet_results)) { continue; }

            for (var r = 0; r < results.length; r++) {
                var raw = results[r];
                if (!isTweetResult(raw)) { continue; }
                var tid = String(raw.rest_id || (unwrapTweet(raw) || {}).rest_id || '');
                if (!tid) { continue; }
                var opts = {
                    /* 字段名双读（照抄 Plucker 的 sortIndex || sort_index） */
                    sortKey: pick2(entry, 'sortIndex', 'sort_index'),
                    pinned: !!pinnedIds[tid]
                };
                /* 同一条推文重复出现 → **合并补全**（照抄 Plucker 的 entityId 合并），
                 * 不丢弃后到的那份：后到的那份往往才带 video_info.variants，
                 * 丢弃会导致「有视频却只下到封面」。 */
                if (seen[tid] !== undefined) {
                    var at = seen[tid];
                    tweets[at] = mergeTweet(tweets[at], raw, opts);
                    continue;
                }
                var item = normalizeTweet(raw, opts);
                if (item) {
                    seen[tid] = tweets.length;
                    tweets.push(item);
                }
            }
        }

        /* 排序：置顶在前，其余按 feedSortKey 大→小（X 的 sortIndex 是递减的），
         * 最后回退 created_at。BigInt 比较避免精度丢失。 */
        tweets.sort(function (a, b) {
            if (a.isPinned !== b.isPinned) { return a.isPinned ? -1 : 1; }
            var ra = a.sortKey, rb = b.sortKey;
            if (ra && rb) {
                try {
                    var ba = BigInt(ra), bb = BigInt(rb);
                    if (ba > bb) { return -1; }
                    if (ba < bb) { return 1; }
                } catch (e) {
                    if (ra !== rb) { return ra > rb ? -1 : 1; }
                }
            } else if (ra && !rb) {
                return -1;
            } else if (!ra && rb) {
                return 1;
            }
            return (b.createdAt || 0) - (a.createdAt || 0);
        });
        return { tweets: tweets, nextCursor: nextCursor };
    }

    /** 只用 payload，扁平产出「一个媒体 = 一条下载项」，供面板直接消费 */
    function parseMediaItems(payload, opts) {
        opts = opts || {};
        var res = parseTimeline(payload);
        var out = [];
        for (var i = 0; i < res.tweets.length; i++) {
            var t = res.tweets[i];
            for (var j = 0; j < t.media.length; j++) {
                var m = t.media[j];
                if (opts.kind && opts.kind !== 'all' && m.kind !== opts.kind) { continue; }
                out.push({
                    site: 'x',
                    key: 'x:' + m.kind + ':' + m.id,
                    kind: m.kind,
                    url: m.url,
                    thumb: m.thumb,
                    ext: m.ext,
                    title: t.text,
                    author: t.author,
                    authorId: t.authorId,
                    statusId: t.statusId,
                    mediaId: m.mediaId,
                    isRetweet: t.isRetweet,
                    pageUrl: t.authorId && t.statusId
                        ? 'https://x.com/' + t.authorId + '/status/' + t.statusId : '',
                    createdAt: t.createdAt
                });
            }
        }
        return { items: out, tweets: res.tweets, nextCursor: res.nextCursor };
    }

    /* ---------------- 自动滚动判定 ---------------- */

    /**
     * 决定下一步动作（纯函数，便于单测与「停止」按钮复用）。
     *
     * @param {object} state
     *   { rounds, idleRounds, lastCount, maxItems, maxRounds, scrollTop, scrollHeight,
     *     clientHeight, stopped, atBottomSeen }
     * @param {object} view 本轮观测 { count, atBottom }
     * @returns {{action:'continue'|'wait'|'stop', reason:string, state:object}}
     *
     * 终止条件（任一命中即 stop）：
     *   1. 用户已停止（state.stopped）
     *   2. 达到条目上限（maxItems）
     *   3. 达到轮次上限（maxRounds）
     *   4. 连续 idleLimit 轮没有新增（成长停滞后，加载结束的可靠信号）
     */
    function scrollStep(state, view) {
        var s = {
            rounds: (state && state.rounds) || 0,
            idleRounds: (state && state.idleRounds) || 0,
            lastCount: (state && state.lastCount) || 0,
            maxItems: (state && state.maxItems) || 5000,
            maxRounds: (state && state.maxRounds) || 400,
            idleLimit: (state && state.idleLimit) || 3,
            stopped: !!(state && state.stopped)
        };
        var v = view || {};
        var count = Number(v.count) || 0;

        if (s.stopped) { return { action: 'stop', reason: 'stopped', state: s }; }

        s.rounds += 1;
        if (count > s.lastCount) {
            s.idleRounds = 0;
        } else if (s.rounds > 1) {
            /* 首轮不计入 idle：刚点「开始抓取」时页面往往还没吐出第一批数据，
             * 把它算作「无新增」会白耗一次容错额度。 */
            s.idleRounds += 1;
        }
        s.lastCount = count;

        if (count >= s.maxItems) { return { action: 'stop', reason: 'max-items', state: s }; }
        if (s.rounds >= s.maxRounds) { return { action: 'stop', reason: 'max-rounds', state: s }; }
        if (s.idleRounds >= s.idleLimit) { return { action: 'stop', reason: 'idle', state: s }; }
        /* 已经到底但还有新增：再滚一轮（X 有时「到底」后仍会追加） */
        if (v.atBottom && s.idleRounds > 0) {
            return { action: 'stop', reason: 'bottom', state: s };
        }
        return { action: s.idleRounds > 0 ? 'wait' : 'continue', reason: '', state: s };
    }

    return {
        parseTimeline: parseTimeline,
        parseMediaItems: parseMediaItems,
        scrollStep: scrollStep,
        /* 以下导出仅便于单测 */
        _internal: {
            collect: collect,
            pick2: pick2,
            unwrapTweet: unwrapTweet,
            normalizeTweet: normalizeTweet,
            normalizeMedia: normalizeMedia,
            upgradeImage: upgradeImage,
            extractMedia: extractMedia,
            cleanText: cleanText
        }
    };
});
