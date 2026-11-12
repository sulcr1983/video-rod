#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
页面文字对比度检查（2026-11-12，B-77）

苏哥报「深色背景下灰字看不清，弹窗字体和窗格都要清晰一点」。肉眼能感觉到，
但改完没人复核就会退回 —— 做成可重复跑的检查。

用法：
    python tools/check-contrast.py                  # 默认查库页 + 侧边栏 + popup
    python tools/check-contrast.py --port 9490      # 指定隔离实例端口
    python tools/check-contrast.py --pages library  # 只查库页

需要先有一个带扩展的实例（与 visual-baseline 同一套纪律）：
    python tools/e2e-all.py --isolated --only dedup --keep-isolated

退出码：0 = 全部达标；1 = 有元素不达标（会打印清单）。

判定标准（WCAG 2.1）：
    正文  ≥ 4.5:1
    大字  ≥ 3.0:1   （≥24px，或 ≥18.66px 且 font-weight ≥700）

说明：禁用态（disabled）不受 WCAG 1.4.3 约束，但仍要「看得见」——
      脚本会把它算进去，因为深色页面上「浅灰块」本身就是视觉噪音（实测踩过）。
"""
import argparse
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCAN_JS = os.path.join(ROOT, 'tools', 'contrast-scan.js')
sys.path.insert(0, os.path.join(ROOT, 'tools'))


def instance_alive(port):
    try:
        urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
            'http://127.0.0.1:%d/json/version' % port, timeout=2).read()
        return True
    except Exception:
        return False


def scan_page(cdp, ext, url, width, height, settle=5.0, tab_for=None):
    """打开一个页面并扫描；返回 (total, bad, list)"""
    tid = cdp.send('Target.createTarget', {'url': url})['targetId']
    ps = cdp.attach(tid)
    cdp.send('Runtime.enable', {}, ps)
    cdp.send('Page.enable', {}, ps)
    try:
        cdp.send('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': False}, ps)
    except Exception:
        pass
    cdp.wait_ready(ps, 25)
    time.sleep(settle)
    raw = cdp.eval(open(SCAN_JS, encoding='utf-8').read(), ps)
    cdp.send('Target.closeTarget', {'targetId': tid})
    data = json.loads(raw) if isinstance(raw, str) else raw
    return data['total'], data['bad'], data['list']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=9490, help='隔离实例 CDP 端口（默认 9490）')
    ap.add_argument('--pages', default='library,image,popup',
                    help='要查的页面，逗号分隔：library / image / popup')
    a = ap.parse_args()

    if not instance_alive(a.port):
        print('✗ 实例不在线（%d）。先起一个：' % a.port)
        print('    python tools/e2e-all.py --isolated --only dedup --keep-isolated')
        return 2

    from cdp_client import Cdp, find_ext_id
    cdp = Cdp('http://127.0.0.1:%d' % a.port)
    ext, _sw = find_ext_id(cdp)

    pages = [x.strip() for x in a.pages.split(',') if x.strip()]
    total_bad = 0
    total_checked = 0

    for name in pages:
        try:
            if name == 'library':
                # 库页：主界面 + 各弹窗（弹窗用 class 打开后各扫一遍）
                tid = cdp.send('Target.createTarget', {
                    'url': 'chrome-extension://%s/library.html' % ext})['targetId']
                ps = cdp.attach(tid)
                cdp.send('Runtime.enable', {}, ps)
                cdp.send('Page.enable', {}, ps)
                cdp.send('Emulation.setDeviceMetricsOverride', {
                    'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False}, ps)
                cdp.wait_ready(ps, 25)
                time.sleep(7)
                js = open(SCAN_JS, encoding='utf-8').read()
                targets = [('库页主界面', None), ('设置弹窗', 'setModal'), ('回收站', 'dwMask'),
                           ('重命名', 'renameMask'), ('移动到', 'moveMask'),
                           ('确认框', 'confirmMask'), ('筛选', 'filtModal')]
                for label, mask in targets:
                    if mask:
                        cdp.eval("(function(){var m=document.getElementById('%s');"
                                 "if(m){m.classList.add('show');}return 1;})()" % mask, ps)
                        time.sleep(0.8)
                    d = json.loads(cdp.eval(js, ps))
                    total_checked += d['total']
                    total_bad += d['bad']
                    mark = '✓' if d['bad'] == 0 else '✗'
                    print('  %s %-12s 不达标 %d / 共 %d' % (mark, label, d['bad'], d['total']))
                    for x in d['list'][:5]:
                        print('      %.2f (需 %.1f) %4.1fpx %-26s %s | %s'
                              % (x['ratio'], x['need'], x['size'], x['sel'][:26],
                                 x['color'], x['text'][:18]))
                    if mask:
                        cdp.eval("(function(){var m=document.getElementById('%s');"
                                 "if(m){m.classList.remove('show');}return 1;})()" % mask, ps)
                        time.sleep(0.4)
                cdp.send('Target.closeTarget', {'targetId': tid})

            elif name == 'image':
                # 侧边栏需要一个真实 tabId：先开本地图片页
                site = os.path.join(ROOT, 'test-site')
                if not os.path.isdir(site):
                    print('  - 侧边栏跳过（缺 test-site）')
                    continue
                import subprocess
                srv = subprocess.Popen([sys.executable, '-m', 'http.server', '18080'],
                                       cwd=site, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL)
                try:
                    time.sleep(2)
                    t0 = cdp.send('Target.createTarget', {
                        'url': 'http://127.0.0.1:18080/images.html'})['targetId']
                    p0 = cdp.attach(t0)
                    cdp.send('Runtime.enable', {}, p0)
                    cdp.wait_ready(p0, 25)
                    time.sleep(4)
                    tab = cdp.eval("new Promise(r=>chrome.tabs.query({},ts=>{"
                                   "const x=ts.find(t=>(t.url||'').includes('18080/images'));"
                                   "r(x?x.id:-1)}))", p0)
                    tot, bad, lst = scan_page(
                        cdp, ext, 'chrome-extension://%s/image.html?tabId=%s' % (ext, tab),
                        430, 900, settle=11)
                    total_checked += tot
                    total_bad += bad
                    print('  %s %-12s 不达标 %d / 共 %d' % ('✓' if bad == 0 else '✗', '侧边栏', bad, tot))
                    for x in lst[:5]:
                        print('      %.2f (需 %.1f) %4.1fpx %-26s %s | %s'
                              % (x['ratio'], x['need'], x['size'], x['sel'][:26],
                                 x['color'], x['text'][:18]))
                    cdp.send('Target.closeTarget', {'targetId': t0})
                finally:
                    srv.terminate()

            elif name == 'popup':
                tot, bad, lst = scan_page(
                    cdp, ext, 'chrome-extension://%s/popup.html' % ext, 380, 560, settle=5)
                total_checked += tot
                total_bad += bad
                print('  %s %-12s 不达标 %d / 共 %d' % ('✓' if bad == 0 else '✗', 'popup', bad, tot))
                for x in lst[:5]:
                    print('      %.2f (需 %.1f) %4.1fpx %-26s %s | %s'
                          % (x['ratio'], x['need'], x['size'], x['sel'][:26],
                             x['color'], x['text'][:18]))
        except Exception as e:
            print('  ✗ %s 扫描失败：%s' % (name, e))
            total_bad += 1

    print('')
    print('对比度检查：%d 个元素，%d 个不达标' % (total_checked, total_bad))
    if total_bad:
        print('不达标元素见上（正文需 ≥4.5:1，大字需 ≥3:1）')
        return 1
    print('全部达标')
    return 0


if __name__ == '__main__':
    sys.exit(main())
