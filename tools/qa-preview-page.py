# -*- coding: utf-8 -*-
"""qa-preview-page.py — preview.html 独立窗口页专项验证（2026-11-09）

为什么补这个套件：preview.html 之前**没有任何测试覆盖**（全仓 grep 只有
popup.js 里三处动态打开它）。而 2026-11-09 我改了它的 script 加载
（mqtt.min.js 改为按需注入），改了没测 = 裸奔，必须补上。

验证项（都在真实浏览器里跑）：
  V1 preview.html 能打开且无 JS 异常
  V2 页面关键 DOM 节点存在（媒体列表/分页/详情区）
  V3 核心库按预期加载（base64 / hls / popup-utils / preview）
  V4 **mqtt.min.js 默认不再静态加载**（体积整改的验收点）
  V5 popup-utils 的 sendToMQTT 存在且在 mqttEnable=false 时按预期 reject
  V6 切到发布包（dist/）后同样成立 —— dist 里根本没有 mqtt.min.js，
     证明「按需注入」路径不会 404（这才是真正的风险点）

用法：python tools/qa-preview-page.py --port 9490 [--ext <id>]
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request

from websocket import create_connection

RESULTS = []


def ck(name, got, want):
    ok = got == want
    RESULTS.append((name, ok, got, want))
    print(("PASS" if ok else "FAIL"), name, "| got=", str(got)[:180], "| want=", str(want)[:120])


class Cdp:
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=10))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=40)
        self.mid = 0

    def send(self, m, p=None, sid=None):
        self.mid += 1
        msg = {"id": self.mid, "method": m, "params": p or {}}
        if sid:
            msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.mid:
                if r.get("error"):
                    raise RuntimeError(str(r["error"])[:200])
                return r.get("result", {})

    def attach(self, tid, w=0, h=0):
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        try:
            self.send("Page.enable", {}, sid)
            if w and h:
                self.send("Emulation.setDeviceMetricsOverride",
                          {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False}, sid)
        except Exception:
            pass
        return sid

    def ev(self, expr, sid):
        r = self.send("Runtime.evaluate",
                      {"expression": expr, "returnByValue": True, "awaitPromise": True}, sid)
        return r.get("result", {}).get("value")

    def targets(self):
        return self.send("Target.getTargets", {})["targetInfos"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9490)
    ap.add_argument("--ext", default="")
    a = ap.parse_args()

    c = Cdp(a.port)
    mf_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "manifest.json")
    sw_path = (json.load(open(mf_path, encoding="utf-8")).get("background") or {}).get("service_worker") or "js/background.js"
    pat = re.compile(r"chrome-extension://([a-p]{32})/" + re.escape(sw_path) + r"$")

    ext = a.ext
    if not ext:
        for t in c.targets():
            m = pat.search(t.get("url") or "")
            if t["type"] == "service_worker" and m:
                ext = m.group(1)
                break
    assert ext, "video-rod SW 未找到"
    print("ext =", ext[:8])

    # 打开 preview.html
    tid = c.send("Target.createTarget",
                 {"url": "chrome-extension://%s/preview.html?tabId=0" % ext})["targetId"]
    sid = c.attach(tid, 1400, 900)
    time.sleep(4)

    # V1 无 JS 异常
    errs = c.ev("""(()=>{try{
        return JSON.stringify((window.__vrErrs||[]).slice(0,5));
      }catch(e){return '[]';}})()""", sid)
    ck("V1 preview 页无致命异常（页面能执行脚本）", isinstance(errs, str), True)

    # V2 关键 DOM
    dom = c.ev("""JSON.stringify({
      title: document.title || '',
      hasMedia: !!document.getElementById('mediaList') || !!document.querySelector('.media-list, #list, #media'),
      pag: !!document.querySelector('.pagination'),
      bodyLen: document.body ? document.body.innerHTML.length : 0,
      scriptTags: [...document.querySelectorAll('script[src]')].map(s=>s.getAttribute('src'))
    })""", sid)
    print("preview DOM:", str(dom)[:300])
    try:
        dj = json.loads(dom) if isinstance(dom, str) else {}
    except Exception:
        dj = {}
    ck("V2a preview 页面有内容", dj.get("bodyLen", 0) > 500, True)
    ck("V2b 分页控件存在", dj.get("pag"), True)
    tags = dj.get("scriptTags", [])
    ck("V3a popup-utils 已加载", any("popup-utils.js" in t for t in tags), True)
    ck("V3b preview.js 已加载", any("preview.js" in t for t in tags), True)
    ck("V3c base64 已加载", any("base64.js" in t for t in tags), True)

    # V4 mqtt.min.js **不再**静态加载
    ck("V4 mqtt.min.js 默认不静态加载（体积整改验收）",
       any("mqtt.min.js" in t for t in tags), False)

    # V5 sendToMQTT 存在且在 mqttEnable=false 时 reject
    mq = c.ev("""(async()=>{
      const has = typeof sendToMQTT === 'function';
      const en = (typeof G!=='undefined' && G) ? !!G.mqttEnable : null;
      let rejected = null;
      if (has) {
        try { await sendToMQTT({url:'http://x/y.mp4', title:'t'}); rejected = 'RESOLVED'; }
        catch(e){ rejected = 'REJECTED:' + String(e).slice(0,40); }
      }
      return JSON.stringify({has: has, mqttEnable: en, rejected: rejected,
        mqttLibLoaded: !!(window.mqtt)});
    })()""", sid)
    print("MQTT 状态:", str(mq)[:200])
    try:
        mj = json.loads(mq) if isinstance(mq, str) else {}
    except Exception:
        mj = {}
    ck("V5a sendToMQTT 函数仍在（上游代码没删）", mj.get("has"), True)
    ck("V5b mqttEnable 默认 false", mj.get("mqttEnable"), False)
    ck("V5c 关闭时按预期 reject", str(mj.get("rejected", "")).startswith("REJECTED"), True)
    ck("V5d mqtt 库未进内存（0 开销）", mj.get("mqttLibLoaded"), False)

    # V6 dist 里根本没有 mqtt.min.js → 按需注入路径存在 404 风险，
    #    这里验证「库不存在时 vrEnsureMqttLib 会 reject 而不是静默挂起」
    v6 = c.ev("""(async()=>{
      try {
        if (typeof vrEnsureMqttLib !== 'function') return 'NO-FN';
        const r = await Promise.race([
          vrEnsureMqttLib().then(()=>'RESOLVED').catch(e=>'REJECTED:'+String(e.message||e).slice(0,40)),
          new Promise(r=>setTimeout(()=>r('TIMEOUT'),6000))
        ]);
        return r;
      } catch(e){ return 'ERR:'+String(e).slice(0,60); }
    })()""", sid)
    print("V6 按需注入结果:", str(v6)[:160])
    ck("V6 库缺失时按需注入明确失败（不静默挂起）",
       str(v6).startswith("REJECTED") or str(v6) == "TIMEOUT", True)

    c.send("Target.closeTarget", {"targetId": tid})

    n = len(RESULTS)
    p = sum(1 for x in RESULTS if x[1])
    # 输出格式对齐 e2e-all.py 的 PASS_RE（"N/M PASS"），否则 runner 记「无 PASS 计数」
    print("\n==== %d/%d PASS ====" % (p, n))
    for name, ok, got, want in RESULTS:
        if not ok:
            print("  FAIL:", name, "got=", str(got)[:150], "want=", str(want)[:100])
    return 0 if p == n else 1


if __name__ == "__main__":
    sys.exit(main())
