# -*- coding: utf-8 -*-
"""微博「抓取全部」真机验收（只抓取，不下载）。

验证：面板注入 → 点抓取全部 → 接口分页推进 → 条目增长 → 手动停止。
控制页数：点停止即可，避免触发风控。
"""
import json
import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
from cdp_client import Cdp  # noqa: E402

results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "  got=%r expect=%r" % (got, expect)))


def reload_ext(cdp):
    """重载本扩展，让 js/bulk-profile.js 的改动生效（MV3 必须重载）。"""
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
      btn.click();
      resolve('ok');
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
    url = sys.argv[1] if len(sys.argv) > 1 else "https://weibo.com/u/2803301701"
    cdp = Cdp("http://127.0.0.1:9223")
    print("    扩展已存在则先重载，确保跑的是当前代码")
    try:
        reload_ext(cdp)
    except Exception as e:
        print("    重载失败（继续）:", e)
    tid = cdp.send("Target.createTarget", {"url": url})["targetId"]
    sid = cdp.attach(tid)
    cdp.send("Runtime.enable", {}, sid)
    cdp.send("Page.enable", {}, sid)
    time.sleep(14)

    panel = cdp.eval("!!document.querySelector('.vr-bulk-panel')", sid)
    check("1 面板已注入", panel, True)
    if not panel:
        print("\n%d/%d PASS" % (sum(1 for r in results if r[0]), len(results)))
        return 1

    has_btn = cdp.eval("!!document.querySelector('.vr-bulk-panel [data-act=\"xFetchAll\"]')", sid)
    check("2 微博面板有「抓取全部」", has_btn, True)

    # 打开面板
    cdp.eval("(()=>{const b=document.querySelector('.vr-bulk-btn'); if(b)b.click(); return 1})()", sid)
    time.sleep(1.2)

    cdp.eval("(()=>{const b=document.querySelector('.vr-bulk-panel [data-act=\"xFetchAll\"]'); if(b)b.click(); return 1})()", sid)

    counts = []
    for i in range(5):
        time.sleep(3)
        r = cdp.eval("""
        (() => {
          const btn = document.querySelector('.vr-bulk-btn');
          const st = document.querySelector('.vr-bulk-panel .vr-bulk-status');
          return JSON.stringify({btn: btn ? btn.textContent : '', st: st ? st.textContent : ''});
        })()
        """, sid)
        d = json.loads(r or "{}")
        counts.append(d)
        print("    第 %d 次: btn=%r st=%r" % (i + 1, d.get("btn"), d.get("st")))

    # 停止
    cdp.eval("(()=>{const b=document.querySelector('.vr-bulk-panel [data-act=\"xFetchAll\"]'); if(b)b.click(); return 1})()", sid)
    time.sleep(1.5)

    final = cdp.eval("(document.querySelector('.vr-bulk-btn')||{}).textContent||''", sid)
    import re
    nums = [int(x) for x in re.findall(r"\((\d+)\)", final)]
    got_n = max(nums) if nums else 0
    check("3 抓到条目", got_n > 0, True)
    print("    最终:", final)

    rows = cdp.eval("document.querySelectorAll('.vr-bulk-panel .vr-bulk-row').length", sid)
    check("4 面板有可见条目", rows > 0, True)

    # 抽查一条：图片应有 sinaimg 地址
    sample = cdp.eval("""
    (() => {
      const img = document.querySelector('.vr-bulk-panel .vr-bulk-row img');
      return img ? img.src.slice(0, 100) : '';
    })()
    """, sid)
    print("    缩略图样本:", sample[:90] if sample else "(无)")

    ours = [e for e in cdp.errors() if "bulk-profile" in e or "video-rod" in e]
    check("5 我们的代码无异常", len(ours), 0)

    print("\n%d/%d PASS" % (sum(1 for r in results if r[0]), len(results)))
    try:
        cdp.send("Target.closeTarget", {"targetId": tid})
    except Exception:
        pass
    return 0 if all(r[0] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
