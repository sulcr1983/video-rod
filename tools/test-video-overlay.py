# 页内视频悬浮按钮 真机验证（星愿 9223）
# 1) 重载扩展 2) 打开 B站 3) 模拟鼠标移入视频 → 按钮应出现在左上角
# 4) 点小箭头 → 清晰度菜单 5) 点大图标 → 一键下载 → 校验落盘
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp
from vr_testenv import dl_dir, warn_daily_browser

CDP_URL = os.environ.get("VR_CDP", "http://127.0.0.1:9223")
EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
BILI_URL = os.environ.get("VR_URL", "https://www.bilibili.com/video/BV1DVaZ6hEK6/")
# 2026-11-08：不再写死 E:\personal\Downloads（那个目录根本不存在，
# 且真实下载目录是 D:\personal\Downloads）。测试产物一律进仓库内 work/dl。
DL_DIR = dl_dir("overlay")

CDP = Cdp(CDP_URL)


def reload_ext():
    for attempt in range(3):
        try:
            sw = next(t for t in CDP.targets()
                      if t.get("url", "").endswith(f"{EXT_ID}/js/background.js"))
            sid = CDP.attach(sw["targetId"])
            CDP.send("Runtime.enable", {}, sid)
            CDP.eval("chrome.runtime.reload()", sid)
            time.sleep(5)
            print("扩展已重载")
            return
        except Exception as e:
            print("  重载尝试", attempt, "失败:", str(e)[:70])
            time.sleep(3)
    raise RuntimeError("扩展重载失败")


def main():
    reload_ext()
    time.sleep(6)
    CDP.send("Browser.setDownloadBehavior",
             {"behavior": "allow", "downloadPath": DL_DIR, "eventsEnabled": True})

    tab = None
    for t in CDP.targets():
        if t.get("type") == "page" and "bilibili.com/video" in t.get("url", ""):
            tab = t
            break
    if not tab:
        tid = CDP.send("Target.createTarget", {"url": BILI_URL})["targetId"]
        time.sleep(15)
        tab = next(t for t in CDP.targets() if t["targetId"] == tid)
    psid = CDP.attach(tab["targetId"])
    print("页面:", tab.get("url"))

    # 等 video 出现
    vinfo = None
    for _ in range(20):
        vinfo = CDP.eval(r"""
          (() => { const v = document.querySelector('video');
            if (!v) return null;
            const r = v.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height),
                     left: Math.round(r.left), top: Math.round(r.top) }; })()
        """, psid)
        if vinfo and vinfo.get("w", 0) > 200:
            break
        time.sleep(2)
    print("\n[1] 页面 video:", json.dumps(vinfo))
    if not vinfo:
        print("  ❌ 没找到够大的 video")
        return

    # 浮层是否存在
    exist = CDP.eval("!!document.querySelector('.vr-vob')", psid)
    print("[2] 浮层已注入:", exist)
    if not exist:
        print("  ❌ 浮层没注入")
        return

    # 模拟鼠标移入视频
    CDP.eval(r"""
      (() => { const v = document.querySelector('video');
        v.dispatchEvent(new MouseEvent('mouseenter', {bubbles:false}));
        return true; })()
    """, psid)
    time.sleep(1)
    st = CDP.eval(r"""
      (() => { const p = document.querySelector('.vr-vob');
        const r = p.getBoundingClientRect();
        return { on: p.classList.contains('vr-on'), opacity: getComputedStyle(p).opacity,
                 left: Math.round(r.left), top: Math.round(r.top),
                 w: Math.round(r.width), h: Math.round(r.height),
                 z: getComputedStyle(p).zIndex }; })()
    """, psid)
    print("[3] 鼠标移入后按钮:", json.dumps(st))
    if not st.get("on"):
        print("  ❌ 按钮没显示")
        return
    # 位置应落在视频左上角附近
    ok_pos = (abs(st["left"] - vinfo["left"]) < 60 and abs(st["top"] - vinfo["top"]) < 60)
    print("    位置在视频左上角:", ok_pos, "(视频 %s,%s / 按钮 %s,%s)"
          % (vinfo["left"], vinfo["top"], st["left"], st["top"]))

    # 点小箭头 → 清晰度菜单
    CDP.eval("document.querySelector('.vr-vob-more').click()", psid)
    time.sleep(3)
    menu = CDP.eval(r"""
      (() => { const m = document.querySelector('.vr-vob-menu');
        return { open: m.classList.contains('vr-open'),
                 items: [...m.querySelectorAll('.vr-vob-item')].map(b => b.textContent.trim()),
                 empty: (m.querySelector('.vr-vob-empty')||{}).textContent || '' }; })()
    """, psid)
    print("[4] 清晰度菜单:", json.dumps(menu, ensure_ascii=False))

    # 收起菜单，点大图标一键下载
    CDP.eval("document.querySelector('.vr-vob-more').click()", psid)
    time.sleep(0.5)
    before = set(os.listdir(DL_DIR))
    CDP.eval("document.querySelector('.vr-vob-main').click()", psid)
    print("[5] 已点大图标（一键最高清）")

    # 盯按钮状态
    deadline = time.time() + 240
    last = None
    while time.time() < deadline:
        time.sleep(2)
        s = CDP.eval(r"""
          (() => { const p = document.querySelector('.vr-vob');
            const pct = p.querySelector('.vr-vob-pct');
            return { busy: p.classList.contains('vr-busy'),
                     done: p.classList.contains('vr-done'),
                     warn: p.classList.contains('vr-warn'),
                     pct: pct ? pct.textContent : '' }; })()
        """, psid)
        tag = ("done" if s["done"] else "warn" if s["warn"]
               else "busy " + (s["pct"] or "") if s["busy"] else "idle")
        if tag != last:
            print("   按钮状态:", tag)
            last = tag
        if s["done"] or s["warn"]:
            break

    time.sleep(6)
    after = set(os.listdir(DL_DIR))
    new_files = [f for f in (after - before) if f.endswith(".mp4")]
    print("\n[6] 新落盘文件:")
    for f in new_files:
        fp = os.path.join(DL_DIR, f)
        print("   ", f, os.path.getsize(fp), "bytes")
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "format=duration,size:stream=codec_name,codec_type,width,height",
             "-of", "default=noprint_wrappers=1", fp],
            capture_output=True, text=True, timeout=120)
        print("   " + (out.stdout or out.stderr).replace("\n", "\n   "))
    if not new_files:
        print("   ❌ 没有新文件")


if __name__ == "__main__":
    main()
