# 修正版：真实 B 站嗅探对照测试（星愿 9223）
# 修正点：用 chrome.tabs.query 拿到真实数字 tabId；用 {Message:"getData"} 读取。
import json
import os
import time
import urllib.request

from websocket import create_connection

CDP_URL = os.environ.get("VR_CDP", "http://127.0.0.1:9223")
EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
BILI_URL = "https://www.bilibili.com/video/BV1DVaZ6hEK6/"

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Cdp:
    def __init__(self, url):
        ver = json.load(_opener.open(url + "/json/version"))
        self.ws = create_connection(ver["webSocketDebuggerUrl"],
                                    suppress_origin=True, timeout=90)
        self.mid = 0
        self.events = []

    def send(self, method, params=None, session=None):
        self.mid += 1
        msg = {"id": self.mid, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        self.ws.send(json.dumps(msg))
        while True:
            raw = self.ws.recv()
            if not raw:
                continue
            r = json.loads(raw)
            if r.get("id") == self.mid:
                if "error" in r:
                    raise RuntimeError(f"{method}: {r['error']}")
                return r.get("result", {})
            self.events.append(r) if hasattr(self, "events") else None

    def eval(self, expr, session):
        r = self.send("Runtime.evaluate",
                      {"expression": expr, "returnByValue": True, "awaitPromise": True}, session)
        if r.get("exceptionDetails"):
            return {"__error": str(r["exceptionDetails"])}
        return r.get("result", {}).get("value")

    def attach(self, target_id):
        return self.send("Target.attachToTarget", {"targetId": target_id, "flatten": True})["sessionId"]

    def targets(self):
        return self.send("Target.getTargets")["targetInfos"]


def get_sw(cdp):
    for t in cdp.targets():
        if t.get("type") == "service_worker" and t.get("url", "").startswith(f"chrome-extension://{EXT_ID}/"):
            return t
    return None


def main():
    cdp = Cdp(CDP_URL)
    # 关掉其它 bilibili 页面
    for t in cdp.targets():
        if t.get("type") == "page" and "bilibili.com/video" in t.get("url", ""):
            try:
                cdp.send("Target.closeTarget", {"targetId": t["targetId"]})
            except Exception:
                pass

    # 新建前台页
    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    psid = cdp.attach(tid)
    cdp.send("Network.enable", {}, psid)
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True}, psid)
    cdp.send("Page.enable", {}, psid)
    cdp.send("Page.navigate", {"url": BILI_URL}, psid)
    time.sleep(3)
    cdp.send("Runtime.evaluate", {"expression":
        "document.querySelector('video') && document.querySelector('video').play().catch(()=>{});"}, psid)

    # 真实数字 tabId
    sw = get_sw(cdp)
    bsid = cdp.attach(sw["targetId"])
    real_tab = cdp.eval(r"""
      new Promise(res => {
        try { chrome.tabs.query({ url: '*://*.bilibili.com/video*' }, ts => res(ts.length?ts[0].id:'none')); }
        catch(e){ res('err:'+e); }
      })
    """, bsid)
    print("真实 bilibili tabId:", real_tab)

    # 抓包 20s
    cdp.events.clear()
    seen = set()
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            raw = cdp.ws.recv()
        except Exception:
            break
        if not raw:
            continue
        ev = json.loads(raw)
        if ev.get("method") == "Network.responseReceived":
            resp = ev["params"].get("response", {})
            url = resp.get("url", "")
            if ".m4s" in url or url.lower().endswith(".m4") or url.lower().endswith(".mp4"):
                seen.add(url.split("?")[0])
    print(f"网络中出现的唯一媒体 URL 数: {len(seen)}")

    # SW: getData + G.enable
    gstate = cdp.eval(r"""
      (() => {
        try {
          const enable = (typeof G!=='undefined') ? G.enable : 'NO_G';
          const data = (typeof cacheData!=='undefined' && %s!=='none' && %s!=='none')
            ? (cacheData[%s]||[]) : 'skip';
          return { enable, cnt: Array.isArray(data)?data.length:'skip',
                   sample: Array.isArray(data)? data.slice(0,3).map(x=>({ext:x.ext,type:x.type,url:(x.url||'').slice(0,55)})):[] };
        } catch(e){ return { error:String(e) }; }
      })()
    """ % (json.dumps(real_tab), json.dumps(real_tab), json.dumps(real_tab)), bsid)
    print("SW getData:", json.dumps(gstate, ensure_ascii=False))

    # 打开 popup 给该 tab，读真实卡片数
    pop = cdp.send("Target.createTarget", {"url": f"chrome-extension://{EXT_ID}/popup.html?tabId={real_tab}"})["targetId"]
    popsid = cdp.attach(pop)
    cdp.send("Runtime.enable", {}, popsid)
    cdp.send("Page.enable", {}, popsid)
    cdp.send("Emulation.setDeviceMetricsOverride",
             {"width": 420, "height": 720, "deviceScaleFactor": 2, "mobile": False}, popsid)
    time.sleep(4)
    dom = cdp.eval(r"""
      (() => {
        const cnt = document.getElementById('vrCount');
        const list = document.getElementById('mediaList');
        const items = list ? list.querySelectorAll('*') : [];
        // 统计实际媒体卡片节点（带 data-url 或 .media-item 之类）
        const cards = list ? list.querySelectorAll('[data-url], .media-item, .item, a[download]').length : -1;
        return {
          vrCount: cnt ? cnt.textContent : 'N/A',
          mediaListChildren: items.length,
          cardLikeNodes: cards,
          bodyText: (document.body.innerText||'').slice(0,120)
        };
      })()
    """, popsid)
    print("POPUP DOM:", json.dumps(dom, ensure_ascii=False))
    cdp.ws.close()


if __name__ == "__main__":
    main()
