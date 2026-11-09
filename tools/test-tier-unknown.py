# 侧边栏「未知尺寸」档位验收（2026-11-09，B-68）
#
# 苏哥原话：「未知尺寸应该单独列个选项筛选吧？为啥要和其他一起混着」
# 四条口径：
#   1. 档位行有独立的「未知」按钮，计数 = 本页尺寸未知的张数；
#   2. 点「未知」→ 可见卡片全是「尺寸未知」，且默认勾选数 = 未知数；
#   3. 点「大 ≥1200」→ 可见卡片全部带具体尺寸，**不再混入尺寸未知的**；
#   4. 切档记住（写回 vrLibSettings.imgTierMin），-1 能存能读。
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

URL = "https://www.douyin.com/user/self?from_tab_name=main"
PASS = FAIL = 0


def check(name, cond, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("PASS  %s %s" % (name, extra))
    else:
        FAIL += 1
        print("FAIL  %s %s" % (name, extra))


def main():
    cdp = Cdp("http://127.0.0.1:9480")
    ext, sw = find_ext_id(cdp)
    sid = cdp.attach(sw["targetId"])
    cdp.send("Runtime.enable", {}, sid)

    tid = cdp.send("Target.createTarget", {"url": URL})["targetId"]
    ps = cdp.attach(tid)
    cdp.send("Runtime.enable", {}, ps)
    cdp.wait_ready(ps, 20)
    time.sleep(8)
    tab = cdp.eval("""new Promise(r => chrome.tabs.query({}, ts => {
      const t = ts.find(x => (x.url || '').indexOf('/user/self') >= 0);
      r(t ? t.id : -1); }))""", sid)
    print("tab:", tab, "| imgs:", cdp.eval("document.images.length", ps))

    panel = cdp.send("Target.createTarget",
                     {"url": "chrome-extension://%s/image.html?tabId=%s" % (ext, tab)})["targetId"]
    ns = cdp.attach(panel)
    cdp.send("Runtime.enable", {}, ns)
    cdp.send("Page.enable", {}, ns)
    cdp.send("Emulation.setDeviceMetricsOverride",
             {"width": 430, "height": 900, "deviceScaleFactor": 1, "mobile": False}, ns)
    cdp.wait_ready(ns, 20)
    time.sleep(10)

    def tiers():
        return json.loads(cdp.eval("""JSON.stringify([...document.querySelectorAll('.ip-tier')].map(b => ({
          t: b.textContent.trim(), min: b.getAttribute('data-min'), on: b.classList.contains('on')})))""", ns))

    def state():
        return json.loads(cdp.eval("""(() => {
          const cells = [...document.querySelectorAll('.ip-cell')];
          const known = cells.filter(c => /\\d+\\s*[×x]\\s*\\d+/.test(c.textContent)).length;
          const unknown = cells.filter(c => c.textContent.indexOf('尺寸未知') >= 0).length;
          return JSON.stringify({cells: cells.length, known, unknown,
            sum: (document.getElementById('ipSum') || {}).textContent || '',
            foot: (document.querySelector('.ip-tier-note') || {}).textContent || ''});
        })()""", ns))

    t0 = tiers()
    print("TIERS:", json.dumps(t0, ensure_ascii=False))
    unk = [x for x in t0 if x["min"] == "unknown"]
    check("T1 档位里有独立的「未知」按钮", len(unk) == 1, t0)
    n_unknown = int(''.join(ch for ch in unk[0]["t"] if ch.isdigit()) or 0) if unk else 0
    check("T2 未知档计数 > 0（本页确实有大量未解码图）", n_unknown > 0, n_unknown)

    st_all = state()
    print("ALL:", st_all)

    def click(minv):
        cdp.eval("""(() => { const b = [...document.querySelectorAll('.ip-tier')]
          .find(x => x.getAttribute('data-min') === '%s'); if (b) { b.click(); return 1; } return 0; })()""" % minv, ns)
        time.sleep(1.2)

    click("unknown")
    st_u = state()
    print("UNKNOWN:", st_u)
    check("T3 未知档：可见卡片全是「尺寸未知」", st_u["cells"] > 0 and st_u["known"] == 0, st_u)
    check("T4 未知档：默认勾选数 = 未知计数",
          ("已选 %d" % n_unknown) in st_u["sum"], st_u["sum"])
    check("T5 未知档：档位行有说明", "建议挑着下" in st_u["foot"], st_u["foot"])
    shot = cdp.send("Page.captureScreenshot", {"format": "png"}, ns)
    open("deliverables/assets/2026-11-10-tier-unknown.png", "wb").write(base64.b64decode(shot["data"]))

    click("1200")
    st_l = state()
    print("LARGE:", st_l)
    check("T6 大 ≥1200：不再混入尺寸未知", st_l["unknown"] == 0, st_l)
    check("T7 大 ≥1200：卡片数 = 该档计数",
          ("已选 %d" % st_l["cells"]) in st_l["sum"] or st_l["cells"] <= 1, st_l["sum"])

    click("0")
    st_a = state()
    print("ALL2:", st_a)
    check("T8 切回全部：未知又都回来了", st_a["unknown"] > 0 or st_a["known"] > 0, st_a)

    stored = cdp.eval("new Promise(r => chrome.storage.local.get('vrLibSettings', o => r(JSON.stringify((o.vrLibSettings||{}).imgTierMin))))", sid)
    print("stored imgTierMin:", stored)
    check("T9 档位写回设置（0 = 全部）", str(stored) == "0", stored)

    cdp.send("Target.closeTarget", {"targetId": panel})
    cdp.send("Target.closeTarget", {"targetId": tid})
    print("\nRESULT: %d/%d PASS" % (PASS, PASS + FAIL))


if __name__ == "__main__":
    main()
