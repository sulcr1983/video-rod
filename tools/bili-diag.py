# Bilibili 实站嗅探诊断（星愿 9223）
# 用途：确认钓鱼竿扩展在真实 B 站能否嗅探到媒体，并定位 0 卡片的根因。
import json
import os
import time
import urllib.request

from websocket import create_connection

CDP_URL = os.environ.get("VR_CDP", "http://127.0.0.1:9223")
EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
BILI_URL = ("https://www.bilibili.com/video/BV1DVaZ6hEK6/"
            "?trackid=web_pegasus_0.router-web-pegasus-2479516-gfll4"
            ".1792333424917.283&spm_id_from=333.1007.tianma.1-2-2.click")

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

    def eval(self, expr, session, await_promise=True):
        r = self.send("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": await_promise,
        }, session)
        if r.get("exceptionDetails"):
            return {"__error": str(r["exceptionDetails"])}
        return r.get("result", {}).get("value")

    def attach(self, target_id):
        return self.send("Target.attachToTarget",
                         {"targetId": target_id, "flatten": True})["sessionId"]

    def targets(self):
        return self.send("Target.getTargets")["targetInfos"]


def main():
    cdp = Cdp(CDP_URL)
    print("== 1) 目标列表 ==")
    targets = cdp.targets()
    bili = None
    sw = None
    for t in targets:
        u = t.get("url", "")
        ty = t.get("type", "")
        if ty == "page" and "bilibili.com/video" in u:
            bili = t
        if ty == "service_worker" and u.startswith(f"chrome-extension://{EXT_ID}/"):
            sw = t
        print(f"  [{ty}] {u[:90]}")
    print(f"  -> Bilibili 页面: {bili['targetId'] if bili else '无'}")
    print(f"  -> 钓鱼竿 SW: {sw['targetId'] if sw else '无'}")

    # 没有 B 站页面就新建并导航
    if not bili:
        print("\n== 2) 新建 B 站页面并导航 ==")
        tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
        psid = cdp.attach(tid)
        cdp.send("Network.enable", {}, psid)
        cdp.send("Network.setCacheDisabled", {"cacheDisabled": True}, psid)
        cdp.send("Page.enable", {}, psid)
        cdp.send("Page.navigate", {"url": BILI_URL}, psid)
        time.sleep(12)
        bili = cdp.find(lambda t: "bilibili.com/video" in t.get("url", ""))
        if not bili:
            raise RuntimeError("导航后仍未找到 B 站页面")
        print(f"  已导航: {bili['targetId']}")
    else:
        psid = cdp.attach(bili["targetId"])

    bsid = cdp.attach(sw["targetId"]) if sw else None

    # 页面端：视频元素状态
    print("\n== 3) 页面端视频/播放器状态 ==")
    page_state = cdp.eval(r"""
      (() => {
        const v = document.querySelector('video');
        return {
          url: location.href.slice(0, 80),
          hasVideo: !!v,
          videoCount: document.querySelectorAll('video').length,
          currentSrc: v ? (v.currentSrc || v.src || '').slice(0, 80) : null,
          duration: v ? v.duration : null,
          paused: v ? v.paused : null,
          readyState: v ? v.readyState : null,
          contentScriptFlag: (window.isPlayerMediaLoaded !== undefined) || (typeof window.catCatch !== 'undefined'),
        };
      })()
    """, psid)
    print("  " + json.dumps(page_state, ensure_ascii=False))

    if not bsid:
        print("\n!! 未找到钓鱼竿 SW，无法继续后端诊断")
        return

    # 后端：扩展全局状态
    print("\n== 4) 扩展 SW 全局状态 ==")
    gstate = cdp.eval(r"""
      (() => {
        try {
          const keys = (typeof cacheData !== 'undefined') ? Object.keys(cacheData) : 'NO_CACHE';
          const sizes = (typeof cacheData !== 'undefined')
            ? Object.fromEntries(Object.entries(cacheData).map(([k,v]) => [k, Array.isArray(v)?v.length:'?']))
            : {};
          const extList = (typeof G !== 'undefined' && G.Ext) ? ['m4s','m4','mp4','m4a','ts'].filter(e => G.Ext.has(e)) : 'NO_G';
          return { hasCacheData: typeof cacheData !== 'undefined', keys, sizes, extRecognized: extList };
        } catch (e) { return { error: String(e) }; }
      })()
    """, bsid)
    print("  " + json.dumps(gstate, ensure_ascii=False))

    # 后端：B 站登录态（cookie）
    print("\n== 5) B 站登录态 cookie ==")
    login = cdp.eval(r"""
      new Promise(res => {
        try {
          chrome.cookies.getAll({ domain: 'bilibili.com' }, cs => {
            const names = cs.map(c => c.name);
            res({
              count: cs.length,
              hasSESSDATA: names.includes('SESSDATA'),
              hasBiliJct: names.includes('bili_jct'),
              sample: names.slice(0, 12),
            });
          });
        } catch (e) { res({ error: String(e) }); }
      })
    """, bsid)
    print("  " + json.dumps(login, ensure_ascii=False))

    # 后端：B 站页面 tabId 对应的 cacheData
    print("\n== 6) 当前 B 站 tab 的嗅探结果（getMediaData）==")
    media = cdp.eval(r"""
      new Promise(res => {
        try {
          chrome.tabs.query({ url: '*://*.bilibili.com/video*' }, ts => {
            if (!ts.length) { res({ tabs: 0 }); return; }
            const tid = ts[0].id;
            chrome.runtime.sendMessage({ Message: 'getMediaData', tabId: tid }, r => {
              res({ tabId: tid, count: Array.isArray(r) ? r.length : 'n/a',
                    sample: Array.isArray(r) ? r.slice(0, 3).map(x => ({ name: (x.name||'').slice(0,40), ext: x.ext, type: x.type, url: (x.url||'').slice(0,70) })) : r });
            });
          });
        } catch (e) { res({ error: String(e) }); }
      })
    """, bsid)
    print("  " + json.dumps(media, ensure_ascii=False))

    cdp.ws.close()


if __name__ == "__main__":
    main()
