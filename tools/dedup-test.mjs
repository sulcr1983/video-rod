/* F5 内容去重引用制单元测试（Node，无浏览器依赖）
跑法：node tools/dedup-test.mjs */
import { readFileSync } from 'fs';
import { webcrypto } from 'crypto';
import vm from 'vm';

const src = readFileSync('js/library/dedup.js', 'utf8');

// ---- 造一个假的 VRDB + VRPath + VRSave ----
const files = new Map();          // relPath -> entry
const deletedRel = [];            // 被 VRSave.removeFile 删掉的相对路径
const disk = new Set();           // 模拟磁盘上真实存在的文件（relPath）

/* 2026-11-18 修正：
 *   旧实现用 fetch(file://, {method:'DELETE'}) 删文件，测试桩把它模拟成「成功」——
 *   但真实浏览器里它返回 ok 却根本不删（save.js:794 实证）。
 *   现在 dedup.removePhysical 改走 VRSave.removeFile（FSA 句柄 + 复核），
 *   所以桩要模拟「真实删除」：从 disk 里移除，返回是否确认不存在。 */
const root = {
  crypto: webcrypto,
  fetch: async (url, opts) => {
    // GET: 返回内容（hashFile 用）
    return { ok: true, arrayBuffer: async () => CONTENT.buffer.slice(CONTENT.byteOffset, CONTENT.byteOffset + CONTENT.byteLength) };
  },
  VRPath: {
    toFileUrl: (p) => 'file:///' + String(p).replace(/\\/g, '/'),
  },
  /* 假 VRSave：真删（有则删、无则 NotFound），与浏览器端语义一致 */
  VRSave: {
    removeFile: async (relPath) => {
      if (!relPath) { return false; }
      if (!disk.has(relPath)) { return true; }   // 已经不在 =「确认不存在」
      disk.delete(relPath);
      deletedRel.push(relPath);
      return true;
    },
  },
  VRDB: {
    getAllFiles: async () => Array.from(files.values()),
    getFile: async (rel) => files.get(rel) || null,
    putFiles: async (list) => { list.forEach(e => files.set(e.relPath, e)); return list.length; },
    deleteFiles: async (rels) => { rels.forEach(r => files.delete(r)); return rels.length; },
    patchFile: async (rel, patch) => {
      const cur = files.get(rel);
      if (!cur) return null;
      const next = Object.assign({}, cur, patch);
      files.set(rel, next);
      return next;
    },
  },
};

const ctx = { self: root, window: root, fetch: root.fetch, crypto: webcrypto, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const D = root.VRDedup;

// ---- 用例 ----
const CONTENT = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const results = [];
function check(name, got, expect) {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  results.push(ok);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : `   got=${JSON.stringify(got)} expect=${JSON.stringify(expect)}`));
}
async function t(name, fn, expect) {
  try { check(name, await fn(), expect); }
  catch (e) { results.push(false); console.log('FAIL  ' + name + '   threw: ' + e.message); }
}

(async () => {
  // 1. 指纹计算正确性：同内容同指纹，不同内容不同指纹
  const h1 = await D.hashFile('D:/a.bin');
  const h2 = await D.hashFile('D:/b.bin');
  await t('同内容同指纹', async () => h1 === h2, true);
  await t('指纹是 64 位 hex', async () => /^[0-9a-f]{64}$/.test(h1), true);

  // 2. 首次下载：正常入库，记指纹
  files.clear(); deletedRel.length = 0; disk.clear();
  const info1 = { relPath: 'video-rod/X/A/视频/a.mp4', absPath: 'D:/x/a.mp4', size: 100 };
  disk.add(info1.relPath);                 // 模拟：这个文件真的落盘了
  const r1 = await D.afterDownload({ relPath: info1.relPath, absPath: info1.absPath, info: info1 });
  await t('首次不判重', async () => r1.deduped, false);
  await t('首次写入 sha256', async () => !!r1.info.sha256, true);
  await t('首次 isRef=0', async () => r1.info.isRef, 0);

  // 3. 第二次下同样内容（不同路径）：判重成功，只写引用
  files.clear();
  disk.clear();
  deletedRel.length = 0;
  // 模拟真实调用链：判重 → 入库（sw-library.js 的 writeOne 就是这个顺序）
  const i1 = { relPath: 'video-rod/X/A/视频/a.mp4', absPath: 'D:/x/a.mp4', size: 100 };
  disk.add(i1.relPath);
  const rr1 = await D.afterDownload({ relPath: i1.relPath, absPath: i1.absPath, info: i1 });
  await root.VRDB.putFiles([Object.assign({}, i1, rr1.info)]);
  const info2 = { relPath: 'video-rod/Y/B/视频/b.mp4', absPath: 'D:/y/b.mp4', size: 100 };
  disk.add(info2.relPath);
  const r2 = await D.afterDownload({ relPath: info2.relPath, absPath: info2.absPath, info: info2 });
  await root.VRDB.putFiles([Object.assign({}, info2, r2.info)]);
  await t('重复内容判重命中', async () => r2.deduped, true);
  await t('重复标记 isRef=1', async () => r2.info.isRef, 1);
  await t('重复记录 refOf 指向原件', async () => r2.info.refOf, 'video-rod/X/A/视频/a.mp4');
  /* 2026-11-18 修正断言：改为验证「真的从磁盘消失」，
   * 而不是旧实现那种「fetch DELETE 返回 ok 就算删了」（假删除）。 */
  await t('重复时删掉刚落盘的物理件', async () => deletedRel.length, 1);
  await t('重复件确实不在磁盘上', async () => disk.has(info2.relPath), false);
  await t('原件仍在磁盘上（未被误删）', async () => disk.has(i1.relPath), true);

  // 4. 引用计数
  await t('引用计数=2', async () => await D.refCount(r2.info.sha256), 2);

  // 5. R1 删除只减引用：还有别的引用时不删物理文件
  const all = await root.VRDB.getAllFiles();
  const one = all.find(e => e.isRef);
  const delRes = await D.onDelete(one);
  await t('删引用后剩余 1 条', async () => delRes.refCount, 1);
  await t('还有引用时不删物理文件', async () => delRes.physicalDeleted, false);

  // 6. R1 最后一条引用：把库里两条（原件 + 引用）都清掉后，
  //    再删引用条目 → 引用数归零 → 真删原件物理文件（原件路径从 refOf 找）
  const originEntry = { relPath: one.relPath, sha256: one.sha256, absPath: one.absPath, refOf: one.refOf };
  await root.VRDB.deleteFiles(['video-rod/X/A/视频/a.mp4', one.relPath]);
  /* 2026-11-18：真删要能验证「磁盘上确实没了」。
   * 原件 relPath 是 refOf 指向的那条，先在 disk 里登记，删后再查。 */
  disk.add(one.refOf);
  const delRes2 = await D.onDelete(originEntry);
  await t('最后一条引用：剩余 0', async () => delRes2.refCount, 0);
  await t('最后一条引用：物理文件可被真删', async () => delRes2.physicalDeleted, true);
  await t('最后一条引用：原件确实从磁盘消失', async () => disk.has(one.refOf), false);

  // 7. R2 重命名只改显示名
  files.clear();
  const ia = { relPath: 'a.mp4', absPath: 'D:/a.mp4' };
  const ra = await D.afterDownload({ relPath: 'a.mp4', absPath: 'D:/a.mp4', info: ia });
  await root.VRDB.putFiles([Object.assign({}, ia, ra.info)]);
  const ib = { relPath: 'b.mp4', absPath: 'D:/b.mp4' };
  const r3 = await D.afterDownload({ relPath: 'b.mp4', absPath: 'D:/b.mp4', info: ib });
  await root.VRDB.putFiles([Object.assign({}, ib, r3.info)]);
  const renamed = await D.renameDisplay('b.mp4', '我的新名字');
  await t('重命名写 displayName', async () => renamed, true);
  await t('displayName 落库', async () => (await root.VRDB.getFile('b.mp4')).displayName, '我的新名字');

  // 8. 统计口径：逻辑 vs 物理
  const st = await D.stats();
  await t('统计 count=2', async () => st.count, 2);
  await t('统计 uniqCount=1', async () => st.uniqCount, 1);
  await t('物理占用只算一份（非逻辑大小）', async () => st.physicalBytes, st.logicalBytes / 2);

  // 9. 异常不外泄：hashFile 传垃圾输入
  await t('垃圾输入返回空串而非抛错', async () => await D.hashFile(null), '');
  await t('垃圾输入 afterDownload 不抛', async () => {
    const r = await D.afterDownload({ relPath: '', absPath: '', info: {} });
    return r && r.ok === true;
  }, true);

  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} PASS`);
  process.exit(ok === results.length ? 0 : 1);
})();
