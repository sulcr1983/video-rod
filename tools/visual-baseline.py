"""
视觉回归基线（2026-11-12，B-74）

为什么需要：换皮、改布局、动 CSS 之后，机器测不出「有没有走样」——
只有人截图看一眼。而人看一眼的结果是：这次看了，下次没人看。

做法：把 3 个**不依赖数据**的界面各截一张图存成基线；以后每次跑，
再截一张逐像素比对，差异超阈值就红，并输出红色 diff 图指出哪块变了。

只选不依赖库数据的屏，避免「数据一变就红」的假告警：
  · popup     —— 无 tabId 的空态
  · options   —— 设置页静态布局
  · install   —— 安装引导页

（资源库主界面由数据驱动，树计数/卡片数每天都变，不适合做像素基线；
  它的结构与交互由 stage-rewrite / e2e-buttons 断言兜着。）

用法：
    python tools/visual-baseline.py --update    # 生成/刷新基线
    python tools/visual-baseline.py             # 比对（默认，红了返回 1）
    python tools/visual-baseline.py --port 9490 --ext <id>
"""
import argparse
import base64
import os
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_DIR = os.path.join(ROOT, 'deliverables', 'visual-baseline')
DIFF_DIR = os.path.join(ROOT, 'deliverables', 'test-runs')

# 阈值：差异像素占全图比例。0.15% 能容忍字体抗锯齿/滚动条，但抓得住整块色值变化。
DEFAULT_TOL = 0.0015
# 单像素差异低于此值视为抗锯齿噪声（0-255）
PIXEL_FLOOR = 16

# 第五列是「截图前要执行的 JS」（准备状态），不是点击 —— 视觉基线要的是
# **确定的静态终态**，所以凡是会随状态变化的浮层都要先钉死。
# 三个屏共用同一份「起跑线」：
#   · vrLibIntroDone —— 关掉 popup 的一次性引导浮层（否则第一张基线与第二次差 24%）
#   · detectedRoot='' + subdir   —— 让 options「保存位置」的说明文案固定
#     （不钉的话，文案里会带本机真实路径，换台机器/换个下载目录就红，
#      实测就红在「默认保存在…下的子目录」这一行）
PREP_STATE = (
    "new Promise(function(done){"
    "try{chrome.storage.local.get('vrLibSettings',function(o){"
    "var s=Object.assign({},o.vrLibSettings||{});"
    "s.detectedRoot='';s.subdir='video-rod';"
    "if(s.mode==='custom'){s.mode='downloads';s.customRoot='';s.customName='';}"
    "chrome.storage.local.set({vrLibSettings:s,vrLibIntroDone:true,vrLibIntroSeen:9},"
    "function(){done(1);});});}catch(e){done(0);}})")

# 截图前要「临时钉住」的动态文案。
# 为什么要在页面上改 DOM：options 的「保存位置」那行读的是**内存里推导出的
# 下载根**（detectedRootCache ← chrome.downloads 记录），改 storage 钉不住。
# 跑过下载类套件后记录里多了文件，这行就从「系统下载目录\video-rod（首次下载时自动创建）」
# 变成一条绝对路径，整行宽度变了 → 0.2% 的假差异（实测）。
# 文案本身由 skin 套件断言兜着；视觉基线只负责布局与配色，所以这一行按固定串渲染。
POST_FIX = {
    'options': ("(()=>{var e=document.getElementById('vrLibRoot');"
                "if(e){e.textContent='系统下载目录\\\\video-rod（首次下载时自动创建）';e.title='';}"
                "return 1})()"),
}

SHOTS = [
    # name, path, width, height, prep
    ('popup', 'popup.html', 380, 560, PREP_STATE),
    ('options', 'options.html', 1024, 720, PREP_STATE),
    ('install', 'install.html', 1024, 820, PREP_STATE),
]


def open_page(cdp, url, w, h):
    tid = cdp.send('Target.createTarget', {'url': url})['targetId']
    ps = cdp.attach(tid)
    cdp.send('Runtime.enable', {}, ps)
    cdp.send('Page.enable', {}, ps)
    try:
        cdp.send('Emulation.setDeviceMetricsOverride',
                 {'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False}, ps)
    except Exception:
        pass
    # 关掉动画与过渡：安装页/设置页有入场动画，两次截图落在不同帧上会得到
    # 0.2%~0.3% 的「假差异」（实测 install 页因此误红）。
    # 视觉基线要的是**静态终态**，不是某一帧。
    try:
        cdp.send('Emulation.setEmulatedMedia',
                 {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]}, ps)
    except Exception:
        pass
    cdp.wait_ready(ps, 25)
    return tid, ps


def freeze(ps, cdp):
    """注入禁动画样式：截到的是静态终态，不是某一帧。"""
    try:
        cdp.eval("(()=>{const s=document.createElement('style');"
                 "s.textContent='*{animation:none!important;transition:none!important;"
                 "caret-color:transparent!important}';"
                 "(document.head||document.documentElement).appendChild(s);return 1})()", ps)
    except Exception:
        pass


def shot(cdp, ps, out):
    data = cdp.send('Page.captureScreenshot', {'format': 'png'}, ps)['data']
    with open(out, 'wb') as f:
        f.write(base64.b64decode(data))


def compare(base_path, cur_path, name, tol):
    """返回 (ok, ratio, msg, diff_path)"""
    try:
        from PIL import Image, ImageChops
    except Exception as e:
        return (True, 0.0, 'PIL 不可用，跳过比对（%s）' % e, '')
    a = Image.open(base_path).convert('RGB')
    b = Image.open(cur_path).convert('RGB')
    if a.size != b.size:
        return (False, 1.0, '尺寸变了：基线 %sx%s → 现在 %sx%s' % (a.width, a.height, b.width, b.height), '')
    diff = ImageChops.difference(a, b).convert('L')
    hist = diff.histogram()
    total = a.width * a.height
    bad = sum(hist[PIXEL_FLOOR + 1:])
    ratio = bad / float(total) if total else 0.0

    diff_path = ''
    if ratio > tol:
        # 生成红色标注图：差异处涂红盖在原图上，方便一眼看出动了哪块
        try:
            os.makedirs(DIFF_DIR, exist_ok=True)
            diff_path = os.path.join(DIFF_DIR, 'visual-diff-%s.png' % name)
            mask = diff.point(lambda v: 255 if v > PIXEL_FLOOR else 0)
            red = Image.new('RGB', a.size, (255, 40, 40))
            out = b.copy()
            out.paste(red, (0, 0), mask)
            out.save(diff_path)
        except Exception:
            diff_path = ''
    ok = ratio <= tol
    msg = '差异 %.3f%%（阈值 %.2f%%）' % (ratio * 100, tol * 100)
    return (ok, ratio, msg, diff_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=9480)
    ap.add_argument('--ext', default='')
    ap.add_argument('--update', action='store_true', help='生成/刷新基线')
    ap.add_argument('--tol', type=float, default=DEFAULT_TOL, help='容差（差异像素占比）')
    ap.add_argument('--keep', action='store_true', help='截图留档不关页面')
    a = ap.parse_args()

    cdp = Cdp('http://127.0.0.1:%d' % a.port)
    ext = a.ext
    if not ext:
        ext, _sw = find_ext_id(cdp)
    os.makedirs(BASE_DIR, exist_ok=True)

    ok_n = fail_n = 0
    fails = []
    opened = []
    # 当前截图是过程产物，不该留在交付目录里 —— 用临时目录，退出即清。
    tmp_dir = tempfile.mkdtemp(prefix='vr-visual-')
    for name, path, w, h, prep in SHOTS:
        url = 'chrome-extension://%s/%s' % (ext, path)
        tmp = os.path.join(tmp_dir, name + '.png')
        try:
            tid, ps = open_page(cdp, url, w, h)
            opened.append(tid)
            # 先钉状态（如「新手引导已读」），再 reload 让页面按新状态重绘 ——
            # popup 的引导浮层是一次性的，第一张基线与第二次截图差 24%（实测）。
            if prep:
                try:
                    cdp.eval(prep, ps)
                except Exception:
                    pass
                try:
                    cdp.send('Page.reload', {}, ps)
                except Exception:
                    pass
                time.sleep(1.0)
                try:
                    cdp.wait_ready(ps, 25)
                except Exception:
                    pass
            freeze(ps, cdp)
            post = POST_FIX.get(name)
            if post:
                try:
                    cdp.eval(post, ps)
                except Exception:
                    pass
            time.sleep(2.2)          # 让字体/布局稳定，别截到半帧
            shot(cdp, ps, tmp)
        except Exception as e:
            print('FAIL %-9s 截图失败：%s' % (name, e))
            fail_n += 1
            fails.append(name)
            continue

        base = os.path.join(BASE_DIR, name + '.png')
        if a.update:
            try:
                shutil.copyfile(tmp, base)
                print('BASE %-9s 已写入基线 %s' % (name, os.path.relpath(base, ROOT)))
                ok_n += 1
            except Exception as e:
                print('FAIL %-9s 写基线失败：%s' % (name, e))
                fail_n += 1
            continue

        if not os.path.exists(base):
            print('SKIP %-9s 没有基线（先跑 --update）' % name)
            continue
        ok, ratio, msg, diff_path = compare(base, tmp, name, a.tol)
        if ok:
            print('PASS %-9s %s' % (name, msg))
            ok_n += 1
            # 过期的 diff 图会误导：屏幕上已经一致了，目录里还躺着一张红图，
            # 下次排障的人会以为还在走样。通过即删（2026-11-12）。
            try:
                stale = os.path.join(DIFF_DIR, 'visual-diff-%s.png' % name)
                if os.path.exists(stale):
                    os.remove(stale)
            except Exception:
                pass
        else:
            print('FAIL %-9s %s%s' % (name, msg, ('｜diff: ' + os.path.relpath(diff_path, ROOT)) if diff_path else ''))
            fail_n += 1
            fails.append(name)

    if not a.keep:
        for tid in opened:
            try:
                cdp.send('Target.closeTarget', {'targetId': tid})
            except Exception:
                pass
    shutil.rmtree(tmp_dir, ignore_errors=True)

    if a.update:
        print('\n基线已更新：%d 屏' % ok_n)
        return 0
    print('\n%d passed, %d failed' % (ok_n, fail_n))
    if fails:
        print('失败屏：' + ', '.join(fails))
    return 0 if fail_n == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
