# -*- coding: utf-8 -*-
"""微博博主主页探针（真机只读）

目的：为「微博博主主页全部下载」定性
    ① 主页滚动加载时，页面自己发的是哪个接口（profile/info、mymblog、getIndex…）
    ② 响应里图片字段（pic_infos / pic_ids / url 档位）与视频字段（page_info.media_info）
    ③ 滚动几轮到底、是否出现 418/403 限流页
    ④ 现有 DOM 扫描（bulk-profile.js 的 scanWeibo）能覆盖多少正文图

铁律：只读、单页、不循环、不发私有请求；每轮滚动随机间隔 1.4~2.6 秒。

用法：
    python tools/weibo-profile-probe.py --url https://weibo.com/u/<uid>
    python tools/weibo-profile-probe.py --url https://weibo.com/<nickname> --port 9223 --rounds 3

产物：.tmp/weibo-probe/<slug>-dump.json / -shot.png / -report.json
"""
import argparse
import base64
import json
import os
import random
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, ".tmp", "weibo-probe")

# 旁读：主页时间线/相册接口。只记录结构统计与字段名，不落正文。
HOOK = r"""
(function () {
  if (window.__vrWbProbe) { return; }
  var P = window.__vrWbProbe = {
    hits: [], endpoints: {}, keys: {}, picFields: 0, mediaInfo: 0,
    sinceId: null, listLens: [], errors: [], statusCount: 0
  };
  var API_RE = /\/(ajax\/(?:profile\/getImageWall|statuses\/mymblog|profile\/info|statuses\/show)|api\/container\/getIndex|ajax\/profile\/getProfileInfo)\b/;

  function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > 10) { return; }
    if (Array.isArray(o)) { for (var i = 0; i < Math.min(o.length, 5); i++) { walk(o[i], depth + 1); } return; }
    for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) { continue; }
      P.keys[k] = (P.keys[k] || 0) + 1;
      if (k === 'pic_infos' || k === 'pic_ids' || k === 'pics') { P.picFields++; }
      if (k === 'media_info' || k === 'page_info') { P.mediaInfo++; }
      walk(o[k], depth + 1);
    }
  }

  function record(url, text) {
    var m = API_RE.exec(String(url || ''));
    if (!m) { return; }
    var name = m[1].replace(/\//g, '.');
    P.endpoints[name] = (P.endpoints[name] || 0) + 1;
    var j;
    try { j = JSON.parse(text); } catch (e) { P.errors.push('json ' + e); return; }
    P.hits.push({ api: name, bytes: text.length, at: Date.now() });
    walk(j, 0);
    if (j && j.since_id != null && P.sinceId == null) { P.sinceId = String(j.since_id); }
    var list = (j && (j.list || (j.data && j.data.list))) || null;
    if (Array.isArray(list)) {
      P.listLens.push(list.length);
      P.statusCount += list.length;
    }
    if (j && j.data && Array.isArray(j.data.cards)) {
      P.listLens.push(j.data.cards.length);
      P.statusCount += j.data.cards.length;
    }
  }

  var of = window.fetch;
  window.fetch = function (input) {
    var p = of.apply(this, arguments);
    var u = typeof input === 'string' ? input : (input && input.url) || '';
    try {
      if (API_RE.test(u)) {
        p.then(function (r) { return r.clone().text(); }).then(function (t) { record(u, t); }, function () {});
      }
    } catch (e) {}
    return p;
  };
  var XP = XMLHttpRequest.prototype, oo = XP.open, os_ = XP.send;
  XP.open = function (m, u) { try { this.__u = String(u || ''); } catch (e) {} return oo.apply(this, arguments); };
  XP.send = function () {
    var x = this;
    try {
      x.addEventListener('load', function () {
        try {
          if (!API_RE.test(x.__u || '')) { return; }
          var rt = x.responseType;
          if (rt && rt !== 'text' && rt !== 'json') { return; }
          record(x.__u, rt === 'json' ? JSON.stringify(x.response) : x.responseText);
        } catch (e) {}
      });
    } catch (e) {}
    return os_.apply(this, arguments);
  };
})();
"""

# DOM 侧：复刻 bulk-profile.js 的 scanWeibo 口径，统计能扫到多少张正文图
DOM = r"""
(() => {
  const out = { url: location.href, title: document.title, imgs: 0, bigImgs: 0,
                samples: [], videos: 0, videoSrcs: [], blocked: false };
  out.blocked = /访问过于频繁|安全验证|请完成验证|403|418|访问异常/.test(document.title + ' ' +
                 (document.body ? document.body.innerText.slice(0, 400) : ''));
  const imgs = Array.from(document.querySelectorAll('img'));
  out.imgs = imgs.length;
  for (const img of imgs) {
    const src = img.currentSrc || img.src || '';
    if (!/sinaimg/i.test(src)) { continue; }
    if (/avatar|face\.|h5\.sinaimg|crop\./i.test(src)) { continue; }
    const r = img.getBoundingClientRect();
    if (Math.max(r.width, r.height) < 120) { continue; }
    out.bigImgs++;
    if (out.samples.length < 8) {
      out.samples.push({ src: src.slice(0, 100), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }
  const vs = Array.from(document.querySelectorAll('video'));
  out.videos = vs.length;
  out.videoSrcs = vs.slice(0, 4).map(v => String(v.currentSrc || v.src || '').slice(0, 100));
  return JSON.stringify(out);
})()
"""

STATE = r"""
(() => {
  const P = window.__vrWbProbe || {};
  return JSON.stringify({
    hasProbe: !!window.__vrWbProbe,
    hits: (P.hits || []).length,
    endpoints: P.endpoints || {},
    statusCount: P.statusCount || 0,
    listLens: (P.listLens || []).slice(-6),
    picFields: P.picFields || 0,
    mediaInfo: P.mediaInfo || 0,
    sinceId: P.sinceId,
    errors: (P.errors || []).slice(0, 5),
    docH: document.body ? document.body.scrollHeight : 0
  });
})()
"""


def slugify(url):
    m = re.search(r"weibo\.com/u/(\d+)", url) or re.search(r"weibo\.com/([A-Za-z0-9_%]+)", url) \
        or re.search(r"weibo\.cn/(\d+)", url)
    who = (m.group(1) if m else "page")[:18]
    return "%s-%s" % (who, time.strftime("%H%M%S"))


def shot(cdp, sid, path):
    try:
        s = cdp.send("Page.captureScreenshot", {"format": "png"}, sid)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(base64.b64decode(s["data"]))
        return path
    except Exception as e:
        return "shot failed: %s" % e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--port", type=int, default=9223)
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--wait", type=int, default=10)
    a = ap.parse_args()

    if not re.search(r"https?://(www\.)?(weibo\.com|m\.weibo\.cn)/", a.url):
        print("只接受 weibo.com / m.weibo.cn 主页地址")
        return 2

    os.makedirs(OUT, exist_ok=True)
    slug = slugify(a.url)

    try:
        cdp = Cdp("http://127.0.0.1:%d" % a.port)
    except Exception as e:
        print("连不上 CDP %d：%s" % (a.port, e))
        return 3

    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    sid = cdp.attach(tid)
    cdp.send("Runtime.enable", {}, sid)
    cdp.send("Page.enable", {}, sid)
    cdp.send("Network.enable", {}, sid)
    cdp.send("Page.addScriptToEvaluateOnNewDocument", {"source": HOOK}, sid)

    print("[1] 打开 %s" % a.url)
    cdp.send("Page.navigate", {"url": a.url}, sid)
    time.sleep(a.wait)

    dom = cdp.eval(DOM, sid)
    try:
        dom = json.loads(dom) if isinstance(dom, str) else dom
    except Exception:
        dom = {"raw": dom}
    if dom.get("blocked"):
        print("    ⚠ 页面疑似风控/验证页：%s" % dom.get("title"))

    roll = []
    for i in range(max(0, a.rounds)):
        b = cdp.eval("window.__vrWbProbe ? window.__vrWbProbe.hits.length : 0", sid)
        cdp.eval("window.scrollTo(0, document.body.scrollHeight); 1", sid)
        wait = 1.4 + random.random() * 1.2
        time.sleep(wait + 1.0)
        af = cdp.eval("window.__vrWbProbe ? window.__vrWbProbe.hits.length : 0", sid)
        st = cdp.eval("window.__vrWbProbe ? window.__vrWbProbe.statusCount : 0", sid)
        roll.append({"round": i + 1, "wait": round(wait, 1),
                     "hitsBefore": b, "hitsAfter": af, "statusCount": st})
        print("    第 %d 轮：接口 %s→%s，条目累计 %s" % (i + 1, b, af, st))
        if isinstance(af, int) and isinstance(b, int) and af == b and i >= 1:
            print("    连续无新响应，提前结束滚动")
            break

    state = json.loads(cdp.eval(STATE, sid) or "{}")
    dom2 = cdp.eval(DOM, sid)
    try:
        dom2 = json.loads(dom2) if isinstance(dom2, str) else dom2
    except Exception:
        dom2 = {"raw": dom2}
    shot_path = shot(cdp, sid, os.path.join(OUT, slug + "-shot.png"))

    dump = {"url": a.url, "slug": slug, "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "state": state, "roll": roll, "domBefore": dom, "domAfter": dom2}
    with open(os.path.join(OUT, slug + "-dump.json"), "w", encoding="utf-8") as f:
        json.dump(dump, f, ensure_ascii=False, indent=2)

    concl = {
        "endpointsSeen": state.get("endpoints", {}),
        "statusCount": state.get("statusCount", 0),
        "picFields": state.get("picFields", 0),
        "mediaInfo": state.get("mediaInfo", 0),
        "sinceIdPresent": state.get("sinceId") is not None,
        "blocked": bool(dom2.get("blocked")),
        "domBigImgs": dom2.get("bigImgs", 0),
        "domVideos": dom2.get("videos", 0),
        "errors": state.get("errors", []),
    }
    with open(os.path.join(OUT, slug + "-report.json"), "w", encoding="utf-8") as f:
        json.dump(concl, f, ensure_ascii=False, indent=2)

    print("\n[2] 接口与字段")
    print("    命中接口：%s" % concl["endpointsSeen"])
    print("    条目累计：%s   pic_infos/%s   media_info/page_info：%s   since_id：%s"
          % (concl["statusCount"], concl["picFields"], concl["mediaInfo"], concl["sinceIdPresent"]))
    print("[3] DOM 侧（现有扫描口径）")
    print("    <img> 总数 %s，正文大图 %s，<video> %s"
          % (dom2.get("imgs"), concl["domBigImgs"], concl["domVideos"]))
    print("    风控页：%s" % concl["blocked"])
    print("[4] 产物：%s\n    截图：%s" % (os.path.join(OUT, slug + "-dump.json"), shot_path))

    try:
        cdp.send("Target.closeTarget", {"targetId": tid})
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
