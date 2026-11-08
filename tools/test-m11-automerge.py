# M11 多段自动合并 星愿真机验证（CDP 9223）
# 场景 A（正向）：multi.html 两段 m3u8 → 自动归组 → 勾选下载 → 后台合并 → 点保存 → 落盘
# 场景 B（对抗）：hls.html 双清晰度变体（180p/360p 序号不连续）→ 不得归组
import json, os, sys, time
sys.path.insert(0, r"E:/test/download/video-rod/tools")
from cdp_client import Cdp

CDP = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9223"))
EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
MULTI = "http://127.0.0.1:18080/multi.html"
HLS = "http://127.0.0.1:18080/hls.html"
results = {}
test_started_at = time.time()

def sw_session():
    for attempt in range(4):
        try:
            cdp = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9223"))
            sw = next(t for t in cdp.targets() if t.get("url", "").endswith(f"{EXT_ID}/js/background.js"))
            sid = cdp.attach(sw["targetId"])
            cdp.send("Runtime.enable", {}, sid)
            global CDP
            CDP = cdp
            return sid
        except Exception:
            time.sleep(3)
    raise RuntimeError("SW attach failed")

def reload_ext():
    # 轻量重载：让 SW 自己 runtime.reload()（星愿手动加载的扩展支持这一招，
    # 比开 chrome://extensions 重页面稳——那个页面常把 CDP 连接拖超时）。
    # 失败再退扩展页重载。
    global CDP
    for attempt in range(3):
        try:
            sw = next(t for t in CDP.targets() if t.get("url", "").endswith(f"{EXT_ID}/js/background.js"))
            sid = CDP.attach(sw["targetId"])
            CDP.send("Runtime.enable", {}, sid)
            CDP.eval("chrome.runtime.reload()", sid)
            time.sleep(4)
            print("ext reloaded (SW self-reload)")
            return
        except Exception as e:
            print("reload attempt", attempt, "failed:", str(e)[:60])
            try:
                CDP = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9223"))
            except Exception:
                pass
            time.sleep(2)
    # 兜底：扩展页重载
    ex = CDP.send("Target.createTarget", {"url": "chrome://extensions/"})["targetId"]
    esid = CDP.attach(ex); CDP.send("Runtime.enable", {}, esid)
    time.sleep(3)
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
    print("ext reloaded (extensions page fallback)")

reload_ext()
# 重载后 SW 初始化要几秒；猫抓的 webRequest 嗅探有 initSyncComplete 闸门，
# 初始化完成前的页面请求会被丢掉——等够再开页面
time.sleep(7)
ssid = sw_session()
# 清理上一轮残留的 m3u8 解析页/旧面板页，保持环境干净
for t in CDP.targets():
    u = t.get("url", "")
    if "m3u8.html" in u or "popup.html?tabId=" in u:
        try: CDP.send("Target.closeTarget", {"targetId": t["targetId"]})
        except Exception: pass
time.sleep(1)
print("SW live:", CDP.eval("typeof vrMergeStart === 'function'", ssid))

# ---------- 场景 B 先跑（对抗：不归组） ----------
print("\n=== 场景 B：hls.html 双清晰度不得归组 ===")
ht = CDP.send("Target.createTarget", {"url": HLS})["targetId"]
time.sleep(10)
tab_id = CDP.eval("new Promise(r => chrome.tabs.query({url: 'http://127.0.0.1:18080/hls.html'}, ts => r(ts[0] ? ts[0].id : -1)))", ssid)
print("hls tab:", tab_id)
pop = CDP.send("Target.createTarget", {"url": f"chrome-extension://{EXT_ID}/popup.html?tabId={tab_id}"})["targetId"]
psid = CDP.attach(pop); CDP.send("Runtime.enable", {}, psid); CDP.send("Page.enable", {}, psid)
time.sleep(4)
b_state = CDP.eval("""(() => JSON.stringify({
  cards: document.querySelectorAll('#mediaList .panel').length,
  badges: [...document.querySelectorAll('.vr-multibadge')].map(b => b.textContent)
}))()""", psid)
print("B 状态:", b_state)
bs = json.loads(b_state)
# 对抗判据：不得出现任何归组徽标（卡片数不设门槛，master+变体在猫抓 UI 里可能就 1 卡）
results["对抗-不变体归组"] = "PASS" if len(bs["badges"]) == 0 else "FAIL"
try: CDP.send("Target.closeTarget", {"targetId": pop})
except Exception: pass
try: CDP.send("Target.closeTarget", {"targetId": ht})
except Exception: pass

# ---------- 场景 A（正向全流程） ----------
print("\n=== 场景 A：multi.html 两段自动合并 ===")
# 扩展重载会清空 SW 嗅探缓存——旧 multi 页的数据没了，必须重开页面重新嗅探
for t in CDP.targets():
    if "18080/multi.html" in t.get("url", ""):
        try: CDP.send("Target.closeTarget", {"targetId": t["targetId"]})
        except Exception: pass
mt = CDP.send("Target.createTarget", {"url": MULTI})["targetId"]
time.sleep(11)
tab_id = CDP.eval("new Promise(r => chrome.tabs.query({url: 'http://127.0.0.1:18080/multi.html'}, ts => r(ts[0] ? ts[0].id : -1)))", ssid)
print("multi tab:", tab_id)
pop = CDP.send("Target.createTarget", {"url": f"chrome-extension://{EXT_ID}/popup.html?tabId={tab_id}"})["targetId"]
psid = CDP.attach(pop); CDP.send("Runtime.enable", {}, psid); CDP.send("Page.enable", {}, psid)
time.sleep(4)
a_state = CDP.eval("""(() => JSON.stringify({
  cards: document.querySelectorAll('#mediaList .panel').length,
  badges: [...document.querySelectorAll('.vr-multibadge')].map(b => b.textContent)
}))()""", psid)
print("A 初始:", a_state)
as_ = json.loads(a_state)
results["归组徽标"] = "PASS" if as_["cards"] == 2 and any("2 段" in b for b in as_["badges"]) else "FAIL"

# 全选 + 批量下载（必须等 boot 完：下载钩子是异步挂的，点早了整条链没装上）
booted = False
t0 = time.time()
while time.time() - t0 < 20:
    time.sleep(1)
    if CDP.eval("chrome.downloads.download.__vrHooked === true", psid):
        booted = True
        break
print("boot 就绪:", booted)
# 注意：猫抓默认就把新卡片勾上了，不能再点 chkAll（那一下会把勾选全取消）
dbg0 = CDP.eval("""(() => JSON.stringify({
  checked: getAllData().filter(d => d.parsing === 'm3u8').map(d => d.checked),
  batchCnt: document.getElementById('vrBatchCnt').textContent
}))()""", psid)
print("下载前勾选态:", dbg0)
CDP.eval("document.getElementById('DownFile').click()", psid)
time.sleep(2)
dbg2 = CDP.eval("""(() => JSON.stringify({
  badges: [...document.querySelectorAll('.vr-multibadge')].map(b => b.textContent),
  checked: getAllData().filter(d => d.checked).length
}))()""", psid)
print("下载后:", dbg2)
print("m3u8 标签:", [t.get("url", "")[:60] for t in CDP.targets() if "m3u8.html" in t.get("url", "")])
print("已点批量下载，轮询徽标…")
ready = False
t0 = time.time()
while time.time() - t0 < 150:
    time.sleep(4)
    badges = CDP.eval("[...document.querySelectorAll('.vr-multibadge')].map(b => b.textContent)", psid) or []
    print(f"[{int(time.time()-t0)}s]", badges, flush=True)
    if any("已拼好" in b for b in badges):
        ready = True
        break
    if any("失败" in b for b in badges):
        break
results["后台合并"] = "PASS" if ready else "FAIL"

# 点保存
if ready:
    before_files = set()
    rec0 = CDP.eval("""
    new Promise(r => chrome.downloads.search({limit: 20}, items => r(JSON.stringify(items.map(i => i.filename)))))
    """, ssid)
    before_files = set(json.loads(rec0))
    CDP.eval("""(() => { const b = [...document.querySelectorAll('.vr-multibadge.ready')][0]; if (b) b.click(); })()""", psid)
    print("已点保存，等落盘…")
    saved = False
    t0 = time.time()
    while time.time() - t0 < 60:
        time.sleep(4)
        badges = CDP.eval("[...document.querySelectorAll('.vr-multibadge')].map(b => b.textContent)", psid) or []
        if any("已保存" in b for b in badges):
            saved = True
            break
    results["点保存落盘"] = "PASS" if saved else "FAIL"
    print("徽标:", badges)
else:
    results["点保存落盘"] = "FAIL"

# 落盘校验：扫下载目录找本轮新增的 mp4。Chrome 先写 .crdownload 再改名，
# 落盘有延迟——轮询最多 25 秒
import glob
newest = None
t0 = time.time()
# 2026-11-08：扫仓库内测试目录，不再写死用户下载夹。
# 可用 VR_DL_ROOT 覆盖（需要指向真实下载目录时）。
_SCAN_ROOT = os.environ.get("VR_DL_ROOT") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".work", "dl")
while time.time() - t0 < 25:
    time.sleep(3)
    for f in glob.glob(os.path.join(_SCAN_ROOT, "**", "video-rod", "*.mp4"), recursive=True) + \
             glob.glob(os.path.join(_SCAN_ROOT, "**", "*.mp4"), recursive=True):
        if os.path.getmtime(f) > test_started_at - 60:
            if newest is None or os.path.getmtime(f) > os.path.getmtime(newest):
                newest = f
    if newest and os.path.exists(newest):
        break
print("本轮新增 mp4:", newest, os.path.getsize(newest) if newest else 0)
results["合并文件落地"] = "PASS" if newest and os.path.getsize(newest) > 10000 else "FAIL"
if newest:
    results["落盘路径"] = newest

print("\n========== M11 自动合并 总结 ==========")
print(json.dumps(results, ensure_ascii=False, indent=2))
