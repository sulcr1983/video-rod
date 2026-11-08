# -*- coding: utf-8 -*-
"""qa-xhs-author-e2e.py — M-1/M-2/M-2b/M-3 真实接线验证（2026-11-08 审计修正版）

全程 127.0.0.1 本地 fixture，不访问小红书真实站点（零风控面，符合苏哥指令）。
验证真实消息链路而非直调内部函数：
  popup 通道：fixture 详情页（state 权威身份）→ popup 嗅探 → 点 #DownFile
    → vrRunBatchSw → vrApplyXhsAuthor(M-2) → vrXhsScan 显式 tabId(M-1)
    → vrReplanWithXhsAuthor → 旁听 vrLib.saveOne relPath。
  面板通道：页面 content world executeScript 发 vrImg.batch
    → SW vrImgBatch(M-2b state 覆盖) → vrImgDownload → VRDB 记录。

断言：
  N1 popup 嗅探到笔记图
  N2 saveOne relPath 含权威作者「测试作者甲(@…)」（3/3）
  N4 批量汇总如实报数
  N5 新命名去重键生效（再点被「都下载过了」拦）
  N3b 面板通道：VRDB 新条目含作者乙目录 + 笔记标题文件名（不再页面标题）
  N6 非详情页回退：普通页 relPath 不含 state 作者
  N7 图片面板档位 UI：「全部」「未知」按钮存在，all 计数=页面图数（M-3）
测后自动清理（库记录/下载记录/工作区文件/去重记录）。
用法：python tools/qa-xhs-author-e2e.py --port 9490
（前置：隔离实例已起且加载本代码——python tools/e2e-all.py --isolated --keep-isolated --only e2e-sw ...）
"""
import argparse
import base64
import json
import os
import re
import threading
import time
import urllib.request
import http.server

from websocket import create_connection

DL_WORK = r"D:\test\download\work\dl\isolated"
NOTE1 = "a1b2c3d4e5f60718293a4b5c"
NOTE2 = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"
AUTHOR1 = "测试作者甲"
RED1 = "vrtest9876543210abcdef"
TITLE1 = "XXYY测试笔记标题"
AUTHOR2 = "测试作者乙"
RED2 = "vrtest2233445566"
TITLE2 = "QQWW第二篇笔记"
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
# 面板/扫描过滤按 naturalWidth>=100（MIN_SIZE），1x1 图进不了面板 count →
# 用 PIL 现生成 300x300 PNG（2026-11-08 首跑 NO-SH 的教训）
try:
    from PIL import Image
    import io as _io
    _buf = _io.BytesIO()
    Image.new("RGB", (300, 300), (90, 140, 200)).save(_buf, format="PNG")
    PNG = _buf.getvalue()
except Exception:
    pass


def make_note(origin, note_id, author, red, title, nums):
    note_body = {
        "title": title,
        "desc": "qa desc",
        "imageList": [
            {
                "urlDefault": "%s/note%d.png" % (origin, n),
                "infoList": [{"imageScene": "WB_DFT", "url": "%s/note%d.png" % (origin, n)}],
            }
            for n in nums
        ],
        "user": {"nickname": author, "redId": red},
    }
    return {"note": {"currentNoteId": note_id, "noteDetailMap": {note_id: {"note": note_body}}}}


def detail_html(origin, note_id, author, red, title, nums):
    st = json.dumps(make_note(origin, note_id, author, red, title, nums), ensure_ascii=False)
    imgs = "".join('<img src="/note%d.png" width="300">' % n for n in nums)
    # 嗅探载体用 <video>（media 类规则默认放行）：本地 fixture 无法伪造
    # sns-*.xhscdn.com 域名，png 直连不会进 popup 嗅探列表——那是产品的域名
    # 嗅探规则，不是 M-2 缺陷。命名链路（saveOne→buildRelDir）与媒体类型无关。
    return ("<!doctype html><html><head><meta charset='utf-8'>"
            "<title>页面标题占位——断言里不许出现我</title>"
            "<script>window.__INITIAL_STATE__=%s;</script></head><body>"
            "<video src='%s/clip_%s.mp4' controls muted loop width='480'></video>%s</body></html>") % (st, origin, note_id[:8], imgs)


PLAIN = ("<!doctype html><html><head><meta charset='utf-8'><title>普通页</title></head>"
         "<body><video src='/clip_plain.mp4' controls muted loop width='480'></video></body></html>")


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        origin = "http://127.0.0.1:%d" % self.server.server_address[1]
        FAKE_MP4 = (b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 2048)
        if re.match(r"^/clip_[0-9a-f]+\.mp4$|^/clip_plain\.mp4$", path):
            body, ctype = FAKE_MP4, "video/mp4"
        else:
            m = re.match(r"^/(?:explore|discovery/item)/([0-9a-f]{12,32})$", path)
            if m and m.group(1) == NOTE1:
                body, ctype = detail_html(origin, NOTE1, AUTHOR1, RED1, TITLE1, [1, 2, 3]).encode("utf-8"), "text/html; charset=utf-8"
            elif m and m.group(1) == NOTE2:
                body, ctype = detail_html(origin, NOTE2, AUTHOR2, RED2, TITLE2, [5, 6, 7]).encode("utf-8"), "text/html; charset=utf-8"
            elif path == "/plain.html":
                body, ctype = PLAIN.encode("utf-8"), "text/html; charset=utf-8"
            elif re.match(r"^/note\d+\.png$", path):
                body, ctype = PNG, "image/png"
            else:
                self.send_response(404)
                self.end_headers()
                return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


class Cdp:
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=10))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        self.mid = 0

    def send(self, m, p=None, sid=None):
        self.mid += 1
        msg = {"id": self.mid, "method": m, "params": p or {}}
        if sid:
            msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.mid:
                if r.get("error"):
                    raise RuntimeError(str(r["error"])[:200])
                return r.get("result", {})

    def attach(self, tid, w=0, h=0):
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        try:
            self.send("Page.enable", {}, sid)
            if w and h:
                self.send("Emulation.setDeviceMetricsOverride",
                          {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False}, sid)
        except Exception:
            pass
        return sid

    def ev(self, expr, sid):
        r = self.send("Runtime.evaluate",
                      {"expression": expr, "returnByValue": True, "awaitPromise": True}, sid)
        return r.get("result", {}).get("value")

    def targets(self):
        return self.send("Target.getTargets", {})["targetInfos"]


RESULTS = []


def ck(name, got, want):
    ok = got == want
    RESULTS.append((name, ok, got, want))
    print(("PASS" if ok else "FAIL"), name, "| got=", str(got)[:200], "| want=", str(want)[:120])


def wait_tip(c, sid, kw, secs=60):
    t = ""
    for _ in range(secs):
        time.sleep(0.8)
        t = c.ev("""(()=>{const a=(document.getElementById('Tips')||{}).textContent||'';
                         const b=(document.getElementById('TipsFixed')||{}).textContent||'';
                         return a + '||' + b;})()""", sid) or ""
        if kw in t:
            return t
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9490)
    a = ap.parse_args()
    c = Cdp(a.port)

    # 定位本扩展：用我们自己 manifest 的 SW 路径做完整匹配。
    # 教训（2026-11-08 两次踩坑）：浏览器内置扩展的 SW 也叫 background.js，
    # 宽松匹配会抓到 nkeimhog…/admccjkm… 这些内置组件。
    _mf = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "manifest.json"), encoding="utf-8"))
    sw_path = (_mf.get("background") or {}).get("service_worker") or "js/background.js"
    pat = re.compile(r"chrome-extension://([a-p]{32})/" + re.escape(sw_path) + r"$")
    ext = None
    sw_tid = None
    for t in c.targets():
        u = t.get("url") or ""
        m = pat.search(u)
        if t["type"] == "service_worker" and m:
            ext = m.group(1)
            sw_tid = t["targetId"]
            break
    assert ext, "video-rod SW 未找到（先起隔离实例）"

    sw_sid = c.attach(sw_tid)
    print("ext=", ext[:8], "SW ok")

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    print("fixture 端口:", port)

    # ==================== 第一页：详情页（popup 通道 N1/N2/N4/N5 + 面板 N7） ====================
    tid1 = c.send("Target.createTarget", {"url": "http://127.0.0.1:%d/explore/%s" % (port, NOTE1)})["targetId"]
    sid1 = c.attach(tid1, 1280, 800)
    time.sleep(6)
    pg = c.ev("""JSON.stringify({rs:document.readyState,title:document.title,
        imgs:document.images.length, host:!!document.getElementById('vr-img-panel-host')})""", sid1)
    print("页面侧:", pg)
    tb = c.ev("""(async()=>{
      const tabs=await new Promise(r=>chrome.tabs.query({},x=>{void chrome.runtime.lastError;r(x||[])}));
      return JSON.stringify(tabs.map(t=>({id:t.id,u:String(t.url||'').slice(0,58)})));})()""", sw_sid)
    print("SW tabs:", str(tb)[:400])

    tab1 = c.ev("""(async()=>{
      const tabs = await new Promise(r=>chrome.tabs.query({}, x=>{void chrome.runtime.lastError; r(x||[])}));
      const hits = tabs.filter(t=>(t.url||'').indexOf(%s)>=0).sort((x,y)=>x.id-y.id);
      return hits.length ? hits[hits.length-1].id : 0;})()""" % json.dumps("/explore/%s" % NOTE1), sw_sid)

    tid_pop = c.send("Target.createTarget",
                     {"url": "chrome-extension://%s/popup.html?tabId=%d" % (ext, tab1)})["targetId"]
    sid_pop = c.attach(tid_pop, 400, 620)
    time.sleep(4)
    rows = c.ev("document.querySelectorAll('#mediaList .panel, #allMediaList .panel').length", sid_pop)
    if not isinstance(rows, int) or rows < 3:
        dbg = c.ev("""(async()=>{
          const o=await chrome.storage.session.get('MediaData');
          const md=o.MediaData||{};
          return JSON.stringify({keys:Object.keys(md).map(k=>({t:k,n:Object.keys(md[k]||{}).length}))});})()"""
          , sw_sid)
        print("N1 调试 tab1=", tab1, "| popupURL=",
              c.send("Target.getTargetInfo", {"targetId": tid_pop})["targetInfo"]["url"][:70],
              "| MediaData:", dbg)
    ck("N1 popup 嗅探到媒体（video 载体，本地 png 不进嗅探属产品规则）",
       isinstance(rows, int) and rows >= 1, True)

    # 消息探针（旁听 saveOne，不干预链路）。**必须幂等单层**：双层包装会把
    # 同一条消息 push 两次——2026-11-08 实测这个探针 bug 伪造出「发了两次」的假象。
    PROBE = """(()=>{
      if (window.__vrProbed) { window.__vrSaveMsgs = window.__vrSaveMsgs || []; return 2; }
      window.__vrSaveMsgs = [];
      const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
      const wrap = function (m, cb) {
        try { if (m && m.Message === 'vrLib.saveOne') window.__vrSaveMsgs.push({url:m.url, relPath:m.relPath}); } catch(e){}
        return orig(m, cb);
      };
      chrome.runtime.sendMessage = wrap;
      window.__vrProbed = 1;
      return 1;})()"""
    c.ev(PROBE, sid_pop)
    # 清旧去重记录（防复用 profile 干扰）——清记录不重建 DOM，探针不丢
    c.ev("(()=>{const b=document.getElementById('vrClearDownloaded'); if(b) b.click(); return 1})()", sid_pop)
    time.sleep(1.0)
    c.ev(PROBE, sid_pop)

    c.ev("(()=>{const b=document.getElementById('DownFile'); if(b) b.click(); return 1})()", sid_pop)
    tip1 = wait_tip(c, sid_pop, "批量完成", 60)
    print("批量 toast:", repr(tip1))
    msgs = c.ev("JSON.stringify(window.__vrSaveMsgs||[])", sid_pop)
    rels = [m.get("relPath", "") for m in (json.loads(msgs) if isinstance(msgs, str) else [])]
    print("relPaths:", rels)
    n_msgs = len(rels)
    ck("N0 单批次只发 1 条 saveOne（探针幂等）", n_msgs, 1)
    auth_ok = sum(1 for r in rels if AUTHOR1 + "(@" + RED1 in r)
    ck("N2 saveOne relPath 含权威作者", auth_ok, n_msgs)
    bare_wrong = sum(1 for r in rels if "www.xiaohongshu.com" in r or "127.0.0.1/" == r[:9])
    ck("N2b relPath 不再是域名/裸名兜底", bare_wrong, 0)
    ck("N4 汇总如实报数（出现「批量完成：N」）", bool(re.search(r"批量完成：\d", tip1)), True)

    # N5 再点批量：新命名去重键必须拦住 = saveOne 条数不增
    # （文案断言不可靠：TipsFixed 是滞留消息，读数会被第一批旧文案污染）
    dl0 = c.ev("""(async()=>{
      const o = await chrome.storage.local.get('vrDownloaded');
      const tbl = o.vrDownloaded || {};
      return JSON.stringify(Object.values(tbl).map(x=>String(x.p||'').slice(0,110)));})()""", sid_pop)
    print("N5 点击前 去重表:", str(dl0)[:300])
    c.ev("(()=>{const b=document.getElementById('DownFile'); if(b) b.click(); return 1})()", sid_pop)
    time.sleep(3.0)
    msgs5 = c.ev("JSON.stringify(window.__vrSaveMsgs||[])", sid_pop)
    n5 = len(json.loads(msgs5)) if isinstance(msgs5, str) else -1
    tip2 = c.ev("""(()=>{const a=(document.getElementById('Tips')||{}).textContent||'';
                     return a;})()""", sid_pop) or ""
    print("N5 点击后 saveOne 数=", n5, " Tips=", repr(tip2)[:120])
    ck("N5 迁移后的去重键生效（再点不重发）", n5, n_msgs)

    # ==================== N7 图片面板档位 UI（M-3，shadow DOM） ====================
    print("PNG 字节数:", len(PNG), "（应约 500-1000B 的 300x300，若 68B 则 PIL 未生效）")
    # 隔离 profile 的 imgPanel 默认 false（产品默认关）——先开设置再刷新页面
    c.ev("""(async()=>{
      const o = await chrome.storage.local.get('vrLibSettings');
      const s = Object.assign({}, o.vrLibSettings || {}, {imgPanel: true});
      await chrome.storage.local.set({vrLibSettings: s});
      return 1;})()""", sw_sid)
    c.send("Page.reload", {"ignoreCache": True}, sid1)
    time.sleep(5)
    pg2 = c.ev("""JSON.stringify({host:!!document.getElementById('vr-img-panel-host')})""", sid1)
    print("刷新后面板 host:", pg2)
    # 浮标用 pointerdown/up 序列开窗（.click() 不触发 pointer 事件，2026-11-08 实测）
    c.ev("""(()=>{
      const host=document.getElementById('vr-img-panel-host');
      const sh=host&&host.shadowRoot; const f=sh&&sh.querySelector('.vr-float');
      if(!f) return 0;
      const r=f.getBoundingClientRect();
      const o={bubbles:true, button:0, pointerId:7, pointerType:'mouse',
               clientX:r.left+5, clientY:r.top+5};
      f.dispatchEvent(new PointerEvent('pointerdown', o));
      f.dispatchEvent(new PointerEvent('pointerup', o));
      return 1;})()""", sid1)
    time.sleep(2)
    tier = c.ev("""(()=>{
      const host=document.getElementById('vr-img-panel-host');
      const sh=host&&host.shadowRoot; if(!sh) return 'NO-SH';
      const btns={};
      sh.querySelectorAll('.vr-tier').forEach(b=>{
        btns[b.getAttribute('data-tier')]=(b.querySelector('.c')||{}).textContent||'';});
      const on=[...sh.querySelectorAll('.vr-tier.on')].map(b=>b.getAttribute('data-tier'));
      const fn=(sh.querySelector('.vr-float .n')||{}).textContent||'';
      const domImgs=document.images.length;
      return JSON.stringify({keys:Object.keys(btns).sort(), all:btns['all']||'', on:on, floatNum:fn, domImgs:domImgs});})()""", sid1)
    print("面板档位:", tier)
    # ISOLATED world 深挖：tierCounts 实算 + 面板打开态（MAIN 世界拿不到 VRImageUtil）
    isl = c.ev("""(async()=>{
      const tabs = await new Promise(r=>chrome.tabs.query({}, x=>{void chrome.runtime.lastError; r(x||[])}));
      const hit = tabs.filter(t=>(t.url||'').indexOf(%s)>=0).pop();
      if(!hit) return 'NO-TAB';
      const rs = await chrome.scripting.executeScript({target:{tabId:hit.id}, func: ()=>{
        try {
          const U = self.VRImageUtil;
          const host=document.getElementById('vr-img-panel-host');
          const sh=host&&host.shadowRoot;
          const panel = sh && sh.querySelector('.vr-panel');
          const cells = sh ? sh.querySelectorAll('.vr-cell').length : -1;
          const c = U ? U.tierCounts(U.scanImages(document,{minWidth:100,minHeight:100,minShow:48,dedupe:true})) : null;
          return JSON.stringify({hasU:!!U, c:c, cells:cells, panelOn:panel?panel.className:'no-panel'});
        } catch(e){ return 'ERR:'+String(e).slice(0,100); }
      }});
      return rs && rs[0] && rs[0].result;})()""" % json.dumps("/explore/%s" % NOTE1), sw_sid)
    print("ISOLATED 深挖:", str(isl)[:400])
    try:
        tj = json.loads(tier) if isinstance(tier, str) else {}
        print("floatNum=", tj.get("floatNum"), "domImgs=", tj.get("domImgs"))
        ck("N7a 含 all/unknown 按钮", ("all" in tj.get("keys", [])) and ("unknown" in tj.get("keys", [])), True)
        ck("N7b all 计数=3", tj.get("all"), "3")
        ck("N7c 默认选中 all", tj.get("on"), ["all"])
    except Exception as e:
        ck("N7 面板解析", "%s|%s" % (str(e)[:60], tier)[:120], "no-exception")

    # ==================== 第二页：面板通道 vrImg.batch（M-2b，content world） ====================
    tid2 = c.send("Target.createTarget", {"url": "http://127.0.0.1:%d/explore/%s" % (port, NOTE2)})["targetId"]
    sid2 = c.attach(tid2, 1280, 800)
    time.sleep(5)
    # 用 executeScript 注入页面 ISOLATED world（等同 image-panel 发起方，sender.tab 真实存在）
    send_js = """(()=>{
      const origin=location.origin;
      window.__vrBatchRes=null;
      chrome.runtime.sendMessage({
        Message:'vrImg.batch', action:'vrImg.batch',
        items:[{url:origin+'/note5.png'},{url:origin+'/note6.png'},{url:origin+'/note7.png'}],
        pageUrl:location.href, pageTitle:'页面标题占位', concurrency:2,
        batchId:'qa-'+Date.now()
      }, r=>{ window.__vrBatchRes=r; });
      return 1;})()"""
    c.send("Target.attachToTarget", {"targetId": tid2, "flatten": True}, None)
    # 调试：SW 直调 vrXhsScanInTab 看 state 解析结果（M-2b 的服务端证据）
    tab2id = c.ev("""(async()=>{
      const tabs = await new Promise(r=>chrome.tabs.query({}, x=>{void chrome.runtime.lastError; r(x||[])}));
      const hit = tabs.filter(t=>(t.url||'').indexOf(%s)>=0).sort((a,b)=>a.id-b.id).pop();
      return hit ? hit.id : 0;})()""" % json.dumps("/explore/%s" % NOTE2), sw_sid)
    scan_dbg = c.ev("""(async()=>{
      try { const r = await vrXhsScanInTab(%s, ''); return JSON.stringify(r && {ok:r.ok, author:r.author, title:r.title, reason:r.reason}); }
      catch(e){ return 'ERR:'+String(e).slice(0,120); } })()""" % tab2id, sw_sid)
    print("调试 vrXhsScanInTab:", str(scan_dbg)[:200])
    # SW 侧 executeScript（在页面 ISOLATED world 执行，有 chrome.runtime）
    inj = c.ev("""(async()=>{
      const tabs = await new Promise(r=>chrome.tabs.query({}, x=>{void chrome.runtime.lastError; r(x||[])}));
      const hit = tabs.filter(t=>(t.url||'').indexOf(%s)>=0).sort((a,b)=>a.id-b.id).pop();
      if(!hit) return 'NO-TAB';
      const rs = await chrome.scripting.executeScript({
        target:{tabId:hit.id},
        func: ()=>{ window.__vrBatchRes=null;
          const o=location.origin;
          chrome.runtime.sendMessage({Message:'vrImg.batch',action:'vrImg.batch',
            items:[{url:o+'/note5.png'},{url:o+'/note6.png'},{url:o+'/note7.png'}],
            pageUrl:location.href,pageTitle:'页面标题占位',concurrency:2,batchId:'qa-'+Date.now()},
            r=>{window.__vrBatchRes=r;});
          return 1; } });
      return JSON.stringify(rs);})()""" % json.dumps("/explore/%s" % NOTE2), sw_sid)
    print("注入结果:", str(inj)[:120])
    # 等异步完成，轮询读回
    batch_res = None
    for _ in range(30):
        time.sleep(2)
        rr = c.ev("""(async()=>{
          const tabs = await new Promise(r=>chrome.tabs.query({}, x=>{void chrome.runtime.lastError; r(x||[])}));
          const hit = tabs.filter(t=>(t.url||'').indexOf(%s)>=0).sort((a,b)=>a.id-b.id).pop();
          if(!hit) return 'NO-TAB';
          const rs = await chrome.scripting.executeScript({
            target:{tabId:hit.id}, func: ()=> JSON.stringify(window.__vrBatchRes||null) });
          return rs && rs[0] && rs[0].result;})()""" % json.dumps("/explore/%s" % NOTE2), sw_sid)
        try:
            batch_res = json.loads(rr) if isinstance(rr, str) else None
        except Exception:
            batch_res = None
        if batch_res and batch_res.get("ok") is not None:
            break
    print("vrImg.batch 返回:", json.dumps(batch_res, ensure_ascii=False)[:200] if batch_res else None)

    # VRDB 查作者乙条目（面板通道的落库证据）
    time.sleep(2)
    db2 = c.ev("""(async()=>{
      const rows = await VRDB.getAllFiles();
      const mine = rows.filter(r=>String(r.relPath||'').indexOf(%s)>=0);
      const recent = rows.slice(-15).map(r=>String(r.relPath||'').slice(0,140));
      return JSON.stringify({n:mine.length,
        hasTitle: mine.filter(r=>String(r.relPath||'').indexOf(%s)>=0).length,
        wrongPageTitle: mine.filter(r=>String(r.relPath||'').indexOf('页面标题占位')>=0).length,
        recent: recent,
        sample: mine.slice(0,2).map(r=>String(r.relPath||'').slice(0,140))});})()""" % (json.dumps(AUTHOR2), json.dumps(TITLE2)), sw_sid)
    print("N3b 库证据:", str(db2)[:900])
    try:
        dbj = json.loads(db2) if isinstance(db2, str) else {}
    except Exception:
        dbj = {}
    ck("N3b 面板通道 VRDB 含作者乙条目", dbj.get("n"), 3)
    ck("N3c 文件名用笔记标题（state 覆盖页面标题）", dbj.get("hasTitle"), 3)
    ck("N3d 无一条仍用页面标题", dbj.get("wrongPageTitle"), 0)

    # ==================== N6 非详情页回退 ====================
    tid3 = c.send("Target.createTarget", {"url": "http://127.0.0.1:%d/plain.html" % port})["targetId"]
    sid3 = c.attach(tid3, 1280, 800)
    time.sleep(5)
    tab3 = c.ev("""(async()=>{
      const tabs = await new Promise(r=>chrome.tabs.query({}, x=>{void chrome.runtime.lastError; r(x||[])}));
      const hit = tabs.filter(t=>(t.url||'').indexOf('plain.html')>=0).sort((a,b)=>a.id-b.id).pop();
      return hit ? hit.id : 0;})()""", sw_sid)
    c.send("Target.closeTarget", {"targetId": tid_pop})
    tid_pop3 = c.send("Target.createTarget",
                      {"url": "chrome-extension://%s/popup.html?tabId=%d" % (ext, tab3)})["targetId"]
    sid_pop3 = c.attach(tid_pop3, 400, 620)
    time.sleep(3.5)
    c.ev(PROBE, sid_pop3)
    c.ev("(()=>{const b=document.getElementById('vrClearDownloaded'); if(b) b.click(); return 1})()", sid_pop3)
    time.sleep(1.0)
    c.ev(PROBE, sid_pop3)
    c.ev("(()=>{const b=document.getElementById('DownFile'); if(b) b.click(); return 1})()", sid_pop3)
    tip3 = wait_tip(c, sid_pop3, "批量完成", 40)
    msgs3 = c.ev("JSON.stringify(window.__vrSaveMsgs||[])", sid_pop3)
    rels3 = [m.get("relPath", "") for m in (json.loads(msgs3) if isinstance(msgs3, str) else [])]
    polluted = any(AUTHOR1 in r or AUTHOR2 in r for r in rels3)
    ck("N6 非详情页不混入 state 作者（回退现状）", polluted, False)

    # ==================== 清理 ====================
    c.ev("""(async()=>{
      const rows = await VRDB.getAllFiles();
      const mine = rows.filter(r=>{const s=String(r.relPath||'')+String(r.fileName||'');
        return /测试作者甲|测试作者乙|XXYY测试笔记标题|QQWW第二篇笔记|页面标题占位|qa-|clip_/.test(s);});
      await VRDB.deleteFiles(mine.map(r=>r.relPath));
      const list = await new Promise(r=>chrome.downloads.search({limit:200}, x=>{void chrome.runtime.lastError; r(x||[])}));
      for (const it of list) {
        if (/note[1-9]\\.png|clip_|测试作者|测试笔记|第二篇笔记|qa-/.test(String(it.filename||''))) {
          try { await new Promise(r=>chrome.downloads.removeFile(it.id, ()=>r())); } catch(e){}
          try { await new Promise(r=>chrome.downloads.erase({id: it.id}, ()=>r())); } catch(e){}
        }
      }
      return mine.length;})()""", sw_sid)
    try:
        for f in os.listdir(DL_WORK):
            if re.search(r"note\d\.png|clip_|测试作者|测试笔记|第二篇笔记|页面标题占位", f):
                try:
                    os.remove(os.path.join(DL_WORK, f))
                except OSError:
                    pass
    except OSError:
        pass
    c.ev("(()=>{const b=document.getElementById('vrClearDownloaded'); if(b) b.click(); return 1})()", sid_pop3)
    for t2 in (tid1, tid2, tid3, tid_pop, tid_pop3):
        try:
            c.send("Target.closeTarget", {"targetId": t2})
        except Exception:
            pass
    srv.shutdown()

    n = len(RESULTS)
    p = sum(1 for x in RESULTS if x[1])
    print("\n==== 结果: %d/%d ====" % (p, n))
    for name, ok, got, want in RESULTS:
        if not ok:
            print("  FAIL:", name, "got=", str(got)[:160], "want=", str(want)[:120])
    raise SystemExit(0 if p == n else 1)


if __name__ == "__main__":
    main()
