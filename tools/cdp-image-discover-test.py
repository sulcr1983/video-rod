# video-rod 图片发现覆盖度验收
#
# 验证三条「竞品有、我们刚补上」的发现能力（见 docs/RESEARCH-COMPETITOR-IMAGE.md）：
#   A) <picture> 里的 <source srcset> —— img 只有兜底小图时能取到最大那张
#   B) CSS background-image —— img 标签里根本没有这张图
#   C) URL 带 resize 参数时能派生出无参数版本（候选链里出现无参地址）
#   D) 面板搜索支持 /正则/
#
# 前置：python -m http.server 18080（工作目录 test-site）+ 扩展
# 用法：VR_CDP=http://127.0.0.1:94xx python tools/cdp-image-discover-test.py
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

PAGE = os.environ.get("VR_DISCOVER_PAGE", "http://127.0.0.1:18080/discover.html")
results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name +
          ("" if ok else f"   got={got!r} expect={expect!r}"))


def ev(cdp, sid, js):
    r = cdp.eval(js, sid)
    if isinstance(r, dict) and "__error" in r:
        raise RuntimeError(r["__error"])
    return r


def set_settings(cdp, osid, patch):
    return ev(cdp, osid, """new Promise(r => chrome.storage.local.get('vrLibSettings', o => {
      const s = Object.assign({}, (o && o.vrLibSettings) || {}, %s);
      chrome.storage.local.set({vrLibSettings: s}, () => r(s));
    }))""" % json.dumps(patch))


def wait_setting(cdp, osid, key, expect, timeout=5.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        cur = ev(cdp, osid, """new Promise(r=>chrome.storage.local.get('vrLibSettings',
              o=>r((o&&o.vrLibSettings)||{})))""")
        if cur.get(key) == expect:
            return True
        time.sleep(0.1)
    return False


def open_panel(cdp, sid):
    ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      if (!h) { return false; }
      const f = h.shadowRoot.querySelector('.vr-float');
      if (!f) { return false; }
      f.dispatchEvent(new PointerEvent('pointerdown',
        {bubbles:true, pointerId:1, button:0, clientX:100, clientY:100}));
      f.dispatchEvent(new PointerEvent('pointerup',
        {bubbles:true, pointerId:1, button:0, clientX:100, clientY:100}));
      return true;
    })()""")
    time.sleep(0.6)


def panel_urls(cdp, sid):
    """面板网格里每张卡片的 URL（读 data-url 或 img src）"""
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      if (!h) { return null; }
      const sr = h.shadowRoot;
      const cards = sr.querySelectorAll('.vr-cell');
      const out = [];
      for (const c of cards) {
        const u = c.getAttribute('data-url');
        if (u) { out.push(u); continue; }
        const im = c.querySelector('img');
        if (im) { out.push(im.getAttribute('src') || ''); }
      }
      return out;
    })()""")


def main():
    cdp = Cdp()
    ext_id, _ = find_ext_id(cdp)
    check("A1 扩展已加载", bool(ext_id), True)
    if not ext_id:
        return finish(cdp)

    otid = cdp.send("Target.createTarget",
                    {"url": f"chrome-extension://{ext_id}/options.html"})["targetId"]
    osid = cdp.attach(otid)
    cdp.send("Runtime.enable", {}, osid)
    cdp.send("Page.enable", {}, osid)
    cdp.wait_js(osid, "!!chrome.downloads", 8)

    # 浮标默认关，本套要点面板 → 显式打开并等落库
    set_settings(cdp, osid, {"imgHover": True, "imgBatch": True, "imgPanel": True,
                             "imgBgScan": True, "imgMinSize": 100})
    check("A2 浮标已落库", wait_setting(cdp, osid, "imgPanel", True), True)

    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    sid = cdp.attach(tid)
    for m in ("Runtime.enable", "Page.enable", "Network.enable"):
        cdp.send(m, {}, sid)
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True}, sid)
    cdp.send("Emulation.setDeviceMetricsOverride",
             {"width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False}, sid)
    cdp.navigate(sid, PAGE)
    cdp.wait_js(sid, "[...document.images].every(i => i.complete)", 10.0)
    cdp.wait_js(sid, "!!document.getElementById('vr-img-panel-host')", 10.0)
    time.sleep(0.6)

    check("A3 夹具页加载（3 张 img）",
          ev(cdp, sid, "document.images.length"), 3)

    tab_id = ev(cdp, osid, """new Promise(r => chrome.tabs.query({url: '*://127.0.0.1/*'},
      t => { const h = (t || []).filter(x => (x.url || '').indexOf('discover.html') >= 0)[0];
             r(h ? h.id : 0); }))""")
    check("A4 找到夹具页 tab", bool(tab_id), True)

    # ---------------- B. 候选链：picture 与 resize 派生 ----------------
    # VRImageUtil 在内容脚本的隔离世界，页面主世界读不到 —— 必须用
    # chrome.scripting.executeScript 指定 world:'ISOLATED' 才能拿到（踩过）。
    cand = ev(cdp, osid, """new Promise(done => chrome.scripting.executeScript({
      target: {tabId: %d}, world: 'ISOLATED',
      func: function () {
        var U = self.VRImageUtil;
        if (!U) { return {err: 'no util'}; }
        var pick = function (sel) {
          var el = document.querySelector(sel);
          return el ? U.collectCandidates(el, document) : [];
        };
        return { pic: pick('#pimg'), sized: pick('#sized'), plain: pick('#plain') };
      }
    }, function (r) {
      if (chrome.runtime.lastError) { done({err: chrome.runtime.lastError.message}); return; }
      done((r && r[0] && r[0].result) || {err: 'empty'});
    }))""" % tab_id)
    if cand.get("err"):
        check("B0 内容脚本可用", cand.get("err"), None)
        return finish(cdp, osid)

    pic = cand.get("pic") or []
    sized = cand.get("sized") or []
    plain = cand.get("plain") or []

    check("B1 picture 候选含 1200w 大图",
          any("original-1200" in u for u in pic), True)
    check("B2 picture 候选第一项是 1200w（最大优先）",
          bool(pic) and "original-1200" in pic[0], True)

    # 断言要精确：原地址 cover.jpg?w=300&quality=80 也含 "cover.jpg"，
    # 用 `"w=" not in u` 会被原地址先匹配到 → 假失败。直接看「有没有完全无查询串的版本」。
    print("      sized 候选:", json.dumps(sized, ensure_ascii=False), flush=True)
    check("B3 带参图派生出无参地址",
          any("cover.jpg" in u and "?" not in u for u in sized), True)
    check("B4 无参图不产生派生（避免候选爆炸）",
          len(plain), 1)

    # ---------------- C. 面板：背景图被扫到 ----------------
    open_panel(cdp, sid)
    urls = panel_urls(cdp, sid)
    check("C1 面板已列出图片", isinstance(urls, list) and len(urls) > 0, True)
    urls = urls or []
    check("C2 背景图被扫到（img 里没有这张）",
          any("cover.jpg" in u for u in urls), True)
    check("C3 picture 大图在列表里",
          any("original-1200" in u for u in urls), True)

    # ---------------- D. 面板搜索支持正则 ----------------
    def search(kw):
        ev(cdp, sid, """(function(){
          const h = document.getElementById('vr-img-panel-host');
          const i = h.shadowRoot.querySelector('input.vr-kw');
          if (!i) { return false; }
          i.value = %s;
          i.dispatchEvent(new Event('input', {bubbles:true}));
          return true;
        })()""" % json.dumps(kw))
        time.sleep(0.5)
        return panel_urls(cdp, sid) or []

    sub = search("original-1200")
    check("D1 子串搜索生效", len(sub) > 0 and all("original-1200" in u for u in sub), True)

    re_hit = search("/sprite|original-1200/")
    check("D2 正则搜索生效",
          len(re_hit) > 0 and all(("sprite" in u or "original-1200" in u) for u in re_hit), True)

    re_bad = search("/[unclosed")
    check("D3 正则写错不崩（退回子串，无匹配则为空）",
          isinstance(re_bad, list), True)

    search("")   # 复原

    # ---------------- E. 关掉背景图开关后不再扫 ----------------
    set_settings(cdp, osid, {"imgBgScan": False})
    wait_setting(cdp, osid, "imgBgScan", False)
    cdp.reload(sid)
    cdp.wait_js(sid, "[...document.images].every(i => i.complete)", 10.0)
    cdp.wait_js(sid, "!!document.getElementById('vr-img-panel-host')", 10.0)
    time.sleep(0.5)
    open_panel(cdp, sid)
    urls2 = panel_urls(cdp, sid) or []
    check("E1 关掉背景图扫描后列表变少", len(urls2) < len(urls), True)
    check("E2 关掉后 img 仍能扫到", len(urls2) > 0, True)

    return finish(cdp, osid)


def cleanup(cdp, osid):
    ev(cdp, osid, "new Promise(r => chrome.storage.local.remove('vrLibSettings', () => r(1)))")


def finish(cdp, osid=None):
    if osid:
        try:
            cleanup(cdp, osid)
        except Exception:
            pass
    errs = cdp.errors()
    check("F1 控制台无 error/exception", errs, [])
    total = len(results)
    passed = sum(1 for r in results if r[0])
    print(f"\n===== {passed}/{total} 通过 =====")
    if errs:
        print("控制台：", errs[:5])
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print("\n脚本异常：", e)
        sys.exit(2)
