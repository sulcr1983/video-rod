# -*- coding: utf-8 -*-
"""
SABR 复放实验（决定性）

背景：
  · Web 客户端的 adaptiveFormats 已无 url，只有 serverAbrStreamingUrl
  · MWEB 直链虽然存在，但几分钟内就被风控（UNPLAYABLE）
  · SABR 链接空 body POST 返回 200 + application/vnd.yt-ump（只是 sabr.malformed_config）
    —— 说明链接本身可用、鉴权通过、无 poToken 挑战

本脚本验证：能不能把播放器自己发的那个 POST 请求体抓下来，原样复放，拿到媒体字节。
若成功 → 高清下载完全不需要 innertube API、不需要 n 变换、不需要 poToken。
"""
import json
import os
from vr_testenv import work_root
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp  # noqa: E402

CHROME = r"C:\Users\XPENG\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe"
PORT = 9405
PROFILE = os.path.join(work_root(), "profiles", "yt-sabr")
PROXY = "http://127.0.0.1:7897"
VIDEO = sys.argv[1] if len(sys.argv) > 1 else "LXb3EKWsInQ"   # Costa Rica 4K


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


def drain(cdp, seconds):
    """把 ws 上积压的事件读出来（Cdp.send 只在等命令回包时才收事件）"""
    end = time.time() + seconds
    cdp.ws.settimeout(0.3)
    try:
        while time.time() < end:
            try:
                raw = cdp.ws.recv()
            except Exception:
                continue
            if not raw:
                continue
            try:
                r = json.loads(raw)
            except Exception:
                continue
            if r.get("method"):
                cdp.events.append(r)
    finally:
        cdp.ws.settimeout(120)


def ump_parts(buf):
    """UMP 分片：1 字节 type + varint 长度 + payload"""
    out, i, n = [], 0, len(buf)
    while i < n:
        t = buf[i]
        i += 1
        size = 0
        shift = 0
        while i < n:
            b = buf[i]
            i += 1
            size |= (b & 0x7F) << shift
            if not (b & 0x80):
                break
            shift += 7
        payload = buf[i:i + size]
        i += size
        out.append((t, size, payload))
        if len(out) > 4000:
            break
    return out


def main():
    os.makedirs(PROFILE, exist_ok=True)
    proc = subprocess.Popen([
        CHROME, f"--remote-debugging-port={PORT}", f"--user-data-dir={PROFILE}",
        f"--proxy-server={PROXY}", "--no-first-run", "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
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
        cdp.send("Network.enable", {"maxPostDataSize": 200000}, sid)
        cdp.send("Network.setCookie", {"name": "CONSENT", "value": "YES+cb",
                                       "domain": ".youtube.com", "path": "/"}, sid)
        url = f"https://www.youtube.com/watch?v={VIDEO}&hl=en"
        print("[1] 打开 %s" % url)
        cdp.send("Page.navigate", {"url": url}, sid)
        if not cdp.wait_js(sid, "!!(window.ytInitialPlayerResponse && "
                                "ytInitialPlayerResponse.streamingData)", timeout=45):
            print("    页面没就绪")
            return 2

        print("[2] 起播并泵事件 10s，让播放器自己发 SABR 请求")
        cdp.eval("(()=>{const v=document.querySelector('video');if(v){v.muted=true;"
                 "v.play().catch(()=>{});}return 1})()", sid)
        drain(cdp, 10)

        print("[3] 抓 videoplayback POST 请求体")
        cap = []
        for e in cdp.events:
            if e.get("method") != "Network.requestWillBeSent":
                continue
            req = e["params"].get("request") or {}
            u = req.get("url", "")
            if "videoplayback" not in u:
                continue
            cap.append({
                "url": u, "method": req.get("method"),
                "headers": req.get("headers") or {},
                "body": req.get("postData") or "",
                "sabr": "sabr=1" in u,
            })
        print("    抓到 %d 个 videoplayback，其中 SABR %d 个" % (
            len(cap), sum(1 for c in cap if c["sabr"])))
        if not cap:
            return 3

        sabr = [c for c in cap if c["sabr"]] or cap
        best = max(sabr, key=lambda c: len(c["body"]))
        print("    请求体长度 =", len(best["body"]))
        open(os.path.join(work_root(), "_sabr_body.bin"), "wb").write(best["body"].encode("latin-1"))
        open(os.path.join(work_root(), "_sabr_url.txt"), "w").write(best["url"])
        print("    关键头 =", json.dumps({k: v for k, v in best["headers"].items()
                                         if k.lower() in
                                         ("content-type", "user-agent", "origin",
                                          "x-goog-visitor-id", "range")}, ensure_ascii=False)[:300])

        # 用 python 复放（requests 走代理）
        import requests
        r = requests.post(best["url"], data=best["body"].encode("latin-1"),
                          headers={"Content-Type": best["headers"].get("content-type",
                                                                       "application/x-protobuf")},
                          proxies={"http": PROXY, "https": PROXY}, timeout=40, stream=True)
        print("\n[4] 复放结果: status=%s type=%s" % (r.status_code, r.headers.get("content-type")))
        if r.status_code != 200:
            print("    body:", r.raw.read(300))
            return 4

        raw = b""
        t0 = time.time()
        for chunk in r.iter_content(65536):
            raw += chunk
            if len(raw) > 3_000_000 or time.time() - t0 > 15:
                break
        print("    收到 %d 字节（%.2fs）" % (len(raw), time.time() - t0))

        parts = ump_parts(raw)
        print("    UMP 分片数 =", len(parts))
        from collections import Counter
        cnt = Counter(p[0] for p in parts)
        print("    分片类型分布 =", dict(sorted(cnt.items())))
        media = [(t, s, p) for t, s, p in parts if b"ftyp" in p[:64] or b"moof" in p[:64]
                 or b"mdat" in p[:64]]
        print("    含 MP4 box 的分片 =", len(media))
        for t, s, p in parts[:10]:
            head = p[:24]
            print("      type=0x%02x size=%-7d head=%r" % (t, s, head))
        if media:
            first = media[0][2]
            print("\n    ★ 成功：第一个媒体分片 box =", first[4:8],
                  "| 总媒体字节 =", sum(s for _, s, _ in media))
            open(os.path.join(work_root(), "_sabr_media.bin"), "wb").write(b"".join(p for _, _, p in media))
            print("    已存 .work/_sabr_media.bin")
        else:
            txt = [p.decode("utf-8", "replace") for _, _, p in parts[:6]]
            print("    未见媒体 box，前几个 payload 文本 =", txt[:4])

        json.dump({"requests": [{k: v for k, v in c.items() if k != "body"} |
                                {"body_len": len(c["body"]),
                                 "body_head": c["body"][:200]} for c in cap]},
                  open(os.path.join(work_root(), "yt-sabr.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
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
