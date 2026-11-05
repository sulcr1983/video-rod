# -*- coding: utf-8 -*-
"""e2e-sw · 后台服务存活回归（护栏）

为什么必须有这条（2026-11-05 事故）：
    js/library/dedup.js 里写了 `var root = window;`，而它同时被 background
    service worker 用 importScripts 加载。SW 里没有 window → importScripts 抛错
    → background.js 从第五行就中断 → chrome.runtime.onMessage 从未注册。
    症状极具欺骗性：资源库页面正常、皮肤正常、悬浮按钮也正常，
    但点下载毫无反应，面板永远停在「正在问这个网站能下哪些清晰度…」，
    60 秒也不落盘。而当时 7 个套件全绿的回归里，没有任何一条验证过后台消息。

所以这里只做一件事：确认后台真的活着、能应答、关键模块都加载了。

用法：
    python tools/e2e-sw.py --port 9480
"""
import argparse
import json
import os
import sys
import time
import urllib.request

from websocket import create_connection

KNOWN_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"
RES = []


def ck(name, got, expect=True):
    ok = (got == expect)
    RES.append(ok)
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "  got=%r expect=%r" % (got, expect)))


class Cdp:
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=6))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        self.mid = 0

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
                return r.get("result", {})

    def ev(self, js, sid, await_promise=True, timeout=30):
        try:
            self.ws.settimeout(timeout)
            r = self.send("Runtime.evaluate",
                          {"expression": js, "returnByValue": True, "awaitPromise": await_promise},
                          sid)
        except Exception as e:
            return {"__err": "%s: %s" % (type(e).__name__, str(e)[:80])}
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__err": (d.get("exception", {}) or {}).get("description", d.get("text"))}
        return r.get("result", {}).get("value")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--ext", default=KNOWN_EXT)
    a = ap.parse_args()

    c = Cdp(a.port)
    tid = c.send("Target.createTarget",
                 {"url": "chrome-extension://%s/library.html" % a.ext})["targetId"]
    sid = c.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
    c.send("Runtime.enable", {}, sid)
    time.sleep(2.5)

    # 1) 后台必须能应答（最能代表「活着」的一条）
    hb = c.ev("new Promise(r=>{const t=setTimeout(()=>r('TIMEOUT'),8000);"
              "try{chrome.runtime.sendMessage({Message:'HeartBeat'},x=>{clearTimeout(t);r(x===undefined?'UNDEF':x)})}"
              "catch(e){clearTimeout(t);r('THROW')}})", sid)
    ck("后台 HeartBeat 有应答（SW 活着）", hb, "HeartBeat OK")

    # 2) 数据通道可用
    data = c.ev("new Promise(r=>{const t=setTimeout(()=>r('TIMEOUT'),8000);"
                "chrome.runtime.sendMessage({Message:'getAllData'},d=>{clearTimeout(t);r(d===undefined?'UNDEF':'OBJ')})})", sid)
    ck("getAllData 有应答（消息路由已注册）", data, "OBJ")

    # 3) 取源接口不卡死（会返回结构，哪怕是空）
    opts = c.ev("new Promise(r=>{const t=setTimeout(()=>r('TIMEOUT'),12000);"
                "chrome.runtime.sendMessage({Message:'vrVideoOptions'},x=>{clearTimeout(t);"
                "r(x&&typeof x==='object'?('keys:'+Object.keys(x).sort().join(',')):String(x))})})", sid)
    ck("vrVideoOptions 12s 内返回（不会永久 loading）", opts, "keys:ok,options,site")

    # 4) 扩展上下文正常（对照：上次挂掉时这里仍正常，所以这条是兜底而非主判据）
    alive = c.ev("chrome.runtime.id", sid)
    ck("扩展上下文正常", alive, a.ext)

    c.send("Target.closeTarget", {"targetId": tid})
    passed = sum(1 for x in RES)
    print("\n%d/%d PASS" % (passed, len(RES)))
    if passed != len(RES):
        print("失败项：后台可能没起来 —— 先看 js/background.js 开头 importScripts 的脚本里有没有写死 window/document")
    return 0 if passed == len(RES) else 1


if __name__ == "__main__":
    sys.exit(main())
