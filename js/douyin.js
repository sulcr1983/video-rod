/**
 * 钓鱼竿 video-rod — 抖音取流/元数据（独立模块，挂壳不改内核）
 * ------------------------------------------------------------------
 * 苏哥 2026-10-19 报的问题：抖音能下，但「下错视频 + 拿不到作者/标题」。
 *
 * 根因（已实探确认）：
 *  1. 抖音详情页里不止一个 <video>（当前播放 + 推荐位），页面播放的还可能是
 *     低码率自适应档；通用分支「按体积选最大」自然选歪。
 *  2. 命名引擎没有 douyin 规则，掉进 article 兜底，作者/抖音号全空。
 *
 * 做法（参考 yt-dlp 的 DouyinIE，Unlicense；不引入新依赖）：
 *  - 页面主世界 fetch 同源详情接口 aweme/v1/web/aweme/detail/，带页面 cookie，
 *    不需要签名。一次拿到：描述、作者昵称、抖音号(unique_id)、数字 UID、
 *    无水印直链、全部清晰度档位。
 *  - 用 URL 里的作品 ID 定位「当前这条」，不再靠嗅探缓存猜。
 *  - 清晰度按短边分辨率排序，一键取最高档（实测同一条视频有 4K/1080P/720P）。
 */

(function (root, factory) {
    const D = factory();
    if (typeof module !== 'undefined' && module.exports) { module.exports = D; }
    else { root.VR_DOUYIN = D; }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /** 从页面地址里拿作品 ID：/video/<id> 或 ?modal_id=<id> 等 */
    function parseAwemeId(href) {
        const s = String(href || '');
        let m = s.match(/\/video\/(\d{6,})/);
        if (m) { return m[1]; }
        m = s.match(/[?&](?:modal_id|aweme_id|vid|group_id)=(\d{6,})/);
        return m ? m[1] : '';
    }

    /** 清晰度标签：竖屏 1080x1920 习惯叫 1080P，按短边算 */
    function qualityOf(w, h) {
        const n = Math.min(Number(w) || 0, Number(h) || 0);
        return n ? n + 'P' : '视频';
    }

    function labelFor(x) {
        return qualityOf(x.w, x.h) +
            (x.size ? ' · ' + (x.size / 1048576).toFixed(1) + 'MB' : '');
    }

    /** 分辨率降序、同分辨率按码率降序；同分辨率只留一条 */
    function normalize(info) {
        const rows = ((info && info.rows) || []).filter(function (x) {
            return x && x.url;
        }).slice().sort(function (a, b) {
            /* 先保证能播：Chromium 默认不带 HEVC 解码，优先 H.264；
             * 同为 H.264 再按分辨率/码率取最高。 */
            const ac = a.h265 ? 1 : 0;
            const bc = b.h265 ? 1 : 0;
            const pa = (Number(a.w) || 0) * (Number(a.h) || 0);
            const pb = (Number(b.w) || 0) * (Number(b.h) || 0);
            return (ac - bc) || (pb - pa) || ((Number(b.br) || 0) - (Number(a.br) || 0));
        });
        const out = [], seen = {};
        rows.forEach(function (x) {
            const k = (x.w || 0) + 'x' + (x.h || 0);
            if (seen[k]) { return; }
            seen[k] = 1;
            out.push(x);
        });
        // bit_rate 缺失时用默认 play_addr 兜底
        if (!out.length && info && info.fallback && info.fallback.url) {
            out.push(info.fallback);
        }
        return out.slice(0, 6);
    }

    /** 命名引擎的 override：作者优先用抖音号，没有再用数字 UID */
    function metaFrom(info) {
        const i = info || {};
        return {
            title: i.title || '',
            post: i.title || '',
            author: i.nickname || '',
            authorId: i.uniqueId || i.uid || ''
        };
    }

    /* ==========================================================
     * 路线①（2026-11-09 拆「智小抖 v2.4.5」学来的正解）
     * 爬 React Fiber 从播放器组件里抠当前这条视频的完整数据。
     * ----------------------------------------------------------
     * 为什么必须加这条路：抖音精选页/首页的 URL 是 https://www.douyin.com/jingxuan，
     * 里面**没有任何作品 ID**，parseAwemeId 直接返回空 → 详情接口根本没被调用 →
     * 掉进通用嗅探分支 → 标题全靠 DOM 选择器，而抖音新版把 data-e2e 内容锚点全删了
     * → 文件名只剩作者名（苏哥 2026-11-09 报的现象）。
     *
     * Fiber 路线的优势（实测已验证，见拆解报告 §二）：
     *   · 不依赖 URL      → 首页/精选/搜索/用户主页全场景可用
     *   · 不依赖选择器    → 不受抖音 class 哈希化影响（小红书刚踩过这个坑）
     *   · 不碰签名        → 数据是页面自己已经取到的
     *   · 档位更全        → 实测一次拿到 23 档 bitRateList
     *
     * 注意字段形态：Fiber 里是**驼峰**（awemeId/authorInfo/bitRateList/playAddr），
     * 详情接口里是**下划线**（aweme_id/author/bit_rate/play_addr）。
     * playAddr 是 [{src:'…'}] 这种对象数组，不是 [url] 字符串数组。
     * 本函数把两种形态统一归一到 probeFunc 的返回结构，下游 normalize/metaFrom 不用改。
     * ========================================================== */

    /** 在页面主世界执行：从播放器 DOM 爬 React Fiber 抠 awemeInfo。
     *  注意：该函数会被 chrome.scripting.executeScript 序列化，不能引用外部变量。 */
    function playerFunc() {
        try {
            /** 从 React children（可能是数组）里找带 awemeId 的 awemeInfo */
            function pick(children) {
                var list = Array.isArray(children) ? children : [children];
                for (var i = 0; i < list.length; i++) {
                    var c = list[i];
                    var info = c && c.props && c.props.awemeInfo;
                    if (info && (info.awemeId || info.aweme_id)) { return info; }
                }
                return null;
            }
            /** 从一个 DOM 节点出发的四种 Fiber 取法（照抄智小抖的 tries 序列） */
            function fromFiber(el) {
                if (!el) { return null; }
                var key = null;
                var ks = Object.keys(el);
                for (var i = 0; i < ks.length; i++) {
                    if (ks[i].indexOf('__reactFiber$') === 0) { key = ks[i]; break; }
                }
                if (!key) { return null; }
                var f = el[key];
                var tries = [
                    function () { return f.child && f.child.memoizedProps && f.child.memoizedProps.itemInfo; },
                    function () { return pick(f.child && f.child.memoizedProps && f.child.memoizedProps.children); },
                    function () {
                        var e = f.memoizedProps && f.memoizedProps.children;
                        if (Array.isArray(e)) {
                            for (var j = 0; j < e.length; j++) {
                                if (e[j] && e[j].props && e[j].props.children) { e = e[j]; break; }
                            }
                        }
                        return pick(e && e.props && e.props.children);
                    },
                    function () { return pick(f.memoizedProps && f.memoizedProps.children); }
                ];
                for (var t = 0; t < tries.length; t++) {
                    try {
                        var r = tries[t]();
                        if (r && (r.awemeId || r.aweme_id)) { return r; }
                    } catch (e) { /* 换下一种取法 */ }
                }
                return null;
            }

            /** 优先「正在播的那条」：paused=false 或有 currentSrc 的 video */
            var vids = Array.prototype.slice.call(document.querySelectorAll('video'));
            if (!vids.length) { return null; }
            var ordered = vids.filter(function (v) { return v.currentSrc && !v.paused; })
                .concat(vids.filter(function (v) { return v.currentSrc; }))
                .concat(vids);

            var hit = null, host = null;
            for (var i = 0; i < ordered.length && !hit; i++) {
                var n = ordered[i];
                for (var up = 0; up < 16 && n; up++) {      // 从 video 往上找带 Fiber 的祖先
                    hit = fromFiber(n);
                    if (hit) { host = n; break; }
                    n = n.parentElement;
                }
            }
            /* 播放器没命中（页面还没渲染完/纯图片卡）→ 退而扫全页卡片 */
            if (!hit) {
                var all = document.querySelectorAll('[class*="video-card-item"], [class*="cardItem"]');
                for (var k = 0; k < all.length && !hit; k++) { hit = fromFiber(all[k]); }
            }
            if (!hit) { return null; }

            /** 驼峰/下划线两套 key 都认 */
            function g(o, a, b) {
                if (!o) { return undefined; }
                return o[a] !== undefined ? o[a] : o[b];
            }
            var awemeId = String(g(hit, 'awemeId', 'aweme_id') || '');
            var desc = String(g(hit, 'desc', 'desc') || '');
            var author = g(hit, 'authorInfo', 'author') || g(hit, 'author', 'authorInfo') || {};
            var video = hit.video || {};
            var brList = g(video, 'bitRateList', 'bit_rate_list') || [];

            var rows = [];
            for (var b = 0; b < brList.length; b++) {
                var x = brList[b] || {};
                /* playAddr: [{src}] / [url] / {url_list:[…]} 三种形态都见过 */
                var pa = g(x, 'playAddr', 'play_addr');
                var url = '';
                if (Array.isArray(pa) && pa.length) {
                    url = (typeof pa[0] === 'string') ? pa[0] : (pa[0] && (pa[0].src || pa[0].url)) || '';
                } else if (pa && typeof pa === 'object') {
                    url = pa.url_list && pa.url_list[0] || pa.src || pa.url || '';
                }
                if (!url) {
                    var api = g(x, 'playApi', 'play_api');
                    if (api) { url = String(api); }
                }
                if (!url) { continue; }
                rows.push({
                    w: Number(g(x, 'width', 'width') || video.width || 0) || 0,
                    h: Number(g(x, 'height', 'height') || video.height || 0) || 0,
                    br: Number(g(x, 'bitRate', 'bit_rate') || 0) || 0,
                    size: Number(g(x, 'dataSize', 'data_size') || 0) || 0,
                    h265: !!(g(x, 'isH265', 'is_h265')),
                    url: String(url)
                });
            }
            /* 没档位列表时退回顶层 playAddr */
            var fallback = null;
            if (!rows.length) {
                var top = g(video, 'playAddr', 'play_addr');
                var tu = '';
                if (Array.isArray(top) && top.length) {
                    tu = (typeof top[0] === 'string') ? top[0] : (top[0] && (top[0].src || top[0].url)) || '';
                } else if (top && typeof top === 'object') {
                    tu = top.url_list && top.url_list[0] || top.src || top.url || '';
                }
                if (!tu) { tu = String(g(video, 'playApi', 'play_api') || ''); }
                if (tu) {
                    rows.push({
                        w: Number(video.width || 0) || 0, h: Number(video.height || 0) || 0,
                        br: 0, size: Number(video.dataSize || video.playAddrSize || 0) || 0,
                        h265: false, url: tu
                    });
                }
                fallback = rows.length ? rows[0] : null;
            }

            return {
                awemeId: awemeId,
                title: desc,
                nickname: String(author.nickname || author.nick_name || ''),
                uniqueId: String(author.uniqueId || author.unique_id || author.shortId || author.short_id || ''),
                uid: String(author.uid || ''),
                secUid: String(author.secUid || author.sec_uid || ''),
                duration: Number(video.duration || hit.duration || 0) || 0,
                rows: rows,
                fallback: fallback,
                /* 标记数据来源，便于排查（Fiber 比接口更全，实测 23 档 vs 接口 4 档） */
                from: 'fiber'
            };
        } catch (e) {
            return null;
        }
    }

    /** 在页面主世界执行：同源详情接口，带页面 cookie。
     *  注意：该函数会被 chrome.scripting.executeScript 序列化，不能引用外部变量。 */
    async function probeFunc(awemeId) {
        try {
            const u = '/aweme/v1/web/aweme/detail/?aweme_id=' +
                encodeURIComponent(awemeId) + '&aid=6383&device_platform=webapp';
            // 接口偶发不返回：7 秒必断，否则面板会一直停在「正在问…」（2026-11-05 实测）
            const ac = new AbortController();
            const tm = setTimeout(function () { try { ac.abort(); } catch (e) { } }, 7000);
            let r;
            try {
                r = await fetch(u, { credentials: 'include', signal: ac.signal });
            } finally {
                clearTimeout(tm);
            }
            if (!r.ok) { return null; }
            const j = await r.json();
            const d = j && j.aweme_detail;
            if (!d) { return null; }
            const a = d.author || {};
            const rows = ((d.video && d.video.bit_rate) || []).map(function (b) {
                const p = b.play_addr || {};
                return {
                    w: p.width || 0, h: p.height || 0,
                    br: b.bit_rate || 0, size: p.data_size || 0,
                    h265: !!b.is_h265,
                    url: (p.url_list || [])[0] || ''
                };
            }).filter(function (x) { return !!x.url; });
            const pa = (d.video && d.video.play_addr) || {};
            return {
                awemeId: String(d.aweme_id || awemeId),
                title: d.desc || '',
                nickname: a.nickname || '',
                uniqueId: a.unique_id || a.short_id || '',
                uid: a.uid || '',
                secUid: a.sec_uid || '',
                duration: (d.video && d.video.duration) || 0,
                rows: rows,
                fallback: (pa.url_list && pa.url_list[0])
                    ? { w: pa.width || 0, h: pa.height || 0, size: pa.data_size || 0, url: pa.url_list[0] }
                    : null
            };
        } catch (e) {
            return null;
        }
    }

    return { parseAwemeId, qualityOf, labelFor, normalize, metaFrom, probeFunc, playerFunc };
});
