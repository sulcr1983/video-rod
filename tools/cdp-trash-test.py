# 删除 / 回收站验收（S5）
#
# 前置：
#   1) Chrome for Testing --remote-debugging-port=<port> --load-extension=E:\test\video-rod
# 用法：VR_CDP=http://127.0.0.1:9346 python tools/cdp-trash-test.py
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
          ("" if ok else f"   got={got!r} expect={expect!r}"))


def ev(cdp, sid, js):
    r = cdp.eval(js, sid)
    if isinstance(r, dict) and "__error" in r:
        raise RuntimeError(r["__error"])
    return r


A = "video-rod/B站/up/视频/a.mp4"
B = "video-rod/X/u/图片/b.png"

SETUP = r"""
(async function () {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry('trash-test', { recursive: true }); } catch (e) { /* 忽略 */ }
  const r = await root.getDirectoryHandle('trash-test', { create: true });

  async function put(rel, text) {
    const segs = rel.split('/');
    const name = segs.pop();
    let d = r;
    for (const s of segs) { d = await d.getDirectoryHandle(s, { create: true }); }
    const fh = await d.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  await put(%s, 'AAAA');
  await put(%s, 'BBBBBB');

  await VRIndex.setRoot(r, 'D:\\fake\\video-rod');
  const now = Date.now();
  await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
  await VRDB.putFiles([
    { relPath: %s, absPath: 'D:/fake/video-rod/' + %s, platform: 'bilibili', platformName: 'B站',
      creatorFull: 'up', creatorId: '1', type: 'video', fileName: 'a.mp4', size: 4,
      mtime: now, starred: 0, tags: [], state: 'ok' },
    { relPath: %s, absPath: 'D:/fake/video-rod/' + %s, platform: 'x', platformName: 'X',
      creatorFull: 'u', creatorId: '2', type: 'image', fileName: 'b.png', size: 6,
      mtime: now - 1000, starred: 0, tags: [], state: 'ok' }
  ]);
  localStorage.setItem('vrLibView', 'grid');
  localStorage.removeItem('vrLibOverview');
  return 2;
})()
""" % (json.dumps(A), json.dumps(B), json.dumps(A), json.dumps(A), json.dumps(B), json.dumps(B))


def exists_js(rel):
    return r"""(async function(){
      const root = await VRTrash.resolveRoot();
      try {
        const segs = %s.split('/'); const n = segs.pop();
        let d = root.handle;
        for (const s of segs) { d = await d.getDirectoryHandle(s); }
        await d.getFileHandle(n);
        return true;
      } catch (e) { return false; }
    })()""" % json.dumps(rel)


def main():
    cdp = Cdp()
    ext_id, _ = find_ext_id(cdp)
    check("A1 扩展已加载", bool(ext_id), True)
    if not ext_id:
        return finish(cdp)

    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    sid = cdp.attach(tid)
    for m in ("Runtime.enable", "Page.enable", "Network.enable"):
        cdp.send(m, {}, sid)
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True}, sid)
    cdp.send("Page.navigate", {"url": f"chrome-extension://{ext_id}/library.html"}, sid)
    time.sleep(2.0)

    mods = ev(cdp, sid, "({t: typeof VRTrash, u: typeof VRTrashUI, i: typeof VRIndex})")
    check("A2 模块已加载", mods, {"t": "object", "u": "object", "i": "object"})
    if not mods or mods.get("t") != "object":
        return finish(cdp)

    check("A3 OPFS + 索引 2 条", ev(cdp, sid, SETUP), 2)
    cdp.send("Page.reload", {"ignoreCache": True}, sid)
    time.sleep(2.2)
    check("A4 页面渲染 2 张卡", ev(cdp, sid, "document.querySelectorAll('#libGrid .lib-card').length"), 2)

    # ---------------- 引擎：删除 ----------------
    rm = ev(cdp, sid, r"""(async function(){
      const r = await VRTrash.remove([%s]);
      const list = await VRTrash.list();
      const st = await VRTrash.status();
      const root = await VRTrash.resolveRoot();
      let manifest = null;
      try {
        const segs = ('_回收站/' + r.batch + '/_manifest.json').split('/');
        const n = segs.pop(); let d = root.handle;
        for (const s of segs) { d = await d.getDirectoryHandle(s); }
        manifest = JSON.parse(await (await (await d.getFileHandle(n)).getFile()).text());
      } catch (e) { /* 忽略 */ }
      return { batch: r.batch, moved: r.moved, cleaned: r.cleaned, failed: r.failed,
               count: (await VRDB.getAllFiles()).length,
               list: list.map(b => ({ n: b.items.length, size: b.size })),
               status: { count: st.count, size: st.size, batches: st.batches },
               manifest: manifest && { n: manifest.items.length, rel: manifest.items[0].relPath } };
    })()""" % json.dumps(A))
    check("B1 remove 返回批次", [rm["moved"], rm["cleaned"], rm["failed"],
                              bool(rm["batch"]) and len(rm["batch"]) > 12],
          [1, 0, [], True])
    check("B2 回收站清单", [rm["list"], rm["status"], rm["manifest"]],
          [[{"n": 1, "size": 4}], {"count": 1, "size": 4, "batches": 1},
           {"n": 1, "rel": A}])
    check("B3 索引已移除", rm["count"], 1)
    check("B4 文件已移动", ev(cdp, sid, exists_js("_回收站/" + rm["batch"] + "/" + A)), True)
    check("B5 源文件不存在", ev(cdp, sid, exists_js(A)), False)

    cdp.send("Page.reload", {"ignoreCache": True}, sid)
    time.sleep(2.0)
    check("B6 页面同步为 1 张卡", ev(cdp, sid, "document.querySelectorAll('#libGrid .lib-card').length"), 1)

    # ---------------- 右键菜单 + 确认框 ----------------
    menu = ev(cdp, sid, r"""(function(){
      const card = document.querySelector('#libGrid .lib-card');
      const r = card.getBoundingClientRect();
      card.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true,
        clientX: r.left + 40, clientY: r.top + 40}));
      const m = document.getElementById('libCtxMenu');
      return { hidden: m.hidden, acts: [...m.querySelectorAll('[data-act]')].map(b => b.dataset.act),
               star: m.querySelector('[data-act="star"]').textContent,
               left: m.getBoundingClientRect().left, top: m.getBoundingClientRect().top };
    })()""")
    check("C1 右键菜单可见", menu["hidden"], False)
    check("C2 菜单项完整", menu["acts"], ["preview", "open", "copy", "star", "rename", "trash"])
    check("C3 星标文案", menu["star"], "加星标")

    confirm = ev(cdp, sid, r"""(function(){
      document.querySelector('#libCtxMenu [data-act="trash"]').click();
      const mask = document.getElementById('libConfirmMask');
      return { hidden: mask.hidden, title: document.getElementById('libConfirmTitle').textContent,
               text: document.getElementById('libConfirmText').textContent };
    })()""")
    check("C4 删除弹确认框", [confirm["hidden"], confirm["title"], "b.png" in confirm["text"]],
          [False, "移到回收站", True])

    cancel = ev(cdp, sid, r"""(function(){
      document.getElementById('libConfirmCancel').click();
      return { hidden: document.getElementById('libConfirmMask').hidden,
               cards: document.querySelectorAll('#libGrid .lib-card').length };
    })()""")
    check("C5 取消不删除", [cancel["hidden"], cancel["cards"]], [True, 1])

    deleted = ev(cdp, sid, r"""(async function(){
      const card = document.querySelector('#libGrid .lib-card');
      const r = card.getBoundingClientRect();
      card.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true,
        clientX: r.left + 40, clientY: r.top + 40}));
      document.querySelector('#libCtxMenu [data-act="trash"]').click();
      document.getElementById('libConfirmOk').click();
      await new Promise(r => setTimeout(r, 700));
      return { cards: document.querySelectorAll('#libGrid .lib-card').length,
               badge: document.getElementById('libTrashCount').textContent,
               badgeHidden: document.getElementById('libTrashCount').hidden,
               empty: !document.getElementById('libEmpty').hidden };
    })()""")
    check("C6 确认后删除并刷新", [deleted["cards"], deleted["badge"], deleted["badgeHidden"]], [0, "2", False])
    check("C7 空态出现", deleted["empty"], True)

    # ---------------- 抽屉：恢复 ----------------
    drawer = ev(cdp, sid, r"""(async function(){
      document.getElementById('libTrashOpen').click();
      await new Promise(r => setTimeout(r, 500));
      return { open: !document.getElementById('libTrashDrawer').hidden,
               batches: document.querySelectorAll('.trash-batch').length,
               items: document.querySelectorAll('.trash-item').length,
               meta: document.getElementById('libTrashMeta').textContent };
    })()""")
    check("D1 回收站抽屉", [drawer["open"], drawer["batches"], drawer["items"]], [True, 2, 2])
    check("D2 抽屉统计", "2 项" in drawer["meta"], True)

    restored = ev(cdp, sid, r"""(async function(){
      const btn = [...document.querySelectorAll('[data-restore-item]')]
        .find(b => b.dataset.restoreItem === %s);
      btn.click();
      await new Promise(r => setTimeout(r, 800));
      return { cards: document.querySelectorAll('#libGrid .lib-card').length,
               badge: document.getElementById('libTrashCount').textContent,
               items: document.querySelectorAll('.trash-item').length };
    })()""" % json.dumps(B))
    check("D3 单条恢复回列表", [restored["cards"], restored["badge"], restored["items"]], [1, "1", 1])
    check("D4 文件回到原路径", ev(cdp, sid, exists_js(B)), True)

    # ---------------- 抽屉：彻底删除 ----------------
    purged = ev(cdp, sid, r"""(async function(){
      const btn = [...document.querySelectorAll('[data-purge-item]')]
        .find(b => b.dataset.purgeItem === %s);
      btn.click();
      await new Promise(r => setTimeout(r, 120));
      const maskShown = !document.getElementById('libConfirmMask').hidden;
      document.getElementById('libConfirmOk').click();
      await new Promise(r => setTimeout(r, 600));
      const st = await VRTrash.status();
      return { confirm: maskShown, count: st.count, remaining: (await VRDB.getAllFiles()).length };
    })()""" % json.dumps(A))
    check("E1 彻底删除需确认", purged["confirm"], True)
    check("E2 回收站清空该批", [purged["count"], purged["remaining"]], [0, 1])
    check("E3 回收站无残留文件",
          ev(cdp, sid, r"""(async function(){
            const root = await VRTrash.resolveRoot();
            async function has(rel){ try{ const segs=rel.split('/'); const n=segs.pop(); let d=root.handle;
              for(const s of segs) d=await d.getDirectoryHandle(s); await d.getFileHandle(n); return true; }catch(e){ return false; } }
            return await has(%s);
          })()""" % json.dumps("_回收站/" + rm["batch"] + "/" + A)), False)

    # ---------------- 权限 ----------------
    perm = ev(cdp, sid, r"""(async function(){
      await VRDB.setHandle('root', null);
      let code = '';
      try { await VRTrash.remove([%s]); } catch (e) { code = e.code || e.message; }
      return code;
    })()""" % json.dumps(B))
    check("F1 无句柄报 LIB_E_NO_PERM", perm, "LIB_E_NO_PERM")

    # 恢复句柄并清空回收站
    ev(cdp, sid, r"""(async function(){
      const root = await navigator.storage.getDirectory();
      const r = await root.getDirectoryHandle('trash-test');
      await VRIndex.setRoot(r, 'D:\\fake\\video-rod');
      return 1;
    })()""")

    emptied = ev(cdp, sid, r"""(async function(){
      const r = await VRTrash.remove([%s]);
      const before = await VRTrash.status();
      await VRTrash.empty();
      const after = await VRTrash.status();
      return { before: before.count, after: after.count, batches: r.batch ? 1 : 0,
               count: (await VRDB.getAllFiles()).length };
    })()""" % json.dumps(B))
    check("G1 清空回收站", [emptied["before"] >= 1, emptied["after"], emptied["count"]], [True, 0, 0])

    # 清理
    ev(cdp, sid, r"""(async function(){
      await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
      await VRDB.setHandle('root', null);
      await VRDB.setSetting('rootAbs', '');
      return 1;
    })()""")

    return finish(cdp)


def finish(cdp):
    errs = cdp.errors()
    check("L1 控制台无 error/exception", errs, [])
    total = len(results)
    passed = sum(1 for r in results if r[0])
    print(f"\n===== {passed}/{total} 通过 =====")
    if errs:
        print("控制台：", errs[:5])
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print("\n脚本异常：", e)
        sys.exit(2)
