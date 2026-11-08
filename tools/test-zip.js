/**
 * VRZip 单测 —— 校验 zip 结构正确性
 *
 * 为什么必须测：
 *   备份「导出整包」如果 zip 头部字段错一个字节，用户在资源管理器里
 *   双击打开会直接报「压缩文件已损坏」，而且我们平时根本不会解它 ——
 *   这种错只能靠结构化断言提前发现。
 *
 * 覆盖：
 *   · 三个签名（本地头 / 中央目录 / 结束记录）
 *   · UTF-8 文件名（中文目录名）不乱码
 *   · STORE 模式：压缩前后大小相等、方法字段为 0
 *   · CRC-32 已知向量
 *   · 偏移量自洽（中央目录指向的本地头确实在那里）
 *   · 空输入、单条目、多条目
 *
 * 跑法：node tools/test-zip.js
 */
'use strict';

const path = require('path');
globalThis.self = globalThis;
require(path.join(__dirname, '..', 'js', 'library', 'zip.js'));

const Z = globalThis.VRZip;

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

/* ---------------- 模块存在 ---------------- */
ok('VRZip 已加载', !!Z);
ok('导出 build', typeof Z.build === 'function');
ok('导出 parse', typeof Z.parse === 'function');
ok('导出 crc32', typeof Z.crc32 === 'function');

/* ---------------- CRC-32 已知向量 ---------------- */
/* "123456789" 的 CRC-32 = 0xCBF43926（标准测试向量） */
eq('crc32("123456789") = 0xCBF43926',
  Z.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
/* 空输入 CRC 为 0 */
eq('crc32 空输入 = 0', Z.crc32(new Uint8Array(0)), 0);
/* 单字节 "a" = 0xE8B7BE43 */
eq('crc32("a") = 0xE8B7BE43', Z.crc32(new TextEncoder().encode('a')), 0xE8B7BE43);

/* ---------------- 空 zip ---------------- */
const emptyZip = Z.build([]);
eq('空 zip 长度 22（只有结束记录）', emptyZip.length, 22);
const dvE = new DataView(emptyZip.buffer);
eq('空 zip 结束签名', dvE.getUint32(0, true), Z.SIG_END);
eq('空 zip 条目数 0', dvE.getUint16(10, true), 0);

/* ---------------- 单条目 ---------------- */
const payload1 = new TextEncoder().encode('{"schema":2,"count":1}');
const zip1 = Z.build([{ name: '_library/index.json', data: payload1 }]);

const dv1 = new DataView(zip1.buffer);
eq('单条目：首 4 字节是本地头签名', dv1.getUint32(0, true), Z.SIG_LOCAL);
eq('单条目：版本 2.0', dv1.getUint16(4, true), 20);
eq('单条目：UTF-8 标志位', dv1.getUint16(6, true), Z.FLAG_UTF8);
eq('单条目：STORE 方法（0）', dv1.getUint16(8, true), 0);
eq('单条目：CRC 与源一致', dv1.getUint32(14, true), Z.crc32(payload1));
eq('单条目：压缩后大小 = 原始大小', dv1.getUint32(18, true), payload1.length);
eq('单条目：原始大小', dv1.getUint32(22, true), payload1.length);
const nameLen1 = dv1.getUint16(26, true);
eq('单条目：文件名长度', nameLen1, new TextEncoder().encode('_library/index.json').length);
const name1 = new TextDecoder().decode(zip1.subarray(30, 30 + nameLen1));
eq('单条目：文件名正确', name1, '_library/index.json');

/* 数据体紧跟在本地头之后 */
const body1 = zip1.subarray(30 + nameLen1, 30 + nameLen1 + payload1.length);
eq('单条目：数据体字节一致', Array.from(body1), Array.from(payload1));

/* 解析回读 */
const parsed1 = Z.parse(zip1);
eq('parse：条目数 1', parsed1.entries.length, 1);
eq('parse：名字', parsed1.entries[0].name, '_library/index.json');
eq('parse：crc', parsed1.entries[0].crc, Z.crc32(payload1));
eq('parse：size', parsed1.entries[0].size, payload1.length);
eq('parse：method 为 STORE', parsed1.entries[0].method, 0);
eq('parse：flags 含 UTF-8', parsed1.entries[0].flags & 0x0800, 0x0800);
eq('parse：偏移指向本地头', parsed1.entries[0].offset, 0);

/* ---------------- 多条目 + 中文名 ---------------- */
const cnName = '_library/thumbs/面包-x.webp';
const items = [
  { name: '_library/index.json', data: payload1 },
  { name: cnName, data: new Uint8Array([1, 2, 3, 4, 5]) },
  { name: '_library/meta.json', data: new TextEncoder().encode('{}') }
];
const zip3 = Z.build(items);
const parsed3 = Z.parse(zip3);

eq('多条目：条目数 3', parsed3.entries.length, 3);
eq('多条目：顺序保持', parsed3.entries.map(e => e.name),
  ['_library/index.json', cnName, '_library/meta.json']);

/* 中文名不乱码 —— 这是最容易出问题的一条 */
eq('中文文件名解析正确', parsed3.entries[1].name, cnName);
ok('中文名原始字节是 UTF-8 多字节',
  new TextEncoder().encode(cnName).length > cnName.length,
  'UTF-8 中文应占多字节');

/* 每个条目的偏移量必须真的指向一个本地头 */
let offsetsOk = true;
const dv3 = new DataView(zip3.buffer);
for (const e of parsed3.entries) {
  if (dv3.getUint32(e.offset, true) !== Z.SIG_LOCAL) { offsetsOk = false; }
}
ok('每个中央目录项的偏移都指向有效本地头', offsetsOk);

/* 数据体逐条比对 */
let dataOk = true;
for (const e of parsed3.entries) {
  const src = items.find(it => it.name === e.name);
  const nl = new TextEncoder().encode(e.name).length;
  const start = e.offset + 30 + nl;
  const got = Array.from(zip3.subarray(start, start + src.data.length));
  if (JSON.stringify(got) !== JSON.stringify(Array.from(src.data))) { dataOk = false; }
}
ok('三个条目的数据体字节都正确', dataOk);

/* 结束记录的总条目数 */
const endPos3 = zip3.length - 22;
eq('结束记录：总条目数 3', dv3.getUint16(endPos3 + 10, true), 3);
eq('结束记录：签名', dv3.getUint32(endPos3, true), Z.SIG_END);

/* 中央目录大小与偏移自洽 */
const cdSize3 = dv3.getUint32(endPos3 + 12, true);
const cdOffset3 = dv3.getUint32(endPos3 + 16, true);
eq('中央目录偏移 + 大小 + 22 = 总长',
  cdOffset3 + cdSize3 + 22, zip3.length);

/* ---------------- 空文件名 / 空数据边界 ---------------- */
const zipEdge = Z.build([{ name: 'empty.txt', data: new Uint8Array(0) }]);
const parsedEdge = Z.parse(zipEdge);
eq('空数据条目：size 0', parsedEdge.entries[0].size, 0);
eq('空数据条目：crc 0', parsedEdge.entries[0].crc, 0);

/* ---------------- 非法输入 ---------------- */
let threw = false;
try { Z.parse(new Uint8Array([1, 2, 3])); } catch (e) { threw = true; }
ok('非法字节抛错而非静默返回', threw);

/* build 容错：非数组当空处理 */
eq('build(null) 当空 zip', Z.build(null).length, 22);

/* ---------------- 汇总 ---------------- */
console.log('\n' + '='.repeat(60));
if (fails.length) {
  console.log('FAILED ' + fails.length + ' / ' + (pass + fails.length));
  fails.forEach((f, i) => console.log('\n  [' + (i + 1) + '] ' + f));
  process.exit(1);
}
console.log('PASS ' + pass + ' 条断言全部通过');
console.log('='.repeat(60) + '\n');
process.exit(0);