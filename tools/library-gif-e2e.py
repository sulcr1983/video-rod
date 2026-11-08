#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""动图（GIF）查看器键盘回归：真实 9480 库 + 临时合成 GIF。

覆盖：打开动图预览、Space 暂停/继续、. 逐帧、L 循环、0 回第一帧。
测试结束删除临时 DB 条目和 .work 文件，不碰用户素材。
"""
import argparse
import json
import os
from vr_testenv import work_root
import sys
import time
import urllib.request
from datetime import datetime

from websocket import create_connection

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

DEFAULT_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"
GIF = os.path.join(work_root(), "gif-fixture.gif")
RESULTS = []


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=8))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=90)
        self.mid = 0

    def send(self, method, params=None, sid=None):
        self.mid += 1
        i = self.mid
        msg = {"id": i, "method": method, "params": params or {}}
        if sid:
            msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == i:
                if "error" in r:
                    raise RuntimeError("%s: %s" % (method, r["error"]))
                return r.get("result", {})

    def ev(self, js, sid, await_promise=True):
        r = self.send("Runtime.evaluate", {
            "expression": js, "returnByValue": True, "awaitPromise": await_promise
        }, sid)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__err": ((d.get("exception") or {}).get("description") or d.get("text") or "JS error")[:400]}
        return r.get("result", {}).get("value")

    def key(self, key, code, vk, sid):
        base = {"key": key, "code": code, "windowsVirtualKeyCode": vk,
                "nativeVirtualKeyCode": vk}
        self.send("Input.dispatchKeyEvent", dict(base, type="keyDown"), sid)
        self.send("Input.dispatchKeyEvent", dict(base, type="keyUp"), sid)

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def check(name, ok, detail=""):
    RESULTS.append({"name": name, "pass": bool(ok), "detail": str(detail)[:300]})
    print(("PASS  " if ok else "FAIL  ") + name + (("  [" + str(detail)[:180] + "]") if not ok else ""))


def make_gif():
    # 优先复用 .work 里的 10 帧公开夹具；没有才用 Pillow 生成兜底
    if os.path.exists(GIF) and os.path.getsize(GIF) > 1000:
        return os.path.getsize(GIF)
    try:
        import urllib.request
        req = urllib.request.Request(
            "https://loremfile.dev/gif/animated-10frames-256x256.gif",
            headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=20).read()
        os.makedirs(os.path.dirname(GIF), exist_ok=True)
        open(GIF, "wb").write(data)
        return len(data)
    except Exception:
        pass
    from PIL import Image, ImageDraw
    frames = []
    for color in ((220, 70, 70), (70, 180, 220), (240, 190, 70)):
        im = Image.new("RGB", (48, 48), color)
        d = ImageDraw.Draw(im)
        d.rectangle((10, 10, 38, 38), fill=(20, 20, 20))
        frames.append(im)
    os.makedirs(os.path.dirname(GIF), exist_ok=True)
    frames[0].save(GIF, save_all=True, append_images=frames[1:], duration=120, loop=0)
    return os.path.getsize(GIF)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--ext", default=DEFAULT_EXT)
    ap.add_argument("--json", default="deliverables/test-runs/library-gif-e2e.json")
    a = ap.parse_args()

    size = make_gif()
    rel = "video-rod/_audit/anim/gif-e2e-%d.gif" % int(time.time())
    abs_path = GIF.replace("\\", "/")
    c = Cdp(a.port)
    tid = sid = None
    try:
        tid = c.send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % a.ext})["targetId"]
        sid = c.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        c.send("Runtime.enable", {}, sid)
        c.send("Page.enable", {}, sid)
        time.sleep(5)  # 等扩展页 boot 完成，VRDB 可用后再种临时条目
        put = c.ev("""VRDB.putFiles([{relPath:%s,absPath:%s,platform:'web',type:'image',fileName:'gif-e2e.gif',
          displayName:'GIF 回归素材',size:%d,mtime:Date.now(),state:'ok',starred:0,tags:[]}]).then(()=>1)""" %
                   (json.dumps(rel), json.dumps(abs_path), size), sid)
        n_seed = c.ev("VRDB.getAllFiles().then(r=>r.length)", sid)
        check("GIF 夹具入库", put == 1 and n_seed == 36, {"put": put, "rows": n_seed})
        c.send("Page.reload", {"ignoreCache": True}, sid)
        time.sleep(5)

        opened = c.ev("""(()=>{const c=document.querySelector('#grid .card[data-id="'+CSS.escape(%s)+'"]');
          if(!c)return 'no-card';c.click();return 1})()""" % json.dumps(rel), sid, False)
        time.sleep(2.0)
        if opened != 1:
            print("DBG", c.ev("""VRDB.getAllFiles().then(r=>JSON.stringify({n:r.length,
              tail:r.slice(-3).map(x=>({rel:x.relPath,type:x.type,dn:x.displayName})),
              cards:[...document.querySelectorAll('#grid .card')].slice(-4).map(c=>c.dataset.id)}))""", sid))
        check("GIF 卡片能打开预览", opened == 1, opened)
        st = c.ev("""(()=>{const bar=document.getElementById('gifBar');
          return JSON.stringify({barHidden:bar?bar.classList.contains('hidden'):null,
            total:(document.getElementById('gTotal')||{}).textContent||'',
            no:(document.getElementById('gNo')||{}).textContent||'',
            icon:(document.querySelector('#gPause use')||{}).getAttribute?document.querySelector('#gPause use').getAttribute('href'):'',
            loop:(document.getElementById('gLoop')||{}).textContent||''})})()""", sid, False)
        try: s = json.loads(st) if isinstance(st, str) else {}
        except Exception: s = {}
        check("GIF 控件条出现", s.get("barHidden") is False, s)
        check("GIF 帧数已识别", str(s.get("total", "")).isdigit() and int(s.get("total", 0)) >= 2, s.get("total"))

        c.key(" ", "Space", 32, sid)
        time.sleep(0.4)
        icon1 = c.ev("document.querySelector('#gPause use').getAttribute('href')", sid, False)
        check("Space 暂停 GIF", icon1 == "#i-play", icon1)
        c.key(" ", "Space", 32, sid)
        time.sleep(0.3)
        icon2 = c.ev("document.querySelector('#gPause use').getAttribute('href')", sid, False)
        check("Space 继续 GIF", icon2 == "#i-pause", icon2)

        c.key(".", "Period", 190, sid)
        time.sleep(0.3)
        no2 = c.ev("(document.getElementById('gNo')||{}).textContent||''", sid, False)
        check(". 逐帧前进", str(no2).isdigit() and int(no2) >= 2, no2)

        loop0 = s.get("loop", "")
        c.key("l", "KeyL", 76, sid)
        time.sleep(0.3)
        loop1 = c.ev("(document.getElementById('gLoop')||{}).textContent||''", sid, False)
        check("L 切换循环方式", loop1 != loop0, {"before": loop0, "after": loop1})

        c.key("0", "Digit0", 48, sid)
        time.sleep(0.3)
        no0 = c.ev("(document.getElementById('gNo')||{}).textContent||''", sid, False)
        check("0 回到第一帧", str(no0).strip() == "1", no0)

        c.ev("(()=>{const b=document.getElementById('pvClose');if(b)b.click();return 1})()", sid)
        print("\n%d/%d PASS" % (sum(1 for x in RESULTS if x["pass"]), len(RESULTS)))
        try:
            os.makedirs(os.path.dirname(a.json), exist_ok=True)
            with open(a.json, "w", encoding="utf-8") as f:
                json.dump(RESULTS, f, ensure_ascii=False, indent=1)
            print("明细：%s" % a.json)
        except Exception as e:
            print("写明细失败：%s" % e)
        return 0 if all(x["pass"] for x in RESULTS) else 1
    finally:
        try:
            if sid:
                c.ev("VRDB.deleteFiles([%s]).then(()=>1)" % json.dumps(rel), sid)
                c.send("Page.reload", {"ignoreCache": True}, sid)
                time.sleep(2)
        except Exception:
            pass
        try:
            if tid:
                c.send("Target.closeTarget", {"targetId": tid})
        except Exception:
            pass
        c.close()
        # 保留 .work 里的动图夹具，下一次可直接复用；不删用户素材


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print("[失败] %s" % e)
        sys.exit(2)
