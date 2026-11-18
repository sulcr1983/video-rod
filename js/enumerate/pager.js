/* ==========================================================
 * 枚举层 · 分页器（纯构造器，不发请求）
 * 范式来源：抖珍藏 s.js 的 class I —— 分页参数与 fetch 解耦。
 * 这样「翻页逻辑」可以完全用 fixture 单测，不碰网络。
 *
 * 契约：
 *   createPager({platform, ownerId, subTab, query}) → pager
 *   pager.start()          → 第一页 URL
 *   pager.advance(json, n) → 下一页 URL；无下一页返回 null
 *   pager.hasMore()        → 是否还能翻
 *   pager.cursor()         → 当前游标（用于断点续跑持久化）
 *   pager.restore(cursor)  → 从断点恢复
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VREnumPager = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (_rootArg) {
    'use strict';

    /* UMD 的 root 在 Node require 时可能不是全局对象（this 在模块作用域里是 exports）。
     * 这里显式解析一次，保证 adapter 注册表能被找到。 */
    var root = _rootArg;
    if (!root || (typeof root.VREnumAdapters === 'undefined' && !root.globalThis)) {
        if (typeof globalThis !== 'undefined') { root = globalThis; }
    }
    if (!root) { root = _rootArg || {}; }

    var DEFAULT_COUNT = 20;

    function toInt(v, dft) {
        var n = Math.trunc(Number(v));
        return (isFinite(n) && n >= 0) ? n : dft;
    }

    function str(v) { return String(v == null ? '' : v); }

    /* ---------------- 各平台的分页策略 ----------------
     * 每个策略实现：
     *   first(state)          → 初始 URL
     *   next(state, json, n)  → 下一页 URL / null
     *   readCursor(state)     → 可持久化的游标对象
     *   applyCursor(state, c) → 恢复游标
     */

    /** 抖音：cursor/offset + max_cursor，响应里 has_more + max_cursor
     *  依据：抖珍藏 s.js 的 Be/ge/pe/me 方法 + aweme/post 响应字段
     *  断点语义：first() 用 state.lastCursor 作为 max_cursor（初始 0），
     *  所以 restore() 之后再 start() 即从断点续跑。 */
    function douyinStrategy(state) {
        function make(cursor) {
            var p = new URL('https://www.douyin.com/aweme/v1/web/aweme/post/');
            p.searchParams.set('sec_user_id', state.ownerId);
            p.searchParams.set('count', String(state.count));
            p.searchParams.set('max_cursor', String(cursor));
            p.searchParams.set('device_platform', 'webapp');
            p.searchParams.set('aid', '6383');
            p.searchParams.set('channel', 'channel_pc_web');
            /* 博主作品接口的版本号比其他接口新（抖珍藏 In() 用 29.1.0） */
            p.searchParams.set('version_code', '290100');
            p.searchParams.set('version_name', '29.1.0');
            return p.toString();
        }
        return {
            first: function () { return make(state.lastCursor || 0); },
            next: function (json) {
                var j = json || {};
                if (!j.has_more) { return null; }
                var cur = toInt(j.max_cursor, NaN);
                if (!isFinite(cur) || cur === state.lastCursor) { return null; }
                state.lastCursor = cur;
                return make(cur);
            },
            readCursor: function () { return { maxCursor: state.lastCursor || 0 }; },
            applyCursor: function (c) { state.lastCursor = toInt(c && c.maxCursor, 0); }
        };
    }

    /** B站：space.bilibili.com/<mid>/video 用 pn（页码），响应 vlist + page.count */
    function bilibiliStrategy(state) {
        function make(pageNo) {
            var p = new URL('https://api.bilibili.com/x/space/wbi/arc/search');
            p.searchParams.set('mid', state.ownerId);
            p.searchParams.set('ps', String(state.count));
            p.searchParams.set('pn', String(pageNo));
            p.searchParams.set('order', 'pubdate');
            return p.toString();
        }
        return {
            first: function () { return make(state.pageNo || 1); },
            next: function (json) {
                var d = (json && json.data) || {};
                var total = toInt(d.page && d.page.count, -1);
                var size = toInt(d.page && d.page.size, state.count) || state.count;
                if (total < 0) { return null; }
                var maxPage = Math.max(1, Math.ceil(total / size));
                if (state.pageNo >= maxPage) { return null; }
                state.pageNo += 1;
                return make(state.pageNo);
            },
            readCursor: function () { return { pageNo: state.pageNo || 1 }; },
            applyCursor: function (c) { state.pageNo = toInt(c && c.pageNo, 1) || 1; }
        };
    }

    /** X：GraphQL UserMedia / UserTweets，cursor 字符串，响应里 nextCursorId */
    function xStrategy(state) {
        var kind = state.subTab === 'media' ? 'UserMedia' : 'UserTweets';
        function make(cursor) {
            /* 真实请求需要 queryId + 签名，这里只产出「逻辑地址」，
             * 由执行器在页面上下文补签名（SR 模式）。 */
            var p = new URL('https://x.com/i/api/graphql/' + kind);
            p.searchParams.set('variables', JSON.stringify({
                userId: state.ownerId, count: state.count, cursor: cursor || null,
                includePromotedContent: false
            }));
            return p.toString();
        }
        return {
            first: function () { state.cursor = ''; return make(''); },
            next: function (json) {
                var j = json || {};
                var cur = str(j.nextCursorId || (j.data && j.data.nextCursorId) || '');
                if (!cur || cur === state.cursor) { return null; }
                state.cursor = cur;
                return make(cur);
            },
            readCursor: function () { return { cursor: state.cursor || '' }; },
            applyCursor: function (c) { state.cursor = str(c && c.cursor); }
        };
    }

    /** 小红书：cursor 字符串 + has_more */
    function xhsStrategy(state) {
        function make(cursor) {
            var p = new URL('https://edith.xiaohongshu.com/api/sns/web/v1/user_posted');
            p.searchParams.set('num', String(state.count));
            p.searchParams.set('cursor', cursor || '');
            p.searchParams.set('user_id', state.ownerId);
            return p.toString();
        }
        return {
            first: function () { state.cursor = ''; return make(''); },
            next: function (json) {
                var d = (json && json.data) || {};
                if (!d.has_more) { return null; }
                var cur = str(d.cursor);
                if (!cur || cur === state.cursor) { return null; }
                state.cursor = cur;
                return make(cur);
            },
            readCursor: function () { return { cursor: state.cursor || '' }; },
            applyCursor: function (c) { state.cursor = str(c && c.cursor); }
        };
    }

    /** 微博：page 页码 + since_id；响应 since_id 递增 */
    function weiboStrategy(state) {
        function make(pageNo, sinceId) {
            var p = new URL('https://weibo.com/ajax/statuses/mymblog');
            p.searchParams.set('uid', state.ownerId);
            p.searchParams.set('page', String(pageNo));
            p.searchParams.set('feature', '0');
            if (sinceId) { p.searchParams.set('since_id', sinceId); }
            return p.toString();
        }
        return {
            first: function () { state.pageNo = 1; return make(1, ''); },
            next: function (json) {
                var j = json || {};
                var since = str(j.since_id || (j.data && j.data.since_id) || '');
                if (!since || since === state.sinceId) { return null; }
                state.sinceId = since;
                state.pageNo += 1;
                return make(state.pageNo, since);
            },
            readCursor: function () { return { pageNo: state.pageNo || 1, sinceId: state.sinceId || '' }; },
            applyCursor: function (c) {
                state.pageNo = toInt(c && c.pageNo, 1) || 1;
                state.sinceId = str(c && c.sinceId);
            }
        };
    }

    /** YouTube：continuation token（复杂，先留接口） */
    function youtubeStrategy() {
        return {
            first: function () { return null; },
            next: function () { return null; },
            readCursor: function () { return {}; },
            applyCursor: function () {}
        };
    }

    var STRATEGIES = {
        douyin: douyinStrategy,
        bilibili: bilibiliStrategy,
        x: xStrategy,
        xiaohongshu: xhsStrategy,
        weibo: weiboStrategy,
        youtube: youtubeStrategy
    };

    /**
     * 创建分页器。
     *
     * 2026-11-18 架构调整：**优先用 adapter，内置策略降为兜底**。
     *   原因：adapter 是新的统一接口（js/enumerate/adapters/*），把「怎么取 URL」
     *   和「怎么解析响应」收敛到一处。内置 STRATEGIES 保留，是为了在
     *   adapter 未加载（如某些页面上下文）时仍能工作，也便于逐站迁移。
     *
     *   判断依据：VREnumAdapters 注册表里有该平台 → 走 adapter 路径。
     *
     * @param {{platform:string, ownerId:string, subTab?:string, count?:number,
     *          ownerName?:string, mixinKey?:string}} opt
     */
    function createPager(opt) {
        var o = opt || {};
        var platform = str(o.platform);

        /* ---------- 路径 A：adapter（优先） ---------- */
        var AR = root.VREnumAdapters;
        var adp = (AR && typeof AR.get === 'function') ? AR.get(platform) : null;
        if (adp) {
            return createAdapterPager(adp, o);
        }

        /* ---------- 路径 B：内置策略（兜底） ---------- */
        var strat = STRATEGIES[platform];
        if (!strat) {
            return {
                supported: false,
                start: function () { return null; },
                advance: function () { return null; },
                hasMore: function () { return false; },
                cursor: function () { return {}; },
                restore: function () {}
            };
        }
        var state = {
            ownerId: str(o.ownerId),
            subTab: str(o.subTab),
            count: toInt(o.count, DEFAULT_COUNT) || DEFAULT_COUNT,
            lastCursor: 0,
            pageNo: 1,
            cursor: '',
            sinceId: ''
        };
        var impl = strat(state);
        var more = true;

        return {
            supported: true,
            start: function () {
                more = true;
                var u = impl.first();
                if (!u) { more = false; }
                return u;
            },
            advance: function (json) {
                if (!more) { return null; }
                var u = impl.next(json || {});
                if (!u) { more = false; }
                return u || null;
            },
            /* hasMore 的语义是「调用方还应继续传下一页响应」。
             * 注意：impl.next 返回 null 可能只是「这份响应没有下一页」，
             * 也可能是「真的到末页」——两者都让本对象进入 more=false，
             * 但 restore()/start() 会重置，所以断点续跑不受影响。 */
            hasMore: function () { return more; },
            cursor: function () { return impl.readCursor(); },
            restore: function (c) {
                impl.applyCursor(c);
                /* 关键：恢复游标后必须把 hasMore 重置为 true，
                 * 否则从断点继续时 advance() 会因残留的 false 直接返回 null，
                 * 断点续跑形同虚设（本测试第一版就踩了这个坑）。 */
                more = true;
            },
            /* 便于单测观察内部状态 */
            _state: function () { return state; },
            _via: 'builtin'
        };
    }

    /**
     * 用 adapter 驱动的分页器。
     *
     * 与内置策略的差异（重要）：
     *   内置策略把「产出 URL」和「解析响应」分开（first/next）；
     *   adapter 统一成 firstPage(state) / parsePage(json, ctx)。
     *   这里做一层适配，让调用方拿到的 API 完全一致。
     */
    function createAdapterPager(adp, o) {
        var state = {
            ownerId: str(o.ownerId),
            ownerName: str(o.ownerName),
            subTab: str(o.subTab),
            count: toInt(o.count, DEFAULT_COUNT) || DEFAULT_COUNT,
            /* adapter 需要的额外参数（如 B站 mixinKey、X 的 queryId） */
            mixinKey: str(o.mixinKey),
            queryId: str(o.queryId),
            wts: o.wts,
            /* 2026-11-18（E2）：合集枚举 —— targetKind='collection' 时
             * 走站点的合集端点而不是博主端点。 */
            targetKind: str(o.targetKind) || 'owner',
            collectionId: str(o.collectionId),
            /* 2026-11-18（D10）：番剧 —— targetKind='bangumi' 时走 pgc 端点 */
            seasonId: str(o.seasonId),
            epId: str(o.epId),
            cursor: null,
            pageNo: 1,
            lastItems: [],
            lastError: ''
        };
        var more = true;

        return {
            supported: true,
            _via: 'adapter',
            adapter: adp,

            start: function () {
                more = true;
                var s = {
                    ownerId: state.ownerId,
                    ownerName: state.ownerName,
                    subTab: state.subTab,
                    count: state.count,
                    mixinKey: state.mixinKey,
                    queryId: state.queryId,
                    wts: state.wts,
                    /* 2026-11-18（E2）：合集枚举参数必须传到 adapter，
                     * 否则 firstPage 永远只会构造博主端点。 */
                    targetKind: state.targetKind,
                    collectionId: state.collectionId,
                    /* 2026-11-18（D10）：番剧参数同理 */
                    seasonId: state.seasonId,
                    epId: state.epId
                };
                /* 把游标摊平进 state（各 adapter 认不同字段） */
                if (state.cursor && typeof state.cursor === 'object') {
                    Object.keys(state.cursor).forEach(function (k) { s[k] = state.cursor[k]; });
                }
                var u = adp.firstPage(s);
                if (!u) { more = false; }
                return u;
            },

            /** 吃一页响应，返回 { items, url } —— url 为下一页（可能 null） */
            advance: function (json) {
                if (!more) { return null; }
                var ctx = {
                    ownerName: state.ownerName,
                    ownerId: state.ownerId,
                    subTab: state.subTab,
                    pageNo: state.pageNo,
                    sinceId: (state.cursor && state.cursor.sinceId) || '',
                    /* 2026-11-18（E2）：合集模式要传给 adapter，否则解析走错分支 */
                    targetKind: state.targetKind,
                    collectionId: state.collectionId,
                    /* 2026-11-18（D10）：番剧解析也走独立分支 */
                    seasonId: state.seasonId,
                    epId: state.epId
                };
                var r = adp.parsePage(json, ctx) || {};
                state.lastItems = Array.isArray(r.items) ? r.items : [];
                state.lastError = r.error || '';
                if (r.cursor) { state.cursor = r.cursor; }
                if (!r.hasMore) { more = false; return null; }

                /* 用新游标产出下一页 URL */
                var next = this.start();
                if (!next) { more = false; return null; }
                state.pageNo += 1;
                return next;
            },

            hasMore: function () { return more; },
            cursor: function () { return state.cursor || {}; },
            restore: function (c) {
                state.cursor = c || null;
                if (c && Number(c.pageNo)) { state.pageNo = Number(c.pageNo); }
                more = true;
            },
            /* adapter 路径下，items 从 advance 的结果里取 */
            items: function () { return state.lastItems.slice(); },
            error: function () { return state.lastError; },
            _state: function () { return state; }
        };
    }

    return {
        createPager: createPager,
        DEFAULT_COUNT: DEFAULT_COUNT,
        _strategies: STRATEGIES
    };
});