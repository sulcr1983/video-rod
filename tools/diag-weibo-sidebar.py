#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
微博图片识别 · 侧栏真机截图验证（B-81）

目的：确认侧栏「本页图片」列出来的是**正文配图**，而不是热搜徽章/头像/裂图。
做法（严格遵守 TESTING §0.0：只开一个微博页、滚两屏、看完就关）：
    1. 在扩展页调 chrome.runtime.reload()，让刚改的 js 生效
    2. 开一个微博标签页，等加载 + 滚两屏（触发懒加载）
    3. 开侧栏页面 image.html?tabId=N，等扫描，dump 卡片 + 截图
    4. 关掉自己开的标签页（不动别人）

用法：
    python tools/diag-weibo-sidebar.py --port 9480
"""
import argparse
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'deliverables', 'assets')


def open_page(cdp, url, w, h):
    tid = cdp.send('Target.createTarget', {'url': 'about:blank'})['targetId']
    sid = cdp.attach(tid)
    cdp.send('Page.enable', {}, sid)
    cdp.send('Runtime.enable', {}, sid)
    cdp.send('Emulation.setDeviceMetricsOverride', {
        'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': False
    }, sid)
    cdp.send('Page.navigate', {'url': url}, sid)
    return tid, sid


def shot(cdp, sid, path):
    try:
        s = cdp.send('Page.captureScreenshot', {'format': 'png'}, sid)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(base64.b64decode(s['data']))
        return path
    except Exception as e:
        return 'shot failed: %s' % e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=9480)
    ap.add_argument('--url', default='https://weibo.com/')
    ap.add_argument('--wait', type=int, default=11)
    a = ap.parse_args()

    # Edge 157 在这台机器上把调试端口绑到了 IPv6 回环
    cdp = Cdp('http://[::1]:%d' % a.port)
    ext, _sw = find_ext_id(cdp)
    print('扩展 ID:', ext)
    if not ext:
        print('找不到扩展，退出')
        return 1

    # 1) reload 扩展（改的是仓库根 js/，unpacked 加载，reload 后内容脚本才会用新代码）
    tid0, sid0 = open_page(cdp, 'chrome-extension://%s/install.html' % ext, 600, 500)
    # reload 会把这个页面的 JS 上下文销毁，任何等待回执的 eval 都会挂到超时。
    # 所以只发一帧（不等 response），然后重连 CDP。
    try:
        cdp.ws.send(json.dumps({
            'id': 99001, 'method': 'Runtime.evaluate',
            'params': {'expression': 'chrome.runtime.reload()'},
            'sessionId': sid0
        }))
    except Exception:
        pass
    time.sleep(4.5)
    try:
        cdp = Cdp('http://[::1]:%d' % a.port)     # 重连取新连接
    except Exception as e:
        print('重连失败：%s' % e)
    ext2, _ = find_ext_id(cdp)
    if ext2:
        ext = ext2

    # 2) 微博页：已有就复用（少加载一次 = 少一次站点请求），没有才新开
    tidp0, sidp0 = open_page(cdp, 'chrome-extension://%s/install.html' % ext, 400, 300)
    exist = cdp.eval(
        'new Promise(r => chrome.tabs.query({}, ts => r('
        'ts.filter(t => (t.url||"").indexOf(%s) === 0).map(t => t.id)[0] ?? -1)))' % json.dumps(a.url),
        sidp0)
    try:
        cdp.send('Target.closeTarget', {'targetId': tidp0})
    except Exception:
        pass

    if exist and exist > 0:
        print('复用已开的微博标签 tabId=%s' % exist)
        tid = None
        tlist = cdp.send('Target.getTargets', {})['targetInfos']
        for t in tlist:
            if t.get('url', '').startswith(a.url):
                tid = t['targetId']
                break
        if tid:
            sid = cdp.attach(tid)
            cdp.send('Runtime.enable', {}, sid)
            cdp.send('Page.enable', {}, sid)
            cdp.send('Page.bringToFront', {}, sid)
        else:
            tid, sid = open_page(cdp, a.url, 1280, 900)
    else:
        tid, sid = open_page(cdp, a.url, 1280, 900)
        time.sleep(a.wait)
        cdp.send('Page.bringToFront', {}, sid)
    for _ in range(2):
        cdp.eval('window.scrollBy(0, window.innerHeight * 0.9); 1', sid)
        time.sleep(2.4)

    # 用扩展页拿 tabId（网页上下文没有 chrome.tabs）
    tidp, sidp = open_page(cdp, 'chrome-extension://%s/install.html' % ext, 400, 300)
    tab_id = cdp.eval(
        'new Promise(r => chrome.tabs.query({}, ts => r('
        'ts.filter(t => (t.url||"").indexOf(%s) === 0).map(t => t.id)[0] ?? -1)))' % json.dumps(a.url),
        sidp)
    try:
        cdp.send('Target.closeTarget', {'targetId': tidp})
    except Exception:
        pass
    print('微博 tabId:', tab_id)
    if not tab_id or tab_id < 0:
        print('拿不到 tabId')
        return 1

    # 3) 侧栏页
    tid2, sid2 = open_page(cdp, 'chrome-extension://%s/image.html?tabId=%d' % (ext, tab_id), 430, 900)
    # 必须提到前台：缩略图是 loading=lazy，后台标签页里永不加载（截出来全是空卡片）
    cdp.send('Page.bringToFront', {}, sid2)
    time.sleep(15)
    info = cdp.eval("""
    (() => {
      const cells = Array.from(document.querySelectorAll('.ip-cell'));
      return JSON.stringify({
        count: cells.length,
        total: (document.querySelector('.ip-total, #ipCount, .ip-title b') || {}).textContent || '',
        items: cells.slice(0, 14).map(c => {
          const im = c.querySelector('img');
          const meta = c.querySelector('.ip-size, .ip-meta, .ip-dim');
          return {
            src: im ? (im.getAttribute('src') || '').slice(0, 90) : '',
            nw: im ? im.naturalWidth : 0,
            meta: meta ? meta.textContent.trim().slice(0, 24) : ''
          };
        })
      });
    })()
    """, sid2)
    try:
        d = json.loads(info) if isinstance(info, str) else {'raw': info}
    except Exception:
        d = {'raw': info}
    print(json.dumps(d, ensure_ascii=False, indent=1))

    p = shot(cdp, sid2, os.path.join(ASSETS, 'diag-weibo-sidebar-%s.png' % time.strftime('%H%M%S')))
    print('截图:', p)

    for t in (tid, tid2):
        try:
            cdp.send('Target.closeTarget', {'targetId': t})
        except Exception:
            pass


if __name__ == '__main__':
    main()
