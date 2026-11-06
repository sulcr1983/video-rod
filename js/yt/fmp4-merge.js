/**
 * 苏哥的钓鱼竿：fMP4 双轨合并（YouTube DASH 专用）
 *
 * 背景：YouTube 的 1080p/4K 是 DASH 分离轨——视频一个 MP4、音频一个 MP4，
 * 直接改后缀名拼起来播不了。重新编码不可接受（慢、掉画质、还要 ffmpeg），
 * 所以这里做「不重编码的容器层合并」：
 *
 *   ftyp + moov(video)  +  [moof+mdat]*        视频轨
 *   ftyp + moov(audio)  +  [moof+mdat]*        音频轨
 *   ↓
 *   ftyp + moov(video 的 mvhd + 两条 trak + 两条 trex)  +  按解码时间排序的 [moof+mdat]*
 *
 * 为什么不用解全部 box：分片 MP4 的 trun.data_offset 是相对 moof 起点的，
 * 只要 moof 和它后面的 mdat 始终贴在一起、字节不动，偏移就永远有效。
 * 唯一必须改的是 track_ID（两轨都是 1 会打架），它在 tkhd / trex / tfhd 里各一处，
 * 都是定长字段，原地改 4 字节即可。
 *
 * 不做的事：不解 moov 里除 trak/mvex/mvhd 之外的东西，不碰编码参数，不重排 sample。
 */
(function (global) {
    'use strict';

    function u32(b, o) {
        return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    }

    function w32(b, o, v) {
        b[o] = (v >>> 24) & 255;
        b[o + 1] = (v >>> 16) & 255;
        b[o + 2] = (v >>> 8) & 255;
        b[o + 3] = v & 255;
    }

    function boxType(b, o) {
        return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    }

    /** 读一层 box 列表（不做递归） */
    function readBoxes(b, start, end) {
        var out = [], i = start;
        while (i + 8 <= end) {
            var size = u32(b, i);
            var hdr = 8;
            if (size === 1) {
                if (i + 16 > end) { break; }
                size = u32(b, i + 8) * 4294967296 + u32(b, i + 12);
                hdr = 16;
            } else if (size === 0) {
                size = end - i;
            }
            if (size < hdr || i + size > end) { break; }
            out.push({ type: boxType(b, i + 4), start: i, end: i + size, payload: i + hdr });
            i += size;
        }
        return out;
    }

    function makeBox(type, parts) {
        var len = 0, i;
        for (i = 0; i < parts.length; i++) { len += parts[i].length; }
        var out = new Uint8Array(8 + len);
        w32(out, 0, 8 + len);
        for (i = 0; i < 4; i++) { out[4 + i] = type.charCodeAt(i); }
        var off = 8;
        for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
        return out;
    }

    function first(list, type) {
        for (var i = 0; i < list.length; i++) { if (list[i].type === type) { return list[i]; } }
        return null;
    }

    /** tkhd 里的 track_ID：v0 在 payload+12，v1 在 payload+20 */
    function tkhdOffset(b, payload) { return payload + (b[payload] === 1 ? 20 : 12); }

    /** tfdt 的 baseMediaDecodeTime */
    function tfdtTime(b, payload) {
        var v = b[payload];
        if (v === 1) {
            return u32(b, payload + 4) * 4294967296 + u32(b, payload + 8);
        }
        return u32(b, payload + 4);
    }

    /** moof 的直接子 box 是 traf；不能对整段 moof 调 readBoxes(0)，
     *  那只会读到 moof 自己，导致 track_ID 从不改写、时间全部为 0。 */
    function moofTrafs(moof) {
        var top = readBoxes(moof, 0, moof.length);
        var box = first(top, 'moof');
        return box ? readBoxes(moof, box.payload, box.end) : [];
    }

    /** 把一个 moof 里所有 tfhd.track_ID 改成 id（原地） */
    function retagMoof(moof, id) {
        var trafs = moofTrafs(moof);
        for (var i = 0; i < trafs.length; i++) {
            if (trafs[i].type !== 'traf') { continue; }
            var kids = readBoxes(moof, trafs[i].payload, trafs[i].end);
            for (var j = 0; j < kids.length; j++) {
                if (kids[j].type === 'tfhd') { w32(moof, kids[j].payload + 4, id); }
            }
        }
    }

    /** 取一个 moof 的最早解码时间（用来排序交织） */
    function moofTime(moof) {
        var trafs = moofTrafs(moof);
        for (var i = 0; i < trafs.length; i++) {
            if (trafs[i].type !== 'traf') { continue; }
            var kids = readBoxes(moof, trafs[i].payload, trafs[i].end);
            var tf = first(kids, 'tfdt');
            if (tf) { return tfdtTime(moof, tf.payload); }
        }
        return 0;
    }

    /** 收集 moof(+紧随的 mdat) 片段，可选把 track_ID 重写 */
    function collectFragments(b, boxes, newId) {
        var out = [], i = 0;
        while (i < boxes.length) {
            if (boxes[i].type !== 'moof') { i++; continue; }
            /* moof 要改 track_ID，必须复制（几 KB，忽略不计） */
            var moof = b.slice(boxes[i].start, boxes[i].end);
            if (newId != null) { retagMoof(moof, newId); }
            var parts = [moof];
            i++;
            while (i < boxes.length && boxes[i].type === 'mdat') {
                /* mdat 占整轨 99% 的字节：用 subarray 视图，不复制。
                 * 原来 slice() 会把 291MB 的视频再拷一份，加上合并前的两条轨，
                 * 峰值轻松过 600MB，主线程直接卡住。 */
                parts.push(b.subarray(boxes[i].start, boxes[i].end));
                i++;
            }
            out.push({ t: moofTime(moof), parts: parts });
        }
        return out;
    }

    function totalLen(parts) {
        var n = 0;
        for (var i = 0; i < parts.length; i++) { n += parts[i].length; }
        return n;
    }

    /**
     * 把分片数组直接交给 Blob，不再逐片拼成一个大 Uint8Array。
     *
     * 原来 `new Blob(all)` 里 all 是若干 Uint8Array 视图，Blob 构造函数会把它们
     * 各拷一份；1080p 291MB / 4K 692MB 的视频（双轨合计近 1GB）会长时间卡住
     * 主线程，用户看到的就是「音频合并卡死」。Blob 接受 Uint8Array 序列时
     * 由浏览器内部按引用拼接，代价低得多。
     */
    function toBlob(parts) {
        return new Blob(parts, { type: 'video/mp4' });
    }

    /**
     * 合并 video / audio 两条 fMP4
     * @param {Uint8Array} vB 视频整文件
     * @param {Uint8Array} aB 音频整文件
     * @returns {Blob} 单文件 fMP4（含双轨）
     */
    function merge(vB, aB) {
        var vb = readBoxes(vB, 0, vB.length);
        var ab = readBoxes(aB, 0, aB.length);

        var vMoovBox = first(vb, 'moov');
        var aMoovBox = first(ab, 'moov');
        if (!vMoovBox || !aMoovBox) { throw new Error('输入里没有 moov（不是分片 MP4？）'); }

        var vKids = readBoxes(vB, vMoovBox.payload, vMoovBox.end);
        var aKids = readBoxes(aB, aMoovBox.payload, aMoovBox.end);
        var vTrakBox = first(vKids, 'trak');
        var aTrakBox = first(aKids, 'trak');
        if (!vTrakBox || !aTrakBox) { throw new Error('moov 里缺 trak'); }

        var vTkhd = first(readBoxes(vB, vTrakBox.payload, vTrakBox.end), 'tkhd');
        var aTkhd = first(readBoxes(aB, aTrakBox.payload, aTrakBox.end), 'tkhd');
        if (!vTkhd || !aTkhd) { throw new Error('trak 里缺 tkhd'); }

        var vId = u32(vB, tkhdOffset(vB, vTkhd.payload));
        var aId = u32(aB, tkhdOffset(aB, aTkhd.payload));
        var newAId = (aId === vId) ? (vId === 2 ? 3 : 2) : aId;

        // 音频 trak：整块复制后原地改 track_ID
        var aTrak = aB.slice(aTrakBox.start, aTrakBox.end);
        w32(aTrak, (aTkhd.payload - aTrakBox.start) +
            (aB[aTkhd.payload] === 1 ? 20 : 12), newAId);

        // mvex 里的 trex 每个 track 一条，合并后要两条
        var vMvexBox = first(vKids, 'mvex');
        var aMvexBox = first(aKids, 'mvex');
        var mvexParts = [];
        if (vMvexBox) {
            var vTrex = first(readBoxes(vB, vMvexBox.payload, vMvexBox.end), 'trex');
            if (vTrex) { mvexParts.push(vB.slice(vTrex.start, vTrex.end)); }
        }
        if (aMvexBox) {
            var aTrex = first(readBoxes(aB, aMvexBox.payload, aMvexBox.end), 'trex');
            if (aTrex) {
                var trex = aB.slice(aTrex.start, aTrex.end);
                w32(trex, 8 + 4, newAId);       // 8 字节 box 头 + 4 字节 version/flags
                mvexParts.push(trex);
            }
        }
        var newMvex = mvexParts.length ? makeBox('mvex', mvexParts) : null;

        // 重组 moov：mvhd(改 next_track_ID) → trak_v → trak_a → 其余 → mvex
        var parts = [], putAudio = false, putMvex = false;
        for (var i = 0; i < vKids.length; i++) {
            var k = vKids[i];
            if (k.type === 'mvex') {
                if (newMvex) { parts.push(newMvex); putMvex = true; }
                continue;
            }
            if (k.type === 'trak') {
                parts.push(vB.slice(k.start, k.end));
                if (!putAudio) { parts.push(aTrak); putAudio = true; }
                continue;
            }
            if (k.type === 'mvhd') {
                var mv = vB.slice(k.start, k.end);
                w32(mv, mv.length - 4, Math.max(vId, newAId) + 1);   // next_track_ID 是最后一个字段
                parts.push(mv);
                continue;
            }
            parts.push(vB.slice(k.start, k.end));
        }
        if (!putAudio) { parts.push(aTrak); }
        if (newMvex && !putMvex) { parts.push(newMvex); }
        var moov = makeBox('moov', parts);

        // 片段：两轨各自收集 → 按解码时间交织
        var frags = collectFragments(vB, vb, null).concat(collectFragments(aB, ab, newAId));
        frags.sort(function (x, y) { return x.t - y.t; });

        var ftypBox = first(vb, 'ftyp');
        var ftyp = ftypBox ? vB.slice(ftypBox.start, ftypBox.end) : makeBox('ftyp', []);

        var all = [ftyp, moov];
        for (var f = 0; f < frags.length; f++) {
            for (var p = 0; p < frags[f].parts.length; p++) { all.push(frags[f].parts[p]); }
        }
        return toBlob(all);
    }

    /**
     * 跨整条轨道扫描顶层 box（只读每个 box 的 8/16 字节头，不读内容）。
     * mergeBlobs 需要知道每个 moof/mdat 的绝对偏移，但整条轨道几百 MB，
     * 不能整份读进内存。
     *
     * @param {Blob} blob
     * @returns {Promise<Array<{type,start,end,payload}>>}
     */
    async function scanBoxes(blob) {
        var out = [];
        var pos = 0;
        var size = blob.size;
        /* 一次预读 1MB 当窗口：几百个分片时，逐个 slice(8 字节) 的异步往返
         * 会把 400MB 的扫描拖到 2 秒以上。窗口迭代把往返次数降一个数量级。 */
        var WIN = 1024 * 1024;
        var buf = new Uint8Array(0);
        var bufStart = -1;
        async function windowAt(at) {
            if (bufStart >= 0 && at >= bufStart && at + 16 <= bufStart + buf.length) { return; }
            bufStart = at;
            buf = new Uint8Array(await blob.slice(at, Math.min(at + WIN, size)).arrayBuffer());
        }
        var local = -1;
        while (pos + 8 <= size) {
            if (bufStart < 0 || pos < bufStart || pos + 16 > bufStart + buf.length) {
                await windowAt(pos);
                local = 0;
            } else {
                local = pos - bufStart;
            }
            var head = buf.subarray(local, Math.min(local + 16, buf.length));
            var boxSize = u32(head, 0);
            var hdr = 8;
            if (boxSize === 1) {
                if (head.length < 16) { break; }
                boxSize = u32(head, 8) * 4294967296 + u32(head, 12);
                hdr = 16;
            } else if (boxSize === 0) {
                boxSize = size - pos;
            }
            if (boxSize < hdr || pos + boxSize > size) { break; }
            out.push({ type: boxType(head, 4), start: pos, end: pos + boxSize, payload: pos + hdr });
            pos += boxSize;
        }
        return out;
    }

    /**
     * 流式合并：内存只保留「当前分片」，不再把两条轨整份读进内存。
     *
     * 为什么需要：291MB 的 1080p60 双轨合计约 300MB，长视频的 1080p 能到 1GB+。
     * 原来的 fetchBytes 会把整条轨道攒成一个大 Uint8Array，加上 Blob 拼接的副本，
     * 峰值轻松翻倍 —— 这就是「音频合并卡死」的真正原因。
     *
     * 做法：
     *   1. 轨道以 Blob 形式传入（fetch 的 response.blob() 由浏览器托管，不占 JS 堆）；
     *   2. 用 slice() 只把「moof + 它紧跟的 mdat 包头」读进内存判断结构；
     *   3. 输出同样按分片写入 writable，逐块释放。
     *
     * @param {Blob} vBlob 视频轨
     * @param {Blob} aBlob 音频轨
     * @param {object} opt { onProgress(done,total), chunkHint }
     * @returns {Promise<Blob>} 合并结果（仍是 Blob，交给 save() 流式写盘）
     */
    async function mergeBlobs(vBlob, aBlob, opt) {
        var o = opt || {};
        var onProgress = typeof o.onProgress === 'function' ? o.onProgress : function () {};
        /* 先只读文件头：ftyp + moov 都在开头，几十 KB 足够 */
        var HEAD = Math.min(vBlob.size, 2 * 1024 * 1024);
        var vHead = new Uint8Array(await vBlob.slice(0, HEAD).arrayBuffer());
        var aHead = new Uint8Array(await aBlob.slice(0, Math.min(aBlob.size, HEAD)).arrayBuffer());
        var vb = readBoxes(vHead, 0, vHead.length);
        var ab = readBoxes(aHead, 0, aHead.length);

        var vMoov = first(vb, 'moov');
        if (!vMoov || !first(ab, 'moov')) { throw new Error('输入里没有 moov（不是分片 MP4？）'); }
        if (vMoov.end > HEAD) { throw new Error('moov 超过 2MB，暂不支持（罕见）'); }

        var vKids = readBoxes(vHead, vMoov.payload, vMoov.end);
        var vTrak = first(vKids, 'trak');
        if (!vTrak) { throw new Error('moov 里缺 trak'); }
        var vTkhd = first(readBoxes(vHead, vTrak.payload, vTrak.end), 'tkhd');
        if (!vTkhd) { throw new Error('trak 里缺 tkhd'); }
        var vId = u32(vHead, tkhdOffset(vHead, vTkhd.payload));

        var aMoov = first(ab, 'moov');
        var aKids = readBoxes(aHead, aMoov.payload, aMoov.end);
        var aTrak = first(aKids, 'trak');
        if (!aTrak) { throw new Error('音频 moov 里缺 trak'); }
        var aTkhd = first(readBoxes(aHead, aTrak.payload, aTrak.end), 'tkhd');
        if (!aTkhd) { throw new Error('音频 trak 里缺 tkhd'); }
        var aId = u32(aHead, tkhdOffset(aHead, aTkhd.payload));
        var newAId = (aId === vId) ? (vId === 2 ? 3 : 2) : aId;

        /* 音频 trak 整块（几 KB）：复制后原地改 track_ID */
        var aTrakBytes = new Uint8Array(await aBlob.slice(aTrak.start, aTrak.end).arrayBuffer());
        w32(aTrakBytes, (aTkhd.payload - aTrak.start) + (aHead[aTkhd.payload] === 1 ? 20 : 12), newAId);

        var vMvex = first(vKids, 'mvex');
        var aMvex = first(aKids, 'mvex');
        var mvexParts = [];
        if (vMvex) {
            var vTrex = first(readBoxes(vHead, vMvex.payload, vMvex.end), 'trex');
            if (vTrex) { mvexParts.push(vHead.slice(vTrex.start, vTrex.end)); }
        }
        if (aMvex) {
            var aTrex = first(readBoxes(aHead, aMvex.payload, aMvex.end), 'trex');
            if (aTrex) {
                var trex = new Uint8Array(await aBlob.slice(aTrex.start, aTrex.end).arrayBuffer());
                w32(trex, 8 + 4, newAId);
                mvexParts.push(trex);
            }
        }
        var newMvex = mvexParts.length ? makeBox('mvex', mvexParts) : null;

        var parts = [], putAudio = false, putMvex = false;
        for (var i = 0; i < vKids.length; i++) {
            var k = vKids[i];
            if (k.type === 'mvex') {
                if (newMvex) { parts.push(newMvex); putMvex = true; }
                continue;
            }
            if (k.type === 'trak') {
                parts.push(vHead.slice(k.start, k.end));
                if (!putAudio) { parts.push(aTrakBytes); putAudio = true; }
                continue;
            }
            if (k.type === 'mvhd') {
                var mv = vHead.slice(k.start, k.end);
                w32(mv, mv.length - 4, Math.max(vId, newAId) + 1);
                parts.push(mv);
                continue;
            }
            parts.push(vHead.slice(k.start, k.end));
        }
        if (!putAudio) { parts.push(aTrakBytes); }
        if (newMvex && !putMvex) { parts.push(newMvex); }
        var moov = makeBox('moov', parts);

        var ftypBox = first(vb, 'ftyp');
        var ftyp = ftypBox ? vHead.slice(ftypBox.start, ftypBox.end) : makeBox('ftyp', []);

        /* 片段：只读每个 moof 的头（含 tfdt），mdat 用 Blob 切片引用，不进 JS 堆 */
        var CHUNK = o.chunkHint || (4 * 1024 * 1024);
        async function fragsOf(blob, head, boxes, newId) {
            var out = [];
            for (var bi = 0; bi < boxes.length; bi++) {
                if (boxes[bi].type !== 'moof') { continue; }
                var moofStart = boxes[bi].start, moofEnd = boxes[bi].end;
                var moofBytes;
                if (moofEnd <= head.length) {
                    moofBytes = head.slice(moofStart, moofEnd);
                } else {
                    moofBytes = new Uint8Array(await blob.slice(moofStart, moofEnd).arrayBuffer());
                }
                if (newId != null) { retagMoof(moofBytes, newId); }
                var pieces = [moofBytes];
                /* mdat 连续段：按 Blob 引用，不读内容 */
                var j = bi + 1;
                var mdatStart = -1, mdatEnd = -1;
                while (j < boxes.length && boxes[j].type === 'mdat') {
                    if (mdatStart < 0) { mdatStart = boxes[j].start; }
                    mdatEnd = boxes[j].end;
                    j++;
                }
                if (mdatStart >= 0) { pieces.push(blob.slice(mdatStart, mdatEnd)); }
                out.push({ t: moofTime(moofBytes), parts: pieces });
                /* j 已经指向下一个 moof（或末尾）：把循环变量推到它前一位，
                 * 让 for 的 bi++ 正好落在下一个 moof 上。写 bi = j - 1 会漏掉
                 * 紧跟在 mdat 后的那一个 moof，输出直接少一大半数据。 */
                bi = j - 1;
            }
            return out;
        }

        /* 注意：vb/ab 只是文件头 2MB 里的 box，后面几十上百个分片不在其中。
         * 必须跨整条轨道重新扫描（只读 box 头，不读 mdat 内容）。 */
        var vAll = await scanBoxes(vBlob);
        var aAll = await scanBoxes(aBlob);
        var vFrags = await fragsOf(vBlob, vHead, vAll, null);
        var aFrags = await fragsOf(aBlob, aHead, aAll, newAId);
        var frags = vFrags.concat(aFrags);
        frags.sort(function (x, y) { return x.t - y.t; });

        var all = [ftyp, moov];
        for (var f = 0; f < frags.length; f++) {
            for (var p = 0; p < frags[f].parts.length; p++) { all.push(frags[f].parts[p]); }
        }
        onProgress(1, 1);
        return new Blob(all, { type: 'video/mp4' });
    }

    /** 自检：读输出的顶层 box 和 trak 数，给测试用 */
    function inspect(u8) {
        var boxes = readBoxes(u8, 0, u8.length);
        var info = { boxes: [], traks: 0, fragments: 0 };
        boxes.forEach(function (b) { info.boxes.push(b.type); });
        var moov = first(boxes, 'moov');
        if (moov) { info.traks = readBoxes(u8, moov.payload, moov.end).filter(function (x) { return x.type === 'trak'; }).length; }
        info.fragments = boxes.filter(function (x) { return x.type === 'moof'; }).length;
        return info;
    }

    global.VRFmp4 = { merge: merge, mergeBlobs: mergeBlobs, inspect: inspect, _readBoxes: readBoxes, _collectFragments: collectFragments };
})(typeof self !== 'undefined' ? self : this);
