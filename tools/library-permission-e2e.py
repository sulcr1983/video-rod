#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M5 只读/授权 UX 回归：检查提示条、写操作按钮禁用、file:// 提示。

只读页面状态，不改 DB、不改文件。
用法：python tools/library-permission-e2e.py --port 9480
"""
import argparse
import json
import os
import sys
import time
import urllib.request

from websocket import create_connection

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

    def ev(self, js, sid):
        r = self.send("Runtime.evaluate", {
            "expression": js, "returnByValue": True, "awaitPromise": True
        }, sid)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__err": ((d.get("exception") or {}).get("description") or d.get("text") or "JS error")[:500]}
        return r.get("result", {}).get("value")

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
    ap.add_argument("--json", default="deliverables/test-runs/library-permission-e2e.json")
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

        boot = c.ev("window.__vrBoot || []", sid)
        check("启动链包含 perm 状态检查", isinstance(boot, list) and "perm" in boot, boot)
        perm = c.ev("window.__vrPerm || null", sid)
        check("__vrPerm 已暴露", isinstance(perm, dict), perm)
        if not isinstance(perm, dict):
            return 1

        state = c.ev("""(()=>{
          const b=document.getElementById('permBanner');
          const t=document.getElementById('permText');
          const a=document.getElementById('permAuth');
          const ids=['batchMove','batchTrash','pvDelete','pvMove'];
          return JSON.stringify({
            hidden:b?b.classList.contains('hidden'):null,
            text:t?t.textContent:'',
            auth:a?a.textContent:'',
            disabled:Object.fromEntries(ids.map(id=>{const e=document.getElementById(id);return [id,e?!!e.disabled:null]})),
            hasBanner:!!b, hasAuth:!!a
          })})()""", sid)
        try:
            s = json.loads(state) if isinstance(state, str) else {}
        except Exception:
            s = {}
        check("提示条存在", s.get("hasBanner") is True, s)
        check("授权按钮存在", s.get("hasAuth") is True, s)

        writable = bool(perm.get("writable"))
        text = str(s.get("text") or "")
        hidden = s.get("hidden")
        disabled = s.get("disabled") or {}
        if writable:
            check("可写时不显示只读提示", hidden is True, s)
            check("可写时移动/删除按钮启用", all(v is False for v in disabled.values()), disabled)
        else:
            check("只读时显示提示条", hidden is False, s)
            check("只读提示说明原因", ("只读" in text) or ("授权" in text), text)
            # 只读时写操作按钮保持可点击：点击会先恢复权限或弹目录选择，
            # 置灰会让用户觉得「按钮坏了」（2026-11-06 反馈）。
            check("只读时移动/删除按钮仍可点击", all(v is False for v in disabled.values()), disabled)

        if perm.get("fileAccess") is False:
            check("file:// 不可用时给出提示", "未允许访问本地文件" in text, text)
        else:
            check("file:// 可用时不误报", "未允许访问本地文件" not in text, text)

        failed = [x for x in RESULTS if not x["pass"]]
        print("\n%d/%d PASS" % (len(RESULTS) - len(failed), len(RESULTS)))
        try:
            os.makedirs(os.path.dirname(a.json), exist_ok=True)
            with open(a.json, "w", encoding="utf-8") as f:
                json.dump(RESULTS, f, ensure_ascii=False, indent=1)
            print("明细：%s" % a.json)
        except Exception as e:
            print("写明细失败：%s" % e)
        return 0 if not failed else 1
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
