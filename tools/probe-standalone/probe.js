/* ==========================================================
 * standalone 资源库能力探针（file:// 页面侧）
 *
 * 唯一目的：用实测回答「本地 HTML 双击打开后能不能自己干活」，
 * 而不是靠推断。每项检查独立、失败不阻断后续。
 *
 * 结果写进 window.__PROBE__，由 run-probe.py 通过 CDP 读走。
 *
 * 判定口径（按用户第一性原理：方便地看、方便地管）：
 *   · 「看」的标准 = 双击后在页面上交互 0 次就能看到素材
 *   · 「管」的标准 = 整理完刷新页面，改动还在
 *
 * 编号对应 docs/LIBRARY-STANDALONE-PLAN.md 审计要点。
 * ========================================================== */
(function () {
  'use strict';

  var R = {
    startedAt: null,
    finishedAt: null,
    finished: false,
    env: {},
    tests: {},
    manual: {}
  };
  window.__PROBE__ = R;

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 记录工具 ---------------- */

  function put(id, name, pass, value, reason, extra) {
    R.tests[id] = {
      id: id,
      name: name,
      pass: pass,
      value: value,
      reason: reason || '',
      extra: extra || null
    };
    paint();
    return R.tests[id];
  }

  function pending(id, name, reason) {
    R.tests[id] = { id: id, name: name, pass: null, value: 'PENDING-MANUAL', reason: reason || '' };
    paint();
  }

  /** 按变体逐个测，全部通过才算通过 */
  function fromVariants(id, name, results) {
    var fail = results.filter(function (x) { return !x.pass; });
    var pass = fail.length === 0;
    var reason = pass ? '' : (fail.length + '/' + results.length + ' 个变体失败：' +
      fail.map(function (x) { return x.variant; }).join(', '));
    var value = pass ? (results.length + '/' + results.length + ' 变体通过') :
      (results.length - fail.length) + '/' + results.length + ' 变体通过';
    return put(id, name, pass, value, reason, results);
  }

  /** 逐段 encodeURIComponent —— 与项目 VRPath.toFileUrl 同口径 */
  function relUrl(rel) {
    return String(rel).split('/').map(encodeURIComponent).join('/');
  }

  /* ---------------- 媒体测试 ---------------- */

  var VARIANTS = [
    { key: 'ascii', stem: 'sample', label: '纯 ASCII' },
    { key: 'chinese', stem: '中文样本', label: '中文' },
    { key: 'spaces', stem: 'with space', label: '含空格' },
    { key: 'reserved', stem: 'hash#pct%样', label: '含 # 与 %' }
  ];

  function testImage(stem, timeoutMs) {
    return new Promise(function (resolve) {
      var url = relUrl('image/' + stem + '.jpg');
      var img = new Image();
      var done = false;
      var t0 = Date.now();
      function fin(ok, note) {
        if (done) { return; }
        done = true;
        resolve({ pass: ok, url: url, w: img.naturalWidth || 0, h: img.naturalHeight || 0,
          ms: Date.now() - t0, note: note || '' });
      }
      img.onload = function () { fin(img.naturalWidth > 0); };
      img.onerror = function () { fin(false, 'onerror'); };
      setTimeout(function () { fin(false, 'timeout'); }, timeoutMs || 8000);
      img.src = url;
    });
  }

  function testGif(stem, timeoutMs) {
    return new Promise(function (resolve) {
      var url = relUrl('gif/' + stem + '.gif');
      var img = new Image();
      var done = false;
      var t0 = Date.now();
      function fin(ok, note) {
        if (done) { return; }
        done = true;
        resolve({ pass: ok, url: url, w: img.naturalWidth || 0, h: img.naturalHeight || 0,
          ms: Date.now() - t0, note: note || '' });
      }
      img.onload = function () { fin(img.naturalWidth > 0); };
      img.onerror = function () { fin(false, 'onerror'); };
      setTimeout(function () { fin(false, 'timeout'); }, timeoutMs || 8000);
      img.src = url;
    });
  }

  function testVideo(stem, timeoutMs) {
    return new Promise(function (resolve) {
      var url = relUrl('video/' + stem + '.mp4');
      var v = document.createElement('video');
      v.muted = true;
      v.preload = 'metadata';
      var done = false;
      var t0 = Date.now();
      function fin(ok, note, extra) {
        if (done) { return; }
        done = true;
        resolve(Object.assign({
          pass: ok, url: url, readyState: v.readyState, duration: v.duration || 0,
          ms: Date.now() - t0, note: note || ''
        }, extra || {}));
      }
      v.onloadedmetadata = function () {
        if (v.readyState < 1 || !isFinite(v.duration) || v.duration <= 0) {
          return fin(false, 'metadata-invalid');
        }
        var target = Math.min(2, Math.max(0.5, v.duration / 2));
        v.currentTime = target;
        v.onseeked = function () {
          var got = v.currentTime;
          var ok = Math.abs(got - target) < 0.6;
          fin(ok, ok ? '' : 'seek-mismatch', { seek: { target: target, got: got, ok: ok } });
        };
        setTimeout(function () { fin(false, 'seek-timeout'); }, 6000);
      };
      v.onerror = function () {
        var code = v.error ? v.error.code : 0;
        fin(false, 'media-error:' + code);
      };
      setTimeout(function () { fin(false, 'timeout'); }, timeoutMs || 15000);
      v.src = url;
      v.load();
    });
  }

  function testAudio(stem, timeoutMs) {
    return new Promise(function (resolve) {
      var url = relUrl('audio/' + stem + '.wav');
      var a = document.createElement('audio');
      a.preload = 'metadata';
      var done = false;
      var t0 = Date.now();
      function fin(ok, note) {
        if (done) { return; }
        done = true;
        resolve({ pass: ok, url: url, duration: a.duration || 0,
          readyState: a.readyState, ms: Date.now() - t0, note: note || '' });
      }
      a.onloadedmetadata = function () {
        fin(isFinite(a.duration) && a.duration > 0 && a.readyState >= 1);
      };
      a.onerror = function () { fin(false, 'media-error'); };
      setTimeout(function () { fin(false, 'timeout'); }, timeoutMs || 8000);
      a.src = url;
    });
  }

  async function runMedia(id, name, fn, timeoutMs) {
    var out = [];
    for (var i = 0; i < VARIANTS.length; i++) {
      var v = VARIANTS[i];
      var r = await fn(v.stem, timeoutMs);
      r.variant = v.label;
      r.stem = v.stem;
      out.push(r);
    }
    return fromVariants(id, name, out);
  }

  /* ---------------- 数据加载（三种通道） ---------------- */

  /** T5：<script src> 注入 —— 抖珍藏用的就是这条 */
  function testScriptChannel() {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      var s = document.createElement('script');
      s.src = '_library/index.json.js';
      var done = false;
      function fin(ok, reason) {
        if (done) { return; }
        done = true;
        var data = window.__vrProbeIndex;
        var n = (data && Array.isArray(data.files)) ? data.files.length : 0;
        put('T5', '<script src> 加载索引', ok && n > 0,
          ok ? (n + ' 条 / ' + (Date.now() - t0) + 'ms') : 'not loaded',
          reason || '');
        /* 用完即删，避免污染后续测试的内存基线 */
        try { delete window.__vrProbeIndex; } catch (e) { window.__vrProbeIndex = undefined; }
        resolve();
      }
      s.onload = function () { fin(true, ''); };
      s.onerror = function () { fin(false, 'onerror'); };
      setTimeout(function () { fin(false, 'timeout'); }, 8000);
      document.head.appendChild(s);
    });
  }

  /** T6：fetch —— 我推测 file:// 下会被 CORS(opaque origin) 拒绝，必须实测 */
  async function testFetchChannel() {
    var t0 = Date.now();
    try {
      var r = await fetch('_library/index.json', { cache: 'no-store' });
      var txt = await r.text();
      put('T6', 'fetch() 加载索引', r.ok && !!txt,
        'HTTP ' + r.status + ' / ' + txt.length + 'B / ' + (Date.now() - t0) + 'ms');
    } catch (e) {
      put('T6', 'fetch() 加载索引', false, 'threw',
        (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e)));
    }
  }

  /** T7：XMLHttpRequest —— 老通道，行为可能和 fetch 不同 */
  function testXhrChannel() {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      try {
        var x = new XMLHttpRequest();
        x.open('GET', '_library/index.json', true);
        x.onload = function () {
          var ok = (x.status === 200 || x.status === 0) && !!x.responseText;
          put('T7', 'XMLHttpRequest 加载索引', ok,
            'status ' + x.status + ' / ' + (x.responseText ? x.responseText.length : 0) + 'B / ' +
            (Date.now() - t0) + 'ms');
          resolve();
        };
        x.onerror = function () {
          put('T7', 'XMLHttpRequest 加载索引', false, 'onerror', '网络层拒绝');
          resolve();
        };
        x.send();
        setTimeout(function () {
          put('T7', 'XMLHttpRequest 加载索引', false, 'timeout');
          resolve();
        }, 8000);
      } catch (e) {
        put('T7', 'XMLHttpRequest 加载索引', false, 'threw', String(e && e.message));
        resolve();
      }
    });
  }

  /* ---------------- 持久化 ---------------- */

  /** T8：indexedDB —— file:// 是 opaque origin，我判断不可用 */
  function testIdb() {
    return new Promise(function (resolve) {
      var done = false;
      function fin(ok, value, reason) {
        if (done) { return; }
        done = true;
        put('T8', 'IndexedDB 可用（存星标/收藏夹/句柄）', ok, value, reason || '');
        resolve();
      }
      try {
        if (!window.indexedDB) { return fin(false, 'no indexedDB object', '浏览器未暴露 indexedDB'); }
        var req = indexedDB.open('vr-probe-idb', 1);
        req.onupgradeneeded = function () {
          try { req.result.createObjectStore('kv'); } catch (e) { /* 已有 */ }
        };
        req.onsuccess = function () {
          var db = req.result;
          try {
            var tx = db.transaction(['kv'], 'readwrite');
            tx.objectStore('kv').put('hello', 'k');
            tx.oncomplete = function () {
              try { db.close(); } catch (e) { /* 忽略 */ }
              fin(true, 'open+write ok', '');
            };
            tx.onerror = function () { fin(false, 'tx error', String(tx.error && tx.error.name)); };
          } catch (e) {
            fin(false, 'tx threw', String(e && e.name) + ': ' + String(e && e.message));
          }
        };
        req.onerror = function () {
          fin(false, 'open error', String(req.error && req.error.name));
        };
        /* 某些 Chrome 在 file:// 下既不 success 也不 error，直接抛 SecurityError */
        req.onblocked = function () { fin(false, 'blocked'); };
        setTimeout(function () { fin(false, 'timeout'); }, 5000);
      } catch (e) {
        fin(false, 'threw', String(e && e.name) + ': ' + String(e && e.message));
      }
    });
  }

  /** T9：localStorage —— 同样受 opaque origin 限制 */
  function testLocalStorage() {
    try {
      localStorage.setItem('vr-probe-k', 'hello');
      var v = localStorage.getItem('vr-probe-k');
      localStorage.removeItem('vr-probe-k');
      put('T9', 'localStorage 可用（存视图偏好）', v === 'hello', 'readback ok');
    } catch (e) {
      put('T9', 'localStorage 可用（存视图偏好）', false, 'threw',
        String(e && e.name) + ': ' + String(e && e.message));
    }
  }

  /* ---------------- 压缩 / 大文件 / Worker ---------------- */

  /** T15：canvas 导出 —— 缩略图功能的前提（thumbs.js 用 drawImage + toBlob）
   *
   * 为什么这一项最容易被漏掉：
   *   T1–T4 只证明 <img> 能「显示」素材，但 thumbs.js 的路径是
   *   drawImage → canvas.toBlob('image/webp') → 存 IDB。
   *   若 file:// 图片会污染画布，toBlob 会抛 SecurityError，
   *   结果是「能看原图，但缩略图全部生成失败」——列表页直接变成灰块。
   */
  async function testCanvasExport() {
    try {
      var url = relUrl('image/sample.jpg');
      var img = await new Promise(function (resolve, reject) {
        var i = new Image();
        i.onload = function () { resolve(i); };
        i.onerror = function () { reject(new Error('img load failed')); };
        i.src = url;
      });
      var c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 64, 64);

      /* ① 读像素：污染会在这里抛 SecurityError */
      var pixelErr = '';
      try {
        var d = ctx.getImageData(0, 0, 1, 1);
        if (!d || !d.data) { pixelErr = 'no pixel data'; }
      } catch (e) {
        pixelErr = String(e && e.name) + ': ' + String(e && e.message);
      }

      /* ② toBlob：thumbs.js 真正走的路径 */
      var blob = await new Promise(function (resolve) {
        try {
          c.toBlob(function (b) { resolve(b); }, 'image/webp', 0.8);
        } catch (e) {
          resolve(null);
          pixelErr = pixelErr || (String(e && e.name) + ' (toBlob threw)');
        }
      });

      var ok = !pixelErr && !!blob && blob.size > 0;
      put('T15', 'canvas 导出缩略图（thumbs.js 的前提）', ok,
        ok ? ('webp ' + blob.size + 'B') : (blob ? (blob.size + 'B') : 'null'),
        pixelErr || (blob ? '' : 'toBlob 返回 null'));
    } catch (e) {
      put('T15', 'canvas 导出缩略图（thumbs.js 的前提）', false, 'threw',
        String(e && e.name) + ': ' + String(e && e.message));
    }
  }

  /** T16：相对路径下的 <video> 逐帧取图 —— 视频缩略图靠它 */
  async function testVideoFrame() {
    try {
      var url = relUrl('video/sample.mp4');
      var v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      var meta = await new Promise(function (resolve) {
        v.onloadedmetadata = function () { resolve(true); };
        v.onerror = function () { resolve(false); };
        setTimeout(function () { resolve(false); }, 12000);
        v.src = url;
        v.load();
      });
      if (!meta) { return put('T16', 'video 逐帧取图（视频缩略图）', false, 'metadata failed'); }

      await new Promise(function (resolve) {
        v.currentTime = Math.min(1, (v.duration || 2) / 2);
        v.onseeked = function () { resolve(); };
        setTimeout(resolve, 8000);
      });

      var c = document.createElement('canvas');
      c.width = 64; c.height = 36;
      var ctx = c.getContext('2d');
      var drawErr = '';
      try { ctx.drawImage(v, 0, 0, 64, 36); } catch (e) {
        drawErr = String(e && e.name) + ': ' + String(e && e.message);
      }
      var blob = await new Promise(function (resolve) {
        try { c.toBlob(function (b) { resolve(b); }, 'image/webp', 0.8); }
        catch (e) { resolve(null); }
      });
      var ok = !drawErr && !!blob && blob.size > 0;
      put('T16', 'video 逐帧取图（视频缩略图）', ok,
        ok ? ('webp ' + blob.size + 'B') : (blob ? (blob.size + 'B') : 'null'), drawErr);
    } catch (e) {
      put('T16', 'video 逐帧取图（视频缩略图）', false, 'threw',
        String(e && e.name) + ': ' + String(e && e.message));
    }
  }

  /** T17：object URL 能否绕过画布污染
   *
   * 背景：T15/T16 证明 file:// 的 img/video 会污染 canvas（SecurityError）。
   * 但 VRFile.resolve() 在「没有 absPath」时走的是 **目录句柄读文件 → object URL**，
   * 而不是 file:// URL。object URL 属于同源 blob，理论上可以安全导出。
   * 这项决定「缩略图到底还有没有救」。
   */
  async function testObjectUrlCanvas() {
    try {
      if (typeof window.showDirectoryPicker !== 'function') {
        return put('T17', 'object URL 导出缩略图（绕开画布污染）', false, 'no FSA', '无法选目录');
      }
      var dir = await window.showDirectoryPicker({ mode: 'read' });
      var sub;
      try { sub = await dir.getDirectoryHandle('image'); } catch (e) {
        return put('T17', 'object URL 导出缩略图（绕开画布污染）', false, 'no image dir',
          '请选择包含 image/ 子目录的那个探针目录');
      }
      var fh = await sub.getFileHandle('sample.jpg');
      var file = await fh.getFile();
      var objUrl = URL.createObjectURL(file);

      var img = await new Promise(function (resolve, reject) {
        var i = new Image();
        i.onload = function () { resolve(i); };
        i.onerror = function () { reject(new Error('object url img failed')); };
        i.src = objUrl;
      });

      var c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 64, 64);

      var pixelErr = '';
      try { ctx.getImageData(0, 0, 1, 1); }
      catch (e) { pixelErr = String(e && e.name) + ': ' + String(e && e.message); }

      var blob = await new Promise(function (resolve) {
        try { c.toBlob(function (b) { resolve(b); }, 'image/webp', 0.8); }
        catch (e) { resolve(null); }
      });
      try { URL.revokeObjectURL(objUrl); } catch (e) { /* 忽略 */ }

      var ok = !pixelErr && !!blob && blob.size > 0;
      put('T17', 'object URL 导出缩略图（绕开画布污染）', ok,
        ok ? ('webp ' + blob.size + 'B') : 'null', pixelErr);
    } catch (e) {
      put('T17', 'object URL 导出缩略图（绕开画布污染）', false, 'threw',
        String(e && e.name) + ': ' + String(e && e.message));
    }
  }

  /** T18：file:// 下能否枚举目录（决定快照用固定名还是日期名）
   *
   * 若不能枚举，就必须用固定文件名 `latest.json.js`；
   * 若能枚举，日期命名也可以，还能顺带做「保留 7 份」。
   * 这一项必须实测——现有 indexer.js 依赖 dir.entries()，
   * 但那是通过 FSA 句柄拿到的目录对象，和「纯 file:// 页面」不是一回事。
   */
  async function testDirEnum() {
    try {
      if (typeof window.showDirectoryPicker !== 'function') {
        return put('T18', '目录枚举能力（决定快照命名）', false, 'no FSA');
      }
      var dir = await window.showDirectoryPicker({ mode: 'read' });
      var names = [];
      for await (var e of dir.entries()) { names.push(e[0]); }
      var hasLib = names.indexOf('_library') >= 0;
      put('T18', '目录枚举能力（决定快照命名）', hasLib,
        '枚举到 ' + names.length + ' 项' + (hasLib ? '，含 _library' : '，但没看到 _library'),
        hasLib ? '' : '请选包含 _library/ 的探针根目录');
    } catch (e) {
      put('T18', '目录枚举能力（决定快照命名）', false, 'threw',
        String(e && e.name) + ': ' + String(e && e.message));
    }
  }

  /** T17a：blob URL 能否安全导出缩略图（全自动，不需要目录句柄）
   *
   * 这是 T17 的核心子问题，而且不必等手动授权就能测：
   *   T15 已证明 `file://` URL 的图片会污染 canvas（SecurityError）。
   *   thumbs.js 的另一条路径是 `VRFile.resolve()` → 读文件 → **object URL**。
   *   object URL 属于本页同源的 blob:，理论上不受跨源限制。
   *
   * 验证方法：用 canvas 自己生成一个 PNG blob → createObjectURL →
   * 当 img 加载 → 再画进另一个 canvas → getImageData。
   * 若这条能通，就证明「经 blob 中转」是可行的绕行方案，
   * 本地页只要不直接用 file:// URL 画 canvas，就能生成缩略图。
   */
  async function testBlobUrlCanvas() {
    try {
      /* ① 先用一个不污染的 canvas 造出 PNG 字节 */
      var c1 = document.createElement('canvas');
      c1.width = 32; c1.height = 32;
      var x1 = c1.getContext('2d');
      x1.fillStyle = '#C9A227';
      x1.fillRect(0, 0, 32, 32);
      var png = await new Promise(function (resolve) {
        try { c1.toBlob(function (b) { resolve(b); }, 'image/png'); }
        catch (e) { resolve(null); }
      });
      if (!png) { return put('T17a', 'blob URL 导出缩略图（全自动）', false, 'toBlob null'); }

      /* ② 经 object URL 加载回来 —— 这一步和 VRFile.resolve() 同构 */
      var url = URL.createObjectURL(png);
      var img = await new Promise(function (resolve, reject) {
        var i = new Image();
        i.onload = function () { resolve(i); };
        i.onerror = function () { reject(new Error('blob url img failed')); };
        i.src = url;
      });

      /* ③ 再画一次，看会不会污染 */
      var c2 = document.createElement('canvas');
      c2.width = 32; c2.height = 32;
      var x2 = c2.getContext('2d');
      x2.drawImage(img, 0, 0, 32, 32);

      var pixelErr = '';
      try { x2.getImageData(0, 0, 1, 1); }
      catch (e) { pixelErr = String(e && e.name) + ': ' + String(e && e.message); }

      var webp = await new Promise(function (resolve) {
        try { c2.toBlob(function (b) { resolve(b); }, 'image/webp', 0.8); }
        catch (e) { resolve(null); }
      });
      try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }

      var ok = !pixelErr && !!webp && webp.size > 0;
      put('T17a', 'blob URL 导出缩略图（全自动）', ok,
        ok ? ('webp ' + webp.size + 'B') : 'null', pixelErr);
    } catch (e) {
      put('T17a', 'blob URL 导出缩略图（全自动）', false, 'threw',
        String(e && e.name) + ': ' + String(e && e.message));
    }
  }

  /** T12：DecompressionStream —— 抖珍藏解 4.3MB 分片靠它 */
  async function testDecompress() {
    try {
      if (typeof DecompressionStream === 'undefined') {
        return put('T12', 'DecompressionStream(gzip) 可用', false, 'undefined', '浏览器不支持');
      }
      var src = new TextEncoder().encode('video-rod probe '.repeat(500));
      var cs = new CompressionStream('gzip');
      var cw = cs.writable.getWriter();
      cw.write(src); cw.close();
      var gz = new Uint8Array(await new Response(cs.readable).arrayBuffer());

      var ds = new DecompressionStream('gzip');
      var dw = ds.writable.getWriter();
      dw.write(gz); dw.close();
      var back = new Uint8Array(await new Response(ds.readable).arrayBuffer());
      var txt = new TextDecoder().decode(back);
      var ok = txt === 'video-rod probe '.repeat(500);
      put('T12', 'DecompressionStream(gzip) 可用', ok,
        ok ? ('压缩 ' + gz.length + 'B → 还原 ' + back.length + 'B') : 'mismatch');
    } catch (e) {
      put('T12', 'DecompressionStream(gzip) 可用', false, 'threw',
        String(e && e.name) + ': ' + String(e && e.message));
    }
  }

  /** T13：5 万条索引的真实加载与解析成本 —— 验证「40MB 是否真需要压缩」 */
  function testBigIndex() {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      var s = document.createElement('script');
      s.src = '_library/index-big.json.js';
      var done = false;
      function fin(ok, reason) {
        if (done) { return; }
        done = true;
        var loadMs = Date.now() - t0;
        var data = window.__vrProbeBigIndex;
        var n = (data && Array.isArray(data.files)) ? data.files.length : 0;
        var t1 = Date.now();
        var jsonSize = 0;
        try { jsonSize = JSON.stringify(data).length; } catch (e) { /* 忽略 */ }
        var serMs = Date.now() - t1;
        var mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0;
        put('T13', '5 万条索引：加载 + 解析耗时', ok && n > 0,
          ok ? (n + ' 条 / 加载+解析 ' + loadMs + 'ms / 再序列化 ' + serMs + 'ms / JSON ' +
            Math.round(jsonSize / 1048576) + 'MB / 堆 ' + mem + 'MB') : 'not loaded',
          reason || '',
          { count: n, loadMs: loadMs, serializeMs: serMs, jsonMB: Math.round(jsonSize / 1048576), heapMB: mem });
        try { delete window.__vrProbeBigIndex; } catch (e) { window.__vrProbeBigIndex = undefined; }
        resolve();
      }
      s.onload = function () { fin(true, ''); };
      s.onerror = function () { fin(false, 'onerror'); };
      setTimeout(function () { fin(false, 'timeout'); }, 20000);
      document.head.appendChild(s);
    });
  }

  /** T14（补充）：Worker —— 文档 §3.4 断言 file:// 不能开 Worker */
  function testWorker() {
    return new Promise(function (resolve) {
      var done = false;
      function fin(ok, reason) {
        if (done) { return; }
        done = true;
        put('T14', 'Worker 可用（补充项，影响解压是否阻塞 UI）', ok, ok ? 'constructed' : 'failed', reason || '');
        resolve();
      }
      try {
        var code = 'self.onmessage=function(e){self.postMessage(e.data*2)}';
        var url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        var w = new Worker(url);
        w.onmessage = function (e) { fin(e.data === 42, ''); w.terminate(); };
        w.onerror = function (e) { fin(false, 'onerror: ' + (e.message || 'unknown')); };
        w.postMessage(21);
        setTimeout(function () { fin(false, 'timeout'); }, 5000);
      } catch (e) {
        fin(false, String(e && e.name) + ': ' + String(e && e.message));
      }
    });
  }

  /* ---------------- 手动项：T10 / T11 ---------------- */

  async function manualPick() {
    var st = $('manualMsg');
    try {
      if (typeof window.showDirectoryPicker !== 'function') {
        R.manual.T10 = { pass: false, reason: 'showDirectoryPicker 不存在' };
        st.textContent = 'T10 失败：这个浏览器没有 showDirectoryPicker';
        paint();
        return;
      }
      var handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      R.manual.T10 = { pass: true, value: handle.name, reason: '' };

      /* T11：句柄能不能存下来（跨会话复用）。存不下来就必须每次重新授权。 */
      var perm = 'unknown';
      try {
        if (typeof handle.queryPermission === 'function') {
          perm = await handle.queryPermission({ mode: 'readwrite' });
        }
      } catch (e) { perm = 'query-threw'; }

      var persisted = await new Promise(function (resolve) {
        try {
          var req = indexedDB.open('vr-probe-handle', 1);
          req.onupgradeneeded = function () { try { req.result.createObjectStore('kv'); } catch (e) {} };
          req.onsuccess = function () {
            try {
              var db = req.result;
              var tx = db.transaction(['kv'], 'readwrite');
              tx.objectStore('kv').put(handle, 'root');
              tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(true); };
              tx.onerror = function () { resolve(false); };
            } catch (e) { resolve(false); }
          };
          req.onerror = function () { resolve(false); };
          setTimeout(function () { resolve(false); }, 4000);
        } catch (e) { resolve(false); }
      });

      R.manual.T11 = {
        pass: persisted,
        value: persisted ? '句柄已存入 IndexedDB' : '句柄存不进去',
        reason: persisted ? ('权限=' + perm) : ('IndexedDB 不可用（权限=' + perm + '），' +
          '意味着每次打开都要重新授权一次')
      };
      st.textContent = persisted
        ? 'T10 通过（' + handle.name + '），T11 通过：句柄已保存'
        : 'T10 通过（' + handle.name + '），T11 失败：句柄存不住，下次还要重新授权';
      paint();
    } catch (e) {
      R.manual.T10 = { pass: false, reason: String(e && e.name) + ': ' + String(e && e.message) };
      st.textContent = 'T10 失败：' + (e && e.message ? e.message : String(e));
      paint();
    }
  }

  /** T11 的独立验证：光看写入成功不够，要真读回来 */
  async function verifyHandleReadback() {
    var ok = await new Promise(function (resolve) {
      try {
        var req = indexedDB.open('vr-probe-handle', 1);
        req.onsuccess = function () {
          try {
            var db = req.result;
            var tx = db.transaction(['kv'], 'readonly');
            var g = tx.objectStore('kv').get('root');
            g.onsuccess = function () { resolve(!!g.result); };
            g.onerror = function () { resolve(false); };
          } catch (e) { resolve(false); }
        };
        req.onerror = function () { resolve(false); };
        setTimeout(function () { resolve(false); }, 3000);
      } catch (e) { resolve(false); }
    });
    R.manual.T11Readback = { pass: ok };
    paint();
  }

  /* ---------------- 渲染 ---------------- */

  function paint() {
    var tb = $('tbody');
    if (!tb) { return; }
    var rows = [];
    Object.keys(R.tests).forEach(function (k) {
      var t = R.tests[k];
      rows.push(rowHtml(k, t.name, t.pass, t.value, t.reason));
    });
    Object.keys(R.manual).forEach(function (k) {
      var t = R.manual[k];
      rows.push(rowHtml(k, '手动：' + k, t.pass, t.value || '', t.reason || ''));
    });
    tb.innerHTML = rows.join('');

    var pass = 0, fail = 0, pend = 0;
    Object.keys(R.tests).forEach(function (k) {
      var p = R.tests[k].pass;
      if (p === true) { pass++; } else if (p === false) { fail++; } else { pend++; }
    });
    $('summary').textContent = '通过 ' + pass + ' · 失败 ' + fail + ' · 待手动 ' + pend;
    var out = $('json');
    if (out) { out.textContent = JSON.stringify(R, null, 2); }
  }

  function rowHtml(id, name, pass, value, reason) {
    var cls = pass === true ? 'ok' : (pass === false ? 'bad' : 'pend');
    var tag = pass === true ? '通过' : (pass === false ? '失败' : '待手动');
    return '<tr class="' + cls + '"><td class="id">' + id + '</td><td>' + esc(name) + '</td>' +
      '<td class="tag">' + tag + '</td><td class="val">' + esc(String(value || '')) + '</td>' +
      '<td class="why">' + esc(String(reason || '')) + '</td></tr>';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------------- 主流程 ---------------- */

  async function run() {
    R.startedAt = new Date().toISOString();
    R.env = {
      ua: navigator.userAgent,
      href: location.href,
      protocol: location.protocol,
      origin: String(location.origin),
      isSecureContext: self.isSecureContext,
      hasShowDirectoryPicker: typeof window.showDirectoryPicker === 'function',
      hasIndexedDB: !!window.indexedDB,
      hasLocalStorage: (function () { try { return !!window.localStorage; } catch (e) { return false; } })(),
      hasDecompressionStream: typeof DecompressionStream !== 'undefined',
      hasWorker: typeof Worker !== 'undefined'
    };
    paint();

    await runMedia('T1', '图片：相对路径直读（4 种文件名）', testImage, 8000);
    await runMedia('T2', '动图 GIF：相对路径直读（4 种文件名）', testGif, 8000);
    await runMedia('T3', '视频 MP4：相对路径直读 + seek（4 种文件名）', testVideo, 15000);
    await runMedia('T4', '音频 WAV：相对路径直读（4 种文件名）', testAudio, 8000);

    await testScriptChannel();
    await testFetchChannel();
    await testXhrChannel();

    await testIdb();
    testLocalStorage();

    await testCanvasExport();
    await testVideoFrame();
    await testBlobUrlCanvas();
    await testDecompress();
    await testBigIndex();
    await testWorker();

    pending('T10', 'showDirectoryPicker 在 file:// 下能否弹出', '需要真人点一次「选择文件夹」');
    pending('T11', '目录句柄能否跨会话保存', '依赖 T10 与 IndexedDB 结果');

    R.finishedAt = new Date().toISOString();
    R.finished = true;
    paint();
  }

  window.__runProbe = run;
  window.__manualPick = manualPick;
  document.addEventListener('DOMContentLoaded', function () {
    var b = $('run');
    if (b) { b.onclick = run; }
    var m = $('manual');
    if (m) {
      m.onclick = function () {
        manualPick().then(verifyHandleReadback).then(testObjectUrlCanvas).then(testDirEnum);
      };
    }
    paint();
  });
})();