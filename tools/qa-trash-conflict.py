# -*- coding: utf-8 -*-
"""QA：回收站恢复遇同名冲突（ADR-079）真机验证

用例：
  C1 删一条 → 在原相对路径写一份「不同内容」的同名文件 → 点恢复
     → 期望：原文件不被覆盖；出现 `<名>_restored.<ext>`；库内卡片回到原位
  C2 再删那条改名后的条目 → 原路径保留同名同内容文件 → 点恢复
     → 期望：判为同内容，直接消重（不产生第二份），条目从回收站消失

用法：python tools/qa-trash-conflict.py   （实例由外部起，端口 9480）
"""
import base64
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cdp_client import Cdp  # noqa: E402

ROOT = r"D:\personal\Downloads"
PORT = int(os.environ.get("VR_CDP_PORT", "9480"))
EXT = os.environ.get("VR_EXT", "ceogmckiinjolbbdkjfelmfcfepccabp")
CDP = Cdp("http://127.0.0.1:%d" % PORT)
DUMMY = b"not-the-same-content-%d" % int(time.time())

ok_n = 0
fail_n = 0


def ck(name, cond, extra=""):
    global ok_n, fail_n
    if cond:
        ok_n += 1
        print("  PASS", name)
    else:
        fail_n += 1
        print("  FAIL", name, extra)


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

    def shot(name):
        r = CDP.send("Page.captureScreenshot", {"format": "png"}, s)
        p = os.path.join(os.path.dirname(HERE), "..", "work", "qa-trash-%s.png" % name)
        p = os.path.abspath(p)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        print("   截图", p)

    n0 = ev("document.querySelectorAll('[data-id]').length")
    print("库内卡片", n0)
    if not n0:
        print("!! 库是空的，无法测")
        return 2

    rel = ev("document.querySelector('[data-id]').dataset.id")
    print("选中条目", rel)
    fs = rel[len("video-rod/"):] if rel.startswith("video-rod/") else rel
    abs_src = os.path.join(ROOT, "video-rod", fs.replace("/", os.sep))
    orig_size = os.path.getsize(abs_src) if os.path.exists(abs_src) else -1
    print("原文件", abs_src, orig_size, "字节")

    # --- C1：删 → 占位异内容 → 恢复 ---
    ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='选择');b&&b.click();return 1})()")
    time.sleep(1.2)
    ev("(()=>{const c=document.querySelector('[data-id]');c&&c.click();return 1})()")
    time.sleep(1)
    ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='删除到回收站');b&&b.click();return 1})()")
    time.sleep(2)
    ev("(()=>{const bs=[...document.querySelectorAll('button')].filter(x=>/^(删除|确定)$/.test(x.innerText.trim()));bs.forEach(b=>b.click());return 1})()")
    time.sleep(2.5)
    n1 = ev("document.querySelectorAll('[data-id]').length")
    ck("C1a 条目已移入回收站", n1 == n0 - 1, "before=%s after=%s" % (n0, n1))
    ck("C1b 原路径已空出", not os.path.exists(abs_src))

    with open(abs_src, "wb") as f:
        f.write(DUMMY)
    print("  已写入占位文件", len(DUMMY), "字节")

    ev("(()=>{const b=document.querySelector('#trashBtn');b&&b.click();return 1})()")
    time.sleep(2)
    ev("""(()=>{const b=document.querySelector('button[title="恢复"]');if(!b)return 0;b.click();return 1})()""")
    time.sleep(3.5)

    stem, ext = os.path.splitext(abs_src)
    alt = stem + "_restored" + ext
    ck("C1c 原位置的占位文件未被覆盖",
       os.path.exists(abs_src) and os.path.getsize(abs_src) == len(DUMMY))
    ck("C1d 出现 _restored 改名文件", os.path.exists(alt),
       "期望 %s" % alt)
    if os.path.exists(alt):
        ck("C1e 改名文件内容=原文件（大小一致）", os.path.getsize(alt) == orig_size,
           "got=%s expect=%s" % (os.path.getsize(alt), orig_size))
    ck("C1f 库内卡片数回到原值", ev("document.querySelectorAll('[data-id]').length") == n0)
    shot("c1")

    # --- C2：同名同内容 → 消重 ---
    rel2 = None
    for _ in range(3):
        r = ev("document.querySelectorAll('[data-id]').length")
        print("  当前卡片", r)
        break
    # 找到 _restored 那条，把它再删掉（回收站里），然后恢复
    target = rel[:-len(rel.split("/")[-1])] + os.path.basename(alt)
    print("C2 目标条目", target)

    # 用「移动到回收站」的批量通道删它
    ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='选择');b&&b.click();return 1})()")
    time.sleep(1.2)
    clicked = ev("""(()=>{const c=[...document.querySelectorAll('[data-id]')].find(x=>x.dataset.id===%s);
        if(!c)return 0;c.click();return 1})()""" % json.dumps(target))
    ck("C2a 找到改名后的卡片", clicked == 1)
    if not clicked:
        return 0
    time.sleep(1)
    ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='删除到回收站');b&&b.click();return 1})()")
    time.sleep(2)
    ev("(()=>{const bs=[...document.querySelectorAll('button')].filter(x=>/^(删除|确定)$/.test(x.innerText.trim()));bs.forEach(b=>b.click());return 1})()")
    time.sleep(2.5)
    ck("C2b 改名文件已被移走", not os.path.exists(alt))
    # 从回收站里读回那份，原样放回原位 —— 保证「内容完全一致」，才能测到消重分支
    trash_dir = os.path.join(ROOT, "video-rod", "_回收站")
    src = None
    for b in sorted(os.listdir(trash_dir)) if os.path.isdir(trash_dir) else []:
        cand = os.path.join(trash_dir, b, fs.replace("/", os.sep))
        if os.path.exists(cand):
            src = cand
    if src:
        with open(src, "rb") as f:
            data = f.read()
        with open(alt, "wb") as f:
            f.write(data)
        print("  已在原位放回同内容文件", len(data), "字节")
    ck("C2c 原位已有同内容文件", os.path.exists(alt) and os.path.getsize(alt) > 0)

    ev("(()=>{const b=document.querySelector('#trashBtn');b&&b.click();return 1})()")
    time.sleep(2)
    n_before = ev("document.querySelectorAll('[data-id]').length")
    ev("""(()=>{const b=document.querySelector('button[title="恢复"]');if(!b)return 0;b.click();return 1})()""")
    time.sleep(3.5)
    alt2 = stem + "_restored_2" + ext
    ck("C2d 同内容不产生第二份（无 _restored_2）", not os.path.exists(alt2))
    ck("C2e 原位文件仍在", os.path.exists(alt) and os.path.getsize(alt) > 0)
    ck("C2f 卡片数回到删除前", ev("document.querySelectorAll('[data-id]').length") == n_before)
    shot("c2")
    return 0


if __name__ == "__main__":
    try:
        rc = main()
    finally:
        CDP.created.clear()
    print("\n结果：%d 通过 / %d 失败" % (ok_n, fail_n))
    sys.exit(0 if fail_n == 0 else 1)
