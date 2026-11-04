"""资源库九方向可视化速选原型 CDP 回归。
用法：先启动 Chrome（--remote-debugging-port=9333，独立 profile），
      打开 deliverables/prototypes/library-redesign-options-v1.html，再运行本脚本。
端口可用环境变量 CDP 覆盖（默认 http://127.0.0.1:9333）。
断言：0 JS 错误、九方向均可切换、每方向卡片渲染、搜索命中、标志交互、灯箱、截图。
"""
import json, os, sys, time, urllib.request
from websocket import create_connection

CDP = os.environ.get("CDP", "http://127.0.0.1:9333")
SHOT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "deliverables", "prototypes", "shots")
os.makedirs(SHOT_DIR, exist_ok=True)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def find_page():
    tabs = json.load(opener.open(CDP + "/json/list"))
    return next((t for t in tabs if t.get("type") == "page"
                 and "library-redesign-options" in (t.get("url") or "")), None)

page = find_page()
assert page, "找不到原型页签（请确认 Chrome 已打开 library-redesign-options-v1.html）"
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
        "awaitPromise": awaitp, "userGesture": True})
    if r.get("exceptionDetails"):
        d = r["exceptionDetails"]
        return {"__exc": (d.get("text") or "") + " | " + str(d.get("exception", {}).get("description"))}
    return r.get("result", {}).get("value")


send("Page.enable")
send("Runtime.enable")
send("Console.enable") if False else None  # 用 Runtime 事件即可
send("Emulation.setDeviceMetricsOverride",
     {"width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False})

results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name +
          ("" if ok else f"   got={got!r} expect={expect!r}"))


def shot(tag):
    r = send("Page.captureScreenshot", {"format": "png"})
    import base64
    path = os.path.join(SHOT_DIR, f"options-{tag}.png")
    with open(path, "wb") as f:
        f.write(base64.b64decode(r["data"]))
    return path


DIRS = ["dark", "arc", "prec", "stage", "cat", "obs", "song", "vinyl", "spec"]
CARDS = {"dark": 12, "arc": 12, "prec": 12, "stage": 12, "cat": 12,
         "obs": 12, "song": 12, "vinyl": 12, "spec": 12}

# ---- 结构自检：body 默认方向、9 个 section、9 个按钮 ----
check("默认方向 dark 已构建", ev("!!document.querySelector('#opt-dark .app')"), True)
check("切换按钮数量=9", ev("document.querySelectorAll('.dbtn').length"), 9)
check("opt 区段数量=9", ev("document.querySelectorAll('.opt').length"), 9)

# ---- 逐方向切换 + 渲染 + 搜索 + 截图 ----
errors_hit = []
for d in DIRS:
    ev(f"setDir('{d}'); true")
    time.sleep(0.15)
    n = ev(f"document.querySelectorAll('#opt-{d} .card').length")
    check(f"[{d}] 卡片渲染=12", n, CARDS[d])
    # 搜索命中
    if d == "song":
        ev("document.querySelector('#opt-song .q').value='秋';"
           "applyQ('song','秋'); true")
        check("[song] 朱砂圈点命中字", ev(
            "document.querySelectorAll('#opt-song .ring').length") > 0, True)
    elif d == "obs":
        ev("document.querySelector('#opt-obs .q').value='海';"
           "applyQ('obs','海'); true")
        check("[obs] 星座线 polyline", ev(
            "!!document.querySelector('#cst polyline')"), True)
    elif d == "stage":
        ev("document.querySelector('#opt-stage .q').value='夜';"
           "applyQ('stage','夜'); true")
        check("[stage] 追光 miss 数>0", ev(
            "document.querySelectorAll('#opt-stage .card.miss').length") > 0, True)
    elif d == "spec":
        ev("document.querySelector('#opt-spec .q').value='海';"
           "applyQ('spec','海'); true")
        check("[spec] 命中 hit 数>0", ev(
            "document.querySelectorAll('#opt-spec .card.hit').length") > 0, True)
    elif d == "vinyl":
        ev("document.querySelector('#opt-vinyl .q').value='NASA';"
           "applyQ('vinyl','NASA'); true")
        check("[vinyl] 再发现贴纸显示", ev(
            "document.querySelectorAll('#opt-vinyl .card.hit').length") > 0, True)
    else:
        q = {"dark": "夜", "arc": "海", "prec": "夜", "cat": "NASA"}.get(d, "")
        ev(f"document.querySelector('#opt-{d} .q').value={json.dumps(q)};"
           f"applyQ('{d}',{json.dumps(q)}); true")
        hit = ev(f"document.querySelectorAll('#opt-{d} .card.hit').length")
        check(f"[{d}] 搜索有命中", hit and hit > 0, True)
    # 唱片墙落针
    if d == "vinyl":
        ev("document.querySelector('#opt-vinyl .card').click(); true")
        check("[vinyl] 落针 on 态", ev(
            "document.querySelector('#opt-vinyl .card').classList.contains('on')"), True)
        ev("document.querySelector('#opt-vinyl .card').click(); true")  # 复位
    shot(d)

# ---- 通用交互：卡片点击开信息面板 + 放大灯箱 ----
ev("setDir('dark'); true")
ev("document.querySelector('#opt-dark .card').click(); true")
check("点卡片开信息面板", ev(
    "document.querySelector('#opt-dark .insp').classList.contains('open')"), True)
check("信息面板有标题", ev(
    "!!document.querySelector('#opt-dark .insp .itl').textContent"), True)
ev("document.querySelector('#opt-dark .insp [data-a=enlarge]').click(); true")
check("放大灯箱打开", ev("!document.querySelector('#lb').hidden"), True)
ev("document.querySelector('#lbx').click(); true")
check("灯箱关闭", ev("document.querySelector('#lb').hidden"), True)
# 收藏
ev("document.querySelector('#opt-dark .card').click(); true")
ev("document.querySelector('#opt-dark .insp [data-a=fav]').click(); true")
check("收藏态写入 FAV", ev(
    "document.querySelectorAll('#opt-dark .fmark').length") > 0, True)

# ---- 键盘切换 ----
ev("setDir('obs'); true")
ev("window.dispatchEvent(new KeyboardEvent('keydown',{key:'1'})); true")
check("键盘 1 切回 dark", ev("document.body.dataset.s"), "dark")

# ---- JS 错误检查 ----
errs = []
for e in events:
    m = e.get("method")
    if m == "Runtime.exceptionThrown":
        errs.append(json.dumps(e["params"].get("exceptionDetails"))[:250])
    if m == "Runtime.consoleAPICalled" and e["params"].get("type") == "error":
        errs.append("console.error " + json.dumps(e["params"].get("args"))[:200])
check("0 JS 错误/异常", len(errs), 0)
if errs:
    print("---- 捕获错误 ----")
    for x in errs[:10]:
        print(x)

passed = sum(1 for ok, *_ in results if ok)
total = len(results)
print(f"\n==== 原型验收 {passed}/{total} 通过 ====")
print(f"截图目录：{SHOT_DIR}")
sys.exit(0 if passed == total else 1)
