#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""真机验收：资源库页站点名自动补齐（F1 接线 / F2 归一 / F4 探测）

前置（一次会话内跑完，别反复开关浏览器）：
    python tools/vr-session.py ensure --reason "站名自动补齐验收"
    python tools/test-site-name-fill-live.py

检查项：
    · 四个模块在库页都加载了，boot 里 siteNames / siteNameFill 两步都执行
    · vrSiteNames 磁盘内容（补上 2026-11-10 诊断报告里的 REVIEW 项）
    · F4 真的向后台发出探测并写回名字（__vrSiteFill.results）
    · nameOf 对带 www 的域名归一命中
    · 左栏 #tree 里不再出现三个裸域名
    · 有头浏览器截图留证
"""
import base64
import json
import os
import sys
import time
import urllib.request

from websocket import create_connection

CDP = "http://127.0.0.1:9480"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOT = os.path.join(ROOT, "deliverables", "assets", "2026-11-10-site-name-fill.png")
TARGETS = ["yidianzixun.com", "www.bizhi66.com", "www.baibian365.com"]

op = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def targets():
    return json.load(op.open(CDP + "/json/list", timeout=8))


class Tab:
    def __init__(self, url):
        self.ws = create_connection(url, suppress_origin=True, timeout=90)
        self.mid = 0

    def send(self, method, params=None):
        self.mid += 1
        self.ws.send(json.dumps({"id": self.mid, "method": method, "params": params or {}}))
        while True:
            raw = self.ws.recv()
            if not raw:
                continue
            r = json.loads(raw)
            if r.get("id") == self.mid:
                if "error" in r:
                    raise RuntimeError(r["error"])
                return r.get("result", {})

    def eval(self, expr):
        r = self.send("Runtime.evaluate", {
            "expression": expr, "returnByValue": True,
            "awaitPromise": True, "userGesture": True
        })
        if r.get("exceptionDetails"):
            raise RuntimeError(r["exceptionDetails"].get("text") or str(r["exceptionDetails"]))
        return r.get("result", {}).get("value")

    def shot(self, path):
        r = self.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
        with open(path, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        return os.path.getsize(path)

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


PROBE_STATE = """
(() => {
  const g = window;
  const st = g.VRSiteNameStore;
  const rg = g.VRSiteRegistry;
  return {
    loaded: {
      siteName: typeof g.VRSiteName, store: typeof g.VRSiteNameStore,
      registry: typeof g.VRSiteRegistry, preset: typeof g.VRSiteNamesPreset,
      fill: typeof g.VRSiteNameFill, app: typeof g.VRApp
    },
    boot: g.__vrBoot || null,
    snapshot: st && st.snapshot ? st.snapshot() : null,
    files: g.VRApp && g.VRApp.getFiles ? g.VRApp.getFiles().length : -1,
    plats: g.VRApp && g.VRApp.getFiles
      ? Array.from(new Set(g.VRApp.getFiles().map(f => f.plat))).slice(0, 40) : [],
    nameOf: rg && rg.nameOf ? {
      'yidianzixun.com': rg.nameOf('yidianzixun.com'),
      'www.bizhi66.com': rg.nameOf('www.bizhi66.com'),
      'www.baibian365.com': rg.nameOf('www.baibian365.com'),
      'www.xiaohongshu.com': rg.nameOf('www.xiaohongshu.com')
    } : null,
    fillState: g.__vrSiteFill || null,
    tree: (document.querySelector('#tree') || {}).innerText || ''
  };
})()
"""

FORCE_RUN = """
(async () => {
  const files = [
    {plat: 'yidianzixun.com'}, {plat: 'www.bizhi66.com'},
    {plat: 'www.baibian365.com'}, {plat: 'xiaohongshu.com'}
  ];
  const r = await window.VRSiteNameFill.run({files: files, force: true, gapMs: 200, delayMs: 0});
  return JSON.parse(JSON.stringify(r));
})()
"""


def main():
    ts = targets()
    pages = [t for t in ts if t.get("type") == "page" and t.get("url", "").endswith("library.html")]
    if not pages:
        ext = [t for t in ts if t.get("url", "").startswith("chrome-extension://")]
        if not ext:
            print("FAIL: 找不到扩展目标")
            return 1
        eid = ext[0]["url"].split("/")[2]
        url = CDP + "/json/new?chrome-extension://%s/library.html" % eid
        req = urllib.request.Request(url, method="PUT")
        op.open(req, timeout=10).read()
        time.sleep(3)
        pages = [t for t in targets() if t.get("url", "").endswith("library.html")]
    if not pages:
        print("FAIL: 打开 library.html 失败")
        return 1

    tab = Tab(pages[-1]["webSocketDebuggerUrl"])
    fails = []
    try:
        before = tab.eval(PROBE_STATE)
        print("\n=== 模块加载 / boot ===")
        print(json.dumps(before["loaded"], ensure_ascii=False))
        print("boot:", before["boot"])
        for k, v in before["loaded"].items():
            if v != "object":
                fails.append("模块未加载: " + k)
        boot = before["boot"] or []
        if "siteNames" not in boot:
            fails.append("F1 未执行：boot 缺 siteNames")
        if "siteNameFill" not in boot:
            fails.append("F4 未排程：boot 缺 siteNameFill")

        print("\n=== vrSiteNames 磁盘实际内容（补诊断 REVIEW 项） ===")
        snap = before["snapshot"] or {}
        print("条数:", len(snap), "示例:", list(snap.items())[:8])
        print("库内文件数:", before["files"])
        print("库内 platform 列表:", before["plats"])

        print("\n=== F4 首轮自动补齐（等最多 60 秒） ===")
        deadline = time.time() + 60
        state = None
        while time.time() < deadline:
            state = tab.eval("window.__vrSiteFill ? JSON.parse(JSON.stringify(window.__vrSiteFill)) : null")
            if state and state.get("done"):
                break
            time.sleep(1)
        print(json.dumps(state, ensure_ascii=False)[:1200])

        # 库里没有这批历史条目、或仍有空名时，才手动喂 platform 验证链路
        names_now = json.loads(tab.eval(
            "JSON.stringify(['yidianzixun.com','www.bizhi66.com','www.baibian365.com']"
            ".map(k => window.VRSiteRegistry.nameOf(k)))"))
        empty_names = [k for k, v in zip(TARGETS, names_now) if not v]
        need_force = bool(empty_names) and not (state and state.get("scanned", 0) > 0)
        if need_force:
            print("\n（本轮没有待补域名但仍有空名，手动喂 3 个域名验证链路）")
            state = tab.eval(FORCE_RUN)
            print(json.dumps(state, ensure_ascii=False)[:1200])
        if state and state.get("learned", 0) > 0:
            print("本轮新学到:", state["learned"], "个")
        elif empty_names:
            fails.append("F4 没学到站名，且这些域名仍为空：%s" % ", ".join(empty_names))

        after = tab.eval(PROBE_STATE)
        print("\n=== 补齐后 ===")
        print("snapshot 条数:", len(after["snapshot"] or {}))
        print("nameOf:", json.dumps(after["nameOf"], ensure_ascii=False))
        names = after["nameOf"] or {}
        for k in ("yidianzixun.com", "www.bizhi66.com", "www.baibian365.com"):
            if not names.get(k):
                fails.append("%s 仍查不到站名" % k)
        if names.get("www.xiaohongshu.com") != "小红书":
            fails.append("F2 归一失效：www.xiaohongshu.com 未命中预置表")

        # 「其他站点」默认折叠，必须展开才能核对长尾站点（也才能拍到证据图）
        opened = tab.eval("""
        (() => {
          const b = document.querySelector('[data-group="others"]');
          if (!b) return false;
          b.click();
          return true;
        })()
        """)
        after = tab.eval(PROBE_STATE)
        tree = after["tree"] or ""
        print("\n展开「其他站点」:", opened)
        print("左栏 #tree 片段:", repr(tree[:500]))
        for k in TARGETS:
            if k in tree:
                fails.append("左栏仍显示裸域名: " + k)
        for label in [names.get("yidianzixun.com"), names.get("www.bizhi66.com"),
                      names.get("www.baibian365.com")]:
            if label and opened and label not in tree:
                fails.append("左栏没显示学到的名字: " + label)

        size = tab.shot(SHOT)
        print("\n截图:", SHOT, size, "bytes")
        if size < 10000:
            fails.append("截图异常小")
    finally:
        tab.close()

    print("\n=== 断言 ===")
    if fails:
        print("FAILED %d 项:" % len(fails))
        for f in fails:
            print("  ·", f)
        return 1
    print("ALL_PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
