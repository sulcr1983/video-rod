#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""资源库 IndexedDB 快照 / 恢复 / 清理测试假数据。

用途：
  1. 真实 profile（9480）跑真实站点测试前备份，跑完恢复；
  2. 清理 e2e 种入的假数据（absPath 以 D:/f/ 或 D:/fake/ 开头）；
  3. 清掉测试留下的 displayName='功能测试改名' / e2e标签。

用法：
  python tools/vr-db-snapshot.py status --port 9480
  python tools/vr-db-snapshot.py backup --port 9480 --tag pre-live
  python tools/vr-db-snapshot.py restore --port 9480 --file .work/db-snapshots/xxx.json
  python tools/vr-db-snapshot.py clean-fixtures --port 9480 --dry-run
  python tools/vr-db-snapshot.py clean-fixtures --port 9480 --apply

不引入新依赖：复用现有 CDP + VRDB API。Playwright 是更成熟的扩展测试方案，
但需要新增依赖，按项目铁律先不装；当前用专用 profile + 快照/恢复即可。
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime

from websocket import create_connection

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PORT = 9480
DEFAULT_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"
SNAP_DIR = os.path.join(ROOT, ".work", "db-snapshots")
TEST_DISPLAY = "功能测试改名"


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=8))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=120)
        self.mid = 0

    def send(self, method, params=None, sid=None):
        self.mid += 1
        i = self.mid
        msg = {"id": i, "method": method, "params": params or {}}
        if sid:
            msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == i:
                if "error" in r:
                    raise RuntimeError("%s: %s" % (method, r["error"]))
                return r.get("result", {})

    def ev(self, js, sid, timeout=60):
        self.ws.settimeout(timeout)
        r = self.send("Runtime.evaluate", {
            "expression": js, "returnByValue": True, "awaitPromise": True
        }, sid)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            raise RuntimeError(((d.get("exception") or {}).get("description") or d.get("text") or "JS error")[:500])
        return r.get("result", {}).get("value")

    def open_library(self, ext, wait=4.0):
        tid = self.send("Target.createTarget", {
            "url": "chrome-extension://%s/library.html" % ext
        })["targetId"]
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        self.send("Page.enable", {}, sid)
        time.sleep(wait)
        # 确认 VRDB 已就绪，避免在扩展页还没 boot 时读空
        for _ in range(20):
            try:
                if self.ev("typeof VRDB !== 'undefined' && typeof VRDB.getAllFiles === 'function'", sid):
                    break
            except Exception:
                pass
            time.sleep(0.5)
        return tid, sid

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def backup_payload(ev):
    js = r"""(async()=>{
      const files = await VRDB.getAllFiles();
      let favs = [];
      try { favs = await VRDB.getSetting('vrFavs', []); } catch(e) {}
      let settings = null;
      try {
        settings = await new Promise(r => chrome.storage.local.get('vrLibSettings', d => r(d.vrLibSettings || null)));
      } catch(e) {}
      return JSON.stringify({version:1, at:Date.now(), files:files, favs:favs, settings:settings});
    })()"""
    raw = ev(js)
    if not isinstance(raw, str):
        raise RuntimeError("备份读取失败：VRDB 未返回字符串")
    return json.loads(raw)


def is_test_abs(apath):
    p = str(apath or "").replace("\\", "/").lower()
    return p.startswith("d:/f/") or p.startswith("d:/fake/")


def print_status(rows):
    fake = [r for r in rows if is_test_abs(r.get("absPath"))]
    print("总条目 : %d" % len(rows))
    print("真实路径 : %d" % (len(rows) - len(fake)))
    print("测试假数据 : %d" % len(fake))
    for r in fake[:12]:
        print("  FAKE %s | %s" % (r.get("relPath"), r.get("absPath")))
    dirty_display = [r for r in rows if r.get("displayName") == TEST_DISPLAY]
    dirty_tags = [r for r in rows if any(str(t).lower() == "e2e标签" for t in (r.get("tags") or []))]
    print("测试改名残留 : %d" % len(dirty_display))
    print("e2e 标签残留 : %d" % len(dirty_tags))


def cmd_status(c, a, tid, sid):
    rows = json.loads(c.ev("VRDB.getAllFiles().then(r=>JSON.stringify(r))", sid))
    print_status(rows)


def cmd_backup(c, a, tid, sid):
    snap = backup_payload(lambda js: c.ev(js, sid))
    os.makedirs(SNAP_DIR, exist_ok=True)
    tag = a.tag or datetime.now().strftime("%Y%m%d-%H%M%S")
    path = os.path.join(SNAP_DIR, "vr-library-%s.json" % tag)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)
    print("已备份 %d 条 -> %s" % (len(snap.get("files") or []), path))
    if a.print_file:
        print(path)


def cmd_restore(c, a, tid, sid):
    if not a.file:
        raise RuntimeError("restore 需要 --file")
    with open(a.file, "r", encoding="utf-8") as f:
        snap = json.load(f)
    payload = json.dumps(snap, ensure_ascii=False)
    js = r"""(async()=>{
      const snap = %s;
      const all = await VRDB.getAllFiles();
      await VRDB.deleteFiles(all.map(f => f.relPath));
      if (snap.files && snap.files.length) { await VRDB.putFiles(snap.files); }
      if (snap.favs) { try { await VRDB.setSetting('vrFavs', snap.favs); } catch(e) {} }
      if (snap.settings) {
        await new Promise(r => chrome.storage.local.set({vrLibSettings: snap.settings}, r));
      }
      const now = await VRDB.getAllFiles();
      return JSON.stringify({count: now.length, expected: (snap.files || []).length});
    })()""" % payload
    raw = c.ev(js, sid)
    print("恢复结果：" + str(raw))
    data = json.loads(raw) if isinstance(raw, str) else {}
    if data.get("count") != data.get("expected"):
        raise RuntimeError("恢复数量不一致：%s" % raw)


def cmd_verify(c, a, tid, sid):
    if not a.file:
        raise RuntimeError("verify 需要 --file")
    with open(a.file, "r", encoding="utf-8") as f:
        snap = json.load(f)
    want = {r.get("relPath") for r in (snap.get("files") or [])}
    rows = json.loads(c.ev("VRDB.getAllFiles().then(r=>JSON.stringify(r))", sid))
    got = {r.get("relPath") for r in rows}
    print("快照 %d 条 / 当前 %d 条" % (len(want), len(got)))
    print("缺失：%d" % len(want - got))
    print("多出：%d" % len(got - want))
    for x in sorted(want - got)[:10]:
        print("  - " + x)
    for x in sorted(got - want)[:10]:
        print("  + " + x)
    if want != got:
        raise RuntimeError("当前库与快照不一致")


def cmd_clean(c, a, tid, sid):
    rows = json.loads(c.ev("VRDB.getAllFiles().then(r=>JSON.stringify(r))", sid))
    fake = [r for r in rows if is_test_abs(r.get("absPath"))]
    print_status(rows)
    if not fake:
        print("没有测试假数据，无需清理。")
        return
    if not a.apply or a.dry_run:
        print("\n[DRY-RUN] 未删除。确认后加 --apply；会自动先备份。")
        return

    # 强制执行前自动备份，避免误删用户数据
    cmd_backup(c, a, tid, sid)

    js = r"""(async()=>{
      const all = await VRDB.getAllFiles();
      const isFake = f => {
        const p = String(f.absPath || '').replace(/\\/g,'/').toLowerCase();
        return p.startsWith('d:/f/') || p.startsWith('d:/fake/');
      };
      const fake = all.filter(isFake);
      let cleaned = 0;
      for (const f of all) {
        if (isFake(f)) { continue; }
        const patch = {};
        if (f.displayName === %s) { patch.displayName = ''; }
        if (Array.isArray(f.tags) && f.tags.some(t => String(t).toLowerCase() === 'e2e标签')) {
          patch.tags = f.tags.filter(t => String(t).toLowerCase() !== 'e2e标签');
        }
        if (Object.keys(patch).length) {
          await VRDB.patchFile(f.relPath, patch);
          cleaned++;
        }
      }
      const keys = fake.map(f => 't:' + f.relPath);
      if (keys.length) {
        await new Promise((res, rej) => {
          const q = indexedDB.open('vr-library');
          q.onsuccess = e => {
            const db = e.target.result;
            const tx = db.transaction('thumb', 'readwrite');
            const st = tx.objectStore('thumb');
            keys.forEach(k => st.delete(k));
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error || new Error('thumb tx'));
          };
          q.onerror = () => rej(q.error || new Error('idb open'));
        });
      }
      await VRDB.deleteFiles(fake.map(f => f.relPath));
      const now = await VRDB.getAllFiles();
      return JSON.stringify({before: all.length, fake: fake.length, cleaned: cleaned, after: now.length});
    })()""" % json.dumps(TEST_DISPLAY, ensure_ascii=False)
    raw = c.ev(js, sid)
    print("清理结果：" + str(raw))
    rows2 = json.loads(c.ev("VRDB.getAllFiles().then(r=>JSON.stringify(r))", sid))
    print_status(rows2)
    if any(is_test_abs(r.get("absPath")) for r in rows2):
        raise RuntimeError("清理后仍存在测试假数据")


def main():
    ap = argparse.ArgumentParser(description="资源库 IndexedDB 快照/恢复/清理")
    ap.add_argument("cmd", choices=["status", "backup", "restore", "verify", "clean-fixtures"])
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--ext", default=DEFAULT_EXT)
    ap.add_argument("--file", default="", help="restore/verify 的快照文件")
    ap.add_argument("--tag", default="", help="backup 文件名标签")
    ap.add_argument("--print-file", action="store_true", help="backup 后只打印文件路径")
    ap.add_argument("--apply", action="store_true", help="clean-fixtures 真正执行；默认 dry-run")
    ap.add_argument("--dry-run", action="store_true", help="clean-fixtures 只预演，不删除（默认行为）")
    a = ap.parse_args()
    if a.apply and a.dry_run:
        ap.error("--apply 与 --dry-run 不能同时使用")

    c = Cdp(a.port)
    tid = sid = None
    try:
        tid, sid = c.open_library(a.ext)
        if a.cmd == "status":
            cmd_status(c, a, tid, sid)
        elif a.cmd == "backup":
            cmd_backup(c, a, tid, sid)
        elif a.cmd == "restore":
            cmd_restore(c, a, tid, sid)
        elif a.cmd == "verify":
            cmd_verify(c, a, tid, sid)
        elif a.cmd == "clean-fixtures":
            cmd_clean(c, a, tid, sid)
        return 0
    finally:
        try:
            if tid:
                c.send("Target.closeTarget", {"targetId": tid})
        except Exception:
            pass
        c.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print("[失败] %s" % e)
        sys.exit(1)
