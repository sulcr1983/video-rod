# video-rod M2 下载管线验收：真落盘 + 目录 + 去重 + 完成状态
# 用法：VR_CDP=http://127.0.0.1:9222 python tools/cdp-m2-test.py
#
# 说明：CDP 的 Browser.setDownloadBehavior 对 Windows 路径处理有坑（会把
# 反斜杠拼坏导致 FILE_FAILED），所以这里直接验真实下载目录（chrome.downloads
# 的默认行为），测完把本次产生的文件清掉。
import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id, open_popup  # noqa: E402

PAGE = os.environ.get("VR_TEST_PAGE", "http://127.0.0.1:18080/index.html")
# Chrome 默认下载目录（本机实测）
DL_ROOT = os.environ.get("VR_DL_ROOT", r"E:/personal/Downloads")
TARGET_DIR = os.path.join(DL_ROOT, "video-rod")


def snap():
    out = {}
    if os.path.isdir(TARGET_DIR):
        for dirpath, _d, files in os.walk(TARGET_DIR):
            for f in files:
                if f.endswith(".crdownload"):
                    continue
                p = os.path.join(dirpath, f)
                out[os.path.relpath(p, TARGET_DIR).replace("\\", "/")] = os.path.getsize(p)
    return out


def main():
    cdp = Cdp()
    report = {"steps": []}
    ext_id, _ = find_ext_id(cdp)
    report["extId"] = ext_id

    before = snap()
    report["before"] = before

    psid, tab_id = open_popup(cdp, PAGE)
    report["tabId"] = tab_id

    cards = cdp.eval("document.querySelectorAll('#mediaList .panel').length", psid)
    report["cards"] = cards
    if not cards:
        print(json.dumps({"error": "没嗅探到卡片", **report}, ensure_ascii=False, indent=2))
        sys.exit(1)

    # 清空下载记录（同时清内存和 storage，避免上一轮的记录干扰）
    cdp.eval("document.getElementById('vrClearDownloaded').click()", psid)
    time.sleep(0.3)
    report["afterClearCards"] = cdp.eval(
        "document.querySelectorAll('#mediaList .panel.done').length", psid)

    # 批量下载
    cdp.eval("document.getElementById('DownFile').click()", psid)

    deadline = time.time() + 20
    while time.time() < deadline:
        now = snap()
        if len(now) >= cards:
            break
        time.sleep(0.4)

    after = snap()
    new_files = {k: v for k, v in after.items() if k not in before}
    report["newFiles"] = new_files
    report["allFiles"] = sorted(after.keys())

    # 再点一次：应被去重拦下，不新增文件
    cdp.eval("document.getElementById('DownFile').click()", psid)
    time.sleep(1.5)
    report["afterSecondClick"] = sorted(snap().keys())
    report["dedupeToast"] = cdp.eval(
        "(document.getElementById('TipsFixed')||{}).textContent", psid)
    report["doneCards"] = cdp.eval(
        "document.querySelectorAll('#mediaList .panel.done').length", psid)

    # 清理本次新产生的文件（只删这次新增的，精确路径）
    removed = []
    for rel in new_files:
        p = os.path.join(TARGET_DIR, rel.replace("/", os.sep))
        try:
            os.remove(p)
            removed.append(rel)
        except OSError:
            pass
    report["cleanedUp"] = removed

    report["errors"] = cdp.errors()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
