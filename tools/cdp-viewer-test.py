# 资源库查看器 v2 验收（S4）
#
# 前置：
#   1) python -m http.server 18080（test-site）
#   2) Chrome for Testing --remote-debugging-port=<port> --load-extension=E:\test\video-rod
# 用法：VR_CDP=http://127.0.0.1:9346 python tools/cdp-viewer-test.py
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name +
          ("" if ok else f"   got={got!r} expect={expect!r}"))


def ev(cdp, sid, js):
    r = cdp.eval(js, sid)
    if isinstance(r, dict) and "__error" in r:
        raise RuntimeError(r["__error"])
    return r


SEED = r"""
(async function () {
  const now = Date.now();
  const rows = [
    {relPath:'video-rod/B站/影视飓风(@946974)/视频/旅行日记.mp4',
     absPath:'E:/test/video-rod/test-site/media/test.mp4',platform:'bilibili',platformName:'B站',
     creatorFull:'影视飓风(@946974)',creatorId:'946974',type:'video',fileName:'旅行日记.mp4',
     size:12*1024*1024,mtime:now-3600e3,duration:168,starred:1,tags:[],state:'ok'},
    {relPath:'video-rod/小红书/小鱼/图片/咖啡.jpg',
     absPath:'E:/test/video-rod/img/cat-down.png',platform:'xiaohongshu',platformName:'小红书',
     creatorFull:'小鱼',creatorId:'u1',type:'image',fileName:'咖啡.jpg',
     size:1200*1024,mtime:now-7200e3,starred:0,tags:[],state:'ok'},
    {relPath:'video-rod/其他网页/本地/图片/资源库预览.png',
     absPath:'E:/test/video-rod/deliverables/assets/library-v13-grid.png',platform:'web',platformName:'其他网页',
     creatorFull:'本地素材',creatorId:'local',type:'image',fileName:'资源库预览.png',
     size:186000,mtime:now-3*3600e3,starred:0,tags:[],state:'ok'},
    {relPath:'video-rod/其他网页/example.com/视频/长视频.mp4',
     absPath:'E:/test/video-rod/test-site/media/test2.mp4',platform:'web',platformName:'其他网页',
     creatorFull:'example.com',creatorId:'',type:'video',fileName:'长视频.mp4',
     size:220*1024*1024,mtime:now-4*3600e3,duration:3725,starred:0,tags:[],state:'ok'}
  ];
  await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
  await VRDB.putFiles(rows);
  localStorage.setItem('vrLibView', 'grid');
  localStorage.removeItem('vrLibOverview');
  return rows.length;
})()
"""

KEY = """(function(k, opts){
  const ev = new KeyboardEvent('keydown', Object.assign({key:k, bubbles:true}, opts||{}));
  document.dispatchEvent(ev);
  return true;
})(%s, %s)"""


def key(cdp, sid, k, opts="{}"):
    return ev(cdp, sid, KEY % (json.dumps(k), opts))


def main():
    cdp = Cdp()
    ext_id, _ = find_ext_id(cdp)
    check("A1 扩展已加载", bool(ext_id), True)
    if not ext_id:
        return finish(cdp)

    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    sid = cdp.attach(tid)
    for m in ("Runtime.enable", "Page.enable", "Network.enable"):
        cdp.send(m, {}, sid)
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True}, sid)
    cdp.send("Page.navigate", {"url": f"chrome-extension://{ext_id}/library.html"}, sid)
    time.sleep(2.0)

    mods = ev(cdp, sid, "({v: typeof VRViewer, o: typeof VRVideo, k: typeof VRKeys})")
    check("A2 查看器模块已加载", mods, {"v": "object", "o": "object", "k": "object"})
    if not mods or mods.get("v") != "object":
        return finish(cdp)

    check("A3 种子 4 条", ev(cdp, sid, SEED), 4)
    cdp.send("Page.reload", {"ignoreCache": True}, sid)
    time.sleep(2.0)

    # 1) 点第一张卡（视频）打开
    first = ev(cdp, sid, r"""(function(){
      const card = document.querySelector('#libGrid .lib-card');
      card.click();
      return card.getAttribute('data-rel');
    })()""")
    time.sleep(1.2)
    open_state = ev(cdp, sid, r"""(function(){
      const v = document.querySelector('#libViewerStage video');
      return {
        open: !document.getElementById('libViewer').hidden,
        title: document.getElementById('libViewerTitle').textContent,
        count: document.getElementById('libViewerCount').textContent,
        video: !!v,
        nativeControls: v ? v.controls : null,
        videoCtl: !document.getElementById('libVideoCtl').hidden,
        imageCtl: document.getElementById('libImageCtl').hidden,
        strip: document.querySelectorAll('.strip-item').length,
        bodyClass: document.body.classList.contains('viewer-open')
      };
    })()""")
    check("B1 点卡片打开查看器", [open_state["open"], open_state["bodyClass"], open_state["title"]],
          [True, True, "旅行日记.mp4"])
    check("B2 序号与队列", [open_state["count"], open_state["strip"]], ["1 / 4", 4])
    check("B3 视频用自绘控件", [open_state["video"], open_state["nativeControls"], open_state["videoCtl"], open_state["imageCtl"]],
          [True, False, True, True])

    # 2) 信息面板
    facts = ev(cdp, sid, r"""(function(){
      const pick = k => {
        const dd = document.querySelector('#libViewerFacts [data-k="' + k + '"] dd');
        return dd ? dd.textContent : '';
      };
      return {
        rows: document.querySelectorAll('#libViewerFacts .fact').length,
        platform: pick('platform'), creator: pick('creator'),
        path: pick('path'), size: pick('size'), state: pick('state'),
        videoW: (document.querySelector('#libViewerStage video') || {}).videoWidth || 0
      };
    })()""")
    check("B4 信息面板字段", [facts["rows"] >= 10, facts["platform"], facts["creator"], facts["state"]],
          [True, "B站", "影视飓风(@946974)", "正常"])
    check("B5 相对路径与大小", [facts["path"], facts["size"]],
          ["video-rod/B站/影视飓风(@946974)/视频/旅行日记.mp4", "12 MB"])

    info = ev(cdp, sid, r"""(function(){
      const btn = document.getElementById('libViewerInfoBtn');
      const panel = document.getElementById('libViewerInfo');
      const a = getComputedStyle(panel).display;
      btn.click();
      const b = getComputedStyle(panel).display;
      btn.click();
      const c = getComputedStyle(panel).display;
      return {a: a, b: b, c: c};
    })()""")
    check("B6 信息面板可收起/展开", [info["a"], info["b"], info["c"]], ["block", "none", "block"])

    # 3) 视频：静音 + 空格播放 + 方向键
    pre = ev(cdp, sid, r"""(function(){
      const v = document.querySelector('#libViewerStage video');
      v.pause();
      v.currentTime = 0;
      document.getElementById('libVideoMute').click();
      document.getElementById('libVideoAuto').checked = false;  // seek 到末尾时不要触发连播
      return {muted: v.muted, paused: v.paused, dur: Math.round(v.duration * 100) / 100};
    })()""")
    check("C1 媒体就绪且可静音", [pre["muted"], pre["paused"], pre["dur"] > 0], [True, True, True])

    key(cdp, sid, " ", "{code:'Space'}")
    time.sleep(0.5)
    playing = ev(cdp, sid, "document.querySelector('#libViewerStage video').paused")
    check("C2 空格播放", playing, False)

    ev(cdp, sid, "VRVideo.seekTo(0)")
    key(cdp, sid, "ArrowRight")
    time.sleep(0.35)
    seek5 = ev(cdp, sid, "Math.round(document.querySelector('#libViewerStage video').currentTime * 100) / 100")
    check("C3 → 快进 5s（短片夹到末尾）", seek5 >= pre["dur"] - 0.2, True)

    key(cdp, sid, "ArrowLeft", "{shiftKey:true}")
    time.sleep(0.3)
    seek30 = ev(cdp, sid, "Math.round(document.querySelector('#libViewerStage video').currentTime * 100) / 100")
    check("C4 Shift+← 回退 30s", seek30 <= 0.1, True)

    calc = ev(cdp, sid, "[VRVideo._calc(10,100,5), VRVideo._calc(10,100,30), VRVideo._calc(98,100,5), VRVideo._calc(2,100,-30)]")
    check("C5 seek 步进与边界", [round(x, 2) for x in calc], [15, 40, 99.95, 0])

    # 4) ↓ 切到图片
    key(cdp, sid, "ArrowDown")
    time.sleep(0.6)
    img_state = ev(cdp, sid, r"""(function(){
      const img = document.querySelector('#libViewerStage img');
      return {
        title: document.getElementById('libViewerTitle').textContent,
        img: !!img,
        videoCtl: document.getElementById('libVideoCtl').hidden,
        imageCtl: document.getElementById('libImageCtl').hidden,
        factsDim: (document.querySelector('#libViewerFacts [data-k="dim"] dd') || {}).textContent || ''
      };
    })()""")
    check("D1 ↓ 切到上一条（图片）", [img_state["title"], img_state["img"]], ["咖啡.jpg", True])
    check("D2 控件随类型切换", [img_state["videoCtl"], img_state["imageCtl"]], [True, False])
    check("D3 图片尺寸已写入信息", "×" in img_state["factsDim"], True)

    # 5) 图片缩放
    zoom = ev(cdp, sid, r"""(function(){
      document.getElementById('libViewerZoomIn').click();
      document.getElementById('libViewerZoomIn').click();
      const a = VRViewer._zoom();
      document.getElementById('libViewerZoomReset').click();
      const b = VRViewer._zoom();
      const t = document.querySelector('#libViewerStage img').style.transform || '';
      return {a: a, b: b, t: t};
    })()""")
    check("E1 缩放 1→1.56→1", [round(zoom["a"], 2), zoom["b"]], [1.56, 1])
    check("E2 复位后无位移", "translate(0px, 0px)" in zoom["t"], True)

    # 6) 图片 ←/→ 切队列
    key(cdp, sid, "ArrowRight")
    time.sleep(0.4)
    t3 = ev(cdp, sid, "document.getElementById('libViewerTitle').textContent")
    check("E3 图片 → 下一条", t3, "资源库预览.png")
    key(cdp, sid, "ArrowLeft")
    time.sleep(0.4)
    t2 = ev(cdp, sid, "document.getElementById('libViewerTitle').textContent")
    check("E4 图片 ← 上一条", t2, "咖啡.jpg")

    # 7) 缩略图带跳转
    strip = ev(cdp, sid, r"""(function(){
      const items = [...document.querySelectorAll('.strip-item')];
      items[3].click();
      const on = document.querySelector('.strip-item.on');
      return {n: items.length, title: document.getElementById('libViewerTitle').textContent,
              active: on ? on.getAttribute('data-rel') : ''};
    })()""")
    check("F1 缩略图带 4 条", strip["n"], 4)
    check("F2 点缩略图跳转", [strip["title"], strip["active"]],
          ["长视频.mp4", "video-rod/其他网页/example.com/视频/长视频.mp4"])

    # 8) 连播：视频 ended → 下一条
    auto = ev(cdp, sid, r"""(function(){
      VRViewer.open('video-rod/B站/影视飓风(@946974)/视频/旅行日记.mp4');
      const v = document.querySelector('#libViewerStage video');
      v.dispatchEvent(new Event('ended'));
      return {title: document.getElementById('libViewerTitle').textContent,
              auto: document.getElementById('libVideoAuto').checked};
    })()""")
    check("G1 连播开关默认开", auto["auto"], True)
    check("G2 播完自动下一条", auto["title"], "咖啡.jpg")

    # 9) Esc 关闭
    key(cdp, sid, "Escape")
    time.sleep(0.3)
    closed = ev(cdp, sid, r"""(function(){
      return {hidden: document.getElementById('libViewer').hidden,
              body: document.body.classList.contains('viewer-open'),
              stage: document.getElementById('libViewerStage').children.length,
              videoCtl: document.getElementById('libVideoCtl').hidden};
    })()""")
    check("H1 Esc 关闭并清空舞台", [closed["hidden"], closed["body"], closed["stage"], closed["videoCtl"]],
          [True, False, 0, True])

    # 清理
    ev(cdp, sid, r"""(async function(){
      await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
      return 1;
    })()""")

    return finish(cdp)


def finish(cdp):
    errs = cdp.errors()
    check("L1 控制台无 error/exception", errs, [])
    total = len(results)
    passed = sum(1 for r in results if r[0])
    print(f"\n===== {passed}/{total} 通过 =====")
    if errs:
        print("控制台：", errs[:5])
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print("\n脚本异常：", e)
        sys.exit(2)
