# video-rod M1 面板验收：DOM 断言 + 交互冒烟 + 状态截图
# 用法：VR_CDP=http://127.0.0.1:9222 python tools/cdp-m1-test.py [out.png]
#       VR_STATE=settings|tools|rename|dirmenu|img|images 可截指定状态
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id, open_popup  # noqa: E402

TEST_PAGE = os.environ.get("VR_TEST_PAGE", "http://127.0.0.1:18080/index.html")


def main():
    out_png = sys.argv[1] if len(sys.argv) > 1 else ""
    cdp = Cdp()
    report = {"steps": [], "errors": []}

    ext_id, _ = find_ext_id(cdp)
    report["extId"] = ext_id

    psid, tab_id = open_popup(cdp, TEST_PAGE)
    report["tabId"] = tab_id

    checks = {
        "titled": "document.title",
        "cardCount": "document.querySelectorAll('#mediaList .panel').length",
        "badges": "[...document.querySelectorAll('#mediaList .panel .badge')].map(e=>e.textContent.trim())",
        "names": "[...document.querySelectorAll('#mediaList .panel .vr-name')].map(e=>e.value)",
        "dirs": "[...document.querySelectorAll('#mediaList .panel .vr-dir-txt')].map(e=>e.textContent.trim())",
        "qualities": "document.querySelectorAll('#mediaList .panel .qsel').length",
        "site": "(document.getElementById('vrSite')||{}).textContent",
        "pageTitle": "(document.getElementById('vrPageTitle')||{}).textContent",
        "count": "(document.getElementById('vrCount')||{}).textContent",
        "chipCounts": "[...document.querySelectorAll('#vrFilters .fchip')].map(e=>e.textContent.replace(/\\s+/g,' ').trim())",
        "footCnt": "(document.getElementById('vrBatchCnt')||{}).textContent",
        "selTxt": "(document.getElementById('selTxt')||{}).textContent",
        "hasSettingsDrawer": "!!document.getElementById('vrSettings')",
        "hasToolsDrawer": "!!document.getElementById('vrTools')",
        "hasRenameModal": "!!document.getElementById('vrRenameModal')",
        "themeWidth": "document.body.getBoundingClientRect().width",
        "bodyBg": "getComputedStyle(document.body).backgroundColor",
        "namingLoaded": "typeof window.VideoRodNaming === 'object'",
        "biliBanner": "!!document.getElementById('vrBiliBanner')",
        "partChips": "document.querySelectorAll('.partchip').length",
        "ytBanner": "!!document.getElementById('vrYtBanner')",
    }
    result = {}
    for k, expr in checks.items():
        result[k] = cdp.eval(expr, psid)
    report["dom"] = result

    shot_h = 600
    try:
        shot_h = cdp.eval(
            "Math.ceil(document.getElementById('vrShell').getBoundingClientRect().height)", psid)
        shot_h = max(220, min(600, int(shot_h or 600)))
        cdp.send("Emulation.setDeviceMetricsOverride", {
            "width": 400, "height": shot_h, "deviceScaleFactor": 2, "mobile": False
        }, psid)
        time.sleep(0.35)
    except Exception:
        pass

    smoke = {}
    smoke["clickImgChip"] = cdp.eval("""
      (() => {
        const c = [...document.querySelectorAll('#vrFilters .fchip')].find(x=>x.dataset.f==='img');
        if (!c) return 'no-chip';
        c.click();
        const off = document.querySelectorAll('#mediaList .panel.vr-type-off').length;
        const all = document.querySelectorAll('#mediaList .panel').length;
        [...document.querySelectorAll('#vrFilters .fchip')].find(x=>x.dataset.f==='all').click();
        return {hidden: off, total: all};
      })()
    """, psid)
    smoke["openSettings"] = cdp.eval("""
      (() => { document.getElementById('btnSettings').click();
        return document.getElementById('vrSettings').classList.contains('on'); })()
    """, psid)
    smoke["closeSettings"] = cdp.eval("""
      (() => { document.querySelector('[data-close="vrSettings"]').click();
        return !document.getElementById('vrSettings').classList.contains('on'); })()
    """, psid)
    smoke["openTools"] = cdp.eval("""
      (() => { document.getElementById('btnTools').click();
        return document.getElementById('vrTools').classList.contains('on'); })()
    """, psid)
    smoke["closeTools"] = cdp.eval("""
      (() => { document.querySelector('[data-close="vrTools"]').click();
        return !document.getElementById('vrTools').classList.contains('on'); })()
    """, psid)
    smoke["renameModal"] = cdp.eval("""
      (() => {
        const boxes = [...document.querySelectorAll('#mediaList .panel .DownCheck')];
        if (boxes[0] && !boxes[0].checked) boxes[0].click();
        document.getElementById('vrRename').click();
        return {open: document.getElementById('vrRenameModal').classList.contains('on'),
                cnt: (document.getElementById('vrRenameCnt')||{}).textContent,
                preview: (document.getElementById('vrTplPreview')||{}).textContent.slice(0,120)};
      })()
    """, psid)
    smoke["renameApply"] = cdp.eval("""
      (() => {
        document.getElementById('vrTplInput').value = '${site}_${index}';
        document.getElementById('vrApplyTpl').click();
        return [...document.querySelectorAll('#mediaList .panel .vr-name')].map(e=>e.value);
      })()
    """, psid)
    smoke["checkAll"] = cdp.eval("""
      (() => {
        const a = document.getElementById('chkAll');
        a.checked = true; a.dispatchEvent(new Event('change'));
        return {checked: [...document.querySelectorAll('#mediaList .panel .DownCheck')].filter(b=>b.checked).length,
                batch: (document.getElementById('vrBatchCnt')||{}).textContent};
      })()
    """, psid)
    report["smoke"] = smoke

    state = os.environ.get("VR_STATE", "")
    if state:
        exprs = {
            "settings": "document.getElementById('btnSettings').click()",
            "tools": "document.getElementById('btnTools').click()",
            "rename": ("(()=>{const b=document.querySelector('#mediaList .panel .DownCheck');"
                       "if(b&&!b.checked)b.click();document.getElementById('vrRename').click();})()"),
            "dirmenu": "document.querySelector('#mediaList .panel [data-vr-dir]').click()",
            "img": ("[...document.querySelectorAll('#vrFilters .fchip')]"
                    ".find(x=>x.dataset.f==='img').click()"),
            "images": "document.getElementById('vrScanImages').click()",
        }
        if state in exprs:
            cdp.eval(exprs[state], psid)
            time.sleep(0.9)

    report["errors"] = cdp.errors()

    if out_png:
        try:
            time.sleep(1.4)
            shot = cdp.send("Page.captureScreenshot", {"format": "png"}, psid)
            os.makedirs(os.path.dirname(out_png), exist_ok=True)
            with open(out_png, "wb") as f:
                f.write(base64.b64decode(shot["data"]))
            report["screenshot"] = out_png
            report["shotHeight"] = shot_h
        except Exception as exc:
            report["screenshotError"] = str(exc)

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
