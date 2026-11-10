# 批量选择 + 重命名验收（S5b）
#
# ⚠️ 2026-11-10 已知过期：这是 S5b 时期旧 UI（#libGrid / .lib-card / #libBatch）的用例。
# 舞台皮肤重构后 DOM 换成 #grid / .card，A4 起 40+ 条断言全部失效（实测 A1-A3 PASS、
# A4/A5 FAIL、随后 #libBatch null.click() 抛 TypeError）。**不是产品回归**，也不重写
# 40+ 条旧断言（属另一任务）。检测到旧 DOM 不存在时打印 SKIP 并以退出码 3 结束，
# 已从 cdp-run.py 的默认套件摘除；待单独立项按当前 UI 重写。
# 见 docs/TESTING.md §18。
#
# 前置：
#   1) Chrome for Testing --remote-debugging-port=<port> --load-extension=E:\test\video-rod\.work\wt-s5b
# 用法：VR_CDP=http://127.0.0.1:9351 python tools/cdp-batch-test.py
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

results = []
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "deliverables", "assets")

A = "video-rod/B站/up/视频/a.mp4"
B = "video-rod/X/u/图片/b.png"
C = "video-rod/X/u/图片/c.png"
D = "video-rod/X/u/图片/d.png"
E = "video-rod/X/u/图片/e.png"


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


def shot(cdp, sid, name, w=1440, h=900):
    cdp.send("Emulation.setDeviceMetricsOverride",
             {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False}, sid)
    time.sleep(0.8)
    s = cdp.send("Page.captureScreenshot", {"format": "png"}, sid)
    path = os.path.abspath(os.path.join(OUT, name))
    with open(path, "wb") as f:
        f.write(base64.b64decode(s["data"]))
    return os.path.getsize(path)


SETUP = r"""
(async function () {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry('batch-test', { recursive: true }); } catch (e) { /* 忽略 */ }
  const r = await root.getDirectoryHandle('batch-test', { create: true });

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
  await put(%s, 'EEEE');

  await VRIndex.setRoot(r, 'D:\\fake\\video-rod');
  const now = Date.now();
  await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
  await VRDB.putFiles([
    { relPath: %s, absPath: 'D:/fake/video-rod/' + %s, platform: 'bilibili', platformName: 'B站',
      creatorFull: 'up', creatorId: '1', type: 'video', fileName: 'a.mp4', size: 4,
      mtime: now - 1000, starred: 0, tags: [], state: 'ok' },
    { relPath: %s, absPath: 'D:/fake/video-rod/' + %s, platform: 'x', platformName: 'X',
      creatorFull: 'u', creatorId: '2', type: 'image', fileName: 'b.png', size: 6,
      mtime: now - 2000, starred: 1, tags: ['风景'], thumbKey: 'old-thumb', state: 'ok' },
    { relPath: %s, absPath: 'D:/fake/video-rod/' + %s, platform: 'x', platformName: 'X',
      creatorFull: 'u', creatorId: '2', type: 'image', fileName: 'e.png', size: 4,
      mtime: now - 3000, starred: 0, tags: [], state: 'ok' }
  ]);
  localStorage.setItem('vrLibView', 'grid');
  localStorage.removeItem('vrLibOverview');
  return 3;
})()
""" % (json.dumps(A), json.dumps(B), json.dumps(E),
       json.dumps(A), json.dumps(A), json.dumps(B), json.dumps(B),
       json.dumps(E), json.dumps(E))


FS_HELPER = r"""
  async function fsPath(rel) {
    const root = await VRTrash.resolveRoot();
    const cands = VRRename._candidates(rel, root.prefix);
    for (const c of cands) {
      try {
        const segs = c.split('/'); const n = segs.pop();
        let d = root.handle;
        for (const s of segs) { d = await d.getDirectoryHandle(s); }
        const fh = await d.getFileHandle(n);
        const f = await fh.getFile();
        return { path: c, size: f.size, text: await f.text() };
      } catch (e) { /* 换下一个候选 */ }
    }
    return null;
  }
"""


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
    cdp.navigate(sid, f"chrome-extension://{ext_id}/library.html")
    # 2026-11-10 修正：VRBatch / VRTrashUI 是 S5b 早期拆出的两个全局，批量选择与
    # 回收站 UI 后来并入 app.js，仓库里已无这两个模块（grep js/ 零命中）。旧断言写死
    # 这两个名字 → 恒 FAIL → 下面 40+ 条用例全部提前 return（假 "2/3 通过"）。
    # 改为校验当前真实模块。此外 navigate 后立刻 eval 会落在 about:blank 的旧执行
    # 上下文（冷启动实测四个模块全 undefined），与 cdp-trash-empty-repro.py /
    # cdp-trash-stale-state-test.py 一致：等一拍 + reload，再等模块挂载完。
    time.sleep(1.5)
    cdp.reload(sid)
    time.sleep(2.0)
    cdp.wait_js(sid, "typeof VRDB === 'object' && typeof VRIndex === 'object' "
               "&& typeof VRRename === 'object' && typeof VRTrash === 'object'", 15.0)

    mods = ev(cdp, sid, "({d: typeof VRDB, r: typeof VRRename, t: typeof VRTrash, i: typeof VRIndex})")
    check("A2 资源库模块已加载", mods,
          {"d": "object", "r": "object", "t": "object", "i": "object"})
    if not mods or mods.get("r") != "object" or mods.get("t") != "object":
        return finish(cdp)

    # 旧 UI 守卫：不让它伪装成产品回归失败，也不让它 crash 后留下半截脏数据。
    legacy = ev(cdp, sid, "!!document.getElementById('libGrid') || "
                          "!!document.getElementById('libBatch')")
    if not legacy:
        print("\n===== SKIP（历史 S5b 用例，不计入验收门禁）=====", flush=True)
        print("当前舞台皮肤已无 #libGrid / #libBatch；A3 起 40+ 条旧 DOM 断言不适用。", flush=True)
        print("基础环境自检 A1/A2 已通过（扩展定位 + 模块挂载正常）。", flush=True)
        print("待单独立项按当前 UI 重写，见 docs/TESTING.md §18。", flush=True)
        sys.exit(3)

    check("A3 OPFS + 索引 3 条", ev(cdp, sid, SETUP), 3)
    cdp.reload(sid)
    cdp.wait_js(sid, "document.querySelectorAll('#libGrid .lib-card').length === 3", 8.0)
    check("A4 页面渲染 3 张卡", ev(cdp, sid, "document.querySelectorAll('#libGrid .lib-card').length"), 3)
    check("A5 顶栏有「批量」按钮",
          ev(cdp, sid, "!!document.getElementById('libBatch') && "
                       "document.getElementById('libBatchBar').hidden"), True)

    # ---------------- 批量：进入 / 勾选 / 全选 / 取消 ----------------
    enter = ev(cdp, sid, r"""(function(){
      document.getElementById('libBatch').click();
      const check = document.querySelector('#libGrid .lib-card .batch-check');
      return {
        mode: document.body.classList.contains('batch-mode'),
        bar: !document.getElementById('libBatchBar').hidden,
        count: document.getElementById('libBatchCount').textContent,
        pressed: document.getElementById('libBatch').getAttribute('aria-pressed'),
        checkDisplay: check ? getComputedStyle(check).display : '',
        trashDisabled: document.getElementById('libBatchTrash').disabled
      };
    })()""")
    check("B1 进入批量模式", [enter["mode"], enter["bar"], enter["pressed"]], [True, True, "true"])
    check("B2 勾选框可见 + 计数归零", [enter["count"], enter["checkDisplay"], enter["trashDisabled"]],
          ["已选 0 项", "grid", True])

    pick = ev(cdp, sid, r"""(function(){
      const cards = [...document.querySelectorAll('#libGrid .lib-card')];
      cards[0].click();
      const a = { count: document.getElementById('libBatchCount').textContent,
                  sel: cards[0].classList.contains('sel'),
                  viewer: document.getElementById('libViewer').hidden };
      cards[1].click();
      const b = { count: document.getElementById('libBatchCount').textContent,
                  sel: cards[1].classList.contains('sel'),
                  trashDisabled: document.getElementById('libBatchTrash').disabled };
      return {a: a, b: b, count: window.VRBatch.count()};
    })()""")
    check("B3 点卡片勾选 1 项（不打开查看器）",
          [pick["a"]["count"], pick["a"]["sel"], pick["a"]["viewer"]], ["已选 1 项", True, True])
    check("B4 再勾 1 项", [pick["b"]["count"], pick["b"]["sel"], pick["b"]["trashDisabled"]],
          ["已选 2 项", True, False])

    bar_png = shot(cdp, sid, "batch-bar.png")
    check("B5 批量浮条截图落盘", bar_png > 20000, True)

    allsel = ev(cdp, sid, r"""(function(){
      document.getElementById('libBatchAll').click();
      const a = document.getElementById('libBatchCount').textContent;
      const sel = document.querySelectorAll('#libGrid .lib-card.sel').length;
      document.getElementById('libBatchClear').click();
      return { all: a, sel: sel,
               after: document.getElementById('libBatchCount').textContent,
               mode: document.body.classList.contains('batch-mode') };
    })()""")
    check("B6 全选 3 项", [allsel["all"], allsel["sel"]], ["已选 3 项", 3])
    check("B7 取消只清选择不退模式", [allsel["after"], allsel["mode"]], ["已选 0 项", True])

    # 批量模式下右键：重命名不可用
    menu = ev(cdp, sid, r"""(function(){
      const cards = [...document.querySelectorAll('#libGrid .lib-card')];
      cards[0].click(); cards[1].click();
      const card = cards[0];
      const r = card.getBoundingClientRect();
      card.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true,
        clientX: r.left + 40, clientY: r.top + 40}));
      const m = document.getElementById('libCtxMenu');
      const rn = m.querySelector('[data-act="rename"]');
      const out = { hidden: m.hidden, acts: [...m.querySelectorAll('[data-act]')].map(b => b.dataset.act),
                    disabled: rn.disabled, title: rn.title };
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
      out.afterEsc = m.hidden;
      out.mode = document.body.classList.contains('batch-mode');
      return out;
    })()""")
    check("B8 右键菜单含重命名", menu["acts"],
          ["preview", "open", "copy", "star", "rename", "trash"])
    check("B9 多选时重命名禁用", [menu["hidden"], menu["disabled"], "单个" in menu["title"]],
          [False, True, True])
    check("B10 Esc 先关菜单不退模式", [menu["afterEsc"], menu["mode"]], [True, True])

    # 筛选 / 搜索切换清空选择
    filters = ev(cdp, sid, r"""(async function(){
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('libBatchClear').click();
      document.querySelector('#libGrid .lib-card').click();
      const before = document.getElementById('libBatchCount').textContent;
      document.querySelector('#libTypeNav [data-type="image"]').click();
      await wait(150);
      const afterFilter = document.getElementById('libBatchCount').textContent;
      const mode1 = document.body.classList.contains('batch-mode');
      document.querySelector('#libTypeNav [data-type="all"]').click();
      await wait(150);
      document.querySelector('#libGrid .lib-card').click();
      const s = document.getElementById('libSearch');
      s.value = 'e.png';
      s.dispatchEvent(new Event('input', {bubbles: true}));
      await wait(350);
      const afterSearch = document.getElementById('libBatchCount').textContent;
      s.value = '';
      s.dispatchEvent(new Event('input', {bubbles: true}));
      await wait(350);
      return { before: before, afterFilter: afterFilter, mode1: mode1,
               afterSearch: afterSearch, count: window.VRBatch.count() };
    })()""")
    check("B11 筛选变化清空选择", [filters["before"], filters["afterFilter"], filters["mode1"]],
          ["已选 1 项", "已选 0 项", True])
    check("B12 搜索变化清空选择", [filters["afterSearch"], filters["count"]], ["已选 0 项", 0])

    esc = ev(cdp, sid, r"""(function(){
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
      const off = { mode: document.body.classList.contains('batch-mode'),
                    bar: document.getElementById('libBatchBar').hidden };
      document.getElementById('libBatch').click();
      const again = document.body.classList.contains('batch-mode');
      document.getElementById('libBatchExit').click();
      return { off: off, again: again, after: document.body.classList.contains('batch-mode') };
    })()""")
    check("B13 Esc 退出批量", [esc["off"]["mode"], esc["off"]["bar"]], [False, True])
    check("B14 浮条「退出」可退", [esc["again"], esc["after"]], [True, False])

    # ---------------- 重命名：弹窗 ----------------
    dlg = ev(cdp, sid, r"""(async function(){
      const card = [...document.querySelectorAll('#libGrid .lib-card')]
        .find(c => c.dataset.rel === %s);
      const r = card.getBoundingClientRect();
      card.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true,
        clientX: r.left + 40, clientY: r.top + 40}));
      const rn = document.querySelector('#libCtxMenu [data-act="rename"]');
      const disabled = rn.disabled;
      rn.click();
      const input = document.getElementById('libRenameInput');
      return {
        disabled: disabled,
        open: !document.getElementById('libRenameMask').hidden,
        value: input.value,
        selStart: input.selectionStart, selEnd: input.selectionEnd,
        dir: document.getElementById('libRenameDir').textContent,
        err: document.getElementById('libRenameError').hidden
      };
    })()""" % json.dumps(B))
    check("C1 右键重命名打开弹窗", [dlg["disabled"], dlg["open"], dlg["value"]], [False, True, "b.png"])
    check("C2 默认选中文件名主体", [dlg["selStart"], dlg["selEnd"]], [0, 1])
    check("C3 目录提示与错误行", ["video-rod/X/u/图片/" in dlg["dir"], dlg["err"]], [True, True])

    rename_png = shot(cdp, sid, "rename-dialog.png")
    check("C4 重命名弹窗截图落盘", rename_png > 15000, True)

    # 非法名就地提示（不关闭弹窗）
    bad = ev(cdp, sid, r"""(async function(){
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const input = document.getElementById('libRenameInput');
      input.value = 'a/b.png';
      document.getElementById('libRenameOk').click();
      await wait(400);
      return { open: !document.getElementById('libRenameMask').hidden,
               err: document.getElementById('libRenameError').textContent,
               hidden: document.getElementById('libRenameError').hidden };
    })()""")
    check("C5 非法字符就地报错", [bad["open"], bad["hidden"], "\\" in bad["err"] or "不能包含" in bad["err"]],
          [True, False, True])

    # Enter 提交 b.png → c.png
    done = ev(cdp, sid, r"""(async function(){
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const input = document.getElementById('libRenameInput');
      input.value = 'c.png';
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      await wait(900);
      return { closed: document.getElementById('libRenameMask').hidden,
               cards: document.querySelectorAll('#libGrid .lib-card').length,
               names: [...document.querySelectorAll('#libGrid .lib-card h3')].map(h => h.textContent),
               toast: document.getElementById('libToast').textContent };
    })()""")
    check("C6 Enter 提交后关闭", done["closed"], True)
    check("C7 列表刷新为新名字", [done["cards"], "c.png" in done["names"], "b.png" in done["names"]],
          [3, True, False])
    check("C8 Toast 提示", "已重命名" in done["toast"], True)

    # ---------------- 重命名：引擎 ----------------
    eng = ev(cdp, sid, r"""(async function(){
""" + FS_HELPER + r"""
      const ent = await VRDB.getFile(%s);
      const old = await VRDB.getFile(%s);
      const all = await VRDB.getAllFiles();
      const fresh = await fsPath(%s);
      const gone = await fsPath(%s);
      return {
        fresh: fresh,
        gone: gone,
        fileName: ent && ent.fileName,
        relPath: ent && ent.relPath,
        absTail: ent && ent.absPath ? ent.absPath.slice(-5) : '',
        starred: ent && ent.starred,
        tags: ent && ent.tags,
        thumb: ent && ent.thumbKey,
        old: old,
        count: all.length
      };
    })()""" % (json.dumps(C), json.dumps(B), json.dumps(C), json.dumps(B)))
    check("D1 新文件存在且内容不变", [eng["fresh"] and eng["fresh"]["text"], eng["fresh"] and eng["fresh"]["size"]],
          ["BBBBBB", 6])
    check("D2 旧文件已删除", eng["gone"], None)
    check("D3 索引换 key", [eng["fileName"], eng["relPath"], eng["old"]], ["c.png", C, None])
    check("D4 保留星标/标签，thumbKey 置空",
          [eng["starred"], eng["tags"], eng["thumb"]], [1, ["风景"], ""])
    check("D5 absPath 已更新", eng["absTail"], "c.png")
    check("D6 索引条数不变", eng["count"], 3)

    codes = ev(cdp, sid, r"""(async function(){
      async function codeOf(fn) { try { await fn(); return 'OK'; } catch (e) { return e.code || e.message; } }
      const out = {};
      out.illegal = await codeOf(() => VRRename.rename(%s, 'a/b.png'));
      out.illegal2 = await codeOf(() => VRRename.rename(%s, 'a?b.png'));
      out.empty = await codeOf(() => VRRename.rename(%s, '   '));
      out.same = await codeOf(() => VRRename.rename(%s, 'c.png'));
      out.exists = await codeOf(() => VRRename.rename(%s, 'e.png'));
      out.missing = await codeOf(() => VRRename.rename('video-rod/X/u/图片/zzz.png', 'y.png'));
      const d = await VRRename.rename(%s, 'd');
      out.noExt = d.fileName;
      const back = await VRRename.rename('video-rod/X/u/图片/d.png', 'c.png');
      out.back = back.fileName;
      return out;
    })()""" % (json.dumps(C), json.dumps(C), json.dumps(C), json.dumps(C),
                json.dumps(C), json.dumps(C)))
    check("E1 非法字符 → LIB_E_NAME", [codes["illegal"], codes["illegal2"]], ["LIB_E_NAME", "LIB_E_NAME"])
    check("E2 空名/同名 → LIB_E_NAME", [codes["empty"], codes["same"]], ["LIB_E_NAME", "LIB_E_NAME"])
    check("E3 目标已存在 → LIB_E_EXISTS", codes["exists"], "LIB_E_EXISTS")
    check("E4 源不存在 → LIB_E_NOT_FOUND", codes["missing"], "LIB_E_NOT_FOUND")
    check("E5 扩展名保护 d → d.png", [codes["noExt"], codes["back"]], ["d.png", "c.png"])

    # ---------------- 批量删除 ----------------
    dele = ev(cdp, sid, r"""(async function(){
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('libBatch').click();
      const cards = [...document.querySelectorAll('#libGrid .lib-card')];
      const pick = rel => cards.find(c => c.dataset.rel === rel);
      pick(%s).click();
      pick(%s).click();
      const before = document.getElementById('libBatchCount').textContent;
      document.getElementById('libBatchTrash').click();
      await wait(150);
      const mask = document.getElementById('libConfirmMask');
      const confirm = { hidden: mask.hidden,
                        title: document.getElementById('libConfirmTitle').textContent,
                        text: document.getElementById('libConfirmText').textContent };
      document.getElementById('libConfirmOk').click();
      await wait(1000);
      const st = await VRTrash.status();
      const all = await VRDB.getAllFiles();
      const batches = await VRTrash.list();
      return {
        before: before, confirm: confirm,
        mode: document.body.classList.contains('batch-mode'),
        bar: document.getElementById('libBatchBar').hidden,
        cards: document.querySelectorAll('#libGrid .lib-card').length,
        trashCount: st.count,
        index: all.map(f => f.relPath),
        batch: batches.length ? batches[0].batch : '',
        badge: document.getElementById('libTrashCount').textContent
      };
    })()""" % (json.dumps(A), json.dumps(C)))
    check("F1 勾选 2 项并弹确认", [dele["before"], dele["confirm"]["hidden"],
                            "2 项" in dele["confirm"]["text"]], ["已选 2 项", False, True])
    check("F2 确认标题", dele["confirm"]["title"], "批量移到回收站")
    check("F3 删除后退出批量并刷新", [dele["mode"], dele["bar"], dele["cards"]], [False, True, 1])
    check("F4 回收站 count=2", [dele["trashCount"], dele["badge"]], [2, "2"])
    check("F5 索引只留 1 条", dele["index"], [E])

    moved = ev(cdp, sid, r"""(async function(){
""" + FS_HELPER + r"""
      const a = await fsPath('_回收站/' + %s + '/' + %s);
      const c = await fsPath('_回收站/' + %s + '/' + %s);
      const a0 = await fsPath(%s);
      const c0 = await fsPath(%s);
      return { a: a && a.text, c: c && c.text, a0: a0, c0: c0 };
    })()""" % (json.dumps(dele["batch"]), json.dumps(A), json.dumps(dele["batch"]),
                json.dumps(C), json.dumps(A), json.dumps(C)))
    check("F6 文件在回收站批次内", [moved["a"], moved["c"]], ["AAAA", "BBBBBB"])
    check("F7 原路径已清空", [moved["a0"], moved["c0"]], [None, None])

    # ---------------- 权限 ----------------
    perm = ev(cdp, sid, r"""(async function(){
      await VRDB.setHandle('root', null);
      await VRIndex._resetRoot();
      let code = '';
      try { await VRRename.rename(%s, 'c9.png'); } catch (e) { code = e.code || e.message; }
      const root = await navigator.storage.getDirectory();
      const r = await root.getDirectoryHandle('batch-test');
      await VRIndex.setRoot(r, 'D:\\fake\\video-rod');
      return code;
    })()""" % json.dumps(C))
    check("G1 无句柄 → LIB_E_NO_PERM", perm, "LIB_E_NO_PERM")

    # 清理
    ev(cdp, sid, r"""(async function(){
      await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
      await VRDB.setHandle('root', null);
      await VRDB.setSetting('rootAbs', '');
      await VRIndex._resetRoot();
      const root = await navigator.storage.getDirectory();
      try { await root.removeEntry('batch-test', { recursive: true }); } catch (e) { /* 忽略 */ }
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
