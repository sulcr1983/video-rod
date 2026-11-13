# -*- coding: utf-8 -*-
"""媒体面板「视频封面 + 常驻浮标」真机验证。

验证 2026-11-13 苏哥两处反馈：
  ① 视频条目只有 ▶ 占位、没有画面  → 现在应画真封面（poster / og:image）
  ② 页面上（尤其视频页）看不到入口 → 浮标应常驻，图片 0 张也显示

只读：不下载、不删除。
用法：python tools/media-panel-cover-e2e.py --url https://x.com/NASA/media
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
from cdp_client import Cdp  # noqa: E402

results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "  got=%r expect=%r" % (got, expect)))


def reload_ext(cdp):
    ex = cdp.send("Target.createTarget", {"url": "chrome://extensions/"})["targetId"]
    esid = cdp.attach(ex)
    cdp.send("Runtime.enable", {}, esid)
    time.sleep(2.5)
    r = cdp.eval("""
    new Promise(resolve => {
      const mgr = document.querySelector('extensions-manager');
      const list = mgr && mgr.shadowRoot.querySelector('extensions-item-list');
      if (!list) { resolve('no-list'); return; }
      const it = [...list.shadowRoot.querySelectorAll('extensions-item')]
        .find(x => ((x.shadowRoot.querySelector('#name')||{}).textContent||'').includes('钓鱼竿'));
      if (!it) { resolve('no-ext'); return; }
      const btn = it.shadowRoot.querySelector('#dev-reload-button');
      if (!btn) { resolve('no-btn'); return; }
      btn.click(); resolve('ok');
    })
    """, esid)
    print("    重载扩展:", r)
    try:
        cdp.send("Target.closeTarget", {"targetId": ex})
    except Exception:
        pass
    time.sleep(3)
    return r == "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://x.com/NASA/media")
    ap.add_argument("--port", type=int, default=9223)
    ap.add_argument("--wait", type=int, default=16)
    a = ap.parse_args()

    cdp = Cdp("http://127.0.0.1:%d" % a.port)
    try:
        reload_ext(cdp)
    except Exception as e:
        print("    重载失败（继续）:", e)

    tid = cdp.send("Target.createTarget", {"url": a.url})["targetId"]
    sid = cdp.attach(tid)
    cdp.send("Runtime.enable", {}, sid)
    cdp.send("Page.enable", {}, sid)
    cdp.send("Page.navigate", {"url": a.url}, sid)
    print("[1] 打开", a.url)
    time.sleep(a.wait)

    # ① 浮标常驻：面板宿主是否在、浮标是否 on
    fb = cdp.eval("""
    (() => {
      const host = document.querySelector('[data-vr-img-panel]');
      if (!host || !host.shadowRoot) return JSON.stringify({host: !!host});
      const f = host.shadowRoot.querySelector('.vr-float');
      const n = host.shadowRoot.querySelector('.vr-float .n');
      return JSON.stringify({
        host: true,
        hasFloat: !!f,
        on: f ? f.classList.contains('on') : null,
        num: n ? n.textContent : '',
        display: f ? getComputedStyle(f).display : ''
      });
    })()
    """, sid)
    d = json.loads(fb or "{}")
    print("    浮标:", json.dumps(d, ensure_ascii=False))
    check("1 面板宿主已注入", d.get("host"), True)
    check("2 浮标存在且常驻显示", d.get("on"), True)

    # ② 打开面板，切到视频类型，检查封面
    cdp.eval("""
    (() => {
      const host = document.querySelector('[data-vr-img-panel]');
      const f = host && host.shadowRoot && host.shadowRoot.querySelector('.vr-float');
      if (f) f.click();
      return 1;
    })()
    """, sid)
    time.sleep(2.0)

    types = cdp.eval("""
    (() => {
      const host = document.querySelector('[data-vr-img-panel]');
      if (!host || !host.shadowRoot) return 'no-host';
      const r = host.shadowRoot;
      const btns = [...r.querySelectorAll('[data-type]')];
      return JSON.stringify(btns.map(b => ({k: b.getAttribute('data-type'), t: b.textContent.trim()})));
    })()
    """, sid)
    print("    类型栏:", types)

    # 切到视频（如果有）
    cdp.eval("""
    (() => {
      const host = document.querySelector('[data-vr-img-panel]');
      if (!host || !host.shadowRoot) return 0;
      const b = host.shadowRoot.querySelector('[data-type="video"]');
      if (b) b.click();
      return 1;
    })()
    """, sid)
    time.sleep(2.5)

    cards = cdp.eval("""
    (() => {
      const host = document.querySelector('[data-vr-img-panel]');
      if (!host || !host.shadowRoot) return 'no-host';
      const r = host.shadowRoot;
      const cells = [...r.querySelectorAll('.vr-cell')];
      const withImg = cells.filter(c => c.querySelector('img.ip-thumb, img')).length;
      const withPh = cells.filter(c => c.querySelector('.vr-ph, .vr-media-ph, .ip-media-ph')).length;
      const sample = cells.slice(0, 3).map(c => {
        const im = c.querySelector('img');
        return im ? String(im.src).slice(0, 90) : '(no-img)';
      });
      return JSON.stringify({cells: cells.length, withImg, withPh, sample});
    })()
    """, sid)
    v = json.loads(cards or "{}")
    print("    视频卡片:", json.dumps(v, ensure_ascii=False)[:500])
    if v.get("cells", 0) > 0:
        check("3 视频卡片有真实封面", v.get("withImg", 0) > 0, True)

    ours = [e for e in cdp.errors() if "image-page" in e or "image-panel" in e]
    check("4 我们的代码无异常", len(ours), 0)
    for e in ours:
        print("    ERR", e[:200])

    print("\n%d/%d PASS" % (sum(1 for r in results if r[0]), len(results)))
    try:
        cdp.send("Target.closeTarget", {"targetId": tid})
    except Exception:
        pass
    return 0 if all(r[0] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())