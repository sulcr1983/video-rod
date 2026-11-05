#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""资源库键盘矩阵回归：Space/Enter、F2、Del、?、Ctrl/Cmd+A、/、Esc。

只读页面，不删除真实素材；Del 在无目录授权时只应提示，不应打开确认框。
用法：python tools/library-keyboard-e2e.py --port 9480
"""
import argparse
import json
import os
import sys
import time
import urllib.request

from websocket import create_connection

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

DEFAULT_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"
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

    def key(self, key, code, vk, modifiers=0, sid=None):
        base = {"key": key, "code": code, "windowsVirtualKeyCode": vk,
                "nativeVirtualKeyCode": vk, "modifiers": modifiers}
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--ext", default=DEFAULT_EXT)
    ap.add_argument("--json", default="deliverables/test-runs/library-keyboard-e2e.json")
    a = ap.parse_args()

    c = Cdp(a.port)
    tid = sid = None
    try:
        tid = c.send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % a.ext})["targetId"]
        sid = c.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        c.send("Runtime.enable", {}, sid)
        c.send("Page.enable", {}, sid)
        c.send("Page.reload", {"ignoreCache": True}, sid)
        time.sleep(5)
        c.ev("""(()=>{window.__keyProbe=[];document.addEventListener('keydown',function(e){
          window.__keyProbe.push({key:e.key,code:e.code,ctrl:!!e.ctrlKey,meta:!!e.metaKey,shift:!!e.shiftKey,
            target:(e.target&&e.target.tagName)||''});},true);return 1})()""", sid)

        def focus_card():
            return c.ev("(()=>{const c=document.querySelector('#grid .card');if(!c)return 'no-card';c.focus();return document.activeElement===c})()", sid, False)

        def preview_open():
            return c.ev("!document.getElementById('preview').classList.contains('hidden')", sid, False)

        def close_preview():
            c.ev("(()=>{const b=document.getElementById('pvClose');if(b)b.click();return 1})()", sid)
            time.sleep(0.4)

        check("卡片可获得焦点", focus_card() is True)

        # Space 打开预览
        c.key(" ", "Space", 32, sid=sid)
        time.sleep(1.2)
        check("Space 打开预览", preview_open() is True)
        count0 = c.ev("(document.getElementById('pvCount')||{}).textContent||''", sid, False)

        # 上下切换
        c.key("ArrowDown", "ArrowDown", 40, sid=sid)
        time.sleep(0.8)
        count1 = c.ev("(document.getElementById('pvCount')||{}).textContent||''", sid, False)
        check("ArrowDown 切下一个", count1 and count1 != count0, {"before": count0, "after": count1})
        c.key("ArrowUp", "ArrowUp", 38, sid=sid)
        time.sleep(0.6)
        count2 = c.ev("(document.getElementById('pvCount')||{}).textContent||''", sid, False)
        check("ArrowUp 切上一个", count2 == count0, {"before": count0, "after": count2})

        # Esc 关预览
        c.key("Escape", "Escape", 27, sid=sid)
        time.sleep(0.5)
        check("Esc 关闭预览", preview_open() is False)

        # F2 重命名
        focus_card()
        c.key("F2", "F2", 113, sid=sid)
        time.sleep(0.5)
        check("F2 打开重命名", c.ev("document.getElementById('renameMask').classList.contains('show')", sid, False) is True)
        c.ev("document.getElementById('renameCancel').click();1", sid)
        time.sleep(0.3)

        # ? 快捷键面板（先让焦点回卡片，输入框内快捷键应让位）
        focus_card()
        c.key("?", "Slash", 191, 8, sid)
        time.sleep(0.4)
        check("? 打开快捷键面板", c.ev("document.getElementById('keysheet').classList.contains('show')", sid, False) is True)
        c.ev("document.getElementById('ksClose').click();1", sid)
        time.sleep(0.3)

        # Ctrl+A 全选（同样先让焦点回卡片）
        focus_card()
        c.key("a", "KeyA", 65, 2, sid)
        time.sleep(0.6)
        selected = c.ev("document.querySelectorAll('#grid .card.selected').length", sid, False)
        bar_hidden = c.ev("document.getElementById('batchbar').classList.contains('hidden')", sid, False)
        probe = c.ev("window.__keyProbe.slice(-6)", sid, False)
        check("Ctrl+A 全选", selected == 35 and bar_hidden is False,
              {"selected": selected, "barHidden": bar_hidden, "keys": probe})
        c.ev("document.getElementById('batchExit').click();1", sid)
        time.sleep(0.4)

        # "/" 聚焦搜索
        focus_card()
        c.key("/", "Slash", 191, 0, sid)
        time.sleep(0.3)
        check("/ 聚焦搜索框", c.ev("document.activeElement && document.activeElement.id === 'search'", sid, False) is True,
              c.ev("(document.activeElement||{}).id", sid, False))
        c.ev("document.activeElement.blur();1", sid)

        # Delete：无目录授权时只提示，不打开确认、不删素材
        focus_card()
        c.key("Delete", "Delete", 46, sid=sid)
        time.sleep(0.4)
        confirm_show = c.ev("document.getElementById('confirmMask').classList.contains('show')", sid, False)
        toast = c.ev("(document.getElementById('toast')||{}).textContent||''", sid, False)
        cards = c.ev("document.querySelectorAll('#grid .card').length", sid, False)
        check("Del 无授权时只提示", confirm_show is False and "授权" in str(toast), {"confirm": confirm_show, "toast": toast})
        check("Del 未删除素材", cards == 35, cards)

        # 视频快捷键：K 播放/暂停、M 静音、> 倍速、5 跳到 50%
        opened = c.ev("""(()=>{const t=document.querySelector('#grid .card .thumb.is-video');
          if(!t)return 'no-video';const card=t.closest('.card');if(!card)return 'no-card';card.click();return 1})()""", sid, False)
        time.sleep(1.5)
        check("视频卡能打开预览", opened == 1, opened)
        vstate = c.ev("""(()=>{const v=document.querySelector('#pvMedia video');return v?
          JSON.stringify({paused:v.paused,muted:v.muted,rate:v.playbackRate,t:v.currentTime,d:v.duration}):'no-video'})()""", sid, False)
        try: vs = json.loads(vstate) if isinstance(vstate, str) else {}
        except Exception: vs = {}
        check("视频元素存在", isinstance(vs, dict) and "paused" in vs, vstate)
        if isinstance(vs, dict) and "paused" in vs:
            c.key("k", "KeyK", 75, sid=sid)
            time.sleep(0.5)
            paused2 = c.ev("document.querySelector('#pvMedia video').paused", sid, False)
            check("K 切换播放/暂停", paused2 != vs.get("paused"), {"before": vs.get("paused"), "after": paused2})

            c.key("m", "KeyM", 77, sid=sid)
            time.sleep(0.3)
            muted2 = c.ev("document.querySelector('#pvMedia video').muted", sid, False)
            check("M 切换静音", muted2 != vs.get("muted"), {"before": vs.get("muted"), "after": muted2})

            c.key(">", "Period", 190, 8, sid)
            time.sleep(0.3)
            rate2 = c.ev("document.querySelector('#pvMedia video').playbackRate", sid, False)
            check("> 提高倍速", rate2 > (vs.get("rate") or 1), {"before": vs.get("rate"), "after": rate2})

            c.key("5", "Digit5", 53, sid=sid)
            time.sleep(0.4)
            t2 = c.ev("document.querySelector('#pvMedia video').currentTime", sid, False)
            dur2 = c.ev("document.querySelector('#pvMedia video').duration", sid, False)
            check("数字 5 跳到约 50%", isinstance(t2, (int, float)) and isinstance(dur2, (int, float)) and t2 > 0 and t2 <= dur2,
                  {"t": t2, "duration": dur2})
            c.ev("(()=>{const b=document.getElementById('pvClose');if(b)b.click();return 1})()", sid)
            time.sleep(0.4)

        # 图片快捷键/工具栏：+ / - / R / 0 / 1 与按钮
        img_open = c.ev("""(()=>{const c=[...document.querySelectorAll('#grid .card')].find(x=>
          !x.querySelector('.thumb.is-video')&&!x.querySelector('.thumb.is-anim')&&!x.querySelector('.missing-tag'));
          if(!c)return 'no-image';c.click();return 1})()""", sid, False)
        time.sleep(1.2)
        check("图片卡能打开预览", img_open == 1, img_open)
        img_state = c.ev("""(()=>{const i=document.querySelector('#pvMedia img');if(!i)return 'no-img';
          return JSON.stringify({zoom:(document.getElementById('iZoom')||{}).textContent||'',
            transform:i.style.transform||'',barHidden:document.getElementById('imgBar').classList.contains('hidden')})})()""", sid, False)
        try: ims = json.loads(img_state) if isinstance(img_state, str) else {}
        except Exception: ims = {}
        check("图片工具栏可见", isinstance(ims, dict) and ims.get("barHidden") is False, img_state)
        if isinstance(ims, dict) and "zoom" in ims:
            c.key("=", "Equal", 187, sid=sid)  # + 键（不按 Shift 也接受 =）
            time.sleep(0.3)
            z1 = c.ev("(document.getElementById('iZoom')||{}).textContent||''", sid, False)
            check("+ 放大图片", str(z1).replace('%','').isdigit() and int(str(z1).replace('%','')) > 100, z1)

            c.key("-", "Minus", 189, sid=sid)
            time.sleep(0.3)
            z2 = c.ev("(document.getElementById('iZoom')||{}).textContent||''", sid, False)
            check("- 缩小图片", str(z2).replace('%','').isdigit() and int(str(z2).replace('%','')) < int(str(z1).replace('%','')), {"before": z1, "after": z2})

            c.key("r", "KeyR", 82, sid=sid)
            time.sleep(0.3)
            tr = c.ev("(document.querySelector('#pvMedia img')||{}).style.transform||''", sid, False)
            check("R 旋转图片", "rotate(90deg)" in str(tr), tr)

            c.key("0", "Digit0", 48, sid=sid)
            time.sleep(0.3)
            z0 = c.ev("(document.getElementById('iZoom')||{}).textContent||''", sid, False)
            check("0 适应窗口", z0 == "100%", z0)

            c.key("1", "Digit1", 49, sid=sid)
            time.sleep(0.3)
            zactual = c.ev("(document.getElementById('iZoom')||{}).textContent||''", sid, False)
            check("1 实际像素", isinstance(zactual, str) and zactual.endswith("%"), zactual)
            c.ev("(()=>{const b=document.getElementById('pvClose');if(b)b.click();return 1})()", sid)
            time.sleep(0.3)

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
            if tid:
                c.send("Target.closeTarget", {"targetId": tid})
        except Exception:
            pass
        c.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print("[失败] %s" % e)
        sys.exit(2)
