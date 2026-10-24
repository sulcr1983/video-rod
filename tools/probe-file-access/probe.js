/* P0 探针：只做三件事，结果同时写 window.__PROBE__（供 CDP 读取）与页面。 */
(function () {
  const R = { img: null, video: null, downloads: null, env: {} };
  window.__PROBE__ = R;

  const $ = id => document.getElementById(id);
  const pill = (id, text, cls) => { const el = $(id); el.textContent = text; el.className = "pill " + (cls || ""); };
  const say = (id, text) => { $(id).textContent = text; };

  function isAllowedFileAccess(cb) {
    try {
      chrome.extension.isAllowedFileSchemeAccess(a => cb(!!a));
    } catch (e) {
      cb(false);
    }
  }

  function env() {
    R.env = {
      ua: navigator.userAgent,
      isSecureContext: self.isSecureContext,
      extId: chrome.runtime.id,
      version: chrome.runtime.getManifest().version
    };
    isAllowedFileAccess(allowed => {
      R.env.fileSchemeAccess = allowed;
      R.env.lastError = chrome.runtime.lastError ? String(chrome.runtime.lastError.message) : null;
      const ok = allowed ? "已允许访问文件网址" : "未允许访问文件网址（需在 chrome://extensions 打开开关）";
      $("env").textContent =
        `扩展 ID：${R.env.extId} ｜ Chrome：${R.env.ua.match(/Chrome\/[\d.]+/)?.[0] || "?"} ｜ 文件访问：${ok}`;
      if (!allowed) {
        const w = document.createElement("div");
        w.className = "warn";
        w.textContent = "⚠️ 未开启『允许访问文件网址』，①② 必然失败。请到 chrome://extensions → 本扩展 → 详情 → 打开该开关后重试。";
        $("env").after(w);
      }
    });
  }

  function fileUrl(dir, name) {
    const base = String(dir || "").replace(/\\/g, "/").replace(/\/+$/, "");
    // 逐段 encodeURI：路径里若有空格/中文/#/% 也能正确转义
    const full = base + "/" + name;
    return "file:///" + full.split("/").map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join("/");
  }
  R.fileUrl = fileUrl;

  function testImage(dir) {
    return new Promise(resolve => {
      const url = fileUrl(dir, "probe.jpg");
      const img = $("img");
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        R.img = { ok, url, naturalWidth: img.naturalWidth || 0, naturalHeight: img.naturalHeight || 0 };
        pill("p1", ok ? "通过" : "失败", ok ? "ok" : "fail");
        say("r1", `url: ${url}\nnaturalWidth=${R.img.naturalWidth} naturalHeight=${R.img.naturalHeight}`);
        resolve();
      };
      img.onload = () => finish(img.naturalWidth > 0);
      img.onerror = () => finish(false);
      img.src = url;
      setTimeout(() => finish(false), 8000);
    });
  }

  function testVideo(dir) {
    return new Promise(resolve => {
      const url = fileUrl(dir, "probe.mp4");
      const v = $("vid");
      let done = false;
      const finish = (ok, extra) => {
        if (done) return;
        done = true;
        R.video = Object.assign({ ok, url, readyState: v.readyState, duration: v.duration, currentTime: v.currentTime }, extra || {});
        pill("p2", ok ? "通过" : "失败", ok ? "ok" : "fail");
        say("r2", `url: ${url}\nreadyState=${v.readyState} duration=${v.duration}\nseek: ${JSON.stringify(R.video.seek || null)}`);
        resolve();
      };
      v.onerror = () => finish(false);
      v.onloadedmetadata = () => {
        if (v.readyState < 1 || !isFinite(v.duration) || v.duration <= 0) return finish(false);
        const target = Math.min(2, Math.max(0.5, v.duration / 2));
        v.currentTime = target;
        v.onseeked = () => {
          const seekOk = Math.abs(v.currentTime - target) < 0.6;
          finish(seekOk, { seek: { target, got: v.currentTime, ok: seekOk } });
        };
        setTimeout(() => finish(false, { seek: { target, got: v.currentTime, ok: false } }), 6000);
      };
      v.src = url;
      v.load();
      setTimeout(() => finish(false), 12000);
    });
  }

  function testDownloads() {
    return new Promise(resolve => {
      chrome.downloads.search({ limit: 5, orderBy: ["-startTime"] }, list => {
        const items = (list || []).map(d => ({
          id: d.id, filename: d.filename, url: d.url, state: d.state, exists: d.exists
        }));
        const abs = items.filter(d => /^[A-Za-z]:[\\/]/.test(d.filename) || /^\//.test(d.filename));
        const ok = items.length > 0 && abs.length === items.length;
        R.downloads = { ok, count: items.length, absoluteCount: abs.length, items, lastError: null };
        pill("p3", ok ? "通过" : (items.length ? "失败" : "无记录"), ok ? "ok" : (items.length ? "fail" : ""));
        say("r3", items.length
          ? items.map(d => `${d.id} | ${d.filename} | exists=${d.exists}`).join("\n")
          : "无下载记录：先点『先造一条下载记录』");
        resolve();
      });
    });
  }

  function makeDownload(dir) {
    // 用 data: URL 造一条下载记录，落到 Chrome 默认下载目录；探针结束后可手动删除
    const txt = "video-rod probe " + new Date().toISOString();
    const url = "data:text/plain;charset=utf-8," + encodeURIComponent(txt);
    chrome.downloads.download({ url, filename: "vr-probe-record.txt", conflictAction: "overwrite" }, id => {
      R.downloads = Object.assign(R.downloads || {}, { seededId: id, seedError: chrome.runtime.lastError?.message || null });
      setTimeout(testDownloads, 800);
    });
  }

  async function run() {
    const dir = $("dir").value.trim();
    R.startedAt = new Date().toISOString();
    $("out").textContent = "探测中…";
    pill("p1", "跑…", "run"); pill("p2", "跑…", "run"); pill("p3", "跑…", "run");
    await testImage(dir);
    await testVideo(dir);
    await testDownloads();
    R.finishedAt = new Date().toISOString();
    const pass = !!(R.img && R.img.ok) && !!(R.video && R.video.ok) && !!(R.downloads && R.downloads.ok);
    R.verdict = pass ? "PASS" : "FAIL";
    $("out").textContent = JSON.stringify({
      verdict: R.verdict,
      img: R.img, video: R.video, downloads: R.downloads,
      env: R.env
    }, null, 2);
  }

  $("run").onclick = run;
  $("dl").onclick = () => makeDownload($("dir").value.trim());
  env();
  window.__runProbe = run;
})();
