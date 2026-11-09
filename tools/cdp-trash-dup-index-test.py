# 回归：同一物理文件两条索引（有/无 video-rod 前缀）→ 删除 → 清空 → 不许留死卡
# 背景：真实库里有 18 条 relPath 没有 video-rod 前缀的存量记录（QA 审计记过），
#      它们和带前缀的新条目指向同一个物理文件，是「文件没了、卡片还在」的源头。
#
# 覆盖两条防线：
#   ① 启动自愈 VRTrash.sweep()：两条都在时按前缀归并，只留规范那条；
#   ② 清空时 dropGhostRows()：删除/清空之后，指向同一已消失文件的无前缀残行一起清掉。
import sys, os, time, json

sys.path.insert(0, 'tools')
from cdp_client import Cdp

REL_P = "video-rod/B站/up/视频/a.mp4"
REL_N = "B站/up/视频/a.mp4"
FS = "B站/up/视频/a.mp4"

results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name +
          ("" if ok else f"   got={got!r} expect={expect!r}"))


cdp = Cdp()
ext_id = None
for t in cdp.targets():
    u = t.get("url", "")
    if t.get("type") == "service_worker" and u.endswith("/js/background.js"):
        ext_id = u.split("/")[2]
print("ext:", ext_id, flush=True)

tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
sid = cdp.attach(tid)
cdp.send("Runtime.enable", {}, sid)
cdp.navigate(sid, f"chrome-extension://{ext_id}/library.html")
time.sleep(2)

SETUP = """(async function () {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry('video-rod', { recursive: true }); } catch (e) {}
  const r = await root.getDirectoryHandle('video-rod', { create: true });
  const segs = %s.split('/'); const name = segs.pop();
  let d = r;
  for (const s of segs) { d = await d.getDirectoryHandle(s, { create: true }); }
  const fh = await d.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); await w.write('AAAA'); await w.close();

  await VRIndex.setRoot(r, 'D:\\\\fake\\\\Downloads\\\\video-rod', 'video-rod');
  await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
  const now = Date.now();
  const mk = (rel) => ({ relPath: rel, absPath: 'D:/fake/Downloads/video-rod/' + %s,
    platform: 'bilibili', platformName: 'B站', creatorFull: 'up(@up)', creatorId: '1',
    type: 'video', fileName: 'a.mp4', size: 4, mtime: now, starred: 0, tags: [], state: 'ok' });
  await VRDB.putFiles([mk(%s), mk(%s)]);
  return (await VRDB.getAllFiles()).length;
})()""" % (json.dumps(FS), json.dumps(FS), json.dumps(REL_P), json.dumps(REL_N))
print("setup rows:", cdp.eval(SETUP, sid), flush=True)


def ev(js):
    return cdp.eval(js, sid)


def db_state():
    return ev("""(async function(){
      const rows = await VRDB.getAllFiles();
      return { n: rows.length, rels: rows.map(r => r.relPath + '|' + (r.state || 'ok')),
               cards: document.querySelectorAll('#grid .card').length,
               st: (await VRTrash.status()).count };
    })()""")


cdp.reload(sid)
time.sleep(1.2)
s0 = db_state()
check("A1 两条索引都在（删前）", [s0["n"], s0["cards"]], [2, 2])

# 等启动自愈跑完（scheduleTrashSweep 延迟 2.5s）
time.sleep(4.0)
s1 = db_state()
check("A2 启动自愈把重复索引归并成 1 条", [s1["n"], s1["cards"]], [1, 1])
check("A3 保留的是带前缀的规范条目", s1["rels"], [REL_P + "|ok"])

# 再人为塞回一条无前缀残行（模拟「自愈还没跑就删了」的时间窗）
ev("""(async function(){
  const c = await VRDB.getFile(%s);
  await VRDB.putFiles([Object.assign({}, c, { relPath: %s, state: 'ok' })]);
  return 1;
})()""" % (json.dumps(REL_P), json.dumps(REL_N)))

rm = ev("""(async function(){
  const r = await VRTrash.remove([%s]);
  const rows = await VRDB.getAllFiles();
  return { moved: r.moved, n: rows.length,
           states: rows.map(x => x.relPath + '|' + (x.state || 'ok')) };
})()""" % json.dumps(REL_P))
print("删掉带前缀那条：", rm, flush=True)
check("B1 删除后索引保留两条（一条 trashed、一条残行）", [rm["moved"], rm["n"]], [1, 2])

empt = ev("""(async function(){
  const r = await VRTrash.empty();
  const rows = await VRDB.getAllFiles();
  return { n: rows.length, ghosts: r && r.ghosts, st: (await VRTrash.status()).count };
})()""")
print("清空回收站：", empt, flush=True)
check("C1 清空后残行一并清掉（原实现留死卡）", [empt["n"], empt["st"]], [0, 0])
check("C2 幽灵行计数 = 1", empt["ghosts"], 1)

cdp.reload(sid)
time.sleep(3.2)
s2 = db_state()
check("C3 刷新后主页 0 张死卡", [s2["cards"], s2["n"]], [0, 0])

# ---------------- D. 自愈与「删除进行中」的竞态 ----------------
# 场景：删到回收站时先打标、再搬文件。启动自愈如果正好在这个窗口里跑，
# 会看到「标了 trashed 但文件还在原位」→ 把条目打回 ok，文件却已经搬走 → 死卡。
# 约定：带 trashPending 的条目，自愈这一轮必须放过。
RACE = """(async function () {
  const root = await navigator.storage.getDirectory();
  const r = await root.getDirectoryHandle('video-rod', { create: true });
  const rel = 'video-rod/X/u/视频/race.mp4';
  const fs = 'X/u/视频/race.mp4';
  const segs = fs.split('/'); const name = segs.pop();
  let d = r;
  for (const s of segs) { d = await d.getDirectoryHandle(s, { create: true }); }
  const fh = await d.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); await w.write('RACE'); await w.close();
  await VRDB.putFiles([{ relPath: rel, absPath: 'D:/fake/Downloads/video-rod/' + fs,
    platform: 'x', platformName: 'X', type: 'video', fileName: 'race.mp4', size: 4,
    mtime: Date.now(), starred: 0, tags: [], state: 'trashed', trashBatch: 'b-race',
    trashedAt: Date.now(), trashPending: 1 }]);
  return 1;
})()"""
ev(RACE)
race1 = ev("""(async function(){
  const r = await VRTrash.sweep();
  const row = (await VRDB.getAllFiles()).find(x => x.relPath.endsWith('race.mp4'));
  return { revived: r.revived, state: row && row.state, pending: row && row.trashPending };
})()""")
check("D1 搬运中的条目不被打回 ok", [race1["revived"], race1["state"]], [0, "trashed"])

# 标记撤掉、且已过 15 秒新鲜期（文件仍在原位）→ 这一轮才允许打回 ok
race2 = ev("""(async function(){
  const rel = 'video-rod/X/u/视频/race.mp4';
  await VRDB.patchFile(rel, { trashPending: 0, trashedAt: Date.now() - 60000 });
  const r = await VRTrash.sweep();
  const row = await VRDB.getFile(rel);
  return { revived: r.revived, state: row && row.state };
})()""")
check("D2 真·文件还在原位才打回 ok", [race2["revived"], race2["state"]], [1, "ok"])

errs = cdp.errors()
if errs:
    print("\n控制台：")
    for e in errs[:8]:
        print("  ", e)
total = len(results)
passed = sum(1 for r in results if r[0])
print(f"\n===== {passed}/{total} 通过 =====")
sys.exit(0 if passed == total else 1)
