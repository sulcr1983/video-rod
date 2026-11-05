/* ==========================================================
 * VR Library App —— 舞台原型复刻 + 真实数据（R3/R4）
 * 真源：deliverables/prototypes/media-library-stage-v1.html
 * 职责：VRDB 条目 → 卡片模型 → 原型 DOM 渲染；筛选/搜索/排序/批量
 * 数据层复用：VRDB / VRIndex / VRThumbs / VRPath
 * ========================================================== */
(function () {
    'use strict';

    var root = window;

    /* ---------- 平台字典（与原型 PLAT 对齐，补 B站/音频） ---------- */
    var PLAT = {
        x: { name: 'X', dot: '#8FA0B8', label: 'X' },
        xiaohongshu: { name: '小红书', dot: '#FF2442', label: '小红书' },
        douyin: { name: '抖音', dot: '#25C8D4', label: '抖音' },
        weibo: { name: '微博', dot: '#E6506D', label: '微博' },
        youtube: { name: 'YouTube', dot: '#FF0000', label: 'YouTube' },
        instagram: { name: 'Instagram', dot: '#C13584', label: 'Instagram' },
        bilibili: { name: 'B站', dot: '#FB7299', label: 'B站' },
        tiktok: { name: 'TikTok', dot: '#25F4EE', label: 'TikTok' },
        web: { name: '网页', dot: '#8B93A1', label: '网页' }
    };

    /* ---------- 状态 ---------- */
    var RAW = {};      // relPath -> 原始条目
    var FILES = [];    // 卡片模型
    var S = {
        type: 'all', plat: 'all', q: '', view: 'grid',
        select: false, sel: new Set(), sort: 'new', fav: null, idx: 0, list: []
    };
    var treeOpen = {};
    var objUrls = [];

    var $ = function (s) { return document.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
    var esc = function (s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    };
    function fmt(mb) {
        var n = Number(mb) || 0;
        if (n >= 1024) { return (n / 1024).toFixed(1) + ' GB'; }
        if (n >= 1) { return n.toFixed(1) + ' MB'; }
        return Math.round(n * 1024) + ' KB';
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function fmtDate(ts) {
        var d = new Date(Number(ts) || 0);
        if (!ts || isNaN(d.getTime())) { return ''; }
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
            + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    function shortDate(v) {
        if (!v) { return '—'; }
        var m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) { return m[2] + '-' + m[3]; }
        var m2 = String(v).match(/(\d{2})-(\d{2})/);
        return m2 ? m2[0] : '—';
    }
    function fmtDur(sec) {
        var s = Math.round(Number(sec) || 0);
        if (!s) { return ''; }
        var m = Math.floor(s / 60), r = s % 60;
        return pad(m) + ':' + pad(r);
    }

    /* ---------- 真实条目 → 卡片模型 ---------- */
    var EXT_ANIM = /^(gif|webp|apng|avif)$/i;

    function toCardModel(e) {
        var P = root.VRPath || {};
        var rel = e.relPath || '';
        var parsed = {};
        try { parsed = P.parseRelPath ? (P.parseRelPath(rel) || {}) : {}; } catch (err) { parsed = {}; }
        var fileName = e.fileName || String(rel).split('/').pop() || '';
        var ext = (String(fileName).match(/\.([a-z0-9]{2,5})$/i) || [])[1] || '';
        var type = e.type || parsed.type || (P.typeOf ? P.typeOf({ fileName: fileName }) : 'other');

        var kind = type;
        if (type === 'image' && EXT_ANIM.test(ext)) { kind = 'anim'; }

        var creatorFull = String(e.creatorFull || parsed.creatorFull || '').trim();
        var m = creatorFull.match(/^(.+?)\s*\(@([^)]+)\)\s*$/);
        var author = (m ? m[1] : creatorFull).trim();
        var authorId = e.creatorId || parsed.creatorId || (m ? m[2] : '');

        var title = String(e.title || '').trim() || String(fileName).replace(/\.[^.]+$/, '');
        var sizeMb = (Number(e.size) || 0) / 1048576;

        return {
            id: rel,
            relPath: rel,
            absPath: e.absPath || '',
            plat: (e.platform || parsed.platform || 'web'),
            author: author,
            authorId: authorId,
            title: title,
            kind: kind,
            ext: String(ext).toUpperCase(),
            size: sizeMb,
            width: Number(e.width) || 0,
            height: Number(e.height) || 0,
            dur: fmtDur(e.duration),
            frames: Number(e.frames) || 0,
            h: 180,
            tags: Array.isArray(e.tags) ? e.tags : [],
            starred: !!e.starred,
            state: e.state || 'ok',
            savedAt: fmtDate(e.mtime),
            dlAt: fmtDate(e.mtime),
            workId: e.workId || '',
            pageUrl: e.pageUrl || ''
        };
    }

    /* ---------- 统计 ---------- */
    function counts() {
        var c = { all: FILES.length, image: 0, anim: 0, video: 0, audio: 0, other: 0, starred: 0, platforms: {}, creators: {} };
        FILES.forEach(function (f) {
            c[f.kind] = (c[f.kind] || 0) + 1;
            c.platforms[f.plat] = (c.platforms[f.plat] || 0) + 1;
            if (f.author) { c.creators[f.author] = (c.creators[f.author] || 0) + 1; }
            if (f.starred) { c.starred++; }
        });
        return c;
    }

    /* ---------- 筛选 / 排序 ---------- */
    function filtered() {
        return FILES.filter(function (f) {
            if (S.fav) {
                var fav = null;
                for (var i = 0; i < FAVS.length; i++) { if (FAVS[i].id === S.fav) { fav = FAVS[i]; break; } }
                if (fav && !favHas(fav, f)) { return false; }
            }
            if (S.type !== 'all' && f.kind !== S.type) { return false; }
            if (S.plat !== 'all' && f.plat !== S.plat) { return false; }
            if (S.q) {
                var raw = S.q.replace(/^@/, '').toLowerCase().trim();
                var terms = raw.split(/\s+/).filter(Boolean);
                var must = terms.filter(function (t) { return t.charAt(0) !== '-'; });
                var excl = terms.filter(function (t) { return t.charAt(0) === '-'; }).map(function (t) { return t.slice(1); }).filter(Boolean);
                var hay = (f.title + ' ' + (f.author || '') + ' ' + (f.authorId || '') + ' ' + f.id + ' ' + f.plat).toLowerCase();
                if (must.length && !must.every(function (w) { return hay.indexOf(w) >= 0; })) { return false; }
                if (excl.length && excl.some(function (w) { return hay.indexOf(w) >= 0; })) { return false; }
            }
            return true;
        });
    }
    function sorted(rows) {
        var out = rows.slice();
        var s = (S.sort || $('#sort') && $('#sort').value || 'new');
        out.sort(function (a, b) {
            if (s === 'old') { return (a.savedAt || '').localeCompare(b.savedAt || ''); }
            if (s === 'size') { return (b.size || 0) - (a.size || 0); }
            if (s === 'name') { return String(a.title).localeCompare(String(b.title), 'zh'); }
            return (b.savedAt || '').localeCompare(a.savedAt || '');
        });
        return out;
    }

    /* ---------- 侧栏编号树 ---------- */
    function buildTree() {
        var c = counts();
        var keys = Object.keys(c.platforms).sort(function (a, b) { return c.platforms[b] - c.platforms[a]; });
        var rows = [{ kind: 'root', label: '全部素材', count: c.all }];
        var pi = 0;
        keys.forEach(function (p) {
            pi++;
            var num = pad(pi);
            rows.push({ kind: 'plat', key: p, label: (PLAT[p] || PLAT.web).name, count: c.platforms[p], num: num });
            var creators = {};
            FILES.forEach(function (f) {
                if (f.plat === p && f.author) { creators[f.author] = (creators[f.author] || 0) + 1; }
            });
            var ck = Object.keys(creators).sort(function (a, b) { return creators[b] - creators[a]; });
            ck.forEach(function (name, i) {
                rows.push({ kind: 'author', plat: p, label: name, count: creators[name], num: num + '·' + (i + 1) });
            });
        });
        return rows;
    }

    function renderTree() {
        var c = counts();
        var q = ($('#treeSearch') && $('#treeSearch').value || '').trim().toLowerCase();
        var rows = buildTree();
        var total = FILES.length || 1;
        var html = rows.filter(function (t) { return !q || String(t.label).toLowerCase().indexOf(q) >= 0; }).map(function (t) {
            var pct = t.kind === 'root' ? 100 : Math.max(2, Math.min(100, Math.round(t.count / total * 100)));
            if (t.kind === 'author' && !treeOpen[t.plat] && !q) { return ''; }
            if (t.kind === 'root') {
                return '<button class="tree-node active" style="--pct:' + pct + '%">' +
                    '<span class="ix">00</span><span class="label">' + esc(t.label) + '</span>' +
                    '<span class="count">' + c.all + '</span></button>';
            }
            if (t.kind === 'plat') {
                var open = !!treeOpen[t.key] || !!q;
                return '<button class="tree-node plat" data-plat="' + esc(t.key) + '" style="--pct:' + pct + '%;--pc:' + (PLAT[t.key] || PLAT.web).dot + '">' +
                    '<svg class="i i-sm chev" style="transform:rotate(' + (open ? 0 : -90) + 'deg)"><use href="#i-chevron-down"/></svg>' +
                    '<span class="ix">' + t.num + '</span><span class="label">' + esc(t.label) + '</span>' +
                    '<span class="count">' + t.count + '</span></button>';
            }
            return '<button class="tree-node lv2" data-author="' + esc(t.label) + '" style="--pct:' + pct + '%">' +
                '<span class="ix">' + t.num + '</span><span class="label">' + esc(t.label) + '</span>' +
                '<span class="count">' + t.count + '</span></button>';
        }).join('');
        $('#tree').innerHTML = html || '<div class="side-empty">暂无素材</div>';
        var tt = $('#treeTotal');
        if (tt) { tt.textContent = FILES.length; }
    }

    /* ---------- 卡片 ---------- */
    function card(f) {
        var isV = f.kind === 'video', isA = f.kind === 'anim', isAu = f.kind === 'audio';
        var p = PLAT[f.plat] || PLAT.web;
        var corner = isV ? (f.dur || '') : (isA ? f.ext : (isAu ? f.ext : ''));
        var icon = isV ? 'i-film' : (isA ? 'i-repeat-1' : (isAu ? 'i-volume-2' : 'i-image'));
        var tags = (f.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
        return '<article class="card' + (S.sel.has(f.id) ? ' selected' : '') + '" data-id="' + esc(f.id) + '" tabindex="0">' +
            '<div class="thumb' + (isV ? ' is-video' : '') + (isA ? ' is-anim' : '') + '">' +
            '<div class="cover" style="--h:' + f.h + '"><span class="fig"><svg class="i"><use href="#' + icon + '"/></svg></span></div>' +
            '<img alt="" loading="lazy" data-thumb="' + esc(f.relPath) + '">' +
            '<span class="badge"><span class="dot" style="--pc:' + p.dot + '"></span>' + p.label + '</span>' +
            (corner ? '<span class="duration' + (isA ? ' anim' : '') + '">' + esc(corner) + '</span>' : '') +
            (f.state === 'missing' ? '<span class="missing-tag">文件缺失</span>' : '') +
            '<div class="playbtn"><span><svg class="i"><use href="#i-' + (isV || isA ? 'play' : 'maximize') + '"/></svg></span></div>' +
            '</div>' +
            '<div class="body">' +
            '<div class="title">' + esc(f.title) + '</div>' +
            '<div class="metarow">' +
            '<span class="authorline"><span class="avatar">' + esc((f.author || '?').slice(0, 1)) + '</span>' +
            '<span class="nm">' + esc(f.author || '未知来源') + '</span></span>' +
            '<span class="size">' + fmt(f.size) + '</span>' +
            '</div>' +
            '<span class="platcell" style="--pc:' + p.dot + '">' + p.label + '</span>' +
            '<span class="timecell">' + esc(shortDate(f.savedAt)) + '</span>' +
            (tags ? '<div class="tagrow">' + tags + '</div>' : '') +
            '</div>' +
            '<input type="checkbox" class="selbox" aria-label="选择此素材"' + (S.sel.has(f.id) ? ' checked' : '') + '>' +
            '</article>';
    }

    /* ---------- 空态 ---------- */
    function renderEmpty(n) {
        var el = $('#empty');
        if (!el) { return; }
        if (n > 0) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        var filtering = !!(S.q || S.type !== 'all' || S.plat !== 'all');
        var noData = FILES.length === 0;
        var ico = function (h) { var i = $('#emptyIco'); if (i) { i.innerHTML = '<svg class="i"><use href="#' + h + '"/></svg>'; } };
        var title = $('#emptyTitle'), text = $('#emptyText'), act = $('#emptyAction');
        if (noData) {
            ico('i-folder');
            title.textContent = '这个目录里还没有素材';
            text.innerHTML = '在网页上抓到的东西会自动存进来。<br>也可以先扫一遍目录里已有的文件。';
            act.textContent = '扫描目录'; act.dataset.act = 'scan';
        } else if (filtering) {
            ico('i-search');
            title.textContent = '没有匹配的素材';
            var bits = [];
            if (S.q) { bits.push('关键词「' + S.q + '」'); }
            if (S.type !== 'all') { bits.push('类型筛选'); }
            if (S.plat !== 'all') { bits.push('平台筛选'); }
            text.textContent = '当前有 ' + bits.join(' + ') + '，库里共 ' + FILES.length + ' 项。换个条件或清掉筛选再试。';
            act.textContent = '清除筛选'; act.dataset.act = 'clear';
        }
    }

    /* ---------- 主渲染 ---------- */
    function render() {
        var rows = sorted(filtered());
        S.list = rows;
        var grid = $('#grid');
        grid.className = 'grid' + (S.view === 'list' ? ' list' : '') + (S.select ? ' selecting' : '');
        grid.innerHTML = rows.map(card).join('');
        var lh = $('#listhead');
        if (lh) { lh.classList.toggle('on', S.view === 'list'); }
        grid.classList.toggle('hidden', rows.length === 0);
        renderEmpty(rows.length);
        observeThumbs();

        var c = counts();
        var setTxt = function (sel, v) { var e = $(sel); if (e) { e.textContent = v; } };
        setTxt('#sCount', rows.length);
        setTxt('#sImg', c.image);
        setTxt('#sAnim', c.anim);
        setTxt('#sVid', c.video);
        setTxt('#fCount', rows.length);
        setTxt('#fSize', Math.round(rows.reduce(function (a, b) { return a + (b.size || 0); }, 0)) + ' MB');
        setTxt('#treeTotal', FILES.length);
        setTxt('#batchCount', '已选 ' + S.sel.size + ' 项');

        $$('#typeTabs button').forEach(function (b) {
            var t = b.dataset.type;
            var n = t === 'all' ? FILES.length : (c[t] || 0);
            var badge = b.querySelector('b'); if (badge) { badge.textContent = n; }
        });
        renderFavs();
    }

    /* ---------- 缩略图懒加载 ---------- */
    var io = null;
    function observeThumbs() {
        var nodes = $$('[data-thumb]');
        if (!('IntersectionObserver' in window)) {
            nodes.forEach(function (img) { var e = RAW[img.getAttribute('data-thumb')]; if (e && root.VRThumbs) { root.VRThumbs.enqueue(e); } });
            return;
        }
        if (io) { io.disconnect(); }
        io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting) { return; }
                var img = en.target;
                var e = RAW[img.getAttribute('data-thumb')];
                if (e && root.VRThumbs) { root.VRThumbs.enqueue(e); }
                io.unobserve(img);
            });
        }, { rootMargin: '200px' });
        nodes.forEach(function (img) { io.observe(img); });
    }

    window.addEventListener('vrthumb', function (ev) {
        var d = ev.detail || {};
        if (!d.blob) { return; }
        var url = URL.createObjectURL(d.blob);
        objUrls.push(url);
        $$('[data-thumb]').forEach(function (el) {
            if (el.getAttribute('data-thumb') !== d.relPath) { return; }
            el.src = url;
            el.classList.add('loaded');
        });
    });

    /* ---------- toast ---------- */
    var toastTimer = 0;
    function toast(msg) {
        var el = $('#toast');
        if (!el) { return; }
        el.textContent = msg;
        el.classList.add('on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2200);
    }
    window.toast = toast;

    /* ---------- 数据加载 ---------- */
    async function load() {
        if (!root.VRDB) { return; }
        var list = [];
        try { list = await root.VRDB.getAllFiles(); } catch (e) { list = []; }
        RAW = {};
        list.forEach(function (e) { RAW[e.relPath] = e; });
        FILES = list.map(toCardModel);
        renderTree();
        render();
        renderRoot();
    }

    function renderRoot() {
        var pathEl = $('#rootBtn .rb-path');
        var hintEl = $('#rootBtn .rb-hint');
        if (!pathEl) { return; }
        pathEl.textContent = '未探测';
        if (hintEl) { hintEl.textContent = '点击更换目录'; }
        try {
            chrome.storage.local.get('vrLibSettings', function (o) {
                var s = (o && o.vrLibSettings) || {};
                var base = s.mode === 'custom' ? s.customRoot
                    : (s.detectedRoot ? s.detectedRoot + '\\' + (s.subdir || 'video-rod') : '');
                if (base) { pathEl.textContent = base; pathEl.title = base; }
            });
        } catch (e) { /* 非扩展环境 */ }
    }

    /* ---------- 首次自动索引 ---------- */
    async function autoIndex() {
        if (!root.VRIndex) { return false; }
        try {
            await root.VRIndex.build({ mode: 'full' });
            return true;
        } catch (e) {
            try { await root.VRIndex.build({ mode: 'snapshot' }); return true; }
            catch (e2) { return false; }
        }
    }

    /* ---------- 事件 ---------- */
    function bind() {
        var tt = $('#typeTabs');
        if (tt) {
            tt.addEventListener('click', function (e) {
                var b = e.target.closest('button'); if (!b) { return; }
                $$('#typeTabs button').forEach(function (x) { x.classList.remove('active'); });
                b.classList.add('active'); S.type = b.dataset.type; render();
            });
        }
        var chips = $('#chips');
        if (chips) {
            chips.addEventListener('click', function (e) {
                var c = e.target.closest('.chip'); if (!c) { return; }
                $$('.chip').forEach(function (x) { x.classList.remove('active'); });
                c.classList.add('active'); S.plat = c.dataset.plat; render();
            });
        }
        var vt = $('#viewToggle');
        if (vt) {
            vt.addEventListener('click', function (e) {
                var b = e.target.closest('button'); if (!b) { return; }
                $$('#viewToggle button').forEach(function (x) { x.classList.remove('active'); });
                b.classList.add('active'); S.view = b.dataset.view; render();
            });
        }
        var search = $('#search');
        if (search) { search.addEventListener('input', function (e) { S.q = e.target.value.trim().toLowerCase(); render(); }); }
        var sort = $('#sort');
        if (sort) { sort.addEventListener('change', function () { render(); }); }

        var sb = $('#selectBtn');
        if (sb) {
            sb.addEventListener('click', function () {
                S.select = !S.select; S.sel.clear();
                sb.classList.toggle('is-on', S.select);
                var bb = $('#batchbar'); if (bb) { bb.classList.toggle('hidden', !S.select); }
                render();
            });
        }
        var on = function (id, fn) { var el = document.getElementById(id); if (el) { el.addEventListener('click', fn); } };
        on('batchClear', function () { S.sel.clear(); render(); });
        on('batchAll', function () { S.list.forEach(function (f) { S.sel.add(f.id); }); render(); });
        on('batchInvert', function () {
            var nx = new Set(); S.list.forEach(function (f) { if (!S.sel.has(f.id)) { nx.add(f.id); } }); S.sel = nx; render();
        });
        on('batchExit', function () {
            S.select = false; S.sel.clear();
            $('#selectBtn').classList.remove('is-on');
            $('#batchbar').classList.add('hidden'); render();
        });
        on('batchTrash', function () { toast('批量删除将在 R5 接入真实回收站'); });

        var grid = $('#grid');
        if (grid) {
            grid.addEventListener('click', function (e) {
                var c = e.target.closest('.card'); if (!c) { return; }
                var id = c.dataset.id;
                if (S.select) {
                    if (S.sel.has(id)) { S.sel.delete(id); } else { S.sel.add(id); }
                    render(); return;
                }
                openPreview(FILES.find(function (f) { return f.id === id; }));
            });
        }

        var tree = $('#tree');
        if (tree) {
            tree.addEventListener('click', function (e) {
                var n = e.target.closest('.tree-node'); if (!n) { return; }
                if (n.dataset.plat) {
                    treeOpen[n.dataset.plat] = !treeOpen[n.dataset.plat];
                    renderTree(); return;
                }
                $$('.tree-node').forEach(function (x) { x.classList.remove('active'); });
                n.classList.add('active');
                if (n.dataset.author) {
                    S.q = n.dataset.author.toLowerCase();
                    if ($('#search')) { $('#search').value = n.dataset.author; }
                    render();
                }
            });
        }
        var ts = $('#treeSearch');
        if (ts) { ts.addEventListener('input', renderTree); }

        on('rescanBtn', async function () {
            toast('正在扫描目录…');
            var ok = await autoIndex();
            await load();
            toast(ok ? '扫描完成' : '扫描失败：未授权目录');
        });
        on('settingsBtn', function () { var d = $('#setdrawer'), m = $('#setmask'); if (d) { d.classList.add('show'); } if (m) { m.classList.add('show'); } refreshDrawer(); });
        on('setClose', function () { closeSet(); });
        on('setmask', function () { closeSet(); });
        function closeSet() { var d = $('#setdrawer'), m = $('#setmask'); if (d) { d.classList.remove('show'); } if (m) { m.classList.remove('show'); } }

        on('rootBtn', function () { openOptions(); });
        on('resetBtn', function () { openOptions(); });

        var emptyAct = $('#emptyAction');
        if (emptyAct) {
            emptyAct.addEventListener('click', async function () {
                var act = emptyAct.dataset.act;
                if (act === 'scan') { toast('正在扫描目录…'); await autoIndex(); await load(); }
                else { S.q = ''; S.type = 'all'; S.plat = 'all'; if ($('#search')) { $('#search').value = ''; } render(); }
            });
        }

        bindFavAndDrawer();

        document.addEventListener('keydown', function (e) {
            if (e.key === '/' && document.activeElement !== $('#search')) {
                var t = $('#search'); if (t) { e.preventDefault(); t.focus(); }
            }
            if (e.key === 'Escape') { closeSet(); }
        });
    }

    function openOptions() {
        try { chrome.runtime.openOptionsPage(); } catch (e) { location.href = 'options.html'; }
    }

    /* ---------- 预览（R5 接入真实查看器，当前提示） ---------- */
    function openPreview(f) {
        if (!f) { return; }
        if (root.VRPreview && root.VRPreview.open) { root.VRPreview.open(f, S.list); return; }
        toast('预览器 R5 接入中');
    }

    /* ---------- 收藏夹（R6：真实持久化，收藏夹只记 id 不动物理文件） ---------- */
    var FAVS = [];

    async function loadFavs() {
        try {
            var v = await root.VRDB.getSetting('vrFavs', []);
            FAVS = Array.isArray(v) ? v : [];
        } catch (e) { FAVS = []; }
    }
    function saveFavs() {
        try { root.VRDB.setSetting('vrFavs', FAVS); } catch (e) { /* 忽略 */ }
    }
    function favHas(fav, f) {
        if (!fav) { return false; }
        if (fav.sys === 'star') { return !!f.starred; }
        return (fav.ids || []).indexOf(f.id) >= 0;
    }
    function renderFavs() {
        var list = $('#favList');
        if (!list) { return; }
        var all = [{ id: 'fav-star', name: '已加星标', sys: 'star' }].concat(FAVS);
        list.innerHTML = all.map(function (fav) {
            var n = FILES.filter(function (f) { return favHas(fav, f); }).length;
            if (fav.sys === 'star' && !n) { return ''; }
            var on = S.fav === fav.id;
            return '<button class="fav-row' + (on ? ' active' : '') + '" data-fav="' + esc(fav.id) + '">' +
                '<svg class="i fi' + (fav.sys === 'star' ? ' star' : '') + '"><use href="#i-' + (fav.sys === 'star' ? 'star' : 'bookmark') + '"/></svg>' +
                '<span class="label">' + esc(fav.name) + '</span>' +
                '<span class="count">' + n + '</span></button>';
        }).join('');
        var cnt = $('#favSideCnt');
        if (cnt) { cnt.textContent = FILES.filter(function (f) { return f.starred; }).length; }
    }
    function addToFav(ids) {
        if (!ids.length) { toast('先选素材'); return; }
        var fav = FAVS.filter(function (f) { return f.sys !== 'star'; })[0];
        if (!fav) {
            fav = { id: 'fav-' + Date.now(), name: '默认收藏夹', ids: [] };
            FAVS.push(fav);
        }
        fav.ids = fav.ids || [];
        ids.forEach(function (id) { if (fav.ids.indexOf(id) < 0) { fav.ids.push(id); } });
        saveFavs(); renderFavs(); render();
        toast('已加入「' + fav.name + '」');
    }

    /* ---------- 设置抽屉（R7：真实动作） ---------- */
    function setVal(id, v) { var e = document.getElementById(id); if (e) { e.textContent = v; } }

    async function refreshDrawer() {
        var pathEl = $('#rootBtn .rb-path');
        setVal('sdDirVal', pathEl ? pathEl.textContent : '未探测');
        setVal('sdScanVal', FILES.length ? (FILES.length + ' 个文件 · 索引就绪') : '索引为空');
        setVal('sdIndexVal', FILES.length + ' 项 · ' + Math.round(FILES.reduce(function (a, b) { return a + (b.size || 0); }, 0)) + ' MB');
        var tc = 0;
        try {
            if (root.VRTrash) { var st = await root.VRTrash.status(); tc = st.count || 0; }
        } catch (e) { tc = 0; }
        setVal('sdTrashVal', tc ? (tc + ' 项 · 可恢复') : '空');
        setVal('dwCnt', tc);
        var tcnt = $('#trashCnt'); if (tcnt) { tcnt.textContent = tc; }
    }

    async function doScan() {
        toast('正在扫描目录…');
        var ok = await autoIndex();
        await load();
        await refreshDrawer();
        toast(ok ? '扫描完成：' + FILES.length + ' 项' : '扫描失败：未授权目录');
    }

    async function openTrash() {
        var drawer = $('#drawer'), mask = $('#dwMask');
        if (!drawer) { return; }
        drawer.classList.add('show');
        if (mask) { mask.classList.add('show'); }
        var listEl = $('#dwList');
        if (!listEl) { return; }
        listEl.innerHTML = '<div class="dw-empty">读取中…</div>';
        try {
            var batches = root.VRTrash ? await root.VRTrash.list() : [];
            if (!batches.length) { listEl.innerHTML = '<div class="dw-empty">回收站是空的</div>'; return; }
            listEl.innerHTML = batches.map(function (b) {
                return b.items.map(function (it) {
                    return '<div class="dw-item">' +
                        '<span class="dw-name" title="' + esc(it.relPath) + '">' + esc(it.relPath) + '</span>' +
                        '<button class="btn small" data-restore="' + esc(b.batch) + '|' + esc(it.relPath) + '">恢复</button>' +
                        '</div>';
                }).join('');
            }).join('');
        } catch (e) {
            listEl.innerHTML = '<div class="dw-empty">读取失败：' + esc(e && e.message) + '</div>';
        }
    }

    function bindFavAndDrawer() {
        var favBtn = $('#favMenuBtn');
        if (favBtn) {
            favBtn.addEventListener('click', function () {
                var menu = $('#favMenu');
                if (menu) { menu.classList.toggle('on'); }
            });
        }
        var favList = $('#favList');
        if (favList) {
            favList.addEventListener('click', function (e) {
                var row = e.target.closest('.fav-row'); if (!row) { return; }
                var id = row.dataset.fav;
                S.fav = (S.fav === id) ? null : id;
                renderFavs(); render();
            });
        }
        var newBtn = $('#favNewBtn');
        if (newBtn) {
            newBtn.addEventListener('click', function () {
                var row = $('#favNewRow'); if (row) { row.classList.toggle('on'); }
                var inp = $('#favNewInput'); if (inp) { inp.focus(); }
            });
        }
        function createFav() {
            var inp = $('#favNewInput'); if (!inp) { return; }
            var name = String(inp.value || '').trim();
            if (!name) { return; }
            FAVS.push({ id: 'fav-' + Date.now(), name: name, ids: [] });
            inp.value = '';
            var row = $('#favNewRow'); if (row) { row.classList.remove('on'); }
            saveFavs(); renderFavs();
            toast('已创建收藏夹「' + name + '」');
        }
        var okBtn = $('#favNewOk'); if (okBtn) { okBtn.addEventListener('click', createFav); }
        var inp = $('#favNewInput');
        if (inp) { inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { createFav(); } }); }

        var bf = $('#batchFav');
        if (bf) { bf.addEventListener('click', function () { addToFav(Array.from(S.sel)); }); }

        // 设置抽屉
        var dirBtn = $('#sdDirBtn');
        if (dirBtn) { dirBtn.addEventListener('click', function () { openOptions(); }); }
        var optLink = $('#sdOptionsLink');
        if (optLink) { optLink.addEventListener('click', function (e) { e.preventDefault(); openOptions(); }); }
        var scanBtn = $('#sdScanBtn');
        if (scanBtn) { scanBtn.addEventListener('click', doScan); }
        var rebuildBtn = $('#sdRebuildBtn');
        if (rebuildBtn) { rebuildBtn.addEventListener('click', async function () {
            toast('正在重建索引…');
            try { await root.VRIndex.build({ mode: 'full' }); await load(); toast('索引重建完成'); }
            catch (e) { toast('重建失败：' + (e && e.message || '未知')); }
            await refreshDrawer();
        }); }
        var trashBtn = $('#sdTrashBtn');
        if (trashBtn) { trashBtn.addEventListener('click', function () { closeSet(); openTrash(); }); }

        var dwClose = $('#dwClose');
        if (dwClose) { dwClose.addEventListener('click', function () { closeTrash(); }); }
        var dwMask = $('#dwMask');
        if (dwMask) { dwMask.addEventListener('click', function () { closeTrash(); }); }
        function closeTrash() {
            var d = $('#drawer'), m = $('#dwMask');
            if (d) { d.classList.remove('show'); }
            if (m) { m.classList.remove('show'); }
        }
        var dwList = $('#dwList');
        if (dwList) {
            dwList.addEventListener('click', async function (e) {
                var b = e.target.closest('[data-restore]'); if (!b) { return; }
                var parts = String(b.dataset.restore).split('|');
                try {
                    await root.VRTrash.restore(parts[0], parts.slice(1).join('|'));
                    toast('已恢复');
                    await load(); await refreshDrawer(); openTrash();
                } catch (err) { toast('恢复失败：' + (err && err.message || '未知')); }
            });
        }
        var dwEmpty = $('#dwEmpty');
        if (dwEmpty) { dwEmpty.addEventListener('click', async function () {
            try { await root.VRTrash.empty(); toast('回收站已清空'); await refreshDrawer(); openTrash(); }
            catch (e) { toast('清空失败：' + (e && e.message || '未知')); }
        }); }
        var dwRestoreAll = $('#dwRestoreAll');
        if (dwRestoreAll) { dwRestoreAll.addEventListener('click', async function () {
            try {
                var batches = await root.VRTrash.list();
                for (var i = 0; i < batches.length; i++) { await root.VRTrash.restore(batches[i].batch); }
                toast('已全部恢复'); await load(); await refreshDrawer(); openTrash();
            } catch (e) { toast('恢复失败：' + (e && e.message || '未知')); }
        }); }
    }

    /* ---------- 启动 ---------- */
    async function boot() {
        bind();
        await loadFavs();
        await load();
        if (!FILES.length) {
            var built = await autoIndex();
            if (built) { await load(); }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    root.VRApp = { reload: load, toast: toast, getFiles: function () { return FILES; } };
})();
