# -*- coding: utf-8 -*-
"""
YouTube 下载页：端到端离线测试（不依赖 YouTube）

思路：把「取格式」这一步打桩，其余全程真跑。
  1. 本地起一个带 CORS 的静态服务，吐出真实的两条 DASH 轨（视频/音频）
  2. 用 Page.addScriptToEvaluateOnNewDocument 在页面脚本之前替换
     chrome.runtime.sendMessage，让它对 ytFormats 直接回假数据
  3. 之后的渲染、n 参数判断、拉流、fMP4 合并、三段路径落盘、资源库登记
     全部是产品代码原样执行
  4. 校验落盘文件的 box 结构，并用 Chrome 解码确认双轨都在

用法：python tools/yt-download-test.py
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

CHROME = r"C:\Users\XPENG\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe"
EXT = r"E:\test\video-rod"
WORK = r"E:\test\video-rod\.work"
STAMP = time.strftime("%H%M%S")
DL = os.path.join(r"E:\test\video-rod\.work\dl", "run-" + STAMP)
PORT_WEB = 18082
PORT_CDP = int(os.environ.get("VR_PORT", "0")) or (9400 + (int(time.time()) % 300))
PROFILE = os.path.join(r"E:\test\video-rod\.work\profiles", "yt-dl-test-" + STAMP)

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(("  OK   " if ok else "  FAIL ") + name + (("  " + str(detail)) if detail else ""))


class CorsHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


def start_server():
    h = partial(CorsHandler, directory=WORK)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT_WEB), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def wait_port(url, timeout=25):
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            op.open(url, timeout=1).read()
            return True
        except Exception:
            time.sleep(0.3)
    return False


def build_fixture():
    v = os.path.join(WORK, "_video.mp4")
    a = os.path.join(WORK, "_audio.mp4")
    for p in (v, a):
        if not os.path.exists(p):
            raise RuntimeError("缺少测试素材 " + p + "（先跑 tools/yt-feasibility.py 之外的那段 DASH 抓取）")
    vs, asz = os.path.getsize(v), os.path.getsize(a)
    vu = f"http://127.0.0.1:{PORT_WEB}/_video.mp4"
    au = f"http://127.0.0.1:{PORT_WEB}/_audio.mp4"
    return {
        "ok": True,
        "title": "测试视频 1080p 合并",
        "author": "测试频道",
        "durationSec": 12,
        "playerId": "",
        "formats": [
            # 伪 4K（AV1）：只验证「4K 档不被过滤 + AV1 提示」，复用同一份字节
            {"itag": 401, "mime": "video/mp4", "codec": "av01.0.13M.08",
             "height": 2160, "width": 3840, "fps": 60, "bitrate": 17444000,
             "size": vs, "qualityLabel": "2160p60", "hasAudio": False, "url": vu},
            {"itag": 137, "mime": "video/mp4", "codec": "avc1.640028",
             "height": 1080, "width": 1920, "fps": 30, "bitrate": 3000000,
             "size": vs, "qualityLabel": "1080p", "hasAudio": False, "url": vu},
            {"itag": 136, "mime": "video/mp4", "codec": "avc1.4D401F",
             "height": 720, "width": 1280, "fps": 30, "bitrate": 1800000,
             "size": vs, "qualityLabel": "720p", "hasAudio": False, "url": vu},
            {"itag": 140, "mime": "audio/mp4", "codec": "mp4a.40.2",
             "height": 0, "width": 0, "fps": 0, "bitrate": 130800,
             "size": asz, "qualityLabel": "AUDIO_QUALITY_MEDIUM",
             "audioQuality": "AUDIO_QUALITY_MEDIUM", "hasAudio": False, "url": au},
            {"itag": 18, "mime": "video/mp4", "codec": "avc1.42001E",
             "height": 360, "width": 640, "fps": 30, "bitrate": 500000,
             "size": vs, "qualityLabel": "360p", "hasAudio": True, "url": vu},
        ]
    }


STUB = """
(() => {
  const fixture = %s;
  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = function (msg, cb) {
    if (msg && msg.Message === 'ytFormats') {
      setTimeout(() => { try { cb && cb(fixture); } catch (e) {} }, 40);
      return;
    }
    return orig.apply(null, arguments);
  };
})();
"""


def main():
    for p in (DL,):
        if os.path.isdir(p):
            shutil.rmtree(p, ignore_errors=True)
        os.makedirs(p, exist_ok=True)
    os.makedirs(PROFILE, exist_ok=True)
    srv = start_server()
    if not wait_port(f"http://127.0.0.1:{PORT_WEB}/_video.mp4"):
        print("静态服务没起来")
        return 2

    fx = build_fixture()
    print("假档位：%d 条（素材 video=%d audio=%d 字节）" %
          (len(fx["formats"]), os.path.getsize(os.path.join(WORK, "_video.mp4")),
           os.path.getsize(os.path.join(WORK, "_audio.mp4"))))

    proc = subprocess.Popen([
        CHROME, f"--remote-debugging-port={PORT_CDP}", f"--user-data-dir={PROFILE}",
        f"--disable-extensions-except={EXT}", f"--load-extension={EXT}",
        "--no-first-run", "--no-default-browser-check", "--window-size=1280,900",
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_port(f"http://127.0.0.1:{PORT_CDP}/json/version"):
        raise RuntimeError("Chrome 没起来")

    cdp = None
    try:
        cdp = Cdp(f"http://127.0.0.1:{PORT_CDP}")
        time.sleep(2.0)
        ext_id, _ = find_ext_id(cdp)
        print("[1] 扩展 ID:", ext_id)
        check("扩展已加载", bool(ext_id))
        if not ext_id:
            return 3

        cdp.send("Browser.setDownloadBehavior",
                 {"behavior": "allow", "downloadPath": DL, "eventsEnabled": True})

        tid = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
        sid = cdp.attach(tid)
        cdp.send("Page.enable", {}, sid)
        cdp.send("Runtime.enable", {}, sid)
        cdp.send("Page.addScriptToEvaluateOnNewDocument",
                 {"source": STUB % json.dumps(fx, ensure_ascii=False)}, sid)

        url = (f"chrome-extension://{ext_id}/js/yt/yt-download.html"
               f"?videoId=TESTVID001&tabId=0&title=%E6%B5%8B%E8%AF%95%E8%A7%86%E9%A2%91"
               f"&author=%E6%B5%8B%E8%AF%95%E9%A2%91%E9%81%93&authorId=%40test_ch")
        print("[2] 打开下载页")
        cdp.send("Page.navigate", {"url": url}, sid)
        cdp.send("Emulation.setDeviceMetricsOverride",
                 {"width": 480, "height": 760, "deviceScaleFactor": 2, "mobile": False}, sid)

        if not cdp.wait_js(sid, "document.getElementById('qc').children.length>0"
                                "||document.getElementById('msg').textContent.indexOf('失败')>=0",
                           timeout=20):
            print("    页面没渲染出档位")
            check("档位渲染", False)
            return 4

        opts = cdp.eval("""(() => Array.prototype.map.call(
            document.getElementById('qc').children,
            b => b.querySelector('.t').textContent + ' | ' + b.querySelector('.s').textContent))()""", sid)
        print("[3] 档位列表:")
        for o in opts:
            print("     -", o)
        check("4K 档存在（AV1 in MP4 没被过滤）", any(o.startswith("4K") for o in opts))
        check("1080p 档存在", any(o.startswith("1080p") for o in opts))
        check("免合并单文件档存在", any("免合并" in b for b in cdp.eval(
            """(() => Array.prototype.map.call(document.getElementById('qc').children,
                 b => b.innerHTML))()""", sid)))
        check("仅音频档存在", any(o.startswith("仅音频") for o in opts))

        diag = cdp.eval("""(() => ({
            nameHooked: !!(chrome.downloads.download && chrome.downloads.download.__vrNameHooked),
            hasVRPath: !!(window.VRPath && window.VRPath.buildRelPath),
            samplePath: (window.VRPath && window.VRPath.buildRelPath) ? VRPath.buildRelPath({
                platform:'youtube', authorFull:'测试频道', creatorId:'@test_ch',
                type:'video', ext:'mp4', fileName:'测试视频_1080p.mp4',
                pageUrl:'https://www.youtube.com/watch?v=x'}) : ''
        }))()""", sid)
        print("[3b] 诊断:", json.dumps(diag, ensure_ascii=False))
        check("下载钩子已生效（文件名保护）", bool(diag.get("nameHooked")))
        check("VRPath 可用", bool(diag.get("hasVRPath")))

        # 用内存 mock 顶替资源库根目录句柄：验证「建目录 → 去重命名 → 写入」这套自有逻辑，
        # FSA API 本身的行为归 Chrome，不在本测试范围内。
        mock = cdp.eval("""(() => {
            window.__FSA_LOG__ = [];
            window.__FSA_BLOBS__ = [];
            function mkDir(node, path) {
                return {
                    kind: 'directory',
                    getDirectoryHandle(name) {
                        node.dirs = node.dirs || {};
                        node.dirs[name] = node.dirs[name] || { dirs: {}, files: {} };
                        return Promise.resolve(mkDir(node.dirs[name], path + '/' + name));
                    },
                    getFileHandle(name, opt) {
                        node.files = node.files || {};
                        if (!opt || !opt.create) {
                            if (!node.files[name]) { return Promise.reject(new Error('NotFound')); }
                        } else {
                            node.files[name] = node.files[name] || { name: name };
                        }
                        return Promise.resolve({
                            kind: 'file', name: name,
                            createWritable() {
                                return Promise.resolve({
                                    write(b) {
                                        return b.arrayBuffer().then(ab => {
                                            window.__FSA_LOG__.push({ path: path + '/' + name, size: ab.byteLength });
                                            window.__FSA_BLOBS__.push(b);
                                        });
                                    },
                                    close() { return Promise.resolve(); }
                                });
                            }
                        });
                    },
                    queryPermission() { return Promise.resolve('granted'); },
                    requestPermission() { return Promise.resolve('granted'); }
                };
            }
            VRDB.getHandle = () => Promise.resolve(mkDir({ dirs: {}, files: {} }, ''));
            return typeof VRDB.getHandle === 'function';
        })()""", sid)
        check("FSA 根句柄打桩成功", bool(mock))

        # 选 1080p 再下载
        idx = next((i for i, o in enumerate(opts) if o.startswith("1080p")), 0)
        cdp.eval(f"document.getElementById('qc').children[{idx}].click(); 1", sid)
        time.sleep(0.3)
        note = cdp.eval("document.getElementById('note').textContent", sid)
        print("[4] 提示行:", repr(note))
        cdp.eval("document.getElementById('go').click(); 1", sid)

        print("[5] 等下载落盘（直接盯磁盘，不依赖页面连接）…")
        deadline = time.time() + 75
        landed = []
        while time.time() < deadline:
            landed = []
            for root, _, names in os.walk(DL):
                for n in names:
                    if n.endswith((".mp4", ".m4a")):
                        landed.append(os.path.join(root, n))
            if landed and not any(n.endswith(".crdownload") for n in os.listdir(DL)):
                break
            time.sleep(0.5)
        time.sleep(1.5)

        msg, cls = "", ""
        try:
            msg = cdp.eval("document.getElementById('msg').textContent", sid) or ""
            cls = cdp.eval("document.getElementById('msg').className", sid) or ""
        except Exception as e:
            print("    （页面连接已断，跳过文案读取：%s）" % str(e)[:60])
        print("    ", cls, "|", msg)
        check("下载流程成功", ("ok" in cls) or bool(landed), msg)

        try:
            items = cdp.eval("""new Promise(r => chrome.downloads.search(
                {limit: 3, orderBy: ['-startTime']}, r))""", sid)
            for it in (items or []):
                print("     [dl] url=%s" % str(it.get("url"))[:70])
                print("          filename=%s byExtensionId=%s" % (
                    it.get("filename"), it.get("byExtensionId")))
        except Exception as e:
            print("     （查下载项失败：%s）" % str(e)[:60])

        print("[6] 校验落盘（FSA 通道）")
        print("     FSA 失败原因:", cdp.eval("window.__vrFsaError || '(无)'", sid))
        log = cdp.eval("window.__FSA_LOG__ || []", sid) or []
        for it in log:
            print("     %-70s %8d" % (it.get("path"), it.get("size", 0)))
        check("FSA 写入了 1 个文件", len(log) == 1, len(log))
        if log:
            path = log[0].get("path") or ""
            check("路径是 <库根>/YouTube/博主/视频/xxx.mp4（已剥掉 video-rod 前缀）",
                  path.startswith("/YouTube/") and "/视频/" in path and path.endswith(".mp4")
                  and "video-rod/video-rod" not in path, path)
            check("文件名带分辨率", "_1080p" in path, path)
            check("字节数与合并结果一致", abs(log[0].get("size", 0) - 675433) < 4096, log[0].get("size"))

        print("[6x] 校验 downloads 通道未被使用")

        time.sleep(1.5)
        files = []
        for root, _, names in os.walk(DL):
            for n in names:
                if n.endswith((".mp4", ".m4a")):
                    files.append((os.path.join(root, n), os.path.getsize(os.path.join(root, n))))
        for p, s in files:
            print("     %-96s %8d" % (p.replace(DL, "<dl>"), s))
        check("未走 downloads 兜底（应无下载项）", len(files) == 0, len(files))
        check("没有生成 UUID 名文件", not any(len(os.path.basename(p)) > 30 for p, _ in files))

        print("[7] 校验容器（2 条轨 + 能被 Chrome 解码）")
        has_blob = cdp.eval("!!(window.__FSA_BLOBS__ && window.__FSA_BLOBS__[0])", sid)
        check("拿到合并后的字节用于校验", bool(has_blob))
        if not has_blob:
            print("\n" + "=" * 60)
            print("通过 %d / 失败 %d" % (len(PASS), len(FAIL)))
            if FAIL:
                print("失败项: " + ", ".join(FAIL))
            return 1

        # 小窗是后台窗口，媒体解码会被节流；把字节搬到前台标签页再解
        b64 = cdp.eval("""window.__FSA_BLOBS__[0].arrayBuffer().then(b => {
            const u = new Uint8Array(b); const CH = 0x8000; let s = '';
            for (let i = 0; i < u.length; i += CH) {
                s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
            }
            return btoa(s);
        })""", sid)
        check("取到合并字节", bool(b64), len(b64) if b64 else 0)

        v2 = cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]
        s2 = cdp.attach(v2)
        cdp.send("Page.enable", {}, s2)
        cdp.send("Runtime.enable", {}, s2)
        cdp.send("Page.setWebLifecycleState", {"state": "active"}, s2)
        cdp.eval("""(()=>{const v=document.createElement('video');v.muted=true;
            v.style.cssText='width:320px';document.body.appendChild(v);
            window.__v=v;return 1})()""", s2)
        time.sleep(0.3)
        cdp.eval("__v.src='data:video/mp4;base64,'+%s; 1" % json.dumps(b64), s2)
        cdp.wait_js(s2, "(__v.readyState>=2)||__v.error", timeout=30)
        time.sleep(0.8)
        info = cdp.eval("""(()=>({dur:__v.duration,w:__v.videoWidth,h:__v.videoHeight,
            rs:__v.readyState,err:__v.error?__v.error.code:0}))()""", s2)
        print("     ", json.dumps(info, ensure_ascii=False))
        cdp.eval("__v.play().catch(()=>{})", s2)
        time.sleep(2.0)
        dec = cdp.eval("""(()=>({v:__v.webkitVideoDecodedByteCount,
            a:__v.webkitAudioDecodedByteCount}))()""", s2)
        print("     ", json.dumps(dec, ensure_ascii=False))
        check("Chrome 无解码错误", info.get("err", 1) == 0)
        check("时长正确（约 12s）", 8 < (info.get("dur") or 0) < 20, info.get("dur"))
        check("有画面数据", dec.get("v", 0) > 0)
        check("有声音数据（合并成功）", dec.get("a", 0) > 0)

        print("\n" + "=" * 60)
        print("通过 %d / 失败 %d" % (len(PASS), len(FAIL)))
        if FAIL:
            print("失败项: " + ", ".join(FAIL))
        return 0 if not FAIL else 1
    finally:
        try:
            if cdp:
                cdp.close_created()
        except Exception:
            pass
        proc.terminate()
        srv.shutdown()


if __name__ == "__main__":
    sys.exit(main())
