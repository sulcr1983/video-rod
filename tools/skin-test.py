#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
舞台皮肤一致性断言（popup / 设置页 / 安装页）
判据：底色 #100F0E、正文 #EFEAE0、主按钮金底深字、0 JS 异常、无白底残留

跑法（先起带扩展的 headless Edge）：
    python tools/skin-test.py --port 9500
"""
import argparse
import json
import sys
import time
import urllib.request

from websocket import create_connection

# 已知扩展 ID（同一路径加载的 unpacked 扩展 ID 固定）
KNOWN_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"

STAGE_BG = "rgb(16, 15, 14)"        # #100F0E
STAGE_INK = "rgb(239, 234, 224)"    # #EFEAE0
STAGE_GOLD = "rgb(232, 176, 75)"    # #E8B04B


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.op = op
        self.port = port
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=5))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        self.mid = 0
        self.events = []

    def send(self, method, params=None, sid=None):
        self.mid += 1
        i = self.mid
        msg = {"id": i, "method": method, "params": params or {}}
        if sid:
            msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            raw = self.ws.recv()
            r = json.loads(raw)
            if r.get("id") == i:
                return r.get("result", {})
            self.events.append(r)

    def ev(self, js, sid):
        r = self.send("Runtime.evaluate",
                      {"expression": js, "returnByValue": True, "awaitPromise": True}, sid)
        if "exceptionDetails" in r:
            return {"__err": str(r["exceptionDetails"])[:160]}
        return r.get("result", {}).get("value")

    def open_page(self, url, w, h):
        tid = self.send("Target.createTarget", {"url": url})["targetId"]
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        self.send("Page.enable", {}, sid)
        self.send("Emulation.setDeviceMetricsOverride",
                  {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False}, sid)
        return tid, sid

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


RESULTS = []


def check(name, got, want):
    ok = got == want
    RESULTS.append(ok)
    print(("PASS  " if ok else "FAIL  ") + name + "  = " + repr(got) +
          ("" if ok else "  (期望 " + repr(want) + ")"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9500)
    ap.add_argument("--ext", default=KNOWN_EXT)
    a = ap.parse_args()

    c = Cdp(a.port)

    # ---------- popup ----------
    tid, sid = c.open_page("chrome-extension://%s/popup.html" % a.ext, 400, 620)
    time.sleep(3)
    check("popup 标题", c.ev("document.title", sid), "苏哥的钓鱼竿 video-rod")
    check("popup 外壳存在", c.ev("!!document.getElementById('vrShell')", sid), True)
    check("popup 底色", c.ev("getComputedStyle(document.body).backgroundColor", sid), STAGE_BG)
    check("popup 标题文字色",
          c.ev("(()=>{const e=document.querySelector('.pop-title');return e?getComputedStyle(e).color:'no'})()", sid),
          STAGE_INK)
    check("popup 主按钮金底",
          c.ev("(()=>{const b=document.querySelector('.fbtn.primary');return b?getComputedStyle(b).backgroundColor:'no'})()", sid),
          STAGE_GOLD)
    check("popup 主按钮深字",
          c.ev("(()=>{const b=document.querySelector('.fbtn.primary');return b?getComputedStyle(b).color:'no'})()", sid),
          "rgb(23, 19, 13)")
    check("popup 无媒体控制页签", c.ev("!!document.getElementById('otherTab')", sid), False)
    popup_errs = len([e for e in c.events if e.get("method") == "Runtime.exceptionThrown"])
    c.events = []
    c.send("Target.closeTarget", {"targetId": tid})

    # ---------- 设置页 ----------
    tid, sid = c.open_page("chrome-extension://%s/options.html" % a.ext, 1440, 900)
    time.sleep(3)
    check("设置页 title", c.ev("document.title", sid), "苏哥的钓鱼竿 — 设置")
    check("设置页容器", c.ev("!!document.querySelector('.options-page')", sid), True)
    check("设置页底色",
          c.ev("(()=>{const e=document.querySelector('.options-page');return e?getComputedStyle(e).backgroundColor:'no'})()", sid),
          STAGE_BG)
    check("设置页正文色",
          c.ev("(()=>{const e=document.querySelector('.options-page');return e?getComputedStyle(e).color:'no'})()", sid),
          STAGE_INK)
    check("设置页卡片面色",
          c.ev("(()=>{const e=document.querySelector('.options-page .card,.options-page .optionBox,.options-page .sgroup');return e?getComputedStyle(e).backgroundColor:'no'})()", sid),
          "rgb(25, 23, 21)")
    check("设置页导航项 > 10", c.ev("document.querySelectorAll('.options-page .nav-item,.options-page .sidebar a').length", sid) > 10, True)
    opt_errs = len([e for e in c.events if e.get("method") == "Runtime.exceptionThrown"])
    c.events = []
    c.send("Target.closeTarget", {"targetId": tid})

    # ---------- 安装页 ----------
    tid, sid = c.open_page("chrome-extension://%s/install.html" % a.ext, 1200, 900)
    time.sleep(2)
    install_ok = c.ev("getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()", sid)
    check("安装页主色为舞台金", str(install_ok).lower(), "#e8b04b")

    # 可读性护栏（2026-11-05 苏哥截图反馈「界面看不清」）：
    # 当时 --content-bg 还是 #f8f9fa 白底，配上暖白正文 #EFEAE0，等于白底白字。
    box_bg = c.ev("getComputedStyle(document.querySelector('.content-box')).backgroundColor", sid)
    check("安装页内容卡不再是白底", box_bg, "rgb(31, 28, 24)")
    ink = c.ev("getComputedStyle(document.querySelector('.content-box p')).color", sid)
    check("安装页正文为暖白", ink, "rgb(239, 234, 224)")

    # 正文/底色对比度 ≥ 7（WCAG AAA 正文标准）
    ratio = c.ev("""(()=>{
      const lum = (c)=>{const [r,g,b]=c.match(/\\d+/g).map(Number).map(v=>{
        v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);});
        return 0.2126*r+0.7152*g+0.0722*b;};
      const box = document.querySelector('.content-box');
      const p = box.querySelector('p');
      const L1 = lum(getComputedStyle(box).backgroundColor);
      const L2 = lum(getComputedStyle(p).color);
      const hi = Math.max(L1,L2), lo = Math.min(L1,L2);
      return Math.round(((hi+0.05)/(lo+0.05))*10)/10;
    })()""", sid)
    check("安装页正文对比度 ≥ 7", (ratio if isinstance(ratio, (int, float)) else 0) >= 7, True)

    # 问题提交必须是自己的仓库，不能是上游猫抓的站点
    issue_href = c.ev("(document.querySelector('.content-box a')||{}).href || ''", sid)
    check("问题提交指向本仓库 issues", "github.com/sulcr1983/video-rod/issues" in str(issue_href), True)

    c.send("Target.closeTarget", {"targetId": tid})

    c.close()

    check("popup JS 异常数", popup_errs, 0)
    check("设置页 JS 异常数", opt_errs, 0)

    total = len(RESULTS)
    passed = sum(1 for x in RESULTS if x)
    print("\n%d/%d PASS" % (passed, total))
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
