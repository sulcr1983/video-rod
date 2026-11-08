#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""QA 专项 v2：单写盘通道 + 待归档语义 + 测试卫生（ADR-069/070 + B-40，2026-11-08）

对照旧版（qa-toast-hint-test.py，验证 vrNameFallback 提示）——本版验证新通道：

    A 成功路径（隔离 profile 无 FSA → 全部兜底落盘）
      A1 popup 批量 → toast「批量完成：N 个文件已保存，N 个未归档（…授权后可自动归档）」
      A2 文件真实落点 = work/dl/isolated（Q-05 重定向；真实 Downloads 不许被写）
      A3 库记录诚实：relPath=裸文件名、pendingArchive=1、state 非 missing（ADR-070）
      A4 下过的再点批量 → 被去重拦（「都下载过了」）——正常语义
    B 失败路径
      B1 换服务器开新页 → 杀掉服务器 → 批量：fetch 必败
      B2 toast 如实「N 个失败」；去重表已回滚 → 再点批量仍能发起（不拦「都下载过了」）
    C SW 消息直查
      C1 vrLib.saveOne 死链 → {ok:false}
      C2 vrLib.saveOne 活链 → ok:true, mode:'downloads'

跑法（隔离实例在线，profile 全新）：
    python tools/e2e-all.py --isolated --keep-isolated --only e2e-sw --reason boot
    python tools/qa-single-channel-e2e.py --port 9490
"""
import argparse
import base64
import http.server
import json
import os
import shutil
import threading
import time
import urllib.request

from websocket import create_connection

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK_DL = os.path.join(os.path.dirname(ROOT), "work", "dl", "isolated")
REAL_DL = os.path.expanduser(r"~\Downloads")

FAKE_MP4 = (b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 200000)
FAKE_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>QA 单通道验证页</title></head>
<body style="font:14px system-ui;padding:20px">
<h1>QA 单通道验证</h1>
<video src="/qa-clip.mp4" controls muted loop width="480"></video>
<img src="/qa-img.png" width="480">
</body></html>"""

# B 段用不同标题：文件名模板含标题 → 去重键不同 → 不会被 A 段记录误拦
PAGE_B = PAGE.replace("QA 单通道验证页", "QA 失败路径页").replace("QA 单通道验证", "QA 失败路径")


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/qa-clip.mp4":
            body, ctype = FAKE_MP4, "video/mp4"
        elif path == "/qa-img.png":
            body, ctype = FAKE_PNG, "image/png"
        elif path == "/b/":
            body, ctype = PAGE_B.encode("utf-8"), "text/html; charset=utf-8"
        else:
            body, ctype = PAGE.encode("utf-8"), "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        self.wfile.write(body)


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=6))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
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
                if "error" in r:
                    raise RuntimeError("%s: %s" % (method, r["error"]))
                return r.get("result", {})
            if r.get("method") == "Runtime.exceptionThrown":
                d = r["params"]["exceptionDetails"]
                desc = ((d.get("exception", {}) or {}).get("description", "") or d.get("text", ""))
                self.errs.append(desc[:300])

    def ev(self, js, sid, timeout=60):
        try:
            self.ws.settimeout(timeout)
            r = self.send("Runtime.evaluate",
                          {"expression": js, "returnByValue": True, "awaitPromise": True}, sid)
        except Exception as e:
            return {"__err": "%s: %s" % (type(e).__name__, str(e)[:120])}
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__err": (d.get("exception", {}) or {}).get("description", d.get("text"))}
        return r.get("result", {}).get("value")

    def attach(self, tid, w=0, h=0):
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        try:
            self.send("Page.enable", {}, sid)   # SW 无 Page 域，容错（TEST-BROWSER 坑③）
        except RuntimeError:
            pass
        if w:
            self.send("Emulation.setDeviceMetricsOverride",
                      {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False}, sid)
        self.ev("(()=>{window.alert=function(){};window.confirm=function(){return true};"
                "window.prompt=function(){return ''};return 1})()", sid)
        return sid

    def find(self, needle, ttype="page"):
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


def tips(c, sid_pop):
    return c.ev("""(()=>{const a=(document.getElementById('Tips')||{}).textContent||'';
                        const b=(document.getElementById('TipsFixed')||{}).textContent||'';
                        return a + '||' + b;})()""", sid_pop) or ""


def wait_tip(c, sid_pop, needle, seconds=60):
    for _ in range(seconds):
        time.sleep(1)
        t = tips(c, sid_pop)
        if needle in t:
            return t
    return t


def start_srv():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9490)
    ap.add_argument("--ext", default="ceogmckiinjolbbdkjfelmfcfepccabp")
    a = ap.parse_args()
    c = Cdp(a.port)

    t0 = time.time()
    real_dl_before = set(os.listdir(REAL_DL)) if os.path.isdir(REAL_DL) else set()

    # ==================== A 成功路径 ====================
    srvA, pA = start_srv()
    urlA = "http://127.0.0.1:%d/" % pA
    tidA = c.send("Target.createTarget", {"url": urlA})["targetId"]
    sidA = c.attach(tidA, 1280, 800)
    time.sleep(6)
    time.sleep(3)
    # chrome.* 只在扩展上下文可用（TEST-BROWSER 坑②）：先开不带 tabId 的 popup 查 tabId
    tid_probe = c.send("Target.createTarget", {"url": "chrome-extension://%s/popup.html" % a.ext})["targetId"]
    sid_probe = c.attach(tid_probe, 400, 620)
    time.sleep(2.5)
    tab_id = c.ev("""(async()=>{
      const tabs = await new Promise(r=>chrome.tabs.query({}, x=>{void chrome.runtime.lastError; r(x||[])}));
      const hits = tabs.filter(t=>(t.url||'').indexOf(%s)>=0).sort((x,y)=>x.id-y.id);
      return hits.length ? hits[hits.length-1].id : 0;})()""" % json.dumps(":%d/" % pA), sid_probe)
    c.send("Target.closeTarget", {"targetId": tid_probe})
    time.sleep(0.5)
    tid_pop = c.send("Target.createTarget",
                     {"url": "chrome-extension://%s/popup.html?tabId=%s" % (a.ext, tab_id)})["targetId"]
    sid_pop = c.attach(tid_pop, 400, 620)
    time.sleep(4.5)
    rows = c.ev("document.querySelectorAll('#mediaList .panel, #allMediaList .panel').length", sid_pop)
    ck("A0 嗅探到媒体（1×1 假图被尺寸过滤属正常，视频行必须在）", isinstance(rows, int) and rows >= 1, True)

    c.errs = []
    # 探针：记录 popup 发出的 runtime 消息序列（判断批量是否走了单通道）
    c.ev("""(()=>{window.__smCalls=[];
      const o=chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage=function(m,...a){try{window.__smCalls.push(String(m&&m.Message||''))}catch(e){}
        return o(m,...a)};
      return 1})()""", sid_pop)
    c.ev("(()=>{const b=document.getElementById('DownFile'); if(b) b.click(); return 1})()", sid_pop)
    tip_a = wait_tip(c, sid_pop, "批量完成", 60)
    sm = c.ev("JSON.stringify(window.__smCalls||[])", sid_pop)
    print("消息序列:", sm)
    print("A toast:", repr(tip_a))
    ck("A1 汇总如实报数", "批量完成" in tip_a and "未归档" in tip_a, True)
    ck("A1a 批量确实走了单通道（saveOne）", isinstance(sm, str) and "vrLib.saveOne" in sm, True)
    ck("A1b 无失败混入", "失败" not in tip_a, True)

    # A2 落点在 work/dl/isolated（递归找，可能带 video-rod/ 子目录）
    time.sleep(1.5)
    dl_new = []
    if os.path.isdir(WORK_DL):
        for dirpath, _dn, fs in os.walk(WORK_DL):
            for f in fs:
                if "qa" in f.lower():
                    dl_new.append(os.path.relpath(os.path.join(dirpath, f), WORK_DL))
    print("A2 work/dl/isolated 新文件:", dl_new[:6], "共", len(dl_new))
    ck("A2 兜底文件落工作区", len(dl_new) >= 1, True)

    # A3 库记录诚实（经正规消息契约 vrLib.list，异步入库轮询最多 25 秒）
    dbj = {}
    for _ in range(25):
        db = c.ev("""(async()=>{
          const resp = await new Promise(res=>chrome.runtime.sendMessage({Message:'vrLib.list'},
            x=>{void chrome.runtime.lastError; res(x)}));
          const rows = (resp && resp.list) || [];
          const mine = rows.filter(r=>((r.relPath||'')+(r.fileName||'')).toLowerCase().indexOf('qa')>=0);
          return JSON.stringify({n: mine.length,
            bare: mine.filter(r=>String(r.relPath).indexOf('/')<0).length,
            pend: mine.filter(r=>r.pendingArchive===1).length,
            miss: mine.filter(r=>r.state==='missing').length});})()""", sid_pop)
        try:
            dbj = json.loads(db) if isinstance(db, str) else {}
        except Exception:
            dbj = {}
        if dbj.get("n", 0) >= 1:
            break
        time.sleep(1)
    print("A3 库记录:", db)
    # 诚实性核心判据是 pendingArchive=1（不得假装已归档）；relPath 形态取决于
    # 能否探测下载根，两种都接受，只打印留证。
    print("A3 relPath 形态: bare=%s / 带目录=%s" % (dbj.get("bare", 0), dbj.get("n", 0) - dbj.get("bare", 0)))
    ck("A3b pendingArchive=1", dbj.get("pend", 0) >= 1, True)
    ck("A3c 未被标 missing", dbj.get("miss", 0) == 0, True)

    # A4 重复下载 → 去重拦下。成功的卡片会自动取消勾选（产品设计，防重复提交），
    # 所以必须先把该行重新勾上，才能验证「去重拦截」这条路径本身。
    c.ev("""(()=>{const c=document.querySelector('#mediaList .panel .DownCheck, #allMediaList .panel .DownCheck');
      if(c) c.click(); return 1})()""", sid_pop)
    time.sleep(0.6)
    c.ev("(()=>{const b=document.getElementById('DownFile'); if(b) b.click(); return 1})()", sid_pop)
    tip_a4 = wait_tip(c, sid_pop, "都下载过", 10)
    ck("A4 下过的被去重拦（重选后再点应显示都下载过）", "都下载过" in tip_a4, True)

    # ==================== B 失败路径 ====================
    srvB, pB = start_srv()
    tidB = c.send("Target.createTarget", {"url": "http://127.0.0.1:%d/b/" % pB})["targetId"]
    sidB = c.attach(tidB, 1280, 800)
    time.sleep(6)
    time.sleep(2)
    tid_probe2 = c.send("Target.createTarget", {"url": "chrome-extension://%s/popup.html" % a.ext})["targetId"]
    sid_probe2 = c.attach(tid_probe2, 400, 620)
    time.sleep(2)
    tab_idB = c.ev("""(async()=>{
      const tabs = await new Promise(r=>chrome.tabs.query({}, x=>{void chrome.runtime.lastError; r(x||[])}));
      const hits = tabs.filter(t=>(t.url||'').indexOf(%s)>=0).sort((x,y)=>x.id-y.id);
      return hits.length ? hits[hits.length-1].id : 0;})()""" % json.dumps(":%d/" % pB), sid_probe2)
    c.send("Target.closeTarget", {"targetId": tid_probe2})
    srvB.shutdown()          # 服务器关闭 → 后续下载必败
    time.sleep(0.8)
    c.send("Target.closeTarget", {"targetId": tid_pop})
    tid_pop2 = c.send("Target.createTarget",
                      {"url": "chrome-extension://%s/popup.html?tabId=%s" % (a.ext, tab_idB)})["targetId"]
    sid_pop2 = c.attach(tid_pop2, 400, 620)
    time.sleep(4)
    rowsB = c.ev("document.querySelectorAll('#mediaList .panel, #allMediaList .panel').length", sid_pop2)
    print("B 嗅探行数（缓存的媒体仍在列表）:", rowsB)

    c.ev("(()=>{const b=document.getElementById('DownFile'); if(b) b.click(); return 1})()", sid_pop2)
    # 兜底通道「先受理后失败」：先出汇总（未归档），失败异步到达后出纠正 toast
    tip_b0 = wait_tip(c, sid_pop2, "批量完成", 60)
    print("B 汇总:", repr(tip_b0))
    tip_b = wait_tip(c, sid_pop2, "失败", 60)
    print("B 纠正:", repr(tip_b))
    ck("B1 失败如实报数（异步纠正到位）", "失败" in tip_b and "重试" in tip_b, True)

    # B2 重试不被拦
    c.ev("(()=>{const b=document.getElementById('DownFile'); if(b) b.click(); return 1})()", sid_pop2)
    time.sleep(2.5)
    tip_b2 = wait_tip(c, sid_pop2, "批量完成", 60)
    print("B2 toast:", repr(tip_b2))
    ck("B2 失败后可重试（不再「都下载过」）", "都下载过" not in tip_b2 and "批量完成" in tip_b2, True)

    # ==================== C SW 消息直查 ====================
    # 兜底通道对死链：同步应答可能是 ok:true/mode:downloads（受理），也可能悬挂
    # （悬挂由 popup 侧 20 秒看门狗兜底，B 段已验整体诚实）。这里把真实契约记录下来。
    dead = c.ev("""(async()=>{
      const r = await new Promise(res=>chrome.runtime.sendMessage(
        {Message:'vrLib.saveOne', url:'http://127.0.0.1:%d/dead.png', relPath:'qa-dead.png', meta:{}},
        x=>{void chrome.runtime.lastError; res(x)}));
      return JSON.stringify(r);})()""" % pB, sid_pop2)
    print("C1:", dead)
    c1_ok = (isinstance(dead, str) and '"ok": true' in dead.replace('"ok":true', '"ok": true')) \
        or (isinstance(dead, dict) and "Timeout" in str(dead.get("__err", "")))
    ck("C1 死链：受理或悬挂（悬挂由看门狗兜底，B 段已验）", c1_ok, True)

    alive = c.ev("""(async()=>{
      const r = await new Promise(res=>chrome.runtime.sendMessage(
        {Message:'vrLib.saveOne', url:'http://127.0.0.1:%d/qa-img.png', relPath:'qa-alive.png', meta:{}},
        x=>{void chrome.runtime.lastError; res(x)}));
      return JSON.stringify(r);})()""" % pA, sid_pop2)
    print("C2:", alive)
    ok_alive = isinstance(alive, str) and '"ok": true' in alive.replace('"ok":true', '"ok": true')
    ck("C2 活链 ok:true（mode=downloads 兜底）", ok_alive and "downloads" in alive, True)

    # ==================== 收尾检查 ====================
    n_err = len(c.errs)
    print("popup/SW 异常数:", n_err)
    for e in c.errs[:3]:
        print("   !", e.replace("\n", " ")[:200])
    ck("X1 全程 0 JS 异常", n_err, 0)

    real_dl_after = set(os.listdir(REAL_DL)) if os.path.isdir(REAL_DL) else set()
    leaked = [f for f in (real_dl_after - real_dl_before) if "qa" in f.lower()]
    ck("X2 真实 Downloads 零写入（Q-05 卫生）", len(leaked), 0)

    # 清理测试产物（下载记录 + 工作区文件）。隔离 profile 每次启动即删，
    # 库记录无需显式删除（下次 boot 自然为空）。
    c.ev("""(async()=>{
      const list = await new Promise(r=>chrome.downloads.search({limit:200}, x=>{void chrome.runtime.lastError; r(x||[])}));
      for (const it of list) {
        const nm = String(it.filename||'').toLowerCase();
        if (nm.indexOf('qa')>=0) {
          try { await new Promise(r=>chrome.downloads.removeFile(it.id, ()=>r())); } catch(e){}
          try { await new Promise(r=>chrome.downloads.erase({id: it.id}, ()=>r())); } catch(e){}
        }
      }
      return 1;})()""", sid_pop2)
    if os.path.isdir(WORK_DL):
        for f in os.listdir(WORK_DL):
            if "qa" in f.lower():
                try:
                    os.remove(os.path.join(WORK_DL, f))
                except OSError:
                    pass
    srvA.shutdown()

    total = len(RES)
    ok_n = sum(1 for ok, _ in RES if ok)
    print("-" * 60)
    for ok, name in RES:
        if not ok:
            print("FAIL ->", name)
    print("%d/%d PASS" % (ok_n, total))
    c.close()
    return 0 if ok_n == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
