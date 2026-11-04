# -*- coding: utf-8 -*-
"""YouTube 下载功能：截图取证（注入按钮 + 下载小窗）"""
import base64
import os
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp  # noqa: E402

CHROME = r"C:\Users\XPENG\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe"
EXT = r"E:\test\video-rod"
OUT = r"E:\test\video-rod\deliverables\assets"
PORT = 9414
PROFILE = r"E:\test\video-rod\.work\profiles\yt-shot"
PROXY = "http://127.0.0.1:7897"
VIDEO = sys.argv[1] if len(sys.argv) > 1 else "aqz-KE-bpKQ"


def wait_port(port, timeout=30):
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            op.open(f"http://127.0.0.1:{port}/json/version", timeout=1).read()
            return True
        except Exception:
            time.sleep(0.4)
    return False


def shot(cdp, sid, path, clip=None):
    p = {"format": "png", "captureBeyondViewport": True}
    if clip:
        p["clip"] = dict(clip, scale=1)
    r = cdp.send("Page.captureScreenshot", p, sid)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "wb").write(base64.b64decode(r["data"]))
    print("   写入", path, os.path.getsize(path), "字节")


def main():
    os.makedirs(PROFILE, exist_ok=True)
    proc = subprocess.Popen([
        CHROME, f"--remote-debugging-port={PORT}", f"--user-data-dir={PROFILE}",
        f"--proxy-server={PROXY}",
        f"--disable-extensions-except={EXT}", f"--load-extension={EXT}",
        "--no-first-run", "--no-default-browser-check", "--window-size=1360,900",
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_port(PORT):
        raise RuntimeError("Chrome 没起来")
    cdp = None
    try:
        cdp = Cdp(f"http://127.0.0.1:{PORT}")
        time.sleep(2.0)
        tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
        sid = cdp.attach(tid)
        cdp.send("Page.enable", {}, sid)
        cdp.send("Runtime.enable", {}, sid)
        cdp.send("Emulation.setDeviceMetricsOverride",
                 {"width": 1360, "height": 900, "deviceScaleFactor": 1, "mobile": False}, sid)
        cdp.send("Page.navigate", {"url": f"https://www.youtube.com/watch?v={VIDEO}&hl=en"}, sid)
        cdp.wait_js(sid, "!!document.getElementById('vr-yt-dl-host')", timeout=45)
        time.sleep(1.2)

        box = cdp.eval("""(() => {
            const h = document.getElementById('vr-yt-dl-host');
            h.scrollIntoView({block:'center'});
            const r = h.getBoundingClientRect();
            return {x: Math.max(0, r.x + window.scrollX - 24),
                    y: Math.max(0, r.y + window.scrollY - 22),
                    width: Math.min(640, r.width + 48), height: r.height + 44};
        })()""", sid)
        time.sleep(0.6)
        shot(cdp, sid, os.path.join(OUT, "yt-button-injected.png"), box)

        cdp.eval("document.getElementById('vr-yt-dl-host').shadowRoot"
                 ".getElementById('vr-yt-dl-btn').click(); 1", sid)
        dl = None
        for _ in range(50):
            for t in cdp.targets():
                if "yt-download.html" in t.get("url", ""):
                    dl = t
                    break
            if dl:
                break
            time.sleep(0.3)
        if dl:
            dsid = cdp.attach(dl["targetId"])
            cdp.send("Page.enable", {}, dsid)
            cdp.send("Runtime.enable", {}, dsid)
            cdp.send("Emulation.setDeviceMetricsOverride",
                     {"width": 480, "height": 700, "deviceScaleFactor": 2, "mobile": False}, dsid)
            time.sleep(2.5)
            shot(cdp, dsid, os.path.join(OUT, "yt-download-window.png"))
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
