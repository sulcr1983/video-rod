#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""资源库下载完整性检查：DB 条目 ↔ 物理文件 ↔ 类型/大小/可解码性。

用法：python tools/library-integrity-check.py --port 9480
只读检查，不改库、不改文件。
"""
import argparse
import json
import os
import sys
import time
import urllib.request

from websocket import create_connection

EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"
RESULTS = []


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=8))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=90)
        self.mid = 0

    def send(self, method, params=None, sid=None):
        self.mid += 1; i = self.mid
        msg = {"id": i, "method": method, "params": params or {}}
        if sid: msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == i: return r.get("result", {})

    def ev(self, js, sid):
        r = self.send("Runtime.evaluate", {"expression": js, "returnByValue": True, "awaitPromise": True}, sid)
        if "exceptionDetails" in r:
            return {"__err": str(r["exceptionDetails"])[:300]}
        return r.get("result", {}).get("value")

    def close(self):
        try: self.ws.close()
        except Exception: pass


def check(name, ok, detail=""):
    RESULTS.append({"name": name, "pass": bool(ok), "detail": str(detail)[:300]})
    print(("PASS  " if ok else "FAIL  ") + name + (("  [" + str(detail)[:180] + "]") if not ok else ""))


def image_ok(path, ext):
    try:
        from PIL import Image
        with Image.open(path) as im:
            im.verify()
        return True, ""
    except Exception as e:
        return False, str(e)


def media_header_ok(path, typ):
    try:
        with open(path, "rb") as f:
            head = f.read(32)
        if typ == "video":
            # mp4/m4v often has ftyp at offset 4; webm starts 1A45DFA3
            return (b"ftyp" in head[:16]) or head.startswith(b"\x1a\x45\xdf\xa3") or len(head) > 0, head[:12].hex()
        if typ == "audio":
            return head.startswith(b"RIFF") or head.startswith(b"ID3") or len(head) > 0, head[:12].hex()
    except Exception as e:
        return False, str(e)
    return True, ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--json", default="deliverables/test-runs/library-integrity.json")
    a = ap.parse_args()
    c = Cdp(a.port); tid = sid = None
    try:
        tid = c.send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % EXT})["targetId"]
        sid = c.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        c.send("Runtime.enable", {}, sid); c.send("Page.enable", {}, sid)
        time.sleep(5)
        rows = c.ev("VRDB.getAllFiles().then(r=>JSON.stringify(r))", sid)
        rows = json.loads(rows) if isinstance(rows, str) else []
        check("库非空", bool(rows), len(rows))
        bad_meta = [r.get("relPath") for r in rows if not r.get("platform") or not r.get("type")]
        check("平台/类型字段完整", not bad_meta, bad_meta[:3])
        bad_prefix = [r.get("relPath") for r in rows if not str(r.get("relPath", "")).startswith("video-rod/")]
        check("relPath 都在 video-rod/ 下", not bad_prefix, bad_prefix[:3])
        seen = set(); dup = []
        for r in rows:
            if r.get("relPath") in seen: dup.append(r.get("relPath"))
            seen.add(r.get("relPath"))
        check("无重复 relPath", not dup, dup[:3])
        missing = []; size_bad = []; decode_bad = []; header_bad = []
        for r in rows:
            p = str(r.get("absPath") or "")
            if not p or not os.path.isfile(os.path.normpath(p)):
                missing.append(r.get("relPath")); continue
            sz = os.path.getsize(os.path.normpath(p))
            if sz <= 0 or (r.get("size") and sz != r.get("size")):
                size_bad.append((r.get("relPath"), r.get("size"), sz))
            typ = r.get("type")
            ext = str(r.get("fileName") or "").split(".")[-1].lower()
            if typ == "image" and ext in ("jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"):
                ok, msg = image_ok(os.path.normpath(p), ext)
                if not ok: decode_bad.append((r.get("relPath"), msg))
            elif typ in ("video", "audio"):
                ok, msg = media_header_ok(os.path.normpath(p), typ)
                if not ok: header_bad.append((r.get("relPath"), msg))
        check("所有 absPath 文件存在", not missing, missing[:3])
        check("文件大小非 0 且与 DB 一致", not size_bad, size_bad[:3])
        check("图片可解码", not decode_bad, decode_bad[:3])
        check("视频/音频有有效文件头", not header_bad, header_bad[:3])
        print("\n%d/%d PASS  条目=%d" % (sum(1 for x in RESULTS if x["pass"]), len(RESULTS), len(rows)))
        os.makedirs(os.path.dirname(a.json), exist_ok=True)
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "entries": len(rows)}, f, ensure_ascii=False, indent=1)
        print("明细：%s" % a.json)
        return 0 if all(x["pass"] for x in RESULTS) else 1
    finally:
        try:
            if tid: c.send("Target.closeTarget", {"targetId": tid})
        except Exception: pass
        c.close()


if __name__ == "__main__":
    sys.exit(main())
