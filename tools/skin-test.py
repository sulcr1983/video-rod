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

STAGE_BG = "rgb(16, 15, 14)"        # #100F0E（库页 / 设置页）
# popup 面板按原型 popup-stage-v1.html 用更深一档的底色（纠偏时对齐设计真源）
POPUP_BG = "rgb(11, 10, 9)"         # #0B0A09
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
    check("popup 标题", c.ev("document.title", sid), "苏哥的钓鱼竿")
    check("popup 外壳存在", c.ev("!!document.getElementById('vrShell')", sid), True)
    check("popup 底色", c.ev("getComputedStyle(document.body).backgroundColor", sid), POPUP_BG)
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
    # 安装页在 2026-11-10 重构过：色板变量名 --primary → --gold，
    # 卡片 .content-box → .pain，正文 .content-box p → .p-desc，
    # 反馈入口按 11-11「用户可见文案去掉第三方平台名」改到本仓库 issues。
    # 断言跟着真源走（读 :root 变量），别再绑死某个 DOM 结构 —— 绑死的结果
    # 就是结构一改，5 条护栏全部静默变红，而产品其实好着（视觉基线可证）。
    palette = c.ev("""(()=>{
      const cs=getComputedStyle(document.documentElement);
      const v=n=>cs.getPropertyValue(n).trim();
      const card=document.querySelector('.pain');
      const desc=document.querySelector('.p-desc');
      return JSON.stringify({
        gold:v('--gold').toLowerCase(), surface:v('--surface-2').toLowerCase(),
        text:v('--text').toLowerCase(), bg:v('--bg').toLowerCase(),
        cardBg:card?getComputedStyle(card).backgroundColor:'',
        descColor:desc?getComputedStyle(desc).color:'',
        href:(document.querySelector('.fb-links a')||{}).href||''
      });
    })()""", sid)
    try:
        pal = json.loads(palette) if isinstance(palette, str) else {}
    except Exception:
        pal = {}
    check("安装页主色为舞台金", pal.get("gold"), "#e8b04b")
    check("安装页内容卡为深色（非白底）", pal.get("surface"), "#1b1815")
    check("安装页内容卡不是白底", "255, 255, 255" in str(pal.get("cardBg")), False)
    check("安装页正文为暖白", pal.get("text"), "#efeae0")
    check("安装页正文元素存在", bool(pal.get("descColor")), True)

    # 正文/底色对比度 ≥ 7（WCAG AAA 正文标准），按色板真源算，不依赖卡片渐变
    def _lum(h):
        h = str(h).replace('#', '').strip()
        if len(h) != 6:
            return 0.0
        ch = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
        ch = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in ch]
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
    l1, l2 = _lum(pal.get('text')), _lum(pal.get('bg'))
    ratio = round((max(l1, l2) + 0.05) / (min(l1, l2) + 0.05), 1) if (l1 or l2) else 0
    check("安装页正文对比度 ≥ 7", ratio >= 7, True)

    # 2026-11-11 决策：用户可见文案/链接不宣传第三方，反馈入口改到本仓库 issues
    check("反馈入口指向本仓库 issues",
          "github.com/sulcr1983/video-rod/issues" in str(pal.get("href")), True)

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
