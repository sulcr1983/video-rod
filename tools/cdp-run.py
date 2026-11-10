# video-rod 测试一键启动器：自动开浏览器 → 跑测试 → 自动关浏览器
#
# 解决两个手工负担：
#   1. 改了 background.js / 内容脚本后必须换新 profile + 新端口（HANDOFF §6.1），
#      手动记端口容易错 → 这里每次自动挑一个空闲端口 + 全新 profile 目录；
#   2. 浏览器开完忘关 → 这里跑完（含失败/异常）一定关掉，除非显式 --keep。
#
# ⚠️ 有头实例纪律（2026-11-10 苏哥定，见 docs/TESTING.md §1 / ARTIFACT-MANAGEMENT.md §2.5）：
#   · 一轮任务只起一个实例，多套套件复用它串行跑，禁止每套各弹一个窗口；
#   · 启动与测试必须在同一条命令内（job object 会回收子进程），收工统一关闭；
#   · 只按自己 --user-data-dir 精确回收（CDP Browser.close 优先），绝不
#     taskkill /IM msedge.exe /F，绝不碰其它会话或苏哥自己的浏览器；
#   · 收工按 profile 关键字复核 left=0 才算关干净。
#
# 用法：
#   python tools/cdp-run.py tools/cdp-image-test.py            # 单套
#   python tools/cdp-run.py --suite full                       # 全部 11 套
#   python tools/cdp-run.py --suite library                    # 资源库 5 套
#   python tools/cdp-run.py --keep tools/cdp-batch-test.py     # 跑完保留浏览器（调试用）
#
# 环境变量：
#   VR_CHROME   指定浏览器可执行文件（默认 Chrome for Testing 147）
#   VR_EXT      指定被测扩展目录（默认仓库根目录）
#   VR_TEST_SITE_PORT  测试站端口（默认 18080）
import argparse
import json
import os
from vr_testenv import work_root
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = work_root()
PROFILES = os.path.join(WORK, "profiles")

DEFAULT_CHROME = r"C:\Users\XPENG\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe"
CHROME = os.environ.get("VR_CHROME", DEFAULT_CHROME)
EXT = os.environ.get("VR_EXT", ROOT)
SITE_PORT = int(os.environ.get("VR_TEST_SITE_PORT", "18080"))

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

# 套件分组：node 单测 → CDP 脚本（顺序即依赖顺序）
SUITES = {
    "full": [
        ("node", "tools/test-path.js"),
        ("node", "tools/test-save.js"),
        ("node", "tools/test-image-util.js"),
        ("node", "tools/test-image-batch.js"),
        ("node", "tools/test-image-tier.js"),
        ("node", "tools/test-image-settings.js"),
        ("cdp", "tools/cdp-s1a-test.py"),
        ("cdp", "tools/cdp-index-test.py"),
        ("cdp", "tools/cdp-migrate-test.py"),
        ("cdp", "tools/cdp-indexer-test.py"),
        ("cdp", "tools/cdp-library-page-test.py"),
        ("cdp", "tools/cdp-viewer-test.py"),
        ("cdp", "tools/cdp-trash-empty-repro.py"),
        ("cdp", "tools/cdp-trash-dup-index-test.py"),
        ("cdp", "tools/cdp-batch-test.py"),
        ("cdp", "tools/cdp-image-test.py"),
        ("cdp", "tools/cdp-image-batch-test.py"),
        ("cdp", "tools/cdp-image-panel-test.py"),
        ("cdp", "tools/cdp-image-settings-test.py"),
        ("cdp", "tools/cdp-image-hover-hit-test.py"),
        ("cdp", "tools/cdp-image-discover-test.py"),
        ("cdp", "tools/cdp-image-album-test.py"),
        ("cdp", "tools/yt-download-test.py"),
    ],
    "yt": [
        # 离线：只打桩「取格式」，其余全真跑（下载 → 合并 → FSA 落盘 → Chrome 解码校验）
        ("cdp", "tools/yt-download-test.py"),
    ],
    "library": [
        ("cdp", "tools/cdp-library-page-test.py"),
        ("cdp", "tools/cdp-viewer-test.py"),
        ("cdp", "tools/cdp-trash-empty-repro.py"),
        ("cdp", "tools/cdp-trash-dup-index-test.py"),
        ("cdp", "tools/cdp-batch-test.py"),
    ],
    "image": [
        ("node", "tools/test-image-util.js"),
        ("node", "tools/test-image-batch.js"),
        ("node", "tools/test-image-tier.js"),
        ("node", "tools/test-image-settings.js"),
        ("cdp", "tools/cdp-image-test.py"),
        ("cdp", "tools/cdp-image-batch-test.py"),
        ("cdp", "tools/cdp-image-panel-test.py"),
        ("cdp", "tools/cdp-image-settings-test.py"),
        ("cdp", "tools/cdp-image-hover-hit-test.py"),
        ("cdp", "tools/cdp-image-discover-test.py"),
        ("cdp", "tools/cdp-image-album-test.py"),
    ],
    "docs": [
        ("py", "tools/check-doc-sync.py"),
    ],
    "core": [
        ("node", "tools/test-path.js"),
        ("cdp", "tools/cdp-s1a-test.py"),
        ("cdp", "tools/cdp-index-test.py"),
        ("cdp", "tools/cdp-migrate-test.py"),
        ("cdp", "tools/cdp-indexer-test.py"),
    ],
}


def free_port(start=9400, end=9600):
    for p in range(start, end):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
            except OSError:
                continue
        return p
    raise RuntimeError(f"{start}-{end} 没有空闲端口")


def site_alive(port):
    try:
        _opener.open(f"http://127.0.0.1:{port}/images.html", timeout=2)
        return True
    except Exception:
        return False


def ensure_site():
    """测试站没起就拉起来（图片线夹具依赖它）。返回是否需要我们负责关闭。"""
    if site_alive(SITE_PORT):
        return None
    site_dir = os.path.join(ROOT, "test-site")
    if not os.path.isdir(site_dir):
        print(f"!! 测试站目录不存在：{site_dir}", flush=True)
        return None
    print(f"→ 启动测试站 127.0.0.1:{SITE_PORT}", flush=True)
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(SITE_PORT), "--bind", "127.0.0.1"],
        cwd=site_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(40):
        time.sleep(0.25)
        if site_alive(SITE_PORT):
            return proc
    print("!! 测试站起不来（端口被占？）", flush=True)
    return proc


def launch(port, profile_name):
    """起一个带扩展的浏览器；profile 目录全新，规避 SW 脚本缓存。"""
    os.makedirs(PROFILES, exist_ok=True)
    profile = os.path.join(PROFILES, profile_name)
    args = [
        CHROME,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile}",
        f"--load-extension={EXT}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "about:blank",
    ]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        time.sleep(0.25)
        try:
            _opener.open(f"http://127.0.0.1:{port}/json/version", timeout=1)
            return proc, profile
        except Exception:
            if proc.poll() is not None:
                raise RuntimeError("浏览器进程提前退出，检查 VR_CHROME 路径与扩展目录")
    raise RuntimeError(f"浏览器 {port} 端口 15 秒内没就绪")


def shutdown(proc):
    """先礼后兵：让浏览器自己退，2 秒不退再强杀。"""
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


def run_one(kind, script, env, label):
    print(f"\n{'=' * 60}\n▶ {label}  {script}\n{'=' * 60}", flush=True)
    t0 = time.time()
    # cdp / py 都走 Python；node 走 node。
    # 区别：cdp 需要浏览器环境，py 是纯脚本（如文档一致性核查）。
    cmd = ([sys.executable, "-u", script] if kind in ("cdp", "py")
           else [os.environ.get("VR_NODE", "node"), script])
    # -u：不缓冲。否则子进程输出会被攒到结束才吐，卡住时看不到卡在哪一步。
    p = subprocess.run(cmd, cwd=ROOT, env=env)
    dt = time.time() - t0
    print(f"— {script} 退出码 {p.returncode}  耗时 {dt:.1f}s", flush=True)
    return p.returncode == 0


def main():
    ap = argparse.ArgumentParser(description="开浏览器 → 跑测试 → 关浏览器")
    ap.add_argument("script", nargs="?", help="单个测试脚本路径")
    ap.add_argument("--suite", choices=sorted(SUITES), help="按套件跑")
    ap.add_argument("--keep", action="store_true", help="跑完保留浏览器（调试用）")
    ap.add_argument("--port", type=int, help="指定 CDP 端口（默认自动挑）")
    ap.add_argument("--profile", help="指定 profile 名（默认固定 vr-auto）")
    args = ap.parse_args()

    if not args.script and not args.suite:
        ap.error("要么给一个脚本路径，要么用 --suite")

    plan = SUITES[args.suite] if args.suite else [("cdp", args.script)]
    if args.script and not args.suite:
        plan = [("node" if args.script.endswith(".js") else "cdp", args.script)]

    need_browser = any(k == "cdp" for k, _ in plan)

    print(f"浏览器：{CHROME}", flush=True)
    print(f"扩展：  {EXT}", flush=True)
    if not os.path.exists(CHROME):
        print("!! 找不到浏览器，设置 VR_CHROME 环境变量", flush=True)
        return 2

    site_proc = None
    chrome_proc = None
    profile = None
    port = None
    ok = True
    try:
        site_proc = ensure_site()

        if need_browser:
            port = args.port or free_port()
            name = args.profile or f"vr-auto-{int(time.time())}"
            print(f"→ 启动浏览器 端口 {port} / profile {name}（全新，规避 SW 缓存）", flush=True)
            chrome_proc, profile = launch(port, name)
            print(f"→ 就绪  http://127.0.0.1:{port}", flush=True)
        else:
            print("→ 纯 Node 测试，不需要浏览器", flush=True)

        env = dict(os.environ)
        if port:
            env["VR_CDP"] = f"http://127.0.0.1:{port}"

        for kind, script in plan:
            if not run_one(kind, script, env, {"node": "单测", "py": "脚本"}.get(kind, "CDP")):
                ok = False
                print(f"!! {script} 失败，后续套件继续跑（便于一次看全）", flush=True)
    finally:
        if args.keep:
            print(f"\n→ --keep：浏览器保留在端口 {port}，profile {profile}", flush=True)
        else:
            shutdown(chrome_proc)
            if chrome_proc:
                print("→ 浏览器已关闭", flush=True)
            if profile:
                print(f"→ profile 保留在 {profile}（要清理就删 .work/profiles）", flush=True)
        if site_proc is not None:
            shutdown(site_proc)
            print("→ 测试站已关闭（本次由脚本启动）", flush=True)

    print(f"\n{'=' * 60}", flush=True)
    print("✅ 全部通过" if ok else "❌ 有套件失败", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
