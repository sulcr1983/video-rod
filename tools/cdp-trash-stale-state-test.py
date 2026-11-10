# -*- coding: utf-8 -*-
"""回收站删除失败（FSA InvalidStateError）回归 · 2026-11-10

真实库现场：12:26 删除一条 113.7MB 微博视频，ops 日志记
  failed: [{code:11, message:"An operation that depends on state cached in
            an interface object ..."}]
文件其实在、权限 granted、句柄链全 ok —— 纯 FSA 状态缓存抖动。
旧代码不重试，回滚打标，回收站 0 项；UI 三处单条删除又无视 rr.failed，
照弹「已移入回收站」，用户看到的就是「删不掉、回收站也没有」。

本套件实跑四条通道：
  A 基线删除
  B 注入一次 InvalidStateError → 自动重解析句柄 + 重试，删除仍成功
  C 持续 InvalidStateError → 如实 failed、索引回滚、文件原位、回收站不进脏批次
  D exists() 严格化：状态异常不再被误判成「文件不存在」（防静默假删）
  E UI 真实交互：键盘 Delete → 确认框 → 失败时 toast 说「删除失败」并给「重试」，
    点重试成功后才说「已移入回收站」

用法（隔离 Edge 实例，不碰真实 9480 库）：
  /d/tmp/run-iso.sh 9491 vr-stale tools/cdp-trash-stale-state-test.py
或：python tools/cdp-run.py tools/cdp-trash-stale-state-test.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name +
          ("" if ok else "   got=%r expect=%r" % (got, expect)), flush=True)


def ev(cdp, sid, js):
    r = cdp.eval(js, sid)
    if isinstance(r, dict) and "__error" in r:
        raise RuntimeError(r["__error"])
    return r


REL = ["video-rod/B站/up/视频/a.mp4", "video-rod/X/u/图片/b.png"]
FS = ["B站/up/视频/a.mp4", "X/u/图片/b.png"]

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
  await VRIndex.setRoot(r, 'D:/fake/Downloads/video-rod', 'video-rod');
  await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
  const now = Date.now();
  await VRDB.putFiles(rels.map((rel, i) => ({
    relPath: rel, absPath: 'D:/fake/Downloads/video-rod/' + fss[i],
    platform: i === 1 ? 'x' : 'bilibili', platformName: i === 1 ? 'X' : 'B站',
    creatorFull: 'u(@u)', creatorId: '1', type: i === 1 ? 'image' : 'video',
    fileName: fss[i].split('/').pop(), size: 2, mtime: now - i * 1000,
    starred: 0, tags: [], state: 'ok'
  })));
  return (await VRDB.getAllFiles()).length;
})()
""" % (json.dumps(REL), json.dumps(FS))

INJECT = r"""
window.__vrStale = {
  gf: FileSystemFileHandle.prototype.getFile,
  gh: FileSystemDirectoryHandle.prototype.getFileHandle,
  install: function (mode) {
    const orig = this.gf; let n = 0;
    FileSystemFileHandle.prototype.getFile = function () {
      n++;
      if (mode === 'always' || (mode === 'once' && n === 1)) {
        throw new DOMException(
          'An operation that depends on state cached in an interface object was made ' +
          'but the state had changed since it was read from disk.', 'InvalidStateError');
      }
      return orig.apply(this, arguments);
    };
  },
  installDir: function () {
    FileSystemDirectoryHandle.prototype.getFileHandle = function () {
      throw new DOMException('state cached ... changed', 'InvalidStateError');
    };
  },
  off: function () {
    FileSystemFileHandle.prototype.getFile = this.gf;
    FileSystemDirectoryHandle.prototype.getFileHandle = this.gh;
  }
};
'ok'
"""

FILE_EXISTS = r"""(async function(){
  const rr = await VRTrash.resolveRoot();
  try {
    const segs = %s.split('/'); const n = segs.pop(); let d = rr.handle;
    for (const s of segs) { d = await d.getDirectoryHandle(s); }
    await d.getFileHandle(n); return true;
  } catch (e) { return false; }
})()"""


def file_exists(cdp, sid, rel):
    return ev(cdp, sid, FILE_EXISTS % json.dumps(rel))


def state_of(cdp, sid, rel):
    return ev(cdp, sid, "(async function(){ const r = await VRDB.getFile(%s); "
             "return r ? (r.state || 'ok') : 'GONE'; })()" % json.dumps(rel))


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
    print("ext:", ext_id, flush=True)
    if not ext_id:
        print("扩展没加载")
        return 2

    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    sid = cdp.attach(tid)
    for m in ("Runtime.enable", "Page.enable"):
        cdp.send(m, {}, sid)
    cdp.navigate(sid, "chrome-extension://%s/library.html" % ext_id)
    time.sleep(1.5)
    print("setup rows:", ev(cdp, sid, SETUP), flush=True)
    cdp.reload(sid)
    time.sleep(2.2)
    ev(cdp, sid, INJECT)

    # ---------- A 基线：正常删除 ----------
    a = ev(cdp, sid, "(async function(){ const r = await VRTrash.remove([%s]); "
           "return {moved:r.moved, failed:r.failed.length, state:(await VRDB.getFile(%s)).state, "
           "trash:(await VRTrash.status()).count, batch:r.batch}; })()"
           % (json.dumps(REL[0]), json.dumps(REL[0])))
    check("A1 正常删除：moved=1 / failed=0 / trashed / 回收站 1",
          [a["moved"], a["failed"], a["state"], a["trash"]], [1, 0, "trashed", 1])
    check("A2 原文件已搬走", file_exists(cdp, sid, FS[0]), False)

    # ---------- B 一次状态抖动：重试后仍要删成功 ----------
    rs = ev(cdp, sid, "(async function(){ const r = await VRTrash.restore(%s, [%s]); "
            "return {restored:r.restored, failed:r.failed.length}; })()"
            % (json.dumps(a["batch"]), json.dumps(REL[0])))
    check("B0 先恢复到原位置", [rs["restored"], rs["failed"]], [1, 0])
    ev(cdp, sid, "window.__vrStale.install('once'); 'ok'")
    b = ev(cdp, sid, "(async function(){ const r = await VRTrash.remove([%s]); "
           "return {moved:r.moved, failed:r.failed.length, state:(await VRDB.getFile(%s)).state}; })()"
           % (json.dumps(REL[0]), json.dumps(REL[0])))
    ev(cdp, sid, "window.__vrStale.off(); 'ok'")
    check("B1 注入一次 InvalidStateError，自动重试后删除成功",
          [b["moved"], b["failed"], b["state"]], [1, 0, "trashed"])
    check("B2 文件确实搬走（不是谎报成功）", file_exists(cdp, sid, FS[0]), False)

    # ---------- C 持续状态抖动：如实失败、不回滚成死卡、不留脏批次 ----------
    trash_before = ev(cdp, sid, "VRTrash.status().then(s=>s.count)")
    ev(cdp, sid, "window.__vrStale.install('always'); 'ok'")
    c = ev(cdp, sid, "(async function(){ const r = await VRTrash.remove([%s]); "
           "return {moved:r.moved, cleaned:r.cleaned, failed:r.failed.length, "
           "error:r.failed[0] && r.failed[0].error, code:r.failed[0] && r.failed[0].code}; })()"
           % json.dumps(REL[1]))
    ev(cdp, sid, "window.__vrStale.off(); 'ok'")
    trash_after = ev(cdp, sid, "VRTrash.status().then(s=>s.count)")
    check("C1 持续抖动：moved=0 / cleaned=0 / failed=1 且带错误名",
          [c["moved"], c["cleaned"], c["failed"], c["error"], c["code"]],
          [0, 0, 1, "InvalidStateError", 11])
    check("C2 索引回滚成 ok（卡片留在原地，不制造死卡）",
          state_of(cdp, sid, REL[1]), "ok")
    check("C3 文件还在原位", file_exists(cdp, sid, FS[1]), True)
    check("C4 回收站没有多出脏批次", trash_after, trash_before)

    # ---------- D exists 严格化：状态异常不能被当成「文件不存在」 ----------
    ev(cdp, sid, "window.__vrStale.installDir(); 'ok'")
    d = ev(cdp, sid, "(async function(){ const rr = await VRTrash.resolveRoot(); "
           "try { await VRTrash.exists(rr.handle, %s); return 'false'; } "
           "catch (e) { return e.name; } })()" % json.dumps(FS[1]))
    ev(cdp, sid, "window.__vrStale.off(); 'ok'")
    check("D1 状态异常上抛，不再静默当「文件已删」", d, "InvalidStateError")

    # ---------- E UI 真交互：失败不再谎报「已移入回收站」 ----------
    # 重新造库，让主页有卡片可聚焦
    ev(cdp, sid, SETUP)
    cdp.reload(sid)
    time.sleep(2.2)
    cards = cdp.wait_js(sid, "document.querySelectorAll('#grid .card').length", 8.0)
    check("E0 主页有卡片", cards, 2)
    ev(cdp, sid, r"""
    (function(){
      window.__vrOrigRemove = window.VRTrash.remove;
      window.__vrFailOnce = true;
      window.VRTrash.remove = function () {
        if (window.__vrFailOnce) {
          window.__vrFailOnce = false;
          return Promise.resolve({ batch:'fake', moved:0, cleaned:0, failed:[{
            relPath: %s, code:11, error:'InvalidStateError',
            message:'An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.'
          }] });
        }
        return Promise.resolve({ batch:'fake2', moved:1, cleaned:0, failed:[] });
      };
      window.__vrPerm = { writable: true };
      const card = document.querySelector('#grid .card');
      card.setAttribute('tabindex','-1'); card.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Delete', bubbles:true}));
      return document.getElementById('confirmMask').classList.contains('show');
    })()
    """ % json.dumps(REL[0]))
    confirmed = ev(cdp, sid, "document.getElementById('confirmMask').classList.contains('show')")
    check("E1 Delete 弹出确认框", confirmed, True)
    ev(cdp, sid, "document.getElementById('confirmOk').click(); 'ok'")
    time.sleep(0.6)
    ui1 = ev(cdp, sid, "({text:document.getElementById('toastText').textContent, "
             "act:document.getElementById('toastAct').textContent, "
             "hidden:document.getElementById('toastAct').hidden})")
    check("E2 失败 toast 说「删除失败」而不是「已移入回收站」",
          ["删除失败" in ui1["text"], "已移入回收站" in ui1["text"]], [True, False])
    check("E3 失败 toast 给了「重试」入口", [ui1["act"], ui1["hidden"]], ["重试", False])
    ev(cdp, sid, "document.getElementById('toastAct').click(); 'ok'")
    time.sleep(0.6)
    ui2 = ev(cdp, sid, "document.getElementById('toastText').textContent")
    check("E4 点重试成功后才报「已移入回收站」", "已移入回收站" in ui2, True)
    ev(cdp, sid, "window.VRTrash.remove = window.__vrOrigRemove; 'ok'")

    # ---------- 收尾：还原真引擎 → 真删 2 条 → 清空，确认没有残留 ----------
    # E 阶段的 remove 是桩（没真的打 trashed 标），所以这里必须走一次真实删除，
    # 否则 empty() 面对两条 ok 行本来就不该动它们。
    fin_rm = ev(cdp, sid, "(async function(){ const r = await VRTrash.remove(%s); "
                "return {moved:r.moved, failed:r.failed.length}; })()" % json.dumps(REL))
    check("F0 还原真引擎后删除 2 条", [fin_rm["moved"], fin_rm["failed"]], [2, 0])
    ev(cdp, sid, "(async function(){ return await VRTrash.empty(); })()")
    fin = ev(cdp, sid, "(async function(){ const rows=await VRDB.getAllFiles(); "
             "return {rows:rows.length, trash:(await VRTrash.status()).count}; })()")
    check("F1 清空后索引 0 行、回收站 0 项", [fin["rows"], fin["trash"]], [0, 0])

    bad = [r for r in results if not r[0]]
    print("\n=== %d/%d PASS ===" % (len(results) - len(bad), len(results)), flush=True)
    cdp.close_created()
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
