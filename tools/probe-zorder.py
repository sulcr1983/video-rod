# 验证 z 序修复 v3：显式 inline 定位每个浮层（绕开卡死过渡），纯验层叠关系
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id, open_popup  # noqa: E402

cdp = Cdp(os.environ.get("VR_CDP", "http://127.0.0.1:9226"))
psid, _ = open_popup(cdp, "http://127.0.0.1:18080/index.html")
time.sleep(1.0)

PROBE = """(() => {
  const desc = el => el ? (el.tagName + (el.id ? '#'+el.id : '') +
    (el.className && typeof el.className === 'string' && el.className.trim() ? '.'+el.className.trim().split(/\\s+/)[0] : '')) : 'null';
  const down = document.querySelector('#down');
  const footY = down.getBoundingClientRect().top + 5;
  const at = (x, y) => desc(document.elementFromPoint(x, y));
  return JSON.stringify({atFoot: at(innerWidth/2, footY), atMid: at(innerWidth/2, 120),
                         atTop: at(innerWidth/2, 40)});
})()"""

# sv/dr: 'on' | 'off'；md: 'on' | 'off'
SET = """(() => {
  const sv = document.querySelector('#vrSettings'), dr = document.querySelector('#vrTools');
  const md = document.querySelector('#vrRenameModal'), mk = document.querySelector('#vrMask');
  const put = (el, on) => { el.style.transition = 'none';
    el.style.transform = on ? 'none' : (el.classList.contains('drawer') ? 'translateX(102%)' : 'translateX(100%)'); };
  put(sv, SV === 'on'); put(dr, DR === 'on');
  md.style.display = MD === 'on' ? 'block' : '';
  mk.style.display = MD === 'on' ? 'block' : '';
})()"""


def state(label, sv, dr, md):
    expr = SET.replace("SV", json.dumps(sv)).replace("DR", json.dumps(dr)).replace("MD", json.dumps(md))
    cdp.eval(expr, psid)
    time.sleep(0.4)
    print(label, cdp.eval(PROBE, psid), flush=True)


state("baseline      ", "off", "off", "off")
state("settings-open ", "on", "off", "off")
state("tools-open    ", "off", "on", "off")
state("rename-modal  ", "off", "off", "on")
