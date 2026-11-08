# -*- coding: utf-8 -*-
"""
YouTube 客户端类型矩阵探针

背景：Web 客户端已全面 SABR 化（adaptiveFormats 全部无 url，只剩 serverAbrStreamingUrl）。
问题：其它 innertube 客户端类型是否还能返回带 url 的格式？若能，就能直接喂 chrome.downloads。

做法：在真实 youtube.com 页面的主世界里，用不同 client 上下文逐个 POST /youtubei/v1/player，
      并用 CDP 切 UA（模拟 DNR 改 UA 的效果，因为 fetch 改不了 User-Agent 这个 forbidden header）。
      对返回了 url 的客户端，立刻发一次 Range 请求验证直链真的能用。
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
PORT = 9402
PROFILE = os.path.join(work_root(), "profiles", "yt-clients")
PROXY = "http://127.0.0.1:7897"
VIDEO = sys.argv[1] if len(sys.argv) > 1 else "aqz-KE-bpKQ"

UA_DESKTOP = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36")
UA_ANDROID = "com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip"
UA_IOS = "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)"
UA_VR = ("Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) "
         "OculusBrowser/33.0.0.0.0 SamsungBrowser/4.0 Chrome/130.0.0.0 VR Safari/537.36")
UA_TV = ("Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold "
         "(unlike Gecko) v8/8.8.278.8-jit gles Starboard/17, SmartTV")

# (标签, clientName, 数字 id, clientVersion, UA)
CLIENTS = [
    ("WEB",                           "WEB",                            1,  "2.20261023.01.00", UA_DESKTOP),
    ("MWEB",                          "MWEB",                           2,  "2.20261023.01.00", UA_IOS),
    ("ANDROID",                       "ANDROID",                        3,  "19.44.38",         UA_ANDROID),
    ("IOS",                           "IOS",                            5,  "19.45.4",          UA_IOS),
    ("TVHTML5",                       "TVHTML5",                        7,  "7.20261023.00.00", UA_TV),
    ("ANDROID_VR",                    "ANDROID_VR",                     28, "1.60.19",          UA_VR),
    ("ANDROID_TESTSUITE",             "ANDROID_TESTSUITE",              30, "1.9",              UA_ANDROID),
    ("WEB_EMBEDDED_PLAYER",           "WEB_EMBEDDED_PLAYER",            56, "1.20261023.01.00", UA_DESKTOP),
    ("TVHTML5_SIMPLY_EMBEDDED_PLAYER","TVHTML5_SIMPLY_EMBEDDED_PLAYER", 85, "2.0",              UA_TV),
]

PROBE = r"""
(async (cfg) => {
  const vid = cfg.vid;
  const key = ytcfg.get('INNERTUBE_API_KEY');
  const base = ytcfg.get('INNERTUBE_CONTEXT') || {};
  const ctx = {
    client: {
      clientName: cfg.name,
      clientVersion: cfg.ver,
      hl: 'en', gl: 'US',
      ...(cfg.name === 'WEB' || cfg.name === 'MWEB' || cfg.name === 'WEB_EMBEDDED_PLAYER'
          ? {} : { androidSdkVersion: 34, osName: 'Android', osVersion: '14' }),
    },
    user: { lockedSafetyMode: false },
    request: { useSsl: true },
    ...(base.client && base.client.visitorData ? { client: {
      clientName: cfg.name, clientVersion: cfg.ver, hl: 'en', gl: 'US',
      visitorData: base.client.visitorData,
      ...(base.client.visitorData ? {} : {})
    }} : {}),
  };
  const body = {
    context: ctx, videoId: vid, contentCheckOk: true, racyCheckOk: true,
    playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
  };
  const h = {
    'Content-Type': 'application/json',
    'X-Youtube-Client-Name': String(cfg.id),
    'X-Youtube-Client-Version': cfg.ver,
  };
  if (base.client && base.client.visitorData) h['X-Goog-Visitor-Id'] = base.client.visitorData;
  let r, j;
  try {
    r = await fetch('/youtubei/v1/player?key=' + key + '&prettyPrint=false', {
      method: 'POST', credentials: 'include', headers: h, body: JSON.stringify(body)
    });
    j = await r.json();
  } catch (e) { return { tag: cfg.tag, err: String(e && e.message || e) }; }
  const sd = j.streamingData || {};
  const ad = sd.adaptiveFormats || [];
  const withUrl = ad.filter(a => a.url);
  const best = withUrl.filter(a => (a.mimeType||'').includes('video'))
                      .sort((x,y) => (y.height||0) - (x.height||0))[0];
  return {
    tag: cfg.tag, http: r.status,
    status: (j.playabilityStatus||{}).status,
    reason: ((j.playabilityStatus||{}).reason || '').slice(0, 100),
    n: ad.length,
    url: withUrl.length,
    cipher: ad.filter(a => a.signatureCipher).length,
    sabr: !!sd.serverAbrStreamingUrl,
    best: best ? { itag: best.itag, q: best.qualityLabel,
                   pot: /[?&]pot=/.test(best.url),
                   host: (best.url.match(/https?:\/\/([^/]+)/)||[])[1] } : null,
    firstUrl: (best && best.url) || '',
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
    rows = []
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
            print("页面没拿到 ytcfg，退出")
            return 2
        print("页面就绪：", cdp.eval("document.title", sid)[:60], "\n")

        for tag, name, num, ver, ua in CLIENTS:
            try:
                cdp.send("Network.setUserAgentOverride", {"userAgent": ua}, sid)
            except Exception:
                pass
            cfg = {"tag": tag, "name": name, "id": num, "ver": ver, "vid": VIDEO}
            res = cdp.eval("(" + PROBE + ")(" + json.dumps(cfg) + ")", sid)
            if not isinstance(res, dict):
                res = {"tag": tag, "err": str(res)[:100]}
            rows.append(res)
            flag = "URL!" if res.get("url") else ("cip" if res.get("cipher") else ("sabr" if res.get("sabr") else "-"))
            print("%-32s %-12s n=%-3s url=%-3s cipher=%-3s sabr=%-5s best=%-28s %s" % (
                tag, res.get("status") or res.get("err", "?")[:12],
                res.get("n", "-"), res.get("url", "-"), res.get("cipher", "-"),
                res.get("sabr", "-"),
                ("%s/%s" % (res["best"]["itag"], res["best"]["q"])) if res.get("best") else "-",
                flag))
            if res.get("reason"):
                print("      reason:", res["reason"])
            time.sleep(0.6)

        winner = next((r for r in rows if r.get("firstUrl")), None)
        print("\n" + "=" * 70)
        if winner:
            print("直链赢家：", winner["tag"], "| itag", winner["best"]["itag"], winner["best"]["q"])
            u = winner["firstUrl"]
            print("URL 前缀：", u[:120], "...")
            cdp.send("Network.setUserAgentOverride", {"userAgent":
                     next(c[4] for c in CLIENTS if c[0] == winner["tag"])}, sid)
            rp = cdp.eval(r"""
              (async () => { try {
                const r = await fetch(%s, {headers:{Range:'bytes=0-1023'}});
                const b = await r.arrayBuffer();
                return {status:r.status, len:b.byteLength, type:r.headers.get('content-type'),
                        cr:r.headers.get('content-range')};
              } catch(e) { return {err:String(e && e.message || e)}; } })()
            """ % json.dumps(u), sid)
            print("Range 探针：", json.dumps(rp, ensure_ascii=False))
        else:
            print("没有一个客户端返回直链（全部 SABR / 不可播）")

        json.dump(rows, open(os.path.join(work_root(), "yt-clients.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        print("\n明细已存 .work/yt-clients.json")
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
