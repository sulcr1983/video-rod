/**
 * m3u8 合并 · EXT-X-BYTERANGE / EXT-X-MAP 单测（审计 C4）
 *
 * 背景（代码实证）：
 *   改前 `m3u8-merge.js` 里 `EXT-X-BYTERANGE` 出现 0 次 —— 遇到 fMP4 单文件流
 *   （init 与媒体段同文件、靠 byteRange 切分，B站/腾讯常见）时，
 *   每个分片都会把**整个文件**拉一遍：流量爆炸，拼出来的 mp4 也是坏的。
 *
 * 本测试覆盖：
 *   ① parseByteRange：len@offset / 省略 offset 接续 / 非法输入
 *   ② parsePlaylist：EXT-X-BYTERANGE 挂到下一行 URI、EXT-X-MAP 的 BYTERANGE
 *   ③ isFmp4 / stripRepeatedInit：重复 init 去重
 *   ④ 兼容：无 BYTERANGE 的普通清单行为不变
 *
 * 跑法：node tools/test-m3u8-byterange.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

/* m3u8-merge.js 顶层会调 chrome.runtime.onMessage.addListener，
 * Node 里必须先给一个最小桩，否则 require 直接抛 "chrome is not defined"。 */
globalThis.chrome = {
    runtime: {
        onMessage: { addListener() { /* noop */ } },
        sendMessage() { /* noop */ }
    }
};

const M = require(path.join(__dirname, '..', 'js', 'm3u8-merge.js'));

/* ---------------- ① parseByteRange ---------------- */

test('parseByteRange：len@offset 显式偏移', () => {
    const br = M.parseByteRange('1000@2000', {}, 'a.mp4');
    assert.deepEqual(br, { start: 2000, end: 3000 });
});

test('parseByteRange：省略 offset 时从头开始（无前序）', () => {
    const br = M.parseByteRange('500', {}, 'a.mp4');
    assert.deepEqual(br, { start: 0, end: 500 });
});

test('parseByteRange：省略 offset 时接续同 URI 上一次的结束位置', () => {
    const prev = {};
    const b1 = M.parseByteRange('100@0', prev, 'a.mp4');
    const b2 = M.parseByteRange('200', prev, 'a.mp4');
    assert.deepEqual(b1, { start: 0, end: 100 });
    assert.deepEqual(b2, { start: 100, end: 300 }, '应从 100 接续，不是从 0');
});

test('parseByteRange：不同 URI 各自独立计数', () => {
    const prev = {};
    M.parseByteRange('100@0', prev, 'a.mp4');
    const other = M.parseByteRange('50', prev, 'b.mp4');
    assert.deepEqual(other, { start: 0, end: 50 }, 'b.mp4 不该受 a.mp4 影响');
});

test('parseByteRange：非法输入返回 null', () => {
    assert.equal(M.parseByteRange('', {}, 'a'), null);
    assert.equal(M.parseByteRange('abc', {}, 'a'), null);
    assert.equal(M.parseByteRange('0@0', {}, 'a'), null, '长度 0 无意义');
    assert.equal(M.parseByteRange(null, {}, 'a'), null);
    assert.equal(M.parseByteRange('-5@0', {}, 'a'), null);
});

/* ---------------- ② parsePlaylist ---------------- */

const BASE = 'https://cdn.example.com/v/';

test('parsePlaylist：EXT-X-BYTERANGE 挂到紧随其后的 URI', () => {
    const txt = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXTINF:4.0,',
        '#EXT-X-BYTERANGE:1000@0',
        'seg.mp4',
        '#EXTINF:4.0,',
        '#EXT-X-BYTERANGE:2000@1000',
        'seg.mp4',
        '#EXT-X-ENDLIST'
    ].join('\n');

    const pl = M.parsePlaylist(txt, BASE);
    assert.equal(pl.type, 'media');
    assert.equal(pl.fragments.length, 2);
    assert.deepEqual(pl.fragments[0].byteRange, { start: 0, end: 1000 });
    assert.deepEqual(pl.fragments[1].byteRange, { start: 1000, end: 3000 });
});

test('parsePlaylist：省略 offset 的分片按同 URI 接续', () => {
    const txt = [
        '#EXTM3U',
        '#EXTINF:4,',
        '#EXT-X-BYTERANGE:100@0',
        'f.mp4',
        '#EXTINF:4,',
        '#EXT-X-BYTERANGE:100',
        'f.mp4',
        '#EXTINF:4,',
        '#EXT-X-BYTERANGE:100',
        'f.mp4'
    ].join('\n');

    const pl = M.parsePlaylist(txt, BASE);
    assert.equal(pl.fragments.length, 3);
    assert.deepEqual(pl.fragments.map((f) => f.byteRange),
        [{ start: 0, end: 100 }, { start: 100, end: 200 }, { start: 200, end: 300 }]);
});

test('parsePlaylist：EXT-X-MAP 的 BYTERANGE 被解析', () => {
    const txt = [
        '#EXTM3U',
        '#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"',
        '#EXTINF:4,',
        '#EXT-X-BYTERANGE:1000@720',
        'main.mp4'
    ].join('\n');

    const pl = M.parsePlaylist(txt, BASE);
    assert.ok(pl.map, '应解析出 map');
    assert.equal(pl.map.url, BASE + 'init.mp4');
    assert.deepEqual(pl.map.byteRange, { start: 0, end: 720 });
});

test('parsePlaylist：EXT-X-MAP 无 BYTERANGE 时只有 url', () => {
    const txt = [
        '#EXTM3U',
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXTINF:4,',
        'a.mp4'
    ].join('\n');
    const pl = M.parsePlaylist(txt, BASE);
    assert.equal(pl.map.url, BASE + 'init.mp4');
    assert.equal(pl.map.byteRange, undefined, '不该凭空造 byteRange');
});

test('parsePlaylist：普通清单（无 BYTERANGE）行为不变', () => {
    const txt = [
        '#EXTM3U',
        '#EXTINF:4,',
        'a.ts',
        '#EXTINF:4,',
        'b.ts',
        '#EXT-X-ENDLIST'
    ].join('\n');
    const pl = M.parsePlaylist(txt, BASE);
    assert.equal(pl.fragments.length, 2);
    assert.equal(pl.fragments[0].byteRange, undefined, '不该给普通分片加 byteRange');
    assert.equal(pl.fragments[0].url, BASE + 'a.ts');
});

test('parsePlaylist：master 清单仍能识别', () => {
    const txt = [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=2000000',
        'hi.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=800000',
        'lo.m3u8'
    ].join('\n');
    const pl = M.parsePlaylist(txt, BASE);
    assert.equal(pl.type, 'master');
    assert.equal(pl.variants.length, 2);
    assert.equal(pl.variants[0].bandwidth, 2000000);
});

/* ---------------- ③ fMP4 init 去重 ---------------- */

/** 造一个最小 MP4 box：[size(4) type(4) payload] */
function box(type, payloadLen) {
    const size = 8 + payloadLen;
    const b = new Uint8Array(size);
    b[0] = (size >>> 24) & 0xff; b[1] = (size >>> 16) & 0xff;
    b[2] = (size >>> 8) & 0xff; b[3] = size & 0xff;
    for (let i = 0; i < 4; i++) { b[4 + i] = type.charCodeAt(i); }
    return b;
}

function concat(...arrs) {
    const total = arrs.reduce((n, a) => n + a.byteLength, 0);
    const out = new Uint8Array(total);
    let off = 0;
    arrs.forEach((a) => { out.set(a, off); off += a.byteLength; });
    return out;
}

test('isFmp4：ftyp 开头判为 fMP4', () => {
    const ftyp = box('ftyp', 8);
    assert.equal(M.isFmp4(ftyp), true);
});

test('isFmp4：TS 流（0x47 同步字节）不判为 fMP4', () => {
    const ts = new Uint8Array(200).fill(0x47);
    assert.equal(M.isFmp4(ts), false);
});

test('stripRepeatedInit：重复的 ftyp/moov 只保留第一份', async () => {
    const ftyp = box('ftyp', 8);
    const moov = box('moov', 8);
    const moof = box('moof', 8);
    const mdat = box('mdat', 8);

    /* 两段各自带 init（模拟多段 m3u8 拼接） */
    const merged = concat(ftyp, moov, moof, mdat, ftyp, moov, moof, mdat);
    const blob = M.stripRepeatedInit(merged);
    const out = new Uint8Array(await blob.arrayBuffer());

    /* 期望：第一份 init + 两个 moof/mdat，第二份 init 被丢掉 */
    const expect = concat(ftyp, moov, moof, mdat, moof, mdat);
    assert.equal(out.byteLength, expect.byteLength,
        '长度应等于「去重后的结果」，实际 ' + out.byteLength + ' vs ' + expect.byteLength);
    assert.deepEqual(Array.from(out), Array.from(expect));
});

test('stripRepeatedInit：单段不受影响', async () => {
    const one = concat(box('ftyp', 4), box('moov', 4), box('moof', 4), box('mdat', 4));
    const blob = M.stripRepeatedInit(one);
    const out = new Uint8Array(await blob.arrayBuffer());
    assert.equal(out.byteLength, one.byteLength);
});

/* ---------------- ④ concatParts ---------------- */

test('concatParts：保序拼接', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3]);
    const c = M.concatParts([a, b]);
    assert.deepEqual(Array.from(c), [1, 2, 3]);
});
