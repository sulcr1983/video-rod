# -*- coding: utf-8 -*-
"""截图：媒体库入口引导原型（三个场景各一张）。

有头实例纪律：自建 profile + 自建端口 + 同一命令内跑完并精确回收。
"""
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROTO = os.path.join(ROOT, "deliverables", "prototypes", "library-entry-guide-v1.html")
OUT = os.path.join(ROOT, "..", "work", "shots")
PROFILE = os.path.join(ROOT, "..", "work", "profiles", "shot-proto")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def op():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def get_json(port, path):
    return json.loads(op().open("http://127.0.0.1:%d%s" % (port, path), timeout=5).read().decode("utf8", "replace"))


def main():
    os.makedirs(OUT, exist_ok=True)
    if os.path.isdir(PROFILE):
        shutil.rmtree(PROFILE, ignore_errors=True)
    port = free_port()
    url = "file:///" + PROTO.replace("\\", "/")
    proc = subprocess.Popen([
        EDGE, "--user-data-dir=" + PROFILE,
        "--remote-debugging-port=%d" % port, "--remote-debugging-address=127.0.0.1",
        "--no-first-run", "--no-default-browser-check",
        "--window-size=1500,1080", "--hide-scrollbars",
        url,
    ])
    ws = None
    try:
        end = time.time() + 40
        while time.time() < end:
            try:
                get_json(port, "/json/version"); break
            except Exception:
                time.sleep(0.4)
        else:
            print("FAIL CDP"); return 1

        page = None
        for _ in range(20):
            for t in get_json(port, "/json/list"):
                if t.get("type") == "page" and "library-entry-guide" in t.get("url", ""):
                    page = t; break
            if page: break
            time.sleep(0.5)
        if not page:
            print("FAIL 找不到页面"); return 1

        from websocket import create_connection
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
                print("  JS 异常:", r["exceptionDetails"].get("text"))
                return None
            return r.get("result", {}).get("value")

        # 收集 console 错误
        call("Log.enable")
        call("Runtime.enable")

        time.sleep(1.5)
        call("Emulation.setDeviceMetricsOverride", {
            "width": 1500, "height": 1080, "deviceScaleFactor": 1, "mobile": False})

        shots = [
            ("v-install", "01-install-gate"),
            ("v-popup", "02-popup-mask"),
            ("v-home", "03-longterm-pill"),
        ]
        for view, name in shots:
            js("""(function(){
                document.querySelectorAll('.view').forEach(function(v){v.classList.remove('on');});
                document.getElementById('%s').classList.add('on');
                window.scrollTo(0,0);
            })()""" % view)
            time.sleep(0.7)
            r = call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
            p = os.path.join(OUT, name + ".png")
            with open(p, "wb") as f:
                f.write(base64.b64decode(r["data"]))
            print("已截图:", p)

        # 场景二补一张「点过收藏夹之后」的状态
        js("""(function(){
            document.querySelectorAll('.view').forEach(function(v){v.classList.remove('on');});
            document.getElementById('v-popup').classList.add('on');
            var b=document.getElementById('bm2'); if(b){b.dataset.done='1';b.textContent='✓ 已在收藏夹';
              b.classList.remove('btn-line','btn-gold');b.classList.add('done');}
        })()""")
        time.sleep(0.5)
        r = call("Page.captureScreenshot", {"format": "png"})
        p = os.path.join(OUT, "04-popup-bookmarked.png")
        with open(p, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        print("已截图:", p)

        errs = js("(window.__errs||[]).join(' | ')")
        print("页面错误:", errs or "(无)")
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
              "Where-Object { $_.CommandLine -like '*shot-proto*' } | ForEach-Object { $_.ProcessId }")
        try:
            out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps],
                                 capture_output=True, text=True, timeout=30).stdout
            for p in [x.strip() for x in out.split() if x.strip().isdigit()]:
                subprocess.run(["taskkill", "/PID", p, "/F"], capture_output=True)
            left = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps],
                                  capture_output=True, text=True, timeout=30).stdout
            print("回收复核 left=%d" % len([x for x in left.split() if x.strip().isdigit()]))
        except Exception as e:
            print("回收异常:", e)
        shutil.rmtree(PROFILE, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
