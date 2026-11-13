# video-rod 图集扫描验收（I6 模式 A：自动滚动）
#
# 前置：
#   1) python -m http.server 18080（工作目录 test-site，含 media/ 夹具）
#   2) Chrome for Testing + 扩展（推荐用 tools/cdp-run.py 一键起）
# 用法：VR_CDP=http://127.0.0.1:94xx python tools/cdp-image-album-test.py
#
# 覆盖：
#   B 组 —— 直接打三条消息协议（albumScan / albumProgress / albumStop），验状态机
#   C 组 —— 面板里的入口按钮、进度文案、停止按钮、交批量下载
#   D 组 —— 一直滚到底，验 done 与收集完整性
import base64
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

PAGE = os.environ.get("VR_ALBUM_PAGE", "http://127.0.0.1:18080/album.html")
SITE = os.environ.get("VR_SITE_ROOT",
                      os.path.join(os.path.dirname(os.path.dirname(
                          os.path.abspath(__file__))), "test-site"))
ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "deliverables", "assets")
TOTAL_IMGS = 24

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


def set_settings(cdp, osid, patch):
    return ev(cdp, osid, """new Promise(r => chrome.storage.local.get('vrLibSettings', o => {
      const s = Object.assign({}, (o && o.vrLibSettings) || {}, %s);
      chrome.storage.local.set({vrLibSettings: s}, () => r(s));
    }))""" % json.dumps(patch))


def clear_tasks(cdp, osid):
    """清掉上次残留的任务记录：残留任务会让「任务不存在」的用例假失败。"""
    return ev(cdp, osid, """new Promise(r => {
      const area = chrome.storage.session || chrome.storage.local;
      area.remove('vrImgAlbumTasks', () => r(1));
    })""")


# ---------------- 三条协议（从扩展页发，带显式 tabId） ----------------

def album_scan(cdp, osid, tab_id, max_pages, mode="scroll"):
    return ev(cdp, osid, """new Promise(r => chrome.runtime.sendMessage({
      Message:'vrImg.albumScan', action:'vrImg.albumScan',
      maxPages:%d, mode:%s, tabId:%d
    }, res => r(res || null)))""" % (max_pages, json.dumps(mode), tab_id))


def album_progress(cdp, osid, task_id, with_items=False):
    return ev(cdp, osid, """new Promise(r => chrome.runtime.sendMessage({
      Message:'vrImg.albumProgress', action:'vrImg.albumProgress',
      taskId:%s, withItems:%s
    }, res => r(res || null)))""" % (json.dumps(task_id), "true" if with_items else "false"))


def album_stop(cdp, osid, task_id):
    return ev(cdp, osid, """new Promise(r => chrome.runtime.sendMessage({
      Message:'vrImg.albumStop', action:'vrImg.albumStop', taskId:%s
    }, res => r(res || null)))""" % json.dumps(task_id))


def wait_progress(cdp, osid, task_id, pred, timeout=30.0, interval=0.25):
    """轮询直到进度满足条件；返回 (最后一次快照, 耗时)。"""
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        last = album_progress(cdp, osid, task_id) or {}
        if pred(last):
            return last, time.time() - t0
        time.sleep(interval)
    return last or {}, time.time() - t0


# ---------------- 面板 UI ----------------

def album_ui(cdp, sid):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      if (!h) { return {host:false}; }
      const sr = h.shadowRoot;
      const box = sr.querySelector('.vr-album');
      if (!box) { return {host:true, box:false}; }
      const btn = sel => box.querySelector(sel);
      const vis = el => !!el && !el.hidden && getComputedStyle(el).display !== 'none';
      const go = btn('.go'), stop = btn('.stop'), dl = btn('.dl'), again = btn('.again');
      return {
        host: true, box: true,
        msg: (box.querySelector('.msg') || {}).textContent || '',
        busy: box.classList.contains('busy'),
        goText: go ? go.textContent.trim() : '',
        goOn: vis(go), stopOn: vis(stop), dlOn: vis(dl), againOn: vis(again),
        dlText: dl ? dl.textContent.trim() : '',
        pagesVal: (btn('.num') || {}).value || ''
      };
    })()""")


def wait_album_ui(cdp, sid, pred, timeout=8.0):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        last = album_ui(cdp, sid)
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
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const f = h.shadowRoot.querySelector('.vr-float');
      const r = f.getBoundingClientRect();
      const opt = {bubbles:true, cancelable:true, clientX:r.x+r.width/2, clientY:r.y+r.height/2, pointerId:1, button:0};
      f.dispatchEvent(new PointerEvent('pointerdown', opt));
      f.dispatchEvent(new PointerEvent('pointerup', opt));
      return true;
    })()""")


def click_album_btn(cdp, sid, cls):
    """点图集条上的按钮。用 DOM click 而不是坐标：按钮可能在进度刷新时位移。"""
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const b = h && h.shadowRoot.querySelector('.vr-album .%s');
      if (!b || b.hidden) { return false; }
      b.click();
      return true;
    })()""" % cls)


def set_album_pages(cdp, sid, n):
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const i = h && h.shadowRoot.querySelector('.vr-album .num');
      if (!i) { return false; }
      i.value = %s;
      return true;
    })()""" % json.dumps(str(n)))


def shot(cdp, sid, name):
    os.makedirs(ASSETS, exist_ok=True)
    time.sleep(0.3)
    data = cdp.send("Page.captureScreenshot", {"format": "png"}, sid).get("data")
    path = os.path.join(ASSETS, name)
    with open(path, "wb") as f:
        f.write(base64.b64decode(data))
    return path


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0, help="CDP 调试端口（e2e-all 注入）")
    a = ap.parse_args()
    if a.port:
        os.environ["VR_CDP"] = "http://127.0.0.1:%d" % a.port
    cdp = Cdp()
    ext_id, _ = find_ext_id(cdp)
    check("A1 扩展已加载", bool(ext_id), True)
    if not ext_id:
        return finish(cdp)

    check("A2 图集夹具存在", os.path.exists(os.path.join(SITE, "album.html")), True)

    # 扩展页只做消息/存储宿主，不用来跑 UI
    otid = cdp.send("Target.createTarget", {"url": f"chrome-extension://{ext_id}/options.html"})["targetId"]
    osid = cdp.attach(otid)
    cdp.send("Runtime.enable", {}, osid)
    cdp.send("Page.enable", {}, osid)
    cdp.wait_js(osid, "typeof chrome !== 'undefined' && !!chrome.runtime", 8.0)

    clear_tasks(cdp, osid)
    set_settings(cdp, osid, {"imgHover": True, "imgBatch": True, "imgPanel": True,
                             "imgMinSize": 100, "imgBatchLimit": 200, "imgConcurrency": 3})
    # 等设置落库：storage.set 异步，不等会读到 imgPanel 默认 false，浮标永远不建
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
    cdp.wait_js(sid, "!!document.getElementById('vr-img-panel-host')", 10.0)
    time.sleep(0.3)

    # 必须让图集页是「可见」标签：后台标签会被 Chrome 节流，IntersectionObserver
    # 不触发，懒加载的图永远不出现（那样测出来是 0 张，会误判成扩展坏了）
    cdp.send("Target.activateTarget", {"targetId": tid})
    time.sleep(0.2)
    vis = ev(cdp, sid, "document.visibilityState")
    check("A3 图集页为可见标签", vis, "visible")

    tab_id = ev(cdp, osid, """new Promise(r => chrome.tabs.query({}, ts => {
      const t = ts.find(x => (x.url || '').indexOf(%s) === 0);
      r(t ? t.id : -1);
    }))""" % json.dumps(PAGE))
    check("A4 拿到图集页 tabId", tab_id > 0, True)
    if tab_id <= 0:
        return finish(cdp)

    # ---------------- A. 页面与懒加载前提 ----------------
    page = ev(cdp, sid, """(function(){
      const all = document.querySelectorAll('img');
      const loaded = [...all].filter(i => i.naturalWidth > 0);
      return {total: all.length, loaded: loaded.length,
              docH: document.documentElement.scrollHeight,
              vh: window.innerHeight};
    })()""")
    check("A5 页面 24 张 img", page["total"], TOTAL_IMGS)
    # 初始只加载首屏那一两张是夹具的设计：这样「收集数递增」才真的是滚动带来的。
    # 不写死等于 1：视口高度/字体渲染差异可能让第二张也刚好进视口。
    check("A6 初始只加载首屏（≤3 张）", page["loaded"] <= 3, True)
    check("A7 页面高度超过 3 屏（确实需要滚）", page["docH"] > page["vh"] * 3, True)

    # ---------------- B. 三条协议 ----------------
    r = album_scan(cdp, osid, tab_id, 10)
    check("B1 albumScan 返回 taskId", bool(r and r.get("taskId")), True)
    if not r or not r.get("taskId"):
        return finish(cdp)
    task1 = r["taskId"]
    check("B2 初始 state=scanning", r.get("state"), "scanning")

    p0 = album_progress(cdp, osid, task1)
    check("B3 进度字段齐全",
          sorted([k for k in ("page", "maxPages", "collected", "state") if k in (p0 or {})]),
          ["collected", "maxPages", "page", "state"])
    check("B4 maxPages 回显 10", (p0 or {}).get("maxPages"), 10)

    # 收集数与屏数都要真的涨：只涨一个说明「滚了但没采到」或「采了但没滚」
    grow, _ = wait_progress(cdp, osid, task1,
                            lambda s: s.get("collected", 0) >= 3 and s.get("page", 0) >= 2, 20.0)
    check("B5 滚动后收集到图片", grow.get("collected", 0) >= 3, True)
    check("B6 屏数在推进", grow.get("page", 0) >= 2, True)
    print(f"      中途进度：第 {grow.get('page')}/{grow.get('maxPages')} 屏 · "
          f"{grow.get('collected')} 张")

    # 前提变更（2026-11-13，阶段一统一发现层）：pickUrl 会把 data-src 的真地址
    # 直接取到，懒加载夹具在第 1~2 屏就收齐 24 张 —— 「张数必须边滚边涨」不再成立。
    # 保留的正向不变量：已收集数不掉、且仍在增长或已收齐到夹具上限。
    # 反证：采集器坏（collected 停在 0 或回退）→ B7 红；去重坏（超过 24）→ 由 D3 拦。
    s1 = album_progress(cdp, osid, task1) or {}
    time.sleep(1.2)
    s2 = album_progress(cdp, osid, task1) or {}
    c1, c2 = int(s1.get("collected", 0) or 0), int(s2.get("collected", 0) or 0)
    check("B7 收集数不回退且已累积（≥3）", (c2 >= c1) and c2 >= 3, True)
    check("B8 屏数单调递增", s2.get("page", 0) > s1.get("page", 0), True)

    st = album_stop(cdp, osid, task1)
    check("B9 albumStop 返回 ok", (st or {}).get("ok"), True)
    check("B10 停止后 state=stopped", (st or {}).get("state"), "stopped")

    # 停止要真的生效：等两轮扫描周期，数字不能再涨
    time.sleep(1.6)
    q1 = album_progress(cdp, osid, task1) or {}
    time.sleep(1.2)
    q2 = album_progress(cdp, osid, task1) or {}
    check("B11 停止后状态保持 stopped", q2.get("state"), "stopped")
    check("B12 停止后不再继续滚动",
          [q2.get("page"), q2.get("collected")], [q1.get("page"), q1.get("collected")])
    check("B13 停止后已收集的保留", q2.get("collected", 0) > 0, True)

    items = (album_progress(cdp, osid, task1, with_items=True) or {}).get("items")
    check("B14 withItems 返回已收集清单", isinstance(items, list) and len(items) > 0, True)
    if items:
        check("B15 清单项带 url 与 candidates",
              bool(items[0].get("url")) and isinstance(items[0].get("candidates"), list), True)

    # 翻页模式（B 模式）本轮未实现：必须如实拒绝，不能假装接单
    unsup = album_scan(cdp, osid, tab_id, 10, mode="paging")
    check("B16 paging 模式如实拒绝",
          [(unsup or {}).get("ok"), (unsup or {}).get("code")], [False, "IMG_E_UNSUPPORTED"])

    # ---------------- C. 面板入口 ----------------
    click_float(cdp, sid)
    st, _ = wait_album_ui(cdp, sid, lambda s: s.get("box"), 8.0)
    check("C1 面板里有图集条", st.get("box"), True)
    if not st.get("box"):
        return finish(cdp)
    check("C2 入口按钮文案「图集扫描」", st.get("goText"), "图集扫描")
    check("C3 未开始时只有入口按钮",
          [st.get("goOn"), st.get("stopOn"), st.get("dlOn")], [True, False, False])

    set_album_pages(cdp, sid, 10)
    click_album_btn(cdp, sid, "go")
    st, _ = wait_album_ui(cdp, sid, lambda s: s.get("stopOn"), 10.0)
    check("C4 点扫描后出现停止按钮", st.get("stopOn"), True)
    check("C5 进度文案含「屏」和「已收集」",
          ("屏" in st.get("msg", "")) and ("已收集" in st.get("msg", "")), True)
    shot(cdp, sid, "image-album-panel-scanning.png")

    # UI 上的数字也要涨（读文案里的「第 N/10 屏」与「已收集 M 张」）
    def nums(s):
        m = re.search(r"第\s*(\d+)\s*/\s*(\d+)\s*屏", s.get("msg", ""))
        c = re.search(r"已收集\s*(\d+)\s*张", s.get("msg", ""))
        return (int(m.group(1)) if m else -1, int(c.group(1)) if c else -1)

    # C6：UI 必须把张数与屏数都显示出来（与协议层同源）。
    # 「张数递增」这个旧前提同样被统一发现层改掉，改成「显示得出 ≥3 张且页码在走」。
    t0 = time.time()
    first = None
    seen_col = 0
    seen_pg = 0
    while time.time() - t0 < 20:
        cur = album_ui(cdp, sid)
        pg, col = nums(cur)
        seen_col = max(seen_col, col)
        seen_pg = max(seen_pg, pg)
        if first is None and col >= 1:
            first = (pg, col)
        if seen_col >= 3 and seen_pg >= 1:
            break
        time.sleep(0.25)
    check("C6 UI 进度显示张数与屏数（≥3 张 / ≥1 屏）",
          (seen_col >= 3) and (seen_pg >= 1), True)
    print(f"      UI 进度：{first} → 累计 {seen_col} 张 / {seen_pg} 屏")

    # C7：点停止后要进入终态。一次就收齐时扫描可能先自己跑完，
    # 「扫描完成」同样是正确终态；真正要拦的是「点了停止却没停」。
    click_album_btn(cdp, sid, "stop")
    st, _ = wait_album_ui(
        cdp, sid,
        lambda s: ("已停止" in s.get("msg", "")) or ("扫描完成" in s.get("msg", "")), 10.0)
    msg_c7 = st.get("msg", "")
    check("C7 点停止后进入终态（已停止／扫描完成）",
          ("已停止" in msg_c7) or ("扫描完成" in msg_c7), True)
    check("C8 停止后出现下载按钮", st.get("dlOn"), True)
    check("C9 下载按钮带张数", bool(re.match(r"下载这\s*\d+\s*张", st.get("dlText", ""))), True)
    check("C10 停止后扫描按钮恢复为「重新扫描」", st.get("againOn"), True)
    shot(cdp, sid, "image-album-panel-stopped.png")

    # ---------------- D. 一直滚到底 ----------------
    set_album_pages(cdp, sid, 40)
    click_album_btn(cdp, sid, "again")
    done, elapsed = wait_album_ui(cdp, sid, lambda s: "扫描完成" in s.get("msg", ""), 60.0)
    check("D1 滚到底后文案「扫描完成」", "扫描完成" in done.get("msg", ""), True)
    print(f"      到底耗时 {elapsed:.1f}s：{done.get('msg')}")

    m = re.search(r"(\d+)\s*张", done.get("msg", ""))
    collected = int(m.group(1)) if m else 0
    check("D2 到底收集 ≥ 20 张", collected >= 20, True)

    # 到底后页面里所有 img 都该有尺寸了；收集数不该超过真实有效图数
    final = ev(cdp, sid, """(function(){
      const loaded = [...document.querySelectorAll('img')].filter(i => i.naturalWidth >= 100 && i.naturalHeight >= 100);
      return loaded.length;
    })()""")
    check("D3 收集数不超过页面有效图数", collected <= final, True)
    check("D4 页面 24 张全部加载完成", final, TOTAL_IMGS)
    shot(cdp, sid, "image-album-panel-done.png")

    # 走一遍「交批量下载」：只验链路通（真下载由 cdp-image-batch-test.py 覆盖）。
    # 把单批上限压到 1，避免测试在真实下载目录里留 24 个文件。
    # 前置必须清「已下载账本 + 库索引」：上一跑真下过那张图后，本次会被正确判重复
    # 并跳过 → 没有新下载记录 → D6 假红（2026-11-13 实测第二轮复现）。
    ev(cdp, osid, "new Promise(r=>chrome.storage.local.remove('vrImgDownloaded',()=>r(1)))")
    ev(cdp, osid, """new Promise(r=>chrome.runtime.sendMessage(
      {Message:'vrLib.clear', action:'vrLib.clear'}, x => r((x&&x.ok)||false)))""")
    time.sleep(0.8)
    set_settings(cdp, osid, {"imgBatchLimit": 1})
    t0 = time.time()
    while time.time() - t0 < 5:
        cur = ev(cdp, osid, """new Promise(r=>chrome.storage.local.get('vrLibSettings',
              o=>r((o&&o.vrLibSettings)||{})))""")
        if cur.get("imgBatchLimit") == 1:
            break
        time.sleep(0.1)
    dl_before = set()
    for d in (ev(cdp, osid, """new Promise(r => chrome.downloads.search(
          {orderBy:['-startTime'], limit:50}, list => r(list.map(x => ({id:x.id})))))""") or []):
        dl_before.add(d["id"])
    dl_res = ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-panel-host');
      const b = h && h.shadowRoot.querySelector('.vr-album .dl');
      if (!b || b.hidden) { return {ok:false, why:'no-btn'}; }
      b.click();
      return {ok:true};
    })()""")
    check("D5 下载按钮可点", dl_res.get("ok"), True)

    # 进度条可能一闪而过（上限压到 1 张时批量秒完），所以以「真的产生了一条下载」为准
    t0 = time.time()
    hit = None
    while time.time() - t0 < 20:
        recs = ev(cdp, osid, """new Promise(r => chrome.downloads.search(
          {orderBy:['-startTime'], limit:20},
          list => r(list.map(d => ({id:d.id, state:d.state, filename:d.filename})))))""") or []
        new = [d for d in recs if d["id"] not in dl_before]
        if new:
            hit = new
            break
        time.sleep(0.25)
    check("D6 交给现有批量下载（产生下载记录）", bool(hit), True)
    for d in (hit or []):
        created_ids.append(d["id"])
        cdp.eval(f"new Promise(r => chrome.downloads.removeFile({d['id']}, () => r(1)))", osid)
        time.sleep(0.1)
        cdp.eval(f"new Promise(r => chrome.downloads.erase({{id:{d['id']}}}, () => r(1)))", osid)

    return finish(cdp)


def finish(cdp, osid=None):
    errs = cdp.errors()
    check("J1 控制台无 error/exception", errs, [])
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
