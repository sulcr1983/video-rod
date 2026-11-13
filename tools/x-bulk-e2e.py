# -*- coding: utf-8 -*-
"""推特「抓取全部」真机验收（只读抓取，不下载）

流程：重载扩展 → 打开博主主页 → 等面板 → 点「抓取全部」→ 观察条目增长 → 截图。

铁律：单页、不循环、只抓取不下载；验证完保留证据。
用法：python tools/x-bulk-e2e.py --url https://x.com/NASA/media
"""
import argparse
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, ".tmp", "x-bulk-e2e")
EXT_ID = "ceogmckiinjolbbdkjfelmfcfepccabp"

results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "  got=%r expect=%r" % (got, expect)))


def shot(cdp, sid, path):
    try:
        s = cdp.send("Page.captureScreenshot", {"format": "png"}, sid)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(base64.b64decode(s["data"]))
        return path
    except Exception as e:
        return "shot failed: %s" % e


def reload_ext(cdp):
    ex = cdp.send("Target.createTarget", {"url": "chrome://extensions/"})["targetId"]
    sid = cdp.attach(ex)
    cdp.send("Runtime.enable", {}, sid)
    time.sleep(2.5)
    r = cdp.eval("""
    new Promise(resolve => {
      const mgr = document.querySelector('extensions-manager');
      const list = mgr && mgr.shadowRoot.querySelector('extensions-item-list');
      if (!list) { resolve('no-list'); return; }
      const items = [...list.shadowRoot.querySelectorAll('extensions-item')];
      const it = items.find(x => (x.shadowRoot.querySelector('#name')||{}).textContent.includes('钓鱼竿'));
      if (!it) { resolve('no-ext'); return; }
      const btn = it.shadowRoot.querySelector('#dev-reload-button');
      if (!btn) { resolve('no-btn'); return; }
      btn.click();
      resolve('ok');
    })
    """, sid)
    print("    重载扩展:", r)
    try:
        cdp.send("Target.closeTarget", {"targetId": ex})
    except Exception:
        pass
    time.sleep(2.5)
    return r == "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://x.com/NASA/media")
    ap.add_argument("--port", type=int, default=9223)
    ap.add_argument("--wait", type=int, default=16)
    ap.add_argument("--rounds", type=int, default=12, help="最多等几轮（每轮 2s）")
    a = ap.parse_args()

    cdp = Cdp("http://127.0.0.1:%d" % a.port)
    ok_reload = reload_ext(cdp)
    check("1 扩展重载", ok_reload, True)

    tid = cdp.send("Target.createTarget", {"url": a.url})["targetId"]
    sid = cdp.attach(tid)
    cdp.send("Runtime.enable", {}, sid)
    cdp.send("Page.enable", {}, sid)
    cdp.send("Page.navigate", {"url": a.url}, sid)
    print("[1] 打开", a.url)
    time.sleep(a.wait)

    # hook 是否装好
    hook = cdp.eval("!!(window.__vrXTimelineHook && window.__vrXTimelineHook.ready)", sid)
    check("2 MAIN world hook 已装", hook, True)
    print("    hook 统计:", cdp.eval("JSON.stringify(window.__vrXTimelineHook||{})", sid))

    # 面板是否注入
    panel = cdp.eval("!!document.querySelector('.vr-bulk-panel')", sid)
    check("3 面板已注入", panel, True)
    if not panel:
        print("    面板未注入，后续跳过")
        print("\n%d/%d PASS" % (sum(1 for r in results if r[0]), len(results)))
        return 1

    has_btn = cdp.eval("!!document.querySelector('.vr-bulk-panel [data-act=\"xFetchAll\"]')", sid)
    check("4 「抓取全部」按钮存在", has_btn, True)

    # 点击抓取全部
    clicked = cdp.eval("""
    (() => {
      const b = document.querySelector('.vr-bulk-panel [data-act="xFetchAll"]');
      if (!b) return false;
      b.click();
      return true;
    })()
    """, sid)
    check("5 点击「抓取全部」", clicked, True)

    # 观察条目增长
    counts = []
    for i in range(a.rounds):
        time.sleep(2)
        n = cdp.eval("""
        (() => {
          const rows = document.querySelectorAll('.vr-bulk-panel .vr-bulk-row').length;
          const btn = document.querySelector('.vr-bulk-btn');
          const st = document.querySelector('.vr-bulk-panel .vr-bulk-status');
          return JSON.stringify({rows, btn: btn ? btn.textContent : '', st: st ? st.textContent : ''});
        })()
        """, sid)
        try:
            d = json.loads(n)
        except Exception:
            d = {"raw": n}
        counts.append(d)
        print("    第 %d 轮: rows=%s btn=%r st=%r" % (i + 1, d.get("rows"), d.get("btn"), d.get("st")))
        if i >= 2 and d.get("rows") and "抓取中" not in (d.get("btn") or ""):
            break

    # 打开面板才能看到 rows（面板未打开时 rows=0），改看按钮计数
    final_btn = cdp.eval("(document.querySelector('.vr-bulk-btn')||{}).textContent || ''", sid)
    nums = [int(x) for x in __import__("re").findall(r"\((\d+)\)", final_btn)]
    got_n = max(nums) if nums else 0
    check("6 抓到条目", got_n > 0, True)
    print("    最终按钮文案:", final_btn)

    # 打开面板看内容与停止
    cdp.eval("""
    (() => { const b = document.querySelector('.vr-bulk-btn'); if (b) b.click(); return 1; })()
    """, sid)
    time.sleep(1.5)
    rows = cdp.eval("document.querySelectorAll('.vr-bulk-panel .vr-bulk-row').length", sid)
    check("7 面板有可见条目", rows > 0, True)
    print("    可见行数:", rows)

    p = shot(cdp, sid, os.path.join(OUT, "x-bulk-live.png"))
    print("[2] 截图:", p)

    # 只统计「来自我们代码」的异常：X 自身在首屏就会抛
    # "Error processing XMLHttpRequest response"（不滚动也有 10 条，已 A/B 对照），
    # 属于站点噪音，不能作为我们的回归判据。
    ours = [e for e in cdp.errors()
            if EXT_ID in e or "twitter-timeline" in e or "bulk-profile" in e]
    check("8 我们的代码无异常", len(ours), 0)
    for e in ours:
        print("    OUR-ERR", e[:200])
    noise = len(cdp.errors()) - len(ours)
    print("    （站点自有噪音异常 %d 条，已排除）" % noise)

    print("\n%d/%d PASS" % (sum(1 for r in results if r[0]), len(results)))
    return 0 if all(r[0] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
