# video-rod CDP 测试脚本：连接 Chrome DevTools Protocol，直连扩展 service worker
# 验证嗅探引擎是否把页面媒体请求捕获进 storage.session.MediaData
# 用法：PYTHONPATH=<pillow_and_ws_dir> python tools/cdp-test.py <action>
#   action: sniff           读取 MediaData 嗅探结果
#           targets         列出所有 CDP targets
import json
import sys
import urllib.request

from websocket import create_connection

CDP_URL = "http://127.0.0.1:9222"
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class CdpClient:
    def __init__(self):
        ver = json.load(_opener.open(CDP_URL + "/json/version"))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True)
        self.mid = 0

    def send(self, method, params=None, session=None):
        self.mid += 1
        msg = {"id": self.mid, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        self.ws.send(json.dumps(msg))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.mid:
                return r

    def attach_worker(self, url_part):
        r = self.send("Target.getTargets")
        for t in r["result"]["targetInfos"]:
            if t["type"] == "service_worker" and url_part in t.get("url", ""):
                a = self.send("Target.attachToTarget", {"targetId": t["targetId"], "flatten": True})
                return a["result"]["sessionId"], t["url"]
        return None, None

    def eval(self, expr, session, await_promise=True):
        return self.send("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": await_promise,
        }, session)


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "sniff"
    cdp = CdpClient()

    if action == "targets":
        r = cdp.send("Target.getTargets")
        for t in r["result"]["targetInfos"]:
            print(t["type"], "|", t.get("url", "")[:100])
        return

    # 连扩展 background service worker
    sid, url = cdp.attach_worker("background.js")
    if not sid:
        print("ERROR: background service worker not found")
        sys.exit(1)
    print("attached:", url)

    expr = """
    new Promise(res => {
      chrome.storage.session.get('MediaData', d => res(JSON.stringify(d.MediaData || null)));
    })
    """
    r = cdp.eval(expr, sid)
    data = r["result"]["result"].get("value")
    print("MediaData:", (data or "")[:3000])


if __name__ == "__main__":
    main()
