"""
断言契约检查（防止「测试腐烂」）——2026-11-12

问题：测试脚本里写死了 `getElementById('setdrawer')`，而页面上那个元素在
2026-11-10 就被删掉了。断言永远拿到 null → 一直静默失败，没人发现
（实例：e2e-buttons 的「设置抽屉」两条用例，直到 11-12 才被抓出来）。

做法：把「测试脚本引用的 DOM id」和「源码里真实存在的 id」对一遍。
真实存在 = 满足任一：
  1. HTML 里有 id="x" / id='x'
  2. JS 里动态创建：.id = 'x'、setAttribute('id','x')、id: 'x'、模板 id="x"
  3. 该测试脚本自己内联了 fixture（自己拼的假页面），也算自建

只查 id：class 名在样式层大量复用，误报太高，不查。

用法：python tools/check-assert-dom.py [--quiet]
退出码：0 全过 / 1 有陈旧引用
"""
import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HTML_GLOBS = [
    'library.html', 'popup.html', 'options.html', 'image.html', 'preview.html',
    'install.html', 'downloads.html', 'downloader.html', 'json.html', 'mpd.html',
    'm3u8.html', 'm3u8-multi.html', 'offscreen.html',
]
SRC_DIRS = ['js', 'css']

# 这些脚本自带假页面（fixture），引用自己造的 id 属正常
FIXTURE_HINT = re.compile(r'(<!doctype|<html|id=")', re.I)

RE_ID_IN_HTML = re.compile(r"""\bid\s*=\s*["']([A-Za-z][\w-]*)["']""")
RE_ID_IN_JS = [
    re.compile(r"""\.id\s*=\s*["']([A-Za-z][\w-]*)["']"""),
    re.compile(r"""setAttribute\(\s*["']id["']\s*,\s*["']([A-Za-z][\w-]*)["']"""),
    re.compile(r"""\bid\s*:\s*["']([A-Za-z][\w-]*)["']"""),
    # 内容脚本常用「id 常量」再赋值：const HOST_ID = 'vr-note-host'
    re.compile(r"""(?:const|let|var)\s+\w*ID\w*\s*=\s*["']([A-Za-z][\w-]*)["']"""),
]
# 测试脚本里的引用方式
RE_REF = [
    re.compile(r"""getElementById\(\s*["']([A-Za-z][\w-]*)["']"""),
    re.compile(r"""querySelector(?:All)?\(\s*["']#([A-Za-z][\w-]*)["']"""),
    re.compile(r"""\$\$?\(\s*["']#([A-Za-z][\w-]*)["']"""),
]

# 少数引用是「故意测不存在」的负向用例，或来自浏览器内置，登记在这里
ALLOW = {
    'app', 'root',            # 通用容器名，可能由宿主页面提供
    'dev-reload-button',      # edge://extensions 宿主页内置
    'viewBtn',                # e2e-buttons 里有「找不到就换 className 兜底」，属防御式
}


def read(path):
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            return f.read()
    except OSError:
        return ''


def collect_real_ids():
    ids = set()
    for name in HTML_GLOBS:
        p = os.path.join(ROOT, name)
        if os.path.exists(p):
            ids |= set(RE_ID_IN_HTML.findall(read(p)))
    for d in SRC_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for fn in os.listdir(base):
            if not fn.endswith(('.js', '.css', '.html')):
                continue
            t = read(os.path.join(base, fn))
            for rx in RE_ID_IN_JS:
                ids |= set(rx.findall(t))
            ids |= set(RE_ID_IN_HTML.findall(t))
    return ids


def check_script(path, real_ids):
    text = read(path)
    if not text:
        return []
    # shadow DOM 内部的 id 不在主文档里，静态查不到 → 先剔除这类引用
    text_for_refs = re.sub(r'shadowRoot\.querySelector(?:All)?\([^)]*\)', '', text)
    refs = set()
    for rx in RE_REF:
        refs |= set(rx.findall(text_for_refs))
    # 「断言这个元素不存在」是合法负向用例：!!getElementById('x') 期望 false
    for m in re.finditer(r'!!\s*document\.getElementById\(\s*[\'"]' + r'([A-Za-z][\w-]*)', text):
        refs.discard(m.group(1))
    if not refs:
        return []
    self_fixture = bool(FIXTURE_HINT.search(text))
    missing = []
    for r in sorted(refs):
        if r in real_ids or r in ALLOW:
            continue
        # 脚本自己拼了假页面，且里面确实有这个 id → 自建，放过
        if self_fixture and re.search(r"""id\s*=\s*["']%s["']""" % re.escape(r), text):
            continue
        missing.append(r)
    return missing


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--quiet', action='store_true')
    a = ap.parse_args()

    real = collect_real_ids()
    tools = os.path.join(ROOT, 'tools')
    files = sorted(
        os.path.join(tools, f) for f in os.listdir(tools)
        if f.endswith('.py') and (f.startswith('e2e-') or f.startswith('qa-') or f.startswith('test-'))
    )
    pass_n = fail_n = 0
    bad = []
    for p in files:
        miss = check_script(p, real)
        if miss:
            fail_n += 1
            bad.append((os.path.basename(p), miss))
        else:
            pass_n += 1

    if not a.quiet:
        print('源码里可用的 DOM id：%d 个' % len(real))
        for name, miss in bad:
            print('FAIL %s 引用了不存在的 id：%s' % (name, ', '.join(miss)))
    print('%d passed, %d failed' % (pass_n, fail_n))
    return 0 if fail_n == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
