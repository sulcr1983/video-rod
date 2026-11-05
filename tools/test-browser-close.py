# -*- coding: utf-8 -*-
"""优雅关闭测试浏览器（让 Cookie 落盘，保住登录态）
用法：python tools/test-browser-close.py [--port 9480]
"""
import argparse, json, time, urllib.request
from websocket import create_connection


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    a = ap.parse_args()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        ver = json.load(opener.open("http://127.0.0.1:%d/json/version" % a.port, timeout=4))
    except Exception as e:
        print("端口未在线，无需关闭：", e)
        return 0
    ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=10)
    ws.send(json.dumps({"id": 1, "method": "Browser.close", "params": {}}))
    try:
        ws.recv()
    except Exception:
        pass
    ws.close()
    for _ in range(20):
        time.sleep(0.5)
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/json/version" % a.port, timeout=1)
        except Exception:
            print("已优雅关闭，Cookie 已落盘")
            return 0
    print("关闭指令已发送，但端口仍在；稍等再查")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
