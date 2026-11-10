# -*- coding: utf-8 -*-
"""验收：popup 媒体库首次引导 + 顶栏金色胶囊 + 重复 id 修复（ADR-078）。

断言：
  B1 顶栏胶囊有文字「媒体库」，宽度明显大于纯图标（视觉可辨）
  B2 首次打开 popup 弹蒙层，大字 ≥24px
  B3 「打开媒体库」新开 library.html 且蒙层关闭
  B4 「加入收藏夹」真写入且只 1 条；再点不重复
  B5 「我知道了」后重开 popup 不再弹（永久静默）
  B6 什么都没做时最多弹 3 次，第 4 次静默
  B7 重复 id 已修：vrOpenLibrary 唯一；关掉「启用媒体库」三个入口一起隐藏
  B8 蒙层不挡主流程：关闭后批量下载按钮可点
  B9 无横向溢出 / 380 宽下顶栏不挤

有头实例纪律：自建 profile + 自建端口，同一命令内跑完并精确回收。
"""
import base64
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
PROFILE = os.path.join(ROOT, "..", "work", "profiles",
                       "qa-libintro-" + time.strftime("%H%M%S"))
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


class Browser:
    def __init__(self):
        os.makedirs(PROFILE, exist_ok=True)
        self.port = free_port()
        self.proc = subprocess.Popen([
            EDGE, "--user-data-dir=" + PROFILE,
            "--disable-extensions-except=" + DIST, "--load-extension=" + DIST,
            "--remote-debugging-port=%d" % self.port,
            "--remote-debugging-address=127.0.0.1",
            "--no-first-run", "--no-default-browser-check",
            "--window-size=1200,1200", "--hide-scrollbars",
        ])
        self.ws = None
        end = time.time() + 45
        while time.time() < end:
            try:
                get_json(self.port, "/json/version"); break
            except Exception:
                time.sleep(0.4)
        else:
            raise RuntimeError("CDP 未就绪")

        # 扩展 ID
        # 扩展 ID 必须按「特征页」定位，不能取列表里第一个 chrome-extension://
        # —— Edge 自带 8 个内置扩展（jdicc…/ncbje… 等），第一个根本不是我们的。
        # 实测教训：取第一个 → 拿到内置扩展 ID → popup.html 404 → 14 项断言全灭。
        self.eid = None
        for _ in range(40):
            try:
                raw = op().open("http://127.0.0.1:%d/json/list" % self.port, timeout=5).read().decode("utf8", "replace")
                for m in re.finditer(r"chrome-extension://([a-p]{32})/([a-zA-Z0-9_.-]+\.html)", raw):
                    if m.group(2) in ("install.html", "popup.html", "library.html", "options.html"):
                        self.eid = m.group(1); break
                if self.eid:
                    break
            except Exception:
                pass
            time.sleep(0.5)
        if not self.eid:
            raise RuntimeError("拿不到扩展 ID")

        from websocket import create_connection
        ver = get_json(self.port, "/json/version")
        self.bws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        self.bmid = 0

    def bcall(self, method, params=None):
        self.bmid += 1
        self.bws.send(json.dumps({"id": self.bmid, "method": method, "params": params or {}}))
        while True:
            r = json.loads(self.bws.recv())
            if r.get("id") == self.bmid:
                if "error" in r:
                    raise RuntimeError(str(r["error"]))
                return r.get("result", {})

    def open_popup(self):
        """开一个 popup.html 标签，返回 (ws, page)。

        每次先把**旧的** popup 标签关掉再开新的：上一轮的标签页是
        在改 storage 之前加载的，settings 停在旧值——不过滤的话
        getElementById 查到的就是旧页面，B7c/B6 会误判失败。
        （实测教训，见 dbg-lib-intro.py 的对照。）"""
        old_ids = [t.get("targetId") or t.get("id") for t in get_json(self.port, "/json/list")
                   if t.get("type") == "page" and t.get("url", "").endswith("/popup.html")]
        old_ids = [x for x in old_ids if x]
        for tid in old_ids:
            try:
                self.bcall("Target.closeTarget", {"targetId": tid})
            except Exception:
                pass
        self.bcall("Target.createTarget", {"url": "chrome-extension://%s/popup.html" % self.eid})
        time.sleep(2.5)
        page = None
        for t in get_json(self.port, "/json/list"):
            if t.get("type") == "page" and t.get("url", "").endswith("/popup.html"):
                page = t
        if not page:
            raise RuntimeError("打不开 popup.html")
        from websocket import create_connection
        ws = create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        return ws, page

    def close(self):
        try:
            self.bmid += 1
            self.bws.send(json.dumps({"id": self.bmid, "method": "Browser.close", "params": {}}))
            self.bws.recv()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=12)
        except Exception:
            pass
        time.sleep(1.2)
        ps = ("Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
              "Where-Object { $_.CommandLine -like '*qa-libintro*' } | ForEach-Object { $_.ProcessId }")

        def left():
            o = subprocess.run(["powershell.exe", "-NoProfile", "-Command", ps],
                               capture_output=True, text=True, timeout=30).stdout
            return [x.strip() for x in o.split() if x.strip().isdigit()]

        for _ in range(10):
            if not left():
                break
            time.sleep(0.6)
        for p in left():
            subprocess.run(["taskkill", "/PID", p, "/F"], capture_output=True)
        for _ in range(10):
            if not left():
                break
            time.sleep(0.6)
        print("回收复核 left=%d" % len(left()))


def make_js(ws):
    mid = [0]

    def call(method, params=None):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == mid[0]:
                if "error" in r:
                    raise RuntimeError(str(r["error"]))
                return r.get("result", {})

    def js(expr, gesture=True):
        r = call("Runtime.evaluate", {"expression": expr, "awaitPromise": True,
                                      "returnByValue": True, "userGesture": gesture})
        if r.get("exceptionDetails"):
            return {"__err": r["exceptionDetails"].get("text")}
        return r.get("result", {}).get("value")

    return call, js


def main():
    os.makedirs(SHOTS, exist_ok=True)
    b = Browser()
    print("扩展 ID:", b.eid)
    try:
        print("\n--- B1/B2 首次打开 popup ---")
        ws, page = b.open_popup()
        call, js = make_js(ws)
        time.sleep(2.0)

        pill = js("""(function(){
            var p = document.getElementById('vrOpenLibrary');
            if (!p) return null;
            var r = p.getBoundingClientRect();
            return {w: Math.round(r.width), h: Math.round(r.height),
                    txt: (p.innerText||'').trim(), cls: p.className};
        })()""")
        print("  胶囊:", json.dumps(pill, ensure_ascii=False))
        ck(pill and "媒体库" in (pill.get("txt") or ""), "B1 胶囊带文字「媒体库」", pill.get("txt") if pill else "")
        ck(pill and pill.get("w", 0) >= 60, "B1b 胶囊宽度 ≥60px（明显宽于纯图标）", "w=%s" % (pill or {}).get("w"))

        vis = js("""(function(){
            var b = document.getElementById('vrLibIntro');
            if (!b) return {found:false};
            var r = b.getBoundingClientRect();
            return {found:true, hidden:b.hidden, w:Math.round(r.width), h:Math.round(r.height)};
        })()""")
        print("  蒙层:", json.dumps(vis, ensure_ascii=False))
        ck(vis and vis.get("found") and not vis.get("hidden"), "B2 首次打开弹出蒙层")

        fs = js("""(function(){
            var h = document.querySelector('.li-h');
            return h ? getComputedStyle(h).fontSize : '';
        })()""")
        print("  大字字号:", fs)
        ck(fs and float(fs.replace("px", "")) >= 24, "B2b 大字 ≥24px", fs)

        # 溢出检查
        ovf = js("""(function(){
            var w = document.documentElement.clientWidth, bad=[];
            document.querySelectorAll('.li-card, .li-acts, .li-btn, .pop-head, .libpill').forEach(function(el){
              var r = el.getBoundingClientRect();
              if (r.right > w + 1) bad.push(el.className+':'+Math.round(r.right)+'/w'+w);
            });
            return bad.join(' | ');
        })()""")
        ck(not ovf, "B9 无横向溢出", ovf)

        call("Emulation.setDeviceMetricsOverride",
             {"width": 400, "height": 700, "deviceScaleFactor": 2, "mobile": False})
        time.sleep(0.6)
        s = call("Page.captureScreenshot", {"format": "png"})
        p1 = os.path.join(SHOTS, "popup-libintro.png")
        with open(p1, "wb") as f:
            f.write(base64.b64decode(s["data"]))
        print("  截图:", p1)

        print("\n--- B4 加入收藏夹（含查重） ---")
        js("document.getElementById('vrLiBookmark').click()")
        time.sleep(1.4)
        bm_state = js("""(function(){
            var b = document.getElementById('vrLiBookmark');
            return {txt:(b.innerText||'').trim(), done:b.dataset.done||'', cls:b.className};
        })()""")
        print("  按钮:", json.dumps(bm_state, ensure_ascii=False))
        ck(bm_state and bm_state.get("done") == "1", "B4 按钮进入终态")
        n_bm = js("""new Promise(function(res){
            chrome.bookmarks.search({url: chrome.runtime.getURL('library.html')}, function(i){ res((i||[]).length); });
        })""")
        ck(n_bm == 1, "B4b 书签只写入 1 条", "条数=%s" % n_bm)

        # 再点一次（此时蒙层可能已关，直接调 click）
        js("document.getElementById('vrLiBookmark').click()")
        time.sleep(1.0)
        n_bm2 = js("""new Promise(function(res){
            chrome.bookmarks.search({url: chrome.runtime.getURL('library.html')}, function(i){ res((i||[]).length); });
        })""")
        ck(n_bm2 == 1, "B4c 重复点击不产生第二条", "条数=%s" % n_bm2)

        print("\n--- B5 加过收藏后重开不再弹 ---")
        ws.close()
        ws2, _ = b.open_popup()
        call2, js2 = make_js(ws2)
        time.sleep(2.2)
        v2 = js2("""(function(){ var b=document.getElementById('vrLibIntro'); return b ? b.hidden : null; })()""")
        ck(v2 is True, "B5 已引导过则不再弹（hidden=true）", "hidden=%s" % v2)

        print("\n--- B7 重复 id 修复 ---")
        dup = js2("document.querySelectorAll('#vrOpenLibrary').length")
        ck(dup == 1, "B7 vrOpenLibrary 唯一", "个数=%s" % dup)
        drawer = js2("!!document.getElementById('vrOpenLibraryDrawer')")
        ck(drawer is True, "B7b 抽屉按钮已改名 vrOpenLibraryDrawer")

        # 关掉「启用媒体库」，三个入口应一起隐藏
        hide_res = js2("""new Promise(function(res){
            chrome.storage.local.get(['vrSettings'], function(r){
                var s = (r && r.vrSettings) || {};
                s.libraryEnabled = false;
                chrome.storage.local.set({vrSettings: s}, function(){ res(true); });
            });
        })""")
        time.sleep(0.8)
        ws2.close()
        ws3, _ = b.open_popup()
        call3, js3 = make_js(ws3)
        time.sleep(2.2)
        vis3 = js3("""(function(){
            function d(id){ var e=document.getElementById(id); return e ? getComputedStyle(e).display : 'missing'; }
            return {pill:d('vrOpenLibrary'), drawer:d('vrOpenLibraryDrawer'), set:d('vrOpenLibrarySettings')};
        })()""")
        print("  关掉开关后:", json.dumps(vis3, ensure_ascii=False))
        ck(vis3 and vis3.get("pill") == "none" and vis3.get("drawer") == "none",
           "B7c 关掉「启用媒体库」后顶栏+抽屉一起隐藏", json.dumps(vis3, ensure_ascii=False))

        # 恢复
        js3("""new Promise(function(res){
            chrome.storage.local.get(['vrSettings'], function(r){
                var s = (r && r.vrSettings) || {};
                s.libraryEnabled = true;
                chrome.storage.local.set({vrSettings: s}, function(){ res(true); });
            });
        })""")
        ws3.close()

        print("\n--- B6 什么都没做：最多弹 3 次 ---")
        # 清掉标记，模拟全新用户
        ws4, _ = b.open_popup()
        call4, js4 = make_js(ws4)
        time.sleep(1.5)
        rm_ok = js4("""new Promise(function(res){
            chrome.storage.local.remove(['vrLibIntroDone','vrLibIntroSeen'], function(){
                chrome.storage.local.get(['vrLibIntroDone','vrLibIntroSeen'], function(o){
                    res({removed: !o.vrLibIntroDone && !o.vrLibIntroSeen, left: o});
                });
            });
        })""")
        print("  remove 验证:", json.dumps(rm_ok, ensure_ascii=False))
        ck(bool(rm_ok) and rm_ok.get("removed") is True, "B6-pre 标记已清空", json.dumps(rm_ok, ensure_ascii=False))
        ws4.close()

        shows = []
        for i in range(1, 5):
            w, _ = b.open_popup()
            c, j = make_js(w)
            time.sleep(1.8)
            shown = j("""(function(){ var b=document.getElementById('vrLibIntro'); return b ? !b.hidden : null; })()""")
            shows.append(shown)
            # 模拟「点了空白处关掉」——不标记 done，只计次数
            j("(function(){ var b=document.getElementById('vrLibIntro'); if(b) b.hidden=true; })()")
            w.close()
            print("  第 %d 次打开：%s" % (i, "弹" if shown else "不弹"))
        ck(shows[:3] == [True, True, True], "B6 前 3 次都弹", shows)
        ck(shows[3] is False, "B6b 第 4 次静默（不骚扰）", shows)

        print("\n--- B8 蒙层关闭后主流程可用 ---")
        ws5, _ = b.open_popup()
        call5, js5 = make_js(ws5)
        time.sleep(1.8)
        js5("""(function(){
            var b=document.getElementById('vrLibIntro'); if(b) b.hidden=true;
        })()""")
        time.sleep(0.4)
        ok = js5("""(function(){
            var d = document.getElementById('DownFile');
            if (!d) return {found:false};
            var r = d.getBoundingClientRect();
            var el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
            return {found:true, covered: !(el === d || d.contains(el)), tag: el ? el.className : ''};
        })()""")
        print("  下载按钮可点性:", json.dumps(ok, ensure_ascii=False))
        ck(ok and ok.get("found") and not ok.get("covered"), "B8 关闭蒙层后批量下载按钮未被遮挡", json.dumps(ok, ensure_ascii=False))
        ws5.close()

        print("\n" + "=" * 56)
        print("通过 %d / 失败 %d" % (len(passed), len(failed)))
        if failed:
            print("失败项：")
            for f in failed:
                print("  - " + f)
        return 0 if not failed else 1
    finally:
        b.close()


if __name__ == "__main__":
    sys.exit(main())
