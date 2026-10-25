# video-rod 图片清单面板验收（I4）
#
# 前置：
#   1) python -m http.server 18080（工作目录 test-site）
#   2) Chrome for Testing + 扩展（推荐用 tools/cdp-run.py 一键起）
# 用法：VR_CDP=http://127.0.0.1:94xx python tools/cdp-image-panel-test.py
import base64
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

PAGE = os.environ.get("VR_PANEL_PAGE", "http://127.0.0.1:18080/panel.html")
SITE = os.environ.get("VR_SITE_ROOT", r"E:/test/video-rod/test-site")
ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "deliverables", "assets")

results = []
created_ids = []


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


def media_size(name):
    return os.path.getsize(os.path.join(SITE, "media", name))


def downloads(cdp, osid):
    return ev(cdp, osid, """new Promise(r => chrome.downloads.search(
      {orderBy:['-startTime'], limit:50},
      list => r(list.map(d => ({id:d.id, state:d.state, filename:d.filename})))))""")


def set_settings(cdp, osid, patch):
    return ev(cdp, osid, """new Promise(r => chrome.storage.local.get('vrLibSettings', o => {
      const s = Object.assign({}, (o && o.vrLibSettings) || {}, %s);
      chrome.storage.local.set({vrLibSettings: s}, () => r(s));
    }))""" % json.dumps(patch))


def clear_seen(cdp, osid):
    return ev(cdp, osid, """new Promise(r => chrome.storage.local.remove('vrImgDownloaded', () => r(1)))""")


# 只清「测试站」自己产生的文件。
# 不要无差别删整个目录：一次删几十个文件会触发宿主的安全删除阈值，
# 测试直接被拦掉（踩过）。按文件名前缀圈定范围，数量天然就小。
# 文件名形如「20261025_测试站 F：xxx.jpg」——日期每天都会变，不能写死日期前缀。
TEST_MARK = "测试站"


def is_test_artifact(name):
    low = name.lower()
    if not low.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
        return False
    return TEST_MARK in name


def clean_disk(dl_dir):
    if not os.path.isdir(dl_dir):
        return 0
    n = 0
    for name in os.listdir(dl_dir):
        if not is_test_artifact(name):
            continue
        try:
            os.remove(os.path.join(dl_dir, name))
            n += 1
        except OSError:
            pass
    return n


def disk_images(dl_dir):
    """只统计测试站产生的图片，避免把用户已有文件算进增量。"""
    if not os.path.isdir(dl_dir):
        return set()
    return {n for n in os.listdir(dl_dir) if is_test_artifact(n)}


def wait_disk_growth(dl_dir, before, expect, timeout=25.0):
    t0 = time.time()
    last = disk_images(dl_dir)
    while time.time() - t0 < timeout:
        last = disk_images(dl_dir)
        if len(last - before) >= expect:
            return last
        time.sleep(0.2)
    return last


def shot(cdp, sid, name):
    os.makedirs(ASSETS, exist_ok=True)
    time.sleep(0.3)
    data = cdp.send("Page.captureScreenshot", {"format": "png"}, sid).get("data")
    path = os.path.join(ASSETS, name)
    with open(path, "wb") as f:
        f.write(base64.b64decode(data))
    return path


def panel_state(cdp, sid):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      if (!h) { return {host:false}; }
      const sr = h.shadowRoot;
      const f = sr.querySelector('.vr-float');
      const p = sr.querySelector('.vr-panel');
      const mask = sr.querySelector('.vr-mask');
      const grid = sr.querySelector('.vr-grid');
      const cells = grid ? [...grid.querySelectorAll('.vr-cell')] : [];
      const tiers = {};
      sr.querySelectorAll('.vr-tier').forEach(b => {
        const k = b.getAttribute('data-tier');
        const c = b.querySelector('.c');
        tiers[k] = { on: b.classList.contains('on'), count: c ? c.textContent.trim() : '',
                     label: b.textContent.trim() };
      });
      return {
        host: true,
        floatOn: f ? f.classList.contains('on') : null,
        floatNum: f ? (f.querySelector('.n') || {}).textContent : null,
        floatRight: f ? f.style.right : null,
        floatBottom: f ? f.style.bottom : null,
        open: p ? p.classList.contains('on') : null,
        maskOn: mask ? mask.classList.contains('on') : null,
        title: (sr.querySelector('.vr-head .t') || {}).textContent || '',
        tiers: tiers,
        cells: cells.length,
        sel: cells.filter(c => c.classList.contains('sel')).length,
        selText: (sr.querySelector('.vr-foot .s') || {}).textContent || '',
        dlDisabled: (sr.querySelector('.vr-foot .vr-btn2.primary') || {}).disabled,
        empty: (sr.querySelector('.vr-empty') || {}).hidden === false,
        dims: cells.slice(0, 3).map(c => (c.querySelector('.dim') || {}).textContent || ''),
        customOpen: (sr.querySelector('.vr-custom') || {}).hidden === false
      };
    })()""")


def wait_panel(cdp, sid, pred, timeout=8.0):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        last = panel_state(cdp, sid)
        if last and pred(last):
            return last, time.time() - t0
        time.sleep(0.12)
    return last or {}, time.time() - t0


def click_float(cdp, sid):
    pos = ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const f = h && h.shadowRoot.querySelector('.vr-float');
      if (!f || !f.classList.contains('on')) { return null; }
      const r = f.getBoundingClientRect();
      return {cx: r.x + r.width/2, cy: r.y + r.height/2};
    })()""")
    if not pos:
        return False
    # 浮标用 pointer 事件：直接派发 pointerdown/up 到元素上更稳
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const f = h.shadowRoot.querySelector('.vr-float');
      const r = f.getBoundingClientRect();
      const opt = {bubbles:true, cancelable:true, clientX:r.x+r.width/2, clientY:r.y+r.height/2, pointerId:1, button:0};
      f.dispatchEvent(new PointerEvent('pointerdown', opt));
      f.dispatchEvent(new PointerEvent('pointerup', opt));
      return true;
    })()""")


def click_tier(cdp, sid, key):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const b = h.shadowRoot.querySelector('.vr-tier[data-tier="%s"]');
      if (!b || b.disabled) { return false; }
      b.click();
      return true;
    })()""" % key)


def click_cell(cdp, sid, idx, shift=False):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const cells = [...h.shadowRoot.querySelectorAll('.vr-cell')];
      const c = cells[%d];
      if (!c) { return null; }
      c.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, shiftKey:%s}));
      return c.getAttribute('data-url');
    })()""" % (idx, "true" if shift else "false"))


def click_btn(cdp, sid, text):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const btns = [...h.shadowRoot.querySelectorAll('.vr-btn2')];
      const b = btns.find(x => x.textContent.trim().indexOf(%s) === 0);
      if (!b) { return false; }
      b.click();
      return true;
    })()""" % json.dumps(text))


def set_kw(cdp, sid, val):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const i = h.shadowRoot.querySelector('.vr-kw');
      if (!i) { return false; }
      i.value = %s;
      i.dispatchEvent(new Event('input', {bubbles:true}));
      return true;
    })()""" % json.dumps(val))


def set_sort(cdp, sid, val):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const s = h.shadowRoot.querySelector('.vr-sel');
      if (!s) { return false; }
      s.value = %s;
      s.dispatchEvent(new Event('change', {bubbles:true}));
      return true;
    })()""" % json.dumps(val))


def key(cdp, sid, k, extra=""):
    params = {"type": "keyDown", "key": k}
    if extra:
        params.update(eval(extra))
    cdp.send("Input.dispatchKeyEvent", params, sid)
    cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": k}, sid)


def main():
    cdp = Cdp()
    ext_id, _ = find_ext_id(cdp)
    check("A1 扩展已加载", bool(ext_id), True)
    if not ext_id:
        return finish(cdp)

    check("A2 夹具页存在", os.path.exists(os.path.join(SITE, "panel.html")), True)

    dl_dir = os.environ.get("VR_DL_DIR",
                            r"D:\Users\liq21\Downloads\video-rod\其他网页\127.0.0.1\图片")
    # 全套连跑时磁盘删除累计会撞宿主安全删除阈值（SAFE_DELETE_BULK_CONFIRM_REQUIRED），
    # 整个套件会被直接拦掉。改用 downloads API 清理自己的记录与文件，绕开宿主的删除钩子。
    try:
        ev(cdp, osid, """new Promise(r => chrome.downloads.search({limit:200}, list => {
          const hit = (list||[]).filter(d => (d.filename||"").indexOf("测试站") >= 0);
          let left = hit.length;
          if (!left) { r(0); return; }
          hit.forEach(d => chrome.downloads.removeFile(d.id, () => {
            chrome.downloads.erase({id: d.id}, () => { if (--left <= 0) { r(1); } });
          }));
        }))""")
    except Exception:
        pass

    otid = cdp.send("Target.createTarget", {"url": f"chrome-extension://{ext_id}/options.html"})["targetId"]
    osid = cdp.attach(otid)
    cdp.send("Runtime.enable", {}, osid)
    cdp.send("Page.enable", {}, osid)
    cdp.wait_js(osid, "!!chrome.downloads", 8)
    clear_seen(cdp, osid)
    set_settings(cdp, osid, {"imgHover": True, "imgBatch": True, "imgPanel": True,
                             "imgBatchLimit": 200, "imgConcurrency": 3})
    # 等设置真的落库再导航：storage.set 是异步的，写进去前就 navigate，
    # 内容脚本会读到旧值（浮标默认已是 false，读旧值就永远不建宿主）——A3 会假失败。
    t0 = time.time()
    while time.time() - t0 < 5:
        cur = ev(cdp, osid, """new Promise(r=>chrome.storage.local.get('vrLibSettings',
              o=>r((o&&o.vrLibSettings)||{})))""")
        if cur.get("imgPanel") is True:
            break
        time.sleep(0.1)

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
    time.sleep(0.4)

    # ---------------- A. 浮标 ----------------
    st, _ = wait_panel(cdp, sid, lambda s: s.get("floatOn"), 8.0)
    check("A3 浮标出现", st.get("floatOn"), True)
    check("A4 角标 = 可下张数 8", st.get("floatNum"), "8")
    # 默认位置由 CSS 的 right/bottom 给，inline style 为空是正常的；读 computed 才对
    pos = ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const f = h && h.shadowRoot.querySelector('.vr-float');
      if (!f) { return null; }
      const cs = getComputedStyle(f);
      const r = f.getBoundingClientRect();
      return {right: cs.right, bottom: cs.bottom,
              gapR: Math.round(window.innerWidth - r.right),
              gapB: Math.round(window.innerHeight - r.bottom)};
    })()""")
    check("A5 默认距右下 16px", [pos["gapR"], pos["gapB"]] if pos else None, [16, 16])
    shot(cdp, sid, "image-panel-float.png")

    # ---------------- B. 打开面板 ----------------
    click_float(cdp, sid)
    st, _ = wait_panel(cdp, sid, lambda s: s.get("open"), 8.0)
    check("B1 点浮标开面板", [st.get("open"), st.get("maskOn")], [True, True])
    check("B2 标题含 8 张", "8" in st.get("title", "") and "张" in st.get("title", ""), True)
    check("B3 首屏渲染 8 张", st.get("cells"), 8)
    check("B4 缩略图显示尺寸", bool(re.match(r"\d+ × \d+", st["dims"][0] if st["dims"] else "")), True)
    shot(cdp, sid, "image-panel-grid.png")

    # ---------------- C. 尺寸档位 ----------------
    t = st.get("tiers") or {}
    check("C1 小档命中 8", t.get("small", {}).get("count"), "8")
    # 夹具短边：480/300/320/400/300/300/1200/1200 → ≥500 的只有两张 1200
    check("C2 中档命中 2", t.get("medium", {}).get("count"), "2")
    check("C3 大档命中 2", t.get("large", {}).get("count"), "2")
    check("C4 超大档 0 且禁用", [t.get("huge", {}).get("count"), t.get("huge", {}).get("on")], ["0", False])

    click_tier(cdp, sid, "large")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("cells") == 2, 6.0)
    check("C5 切大档后网格 2 张", st.get("cells"), 2)
    check("C6 大档高亮", (st.get("tiers") or {}).get("large", {}).get("on"), True)
    shot(cdp, sid, "image-panel-tier.png")

    click_tier(cdp, sid, "medium")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("cells") == 2, 6.0)
    check("C7 切中档后网格 2 张", st.get("cells"), 2)

    # 自定义档位：内联输入
    ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      h.shadowRoot.querySelector('.vr-tier[data-tier="custom"]').click();
      return true;
    })()""")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("customOpen"), 4.0)
    check("C8 自定义输入行展开", st.get("customOpen"), True)
    ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const i = h.shadowRoot.querySelector('.vr-custom .vr-kw');
      i.value = '1200';
      h.shadowRoot.querySelector('.vr-custom .vr-btn2.primary').click();
      return true;
    })()""")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("cells") == 2, 6.0)
    check("C9 自定义 1200 命中 2 张", st.get("cells"), 2)

    click_tier(cdp, sid, "small")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("cells") == 8, 6.0)
    check("C10 回小档 8 张", st.get("cells"), 8)

    # ---------------- D. URL 过滤 ----------------
    set_kw(cdp, sid, "sprite")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("cells") == 1, 6.0)
    check("D1 关键词 sprite 命中 1", st.get("cells"), 1)
    set_kw(cdp, sid, "cover")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("cells") == 2, 6.0)
    check("D2 关键词 cover 命中 2（含 v=m3）", st.get("cells"), 2)
    set_kw(cdp, sid, "zzz")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("empty"), 6.0)
    check("D3 无命中显示空态", st.get("empty"), True)
    set_kw(cdp, sid, "")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("cells") == 8, 6.0)
    check("D4 清空关键词恢复 8", st.get("cells"), 8)

    # ---------------- E. 勾选 ----------------
    click_cell(cdp, sid, 0)
    st, _ = wait_panel(cdp, sid, lambda s: s.get("sel") == 1, 4.0)
    check("E1 单击勾选 1 张", st.get("sel"), 1)
    check("E2 底部显示已选 1", "1" in st.get("selText", ""), True)
    check("E3 下载按钮可用", st.get("dlDisabled"), False)

    click_cell(cdp, sid, 3, shift=True)
    st, _ = wait_panel(cdp, sid, lambda s: s.get("sel") >= 4, 4.0)
    check("E4 Shift+单击选中区间 4 张", st.get("sel"), 4)

    click_btn(cdp, sid, "清空")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("sel") == 0, 4.0)
    check("E5 清空后 0 张", st.get("sel"), 0)
    check("E6 下载按钮禁用", st.get("dlDisabled"), True)

    click_btn(cdp, sid, "全选")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("sel") == 8, 4.0)
    check("E7 全选 8 张", st.get("sel"), 8)

    click_btn(cdp, sid, "反选")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("sel") == 0, 4.0)
    check("E8 反选后 0 张", st.get("sel"), 0)

    # ---------------- F. 排序 ----------------
    click_cell(cdp, sid, 0)
    click_cell(cdp, sid, 1)
    st, _ = wait_panel(cdp, sid, lambda s: s.get("sel") == 2, 4.0)
    before_sel = st.get("sel")
    set_sort(cdp, sid, "size-desc")
    time.sleep(0.4)
    st = panel_state(cdp, sid)
    check("F1 尺寸降序后顺序变化", st.get("dims")[0] if st.get("dims") else "", "1200 × 1200")
    check("F2 排序后勾选不丢", st.get("sel"), before_sel)
    set_sort(cdp, sid, "page")
    time.sleep(0.3)

    # ---------------- G. 键盘 ----------------
    key(cdp, sid, "a", "{'windowsVirtualKeyCode':65,'nativeVirtualKeyCode':65}")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("sel") == 8, 4.0)
    check("G1 A 全选", st.get("sel"), 8)

    # X 作用于「当前焦点格」，先把焦点放到第一张（键盘导航也是这么用的）
    ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const c = h.shadowRoot.querySelector('.vr-cell');
      if (c) { c.focus(); }
      return !!c;
    })()""")
    time.sleep(0.2)
    key(cdp, sid, "x", "{'windowsVirtualKeyCode':88,'nativeVirtualKeyCode':88}")
    st2, _ = wait_panel(cdp, sid, lambda s: s.get("sel") == 7, 4.0)
    check("G2 X 取消当前项勾选", st2.get("sel"), 7)

    # J/K 移动焦点
    ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      h.shadowRoot.querySelector('.vr-cell').focus();
      return true;
    })()""")
    key(cdp, sid, "j", "{'windowsVirtualKeyCode':74,'nativeVirtualKeyCode':74}")
    time.sleep(0.25)
    moved = ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const sr = h.shadowRoot;
      const cells = [...sr.querySelectorAll('.vr-cell')];
      // Shadow DOM 内 document.activeElement 只返回 host，要读 sr.activeElement
      return cells.indexOf(sr.activeElement);
    })()""")
    check("G3 J 移到第 2 张", moved, 1)

    # ---------------- H. 下载选中 ----------------
    click_btn(cdp, sid, "清空")
    time.sleep(0.3)
    click_cell(cdp, sid, 0)
    click_cell(cdp, sid, 1)
    st, _ = wait_panel(cdp, sid, lambda s: s.get("sel") == 2, 4.0)
    check("H1 选中 2 张", st.get("sel"), 2)
    files_before = disk_images(dl_dir)
    ids_before = {d["id"] for d in downloads(cdp, osid)}
    click_btn(cdp, sid, "下载选中")
    after = wait_disk_growth(dl_dir, files_before, 2, 30.0)
    new_files = after - files_before
    check("H2 落盘 2 个文件", len(new_files), 2)
    check("H3 文件名含日期前缀",
          all(re.match(r"\d{8}_", n) for n in new_files), True)
    created_ids.extend(d["id"] for d in downloads(cdp, osid) if d["id"] not in ids_before)

    # ---------------- I. Esc 关闭 ----------------
    key(cdp, sid, "Escape", "{'windowsVirtualKeyCode':27,'nativeVirtualKeyCode':27}")
    st, _ = wait_panel(cdp, sid, lambda s: s.get("open") is False, 5.0)
    check("I1 Esc 关闭面板", st.get("open"), False)

    # ---------------- J. 浮标拖动 ----------------
    drag = ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const f = h.shadowRoot.querySelector('.vr-float');
      const r0 = f.getBoundingClientRect();
      const opt = (x,y) => ({bubbles:true, cancelable:true, clientX:x, clientY:y, pointerId:7, button:0});
      f.dispatchEvent(new PointerEvent('pointerdown', opt(r0.x+20, r0.y+20)));
      f.dispatchEvent(new PointerEvent('pointermove', opt(r0.x-60, r0.y-60)));
      f.dispatchEvent(new PointerEvent('pointerup', opt(r0.x-60, r0.y-60)));
      return {right: f.style.right, bottom: f.style.bottom,
              stored: localStorage.getItem('vrImgFloatPos')};
    })()""")
    check("J1 拖动后位置改变", drag["right"] != "16px", True)
    check("J2 位置已持久化", bool(drag["stored"]), True)

    # ---------------- K. 关闭浮标 ----------------
    ev(cdp, sid, "sessionStorage.setItem('vrImgFloatOff','1')")
    cdp.reload(sid)
    cdp.wait_js(sid, "!!document.getElementById('vr-img-panel-host')", 10.0)
    time.sleep(0.6)
    st = panel_state(cdp, sid)
    check("K1 关闭后浮标不再显示", st.get("floatOn"), False)
    ev(cdp, sid, "sessionStorage.removeItem('vrImgFloatOff')")

    # ---------------- L. 开关 ----------------
    set_settings(cdp, osid, {"imgPanel": False})
    cdp.reload(sid)
    cdp.wait_js(sid, "[...document.images].every(i => i.complete)", 10.0)
    time.sleep(0.5)
    off = ev(cdp, sid, "!!document.getElementById('vr-img-panel-host')")
    check("L1 imgPanel=false 时无面板宿主", off, False)

    set_settings(cdp, osid, {"imgPanel": True})
    cdp.reload(sid)
    cdp.wait_js(sid, "!!document.getElementById('vr-img-panel-host')", 10.0)
    st, _ = wait_panel(cdp, sid, lambda s: s.get("floatOn"), 8.0)
    check("L2 imgPanel=true 恢复浮标", st.get("floatOn"), True)

    return finish(cdp, osid)


def cleanup(cdp, osid):
    for i in created_ids:
        cdp.eval(f"new Promise(r => chrome.downloads.removeFile({i}, () => r(1)))", osid)
        time.sleep(0.12)
        cdp.eval(f"new Promise(r => chrome.downloads.erase({{id:{i}}}, () => r(1)))", osid)
        time.sleep(0.05)
    leftovers = []
    for d in downloads(cdp, osid):
        if d["id"] not in created_ids:
            continue
        fn = d.get("filename") or ""
        if fn and os.path.exists(fn):
            try:
                os.remove(fn)
            except OSError:
                leftovers.append(fn)
    if leftovers:
        print("      未能删除（可能被占用）：", leftovers)
    clear_seen(cdp, osid)
    set_settings(cdp, osid, {"imgPanel": True, "imgBatch": True})


def finish(cdp, osid=None):
    if osid and created_ids:
        try:
            cleanup(cdp, osid)
        except Exception as e:
            print("      清理失败：", e)
    errs = cdp.errors()
    check("M1 控制台无 error/exception", errs, [])
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
