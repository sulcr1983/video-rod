# 验证：1) 各种 fnval 下 B站能给到的最高清晰度  2) mp4box 能否把 DASH 画面+声音合成可播 MP4
# 星愿浏览器 CDP 9223
import json
import os
import time
import urllib.request

from websocket import create_connection

CDP_URL = "http://127.0.0.1:9223"
BILI_URL = "https://www.bilibili.com/video/BV1DVaZ6hEK6/"
DL_DIR = r"E:\personal\Downloads"
MP4BOX = r"E:\test\download\video-rod\lib\mp4box.all.min.js"
OUT_NAME = "钓鱼竿1080P合成验证.mp4"

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Cdp:
    def __init__(self, url):
        ver = json.load(_opener.open(url + "/json/version"))
        self.ws = create_connection(ver["webSocketDebuggerUrl"], suppress_origin=True, timeout=180)
        self.mid = 0

    def send(self, method, params=None, session=None):
        self.mid += 1
        msg = {"id": self.mid, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        self.ws.send(json.dumps(msg))
        while True:
            raw = self.ws.recv()
            if not raw:
                continue
            r = json.loads(raw)
            if r.get("id") == self.mid:
                if "error" in r:
                    raise RuntimeError(f"{method}: {r['error']}")
                return r.get("result", {})
            # 事件帧忽略

    def eval(self, expr, session, timeout=180):
        r = self.send("Runtime.evaluate", {
            "expression": expr, "returnByValue": True, "awaitPromise": True
        }, session)
        if r.get("exceptionDetails"):
            return {"__error": json.dumps(r["exceptionDetails"])[:800]}
        return r.get("result", {}).get("value")

    def attach(self, tid):
        return self.send("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]

    def targets(self):
        return self.send("Target.getTargets")["targetInfos"]


def main():
    cdp = Cdp(CDP_URL)

    # 复用已有的 B站 标签页（保留登录态）
    tid = None
    for t in cdp.targets():
        if t.get("type") == "page" and "bilibili.com/video" in t.get("url", ""):
            tid = t["targetId"]
            break
    if not tid:
        tid = cdp.send("Target.createTarget", {"url": BILI_URL})["targetId"]
        time.sleep(12)
    psid = cdp.attach(tid)
    cdp.send("Page.enable", {}, psid)
    print("页面:", [t.get("url") for t in cdp.targets() if t["targetId"] == tid])

    # ---------- 第一步：读 cid / bvid ----------
    info = cdp.eval(r"""
      (() => {
        const s = window.__INITIAL_STATE__ || {};
        const v = s.videoData || {};
        return { cid: v.cid, bvid: v.bvid, aid: v.aid, title: v.title, hasState: !!s.videoData };
      })()
    """, psid)
    print("\n[1] 页面状态:", json.dumps(info, ensure_ascii=False))
    if not info.get("cid"):
        print("  ❌ 拿不到 cid，页面可能没加载完")
        return
    cid, bvid = info["cid"], info["bvid"]

    # ---------- 第二步：扫 fnval，看每种能给到的最高清晰度 ----------
    print("\n[2] 扫描 fnval / qn 组合（qn=127 要最高档）")
    scan = None
    if os.environ.get("VR_SKIP_SCAN"):
        print("   (已跳过)")
    else:
      scan = cdp.eval(r"""
      (async () => {
        const cid = %s, bvid = %s;
        const out = [];
        for (const fnval of [0, 1, 2, 4, 8, 16, 80, 4048]) {
          for (const qn of [127, 80]) {
            const u = 'https://api.bilibili.com/x/player/playurl?cid=' + cid +
                      '&qn=' + qn + '&bvid=' + bvid + '&otype=json&platform=html5&high_quality=1' +
                      '&fnval=' + fnval;
            try {
              const r = await new Promise((res, rej) => {
                const x = new XMLHttpRequest();
                x.open('GET', u, true); x.withCredentials = true;
                x.timeout = 20000;
                x.onload = () => res(x.responseText);
                x.onerror = () => rej(new Error('net'));
                x.ontimeout = () => rej(new Error('timeout'));
                x.send();
              });
              const j = JSON.parse(r);
              const d = j.data || {};
              const rec = { fnval, qn, code: j.code, quality: d.quality, format: d.format };
              if (d.durl && d.durl.length) {
                rec.type = 'durl';
                rec.size = d.durl.reduce((a, b) => a + (b.size || 0), 0);
                rec.segs = d.durl.length;
              } else if (d.dash) {
                rec.type = 'dash';
                const vs = (d.dash.video || []).map(v => ({
                  id: v.id, w: v.width, h: v.height, size: v.size || (v.bandwidth ? 0 : 0)
                }));
                vs.sort((a, b) => (b.w * b.h) - (a.w * a.h));
                rec.bestVideo = vs[0] || null;
                rec.videoCount = vs.length;
                rec.audioCount = (d.dash.audio || []).length;
                rec.acceptQuality = d.accept_quality;
              } else {
                rec.type = 'none'; rec.msg = (j.message || '').slice(0, 40);
              }
              out.push(rec);
            } catch (e) { out.push({ fnval, qn, err: String(e) }); }
          }
        }
        return out;
      })()
    """ % (json.dumps(cid), json.dumps(bvid)), psid)
    if isinstance(scan, list):
        for r in scan:
            print("   ", json.dumps(r, ensure_ascii=False))
    elif scan is not None:
        print("   扫描失败:", scan)

    # ---------- 第三步：注入 mp4box + 拉 DASH 最高画质 + 合成 + 落盘 ----------
    print("\n[3] 注入 mp4box 并合成 DASH 最高画质")
    try:
        with open(MP4BOX, "r", encoding="utf-8", errors="strict") as f:
            src = f.read()
    except Exception as e:
        print("  ❌ 读 mp4box 失败:", e)
        return
    # 两步注入：源码单独求值（min.js 结尾的 //# 注释会吃掉后续拼接代码），再查 MP4Box
    r1 = cdp.eval(src, psid)
    print("   注入返回值类型:", type(r1).__name__)
    ok = cdp.eval("(() => { try { return typeof MP4Box + '/' + typeof MP4Box.createFile; } catch(e){ return 'ERR:'+e; } })()", psid)
    print("   MP4Box 挂载结果:", ok)
    if not (isinstance(ok, str) and ok.startswith("object")):
        print("  ❌ MP4Box 没挂上，停")
        return
    print("   ✅ MP4Box 可用")

    mux = cdp.eval(r"""
      (async () => {
        const cid = %s, bvid = %s;
        const log = {};
        // 取 DASH
        const u = 'https://api.bilibili.com/x/player/playurl?cid=' + cid + '&qn=127&bvid=' + bvid +
                  '&otype=json&platform=html5&high_quality=1&fnval=16';
        const txt = await new Promise((res, rej) => {
          const x = new XMLHttpRequest();
          x.open('GET', u, true); x.withCredentials = true; x.timeout = 20000;
          x.onload = () => res(x.responseText); x.onerror = () => rej(new Error('net'));
          x.send();
        });
        const j = JSON.parse(txt);
        const dash = j.data && j.data.dash;
        if (!dash) return { err: 'no dash' };
        const vs = (dash.video || []).slice().sort((a, b) => (b.width * b.height) - (a.width * a.height));
        const as = (dash.audio || []).slice().sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
        if (!vs.length || !as.length) return { err: 'dash empty', v: vs.length, a: as.length };
        const V = vs[0], A = as[0];
        log.video = { id: V.id, w: V.width, h: V.height, codecs: V.codecs, url: V.baseUrl || V.base_url };
        log.audio = { id: A.id, codecs: A.codecs, url: A.baseUrl || A.base_url };

        // 下载两段
        const getBuf = (url) => new Promise((res, rej) => {
          const x = new XMLHttpRequest();
          x.open('GET', url, true); x.responseType = 'arraybuffer';
          x.timeout = 180000;
          x.onload = () => res(x.response);
          x.onerror = () => rej(new Error('dl fail'));
          x.ontimeout = () => rej(new Error('dl timeout'));
          x.send();
        });
        const t0 = Date.now();
        let vb, ab;
        try {
          vb = await getBuf(log.video.url);
          ab = await getBuf(log.audio.url);
        } catch (e) { return Object.assign(log, { err: 'fetch: ' + e }); }
        log.vBytes = vb.byteLength; log.aBytes = ab.byteLength;
        log.fetchMs = Date.now() - t0;

        // ---- 合成 ----
        try {
          const f = MP4Box.createFile();
          let muxErr = null;
          f.onError = (e) => { muxErr = String(e); };
          // 关键修复：mp4box 要求 buffer 带 fileStart
          vb.fileStart = 0;
          f.appendBuffer(vb);
          ab.fileStart = 0;
          f.appendBuffer(ab);
          f.flush();
          log.muxErr = muxErr;
          // 解析情况：moov / traks（注意 mp4box 没有 getTracks，要看 f.moov.traks）
          log.hasMoov = !!f.moov;
          log.trakCount = (f.moov && f.moov.traks) ? f.moov.traks.length : 0;
          log.boxTypes = (f.boxes || []).map(b => b.type);
          try {
            var gi = f.getInfo ? f.getInfo() : null;
            if (gi) {
              log.info = {
                duration: gi.duration, timescale: gi.timescale,
                isFragmented: gi.isFragmented, brands: gi.brands,
                tracks: (gi.tracks || []).map(t => ({ id: t.id, type: t.type, codec: t.codec, nb_samples: t.nb_samples }))
              };
            } else { log.info = null; }
          } catch (e) { log.info = 'err:' + e; }
          // 正确导出方法：getBuffer()（write() 需要传 DataStream 参数）
          let out = f.getBuffer();
          let abuf = null;
          if (out instanceof ArrayBuffer) abuf = out;
          else if (out && out.buffer && out.buffer instanceof ArrayBuffer) abuf = out.buffer;
          else if (out instanceof Uint8Array) abuf = out.buffer;
          if (!abuf) return Object.assign(log, { err: 'getBuffer() 返回未知类型: ' + Object.prototype.toString.call(out) });
          log.outBytes = abuf.byteLength;

          // 落盘
          const blob = new Blob([abuf], { type: 'video/mp4' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = %s;
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
          log.downloaded = true;
        } catch (e) {
          log.err = 'mux: ' + (e && e.message ? e.message : String(e));
        }
        return log;
      })()
    """ % (json.dumps(cid), json.dumps(bvid), json.dumps(OUT_NAME)), psid)
    print("   合成结果:", json.dumps(mux, ensure_ascii=False, indent=2)[:2000])

    time.sleep(10)
    fp = os.path.join(DL_DIR, OUT_NAME)
    if os.path.exists(fp):
        print(f"\n   ✅ 落盘: {fp}  {os.path.getsize(fp)} bytes")
    else:
        print(f"\n   ❌ 没落盘，列出 Downloads 最近 6 个：")
        try:
            for f in sorted(os.listdir(DL_DIR), key=lambda x: os.path.getmtime(os.path.join(DL_DIR, x)), reverse=True)[:6]:
                print("      ", f, os.path.getsize(os.path.join(DL_DIR, f)))
        except Exception as e:
            print("      ", e)
    cdp.ws.close()


if __name__ == "__main__":
    main()
