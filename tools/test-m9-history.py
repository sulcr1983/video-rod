# M9 下载历史面板 星愿真机验证（CDP 9223）
# 1. X 按钮下载 → SW 记账（新代码）→ 2. popup 历史视图渲染 → 3. 删除记录 → 4. 返回键
import json, os, sys, time
sys.path.insert(0, r"E:/test/download/video-rod/tools")
from cdp_client import Cdp

CDP = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9223"))
EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
TWEET = "https://x.com/m0ve0f/status/2111443787952377869"
results = {}

def sw_session():
    sw = next(t for t in CDP.targets() if t.get("url", "").endswith(f"{EXT_ID}/js/background.js"))
    sid = CDP.attach(sw["targetId"])
    CDP.send("Runtime.enable", {}, sid)
    return sid

def reload_ext():
    ex = CDP.send("Target.createTarget", {"url": "chrome://extensions/"})["targetId"]
    esid = CDP.attach(ex)
    CDP.send("Runtime.enable", {}, esid)
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

reload_ext()
ssid = sw_session()
print("SW live:", CDP.eval("typeof vrMarkDownloaded === 'function'", ssid))

# ---------- 1. X 按钮下载（触发 SW 记账） ----------
print("\n=== 1. X 按钮下载 ===")
nt = CDP.send("Target.createTarget", {"url": TWEET})["targetId"]
fsid = CDP.attach(nt)
CDP.send("Runtime.enable", {}, fsid)
CDP.send("Page.enable", {}, fsid)
btn_ok = False
for i in range(24):
    time.sleep(5)
    if CDP.eval("document.querySelectorAll('.vr-xbtn').length", fsid):
        btn_ok = True
        print(f"button at ~{(i+1)*5}s")
        break
    CDP.eval("window.scrollBy(0, 300)", fsid)
if not btn_ok:
    print("NO BUTTON"); sys.exit(1)
before = CDP.eval("new Promise(r => chrome.storage.local.get(['vrDownloaded'], res => r(Object.keys((res.vrDownloaded||{})).length)))", ssid)
print("下载前记录数:", before)
CDP.eval("document.querySelector('.vr-xbtn').click()", fsid)
time.sleep(12)
after = CDP.eval("new Promise(r => chrome.storage.local.get(['vrDownloaded'], res => r(JSON.stringify(Object.values(res.vrDownloaded||{})))))", ssid)
recs = json.loads(after)
print("下载后记录数:", len(recs), "| 最新:", recs[-1] if recs else None)
results["SW记账"] = "PASS" if len(recs) == (before or 0) + 1 else "FAIL"

# ---------- 2. popup 历史视图 ----------
print("\n=== 2. popup 历史视图 ===")
pop = CDP.send("Target.createTarget", {"url": f"chrome-extension://{EXT_ID}/popup.html"})["targetId"]
psid = CDP.attach(pop)
CDP.send("Runtime.enable", {}, psid)
time.sleep(2.5)
has_row = CDP.eval("!!document.getElementById('vrOpenHistory')", psid)
print("设置里有「下载历史」入口:", has_row)
errs = [e for e in CDP.events if e.get("method") == "Runtime.exceptionThrown"]
print("popup 异常数:", len(errs))
CDP.eval("document.getElementById('vrOpenHistory').click()", psid)
time.sleep(1)
hist = CDP.eval("""(() => JSON.stringify({
  open: document.getElementById('vrHistory').classList.contains('on'),
  cnt: document.getElementById('vrHistoryCnt').textContent,
  rows: document.querySelectorAll('#vrHistoryList .hrow').length,
  firstName: (document.querySelector('#vrHistoryList .hname') || {}).textContent || '',
  emptyHidden: !document.getElementById('vrHistoryEmpty').classList.contains('on')
}))()""", psid)
print("历史视图:", hist)
h = json.loads(hist)
results["历史渲染"] = "PASS" if h["open"] and h["rows"] >= 1 and "唐十七呀" in h["firstName"] else "FAIL"

# ---------- 3. 返回键 + 删除记录 ----------
print("\n=== 3. 返回键 + 删除 ===")
CDP.eval("document.querySelector('#vrHistory [data-back]').click()", psid)
time.sleep(0.8)
back_ok = CDP.eval("""(() => JSON.stringify({
  settingsOn: document.getElementById('vrSettings').classList.contains('on'),
  historyOff: !document.getElementById('vrHistory').classList.contains('on')
}))()""", psid)
print("返回设置:", back_ok)
CDP.eval("document.getElementById('vrOpenHistory').click()", psid)
time.sleep(0.8)
n_before = CDP.eval("document.querySelectorAll('#vrHistoryList .hrow').length", psid)
CDP.eval("document.querySelector('#vrHistoryList .hrow .del').click()", psid)
time.sleep(1)
n_after = CDP.eval("document.querySelectorAll('#vrHistoryList .hrow').length", psid)
print(f"删除一行: {n_before} -> {n_after}")
results["删除记录"] = "PASS" if n_after == n_before - 1 else "FAIL"

# ---------- 4. 二次确认清空（只验第一下武装，不真清） ----------
CDP.eval("document.getElementById('vrHistoryClear').click()", psid)
time.sleep(0.5)
armed = CDP.eval("document.getElementById('vrHistoryClear').textContent", psid)
print("清空按钮第一下:", armed)
results["二次确认"] = "PASS" if "再点一次" in (armed or "") else "FAIL"

print("\n========== M9 总结 ==========")
print(json.dumps(results, ensure_ascii=False, indent=2))
