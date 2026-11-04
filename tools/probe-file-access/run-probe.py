"""S0 探针执行器：连接 9340，定位真正的 probe.html，读取环境并跑三项探测。临时脚本。"""
import json, os, sys, time, urllib.request
from websocket import create_connection

CDP = os.environ.get("CDP", "http://127.0.0.1:9340")
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

tabs = json.load(opener.open(CDP + "/json/list"))
pages = [t for t in tabs if t.get("type") == "page" and "probe.html" in (t.get("url") or "")]
print("候选页面：", len(pages))
for t in pages:
    print("  -", t.get("url"), "|", t.get("title"))

def attach(t):
    ws = create_connection(t["webSocketDebuggerUrl"], suppress_origin=True, timeout=120)
    mid = 0
    def send(method, params=None):
        nonlocal mid
        mid += 1
        i = mid
        ws.send(json.dumps({"id": i, "method": method, "params": params or {}}))
        while True:
            m = json.loads(ws.recv())
            if m.get("id") == i:
                return m
    def ev(expr, awaitp=False):
        r = send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": awaitp, "userGesture": True})
        if "error" in r:
            return {"__err": r["error"]}
        res = r.get("result", {})
        if res.get("exceptionDetails"):
            return {"__exc": str(res["exceptionDetails"])[:400]}
        return res.get("result", {}).get("value")
    return send, ev

found = None
for t in pages:
    send, ev = attach(t)
    send("Runtime.enable")
    title = ev("document.title")
    has = ev("typeof window.__PROBE__ !== 'undefined'")
    print(f"  检查 {t['url']} -> title={title!r} hasProbe={has}")
    if has is True:
        found = (t, send, ev)
        break

if not found:
    print("未找到有效探针页")
    sys.exit(2)

t, send, ev = found
print("\n=== 环境 ===")
print(ev("JSON.stringify(window.__PROBE__.env)"))
print("文件访问开关：", ev("window.__PROBE__.env.fileSchemeAccess"))
print("页面提示：", ev("document.getElementById('env').textContent"))

# 先确保有一条下载记录（若 ③ 无记录再补）
print("\n=== 先造下载记录 ===")
ev("document.getElementById('dl').click()")
time.sleep(2.5)

print("\n=== 执行三项探测 ===")
ev("window.__runProbe()", awaitp=False)
time.sleep(14)

probe = ev("JSON.stringify(window.__PROBE__)")
print("\n=== 结果 ===")
print(probe)
if isinstance(probe, str):
    try:
        d = json.loads(probe)
        print("\nVERDICT:", d.get("verdict"))
        print("img:", json.dumps(d.get("img"), ensure_ascii=False))
        print("video:", json.dumps(d.get("video"), ensure_ascii=False))
        print("downloads:", json.dumps({k: v for k, v in (d.get("downloads") or {}).items() if k != "items"}, ensure_ascii=False))
    except Exception as e:
        print("parse fail:", e)
