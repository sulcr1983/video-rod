"""自动执行 standalone 能力探针，输出 verdict.json。

设计要点（每一条都影响结论是否可信）：

① **不加任何放行参数**。绝不传 --allow-file-access-from-files 之类的 flag，
   否则测出来的是「改过设置的浏览器」，而用户是双击打开，必须测默认行为。

② **全新 profile**。避免上一次的 IndexedDB / localStorage 残留把 T8/T9 测成假阳性。

③ **T10/T11 单独留手动**。showDirectoryPicker 要求真实用户激活，
   CDP 的合成点击不被认可（sticky activation 不成立），所以脚本只提示、不代点。

④ 结果同时写 window.__PROBE__ 和 verdict.json，两边都能查。

用法：
  python tools/probe-standalone/run-probe.py            # 自动跑 T1-T9,T12-T14
  python tools/probe-standalone/run-probe.py --manual   # 跑完等真人点目录选择器
  python tools/probe-standalone/run-probe.py --keep     # 跑完不关浏览器

环境变量：
  VR_CHROME  指定浏览器可执行文件
  VR_PROBE_DIR  覆盖探针素材目录（默认 E:/test/vr-standalone-probe）
"""
import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))

# Windows 控制台默认 GBK，打印 ↳ / ✓ 这类符号会直接抛 UnicodeEncodeError
# 把整个探针结果吞掉。这里显式切到 UTF-8，errors=replace 兜底。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PROBE_DIR = os.environ.get("VR_PROBE_DIR", "E:/test/vr-standalone-probe")
PROBE_HTML = os.path.join(PROBE_DIR, "probe.html")

# 本机真实路径优先；tools/cdp-run.py 里的默认值指向不存在的用户目录
CHROME_CANDIDATES = [
    os.environ.get("VR_CHROME", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def sync_probe_files():
    """把 probe.html / probe.js 同步到素材目录。

    为什么必须同步，而不是直接打开 tools/ 下那份：
      探针页用**相对路径**读素材（image/sample.jpg、_library/index.json），
      这是要验证的核心机制。若页在 tools/ 下，相对路径会指向 tools/image/…，
      测出来的就不是真实布局。所以让页和素材同处一个目录，与将来
      资源库.html 和素材同级的真实形态一致。
    """
    import shutil
    made = []
    for name in ("probe.html", "probe.js"):
        src = os.path.join(HERE, name)
        dst = os.path.join(PROBE_DIR, name)
        if not os.path.exists(src):
            raise RuntimeError(f"缺 {src}")
        shutil.copyfile(src, dst)
        made.append(dst)
    return made


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
    os.makedirs(profile, exist_ok=True)
    # stderr 落盘：Chrome 启动失败时真正的理由（沙箱、profile 占用、参数不认）
    # 只出现在 stderr 里，丢掉就只剩「提前退出」这句没有信息量的报错。
    err_log = os.path.join(profile, "chrome-stderr.log")
    args = [
        chrome,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        # 刻意不加 --allow-file-access-from-files：要测的是默认行为
        "--window-size=1440,900",
        "about:blank",
    ]
    with open(err_log, "wb") as ef:
        proc = subprocess.Popen(args, stdout=ef, stderr=ef)
    for _ in range(80):
        time.sleep(0.25)
        try:
            _opener.open(f"http://127.0.0.1:{port}/json/version", timeout=1)
            return proc
        except Exception:
            if proc.poll() is not None:
                raise RuntimeError(
                    f"浏览器提前退出（code={proc.returncode}），stderr 见 {err_log}")
    raise RuntimeError(f"浏览器 {port} 端口 20 秒内没就绪，stderr 见 {err_log}")


def shutdown(proc):
    if proc is None or proc.poll() is not None:
        return
    try:
        proc.terminate()
        proc.wait(timeout=3)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


class Cdp:
    """极简 CDP 客户端：只用 Runtime.evaluate。"""

    def __init__(self, port):
        from websocket import create_connection
        self.port = port
        self._mid = 0
        self.ws = None
        self._create = create_connection

    def attach_to_page(self, url_contains, timeout=15):
        end = time.time() + timeout
        while time.time() < end:
            tabs = json.load(_opener.open(f"http://127.0.0.1:{self.port}/json/list"))
            pages = [t for t in tabs
                     if t.get("type") == "page" and url_contains in (t.get("url") or "")]
            if pages:
                self.ws = self._create(pages[0]["webSocketDebuggerUrl"],
                                       suppress_origin=True, timeout=180)
                return pages[0]
            time.sleep(0.3)
        raise RuntimeError(f"找不到页面 {url_contains}")

    def send(self, method, params=None):
        self._mid += 1
        mid = self._mid
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == mid:
                return m

    def ev(self, expr, await_promise=False, timeout=None):
        r = self.send("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": await_promise,
            "userGesture": True,
        })
        if "error" in r:
            return {"__err": r["error"]}
        res = r.get("result", {})
        if res.get("exceptionDetails"):
            return {"__exc": str(res["exceptionDetails"])[:500]}
        return res.get("result", {}).get("value")

    def close(self):
        try:
            if self.ws:
                self.ws.close()
        except Exception:
            pass


def open_probe(cdp, url):
    """在已有浏览器里新开一个 tab 指向探针页。

    注意顺序：Target.createTarget 是**浏览器级**命令，但仍然需要一个
    已建立的 ws 会话才能发。所以先连上启动时那个 about:blank 页，
    借它的连接发 createTarget，再切到新页。
    """
    try:
        cdp.attach_to_page("about:blank", timeout=10)
    except Exception:
        # 万一没有 about:blank（例如浏览器恢复上次会话），随便连一个 page
        cdp.attach_to_page("", timeout=10)
    cdp.send("Target.createTarget", {"url": url})
    time.sleep(0.8)
    return cdp.attach_to_page("probe.html", timeout=20)


def run_auto(cdp):
    if cdp.ev("typeof window.__PROBE__ !== 'undefined'") is not True:
        raise RuntimeError("探针脚本没加载（probe.js 路径或语法问题）")

    print("→ 执行自动检测（T1-T9 / T12-T14）…", flush=True)
    t0 = time.time()
    cdp.ev("window.__runProbe()")
    # 视频 15s×(4 变体) + 大索引 20s 上限，给足 150s
    end = time.time() + 150
    while time.time() < end:
        if cdp.ev("window.__PROBE__ && window.__PROBE__.finished === true"):
            break
        time.sleep(0.5)
    else:
        print("!! 自动检测超时，按当前已完成的项出结论", flush=True)

    print(f"→ 自动部分耗时 {time.time() - t0:.1f}s", flush=True)
    return cdp.ev("JSON.stringify(window.__PROBE__)")


def run_manual(cdp):
    """提示真人点一次目录选择器。

    脚本只能把按钮点亮并等结果；真正 click 带来的 user activation
    必须由真人产生，所以这里不代点。
    """
    print("\n" + "=" * 62, flush=True)
    print("需要你动手（只有这一步）：", flush=True)
    print("  1. 屏幕上那个浏览器窗口里，点「手动：选一个文件夹」按钮", flush=True)
    print("  2. 弹出文件夹选择框后，随便选一个（比如 E:\\test），点「选择文件夹」", flush=True)
    print("  3. 等 10 秒，脚本会自动读取 T10 / T11 结果", flush=True)
    print("=" * 62 + "\n", flush=True)

    end = time.time() + 180
    while time.time() < end:
        done = cdp.ev(
            "!!(window.__PROBE__ && window.__PROBE__.manual && "
            "window.__PROBE__.manual.T11 !== undefined)"
        )
        if done:
            print("→ 收到手动结果", flush=True)
            return True
        time.sleep(1)
    print("!! 180 秒内没等到手动结果，T10/T11 记为未测", flush=True)
    return False


def summarize(raw):
    """把 CDP 收回的字符串解析成结构化结论。"""
    try:
        data = json.loads(raw) if isinstance(raw, str) else (raw or {})
    except Exception:
        return None
    return data


def print_table(data):
    tests = data.get("tests") or {}
    manual = data.get("manual") or {}

    print("\n" + "=" * 78, flush=True)
    print("自动检测结果", flush=True)
    print("=" * 78, flush=True)
    print(f"{'编号':<5} {'结果':<5} {'检查项':<44} 实测值", flush=True)
    print("-" * 78, flush=True)
    for k in sorted(tests.keys()):
        t = tests[k]
        p = t.get("pass")
        tag = "通过" if p is True else ("失败" if p is False else "待定")
        print(f"{k:<5} {tag:<5} {t.get('name', ''):<44} {t.get('value', '')}", flush=True)
        if t.get("reason"):
            print(f"       ↳ {t['reason']}", flush=True)

    if manual:
        print("-" * 78, flush=True)
        for k in sorted(manual.keys()):
            m = manual[k]
            tag = "通过" if m.get("pass") is True else "失败"
            print(f"{k:<5} {tag:<5} (手动) {m.get('value', '')}", flush=True)
            if m.get("reason"):
                print(f"       ↳ {m['reason']}", flush=True)


def judge(data):
    """按用户第一性原理给出两条结论：能不能看 / 能不能管。"""
    if not data:
        return None
    t = data.get("tests") or {}
    m = data.get("manual") or {}

    def ok(k):
        return (t.get(k) or {}).get("pass") is True

    can_view = all(ok(x) for x in ("T1", "T2", "T3", "T4"))
    view_detail = {x: (t.get(x) or {}).get("pass") for x in ("T1", "T2", "T3", "T4")}

    idb = ok("T8")
    ls_ok = ok("T9")
    handle_ok = (m.get("T11") or {}).get("pass") is True
    can_manage = idb or ls_ok or handle_ok

    read_channel = [x for x in ("T5", "T6", "T7") if ok(x)]

    return {
        "canViewWithoutGesture": can_view,
        "viewDetail": view_detail,
        "hasPersistentStore": bool(idb or ls_ok),
        "indexedDB": idb,
        "localStorage": ls_ok,
        "handlePersists": handle_ok,
        "canManageAcrossSessions": can_manage,
        "workingIndexChannels": read_channel,
        "bigIndex": (t.get("T13") or {}).get("extra"),
    }


def main():
    ap = argparse.ArgumentParser(description="跑 standalone 能力探针")
    ap.add_argument("--manual", action="store_true", help="跑完等待真人点目录选择器")
    ap.add_argument("--keep", action="store_true", help="跑完保留浏览器")
    ap.add_argument("--port", type=int, help="指定 CDP 端口")
    args = ap.parse_args()

    chrome = find_chrome()
    if not chrome:
        print("!! 找不到浏览器，设置 VR_CHROME 环境变量", flush=True)
        return 2
    if not os.path.isdir(PROBE_DIR):
        print(f"!! 素材目录不存在 {PROBE_DIR}", flush=True)
        print("   先跑：python tools/probe-standalone/make-fixtures.py", flush=True)
        return 2
    try:
        for p in sync_probe_files():
            print(f"→ 同步 {os.path.basename(p)} → {PROBE_DIR}", flush=True)
    except Exception as e:
        print(f"!! 同步探针文件失败：{e}", flush=True)
        return 2

    port = args.port or free_port()
    profile = os.path.join(ROOT, ".work", "probe-standalone", f"profile-{int(time.time())}")
    url = "file:///" + PROBE_HTML.replace("\\", "/")

    print(f"浏览器：{chrome}", flush=True)
    print(f"探针页：{url}", flush=True)
    print(f"profile：{profile}（全新，避免上次残留）", flush=True)

    proc = None
    cdp = None
    try:
        proc = launch(chrome, port, profile)
        cdp = Cdp(port)
        page = open_probe(cdp, url)
        print(f"→ 已打开 {page.get('url')}", flush=True)

        raw = run_auto(cdp)
        data = summarize(raw)

        if args.manual and data is not None:
            run_manual(cdp)
            data = summarize(cdp.ev("JSON.stringify(window.__PROBE__)"))

        if data:
            print_table(data)
            verdict = judge(data)
            data["verdict"] = verdict

            out_path = os.path.join(HERE, "verdict.json")
            data["_meta"] = {
                "chrome": chrome,
                "url": url,
                "probeDir": PROBE_DIR,
                "note": "未传 --allow-file-access-from-files，测的是默认行为",
            }
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"\n→ 已写 {out_path}", flush=True)

            if verdict:
                print("\n" + "=" * 78, flush=True)
                print("结论", flush=True)
                print("=" * 78, flush=True)
                print(f"  0 次交互就能看到素材：{'是' if verdict['canViewWithoutGesture'] else '否'}", flush=True)
                print(f"    明细 {verdict['viewDetail']}", flush=True)
                print(f"  能跨会话保存状态：{'是' if verdict['canManageAcrossSessions'] else '否'}", flush=True)
                print(f"    IndexedDB={verdict['indexedDB']} localStorage={verdict['localStorage']} "
                      f"目录句柄={verdict['handlePersists']}", flush=True)
                print(f"  可用的索引读取通道：{verdict['workingIndexChannels'] or '无'}", flush=True)
        else:
            print("!! 没拿到结果", flush=True)
            return 1

        return 0
    finally:
        if cdp:
            cdp.close()
        if not args.keep:
            shutdown(proc)
        else:
            print(f"\n浏览器保留（端口 {port}），用完自己关", flush=True)


if __name__ == "__main__":
    sys.exit(main())