/**
 * X(推特) 时间线旁读（MAIN world, document_start）
 * -------------------------------------------------------------
 * 目的（ADR-084）：把「博主全部下载」的数据来源从「扩展主动发私有请求」
 * 换成「旁读 X 自己发出的时间线请求」。
 *
 * 原则（必须守）：
 *   1. 只旁读，不代发：不读取、不保存、不回放 Authorization /
 *      X-Client-Transaction-Id 等鉴权头，扩展不以用户身份发起任何请求；
 *   2. 不改页面行为：包装函数原样返回/原样抛错，clone() 后才读响应体；
 *   3. 全程 try/catch，任何异常都不得影响页面；
 *   4. 有上限：每页最多缓存 MAX_PAYLOADS 条响应、单条最多 MAX_BODY 字节。
 *
 * 为什么要缓存 + 重放：
 *   本脚本 document_start 就注入，而面板（js/bulk-profile.js）document_idle
 *   才挂监听。X 首屏时间线在两者之间就可能返回，直接 postMessage 会丢。
 *   所以收到的数据先留在页面，面板就绪后发 vrXTimelinePull 索取。
 *
 * 消息协议（与 Plucker 的 XBD__* 不同，这里用尽量小的面）：
 *   页面 → 内容脚本  { action:'vrXTimeline', items:[...], tweets:[...], nextCursor }
 *   内容脚本 → 页面  { action:'vrXTimelinePull' }
 *   页面前 → 页面    { action:'vrXTimelineReady' }    // hook 装好（供诊断）
 */
(function () {
    'use strict';

    if (window.__vrXTimelineHook) { return; }
    window.__vrXTimelineHook = { hits: 0, parsed: 0, errors: 0, ready: false };

    var MAX_PAYLOADS = 40;
    var MAX_BODY = 4 * 1024 * 1024;
    var MAX_ITEMS = 6000;

    var TL_RE = /\/graphql\/[^/]+\/(UserTweets|UserTweetsAndReplies|UserMedia|Likes|UserPhotoTimeline|UserVideoTimeline|TweetDetail|SearchTimeline)\b/;

    var queue = [];          // 待重放的 {items, tweets, nextCursor}
    var seenKeys = Object.create(null);
    var seenStatus = Object.create(null);
    var delivered = 0;

    function T() {
        return (typeof self !== 'undefined' && self.VRTwitterTimeline) || null;
    }

    function publish(batch, replay) {
        if (!batch || (!batch.items.length && !batch.tweets.length)) { return; }
        try {
            window.postMessage({
                action: 'vrXTimeline',
                items: batch.items,
                tweets: batch.tweets,
                nextCursor: batch.nextCursor || '',
                replay: !!replay
            }, location.origin);
        } catch (e) { /* 页面被 CSP 拦住也不影响主流程 */ }
    }

    function record(text) {
        var api = T();
        if (!api) { return; }
        var json;
        try { json = JSON.parse(text); } catch (e) { window.__vrXTimelineHook.errors++; return; }

        var res;
        try {
            res = api.parseMediaItems(json);
        } catch (e) {
            window.__vrXTimelineHook.errors++;
            return;
        }
        var tweets = res.tweets || [];
        if (!tweets.length) { return; }
        window.__vrXTimelineHook.parsed += tweets.length;

        /* 双层去重：媒体 key（跨推文/跨页）与 statusId（同一推文重复返回）。
         * 上限保护：超过 MAX_ITEMS 就停止累积，避免长滚动把内存吃满。 */
        var items = [];
        for (var i = 0; i < res.items.length && delivered < MAX_ITEMS; i++) {
            var it = res.items[i];
            if (!it || !it.key || seenKeys[it.key]) { continue; }
            seenKeys[it.key] = 1;
            items.push(it);
            delivered++;
        }
        var newTweets = [];
        for (var j = 0; j < tweets.length; j++) {
            var t = tweets[j];
            if (!t || !t.statusId || seenStatus[t.statusId]) { continue; }
            seenStatus[t.statusId] = 1;
            newTweets.push({
                statusId: t.statusId, text: t.text, author: t.author,
                authorId: t.authorId, isRetweet: t.isRetweet, isQuote: t.isQuote,
                createdAt: t.createdAt, media: t.media.length
            });
        }

        var batch = { items: items, tweets: newTweets, nextCursor: res.nextCursor || '' };
        if (!items.length && !newTweets.length) {
            /* 没有新增内容但拿到了 cursor，仍要更新「是否还有下一页」 */
            batch.items = [];
            batch.tweets = [];
            queue.push(batch);
            if (queue.length > MAX_PAYLOADS) { queue.shift(); }
            return;
        }
        queue.push(batch);
        if (queue.length > MAX_PAYLOADS) { queue.shift(); }
        publish(batch, false);
    }

    function handle(url, text) {
        if (!url || typeof text !== 'string') { return; }
        if (!TL_RE.test(url)) { return; }
        if (text.length > MAX_BODY) { return; }
        window.__vrXTimelineHook.hits++;
        record(text);
    }

    /* ---------------- fetch ---------------- */
    try {
        var origFetch = window.fetch;
        if (typeof origFetch === 'function') {
            window.fetch = function () {
                var p = origFetch.apply(this, arguments);
                try {
                    var input = arguments[0];
                    var url = typeof input === 'string' ? input : (input && input.url) || '';
                    if (TL_RE.test(url)) {
                        p.then(function (res) {
                            try {
                                var ct = (res.headers && res.headers.get('content-type')) || '';
                                if (ct && !/json|text/i.test(ct)) { return; }
                                res.clone().text().then(function (t) { handle(url, t); }, function () { });
                            } catch (e) { /* 忽略 */ }
                        }, function () { });
                    }
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
            try { this.__vrTimelineUrl = String(url || ''); } catch (e) { /* 忽略 */ }
            return origOpen.apply(this, arguments);
        };
        XP.send = function () {
            var self = this;
            try {
                self.addEventListener('load', function () {
                    try {
                        var url = self.__vrTimelineUrl || '';
                        if (!TL_RE.test(url)) { return; }
                        var rt = self.responseType;
                        if (rt && rt !== 'text' && rt !== 'json') { return; }
                        var txt = rt === 'json' ? JSON.stringify(self.response) : self.responseText;
                        if (txt) { handle(url, String(txt)); }
                    } catch (e) { /* 忽略 */ }
                });
            } catch (e) { /* 忽略 */ }
            return origSend.apply(this, arguments);
        };
    } catch (e) { /* 忽略 */ }

    /* ---------------- 面板就绪后取存量 ---------------- */
    window.addEventListener('message', function (ev) {
        if (ev.source !== window) { return; }
        if (!ev.data || ev.data.action !== 'vrXTimelinePull') { return; }
        var snapshot = queue.slice();
        queue = [];
        for (var i = 0; i < snapshot.length; i++) {
            /* 重放期间不再重复入队，只发出去 */
            publish(snapshot[i], true);
        }
    });

    window.__vrXTimelineHook.ready = true;
    try { window.postMessage({ action: 'vrXTimelineReady' }, location.origin); } catch (e) { /* 忽略 */ }
})();
