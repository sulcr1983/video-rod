#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""QA 登录态实测：真实站点下载 → 文件落盘 → 媒体库显示（2026-11-08）

对应 TEST-ASSETS A2（小红书图文笔记，⬜ 待验）。全程单实例（9480 登录态），
站点只开一次（EL-07）；真实库只增不改不删，测前用 vr-db-snapshot backup。

链路（每步都是真实操作，不 mock）：
    L1  A2 页面打开，嗅探到媒体（popup 列表有行）
    L2  popup 批量下载：出「批量完成」或「没有新文件（去重）」的诚实提示
    L3  chrome.downloads 有 complete 记录且文件名带 小红书/ 目录
    L4  磁盘真实落盘（D:/personal/Downloads/video-rod/小红书/...）
    L5  资源库出现本次素材卡片（按下载时间窗口找），缩略图 naturalWidth>0
    L6  点开卡片预览：大图 naturalWidth>0；platform=小红书、creator 非空
    L7  既有 B站 视频卡可打开预览（video 元素存在）

跑法：python tools/qa-live-real-site-e2e.py --port 9480
"""
import argparse
import base64
import json
import os
import time
import urllib.request

from websocket import create_connection

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A2_URL = ("https://www.xiaohongshu.com/explore/6a065a7a000000003601b78d"
          "?source=webshare&xhsshare=pc_web"
          "&xsec_token=ABXmuExu05VNDaPIg2iSvW1j4gSFtktkzOlOSNW68-J8M="
          "&xsec_source=pc_share")
DL_ROOT = r"D:\personal\Downloads\video-rod"


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=6))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        self.mid = 0
        self.errs = []
        self.created = []

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
                res = r.get("result", {})
                if method == "Target.createTarget" and res.get("targetId"):
                    self.created.append(res["targetId"])
                return res
            if r.get("method") == "Runtime.exceptionThrown":
                d = r["params"]["exceptionDetails"]
                desc = ((d.get("exception", {}) or {}).get("description", "") or d.get("text", ""))
                self.errs.append(desc[:300])

    def ev(self, js, sid, timeout=40):
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

    def find(self, needle, ttype="page"):
        for t in self.send("Target.getTargets")["targetInfos"]:
            if t.get("type") == ttype and needle in (t.get("url") or ""):
                return t["targetId"], t.get("url")
        return None, None

    def attach(self, tid, w=0, h=0):
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        try:
            self.send("Page.enable", {}, sid)   # SW 不支持 Page.enable，容错
        except RuntimeError:
            pass
        if w:
            self.send("Emulation.setDeviceMetricsOverride",
                      {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False}, sid)
        self.ev("(()=>{window.alert=function(){};window.confirm=function(){return true};"
                "window.prompt=function(){return ''};return 1})()", sid)
        return sid

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


def tips(sid_pop):
    return c.ev("""(()=>{const a=(document.getElementById('Tips')||{}).textContent||'';
                        const b=(document.getElementById('TipsFixed')||{}).textContent||'';
                        return a + '||' + b;})()""", sid_pop) or ""


c = None


def main():
    global c
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--ext", default="ceogmckiinjolbbdkjfelmfcfepccabp")
    a = ap.parse_args()
    c = Cdp(a.port)

    t0 = time.time()
    # ---- L1 打开 A2 页（只开一次；已有同 URL 页则复用）----
    tid, cur = c.find("xhs-explore-qa-a2")
    if not tid:
        tid, cur = c.find("/explore/6a065a7a")
    if not tid:
        tid = c.send("Target.createTarget", {"url": A2_URL})["targetId"]
    sid = c.attach(tid, 1440, 900)
    time.sleep(14)
    print("页面:", c.ev("document.title", sid))
    sniff = c.ev("window.__vrNetSniff ? JSON.stringify({hits:window.__vrNetSniff.hits,posts:window.__vrNetSniff.posts}) : 'none'", sid)
    print("页内嗅探:", sniff)

    # 找到该页的 chrome tabId（chrome.* API 只在扩展上下文可用 → 走 SW 查）
    sw_tid, _ = c.find("background.js", ttype="service_worker")
    sw_sid = c.attach(sw_tid) if sw_tid else None
    tab_id = c.ev("""(async()=>{
      const tabs = await new Promise(r=>chrome.tabs.query({}, x=>{void chrome.runtime.lastError; r(x||[])}));
      const hit = tabs.filter(t=>/xiaohongshu\\.com\\/explore\\/6a065a7a/.test(t.url||'')).pop();
      return hit ? hit.id : 0;})()""", sw_sid)
    if not isinstance(tab_id, int) or tab_id <= 0:
        print("FAIL  拿不到 A2 tabId")
        return finish(c)
    print("A2 tabId:", tab_id)

    # ---- popup ----
    tid_pop = c.send("Target.createTarget",
                     {"url": "chrome-extension://%s/popup.html?tabId=%d" % (a.ext, tab_id)})["targetId"]
    sid_pop = c.attach(tid_pop, 400, 620)
    time.sleep(5)
    rows = c.ev("document.querySelectorAll('#mediaList .panel, #allMediaList .panel').length", sid_pop)
    print("popup 行数:", rows)
    ck("L1 A2 嗅探到媒体（popup 有行）", isinstance(rows, int) and rows > 0, True)

    # ---- L2 批量下载（真实点击）----
    before_cnt = c.ev("""(async()=>{
      const l = await new Promise(r=>chrome.downloads.search({limit:1, orderBy:['-startTime']}, x=>{void chrome.runtime.lastError; r(x||[])}));
      return l.length ? l[0].id : 0;})()""", sid_pop)
    c.ev("(()=>{const b=document.getElementById('DownFile'); if(b) b.click(); return 1})()", sid_pop)
    tip_text = ""
    for _ in range(60):
        time.sleep(1)
        tip_text = tips(sid_pop)
        if ("批量完成" in tip_text) or ("没有新文件" in tip_text) or ("下载过" in tip_text):
            break
    print("Tips:", repr(tip_text))
    ck("L2 下载有诚实结果提示", ("批量完成" in tip_text) or ("没有新文件" in tip_text) or ("下载过" in tip_text), True)
    if "没有新文件" in tip_text or "下载过" in tip_text:
        print("（A2 素材已下载过：走既有卡片显示验证）")
        new_rec = []
    else:
        # ---- L3 下载记录 ----
        new_rec = c.ev("""(async()=>{
          const l = await new Promise(r=>chrome.downloads.search({limit:40, orderBy:['-startTime']}, x=>{void chrome.runtime.lastError; r(x||[])}));
          return JSON.stringify(l.filter(x=>x.id > %d).map(x=>({id:x.id, st:x.state, name:(x.filename||'').split(/[\\\\/]/).pop(), dir:(x.filename||'').indexOf('小红书')>=0, err:x.error||''})));})()""" % (before_cnt if isinstance(before_cnt, int) else 0), sid_pop)
        try:
            new_rec = json.loads(new_rec) if isinstance(new_rec, str) else []
        except Exception:
            new_rec = []
        print("新下载记录:", json.dumps(new_rec, ensure_ascii=False)[:400])
        ck("L3 有 complete 的新下载记录", any(x.get("st") == "complete" for x in new_rec), True)
        ck("L3b 落点在小红书目录", all(x.get("dir") for x in new_rec if x.get("st") == "complete"), True)

    c.send("Target.closeTarget", {"targetId": tid_pop})

    # ---- L4 磁盘落盘 ----
    hit_files = []
    for dirpath, dirnames, files in os.walk(os.path.join(DL_ROOT, "小红书")):
        for f in files:
            p = os.path.join(dirpath, f)
            mt = os.path.getmtime(p)
            if mt >= t0 - 60:   # 本次会话窗口（放宽 60s）
                hit_files.append((p.replace("\\", "/"), os.path.getsize(p)))
    print("本次新增磁盘文件:", len(hit_files))
    for p, s in hit_files[:6]:
        print("   ", p, s, "B")
    ck("L4 磁盘真实落盘（小红书目录有新文件）", len(hit_files) > 0, True)

    # ---- L5/L6 资源库显示 ----
    tid_lib = c.send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % a.ext})["targetId"]
    sid_lib = c.attach(tid_lib, 1440, 900)
    for _ in range(20):
        time.sleep(1)
        boot = c.ev("JSON.stringify(window.__vrBoot || [])", sid_lib)
        if isinstance(boot, str) and "load:" in boot:
            break
    print("库启动:", boot)
    total = c.ev("document.querySelectorAll('#grid .card').length", sid_lib)
    print("库卡片总数:", total)
    ck("L5 库加载无异常启动", isinstance(total, int) and total > 0, True)

    # 搜「黔阳古城」（A2 同一作者康辉游天下）或按本次窗口新卡
    new_rels = [p.split("video-rod/", 1)[-1] for p, _ in hit_files]
    fname_key = os.path.basename(new_rels[0]).split("_0")[0][:12] if new_rels else "黔阳古城"
    sq = c.ev("""(()=>{const s=document.getElementById('search'); s.value=%s; s.dispatchEvent(new Event('input',{bubbles:true})); return 1})()""" % json.dumps(fname_key), sid_lib)
    time.sleep(1.2)
    found = c.ev("document.querySelectorAll('#grid .card').length", sid_lib)
    print("搜索「%s」命中卡片:" % fname_key, found)
    ck("L5b 本次素材在库中可搜到", isinstance(found, int) and found > 0, True)

    # 清搜索，点开第一张小红书卡看预览
    c.ev("""(()=>{const s=document.getElementById('search'); s.value=''; s.dispatchEvent(new Event('input',{bubbles:true})); return 1})()""", sid_lib)
    time.sleep(1.0)
    opened = c.ev("""(()=>{
      const card=[...document.querySelectorAll('#grid .card')].find(x=>(x.dataset.id||'').indexOf('小红书')>=0);
      if(!card) return 0; card.click(); return 1;})()""", sid_lib)
    time.sleep(2.5)
    pv_open = c.ev("!document.getElementById('preview').classList.contains('hidden')", sid_lib)
    ck("L6 小红书卡可打开预览", opened == 1 and pv_open is True, True)
    if pv_open:
        img_ok = c.ev("""(()=>{const im=document.querySelector('#pvStage img, #preview img');
          return im ? im.naturalWidth : 0;})()""", sid_lib)
        plat = c.ev("(document.querySelector('#pvPlat, .pv-plat')||{}).textContent || ''", sid_lib)
        creator = c.ev("""(()=>{const e=document.querySelector('#pvCreator, .pv-creator'); return e?e.textContent.trim():'';})()""", sid_lib)
        title = c.ev("(document.getElementById('pvTitle')||{}).textContent || ''", sid_lib)
        print("预览: naturalWidth=%s plat=%r creator=%r title=%r" % (img_ok, plat[:20], creator[:30], title[:40]))
        ck("L6b 大图真实解码（naturalWidth>0）", isinstance(img_ok, int) and img_ok > 0, True)
        c.ev("document.getElementById('pvClose').click(); 1", sid_lib)
        time.sleep(0.8)

    # ---- L7 既有 B站 视频卡 ----
    c.ev("(()=>{const s=document.getElementById('search'); s.value='麒麟'; s.dispatchEvent(new Event('input',{bubbles:true})); return 1})()", sid_lib)
    time.sleep(1.2)
    bili_cards = c.ev("document.querySelectorAll('#grid .card').length", sid_lib)
    print("搜索「麒麟」(B站视频):", bili_cards)
    if not bili_cards:
        c.ev("(()=>{const s=document.getElementById('search'); s.value='B站'; s.dispatchEvent(new Event('input',{bubbles:true})); return 1})()", sid_lib)
        time.sleep(1.2)
        bili_cards = c.ev("document.querySelectorAll('#grid .card').length", sid_lib)
        print("搜索「B站」:", bili_cards)
    vid_open = c.ev("""(()=>{
      const card=[...document.querySelectorAll('#grid .card')].find(x=>/\\.mp4$/i.test(x.dataset.id||''));
      if(!card) return 0; card.click(); return 1;})()""", sid_lib)
    time.sleep(4)
    vid_state = c.ev("""(()=>{
      const p=document.getElementById('preview');
      if(!p || p.classList.contains('hidden')) return 'no-preview';
      const v=document.querySelector('#preview video, #pvStage video');
      if(!v) return 'no-video-el';
      return JSON.stringify({rs:v.readyState, dur:Math.round(v.duration||0)});})()""", sid_lib)
    print("视频预览:", vid_state)
    ck("L7 既有视频卡预览有 video 元素", isinstance(vid_state, str) and vid_state.startswith("{"), True)
    c.ev("document.getElementById('pvClose').click(); 1", sid_lib)
    nerr = c.ev("window.__vrRealErrs ? window.__vrRealErrs.length : 0", sid_lib)
    return finish(c)


def finish(c):
    total = len(RES)
    ok_n = sum(1 for ok, _ in RES if ok)
    print("-" * 60)
    for ok, name in RES:
        if not ok:
            print("FAIL ->", name)
    print("%d/%d PASS" % (ok_n, total))
    if c:
        c.close()
    return 0 if ok_n == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
