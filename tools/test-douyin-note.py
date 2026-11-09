# 抖音图文页（/note/<id>）图片入口 + 侧边栏扫描 真机验收
# 用法：python tools/test-douyin-note.py [url]
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

URL = sys.argv[1] if len(sys.argv) > 1 else \
    "https://www.douyin.com/note/7705250862063743461"

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

    # 0) 热重载扩展（改了 manifest/content script 必须重载，否则页面注入的还是旧代码）
    ext_id, sw = find_ext_id(cdp)
    if not sw:
        print("!! 找不到扩展 SW")
        return
    sid = cdp.attach(sw["targetId"])
    cdp.send("Runtime.enable", {}, sid)
    try:
        cdp.eval("chrome.runtime.reload(); 1", sid)
    except Exception:
        pass
    time.sleep(3.5)
    ext_id, sw = find_ext_id(cdp)
    print("extId:", ext_id)
    sid = cdp.attach(sw["targetId"])
    cdp.send("Runtime.enable", {}, sid)
    m = cdp.eval("JSON.stringify((chrome.runtime.getManifest().content_scripts||[])"
                 ".map(c=>(c.js||[]).join('|')))", sid)
    check("T0 manifest 已载入 douyin-note", "douyin-note.js" in str(m))

    # 1) 打开图文页
    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    psid = cdp.attach(tid)
    for x in ("Runtime.enable", "Page.enable", "Network.enable"):
        cdp.send(x, {}, psid)
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True}, psid)
    cdp.send("Page.navigate", {"url": URL}, psid)
    cdp.wait_ready(psid, 20)
    time.sleep(9)

    tab_id = cdp.eval("""
      new Promise(r => chrome.tabs.query({}, ts => {
        const t = ts.find(x => (x.url||'').indexOf('/note/') >= 0 && (x.url||'').indexOf('7705250862063743461') >= 0);
        r(t ? t.id : -1);
      }))
    """, sid)
    print("tabId:", tab_id)
    check("T1 打开图文页", tab_id > 0, "tabId=%s" % tab_id)

    # 2) 浮层按钮
    probe = r"""
    (() => {
      const h = document.getElementById('vr-note-host');
      if (!h || !h.shadowRoot) { return JSON.stringify({found: false}); }
      const b = h.shadowRoot.querySelector('.vr-nd');
      if (!b) { return JSON.stringify({found: false}); }
      const r = b.getBoundingClientRect();
      return JSON.stringify({
        found: true, cls: b.className, n: (h.shadowRoot.querySelector('.n')||{}).textContent,
        txt: (h.shadowRoot.querySelector('.t')||{}).textContent,
        title: b.title, w: Math.round(r.width), h: Math.round(r.height),
        x: Math.round(r.left), y: Math.round(r.top),
        inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
        vw: innerWidth, vh: innerHeight
      });
    })()
    """
    st = cdp.wait_js(psid, probe + "", timeout=12)
    data = {}
    try:
        data = json.loads(cdp.eval(probe, psid))
    except Exception:
        data = {"found": False}
    # 定位是 rAF 里做的：刚挂上时可能还没跑，等一拍再读
    for _ in range(10):
        if data.get("x", 0) > 0 and data.get("y", 0) > 0:
            break
        time.sleep(0.3)
        try:
            data = json.loads(cdp.eval(probe, psid))
        except Exception:
            pass
    print("BUTTON:", json.dumps(data, ensure_ascii=False))
    check("T2 页面出现图文下载按钮", bool(data.get("found")))
    check("T3 按钮显示张数 = 15", str(data.get("n")) == "15", "n=%s" % data.get("n"))
    check("T4 按钮坐标在视口内", bool(data.get("inView")),
          "%sx%s @(%s,%s) vp=%sx%s" % (data.get("w"), data.get("h"), data.get("x"),
                                       data.get("y"), data.get("vw"), data.get("vh")))

    # 3) 点按钮 → 批量下载
    #    注意：图片走 FSA 直写（不是 chrome.downloads），只能查磁盘。
    root = "D:/personal/Downloads/video-rod"
    # 清掉「抖音图床」的去重记录：否则同一批签名 URL 会被判定「下过了」直接跳过，
    # 测不出落盘链路。**只在作品文件夹还不完整时清**，避免重复跑往同一目录塞副本。
    have = 0
    for dirpath, _dn, _fn in os.walk(os.path.join(root, "抖音")):
        if "摄影师沙皮" in dirpath and "舞蹈少女" in dirpath:
            have = max(have, len([x for x in os.listdir(dirpath)
                                  if x.lower().endswith((".jpeg", ".jpg", ".webp", ".png"))]))
    if have < 15:
        cdp.eval("""
          new Promise(r => chrome.storage.local.get('vrImgDownloaded', o => {
            const m = (o && o.vrImgDownloaded) || {};
            let n = 0;
            Object.keys(m).forEach(k => { if (k.indexOf('douyinpic') >= 0) { delete m[k]; n++; } });
            chrome.storage.local.set({ vrImgDownloaded: m }, () => r(n));
          }))
        """, sid)
    t0 = time.time()
    cdp.eval("document.getElementById('vr-note-host').shadowRoot.querySelector('.vr-nd').click(); 1", psid)
    time.sleep(1.5)
    st2 = cdp.eval("document.getElementById('vr-note-host').shadowRoot.querySelector('.vr-nd').className", psid)
    check("T5 点击后有反应（busy 或直接 done）", "busy" in str(st2) or "done" in str(st2), str(st2))
    # 终态文案必须说清「新下」还是「已存在」——2026-11-09 苏哥报「点了没反应」，
    # 根因就是全跳过时也显示「已下载 15 张」。
    # 2026-11-09 二修后：内容判重会「先落盘、算指纹、命中就删」，15 张要跑好几秒，
    # 所以必须轮询等终态，不能点完 1.5s 就读文案（那时还是「正在下载…」）。
    txt = ""
    for _ in range(40):
        time.sleep(1)
        txt = cdp.eval("document.getElementById('vr-note-host').shadowRoot.querySelector('.vr-nd').textContent", psid)
        if "已存在" in str(txt) or "已下载" in str(txt) or "新下" in str(txt) or "失败" in str(txt):
            break
    toast = cdp.eval("""(()=>{const pg=document.getElementById('vr-img-batch-host');
      if(!pg||!pg.shadowRoot) return '';
      return [...pg.shadowRoot.querySelectorAll('div')].map(n=>n.childElementCount? '' : n.textContent.trim())
        .filter(t=>t.indexOf('之前下过')>=0 || t.indexOf('已下载')>=0).join('|');})()""", psid)
    print("TERMINAL:", txt, "|", toast)
    check("T5b 终态文案区分「已存在/已下载」",
          ("已存在" in str(txt)) or ("已下载" in str(txt)) or ("新下" in str(txt)), str(txt))
    check("T5c 有明确提示（toast 或进度条）",
          len(str(toast)) > 0 or "已存在" in str(txt) or "已下载" in str(txt), str(toast))

    # 等落盘（最多 40s）。判据=作品文件夹里的成品张数（不是 chrome.downloads：
    # 图片走 FSA 直写，下载记录里根本没有条目）。已下载去重会让重复跑不再写盘，
    # 所以按「文件夹最终状态」验收，而不是「本次新增」。
    files = []
    for _ in range(20):
        time.sleep(2)
        for dirpath, dn, _fns in os.walk(os.path.join(root, "抖音")):
            if "舞蹈少女" not in dirpath:
                continue
            got = []
            for fn in os.listdir(dirpath):
                p = os.path.join(dirpath, fn)
                if os.path.isfile(p) and fn.lower().endswith((".jpeg", ".jpg", ".webp", ".png")):
                    got.append((p, os.path.getsize(p)))
            if len(got) > len(files):
                files = got
        if len(files) >= 15:
            break
    print("FILES:", json.dumps([(os.path.basename(p), s) for p, s in files[:6]], ensure_ascii=False))
    ok = [(p, s) for p, s in files if s > 5000]
    check("T6 落盘张数 = 15", len(files) >= 15, "files=%d" % len(files))
    check("T7 文件有实际字节（>5KB）", len(ok) == len(files) and len(files) > 0,
          "min=%s" % (min([s for _p, s in files]) if files else 0))
    names = [os.path.basename(p) for p, _s in files]
    check("T8 文件名带 01–15 序号",
          all(any("_%02d" % i in n for n in names) for i in range(1, 16)) if len(files) >= 15 else False)
    check("T9 归档含作者目录（摄影师沙皮）",
          any("摄影师沙皮" in p for p, _s in files),
          os.path.dirname(files[0][0]).replace(root, '') if files else '')

    # 4) 侧边栏扫描（同一 tab）
    panel = cdp.send("Target.createTarget",
                     {"url": "chrome-extension://%s/image.html?tabId=%s" % (ext_id, tab_id)})["targetId"]
    nsid = cdp.attach(panel)
    cdp.send("Runtime.enable", {}, nsid)
    cdp.wait_ready(nsid, 15)
    time.sleep(6)
    scan = cdp.eval("""
      (() => {
        const cells = document.querySelectorAll('#ipGrid .ip-cell');
        const cnt = (document.getElementById('ipCount')||{}).textContent || '';
        const tiers = [...document.querySelectorAll('#ipTiers .ip-tier')].map(b => b.textContent.trim());
        const unknown = [...cells].filter(c => /尺寸未知/.test(c.textContent)).length;
        return JSON.stringify({cells: cells.length, cnt: cnt, tiers: tiers, unknown: unknown});
      })()
    """, nsid)
    print("PANEL:", scan)
    try:
        sd = json.loads(scan)
    except Exception:
        sd = {}
    check("T10 侧边栏扫到本页图片", (sd.get("cells") or 0) > 0, str(sd.get("cnt")))

    cdp.send("Target.closeTarget", {"targetId": panel})
    cdp.send("Target.closeTarget", {"targetId": tid})

    print("\nRESULT: %d/%d PASS" % (PASS, PASS + FAIL))


if __name__ == "__main__":
    main()
