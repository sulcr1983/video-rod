# video-rod CDP 测试公用客户端
# 供 cdp-m1-test.py / cdp-m2-test.py 等复用
import json
import os
import urllib.request

from websocket import create_connection

CDP_URL = os.environ.get("VR_CDP", "http://127.0.0.1:9222")
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Cdp:
    def __init__(self, url=None):
        ver = json.load(_opener.open((url or CDP_URL) + "/json/version"))
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

    def find(self, pred):
        for t in self.targets():
            if pred(t):
                return t
        return None

    def errors(self):
        out = []
        for e in self.events:
            m = e.get("method")
            if m == "Runtime.consoleAPICalled" and e["params"].get("type") == "error":
                out.append("console.error: " + json.dumps(e["params"].get("args"))[:300])
            if m == "Runtime.exceptionThrown":
                out.append("exception: " + json.dumps(e["params"].get("exceptionDetails"))[:300])
        return out[:10]


def find_ext_id(cdp):
    """扩展 ID：优先 background.js 的 service worker，其次 profile Preferences"""
    targets = cdp.targets()
    for t in targets:
        u = t.get("url", "")
        if t["type"] == "service_worker" and u.startswith("chrome-extension://") and "background.js" in u:
            return u.split("/")[2], t
    for t in targets:
        u = t.get("url", "")
        if t["type"] == "service_worker" and u.startswith("chrome-extension://"):
            return u.split("/")[2], t

    prefs = os.path.join(os.environ.get("VR_PROFILE", r"E:/test/download/.chromium-videorod"),
                         "Default", "Preferences")
    if os.path.exists(prefs):
        try:
            data = json.load(open(prefs, encoding="utf-8"))
            for ext_id, s in (data.get("extensions", {}).get("settings", {}) or {}).items():
                path = str(s.get("path", "")).replace("\\\\", "/")
                if "video-rod" in path:
                    return ext_id, None
        except Exception:
            pass
    return None, None


def open_popup(cdp, page_url):
    """清理旧面板页/旧测试页 → 新建前台测试页（禁缓存，保证子资源走网络触发 webRequest）
    → 打开带 tabId 的面板页。返回 (sessionId, tabId)

    关键：必须新建标签页。复用旧后台标签页时子资源全命中 HTTP 缓存，
    webRequest 不触发，嗅探结果为 0——这是测试脚手架的坑，不是产品缺陷。
    """
    import time

    ext_id, _ = find_ext_id(cdp)
    if not ext_id:
        raise RuntimeError("扩展未加载（service worker 找不到）")

    popup_url = f"chrome-extension://{ext_id}/popup.html"
    boot = cdp.send("Target.createTarget", {"url": popup_url})["targetId"]
    psid = cdp.attach(boot)
    cdp.send("Runtime.enable", {}, psid)
    cdp.send("Page.enable", {}, psid)
    time.sleep(1.0)

    self_tab = cdp.eval("new Promise(r => chrome.tabs.getCurrent(t => r(t ? t.id : -1)));", psid)
    # 关掉所有旧的面板页和旧测试页，避免缓存命中 + 串数据
    cdp.eval("""
      new Promise(r => chrome.tabs.query({}, ts => {
        const kill = ts.filter(t => t.id !== %s &&
          ((t.url || '').indexOf('/popup.html') >= 0 || (t.url || '').indexOf(%s) === 0));
        Promise.all(kill.map(t => new Promise(x => chrome.tabs.remove(t.id, () => x()))))
          .then(() => r(kill.length));
      }))
    """ % (self_tab, json.dumps(page_url)), psid)

    # 新建空白页 → 先禁缓存 → 再导航，保证主文档+子资源全部走网络
    fresh = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    fsid = cdp.attach(fresh)
    cdp.send("Network.enable", {}, fsid)
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True}, fsid)
    cdp.send("Page.enable", {}, fsid)
    cdp.send("Page.navigate", {"url": page_url}, fsid)
    time.sleep(4.0)

    tab_id = cdp.eval(
        "new Promise(r => chrome.tabs.query({}, ts => r("
        "ts.filter(t => (t.url || '').indexOf(%s) === 0).map(t => t.id)[0] ?? -1)))"
        % json.dumps(page_url), psid)
    if not tab_id or tab_id < 0:
        raise RuntimeError("新测试页拿不到 tabId")

    cdp.send("Page.navigate", {"url": popup_url + f"?tabId={tab_id}"}, psid)
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": 400, "height": 600, "deviceScaleFactor": 2, "mobile": False
    }, psid)
    time.sleep(3.0)
    return psid, tab_id
