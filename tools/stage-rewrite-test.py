# -*- coding: utf-8 -*-
"""舞台重写回归（R8）：真实数据 + 原型交互断言
前置：Edge 已带扩展启动并开调试端口
用法：python tools/stage-rewrite-test.py --port 9477
"""
import argparse, json, time, base64, urllib.request
from websocket import create_connection

PLAT_ROWS = [
    ("video-rod/B站/影视飓风(@946974)/视频/旅行日记.mp4", "D:/fake/a.mp4", "bilibili", "影视飓风(@946974)", "946974", "video", "旅行日记.mp4", 12, 168, 1, "ok"),
    ("video-rod/小红书/小鱼(@u1)/图片/咖啡.jpg", "D:/fake/b.jpg", "xiaohongshu", "小鱼(@u1)", "u1", "image", "咖啡.jpg", 1.1, 0, 0, "ok"),
    ("video-rod/其他网页/example.com/视频/长视频.mp4", "D:/fake/c.mp4", "web", "example.com", "", "video", "长视频.mp4", 220, 3725, 0, "ok"),
    ("video-rod/B站/音乐UP/音频/晚安.mp3", "D:/fake/d.mp3", "bilibili", "音乐UP", "2", "audio", "晚安.mp3", 8, 0, 0, "ok"),
    ("video-rod/X/Ken/图片/街拍.jpg", "D:/fake/e.jpg", "x", "Ken", "ken", "image", "街拍.jpg", 0.8, 0, 1, "ok"),
    ("video-rod/instagram/yuki/videos/reel.mp4", "D:/fake/g.mp4", "instagram", "yuki", "", "video", "reel.mp4", 5, 30, 0, "ok"),
    ("video-rod/抖音/奇趣蛋蛋(@qqdd)/视频/丢失.mp4", "D:/fake/f.mp4", "douyin", "奇趣蛋蛋(@qqdd)", "qqdd", "video", "丢失.mp4", 500, 60, 0, "missing"),
    ("video-rod/微博/唐十七(@m0ve0f)/图片/折多山.webp", "D:/fake/h.webp", "weibo", "唐十七(@m0ve0f)", "m0ve0f", "image", "折多山.webp", 2, 0, 0, "ok"),
]


def seed_js():
    rows = []
    now = int(time.time() * 1000)
    for i, (rel, abs_, plat, cf, cid, typ, fn, mb, dur, star, state) in enumerate(PLAT_ROWS):
        rows.append(
            "{relPath:%s,absPath:%s,platform:%s,creatorFull:%s,creatorId:%s,type:%s,fileName:%s,size:%d,mtime:%d,duration:%d,starred:%d,tags:[],state:%s}"
            % (json.dumps(rel), json.dumps(abs_), json.dumps(plat), json.dumps(cf), json.dumps(cid),
               json.dumps(typ), json.dumps(fn), int(mb * 1024 * 1024), now - i * 86400000, int(dur), star,
               json.dumps(state))
        )
    return """(async function(){const rows=[%s];
      await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f=>f.relPath));
      await VRDB.putFiles(rows); return rows.length;})()""" % ",".join(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9477)
    ap.add_argument("--shot", default="deliverables/assets/rewrite-regression.png")
    ap.add_argument("--ext", default="ceogmckiinjolbbdkjfelmfcfepccabp",
                    help="扩展 ID（同一路径加载的 unpacked 扩展 ID 固定）")
    a = ap.parse_args()

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    ver = json.load(opener.open("http://127.0.0.1:%d/json/version" % a.port, timeout=5))
    ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
    mid = 0
    events = []

    def send(m, p=None, sid=None):
        nonlocal mid
        mid += 1
        i = mid
        msg = {"id": i, "method": m, "params": p or {}}
        if sid:
            msg["sessionId"] = sid
        ws.send(json.dumps(msg))
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == i:
                return r.get("result", {})
            events.append(r)

    def ev(js, sid):
        r = send("Runtime.evaluate", {"expression": js, "returnByValue": True, "awaitPromise": True}, sid)
        if "exceptionDetails" in r:
            return {"__err": r["exceptionDetails"].get("text")}
        return r.get("result", {}).get("value")

    # 扩展 id：直接用固定 ID（同一路径 unpacked 扩展 ID 不变）。
    # 旧实现在 /json/list 里找 first match，会被 Edge 自带组件抢到；后来加的
    # AppData 递归 glob 兜底会让脚本卡死——已移除。
    ext = a.ext

    tid = send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % ext})["targetId"]
    sid = send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
    send("Runtime.enable", {}, sid)
    send("Page.enable", {}, sid)
    send("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False}, sid)
    time.sleep(2.5)

    print("seed:", ev(seed_js(), sid))
    send("Page.reload", {}, sid)
    send("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False}, sid)
    time.sleep(3)

    results = []

    def check(name, got, expect):
        ok = got == expect
        results.append(ok)
        print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "  got=%r expect=%r" % (got, expect)))

    check("卡片数=8", ev("document.querySelectorAll('#grid .card').length", sid), 8)
    # 原型 media-library-stage-v1.html 实测侧栏 268px（纠偏时由 264 对齐）
    check("侧栏 268px", ev("Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)", sid), 268)
    check("树根编号 00", ev("document.querySelector('#tree .ix') && document.querySelector('#tree .ix').textContent", sid), "00")
    check("平台 chips=10（含 B站）", ev("document.querySelectorAll('#chips .chip').length", sid), 10)
    check("页签计数", ev("[...document.querySelectorAll('#typeTabs button')].map(b=>b.dataset.type+':'+b.querySelector('b').textContent).join(',')", sid),
          "all:8,image:3,anim:0,video:4,audio:1")
    check("缺失角标", ev("document.querySelectorAll('#grid .card .missing-tag').length", sid), 1)
    check("页面底色", ev("getComputedStyle(document.body).backgroundColor", sid), "rgb(16, 15, 14)")

    # 搜索：交集 + 排除
    ev("(()=>{const i=document.getElementById('search');i.value='b站';i.dispatchEvent(new Event('input'));return 1})()", sid)
    time.sleep(0.5)
    check("搜索交集 b站=2", ev("document.querySelectorAll('#grid .card').length", sid), 2)
    ev("(()=>{const i=document.getElementById('search');i.value='b站 -音乐';i.dispatchEvent(new Event('input'));return 1})()", sid)
    time.sleep(0.5)
    check("搜索排除 b站 -音乐=1", ev("document.querySelectorAll('#grid .card').length", sid), 1)
    ev("(()=>{const i=document.getElementById('search');i.value='';i.dispatchEvent(new Event('input'));return 1})()", sid)
    time.sleep(0.4)

    # 类型页签
    ev("document.querySelector('#typeTabs button[data-type=video]').click();1", sid)
    time.sleep(0.4)
    check("视频页签=4", ev("document.querySelectorAll('#grid .card').length", sid), 4)
    ev("document.querySelector('#typeTabs button[data-type=all]').click();1", sid)
    time.sleep(0.4)

    # 列表视图
    ev("document.querySelector('#viewToggle button[data-view=list]').click();1", sid)
    time.sleep(0.4)
    check("列表模式", ev("document.querySelector('#grid').classList.contains('list')", sid), True)
    check("表头显示", ev("document.querySelector('#listhead').classList.contains('on')", sid), True)
    ev("document.querySelector('#viewToggle button[data-view=grid]').click();1", sid)
    time.sleep(0.3)

    # 收藏夹：新建 + 计数
    ev("document.getElementById('favNewBtn').click();1", sid)
    time.sleep(0.2)
    ev("(()=>{const i=document.getElementById('favNewInput');i.value='测试夹';document.getElementById('favNewOk').click();return 1})()", sid)
    time.sleep(0.5)
    check("收藏夹已建", ev("[...document.querySelectorAll('#favList .fav-row .label')].map(e=>e.textContent).includes('测试夹')", sid), True)

    # 预览
    ev("document.querySelector('#grid .card').click();1", sid)
    time.sleep(1.2)
    check("预览打开", ev("!document.getElementById('preview').classList.contains('hidden')", sid), True)
    check("预览标题", ev("document.getElementById('pvTitle').textContent", sid), "旅行日记")
    check("胶片条=8", ev("document.querySelectorAll('#pvFilm .film').length", sid), 8)
    ev("document.getElementById('pvClose').click();1", sid)
    time.sleep(0.4)

    # 设置抽屉
    ev("document.getElementById('settingsBtn').click();1", sid)
    time.sleep(0.6)
    check("抽屉打开", ev("document.getElementById('setdrawer').classList.contains('show')", sid), True)
    check("抽屉目录值有内容", ev("(document.getElementById('sdDirVal').textContent||'').length>0", sid), True)
    ev("document.getElementById('setClose').click();1", sid)
    time.sleep(0.3)

    errs = [e for e in events if e.get("method") == "Runtime.exceptionThrown"]
    check("0 JS 异常", len(errs), 0)
    for e in errs[:3]:
        d = e["params"]["exceptionDetails"]
        print("   ", ((d.get("exception", {}) or {}).get("description", "") or d.get("text", ""))[:160])

    r = send("Page.captureScreenshot", {"format": "png"}, sid)
    open(a.shot, "wb").write(base64.b64decode(r["data"]))
    print("shot:", a.shot)
    send("Target.closeTarget", {"targetId": tid})
    ws.close()

    ok = sum(1 for x in results if x)
    print("\n%d/%d PASS" % (ok, len(results)))
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
