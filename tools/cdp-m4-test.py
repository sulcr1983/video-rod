# M4 复测：notyoutube.com:18080（带端口，绕开 80 端口私有 IP 拦截）
# 验：YT 横幅出现 + 嗅探卡片数 + 控制台 0 报错
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id, open_popup  # noqa: E402

PAGE = os.environ.get("VR_NYT_PAGE", "http://notyoutube.com:18080/")
cdp = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9226"))
report = {"steps": [], "errors": []}

ext_id, _ = find_ext_id(cdp)
report["extId"] = ext_id

psid, tab_id = open_popup(cdp, PAGE)
report["tabId"] = tab_id
time.sleep(1.0)

checks = {
    "cardCount": "document.querySelectorAll('#mediaList .panel').length",
    "ytBanner": "!!document.getElementById('vrYtBanner')",
    "ytText": "(document.getElementById('vrYtBanner')||{}).textContent?.slice(0,80)",
    "site": "(document.getElementById('vrSite')||{}).textContent",
    "count": "(document.getElementById('vrCount')||{}).textContent",
    "bodyBg": "getComputedStyle(document.body).backgroundColor",
}
report["dom"] = {k: cdp.eval(v, psid) for k, v in checks.items()}
report["errors"] = cdp.errors()
print(json.dumps(report, ensure_ascii=False, indent=2))
