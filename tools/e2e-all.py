# -*- coding: utf-8 -*-
"""e2e-all · 一次性跑完全部测试套件（同一浏览器实例内串行）

为什么有这个脚本（苏哥 2026-11-05 反馈）：
    以前每个套件单独起浏览器、跑完就关，一天开关十几次，抖音等站点直接风控。
    现在改成：开一次浏览器 → 所有套件轮流 attach 同一实例（只开/关标签页）
    → 全部跑完 → 最后优雅关闭一次。

风控配套：
    · 启动/冷却/日配额由 tools/vr-session.py 闸门统一管控
    · 真实站点套件默认不跑，加 --live 才跑；站点之间强制随机间隔
    · 同一站点只访问一次，不在套件内反复刷新

用法：
    python tools/e2e-all.py                 # 只跑离线/本地套件（零风控，日常首选）
    python tools/e2e-all.py --live          # 追加真实站点套件（每个站点只碰一次）
    python tools/e2e-all.py --only dedup,e2e-buttons
    python tools/e2e-all.py --keep          # 跑完不关浏览器，留给下一批
"""
import argparse
import json
import os
from vr_testenv import work_root
import random
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
PORT = 9480
REPORT_DIR = os.path.join(ROOT, "deliverables", "test-runs")

PASS_RE = re.compile(r"(\d+)\s*/\s*(\d+)\s*PASS")

# name, 命令模板({port}/{ext} 占位), 是否真实站点, 说明
SUITES = [
    ("e2e-sw",       [sys.executable, "tools/e2e-sw.py"],                   False, "后台 SW 存活（护栏：静默失效）"),
    ("dedup",        ["node", "tools/dedup-test.mjs"],                     False, "去重指纹单测（纯 Node）"),
    ("stage-rewrite",[sys.executable, "tools/stage-rewrite-test.py"],       False, "舞台皮肤回归（库页 DOM/样式）"),
    ("skin",         [sys.executable, "tools/skin-test.py"],                False, "换皮一致性（popup/options）"),
    ("download-path",[sys.executable, "tools/download-path-test.py"],       False, "归档路径三级目录 + 中文/空格"),
    ("e2e-buttons",  [sys.executable, "tools/e2e-buttons.py"],              False, "资源库 60 按钮 + 设置页白名单"),
    ("e2e-popup",    [sys.executable, "tools/e2e-popup.py"],                False, "popup 列表/下载（内置本地站）"),
    ("e2e-overlay",  [sys.executable, "tools/e2e-overlay.py"],              False, "页面悬浮按钮与视频页抑制"),
]

LIVE_SUITES = [
    ("e2e-xhs-image",[sys.executable, "tools/e2e-xhs-image.py"],            True,  "小红书图片批量（真实站点）"),
]


def log(msg):
    print(msg, flush=True)


def safe_console(text):
    """子进程输出可能带 UTF-8 替换字符；Windows GBK 控制台直接 print 会崩。"""
    try:
        print(text, flush=True)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        try:
            print(text.encode(enc, "replace").decode(enc, "replace"), flush=True)
        except Exception:
            print(text.encode("ascii", "replace").decode("ascii"), flush=True)


def port_alive(port, timeout=2.0):
    try:
        import urllib.request
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        op.open("http://127.0.0.1:%d/json/version" % port, timeout=timeout)
        return True
    except Exception:
        return False


EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
ISOLATED_PROFILE = os.path.join(work_root(), "e2e-profile")


def edge_exe():
    for p in EDGE_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def stop_isolated(port, proc=None):
    """优雅关闭隔离实例；失败再兜底 kill。绝不碰 9480 的真实 profile。"""
    try:
        subprocess.run(
            [sys.executable, os.path.join(TOOLS, "test-browser-close.py"), "--port", str(port)],
            timeout=20, capture_output=True, text=True)
    except Exception:
        pass
    if proc:
        try:
            proc.wait(timeout=8)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


def start_isolated(port):
    """启动一个“测试专用 profile”的 Edge。

    关键：profile 在 .work/e2e-profile，每次启动前删除，保证空库；
    扩展仍从仓库根加载，所以扩展 ID 不变；端口默认 9490，和真实 9480 完全隔离。
    """
    exe = edge_exe()
    if not exe:
        raise RuntimeError("找不到 Edge（检查 Program Files）")
    if port_alive(port):
        log("[隔离] 端口 %d 已有实例在线，直接复用（不删除 profile）" % port)
        return None

    try:
        shutil.rmtree(ISOLATED_PROFILE, ignore_errors=True)
    except Exception:
        pass
    os.makedirs(ISOLATED_PROFILE, exist_ok=True)
    args = [
        exe,
        "--user-data-dir=%s" % ISOLATED_PROFILE,
        "--disable-extensions-except=%s" % ROOT,
        "--load-extension=%s" % ROOT,
        "--remote-debugging-port=%d" % port,
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--window-size=1600,1000",
    ]
    log("[隔离] 启动测试 Edge：profile=%s，port=%d" % (ISOLATED_PROFILE, port))
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(80):
        time.sleep(0.5)
        if port_alive(port, timeout=1):
            break
    else:
        stop_isolated(port, proc)
        raise RuntimeError("隔离实例 40 秒内未监听端口 %d" % port)
    time.sleep(2)
    return proc


def run_suite(name, cmd, is_live, desc, port, ext, timeout):
    full = list(cmd)
    if not name == "dedup":
        full += ["--port", str(port)]
        try:
            g = subprocess.run([sys.executable, os.path.join(TOOLS, name + ".py"), "--help"],
                               capture_output=True, text=True, timeout=30)
            if "--ext" in g.stdout:
                full += ["--ext", ext]
        except Exception:
            pass

    tag = "LIVE" if is_live else "LOCAL"
    log("\n" + "=" * 72)
    log("[%s] %-14s %s" % (tag, name, desc))
    log("$ " + " ".join(full))
    log("-" * 72)

    t0 = time.time()
    env = dict(os.environ)
    # 子进程默认用 Windows GBK 输出；父进程按 UTF-8 解码会变问号。
    # 统一要求 Python 子进程输出 UTF-8，报告和日志才可读。
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.setdefault("PYTHONUTF8", "1")
    try:
        p = subprocess.run(full, cwd=ROOT, capture_output=True, text=True,
                           timeout=timeout, encoding="utf-8", errors="replace", env=env)
        out, rc = (p.stdout or "") + (p.stderr or ""), p.returncode
        timed_out = False
    except subprocess.TimeoutExpired as e:
        out = ((e.stdout or b"").decode("utf-8", "replace") if isinstance(e.stdout, bytes)
               else (e.stdout or ""))
        rc, timed_out = -1, True

    dur = time.time() - t0
    safe_console(out.rstrip())

    m = PASS_RE.findall(out)
    if m:
        got, total = int(m[-1][0]), int(m[-1][1])
    else:
        got = total = None
    ok = (rc == 0) and not timed_out

    log("-" * 72)
    log("[%s] %s   用时 %.1fs   %s" % (
        "PASS" if ok else "FAIL", name, dur,
        ("%d/%d" % (got, total)) if got is not None else ("超时" if timed_out else "无 PASS 计数")))
    return {"name": name, "live": is_live, "ok": ok, "rc": rc, "got": got, "total": total,
            "dur": dur, "timeout": timed_out}


def main():
    ap = argparse.ArgumentParser(description="一次性跑完全部测试套件（单实例会话）")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--ext", default="ceogmckiinjolbbdkjfelmfcfepccabp")
    ap.add_argument("--live", action="store_true", help="追加真实站点套件（有风控风险）")
    ap.add_argument("--only", default="", help="只跑指定套件，逗号分隔")
    ap.add_argument("--skip", default="", help="跳过指定套件，逗号分隔")
    ap.add_argument("--timeout", type=int, default=480, help="单套件超时秒数")
    ap.add_argument("--close", action="store_true",
                    help="跑完关闭浏览器（默认不关：苏哥要求实例长期在线，下一批直接复用）")
    ap.add_argument("--isolated", action="store_true",
                    help="使用测试专用 profile/端口，不碰 9480 的真实资源库；离线套件专用")
    ap.add_argument("--isolated-port", type=int, default=9490, help="隔离实例调试端口（默认 9490）")
    ap.add_argument("--keep-isolated", action="store_true", help="隔离模式跑完保留测试浏览器")
    ap.add_argument("--reason", default="e2e-all 全量回归")
    a = ap.parse_args()

    only = {s.strip() for s in a.only.split(",") if s.strip()}
    skip = {s.strip() for s in a.skip.split(",") if s.strip()}
    suites = [s for s in SUITES + (LIVE_SUITES if a.live else [])]
    if only:
        suites = [s for s in suites if s[0] in only]
    if skip:
        suites = [s for s in suites if s[0] not in skip]
    if not suites:
        log("没有可跑的套件")
        return 2

    # 1) 闸门：离线隔离模式不碰真实 9480；其它情况走原会话闸门
    log("=" * 72)
    log("批次开始 %s" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    log("套件 %d 个：%s" % (len(suites), ", ".join(s[0] for s in suites)))
    log("=" * 72)
    proc = None
    if a.isolated:
        if a.live:
            log("[中止] --isolated 与 --live 不能同时使用：真实站点需要当前登录态。")
            return 2
        a.port = a.isolated_port
        try:
            proc = start_isolated(a.port)
        except Exception as e:
            log("\n[中止] 隔离实例启动失败：%s" % e)
            return 5
    else:
        rc = subprocess.call([sys.executable, os.path.join(TOOLS, "vr-session.py"),
                              "ensure", "--reason", a.reason])
        if rc != 0:
            log("\n[中止] 会话闸门拒绝启动（rc=%d）。见上方提示，不要绕过。" % rc)
            return rc

    # 2) 串行执行
    results, t_all = [], time.time()
    for i, (name, cmd, is_live, desc) in enumerate(suites, 1):
        if name == "dedup" and not shutil.which("node"):
            log("[跳过] node 不在 PATH，无法跑 dedup 单测")
            results.append({"name": name, "live": False, "ok": False, "rc": None,
                            "got": None, "total": None, "dur": 0, "timeout": False})
            continue
        if i > 1 and is_live:
            gap = random.randint(20, 35)
            log("\n[节流] 真实站点套件前冷却 %ds（降低风控概率）" % gap)
            time.sleep(gap)
        if not port_alive(a.port):
            log("\n[中止] 端口 %d 已离线（浏览器实例退出了），后续套件不再执行。" % a.port)
            log("       诊断：python tools/vr-session.py status，再 ensure --reason 重启一次。")
            results.append({"name": name, "live": is_live, "ok": False, "rc": None,
                            "got": None, "total": None, "dur": 0, "timeout": False,
                            "note": "实例离线"})
            break
        results.append(run_suite(name, cmd, is_live, desc, a.port, a.ext, a.timeout))

    total_dur = time.time() - t_all
    passed = sum(1 for r in results if r["ok"])
    summary = "%d/%d 套件通过，用时 %.1fs" % (passed, len(results), total_dur)

    log("\n" + "=" * 72)
    log("批次汇总：" + summary)
    for r in results:
        cnt = ("%d/%d" % (r["got"], r["total"])) if r["got"] is not None else "-"
        log("  %-6s %-14s %-8s %6.1fs  %s" % (
            "PASS" if r["ok"] else "FAIL", r["name"], cnt, r["dur"],
            r.get("note") or ("超时" if r["timeout"] else "")))
    log("=" * 72)

    # 3) 写报告 + 审计日志
    os.makedirs(REPORT_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M")
    md = os.path.join(REPORT_DIR, "%s-e2e-all.md" % stamp)
    with open(md, "w", encoding="utf-8") as f:
        f.write("# 测试批次 %s\n\n" % stamp)
        f.write("- 结论：%s\n- 启动原因：%s\n- 真实站点套件：%s\n\n"
                % (summary, a.reason, "是" if a.live else "否"))
        f.write("| 套件 | 结果 | 断言 | 用时(s) | 类型 |\n|---|---|---|---|---|\n")
        for r in results:
            f.write("| %s | %s | %s | %.1f | %s |\n" % (
                r["name"], "PASS" if r["ok"] else "FAIL",
                ("%d/%d" % (r["got"], r["total"])) if r["got"] is not None else "-",
                r["dur"], "真实站点" if r["live"] else "本地"))
    log("报告：" + md)

    slog = os.path.join(REPORT_DIR, "session-log.json")
    try:
        with open(slog, "r", encoding="utf-8") as f:
            d = json.load(f)
    except Exception:
        d = {"starts": [], "closes": [], "runs": []}
    d.setdefault("runs", []).append({
        "at": datetime.now().isoformat(timespec="seconds"),
        "summary": summary, "report": os.path.relpath(md, ROOT), "live": a.live,
        "suites": [{"n": r["name"], "ok": r["ok"]} for r in results],
    })
    with open(slog, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)

    # 4) 收尾：隔离实例默认关闭；真实实例默认保留（下次直接复用）
    if a.isolated:
        if a.keep_isolated:
            log("[隔离] 保留测试实例 port=%d（--keep-isolated）" % a.port)
        else:
            log("[隔离] 关闭测试实例 port=%d（真实 9480 未受影响）" % a.port)
            stop_isolated(a.port, proc)
    elif a.close:
        log("[收尾] 按 --close 优雅关闭浏览器")
        subprocess.call([sys.executable, os.path.join(TOOLS, "vr-session.py"), "close"])
    else:
        log("[保持] 浏览器留在线，下一批直接复用（要关请显式 --close 或 vr-session.py close）")

    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
