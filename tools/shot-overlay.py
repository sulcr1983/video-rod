# 截：鼠标移到视频上后，按钮和 B站 自己的左上角图标的相对位置
import base64
import json
import os
import sys
import time

sys.path.insert(0, r"E:/test/download/video-rod/tools")
from cdp_client import Cdp

EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
OUT = r"E:/test/download/video-rod/deliverables/assets/overlay-position.png"
CDP = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9223"))


def main():
    tab = None
    for t in CDP.targets():
        if t.get("type") == "page" and "bilibili.com/video" in t.get("url", ""):
            tab = t
            break
    if not tab:
        tid = CDP.send("Target.createTarget",
                       {"url": "https://www.bilibili.com/video/BV1DVaZ6hEK6/"})["targetId"]
        time.sleep(15)
        tab = next(t for t in CDP.targets() if t["targetId"] == tid)
    psid = CDP.attach(tab["targetId"])
    print("页面:", tab.get("url"))

    # 等 video
    for _ in range(15):
        ok = CDP.eval("(() => { const v=document.querySelector('video');"
                      " return v ? Math.round(v.getBoundingClientRect().width) : 0; })()", psid)
        if ok and ok > 200:
            break
        time.sleep(2)
    print("video 宽:", ok)

    # 模拟真实鼠标移动（比 dispatchEvent 更能触发 B站 自己的 hover 控件）
    r = CDP.eval("(() => { const v=document.querySelector('video');"
                 " const b=v.getBoundingClientRect();"
                 " return {x: Math.round(b.left+b.width/2), y: Math.round(b.top+b.height/2)}; })()", psid)
    print("视频中心:", r)
    CDP.send("Input.dispatchMouseEvent",
             {"type": "mouseMoved", "x": r["x"], "y": r["y"]}, psid)
    time.sleep(1.2)

    info = CDP.eval(r"""
      (() => {
        const v = document.querySelector('video');
        const vb = v.getBoundingClientRect();
        const p = document.querySelector('.vr-vob');
        const pb = p ? p.getBoundingClientRect() : null;
        // 找出压在按钮位置上的、B站 自己的元素（自上而下取最顶那个）
        let topEl = null;
        if (pb) {
          const cx = pb.left + pb.width/2, cy = pb.top + pb.height/2;
          const stack = document.elementsFromPoint(cx, cy);
          for (const e of stack) {
            if (e === p || p.contains(e)) continue;
            topEl = { tag: e.tagName, cls: (e.className||'').toString().slice(0,60),
                      id: e.id || '', z: getComputedStyle(e).zIndex };
            break;
          }
        }
        return {
          video: { left: Math.round(vb.left), top: Math.round(vb.top),
                   w: Math.round(vb.width), h: Math.round(vb.height) },
          btn: pb ? { left: Math.round(pb.left), top: Math.round(pb.top),
                      w: Math.round(pb.width), h: Math.round(pb.height) } : null,
          btnOn: p ? p.classList.contains('vr-on') : false,
          topElementAtButton: topEl
        };
      })()
    """, psid)
    print(json.dumps(info, ensure_ascii=False, indent=2))

    for attempt in range(5):
        try:
            res = CDP.send("Page.captureScreenshot", {"format": "png"}, psid)
            data = base64.b64decode(res["data"])
            if len(data) > 5000:
                with open(OUT, "wb") as f:
                    f.write(data)
                print("截图:", OUT, len(data), "bytes")
                return
        except Exception as e:
            print("  retry", attempt, str(e)[:60])
        time.sleep(2)


if __name__ == "__main__":
    main()
