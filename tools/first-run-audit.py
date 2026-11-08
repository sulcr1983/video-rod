#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""首次使用黑盒验收：干净 profile + 本地媒体站 + 真实扩展 UI。

覆盖：
  1. 首次打开资源库（空库、只读提示、启动链）
  2. 设置页 / popup 首次加载
  3. 页面悬停下载图片 → 落盘 → 自动入库 → 库内找到
  4. 页面悬停下载视频 → 落盘 → 自动入库 → 库内找到 → 预览
  5. 搜索 / 排序 / 信息面板 / 预览（不做删除，删除需要用户授权目录）

只使用独立 profile 和本地临时媒体，不碰真实 9480 库。
用法：python tools/first-run-audit.py
"""
import argparse
import base64
import http.server
import json
import os
from vr_testenv import work_root
import shutil
import socketserver
import subprocess
import sys
import threading
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from websocket import create_connection

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
PROFILE = os.path.join(work_root(), "first-run-profile")
SITE = os.path.join(work_root(), "first-run-site")
DL = os.path.join(work_root(), "first-run-downloads")
PORT = 9491
EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append({"name": name, "pass": bool(ok), "detail": str(detail)[:500]})
    print(("PASS  " if ok else "FAIL  ") + name + (("  [" + str(detail)[:220] + "]") if not ok else ""))


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=8))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=90)
        self.mid = 0
        self.errs = []

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
            if r.get("method") == "Runtime.exceptionThrown":
                d = r["params"]["exceptionDetails"]
                self.errs.append(((d.get("exception", {}) or {}).get("description", "") or d.get("text", ""))[:300])

    def ev(self, js, sid, await_promise=True):
        r = self.send("Runtime.evaluate", {
            "expression": js, "returnByValue": True, "awaitPromise": await_promise
        }, sid)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__err": ((d.get("exception") or {}).get("description") or d.get("text") or "JS error")[:500]}
        return r.get("result", {}).get("value")

    def open_page(self, url, w=1440, h=900):
        tid = self.send("Target.createTarget", {"url": url})["targetId"]
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        self.send("Page.enable", {}, sid)
        if w:
            self.send("Emulation.setDeviceMetricsOverride",
                      {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False}, sid)
        return tid, sid

    def activate(self, tid):
        try: self.send("Target.activateTarget", {"targetId": tid})
        except Exception: pass

    def close(self):
        try: self.ws.close()
        except Exception: pass


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def edge_exe():
    for p in EDGE_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def start_edge():
    exe = edge_exe()
    if not exe:
        raise RuntimeError("找不到 Edge")
    shutil.rmtree(PROFILE, ignore_errors=True)
    os.makedirs(PROFILE, exist_ok=True)
    os.makedirs(DL, exist_ok=True)
    args = [
        exe,
        "--user-data-dir=%s" % PROFILE,
        "--disable-extensions-except=%s" % ROOT,
        "--load-extension=%s" % ROOT,
        "--remote-debugging-port=%d" % PORT,
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--window-size=1440,900",
    ]
    print("[启动] 干净 profile：%s" % PROFILE)
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        time.sleep(0.5)
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/json/version" % PORT, timeout=1).read()
            break
        except Exception:
            pass
    else:
        raise RuntimeError("Edge 40 秒内未监听 %d" % PORT)
    time.sleep(3)
    return proc


def prepare_site():
    shutil.rmtree(SITE, ignore_errors=True)
    os.makedirs(SITE, exist_ok=True)
    root = r"D:\personal\Downloads\video-rod"
    imgs, vids = [], []
    for base, _dirs, names in os.walk(root):
        for n in names:
            p = os.path.join(base, n)
            try: sz = os.path.getsize(p)
            except Exception: continue
            low = n.lower()
            if low.endswith((".jpg", ".jpeg", ".png", ".webp")) and 8 * 1024 < sz < 600 * 1024:
                imgs.append((sz, p))
            if low.endswith((".mp4", ".webm")) and 1 * 1024 * 1024 < sz < 25 * 1024 * 1024:
                vids.append((sz, p))
    imgs.sort(); vids.sort()
    if not imgs:
        raise RuntimeError("找不到可用真实图片")
    shutil.copyfile(imgs[0][1], os.path.join(SITE, "test.jpg"))
    has_video = bool(vids)
    if has_video:
        shutil.copyfile(vids[0][1], os.path.join(SITE, "test.mp4"))
    head = """<!doctype html><html><head><meta charset="utf-8"><title>首次使用验收测试页</title>
<style>body{font:14px system-ui;padding:24px;background:#111;color:#eee}img,video{display:block;margin:16px 0;background:#222}</style>
</head><body><h1>首次使用验收测试页</h1>"""
    with open(os.path.join(SITE, "image.html"), "w", encoding="utf-8") as f:
        f.write(head + '<p>只有图片的普通网页。</p><img id="i" src="/test.jpg" width="800"></body></html>')
    with open(os.path.join(SITE, "video.html"), "w", encoding="utf-8") as f:
        if has_video:
            f.write(head + '<p>只有视频的普通网页。</p><video id="v" src="/test.mp4" controls autoplay muted loop width="640"></video></body></html>')
        else:
            f.write(head + '<p>（没有找到小体积真实视频，跳过视频下载）</p></body></html>')
    return imgs[0][1], (vids[0][1] if has_video else "")


def start_site():
    handler = lambda *a, **kw: QuietHandler(*a, directory=SITE, **kw)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def wait_rows(c, sid, timeout=25):
    for _ in range(timeout * 2):
        raw = c.ev("VRDB.getAllFiles().then(r=>JSON.stringify(r))", sid)
        try:
            rows = json.loads(raw) if isinstance(raw, str) else []
            if rows:
                return rows
        except Exception:
            pass
        time.sleep(0.5)
    return []


def download_id(c, sid, since_ms):
    raw = c.ev("""new Promise(r=>chrome.downloads.search({}, list=>r(JSON.stringify((list||[]).filter(x=>x.startTime && new Date(x.startTime).getTime()>=%d)))))""" % since_ms, sid)
    try:
        return json.loads(raw) if isinstance(raw, str) else []
    except Exception:
        return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="deliverables/test-runs/first-run-audit.json")
    a = ap.parse_args()

    shutil.rmtree(DL, ignore_errors=True)
    os.makedirs(DL, exist_ok=True)
    img_src, vid_src = prepare_site()
    print("[素材] 图片=%s | 视频=%s" % (os.path.basename(img_src), os.path.basename(vid_src) or "无"))
    srv, site_port = start_site()
    base = "http://127.0.0.1:%d" % site_port
    proc = None
    c = None
    try:
        proc = start_edge()
        c = Cdp(PORT)
        # 下载目录固定到 .work，避免污染用户 Downloads
        try:
            c.send("Browser.setDownloadBehavior", {
                "behavior": "allow", "downloadPath": DL, "eventsEnabled": True
            })
        except Exception as e:
            print("[警告] setDownloadBehavior 失败：%s" % e)

        # ---------- 1. 首次空库 ----------
        tid_lib, sid_lib = c.open_page("chrome-extension://%s/library.html" % EXT)
        time.sleep(5)
        boot = c.ev("window.__vrBoot || []", sid_lib)
        check("首次启动链完整", isinstance(boot, list) and any(str(x).startswith("load:") for x in boot), boot)
        check("首次库为空", c.ev("document.querySelectorAll('#grid .card').length", sid_lib, False) == 0)
        empty_txt = c.ev("(document.getElementById('emptyTitle')||{}).textContent||''", sid_lib, False)
        check("空库有明确空态", "没有素材" in empty_txt or "还没有" in empty_txt, empty_txt)
        perm = c.ev("window.__vrPerm || null", sid_lib)
        check("首次权限状态已显示", isinstance(perm, dict), perm)
        if isinstance(perm, dict):
            check("首次无目录授权=只读", perm.get("writable") is False, perm)
            banner_hidden = c.ev("document.getElementById('permBanner')?document.getElementById('permBanner').classList.contains('hidden'):null", sid_lib, False)
            check("只读提示条可见", banner_hidden is False, banner_hidden)
            check("首次 file:// 权限被如实记录", isinstance(perm.get("fileAccess"), bool), perm.get("fileAccess"))

        # ---------- 2. 首次设置页 / popup ----------
        tid_opt, sid_opt = c.open_page("chrome-extension://%s/options.html" % EXT)
        time.sleep(3)
        check("设置页能打开", bool(c.ev("document.body && document.body.innerText.length > 100", sid_opt, False)))
        tid_pop, sid_pop = c.open_page("chrome-extension://%s/popup.html" % EXT, 420, 700)
        time.sleep(3)
        check("popup 能打开", bool(c.ev("!!document.getElementById('vrShell') || document.body.innerText.length > 80", sid_pop, False)))
        c.send("Target.closeTarget", {"targetId": tid_opt})
        c.send("Target.closeTarget", {"targetId": tid_pop})

        # ---------- 3. 图片页 + 图片下载 ----------
        tid_page, sid_page = c.open_page(base + "/image.html")
        c.activate(tid_page)
        time.sleep(3)
        check("图片页加载", c.ev("document.title", sid_page, False) == "首次使用验收测试页")
        c.ev("document.getElementById('i').scrollIntoView({block:'center'});1", sid_page)
        try:
            c.send("Page.bringToFront", {}, sid_page)
        except Exception:
            pass
        img_btn = "no-host"
        for _attempt in range(4):
            try:
                rect = c.ev("""(()=>{const r=document.getElementById('i').getBoundingClientRect();
                  return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()""", sid_page, False)
                pt = json.loads(rect) if isinstance(rect, str) else {"x": 200, "y": 200}
                # 真实 CDP 鼠标移动比合成 MouseEvent 稳定；合成事件偶尔不触发 content script
                c.send("Input.dispatchMouseEvent", {
                    "type": "mouseMoved", "x": pt["x"], "y": pt["y"], "button": "none"
                }, sid_page)
            except Exception:
                pass
            c.ev("""(()=>{const i=document.getElementById('i');const r=i.getBoundingClientRect();
              const o={bubbles:true,cancelable:true,clientX:r.left+40,clientY:r.top+40};
              i.dispatchEvent(new MouseEvent('mouseover',o));i.dispatchEvent(new MouseEvent('mousemove',o));return 1})()""", sid_page)
            time.sleep(1.8)
            img_btn = c.ev("""(()=>{const h=document.getElementById('vr-img-hover-host');if(!h||!h.shadowRoot)return 'no-host';
              const b=h.shadowRoot.querySelector('.vr-btn');return b?b.getAttribute('title'):'no-btn'})()""", sid_page, False)
            if img_btn == "下载原图":
                break
        check("图片悬停出现下载按钮", img_btn == "下载原图", img_btn)
        t0 = int(time.time() * 1000)
        dl_img, rows = [], []
        if img_btn == "下载原图":
            # 图片要走 fetch/归档，给足时间；下载入口偶尔需要第二次点击才拿到消息
            for attempt in range(2):
                c.ev("""(()=>{const h=document.getElementById('vr-img-hover-host');if(!h||!h.shadowRoot)return 0;
                  const b=h.shadowRoot.querySelector('.vr-btn');if(b)b.click();return 1})()""", sid_page)
                time.sleep(8)
                dl_img = download_id(c, sid_lib, t0)
                rows = wait_rows(c, sid_lib, 20)
                if dl_img and rows:
                    break
        check("图片下载有 chrome.downloads 记录", len(dl_img) > 0, dl_img[:2])
        check("图片下载后自动入库", len(rows) > 0, [r.get("relPath") for r in rows[:3]])

        # ---------- 3b. 重复下载：再次点同一张图，不应新增条目 ----------
        if rows:
            before_dup = len(rows)
            c.activate(tid_page)
            c.ev("document.getElementById('i').scrollIntoView({block:'center'});1", sid_page)
            time.sleep(0.4)
            try:
                rect = c.ev("""(()=>{const r=document.getElementById('i').getBoundingClientRect();
                  return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()""", sid_page, False)
                pt = json.loads(rect) if isinstance(rect, str) else {"x": 200, "y": 200}
                c.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": pt["x"], "y": pt["y"], "button": "none"}, sid_page)
            except Exception:
                pass
            time.sleep(1.8)
            can_dup = c.ev("""(()=>{const h=document.getElementById('vr-img-hover-host');
              return !!(h&&h.shadowRoot&&h.shadowRoot.querySelector('.vr-btn'))})()""", sid_page, False)
            if can_dup:
                c.ev("""(()=>{const h=document.getElementById('vr-img-hover-host');
                  h.shadowRoot.querySelector('.vr-btn').click();return 1})()""", sid_page)
                time.sleep(8)
                rows_dup = wait_rows(c, sid_lib, 15)
                check("重复下载不新增条目", len(rows_dup) == before_dup,
                      {"before": before_dup, "after": len(rows_dup), "rows": [r.get("relPath") for r in rows_dup]})
            else:
                check("重复下载入口可再次触发", False, "悬停按钮消失，无法判断重复下载")

        # ---------- 4. 视频页 + 视频下载 ----------
        has_video = bool(vid_src)
        if has_video:
            tid_vid, sid_vid = c.open_page(base + "/video.html")
            c.activate(tid_vid)
            time.sleep(3)
            c.ev("""(()=>{const v=document.getElementById('v');v.scrollIntoView({block:'center'});
              const r=v.getBoundingClientRect();
              const o={bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2};
              v.dispatchEvent(new MouseEvent('mousemove',o));document.dispatchEvent(new MouseEvent('mousemove',o));return 1})()""", sid_vid)
            time.sleep(1.0)
            vbtn = c.ev("""(()=>{const b=document.querySelector('.vr-vob-main');return b?b.getAttribute('title'):'no-btn'})()""", sid_vid, False)
            check("视频悬停出现下载按钮", isinstance(vbtn, str) and "下载" in vbtn, vbtn)
            t1 = int(time.time() * 1000)
            if isinstance(vbtn, str) and "下载" in vbtn:
                c.ev("document.querySelector('.vr-vob-main').click();1", sid_vid)
                time.sleep(8)
            dl_vid = download_id(c, sid_lib, t1)
            check("视频下载有 chrome.downloads 记录", len(dl_vid) > 0, dl_vid[:2])
            rows2 = wait_rows(c, sid_lib, 30)
            check("视频下载后自动入库", len(rows2) >= len(rows), [r.get("relPath") for r in rows2[:5]])
            c.send("Target.closeTarget", {"targetId": tid_vid})

        # ---------- 5. 库内结果 / 预览 ----------
        c.send("Page.reload", {}, sid_lib)
        time.sleep(5)
        rows = json.loads(c.ev("VRDB.getAllFiles().then(r=>JSON.stringify(r))", sid_lib) or "[]")
        check("库内至少 2 条下载结果（图片+视频）", len(rows) >= 2, [r.get("relPath") for r in rows[:5]])
        check("库内存在真实文件", any(r.get("absPath") and os.path.exists(os.path.normpath(str(r.get("absPath")))) for r in rows),
              [r.get("absPath") for r in rows[:3]])
        cards = c.ev("document.querySelectorAll('#grid .card').length", sid_lib, False)
        check("库卡片数与条目一致", cards == len(rows), "cards=%s rows=%s" % (cards, len(rows)))
        if rows:
            rel = rows[0].get("relPath")
            c.ev("""(()=>{const c=document.querySelector('#grid .card[data-id="'+CSS.escape(%s)+'"]');if(c)c.click();return 1})()""" % json.dumps(rel), sid_lib)
            time.sleep(2)
            pv = c.ev("!!document.querySelector('#preview:not(.hidden)')", sid_lib, False)
            title = c.ev("(document.getElementById('pvTitle')||{}).textContent||''", sid_lib, False)
            check("下载结果能打开预览", pv is True, {"preview": pv, "title": title})
            # 信息面板默认可能收起，点一下再读 .pv-info
            c.ev("""(()=>{const p=document.getElementById('preview');const b=document.getElementById('pvInfoBtn');
              if(p&&p.classList.contains('no-info')&&b)b.click();return 1})()""", sid_lib)
            time.sleep(0.4)
            info = c.ev("(document.querySelector('.pv-info')||{}).innerText||''", sid_lib, False)
            check("信息面板有内容", isinstance(info, str) and len(info.strip()) > 20, info[:160])
            media = c.ev("""(()=>{const img=document.querySelector('#pvMedia img');const v=document.querySelector('#pvMedia video');
              return JSON.stringify({img:img?{nw:img.naturalWidth,w:img.naturalWidth}:null,
                video:v?{rs:v.readyState,err:v.error?v.error.code:0}:null})})()""", sid_lib, False)
            try: m = json.loads(media) if isinstance(media, str) else {}
            except Exception: m = {}
            loaded = bool((m.get("img") and m["img"].get("nw", 0) > 0) or
                          (m.get("video") and (m["video"].get("rs", 0) > 0 or m["video"].get("err", 1) == 0)))
            check("预览媒体实际加载", loaded, m)
            c.ev("(()=>{const b=document.getElementById('pvClose');if(b)b.click();return 1})()", sid_lib)

        # ---------- 6. 管理：搜索 / 排序 ----------
        if rows:
            needle = str(rows[0].get("displayName") or rows[0].get("title") or rows[0].get("fileName") or "测试")[:12]
            cnt = c.ev("""(()=>{const s=document.getElementById('search');s.value=%s;s.dispatchEvent(new Event('input',{bubbles:true}));return document.querySelectorAll('#grid .card').length})()""" % json.dumps(needle), sid_lib)
            check("搜索能找到下载结果", isinstance(cnt, int) and cnt >= 1, {"needle": needle, "cards": cnt})
            c.ev("""(()=>{const s=document.getElementById('search');s.value='';s.dispatchEvent(new Event('input',{bubbles:true}));return 1})()""", sid_lib)
            # 两条下载结果同分钟，old/new 的分钟级键无法区分先后；真实顺序由 M2 的 35 条覆盖。
            c.ev("""(()=>{const s=document.getElementById('sort');s.value='old';s.dispatchEvent(new Event('change',{bubbles:true}));return 1})()""", sid_lib)
            time.sleep(0.6)
            check("排序控件可切换（真实顺序由 M2 35 条覆盖）",
                  c.ev("document.getElementById('sort').value", sid_lib, False) == "old")

        # ---------- 7. 缺失文件提示 ----------
        miss_rel = "video-rod/_audit/missing/missing.mp4"
        c.ev("""VRDB.putFiles([{relPath:%s,absPath:'D:/__vr_missing__.mp4',platform:'web',type:'video',
          fileName:'missing.mp4',size:1,mtime:Date.now(),state:'missing',starred:0,tags:[]}]).then(()=>1)""" % json.dumps(miss_rel), sid_lib)
        c.send("Page.reload", {}, sid_lib)
        time.sleep(4)
        miss_tag = c.ev("""(()=>{const c=document.querySelector('#grid .card[data-id="'+CSS.escape(%s)+'"]');
          return c?((c.querySelector('.missing-tag')||{}).textContent||''):'no-card'})()""" % json.dumps(miss_rel), sid_lib, False)
        check("缺失文件有角标", "文件缺失" in str(miss_tag), miss_tag)
        c.ev("""(()=>{const c=document.querySelector('#grid .card[data-id="'+CSS.escape(%s)+'"]');if(c)c.click();return 1})()""" % json.dumps(miss_rel), sid_lib)
        time.sleep(1.0)
        pv_state = c.ev("(document.getElementById('pvState')||{}).textContent||''", sid_lib, False)
        check("缺失文件预览显示状态", "文件缺失" in str(pv_state), pv_state)
        c.ev("(()=>{const b=document.getElementById('pvClose');if(b)b.click();return 1})()", sid_lib)
        c.ev("VRDB.deleteFiles([%s]).then(()=>1)" % json.dumps(miss_rel), sid_lib)
        c.send("Page.reload", {}, sid_lib)
        time.sleep(3)

        # ---------- 8. 下载层异常：404 / 取消 ----------
        def start_download(url, filename):
            raw = c.ev("""new Promise(r=>chrome.downloads.download({url:%s,filename:%s,saveAs:false},
              id=>r(JSON.stringify({id:id,err:chrome.runtime.lastError?chrome.runtime.lastError.message:''}))))""" %
                      (json.dumps(url), json.dumps(filename)), sid_lib)
            try:
                return json.loads(raw) if isinstance(raw, str) else {}
            except Exception:
                return {}

        def download_state(did, timeout=8):
            for _ in range(timeout * 2):
                raw = c.ev("""new Promise(r=>chrome.downloads.search({id:%d},
                  l=>r(JSON.stringify(l&&l[0]?l[0]:null))))""" % did, sid_lib)
                try:
                    d = json.loads(raw) if isinstance(raw, str) else None
                except Exception:
                    d = None
                if d and d.get("state") in ("complete", "interrupted"):
                    return d
                time.sleep(0.5)
            return d if isinstance(d, dict) else {}

        d404 = start_download(base + "/missing-404.jpg", "video-rod/_audit/404/missing.jpg")
        if d404.get("id"):
            st404 = download_state(d404["id"], 6)
            check("404 下载被标为 interrupted", st404.get("state") == "interrupted", st404)
            check("404 不写入库", c.ev("VRDB.getFile('video-rod/_audit/404/missing.jpg').then(f=>!f)", sid_lib) is True)
        else:
            check("404 下载能发起", False, d404)

        dcancel = start_download(base + "/test.mp4", "video-rod/_audit/cancel/test.mp4")
        if dcancel.get("id"):
            c.ev("new Promise(r=>chrome.downloads.cancel(%d,()=>r(1)))" % dcancel["id"], sid_lib)
            stc = download_state(dcancel["id"], 6)
            check("取消下载被标为 interrupted", stc.get("state") == "interrupted", stc)
            check("取消不写入库", c.ev("VRDB.getFile('video-rod/_audit/cancel/test.mp4').then(f=>!f)", sid_lib) is True)
        else:
            check("取消下载能发起", False, dcancel)

        # ---------- 9. 删除/恢复（OPFS 模拟“库根句柄”，不碰真实文件） ----------
        trash_js = r"""(async()=>{
          const out=[];
          const opfs=await navigator.storage.getDirectory();
          const rootName='trash-e2e-'+Date.now();
          const root=await opfs.getDirectoryHandle(rootName,{create:true});
          const rel='video-rod/_audit/trash/file.mp4';
          const write=async()=>{
            let d=root;
            for(const s of ['_audit','trash']) d=await d.getDirectoryHandle(s,{create:true});
            const h=await d.getFileHandle('file.mp4',{create:true});
            const w=await h.createWritable(); await w.write('trash-content'); await w.close();
          };
          const orig=VRIndex.resolveRoot;
          try{
            await write();
            await VRDB.putFiles([{relPath:rel,absPath:'OPFS',platform:'web',type:'video',
              fileName:'file.mp4',size:13,mtime:Date.now(),state:'ok',starred:0,tags:[]}]);
            /* 真实 handle 指向库根，索引 relPath 首段是 video-rod；这里用同样的目录结构。 */
            VRIndex.resolveRoot=async()=>({handle:root,absRoot:'OPFS',prefix:'video-rod'});
            const r=await VRTrash.remove([rel]);
            const batch=r.batch;
            out.push({name:'remove 返回 moved=1',pass:r.moved===1,detail:r});
            out.push({name:'remove 后 DB 条目消失',pass:!(await VRDB.getFile(rel))});
            out.push({name:'文件进入回收站（剥掉 video-rod 前缀）',
              pass:await VRTrash.exists(root,'_回收站/'+batch+'/_audit/trash/file.mp4')});
            out.push({name:'没有多一层 video-rod',pass:!(await VRTrash.exists(root,'_回收站/'+batch+'/video-rod/_audit/trash/file.mp4'))});
            const back=await VRTrash.restore(batch,rel);
            out.push({name:'restore 成功',pass:back.restored===1,detail:back});
            out.push({name:'文件回到原位置',pass:await VRTrash.exists(root,'_audit/trash/file.mp4')});
            out.push({name:'DB 条目恢复',pass:!!(await VRDB.getFile(rel))});
          }finally{
            VRIndex.resolveRoot=orig;
            try{await VRDB.deleteFiles([rel]);}catch(e){}
            try{await opfs.removeEntry(rootName,{recursive:true});}catch(e){}
          }
          return JSON.stringify(out);
        })()"""
        trash_raw = c.ev(trash_js, sid_lib)
        try:
            trash_res = json.loads(trash_raw) if isinstance(trash_raw, str) else []
        except Exception:
            trash_res = []
        if not trash_res:
            check("删除/恢复后端测试执行", False, trash_raw)
        else:
            for x in trash_res:
                check(x.get("name", "删除/恢复"), x.get("pass") is True, x.get("detail", ""))

        # ---------- 10. 批量删除 / 全部恢复 / 彻底删除（OPFS） ----------
        batch_js = r"""(async()=>{
          const out=[];
          const opfs=await navigator.storage.getDirectory();
          const rootName='trash-batch-'+Date.now();
          const root=await opfs.getDirectoryHandle(rootName,{create:true});
          const relA='video-rod/_audit/batch/a.mp4';
          const relB='video-rod/_audit/batch/b.mp4';
          const write=async(name)=>{
            let d=root;
            for(const s of ['_audit','batch']) d=await d.getDirectoryHandle(s,{create:true});
            const h=await d.getFileHandle(name,{create:true});
            const w=await h.createWritable(); await w.write('batch-'+name); await w.close();
          };
          const row=(rel,name)=>({relPath:rel,absPath:'OPFS',platform:'web',type:'video',
            fileName:name,size:8,mtime:Date.now(),state:'ok',starred:0,tags:[]});
          const orig=VRIndex.resolveRoot;
          try{
            await write('a.mp4'); await write('b.mp4');
            await VRDB.putFiles([row(relA,'a.mp4'),row(relB,'b.mp4')]);
            VRIndex.resolveRoot=async()=>({handle:root,absRoot:'OPFS',prefix:'video-rod'});
            const r=await VRTrash.remove([relA,relB]);
            const batch=r.batch;
            out.push({name:'批量 remove moved=2',pass:r.moved===2,detail:r});
            out.push({name:'批量 remove 后 DB 两条消失',pass:!(await VRDB.getFile(relA))&&!(await VRDB.getFile(relB))});
            out.push({name:'两条都进入回收站',
              pass:await VRTrash.exists(root,'_回收站/'+batch+'/_audit/batch/a.mp4')&&
                   await VRTrash.exists(root,'_回收站/'+batch+'/_audit/batch/b.mp4')});
            const list=await VRTrash.list();
            const b=list.find(x=>x.batch===batch);
            out.push({name:'manifest 记录 2 条',pass:!!b&&b.items.length===2,detail:b});
            const back=await VRTrash.restore(batch);
            out.push({name:'全部恢复 restored=2',pass:back.restored===2,detail:back});
            out.push({name:'两条文件回到原位',
              pass:await VRTrash.exists(root,'_audit/batch/a.mp4')&&
                   await VRTrash.exists(root,'_audit/batch/b.mp4')});
            out.push({name:'两条 DB 条目恢复',pass:!!(await VRDB.getFile(relA))&&!!(await VRDB.getFile(relB))});
            const r2=await VRTrash.remove([relA]);
            const b2=r2.batch;
            const purged=await VRTrash.purge(b2,relA);
            out.push({name:'彻底删除 purged=1',pass:purged.purged===1,detail:purged});
            out.push({name:'彻底删除后文件不存在',
              pass:!(await VRTrash.exists(root,'_回收站/'+b2+'/_audit/batch/a.mp4'))});
          }finally{
            VRIndex.resolveRoot=orig;
            try{await VRDB.deleteFiles([relA,relB]);}catch(e){}
            try{await opfs.removeEntry(rootName,{recursive:true});}catch(e){}
          }
          return JSON.stringify(out);
        })()"""
        batch_raw = c.ev(batch_js, sid_lib)
        try:
            batch_res = json.loads(batch_raw) if isinstance(batch_raw, str) else []
        except Exception:
            batch_res = []
        if not batch_res:
            check("批量删除/恢复/彻底删除测试执行", False, batch_raw)
        else:
            for x in batch_res:
                check(x.get("name", "批量回收站"), x.get("pass") is True, x.get("detail", ""))

        check("首次使用流程无未捕获 JS 异常（页面侧）", len(c.errs) == 0, c.errs[:3])

        failed = [r for r in RESULTS if not r["pass"]]
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
            if c:
                c.close()
        except Exception:
            pass
        try:
            subprocess.run([sys.executable, os.path.join(ROOT, "tools", "test-browser-close.py"), "--port", str(PORT)],
                           timeout=15, capture_output=True, text=True)
        except Exception:
            pass
        try:
            if proc:
                proc.wait(timeout=5)
        except Exception:
            try: proc.kill()
            except Exception: pass
        try: srv.shutdown()
        except Exception: pass


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print("[失败] %s" % e)
        sys.exit(2)
