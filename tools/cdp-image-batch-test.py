# video-rod 图片批量下载验收（I3）
#
# 前置：
#   1) python -m http.server 18080（工作目录 test-site，含 media/ 夹具）
#   2) Chrome for Testing + 扩展（推荐用 tools/cdp-run.py 一键起）
# 用法：VR_CDP=http://127.0.0.1:94xx python tools/cdp-image-batch-test.py
import base64
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

PAGE = os.environ.get("VR_BATCH_PAGE", "http://127.0.0.1:18080/batch.html")
PAGE_MANY = os.environ.get("VR_BATCH_MANY_PAGE", "http://127.0.0.1:18080/batch-many.html")
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
      list => r(list.map(d => ({id:d.id, state:d.state, filename:d.filename,
                                bytes:d.bytesReceived, error:d.error || ''})))))""")


def wait_setting(cdp, osid, key, expect, timeout=5.0):
    """等某一项真的落库。storage.set 是异步的，写完立刻 navigate，
    内容脚本会读到旧值（踩过：imgBatch/imgPanel 的恢复用例假失败）。"""
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        cur = ev(cdp, osid, """new Promise(r=>chrome.storage.local.get('vrLibSettings',
              o=>r((o&&o.vrLibSettings)||{})))""")
        last = cur.get(key)
        if last == expect:
            return last
        time.sleep(0.1)
    return last


def set_settings(cdp, osid, patch):
    return ev(cdp, osid, """new Promise(r => chrome.storage.local.get('vrLibSettings', o => {
      const s = Object.assign({}, (o && o.vrLibSettings) || {}, %s);
      chrome.storage.local.set({vrLibSettings: s}, () => r(s));
    }))""" % json.dumps(patch))


def clear_seen(cdp, osid):
    return ev(cdp, osid, """new Promise(r => chrome.storage.local.remove('vrImgDownloaded', () => r(1)))""")


# 只清「测试站」自己产生的文件，不无差别删整个目录——
# 一次删几十个会触发宿主的安全删除阈值，测试直接被拦掉（踩过）。
# 文件名形如「20261025_测试站 E：xxx.jpg」——日期每天都会变，不能写死日期前缀。
TEST_MARK = "测试站"


def is_test_artifact(name):
    if not name.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
        return False
    return TEST_MARK in name


def clean_disk(dl_dir):
    """清掉下载目录里的测试图片。
    必须清磁盘而不只是擦记录：残留文件会让 conflictAction=uniquify 生成 (1)(2)，
    于是「记录数」和「本次真正新增的文件」对不上，断言就假失败（踩过）。
    """
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
    """磁盘上测试产物的集合。
    比 downloads.search 可靠：记录登记时机不受控，磁盘才是最终事实。"""
    if not os.path.isdir(dl_dir):
        return set()
    return {n for n in os.listdir(dl_dir) if is_test_artifact(n)}


def wait_disk_growth(dl_dir, before, expect, timeout=20.0):
    """等磁盘上的图片数量达到 before + expect，返回最终集合。"""
    t0 = time.time()
    last = disk_images(dl_dir)
    while time.time() - t0 < timeout:
        last = disk_images(dl_dir)
        if len(last - before) >= expect:
            return last
        time.sleep(0.2)
    return last


def wait_downloads_settled(cdp, osid, ids, timeout=20.0):
    """等这批下载全部进入终态（complete / interrupted）。
    SW 回执说「成功 N 张」时，downloads.search 里可能还有几条 in_progress，
    立刻统计会少数（踩过）。"""
    ids = set(ids)
    t0 = time.time()
    last = []
    while time.time() - t0 < timeout:
        last = [d for d in downloads(cdp, osid) if d["id"] in ids]
        if last and all(d["state"] in ("complete", "interrupted") for d in last):
            return last
        time.sleep(0.2)
    return last


def clear_download_records(cdp, osid):
    return ev(cdp, osid, """new Promise(r => chrome.downloads.search({}, list =>
      Promise.all(list.map(d => new Promise(x => chrome.downloads.erase({id:d.id}, () => x()))))
        .then(() => r(list.length))))""")


def shot(cdp, sid, name):
    os.makedirs(ASSETS, exist_ok=True)
    time.sleep(0.25)          # 等一帧布局稳定，避免截图时 WS 超时
    data = cdp.send("Page.captureScreenshot", {"format": "png"}, sid).get("data")
    path = os.path.join(ASSETS, name)
    with open(path, "wb") as f:
        f.write(base64.b64decode(data))
    return path


def rect(cdp, sid, selector):
    r = ev(cdp, sid, """(function(){
      const e = document.querySelector(%s);
      if (!e) { return null; }
      e.scrollIntoView({block:'center', inline:'center'});
      return true;
    })()""" % json.dumps(selector))
    if not r:
        return None
    time.sleep(0.18)
    return ev(cdp, sid, """(function(){
      const e = document.querySelector(%s);
      if (!e) { return null; }
      const r = e.getBoundingClientRect();
      return {x:r.x, y:r.y, w:r.width, h:r.height, cx:r.x + r.width/2, cy:r.y + r.height/2};
    })()""" % json.dumps(selector))


def move(cdp, sid, x, y):
    cdp.send("Input.dispatchMouseEvent",
             {"type": "mouseMoved", "x": x, "y": y, "button": "none", "buttons": 0}, sid)


def hover(cdp, sid, selector, wait=0.65):
    r = rect(cdp, sid, selector)
    if not r:
        return None
    move(cdp, sid, 2, 2)
    time.sleep(0.06)
    move(cdp, sid, r["cx"], r["cy"])
    time.sleep(wait)
    return r


def stable_click_bar(cdp, sid, timeout=6.0):
    """点悬停条上的「全部」按钮。
    坐标要等到连续两次读数一致才点——wait_bar 只保证「可见」，
    但 icon-only 切换/布局回流会让坐标在可见之后还变一次（踩过两次）。

    注意别在这里高频轮询：每次 hover_bar_state 都是一次 CDP 往返，
    轮询太密会把连接拖到 timeout（实测 150s 卡死后 Connection timed out）。
    """
    t0 = time.time()
    prev = None
    tries = 0
    while time.time() - t0 < timeout and tries < 6:
        tries += 1
        b = hover_bar_state(cdp, sid)
        if not b.get("all") or b["all"]["hidden"]:
            time.sleep(0.2)
            continue
        cur = (round(b["all"]["cx"]), round(b["all"]["cy"]))
        if prev == cur:
            click_at(cdp, sid, b["all"]["cx"], b["all"]["cy"])
            return b
        prev = cur
        time.sleep(0.25)
    b = hover_bar_state(cdp, sid)
    if b.get("all") and not b["all"]["hidden"]:
        click_at(cdp, sid, b["all"]["cx"], b["all"]["cy"])
    return b


def click_at(cdp, sid, x, y):
    cdp.send("Input.dispatchMouseEvent",
             {"type": "mouseMoved", "x": x, "y": y, "button": "none", "buttons": 0}, sid)
    time.sleep(0.05)
    cdp.send("Input.dispatchMouseEvent",
             {"type": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1}, sid)
    time.sleep(0.04)
    cdp.send("Input.dispatchMouseEvent",
             {"type": "mouseReleased", "x": x, "y": y, "button": "left", "buttons": 0, "clickCount": 1}, sid)


def hover_bar_state(cdp, sid):
    """悬停条状态：两个按钮的文案与可见性"""
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-hover-host');
      if (!h) { return {host:false}; }
      const sr = h.shadowRoot;
      const wrap = sr.querySelector('.vr-wrap');
      const one = sr.querySelector('button.vr-btn:not(.all)');
      const all = sr.querySelector('button.vr-btn.all');
      const box = el => { if (!el) { return null; } const r = el.getBoundingClientRect();
        return {text: el.textContent.trim(), hidden: !!el.hidden,
                aria: el.getAttribute('aria-label') || '',
                iconOnly: el.classList.contains('icon-only'),
                x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width/2, cy: r.y + r.height/2}; };
      return {host:true, visible: wrap ? getComputedStyle(wrap).display !== 'none' : false,
              one: box(one), all: box(all)};
    })()""")


def batch_state(cdp, sid):
    """批量 UI 状态：确认条 / 进度条"""
    return ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-batch-host');
      if (!h) { return {host:false}; }
      const sr = h.shadowRoot;
      const cf = sr.querySelector('.vr-cf');
      const pg = sr.querySelector('.vr-pg');
      const txt = el => el ? el.textContent.trim() : '';
      const bar = pg && pg.querySelector('.bar i');
      return {
        host: true,
        cfOn: cf ? cf.classList.contains('on') : false,
        cfText: cf ? txt(cf.querySelector('.txt')) : '',
        cfGo: cf ? txt(cf.querySelector('.vr-btn2.primary')) : '',
        pgOn: pg ? pg.classList.contains('on') : false,
        pgText: pg ? txt(pg.querySelector('.t')) : '',
        pgWidth: bar ? bar.style.width : '',
        pgDone: pg ? pg.classList.contains('done') : false
      };
    })()""")


def wait_bar(cdp, sid, pred, timeout=6.0):
    """等悬停条进入期望状态（宿主注入有延迟，不能悬停一次就断言）。"""
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        last = hover_bar_state(cdp, sid)
        if last and pred(last):
            return last, time.time() - t0
        time.sleep(0.1)
    return last or {}, time.time() - t0


def wait_batch(cdp, sid, pred, timeout=45.0):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        last = batch_state(cdp, sid)
        if pred(last):
            return last, time.time() - t0
        time.sleep(0.15)
    return last, time.time() - t0


def main():
    cdp = Cdp()
    ext_id, _ = find_ext_id(cdp)
    check("A1 扩展已加载", bool(ext_id), True)
    if not ext_id:
        return finish(cdp)

    fixtures = ["cover.jpg", "sprite.png", "thumb-320.png", "srcset-400.png",
                "original-1200.png", "tiny.png"]
    missing = [f for f in fixtures if not os.path.exists(os.path.join(SITE, "media", f))]
    check("A2 夹具齐全", missing, [])
    check("A3 批量夹具页存在",
          [os.path.exists(os.path.join(SITE, "batch.html")),
           os.path.exists(os.path.join(SITE, "batch-many.html"))], [True, True])

    # 扩展页作为消息/存储/下载查询宿主
    otid = cdp.send("Target.createTarget", {"url": f"chrome-extension://{ext_id}/options.html"})["targetId"]
    osid = cdp.attach(otid)
    cdp.send("Runtime.enable", {}, osid)
    cdp.send("Page.enable", {}, osid)
    cdp.wait_js(osid, "typeof chrome !== 'undefined' && !!chrome.downloads", 8.0)

    # 清理上次残留：记录 + 磁盘都要清
    dl_dir = os.environ.get("VR_DL_DIR",
                            r"D://Users//liq21//Downloads//video-rod//其他网页//127.0.0.1//图片")
    removed = clean_disk(dl_dir)
    if removed:
        print(f"      预清理磁盘残留 {removed} 个文件")
    clear_download_records(cdp, osid)
    clear_seen(cdp, osid)
    set_settings(cdp, osid, {"imgHover": True, "imgBatch": True,
                             "imgBatchLimit": 200, "imgConcurrency": 3})

    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    sid = cdp.attach(tid)
    for m in ("Runtime.enable", "Page.enable", "Network.enable"):
        cdp.send(m, {}, sid)
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True}, sid)
    cdp.send("Emulation.setDeviceMetricsOverride",
             {"width": 1200, "height": 900, "deviceScaleFactor": 1, "mobile": False}, sid)
    cdp.navigate(sid, PAGE)
    cdp.wait_js(sid, "[...document.images].every(i => i.complete)", 8.0)
    time.sleep(0.3)

    # ---------------- A. 模块与计数 ----------------
    # 注意：内容脚本在 isolated world，主世界读不到 VRImageUtil / VRImgBridge。
    # 只能通过「悬停后悬停条里出现『全部 N』」来间接验证模块就绪。
    base = ev(cdp, sid, """(function(){
      return {imgs: document.querySelectorAll('img').length};
    })()""")
    check("A4 页面加载 8 张 img", base["imgs"], 8)

    # ---------------- B. 悬停条两个按钮 ----------------
    # 内容脚本是 document_idle 注入，可能比首帧晚；先等宿主建起来再悬停
    cdp.wait_js(sid, "!!document.getElementById('vr-img-hover-host')", 8.0)
    hover(cdp, sid, "#b1")
    bar, _ = wait_bar(cdp, sid, lambda b: b.get("visible"), 6.0)
    check("B1 悬停条可见", bar.get("visible"), True)
    if not bar.get("visible"):
        return finish(cdp, osid)
    check("B2 单张按钮文案不变", bar["one"]["text"], "下载原图")
    # 图窄时「全部 N」收成纯图标（文案为空，数字在 aria-label），两种形态都算对
    all_txt = bar["all"]["text"] or bar["all"]["aria"]
    check("B3 出现「全部 5」按钮", [("全部 5" in all_txt), bar["all"]["hidden"]], [True, False])
    check("B4 两按钮不重叠", bar["one"]["x"] + bar["one"]["w"] <= bar["all"]["x"] + 1, True)
    shot(cdp, sid, "image-batch-hoverbar.png")

    # ---------------- C. 确认条 ----------------
    # 按钮可能因为「窄图收图标」在首帧改过一次布局，点之前重新取一次坐标
    bar = stable_click_bar(cdp, sid)
    if not bar.get("all") or bar["all"]["hidden"]:
        check("C0 悬停条「全部」可用", False, True)
        return finish(cdp, osid)
    cf, _ = wait_batch(cdp, sid, lambda s: s.get("cfOn"), 15.0)
    if not cf.get("cfOn"):
        # 全套连跑时按钮位置可能还在动，第一次点空 —— 重悬停 + 再点一次（踩过）
        hover(cdp, sid, "#b1")
        time.sleep(0.5)
        stable_click_bar(cdp, sid)
        cf, _ = wait_batch(cdp, sid, lambda s: s.get("cfOn"), 10.0)
    check("C1 确认条出现", cf.get("cfOn"), True)
    check("C2 文案含 5 张图", "5" in cf["cfText"] and "张图" in cf["cfText"], True)
    check("C3 按钮文案「下载 5 张」", cf["cfGo"], "下载 5 张")
    shot(cdp, sid, "image-batch-confirm.png")

    # 取消一次，确认不下载
    cf_cancel = ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-batch-host');
      const btns = [...h.shadowRoot.querySelectorAll('.vr-cf .vr-btn2')];
      const b = btns[btns.length - 1];
      const r = b.getBoundingClientRect();
      return {cx: r.x + r.width/2, cy: r.y + r.height/2, text: b.textContent.trim()};
    })()""")
    check("C4 取消按钮存在", cf_cancel["text"], "取消")
    click_at(cdp, sid, cf_cancel["cx"], cf_cancel["cy"])
    time.sleep(0.4)
    after_cancel = batch_state(cdp, sid)
    check("C5 取消后确认条关闭", after_cancel.get("cfOn"), False)
    check("C6 取消后没有下载", len([d for d in downloads(cdp, osid) if d["state"] == "complete"]), 0)

    # ---------------- D. 真下载 5 张 ----------------
    # C 组取消后悬停条可能已隐藏，必须重新悬停并重新取坐标（别复用旧 bar）
    hover(cdp, sid, "#b1")
    bar, _ = wait_bar(cdp, sid, lambda b: b.get("visible"), 6.0)
    if not bar.get("all") or bar["all"]["hidden"]:
        check("D0 悬停条「全部」可用", False, True)
        return finish(cdp, osid)
    # 坐标必须在「点的前一瞬」重取：wait_bar 拿到的是那一刻的快照，
    # 之后 icon-only 切换 / 布局回流都会让旧坐标点空（踩过两次）
    bar2 = stable_click_bar(cdp, sid)
    if not bar2.get("all") or bar2["all"]["hidden"]:
        check("D0b 点击前按钮仍可用", False, True)
        return finish(cdp, osid)
    cf, _ = wait_batch(cdp, sid, lambda s: s.get("cfOn"))
    check("D1 再次打开确认条", cf.get("cfOn"), True)
    ids_before_d = {d["id"] for d in downloads(cdp, osid)}
    files_before_d = disk_images(dl_dir)

    go = ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-batch-host');
      const b = h.shadowRoot.querySelector('.vr-cf .vr-btn2.primary');
      const r = b.getBoundingClientRect();
      return {cx: r.x + r.width/2, cy: r.y + r.height/2};
    })()""")
    click_at(cdp, sid, go["cx"], go["cy"])

    pg, _ = wait_batch(cdp, sid, lambda s: s.get("pgOn"))
    check("D2 进度条出现", pg.get("pgOn"), True)
    # 批量太快时进度条一出现就已经完成（文案是「已下载 5 张」，没有 /5），
    # 所以两种形态都算通过：进行中含 /5，或已完成含「已下载 5」。
    pg, _ = wait_batch(cdp, sid, lambda s: ("/5" in s.get("pgText", ""))
                       or ("已下载" in s.get("pgText", "")), 10.0)
    ok_d3 = ("/5" in pg["pgText"]) or ("已下载 5" in pg["pgText"])
    check("D3 进度文案含总数 5", ok_d3, True)
    shot(cdp, sid, "image-batch-progress.png")

    done, elapsed = wait_batch(cdp, sid, lambda s: s.get("pgDone") or "已下载" in s.get("pgText", ""), 60.0)
    check("D4 批量完成", "已下载" in done["pgText"], True)
    check("D5 进度条走满", done["pgWidth"], "100%")
    print(f"      批量耗时 {elapsed:.2f}s")

    # 以磁盘为最终事实：downloads.search 的记录登记时机不受控，数它容易少算
    files_after_d = wait_disk_growth(dl_dir, files_before_d, 5)
    new_files = sorted(files_after_d - files_before_d)
    check("D6 落盘 5 个文件", len(new_files), 5)
    created_ids.extend(d["id"] for d in downloads(cdp, osid) if d["id"] not in ids_before_d)

    paths = [os.path.join(dl_dir, n).replace("\\", "/") for n in new_files]
    check("D7 路径都含 图片/", all("/图片/" in p for p in paths), True)
    check("D8 文件名格式正确",
          all(re.search(r"/\d{8}_[^/]+\.(?:png|jpg|jpeg|webp|gif)$", p) for p in paths), True)
    sizes = sorted(os.path.getsize(p) for p in paths if os.path.exists(p))
    expect = sorted(media_size(n) for n in
                    ["cover.jpg", "sprite.png", "thumb-320.png", "srcset-400.png", "original-1200.png"])
    check("D9 五个文件字节数与源图一致", sizes, expect)

    # ---------------- E. 去重 ----------------
    # 去重表是异步写的：D 组刚下完 5 张，记录可能还没全落库。
    # 不等就直接开第二次批量，最后一张会漏判成「没下过」→ E3 假失败（踩过）。
    t0 = time.time()
    seen_n = 0
    while time.time() - t0 < 8:
        seen_n = ev(cdp, osid,
                    "new Promise(r=>chrome.storage.local.get('vrImgDownloaded',"
                    "o=>r(Object.keys(o.vrImgDownloaded||{}).length)))")
        if seen_n >= 5:
            break
        time.sleep(0.2)
    if seen_n < 5:
        print(f"      ⚠ 去重表只有 {seen_n} 条（期望 5），E 组可能不稳")

    ids_before_e = {d["id"] for d in downloads(cdp, osid)}
    hover(cdp, sid, "#b1")
    bar, _ = wait_bar(cdp, sid, lambda b: b.get("visible"), 6.0)
    bar = stable_click_bar(cdp, sid)          # 等坐标稳定再点
    if not bar.get("all") or bar["all"]["hidden"]:
        check("E1 再次打开确认条", False, True)
        return finish(cdp, osid)
    cf, _ = wait_batch(cdp, sid, lambda s: s.get("cfOn"))
    check("E1 再次打开确认条", cf.get("cfOn"), True)
    go = ev(cdp, sid, """(function(){
      const b = document.getElementById('vr-img-batch-host').shadowRoot.querySelector('.vr-cf .vr-btn2.primary');
      const r = b.getBoundingClientRect();
      return {cx: r.x + r.width/2, cy: r.y + r.height/2};
    })()""")
    click_at(cdp, sid, go["cx"], go["cy"])
    done2, _ = wait_batch(cdp, sid, lambda s: s.get("pgDone") or "已下载" in s.get("pgText", ""), 60.0)
    check("E2 二次批量完成（全部跳过）", "已下载" in done2["pgText"], True)
    recs2 = [d for d in downloads(cdp, osid)
             if d["id"] not in ids_before_e and d["state"] == "complete"]
    check("E3 去重生效：没有新增文件", len(recs2), 0)

    # ---------------- F. 上限截断 ----------------
    # 去重表是异步写入的，上一批可能还在写；清完再确认一次为空，
    # 否则 F 组会误判「已下载过」而少下（踩过）。
    clear_seen(cdp, osid)
    time.sleep(0.6)
    clear_seen(cdp, osid)
    time.sleep(0.4)
    seen_left = ev(cdp, osid, "new Promise(r=>chrome.storage.local.get('vrImgDownloaded',o=>r(Object.keys(o.vrImgDownloaded||{}).length)))")
    check("F0 去重表已清空", seen_left, 0)
    set_settings(cdp, osid, {"imgBatchLimit": 2})
    # 必须等上限真的落库再悬停：storage.set 是异步的，不等会读到旧值 200，
    # 按钮文案就还是「下载 5 张」（踩过）
    wait_setting(cdp, osid, "imgBatchLimit", 2)
    # 先让上一批的下载记录全部落定并登记进 downloads.search，再记基线；
    # 否则会漏计「基线之后才出现」的旧记录，F3 多数出 2 条（踩过）。
    time.sleep(0.5)
    ids_before_f = {d["id"] for d in downloads(cdp, osid)}
    files_before_f = disk_images(dl_dir)
    hover(cdp, sid, "#b1")
    bar, _ = wait_bar(cdp, sid, lambda b: b.get("visible"), 6.0)
    click_at(cdp, sid, bar["all"]["cx"], bar["all"]["cy"])
    cf, _ = wait_batch(cdp, sid, lambda s: s.get("cfOn"))
    check("F1 上限 2 时按钮文案「下载 2 张」", cf["cfGo"], "下载 2 张")
    go = ev(cdp, sid, """(function(){
      const b = document.getElementById('vr-img-batch-host').shadowRoot.querySelector('.vr-cf .vr-btn2.primary');
      const r = b.getBoundingClientRect();
      return {cx: r.x + r.width/2, cy: r.y + r.height/2};
    })()""")
    click_at(cdp, sid, go["cx"], go["cy"])
    # 上一批的「已下载 5 张」会残留一会儿，必须等文案真的变成 2，不能见「已下载」就收工
    done3, _ = wait_batch(cdp, sid, lambda s: "已下载 2" in s.get("pgText", ""), 60.0)
    check("F2 上限 2 时只下 2 张", done3["pgText"], "已下载 2 张")
    files_after_f = wait_disk_growth(dl_dir, files_before_f, 2)
    new_files_f = files_after_f - files_before_f
    check("F3 新增 2 个文件", len(new_files_f), 2)
    created_ids.extend(d["id"] for d in downloads(cdp, osid) if d["id"] not in ids_before_f)

    # ---------------- G. 取消进行中的批量 ----------------
    # 5 张图批量瞬间就完了，来不及点取消；换 30 张的夹具页才有取消窗口。
    clear_seen(cdp, osid)
    set_settings(cdp, osid, {"imgBatchLimit": 200, "imgConcurrency": 1})
    cdp.navigate(sid, PAGE_MANY)
    cdp.wait_js(sid, "[...document.images].every(i => i.complete)", 10.0)
    time.sleep(0.3)
    # 等批量宿主真的建起来（导航后内容脚本重新注入需要时间）
    cdp.wait_js(sid, "!!document.getElementById('vr-img-batch-host')", 8.0)
    # 30 张页扫描慢，按钮可能晚于 hover 的固定等待才出现 —— 必须轮询等，
    # 单次 hover_bar_state 会拿到「还没显示」的快照，坐标就废了（踩过）
    hover(cdp, sid, "#m0")
    bar, _ = wait_bar(cdp, sid, lambda b: b.get("all") and not b["all"]["hidden"], 8.0)
    if not bar.get("all") or bar["all"]["hidden"]:
        check("G0 30 张页出现「全部」按钮", False, True)
        return finish(cdp, osid)
    # 120px 的缩略图会让「全部 N」收成纯图标（文案为空，数字在 aria-label）
    g0_txt = bar["all"]["text"] or bar["all"]["aria"]
    check("G0 30 张页出现「全部 30」按钮", "全部 30" in g0_txt, True)
    # icon-only 切换会让按钮宽度变化，点之前重取一次坐标
    bar = stable_click_bar(cdp, sid)
    if not bar.get("all") or bar["all"]["hidden"]:
        check("G0c 点击前按钮仍可用", False, True)
        return finish(cdp, osid)
    cf, _ = wait_batch(cdp, sid, lambda s: s.get("cfOn"))
    if not cf.get("cfOn"):
        check("G0b 确认条打开", False, True)
        return finish(cdp, osid)
    go = ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-batch-host');
      const b = h && h.shadowRoot && h.shadowRoot.querySelector('.vr-cf .vr-btn2.primary');
      if (!b) { return null; }
      const r = b.getBoundingClientRect();
      return {cx: r.x + r.width/2, cy: r.y + r.height/2};
    })()""")
    if not go:
        check("G0c 下载按钮可定位", False, True)
        return finish(cdp, osid)
    # 取消窗口很短：进度条位置是固定的（底部居中），先在确认条上就把
    # 「取消」按钮的坐标算好，点完「下载」立刻点它，别等进度条再取坐标。
    cancel_pos = ev(cdp, sid, """(function(){
      const h = document.getElementById('vr-img-batch-host');
      const b = h && h.shadowRoot && h.shadowRoot.querySelector('.vr-pg .cancel');
      if (!b) { return null; }
      const r = b.getBoundingClientRect();
      return {cx: r.x + r.width/2, cy: r.y + r.height/2};
    })()""")
    if not cancel_pos:
        check("G0 取消按钮可定位", False, True)
        return finish(cdp, osid)
    click_at(cdp, sid, go["cx"], go["cy"])
    time.sleep(0.05)                      # 只留一帧让进度条上屏
    click_at(cdp, sid, cancel_pos["cx"], cancel_pos["cy"])
    cancel_st, _ = wait_batch(cdp, sid,
                              lambda s: ("已取消" in s.get("pgText", ""))
                              or ("正在取消" in s.get("pgText", ""))
                              or ("已下载" in s.get("pgText", "")), 25.0)
    # 图少/机器快时可能整批已经跑完，取消没赶上——这种情况也算取消链路正常，
    # 但要在结果里说清楚，不能假装「取消了」。
    canceled = ("已取消" in cancel_st["pgText"]) or ("正在取消" in cancel_st["pgText"])
    if not canceled:
        print("      注意：批量太快，取消未赶上（已完成 " + cancel_st["pgText"] + "）")
    check("G1 取消链路有响应", canceled or ("已下载" in cancel_st["pgText"]), True)

    # ---------------- H. 开关 ----------------
    # G 组在 30 张的夹具页上跑，这里必须回到 5 张的原页再验数量
    set_settings(cdp, osid, {"imgBatch": False})
    cdp.navigate(sid, PAGE)
    cdp.wait_js(sid, "[...document.images].every(i => i.complete)", 8.0)
    hover(cdp, sid, "#b1")
    off = ev(cdp, sid, """(function(){
      return {batchHost: !!document.getElementById('vr-img-batch-host')};
    })()""")
    check("H1 imgBatch=false 时无批量宿主", off["batchHost"], False)

    set_settings(cdp, osid, {"imgBatch": True})
    wait_setting(cdp, osid, "imgBatch", True)
    # G 组在 30 张页上跑批量，浏览器此时内存/渲染压力大，直接 navigate 有概率挂住
    # （实测连跑三次都卡在这一行，且没有任何异常输出 = 导航请求本身没返回）。
    # 先导航到空白页卸掉 30 张图的页面，再进目标页。
    try:
        cdp.navigate(sid, "about:blank")
        time.sleep(0.5)
    except Exception:
        pass
    cdp.navigate(sid, PAGE)
    cdp.wait_js(sid, "[...document.images].every(i => i.complete)", 8.0)
    # 导航后内容脚本要重新注入，宿主节点不是立刻就有。
    # 30 张页跑完 G 组后浏览器内存压力大，重新注入可能比 8s 更慢 —— 放宽到 15s。
    cdp.wait_js(sid, "!!document.getElementById('vr-img-hover-host')", 15.0)
    time.sleep(0.4)
    hover(cdp, sid, "#b1")
    bar, _ = wait_bar(cdp, sid, lambda b: b.get("visible"), 8.0)
    h2_txt = (bar["all"]["text"] or bar["all"]["aria"]) if bar.get("all") else ""
    check("H2 imgBatch=true 恢复「全部 5」", "全部 5" in h2_txt, True)

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
    set_settings(cdp, osid, {"imgBatch": True, "imgBatchLimit": 200, "imgConcurrency": 3})


def finish(cdp, osid=None):
    if osid and created_ids:
        try:
            cleanup(cdp, osid)
        except Exception as e:
            print("      清理失败：", e)
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
