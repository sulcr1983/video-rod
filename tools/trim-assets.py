#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""trim-assets.py —— 按 docs/ARTIFACT-MANAGEMENT.md §4.2 治理截图进 git 的规模。

规范原文：
  1. 新截图默认不进 git（放 work/scratch/shots/）
  2. **只有被文档引用的截图才可进 git**，且单张 ≤ 300 KB
  3. 进 git 的截图必须登记在 deliverables/DELIVERABLES.md §4
  4. deliverables/assets/ 新增总量 ≤ 10 MB

2026-11-09 实测违反情况：116 张 PNG / 23 MB（assets 11M + reviews 11M），
其中 107 张**没有任何文档引用**；4 张被引用的也超 300 KB 上限。

用法：
  python tools/trim-assets.py --dry-run    # 只报告，不动文件
  python tools/trim-assets.py --apply      # 执行（压缩超限的 + 移走未引用的）
  python tools/trim-assets.py --apply --keep-reviews   # 只治理 assets/，reviews/ 保留

移走而非删除：未引用的截图进 archive/deliverables-unreferenced/（留证），
需要时能恢复，且不进 git（archive 里只留 .md 说明，不留二进制）。
"""
import argparse
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_KB = 300
PAT = re.compile(r"deliverables/[A-Za-z0-9_./-]+\.(?:png|jpg|jpeg|webp)")


def _md_files():
    """全仓 md（含 docs/ 与 deliverables/ 的多层子目录）。"""
    out = []
    for base in ("README.md", "docs", "deliverables"):
        p = os.path.join(ROOT, base)
        if os.path.isfile(p):
            out.append(p)
        elif os.path.isdir(p):
            for dp, dn, fn in os.walk(p):
                for f in fn:
                    if f.endswith(".md"):
                        out.append(os.path.join(dp, f))
    return out


def collect_refs():
    """收集**被任何 md 提及**的截图路径（posix 风格）。

    口径说明：2026-11-09 实测全仓 md 的 `![]()` 图片语法全是**外链**
    （指向上游 cat-catch 的 raw），本地截图一张都没被内联引用；本地截图的
    出现形式是「文字提及」（如「产出截图 deliverables/assets/xxx.png」）。
    因此这里认「路径字符串出现」，而不是只认 markdown 图片语法 ——
    否则会把文档明确提到的产出物误判为孤儿删掉。
    """
    refs = set()
    for p in _md_files():
        try:
            t = open(p, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for m in PAT.finditer(t):
            refs.add(m.group(0).replace("\\", "/"))
    return refs


def kb(p):
    return os.path.getsize(p) / 1024.0


def compress(src, dst, max_kb=MAX_KB):
    """把图压到 ≤ max_kb。

    ⚠️ 格式必须与扩展名一致：2026-11-09 首版把 PNG 内容写成 WebP 却保留
    .png 后缀 —— GitHub/浏览器会渲染失败（RIFF 头但叫 .png）。所以：
      · PNG 源：优先真 PNG（降采样 + optimize）；压不动就**改存 .jpg 并同步
        更新 md 里的引用路径**（由调用方处理）。
      · JPEG 源：直接降质。
    返回 (quality, new_kb, fmt)。fmt='need-jpg' 表示建议改扩展名。
    """
    from PIL import Image
    im = Image.open(src)
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA")
    w, h = im.size
    if w > 1400:
        im = im.resize((1400, int(h * 1400 / w)), Image.LANCZOS)
    if src.lower().endswith(".png"):
        tmp = dst + ".tmp.png"
        im.convert("RGB").save(tmp, format="PNG", optimize=True, compress_level=9)
        if kb(tmp) <= max_kb:
            shutil.move(tmp, dst)
            return None, kb(dst), "png"
        os.remove(tmp)
        return None, kb(src), "need-jpg"
    # JPEG 源：降质
    for q in (88, 82, 75, 68):
        tmp = dst + ".tmp.jpg"
        im.convert("RGB").save(tmp, format="JPEG", quality=q, optimize=True)
        if kb(tmp) <= max_kb:
            shutil.move(tmp, dst)
            return q, kb(dst), "jpeg"
        os.remove(tmp)
    return None, kb(src), "keep"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--keep-reviews", action="store_true",
                    help="只治理 deliverables/assets/，reviews/ 保留")
    a = ap.parse_args()
    if not a.apply and not a.dry_run:
        a.dry_run = True

    refs = collect_refs()
    print("=== 被文档引用的截图（%d 张）===" % len(refs))
    for r in sorted(refs):
        p = os.path.join(ROOT, r)
        mark = "OK" if os.path.exists(p) and kb(p) <= MAX_KB else (
            "缺失" if not os.path.exists(p) else "超限%.0fKB" % kb(p))
        print("  [%s] %s" % (mark, r))

    targets = [os.path.join(ROOT, "deliverables", "assets")]
    if not a.keep_reviews:
        targets.append(os.path.join(ROOT, "deliverables", "reviews"))

    unreferenced = []
    oversized = []
    for base in targets:
        for dp, dn, fn in os.walk(base):
            for f in fn:
                if not f.lower().endswith((".png", ".jpg", ".jpeg")):
                    continue
                full = os.path.join(dp, f)
                rel = os.path.relpath(full, ROOT).replace("\\", "/")
                if rel not in refs:
                    unreferenced.append((full, rel, kb(full)))
                elif kb(full) > MAX_KB:
                    oversized.append((full, rel, kb(full)))

    print("\n=== 未被任何文档引用（%d 张，%.1f MB）===" % (len(unreferenced), sum(x[2] for x in unreferenced) / 1024))
    for full, rel, k in sorted(unreferenced, key=lambda x: -x[2])[:10]:
        print("  %6.0fKB  %s" % (k, rel))
    if len(unreferenced) > 10:
        print("  ... 其余 %d 张略" % (len(unreferenced) - 10))

    print("\n=== 被引用但超 %d KB 上限（%d 张）===" % (MAX_KB, len(oversized)))
    for full, rel, k in oversized:
        print("  %6.0fKB  %s" % (k, rel))

    if a.dry_run:
        print("\n（dry-run，未动任何文件）")
        return 0

    # 1) 压缩超限的（原地替换，保持路径不变 → 文档引用不失效）
    for full, rel, k in oversized:
        q, nk, fmt = compress(full, full)
        print("  压缩 %s：%.0fKB → %.0fKB (%s q%s)" % (rel, k, nk, fmt, q))

    # 2) 移走未引用的（进 archive 留证，不进 git）
    moved = 0
    freed = 0
    arch = os.path.join(ROOT, "archive", "deliverables-unreferenced")
    for full, rel, k in unreferenced:
        dst = os.path.join(arch, rel.replace("deliverables/", ""))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(full, dst)
        moved += 1
        freed += k
    print("\n  移走未引用截图 %d 张（%.1f MB）→ archive/deliverables-unreferenced/" % (moved, freed / 1024))

    # 3) 清空搬空了的目录
    for base in targets:
        for dp, dn, fn in list(os.walk(base, topdown=False)):
            if not os.listdir(dp):
                try:
                    os.rmdir(dp)
                except OSError:
                    pass

    # 4) 写留证说明
    os.makedirs(arch, exist_ok=True)
    with open(os.path.join(arch, "README.md"), "w", encoding="utf-8") as f:
        f.write("""# archive/deliverables-unreferenced —— 未被文档引用的截图留证

**归档日期**：2026-11-09（公开前治理）

**为什么归档**：docs/ARTIFACT-MANAGEMENT.md §4.2 规定「只有被文档引用的截图
才可进 git」。实测 116 张截图里 **107 张没有任何文档引用**（合计 ~20 MB），
是把 `.git` 撑到 42 MB 的主因之一。

**处置**：移到这里（不进 git，只留本 README 说明），不删除 —— 需要时可恢复：

```bash
git mv archive/deliverables-unreferenced/assets/<name>.png deliverables/assets/<name>.png
```

注意：本目录**不提交到 git**（二进制证据留给本机），恢复办法如上。
""")
    print("  留证说明：archive/deliverables-unreferenced/README.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
