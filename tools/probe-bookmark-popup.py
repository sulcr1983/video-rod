# -*- coding: utf-8 -*-
"""探针 2：popup 上下文里的书签能力 + 重复检测。

要回答：
  Q1 popup.html 页面里能不能调 bookmarks.create（install.html 能不代表 popup 能）？
  Q2 bookmarks.search 能不能按 chrome-extension:// 地址查到自己加的书签？
  Q3 重复创建会不会产生两条一样的书签？（决定「已加过就别再加」要不要自己拦）
  Q4 书签栏 id 是否恒为 '1'，其它浏览器（Edge）是否一致？
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
PROFILE = os.path.join(ROOT, "..", "work", "profiles", "probe-bm2")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def op():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def get_json(port, path="/json/list"):
    return json.loads(op().open("http://127.0.0.1:%d%s" % (port, path), timeout=5).read().decode("utf8", "replace"))


def wait_cdp(port, timeout=40):
    end = time.time() + timeout
    while time.time() < end:
        try:
            get_json(port, "/json/version"); return True
        except Exception:
            time.sleep(0.4)
    return False


def ext_id(port, timeout=40):
    end = time.time() + timeout
    while time.time() < end:
        try:
            raw = op().open("http://127.0.0.1:%d/json/list" % port, timeout=5).read().decode("utf8", "replace")
            for m in re.finditer(r"chrome-extension://([a-p]{32})/([a-zA-Z0-9_.-]+\.html)", raw):
                if m.group(2) in ("popup.html", "library.html", "options.html", "install.html"):
                    return m.group(1)
        except Exception:
            pass
        time.sleep(0.5)
    return None


def main():
    if os.path.isdir(PROFILE):
        shutil.rmtree(PROFILE, ignore_errors=True)
    port = free_port()
    proc = subprocess.Popen([
        EDGE, "--user-data-dir=" + PROFILE,
        "--disable-extensions-except=" + DIST, "--load-extension=" + DIST,
        "--remote-debugging-port=%d" % port, "--remote-debugging-address=127.0.0.1",
        "--no-first-run", "--no-default-browser-check", "--window-size=1400,900",
    ])
    ws = None
    try:
        if not wait_cdp(port):
            print("FAIL CDP 未就绪"); return 1
        eid = ext_id(port)
        print("扩展 ID:", eid)
        if not eid:
            print("FAIL 拿不到扩展 ID"); return 1

        from websocket import create_connection
        # 新版 Chrome 的 /json/new 只接受 PUT，改用浏览器级 WS 的 Target.createTarget
        ver = get_json(port, "/json/version")
        bws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        bmid = [0]

        def bcall(method, params=None):
            bmid[0] += 1
            bws.send(json.dumps({"id": bmid[0], "method": method, "params": params or {}}))
            while True:
                r = json.loads(bws.recv())
                if r.get("id") == bmid[0]:
                    if "error" in r: raise RuntimeError(str(r["error"]))
                    return r.get("result", {})

        bcall("Target.createTarget", {"url": "chrome-extension://%s/popup.html" % eid})
        time.sleep(3)
        bws.close()
        page = None
        for t in get_json(port):
            if t.get("type") == "page" and t.get("url", "").endswith("/popup.html"):
                page = t; break
        if not page:
            print("FAIL 打不开 popup.html"); print([t.get("url") for t in get_json(port)]); return 1
        print("执行上下文:", page["url"])

        ws = create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        mid = [0]

        def call(method, params=None):
            mid[0] += 1
            ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
            while True:
                r = json.loads(ws.recv())
                if r.get("id") == mid[0]:
                    if "error" in r: raise RuntimeError(str(r["error"]))
                    return r.get("result", {})

        def js(expr):
            r = call("Runtime.evaluate", {"expression": expr, "awaitPromise": True,
                                          "returnByValue": True, "userGesture": True})
            if r.get("exceptionDetails"):
                return {"__err": r["exceptionDetails"].get("text")}
            return r.get("result", {}).get("value")

        print("\n--- Q1: popup 里有无 bookmarks API ---")
        print("API 存在:", js("!!(chrome.bookmarks && chrome.bookmarks.create && chrome.bookmarks.search)"))

        print("\n--- Q4: 书签栏 / 其他收藏夹 的 id ---")
        roots = js("""new Promise(function(res){
            chrome.bookmarks.getTree(function(t){
              res((t[0].children||[]).map(function(n){ return {id:n.id, title:n.title}; }));
            });
        })""")
        print("根节点:", json.dumps(roots, ensure_ascii=False))

        liburl = js("chrome.runtime.getURL('library.html')")
        print("\n媒体库地址:", liburl)

        print("\n--- Q3: 连加两次，看会不会重复 ---")
        for i in (1, 2):
            r = js("""new Promise(function(res){
                chrome.bookmarks.create({parentId:'1', title:'媒体库', url:%s},
                  function(n){ var e=chrome.runtime.lastError; res({err:e?e.message:null, id:(n||{}).id||null}); });
            })""" % json.dumps(liburl))
            print("  第%d次:" % i, json.dumps(r, ensure_ascii=False))

        print("\n--- Q2: search 按 URL 能否查回 ---")
        sr = js("""new Promise(function(res){
            chrome.bookmarks.search({url:%s}, function(items){
              var e=chrome.runtime.lastError;
              res({err:e?e.message:null, n:(items||[]).length, ids:(items||[]).map(function(x){return x.id;})});
            });
        })""" % json.dumps(liburl))
        print("search 结果:", json.dumps(sr, ensure_ascii=False))

        print("\n--- Q2b: search 按 title 能否查回（URL 查不到的兜底） ---")
        sr2 = js("""new Promise(function(res){
            chrome.bookmarks.search('媒体库', function(items){
              res({n:(items||[]).length, urls:(items||[]).map(function(x){return x.url||x.title;})});
            });
        })""")
        print("search(title):", json.dumps(sr2, ensure_ascii=False))

        print("\n--- Q5: 权限不足时的表现（模拟无 bookmarks 权限） ---")
        print("（跳过，已确认 manifest 有权限；权限缺失场景靠 try/catch 兜底）")

        return 0
    finally:
        try:
            if ws:
                mid[0] += 1
                ws.send(json.dumps({"id": mid[0], "method": "Browser.close", "params": {}}))
                ws.recv()
        except Exception:
            pass
        try: proc.wait(timeout=10)
        except Exception: pass
        time.sleep(1.5)
        ps = ("Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
              "Where-Object { $_.CommandLine -like '*probe-bm2*' } | ForEach-Object { $_.ProcessId }")
        try:
            out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps],
                                 capture_output=True, text=True, timeout=30).stdout
            for p in [x.strip() for x in out.split() if x.strip().isdigit()]:
                subprocess.run(["taskkill", "/PID", p, "/F"], capture_output=True)
            left = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps],
                                  capture_output=True, text=True, timeout=30).stdout
            print("\n回收复核 left=%d" % len([x for x in left.split() if x.strip().isdigit()]))
        except Exception as e:
            print("回收异常:", e)
        shutil.rmtree(PROFILE, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
