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
        var corner = isV ? (f.dur || '') : (isA ? f.ext : (isAu ? f.ext : ''));
        var icon = isV ? 'i-film' : (isA ? 'i-repeat-1' : (isAu ? 'i-volume-2' : 'i-image'));
        var tags = (f.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
        return '<article class="card' + (S.sel.has(f.id) ? ' selected' : '') + '" data-id="' + esc(f.id) + '" tabindex="0">' +
            '<div class="thumb' + (isV ? ' is-video' : '') + (isA ? ' is-anim' : '') + (isAu ? ' is-audio' : '') + '">' +
            '<div class="cover" style="--h:' + f.h + '"><span class="fig"><svg class="i"><use href="#' + icon + '"/></svg></span></div>' +
            '<img alt="" loading="lazy" data-thumb="' + esc(f.relPath) + '">' +
            '<span class="badge"><span class="dot" style="--pc:' + p.dot + '"></span>' + p.label + '</span>' +
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
    var PAGE = 120;          // F7 分级加载：首屏只铺这么多，滚动再追加

    function render() {
        var rows = sorted(filtered());
        S.list = rows;
        S.rows = rows;
        S.shown = Math.min(PAGE, rows.length);
        var grid = $('#grid');
        grid.className = 'grid' + (S.view === 'list' ? ' list' : '') + (S.select ? ' selecting' : '');
        grid.innerHTML = rows.slice(0, S.shown).map(card).join('');
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
        if (nearBottom()) { appendMore(); }
    }, { passive: true });

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
                c.classList.add('active'); S.plat = c.dataset.plat;
                /* 平台 chip 是维度切换，不是叠加：残留的搜索关键词会让它变空，
                 * 用户看到的就是「X 明明有 4 条，点 X 却没内容」。 */
                if (S.q) { S.q = ''; if ($('#search')) { $('#search').value = ''; } }
                render();
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
        on('batchExit', function () {
            S.select = false; S.sel.clear();
            $('#selectBtn').classList.remove('is-on');
            $('#batchbar').classList.add('hidden'); render();
        });
        on('batchTrash', function () {
            /* 原实现是「批量删除将在 R5 接入真实回收站」的假按钮，但回收站（js/library/trash.js）
             * 早就做完了 —— 单条删除走的是它，批量却只弹一句提示。这里直接接同一套 API。 */
            var list = FILES.filter(function (f) { return S.sel.has(f.id); });
            if (!list.length) { toast('先选素材'); return; }
            ask('把选中的 ' + list.length + ' 项移入回收站？文件还能恢复。', async function () {
                if (!root.VRTrash) { toast('回收站模块没加载'); return; }
                try {
                    await root.VRTrash.remove(list.map(function (f) { return f.relPath; }));
                    S.sel.clear(); S.select = false;
                    await load();
                    toast('已移入回收站：' + list.length + ' 项');
                } catch (e) {
                    toast('批量删除失败：' + ((e && e.message) || '未知'));
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
                    $$('#chips .chip').forEach(function (x) {
                        x.classList.toggle('active', x.dataset.plat === 'all');
                    });
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
                    $$('#chips .chip').forEach(function (x) {
                        x.classList.toggle('active', x.dataset.plat === S.plat);
                    });
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
            $$('#chips .chip').forEach(function (x) { x.classList.toggle('active', x.dataset.plat === 'all'); });
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

    /* ---------- M5：只读 / 授权状态 ---------- */
    async function refreshPermState() {
        var banner = $('#permBanner'), txt = $('#permText'), auth = $('#permAuth');
        var rr = null;
        try { if (root.VRIndex && root.VRIndex.resolveRoot) { rr = await root.VRIndex.resolveRoot(); } } catch (e) { rr = null; }
        var handle = rr && rr.handle ? rr.handle : null;
        var writable = false;
        var permState = '';
        if (handle) {
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
        /* 旧版本可能留下“能读但指向错误目录”的句柄（例如句柄名 download、
         * 实际素材库却是 video-rod）。只查 queryPermission 会误判为可写，
         * 移动/删除必然在文件系统层失败，因此再核一次目录名。 */
        var rootInvalid = false;
        if (handle && writable && rr && rr.absRoot) {
            var expectedName = String(rr.absRoot).replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
            if (expectedName && handle.name !== expectedName) { rootInvalid = true; writable = false; }
        }
        if (!writable) {
            issues.push(rootInvalid
                ? '素材目录句柄与当前素材库路径不一致：请重新授权「' + ((rr && rr.absRoot) || '') + '」。'
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
            auth.textContent = writable ? '查看设置' : (handle ? '恢复写入' : '授权素材目录');
            auth.title = writable ? '打开设置' : (handle ? '沿用已选目录，重新申请写入权限' : '选择素材库根目录（video-rod）并授权读写');
        }

        /* 写操作按钮：没有可写句柄时直接禁用，避免“点了才失败” */
        ['batchMove', 'batchTrash', 'pvDelete', 'pvMove'].forEach(function (id) {
            var b = document.getElementById(id);
            if (!b) { return; }
            b.disabled = !writable;
            if (!writable) { b.title = '需要先授权素材目录'; }
            else if (b.title === '需要先授权素材目录') { b.removeAttribute('title'); }
        });
        try {
            window.__vrPerm = { handle: handle, writable: writable, permState: permState, fileAccess: fileAccess, issues: issues };
        } catch (e) { /* 忽略 */ }
    }

    window.addEventListener('focus', function () { refreshPermState(); });

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

        /* ---- 确认框（重命名/删除共用） ---- */
        var confirmCb = null;
        function ask(msg, cb) {
            var m = byId('confirmMask');
            if (!m) { if (cb) { cb(); } return; }
            var t = byId('confirmMsg'); if (t) { t.textContent = msg; }
            confirmCb = cb; m.classList.add('show');
        }
        function closeAsk() {
            var m = byId('confirmMask'); if (m) { m.classList.remove('show'); }
            confirmCb = null;
        }
        on('confirmCancel', closeAsk);
        on('confirmOk', function () { var cb = confirmCb; closeAsk(); if (cb) { cb(); } });

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
        on('renameOk', async function () {
            var inp = byId('renameInput');
            var v = String((inp && inp.value) || '').trim();
            if (!v) { toast('文件名不能为空'); return; }
            /* ADR-050 R2 口径：重命名只改显示名（displayName），物理文件名不动。
             * 原来的实现走 VRRename 做「复制→校验→删源」的物理改名，
             * 没有目录授权时必然失败——用户点了只看到「重命名失败」，
             * 等于这个功能没做。改成写 displayName：无需授权、可回退、不动磁盘。 */
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
        on('pvDelete', function () {
            var f = curPreview(); if (!f) { return; }
            if (!window.__vrPerm || !window.__vrPerm.writable) {
                toast('删除需要先授权素材目录');
                return;
            }
            ask('把「' + (f.title || f.fileName) + '」移入回收站？文件还能恢复。', async function () {
                if (!root.VRTrash) { toast('回收站模块没加载'); return; }
                try {
                    await root.VRTrash.remove([f.relPath]);
                    if (root.VRPreview) { root.VRPreview.close(); }
                    toast('已移入回收站');
                    await load();
                } catch (e) { toast('删除失败：' + ((e && e.message) || '未知')); }
            });
        });
        on('pvReveal', function () {
            var f = curPreview(); if (!f) { return; }
            var abs = String(f.absPath || '').trim();
            if (!abs) { toast('这条没有本地路径，无法定位'); return; }
            /* 「定位」是打开路径，不是复制。优先用 downloads 记录让系统打开
             * 所在文件夹；FSA 下载没有 downloadId，就打开 file:// 文件夹。 */
            if (f.downloadId != null && chrome.downloads && chrome.downloads.show) {
                try { chrome.downloads.show(f.downloadId); toast('已在文件夹中定位'); return; } catch (e) { /* 回退 */ }
            }
            var folder = abs.replace(/[\\/][^\\/]+$/, '');
            var url = '';
            try {
                url = root.VRPath && root.VRPath.toFileUrl ? root.VRPath.toFileUrl(folder) : ('file:///' + folder.replace(/\\/g, '/'));
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
        });
        on('pvMove', function () {
            var f = curPreview(); if (!f) { return; }
            if (!root.VRMovePicker) { toast('移动模块没加载，请刷新页面'); return; }
            root.VRMovePicker.open([f], moveHooks());
        });
        var permAuth = byId('permAuth');
        if (permAuth) {
            permAuth.addEventListener('click', async function () {
                if (!window.__vrPerm || window.__vrPerm.writable) { openOptions(); return; }
                /* 已经选过目录：优先沿用现有句柄申请写入权限。
                 * 浏览器的目录权限在页面刷新/一段时间后会退回 prompt，
                 * 让用户再选一次目录既反直觉也不安全。 */
                var saved = window.__vrPerm.handle;
                if (saved && typeof saved.requestPermission === 'function') {
                    try {
                        var st = await saved.requestPermission({ mode: 'readwrite' });
                        if (st === 'granted') {
                            var rr0 = await root.VRIndex.resolveRoot();
                            var want = rr0.absRoot
                                ? String(rr0.absRoot).replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop()
                                : String(rr0.prefix || '');
                            if (want && saved.name !== want) {
                                try { saved = await saved.getDirectoryHandle(want); }
                                catch (e3) { saved = null; }
                            }
                            if (saved) {
                                await root.VRIndex.setRoot(saved, rr0.absRoot, rr0.prefix);
                                toast('已恢复写入权限');
                                await refreshPermState();
                                return;
                            }
                        }
                    } catch (e) { /* 落到重新选择 */ }
                }
                if (typeof root.showDirectoryPicker !== 'function') {
                    toast('此浏览器不支持目录授权，请到完整设置页操作');
                    openOptions();
                    return;
                }
                try {
                    /* 用户点按钮时直接调 picker，保住 user gesture；
                     * 选择素材库根目录（video-rod），再写回 handle/absRoot/prefix。 */
                    var h = await root.showDirectoryPicker({ mode: 'readwrite' });
                    var rr = await root.VRIndex.resolveRoot();
                    var expected = rr.absRoot
                        ? String(rr.absRoot).replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop()
                        : String(rr.prefix || '');
                    if (!expected) {
                        toast('素材库路径为空，请先在设置页填写保存位置');
                        return;
                    }
                    if (h.name !== expected) {
                        /* 允许用户选中父目录（如 Downloads），自动下钻到 video-rod，
                         * 但必须真的存在这个子目录；选错空目录直接拒绝。 */
                        try {
                            h = await h.getDirectoryHandle(expected);
                        } catch (e2) {
                            toast('请选择素材库根目录「' + expected + '」，当前选的是「' + h.name + '」');
                            return;
                        }
                    }
                    await root.VRIndex.setRoot(h, rr.absRoot, rr.prefix);
                    toast('已授权素材目录');
                    await refreshPermState();
                } catch (e) {
                    if (e && e.name === 'AbortError') { return; }
                    toast('授权失败：' + ((e && e.message) || '未知'));
                }
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
            var name = '筛选 ' + new Date().toLocaleDateString();
            FAVS.push({
                id: 'f' + Date.now(), name: name,
                ids: FILES.map(function (f) { return f.id; })
            });
            saveFavs(); renderFavs(); renderFavDrawer();
            toast('已把当前筛选存成收藏夹「' + name + '」');
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
            var arr = FAVS.filter(function (x) { return x.id === S.fav; });
            return arr[0] || null;
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
            bmBtn.addEventListener('click', function () {
                var list = FILES.filter(function (f) { return S.sel.has(f.id); });
                if (!list.length) { toast('先选素材'); return; }
                if (!root.VRMovePicker) { toast('移动模块没加载，请刷新页面'); return; }
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
        try { window.__vrBoot = ['start']; } catch (e) { /* 忽略 */ }
        try { installGlobalErrorGuard(); } catch (e) { /* 忽略 */ }
        try { bind(); window.__vrBoot.push('bind'); } catch (e) { window.__vrBoot.push('bind-ERR:' + e.message); throw e; }
        try { bindMissing(); window.__vrBoot.push('bindMissing'); } catch (e) { window.__vrBoot.push('bindMissing-ERR'); }
        try { await loadFavs(); window.__vrBoot.push('favs'); } catch (e) { window.__vrBoot.push('favs-ERR:' + e.message); }
        try { await ensureRoot(); window.__vrBoot.push('root'); } catch (e) { window.__vrBoot.push('root-ERR:' + e.message); }
        try { await refreshPermState(); window.__vrBoot.push('perm'); } catch (e) { window.__vrBoot.push('perm-ERR:' + e.message); }
        try { await load(); window.__vrBoot.push('load:' + FILES.length); } catch (e) { window.__vrBoot.push('load-ERR:' + e.message); }
        if (!FILES.length) {
            /* 索引建完必须重新读一次库（不管 build 返回什么）： */
            try { await autoIndex(); } catch (e) { /* 未授权等，落到空态 */ }
            await load();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    root.VRApp = { reload: load, toast: toast, getFiles: function () { return FILES; } };
    root.VRFav = { toggleStar: toggleStar, addToFav: addToFav, addToDefault: addToDefault, hasFavorite: hasFavorite };
})();
