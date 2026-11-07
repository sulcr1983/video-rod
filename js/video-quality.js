/* ==========================================================
 * VRVideoQuality —— 视频清晰度解析与候选排序（纯逻辑，可 Node 单测）
 *
 * 职责：
 *   · 从视频 URL 里解析分辨率档位（label=mp4_1080p / 1080p / 720p / hd / height=…）
 *   · 对嗅探到的候选排序：**分辨率优先 → 体积次之 → 最后才偏好当前播放**
 *
 * 为什么要有这个模块：
 *   嗅探拿到的是一堆平级直链（同一个视频的不同码率 + 页面上别的视频）。
 *   旧规则把「正在播放」无条件置顶，而微博信息流默认播 720p，
 *   于是一键下载永远只拿到 720p，用户以为站点最高就这档。
 *   这条规则是**通用**的：B站/抖音/YouTube 的 URL 里同样带清晰度标记。
 *
 * 约定：
 *   - 不碰 chrome.*、不写 DOM、零依赖
 *   - 浏览器/内容脚本/SW 挂 self.VRVideoQuality；Node 走 module.exports
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRVideoQuality = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    var MIN_H = 144;
    var MAX_H = 4320;

    /**
     * 从视频 URL 里解析垂直分辨率。
     *
     * 匹配顺序即优先级（先精确标记，再宽松数字，避免被路径里的位数干扰）：
     *   ① label/quality 参数：`?label=mp4_1080p`、`&quality=720p`
     *   ② 显式高度：`?height=1080`、`&h=720`、`&resolution=2160`
     *   ③ 文件名/路径里的 `1080p`、`720p`
     *   ④ 短标记：uhd/fhd/hd/sd
     *
     * @param {string} url
     * @returns {number} 分辨率高度；解析不到返回 0
     */
    function heightFromUrl(url) {
        var s = String(url || '');
        if (!s) { return 0; }

        var m = s.match(/[?&](?:label|quality)=([a-z0-9]*_)?(\d{3,4})p?\b/i);
        if (m && m[2]) {
            var h1 = parseInt(m[2], 10);
            if (h1 >= MIN_H && h1 <= MAX_H) { return h1; }
        }

        var mh = s.match(/[?&](?:height|h|resolution)=(\d{3,4})\b/i);
        if (mh) {
            var h2 = parseInt(mh[1], 10);
            if (h2 >= MIN_H && h2 <= MAX_H) { return h2; }
        }

        var mn = s.match(/(?:^|[^0-9])(\d{3,4})p(?:\b|_|\.|$)/i);
        if (mn) {
            var h3 = parseInt(mn[1], 10);
            if (h3 >= MIN_H && h3 <= MAX_H) { return h3; }
        }

        /* ④ 路径里的 WxH（抄 DownXVideo v0.6.2 local-parsers.js 的 parseDimensions）
         * 例：`/1280x720/`、`/1920x1080/video.mp4`。取高度那一位。
         * 微博的 `template=1922x1080.25.0` 这种也走这里。 */
        var mWH = s.match(/(?:^|[^0-9])(\d{2,5})x(\d{2,5})(?=[^0-9]|$)/);
        if (mWH) {
            var h4 = parseInt(mWH[2], 10);
            if (h4 >= MIN_H && h4 <= MAX_H) { return h4; }
        }

        /* ⑤ 短标记 */
        if (/[?&/=_-]uhd\b/i.test(s)) { return 2160; }
        if (/[?&/=_-]fhd\b/i.test(s)) { return 1080; }
        if (/[?&/=_-]hd\b/i.test(s)) { return 720; }
        if (/[?&/=_-]sd\b/i.test(s)) { return 480; }
        return 0;
    }

    /**
     * 候选排序（返回新数组，不修改入参）。
     *
     * 排序键依次为：
     *   ① 分辨率降序（解析不到的按 0 处理，排最后）
     *   ② 体积降序（同分辨率里挑大的）
     *   ③ 「正在播放」优先 —— **仅在分辨率与体积都相同时**作为次要加权
     *
     * 第 ③ 条与旧实现相反：旧实现无条件把正在播放的置顶，
     * 导致默认播低档的站点（微博 720p）一键下载永远拿不到高清。
     *
     * @param {Array<{url,size,height}>} list
     * @param {string} playing 页面当前正在播放的 URL（可空）
     * @returns {Array} 排序后的新数组（条目会补上 height 字段）
     */
    function sortCandidates(list, playing) {
        var arr = Array.isArray(list) ? list.slice() : [];
        for (var i = 0; i < arr.length; i++) {
            var m = arr[i];
            if (!m) { continue; }
            if (!m.height) { m.height = heightFromUrl(m.url); }
        }
        arr.sort(function (a, b) {
            var x = a || {};
            var y = b || {};
            var ha = x.height || 0;
            var hb = y.height || 0;
            if (ha !== hb) { return hb - ha; }
            var sa = x.size || 0;
            var sb = y.size || 0;
            if (sa !== sb) { return sb - sa; }
            var pa = (playing && x.url === playing) ? 0 : 1;
            var pb = (playing && y.url === playing) ? 0 : 1;
            return pa - pb;
        });
        return arr;
    }

    /**
     * 按 URL 归组：同一素材的多个码率归到一起，只保留最高的那个。
     *
     * 为什么需要：微博/抖音一个视频会先后请求多个码率，嗅探把它们都记下来，
     * 菜单里就出现「6 个大小不同的视频」——其实是一个视频的 6 档。
     * 归组键取 URL 的 origin + pathname（去掉 label/quality/Expires 这类参数），
     * 这样同素材不同码率会归到同一组。
     *
     * @param {Array} list
     * @returns {Array} 每组只保留排序最高的一条
     */
    function collapseByAsset(list) {
        var arr = Array.isArray(list) ? list : [];
        var groups = Object.create(null);
        var order = [];
        for (var i = 0; i < arr.length; i++) {
            var m = arr[i];
            if (!m || !m.url) { continue; }
            var key = assetKey(m.url);
            if (!groups[key]) {
                groups[key] = [];
                order.push(key);
            }
            groups[key].push(m);
        }
        var out = [];
        for (var j = 0; j < order.length; j++) {
            var best = sortCandidates(groups[order[j]], '')[0];
            if (best) { out.push(best); }
        }
        return out;
    }

    /**
     * 素材归组键：origin + pathname，去掉 query（签名/档位/过期时间都在 query 里）。
     * CDN 节点子域差异（wx1~wx4、sns-video-ak/al/bd）在调用侧另行归一。
     */
    function assetKey(url) {
        var s = String(url || '');
        try {
            var u = new URL(s);
            return u.origin + u.pathname;
        } catch (e) {
            return s.split('#')[0].split('?')[0];
        }
    }

    /** 候选的显示文案：能解析出分辨率就显示 "1080p · 45.6MB" */
    function labelOf(item) {
        var m = item || {};
        var h = m.height || heightFromUrl(m.url);
        var size = Number(m.size) || 0;
        var sizeTxt = size ? ' · ' + (size / 1048576).toFixed(1) + 'MB' : '';
        return (h ? h + 'p' : 'MP4') + sizeTxt;
    }

    /**
     * 从微博视频 URL 里提取 mid（微博作品 id）。
     *
     * 为什么需要：微博把多档码率压在一个直链里（只换 label 参数），
     * 嗅探只能看到浏览器**实际请求过**的那几档，默认就是 720p。
     * 真正的高清档（1080p 及以上）要用 mid 去 `ajax/statuses/show` 换 ——
     * 笃笃微博下载器 v0.16.14 就是这么做的（`page_info.media_info.mp4_hd_url`）。
     *
     * 实测 URL 形态：
     *   ...?label=mp4_720p&template=720x1280.24.0&media_id=5362210344468552&...
     *   ...&label=mp4_1080p&media_id=5362288048144419
     *
     * @param {string} url
     * @returns {string} mid；取不到返回 ''
     */
    function weiboMidFromUrl(url) {
        var s = String(url || '');
        if (!s) { return ''; }
        if (!/(^|\.)weibocdn\.com|weibo\.(com|cn)/i.test(s)) { return ''; }
        var m = s.match(/[?&]media_id=(\d{8,})/i);
        if (m) { return m[1]; }
        /* 兜底：数字型 path 段（tv/show/1034:xxx 不在 URL 里，这里只认明显的 id 段） */
        var m2 = s.match(/\/(\d{15,})(?:[/?#]|$)/);
        return m2 ? m2[1] : '';
    }

    /**
     * 从微博 detail 接口的返回体里挑出最高清的视频直链。
     *
     * 字段优先级（抄笃笃 v0.16.14 的 I() 函数，本地实测覆盖）：
     *   mp4_hd_url > stream_url_hd > mp4_sd_url > stream_url
     * 再补几个新版字段（mp4_1080p_url / hd_url），有就用。
     *
     * @param {object} detail ajax/statuses/show 的返回
     * @returns {string} 直链；取不到返回 ''
     */
    function pickWeiboHdUrl(detail) {
        var d = detail || {};
        var pi = (d.page_info && d.page_info.media_info) || d.media_info || null;
        if (!pi) { return ''; }
        var keys = ['mp4_1080p_url', 'mp4_hd_url', 'stream_url_hd', 'hd_url',
            'mp4_sd_url', 'stream_url', 'url'];
        for (var i = 0; i < keys.length; i++) {
            var v = pi[keys[i]];
            if (typeof v === 'string' && /^https?:/i.test(v)) { return v; }
        }
        return '';
    }

    /**
     * 解析 HLS master playlist，列出所有 variant。
     *
     * 抄 Video Downloader Plus v4.0.0 的做法（background/service_worker.js）：
     * master 里每个 `#EXT-X-STREAM-INF` 带 `RESOLUTION=1920x1080` 与 `BANDWIDTH=`，
     * 按高度排序就能拿到最高清档 —— 比在 URL 上猜清晰度可靠得多。
     *
     * 输入是 master 的文本内容（拉取由调用方负责，本函数纯解析）。
     *
     * @param {string} text master playlist 全文
     * @param {string} baseUrl 用于把相对地址补成绝对地址
     * @returns {Array<{url:string, width:number, height:number, bandwidth:number}>}
     */
    function parseHlsMaster(text, baseUrl) {
        var s = String(text || '');
        if (s.indexOf('#EXTM3U') < 0) { return []; }
        var lines = s.split(/\r?\n/);
        var out = [];
        var pending = null;
        for (var i = 0; i < lines.length; i++) {
            var ln = lines[i].trim();
            if (!ln) { continue; }
            if (ln.indexOf('#EXT-X-STREAM-INF:') === 0) {
                pending = {};
                var bw = ln.match(/BANDWIDTH=(\d+)/i);
                if (bw) { pending.bandwidth = parseInt(bw[1], 10); }
                var res = ln.match(/RESOLUTION=(\d+)x(\d+)/i);
                if (res) {
                    pending.width = parseInt(res[1], 10);
                    pending.height = parseInt(res[2], 10);
                }
                continue;
            }
            if (ln.charAt(0) === '#') { continue; }
            if (pending) {
                var abs = ln;
                if (!/^https?:/i.test(ln) && baseUrl) {
                    try { abs = new URL(ln, baseUrl).href; } catch (e) { abs = ln; }
                }
                pending.url = abs;
                out.push(pending);
                pending = null;
            }
        }
        return out;
    }

    /** 从 HLS variants 里挑最高清（高度优先，其次码率） */
    function pickBestVariant(variants) {
        var arr = Array.isArray(variants) ? variants.slice() : [];
        arr.sort(function (a, b) {
            var ha = (a && a.height) || 0;
            var hb = (b && b.height) || 0;
            if (ha !== hb) { return hb - ha; }
            return ((b && b.bandwidth) || 0) - ((a && a.bandwidth) || 0);
        });
        return arr[0] || null;
    }

    /**
     * 解析 DASH MPD，列出视频 Representation。
     *
     * 参考 Video Downloader Pro v0.1.11：它把 m3u8 与 mpd 并列支持
     * （background/index.js 里按 MIME `video/vnd.mpeg.dash.mpd` / `application/dash+xml` 分类）。
     * 我们的 mpd.js 是独立解析页、不在主链路，所以通用通道一直缺 DASH 档位识别。
     *
     * 只做纯文本解析（不拉取）：调用方拿到 MPD 内容后传进来。
     * 取每个 `<Representation>` 的 width/height/bandwidth —— 与 HLS 的
     * RESOLUTION/BANDWIDTH 语义对应，排序规则可以复用 pickBestVariant。
     *
     * @param {string} text MPD 全文（XML）
     * @returns {Array<{id:string, bandwidth:number, width:number, height:number, codecs:string}>}
     */
    function parseDashMpd(text) {
        var s = String(text || '');
        if (s.indexOf('<MPD') < 0) { return []; }
        var out = [];
        var re = /<Representation\b([^>]*)>/gi;
        var m;
        while ((m = re.exec(s)) !== null) {
            var attrs = m[1] || '';
            function attr(name) {
                /* 必须加词边界：否则 `width` 会匹配到 `bandwidth="..."` 里面的 width */
                var mm = attrs.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*"([^"]*)"', 'i'));
                return mm ? mm[1] : '';
            }
            var w = parseInt(attr('width'), 10) || 0;
            var h = parseInt(attr('height'), 10) || 0;
            var bw = parseInt(attr('bandwidth'), 10) || 0;
            /* 纯音频 Representation 没有宽高，跳过（视频轨才参与清晰度排序） */
            if (!w && !h) { continue; }
            out.push({
                id: attr('id'),
                bandwidth: bw,
                width: w,
                height: h,
                codecs: attr('codecs')
            });
        }
        return out;
    }

    return {
        MIN_H: MIN_H,
        MAX_H: MAX_H,
        heightFromUrl: heightFromUrl,
        sortCandidates: sortCandidates,
        collapseByAsset: collapseByAsset,
        assetKey: assetKey,
        labelOf: labelOf,
        weiboMidFromUrl: weiboMidFromUrl,
        pickWeiboHdUrl: pickWeiboHdUrl,
        parseHlsMaster: parseHlsMaster,
        pickBestVariant: pickBestVariant,
        parseDashMpd: parseDashMpd
    };
});