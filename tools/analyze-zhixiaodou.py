"""拆解「智小抖 - 抖音AI全能助手」扩展：提取它拦截的抖音接口清单与取数逻辑。

苏哥 2026-11-09 指定：不要自己瞎猜抖音怎么取标题，去看这个扩展怎么做的。
本脚本只做只读静态分析，不修改被拆解对象。
"""
import io
import os
import re
import sys
import json

EXT_DIR = os.path.join(
    os.environ.get("LOCALAPPDATA", ""),
    "Twinkstar", "User Data", "Default", "Extensions",
    "lpnhhgnafkmcomhoabfaiblbeajfncde",
)


def find_manifest_dir():
    if not os.path.isdir(EXT_DIR):
        return None
    for v in sorted(os.listdir(EXT_DIR), reverse=True):
        mv = os.path.join(EXT_DIR, v, "manifest.json")
        if os.path.isfile(mv):
            return os.path.dirname(mv)
    return None


def read(path):
    return io.open(path, encoding="utf-8", errors="replace").read()


def unesc(s):
    try:
        return s.encode("latin-1", "ignore").decode("unicode_escape")
    except Exception:
        return s


def dump_apis(src):
    """接口清单：url + api_name + iden_key 取法"""
    pat = re.compile(
        r'url:"([^"]+)",dp_code:"([^"]+)",api_name:"((?:[^"\\]|\\.)*)"'
        r'(?:,iden_key:function\((\w+)\)\{return ([^}]*)\})?'
    )
    rows = []
    seen = set()
    for m in pat.finditer(src):
        url, dp, name, _v, iden = m.group(1), m.group(2), unesc(m.group(3)), m.group(4), m.group(5)
        if url in seen:
            continue
        seen.add(url)
        rows.append((url, dp, name, (iden or "").strip()[:60]))
    return rows


def main():
    d = find_manifest_dir()
    if not d:
        print("未找到智小抖扩展目录（星愿浏览器 profile 下）")
        return 1
    print("扩展目录:", d)

    inj = os.path.join(d, "inject.6070000c.js")
    if not os.path.isfile(inj):
        # 兜底：找最小的那个含 aweme/v1/web 的 js
        cands = []
        for f in os.listdir(d):
            if not f.endswith(".js"):
                continue
            p = os.path.join(d, f)
            try:
                if os.path.getsize(p) < 200000 and "aweme/v1/web" in read(p):
                    cands.append((os.path.getsize(p), p))
            except Exception:
                pass
        if not cands:
            print("没找到 inject 脚本")
            return 1
        inj = sorted(cands)[0][1]
    print("注入脚本:", os.path.basename(inj), os.path.getsize(inj), "bytes\n")

    src = read(inj)

    print("=" * 78)
    print("一、它拦截的抖音接口清单（页面自己发请求，扩展只读响应）")
    print("=" * 78)
    rows = dump_apis(src)
    for url, dp, name, iden in rows:
        print("%-52s %-22s iden=%s" % (url[:52], name[:22], iden[:52]))
    print("\n接口总数:", len(rows))

    print()
    print("=" * 78)
    print("二、拦截机制（fetch / XHR hook 怎么装的）")
    print("=" * 78)
    for kw in ["window.fetch", "XMLHttpRequest", "addEventListener",
               "Object.defineProperty", "CustomEvent", "dispatchEvent", "postMessage"]:
        print("%-24s 命中 %d 次" % (kw, len(re.findall(re.escape(kw), src))))

    # 打印 fetch hook 上下文
    i = src.find("window.fetch")
    if i > 0:
        print("\n--- window.fetch 附近 ---")
        print(src[max(0, i - 300):i + 700])

    print()
    print("=" * 78)
    print("三、它有没有主动调接口 / 处理签名")
    print("=" * 78)
    for kw in ["a_bogus", "X-Bogus", "msToken", "verifyFp", "s_v_web_id", "webid"]:
        print("%-14s 命中 %d 次" % (kw, len(re.findall(re.escape(kw), src))))

    return 0


if __name__ == "__main__":
    sys.exit(main())
