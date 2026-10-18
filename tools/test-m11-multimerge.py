# M11 多段合并 星愿真机验证（CDP 9223）
# 素材：本地测试服 split_a/split_b（variant_360p 的前 2 段 / 后 2 段）
# 预期：拼接结果 = 完整 4 段 360p 8 秒视频，落盘 video-rod/m11-merge-test.mp4
import json, os, sys, time
sys.path.insert(0, r"E:/test/download/video-rod/tools")
from cdp_client import Cdp

CDP = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9223"))
EXT_ID = "bilfgmaaplmlfgpmjfhdaillmnonjlbj"
BASE = "http://127.0.0.1:18080/media"
results = {}

def sw_session():
    # 重载后旧 SW target 可能已死，附加可能竞态超时——带重试，每次换新连接
    last_err = None
    for attempt in range(4):
        try:
            cdp = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9223"))
            sw = next(t for t in cdp.targets() if t.get("url", "").endswith(f"{EXT_ID}/js/background.js"))
            sid = cdp.attach(sw["targetId"])
            cdp.send("Runtime.enable", {}, sid)
            global CDP
            CDP = cdp
            return sid
        except Exception as e:
            last_err = e
            time.sleep(3)
    raise RuntimeError(f"SW 附加失败: {last_err}")

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

reload_ext()
ssid = sw_session()
print("SW live:", CDP.eval("typeof vrDownloadWithName === 'function'", ssid))
mp4_before = CDP.eval("new Promise(r => chrome.storage.sync.get('M3u8Mp4', res => r(JSON.stringify(res.M3u8Mp4))))", ssid)
print("M3u8Mp4 原值:", mp4_before)

# ---------- 打开控制器页并开跑 ----------
page = CDP.send("Target.createTarget", {"url": f"chrome-extension://{EXT_ID}/m3u8-multi.html"})["targetId"]
psid = CDP.attach(page)
CDP.send("Runtime.enable", {}, psid)
CDP.send("Page.enable", {}, psid)
time.sleep(2)
CDP.eval("""
document.getElementById('filename').value = 'm11-merge-test';
document.getElementById('urls').value = %s;
""" % json.dumps(BASE + "/split_a.m3u8\n" + BASE + "/split_b.m3u8"), psid)
CDP.eval("document.getElementById('startBtn').click()", psid)
print("已开跑，轮询状态…")

ok = False
t0 = time.time()
while time.time() - t0 < 180:
    time.sleep(5)
    st = CDP.eval("""(() => JSON.stringify({
      log: document.getElementById('log').textContent.slice(-400),
      segs: [...document.querySelectorAll('.seg')].map(s => s.querySelector('.st').textContent),
      btn: document.getElementById('startBtn').textContent
    }))()""", psid)
    s = json.loads(st)
    print(f"[{int(time.time()-t0)}s] segs={s['segs']} btn={s['btn']}")
    if "完成！" in s["log"] or s["btn"] == "开始拼接":
        ok = True
        break
print("最终日志:", json.loads(st)["log"][-500:])

# ---------- 验落盘 ----------
time.sleep(3)
rec = CDP.eval("""
new Promise(r => chrome.downloads.search({limit: 3, orderBy: ['-startTime']}, items => r(JSON.stringify(
  items.map(i => ({state: i.state, filename: i.filename, bytes: i.bytesReceived}))))))
""", ssid)
items = json.loads(rec)
print("下载记录:", json.dumps(items[:2], ensure_ascii=False))
hit = next((i for i in items if i["filename"] and "m11-merge-test" in i["filename"]), None)
results["落盘文件名"] = "PASS" if hit and hit["filename"].endswith("video-rod\\m11-merge-test.mp4".replace("\\", "\\")) or (hit and "m11-merge-test.mp4" in hit["filename"]) else "FAIL"
if hit:
    p = hit["filename"]
    exists = os.path.exists(p)
    size = os.path.getsize(p) if exists else 0
    print(f"磁盘: {p} | 存在={exists} 大小={size}")
    results["文件落地"] = "PASS" if exists and size > 10000 else "FAIL"
else:
    results["文件落地"] = "FAIL"

mp4_after = CDP.eval("new Promise(r => chrome.storage.sync.get('M3u8Mp4', res => r(JSON.stringify(res.M3u8Mp4))))", ssid)
print("M3u8Mp4 恢复后:", mp4_after)
results["设置恢复"] = "PASS" if mp4_after == mp4_before else "FAIL"

print("\n========== M11 总结 ==========")
print(json.dumps(results, ensure_ascii=False, indent=2))
