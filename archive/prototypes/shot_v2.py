# -*- coding: utf-8 -*-
"""截图：12 条数据下 A/B/C 三方案（隔离页面其余部分）"""
import os, subprocess, tempfile

HTML = r"E:\test\download\video-rod\deliverables\prototypes\popup-redesign-options-v1.html"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUT = tempfile.gettempdir()

CLEAN = r"""
<script>window.addEventListener('load',function(){
  document.querySelectorAll('header.topbar, main.wrap > section:not(.stage), .footnote').forEach(function(n){ n.remove(); });
  var stage = document.querySelector('.stage');
  if(stage) stage.style.padding = '24px';
  document.body.style.background = '#fff';
  var wrap = document.querySelector('main.wrap');
  if(wrap) wrap.style.maxWidth = '900px';
});</script>
</body>"""

with open(HTML, "r", encoding="utf-8") as f:
    base = f.read()

for d in ("a", "b", "c"):
    html = base.replace("</body>", CLEAN, 1)
    tmp = os.path.join(OUT, "shot_%s.html" % d)
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(html)
    png = os.path.join(OUT, "v2_%s.png" % d)
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
           "--hide-scrollbars", "--force-device-scale-factor=1",
           "--window-size=820,760",
           "--virtual-time-budget=5000",
           "--screenshot=" + png,
           "file:///" + tmp.replace("\\", "/") + "#" + d]
    subprocess.run(cmd, capture_output=True, timeout=90)
    print(d, "->", png, os.path.exists(png) and os.path.getsize(png))
