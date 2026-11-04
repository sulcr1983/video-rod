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

# 3. 智能收藏夹：把当前筛选存为夹
sf = ev("""(()=>{
  const before=FAVORITES.length;
  document.querySelector('#favSaveFilter').click();
  const fav=FAVORITES[FAVORITES.length-1];
  return {before, after:FAVORITES.length, isSmart:!!fav.smart, name:fav.name,
          rowShown:!!document.querySelector('#favList [data-fav="'+fav.id+'"]')};})()""")
check("点漏斗 → 新增智能收藏夹", sf["after"] == sf["before"] + 1 and sf["isSmart"] is True, sf)
check("侧栏出现智能夹行", sf["rowShown"] is True)
# 智能夹计数与规则生效：切进去看数量
cnt = ev("""(()=>{
  const fav=FAVORITES[FAVORITES.length-1];
  document.querySelector('#favList [data-fav="'+fav.id+'"]').click();
  return {rows:document.querySelectorAll('#grid .card').length, expect:favMembers(fav).length};})()""")
check("智能夹视图行数 = 规则命中数", cnt["rows"] == cnt["expect"] and cnt["rows"] > 0, cnt)
shot("lib-bench-smart-fav.png")

errs = cdp.errors()
check("0 个 JS 错误", len(errs) == 0, errs)

print("\n汇总: %d/%d PASS" % (sum(1 for _, ok in results if ok), len(results)))
cdp.send("Target.closeTarget", {"targetId": tid}); cdp.close_created()
try: chrome.terminate(); chrome.wait(timeout=8)
except Exception: chrome.kill()
sys.exit(0 if all(ok for _, ok in results) else 1)
