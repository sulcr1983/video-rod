#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""旧资源库标题归一化：只改 displayName，不动物理文件/作者/标签。

规则：
  - 去掉 8 位日期前缀、作者名前缀、_1920p/_01 等后缀；
  - 个人主页 / 随时随地发现新鲜事 / V指数 / 纯“图片” / “- 微博”等坏标题
    用「作者 - 类型 序号」替代；
  - 只处理 displayName 为空的条目；已有的用户改名不覆盖；
  - apply 前写 rollback 文件，可用 --revert 恢复。

用法：
  python tools/normalize-old-titles.py --port 9480            # dry-run
  python tools/normalize-old-titles.py --port 9480 --apply    # 执行
  python tools/normalize-old-titles.py --port 9480 --revert .work/title-rollback/xxx.json
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime

from websocket import create_connection

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_EXT = "ceogmckiinjolbbdkjfelmfcfepccabp"
ROLLBACK_DIR = os.path.join(ROOT, ".work", "title-rollback")

PLAT_LABEL = {
    "x": "X", "xiaohongshu": "小红书", "douyin": "抖音", "weibo": "微博",
    "youtube": "YouTube", "bilibili": "B站", "instagram": "Instagram",
    "tiktok": "TikTok", "web": "网页",
}
TYPE_LABEL = {"image": "图片", "video": "视频", "audio": "音频", "anim": "动图"}


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

    def ev(self, js, sid, await_promise=True):
        r = self.send("Runtime.evaluate", {
            "expression": js, "returnByValue": True, "awaitPromise": await_promise
        }, sid)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            raise RuntimeError(((d.get("exception") or {}).get("description") or d.get("text") or "JS error")[:500])
        return r.get("result", {}).get("value")

    def open_library(self, ext):
        tid = self.send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % ext})["targetId"]
        sid = self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
        self.send("Runtime.enable", {}, sid)
        self.send("Page.enable", {}, sid)
        self.send("Page.reload", {"ignoreCache": True}, sid)
        time.sleep(5)
        return tid, sid

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def clean_creator(row, plat_label):
    full = str(row.get("creatorFull") or "").strip()
    m = re.match(r"^(.+?)\s*\(@([^)]+)\)\s*$", full)
    name = (m.group(1).strip() if m else full)
    cid = (m.group(2).strip() if m else "")
    # 待整理(@NASA) 这类：名字丢了但 ID 还有意义，用 ID 比“X”更有辨识度
    if name == "待整理" and cid and not cid.isdigit():
        return cid
    if not name or name == "待整理" or name.startswith("@") or re.match(r"^[\d.]+万", name):
        return plat_label
    return name


def strip_creator_prefix(base, row, creator):
    full = str(row.get("creatorFull") or "").strip()
    candidates = [full, creator]
    m = re.match(r"^(.+?)\s*\(@([^)]+)\)\s*$", full)
    if m:
        candidates.append(m.group(1).strip())
    for p in candidates:
        if not p:
            continue
        for sep in ("_", " ", "-"):
            if base.startswith(p + sep):
                return base[len(p) + len(sep):].lstrip(" _-")
    return base


def propose(row, counters, used):
    if str(row.get("displayName") or "").strip():
        return None
    fn = str(row.get("fileName") or str(row.get("relPath") or "").split("/")[-1])
    base = fn.rsplit(".", 1)[0] if "." in fn else fn
    plat = str(row.get("platform") or "web")
    typ = str(row.get("type") or "image")
    plat_label = PLAT_LABEL.get(plat, "网页")
    type_label = TYPE_LABEL.get(typ, "媒体")
    creator = clean_creator(row, plat_label)

    base = re.sub(r"^\d{8}_", "", base)
    base = strip_creator_prefix(base, row, creator)
    # 微博正文偶尔带“11-2 19_05 来自 微博视频号”这种时间/来源前缀
    base = re.sub(r"^\d{1,2}-\d{1,2}\s+\d{1,2}_\d{2}\s+来自\s+\S+\s*", "", base)
    base = re.sub(r"_(?:\d{3,4}p|\d{1,2})$", "", base, flags=re.I)
    base = re.sub(r"\s+", " ", base).strip(" _-\u3000")
    if len(base) > 100:
        base = base[:99].rstrip() + "…"

    bad = (not base or base in ("图片", "- 微博", "微博") or
           "的个人主页" in base or "随时随地发现新鲜事" in base or
           base.startswith("V指数") or "转评赞" in base or
           "To view keyboard shortcuts" in base)
    if bad:
        key = (creator, type_label)
        counters[key] = counters.get(key, 0) + 1
        base = "%s - %s %02d" % (creator, type_label, counters[key])

    name = base
    if name in used:
        n = 2
        while "%s (%d)" % (name, n) in used:
            n += 1
        name = "%s (%d)" % (name, n)
    used.add(name)
    return name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9480)
    ap.add_argument("--ext", default=DEFAULT_EXT)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--revert", default="", help="回滚文件路径")
    ap.add_argument("--tag", default="")
    a = ap.parse_args()

    c = Cdp(a.port)
    tid = sid = None
    try:
        tid, sid = c.open_library(a.ext)
        if a.revert:
            with open(a.revert, "r", encoding="utf-8") as f:
                rb = json.load(f)
            items = rb.get("items") or []
            payload = json.dumps(items, ensure_ascii=False)
            raw = c.ev("""(async()=>{const items=%s;
              for(const it of items){await VRDB.patchFile(it.relPath,{displayName:it.displayName||''});}
              return items.length;})()""" % payload, sid)
            c.send("Page.reload", {"ignoreCache": True}, sid)
            time.sleep(4)
            print("已回滚 %s 条 -> %s" % (raw, a.revert))
            return 0

        rows = json.loads(c.ev("VRDB.getAllFiles().then(r=>JSON.stringify(r))", sid))
        counters, used, changes = {}, set(), []
        for row in rows:
            name = propose(row, counters, used)
            if name:
                changes.append({"relPath": row.get("relPath"), "old": row.get("displayName") or "", "displayName": name})
        print("总条目 %d，可归一化 %d 条" % (len(rows), len(changes)))
        for i, ch in enumerate(changes, 1):
            print("%02d  %s\n    -> %s" % (i, ch["relPath"], ch["displayName"]))
        if not a.apply:
            print("\n[DRY-RUN] 未写入。确认后加 --apply；apply 前会自动写 rollback。")
            return 0
        if not changes:
            print("没有需要归一化的条目。")
            return 0

        os.makedirs(ROLLBACK_DIR, exist_ok=True)
        tag = a.tag or datetime.now().strftime("%Y%m%d-%H%M%S")
        rb_path = os.path.join(ROLLBACK_DIR, "titles-%s.json" % tag)
        with open(rb_path, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "at": int(time.time() * 1000),
                       "items": [{"relPath": x["relPath"], "displayName": x["old"]} for x in changes]},
                      f, ensure_ascii=False, indent=1)
        print("回滚文件：%s" % rb_path)

        payload = json.dumps(changes, ensure_ascii=False)
        raw = c.ev("""(async()=>{const items=%s;
          for(const it of items){await VRDB.patchFile(it.relPath,{displayName:it.displayName});}
          return items.length;})()""" % payload, sid)
        c.send("Page.reload", {"ignoreCache": True}, sid)
        time.sleep(4)
        titles = c.ev("[...document.querySelectorAll('#grid .card .title')].map(x=>x.textContent).slice(0,15)", sid, False)
        print("已归一化 %s 条；页面前 15 个标题：" % raw)
        for t in (titles or []):
            print("  " + str(t))
        return 0
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
