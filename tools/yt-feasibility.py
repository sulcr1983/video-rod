# -*- coding: utf-8 -*-
"""
YouTube 高清下载可行性：端到端验证

链路的每一环都要真跑一遍，不能靠推断：
  环 1  在 youtube.com 页面主世界同源调 /youtubei/v1/player（MWEB 客户端）→ 拿带 url 的格式列表
  环 2  把 URL 交给 Node，用 youtubei.js 的 Player.decipher 做 n 参数变换（纯 JS）
  环 3  用变换后的 URL 发 Range 请求，落 2MB 真实字节，校验 MP4 box

输出 .work/yt-urls.json 供 verify-n.mjs 消费。
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp  # noqa: E402
from vr_testenv import work_root

CHROME = r"C:\Users\XPENG\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe"
PORT = 9404
PROFILE = os.path.join(work_root(), "profiles", "yt-feas")
PROXY = "http://127.0.0.1:7897"

# 覆盖：4K 动画 / 版权音乐 / 高清实拍
VIDEOS = [
    ("aqz-KE-bpKQ", "Big Buck Bunny 4K60"),
    ("dQw4w9WgXcQ", "Rick Astley (版权音乐)"),
    ("LXb3EKWsInQ", "Costa Rica 4K"),
]

GET = r"""
(async (vid) => {
  const key = ytcfg.get('INNERTUBE_API_KEY');
  const base = ytcfg.get('INNERTUBE_CONTEXT') || {};
  const visitor = (base.client || {}).visitorData;
  const VER = '2.20261023.01.00';
  const ctx = { client: { clientName: 'MWEB', clientVersion: VER, hl: 'en', gl: 'US',
                          visitorData: visitor },
                user: { lockedSafetyMode: false }, request: { useSsl: true } };
  const r = await fetch('/youtubei/v1/player?key=' + key + '&prettyPrint=false', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '2',
               'X-Youtube-Client-Version': VER,
               ...(visitor ? { 'X-Goog-Visitor-Id': visitor } : {}) },
    body: JSON.stringify({ context: ctx, videoId: vid, contentCheckOk: true, racyCheckOk: true })
  });
  const j = await r.json();
  const ps = j.playabilityStatus || {};
  const sd = j.streamingData || {};
  const ad = sd.adaptiveFormats || [];
  const fs = sd.formats || [];
  const mk = f => f ? { itag: f.itag, q: f.qualityLabel || f.audioQuality || '',
                        mime: (f.mimeType || '').split(';')[0],
                        codecs: (f.mimeType || '').split('codecs="')[1]?.split('"')[0] || '',
                        size: +f.contentLength || 0, url: f.url || '' } : null;
  const vids = ad.filter(f => (f.mimeType || '').startsWith('video'))
                 .sort((a, b) => (b.height || 0) - (a.height || 0));
  const auds = ad.filter(f => (f.mimeType || '').startsWith('audio'))
                 .sort((a, b) => (+b.bitrate || 0) - (+a.bitrate || 0));
  return {
    vid, status: ps.status, reason: (ps.reason || '').slice(0, 80),
    title: ((j.videoDetails || {}).title || '').slice(0, 60),
    n_ad: ad.length, n_url: ad.filter(f => f.url).length,
    sabr: !!sd.serverAbrStreamingUrl,
    topV: vids.slice(0, 3).map(mk),
    best1080: mk(vids.find(f => f.height === 1080)) || mk(vids[0]),
    bestAud: mk(auds[0]),
    prog: mk(fs.find(f => f.itag === 18)),
  };
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
    out = []
    try:
        cdp = Cdp(f"http://127.0.0.1:{PORT}")
        tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
        sid = cdp.attach(tid)
        cdp.send("Page.enable", {}, sid)
        cdp.send("Runtime.enable", {}, sid)
        cdp.send("Network.setCookie", {"name": "CONSENT", "value": "YES+cb",
                                       "domain": ".youtube.com", "path": "/"}, sid)
        # 随便开一个 watch 页：只是为了拿到「有 cookie 的真实 youtube.com 同源上下文」
        cdp.send("Page.navigate", {"url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ&hl=en"}, sid)
        if not cdp.wait_js(sid, "!!(window.ytcfg && ytcfg.get('INNERTUBE_API_KEY'))", timeout=40):
            print("页面没就绪")
            return 2
        print("上下文就绪（%s）\n" % cdp.eval("document.title", sid)[:50])

        for vid, name in VIDEOS:
            r = cdp.eval("(" + GET + ")(" + json.dumps(vid) + ")", sid)
            if not isinstance(r, dict):
                print("%-28s 失败 %s" % (name, str(r)[:80]))
                continue
            out.append(r)
            print("%-22s %-10s  带url %2d/%2d  sabr=%-5s  最高 %-9s 音轨 %-16s" % (
                name[:22], r.get("status"), r.get("n_url", 0), r.get("n_ad", 0),
                r.get("sabr"),
                (r["topV"][0]["q"] + "/" + str(r["topV"][0]["itag"])) if r.get("topV") else "-",
                (r["bestAud"]["q"][:16]) if r.get("bestAud") else "-"))
            for v in (r.get("topV") or [])[:3]:
                print("      %-9s itag %-4s %-22s %6.0fMB" % (
                    v["q"], v["itag"], v["codecs"], v["size"] / 1048576))
            time.sleep(1.2)

        json.dump(out, open(os.path.join(work_root(), "yt-urls.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        print("\n已写 .work/yt-urls.json")
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
