# 截 popup 上 B站「双清晰度」横幅（带重试：CDP popup 有懒帧问题）
import base64
import json
import os
import sys
import time

sys.path.insert(0, r"E:/test/download/video-rod/tools")
from cdp_client import Cdp

EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
OUT = r"E:/test/download/video-rod/deliverables/assets/bili-1080-banner.png"
CDP = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9223"))


def main():
    sw = next(t for t in CDP.targets()
              if t.get("url", "").endswith(f"{EXT_ID}/js/background.js"))
    swid = CDP.attach(sw["targetId"])
    tab_id = CDP.eval(
        "new Promise(res => chrome.tabs.query({url:'*://*.bilibili.com/video*'},"
        " ts => res(ts.length ? ts[0].id : -1)))", swid)
    print("tabId:", tab_id)
    if not tab_id or tab_id < 0:
        print("没有 B站 标签页")
        return

    for t in CDP.targets():
        if "popup.html" in t.get("url", ""):
            try:
                CDP.send("Target.closeTarget", {"targetId": t["targetId"]})
            except Exception:
                pass
    time.sleep(1)
    pop = CDP.send("Target.createTarget",
                   {"url": f"chrome-extension://{EXT_ID}/popup.html?tabId={tab_id}"})["targetId"]
    sid = CDP.attach(pop)
    time.sleep(7)

    info = CDP.eval(r"""
      (() => { const b = document.getElementById('vrBiliWhole');
        if (!b) return null;
        return { meta: (b.querySelector('.vr-whole-meta')||{}).textContent,
                 btns: [...b.querySelectorAll('.vr-whole-go')].map(x=>x.textContent.trim()) }; })()
    """, sid)
    print("横幅:", json.dumps(info, ensure_ascii=False))
    if not info:
        return

    # popup 懒帧：多次重试直到拿到非空图
    for attempt in range(6):
        try:
            r = CDP.send("Page.captureScreenshot", {"format": "png"}, sid)
            data = base64.b64decode(r["data"])
            if len(data) > 3000:
                with open(OUT, "wb") as f:
                    f.write(data)
                print("截图成功:", OUT, len(data), "bytes (第 %d 次)" % (attempt + 1))
                return
            print("  第 %d 次拿到 %d 字节，太小，重试" % (attempt + 1, len(data)))
        except Exception as e:
            print("  第 %d 次失败: %s" % (attempt + 1, str(e)[:80]))
        time.sleep(3)
    print("截图失败")


if __name__ == "__main__":
    main()
