# -*- coding: utf-8 -*-
"""qa-pack-verify.py — 发布包真实加载验证（2026-11-09）

验证「发布包本身能用」，而不是只测仓库根：
  1. 解压 zip 到隔离目录（模拟用户拿到包）
  2. 用 --load-extension=<解压目录> 启动 Edge（不加载仓库根）
  3. 断言：SW 存活、popup 能开、页面能注入、扩展显示体积达标

这是对 93MB 事故的根治验证：只要加载的是 dist/解压物，
edge://extensions 显示的就是几 MB，而不是仓库根的几十 MB。

用法：python tools/qa-pack-verify.py [--zip <路径>] [--port 9495]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import http.server
import threading

from websocket import create_connection

WORK = r"D:\test\download\work"
EXTRACT = os.path.join(WORK, "pack-verify")
RESULTS = []


def ck(name, got, want):
    ok = got == want
    RESULTS.append((name, ok, got, want))
    print(("PASS" if ok else "FAIL"), name, "| got=", str(got)[:180], "| want=", str(want)[:120])


class Cdp:
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=10))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=40)
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
                if r.get("error"):
                    raise RuntimeError(str(r["error"])[:200])
                return r.get("result", {})

    def targets(self):
        return self.send("Target.getTargets", {})["targetInfos"]


def dir_size(p):
    n = 0
    for dp, dn, fn in os.walk(p):
        for f in fn:
            try:
                n += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return n


PAGE = b"<!doctype html><html><head><meta charset='utf-8'><title>pack verify</title></head>" \
       b"<body><h1>pack verify</h1><video src='/a.mp4' controls muted></video></body></html>"


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        body = PAGE if self.path == "/" else (b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 1024)
        self.send_response(200)
        self.send_header("Content-Type", "text/html" if self.path == "/" else "video/mp4")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", default=os.path.join(WORK, "vr-release", "video-rod-2.7.2.1.zip"))
    ap.add_argument("--port", type=int, default=9495)
    a = ap.parse_args()

    if not os.path.exists(a.zip):
        print("发布包不存在，先跑 node tools/pack-dist.js")
        return 2

    # 1) 解压
    if os.path.isdir(EXTRACT):
        shutil.rmtree(EXTRACT, ignore_errors=True)
    os.makedirs(EXTRACT, exist_ok=True)
    import zipfile
    with zipfile.ZipFile(a.zip) as z:
        z.extractall(EXTRACT)
        ck("P1 zip 无坏文件", z.testzip(), None)

    size = dir_size(EXTRACT)
    print("解压后体积: %.2f MB（%d 文件）" % (size / 1048576, sum(len(f) for _, _, f in os.walk(EXTRACT))))
    ck("P2 解压体积 < 8MB（浏览器显示的就是它）", size < 8 * 1048576, True)
    ck("P3 manifest 在根", os.path.exists(os.path.join(EXTRACT, "manifest.json")), True)

    # 2) 用**解压物**启动 Edge（关键：不加载仓库根）
    exe = None
    for c in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(c):
            exe = c
            break
    if not exe:
        print("找不到 Edge")
        return 2

    profile = os.path.join(WORK, "profile-packverify")
    shutil.rmtree(profile, ignore_errors=True)
    os.makedirs(profile, exist_ok=True)
    args = [exe,
            "--user-data-dir=%s" % profile,
            "--disable-extensions-except=%s" % EXTRACT,
            "--load-extension=%s" % EXTRACT,
            "--remote-debugging-port=%d" % a.port,
            "--remote-debugging-address=127.0.0.1",
            "--no-first-run", "--no-default-browser-check", "--disable-sync"]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(80):
            time.sleep(0.5)
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/json/version" % a.port, timeout=1)
                break
            except Exception:
                continue
        time.sleep(4)

        c = Cdp(a.port)
        mf = json.load(open(os.path.join(EXTRACT, "manifest.json"), encoding="utf-8"))
        sw_path = (mf.get("background") or {}).get("service_worker") or "js/background.js"

        sw = None
        ext = None
        for t in c.targets():
            u = t.get("url") or ""
            if t["type"] == "service_worker" and u.endswith(sw_path):
                sw = t["targetId"]
                mm = __import__("re").search(r"chrome-extension://([a-p]{32})", u)
                ext = mm.group(1) if mm else None
        ck("P4 发布包 SW 存活", bool(sw), True)
        if not ext:
            print("找不到发布包扩展 id")
            return 1

        # 3) popup 能开
        tid = c.send("Target.createTarget", {"url": "chrome-extension://%s/popup.html" % ext})["targetId"]
        sid = c.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        c.send("Runtime.enable", {}, sid)
        time.sleep(3)
        title = c.send("Runtime.evaluate",
                       {"expression": "document.title", "returnByValue": True},
                       sid).get("result", {}).get("value")
        ck("P5 发布包 popup 可开且有标题", bool(title), True)
        print("   popup title =", title)

        # 4) 页面能注入 content script
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        p = srv.server_address[1]
        tid2 = c.send("Target.createTarget", {"url": "http://127.0.0.1:%d/" % p})["targetId"]
        time.sleep(4)
        sws = c.send("Target.attachToTarget", {"targetId": sw, "flatten": True})["sessionId"]
        c.send("Runtime.enable", {}, sws)
        md = c.send("Runtime.evaluate", {
            "expression": "(async()=>{const o=await chrome.storage.session.get('MediaData');"
                          "return JSON.stringify(Object.keys(o.MediaData||{}));})()",
            "returnByValue": True, "awaitPromise": True}, sws).get("result", {}).get("value")
        ck("P6 发布包能嗅探页面媒体", isinstance(md, str) and len(json.loads(md)) >= 1, True)
        print("   MediaData tabs =", md)

        srv.shutdown()
        c.send("Target.closeTarget", {"targetId": tid})
        c.send("Target.closeTarget", {"targetId": tid2})
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        shutil.rmtree(profile, ignore_errors=True)

    n = len(RESULTS)
    p2 = sum(1 for x in RESULTS if x[1])
    print("\n==== 结果: %d/%d ====" % (p2, n))
    for name, ok, got, want in RESULTS:
        if not ok:
            print("  FAIL:", name, "got=", str(got)[:140], "want=", str(want)[:120])
    return 0 if p2 == n else 1


if __name__ == "__main__":
    sys.exit(main())
