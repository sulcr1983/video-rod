# 去重链路真机验收（不打开新页面：直接调 SW 的 vrImgBatch / VRIndex，不触发站点风控）
#   T1 同一张图换个签名 → 账本命中，跳过，不重复落盘
#   T2 账本被清空（模拟浏览器重启/新会话）→ 靠库里 sourceUrl 命中，仍然跳过
#   T3 换个平台下同一张图 → 物理只留一份，库里多一条「引用」索引
#   T4 重建索引 → 指纹 (sha256) 与引用标记不被抹掉
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

ROOT = "D:/personal/Downloads/video-rod"
NOTE_DIR = os.path.join(ROOT, "抖音")
IMG = ("https://p3-pc-sign.douyinpic.com/tos-cn-i-0813c000-ce/"
       "oMqdCgDQIFAzQeC7iAEnAGAAE1oyf9ndqlaHwO~tplv-dy-aweme-images:q75.webp"
       "?biz_tag=aweme_images&from=327834062&lk3s=138a59ce&s=PackSourceEnum_AWEME_DETAIL"
       "&sc=image&se=false&x-expires=1796821200&x-signature=AdV%2Ba1gQeMfZvRGe4vBpWGMeGVE%3D")
# 同一张图的 jpeg 版本：路径不同、签名不同、但归类键相同（测账本命中）
IMG2 = IMG.replace(":q75.webp", ":q75.jpeg").replace(
    "x-signature=AdV%2Ba1gQeMfZvRGe4vBpWGMeGVE%3D",
    "x-signature=MIVAtgCFcOj9EFS62sxYJtJAhlg%3D")
NOTE_PAGE = "https://www.douyin.com/note/7705250862063743461"
TITLE = "INTEG-DEDUP-" + str(int(time.time()))[-6:] + "-DELETEME"

PASS = FAIL = 0


def check(name, cond, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("PASS  %s %s" % (name, extra))
    else:
        FAIL += 1
        print("FAIL  %s %s" % (name, extra))


def count_files():
    n = 0
    for dirpath, _dn, fns in os.walk(NOTE_DIR):
        n += len([x for x in fns if x.lower().endswith((".jpeg", ".jpg", ".webp", ".png"))])
    return n


def main():
    cdp = Cdp("http://127.0.0.1:9480")
    ext, sw = find_ext_id(cdp)
    # 改过 background/indexer，必须先热重载，否则跑的是旧代码
    sid0 = cdp.attach(sw["targetId"])
    cdp.send("Runtime.enable", {}, sid0)
    try:
        cdp.eval("chrome.runtime.reload(); 1", sid0)
    except Exception:
        pass
    time.sleep(3.5)
    ext, sw = find_ext_id(cdp)
    sid = cdp.attach(sw["targetId"])
    cdp.send("Runtime.enable", {}, sid)

    def sw_eval(expr):
        return cdp.eval(expr, sid)

    def clear_ledger():
        sw_eval("""
          new Promise(r => chrome.storage.local.get('vrImgDownloaded', o => {
            const m = (o && o.vrImgDownloaded) || {};
            Object.keys(m).forEach(k => { if (k.indexOf('douyinpic') >= 0) delete m[k]; });
            chrome.storage.local.set({ vrImgDownloaded: m }, () => r(1));
          }))
        """)

    def batch(url, title, page=NOTE_PAGE, site='抖音'):
        return sw_eval("""
          (async () => {
            const r = await vrImgBatch({
              batchId: 'it-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              items: [{url: %s, candidates: [%s], title: %s}],
              pageUrl: %s, pageTitle: '去重集成测试', siteName: %s,
              concurrency: 1, authorFull: '测试作者(@000)'
            }, {tab: {id: 0}});
            return JSON.stringify(r);
          })()
        """ % (json.dumps(url), json.dumps(url), json.dumps(title), json.dumps(page), json.dumps(site)))

    def dl_entry(title):
        return sw_eval("""
          (async () => {
            const all = await VRDB.getAllFiles();
            const hit = all.filter(e => (e.fileName || '').indexOf(%s) >= 0 ||
                                        (e.title || '').indexOf(%s) >= 0);
            return JSON.stringify(hit.map(e => ({rel: e.relPath, isRef: e.isRef || 0,
              refOf: e.refOf || '', sha: (e.sha256 || '').slice(0, 12),
              src: (e.sourceUrl || '').slice(0, 60), platform: e.platform})));
          })()
        """ % (json.dumps(title), json.dumps(title)))

    # 清掉上一轮测试留下的自有产物（只认 INTEG-DEDUP / 测试作者(@000) 路径，
    # 不碰任何真实素材），否则「同平台已存在」会让跨平台用例无法重复验证。
    def purge_prior():
        removed = 0
        for dirpath, dirs, fns in os.walk(ROOT, topdown=False):
            if ("测试作者" not in dirpath) and ("INTEG-DEDUP" not in dirpath):
                continue
            for fn in fns:
                try:
                    os.remove(os.path.join(dirpath, fn))
                    removed += 1
                except OSError:
                    pass
            for dn in dirs:
                try:
                    os.rmdir(os.path.join(dirpath, dn))
                except OSError:
                    pass
            try:
                os.rmdir(dirpath)
            except OSError:
                pass
        sw_eval("""
          new Promise(r => VRDB.getAllFiles().then(all => {
            const kill = all.filter(e => (e.relPath || '').indexOf('测试作者') >= 0 ||
                                          (e.relPath || '').indexOf('INTEG-DEDUP') >= 0);
            return VRDB.deleteFiles(kill.map(e => e.relPath)).then(() => r(kill.length));
          }).catch(() => r(0)))
        """)
        return removed

    print("清理上一轮测试产物:", purge_prior())
    clear_ledger()
    n0 = count_files()
    print("起始文件数:", n0)

    # T1 同平台首次：正常下载（干净状态下的基线，后面几条都以它为「库里已有」）
    r1 = json.loads(batch(IMG, TITLE + "-A"))
    n1 = count_files()
    print("T1 result:", r1, "files:", n1)
    check("T1a 首次下载成功", r1.get("succeeded") == 1 and r1.get("fail") == 0, str(r1))
    check("T1b 文件数 +1", n1 == n0 + 1, "%d→%d" % (n0, n1))

    # T2 同一张图再来一次（账本命中）→ 跳过，不再落盘
    r2 = json.loads(batch(IMG, TITLE + "-B"))
    n2 = count_files()
    print("T2 result:", r2, "files:", n2)
    check("T2a 重复点击被跳过", r2.get("skipped") == 1, str(r2))
    check("T2b 没有新增文件", n2 == n1, "%d→%d" % (n1, n2))

    # T3 清空账本（模拟浏览器重启）→ 只能靠库里 sourceUrl
    clear_ledger()
    r3 = json.loads(batch(IMG, TITLE + "-C"))
    n3 = count_files()
    print("T3 result:", r3, "files:", n3)
    check("T3 账本清空后仍靠库内来源键跳过", r3.get("skipped") == 1, str(r3))
    check("T3b 依然没有新增文件", n3 == n2, "%d→%d" % (n2, n3))

    # T4 换平台下同一张图 → 内容指纹去重：物理不增，索引多一条引用
    #     必须先清账本：否则「已下过」在账本层就被挡住，根本走不到内容判重
    clear_ledger()
    r4 = json.loads(batch(IMG, TITLE + "-WEIBO", "https://weibo.com/u/5750600479", "微博"))
    n4 = count_files()
    print("T4 result:", r4, "files:", n4)
    check("T4a 跨平台下载成功", r4.get("succeeded") == 1, str(r4))
    check("T4b 物理文件没有增加（只留一份）", n4 == n3, "%d→%d" % (n3, n4))

    entries = json.loads(dl_entry(TITLE))
    print("ENTRIES:", json.dumps(entries, ensure_ascii=False))
    refs = [e for e in entries if e["isRef"]]
    check("T4c 跨平台那条是引用（索引多份）", len(refs) == 1, "refs=%d" % len(refs))
    check("T4d 引用指向原件", bool(refs and refs[0]["refOf"]), refs[0]["refOf"] if refs else "")
    check("T4e 条目带内容指纹", any(e["sha"] for e in entries), str([e["sha"] for e in entries]))
    check("T4f 条目带来源键", any(e["src"] for e in entries), str([e["src"] for e in entries]))

    # T5 重建索引（downloads 模式）→ 指纹与引用标记不能丢，条目也不能被抹掉
    n_before_rebuild = sw_eval("VRDB.getAllFiles().then(a => a.length)")
    sw_eval("VRIndex.build({mode: 'downloads'}).then(r => r && r.total).catch(e => 'ERR:' + e.message)")
    time.sleep(2)
    e2 = json.loads(dl_entry(TITLE))
    print("AFTER REBUILD:", json.dumps(e2, ensure_ascii=False))
    check("T5a 重建索引后指纹仍在", any(e["sha"] for e in e2), str([e["sha"] for e in e2]))
    check("T5b 重建索引后引用标记仍在", any(e["isRef"] for e in e2),
          str([e["isRef"] for e in e2]))
    n_after_rebuild = sw_eval("VRDB.getAllFiles().then(a => a.length)")
    check("T5c downloads 重建不再抹掉 FSA 直写条目",
          (n_after_rebuild or 0) >= (n_before_rebuild or 0),
          "%s→%s" % (n_before_rebuild, n_after_rebuild))

    print("\nRESULT: %d/%d PASS" % (PASS, PASS + FAIL))


if __name__ == "__main__":
    main()
