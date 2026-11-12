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
    /* ---------- 字节分片地址还原 ----------
     *
     * 为什么需要（苏哥 2026-11-09 报「MSN 这个视频下载不了」）：
     * 越来越多的播放器不用 HLS/DASH，而是把**单个 MP4 按字节切片**反复拉：
     *   https://cdn/video/xxx.mp4_bd.mp4?start=0&end=15&_t=1794229126342
     * 响应是 206 + `Content-Range: bytes 48846-679008/3505399` —— 拿到的是**碎片**。
     * 直接下这个地址，落盘的是几百 KB 的 moof 片段，播放器打不开（表现为「下载不了」）。
     * 已知同类：Instagram 的 `bytestart/byteend`（早前只在 IG 分支特判过）。
     *
     * 正解：把分片参数剥掉，向同一个地址要完整文件。
     * 实测 MSN：去参后同一 URL 返回 200 + Content-Length 3505399（完整 3.5MB）。
     *
     * 铁律（必须保守，剥错 = 签名失效 403）：
     *   ① 只在**确认是字节分片**时才动手（成对的 start/end 或 bytestart/byteend）；
     *   ② 其余查询参数一律原样保留（签名 ef/sig/token 都在这里）；
     *   ③ 防缓存戳（_t/ts/…）只在已判定分片时顺带剥 —— 单独出现不影响下载。
     */
    var SEG_PAIRS = [['start', 'end'], ['bytestart', 'byteend']];

    function parseQuery(url) {
        var s = String(url || '');
        var i = s.indexOf('?');
        if (i < 0) { return null; }
        var h = s.indexOf('#');
        var q = h > i ? s.slice(i + 1, h) : s.slice(i + 1);
        var hash = h > i ? s.slice(h) : '';
        var parts = [];
        q.split('&').forEach(function (kv) {
            if (!kv) { return; }
            var eq = kv.indexOf('=');
            parts.push({
                raw: kv,
                key: (eq < 0 ? kv : kv.slice(0, eq)),
                val: (eq < 0 ? '' : kv.slice(eq + 1))
            });
        });
        return { base: s.slice(0, i), hash: hash, parts: parts };
    }

    /**
     * 「同媒体变体」候选地址。
     *
     * 为什么需要（苏哥 2026-11-09「MSN 的视频为什么下不了」）：
     * 有些 CDN 对**原始直链**做签名墙，但同一份文件的**转码变体**是免签的。
     * 实测 MSN / 一点资讯（go2yd 系）：
     *   …/video/xxx.mp4              → 403（签名过期/缺失）
     *   …/video/xxx.mp4_bd.mp4       → 206 + 完整 Content-Range  ✅
     * 而播放器只会在**真的开始播**的时候才去拉转码地址 —— 用户不播就永远只有死链。
     *
     * 这是命名规律，不是站点判断：对没有该规律的站，试一下就是 404，无副作用。
     * 调用方只在原地址明确失败（4xx/5xx）时才试，正常路径一次请求都不多花。
     *
     * @param {string} url
     * @returns {string[]} 去掉 query/hash 的变体地址
     */
    function variantUrls(url) {
        var s = String(url || '');
        var out = [];
        if (!s || !/^https?:/i.test(s)) { return out; }
        var clean = s.split('#')[0].split('?')[0];
        var m = /\.(mp4|webm|mov|mkv|m4v)$/i.exec(clean);
        if (!m) { return out; }
        var ext = m[1].toLowerCase();
        /* xxx.mp4 → xxx.mp4_bd.mp4（一点资讯的转码变体命名） */
        out.push(clean + '_bd.' + ext);
        return out;
    }

    /**
     * 是否为「按字节切片」的媒体地址，以及剥掉分片参数后的完整地址。
     * @param {string} url
     * @returns {{segmented:boolean, url:string, removed:string[]}}
     *          segmented=false 时 url 原样返回。
     */
    function unsegmentUrl(url) {
        var s = String(url || '');
        var out = { segmented: false, url: s, removed: [] };
        if (!s || !/^https?:/i.test(s)) { return out; }
        var q = parseQuery(s);
        if (!q || !q.parts.length) { return out; }

        var byKey = {};
        q.parts.forEach(function (p) { byKey[p.key.toLowerCase()] = p; });

        /* ① 成对出现且都是「纯数字」或「数字-N」→ 字节分片 */
        var segKeys = [];
        for (var i = 0; i < SEG_PAIRS.length; i++) {
            var a = byKey[SEG_PAIRS[i][0]];
            var b = byKey[SEG_PAIRS[i][1]];
            if (!a || !b) { continue; }
            if (!/^\d+$/.test(a.val) || !/^\d+$/.test(b.val)) { continue; }
            if (parseInt(b.val, 10) <= parseInt(a.val, 10)) { continue; }
            segKeys.push(a.key, b.key);
            break;
        }
        /* ② range=0-1234 / bytes=0-1234 这类（query 形式） */
        var rg = byKey['range'] || byKey['byterange'];
        if (rg && /^(?:bytes=)?\d+-\d*$/i.test(rg.val)) { segKeys.push(rg.key); }
        if (!segKeys.length) { return out; }

        /* ③ 已确认分片：顺带剥防缓存时间戳（纯数字、>=10 位） */
        q.parts.forEach(function (p) {
            var k = p.key.toLowerCase();
            if (/^(?:_t|_ts|_time|ts|timestamp)$/.test(k) && /^\d{10,}$/.test(p.val)) {
                segKeys.push(p.key);
            }
        });

        var drop = {};
        segKeys.forEach(function (k) { drop[k.toLowerCase()] = 1; });
        var keep = q.parts.filter(function (p) { return !drop[p.key.toLowerCase()]; });
        out.segmented = true;
        out.removed = q.parts.filter(function (p) { return drop[p.key.toLowerCase()]; })
            .map(function (p) { return p.key; });
        out.url = q.base + (keep.length ? ('?' + keep.map(function (p) { return p.raw; }).join('&')) : '') + q.hash;
        return out;
    }

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
     * 「这份文档」的归属键：判断一条嗅探记录是不是属于当前页面。
     *
     * 2026-11-11（苏哥报「小红书下到的不是我点那个视频」，且怀疑是通用问题 —— 确实是）：
     * 嗅探缓存按 **tabId** 累积，而小红书/微博/YouTube 这类 SPA 切内容不换 tab。
     * 逛过 A、B 两篇笔记后，池子里同时躺着 A 和 B 的视频；再按「分辨率最高」排序，
     * 拿到的往往是被逛过的那条更高清的 B —— 点的 A、下的是 B。
     *
     * 规则：origin(去 www) + pathname + 「内容 id 类」查询参数。
     * 签名/token/utm 一律丢掉（小红书每次进笔记的 xsec_token 都不同，整串比较会误杀）。
     */
    var DOC_ID_PARAMS = ['v', 'bvid', 'aid', 'noteid', 'note_id', 'mid', 'id', 'aweme_id', 'item_id'];

    function docKey(u) {
        try {
            var x = new URL(String(u || ''));
            if (!/^https?:$/i.test(x.protocol)) { return ''; }
            var host = x.hostname.replace(/^www\./i, '').toLowerCase();
            var path = x.pathname.replace(/\/+$/, '');
            var keep = [];
            for (var i = 0; i < DOC_ID_PARAMS.length; i++) {
                var v = x.searchParams.get(DOC_ID_PARAMS[i]);
                if (v) { keep.push(DOC_ID_PARAMS[i] + '=' + v); }
            }
            return host + path + (keep.length ? '?' + keep.join('&') : '');
        } catch (e) {
            return '';
        }
    }

    /**
     * 素材「族」键：把 CDN 节点差异抹平，只留「这个文件是谁」。
     *
     * 为什么需要（2026-11-11 苏哥报「小红书下到的不是我点那个视频」）：
     * 同一素材的多档码率/多个节点，pathname 通常一样、host 会变
     * （sns-video-ak / sns-video-bd、p3-pc-sign / p9-pc、wx1~wx4…）。
     * 要判断「这条是不是我正在播的那条」，必须先把节点归一，否则同一条视频
     * 会被当成两个不同素材 —— 要么选错，要么高清档被排除在目标之外。
     *
     * @param {string} url
     * @returns {string} 归一后的族键（取不到就退回去掉 query 的字符串）
     */
    var CDN_FAMILY = [
        [/^(.*\.)?sns-video[-a-z0-9]*\.xhscdn\.com$/i, 'xhscdn.com/sns-video'],
        [/^(.*\.)?sns-img[-a-z0-9]*\.xhscdn\.com$/i, 'xhscdn.com/sns-img'],
        [/^(.*\.)?[a-z0-9-]+\.xhscdn\.com$/i, 'xhscdn.com/other'],
        [/^(.*\.)?p\d+-?[a-z-]*\.douyinpic\.com$/i, 'douyinpic.com'],
        [/^(.*\.)?(wx\d*|ws\d*)\.sinaimg\.cn$/i, 'sinaimg.cn'],
        [/^(.*\.)?f\.video\.weibocdn\.com$/i, 'weibocdn.com/video']
    ];

    function familyKey(url) {
        var s = String(url || '');
        try {
            var u = new URL(s);
            var host = u.hostname.toLowerCase();
            /* 微博特别处理：同一个视频的各码率放在不同文件名下
             * （…/o0/xxx…030.mp4?label=mp4_720p 与 …/u0/yyy…080.mp4?label=mp4_2160p），
             * 只按 pathname 归族会把 4K/2K 当成「另一个视频」——
             * 结果是「正在播放」锁的是 720p 那一族，最高档永远选不到
             * （2026-11-12 苏哥报「微博最高只给 1080」，这是第二层原因）。
             * 微博 URL 里的 media_id 才是作品身份，按它归族。 */
            if (/^(.*\.)?f\.video\.weibocdn\.com$/i.test(host)) {
                var mid = u.searchParams.get('media_id');
                if (mid) { return 'weibocdn.com/video#media_id=' + mid; }
            }
            var mapped = '';
            for (var i = 0; i < CDN_FAMILY.length; i++) {
                if (CDN_FAMILY[i][0].test(host)) { mapped = CDN_FAMILY[i][1]; break; }
            }
            return (mapped || host) + u.pathname;
        } catch (e) {
            return s.split('#')[0].split('?')[0];
        }
    }

    /**
     * 「正在播放」优先：先锁定这条素材，再在它自己的族里挑最高码率。
     *
     * 与 sortCandidates 的区别（关键）：
     *   sortCandidates 把 playing 放在**最后**当 tie-breaker —— 那是为了治
     *   「微博默认播 720p、一键下载只拿 720p」。可它带来了更糟的副作用：
     *   信息流/多视频页面（小红书笔记页、微博首页、SPA 切内容）里，
     *   整个 tab 的候选混在一起，按分辨率排第一的往往是**别的视频**，
     *   于是「点的 A，下的是 B」。
     *
     * 正确语义是两段式（专业下载器都这么做）：
     *   ① 用 playing 决定「下哪个作品」；
     *   ② 在该作品的所有码率/节点里取最高。
     * 没有 playing（MSE/blob、探测失败）时才退回全局排序。
     *
     * @param {Array} list
     * @param {string} playing
     * @returns {Array}
     */
    function prioritizePlaying(list, playing) {
        var arr = Array.isArray(list) ? list.slice() : [];
        if (!playing || !arr.length) { return sortCandidates(arr, playing); }
        var pk = familyKey(playing);
        var same = [];
        var rest = [];
        for (var i = 0; i < arr.length; i++) {
            var m = arr[i];
            if (!m || !m.url) { continue; }
            if (familyKey(m.url) === pk) { same.push(m); } else { rest.push(m); }
        }
        if (!same.length) { return sortCandidates(arr, playing); }
        /* 同族（就是你正在看的这条）排前面并按码率降序；
         * 其它素材保留在后面当兜底（同族全是 403 时还能下点东西）。 */
        return sortCandidates(same, playing).concat(sortCandidates(rest, playing));
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
     * 从微博 detail 接口的返回体里列出**全部**码率档位（2026-11-12 苏哥报「微博最高只给 1080」）。
     *
     * 为什么以前拿不到 4K：老实现只按固定字段名挑一条
     * （mp4_1080p_url > mp4_hd_url > stream_url_hd …），而微博的 4K/2K 根本
     * 不在这几个字段里，它在 `media_info.playback_list` 数组里：
     *   { meta: { label:'mp4_2160p', quality_index:2160, quality_label:'4K',
     *             quality_desc:'超清', type:1 },
     *     play_info: { url, width:3840, height:2160, size, bitrate, video_codecs } }
     * 只认固定字段 = 永远封顶 1080p。改成先读 playback_list（全档位，含 4K/2K），
     * 没有这个字段的老视频再退回固定字段。
     *
     * 返回按「高度降序 → 码率降序」排好，调用方拿 [0] 就是最高清，
     * 其余档位一并交给面板，用户想省流量可以自己挑低清。
     *
     * @param {object} detail ajax/statuses/show 的返回
     * @returns {Array<{url:string,height:number,width:number,size:number,bitrate:number,quality:string,codec:string}>}
     */
    function weiboVariants(detail) {
        var d = detail || {};
        var pi = (d.page_info && d.page_info.media_info) || d.media_info || null;
        if (!pi) { return []; }

        var out = [];
        var seen = {};

        var list = Array.isArray(pi.playback_list) ? pi.playback_list : [];
        for (var i = 0; i < list.length; i++) {
            var it = list[i] || {};
            var info = it.play_info || {};
            var meta = it.meta || {};
            /* type=3 是封面/拖动预览图（实测 scrubber_hd 就是 image/jpeg），
             * 混进来会多出一个「假档位」。 */
            if (Number(meta.type) === 3) { continue; }
            var u = (typeof info.url === 'string') ? info.url : '';
            if (!/^https?:/i.test(u) || seen[u]) { continue; }
            seen[u] = 1;
            /* 分辨率一律取**短边**（行业惯例：1080p 指短边 1080）。
             * 竖屏视频 width=1080、height=1920，按 height 当档位会显示成
             * 「1920p」，排序时还会压过真正更高的横屏档（实测踩到）。
             * quality_index 是微博自己算好的档位（竖屏 1080p 也给 1080），优先用它。 */
            var w = Number(info.width) || 0;
            var hh = Number(info.height) || 0;
            var shortSide = (w > 0 && hh > 0) ? Math.min(w, hh) : (hh || 0);
            var h = Number(meta.quality_index) || shortSide || heightFromUrl(u) || 0;
            out.push({
                url: u,
                height: h,
                width: w,
                size: Number(info.size) || 0,
                bitrate: Number(info.bitrate) || 0,
                quality: String(meta.quality_label || meta.label || ''),
                codec: String(info.video_codecs || '')
            });
        }

        /* 老视频/转发帖可能没有 playback_list：退回固定字段，只取一条。
         *
         * 兜底分支**不排序**：字段本身就有明确优先级（mp4_1080p_url 就是 1080p），
         * 而靠 URL 猜高度会猜错 —— `hd.mp4` 会被解析成 720p，反把
         * `1080.mp4`（猜不出高度=0）挤到后面，结果「有 1080p 字段却给了 hd」
         * （2026-11-12 单测 E11 当场抓到）。顺序即语义，别自作聪明。 */
        if (!out.length) {
            var keys = ['mp4_1080p_url', 'mp4_hd_url', 'stream_url_hd', 'hd_url',
                'mp4_sd_url', 'stream_url', 'url'];
            for (var k = 0; k < keys.length; k++) {
                var v = pi[keys[k]];
                if (typeof v === 'string' && /^https?:/i.test(v) && !seen[v]) {
                    seen[v] = 1;
                    out.push({
                        url: v,
                        /* 只在能确定时才填高度：hd_mp4 / stream_url_hd 按名字即 720p 档起步，
                         * 具体高度交给下载前的真实探测，不在这里编。 */
                        height: heightFromUrl(v) || 0,
                        width: 0,
                        size: Number(pi.size) || Number(pi.duration_size) || 0,
                        bitrate: 0,
                        quality: '',
                        codec: ''
                    });
                }
            }
            return out;
        }

        out.sort(function (a, b) {
            if ((b.height || 0) !== (a.height || 0)) { return (b.height || 0) - (a.height || 0); }
            return (b.bitrate || 0) - (a.bitrate || 0);
        });

        /* 同一档位只留一条：playback_list 里偶尔会给同分辨率的多条（不同编码/不同节点），
         * 全列出来用户会看到两个「1080p」，以为是两个不同的视频。
         * 排序已按「高度降序 → 码率降序」，所以每组第一条就是该档最好的那条。 */
        var seenH = {};
        var dedup = [];
        for (var j = 0; j < out.length; j++) {
            var key = out[j].height ? ('h' + out[j].height) : ('u' + out[j].url);
            if (seenH[key]) { continue; }
            seenH[key] = 1;
            dedup.push(out[j]);
        }
        return dedup;
    }

    /**
     * 从微博 detail 接口的返回体里挑出最高清的视频直链。
     *
     * 优先用 weiboVariants（playback_list，能到 4K）；没有列表时退回固定字段
     * （抄笃笃 v0.16.14 的 I() 函数，覆盖老视频）。
     *
     * @param {object} detail ajax/statuses/show 的返回
     * @returns {string} 直链；取不到返回 ''
     */
    function pickWeiboHdUrl(detail) {
        var vs = weiboVariants(detail);
        if (vs.length) { return vs[0].url; }
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
        prioritizePlaying: prioritizePlaying,
        familyKey: familyKey,
        docKey: docKey,
        collapseByAsset: collapseByAsset,
        assetKey: assetKey,
        labelOf: labelOf,
        weiboMidFromUrl: weiboMidFromUrl,
        weiboVariants: weiboVariants,
        pickWeiboHdUrl: pickWeiboHdUrl,
        unsegmentUrl: unsegmentUrl,
        variantUrls: variantUrls,
        parseHlsMaster: parseHlsMaster,
        pickBestVariant: pickBestVariant,
        parseDashMpd: parseDashMpd
    };
});