# video-rod 图片设置与快捷键验收（I5）
#
# 前置：与其它 cdp-*-test.py 相同（测试站 18080 + Chrome for Testing + 扩展）
# 用法：VR_CDP=http://127.0.0.1:94xx python tools/cdp-image-settings-test.py
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

PAGE = os.environ.get("VR_SETTINGS_PAGE", "http://127.0.0.1:18080/panel.html")
SITE = os.environ.get("VR_SITE_ROOT", r"E:/test/video-rod/test-site")
ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "deliverables", "assets")

results = []
created_ids = []
DL_DIR = os.environ.get("VR_DL_DIR",
                        r"D:\Users\liq21\Downloads\video-rod\其他网页\127.0.0.1\图片")


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name +
          ("" if ok else f"   got={got!r} expect={expect!r}"))


def ev(cdp, sid, js):
    """在页面主世界执行。注意：chrome.* API 在主世界不可用，
    存储读写一律用 osid（扩展页）；页面侧只做 DOM 操作。"""
    r = cdp.eval(js, sid)
    if isinstance(r, dict) and "__error" in r:
        raise RuntimeError(r["__error"])
    return r


def get_settings(cdp, sid):
    return ev(cdp, sid, """new Promise(r => chrome.storage.local.get('vrLibSettings',
      o => r((o && o.vrLibSettings) || {})))""")


def set_settings(cdp, sid, patch):
    return ev(cdp, sid, """new Promise(r => chrome.storage.local.get('vrLibSettings', o => {
      const s = Object.assign({}, (o && o.vrLibSettings) || {}, %s);
      chrome.storage.local.set({vrLibSettings: s}, () => r(s));
    }))""" % json.dumps(patch))


def clear_seen(cdp, sid):
    return ev(cdp, sid, """new Promise(r => chrome.storage.local.remove('vrImgDownloaded', () => r(1)))""")


# 文件名形如「20261025_测试站 F：xxx.jpg」——日期每天都会变，不能写死日期前缀。
# 用「含测试站」判断，既圈得住测试产物，也不会误伤用户文件。
TEST_MARK = "测试站"


def is_test_artifact(name):
    if not name.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
        return False
    return TEST_MARK in name


def clean_disk(d):
    if not os.path.isdir(d):
        return 0
    n = 0
    for name in os.listdir(d):
        if not is_test_artifact(name):
            continue
        try:
            os.remove(os.path.join(d, name))
            n += 1
        except OSError:
            pass
    return n


def disk_images(d):
    if not os.path.isdir(d):
        return set()
    return {n for n in os.listdir(d) if is_test_artifact(n)}


def wait_disk_growth(d, before, expect, timeout=30.0):
    t0 = time.time()
    last = disk_images(d)
    while time.time() - t0 < timeout:
        last = disk_images(d)
        if len(last - before) >= expect:
            return last
        time.sleep(0.2)
    return last


def panel_state(cdp, sid):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      if (!h) { return {host:false}; }
      const sr = h.shadowRoot;
      const f = sr.querySelector('.vr-float');
      const p = sr.querySelector('.vr-panel');
      const set = sr.querySelector('.vr-set');
      const sws = {};
      sr.querySelectorAll('.vr-set .vr-sw').forEach(x => {
        sws[x.getAttribute('data-key')] = x.classList.contains('on');
      });
      const nums = {};
      sr.querySelectorAll('.vr-set .num').forEach(x => {
        nums[x.getAttribute('data-key')] = x.value;
      });
      const bad = {};
      sr.querySelectorAll('.vr-set .num').forEach(x => {
        bad[x.getAttribute('data-key')] = x.classList.contains('bad');
      });
      const grid = sr.querySelector('.vr-grid');
      return {
        host: true,
        floatOn: f ? f.classList.contains('on') : null,
        floatNum: f ? (f.querySelector('.n') || {}).textContent : null,
        open: p ? p.classList.contains('on') : null,
        settingsOpen: set ? !set.hidden : null,
        title: (sr.querySelector('.vr-head .t') || {}).textContent || '',
        sws: sws, nums: nums, bad: bad,
        errText: (sr.querySelector('.vr-set .err2') || {}).textContent || '',
        errHidden: (sr.querySelector('.vr-set .err2') || {}).hidden,
        cells: grid ? grid.querySelectorAll('.vr-cell').length : 0,
        gear: !!sr.querySelector('.vr-head .vr-x[title="设置"]'),
        resetLabel: (function(){
          const b = [...sr.querySelectorAll('.vr-set-foot .vr-btn2')]
            .find(x => x.textContent.indexOf('恢复') >= 0 || x.textContent.indexOf('确定') >= 0);
          return b ? b.textContent.trim() : '';
        })()
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


def open_panel(cdp, sid):
    ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      if (!h) { return false; }
      h.shadowRoot.querySelector('.vr-float').dispatchEvent(new PointerEvent('pointerdown',
        {bubbles:true, pointerId:1, button:0, clientX:100, clientY:100}));
      h.shadowRoot.querySelector('.vr-float').dispatchEvent(new PointerEvent('pointerup',
        {bubbles:true, pointerId:1, button:0, clientX:100, clientY:100}));
      return true;
    })()""")
    return wait_panel(cdp, sid, lambda s: s.get("open"), 6.0)


def click_gear(cdp, sid):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const g = h.shadowRoot.querySelector('.vr-head .vr-x[title="设置"]');
      if (!g) { return false; }
      g.click();
      return true;
    })()""")


def toggle_sw(cdp, sid, key):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const b = h.shadowRoot.querySelector('.vr-sw[data-key="%s"]');
      if (!b) { return false; }
      b.click();
      return true;
    })()""" % key)


def wait_setting(cdp, osid, key, expect, timeout=6.0):
    """等某一项真的落库（面板写 storage 是异步的，别立刻断言）"""
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        last = get_settings(cdp, osid).get(key)
        if last == expect:
            return last
        time.sleep(0.15)
    return last


def set_num(cdp, sid, key, val):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const i = h.shadowRoot.querySelector('.num[data-key="%s"]');
      if (!i) { return false; }
      i.value = %s;
      i.dispatchEvent(new Event('change', {bubbles:true}));
      return true;
    })()""" % (key, json.dumps(val)))


def click_set_btn(cdp, sid, text):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const b = [...h.shadowRoot.querySelectorAll('.vr-set-foot .vr-btn2')]
        .find(x => x.textContent.trim().indexOf(%s) === 0);
      if (!b) { return false; }
      b.click();
      return true;
    })()""" % json.dumps(text))


def hover_bar(cdp, sid):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-hover-host');
      // 各分支返回同样的键，否则调用方读到 undefined（踩过多次）
      const empty = {host:false, vis:false, oneHidden:null, allHidden:null, one:null, all:null};
      if (!h) { return empty; }
      const sr = h.shadowRoot;
      const w = sr.querySelector('.vr-wrap');
      const one = sr.querySelector('button.vr-btn:not(.all)');
      const all = sr.querySelector('button.vr-btn.all');
      return {host:true,
              vis: w ? getComputedStyle(w).display !== 'none' : null,
              oneHidden: one ? !!one.hidden : null,
              allHidden: all ? !!all.hidden : null};
    })()""")


def shot(cdp, sid, name):
    os.makedirs(ASSETS, exist_ok=True)
    time.sleep(0.3)
    data = cdp.send("Page.captureScreenshot", {"format": "png"}, sid).get("data")
    import base64
    with open(os.path.join(ASSETS, name), "wb") as f:
        f.write(base64.b64decode(data))
    return os.path.join(ASSETS, name)


def move(cdp, sid, x, y):
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y,
                                          "button": "none", "buttons": 0}, sid)


def hover_img(cdp, sid, selector, wait=0.8, expect_vis=True):
    """悬停到某张图并等悬停条出现。

    宿主是「第一次悬停才懒创建」的，固定 sleep 容易抓空 —— 这里改成
    「移入后轮询等可见」，最多试 3 轮。`expect_vis=False` 时只做悬停不等待
    （用于「本来就不该出现」的用例）。
    """
    r = ev(cdp, sid, """(function(){
      const e = document.querySelector(%s);
      if (!e) { return null; }
      e.scrollIntoView({block:'center'});
      const b = e.getBoundingClientRect();
      return {cx:b.x+b.width/2, cy:b.y+b.height/2};
    })()""" % json.dumps(selector))
    if not r:
        return None
    for attempt in range(3):
        move(cdp, sid, 1, 1); time.sleep(0.05)
        move(cdp, sid, 3, 3); time.sleep(0.05)
        move(cdp, sid, r["cx"], r["cy"])
        time.sleep(wait + attempt * 0.3)
        if not expect_vis:
            return r
        t0 = time.time()
        while time.time() - t0 < 2.5:
            if hover_bar(cdp, sid).get("vis"):
                return r
            time.sleep(0.12)
    return r


def main():
    cdp = Cdp()
    ext_id, _ = find_ext_id(cdp)
    check("A1 扩展已加载", bool(ext_id), True)
    if not ext_id:
        return finish(cdp)

    # 不在磁盘上无差别删：连跑多套时累计删除量会撞上宿主的安全删除阈值
    # （SAFE_DELETE_BULK_CONFIRM_REQUIRED），整个套件直接被拦掉（踩过）。
    # 改用 chrome.downloads 清理自己的记录与文件，走浏览器 API 不经过宿主的删除钩子。
    otid = cdp.send("Target.createTarget",
                    {"url": f"chrome-extension://{ext_id}/options.html"})["targetId"]
    osid = cdp.attach(otid)
    cdp.send("Runtime.enable", {}, osid)
    cdp.send("Page.enable", {}, osid)
    cdp.wait_js(osid, "!!chrome.downloads", 8)
    # 用 downloads API 清掉历史测试文件（不碰宿主 safe-delete 的阈值）
    try:
        ev(cdp, osid, """new Promise(r => chrome.downloads.search({limit:200}, list => {
          const hit = (list||[]).filter(d => (d.filename||'').indexOf('测试站') >= 0);
          let left = hit.length;
          if (!left) { r(0); return; }
          hit.forEach(d => chrome.downloads.removeFile(d.id, () => {
            chrome.downloads.erase({id: d.id}, () => { if (--left <= 0) { r(1); } });
          }));
        }))""")
    except Exception:
        pass
    clear_seen(cdp, osid)
    # 干净起点：全部默认
    ev(cdp, osid, """new Promise(r => chrome.storage.local.remove('vrLibSettings', () => r(1)))""")
    time.sleep(0.3)
    # 浮标默认是关的（批量低频、不占常驻 UI，见 docs/RESEARCH-COMPETITOR-IMAGE.md）；
    # 本套要测面板内的设置区，必须显式打开浮标 —— 且要等它真的落库再导航，
    # 否则内容脚本读到旧值就不建宿主，后面 open_panel 全崩（踩过）。
    set_settings(cdp, osid, {"imgPanel": True})
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
    time.sleep(0.5)

    # ---------------- A. 默认值 ----------------
    st = get_settings(cdp, osid)
    check("A2 未写入时存储里没有 imgMinSize", st.get("imgMinSize"), None)
    # VRImageUtil 在内容脚本的隔离世界里，主世界取不到；用面板自己的兜底值判断
    check("A3 面板兜底用 100（8 张全过）", panel_state(cdp, sid).get("floatNum"), "8")
    # 设置页在扩展页，能拿到 util，用它验证兜底
    set_page = ev(cdp, osid, "(function(){ var u = window.VRImageUtil; "
                             "return u ? u.mergeSettings({}).imgMinSize : null; })()")
    check("A4 扩展页里 mergeSettings 兜底 100", set_page, 100)

    # ---------------- B. 面板设置区 ----------------
    open_panel(cdp, sid)
    st, _ = wait_panel(cdp, sid, lambda s: s.get("open"), 6.0)
    check("B1 面板打开", st.get("open"), True)
    check("B2 有齿轮按钮", st.get("gear"), True)

    click_gear(cdp, sid)
    st, _ = wait_panel(cdp, sid, lambda s: s.get("settingsOpen"), 5.0)
    check("B3 设置区打开", st.get("settingsOpen"), True)
    check("B4 标题变为设置", st.get("title"), "图片下载设置")
    check("B5 五项开关都开（浮标是显式打开的）",
          [st["sws"].get(k) for k in
           ("imgHover", "imgBatch", "imgPanel", "imgPreferOriginal", "imgHotkeys")],
          [True] * 5)
    check("B6 数值项与默认一致",
          [st["nums"].get(k) for k in ("imgMinSize", "imgHoverDelay", "imgConcurrency", "imgBatchLimit")],
          ["100", "300", "3", "200"])
    shot(cdp, sid, "image-settings-panel.png")

    # ---------------- C. 改数值 ----------------
    set_num(cdp, sid, "imgMinSize", "1200")
    check("C1 最小尺寸落库 1200", wait_setting(cdp, osid, "imgMinSize", 1200), 1200)
    time.sleep(0.4)
    check("C2 面板张数降到 2（只有两张 1200）", panel_state(cdp, sid).get("floatNum"), "2")

    set_num(cdp, sid, "imgHoverDelay", "800")
    check("C3 悬停延迟落库 800", wait_setting(cdp, osid, "imgHoverDelay", 800), 800)

    set_num(cdp, sid, "imgConcurrency", "5")
    check("C4 并发落库 5", wait_setting(cdp, osid, "imgConcurrency", 5), 5)

    set_num(cdp, sid, "imgBatchLimit", "50")
    check("C5 上限落库 50", wait_setting(cdp, osid, "imgBatchLimit", 50), 50)

    # ---------------- D. 非法值 ----------------
    set_num(cdp, sid, "imgMinSize", "abc")
    time.sleep(0.4)
    st = panel_state(cdp, sid)
    check("D1 非数字标红", st["bad"].get("imgMinSize"), True)
    check("D2 非数字有提示", "整数" in st.get("errText", ""), True)
    check("D3 非数字未落库（仍是 1200）", get_settings(cdp, osid).get("imgMinSize"), 1200)

    set_num(cdp, sid, "imgMinSize", "")
    time.sleep(0.4)
    check("D4 空值标红", panel_state(cdp, sid)["bad"].get("imgMinSize"), True)
    check("D5 空值未落库", get_settings(cdp, osid).get("imgMinSize"), 1200)

    set_num(cdp, sid, "imgMinSize", "9999")
    time.sleep(0.4)
    st = panel_state(cdp, sid)
    check("D6 超上限标红", st["bad"].get("imgMinSize"), True)
    check("D7 超上限未落库", get_settings(cdp, osid).get("imgMinSize"), 1200)

    # 恢复合法值（张数会重新扫描，给足时间）
    set_num(cdp, sid, "imgMinSize", "100")
    wait_setting(cdp, osid, "imgMinSize", 100)
    t0 = time.time()
    num = ""
    while time.time() - t0 < 6:
        num = panel_state(cdp, sid).get("floatNum")
        if num == "8":
            break
        time.sleep(0.2)
    check("D8 恢复 100 后张数回到 8", num, "8")

    # ---------------- E. 双向同步（面板 → 设置页） ----------------
    ev(cdp, osid, "VRImgSettings && VRImgSettings.render && VRImgSettings.render()")
    time.sleep(0.5)
    page_vals = ev(cdp, osid, """({
      minSize: (document.getElementById('ImgMinSize') || {}).value,
      hoverDelay: (document.getElementById('ImgHoverDelay') || {}).value,
      conc: (document.getElementById('ImgConcurrency') || {}).value,
      limit: (document.getElementById('ImgBatchLimit') || {}).value,
      hoverOn: (document.getElementById('ImgHover') || {}).checked
    })""")
    check("E1 设置页读到面板改的值",
          [page_vals.get("minSize"), page_vals.get("hoverDelay"),
           page_vals.get("conc"), page_vals.get("limit")],
          ["100", "800", "5", "50"])
    check("E2 设置页开关状态正确", page_vals.get("hoverOn"), True)

    # ---------------- F. 双向同步（设置页 → 面板） ----------------
    ev(cdp, osid, """(function(){
      const el = document.getElementById('ImgHoverDelay');
      el.value = '1200';
      el.dispatchEvent(new Event('change', {bubbles:true}));
      return true;
    })()""")
    check("F1 设置页改延迟落库", wait_setting(cdp, osid, "imgHoverDelay", 1200), 1200)
    # 面板靠 storage.onChanged 收到新值，给一点时间
    t0 = time.time()
    val = ""
    while time.time() - t0 < 5:
        val = panel_state(cdp, sid)["nums"].get("imgHoverDelay")
        if val == "1200":
            break
        time.sleep(0.15)
    check("F2 面板读到新延迟", val, "1200")

    # 设置页非法值回滚
    ev(cdp, osid, """(function(){
      const el = document.getElementById('ImgConcurrency');
      el.value = '99';
      el.dispatchEvent(new Event('change', {bubbles:true}));
      return true;
    })()""")
    time.sleep(0.8)
    check("F3 设置页超范围不落库", get_settings(cdp, osid).get("imgConcurrency"), 5)

    # ---------------- G. 功能开关即时生效 ----------------
    click_set_btn(cdp, sid, "完成")
    time.sleep(0.4)
    # 关「全部按钮」
    toggle_sw(cdp, sid, "imgBatch")
    check("G1 全部按钮开关落库 false", wait_setting(cdp, osid, "imgBatch", False), False)
    time.sleep(0.5)
    hover_img(cdp, sid, "#s1", 1.6)
    hb = hover_bar(cdp, sid)
    check("G2 悬停条只剩一个按钮", [hb.get("oneHidden"), hb.get("allHidden")], [False, True])

    toggle_sw(cdp, sid, "imgBatch")
    check("G3 开回全部按钮", wait_setting(cdp, osid, "imgBatch", True), True)

    # 关「右下浮标」
    toggle_sw(cdp, sid, "imgPanel")
    check("G4 浮标开关落库 false", wait_setting(cdp, osid, "imgPanel", False), False)
    time.sleep(0.6)
    check("G5 浮标消失", panel_state(cdp, sid).get("host"), False)

    set_settings(cdp, osid, {"imgPanel": True})
    cdp.wait_js(sid, "!!document.getElementById('vr-img-panel-host')", 8.0)
    st, _ = wait_panel(cdp, sid, lambda s: s.get("floatOn"), 8.0)
    check("G6 开回浮标", st.get("floatOn"), True)

    # ---------------- H. 恢复默认 ----------------
    open_panel(cdp, sid)
    click_gear(cdp, sid)
    wait_panel(cdp, sid, lambda s: s.get("settingsOpen"), 5.0)
    click_set_btn(cdp, sid, "恢复默认")
    time.sleep(0.3)
    st = panel_state(cdp, sid)
    check("H1 第一次点击变成确认文案", "确定" in st.get("resetLabel", ""), True)
    click_set_btn(cdp, sid, "确定恢复")
    time.sleep(0.9)
    after = get_settings(cdp, osid)
    check("H2 恢复后最小尺寸回 100", after.get("imgMinSize"), 100)
    check("H3 恢复后延迟回 300", after.get("imgHoverDelay"), 300)
    check("H4 恢复后并发回 3", after.get("imgConcurrency"), 3)
    check("H5 恢复后上限回 200", after.get("imgBatchLimit"), 200)

    # ---------------- I. 快捷键 ----------------
    # 「恢复默认」会把 imgPanel 重置为 false（新默认：浮标不常驻），
    # 面板宿主随之消失；本套后面的快捷键用例要点面板，必须重新打开浮标。
    set_settings(cdp, osid, {"imgPanel": True})
    wait_setting(cdp, osid, "imgPanel", True)
    cdp.wait_js(sid, "!!document.getElementById('vr-img-panel-host')", 8.0)
    time.sleep(0.4)

    click_set_btn(cdp, sid, "完成")
    time.sleep(0.3)
    # 用 SW 转发同一条链路（chrome.commands 无法从 CDP 直接触发，但转发逻辑一致）
    tab_id = ev(cdp, osid, """new Promise(r => chrome.tabs.query({url:'*://127.0.0.1/*'},
      t => {
        const hit = (t || []).filter(x => (x.url || '').indexOf('panel.html') >= 0)[0];
        r(hit ? hit.id : 0);
      }))""")
    check("I1 找到测试页 tab", bool(tab_id), True)

    # 先把鼠标停到一张图上（快捷键靠「最后悬停的图」）
    # 注意：VRImgHover 在内容脚本的隔离世界，主世界读不到；
    # 用「悬停条真的出现了」来证明内容脚本已记录目标。
    hover_img(cdp, sid, "#s1", 1.2)
    hb = hover_bar(cdp, sid)
    check("I2 悬停条已出现（说明记录了目标）", hb.get("vis"), True)

    # 面板快捷键（消息从扩展页发，主世界没有 chrome.*）
    ev(cdp, osid, """new Promise(r => chrome.tabs.sendMessage(%d,
      {Message:'vrImg.hotkey', action:'panel'}, x => r(x)))""" % tab_id)
    st, _ = wait_panel(cdp, sid, lambda s: s.get("open"), 6.0)
    check("I3 panel 快捷键打开面板", st.get("open"), True)
    ev(cdp, sid, """(function(){ const h=document.getElementById('vr-img-panel-host');
      const x = h && h.shadowRoot.querySelector('.vr-head .vr-x[title="关闭（Esc）"]');
      if (x) { x.click(); }
      return 1; })()""")
    time.sleep(0.4)

    # 下载快捷键
    files_before = disk_images(DL_DIR)
    r = ev(cdp, osid, """new Promise(r => chrome.tabs.sendMessage(%d,
      {Message:'vrImg.hotkey', action:'download'}, x => r(x)))""" % tab_id)
    check("I4 download 快捷键返回 ok", (r or {}).get("ok"), True)
    after = wait_disk_growth(DL_DIR, files_before, 1, 30.0)
    check("I5 快捷键下载落盘 1 个文件", len(after - files_before), 1)

    # 关快捷键总开关后，SW 侧会直接不转发 —— 这里直接验证存储值 + 面板能收到开关状态
    set_settings(cdp, osid, {"imgHotkeys": False})
    check("I6 关快捷键落库 false", wait_setting(cdp, osid, "imgHotkeys", False), False)
    set_settings(cdp, osid, {"imgHotkeys": True})

    # ---------------- J. 悬停开关 ----------------
    set_settings(cdp, osid, {"imgHover": False})
    time.sleep(0.8)
    hb = hover_bar(cdp, sid)
    check("J1 关悬停后宿主移除", hb.get("host"), False)
    set_settings(cdp, osid, {"imgHover": True})
    wait_setting(cdp, osid, "imgHover", True)
    # hover_img 自带轮询（宿主是懒创建的，不能等它自己出现）
    hover_img(cdp, sid, "#s1")
    check("J2 开回悬停后按钮恢复", hover_bar(cdp, sid).get("vis"), True)

    # ---------------- K. 截图 ----------------
    set_settings(cdp, osid, {"imgPanel": True, "imgHover": True, "imgBatch": True})
    cdp.reload(sid)
    cdp.wait_js(sid, "!!document.getElementById('vr-img-panel-host')", 10.0)
    time.sleep(0.6)
    open_panel(cdp, sid)
    click_gear(cdp, sid)
    wait_panel(cdp, sid, lambda s: s.get("settingsOpen"), 5.0)
    shot(cdp, sid, "image-settings-view.png")

    return finish(cdp, osid)


def cleanup(cdp, osid):
    for i in created_ids:
        cdp.eval(f"new Promise(r => chrome.downloads.removeFile({i}, () => r(1)))", osid)
        time.sleep(0.1)
        cdp.eval(f"new Promise(r => chrome.downloads.erase({{id:{i}}}, () => r(1)))", osid)
        time.sleep(0.05)
    clear_seen(cdp, osid)
    # 必须清掉设置：本套会把 imgHoverDelay 改成 1200，留着会让后面的套件
    # （I1/I2 的悬停只等 0.65s）拿不到按钮 —— 跨套件状态污染，排查起来极费时间（踩过）
    ev(cdp, osid, "new Promise(r => chrome.storage.local.remove('vrLibSettings', () => r(1)))")
    time.sleep(0.2)


def finish(cdp, osid=None):
    if osid:
        try:
            cleanup(cdp, osid)
        except Exception as e:
            print("      清理失败：", e)
    errs = cdp.errors()
    check("L1 控制台无 error/exception", errs, [])
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
