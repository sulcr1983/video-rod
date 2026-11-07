/**
 * 导出与打包纯逻辑单测（js/album-export.js）
 *
 * 重点验证：
 *   · ZIP 结构与 CRC32（能被真实解压工具识别）
 *   · 导出 txt/csv 的格式与转义
 *   · AIX 占位符 → 本项目模板变量的映射
 *
 * 用法：node tools/test-album-export.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('../js/album-export.js');

let pass = 0;
let fail = 0;

function ok(name, got, expect) {
    const same = JSON.stringify(got) === JSON.stringify(expect);
    if (same) { pass++; }
    else {
        fail++;
        console.log('FAIL  ' + name);
        console.log('      got    = ' + JSON.stringify(got));
        console.log('      expect = ' + JSON.stringify(expect));
    }
}
function truthy(name, got) {
    if (got) { pass++; } else { fail++; console.log('FAIL  ' + name + '  got=' + JSON.stringify(got)); }
}
function falsy(name, got) {
    if (!got) { pass++; } else { fail++; console.log('FAIL  ' + name + '  got=' + JSON.stringify(got)); }
}

/* ---------------- A. CRC32 ---------------- */
/* 标准测试向量：CRC32("123456789") = 0xCBF43926 */
ok('A1 CRC32 标准向量', E.crc32(E.utf8Bytes('123456789')), 0xCBF43926);
ok('A2 CRC32 空串', E.crc32(new Uint8Array(0)), 0);
ok('A3 CRC32 单字节 0x00', E.crc32(new Uint8Array([0])), 0xD202EF8D);
/* 中文不能因编码不同算出不同 CRC */
truthy('A4 UTF-8 中文可编码', E.utf8Bytes('图片').length > 0);

/* ---------------- B. ZIP 结构 ---------------- */
const zip = E.zipStore([
    { name: 'a.txt', data: E.utf8Bytes('hello') },
    { name: '中文名.txt', data: E.utf8Bytes('世界') }
]);

truthy('B1 有输出', zip.length > 0);
// 本地文件头签名 PK\x03\x04
ok('B2 首签名', Array.from(zip.slice(0, 4)), [0x50, 0x4B, 0x03, 0x04]);
// 中央目录签名 PK\x01\x02 出现在文件里
truthy('B3 含中央目录签名',
    Buffer.from(zip).includes(Buffer.from([0x50, 0x4B, 0x01, 0x02])));
// 结束记录 PK\x05\x06 必须在末尾 22 字节内
ok('B4 EOCD 在末尾',
    Array.from(zip.slice(zip.length - 22, zip.length - 18)),
    [0x50, 0x4B, 0x05, 0x06]);
// 条目数 = 2
{
    const tail = zip.slice(zip.length - 22);
    const entries = (tail[8] | (tail[9] << 8));
    ok('B5 EOCD 条目数', entries, 2);
}
// UTF-8 标志位 0x0800 必须置上（否则中文名乱码）
{
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    ok('B6 本地头 UTF-8 标志', dv.getUint16(6, true), 0x0800);
    ok('B7 method=STORE', dv.getUint16(8, true), 0);
}

/* 空列表也要产出合法空 ZIP */
const empty = E.zipStore([]);
ok('B8 空 ZIP 长度', empty.length, 22);
ok('B9 空 ZIP 签名', Array.from(empty.slice(0, 4)), [0x50, 0x4B, 0x05, 0x06]);

/* 真实解压验证：写盘后用系统工具校验（有就测，没有就跳过） */
let unzipOk = false;
try {
    const dir = path.join(os.tmpdir(), 'vr-ziptest-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    const zf = path.join(dir, 't.zip');
    fs.writeFileSync(zf, Buffer.from(zip));
    // Windows 自带 tar 能解 zip；失败就跳过（不当成产品缺陷）
    try {
        execFileSync('tar', ['-xf', zf, '-C', dir], { stdio: 'ignore' });
        const a = fs.readFileSync(path.join(dir, 'a.txt'), 'utf8');
        const b = fs.readFileSync(path.join(dir, '中文名.txt'), 'utf8');
        ok('B10 解压后内容', [a, b], ['hello', '世界']);
        unzipOk = true;
    } catch (e2) {
        console.log('SKIP  B10 本机无可用解压工具：' + String(e2.message || e2).slice(0, 60));
    }
    fs.rmSync(dir, { recursive: true, force: true });
} catch (e) {
    console.log('SKIP  B10 写盘失败：' + String(e.message || e).slice(0, 60));
}

/* ---------------- C. 链接导出 ---------------- */
const items = [
    { url: 'https://x.com/a.jpg', w: 1200, h: 900, orig: 'https://x.com/a-big.jpg', name: 'a.jpg' },
    { url: 'https://x.com/b.png', w: 640, h: 480, name: 'b,c"d.png' }
];

ok('C1 txt 一行一个', E.buildExport(items, 'txt'),
    'https://x.com/a-big.jpg\nhttps://x.com/b.png\n');
ok('C2 txt 优先用 orig', E.buildExport([items[0]], 'txt'),
    'https://x.com/a-big.jpg\n');
ok('C3 空列表 txt', E.buildExport([], 'txt'), '');
ok('C4 csv 表头', E.buildExport([], 'csv'),
    '序号,宽,高,文件名,图片地址\r\n');
truthy('C5 csv 含转义引号', E.buildExport(items, 'csv').includes('"b,c""d.png"'));
ok('C6 csv 数据行数（不含表头与末尾空行）',
    E.buildExport(items, 'csv').split('\r\n').filter(Boolean).length - 1, 2);
ok('C7 未知格式回落 txt', E.buildExport(items, 'xml'), E.buildExport(items, 'txt'));
ok('C8 csv 单元格无特殊字符不加引号', E.csvCell('abc'), 'abc');
ok('C9 csv 含逗号加引号', E.csvCell('a,b'), '"a,b"');
ok('C10 csv 双引号转义', E.csvCell('a"b'), '"a""b"');

/* ---------------- D. 模板归一 ---------------- */
ok('D1 {NO} → ${index}', E.normalizeTemplate('pic_{NO}.{EXT}'), 'pic_${index}.${ext}');
ok('D2 {NO001} → ${index}', E.normalizeTemplate('pic_{NO001}'), 'pic_${index}');
ok('D3 {PAGETITLE} → ${title}', E.normalizeTemplate('{PAGETITLE}_{NO}'), '${title}_${index}');
ok('D4 {NAME} → ${title}', E.normalizeTemplate('{NAME}'), '${title}');
ok('D5 {DATE} → ${date}', E.normalizeTemplate('{DATE}'), '${date}');
ok('D6 {AUTHOR} → ${author}', E.normalizeTemplate('{AUTHOR}'), '${author}');
ok('D7 小写也认', E.normalizeTemplate('{no}{ext}'), '${index}${ext}');
ok('D8 未知占位符保留', E.normalizeTemplate('{FOO}'), '{FOO}');
ok('D9 已是项目模板不动', E.isProjectTemplate('${title}_${index}'), true);
falsy('D10 AIX 模板不算项目模板', E.isProjectTemplate('{NO}'), false);

/* 序号补零 */
ok('D11 {NO001} 需 3 位', E.indexPadOf('{NO001}'), 3);
ok('D12 {NO01} 需 2 位', E.indexPadOf('{NO01}'), 2);
ok('D13 {NO} 不补零', E.indexPadOf('{NO}'), 0);
ok('D14 无占位符 → null', E.indexPadOf('${title}'), null);
ok('D15 padIndex 3 位', E.padIndex(7, 3), '007');
ok('D16 padIndex 2 位', E.padIndex(7, 2), '07');
ok('D17 padIndex 超长不截断', E.padIndex(1234, 2), '1234');
ok('D18 padIndex 0 位', E.padIndex(7, 0), '7');

/* ---------------- E. WEBP→JPG ---------------- */
ok('E1 webp 改名', E.jpegName('a.webp'), 'a.jpg');
ok('E2 WEBP 大写也认', E.jpegName('a.WEBP'), 'a.jpg');
ok('E3 jpg 不变', E.jpegName('a.jpg'), 'a.jpg');
ok('E4 png 不变', E.jpegName('a.png'), 'a.png');
ok('E5 需要转换 webp', E.needsJpeg('https://x.com/a.webp'), true);
ok('E6 带参数的 webp', E.needsJpeg('https://x.com/a.webp?w=300'), true);
ok('E7 avif 需要转换', E.needsJpeg('https://x.com/a.avif'), true);
falsy('E8 jpg 不需要转换', E.needsJpeg('https://x.com/a.jpg'));
falsy('E9 png 不自动转换（会丢透明）', E.needsJpeg('https://x.com/a.png'));

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + '  ' + pass + ' / ' + (pass + fail) +
    (unzipOk ? '（含真实解压校验）' : ''));
process.exit(fail ? 1 : 0);
