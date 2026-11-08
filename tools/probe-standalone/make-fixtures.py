"""生成 standalone 探针素材：4 类媒体 × 4 种文件名。

为什么需要这个脚本：
  探针要验证的是「file:// 本地网页能不能直接用相对路径读素材」，
  而真正的失败点几乎全在**文件名编码**上（中文、空格、#、%）。
  所以每类媒体都复制 4 份，文件名覆盖这 4 种边界，一次跑全。

素材从哪来：
  - 图片：test-site/media/cover.jpg（已有夹具）
  - 动图：.work/gif-fixture.gif（已有夹具）
  - 视频：.work/first-run-downloads/test.mp4（已有夹具）
  - 音频：本脚本用标准库 wave 现场合成 1 秒正弦波，零外部依赖（不引入 ffmpeg）

产物位置：<目标目录>/{image,gif,video,audio}/<变体>.<ext>
  <变体> ∈ ascii / chinese / spaces / reserved
  reserved 变体专门带上 # 和 %，这是 file:// URL 拼接最容易翻车的两个字符。

用法：
  python tools/probe-standalone/make-fixtures.py            # 默认 E:/test/vr-standalone-probe
  python tools/probe-standalone/make-fixtures.py --out D:/x
"""
import argparse
import json
import math
import os
import shutil
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DEFAULT_OUT = "E:/test/vr-standalone-probe"

# 变体名 → 文件名主体（不含扩展名）。reserved 里刻意放 # 和 %。
VARIANTS = {
    "ascii": "sample",
    "chinese": "中文样本",
    "spaces": "with space",
    "reserved": "hash#pct%样",
}

# 复用仓库里已有的夹具，避免为了探针再造一遍二进制
SOURCES = {
    "image": (os.path.join(ROOT, "test-site", "media", "cover.jpg"), ".jpg"),
    "gif": (os.path.join(ROOT, ".work", "gif-fixture.gif"), ".gif"),
    "video": (os.path.join(ROOT, ".work", "first-run-downloads", "test.mp4"), ".mp4"),
}


def write_wav(path, seconds=1.0, rate=8000, freq=440.0):
    """合成一段单声道 8kHz 正弦波 WAV。够 <audio> 读出 duration 就行。"""
    n = int(seconds * rate)
    frames = bytearray()
    for i in range(n):
        v = int(12000 * math.sin(2 * math.pi * freq * i / rate))
        frames += struct.pack("<h", v)
    data_size = len(frames)
    with open(path, "wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVEfmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(bytes(frames))


def build_index(out_dir, count=50000):
    """生成探针用的索引夹具，三种形态各一份：

      _library/index.json      ← 给 fetch / XHR 读（T6 / T7）
      _library/index.json.js   ← 给 <script src> 读（T5），内容是 window.__vrProbeIndex = {...}
      _library/index-big.json.js ← 5 万条，测加载与解析成本（T13）

    big 版只在 count 上放大，字段结构与真实索引一致，避免测出的耗时失真。
    """
    lib = os.path.join(out_dir, "_library")
    os.makedirs(lib, exist_ok=True)

    def one(i):
        return {
            "relPath": f"中文站点/博主{i % 97}/图片/样本_{i}.jpg",
            "size": 200000 + (i % 800000),
            "mtime": 1762000000000 + i * 1000,
            "platform": ["xiaohongshu", "x", "weibo", "bilibili"][i % 4],
            "creatorId": f"u{i % 97}",
            "type": ["image", "video", "anim", "audio"][i % 4],
            "fileName": f"样本_{i}.jpg",
            "starred": 1 if i % 13 == 0 else 0,
            "tags": ["风景", "人像"][0:1] if i % 5 == 0 else [],
        }

    files = [one(i) for i in range(count)]
    payload = {
        "version": 1,
        "at": 1762000000000,
        "root": "D:/probe-root",
        "subdir": "",
        "count": count,
        "files": files,
    }

    made = []
    plain = os.path.join(lib, "index.json")
    blob = json.dumps(payload, ensure_ascii=False)
    with open(plain, "w", encoding="utf-8") as f:
        f.write(blob)
    made.append(plain)

    # 小版只留前 200 条，避免 T5 也要解析 5 万条、把耗时混进别的结论
    small = dict(payload)
    small["files"] = files[:200]
    small["count"] = 200
    js = os.path.join(lib, "index.json.js")
    with open(js, "w", encoding="utf-8") as f:
        f.write("window.__vrProbeIndex = " + json.dumps(small, ensure_ascii=False) + ";\n")
    made.append(js)

    big = os.path.join(lib, "index-big.json.js")
    with open(big, "w", encoding="utf-8") as f:
        f.write("window.__vrProbeBigIndex = " + blob + ";\n")
    made.append(big)

    return made


def build(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    made = []

    for kind, (src, ext) in SOURCES.items():
        if not os.path.exists(src):
            print(f"!! 缺素材 {src}（{kind}）——跳过这一类", flush=True)
            continue
        sub = os.path.join(out_dir, kind)
        os.makedirs(sub, exist_ok=True)
        for variant, stem in VARIANTS.items():
            dst = os.path.join(sub, f"{stem}{ext}")
            shutil.copyfile(src, dst)
            made.append(dst)

    # 音频单独合成，不依赖任何外部夹具
    sub = os.path.join(out_dir, "audio")
    os.makedirs(sub, exist_ok=True)
    for variant, stem in VARIANTS.items():
        dst = os.path.join(sub, f"{stem}.wav")
        write_wav(dst)
        made.append(dst)

    return made


def main():
    ap = argparse.ArgumentParser(description="生成 standalone 探针素材")
    ap.add_argument("--out", default=DEFAULT_OUT, help=f"输出目录（默认 {DEFAULT_OUT}）")
    args = ap.parse_args()

    made = build(args.out)
    made += build_index(args.out)
    print(f"→ 输出目录 {args.out}", flush=True)
    for p in made:
        print(f"   {os.path.getsize(p):>7} B  {os.path.basename(p)}", flush=True)
    print(f"OK 共 {len(made)} 个素材（4 类 x 4 种文件名）", flush=True)
    return 0 if made else 2


if __name__ == "__main__":
    sys.exit(main())