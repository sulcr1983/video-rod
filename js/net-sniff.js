/**
 * 页面侧网络嗅探（MAIN world, document_start）
 * -------------------------------------------------------------
 * 为什么需要它：抖音这类站点把播放地址藏在接口 JSON 里（aweme detail 之类），
 * 页面根本不会发出 .mp4/.m3u8 请求，扩展在 webRequest 层什么都看不到 ——
 * 用户看到的就是「抖音嗅探不到视频」。猫抓（cat-catch）解决这个问题的做法是
 * 在 document_start 劫持 fetch / XHR / JSON.parse，把接口里的媒体地址挖出来。
 *
 * 这里只做「挖地址」这一步，挖到后交给同页的 content-script 转发给后台入库，
 * 复用已有的 addMedia 通道（类型判定、去重都在后台）。
 *
 * 原则：
 *   1. 不改页面行为：包装函数原样返回/原样抛错，只在旁边旁读响应；
 *   2. 全程 try/catch，任何异常都不得影响页面；
 *   3. 有上限：单响应最多扫 1.5MB，每页最多上报 60 条，避免刷爆后台。
 */
(function () {
    'use strict';

    var MAX_BODY = 1.5 * 1024 * 1024;   // 单个响应最多扫 1.5MB
    var PER_SCAN = 8;                   // 单次响应最多上报几条（防止一锅端）
    var MAX_REPORT = 200;               // 每页累计上限
    var seen = Object.create(null);
    var reported = 0;
    // 轻量自检计数（不收集内容，只在页面留个数字，方便排查「到底扫没扫」）
    var dbg = { scans: 0, hits: 0, posts: 0 };
    try { window.__vrNetSniff = dbg; } catch (e) { /* 忽略 */ }

    var MEDIA_RE = /https?:\/\/[^\s"'\\<>()]+?\.(?:mp4|m3u8|mpd|webm|mov|flv|mp3|m4a|aac|ts)(?:\?[^\s"'\\<>()]*)?/gi;
    // 没有扩展名但明显是媒体路径的（抖音 /video/tos/、西瓜 playwm、部分 CDN 的 /play/）
    // 只认「几乎肯定是媒体」的路径特征。早先放进 /play/、hls、dash，
    // 实测抖音一次响应挖出 1353 条无关 URL，把真正的播放地址挤掉了。
    var PATHY_RE = /https?:\/\/[^\s"'\\<>()]+?\/(?:video\/tos|playwm|playlist|vod\/)[^\s"'\\<>()]*/gi;

    /**
     * 小红书 CDN：图片地址**没有文件扩展名**，靠路径特征识别。
     * 实测（2026-11-06 搜索页）45 条 xhscdn 资源全部如此，
     * 旧的 MEDIA_RE / PATHY_RE 一条都匹配不到 —— 这就是「嗅探一直 0」的主因。
     *
     * 实测形态（大小写/目录都可能变）：
     *   /202611061137/<hash>/<id>!nc_n_webp_prv_1       裸封面
     *   /202611061137/<hash>/spectrum/<id>!...          正文图
     *   /202611061137/<hash>/notes_pre_post/<id>!...    正文图（旧）
     *   /202611061137/<hash>/notes_uhdr/<id>!...        HDR 变体
     *   /202611061137/<hash>/note_pre_post_uhdr/<id>!.. HDR 变体
     *   /notes_pre_post/<id>?imageView2/.../format/webp 详情页原图
     *
     * 先宽松捞出 sns-*.xhscdn.com 下的 URL，再用 wantedXhsImage() 排除头像/评论
     * 表情/静态资源 —— 写成一个复杂正则反而容易漏（实测确实漏了 UHDR 两种）。
     */
    var XHS_ANY_RE = /https?:\/\/sns-[a-z0-9-]+\.xhscdn\.com\/[^\s"'\\<>()]+/gi;
    var XHS_BAD_DIR = /\/(?:avatars?|comments?|emoji|stickers?|icons?|sprites?)\//i;
    var XHS_GOOD_DIR = /\/(?:spectrum|notes?_pre_post|notes?_uhdr|note_pre_post_uhdr)\//i;

    function wantedXhsImage(u) {
        var s2 = String(u || '');
        if (XHS_BAD_DIR.test(s2)) { return false; }
        if (XHS_GOOD_DIR.test(s2)) { return true; }
        /* 裸形态：<32位hash>/<id>! 或带 imageView2 的缩放参数 */
        if (/\/[0-9a-f]{20,}\/[0-9a-zA-Z]{20,}[!?]/.test(s2)) { return true; }
        if (/imageView2|imageMogr2/i.test(s2)) { return true; }
        return false;
    }

    /**
     * 猜扩展名。抖音/西瓜的播放地址长这样：
     *   …/video/tos/cn/tos-cn-ve-15/xxx/?a=6383&…&mime_type=video_mp4
     * 路径里没有 .mp4，后台按后缀判类型会判成空 → 悬浮键列不出源 → 点了没反应。
     * 这里按 URL 特征补一个，后台的 extraExt 会采用它。
     */
    function guessExt(u) {
        var s2 = String(u || '');
        if (/\.m3u8(\?|$)/i.test(s2) || /mime_type=video_mpegurl/i.test(s2)) { return 'm3u8'; }
        if (/\.mp4(\?|$)/i.test(s2) || /mime_type=video_mp4/i.test(s2) || /\/video\/tos\//i.test(s2) || /playwm/i.test(s2)) { return 'mp4'; }
        if (/\.m4a(\?|$)/i.test(s2)) { return 'm4a'; }
        if (/\.mp3(\?|$)/i.test(s2) || /mime_type=audio/i.test(s2)) { return 'mp3'; }
        if (/\.webm(\?|$)/i.test(s2)) { return 'webm'; }
        /* 小红书 CDN 无扩展名：按路径判图片；后台还会用 Content-Type 再确认。
         * 注意目录后可能直接跟文件名（notes_pre_post/<id>?...），
         * 所以不能要求「目录后还有一段」。 */
        if (/xhscdn\.com\/(?:.*\/)?(?:spectrum|notes?_pre_post|notes?_uhdr|note_pre_post_uhdr)\//i.test(s2)) {
            if (/format\/jpe?g/i.test(s2)) { return 'jpg'; }
            if (/format\/png/i.test(s2)) { return 'png'; }
            return 'webp';
        }
        /* 裸形态：/<ts>/<hash>/<id>!<transform> 或带 imageView2 的缩放参数 */
        if (/xhscdn\.com/i.test(s2) && (/imageView2|imageMogr2/i.test(s2) || /\/[0-9a-f]{20,}\/[0-9a-zA-Z]{20,}!/i.test(s2))) {
            return 'webp';
        }
        return '';
    }

    function report(list) {
        if (!list.length) { return; }
        try {
            dbg.posts++;
            var items = [];
            for (var i = 0; i < list.length; i++) {
                items.push({ u: list[i], x: guessExt(list[i]) });
            }
            window.postMessage({ action: 'vrNetMedia', urls: items }, location.origin);
        } catch (e) { /* 忽略 */ }
    }

    function pushHit(hit, out) {
        if (!hit || seen[hit]) { return; }
        dbg.hits++;
        if (out.length >= PER_SCAN) { return; }
        if (reported + out.length >= MAX_REPORT) { return; }
        seen[hit] = 1;
        out.push(hit);
    }

    function scan(text) {
        if (!text || typeof text !== 'string') { return; }
        if (text.length > MAX_BODY) { text = text.slice(0, MAX_BODY); }
        dbg.scans++;
        var out = [];
        var m;
        MEDIA_RE.lastIndex = 0;
        while ((m = MEDIA_RE.exec(text))) { pushHit(m[0], out); }
        PATHY_RE.lastIndex = 0;
        while ((m = PATHY_RE.exec(text))) {
            var u = m[0];
            // 明显是图片/头像的路径别混进来
            if (/\.(?:jpe?g|png|webp|gif|svg|ico)(?:\?|$)/i.test(u)) { continue; }
            pushHit(u, out);
        }
        /* 小红书无扩展名图片：单独扫一遍（头像/评论图除外）。
         * 注意 PER_SCAN 上限是 8，放在最后只是补漏，不改变既有优先级。 */
        XHS_ANY_RE.lastIndex = 0;
        while ((m = XHS_ANY_RE.exec(text))) {
            var xu = m[0].replace(/[),;]+$/, '');
            if (!wantedXhsImage(xu)) { continue; }
            pushHit(xu, out);
        }
        if (out.length) {
            reported += out.length;
            report(out);
        }
    }

    /* ---------------- fetch ---------------- */
    try {
        var origFetch = window.fetch;
        if (typeof origFetch === 'function') {
            window.fetch = function () {
                var p = origFetch.apply(this, arguments);
                try {
                    p.then(function (res) {
                        try {
                            var ct = (res.headers && res.headers.get('content-type')) || '';
                            if (!/json|text|javascript/i.test(ct)) { return; }
                            var len = Number((res.headers && res.headers.get('content-length')) || 0);
                            if (len && len > MAX_BODY) { return; }
                            res.clone().text().then(scan, function () { });
                        } catch (e) { /* 忽略 */ }
                    }, function () { });
                } catch (e) { /* 忽略 */ }
                return p;
            };
        }
    } catch (e) { /* 忽略 */ }

    /* ---------------- XMLHttpRequest ---------------- */
    try {
        var XP = XMLHttpRequest.prototype;
        var origOpen = XP.open;
        var origSend = XP.send;
        XP.open = function (method, url) {
            try { this.__vrUrl = String(url || ''); } catch (e) { /* 忽略 */ }
            return origOpen.apply(this, arguments);
        };
        XP.send = function () {
            var self = this;
            try {
                self.addEventListener('load', function () {
                    try {
                        if (self.__vrUrl) { scan(String(self.__vrUrl)); }
                        var rt = self.responseType;
                        if (rt && rt !== 'text' && rt !== 'json') { return; }   // blob/arraybuffer 不碰
                        var txt = rt === 'json' ? JSON.stringify(self.response) : self.responseText;
                        if (txt) { scan(String(txt)); }
                    } catch (e) { /* 忽略 */ }
                });
            } catch (e) { /* 忽略 */ }
            return origSend.apply(this, arguments);
        };
    } catch (e) { /* 忽略 */ }

    /* ---------------- 资源列表兜底 ----------------
     * 小红书搜索页/主页的图片是 <img> 直接加载的，压根不出现在任何 JSON 响应里，
     * fetch/XHR 旁读永远扫不到 —— 用户看到的就是「一直 0」。
     * PerformanceObserver 能拿到每个资源请求的 URL，正好补这个洞。
     * 只挑 sns-*.xhscdn.com 且通过 wantedXhsImage() 的，不影响其他站点。 */
    function scanPerfEntries(entries) {
        try {
            var out = [];
            for (var i = 0; i < entries.length; i++) {
                var u = entries[i] && entries[i].name;
                if (!u || !/xhscdn\.com/i.test(u)) { continue; }
                if (!wantedXhsImage(u)) { continue; }
                pushHit(u, out);
            }
            if (out.length) {
                reported += out.length;
                report(out);
            }
        } catch (e) { /* 忽略 */ }
    }

    try {
        if (typeof PerformanceObserver === 'function') {
            var po = new PerformanceObserver(function (list) {
                scanPerfEntries(list.getEntries());
            });
            po.observe({ type: 'resource', buffered: true });
        } else {
            /* 老浏览器：定时扫一次全量，滚动后再补一次 */
            setTimeout(function () {
                try { scanPerfEntries(performance.getEntriesByType('resource')); } catch (e) { /* 忽略 */ }
            }, 1500);
        }
    } catch (e) {
        try {
            setTimeout(function () {
                try { scanPerfEntries(performance.getEntriesByType('resource')); } catch (e2) { /* 忽略 */ }
            }, 1500);
        } catch (e3) { /* 忽略 */ }
    }
})();
