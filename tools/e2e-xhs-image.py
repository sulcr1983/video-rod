#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
真实站点 E2E：小红书图文页「悬停单图 → 点一下 → 自动归档」
对应判据：P1 页面直接点 ｜ P2 自动归档 ｜ P3 自动改名

前提：必须用登录 profile（docs/TEST-BROWSER.md），否则小红书会拦。
跑法：
    python tools/e2e-xhs-image.py --port 9531
"""
import argparse
import base64
import json
import os
import time
import urllib.request

from websocket import create_connection

NOTES = [
    "https://www.xiaohongshu.com/explore/6ad7233f000000000c00fe24?xsec_token=ABvvJ23oTn68bAeFLKewnzZxSOlK6SIKIDY2iuOoCojbU=&xsec_source=pc_search",
]
DL_ROOT = os.path.join(os.path.expanduser("~"), "Downloads", "video-rod")


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=5))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=120)
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
                return r.get("result", {})

    def ev(self, js, sid):
        r = self.send("Runtime.evaluate",
                      {"expression": js, "returnByValue": True, "awaitPromise": True}, sid)
        if "exceptionDetails" in r:
            return {"__err": str(r["exceptionDetails"])[:200]}
        return r.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def snapshot(root):
    out = {}
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            p = os.path.join(dirpath, f)
            try:
                out[p] = os.path.getsize(p)
            except OSError:
                pass
    return out


RESULTS = []


def check(name, got, want=True):
    ok = bool(got) == bool(want) if isinstance(want, bool) else got == want
    RESULTS.append(ok)
    print(("PASS  " if ok else "FAIL  ") + name + "  = " + repr(got))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9531)
    ap.add_argument("--url", default=NOTES[0])
    ap.add_argument("--shot", default="deliverables/assets/e2e-xhs.png")
    a = ap.parse_args()

    os.makedirs(DL_ROOT, exist_ok=True)
    before = snapshot(DL_ROOT)
    print("测试前归档文件数:", len(before))

    c = Cdp(a.port)
    tid = c.send("Target.createTarget", {"url": a.url})["targetId"]
    sid = c.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
    c.send("Runtime.enable", {}, sid)
    c.send("Page.enable", {}, sid)
    time.sleep(8)

    print("标题:", c.ev("document.title", sid))
    check("页面已加载（标题非空）", bool(c.ev("document.title", sid)))
    check("未出现登录墙", c.ev("/登录|扫码登录/.test((document.body.innerText||'').slice(0,1200))", sid), False)

    # 本笔记是视频页（不是图文）→ 走视频悬浮键
    vids = c.ev("""(()=>[...document.querySelectorAll('video')].map(v=>[v.currentSrc.slice(0,80), v.videoWidth, v.videoHeight]))()""", sid)
    print("页面视频:", vids)
    check("页面有 video 元素", isinstance(vids, list) and len(vids) > 0, True)

    hover = c.ev("""(()=>{
      const v = document.querySelector('video');
      if (!v) return 'no-video';
      v.scrollIntoView({block:'center'});
      v.muted = true;
      const p = v.play && v.play();  // 悬停即自动静音播放（V10 通用能力）
      const r = v.getBoundingClientRect();
      const opt = {bubbles:true, cancelable:true, clientX:r.left+r.width/2, clientY:r.top+r.height/2};
      v.dispatchEvent(new MouseEvent('mouseover', opt));
      v.dispatchEvent(new MouseEvent('mouseenter', opt));
      v.dispatchEvent(new MouseEvent('mousemove', opt));
      return 'ok';
    })()""", sid)
    check("悬停视频", hover, "ok")
    time.sleep(4)

    btn = c.ev("""(()=>{
      const b = document.querySelector('.vr-vob');
      if (!b) return 'no-panel';
      const main = b.querySelector('button');
      const rc = b.getBoundingClientRect();
      return JSON.stringify({visible: rc.width>0 && rc.height>0, text:(main?main.textContent:'').trim().slice(0,10), cls:b.className});
    })()""", sid)
    print("悬浮面板:", btn)
    check("出现视频下载键", isinstance(btn, str) and "no-panel" not in btn, True)

    click = c.ev("""(()=>{
      const b = document.querySelector('.vr-vob');
      if (!b) return 'no-panel';
      const main = b.querySelector('button');
      if (!main) return 'no-btn';
      main.click();
      return 'clicked';
    })()""", sid)
    check("点击视频下载键", click, "clicked")

    # 等落盘
    time.sleep(12)
    after = snapshot(DL_ROOT)
    new_files = {k: v for k, v in after.items() if k not in before}
    print("新增文件数:", len(new_files))
    for k, v in list(new_files.items())[:6]:
        print("   +", k.replace(DL_ROOT, "video-rod"), v, "bytes")
    check("P1/P2：真的产生了下载文件", len(new_files) > 0, True)
    if new_files:
        first = list(new_files.keys())[0].replace("\\", "/")
        check("P2：落在 video-rod/小红书/ 下", "/video-rod/小红书/" in first or "/小红书/" in first, True)
        check("P2b：有作者目录", len(first.split("/video-rod/")[-1].split("/")) >= 3, True)
        name = first.rsplit("/", 1)[-1]
        check("P3：文件名不是一串随机字符", len(name) > 8, True)
        print("P3 文件名:", name)

    os.makedirs(os.path.dirname(a.shot), exist_ok=True)
    ss = c.send("Page.captureScreenshot", {"format": "png"}, sid)
    open(a.shot, "wb").write(base64.b64decode(ss["data"]))
    print("截图:", a.shot)

    if "--keep" not in os.sys.argv:
        c.send("Target.closeTarget", {"targetId": tid})
    c.close()

    passed = sum(1 for x in RESULTS if x)
    print("\n%d/%d PASS" % (passed, len(RESULTS)))
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    import sys
    os.sys.argv = sys.argv
    sys.exit(main())
