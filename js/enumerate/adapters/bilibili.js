/* ==========================================================
 * Adapter · B站（UP 主作品枚举）
 *
 * 端点（2026-11-18 实测）：
 *   GET api.bilibili.com/x/space/wbi/arc/search?mid=&ps=&pn=&order=pubdate
 *   **必须 wbi 签名**（不带 → code -352 风控校验失败）
 *   旧端点 x/space/arc/search 已直接返回 HTTP 412
 *
 * 响应结构（实测）：
 *   { code:0, data:{ list:{ vlist:[{ bvid, aid, title, pic, author, mid,
 *                                    created, length, description }] },
 *                    page:{ pn, ps, count } } }
 *
 * 依赖：VRBiliWbi（js/enumerate/bili-wbi.js）产签名。
 * ========================================================== */
(function (root) {
    'use strict';

    var API = 'https://api.bilibili.com/x/space/wbi/arc/search';

    /** 从 vlist 条目 → 统一 item（字段契约见 normalize.js） */
    function toItem(v, ownerName, ownerId) {
        var b = v || {};
        /* pic 是封面（可能是 //i0.hdslb.com/... 无协议） */
        var cover = String(b.pic || '');
        if (cover.indexOf('//') === 0) { cover = 'https:' + cover; }

        /* 视频页 URL：BV 号最稳（aid 也保留在 awemeId 之外的字段里） */
        var bvid = String(b.bvid || '');
        var pageUrl = bvid ? ('https://www.bilibili.com/video/' + bvid) : '';

        return {
            /* 统一契约：url 这里给封面（封面可直接下载）；
             * 视频本体由下游 vrVideoDownload 从 pageUrl 再解析 */
            url: cover,
            kind: 'image',
            title: String(b.title || ''),
            pageUrl: pageUrl,
            author: String(b.author || ownerName || ''),
            authorId: String(b.mid || ownerId || ''),
            /* B站作品身份用 bvid */
            mediaId: bvid,
            /* 附加：供下游取视频流时定位 */
            bvid: bvid,
            aid: b.aid || 0,
            duration: String(b.length || ''),
            createdAt: Number(b.created) || 0,
            /* 供 normalize 保留原始条目 */
            _raw: b
        };
    }

    /**
     * 合集内容端点（2026-11-18 实测，审计 E2）。
     *
     * ⚠️ 实测纠正：竞品（爱哔哔）用的是 `x/v2/medialist/resource/list`，
     *   但那**不是合集内容的正确端点** —— 实测同一 sid：
     *     · medialist/resource/list → 返回 10 条，内容是「该 mid 的其它视频」，
     *       total_count=9 与合集总数 11 不符；pn 翻页无效（第 2 页与第 1 页相同）；
     *       next_start_key 为空；oid 游标返回 -400。
     *     · seasons_archives_list  → 精确返回 11 条 == 合集 total，
     *       分页正常（page_size=10 → 10 + 1），且**免登录可用**（code 0）。
     *   所以合集枚举用后者。
     *
     * 参数：mid=UP主mid, season_id=合集id, page_num/page_size, sort_reverse
     */
    var ARCHIVES_API = 'https://api.bilibili.com/x/polymer/web-space/seasons_archives_list';

    /** 合集列表端点：拿某个 UP 主有哪些合集（sid + 名字 + 条数） */
    var SEASONS_API = 'https://api.bilibili.com/x/polymer/web-space/seasons_series_list';

    /** 合集模式：构造合集内容页 URL */
    function collectionFirstPage(state) {
        var s = state || {};
        var params = {
            mid: String(s.ownerId || ''),
            season_id: String(s.collectionId || ''),
            page_num: String(s.pageNo || 1),
            page_size: String(s.count || 30),
            sort_reverse: 'false',
            web_location: '333.1387'
        };
        var q = Object.keys(params).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
        return ARCHIVES_API + '?' + q;
    }

    /** 判断这次是不是合集枚举 */
    function isCollection(state) {
        var s = state || {};
        return String(s.targetKind || '') === 'collection' && !!String(s.collectionId || '');
    }

    /* ==========================================================
     * 番剧（2026-11-18，审计 D10）
     *
     * 端点实测：
     *   GET api.bilibili.com/pgc/view/web/season?season_id=<sid>
     *   GET api.bilibili.com/pgc/view/web/season?ep_id=<epid>
     *   两者都 code 0，都返回 `result.episodes[]`（**整季**，18 集实测），免登录可用。
     *
     * ⚠️ 研究文档记的 `pgc/view/web/ep/list` 实测也能用（code 0），
     *   但结构是 `{episodes, play_strategy, section}`、**不含 season_id/total**；
     *   `pgc/view/web/season` 信息更全，故选它。
     *
     * ⚠️ episodes[].duration 单位是**毫秒**（实测 421000 = 421 秒），
     *   与整博主 `vlist[].length`（"4:21" 字符串）不同，映射时按毫秒处理。
     * ========================================================== */
    var SEASON_API = 'https://api.bilibili.com/pgc/view/web/season';

    function isBangumi(state) {
        var s = state || {};
        return String(s.targetKind || '') === 'bangumi';
    }

    /** 番剧：构造剧集列表页 URL（season_id 优先；只有 ep_id 时也能拿到整季） */
    function bangumiFirstPage(state) {
        var s = state || {};
        var params = {};
        if (String(s.seasonId || '')) { params.season_id = String(s.seasonId); }
        else if (String(s.epId || '')) { params.ep_id = String(s.epId); }
        else { return ''; }
        var q = Object.keys(params).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
        return SEASON_API + '?' + q;
    }

    /** 番剧剧集 → 统一 item（episodes 结构与 vlist/archives 都不同） */
    function episodeToItem(e, ownerName, ownerId) {
        var b = e || {};
        var cover = String(b.cover || '');
        if (cover.indexOf('//') === 0) { cover = 'https:' + cover; }
        var bvid = String(b.bvid || '');
        return {
            url: cover,
            kind: 'image',
            title: String(b.title || b.long_title || b.show_title || ''),
            pageUrl: bvid ? ('https://www.bilibili.com/video/' + bvid) : '',
            author: ownerName || '',
            authorId: String(ownerId || ''),
            mediaId: bvid || String(b.ep_id || b.id || ''),
            bvid: bvid,
            epId: b.ep_id || b.id || 0,
            aid: b.aid || 0,
            /* duration 是毫秒（421000）→ 统一成秒的字符串，与整博主口径一致 */
            duration: (Number(b.duration) > 0) ? String(Math.round(Number(b.duration) / 1000)) : '',
            createdAt: Number(b.pub_time) || 0,
            _raw: b
        };
    }

    /** 解析番剧季响应：整季一次给全，没有分页 */
    function parseBangumiPage(json, ctx) {
        var j = json || {};
        var c = ctx || {};
        if (j.code !== 0) {
            return {
                items: [], cursor: null, hasMore: false,
                error: 'code:' + j.code + ' ' + (j.message || '')
            };
        }
        var r = j.result || j.data || {};
        var eps = r.episodes || [];
        var items = eps.map(function (e) {
            return episodeToItem(e, c.ownerName, c.ownerId);
        });
        return {
            items: items,
            cursor: null,
            /* 整季一次性返回，没有下一页 */
            hasMore: false,
            total: items.length,
            seasonTitle: String(r.season_title || r.title || '')
        };
    }

    /** 合集条目 → 统一 item（archives 结构，与 vlist 字段名不同，需单独映射） */
    function archiveToItem(a, ownerName, ownerId) {
        var b = a || {};
        var cover = String(b.pic || '');
        if (cover.indexOf('//') === 0) { cover = 'https:' + cover; }
        var bvid = String(b.bvid || '');
        return {
            url: cover,
            kind: 'image',
            title: String(b.title || ''),
            pageUrl: bvid ? ('https://www.bilibili.com/video/' + bvid) : '',
            author: ownerName || '',
            authorId: String(ownerId || ''),
            mediaId: bvid,
            bvid: bvid,
            aid: b.aid || 0,
            duration: String(b.duration || ''),
            createdAt: Number(b.pubdate) || 0,
            _raw: b
        };
    }

    /** 解析合集内容页 */
    function parseCollectionPage(json, ctx) {
        var j = json || {};
        var c = ctx || {};
        if (j.code !== 0) {
            return {
                items: [], cursor: null, hasMore: false,
                error: 'code:' + j.code + ' ' + (j.message || '')
            };
        }
        var d = j.data || {};
        var archives = d.archives || [];
        var page = d.page || {};
        var pn = Number(page.page_num) || 1;
        var ps = Number(page.page_size) || 30;
        var total = Number(page.total) || 0;
        var maxPage = ps > 0 ? Math.ceil(total / ps) : 1;

        var items = archives.map(function (a) {
            return archiveToItem(a, c.ownerName, c.ownerId);
        });

        return {
            items: items,
            cursor: { pageNo: pn + 1 },
            hasMore: pn < maxPage && archives.length > 0,
            total: total
        };
    }

    function firstPage(state) {
        var s = state || {};
        /* 合集走独立端点（不需要 wbi 签名，实测免登录可用） */
        if (isCollection(s)) { return collectionFirstPage(s); }
        /* 2026-11-18（D10）：番剧走 pgc 端点，同样免登录、无需签名 */
        if (isBangumi(s)) { return bangumiFirstPage(s); }
        var base = API;
        var params = {
            mid: String(s.ownerId || ''),
            ps: String(s.count || 20),
            pn: String(s.pageNo || 1),
            order: 'pubdate',
            /* 这两个是 wbi 接口的常规附带参数 */
            platform: 'web',
            web_location: '1550101'
        };
        /* 有签名器就签；没有就返回未签名 URL（调用方会拿到 -352，便于诊断） */
        var W = root.VRBiliWbi;
        if (W && typeof W.signUrl === 'function' && s.mixinKey) {
            return W.signUrl(base, params, s.mixinKey, s.wts);
        }
        var q = Object.keys(params).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
        return base + '?' + q;
    }

    /**
     * 解析一页响应。
     * @param {object} json
     * @param {object} [ctx] {ownerName, ownerId} —— 由执行器透传，供 toItem 补作者
     * @returns {{items:Array, cursor:object|null, hasMore:boolean, total?:number, error?:string}}
     */
    function parsePage(json, ctx) {
        var j = json || {};
        var c = ctx || {};
        /* 合集模式走独立解析（archives 结构与 vlist 不同） */
        if (c && String(c.targetKind || '') === 'collection') {
            return parseCollectionPage(json, c);
        }
        /* 2026-11-18（D10）：番剧解析（episodes 结构与 vlist/archives 都不同） */
        if (c && String(c.targetKind || '') === 'bangumi') {
            return parseBangumiPage(json, c);
        }
        if (j.code !== 0) {
            return {
                items: [], cursor: null, hasMore: false,
                error: 'code:' + j.code + ' ' + (j.message || '')
            };
        }
        var d = j.data || {};
        var list = (d.list && d.list.vlist) || [];
        var page = d.page || {};
        var pn = Number(page.pn) || 1;
        var ps = Number(page.ps) || 20;
        var total = Number(page.count) || 0;
        var maxPage = ps > 0 ? Math.ceil(total / ps) : 1;

        /* 转成统一 item（契约见 normalize.js 的 toItem 入参） */
        var items = list.map(function (v) {
            return toItem(v, c.ownerName, c.ownerId);
        });

        return {
            items: items,
            cursor: { pageNo: pn + 1 },
            hasMore: pn < maxPage && list.length > 0,
            total: total
        };
    }

    var spec = {
        platform: 'bilibili',
        supports: ['owner', 'collection'],
        requiresAuth: false,          // 公开 UP 主免登录可枚举（签名仍必需）
        firstPage: firstPage,
        parsePage: parsePage,
        helpers: { signer: 'bili-wbi', needsMixinKey: true }
    };

    var A = root.VREnumAdapters;
    if (A && typeof A.register === 'function') { A.register(spec); }

    /* 导出供单测（不进注册表也能测纯函数） */
    root.VRBiliAdapter = {
        spec: spec,
        firstPage: firstPage,
        parsePage: parsePage,
        toItem: toItem,
        /* 2026-11-18（D10）：番剧分支单独导出，便于逐条验证 */
        isBangumi: isBangumi,
        bangumiFirstPage: bangumiFirstPage,
        parseBangumiPage: parseBangumiPage,
        episodeToItem: episodeToItem,
        _API: API,
        _SEASON_API: SEASON_API
    };
})(typeof self !== 'undefined' ? self : this);
