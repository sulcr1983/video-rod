#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M4 重命名持久化回归：改名 → 重建索引 → 网格/列表/搜索/预览仍用新名。

只改 displayName，不动物理文件；测试结束恢复原显示名。
前置：真实库 9480 在线；建议先 `vr-db-snapshot.py backup`。

用法：python tools/library-rename-e2e.py --port 9480
"""
import argparse
import json
import os
import sys
import time
import urllib.request

from websocket import create_connection

DEFAULT_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"
RESULTS = []


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=8))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=120)
        self.mid = 0

    def send(self, method, params=None, sid=None):
        self.mid += 1
        i = self.mid
        msg = {"id": i, "method": method, "params": params or {}}
        if sid:
            msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == i:
                if "error" in r:
                    raise RuntimeError("%s: %s" % (method, r["error"]))
                return r.get("result", {})

    def ev(self, js, sid):
        r = self.send("Runtime.evaluate", {
            "expression": js, "returnByValue": True, "awaitPromise": True
        }, sid)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__err": ((d.get("exception") or {}).get("description") or d.get("text") or "JS error")[:500]}
        return r.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def check(name, ok, detail=""):
    RESULTS.append({"name": name, "pass": bool(ok), "detail": str(detail)[:300]})
    print(("PASS  " if ok else "FAIL  ") + name + (("  [" + str(detail)[:180] + "]") if not ok else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--ext", default=DEFAULT_EXT)
    ap.add_argument("--json", default="deliverables/test-runs/library-rename-e2e.json")
    a = ap.parse_args()

    c = Cdp(a.port)
    tid = sid = None
    chosen = None
    orig_name = ""
    test_name = "M4改名测试-%d" % int(time.time())
    patched = False
    try:
        tid = c.send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % a.ext})["targetId"]
        sid = c.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        c.send("Runtime.enable", {}, sid)
        c.send("Page.enable", {}, sid)
        c.send("Page.reload", {"ignoreCache": True}, sid)
        time.sleep(4)

        raw = c.ev("VRDB.getAllFiles().then(r=>JSON.stringify(r))", sid)
        if not isinstance(raw, str):
            raise RuntimeError("读取 VRDB 失败：%s" % raw)
        rows = json.loads(raw)
        real = [r for r in rows
                if str(r.get("absPath") or "").replace("\\", "/").lower().startswith(("d:/f/", "d:/fake/")) is False
                and r.get("absPath") and os.path.exists(os.path.normpath(str(r.get("absPath"))))]
        # 优先选有 downloadId 的条目，确保重建索引（downloads 模式）还能扫到它
        real.sort(key=lambda r: 0 if r.get("downloadId") else 1)
        if not real:
            raise RuntimeError("没有可用真实条目")
        chosen = real[0]
        rel = str(chosen.get("relPath"))
        orig_name = str(chosen.get("displayName") or "")
        print("测试条目：%s" % rel)
        print("原显示名：%r → %r" % (orig_name, test_name))

        # 1) 写 displayName
        r = c.ev("VRDB.patchFile(%s,{displayName:%s}).then(x=>JSON.stringify(x||null))" %
                 (json.dumps(rel), json.dumps(test_name)), sid)
        patched = True
        check("写入 displayName", isinstance(r, str) and r != "null", r)

        # 2) 重建索引（downloads 模式，不需要 FSA）
        b = c.ev("VRIndex.build({mode:'downloads'}).then(r=>JSON.stringify(r))", sid)
        check("重建索引成功", isinstance(b, str), b)
        db = c.ev("VRDB.getFile(%s).then(f=>JSON.stringify(f||null))" % json.dumps(rel), sid)
        try:
            row2 = json.loads(db) if isinstance(db, str) else None
        except Exception:
            row2 = None
        check("重建后 displayName 仍在", bool(row2 and row2.get("displayName") == test_name),
              row2.get("displayName") if row2 else db)
        check("重建后 relPath 不变", bool(row2 and row2.get("relPath") == rel),
              row2.get("relPath") if row2 else db)

        # 3) 刷新页面，检查网格/列表/搜索/预览
        c.send("Page.reload", {"ignoreCache": True}, sid)
        time.sleep(5)
        c.ev("""(()=>{const root=[...document.querySelectorAll('#tree .tree-node')].find(n=>!n.dataset.plat&&!n.dataset.author);
          if(root) root.click();
          const s=document.getElementById('search'); if(s){s.value='';s.dispatchEvent(new Event('input',{bubbles:true}));}
          return 1})()""", sid)
        time.sleep(0.8)

        title = c.ev("""(()=>{const c=document.querySelector('#grid .card[data-id="'+CSS.escape(%s)+'"]');
          return c?(c.querySelector('.title')||{}).textContent:''})()""" % json.dumps(rel), sid)
        check("网格卡片显示新名", str(title).strip() == test_name, title)

        # 列表视图（主 app 的 card 结构复用 .title）
        c.ev("""(()=>{const b=[...document.querySelectorAll('#viewToggle button')].find(x=>x.dataset.view==='list');if(b)b.click();return 1})()""", sid)
        time.sleep(0.7)
        title_list = c.ev("""(()=>{const c=document.querySelector('#grid .card[data-id="'+CSS.escape(%s)+'"]');
          return c?(c.querySelector('.title')||{}).textContent:''})()""" % json.dumps(rel), sid)
        check("列表视图显示新名", str(title_list).strip() == test_name, title_list)
        c.ev("""(()=>{const b=[...document.querySelectorAll('#viewToggle button')].find(x=>x.dataset.view==='grid');if(b)b.click();return 1})()""", sid)
        time.sleep(0.5)

        # 搜索新名
        cnt = c.ev("""(()=>{const s=document.getElementById('search');s.value=%s;
          s.dispatchEvent(new Event('input',{bubbles:true}));
          return document.querySelectorAll('#grid .card').length})()""" % json.dumps(test_name), sid)
        check("搜索能找到新名", isinstance(cnt, int) and cnt >= 1, cnt)
        c.ev("""(()=>{const s=document.getElementById('search');s.value='';s.dispatchEvent(new Event('input',{bubbles:true}));return 1})()""", sid)
        time.sleep(0.5)

        # 预览标题
        c.ev("""(()=>{const c=document.querySelector('#grid .card[data-id="'+CSS.escape(%s)+'"]');if(c)c.click();return 1})()""" % json.dumps(rel), sid)
        time.sleep(1.4)
        pv = c.ev("(document.getElementById('pvTitle')||{}).textContent||''", sid)
        check("预览标题显示新名", str(pv).strip() == test_name, pv)
        c.ev("""(()=>{const b=document.getElementById('pvClose');if(b)b.click();return 1})()""", sid)
        time.sleep(0.5)

        # 4) 恢复原显示名
        r2 = c.ev("VRDB.patchFile(%s,{displayName:%s}).then(x=>JSON.stringify(x||null))" %
                  (json.dumps(rel), json.dumps(orig_name)), sid)
        patched = False
        c.ev("VRIndex.build({mode:'downloads'}).then(r=>JSON.stringify(r))", sid)
        c.send("Page.reload", {"ignoreCache": True}, sid)
        time.sleep(4)
        restored = c.ev("VRDB.getFile(%s).then(f=>JSON.stringify(f||null))" % json.dumps(rel), sid)
        try:
            row3 = json.loads(restored) if isinstance(restored, str) else None
        except Exception:
            row3 = None
        check("恢复原显示名", bool(row3 and (row3.get("displayName") or "") == orig_name),
              (row3 or {}).get("displayName", restored))

        failed = [x for x in RESULTS if not x["pass"]]
        print("\n%d/%d PASS" % (len(RESULTS) - len(failed), len(RESULTS)))
        try:
            os.makedirs(os.path.dirname(a.json), exist_ok=True)
            with open(a.json, "w", encoding="utf-8") as f:
                json.dump(RESULTS, f, ensure_ascii=False, indent=1)
            print("明细：%s" % a.json)
        except Exception as e:
            print("写明细失败：%s" % e)
        return 0 if not failed else 1
    finally:
        # 失败/异常也要恢复，避免测试名留在真实库
        try:
            if patched and chosen:
                c.ev("VRDB.patchFile(%s,{displayName:%s})" %
                     (json.dumps(str(chosen.get("relPath"))), json.dumps(orig_name)), sid)
                c.ev("VRIndex.build({mode:'downloads'})", sid)
        except Exception:
            pass
        try:
            if tid:
                c.send("Target.closeTarget", {"targetId": tid})
        except Exception:
            pass
        c.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print("[失败] %s" % e)
        sys.exit(2)
