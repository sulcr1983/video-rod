import base64, json, os, shutil, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, r"D:/test/download/video-rod/tools")
from cdp_client import Cdp

PORT = 9374
CHROME = r"C:/Program Files/Google/Chrome/Application/chrome.exe"
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def boot():
    profile = os.path.join(tempfile.gettempdir(), "vr-pageui-profile")
    shutil.rmtree(profile, ignore_errors=True)
    p = subprocess.Popen([CHROME, "--headless=new", "--remote-debugging-port=%d" % PORT,
        "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check",
        "--disable-gpu", "--hide-scrollbars", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try: _opener.open("http://127.0.0.1:%d/json/version" % PORT, timeout=1).read(); return p
        except Exception: time.sleep(0.25)
    p.terminate(); raise SystemExit("chrome 启动失败")

chrome = boot()
A = r"D:/test/download/video-rod/deliverables/assets/"
URL = "file:///D:/test/download/video-rod/deliverables/prototypes/page-ui-prototype-v1.html"
W, H = 1440, 960

cdp = Cdp("http://127.0.0.1:%d" % PORT)
tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
sid = cdp.attach(tid)
cdp.send("Page.enable", {}, sid); cdp.send("Runtime.enable", {}, sid)
cdp.send("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": 1,
    "mobile": False, "screenWidth": W, "screenHeight": H}, sid)
cdp.send("Page.navigate", {"url": URL}, sid); time.sleep(2.2)

def ev(js): return cdp.eval(js, sid)
def shot(name):
    b = cdp.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False,
        "clip": {"x": 0, "y": 0, "width": W, "height": H, "scale": 1}}, sid)
    open(A + name, "wb").write(base64.b64decode(b["data"]))
    print("  shot", name)

results = []
def check(label, ok, detail=""):
    results.append((label, ok)); print(("PASS " if ok else "FAIL ") + label + (" | " + str(detail) if detail else ""))

# 1. 基础加载
g = ev("""(()=>{return {tabs:document.querySelectorAll('#tabbar .tab').length, scenes:document.querySelectorAll('.scene').length, err:null};})()""")
check("7 个场景 tab", g["tabs"] == 7, g)
check("7 个场景容器", g["scenes"] == 7)
shot("pageui-1-video.png")

# 2. 视频浮层 hover
v = ev("""(()=>{const s=document.querySelector('.video-stage'); s.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); return document.querySelector('.vob').classList.contains('on');})()""")
check("视频浮层 hover 显示", v is True, v)

# 3. 清晰度菜单
m = ev("""(()=>{document.querySelector('#vobMore').click(); return document.querySelector('#vobMenu').classList.contains('on');})()""")
check("清晰度菜单弹出", m is True, m)
shot("pageui-1-video-menu.png")
ev("document.querySelector('#vobMore').click()")

# 4. 切到图片场景 + 悬停
ev("document.querySelector('[data-scene=\"s-pics\"]').click()")
time.sleep(0.4)
h = ev("""(()=>{const img=document.querySelector('.ph img'); const r=img.getBoundingClientRect(); const ev=new MouseEvent('mouseover',{bubbles:true}); img.dispatchEvent(ev); return {hover: document.querySelector('#hoverBar').classList.contains('on')};})()""")
# mouseover 有 300ms 延时
time.sleep(0.5)
h = ev("""(()=>{return {hover: document.querySelector('#hoverBar').classList.contains('on'), one: document.querySelector('#hbOneTxt').textContent};})()""")
check("图片悬停条出现", h["hover"] is True, h)
shot("pageui-2-hover.png")

# 5. 确认条
c = ev("""(()=>{document.querySelector('#hbAll').click(); return document.querySelector('#confirm').classList.contains('on');})()""")
check("批量确认条弹出", c is True)
shot("pageui-2-confirm.png")
ev("document.querySelector('#cfCancel').click()")

# 6. 清单面板
p = ev("""(()=>{document.querySelector('#floatBtn').click(); return document.querySelector('#panelMask').classList.contains('on');})()""")
check("清单面板打开", p is True)
ev("document.querySelector('#pAll').click()")
sel = ev("document.querySelector('#pSelN').textContent")
check("全选生效", sel == "12", sel)
shot("pageui-2-panel.png")
ev("document.querySelector('#pClose').click()")

# 7. X 场景（v2：统一深色玻璃胶囊 + 平台色点 + 抽屉已存标记）
ev("document.querySelector('[data-scene=\"s-x\"]').click()"); time.sleep(0.3)
ev("document.querySelector('#xbtn').click()"); time.sleep(1.1)
xb = ev("""(()=>{const b=document.querySelector('#xbtn');
  return {txt:b.querySelector('.lbl').textContent, dot:!!b.querySelector('.pdot'),
          glassy:getComputedStyle(b).backdropFilter !== 'none'};})()""")
check("X 按钮：深色玻璃胶囊+平台色点", xb["dot"] is True and xb["glassy"] is True, xb)
check("X 按钮下载态=已保存", xb["txt"] == "已保存", xb["txt"])
ev("document.querySelector('#openXDrawer').click()"); time.sleep(0.3)
xd = ev("""(()=>{const d=document.querySelector('#bulkDrawer');
  const tag=document.querySelector('#bulkList .saved-tag');
  return {on:d.classList.contains('on'), bg:getComputedStyle(d).backgroundColor,
          saved:document.querySelectorAll('#bulkList .d-row.saved').length,
          tag:tag?tag.textContent:''};})()""")
check("批量抽屉=深色玻璃（三平台一套）", xd["on"] is True and xd["bg"] == "rgb(19, 26, 38)", xd["bg"])
check("抽屉内已存标记出现", xd["saved"] == 2 and "已存" in xd["tag"], xd)
shot("pageui-3-x-drawer.png")
ev("document.querySelector('#bulkClose').click()")

# 8. 微博
ev("document.querySelector('[data-scene=\"s-weibo\"]').click()"); time.sleep(0.3)
ev("document.querySelector('#openWeiboDrawer').click()"); time.sleep(0.3)
wb = ev("document.querySelector('#bulkDrawer').classList.contains('on')")
check("微博抽屉打开", wb is True)
shot("pageui-4-weibo.png")
ev("document.querySelector('#bulkClose').click()")

# 9. 小红书
ev("document.querySelector('[data-scene=\"s-xhs\"]').click()"); time.sleep(0.3)
ev("document.querySelector('#openXhsDrawer').click()"); time.sleep(0.3)
xh = ev("document.querySelector('#xhsDrawer').classList.contains('on')")
check("小红书抽屉打开", xh is True)
shot("pageui-5-xhs.png")
ev("document.querySelector('#xhsClose').click()")

# 10. Instagram（v2：SVG 图标 + 色点，去 emoji 与品牌渐变）
ev("document.querySelector('[data-scene=\"s-ig\"]').click()"); time.sleep(0.3)
igc = ev("""(()=>{const b=document.querySelector('#igBtn');
  return {svg:!!b.querySelector('svg'), emoji:b.innerHTML.indexOf('\\u2b07')>=0, dot:!!b.querySelector('.pdot')};})()""")
check("IG 按钮：SVG+色点（去 emoji/品牌渐变）", igc["svg"] is True and igc["emoji"] is False and igc["dot"] is True, igc)
shot("pageui-6-instagram.png")
ig = ev("""(()=>{document.querySelector('#igBtn').click(); return true;})()""")
check("IG 按钮可点", ig is True)

# 11. YouTube
ev("document.querySelector('[data-scene=\"s-yt\"]').click()"); time.sleep(0.3)
shot("pageui-7-youtube.png")

errs = cdp.errors()
check("0 个 JS 错误", len(errs) == 0, errs)

print("\n汇总: %d/%d PASS" % (sum(1 for _, ok in results if ok), len(results)))
cdp.send("Target.closeTarget", {"targetId": tid})
cdp.close_created()
try: chrome.terminate(); chrome.wait(timeout=8)
except Exception: chrome.kill()
sys.exit(0 if all(ok for _, ok in results) else 1)
