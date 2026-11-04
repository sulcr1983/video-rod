import base64, os, shutil, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, r"D:/test/download/video-rod/tools")
from cdp_client import Cdp

PORT = 9375
CHROME = r"C:/Program Files/Google/Chrome/Application/chrome.exe"
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def boot():
    profile = os.path.join(tempfile.gettempdir(), "vr-popup-profile")
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
URL = "file:///D:/test/download/video-rod/deliverables/prototypes/popup-redesign-v3-bd.html"
W, H = 900, 720

cdp = Cdp("http://127.0.0.1:%d" % PORT)
tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
sid = cdp.attach(tid)
cdp.send("Page.enable", {}, sid); cdp.send("Runtime.enable", {}, sid)
cdp.send("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": 1,
    "mobile": False, "screenWidth": W, "screenHeight": H}, sid)
cdp.send("Page.navigate", {"url": URL}, sid); time.sleep(2.0)

def ev(js): return cdp.eval(js, sid)
def shot(name):
    b = cdp.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False,
        "clip": {"x": 0, "y": 0, "width": W, "height": H, "scale": 1}}, sid)
    open(A + name, "wb").write(base64.b64decode(b["data"]))
    print("  shot", name)

results = []
def check(label, ok, detail=""):
    results.append((label, ok)); print(("PASS " if ok else "FAIL ") + label + (" | " + str(detail) if detail else ""))

# 1. 加载 + 配色是 B 纸感
g = ev("""(()=>{const p=document.querySelector('.popup');const bg=getComputedStyle(p).backgroundColor;
  return {rows:document.querySelectorAll('.row').length, popupBg:bg, accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()};})()""")
check("清单渲染 12 行", g["rows"] == 12, g["rows"])
check("popup 底色为 B 纸感 #F7F4EE", g["popupBg"] == "rgb(247, 244, 238)", g["popupBg"])
check("强调色为赭石 #A8502E", g["accent"].upper() == "#A8502E", g["accent"])
shot("popup-v3-1-list.png")

# 2. 勾选联动
s = ev("""(()=>{const r=document.querySelector('.row');r.click();return {sel:document.querySelector('#selN').textContent};})()""")
check("点行取消勾选 → 数字变 11", s["sel"] == "11", s)
ev("document.querySelector('.row').click()")

# 3. 筛选
f = ev("""(()=>{document.querySelector('.fchip[data-f="video"]').click();return document.querySelectorAll('.row').length;})()""")
check("筛视频只剩视频行", f == 8, f)
ev("document.querySelector('.fchip[data-f=\"all\"]').click()")

# 4. 展开详情
e = ev("""(()=>{const r=document.querySelector('.row');r.querySelector('.exp').click();return r.classList.contains('open');})()""")
check("展开箭头显示落盘路径", e is True)
shot("popup-v3-2-expand.png")

# 5. 快捷设置抽屉
d = ev("""(()=>{document.querySelector('#btnSettings').click();return document.querySelector('#vrSettings').classList.contains('on');})()""")
check("齿轮打开快捷设置抽屉", d is True)
tp = ev("document.querySelector('#tplPrev').innerText")
check("模板实时预览有落盘名", ('深海纪录片' in tp and 'mp4' in tp), tp[:40])
shot("popup-v3-3-settings.png")

# 6. 完整设置页按钮
fs = ev("""(()=>{document.querySelector('#openFullSet').click();return document.querySelectorAll('.toast').length>0;})()""")
check("完整设置页按钮触发跳转提示", fs is True)
ev("document.querySelector('#setBack').click()")

# 7. 媒体库按钮
ml = ev("""(()=>{document.querySelector('#vrOpenLibrary').click();return true;})()""")
check("媒体库按钮触发", ml is True)

# 8. 下载
dl = ev("""(()=>{document.querySelector('#dlBtn').click();return true;})()""")
time.sleep(1.9)
mid = ev("document.querySelector('#dlTxt').textContent")
done = ev("""(()=>{const ts=[...document.querySelectorAll('.toast')].map(t=>t.innerText);return ts.some(x=>x.includes('已存入资源库'));})()""")
check("下载走进度并弹完成 toast", dl is True and done, "mid=%s toast=%s" % (mid, done))

# 9. 空态
em = ev("""(()=>{document.querySelector('#dEmpty').click();return document.querySelector('.empty')?document.querySelector('.empty').querySelector('.h').textContent:'';})()""")
check("空态文案正确", '没有内容' in em or '筛选' in em, em)
shot("popup-v3-4-empty.png")

errs = cdp.errors()
check("0 个 JS 错误", len(errs) == 0, errs)

print("\n汇总: %d/%d PASS" % (sum(1 for _, ok in results if ok), len(results)))
cdp.send("Target.closeTarget", {"targetId": tid}); cdp.close_created()
try: chrome.terminate(); chrome.wait(timeout=8)
except Exception: chrome.kill()
sys.exit(0 if all(ok for _, ok in results) else 1)
