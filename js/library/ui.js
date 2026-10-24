/* ==========================================================
 * 资源库页面（S3）—— 浏览 / 筛选 / 搜索 / 排序 / 网格·列表
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
        sort: 'new',          // new | name | size
        view: 'grid'          // grid | list
    };

    var all = [];
    var map = {};
    var objectUrls = [];
    var searchTimer = 0;
    var rendered = [];
    var viewerIndex = -1;

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

    function formatDate(ts) {
        if (!ts) { return ''; }
        var d = new Date(ts);
        if (isNaN(d.getTime())) { return ''; }
        return (d.getMonth() + 1) + '-' + d.getDate();
    }

    function formatDuration(sec) {
        sec = Math.floor(Number(sec) || 0);
        if (!sec) { return ''; }
        var m = Math.floor(sec / 60);
        var s = sec % 60;
        return m + ':' + ('0' + s).slice(-2);
    }

    var TYPE_LABEL = { video: '视频', image: '图片', audio: '音频', other: '其他' };

    function typeLabel(t) { return TYPE_LABEL[t] || '其他'; }

    function platformName(e) {
        return e.platformName || ({ bilibili: 'B站', xiaohongshu: '小红书', x: 'X', youtube: 'YouTube', web: '其他网页' })[e.platform] || '其他网页';
    }

    function creatorName(e) {
        return e.creatorFull || e.creatorId || '待整理';
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

    function sideItem(attrs, label, n, active) {
        return '<button class="side-item' + (active ? ' on' : '') + '" ' + attrs + '>' +
            '<span class="label">' + esc(label) + '</span>' +
            '<span class="n">' + n + '</span></button>';
    }

    function renderSide() {
        var c = counts();
        var typeHtml = '';
        typeHtml += sideItem('data-type="all"', '全部资源', c.all, state.type === 'all' && !state.starred);
        typeHtml += sideItem('data-type="video"', '视频', c.video, state.type === 'video');
        typeHtml += sideItem('data-type="image"', '图片', c.image, state.type === 'image');
        typeHtml += sideItem('data-type="audio"', '音频', c.audio, state.type === 'audio');
        typeHtml += sideItem('data-starred="1"', '星标', c.starred, state.starred);
        $('libTypeNav').innerHTML = typeHtml;

        var pKeys = Object.keys(c.platforms).sort(function (a, b) { return c.platforms[b] - c.platforms[a]; });
        $('libPlatformNav').innerHTML = pKeys.map(function (p) {
            var name = ({ bilibili: 'B站', xiaohongshu: '小红书', x: 'X', youtube: 'YouTube', web: '其他网页' })[p] || p;
            return sideItem('data-platform="' + esc(p) + '"', name, c.platforms[p], state.platform === p);
        }).join('') || '<div class="side-empty">—</div>';

        var crKeys = Object.keys(c.creators).sort(function (a, b) { return c.creators[b] - c.creators[a]; }).slice(0, 40);
        $('libCreatorNav').innerHTML = crKeys.map(function (cr) {
            return sideItem('data-creator="' + esc(cr) + '"', cr, c.creators[cr], state.creator === cr);
        }).join('') || '<div class="side-empty">—</div>';
    }

    function renderFoot() {
        var el = $('libFoot');
        if (!el) { return; }
        var fallback = all.length ? ('索引 ' + all.length + ' 条 · 本地文件') : '索引为空';
        el.textContent = fallback;
        try {
            chrome.storage.local.get('vrLibSettings', function (o) {
                var s = (o && o.vrLibSettings) || {};
                var base = s.mode === 'custom' ? s.customRoot : (s.detectedRoot ? s.detectedRoot + '\\' + (s.subdir || 'video-rod') : '');
                el.textContent = base ? ('根目录：' + base) : fallback;
            });
        } catch (e) { /* 非扩展环境 */ }
    }

    function thumbHtml(e) {
        var label = typeLabel(e.type);
        return '<div class="thumb">' +
            '<div class="ph t-' + esc(e.type || 'other') + '"><span>' + esc(label) + '</span></div>' +
            '<img alt="" loading="lazy" data-thumb="' + esc(e.relPath) + '">' +
            '<span class="type-chip">' + esc(label) + '</span>' +
            (e.duration ? '<span class="dur">' + formatDuration(e.duration) + '</span>' : '') +
            '<button class="star' + (e.starred ? ' on' : '') + '" data-star="' + esc(e.relPath) + '" ' +
            'aria-label="' + (e.starred ? '取消星标' : '加星标') + '">' + (e.starred ? '★' : '☆') + '</button>' +
            (e.state === 'missing' ? '<span class="missing-tag">文件缺失</span>' : '') +
            '</div>';
    }

    function cardHtml(e) {
        return '<article class="lib-card' + (e.state === 'missing' ? ' missing' : '') + '" ' +
            'data-rel="' + esc(e.relPath) + '" tabindex="0">' +
            thumbHtml(e) +
            '<div class="body">' +
            '<h3 title="' + esc(fileName(e)) + '">' + esc(fileName(e)) + '</h3>' +
            '<p class="sub">' + esc(platformName(e)) + ' · ' + esc(creatorName(e)) + '</p>' +
            '<p class="facts"><span>' + formatBytes(e.size) + '</span><span>' + formatDate(e.mtime) + '</span></p>' +
            '</div></article>';
    }

    function rowHtml(e) {
        return '<div class="lib-row' + (e.state === 'missing' ? ' missing' : '') + '" ' +
            'data-rel="' + esc(e.relPath) + '" tabindex="0">' +
            '<div class="row-thumb"><div class="ph t-' + esc(e.type || 'other') + '">' + esc(typeLabel(e.type)) + '</div>' +
            '<img alt="" loading="lazy" data-thumb="' + esc(e.relPath) + '"></div>' +
            '<div class="row-main"><div class="row-name" title="' + esc(fileName(e)) + '">' + esc(fileName(e)) + '</div>' +
            '<div class="row-sub">' + esc(platformName(e)) + ' · ' + esc(creatorName(e)) + '</div></div>' +
            '<div class="row-size">' + formatBytes(e.size) + '</div>' +
            '<div class="row-date">' + formatDate(e.mtime) + '</div>' +
            '<button class="star' + (e.starred ? ' on' : '') + '" data-star="' + esc(e.relPath) + '" ' +
            'aria-label="' + (e.starred ? '取消星标' : '加星标') + '">' + (e.starred ? '★' : '☆') + '</button>' +
            '</div>';
    }

    function renderActiveFilters() {
        var el = $('libActiveFilters');
        var chips = [];
        if (state.platform) {
            var pn = ({ bilibili: 'B站', xiaohongshu: '小红书', x: 'X', youtube: 'YouTube', web: '其他网页' })[state.platform] || state.platform;
            chips.push('<button class="active-chip" data-clear="platform">' + esc(pn) + ' ×</button>');
        }
        if (state.creator) {
            chips.push('<button class="active-chip" data-clear="creator">' + esc(state.creator) + ' ×</button>');
        }
        if (state.starred) {
            chips.push('<button class="active-chip" data-clear="starred">仅星标 ×</button>');
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

    var observer = null;

    function observeThumbs() {
        if (observer) { observer.disconnect(); }
        if (!('IntersectionObserver' in window)) {
            [].forEach.call(document.querySelectorAll('[data-thumb]'), function (img) {
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
        }, { rootMargin: '120px' });
        [].forEach.call(document.querySelectorAll('[data-thumb]'), function (img) {
            observer.observe(img);
        });
    }

    function renderMain() {
        var list = sorted(all.filter(matches));
        rendered = list;
        var totalBytes = list.reduce(function (n, e) { return n + (Number(e.size) || 0); }, 0);

        var titles = { all: '全部资源', video: '视频', image: '图片', audio: '音频' };
        $('libTitle').textContent = state.starred ? '星标资源' : (titles[state.type] || '全部资源');
        $('libSub').textContent = '共 ' + list.length + ' 项' + (list.length ? ' · ' + formatBytes(totalBytes) : '');

        var grid = $('libGrid');
        var listEl = $('libList');
        grid.hidden = list.length === 0 || state.view !== 'grid';
        listEl.hidden = list.length === 0 || state.view !== 'list';

        if (state.view === 'grid') {
            grid.innerHTML = list.map(cardHtml).join('');
        } else {
            listEl.innerHTML = list.map(rowHtml).join('');
        }
        renderEmpty(list.length);
        renderActiveFilters();
        observeThumbs();
    }

    function apply() {
        renderSide();
        renderMain();
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
        renderFoot();
        apply();
    }

    function setView(v) {
        state.view = v === 'list' ? 'list' : 'grid';
        $('libViewGrid').classList.toggle('on', state.view === 'grid');
        $('libViewList').classList.toggle('on', state.view === 'list');
        try { localStorage.setItem('vrLibView', state.view); } catch (e) { /* 忽略 */ }
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
            platformName(e) + ' · ' + creatorName(e) + ' · ' + formatBytes(e.size);
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
        var side = document.querySelector('.lib-side');
        side.addEventListener('click', function (ev) {
            var btn = ev.target.closest('.side-item');
            if (!btn) { return; }
            if (btn.dataset.type !== undefined) {
                state.type = btn.dataset.type;
                state.starred = false;
            }
            if (btn.dataset.starred !== undefined) {
                state.starred = true;
                state.type = 'all';
            }
            if (btn.dataset.platform !== undefined) {
                state.platform = state.platform === btn.dataset.platform ? '' : btn.dataset.platform;
            }
            if (btn.dataset.creator !== undefined) {
                state.creator = state.creator === btn.dataset.creator ? '' : btn.dataset.creator;
            }
            apply();
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

        $('libViewGrid').addEventListener('click', function () { setView('grid'); });
        $('libViewList').addEventListener('click', function () { setView('list'); });

        $('libRefresh').addEventListener('click', function () { loadData(); });
        $('libOptions').addEventListener('click', function () {
            chrome.tabs.create({ url: chrome.runtime.getURL('options.html#anchorLibrary') });
        });

        $('libActiveFilters').addEventListener('click', function (ev) {
            var chip = ev.target.closest('[data-clear]');
            if (!chip) { return; }
            var k = chip.dataset.clear;
            if (k === 'starred') { state.starred = false; } else { state[k] = ''; }
            apply();
        });

        $('libEmptyAction').addEventListener('click', function () {
            if (this.dataset.action === 'options') {
                chrome.tabs.create({ url: chrome.runtime.getURL('options.html#anchorLibrary') });
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
                if (ev.key !== 'Enter') { return; }
                var card = ev.target.closest('[data-rel]');
                if (card) { openViewer(card.dataset.rel); }
            });
        });

        window.addEventListener('vrthumb', function (ev) {
            var d = ev.detail || {};
            var img = null;
            [].forEach.call(document.querySelectorAll('[data-thumb]'), function (el) {
                if (el.getAttribute('data-thumb') === d.relPath) { img = el; }
            });
            if (!img || !d.blob) { return; }
            var url = URL.createObjectURL(d.blob);
            objectUrls.push(url);
            img.src = url;
            img.classList.add('loaded');
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
            if (saved === 'list') { setView('list'); } else { setView('grid'); }
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
