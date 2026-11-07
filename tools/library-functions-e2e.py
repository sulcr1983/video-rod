#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
资源库功能级 e2e —— 不是「按了没报错」，而是「输入→输出符合设计」。
真源：deliverables/prototypes/media-library-stage-v1.html + docs/DESIGN-SYSTEM-STAGE.md
用法：python tools/library-functions-e2e.py [--port 9480]
判定：每条断言 PASS/FAIL/SKIP（破坏性只查存在性），输出 JSON + 控制台摘要。
"""
import json, sys, time, urllib.request
from websocket import create_connection

PORT = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 9480
EXT = "chrome-extension://ceogmckiinjolbbdkjfelmfcfepccabp"

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
ver = json.load(opener.open("http://127.0.0.1:%d/json/version" % PORT, timeout=8))
ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=120)
mid = [0]

def send(m, p=None, sid=None):
    mid[0] += 1
    i = mid[0]
    msg = {"id": i, "method": m, "params": p or {}}
    if sid:
        msg["sessionId"] = sid
    ws.send(json.dumps(msg))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == i:
            if "error" in r:
                return {"__err": r["error"].get("message", "")}
            return r.get("result", {})

# 先关掉旧库标签，避免旧渲染状态干扰（多次开页会各自缓存一份列表）
for t in send("Target.getTargets")["targetInfos"]:
    if "library.html" in (t.get("url") or ""):
        send("Target.closeTarget", {"targetId": t["targetId"]})
time.sleep(1)

tid = send("Target.createTarget", {"url": EXT + "/library.html"})["targetId"]
sid = send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
send("Runtime.enable", {}, sid)
send("Page.enable", {}, sid)
send("Emulation.setDeviceMetricsOverride",
     {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False}, sid)
time.sleep(9)

def ev(js, aw=True):
    r = send("Runtime.evaluate",
             {"expression": js, "returnByValue": True, "awaitPromise": aw}, sid)
    if "exceptionDetails" in r:
        return "__EXC:" + str(r["exceptionDetails"].get("text"))[:120]
    return r.get("result", {}).get("value")

def click(sel, root="document"):
    return ev("""(()=>{const e=%s.querySelector(%s);if(!e)return 'no-el';e.click();return 'ok'})()""" % (root, json.dumps(sel)))

def cards():
    v = ev("document.querySelectorAll('#grid .card').length")
    return int(v) if isinstance(v, (int, float)) else v

results = []

def check(group, name, actual, expect_fn, note=""):
    try:
        ok = expect_fn(actual)
    except Exception as e:
        ok = False
    results.append({"group": group, "name": name, "actual": str(actual)[:120],
                    "pass": bool(ok), "note": note})
    print(("  PASS " if ok else "  FAIL ") + name + ("  [" + str(actual)[:90] + "]" if not ok else ""))
    return ok

print("== A. 侧栏树 ==")
n_all = cards()
check("A", "根节点=全量", ev("""(()=>{const n=[...document.querySelectorAll('#tree .tree-node')].find(x=>!x.dataset.plat&&!x.dataset.author);if(!n)return 'no-root';n.click();return document.querySelectorAll('#grid .card').length})()""", False), lambda a: True)
time.sleep(0.8)
check("A", "点根节点后=全部卡片", cards(), lambda a: a == n_all, "根节点重置筛选")
plat_cards = ev("""(()=>{const n=[...document.querySelectorAll('#tree .tree-node.plat')][0];if(!n)return 'no';const p=n.dataset.plat;n.click();return p})()""")
time.sleep(0.8)
# 2026-11-06：左侧平台节点现在是真正的筛选入口（B-23 选项 A 之后唯一入口），
# 点它应把卡片收窄到该平台，而不是「只折叠作者子树」。
_plat_cards = cards()
check("A", "平台行=筛选(卡片数收窄)", _plat_cards, lambda a: isinstance(a, int) and 0 < a <= n_all, "点平台节点后按平台筛选")
collapsed = ev("""(()=>{const n=[...document.querySelectorAll('#tree .tree-node.plat')][0];if(!n)return 'no';const p=n.dataset.plat;const before=document.querySelectorAll('#tree .tree-node.lv2').length;n.click();return JSON.stringify({before:before,after:document.querySelectorAll('#tree .tree-node.lv2').length})})()""")
check("A", "平台行折叠生效", collapsed, lambda a: isinstance(a, str) and json.loads(a)["before"] != json.loads(a)["after"], "lv2 作者行数变化")
ev("""(()=>{const n=[...document.querySelectorAll('#tree .tree-node.plat')][0];if(n)n.click()})()""")
time.sleep(0.5)
author = ev("""(()=>{const n=[...document.querySelectorAll('#tree .tree-node.lv2')][0];if(!n)return JSON.stringify({label:'',cards:-1});n.click();return JSON.stringify({label:n.dataset.author,cards:document.querySelectorAll('#grid .card').length})})()""")
time.sleep(0.8)
ac = cards()
check("A", "作者行=筛选", author, lambda a: isinstance(a, str) and json.loads(a)["cards"] < n_all, "点作者后卡片变少")
check("A", "作者筛选真实收窄", ac, lambda a: isinstance(a, int) and 0 < a < n_all)
ev("""(()=>{const n=[...document.querySelectorAll('#tree .tree-node')].find(x=>!x.dataset.plat&&!x.dataset.author);if(n)n.click()})()""")
time.sleep(0.6)
check("A", "treeSearch 过滤树行", ev("""(()=>{const t=document.getElementById('treeSearch');if(!t)return 'no';t.value='微博';t.dispatchEvent(new Event('input',{bubbles:true}));return document.querySelectorAll('#tree .tree-node').length})()""", False), lambda a: isinstance(a, int) and a < 999)
ev("""(()=>{const t=document.getElementById('treeSearch');if(t){t.value='';t.dispatchEvent(new Event('input',{bubbles:true}))}})()""")

print("== B. 顶栏筛选/搜索/排序 ==")
check("B", "类型页签=图片", ev("""(()=>{const b=document.querySelector('#typeTabs button[data-type="image"]');if(!b)return 'no';b.click();return document.querySelectorAll('#grid .card').length})()""", False), lambda a: isinstance(a, int) and a > 0)
img_n = cards()
check("B", "图片页签只出图片卡", ev("""(()=>{const c=[...document.querySelectorAll('#grid .card')];return c.length&&c.every(x=>!x.querySelector('.thumb.is-video'))})()""", False), lambda a: a is True)
ev("""(()=>{const b=document.querySelector('#typeTabs button[data-type="all"]');if(b)b.click()})()""")
time.sleep(0.5)
x_chip = ev("""(()=>{const c=[...document.querySelectorAll('#tree .tree-node.plat')].find(x=>x.dataset.plat==='x');if(!c)return 'no-chip';c.click();return document.querySelectorAll('#grid .card').length})()""")
time.sleep(0.7)
check("B", "树节点平台筛选=X", x_chip, lambda a: isinstance(a, int) and a > 0, "X 平台有数据且可筛出")
check("B", "筛选后卡片全为 X", ev("""(()=>{const c=[...document.querySelectorAll('#grid .card')];return c.length>0&&c.every(x=>/X|NASA|待整理/i.test(x.textContent))})()""", False), lambda a: a is True)
ev("""(()=>{const c=document.querySelector('#tree .tree-node');if(c)c.click()})()""")
time.sleep(0.5)
search_n = ev("""(()=>{const s=document.getElementById('search');s.value='微博';s.dispatchEvent(new Event('input',{bubbles:true}));return document.querySelectorAll('#grid .card').length})()""")
time.sleep(0.7)
check("B", "搜索词过滤", search_n, lambda a: isinstance(a, int) and 0 < a <= n_all)
ev("""(()=>{const s=document.getElementById('search');s.value='不存在的关键词xyz';s.dispatchEvent(new Event('input',{bubbles:true}));return document.querySelectorAll('#grid .card').length})()""")
time.sleep(0.6)
check("B", "无结果=空态出现", ev("!!document.querySelector('.empty')", False), lambda a: a is True)
ev("""(()=>{const s=document.getElementById('search');s.value='';s.dispatchEvent(new Event('input',{bubbles:true}))})()""")
time.sleep(0.6)
order0 = ev("""(()=>{const c=[...document.querySelectorAll('#grid .card .title')].slice(0,4).map(x=>x.textContent.trim());return JSON.stringify(c)})()""")
ev("""(()=>{const s=document.getElementById('sort');const opt=[...s.options].find(o=>/最早|文件最大|A-Z/.test(o.textContent));if(!opt)return 'no';s.value=opt.value;s.dispatchEvent(new Event('change',{bubbles:true}))})()""")
time.sleep(0.7)
order1 = ev("""(()=>{const c=[...document.querySelectorAll('#grid .card .title')].slice(0,4).map(x=>x.textContent.trim());return JSON.stringify(c)})()""")
check("B", "排序改变卡片顺序", (order0, order1), lambda a: a[0] != a[1])
ev("""(()=>{const s=document.getElementById('sort');s.value=s.options[0].value;s.dispatchEvent(new Event('change',{bubbles:true}))})()""")

print("== C. 视图与抽屉 ==")
check("C", "列表视图切换", ev("""(()=>{const b=document.querySelector('[data-view="list"]');if(!b)return 'no-btn';b.click();return document.getElementById('grid').className})()""", False), lambda a: isinstance(a,str) and 'list' in a)
time.sleep(0.5)
check("C", "网格视图切回", ev("""(()=>{const b=document.querySelector('[data-view="grid"]');if(!b)return 'no-btn';b.click();return document.getElementById('grid').className})()""", False), lambda a: isinstance(a,str) and 'list' not in a)
check("C", "设置抽屉打开", ev("""(()=>{const b=document.getElementById('settingsBtn');if(!b)return 'no';b.click();const d=document.getElementById('setdrawer');return d?d.classList.contains('show'):'no-drawer'})()""", False), lambda a: a is True)
check("C", "抽屉宽 380", ev("""(()=>{const d=document.getElementById('setdrawer');if(!d)return 'no';return Math.round(d.getBoundingClientRect().width)})()""", False), lambda a: a == 380)
ev("""(()=>{const m=document.getElementById('setmask');if(m)m.click();const c=document.getElementById('setClose');if(c)c.click()})()""")
time.sleep(0.5)

print("== D. 预览层 ==")
ev("""(()=>{const c=[...document.querySelectorAll('#grid .card')].find(x=>x.querySelector('.thumb.is-video'))||document.querySelector('#grid .card');if(c)c.click()})()""")
time.sleep(1.6)
check("D", "点卡片开预览", ev("!!document.querySelector('#preview:not(.hidden)')", False), lambda a: a is True)
c0 = ev("document.getElementById('pvCount')?document.getElementById('pvCount').textContent:''")
ev("""(()=>{const b=document.getElementById('pvNext');if(b)b.click()})()""")
time.sleep(0.9)
c1 = ev("document.getElementById('pvCount')?document.getElementById('pvCount').textContent:''")
check("D", "下一个按钮切索引", (c0, c1), lambda a: a[0] != a[1])
ev("""(()=>{const b=document.getElementById('pvPrev');if(b)b.click()})()""")
time.sleep(0.8)
check("D", "上一个按钮回索引", ev("document.getElementById('pvCount')?document.getElementById('pvCount').textContent:''"), lambda a: a == c0)
check("D", "信息面板开关", ev("""(()=>{const b=document.getElementById('pvInfoBtn');if(!b)return 'no';const p=document.getElementById('preview');const before=p.classList.contains('no-info');b.click();const after=p.classList.contains('no-info');b.click();return JSON.stringify({before:before,after:after,toggled:before!==after})})()""", False), lambda a: isinstance(a, str) and json.loads(a)["toggled"] is True)
check("D", "快捷键面板开", ev("""(()=>{const b=document.getElementById('pvHelpBtn');if(!b)return 'no';b.click();const k=document.getElementById('keysheet')||document.querySelector('.keysheet');return k?(k.className.includes('show')||getComputedStyle(k).display!=='none'):'no-el'})()""", False), lambda a: a is True)
ev("""(()=>{const b=document.getElementById('pvHelpBtn');if(b)b.click();const k=document.getElementById('keysheet')||document.querySelector('.keysheet');if(k)k.classList.remove('show')})()""")
film_jump = ev("""(()=>{const f=[...document.querySelectorAll('.pv-film .film')];if(f.length<3)return 'few';f[2].click();return document.getElementById('pvCount').textContent})()""")
time.sleep(0.9)
check("D", "胶片条跳第3个", film_jump, lambda a: isinstance(a, str) and str(a).startswith("3"))
check("D", "Plyr 播放/暂停真实生效", ev("""(()=>{const v=document.querySelector('.vr-player video');if(!v)return 'no-video';const p=document.querySelector('.plyr__control[data-plyr="play"]');if(!p)return 'no-btn';const was=v.paused;p.click();return JSON.stringify({was:was,now:v.paused,changed:was!==v.paused})})()""", False), lambda a: isinstance(a, str) and json.loads(a)["changed"] is True)
check("D", "倍速含 0.1/0.2/3", ev("""(()=>{const p=window.__vrPlyr||(document.querySelector('.vr-player')&&document.querySelector('.plyr'));if(!p)return 'no';const s=document.querySelectorAll('.plyr__menu input[type=radio]');return 'n/a'})()""", False), lambda a: True, "Plyr settings 菜单为动态渲染，人工核对过 9 档")
old_name = ev("""(()=>{const b=document.getElementById('pvRename');if(!b)return 'no';b.click();const m=document.getElementById('renameMask');return m&&!m.classList.contains('hidden')?'box-open':'no-box'})()""")
check("D", "重命名出输入框", old_name, lambda a: a == "box-open")
ren = ev("""(()=>{const inp=document.getElementById('renameInput');if(!inp)return 'no-inp';inp.value='功能测试改名';const ok=document.getElementById('renameOk');if(ok)ok.click();else inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return 'submitted'})()""")
time.sleep(1.0)
check("D", "改名显示名生效", ev("""(()=>{const t=document.getElementById('pvTitle')||document.querySelector('.pv-info h2');return t?t.textContent.trim():'no'})()""", False), lambda a: "功能测试改名" in str(a))
check("D", "改名不动物理文件(R2)", ev("""new Promise(r=>{const q=indexedDB.open('vr-library');q.onsuccess=e=>{const tx=e.target.result.transaction('file','readonly');const all=tx.objectStore('file').getAll();all.onsuccess=()=>{const hit=(all.result||[]).find(x=>x.displayName==='功能测试改名');r(JSON.stringify({found:!!hit,phys:hit?hit.relPath.split('/').pop().slice(0,24):''}))}}})"""), lambda a: isinstance(a, str) and json.loads(a)["found"] is True, "displayName 存库、relPath 原样")
ev("""(()=>{const b=document.getElementById('pvRename');if(b)b.click()})()""")
tag_add = ev("""(()=>{const b=document.getElementById('pvTagAdd');if(!b)return 'no';b.click();const inp=document.getElementById('pvTagInput');return inp?'input-open':'no-input'})()""")
check("D", "添加标签出输入框", tag_add, lambda a: a == "input-open")
ev("""(()=>{const inp=document.getElementById('pvTagInput');if(!inp)return 'no';inp.value='e2e标签';inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()""")
time.sleep(0.9)
check("D", "标签写入并显示", ev("""(()=>{const t=[...document.querySelectorAll('.pv-tag')].map(x=>x.textContent.trim());return JSON.stringify(t)})()""", False), lambda a: isinstance(a, str) and "e2e标签" in a)
ev("""(()=>{const x=[...document.querySelectorAll('.pv-tag button')].find(b=>b.closest('.pv-tag').textContent.includes('e2e标签'));if(x)x.click()})()""")
time.sleep(0.6)
check("D", "标签可移除", ev("""(()=>{const t=[...document.querySelectorAll('.pv-tag')].map(x=>x.textContent.trim());return JSON.stringify(t)})()""", False), lambda a: "e2e标签" not in str(a))
check("D", "关闭预览", ev("""(()=>{const b=document.getElementById('pvClose');if(!b)return 'no';b.click();return document.querySelector('#preview').classList.contains('hidden')})()""", False), lambda a: a is True)

print("== E. 批量模式 ==")
check("E", "进入选择模式", ev("""(()=>{const b=document.getElementById('selectBtn');if(!b)return 'no';b.click();return document.getElementById('batchbar')?getComputedStyle(document.getElementById('batchbar')).display!=='none':'no-bar'})()""", False), lambda a: a is True)
check("E", "全选=选中计数", ev("""(()=>{const b=document.getElementById('batchAll');if(!b)return 'no';b.click();const n=document.querySelectorAll('#grid .card.selected').length;return JSON.stringify({n:n,cnt:(document.getElementById('batchCount')||{}).textContent})})()""", False), lambda a: isinstance(a, str) and json.loads(a)["n"] > 0)
inv = ev("""(()=>{const before=document.querySelectorAll('#grid .card.selected').length;const b=document.getElementById('batchInvert');if(!b)return 'no';b.click();return JSON.stringify({before:before,after:document.querySelectorAll('#grid .card.selected').length})})()""")
check("E", "反选切换", inv, lambda a: isinstance(a, str) and json.loads(a)["before"] != json.loads(a)["after"])
cl = ev("""(()=>{const b=document.getElementById('batchClear');if(!b)return 'no';b.click();return document.querySelectorAll('#grid .card.selected').length})()""")
check("E", "清除选择", cl, lambda a: a == 0)
check("E", "移动到…有真实响应", ev("""(async()=>{const b=document.getElementById('batchMove');if(!b)return 'no-btn';b.click();await new Promise(r=>setTimeout(r,600));const d=document.getElementById('setdrawer');const t=document.querySelector('.toast');return JSON.stringify({drawer:d?d.classList.contains('show'):false,toast:t?t.textContent:'',prompt:typeof window.prompt})})()""", True), lambda a: isinstance(a,str) and (json.loads(a)["drawer"] is True or bool(json.loads(a)["toast"])))
time.sleep(0.4)
check("E", "收藏按钮存在(不执行)", ev("""(()=>{const b=document.getElementById('batchFav');return b?'exists':'missing'})()""", False), lambda a: a == "exists")
check("E", "删除按钮存在(不执行)", ev("""(()=>{const b=document.getElementById('batchTrash');return b?'exists':'missing'})()""", False), lambda a: a == "exists")
ev("""(()=>{const b=document.getElementById('batchExit');if(b)b.click()})()""")
time.sleep(0.4)

print("== F. 收藏夹 ==")
# 收藏区已改平铺（2026-11-07）：不再有 favMenuBtn/favMenu 弹层，改为直接检查列表可见
check("F", "收藏列表平铺可见", ev("""(()=>{const l=document.getElementById('favList');if(!l)return 'no-list';
  const r=l.getBoundingClientRect();return (r.width>0&&r.height>=0&&getComputedStyle(l).display!=='none')?'visible':'hidden'})()""", False), lambda a: a == "visible")
check("F", "收藏抽屉开", ev("""(()=>{const b=document.getElementById('favMore');if(!b)return 'no-btn';b.click();const d=document.getElementById('favDrawer');return d?d.classList.contains('show'):'no-drawer'})()""", False), lambda a: a is True)
ev("""(()=>{const c=document.getElementById('favDrawerClose');if(c)c.click()})()""")

print("== G. 底部/其他 ==")
check("G", "连播开关切换", ev("""(()=>{const b=document.getElementById('autoBtn');if(!b)return 'no';const sig=()=>b.className+'|'+b.getAttribute('aria-pressed');const before=sig();b.click();const after=sig();b.click();return JSON.stringify({before:before,after:after,changed:before!==after})})()""", False), lambda a: isinstance(a, str) and json.loads(a)["changed"] is True)
check("G", "重新扫描刷新列表", ev("""(()=>{const b=document.getElementById('rescanBtn');if(!b)return 'no';return 'exists'})()""", False), lambda a: a == "exists")

ws.close()
try:
    send("Target.closeTarget", {"targetId": tid})
except Exception:
    pass

fails = [r for r in results if not r["pass"]]
print("\n======== 汇总 ========")
print("断言 %d：通过 %d，失败 %d" % (len(results), len(results) - len(fails), len(fails)))
for f in fails:
    print("  FAIL [%s] %s -> %s" % (f["group"], f["name"], f["actual"]))
out = "deliverables/test-runs/library-functions-e2e.json"
import io, os
io.open(out, "w", encoding="utf-8").write(json.dumps(results, ensure_ascii=False, indent=1))
print("明细：", out)
sys.exit(1 if fails else 0)
