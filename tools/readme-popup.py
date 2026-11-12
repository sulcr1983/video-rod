# -*- coding: utf-8 -*-
"""README 截图 · 面板（popup）：真实页面嗅探 → 面板截图。
用法：python tools/readme-popup.py <url> <out-name> [--w 400 --h 600]
"""
import argparse
import base64
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cdp_client import Cdp, find_ext_id, open_popup  # noqa: E402

from vr_testenv import work_path  # noqa: E402

OUT_DIR = work_path("readme-shots")   # 原始截图写仓库外 ..\work\，不进 git
os.makedirs(OUT_DIR, exist_ok=True)
CDP = Cdp("http://127.0.0.1:9480")


def shot(session, name):
    res = CDP.send("Page.captureScreenshot", {"format": "png"}, session)
    path = os.path.join(OUT_DIR, name + ".png")
    with open(path, "wb") as f:
        f.write(base64.b64decode(res["data"]))
    print("[shot]", path, len(res["data"]) // 1024, "KB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("name")
    ap.add_argument("--w", type=int, default=420)
    ap.add_argument("--h", type=int, default=620)
    ap.add_argument("--wait", type=float, default=15.0)
    a = ap.parse_args()

    psid, tab_id = open_popup(CDP, a.url)
    print("面板已开 tabId=%s" % tab_id)
    time.sleep(a.wait)
    CDP.send("Emulation.setDeviceMetricsOverride", {
        "width": a.w, "height": a.h, "deviceScaleFactor": 2, "mobile": False}, psid)
    time.sleep(1.5)
    rows = CDP.eval("(() => ({txt: document.body.innerText.slice(0,400), n: document.querySelectorAll('.media, .item, [data-url]').length}))()", psid)
    print(rows)
    shot(psid, a.name)
    CDP.created.clear()      # 保页面，方便后续再拍
    return 0


if __name__ == "__main__":
    sys.exit(main())
