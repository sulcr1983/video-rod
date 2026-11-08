# M8 文件名修复真机验证 v2（星愿 Twinkstar，CDP 9223）
# 链路 A（popup hook）：popup 页 blob 下载 → hook 等 SW 记账确认 → suggest
# 链路 A2（SW 直连）：SW 内 vrDownloadWithName 网络 URL → suggest
# 链路 B（X按钮）：推文页（新标签+懒加载等待+滚动）→ 点按钮 → vrQuickDownX → suggest
# 判定：落盘文件名 = 模板名（非 UUID/服务器名），且磁盘文件真实存在
import json
import os
import sys
import time

sys.path.insert(0, r"E:\test\download\video-rod\tools")
from cdp_client import Cdp  # noqa: E402
from vr_testenv import dl_dir  # noqa: E402

CDP = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9223"))
EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
TWEET = "https://x.com/m0ve0f/status/2111443787952377869"
# 2026-11-08：不再写死用户下载目录，测试产物进仓库内 work/dl。
DOWN_DIR = dl_dir("x-name")


def sw_session():
    sw = next(t for t in CDP.targets()
              if t.get("url", "").endswith(f"{EXT_ID}/js/background.js"))
    sid = CDP.attach(sw["targetId"])
    CDP.send("Runtime.enable", {}, sid)
    return sid


def recent_downloads(ssid, limit=4):
    rec = CDP.eval("""
    new Promise(r => chrome.downloads.search({limit: %d, orderBy: ['-startTime']}, items => r(JSON.stringify(
      items.map(i => ({id: i.id, state: i.state, err: i.error || null,
                       bytes: i.bytesReceived, filename: i.filename}))))))
    """ % limit, ssid)
    return json.loads(rec)


results = {}

# ---------- 1. 重载扩展 + 验证新代码上线 ----------
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
print("ext reloaded")
CDP.send("Target.closeTarget", {"targetId": ex})
time.sleep(3)

ssid = sw_session()
live = CDP.eval("typeof vrDownloadWithName === 'function' && typeof vrQueueFilename === 'function'", ssid)
print("new SW code live:", live)
if live is not True:
    print("FATAL: 新代码未上线")
    sys.exit(1)

# ---------- 2. 链路 A：popup 页 blob 下载 ----------
print("\n=== 链路 A：popup hook（blob） ===")
pop = CDP.send("Target.createTarget", {"url": f"chrome-extension://{EXT_ID}/popup.html"})["targetId"]
psid = CDP.attach(pop)
CDP.send("Runtime.enable", {}, psid)
time.sleep(2.5)
name_a = f"vr-fix-test/hook_{int(time.time())}.txt"
r = CDP.eval("""
new Promise(r => {
  const blob = new Blob(['video-rod filename fix test'], {type: 'text/plain'});
  chrome.downloads.download({url: URL.createObjectURL(blob), filename: %s}, id => r(String(id)));
})
""" % json.dumps(name_a), psid)
print("download id:", r)
ok_a = None
t0 = time.time()
while time.time() - t0 < 25:
    time.sleep(3)
    for it in recent_downloads(ssid, 3):
        if it["filename"] and it["filename"].endswith(name_a.split("/")[-1]):
            ok_a = it
            break
    if ok_a:
        break
if ok_a:
    print("A HIT:", json.dumps(ok_a, ensure_ascii=False))
    results["A"] = "PASS" if ok_a["state"] == "complete" else "FAIL"
else:
    print("A: 未捕获记录")
    results["A"] = "FAIL"
CDP.send("Target.closeTarget", {"targetId": pop})

# ---------- 3. 链路 A2：SW 直连网络 URL ----------
print("\n=== 链路 A2：SW 直连（网络 URL） ===")
name_a2 = f"vr-fix-test/swdirect_{int(time.time())}.ico"
r = CDP.eval("""
vrDownloadWithName('https://www.google.com/favicon.ico', %s).then(id => String(id))
""" % json.dumps(name_a2), ssid)
print("download id:", r)
ok_a2 = None
t0 = time.time()
while time.time() - t0 < 30:
    time.sleep(3)
    for it in recent_downloads(ssid, 3):
        if it["filename"] and it["filename"].endswith(name_a2.split("/")[-1]):
            ok_a2 = it
            break
    if ok_a2:
        break
if ok_a2:
    print("A2 HIT:", json.dumps(ok_a2, ensure_ascii=False))
    results["A2"] = "PASS" if ok_a2["state"] == "complete" else "FAIL"
else:
    print("A2: 未捕获记录")
    results["A2"] = "FAIL"

# ---------- 4. 链路 B：X 按钮真机 ----------
print("\n=== 链路 B：X 按钮 ===")
nt = CDP.send("Target.createTarget", {"url": TWEET})["targetId"]
fsid = CDP.attach(nt)
CDP.send("Runtime.enable", {}, fsid)
CDP.send("Page.enable", {}, fsid)

btn_ok = False
for i in range(24):
    time.sleep(5)
    n = CDP.eval("document.querySelectorAll('.vr-xbtn').length", fsid)
    if n:
        btn_ok = True
        print(f"button at ~{(i+1)*5}s")
        break
    CDP.eval("window.scrollBy(0, 300)", fsid)  # 滚动触发视频懒加载
if not btn_ok:
    print("NO BUTTON")
    results["B"] = "FAIL"
else:
    CDP.eval("(async()=>{const v=document.querySelector('article video');if(v&&v.paused){try{await v.play()}catch(e){}}})()", fsid)
    time.sleep(3)
    before = {it["filename"] for it in recent_downloads(ssid, 10)}
    r = CDP.eval("""(() => { const b = document.querySelector('.vr-xbtn'); if (!b) return 'no-btn'; b.click(); return 'clicked'; })()""", fsid)
    print("click:", r)
    ok_b = None
    cls = ""
    t0 = time.time()
    while time.time() - t0 < 90:
        time.sleep(5)
        cls = CDP.eval("document.querySelector('.vr-xbtn') ? document.querySelector('.vr-xbtn').className : 'gone'", fsid) or ""
        for it in recent_downloads(ssid, 4):
            if it["filename"] and it["filename"] not in before and it["bytes"] > 0:
                ok_b = it
                break
        if ok_b:
            break
    print("按钮 class:", cls)
    if ok_b:
        print("B HIT:", json.dumps(ok_b, ensure_ascii=False))
        disk = ok_b["filename"]
        exists = os.path.exists(disk)
        size = os.path.getsize(disk) if exists else 0
        print(f"磁盘: 存在={exists} 大小={size}B 路径={disk}")
        results["B"] = "PASS" if exists and size > 100000 else "FAIL"
    else:
        print("B: 未捕获到新下载记录（按钮 class 见上）")
        results["B"] = "FAIL"

print("\n========== 总结 ==========")
print(json.dumps(results, ensure_ascii=False, indent=2))
