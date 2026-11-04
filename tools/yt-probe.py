# -*- coding: utf-8 -*-
"""
YouTube 高清下载可行性探针（真机验证，非纸上推演）

目的：回答一个问题——2026 年的 YouTube，纯浏览器客户端还能不能拿到「带 url 的」高清格式？

做法：
  1. 起 Chrome for Testing，走本机代理，打开一个真实 watch 页并让它播起来
  2. 在**页面主世界（MAIN world）**里读 ytInitialPlayerResponse
  3. 判定 adaptiveFormats 里每档是 url / signatureCipher / 还是 SABR-only
  4. 顺带在页面上下文里同源调一次 youtubei/v1/player，看 API 侧给不给直链
  5. 若拿到直链，真发一次 Range 请求验证它可用（这才是「能不能下」的最终判据）

用法：python tools/yt-probe.py [videoId]
依赖：系统 Python 3.12（websocket-client 只装在这里）
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
PORT = 9401
PROFILE = r"E:\test\video-rod\.work\profiles\yt-probe"
PROXY = "http://127.0.0.1:7897"
VIDEO = sys.argv[1] if len(sys.argv) > 1 else "aqz-KE-bpKQ"   # Big Buck Bunny 4K60

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def wait_port(port, timeout=25):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            _opener.open(f"http://127.0.0.1:{port}/json/version", timeout=1).read()
            return True
        except Exception:
            time.sleep(0.4)
    return False


def launch():
    os.makedirs(PROFILE, exist_ok=True)
    args = [
        CHROME,
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={PROFILE}",
        f"--proxy-server={PROXY}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate",
        "--autoplay-policy=no-user-gesture-required",
        "--window-size=1280,860",
        "about:blank",
    ]
    p = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_port(PORT):
        raise RuntimeError("Chrome 没起来（端口 %s 无响应）" % PORT)
    return p


PROBE_MAIN = r"""
(() => {
  const out = { ok: true };
  const pr = window.ytInitialPlayerResponse;
  if (!pr) { out.error = 'no ytInitialPlayerResponse'; return out; }
  const vd = pr.videoDetails || {};
  out.video = {
    id: vd.videoId, title: vd.title, dur: vd.lengthSeconds,
    author: vd.author, isLive: !!vd.isLiveContent
  };
  const sd = pr.streamingData || {};
  out.streamingDataKeys = Object.keys(sd);
  out.hasServerAbr = !!sd.serverAbrStreamingUrl;
  out.expire = sd.expireAt || null;

  const fmt = a => ({
    itag: a.itag,
    mime: (a.mimeType || '').split(';')[0],
    codecs: (a.mimeType || '').split('codecs="')[1]?.split('"')[0] || '',
    q: a.qualityLabel || a.audioQuality || '',
    h: a.height || 0, fps: a.fps || 0,
    br: Math.round((+a.bitrate || 0) / 1000),
    size: +a.contentLength || 0,
    url: !!a.url,
    cipher: !!a.signatureCipher,
    pot: /[?&]pot=/.test(a.url || ''),
    host: a.url ? (a.url.match(/https?:\/\/([^/]+)/) || [])[1] : null,
  });
  out.formats = (sd.formats || []).map(fmt);
  out.adaptive = (sd.adaptiveFormats || []).map(fmt);

  const pick = k => (sd.adaptiveFormats || []).find(a => a.itag == k);
  const best = (sd.adaptiveFormats || [])
    .filter(a => (a.mimeType || '').includes('video'))
    .sort((x, y) => (y.height || 0) - (x.height || 0))[0];
  out.bestVideo = best ? { itag: best.itag, q: best.qualityLabel, url: best.url || null } : null;
  out.firstUrl = (sd.adaptiveFormats || []).map(a => a.url).find(Boolean) || null;

  out.ctx = (() => {
    try {
      const c = window.ytcfg && ytcfg.get && ytcfg.get('INNERTUBE_CONTEXT');
      return c ? { client: c.client && c.client.clientName, ver: c.client && c.client.clientVersion,
                   visitor: c.client && c.client.visitorData } : null;
    } catch (e) { return 'err:' + e.message; }
  })();
  out.playerState = (() => {
    try {
      const p = document.querySelector('#movie_player');
      return p && p.getPlayerState ? p.getPlayerState() : null;
    } catch (e) { return null; }
  })();
  out.videoTag = (() => {
    const v = document.querySelector('video');
    return v ? { src: (v.src || '').slice(0, 40), dur: v.duration, w: v.videoWidth, h: v.videoHeight } : null;
  })();
  return out;
})()
"""

PROBE_API = r"""
(async () => {
  const vid = %s;
  const key = ytcfg.get('INNERTUBE_API_KEY');
  const ctx = JSON.parse(JSON.stringify(ytcfg.get('INNERTUBE_CONTEXT')));
  const url = '/youtubei/v1/player?key=' + key + '&prettyPrint=false';
  const body = { context: ctx, videoId: vid, contentCheckOk: true, racyCheckOk: true };
  const r = await fetch(url, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '1',
               'X-Youtube-Client-Version': ctx.client.clientVersion },
    body: JSON.stringify(body)
  });
  let j;
  try { j = await r.json(); } catch (e) { return { status: r.status, err: 'json fail' }; }
  const sd = j.streamingData || {};
  const ad = sd.adaptiveFormats || [];
  return {
    http: r.status,
    playability: j.playabilityStatus && j.playabilityStatus.status,
    reason: j.playabilityStatus && (j.playabilityStatus.reason || '').slice(0, 120),
    keys: Object.keys(sd),
    n_formats: ad.length,
    withUrl: ad.filter(a => a.url).length,
    withCipher: ad.filter(a => a.signatureCipher).length,
    hasServerAbr: !!sd.serverAbrStreamingUrl,
    sample: ad.filter(a => a.url).slice(0, 3).map(a => ({
      itag: a.itag, q: a.qualityLabel || a.audioQuality, host: (a.url.match(/https?:\/\/([^/]+)/) || [])[1]
    })),
    firstUrl: (ad.map(a => a.url).find(Boolean) || '').slice(0, 400)
  };
})()
"""


def range_probe(src, sid):
    """用页面上下文真发一次 Range 请求：200/206 就说明这条直链能用。"""
    expr = r"""
    (async () => {
      const u = %s;
      try {
        const r = await fetch(u, { headers: { Range: 'bytes=0-1023' } });
        const b = await r.arrayBuffer();
        return { status: r.status, type: r.headers.get('content-type'),
                 len: b.byteLength, cr: r.headers.get('content-range') };
      } catch (e) { return { err: String(e && e.message || e) }; }
    })()
    """ % json.dumps(src)
    return cdp.eval(expr, sid)


def main():
    proc = launch()
    cdp = None
    try:
        cdp = Cdp(f"http://127.0.0.1:{PORT}")
        tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
        sid = cdp.attach(tid)
        cdp.send("Page.enable", {}, sid)
        cdp.send("Runtime.enable", {}, sid)
        cdp.send("Network.enable", {}, sid)

        for name, val in (("CONSENT", "YES+cb"), ("SOCS", "CAI")):
            try:
                cdp.send("Network.setCookie",
                         {"name": name, "value": val, "domain": ".youtube.com", "path": "/"}, sid)
            except Exception:
                pass

        watch = f"https://www.youtube.com/watch?v={VIDEO}&hl=en"
        print("[1] 打开 %s" % watch)
        cdp.send("Page.navigate", {"url": watch}, sid)

        print("[2] 等播放器起播（最多 45s）...")
        ok = cdp.wait_js(sid, "!!(document.querySelector('#movie_player') && "
                              "window.ytInitialPlayerResponse && "
                              "ytInitialPlayerResponse.streamingData)", timeout=45)
        if not ok:
            print("    !! 没等到 streamingData，页面可能被拦（同意页/验证码/代理问题）")
            print("    title =", cdp.eval("document.title", sid))
            print("    body  =", str(cdp.eval("document.body.innerText.slice(0,300)", sid))[:300])

        print("[3] 触发播放")
        cdp.eval("(()=>{const v=document.querySelector('video');if(v){v.muted=true;v.play().catch(()=>{});}return 1})()", sid)
        time.sleep(4)

        print("[4] 读 ytInitialPlayerResponse（页面主世界）")
        data = cdp.eval(PROBE_MAIN, sid)
        if not data or (isinstance(data, dict) and data.get("error")):
            print("    失败:", data)
            return 2

        v = data.get("video") or {}
        print("    视频：%s | %s | %ss" % (v.get("id"), (v.get("title") or "")[:50], v.get("dur")))
        print("    streamingData keys =", data.get("streamingDataKeys"))
        print("    serverAbrStreamingUrl =", data.get("hasServerAbr"))
        print("    playerState =", data.get("playerState"), "| videoTag =", data.get("videoTag"))

        adaptive = data.get("adaptive") or []
        n_url = sum(1 for a in adaptive if a["url"])
        n_cip = sum(1 for a in adaptive if a["cipher"])
        print("    格式统计：adaptive=%d 带url=%d 带cipher=%d" % (len(adaptive), n_url, n_cip))

        print("\n    ---- 视频档（按分辨率降序，前 12）----")
        vs = [a for a in adaptive if a["mime"].startswith("video")]
        vs.sort(key=lambda a: (-a["h"], -a["br"]))
        for a in vs[:12]:
            print("    itag %-4s %-6s %-22s %5skbps %7sMB  url=%s cipher=%s pot=%s %s" % (
                a["itag"], a["q"] or ("%dp" % a["h"]), a["codecs"][:22],
                a["br"], round(a["size"] / 1048576) if a["size"] else "-",
                "Y" if a["url"] else "-", "Y" if a["cipher"] else "-",
                "Y" if a["pot"] else "-", a["host"] or ""))

        print("\n    ---- 音频档（前 6）----")
        for a in [x for x in adaptive if x["mime"].startswith("audio")][:6]:
            print("    itag %-4s %-8s %-22s %5skbps  url=%s %s" % (
                a["itag"], a["q"], a["codecs"][:22], a["br"],
                "Y" if a["url"] else "-", a["host"] or ""))

        print("\n[5] 页面上下文同源调 youtubei/v1/player")
        api = cdp.eval(PROBE_API % json.dumps(VIDEO), sid)
        print("   ", json.dumps(api, ensure_ascii=False)[:900])

        print("\n[6] Range 探针（验证直链可用性）")
        src = data.get("firstUrl") or (data.get("bestVideo") or {}).get("url")
        if not src and isinstance(api, dict):
            src = api.get("firstUrl")
        if not src:
            print("    没有可用直链，跳过")
        else:
            print("    目标：", src[:110], "...")
            print("    结果：", json.dumps(range_probe(src, sid), ensure_ascii=False))

        print("\n[7] 抓包：页面自己发出的 videoplayback 请求（SABR 判定）")
        hits = []
        for e in cdp.events:
            if e.get("method") != "Network.requestWillBeSent":
                continue
            u = (e["params"].get("request") or {}).get("url", "")
            if "videoplayback" in u:
                hits.append(u)
        print("    videoplayback 请求数 =", len(hits))
        for u in hits[:3]:
            print("    ", u[:200])

        out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".work", "yt-probe.json")
        json.dump({"main": data, "api": api, "videoplayback": hits[:20]},
                  open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("\n[8] 原始数据已存 .work/yt-probe.json")
        return 0
    finally:
        try:
            if cdp:
                cdp.close_created()
        except Exception:
            pass
        try:
            proc.terminate()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
