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
        web: { name: '网页', dot: '#8B93A1', label: '网页' },
        untracked: { name: '未整理', dot: '#C9A227', label: '未整理' }
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
    /* WebP 只是容器，不等于动图：小红书/Instagram 大量静态 WebP 必须归图片。
     * 只有 GIF/APNG 这类明确动图扩展才进入 anim（用户 2026-11-06 纠正）。 */
    var EXT_ANIM = /^(gif|apng)$/i;

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
            /* 保留 downloads 记录 ID：详情页「定位」要靠它打开系统文件夹，
             * 而不是在浏览器里打开 file:// 目录。 */
            downloadId: (e.downloadId != null ? e.downloadId : null),
            plat: e.untracked ? 'untracked' : (e.platform || parsed.platform || 'web'),
            untracked: !!e.untracked,
            author: author,
            authorId: authorId,
            title: title,
            _title: (e.displayName || '').trim() || title,
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
            isRef: e.isRef ? 1 : 0,
            refOf: e.refOf || '',
            sha256: e.sha256 || '',
            displayName: e.displayName || '',
            savedAt: fmtDate(e.mtime),
            dlAt: fmtDate(e.mtime),
            workId: e.workId || '',
            pageUrl: e.pageUrl || '',
            mediaUrl: e.mediaUrl || e.sourceUrl || '',
            authorUid: e.authorUid || '',
            authorHandle: e.authorHandle || '',
            authorState: e.authorState || (author ? 'ok' : 'unsupported')
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
                var fav = findFav(S.fav);
                /* 找不到收藏夹时**不能放行**：原实现 `if (fav && ...)` 在 fav 为 null
                 * 时直接跳过筛选，结果「已加星标」这种虚拟夹（不在 FAVS 里）
                 * 会显示全部素材（2026-11-06 用户反馈：筛选出来根本不是收藏的东西）。 */
                if (!fav) { return false; }
                if (!favHas(fav, f)) { return false; }
            }
            if (S.type !== 'all' && f.kind !== S.type) { return false; }
            if (S.plat !== 'all' && f.plat !== S.plat) { return false; }
            if (S.q) {
                var raw = S.q.replace(/^@/, '').toLowerCase().trim();
                var terms = raw.split(/\s+/).filter(Boolean);
                var must = terms.filter(function (t) { return t.charAt(0) !== '-'; });
                var excl = terms.filter(function (t) { return t.charAt(0) === '-'; }).map(function (t) { return t.slice(1); }).filter(Boolean);
                var hay = ((f._title || f.title || '') + ' ' + (f.title || '') + ' ' + (f.author || '') + ' ' + (f.authorId || '') + ' ' + f.id + ' ' + f.plat).toLowerCase();
                if (must.length && !must.every(function (w) { return hay.indexOf(w) >= 0; })) { return false; }
                if (excl.length && excl.some(function (w) { return hay.indexOf(w) >= 0; })) { return false; }
            }
            return true;
        });
    }
    function sorted(rows) {
        var out = rows.slice();
        /* S.sort 必须由 #sort 的 change 事件写入。原来 S.sort 初始就是 'new'，
         * `S.sort || select.value` 永远短路到 'new'，切 A-Z/大小都没反应。 */
        var s = S.sort || 'new';
        var tie = function (a, b) { return String(a.relPath || '').localeCompare(String(b.relPath || '')); };
        out.sort(function (a, b) {
            var d = 0;
            if (s === 'old') { d = (a.savedAt || '').localeCompare(b.savedAt || ''); }
            else if (s === 'size') { d = (b.size || 0) - (a.size || 0); }
            else if (s === 'name') {
                /* 重命名写的是 displayName；卡片显示 _title，排序也必须用它，
                 * 否则改了名但 A-Z 仍按旧物理文件名排。 */
                d = String(a._title || a.title || '').localeCompare(String(b._title || b.title || ''), 'zh');
            }
            else { d = (b.savedAt || '').localeCompare(a.savedAt || ''); }
            return d || tie(a, b);
        });
        return out;
    }

    /* ---------- 侧栏编号树 ---------- */
    /** 平台显示名：字典里有的用中文名，没有的（新站点）直接用 key 本身 */
    function platLabel(key) {
        var d = PLAT[key];
        if (d) { return d.name; }
        return key || '网页';
    }

    /**
     * 「网页」类站点按域名分组。
     * 白名单平台（B站/YouTube/小红书…）保持单节点；
     * 其他站点不写死——用库里已存的站点标识（creatorFull / relPath 第二段）聚合，
     * 这样 pixabay、知乎、花瓣、任何新站点都会自动出现在左侧，无需改代码。
     */
    function webSiteOf(f) {
        var c = String(f.author || '').trim();
        if (c && c !== '—') { return c; }
        var segs = String(f.relPath || '').split('/');
        if (segs.length > 2 && segs[1] === '其他网页') { return segs[2] || ''; }
        return '';
    }

    function buildTree() {
        var c = counts();
        var keys = Object.keys(c.platforms).filter(function (k) { return k !== 'untracked'; })
            .sort(function (a, b) { return c.platforms[b] - c.platforms[a]; });
        var rows = [{ kind: 'root', label: '全部资源', count: c.all }];
        /* 「未整理」是入口不是平台：固定放在「全部资源」下面，点击直接筛出来。 */
        if (c.platforms.untracked) {
            rows.push({ kind: 'untracked', label: '未整理', count: c.platforms.untracked });
        }
        var pi = 0;
        keys.forEach(function (p) {
            pi++;
            var num = pad(pi);
            rows.push({ kind: 'plat', key: p, label: platLabel(p), count: c.platforms[p], num: num });
            var creators = {};
            FILES.forEach(function (f) {
                if (f.plat !== p) { return; }
                var name = (p === 'web') ? webSiteOf(f) : f.author;
                if (!name) { return; }
                creators[name] = (creators[name] || 0) + 1;
            });
            var ck = Object.keys(creators).sort(function (a, b) { return creators[b] - creators[a]; });
            ck.forEach(function (name, i) {
                /* web 的二级节点是「站点」，用 data-site 区分于作者节点 */
                rows.push({
                    kind: 'author', plat: p, label: name, count: creators[name],
                    num: num + '·' + (i + 1), site: (p === 'web')
                });
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
                return '<button class="tree-node' + (S.plat === 'all' ? ' active' : '') + '" style="--pct:' + pct + '%">' +
                    '<span class="ix">00</span><span class="label">' + esc(t.label) + '</span>' +
                    '<span class="count">' + c.all + '</span></button>';
            }
            if (t.kind === 'untracked') {
                return '<button class="tree-node plat untracked' + (S.plat === 'untracked' ? ' active' : '') + '" data-plat="untracked" style="--pct:' + pct + '%;--pc:' + PLAT.untracked.dot + '">' +
                    '<span class="ix">--</span><span class="label">' + esc(t.label) + '</span>' +
                    '<span class="count">' + t.count + '</span></button>';
            }
            if (t.kind === 'plat') {
                var open = !!treeOpen[t.key] || !!q;
                return '<button class="tree-node plat' + (S.plat === t.key ? ' active' : '') + '" data-plat="' + esc(t.key) + '" style="--pct:' + pct + '%;--pc:' + (PLAT[t.key] || PLAT.web).dot + '">' +
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
        /* 网页类素材的角标显示真实站点名（pixabay / zhihu …），
         * 而不是一律「网页」——否则一堆不同站点在卡片上长得一模一样。 */
        var badgeLabel = p.label;
        if (f.plat === 'web') {
            var site = webSiteOf(f);
            if (site) { badgeLabel = site.replace(/^\.+|\.+$/g, '').slice(0, 18); }
        }
        var corner = isV ? (f.dur || '') : (isA ? f.ext : (isAu ? f.ext : ''));
        var icon = isV ? 'i-film' : (isA ? 'i-repeat-1' : (isAu ? 'i-volume-2' : 'i-image'));
        var tags = (f.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
        return '<article class="card' + (S.sel.has(f.id) ? ' selected' : '') + '" data-id="' + esc(f.id) + '" tabindex="0">' +
            '<div class="thumb' + (isV ? ' is-video' : '') + (isA ? ' is-anim' : '') + (isAu ? ' is-audio' : '') + '">' +
            '<div class="cover" style="--h:' + f.h + '"><span class="fig"><svg class="i"><use href="#' + icon + '"/></svg></span></div>' +
            '<img alt="" loading="lazy" data-thumb="' + esc(f.relPath) + '">' +
            '<span class="badge"><span class="dot" style="--pc:' + p.dot + '"></span>' + esc(badgeLabel) + '</span>' +
            (corner ? '<span class="duration' + (isA ? ' anim' : '') + '">' + esc(corner) + '</span>' : '') +
            (f.state === 'missing' ? '<span class="missing-tag">文件缺失</span>' : '') +
            (f.isRef ? '<span class="ref-tag" title="内容与另一条素材相同，物理文件只存一份">引用</span>' : '') +
            '<div class="playbtn"><span><svg class="i"><use href="#i-' + (isV || isA || isAu ? 'play' : 'maximize') + '"/></svg></span></div>' +
            '</div>' +
            '<div class="body">' +
            '<div class="title">' + esc(f._title || f.title) + '</div>' +
            '<div class="metarow">' +
            '<span class="authorline"><span class="avatar">' + esc((f.author || '?').slice(0, 1)) + '</span>' +
            '<span class="nm">' + esc(f.author || '未知来源') + '</span></span>' +
            '<span class="size">' + fmt(f.size) + '</span>' +
            '</div>' +
            '<span class="platcell" style="--pc:' + p.dot + '">' + esc(badgeLabel) + '</span>' +
            '<span class="timecell">' + esc(shortDate(f.savedAt)) + '</span>' +
            (tags ? '<div class="tagrow">' + tags + '</div>' : '') +
            '</div>' +
            '<input type="checkbox" class="selbox" aria-label="选择此素材"' + (S.sel.has(f.id) ? ' checked' : '') + '>' +
            '</article>';
    }

    /* ---------- 空态 ---------- */
    function renderEmpty(n, over) {
        var el = $('#empty');
        if (!el) { return; }
        if (n > 0) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        var v = over || {};
        var filtering = (v.filtering != null) ? !!v.filtering : !!(S.q || S.type !== 'all' || S.plat !== 'all');
        var noData = (v.noData != null) ? !!v.noData : (FILES.length === 0);
        /* 三种空态要给不同出路：授权没做好时让用户去点「扫描」只会一直失败，
         * 必须先告诉他去授权（2026-11-06 UX 审查 P1-8）。 */
        var unauth = (v.unauth != null) ? !!v.unauth : !!(window.__vrPerm && !window.__vrPerm.handle);
        var ico = function (h) { var i = $('#emptyIco'); if (i) { i.innerHTML = '<svg class="i"><use href="#' + h + '"/></svg>'; } };
        var title = $('#emptyTitle'), text = $('#emptyText'), act = $('#emptyAction');
        if (noData && unauth) {
            ico('i-folder');
            title.textContent = '还没有授权素材目录';
            text.innerHTML = '资源库需要先拿到一个本地文件夹的读写权限。<br>授权后这里会显示已有素材，之后下载的东西也会自动进来。';
            act.textContent = '授权素材目录'; act.dataset.act = 'auth';
        } else if (noData) {
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
    var PAGE = 120;          // 小库：首屏铺这么多，滚动再追加
    /* 大库阈值：超过就转窗口化渲染（只保留可视区附近的行），
     * 否则 5 万条会堆出 60 万 DOM 节点、布局 3 秒以上。 */
    var WIN_THRESHOLD = 300;
    var WIN_OVERSCAN = 2;    // 可视区上下各多渲染 2 行，滚动不闪白

    var win = {
        on: false,
        cols: 4,
        rowH: 0,
        start: 0,
        end: 0,
        totalRows: 0
    };

    /** 当前 grid 的实际列数（读 computedStyle，兼容响应式断点） */
    function gridCols(grid) {
        var tpl = String(getComputedStyle(grid).gridTemplateColumns || '');
        var n = tpl.split(' ').filter(Boolean).length;
        return n > 0 ? n : 1;
    }

    /** 测一行的高度：渲染完第一行后量卡片外框 */
    function measureRowH(grid) {
        var first = grid.querySelector('.card');
        if (!first) { return 0; }
        var r = first.getBoundingClientRect();
        if (!r.height) { return 0; }
        var gap = parseFloat(getComputedStyle(grid).rowGap || '0') || 0;
        return r.height + gap;
    }

    /** 窗口化：只渲染 [startRow, endRow) 的行，用 padding 撑起总高度 */
    function paintWindow() {
        var grid = $('#grid');
        var rows = S.rows || [];
        if (!grid || !rows.length || !win.on) { return; }
        var total = win.totalRows;
        var start = Math.max(0, win.start);
        var end = Math.min(total, win.end);
        var from = start * win.cols;
        var to = Math.min(rows.length, end * win.cols);
        grid.innerHTML = rows.slice(from, to).map(card).join('');
        /* padding 用 px 撑高度：5 万条×12 行会到 160 万 px，超出 Chrome 的
         * 布局可靠范围（约 33M px 才硬上限，但取整误差会累积成滚动跳动）。
         * 这里按整像素取整并夹住，滚动位置靠 window 重算，不依赖 padding 精确。 */
        var PAD_MAX = 2000000;
        var pt = Math.min(PAD_MAX, Math.round(start * win.rowH));
        var pb = Math.min(PAD_MAX, Math.round(Math.max(0, (total - end)) * win.rowH));
        grid.style.paddingTop = pt + 'px';
        grid.style.paddingBottom = pb + 'px';
        observeThumbs();
    }

    /** 根据滚动位置重算窗口；滚动时只在跨行时重绘 */
    function updateWindow(force) {
        if (!win.on) { return; }
        var grid = $('#grid');
        if (!grid) { return; }
        var top = grid.getBoundingClientRect().top;
        var viewH = window.innerHeight || 800;
        var firstRow = Math.floor((-top) / win.rowH);
        var visibleRows = Math.ceil(viewH / win.rowH) + 1;
        var start = Math.max(0, firstRow - WIN_OVERSCAN);
        var end = Math.min(win.totalRows, firstRow + visibleRows + WIN_OVERSCAN);
        if (!force && start === win.start && end === win.end) { return; }
        win.start = start;
        win.end = end;
        paintWindow();
    }

    /** 首屏骨架：boot() 串行等 favs→root→perm→load 约 2 秒，期间先铺占位卡片。
     *  render() 一跑就整体替换，不会残留。 */
    function renderSkeleton(n) {
        var grid = $('#grid');
        if (!grid) { return; }
        var count = Math.max(4, Math.min(12, Number(n) || 8));
        var one = '<div class="sk"><div class="sk-cover"></div><div class="sk-line"></div><div class="sk-line short"></div></div>';
        grid.className = 'grid loading';
        grid.innerHTML = new Array(count + 1).join(one);
    }

    function render() {
        var rows = sorted(filtered());
        S.list = rows;
        S.rows = rows;
        var grid = $('#grid');
        grid.classList.remove('loading');
        grid.className = 'grid' + (S.view === 'list' ? ' list' : '') + (S.select ? ' selecting' : '');

        /* 小库：保持原路径（一次铺满，滚动追加），行为与以前完全一致 */
        if (rows.length <= WIN_THRESHOLD) {
            win.on = false;
            grid.style.paddingTop = '';
            grid.style.paddingBottom = '';
            S.shown = Math.min(PAGE, rows.length);
            grid.innerHTML = rows.slice(0, S.shown).map(card).join('');
        } else {
            /* 大库：先量列数/行高，再按窗口画 */
            win.on = true;
            win.cols = gridCols(grid);
            win.totalRows = Math.ceil(rows.length / win.cols);
            grid.style.paddingTop = '0px';
            grid.style.paddingBottom = '0px';
            if (!win.rowH) { win.rowH = 260; }       // 首次给个估值，画完立刻校正
            win.start = 0;
            win.end = Math.min(win.totalRows, Math.ceil((window.innerHeight || 800) / win.rowH) + WIN_OVERSCAN);
            paintWindow();
            var measured = measureRowH(grid);
            if (measured > 0 && Math.abs(measured - win.rowH) > 2) {
                win.rowH = measured;
                updateWindow(true);
            }
            S.shown = rows.length;
        }
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
        renderDedupStat(rows);
        setTxt('#treeTotal', FILES.length);
        setTxt('#batchCount', '已选 ' + S.sel.size + ' 项');

        $$('#typeTabs button').forEach(function (b) {
            var t = b.dataset.type;
            var n = t === 'all' ? FILES.length : (c[t] || 0);
            var badge = b.querySelector('b'); if (badge) { badge.textContent = n; }
        });
        renderFavs();
    }

    /* ---------- F7 分级加载（虚拟滚动轻量版） ---------- */
    function appendMore() {
        var rows = S.rows || [];
        if (!rows.length || S.shown >= rows.length) { return; }
        var grid = $('#grid');
        if (!grid) { return; }
        var next = Math.min(S.shown + PAGE, rows.length);
        var html = rows.slice(S.shown, next).map(card).join('');
        grid.insertAdjacentHTML('beforeend', html);
        S.shown = next;
        observeThumbs();
    }

    function nearBottom() {
        var grid = $('#grid');
        if (!grid) { return false; }
        var r = grid.getBoundingClientRect();
        return r.bottom - window.innerHeight < 600;
    }

    window.addEventListener('scroll', function () {
        if (win.on) { updateWindow(); return; }
        if (nearBottom()) { appendMore(); }
    }, { passive: true });

    window.addEventListener('resize', function () {
        if (!win.on) { return; }
        var grid = $('#grid');
        if (!grid) { return; }
        win.cols = gridCols(grid);
        win.totalRows = Math.ceil((S.rows || []).length / win.cols);
        var measured = measureRowH(grid);
        if (measured > 0) { win.rowH = measured; }
        updateWindow(true);
    });

    /* ---------- F5 去重统计：逻辑大小 vs 物理占用 ---------- */
    function renderDedupStat(rows) {
        var el = document.getElementById('fDedup');
        if (!el) { return; }
        var byHash = {};
        var logical = 0, physical = 0, refs = 0;
        rows.forEach(function (f) {
            logical += f.size || 0;
            if (f.sha256) {
                if (!byHash[f.sha256]) { byHash[f.sha256] = { size: f.size || 0, n: 0 }; }
                byHash[f.sha256].n++;
                if (f.isRef) { refs++; }
            } else {
                physical += f.size || 0;
            }
        });
        Object.keys(byHash).forEach(function (h) { physical += byHash[h].size; });
        if (!refs) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        el.textContent = '逻辑 ' + Math.round(logical) + ' MB · 物理 ' + Math.round(physical) + ' MB（' + refs + ' 条引用）';
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
    /**
     * 提示条。action 可选：{ label, onClick, ms }
     * 删除后给「撤销」是防丢数据的关键：用户误删时第一反应是找撤销，
     * 只有「回收站」这条暗路的话，新用户会以为文件真没了。
     */
    function toast(msg, action) {
        var el = $('#toast');
        if (!el) { return; }
        var textEl = document.getElementById('toastText');
        var actEl = document.getElementById('toastAct');
        if (textEl) { textEl.textContent = msg; } else { el.textContent = msg; }
        if (actEl) {
            actEl.onclick = null;
            if (action && action.label) {
                actEl.textContent = action.label;
                actEl.hidden = false;
                actEl.onclick = function () {
                    el.classList.remove('on');
                    clearTimeout(toastTimer);
                    try { action.onClick(); } catch (e) { /* 忽略 */ }
                };
            } else {
                actEl.hidden = true;
            }
        }
        el.classList.add('on');
        clearTimeout(toastTimer);
        var ms = (action && action.ms) || (action ? 8000 : 2200);
        toastTimer = setTimeout(function () { el.classList.remove('on'); }, ms);
    }
    window.toast = toast;

    /* ---------- 数据加载 ---------- */
    async function load(retry, recheck) {
        if (!root.VRDB) { return; }
        var list = [];
        try {
            list = await root.VRDB.getAllFiles();
            /* 首屏可能撞上另一个标签正在重建索引：那一刻读到空表，
             * 之后数据回来了却没人再渲染 → 页面永远空白，只能手动重扫。
             * 读空时延迟复查一次，有数据就重新渲染（最多两级，不递归）。 */
            if (!list.length && !recheck) {
                setTimeout(function () {
                    try {
                        root.VRDB.getAllFiles().then(function (again) {
                            if (again && again.length) { load(0, true); }
                        }, function () { /* 仍失败就保持空态 */ });
                    } catch (e2) { /* 忽略 */ }
                }, 900);
            }
        } catch (e) {
            /* 别把读取失败当成「库里没有东西」：一次失败就永久空白，
             * 用户只能手动点重扫才看得到（2026-11-05 实测：4 个标签里 3 个空）。
             * 退避重试 3 次，仍失败才按空库处理。 */
            var n = Number(retry) || 0;
            if (n < 3) { setTimeout(function () { load(n + 1); }, 400 * (n + 1)); return; }
            list = [];
        }
        RAW = {};
        list.forEach(function (e) { RAW[e.relPath] = e; });
        FILES = list.map(toCardModel);
        /* 收藏条目只保留仍在库里的 id；测试夹具/已删除文件不再占收藏夹。 */
        try {
            var changed = false;
            FAVS.forEach(function (fav) {
                var ids = (fav.ids || []).filter(function (id) { return !!RAW[id]; });
                if (ids.length !== (fav.ids || []).length) { fav.ids = ids; changed = true; }
            });
            if (changed) { saveFavs(); }
        } catch (e) { /* 忽略 */ }
        renderTree();
        render();
        renderRoot();
    }

    function renderRoot() {
        var pathEl = $('#rootBtn .rb-path');
        var hintEl = $('#rootBtn .rb-hint');
        if (!pathEl) { return; }
        pathEl.textContent = '正在识别…';
        if (hintEl) { hintEl.textContent = '点击更换目录'; }
        try {
            chrome.storage.local.get('vrLibSettings', function (o) {
                var s = (o && o.vrLibSettings) || {};
                /* 自选文件夹可能没有绝对路径（FSA 只给句柄）：显示授权状态，
                 * 不要退回系统下载目录，也别写「未探测」吓用户。 */
                if (s.mode === 'custom') {
                    var cbase = s.customRoot ? String(s.customRoot).replace(/\//g, '\\') : '';
                    pathEl.textContent = cbase || '自选文件夹（已授权）';
                    pathEl.title = cbase || '浏览器不提供绝对路径，预览走目录授权';
                    return;
                }
                var base = s.detectedRoot ? s.detectedRoot + '\\' + (s.subdir || 'video-rod') : '';
                if (!base) {
                    pathEl.textContent = '系统下载目录\\' + (s.subdir || 'video-rod');
                    pathEl.title = '首次下载时自动创建';
                    return;
                }
                if (base) {
                    base = String(base).replace(/\//g, '\\');   // 统一成 Windows 反斜杠，别显示成 …/Downloads\video-rod
                    pathEl.textContent = base;
                    pathEl.title = base;
                }
            });
        } catch (e) { /* 非扩展环境 */ }
    }

    /* ---------- 全局兜底：别让「目录句柄失效」变成控制台红字 ----------
       陈旧的 FSA 句柄（换档案/换盘）会让 queryPermission / getDirectoryHandle
       抛 "Permissions check failed"。这类错误对用户没有意义，统一翻成一句可操作提示；
       其余异常不吞，照常抛出去（别掩盖真 bug）。 */
    function installGlobalErrorGuard() {
        function isPerm(msg) {
            return /Permissions check failed|not allowed to (read|write)|denied permission/i.test(String(msg || ''));
        }
        window.addEventListener('unhandledrejection', function (e) {
            var m = (e.reason && (e.reason.message || e.reason)) || '';
            if (isPerm(m)) {
                try { toast('目录授权已失效：到设置里重新选一次目录就能继续'); } catch (e2) { /* 忽略 */ }
                e.preventDefault();
            }
        });
        window.addEventListener('error', function (e) {
            if (isPerm(e && e.message)) {
                try { toast('目录授权已失效：到设置里重新选一次目录就能继续'); } catch (e2) { /* 忽略 */ }
            }
        });
    }

    /* ---------- 根目录自动探测（P2 前置） ----------
       根目录从来没被探测过时（vrLibSettings 只有 subdir），库页会一直显示「未探测」，
       索引也没有基准路径 → 容易把整个「下载」目录当成库。这里用最近的下载记录反推
       下载根目录，锁定到 <下载根>/<subdir>，和「校验落盘」算出来的口径一致。
       只写 detectedRoot，不动 mode/customRoot，用户显式设过自定义目录就不插手。 */
    function guessBaseFromDownloads(list, subdir) {
        var want = '/' + String(subdir || 'video-rod') + '/';
        var i;
        for (i = 0; i < list.length; i++) {
            var f = String((list[i] || {}).filename || '').replace(/\\/g, '/');
            var k = f.indexOf(want);
            if (k > 0) { return f.slice(0, k); }       // …/Downloads/video-rod/x → …/Downloads
        }
        // 还没有落在 subdir 里的历史下载：拿最近一条的父目录当下载根
        for (i = 0; i < list.length; i++) {
            var g = String((list[i] || {}).filename || '').replace(/\\/g, '/');
            var dir = g.slice(0, g.lastIndexOf('/'));
            if (dir) { return dir; }
        }
        return '';
    }

    function readLibSettings() {
        return new Promise(function (resolve) {
            try {
                chrome.storage.local.get('vrLibSettings', function (o) {
                    resolve((o && o.vrLibSettings) || {});
                });
            } catch (e) { resolve({}); }
        });
    }

    async function ensureRoot() {
        var s = await readLibSettings();
        if ((s.mode || 'system') === 'custom' && s.customRoot) { return s; }
        if (s.detectedRoot) { return s; }
        var list = await new Promise(function (resolve) {
            try {
                chrome.downloads.search({ limit: 50, orderBy: ['-startTime'] }, function (l) {
                    void chrome.runtime.lastError;
                    resolve(l || []);
                });
            } catch (e) { resolve([]); }
        });
        var base = guessBaseFromDownloads(list, s.subdir || 'video-rod');
        if (!base) { return s; }
        var next = Object.assign({}, s, { detectedRoot: base });
        await new Promise(function (resolve) {
            try { chrome.storage.local.set({ vrLibSettings: next }, function () { resolve(); }); }
            catch (e) { resolve(); }
        });
        return next;
    }

    /* ---------- 首次自动索引 ---------- */
    async function autoIndex() {
        if (!root.VRIndex) { return false; }
        // ① 下载记录模式：**不需要目录授权**，能立刻把已下载的文件收进库。
        //    2026-11-05 事故：这里原来只试 full/snapshot，两者都要 FSA 授权，
        //    没授权就整个失败 → 资源库永远空白，用户看到「管理器里什么都没有」。
        try { await root.VRIndex.build({ mode: 'downloads' }); return true; } catch (e) { /* 落到下一档 */ }
        // ② 全量扫描：需要一次目录授权，好处是能发现「文件已被删」
        try { await root.VRIndex.build({ mode: 'full' }); return true; } catch (e) { /* 落到下一档 */ }
        // ③ 快照：同样是授权后的兜底
        try { await root.VRIndex.build({ mode: 'snapshot' }); return true; }
        catch (e2) { return false; }
    }

    /* ---------- 事件 ---------- */
    /* ---------- 确认框（模块级：bind 与 bindMissing 共用） ----------
     * 原实现把 ask() 定义在 bindMissing() 内部，而 batchTrash 在 bind() 里调用它，
     * 结果是「删除到回收站」点了抛 ReferenceError，界面毫无反应。 */
    var _confirmCb = null;
    function ask(msg, cb) {
        var m = document.getElementById('confirmMask');
        if (!m) { if (cb) { cb(); } return; }
        var t = document.getElementById('confirmMsg');
        if (t) { t.textContent = msg; }
        _confirmCb = cb;
        m.classList.add('show');
    }
    function closeAsk() {
        var m = document.getElementById('confirmMask');
        if (m) { m.classList.remove('show'); }
        _confirmCb = null;
    }
    function bindConfirm() {
        var ok = document.getElementById('confirmOk');
        var cancel = document.getElementById('confirmCancel');
        if (cancel) { cancel.addEventListener('click', closeAsk); }
        if (ok) {
            ok.addEventListener('click', function () {
                var cb = _confirmCb;
                closeAsk();
                if (cb) { cb(); }
            });
        }
    }

    function bind() {
        var tt = $('#typeTabs');
        if (tt) {
            tt.addEventListener('click', function (e) {
                var b = e.target.closest('button'); if (!b) { return; }
                $$('#typeTabs button').forEach(function (x) { x.classList.remove('active'); });
                b.classList.add('active'); S.type = b.dataset.type; render();
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
        if (search) {
            /* 每敲一个字符就全量重渲染：5000 条时实测 64ms/键，连续打字明显掉帧；
             * 中文输入法组字时每个拼音都会触发，更糟。
             * 这里做两件事：① 150ms 防抖；② 组字期间不渲染，compositionend 再补。 */
            var qTimer = 0;
            var composing = false;
            var clearBtn = document.getElementById('searchClear');
            var syncClear = function () {
                if (clearBtn) { clearBtn.hidden = !search.value; }
            };
            var apply = function () {
                clearTimeout(qTimer);
                qTimer = 0;
                S.q = search.value.trim().toLowerCase();
                syncClear();
                render();
            };
            search.addEventListener('compositionstart', function () {
                composing = true;
                clearTimeout(qTimer);
            });
            search.addEventListener('compositionend', function () {
                composing = false;
                apply();
            });
            search.addEventListener('input', function () {
                if (composing) { return; }
                /* 清除按钮即时反映输入内容，不等防抖 */
                syncClear();
                clearTimeout(qTimer);
                /* 后台标签页的 setTimeout 会被浏览器节流到 ~1s，防抖反而变成延迟。
                 * 页面不可见时没有「打字掉帧」问题，直接同步渲染最稳。 */
                if (document.hidden) { apply(); return; }
                qTimer = setTimeout(apply, 150);
            });
            /* 清除按钮：一次点击回到「全部」 */
            if (clearBtn) {
                clearBtn.addEventListener('click', function () {
                    search.value = '';
                    S.q = '';
                    clearTimeout(qTimer);
                    syncClear();
                    render();
                    search.focus();
                });
            }
            /* Esc 清空并立即生效（用户按 Esc 时期望马上看到全部） */
            search.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && search.value) {
                    e.preventDefault();
                    search.value = '';
                    S.q = '';
                    clearTimeout(qTimer);
                    syncClear();
                    render();
                }
            });
            syncClear();
        }
        var sort = $('#sort');
        if (sort) {
            if (sort.value) { S.sort = sort.value; }
            sort.addEventListener('change', function () {
                S.sort = sort.value || 'new';
                render();
            });
        }

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
        /* 批量条「按类型…」：想「只删视频」时不必手点每张卡片。
         * 语义是「在已选基础上追加该类型」，清空选择请用「清除」按钮。 */
        var byType = document.getElementById('batchByType');
        if (byType) {
            byType.addEventListener('change', function () {
                var k = byType.value;
                byType.value = '';
                if (!k) { return; }
                var n = 0;
                S.list.forEach(function (f) {
                    if (f.kind === k) { S.sel.add(f.id); n++; }
                });
                render();
                toast(n ? ('已按类型选中 ' + n + ' 项') : '当前列表里没有这类素材');
            });
        }
        on('batchExit', function () {
            S.select = false; S.sel.clear();
            $('#selectBtn').classList.remove('is-on');
            $('#batchbar').classList.add('hidden'); render();
        });
        on('batchTrash', async function () {
            /* 原实现是「批量删除将在 R5 接入真实回收站」的假按钮，但回收站（js/library/trash.js）
             * 早就做完了 —— 单条删除走的是它，批量却只弹一句提示。这里直接接同一套 API。 */
            if (S.batchBusy) { return; }
            var list = FILES.filter(function (f) { return S.sel.has(f.id); });
            if (!list.length) { toast('先选素材'); return; }
            markWritePending();
            if (!(await ensureWriteAccess())) { return; }
            ask('把选中的 ' + list.length + ' 项移入回收站？文件还能恢复。', async function () {
                if (!root.VRTrash) { toast('回收站模块没加载'); return; }
                /* 批量操作期间锁住按钮：没有进行中状态时用户会以为卡死并重复点击，
                 * 结果弹出多个确认框、重复删除同一批。 */
                S.batchBusy = true;
                var btn = document.getElementById('batchTrash');
                if (btn) { btn.disabled = true; }
                try {
                    toast('正在移入回收站 0/' + list.length + '…', { ms: 600000 });
                    /* 逐条拿结果：批量里有些是「文件已不存在」被清理（cleaned），
                     * 不该混进「已删除 N 项」里虚报。 */
                    var rr = await root.VRTrash.remove(list.map(function (f) { return f.relPath; }), {
                        onProgress: function (p) {
                            if (!p) { return; }
                            if (p.done === 1 || p.done % 5 === 0 || p.done === p.total) {
                                toast('正在移入回收站 ' + p.done + '/' + p.total + '…', { ms: 600000 });
                            }
                        }
                    });
                    S.sel.clear(); S.select = false;
                    await load();
                    var movedN = (rr && rr.moved) || 0;
                    var failedN = (rr && rr.failed && rr.failed.length) || 0;
                    var msg = '已移入回收站：' + movedN + ' 项';
                    if (failedN) {
                        /* 失败不能只说个数：用户不知道是哪几条，也就无从处理。 */
                        var names = (rr.failed || []).slice(0, 2).map(function (x) {
                            return String(x.relPath || '').split('/').pop();
                        }).filter(Boolean);
                        msg += '，失败 ' + failedN + ' 项' + (names.length ? '（' + names.join('、') + (failedN > 2 ? ' 等' : '') + '）' : '');
                    }
                    if (rr && rr.batch && movedN > 0) {
                        toast(msg, {
                            label: '撤销', ms: 8000,
                            onClick: async function () {
                                try {
                                    await root.VRTrash.restore(rr.batch);
                                    toast('已撤销删除（' + movedN + ' 项）');
                                    await load(); await refreshDrawer();
                                } catch (e2) { toast('撤销失败：' + ((e2 && e2.message) || '未知')); }
                            }
                        });
                    } else {
                        toast(msg);
                    }
                } catch (e) {
                    toast('批量删除失败：' + ((e && e.message) || '未知'));
                } finally {
                    S.batchBusy = false;
                    if (btn) { btn.disabled = false; }
                }
            });
        });

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
                if (!n.dataset.plat && !n.dataset.author) {
                    /* 根节点「全部资源」：之前只加 active 不重置筛选，点了等于没点 */
                    S.q = ''; S.plat = 'all'; S.type = 'all';
                    if ($('#search')) { $('#search').value = ''; }
                    $$('#typeTabs button').forEach(function (x) {
                        x.classList.toggle('active', x.dataset.type === 'all');
                    });
                    render();
                    return;
                }
                if (n.dataset.plat) {
                    var p = n.dataset.plat;
                    treeOpen[p] = !treeOpen[p];
                    /* 左侧平台节点也是筛选入口：旧代码只展开/收起，不写 S.plat，
                     * 用户点平台看起来毫无反应（只有顶部 chip 能筛）。 */
                    S.plat = (S.plat === p) ? 'all' : p;
                    S.q = '';
                    if ($('#search')) { $('#search').value = ''; }
                    render();
                    renderTree();
                    return;
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
            /* 重扫后必须把筛选条件清掉并重新渲染，否则旧关键词/平台还挂着，
             * 用户以为「没导入」，其实刷新页面（筛选重置）才看得见。 */
            S.q = ''; S.plat = 'all'; S.type = 'all';
            if ($('#search')) { $('#search').value = ''; }
            $$('#typeTabs button').forEach(function (x) { x.classList.toggle('active', x.dataset.type === 'all'); });
            await load();
            toast(ok ? '扫描完成：' + FILES.length + ' 项已刷新' : '扫描失败：未授权目录');
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
                if (act === 'auth') {
                    var okA = await ensureWriteAccess();
                    if (okA) { await autoIndex(); await load(); }
                    return;
                }
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

    /** 「定位」统一入口。
     *  有绝对路径：交给系统打开所在文件夹（downloads.show 优先，其次 file://）。
     *  没有绝对路径：自选文件夹模式下浏览器不提供绝对路径，这不是错误，
     *  但原来只回一句「没有本地路径，无法定位」，用户既不知道原因也不知道能做什么。
     *  这里说清原因，并给一个立刻可用的替代动作（复制相对路径）。 */
    function revealFile(f) {
        if (!f) { return; }
        var abs = String(f.absPath || '').trim();
        var openFolder = function (folder) {
            var url = '';
            try {
                url = root.VRPath && root.VRPath.toFileUrl
                    ? root.VRPath.toFileUrl(folder)
                    : ('file:///' + folder.split(String.fromCharCode(92)).join('/'));
                if (url.charAt(url.length - 1) !== '/') { url += '/'; }
            } catch (e) { toast('路径无法打开：' + ((e && e.message) || '未知')); return; }
            try {
                if (chrome.tabs && chrome.tabs.create) {
                    chrome.tabs.create({ url: url }, function () {
                        if (chrome.runtime.lastError) { window.open(url, '_blank'); }
                    });
                } else { window.open(url, '_blank'); }
                toast('已打开所在文件夹');
            } catch (e) { toast('打开路径失败：' + ((e && e.message) || '未知')); }
        };

        /* 有 downloadId 就先让浏览器自己定位，最准 */
        if (f.downloadId != null && chrome.downloads && chrome.downloads.show) {
            try { chrome.downloads.show(f.downloadId); toast('已在文件夹中定位'); return; } catch (e) { /* 回退 */ }
        }
        if (abs) {
            openFolder(abs.replace(new RegExp('[' + String.fromCharCode(92) + '/][^' + String.fromCharCode(92) + '/]+$'), ''));
            return;
        }
        /* 走不通时给可操作出路，而不是一句结论 */
        toast('这条素材没记录绝对路径（自选文件夹模式浏览器不提供），可用「复制相对路径」自己找', {
            label: '复制路径', ms: 10000,
            onClick: function () {
                var rel = String(f.relPath || '');
                if (!rel) { toast('这条没有路径信息'); return; }
                var done = function () { toast('已复制：' + rel); };
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(rel).then(done, function () { toast(rel); });
                    } else { toast(rel); }
                } catch (e) { toast(rel); }
            }
        });
    }

    /* ---------- M5：只读 / 授权状态 ---------- */
    function rootBaseName(absRoot) {
        var p = String(absRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        var segs = p.split('/').filter(Boolean);
        return segs.length ? segs[segs.length - 1] : '';
    }
    function rootParentName(absRoot) {
        var p = String(absRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        var segs = p.split('/').filter(Boolean);
        return segs.length >= 2 ? segs[segs.length - 2] : '';
    }

    /** 选择一个真正指向当前库根的目录（video-rod），并写入句柄。 */
    async function authorizeRoot() {
        if (typeof root.showDirectoryPicker !== 'function') {
            toast('此浏览器不支持目录授权，请到完整设置页操作');
            return false;
        }
        /* 先弹选择器，再做异步读取：目录选择要求用户手势，
         * 中间插太多 await 会丢掉 transient activation。 */
        var h = null;
        try {
            h = await root.showDirectoryPicker({ mode: 'readwrite' });
        } catch (e) {
            if (e && e.name === 'AbortError') { return false; }
            toast('授权失败：' + ((e && e.message) || e));
            return false;
        }
        var rr = null;
        try { rr = await root.VRIndex.resolveRoot(); } catch (e) { rr = null; }
        var expected = rr && rr.absRoot ? rootBaseName(rr.absRoot) : '';
        var parent = rr && rr.absRoot ? rootParentName(rr.absRoot) : '';
        if (expected && h.name !== expected) {
            var child = null;
            try { child = await h.getDirectoryHandle(expected); } catch (e2) { child = null; }
            if (!child && parent && h.name === parent) {
                try { child = await h.getDirectoryHandle(expected, { create: true }); }
                catch (e3) { child = null; }
            }
            if (!child) {
                toast('请选择「' + expected + '」文件夹' + (parent ? ('，或它的上级「' + parent + '」') : ''));
                return false;
            }
            h = child;
        }
        try {
            await root.VRIndex.setRoot(h, rr && rr.absRoot, rr && rr.prefix);
        } catch (e) {
            toast('写入授权失败：' + ((e && e.message) || e));
            return false;
        }
        toast('已授权素材目录');
        try { await refreshPermState(); } catch (e) { /* 忽略 */ }
        return true;
    }

    /** 写操作前的统一入口：能用原句柄恢复就恢复，否则直接弹目录选择。 */
    /** 写操作前先给一句明确反馈：无授权时系统目录框会弹出来，
     *  用户不知道发生了什么就容易判定「按钮坏了」。 */
    function markWritePending() {
        if (window.__vrPerm && window.__vrPerm.writable) { return; }
        toast('需要素材目录写权限：请在系统对话框里选择 video-rod 文件夹');
    }

    async function ensureWriteAccess() {
        if (window.__vrPerm && window.__vrPerm.writable) { return true; }
        var p = window.__vrPerm;
        if (p && p.handle && !p.rootInvalid && p.permState === 'prompt') {
            try {
                var st = await p.handle.requestPermission({ mode: 'readwrite' });
                if (st === 'granted') {
                    var rr0 = await root.VRIndex.resolveRoot();
                    await root.VRIndex.setRoot(p.handle, rr0.absRoot, rr0.prefix);
                    toast('已恢复写入权限');
                    await refreshPermState();
                    return true;
                }
            } catch (e) { /* 落到重新选择 */ }
        }
        /* 关键：走到这里说明自动恢复失败（常见于权限被浏览器收回后又拒绝，
         * 或 requestPermission 在无用户手势时被拒）。必须弹目录选择，
         * 并且无论成败都要给提示 —— 否则用户点「删除/移动」只会看到毫无反应。 */
        var ok = false;
        try { ok = await authorizeRoot(); } catch (e2) { ok = false; }
        if (!ok) {
            toast('需要先授权素材目录：点顶部横幅「恢复写入」，或右侧「授权素材目录」');
            var banner = $('#permBanner');
            if (banner) { banner.classList.remove('hidden'); }
        }
        return ok;
    }

    async function refreshPermState() {
        var banner = $('#permBanner'), txt = $('#permText'), auth = $('#permAuth');
        var rr = null;
        try { if (root.VRIndex && root.VRIndex.resolveRoot) { rr = await root.VRIndex.resolveRoot(); } } catch (e) { rr = null; }
        var handle = rr && rr.handle ? rr.handle : null;
        var expectedName = rr && rr.absRoot ? rootBaseName(rr.absRoot) : '';
        var rootInvalid = !!(handle && expectedName && handle.name !== expectedName);
        var writable = false;
        var permState = '';
        if (handle && !rootInvalid) {
            if (typeof handle.queryPermission !== 'function') { writable = true; permState = 'granted'; }
            else {
                try {
                    permState = await handle.queryPermission({ mode: 'readwrite' });
                    writable = permState === 'granted';
                } catch (e) { writable = false; permState = 'error'; }
            }
        }
        var fileAccess = true;
        try {
            if (chrome.extension && chrome.extension.isAllowedFileSchemeAccess) {
                fileAccess = await new Promise(function (res) {
                    chrome.extension.isAllowedFileSchemeAccess(function (v) { res(!!v); });
                });
            }
        } catch (e) { fileAccess = true; }

        var issues = [];
        if (!writable) {
            issues.push(rootInvalid
                ? ('当前授权句柄指向「' + (handle && handle.name) + '」，不是「' + expectedName + '」；点「重新授权」选择正确的素材库根目录。')
                : (handle
                    ? (permState === 'prompt'
                        ? '已选过素材目录，但浏览器在刷新后收回了写入权限，当前为只读；点「恢复写入」即可，不用重新选目录。'
                        : '素材目录当前不可写：点「恢复写入」重新授权；浏览/预览仍可用。')
                    : '当前为只读模式：浏览/预览可用；点「授权素材目录」选择素材库根目录。'));
        }
        if (!fileAccess) {
            issues.push('浏览器未允许访问本地文件，缩略图/预览可能失败；请在扩展详情打开「允许访问文件网址」。');
        }
        if (banner) { banner.classList.toggle('hidden', issues.length === 0); }
        if (txt) { txt.textContent = issues.join(' '); }
        if (auth) {
            auth.textContent = writable ? '查看设置' : (rootInvalid ? '重新授权' : (handle ? '恢复写入' : '授权素材目录'));
            auth.title = writable ? '打开设置'
                : (rootInvalid ? ('当前句柄是「' + (handle && handle.name) + '」，需要重新选择「' + expectedName + '」')
                    : (handle ? '沿用已选目录，重新申请写入权限' : '选择素材库根目录并授权读写'));
        }

        /* 写操作按钮不再置灰：点击时会先走 ensureWriteAccess（恢复权限/弹目录选择），
         * 置灰等于「点了没反应」，正是用户反馈的删除/移动按钮失效。 */
        ['batchMove', 'batchTrash', 'pvDelete', 'pvMove'].forEach(function (id) {
            var b = document.getElementById(id);
            if (b) { b.disabled = false; b.removeAttribute('title'); }
        });
        try {
            window.__vrPerm = {
                handle: handle, writable: writable, permState: permState,
                fileAccess: fileAccess, issues: issues,
                rootInvalid: rootInvalid, expectedName: expectedName
            };
        } catch (e) { /* 忽略 */ }
    }

    window.addEventListener('focus', function () { refreshPermState(); });

    /* ---------- 预览（R5 接入真实查看器，当前提示） ---------- */
    function openPreview(f) {
        if (!f) { return; }
        if (root.VRPreview && root.VRPreview.open) { root.VRPreview.open(f, S.list); return; }
        toast('预览器 R5 接入中');
    }

    /* ---------- 卡片右键菜单（VRCtxMenu 接线） ---------- */
    /* 复用已有实现：重命名 openRename / 移动 VRMovePicker / 删除确认 ask
     * 都在 bindMissing 的闭包里，所以这里只注册回调，具体函数在 bindMissing 内注入。 */
    var ctxHooks = null;
    function initCtxMenu(hooks) {
        ctxHooks = hooks;
        if (!root.VRCtxMenu) { return; }
        root.VRCtxMenu.init({
            toast: toast,
            find: function (id) { return FILES.find(function (f) { return f.id === id; }) || null; },
            list: function () { return S.list; },
            preview: function (f) { openPreview(f); },
            rename: function (f) { if (ctxHooks && ctxHooks.rename) { ctxHooks.rename(f); } },
            move: async function (f) {
                if (!root.VRMovePicker) { toast('移动模块没加载，请刷新页面'); return; }
                if (typeof ensureWriteAccess === 'function' && !(await ensureWriteAccess())) { return; }
                root.VRMovePicker.open([f], moveHooks());
            },
            reveal: function (f) { if (ctxHooks && ctxHooks.reveal) { ctxHooks.reveal(f); } },
            fav: async function (f) {
                if (hasFavorite(f.relPath)) {
                    var fav = FAVS.filter(function (x) { return x.sys !== 'star'; })[0];
                    if (fav) {
                        fav.ids = (fav.ids || []).filter(function (id) { return id !== f.relPath; });
                        saveFavs(); renderFavs(); render();
                        toast('已取消收藏');
                    }
                    return;
                }
                addToDefault(f.relPath);
                renderFavs(); render();
                toast('已加入收藏');
            },
            star: async function (f) {
                if (root.VRFav && typeof root.VRFav.toggleStar === 'function') {
                    var next = await root.VRFav.toggleStar(f.relPath);
                    f.starred = !!next;
                    render();
                    toast(next ? '已加星标' : '已取消星标');
                }
            },
            remove: function (f) { if (ctxHooks && ctxHooks.remove) { ctxHooks.remove(f); } }
        });
    }

    /* ---------- 收藏夹（R6：真实持久化，收藏夹只记 id 不动物理文件） ---------- */
    var FAVS = [];

    async function loadFavs() {
        try {
            var v = await root.VRDB.getSetting('vrFavs', []);
            FAVS = Array.isArray(v) ? v.filter(function (f) { return f && f.sys !== 'star'; }) : [];
        } catch (e) { FAVS = []; }
        /* 用户 2026-11-06：收藏夹只需要一个，分类交给标签。
         * 旧测试/误操作留下的多个文件夹合并到第一个，避免侧栏继续膨胀。 */
        if (FAVS.length > 1) {
            var keep = FAVS[0];
            keep.name = '收藏';
            keep.ids = keep.ids || [];
            FAVS.slice(1).forEach(function (f) {
                (f.ids || []).forEach(function (id) {
                    if (keep.ids.indexOf(id) < 0) { keep.ids.push(id); }
                });
            });
            FAVS = [keep];
            saveFavs();
        }
    }
    function saveFavs() {
        try {
            /* setSetting 是异步的：这里原来只 catch 同步异常，
             * 真正的写失败（配额满/库被关）会变成未处理的 rejection，
             * 用户加完收藏刷新一下全没了，且控制台什么都没有。 */
            var r = root.VRDB.setSetting('vrFavs', FAVS);
            if (r && typeof r.then === 'function') {
                r.then(null, function (e) {
                    console.warn('[favs] 保存收藏夹失败：', e && e.message);
                    toast('收藏夹保存失败，刷新后可能丢失');
                });
            }
        } catch (e) {
            console.warn('[favs] 保存收藏夹异常：', e && e.message);
            toast('收藏夹保存失败，刷新后可能丢失');
        }
    }
    /** 按 id 找收藏夹；`fav-star` 是虚拟的「已加星标」夹，不在 FAVS 里。 */
    function findFav(id) {
        if (!id) { return null; }
        if (id === 'fav-star') { return { id: 'fav-star', name: '已加星标', sys: 'star' }; }
        for (var i = 0; i < FAVS.length; i++) {
            if (FAVS[i].id === id) { return FAVS[i]; }
        }
        return null;
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
        /* 底部「收藏夹」按钮的计数 = 收藏夹里的条目数。
         * 原来这里写的是「星标数」，按钮文字却是「收藏夹」，
         * 用户看到的数字和点进去的内容对不上（2026-11-06 反馈）。 */
        var cnt = $('#favSideCnt');
        if (cnt) {
            var seen = {};
            FAVS.forEach(function (fav) {
                if (fav.sys === 'star') { return; }
                (fav.ids || []).forEach(function (id) { seen[id] = 1; });
            });
            cnt.textContent = Object.keys(seen).length;
        }
    }
    function oneFav() {
        var fav = FAVS.filter(function (f) { return f.sys !== 'star'; })[0];
        if (!fav) {
            fav = { id: 'fav-default', name: '收藏', ids: [] };
            FAVS = [fav];
        }
        fav.name = '收藏';
        fav.ids = fav.ids || [];
        return fav;
    }
    function addToFav(ids) {
        if (!ids || !ids.length) { toast('先选素材'); return; }
        var fav = oneFav();
        ids.forEach(function (id) { if (fav.ids.indexOf(id) < 0) { fav.ids.push(id); } });
        saveFavs(); renderFavs(); render();
        toast('已加入收藏');
    }
    function hasFavorite(relPath) {
        var fav = FAVS.filter(function (f) { return f.sys !== 'star'; })[0];
        return !!(fav && (fav.ids || []).indexOf(relPath) >= 0);
    }
    function addToDefault(relPath) {
        if (!relPath) { return false; }
        var fav = oneFav();
        var i = fav.ids.indexOf(relPath);
        if (i >= 0) {
            fav.ids.splice(i, 1);
            saveFavs(); renderFavs(); render();
            toast('已取消收藏');
            return false;
        }
        fav.ids.push(relPath);
        saveFavs(); renderFavs(); render();
        toast('已收藏');
        return true;
    }

    /** 详情页收藏按钮：切换星标，返回 0/1；页面与库页共用同一份 DB 字段。 */
    async function toggleStar(relPath) {
        var row = null;
        for (var i = 0; i < FILES.length; i++) {
            if (FILES[i].id === relPath) { row = FILES[i]; break; }
        }
        if (!row) { return 0; }
        var next = row.starred ? 0 : 1;
        try {
            await root.VRDB.patchFile(relPath, { starred: next });
        } catch (e) {
            toast('收藏失败：' + (e && e.message || '数据库不可写'));
            return row.starred ? 1 : 0;
        }
        row.starred = !!next;
        if (RAW[relPath]) { RAW[relPath].starred = next; }
        renderFavs();
        render();
        toast(next ? '已收藏' : '已取消收藏');
        return next;
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
        /* 计数徽标不再写死初值：为空时整块隐藏，避免首帧闪一个错误数字。 */
        var dcnt = document.getElementById('dwCnt');
        if (dcnt) {
            dcnt.textContent = tc;
            dcnt.hidden = !tc;
        }
        var tcnt = document.getElementById('trashCnt');
        if (tcnt) {
            tcnt.textContent = tc;
            tcnt.hidden = !tc;
        }
    }

    async function doScan() {
        toast('正在扫描目录…');
        var ok = await autoIndex();
        await load();
        await refreshDrawer();
        toast(ok ? '扫描完成：' + FILES.length + ' 项' : '扫描失败：未授权目录');
    }

    /* ---------- 回收站（S5 完整版） ----------
     * 后端 VRTrash 早就齐了（remove/list/restore/purge/empty/preflightRestore），
     * 但抽屉只渲染了「名字 + 恢复」两样东西，单条彻底删除 purge 压根没有入口。
     * 这里把它做成一个能真正用的回收站：
     *   · 按批次分组显示（同一批删除的时间最有用）
     *   · 缩略图 + 文件名 + 相对路径 + 体积
     *   · 搜索过滤（删多了靠肉眼翻不现实）
     *   · 单条恢复 / 单条彻底删除
     *   · 多选：恢复所选 / 彻底删除所选 / 全选
     * 所有破坏性操作都先确认；彻底删除额外说明「不可恢复」。 */

    /* 抽屉的临时状态。不持久化：每次打开都从磁盘清单重建，
     * 避免 UI 状态和实际文件长期不一致。 */
    var TR = { batches: [], q: '', picked: {}, busy: false };

    function trSize(bytes) {
        var n = Number(bytes) || 0;
        var mb = n / 1048576;
        return fmt(mb);
    }

    function trGroupLabel(at, batch) {
        var d = new Date(Number(at) || 0);
        var today = new Date();
        var sameDay = d.toDateString() === today.toDateString();
        var y = new Date(today.getTime() - 86400000);
        var yest = d.toDateString() === y.toDateString();
        var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
        if (sameDay) { return '今天 ' + hm; }
        if (yest) { return '昨天 ' + hm; }
        if (!at) { return batch || ''; }
        return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm;
    }

    /* 缩略图：只有图片/视频才值得解码；视频用容器占位（回收站里取首帧成本太高）。 */
    function trThumb(it) {
        var ext = String(it.ext || it.relPath.split('.').pop() || '').toLowerCase();
        var isImg = /^(jpg|jpeg|png|webp|gif|bmp|avif|heic|heif)$/.test(ext);
        var isVid = it.kind === 'video' || /^(mp4|mov|webm|mkv)$/.test(ext);
        if (isImg) {
            /* 文件已经搬进回收站，原相对路径不再可直接访问；
             * 统一给图标占位，避免一次开几十个会 404 的请求。 */
            return '<div class="dw-thumb"><svg class="i"><use href="#i-image"/></svg></div>';
        }
        if (isVid) {
            return '<div class="dw-thumb"><svg class="i"><use href="#i-play"/></svg></div>';
        }
        return '<div class="dw-thumb"><svg class="i"><use href="#i-file-text"/></svg></div>';
    }

    /* 当前筛选结果（搜索命中 + 批次展开）。 */
    function trVisible() {
        var q = String(TR.q || '').trim().toLowerCase();
        var out = [];
        TR.batches.forEach(function (b) {
            var items = (b.items || []).filter(function (it) {
                if (!q) { return true; }
                return String(it.relPath || '').toLowerCase().indexOf(q) >= 0;
            });
            if (items.length) { out.push({ batch: b.batch, at: b.at, items: items }); }
        });
        return out;
    }

    function trPickedList() {
        var out = [];
        TR.batches.forEach(function (b) {
            (b.items || []).forEach(function (it) {
                var k = b.batch + '|' + it.relPath;
                if (TR.picked[k]) { out.push({ batch: b.batch, relPath: it.relPath, item: it }); }
            });
        });
        return out;
    }

    function trSyncPicked() {
        /* 清掉已经不在清单里的选择（恢复/删除后），否则批量操作会带上脏数据。 */
        var alive = {};
        TR.batches.forEach(function (b) {
            (b.items || []).forEach(function (it) { alive[b.batch + '|' + it.relPath] = 1; });
        });
        Object.keys(TR.picked).forEach(function (k) {
            if (!alive[k]) { delete TR.picked[k]; }
        });
        var n = Object.keys(TR.picked).length;
        var nEl = document.getElementById('dwPickN');
        if (nEl) { nEl.textContent = n; }
        var allEl = document.getElementById('dwPickAll');
        if (allEl) {
            var vis = trVisible();
            var total = vis.reduce(function (a, b) { return a + b.items.length; }, 0);
            allEl.checked = total > 0 && n >= total;
            allEl.indeterminate = n > 0 && n < total;
        }
        var btnR = document.getElementById('dwRestoreSel');
        var btnP = document.getElementById('dwPurgeSel');
        if (btnR) { btnR.disabled = !n || TR.busy; }
        if (btnP) { btnP.disabled = !n || TR.busy; }
    }

    function trRender() {
        var listEl = document.getElementById('dwList');
        if (!listEl) { return; }
        var vis = trVisible();
        if (!vis.length) {
            var total = TR.batches.reduce(function (a, b) { return a + (b.items || []).length; }, 0);
            listEl.innerHTML = total
                ? '<div class="dw-empty">没有匹配「' + esc(TR.q) + '」的条目</div>'
                : '<div class="dw-empty">回收站是空的<div style="margin-top:6px;font-size:10px">删除的文件会先放到这里，可以随时恢复</div></div>';
            trSyncPicked();
            return;
        }
        var html = vis.map(function (b) {
            var head = '<div class="dw-group"><b>' + esc(trGroupLabel(b.at, b.batch)) + '</b>' +
                '<span>' + b.items.length + ' 项</span></div>';
            var rows = b.items.map(function (it) {
                var k = b.batch + '|' + it.relPath;
                var on = !!TR.picked[k];
                var name = String(it.fileName || it.relPath.split('/').pop() || '');
                var dir = String(it.relPath || '').split('/').slice(0, -1).join('/');
                var meta = trSize(it.size) + (it.kind === 'video' ? ' · 视频' : (it.kind === 'image' ? ' · 图片' : ''));
                return '<div class="dw-item' + (on ? ' on' : '') + '" data-row="' + esc(k) + '">' +
                    '<label class="dw-check"><input type="checkbox" data-pick="' + esc(k) + '"' + (on ? ' checked' : '') + '></label>' +
                    trThumb(it) +
                    '<div class="dw-body">' +
                    '<div class="dw-name" title="' + esc(name) + '">' + esc(name) + '</div>' +
                    '<div class="dw-path" title="' + esc(dir) + '">' + esc(dir || '（根目录）') + '</div>' +
                    '<div class="dw-meta">' + esc(meta) + '</div>' +
                    '</div>' +
                    '<div class="dw-acts">' +
                    '<button data-restore="' + esc(k) + '" title="恢复"><svg class="i"><use href="#i-rotate-cw"/></svg></button>' +
                    '<button class="del" data-purge="' + esc(k) + '" title="彻底删除（不可恢复）"><svg class="i"><use href="#i-trash-2"/></svg></button>' +
                    '</div></div>';
            }).join('');
            return head + rows;
        }).join('');
        listEl.innerHTML = html;
        trSyncPicked();
    }

    async function trReload() {
        var listEl = document.getElementById('dwList');
        if (listEl) { listEl.innerHTML = '<div class="dw-empty">读取中…</div>'; }
        try {
            TR.batches = root.VRTrash ? await root.VRTrash.list() : [];
        } catch (e) {
            TR.batches = [];
            if (listEl) { listEl.innerHTML = '<div class="dw-empty">读取失败：' + esc(e && e.message || '未知') + '</div>'; }
            return;
        }
        trRender();
    }

    async function openTrash() {
        var drawer = $('#drawer'), mask = $('#dwMask');
        if (!drawer) { return; }
        drawer.classList.add('show');
        if (mask) { mask.classList.add('show'); }
        trRender();
        await trReload();
    }

    /* 恢复所选：逐条恢复，统计成功/失败，最后一次性播报。
     * 不用「全部恢复」那条路径 —— 用户选了哪些就只动哪些。 */
    async function trRestorePicked() {
        var picks = trPickedList();
        if (!picks.length || TR.busy) { return; }
        /* 恢复前预检冲突，避免用户点了之后发现静默失败。 */
        var conflicts = [];
        try {
            var pf = await root.VRTrash.preflightRestore();
            if (pf && pf.conflicts && pf.conflicts.length) {
                var want = {};
                picks.forEach(function (p) { want[p.relPath] = 1; });
                conflicts = pf.conflicts.filter(function (p) { return want[p]; });
            }
        } catch (e) { /* 预检失败不阻断，restore 自己也会兜 */ }
        var msg = '恢复所选 ' + picks.length + ' 项？文件会回到原来的相对路径。';
        if (conflicts.length) {
            msg += '\n\n注意：' + conflicts.length + ' 项原位置已有同名文件，会跳过（不覆盖）。';
        }
        ask(msg, async function () {
            TR.busy = true; trSyncPicked();
            var okN = 0, failN = 0, firstErr = '';
            for (var i = 0; i < picks.length; i++) {
                var p = picks[i];
                if (picks.length > 2) { toast('正在恢复 ' + (i + 1) + '/' + picks.length + '…', { ms: 600000 }); }
                try {
                    var r = await root.VRTrash.restore(p.batch, p.relPath);
                    if (r && r.restored) { okN += r.restored; }
                    if (r && r.failed && r.failed.length) {
                        failN += r.failed.length;
                        if (!firstErr) { firstErr = (r.failed[0].message || r.failed[0].code || ''); }
                    } else if (!r || !r.restored) { failN++; }
                } catch (e) {
                    failN++;
                    if (!firstErr) { firstErr = String(e && e.message || '未知'); }
                }
                delete TR.picked[p.batch + '|' + p.relPath];
            }
            TR.busy = false;
            await load(); await refreshDrawer(); await trReload();
            if (failN) {
                toast('恢复完成：成功 ' + okN + ' 项，失败 ' + failN + ' 项' + (firstErr ? '（' + firstErr + '）' : ''));
            } else {
                toast('已恢复 ' + okN + ' 项');
            }
        });
    }

    /* 彻底删除所选：purge 是真正不可逆的，确认文案必须说清楚。 */
    async function trPurgePicked() {
        var picks = trPickedList();
        if (!picks.length || TR.busy) { return; }
        var sample = picks.length <= 3
            ? '\n\n' + picks.map(function (p) { return '· ' + String(p.relPath).split('/').pop(); }).join('\n')
            : '\n\n其中：' + String(picks[0].relPath).split('/').pop() + ' 等';
        ask('彻底删除所选 ' + picks.length + ' 项？\n\n这会连同文件一起删除，**无法恢复**。' + sample, async function () {
            TR.busy = true; trSyncPicked();
            var okN = 0, failN = 0;
            for (var i = 0; i < picks.length; i++) {
                var p = picks[i];
                try {
                    await root.VRTrash.purge(p.batch, p.relPath);
                    okN++;
                    delete TR.picked[p.batch + '|' + p.relPath];
                } catch (e) { failN++; }
            }
            TR.busy = false;
            await refreshDrawer(); await trReload();
            toast(failN ? ('已彻底删除 ' + okN + ' 项，' + failN + ' 项失败') : ('已彻底删除 ' + okN + ' 项'));
        });
    }

    /* ==========================================================
       补齐原型里「有按钮、没接线」的死键（E2E 交叉比对查出 23 个）。
       规矩：每个按钮点了必须有真实动作或明确提示，不许点了没反应。
       ========================================================== */
    function renderFavDrawer() {
        var listEl = document.getElementById('favDrawerList');
        var nEl = document.getElementById('favDrawerN');
        if (nEl) { nEl.textContent = FAVS.length; }
        if (!listEl) { return; }
        if (!FAVS.length) { listEl.innerHTML = '<div class="dw-empty">还没有收藏夹</div>'; return; }
        listEl.innerHTML = FAVS.map(function (fav) {
            var n = fav.sys === 'star'
                ? FILES.filter(function (f) { return f.starred; }).length
                : (fav.ids || []).length;
            return '<div class="dw-item">' +
                '<span class="dw-name">' + esc(fav.name) + '</span>' +
                '<span style="color:var(--faint);font-size:10px;margin-right:8px">' + n + ' 项</span>' +
                '<button class="btn small" data-favdel="' + esc(fav.id) + '">删除</button>' +
                '</div>';
        }).join('');
    }

    /* 移动：应用内文件夹选择（move-picker.js），不让用户手写路径 */
    function moveHooks() {
        return {
            getEntry: function (rel) { return RAW[rel] || null; },
            toast: toast,
            onNeedAuth: function () {
                toast('移动素材要先授权素材目录（设置 → 保存位置）');
                var d = $('#setdrawer'), m = $('#setmask');
                if (d) { d.classList.add('show'); }
                if (m) { m.classList.add('show'); }
            },
            onDone: async function () {
                S.sel.clear(); S.select = false;
                var sb = $('#selectBtn'); if (sb) { sb.classList.remove('is-on'); }
                var bb = $('#batchbar'); if (bb) { bb.classList.add('hidden'); }
                await load();
            }
        };
    }

    function bindMissing() {
        var on = function (id, fn) { var el = document.getElementById(id); if (el) { el.addEventListener('click', fn); } };
        var byId = function (id) { return document.getElementById(id); };

        /* ---- 重命名 ---- */
        var renRel = '';
        function openRename(f) {
            if (!f) { toast('先选一条素材'); return; }
            renRel = f.relPath;
            var m = byId('renameMask'); if (!m) { return; }
            var inp = byId('renameInput');
            /* 输入框只放「名字本体」，扩展名单独显示并锁定（否则会改出打不开的文件） */
            var ext = String(f.ext || '').toLowerCase();
            var base = String(f.displayName || f.title || '');
            if (ext && base.toLowerCase().endsWith('.' + ext)) { base = base.slice(0, -(ext.length + 1)); }
            if (inp) { inp.value = base; }
            var extEl = byId('renameExt');
            if (extEl) { extEl.textContent = ext ? ('.' + ext) : ''; }
            var d = byId('renameDir');
            if (d) { d.textContent = String(f.relPath).split('/').slice(0, -1).join(' / '); }
            m.classList.add('show');
            setTimeout(function () { if (inp) { inp.focus(); inp.select(); } }, 40);
        }
        function closeRename() { var m = byId('renameMask'); if (m) { m.classList.remove('show'); } }
        on('renameCancel', closeRename);
        var rmask = byId('renameMask');
        if (rmask) { rmask.addEventListener('click', function (e) { if (e.target === rmask) { closeRename(); } }); }
        /* ADR-050 R2 口径：重命名只改显示名（displayName），物理文件名不动。
         * 原来的实现走 VRRename 做「复制→校验→删源」的物理改名，
         * 没有目录授权时必然失败——用户点了只看到「重命名失败」，
         * 等于这个功能没做。改成写 displayName：无需授权、可回退、不动磁盘。 */
        async function commitRename(v) {
            if (!root.VRDB || !root.VRDB.patchFile) { toast('数据层没就绪，请重新加载扩展'); return; }
            try {
                await root.VRDB.patchFile(renRel, { displayName: v });
                closeRename();
                toast('已重命名（物理文件名不变，可在列表显示新名字）');
                var h2 = document.querySelector('.pv-info h2');
                if (h2 && !document.getElementById('preview').classList.contains('hidden')) { h2.textContent = v; }
                await load();
            } catch (e) {
                toast('重命名失败：' + ((e && e.message) || '未知'));
            }
        }

        on('renameOk', async function () {
            var inp = byId('renameInput');
            var v = String((inp && inp.value) || '').trim();
            if (!v) { toast('文件名不能为空'); return; }
            /* 重名校验：库里两张卡片显示同一个名字时，用户无法区分是哪一张，
             * 再想改回来也找不到（批量改名成「旅行」这类场景特别容易撞）。
             * 只比显示名，不比物理文件名——重命名本来就不动磁盘。 */
            var dup = FILES.filter(function (f) {
                if (!f || f.relPath === renRel) { return false; }
                return String(f._title || '').trim() === v;
            });
            if (dup.length) {
                var d0 = dup[0];
                toast('已有同名素材：' + (d0.author ? (d0.author + ' · ') : '') + String(d0.relPath).split('/').slice(-1)[0] +
                    '；换个名字或点「仍然重命名」', {
                    label: '仍然重命名', ms: 12000,
                    onClick: function () { commitRename(v); }
                });
                return;
            }
            commitRename(v);
        });

        /* ---- 预览层右侧按钮 ---- */
        function curPreview() {
            return (root.VRPreview && root.VRPreview.current) ? root.VRPreview.current() : null;
        }

        /* ---- 键盘矩阵：列表卡片 Space/Enter、F2、Del、?、Ctrl/Cmd+A ---- */
        function focusedCard() {
            var el = document.activeElement;
            if (!el || !el.closest) { return null; }
            var card = el.closest('#grid .card');
            if (!card) { return null; }
            var id = card.getAttribute('data-id');
            for (var i = 0; i < FILES.length; i++) {
                if (FILES[i].id === id) { return FILES[i]; }
            }
            return null;
        }
        document.addEventListener('keydown', function (e) {
            var el = document.activeElement;
            var tag = el ? el.tagName : '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) { return; }
            var preview = document.getElementById('preview');
            var previewOpen = !!(preview && !preview.classList.contains('hidden'));

            if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !e.ctrlKey && !e.metaKey && !e.altKey) {
                var ks = byId('keysheet');
                if (ks) { ks.classList.toggle('show'); e.preventDefault(); }
                return;
            }
            if (e.key === 'Escape') {
                var k = byId('keysheet'); if (k) { k.classList.remove('show'); }
                var cm = byId('confirmMask'); if (cm) { cm.classList.remove('show'); }
                closeRename();
                return;
            }
            if ((e.key === ' ' || e.key === 'Enter') && tag !== 'BUTTON' && tag !== 'A') {
                if (previewOpen) { return; }
                var f = focusedCard();
                if (f) { e.preventDefault(); openPreview(f); }
                return;
            }
            if (e.key === 'F2') {
                var rf = focusedCard() || (previewOpen ? curPreview() : null);
                if (rf) { e.preventDefault(); openRename(rf); }
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                var df = focusedCard();
                if (!df) { return; }
                e.preventDefault();
                if (!window.__vrPerm || !window.__vrPerm.writable) {
                    toast('删除素材要先授权素材目录');
                    return;
                }
                ask('把「' + (df.title || df.fileName) + '」移入回收站？文件还能恢复。', async function () {
                    try {
                        await root.VRTrash.remove([df.relPath]);
                        await load();
                        toast('已移入回收站');
                    } catch (err) { toast('删除失败：' + ((err && err.message) || '未知')); }
                });
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && !previewOpen) {
                e.preventDefault();
                S.select = true;
                S.sel = new Set((S.list || FILES).map(function (f) { return f.id; }));
                var sb = byId('selectBtn'); if (sb) { sb.classList.add('is-on'); }
                var bb = byId('batchbar'); if (bb) { bb.classList.remove('hidden'); }
                render();
            }
        }, true);

        on('pvRename', function () { openRename(curPreview()); });
        on('pvDelete', async function () {
            var f = curPreview(); if (!f) { return; }
            markWritePending();
            if (!(await ensureWriteAccess())) { return; }
            ask('把「' + (f.title || f.fileName) + '」移入回收站？文件还能恢复。', async function () {
                if (!root.VRTrash) { toast('回收站模块没加载'); return; }
                try {
                    var rr0 = await root.VRTrash.remove([f.relPath]);
                    if (root.VRPreview) { root.VRPreview.close(); }
                    await load();
                    if (rr0 && rr0.moved > 0 && rr0.batch) {
                        toast('已移入回收站', {
                            label: '撤销', ms: 8000,
                            onClick: async function () {
                                try {
                                    await root.VRTrash.restore(rr0.batch);
                                    toast('已撤销删除');
                                    await load(); await refreshDrawer();
                                } catch (e2) { toast('撤销失败：' + ((e2 && e2.message) || '未知')); }
                            }
                        });
                    } else {
                        toast('已移入回收站');
                    }
                } catch (e) { toast('删除失败：' + ((e && e.message) || '未知')); }
            });
        });
        on('pvReveal', function () { revealFile(curPreview()); });
        on('pvMove', async function () {
            var f = curPreview(); if (!f) { return; }
            if (!root.VRMovePicker) { toast('移动模块没加载，请刷新页面'); return; }
            markWritePending();
            if (!(await ensureWriteAccess())) { return; }
            root.VRMovePicker.open([f], moveHooks());
        });
        /* 右键菜单回调：复用这一层已有的 openRename / ask / 定位实现 */
        if (typeof initCtxMenu === 'function') {
            initCtxMenu({
                rename: function (f) { openRename(f); },
                reveal: function (f) { revealFile(f); },
                remove: async function (f) {
                    if (!f) { return; }
                    if (typeof ensureWriteAccess === 'function' && !(await ensureWriteAccess())) { return; }
                    ask('把「' + (f._title || f.title || f.fileName) + '」移入回收站？文件还能恢复。', async function () {
                        if (!root.VRTrash) { toast('回收站模块没加载'); return; }
                        try {
                            await root.VRTrash.remove([f.relPath]);
                            if (root.VRPreview) { root.VRPreview.close(); }
                            toast('已移入回收站');
                            await load();
                        } catch (e) { toast('删除失败：' + ((e && e.message) || '未知')); }
                    });
                }
            });
        }

        var permAuth = byId('permAuth');
        if (permAuth) {
            permAuth.addEventListener('click', async function () {
                if (!window.__vrPerm || window.__vrPerm.writable) { openOptions(); return; }
                if (window.__vrPerm.rootInvalid) { await authorizeRoot(); return; }
                /* 已有正确句柄：先沿用句柄申请权限；失败/没有句柄再弹目录选择。 */
                var saved = window.__vrPerm.handle;
                if (saved && typeof saved.requestPermission === 'function') {
                    try {
                        var st = await saved.requestPermission({ mode: 'readwrite' });
                        if (st === 'granted') {
                            var rr0 = await root.VRIndex.resolveRoot();
                            await root.VRIndex.setRoot(saved, rr0.absRoot, rr0.prefix);
                            toast('已恢复写入权限');
                            await refreshPermState();
                            return;
                        }
                    } catch (e) { /* 落到重新选择 */ }
                }
                await authorizeRoot();
            });
        }

        on('pvHelpBtn', function () {
            var k = byId('keysheet'); if (k) { k.classList.add('show'); }
        });
        on('ksClose', function () {
            var k = byId('keysheet'); if (k) { k.classList.remove('show'); }
        });
        on('pvMoreAll', function () {
            var f = curPreview(); if (!f) { return; }
            var who = String(f.author || '').replace(/\(@[^)]*\)\s*$/, '').trim();
            if (!who) { toast('这条没记作者信息'); return; }
            var se = byId('search');
            if (se) { se.value = who; se.dispatchEvent(new Event('input', { bubbles: true })); }
            if (root.VRPreview) { root.VRPreview.close(); }
            toast('已按作者「' + who + '」筛选');
        });
        on('autoBtn', function (ev) {
            var b = ev.currentTarget || byId('autoBtn');
            var next = !(b && b.classList.contains('on'));
            if (b) { b.classList.toggle('on', next); b.setAttribute('aria-pressed', next ? 'true' : 'false'); }
            if (root.VRPreview && root.VRPreview.setAuto) { root.VRPreview.setAuto(next); }
            toast(next ? '连播：开' : '连播：关');
        });

        /* ---- 收藏夹 ---- */
        function openFavDrawer() {
            renderFavDrawer();
            var d = byId('favDrawer'); if (d) { d.classList.add('show'); }
            var m = byId('setmask'); if (m) { m.classList.add('show'); }
        }
        function closeFavDrawer() {
            var d = byId('favDrawer'); if (d) { d.classList.remove('show'); }
            var m = byId('setmask'); if (m) { m.classList.remove('show'); }
        }
        on('favMore', openFavDrawer);
        on('favDrawerClose', closeFavDrawer);
        on('favDrawerNew', function () {
            var n = window.prompt('新收藏夹名字', '新收藏夹');
            if (n === null) { return; }
            n = String(n).trim();
            if (!n) { toast('名字不能为空'); return; }
            FAVS.push({ id: 'f' + Date.now(), name: n, ids: [] });
            saveFavs(); renderFavs(); renderFavDrawer();
            toast('已新建收藏夹「' + n + '」');
        });
        on('favSaveFilter', function () {
            /* 必须用 filtered()（当前筛选结果），不是 FILES（全部）。
             * 原实现把整个库都存进「智能夹」，等于没筛（2026-11-06 反馈）。 */
            var rows = sorted(filtered());
            if (!rows.length) { toast('当前筛选没有素材'); return; }
            var name = '筛选 ' + new Date().toLocaleDateString();
            FAVS.push({
                id: 'f' + Date.now(), name: name,
                ids: rows.map(function (f) { return f.id; })
            });
            saveFavs(); renderFavs(); renderFavDrawer();
            toast('已把当前 ' + rows.length + ' 项存成收藏夹「' + name + '」');
        });
        on('favPopNew', function () {
            var n = window.prompt('新收藏夹名字', '新收藏夹');
            if (n === null) { return; }
            n = String(n).trim();
            if (!n) { toast('名字不能为空'); return; }
            FAVS.push({ id: 'f' + Date.now(), name: n, ids: [] });
            saveFavs(); renderFavs(); renderFavDrawer();
            toast('已新建收藏夹「' + n + '」');
        });
        on('favPopDone', function () {
            var pop = byId('favPop'); if (pop) { pop.classList.remove('show'); }
        });

        function curFav() {
            return findFav(S.fav);
        }
        on('favRename', function () {
            var fav = curFav();
            if (!fav) { toast('先在左边选一个收藏夹'); return; }
            var n = window.prompt('收藏夹新名字', fav.name);
            if (n === null) { return; }
            n = String(n).trim();
            if (!n) { toast('名字不能为空'); return; }
            fav.name = n; saveFavs(); renderFavs(); renderFavDrawer();
            toast('已重命名收藏夹');
        });
        on('favDelete', function () {
            var fav = curFav();
            if (!fav) { toast('先在左边选一个收藏夹'); return; }
            ask('删除收藏夹「' + fav.name + '」？只删这个视图，文件不会动。', function () {
                FAVS = FAVS.filter(function (x) { return x.id !== fav.id; });
                if (S.fav === fav.id) { S.fav = ''; }
                saveFavs(); renderFavs(); renderFavDrawer();
                toast('收藏夹已删除（文件没动）');
            });
        });
        on('favExport', function () {
            var fav = curFav();
            if (!fav) { toast('先在左边选一个收藏夹'); return; }
            var list = fav.sys === 'star'
                ? FILES.filter(function (f) { return f.starred; })
                : FILES.filter(function (f) { return (fav.ids || []).indexOf(f.id) >= 0; });
            try {
                var txt = list.map(function (f) { return f.relPath; }).join('\n');
                var blob = new Blob([txt], { type: 'text/plain' });
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = fav.name + '.txt';
                a.click();
                setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
                toast('清单已导出（' + list.length + ' 条）');
            } catch (e) { toast('导出失败'); }
        });

        // 左侧栏「回收站」入口（此前只有设置抽屉里的那个有绑定）
        var sideTrash = byId('trashBtn');
        if (sideTrash) { sideTrash.addEventListener('click', function () { openTrash(); }); }

        // 抽屉里每行的「删除」
        var dlist = byId('favDrawerList');
        if (dlist) {
            dlist.addEventListener('click', function (e) {
                var b = e.target.closest ? e.target.closest('[data-favdel]') : null;
                if (!b) { return; }
                var id = b.getAttribute('data-favdel');
                var fav = FAVS.filter(function (x) { return x.id === id; })[0];
                if (!fav) { return; }
                ask('删除收藏夹「' + fav.name + '」？只删这个视图，文件不会动。', function () {
                    FAVS = FAVS.filter(function (x) { return x.id !== id; });
                    if (S.fav === id) { S.fav = ''; }
                    saveFavs(); renderFavs(); renderFavDrawer();
                    toast('收藏夹已删除（文件没动）');
                });
            });
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

        var bmBtn = $('#batchMove');
        if (bmBtn) {
            bmBtn.addEventListener('click', async function () {
                var list = FILES.filter(function (f) { return S.sel.has(f.id); });
                if (!list.length) { toast('先选素材'); return; }
                if (!root.VRMovePicker) { toast('移动模块没加载，请刷新页面'); return; }
                markWritePending();
                if (!(await ensureWriteAccess())) { return; }
                root.VRMovePicker.open(list, moveHooks());
            });
        }

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
            // 先走不需要授权的下载记录模式，别一上来就要目录权限（2026-11-05 修复）
            var done = false;
            try { await root.VRIndex.build({ mode: 'downloads' }); done = true; } catch (e) { /* 下一档 */ }
            if (!done) {
                try { await root.VRIndex.build({ mode: 'full' }); done = true; }
                catch (e) { toast('重建失败：' + (e && e.message || '未知')); }
            }
            if (done) { await load(); toast('索引重建完成'); }
            await refreshDrawer();
        }); }
        var dupBtn = $('#sdDupBtn');
        if (dupBtn) {
            dupBtn.addEventListener('click', async function () {
                if (!root.VRDedup || !root.VRDedup.scan) { toast('去重模块没加载'); return; }
                if (dupBtn.disabled) { return; }
                dupBtn.disabled = true;
                var old = dupBtn.textContent;
                dupBtn.textContent = '扫描中…';
                try {
                    var r = await root.VRDedup.scan();
                    var val = $('#sdDupVal');
                    if (!r.groups.length) {
                        if (val) { val.textContent = '没有重复'; }
                        toast('没有发现内容重复的素材');
                    } else {
                        var saved = fmt(r.reclaimBytes / 1048576);
                        if (val) { val.textContent = r.groups.length + ' 组 · ' + r.items + ' 条 · 可省 ' + saved; }
                        toast('发现 ' + r.groups.length + ' 组重复（' + r.items + ' 条，可省 ' + saved + '）');
                    }
                } catch (e) {
                    toast('扫描重复失败：' + ((e && e.message) || '未知'));
                } finally {
                    dupBtn.disabled = false;
                    dupBtn.textContent = old;
                }
            });
        }
        var trashBtn = $('#sdTrashBtn');
        if (trashBtn) {
            // 抽屉里点「打开回收站」：先把设置抽屉收起再开回收站。
            // 注意 closeSet() 是 bind() 内部的局部函数，这里调不到（曾报 closeSet is not defined）。
            trashBtn.addEventListener('click', function () {
                var sd = $('#setdrawer'), sm = $('#setmask');
                if (sd) { sd.classList.remove('show'); }
                if (sm) { sm.classList.remove('show'); }
                openTrash();
            });
        }

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
            /* 勾选框：只改选择状态，不重排列表（重排会让正在点的行跳位）。 */
            dwList.addEventListener('change', function (e) {
                var cb = e.target.closest && e.target.closest('[data-pick]');
                if (!cb) { return; }
                var k = cb.dataset.pick;
                if (cb.checked) { TR.picked[k] = 1; } else { delete TR.picked[k]; }
                var row = cb.closest('.dw-item');
                if (row) { row.classList.toggle('on', !!cb.checked); }
                trSyncPicked();
            });
            dwList.addEventListener('click', async function (e) {
                /* 点行本身也能切换勾选（勾选框太小，手机上不好点） */
                var restoreBtn = e.target.closest && e.target.closest('[data-restore]');
                var purgeBtn = e.target.closest && e.target.closest('[data-purge]');
                if (!restoreBtn && !purgeBtn) {
                    var row = e.target.closest && e.target.closest('[data-row]');
                    if (row && !(e.target.closest('input'))) {
                        var k = row.dataset.row;
                        if (TR.picked[k]) { delete TR.picked[k]; } else { TR.picked[k] = 1; }
                        trRender();
                    }
                    return;
                }
                /* 单条恢复 */
                if (restoreBtn) {
                    var pk = String(restoreBtn.dataset.restore || '');
                    var sep = pk.indexOf('|');
                    var batch = pk.slice(0, sep), rel = pk.slice(sep + 1);
                    if (!batch || !rel) { return; }
                    restoreBtn.disabled = true;
                    try {
                        var r = await root.VRTrash.restore(batch, rel);
                        if (r && r.restored) {
                            delete TR.picked[pk];
                            toast('已恢复');
                        } else {
                            var why = (r && r.failed && r.failed[0] && (r.failed[0].message || r.failed[0].code)) || '未知';
                            toast('恢复失败：' + why, { ms: 6000 });
                        }
                        await load(); await refreshDrawer(); await trReload();
                    } catch (err) {
                        toast('恢复失败：' + (err && err.message || '未知'));
                        restoreBtn.disabled = false;
                    }
                    return;
                }
                /* 单条彻底删除 */
                var pk2 = String(purgeBtn.dataset.purge || '');
                var sep2 = pk2.indexOf('|');
                var batch2 = pk2.slice(0, sep2), rel2 = pk2.slice(sep2 + 1);
                if (!batch2 || !rel2) { return; }
                var nm = String(rel2).split('/').pop();
                ask('彻底删除「' + nm + '」？\n\n这会连同文件一起删除，**无法恢复**。', async function () {
                    purgeBtn.disabled = true;
                    try {
                        await root.VRTrash.purge(batch2, rel2);
                        delete TR.picked[pk2];
                        toast('已彻底删除');
                        await refreshDrawer(); await trReload();
                    } catch (err) {
                        toast('彻底删除失败：' + (err && err.message || '未知'));
                        purgeBtn.disabled = false;
                    }
                });
            });
        }

        /* 搜索：输入即过滤，不请求磁盘（清单已在内存）。 */
        var dwSearch = $('#dwSearch');
        if (dwSearch) {
            dwSearch.addEventListener('input', function () {
                TR.q = String(dwSearch.value || '');
                trRender();
            });
        }

        /* 全选 / 取消全选：作用于「当前筛选结果」，与搜索口径一致。 */
        var dwSelAll = $('#dwSelAll');
        if (dwSelAll) {
            dwSelAll.addEventListener('click', function () {
                var vis = trVisible();
                var total = vis.reduce(function (a, b) { return a + b.items.length; }, 0);
                var cur = Object.keys(TR.picked).length;
                if (cur >= total && total > 0) {
                    TR.picked = {};
                } else {
                    vis.forEach(function (b) {
                        b.items.forEach(function (it) { TR.picked[b.batch + '|' + it.relPath] = 1; });
                    });
                }
                trRender();
            });
        }

        var dwPickAll = $('#dwPickAll');
        if (dwPickAll) {
            dwPickAll.addEventListener('change', function () {
                if (dwPickAll.checked) {
                    trVisible().forEach(function (b) {
                        b.items.forEach(function (it) { TR.picked[b.batch + '|' + it.relPath] = 1; });
                    });
                } else {
                    TR.picked = {};
                }
                trRender();
            });
        }

        var dwRestoreSel = $('#dwRestoreSel');
        if (dwRestoreSel) { dwRestoreSel.addEventListener('click', trRestorePicked); }
        var dwPurgeSel = $('#dwPurgeSel');
        if (dwPurgeSel) { dwPurgeSel.addEventListener('click', trPurgePicked); }

        var dwEmpty = $('#dwEmpty');
        if (dwEmpty) { dwEmpty.addEventListener('click', async function () {
            var st;
            try { st = await root.VRTrash.status(); } catch (e) { st = { count: 0 }; }
            if (!st || !st.count) { toast('回收站是空的'); return; }
            ask('清空回收站？\n\n里面 ' + st.count + ' 项文件会被**彻底删除**，无法恢复。',
                async function () {
                    try {
                        await root.VRTrash.empty();
                        TR.picked = {};
                        toast('回收站已清空');
                        await refreshDrawer(); await trReload();
                    } catch (e) { toast('清空失败：' + (e && e.message || '未知')); }
                });
        }); }
        var dwRestoreAll = $('#dwRestoreAll');
        if (dwRestoreAll) { dwRestoreAll.addEventListener('click', async function () {
            if (S.batchBusy) { return; }
            try {
                /* 「全部恢复」是破坏性操作：原来直接循环恢复，没有确认也没有冲突预检。
                 * 若原位置已有同名文件，restore() 会逐条失败，用户事先完全不知情。 */
                var pf = root.VRTrash.preflightRestore
                    ? await root.VRTrash.preflightRestore()
                    : { total: 0, conflicts: [] };
                if (!pf.total) { toast('回收站是空的'); return; }
                var warn = '';
                if (pf.conflicts.length) {
                    warn = '\n\n注意：' + pf.conflicts.length + ' 项原位置已有同名文件，会被跳过（不会覆盖）。\n例：' +
                        String(pf.conflicts[0]).split('/').pop();
                }
                S.batchBusy = true;
                ask('恢复回收站里的全部 ' + pf.total + ' 项？文件会回到原来的相对路径。' + warn, async function () {
                    try {
                        var batches = await root.VRTrash.list();
                        var okN = 0, failN = 0;
                        for (var i = 0; i < batches.length; i++) {
                            toast('正在恢复 ' + (i + 1) + '/' + batches.length + ' 批…', { ms: 600000 });
                            var r = await root.VRTrash.restore(batches[i].batch);
                            okN += (r && r.restored) || 0;
                            failN += (r && r.failed && r.failed.length) || 0;
                        }
                        var msg = '已恢复 ' + okN + ' 项';
                        if (failN) { msg += '，' + failN + ' 项因同名被跳过'; }
                        toast(msg);
                        /* 恢复后清单整体变了，残留的勾选指向已不存在的条目，
                         * 不清掉会让紧随其后的批量操作带上脏数据。 */
                        TR.picked = {};
                        await load(); await refreshDrawer(); await trReload();
                    } catch (e) {
                        toast('恢复失败：' + (e && e.message || '未知'));
                    } finally {
                        S.batchBusy = false;
                    }
                });
            } catch (e) {
                S.batchBusy = false;
                toast('恢复失败：' + (e && e.message || '未知'));
            }
        }); }
    }

    /* ---------- 启动 ---------- */
    async function boot() {
        try { window.__vrBoot = ['start']; } catch (e) { /* 忽略 */ }
        try { installGlobalErrorGuard(); } catch (e) { /* 忽略 */ }
        /* 立刻铺骨架，别让用户在 2 秒空窗里以为库是空的。 */
        try { renderSkeleton(8); } catch (e) { /* 忽略 */ }
        try { bind(); window.__vrBoot.push('bind'); } catch (e) { window.__vrBoot.push('bind-ERR:' + e.message); throw e; }
        try { bindMissing(); window.__vrBoot.push('bindMissing'); } catch (e) { window.__vrBoot.push('bindMissing-ERR'); }
        try { initCtxMenu(); window.__vrBoot.push('ctx'); } catch (e) { window.__vrBoot.push('ctx-ERR:' + e.message); }
        try { bindConfirm(); window.__vrBoot.push('confirm'); } catch (e) { window.__vrBoot.push('confirm-ERR:' + e.message); }
        try { await loadFavs(); window.__vrBoot.push('favs'); } catch (e) { window.__vrBoot.push('favs-ERR:' + e.message); }
        try { await ensureRoot(); window.__vrBoot.push('root'); } catch (e) { window.__vrBoot.push('root-ERR:' + e.message); }
        try { await refreshPermState(); window.__vrBoot.push('perm'); } catch (e) { window.__vrBoot.push('perm-ERR:' + e.message); }
        try { await load(); window.__vrBoot.push('load:' + FILES.length); } catch (e) { window.__vrBoot.push('load-ERR:' + e.message); }
        if (!FILES.length) {
            /* 索引建完必须重新读一次库（不管 build 返回什么）： */
            try { await autoIndex(); } catch (e) { /* 未授权等，落到空态 */ }
            await load();
        }
        /* 回收站计数必须在启动时刷一次。
         * 2026-11-06 实测：status() 明明返回 count=15、batches=4，
         * 但侧栏徽标一直停在初始的「0」且 hidden（设置抽屉里的「回收站」也显示 —）。
         * 原因是这里从来没调用过 refreshDrawer() —— 只有用户手动点开设置抽屉、
         * 或做过一次删除之后才会刷新。于是「回收站里明明有文件，界面上一个数字都没有」，
         * 看起来就像这个功能没做。 */
        try { await refreshDrawer(); window.__vrBoot.push('drawer'); }
        catch (e) { window.__vrBoot.push('drawer-ERR:' + (e && e.message || '')); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    root.VRApp = {
        reload: load,
        toast: toast,
        getFiles: function () { return FILES; },
        /* 空态钩子：自动化测试用，直接按给定条件重绘空态，不改真实数据。 */
        _renderEmpty: function (n, over) { renderEmpty(n, over); },
        /* 定位钩子：自动化测试用，直接驱动 revealFile 的无路径分支。 */
        _revealFile: function (f) { revealFile(f); },
        render: function () { render(); },
        /* 骨架屏钩子：只给自动化测试用，正常启动由 boot() 自己调用。 */
        _renderSkeleton: function (n) { renderSkeleton(n); },
        /* 压测入口（B-14）：把合成条目塞进渲染链路，验证大库窗口化。
         * 只在显式调用时生效，不影响正常启动。 */
        _renderFake: function (n) {
            var base = FILES[0] || {};
            var fake = [];
            for (var i = 0; i < n; i++) {
                fake.push(Object.assign({}, base, {
                    id: 'fake/' + i, relPath: 'fake/' + i + '.jpg',
                    title: 't' + i, _title: 't' + i, kind: 'image', ext: 'JPG',
                    tags: [], starred: false, state: 'ok', isRef: 0, sha256: ''
                }));
            }
            FILES = fake;
            RAW = {};
            fake.forEach(function (e) { RAW[e.relPath] = e; });
            var t0 = performance.now();
            render();
            return {
                ms: Math.round(performance.now() - t0),
                domCards: document.querySelectorAll('#grid .card').length,
                total: n,
                padTop: document.getElementById('grid').style.paddingTop,
                padBottom: document.getElementById('grid').style.paddingBottom
            };
        }
    };
    root.VRFav = { toggleStar: toggleStar, addToFav: addToFav, addToDefault: addToDefault, hasFavorite: hasFavorite };
})();
