#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""QA 专项：小红书详情页嗅探白名单（ADR-071 / B-39 / Q-04，2026-11-08）

原理：本地 fixture 复刻小红书详情页数据形态 ——
  · __INITIAL_STATE__.note.noteDetailMap[<noteId>].note.imageList 只含本体图 A
  · 假 feed 接口 JSON 同时含本体图 A 与推荐流封面 B（同一 CDN、同一 spectrum 目录）
  · 页面再直接 <img src=B>（走 PerformanceObserver 通道）
断言（全链路：net-sniff → content-script → SW MediaData）：
  W1 本体图 A 被上报（不误杀）
  W2 推荐流封面 B 被白名单过滤（ADR-071 目标）
  W3 非详情页（同域根路径页）不过滤：A、B 都上报（回退铁律，不漏下）
真实站点的最终确认留给 B-39 真机项（今日实例配额已用尽，如实标注）。

跑法：先起隔离实例，再：
    python tools/test-xhs-note-filter.py --port 9490
"""
import argparse
import json
import os
import threading
import time
import urllib.request

from websocket import create_connection

NOTE_ID = "6a065a7a000000003601b78d"
IMG_A = "https://sns-webpic-qc.xhscdn.com/202611081200/spectrum/AAAA1111BBBB2222CCCC3333!nd_dft_wgth_webp_3"
IMG_B = "https://sns-webpic-qc.xhscdn.com/202611081200/spectrum/DDDD4444EEEE5555FFFF6666!nc_n_webp_mw_1"

DETAIL = """<!doctype html><html><head><meta charset="utf-8"><title>QA 白名单 fixture</title>
<script>
window.__INITIAL_STATE__ = {
  note: { noteDetailMap: {
    "%(note)s": { note: {
      title: "QA 本体笔记", type: "normal",
      imageList: [{ urlDefault: "%(a)s" }]
    } },
    "preloadother000000000000": { note: {
      title: "推荐笔记", imageList: [{ urlDefault: "%(b)s" }]
    } }
  } }
};
</script></head>
<body>
<img src="%(b)s">
<script>
fetch('/api/sns/web/v1/feed').then(function (r) { return r.text(); }).catch(function () {});
</script>
</body></html>""" % {"note": NOTE_ID, "a": IMG_A, "b": IMG_B}

ROOTPAGE = """<!doctype html><html><head><meta charset="utf-8"><title>QA 非详情 fixture</title></head>
<body>
<script>
fetch('/api/sns/web/v1/feed').then(function (r) { return r.text(); }).catch(function () {});
</script>
</body></html>"""

FEED = '{"items":[{"url":"%s"},{"url":"%s"}]}' % (IMG_A, IMG_B)


class Handler:
    pass


import http.server


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/sns/web/v1/feed":
            body, ctype = FEED.encode("utf-8"), "application/json"
        elif p.startswith("/explore/"):
            body, ctype = DETAIL.encode("utf-8"), "text/html; charset=utf-8"
        else:
            body, ctype = ROOTPAGE.encode("utf-8"), "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=6))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        self.mid = 0

    def send(self, method, params=None, sid=None):
        self.mid += 1
        msg = {"id": self.mid, "method": method, "params": params or {}}
        if sid:
            msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.mid:
                if "error" in r:
                    raise RuntimeError("%s: %s" % (method, r["error"]))
                return r.get("result", {})

    def ev(self, js, sid):
        r = self.send("Runtime.evaluate",
                      {"expression": js, "returnByValue": True, "awaitPromise": True}, sid)
        if "exceptionDetails" in r:
            return {"__err": str(r["exceptionDetails"].get("exception", {}))[:200]}
        return r.get("result", {}).get("value")

    def attach(self, tid):
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        try:
            self.send("Page.enable", {}, sid)
        except RuntimeError:
            pass
        return sid

    def sw(self):
        for t in self.send("Target.getTargets")["targetInfos"]:
            if t.get("type") == "service_worker" and "background.js" in (t.get("url") or ""):
                return self.attach(t["targetId"])
        return None

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


def snif(c, port, path):
    """开 fixture 页 → 返回 (tabId, dbg, SW 里该 tab 的媒体 URL 列表)"""
    cdp_sw = c.sw()
    url = "http://127.0.0.1:%d%s" % (port, path)
    tid = c.send("Target.createTarget", {"url": url})["targetId"]
    sid = c.attach(tid)
    time.sleep(7)
    dbg = c.ev("JSON.stringify(window.__vrNetSniff||{})", sid)
    # 找该 tab 的 chrome tabId（用探针 popup）
    tid_probe = c.send("Target.createTarget", {"url": "chrome-extension://" + EXT + "/popup.html"})["targetId"]
    sid_probe = c.attach(tid_probe)
    time.sleep(2)
    tab_id = c.ev("""(async()=>{
      const tabs = await new Promise(r=>chrome.tabs.query({}, x=>{void chrome.runtime.lastError; r(x||[])}));
      const hits = tabs.filter(t=>(t.url||'').indexOf(%s)>=0).sort((a,b)=>b.id-a.id);
      return hits.length ? hits[0].id : 0;})()""" % json.dumps(":%d%s" % (port, path)), sid_probe)
    c.send("Target.closeTarget", {"targetId": tid_probe})
    time.sleep(1.5)
    urls = c.ev("""(async()=>{
      try {
        const o = await chrome.storage.session.get('MediaData');
        const d = (o.MediaData || {})[%s];
        if (!d) return '[]';
        const arr = Array.isArray(d) ? d : Object.values(d);
        return JSON.stringify(arr.map(x=>String((x && (x.url||x.u)) || '').slice(0,120)));
      } catch(e) { return 'ERR:'+e.message; }
    })()""" % json.dumps(tab_id), cdp_sw)
    c.send("Target.closeTarget", {"targetId": tid})
    try:
        arr = json.loads(urls)
    except Exception:
        arr = []
    return dbg, arr


EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"


def main():
    global EXT
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9490)
    ap.add_argument("--ext", default=EXT)
    a = ap.parse_args()
    EXT = a.ext

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    print("fixture 服务:", port)

    c = Cdp(a.port)

    # ---- W1/W2 详情页：白名单生效 ----
    dbg1, media1 = snif(c, port, "/explore/" + NOTE_ID)
    print("详情页 dbg:", dbg1, "SW 媒体数:", len(media1))
    txt1 = json.dumps(media1)
    ck("W1 本体图 A 上报（不误杀）", ("AAAA1111" in txt1), True)
    ck("W2 推荐封面 B 被过滤", ("DDDD4444" not in txt1), True)

    # ---- W3 非详情页：回退不过滤 ----
    dbg2, media2 = snif(c, port, "/root")
    print("根页 dbg:", dbg2, "SW 媒体数:", len(media2))
    txt2 = json.dumps(media2)
    ck("W3a 非详情页 A 上报", ("AAAA1111" in txt2), True)
    ck("W3b 非详情页 B 也上报（回退不漏下）", ("DDDD4444" in txt2), True)

    c.close()
    srv.shutdown()

    total = len(RES)
    ok_n = sum(1 for ok, _ in RES if ok)
    print("-" * 60)
    for ok, name in RES:
        if not ok:
            print("FAIL ->", name)
    print("%d/%d PASS" % (ok_n, total))
    return 0 if ok_n == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
