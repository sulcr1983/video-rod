# -*- coding: utf-8 -*-
"""调试：popup 里 storage 的实际值 + settings 对象 + 入口 display。"""
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
PROF = os.path.join(ROOT, "..", "work", "profiles", "dbg-libintro-" + time.strftime("%H%M%S"))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def op():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def get_json(port, path):
    return json.loads(op().open("http://127.0.0.1:%d%s" % (port, path), timeout=5).read().decode("utf8", "replace"))


def main():
    os.makedirs(PROF, exist_ok=True)
    port = free_port()
    proc = subprocess.Popen([
        EDGE, "--user-data-dir=" + PROF,
        "--disable-extensions-except=" + DIST, "--load-extension=" + DIST,
        "--remote-debugging-port=%d" % port, "--no-first-run", "--no-default-browser-check",
    ])
    ws = None
    try:
        end = time.time() + 40
        while time.time() < end:
            try:
                get_json(port, "/json/version"); break
            except Exception:
                time.sleep(0.4)

        eid = None
        for _ in range(40):
            try:
                raw = op().open("http://127.0.0.1:%d/json/list" % port, timeout=5).read().decode("utf8", "replace")
                for m in re.finditer(r"chrome-extension://([a-p]{32})/([a-zA-Z0-9_.-]+\.html)", raw):
                    if m.group(2) in ("install.html", "popup.html", "library.html", "options.html"):
                        eid = m.group(1); break
                if eid:
                    break
            except Exception:
                pass
            time.sleep(0.5)
        print("扩展 ID:", eid)

        from websocket import create_connection
        ver = get_json(port, "/json/version")
        bws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        bmid = [0]

        def bcall(method, params=None):
            bmid[0] += 1
            bws.send(json.dumps({"id": bmid[0], "method": method, "params": params or {}}))
            while True:
                r = json.loads(bws.recv())
                if r.get("id") == bmid[0]:
                    return r.get("result", {})

        bcall("Target.createTarget", {"url": "chrome-extension://%s/popup.html" % eid})
        time.sleep(3)
        page = None
        for t in get_json(port, "/json/list"):
            if t.get("type") == "page" and t.get("url", "").endswith("/popup.html"):
                page = t
        ws = create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        mid = [0]

        def call(method, params=None):
            mid[0] += 1
            ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
            while True:
                r = json.loads(ws.recv())
                if r.get("id") == mid[0]:
                    return r.get("result", {})

        def js(expr):
            r = call("Runtime.evaluate", {"expression": expr, "awaitPromise": True,
                                          "returnByValue": True, "userGesture": True})
            if r.get("exceptionDetails"):
                return {"__err": r["exceptionDetails"].get("text")}
            return r.get("result", {}).get("value")

        time.sleep(2.5)

        print("\n--- storage 实际值 ---")
        st = js("new Promise(function(res){ chrome.storage.local.get(null, function(o){ res(o); }); })")
        keys_of_interest = {k: v for k, v in (st or {}).items()
                            if 'vrLibIntro' in k or 'vrSettings' in k}
        print(json.dumps(keys_of_interest, ensure_ascii=False, default=str)[:600])

        print("\n--- 页面里的 settings 对象（不暴露闭包，改由 checkbox 反推） ---")
        chk = js("var b=document.getElementById('vrSetLibrary'); b ? b.checked : null")
        print("vrSetLibrary checkbox:", chk)

        print("\n--- 三个入口的 display ---")
        vis = js("""(function(){
            function d(id){ var e=document.getElementById(id);
                return e ? getComputedStyle(e).display : 'missing'; }
            return {pill:d('vrOpenLibrary'), drawer:d('vrOpenLibraryDrawer'), set:d('vrOpenLibrarySettings')};
        })()""")
        print(json.dumps(vis, ensure_ascii=False))

        print("\n--- 手动改 storage.libraryEnabled=false 再看（不重开页面） ---")
        js("""new Promise(function(res){
            chrome.storage.local.get(['vrSettings'], function(r){
                var s=(r&&r.vrSettings)||{}; s.libraryEnabled=false;
                chrome.storage.local.set({vrSettings:s}, function(){ res(1); });
            });
        })""")
        time.sleep(0.5)
        # 重新读回验证写入
        back = js("new Promise(function(res){ chrome.storage.local.get(['vrSettings'], function(r){ res(r&&r.vrSettings); }); })")
        print("写回后 vrSettings.libraryEnabled =", (back or {}).get("libraryEnabled"))

        # 手动触发 applyLibraryVisibility 的等效逻辑（模拟重开）
        vis2 = js("""(function(){
            // 直接模拟 loadSettings 读到 false 后的判断
            function d(id){ var e=document.getElementById(id);
                return e ? getComputedStyle(e).display : 'missing'; }
            var box = document.getElementById('vrSetLibrary');
            var enabled = box ? box.checked : null;
            return {checkboxChecked: enabled,
                    pill:d('vrOpenLibrary'), drawer:d('vrOpenLibraryDrawer')};
        })()""")
        print("不重开页面的状态:", json.dumps(vis2, ensure_ascii=False))

        print("\n--- 重开页面再查 ---")
        bcall("Target.createTarget", {"url": "chrome-extension://%s/popup.html" % eid})
        time.sleep(3)
        page2 = None
        for t in get_json(port, "/json/list"):
            if t.get("type") == "page" and t.get("url", "").endswith("/popup.html") and t != page:
                page2 = t
        ws.close()
        ws = create_connection(page2["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        time.sleep(1.5)
        vis3 = js("""(function(){
            function d(id){ var e=document.getElementById(id);
                return e ? getComputedStyle(e).display : 'missing'; }
            var box = document.getElementById('vrSetLibrary');
            return {checkboxChecked: box ? box.checked : null,
                    pill:d('vrOpenLibrary'), drawer:d('vrOpenLibraryDrawer')};
        })()""")
        print("重开后:", json.dumps(vis3, ensure_ascii=False))

        print("\n--- vrLibIntroSeen 实际值（B6 排查） ---")
        lib = js("new Promise(function(res){ chrome.storage.local.get(['vrLibIntroDone','vrLibIntroSeen'], function(o){ res(o); }); })")
        print(json.dumps(lib, ensure_ascii=False))

        return 0
    finally:
        try:
            if ws: ws.close()
        except Exception:
            pass
        try: proc.wait(timeout=10)
        except Exception: pass
        time.sleep(1.2)
        ps = ("Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
              "Where-Object { $_.CommandLine -like '*dbg-libintro*' } | ForEach-Object { $_.ProcessId }")

        def left():
            o = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps],
                               capture_output=True, text=True, timeout=30).stdout
            return [x.strip() for x in o.split() if x.strip().isdigit()]

        for _ in range(10):
            if not left(): break
            time.sleep(0.6)
        for p in left():
            subprocess.run(["taskkill", "/PID", p, "/F"], capture_output=True)
        for _ in range(10):
            if not left(): break
            time.sleep(0.6)
        print("回收复核 left=%d" % len(left()))


if __name__ == "__main__":
    sys.exit(main())
