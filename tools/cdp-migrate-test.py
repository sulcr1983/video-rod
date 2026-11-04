# video-rod S1b 迁移验收（OPFS 句柄注入，绕开原生目录选择器）
#
# 为什么要 OPFS：showDirectoryPicker 无法用 CDP 自动点。用
#   navigator.storage.getDirectory()
# 造真实 FSA 目录树，把句柄直接喂给 VRMigrate，走的是同一套
# createWritable / getFile / removeEntry 代码路径。
#
# 前置：
#   1) python -m http.server 18080（test-site）
#   2) Chrome for Testing --remote-debugging-port=<port> --load-extension=E:\test\video-rod
# 用法：VR_CDP=http://127.0.0.1:9344 python tools/cdp-migrate-test.py
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

results = []
MB = 1024 * 1024


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name +
          ("" if ok else f"   got={got!r} expect={expect!r}"))


UTIL_JS = r"""
window.__migUtil = {
  write: async function (dir, name, size, byte) {
    const h = await dir.getFileHandle(name, {create: true});
    const w = await h.createWritable();
    const chunk = new Uint8Array(65536); chunk.fill(byte);
    let left = size;
    while (left > 0) {
      const n = Math.min(left, chunk.length);
      await w.write(n === chunk.length ? chunk : chunk.subarray(0, n));
      left -= n;
    }
    await w.close();
  },
  exists: async function (dir, name) {
    try { await dir.getFileHandle(name); return true; } catch (e) {}
    try { await dir.getDirectoryHandle(name); return true; } catch (e) {}
    return false;
  },
  media: async function (dir) {
    const l = await VRMigrate.listFiles(dir);
    return l.map(x => ({rel: x.rel, size: x.size}));
  }
};
"""

SETUP_JS = r"""
(async function () {
  const rd = await navigator.storage.getDirectory();
  for (const n of ['mig-src', 'mig-dst', 'mig-parent', 'mig-rest']) {
    try { await rd.removeEntry(n, {recursive: true}); } catch (e) {}
  }
  await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
  __UTIL__

  const U = window.__migUtil;
  const src = await rd.getDirectoryHandle('mig-src', {create: true});
  const sub = await src.getDirectoryHandle('sub', {create: true});
  await U.write(sub, 'clip.mp4', SIZE_CLIP, 7);
  await U.write(src, 'pic.jpg', SIZE_PIC, 11);
  await U.write(src, 'note.part', 4096, 3);
  await U.write(src, 'readme.txt', 1024, 5);
  const mig = await src.getDirectoryHandle('_migration', {create: true});
  await U.write(mig, 'log.json', 128, 1);

  window.__mig = {rd: rd, src: src, dst: await rd.getDirectoryHandle('mig-dst', {create: true})};
  return {
    files: (await U.media(src)).map(x => x.rel).sort(),
    clip: SIZE_CLIP, pic: SIZE_PIC
  };
})()
"""


def ev(cdp, sid, js):
    r = cdp.eval(js, sid)
    if isinstance(r, dict) and "__error" in r:
        raise RuntimeError(r["__error"])
    return r


def main():
    cdp = Cdp()
    ext_id, _ = find_ext_id(cdp)
    check("A1 扩展已加载", bool(ext_id), True)
    if not ext_id:
        return finish(cdp)

    tid = cdp.send("Target.createTarget", {"url": f"chrome-extension://{ext_id}/options.html"})["targetId"]
    sid = cdp.attach(tid)
    cdp.send("Runtime.enable", {}, sid)
    cdp.send("Page.enable", {}, sid)
    cdp.wait_js(sid, "typeof VRMigrate === 'object' && typeof VRDB === 'object'", 8.0)
    cdp.send("Page.bringToFront", {}, sid)

    mods = ev(cdp, sid, "({m: typeof VRMigrate, d: typeof VRDB, s: typeof VRSettings})")
    check("A2 引擎与依赖已加载", mods, {"m": "object", "d": "object", "s": "object"})
    if not mods or mods.get("m") != "object":
        return finish(cdp)

    # ---------------- B 换根：扫描 / 预演 ----------------

    sizes = {"SIZE_CLIP": 2 * MB + 123, "SIZE_PIC": 300 * 1024 + 7}
    setup = ev(cdp, sid, SETUP_JS.replace("__UTIL__", UTIL_JS)
               .replace("SIZE_CLIP", str(sizes["SIZE_CLIP"]))
               .replace("SIZE_PIC", str(sizes["SIZE_PIC"])))
    check("B1 造树：只列出媒体文件", setup["files"], ["pic.jpg", "sub/clip.mp4"])

    plan = ev(cdp, sid, r"""
    (async function () {
      const m = window.__mig;
      const p = await VRMigrate.planRebase(m.src, m.dst, {targetMode: 'system'});
      window.__mig.plan = p;
      return {counts: p.counts, total: p.totalBytes,
              items: p.items.map(i => ({from: i.from, to: i.to, action: i.action, size: i.size}))};
    })()
    """)
    check("B2 预演：2 条可迁移", plan["counts"]["move"], 2)
    check("B3 预演：跳过/冲突/阻断均为 0",
          [plan["counts"]["skip"], plan["counts"]["conflict"], plan["counts"]["blocked"]], [0, 0, 0])
    check("B4 预演：总字节数正确", plan["total"], sizes["SIZE_CLIP"] + sizes["SIZE_PIC"])

    # 预演不落盘
    untouched = ev(cdp, sid, r"""
    (async function () {
      const m = window.__mig, U = window.__migUtil;
      return {dst: (await U.media(m.dst)).length, src: (await U.media(m.src)).length};
    })()
    """)
    check("B5 预演不改动任何文件", untouched, {"dst": 0, "src": 2})

    # ---------------- C 执行 + 校验 ----------------

    run = ev(cdp, sid, r"""
    (async function () {
      const m = window.__mig;
      const log = await VRMigrate.run(m.plan, function () {});
      window.__mig.log = log;
      const U = window.__migUtil;
      return {done: log.done.length, aborted: log.aborted, failed: log.failed.length,
              dst: (await U.media(m.dst)).map(x => x.rel).sort(),
              dstSizes: (await U.media(m.dst)).map(x => x.size).sort((a, b) => a - b),
              src: (await U.media(m.src)).map(x => x.rel),
              leftovers: {part: await U.exists(m.src, 'note.part'),
                          txt: await U.exists(m.src, 'readme.txt'), mig: await U.exists(m.src, '_migration')}};
    })()
    """)
    check("C1 执行：完成 2 条", run["done"], 2)
    check("C2 执行：未中止、无失败", [run["aborted"], run["failed"]], [False, 0])
    check("C3 目标侧结构保持", run["dst"], ["pic.jpg", "sub/clip.mp4"])
    check("C4 目标侧大小一致", run["dstSizes"], sorted([sizes["SIZE_PIC"], sizes["SIZE_CLIP"]]))
    check("C5 源侧媒体已清空", run["src"], [])
    check("C6 非媒体/临时/私有目录未动", run["leftovers"], {"part": True, "txt": True, "mig": True})

    # ---------------- D 回滚 ----------------

    rollback = ev(cdp, sid, r"""
    (async function () {
      const r = await VRMigrate.rollback(window.__mig.log.id);
      window.__mig.logRolled = r.log;
      const m = window.__mig, U = window.__migUtil;
      return {ok: r.rolledBack, restored: r.restored, failed: r.failed.length,
              src: (await U.media(m.src)).map(x => x.rel).sort(),
              dst: (await U.media(m.dst)).map(x => x.rel).length};
    })()
    """)
    check("D1 回滚成功", [rollback["ok"], rollback["restored"], rollback["failed"]], [True, 2, 0])
    check("D2 回滚：源已复原", rollback["src"], ["pic.jpg", "sub/clip.mp4"])
    check("D3 回滚：目标侧已清空", rollback["dst"], 0)

    # ---------------- E 冲突口径 ----------------

    conflict = ev(cdp, sid, r"""
    (async function () {
      const m = window.__mig, U = window.__migUtil;
      await U.write(m.dst, 'pic.jpg', 100, 9);                       // 同名不同大小 → conflict
      const dsub = await m.dst.getDirectoryHandle('sub', {create: true});
      await U.write(dsub, 'clip.mp4', SIZE_CLIP, 8);                 // 同名同大小 → skip
      const p = await VRMigrate.planRebase(m.src, m.dst, {});
      return {counts: p.counts, actions: p.items.map(i => i.from + ':' + i.action).sort()};
    })()
    """.replace("SIZE_CLIP", str(sizes["SIZE_CLIP"])))
    check("E1 冲突/跳过计数正确",
          [conflict["counts"]["move"], conflict["counts"]["skip"], conflict["counts"]["conflict"]], [0, 1, 1])
    check("E2 逐条动作正确", conflict["actions"], ["pic.jpg:conflict", "sub/clip.mp4:skip"])

    # 冲突断言后恢复干净目标侧（稍后 rename 用不到 dst，但保持整洁）
    ev(cdp, sid, r"""
    (async function () {
      const m = window.__mig;
      try { await m.dst.removeEntry('pic.jpg'); } catch (e) {}
      try { await m.dst.removeEntry('sub', {recursive: true}); } catch (e) {}
      return 1;
    })()
    """)

    # ---------------- F 改子目录名 + 索引同步 ----------------

    rename_plan = ev(cdp, sid, r"""
    (async function () {
      const rd = window.__mig.rd, U = window.__migUtil;
      const parent = await rd.getDirectoryHandle('mig-parent', {create: true});
      const old = await parent.getDirectoryHandle('video-rod', {create: true});
      const p1 = await old.getDirectoryHandle('B站', {create: true});
      const p2 = await p1.getDirectoryHandle('影视飓风(@946974)', {create: true});
      const p3 = await p2.getDirectoryHandle('视频', {create: true});
      await U.write(p3, 'a.mp4', 500 * 1024, 4);

      const rel = 'video-rod/B站/影视飓风(@946974)/视频/a.mp4';
      await VRDB.putFiles([{relPath: rel, absPath: 'D:/DL/' + rel, platform: 'bilibili',
        platformName: 'B站', creatorFull: '影视飓风(@946974)', creatorId: '946974',
        type: 'video', fileName: 'a.mp4', size: 500 * 1024, mtime: Date.now(),
        starred: 1, tags: ['测试'], state: 'ok'}]);

      const p = await VRMigrate.planRenameSubdir(parent, 'video-rod', 'rod');
      window.__mig.plan2 = p;
      window.__mig.parent = parent;
      return {counts: p.counts, items: p.items.map(i => i.from + ' -> ' + i.to)};
    })()
    """)
    check("F1 子目录改名：1 条可迁移", rename_plan["counts"]["move"], 1)
    check("F2 目标路径正确", rename_plan["items"], ["video-rod/B站/影视飓风(@946974)/视频/a.mp4 -> "
                                                   "rod/B站/影视飓风(@946974)/视频/a.mp4"])

    rename_run = ev(cdp, sid, r"""
    (async function () {
      const log = await VRMigrate.run(window.__mig.plan2, function () {});
      const parent = window.__mig.parent;
      let oldExists = true;
      try { await parent.getDirectoryHandle('video-rod'); } catch (e) { oldExists = false; }
      const rod = await parent.getDirectoryHandle('rod');
      const files = (await VRMigrate.listFiles(rod)).map(x => x.rel);
      const newEntry = await VRDB.getFile('rod/B站/影视飓风(@946974)/视频/a.mp4');
      const oldEntry = await VRDB.getFile('video-rod/B站/影视飓风(@946974)/视频/a.mp4');
      return {done: log.done.length, aborted: log.aborted, oldExists: oldExists, files: files,
              idxNew: !!newEntry, idxOld: !!oldEntry,
              starred: newEntry && newEntry.starred, tags: newEntry && newEntry.tags};
    })()
    """)
    check("F3 改名执行完成", [rename_run["done"], rename_run["aborted"]], [1, False])
    check("F4 新目录就位", rename_run["files"], ["B站/影视飓风(@946974)/视频/a.mp4"])
    check("F5 旧目录已清理", rename_run["oldExists"], False)
    check("F6 索引 relPath 已同步", [rename_run["idxNew"], rename_run["idxOld"]], [True, False])
    check("F7 索引星标/标签保留", [rename_run["starred"], rename_run["tags"]], [1, ["测试"]])

    # ---------------- G 整理旧文件 ----------------

    rest = ev(cdp, sid, r"""
    (async function () {
      const rd = window.__mig.rd, U = window.__migUtil;
      const dir = await rd.getDirectoryHandle('mig-rest', {create: true});
      await U.write(dir, 'fan.mp4', 400 * 1024, 6);
      await U.write(dir, 'note.txt', 100, 2);
      const p = await VRMigrate.planRestructure(dir,
        [{filename: 'D:/dl/fan.mp4', url: 'https://www.bilibili.com/video/BV1'}]);
      window.__mig.plan3 = p;
      window.__mig.rest = dir;
      return {counts: p.counts, to: p.items.map(i => i.to)};
    })()
    """)
    check("G1 整理：1 条可迁移（txt 不收）", rest["counts"]["move"], 1)
    check("G2 目标三段路径正确", rest["to"], ["video-rod/B站/待整理/视频/fan.mp4"])

    rest_run = ev(cdp, sid, r"""
    (async function () {
      const log = await VRMigrate.run(window.__mig.plan3, function () {});
      const dir = window.__mig.rest, U = window.__migUtil;
      const moved = await (async function () {
        try {
          const sub = await dir.getDirectoryHandle('video-rod');
          const p1 = await sub.getDirectoryHandle('B站');
          const p2 = await p1.getDirectoryHandle('待整理');
          const p3 = await p2.getDirectoryHandle('视频');
          await p3.getFileHandle('fan.mp4');
          return true;
        } catch (e) { return false; }
      })();
      return {done: log.done.length, aborted: log.aborted, moved: moved,
              srcStill: await U.exists(dir, 'fan.mp4'), txtStill: await U.exists(dir, 'note.txt')};
    })()
    """)
    check("G3 整理执行完成", [rest_run["done"], rest_run["aborted"]], [1, False])
    check("G4 文件已落到三段目录", rest_run["moved"], True)
    check("G5 源已删、非媒体保留", [rest_run["srcStill"], rest_run["txtStill"]], [False, True])

    # ---------------- H 校验函数 ----------------

    verify = ev(cdp, sid, r"""
    (async function () {
      const m = window.__mig, U = window.__migUtil;
      await U.write(m.dst, 'same.bin', 70000, 1);
      await U.write(m.dst, 'diff.bin', 70000, 2);
      await U.write(m.dst, 'trunc.bin', 65000, 1);
      const same = await (await m.dst.getFileHandle('same.bin')).getFile();
      const diff = await (await m.dst.getFileHandle('diff.bin')).getFile();
      const trunc = await (await m.dst.getFileHandle('trunc.bin')).getFile();
      return {self: await VRMigrate._sampleEqual(same, same),
              diff: await VRMigrate._sampleEqual(same, diff),
              trunc: await VRMigrate._sampleEqual(same, trunc)};
    })()
    """)
    check("H1 采样校验：同一文件通过", verify["self"], True)
    check("H2 采样校验：内容不同被拒", verify["diff"], False)
    check("H3 采样校验：截断被拒", verify["trunc"], False)

    # ---------------- I 设置页面板 ----------------

    ui = ev(cdp, sid, r"""
    (async function () {
      const btn = document.getElementById('vrLibMigrate');
      const panel = document.getElementById('vrLibMigPanel');
      const out = {exists: !!btn, disabled: btn ? btn.disabled : null,
                   panelHiddenBefore: panel ? panel.hidden : null};
      if (btn) { btn.click(); }
      await new Promise(r => setTimeout(r, 200));
      out.panelHiddenAfter = panel ? panel.hidden : null;
      out.kinds = Array.from(document.querySelectorAll('#vrLibMigKind option')).map(o => o.value);
      out.runDisabled = document.getElementById('vrLibMigRun').disabled;
      // 没选目录就预演 → 应给出引导文案而不是崩掉
      document.getElementById('vrLibMigPlan').click();
      await new Promise(r => setTimeout(r, 600));
      out.state = document.getElementById('vrLibMigState').textContent.trim();
      return out;
    })()
    """)
    check("I1 迁移按钮可用", [ui["exists"], ui["disabled"]], [True, False])
    check("I2 面板可展开", [ui["panelHiddenBefore"], ui["panelHiddenAfter"]], [True, False])
    check("I3 三种迁移方式", ui["kinds"], ["rename-subdir", "rebase", "restructure"])
    check("I4 未预演时执行禁用", ui["runDisabled"], True)
    check("I5 缺目录时给引导文案", "请先选择" in (ui["state"] or ""), True)

    # ---------------- 清理 ----------------

    ev(cdp, sid, r"""
    (async function () {
      const rd = await navigator.storage.getDirectory();
      for (const n of ['mig-src', 'mig-dst', 'mig-parent', 'mig-rest']) {
        try { await rd.removeEntry(n, {recursive: true}); } catch (e) {}
      }
      await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
      await VRDB.setSetting('migrateLog:last', null);
      return 1;
    })()
    """)

    return finish(cdp)


def finish(cdp):
    errs = cdp.errors()
    check("J1 控制台无 error/exception", errs, [])
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
