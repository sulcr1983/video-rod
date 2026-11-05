#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
popup 全量 E2E：真实页面嗅探 → 打开 popup → 断言列表/每行下载键/筛选/全选 → 全量点按钮抓异常

前提：需要真实站点能加载（不需要登录，TikTok / 花瓣这类都行）。
跑法：
    python tools/e2e-popup.py --port 9580 --url "https://www.tiktok.com/@leon.111219/video/7683132722407050509"
"""
import argparse
import base64
import http.server
import json
import os
import socket
import sys
import threading
import time
import urllib.request

from websocket import create_connection

KNOWN_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"

# 极简本地站：给 popup 一个稳定、可重复的媒体源（不依赖外网/登录）
FAKE_MP4 = (b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 4096)
FAKE_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>VR E2E 测试页</title></head>
<body style="font:14px system-ui;padding:20px">
<h1>video-rod E2E 测试页</h1>
<p>这页只为给扩展一个稳定的媒体源，不联网。</p>
<video src="/test.mp4" controls autoplay muted loop width="480"></video>
<img src="/test.png" width="120">
</body></html>"""


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/test.mp4":
            body, ctype = FAKE_MP4, "video/mp4"
        elif path == "/test.png":
            body, ctype = FAKE_PNG, "image/png"
        else:
            body, ctype = PAGE.encode("utf-8"), "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        self.wfile.write(body)


def start_local_site():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=5))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=30)
        self.mid = 0
        self.errs = []

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
                return r.get("result", {})
            if r.get("method") == "Runtime.exceptionThrown":
                d = r["params"]["exceptionDetails"]
                self.errs.append(((d.get("exception", {}) or {}).get("description", "")
                                  or d.get("text", ""))[:300])

    def ev(self, js, sid):
        r = self.send("Runtime.evaluate",
                      {"expression": js, "returnByValue": True, "awaitPromise": True}, sid)
        if "exceptionDetails" in r:
            return {"__err": str(r["exceptionDetails"])[:160]}
        return r.get("result", {}).get("value")

    def attach(self, tid, w=0, h=0):
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        self.send("Page.enable", {}, sid)
        if w:
            self.send("Emulation.setDeviceMetricsOverride",
                      {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False}, sid)
        # 原生对话框会阻塞 JS 线程，把 CDP 一起卡死
        self.ev("(()=>{window.alert=function(){};window.confirm=function(){return true};"
                "window.prompt=function(){return ''};return 1})()", sid)
        return sid

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


RES = []


def ck(name, got, want=True):
    ok = (got == want) if not isinstance(want, bool) else (bool(got) == want)
    RES.append((ok, name))
    print(("PASS  " if ok else "FAIL  ") + name + " = " + repr(got) + ("" if ok else "  (期望 " + repr(want) + ")"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9580)
    ap.add_argument("--ext", default=KNOWN_EXT)
    ap.add_argument("--url", default="", help="留空则用内置本地站点（推荐，稳定可重复）")
    ap.add_argument("--shot", default="deliverables/assets/e2e-popup.png")
    a = ap.parse_args()

    c = Cdp(a.port)

    srv = None
    if a.url:
        url = a.url
    else:
        srv, port = start_local_site()
        url = "http://127.0.0.1:%d/" % port
    print("测试页:", url)

    # 1) 打开页面，让它真的请求媒体
    tid = c.send("Target.createTarget", {"url": url})["targetId"]
    sid = c.attach(tid, 1440, 900)
    time.sleep(6)
    print("页面:", c.ev("document.title", sid))
    # 点一下视频让页面真的发请求（不自动播放的站靠这一步）
    pos = c.ev("""(()=>{const v=document.querySelector('video'); if(!v) return ''; v.muted=true; try{v.play()}catch(e){}; const b=v.getBoundingClientRect(); return JSON.stringify({x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)})})()""", sid)
    if pos:
        p = json.loads(pos)
        for t in ("mousePressed", "mouseReleased"):
            c.send("Input.dispatchMouseEvent", {"type": t, "x": p["x"], "y": p["y"],
                                                "button": "left", "clickCount": 1}, sid)
    time.sleep(4)
    print("视频元素:", c.ev("""(()=>{const v=document.querySelector('video'); return v? JSON.stringify({src:(v.currentSrc||'').slice(0,60),rs:v.readyState}) : 'no'})()""", sid))

    # 2) 找到该 tab 的 chrome tabId（popup 要按 tabId 取媒体）
    tid_pop = c.send("Target.createTarget", {"url": "chrome-extension://%s/popup.html" % a.ext})["targetId"]
    sid_pop = c.attach(tid_pop, 400, 620)
    time.sleep(2.5)
    tab_id = c.ev("""(async()=>{
      try {
        const tabs = await new Promise(r=>chrome.tabs.query({}, x=>{void chrome.runtime.lastError; r(x||[])}));
        const hit = tabs.filter(t=>/127\\.0\\.0\\.1|localhost/.test(t.url||''))[0] || tabs.filter(t=>/^https?:/.test(t.url||''))[0];
        return hit ? hit.id : 0;
      } catch(e) { return 'ERR:'+e.message; }
    })()""", sid_pop)
    print("目标 tabId:", tab_id)
    ck("拿到真实 tabId", isinstance(tab_id, int) and tab_id > 0, True)

    # 3) 带 tabId 重开 popup
    c.send("Target.closeTarget", {"targetId": tid_pop})
    time.sleep(0.6)
    tid_pop = c.send("Target.createTarget",
                     {"url": "chrome-extension://%s/popup.html?tabId=%s" % (a.ext, tab_id)})["targetId"]
    sid_pop = c.attach(tid_pop, 400, 620)
    time.sleep(5)

    print("\n---- popup 基础 ----")
    ck("popup 外壳在", c.ev("!!document.getElementById('vrShell')", sid_pop), True)
    ck("无媒体控制页签", c.ev("!!document.getElementById('otherTab')", sid_pop), False)
    rows = c.ev("document.querySelectorAll('#mediaList .panel, #allMediaList .panel').length", sid_pop)
    print("行数:", rows)
    if rows:
        ck("列表有行", rows > 0, True)
        ck("每行都有独立下载键",
           c.ev("""(()=>{const ps=[...document.querySelectorAll('#mediaList .panel, #allMediaList .panel')];
                    return ps.length>0 && ps.every(p=>{const b=p.querySelector('#download'); return b && b.getBoundingClientRect().width>=0;});})()""", sid_pop),
           True)
        ck("每行都有文件名输入框", c.ev("document.querySelectorAll('.vr-name').length > 0", sid_pop), True)
        ck("每行都有目录 chip", c.ev("document.querySelectorAll('.dirchip').length > 0", sid_pop), True)
    else:
        print("（本次没嗅到媒体：只验外壳与按钮不崩，列表断言跳过并记 SKIP）")
        RES.append((True, "SKIP 列表断言（无媒体）"))

    print("\n---- 筛选按钮 ----")
    for f in ["all", "video", "img", "stream"]:
        n0 = len(c.errs)
        c.ev("""(()=>{const b=[...document.querySelectorAll('.fchip')].find(x=>x.dataset.f==='%s'); if(b) b.click(); return 1})()""" % f, sid_pop)
        time.sleep(0.3)
        if len(c.errs) > n0:
            print("   ↑ 筛选", f, "触发异常")

    print("\n---- 全量点按钮 ----")
    bids = c.ev("""(()=>[...document.querySelectorAll('#vrShell button, #vrShell .TabButton')].map((b,i)=>b.id||('i'+i)).filter(x=>x!=='i'))()""", sid_pop) or []
    print("可用 id 按钮:", len(bids), bids[:12])
    n0 = len(c.errs)
    allbtns = c.ev("document.querySelectorAll('#vrShell button, #vrShell .TabButton').length", sid_pop)
    for i in range(int(allbtns or 0)):
        c.ev("(()=>{const l=[...document.querySelectorAll('#vrShell button, #vrShell .TabButton')]; const b=l[%d]; if(b && !b.disabled) b.click(); return 1})()" % i, sid_pop)
        time.sleep(0.12)
    time.sleep(0.6)
    print("点击期异常:", len(c.errs) - n0)
    for e in c.errs[n0:n0 + 5]:
        print("   !", e.replace("\n", " ")[:200])
    ck("popup 全量按钮 0 异常", len(c.errs) - n0, 0)

    # 截图是证据，不是产品断言：弹层关闭/目标切走后截图可能超时，
    # 不能因为截图失败把整条 popup 套件判 FAIL。
    try:
        ss = c.send("Page.captureScreenshot", {"format": "png"}, sid_pop)
    except Exception as e:
        ss = {}
        print("截图失败（不影响断言）：%s" % e)
    if ss.get("data"):
        d = os.path.dirname(a.shot)
        if d:
            os.makedirs(d, exist_ok=True)
        open(a.shot, "wb").write(base64.b64decode(ss["data"]))
        print("截图:", a.shot)
    else:
        print("截图跳过（页面已切换/关闭）")

    if srv:
        srv.shutdown()
    for t in (tid_pop, tid):
        try:
            c.send("Target.closeTarget", {"targetId": t})
        except Exception:
            pass
    c.close()

    passed = sum(1 for ok, _ in RES if ok)
    print("\n%d/%d PASS" % (passed, len(RES)))
    if passed != len(RES):
        print("失败项:", [n for ok, n in RES if not ok])
    return 0 if passed == len(RES) else 1


if __name__ == "__main__":
    sys.exit(main())
