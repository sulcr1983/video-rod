#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
微博图片识别真机诊断（B-81）

背景（2026-11-13，苏哥截图）：
    侧栏「本页图片」收到的是「新 / 上新 / 沸 / 辟谣」这几个热搜徽章图标，
    尺寸全 0×0，还有一张裂图 —— 正文配图一张没进来。

这个脚本只做一件事：用登录态实例打开**一个**微博页，把 DOM 里
「到底有哪些图、哪些被扫到、哪些被漏掉」原样打出来 + 截图。
不下载、不写库、不反复刷新（遵守 TESTING §0.0）。

用法：
    python tools/vr-session.py ensure --reason "微博图片识别诊断"
    python tools/diag-weibo-images.py --url https://weibo.com/
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
LIB = os.path.join(ROOT, 'js', 'lib-image-util.js')


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
    ap.add_argument('--wait', type=int, default=9)
    ap.add_argument('--scroll', type=int, default=1, help='往下滚几次（每次约一屏）')
    a = ap.parse_args()

    # Edge 157 在这台机器上把调试端口绑到了 IPv6 回环（[::1]），127.0.0.1 会被拒。
    cdp = Cdp('http://[::1]:%d' % a.port)
    lib_src = open(LIB, encoding='utf-8').read()

    tid = cdp.send('Target.createTarget', {'url': 'about:blank'})['targetId']
    sid = cdp.attach(tid)
    cdp.send('Runtime.enable', {}, sid)
    cdp.send('Page.enable', {}, sid)
    # 把图扫工具注入页面主世界（真实 DOM），这样诊断用的就是产品同一套逻辑
    cdp.send('Page.addScriptToEvaluateOnNewDocument', {'source': lib_src}, sid)
    cdp.send('Page.navigate', {'url': a.url}, sid)
    time.sleep(a.wait)

    for _ in range(max(0, a.scroll)):
        cdp.eval('window.scrollBy(0, window.innerHeight * 0.9); 1', sid)
        time.sleep(2.2)

    dump = cdp.eval("""
    (() => {
      const U = self.VRImageUtil;
      const imgs = Array.from(document.querySelectorAll('img'));
      const all = U ? U.scanImages(document, {minWidth:100, minHeight:100,
                    minShow:U.PANEL_MIN_SHOW, dedupe:true}) : [];
      const strict = U ? U.scanImages(document, {minWidth:100, minHeight:100,
                    checkShow:false, dedupe:true}) : [];
      const bgs = U ? U.scanBackgrounds(document, {minShow:U.PANEL_MIN_SHOW, dedupe:true}) : [];
      return JSON.stringify({
        hasU: !!U,
        title: document.title,
        imgTotal: imgs.length,
        imgDecoded: imgs.filter(i => i.naturalWidth > 0).length,
        bgTotal: bgs.length,
        scanWithShow: all.length,      // 产品当前口径
        scanNoShow: strict.length,     // 去掉显示尺寸门槛
        scanUrls: all.slice(0, 12).map(x => x.url.slice(0, 96)),
        // 去掉显示门槛后能扫到的（用来判断「正文图到底在不在 <img> 里」）
        loose: strict.slice(0, 20).map(x => ({
          u: x.url.slice(0, 96), w: x.w, h: x.h,
          dw: Math.round(x.el && x.el.getBoundingClientRect ? x.el.getBoundingClientRect().width : 0)
        })),
        // 页面上所有「显示宽度 >= 200」的图（微博正文配图应该在这个集合里）
        bigImgs: imgs.filter(i => i.getBoundingClientRect().width >= 200)
          .slice(0, 10).map(i => ({
            src: (i.currentSrc || i.src || '').slice(0, 96),
            nw: i.naturalWidth, nh: i.naturalHeight,
            dw: Math.round(i.getBoundingClientRect().width),
            cls: (i.className || '').slice(0, 50)
          })),
        bgUrls: bgs.slice(0, 6).map(x => (x.url || '').slice(0, 96)),
        imgs: imgs.slice(0, 30).map(i => {
          const r = i.getBoundingClientRect();
          return {
            src: (i.currentSrc || i.src || '').slice(0, 96),
            ds: (i.getAttribute('data-src') || '').slice(0, 80),
            nw: i.naturalWidth, nh: i.naturalHeight,
            dw: Math.round(r.width), dh: Math.round(r.height),
            cls: (i.className || '').slice(0, 40),
            parentCls: ((i.parentElement && i.parentElement.className) || '').slice(0, 40)
          };
        })
      });
    })()
    """, sid)

    try:
        info = json.loads(dump) if isinstance(dump, str) else {'raw': dump}
    except Exception:
        info = {'raw': dump}

    print(json.dumps(info, ensure_ascii=False, indent=1))
    p = shot(cdp, sid, os.path.join(ASSETS, 'diag-weibo-%s.png' % time.strftime('%H%M%S')))
    print('截图:', p)

    # 只关自己开的这一页，不动别人的标签、不关浏览器
    try:
        cdp.send('Target.closeTarget', {'targetId': tid})
    except Exception:
        pass


if __name__ == '__main__':
    main()
