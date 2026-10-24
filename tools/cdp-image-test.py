# video-rod 图片悬停下载验收（I1/I2）
#
# 前置：
#   1) python -m http.server 18080（工作目录 test-site，含 media/ 夹具）
#   2) Chrome for Testing：
#      --remote-debugging-port=9352
#      --user-data-dir=E:\test\video-rod\.work\profiles\ext-b
#      --load-extension=E:\test\video-rod\.work\wt-image
# 用法：VR_CDP=http://127.0.0.1:9352 python tools/cdp-image-test.py
import base64
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

PAGE = os.environ.get("VR_IMG_PAGE", "http://127.0.0.1:18080/images.html")
SITE = os.environ.get("VR_SITE_ROOT", r"E:/test/video-rod/test-site")
ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "deliverables", "assets")

results = []
created_ids = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f"   got={got!r} expect={expect!r}"))


def ev(cdp, sid, js):
    r = cdp.eval(js, sid)
    if isinstance(r, dict) and "__error" in r:
        raise RuntimeError(r["__error"])
    return r


def media_size(name):
    return os.path.getsize(os.path.join(SITE, "media", name))


def rect(cdp, sid, selector):
    r = ev(cdp, sid, """(function(){
      const e = document.querySelector(%s);
      if (!e) { return null; }
      e.scrollIntoView({block:'center', inline:'center'});
      return true;
    })()""" % json.dumps(selector))
    if not r:
        return None
    # scrollIntoView 之后布局要一帧才稳定；不等就会拿旧坐标，鼠标落到图外
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


def button_state(cdp, sid):
    return ev(cdp, sid, """(function(){
      const host = document.getElementById('vr-img-hover-host');
      if (!host) { return {host:false}; }
      const sr = host.shadowRoot;
      const wrap = sr && sr.querySelector('.vr-wrap');
      const b = sr && sr.querySelector('button.vr-btn');
      if (!b) { return {host:true, btn:false}; }
      const r = b.getBoundingClientRect();
      return {
        host:true, btn:true,
        text: b.textContent.trim(),
        cls: b.className,
        disabled: !!b.disabled,
        visible: wrap ? getComputedStyle(wrap).display !== 'none' : false,
        inShadow: document.querySelector('button.vr-btn') === null,
        x:r.x, y:r.y, w:r.width, h:r.height, cx:r.x + r.width/2, cy:r.y + r.height/2
      };
    })()""")


def click(cdp, sid, x, y):
    cdp.send("Input.dispatchMouseEvent",
             {"type": "mouseMoved", "x": x, "y": y, "button": "none", "buttons": 0}, sid)
    time.sleep(0.05)
    cdp.send("Input.dispatchMouseEvent",
             {"type": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1}, sid)
    time.sleep(0.04)
    cdp.send("Input.dispatchMouseEvent",
             {"type": "mouseReleased", "x": x, "y": y, "button": "left", "buttons": 0, "clickCount": 1}, sid)


def downloads(cdp, osid):
    return ev(cdp, osid, """new Promise(r => chrome.downloads.search(
      {orderBy:['-startTime'], limit:20},
      list => r(list.map(d => ({id:d.id, state:d.state, filename:d.filename,
                                bytes:d.bytesReceived, error:d.error || ''})))))""")


def wait_new_download(cdp, osid, before_ids, timeout=8.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        for d in downloads(cdp, osid):
            if d["id"] in before_ids:
                continue
            if d["state"] == "complete":
                return d, time.time() - t0
        time.sleep(0.08)
    return None, time.time() - t0


def set_img_hover(cdp, osid, value):
    return ev(cdp, osid, """new Promise(r => chrome.storage.local.get('vrLibSettings', o => {
      const s = Object.assign({}, (o && o.vrLibSettings) || {}, {imgHover: %s});
      chrome.storage.local.set({vrLibSettings: s}, () => r(s.imgHover));
    }))""" % ("true" if value else "false"))


def shot(cdp, sid, name):
    os.makedirs(ASSETS, exist_ok=True)
    data = cdp.send("Page.captureScreenshot", {"format": "png"}, sid).get("data")
    path = os.path.join(ASSETS, name)
    with open(path, "wb") as f:
        f.write(base64.b64decode(data))
    return path


def main():
    cdp = Cdp()
    ext_id, _ = find_ext_id(cdp)
    check("A1 扩展已加载（background.js）", bool(ext_id), True)
    if not ext_id:
        return finish(cdp)

    fixtures = ["cover.jpg", "sprite.png", "tiny.png", "placeholder.png",
                "thumb-320.png", "original-1200.png", "srcset-400.png",
                "srcset-1200.png", "icon.svg", "data-300.png"]
    missing = [f for f in fixtures if not os.path.exists(os.path.join(SITE, "media", f))]
    check("A2 测试夹具齐全", missing, [])

    # 扩展页作为消息/下载查询宿主
    otid = cdp.send("Target.createTarget", {"url": f"chrome-extension://{ext_id}/options.html"})["targetId"]
    osid = cdp.attach(otid)
    cdp.send("Runtime.enable", {}, osid)
    cdp.send("Page.enable", {}, osid)
    time.sleep(1.8)

    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    sid = cdp.attach(tid)
    for m in ("Runtime.enable", "Page.enable", "Network.enable"):
        cdp.send(m, {}, sid)
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True}, sid)
    cdp.send("Emulation.setDeviceMetricsOverride",
             {"width": 1200, "height": 900, "deviceScaleFactor": 1, "mobile": False}, sid)

    # 确保开关为开
    set_img_hover(cdp, osid, True)
    cdp.send("Page.navigate", {"url": PAGE}, sid)
    time.sleep(1.6)

    base = ev(cdp, sid, """(function(){
      return {imgs: document.querySelectorAll('img').length,
              big1: !!document.getElementById('big1'),
              host: !!document.getElementById('vr-img-hover-host')};
    })()""")
    check("B1 页面加载（5 张图、无注入节点）", [base["imgs"], base["big1"], base["host"]], [5, True, False])

    # 快速划过：不应出现
    r = rect(cdp, sid, "#big2")
    move(cdp, sid, 2, 2)
    time.sleep(0.05)
    move(cdp, sid, r["cx"], r["cy"])
    time.sleep(0.08)
    move(cdp, sid, 2, 2)
    time.sleep(0.55)
    st = button_state(cdp, sid)
    check("B2 快速划过不出现按钮", bool(st.get("visible")), False)

    # 悬停 300ms 出现
    img = hover(cdp, sid, "#big1")
    st = button_state(cdp, sid)
    check("B3 悬停出现『下载原图』", [st.get("visible"), st.get("text")], [True, "下载原图"])
    check("B4 按钮在 Shadow DOM 内", st.get("inShadow"), True)
    within = (abs((st["x"] + st["w"]) - (img["x"] + img["w"] - 8)) <= 2 and
              abs(st["y"] - (img["y"] + 8)) <= 2)
    check("B5 按钮贴图片右上角（内缩 8px）", within, True)
    shot(cdp, sid, "image-hover-button.png")

    # 移开隐藏
    move(cdp, sid, 4, 4)
    time.sleep(0.55)
    check("B6 移开 300ms 后隐藏", bool(button_state(cdp, sid).get("visible")), False)

    # ---- C. 单张下载 ----
    before = {d["id"] for d in downloads(cdp, osid)}
    img = hover(cdp, sid, "#big1")
    st = button_state(cdp, sid)
    click(cdp, sid, st["cx"], st["cy"])
    rec, elapsed = wait_new_download(cdp, osid, before)
    check("C1 点击后 3 秒内下载完成", [bool(rec), elapsed <= 3.0], [True, True])
    print(f"      耗时 {elapsed:.2f}s")
    if not rec:
        return finish(cdp)
    created_ids.append(rec["id"])
    path = rec["filename"].replace("\\", "/")
    check("C2 路径含 video-rod/.../图片/", "/video-rod/" in path and "/图片/" in path, True)
    check("C3 平台按 host 归入其他网页", "/video-rod/其他网页/127.0.0.1/图片/" in path, True)
    check("C4 文件名 <日期>_<标题>.<ext>",
          bool(re.search(r"/\d{8}_[^/]+\.(?:png|jpg|jpeg|webp|gif)$", path)), True)
    exists = os.path.exists(rec["filename"])
    size = os.path.getsize(rec["filename"]) if exists else 0
    check("C5 文件存在且非空", [exists, size > 0], [True, True])
    check("C6 落盘内容与页面图一致", size, media_size("cover.jpg"))

    # 下载完成态截图（✓ 已存）
    deadline = time.time() + 1.2
    while time.time() < deadline:
        s = button_state(cdp, sid)
        if "done" in str(s.get("cls", "")):
            shot(cdp, sid, "image-hover-done.png")
            break
        time.sleep(0.05)
    print("      截图：", os.path.join(ASSETS, "image-hover-button.png"), "|",
          os.path.join(ASSETS, "image-hover-done.png"))

    # ---- D. 候选优先 ----
    data_b64 = base64.b64encode(open(os.path.join(SITE, "media", "data-300.png"), "rb").read()).decode()
    injected = ev(cdp, sid, """(async function(){
      const box = document.createElement('div');
      box.id = 'vr-test-fixtures';
      box.style.cssText = 'margin:24px 0; display:flex; flex-wrap:wrap; gap:16px';
      box.innerHTML = `
        <a id="lnk" href="/media/original-1200.png"><img id="linked" src="/media/thumb-320.png" width="160" height="160"></a>
        <img id="srcset" src="/media/srcset-400.png" srcset="/media/srcset-400.png 400w, /media/srcset-1200.png 1200w" width="200" height="200">
        <img id="lazy" src="/media/thumb-320.png" data-original-src="/media/original-1200.png" width="160" height="160">
        <img id="tiny" src="/media/tiny.png" width="16" height="16">
        <img id="svgimg" src="/media/icon.svg" width="120" height="120">
        <img id="ph" src="/media/placeholder.png" width="300" height="150">
        <img id="dataimg" src="data:image/png;base64," width="150" height="150">
      `;
      document.body.appendChild(box);
      box.querySelector('#dataimg').src = 'data:image/png;base64,' + %s;
      const imgs = [...box.querySelectorAll('img')];
      await Promise.all(imgs.map(i => i.complete ? Promise.resolve() : new Promise(r => {
        i.addEventListener('load', r, {once:true});
        i.addEventListener('error', r, {once:true});
      })));
      return imgs.map(i => ({id:i.id, w:i.naturalWidth, h:i.naturalHeight}));
    })()""" % json.dumps(data_b64))
    check("D0 夹具已注入且解码", [len(injected or []), all(i["w"] > 0 for i in injected or [])], [7, True])

    def click_and_size(selector, expect_name, tag):
        before = {d["id"] for d in downloads(cdp, osid)}
        url_before = ev(cdp, sid, "location.href")
        # 必须每次都重新悬停：上一张图点完会停在 done 态（1.2s 才隐藏），
        # 直接复用 button_state 会点到旧按钮的坐标，下到的还是上一张图。
        hover(cdp, sid, selector)
        st = button_state(cdp, sid)
        check(f"{tag}1 悬停样式图片出现按钮", bool(st.get("visible")), True)
        if not st.get("visible"):
            return None
        click(cdp, sid, st["cx"], st["cy"])
        rec2, el2 = wait_new_download(cdp, osid, before)
        check(f"{tag}2 下载完成", bool(rec2), True)
        if not rec2:
            return None
        created_ids.append(rec2["id"])
        got = os.path.getsize(rec2["filename"]) if os.path.exists(rec2["filename"]) else -1
        check(f"{tag}3 取到原图（{expect_name}）", got, media_size(expect_name))
        check(f"{tag}4 点击按钮未触发原图链接跳转", ev(cdp, sid, "location.href"), url_before)
        return rec2

    click_and_size("#linked", "original-1200.png", "E")
    time.sleep(0.2)
    click_and_size("#srcset", "srcset-1200.png", "F")
    time.sleep(0.2)
    click_and_size("#lazy", "original-1200.png", "G")
    time.sleep(0.2)

    # ---- H. 过滤：不应出现按钮 ----
    def no_button(selector, tag):
        hover(cdp, sid, selector)
        s = button_state(cdp, sid)
        check(tag, bool(s.get("visible")), False)

    no_button("#tiny", "H1 16×16 不出现")
    no_button("#svgimg", "H2 SVG 不出现")
    no_button("#ph", "H3 占位图不出现")
    no_button("#dataimg", "H4 data URI 不出现")

    # ---- I. 开关 ----
    # 注意：内容脚本跑在 isolated world，window.__vrImgHoverLoaded 在主世界读不到，
    # 因此断言只看「有没有宿主节点」+「悬停出不出按钮」这两个可跨 world 观测的事实。
    set_img_hover(cdp, osid, False)
    cdp.send("Page.reload", {"ignoreCache": True}, sid)
    time.sleep(2.0)
    hover(cdp, sid, "#big1")
    off = ev(cdp, sid, """(function(){
      return {host: !!document.getElementById('vr-img-hover-host')};
    })()""")
    st_off = button_state(cdp, sid)
    check("I1 imgHover=false 时无注入节点且悬停不出按钮",
          [off["host"], bool(st_off.get("visible"))], [False, False])

    set_img_hover(cdp, osid, True)
    cdp.send("Page.reload", {"ignoreCache": True}, sid)
    time.sleep(2.0)
    hover(cdp, sid, "#big1")
    check("I2 imgHover=true 恢复按钮", bool(button_state(cdp, sid).get("visible")), True)

    return finish(cdp)


def cleanup(cdp, osid):
    for i in created_ids:
        cdp.eval(f"new Promise(r => chrome.downloads.removeFile({i}, () => r(1)))", osid)
        time.sleep(0.1)
        cdp.eval(f"new Promise(r => chrome.downloads.erase({{id:{i}}}, () => r(1)))", osid)
    leftovers = []
    for d in downloads(cdp, osid):
        if d["id"] in created_ids and d["filename"] and os.path.exists(d["filename"]):
            try:
                os.remove(d["filename"])
            except OSError:
                leftovers.append(d["filename"])
    if leftovers:
        print("      未能删除：", leftovers)
    set_img_hover(cdp, osid, True)


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
    _osid = None
    _cdp = None
    try:
        _cdp = Cdp()
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print("\n脚本异常：", e)
        sys.exit(2)
