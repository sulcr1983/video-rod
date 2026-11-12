#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
「抓图」弹窗验收（popup → 本页图片 → 保存选中）

为什么单独一个套件（2026-11-12，苏哥报「这个功能基本上不可用」）：
    微博信息流页面 53 张图，弹窗只列出 2 张、还都是打不开的背景广告位。
    根因是 popup 自己抄了一份扫描器，门槛写成「显示尺寸短边 ≥ 600」——
    信息流图片显示宽度就 300~500，全被 `continue` 掉。
    这个套件把当时的翻车形态做成夹具，锁死四条：
      ① 显示小、原图大（800×600 缩到 320px 展示）必须收进来
      ② CSS 背景图必须收进来
      ③ 占位 src（1x1）+ data-src 真图必须收进来
      ④ 明确 404 的坏图必须被剔除，不能混在列表里
      ⑤ 60×60 图标必须被尺寸门槛挡掉

跑法（由 tools/e2e-all.py 传入 --port）：
    python tools/e2e-grab.py --port 9480
"""
import argparse
import json
import os
import struct
import sys
import threading
import time
import zlib
import http.server

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, open_popup  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "deliverables", "assets")

results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f"   got={got!r} expect={expect!r}"))


def png(w, h, rgb=(198, 170, 120)):
    """最小 PNG 编码（不依赖 Pillow）：纯色块，尺寸真实可解码。"""
    row = bytes(rgb) * w
    raw = (b"\x00" + row) * h

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>抓图夹具 · 显示小原图大</title>
<style>body{font:14px system-ui;padding:16px;background:#fff}#feed{width:520px}
#feed img{display:block;margin:8px 0;border-radius:6px}</style></head>
<body>
<h1>抓图夹具</h1>
<!-- ① 显示小、原图大：真实微博信息流的形态（800×600 缩到 320 宽显示） -->
<img src="/img/800x600.png" style="width:320px">
<img src="/img/900x700.png" style="width:300px">
<img src="/img/1024x768.png" style="width:480px">
<img src="/img/1200x800.png" style="width:360px">
<img src="/img/700x900.png" style="width:280px">
<!-- ⑤ 图标：应被尺寸门槛挡掉 -->
<img src="/img/60x60.png" style="width:60px">
<!-- ③ 占位 src + data-src 真图（真占位型懒加载） -->
<img src="/img/1x1.png" data-src="/img/1000x750.png" style="width:340px">
<!-- ② CSS 背景图 -->
<div style="width:420px;height:300px;background-image:url('/img/900x600.png')"></div>
<!-- ④ 坏图：404，必须被剔除 -->
<img src="/missing.jpg" style="width:500px" alt="404">
</body></html>"""

IMG_RE = None


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            body, ctype, code = PAGE.encode("utf-8"), "text/html; charset=utf-8", 200
        elif path.startswith("/img/") and path.endswith(".png"):
            dims = path[len("/img/"):-4].split("x")
            try:
                w, h = int(dims[0]), int(dims[1])
                body, ctype, code = png(w, h), "image/png", 200
            except Exception:
                body, ctype, code = b"bad", "text/plain", 500
        else:
            # 统一 404：包括 /missing.jpg
            body, ctype, code = b"not found", "text/plain", 404
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def start_site():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


def shot(cdp, sid, path):
    time.sleep(1.0)
    try:
        s = cdp.send("Page.captureScreenshot", {"format": "png"}, sid)
        import base64
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(base64.b64decode(s["data"]))
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--ext", default="")
    a = ap.parse_args()

    port = start_site()
    page_url = "http://127.0.0.1:%d/" % port

    cdp = Cdp("http://127.0.0.1:%d" % a.port)
    psid, tab_id = open_popup(cdp, page_url)

    # 起跑线固定（TEST-PLAN §二「每例前复位状态」）。两件事：
    #   ① 钉掉一次性新手引导浮层 —— 不钉会盖住整个界面，截图只有「素材库在这」；
    #   ② 钉住扫描门槛与背景图开关 —— 前序套件（e2e-buttons 会逐个点设置开关）
    #      会把 imgMinSize / imgBgScan 改掉，导致整批跑时本套件红、单跑却绿。
    #      实测：整批 9/10、单跑 10/10，就是这一项没钉。
    try:
        cdp.eval(
            "new Promise(function(d){chrome.storage.local.get('vrLibSettings',function(o){"
            "var s=Object.assign({},o.vrLibSettings||{});"
            "s.imgMinSize=100;s.imgBgScan=true;s.imgHover=true;s.imgBatch=true;"
            "chrome.storage.local.set({vrLibSettings:s,vrLibIntroDone:true,vrLibIntroSeen:9},"
            "function(){d(1);});});})", psid)
        cdp.send("Page.reload", {}, psid)
        time.sleep(2.5)
    except Exception as e:
        print("  （钉起跑线失败，继续：%s）" % e)

    # 钉掉 popup 的一次性新手引导浮层。不钉的话它会盖住整个界面，
    # 截图拍出来只有「素材库在这」，看不到图片清单（视觉基线里踩过同一个坑）。
    try:
        cdp.eval("new Promise(function(d){chrome.storage.local.set("
                 "{vrLibIntroDone:true,vrLibIntroSeen:9},function(){d(1);});})", psid)
        cdp.send("Page.reload", {}, psid)
        time.sleep(2.5)
    except Exception as e:
        print("  （钉引导失败，继续：%s）" % e)

    # 必须把 popup 提到前台再做断言。
    # 缩略图是 loading="lazy" 的，后台标签页里懒加载**永不触发** ——
    # 整批跑时前序套件留下别的标签页，popup 不是 active tab，
    # 于是 7 张缩略图 naturalWidth 全 0、等 12 秒也不变（单跑却是好的）。
    try:
        cdp.send("Page.bringToFront", {}, psid)
        time.sleep(0.6)
    except Exception:
        pass

    # 点「抓图」→ 轮询到「弹窗有行 + 缩略图全部解码」为止（上限 12s）。
    #
    # 为什么不用固定 sleep：早先写死 4.2s，冷启动够、热缓存时缩略图有时还差一张，
    # 于是同一条断言「整批 9/10、单跑 10/10」（2026-11-12 实测）。轮询才是稳的。
    got = cdp.eval("""
      (() => {
        document.getElementById('vrScanImages').click();
        const t0 = Date.now();
        const snap = () => {
          const rows = document.querySelectorAll('#vrImgList .vrimg-row').length;
          const metas = [...document.querySelectorAll('#vrImgList .vrimg-meta')].map(e => e.textContent);
          const imgs = [...document.querySelectorAll('#vrImgList img')];
          return {
            cnt: (document.getElementById('vrImgCount') || {}).textContent,
            rows: rows,
            metas: metas,
            srcs: imgs.map(e => e.getAttribute('src')),
            loaded: imgs.filter(i => i.naturalWidth > 0).length,
            total: imgs.length,
            empty: (document.querySelector('#vrImgList div') || {}).textContent || ''
          };
        };
        return new Promise(r => {
          const tick = () => {
            const s = snap();
            const settled = s.rows > 0 && s.total > 0 && s.loaded === s.total;
            if ((settled && Date.now() - t0 > 2600) || Date.now() - t0 > 12000) { r(s); return; }
            setTimeout(tick, 250);
          };
          tick();
        });
      })()
    """, psid)

    if not isinstance(got, dict) or "__error" in got:
        print("FAIL  抓图弹窗没渲染出来：%r" % (got,))
        print("0/1 PASS")
        return 1

    # 调试：清单原样打出来（断言失败时靠它定位是哪一条混进来了）
    for _i, _s in enumerate(got.get("srcs") or []):
        print("  [%d] %s" % (_i + 1, _s))

    # 调试：清单原样打出来（断言失败时靠它定位是哪一条混进来了）
    for _i, _s in enumerate(got.get("srcs") or []):
        print("  [%d] %s" % (_i + 1, _s))

    rows = got.get("rows") or 0
    metas = got.get("metas") or []
    srcs = got.get("srcs") or []
    cnt = got.get("cnt")

    # ① 显示小/原图大的 5 张 + ③ 懒加载 1 张 + ② 背景图 1 张 = 7
    check("收图数量（显示小原图大也收）", rows, 7)
    check("计数文案与行数一致", str(cnt), str(rows))

    # ① 尺寸必须回填（不能一片「尺寸未知」）
    sized = [m for m in metas if "×" in m]
    check("尺寸已回填的行数", len(sized), rows)

    # ③ 懒加载的 data-src 真图进来了，占位 1x1 没进来
    check("懒加载真图（data-src）已收", any("/img/1000x750.png" in s for s in srcs), True)
    check("占位 1x1 未混入", any("1x1" in s for s in srcs), False)

    # ② 背景图进来了
    check("背景图已收", any("· 背景" in m for m in metas), True)

    # ④ 404 坏图被剔除
    check("404 坏图未混入", any("missing" in s for s in srcs), False)

    # ⑤ 60×60 图标被挡
    check("图标 60×60 未混入", "60×60" in " ".join(metas), False)

    # 缩略图：弹窗里的预览图必须真的加载出来（否则用户只能看尺寸文字，
    # 分不清哪张是哪张 —— 苏哥原截图的裂图就是这个位置）
    loaded, total = got.get("loaded") or 0, got.get("total") or 0
    if loaded != total:
        print("  缩略图 %d/%d 未全部加载（等满 12s 仍差 %d 张）"
              % (total - loaded, total, total - loaded))
    check("缩略图全部加载出来", loaded, total)

    # 弹窗本体可见
    visible = cdp.eval("(function(){var m=document.getElementById('vrImgModal');return !!m && m.classList.contains('on');})()", psid)
    check("弹窗已打开", visible, True)

    shot(cdp, psid, os.path.join(ASSETS, "e2e-grab-modal.png"))

    errs = cdp.errors()
    if errs:
        print("console 异常：")
        for e in errs:
            print("  " + e)

    total = len(results)
    passed = sum(1 for ok, *_ in results if ok)
    print("%d/%d PASS" % (passed, total))
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
