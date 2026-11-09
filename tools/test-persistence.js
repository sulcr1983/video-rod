/**
 * 资源库持久化 —— 纯逻辑回归单测
 *
 * 为什么要先写这个：
 *   本轮的改动全部围绕「重装后不丢整理成果」，一旦出错就是**用户数据静默丢失**。
 *   而 FSA / IDB 在 Node 里跑不了，所以把真正容易写错的部分抽成纯函数，
 *   在这里逐条钉死：字段是否齐全、超限是否上报、缩略图该不该重建、路径能否自恢复。
 *
 * 覆盖（对应 docs/LIBRARY-PERSISTENCE-SPEC.md 验收项）：
 *   A1/A2  快照 payload 字段完整性 + 收藏夹
 *   A5     从快照 root 字段自恢复路径
 *   B1/B6  缩略图文件名（哈希）与失效判定（mtime+size）
 *   C3/C4  超限/超深必须上报，不能静默截断
 *
 * 跑法：node tools/test-persistence.js
 */
'use strict';

const path = require('path');

globalThis.self = globalThis;

require(path.join(__dirname, '..', 'js', 'library', 'path.js'));
require(path.join(__dirname, '..', 'js', 'library', 'indexer.js'));
require(path.join(__dirname, '..', 'js', 'library', 'thumbs.js'));

const P = globalThis.VRPath;
const I = globalThis.VRIndex;
const T = globalThis.VRThumbs;

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
async function asyncEq(name, promise, expect) {
  let got;
  try { got = await promise; } catch (e) { got = 'THREW:' + (e && e.message); }
  return eq(name, got, expect);
}

(async function run() {
  /* ============ 模块与导出存在 ============ */
  ok('VRPath 已加载', !!P);
  ok('VRIndex 已加载', !!I);
  ok('VRThumbs 已加载', !!T);

  ok('VRPath.thumbFileName 存在', typeof P.thumbFileName === 'function');
  ok('VRIndex.snapshotPayload 存在', typeof I.snapshotPayload === 'function');
  ok('VRIndex.collectTree 存在', typeof I.collectTree === 'function');
  ok('VRThumbs.shouldRefresh 存在', typeof T.shouldRefresh === 'function');

  /* ============ B1：缩略图文件名 ============ */
  const h1 = await P.thumbFileName('花瓣/小鱼(@u1)/图片/面包.jpg');
  ok('thumbFileName 返回字符串', typeof h1 === 'string', 'got ' + typeof h1);
  eq('thumbFileName 长度 16', h1.length, 16);
  ok('thumbFileName 是纯 hex', /^[0-9a-f]{16}$/.test(h1), 'got ' + h1);
  ok('thumbFileName 不含路径分隔符', h1.indexOf('/') < 0 && h1.indexOf('\\') < 0);

  // 稳定性：同一路径必须得到同一个值（否则重装后对不上文件）
  eq('thumbFileName 稳定',
    await P.thumbFileName('花瓣/小鱼(@u1)/图片/面包.jpg'), h1);

  // 区分度：不同路径不能撞
  const h2 = await P.thumbFileName('花瓣/小鱼(@u1)/图片/面包2.jpg');
  ok('thumbFileName 不同路径不同值', h1 !== h2, h1 + ' vs ' + h2);

  // 容易被误伤的字符：中文、@、#、%、空格、emoji
  const weird = 'a/b c/#1%2@x/图 片🎈.png';
  const hw = await P.thumbFileName(weird);
  ok('thumbFileName 处理特殊字符仍为 hex', /^[0-9a-f]{16}$/.test(hw), 'got ' + hw);
  eq('thumbFileName 空串不抛错', (await P.thumbFileName('')).length, 16);

  /* ============ A1：快照 payload 字段完整性 ============ */
  const sampleFiles = [{
    relPath: '花瓣/u1/图片/面包.jpg',
    size: 204800,
    mtime: 1762400000000,
    platform: 'huaban',
    creatorId: 'u1',
    type: 'image',
    fileName: '面包.jpg',
    starred: 1,
    tags: ['风景', '人像'],
    displayName: '面包（改名）',
    width: 1200,
    height: 800,
    duration: 0,
    sourceUrl: 'https://x/orig.jpg?t=1',
    mediaUrl: 'https://x/orig.jpg',
    pageUrl: 'https://huaban.com/pins/123',
    mime: 'image/jpeg',
    thumbKey: 't:花瓣/u1/图片/面包.jpg',
    thumbFile: 'a3f9c1e28b7d4f60',
    thumbSrc: { mtime: 1762400000000, size: 204800 },
    absPath: 'D:/video-rod/花瓣/u1/图片/面包.jpg',
    state: 'ok'
  }];
  const favs = [{ id: 'fav-1', name: '收藏', ids: ['花瓣/u1/图片/面包.jpg'] }];

  const payload = I.snapshotPayload(sampleFiles, favs, {
    root: 'D:/video-rod', prefix: 'video-rod'
  });

  eq('payload.schema 为 2', payload.schema, 2);
  ok('payload.version 保留', payload.version === 1, 'got ' + payload.version);
  eq('payload.count 正确', payload.count, 1);
  eq('payload.root 写入', payload.root, 'D:/video-rod');
  eq('payload.subdir 写入', payload.subdir, 'video-rod');
  ok('payload.at 是数字', typeof payload.at === 'number' && payload.at > 0);
  eq('payload.favorites 写入', payload.favorites, favs);

  const f0 = payload.files[0];
  // 原有 9 字段
  ['relPath', 'size', 'mtime', 'platform', 'creatorId', 'type', 'fileName', 'starred', 'tags']
    .forEach(function (k) { ok('快照保留原字段 ' + k, k in f0, '缺 ' + k); });
  // 本轮新增 8 字段（A1 的核心：重装后这些不能丢）
  ['displayName', 'width', 'height', 'duration', 'sourceUrl', 'mediaUrl', 'pageUrl', 'mime']
    .forEach(function (k) { ok('快照新增字段 ' + k, k in f0, '缺 ' + k); });
  eq('快照 displayName 值正确', f0.displayName, '面包（改名）');
  eq('快照 starred 值正确', f0.starred, 1);
  eq('快照 width 值正确', f0.width, 1200);
  // 缩略图引用（阶段 2）
  ok('快照带 thumbFile', 'thumbFile' in f0, '缺 thumbFile');
  ok('快照带 thumbSrc', 'thumbSrc' in f0, '缺 thumbSrc');
  eq('thumbSrc.mtime 正确', f0.thumbSrc.mtime, 1762400000000);
  eq('thumbSrc.size 正确', f0.thumbSrc.size, 204800);

  // 不该进快照的东西：体积/隐私/易变字段
  ok('快照不含 absPath（换机器会错）', !('absPath' in f0), '不该有 absPath');
  ok('快照不含 downloadId（换机器无效）', !('downloadId' in f0));
  ok('快照不含 state（扫描时重算）', !('state' in f0));

  // 缺省值不写 null/0 之外的噪音：空对象不应崩
  const p2 = I.snapshotPayload([{ relPath: 'a.jpg' }], [], {});
  eq('极简条目 count=1', p2.count, 1);
  eq('极简条目 relPath 保留', p2.files[0].relPath, 'a.jpg');
  eq('极简条目 starred 归一为 0', p2.files[0].starred, 0);
  eq('极简条目 tags 归一为空数组', p2.files[0].tags, []);
  eq('无 favorites 时为空数组', p2.favorites, []);
  ok('无 root 时不写 undefined 噪音', p2.root === '' || p2.root === null || !('root' in p2));

  /* ============ A5：从快照 root 自恢复路径 ============ */
  const r1 = I.absRootFromSnapshot(
    { root: 'D:/video-rod', subdir: 'video-rod' }, { mode: 'system', detectedRoot: '' });
  ok('空设置时用快照 root 恢复', r1 === 'D:/video-rod', 'got ' + r1);

  const r2 = I.absRootFromSnapshot(
    { root: 'D:/video-rod' }, { mode: 'system', detectedRoot: 'E:/Downloads' });
  ok('设置有时以设置为准', r2 === 'E:/Downloads/video-rod', 'got ' + r2);

  const r3 = I.absRootFromSnapshot({}, { mode: 'system', detectedRoot: '' });
  eq('快照无 root 且设置空时返回空', r3, '');

  // 自定义目录模式：快照 root 不应覆盖 customRoot 的语义
  const r4 = I.absRootFromSnapshot(
    { root: 'D:/video-rod' }, { mode: 'custom', customRoot: 'F:/Media' });
  ok('custom 模式用 customRoot', r4 === 'F:/Media', 'got ' + r4);

  /* ============ C3/C4：超限必须上报 ============ */
  eq('LIMITS.MAX_ITEMS 提高', I.LIMITS.MAX_ITEMS, 100000);
  ok('MAX_DEPTH 保留合理值', I.LIMITS.MAX_DEPTH >= 8 && I.LIMITS.MAX_DEPTH <= 32,
    'got ' + I.LIMITS.MAX_DEPTH);

  // 构造假目录：3 个文件
  function mockDir(entries) {
    return {
      entries: async function* () {
        for (const [name, child] of Object.entries(entries)) { yield [name, child]; }
      }
    };
  }
  function fileNode() { return { kind: 'file' }; }

  const smallTree = mockDir({ 'a.jpg': fileNode(), 'b.mp4': fileNode(), 'c.gif': fileNode() });
  const small = await I.collectTree(smallTree, { maxItems: 100, maxDepth: 8 });
  eq('collectTree 收到 3 个文件', small.items.length, 3);
  ok('collectTree 未截断时 truncated=false', small.truncated === false);
  ok('collectTree 记录 scanned 数', small.scanned === 3, 'got ' + small.scanned);

  // 超限：5 个文件，上限 3 → 必须 truncated 且带原因
  const bigTree = mockDir({
    'a.jpg': fileNode(), 'b.jpg': fileNode(), 'c.jpg': fileNode(),
    'd.jpg': fileNode(), 'e.jpg': fileNode()
  });
  const big = await I.collectTree(bigTree, { maxItems: 3, maxDepth: 8 });
  ok('超限时 truncated=true', big.truncated === true, 'got ' + big.truncated);
  ok('超限时不返回超过上限的条目', big.items.length <= 3, 'got ' + big.items.length);
  eq('超限原因码', big.truncatedReason, 'LIB_E_TRUNCATED');
  ok('超限时记录被跳过的数量', typeof big.skipped === 'number' && big.skipped > 0,
    'got ' + big.skipped);

  // 超深：嵌套 10 层，上限 2 → 必须上报 depth
  let deep = mockDir({ 'leaf.jpg': fileNode() });
  for (let i = 0; i < 10; i++) { deep = mockDir({ ['d' + i]: deep }); }
  const deepRes = await I.collectTree(deep, { maxItems: 1000, maxDepth: 2 });
  ok('超深时标记 depth 截断', deepRes.depthLimited === true, 'got ' + deepRes.depthLimited);
  eq('超深原因码', deepRes.depthReason, 'LIB_E_DEPTH');

  // 正常：不影响原有行为
  ok('未超限时 depthLimited=false', small.depthLimited === false);

  /* ============ B6：缩略图失效判定（mtime + size 双校验） ============ */
  const entry = { relPath: 'x/a.jpg', size: 100, mtime: 1000 };

  ok('无记录时需生成',
    T.shouldRefresh(entry, null) === true);

  ok('mtime+size 都一致时不重建',
    T.shouldRefresh(entry, { mtime: 1000, size: 100, ver: T.THUMB_VER }) === false);

  ok('生成器版本不一致要重建（老图升级）',
    T.shouldRefresh(entry, { mtime: 1000, size: 100, ver: (T.THUMB_VER || 2) - 1 }) === true);

  ok('老数据没有 ver 字段 → 重建',
    T.shouldRefresh(entry, { mtime: 1000, size: 100 }) === true);

  ok('mtime 变了要重建',
    T.shouldRefresh(entry, { mtime: 2000, size: 100, ver: T.THUMB_VER }) === true);

  ok('size 变了要重建（同 mtime 也能发现）',
    T.shouldRefresh(entry, { mtime: 1000, size: 200, ver: T.THUMB_VER }) === true);

  // 关键：文件被替换后 mtime 可能**变小**，只比大小会漏判
  ok('mtime 变小也要重建',
    T.shouldRefresh(entry, { mtime: 500, size: 100 }) === true);

  ok('两者都变要重建',
    T.shouldRefresh(entry, { mtime: 2000, size: 200 }) === true);

  // 缺字段时保守：重建（宁可多生成一次，也不要显示错图）
  ok('记录缺 mtime 时保守重建',
    T.shouldRefresh(entry, { size: 100 }) === true);
  ok('记录缺 size 时保守重建',
    T.shouldRefresh(entry, { mtime: 1000 }) === true);

  /* ============ 汇总 ============ */
  console.log('\n' + '='.repeat(60));
  if (fails.length) {
    console.log('FAILED ' + fails.length + ' / ' + (pass + fails.length));
    fails.forEach(function (f, i) { console.log('\n  [' + (i + 1) + '] ' + f); });
    process.exit(1);
  }
  console.log('PASS ' + pass + ' 条断言全部通过');
  console.log('='.repeat(60) + '\n');
  process.exit(0);
})();