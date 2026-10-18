# 真实 B 站下载 + 自定义文件名 端到端验证（星愿 9223）
import json
import os
import time
import urllib.request

from websocket import create_connection

CDP_URL = os.environ.get("VR_CDP", "http://127.0.0.1:9223")
EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
BILI_URL = "https://www.bilibili.com/video/BV1DVaZ6hEK6/"
DL_DIR = r"E:\personal\Downloads"

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Cdp:
    def __init__(self, url):
        ver = json.load(_opener.open(url + "/json/version"))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=90)
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
            self.events.append(r)

    def eval(self, expr, session):
        r = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}, session)
        if r.get("exceptionDetails"):
            return {"__error": str(r["exceptionDetails"])}
        return r.get("result", {}).get("value")

    def attach(self, tid):
        return self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]

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

    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    psid = cdp.attach(tid)
    cdp.send("Network.enable", {}, psid)
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True}, psid)
    cdp.send("Page.enable", {}, psid)
    cdp.send("Page.navigate", {"url": BILI_URL}, psid)
    time.sleep(3)
    cdp.send("Runtime.evaluate", {"expression":
        "document.querySelector('video') && document.querySelector('video').play().catch(()=>{});"}, psid)

    sw = get_sw(cdp)
    bsid = cdp.attach(sw["targetId"])

    real_tab = cdp.eval(r"""
      new Promise(res => { try { chrome.tabs.query({ url: '*://*.bilibili.com/video*' }, ts => res(ts.length?ts[0].id:'none')); } catch(e){ res('err'); } })
    """, bsid)
    print("真实 tabId:", real_tab)

    # 等几秒让分片进来
    time.sleep(6)
    first_url = cdp.eval(r"""
      (() => { try { const d = cacheData[%s]||[]; return d.length? d[0].url : 'none'; } catch(e){ return 'err:'+e; } })()
    """ % json.dumps(real_tab), bsid)
    print("取到的首个媒体 URL:", (first_url or "")[:70])

    # 触发自定义文件名下载
    custom = "钓鱼竿B站片段测试_自定义名.m4s"
    res = cdp.eval(r"""
      new Promise(res => {
        try {
          vrDownloadWithName(%s, %s).then(id => res({ id: id }));
        } catch(e){ res({ error: String(e) }); }
      })
    """ % (json.dumps(first_url), json.dumps(custom)), bsid)
    print("vrDownloadWithName 返回:", json.dumps(res, ensure_ascii=False))

    # 等下载落地
    time.sleep(8)
    print("\n== E:\\personal\\Downloads 中匹配自定义名的文件 ==")
    found = []
    try:
        for f in os.listdir(DL_DIR):
            if "钓鱼竿B站片段测试" in f or f == custom:
                fp = os.path.join(DL_DIR, f)
                found.append((f, os.path.getsize(fp)))
    except Exception as e:
        print("  读目录失败:", e)
    if found:
        for f, sz in found:
            print(f"  ✅ {f}  ({sz} bytes)")
    else:
        # 列出最近修改的文件兜底确认
        print("  未精确命中，列出最近 5 个文件：")
        try:
            items = sorted(os.listdir(DL_DIR), key=lambda x: os.path.getmtime(os.path.join(DL_DIR, x)), reverse=True)[:5]
            for f in items:
                print("   ", f, os.path.getsize(os.path.join(DL_DIR, f)))
        except Exception as e:
            print("   ", e)
    cdp.ws.close()


if __name__ == "__main__":
    main()
