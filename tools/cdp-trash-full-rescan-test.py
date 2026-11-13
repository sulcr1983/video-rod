# 回收站「删除 → 全量扫描/自愈 → 复活」回归用例（ADR-081）
#
# 复现苏哥 2026-11-13 报的现象：
#   删到回收站 → 点「全量扫描」（或下次开库的启动自愈）→ 条目又回到主页
#
# 它覆盖三条曾各自能单独造成复活的通道：
#   A. refOnly 删除（同 sha256 还有活跃条目）：文件留在原位，全量扫描扫到 → 复活
#   B. refOnly 行被 sweep() 先按「文件在原位」判成没删 → 打回 ok
#   C. 普通删除（文件已搬进 _回收站）：全量扫描也把它改回 ok
#   D. 存量脏数据：索引已被旧版扫描改回 ok，但回收站清单与副本都在 → sweep 回打 trashed
#
# 用法：python tools/cdp-run.py tools/cdp-trash-full-rescan-test.py
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


# A/B 组：两个文件共享同一 sha256（模拟「同图多来源」），删 A 走 refOnly
REL_A = "video-rod/B站/up/视频/dup-a.mp4"
FS_A = "B站/up/视频/dup-a.mp4"
REL_B = "video-rod/X/u/视频/dup-b.mp4"
FS_B = "X/u/视频/dup-b.mp4"

# C 组：两个文件 sha256 不同，删 C 走普通搬移
REL_C = "video-rod/B站/up/视频/solo-c.mp4"
FS_C = "B站/up/视频/solo-c.mp4"
REL_D = "video-rod/X/u/图片/solo-d.png"
FS_D = "X/u/图片/solo-d.png"

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
  const fss = %s;
  for (let i = 0; i < fss.length; i++) { await put(fss[i], 'X' + i); }

  await VRIndex.setRoot(r, 'D:\\\\fake\\\\Downloads\\\\video-rod', 'video-rod');
  await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
  const now = Date.now();
  const rows = %s.map((spec, i) => ({
    relPath: spec.rel, absPath: 'D:/fake/Downloads/video-rod/' + spec.fs,
    platform: 'bilibili', platformName: 'B站',
    creatorFull: 'u(@u)', creatorId: '1',
    type: spec.fs.endsWith('.png') ? 'image' : 'video',
    fileName: spec.fs.split('/').pop(), size: 2,
    /* mtime 必须区别于「之后重新下载的同名文件」：sweep 的清单回填靠它比对 */
    mtime: now - (i + 1) * 60000,
    starred: 0, tags: [], state: 'ok',
    sha256: spec.hash
  }));
  await VRDB.putFiles(rows);
  return (await VRDB.getAllFiles()).length;
})()
"""


def setup(cdp, sid, specs):
    rows = [{"rel": s[0], "fs": s[1], "hash": s[2]} for s in specs]
    return ev(cdp, sid, SETUP % (json.dumps([s[1] for s in specs]), json.dumps(rows)))


def row_of(cdp, sid, rel):
    return ev(cdp, sid, r"""(async function(){
      const r = await VRDB.getFile(%s);
      return r ? { state: r.state, batch: r.trashBatch || '', noFile: r.trashNoFile ? 1 : 0,
                   mtime: r.mtime } : null;
    })()""" % json.dumps(rel))


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


def build(cdp, sid, mode):
    return ev(cdp, sid, r"""(async function(){
      let ok = 'ok', err = '';
      let res = null;
      try { res = await VRIndex.build({ mode: %s }); } catch (e) { ok = 'ERR'; err = e.message || e.code; }
      return { ok: ok, err: err, skippedTrashed: (res && res.skippedTrashed) || 0,
               total: (res && res.total) || 0 };
    })()""" % json.dumps(mode))


def main():
    cdp = Cdp()
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

    # ================= A：refOnly 删除（同内容仍有活跃条目）=================
    print("\n[A] refOnly：同 sha256 两条，删一条后文件仍在原位")
    n = setup(cdp, sid, [(REL_A, FS_A, "H-SAME"), (REL_B, FS_B, "H-SAME")])
    check("A0 初始 2 条索引", n, 2)

    rm = ev(cdp, sid, r"""(async function(){
      const r = await VRTrash.remove([%s]);
      const st = await VRTrash.status();
      const row = await VRDB.getFile(%s);
      return { moved: r.moved, cleaned: r.cleaned, failed: r.failed.length,
               state: row && row.state, noFile: row && row.trashNoFile ? 1 : 0,
               count: st.count };
    })()""" % (json.dumps(REL_A), json.dumps(REL_A)))
    check("A1 删除成功且标记为「只减引用」",
          [rm["moved"], rm["failed"], rm["state"], rm["noFile"], rm["count"]],
          [1, 0, "trashed", 1, 1])
    check("A2 refOnly 不搬文件（原位仍在）", file_exists(cdp, sid, FS_A), True)

    full = build(cdp, sid, "full")
    rowA = row_of(cdp, sid, REL_A)
    print("   full:", full, "rowA:", rowA)
    check("A3 全量扫描不复活 refOnly 条目", rowA["state"], "trashed")
    check("A4 全量扫描确实跳过了删除态（skippedTrashed>=1）", full["skippedTrashed"] >= 1, True)

    rec = build(cdp, sid, "reconcile")
    rowA2 = row_of(cdp, sid, REL_A)
    print("   reconcile:", rec, "rowA:", rowA2)
    check("A5 增量对账不复活 refOnly 条目", rowA2["state"], "trashed")

    sw = ev(cdp, sid, r"(async function(){ return await VRTrash.sweep(); })()")
    rowA3 = row_of(cdp, sid, REL_A)
    print("   sweep:", sw, "rowA:", rowA3)
    check("A6 启动自愈不复活 refOnly 条目", [sw["revived"], rowA3["state"]], [0, "trashed"])
    check("A7 启动自愈不误删 refOnly 条目", sw["dropped"], 0)

    # 主页视图：删掉的那条不该出现
    cdp.reload(sid)
    time.sleep(2.5)
    cards = cdp.wait_js(sid, "document.querySelectorAll('#grid .card').length", 8.0)
    check("A8 主页只剩 1 张卡（被删的不出现）", cards, 1)

    # ================= B：普通删除（文件真的搬走）=================
    print("\n[B] 普通删除：sha256 不同，文件搬进 _回收站")
    setup(cdp, sid, [(REL_C, FS_C, "H-C"), (REL_D, FS_D, "H-D")])
    rm2 = ev(cdp, sid, r"""(async function(){
      const r = await VRTrash.remove([%s]);
      const row = await VRDB.getFile(%s);
      return { moved: r.moved, failed: r.failed.length, state: row && row.state,
               noFile: row && row.trashNoFile ? 1 : 0, batch: r.batch };
    })()""" % (json.dumps(REL_C), json.dumps(REL_C)))
    check("B1 普通删除：真的搬走了（noFile=0）",
          [rm2["moved"], rm2["state"], rm2["noFile"]], [1, "trashed", 0])
    check("B2 原位置已无文件", file_exists(cdp, sid, FS_C), False)

    full2 = build(cdp, sid, "full")
    rowC = row_of(cdp, sid, REL_C)
    print("   full:", full2, "rowC:", rowC)
    check("B3 全量扫描不复活普通删除条目", rowC["state"], "trashed")
    # B4 的口径要分清：
    #   · 普通删除的文件已经搬进 _回收站，全量扫描**根本扫不到**它，
    #     所以 skippedTrashed 自然是 0 —— 这不是「没跳过」，而是「没遇到」；
    #   · 只有 refOnly 删除（文件留在原位）才会命中跳过分支，见 A4。
    # 这里验证的是「扫描结果只含磁盘上真实存在的那 1 个文件」，
    # 且没有为已删条目补出第二条索引行。
    check("B4 全量扫描结果只含磁盘现存文件（1 项），未给已删条目补行",
          [full2["total"], full2["skippedTrashed"], rowC["state"]], [1, 0, "trashed"])

    sw2 = ev(cdp, sid, r"(async function(){ return await VRTrash.sweep(); })()")
    rowC2 = row_of(cdp, sid, REL_C)
    check("B5 sweep 不复活普通删除条目", [sw2["revived"], rowC2["state"]], [0, "trashed"])
    check("B6 sweep 不误删仍在回收站的条目", sw2["dropped"], 0)

    # ================= C：存量脏数据（旧版已复活）→ 清单回填 =================
    print("\n[C] 存量脏数据：索引被改回 ok，但清单与副本都在 → sweep 回打 trashed")
    force = ev(cdp, sid, r"""(async function(){
      /* 模拟旧版扫描的后果：把已经删掉的条目改回活跃态，文件其实还在回收站里 */
      const r = await VRDB.getFile(%s);
      const next = Object.assign({}, r, { state: 'ok', trashBatch: '', trashedAt: 0 });
      await VRDB.putFiles([next]);
      return { state: (await VRDB.getFile(%s)).state };
    })()""" % (json.dumps(REL_C), json.dumps(REL_C)))
    check("C1 已构造出「复活」脏数据", force["state"], "ok")

    sw3 = ev(cdp, sid, r"(async function(){ return await VRTrash.sweep(); })()")
    rowC3 = row_of(cdp, sid, REL_C)
    print("   sweep:", sw3, "rowC:", rowC3)
    check("C2 sweep 按清单把脏数据打回 trashed",
          [sw3["requarantined"] >= 1, rowC3["state"]], [True, "trashed"])

    # 反例保护：重新下载同名同路径的新文件（mtime 变了）不该被打回
    print("\n[C3] 反例：同名文件重新落盘（mtime 变了）不得被打回")
    redo = ev(cdp, sid, r"""(async function(){
      const root = await VRTrash.resolveRoot();
      /* 用新内容覆盖原位（模拟用户重新下载了同名文件） */
      const segs = %s.split('/'); const name = segs.pop();
      let d = root.handle;
      for (const s of segs) { d = await d.getDirectoryHandle(s, { create: true }); }
      const fh = await d.getFileHandle(name, { create: true });
      const w = await fh.createWritable(); await w.write('NEW-CONTENT'); await w.close();

      const r = await VRDB.getFile(%s);
      await VRDB.putFiles([Object.assign({}, r, {
        state: 'ok', trashBatch: '', trashedAt: 0, mtime: Date.now()
      })]);
      return { state: (await VRDB.getFile(%s)).state };
    })()""" % (json.dumps(FS_C), json.dumps(REL_C), json.dumps(REL_C)))
    sw4 = ev(cdp, sid, r"(async function(){ return await VRTrash.sweep(); })()")
    rowC4 = row_of(cdp, sid, REL_C)
    print("   redo:", redo, "sweep:", sw4, "rowC:", rowC4)
    check("C3 新文件不被清单回填误伤", rowC4["state"], "ok")

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