/* ==========================================================
 * 离线媒体库导出器（纯函数，可 Node 单测）
 *
 * 目标：把「索引快照」变成「一个能双击打开的只读 HTML」，不依赖扩展。
 *
 * 设计约束（2026-11-18）：
 *   · 索引必须**内联**进 HTML —— file:// 下 fetch('index.json') 会被 CORS 拦
 *   · 缩略图用**相对路径** —— 整个目录拷走也能用
 *   · 只读 —— 浏览器外无 showDirectoryPicker，删除/改名/移动做不到
 *
 * 不碰 chrome.* / DOM：只做「快照对象 → HTML 字符串」的字符串拼装。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VROfflineExport = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    /* root 在 Node require 时可能不是全局对象；显式解析一次，
     * 保证 VRRootGuard 能被找到（2026-11-18 单测抓到 root is not defined）。 */
    if (!root || (typeof root.VRRootGuard === 'undefined' && typeof globalThis !== 'undefined')) {
        root = (typeof globalThis !== 'undefined') ? globalThis : root;
    }

    /** HTML 转义（内联 JSON 与文本都要） */
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * 把快照裁剪成查看器需要的字段（**去掉内部字段，减小体积**）。
     *
     * ⚠️ 2026-11-18 架构调整（抖珍藏式）：
     *   不再内联 base64 缩略图，改为**输出相对路径**，由离线页直接读同目录文件。
     *   实测确认（Edge 157）：file:// 下 <script src> 与 fetch 同目录文件都可用。
     *   好处：HTML 从 720KB 降到 ~90KB；素材更新只需重写数据文件；素材本体可直接播放。
     *
     * @param {object} snapshot  indexer 产出的 schema:2 快照
     * @param {object} [opt]     {rootRel: 素材相对离线页的路径前缀}
     *                           默认 '../../' —— 离线包放在 <库根>/_library/ 下
     * @returns {object} 精简后的数据集
     */
    function slim(snapshot, opt) {
        var s = snapshot || {};
        var o = opt || {};
        /* 素材相对离线页的位置前缀：离线包放在 <库根>/_library/ 下时是 ../../ */
        var rootRel = String(o.rootRel == null ? '../../' : o.rootRel);
        if (rootRel && rootRel.slice(-1) !== '/') { rootRel += '/'; }

        var files = Array.isArray(s.files) ? s.files : [];
        /* ⚠️ 2026-11-18：离线页只收「活跃条目」。
         * 回收站（trashed）与越界（outOfRoot）不该出现在离线库里 ——
         * 否则电脑坏了拿移动硬盘看时，会把已删除的素材当成还在。
         * 判据与 indexer.snapshotPayload 一致（有 VRRootGuard 就用它，否则看 state）。 */
        var active = files.filter(function (f) {
            if (!f || !f.relPath) { return false; }
            var G = root.VRRootGuard;
            if (G && typeof G.isActiveEntry === 'function') {
                try { return G.isActiveEntry(f); } catch (e) { /* 落到下一条判据 */ }
            }
            return f.state !== 'trashed' && f.state !== 'outOfRoot';
        });

        var out = active.map(function (f) {
            var rel = String(f.relPath || '');
            /* 素材可播放路径：库根相对路径（剥掉首段 subdir 前缀由调用方决定） */
            var mediaPath = stripSubdir(rel, s.subdir || '');
            var item = {
                p: rel,                                      // 库内相对路径（身份）
                mp: rootRel + mediaPath,                     // 素材可播放路径（相对离线页）
                n: String(f.displayName || f.fileName || ''), // 显示名
                s: Number(f.size) || 0,                      // 字节
                t: String(f.type || ''),                     // image/video/audio
                pl: String(f.platform || ''),                // 平台键
                a: String(f.creatorFull || ''),              // 作者 "昵称(@id)"
                ti: String(f.title || ''),                   // 标题
                m: Number(f.mtime) || 0,                     // 修改时间
                st: f.starred ? 1 : 0,                       // 星标
                tg: Array.isArray(f.tags) ? f.tags.slice(0, 20) : []
            };
            /* 缩略图：相对离线页的路径
             * 离线页在 <库根>/_library/_offline/，缩略图在 <库根>/_library/thumbs/
             * → 相对路径是 ../thumbs/<key>.webp（2026-11-18 实测修正） */
            if (f.thumbFile) {
                item.th = String(f.thumbFile);
                item.tp = String(o.thumbRel == null ? '../thumbs/' : o.thumbRel) +
                    String(f.thumbFile).replace(/\.(webp|jpg|jpeg|png|gif)$/i, '') + '.webp';
            } else if (f.thumbSrcUri) {
                item.tp = String(f.thumbSrcUri);
            }
            if (f.width) { item.w = Number(f.width); }
            if (f.height) { item.h = Number(f.height); }
            if (f.duration != null) { item.d = Number(f.duration); }
            if (f.pageUrl) { item.pu = String(f.pageUrl); }
            return item;
        });
        return {
            schema: 3,                       // ← 3：改为「相对路径」而非内联
            exportedAt: Date.now(),
            root: String(s.root || ''),
            rootRel: rootRel,
            subdir: String(s.subdir || ''),
            count: out.length,
            favorites: Array.isArray(s.favorites) ? s.favorites : [],
            files: out
        };
    }

    /** 剥掉 relPath 的首段（subdir 前缀），得到「库根内」的相对路径 */
    function stripSubdir(rel, subdir) {
        var r = String(rel || '');
        var p = String(subdir || '').replace(/^\/+|\/+$/g, '');
        if (p && r.indexOf(p + '/') === 0) { return r.slice(p.length + 1); }
        return r;
    }

    /**
     * 把数据集包成查看器 HTML（外部数据文件，抖珍藏式）。
     *
     * ⚠️ 2026-11-18 架构调整：数据放**同目录 data.js**，由 <script src> 加载。
     *   实测（Edge 157）：file:// 下 <script src> 与 fetch 同目录文件都可用；
     *   之前担心的 CORS 拦截在「同目录」场景下不成立。
     *   这样 HTML 本身固定不变，素材增删只需重写 data.js。
     *
     * @param {object} data       slim() 的输出（会被忽略，仅用于取标题/统计）
     * @param {object} [opt]      {title, dataFile, inlineData}
     */
    function buildHtml(data, opt) {
        var o = opt || {};
        var title = String(o.title || '本地媒体库');
        var dataFile = String(o.dataFile || 'data.js');
        var d = data || {};

        /* 兼容：显式要求内联时才内联（默认外部文件） */
        var inline = !!o.inlineData;
        var dataTags = '';
        if (inline) {
            var safeJson = JSON.stringify(d).replace(/<\/script/gi, '<\\/script');
            dataTags = '<script id="vr-data" type="application/json">' + safeJson + '</script>\n';
        } else {
            /* 外部数据：data.js 里是 window.VR_LIB = {...} */
            dataTags = '<script src="' + esc(dataFile) + '"></script>\n';
        }

        var dt = new Date(Number(d.exportedAt || Date.now()));
        var stamp = dt.getFullYear() + '-' +
            String(dt.getMonth() + 1).padStart(2, '0') + '-' +
            String(dt.getDate()).padStart(2, '0') + ' ' +
            String(dt.getHours()).padStart(2, '0') + ':' +
            String(dt.getMinutes()).padStart(2, '0');

        return '<!doctype html>\n<html lang="zh">\n<head>\n' +
            '<meta charset="utf-8">\n' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
            '<title>' + esc(title) + '</title>\n' +
            '<style>' + VIEWER_CSS + '</style>\n' +
            '</head>\n<body>\n' +
            dataTags +
            '<header class="bar">' +
              '<h1>' + esc(title) + '</h1>' +
              '<span class="stamp">数据截止 ' + esc(stamp) + '</span>' +
              '<span class="cnt" id="cnt"></span>' +
            '</header>\n' +
            '<div class="tools">' +
              '<input id="q" type="search" placeholder="搜索标题 / 作者 / 文件名（-词 排除）">' +
              '<select id="fType"><option value="">全部类型</option>' +
                '<option value="image">图片</option><option value="video">视频</option>' +
                '<option value="audio">音频</option></select>' +
              '<select id="fPlat"><option value="">全部平台</option></select>' +
              '<select id="fSort"><option value="new">最新</option><option value="old">最早</option>' +
                '<option value="size">最大</option><option value="name">名称</option></select>' +
              '<label class="star"><input id="fStar" type="checkbox"> 仅星标</label>' +
            '</div>\n' +
            '<main id="grid" class="grid"></main>\n' +
            '<div id="empty" class="empty" hidden>没有匹配的素材</div>\n' +
            '<div id="lb" class="lb" hidden><div class="lb-bg"></div>' +
              '<div class="lb-body"><img id="lbImg" alt=""><video id="lbVid" controls hidden></video>' +
              '<div class="lb-info" id="lbInfo"></div>' +
              '<button class="lb-close" id="lbClose">×</button></div></div>\n' +
            '<script>' + VIEWER_JS + '</script>\n' +
            '</body>\n</html>';
    }

    /**
     * 生成数据文件内容（data.js）。
     * 用 `window.VR_LIB = {...}` 而非 JSON：这样 file:// 下 <script src> 就能加载，
     * 不需要 fetch（虽然实测 fetch 同目录也通，但 script 更省事、无异步时序问题）。
     */
    function buildDataJs(data) {
        var json = JSON.stringify(data || {});
        /* 防止数据里的 </script> 影响宿主（虽然外部 js 不受此影响，但保守处理） */
        json = json.replace(/<\/script/gi, '<\\/script');
        return '/* 本地媒体库数据（由 video-rod 导出，' +
            new Date().toISOString().slice(0, 19).replace('T', ' ') + '）\n' +
            ' * 直接双击 index.html 即可浏览；删除本文件会让页面空白。\n' +
            ' * 重新导出会覆盖本文件，index.html 不需要更新。\n' +
            ' */\n' +
            'window.VR_LIB = ' + json + ';\n';
    }

    /* ---------------- 查看器样式（内联，无外部依赖） ---------------- */
    var VIEWER_CSS = [
        ':root{--bg:#15161a;--fg:#e8e8ea;--dim:#9aa0a6;--card:#1e2026;--line:#2c2f36;--acc:#f5cc63}',
        '*{box-sizing:border-box}',
        'body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
        '.bar{display:flex;align-items:baseline;gap:14px;padding:14px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}',
        '.bar h1{font-size:16px;margin:0;font-weight:600}',
        '.stamp{color:var(--dim);font-size:12px}',
        '.cnt{margin-left:auto;color:var(--dim);font-size:12px}',
        '.tools{display:flex;gap:10px;padding:12px 20px;flex-wrap:wrap;align-items:center}',
        '.tools input[type=search]{flex:1;min-width:220px;padding:7px 10px;background:var(--card);border:1px solid var(--line);border-radius:6px;color:var(--fg)}',
        '.tools select{padding:7px 10px;background:var(--card);border:1px solid var(--line);border-radius:6px;color:var(--fg)}',
        '.star{color:var(--dim);display:flex;align-items:center;gap:5px;cursor:pointer}',
        '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;padding:0 20px 40px}',
        '.card{background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;cursor:pointer;transition:border-color .15s}',
        '.card:hover{border-color:var(--acc)}',
        '.thumb{aspect-ratio:1;background:#0e0f12;display:flex;align-items:center;justify-content:center;overflow:hidden}',
        '.thumb img{width:100%;height:100%;object-fit:cover}',
        '.thumb .noimg{color:#4a4f57;font-size:12px}',
        '.meta{padding:8px 10px}',
        '.meta .t{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.meta .a{font-size:11px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.meta .s{font-size:11px;color:#6b7178;margin-top:2px}',
        '.empty{text-align:center;color:var(--dim);padding:60px 20px}',
        '.lb{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center}',
        '.lb-bg{position:absolute;inset:0;background:rgba(0,0,0,.86)}',
        '.lb-body{position:relative;max-width:92vw;max-height:92vh;display:flex;flex-direction:column;gap:8px}',
        '.lb-body img,.lb-body video{max-width:92vw;max-height:76vh;object-fit:contain;border-radius:6px}',
        '.lb-info{color:var(--dim);font-size:12px;text-align:center}',
        '.lb-info a{color:var(--acc)}',
        '.lb-close{position:absolute;top:-36px;right:0;background:none;border:0;color:#fff;font-size:26px;cursor:pointer;line-height:1}'
    ].join('\n');

    /* ---------------- 查看器脚本（内联，纯前端） ---------------- */
    var VIEWER_JS = [
        '(function(){',
        '  /* 数据来源：优先 window.VR_LIB（外部 data.js），退回内联 JSON */',
        '  var D = window.VR_LIB || {};',
        '  if (!D.files) {',
        '    try { D = JSON.parse((document.getElementById("vr-data")||{}).textContent || "{}"); } catch(e) { D = {}; }',
        '  }',
        '  var FILES = Array.isArray(D.files) ? D.files : [];',
        '  var S = { q:"", type:"", plat:"", sort:"new", star:false };',
        '  var grid=document.getElementById("grid"), empty=document.getElementById("empty"), cnt=document.getElementById("cnt");',
        '',
        '  function human(n){ n=Number(n)||0; if(n<1024) return n+" B";',
        '    if(n<1048576) return (n/1024).toFixed(1)+" KB";',
        '    if(n<1073741824) return (n/1048576).toFixed(1)+" MB";',
        '    return (n/1073741824).toFixed(2)+" GB"; }',
        '',
        '  /* 缩略图：直接用相对路径（离线包在 _library/ 下 → thumbs/<key>.webp） */',
        '  function thumbOf(f){',
        '    if(f.tp) return f.tp;',
        '    if(!f.th) return "";',
        '    var k=String(f.th).replace(/^\\/+/, "");',
        '    if(k.indexOf("/")>=0) return k;',
        '    if(!/\\.(webp|jpg|jpeg|png|gif)$/i.test(k)) k += ".webp";',
        '    return "thumbs/"+k;',
        '  }',
        '',
        '  /* 素材本体：相对路径（../../平台/作者/类型/文件名） */',
        '  function mediaOf(f){ return f.mp || f.p || ""; }',
        '',
        '  function filtered(){',
        '    var raw=(S.q||"").toLowerCase().trim();',
        '    var terms=raw?raw.split(/\\s+/):[];',
        '    var must=terms.filter(function(t){return t.charAt(0)!=="-";});',
        '    var excl=terms.filter(function(t){return t.charAt(0)==="-";}).map(function(t){return t.slice(1);});',
        '    return FILES.filter(function(f){',
        '      if(S.type && f.t!==S.type) return false;',
        '      if(S.plat && f.pl!==S.plat) return false;',
        '      if(S.star && !f.st) return false;',
        '      if(must.length||excl.length){',
        '        var hay=[f.ti,f.a,f.n,f.p,f.pl].join(" ").toLowerCase();',
        '        if(must.length && !must.every(function(w){return hay.indexOf(w)>=0;})) return false;',
        '        if(excl.length && excl.some(function(w){return hay.indexOf(w)>=0;})) return false;',
        '      }',
        '      return true;',
        '    });',
        '  }',
        '',
        '  function sorted(rows){',
        '    var out=rows.slice(), s=S.sort;',
        '    out.sort(function(a,b){',
        '      var d=0;',
        '      if(s==="old") d=(a.m||0)-(b.m||0);',
        '      else if(s==="size") d=(b.s||0)-(a.s||0);',
        '      else if(s==="name") d=String(a.n||"").localeCompare(String(b.n||""),"zh");',
        '      else d=(b.m||0)-(a.m||0);',
        '      return d;',
        '    });',
        '    return out;',
        '  }',
        '',
        '  function paint(){',
        '    var rows=sorted(filtered());',
        '    cnt.textContent=rows.length+" / "+FILES.length+" 条";',
        '    empty.hidden=rows.length>0;',
        '    var frag=document.createDocumentFragment();',
        '    rows.slice(0,600).forEach(function(f){',
        '      var card=document.createElement("div"); card.className="card";',
        '      var th=document.createElement("div"); th.className="thumb";',
        '      var tp=thumbOf(f);',
        '      if(tp){ var im=document.createElement("img"); im.loading="lazy"; im.src=tp;',
        '        im.onerror=function(){ this.parentNode.innerHTML=\'<span class="noimg">无预览</span>\'; };',
        '        th.appendChild(im); }',
        '      else { th.innerHTML=\'<span class="noimg">无预览</span>\'; }',
        '      var meta=document.createElement("div"); meta.className="meta";',
        '      meta.innerHTML=\'<div class="t">\'+esc(f.ti||f.n||"(未命名)")+\'</div>\'',
        '        +\'<div class="a">\'+esc(f.a||f.pl||"")+\'</div>\'',
        '        +\'<div class="s">\'+human(f.s)+(f.st?" · ★":"")+\'</div>\';',
        '      card.appendChild(th); card.appendChild(meta);',
        '      card.onclick=function(){ openLb(f); };',
        '      frag.appendChild(card);',
        '    });',
        '    grid.innerHTML=""; grid.appendChild(frag);',
        '  }',
        '',
        '  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }',
        '',
        '  /* 灯箱：直接读库里的素材本体（相对路径），不需要导出素材副本 */',
        '  function openLb(f){',
        '    var lb=document.getElementById("lb"), img=document.getElementById("lbImg"), vid=document.getElementById("lbVid");',
        '    var info=document.getElementById("lbInfo");',
        '    var src=mediaOf(f);',
        '    if(f.t==="video"||f.t==="audio"){',
        '      img.hidden=true; vid.hidden=false; vid.src=src;',
        '      vid.onerror=function(){ info.innerHTML="(素材文件不在原位置，可能已移动)"; };',
        '    } else {',
        '      vid.hidden=true; img.hidden=false; img.src=src;',
        '      img.onerror=function(){ img.alt="(素材文件不在原位置，可能已移动)"; };',
        '    }',
        '    var bits=[human(f.s)];',
        '    if(f.w&&f.h) bits.push(f.w+"×"+f.h);',
        '    if(f.d) bits.push(Math.round(f.d)+"s");',
        '    if(f.a) bits.push(esc(f.a));',
        '    info.innerHTML=bits.join(" · ")+(f.pu?\' · <a href="\'+esc(f.pu)+\'" target="_blank" rel="noopener">原帖</a>\':"");',
        '    lb.hidden=false;',
        '  }',
        '',
        '  document.getElementById("lbClose").onclick=function(){',
        '    var lb=document.getElementById("lb"); lb.hidden=true;',
        '    var v=document.getElementById("lbVid"); try{ v.pause(); v.src=""; }catch(e){}',
        '  };',
        '  document.querySelector(".lb-bg").onclick=function(){ document.getElementById("lbClose").click(); };',
        '  document.addEventListener("keydown",function(e){ if(e.key==="Escape") document.getElementById("lbClose").click(); });',
        '',
        '  document.getElementById("q").oninput=function(e){ S.q=e.target.value; paint(); };',
        '  document.getElementById("fType").onchange=function(e){ S.type=e.target.value; paint(); };',
        '  document.getElementById("fPlat").onchange=function(e){ S.plat=e.target.value; paint(); };',
        '  document.getElementById("fSort").onchange=function(e){ S.sort=e.target.value; paint(); };',
        '  document.getElementById("fStar").onchange=function(e){ S.star=e.target.checked; paint(); };',
        '',
        '  /* 填平台下拉（去重） */',
        '  (function(){',
        '    var sel=document.getElementById("fPlat"), seen={}, list=[];',
        '    FILES.forEach(function(f){ if(f.pl && !seen[f.pl]){ seen[f.pl]=1; list.push(f.pl); } });',
        '    list.sort();',
        '    list.forEach(function(p){ var o=document.createElement("option"); o.value=p; o.textContent=p; sel.appendChild(o); });',
        '  })();',
        '',
        '  paint();',
        '})();'
    ].join('\n');

    /**
     * 生成库根入口页（`离线库.html`，放在库根第一层）。
     *
     * 为什么需要它：
     *   离线页真实位置在 `_library/_offline/index.html`，要钻两层目录才能找到；
     *   放在库根第一层的入口双击就能进，符合「电脑坏了拿移动硬盘看」的场景。
     *
     * 用 meta refresh 而不是 JS 跳转：更稳，且不依赖脚本执行。
     */
    function buildRootEntry(opt) {
        var o = opt || {};
        var title = String(o.title || '离线媒体库');
        var target = String(o.target || '_library/_offline/index.html');
        return '<!doctype html>\n<html lang="zh">\n<head>\n' +
            '<meta charset="utf-8">\n' +
            '<title>' + esc(title) + '</title>\n' +
            '<meta http-equiv="refresh" content="0; url=' + esc(target) + '">\n' +
            '<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
            'background:#15161a;color:#e8e8ea;font:14px system-ui,sans-serif}' +
            'a{color:#f5cc63}</style>\n' +
            '</head>\n<body>\n' +
            '<div>正在打开媒体库… 若没反应请点 <a href="' + esc(target) + '">这里</a></div>\n' +
            '</body>\n</html>';
    }

    /* ---------------- 缩略图内联 ---------------- */

    /** Blob → dataURL（纯 Web API，SW 与页面都能用） */
    function blobToDataUrl(blob) {
        return new Promise(function (resolve) {
            try {
                var r = new FileReader();
                r.onload = function () { resolve(String(r.result || '')); };
                r.onerror = function () { resolve(''); };
                r.readAsDataURL(blob);
            } catch (e) { resolve(''); }
        });
    }

    /* ---------------- 高层入口：快照 + 缩略图 → 完整 HTML ---------------- */

    /**
     * 生成离线包（抖珍藏式：index.html + data.js + 复用 _library/thumbs/）。
     *
     * ⚠️ 2026-11-18 架构调整：不再内联缩略图 base64。
     *   · index.html 固定不变（只在查看器代码更新时才需重写）
     *   · data.js    每次导出覆盖（素材增删只改这一个文件）
     *   · thumbs/    直接复用库里的 _library/thumbs/（不复制，省空间）
     *   · 素材本体   同理由相对路径直接读库里的文件
     *
     * @param {object} snapshot    indexer 的 schema:2 快照
     * @param {object} [deps]     保留参数位（旧调用兼容），未使用
     * @param {object} [opt]      {title, rootRel, inlineData}
     * @returns {{html:string, dataJs:string, count:number, bytes:number}}
     */
    async function buildBundle(snapshot, deps, opt) {
        var o = opt || {};
        /* 素材相对离线页的路径前缀：
         * 离线包放在 <库根>/_library/ 里 → 上两级到库根 */
        var rootRel = String(o.rootRel == null ? '../../' : o.rootRel);

        /* ① 裁数据（含相对路径） */
        var data = slim(snapshot, { rootRel: rootRel });

        /* ② 生成 HTML（外部数据文件） */
        var html = buildHtml(data, {
            title: o.title || '本地媒体库',
            dataFile: 'data.js',
            inlineData: !!o.inlineData
        });

        /* ③ 生成数据文件 */
        var dataJs = buildDataJs(data);

        /* ④ 生成库根入口页（放在库根第一层，双击即进） */
        var rootEntry = buildRootEntry({
            title: o.title || '离线媒体库',
            target: '_library/_offline/index.html'
        });

        return {
            html: html,
            dataJs: dataJs,
            rootEntry: rootEntry,
            count: data.count,
            bytes: html.length + dataJs.length + rootEntry.length
        };
    }

    return {
        slim: slim,
        buildHtml: buildHtml,
        buildDataJs: buildDataJs,
        buildRootEntry: buildRootEntry,
        buildBundle: buildBundle,
        blobToDataUrl: blobToDataUrl,
        stripSubdir: stripSubdir,
        _VIEWER_CSS: VIEWER_CSS,
        _VIEWER_JS: VIEWER_JS
    };
});
