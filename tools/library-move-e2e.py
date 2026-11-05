#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量移动底层回归：用 OPFS 临时目录验证 moveFile 的复制/校验/删源/防覆盖。

为什么用 OPFS：
  - 真实目录移动需要用户手势授权，自动化点不了系统 picker；
  - OPFS 提供同款 FileSystemDirectoryHandle API，可创建临时沙箱；
  - 只写临时目录，不碰真实 35 条素材。

覆盖：
  1. VRTrash.moveFile / exists 已导出；
  2. 移动后源消失、目标存在、内容一致；
  3. noOverwrite 命中时抛 LIB_E_EXISTS，且不覆盖目标、不删除源；
  4. 能移回原位置；
  5. 清理临时目录。

用法：python tools/library-move-e2e.py --port 9480
"""
import argparse
import json
import os
import sys
import time
import urllib.request

from websocket import create_connection

DEFAULT_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"
RESULTS = []


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=8))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=90)
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

    def ev(self, js, sid):
        r = self.send("Runtime.evaluate", {
            "expression": js, "returnByValue": True, "awaitPromise": True
        }, sid)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__err": ((d.get("exception") or {}).get("description") or d.get("text") or "JS error")[:500]}
        return r.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--ext", default=DEFAULT_EXT)
    ap.add_argument("--json", default="deliverables/test-runs/library-move-e2e.json")
    a = ap.parse_args()

    c = Cdp(a.port)
    tid = sid = None
    try:
        tid = c.send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % a.ext})["targetId"]
        sid = c.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        c.send("Runtime.enable", {}, sid)
        c.send("Page.enable", {}, sid)
        c.send("Page.reload", {"ignoreCache": True}, sid)
        time.sleep(4)

        js = r"""(async()=>{
          const out=[];
          const check=(name,ok,detail)=>out.push({name:name,pass:!!ok,detail:detail===undefined?'':String(detail)});
          check('VRTrash.moveFile 已导出', typeof VRTrash.moveFile === 'function', typeof VRTrash.moveFile);
          check('VRTrash.exists 已导出', typeof VRTrash.exists === 'function', typeof VRTrash.exists);
          if (typeof VRTrash.moveFile !== 'function') return JSON.stringify(out);

          const opfs = await navigator.storage.getDirectory();
          const baseName = 'vr-move-e2e-' + Date.now();
          const base = await opfs.getDirectoryHandle(baseName, {create:true});
          const dirAt = async (rel, create) => {
            let d = base;
            for (const s of rel.split('/').filter(Boolean)) {
              d = await d.getDirectoryHandle(s, {create: !!create});
            }
            return d;
          };
          const write = async (rel, text) => {
            const segs = rel.split('/'); const name = segs.pop();
            const d = await dirAt(segs.join('/'), true);
            const h = await d.getFileHandle(name, {create:true});
            const w = await h.createWritable();
            await w.write(text); await w.close();
          };
          const read = async (rel) => {
            const segs = rel.split('/'); const name = segs.pop();
            const d = await dirAt(segs.join('/'), false);
            const h = await d.getFileHandle(name);
            return await (await h.getFile()).text();
          };
          try {
            await write('src/a.txt', 'hello');
            await VRTrash.moveFile(base, 'src/a.txt', 'dest/b.txt', {noOverwrite:true});
            check('移动后源文件消失', !(await VRTrash.exists(base, 'src/a.txt')));
            check('移动后目标文件存在', await VRTrash.exists(base, 'dest/b.txt'));
            check('移动后内容一致', (await read('dest/b.txt')) === 'hello');

            await write('src/c.txt', 'second');
            let collision = '';
            try {
              await VRTrash.moveFile(base, 'src/c.txt', 'dest/b.txt', {noOverwrite:true});
            } catch (e) { collision = e.code || e.name || String(e); }
            check('同名目标被拒绝（LIB_E_EXISTS）', collision === 'LIB_E_EXISTS', collision);
            check('拒绝后目标未被覆盖', (await read('dest/b.txt')) === 'hello');
            check('拒绝后源文件保留', await VRTrash.exists(base, 'src/c.txt'));

            await VRTrash.moveFile(base, 'dest/b.txt', 'src/a.txt', {noOverwrite:true});
            check('能移回原路径且内容一致', (await read('src/a.txt')) === 'hello');
          } finally {
            try { await opfs.removeEntry(baseName, {recursive:true}); } catch(e) {}
          }
          return JSON.stringify(out);
        })()"""
        raw = c.ev(js, sid)
        if not isinstance(raw, str):
            raise RuntimeError("OPFS 移动测试失败：%s" % raw)
        results = json.loads(raw)
        for r in results:
            print(("PASS  " if r.get("pass") else "FAIL  ") + r.get("name", ""))
        failed = [r for r in results if not r.get("pass")]
        print("\n%d/%d PASS" % (len(results) - len(failed), len(results)))
        try:
            os.makedirs(os.path.dirname(a.json), exist_ok=True)
            with open(a.json, "w", encoding="utf-8") as f:
                json.dump(results, f, ensure_ascii=False, indent=1)
            print("明细：%s" % a.json)
        except Exception as e:
            print("写明细失败：%s" % e)
        return 0 if not failed else 1
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
        sys.exit(2)
