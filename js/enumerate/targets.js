/* ==========================================================
 * 枚举层 · 博主目标识别（可被 SW / 页面 / Node 单测共用）
 * 纯同步函数，不碰 chrome.* / DOM / fetch。
 * 职责：给一个 URL，判断「这是不是一个博主的作品列表页」，从中提取 ownerId。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VREnumTargets = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    /* ---------------- 平台判据 ----------------
     * 只做「路径形态」判断，域名归 VRPath.detectPlatform（唯一真源）。
     * 每条规则返回 ownerId 或 null。
     */

    /** X/Twitter：x.com/<screen_name> 或 twitter.com/<screen_name>
     *  排除保留字与功能路径（home/explore/i/status/search/settings…） */
    var X_RESERVED = {
        home: 1, explore: 1, notifications: 1, messages: 1, i: 1, search: 1,
        settings: 1, compose: 1, login: 1, logout: 1, signup: 1, tos: 1,
        privacy: 1, about: 1, download: 1, jobs: 1, intent: 1, share: 1,
        hashtag: 1, list: 1, bookmark: 1, bookmarks: 1, communities: 1,
        premium: 1, verified: 1, account: 1, follows: 1, likes: 1
    };

    function parseX(u) {
        var segs = u.pathname.split('/').filter(Boolean);
        if (!segs.length) { return null; }
        var name = segs[0];
        if (X_RESERVED[String(name).toLowerCase()]) { return null; }
        /* 单段路径才是博主页；/name/status/123 是作品页，不是博主页 */
        if (segs.length > 1 && !/^(media|with_replies|highlights|articles|lists)$/i.test(segs[1])) {
            return null;
        }
        if (!/^[A-Za-z0-9_]{1,15}$/.test(name)) { return null; }
        var tab = segs[1] || 'posts';
        return {
            platform: 'x',
            ownerId: name,
            ownerKind: 'screen_name',
            subTab: /^media$/i.test(tab) ? 'media' : 'posts',
            pageUrl: 'https://x.com/' + name + (tab === 'media' ? '/media' : '')
        };
    }

    /** 抖音：douyin.com/user/<sec_uid>
     *  sec_uid 形如 MS4wLjABAAAA...（长串），也兼容纯数字 uid */
    function parseDouyin(u) {
        var m = u.pathname.match(/^\/user\/([A-Za-z0-9_\-]{10,})/);
        if (!m) { return null; }
        return {
            platform: 'douyin',
            ownerId: m[1],
            ownerKind: 'sec_uid',
            pageUrl: 'https://www.douyin.com/user/' + m[1]
        };
    }

    /** B站：space.bilibili.com/<mid>（也兼容 /<mid>/video 子页） */
    function parseBilibili(u) {
        var m = u.pathname.match(/^\/(\d{1,20})(?:\/|$)/);
        if (!m) { return null; }
        return {
            platform: 'bilibili',
            ownerId: m[1],
            ownerKind: 'mid',
            /* 2026-11-18（E2）：显式标注目标类型，避免调用方要靠「字段缺失」猜测。
             * collection 目标带 collectionId，owner 目标不带。 */
            targetKind: 'owner',
            pageUrl: 'https://space.bilibili.com/' + m[1] + '/video'
        };
    }

    /**
     * B站合集（2026-11-18，审计 E2）。
     *
     * 两种 URL 形态：
     *   ① space.bilibili.com/<mid>/channel/collectiondetail?sid=<合集id>
     *      —— UP 主空间的「合集和列表」页，最常见的入口
     *   ② www.bilibili.com/medialist/detail/ml<id>
     *      —— 收藏夹/合集独立详情页
     *
     * 为什么单独解析而不用 parseBilibili：
     *   ① 的 pathname 形如 `/<mid>/channel/collectiondetail`，会被 parseBilibili
     *   的 `^\/(\d+)(?:\/|$)` 命中，于是合集页被错当成「整博主」，
     *   枚举出来的是该 UP 主**全部**作品而不是这个合集。必须先判合集。
     *
     * @returns {{platform,ownerId,ownerKind,targetKind,collectionId,pageUrl}|null}
     */
    function parseBilibiliCollection(u) {
        /* 形态 ①：UP 主空间里的合集页 */
        var m = /^\/(\d{1,20})\/channel\/collectiondetail\/?$/.exec(u.pathname);
        if (m) {
            var sid = u.searchParams.get('sid') || u.searchParams.get('season_id') || '';
            if (!/^\d{1,20}$/.test(sid)) { return null; }
            return {
                platform: 'bilibili',
                ownerId: m[1],              // mid（合集属于某个 UP 主）
                ownerKind: 'mid',
                targetKind: 'collection',
                collectionId: sid,
                pageUrl: 'https://space.bilibili.com/' + m[1] + '/channel/collectiondetail?sid=' + sid
            };
        }
        /* 形态 ②：medialist 独立详情页（可能没有 mid，只能用合集 id 当身份） */
        var m2 = /^\/medialist\/detail\/(?:ml)?(\d{1,20})\/?$/.exec(u.pathname);
        if (m2) {
            return {
                platform: 'bilibili',
                ownerId: m2[1],
                ownerKind: 'collection_id',
                targetKind: 'collection',
                collectionId: m2[1],
                pageUrl: 'https://www.bilibili.com/medialist/detail/ml' + m2[1]
            };
        }
        return null;
    }

    /** 小红书：xiaohongshu.com/user/profile/<user_id> */
    function parseXhs(u) {
        var m = u.pathname.match(/^\/user\/profile\/([A-Za-z0-9]{10,})/);
        if (!m) { return null; }
        return {
            platform: 'xiaohongshu',
            ownerId: m[1],
            ownerKind: 'user_id',
            pageUrl: 'https://www.xiaohongshu.com/user/profile/' + m[1]
        };
    }

    /** 微博：weibo.com/u/<uid> 或 weibo.com/<uid>（纯数字，≥6 位） */
    function parseWeibo(u) {
        var m = u.pathname.match(/^\/u\/(\d{6,})/) || u.pathname.match(/^\/(\d{6,})(?:\/|$)/);
        if (!m) { return null; }
        return {
            platform: 'weibo',
            ownerId: m[1],
            ownerKind: 'uid',
            pageUrl: 'https://weibo.com/u/' + m[1]
        };
    }

    /** YouTube：youtube.com/@handle 或 /channel/<id> 或 /c/<name> */
    function parseYoutube(u) {
        var p = u.pathname;
        var m = p.match(/^\/(@[A-Za-z0-9_.\-]{3,})/) ||
                p.match(/^\/channel\/(UC[A-Za-z0-9_\-]{20,})/) ||
                p.match(/^\/c\/([A-Za-z0-9_.\-]{2,})/);
        if (!m) { return null; }
        return {
            platform: 'youtube',
            ownerId: m[1],
            ownerKind: m[1][0] === '@' ? 'handle' : (m[1].slice(0, 2) === 'UC' ? 'channel_id' : 'c_name'),
            pageUrl: 'https://www.youtube.com/' + m[1]
        };
    }

    /* 主机 → 解析器。注意：不能用 detectPlatform，因为 space.bilibili.com
     * 与 www.bilibili.com 同属 bilibili，但只有前者是博主页。 */
    function hostOf(h) {
        return String(h || '').toLowerCase();
    }

    /**
     * B站番剧（2026-11-18，审计 D10）。
     *
     * URL 形态：
     *   www.bilibili.com/bangumi/play/ss<season_id>   ← 季（整季剧集列表）
     *   www.bilibili.com/bangumi/play/ep<ep_id>       ← 单集（也返回整季，实测）
     *
     * 端点实测（2026-11-18）：
     *   GET api.bilibili.com/pgc/view/web/season?season_id=<sid>
     *   GET api.bilibili.com/pgc/view/web/season?ep_id=<epid>
     *   两者都返回 code 0 + `result.episodes[]`（含 bvid/title/cover/duration），
     *   且**免登录可用**（与合集端点同性质）。
     *
     * ⚠️ 研究文档里记的 `pgc/view/web/ep/list` 实测也返回 code 0，
     *   但结构是 `{episodes, play_strategy, section}` 且不含 `season_id`；
     *   `pgc/view/web/season` 结构更完整（带 season_title/total/up_info），故选它。
     *
     * @returns {{platform,ownerId,ownerKind,targetKind,seasonId,epId,pageUrl}|null}
     */
    function parseBilibiliBangumi(u) {
        var m = /^\/bangumi\/play\/(ss|ep)(\d{1,20})\/?$/.exec(u.pathname);
        if (!m) { return null; }
        var kind = m[1];
        var id = m[2];
        return {
            platform: 'bilibili',
            /* 番剧没有 UP 主 mid，用 season/ep id 当身份键 ——
             * 与合集形态②（collectionId 当 ownerId）同一做法，
             * 这样 targetKey 稳定，断点续跑才对得上。 */
            ownerId: id,
            ownerKind: kind === 'ss' ? 'season_id' : 'ep_id',
            targetKind: 'bangumi',
            seasonId: kind === 'ss' ? id : '',
            epId: kind === 'ep' ? id : '',
            pageUrl: 'https://www.bilibili.com/bangumi/play/' + kind + id
        };
    }

    /** 主入口：URL → 博主目标 或 null
     * @param {string} url
     * @returns {{platform,ownerId,ownerKind,pageUrl,subTab?}|null}
     */
    function detectOwnerTarget(url) {
        var s = String(url || '').trim();
        if (!s) { return null; }
        var u;
        try { u = new URL(s); } catch (e) { return null; }
        if (!/^https?:$/.test(u.protocol)) { return null; }
        var host = hostOf(u.hostname);

        /* space.bilibili.com 是 UP 主空间。
         * 2026-11-18（E2）：**必须先判合集** —— 合集页 pathname 是
         * `/<mid>/channel/collectiondetail`，会被 parseBilibili 的
         * `^\/(\d+)(?:\/|$)` 命中，于是合集被错当成整博主。 */
        if (host === 'space.bilibili.com') {
            var col = parseBilibiliCollection(u);
            return col || parseBilibili(u);
        }
        /* medialist 独立详情页（www.bilibili.com/medialist/detail/ml<id>） */
        if (/(^|\.)bilibili\.com$/.test(host) && /^\/medialist\/detail\//.test(u.pathname)) {
            return parseBilibiliCollection(u);
        }
        /* 2026-11-18（D10）：番剧页 —— **必须**放在「普通稿件页返回 null」之前，
         * 否则 /bangumi/play/ss<id> 会被当成普通稿件页直接丢掉。 */
        if (/(^|\.)bilibili\.com$/.test(host) && /^\/bangumi\/play\//.test(u.pathname)) {
            return parseBilibiliBangumi(u);
        }
        if (/(^|\.)bilibili\.com$/.test(host)) { return null; } /* 普通稿件页不是博主页 */

        if (host === 'x.com' || /(^|\.)twitter\.com$/.test(host)) { return parseX(u); }
        if (/(^|\.)douyin\.com$/.test(host)) { return parseDouyin(u); }
        if (/(^|\.)xiaohongshu\.com$/.test(host)) { return parseXhs(u); }
        if (/(^|\.)weibo\.com$/.test(host) || /(^|\.)weibo\.cn$/.test(host)) { return parseWeibo(u); }
        if (/(^|\.)youtube\.com$/.test(host)) { return parseYoutube(u); }
        return null;
    }

    /** 判断两个目标是否同一博主（用于去重 / 续跑校验） */
    function sameTarget(a, b) {
        if (!a || !b) { return false; }
        return String(a.platform) === String(b.platform) &&
            String(a.ownerId) === String(b.ownerId);
    }

    /** 稳定任务键。
     *
     * 基础形态：`platform:ownerId`（同博主的帖子页与媒体页共用一个任务）
     *
     * ⚠️ 2026-11-18 修复（审计 D10 连带发现）：合集/番剧**必须**带后缀。
     *   原来只用 platform:ownerId —— 但「整博主」和「该 UP 的某个合集」
     *   的 ownerId 都是 mid，任务键完全一样，于是：
     *     · 断点 cursor 互相覆盖（跑合集会把整博主的进度冲掉）
     *     · `masterIds` 快照互相覆盖（合集只 11 条，会把整博主上千条的快照压掉）
     *     · `disappeared` 跟着算错
     *   整博主保持原键形（`bilibili:123`），**不破坏已有断点**；
     *   只有 collection / bangumi 加后缀，各走独立任务。
     */
    function targetKey(t) {
        if (!t) { return ''; }
        var base = String(t.platform) + ':' + String(t.ownerId);
        var kind = String(t.targetKind || 'owner');
        if (kind === 'collection' && String(t.collectionId || '')) {
            return base + ':c' + String(t.collectionId);
        }
        if (kind === 'bangumi') {
            /* 番剧用 season/ep 自己的 id（ownerId 已是它） */
            return base + ':b';
        }
        return base;
    }

    return {
        detectOwnerTarget: detectOwnerTarget,
        sameTarget: sameTarget,
        targetKey: targetKey,
        /* 导出解析器便于单测逐条验证 */
        _parseX: parseX,
        _parseDouyin: parseDouyin,
        _parseBilibili: parseBilibili,
        /* 2026-11-18（E2）：合集解析器单独导出，便于单测逐条验证 */
        _parseBilibiliCollection: parseBilibiliCollection,
        /* 2026-11-18（D10）：番剧解析器单独导出，便于单测逐条验证 */
        _parseBilibiliBangumi: parseBilibiliBangumi,
        _parseXhs: parseXhs,
        _parseWeibo: parseWeibo,
        _parseYoutube: parseYoutube
    };
});