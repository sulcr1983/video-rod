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
W, H = 900, 760

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

# 1. 加载 + 配色 + 默认隐藏已下载
g = ev("""(()=>{const p=document.querySelector('.popup');
  return {rows:document.querySelectorAll('.row').length, bg:getComputedStyle(p).backgroundColor,
    accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    tabs:document.querySelectorAll('.tabs .tab').length,
    hasCtl:[...document.querySelectorAll('.tabs .tab')].some(t=>t.textContent.includes('媒体控制'))};})()""")
check("默认隐藏 2 条已下载 → 可见 10 行", g["rows"] == 10, g["rows"])
check("popup 底色 B 纸感 #F7F4EE", g["bg"] == "rgb(247, 244, 238)", g["bg"])
check("强调色赭石 #A8502E", g["accent"].upper() == "#A8502E", g["accent"])
check("媒体控制页签已移除", g["hasCtl"] is False and g["tabs"] == 2, g["tabs"])
shot("popup-v3-1-list.png")

# 2. 概览条按类型一键全选
ov = ev("""(()=>{document.querySelector('.ovt[data-ot="video"]').click();
  return {sel:document.querySelector('#selN').textContent, dl:document.querySelector('#dlTxt').textContent};})()""")
check("点「视频」概览 → 全选未下载视频", ov["sel"] == "6", ov)
check("下载键显示数量+体积", '下载' in ov["dl"] and 'MB' in ov["dl"], ov["dl"])
shot("popup-v3-2-overview.png")

# 3. 忽略已下载开关 → 显示置灰行
ev("""(()=>{document.querySelector('.fchip[data-f="all"]').click();})()""")
ig = ev("""(()=>{const c=document.querySelector('#ignoreDone');c.checked=false;c.dispatchEvent(new Event('change'));
  return {saved:document.querySelectorAll('.row.saved').length, total:document.querySelectorAll('.row').length};})()""")
check("关忽略 → 出现 2 条置灰已下载行", ig["saved"] == 2 and ig["total"] == 12, ig)
shot("popup-v3-3-saved.png")
ev("""(()=>{const c=document.querySelector('#ignoreDone');c.checked=true;c.dispatchEvent(new Event('change'));document.querySelector('.fchip[data-f="all"]').click();})()""")

# 4. 存到哪 / 画质
sv = ev("""(()=>{document.querySelector('#ovSave').click();document.querySelector('#ovQ').click();
  return document.querySelectorAll('.toast').length>=2;})()""")
check("存到哪 / 默认画质 均可点", sv is True)

# 5. 设置一步直达（v3.2：齿轮直达，无抽屉层）
st = ev("""(()=>{document.querySelector('#btnSettings').click();
  const drawer=document.querySelector('#vrSettings');
  const toast=[...document.querySelectorAll('.toast')].map(t=>t.innerText).join('|');
  return {noDrawer:!drawer, toast:toast.includes('options.html')||toast.includes('完整设置页')};})()""")
check("齿轮一步直达完整设置页（无抽屉层）", st["noDrawer"] is True and st["toast"] is True, st)

rd = ev("""(()=>{const r=document.querySelector('.row');
  const btn=r.querySelector('.rowdl'); if(!btn) return {has:false};
  btn.click(); return {has:true};})()""")
check("每行有独立下载键", rd["has"] is True, rd)
time.sleep(0.8)
sv = ev("""(()=>{const c=document.querySelector('#ignoreDone');const was=c.checked;
  c.checked=false;c.dispatchEvent(new Event('change'));
  return {saved:document.querySelectorAll('.row.saved').length, total:document.querySelectorAll('.row').length};})()""")
check("行内下载后该条转为已存（置灰区出现）", sv["saved"] == 3 and sv["total"] == 12, sv)
shot("popup-v3-5-rowdl.png")
ev("document.querySelector('#setBack').click()")

# 6. 展开详情
e = ev("""(()=>{const r=document.querySelector('.row');r.querySelector('.exp').click();return r.classList.contains('open');})()""")
check("展开箭头显示落盘路径", e is True)

# 7. 下载
dl = ev("""(()=>{document.querySelector('#dlBtn').click();return true;})()""")
time.sleep(1.9)
done = ev("""(()=>{const ts=[...document.querySelectorAll('.toast')].map(t=>t.innerText);return ts.some(x=>x.includes('已存入资源库'));})()""")
check("下载走进度并弹完成 toast", done is True, done)

# 8. 空态
em = ev("""(()=>{document.querySelector('#dEmpty').click();return document.querySelector('.empty')?document.querySelector('.empty').querySelector('.h').textContent:'';})()""")
check("空态文案正确", '没有内容' in em, em)

errs = cdp.errors()
check("0 个 JS 错误", len(errs) == 0, errs)

print("\n汇总: %d/%d PASS" % (sum(1 for _, ok in results if ok), len(results)))
cdp.send("Target.closeTarget", {"targetId": tid}); cdp.close_created()
try: chrome.terminate(); chrome.wait(timeout=8)
except Exception: chrome.kill()
sys.exit(0 if all(ok for _, ok in results) else 1)
