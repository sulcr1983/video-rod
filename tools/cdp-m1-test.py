# video-rod M1 面板 CDP 验收脚本
# 用途：连接本机有头 Chrome（--remote-debugging-port=9222 + --load-extension），
#      直接以扩展页面方式打开 popup.html，做 DOM 断言 + 截图。
# 用法：python tools/cdp-m1-test.py [screenshot_out.png]
import base64
import json
import os
import sys
import time
import urllib.request

from websocket import create_connection

CDP_URL = os.environ.get("VR_CDP", "http://127.0.0.1:9222")
TEST_PAGE = os.environ.get("VR_TEST_PAGE", "http://127.0.0.1:18080/index.html")
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Cdp:
    def __init__(self):
        ver = json.load(_opener.open(CDP_URL + "/json/version"))
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

    def find(self, pred):
        for t in self.send("Target.getTargets")["targetInfos"]:
            if pred(t):
                return t
        return None


def find_ext_id(cdp):
    """扩展 ID：优先 background.js 的 service worker，其次 profile Preferences"""
    targets = cdp.send("Target.getTargets")["targetInfos"]
    for t in targets:
        u = t.get("url", "")
        if t["type"] == "service_worker" and u.startswith("chrome-extension://") and "background.js" in u:
            return u.split("/")[2], t
    for t in targets:
        u = t.get("url", "")
        if t["type"] == "service_worker" and u.startswith("chrome-extension://"):
            return u.split("/")[2], t

    prefs = os.path.join(os.environ.get("VR_PROFILE", r"E:/test/download/.chrome-videorod"),
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


def main():
    out_png = sys.argv[1] if len(sys.argv) > 1 else ""
    cdp = Cdp()
    report = {"steps": [], "errors": []}

    # 1) 扩展 ID
    ext_id, sw = find_ext_id(cdp)
    report["extId"] = ext_id
    report["steps"].append(f"ext id = {ext_id}")

    # 2) 先开一个裸面板页（扩展页自带 tabs 权限），由它自己查 tabId
    popup_url = f"chrome-extension://{ext_id}/popup.html"
    tgt = cdp.send("Target.createTarget", {"url": popup_url})
    psid = cdp.attach(tgt["targetId"])
    cdp.send("Runtime.enable", {}, psid)
    cdp.send("Page.enable", {}, psid)
    time.sleep(1.2)

    # 2) 清掉上一轮残留的面板标签页（保留当前这一页，别把自己关了）
    self_tab = cdp.eval("new Promise(r => chrome.tabs.getCurrent(t => r(t ? t.id : -1)));", psid)
    cdp.eval("""
      new Promise(r => chrome.tabs.query({}, ts => {
        const kill = ts.filter(t => (t.url || '').indexOf('/popup.html') >= 0 && t.id !== %s);
        Promise.all(kill.map(t => new Promise(x => chrome.tabs.remove(t.id, () => x()))))
          .then(() => r(kill.length));
      }))
    """ % self_tab, psid)

    # 3) 找测试页（按完整 URL 精确比对，不用 query 的 pattern 匹配）
    page_url = TEST_PAGE
    tabs = cdp.eval(
        "new Promise(r => chrome.tabs.query({}, ts => r("
        "ts.filter(t => t.url === %s).map(t => ({id: t.id, url: t.url})))))"
        % json.dumps(page_url), psid)
    if not tabs:
        cdp.send("Target.createTarget", {"url": page_url})
        time.sleep(2.5)
        tabs = cdp.eval(
            "new Promise(r => chrome.tabs.query({}, ts => r("
            "ts.filter(t => t.url === %s).map(t => ({id: t.id, url: t.url})))))"
            % json.dumps(page_url), psid)
    if not tabs:
        print("ERROR: 测试页未打开")
        sys.exit(1)
    tab_id = tabs[0]["id"]
    report["tabId"] = tab_id
    report["steps"].append(f"test page tabId={tab_id} url={page_url}")

    # 重载一次测试页：确保嗅探器（扩展）已就绪后才产生媒体请求
    cdp.eval(f"new Promise(r => chrome.tabs.reload({tab_id}, {{}}, () => r('ok')));", psid)
    time.sleep(3.5)
    report["steps"].append("test page reloaded for sniffing")

    # 给嗅探器一点时间（页面已加载，通常已有数据）
    time.sleep(2.0)

    # 3) 带 tabId 重新载入面板页
    cdp.send("Page.navigate", {"url": popup_url + f"?tabId={tab_id}"}, psid)
    cdp.send("Emulation.setDeviceMetricsOverride", {
        "width": 400, "height": 640, "deviceScaleFactor": 2, "mobile": False
    }, psid)
    time.sleep(3.2)

    # 4) DOM 断言
    checks = {
        "titled": "document.title",
        "cardCount": "document.querySelectorAll('#mediaList .panel').length",
        "badges": "[...document.querySelectorAll('#mediaList .panel .badge')].map(e=>e.textContent.trim())",
        "names": "[...document.querySelectorAll('#mediaList .panel .vr-name')].map(e=>e.value)",
        "dirs": "[...document.querySelectorAll('#mediaList .panel .vr-dir-txt')].map(e=>e.textContent.trim())",
        "qualities": "document.querySelectorAll('#mediaList .panel .qsel').length",
        "site": "(document.getElementById('vrSite')||{}).textContent",
        "pageTitle": "(document.getElementById('vrPageTitle')||{}).textContent",
        "count": "(document.getElementById('vrCount')||{}).textContent",
        "chipCounts": "[...document.querySelectorAll('#vrFilters .fchip')].map(e=>e.textContent.replace(/\\s+/g,' ').trim())",
        "footCnt": "(document.getElementById('vrBatchCnt')||{}).textContent",
        "selTxt": "(document.getElementById('selTxt')||{}).textContent",
        "hasSettingsDrawer": "!!document.getElementById('vrSettings')",
        "hasToolsDrawer": "!!document.getElementById('vrTools')",
        "hasRenameModal": "!!document.getElementById('vrRenameModal')",
        "themeWidth": "document.body.getBoundingClientRect().width",
        "bodyBg": "getComputedStyle(document.body).backgroundColor",
        "namingLoaded": "typeof window.VideoRodNaming === 'object'",
    }
    result = {}
    for k, expr in checks.items():
        result[k] = cdp.eval(expr, psid)
    report["dom"] = result

    # 4.5) 视口高度对齐真实 popup（先量内容高度再测交互，弹层定位才准）
    shot_h = 600
    try:
        shot_h = cdp.eval(
            "Math.ceil(document.getElementById('vrShell').getBoundingClientRect().height)", psid)
        shot_h = max(220, min(600, int(shot_h or 600)))
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 400, "height": shot_h, "deviceScaleFactor": 2, "mobile": False
        }, psid)
        time.sleep(0.35)
    except Exception:
        pass

    # 5) 交互冒烟：筛选 / 打开设置 / 打开命名弹层 / 改文件名
    smoke = {}
    smoke["clickImgChip"] = cdp.eval("""
      (() => {
        const c = [...document.querySelectorAll('#vrFilters .fchip')].find(x=>x.dataset.f==='img');
        if (!c) return 'no-chip';
        c.click();
        const off = document.querySelectorAll('#mediaList .panel.vr-type-off').length;
        const all = document.querySelectorAll('#mediaList .panel').length;
        [...document.querySelectorAll('#vrFilters .fchip')].find(x=>x.dataset.f==='all').click();
        return {hidden: off, total: all};
      })()
    """, psid)
    smoke["openSettings"] = cdp.eval("""
      (() => { document.getElementById('btnSettings').click();
        return document.getElementById('vrSettings').classList.contains('on'); })()
    """, psid)
    smoke["closeSettings"] = cdp.eval("""
      (() => { document.querySelector('[data-close="vrSettings"]').click();
        return !document.getElementById('vrSettings').classList.contains('on'); })()
    """, psid)
    smoke["openTools"] = cdp.eval("""
      (() => { document.getElementById('btnTools').click();
        return document.getElementById('vrTools').classList.contains('on'); })()
    """, psid)
    smoke["closeTools"] = cdp.eval("""
      (() => { document.querySelector('[data-close="vrTools"]').click();
        return !document.getElementById('vrTools').classList.contains('on'); })()
    """, psid)
    smoke["renameModal"] = cdp.eval("""
      (() => {
        const boxes = [...document.querySelectorAll('#mediaList .panel .DownCheck')];
        if (boxes[0] && !boxes[0].checked) boxes[0].click();
        document.getElementById('vrRename').click();
        return {open: document.getElementById('vrRenameModal').classList.contains('on'),
                cnt: (document.getElementById('vrRenameCnt')||{}).textContent,
                preview: (document.getElementById('vrTplPreview')||{}).textContent.slice(0,120)};
      })()
    """, psid)
    smoke["renameApply"] = cdp.eval("""
      (() => {
        document.getElementById('vrTplInput').value = '${site}_${index}';
        document.getElementById('vrApplyTpl').click();
        return [...document.querySelectorAll('#mediaList .panel .vr-name')].map(e=>e.value);
      })()
    """, psid)
    smoke["checkAll"] = cdp.eval("""
      (() => {
        const a = document.getElementById('chkAll');
        a.checked = true; a.dispatchEvent(new Event('change'));
        return {checked: [...document.querySelectorAll('#mediaList .panel .DownCheck')].filter(b=>b.checked).length,
                batch: (document.getElementById('vrBatchCnt')||{}).textContent};
      })()
    """, psid)
    report["smoke"] = smoke

    # 6) 控制台错误
    errs = []
    for e in cdp.events:
        m = e.get("method")
        if m == "Runtime.consoleAPICalled" and e["params"].get("type") == "error":
            errs.append("console.error: " + json.dumps(e["params"].get("args"))[:400])
        if m == "Runtime.exceptionThrown":
            errs.append("exception: " + json.dumps(e["params"].get("exceptionDetails"))[:400])
    report["errors"] = errs[:10]

    # 6.5) 指定状态截图（VR_STATE=settings|tools|rename|dirmenu|img）
    state = os.environ.get("VR_STATE", "")
    if state:
        exprs = {
            "settings": "document.getElementById('btnSettings').click()",
            "tools": "document.getElementById('btnTools').click()",
            "rename": ("(()=>{const b=document.querySelector('#mediaList .panel .DownCheck');"
                       "if(b&&!b.checked)b.click();document.getElementById('vrRename').click();})()"),
            "dirmenu": "document.querySelector('#mediaList .panel [data-vr-dir]').click()",
            "img": ("[...document.querySelectorAll('#vrFilters .fchip')]"
                    ".find(x=>x.dataset.f==='img').click()"),
        }
        if state in exprs:
            cdp.eval(exprs[state], psid)
            time.sleep(0.7)

    # 7) 截图（视口截图，高度已对齐 #vrShell，等同于真实 popup 窗口）
    if out_png:
        try:
            time.sleep(1.6)   # 等冒烟测试触发的 toast 淡出，别糊在截图上
            shot = cdp.send("Page.captureScreenshot", {"format": "png"}, psid)
            os.makedirs(os.path.dirname(out_png), exist_ok=True)
            with open(out_png, "wb") as f:
                f.write(base64.b64decode(shot["data"]))
            report["screenshot"] = out_png
            report["shotHeight"] = shot_h
        except Exception as exc:
            report["screenshotError"] = str(exc)

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
