# -*- coding: utf-8 -*-
"""README 截图 · 常驻操纵台（复用同一实例，标签页跨命令保留）

子命令：
    tab <url-path>            打开/复用扩展页面（如 library.html），保持可见
    eval "<js>"               在最后一次打开的页面里求值
    shot <name> [--w 1440] [--h 900] [--full]   原始图落 ..\\work\\readme-shots\\
    list                      列出当前标签页
"""
import argparse
import base64
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cdp_client import Cdp, find_ext_id  # noqa: E402

from vr_testenv import work_path  # noqa: E402

OUT_DIR = work_path("readme-shots")   # 原始截图写仓库外 ..\work\，不进 git
os.makedirs(OUT_DIR, exist_ok=True)
CDP = Cdp("http://127.0.0.1:9480")
CDP.created = []          # 保住标签页：不让 atexit 关闭


def show(session):
    return session


def open_tab(path, w=1440, h=900):
    ext_id, _ = find_ext_id(CDP)
    url = "chrome-extension://%s/%s" % (ext_id, path)
    tab = CDP.find(lambda t: t.get("type") == "page" and t.get("url", "").split("?")[0] == url)
    if tab:
        s = CDP.attach(tab["targetId"])
        print("[复用]", tab["targetId"], url)
    else:
        tid = CDP.send("Target.createTarget", {"url": "about:blank"})["targetId"]
        s = CDP.attach(tid)
        CDP.send("Page.enable", {}, s)
        CDP.send("Runtime.enable", {}, s)
        CDP.send("Emulation.setDeviceMetricsOverride", {
            "width": w, "height": h, "deviceScaleFactor": 2, "mobile": False}, s)
        CDP.send("Page.navigate", {"url": url}, s)
        time.sleep(3.5)
        print("[新建]", tid, url)
    CDP.send("Page.enable", {}, s)
    CDP.send("Runtime.enable", {}, s)
    CDP.send("Emulation.setDeviceMetricsOverride", {
        "width": w, "height": h, "deviceScaleFactor": 2, "mobile": False}, s)
    with open(os.path.join(OUT_DIR, ".last_target"), "w") as f:
        f.write(url + "\n" + (tab["targetId"] if tab else tid))
    CDP.created.clear()          # 别让 atexit 把我们刚建的标签页关掉
    return s


def last_session():
    """sessionId 绑定在 websocket 连接上，跨进程会失效 —— 每轮回用 targetId 重新 attach。"""
    p = os.path.join(OUT_DIR, ".last_target")
    if not os.path.exists(p):
        raise SystemExit("先用 tab 子命令打开页面")
    url, tid = open(p).read().strip().split("\n")
    s = CDP.attach(tid)
    CDP.send("Page.enable", {}, s)
    CDP.send("Runtime.enable", {}, s)
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd")
    ap.add_argument("arg", nargs="?", default="")
    ap.add_argument("--w", type=int, default=1440)
    ap.add_argument("--h", type=int, default=900)
    ap.add_argument("--full", action="store_true")
    a = ap.parse_args()

    if a.cmd == "list":
        for t in CDP.targets():
            if t.get("type") == "page":
                print(t["targetId"], t.get("url", "")[:110])
        return 0

    if a.cmd == "tab":
        open_tab(a.arg, a.w, a.h)
        return 0

    s = last_session()

    if a.cmd == "eval":
        v = CDP.eval(a.arg, s)
        print(json.dumps(v, ensure_ascii=False, indent=1)[:12000])
        return 0

    if a.cmd == "shot":
        CDP.send("Emulation.setDeviceMetricsOverride", {
            "width": a.w, "height": a.h, "deviceScaleFactor": 2, "mobile": False}, s)
        time.sleep(0.6)
        # 等缩略图队列把 blob 贴到卡片上（懒生成：不等就会拍到占位纹）
        for i in range(80):
            st = CDP.eval(
                "(() => { const cards = document.querySelectorAll('[data-id]').length;"
                " const im = [...document.querySelectorAll('img[data-thumb]')];"
                " return {cards: cards, imgs: im.length,"
                " good: im.filter(x => x.naturalWidth > 0).length}; })()", s)
            ok = (isinstance(st, dict) and st.get("cards") and st["cards"] == st["imgs"]
                  and st["good"] == st["cards"])
            if ok:
                break
            time.sleep(0.35)
        print("  缩略图状态", st)
        time.sleep(0.9)          # 让入场动画收尾
        params = {"format": "png", "captureBeyondViewport": a.full}
        res = CDP.send("Page.captureScreenshot", params, s)
        path = os.path.join(OUT_DIR, a.arg + ".png")
        with open(path, "wb") as f:
            f.write(base64.b64decode(res["data"]))
        print("[shot]", path, len(res["data"]) // 1024, "KB")
        return 0

    if a.cmd == "click":
        # 坐标点击（封闭 shadow DOM 里的元素只能这么点）：click x y
        x, y = [int(v) for v in a.arg.split()]
        CDP.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y}, s)
        CDP.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y,
                                              "button": "left", "clickCount": 1}, s)
        CDP.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y,
                                              "button": "left", "clickCount": 1}, s)
        print("[click]", x, y)
        return 0

    raise SystemExit("未知子命令 " + a.cmd)


if __name__ == "__main__":
    sys.exit(main())
