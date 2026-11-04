# 首页 D 深色 + 彩色徽章 + 信息栏规划感 验证
import base64, os, shutil, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, r"D:/test/download/video-rod/tools")
from cdp_client import Cdp

PORT = 9378
CHROME = r"C:/Program Files/Google/Chrome/Application/chrome.exe"
_o = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def boot():
    prof = os.path.join(tempfile.gettempdir(), "vr-dark-ui")
    shutil.rmtree(prof, ignore_errors=True)
    p = subprocess.Popen([CHROME, "--headless=new", "--remote-debugging-port=%d" % PORT,
        "--user-data-dir=" + prof, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try: _o.open("http://127.0.0.1:%d/json/version" % PORT, timeout=1).read(); return p
        except Exception: time.sleep(0.25)
    p.terminate(); raise SystemExit("chrome 启动失败")

chrome = boot()
A = r"D:/test/download/video-rod/deliverables/assets/"
URL = "file:///D:/test/download/video-rod/deliverables/prototypes/media-library-redesign-v1.html"
W, H = 1680, 1200

cdp = Cdp("http://127.0.0.1:%d" % PORT)
tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]; sid = cdp.attach(tid)
cdp.send("Page.enable", {}, sid); cdp.send("Runtime.enable", {}, sid)
cdp.send("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": 1,
    "mobile": False, "screenWidth": W, "screenHeight": H}, sid)
cdp.send("Page.navigate", {"url": URL}, sid); time.sleep(2.2)

def ev(js): return cdp.eval(js, sid)
def shot(name):
    b = cdp.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False,
        "clip": {"x": 0, "y": 0, "width": W, "height": H, "scale": 1}}, sid)
    open(A + name, "wb").write(base64.b64decode(b["data"])); print("  shot", name)

results = []
def check(label, ok, detail=""):
    results.append((label, ok)); print(("PASS " if ok else "FAIL ") + label + (" | " + str(detail) if detail else ""))

# 1. 默认 D 深色
t = ev("document.documentElement.getAttribute('data-theme')")
bg = ev("getComputedStyle(document.body).backgroundColor")
check("默认主题 = D 深色", t == "dark" and bg == "rgb(10, 11, 14)", (t, bg))

# 2. 统计卡四色徽章
st = ev("""(()=>{
  const map={};
  document.querySelectorAll('.stats .stat-ico').forEach(el=>{
    const cs=getComputedStyle(el);
    map[el.className.baseVal||el.className]={bg:cs.backgroundColor,color:cs.color};
  });
  return map;})()""")
colors = [v["color"] for v in st.values()]
distinct = len(set(colors)) == 4
check("统计卡 4 枚彩色徽章且颜色互不相同", len(st) == 4 and distinct, st)
shot("ui-dark-1-home.png")

# 3. 信息栏：组微卡片 + 组色点 + 字段图标
info = ev("""(async()=>{
  const c=document.querySelector('#grid .card'); c.click();
  await new Promise(r=>setTimeout(r,400));
  const ib=document.querySelector('#pvInfoBtn'); if(ib) ib.click();
  await new Promise(r=>setTimeout(r,500));
  const groups=[...document.querySelectorAll('.pi-group')].map(g=>{
    const cs=getComputedStyle(g);
    return {border:cs.borderTopWidth, radius:cs.borderTopLeftRadius,
            dot: getComputedStyle(g.querySelector('.pi-label'),'::before').backgroundColor,
            ico: !!g.querySelector('dt .k-ico')};
  });
  const dts=[...document.querySelectorAll('.pi-item dt .k-ico')].length;
  return {groups, icons:dts};})()""")
check("信息栏分组已是微卡片（边框+圆角）", all(g["border"] == "1px" and g["radius"] != "0px" for g in info["groups"]), info["groups"])
dots = set(g["dot"] for g in info["groups"])
check("三组各有色点且不同色", len(dots) == 3, dots)
check("字段前彩色小图标 ≥ 10 个", info["icons"] >= 10, info["icons"])
shot("ui-dark-2-info.png")

errs = cdp.errors()
check("0 个 JS 错误", len(errs) == 0, errs)

print("\n汇总: %d/%d PASS" % (sum(1 for _, ok in results if ok), len(results)))
cdp.send("Target.closeTarget", {"targetId": tid}); cdp.close_created()
try: chrome.terminate(); chrome.wait(timeout=8)
except Exception: chrome.kill()
sys.exit(0 if all(ok for _, ok in results) else 1)
