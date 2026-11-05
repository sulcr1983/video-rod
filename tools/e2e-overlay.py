#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
覆盖层 E2E：图片悬浮键尺寸 / 视频页抑制 / 接口 JSON 媒体嗅探

三条判据（对应用户反馈）：
  O1 图片键是「小圆钮」：按钮高 ≤ 26px，不再画文字（文字只在 title）
  O2 视频页不冒图片键：页面上有大视频时，hover 图片不出现下载键
  O3 接口里的地址能被挖出来：页面 fetch 一个 JSON，里面藏 /video/tos/ 地址，
     扩展必须把它捡起来（net-sniff.js + content-script 转发）

跑法（先起带扩展的 headless/有头 Edge）：
    python tools/e2e-overlay.py --port 9600
"""
import argparse
import http.server
import json
import struct
import sys
import threading
import time
import urllib.request
import zlib

from websocket import create_connection

KNOWN_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"


def make_png(w, h, rgb=(40, 90, 160)):
    rows = []
    for _y in range(h):
        row = bytearray([0])
        for _x in range(w):
            row += bytes(rgb)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6))
            + chunk(b"IEND", b""))


BIG_PNG = make_png(900, 600)
FAKE_MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 2048
HIDDEN_PATH = "/video/tos/hidden-abc123"

PAGE_IMG = """<!doctype html><meta charset="utf-8"><title>O1 图片页</title>
<body style="margin:0;background:#eee">
<img id="big" src="/big.png" width="900" height="600">
</body>"""

PAGE_VIDEO = """<!doctype html><meta charset="utf-8"><title>O2 视频页</title>
<body style="margin:0;background:#111">
<div style="position:relative;width:100%;height:80vh">
  <video src="/clip.mp4" autoplay muted loop style="width:100%;height:100%"></video>
</div>
<div style="position:relative;height:600px;background:#222">
  <img id="big" src="/big.png" width="900" height="600">
</div>
</body>"""

PAGE_API = """<!doctype html><meta charset="utf-8"><title>O3 接口页</title>
<body><h1>接口嗅探</h1>
<script>
window.__vrSeen = [];
window.addEventListener('message', function (e) {
  if (e.data && e.data.action === 'vrNetMedia') { window.__vrSeen = window.__vrSeen.concat(e.data.urls); }
});
fetch('/api/detail.json').then(r => r.json()).then(() => { window.__vrApiDone = true; });
</script>
</body>"""


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/big.png":
            body, ct = BIG_PNG, "image/png"
        elif path == "/clip.mp4":
            body, ct = FAKE_MP4, "video/mp4"
        elif path == HIDDEN_PATH:
            body, ct = FAKE_MP4, "video/mp4"
        elif path == "/api/detail.json":
            body = json.dumps({
                "status": "ok",
                "data": {
                    "play_addr": {"url_list": ["http://127.0.0.1:%d%s" % (self.server.server_address[1], HIDDEN_PATH)]},
                    "desc": "藏在接口里的播放地址"
                }
            }, ensure_ascii=False).encode()
            ct = "application/json; charset=utf-8"
        elif path == "/page-img":
            body, ct = PAGE_IMG.encode(), "text/html; charset=utf-8"
        elif path == "/page-video":
            body, ct = PAGE_VIDEO.encode(), "text/html; charset=utf-8"
        elif path == "/page-api":
            body, ct = PAGE_API.encode(), "text/html; charset=utf-8"
        else:
            body, ct = b"not found", "text/plain"
        self.send_response(200)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        self.wfile.write(body)


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=5))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=30)
        self.mid = 0

    def send(self, m, p=None, sid=None):
        self.mid += 1
        i = self.mid
        msg = {"id": i, "method": m, "params": p or {}}
        if sid:
            msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == i:
                return r.get("result", {})

    def ev(self, js, sid):
        r = self.send("Runtime.evaluate",
                      {"expression": js, "returnByValue": True, "awaitPromise": True}, sid)
        if "exceptionDetails" in r:
            return {"__err": str(r["exceptionDetails"])[:160]}
        return r.get("result", {}).get("value")

    def open(self, url, w=1200, h=900):
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


RES = []


def ck(name, got, want=True):
    ok = (got == want) if not isinstance(want, bool) else (bool(got) == want)
    RES.append((ok, name))
    print(("PASS  " if ok else "FAIL  ") + name + " = " + repr(got) + ("" if ok else "  (期望 " + repr(want) + ")"))


def hover_big(c, sid):
    return c.ev("""(()=>{
      const img = document.getElementById('big');
      if (!img) return 'no-img';
      img.scrollIntoView({block:'center'});
      const r = img.getBoundingClientRect();
      const o = {bubbles:true, cancelable:true, clientX:r.left+40, clientY:r.top+40};
      img.dispatchEvent(new MouseEvent('mouseover', o));
      img.dispatchEvent(new MouseEvent('mousemove', o));
      return 'ok';
    })()""", sid)


def probe_btn(c, sid):
    return c.ev("""(()=>{
      const h = document.getElementById('vr-img-hover-host');
      if (!h || !h.shadowRoot) return 'no-host';
      const wrap = h.shadowRoot.querySelector('.vr-wrap');
      if (!wrap || !wrap.classList.contains('on')) return 'hidden';
      const b = h.shadowRoot.querySelector('.vr-btn');
      if (!b) return 'no-btn';
      const rc = b.getBoundingClientRect();
      const st = getComputedStyle(b);
      const txt = b.querySelector('.vr-text');
      return JSON.stringify({
        w: Math.round(rc.width), h: Math.round(rc.height),
        heightCss: st.height,
        textDisplay: txt ? getComputedStyle(txt).display : 'none',
        title: b.getAttribute('title') || ''
      });
    })()""", sid)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9600)
    ap.add_argument("--ext", default=KNOWN_EXT)
    a = ap.parse_args()

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % srv.server_address[1]
    print("测试站:", base)

    c = Cdp(a.port)

    # ---------- O1 图片页：小圆钮 ----------
    print("\n---- O1 图片键尺寸 ----")
    tid, sid = c.open(base + "/page-img")
    time.sleep(4)
    ck("图片页已加载", c.ev("document.title", sid), "O1 图片页")
    ck("派发悬停", hover_big(c, sid), "ok")
    time.sleep(1.6)          # 默认延迟 700ms，留足
    info = probe_btn(c, sid)
    print("按钮:", info)
    ok = isinstance(info, str) and info.startswith("{")
    ck("图片键出现了", ok, True)
    if ok:
        d = json.loads(info)
        ck("O1 按钮高度 ≤ 26px", d["h"] <= 26, True)
        ck("O1 按钮宽度 ≤ 60px（不含文字）", d["w"] <= 60, True)
        ck("O1 文字不占宽（display:none）", d["textDisplay"], "none")
        ck("O1 有 title 说明", bool(d["title"]), True)
    c.send("Target.closeTarget", {"targetId": tid})

    # ---------- O2 视频页：不冒图片键 ----------
    print("\n---- O2 视频页抑制 ----")
    tid, sid = c.open(base + "/page-video")
    time.sleep(4)
    ck("视频页已加载", c.ev("document.title", sid), "O2 视频页")
    ck("页面确实有大视频", c.ev("""(()=>{const v=document.querySelector('video'); if(!v) return false;
        const r=v.getBoundingClientRect(); return r.width*r.height >= innerWidth*innerHeight*0.35})()""", sid), True)
    ck("派发悬停（图）", hover_big(c, sid), "ok")
    time.sleep(1.8)
    st = probe_btn(c, sid)
    print("按钮:", st)
    ck("O2 视频页不出现图片键", st in ("hidden", "no-host"), True)
    c.send("Target.closeTarget", {"targetId": tid})

    # ---------- O3 接口 JSON 里的地址 ----------
    print("\n---- O3 接口嗅探 ----")
    tid, sid = c.open(base + "/page-api")
    time.sleep(5)
    ck("接口页已加载", c.ev("document.title", sid), "O3 接口页")
    ck("页面接口已返回", c.ev("!!window.__vrApiDone", sid), True)
    dbg = c.ev("JSON.stringify(window.__vrNetSniff || {})", sid)
    print("嗅探自检:", dbg)
    try:
        d = json.loads(dbg) if isinstance(dbg, str) else {}
    except Exception:
        d = {}
    # 注：页面自己的 message 监听会被 content-script 的 stopImmediatePropagation 挡掉（预期），
    # 所以这里看 net-sniff 的自检计数：扫了几次 / 挖到几条 / 发出几次。
    ck("O3 扫过接口响应", d.get("scans", 0) >= 1, True)
    ck("O3 从 JSON 里挖到播放地址", d.get("hits", 0) >= 1, True)
    ck("O3 已向上转发", d.get("posts", 0) >= 1, True)

    ss = c.send("Page.captureScreenshot", {"format": "png"}, sid)
    c.send("Target.closeTarget", {"targetId": tid})
    srv.shutdown()
    c.close()

    passed = sum(1 for ok, _ in RES if ok)
    print("\n%d/%d PASS" % (passed, len(RES)))
    if passed != len(RES):
        print("失败项:", [n for ok, n in RES if not ok])
    return 0 if passed == len(RES) else 1


if __name__ == "__main__":
    sys.exit(main())
