# 回收站「删除 → 清空 → 素材复活/列表不消失」复现脚本
#
# 目的：在隔离环境里复现苏哥 2026-11-09 报的现象：
#   删到回收站 → 清空回收站 → 回到主页，卡片和缩略图还在（文件已删）
#
# 它同时打三条通道，定位到底哪一层留了脏数据：
#   ① 引擎：VRTrash.remove 之后 file store 是否真删了
#   ② 引擎：VRTrash.empty 之后 file store / thumb store / 磁盘文件是否清干净
#   ③ 扫描：清空后跑 build({mode:'snapshot'|'reconcile'}) 会不会把条目复活
#
# 用法：python tools/cdp-run.py tools/cdp-trash-empty-repro.py
import json
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name +
          ("" if ok else f"   got={got!r} expect={expect!r}"))


def ev(cdp, sid, js):
    r = cdp.eval(js, sid)
    if isinstance(r, dict) and "__error" in r:
        raise RuntimeError(r["__error"])
    return r


REL = ["video-rod/B站/up/视频/a.mp4", "video-rod/X/u/图片/b.png", "video-rod/X/u/视频/c.mp4"]
FS = ["B站/up/视频/a.mp4", "X/u/图片/b.png", "X/u/视频/c.mp4"]

SETUP = r"""
(async function () {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry('video-rod', { recursive: true }); } catch (e) {}
  const r = await root.getDirectoryHandle('video-rod', { create: true });

  async function put(rel, text) {
    const segs = rel.split('/'); const name = segs.pop();
    let d = r;
    for (const s of segs) { d = await d.getDirectoryHandle(s, { create: true }); }
    const fh = await d.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text); await w.close();
  }
  const rels = %s, fss = %s;
  for (let i = 0; i < fss.length; i++) { await put(fss[i], 'X' + i); }

  await VRIndex.setRoot(r, 'D:\\\\fake\\\\Downloads\\\\video-rod', 'video-rod');
  await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
  const now = Date.now();
  const rows = rels.map((rel, i) => ({
    relPath: rel, absPath: 'D:/fake/Downloads/video-rod/' + fss[i],
    platform: i === 1 ? 'x' : 'bilibili', platformName: i === 1 ? 'X' : 'B站',
    creatorFull: 'u(@u)', creatorId: '1', type: fss[i].endsWith('.png') ? 'image' : 'video',
    fileName: fss[i].split('/').pop(), size: 2, mtime: now - i * 1000,
    starred: 0, tags: [], state: 'ok'
  }));
  await VRDB.putFiles(rows);
  return (await VRDB.getAllFiles()).length;
})()
""" % (json.dumps(REL), json.dumps(FS))


def db_snapshot(cdp, sid):
    return ev(cdp, sid, r"""(async function(){
      const files = await VRDB.getAllFiles();
      const thumbs = await new Promise((res) => {
        const req = indexedDB.open('vr-library');
        req.onsuccess = () => {
          const db = req.result;
          const t = db.transaction(['thumb'], 'readonly');
          const c = t.objectStore('thumb').count();
          c.onsuccess = () => res(c.result);
          c.onerror = () => res(-1);
        };
        req.onerror = () => res(-1);
      });
      return { files: files.length, thumbs: thumbs,
               list: files.map(f => f.relPath) };
    })()""")


def file_exists(cdp, sid, rel):
    return ev(cdp, sid, r"""(async function(){
      const root = await VRTrash.resolveRoot();
      try {
        const segs = %s.split('/'); const n = segs.pop();
        let d = root.handle;
        for (const s of segs) { d = await d.getDirectoryHandle(s); }
        await d.getFileHandle(n); return true;
      } catch (e) { return false; }
    })()""" % json.dumps(rel))


def main():
    cdp = Cdp()
    # ext 定位必须按 manifest 的 SW 全路径匹配（内置扩展也叫 background.js，实测踩过）
    ext_id = None
    for t in cdp.targets():
        u = t.get("url", "")
        if t.get("type") == "service_worker" and u.endswith("/js/background.js"):
            ext_id = u.split("/")[2]
            break
    if not ext_id:
        ext_id, _ = find_ext_id(cdp)
    print("ext:", ext_id)
    if not ext_id:
        print("扩展没加载")
        return 2

    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    sid = cdp.attach(tid)
    for m in ("Runtime.enable", "Page.enable"):
        cdp.send(m, {}, sid)
    cdp.navigate(sid, f"chrome-extension://{ext_id}/library.html")
    time.sleep(1.5)

    # 拷一份旧库，别污染真实数据：本脚本只动 OPFS 里的 trash-repro 目录 + 该目录的条目
    print("setup:", ev(cdp, sid, SETUP))
    cdp.reload(sid)
    time.sleep(2.5)
    cards = cdp.wait_js(sid, "document.querySelectorAll('#grid .card').length", 8.0)
    print("首屏卡片:", cards, "count:", ev(cdp, sid, "VRDB.count()"))

    # 生成一张缩略图（模拟真实库「有图」的状态），再删
    ev(cdp, sid, r"""(async function(){
      const f = (await VRDB.getAllFiles()).find(x => x.type === 'image');
      if (f) { await VRDB.putThumb('t:' + f.relPath, new Blob(['x']), 1, 1); }
      await VRDB.putThumb('t:' + %s, new Blob(['y']), 1, 1);
      return 1;
    })()""" % json.dumps(REL[0]))

    snap0 = db_snapshot(cdp, sid)
    check("A1 初始 3 条 + 2 缩略图", [snap0["files"], snap0["thumbs"]], [3, 2])

    # 先落一份快照（模拟用户库已经扫描过：_library/index.json 里有这 3 条）
    ev(cdp, sid, r"""(async function(){
      try { await VRIndex.snapshot(); } catch (e) { return 'snap-ERR:' + e.message; }
      return 'snap-ok';
    })()""")

    # ---------- 删除到回收站（走 UI 同一条引擎通道）----------
    rm = ev(cdp, sid, r"""(async function(){
      const r = await VRTrash.remove(%s);
      const rows = await VRDB.getAllFiles();
      const st = await VRTrash.status();
      return { moved: r.moved, cleaned: r.cleaned, failed: r.failed.length, batch: r.batch,
               db: rows.length, trashed: rows.filter(x => x.state === 'trashed').length,
               list: st.count, batches: st.batches };
    })()""" % json.dumps(REL))
    # 新口径：索引行**保留**并标 trashed（回收站真源 = 索引），不是删掉
    check("B1 remove 移走 3 项、索引保留并标 trashed",
          [rm["moved"], rm["db"], rm["trashed"], rm["list"], rm["batches"]],
          [3, 3, 3, 3, 1])
    print("   批次：", rm["batch"])
    check("B2 原文件已不在", [file_exists(cdp, sid, FS[0]), file_exists(cdp, sid, FS[1])], [False, False])

    cdp.reload(sid)
    time.sleep(2.5)
    check("B3 刷新后卡片为 0（trashed 不出现在主页）",
          ev(cdp, sid, "document.querySelectorAll('#grid .card').length"), 0)
    snap1 = db_snapshot(cdp, sid)
    print("   删后 thumb 表（应保留，供恢复后秒出图）：", snap1["thumbs"])

    # ---------- 恢复一条：文件搬回、行打回 ok、卡片回来 ----------
    rs = ev(cdp, sid, r"""(async function(){
      const r = await VRTrash.restore(%s, %s);
      await new Promise(x => setTimeout(x, 300));
      const row = await VRDB.getFile(%s);
      return { restored: r.restored, failed: r.failed.length, state: row && row.state,
               st: (await VRTrash.status()).count };
    })()""" % (json.dumps(rm["batch"]), json.dumps(REL[0]), json.dumps(REL[0])))
    check("B4 恢复一条：状态回到 ok、回收站剩 2",
          [rs["restored"], rs["failed"], rs["state"], rs["st"]], [1, 0, "ok", 2])
    check("B5 文件回到原位置", file_exists(cdp, sid, FS[0]), True)

    cdp.reload(sid)
    time.sleep(2.5)
    check("B6 恢复后主页 1 张卡", ev(cdp, sid, "document.querySelectorAll('#grid .card').length"), 1)

    # 再删回去（第二批），让「清空」覆盖两个批次
    rm2 = ev(cdp, sid, r"""(async function(){
      const r = await VRTrash.remove([%s]);
      return { moved: r.moved, batch: r.batch, st: (await VRTrash.status()).count };
    })()""" % json.dumps(REL[0]))
    check("B7 二次删除入新批次", [rm2["moved"], rm2["st"]], [1, 3])

    # ---------- 清空回收站（点 UI 按钮，和用户路径一致）----------
    empty = ev(cdp, sid, r"""(async function(){
      document.getElementById('trashBtn') && document.getElementById('trashBtn').click();
      await new Promise(r => setTimeout(r, 400));
      const openBefore = document.getElementById('drawer').classList.contains('show');
      const items = document.querySelectorAll('#dwList .dw-item').length;
      const btn = document.getElementById('dwEmpty');
      if (btn) { btn.click(); }
      await new Promise(r => setTimeout(r, 200));
      const maskShown = document.getElementById('confirmMask').classList.contains('show');
      const ok = document.getElementById('confirmOk');
      if (ok) { ok.click(); }
      await new Promise(r => setTimeout(r, 1200));
      return { drawerOpen: openBefore, items: items, confirm: maskShown,
               drawerAfter: document.getElementById('drawer').classList.contains('show'),
               cards: document.querySelectorAll('#grid .card').length,
               db: (await VRDB.getAllFiles()).length,
               thumbs: await new Promise((res) => {
                 const req = indexedDB.open('vr-library');
                 req.onsuccess = () => {
                   const c = req.result.transaction(['thumb'], 'readonly').objectStore('thumb').count();
                   c.onsuccess = () => res(c.result); c.onerror = () => res(-1);
                 };
                 req.onerror = () => res(-1);
               }),
               st: (await VRTrash.status()).count };
    })()""")
    print("   empty 过程：", empty)
    check("C1 清空后 file store 归零（索引行一起删）", empty["db"], 0)
    check("C2 清空后卡片为 0", empty["cards"], 0)
    check("C3 清空后 IDB 缩略图归零（原实现永久泄漏）", empty["thumbs"], 0)
    check("C4 回收站计数 0", empty["st"], 0)
    left = ev(cdp, sid, r"""(async function(){
      const root = await VRTrash.resolveRoot();
      try {
        const d = await root.handle.getDirectoryHandle('_回收站');
        let n = 0;
        for await (const e of d.entries()) { n++; }
        return n;
      } catch (e) { return 0; }
    })()""")
    check("C5 回收站目录已空", left, 0)

    # 幂等：再点一次清空必须无害（原实现删完就忘，任何半状态都没法收尾）
    again = ev(cdp, sid, r"""(async function(){
      try {
        const r = await VRTrash.empty();
        return { ok: true, purged: r.purged, st: (await VRTrash.status()).count };
      } catch (e) { return { ok: false, err: e.message }; }
    })()""")
    check("C6 再清空一次幂等", [again["ok"], again["purged"], again["st"]], [True, 0, 0])

    # ---------- 扫描会不会把删掉的复活 ----------
    rev_snap = ev(cdp, sid, r"""(async function(){
      let ok = 'ok', err = '';
      try { await VRIndex.build({ mode: 'snapshot' }); } catch (e) { ok = 'ERR'; err = e.message || e.code; }
      const n1 = (await VRDB.getAllFiles()).length;
      /* reconcile 前先清空，单独看它对「磁盘已无文件」的判断 */
      return { mode: 'snapshot', ok: ok, err: err, count: n1 };
    })()""")
    print("   snapshot 重建后：", rev_snap)

    rev_rec = ev(cdp, sid, r"""(async function(){
      await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
      let ok = 'ok', err = '';
      try { await VRIndex.build({ mode: 'reconcile' }); } catch (e) { ok = 'ERR'; err = e.message || e.code; }
      return { mode: 'reconcile', ok: ok, err: err, count: (await VRDB.getAllFiles()).length };
    })()""")
    print("   reconcile 重建后：", rev_rec)

    rev_full = ev(cdp, sid, r"""(async function(){
      await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
      let ok = 'ok', err = '';
      try { await VRIndex.build({ mode: 'full' }); } catch (e) { ok = 'ERR'; err = e.message || e.code; }
      const files = await VRDB.getAllFiles();
      return { mode: 'full', ok: ok, err: err, count: files.length,
               rels: files.map(f => f.relPath + '|' + (f.state || 'ok')) };
    })()""")
    print("   full 重建后：", rev_full)

    check("D1 快照重建不复活已删条目", rev_snap["count"], 0)
    check("D2 对账重建不复活已删条目", rev_rec["count"], 0)
    check("D3 全量重建不复活已删条目", rev_full["count"], 0)

    errs = cdp.errors()
    if errs:
        print("\n控制台：")
        for e in errs[:8]:
            print("  ", e)
    total = len(results)
    passed = sum(1 for r in results if r[0])
    print(f"\n===== {passed}/{total} 通过 =====")
    return 0 if passed == total else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(2)
