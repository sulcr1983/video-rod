# video-rod 悬停命中与小图过滤验收（修用户实测反馈）
#
# 对应两个真实缺陷：
#   1) 小显示尺寸的图（16/32/40px 图标、2px 细条、隐藏图）不该出悬停下载按钮
#      —— 早先只判 naturalWidth，一张 640x480 被 CSS 缩成 16px 显示仍然通过
#   2) 图片被遮罩（button/span）盖住时仍要能悬停出按钮
#      —— 早先只查 composedPath()，遮罩是兄弟/上层，路径里没有 IMG
#   3) 面板「×」和遮罩点击必须能关掉（closePanel 曾因 renderAll 抛错而失效）
#
# 前置：python -m http.server 18080（工作目录 test-site）+ 扩展
# 用法：VR_CDP=http://127.0.0.1:94xx python tools/cdp-image-hover-hit-test.py
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

PAGE = os.environ.get("VR_OVERLAY_PAGE", "http://127.0.0.1:18080/overlay.html")
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


def move(cdp, sid, x, y):
    cdp.send("Input.dispatchMouseEvent",
             {"type": "mouseMoved", "x": x, "y": y, "button": "none", "buttons": 0}, sid)


def bar_state(cdp, sid):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-hover-host');
      // 宿主还没建 = 没有按钮；显式给 vis:false，别让调用方读到 undefined
      if (!h) { return {host:false, vis:false, text:'', over:null}; }
      const sr = h.shadowRoot;
      const w = sr.querySelector('.vr-wrap');
      const b = sr.querySelector('button.vr-btn');
      const r = w && w.getBoundingClientRect();
      return {
        host: true,
        vis: w ? getComputedStyle(w).display !== 'none' : null,
        text: b ? b.textContent.trim() : '',
        cx: r ? r.x + r.width / 2 : 0,
        cy: r ? r.y + r.height / 2 : 0,
        // 悬停条当前贴着哪张图（用按钮中心的元素栈反查）
        over: (function(){
          if (!r) { return null; }
          const list = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          for (const n of list) {
            if (n && n.tagName === 'IMG') { return n.id || '(no-id)'; }
          }
          return null;
        })()
      };
    })()""")


def hover(cdp, sid, sel, wait=0.9):
    """悬停到某张图并等按钮出现。
    移开时必须等超过 HIDE_DELAY(300ms)，否则上一张的 shown 状态没退干净，
    下一次 mouseover 会走进 `img === currentImg && state==='pending'` 分支而不出按钮
    —— 连续测多张图时必踩（实测：单独测 c1 能出，连着测就不出）。
    """
    r = ev(cdp, sid, """(function(){
      const e = document.querySelector(%s);
      if (!e) { return null; }
      e.scrollIntoView({block:'center'});
      const b = e.getBoundingClientRect();
      return {cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height};
    })()""" % json.dumps(sel))
    if not r:
        return None
    # 先移到远处并等过 HIDE_DELAY，让上一张彻底退干净
    move(cdp, sid, 2, 2); time.sleep(0.5)
    move(cdp, sid, 4, 4); time.sleep(0.1)
    move(cdp, sid, r["cx"], r["cy"])
    time.sleep(wait)
    return r


def wait_bar(cdp, sid, pred, timeout=5.0):
    """轮询等悬停条达到目标状态，别用固定 sleep 赌时序。"""
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        last = bar_state(cdp, sid)
        if pred(last):
            return last
        time.sleep(0.2)
    return last or {}


def panel_state(cdp, sid):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      if (!h) { return {host:false}; }
      const sr = h.shadowRoot;
      const p = sr.querySelector('.vr-panel');
      const m = sr.querySelector('.vr-mask');
      const x = sr.querySelector('.vr-head .vr-x[title="关闭（Esc）"]');
      return {
        host: true,
        open: p ? p.classList.contains('on') : null,
        maskOn: m ? m.classList.contains('on') : null,
        hasClose: !!x
      };
    })()""")


def open_panel(cdp, sid):
    ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      if (!h) { return false; }
      const f = h.shadowRoot.querySelector('.vr-float');
      f.dispatchEvent(new PointerEvent('pointerdown',
        {bubbles:true, pointerId:1, button:0, clientX:100, clientY:100}));
      f.dispatchEvent(new PointerEvent('pointerup',
        {bubbles:true, pointerId:1, button:0, clientX:100, clientY:100}));
      return true;
    })()""")
    time.sleep(0.5)


def click_close(cdp, sid):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const x = h.shadowRoot.querySelector('.vr-head .vr-x[title="关闭（Esc）"]');
      if (!x) { return false; }
      x.click();
      return true;
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
    # 干净起点
    ev(cdp, osid, "new Promise(r => chrome.storage.local.remove('vrLibSettings', () => r(1)))")
    time.sleep(0.3)

    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    sid = cdp.attach(tid)
    for m in ("Runtime.enable", "Page.enable", "Network.enable"):
        cdp.send(m, {}, sid)
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True}, sid)
    cdp.send("Emulation.setDeviceMetricsOverride",
             {"width": 1100, "height": 900, "deviceScaleFactor": 1, "mobile": False}, sid)
    cdp.navigate(sid, PAGE)
    cdp.wait_js(sid, "[...document.images].every(i => i.complete)", 10.0)
    cdp.wait_js(sid, "!!document.getElementById('vr-img-hover-host')", 10.0)
    time.sleep(0.4)

    check("A2 夹具页加载（8 张图）",
          ev(cdp, sid, "document.images.length"), 8)

    # ---------------- B. 小显示尺寸：都不该出按钮 ----------------
    # 不该出按钮的用例：等足 1.2s（超过 showDelay 300ms 很多）后断言仍不可见
    for sel, name, idx in [("#i16", "16px", 1), ("#i32", "32px", 2), ("#i40", "40px", 3)]:
        hover(cdp, sid, sel, 1.2)
        check(f"B{idx} 显示 {name} 图标不出按钮", bar_state(cdp, sid).get("vis"), False)

    hover(cdp, sid, "#istrip", 1.2)
    check("B4 2px 细条不出按钮", bar_state(cdp, sid).get("vis"), False)

    hover(cdp, sid, "#igone", 1.2)
    check("B5 隐藏图不出按钮", bar_state(cdp, sid).get("vis"), False)

    # 边界：48px 应通过（轮询等，不赌固定时间）
    hover(cdp, sid, "#i48", 0.3)
    st = wait_bar(cdp, sid, lambda b: b.get("vis"), 5.0)
    check("B6 48px 边界应出按钮", st.get("vis"), True)
    check("B7 按钮文案是「下载原图」", st.get("text"), "下载原图")

    # ---------------- C. 覆盖层：仍要出按钮 ----------------
    hover(cdp, sid, "#c1", 0.3)
    st = wait_bar(cdp, sid, lambda b: b.get("vis"), 5.0)
    check("C1 被 button 遮罩盖住仍出按钮", st.get("vis"), True)
    check("C2 按钮贴着被盖的那张图", st.get("over"), "c1")

    hover(cdp, sid, "#c2", 0.3)
    st = wait_bar(cdp, sid, lambda b: b.get("vis"), 5.0)
    check("C3 被 span 遮罩盖住仍出按钮", st.get("vis"), True)
    check("C4 按钮贴着被盖的那张图", st.get("over"), "c2")

    # 从覆盖层移出后应隐藏（防「粘住」）——等过 HIDE_DELAY
    move(cdp, sid, 2, 2)
    st = wait_bar(cdp, sid, lambda b: not b.get("vis"), 4.0)
    check("C5 移出后按钮隐藏", st.get("vis"), False)

    # ---------------- D. 面板关闭必须有效 ----------------
    open_panel(cdp, sid)
    st = panel_state(cdp, sid)
    check("D1 面板打开", st.get("open"), True)
    check("D2 遮罩同时打开", st.get("maskOn"), True)
    check("D3 有关闭按钮", st.get("hasClose"), True)

    click_close(cdp, sid)
    time.sleep(0.45)
    st = panel_state(cdp, sid)
    check("D4 点 × 后面板关闭", st.get("open"), False)
    check("D5 点 × 后遮罩也摘掉", st.get("maskOn"), False)

    # 再开一次，点遮罩关闭
    open_panel(cdp, sid)
    time.sleep(0.4)
    check("D6 再次打开", panel_state(cdp, sid).get("open"), True)
    ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const m = h.shadowRoot.querySelector('.vr-mask');
      if (m) { m.click(); }
      return true;
    })()""")
    time.sleep(0.45)
    st = panel_state(cdp, sid)
    check("D7 点遮罩后面板关闭", st.get("open"), False)
    check("D8 点遮罩后遮罩摘掉", st.get("maskOn"), False)

    # 设置区打开时点 ×，也要能关（这是原来失效的场景）
    open_panel(cdp, sid)
    time.sleep(0.4)
    ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const g = h.shadowRoot.querySelector('.vr-head .vr-x[title="设置"]');
      if (g) { g.click(); }
      return true;
    })()""")
    time.sleep(0.4)
    click_close(cdp, sid)
    time.sleep(0.5)
    st = panel_state(cdp, sid)
    check("D9 设置区打开时点 × 也能关", st.get("open"), False)
    check("D10 设置区打开时遮罩也摘掉", st.get("maskOn"), False)

    # ---------------- E. 面板列表也过滤小图 ----------------
    open_panel(cdp, sid)
    time.sleep(0.6)
    num = ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const f = h.shadowRoot.querySelector('.vr-float .n');
      return f ? f.textContent.trim() : null;
    })()""")
    # 8 张里：16/32/40/细条/隐藏 共 5 张被过滤 → 剩 3 张（48px + 两张覆盖层图）
    check("E1 面板角标只统计合格图（3 张）", num, "3")

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
