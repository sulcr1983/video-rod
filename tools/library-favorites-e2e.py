#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""收藏夹 / 批量收藏持久化回归（真实 9480 库，测试后恢复原收藏夹）。

覆盖：
  1. 新建收藏夹 → 写入 vrFavs
  2. 批量选择卡片 → 加入收藏夹 → 条目 id 落库
  3. 重载页面后收藏夹和成员仍在
  4. 重命名收藏夹 → 重载后仍在
  5. 把当前筛选存为收藏夹（35 条）
  6. 删除收藏夹 → 重载后消失，文件/条目数不变
  7. finally 恢复原始 vrFavs

用法：python tools/library-favorites-e2e.py --port 9480
"""
import argparse
import json
import os
import sys
import time
import urllib.request

from websocket import create_connection

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

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

    def ev(self, js, sid, await_promise=True):
        r = self.send("Runtime.evaluate", {
            "expression": js, "returnByValue": True, "awaitPromise": await_promise
        }, sid)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__err": ((d.get("exception") or {}).get("description") or d.get("text") or "JS error")[:400]}
        return r.get("result", {}).get("value")

    def open_library(self, ext):
        tid = self.send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % ext})["targetId"]
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        self.send("Page.enable", {}, sid)
        self.send("Page.reload", {"ignoreCache": True}, sid)
        time.sleep(5)
        return tid, sid

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def check(name, ok, detail=""):
    RESULTS.append({"name": name, "pass": bool(ok), "detail": str(detail)[:400]})
    print(("PASS  " if ok else "FAIL  ") + name + (("  [" + str(detail)[:180] + "]") if not ok else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--ext", default=DEFAULT_EXT)
    ap.add_argument("--json", default="deliverables/test-runs/library-favorites-e2e.json")
    a = ap.parse_args()

    c = Cdp(a.port)
    tid = sid = None
    orig = []
    try:
        tid, sid = c.open_library(a.ext)
        raw = c.ev("VRDB.getSetting('vrFavs', []).then(x=>JSON.stringify(x||[]))", sid)
        try:
            orig = json.loads(raw) if isinstance(raw, str) else []
        except Exception:
            orig = []
        print("原始收藏夹：%d 个" % len(orig))

        def favs():
            r = c.ev("VRDB.getSetting('vrFavs', []).then(x=>JSON.stringify(x||[]))", sid)
            try:
                return json.loads(r) if isinstance(r, str) else []
            except Exception:
                return []

        def reload():
            c.send("Page.reload", {"ignoreCache": True}, sid)
            time.sleep(4)

        # 隔离测试：清空收藏夹（finally 恢复）
        c.ev("VRDB.setSetting('vrFavs', []).then(()=>1)", sid)
        reload()

        # 1. 新建收藏夹
        # 收藏区已改平铺（2026-11-07）：输入框常驻，不再需要先点 favNewBtn 展开
        name0 = "E2E收藏-%d" % int(time.time())
        c.ev("(()=>{const i=document.getElementById('favNewInput');i.value=%s;return 1})()" % json.dumps(name0), sid)
        c.ev("document.getElementById('favNewOk').click();1", sid)
        time.sleep(0.8)
        f1 = favs()
        check("新建收藏夹落库", len(f1) == 1 and f1[0].get("name") == name0, f1)

        # 2. 批量选择第一张 → 加入收藏夹
        c.ev("document.getElementById('selectBtn').click();1", sid)
        time.sleep(0.3)
        c.ev("(()=>{const c=document.querySelector('#grid .card');if(c)c.click();return 1})()", sid)
        time.sleep(0.3)
        c.ev("document.getElementById('batchFav').click();1", sid)
        time.sleep(0.8)
        f2 = favs()
        ids = (f2[0].get("ids") if f2 else []) or []
        check("批量收藏写入条目", len(ids) == 1, f2)

        # 3. 重载后仍在
        reload()
        f3 = favs()
        found = [x for x in f3 if x.get("name") == name0]
        check("重载后收藏夹仍在", bool(found), f3)
        check("重载后成员仍在", bool(found and len(found[0].get("ids") or []) == 1), found)
        dom_text = c.ev("(document.getElementById('favList')||{}).innerText||''", sid, False)
        check("侧栏显示收藏夹", name0 in str(dom_text), dom_text[:120])

        # 4. 重命名
        name1 = name0 + "-改名"
        fav_id = found[0].get("id") if found else ""
        c.ev("window.prompt=function(){return %s};1" % json.dumps(name1), sid)
        c.ev("(()=>{const b=document.querySelector('#favList .fav-row[data-fav=\"'+CSS.escape(%s)+'\"]');if(b)b.click();return 1})()" % json.dumps(fav_id), sid)
        time.sleep(0.4)
        c.ev("document.getElementById('favRename').click();1", sid)
        time.sleep(0.8)
        reload()
        f4 = favs()
        check("重命名收藏夹持久化", any(x.get("name") == name1 for x in f4), f4)

        # 5. 当前筛选存为收藏夹（35 条）
        c.ev("document.getElementById('favSaveFilter').click();1", sid)
        time.sleep(0.8)
        f5 = favs()
        smart = [x for x in f5 if str(x.get("name", "")).startswith("筛选 ")]
        check("当前筛选存为收藏夹", bool(smart), f5)
        check("智能收藏夹包含全部 35 条", bool(smart and len(smart[0].get("ids") or []) == 35),
              smart[0].get("ids")[:3] if smart else None)

        # 6. 删除自定义收藏夹
        c.ev("(()=>{const b=document.querySelector('#favList .fav-row[data-fav=\"'+CSS.escape(%s)+'\"]');if(b)b.click();return 1})()" % json.dumps(fav_id), sid)
        time.sleep(0.4)
        c.ev("document.getElementById('favDelete').click();1", sid)
        time.sleep(0.2)
        c.ev("document.getElementById('confirmOk').click();1", sid)
        time.sleep(0.8)
        f6 = favs()
        check("删除收藏夹落库", all(x.get("id") != fav_id for x in f6), f6)
        reload()
        f7 = favs()
        check("重载后删除仍生效", all(x.get("id") != fav_id for x in f7), f7)
        cards = c.ev("document.querySelectorAll('#grid .card').length", sid, False)
        check("收藏夹操作不删素材", cards == 35, cards)

        failed = [x for x in RESULTS if not x["pass"]]
        print("\n%d/%d PASS" % (len(RESULTS) - len(failed), len(RESULTS)))
        try:
            os.makedirs(os.path.dirname(a.json), exist_ok=True)
            with open(a.json, "w", encoding="utf-8") as f:
                json.dump(RESULTS, f, ensure_ascii=False, indent=1)
            print("明细：%s" % a.json)
        except Exception as e:
            print("写明细失败：%s" % e)
        return 0 if not failed else 1
    finally:
        try:
            if sid:
                c.ev("VRDB.setSetting('vrFavs', %s).then(()=>1)" % json.dumps(orig), sid)
                c.send("Page.reload", {"ignoreCache": True}, sid)
                time.sleep(2)
        except Exception:
            pass
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
