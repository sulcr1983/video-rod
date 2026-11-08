#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Q-07 / B-41：真实库历史数据迁移（ADR-070 语义）——默认只 dry-run。

处理三类（QA 审计 DEF-04）：
  A. relPath 缺 `video-rod/` 前缀（旧路径方案 18 条）→ 补前缀
  B. platform/type 为空 → 用 VRPath.parseRelPath 从 relPath 回填
  C. absPath 指向的文件已不存在 → state 标 missing（诚实显示）

安全闸门（苏哥铁律）：
  · 默认 --dry-run 只打印将改什么，不写库
  · --apply 必须先有成功备份：自动调 vr-db-snapshot backup，失败即中止
  · 只动 relPath/platform/type/state/pendingArchive 白名单字段，其余字段逐条比对保证 0 变化
  · 跑完后自动 verify：条目数一致 + 非白名单字段 0 差异

用法：
    python tools/migrate-relpath.py --port 9480 --dry-run
    python tools/migrate-relpath.py --port 9480 --apply --i-have-confirmed
"""
import argparse
import json
import subprocess
import sys
import urllib.request

from websocket import create_connection

ROOT = __file__ and None
PORT_DEFAULT = 9480
WHITELIST = {"relPath", "platform", "platformName", "type", "state", "pendingArchive"}


def sw_sid(port):
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    ver = json.load(op.open("http://127.0.0.1:%d/json/version" % port, timeout=6))
    ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=90)
    mid = [0]

    def send(m, p=None, s=None):
        mid[0] += 1
        msg = {"id": mid[0], "method": m, "params": p or {}}
        if s:
            msg["sessionId"] = s
        ws.send(json.dumps(msg))
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == mid[0]:
                return r.get("result", {})
    for t in send("Target.getTargets")["targetInfos"]:
        if t["type"] == "service_worker" and "background.js" in (t.get("url") or ""):
            sid = send("Target.attachToTarget", {"targetId": t["targetId"], "flatten": True})["sessionId"]
            send("Runtime.enable", {}, sid)
            return ws, send, sid
    raise RuntimeError("找不到扩展 SW（实例没在线？）")


def fetch_rows(send, sid):
    js = "VRDB.getAllFiles().then(r=>JSON.stringify(r))"
    r = send("Runtime.evaluate", {"expression": js, "returnByValue": True, "awaitPromise": True}, sid)
    return json.loads(r.get("result", {}).get("value") or "[]")


def plan(rows, subdir, parsed_rows):
    """逐条产出 (old, new_or_None)。parsed_rows 与 rows 按序对齐（SW 侧 VRPath 解析结果）。"""
    out = []
    for f, p in zip(rows, parsed_rows):
        p = p or {}
        rel = str(f.get("relPath") or "")
        tgt_rel = rel
        changed = {}
        # A 前缀：有目录层级但缺库根前缀的旧条目
        if rel and "/" in rel and not rel.startswith(subdir + "/"):
            tgt_rel = subdir + "/" + rel
            changed["relPath"] = tgt_rel
        # B 平台/类型回填：解析键用「迁移后路径」在 SW 重新解析过的结果
        if p.get("platform") and not f.get("platform"):
            changed["platform"] = p["platform"]
            if p.get("platformName"):
                changed["platformName"] = p["platformName"]
        if p.get("type") and not f.get("type"):
            changed["type"] = p["type"]
        if changed:
            new = dict(f)
            new.update(changed)
            out.append((f, new))
        else:
            out.append((f, None))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=PORT_DEFAULT)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--apply", action="store_true")
    ap.add_argument("--i-have-confirmed", action="store_true")
    a = ap.parse_args()
    if a.apply and not a.i_have_confirmed:
        print("[中止] --apply 需要 --i-have-confirmed（dry-run 清单人工过目的凭据）")
        return 2

    ws, send, sid = sw_sid(a.port)
    rows = fetch_rows(send, sid)
    print("库条目:", len(rows))

    # 字段回填解析器：对「补前缀后的目标路径」在 SW 里跑 VRPath.parseRelPath
    subdir = "video-rod"
    tgt_rels = []
    for f in rows:
        rel = str(f.get("relPath") or "")
        tgt_rels.append(subdir + "/" + rel if (rel and "/" in rel and not rel.startswith(subdir + "/")) else rel)
    parse_js = "JSON.stringify((function(list){try{return list.map(r=>VRPath.parseRelPath(r))}catch(e){return null}})(%s))"
    pr = json.loads(send("Runtime.evaluate", {"expression": parse_js % json.dumps(tgt_rels),
                                              "returnByValue": True, "awaitPromise": True}, sid)
                   .get("result", {}).get("value") or "null")
    parsed = pr or [{} for _ in tgt_rels]

    import os
    plan_list = plan(rows, subdir, parsed)
    # C 缺失标记（本地文件系统校验；absPath 非空且文件不在 → state=missing 并入写入对象）
    import os
    plan_list = plan(rows, subdir, parsed)
    out = []
    fixed = []
    for old, new in plan_list:
        tgt = new if new is not None else dict(old)
        changed_any = new is not None
        ap_ = tgt.get("absPath")
        if ap_ and not os.path.exists(os.path.normpath(str(ap_))) and tgt.get("state") != "missing":
            tgt["state"] = "missing"
            changed_any = True
            out.append((old["relPath"], "-> state=missing", "missing"))
        if new is not None:
            out.append((old["relPath"], json.dumps({k: new[k] for k in WHITELIST if k in new and new[k] != old.get(k)}, ensure_ascii=False)[:120], "prefix/fields"))
        if changed_any:
            fixed.append(tgt)
    puts = fixed

    print("=" * 60)
    print("将变更 %d 条：" % len(out))
    for rel, chg, kind in out[:60]:
        print("  [%s] %s  =>  %s" % (kind, rel[:70], chg))
    if len(out) > 60:
        print("  ... 共 %d 条" % len(out))

    if a.dry_run:
        print("\ndry-run 完成：未写库。确认无误后：--apply --i-have-confirmed")
        ws.close()
        return 0

    print("\n[备份] 先做快照…")
    rc = subprocess.call([sys.executable, "tools/vr-db-snapshot.py", "backup",
                          "--port", str(a.port), "--tag", "pre-migrate"])
    if rc != 0:
        print("[中止] 快照失败，不迁移")
        return 3
    # （puts 已在 dry-run 段统一算好，含 missing 合并）
    js = "VRDB.putFiles(%s).then(()=>JSON.stringify({ok:1}))" % json.dumps(puts, ensure_ascii=False)
    r = send("Runtime.evaluate", {"expression": js, "returnByValue": True, "awaitPromise": True}, sid)
    print("写入结果:", r.get("result", {}).get("value"))
    after = fetch_rows(send, sid)
    print("迁移后条目:", len(after), "（应为", len(rows), "）")
    non_white = 0
    idx = {str(f.get("relPath")): f for f in rows}
    for f2 in after:
        base = None
        for old, new in plan_list:
            if new and new.get("relPath") == f2.get("relPath"):
                base = old
                break
        if base is None:
            base = idx.get(f2.get("relPath"))
        if not base:
            continue
        for k, v in list(base.items()):
            if k in WHITELIST:
                continue
            if f2.get(k) != v:
                non_white += 1
                print("  [警告] 非白名单字段变化:", f2.get("relPath"), k)
    print("非白名单字段差异:", non_white)
    ws.close()
    return 0 if non_white == 0 and len(after) == len(rows) else 4


if __name__ == "__main__":
    raise SystemExit(main())
