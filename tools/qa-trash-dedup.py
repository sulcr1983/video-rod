# -*- coding: utf-8 -*-
"""QA：回收站恢复「同内容消重」分支（ADR-079 C2）

流程：删一条 → 把回收站里那份原样复制回原位（内容完全一致）→ 点恢复
期望：不产生第二份文件（无 _restored_2），原位保留，卡片回来，回收站清空。
"""
import base64
import json
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cdp_client import Cdp  # noqa: E402

ROOT = r"D:\personal\Downloads\video-rod"
TRASH = os.path.join(ROOT, "_回收站")
EXT = os.environ.get("VR_EXT", "ceogmckiinjolbbdkjfelmfcfepccabp")
CDP = Cdp("http://127.0.0.1:%d" % int(os.environ.get("VR_CDP_PORT", "9480")))


def find_in_trash(name):
    for root, _dirs, files in os.walk(TRASH):
        if name in files:
            return os.path.join(root, name)
    return None


def main():
    tid = CDP.send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % EXT})["targetId"]
    s = CDP.attach(tid)
    CDP.send("Page.enable", {}, s)
    CDP.send("Runtime.enable", {}, s)
    CDP.send("Emulation.setDeviceMetricsOverride",
             {"width": 1440, "height": 800, "deviceScaleFactor": 1, "mobile": False}, s)
    time.sleep(7)

    def ev(e):
        return CDP.eval(e, s)

    n0 = ev("document.querySelectorAll('[data-id]').length")
    rel = ev("document.querySelector('[data-id]').dataset.id")
    name = rel.split("/")[-1]
    fs = rel[len("video-rod/"):] if rel.startswith("video-rod/") else rel
    abs_path = os.path.join(ROOT, fs.replace("/", os.sep))
    print("条目", rel, "\n卡片", n0, "| 文件存在", os.path.exists(abs_path))

    ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='选择');b&&b.click();return 1})()")
    time.sleep(1.2)
    ev("(()=>{const c=document.querySelector('[data-id]');c&&c.click();return 1})()")
    time.sleep(1)
    ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='删除到回收站');b&&b.click();return 1})()")
    time.sleep(2)
    ev("(()=>{const bs=[...document.querySelectorAll('button')].filter(x=>/^(删除|确定)$/.test(x.innerText.trim()));bs.forEach(b=>b.click());return 1})()")
    time.sleep(2.5)
    print("删除后卡片", ev("document.querySelectorAll('[data-id]').length"))

    src = find_in_trash(name)
    print("回收站内副本", src)
    if not src:
        print("!! 回收站里找不到副本，用例无法进行")
        return 2
    size = os.path.getsize(src)
    shutil.copy2(src, abs_path)          # 原位放回「完全一致」的一份
    print("原位已放回同内容文件", size, "字节")

    ev("(()=>{const b=document.querySelector('#trashBtn');b&&b.click();return 1})()")
    time.sleep(2)
    ev("""(()=>{const b=document.querySelector('button[title="恢复"]');if(!b)return 0;b.click();return 1})()""")
    time.sleep(4)

    stem, ext = os.path.splitext(abs_path)
    alt = stem + "_restored" + ext
    alt2 = stem + "_restored_2" + ext
    checks = [
        ("原位文件仍在且大小不变", os.path.exists(abs_path) and os.path.getsize(abs_path) == size),
        ("没有生成 _restored 副本", not os.path.exists(alt)),
        ("没有生成 _restored_2 副本", not os.path.exists(alt2)),
        ("回收站副本已删除", not os.path.exists(src)),
        ("卡片数回到原值", ev("document.querySelectorAll('[data-id]').length") == n0),
    ]
    bad = 0
    for nm, okv in checks:
        print(("  PASS " if okv else "  FAIL ") + nm)
        if not okv:
            bad += 1

    r = CDP.send("Page.captureScreenshot", {"format": "png"}, s)
    p = os.path.abspath(os.path.join(os.path.dirname(HERE), "..", "work", "qa-trash-dedup.png"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(base64.b64decode(r["data"]))
    print("截图", p)
    print("\n结果：%d 通过 / %d 失败" % (len(checks) - bad, bad))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    try:
        rc = main()
    finally:
        CDP.created.clear()
    sys.exit(rc)
