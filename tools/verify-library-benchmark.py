# 资源库同行借鉴三增量验证：空格预览 / 搜索交集排除 / 智能收藏夹
import base64, os, shutil, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, r"D:/test/download/video-rod/tools")
from cdp_client import Cdp

PORT = 9377
CHROME = r"C:/Program Files/Google/Chrome/Application/chrome.exe"
_o = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def boot():
    prof = os.path.join(tempfile.gettempdir(), "vr-libbench")
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

# 1. 空格键打开预览（Finder 心智）
ev("""(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));return 1})()""")
time.sleep(0.8)   # openPreview 走 View Transitions，hidden 在动画回调里移除
sp = ev("""(()=>{const pv=document.querySelector('#preview');
  return {open: !pv.classList.contains('hidden')};})()""")
check("空格键打开预览", sp["open"] is True, sp)
time.sleep(0.6)
shot("lib-bench-space-preview.png")
ev("""(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 1})()""")
time.sleep(0.3)
closed = ev("!document.querySelector('#preview').classList.contains('hidden')")
check("Esc 关闭预览仍正常", closed is False, closed)

# 2. 搜索交集 / 排除（booru 语法）
q1 = ev("""(()=>{
  const inp=document.querySelector('#search');
  inp.value='nasa'; inp.dispatchEvent(new Event('input',{bubbles:true}));
  return document.querySelectorAll('#grid .card').length;})()""")
q2 = ev("""(()=>{
  const inp=document.querySelector('#search');
  inp.value='nasa video'; inp.dispatchEvent(new Event('input',{bubbles:true}));
  return document.querySelectorAll('#grid .card').length;})()""")
q3 = ev("""(()=>{
  const inp=document.querySelector('#search');
  inp.value='nasa -nasa'; inp.dispatchEvent(new Event('input',{bubbles:true}));
  return document.querySelectorAll('#grid .card').length;})()""")
check("单词搜索 nasa 有结果", q1 > 0, q1)
check("交集 nasa video 更少", 0 < q2 < q1, "nasa=%s nasa video=%s" % (q1, q2))
check("排除 -词 生效（nasa -nasa = 0）", q3 == 0, q3)
ev("""(()=>{const i=document.querySelector('#search');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()""")

# 3. 收藏区（2026-11-08 苏哥拍板：只有一个「收藏」，不命名、不新建、无智能夹）
# 旧断言「把筛选存成智能收藏夹」已不适用：#favSaveFilter 随 DOM 删除。
fav = ev("""(()=>{
  const rows=[...document.querySelectorAll('#favList .fav-row')];
  const hasSaveFilter=!!document.querySelector('#favSaveFilter');
  return {rowCount:rows.length, hasSaveFilter};})()""")
check("收藏区只有一行", fav["rowCount"] == 1, fav)
check("无「存为智能夹」入口", fav["hasSaveFilter"] is False)

# 点收藏进入筛选态（收藏为空时结果为 0，只验证状态切换）
favClick = ev("""(()=>{
  document.querySelector('#favList .fav-row').click();
  return {active:document.querySelector('#favList .fav-row').classList.contains('active')};})()""")
check("点收藏进入筛选态", favClick["active"] is True, favClick)
shot("lib-bench-smart-fav.png")

errs = cdp.errors()
check("0 个 JS 错误", len(errs) == 0, errs)

print("\n汇总: %d/%d PASS" % (sum(1 for _, ok in results if ok), len(results)))
cdp.send("Target.closeTarget", {"targetId": tid}); cdp.close_created()
try: chrome.terminate(); chrome.wait(timeout=8)
except Exception: chrome.kill()
sys.exit(0 if all(ok for _, ok in results) else 1)
