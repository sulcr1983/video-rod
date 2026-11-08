# -*- coding: utf-8 -*-
"""
YouTube 下载功能：扩展级联调脚本

跑一遍真实链路：
  1. 带扩展起 Chrome（Chrome for Testing 147，正式版已不支持 --load-extension）
  2. 打开 watch 页，等注入的下载按钮出现
  3. 点按钮 → 应弹出 yt-download.html 小窗
  4. 读小窗状态：格式列表渲染了几项、有没有报错、控制台有没有异常
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
EXT = r"E:\test\video-rod"
PORT = int(os.environ.get("VR_PORT", "9411"))
PROFILE = os.path.join(work_root(), "profiles", "yt-ext")
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


def main():
    os.makedirs(PROFILE, exist_ok=True)
    proc = subprocess.Popen([
        CHROME, f"--remote-debugging-port={PORT}", f"--user-data-dir={PROFILE}",
        f"--proxy-server={PROXY}",
        f"--disable-extensions-except={EXT}", f"--load-extension={EXT}",
        "--no-first-run", "--no-default-browser-check", "--window-size=1280,900",
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_port(PORT):
        raise RuntimeError("Chrome 没起来")

    cdp = None
    try:
        cdp = Cdp(f"http://127.0.0.1:{PORT}")

        # 扩展是否加载成功
        time.sleep(2.0)
        ext_targets = [t for t in cdp.targets() if "chrome-extension://" in t.get("url", "")]
        print("[0] 扩展后台目标:", [t["url"][:70] for t in ext_targets][:2] or "无（可能被浏览器拒绝加载）")

        tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
        sid = cdp.attach(tid)
        cdp.send("Page.enable", {}, sid)
        cdp.send("Runtime.enable", {}, sid)
        cdp.send("Network.enable", {}, sid)
        cdp.send("Network.setCookie", {"name": "CONSENT", "value": "YES+cb",
                                       "domain": ".youtube.com", "path": "/"}, sid)

        url = f"https://www.youtube.com/watch?v={VIDEO}&hl=en"
        print("[1] 打开", url)
        cdp.send("Page.navigate", {"url": url}, sid)

        print("[2] 等注入按钮…")
        ok = cdp.wait_js(sid, "!!document.getElementById('vr-yt-dl-host')", timeout=40)
        print("    按钮注入:", "OK" if ok else "失败")
        if ok:
            txt = cdp.eval(snippet_text(), sid)
            print("    按钮文案:", txt)

        if not ok:
            return 2

        print("[3] 点按钮")
        cdp.eval("document.getElementById('vr-yt-dl-host').shadowRoot"
                 ".getElementById('vr-yt-dl-btn').click(); 1", sid)

        print("[4] 等下载小窗")
        dl = None
        for _ in range(40):
            for t in cdp.targets():
                if "yt-download.html" in t.get("url", ""):
                    dl = t
                    break
            if dl:
                break
            time.sleep(0.3)
        if not dl:
            print("    小窗没出现")
            return 3
        print("    ", dl["url"][:110])

        dsid = cdp.attach(dl["targetId"])
        cdp.send("Runtime.enable", {}, dsid)
        cdp.send("Page.enable", {}, dsid)
        time.sleep(1.0)

        # 等格式列表或者错误文案
        cdp.wait_js(dsid, "(document.getElementById('qc').children.length>0) || "
                          "(document.getElementById('msg').textContent.length>0)", timeout=30)
        time.sleep(0.8)
        info = cdp.eval("""(() => ({
            title: document.getElementById('title').textContent,
            sub: document.getElementById('sub').textContent,
            options: Array.prototype.map.call(
                document.getElementById('qc').children,
                b => b.querySelector('.t').textContent + ' | ' + b.querySelector('.s').textContent),
            msg: document.getElementById('msg').textContent,
            msgClass: document.getElementById('msg').className,
            goDisabled: document.getElementById('go').disabled
        }))()""", dsid)
        print("\n[5] 小窗状态")
        print(json.dumps(info, ensure_ascii=False, indent=1))

        # 沙箱页是不是起来了
        sb = cdp.eval("""(() => {
            const f = document.querySelector('iframe[sandbox]');
            return f ? {src: f.getAttribute('src'), ok: true} : {ok: false};
        })()""", dsid)
        print("\n[6] 沙箱 iframe:", sb)

        errs = cdp.errors()
        if errs:
            print("\n[7] 控制台异常:")
            for e in errs[:6]:
                print("   ", e[:220])
        else:
            print("\n[7] 控制台无异常")
        return 0
    finally:
        try:
            if cdp:
                cdp.close_created()
        except Exception:
            pass
        proc.terminate()


def snippet_text():
    return """(() => {
        const h = document.getElementById('vr-yt-dl-host');
        const r = h && h.shadowRoot;
        const b = r && r.getElementById('vr-yt-dl-btn');
        return b ? b.textContent.trim() : '(没有按钮)';
    })()"""


if __name__ == "__main__":
    sys.exit(main())
