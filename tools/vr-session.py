# -*- coding: utf-8 -*-
"""vr-session · 测试浏览器「单实例会话闸门」（风控控制）

背景（苏哥 2026-11-05）：
    之前每跑一个测试脚本就起一次、关一次浏览器，抖音/小红书等站点把
    「短时间内反复新建设备」判定为异常，触发风控。现在改成：
    一次会话把所有套件跑完，中途只开标签不重启进程。

铁律（本工具强制执行）：
    EL-01 同一时刻只允许一个测试浏览器实例（固定端口 9480 / 固定 profile）。
    EL-02 两次「启动」之间必须有冷却期（默认 240 秒），冷却内直接拒绝。
    EL-03 每日启动上限（默认 6 次），超限直接拒绝，要求合并测试批次。
    EL-04 每次启动都记档（时间/原因/启动次数），日志可审计。
    EL-05 关闭只走优雅关闭（Browser.close），保证 Cookie 落盘。

用法：
    python tools/vr-session.py ensure --reason "全量回归"
    python tools/vr-session.py status
    python tools/vr-session.py close
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
EDGE_ALT = r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
PROFILE = r"D:\test\download\.edge-login-profile"
EXT = ROOT
PORT = 9480

COOLDOWN_SEC = 240          # EL-02 两次启动最小间隔
MAX_STARTS_PER_DAY = 6      # EL-03 每日启动上限
BOOT_TIMEOUT_SEC = 40

LOG_DIR = os.path.join(ROOT, "deliverables", "test-runs")
LOG_FILE = os.path.join(LOG_DIR, "session-log.json")

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


# ---------------------------------------------------------------- 基础工具
def port_alive(port=PORT, timeout=2.0):
    try:
        v = json.load(_opener.open("http://127.0.0.1:%d/json/version" % port, timeout=timeout))
        return v
    except Exception:
        return None


def edge_exe():
    for p in (EDGE, EDGE_ALT):
        if os.path.exists(p):
            return p
    return None


def load_log():
    if not os.path.exists(LOG_FILE):
        return {"starts": [], "closes": [], "runs": []}
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            d = json.load(f)
        d.setdefault("starts", [])
        d.setdefault("closes", [])
        d.setdefault("runs", [])
        return d
    except Exception:
        return {"starts": [], "closes": [], "runs": []}


def save_log(d):
    os.makedirs(LOG_DIR, exist_ok=True)
    tmp = LOG_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    os.replace(tmp, LOG_FILE)


def today_starts(d):
    t = date.today().isoformat()
    return [s for s in d["starts"] if s.get("at", "").startswith(t)]


def fmt_ago(seconds):
    seconds = int(seconds)
    if seconds < 60:
        return "%d 秒" % seconds
    return "%d 分 %d 秒" % (seconds // 60, seconds % 60)


# ---------------------------------------------------------------- 命令
def cmd_status(_a):
    v = port_alive()
    d = load_log()
    ts = today_starts(d)
    last = d["starts"][-1] if d["starts"] else None
    print("实例状态 : " + ("在线 %s / %s" % (v.get("Browser"), v.get("webSocketDebuggerUrl", "")[-8:])
                          if v else "未启动"))
    print("调试端口 : %d" % PORT)
    print("今日启动 : %d / %d 次" % (len(ts), MAX_STARTS_PER_DAY))
    if last:
        ago = time.time() - last.get("ts", 0)
        print("上次启动 : %s（%s前，原因：%s）"
              % (last.get("at", "?"), fmt_ago(ago), last.get("reason", "-")))
        if not v:
            cd = COOLDOWN_SEC - ago
            print("冷却剩余 : " + (fmt_ago(cd) if cd > 0 else "已过冷却，可启动"))
    if d["runs"]:
        r = d["runs"][-1]
        print("上次批次 : %s  %s" % (r.get("at", "?"), r.get("summary", "")))
    return 0


def cmd_ensure(a):
    v = port_alive()
    if v:
        print("[复用] 端口 %d 已有实例在线（%s），不新开 —— 符合 EL-01" % (PORT, v.get("Browser")))
        return 0

    d = load_log()
    ts = today_starts(d)

    # EL-02 冷却
    if d["starts"]:
        last = d["starts"][-1]
        ago = time.time() - last.get("ts", 0)
        if ago < COOLDOWN_SEC:
            print("[拒绝] EL-02 冷却未过：距上次启动仅 %s，需等 %s"
                  % (fmt_ago(ago), fmt_ago(COOLDOWN_SEC - ago)))
            print("       原因：频繁重启浏览器会被站点判定设备异常（风控）。")
            print("       做法：把要测的套件合并到同一批次，一次开完。")
            return 3

    # EL-03 日配额
    if len(ts) >= MAX_STARTS_PER_DAY:
        print("[拒绝] EL-03 今日已启动 %d 次（上限 %d），不再新开。" % (len(ts), MAX_STARTS_PER_DAY))
        print("       做法：等待冷却或改天，中间用 tools/e2e-all.py 复用同一实例。")
        return 4

    exe = edge_exe()
    if not exe:
        print("[失败] 找不到 Edge：%s" % EDGE)
        return 5
    if not os.path.isdir(PROFILE):
        print("[失败] 登录态 profile 不存在：%s（不得新建，见 TEST-BROWSER 铁律）" % PROFILE)
        return 6

    args = [
        "--user-data-dir=%s" % PROFILE,
        "--disable-extensions-except=%s" % EXT,
        "--load-extension=%s" % EXT,
        "--remote-debugging-port=%d" % PORT,
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1600,1000",
    ]
    if a.headless:
        args.append("--headless=new")

    # 拉起方式（重要）：
    #   Python Popen(DETACHED_PROCESS) / PowerShell Start-Process 起出来的实例，
    #   都会在调用方退出后约 30-60 秒被 job object 一并回收（实测 2026-11-05：
    #   14:50 与 14:54 两次启动，均在本条命令结束后 1 分钟内消失）。
    #   改用 WMI Win32_Process.Create —— 父进程是 WmiPrvSE 服务，不在调用方的
    #   job 里，才能真正跨命令常驻，做到「开一次、测一整天」。
    cmdline = " ".join(['"%s"' % exe] + args)

    def pq(s):
        return "'" + s.replace("'", "''") + "'"

    ps = (
        "$ErrorActionPreference='Stop';"
        "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create "
        "-Arguments @{ CommandLine = %s; CurrentDirectory = %s };"
        "if ($r.ReturnValue -ne 0) { Write-Output ('WMIFAIL:' + $r.ReturnValue); exit 2 };"
        "Write-Output ('WMIPID:' + $r.ProcessId)"
    ) % (pq(cmdline), pq(os.path.dirname(exe)))

    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                        "-Command", ps], capture_output=True, text=True, timeout=60)
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode != 0 or "WMIFAIL" in out:
        print("[失败] 拉起 Edge 失败：" + out.strip()[:300])
        return 8
    pid = ""
    for line in out.splitlines():
        if line.startswith("WMIPID:"):
            pid = line.split(":", 1)[1].strip()
    print("[拉起] Edge 进程 pid=%s（WMI 方式，脱离调用方 job）" % (pid or "?"))

    rec = {"at": datetime.now().isoformat(timespec="seconds"), "ts": time.time(),
           "reason": a.reason or "未注明", "headless": bool(a.headless)}
    d["starts"].append(rec)
    save_log(d)

    # 等端口
    v = None
    for _ in range(BOOT_TIMEOUT_SEC * 2):
        time.sleep(0.5)
        v = port_alive(timeout=1)
        if v:
            break
    if not v:
        print("[警告] 已拉起进程但 %d 秒内端口未监听 —— 可能有其它 Edge 占用了同一 profile。"
              % BOOT_TIMEOUT_SEC)
        return 7

    # 稳定性复核：等 10 秒再查一次，避免「起来了又闪退」被误认为可用
    time.sleep(10)
    if not port_alive(timeout=2):
        print("[警告] 实例起来后在 10 秒内退出（不稳定），请检查 profile 是否被占用。")
        return 9

    print("[启动] %s 在线且稳定，端口 %d（今日第 %d 次启动，原因：%s）"
          % (v.get("Browser"), PORT, len(today_starts(load_log())), rec["reason"]))
    return 0


def cmd_close(_a):
    v = port_alive()
    if not v:
        print("[关闭] 端口未在线，无需关闭")
        return 0
    rc = subprocess.call([sys.executable, os.path.join(ROOT, "tools", "test-browser-close.py"),
                          "--port", str(PORT)])
    d = load_log()
    d["closes"].append({"at": datetime.now().isoformat(timespec="seconds"), "ts": time.time()})
    save_log(d)
    return rc


def main():
    ap = argparse.ArgumentParser(description="测试浏览器单实例会话闸门（风控控制）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("ensure", help="确保有实例在线（优先复用，必要时经冷却/配额校验后启动一次）")
    p.add_argument("--reason", default="", help="本次启动原因（写入审计日志）")
    p.add_argument("--headless", action="store_true")
    p.set_defaults(func=cmd_ensure)

    p = sub.add_parser("status", help="查看实例与启动配额")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("close", help="优雅关闭（保 Cookie）")
    p.set_defaults(func=cmd_close)

    a = ap.parse_args()
    return a.func(a)


if __name__ == "__main__":
    sys.exit(main())
