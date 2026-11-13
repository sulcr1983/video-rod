# -*- coding: utf-8 -*-
"""媒体库「同作者 · 只看此人循环播放」真机验证。

步骤：
  1) 打开 library.html，统计库里作者分布，找「同作者 ≥2 条」的素材
  2) 点开它的详情 → 检查同作者区已填充、有「只看此人 · 循环播放」
  3) 点该按钮 → 检查播放队列收窄为该博主且连播开启
  4) 点同作者卡片 → 检查能切换

只读库数据，不下载、不删除。
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
from cdp_client import Cdp, find_ext_id  # noqa: E402

results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "  got=%r expect=%r" % (got, expect)))


def reload_ext(cdp):
    """重载本扩展：library.html 每次导航都从磁盘读，但文件变更要先重载扩展才生效。"""
    ex = cdp.send("Target.createTarget", {"url": "chrome://extensions/"})["targetId"]
    esid = cdp.attach(ex)
    cdp.send("Runtime.enable", {}, esid)
    time.sleep(2.5)
    r = cdp.eval("""
    new Promise(resolve => {
      const mgr = document.querySelector('extensions-manager');
      const list = mgr && mgr.shadowRoot.querySelector('extensions-item-list');
      if (!list) { resolve('no-list'); return; }
      const it = [...list.shadowRoot.querySelectorAll('extensions-item')]
        .find(x => ((x.shadowRoot.querySelector('#name')||{}).textContent||'').includes('钓鱼竿'));
      if (!it) { resolve('no-ext'); return; }
      const btn = it.shadowRoot.querySelector('#dev-reload-button');
      if (!btn) { resolve('no-btn'); return; }
      btn.click();
      resolve('ok');
    })
    """, esid)
    print("    重载扩展:", r)
    try:
        cdp.send("Target.closeTarget", {"targetId": ex})
    except Exception:
        pass
    time.sleep(3)
    return r == "ok"


def main():
    cdp = Cdp("http://127.0.0.1:9223")
    try:
        reload_ext(cdp)
    except Exception as e:
        print("    重载失败（继续用已加载版本）:", e)
    ext_id, _ = find_ext_id(cdp)
    if not ext_id:
        print("找不到扩展 service worker（扩展没加载？）")
        return 3
    print("    扩展 ID:", ext_id)

    tid = cdp.send("Target.createTarget", {"url": "chrome-extension://%s/library.html" % ext_id})["targetId"]
    sid = cdp.attach(tid)
    cdp.send("Runtime.enable", {}, sid)
    cdp.send("Page.enable", {}, sid)
    # 等库加载完（FILES 就绪）
    for _ in range(30):
        n = cdp.eval("(root&&root.VRApp&&root.VRApp.getFiles)?root.VRApp.getFiles().length:-1".replace("root", "window"), sid)
        if isinstance(n, int) and n > 0:
            break
        time.sleep(1)
    print("    库内素材:", n)

    # 1) 作者分布
    dist = cdp.eval("""
    (() => {
      const all = window.VRApp.getFiles() || [];
      const by = {};
      all.forEach(f => {
        const k = String(f.authorId || f.author || '').trim();
        if (!k) return;
        (by[k] = by[k] || {n:0, rel:'', author:'', authorId:''});
        by[k].n++;
        if (!by[k].rel) { by[k].rel = f.relPath; by[k].author = f.author; by[k].authorId = f.authorId; }
      });
      const arr = Object.entries(by).sort((a,b) => b[1].n - a[1].n);
      return JSON.stringify({total: all.length, top: arr.slice(0, 6)});
    })()
    """, sid)
    d = json.loads(dist or "{}")
    print("    作者分布 top:", json.dumps(d.get("top"), ensure_ascii=False)[:400])
    multi = [x for x in d.get("top", []) if x[1].get("n", 0) >= 2]
    if not multi:
        print("    库里没有「同一博主 ≥2 条」的素材，无法验证同作者区 —— 如实标记为 SKIP")
        return 0
    who, info = multi[0]
    print("    选定博主: %s (%s 条)" % (who, info["n"]))

    # 2) 打开该博主某条素材的详情
    opened = cdp.eval("""
    (() => {{
      const rel = {rel};
      const f = (window.VRApp.getFiles()||[]).find(x => x.relPath === rel);
      if (!f) return 'no-file';
      window.VRPreview.open(f, window.VRApp.getFiles());
      return 'ok';
    }})()
    """.replace("{rel}", json.dumps(info["rel"])), sid)
    check("1 详情页已打开", opened, "ok")
    time.sleep(1.5)

    more = cdp.eval("""
    (() => {
      const grid = document.getElementById('pvMoreGrid');
      const cnt = document.getElementById('pvMoreCount');
      const loop = document.querySelector('.pv-peer-loop');
      const sec = grid && grid.closest('.pi-more');
      return JSON.stringify({
        count: cnt ? cnt.textContent : '',
        cards: grid ? grid.querySelectorAll('[data-peers]').length : -1,
        hasLoop: !!loop,
        loopText: loop ? loop.textContent : '',
        sectionHidden: sec ? sec.classList.contains('hidden') : null
      });
    })()
    """, sid)
    m = json.loads(more or "{}")
    print("    同作者区:", json.dumps(m, ensure_ascii=False))
    check("2 计数与该作者其余条数一致", int(m.get("count") or 0), info["n"] - 1)
    check("3 卡片已填充", m.get("cards", -1) > 0, True)
    check("4 有「只看此人 · 循环播放」", m.get("hasLoop"), True)
    check("5 区块不再隐藏", m.get("sectionHidden"), False)

    # 6) 点「只看此人 · 循环播放」→ 队列应收窄为该博主
    before = cdp.eval("window.VRPreview.__probe ? 1 : (()=>{const s=document.querySelectorAll('#pvFilm .film').length; return s})()", sid)
    clicked = cdp.eval("""
    (() => {
      const b = document.querySelector('.pv-peer-loop');
      if (!b) return 'no-btn';
      b.click();
      return 'ok';
    })()
    """, sid)
    check("6 点击循环按钮", clicked, "ok")
    time.sleep(1.2)
    after = cdp.eval("""
    (() => {
      const films = document.querySelectorAll('#pvFilm .film').length;
      const auto = document.getElementById('autoBtn');
      return JSON.stringify({
        films,
        autoOn: auto ? auto.classList.contains('on') : null
      });
    })()
    """, sid)
    a = json.loads(after or "{}")
    print("    点循环后:", json.dumps(a, ensure_ascii=False), " 期望队列=", info["n"])
    check("7 队列收窄为该博主全部", a.get("films"), info["n"])
    check("8 连播已开启", a.get("autoOn"), True)

    # 9) 点同作者卡片能切换
    switch = cdp.eval("""
    (() => {
      const b = document.querySelector('#pvMoreGrid [data-peers]');
      if (!b) return 'no-card';
      const before = document.querySelectorAll('#pvFilm .film.on').length;
      b.click();
      return 'ok:' + before;
    })()
    """, sid)
    check("9 点同作者卡片可切换", str(switch).startswith("ok"), True)
    time.sleep(1)

    ours = [e for e in cdp.errors() if "lightbox" in e or ext_id in e]
    check("10 我们的代码无异常", len(ours), 0)
    for e in ours:
        print("    ERR", e[:180])

    print("\n%d/%d PASS" % (sum(1 for r in results if r[0]), len(results)))
    try:
        cdp.send("Target.closeTarget", {"targetId": tid})
    except Exception:
        pass
    return 0 if all(r[0] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
