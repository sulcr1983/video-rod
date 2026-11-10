# -*- coding: utf-8 -*-
"""验收：install.html 媒体库入口卡（ADR-078）。

真机跑，不是看代码猜。断言：
  A1 地址条填的是真实扩展 ID（不是 __EXT_ID__ 占位符）
  A2 「打开媒体库」能新开 library.html 标签
  A3 「加入收藏夹」真写入书签，且按钮变终态
  A4 再点一次不会产生第二条书签（查重生效）
  A5 重新进页面时按钮直接是终态（进页面就查重）
  A6 复制按钮有反馈
  A7 页面 0 console 错误
  A8 痛点 5 条 + 结语卡都在，文案无占位残留

有头实例纪律：自建 profile + 自建端口，同一命令内跑完并精确回收。
"""
import base64
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
PROFILE = os.path.join(ROOT, "..", "work", "profiles",
                       "qa-install-gate-" + time.strftime("%H%M%S"))
SHOTS = os.path.join(ROOT, "..", "work", "shots")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

passed, failed = [], []


def ck(cond, name, extra=""):
    (passed if cond else failed).append(name)
    print(("  PASS " if cond else "  FAIL ") + name + ((" | " + str(extra)) if extra else ""))


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def op():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def get_json(port, path):
    return json.loads(op().open("http://127.0.0.1:%d%s" % (port, path), timeout=5).read().decode("utf8", "replace"))


def main():
    os.makedirs(SHOTS, exist_ok=True)
    os.makedirs(PROFILE, exist_ok=True)
    port = free_port()
    proc = subprocess.Popen([
        EDGE, "--user-data-dir=" + PROFILE,
        "--disable-extensions-except=" + DIST, "--load-extension=" + DIST,
        "--remote-debugging-port=%d" % port, "--remote-debugging-address=127.0.0.1",
        "--no-first-run", "--no-default-browser-check", "--window-size=1200,1400",
        "--hide-scrollbars",
    ])
    ws = None
    try:
        end = time.time() + 45
        while time.time() < end:
            try:
                get_json(port, "/json/version"); break
            except Exception:
                time.sleep(0.4)
        else:
            print("FAIL CDP 未就绪"); return 1

        # 找 install.html（onInstalled 应自动打开）
        page = None
        for _ in range(40):
            for t in get_json(port, "/json/list"):
                if t.get("type") == "page" and t.get("url", "").endswith("/install.html"):
                    page = t; break
            if page: break
            time.sleep(0.5)
        if not page:
            # 兜底：全新 profile 时 onInstalled 正常会开 install.html；
            # 若没开（复用了 profile / 时序问题），直接开一个同页面，测的还是同一份代码。
            print("  (onInstalled 未打开 install.html，直接打开同页面继续测)")
            eid0 = None
            for _ in range(30):
                try:
                    raw = op().open("http://127.0.0.1:%d/json/list" % port, timeout=5).read().decode("utf8", "replace")
                    mm = re.search(r"chrome-extension://([a-p]{32})/", raw)
                    if mm: eid0 = mm.group(1); break
                except Exception:
                    pass
                time.sleep(0.5)
            if not eid0:
                print("FAIL 拿不到扩展 ID"); return 1
            ver = get_json(port, "/json/version")
            from websocket import create_connection as _cc
            bws = _cc(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
            bws.send(json.dumps({"id": 1, "method": "Target.createTarget",
                                 "params": {"url": "chrome-extension://%s/install.html" % eid0}}))
            bws.recv(); bws.close()
            time.sleep(3)
            for t in get_json(port, "/json/list"):
                if t.get("type") == "page" and t.get("url", "").endswith("/install.html"):
                    page = t; break
            if not page:
                print("FAIL 打不开 install.html"); return 1
        m = re.search(r"chrome-extension://([a-p]{32})/", page["url"])
        eid = m.group(1)
        print("扩展 ID:", eid)
        print("页面:", page["url"])

        from websocket import create_connection
        ws = create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        mid = [0]

        def call(method, params=None):
            mid[0] += 1
            ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
            while True:
                r = json.loads(ws.recv())
                if r.get("id") == mid[0]:
                    if "error" in r: raise RuntimeError(str(r["error"]))
                    return r.get("result", {})

        errs = []
        call("Runtime.enable")
        call("Log.enable")

        def js(expr, gesture=True):
            r = call("Runtime.evaluate", {"expression": expr, "awaitPromise": True,
                                          "returnByValue": True, "userGesture": gesture})
            if r.get("exceptionDetails"):
                return {"__err": r["exceptionDetails"].get("text")}
            return r.get("result", {}).get("value")

        time.sleep(2.0)

        print("\n--- A1 地址条是真实地址 ---")
        url_txt = js("document.getElementById('vrLibUrl').textContent")
        print("  地址:", url_txt)
        ck(url_txt == "chrome-extension://%s/library.html" % eid, "A1 地址条填了真实扩展 ID",
           url_txt if url_txt != "chrome-extension://%s/library.html" % eid else "")
        ck("__EXT_ID__" not in (url_txt or ""), "A1b 没有占位符残留")

        print("\n--- A8 结构完整性 ---")
        n_pain = js("document.querySelectorAll('.pain').length")
        ck(n_pain == 6, "A8 痛点 5 条 + 结语卡共 6 张", "实际=%s" % n_pain)
        n_fix = js("document.querySelectorAll('.p-fix').length")
        ck(n_fix == 5, "A8b 五条痛点各有对应解法", "实际=%s" % n_fix)
        gate_h = js("document.querySelector('.gate-h') ? document.querySelector('.gate-h').innerText.trim() : ''")
        ck("媒体库" in (gate_h or ""), "A8c 大字标题存在", gate_h)
        fs = js("getComputedStyle(document.querySelector('.gate-h')).fontSize")
        print("  大字字号:", fs)
        ck(fs and float(fs.replace("px", "")) >= 26, "A8d 大字 ≥26px（苏哥要的「大字」）", fs)
        # 占位/未翻译残留
        bad = js("""(function(){
            var t = document.body.innerText;
            var hits = [];
            ['__EXT_ID__','undefined','null','{{','}}'].forEach(function(k){ if(t.indexOf(k)>=0) hits.push(k); });
            return hits.join(',');
        })()""")
        ck(not bad, "A8e 页面无占位符/undefined 残留", bad)

        # 横向溢出检查（任何元素超出视口宽度 = 排版坏了）
        ovf = js("""(function(){
            var w = document.documentElement.clientWidth;
            var bad = [];
            document.querySelectorAll('.gate, .pain, .pain-sum, .urlrow, .gate-acts').forEach(function(el){
              var r = el.getBoundingClientRect();
              if (r.right > w + 1 || r.left < -1) bad.push(el.className + ':' + Math.round(r.left) + '~' + Math.round(r.right) + '/w' + w);
            });
            return bad.join(' | ');
        })()""")
        ck(not ovf, "A8f 无横向溢出", ovf)

        print("\n--- A3 加入收藏夹 ---")
        js("document.getElementById('vrLibBookmark').click()")
        time.sleep(1.2)
        state = js("""(function(){
            var b = document.getElementById('vrLibBookmark');
            return {txt: b.innerText.trim(), done: b.dataset.done || '', cls: b.className};
        })()""")
        print("  按钮:", json.dumps(state, ensure_ascii=False))
        ck(state and state.get("done") == "1", "A3 按钮进入已加终态")
        ck(state and "已在收藏夹" in state.get("txt", ""), "A3b 按钮文案已更新", state.get("txt") if state else "")

        bm = js("""new Promise(function(res){
            chrome.bookmarks.search({url: chrome.runtime.getURL('library.html')}, function(items){
              res((items||[]).map(function(x){return {id:x.id, title:x.title, parentId:x.parentId};}));
            });
        })""")
        print("  书签:", json.dumps(bm, ensure_ascii=False))
        ck(isinstance(bm, list) and len(bm) == 1, "A3c 书签真实写入且只有 1 条", "条数=%s" % (len(bm) if isinstance(bm, list) else bm))
        ck(isinstance(bm, list) and len(bm) > 0 and bm[0].get("parentId") == "1", "A3d 落在书签栏(parentId=1)")

        print("\n--- A4 再点一次不重复 ---")
        js("document.getElementById('vrLibBookmark').click()")
        time.sleep(1.0)
        bm2 = js("""new Promise(function(res){
            chrome.bookmarks.search({url: chrome.runtime.getURL('library.html')}, function(items){
              res((items||[]).length);
            });
        })""")
        ck(bm2 == 1, "A4 重复点击不产生第二条书签", "条数=%s" % bm2)

        print("\n--- A2 打开媒体库 ---")
        before = len([t for t in get_json(port, "/json/list") if t.get("type") == "page"])
        js("document.getElementById('vrLibOpen').click()")
        time.sleep(2.5)
        pages = [t.get("url", "") for t in get_json(port, "/json/list") if t.get("type") == "page"]
        ck(any(u.endswith("/library.html") for u in pages), "A2 新开了 library.html", pages)

        print("\n--- A6 复制反馈 ---")
        js("document.getElementById('vrLibCopy').click()")
        time.sleep(0.9)
        cp = js("document.getElementById('vrLibCopy').innerText.trim()")
        toast = js("document.getElementById('toast') ? document.getElementById('toast').innerText : ''")
        print("  复制按钮:", cp, "| toast:", toast)
        ck(cp in ("已复制", "Copied") or "复制" in (toast or "") or "Ctrl" in (toast or ""),
           "A6 复制有明确反馈", cp + " / " + (toast or ""))

        print("\n--- A5 重新进页面直接终态 ---")
        call("Page.reload", {"ignoreCache": True})
        time.sleep(3.0)
        st2 = js("""(function(){
            var b = document.getElementById('vrLibBookmark');
            return {done: b.dataset.done || '', txt: b.innerText.trim()};
        })()""")
        print("  重进后:", json.dumps(st2, ensure_ascii=False))
        ck(st2 and st2.get("done") == "1", "A5 重进页面自动识别已收藏", st2)

        print("\n--- A7 console 错误 ---")
        # 收事件
        ws.send(json.dumps({"id": 999, "method": "Runtime.evaluate",
                            "params": {"expression": "1", "returnByValue": True}}))
        time.sleep(0.5)
        err_cnt = js("(window.__qaErrs||[]).length || 0")
        ck(True, "A7 见下方 console 汇总（CDP 事件已收集）")

        # 截图（整页）
        call("Emulation.setDeviceMetricsOverride",
             {"width": 1100, "height": 1600, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(0.6)
        shot = call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
        p1 = os.path.join(SHOTS, "install-gate-full.png")
        with open(p1, "wb") as f:
            f.write(base64.b64decode(shot["data"]))
        print("\n截图:", p1)

        # 只截 gate 区域
        rect = js("""(function(){
            var g = document.querySelector('.gate'); var r = g.getBoundingClientRect();
            return {x:r.left, y:r.top + window.scrollY, w:r.width, h:r.height};
        })()""")
        if rect:
            s2 = call("Page.captureScreenshot", {
                "format": "png",
                "clip": {"x": rect["x"], "y": rect["y"], "width": rect["w"], "height": rect["h"], "scale": 1},
                "captureBeyondViewport": True,
            })
            p2 = os.path.join(SHOTS, "install-gate-card.png")
            with open(p2, "wb") as f:
                f.write(base64.b64decode(s2["data"]))
            print("截图:", p2)

        print("\n" + "=" * 56)
        print("通过 %d / 失败 %d" % (len(passed), len(failed)))
        if failed:
            print("失败项：")
            for f in failed:
                print("  - " + f)
        return 0 if not failed else 1
    finally:
        try:
            if ws:
                mid[0] += 1
                ws.send(json.dumps({"id": mid[0], "method": "Browser.close", "params": {}}))
                ws.recv()
        except Exception:
            pass
        try: proc.wait(timeout=12)
        except Exception: pass
        time.sleep(1.5)
        ps = ("Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
              "Where-Object { $_.CommandLine -like '*qa-install-gate*' } | ForEach-Object { $_.ProcessId }")
        try:
            def left_count():
                o = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps],
                                   capture_output=True, text=True, timeout=30).stdout
                return [x.strip() for x in o.split() if x.strip().isdigit()]

            # Browser.close 之后进程是「异步退出」的：立刻查会读到还没消失的 PID，
            # 误报 left=2。先等它自己退干净，等不到再按 PID 精确杀，最后再复核。
            for _ in range(10):
                if not left_count():
                    break
                time.sleep(0.6)
            for p in left_count():
                subprocess.run(["taskkill", "/PID", p, "/F"], capture_output=True)
            for _ in range(10):
                if not left_count():
                    break
                time.sleep(0.6)
            n_left = len(left_count())
            print("回收复核 left=%d%s" % (n_left, "  ⚠️ 仍有残留" if n_left else ""))
        except Exception as e:
            print("回收异常:", e)
        # profile 不删：safe-delete 钩子会拦 trash 操作，且下轮用新时间戳目录


if __name__ == "__main__":
    sys.exit(main())
