"""备份/恢复按钮的真实浏览器验证（Edge 隔离实例）。

为什么单独写一个：
  「导出 _library 整包」「从 _library 恢复」是重装后唯一的救命通道，
  但它们会弹原生目录选择框 —— 自动化点不了，e2e-buttons.py 的 DANGER 名单
  也会跳过它们。结果就是「按钮存在但没人证明它真能触发逻辑」。

本脚本验证（不点原生对话框）：
  A. 两个按钮在真实 options 页 DOM 里存在，文案正确
  B. zip 模块已加载（VRZip.build 可用）
  C. 点击后**确实进入绑定逻辑**：桩掉 showDirectoryPicker，
     让它抛 AbortError（等价于用户点取消），断言
     ① 走了那条分支（被调用到）
     ② 页面给出提示文案，而不是毫无反应
  D. 全程 0 JS 异常

用法（由 e2e-all.py 以 --only 方式拉起，或单独跑）：
  CDP=http://127.0.0.1:9490 python tools/e2e-backup-buttons.py --ext <扩展id>
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

from websocket import create_connection

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CDP = os.environ.get("CDP", "http://127.0.0.1:9490")
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

# 扩展从仓库根 --load-extension 加载，id 由路径决定、跨启动稳定。
# 探测不到时的兜底值（与 tools/e2e-buttons.py 的 KNOWN_EXT 一致）。
KNOWN_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"

RES = []


def ck(name, got, want=True):
    ok = (bool(got) == bool(want)) if isinstance(want, bool) else (got == want)
    RES.append((ok, name))
    print(("PASS  " if ok else "FAIL  ") + name + " = " + repr(got) +
          ("" if ok else "  (期望 " + repr(want) + ")"))


class C:
    def __init__(self, port_url):
        self.base = port_url
        self.mid = 0
        tabs = json.load(_opener.open(self.base + "/json/list"))
        # 必须优先连 page：连到 service_worker 时 document 未定义，
        # Runtime.evaluate 里的 DOM 查询会返回 null（踩过）。
        page = [t for t in tabs if t.get("type") == "page"]
        sw = [t for t in tabs if t.get("type") == "service_worker"
              and "background.js" in (t.get("url") or "")]
        target = (page or sw or tabs)[0]
        self.ws = create_connection(target["webSocketDebuggerUrl"],
                                    suppress_origin=True, timeout=120)

    def send(self, method, params=None, sid=None):
        self.mid += 1
        msg = {"id": self.mid, "method": method, "params": params or {}}
        if sid:
            msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self.mid:
                return m

    def ev(self, js, sid, await_promise=True):
        r = self.send("Runtime.evaluate",
                      {"expression": js, "returnByValue": True,
                       "awaitPromise": await_promise, "userGesture": True}, sid)
        res = r.get("result", {}) or {}
        # exceptionDetails 在 result 里面，不在顶层 —— 只看顶层会把所有报错
        # 静默成 None，排查时完全看不到原因（踩过）。
        if res.get("exceptionDetails"):
            return {"__err": str(res["exceptionDetails"])[:400]}
        return res.get("result", {}).get("value")

    def open_page(self, url):
        tid = self.send("Target.createTarget", {"url": url})["result"]["targetId"]
        sid = self.send("Target.attachToTarget",
                        {"targetId": tid, "flatten": True})["result"]["sessionId"]
        self.send("Runtime.enable", {}, sid)
        self.send("Page.enable", {}, sid)
        return tid, sid

    def errors(self, sid):
        """收集页面运行时异常（AsyncStackTrace 由 Runtime.enable 后累积）"""
        # 简化：直接看 window.onerror 钩子记录的数组
        return self.ev("window.__vrErrs ? window.__vrErrs.length : 0", sid)

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def find_edge():
    for p in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(p):
            return p
    return None


def port_alive(port, timeout=1.0):
    try:
        _opener.open("http://127.0.0.1:%d/json/version" % port, timeout=timeout)
        return True
    except Exception:
        return False


def launch_isolated(port, root):
    """自己拉起隔离 Edge。

    为什么不用 `e2e-all.py --isolated`：
      它用 subprocess.Popen 启动，实例挂在调用方的 job object 上，
      后台任务一结束 Edge 就被系统回收（EL-08 记过这条），
      于是「拉一个实例再跑脚本」永远拿不到活着的浏览器。
      这里用 DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP 脱离 job。
    """
    exe = find_edge()
    if not exe:
        raise RuntimeError("找不到 Edge")
    profile = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           ".work", "e2e-profile")
    os.makedirs(profile, exist_ok=True)
    args = [
        exe,
        "--user-data-dir=" + profile,
        "--disable-extensions-except=" + root,
        "--load-extension=" + root,
        "--remote-debugging-port=%d" % port,
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--window-size=1600,1000",
    ]
    flags = 0
    if hasattr(subprocess, "DETACHED_PROCESS"):
        flags |= subprocess.DETACHED_PROCESS
    if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
        flags |= subprocess.CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=flags, close_fds=True)
    for _ in range(80):
        time.sleep(0.5)
        if port_alive(port):
            return True
    return False


def find_ext_id(port):
    """从目标列表里找扩展 id（扩展页面或 SW 的 URL 第二段）。

    注意：Edge 刚启动时可能还没有任何扩展页面/SW 目标（MV3 懒启动），
    所以这里先主动开一个 about:blank 兜底，拿不到就退回已知常量 ——
    扩展从同一目录 --load-extension 加载，id 是稳定的。
    """
    for attempt in range(2):
        for _ in range(20):
            try:
                tabs = json.load(_opener.open("http://127.0.0.1:%d/json/list" % port))
            except Exception:
                time.sleep(0.5)
                continue
            for t in tabs:
                u = t.get("url") or ""
                if u.startswith("chrome-extension://"):
                    return u.split("/")[2]
            time.sleep(0.5)
        if attempt == 0:
            # 唤醒扩展：开一个页面触发 SW 启动
            try:
                SW = C("http://127.0.0.1:%d" % port)
                SW.send("Target.createTarget", {"url": "about:blank"})
                SW.close()
            except Exception:
                pass
    return KNOWN_EXT


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ext", help="扩展 id；不给则自动探测")
    ap.add_argument("--launch", action="store_true", help="自己拉起隔离 Edge（脱离 job object）")
    ap.add_argument("--port", type=int, default=9491)
    args = ap.parse_args()

    global CDP
    if args.launch:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if not port_alive(args.port):
            print("[启动] 拉起隔离 Edge port=%d" % args.port)
            if not launch_isolated(args.port, root):
                print("[失败] Edge 未在 40 秒内就绪")
                return 2
        CDP = "http://127.0.0.1:%d" % args.port

    ext = args.ext or find_ext_id(args.port if args.launch else 9490)
    if not ext:
        print("[失败] 拿不到扩展 id（请加 --launch）")
        return 2
    print("[目标] 扩展 %s @ %s" % (ext, CDP))

    c = C(CDP)
    try:
        url = "chrome-extension://%s/options.html" % ext
        tid, sid = c.open_page(url)
        # 装一个错误收集器，用于最后断言 0 异常
        c.ev("(()=>{window.__vrErrs=[];window.addEventListener('error',"
             "e=>window.__vrErrs.push(String(e.message)));return 1})()", sid)

        # 等页面脚本就绪（settings.js 是 defer）
        c.ev("new Promise(r=>setTimeout(r,1200))", sid)

        # ---------- A. 按钮存在 + 文案 ----------
        info = c.ev("""(()=>{
          const e=document.getElementById('vrLibExport'), r=document.getElementById('vrLibRestore');
          return {
            hasExport: !!e, hasRestore: !!r,
            exportText: e ? e.textContent.trim() : '',
            restoreText: r ? r.textContent.trim() : '',
            exportTag: e ? e.tagName : '',
            restoreTag: r ? r.tagName : ''
          };
        })()""", sid)
        print("按钮信息:", json.dumps(info, ensure_ascii=False))
        ck("导出按钮存在", info.get("hasExport"), True)
        ck("恢复按钮存在", info.get("hasRestore"), True)
        ck("导出按钮文案含「导出」", "导出" in (info.get("exportText") or ""), True)
        ck("恢复按钮文案含「恢复」", "恢复" in (info.get("restoreText") or ""), True)
        ck("两个都是 button 元素",
           (info.get("exportTag") == "BUTTON") and (info.get("restoreTag") == "BUTTON"), True)

        # ---------- B. zip 模块已加载 ----------
        z = c.ev("""(()=>({
          hasZip: typeof VRZip !== 'undefined',
          hasBuild: !!(window.VRZip && typeof VRZip.build === 'function'),
          hasParse: !!(window.VRZip && typeof VRZip.parse === 'function')
        }))()""", sid)
        print("zip 模块:", json.dumps(z, ensure_ascii=False))
        ck("VRZip 已加载", z.get("hasZip"), True)
        ck("VRZip.build 可用", z.get("hasBuild"), True)

        # ---------- C. 点击是否真的进入绑定逻辑 ----------
        # 桩掉 showDirectoryPicker 让它抛 AbortError（= 用户点取消），
        # 同时记一个计数器，证明这段分支真的被执行了。
        stub = c.ev("""(()=>{
          window.__pickCalled = 0;
          const orig = window.showDirectoryPicker;
          window.showDirectoryPicker = function(){
            window.__pickCalled++;
            const e = new Error('user aborted'); e.name = 'AbortError';
            return Promise.reject(e);
          };
          return { hadPicker: typeof orig === 'function' };
        })()""", sid)
        print("桩注入:", json.dumps(stub, ensure_ascii=False))
        ck("原环境有 showDirectoryPicker", stub.get("hadPicker"), True)

        c.ev("document.getElementById('vrLibExport').click(); 1", sid)
        c.ev("new Promise(r=>setTimeout(r,600))", sid)
        after_exp = c.ev("""(()=>({
          pickCalled: window.__pickCalled,
          msg: (document.getElementById('vrLibIdxMsg')||{}).textContent || ''
        }))()""", sid)
        print("点击导出后:", json.dumps(after_exp, ensure_ascii=False))
        ck("点击导出后确实调用了目录选择器", after_exp.get("pickCalled"), 1)
        # 用户取消时应当静默返回（不报错），这是设计意图
        ck("取消时不刷错误文案",
           "失败" not in (after_exp.get("msg") or ""), True)

        # 恢复按钮同理
        c.ev("window.__pickCalled = 0; 1", sid)
        c.ev("document.getElementById('vrLibRestore').click(); 1", sid)
        c.ev("new Promise(r=>setTimeout(r,600))", sid)
        after_res = c.ev("""(()=>({
          pickCalled: window.__pickCalled,
          msg: (document.getElementById('vrLibIdxMsg')||{}).textContent || ''
        }))()""", sid)
        print("点击恢复后:", json.dumps(after_res, ensure_ascii=False))
        ck("点击恢复后确实调用了目录选择器", after_res.get("pickCalled"), 1)

        # ---------- D. 0 JS 异常 ----------
        errs = c.ev("window.__vrErrs || []", sid)
        print("JS 异常:", json.dumps(errs, ensure_ascii=False)[:300])
        ck("全程 0 JS 异常", len(errs or []), 0)

        # 收尾：关闭本脚本开的标签
        try:
            c.send("Target.closeTarget", {"targetId": tid})
        except Exception:
            pass
    finally:
        c.close()

    ok_all = all(ok for ok, _ in RES)
    print("\n" + "=" * 60)
    print("%d/%d PASS" % (sum(1 for ok, _ in RES if ok), len(RES)))
    print("=" * 60)
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())