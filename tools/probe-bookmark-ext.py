# -*- coding: utf-8 -*-
"""探针：chrome-extension:// 地址能不能进书签？

三个问题一次问清（都关系到方案能不能成立）：
  Q1 chrome.bookmarks.create 能否直接创建 chrome-extension:// 书签？
  Q2 创建后能不能读回来（真落盘，不是假成功）？
  Q3 默认书签栏（id="1"）能不能当父节点？否则只能落到「其他书签」。

用法：python tools/probe-bookmark-ext.py
遵守有头实例纪律：自建 profile、自建端口、同一条命令内跑完并精确回收。
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
PROFILE = os.path.join(ROOT, "..", "work", "profiles", "probe-bm")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
_op = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def wait_json(port, timeout=30):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            return json.loads(op.open("http://127.0.0.1:%d/json/list" % port, timeout=5).read().decode("utf8", "replace"))
        except Exception as e:
            last = e
            time.sleep(0.4)
    raise RuntimeError("CDP 未就绪: %r" % (last,))


def ext_id(port, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        try:
            raw = _op.open("http://127.0.0.1:%d/json/list" % port, timeout=3).read().decode("utf8", "replace")
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
    args = [
        EDGE,
        "--user-data-dir=" + PROFILE,
        "--disable-extensions-except=" + DIST,
        "--load-extension=" + DIST,
        "--remote-debugging-port=%d" % port,
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run", "--no-default-browser-check",
        "--window-size=1400,900",
    ]
    proc = subprocess.Popen(args)
    ws = None
    try:
        eid = ext_id(port)
        print("扩展 ID:", eid)
        if not eid:
            print("FAIL 拿不到扩展 ID")
            return 1

        targets = wait_json(port)
        page = None
        for t in targets:
            if t.get("type") == "page" and t.get("url", "").startswith("chrome-extension://" + eid):
                page = t
                break
        if not page:
            print("FAIL 没有扩展页面可供执行（install.html 应已自动打开）")
            print("现有页面:", [t.get("url") for t in targets if t.get("type") == "page"])
            return 1
        print("执行上下文:", page["url"])

        from websocket import create_connection
        ws = create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        mid = [0]

        def call(method, params=None):
            mid[0] += 1
            ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
            while True:
                r = json.loads(ws.recv())
                if r.get("id") == mid[0]:
                    if "error" in r:
                        raise RuntimeError(str(r["error"]))
                    return r.get("result", {})

        def js(expr):
            r = call("Runtime.evaluate", {
                "expression": expr, "awaitPromise": True,
                "returnByValue": True, "userGesture": True,
            })
            if r.get("exceptionDetails"):
                return {"__err": str(r["exceptionDetails"].get("text"))
                        + " " + str(r["exceptionDetails"].get("exception", {}).get("description", ""))}
            return r.get("result", {}).get("value")

        liburl = js("chrome.runtime.getURL('library.html')")
        print("\n媒体库地址:", liburl)

        print("\n--- Q0: 权限与 API ---")
        print("有 bookmarks API:", js("!!(chrome.bookmarks && chrome.bookmarks.create)"))
        print("manifest 声明权限:", js("chrome.runtime.getManifest().permissions.includes('bookmarks')"))

        print("\n--- Q1/Q2: 创建到「书签栏」(id=1) 并读回 ---")
        r1 = js("""new Promise(function(res){
            try {
              chrome.bookmarks.create({parentId:'1', title:'探针·媒体库', url: chrome.runtime.getURL('library.html')},
                function(node){
                  var e = chrome.runtime.lastError;
                  res({err: e ? e.message : null, node: node || null});
                });
            } catch (e) { res({err: 'throw: ' + e.message, node: null}); }
        })""")
        print("create 结果:", json.dumps(r1, ensure_ascii=False))

        if r1 and r1.get("node"):
            nid = r1["node"]["id"]
            r2 = js("""new Promise(function(res){
                chrome.bookmarks.get('%s', function(nodes){
                  var e = chrome.runtime.lastError;
                  res({err: e ? e.message : null, got: (nodes && nodes[0]) || null});
                });
            })""" % nid)
            print("读回结果:", json.dumps(r2, ensure_ascii=False))
            ok = bool(r2 and r2.get("got") and str(r2["got"].get("url", "")).startswith("chrome-extension://"))
            print("=> 书签可读回且 URL 正确:", ok)

        print("\n--- Q3: 列出书签树，看书签栏结构 ---")
        tree = js("""new Promise(function(res){
            chrome.bookmarks.getTree(function(t){
              var out = [];
              (function w(n, d){
                out.push({id:n.id, title:n.title, url:n.url||'', depth:d});
                (n.children||[]).forEach(function(c){ w(c, d+1); });
              })(t[0], 0);
              res(out);
            });
        })""")
        if isinstance(tree, list):
            for n in tree[:12]:
                print("  " * n["depth"], n["id"], "|", n["title"][:24], "|", (n["url"] or "")[:60])

        print("\n--- Q4: 无 userGesture 时能否创建（popup 里可能没有手势） ---")
        r4 = js("""new Promise(function(res){
            try {
              chrome.bookmarks.create({parentId:'1', title:'探针·无手势', url:'chrome-extension://%s/library.html'},
                function(node){ var e=chrome.runtime.lastError; res({err:e?e.message:null, id:(node||{}).id||null}); });
            } catch(e){ res({err:'throw: '+e.message, id:null}); }
        })""" % eid)
        print("create 结果:", json.dumps(r4, ensure_ascii=False))

        return 0
    finally:
        try:
            if ws:
                mid[0] += 1
                ws.send(json.dumps({"id": mid[0], "method": "Browser.close", "params": {}}))
                ws.recv()
        except Exception:
            pass
        try:
            proc.wait(timeout=10)
        except Exception:
            pass
        time.sleep(1.5)
        # 精确回收：只杀命令行里带自己 profile 的进程
        ps = ("Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
              "Where-Object { $_.CommandLine -like '*probe-bm*' } | "
              "ForEach-Object { $_.ProcessId }")
        try:
            out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps],
                                 capture_output=True, text=True, timeout=30).stdout
            pids = [x.strip() for x in out.split() if x.strip().isdigit()]
            for p in pids:
                subprocess.run(["taskkill", "/PID", p, "/F"], capture_output=True)
            left = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps],
                                  capture_output=True, text=True, timeout=30).stdout
            left_n = len([x for x in left.split() if x.strip().isdigit()])
            print("\n回收复核 left=%d" % left_n)
        except Exception as e:
            print("回收异常:", e)
        shutil.rmtree(PROFILE, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
