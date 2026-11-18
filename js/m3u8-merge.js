/**
 * 钓鱼竿 M11 多段合并 —— 离屏文档（offscreen.html 内运行）
 *
 * 第一性原理版（2026-10-18 重构，参考社区成熟方案 Fluxon / Media Bridge）：
 *   不再驱动猫抓 m3u8 页面（那是给人手动操作的 UI，无头驱动必然一堆衍生坑），
 *   改为在本上下文里直连完成全管线：
 *     解析清单 → 直接 fetch 分片（扩展有全站 host_permissions）→
 *     AES-128 解密（WebCrypto）→ 拼接 → mux.js 转 MP4 → 持有 blob 等保存
 *   大块数据本来就在本上下文内存里，不过消息通道（社区方案同理，不挤消息上限）。
 *
 * 通信（chrome.runtime 消息）：
 *   收：vrMergeRun   {taskId, urls}      → 开始下载+合并（自动归组 / 手动页共用）
 *   收：vrMergeSave  {taskId, filename}  → 落盘
 *   发：vrMergeProgress {taskId, index, text}
 *   发：vrMergeReady {taskId, bytes, ext}
 *   发：vrMergeError {taskId, error}
 *   发：vrMergeSaved {taskId, ok, error}
 */
(function () {
    'use strict';

    var blobs = {};        // taskId -> {blob, ext, bytes}
    var running = {};      // taskId -> true（防重复触发）

    function post(msg) {
        try { chrome.runtime.sendMessage(msg); } catch (e) { /* SW 可能在睡 */ }
    }

    /* ================= 一、m3u8 解析（手写，覆盖标准 HLS 的常见子集） ================= */

    function absUrl(u, base) {
        try { return new URL(u, base).href; } catch (e) { return u; }
    }

    /**
     * 解析播放列表文本：
     *  - master（#EXT-X-STREAM-INF）→ { type:'master', variants:[{url,bandwidth}] }
     *  - media → { type:'media', fragments:[{url,seq}], key:{uri,iv}|null, map:{url}|null }
     */
    function parsePlaylist(text, baseUrl) {
        var lines = String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        var variants = [];
        var fragments = [];
        var key = null;
        var map = null;
        var seq = 0;
        var isMaster = false;
        /* 2026-11-18（审计 C4）：byteRange 状态。
         * prevEnd 记「同一个 URI 上一次下载到哪」，因为 HLS 允许省略 offset
         * 表示「接着上一个同 URI 的段继续」（fMP4 单文件流的常见写法）。 */
        var prevEnd = Object.create(null);
        var pendingRange = null;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
                isMaster = true;
                var bw = /BANDWIDTH=(\d+)/.exec(line);
                var next = lines[i + 1];
                if (next && next.charAt(0) !== '#') {
                    variants.push({ url: absUrl(next, baseUrl), bandwidth: bw ? parseInt(bw[1], 10) : 0 });
                }
            } else if (line.indexOf('#EXT-X-KEY:') === 0) {
                var method = /METHOD=([^,\s]+)/.exec(line);
                if (method && method[1] !== 'NONE') {
                    var uri = /URI="([^"]+)"/.exec(line);
                    var iv = /IV=0x([0-9a-fA-F]+)/.exec(line);
                    key = {
                        method: method[1],
                        uri: uri ? absUrl(uri[1], baseUrl) : null,
                        iv: iv ? iv[1] : null
                    };
                } else {
                    key = null;
                }
            } else if (line.indexOf('#EXT-X-MAP:') === 0) {
                var mUri = /URI="([^"]+)"/.exec(line);
                if (mUri) {
                    var mUrl = absUrl(mUri[1], baseUrl);
                    /* MAP 也可能带 BYTERANGE（init 与媒体段同文件时） */
                    var mBr = /BYTERANGE="([^"]+)"/.exec(line);
                    map = { url: mUrl };
                    if (mBr) {
                        var parsed = parseByteRange(mBr[1], prevEnd, mUrl);
                        if (parsed) { map.byteRange = parsed; }
                    }
                }
            } else if (line.indexOf('#EXT-X-BYTERANGE:') === 0) {
                /* 该标签作用于**下一行**的 URI；先存起来，遇到 URI 时消费 */
                pendingRange = line.slice('#EXT-X-BYTERANGE:'.length);
            } else if (line.indexOf('#EXT-X-MEDIA-SEQUENCE:') === 0) {
                var s = parseInt(line.split(':')[1], 10);
                seq = isNaN(s) ? 0 : s;
            } else if (line.charAt(0) !== '#') {
                var fUrl = absUrl(line, baseUrl);
                var frag = { url: fUrl, seq: seq };
                if (pendingRange) {
                    var br = parseByteRange(pendingRange, prevEnd, fUrl);
                    if (br) { frag.byteRange = br; }
                    pendingRange = null;
                }
                fragments.push(frag);
                seq++;
            }
        }
        if (isMaster) { return { type: 'master', variants: variants }; }
        return { type: 'media', fragments: fragments, key: key, map: map };
    }

    /* ================= 二、下载与解密 ================= */

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    async function fetchText(url) {
        var lastErr = null;
        for (var attempt = 0; attempt < 3; attempt++) {
            try {
                var r = await fetch(url, { credentials: 'include' });
                if (!r.ok) { throw new Error('HTTP ' + r.status); }
                return await r.text();
            } catch (e) { lastErr = e; await sleep(400 * (attempt + 1)); }
        }
        throw new Error('拉清单失败 ' + String(lastErr && lastErr.message || lastErr) + ' ' + url.slice(0, 80));
    }

    /**
     * 拉分片字节。可选 byteRange 走 HTTP Range（fMP4 单文件流的常态）。
     *
     * 2026-11-18（审计 C4）：原来不带 Range —— 遇到 #EXT-X-BYTERANGE 的清单
     * （B站/腾讯的 fMP4 常常 init 与媒体段同文件、靠 byteRange 切分），
     * 每个分片都会把**整个文件**拉一遍：流量爆炸，且拼出来的 mp4 是坏的。
     *
     * @param {string} url
     * @param {{start:number,end:number}|null} byteRange  end 为**开区间**
     */
    async function fetchBytes(url, byteRange) {
        var lastErr = null;
        var useRange = byteRange && isFinite(byteRange.start) && isFinite(byteRange.end)
            && byteRange.end > byteRange.start;
        for (var attempt = 0; attempt < 3; attempt++) {
            try {
                var opt = { credentials: 'include' };
                if (useRange) {
                    opt.headers = { 'Range': 'bytes=' + byteRange.start + '-' + (byteRange.end - 1) };
                }
                var r = await fetch(url, opt);
                if (!r.ok) { throw new Error('HTTP ' + r.status); }
                var buf = new Uint8Array(await r.arrayBuffer());
                /* 坑：服务器可能忽略 Range 直接回 200 + 整个文件。
                 * 这时必须自己切，否则「每个分片都拿到整文件」，拼出来是坏的。
                 * 只有 206（Partial Content）才能信任响应体就是那一段。 */
                if (useRange && r.status !== 206 && buf.byteLength > (byteRange.end - byteRange.start)) {
                    buf = buf.subarray(byteRange.start, byteRange.end);
                }
                return buf;
            } catch (e) { lastErr = e; await sleep(400 * (attempt + 1)); }
        }
        throw new Error('拉分片失败 ' + String(lastErr && lastErr.message || lastErr) + ' ' + url.slice(0, 80));
    }

    /**
     * 解析 EXT-X-BYTERANGE / EXT-X-MAP 的 BYTERANGE 值。
     *
     * 语法：`<length>[@<offset>]`
     * 省略 offset 时，按 HLS 规范接续「**同一个 URI** 的上一次下载结束位置」。
     *
     * @param {string} raw              如 "1234@0" / "1234"
     * @param {object} prevEndByUrl     同 URI 的上一个 end（开区间），会被本函数更新
     * @param {string} url              当前 URI（用于查/写接续位置）
     * @returns {{start:number,end:number}|null}  end 为开区间；解析失败返回 null
     */
    function parseByteRange(raw, prevEndByUrl, url) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) { return null; }
        var m = /^(\d+)(?:@(\d+))?$/.exec(s);
        if (!m) { return null; }
        var len = parseInt(m[1], 10);
        if (!isFinite(len) || len <= 0) { return null; }
        var start;
        if (m[2] !== undefined) {
            start = parseInt(m[2], 10);
        } else {
            var prev = prevEndByUrl && prevEndByUrl[url];
            start = (prev != null && isFinite(prev)) ? prev : 0;
        }
        if (!isFinite(start) || start < 0) { start = 0; }
        var br = { start: start, end: start + len };
        if (prevEndByUrl && url) { prevEndByUrl[url] = br.end; }
        return br;
    }

    function hexToBytes(hex) {
        hex = hex.padStart(32, '0');
        var out = new Uint8Array(16);
        for (var i = 0; i < 16; i++) { out[i] = parseInt(hex.substr(i * 2, 2), 16); }
        return out;
    }

    /** AES-128（HLS 加密的通用方式）：CBC + PKCS7；IV 缺省用媒体序列号 16 字节大端 */
    async function decryptAes128(data, keyInfo, seq) {
        var keyBuf = await fetchBytes(keyInfo.uri);
        var iv;
        if (keyInfo.iv) {
            iv = hexToBytes(keyInfo.iv);
        } else {
            iv = new Uint8Array(16);
            var s = seq;
            for (var i = 15; i >= 0; i--) { iv[i] = s & 0xff; s = Math.floor(s / 256); }
        }
        var cryptoKey = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-CBC' }, false, ['decrypt']);
        var plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, cryptoKey, data);
        return new Uint8Array(plain);
    }

    /** 小并发池：保序输出，限流 4（社区方案同量级） */
    async function poolMap(items, limit, fn) {
        var out = new Array(items.length);
        var next = 0;
        async function worker() {
            while (next < items.length) {
                var i = next++;
                out[i] = await fn(items[i], i);
            }
        }
        var workers = [];
        for (var k = 0; k < Math.min(limit, items.length); k++) { workers.push(worker()); }
        await Promise.all(workers);
        return out;
    }

    /**
     * 把 N 个 m3u8 依次下载成字节块（拼接顺序 = urls 顺序）。
     * 每个 m3u8：master → 选最高码率 → media → init（fMP4）+ 分片（必要时解密）。
     */
    async function downloadAll(urls, taskId) {
        var parts = [];
        for (var u = 0; u < urls.length; u++) {
            var base = urls[u];
            post({ Message: 'vrMergeProgress', taskId: taskId, index: u + 1, text: '解析第 ' + (u + 1) + ' 段' });
            var pl = parsePlaylist(await fetchText(base), base);
            if (pl.type === 'master') {
                pl.variants.sort(function (a, b) { return b.bandwidth - a.bandwidth; });
                if (!pl.variants.length) { throw new Error('第 ' + (u + 1) + ' 段主清单里没有清晰度'); }
                pl = parsePlaylist(await fetchText(pl.variants[0].url), pl.variants[0].url);
            }
            if (pl.type !== 'media' || !pl.fragments.length) {
                throw new Error('第 ' + (u + 1) + ' 段播放列表没有分片');
            }
            if (pl.map) {
                /* init 段也可能带 byteRange（init 与媒体段同文件） */
                parts.push(await fetchBytes(pl.map.url, pl.map.byteRange || null));
            }
            var keyInfo = null;
            if (pl.key && pl.key.method === 'AES-128' && pl.key.uri) {
                keyInfo = pl.key;
            }
            var done = 0;
            var chunks = await poolMap(pl.fragments, 4, async function (f) {
                var data = await fetchBytes(f.url, f.byteRange || null);
                if (keyInfo) { data = await decryptAes128(data, keyInfo, f.seq); }
                done++;
                if (done % 5 === 0 || done === pl.fragments.length) {
                    post({
                        Message: 'vrMergeProgress', taskId: taskId, index: u + 1,
                        text: '第 ' + (u + 1) + '/' + urls.length + ' 段 ' + done + '/' + pl.fragments.length + ' 片'
                    });
                }
                return data;
            });
            chunks.forEach(function (c) { parts.push(c); });
        }
        return parts;
    }

    /* ================= 三、拼接与合并 ================= */

    function concatParts(parts) {
        var total = 0;
        parts.forEach(function (p) { total += p.byteLength; });
        var merged = new Uint8Array(total);
        var off = 0;
        parts.forEach(function (p) { merged.set(p, off); off += p.byteLength; });
        return merged;
    }

    function isFmp4(buf) {
        return buf.byteLength > 8 &&
            String.fromCharCode(buf[4], buf[5], buf[6], buf[7]) === 'ftyp';
    }

    /**
     * fMP4 拼接：每段 m3u8 的 init（ftyp+moov）会重复出现，
     * 播放器只认开头一个。按 MP4 box 走一遍，跳过重复的 init 类 box。
     */
    /**
     * fMP4 拼接：每段 m3u8 的 init（ftyp+moov）会重复出现，
     * 播放器只认开头一个。按 MP4 box 走一遍，跳过重复的 init 类 box。
     *
     * ⚠️ 2026-11-18 修复（审计 C4，真 bug）：
     *   原实现用**单个** `seenInit` 布尔值判断「是不是重复 init」：
     *     见到 ftyp → seenInit=true；
     *     紧跟着的 moov 被当成「重复 init」→ **被丢弃**。
     *   结果：单段 ftyp+moov+moof+mdat 输出成 ftyp+moof+mdat，
     *   MP4 没有文件头（moov 含全部轨道信息），播放器直接打不开。
     *   单测 `test-m3u8-byterange.js` 抓到（48 → 36 bytes）。
     *
     * 正确做法：以 **ftyp/styp 作为「一组 init 的开头」**，
     *   第一组整组保留；从**第二组的开头**起才开始跳过，直到遇到非 init box
     *   （moof/mdat）为止。这样第一组里的 moov 不会被误删。
     */
    function stripRepeatedInit(buf) {
        var parts = [];
        var p = 0;
        var seenGroup = false;   // 是否已经完整收过第一组 init
        var skipping = false;    // 当前是否处于「跳过重复 init 组」中

        function isInitBox(t) {
            return t === 'ftyp' || t === 'styp' || t === 'moov' ||
                t === 'free' || t === 'sidx';
        }
        function isGroupStart(t) {
            return t === 'ftyp' || t === 'styp';
        }

        while (p + 8 <= buf.length) {
            var size = ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0;
            var type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
            if (size < 8 || p + size > buf.length) { parts.push(buf.subarray(p)); break; }

            if (isGroupStart(type) && seenGroup) {
                /* 遇到第二组（及以后）的 init 开头 → 整组跳过 */
                skipping = true;
            }

            if (skipping) {
                if (!isInitBox(type)) {
                    /* init 组结束，正常内容从这里开始 */
                    skipping = false;
                    parts.push(buf.subarray(p, p + size));
                }
                /* 否则：属于重复 init，丢弃 */
            } else {
                if (isInitBox(type)) { seenGroup = true; }
                parts.push(buf.subarray(p, p + size));
            }
            p += size;
        }
        return new Blob(parts, { type: 'video/mp4' });
    }

    /** TS 流整体转码成 MP4（mux.js，猫抓合并同款库；多段依次 push 是标准用法）
     *  关键：第一个 data 事件带 initSegment（ftyp+moov）——必须拼进输出，
     *  否则 MP4 没有文件头（ffprobe 报 "no tfhd was found"）。踩过。 */
    function transmuxTs(tsData) {
        return new Promise(function (resolve, reject) {
            try {
                var tx = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: false, remux: true });
                var chunks = [];
                var head = true;
                tx.on('data', function (seg) {
                    if (head && seg.initSegment && seg.initSegment.byteLength) {
                        var buf = new Uint8Array(seg.initSegment.byteLength + seg.data.byteLength);
                        buf.set(seg.initSegment, 0);
                        buf.set(seg.data, seg.initSegment.byteLength);
                        chunks.push(buf);
                        head = false;
                    } else {
                        chunks.push(new Uint8Array(seg.data));
                    }
                });
                tx.push(tsData);
                tx.flush();
                if (!chunks.length) { reject(new Error('转码结果为空')); return; }
                resolve(new Blob(chunks, { type: 'video/mp4' }));
            } catch (e) { reject(e); }
        });
    }

    /* ================= 四、消息分发 ================= */

    chrome.runtime.onMessage.addListener(function (Message, sender, sendResponse) {
        if (!Message || typeof Message !== 'object') { return; }

        // 开始：直连下载 + 合并（自动归组 / 手动页共用同一管线）
        if (Message.Message === 'vrMergeRun' && Message.taskId) {
            var taskId = Message.taskId;
            if (running[taskId]) { sendResponse({ ok: false, reason: 'running' }); return; }
            running[taskId] = true;
            sendResponse({ ok: true });
            (async function () {
                try {
                    var parts = await downloadAll(Message.urls || [], taskId);
                    post({ Message: 'vrMergeProgress', taskId: taskId, index: -1, text: '拼接合并中' });
                    var merged = concatParts(parts);
                    var out;
                    if (isFmp4(merged)) {
                        out = { blob: stripRepeatedInit(merged), ext: 'mp4' };
                    } else {
                        try {
                            out = { blob: await transmuxTs(merged), ext: 'mp4' };
                        } catch (e) {
                            // 转码失败降级：原始 TS 也能被 PotPlayer/VLC 直接放
                            out = { blob: new Blob([merged], { type: 'video/MP2T' }), ext: 'ts' };
                        }
                    }
                    // 离屏上下文没有 chrome.downloads——建好 blob URL 交给 SW 落盘
                    // （blob URL 是扩展源内可解析的，SW 的 downloads 能拿到）
                    var blobUrl = URL.createObjectURL(out.blob);
                    blobs[taskId] = { blobUrl: blobUrl, ext: out.ext, bytes: out.blob.size };
                    post({ Message: 'vrMergeReady', taskId: taskId, bytes: out.blob.size, ext: out.ext, blobUrl: blobUrl });
                } catch (e) {
                    post({ Message: 'vrMergeError', taskId: taskId, error: String((e && e.message) || e) });
                } finally {
                    running[taskId] = false;
                }
            })();
            return true;
        }

        // 落盘成功/放弃后释放 blob
        if (Message.Message === 'vrMergeRevoke' && Message.taskId) {
            var rec = blobs[Message.taskId];
            if (rec) {
                try { URL.revokeObjectURL(rec.blobUrl); } catch (e) { /* 忽略 */ }
                delete blobs[Message.taskId];
            }
            sendResponse({ ok: true });
            return;
        }
    });

    /* 2026-11-18（审计 C4）：测试钩子。
     * 本文件是封闭 IIFE（离屏页专用，依赖 chrome.runtime），Node 里没法直接跑。
     * 但 parsePlaylist / parseByteRange / isFmp4 / stripRepeatedInit 都是纯函数，
     * 必须能单独验证 —— 否则「支持 EXT-X-BYTERANGE」只是一句没有证据的话。
     * 只在 CommonJS 环境导出，离屏页里 module 不存在，行为完全不变。 */
    if (typeof module === 'object' && module && module.exports) {
        module.exports = {
            parsePlaylist: parsePlaylist,
            parseByteRange: parseByteRange,
            isFmp4: isFmp4,
            stripRepeatedInit: stripRepeatedInit,
            concatParts: concatParts
        };
    }
})();
