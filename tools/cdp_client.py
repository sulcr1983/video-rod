# video-rod CDP 测试公用客户端
# 供 cdp-m1-test.py / cdp-m2-test.py 等复用
#
# 标签生命周期：脚本用 Target.createTarget 建的标签全部登记在 cdp.created 里，
# 进程退出（含 sys.exit / 异常）时由 atexit 统一关闭，避免测试跑完留下一堆标签页。
import atexit
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
        self.created = []          # 本进程自建的标签，退出时统一关闭
        self._closed = False
        atexit.register(self.close_created)

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
                res = r.get("result", {})
                # 自动登记自建标签（脚本无需逐个调 close）
                if method == "Target.createTarget" and res.get("targetId"):
                    self.created.append(res["targetId"])
                return res
            self.events.append(r)

    def close_created(self):
        """关闭本进程自建的全部标签。幂等；浏览器已关时静默跳过。"""
        if self._closed:
            return 0
        self._closed = True
        closed = 0
        for tid in list(self.created):
            try:
                self.send("Target.closeTarget", {"targetId": tid})
                closed += 1
            except Exception:
                pass          # 浏览器退出 / 标签已被脚本自己关掉
        self.created = []
        try:
            self.ws.close()
        except Exception:
            pass
        return closed

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

    def wait_js(self, session, expr, timeout=8.0, interval=0.05):
        """轮询直到表达式返回真值，返回该值；超时返回 None。
        用来替代「等页面加载 time.sleep(2.0)」这类固定等待——
        条件一满足就往下走，通常能省掉一半以上的空等。"""
        import time as _t
        deadline = _t.time() + timeout
        last = None
        while _t.time() < deadline:
            last = self.eval(expr, session)
            if last and not (isinstance(last, dict) and "__error" in last):
                return last
            _t.sleep(interval)
        return None

    def wait_ready(self, session, timeout=10.0):
        """等到 document.readyState === 'complete'（比固定 sleep 快且稳）。"""
        return bool(self.wait_js(session, "document.readyState === 'complete'", timeout))

    def wait_selector(self, session, selector, timeout=8.0):
        """等到选择器出现。"""
        return self.wait_js(
            session,
            "!!document.querySelector(%s)" % json.dumps(selector),
            timeout)

    def navigate(self, session, url, timeout=12.0):
        """导航并等加载完成，替代 sleep + 盲等。"""
        self.send("Page.navigate", {"url": url}, session)
        self.wait_ready(session, timeout)
        return True

    def reload(self, session, timeout=12.0):
        self.send("Page.reload", {"ignoreCache": True}, session)
        self.wait_ready(session, timeout)
        return True

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
