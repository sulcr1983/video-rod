# 内容级去重真机验收（2026-11-09，B-67）
#
# 为什么必须真机：这条链路跨 SW（算指纹/fetch file://）→ FSA（写盘/removeEntry）
# → IDB（补引用），任何一层在 Node 里都是假的。三件事要同时成立：
#   1. 同内容不同 URL（换路径/换图床）→ 只留一份物理文件，库里多一条引用卡；
#   2. 同一批里同归一键 → 第二次直接跳过，不落盘；
#   3. 抖音图文页侧边栏批量 → 作者段是「摄影师沙皮」，不再是 www.douyin.com。
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

ROOT = "D:/personal/Downloads/video-rod"
PORT = 18080
# 测试素材自己造：test-site/media 被 .gitignore 忽略，依赖仓库文件在干净环境会挂。
# 下载链路只搬字节、不解码图片，所以合法文件头 + 不同长度就够区分内容。
BASE = ""
NOTE = "https://www.douyin.com/note/7705250862063743461"
TEST_AUTHOR = "测试作者(@000)"
TEST_TITLE = "DEDUPE-CONTENT"

passed = []
failed = []


def check(name, ok, detail=""):
    (passed if ok else failed).append(name)
    print(("PASS  " if ok else "FAIL  ") + name + ("   [" + str(detail) + "]" if detail else ""))


def files_under(rel):
    d = os.path.join(ROOT, rel)
    if not os.path.isdir(d):
        return []
    out = []
    for dp, _dn, fns in os.walk(d):
        for f in fns:
            out.append(os.path.join(dp, f))
    return out


def main():
    global BASE
    tmp = tempfile.mkdtemp(prefix="vr-dedupe-")
    media = os.path.join(tmp, "media")
    os.makedirs(media, exist_ok=True)
    same = b"\xff\xd8\xff\xe0" + b"A" * 3000          # a / b 同内容（测内容判重）
    open(os.path.join(media, "dedupe-a.jpg"), "wb").write(same)
    open(os.path.join(media, "dedupe-b.jpg"), "wb").write(same)
    open(os.path.join(media, "dedupe-c.png"), "wb").write(b"\x89PNG\r\n\x1a\n" + b"C" * 3000)
    open(os.path.join(media, "dedupe-d.png"), "wb").write(b"\x89PNG\r\n\x1a\n" + b"D" * 3000)
    BASE = "http://127.0.0.1:%d/media" % PORT

    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)], cwd=tmp,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(2)
        cdp = Cdp("http://127.0.0.1:9480")
        ext, sw = find_ext_id(cdp)
        sid = cdp.attach(sw["targetId"])
        cdp.send("Runtime.enable", {}, sid)
        try:
            cdp.eval("chrome.runtime.reload();1", sid)
        except Exception:
            pass
        time.sleep(5)
        ext, sw = find_ext_id(cdp)
        sid = cdp.attach(sw["targetId"])
        cdp.send("Runtime.enable", {}, sid)

        print("modules:", cdp.eval("typeof VRSave.removeFile + '/' + typeof VRDedup.findByHash", sid))

        base = os.path.join(ROOT, "抖音", TEST_AUTHOR, TEST_TITLE)

        # 清上一轮（只碰测试作者目录）
        if os.path.isdir(base):
            shutil.rmtree(base, ignore_errors=True)
        cdp.eval("""new Promise(r=>VRDB.getAllFiles().then(a=>{
          const k=a.filter(e=>(e.relPath||'').indexOf('测试作者(@000)')>=0).map(e=>e.relPath);
          return (k.length?VRDB.deleteFiles(k):Promise.resolve(0)).then(()=>r(k.length));
        }))""", sid)
        cdp.eval("""new Promise(r=>chrome.storage.local.get('vrImgDownloaded',o=>{
          const m=(o&&o.vrImgDownloaded)||{}; let n=0;
          Object.keys(m).forEach(k=>{ if(k.indexOf('dedupe-')>=0){ delete m[k]; n++; } });
          chrome.storage.local.set({vrImgDownloaded:m},()=>r(n)); }))""", sid)

        # ---------- T1 同内容不同 URL ----------
        n0 = len([f for f in files_under(os.path.join("抖音", TEST_AUTHOR))])
        r1 = cdp.eval("""
          vrImgBatch({
            batchId: 't-content-' + Date.now(),
            items: [
              {url: '%s/dedupe-a.jpg', title: 'A'},
              {url: '%s/dedupe-b.jpg', title: 'B'}
            ],
            pageUrl: '%s',
            pageTitle: '%s',
            authorFull: '%s',
            concurrency: 1
          }, {tab: {id: 0}}).then(x => JSON.stringify(x)).catch(e => 'ERR ' + e.message)
        """ % (BASE, BASE, NOTE, TEST_TITLE, TEST_AUTHOR), sid)
        print("T1:", r1)
        r1 = json.loads(r1) if r1 and r1.startswith("{") else {}
        n1 = len(files_under(os.path.join("抖音", TEST_AUTHOR)))
        check("T1a 两张都算成功", r1.get("succeeded") == 2 and r1.get("fail") == 0, r1)
        check("T1b 第二张被判内容重复跳过", r1.get("skipped") == 1, r1.get("skipped"))
        check("T1c 磁盘只多 1 份", n1 == n0 + 1, "%d→%d" % (n0, n1))

        lib1 = cdp.eval("""VRDB.getAllFiles().then(a=>{
          const rows=a.filter(e=>(e.relPath||'').indexOf('%s')>=0);
          return JSON.stringify(rows.map(e=>({rel:e.relPath.slice(-40), isRef:e.isRef||0,
            refOf:(e.refOf||'').slice(-40), sha:(e.sha256||'').slice(0,8), state:e.state||''})));
        })""" % TEST_AUTHOR, sid)
        print("T1 lib:", lib1)
        rows = json.loads(lib1)
        check("T1d 库里 2 条（实体 + 引用）", len(rows) == 2, len(rows))
        solid = [r for r in rows if r["isRef"] == 0]
        refs = [r for r in rows if r["isRef"] == 1]
        check("T1e 恰好 1 条实体", len(solid) == 1, solid)
        check("T1f 引用指向实体（不是引用链）",
              len(refs) == 1 and refs[0]["refOf"].endswith(solid[0]["rel"].split("/")[-1]) if solid else False,
              refs)
        check("T1g 引用条目不是 missing", all(r["state"] != "missing" for r in rows), rows)

        # ---------- T2 同批同归一键 ----------
        #      note：pageUrl 决定一级目录（example.com → example.com/…），
        #      所以这里统计 example.com 那一棵，而不是抖音。
        n2a = len(files_under(os.path.join("example.com", TEST_AUTHOR, "SAME-KEY-TEST")))
        r2 = cdp.eval("""
          vrImgBatch({
            batchId: 't-same-' + Date.now(),
            items: [
              {url: '%s/dedupe-c.png?v=1', title: 'C'},
              {url: '%s/dedupe-c.png?v=2', title: 'D'}
            ],
            pageUrl: 'https://example.com/x',
            pageTitle: 'SAME-KEY-TEST',
            authorFull: '测试作者(@000)',
            concurrency: 2
          }, {tab: {id: 0}}).then(x => JSON.stringify(x)).catch(e => 'ERR ' + e.message)
        """ % (BASE, BASE), sid)
        print("T2:", r2)
        r2 = json.loads(r2) if r2 and r2.startswith("{") else {}
        n2b = len(files_under(os.path.join("example.com", TEST_AUTHOR, "SAME-KEY-TEST")))
        check("T2a 同批同键只下一次", r2.get("skipped") == 1, r2.get("skipped"))
        check("T2b 同键只落 1 份", n2b == n2a + 1, "%d→%d" % (n2a, n2b))

        # ---------- T3 抖音图文侧边栏补作者 ----------
        tid = cdp.send("Target.createTarget", {"url": NOTE})["targetId"]
        ps = cdp.attach(tid)
        cdp.send("Runtime.enable", {}, ps)
        cdp.wait_ready(ps, 20)
        time.sleep(7)
        tab = cdp.eval("""new Promise(r=>chrome.tabs.query({}, ts => {
          const t = ts.find(x => (x.url||'').includes('/note/7705250862063743461'));
          r(t ? t.id : -1); }))""", sid)
        r3 = cdp.eval("""
          vrImgBatch({
            batchId: 't-author-' + Date.now(),
            items: [{url: '%s/dedupe-d.png', title: 'AUTH'}],
            pageUrl: '%s',
            pageTitle: 'AUTHOR-TEST',
            concurrency: 1
          }, {tab: {id: %d}}).then(x => JSON.stringify(x)).catch(e => 'ERR ' + e.message)
        """ % (BASE, NOTE, tab), sid)
        print("T3:", r3)
        r3j = json.loads(r3) if r3 and r3.startswith("{") else {}
        d3 = os.path.join(ROOT, "抖音", "摄影师沙皮", "AUTHOR-TEST")
        d3bad = os.path.join(ROOT, "抖音", "www.douyin.com", "AUTHOR-TEST")
        check("T3a 批量任务完成", r3j.get("ok") is True, r3j)
        check("T3b 作者段补上了（摄影师沙皮）", os.path.isdir(d3) and len(os.listdir(d3)) >= 1,
              "dir=%s files=%s skipped=%s" % (os.path.isdir(d3),
              len(os.listdir(d3)) if os.path.isdir(d3) else 0, r3j.get("skipped")))
        check("T3c 不再出现 www.douyin.com 目录", not os.path.isdir(d3bad), os.path.isdir(d3bad))
        cdp.send("Target.closeTarget", {"targetId": tid})

        print("\n%d passed, %d failed" % (len(passed), len(failed)))
        if failed:
            print("FAILED:", failed)
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=5)
        except Exception:
            srv.kill()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
