# Bilibili 实站网络抓包 + 嗅探对照（星愿 9223）
# 目的：在用户给的精确 URL 上，抓取 .m4s/.m4/.mp4 响应，
#       对照扩展 cacheData，确认 webRequest 是否真正捕获 B 站分片。
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
                                    suppress_origin=True, timeout=60)
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

    def attach(self, target_id):
        return self.send("Target.attachToTarget",
                         {"targetId": target_id, "flatten": True})["sessionId"]

    def targets(self):
        return self.send("Target.getTargets")["targetInfos"]


def find_sw(cdp):
    for t in cdp.targets():
        if t.get("type") == "service_worker" and \
           t.get("url", "").startswith(f"chrome-extension://{EXT_ID}/"):
            return t
    return None


def main():
    cdp = Cdp(CDP_URL)

    # 关掉其它 bilibili 页面，避免干扰
    print("== 关闭其它 bilibili 页面 ==")
    for t in cdp.targets():
        u = t.get("url", "")
        if t.get("type") == "page" and "bilibili.com/video" in u:
            try:
                cdp.send("Target.closeTarget", {"targetId": t["targetId"]})
                print(f"  关闭 {t['targetId']} {u[:60]}")
            except Exception as e:
                print("  close err", e)

    # 新建前台页导航
    print("\n== 新建前台页并导航到用户 URL ==")
    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    psid = cdp.attach(tid)
    cdp.send("Network.enable", {}, psid)
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True}, psid)
    cdp.send("Page.enable", {}, psid)
    cdp.send("Page.navigate", {"url": BILI_URL}, psid)
    time.sleep(2)
    # 触发播放（自动播放可能被拦截）
    try:
        cdp.send("Runtime.evaluate", {"expression":
            "document.querySelector('video') && document.querySelector('video').play().catch(()=>{});"}, psid)
    except Exception:
        pass

    # 抓包 18 秒
    print("== 抓包 18s ==")
    cdp.events.clear()
    deadline = time.time() + 18
    media = []
    while time.time() < deadline:
        # 边收边筛，避免缓冲爆
        try:
            raw = cdp.ws.recv()
        except Exception:
            break
        if not raw:
            continue
        ev = json.loads(raw)
        if ev.get("method") == "Network.responseReceived":
            p = ev["params"]
            resp = p.get("response", {})
            url = resp.get("url", "")
            if any(k in url for k in (".m4s", ".m4?", ".m4&", "/m4s/", "bilivideo")) or \
               url.lower().endswith(".m4") or url.lower().endswith(".mp4"):
                media.append({
                    "url": url[:90],
                    "mime": resp.get("mimeType"),
                    "fromSW": resp.get("fromServiceWorker"),
                    "status": resp.get("status"),
                })
    print(f"  捕获到疑似媒体响应 {len(media)} 条")
    # 去重统计
    mime_count = {}
    for m in media:
        key = f"{m['mime']}|fromSW={m['fromSW']}"
        mime_count[key] = mime_count.get(key, 0) + 1
    for k, v in mime_count.items():
        print(f"    {k} -> {v}")
    print("  样本(前5):")
    for m in media[:5]:
        print("    " + json.dumps(m, ensure_ascii=False))

    # 对照 cacheData
    sw = find_sw(cdp)
    if sw:
        bsid = cdp.attach(sw["targetId"])
        cache = cdp.send("Runtime.evaluate", {
            "expression": r"""
              (() => {
                try {
                  const keys = (typeof cacheData !== 'undefined') ? Object.keys(cacheData) : [];
                  const sizes = (typeof cacheData !== 'undefined')
                    ? Object.fromEntries(Object.entries(cacheData).map(([k,v]) => [k, Array.isArray(v)?v.length:'?']))
                    : {};
                  return { keys, sizes };
                } catch(e){ return { error: String(e) }; }
              })()
            """,
            "returnByValue": True, "awaitPromise": True}, bsid)
        val = cache.get("result", {}).get("value")
        print("\n== 扩展 cacheData 对照 ==")
        print("  " + json.dumps(val, ensure_ascii=False))

        # getMediaData 针对本 tab
        gm = cdp.send("Runtime.evaluate", {
            "expression": f"""
              new Promise(res => {{
                try {{
                  chrome.runtime.sendMessage({{ Message: 'getMediaData', tabId: {tid} }}, r => {{
                    res({{ count: Array.isArray(r)? r.length : (r&&r.__error?r.__error:'non-array'),
                          sample: Array.isArray(r)? r.slice(0,2).map(x=>({{ext:x.ext,type:x.type,url:(x.url||'').slice(0,60)}})):null }});
                  }});
                }} catch(e){{ res({{error:String(e)}}); }}
              }})
            """,
            "returnByValue": True, "awaitPromise": True}, bsid)
        print("  getMediaData(tab=%s): %s" % (tid, json.dumps(gm.get("result", {}).get("value"), ensure_ascii=False)))
    cdp.ws.close()


if __name__ == "__main__":
    main()
