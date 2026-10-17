# video-rod 图标生成脚本（基于 PIL，4x 超采样抗锯齿）
# 生成：img/icon.png(64) / img/icon128.png(128) / img/icon-disable.png(64 灰色版)
# 用法：PYTHONPATH=<pillow_dir> python tools/video-rod-icon.py
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
S = 4  # 超采样倍数


def draw_fish(d, cx, cy, s, body, tail):
    """画一条简笔小鱼：椭圆身体 + 三角尾"""
    d.ellipse([cx - 0.22 * s, cy - 0.11 * s, cx + 0.22 * s, cy + 0.11 * s], fill=body)
    d.polygon([(cx + 0.20 * s, cy), (cx + 0.34 * s, cy - 0.10 * s),
               (cx + 0.34 * s, cy + 0.10 * s)], fill=tail)
    d.ellipse([cx - 0.16 * s, cy - 0.035 * s, cx - 0.10 * s, cy + 0.035 * s], fill=(255, 255, 255, 255))


def make_icon(size, gray=False):
    W = size * S
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def g(c):
        if not gray:
            return c
        r, gg, b, a = c
        v = int(0.299 * r + 0.587 * gg + 0.114 * b)
        return (v, v, v, a)

    rod = g((38, 50, 56, 255))        # 竿身深青灰
    grip = g((120, 144, 156, 255))    # 手柄
    guide = g((0, 188, 212, 255))     # 导线环亮青
    line_c = g((120, 144, 156, 255))  # 鱼线
    wave = g((41, 182, 246, 255))     # 水面波浪
    fish = g((255, 152, 0, 255))      # 鱼身橙
    fish_d = g((230, 110, 10, 255))   # 鱼尾深橙

    u = W / 128.0  # 以 128 为基准坐标

    # ---- 水面波浪（两条弧线）----
    for k, ybase in enumerate((0.78, 0.84)):
        pts = []
        for x in range(int(0.08 * W), int(0.92 * W), max(2, W // 90)):
            t = (x / W - 0.08) / 0.84
            y = (ybase + 0.018 * math.sin(t * math.pi * 3)) * W
            pts.append((x, y))
        d.line(pts, fill=wave, width=max(2, int(3.2 * u)), joint="curve")

    # ---- 鱼竿：竿柄左下 -> 竿尖右上 ----
    bx, by = 0.14 * W, 0.92 * W      # 竿柄底端
    tx, ty = 0.80 * W, 0.20 * W      # 竿尖
    d.line([(bx, by), (tx, ty)], fill=rod, width=max(2, int(6 * u)))
    # 手柄粗段
    d.line([(bx, by), (bx + 0.10 * W, by - 0.09 * W)], fill=grip, width=max(2, int(8 * u)))
    # 导线环（竿身上三个小点）
    for t in (0.45, 0.65, 0.85):
        gx = bx + (tx - bx) * t
        gy = by + (ty - by) * t
        r = max(1.5, 2.6 * u)
        d.ellipse([gx - r, gy - r, gx + r, gy + r], fill=guide)

    # ---- 鱼线：竿尖下垂，微弯到鱼钩 ----
    pts = []
    for i in range(41):
        t = i / 40
        x = tx + 0.10 * W * t * t          # 轻微右飘
        y = ty + (0.56 * W - ty) * t
        pts.append((x, y))
    d.line(pts, fill=line_c, width=max(1, int(1.6 * u)))
    # 鱼钩（小圆弧 + 钩尖）
    hx, hy = pts[-1]
    r = max(2, 4.2 * u)
    d.arc([hx - r, hy - r, hx + r, hy + r], start=270, end=150, fill=rod, width=max(1, int(2.2 * u)))
    d.line([(hx - r, hy), (hx - r - 0.012 * W, hy - 0.03 * W)], fill=rod, width=max(1, int(2.2 * u)))

    # ---- 水下游鱼 ----
    draw_fish(d, 0.34 * W, 0.95 * W, 0.30 * W, fish, fish_d)

    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    img_dir = os.path.join(ROOT, "img")
    make_icon(128).save(os.path.join(img_dir, "icon128.png"))
    make_icon(64).save(os.path.join(img_dir, "icon.png"))
    make_icon(64, gray=True).save(os.path.join(img_dir, "icon-disable.png"))
    print("icons written to", img_dir)
