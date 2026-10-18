# 探测 cat-catch G.Ext / G.Type 的 state 开关，以及全局嗅探开关
import json
import os
import urllib.request

from websocket import create_connection

CDP_URL = os.environ.get("VR_CDP", "http://127.0.0.1:9223")
EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Cdp:
    def __init__(self, url):
        ver = json.load(_opener.open(url + "/json/version"))
        self.ws = create_connection(ver["webSocketDebuggerUrl"],
                                    suppress_origin=True, timeout=60)
        self.mid = 0

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

    def attach(self, target_id):
        return self.send("Target.attachToTarget", {"targetId": target_id, "flatten": True})["sessionId"]

    def targets(self):
        return self.send("Target.getTargets")["targetInfos"]


def main():
    cdp = Cdp(CDP_URL)
    sw = None
    for t in cdp.targets():
        if t.get("type") == "service_worker" and t.get("url", "").startswith(f"chrome-extension://{EXT_ID}/"):
            sw = t
    if not sw:
        print("未找到 SW"); return
    bsid = cdp.attach(sw["targetId"])
    r = cdp.send("Runtime.evaluate", {
        "expression": r"""
          (() => {
            try {
              const out = {};
              if (typeof G === 'undefined') return { error: 'NO_G' };
              const extKeys = ['m4s','mp4','m4a','m4','ts','webm','mov'];
              out.extState = {};
              for (const k of extKeys) {
                const e = G.Ext && G.Ext.get(k);
                out.extState[k] = e ? { state: e.state, size: e.size } : 'ABSENT';
              }
              out.typeState = {};
              for (const t of ['video/*','audio/*','application/*']) {
                const e = G.Type && G.Type.get(t);
                out.typeState[t] = e ? { state: e.state, size: e.size } : 'ABSENT';
              }
              out.flags = {
                CheckDownload: G.CheckDownload,
                checkDuplicates: G.checkDuplicates,
                isRegex: G.isRegex,
                tabId: G.tabId,
                maxLength: G.maxLength,
                featAutoDownTabIdSize: G.featAutoDownTabId ? G.featAutoDownTabId.size : 'n/a',
              };
              return out;
            } catch(e){ return { error: String(e) }; }
          })()
        """,
        "returnByValue": True, "awaitPromise": True}, bsid)
    print(json.dumps(r.get("result", {}).get("value"), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
