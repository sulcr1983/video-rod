# XBD 按钮 v5（业界直链方案）：重载 → 刷新 → 点按钮 → 验落盘（文件名+双轨）
import json
import os
import sys
import time

sys.path.insert(0, r"E:\test\download\video-rod\tools")
from cdp_client import Cdp  # noqa: E402

CDP = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9223"))
TWEET = "https://x.com/m0ve0f/status/2111443787952377869"

# 1. 重载扩展
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
time.sleep(2)

# 2. 刷新推文页 + 等按钮
ts = CDP.targets()
page = next((t for t in ts if t.get("url", "") == TWEET), None)
page_tid = page["targetId"] if page else CDP.send("Target.createTarget", {"url": TWEET})["targetId"]
fsid = CDP.attach(page_tid)
CDP.send("Runtime.enable", {}, fsid)
CDP.send("Page.enable", {}, fsid)
CDP.send("Page.navigate", {"url": TWEET}, fsid)
btn_ok = False
for i in range(30):
    time.sleep(4)
    n = CDP.eval("document.querySelectorAll('.vr-xbtn').length", fsid)
    if n:
        btn_ok = True
        print(f"button at {(i+1)*4}s")
        break
if not btn_ok:
    print("NO BUTTON")
    sys.exit(1)

# 3. 播放（嗅探不是必需了，但保持视频状态真实）
CDP.eval("(async()=>{const v=document.querySelector('article video');if(v&&v.paused){try{await v.play()}catch(e){}}})()", fsid)
time.sleep(4)

# 4. 点按钮
r = CDP.eval("""(() => {
  const b = document.querySelector('.vr-xbtn');
  if (!b) return 'no-btn';
  b.click();
  return 'clicked';
})()""", fsid)
print("click:", r)
time.sleep(6)
cls = CDP.eval("document.querySelector('.vr-xbtn') ? document.querySelector('.vr-xbtn').className : 'gone'", fsid)
print("btn class:", cls)

# 5. 下载记录
sw = next(t for t in CDP.targets()
          if t.get("url", "").endswith("bilfgmaaplmlfgpmjfhdaillmnonjlbj/js/background.js"))
ssid = CDP.attach(sw["targetId"])
CDP.send("Runtime.enable", {}, ssid)
found = None
t0 = time.time()
while time.time() - t0 < 60:
    rec = CDP.eval("""
    new Promise(r => chrome.downloads.search({limit: 3, orderBy: ['-startTime']}, items => r(JSON.stringify(
      items.map(i => ({state: i.state, err: i.error, bytes: i.bytesReceived,
                       file: i.filename && i.filename.file}))))))
    """, ssid)
    items = json.loads(rec)
    print(int(time.time() - t0), "s |", json.dumps(items[0], ensure_ascii=False)[:170], flush=True)
    if items and items[0]["file"]:
        found = items[0]
        break
    time.sleep(6)
print("RESULT:", json.dumps(found, ensure_ascii=False) if found else "none")
