# 按钮位置诊断：重载扩展 → 新开页面 → 鼠标移到视频上 → 量按钮坐标 + 看它压在谁身上
# 输出：按钮/视频坐标、按钮位置上的元素栈、左上角裁剪截图（只截视频左上角那一块）
import base64
import json
import os
import sys
import time

sys.path.insert(0, r"E:/test/download/video-rod/tools")
from cdp_client import Cdp

EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
URL = os.environ.get("VR_URL", "https://www.bilibili.com/video/BV1DVaZ6hEK6/")
TMP = r"E:/test/download/video-rod/.tmp"
OUT = os.path.join(TMP, "overlay-pos.png")
CDP = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9223"))


def reload_ext():
    sw = next(t for t in CDP.targets()
              if t.get("url", "").endswith(f"{EXT_ID}/js/background.js"))
    sid = CDP.attach(sw["targetId"])
    CDP.send("Runtime.enable", {}, sid)
    CDP.eval("chrome.runtime.reload()", sid)
    time.sleep(4)
    print("扩展已重载")


def main():
    os.makedirs(TMP, exist_ok=True)
    reload_ext()

    # 内容脚本只在页面加载时注入 → 必须新开标签页
    tid = CDP.send("Target.createTarget", {"url": URL})["targetId"]
    psid = CDP.attach(tid)
    CDP.send("Page.enable", {}, psid)
    CDP.send("Network.enable", {}, psid)
    CDP.send("Network.setCacheDisabled", {"cacheDisabled": True}, psid)
    CDP.send("Page.navigate", {"url": URL}, psid)
    time.sleep(3)

    vw = 0
    for _ in range(20):
        vw = CDP.eval("(() => { const v=document.querySelector('video');"
                      " return v ? Math.round(v.getBoundingClientRect().width) : 0; })()", psid)
        if vw and vw > 200:
            break
        time.sleep(2)
    print("页面:", URL, "| video 宽:", vw)
    if not vw:
        print("❌ 页面没有够大的 video")
        return

    # 真实鼠标移动到视频中心（触发 B站 自己的 hover 控件条）
    c = CDP.eval("(() => { const v=document.querySelector('video');"
                 " const b=v.getBoundingClientRect();"
                 " return {x: Math.round(b.left+b.width/2), y: Math.round(b.top+b.height/2)}; })()", psid)
    CDP.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": c["x"], "y": c["y"]}, psid)
    time.sleep(1.5)

    info = CDP.eval(r"""
      (() => {
        const v  = document.querySelector('video');
        const p  = document.querySelector('.vr-vob');
        const vb = v.getBoundingClientRect();
        if (!p) return { err: 'no panel' };
        const pb = p.getBoundingClientRect();
        // 在按钮的四个角+中心取元素栈，看有没有被别的东西压住
        const pts = [
          ['左上', pb.left + 3,               pb.top + 3],
          ['右上', pb.right - 3,              pb.top + 3],
          ['中心', pb.left + pb.width / 2,    pb.top + pb.height / 2],
          ['左下', pb.left + 3,               pb.bottom - 3],
        ];
        const stacks = [];
        for (const [name, x, y] of pts) {
          const list = document.elementsFromPoint(x, y)
            .filter(e => e !== p && !p.contains(e))
            .slice(0, 3)
            .map(e => e.tagName + (e.id ? '#' + e.id : '') +
                      '.' + (e.className || '').toString().split(' ').slice(0, 2).join('.'));
          stacks.push(name + ' → ' + (list.length ? list.join(' | ') : '(只有我们的按钮)'));
        }
        // 播放器自己顶部的控件条
        let ownTop = null;
        for (const sel of ['.bpx-player-control-top', '.bpx-player-top-title',
                           '.bpx-player-top-left', '.wbpv-player-top']) {
          const el = document.querySelector(sel);
          if (el && el.getBoundingClientRect().height > 0) {
            const r = el.getBoundingClientRect();
            ownTop = { sel: sel, left: Math.round(r.left), top: Math.round(r.top),
                       w: Math.round(r.width), h: Math.round(r.height),
                       opacity: getComputedStyle(el).opacity };
            break;
          }
        }
        return {
          video: { left: Math.round(vb.left), top: Math.round(vb.top),
                   w: Math.round(vb.width), h: Math.round(vb.height) },
          btn:   { left: Math.round(pb.left), top: Math.round(pb.top),
                   w: Math.round(pb.width), h: Math.round(pb.height) },
          dy: Math.round(pb.top - vb.top),
          on: p.classList.contains('vr-on'),
          z: getComputedStyle(p).zIndex,
          stacks: stacks,
          playerTopBar: ownTop
        };
      })()
    """, psid)
    print(json.dumps(info, ensure_ascii=False, indent=2))

    # 只截视频左上角那一块，scale=1 便于肉眼看
    b = info["btn"]
    clip = {"x": max(0, b["left"] - 30), "y": max(0, b["top"] - 110),
            "width": 480, "height": 220, "scale": 1}
    for attempt in range(4):
        try:
            res = CDP.send("Page.captureScreenshot",
                           {"format": "png", "clip": clip, "captureBeyondViewport": False}, psid)
            data = base64.b64decode(res["data"])
            if len(data) > 2000:
                with open(OUT, "wb") as f:
                    f.write(data)
                print("裁剪截图:", OUT, len(data), "bytes", "clip=", clip)
                return
        except Exception as e:
            print("  retry", attempt, str(e)[:80])
            time.sleep(2)
    print("❌ 截图失败")


if __name__ == "__main__":
    main()
