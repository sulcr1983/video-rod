# 探针：读 service worker 的 G / cacheData 状态
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_client import Cdp, find_ext_id  # noqa: E402


def main():
    cdp = Cdp()
    ext_id, sw = find_ext_id(cdp)
    print("extId:", ext_id, "sw:", (sw or {}).get("url"))
    if not sw:
        print("!! 没有 service worker target")
        return
    sid = cdp.attach(sw["targetId"])
    cdp.send("Runtime.enable", {}, sid)
    time.sleep(0.3)
    probe = """
    (() => {
      const g = (typeof G !== 'undefined') ? G : null;
      let keys = [];
      try { keys = Object.keys(g || {}); } catch (e) {}
      let cd = null;
      try { cd = (typeof cacheData !== 'undefined') ? cacheData : null; } catch (e) {}
      const tabs = cd && cd.tabs ? Object.keys(cd.tabs) : [];
      let counts = [];
      try {
        counts = tabs.map(t => {
          const arr = (cd.tabs[t] || {}).media || [];
          return {tab: t, n: arr.length};
        });
      } catch (e) { counts = [String(e)]; }
      return JSON.stringify({
        gKeys: keys,
        enable: g ? g.enable : null,
        initSync: g ? g.initSyncComplete : null,
        initLocal: g ? g.initLocalComplete : null,
        tabId: g ? g.tabId : null,
        cacheKeys: cd ? Object.keys(cd) : [],
        tabCounts: counts
      });
    })()
    """
    print("state:", cdp.eval(probe, sid))


if __name__ == "__main__":
    main()
