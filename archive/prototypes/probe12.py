# -*- coding: utf-8 -*-
"""探针：验证 12/6 条数据下三方案渲染 + 行高 + 切换联动"""
import json, subprocess, sys, tempfile, os

HTML = r"E:\test\download\video-rod\deliverables\prototypes\popup-redesign-options-v1.html"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

PROBE = r"""
(function(){
  var out = {};
  function q(s, r){ return (r||document).querySelector(s); }
  function qa(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }

  // A
  var a = q('[data-proto="a"]');
  out.a_rows = qa('.row', a).length;
  out.a_rowH = q('.row', a) ? Math.round(q('.row', a).getBoundingClientRect().height) : 0;
  out.a_cnt = q('[data-bind="cnt"]', a).textContent;
  out.a_sum = q('[data-bind="sum"]', a).textContent;
  out.a_filters = qa('.f', a).map(function(b){ return b.textContent.trim(); });
  var plist = q('.plist', a);
  out.a_scrollable = plist.scrollHeight > plist.clientHeight + 1;
  out.a_listVisible = Math.floor(plist.clientHeight / out.a_rowH);

  // B
  var b = q('[data-proto="b"]');
  out.b_groups = qa('.gcard', b).map(function(c){
    return { t: q('.gt', c).textContent, n: q('.gn', c).textContent, rows: qa('.row', c).length };
  });
  out.b_bcnt = q('[data-bind="bcnt"]', b).textContent;
  out.b_sum = q('[data-bind="sum"]', b).textContent;

  // C
  var c = q('[data-proto="c"]');
  out.c_h1 = q('[data-bind="h1"]', c).textContent;
  out.c_hsub = q('[data-bind="hsub"]', c).textContent;
  out.c_cta = q('[data-bind="ctatext"]', c).textContent;
  out.c_receipt_rows = qa('.rrow', c).length;
  out.c_rbox = q('.rbox', c) ? q('.rbox', c).textContent.slice(0, 60) : '';
  var receipt = q('.receipt', c);
  out.c_receipt_scroll = receipt.scrollHeight > receipt.clientHeight + 1;

  // 切换到 6 条
  var btn6 = q('.dataswitch button[data-n="6"]');
  btn6.click();
  out.after6 = {
    a_rows: qa('.row', a).length,
    a_cnt: q('[data-bind="cnt"]', a).textContent,
    a_sum: q('[data-bind="sum"]', a).textContent,
    b_groups: qa('.gcard', b).map(function(cc){ return qa('.row', cc).length; }),
    c_h1: q('[data-bind="h1"]', c).textContent,
    c_cta: q('[data-bind="ctatext"]', c).textContent,
    on6: q('.dataswitch button[data-n="6"]').classList.contains('on')
  };

  // 切回 12 条，展开 C，看展开态
  q('.dataswitch button[data-n="12"]').click();
  var expandBtn = q('[data-bind="expandBtn"]', c);
  expandBtn.click();
  out.c_expanded_rows = qa('.crow', c).length;
  out.c_cfoot_hidden = q('[data-bind="cfoot"]', c).hidden;
  var clist = q('.clist', c);
  out.c_clist_scroll = clist.scrollHeight > clist.clientHeight + 1;

  // A 勾掉一条，看合计联动
  q('.dataswitch button[data-n="12"]').click();
  var cb = qa('.row .cb', a)[0];
  cb.click();
  out.a_after_uncheck = q('[data-bind="sum"]', a).textContent;
  var allBox = q('[data-all]', a);
  out.a_all_indeterminate = allBox.indeterminate;

  return JSON.stringify(out);
})()
"""

def run():
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(PROBE)
        probe = f.name
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
           "--virtual-time-budget=4000", "--dump-dom",
           "file:///" + HTML.replace("\\", "/")]
    # 用 evaluate 方式：--dump-dom 不支持探针，改用 screenshot+js 注入不行；
    # 方案：复制一份 HTML，把探针结果写进 title，再 dump-dom 读取
    with open(HTML, "r", encoding="utf-8") as f:
        html = f.read()
    inject = (
        "<script>window.addEventListener('load',function(){setTimeout(function(){"
        "document.title='PROBE:'+"
        + PROBE +
        ";},300)});</script>"
        "</body>"
    )
    html2 = html.replace("</body>", inject, 1)
    tmp_html = os.path.join(tempfile.gettempdir(), "probe12.html")
    with open(tmp_html, "w", encoding="utf-8") as f:
        f.write(html2)
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
           "--virtual-time-budget=6000", "--dump-dom",
           "file:///" + tmp_html.replace("\\", "/")]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=90,
                       encoding="utf-8", errors="replace")
    dom = r.stdout
    i = dom.find("PROBE:")
    if i < 0:
        print("NO PROBE RESULT"); print(dom[:500]); sys.exit(1)
    j = dom.find("</title>", i)
    print(dom[i+6:j])

if __name__ == "__main__":
    run()
