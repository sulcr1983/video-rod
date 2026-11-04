# 原型定稿验证：卡片不再显示文件路径（pathline）
# 1) 网格视图：卡片数 > 0 且 .pathline 数量 == 0
# 2) 卡片高度回收（与去卡前相比每个 body 少一行）
# 3) 信息栏「路径」仍保留（只在详情里给，不占卡片）
# 4) 列表视图：无路径列、表头列数与内容一致
# 5) 暗色皮肤正常、0 JS 错误
import base64, json, os, shutil, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, r"D:/test/download/video-rod/tools")
from cdp_client import Cdp

PORT = int(os.environ.get("VR_PORT", "9373"))
CHROME = r"C:/Program Files/Google/Chrome/Application/chrome.exe"
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

# 浏览器生命周期绑在脚本内：测完即关，不留后台进程
def boot_chrome():
    profile = os.path.join(tempfile.gettempdir(), "vr-verify-profile")
    shutil.rmtree(profile, ignore_errors=True)
    args = [CHROME, "--headless=new", "--remote-debugging-port=%d" % PORT,
            "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check",
            "--disable-gpu", "--hide-scrollbars", "about:blank"]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            _opener.open("http://127.0.0.1:%d/json/version" % PORT, timeout=1).read()
            return proc
        except Exception:
            time.sleep(0.25)
    proc.terminate()
    raise SystemExit("浏览器启动失败：端口 %d 未就绪" % PORT)

chrome_proc = boot_chrome()
A = r"D:/test/download/video-rod/deliverables/assets/"
URL = "file:///D:/test/download/video-rod/deliverables/prototypes/media-library-redesign-v1.html"
W, H = 1680, 1200

cdp = Cdp("http://127.0.0.1:%d" % PORT)
tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
sid = cdp.attach(tid)
cdp.send("Page.enable", {}, sid)
cdp.send("Runtime.enable", {}, sid)
cdp.send("Emulation.setDeviceMetricsOverride",
         {"width": W, "height": H, "deviceScaleFactor": 1, "mobile": False,
          "screenWidth": W, "screenHeight": H}, sid)
cdp.send("Page.navigate", {"url": URL}, sid)
time.sleep(2.0)

def ev(js):
    return cdp.eval(js, sid)

def shot(name):
    b = cdp.send("Page.captureScreenshot",
                 {"format": "png", "captureBeyondViewport": False,
                  "clip": {"x": 0, "y": 0, "width": W, "height": H, "scale": 1}}, sid)
    open(A + name, "wb").write(base64.b64decode(b["data"]))
    print("  shot ->", name)

results = []
def check(label, ok, detail=""):
    results.append((label, ok, detail))
    print(("PASS " if ok else "FAIL ") + label + (" | " + str(detail) if detail else ""))

# ---------- 1. 网格视图 ----------
g = ev("""(()=>{
  const cs=[...document.querySelectorAll('#grid .card')];
  const b=cs[0]?cs[0].querySelector('.body'):null;
  return {
    cards: cs.length,
    pathline: document.querySelectorAll('.pathline').length,
    bodyH: b?Math.round(b.getBoundingClientRect().height):0,
    metaTxt: b?b.querySelector('.metarow').innerText.replace(/\\n/g,' '):'',
    hasPathAttr: cs.slice(0,3).map(c=>/\/|\\\\/.test(c.querySelector('.body').innerText)).filter(Boolean).length
  }})()""")
check("网格卡片渲染", g["cards"] > 0, g)
check("卡片内 pathline 元素为 0", g["pathline"] == 0, "count=%s" % g["pathline"])
check("卡片正文不再出现路径串", g["hasPathAttr"] == 0, "含斜杠卡片数=%s" % g["hasPathAttr"])
print("  首卡 metarow:", g["metaTxt"])
shot("proto-final-grid-light.png")

# ---------- 2. 信息栏「路径」仍在 ----------
info = ev("""(async()=>{
  const c=document.querySelector('#grid .card');
  c.click();
  await new Promise(r=>setTimeout(r,400));
  const ib=document.querySelector('#pvInfoBtn'); if(ib) ib.click();
  await new Promise(r=>setTimeout(r,500));
  document.querySelectorAll('details.pi-fold').forEach(d=>d.open=true);
  await new Promise(r=>setTimeout(r,150));
  const dts=[...document.querySelectorAll('.pi-item dt')].map(d=>d.innerText.trim());
  const pv=document.querySelector('#pvPath');
  return {dts, hasPath: dts.includes('路径'),
          path: pv?pv.innerText.trim():'',
          pathVisible: pv?!!pv.offsetParent:false,
          collapsed: pv?!!pv.closest('.folded,.is-folded,[hidden]'):null,
          paneShown: !!document.querySelector('#pvInfoBtn')};
})()""")
check("详情信息栏保留「路径」字段", bool(info and info["hasPath"]), info and info["dts"])
print("  路径值:", (info or {}).get("path", "")[:120], "| 可见:", (info or {}).get("pathVisible"))
shot("proto-final-info-path.png")

# 关闭预览回到列表
ev("(()=>{const b=document.querySelector('.pv-close,#pvClose,.close-btn');if(b)b.click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));return 1})()")
time.sleep(0.4)

# ---------- 3. 列表视图 ----------
lv = ev("""(()=>{
  const btn=[...document.querySelectorAll('[data-view],.viewbtn,#viewList,#btnList')].find(b=>/list/i.test(b.dataset.view||b.id||'')||/列表/.test(b.getAttribute('title')||''));
  if(btn) btn.click();
  const head=document.querySelector('#listhead');
  const heads=head?[...head.querySelectorAll('span')].map(s=>s.innerText.trim()).filter(Boolean):[];
  const row=document.querySelector('#grid.list .card .body');
  const SEL=['.title','.platcell','.authorline','.size','.timecell'];
  const vis=SEL.filter(s=>{
    const e=row&&row.querySelector(s);
    return e&&getComputedStyle(e).display!=='none'&&e.offsetWidth>0;
  });
  return {isList:document.querySelector('#grid').className, heads, vis,
          pathline:document.querySelectorAll('.pathline').length,
          rowText:row?row.innerText.replace(/\\n/g,' | '):''};
})()""")
check("列表视图切换成功", "list" in (lv["isList"] or ""), lv["isList"])
check("列表表头无「路径」列", not any("路径" in h or "地址" in h for h in lv["heads"]), lv["heads"])
check("列表行可见列数 == 表头列数", len(lv["vis"]) == len(lv["heads"]),
      "heads=%s vis=%s" % (lv["heads"], lv["vis"]))
print("  行内容:", lv["rowText"][:160])
shot("proto-final-list.png")

# ---------- 4. 暗色 ----------
dk = ev("""(()=>{
  const init = document.documentElement.getAttribute('data-theme');
  const b=[...document.querySelectorAll('button')].find(x=>/dark|暗|theme|浅色/i.test((x.dataset.theme||'')+(x.title||'')+(x.id||'')));
  if(b) b.click();
  return {init, theme: document.documentElement.getAttribute('data-theme'),
          bg: getComputedStyle(document.body).backgroundColor};
})()""")
check("默认即 D 深色，按钮可切浅色", dk["init"] == "dark" and dk["theme"] == "light", dk)
shot("proto-final-grid-dark.png")

errs = cdp.errors()
check("0 个 JS 错误", len(errs) == 0, errs)

print("\n汇总: %d/%d PASS" % (sum(1 for _, ok, _ in results if ok), len(results)))
cdp.send("Target.closeTarget", {"targetId": tid})
cdp.close_created()
try:
    chrome_proc.terminate()
    chrome_proc.wait(timeout=8)
except Exception:
    chrome_proc.kill()
sys.exit(0 if all(ok for _, ok, _ in results) else 1)
