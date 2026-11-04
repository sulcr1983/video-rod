"""舞台施工通用 CDP 验证器：连 Edge/浏览器调试端口，找我们的扩展 id，
打开指定页面、可选 seed、执行断言 JS、截图。供 T1-T6 每轮验收复用。

用法：
  先由外部启动浏览器（--remote-debugging-port=<port> --load-extension=<repo>），
  python tools/stage-probe.py --port 9450 --page library.html \
      --seed-file tools/cdp-library-page-test.py --shot out.png [--eval "JS"]

--seed-file：从既有测试脚本里抽 SEED 常量执行（注入 VRDB 演示数据）。
"""
import argparse, base64, json, re, sys, time, urllib.request

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
from websocket import create_connection


def cdp_list(port):
    return json.load(opener.open(f"http://127.0.0.1:{port}/json/list", timeout=3))


def find_ext(port, timeout=25):
    """轮询找 video-rod 的扩展 id：先查活动 SW target，再退回 target create。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            for t in cdp_list(port):
                u = t.get("url", "")
                if "js/background.js" in u and u.startswith("chrome-extension://"):
                    return u.split("/")[2]
        except Exception:
            pass
        time.sleep(0.5)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="9450")
    ap.add_argument("--page", default="library.html")
    ap.add_argument("--seed-file", default=None)
    ap.add_argument("--shot", default=None)
    ap.add_argument("--eval", default=None)
    ap.add_argument("--wait", type=float, default=3.0)
    ap.add_argument("--ext", default=None, help="扩展 id（同路径加载 id 固定，可直传跳过探测）")
    a = ap.parse_args()

    ver = json.load(opener.open(f"http://127.0.0.1:{a.port}/json/version", timeout=5))
    ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=120)
    mid = 0
    events = []

    def send(m, p=None, sid=None):
        nonlocal mid
        mid += 1
        i = mid
        msg = {"id": i, "method": m, "params": p or {}}
        if sid:
            msg["sessionId"] = sid
        ws.send(json.dumps(msg))
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == i:
                return r.get("result", {})
            events.append(r)

    def ev(e, sid):
        r = send("Runtime.evaluate", {"expression": e, "returnByValue": True, "awaitPromise": True}, sid)
        return r.get("result", {}).get("value")

    ext = a.ext or find_ext(a.port)
    if not ext:
        # SW 可能 idle：从 Preferences / Secure Preferences 兜底读 id
        import os, glob
        for pref in glob.glob("D:/test/download/.edge-*/Default/Preferences") + glob.glob("D:/test/download/.edge-*/Default/Secure Preferences"):
            try:
                d = json.load(open(pref, encoding="utf-8"))
                for eid, s in d.get("extensions", {}).get("settings", {}).items():
                    if "video-rod" in str(s.get("path", "")):
                        ext = eid
                        break
            except Exception:
                pass
            if ext:
                break
    if not ext:
        # 最后兜底：同路径 unpacked id 确定性，用已知值
        ext = "ceogmckiinjolbbdkjfelmfcfepccabp"
        print("WARN: 探测失败，使用已知 id 兜底", ext)
    print("EXT_ID:", ext)
    if not ext:
        sys.exit("找不到 video-rod 扩展（确认启动带 --load-extension）")

    tid = send("Target.createTarget", {"url": f"chrome-extension://{ext}/{a.page}"})["targetId"]
    sid = send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
    send("Runtime.enable", {}, sid)
    send("Page.enable", {}, sid)
    time.sleep(a.wait)

    if a.seed_file:
        src = open(a.seed_file, encoding="utf-8").read()
        m = re.search(r"SEED = r\"\"\"(.*?)\"\"\"", src, re.S)
        if m:
            print("SEED:", ev(m.group(1), sid))
            send("Page.reload", {}, sid)
            time.sleep(a.wait)

    if a.eval:
        print("EVAL:", json.dumps(ev(a.eval, sid), ensure_ascii=False))

    if a.shot:
        r = send("Page.captureScreenshot", {"format": "png"}, sid)
        open(a.shot, "wb").write(base64.b64decode(r["data"]))
        print("SHOT:", a.shot)

    errs = [e for e in events if e.get("method") == "Runtime.exceptionThrown"]
    console_errs = [e for e in events if e.get("method") == "Runtime.consoleAPICalled" and e["params"].get("type") == "error"]
    print("EXCEPTIONS:", len(errs), "| CONSOLE_ERRORS:", len(console_errs))
    for e in errs[:3]:
        print("  ", json.dumps(e["params"].get("exceptionDetails"))[:220])
    for e in console_errs[:3]:
        print("  console:", json.dumps(e["params"].get("args"))[:220])
    send("Target.closeTarget", {"targetId": tid})
    ws.close()


if __name__ == "__main__":
    main()
