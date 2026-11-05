# -*- coding: utf-8 -*-
"""live-probe · 真实站点一次访问全链路取证（风控友好）

设计原则（苏哥 2026-11-05）：
    · 一个 URL 只打开一次，一次拿全所有证据，不反复刷新
    · 浏览器实例常驻复用，本脚本只开/关标签页
    · 输出「人话结论」+ 原始 JSON，避免反复试错再开页面

它一次采集：
    1. 页面是否真的加载（title / video 数 / readyState / currentSrc）
    2. 悬停后悬浮面板是否出现、按钮尺寸
    3. 点击主按钮 → 面板最终状态（done / warn / busy）
    4. 后台诊断 vrLastVideoDown（有没有源、选了什么、结果）
    5. chrome.downloads 最近记录（是否真的发起下载、state）
    6. 后台嗅探缓存里该 tab 的条目数（net-sniff 有没有上报）
    7. 下载目录最新文件（是否落盘）
    8. 截图

用法：
    python tools/live-probe.py --url "https://www.tiktok.com/@x/video/123"
    python tools/live-probe.py --url "..." --click 0     # 只看嗅探，不点下载
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.request
from urllib.parse import urlparse

from websocket import create_connection

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOWNLOADS = os.path.join(os.path.expanduser("~"), "Downloads", "video-rod")
KNOWN_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"


class Cdp:
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=6))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=120)
        self.mid = 0
        self.created = []

    def send(self, m, p=None, sid=None):
        self.mid += 1
        msg = {"id": self.mid, "method": m, "params": p or {}}
        if sid:
            msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.mid:
                if "error" in r:
                    raise RuntimeError("%s: %s" % (m, r["error"]))
                res = r.get("result", {})
                if m == "Target.createTarget" and res.get("targetId"):
                    self.created.append(res["targetId"])
                return res

    def open(self, url):
        tid = self.send("Target.createTarget", {"url": url})["targetId"]
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        self.send("Page.enable", {}, sid)
        return tid, sid

    def ev(self, js, sid, await_promise=False, timeout=35):
        old = None
        try:
            old = self.ws.gettimeout()
        except Exception:
            pass
        try:
            self.ws.settimeout(timeout)
            r = self.send("Runtime.evaluate",
                          {"expression": js, "returnByValue": True, "awaitPromise": await_promise},
                          sid)
        except Exception as e:
            return {"__err": "%s: %s" % (type(e).__name__, str(e)[:80])}
        finally:
            try:
                self.ws.settimeout(old)
            except Exception:
                pass
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__err": (d.get("exception", {}) or {}).get("description", d.get("text"))}
        return r.get("result", {}).get("value")

    def shot(self, sid, path):
        r = self.send("Page.captureScreenshot", {"format": "png"}, sid)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(base64.b64decode(r["data"]))

    def close_all(self):
        for t in list(self.created):
            try:
                self.send("Target.closeTarget", {"targetId": t})
            except Exception:
                pass
        self.created = []


PAGE_INFO_JS = r"""(()=>{
  const vs = [...document.querySelectorAll('video')];
  const big = vs.map(v=>{const r=v.getBoundingClientRect();return {v, a:r.width*r.height}})
                .sort((a,b)=>b.a-a.a)[0];
  const v = big ? big.v : null;
  return JSON.stringify({
    title: (document.title||'').slice(0,80),
    url: location.href.slice(0,120),
    videos: vs.length,
    readyState: v ? v.readyState : -1,
    duration: v && isFinite(v.duration) ? Math.round(v.duration) : -1,
    paused: v ? v.paused : null,
    src: v ? String(v.currentSrc||v.src||'').slice(0,140) : ''
  });
})()"""

HOVER_JS = r"""(()=>{
  const vs = [...document.querySelectorAll('video')];
  if (!vs.length) return 'no-video';
  const v = vs.map(x=>{const r=x.getBoundingClientRect();return {x,a:r.width*r.height}})
              .sort((a,b)=>b.a-a.a)[0].x;
  v.scrollIntoView({block:'center'});
  const r = v.getBoundingClientRect();
  const o = {bubbles:true, cancelable:true,
             clientX:r.left+r.width/2, clientY:r.top+r.height/2};
  ['mouseover','mouseenter','mousemove','pointermove'].forEach(t=>{
    try { v.dispatchEvent(new MouseEvent(t, o)); } catch(e){}
  });
  try { v.muted = true; v.play().catch(()=>{}); } catch(e){}
  return 'ok';
})()"""

PANEL_JS = r"""(()=>{
  const p = document.querySelector('.vr-vob');
  if (!p) return 'no-panel';
  const b = p.querySelector('.vr-vob-main');
  const r = b ? b.getBoundingClientRect() : null;
  return JSON.stringify({
    cls: p.className,
    on: p.classList.contains('vr-on'),
    main: !!b,
    w: r ? Math.round(r.width) : 0,
    h: r ? Math.round(r.height) : 0,
    pct: (p.querySelector('.vr-vob-pct')||{}).textContent || '',
    title: b ? (b.getAttribute('title')||'') : ''
  });
})()"""

CLICK_JS = r"""(()=>{
  const p = document.querySelector('.vr-vob');
  if (!p) return 'no-panel';
  const b = p.querySelector('.vr-vob-main');
  if (!b) return 'no-main';
  b.click();
  return 'clicked';
})()"""

MENU_JS = r"""(()=>{
  const p = document.querySelector('.vr-vob');
  if (!p) return 'no-panel';
  const m = p.querySelector('.vr-vob-more');
  if (!m) return 'no-more';
  m.click();
  return 'ok';
})()"""

MENU_LIST_JS = r"""(()=>{
  const items = [...document.querySelectorAll('.vr-vob-item')];
  return JSON.stringify(items.map(i=>i.textContent.trim().replace(/\s+/g,' ').slice(0,60)));
})()"""


def race(js, ms=6000):
    """给任意 Promise 套一个超时，避免某个后端接口不响应把整条 CDP 连接挂死"""
    return ("Promise.race([%s,new Promise(r=>setTimeout(()=>r('__timeout'),%d))])" % (js, ms))


def ext_diag(c, host):
    """在扩展页里读后台诊断数据（storage / downloads / 嗅探缓存）"""
    tid, sid = c.open("chrome-extension://%s/library.html" % KNOWN_EXT)
    time.sleep(2.5)
    out = {}

    out["lastVideoDown"] = c.ev(race(
        "new Promise(r=>chrome.storage.local.get('vrLastVideoDown',"
        "d=>r(JSON.stringify(d.vrLastVideoDown||null))))"), sid, True)

    out["recentDownloads"] = c.ev(race(
        "new Promise(r=>chrome.downloads.search({limit:5,orderBy:['-startTime']},"
        "a=>r(JSON.stringify((a||[]).map(x=>({f:(x.filename||'').split(/[\\\\/]/).pop(),"
        "s:x.state,e:x.error||'',t:x.totalBytes,at:x.startTime})))))"), sid, True)

    # 真实 tabId 只能从 chrome.tabs 反查（targetId 不是 tabId）
    tinfo = c.ev(race(
        "new Promise(r=>chrome.tabs.query({},ts=>r(JSON.stringify("
        "(ts||[]).filter(t=>String(t.url||'').indexOf(%s)>-1)"
        ".map(t=>({id:t.id,u:String(t.url).slice(0,80)}))))))" % json.dumps(host)), sid, True)
    out["targetTabs"] = tinfo
    tab_id = 0
    try:
        arr = json.loads(tinfo) if isinstance(tinfo, str) else tinfo
        if isinstance(arr, list) and arr:
            tab_id = arr[0]["id"]
    except Exception:
        pass

    # 缓存统计（大对象，单独短超时；拿不到也不影响其它证据）
    out["sniffCache"] = c.ev(race(
        "new Promise(r=>chrome.runtime.sendMessage({Message:'getAllData'},d=>{"
        "try{const o={};for(const k in (d||{})){o[k]=(d[k]||[]).length}"
        "r(JSON.stringify({tab:%d,all:o}))}catch(e){r('err:'+e)}}))" % tab_id, 8000),
        sid, True, timeout=15)

    # 该 tab 的媒体条目关键字段（type/ext/url 尾巴）
    items_js = ("new Promise(r=>chrome.runtime.sendMessage({Message:'getAllData'},d=>{"
                "try{const a=(d&&d[%d])||[];" % tab_id) + \
               ("r(JSON.stringify(a.slice(0,12).map(x=>({n:(x.name||'').slice(0,40),"
                "t:x.type||'',x:x.ext||'',"
                "u:String(x.url||'').split('?')[0].slice(-46)}))))}catch(e){r('err:'+e)}}))")
    out["tabItems"] = c.ev(race(items_js, 8000), sid, True, timeout=15)

    c.send("Target.closeTarget", {"targetId": tid})
    return out


def latest_files(limit=4):
    if not os.path.isdir(DOWNLOADS):
        return []
    out = []
    for root, _dirs, files in os.walk(DOWNLOADS):
        for f in files:
            p = os.path.join(root, f)
            try:
                out.append((os.path.getmtime(p), p))
            except Exception:
                pass
    out.sort(reverse=True)
    return [(time.strftime("%H:%M:%S", time.localtime(t)), p) for t, p in out[:limit]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--ext", default=KNOWN_EXT)
    ap.add_argument("--wait", type=int, default=10, help="页面加载等待秒数")
    ap.add_argument("--after", type=int, default=20, help="点击后观察秒数")
    ap.add_argument("--click", type=int, default=1, help="1=点主按钮；0=只看嗅探")
    ap.add_argument("--menu", type=int, default=0, help="1=顺手点开箭头菜单看可选源")
    ap.add_argument("--shot", default="deliverables/assets/live-probe.png")
    a = ap.parse_args()

    c = Cdp(a.port)
    report = {"url": a.url, "at": time.strftime("%Y-%m-%d %H:%M:%S")}
    jp = os.path.join(ROOT, "deliverables", "test-runs",
                      "live-%s.json" % time.strftime("%Y-%m-%d-%H%M"))

    def save():
        """每完成一步就落盘：即使后面某一步卡住，前面的证据也不会丢"""
        os.makedirs(os.path.dirname(jp), exist_ok=True)
        try:
            with open(jp, "w", encoding="utf-8") as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    try:
        tid, sid = c.open(a.url)
        print("[1/6] 页面加载 %ds ..." % a.wait)
        time.sleep(a.wait)

        info = c.ev(PAGE_INFO_JS, sid)
        try:
            report["page"] = json.loads(info) if isinstance(info, str) else info
        except Exception:
            report["page"] = info
        print("    页面:", report["page"])
        save()

        print("[2/6] 悬停最大视频触发嗅探 ...")
        report["hover"] = c.ev(HOVER_JS, sid)
        time.sleep(2.5)
        report["panel_before"] = c.ev(PANEL_JS, sid)
        report["netSniff"] = c.ev("JSON.stringify(window.__vrNetSniff||null)", sid)
        print("    面板:", report["panel_before"])
        print("    接口嗅探自检:", report["netSniff"])
        save()

        if a.menu:
            print("    [附加] 打开可选源菜单 ...")
            c.ev(MENU_JS, sid)
            time.sleep(1.5)
            report["menu_items"] = c.ev(MENU_LIST_JS, sid)
            print("    可选源:", report["menu_items"])
            c.ev("(()=>{const p=document.querySelector('.vr-vob');if(p&&p.classList.contains('vr-on'))p.click();return 1})()", sid)
            time.sleep(0.4)
            save()

        if a.click:
            print("[3/6] 点击主下载按钮 ...")
            report["click"] = c.ev(CLICK_JS, sid)
            print("    点击结果:", report["click"])
            time.sleep(a.after)
            report["panel_after"] = c.ev(PANEL_JS, sid)
            print("    面板最终:", report["panel_after"])
            save()
        else:
            print("[3/6] 跳过点击（--click 0）")

        print("[4/6] 扩展页读后台诊断 ...")
        host = urlparse(a.url).netloc
        d = ext_diag(c, host)
        report.update(d)
        for k in ("lastVideoDown", "recentDownloads", "sniffCache", "tabItems"):
            print("    %-16s %s" % (k, d.get(k)))

        print("[5/6] 下载目录最新文件 ...")
        report["recentFiles"] = latest_files()
        for t, p in report["recentFiles"]:
            print("    %s  %s" % (t, p))

        print("[6/6] 截图 ...")
        try:
            c.shot(sid, os.path.join(ROOT, a.shot))
            report["shot"] = a.shot
            print("    " + a.shot)
        except Exception as e:
            print("    截图失败:", e)
    finally:
        save()
        c.close_all()

    # ---------- 人话结论 ----------
    print("\n" + "=" * 64)
    page = report.get("page") or {}
    panel = report.get("panel_after") or report.get("panel_before") or ""
    lvd = report.get("lastVideoDown")
    try:
        lvd = json.loads(lvd) if isinstance(lvd, str) else lvd
    except Exception:
        pass
    dls = report.get("recentDownloads")
    try:
        dls = json.loads(dls) if isinstance(dls, str) else dls
    except Exception:
        pass

    if isinstance(page, dict) and page.get("title"):
        print("① 页面: 已加载《%s》，%d 个 video，readyState=%s" %
              (page.get("title"), page.get("videos", -1), page.get("readyState")))
    else:
        print("① 页面: 没加载出来 —— 先怀疑实例/网络，不是下载逻辑")
    print("② 面板: %s" % panel)
    if lvd is None:
        print("③ 后台: vrLastVideoDown 为空 → 后台没收到下载请求（面板按钮没发消息或消息被拦）")
    elif isinstance(lvd, dict):
        print("③ 后台: ok=%s reason=%s site=%s 可选源=%s" %
              (lvd.get("ok"), lvd.get("reason"), lvd.get("site"), lvd.get("options")))
    print("④ downloads: %s" % (dls[0] if isinstance(dls, list) and dls else "无记录"))
    print("⑤ 落盘: %s" % (report.get("recentFiles") or "无文件"))
    print("=" * 64)
    print("取证:", jp)
    return 0


if __name__ == "__main__":
    sys.exit(main())
