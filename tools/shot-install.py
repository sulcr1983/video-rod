# 安装页验收截图（file:// 打开静态页；起浏览器与截图必须同一条命令，子进程会被回收）
# 用法：
#   chrome --remote-debugging-port=9429 --user-data-dir=<tmp> about:blank &
#   VR_CDP=http://127.0.0.1:9429 python tools/shot-install.py
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "deliverables", "assets")
PAGE = "file:///" + os.path.join(ROOT, "install.html").replace("\\", "/")
os.makedirs(OUT, exist_ok=True)


def size(cdp, sid, w, h):
    cdp.send("Emulation.setDeviceMetricsOverride",
             {"width": w, "height": h, "deviceScaleFactor": 2, "mobile": False}, sid)
    time.sleep(0.9)


def shot(cdp, sid, name, w, h):
    size(cdp, sid, w, h)
    data = cdp.send("Page.captureScreenshot", {"format": "png"}, sid)["data"]
    p = os.path.join(OUT, name)
    with open(p, "wb") as f:
        f.write(base64.b64decode(data))
    return [p, os.path.getsize(p)]


cdp = Cdp()
sid = cdp.attach(cdp.send("Target.createTarget", {"url": PAGE})["targetId"])
time.sleep(2.5)

h = cdp.eval("(function(){var c=document.querySelector('.shell');"
             "return c?Math.round(c.getBoundingClientRect().height):-1})()", sid)
print(json.dumps({"page": PAGE, "shellHeight": h, "fits760": bool(h and h <= 720)}))

print(json.dumps({"zh": shot(cdp, sid, "install-rewrite-1280x760.png", 1280, 760)}, ensure_ascii=False))
print(json.dumps({"mobile": shot(cdp, sid, "install-rewrite-mobile.png", 390, 844)}, ensure_ascii=False))

# 复制态：用真实鼠标事件（合成 click 没有用户激活，剪贴板会拒绝）
size(cdp, sid, 1280, 760)
box = cdp.eval("(function(){var r=document.querySelector('.copy-mail').getBoundingClientRect();"
               "return [r.left+r.width/2, r.top+r.height/2]})()", sid)
cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": box[0], "y": box[1],
                                      "button": "left", "clickCount": 1}, sid)
cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": box[0], "y": box[1],
                                      "button": "left", "clickCount": 1}, sid)
time.sleep(0.8)
print("toast:", cdp.eval("document.getElementById('toast').textContent", sid))
data = cdp.send("Page.captureScreenshot", {"format": "png"}, sid)["data"]
p = os.path.join(OUT, "install-rewrite-copied.png")
with open(p, "wb") as f:
    f.write(base64.b64decode(data))
print(json.dumps({"copied": [p, os.path.getsize(p)]}, ensure_ascii=False))

cdp.eval("document.getElementById('langToggle').click()", sid)
time.sleep(0.8)
print(json.dumps({"en": shot(cdp, sid, "install-rewrite-en.png", 1280, 760)}, ensure_ascii=False))
