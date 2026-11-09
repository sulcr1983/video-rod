# 档位行布局验收：侧边栏宽度(390×900)下 5 个档位是否全部可见、可点
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

PAGE = "http://127.0.0.1:18080/images.html"
OUT = "deliverables/assets/2026-11-09-sidebar-tiers.png"


def main():
    cdp = Cdp("http://127.0.0.1:9480")
    ext, sw = find_ext_id(cdp)
    sid = cdp.attach(sw["targetId"])
    cdp.send("Runtime.enable", {}, sid)
    try:
        cdp.eval("chrome.runtime.reload(); 1", sid)
    except Exception:
        pass
    time.sleep(3.5)
    ext, sw = find_ext_id(cdp)
    sid = cdp.attach(sw["targetId"])      # reload 换了 SW，必须重新 attach
    cdp.send("Runtime.enable", {}, sid)

    # 目标网页
    tid = cdp.send("Target.createTarget", {"url": PAGE})["targetId"]
    psid = cdp.attach(tid)
    cdp.send("Runtime.enable", {}, psid)
    cdp.wait_ready(psid, 15)
    time.sleep(2)
    tab_id = cdp.eval("""
      new Promise(r => chrome.tabs.query({}, ts => {
        const t = ts.find(x => (x.url||'').indexOf('18080/images.html') >= 0);
        r(t ? t.id : -1);
      }))
    """, sid)
    print("tabId:", tab_id)

    # 侧边栏页，按真实侧栏宽度渲染
    panel = cdp.send("Target.createTarget",
                     {"url": "chrome-extension://%s/image.html?tabId=%s" % (ext, tab_id)})["targetId"]
    nsid = cdp.attach(panel)
    cdp.send("Runtime.enable", {}, nsid)
    cdp.send("Page.enable", {}, nsid)
    cdp.send("Emulation.setDeviceMetricsOverride",
             {"width": 390, "height": 780, "deviceScaleFactor": 1, "mobile": False}, nsid)
    cdp.wait_ready(nsid, 15)
    time.sleep(6)

    info = cdp.eval("""
      (() => {
        const box = document.getElementById('ipTiers');
        if (!box) { return JSON.stringify({err: 'no tiers'}); }
        const br = box.getBoundingClientRect();
        const bs = [...box.querySelectorAll('.ip-tier')];
        const rows = {};
        const items = bs.map(b => {
          const r = b.getBoundingClientRect();
          rows[Math.round(r.top)] = 1;
          return { t: b.textContent.trim(), x: Math.round(r.left), y: Math.round(r.top),
                   w: Math.round(r.width), h: Math.round(r.height),
                   inside: r.left >= br.left - 1 && r.right <= br.right + 1 };
        });
        const cs = getComputedStyle(box);
        return JSON.stringify({
          n: bs.length, rows: Object.keys(rows).length,
          boxW: Math.round(br.width), boxH: Math.round(br.height),
          wrap: cs.flexWrap, overflowX: cs.overflowX,
          allInside: items.every(i => i.inside), items
        });
      })()
    """, nsid)
    print("TIERS:", info)
    print("STATE:", cdp.eval("""JSON.stringify({
      count: (document.getElementById('ipCount')||{}).textContent,
      empty: (document.getElementById('ipEmpty')||{}).textContent.slice(0,60),
      cells: document.querySelectorAll('.ip-cell').length,
      sum: (document.getElementById('ipSum')||{}).textContent.slice(0,40)
    })""", nsid))

    shot = cdp.send("Page.captureScreenshot", {"format": "png"}, nsid)
    open(OUT, "wb").write(base64.b64decode(shot["data"]))
    print("saved:", OUT)
    cdp.send("Target.closeTarget", {"targetId": panel})
    cdp.send("Target.closeTarget", {"targetId": tid})


if __name__ == "__main__":
    main()
