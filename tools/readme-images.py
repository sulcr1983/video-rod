# -*- coding: utf-8 -*-
"""README 配图后处理：裁掉多余留白 → 统一宽度 → 落 docs/images/readme/

输入是 readme-ui.py / readme-popup.py 拍下的原始图，落在仓库外 ..\\work\\readme-shots\\，
不进版本库；要重做配图就先重拍再跑本脚本。下面 JOBS 里的 crop 坐标就是各图的取景参数。
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from vr_testenv import work_path  # noqa: E402

SRC = work_path("readme-shots")
DST = os.path.join(os.path.dirname(HERE), "docs", "images", "readme")
os.makedirs(DST, exist_ok=True)

# name -> (src, crop_box_in_png_px or None, target_width)
JOBS = [
    # 主视觉：库首页网格（1440x700@2x）
    ("01-hero-library", "hero-x-1200.png", (0, 0, 2400, 1250), 1200),
    # 面板（420x620@2x，原图 840x1240）
    ("02-popup", "10-popup-bili.png", None, 760),
    # 网页内悬停按钮：裁到播放器区域（CSS 30..760 x 110..545 → x2）
    ("03-hover-button", "11-hover-button.png", (60, 100, 1840, 1120), 1440),
    # 列表视图
    ("04-library-list", "02-list-view.png", (0, 0, 2880, 1240), 1440),
    # 预览器（视频 + 信息栏 + 胶片条）
    ("05-viewer", "03-detail.png", (0, 0, 2880, 1400), 1440),
    # 搜索语法
    ("07-search", "05-search.png", (0, 120, 1900, 900), 1200),
    # 筛选面板
    ("08-filter", "07-filter.png", (560, 80, 2180, 1330), 950),
    # 设置：保存位置
    ("09-settings", "08-options.png", (0, 0, 2420, 1760), 1080),
    # X 内联下载按钮 + 主页批量浮标
    ("10-x-inline", "12-batch-x.png", (330, 0, 2880, 1400), 1440),
    # 批量选择工具条
    ("11-batch-select", "batch-select.png", (0, 0, 2400, 1440), 1200),
    # 回收站：软删除 + 恢复
    ("12-trash", "trash-check.png", (0, 0, 2880, 1600), 1440),
]


def main():
    for name, src, box, width in JOBS:
        p = os.path.join(SRC, src)
        if not os.path.exists(p):
            print("!! 缺文件", src)
            continue
        im = Image.open(p).convert("RGB")
        if box:
            im = im.crop(box)
        if im.width != width:
            h = round(im.height * width / im.width)
            im = im.resize((width, h), Image.LANCZOS)
        out = os.path.join(DST, name + ".png")
        im.save(out, optimize=True)
        print("%-18s %5dx%-5d %6d KB" % (name, im.width, im.height, os.path.getsize(out) // 1024))


if __name__ == "__main__":
    main()
