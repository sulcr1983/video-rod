#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""文档-代码一致性核查。

检查 docs/*.md 里引用的文件路径是否在代码里真实存在，区分三类：
  ❌ 失效引用：文档描述为「现状」但代码里没有，且没有替代实现
  ⚠️ 位置变更：文件存在但搬家了（文档写旧路径）
  ℹ️ 规划项  ：设计文档里的「（新）」，未实现属正常

用法：
  python tools/check-doc-sync.py           # 报告
  python tools/check-doc-sync.py --strict  # 有 ❌ 时以非零码退出（CI 用）
"""
import argparse
import collections
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 文档里描述「规划/新增」的信号词——命中则不报 ❌
PLANNED_HINTS = ('（新）', '(新)', '新增', '计划', '规划', '待建', '拟')

# 元引用信号：文档在「说明某个文件的去向/改名/不存在」本身，不是把它当现状引用
META_HINTS = (
    '不存在', '漂移', '未实现', '缺失', '没有实现', '尚未',
    '原计划', '实际落点', '实际路径', '实际在', '并入', '移到', '改名为',
)

# 已知的、有意的路径变更：文档名 -> 实际位置（搬家不算缺失）
MOVED = {
    'js/sw-library.js': 'js/library/sw-library.js',
    'js/library-path.js': 'js/library/path.js',
    'js/library/bridge.js': None,      # 能力并入 sw-library.js + background.js
}

# 明确未实现的功能（未实现是事实，不算文档漂移——但要在 TODO 里列着）
NOT_IMPLEMENTED = {
    'js/library/archive.js',   # B 模式自定义目录
    'js/album.js',
    'js/image-collection.js',
}

# 第三方库：文档里可能写成不带 .min 的名字
LIB_ALIASES = {
    'js/lib/floating-ui.dom.min.js': [
        'js/lib/floating-ui.dom.umd.min.js',
        'js/lib/floating-ui.core.umd.min.js',
    ],
}


def collect_existing():
    """收集仓库里真实存在的代码文件。"""
    exist = set()
    for pattern in ('js/**/*.js', 'lib/**/*.js', 'tools/*.py', 'tools/*.js',
                    '*.html', 'test-site/*.html', 'docs/*.md'):
        for p in glob.glob(os.path.join(ROOT, pattern), recursive=True):
            exist.add(os.path.relpath(p, ROOT).replace('\\', '/'))
    return exist


def scan_docs(exist):
    """扫描文档里的 js/xxx.js 引用，返回 {路径: {文档: [上下文行]}}。"""
    refs = collections.defaultdict(lambda: collections.defaultdict(list))
    # 用「前面不是 / 或单词字符」做左边界，避免从 js/library/x.js 里截出 js/x.js；
    # 同时仍能匹配完整的 js/library/x.js。
    pat = re.compile(r'(?<![\w/])(js/[\w\-./]+\.js)')
    for path in glob.glob(os.path.join(ROOT, 'docs', '*.md')):
        name = os.path.basename(path)
        try:
            text = open(path, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        for lineno, line in enumerate(text.split('\n'), 1):
            for m in pat.finditer(line):
                # 存**完整行**：截断只用于显示，若在这里就切掉，
                # 后面的元引用判断会看不到行尾的「实际路径」等关键词（踩过）。
                refs[m.group(1)][name].append((lineno, line.strip()))
    return refs


def classify(ref, doc, lines, exist):
    """判定一个引用属于哪一类。"""
    if ref in exist:
        return 'ok', ''

    # 元引用优先：这一行本身在说明该文件的去向/改名，不是把它当现状引用
    # （必须在 MOVED 判断之前，否则「实际在 xxx」这种说明会被当成搬家报警）
    for lineno, line in lines:
        if any(h in line for h in META_HINTS):
            return 'meta', '文档在说明该文件的去向（元引用）'

    # 第三方库别名（显式登记的）
    for alt in LIB_ALIASES.get(ref, []):
        if alt in exist:
            return 'ok', f'实际文件：{alt}'

    # 省略 .min / 前缀不同的第三方库：js/hls.js 实为 lib/hls.min.js
    base = os.path.basename(ref).replace('.js', '')
    for cand in (f'lib/{base}.min.js', f'lib/{base}.js',
                 f'js/lib/{base}.min.js', f'js/lib/{base}.umd.min.js'):
        if cand in exist:
            return 'ok', f'实际文件：{cand}'

    # 已知搬家
    if ref in MOVED:
        actual = MOVED[ref]
        if actual and actual in exist:
            return 'moved', f'实际在 {actual}'
        if actual is None:
            return 'moved', '能力已并入 sw-library.js + background.js'

    # 明确未实现
    if ref in NOT_IMPLEMENTED:
        return 'planned', '功能尚未实现（已在 TODO-VERIFIED.md 记录）'

    # 文档里带「新增/规划」字样
    for lineno, line in lines:
        if any(h in line for h in PLANNED_HINTS):
            return 'planned', '文档标注为规划项'

    # 其余：只在「现状类」文档里出现才算失效
    STATUS_DOCS = ('HANDOFF.md', 'TESTING.md', 'DECISIONS.md',
                   'TODO-VERIFIED.md', 'PRODUCT-IMAGE-ENTRY.md')
    if doc in STATUS_DOCS:
        return 'missing', '现状类文档引用了不存在的文件'

    return 'planned', '设计文档中的规划项'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--strict', action='store_true', help='有失效引用时退出码 1')
    args = ap.parse_args()

    exist = collect_existing()
    refs = scan_docs(exist)

    buckets = collections.defaultdict(list)
    for ref, docs in refs.items():
        worst = None
        for doc, lines in docs.items():
            kind, note = classify(ref, doc, lines, exist)
            if kind in ('ok', 'meta'):
                continue
            buckets[kind].append((ref, doc, lines, note))
            if kind == 'missing':
                worst = 'missing'

    total_refs = len(refs)
    ok_refs = total_refs - len({r for kind in buckets for r, *_ in buckets[kind]})

    print(f'文档引用的 js 文件：{total_refs} 个，全部存在：{ok_refs} 个\n')

    if buckets['missing']:
        print('❌ 失效引用（现状类文档引用了不存在的文件）')
        for ref, doc, lines, note in buckets['missing']:
            print(f'   {ref}   ← {doc}')
            for lineno, line in lines[:2]:
                print(f'       L{lineno}: {line[:110]}')
        print()

    if buckets['moved']:
        print('⚠️ 位置变更（文件搬家了，文档还写旧路径）')
        for ref, doc, lines, note in buckets['moved']:
            print(f'   {ref}   ← {doc}   （{note}）')
        print()

    if buckets['planned']:
        print('ℹ️ 规划项 / 未实现（属正常，不算漂移）')
        seen = set()
        for ref, doc, lines, note in buckets['planned']:
            if ref in seen:
                continue
            seen.add(ref)
            print(f'   {ref}   （{note}）')
        print()

    bad = len(buckets['missing'])
    print('—' * 50)
    if bad:
        print(f'结论：{bad} 处失效引用需要修文档')
    else:
        print('结论：无失效引用 ✅')
    sys.exit(1 if (args.strict and bad) else 0)


if __name__ == '__main__':
    main()
