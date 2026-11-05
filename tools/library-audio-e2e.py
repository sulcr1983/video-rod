#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""音频资源回归：音频分类计数、卡片、预览播放、信息栏时长。

用临时 WAV + 临时 DB 条目，结束后清理；不碰用户素材。
"""
import argparse
import json
import math
import os
import struct
import sys
import time
import urllib.request
import wave

from websocket import create_connection

EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"
WAV = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".work", "audio-e2e.wav")
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
        base = {"key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk}
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


def make_wav():
    os.makedirs(os.path.dirname(WAV), exist_ok=True)
    rate = 8000
    with wave.open(WAV, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        frames = bytearray()
        for i in range(rate):
            frames += struct.pack("<h", int(12000 * math.sin(2 * math.pi * 440 * i / rate)))
        w.writeframes(bytes(frames))
    return os.path.getsize(WAV)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--json", default="deliverables/test-runs/library-audio-e2e.json")
    a = ap.parse_args()
    size = make_wav()
    rel = "video-rod/_audit/audio-e2e/audio.wav"
    c = Cdp(a.port)
    tid = sid = None
    try:
        tid = c.send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % EXT})["targetId"]
        sid = c.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        c.send("Runtime.enable", {}, sid); c.send("Page.enable", {}, sid)
        time.sleep(5)
        put = c.ev("""VRDB.putFiles([{relPath:%s,absPath:%s,platform:'web',type:'audio',
          fileName:'audio.wav',displayName:'音频回归素材',ext:'wav',size:%d,mtime:Date.now(),
          state:'ok',starred:0,tags:[]}]).then(()=>1)""" %
                  (json.dumps(rel), json.dumps(WAV.replace("\\", "/")), size), sid)
        n = c.ev("VRDB.getAllFiles().then(r=>r.length)", sid)
        check("音频夹具入库", put == 1 and n >= 1, {"put": put, "rows": n})
        c.send("Page.reload", {"ignoreCache": True}, sid)
        time.sleep(4)
        audio_tab = c.ev("(document.querySelector('#typeTabs button[data-type=\"audio\"] b')||{}).textContent||''", sid, False)
        check("音频分类计数 > 0", str(audio_tab).strip().isdigit() and int(str(audio_tab).strip()) >= 1, audio_tab)
        c.ev("document.querySelector('#typeTabs button[data-type=\"audio\"]').click(); 1", sid)
        time.sleep(0.6)
        cards = c.ev("document.querySelectorAll('#grid .card').length", sid, False)
        check("音频筛选只剩音频卡", cards == 1, cards)
        opened = c.ev("""(()=>{const c=document.querySelector('#grid .card[data-id="'+CSS.escape(%s)+'"]');
          if(!c)return 'no-card';c.click();return 1})()""" % json.dumps(rel), sid, False)
        time.sleep(5)
        check("音频卡能打开预览", opened == 1, opened)
        st = c.ev("""(()=>{const a=document.querySelector('#pvMedia audio');
          return JSON.stringify({has:!!a,ready:a?a.readyState:null,dur:a?a.duration:null,
            paused:a?a.paused:null,cls:document.getElementById('pvStageEl').className,
            type:(document.getElementById('pvType')||{}).textContent,
            k:(document.getElementById('pvThirdK')||{}).textContent,
            v:(document.getElementById('pvThirdV')||{}).textContent,
            title:(document.getElementById('pvTitle')||{}).textContent})})()""", sid, False)
        try: s = json.loads(st) if isinstance(st, str) else {}
        except Exception: s = {}
        check("音频元素已挂载", s.get("has") is True, st)
        print("DBG", c.ev("""(()=>{const a=document.querySelector('#pvMedia audio');return JSON.stringify({src:a&&a.src,current:a&&a.currentSrc,err:a&&a.error?a.error.code:null,net:a&&a.networkState,ready:a&&a.readyState,can:a&&a.canPlayType('audio/wav')})})()""", sid, False))
        check("音频元数据可读", isinstance(s.get("dur"), (int, float)) and s.get("dur") > 0, s)
        check("音频预览标记为 audio", "is-audio" in str(s.get("cls", "")), s.get("cls"))
        check("信息栏显示时长", "时长" in str(s.get("k", "")), s)
        check("信息栏时长有值", str(s.get("v", "")) not in ("", "—", "None"), s.get("v"))
        check("预览类型为音频", str(s.get("type", "")).upper() == "音频", s.get("type"))

        # 音频复用媒体键盘：空格切换播放/暂停
        paused0 = c.ev("document.querySelector('#pvMedia audio').paused", sid, False)
        c.key(" ", "Space", 32, sid)
        time.sleep(0.4)
        paused1 = c.ev("document.querySelector('#pvMedia audio').paused", sid, False)
        check("空格切换音频播放", paused0 != paused1, {"before": paused0, "after": paused1})
        c.key("m", "KeyM", 77, sid)
        time.sleep(0.2)
        muted = c.ev("document.querySelector('#pvMedia audio').muted", sid, False)
        check("M 静音音频", muted is True, muted)
        c.ev("(()=>{const b=document.getElementById('pvClose');if(b)b.click();return 1})()", sid)
        print("\n%d/%d PASS" % (sum(1 for x in RESULTS if x["pass"]), len(RESULTS)))
        os.makedirs(os.path.dirname(a.json), exist_ok=True)
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(RESULTS, f, ensure_ascii=False, indent=1)
        print("明细：%s" % a.json)
        return 0 if all(x["pass"] for x in RESULTS) else 1
    finally:
        try:
            if sid:
                c.ev("VRDB.deleteFiles([%s]).then(()=>1)" % json.dumps(rel), sid)
        except Exception:
            pass
        try:
            if tid:
                c.send("Target.closeTarget", {"targetId": tid})
        except Exception:
            pass
        c.close()
        try:
            if os.path.exists(WAV):
                os.remove(WAV)
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
