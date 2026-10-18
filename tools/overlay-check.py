# 通用「页内按钮位置」体检：给一个 URL，新开页 → 找够大的 video → 鼠标移上去 → 量坐标 + 裁剪截图
# 用法：python tools/overlay-check.py <url> [截图名]
#   VR_SCROLL=1  先往下滚几屏（信息流站点视频是懒加载的）
import base64
import json
import os
import sys
import time

sys.path.insert(0, r"E:/test/download/video-rod/tools")
from cdp_client import Cdp

TMP = r"E:/test/download/video-rod/.tmp"
CDP = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9223"))


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "https://www.bilibili.com/"
    name = sys.argv[2] if len(sys.argv) > 2 else "overlay-pos"
    out = os.path.join(TMP, name + ".png")
    os.makedirs(TMP, exist_ok=True)

    tid = CDP.send("Target.createTarget", {"url": url})["targetId"]
    sid = CDP.attach(tid)
    CDP.send("Page.enable", {}, sid)
    CDP.send("Network.enable", {}, sid)
    CDP.send("Network.setCacheDisabled", {"cacheDisabled": True}, sid)
    CDP.send("Page.navigate", {"url": url}, sid)
    # 后台标签页截不到画面（拿到的是空白/极小图），必须切到前台
    CDP.send("Target.activateTarget", {"targetId": tid})
    time.sleep(6)

    if os.environ.get("VR_SCROLL"):
        for _ in range(4):
            CDP.eval("window.scrollBy(0, 700)", sid)
            time.sleep(1.5)

    # 挑一个**有足够可见面积**的 video：用 video 矩形与视口的交集来挑，
    # 鼠标点取交集中心。要求「完整在视口内」会被吸顶导航条卡死（微博头部 60px）。
    vw, vh = 0, 0
    d = None
    for _ in range(15):
        d = CDP.eval(r"""
          (() => {
            const vs = [...document.querySelectorAll('video')];
            let best = null;
            for (const v of vs) {
              const r = v.getBoundingClientRect();
              const il = Math.max(0, r.left), it = Math.max(0, r.top);
              const ir = Math.min(innerWidth, r.right), ib = Math.min(innerHeight, r.bottom);
              const iw = ir - il, ih = ib - it;
              if (iw < 200 || ih < 120) continue;
              if (!best || iw * ih > best.area) {
                best = { area: iw * ih, w: Math.round(r.width), h: Math.round(r.height),
                         left: Math.round(r.left), top: Math.round(r.top),
                         cx: Math.round(il + iw / 2), cy: Math.round(it + ih / 2) };
                window.__vrTestV = v;
              }
            }
            return best;
          })()
        """, sid)
        if d:
            vw, vh = d["w"], d["h"]
            break
        # 没有就把页面里的视频挨个滚进视口再试
        CDP.eval(r"""
          (() => {
            const vs = [...document.querySelectorAll('video')];
            const v = vs.find(x => { const r = x.getBoundingClientRect();
              return r.width >= 200 && r.height >= 120; });
            if (v) { v.scrollIntoView({ block: 'center' }); return true; }
            window.scrollBy(0, 600);
            return false;
          })()
        """, sid)
        time.sleep(1.5)
    print("URL:", url, "| 可见 video:", vw, "x", vh, "| 矩形:", d)
    if not vw:
        print("❌ 这页视口内没有够大的 video")
        return

    # 鼠标移进去（用交集中心，保证点落在可见区域里）
    c = {"x": d["cx"], "y": d["cy"]}
    for _ in range(3):
        CDP.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": c["x"], "y": c["y"]}, sid)
        time.sleep(0.4)

    info = CDP.eval(r"""
      (() => {
        const p = document.querySelector('.vr-vob');
        if (!p) return { err: '浮层没注入' };
        const pb = p.getBoundingClientRect();
        const v = window.__vrTestV;
        const vb = v ? v.getBoundingClientRect() : null;
        const vt = document.elementsFromPoint(pb.left + pb.width/2, pb.top + pb.height/2)
          .filter(e => e !== p && !p.contains(e)).slice(0,3)
          .map(e => e.tagName + '.' + (e.className||'').toString().split(' ')[0]);
        return { btn: {left:Math.round(pb.left), top:Math.round(pb.top),
                       w:Math.round(pb.width), h:Math.round(pb.height)},
                 video: vb ? {left:Math.round(vb.left), top:Math.round(vb.top),
                              w:Math.round(vb.width), h:Math.round(vb.height)} : null,
                 dy: vb ? Math.round(pb.top - vb.top) : null,
                 on: p.classList.contains('vr-on'),
                 under: vt };
      })()
    """, sid)
    print(json.dumps(info, ensure_ascii=False, indent=2))

    if info.get("btn"):
        b = info["btn"]
        # 整屏截图 + 本地裁切。
        # 不用 Page.captureScreenshot 的 clip：它的坐标系（视口 vs 文档）在滚动过之后
        # 很不直观，调了两次都对不上，索性整屏拍下来自己裁，坐标就是我量到的视口坐标。
        shot = os.path.join(TMP, name + "-full.png")
        got = False
        for attempt in range(4):
            try:
                # fromSurface:true 在窗口被遮住时会拍到「没光栅化」的残影
                # （表现为按钮位置冒出一个白底破图小方块），必须用 false
                res = CDP.send("Page.captureScreenshot",
                               {"format": "png", "fromSurface": False}, sid)
                data = base64.b64decode(res["data"])
                print("  截图字节数:", len(data))
                if len(data) > 20000:
                    with open(shot, "wb") as f:
                        f.write(data)
                    got = True
                    break
            except Exception as e:
                print("  retry", attempt, str(e)[:80])
            time.sleep(2)
        if not got:
            print("❌ 截图失败")
            return

        from PIL import Image
        dpr = CDP.eval("window.devicePixelRatio || 1", sid) or 1
        im = Image.open(shot)
        # 取按钮上方 110、下方 40、左右各 40 的窗口，再把视频左上角带上
        x0 = max(0, min(b["left"], (info.get("video") or {}).get("left", b["left"])) - 40)
        y0 = max(0, b["top"] - 110)
        box = (int(x0 * dpr), int(y0 * dpr),
               int((b["left"] + b["w"] + 40) * dpr), int((b["top"] + b["h"] + 40) * dpr))
        box = (box[0], box[1], min(box[2], im.width), min(box[3], im.height))
        im.crop(box).save(out)
        print("裁剪截图:", out, "| dpr=", dpr, "| box=", box)

    if os.environ.get("VR_CLOSE"):
        try:
            CDP.send("Target.closeTarget", {"targetId": tid})
            print("已关闭测试页")
        except Exception:
            pass


if __name__ == "__main__":
    main()
