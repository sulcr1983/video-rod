# -*- coding: utf-8 -*-
"""X(推特) 博主主页时间线探针（真机只读）

目的：把 docs/COMPETITOR-PLUCKER.md §六 的四个未知项定性。
    ① 时间线 GraphQL 响应是否**直带** video_info.variants（决定视频要不要走 fxtwitter）
    ② pbs.twimg.com 原图 / video.twimg.com 不带 Referer 是否 403
    ③ 博主主页滚动多少轮到底、是否出现 429
    ④ 响应的字段路径与解析器假设是否一致（直接用产品同一份
       js/lib/twitter-timeline.js 在页面里解析，比对「拦截到的」与「解析出的」）

铁律（照 docs/TESTING.md §0.0）：
    · 只读、单页、不循环、不发私有请求（不抓 Authorization，不代发 GraphQL）
    · 复用现成登录态：星愿 9223；没有就明确报错退出，不擅自重启用户浏览器
    · 每轮滚动间随机间隔 1.4~2.6 秒，最多 --rounds 轮

用法：
    python tools/x-timeline-probe.py --url https://x.com/<user>/media
    python tools/x-timeline-probe.py --url https://x.com/<user> --rounds 6 --port 9223

产物：
    .tmp/x-probe/<slug>-dump.json     原始响应结构样本（脱敏后）
    .tmp/x-probe/<slug>-shot.png      截图
    .tmp/x-probe/<slug>-report.json   探针结论
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
LIB = os.path.join(ROOT, "js", "lib", "twitter-timeline.js")
OUT = os.path.join(ROOT, ".tmp", "x-probe")

# ---------------------------------------------------------------- 注入脚本
# 在页面主世界、文档开始前安装：
#   1. 旁读 fetch / XHR（clone 后读，不消耗页面 body，不改页面行为）
#   2. 只认时间线类 GraphQL（GraphQL 端点 + UserTweets/UserMedia/...）
#   3. 记录 URL、响应键名结构、是否含 video_info、cursor
#   4. 用产品同一份 VRTwitterTimeline 解析，统计解析结果
HOOK = r"""
(function () {
  'use strict';
  if (window.__vrProbe) { return; }
  var P = window.__vrProbe = {
    hits: [], errors: [], parsed: 0, parsedMedias: 0,
    hasVideoInfo: 0, hasVideoVariants: 0, endpoints: {}, keys: {},
    videoSample: null, mediaTypes: {}, statuses: [], referer: null
  };
  var TL_RE = /\/graphql\/[^/]+\/(UserTweets|UserTweetsAndReplies|UserMedia|Likes|UserPhotoTimeline|UserVideoTimeline|SearchTimeline|TweetDetail)\b/;

  function record(url, text) {
    var m = TL_RE.exec(String(url || ''));
    if (!m) { return; }
    P.endpoints[m[1]] = (P.endpoints[m[1]] || 0) + 1;
    var json;
    try { json = JSON.parse(text); } catch (e) { P.errors.push('json: ' + e); return; }
    P.hits.push({ op: m[1], at: Date.now(), bytes: text.length });

    /* 结构采样：只看键名，不落内容（脱敏） */
    function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 9) { return; }
      if (Array.isArray(o)) { for (var i = 0; i < Math.min(o.length, 3); i++) { walk(o[i], depth + 1); } return; }
      for (var k in o) {
        if (!Object.prototype.hasOwnProperty.call(o, k)) { continue; }
        P.keys[k] = (P.keys[k] || 0) + 1;
        if (k === 'video_info') { P.hasVideoInfo++; }
        if (k === 'variants' && Array.isArray(o[k])) {
          P.hasVideoVariants++;
          if (!P.videoSample) {
            P.videoSample = o[k].map(function (v) {
              return { ct: v && v.content_type, bitrate: v && v.bitrate,
                       urlHead: String(v && v.url || '').slice(0, 60) };
            });
          }
        }
        if (k === 'type' && typeof o[k] === 'string') {
          P.mediaTypes[o[k]] = (P.mediaTypes[o[k]] || 0) + 1;
        }
        walk(o[k], depth + 1);
      }
    }
    walk(json, 0);

    /* 媒体对象样本：X 新版可能不再给 type/video_info ——
     * 把第一个「像媒体」的对象的键名与关键值截断类型记下来，供解析器对齐。 */
    if (!P.mediaSample) {
      (function findMedia(o, depth) {
        if (P.mediaSample || !o || typeof o !== 'object' || depth > 12) { return; }
        if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) { findMedia(o[i], depth + 1); } return; }
        var looksMedia = o.media_url_https || o.media_key ||
          (o.extended_entities && o.extended_entities.media);
        if (looksMedia && !o.rest_id) {
          var keys = Object.keys(o);
          var preview = {};
          keys.forEach(function (k) {
            var v = o[k];
            if (v == null) { preview[k] = null; }
            else if (typeof v === 'string') { preview[k] = String(v).slice(0, 70); }
            else if (typeof v === 'number' || typeof v === 'boolean') { preview[k] = v; }
            else if (Array.isArray(v)) { preview[k] = '[array:' + v.length + ']'; }
            else if (typeof v === 'object') { preview[k] = '{' + Object.keys(v).slice(0, 6).join(',') + '}'; }
          });
          P.mediaSample = preview;
          return;
        }
        for (var k2 in o) { if (Object.prototype.hasOwnProperty.call(o, k2)) { findMedia(o[k2], depth + 1); } }
      })(json, 0);
    }

    var T = window.VRTwitterTimeline;
    if (T) {
      try {
        var r = T.parseTimeline(json);
        P.parsed += r.tweets.length;
        for (var i = 0; i < r.tweets.length; i++) {
          var t = r.tweets[i];
          P.parsedMedias += t.media.length;
          if (P.statuses.length < 40) {
            P.statuses.push({ id: t.statusId.slice(0, 6) + '…', rt: t.isRetweet, q: t.isQuote,
                              medias: t.media.length });
          }
        }
        if (r.nextCursor && P.statuses.length < 40) { P.cursor = true; }
      } catch (e) { P.errors.push('parse: ' + e); }
    }
  }

  var of = window.fetch;
  window.fetch = function (input, init) {
    var p = of.apply(this, arguments);
    var u = typeof input === 'string' ? input : (input && input.url) || '';
    try {
      if (TL_RE.test(u)) {
        p.then(function (r) { return r.clone().text(); })
         .then(function (t) { record(u, t); }, function () {});
      }
    } catch (e) { /* 忽略 */ }
    return p;
  };

  var XP = XMLHttpRequest.prototype, oo = XP.open, os_ = XP.send;
  XP.open = function (m, u) { try { this.__pUrl = String(u || ''); } catch (e) {} return oo.apply(this, arguments); };
  XP.send = function () {
    var x = this;
    try {
      x.addEventListener('load', function () {
        try {
          if (!TL_RE.test(x.__pUrl || '')) { return; }
          var rt = x.responseType;
          if (rt && rt !== 'text' && rt !== 'json') { return; }
          record(x.__pUrl, rt === 'json' ? JSON.stringify(x.response) : x.responseText);
        } catch (e) { /* 忽略 */ }
      });
    } catch (e) {}
    return os_.apply(this, arguments);
  };
})();
"""

# 页面加载后调用：测两件事——(a) 原图不带 Referer 是否可下；(b) 页面自己请求时带什么。
REFERER_PROBE = r"""
(async () => {
  const out = { at: location.href, imgs: [], notes: [] };
  const media = Array.from(document.querySelectorAll('img[src*="pbs.twimg.com/media"]'))
    .slice(0, 3).map(i => i.src);
  for (const raw of media) {
    const stem = raw.split('?')[0];
    const fmt = (raw.match(/[?&]format=([a-z0-9]+)/i) || [])[1] || (stem.match(/\.(\w+)$/) || [])[1] || 'jpg';
    const url = /\.\w+$/.test(stem) ? stem + '?name=orig' : stem + '?format=' + fmt + '&name=orig';
    const r = { url: url.slice(0, 100) };
    for (const mode of ['no-referrer', 'same-origin']) {
      try {
        const res = await fetch(url, { credentials: 'omit', referrerPolicy: mode });
        r[mode] = res.status;
        r[mode + '_ct'] = (res.headers.get('content-type') || '').slice(0, 30);
        r[mode + '_len'] = Number(res.headers.get('content-length') || 0);
      } catch (e) {
        r[mode] = 'ERR:' + String(e).slice(0, 40);
      }
    }
    out.imgs.push(r);
  }
  const v = document.querySelector('video');
  if (v && (v.currentSrc || v.src)) {
    out.videoSrc = String(v.currentSrc || v.src).slice(0, 120);
    try {
      const res = await fetch(out.videoSrc, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      out.videoStatus = res.status;
      out.videoCT = (res.headers.get('content-type') || '').slice(0, 40);
    } catch (e) { out.videoStatus = 'ERR:' + String(e).slice(0, 40); }
  }
  if (!media.length) { out.notes.push('页面上没有 pbs.twimg.com/media 图片'); }
  return JSON.stringify(out);
})()
"""

STATE = r"""
(() => {
  const P = window.__vrProbe || {};
  return JSON.stringify({
    hasProbe: !!window.__vrProbe,
    hits: (P.hits || []).length,
    endpoints: P.endpoints || {},
    parsed: P.parsed || 0,
    parsedMedias: P.parsedMedias || 0,
    hasVideoInfo: P.hasVideoInfo || 0,
    hasVideoVariants: P.hasVideoVariants || 0,
    videoSample: P.videoSample || null,
    mediaTypes: P.mediaTypes || {},
    statuses: (P.statuses || []).slice(0, 12),
    errors: (P.errors || []).slice(0, 5),
    scrollY: Math.round(window.scrollY),
    docH: document.body ? document.body.scrollHeight : 0,
    cards: document.querySelectorAll('article[data-testid="tweet"]').length
  });
})()
"""


def slugify(url):
    m = re.search(r"x\.com/([A-Za-z0-9_]+)", url) or re.search(r"twitter\.com/([A-Za-z0-9_]+)", url)
    who = m.group(1) if m else "page"
    kind = "media" if "/media" in url else ("photo" if "/photo" in url else "timeline")
    return "%s-%s-%s" % (who.lower(), kind, time.strftime("%H%M%S"))


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
    ap.add_argument("--url", required=True, help="博主主页，如 https://x.com/someone/media")
    ap.add_argument("--port", type=int, default=9223)
    ap.add_argument("--rounds", type=int, default=4, help="最多滚几轮（每轮约一屏，带随机间隔）")
    ap.add_argument("--wait", type=int, default=10, help="首屏等待秒数")
    a = ap.parse_args()

    if not re.search(r"https?://(x|twitter)\.com/", a.url):
        print("只接受 x.com / twitter.com 博主主页地址")
        return 2

    os.makedirs(OUT, exist_ok=True)
    slug = slugify(a.url)

    # 星愿调试端口：9223。连不上就明确报错——不擅自重启用户的主力浏览器。
    try:
        cdp = Cdp("http://127.0.0.1:%d" % a.port)
    except Exception as e:
        print("连不上 CDP %d：%s" % (a.port, e))
        print("星愿需要带 --remote-debugging-port=%d 启动（重启会丢失当前会话，需用户确认）。" % a.port)
        return 3

    lib_src = open(LIB, encoding="utf-8").read()

    tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
    sid = cdp.attach(tid)
    cdp.send("Runtime.enable", {}, sid)
    cdp.send("Page.enable", {}, sid)
    cdp.send("Network.enable", {}, sid)

    # 注入顺序很重要：产品解析库先就位，hook 才能立刻引用它
    cdp.send("Page.addScriptToEvaluateOnNewDocument", {"source": lib_src}, sid)
    cdp.send("Page.addScriptToEvaluateOnNewDocument", {"source": HOOK}, sid)

    print("[1] 打开 %s" % a.url)
    cdp.send("Page.navigate", {"url": a.url}, sid)
    time.sleep(a.wait)

    roll = []
    for i in range(max(0, a.rounds)):
        before = cdp.eval("window.__vrProbe ? window.__vrProbe.hits.length : 0", sid)
        cdp.eval("window.scrollTo(0, document.body.scrollHeight); 1", sid)
        wait = 1.4 + random.random() * 1.2
        time.sleep(wait + 1.2)
        after = cdp.eval("window.__vrProbe ? window.__vrProbe.hits.length : 0", sid)
        cards = cdp.eval("document.querySelectorAll('article[data-testid=\"tweet\"]').length", sid)
        roll.append({"round": i + 1, "wait": round(wait, 1),
                     "hitsBefore": before, "hitsAfter": after, "cards": cards})
        print("    第 %d 轮：hit %s→%s，卡片 %s" % (i + 1, before, after, cards))
        if isinstance(after, int) and isinstance(before, int) and after == before and i >= 2:
            print("    连续无新响应，提前结束滚动")
            break

    state = json.loads(cdp.eval(STATE, sid) or "{}")
    ref = cdp.eval(REFERER_PROBE, sid)
    try:
        ref = json.loads(ref) if isinstance(ref, str) else ref
    except Exception:
        ref = {"raw": ref}

    shot_path = shot(cdp, sid, os.path.join(OUT, slug + "-shot.png"))

    # 响应里可能含账号信息：样本只留结构与统计，不落全文
    dump = {
        "url": a.url,
        "slug": slug,
        "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "state": state,
        "roll": roll,
        "referer": ref,
    }
    with open(os.path.join(OUT, slug + "-dump.json"), "w", encoding="utf-8") as f:
        json.dump(dump, f, ensure_ascii=False, indent=2)

    # ---------------- 结论 ----------------
    concl = {
        "timelineHit": state.get("hits", 0) > 0,
        "endpoints": state.get("endpoints", {}),
        "parsedTweets": state.get("parsed", 0),
        "parsedMedias": state.get("parsedMedias", 0),
        "videoVariantsInline": state.get("hasVideoVariants", 0) > 0,
        "videoSample": state.get("videoSample"),
        "mediaTypes": state.get("mediaTypes", {}),
        "errors": state.get("errors", []),
    }
    imgs = (ref or {}).get("imgs") or []
    if imgs:
        concl["imageNoReferer"] = [i.get("no-referrer") for i in imgs]
        concl["imageSameOrigin"] = [i.get("same-origin") for i in imgs]
    if (ref or {}).get("videoStatus") is not None:
        concl["videoNoReferer"] = ref.get("videoStatus")
    with open(os.path.join(OUT, slug + "-report.json"), "w", encoding="utf-8") as f:
        json.dump(concl, f, ensure_ascii=False, indent=2)

    print("\n[2] 响应与解析")
    print("    时间线响应命中：%s  %s" % (concl["timelineHit"], concl["endpoints"]))
    print("    解析推文 %s 条 / 媒体 %s 个" % (concl["parsedTweets"], concl["parsedMedias"]))
    print("    响应直带 video_info.variants：%s" % concl["videoVariantsInline"])
    if concl["videoSample"]:
        print("    视频变体样本：%s" % json.dumps(concl["videoSample"], ensure_ascii=False)[:300])
    print("[3] 防盗链")
    for k in ("imageNoReferer", "imageSameOrigin", "videoNoReferer"):
        if k in concl:
            print("    %-16s %s" % (k + ":", concl[k]))
    print("[4] 产物：%s" % os.path.join(OUT, slug + "-dump.json"))
    print("    截图：%s" % shot_path)

    try:
        cdp.send("Target.closeTarget", {"targetId": tid})
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
