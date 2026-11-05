#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""真实数据回归：用当前真实资源库验证排序、卡片数、文件存在性。

原则：
  - 只读，不改 DB、不改文件、不移动/删除；
  - 只用真实条目（排除 D:/f/、D:/fake/ 测试夹具）；
  - 排序断言看“输入→输出”，不是“点了没报错”。

用法：python tools/library-realdata-e2e.py --port 9480
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime

from websocket import create_connection

DEFAULT_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"
RESULTS = []


class Cdp(object):
    def __init__(self, port):
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=8))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=90)
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

    def ev(self, js, sid, await_promise=True):
        r = self.send("Runtime.evaluate", {
            "expression": js, "returnByValue": True, "awaitPromise": await_promise
        }, sid)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            return {"__err": ((d.get("exception") or {}).get("description") or d.get("text") or "JS error")[:400]}
        return r.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def check(name, ok, detail=""):
    RESULTS.append({"name": name, "pass": bool(ok), "detail": str(detail)[:300]})
    print(("PASS  " if ok else "FAIL  ") + name + (("  [" + str(detail)[:180] + "]") if not ok else ""))


def is_fixture(row):
    p = str((row or {}).get("absPath") or "").replace("\\", "/").lower()
    return p.startswith("d:/f/") or p.startswith("d:/fake/")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--ext", default=DEFAULT_EXT)
    ap.add_argument("--json", default="deliverables/test-runs/library-realdata-e2e.json")
    a = ap.parse_args()

    c = Cdp(a.port)
    tid = sid = None
    try:
        tid = c.send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % a.ext})["targetId"]
        sid = c.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        c.send("Runtime.enable", {}, sid)
        c.send("Page.enable", {}, sid)
        c.send("Emulation.setDeviceMetricsOverride",
               {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False}, sid)

        # 忽略缓存，确保拿到刚改过的 app.js
        c.send("Page.reload", {"ignoreCache": True}, sid)
        time.sleep(4)
        for _ in range(20):
            boot = c.ev("window.__vrBoot || []", sid, False)
            if isinstance(boot, list) and any(str(x).startswith("load:") for x in boot):
                break
            time.sleep(0.5)

        rows_raw = c.ev(
            "VRDB.getAllFiles().then(r=>JSON.stringify(r))", sid)
        if not isinstance(rows_raw, str):
            raise RuntimeError("读取 VRDB 失败：%s" % rows_raw)
        all_rows = json.loads(rows_raw)
        real = [r for r in all_rows if not is_fixture(r) and r.get("absPath")]
        fixtures = [r for r in all_rows if is_fixture(r)]
        print("真实条目 %d / 测试假数据 %d / 总 %d" % (len(real), len(fixtures), len(all_rows)))
        check("真实库无测试假数据", len(fixtures) == 0, "fixtures=%d" % len(fixtures))
        check("真实条目 > 0", len(real) > 0, "real=%d" % len(real))

        # Python 侧核对真实文件存在
        missing = [r.get("relPath") for r in real if not os.path.exists(os.path.normpath(str(r.get("absPath") or "")))]
        check("真实文件全部存在", len(missing) == 0, "missing=%s" % missing[:5])

        # 复位筛选：根节点 + 清搜索 + 全部类型/平台
        c.ev("""(()=>{
          const root=[...document.querySelectorAll('#tree .tree-node')].find(n=>!n.dataset.plat&&!n.dataset.author);
          if(root) root.click();
          const s=document.getElementById('search'); if(s){s.value='';s.dispatchEvent(new Event('input',{bubbles:true}));}
          const t=[...document.querySelectorAll('#typeTabs button')].find(b=>b.dataset.type==='all'); if(t)t.click();
          const p=[...document.querySelectorAll('#chips .chip')].find(b=>b.dataset.plat==='all'); if(p)p.click();
          return 1;
        })()""", sid)
        time.sleep(1.0)
        cards = c.ev("document.querySelectorAll('#grid .card').length", sid, False)
        check("卡片数=真实条目数（筛选已复位）", cards == len(real), "cards=%s real=%s" % (cards, len(real)))

        # 安装错误收集
        c.ev("""(()=>{window.__vrRealErrs=[];window.addEventListener('error',e=>window.__vrRealErrs.push(String(e.message)));
          window.addEventListener('unhandledrejection',e=>window.__vrRealErrs.push('rej:'+String(e.reason)));return 1})()""", sid)

        def set_sort(mode):
            c.ev("""(()=>{const s=document.getElementById('sort');s.value=%s;
              s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()""" % json.dumps(mode), sid)
            time.sleep(0.7)

        def order():
            raw = c.ev("""(()=>{const cards=[...document.querySelectorAll('#grid .card')];
              return JSON.stringify(cards.map(c=>({id:c.dataset.id,title:(c.querySelector('.title')||{}).textContent||''})))})()""", sid)
            return json.loads(raw) if isinstance(raw, str) else []

        def monotonic(seq, desc=True):
            vals = [x for x in seq if x is not None]
            return all((vals[i] >= vals[i + 1]) if desc else (vals[i] <= vals[i + 1]) for i in range(len(vals) - 1))

        def saved_at(ms):
            # 和 app.js 的 fmtDate 完全一致：截断到分钟；同分钟由 relPath 兜底。
            try:
                return datetime.fromtimestamp(float(ms) / 1000.0).strftime("%Y-%m-%d %H:%M")
            except Exception:
                return ""

        # 用 relPath 映射 mtime / size
        by_rel = {str(r.get("relPath")): r for r in real}
        orders = {}
        for mode in ("new", "old", "size", "name"):
            set_sort(mode)
            o = order()
            orders[mode] = [x["id"] for x in o]
            check("排序 %s：卡片未丢" % mode, len(o) == len(real), "got=%d want=%d" % (len(o), len(real)))
            if mode in ("new", "old"):
                # 与 app.js 一致：排序键是 fmtDate(mtime)（分钟精度），不是原始毫秒。
                seq = [saved_at(by_rel.get(x["id"], {}).get("mtime")) for x in o]
                check("排序 %s：时间单调" % mode, monotonic(seq, desc=(mode == "new")))
            elif mode == "size":
                seq = [by_rel.get(x["id"], {}).get("size") for x in o]
                check("排序 size：大小递减", monotonic(seq, desc=True))
            elif mode == "name":
                titles = [x["title"] for x in o]
                js = "(function(a){for(let i=1;i<a.length;i++){if(a[i-1].localeCompare(a[i],'zh')>0)return false}return true})(%s)" % json.dumps(titles)
                ok = c.ev(js, sid, False)
                check("排序 name：标题升序", ok is True, "titles=%s" % titles[:3])

        check("切换排序确实改变顺序", any(orders[m] != orders["new"] for m in ("old", "size", "name")),
              {k: v[:3] for k, v in orders.items()})
        check("排序后无 JS 异常", c.ev("window.__vrRealErrs.length", sid, False) == 0,
              c.ev("window.__vrRealErrs", sid, False))

        # 恢复默认排序，避免影响用户下次打开
        set_sort("new")

        failed = [r for r in RESULTS if not r["pass"]]
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
