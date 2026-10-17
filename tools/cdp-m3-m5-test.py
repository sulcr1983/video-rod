# video-rod M3（B站分P横幅）/ M5（图片批量）验收
# 用法：VR_CDP=http://127.0.0.1:9226 python tools/cdp-m3-m5-test.py [out-dir]
import base64
import json
import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id, open_popup  # noqa: E402

BILI_PAGE = "http://127.0.0.1:18080/bili-fake.html"
IMG_PAGE = "http://127.0.0.1:18080/images.html"


def shot(cdp, psid, path, h=600):
    time.sleep(1.2)
    s = cdp.send("Page.captureScreenshot", {"format": "png"}, psid)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(base64.b64decode(s["data"]))


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "deliverables/assets"
    cdp = Cdp()
    report = {"errors": []}

    # ---------- M3：B站分P ----------
    psid, tab_id = open_popup(cdp, BILI_PAGE)
    report["bili"] = {"tabId": tab_id}
    report["bili"]["dom"] = {
        "banner": "!!document.getElementById('vrBiliBanner')",
        "bannerTxt": "(document.querySelector('#vrBiliBanner .vr-banner-txt')||{}).textContent",
        "rowTotal": "document.querySelectorAll('#vrBiliBanner .vr-partrow').length",
        "bodyHidden": "(document.querySelector('#vrBiliBanner .vr-banner-body')||{}).classList.contains('hide')",
        "cardCount": "document.querySelectorAll('#mediaList .panel').length",
        "ytBanner": "!!document.getElementById('vrYtBanner')",
    }
    for k, e in report["bili"]["dom"].items():
        report["bili"]["dom"][k] = cdp.eval(e, psid)

    # 展开 / 收起
    report["bili"]["expand"] = cdp.eval("""
      (() => {
        const t = document.querySelector('#vrBiliBanner .vr-banner-toggle');
        t.click();
        const open = !document.querySelector('#vrBiliBanner .vr-banner-body').classList.contains('hide');
        const rows = document.querySelectorAll('#vrBiliBanner .vr-partrow').length;
        const txt = t.textContent;
        t.click();
        const closed = document.querySelector('#vrBiliBanner .vr-banner-body').classList.contains('hide');
        return {open: open, rows: rows, txt: txt, closed: closed};
      })()
    """, psid)
    shot(cdp, psid, os.path.join(out_dir, "m3-bili-banner.png"))
    report["errors"] += cdp.errors()

    # ---------- M5：图片批量 ----------
    psid2, tab_id2 = open_popup(cdp, IMG_PAGE)
    report["img"] = {"tabId": tab_id2}
    report["img"]["scan"] = cdp.eval("""
      (() => {
        document.getElementById('vrScanImages').click();
        return new Promise(r => setTimeout(() => {
          const modal = document.getElementById('vrImgModal');
          r({
            modalOn: modal ? modal.classList.contains('on') : false,
            cnt: (document.getElementById('vrImgCount')||{}).textContent,
            rows: document.querySelectorAll('#vrImgList .vrimg-row').length,
            checked: document.querySelectorAll('#vrImgList .vrimg-chk:checked').length,
            metas: [...document.querySelectorAll('#vrImgList .vrimg-meta')].map(e=>e.textContent)
          });
        }, 1500));
      })()
    """, psid2)
    report["img"]["allBtn"] = cdp.eval("""
      (() => { document.getElementById('vrImgAll').click();
        return {checked: document.querySelectorAll('#vrImgList .vrimg-chk:checked').length,
                label: document.getElementById('vrImgAll').textContent}; })()
    """, psid2)
    shot(cdp, psid2, os.path.join(out_dir, "m5-img-modal.png"), h=700)

    # ---------- M5：图片真落盘 ----------
    if os.environ.get("VR_DL"):
        dl_root = os.environ.get("VR_DL_ROOT", r"E:/personal/Downloads")
        tdir = os.path.join(dl_root, "video-rod")
        before_i = set()
        if os.path.isdir(tdir):
            for dp, _d, fs in os.walk(tdir):
                for f in fs:
                    if not f.endswith(".crdownload"):
                        before_i.add(os.path.relpath(os.path.join(dp, f), tdir).replace("\\", "/"))
        cdp.eval("""
          (() => {
            document.querySelectorAll('#vrImgList .vrimg-chk').forEach(b => b.checked = true);
            document.getElementById('vrImgDown').click();
            return 'clicked';
          })()
        """, psid2)
        deadline = time.time() + 20
        while time.time() < deadline:
            now_i = set()
            if os.path.isdir(tdir):
                for dp, _d, fs in os.walk(tdir):
                    for f in fs:
                        if not f.endswith(".crdownload"):
                            now_i.add(os.path.relpath(os.path.join(dp, f), tdir).replace("\\", "/"))
            if len(now_i - before_i) >= 3:
                break
            time.sleep(0.4)
        new_i = sorted(now_i - before_i)
        sizes = {}
        for rel in new_i:
            try:
                sizes[rel] = os.path.getsize(os.path.join(tdir, rel.replace("/", os.sep)))
            except OSError:
                pass
        report["imgDownload"] = {"newFiles": sizes, "toast": cdp.eval(
            "(document.getElementById('TipsFixed')||{}).textContent", psid2)}
        # 清理
        for rel in new_i:
            try:
                os.remove(os.path.join(tdir, rel.replace("/", os.sep)))
            except OSError:
                pass
        report["imgDownload"]["cleanedUp"] = new_i

    report["errors"] += cdp.errors()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # 崩了也留现场：把 traceback 打到 stderr，退出码非 0
        traceback.print_exc()
        sys.stdout.flush()
        sys.exit(1)
