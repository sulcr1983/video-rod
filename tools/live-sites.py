"""
真实站点固定回归（2026-11-12，B-74）

问题：站点适配是最容易"悄悄坏"的地方 —— 站点改版、签名参数变、登录态过期，
机器测不出来，只有用户点了才发现（B站「下载不了」就是这么来的）。

做法：一张固定的站点清单（tools/live-sites.json），每条给 URL + 期望，
逐个打开用真实扩展跑一遍。两种档位：
  required=true   稳定可复现（本地测试站 + B站公开视频）→ 失败会拦
  required=false  真实站点探活（登录态/风控变量多）→ 失败只记 WARN

用法：
    python tools/live-sites.py                 # 跑全部（本地 + 真实）
    python tools/live-sites.py --only local    # 只跑本地（无网络也能跑）
    python tools/live-sites.py --port 9490 --ext <id>
"""
import argparse
import http.server
import json
import os
import socketserver
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_DIR = os.path.join(ROOT, 'test-site')
LIST_PATH = os.path.join(ROOT, 'tools', 'live-sites.json')


def start_local_server():
    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    handler = lambda *a, **kw: H(*a, directory=SITE_DIR, **kw)  # noqa: E731
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d' % srv.server_address[1]


def open_page(cdp, url, w=1440, h=900):
    tid = cdp.send('Target.createTarget', {'url': url})['targetId']
    ps = cdp.attach(tid)
    cdp.send('Runtime.enable', {}, ps)
    cdp.send('Page.enable', {}, ps)
    try:
        cdp.send('Emulation.setDeviceMetricsOverride',
                 {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False}, ps)
    except Exception:
        pass
    cdp.wait_ready(ps, 30)
    return tid, ps


def tab_id_of(cdp, sid, needle):
    return cdp.eval(
        "new Promise(function(r){chrome.tabs.query({},function(ts){"
        "var t=ts.find(function(x){return (x.url||'').indexOf(%s)>=0;});"
        "r(t?t.id:-1);});})" % json.dumps(needle), sid)


def check_video(cdp, sid, case, tab):
    out = cdp.eval(
        "vrVideoOptions(%d).then(function(o){return JSON.stringify({site:o.site,"
        "n:(o.options||[]).length,meta:o.meta||null});}).catch(function(e){"
        "return JSON.stringify({err:String(e&&e.message||e)});})" % tab, sid)
    try:
        info = json.loads(out) if isinstance(out, str) else {}
    except Exception:
        info = {}
    exp = case.get('expect') or {}
    if info.get('err'):
        return False, 'vrVideoOptions 抛错：%s' % info['err']
    if exp.get('site') and info.get('site') != exp['site']:
        return False, 'site=%s，期望 %s' % (info.get('site'), exp['site'])
    n = int(info.get('n') or 0)
    if n < int(exp.get('minOptions') or 1):
        return False, '选项数 %d < %d（页面可能未加载完/登录态失效）' % (n, exp.get('minOptions') or 1)
    wid = str((info.get('meta') or {}).get('workId') or '')
    pref = str(exp.get('workIdPrefix') or '')
    if pref and not wid.startswith(pref):
        return False, 'workId=%r 不以 %r 开头（去重键会退化成页面 URL）' % (wid, pref)
    return True, 'site=%s，%d 个选项，workId=%s' % (info.get('site'), n, wid or '-')


def check_sniff(cdp, sid, case, tab):
    exp = case.get('expect') or {}
    out = cdp.eval(
        "JSON.stringify((self.cacheData&&self.cacheData[%d]||[]).map(function(m){return m&&m.url;}))"
        % tab, sid)
    try:
        urls = json.loads(out) if isinstance(out, str) else []
    except Exception:
        urls = []
    want = str(exp.get('urlHas') or '')
    hits = [u for u in urls if u and (want in u if want else True)]
    need = int(exp.get('minSniff') or 1)
    if len(hits) < need:
        return False, '嗅到 %d 条（需要 ≥%d，过滤 %r）；池内共 %d 条' % (len(hits), need, want, len(urls))
    return True, '嗅到 %d 条 %s' % (len(hits), want or '媒体')


def wait_cells_stable(cdp, ps, timeout=25.0):
    """等侧栏卡片数稳定。
    统一发现层现在会合并网络缓存并做尺寸回填（预算 5s），
    固定 sleep 会「有时 2 张有时 3 张」——轮询到连续两次不变才算扫完。"""
    last, stable, n = -1, 0, 0
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(1.5)
        try:
            cur = int(cdp.eval("document.querySelectorAll('.ip-cell').length", ps) or 0)
        except Exception:
            cur = 0
        n = cur
        if cur == last and cur > 0:
            stable += 1
            if stable >= 2:
                break
        else:
            stable = 0
        last = cur
    return n


def check_image(cdp, ext, case, tab):
    exp = case.get('expect') or {}
    tid, ps = open_page(cdp, 'chrome-extension://%s/image.html?tabId=%d' % (ext, tab), 430, 900)
    try:
        n = wait_cells_stable(cdp, ps)
        need = int(exp.get('minCells') or 1)
        if n < need:
            return False, '侧栏只列出 %d 张（需要 ≥%d）' % (n, need)
        # 裂图（缩略图 no-referrer + 默认策略两次都失败才加 .loadfail）
        broken = int(cdp.eval("document.querySelectorAll('.ip-cell.loadfail').length", ps) or 0)
        if exp.get('maxBroken') is not None and broken > int(exp['maxBroken']):
            return False, '%d 张裂图（允许 ≤%s）；共 %d 张' % (broken, exp['maxBroken'], n)
        # 尺寸回填：ip-dim 里没有「×」的就是未知（含「尺寸未知」「背景图」两种文案）
        unknown = int(cdp.eval(
            "Array.from(document.querySelectorAll('.ip-dim'))"
            ".filter(e => (e.textContent || '').indexOf('\\u00d7') < 0).length", ps) or 0)
        if exp.get('maxUnknown') is not None and unknown > int(exp['maxUnknown']):
            return False, '%d 张尺寸未知（允许 ≤%s）；共 %d 张' % (unknown, exp['maxUnknown'], n)
        return True, '侧栏列出 %d 张（裂图 %d，尺寸未知 %d）' % (n, broken, unknown)
    finally:
        try:
            cdp.send('Target.closeTarget', {'targetId': tid})
        except Exception:
            pass


def check_page(cdp, sid, case, ps):
    exp = case.get('expect') or {}
    if exp.get('pageOk'):
        title = cdp.eval('document.title || ""', ps)
        href = cdp.eval('location.href || ""', ps)
        if not href or href == 'about:blank':
            return False, '页面没打开（停留在 about:blank）'
        # 真的探一次 SW 存活：SW 上下文里 vrVideoOptions 必须是函数。
        # 早先写的是 `self.VRHeartbeat ? ... : 'ok'` —— 这个变量不存在，
        # 恒返回 'ok'，等于没检查（自测发现的假断言，已修）。
        hb = cdp.eval("typeof vrVideoOptions", sid)
        if hb != 'function':
            return False, 'SW 上下文异常（vrVideoOptions=%r）' % hb
        return True, '打开成功（title=%s，SW 存活）' % str(title)[:24]
    return True, '无断言'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=9480)
    ap.add_argument('--ext', default='')
    ap.add_argument('--only', default='', help='按名字前缀过滤，如 local / bilibili')
    ap.add_argument('--list', default=LIST_PATH)
    a = ap.parse_args()

    with open(a.list, encoding='utf-8') as f:
        cfg = json.load(f)
    cases = cfg.get('sites') or []
    if a.only:
        cases = [c for c in cases if str(c.get('name', '')).startswith(a.only)]

    srv, local = start_local_server()
    try:
        cdp = Cdp('http://127.0.0.1:%d' % a.port)
        ext = a.ext
        if not ext:
            ext, _sw = find_ext_id(cdp)
        _e, sw = find_ext_id(cdp)
        sid = cdp.attach(sw['targetId'])
        cdp.send('Runtime.enable', {}, sid)

        passed = failed = warned = 0
        fails, warns = [], []
        for case in cases:
            name = case.get('name') or '?'
            url = str(case.get('url') or '').replace('{local}', local)
            kind = case.get('kind') or 'page'
            need = bool(case.get('required', True))
            print('\n---- %s（%s，%s）----' % (name, kind, '必须过' if need else '探活'))
            print('   ', case.get('why') or '')
            tid = None
            try:
                tid, ps = open_page(cdp, url)
                time.sleep(int(case.get('wait') or 5))
                needle = url.split('/')[2] if '://' in url else url
                tab = tab_id_of(cdp, sid, needle)
                if tab <= 0:
                    ok, msg = False, '找不到对应标签页'
                elif kind == 'video':
                    ok, msg = check_video(cdp, sid, case, tab)
                elif kind == 'sniff':
                    ok, msg = check_sniff(cdp, sid, case, tab)
                elif kind == 'image':
                    ok, msg = check_image(cdp, ext, case, tab)
                else:
                    ok, msg = check_page(cdp, sid, case, ps)
            except Exception as e:
                ok, msg = False, '异常：%s' % e
            finally:
                if tid:
                    try:
                        cdp.send('Target.closeTarget', {'targetId': tid})
                    except Exception:
                        pass

            if ok:
                print('PASS %s：%s' % (name, msg))
                passed += 1
            elif need:
                print('FAIL %s：%s' % (name, msg))
                failed += 1
                fails.append(name)
            else:
                print('WARN %s：%s' % (name, msg))
                warned += 1
                warns.append(name)

        print('\n%d passed, %d failed' % (passed, failed))
        if warns:
            print('WARN（只告警不拦）：' + ', '.join(warns))
        if fails:
            print('失败站点：' + ', '.join(fails))
        return 0 if failed == 0 else 1
    finally:
        try:
            srv.shutdown()
        except Exception:
            pass


if __name__ == '__main__':
    sys.exit(main())
