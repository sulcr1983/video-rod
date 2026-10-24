# video-rod S1a 验收：三段中文目录落盘 + 资源库设置页 + 校验落盘
#
# 前置：
#   1) 启动 Chrome for Testing（端口 9342），加 --load-extension=E:\test\video-rod
#   2) 在 test-site 目录起 HTTP 服务：python -m http.server 18080
# 用法：VR_CDP=http://127.0.0.1:9342 python tools/cdp-s1a-test.py
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id, open_popup  # noqa: E402

PAGE = os.environ.get("VR_S1A_PAGE", "http://127.0.0.1:18080/index.html")
DL_ROOT = os.environ.get("VR_DL_ROOT", r"D:/Users/liq21/Downloads")

results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f"   got={got!r} expect={expect!r}"))


def main():
    cdp = Cdp()
    ext_id, _ = find_ext_id(cdp)
    check("A1 扩展已加载（找到 background.js）", bool(ext_id), True)
    if not ext_id:
        return finish(cdp)

    # ---------- B. options 资源库分区 ----------
    otid = cdp.send("Target.createTarget", {"url": f"chrome-extension://{ext_id}/options.html"})["targetId"]
    osid = cdp.attach(otid)
    cdp.send("Runtime.enable", {}, osid)
    cdp.send("Page.enable", {}, osid)
    time.sleep(2.0)

    check("B1 资源库分区存在", cdp.eval("!!document.getElementById('anchorLibrary')", osid), True)
    check("B2 VRSettings 已挂载", cdp.eval("typeof self.VRSettings === 'object'", osid), True)
    check("B3 导航含资源库入口", cdp.eval(
        "Array.from(document.querySelectorAll('nav a')).some(a => a.getAttribute('href') === '#anchorLibrary')", osid), True)
    check("B4 子目录默认 video-rod", cdp.eval("document.getElementById('vrLibSubdir').value", osid), "video-rod")
    check("B5 迁移按钮已启用（S1b 已落地）", cdp.eval("document.getElementById('vrLibMigrate').disabled", osid), False)

    # 校验落盘
    cdp.eval("document.getElementById('vrLibVerify').click()", osid)
    msg = ""
    for _ in range(20):
        time.sleep(0.5)
        msg = cdp.eval("(document.getElementById('vrLibVerifyMsg')||{}).textContent || ''", osid) or ""
        if "通过" in msg or "失败" in msg or "异常" in msg or "超时" in msg:
            break
    check("B6 校验落盘通过", "通过" in msg, True)
    print("      校验消息:", msg)
    check("B7 根目录已显示", cdp.eval(
        "!/未探测/.test((document.getElementById('vrLibRoot')||{}).textContent||'')", osid), True)

    # ---------- C. 真机下载落位 ----------
    before_ids = set(cdp.eval(
        "new Promise(r => chrome.downloads.search({}, ds => r(ds.map(d => d.id))))", osid) or [])

    psid, _tab = open_popup(cdp, PAGE)
    cards = cdp.eval("document.querySelectorAll('#mediaList .panel').length", psid)
    check("C1 面板嗅探到媒体卡片", cards > 0, True)
    if not cards:
        return finish(cdp)

    # 清空去重记录，保证这次真的会下载
    cdp.eval("(document.getElementById('vrClearDownloaded')||{click(){}}) .click()", psid)
    time.sleep(0.3)

    # 勾选第一张卡 → 点批量下载（单卡按钮是 SVG，CDP 合成点击不稳定，批量入口更可靠）
    cdp.eval("""
      (() => {
        const c = document.querySelector('#mediaList .panel .DownCheck');
        if (!c) { return 'no-checkbox'; }
        c.click();
        return c.checked;
      })()
    """, psid)
    time.sleep(0.3)
    checked = cdp.eval("document.querySelectorAll('#mediaList .panel .DownCheck:checked').length", psid)
    check("C1b 已勾选至少 1 项", (checked or 0) >= 1, True)
    cdp.eval("document.getElementById('DownFile').click()", psid)

    # 等新下载记录
    rec = None
    deadline = time.time() + 30
    while time.time() < deadline:
        time.sleep(0.6)
        ds = cdp.eval("new Promise(r => chrome.downloads.search({orderBy:['-startTime']}, list => r(list.slice(0,5).map(d => ({id:d.id,filename:d.filename,state:d.state,error:d.error})))) )", osid) or []
        for d in ds:
            if d.get("id") not in before_ids:
                rec = d
                break
        if rec and rec.get("state") in ("complete", "interrupted"):
            break

    check("C2 产生新的下载记录", bool(rec), True)
    if rec:
        fn = rec.get("filename") or ""
        print("      落盘路径:", fn)
        rel = fn.replace(DL_ROOT.replace("/", "\\"), "")
        parts = [p for p in fn.replace("/", "\\").split("\\") if p]
        check("C3 落在 video-rod 子目录", "video-rod" in parts, True)
        check("C4 含平台段「其他网页」", "其他网页" in parts, True)
        check("C5 含博主占位 127.0.0.1", "127.0.0.1" in parts, True)
        check("C6 含类型段「视频」", "视频" in parts, True)
        check("C7 下载完成", rec.get("state"), "complete")

        # 清理：先删文件，再擦记录
        cdp.eval(f"new Promise(r => chrome.downloads.removeFile({rec['id']}, () => r(1)))", osid)
        time.sleep(0.3)
        cdp.eval(f"new Promise(r => chrome.downloads.erase({{id:{rec['id']}}}, () => r(1)))", osid)

    return finish(cdp)


def finish(cdp):
    errs = cdp.errors()
    check("D1 控制台无 error/exception", errs, [])
    total = len(results)
    passed = sum(1 for r in results if r[0])
    print(f"\n===== {passed}/{total} 通过 =====")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
