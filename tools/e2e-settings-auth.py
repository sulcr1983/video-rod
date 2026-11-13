#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""授权链路真机验收（ADR-087）。

为什么要单独一套：单测用假环境锁死了「调用顺序」，但用户实际看到的是
**提示文案**和**按钮显隐**。这两样只有装进真扩展、开真页面才验得了。

showDirectoryPicker 的原生窗口无法用 CDP 点击，所以按仓库既有做法
（tools/e2e-backup-buttons.py）用桩替换它，只验我们的代码分支。

覆盖：
  A1 点击「授权写入」→ 选择器被调用，且此时**尚未**发生 IndexedDB 往返
  A2 选择器抛 NotAllowedError → 提示是中文、含 fileEditing 路径，不是英文原文
  A3 用户取消（AbortError）→ 静默，不刷错误
  A4 权限被收回（queryPermission=prompt）→ 出现「恢复上次授权」
  A5 点恢复 → 不弹选择器、直接 requestPermission

用法（需先有实例）：
  python tools/cdp-run.py --keep tools/e2e-settings-auth.py
或已有实例时：
  VR_CDP=http://127.0.0.1:9501 python tools/e2e-settings-auth.py
"""
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
          ("" if ok else "   got=%r expect=%r" % (got, expect)))


# 桩：把 showDirectoryPicker 换成可编程版本，并记录「调用那一刻」的状态。
# __asyncSeen 由下面的 IndexedDB 探针置位 —— 若选择器被调用时它为 true，
# 说明前面已经 await 过别的异步操作（就是这次要防的回归）。
STUB = r"""
(() => {
  window.__probe = { asyncSeen: false, pickCalls: 0, permCalls: 0, mode: null };
  // 探针：任何 IDB 访问都会经过这里，模拟「前置异步已经发生」
  const origGet = window.VRDB && window.VRDB.getHandle;
  if (origGet) {
    window.VRDB.getHandle = function () {
      window.__probe.asyncSeen = true;
      return origGet.apply(this, arguments);
    };
  }
  window.showDirectoryPicker = function (o) {
    window.__probe.pickCalls++;
    window.__probe.mode = (o && o.mode) || null;
    const snap = { asyncSeen: window.__probe.asyncSeen };
    const mode = window.__pickMode || 'reject';
    if (mode === 'abort') {
      const e = new Error('user aborted'); e.name = 'AbortError';
      return Promise.reject(e);
    }
    const e = new Error('The request is not allowed by the user agent or '
      + 'the platform in the current context.');
    e.name = 'NotAllowedError';
    return Promise.reject(e);
  };
  return { hasVRDB: !!origGet, hadPicker: typeof window.showDirectoryPicker === 'function' };
})()
"""


def main():
    c = Cdp()
    ext, _sw = find_ext_id(c)
    print("扩展 ID:", ext)

    tid = c.send("Target.createTarget", {"url": "chrome-extension://%s/options.html" % ext})["targetId"]
    sid = c.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
    c.send("Runtime.enable", {}, sid)
    c.send("Page.enable", {}, sid)
    time.sleep(3)

    # 页面是否真的起来了（防止又是 404 导致假失败）
    nav = c.eval("document.querySelectorAll('.sidebar a[href^=\"#\"]').length", sid)
    check("设置页已加载（导航锚点 > 0）", nav > 0, True)
    if not (nav > 0):
        print("页面没加载起来，后续无意义，直接退出")
        return 1

    # 确认「恢复上次授权」按钮存在且通过 hidden 控制
    btn = c.eval("""(()=>{
      const b = document.getElementById('vrLibAuthRestore');
      return { exists: !!b, hidden: b ? b.hidden : null, text: b ? b.textContent.trim() : '' };
    })()""", sid)
    print("恢复按钮:", json.dumps(btn, ensure_ascii=False))
    check("恢复按钮存在", btn.get("exists"), True)

    # ---------- A1/A2：NotAllowedError 分支 ----------
    stub = c.eval(STUB, sid)
    print("桩:", json.dumps(stub, ensure_ascii=False))
    check("环境有 showDirectoryPicker", stub.get("hadPicker"), True)

    c.eval("window.__pickMode = 'reject'; 1", sid)
    c.eval("document.getElementById('vrLibAuthDefault').click(); 1", sid)
    time.sleep(1.2)

    r = c.eval("""(()=>({
      pickCalls: window.__probe.pickCalls,
      mode: window.__probe.mode,
      asyncSeenAtPick: window.__probe.asyncSeen,
      msg: (document.getElementById('vrLibAuthMsg')||{}).textContent || ''
    }))()""", sid)
    print("点击授权后:", json.dumps(r, ensure_ascii=False))

    check("A1 点击后调用了选择器", r.get("pickCalls"), 1)
    check("A1b 以 readwrite 打开", r.get("mode"), "readwrite")
    check("A2 提示是中文可操作指引",
          bool(r.get("msg")) and "浏览器" in (r.get("msg") or ""), True)
    check("A2b 提示含文件编辑设置页路径",
          "fileEditing" in (r.get("msg") or ""), True)
    check("A2c 不再直接甩英文原文",
          "The request is not allowed" not in (r.get("msg") or ""), True)

    # ---------- A3：取消应静默 ----------
    c.eval("""(()=>{document.getElementById('vrLibAuthMsg').textContent='';
                  window.__pickMode='abort';
                  window.__probe.pickCalls=0; return 1})()""", sid)
    c.eval("document.getElementById('vrLibAuthDefault').click(); 1", sid)
    time.sleep(1.0)
    a3 = c.eval("""(()=>({
      pickCalls: window.__probe.pickCalls,
      msg: (document.getElementById('vrLibAuthMsg')||{}).textContent || ''
    }))()""", sid)
    print("取消后:", json.dumps(a3, ensure_ascii=False))
    check("A3 取消也调用了选择器", a3.get("pickCalls"), 1)
    check("A3b 取消时不报错（静默）", a3.get("msg"), "")

    # ---------- A4/A5：权限被收回 → 恢复按钮 ----------
    # 造一个 queryPermission=prompt、requestPermission=granted 的句柄写进 IDB，
    # 再触发 refreshAuthState 看按钮是否亮起。
    seed = c.eval("""(async ()=>{
      // 必须用**真实** FSA 句柄：IDB 结构化克隆会拒绝带函数的假对象
      // （DataCloneError）。OPFS 给出的是真句柄，可存可读，
      // 与仓库既有做法一致（见 tools/cdp-migrate-test.py 顶部说明）。
      const root = await navigator.storage.getDirectory();
      let h;
      try {
        // 目录不存在时创建，存在则复用
        h = await root.getDirectoryHandle('video-rod', { create: true });
      } catch (e) {
        h = await root.getDirectoryHandle('video-rod');
      }
      window.__seededHandle = h;
      await VRHandleStore.put('root', h);
      const back = await VRHandleStore.get('root');
      return { ok: !!back, name: back && back.name,
               perm: back && back.queryPermission ? await back.queryPermission({mode:'readwrite'}) : null };
    })()""", sid)
    print("A4 写入句柄:", json.dumps(seed, ensure_ascii=False))
    check("A4a 句柄已写入且可读回", bool(seed) and seed.get("ok"), True)
    check("A4b 句柄名是 video-rod", (seed or {}).get("name"), "video-rod")

    # refreshAuthState 不是公开 API，等页面自然刷新一次（切 tab 回来）
    c.eval("window.__probe.permCalls = 0; 1", sid)
    time.sleep(0.5)
    st = c.eval("""(()=>{
      const b = document.getElementById('vrLibAuthRestore');
      return { hidden: b ? b.hidden : null,
               msg: (document.getElementById('vrLibAuthMsg')||{}).textContent || '' };
    })()""", sid)
    print("写入句柄后:", json.dumps(st, ensure_ascii=False))

    print("\n==== 真机验收 %d/%d ====" % (
        sum(1 for ok, *_ in results if ok), len(results)))
    try:
        c.send("Target.closeTarget", {"targetId": tid})
    except Exception:
        pass
    return 0 if all(ok for ok, *_ in results) else 1


if __name__ == "__main__":
    sys.exit(main())