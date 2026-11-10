# -*- coding: utf-8 -*-
"""探针：为什么 popup.html 打不开（ERR_FILE_NOT_FOUND）？

列出真实页面列表与扩展 ID，确认是 ID 探测错、还是 dist 里缺文件。
"""
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
PROF = os.path.join(ROOT, "..", "work", "profiles", "idprobe-" + time.strftime("%H%M%S"))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def main():
    os.makedirs(PROF, exist_ok=True)
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    proc = subprocess.Popen([
        EDGE, "--user-data-dir=" + PROF,
        "--disable-extensions-except=" + DIST, "--load-extension=" + DIST,
        "--remote-debugging-port=%d" % port, "--no-first-run", "--no-default-browser-check",
    ])
    try:
        end = time.time() + 40
        while time.time() < end:
            try:
                op.open("http://127.0.0.1:%d/json/version" % port, timeout=3); break
            except Exception:
                time.sleep(0.4)
        time.sleep(5)
        raw = op.open("http://127.0.0.1:%d/json/list" % port, timeout=5).read().decode("utf8", "replace")
        pages = json.loads(raw)
        print("页面列表:")
        for t in pages:
            print("  ", t.get("type"), "|", (t.get("url") or "")[:120])
        ids = set(re.findall(r"chrome-extension://([a-p]{32})/", raw))
        print("探测到扩展 ID:", ids or "(无 —— 说明没有扩展页面打开)")
        print("dist 路径:", DIST)
        print("dist/popup.html 存在:", os.path.isfile(os.path.join(DIST, "popup.html")))
        print("dist/js/popup-videorod.js 存在:", os.path.isfile(os.path.join(DIST, "js", "popup-videorod.js")))
        # 检查 dist 里是否含新增的 libintro 结构
        p = os.path.join(DIST, "popup.html")
        if os.path.isfile(p):
            txt = open(p, encoding="utf8", errors="replace").read()
            print("dist/popup.html 含 vrLibIntro:", "vrLibIntro" in txt)
            print("dist/popup.html 含 libpill:", "libpill" in txt)
    finally:
        try:
            proc.wait(timeout=8)
        except Exception:
            pass
        time.sleep(1.2)
        ps = ("Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
              "Where-Object { $_.CommandLine -like '*idprobe*' } | ForEach-Object { $_.ProcessId }")
        out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps],
                             capture_output=True, text=True, timeout=30).stdout
        for x in out.split():
            if x.strip().isdigit():
                subprocess.run(["taskkill", "/PID", x.strip(), "/F"], capture_output=True)
        left = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps],
                              capture_output=True, text=True, timeout=30).stdout
        print("已回收 left=%d" % len([x for x in left.split() if x.strip().isdigit()]))


if __name__ == "__main__":
    sys.exit(main())
