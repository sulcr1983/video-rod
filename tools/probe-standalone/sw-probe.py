"""SW 侧技术预研：Service Worker 能不能读句柄并写文件。

要回答的问题（决定「快照自动化」怎么实现）：
  Q1. Service Worker 里 indexedDB 能不能打开、能不能读出 root 句柄？
  Q2. 读出来的 FileSystemDirectoryHandle 有没有 queryPermission / getDirectoryHandle？
  Q3. 拿到句柄后，SW 能不能真的 createWritable 写文件？
  Q4. 写完后页面侧能否读回来（跨上下文一致性）？

背景矛盾：
  js/library/indexer.js:4 明确写「FSA 句柄 SW 拿不到」，所以快照只能在页面侧做。
  但 js/library/save.js:300 在 SW 里用 db.getHandle('root') 拿句柄并写盘。
  两者必有一处过时。若 SW 真能写，快照自动化就可以放在 SW，无需页面常驻。

用法：
  python tools/probe-standalone/sw-probe.py
  需要先有一个已授权目录并写入 root 句柄（跑 run-probe.py --manual 会存）。
"""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXT = ROOT

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


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def launch(chrome, port, profile):
    """启动浏览器并**用 CDP 加载扩展**。

    为什么不用 --load-extension：
      Chrome 156 上该参数已被忽略（实测加载后目标列表里根本没有本扩展），
      只剩两个系统自带的扩展。必须改用 CDP 的 Extensions.loadUnpacked，
      它会返回真实扩展 ID，后续连接 SW 才有依据。

    返回 (proc, ext_id)。
    """
    os.makedirs(profile, exist_ok=True)
    err = os.path.join(profile, "chrome-stderr.log")
    args = [
        chrome,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        # 允许通过 CDP 安装未打包扩展（不加这条 loadUnpacked 会被拒）
        "--enable-unsafe-extension-debugging",
        "--window-size=1280,900",
        "about:blank",
    ]
    with open(err, "wb") as ef:
        proc = subprocess.Popen(args, stdout=ef, stderr=ef)
    for _ in range(80):
        time.sleep(0.25)
        try:
            _opener.open(f"http://127.0.0.1:{port}/json/version", timeout=1)
            break
        except Exception:
            if proc.poll() is not None:
                raise RuntimeError(f"浏览器提前退出 code={proc.returncode}，见 {err}")
    else:
        raise RuntimeError(f"端口 {port} 未就绪，见 {err}")

    # 浏览器级 ws 会话：Extensions.loadUnpacked 只能在这里发
    ver = json.load(_opener.open(f"http://127.0.0.1:{port}/json/version"))
    return proc, ver


def load_extension(port, ext_path):
    """通过 CDP 安装未打包扩展，返回真实扩展 id。"""
    from websocket import create_connection
    ver = json.load(_opener.open(f"http://127.0.0.1:{port}/json/version"))
    ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=90)
    try:
        ws.send(json.dumps({"id": 1, "method": "Extensions.loadUnpacked",
                            "params": {"path": ext_path}}))
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == 1:
                if "error" in r:
                    raise RuntimeError("loadUnpacked 失败：" + json.dumps(r["error"], ensure_ascii=False))
                return r["result"]["id"]
    finally:
        try:
            ws.close()
        except Exception:
            pass


class Cdp:
    def __init__(self, port):
        from websocket import create_connection
        self.port = port
        self._mid = 0
        self.ws = None
        self._create = create_connection

    def attach_target(self, pred, timeout=20):
        """pred(target_dict) -> bool"""
        end = time.time() + timeout
        while time.time() < end:
            tabs = json.load(_opener.open(f"http://127.0.0.1:{self.port}/json/list"))
            hits = [t for t in tabs if pred(t)]
            if hits:
                self.ws = self._create(hits[0]["webSocketDebuggerUrl"],
                                       suppress_origin=True, timeout=180)
                return hits[0]
            time.sleep(0.4)
        raise RuntimeError("找不到目标上下文")

    def send(self, method, params=None):
        self._mid += 1
        mid = self._mid
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == mid:
                return m

    def ev(self, expr, await_promise=True):
        r = self.send("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": await_promise,
            "userGesture": True,
        })
        res = r.get("result", {})
        if res.get("exceptionDetails"):
            return {"__exc": str(res["exceptionDetails"])[:600]}
        return res.get("result", {}).get("value")

    def close(self):
        try:
            if self.ws:
                self.ws.close()
        except Exception:
            pass


# 在 SW 里跑：查 IDB、读句柄、探权限、试写文件
SW_EXPR = r"""
(async () => {
  const out = { steps: [] };
  const log = (k, v) => out.steps.push({ step: k, ok: v && v.ok !== false, detail: v });

  // ---------- Q1: SW 里有没有 indexedDB ----------
  out.hasIndexedDB = (typeof indexedDB !== 'undefined');
  if (!out.hasIndexedDB) { return JSON.stringify(out); }

  // ---------- 打开 vr-library 并读 handle store ----------
  const openDb = () => new Promise((res, rej) => {
    const r = indexedDB.open('vr-library');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('open failed'));
    setTimeout(() => rej(new Error('open timeout')), 5000);
  });

  let db;
  try { db = await openDb(); }
  catch (e) { log('openDb', { ok: false, err: String(e && e.message) }); return JSON.stringify(out); }
  out.dbVersion = db.version;
  out.stores = Array.from(db.objectStoreNames);

  const getHandle = (key) => new Promise((res) => {
    try {
      const tx = db.transaction(['handle'], 'readonly');
      const g = tx.objectStore('handle').get(key);
      g.onsuccess = () => res(g.result || null);
      g.onerror = () => res(null);
    } catch (e) { res(null); }
  });

  let h = null;
  try { h = await getHandle('root'); }
  catch (e) { /* 忽略 */ }
  out.hasHandle = !!h;
  out.handleKind = h ? (h.kind || typeof h) : null;
  out.handleName = h && typeof h.name === 'string' ? h.name : null;

  if (!h) {
    // 列出所有 handle key，便于判断是没授权还是键名不同
    out.handleKeys = await new Promise((res) => {
      try {
        const tx = db.transaction(['handle'], 'readonly');
        const g = tx.objectStore('handle').getAllKeys();
        g.onsuccess = () => res(g.result || []);
        g.onerror = () => res([]);
      } catch (e) { res([]); }
    });
    return JSON.stringify(out);
  }

  // ---------- Q2: 句柄能力 ----------
  out.hasGetDirectoryHandle = (typeof h.getDirectoryHandle === 'function');
  out.hasQueryPermission = (typeof h.queryPermission === 'function');
  out.hasRequestPermission = (typeof h.requestPermission === 'function');

  if (out.hasQueryPermission) {
    try {
      out.permRead = await h.queryPermission({ mode: 'read' });
      out.permReadWrite = await h.queryPermission({ mode: 'readwrite' });
    } catch (e) {
      out.permErr = String(e && e.name) + ': ' + String(e && e.message);
    }
  }

  // ---------- Q3: SW 里能否真的写文件 ----------
  out.write = { tried: false };
  if (out.hasGetDirectoryHandle) {
    out.write.tried = true;
    try {
      const dir = await h.getDirectoryHandle('_selftest', { create: true });
      const fh = await dir.getFileHandle('sw-write-probe.txt', { create: true });
      const w = await fh.createWritable();
      await w.write('sw wrote at ' + new Date().toISOString());
      await w.close();
      const f = await fh.getFile();
      out.write.ok = true;
      out.write.size = f.size;
      out.write.path = '_selftest/sw-write-probe.txt';
      // 读回内容自证
      const txt = await f.text();
      out.write.readback = txt.slice(0, 40);
    } catch (e) {
      out.write.ok = false;
      out.write.err = String(e && e.name) + ': ' + String(e && e.message);
    }
  }

  // ---------- Q4: SW 能否读 _library 目录并枚举 ----------
  out.libDir = { tried: false };
  try {
    const lib = await h.getDirectoryHandle('_library');
    out.libDir.tried = true;
    const names = [];
    for await (const e of lib.entries()) { names.push(e[0]); }
    out.libDir.ok = true;
    out.libDir.names = names.slice(0, 20);
    out.libDir.count = names.length;
  } catch (e) {
    out.libDir.ok = false;
    out.libDir.err = String(e && e.name) + ': ' + String(e && e.message);
  }

  try { db.close(); } catch (e) { /* 忽略 */ }
  return JSON.stringify(out);
})()
"""


def find_ext_id(cdp):
    """从 CDP 的目标列表里找扩展 id。

    MV3 的 SW 是懒启动的：浏览器刚开、没事件时根本不存在 service_worker 目标。
    所以必须先打开一个扩展页面（options.html）把它唤醒，再去找 SW。
    """
    # ① 先用 chrome://extensions 拿不到（CDP 不暴露该页的 DOM）
    # ② 直接扫目标列表里任何 chrome-extension:// 的 URL
    end = time.time() + 15
    while time.time() < end:
        try:
            tabs = json.load(_opener.open(f"http://127.0.0.1:{cdp.port}/json/list"))
        except Exception:
            time.sleep(0.4)
            continue
        for t in tabs:
            u = t.get("url") or ""
            if u.startswith("chrome-extension://"):
                return u.split("/")[2]
        # 没有扩展页 → 主动开一个来唤醒 SW
        try:
            cdp.send("Target.createTarget",
                     {"url": "chrome-extension://__none__/none.html"})
        except Exception:
            pass
        time.sleep(0.5)
    return None


def wake_and_find_sw(cdp, port, profile):
    """唤醒 SW 并返回其目标描述。

    MV3 的 SW 是懒启动的：浏览器刚开、没事件时根本不存在 service_worker 目标。
    所以必须先打开一个扩展页面（options.html）把它唤醒，再去找 SW。
    """
    # 先尝试直接找（也许已启动）
    for _ in range(6):
        tabs = json.load(_opener.open(f"http://127.0.0.1:{port}/json/list"))
        sws = [t for t in tabs
               if t.get("type") == "service_worker" and "background.js" in (t.get("url") or "")]
        if sws:
            return sws[0]
        time.sleep(0.5)

    # 扫扩展 id：从目标列表里任何 chrome-extension:// 页面取
    ext_id = None
    tabs = json.load(_opener.open(f"http://127.0.0.1:{port}/json/list"))
    for t in tabs:
        u = t.get("url") or ""
        if u.startswith("chrome-extension://"):
            ext_id = u.split("/")[2]
            break

    # 退路：读 profile 的 Preferences，按名字匹配本扩展
    if not ext_id:
        pref = os.path.join(profile, "Default", "Preferences")
        try:
            with open(pref, encoding="utf-8") as f:
                data = json.load(f)
            settings = (data.get("extensions") or {}).get("settings") or {}
            for k, v in settings.items():
                blob = json.dumps(v, ensure_ascii=False)
                if "钓鱼竿" in blob or "video-rod" in blob or "cat-catch" in blob:
                    ext_id = k
                    break
            if not ext_id and settings:
                ext_id = list(settings.keys())[0]
        except Exception as e:
            print(f"   读 Preferences 失败：{e}", flush=True)

    if not ext_id:
        raise RuntimeError("拿不到扩展 id（无法唤醒 SW）")

    print(f"→ 打开 options.html 唤醒 SW（扩展 id {ext_id}）", flush=True)
    # 打开 options 页唤醒 SW。先连上 about:blank 建立 ws 会话，
    # 否则 Target.createTarget 无处可发。
    try:
        cdp.attach_target(lambda t: t.get("type") == "page", timeout=10)
    except Exception:
        pass
    cdp.send("Target.createTarget", {"url": f"chrome-extension://{ext_id}/options.html"})
    for _ in range(40):
        time.sleep(0.5)
        tabs = json.load(_opener.open(f"http://127.0.0.1:{port}/json/list"))
        sws = [t for t in tabs
               if t.get("type") == "service_worker" and "background.js" in (t.get("url") or "")]
        if sws:
            return sws[0]
    raise RuntimeError("唤醒后仍找不到 SW 目标")


def main():
    chrome = find_chrome()
    if not chrome:
        print("!! 找不到浏览器，设置 VR_CHROME", flush=True)
        return 2

    port = free_port()
    # profile 必须放系统临时目录：
    #   实测把 --user-data-dir 指到仓库内的 .work/ 下，Chrome 会立即退出（code=0），
    #   换到 tempfile 目录就正常。原因未深究（疑似路径/权限策略），
    #   但既然是探针，用临时目录更干净，也不污染仓库。
    import tempfile
    profile = os.path.join(tempfile.mkdtemp(prefix="vr-sw-probe-"), "p")
    print(f"浏览器：{chrome}", flush=True)
    print(f"扩展：  {EXT}", flush=True)
    print(f"profile：{profile}（临时目录）", flush=True)

    proc = None
    cdp = None
    try:
        proc = launch(chrome, port, profile)
        ext_id = load_extension(port, EXT)
        print(f"→ 扩展已加载：{ext_id}", flush=True)
        time.sleep(2.0)

        # 打开扩展页面唤醒 SW（MV3 懒启动）
        cdp = Cdp(port)
        try:
            cdp.attach_target(lambda t: t.get("type") == "page", timeout=10)
            cdp.send("Target.createTarget",
                     {"url": f"chrome-extension://{ext_id}/options.html"})
        except Exception as e:
            print(f"   唤醒页打开失败：{e}", flush=True)

        target = None
        for _ in range(40):
            time.sleep(0.5)
            tabs = json.load(_opener.open(f"http://127.0.0.1:{port}/json/list"))
            hits = [t for t in tabs
                    if t.get("type") == "service_worker"
                    and ext_id in (t.get("url") or "")]
            if hits:
                target = hits[0]
                break
        if not target:
            print("!! 找不到本扩展的 SW 目标", flush=True)
            return 1

        cdp.attach_target(lambda t: t.get("webSocketDebuggerUrl") == target["webSocketDebuggerUrl"])
        print(f"→ 已连上 SW：{target.get('url')}", flush=True)

        raw = cdp.ev(SW_EXPR, await_promise=True)
        if isinstance(raw, dict):
            print("!! 求值异常：" + json.dumps(raw, ensure_ascii=False), flush=True)
            return 1

        data = json.loads(raw)
        print("\n" + "=" * 70, flush=True)
        print("SW 侧能力探测结果", flush=True)
        print("=" * 70, flush=True)
        for k in ("hasIndexedDB", "dbVersion", "stores", "hasHandle", "handleKind",
                  "handleName", "hasGetDirectoryHandle", "hasQueryPermission",
                  "hasRequestPermission", "permRead", "permReadWrite", "permErr"):
            if k in data:
                print(f"  {k:24} {data[k]}", flush=True)
        if "handleKeys" in data:
            print(f"  {'handleKeys':24} {data['handleKeys']}", flush=True)

        print("\n-- Q3 SW 写文件 --", flush=True)
        print("  " + json.dumps(data.get("write"), ensure_ascii=False, indent=2).replace("\n", "\n  "), flush=True)

        print("\n-- Q4 SW 枚举 _library --", flush=True)
        print("  " + json.dumps(data.get("libDir"), ensure_ascii=False, indent=2).replace("\n", "\n  "), flush=True)

        print("\n" + "=" * 70, flush=True)
        print("结论", flush=True)
        print("=" * 70, flush=True)
        if not data.get("hasHandle"):
            print("  SW 读不到 root 句柄 → 快照自动化不能放 SW，只能页面侧触发", flush=True)
        elif data.get("write", {}).get("ok"):
            print(f"  ✅ SW 能拿到句柄并写文件（{data['write'].get('path')}，"
                  f"{data['write'].get('size')}B）", flush=True)
            print("     → indexer.js:4 的「SW 拿不到句柄」结论已过时", flush=True)
            print("     → 快照自动化可以放在 SW，无需页面常驻", flush=True)
        else:
            print("  SW 拿到句柄但写失败：" + str(data.get("write", {}).get("err")), flush=True)
            print("     → 快照自动化仍需页面侧触发", flush=True)

        out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sw-verdict.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"\n→ 已写 {out}", flush=True)
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