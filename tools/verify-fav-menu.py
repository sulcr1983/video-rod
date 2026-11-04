import base64, os, shutil, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, r"D:/test/download/video-rod/tools")
from cdp_client import Cdp
PORT=9382
CHROME=r"C:/Program Files/Google/Chrome/Application/chrome.exe"
_o=urllib.request.build_opener(urllib.request.ProxyHandler({}))
prof=os.path.join(tempfile.gettempdir(),"vr-favmenu2"); shutil.rmtree(prof,ignore_errors=True)
p=subprocess.Popen([CHROME,"--headless=new","--remote-debugging-port=%d"%PORT,"--user-data-dir="+prof,"--no-first-run","--disable-gpu","--hide-scrollbars","--window-size=1680,1200","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for _ in range(60):
    try: _o.open("http://127.0.0.1:%d/json/version"%PORT,timeout=1).read(); break
    except Exception: time.sleep(0.25)
cdp=Cdp("http://127.0.0.1:%d"%PORT)
tid=cdp.send("Target.createTarget",{"url":"about:blank"})["targetId"]; sid=cdp.attach(tid)
cdp.send("Page.enable",{},sid); cdp.send("Runtime.enable",{},sid)
cdp.send("Emulation.setDeviceMetricsOverride",{"width":1680,"height":1200,"deviceScaleFactor":1,"mobile":False,"screenWidth":1680,"screenHeight":1200},sid)
cdp.send("Page.navigate",{"url":"file:///D:/test/download/video-rod/deliverables/prototypes/media-library-redesign-v1.html"},sid)
time.sleep(2.4)
def ev(js): return cdp.eval(js,sid)
def shot(name,clip=None):
    kw={"format":"png","captureBeyondViewport":False,"clip":clip or {"x":0,"y":0,"width":1680,"height":1200,"scale":1}}
    b=cdp.send("Page.captureScreenshot",kw,sid)
    open(r"D:/test/download/video-rod/deliverables/assets/"+name,"wb").write(base64.b64decode(b["data"])); print("shot",name)
rs=[]
def check(l,ok,d=""):
    rs.append(ok); print(("PASS " if ok else "FAIL ")+l+((" | "+str(d)) if d else ""))
a=ev("""(()=>{const favInSidebar=[...document.querySelectorAll('.side *')].some(el=>el.id==='favList');
  const btn=!!document.querySelector('#favMenuBtn');
  const menuInActions=!!document.querySelector('.topbar .actions #favMenu');
  const rect=(document.querySelector('#favMenu').getBoundingClientRect());
  const pill=!!document.querySelector('#pageTitle .pill');
  const primaryPick=document.querySelector('#pickBtn.primary');
  return {favInSidebar,btn,menuInActions,top:Math.round(rect.top),right:Math.round(rect.right),pill,primaryPick};})()""")
check("侧栏已无收藏夹区块", a["favInSidebar"] is False)
check("菜单按钮+面板挂顶栏操作区", a["btn"] and a["menuInActions"], a)
check("面板定位在按钮下方（top>0 且靠右）", a["top"]>0 and a["right"]>0, (a["top"],a["right"]))
check("标题旁徽章已删", a["pill"] is False)
check("选择目录已降级非橙", not a["primaryPick"])
b=ev("""(()=>{document.querySelector('#favMenuBtn').click();
  const menu=document.querySelector('#favMenu');
  return {open:menu.classList.contains('on'), n:menu.querySelectorAll('#favList .fav-row').length};})()""")
check("点开菜单列出夹子", b["open"] is True and b["n"]>=4, b)
shot("audit-3-favmenu.png",{"x":820,"y":40,"width":700,"height":700,"scale":1.5})
c=ev("""(()=>{document.querySelector('#favMenu #favList .fav-row').click();
  return {closed:!document.querySelector('#favMenu').classList.contains('on'),
          title:document.querySelector('#pageTitle').textContent};})()""")
check("点夹子进入并收起", c["closed"] is True and len(c["title"])>0, c)
shot("audit-4-after.png")
errs=cdp.errors()
check("0 个 JS 错误", len(errs)==0, errs)
print("汇总: %d/%d PASS"%(sum(1 for x in rs if x),len(rs)))
cdp.send("Target.closeTarget",{"targetId":tid}); cdp.close_created(); p.terminate(); p.wait(timeout=8)
sys.exit(0 if all(rs) else 1)
