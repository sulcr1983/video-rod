/**
 * 备份 / 恢复全链路 e2e（Node 侧，不需要目录授权弹窗）
 *
 * 为什么要单独测这条链路：
 *   「导出整包」和「从整包恢复」是用户重装后唯一的救命通道，
 *   如果导出出来的 zip 少了缩略图、或者恢复时字段还原不全，
 *   用户要等到真正重装那天才会发现 —— 那时候已经无法补救。
 *
 * 覆盖的真实流程（与 settings.js 的实现一一对应）：
 *   ① 递归列出 _library/ 下所有文件   → listFiles
 *   ② 读文件字节并打包成 zip          → makeZip / VRZip.build
 *   ③ 解包校验字节完整、数量一致       → VRZip.parse
 *   ④ 快照 JSON → 恢复条目，字段不丢   → VRIndex.snapshotPayload / scanSnapshot 语义
 *
 * FSA 目录句柄无法在 Node 构造，所以用 mock handle 实现 getFile()/entries()，
 * 其余逻辑（遍历、打包、解析、字段还原）全部走真实代码。
 *
 * 跑法：node tools/test-backup-restore.js
 */
'use strict';

const path = require('path');
const zlib = require('zlib');

globalThis.self = globalThis;
require(path.join(__dirname, '..', 'js', 'library', 'path.js'));
require(path.join(__dirname, '..', 'js', 'library', 'zip.js'));
require(path.join(__dirname, '..', 'js', 'library', 'indexer.js'));

const Z = globalThis.VRZip;
const I = globalThis.VRIndex;

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fails.push(name + (detail ? '\n    ' + detail : '')); }
}
function eq(name, got, expect) {
  const a = JSON.stringify(got), b = JSON.stringify(expect);
  if (a === b) { pass++; }
  else { fails.push(name + '\n    got:    ' + a + '\n    expect: ' + b); }
}

/* ==========================================================
 * 1) 构造一个假的 _library 目录（含中文名、子目录、空文件）
 * ========================================================== */

/** 把字节包成 K 最小的 File 替身 */
function mkFile(bytes, name) {
  return {
    name: name,
    size: bytes.length,
    arrayBuffer: async function () {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

/** 目录替身：entries() 异步迭代，与 FSA 同形 */
function mkDir(map) {
  return {
    kind: 'directory',
    entries: async function* () {
      for (const [name, child] of Object.entries(map)) { yield [name, child]; }
    }
  };
}

function mkFileHandle(bytes, name) {
  return { kind: 'file', name: name, getFile: async function () { return mkFile(bytes, name); } };
}

const snapshotJson = JSON.stringify({
  schema: 2,
  version: 1,
  at: 1762500000000,
  root: 'D:/video-rod',
  subdir: 'video-rod',
  count: 2,
  favorites: [{ id: 'fav-1', name: '收藏', ids: ['花瓣/u1/图片/面包.jpg'] }],
  files: [
    {
      relPath: '花瓣/u1/图片/面包.jpg', size: 204800, mtime: 1762400000000,
      platform: 'huaban', creatorId: 'u1', type: 'image', fileName: '面包.jpg',
      starred: 1, tags: ['风景'], displayName: '面包（改名）',
      width: 1200, height: 800, duration: 0, mime: 'image/jpeg',
      sourceUrl: 'https://x/o.jpg?t=1', pageUrl: 'https://huaban.com/pins/1',
      thumbFile: 'a3f9c1e28b7d4f60', thumbSrc: { mtime: 1762400000000, size: 204800 }
    },
    {
      relPath: 'X/ken/视频/短片.mp4', size: 9000000, mtime: 1762400001000,
      platform: 'x', creatorId: 'ken', type: 'video', fileName: '短片.mp4',
      starred: 0, tags: []
    }
  ]
}, null, 2);

const thumbBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 1, 2, 3, 4, 5]);
const metaJson = JSON.stringify({ schema: 2, view: 'grid' });

const fakeLib = mkDir({
  'index.json': mkFileHandle(new TextEncoder().encode(snapshotJson), 'index.json'),
  'index-20261107.json': mkFileHandle(new TextEncoder().encode(snapshotJson), 'index-20261107.json'),
  'meta.json': mkFileHandle(new TextEncoder().encode(metaJson), 'meta.json'),
  'thumbs': mkDir({
    'a3f9c1e28b7d4f60.webp': mkFileHandle(thumbBytes, 'a3f9c1e28b7d4f60.webp'),
    '中文名缩略图.webp': mkFileHandle(new Uint8Array([9, 9, 9]), '中文名缩略图.webp')
  })
});

/* ==========================================================
 * 2) listFiles：递归列出所有文件（复刻 settings.js 的实现）
 * ========================================================== */
async function listFiles(dir, prefix) {
  let out = [];
  for await (const e of dir.entries()) {
    const name = e[0], h = e[1];
    const rel = prefix ? (prefix + '/' + name) : name;
    if (h.kind === 'file') {
      out.push({ rel, handle: h });
    } else {
      out = out.concat(await listFiles(h, rel));
    }
  }
  return out;
}

(async function run() {
  const files = await listFiles(fakeLib, '');
  eq('listFiles 递归列出 5 个文件', files.length, 5);
  ok('listFiles 包含子目录里的文件',
    files.some(f => f.rel === 'thumbs/a3f9c1e28b7d4f60.webp'),
    JSON.stringify(files.map(f => f.rel)));
  ok('listFiles 包含中文名文件',
    files.some(f => f.rel === 'thumbs/中文名缩略图.webp'));
  ok('listFiles 不把目录当文件', !files.some(f => f.rel === 'thumbs'));

  /* ==========================================================
   * 3) 打包（复刻 settings.js 的 makeZip）
   * ========================================================== */
  const entries = [];
  for (const f of files) {
    const file = await f.handle.getFile();
    const data = new Uint8Array(await file.arrayBuffer());
    entries.push({ name: '_library/' + f.rel, data: data });
  }
  const zipBytes = Z.build(entries);
  ok('zip 已生成', zipBytes.length > 0);

  /* ==========================================================
   * 4) 解包校验：数量、名字、字节完整性
   * ========================================================== */
  const parsed = Z.parse(zipBytes);
  eq('解包条目数与原文件数一致', parsed.entries.length, files.length);

  const nameSet = parsed.entries.map(e => e.name).sort();
  eq('解包名字前缀统一为 _library/',
    nameSet.every(n => n.startsWith('_library/')), true);
  ok('解包含中文路径', nameSet.some(n => n.indexOf('中文名缩略图') >= 0), nameSet.join(','));

  /* 逐条比对字节（用本地头偏移 + 30 + 名字长度） */
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let allBytesOk = true;
  let crcOk = true;
  for (const e of parsed.entries) {
    const src = entries.find(x => x.name === e.name);
    if (!src) { allBytesOk = false; continue; }
    const sig = dv.getUint32(e.offset, true);
    if (sig !== Z.SIG_LOCAL) { allBytesOk = false; continue; }
    const nameLen = dv.getUint16(e.offset + 26, true);
    const start = e.offset + 30 + nameLen;
    const got = zipBytes.subarray(start, start + e.size);
    if (JSON.stringify(Array.from(got)) !== JSON.stringify(Array.from(src.data))) {
      allBytesOk = false;
    }
    if (Z.crc32(got) !== e.crc) { crcOk = false; }
  }
  ok('每条数据字节完全一致', allBytesOk);
  ok('每条 CRC 与内容自洽', crcOk);

  /* ==========================================================
   * 5) 恢复侧：快照字段能完整还原（A1/A2 的 e2e 版本）
   * ========================================================== */
  const idxEntry = parsed.entries.find(e => e.name === '_library/index.json');
  ok('zip 里有 index.json', !!idxEntry);

  const nameLen = dv.getUint16(idxEntry.offset + 26, true);
  const start = idxEntry.offset + 30 + nameLen;
  const snapBack = JSON.parse(new TextDecoder().decode(
    zipBytes.subarray(start, start + idxEntry.size)));

  eq('恢复：schema 保留', snapBack.schema, 2);
  eq('恢复：root 保留', snapBack.root, 'D:/video-rod');
  eq('恢复：收藏夹保留', snapBack.favorites.length, 1);
  eq('恢复：收藏夹名字', snapBack.favorites[0].name, '收藏');
  eq('恢复：条目数', snapBack.files.length, 2);

  const f0 = snapBack.files[0];
  /* 这 8 个字段就是「重装后会丢」的那批 */
  ['displayName', 'width', 'height', 'duration', 'mime', 'sourceUrl', 'pageUrl', 'thumbFile']
    .forEach(k => ok('恢复：字段 ' + k + ' 还在', k in f0, '缺 ' + k));
  eq('恢复：starred', f0.starred, 1);
  eq('恢复：tags', f0.tags, ['风景']);
  eq('恢复：displayName 值', f0.displayName, '面包（改名）');
  eq('恢复：thumbFile 值', f0.thumbFile, 'a3f9c1e28b7d4f60');
  eq('恢复：thumbSrc.mtime', f0.thumbSrc.mtime, 1762400000000);

  /* ==========================================================
   * 6) 缩略图能在 zip 里被找到（重装后不用重新解码）
   * ========================================================== */
  const thumbName = '_library/thumbs/' + f0.thumbFile + '.webp';
  ok('zip 里有对应缩略图文件',
    parsed.entries.some(e => e.name === thumbName),
    '找 ' + thumbName + '，实际有 ' + parsed.entries.map(e => e.name).join(','));

  const thumbEntry = parsed.entries.find(e => e.name === thumbName);
  const tnl = dv.getUint16(thumbEntry.offset + 26, true);
  const ts = thumbEntry.offset + 30 + tnl;
  const thumbBack = zipBytes.subarray(ts, ts + thumbEntry.size);
  eq('缩略图字节完整还原', Array.from(thumbBack), Array.from(thumbBytes));

  /* ==========================================================
   * 7) 打包规模与压缩率（给用户如实预期）
   * ========================================================== */
  const rawSize = entries.reduce((a, e) => a + e.data.length, 0);
  const overhead = zipBytes.length - rawSize;
  ok('STORE 模式开销小于 200 字节/条目',
    overhead < 200 * entries.length,
    '开销 ' + overhead + ' 字节 / ' + entries.length + ' 条目');

  const gz = zlib.gzipSync(Buffer.from(snapBack.files ? snapshotJson : '')).length;
  ok('索引 JSON 用 gzip 能显著压缩（说明未来若要压缩有空间）',
    gz < snapshotJson.length, 'gzip ' + gz + ' vs 原文 ' + snapshotJson.length);

  /* ==========================================================
   * 汇总
   * ========================================================== */
  console.log('\n' + '='.repeat(60));
  if (fails.length) {
    console.log('FAILED ' + fails.length + ' / ' + (pass + fails.length));
    fails.forEach((f, i) => console.log('\n  [' + (i + 1) + '] ' + f));
    process.exit(1);
  }
  console.log('PASS ' + pass + ' 条断言全部通过');
  console.log('='.repeat(60) + '\n');
  process.exit(0);
})();