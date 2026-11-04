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

    /** 把一个 moof 里所有 tfhd.track_ID 改成 id（原地） */
    function retagMoof(moof, id) {
        var trafs = readBoxes(moof, 0, moof.length);
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
        var trafs = readBoxes(moof, 0, moof.length);
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
            var moof = b.slice(boxes[i].start, boxes[i].end);
            if (newId != null) { retagMoof(moof, newId); }
            var parts = [moof];
            i++;
            while (i < boxes.length && boxes[i].type === 'mdat') {
                parts.push(b.slice(boxes[i].start, boxes[i].end));
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

    global.VRFmp4 = { merge: merge, inspect: inspect, _readBoxes: readBoxes };
})(typeof self !== 'undefined' ? self : this);
