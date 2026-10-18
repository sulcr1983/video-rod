# 截图证明：B 站嗅探到的 3 个分片在 popup 中可见（星愿 9223）
import json
import os
import time
import urllib.request
from websocket import create_connection

CDP_URL = "http://127.0.0.1:9223"
EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
BILI_URL = "https://www.bilibili.com/video/BV1DVaZ6hEK6/"
OUT = r"E:\test\download\video-rod\tools\bili-popup-proof.png"
_op = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Cdp:
    def __init__(s, u):
        v = json.load(_op.open(u + "/json/version"))
        s.ws = create_connection(v["webSocketDebuggerUrl"], suppress_origin=True, timeout=90)
        s.mid = 0

    def send(s, m, p=None, ses=None):
        s.mid += 1
        msg = {"id": s.mid, "method": m, "params": p or {}}
        if ses:
            msg["sessionId"] = ses
        s.ws.send(json.dumps(msg))
        while True:
            r = json.loads(s.ws.recv())
            if r.get("id") == s.mid:
                return r.get("result", {})

    def ev(s, x, ses):
        r = s.send("Runtime.evaluate", {"expression": x, "returnByValue": True, "awaitPromise": True}, ses)
        return r.get("result", {}).get("value")

    def att(s, t):
        return s.send("Target.attachToTarget", {"targetId": t, "flatten": True})["sessionId"]

    def tgt(s):
        return s.send("Target.getTargets")["targetInfos"]


def main():
    c = Cdp(CDP_URL)
    for t in c.tgt():
        if t.get("type") == "page" and "bilibili.com/video" in t.get("url", ""):
            try:
                c.send("Target.closeTarget", {"targetId": t["targetId"]})
            except Exception:
                pass
    tid = c.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    psid = c.att(tid)
    c.send("Network.enable", {}, psid)
    c.send("Network.setCacheDisabled", {"cacheDisabled": True}, psid)
    c.send("Page.enable", {}, psid)
    c.send("Page.navigate", {"url": BILI_URL}, psid)
    time.sleep(3)
    c.send("Runtime.evaluate", {"expression":
        "document.querySelector('video')&&document.querySelector('video').play().catch(()=>{});"}, psid)
    sw = [t for t in c.tgt() if t.get("type") == "service_worker" and t.get("url", "").startswith(f"chrome-extension://{EXT_ID}/")][0]
    bs = c.att(sw["targetId"])
    real = c.ev("new Promise(r=>{try{chrome.tabs.query({url:'*://*.bilibili.com/video*'},ts=>r(ts.length?ts[0].id:'none'));}catch(e){r('err')}})", bs)
    time.sleep(6)
    pop = c.send("Target.createTarget", {"url": f"chrome-extension://{EXT_ID}/popup.html?tabId={real}"})["targetId"]
    popsid = c.att(pop)
    c.send("Runtime.enable", {}, popsid)
    c.send("Page.enable", {}, popsid)
    c.send("Emulation.setDeviceMetricsOverride", {"width": 440, "height": 760, "deviceScaleFactor": 2, "mobile": False}, popsid)
    time.sleep(4)
    shot = c.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True}, popsid)
    with open(OUT, "wb") as f:
        import base64
        f.write(base64.b64decode(shot["data"]))
    print("截图已保存:", OUT, "大小:", os.path.getsize(OUT))
    c.ws.close()


if __name__ == "__main__":
    main()
