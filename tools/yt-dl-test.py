# -*- coding: utf-8 -*-
"""
YouTube 直链可用性定位探针

已知：MWEB 客户端能拿到 41 个带 url 的格式（最高 2160p60），但直接 fetch 返回 403。
本脚本定位 403 的真实原因，变量逐个试：
  1. User-Agent（默认 / Android Chrome / iOS App / MWEB 原生）
  2. Range 有无
  3. itag（渐进式 18 / 1080p video-only 137 / 音频 140）
并打印 403 响应体的原文——googlevideo 的 body 会明说是哪一类拒绝。
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp  # noqa: E402

CHROME = r"C:\Users\XPENG\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe"
PORT = 9403
PROFILE = r"E:\test\video-rod\.work\profiles\yt-dl"
PROXY = "http://127.0.0.1:7897"
VIDEO = sys.argv[1] if len(sys.argv) > 1 else "aqz-KE-bpKQ"

UAS = {
    "none":        None,
    "desktop":     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "android_web": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
    "mweb_app":    "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)",
}

GET_MWEB = r"""
(async (vid) => {
  const key = ytcfg.get('INNERTUBE_API_KEY');
  const base = ytcfg.get('INNERTUBE_CONTEXT') || {};
  const visitor = (base.client || {}).visitorData;
  const ctx = { client: { clientName: 'MWEB', clientVersion: '2.20261023.01.00',
                          hl: 'en', gl: 'US', visitorData: visitor },
                user: { lockedSafetyMode: false }, request: { useSsl: true } };
  const r = await fetch('/youtubei/v1/player?key=' + key + '&prettyPrint=false', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json',
               'X-Youtube-Client-Name': '2',
               'X-Youtube-Client-Version': '2.20261023.01.00',
               ...(visitor ? { 'X-Goog-Visitor-Id': visitor } : {}) },
    body: JSON.stringify({ context: ctx, videoId: vid, contentCheckOk: true, racyCheckOk: true })
  });
  const j = await r.json();
  const ad = (j.streamingData || {}).adaptiveFormats || [];
  const fs = (j.streamingData || {}).formats || [];
  const grab = (arr, itag) => { const f = arr.find(a => a.itag == itag); return f ? {itag:f.itag, url:f.url,
      q:f.qualityLabel || f.audioQuality, mime:(f.mimeType||'').split(';')[0], size:+f.contentLength||0} : null; };
  return {
    status: (j.playabilityStatus||{}).status,
    n_adaptive: ad.length, n_formats: fs.length,
    p18: grab(fs, 18),
    v137: grab(ad, 137) || grab(ad, 299) || grab(ad, 315),
    a140: grab(ad, 140) || grab(ad, 251),
  };
})
"""

TRY = r"""
(async (u, ua) => {
  const out = {};
  for (const withRange of [true, false]) {
    try {
      const init = { headers: {} };
      if (withRange) init.headers.Range = 'bytes=0-1023';
      const r = await fetch(u, init);
      const buf = await r.arrayBuffer();
      out[withRange ? 'range' : 'plain'] = {
        status: r.status, len: buf.byteLength,
        type: r.headers.get('content-type'),
        cr: r.headers.get('content-range'),
        body: r.status >= 400
          ? new TextDecoder().decode(buf.slice(0, 300)).replace(/\s+/g, ' ')
          : new TextDecoder('latin1').decode(buf.slice(4, 12)),
      };
    } catch (e) { out[withRange ? 'range' : 'plain'] = { err: String(e && e.message || e) }; }
  }
  return out;
})
"""


def wait_port(port, timeout=25):
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            op.open(f"http://127.0.0.1:{port}/json/version", timeout=1).read()
            return True
        except Exception:
            time.sleep(0.4)
    return False


def main():
    os.makedirs(PROFILE, exist_ok=True)
    proc = subprocess.Popen([
        CHROME, f"--remote-debugging-port={PORT}", f"--user-data-dir={PROFILE}",
        f"--proxy-server={PROXY}", "--no-first-run", "--no-default-browser-check",
        "--window-size=1280,860", "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_port(PORT):
        raise RuntimeError("Chrome 没起来")

    cdp = None
    try:
        cdp = Cdp(f"http://127.0.0.1:{PORT}")
        tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
        sid = cdp.attach(tid)
        cdp.send("Page.enable", {}, sid)
        cdp.send("Runtime.enable", {}, sid)
        cdp.send("Network.enable", {}, sid)
        cdp.send("Network.setCookie", {"name": "CONSENT", "value": "YES+cb",
                                       "domain": ".youtube.com", "path": "/"}, sid)
        cdp.send("Page.navigate", {"url": f"https://www.youtube.com/watch?v={VIDEO}&hl=en"}, sid)
        if not cdp.wait_js(sid, "!!(window.ytcfg && ytcfg.get('INNERTUBE_API_KEY'))", timeout=40):
            print("页面没拿到 ytcfg")
            return 2
        time.sleep(1.5)

        print("[1] MWEB 取格式")
        got = cdp.eval("(" + GET_MWEB + ")(" + json.dumps(VIDEO) + ")", sid)
        if not isinstance(got, dict) or "status" not in got:
            print("    失败:", str(got)[:600])
            return 2
        print("    status=%s adaptive=%s formats=%s" % (got["status"], got["n_adaptive"], got["n_formats"]))
        for k in ("p18", "v137", "a140"):
            f = got.get(k)
            print("    %-5s %s" % (k, ("itag %s %s %s %.1fMB" % (f["itag"], f["q"], f["mime"],
                                                                  f["size"] / 1048576)) if f else "无"))

        targets = [(k, got[k]) for k in ("v137", "a140", "p18") if got.get(k)]
        for name, f in targets:
            print("\n[2] 试 %s (itag %s %s)" % (name, f["itag"], f["q"]))
            for ua_name, ua in UAS.items():
                try:
                    if ua:
                        cdp.send("Network.setUserAgentOverride", {"userAgent": ua}, sid)
                    else:
                        cdp.send("Network.setUserAgentOverride", {"userAgent": ""}, sid)
                except Exception:
                    pass
                res = cdp.eval("(" + TRY + ")(%s,%s)" % (json.dumps(f["url"]), json.dumps(ua or "")), sid)
                r = (res or {}).get("range") or {}
                p = (res or {}).get("plain") or {}
                ok = "OK" if r.get("status") in (200, 206) else "FAIL"
                print("    UA=%-12s range:%-3s len=%-7s %-24s | plain:%-4s %s" % (
                    ua_name, r.get("status"), r.get("len"), (r.get("type") or "")[:24],
                    p.get("status"), ("body=" + str(r.get("body"))[:110]) if r.get("status", 0) >= 400 else ""))
                time.sleep(0.3)

        json.dump(got, open(r".work\yt-dl-test.json", "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        return 0
    finally:
        try:
            if cdp:
                cdp.close_created()
        except Exception:
            pass
        proc.terminate()


if __name__ == "__main__":
    sys.exit(main())
