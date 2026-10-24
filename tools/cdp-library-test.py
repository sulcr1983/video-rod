"""资源库原型 v1.3 CDP 回归（TESTING §8 的 A–I 九组）。
用法：先启动 Chrome（--remote-debugging-port=9333，profile 在 .work/profiles/chrome-prototype），
      打开 deliverables/prototypes/library-prototype-v1.html，再运行本脚本。
端口可用环境变量 CDP 覆盖（默认 http://127.0.0.1:9333）。
"""
import json, os, re, sys, time, urllib.request
from websocket import create_connection

CDP = os.environ.get("CDP", "http://127.0.0.1:9333")
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
tabs = json.load(opener.open(CDP + "/json/list"))
page = next((t for t in tabs if t.get("type") == "page" and "library-prototype" in (t.get("url") or "")), None)
assert page, "找不到原型页签"

ws = create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=120)
mid = 0
events = []


def send(method, params=None):
    global mid
    mid += 1
    i = mid
    ws.send(json.dumps({"id": i, "method": method, "params": params or {}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == i:
            if "error" in m:
                raise RuntimeError(m["error"])
            return m.get("result", {})
        events.append(m)


def ev(expr, awaitp=False):
    r = send("Runtime.evaluate", {
        "expression": expr, "returnByValue": True,
        "awaitPromise": awaitp, "userGesture": True
    })
    if r.get("exceptionDetails"):
        d = r["exceptionDetails"]
        return {"__exc": (d.get("text") or "") + " | " + str(d.get("exception", {}).get("description"))}
    return r.get("result", {}).get("value")


results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f"   got={got!r} expect={expect!r}"))


def key(k, shift=False):
    return ev(f"""(()=>{{document.body.dispatchEvent(new KeyboardEvent('keydown',{{key:{json.dumps(k)},shiftKey:{str(shift).lower()},bubbles:true,cancelable:true}}));return 1}})()""")


send("Runtime.enable"); send("Log.enable"); send("Page.enable")
send("Page.reload", {"ignoreCache": True})
time.sleep(3.5)
events.clear()

# ---------- 基础 ----------
check("S01 页面标题正确", ev("document.title.includes('资源库原型')"), True)
check("S02 默认渲染 27 张卡片", ev("document.querySelectorAll('#mediaWrap .card').length"), 27)
check("S03 初始星标 5 项", ev("document.querySelectorAll('#mediaWrap .card.starred').length"), 5)
check("S04 标签下拉有多个选项", ev("document.getElementById('tagSel').options.length > 1"), True)

# ---------- 星标 ----------
sid = ev("+document.querySelector('#mediaWrap .card:not(.starred)').dataset.id")
check("S05 卡片有星标按钮", ev("!!document.querySelector('#mediaWrap .card [data-act=star]')"), True)
ev(f"document.querySelector('#mediaWrap .card[data-id=\"{sid}\"] [data-act=star]').click()")
check("S06 点星标后星标数 +1", ev("document.querySelectorAll('#mediaWrap .card.starred').length"), 6)
check("S07 点星标不打开灯箱", ev("document.getElementById('lightbox').classList.contains('on')"), False)
check("S08 星标按钮图标变实心", ev(f"document.querySelector('#mediaWrap .card[data-id=\"{sid}\"] [data-act=star]').textContent"), "★")
ev(f"document.querySelector('#mediaWrap .card[data-id=\"{sid}\"] [data-act=star]').click()")
check("S09 再点取消星标回到 5", ev("document.querySelectorAll('#mediaWrap .card.starred').length"), 5)

# ---------- 键盘导航 ----------
check("S10 初始无高亮", ev("document.querySelectorAll('#mediaWrap .focus').length"), 0)
key("j")
check("S11 J 出现键盘高亮", ev("document.querySelectorAll('#mediaWrap .focus').length"), 1)
f1 = ev("state.focusId")
key("j")
f2 = ev("state.focusId")
check("S12 再按 J 高亮项前进", f2 != f1, True)
key("k")
check("S13 按 K 回到上一项", ev("state.focusId"), f1)
star_before = ev("document.querySelectorAll('#mediaWrap .card.starred').length")
key("f")
star_after = ev("document.querySelectorAll('#mediaWrap .card.starred').length")
check("S14 F 键切换当前项星标", star_after != star_before, True)

# ---------- 只看星标 ----------
ev("document.getElementById('btnStarOnly').click()")
check("S15 只看星标：卡片数等于星标数", ev("document.querySelectorAll('#mediaWrap .card').length"),
      ev("MEDIA.filter(m=>alive(m)&&m.star).length"))
check("S16 只看星标按钮高亮", ev("document.getElementById('btnStarOnly').classList.contains('on')"), True)
ev("document.getElementById('btnStarOnly').click()")
check("S17 关闭后恢复全量", ev("document.querySelectorAll('#mediaWrap .card').length"), 27)

# ---------- 标签筛选 ----------
tag = ev("document.getElementById('tagSel').options[1].value")
ev("(()=>{const s=document.getElementById('tagSel');s.value=s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true}))})()")
check("S18 标签筛选后卡片全部命中该标签",
      ev("Array.from(document.querySelectorAll('#mediaWrap .card')).every(c=>MEDIA[+c.dataset.id].tags.includes(" + json.dumps(tag) + "))"), True)
check("S19 标签筛选确实收窄了范围", ev("document.querySelectorAll('#mediaWrap .card').length < 27"), True)
ev("(()=>{const s=document.getElementById('tagSel');s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}))})()")

# ---------- 列表视图星标 ----------
ev("document.getElementById('btnList').click()")
check("S20 列表视图渲染 27 行", ev("document.querySelectorAll('#mediaWrap .lrow').length"), 27)
check("S21 列表行有星标控件", ev("document.querySelectorAll('#mediaWrap .lrow .lstar').length"), 27)
lid = ev("+document.querySelector('#mediaWrap .lrow:not(.starred)').dataset.id") if False else ev("+document.querySelector('#mediaWrap .lrow').dataset.id")
lbefore = ev("document.querySelectorAll('#mediaWrap .lrow .lstar.on').length")
ev("document.querySelector('#mediaWrap .lrow .lstar').click()")
lafter = ev("document.querySelectorAll('#mediaWrap .lrow .lstar.on').length")
check("S22 列表点星标生效且不打开灯箱", (lafter != lbefore, ev("document.getElementById('lightbox').classList.contains('on')")), (True, False))
ev("document.getElementById('btnGrid').click()")
check("S23 切回网格视图", ev("document.querySelectorAll('#mediaWrap .card').length"), 27)

# ---------- Enter 打开 + 缩略图带 ----------
img_id = ev("MEDIA.find(m=>alive(m)&&m.type==='image').id")
ev(f"state.focusId={img_id};1")
key("Enter")
check("S24 Enter 打开高亮项（灯箱）", ev("document.getElementById('lightbox').classList.contains('on')"), True)
img_total = ev("MEDIA.filter(m=>alive(m)&&m.type==='image').length")
check("S25 灯箱缩略图带数量=图片总数", ev("document.querySelectorAll('#lbStrip button').length"), img_total)
check("S26 当前缩略图高亮唯一", ev("document.querySelectorAll('#lbStrip button.cur').length"), 1)
ev("document.querySelectorAll('#lbStrip button')[2].click()")
check("S27 点缩略图跳转到第 3 张", ev("document.querySelectorAll('#lbStrip button').item(2).classList.contains('cur')"), True)
check("S28 计数同步", ev("document.getElementById('lbCounter').textContent"), f"3 / {img_total}")
lb_star_before = ev("gallery()[state.lbIndex].star")
key("f")
lb_star_after = ev("gallery()[state.lbIndex].star")
check("S29 灯箱内 F 切换当前图片星标", lb_star_after != lb_star_before, True)
ev("document.getElementById('lbClose').click()")
check("S30 关闭按钮收起灯箱", ev("document.getElementById('lightbox').classList.contains('on')"), False)

# ---------- 右键菜单 ----------
ev("typeof closeCtx === 'function' && closeCtx()")
time.sleep(0.15)
ev("(()=>{const c=document.querySelector('#mediaWrap .card');c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))})()")
time.sleep(0.15)
check("S32 右键菜单出现", ev("document.getElementById('ctxMenu').classList.contains('on')"), True)
check("S33 右键菜单含星标项", ev("document.getElementById('ctxMenu').textContent.includes('星标')"), True)
ev("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
check("S34 Esc 关闭右键菜单", ev("document.getElementById('ctxMenu').classList.contains('on')"), False)

# ---------- 视频进度条时间气泡 ----------
vid = ev("MEDIA.find(m=>alive(m)&&m.type==='video').id")
ev(f"openVideo(MEDIA[{vid}])")
check("S35 视频弹层打开", ev("document.getElementById('vmodal').classList.contains('on')"), True)
check("S36 进度条气泡节点存在", ev("!!document.getElementById('vSeekTip')"), True)

ready = False
for _ in range(30):
    if ev("(()=>{const v=document.getElementById('vplayer');return v.readyState>=1 && isFinite(v.duration) && v.duration>0})()"):
        ready = True
        break
    time.sleep(1)
check("S37 视频元数据已加载（可算时间）", ready, True)
if ready:
    # 注意：mousemove 监听绑在 #vSeek（input）上，必须 dispatch 到 input，不能 dispatch 到父容器 .vseek
    ev("""(()=>{const inp=document.getElementById('vSeek');
      const b=inp.getBoundingClientRect();
      inp.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:b.left+b.width*0.5,clientY:b.top+b.height/2}))})()""")
    time.sleep(0.1)
    check("S38 悬停显示时间气泡", ev("document.getElementById('vSeekTip').classList.contains('on')"), True)
    check("S39 气泡文本是时间格式", ev("/^\\d{2}:\\d{2}$/.test(document.getElementById('vSeekTip').textContent)"), True)

# ---------- 视频键盘回归 ----------
before = ev("document.getElementById('vCount').textContent")
key("ArrowDown")
after = ev("document.getElementById('vCount').textContent")
check("S40 ↓ 切换下一个视频", after != before, True)
check("S41 切换后仍是 视频/总数 格式", ev("/^\\d+ \\/ \\d+$/.test(document.getElementById('vCount').textContent)"), True)
key("Escape")
check("S42 Esc 关闭视频弹层", ev("document.getElementById('vmodal').classList.contains('on')"), False)

# ---------- 控制台 ----------
time.sleep(0.8)
errs = []
for e in events:
    m = e.get("method")
    if m == "Runtime.exceptionThrown":
        errs.append(str(e.get("params", {}).get("exceptionDetails", {}).get("text")))
    elif m == "Log.entryAdded":
        en = e.get("params", {}).get("entry", {})
        if en.get("level") in ("error", "warning"):
            errs.append(f"{en.get('level')}: {en.get('text')}")
check("S43 控制台无 error/warning", errs, [])

total = len(results)
passed = sum(1 for r in results if r[0])
print(f"\n===== {passed}/{total} 通过 =====")
if errs:
    print("控制台问题：", errs[:8])
sys.exit(0 if passed == total else 1)
