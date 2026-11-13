# -*- coding: utf-8 -*-
"""推特时间线夹具端到端验证（e2e）

验证链路（全部离线，零风控、不碰真实站点）：
    页面 fetch 分页 mock GraphQL
      → 主世界 hook 旁读响应（clone 后读，不消耗页面 body）
      → postMessage 给「内容脚本侧」
      → VRTwitterTimeline.parseMediaItems 解析
      → 按 key 去重入队（字段与 vrBulkDownload 消费口径一致）
      → scrollStep 判定停止

页面：test-site/x-timeline-fake.html
库：  js/lib/twitter-timeline.js（与扩展共用同一份，不复制）

用法：
    python tools/e2e-x-timeline.py --serve        # 只起服务并打印 URL（给人肉/浏览器验收）
    python tools/e2e-x-timeline.py --port 9480    # CDP 跑断言（隔离实例，非真实站点）
    python tools/e2e-x-timeline.py --port 9480 --ext <id>
"""
import argparse
import http.server
import json
import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE_PATH = os.path.join(ROOT, "test-site", "x-timeline-fake.html")
LIB_PATH = os.path.join(ROOT, "js", "lib", "twitter-timeline.js")

# ---------------------------------------------------------------- mock 数据
# 3 页，共 6 条推文 / 7 个媒体。刻意覆盖解析分支：
#   第 1 页：图片 + 视频（可见性包装）
#   第 2 页：转推（媒体在 retweeted_status_result）+ 纯文字
#   第 3 页：引用（本体无媒体，媒体在 quoted_status_result）+ 动图
PHOTO1 = {"type": "photo", "id_str": "9101",
          "media_url_https": "https://pbs.twimg.com/media/FAKE_A.jpg"}
PHOTO2 = {"type": "photo", "id_str": "9102",
          "media_url_https": "https://pbs.twimg.com/media/FAKE_B?format=jpg&name=small"}
PHOTO3 = {"type": "photo", "id_str": "9105",
          "media_url_https": "https://pbs.twimg.com/media/FAKE_C.jpg"}
VIDEO = {"type": "video", "id_str": "9103",
         "media_url_https": "https://pbs.twimg.com/media/FAKE_T.jpg",
         "video_info": {"variants": [
             {"content_type": "video/mp4", "bitrate": 2176000, "url": "https://video.twimg.com/hi.mp4"},
             {"content_type": "video/mp4", "bitrate": 832000, "url": "https://video.twimg.com/lo.mp4"},
             {"content_type": "application/x-mpegURL", "url": "https://video.twimg.com/p.m3u8"},
         ]}}
GIF = {"type": "animated_gif", "id_str": "9104",
       "media_url_https": "https://pbs.twimg.com/media/FAKE_G.jpg",
       "video_info": {"variants": [
           {"content_type": "video/mp4", "bitrate": 0, "url": "https://video.twimg.com/g.mp4"}]}}


def _tweet(tid, text, media=None, handle="fixture_user", name="夹具作者", rt=None, quote=None,
           visibility=False):
    t = {
        "__typename": "Tweet",
        "rest_id": str(tid),
        "core": {"user_results": {"result": {"legacy": {"name": name, "screen_name": handle}}}},
        "legacy": {
            "full_text": text,
            "created_at": "Sat Nov 01 00:00:00 +0000 2025",
            "user_id_str": "800000001",
        },
    }
    if media:
        t["legacy"]["extended_entities"] = {"media": media}
    if rt:
        t["legacy"]["retweeted_status_result"] = {"result": rt}
    if quote:
        t["quoted_status_result"] = {"result": quote}
    if visibility:
        return {"__typename": "TweetWithVisibilityResults", "tweet": t}
    return t


def _entry(eid, sort_index, res):
    return {
        "sortIndex": str(sort_index),
        "content": {
            "entryType": "TimelineTimelineItem",
            "itemType": "TimelineTweet",
            "itemContent": {"tweet_results": {"result": res}},
        },
    }


ORIG = _tweet(9301, "被转推的原推", media=[PHOTO3], handle="orig_user", name="原推作者")
QUOTED = _tweet(9401, "被引用的推文", media=[PHOTO2], handle="quoted_user", name="被引用作者")

# 分页语义：req = 请求本页时带的 cursor（首页为空串），next = 本页返回的 nextCursor。
# 早先把「本页自己的 cursor」当匹配键，结果第 2 页永远匹配到第 1 页，无限循环。
PAGES = [
    {
        "req": "",
        "next": "C2",
        "entries": [
            _entry(9201, 100, _tweet(9201, "第一页图片", media=[PHOTO1])),
            _entry(9202, 99, _tweet(9202, "第一页视频 https://t.co/x", media=[VIDEO], visibility=True)),
        ],
    },
    {
        "req": "C2",
        "next": "C3",
        "entries": [
            _entry(9203, 98, _tweet(9203, "RT @orig_user: 被转推的原推", rt=ORIG)),
            _entry(9204, 97, _tweet(9204, "纯文字，无媒体")),
        ],
    },
    {
        "req": "C3",
        "next": "",
        "entries": [
            _entry(9205, 96, _tweet(9205, "引用它", quote=QUOTED)),
            _entry(9206, 95, _tweet(9206, "动图推文", media=[GIF])),
        ],
    },
]

# 期望：6 条推文（含 1 条纯文字）、5 个媒体
#   9201 图 / 9202 视频 / 9203 转推图 / 9205 引用图 / 9206 动图
EXPECT_TWEETS = 6
EXPECT_MEDIA = 5


def build_page(path):
    """按查询串里的 cursor 返回一页 GraphQL 响应。

    注意：判断「有没有 cursor」必须看 **查询串**，不能看整个 path ——
    `/mock/UserTweets` 本身是非空字符串，拿它当 cursor 会永远落到空页分支
    （实测症状：hook 有命中、tweets 恒 0）。
    """
    query = path.split("?", 1)[1] if "?" in path else ""
    cursor = ""
    for seg in query.split("&"):
        if seg.startswith("cursor="):
            cursor = seg[len("cursor="):]
            break

    page = None
    for p in PAGES:
        if p["req"] == cursor:
            page = p
            break
    if page is None:
        page = {"req": cursor, "next": "", "entries": []}   # 未知 cursor：视为到底
    return {
        "data": {
            "user": {
                "result": {
                    "timeline_v2": {
                        "timeline": {
                            "instructions": [
                                {"type": "TimelineAddEntries", "entries": page["entries"] + [
                                    {"content": {"entryType": "TimelineTimelineCursor",
                                                 "cursorType": "Bottom",
                                                 "value": page["next"] or ""}}
                                ]}
                            ]
                        }
                    }
                }
            }
        }
    }


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body, ctype="application/json; charset=utf-8", code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/x-timeline-fake.html"):
            with open(PAGE_PATH, "rb") as f:
                return self._send(f.read(), "text/html; charset=utf-8")
        if path == "/js/lib/twitter-timeline.js":
            with open(LIB_PATH, "rb") as f:
                return self._send(f.read(), "application/javascript; charset=utf-8")
        if path == "/mock/UserTweets":
            body = json.dumps(build_page(self.path), ensure_ascii=False).encode("utf-8")
            return self._send(body)
        return self._send(b"not found", "text/plain", 404)


def start_site():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


# ---------------------------------------------------------------- 断言
results = []


def check(name, got, expect):
    ok = got == expect
    results.append((ok, name, got, expect))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f"   got={got!r} expect={expect!r}"))


def run_cdp(port, ext_id):
    from cdp_client import Cdp  # noqa: E402
    site = start_site()
    url = "http://127.0.0.1:%d/x-timeline-fake.html" % site
    cdp = Cdp("http://127.0.0.1:%d" % port)
    tid = cdp.send("Target.createTarget", {"url": url})["targetId"]
    sid = cdp.attach(tid)
    cdp.send("Runtime.enable", {}, sid)
    cdp.send("Page.enable", {}, sid)
    time.sleep(2.0)

    def ev(js):
        r = cdp.eval(js, sid)
        if isinstance(r, dict) and "__error" in r:
            raise RuntimeError(r["__error"])
        return r

    check("E1 fixture 就绪", ev("!!(window.__vrXFixture && window.__vrXFixture.ready)"), True)
    ev("window.__vrXStart()")
    for _ in range(60):
        if ev("!!window.__vrXFixture.done"):
            break
        time.sleep(0.25)

    check("E2 拦截到时间线请求", ev("window.__vrXFixture.hooked") > 0, True)
    check("E3 推文总数", ev("window.__vrXFixture.tweets"), EXPECT_TWEETS)
    check("E4 媒体项总数", ev("window.__vrXFixture.queue.length"), EXPECT_MEDIA)
    check("E5 无解析异常", ev("window.__vrXFixture.errors.length"), 0)
    check("E6 已停止", ev("!!window.__vrXFixture.done"), True)
    check("E7 停止原因合理",
          ev("window.__vrXFixture.stops.length && window.__vrXFixture.stops[window.__vrXFixture.stops.length-1].reason")
          in ("idle", "bottom", "max-rounds"), True)

    # 入队字段必须与 vrBulkDownload 口径一致
    q = ev("JSON.stringify(window.__vrXFixture.queue[1])")
    item = json.loads(q)
    check("E8 视频取最高码率", item.get("url"), "https://video.twimg.com/hi.mp4")
    check("E9 site=x", item.get("site"), "x")
    check("E10 带 pageUrl", item.get("pageUrl"), "https://x.com/fixture_user/status/9202")
    check("E11 已去重（key 唯一）",
          ev("new Set(window.__vrXFixture.queue.map(function(x){return x.key})).size"),
          ev("window.__vrXFixture.queue.length"))

    try:
        cdp.send("Target.closeTarget", {"targetId": tid})
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0, help="CDP 端口；0 表示只起服务")
    ap.add_argument("--ext", default="")
    ap.add_argument("--serve", action="store_true", help="只起服务并打印 URL，阻塞等待")
    a = ap.parse_args()

    if a.serve or not a.port:
        site = start_site()
        print("http://127.0.0.1:%d/x-timeline-fake.html" % site)
        if a.serve:
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                pass
        return 0

    run_cdp(a.port, a.ext)
    n = len(results)
    ok = sum(1 for r in results if r[0])
    print("\n%d/%d PASS" % (ok, n))
    return 0 if ok == n else 1


if __name__ == "__main__":
    sys.exit(main())
