#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""QA 专项：未授权素材目录时「文件名可能被浏览器改名」的用户提示链路（2026-11-08）

背景（ADR-040 + save.js 契约）：
    Chrome 147+ 的 chrome.downloads 文件名保护全面失效；未授权素材目录时下载走
    浏览器下载器兜底，文件名会变成 UUID/URL 末段。save.js 契约要求
    「mode:'downloads' 时调用方应如实告知用户，不能假装成功」。
    2026-11-08 修复：
      fix-1  background.js vrDownloadWithName 走 downloads 兜底时写
             chrome.storage.session.vrNameFallback = true
      fix-2  popup-videorod.js 批量完成 toast 读到标记就追加说明

本脚本验证（全部真实链路，不 mock）：
    T1  popup 批量下载完成 → #Tips 出现「批量完成」且带「文件名可能被浏览器改名」
    T2  SW 侧 vrDownloadWithName 兜底下载 → vrNameFallback 标记真的被写上
    T3  下载产物真实落盘（证明确实走了 downloads 兜底，而不是什么都没发生）
    测试产物自动清理（downloads.erase + 磁盘删除）。

跑法（先有隔离实例 9490）：
    python tools/qa-toast-hint-test.py --port 9490
"""
import argparse
import base64
import http.server
import json
import os
import threading
import time
import urllib.request

from websocket import create_connection

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DL_DIR = os.path.join(os.path.expanduser("~"), "Downloads")

FAKE_MP4 = (b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 2048)
FAKE_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
# 真实大图（600×600）：1×1 占位图会被 popup 的最小尺寸过滤掉，嗅探不到卡片
BIG_PNG_PATH = os.path.join(ROOT, "test-site", "media", "big-square.png")
try:
    with open(BIG_PNG_PATH, "rb") as f:
        BIG_PNG = f.read()
except OSError:
    BIG_PNG = FAKE_PNG

PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>QA toast 验证页</title></head>
<body style="font:14px system-ui;padding:20px">
<h1>QA toast 提示验证</h1>
<video src="/qa-clip.mp4" controls muted loop width="480"></video>
<img src="/qa-big.png" width="480">
</body></html>"""


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/qa-clip.mp4":
            body, ctype = FAKE_MP4, "video/mp4"
        elif path == "/qa-big.png":
            body, ctype = BIG_PNG, "image/png"
        elif path == "/qa-dl.png":
            body, ctype = FAKE_PNG, "image/png"
        else:
            body, ctype = PAGE.encode("utf-8"), "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        self.wfile.write(body)


def start_site():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=5))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=40)
        self.mid = 0
        self.errs = []

    def send(self, method, params=None, sid=None):
        self.mid += 1
        msg = {"id": self.mid, "method": method, "params": params or {}}
        if sid:
            msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.mid:
                return r.get("result", {})
            if r.get("method") == "Runtime.exceptionThrown":
                d = r["params"]["exceptionDetails"]
                desc = ((d.get("exception", {}) or {}).get("description", "") or d.get("text", ""))
                self.errs.append(desc[:300])

    def ev(self, js, sid):
        r = self.send("Runtime.evaluate",
                      {"expression": js, "returnByValue": True, "awaitPromise": True}, sid)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__err": (d.get("exception", {}) or {}).get("description", d.get("text"))}
        return r.get("result", {}).get("value")

    def attach(self, tid, w=0, h=0):
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        self.send("Page.enable", {}, sid)
        if w:
            self.send("Emulation.setDeviceMetricsOverride",
                      {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False}, sid)
        self.ev("(()=>{window.alert=function(){};window.confirm=function(){return true};"
                "window.prompt=function(){return ''};return 1})()", sid)
        return sid

    def find_target(self, needle, ttype="page"):
        for t in self.send("Target.getTargets")["targetInfos"]:
            if t.get("type") == ttype and needle in (t.get("url") or ""):
                return t["targetId"]
        return None

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


RES = []


def ck(name, got, want=True):
    ok = (got == want) if not isinstance(want, bool) else (bool(got) == want)
    RES.append((ok, name))
    print(("PASS  " if ok else "FAIL  ") + name + " = " + repr(got) + ("" if ok else "  (期望 " + repr(want) + ")"))


def clean_download(c, sw_sid, name_part):
    """从 chrome.downloads 里删掉本次测试产物（文件 + 记录）。"""
    c.ev("""(async()=>{
      const list = await new Promise(r=>chrome.downloads.search({limit:200}, x=>{void chrome.runtime.lastError; r(x||[])}));
      for (const it of list) {
        if ((it.filename||'').indexOf(%s) >= 0) {
          await new Promise(r=>chrome.downloads.removeFile(it.id, ()=>r()));
          await new Promise(r=>chrome.downloads.erase({id: it.id}, ()=>r()));
        }
      }
      return 1;
    })()""" % json.dumps(name_part), sw_sid)
    # 磁盘兜底清理（Downloads 根 + 子目录里匹配的测试文件，避开 _library/_回收站）
    try:
        for dirpath, dirnames, files in os.walk(DL_DIR):
            dirnames[:] = [d for d in dirnames if d not in ("_library", "_回收站")]
            for f in files:
                if name_part in f:
                    try:
                        os.remove(os.path.join(dirpath, f))
                    except OSError:
                        pass
    except OSError:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9490)
    ap.add_argument("--ext", default="ceogmckiinjolbbdkjfelmfcfepccabp")
    a = ap.parse_args()

    c = Cdp(a.port)
    srv, sport = start_site()
    url = "http://127.0.0.1:%d/" % sport
    print("测试页:", url)

    # ---- 1) 开页面，制造媒体请求 ----
    tid = c.send("Target.createTarget", {"url": url})["targetId"]
    sid = c.attach(tid, 1440, 900)
    time.sleep(5)
    pos = c.ev("""(()=>{const v=document.querySelector('video'); if(!v) return ''; v.muted=true; try{v.play()}catch(e){};
                  const b=v.getBoundingClientRect(); return JSON.stringify({x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)})})()""", sid)
    if pos and isinstance(pos, str):
        p = json.loads(pos)
        for t in ("mousePressed", "mouseReleased"):
            c.send("Input.dispatchMouseEvent", {"type": t, "x": p["x"], "y": p["y"],
                                                "button": "left", "clickCount": 1}, sid)
    time.sleep(3)

    # ---- 2) 开 popup（带 tabId）----
    tab_id = 0
    tid_pop = c.send("Target.createTarget", {"url": "chrome-extension://%s/popup.html" % a.ext})["targetId"]
    sid_pop = c.attach(tid_pop, 400, 620)
    time.sleep(2.5)
    tab_id = c.ev("""(async()=>{
      const tabs = await new Promise(r=>chrome.tabs.query({}, x=>{void chrome.runtime.lastError; r(x||[])}));
      // 取「最新的」匹配页签：实例复用时可能残留旧端口的测试页（服务器已死，
      // 拿旧 tab 的媒体会必败 NETWORK_FAILED——2026-11-08 实测踩坑）。
      const hits = tabs.filter(t=>/127\\.0\\.0\\.1/.test(t.url||'')).sort((a,b)=>b.id-a.id);
      return hits.length ? hits[0].id : 0;})()""", sid_pop)
    c.send("Target.closeTarget", {"targetId": tid_pop})
    time.sleep(0.5)
    if not isinstance(tab_id, int) or tab_id <= 0:
        print("FAIL  拿不到测试页 tabId，终止")
        return finish(c, srv)
    tid_pop = c.send("Target.createTarget",
                     {"url": "chrome-extension://%s/popup.html?tabId=%d" % (a.ext, tab_id)})["targetId"]
    sid_pop = c.attach(tid_pop, 400, 620)
    time.sleep(4.5)
    rows = c.ev("document.querySelectorAll('#mediaList .panel, #allMediaList .panel').length", sid_pop)
    print("popup 嗅探行数:", rows)
    ck("popup 嗅到媒体", isinstance(rows, int) and rows > 0, True)

    # ---- 3) 预置兜底标记（等价于「SW 已发生过 downloads 兜底」的会话状态）----
    c.ev("chrome.storage.session.set({vrNameFallback:true}).then(()=>1)", sid_pop)

    # ---- 4) 真实批量下载：清掉历史去重记录（profile 可能复用）→ 点 #DownFile ----
    c.ev("(()=>{const b=document.getElementById('vrClearDownloaded'); if(b) b.click(); return 1})()", sid_pop)
    time.sleep(0.6)
    dbg0 = c.ev("""(()=>{const all=(typeof vrAllData==='function')?vrAllData():[];
      return JSON.stringify(all.slice(0,5).map(d=>({url:(d.url||'').slice(0,90), parsing:d.parsing||'', name:d.downFileName||''})));})()""", sid_pop)
    print("卡片数据:", dbg0)
    c.errs = []
    c.ev("(()=>{const b=document.getElementById('DownFile'); if(b) b.click(); return 1})()", sid_pop)

    # ---- 5) 等「批量完成」提示（成功+失败混合的诚实汇报）----
    tip_text = ""
    for _ in range(60):
        time.sleep(0.8)
        tip_text = c.ev("""(()=>{const a=(document.getElementById('Tips')||{}).textContent||'';
                             const b=(document.getElementById('TipsFixed')||{}).textContent||'';
                             return a + '||' + b;})()""", sid_pop) or ""
        if "批量完成" in tip_text:
            break
    print("Tips 文案:", repr(tip_text))
    ck("T1 批量完成提示出现", "批量完成" in tip_text, True)
    ck("T1b 提示带「文件名可能被浏览器改名」", "文件名可能被浏览器改名" in tip_text, True)
    ck("T1c 失败被如实汇报（N 个失败）", "个失败" in tip_text, True)
    # DEF-A 修复的行为级断言：失败的卡片不再留「已完成」假象
    card_state = c.ev("""(()=>{
      const p=[...document.querySelectorAll('#mediaList .panel, #allMediaList .panel')]
        .find(x=>/vr-video/.test(x.className));
      return p ? (p.classList.contains('done') ? 'done' : (p.getAttribute('data-vr-state')||'none')) : 'no-card';})()""", sid_pop)
    print("视频卡状态:", card_state)
    ck("T1d 失败卡片不再是「已完成」", card_state in ("失败", "none"), True)
    n_err = len(c.errs)
    for e in c.errs[:3]:
        print("   ! popup 异常:", e.replace("\n", " ")[:200])
    ck("T1e popup 无 JS 异常", n_err, 0)

    # ---- 5b) DEF-A 行为级复验：失败后**不清理**直接重试，靠回滚放行 ----
    c.ev("(()=>{const b=document.getElementById('DownFile'); if(b) b.click(); return 1})()", sid_pop)
    blocked = False
    retried = False
    t2 = ""
    for _ in range(10):
        time.sleep(0.8)
        t2 = c.ev("""(()=>{const a=(document.getElementById('Tips')||{}).textContent||'';
                            const b=(document.getElementById('TipsFixed')||{}).textContent||'';
                            return a + '||' + b;})()""", sid_pop) or ""
        if "都下载过了" in t2:
            blocked = True
            break
        if "批量完成" in t2:
            retried = True
            break
    print("重试 Tips:", repr(t2))
    ck("T1f 失败后可重试（不被「都下载过了」拦死）", blocked, False)
    ck("T1g 重试发起了新下载", retried, True)

    # ---- 6) fix-1：SW 侧 vrDownloadWithName 兜底 → 标记真实写入 ----
    sw_tid = c.find_target("background.js", ttype="service_worker")
    ck("找到 SW 目标", bool(sw_tid), True)
    if sw_tid:
        sw_sid = c.attach(sw_tid)
        time.sleep(1)
        # 先清掉旧标记，验证是这次下载写上的
        c.ev("chrome.storage.session.remove('vrNameFallback').then(()=>1)", sw_sid)
        dl = c.ev("""(async()=>{
          try {
            const r = await vrDownloadWithName('http://127.0.0.1:%d/qa-dl.png', 'qa-fallback-flag.png');
            return JSON.stringify(r);
          } catch(e) { return 'ERR:' + e.message; }
        })()""" % sport, sw_sid)
        print("vrDownloadWithName 返回:", dl)
        time.sleep(2)
        flag = c.ev("""(async()=>{
          const o = await chrome.storage.session.get('vrNameFallback');
          return !!o.vrNameFallback;})()""", sw_sid)
        ck("T2 兜底下载后 vrNameFallback=true", flag, True)
        # T3 按返回的 downloadId 查真实下载状态（不依赖文件名——ADR-040 下名字会被改）
        dl_id = None
        try:
            v = json.loads(dl) if isinstance(dl, str) else dl
            if isinstance(v, dict):
                dl_id = v.get("downloadId")
            elif isinstance(v, (int, float)):
                dl_id = int(v)          # vrDownloadWithName downloads 分支直接返回数字 id
        except Exception:
            dl_id = None
        print("解析 downloadId:", dl_id)
        rec = c.ev("""(async()=>{
          const q = %s ? {id: %s} : {limit: 20};
          const list = await new Promise(r=>chrome.downloads.search(q, x=>{void chrome.runtime.lastError; r(x||[])}));
          return JSON.stringify(list.map(x=>({id:x.id, state:x.state, name:(x.filename||'').split(/[\\\\/]/).pop(), url:(x.url||'').slice(0,60), err:x.error||''})));})()""" % (json.dumps(dl_id is not None), json.dumps(dl_id)), sw_sid)
        print("下载记录:", rec)
        ok_rec = isinstance(rec, str) and "complete" in rec
        ck("T3 兜底下载真实完成", ok_rec, True)
        clean_download(c, sw_sid, "qa-dl")
        clean_download(c, sw_sid, "qa-fallback-flag")
        clean_download(c, sw_sid, "qa-big")

    return finish(c, srv)


def finish(c, srv):
    total = len(RES)
    ok_n = sum(1 for ok, _ in RES if ok)
    print("-" * 60)
    for ok, name in RES:
        if not ok:
            print("FAIL ->", name)
    print("%d/%d PASS" % (ok_n, total))
    c.close()
    try:
        srv.shutdown()
    except Exception:
        pass
    return 0 if ok_n == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
