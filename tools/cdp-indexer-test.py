# video-rod S2 索引验收（OPFS 句柄注入 + 一次真实下载）
#
# 覆盖：
#   A 模块加载 / 根绑定
#   B 全量扫描（媒体/跳过规则/元数据/星标保留）
#   C 快照（落盘 / 结构 / 清库后恢复）
#   D 缺失语义（标 missing、不删条目）+ reconcile
#   E 设置页维护按钮
#   F 无句柄降级（full/snapshot 报 LIB_E_NO_PERM，downloads 仍可用）
#   G downloads 源（真实下载 → 清库 → 重建）
#
# 前置：
#   1) python -m http.server 18080（test-site）
#   2) Chrome for Testing --remote-debugging-port=<port> --load-extension=E:\test\video-rod
# 用法：VR_CDP=http://127.0.0.1:9346 python tools/cdp-indexer-test.py
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

results = []
KB = 1024
SIZE_A = 300 * KB + 11
SIZE_P = 120 * KB + 7
SIZE_S = 80 * KB + 3


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


UTIL_JS = r"""
window.__idxUtil = {
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
  mkdirp: async function (rootDir, segs) {
    let d = rootDir;
    for (const s of segs) { d = await d.getDirectoryHandle(s, {create: true}); }
    return d;
  },
  dirAt: async function (rootDir, segs) {
    let d = rootDir;
    for (const s of segs) { d = await d.getDirectoryHandle(s); }
    return d;
  }
};
"""

SETUP_JS = r"""
(async function () {
  const rd = await navigator.storage.getDirectory();
  try { await rd.removeEntry('idx-root', {recursive: true}); } catch (e) {}
  __UTIL__

  const U = window.__idxUtil;
  const rootDir = await rd.getDirectoryHandle('idx-root', {create: true});

  const vDir = await U.mkdirp(rootDir, ['B站', '影视飓风(@946974)', '视频']);
  await U.write(vDir, 'a.mp4', SIZE_A, 7);
  const iDir = await U.mkdirp(rootDir, ['B站', '影视飓风(@946974)', '图片']);
  await U.write(iDir, 'p.jpg', SIZE_P, 11);
  const aDir = await U.mkdirp(rootDir, ['其他网页', 'site', '音频']);
  await U.write(aDir, 's.mp3', SIZE_S, 13);

  await U.write(rootDir, 'readme.txt', 100, 1);
  const verifyDir = await U.mkdirp(rootDir, ['_verify']);
  await U.write(verifyDir, 'x.mp4', 1000, 2);
  const libDir = await U.mkdirp(rootDir, ['_library']);
  await U.write(libDir, 'index-20260101.json', 50, 3);
  await U.write(rootDir, 'part.mp4.part', 100, 4);

  await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
  await VRDB.putFiles([{
    relPath: 'video-rod/B站/影视飓风(@946974)/视频/a.mp4',
    absPath: 'D:/DL/idx-root/B站/影视飓风(@946974)/视频/a.mp4',
    platform: 'bilibili', platformName: 'B站',
    creatorFull: '影视飓风(@946974)', creatorId: '946974',
    type: 'video', fileName: 'a.mp4',
    size: SIZE_A, mtime: 1700000000000,
    starred: 1, tags: ['收藏'], state: 'ok'
  }]);

  window.__idx = {rd: rd, root: rootDir};
  return {ok: true};
})()
""".replace("SIZE_A", str(SIZE_A)).replace("SIZE_P", str(SIZE_P)).replace("SIZE_S", str(SIZE_S))


def main():
    global UTIL_JS
    cdp = Cdp()
    ext_id, _ = find_ext_id(cdp)
    check("A1 扩展已加载", bool(ext_id), True)
    if not ext_id:
        return finish(cdp)

    tid = cdp.send("Target.createTarget", {"url": f"chrome-extension://{ext_id}/options.html"})["targetId"]
    sid = cdp.attach(tid)
    cdp.send("Runtime.enable", {}, sid)
    cdp.send("Page.enable", {}, sid)
    time.sleep(2.0)
    cdp.send("Page.bringToFront", {}, sid)

    mods = ev(cdp, sid, "({i: typeof VRIndex, d: typeof VRDB, p: typeof VRPath})")
    check("A2 索引模块与依赖已加载", mods, {"i": "object", "d": "object", "p": "object"})
    if not mods or mods.get("i") != "object":
        return finish(cdp)

    # ---------------- 设置 + 全量扫描 ----------------

    setup = ev(cdp, sid, SETUP_JS.replace("__UTIL__", UTIL_JS))
    check("A3 OPFS 测试树就绪", setup.get("ok"), True)

    bound = ev(cdp, sid, r"""
    (async function () {
      const r = await VRIndex.setRoot(window.__idx.root, 'D:/DL/idx-root', 'video-rod');
      return r;
    })()
    """)
    check("A4 根绑定成功", bound, {"absRoot": "D:/DL/idx-root", "prefix": "video-rod"})

    full = ev(cdp, sid, r"""
    (async function () {
      const r = await VRIndex.build({mode: 'full', onProgress: function () {}});
      const files = await VRDB.getAllFiles();
      const a = files.find(f => f.relPath.endsWith('/a.mp4'));
      const rels = files.map(f => f.relPath).sort();
      return {r: r, count: files.length, rels: rels,
              a: a && {starred: a.starred, tags: a.tags, abs: a.absPath,
                       platform: a.platform, creatorId: a.creatorId,
                       type: a.type, size: a.size, state: a.state}};
    })()
    """)
    check("B1 全量扫描：3 个媒体文件", [full["r"]["total"], full["r"]["ok"], full["r"]["missing"]], [3, 3, 0])
    check("B2 只收媒体、跳过私有/临时目录", full["rels"], [
        "video-rod/B站/影视飓风(@946974)/图片/p.jpg",
        "video-rod/B站/影视飓风(@946974)/视频/a.mp4",
        "video-rod/其他网页/site/音频/s.mp3",
    ])
    check("B3 重建保留星标/标签", [full["a"]["starred"], full["a"]["tags"]], [1, ["收藏"]])
    check("B4 绝对路径按根重算", full["a"]["abs"],
          "D:/DL/idx-root/B站/影视飓风(@946974)/视频/a.mp4")
    check("B5 元数据反解正确",
          [full["a"]["platform"], full["a"]["creatorId"], full["a"]["type"], full["a"]["size"]],
          ["bilibili", "946974", "video", SIZE_A])
    check("B6 条目状态为 ok", full["a"]["state"], "ok")

    # ---------------- 快照 ----------------

    snap = ev(cdp, sid, r"""
    (async function () {
      const p = await VRIndex.snapshot();
      const dir = await window.__idx.root.getDirectoryHandle('_library');
      const name = p.split('/').pop();
      const f = await (await dir.getFileHandle(name)).getFile();
      const json = JSON.parse(await f.text());
      return {path: p, name: name, version: json.version, count: json.count,
              subdir: json.subdir, at: json.at,
              rels: (json.files || []).map(x => x.relPath).sort()};
    })()
    """)
    check("C1 快照文件名符合命名", [snap["name"].startswith("index-"), snap["name"].endswith(".json")], [True, True])
    check("C2 快照结构：version/count/subdir", [snap["version"], snap["count"], snap["subdir"]], [1, 3, "video-rod"])
    check("C3 快照含全部条目", len(snap["rels"]), 3)

    restored = ev(cdp, sid, r"""
    (async function () {
      await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
      const before = await VRDB.count();
      const r = await VRIndex.build({mode: 'snapshot'});
      const files = await VRDB.getAllFiles();
      const a = files.find(f => f.relPath.endsWith('/a.mp4'));
      return {before: before, r: r, count: files.length,
              starred: a && a.starred, tags: a && a.tags,
              abs: a && a.absPath};
    })()
    """)
    check("C4 清库后索引为 0", restored["before"], 0)
    check("C5 快照恢复 3 条", [restored["r"]["ok"], restored["count"]], [3, 3])
    check("C6 恢复保留星标/标签", [restored["starred"], restored["tags"]], [1, ["收藏"]])
    check("C7 恢复后绝对路径按当前根重算", restored["abs"],
          "D:/DL/idx-root/B站/影视飓风(@946974)/视频/a.mp4")

    # ---------------- 缺失语义 + reconcile ----------------

    missing = ev(cdp, sid, r"""
    (async function () {
      const imgDir = await window.__idxUtil.dirAt(window.__idx.root,
        ['B站', '影视飓风(@946974)', '图片']);
      await imgDir.removeEntry('p.jpg');

      await VRDB.putFiles([{
        relPath: 'video-rod/B站/影视飓风(@946974)/视频/ghost.mp4',
        absPath: 'D:/DL/idx-root/B站/影视飓风(@946974)/视频/ghost.mp4',
        platform: 'bilibili', platformName: 'B站',
        creatorFull: '影视飓风(@946974)', creatorId: '946974',
        type: 'video', fileName: 'ghost.mp4', size: 123, mtime: 1700000000000,
        starred: 0, tags: [], state: 'ok'
      }]);

      const r = await VRIndex.build({mode: 'full'});
      const files = await VRDB.getAllFiles();
      const byRel = {};
      files.forEach(f => { byRel[f.relPath.split('/').pop()] = f.state; });
      return {r: r, count: files.length, states: byRel};
    })()
    """)
    check("D1 扫描 2 条、标缺失 2 条", [missing["r"]["total"], missing["r"]["missing"]], [2, 2])
    check("D2 缺失条目不删除（总数 4）", missing["count"], 4)
    check("D3 缺失状态正确",
          [missing["states"].get("p.jpg"), missing["states"].get("ghost.mp4"),
           missing["states"].get("a.mp4")], ["missing", "missing", "ok"])

    rec = ev(cdp, sid, r"""
    (async function () {
      const r = await VRIndex.reconcile();
      const files = await VRDB.getAllFiles();
      return {missing: r.missing.sort(), checked: r.checked, unknown: r.unknown,
              count: files.length};
    })()
    """)
    check("D4 reconcile 找到两个缺失", rec["missing"], [
        "video-rod/B站/影视飓风(@946974)/图片/p.jpg",
        "video-rod/B站/影视飓风(@946974)/视频/ghost.mp4",
    ])
    check("D5 reconcile 不删条目", rec["count"], 4)

    # ---------------- 设置页维护入口 ----------------

    ui = ev(cdp, sid, r"""
    (async function () {
      const ids = ['vrLibIdxBuild', 'vrLibIdxSnap', 'vrLibIdxFull', 'vrLibIdxMsg'];
      const out = {exists: ids.every(i => !!document.getElementById(i))};
      document.getElementById('vrLibIdxBuild').click();
      let t = '';
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 150));
        t = document.getElementById('vrLibIdxMsg').textContent.trim();
        if (t.indexOf('重建完成') >= 0) break;
      }
      out.buildMsg = t;
      document.getElementById('vrLibIdxSnap').click();
      let s = '';
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 150));
        s = document.getElementById('vrLibIdxMsg').textContent.trim();
        if (s.indexOf('快照已写入') >= 0) break;
      }
      out.snapMsg = s;
      out.status = document.getElementById('vrLibIndex').textContent.trim();
      return out;
    })()
    """)
    check("E1 三个维护按钮存在", ui["exists"], True)
    check("E2 重建按钮给出结果", "重建完成" in (ui["buildMsg"] or ""), True)
    check("E3 写快照按钮给出路径", "index-" in (ui["snapMsg"] or ""), True)
    check("E4 状态行显示已入库", "已入库" in (ui["status"] or ""), True)

    # ---------------- 无句柄降级 ----------------

    degrade = ev(cdp, sid, r"""
    (async function () {
      await VRDB.setHandle('root', null);
      VRIndex._resetRoot();
      async function code(fn) {
        try { await fn(); return 'no-error'; }
        catch (e) { return e.vrCode || e.name || String(e); }
      }
      return {
        full: await code(() => VRIndex.build({mode: 'full'})),
        snap: await code(() => VRIndex.snapshot()),
        dl: await code(() => VRIndex.build({mode: 'downloads'}))
      };
    })()
    """)
    check("F1 无句柄：全量扫描报授权错误", degrade["full"], "LIB_E_NO_PERM")
    check("F2 无句柄：写快照报授权错误", degrade["snap"], "LIB_E_NO_PERM")
    check("F3 无句柄：downloads 源仍可用", degrade["dl"], "no-error")

    # ---------------- downloads 源（真实下载） ----------------

    dl = ev(cdp, sid, r"""
    (async function () {
      const read = () => new Promise(r => chrome.storage.local.get('vrLibSettings', r));
      let s = (await read()).vrLibSettings || {};
      if (!s.detectedRoot && typeof VRSettings === 'object') {
        VRSettings.verify();      // 微下载反推真实下载根目录
        for (let i = 0; i < 40; i++) {
          await new Promise(r2 => setTimeout(r2, 250));
          s = (await read()).vrLibSettings || {};
          if (s.detectedRoot) break;
        }
      }
      if (!s.detectedRoot) { return {error: 'no detectedRoot'}; }
      const subdir = s.subdir || 'video-rod';
      const absRoot = String(s.detectedRoot).replace(/\\/g, '/') + '/' + subdir;

      const rel = subdir + '/其他网页/127.0.0.1/视频/idx-dl.mp4';
      const url = 'http://127.0.0.1:18080/media/test.mp4';
      const id = await new Promise(r => chrome.downloads.download(
        {url: url, filename: rel, conflictAction: 'overwrite'}, r));
      if (!id) { return {error: 'download failed'}; }

      let d = null;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 250));
        const list = await new Promise(r => chrome.downloads.search({id: id}, r));
        d = list && list[0];
        if (d && d.state === 'complete') break;
      }
      if (!d || d.state !== 'complete') { return {error: 'download not complete'}; }

      await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
      await VRIndex.setRoot(null, absRoot, subdir);
      const r = await VRIndex.build({mode: 'downloads'});
      const files = await VRDB.getAllFiles();
      const hit = files.find(f => f.downloadId === id);

      await new Promise(r2 => chrome.downloads.removeFile(id, r2));
      await new Promise(r2 => chrome.downloads.erase({id: id}, r2));
      await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));

      return {id: id, absRoot: absRoot, abs: d.filename, r: r,
              count: files.length,
              rels: files.map(f => f.relPath).slice(0, 10),
              hit: hit && {
        relPath: hit.relPath, absPath: hit.absPath, type: hit.type,
        platform: hit.platform, size: hit.size, state: hit.state}};
    })()
    """)
    if dl.get("error"):
        check("G1 真实下载可用于验证", dl.get("error"), None)
    else:
        if not dl.get("hit"):
            print("      G 调试:", json.dumps(dl, ensure_ascii=False)[:800])
        rel_ok = (dl["hit"] or {}).get("relPath", "").startswith("video-rod/其他网页/")
        check("G1 downloads 源重建出条目", bool(dl.get("hit")), True)
        check("G2 relPath 含子目录前缀", rel_ok, True)
        check("G3 absPath 用下载记录真名", (dl["hit"] or {}).get("absPath"),
              dl["abs"].replace("\\", "/"))
        check("G4 元数据正确", [(dl["hit"] or {}).get("type"), (dl["hit"] or {}).get("platform")],
              ["video", "web"])
        check("G5 大小已记录", ((dl["hit"] or {}).get("size") or 0) > 0, True)

    # ---------------- 清理 ----------------

    ev(cdp, sid, r"""
    (async function () {
      try { await window.__idx.rd.removeEntry('idx-root', {recursive: true}); } catch (e) {}
      await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
      await VRDB.setHandle('root', null);
      await VRDB.setSetting('rootAbs', '');
      await VRDB.setSetting('rootPrefix', '');
      // 清掉本脚本历史遗留的 idx-dl 下载（含上轮 data: 变 .txt 的那条）
      const olds = await new Promise(r => chrome.downloads.search({filenameRegex: 'idx-dl'}, r));
      for (const d of olds || []) {
        await new Promise(r2 => chrome.downloads.removeFile(d.id, r2));
        await new Promise(r2 => chrome.downloads.erase({id: d.id}, r2));
      }
      return 1;
    })()
    """)

    return finish(cdp)


def finish(cdp):
    errs = cdp.errors()
    check("H1 控制台无 error/exception", errs, [])
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
