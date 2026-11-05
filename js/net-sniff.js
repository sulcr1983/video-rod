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
})();
