"""
B站取址/去重回归（2026-11-12，B-72）

苏哥报「B站又下载不了」。真因不是取不到地址，而是**去重把整条页面当作品**：
同一页下过一次之后，点任何一集/任何清晰度都返回 skipped，浮标只闪个绿勾
→ 用户体感是「点了没反应」。

本脚本钉死四条口径：
  T1 单P视频：options.meta.workId = <bvid>_<cid>，两条路（durl/dash）都在
  T2 首次下载 started（真起下载），二次同档 skipped（防止重复下同一集）
  T3 换档位不被拦（durl 下过后点 dash 仍 started）
  T4 分P：URL ?p=N 时 cid 取 pages[N-1].cid；越界退回 vd.cid

用法：python tools/test-bili-source.py [--port 9480]
"""
import argparse
import json
import sys
import time

sys.path.insert(0, 'tools')
from cdp_client import Cdp, find_ext_id  # noqa: E402

BV = 'BV1GJ411x7h7'          # 单P，MV
PASS = 0
FAIL = 0


def check(name, cond, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('PASS', name)
    else:
        FAIL += 1
        print('FAIL', name, '|', extra)


def js_str(s):
    return json.dumps(s, ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=9480)
    a = ap.parse_args()
    cdp = Cdp('http://127.0.0.1:%d' % a.port)
    ext, sw = find_ext_id(cdp)
    sid = cdp.attach(sw['targetId'])
    cdp.send('Runtime.enable', {}, sid)

    # 清去重账本，保证「首次」是真的首次
    cdp.eval("new Promise(r=>chrome.storage.local.set({vrMediaSeen:[]},()=>r(1)))", sid)

    tid = cdp.send('Target.createTarget', {'url': 'https://www.bilibili.com/video/' + BV})['targetId']
    ps = cdp.attach(tid)
    cdp.send('Runtime.enable', {}, ps)
    cdp.send('Page.enable', {}, ps)
    cdp.wait_ready(ps, 30)
    time.sleep(9)
    tab = cdp.eval("""new Promise(r=>chrome.tabs.query({},ts=>{
      const x=ts.find(t=>(t.url||'').includes('%s')); r(x?x.id:-1);}))""" % BV, sid)
    check('T0 找到标签页', tab > 0, tab)
    if tab <= 0:
        return

    opt = json.loads(cdp.eval(
        "vrVideoOptions(%d).then(o=>JSON.stringify({site:o.site,meta:o.meta,"
        "kinds:(o.options||[]).map(x=>x.kind)})).catch(e=>'null')" % tab, sid) or 'null')
    check('T1a site = bili', opt and opt.get('site') == 'bili', opt)
    kinds = (opt or {}).get('kinds') or []
    check('T1b 有 durl 选项', 'durl' in kinds, kinds)
    meta = (opt or {}).get('meta') or {}
    check('T1c workId = bvid_cid',
          bool(meta.get('workId')) and meta['workId'].startswith(BV + '_'), meta.get('workId'))
    check('T1d meta 带作者', bool(meta.get('author')), meta.get('author'))

    d1 = json.loads(cdp.eval(
        "vrVideoDownload(%d,'durl',false).then(r=>JSON.stringify(r)).catch(e=>JSON.stringify({err:String(e)}))"
        % tab, sid))
    check('T2a 首次 durl 真的起了下载', d1.get('started') is True and d1.get('ok') is True, d1)
    fn = str(d1.get('filename') or '')
    check('T2b 文件名带作者 ID 且不重复', '(@' in fn and fn.count('(@') == 1, fn)

    # 等它记进账本（finish 在启动返回后立即写）
    time.sleep(3)
    d2 = json.loads(cdp.eval(
        "vrVideoDownload(%d,'durl',false).then(r=>JSON.stringify(r)).catch(e=>JSON.stringify({err:String(e)}))"
        % tab, sid))
    check('T2c 同集同档二次被跳过', d2.get('skipped') is True, d2)

    d3 = json.loads(cdp.eval(
        "vrVideoDownload(%d,'dash',false).then(r=>JSON.stringify(r)).catch(e=>JSON.stringify({err:String(e)}))"
        % tab, sid))
    check('T3 换档位不被拦（dash 仍能下）', d3.get('started') is True and not d3.get('skipped'), d3)

    # T4 分P：造多P state，只验 cid 选择
    cdp.eval("""(()=>{ window.__INITIAL_STATE__ = { videoData: {
        bvid:'BV1TEST', cid:111, title:'总标题', owner:{name:'UP主', mid:777},
        pages:[{cid:111,part:'第一集'},{cid:222,part:'第二集'}] } }; return 1; })()""", ps)

    def probe(q, label):
        cdp.eval("history.replaceState(null,'',location.pathname+'%s');1" % q, ps)
        out = cdp.eval(
            "chrome.scripting.executeScript({target:{tabId:%d},world:'MAIN',func:self.VR_BILI.probeFunc})"
            ".then(r=>JSON.stringify({cid:r[0].result.cid,part:r[0].result.part,partTitle:r[0].result.partTitle}))"
            ".catch(e=>'{}')" % tab, sid)
        return json.loads(out or '{}')

    r2 = probe('?p=2', 'p=2')
    check('T4a p=2 → 第二集 cid', r2.get('cid') == 222 and r2.get('part') == 2, r2)
    check('T4b p=2 带分P标题', r2.get('partTitle') == '第二集', r2.get('partTitle'))
    r99 = probe('?p=99', 'p=99')
    check('T4c p 越界退回主 cid', r99.get('cid') == 111, r99)

    try:
        cdp.send('Target.closeTarget', {'targetId': tid})
    except Exception:
        pass
    print('\nRESULT: %d/%d PASS' % (PASS, PASS + FAIL))
    return 0 if FAIL == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
