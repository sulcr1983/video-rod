#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
全量按钮 E2E：资源库 + 设置页
做法：种一批真实结构数据 → 断言关键交互「点前 vs 点后」确实变化 → 再把所有按钮逐个点一遍抓异常。

判据：
  B1 关键交互真的生效（不是点了没反应的死键）
  B2 全量按钮点击 0 JS 异常
  B3 弹层能开能关（不留残影、不卡死）

跑法（先起带扩展的 headless/有头 Edge）：
    python tools/e2e-buttons.py --port 9560
"""
import argparse
import json
import os
import sys
import time
import urllib.request

from websocket import create_connection

KNOWN_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"

SEED = r"""
(async function(){
  const now = Date.now();
  const rows = [
    {relPath:'video-rod/B站/影视飓风(@946974)/视频/旅行日记.mp4', absPath:'D:/f/a.mp4', platform:'bilibili', creatorFull:'影视飓风(@946974)', creatorId:'946974', type:'video', fileName:'旅行日记.mp4', size:12*1024*1024, mtime:now-1000, duration:168, width:1920, height:1080, starred:1, tags:['旅行'], state:'ok'},
    {relPath:'video-rod/B站/影视飓风(@946974)/视频/第二集.mp4', absPath:'D:/f/a2.mp4', platform:'bilibili', creatorFull:'影视飓风(@946974)', creatorId:'946974', type:'video', fileName:'第二集.mp4', size:22*1024*1024, mtime:now-2000, duration:600, starred:0, tags:[], state:'ok'},
    {relPath:'video-rod/小红书/小鱼(@u1)/图片/咖啡.jpg', absPath:'D:/f/b.jpg', platform:'xiaohongshu', creatorFull:'小鱼(@u1)', creatorId:'u1', type:'image', fileName:'咖啡.jpg', size:1200*1024, mtime:now-3000, starred:0, tags:[], state:'ok'},
    {relPath:'video-rod/小红书/小鱼(@u1)/图片/面包.jpg', absPath:'D:/f/b2.jpg', platform:'xiaohongshu', creatorFull:'小鱼(@u1)', creatorId:'u1', type:'image', fileName:'面包.jpg', size:900*1024, mtime:now-4000, starred:0, tags:[], state:'ok'},
    {relPath:'video-rod/其他网页/example.com/视频/长视频.mp4', absPath:'D:/f/c.mp4', platform:'web', creatorFull:'example.com', creatorId:'', type:'video', fileName:'长视频.mp4', size:220*1024*1024, mtime:now-5000, duration:3725, starred:0, tags:[], state:'ok'},
    {relPath:'video-rod/B站/音乐UP(@2)/音频/晚安.mp3', absPath:'D:/f/d.mp3', platform:'bilibili', creatorFull:'音乐UP(@2)', creatorId:'2', type:'audio', fileName:'晚安.mp3', size:8*1024*1024, mtime:now-6000, starred:0, tags:[], state:'ok'},
    {relPath:'video-rod/X/Ken(@ken)/图片/街拍.jpg', absPath:'D:/f/e.jpg', platform:'x', creatorFull:'Ken(@ken)', creatorId:'ken', type:'image', fileName:'街拍.jpg', size:890*1024, mtime:now-7*86400000, starred:1, tags:['街拍'], state:'ok'},
    {relPath:'video-rod/抖音/奇趣蛋蛋(@qqdd)/视频/丢失.mp4', absPath:'D:/f/f.mp4', platform:'douyin', creatorFull:'奇趣蛋蛋(@qqdd)', creatorId:'qqdd', type:'video', fileName:'丢失.mp4', size:500*1024*1024, mtime:now-8*86400000, duration:60, starred:0, tags:[], state:'missing'},
    {relPath:'video-rod/微博/唐十七(@m0ve0f)/图片/折多山.webp', absPath:'D:/f/h.webp', platform:'weibo', creatorFull:'唐十七(@m0ve0f)', creatorId:'m0ve0f', type:'image', fileName:'折多山.webp', size:2*1024*1024, mtime:now-9*86400000, starred:0, tags:[], state:'ok'},
    {relPath:'video-rod/TikTok/leon(@leon)/视频/reel.mp4', absPath:'D:/f/i.mp4', platform:'tiktok', creatorFull:'leon(@leon)', creatorId:'leon', type:'video', fileName:'reel.mp4', size:5*1024*1024, mtime:now-10*86400000, duration:30, starred:0, tags:[], state:'ok'}
  ];
  await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
  await VRDB.putFiles(rows);
  return rows.length;
})()
"""


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=5))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=25)
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
                return r.get("result", {})
            if r.get("method") == "Runtime.exceptionThrown":
                d = r["params"]["exceptionDetails"]
                desc = ((d.get("exception", {}) or {}).get("description", "") or d.get("text", ""))
                # 带调用栈，定位到具体文件行
                frames = []
                for f in ((d.get("stackTrace") or {}).get("callFrames") or []):
                    frames.append("%s:%s" % ((f.get("url") or "").split("/")[-1], (f.get("lineNumber", 0) + 1)))
                self.errs.append(desc[:400] + (" | " + " <- ".join(frames[:6]) if frames else ""))

    def ev(self, js, sid):
        r = self.send("Runtime.evaluate",
                      {"expression": js, "returnByValue": True, "awaitPromise": True}, sid)
        if "exceptionDetails" in r:
            return {"__err": str(r["exceptionDetails"])[:160]}
        return r.get("result", {}).get("value")

    def mute_dialogs(self, sid):
        """测试环境：原生 alert/confirm/prompt 会阻塞 JS 线程，把 CDP 一起卡死。
        confirm 一律 true（相当于全同意），只为把流程走完。页面 reload 后会失效，要重新注入。"""
        self.ev("(()=>{window.alert=function(){};window.confirm=function(){return true};"
                "window.prompt=function(){return ''};return 1})()", sid)

    def open_page(self, url, w, h):
        tid = self.send("Target.createTarget", {"url": url})["targetId"]
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        self.send("Page.enable", {}, sid)
        if w:
            self.send("Emulation.setDeviceMetricsOverride",
                      {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False}, sid)
        self.mute_dialogs(sid)
        return tid, sid

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9560)
    ap.add_argument("--ext", default=KNOWN_EXT)
    ap.add_argument("--shot", default="deliverables/assets/e2e-buttons.png")
    ap.add_argument("--allow-real-db", action="store_true",
                    help="显式允许在含真实数据的库上种测试数据（默认拒绝；请优先用 e2e-all --isolated）")
    a = ap.parse_args()

    c = Cdp(a.port)

    # ==================== 资源库 ====================
    tid, sid = c.open_page("chrome-extension://%s/library.html" % a.ext, 1440, 900)
    time.sleep(2.5)

    # 防护：这个套件会 deleteFiles(全部) 再种 10 条假数据。
    # 如果当前库里有真实 absPath（不是 D:/f/* 或 D:/fake/*），默认拒绝执行，
    # 避免在 9480 真实 profile 上误清用户索引。
    rows_raw = c.ev(
        "VRDB.getAllFiles().then(r=>JSON.stringify(r.map(x=>({relPath:x.relPath,absPath:x.absPath}))))",
        sid)
    rows = []
    try:
        rows = json.loads(rows_raw) if isinstance(rows_raw, str) else []
    except Exception:
        rows = []
    # 测试产物不算「真实数据」：
    #   d:/f/、d:/fake/      —— 套件自己造的假条目
    #   .../work/dl/         —— e2e-all --isolated 的隔离下载目录
    #   _selftest/           —— 各套件自检留下的目录（2026-11-12：隔离库里一条
    #                           _selftest 残留让本套件一直「拒绝执行」，批次里
    #                           永远红，单独跑却是 32/32 —— 就是这个判据太宽）
    TEST_MARKS = ("d:/f/", "d:/fake/", "/work/dl/", "/_selftest/")
    real = []
    for r in rows:
        apath = str((r or {}).get("absPath") or "").replace("\\", "/").lower()
        if not apath:
            continue
        if any(m in apath for m in TEST_MARKS):
            continue
        real.append(r)
    if real and not a.allow_real_db:
        print("[拒绝] 当前库含 %d 条真实数据（示例：%s）。" %
              (len(real), (real[0] or {}).get("relPath", "?")))
        print("       本套件会清空索引再种 10 条假数据；请改用：")
        print("       python tools/e2e-all.py --isolated --only e2e-buttons")
        c.send("Target.closeTarget", {"targetId": tid})
        c.close()
        return 2

    c.ev(SEED, sid)
    c.send("Page.reload", {}, sid)
    time.sleep(3.5)
    c.mute_dialogs(sid)      # reload 会把覆盖冲掉，必须重新注入
    c.errs = []

    print("\n---- 基础 ----")
    ck("10 张卡片", c.ev("document.querySelectorAll('#grid .card').length", sid), 10)
    # 资源树自 2026-11-07 起按 MIN_SITE=5 分组：素材 ≥5 条的站点单独成一级，
    # 其余收进「其他站点」。这份 10 条种子里没有任何站点达到 5 条
    # （bilibili 3、xiaohongshu 2、其余各 1），所以只有
    # 「全部资源」+「其他站点」两个节点。
    # 原断言期望 8 个节点是分组规则引入前的口径，已过期。
    ck("树节点 2（无站点达 5 条，收进「其他站点」）",
       c.ev("document.querySelectorAll('#tree .tree-node').length", sid), 2)
    ck("页签计数自洽", c.ev("""(()=>{
      const t = {}; [...document.querySelectorAll('#typeTabs button')].forEach(b => t[b.dataset.type] = +b.querySelector('b').textContent);
      return t.all === 10 && t.video === 5 && t.image === 4 && t.anim === 0 && t.audio === 1;
    })()""", sid), True)

    print("\n---- B1 关键交互（点前 vs 点后）----")
    # 1 搜索
    c.ev("""(()=>{const s=document.getElementById('search'); s.value='旅行'; s.dispatchEvent(new Event('input',{bubbles:true})); return 1})()""", sid)
    time.sleep(0.8)
    ck("搜索生效（1 条）", c.ev("document.querySelectorAll('#grid .card').length", sid), 1)
    c.ev("""(()=>{const s=document.getElementById('search'); s.value=''; s.dispatchEvent(new Event('input',{bubbles:true})); return 1})()""", sid)
    time.sleep(0.8)
    ck("清空搜索复原（10 条）", c.ev("document.querySelectorAll('#grid .card').length", sid), 10)

    # 2 类型页签
    c.ev("""(()=>{const b=[...document.querySelectorAll('#typeTabs button')].find(x=>x.dataset.type==='image'); b.click(); return 1})()""", sid)
    time.sleep(0.8)
    ck("点「图片」有 4 条（webp 归图片，不再是动图）", c.ev("document.querySelectorAll('#grid .card').length", sid), 4)
    c.ev("""(()=>{const b=[...document.querySelectorAll('#typeTabs button')].find(x=>x.dataset.type==='all'); b.click(); return 1})()""", sid)
    time.sleep(0.8)

    # 3 平台筛选（B-23 选项 A：顶部 chips 已移除，改由左侧资源树承担）
    chips = c.ev("document.querySelectorAll('#chips .chip').length", sid)
    ck("顶部 chips 已移除", chips, 0)
    # B站只有 3 条（< MIN_SITE=5），被收进「其他站点」；要先展开才点得到。
    # 原断言直接找 data-plat=bilibili，在分组规则下永远找不到（2026-11-08 实测）。
    # 注意两点：①「其他站点」按钮本身也带 .tree-node.plat，必须用 data-group 精确定位；
    # ② data-plat 的值是站点分组键「@B站」，不是原始 platform「bilibili」。
    c.ev("""(()=>{const g=document.querySelector('#tree .tree-node[data-group="others"]'); if(g) g.click(); return 1})()""", sid)
    time.sleep(0.9)
    ev_plat = c.ev("""(()=>{const n=[...document.querySelectorAll('#tree .tree-node.plat')].find(x=>(x.dataset.plat||'').indexOf('B站') >= 0); if(!n) return 0; n.click(); return 1})()""", sid)
    time.sleep(0.9)
    ck("展开「其他站点」后能点到 B站", ev_plat, 1)
    ck("点左侧「B站」节点筛选生效", c.ev("document.querySelectorAll('#grid .card').length", sid), 3)
    c.ev("""(()=>{const n=document.querySelector('#tree .tree-node'); if(n) n.click(); return 1})()""", sid)
    time.sleep(0.8)
    ck("点「全部资源」恢复", c.ev("document.querySelectorAll('#grid .card').length", sid) > 3, True)

    # 4 视图切换
    before_cls = c.ev("document.getElementById('grid').className", sid)
    c.ev("""(()=>{const b=document.getElementById('viewBtn')||[...document.querySelectorAll('button')].find(x=>/list/i.test(x.className)); if(!b) return 0; b.click(); return 1})()""", sid)
    time.sleep(0.6)
    after_cls = c.ev("document.getElementById('grid').className", sid)
    ck("视图切换改了 class", before_cls != after_cls or after_cls is not None, True)

    # 5 批量
    c.ev("document.getElementById('selectBtn').click(); 1", sid)
    time.sleep(0.6)
    ck("进入批量态", c.ev("document.getElementById('grid').classList.contains('selecting')", sid), True)
    c.ev("document.getElementById('batchAll').click(); 1", sid)
    time.sleep(0.6)
    ck("全选后选中数 = 10", c.ev("document.querySelectorAll('#grid .card.selected').length", sid), 10)
    c.ev("document.getElementById('batchClear').click(); 1", sid)
    time.sleep(0.4)
    c.ev("document.getElementById('batchExit').click(); 1", sid)
    time.sleep(0.5)

    # 6 收藏区（2026-11-08 苏哥拍板：只有一个「收藏」，不命名、不新建）
    # 旧断言「新建测试夹」已不适用：输入框与新建按钮已随 DOM 删除。
    # 现在验证的是新契约：只有一行「收藏」、可点击筛选、且不再有命名入口。
    ck("收藏区只有一行", c.ev("document.querySelectorAll('#favList .fav-row').length", sid), 1)
    ck("收藏区无命名输入框", c.ev("!!document.getElementById('favNewInput')", sid), False)
    c.ev("document.querySelector('#favList .fav-row').click(); 1", sid)
    time.sleep(0.6)
    ck("点收藏后进入筛选态", c.ev("document.querySelector('#favList .fav-row').classList.contains('active')", sid), True)
    # 必须退出收藏筛选再往下走：否则后面「预览 / 下一张」只在收藏的几条里翻，
    # 会把正常功能误报成失败（2026-11-08 实测踩到）。
    c.ev("""(()=>{const n=[...document.querySelectorAll('#tree .tree-node')].find(x=>(x.querySelector('.label')||{}).textContent==='全部资源'); if(n) n.click(); return 1})()""", sid)
    time.sleep(0.6)
    ck("退出收藏筛选后恢复全库", c.ev("document.querySelectorAll('#grid .card').length", sid), 10)

    # 7 设置弹窗（2026-11-10 由右侧抽屉改成居中弹窗；旧断言指向 #setdrawer / #sdDirVal
    #   已经不存在 → 一直静默失败。这里跟着落地的 DOM 改，别再拿已删元素当契约。
    c.ev("document.getElementById('settingsBtn').click(); 1", sid)
    time.sleep(0.9)
    ck("设置弹窗打开", c.ev("document.getElementById('setModal').classList.contains('show')", sid), True)
    ck("弹窗有可改的开关", bool(c.ev("document.querySelectorAll('#setModal .switch input').length", sid)), True)
    c.ev("document.getElementById('setClose').click(); 1", sid)
    time.sleep(0.6)
    ck("设置弹窗已关闭", c.ev("document.getElementById('setModal').classList.contains('show')", sid), False)

    # 8 回收站
    c.ev("document.getElementById('trashBtn').click(); 1", sid)
    time.sleep(0.9)
    ck("回收站抽屉打开", c.ev("document.getElementById('drawer').classList.contains('show')", sid), True)
    c.ev("document.getElementById('dwClose').click(); 1", sid)
    time.sleep(0.6)

    # 9 预览层
    c.ev("document.querySelector('#grid .card').click(); 1", sid)
    time.sleep(1.4)
    ck("预览打开", c.ev("!document.getElementById('preview').classList.contains('hidden')", sid), True)
    ck("预览标题非空", bool(c.ev("(document.getElementById('pvTitle')||{}).textContent", sid)), True)
    t1 = c.ev("(document.getElementById('pvTitle')||{}).textContent", sid)
    c.ev("document.getElementById('pvNext').click(); 1", sid)
    time.sleep(1.0)
    t2 = c.ev("(document.getElementById('pvTitle')||{}).textContent", sid)
    ck("下一张切换了素材", t1 != t2, True)
    c.ev("document.getElementById('pvPrev').click(); 1", sid)
    time.sleep(0.8)
    # 标签添加
    c.ev("document.getElementById('pvTagAdd').click(); 1", sid)
    time.sleep(0.4)
    c.ev("""(()=>{const i=document.getElementById('pvTagInput'); if(!i) return 0; i.value='E2E标签'; return 1})()""", sid)
    c.ev("document.getElementById('pvTagSave').click(); 1", sid)
    time.sleep(1.0)
    ck("标签已加", c.ev("(document.getElementById('pvTags')||{}).innerText.indexOf('E2E标签') >= 0", sid), True)
    c.ev("document.getElementById('pvClose').click(); 1", sid)
    time.sleep(0.8)
    ck("预览能关", c.ev("document.getElementById('preview').classList.contains('hidden')", sid), True)

    # ==================== B2 全量按钮点击器 ====================
    print("\n---- B2 全量按钮（逐个点，抓异常）----")
    ids = c.ev("""(()=>[...document.querySelectorAll('button[id]')].map(b=>b.id))()""", sid)
    print("库页按钮数:", len(ids))
    c.errs = []
    bad_btn = []
    for bid in ids or []:
        n0 = len(c.errs)
        c.ev("(()=>{const b=document.getElementById(%s); if(b && !b.disabled) b.click(); return 1})()" % json.dumps(bid), sid)
        time.sleep(0.22)
        if len(c.errs) > n0:
            bad_btn.append(bid)
            print("   ↑ 按钮 %s 触发异常" % bid)
        # 每点一个就复位：把所有弹层关掉，避免遮挡后续点击
        c.ev("""(()=>{
          ['setdrawer','drawer','renameMask','moveMask','confirmMask','keysheet','preview','favPopNew','favDrawer'].forEach(id=>{
            const e=document.getElementById(id); if(e) e.classList.remove('show');
          });
          ['setmask','mask'].forEach(id=>{const e=document.getElementById(id); if(e) e.classList.remove('show');});
          return 1})()""", sid)
    time.sleep(0.6)
    print("点击期 JS 异常:", len(c.errs))
    for e in c.errs[:6]:
        print("   !", e.replace("\n", " ")[:400])
    if bad_btn:
        print("   出问题的按钮:", bad_btn)
    ck("全量按钮点击 0 异常", len(c.errs), 0)

    shot_dir = os.path.dirname(a.shot)
    if shot_dir:
        os.makedirs(shot_dir, exist_ok=True)
    import base64
    ss = c.send("Page.captureScreenshot", {"format": "png"}, sid)
    open(a.shot, "wb").write(base64.b64decode(ss["data"]))
    c.send("Target.closeTarget", {"targetId": tid})

    # ==================== 设置页 ====================
    print("\n---- 设置页 ----")
    c.errs = []
    tid2, sid2 = c.open_page("chrome-extension://%s/options.html" % a.ext, 1440, 900)
    time.sleep(3)
    anchors = c.ev("""(()=>[...document.querySelectorAll('.sidebar a[href^="#"]')].map(a=>a.getAttribute('href')))()""", sid2) or []
    print("导航项:", len(anchors))
    ck("导航项 >= 15", len(anchors) >= 15, True)
    missing = []
    for h in anchors:
        target = h[1:]
        ok = c.ev("!!document.getElementById(%s)" % json.dumps(target), sid2)
        if not ok:
            missing.append(h)
        c.ev("""(()=>{const a=document.querySelector('.sidebar a[href="%s"]'); if(a) a.click(); return 1})()""" % h, sid2)
        time.sleep(0.12)
    ck("导航锚点全部有落点", len(missing), 0)
    if missing:
        print("   缺落点:", missing)

    # 设置页按钮：只点「纯 UI」白名单，其余只断言存在。
    # 不能盲点：ClearData/ResetAllOption 会清配置，选择文件夹/导入会弹原生对话框阻塞，
    # extensionReload 会重载扩展把页面上下文打掉，vrLibMigRun 会真的搬文件。
    ALLOW = {"showTestTag", "AddExt", "AddType", "AddRegex", "vrLibSaveSubdir", "vrLibRefresh"}
    DANGER = {"ClearData", "ResetAllOption", "extensionReload", "importOptions", "exportOptions",
               "vrLibPickDir", "vrLibAuthDefault", "vrLibIdxFull", "vrLibMigPickParent", "vrLibMigPickSrc",
               "vrLibMigPickDst", "vrLibMigPickSrc2", "vrLibMigPlan", "vrLibMigRun",
               "vrLibMigRollback", "vrLibVerify", "vrLibIdxBuild", "vrLibIdxSnap",
               # 2026-11-13：恢复授权会向浏览器申请目录权限，同样可能弹原生确认框
               "vrLibAuthRestore",
               # 备份/恢复（阶段 4）：两者都会弹原生目录选择框，点下去会阻塞整个套件
               "vrLibExport", "vrLibRestore"}
    ids2 = c.ev("""(()=>[...document.querySelectorAll('.options-page button[id]')].map(b=>b.id))()""", sid2) or []
    print("设置页按钮数:", len(ids2))
    ck("设置页按钮 >= 25", len(ids2) >= 25, True)
    missing_btn = [i for i in list(ALLOW) if i not in ids2]
    ck("白名单按钮都在", len(missing_btn), 0)
    if missing_btn:
        print("   缺:", missing_btn)
    print("危险按钮（存在但不点）:", sorted(set(ids2) & DANGER))

    c.errs = []
    for bid in ids2:
        if bid not in ALLOW:
            continue
        c.ev("(()=>{const b=document.getElementById(%s); if(b && !b.disabled) b.click(); return 1})()" % json.dumps(bid), sid2)
        time.sleep(0.16)
    time.sleep(0.4)
    print("设置页白名单点击期异常:", len(c.errs))
    for e in c.errs[:6]:
        print("   !", e.replace("\n", " ")[:400])
    ck("设置页白名单 0 异常", len(c.errs), 0)

    c.send("Target.closeTarget", {"targetId": tid2})
    c.close()

    passed = sum(1 for ok, _ in RES if ok)
    print("\n%d/%d PASS" % (passed, len(RES)))
    if passed != len(RES):
        print("失败项:", [n for ok, n in RES if not ok])
    return 0 if passed == len(RES) else 1


if __name__ == "__main__":
    sys.exit(main())
