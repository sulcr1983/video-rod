# mp4box 合成实验室：缓冲缓存在页面里，合成代码放 mux-attempt.js，改 JS 不用重下 27MB
import json
import os
import subprocess
import sys
import time
import urllib.request

from websocket import create_connection

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vr_testenv import dl_dir

CDP_URL = "http://127.0.0.1:9223"
BILI_URL = "https://www.bilibili.com/video/BV1DVaZ6hEK6/"
# 2026-11-08：原为 E:\personal\Downloads（用户真实下载夹，且该盘路径在本机不存在）。
# 测试产物集中到仓库内 work/dl，不再污染用户的下载目录。
DL_DIR = dl_dir("mux-lab")
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
MP4BOX = os.path.join(_REPO, "lib", "mp4box.all.min.js")
ATTEMPT = os.path.join(_HERE, "mux-attempt.js")

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Cdp:
    def __init__(self, url):
        ver = json.load(_opener.open(url + "/json/version"))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=300)
        self.mid = 0

    def send(self, method, params=None, session=None):
        self.mid += 1
        msg = {"id": self.mid, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        self.ws.send(json.dumps(msg))
        while True:
            raw = self.ws.recv()
            if not raw:
                continue
            r = json.loads(raw)
            if r.get("id") == self.mid:
                if "error" in r:
                    raise RuntimeError(f"{method}: {r['error']}")
                return r.get("result", {})

    def eval(self, expr, session):
        r = self.send("Runtime.evaluate", {
            "expression": expr, "returnByValue": True, "awaitPromise": True
        }, session)
        if r.get("exceptionDetails"):
            ed = r["exceptionDetails"]
            ex = ed.get("exception", {})
            return {"__error": (ex.get("description") or ed.get("text") or "")[:600]}
        return r.get("result", {}).get("value")

    def attach(self, tid):
        return self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]

    def targets(self):
        return self.send("Target.getTargets")["targetInfos"]


def ensure_buffers(cdp, psid):
    """确保 window.__vrDash = {vb, ab} 已缓存"""
    have = cdp.eval("(() => !!window.__vrDash && [window.__vrDash.vb.byteLength, window.__vrDash.ab.byteLength])()", psid)
    if isinstance(have, list) and not os.environ.get("VR_REFETCH"):
        print("   缓冲已缓存: video=%d audio=%d" % (have[0], have[1]))
        return True
    print("   下载 DASH 音视频缓冲…")
    r = cdp.eval(r"""
      (async () => {
        const s = window.__INITIAL_STATE__ || {};
        const v = s.videoData || {};
        const cid = v.cid, bvid = v.bvid;
        if (!cid) return { err: 'no cid' };
        const u = 'https://api.bilibili.com/x/player/playurl?cid=' + cid + '&qn=127&bvid=' + bvid +
                  '&otype=json&platform=html5&high_quality=1&fnval=4048';
        const txt = await new Promise((res, rej) => {
          const x = new XMLHttpRequest();
          x.open('GET', u, true); x.withCredentials = true; x.timeout = 20000;
          x.onload = () => res(x.responseText); x.onerror = () => rej(new Error('net')); x.send();
        });
        const j = JSON.parse(txt);
        const dash = j.data && j.data.dash;
        if (!dash) return { err: 'no dash' };
        const vs = (dash.video || []).slice().sort((a, b) => (b.width * b.height) - (a.width * a.height));
        const as = (dash.audio || []).slice().sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
        const V = vs[0], A = as[0];
        const getBuf = (url) => new Promise((res, rej) => {
          const x = new XMLHttpRequest();
          x.open('GET', url, true); x.responseType = 'arraybuffer'; x.timeout = 240000;
          x.onload = () => res(x.response); x.onerror = () => rej(new Error('dl fail'));
          x.ontimeout = () => rej(new Error('dl timeout')); x.send();
        });
        const t0 = Date.now();
        const vb = await getBuf(V.baseUrl || V.base_url);
        const ab = await getBuf(A.baseUrl || A.base_url);
        window.__vrDash = { vb, ab, V: { id: V.id, w: V.width, h: V.height, codecs: V.codecs },
                            A: { id: A.id, codecs: A.codecs } };
        return { ok: true, vBytes: vb.byteLength, aBytes: ab.byteLength, ms: Date.now() - t0,
                 V: window.__vrDash.V, A: window.__vrDash.A };
      })()
    """, psid)
    print("   ", json.dumps(r, ensure_ascii=False))
    return isinstance(r, dict) and r.get("ok")


def main():
    cdp = Cdp(CDP_URL)
    tid = None
    for t in cdp.targets():
        if t.get("type") == "page" and "bilibili.com/video" in t.get("url", ""):
            tid = t["targetId"]
            break
    if not tid:
        tid = cdp.send("Target.createTarget", {"url": BILI_URL})["targetId"]
        time.sleep(12)
    psid = cdp.attach(tid)

    with open(MP4BOX, "r", encoding="utf-8") as f:
        mp4box_src = f.read()
    cdp.eval(mp4box_src, psid)
    got = cdp.eval("typeof MP4Box + '/' + typeof (window.MP4Box && MP4Box.createFile)", psid)
    print("MP4Box:", got)
    if not str(got).startswith("object"):
        return

    print("\n[1] 准备缓冲")
    if not ensure_buffers(cdp, psid):
        print("  ❌ 缓冲准备失败")
        return

    # 放行下载：绕过 Chrome 对「同一页面多次自动下载」的静默拦截
    cdp.send("Browser.setDownloadBehavior", {
        "behavior": "allow", "downloadPath": DL_DIR, "eventsEnabled": True})

    print("\n[2] 跑合成实验 (tools/mux-attempt.js)")
    limit = int(os.environ.get("VR_LIMIT", "0"))
    cdp.eval("window.__vrLimit = %d" % limit, psid)
    with open(ATTEMPT, "r", encoding="utf-8") as f:
        js = f.read()
    res = cdp.eval(js, psid)
    print(json.dumps(res, ensure_ascii=False, indent=2)[:3000])

    if isinstance(res, dict) and res.get("downloaded"):
        time.sleep(12 if limit else 45)
        name = res.get("name")
        fp = os.path.join(DL_DIR, name)
        if os.path.exists(fp):
            sz = os.path.getsize(fp)
            print(f"\n✅ 落盘 {fp}  {sz} bytes")
            try:
                out = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                                      "format=duration,size,format_name:stream=codec_name,codec_type,width,height",
                                      "-of", "default=noprint_wrappers=1", fp],
                                     capture_output=True, text=True, timeout=60)
                print("--- ffprobe ---")
                print(out.stdout or out.stderr)
            except Exception as e:
                print("ffprobe 不可用:", e)
        else:
            print(f"\n❌ 未落盘: {fp}")
    cdp.ws.close()


if __name__ == "__main__":
    main()
