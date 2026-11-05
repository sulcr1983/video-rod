# -*- coding: utf-8 -*-
"""live-eval · 在「已打开的页面」上反复执行 JS（零重复访问站点）

为什么：诊断真实站点时最忌讳反复打开页面（风控）。正确做法是页面只开一次，
之后所有检查都在这一个标签里跑。

用法：
    # 1) 打开一次（若已有同域标签则直接复用，不新开）
    python tools/live-eval.py --open "https://www.douyin.com/video/xxx" --match douyin.com --wait 12
    # 2) 之后随便跑，页面不动
    python tools/live-eval.py --match douyin.com --js "document.title"
    python tools/live-eval.py --match douyin.com --file tools/js/douyin-probe.js
"""
import argparse
import json
import os
import sys
import time
import urllib.request

from websocket import create_connection

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Cdp:
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=6))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=120)
        self.mid = 0
        self.created = []

    def send(self, m, p=None, sid=None):
        self.mid += 1
        msg = {"id": self.mid, "method": m, "params": p or {}}
        if sid:
            msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.mid:
                if "error" in r:
                    raise RuntimeError("%s: %s" % (m, r["error"]))
                res = r.get("result", {})
                if m == "Target.createTarget" and res.get("targetId"):
                    self.created.append(res["targetId"])
                return res

    def ev(self, js, sid, await_promise=True, timeout=40):
        try:
            self.ws.settimeout(timeout)
            r = self.send("Runtime.evaluate",
                          {"expression": js, "returnByValue": True, "awaitPromise": await_promise},
                          sid)
        except Exception as e:
            return {"__err": "%s: %s" % (type(e).__name__, str(e)[:100])}
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__err": (d.get("exception", {}) or {}).get("description", d.get("text"))}
        return r.get("result", {}).get("value")

    def find(self, needle, ttype="page"):
        for t in self.send("Target.getTargets")["targetInfos"]:
            if t.get("type") == ttype and needle in (t.get("url") or ""):
                return t["targetId"], t.get("url")
        return None, None

    def attach(self, tid):
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        self.send("Page.enable", {}, sid)
        return sid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--match", default="", help="按 URL 片段找已打开的标签")
    ap.add_argument("--open", default="", help="找不到时才新开这个地址")
    ap.add_argument("--wait", type=int, default=12, help="新开后的等待秒数")
    ap.add_argument("--js", default="", help="要执行的 JS 表达式")
    ap.add_argument("--file", default="", help="从文件读 JS")
    ap.add_argument("--close", action="store_true", help="执行完关掉该标签")
    ap.add_argument("--raw", action="store_true", help="原样打印，不做 JSON 美化")
    ap.add_argument("--sw", action="store_true", help="连到后台 service worker 而不是页面")
    a = ap.parse_args()

    c = Cdp(a.port)
    if a.sw:
        tid, url = c.find(a.match or "", "service_worker")
        tid2, url2 = (None, None) if tid else c.find(a.match or "", "background_page")
        if not tid and tid2:
            tid, url = tid2, url2
        if not tid:
            print("[失败] 没找到扩展后台 service worker，扩展是否已加载？")
            return 2
        print("[后台 SW] " + (url or "")[:100])
    else:
        tid, url = c.find(a.match) if a.match else (None, None)
        if tid:
            print("[复用标签] " + (url or "")[:100])
        elif a.open:
            tid = c.send("Target.createTarget", {"url": a.open})["targetId"]
            print("[新开标签] " + a.open)
            time.sleep(a.wait)
        else:
            print("[失败] 没找到匹配标签，也没给 --open")
            return 2

    sid = c.attach(tid)
    js = a.js or (open(a.file, "r", encoding="utf-8").read() if a.file else "")
    if not js:
        info = c.ev("JSON.stringify({title:document.title,url:location.href})", sid, False)
        print("标签信息:", info)
        return 0

    out = c.ev(js, sid)
    if isinstance(out, str) and not a.raw:
        try:
            print(json.dumps(json.loads(out), ensure_ascii=False, indent=2))
        except Exception:
            print(out)
    else:
        print(json.dumps(out, ensure_ascii=False, indent=2) if not isinstance(out, str) else out)

    if a.close:
        c.send("Target.closeTarget", {"targetId": tid})
    return 0


if __name__ == "__main__":
    sys.exit(main())
