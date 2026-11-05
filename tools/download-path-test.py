#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
落盘链路自检：确认「未授权目录」时仍能落到 <默认下载目录>/video-rod/<平台>/<作者>/<类型>/<名>.<ext>
判据（对应苏哥第一性原则 P2 自动归档 / P3 自动改名）：
  D1 downloads API 保留了 video-rod 子目录
  D2 文件名保持中文标题，没有被换成 UUID
  D3 物理文件真的存在且内容一致

跑法（先起带扩展的 headless Edge）：
    python tools/download-path-test.py --port 9500
"""
import argparse
import json
import sys
import time
import urllib.request

from websocket import create_connection

KNOWN_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=5))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        self.mid = 0

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

    def ev(self, js, sid):
        r = self.send("Runtime.evaluate",
                      {"expression": js, "returnByValue": True, "awaitPromise": True}, sid)
        if "exceptionDetails" in r:
            return {"__err": str(r["exceptionDetails"])[:200]}
        return r.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


RESULTS = []


def check(name, got, want=True):
    ok = (got == want) if not isinstance(want, bool) else bool(got) == want
    RESULTS.append(ok)
    print(("PASS  " if ok else "FAIL  ") + name + "  = " + repr(got) + ("" if ok else "  (期望 " + repr(want) + ")"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9500)
    ap.add_argument("--ext", default=KNOWN_EXT)
    a = ap.parse_args()

    c = Cdp(a.port)
    tid = c.send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % a.ext})["targetId"]
    sid = c.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
    c.send("Runtime.enable", {}, sid)
    time.sleep(2.5)

    # 0) 前提：当前确实「没有目录授权」
    handle = c.ev("(async()=>{try{const o=await chrome.storage.local.get('vrLibSettings');"
                  "return !!(o.vrLibSettings&&o.vrLibSettings.handle)}catch(e){return 'err'}})()", sid)
    check("前提：无目录授权（走 downloads 回退）", handle, False)

    # 1) 用与产品一致的中文相对路径下一个小文件
    rel = "video-rod/_selftest/影视飓风(@946974)/视频/舞台自检 第1集.mp4"
    js = """(async function(){
      const txt = 'video-rod stage selftest\\n' + new Date().toISOString();
      const blob = new Blob([txt], {type: 'video/mp4'});  // 用真实 MIME，否则 Chrome 会按 MIME 纠正扩展名
      const url = URL.createObjectURL(blob);
      const id = await new Promise((res, rej) => {
        chrome.downloads.download({url: url, filename: %s, saveAs: false, conflictAction: 'overwrite'},
          (i) => { if (chrome.runtime.lastError) { rej(new Error(chrome.runtime.lastError.message)); } else { res(i); } });
      });
      return id;
    })()""" % json.dumps(rel)
    dl_id = c.ev(js, sid)
    check("downloads.download 返回 id", isinstance(dl_id, int), True)
    if not isinstance(dl_id, int):
        print("返回：", dl_id)
        c.send("Target.closeTarget", {"targetId": tid})
        c.close()
        return 1

    # 2) 等下载完成，读回真实路径
    info = None
    for _ in range(30):
        info = c.ev("(async()=>{const [it]=await chrome.downloads.search({id:%d});"
                    "return it?JSON.stringify({state:it.state,filename:it.filename,"
                    "byExtId:!!it.byExtensionId,error:it.error||''}):''})()" % dl_id, sid)
        if info and json.loads(info).get("state") == "complete":
            break
        time.sleep(0.5)

    if not info:
        check("拿到下载记录", info, "non-empty")
        c.send("Target.closeTarget", {"targetId": tid})
        c.close()
        return 1

    d = json.loads(info)
    print("下载记录:", d["filename"], "| state:", d["state"], "| byExtensionId:", d["byExtId"])

    check("D0 下载完成", d["state"], "complete")
    check("D1 保留 video-rod 子目录", "/video-rod/_selftest/" in d["filename"].replace("\\", "/"), True)
    check("D1b 平台/作者/类型三级目录都在",
          "/_selftest/" in d["filename"].replace("\\", "/")
          and "影视飓风(@946974)" in d["filename"] and "/视频/" in d["filename"].replace("\\", "/"), True)
    check("D2 文件名中文保留（未被 UUID 化）", "舞台自检 第1集.mp4" in d["filename"], True)
    base = d["filename"].rsplit("\\" if "\\" in d["filename"] else "/", 1)[-1]
    check("D2b 扩展名保持 mp4（未被 MIME 纠正）", base.endswith(".mp4"), True)
    check("D2c 文件名逐字一致", base, "舞台自检 第1集.mp4")

    # 3) 物理文件核对（在 Python 侧读）
    import os
    check("D3 物理文件存在", os.path.isfile(d["filename"]), True)
    if os.path.isfile(d["filename"]):
        body = open(d["filename"], "r", encoding="utf-8", errors="replace").read()
        check("D3b 内容正确", "video-rod stage selftest" in body)

    c.send("Target.closeTarget", {"targetId": tid})
    c.close()

    passed = sum(1 for x in RESULTS if x)
    print("\n%d/%d PASS" % (passed, len(RESULTS)))
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
