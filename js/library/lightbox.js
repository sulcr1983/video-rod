/* ==========================================================
 * VRViewer —— 资源库全屏查看器（S4）
 *
 * 能力：队列翻页、图片缩放/拖拽、信息面板、缩略图带、
 *       视频自绘控件（交给 VRVideo）、键盘（交给 VRKeys）。
 * 依赖：VRVideo、VRKeys、VRThumbs（可选）；挂 self.VRViewer。
 * ========================================================== */
(function (root) {
    'use strict';

    var cb = {};
    var list = [];
    var idx = -1;
    var cur = null;
    var infoOpen = true;
    var bound = false;

    var scale = 1;
    var tx = 0;
    var ty = 0;
    var drag = null;

    var el = {};
    var imgEl = null;

    function $(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function cache() {
        el.viewer = $('libViewer');
        el.stage = $('libViewerStage');
        el.title = $('libViewerTitle');
        el.meta = $('libViewerMeta');
        el.count = $('libViewerCount');
        el.facts = $('libViewerFacts');
        el.panel = $('libViewerInfo');
        el.strip = $('libViewerStrip');
        el.imgCtl = $('libImageCtl');
        el.videoCtl = $('libVideoCtl');
        el.zoomVal = $('libViewerZoomVal');
        el.prev = $('libViewerPrev');
        el.next = $('libViewerNext');
    }

    function init(options) {
        cb = options || {};
        cache();
        bind();
    }

    function bind() {
        if (bound || !el.viewer) { return; }
        bound = true;

        $('libViewerClose').addEventListener('click', close);
        el.prev.addEventListener('click', function () { step(-1); });
        el.next.addEventListener('click', function () { step(1); });
        $('libViewerInfoBtn').addEventListener('click', toggleInfo);
        $('libViewerOpen').addEventListener('click', openInFile);
        $('libViewerOpen2').addEventListener('click', openInFile);
        $('libViewerCopyPath').addEventListener('click', copyPath);

        $('libViewerZoomIn').addEventListener('click', function () { zoomAt(0, 0, 1.25); });
        $('libViewerZoomOut').addEventListener('click', function () { zoomAt(0, 0, 0.8); });
        $('libViewerZoomReset').addEventListener('click', resetZoom);

        el.viewer.addEventListener('click', function (ev) {
            if (ev.target === el.viewer) { close(); }
        });

        el.stage.addEventListener('click', function (ev) {
            if (ev.target === el.stage && !drag) { close(); }
        });

        el.stage.addEventListener('wheel', function (ev) {
            if (!imgEl || ev.target !== imgEl) { return; }
            ev.preventDefault();
            var r = el.stage.getBoundingClientRect();
            var cx = ev.clientX - r.left - r.width / 2;
            var cy = ev.clientY - r.top - r.height / 2;
            zoomAt(cx, cy, ev.deltaY < 0 ? 1.12 : 0.89);
        }, { passive: false });

        el.stage.addEventListener('pointerdown', function (ev) {
            if (!imgEl || scale <= 1) { return; }
            drag = {
                x: ev.clientX - tx,
                y: ev.clientY - ty,
                moved: 0,
                startX: ev.clientX,
                startY: ev.clientY
            };
            imgEl.classList.add('dragging');
            try { el.stage.setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
        });

        el.stage.addEventListener('pointermove', function (ev) {
            if (!drag) { return; }
            drag.moved = Math.max(drag.moved,
                Math.abs(ev.clientX - drag.startX) + Math.abs(ev.clientY - drag.startY));
            tx = ev.clientX - drag.x;
            ty = ev.clientY - drag.y;
            applyZoom();
        });

        function endDrag() {
            if (!drag) { return; }
            var moved = drag.moved;
            drag = null;
            if (imgEl) { imgEl.classList.remove('dragging'); }
            // 拖拽结束后的 click 不应关闭查看器
            if (moved > 3) {
                var stop = function (ev) { ev.stopPropagation(); };
                el.stage.addEventListener('click', stop, { once: true });
            }
        }

        el.stage.addEventListener('pointerup', endDrag);
        el.stage.addEventListener('pointercancel', endDrag);
        el.stage.addEventListener('dblclick', function () { resetZoom(); });

        el.strip.addEventListener('click', function (ev) {
            var b = ev.target.closest('[data-rel]');
            if (b) { open(b.dataset.rel); }
        });

        if (root.VRKeys) { root.VRKeys.on(onKey); }
    }

    /* ---------------- 开关与队列 ---------------- */

    function isOpen() {
        return !!(el.viewer && !el.viewer.hidden);
    }

    function open(relPath) {
        list = (cb.getList && cb.getList()) || [];
        if (!list.length) { return; }
        var i = -1;
        for (var k = 0; k < list.length; k++) {
            if (list[k].relPath === relPath) { i = k; break; }
        }
        if (i < 0) { return; }
        idx = i;
        el.viewer.hidden = false;
        document.body.classList.add('viewer-open');
        paint();
    }

    function close() {
        if (!el.viewer) { return; }
        root.VRVideo.destroy();
        el.stage.innerHTML = '';
        el.strip.innerHTML = '';
        el.viewer.hidden = true;
        document.body.classList.remove('viewer-open');
        cur = null;
        imgEl = null;
        idx = -1;
        resetZoom();
    }

    function step(n) {
        if (list.length < 2) { return; }
        idx = (idx + n + list.length) % list.length;
        paint();
    }

    function paint() {
        cur = list[idx];
        if (!cur) { return; }

        el.title.textContent = cb.fileName ? cb.fileName(cur) : cur.fileName;
        el.meta.textContent = [
            cb.platformName ? cb.platformName(cur) : cur.platformName,
            cb.creatorName ? cb.creatorName(cur) : cur.creatorFull,
            cb.formatBytes ? cb.formatBytes(cur.size) : ''
        ].filter(Boolean).join(' · ');
        el.count.textContent = (idx + 1) + ' / ' + list.length;
        el.prev.disabled = list.length < 2;
        el.next.disabled = list.length < 2;

        paintFacts();
        paintStrip();

        root.VRVideo.destroy();
        el.stage.innerHTML = '';
        imgEl = null;
        resetZoom();
        el.imgCtl.hidden = true;

        var url = (cur.absPath && cb.getUrl) ? cb.getUrl(cur) : '';
        if (cur.state === 'missing' || !url) {
            el.stage.innerHTML = '<div class="viewer-missing">文件已不在原位置，可用「在文件中打开」重新定位</div>';
            return;
        }

        if (cur.type === 'image') {
            var img = document.createElement('img');
            img.alt = cb.fileName ? cb.fileName(cur) : '';
            img.draggable = false;
            img.addEventListener('load', function () {
                setFact('dim', img.naturalWidth + ' × ' + img.naturalHeight);
            });
            img.src = url;
            el.stage.appendChild(img);
            imgEl = img;
            el.imgCtl.hidden = false;
            return;
        }

        if (cur.type === 'video') {
            var v = document.createElement('video');
            v.src = url;
            v.preload = 'metadata';
            v.playsInline = true;
            v.addEventListener('loadedmetadata', function () {
                setFact('dim', v.videoWidth + ' × ' + v.videoHeight);
                setFact('duration', fmt(v.duration));
            });
            el.stage.appendChild(v);
            root.VRVideo.attach(v, {
                onEnded: function () {
                    if (idx < list.length - 1) { step(1); }
                }
            });
            var p = v.play();
            if (p && p.catch) { p.catch(function () { /* 无用户手势时保持暂停 */ }); }
            return;
        }

        el.stage.innerHTML = '<div class="viewer-missing">该类型暂不支持预览，可用「在文件中打开」</div>';
    }

    /* ---------------- 信息面板 ---------------- */

    function setFact(key, value) {
        if (!el.facts) { return; }
        var dd = el.facts.querySelector('[data-k="' + key + '"] dd');
        if (dd) { dd.textContent = value; }
    }

    function paintFacts() {
        var rows = [
            ['platform', '平台', cb.platformName ? cb.platformName(cur) : ''],
            ['creator', '博主', cb.creatorName ? cb.creatorName(cur) : ''],
            ['title', '标题', cur.title || ''],
            ['file', '文件名', cb.fileName ? cb.fileName(cur) : ''],
            ['type', '类型', cb.typeLabel ? cb.typeLabel(cur.type) : cur.type],
            ['size', '大小', cb.formatBytes ? cb.formatBytes(cur.size) : ''],
            ['dim', '尺寸', '—'],
            ['duration', '时长', cur.duration ? fmt(cur.duration) : '—'],
            ['path', '相对路径', cur.relPath],
            ['url', '原始地址', cur.sourceUrl || '—'],
            ['date', '下载时间', cb.formatDate ? (cb.formatDate(cur.mtime, true) || '—') : '—'],
            ['state', '状态', cur.state === 'missing' ? '文件缺失' : '正常']
        ];

        el.facts.innerHTML = rows.filter(function (r) { return r[2] !== ''; }).map(function (r) {
            return '<div class="fact" data-k="' + r[0] + '"><dt>' + esc(r[1]) + '</dt><dd>' +
                esc(r[2]) + '</dd></div>';
        }).join('');
    }

    function toggleInfo() {
        infoOpen = !infoOpen;
        el.viewer.classList.toggle('no-info', !infoOpen);
        var btn = $('libViewerInfoBtn');
        if (btn) { btn.setAttribute('aria-pressed', String(infoOpen)); }
    }

    function openInFile() {
        if (!cur || !cb.getUrl) { return; }
        try { chrome.tabs.create({ url: cb.getUrl(cur) }); } catch (e) { /* 忽略 */ }
    }

    function copyPath() {
        if (!cur) { return; }
        var text = cur.absPath || cur.relPath;
        var btn = $('libViewerCopyPath');
        function done() {
            if (!btn) { return; }
            var old = btn.textContent;
            btn.textContent = '已复制';
            setTimeout(function () { btn.textContent = old; }, 1200);
        }
        try {
            navigator.clipboard.writeText(text).then(done, done);
        } catch (e) { done(); }
    }

    /* ---------------- 缩略图带 ---------------- */

    function paintStrip() {
        if (!el.strip) { return; }
        var start = Math.max(0, idx - 12);
        var end = Math.min(list.length, idx + 13);
        var html = '';

        for (var i = start; i < end; i++) {
            var e = list[i];
            var label = cb.typeLabel ? cb.typeLabel(e.type) : '';
            html += '<button type="button" class="strip-item' + (i === idx ? ' on' : '') + '" ' +
                'data-rel="' + esc(e.relPath) + '" title="' +
                esc(cb.fileName ? cb.fileName(e) : e.fileName) + '">' +
                '<span class="strip-ph">' + esc(label) + '</span>' +
                '<img alt="" data-thumb="' + esc(e.relPath) + '">' +
                (e.duration ? '<i class="sd">' + fmt(e.duration) + '</i>' : '') +
                '</button>';
            if (root.VRThumbs) { root.VRThumbs.enqueue(e); }
        }
        el.strip.innerHTML = html;

        var active = el.strip.querySelector('.strip-item.on');
        if (active && active.scrollIntoView) {
            active.scrollIntoView({ block: 'nearest', inline: 'center' });
        }
    }

    /* ---------------- 缩放 ---------------- */

    function applyZoom() {
        if (!imgEl) { return; }
        imgEl.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
        if (el.zoomVal) { el.zoomVal.textContent = Math.round(scale * 100) + '%'; }
    }

    function zoomAt(cx, cy, factor) {
        if (!imgEl) { return; }
        var next = Math.min(5, Math.max(1, scale * factor));
        if (Math.abs(next - scale) < 0.001) { return; }
        var k = next / scale;
        tx = cx - (cx - tx) * k;
        ty = cy - (cy - ty) * k;
        scale = next;
        if (scale === 1) { tx = 0; ty = 0; }
        applyZoom();
    }

    function resetZoom() {
        scale = 1;
        tx = 0;
        ty = 0;
        if (imgEl) { applyZoom(); }
        if (el.zoomVal) { el.zoomVal.textContent = '100%'; }
    }

    function fmt(sec) {
        sec = Math.max(0, Math.floor(Number(sec) || 0));
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        if (h) { return h + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2); }
        return m + ':' + ('0' + s).slice(-2);
    }

    /* ---------------- 键盘 ---------------- */

    function onKey(ev) {
        if (!isOpen() || !cur) { return false; }

        if (ev.key === 'Escape') { close(); return true; }
        if (ev.key === 'i' || ev.key === 'I') { toggleInfo(); return true; }

        var isVideo = cur.type === 'video';

        if (isVideo) {
            if (ev.code === 'Space' || ev.key === ' ') { root.VRVideo.toggle(); return true; }
            if (ev.key === 'ArrowLeft') { root.VRVideo.seekBy(ev.shiftKey ? -30 : -5); return true; }
            if (ev.key === 'ArrowRight') { root.VRVideo.seekBy(ev.shiftKey ? 30 : 5); return true; }
            if (ev.key === 'ArrowUp') { step(-1); return true; }
            if (ev.key === 'ArrowDown') { step(1); return true; }
            return false;
        }

        if (cur.type === 'image') {
            if (ev.key === 'ArrowLeft') { step(-1); return true; }
            if (ev.key === 'ArrowRight') { step(1); return true; }
            if (ev.key === '+' || ev.key === '=') { zoomAt(0, 0, 1.25); return true; }
            if (ev.key === '-') { zoomAt(0, 0, 0.8); return true; }
            if (ev.key === '0') { resetZoom(); return true; }
        }
        return false;
    }

    root.VRViewer = {
        init: init,
        open: open,
        close: close,
        step: step,
        isOpen: isOpen,
        toggleInfo: toggleInfo,
        _resetZoom: resetZoom,
        _zoom: function () { return scale; }
    };
})(typeof self !== 'undefined' ? self : this);
