# M7 回归归档截图 v2：显式强制浮层到位（绕开 CDP 卡死过渡），确定性截图
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id, open_popup  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "deliverables", "assets")
os.makedirs(OUT, exist_ok=True)


def shot(cdp, psid, path, label, settle=8.0):
    time.sleep(settle)
    for attempt in range(3):
        try:
            h = cdp.eval("Math.ceil(document.getElementById('vrShell').getBoundingClientRect().height)", psid)
            h = max(220, min(900, int(h or 600)))
            cdp.send("Emulation.setDeviceMetricsOverride", {
                "width": 400, "height": h, "deviceScaleFactor": 2, "mobile": False}, psid)
            time.sleep(0.8)
            s = cdp.send("Page.captureScreenshot", {"format": "png"}, psid)
            with open(path, "wb") as f:
                f.write(base64.b64decode(s["data"]))
            print(json.dumps({"label": label, "ok": True, "attempt": attempt + 1,
                              "h": h, "bytes": os.path.getsize(path)}), flush=True)
            return True
        except Exception as exc:
            print(json.dumps({"label": label, "ok": False, "attempt": attempt + 1,
                              "err": str(exc)[:60]}), flush=True)
            time.sleep(5)
    return False


def force_overlay(cdp, psid, which):
    """which: none | settings | tools —— 显式 inline 定位，绕开环境卡死过渡"""
    expr = """(() => {
      const sv = document.querySelector('#vrSettings'), dr = document.querySelector('#vrTools');
      const put = (el, on) => { el.style.transition = 'none';
        el.style.transform = on ? 'none' : (el.classList.contains('drawer') ? 'translateX(102%)' : 'translateX(100%)'); };
      put(sv, WHICH === 'settings'); put(dr, WHICH === 'tools');
    })()""".replace("WHICH", json.dumps(which))
    cdp.eval(expr, psid)
    time.sleep(0.4)


cdp = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9226"))

# 1. index 普通态（浅色 + 2 卡）
psid, _ = open_popup(cdp, "http://127.0.0.1:18080/index.html")
shot(cdp, psid, os.path.join(OUT, "final-m7-plain.png"), "index-plain")

# 2. 设置视图（4 组 9 项）
cdp.eval("document.getElementById('btnSettings').click()", psid)
time.sleep(0.5)
force_overlay(cdp, psid, "settings")
shot(cdp, psid, os.path.join(OUT, "final-m7-settings.png"), "settings", settle=2)

# 3. notyoutube（YT 横幅）
psid2, _ = open_popup(cdp, "http://notyoutube.com:18080/")
shot(cdp, psid2, os.path.join(OUT, "final-m7-ytbanner.png"), "notyoutube-yt-banner")

# 4. bili 横幅展开
psid3, _ = open_popup(cdp, "http://127.0.0.1:18080/bili-fake.html")
cdp.eval("document.querySelector('#vrBiliBanner .vr-banner-toggle').click()", psid3)
time.sleep(0.6)
shot(cdp, psid3, os.path.join(OUT, "final-m7-bili.png"), "bili-expanded", settle=2)

# 5. 图片弹层
psid4, _ = open_popup(cdp, "http://127.0.0.1:18080/images.html")
cdp.eval("document.getElementById('vrScanImages').click()", psid4)
time.sleep(1.6)
shot(cdp, psid4, os.path.join(OUT, "final-m7-imgmodal.png"), "img-modal", settle=2)

print("DONE", flush=True)
