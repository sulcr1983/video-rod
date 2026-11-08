"""T11 复验：同一 profile 重启后，目录句柄还在不在、权限还有没有。

为什么必须单独复验：
  T11 第一轮只证明了「句柄能写进 IndexedDB」，那只是**同会话内**的写入成功。
  用户真正在意的是：今天选过目录，明天再双击打开还要不要再选一次。
  这个问题只能靠「用同一个 profile 关掉再开」来回答，同会话内测不出来。

判定：
  · handle 读回来 + queryPermission == 'granted' → 跨会话免授权成立
  · handle 读回来 + 'prompt'                    → 仍在，但需要再确认一次
  · handle 读不回来                              → file:// 下 IDB 跨会话不保留

用法：
  python tools/probe-standalone/resume-check.py <profile 目录>
  不传参数则用 .work/probe-standalone 下最新的 profile。
"""
import glob
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
PROBE_DIR = os.environ.get("VR_PROBE_DIR", "E:/test/vr-standalone-probe")
PROBE_HTML = os.path.join(PROBE_DIR, "probe.html")

CHROME_CANDIDATES = [
    os.environ.get("VR_CHROME", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def find_chrome():
    for p in CHROME_CANDIDATES:
        if p and os.path.exists(p):
            return p
    return None


def latest_profile():
    base = os.path.join(ROOT, ".work", "probe-standalone")
    dirs = [d for d in glob.glob(os.path.join(base, "profile-*")) if os.path.isdir(d)]
    if not dirs:
        return None
    return max(dirs, key=os.path.getmtime)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def launch(chrome, port, profile):
    err = os.path.join(profile, "chrome-stderr-resume.log")
    args = [
        chrome,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--window-size=1200,800",
        "about:blank",
    ]
    with open(err, "wb") as ef:
        proc = subprocess.Popen(args, stdout=ef, stderr=ef)
    for _ in range(80):
        time.sleep(0.25)
        try:
            _opener.open(f"http://127.0.0.1:{port}/json/version", timeout=1)
            return proc
        except Exception:
            if proc.poll() is not None:
                raise RuntimeError(f"浏览器提前退出 code={proc.returncode}，见 {err}")
    raise RuntimeError(f"端口 {port} 未就绪，见 {err}")


class Cdp:
    def __init__(self, port):
        from websocket import create_connection
        self.port = port
        self._mid = 0
        self.ws = None
        self._create = create_connection

    def attach(self, needle, timeout=15):
        end = time.time() + timeout
        while time.time() < end:
            tabs = json.load(_opener.open(f"http://127.0.0.1:{self.port}/json/list"))
            pages = [t for t in tabs
                     if t.get("type") == "page" and needle in (t.get("url") or "")]
            if pages:
                self.ws = self._create(pages[0]["webSocketDebuggerUrl"],
                                       suppress_origin=True, timeout=120)
                return pages[0]
            time.sleep(0.3)
        raise RuntimeError(f"找不到页面 {needle}")

    def send(self, method, params=None):
        self._mid += 1
        mid = self._mid
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == mid:
                return m

    def ev(self, expr, await_promise=False):
        r = self.send("Runtime.evaluate", {
            "expression": expr, "returnByValue": True,
            "awaitPromise": await_promise, "userGesture": True,
        })
        res = r.get("result", {})
        if res.get("exceptionDetails"):
            return {"__exc": str(res["exceptionDetails"])[:400]}
        return res.get("result", {}).get("value")

    def close(self):
        try:
            if self.ws:
                self.ws.close()
        except Exception:
            pass


# 在页面里读回句柄并查权限。返回结构化对象。
READBACK_JS = """
(async () => {
  const out = { supported: !!window.indexedDB };
  const openDb = () => new Promise((res, rej) => {
    const r = indexedDB.open('vr-probe-handle', 1);
    r.onupgradeneeded = () => { try { r.result.createObjectStore('kv'); } catch (e) {} };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    setTimeout(() => rej(new Error('open timeout')), 4000);
  });
  try {
    const db = await openDb();
    const get = (k) => new Promise((res) => {
      const tx = db.transaction(['kv'], 'readonly');
      const g = tx.objectStore('kv').get(k);
      g.onsuccess = () => res(g.result);
      g.onerror = () => res(null);
      setTimeout(() => res(null), 3000);
    });
    const all = await new Promise((res) => {
      const tx = db.transaction(['kv'], 'readonly');
      const g = tx.objectStore('kv').getAllKeys();
      g.onsuccess = () => res(g.result || []);
      g.onerror = () => res([]);
    });
    out.keys = all;
    const h = await get('root');
    out.hasHandle = !!h;
    out.handleType = h ? (h.kind || typeof h) : null;
    if (h && typeof h.queryPermission === 'function') {
      out.permission = await h.queryPermission({ mode: 'readwrite' });
    }
    if (h && typeof h.name === 'string') { out.name = h.name; }
    db.close();
  } catch (e) {
    out.error = String(e && e.name) + ': ' + String(e && e.message);
  }
  return JSON.stringify(out);
})()
"""


def main():
    profile = sys.argv[1] if len(sys.argv) > 1 else latest_profile()
    if not profile or not os.path.isdir(profile):
        print("!! 找不到 profile 目录，先跑一次 --manual 完成 T10/T11", flush=True)
        return 2
    chrome = find_chrome()
    if not chrome:
        print("!! 找不到浏览器，设置 VR_CHROME", flush=True)
        return 2

    port = free_port()
    url = "file:///" + PROBE_HTML.replace("\\", "/")
    print(f"复验 profile：{profile}", flush=True)
    print(f"探针页：{url}", flush=True)

    proc = None
    cdp = None
    try:
        proc = launch(chrome, port, profile)
        cdp = Cdp(port)
        cdp.attach("about:blank", timeout=10)
        cdp.send("Target.createTarget", {"url": url})
        time.sleep(1.0)
        page = cdp.attach("probe.html", timeout=20)
        print(f"→ 已打开 {page.get('url')}", flush=True)

        raw = cdp.ev(READBACK_JS, await_promise=True)
        data = json.loads(raw) if isinstance(raw, str) else {"error": str(raw)}
        print("\n读回结果：" + json.dumps(data, ensure_ascii=False, indent=2), flush=True)

        print("\n" + "=" * 66, flush=True)
        if not data.get("hasHandle"):
            print("结论：句柄没读回来 → file:// 下 IDB 跨会话不保留", flush=True)
            print("      意味着每次打开都要重新授权一次目录。", flush=True)
        elif data.get("permission") == "granted":
            print("结论：句柄在，权限仍是 granted → 跨会话免授权成立", flush=True)
        elif data.get("permission") == "prompt":
            print("结论：句柄在，但权限是 prompt → 还要再点一次确认", flush=True)
        else:
            print(f"结论：句柄在，权限={data.get('permission')!r}，需要人工判断", flush=True)
        print("=" * 66, flush=True)

        out = os.path.join(HERE, "verdict-resume.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump({"profile": profile, "result": data}, f, ensure_ascii=False, indent=2)
        print(f"→ 已写 {out}", flush=True)
        return 0
    finally:
        if cdp:
            cdp.close()
        if proc and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=3)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass


if __name__ == "__main__":
    sys.exit(main())