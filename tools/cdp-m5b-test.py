# video-rod M5b 验收：右键秒存（走真实的 vrSaveContextMedia 代码路径）+ Alt+Shift+V 快捷键
# 用法：VR_CDP=http://127.0.0.1:9226 python tools/cdp-m5b-test.py
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402
from vr_testenv import dl_dir  # noqa: E402

IMG_PAGE = "http://127.0.0.1:18080/images.html"
# 2026-11-08：默认值改为仓库内测试目录（原来写死 E:/personal/Downloads）。
DL_ROOT = os.environ.get("VR_DL_ROOT") or dl_dir("m5b")
TARGET_DIR = os.path.join(DL_ROOT, "video-rod")


def snap():
    out = {}
    if os.path.isdir(TARGET_DIR):
        for dp, _d, fs in os.walk(TARGET_DIR):
            for f in fs:
                if f.endswith(".crdownload"):
                    continue
                p = os.path.join(dp, f)
                out[os.path.relpath(p, TARGET_DIR).replace("\\", "/")] = os.path.getsize(p)
    return out


def main():
    cdp = Cdp()
    report = {"errors": []}
    ext_id, sw = find_ext_id(cdp)
    sid = cdp.attach(sw["targetId"])
    cdp.send("Runtime.enable", {}, sid)

    # 1) 开一个真实的图片页当右键目标
    t = cdp.send("Target.createTarget", {"url": IMG_PAGE})["targetId"]
    time.sleep(3.0)
    tab_id = cdp.eval(
        "new Promise(r => chrome.tabs.query({}, ts => r("
        "ts.filter(x => (x.url || '').indexOf(%s) === 0).map(x => x.id)[0] ?? -1)))"
        % json.dumps(IMG_PAGE), sid)
    report["tabId"] = tab_id
    if tab_id < 0:
        print(json.dumps({"error": "图片页没打开", **report}, ensure_ascii=False, indent=2))
        sys.exit(1)

    # 2) 右键秒存：直接调菜单点击最终会走到的函数，info 复刻真实 contextMenus.onClicked 入参
    before = snap()
    report["ctxMenuCall"] = cdp.eval("""
      vrSaveContextMedia({
        srcUrl: 'http://127.0.0.1:18080/media/cover.jpg',
        pageUrl: %s,
        tabId: %d
      }, true).then(() => 'called').catch(e => 'ERR:' + e)
    """ % (json.dumps(IMG_PAGE), tab_id), sid)

    deadline = time.time() + 20
    while time.time() < deadline:
        if len(snap()) > len(before):
            break
        time.sleep(0.4)
    after = snap()
    new_files = {k: v for k, v in after.items() if k not in before}
    report["newFiles"] = new_files
    report["dlToastState"] = cdp.eval(
        "(() => { try { return JSON.stringify((typeof cacheData!=='undefined') ? Object.keys(cacheData) : []); } catch(e){ return String(e); } })()",
        sid)

    # 3) 快捷键 Alt+Shift+V → chrome.commands.onCommand('_execute_action')
    #    直接用 CDP 发真实按键事件到页面，让浏览器自己派发
    tg = [x for x in cdp.targets() if x["type"] == "page" and IMG_PAGE in x.get("url", "")]
    if tg:
        psid = cdp.attach(tg[0]["targetId"])
        cdp.send("Input.dispatchKeyEvent", {
            "type": "keyDown", "modifiers": 4 | 8, "code": "KeyV",
            "windowsVirtualKeyCode": 86, "nativeVirtualKeyCode": 86
        }, psid)
        cdp.send("Input.dispatchKeyEvent", {
            "type": "keyUp", "modifiers": 4 | 8, "code": "KeyV",
            "windowsVirtualKeyCode": 86, "nativeVirtualKeyCode": 86
        }, psid)
        time.sleep(2.5)
        popups = [x for x in cdp.targets()
                  if x["type"] == "page" and "/popup.html" in x.get("url", "")]
        report["shortcutPopupOpened"] = len(popups) > 0
        report["popupUrls"] = [x["url"][:80] for x in popups]
    else:
        report["shortcutPopupOpened"] = "no-page-target"

    # 清理本次产生的文件
    removed = []
    for rel in new_files:
        try:
            os.remove(os.path.join(TARGET_DIR, rel.replace("/", os.sep)))
            removed.append(rel)
        except OSError:
            pass
    report["cleanedUp"] = removed
    report["errors"] = cdp.errors()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
