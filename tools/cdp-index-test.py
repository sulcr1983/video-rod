# video-rod 自动入库验收：下载完成 → 索引出现 → 字段正确
#
# 前置：
#   1) python -m http.server 18080（工作目录 test-site）
#   2) Chrome for Testing --remote-debugging-port=9342 --load-extension=E:\test\video-rod
# 用法：VR_CDP=http://127.0.0.1:9342 python tools/cdp-index-test.py
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id, open_popup  # noqa: E402

PAGE = os.environ.get("VR_INDEX_PAGE", "http://127.0.0.1:18080/index.html")

results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f"   got={got!r} expect={expect!r}"))


def send_msg(cdp, session, action, extra=None):
    payload = {"Message": action}
    if extra:
        payload.update(extra)
    expr = ("new Promise(function(r){ chrome.runtime.sendMessage(" + json.dumps(payload) +
            ", function(resp){ r(resp); }); })")
    return cdp.eval(expr, session)


def main():
    cdp = Cdp()
    ext_id, _ = find_ext_id(cdp)
    check("A1 扩展已加载", bool(ext_id), True)
    if not ext_id:
        return finish(cdp)

    # options 页作为消息宿主
    otid = cdp.send("Target.createTarget", {"url": f"chrome-extension://{ext_id}/options.html"})["targetId"]
    osid = cdp.attach(otid)
    cdp.send("Runtime.enable", {}, osid)
    cdp.send("Page.enable", {}, osid)
    time.sleep(2.0)

    # 清空索引，确保从零开始
    send_msg(cdp, osid, "vrLib.clear")
    time.sleep(0.4)
    st = send_msg(cdp, osid, "vrLib.stats")
    check("A2 清空后索引为 0", (st or {}).get("count"), 0)

    # 打开测试站 + 面板
    psid, _ = open_popup(cdp, PAGE)
    cards = cdp.eval("document.querySelectorAll('#mediaList .panel').length", psid)
    check("B1 嗅探到媒体卡片", cards > 0, True)
    if not cards:
        return finish(cdp)

    cdp.eval("(document.getElementById('vrClearDownloaded')||{click(){}}).click()", psid)
    time.sleep(0.3)
    cdp.eval("(() => { const c = document.querySelector('#mediaList .panel .DownCheck'); if (c) c.click(); return 1; })()", psid)
    time.sleep(0.3)
    cdp.eval("document.getElementById('DownFile').click()", psid)

    # 轮询索引
    item = None
    deadline = time.time() + 30
    while time.time() < deadline:
        time.sleep(1.0)
        r = send_msg(cdp, osid, "vrLib.list")
        lst = (r or {}).get("list") or []
        if lst:
            item = sorted(lst, key=lambda x: x.get("mtime") or 0, reverse=True)[0]
            break

    check("C1 下载完成后索引出现条目", bool(item), True)
    if item:
        print("      入库条目:", json.dumps({k: item.get(k) for k in
              ("relPath", "platform", "creatorFull", "type", "size", "mime")}, ensure_ascii=False))
        rel = item.get("relPath") or ""
        check("C2 相对路径含三段目录", rel.startswith("video-rod/"), True)
        check("C3 平台识别为 web", item.get("platform"), "web")
        check("C4 平台名「其他网页」", rel.split("/")[1] if len(rel.split("/")) > 1 else "", "其他网页")
        check("C5 类型为 video", item.get("type"), "video")
        check("C6 大小已记录", (item.get("size") or 0) > 0, True)
        check("C7 绝对路径已记录", bool(item.get("absPath")), True)
        check("C8 文件名非空", bool(item.get("fileName")), True)

        st2 = send_msg(cdp, osid, "vrLib.stats")
        check("C9 索引计数为 1", (st2 or {}).get("count"), 1)

        # C10/C11：设置页「索引状态 / 最近入库」应被 vrLib.added 广播自动刷新
        ui = None
        deadline = time.time() + 10
        while time.time() < deadline:
            idx = cdp.eval("document.getElementById('vrLibIndex').textContent", osid) or ""
            recent = cdp.eval("document.getElementById('vrLibRecent').textContent", osid) or ""
            if "已入库" in idx and recent and item.get("relPath") in recent:
                ui = (idx.strip(), recent.strip())
                break
            time.sleep(0.5)
        check("C10 设置页显示已入库条数", bool(ui), True)
        if ui:
            print("      设置页:", ui[0], "| 最近:", ui[1][:60])

        # 清理：删文件 + 擦记录 + 清索引
        did = item.get("downloadId")
        if did:
            cdp.eval(f"new Promise(function(r){{ chrome.downloads.removeFile({did}, function(){{ r(1); }}); }})", osid)
            time.sleep(0.3)
            cdp.eval(f"new Promise(function(r){{ chrome.downloads.erase({{id:{did}}}, function(){{ r(1); }}); }})", osid)
        send_msg(cdp, osid, "vrLib.clear")

    return finish(cdp)


def finish(cdp):
    errs = cdp.errors()
    check("D1 控制台无 error/exception", errs, [])
    total = len(results)
    passed = sum(1 for r in results if r[0])
    print(f"\n===== {passed}/{total} 通过 =====")
    if errs:
        print("控制台：", errs[:5])
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
