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

    return { parseAwemeId, qualityOf, labelFor, normalize, metaFrom, probeFunc };
});
