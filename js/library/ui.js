/* ==========================================================
 * 资源库页面 v2 —— 概览 / 博主速览 / 网格 / 表格
 *
 * 数据：VRDB.getAllFiles()（只读）；缩略图：VRThumbs 懒生成。
 * 不含 S4 灯箱/视频弹层、S5 回收站。
 * ========================================================== */
(function (root) {
    'use strict';

    var state = {
        type: 'all',          // all | video | image | audio
        platform: '',
        creator: '',
        starred: false,
        q: '',
        sort: 'new',          // new | old | name | size
        group: 'none',        // none | date
        view: 'grid'          // grid | list
    };

    var all = [];
    var map = {};
    var objectUrls = [];
    var searchTimer = 0;
    var rendered = [];
    var viewerIndex = -1;

    var PLAT = {
        bilibili: { name: 'B站', short: 'B', color: '#fb7299' },
        xiaohongshu: { name: '小红书', short: '红', color: '#ff2442' },
        x: { name: 'X', short: 'X', color: '#111827' },
        youtube: { name: 'YouTube', short: 'Y', color: '#ff0033' },
        web: { name: '其他网页', short: '网', color: '#64748b' }
    };

    var TYPE_LABEL = { video: '视频', image: '图片', audio: '音频', other: '其他' };

    function $(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function formatBytes(n) {
        n = Number(n) || 0;
        if (n < 1024) { return n + ' B'; }
        var units = ['KB', 'MB', 'GB', 'TB'];
        var i = -1;
        do { n = n / 1024; i++; } while (n >= 1024 && i < units.length - 1);
        return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + units[i];
    }

    function sizeParts(n) {
        n = Number(n) || 0;
        if (n < 1024) { return { v: String(Math.round(n)), u: 'B' }; }
        var units = ['KB', 'MB', 'GB', 'TB'];
        var i = -1;
        do { n = n / 1024; i++; } while (n >= 1024 && i < units.length - 1);
        return { v: n < 10 ? n.toFixed(1) : String(Math.round(n)), u: units[i] };
    }

    function formatDate(ts, withTime) {
        if (!ts) { return ''; }
        var d = new Date(ts);
        if (isNaN(d.getTime())) { return ''; }
        var md = (d.getMonth() + 1) + '-' + d.getDate();
        if (!withTime) { return md; }
        return md + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }

    function formatDuration(sec) {
        sec = Math.floor(Number(sec) || 0);
        if (!sec) { return ''; }
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        if (h) { return h + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2); }
        return m + ':' + ('0' + s).slice(-2);
    }

    function typeLabel(t) { return TYPE_LABEL[t] || '其他'; }

    function platOf(e) { return PLAT[e.platform] || PLAT.web; }

    function platformName(e) { return e.platformName || platOf(e).name; }

    function creatorName(e) {
        return e.creatorFull || e.creatorId || '待整理';
    }

    function creatorMeta(e) {
        return e.creatorId ? '@' + e.creatorId : '无账号 ID';
    }

    function fileName(e) {
        return e.fileName || String(e.relPath || '').split('/').pop() || '';
    }

    function matches(e) {
        if (state.starred && !e.starred) { return false; }
        if (state.type !== 'all' && e.type !== state.type) { return false; }
        if (state.platform && (e.platform || 'web') !== state.platform) { return false; }
        if (state.creator && creatorName(e) !== state.creator) { return false; }
        if (state.q) {
            var hay = [fileName(e), e.title, e.creatorFull, e.creatorId, e.platformName, e.relPath]
                .join(' ').toLowerCase();
            if (hay.indexOf(state.q) === -1) { return false; }
        }
        return true;
    }

    function sorted(list) {
        var out = list.slice();
        if (state.sort === 'name') {
            out.sort(function (a, b) { return fileName(a).localeCompare(fileName(b), 'zh-Hans-CN'); });
        } else if (state.sort === 'size') {
            out.sort(function (a, b) { return (b.size || 0) - (a.size || 0); });
        } else if (state.sort === 'old') {
            out.sort(function (a, b) { return (a.mtime || 0) - (b.mtime || 0); });
        } else {
            out.sort(function (a, b) { return (b.mtime || 0) - (a.mtime || 0); });
        }
        return out;
    }

    function counts() {
        var c = { all: all.length, video: 0, image: 0, audio: 0, starred: 0, platforms: {}, creators: {} };
        all.forEach(function (e) {
            if (c[e.type] !== undefined) { c[e.type]++; }
            if (e.starred) { c.starred++; }
            var p = e.platform || 'web';
            c.platforms[p] = (c.platforms[p] || 0) + 1;
            var cr = creatorName(e);
            c.creators[cr] = (c.creators[cr] || 0) + 1;
        });
        return c;
    }

    function pct(n, total) {
        if (!total) { return 0; }
        return Math.round((n / total) * 100);
    }

    function sideItem(attrs, label, n, active, icon) {
        return '<button class="side-item' + (active ? ' on' : '') + '" ' + attrs + ' type="button">' +
            (icon || '') +
            '<span class="label">' + esc(label) + '</span>' +
            '<span class="n">' + n + '</span></button>';
    }

    function platIcon(p) {
        var meta = PLAT[p] || PLAT.web;
        return '<span class="pdot" style="--pc:' + meta.color + '">' + esc(meta.short) + '</span>';
    }

    function creatorIcon(name, color) {
        return '<span class="avatar" style="--pc:' + color + '">' + esc(String(name).slice(0, 1)) + '</span>';
    }

    function renderSide() {
        var c = counts();

        $('libTypeNav').innerHTML =
            sideItem('data-type="all" role="tab"', '全部资源', c.all, state.type === 'all' && !state.starred) +
            sideItem('data-type="video" role="tab"', '视频', c.video, state.type === 'video') +
            sideItem('data-type="image" role="tab"', '图片', c.image, state.type === 'image') +
            sideItem('data-type="audio" role="tab"', '音频', c.audio, state.type === 'audio') +
            sideItem('data-starred="1" role="tab"', '星标', c.starred, state.starred);

        var pKeys = Object.keys(c.platforms).sort(function (a, b) { return c.platforms[b] - c.platforms[a]; });
        $('libPlatformNav').innerHTML = pKeys.map(function (p) {
            return sideItem('data-platform="' + esc(p) + '"', (PLAT[p] || PLAT.web).name,
                c.platforms[p], state.platform === p, platIcon(p));
        }).join('') || '<div class="side-empty">暂无平台数据</div>';

        var crKeys = Object.keys(c.creators).sort(function (a, b) { return c.creators[b] - c.creators[a]; }).slice(0, 60);
        $('libCreatorNav').innerHTML = crKeys.map(function (cr) {
            var first = null;
            for (var i = 0; i < all.length; i++) {
                if (creatorName(all[i]) === cr) { first = all[i]; break; }
            }
            var color = first ? platOf(first).color : '#64748b';
            return sideItem('data-creator="' + esc(cr) + '"', cr, c.creators[cr],
                state.creator === cr, creatorIcon(cr, color));
        }).join('') || '<div class="side-empty">暂无博主数据</div>';

        var sel = $('libPlatformSelect');
        if (sel) {
            sel.innerHTML = '<option value="">全部平台</option>' + pKeys.map(function (p) {
                return '<option value="' + esc(p) + '">' + esc((PLAT[p] || PLAT.web).name) + '（' + c.platforms[p] + '）</option>';
            }).join('');
            sel.value = state.platform || '';
        }
    }

    /* ---------------- 概览（全局统计） ---------------- */

    function renderOverview() {
        var box = $('libOverview');
        if (!box) { return; }
        var n = all.length;
        if (!n) { box.hidden = true; return; }
        box.hidden = false;

        var c = counts();
        var bytes = all.reduce(function (s, e) { return s + (Number(e.size) || 0); }, 0);
        var missing = all.filter(function (e) { return e.state === 'missing'; }).length;
        var sp = sizeParts(bytes);

        $('libKpiTotal').textContent = n;
        $('libKpiTotalFoot').textContent = '图片 ' + c.image + ' · 视频 ' + c.video + ' · 音频 ' + c.audio +
            (missing ? ' · 缺失 ' + missing : '');
        $('libKpiSize').textContent = sp.v;
        $('libKpiSizeUnit').textContent = sp.u;
        $('libKpiSizeFoot').textContent = '平均 ' + formatBytes(Math.round(bytes / n)) + ' / 项';
        $('libKpiImage').textContent = c.image;
        $('libKpiImageFoot').textContent = '占 ' + pct(c.image, n) + '% · 共 ' +
            formatBytes(all.reduce(function (s, e) { return s + (e.type === 'image' ? Number(e.size) || 0 : 0); }, 0));
        $('libKpiVideo').textContent = c.video;
        $('libKpiVideoFoot').textContent = '占 ' + pct(c.video, n) + '% · 共 ' +
            formatBytes(all.reduce(function (s, e) { return s + (e.type === 'video' ? Number(e.size) || 0 : 0); }, 0));

        $('libKpiImageBar').style.width = pct(c.image, n) + '%';
        $('libKpiVideoBar').style.width = pct(c.video, n) + '%';

        var pKeys = Object.keys(c.platforms).sort(function (a, b) { return c.platforms[b] - c.platforms[a]; });
        $('libPlatMeta').textContent = pKeys.length + ' 个平台';
        $('libPlatStack').innerHTML = pKeys.map(function (p) {
            var meta = PLAT[p] || PLAT.web;
            return '<i style="width:' + Math.max(2, (c.platforms[p] / n) * 100) + '%;background:' + meta.color + '"></i>';
        }).join('');
        $('libPlatStack').setAttribute('aria-label', pKeys.map(function (p) {
            return (PLAT[p] || PLAT.web).name + ' ' + c.platforms[p] + ' 项';
        }).join('，'));

        $('libPlatLegend').innerHTML = pKeys.map(function (p) {
            var meta = PLAT[p] || PLAT.web;
            return '<div class="legend-item">' +
                '<span class="dot" style="--c:' + meta.color + '"></span>' +
                '<span class="nm">' + esc(meta.name) + '</span>' +
                '<b>' + c.platforms[p] + '</b>' +
                '<span class="pct">' + pct(c.platforms[p], n) + '%</span></div>';
        }).join('');

        var tops = Object.keys(c.creators)
            .map(function (k) { return { name: k, n: c.creators[k] }; })
            .sort(function (a, b) { return b.n - a.n; })
            .slice(0, 5);
        var max = tops.length ? tops[0].n : 1;
        $('libCreatorBars').innerHTML = tops.map(function (t) {
            return '<div class="bar-row">' +
                '<span class="nm" title="' + esc(t.name) + '">' + esc(t.name) + '</span>' +
                '<span class="track"><i class="fill" style="width:' + Math.max(4, (t.n / max) * 100) + '%"></i></span>' +
                '<b>' + t.n + '</b></div>';
        }).join('') || '<div class="side-empty">暂无数据</div>';
    }

    /* ---------------- 博主速览 ---------------- */

    function renderCreators() {
        var block = $('libCreatorBlock');
        var box = $('libCreators');
        if (!block || !box) { return; }

        var show = state.view !== 'list' && !state.creator && !state.q &&
            state.type === 'all' && !state.starred;
        if (!show || !all.length) {
            block.hidden = true;
            box.innerHTML = '';
            return;
        }

        var pool = state.platform
            ? all.filter(function (e) { return (e.platform || 'web') === state.platform; })
            : all;

        var groups = {};
        pool.forEach(function (e) {
            var k = creatorName(e);
            (groups[k] = groups[k] || []).push(e);
        });
        var keys = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length; });
        if (keys.length < 2) { block.hidden = true; box.innerHTML = ''; return; }

        block.hidden = false;
        box.innerHTML = keys.slice(0, 12).map(function (k) {
            var items = groups[k];
            var first = items[0];
            var imgs = items.filter(function (e) { return e.type === 'image'; }).length;
            var vids = items.filter(function (e) { return e.type === 'video'; }).length;
            var color = platOf(first).color;
            var single = items.length < 4;
            var picks = single ? items.slice(0, 1) : items.slice(0, 4);
            var mosaic = picks.map(function (e) {
                return '<span class="mi t-' + esc(e.type || 'other') + '">' +
                    '<img alt="" loading="lazy" data-thumb="' + esc(e.relPath) + '"></span>';
            }).join('');
            var blanks = '';
            if (!single) {
                for (var i = picks.length; i < 4; i++) { blanks += '<span class="mi blank"></span>'; }
            }
            return '<button type="button" class="ccard" data-creator="' + esc(k) + '">' +
                creatorIcon(k, color) +
                '<span class="info">' +
                '<span class="nm" title="' + esc(k) + '">' + esc(k) + '</span>' +
                '<span class="id">' + esc(creatorMeta(first)) + '</span>' +
                '<span class="cnt">图片 ' + imgs + '<i>·</i>视频 ' + vids + '</span>' +
                '</span>' +
                '<span class="mosaic' + (single ? ' single' : '') + '">' + mosaic + blanks + '</span>' +
                '</button>';
        }).join('');
    }

    /* ---------------- 媒体卡片 ---------------- */

    function thumbHtml(e) {
        var label = typeLabel(e.type);
        return '<div class="thumb">' +
            '<div class="ph t-' + esc(e.type || 'other') + '"><span>' + esc(label) + '</span></div>' +
            '<img alt="" loading="lazy" data-thumb="' + esc(e.relPath) + '">' +
            '<span class="type-chip">' + esc(label) + '</span>' +
            (e.duration ? '<span class="dur">' + formatDuration(e.duration) + '</span>' : '') +
            '<button type="button" class="star' + (e.starred ? ' on' : '') + '" data-star="' + esc(e.relPath) + '" ' +
            'aria-label="' + (e.starred ? '取消星标' : '加星标') + '">' + (e.starred ? '★' : '☆') + '</button>' +
            (e.state === 'missing' ? '<span class="missing-tag">文件缺失</span>' : '') +
            '</div>';
    }

    function cardHtml(e) {
        var color = platOf(e).color;
        return '<article class="lib-card' + (e.state === 'missing' ? ' missing' : '') + '" ' +
            'data-rel="' + esc(e.relPath) + '" tabindex="0">' +
            thumbHtml(e) +
            '<div class="body">' +
            '<h3 title="' + esc(fileName(e)) + '">' + esc(fileName(e)) + '</h3>' +
            '<p class="sub"><span class="pdot" style="--pc:' + color + '"></span>' +
            esc(platformName(e)) + ' · ' + esc(creatorName(e)) + '</p>' +
            '<p class="facts"><span>' + formatBytes(e.size) + '</span><span>' + formatDate(e.mtime) + '</span></p>' +
            '</div></article>';
    }

    function rowHtml(e) {
        var color = platOf(e).color;
        return '<tr class="lib-row' + (e.state === 'missing' ? ' missing' : '') + '" ' +
            'data-rel="' + esc(e.relPath) + '" tabindex="0">' +
            '<td class="c-thumb"><div class="row-thumb">' +
            '<div class="ph t-' + esc(e.type || 'other') + '"><span>' + esc(typeLabel(e.type)) + '</span></div>' +
            '<img alt="" loading="lazy" data-thumb="' + esc(e.relPath) + '">' +
            (e.duration ? '<span class="dur">' + formatDuration(e.duration) + '</span>' : '') +
            '</div></td>' +
            '<td class="c-name"><div class="row-main">' +
            '<div class="row-name" title="' + esc(fileName(e)) + '">' + esc(fileName(e)) + '</div>' +
            '<div class="row-sub">' + esc(e.relPath || '') + '</div>' +
            '</div></td>' +
            '<td class="c-plat"><span class="row-plat"><i class="dot" style="--pc:' + color + '"></i>' +
            esc(platformName(e)) + '</span></td>' +
            '<td class="c-creator"><span class="row-creator">' + esc(creatorName(e)) + '</span></td>' +
            '<td class="c-type"><span class="row-type">' + esc(typeLabel(e.type)) + '</span></td>' +
            '<td class="c-size"><span class="row-size">' + formatBytes(e.size) + '</span></td>' +
            '<td class="c-date"><span class="row-date">' + formatDate(e.mtime, true) + '</span></td>' +
            '<td class="c-act"><button type="button" class="star' + (e.starred ? ' on' : '') + '" ' +
            'data-star="' + esc(e.relPath) + '" aria-label="' + (e.starred ? '取消星标' : '加星标') + '">' +
            (e.starred ? '★' : '☆') + '</button></td>' +
            '</tr>';
    }

    /* ---------------- 分组 ---------------- */

    function dayBucket(ts) {
        var d = new Date(ts || 0);
        if (isNaN(d.getTime())) { return '更早'; }
        var now = new Date();
        var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        var startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        var diff = Math.round((startToday - startDay) / 86400000);
        if (diff <= 0) { return '今天'; }
        if (diff === 1) { return '昨天'; }
        if (diff < 7) { return '本周内'; }
        if (diff < 30) { return '本月内'; }
        return '更早';
    }

    function groupList(list) {
        var order = [];
        var buckets = {};
        list.forEach(function (e) {
            var k = dayBucket(e.mtime);
            if (!buckets[k]) { buckets[k] = []; order.push(k); }
            buckets[k].push(e);
        });
        return order.map(function (k) { return { label: k, items: buckets[k] }; });
    }

    function gridHtml(list) {
        if (state.group !== 'date') { return list.map(cardHtml).join(''); }
        return groupList(list).map(function (g) {
            return '<div class="lib-day"><b>' + esc(g.label) + '</b>' +
                '<span>' + g.items.length + ' 项</span><i class="ln"></i></div>' +
                g.items.map(cardHtml).join('');
        }).join('');
    }

    function tableHtml(list) {
        if (state.group !== 'date') { return list.map(rowHtml).join(''); }
        return groupList(list).map(function (g) {
            return '<tr class="day-row"><td colspan="8"><b>' + esc(g.label) + '</b>' +
                '<span>' + g.items.length + ' 项</span></td></tr>' +
                g.items.map(rowHtml).join('');
        }).join('');
    }

    /* ---------------- 筛选 chip / 空态 ---------------- */

    function renderActiveFilters() {
        var el = $('libActiveFilters');
        var chips = [];
        if (state.platform) {
            chips.push('<button type="button" class="active-chip" data-clear="platform">' +
                esc((PLAT[state.platform] || PLAT.web).name) + ' ×</button>');
        }
        if (state.creator) {
            chips.push('<button type="button" class="active-chip" data-clear="creator">' + esc(state.creator) + ' ×</button>');
        }
        if (state.starred) {
            chips.push('<button type="button" class="active-chip" data-clear="starred">仅星标 ×</button>');
        }
        if (state.q) {
            chips.push('<button type="button" class="active-chip" data-clear="q">“' + esc(state.q) + '” ×</button>');
        }
        el.innerHTML = chips.join('');
        el.hidden = chips.length === 0;
    }

    function renderEmpty(total) {
        var empty = $('libEmpty');
        if (total > 0) { empty.hidden = true; return; }
        empty.hidden = false;
        var isBlank = all.length === 0;
        $('libEmptyTitle').textContent = isBlank ? '还没有资源' : '没有匹配的资源';
        $('libEmptyText').textContent = isBlank
            ? '资源库索引是空的。去设置页重建索引，或先下载一个文件。'
            : '换个关键词，或清掉当前筛选条件。';
        $('libEmptyAction').textContent = isBlank ? '去设置页' : '清空筛选';
        $('libEmptyAction').dataset.action = isBlank ? 'options' : 'clear';
    }

    /* ---------------- 缩略图懒加载 ---------------- */

    var observer = null;

    function observeThumbs() {
        if (observer) { observer.disconnect(); }
        var nodes = document.querySelectorAll('[data-thumb]');
        if (!('IntersectionObserver' in window)) {
            [].forEach.call(nodes, function (img) {
                var e = map[img.getAttribute('data-thumb')];
                if (e) { root.VRThumbs.enqueue(e); }
            });
            return;
        }
        observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) { return; }
                var img = entry.target;
                var e = map[img.getAttribute('data-thumb')];
                if (e) { root.VRThumbs.enqueue(e); }
                observer.unobserve(img);
            });
        }, { rootMargin: '160px' });
        [].forEach.call(nodes, function (img) { observer.observe(img); });
    }

    /* ---------------- 主渲染 ---------------- */

    function renderMain() {
        var list = sorted(all.filter(matches));
        rendered = list;
        var totalBytes = list.reduce(function (n, e) { return n + (Number(e.size) || 0); }, 0);

        var titles = { all: '全部资源', video: '视频', image: '图片', audio: '音频' };
        $('libTitle').textContent = state.starred ? '星标资源' : (titles[state.type] || '全部资源');
        $('libSub').textContent = '共 ' + list.length + ' 项' + (list.length ? ' · ' + formatBytes(totalBytes) : '');

        $('libCrumb').innerHTML = '<span>资源库</span><i class="sep">/</i><b>' +
            esc($('libTitle').textContent) + '</b>' +
            (state.creator ? '<i class="sep">/</i><span>' + esc(state.creator) + '</span>' : '');

        var grid = $('libGrid');
        var listEl = $('libList');
        var listMode = state.view === 'list';
        grid.hidden = list.length === 0 || listMode;
        listEl.hidden = list.length === 0 || !listMode;
        // 表格是紧凑管理视图：收起概览，让内容直接进视野
        $('libOverview').hidden = listMode || all.length === 0;

        if (state.view === 'grid') {
            grid.innerHTML = gridHtml(list);
        } else {
            $('libListBody').innerHTML = tableHtml(list);
        }
        renderEmpty(list.length);
        renderActiveFilters();
        observeThumbs();
    }

    function apply() {
        renderSide();
        renderOverview();
        renderCreators();
        renderMain();
    }

    function renderRoot() {
        var pathEl = $('libRootPath');
        var metaEl = $('libRootMeta');
        if (!pathEl) { return; }
        var total = all.length;
        var missing = all.filter(function (e) { return e.state === 'missing'; }).length;
        pathEl.textContent = '未探测';
        metaEl.textContent = total
            ? (total + ' 个文件' + (missing ? ' · 缺失 ' + missing : '') + ' · 本地读取')
            : '索引为空';
        try {
            chrome.storage.local.get('vrLibSettings', function (o) {
                var s = (o && o.vrLibSettings) || {};
                var base = s.mode === 'custom' ? s.customRoot
                    : (s.detectedRoot ? s.detectedRoot + '\\' + (s.subdir || 'video-rod') : '');
                if (base) { pathEl.textContent = base; }
            });
        } catch (e) { /* 非扩展环境 */ }
    }

    async function loadData() {
        if (typeof root.VRDB === 'undefined') { return; }
        try {
            all = await root.VRDB.getAllFiles();
        } catch (e) {
            all = [];
        }
        map = {};
        all.forEach(function (e) { map[e.relPath] = e; });
        renderRoot();
        apply();
    }

    function setView(v) {
        state.view = v === 'list' ? 'list' : 'grid';
        $('libViewGrid').classList.toggle('on', state.view === 'grid');
        $('libViewList').classList.toggle('on', state.view === 'list');
        try { localStorage.setItem('vrLibView', state.view); } catch (e) { /* 忽略 */ }
        renderCreators();
        renderMain();
    }

    function clearFilters() {
        state.platform = '';
        state.creator = '';
        state.starred = false;
        state.type = 'all';
        state.q = '';
        var input = $('libSearch');
        if (input) { input.value = ''; }
        apply();
    }

    async function toggleStar(relPath) {
        var e = map[relPath];
        if (!e) { return; }
        var next = e.starred ? 0 : 1;
        e.starred = next;
        try {
            await root.VRDB.patchFile(relPath, { starred: next });
        } catch (err) { /* 界面先反馈，落库失败下次刷新会回退 */ }
        apply();
    }

    /* ---------------- 全屏查看器 ---------------- */

    function viewerEntries() {
        return rendered.length ? rendered : all;
    }

    function openEntry(relPath) {
        var e = map[relPath];
        if (!e || !e.absPath || !root.VRPath) { return; }
        try {
            chrome.tabs.create({ url: root.VRPath.toFileUrl(e.absPath) });
        } catch (err) { /* 忽略 */ }
    }

    function paintViewer() {
        var list = viewerEntries();
        var e = list[viewerIndex];
        if (!e) { return; }
        var stage = $('libViewerStage');
        stage.innerHTML = '';

        var url = (e.absPath && root.VRPath) ? root.VRPath.toFileUrl(e.absPath) : '';
        if (e.state === 'missing' || !url) {
            stage.innerHTML = '<div class="viewer-missing">文件已不在原位置，可用「在文件中打开」重新定位</div>';
        } else if (e.type === 'image') {
            var img = document.createElement('img');
            img.src = url;
            img.alt = fileName(e);
            stage.appendChild(img);
        } else if (e.type === 'video') {
            var v = document.createElement('video');
            v.src = url;
            v.controls = true;
            v.autoplay = true;
            v.playsInline = true;
            stage.appendChild(v);
        } else {
            stage.innerHTML = '<div class="viewer-missing">该类型暂不支持预览，可用「在文件中打开」</div>';
        }

        $('libViewerTitle').textContent = fileName(e);
        $('libViewerMeta').textContent = (viewerIndex + 1) + ' / ' + list.length + ' · ' +
            typeLabel(e.type) + ' · ' + platformName(e) + ' · ' + creatorName(e) + ' · ' + formatBytes(e.size);
        $('libViewerPrev').disabled = list.length < 2;
        $('libViewerNext').disabled = list.length < 2;
        $('libViewerOpen').dataset.rel = e.relPath;
    }

    function openViewer(relPath) {
        var list = viewerEntries();
        var idx = -1;
        for (var i = 0; i < list.length; i++) {
            if (list[i].relPath === relPath) { idx = i; break; }
        }
        if (idx < 0) { return; }
        viewerIndex = idx;
        $('libViewer').hidden = false;
        document.body.classList.add('viewer-open');
        paintViewer();
    }

    function closeViewer() {
        var v = $('libViewerStage').querySelector('video');
        if (v) { try { v.pause(); } catch (e) { /* 忽略 */ } }
        $('libViewerStage').innerHTML = '';
        $('libViewer').hidden = true;
        document.body.classList.remove('viewer-open');
        viewerIndex = -1;
    }

    function stepViewer(step) {
        var list = viewerEntries();
        if (list.length < 2) { return; }
        viewerIndex = (viewerIndex + step + list.length) % list.length;
        paintViewer();
    }

    function bind() {
        document.addEventListener('click', function (ev) {
            var tab = ev.target.closest('.side-item');
            if (tab) {
                if (tab.dataset.type !== undefined) {
                    state.type = tab.dataset.type;
                    state.starred = false;
                }
                if (tab.dataset.starred !== undefined) {
                    state.starred = true;
                    state.type = 'all';
                }
                if (tab.dataset.platform !== undefined) {
                    state.platform = state.platform === tab.dataset.platform ? '' : tab.dataset.platform;
                }
                if (tab.dataset.creator !== undefined) {
                    state.creator = state.creator === tab.dataset.creator ? '' : tab.dataset.creator;
                }
                apply();
                return;
            }

            var card = ev.target.closest('.ccard');
            if (card && card.dataset.creator) {
                state.creator = card.dataset.creator;
                apply();
            }
        });

        var search = $('libSearch');
        search.addEventListener('input', function () {
            clearTimeout(searchTimer);
            var v = search.value.trim().toLowerCase();
            searchTimer = setTimeout(function () {
                state.q = v;
                apply();
            }, 150);
        });

        $('libSort').addEventListener('change', function () {
            state.sort = this.value;
            renderMain();
        });

        $('libGroup').addEventListener('change', function () {
            state.group = this.value === 'date' ? 'date' : 'none';
            renderMain();
        });

        var platSel = $('libPlatformSelect');
        if (platSel) {
            platSel.addEventListener('change', function () {
                state.platform = this.value;
                apply();
            });
        }

        $('libViewGrid').addEventListener('click', function () { setView('grid'); });
        $('libViewList').addEventListener('click', function () { setView('list'); });

        $('libRefresh').addEventListener('click', function () { loadData(); });
        $('libOptions').addEventListener('click', openOptions);
        $('libFootOptions').addEventListener('click', openOptions);

        $('libActiveFilters').addEventListener('click', function (ev) {
            var chip = ev.target.closest('[data-clear]');
            if (!chip) { return; }
            var k = chip.dataset.clear;
            if (k === 'starred') {
                state.starred = false;
            } else if (k === 'type') {
                state.type = 'all';
            } else {
                state[k] = '';
            }
            if (k === 'q') { search.value = ''; }
            apply();
        });

        $('libEmptyAction').addEventListener('click', function () {
            if (this.dataset.action === 'options') {
                openOptions();
            } else {
                clearFilters();
            }
        });

        ['libGrid', 'libList'].forEach(function (id) {
            var box = $(id);
            box.addEventListener('click', function (ev) {
                var star = ev.target.closest('[data-star]');
                if (star) {
                    ev.stopPropagation();
                    toggleStar(star.dataset.star);
                    return;
                }
                var card = ev.target.closest('[data-rel]');
                if (card) { openViewer(card.dataset.rel); }
            });
            box.addEventListener('keydown', function (ev) {
                if (ev.key !== 'Enter' && ev.key !== ' ') { return; }
                var card = ev.target.closest('[data-rel]');
                if (card) {
                    ev.preventDefault();
                    openViewer(card.dataset.rel);
                }
            });
        });

        window.addEventListener('vrthumb', function (ev) {
            var d = ev.detail || {};
            if (!d.blob) { return; }
            var url = URL.createObjectURL(d.blob);
            objectUrls.push(url);
            [].forEach.call(document.querySelectorAll('[data-thumb]'), function (el) {
                if (el.getAttribute('data-thumb') !== d.relPath) { return; }
                el.src = url;
                el.classList.add('loaded');
            });
        });

        $('libViewerClose').addEventListener('click', closeViewer);
        $('libViewerPrev').addEventListener('click', function () { stepViewer(-1); });
        $('libViewerNext').addEventListener('click', function () { stepViewer(1); });
        $('libViewerOpen').addEventListener('click', function () { openEntry(this.dataset.rel); });
        $('libViewer').addEventListener('click', function (ev) {
            if (ev.target.id === 'libViewer' || ev.target.id === 'libViewerStage') { closeViewer(); }
        });
        document.addEventListener('keydown', function (ev) {
            if (!$('libViewer').hidden) {
                if (ev.key === 'Escape') { ev.preventDefault(); closeViewer(); return; }
                if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepViewer(-1); return; }
                if (ev.key === 'ArrowRight') { ev.preventDefault(); stepViewer(1); return; }
            }
            if (ev.key === '/' && document.activeElement !== search) {
                ev.preventDefault();
                search.focus();
            }
            if (ev.key === 'Escape' && document.activeElement === search) {
                search.value = '';
                state.q = '';
                apply();
            }
        });

        try {
            var saved = localStorage.getItem('vrLibView');
            setView(saved === 'list' ? 'list' : 'grid');
        } catch (e) { setView('grid'); }
    }

    function openOptions() {
        try {
            chrome.tabs.create({ url: chrome.runtime.getURL('options.html#anchorLibrary') });
        } catch (e) { /* 忽略 */ }
    }

    function init() {
        if (!$('libGrid')) { return; }
        bind();
        loadData();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    root.VRLibrary = {
        reload: loadData,
        state: state,
        _open: openEntry
    };
})(typeof self !== 'undefined' ? self : this);
