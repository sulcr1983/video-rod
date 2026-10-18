# M10 侧边栏模式 星愿真机验证 v2（CDP 9223）
# 关键：sidePanel.open() 要求用户手势中同步调用——CDP 合成 el.click() 不够，
# 必须 Input.dispatchMouseEvent 信任输入 + Target.activateTarget 激活窗口。
# hook 是否装上不看标记属性（popup-videorod 后包装会盖掉），看功能：blob 下载落名。
import base64, json, os, sys, time
sys.path.insert(0, r"E:/test/download/video-rod/tools")
from cdp_client import Cdp

CDP = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9223"))
EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
results = {}

def sw_session():
    sw = next(t for t in CDP.targets() if t.get("url", "").endswith(f"{EXT_ID}/js/background.js"))
    sid = CDP.attach(sw["targetId"]); CDP.send("Runtime.enable", {}, sid)
    return sid

def reload_ext():
    ex = CDP.send("Target.createTarget", {"url": "chrome://extensions/"})["targetId"]
    esid = CDP.attach(ex); CDP.send("Runtime.enable", {}, esid)
    time.sleep(2.5)
    CDP.eval("""
    new Promise(resolve => {
      const mgr = document.querySelector('extensions-manager');
      const items = mgr.shadowRoot.querySelector('extensions-item-list');
      const it = [...items.shadowRoot.querySelectorAll('extensions-item')]
        .find(x => x.shadowRoot.querySelector('#name').textContent.includes('钓鱼竿'));
      it.shadowRoot.querySelector('#dev-reload-button').click();
      resolve(1);
    })
    """, esid)
    CDP.send("Target.closeTarget", {"targetId": ex})
    time.sleep(3)

def real_click(psid, selector):
    box = json.loads(CDP.eval("""(() => { const r = document.querySelector(%s).getBoundingClientRect();
      return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()""" % json.dumps(selector), psid))
    for type_ in ("mousePressed", "mouseReleased"):
        CDP.send("Input.dispatchMouseEvent", {"type": type_, "x": box["x"], "y": box["y"],
            "button": "left", "clickCount": 1}, psid)
    time.sleep(1.2)

reload_ext()

# ---------- 1. 入口就位 ----------
pop = CDP.send("Target.createTarget", {"url": f"chrome-extension://{EXT_ID}/popup.html"})["targetId"]
psid = CDP.attach(pop)
CDP.send("Runtime.enable", {}, psid)
CDP.send("Page.enable", {}, psid)
CDP.send("Target.activateTarget", {"targetId": pop})
time.sleep(2.5)
entries = json.loads(CDP.eval("""(() => JSON.stringify({
  drawerBtn: !!document.getElementById('vrSidePanel'),
  settingsToggle: !!document.getElementById('vrSetSidePanel')}))()""", psid))
print("入口:", entries)
results["入口就位"] = "PASS" if entries["drawerBtn"] and entries["settingsToggle"] else "FAIL"

# ---------- 2. 真点开侧边栏（头部图标钮，一键可达） ----------
print("\n=== 真点「侧边栏」 ===")
# 面板可能用默认路径（popup.html 无 tabId 参数），检测必须用「点击前后新增 target」diff，
# 不能按 URL 里的 tabId= 过滤——星愿里 per-tab path 不一定已设置
before_ids = {t["targetId"] for t in CDP.targets()}
real_click(psid, "#vrSidePanel")
time.sleep(4)
panel = None
for t in CDP.targets():
    if t["targetId"] not in before_ids and t["type"] == "page" and "popup.html" in t.get("url", ""):
        panel = t; break
print("侧边栏 target:", panel["url"][:90] if panel else None)
results["侧边栏打开"] = "PASS" if panel else "FAIL"

if panel:
    ssid = CDP.attach(panel["targetId"])
    CDP.send("Runtime.enable", {}, ssid)
    CDP.send("Page.enable", {}, ssid)
    time.sleep(2)
    st = json.loads(CDP.eval("""(() => JSON.stringify({
      shell: !!document.getElementById('vrShell'),
      histEntry: !!document.getElementById('vrOpenHistory')}))()""", ssid))
    print("侧边栏内容:", st)
    results["侧边栏渲染"] = "PASS" if st["shell"] else "FAIL"
    # 功能性验 hook：侧边栏里下 blob，看落名（不看标记属性）
    ts = int(time.time())
    name = f"vr-fix-test/spanel_{ts}.txt"
    CDP.eval("""
    new Promise(r => {
      const blob = new Blob(['sidepanel hook test'], {type: 'text/plain'});
      chrome.downloads.download({url: URL.createObjectURL(blob), filename: %s}, id => r(String(id)));
    })
    """ % json.dumps(name), ssid)
    time.sleep(5)
    sws = sw_session()
    rec = CDP.eval("""
    new Promise(r => chrome.downloads.search({limit: 3, orderBy: ['-startTime']}, items => r(JSON.stringify(
      items.map(i => ({state: i.state, filename: i.filename}))))))
    """, sws)
    items = json.loads(rec)
    hit = any(i["filename"] and i["filename"].endswith(name.split("/")[-1]) for i in items)
    print("侧边栏内下载落名:", hit, "|", items[0]["filename"] if items else None)
    results["侧边栏文件名保护"] = "PASS" if hit else "FAIL"
    # 侧边栏里开历史视图
    CDP.eval("document.getElementById('vrOpenHistory').click()", ssid)
    time.sleep(0.8)
    hist = CDP.eval("document.getElementById('vrHistory').classList.contains('on')", ssid)
    print("侧边栏里历史视图:", hist)
    results["侧边栏内功能"] = "PASS" if hist else "FAIL"
    # 归档截图
    CDP.eval("document.querySelector('#vrHistory [data-back]').click()", ssid)
    time.sleep(1.5)
    h = int(CDP.eval("Math.ceil(document.getElementById('vrShell').getBoundingClientRect().height)", ssid) or 600)
    CDP.send("Emulation.setDeviceMetricsOverride", {"width": 400, "height": max(300, min(900, h)),
        "deviceScaleFactor": 2, "mobile": False}, ssid)
    time.sleep(1)
    s = CDP.send("Page.captureScreenshot", {"format": "png"}, ssid)
    p = r"E:/test/download/video-rod/deliverables/assets/m10-sidepanel.png"
    open(p, "wb").write(base64.b64decode(s["data"]))
    print("截图:", os.path.getsize(p))
    CDP.send("Target.closeTarget", {"targetId": panel["targetId"]})

# ---------- 3. 设置开关 ----------
print("\n=== 设置开关 ===")
real_click(psid, "#btnSettings")
time.sleep(1)
real_click(psid, "#vrSetSidePanel")
time.sleep(1)
sp = CDP.eval("new Promise(r => chrome.storage.sync.get('sidePanel', res => r(JSON.stringify(res.sidePanel))))", psid)
print("sidePanel:", sp)
results["开关写库"] = "PASS" if sp == "true" else "FAIL"
real_click(psid, "#vrSetSidePanel")
time.sleep(1)
sp2 = CDP.eval("new Promise(r => chrome.storage.sync.get('sidePanel', res => r(JSON.stringify(res.sidePanel))))", psid)
print("恢复后:", sp2)
results["开关可逆"] = "PASS" if sp2 == "false" else "FAIL"

print("\n========== M10 总结 ==========")
print(json.dumps(results, ensure_ascii=False, indent=2))
