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
                if (mUri) { map = { url: absUrl(mUri[1], baseUrl) }; }
            } else if (line.indexOf('#EXT-X-MEDIA-SEQUENCE:') === 0) {
                var s = parseInt(line.split(':')[1], 10);
                seq = isNaN(s) ? 0 : s;
            } else if (line.charAt(0) !== '#') {
                fragments.push({ url: absUrl(line, baseUrl), seq: seq });
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

    async function fetchBytes(url) {
        var lastErr = null;
        for (var attempt = 0; attempt < 3; attempt++) {
            try {
                var r = await fetch(url, { credentials: 'include' });
                if (!r.ok) { throw new Error('HTTP ' + r.status); }
                return new Uint8Array(await r.arrayBuffer());
            } catch (e) { lastErr = e; await sleep(400 * (attempt + 1)); }
        }
        throw new Error('拉分片失败 ' + String(lastErr && lastErr.message || lastErr) + ' ' + url.slice(0, 80));
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
                parts.push(await fetchBytes(pl.map.url));
            }
            var keyInfo = null;
            if (pl.key && pl.key.method === 'AES-128' && pl.key.uri) {
                keyInfo = pl.key;
            }
            var done = 0;
            var chunks = await poolMap(pl.fragments, 4, async function (f) {
                var data = await fetchBytes(f.url);
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
    function stripRepeatedInit(buf) {
        var parts = [];
        var p = 0;
        var seenInit = false;
        while (p + 8 <= buf.length) {
            var size = ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0;
            var type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
            if (size < 8 || p + size > buf.length) { parts.push(buf.subarray(p)); break; }
            var isInit = type === 'ftyp' || type === 'moov' || type === 'free' || type === 'sidx' || type === 'styp';
            if (isInit && seenInit) {
                // 重复 init，跳过
            } else {
                if (isInit) { seenInit = true; }
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
})();
