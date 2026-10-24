# video-rod 资源库页面验收（S3 核心）
#
# 前置：
#   1) python -m http.server 18080（test-site）
#   2) Chrome for Testing --remote-debugging-port=<port> --load-extension=E:\test\video-rod
# 用法：VR_CDP=http://127.0.0.1:9346 python tools/cdp-library-page-test.py
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
    {relPath:'video-rod/B站/影视飓风(@946974)/视频/旅行日记.mp4',absPath:'D:/fake/a.mp4',
     platform:'bilibili',platformName:'B站',creatorFull:'影视飓风(@946974)',creatorId:'946974',
     type:'video',fileName:'旅行日记.mp4',size:12*1024*1024,mtime:now-1000,duration:168,
     starred:1,tags:[],state:'ok'},
    {relPath:'video-rod/小红书/小鱼/图片/咖啡.jpg',absPath:'D:/fake/b.jpg',
     platform:'xiaohongshu',platformName:'小红书',creatorFull:'小鱼',creatorId:'u1',
     type:'image',fileName:'咖啡.jpg',size:1200*1024,mtime:now-2000,starred:0,tags:[],state:'ok'},
    {relPath:'video-rod/其他网页/example.com/视频/长视频.mp4',absPath:'D:/fake/c.mp4',
     platform:'web',platformName:'其他网页',creatorFull:'example.com',creatorId:'',
     type:'video',fileName:'长视频.mp4',size:220*1024*1024,mtime:now-3000,duration:3725,
     starred:0,tags:[],state:'ok'},
    {relPath:'video-rod/B站/音乐UP/音频/晚安.mp3',absPath:'D:/fake/d.mp3',
     platform:'bilibili',platformName:'B站',creatorFull:'音乐UP',creatorId:'2',
     type:'audio',fileName:'晚安.mp3',size:8*1024*1024,mtime:now-4000,starred:0,tags:[],state:'ok'},
    {relPath:'video-rod/X/Ken/图片/街拍.jpg',absPath:'D:/fake/e.jpg',
     platform:'x',platformName:'X',creatorFull:'Ken',creatorId:'ken',
     type:'image',fileName:'街拍.jpg',size:890*1024,mtime:now-5*86400000,starred:1,tags:[],state:'ok'},
    {relPath:'video-rod/B站/影视飓风(@946974)/视频/丢失.mp4',absPath:'D:/fake/f.mp4',
     platform:'bilibili',platformName:'B站',creatorFull:'影视飓风(@946974)',creatorId:'946974',
     type:'video',fileName:'丢失.mp4',size:500*1024*1024,mtime:now-6*86400000,duration:60,
     starred:0,tags:[],state:'missing'}
  ];
  await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
  await VRDB.putFiles(rows);
  localStorage.setItem('vrLibView', 'grid');
  return rows.length;
})()
"""


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

    mods = ev(cdp, sid, "({l: typeof VRLibrary, d: typeof VRDB, t: typeof VRThumbs, p: typeof VRPath})")
    check("A2 页面模块已加载", mods, {"l": "object", "d": "object", "t": "object", "p": "object"})
    if not mods or mods.get("l") != "object":
        return finish(cdp)

    check("A3 种子数据 6 条", ev(cdp, sid, SEED), 6)
    cdp.send("Page.reload", {"ignoreCache": True}, sid)
    time.sleep(2.0)

    base = ev(cdp, sid, r"""(function(){
      return {
        cards: document.querySelectorAll('#libGrid .lib-card').length,
        empty: document.getElementById('libEmpty').hidden,
        sub: document.getElementById('libSub').textContent,
        types: [...document.querySelectorAll('#libTypeNav .side-item')].map(b => b.textContent.trim())
      };
    })()""")
    check("B1 网格渲染 6 张卡片", base["cards"], 6)
    check("B2 空态隐藏", base["empty"], True)
    check("B3 总数与总大小", base["sub"], "共 6 项 · 742 MB")
    check("B4 类型计数", base["types"], ["全部资源6", "视频3", "图片2", "音频1", "星标2"])

    v2 = ev(cdp, sid, r"""(async function(){
      const q = s => document.querySelector(s);
      const qa = s => [...document.querySelectorAll(s)];
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      out.kpi = [q('#libKpiTotal').textContent, q('#libKpiSize').textContent,
                 q('#libKpiSizeUnit').textContent, q('#libKpiImage').textContent,
                 q('#libKpiVideo').textContent];
      out.stack = qa('#libPlatStack i').length;
      out.legend = qa('.legend-item').length;
      out.creators = qa('.ccard').length;
      out.bars = qa('.bar-row').length;
      out.th = qa('.lib-table thead th').length;
      out.thText = qa('.lib-table thead th').map(x => x.textContent.trim()).join('|');
      out.ovCollapsed = q('#libOverview').classList.contains('collapsed');
      out.ovBody = getComputedStyle(q('#libOverviewBody')).display;
      q('#libOverviewToggle').click();
      await wait(80);
      out.ovOpenBody = getComputedStyle(q('#libOverviewBody')).display;
      out.ovBtn = q('#libOverviewToggle').textContent;
      q('#libOverviewToggle').click();
      await wait(80);
      out.ovClosedAgain = q('#libOverview').classList.contains('collapsed');
      q('#libGroup').value = 'date';
      q('#libGroup').dispatchEvent(new Event('change', {bubbles: true}));
      await wait(150);
      out.days = qa('#libGrid .lib-day').length;
      out.dayLabel = (q('#libGrid .lib-day b') || {}).textContent || '';
      q('#libGroup').value = 'none';
      q('#libGroup').dispatchEvent(new Event('change', {bubbles: true}));
      await wait(150);
      out.daysAfter = qa('#libGrid .lib-day').length;
      return out;
    })()""")
    check("B5 概览 KPI", v2["kpi"], ["6", "742", "MB", "2", "3"])
    check("B6 平台分布 4 段 + 4 条图例", [v2["stack"], v2["legend"]], [4, 4])
    check("B7 博主速览 5 张卡", v2["creators"], 5)
    check("B8 博主产量 Top5 条形", v2["bars"], 5)
    check("B9 表格 8 列", v2["th"], 8)
    check("B10 表头含名称/平台/博主/大小", all(k in v2["thText"] for k in ("名称", "平台", "博主", "大小")), True)
    check("B11 按日期分组", [v2["days"] > 1, v2["dayLabel"], v2["daysAfter"]], [True, "今天", 0])
    check("B12 概览默认收起且可展开",
          [v2["ovCollapsed"], v2["ovBody"], v2["ovOpenBody"], v2["ovBtn"], v2["ovClosedAgain"]],
          [True, "none", "block", "收起", True])

    flow = ev(cdp, sid, r"""(async function(){
      const q = s => document.querySelector(s);
      const qa = s => [...document.querySelectorAll(s)];
      const cards = () => qa('#libGrid .lib-card').length;
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = {};

      q('#libTypeNav [data-type="video"]').click(); await wait(120);
      out.video = {cards: cards(), title: q('#libTitle').textContent};

      q('#libPlatformNav [data-platform="bilibili"]').click(); await wait(120);
      out.videoBili = {cards: cards(), chips: qa('.active-chip').map(x => x.textContent.trim())};

      q('#libPlatformNav [data-platform="bilibili"]').click(); await wait(120);
      q('#libTypeNav [data-starred="1"]').click(); await wait(120);
      out.starred = {cards: cards(), title: q('#libTitle').textContent};

      q('#libTypeNav [data-type="all"]').click(); await wait(120);
      const s = q('#libSearch');
      s.value = '咖啡'; s.dispatchEvent(new Event('input', {bubbles: true})); await wait(300);
      out.search = {cards: cards(), sub: q('#libSub').textContent};

      s.value = ''; s.dispatchEvent(new Event('input', {bubbles: true})); await wait(300);
      q('#libSort').value = 'size'; q('#libSort').dispatchEvent(new Event('change', {bubbles: true}));
      await wait(120);
      out.sort = q('#libGrid .lib-card h3').textContent;

      q('#libViewList').click(); await wait(120);
      out.list = {rows: qa('#libList .lib-row').length, gridHidden: q('#libGrid').hidden};

      q('#libList .lib-row').click(); await wait(150);
      out.viewer = {hidden: q('#libViewer').hidden, title: q('#libViewerTitle').textContent};
      q('#libViewerNext').click(); await wait(120);
      out.viewerNext = q('#libViewerTitle').textContent;
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
      await wait(120);
      out.viewerClosed = q('#libViewer').hidden;

      s.value = 'zzzz'; s.dispatchEvent(new Event('input', {bubbles: true})); await wait(300);
      out.empty = {
        hidden: q('#libEmpty').hidden,
        title: q('#libEmptyTitle').textContent,
        action: q('#libEmptyAction').textContent
      };
      q('#libEmptyAction').click(); await wait(150);
      out.afterClear = {rows: qa('#libList .lib-row').length, q: q('#libSearch').value};
      return out;
    })()""")

    check("C1 视频筛选 3 条", [flow["video"]["cards"], flow["video"]["title"]], [3, "视频"])
    check("D1 叠加平台筛选 2 条", flow["videoBili"]["cards"], 2)
    check("D2 平台筛选 chip", flow["videoBili"]["chips"], ["B站 ×"])
    check("E1 星标筛选 2 条", [flow["starred"]["cards"], flow["starred"]["title"]], [2, "星标资源"])
    check("F1 搜索“咖啡”命中 1 条", [flow["search"]["cards"], flow["search"]["sub"]], [1, "共 1 项 · 1.2 MB"])
    check("G1 按大小排序首条最大", flow["sort"], "丢失.mp4")
    check("H1 列表视图 6 行", [flow["list"]["rows"], flow["list"]["gridHidden"]], [6, True])
    check("H2 点行打开全屏查看器", [flow["viewer"]["hidden"], flow["viewer"]["title"]], [False, "丢失.mp4"])
    check("H3 查看器可翻页", flow["viewerNext"], "长视频.mp4")
    check("H4 Esc 关闭查看器", flow["viewerClosed"], True)
    check("I1 无结果显示空态", [flow["empty"]["hidden"], flow["empty"]["title"], flow["empty"]["action"]],
          [False, "没有匹配的资源", "清空筛选"])
    check("I2 清空筛选恢复 6 行", [flow["afterClear"]["rows"], flow["afterClear"]["q"]], [6, ""])

    cdp.send("Emulation.setDeviceMetricsOverride",
             {"width": 900, "height": 900, "deviceScaleFactor": 1, "mobile": False}, sid)
    time.sleep(0.5)
    layout = ev(cdp, sid, r"""(function(){
      const s = document.querySelector('.lib-side');
      return {sw: document.documentElement.scrollWidth, iw: innerWidth,
              side: getComputedStyle(s).position};
    })()""")
    check("K1 900px 无横向溢出", [layout["sw"], layout["iw"]], [900, 900])

    cdp.send("Emulation.setDeviceMetricsOverride",
             {"width": 860, "height": 900, "deviceScaleFactor": 1, "mobile": False}, sid)
    time.sleep(0.5)
    mobile = ev(cdp, sid, r"""(function(){
      const s = document.querySelector('.lib-side');
      const sc = document.querySelector('.side-scroll');
      return {sw: document.documentElement.scrollWidth, iw: innerWidth,
              side: getComputedStyle(s).position, scrollX: getComputedStyle(sc).overflowX,
              chips: document.querySelectorAll('.lib-side .side-item').length};
    })()""")
    check("K2 860px 侧栏折叠为横条", [mobile["side"], mobile["scrollX"], mobile["sw"], mobile["iw"], mobile["chips"] > 0],
          ["static", "auto", 860, 860, True])

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
