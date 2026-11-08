# B站 1080P（DASH+合成）真机端到端验证（星愿 9223）
# 1) 重载扩展  2) 打开 B站 页面  3) 开 popup 看横幅有没有两个清晰度按钮
# 4) 点「高清」按钮  5) 盯进度  6) 校验落盘文件（大小 + ffprobe 有画面有声音）
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp
from vr_testenv import dl_dir

CDP_URL = os.environ.get("VR_CDP", "http://127.0.0.1:9223")
EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
BILI_URL = "https://www.bilibili.com/video/BV1DVaZ6hEK6/"
# 2026-11-08：改到仓库内测试目录，不再往用户真实下载文件夹写文件。
DL_DIR = dl_dir("bili1080")

CDP = Cdp(CDP_URL)
R = {}


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

    # 找到（或新建）B站 标签页
    tab = None
    for t in CDP.targets():
        if t.get("type") == "page" and "bilibili.com/video" in t.get("url", ""):
            tab = t
            break
    if not tab:
        tid = CDP.send("Target.createTarget", {"url": BILI_URL})["targetId"]
        time.sleep(14)
        tab = next(t for t in CDP.targets() if t["targetId"] == tid)
    print("B站标签页:", tab.get("url"))

    # popup 要的是 Chrome 数字 tabId，不是 CDP 的十六进制 targetId
    sw = next(t for t in CDP.targets()
              if t.get("url", "").endswith(f"{EXT_ID}/js/background.js"))
    swid = CDP.attach(sw["targetId"])
    tab_id = CDP.eval(
        "new Promise(res => chrome.tabs.query({url:'*://*.bilibili.com/video*'},"
        " ts => res(ts.length ? ts[0].id : -1)))", swid)
    print("真实 tabId:", tab_id)

    # 放行下载
    CDP.send("Browser.setDownloadBehavior",
             {"behavior": "allow", "downloadPath": DL_DIR, "eventsEnabled": True})

    # 开 popup
    for t in CDP.targets():
        if "popup.html" in t.get("url", ""):
            try:
                CDP.send("Target.closeTarget", {"targetId": t["targetId"]})
            except Exception:
                pass
    time.sleep(1)
    pop = CDP.send("Target.createTarget",
                   {"url": f"chrome-extension://{EXT_ID}/popup.html?tabId={tab_id}"})["targetId"]
    psid = CDP.attach(pop)
    time.sleep(6)

    banner = CDP.eval(r"""
      (() => { const b = document.getElementById('vrBiliWhole');
        if (!b) return { found: false };
        const bs = [...b.querySelectorAll('.vr-whole-go')].map(x => ({
          text: x.textContent.trim(), hd: x.classList.contains('vr-whole-hd') }));
        return { found: true, meta: (b.querySelector('.vr-whole-meta')||{}).textContent,
                 buttons: bs }; })()
    """, psid)
    print("\n[1] 横幅:", json.dumps(banner, ensure_ascii=False))
    R["banner"] = banner
    if not banner.get("found"):
        print("  ❌ 没出整段下载横幅")
        return
    MODE = os.environ.get("VR_MODE", "dash")   # dash=高清 / durl=标清
    if MODE == "dash" and not any(b.get("hd") for b in banner.get("buttons", [])):
        print("  ❌ 没有高清按钮")
        return
    if MODE == "durl" and not any(not b.get("hd") for b in banner.get("buttons", [])):
        print("  ❌ 没有标清按钮")
        return

    # 记录下载前的文件集合
    before = set(os.listdir(DL_DIR))

    # 点高清按钮
    sel = "#vrBiliWhole .vr-whole-hd" if MODE == "dash" \
        else "#vrBiliWhole .vr-whole-go:not(.vr-whole-hd)"
    clicked = CDP.eval(
        "(() => { const b = document.querySelector(%s);"
        " if (!b) return 'no button'; b.click(); return 'clicked'; })()" % json.dumps(sel), psid)
    print("[2] 点击(%s):" % MODE, clicked)

    # 盯进度
    last = None
    deadline = time.time() + 180
    while time.time() < deadline:
        time.sleep(2)
        try:
            st = CDP.eval(r"""
              (() => { const b = document.getElementById('vrBiliWhole');
                if (!b) return null;
                const p = b.querySelector('.vr-whole-pct');
                const t = document.querySelector('.vr-tip') || document.getElementById('Tips');
                return { pct: p ? p.textContent : null,
                         tip: t ? (t.textContent || '').slice(0, 120) : null }; })()
            """, psid)
        except Exception as e:
            # 面板被关了：下载在页面里照跑，直接去查盘
            print("   （popup 会话断开，改为查盘）", str(e)[:60])
            break
        if st and st.get("pct") and st["pct"] != last:
            print("   进度:", st["pct"], "|", (st.get("tip") or "").replace("\n", " ")[:80])
            last = st["pct"]
        if st and st.get("tip") and ("已保存" in st["tip"] or "失败" in st["tip"]):
            print("   结果提示:", st["tip"].replace("\n", " ")[:120])
            R["tip"] = st["tip"]
            break

    time.sleep(6)
    after = set(os.listdir(DL_DIR))
    new_files = [f for f in (after - before)
                 if f.endswith(".mp4") and not f.endswith(".crdownload")]
    print("\n[3] 新落盘文件:")
    for f in new_files:
        fp = os.path.join(DL_DIR, f)
        sz = os.path.getsize(fp)
        print(f"   {f}  {sz} bytes")
        print("   --- ffprobe ---")
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "format=duration,size:stream=codec_name,codec_type,width,height,sample_rate,channels",
             "-of", "default=noprint_wrappers=1", fp],
            capture_output=True, text=True, timeout=120)
        print("   " + (out.stdout or out.stderr).replace("\n", "\n   "))
        R["file"] = f
        R["size"] = sz
    if not new_files:
        print("   ❌ 没有新文件")
    print("\n结果:", json.dumps(R, ensure_ascii=False)[:800])


if __name__ == "__main__":
    main()
