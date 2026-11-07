#!/usr/bin/env python3
"""真机验证：确认扩展内的站点名链路真的可用。

用法：
    1) 先启动带扩展的 Edge（调试端口 9480）：
         msedge.exe --user-data-dir=<tmp> \
                    --disable-extensions-except=<repo> --load-extension=<repo> \
                    --remote-debugging-port=9480
    2) python tools/live-site-name-check.py

检查项（全部只读扩展上下文，不发网络请求）：
    · 四个新模块（site-name / store / preset / registry）是否真的加载
    · 预置表条数是否正常
    · detect() 对已知站点是否给出站名、对未知站点是否回退域名
    · 目录拼装：图片与视频同目录、多P 分层、站名成一级

注意：扩展更新后页面可能仍缓存旧脚本，脚本加载不全时先硬刷新。
（2026-11-07 实测踩过：缓存导致 18 个 script 只执行了 14 个。）
"""
import json
import sys
import urllib.request

from websocket import create_connection

CDP = "http://127.0.0.1:9480"

def targets():
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return json.load(op.open(CDP + "/json/list"))

class Tab:
    def __init__(self, url):
        self.ws = create_connection(url, suppress_origin=True, timeout=60)
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
        r = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        if r.get("exceptionDetails"):
            raise RuntimeError(r["exceptionDetails"].get("text") or str(r["exceptionDetails"]))
        return r.get("result", {}).get("value")
    def close(self):
        try: self.ws.close()
        except Exception: pass

PROBE = """
(() => {
  const out = { loaded: {}, preset: null, cases: [], err: null };
  try {
    out.loaded.registry = typeof window.VRSiteRegistry;
    out.loaded.preset   = typeof window.VRSiteNamesPreset;
    out.loaded.store    = typeof window.VRSiteNameStore;
    out.loaded.siteName = typeof window.VRSiteName;
    out.loaded.path     = typeof window.VRPath;
    out.preset = window.VRSiteNamesPreset ? window.VRSiteNamesPreset.size() : null;
    const probe = [
      'https://huaban.com/pins/1',
      'https://www.bilibili.com/video/BV1',
      'https://x.com/NASA/status/1',
      'https://pixso.cn/app/1',
      'https://v.qq.com/x/cover/a.html',
      'https://never-seen-before.xyz/a'
    ];
    if (window.VRSiteRegistry) {
      probe.forEach(u => {
        const d = window.VRSiteRegistry.detect(u);
        out.cases.push({ url: u, key: d.key, name: d.name, dir: d.dir, src: d.src });
      });
    }
    if (window.VRPath) {
      out.biliImg  = window.VRPath.buildRelDir({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'jpg' });
      out.biliVid  = window.VRPath.buildRelDir({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'mp4' });
      out.biliPart = window.VRPath.buildRelDir({ pageUrl: 'https://www.bilibili.com/video/BV1', authorFull: '影视飓风(@946974)', ext: 'mp4', part: '第1话 开场' });
      out.huaban   = window.VRPath.buildRelDir({ pageUrl: 'https://huaban.com/pins/1', authorFull: '某设计师', ext: 'jpg' });
      out.unknown  = window.VRPath.buildRelDir({ pageUrl: 'https://never-seen-before.xyz/a', ext: 'jpg' });
    }
  } catch (e) { out.err = String(e && e.message || e); }
  return out;
})()
"""

def main():
    ts = targets()
    ext = [t for t in ts if t["url"].startswith("chrome-extension://")]
    page = [t for t in ext if t["url"].endswith("library.html")]
    print("扩展目标数:", len(ext))
    for t in ext:
        print("  -", t["url"][:100])
    if not page:
        print("FAIL: 没找到 library.html 目标")
        return 1

    tab = Tab(page[0]["webSocketDebuggerUrl"])
    try:
        r = tab.eval(PROBE)
    finally:
        tab.close()

    print("\n=== 模块加载 ===")
    for k, v in (r.get("loaded") or {}).items():
        print("  %-10s %s" % (k, v))
    print("预置表条数:", r.get("preset"))
    if r.get("err"):
        print("页面内异常:", r["err"])

    print("\n=== detect() ===")
    ok = 0
    for c in r.get("cases") or []:
        print("  %-36s key=%-16s name=%-10s dir=%s" % (c["url"][:36], c["key"], c["name"] or "-", c["dir"]))
        if c["name"]: ok += 1

    print("\n=== 目录拼装 ===")
    for k in ("biliImg", "biliVid", "biliPart", "huaban", "unknown"):
        if k in r: print("  %-9s %s" % (k, r[k]))

    print("\n=== 断言 ===")
    fails = []
    loaded = r.get("loaded") or {}
    for k in ("registry", "preset", "store", "siteName", "path"):
        if loaded.get(k) != "object": fails.append("模块未加载: " + k)
    if not r.get("preset") or r["preset"] < 300: fails.append("预置表条数异常: %s" % r.get("preset"))
    if ok < 4: fails.append("detect 命中过少: %d/6" % ok)
    if r.get("biliImg") != r.get("biliVid"): fails.append("图片/视频目录不一致")
    if r.get("biliImg") != "video-rod/B站/影视飓风(@946974)": fails.append("B站目录不符: %s" % r.get("biliImg"))
    if not (r.get("biliPart") or "").endswith("/第1话 开场"): fails.append("多P 未分层: %s" % r.get("biliPart"))
    if r.get("huaban") != "video-rod/花瓣/某设计师": fails.append("花瓣目录不符: %s" % r.get("huaban"))
    if "never-seen-before.xyz" not in (r.get("unknown") or ""): fails.append("未收录站点未回退域名: %s" % r.get("unknown"))

    if fails:
        print("FAILED %d 项:" % len(fails))
        for f in fails: print("  ·", f)
        return 1
    print("ALL_PASS")
    return 0

if __name__ == "__main__":
    sys.exit(main())
