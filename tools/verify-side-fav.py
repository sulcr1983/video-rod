# 侧栏收藏夹 + 资源树折叠 + 图标修复 + 思源字体 验证
import base64, os, shutil, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, r"D:/test/download/video-rod/tools")
from cdp_client import Cdp

PORT = 9385
CHROME = r"C:/Program Files/Google/Chrome/Application/chrome.exe"
_o = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def boot():
    prof = os.path.join(tempfile.gettempdir(), "vr-sidefav")
    shutil.rmtree(prof, ignore_errors=True)
    p = subprocess.Popen([CHROME, "--headless=new", "--remote-debugging-port=%d" % PORT,
        "--user-data-dir=" + prof, "--no-first-run", "--disable-gpu", "--hide-scrollbars",
        "--window-size=1680,1200", "about:blank"],
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
cdp.send("Page.navigate", {"url": URL}, sid); time.sleep(2.6)

def ev(js): return cdp.eval(js, sid)
def shot(name, clip=None):
    kw = {"format": "png", "captureBeyondViewport": False,
          "clip": clip or {"x": 0, "y": 0, "width": W, "height": H, "scale": 1}}
    b = cdp.send("Page.captureScreenshot", kw, sid)
    open(A + name, "wb").write(base64.b64decode(b["data"])); print("  shot", name)

results = []
def check(label, ok, detail=""):
    results.append((label, ok)); print(("PASS " if ok else "FAIL ") + label + (" | " + str(detail) if detail else ""))

# 1. 收藏夹位置：侧栏底部（索引区上方），顶栏无按钮，预置栏目清空
a = ev("""(()=>{
  const side=document.querySelector('.sidebar .fav-side');
  const foot=document.querySelector('.sidebar .side-foot');
  const order= side&&foot ? (side.compareDocumentPosition(foot)&Node.DOCUMENT_POSITION_FOLLOWING)>0 : false;
  const topbarBtn=!!document.querySelector('.topbar #favMenuBtn');
  const preset=FAVORITES.filter(f=>f.sys!=='star').length;
  return {side:!!side, order, topbarBtn, preset};})()""")
check("收藏夹在侧栏底部（索引区上方）", a["side"] and a["order"], a)
check("顶栏不再有收藏夹按钮", a["topbarBtn"] is False)
check("四个预置栏目已清空", a["preset"] == 0, a["preset"])

# 2. 面板：初始空态；新建夹子出现
# 收藏区已改平铺（2026-11-07）：不再有 favMenuBtn/favMenu 弹层，直接读 #favList
b = ev("""(()=>{
  const list=document.getElementById('favList');
  const empty=list&&list.querySelector('.fav-empty')?list.querySelector('.fav-empty').textContent:'';
  const inp=document.getElementById('favNewInput'); inp.value='我的精选';
  document.querySelector('#favNewOk').click();
  const rows=[...(list?list.querySelectorAll('.fav-row'):[])].map(r=>r.innerText.replace(/\\n/g,''));
  return {empty, rows};})()""")
check("初始空态提示", '还没有收藏夹' in b["empty"], b["empty"])
check("新建「我的精选」出现在列表", any('我的精选' in r for r in b["rows"]), b["rows"])
shot("side-fav-1-open.png", {"x": 0, "y": 620, "width": 460, "height": 580, "scale": 1.6})

# 3. 已加星标动态化
c = ev("""(()=>{
  FILES[0].starred = true; render(); renderFavs();
  const rows=[...document.querySelectorAll('#favList .fav-row')].map(r=>r.innerText.replace(/\\n/g,''));
  return {rows};})()""")
check("加星后「已加星标」动态出现", any('已加星标' in r for r in c["rows"]), c["rows"])

# 4. 资源树折叠
d = ev("""(()=>{
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  const nodes=()=>[...document.querySelectorAll('#tree .tree-node')].map(n=>n.innerText.replace(/\\n/g,''));
  const closed=nodes();
  document.querySelector('#tree .tree-node.plat').click();
  const opened=nodes();
  const inp=document.querySelector('#treeSearch'); inp.value='nasa'; inp.dispatchEvent(new Event('input',{bubbles:true}));
  const searched=nodes();
  inp.value=''; inp.dispatchEvent(new Event('input',{bubbles:true}));
  return {closed, opened, searched};})()""")
check("默认收起：只显示全部素材+平台行（5 行）", len(d["closed"]) == 5, d["closed"])
check("点平台展开其博主", len(d["opened"]) > len(d["closed"]), d["opened"])
check("搜索时自动展开匹配项", any('NASA' in x for x in d["searched"]), d["searched"])
shot("side-fav-2-tree.png", {"x": 0, "y": 60, "width": 300, "height": 1100, "scale": 1.5})

# 5. 信息栏字段图标 fill=none（不再黑色实心）
e = ev("""(()=>{
  const icos=[...document.querySelectorAll('.pi-item dt .k-ico')].map(el=>{
    const cs=getComputedStyle(el); return {fill:cs.fill, color:cs.color};});
  return icos;})()""")
ok_icons = isinstance(e, list) and len(e) >= 10 and all(
    i.get("fill") in ("none", "rgba(0, 0, 0, 0)") for i in e)
check("信息栏字段图标 fill=none（不再黑色实心）", ok_icons, (e[:2] if isinstance(e, list) else e))

# 6. 思源字体加载生效
f = ev("""(async()=>{
  await document.fonts.ready;
  return {sans:document.fonts.check('13px "Noto Sans SC"'),
          serif:document.fonts.check('700 20px "Noto Serif SC"')};})()""")
check("思源黑体/宋体已加载生效", bool(f and f.get("sans") and f.get("serif")), f)
shot("font-loaded.png")

errs = cdp.errors()
check("0 个 JS 错误", len(errs) == 0, errs)

print("\n汇总: %d/%d PASS" % (sum(1 for _, ok in results if ok), len(results)))
cdp.send("Target.closeTarget", {"targetId": tid}); cdp.close_created()
try: chrome.terminate(); chrome.wait(timeout=8)
except Exception: chrome.kill()
sys.exit(0 if all(ok for _, ok in results) else 1)
