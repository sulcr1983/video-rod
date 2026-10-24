/**
 * 苏哥的钓鱼竿 —— 图片浮标 + 清单面板（I4）
 *
 * 交互：右下角圆形浮标（显示本页可下张数）→ 点击开清单面板
 *      面板：缩略图网格 + 尺寸档位（每档显示命中数）+ URL 过滤 + 勾选 + 批量下载
 *
 * 职责边界：
 *   · 本文件只管「浮标 + 面板 + 勾选」，下载交给 VRImgBatch.download（I3 队列）
 *   · 不碰悬停逻辑（image-hover.js）、不碰 SW（background.js）
 *   · 扫描/档位/过滤/排序全是 lib-image-util.js 的纯函数
 *
 * 依赖：js/lib-image-util.js（VRImageUtil）、js/image-batch.js（VRImgBridge）
 */
(() => {
    'use strict';
    if (self.__vrImgPanelLoaded) { return; }
    self.__vrImgPanelLoaded = true;

    const U = self.VRImageUtil;
    if (!U) { return; }

    const HOST_ID = 'vr-img-panel-host';
    const FLOAT_POS_KEY = 'vrImgFloatPos';
    const FLOAT_OFF_KEY = 'vrImgFloatOff';
    const PAGE_SIZE = 24;          // 首屏与每次追加的张数
    const COUNT_THROTTLE = 1000;

    let enabled = true;
    let host = null;
    let shadow = null;
    let floatBtn = null;
    let floatNum = null;
    let mask = null;
    let panel = null;
    let grid = null;
    let titleEl = null;
    let emptyEl = null;
    let tierRow = null;
    let kwInput = null;
    let sortSel = null;
    let selCountEl = null;
    let dlBtn = null;
    let customRow = null;          // 自定义档位的内联输入行
    let customInput = null;
    let customOk = null;
    let customCancel = null;
    let customErr = null;

    let items = [];                // 全量扫描结果
    let tierMin = U.MIN_SIZE;      // 当前档位下限（短边）
    let keyword = '';
    let sortMode = 'page';
    let selected = new Set();      // 选中的 URL
    let anchorUrl = '';            // Shift 范围选择锚点
    let rendered = 0;
    let open = false;
    let observer = null;
    let countTimer = 0;

    /* ---------------- 设置 ---------------- */

    function applySettings(s) {
        const was = enabled;
        enabled = !(s && s.imgPanel === false);
        if (!enabled) { teardown(); return; }
        // 从关到开：重建 UI（teardown 已经把宿主删了）
        if (!was) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', boot, { once: true });
            } else {
                boot();
            }
        }
    }

    try {
        chrome.storage.local.get('vrLibSettings', res => applySettings(res && res.vrLibSettings));
        chrome.storage.onChanged.addListener((ch, area) => {
            if (area !== 'local' || !ch.vrLibSettings) { return; }
            applySettings(ch.vrLibSettings.newValue);
        });
    } catch (e) { /* 无权限时默认开 */ }

    /* ---------------- 样式 ---------------- */

    const ICON_IMG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="3" y="3" width="18" height="18" rx="2"/>' +
        '<circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
    const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

    const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }

/* ---------- 浮标 ---------- */
.vr-float {
  position: fixed; right: 16px; bottom: 16px;
  width: 40px; height: 40px; border-radius: 50%;
  display: none; align-items: center; justify-content: center;
  background: rgba(17, 24, 39, .92); color: #fff;
  border: 1px solid rgba(255, 255, 255, .22);
  box-shadow: 0 4px 16px rgba(0, 0, 0, .3);
  cursor: pointer; pointer-events: auto;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Microsoft YaHei", sans-serif;
  transition: opacity .18s, transform .12s, background .15s;
  z-index: 2147483000;
}
.vr-float.on { display: flex; }
.vr-float:hover { background: rgba(37, 99, 235, .95); transform: scale(1.06); }
.vr-float.dim { opacity: .45; }
.vr-float svg { width: 18px; height: 18px; display: block; }
.vr-float .n {
  position: absolute; right: -4px; top: -4px;
  min-width: 18px; height: 18px; padding: 0 4px;
  border-radius: 9px; background: #2563eb; color: #fff;
  font: 700 10px/18px -apple-system, "PingFang SC", sans-serif;
  text-align: center; border: 1.5px solid rgba(17, 24, 39, .95);
}

/* ---------- 遮罩 + 面板 ---------- */
.vr-mask {
  position: fixed; inset: 0; display: none;
  background: rgba(8, 12, 20, .5);
  -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
  z-index: 2147483003;
}
.vr-mask.on { display: block; }
.vr-panel {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -48%) scale(.98);
  width: min(880px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 48px));
  display: none; flex-direction: column;
  background: #111827; color: #e5e7eb;
  border: 1px solid rgba(255, 255, 255, .13); border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, .5);
  font: 500 12.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Microsoft YaHei", sans-serif;
  overflow: hidden; z-index: 2147483004;
  transition: opacity .18s, transform .18s;
  opacity: 0;
}
.vr-panel.on { display: flex; opacity: 1; transform: translate(-50%, -50%) scale(1); }

.vr-head {
  display: flex; align-items: center; gap: 10px;
  padding: 13px 16px 10px; border-bottom: 1px solid rgba(255, 255, 255, .08);
}
.vr-head .t { flex: 1; font-size: 14px; font-weight: 700; color: #fff; }
.vr-head .t b { color: #60a5fa; }
.vr-x {
  width: 28px; height: 28px; border-radius: 7px; cursor: pointer;
  border: 1px solid rgba(255, 255, 255, .14); background: rgba(255, 255, 255, .06);
  color: #e5e7eb; display: flex; align-items: center; justify-content: center;
  padding: 0; font-family: inherit;
}
.vr-x:hover { background: rgba(255, 255, 255, .14); }
.vr-x svg { width: 14px; height: 14px; }

.vr-filters { padding: 10px 16px 8px; border-bottom: 1px solid rgba(255, 255, 255, .08); }
.vr-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.vr-line + .vr-line { margin-top: 8px; }
.vr-lbl { font-size: 11.5px; color: rgba(255, 255, 255, .5); margin-right: 2px; }
.vr-tier {
  height: 26px; padding: 0 9px; border-radius: 7px; cursor: pointer;
  border: 1px solid rgba(255, 255, 255, .14); background: rgba(255, 255, 255, .05);
  color: #d1d5db; font: inherit; font-size: 11.5px; line-height: 1;
  display: inline-flex; align-items: center; gap: 5px;
}
.vr-tier:hover { background: rgba(255, 255, 255, .12); }
.vr-tier.on { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
.vr-tier .c { opacity: .72; font-variant-numeric: tabular-nums; }
.vr-tier.on .c { opacity: .95; }
.vr-tier[disabled] { opacity: .32; cursor: default; background: transparent; border-color: rgba(255,255,255,.07); }
.vr-kw {
  flex: 1; min-width: 140px; height: 28px; padding: 0 9px;
  border-radius: 7px; border: 1px solid rgba(255, 255, 255, .14);
  background: rgba(255, 255, 255, .05); color: #fff; font: inherit; font-size: 11.5px;
}
.vr-kw::placeholder { color: rgba(255, 255, 255, .35); }
.vr-kw:focus { outline: none; border-color: #3b82f6; }
.vr-sel {
  height: 28px; padding: 0 8px; border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, .14); background: rgba(255, 255, 255, .05);
  color: #e5e7eb; font: inherit; font-size: 11.5px; cursor: pointer;
}
.vr-sel option { background: #111827; color: #e5e7eb; }
.vr-btn2 {
  height: 28px; padding: 0 11px; border-radius: 7px; cursor: pointer;
  border: 1px solid rgba(255, 255, 255, .16); background: rgba(255, 255, 255, .07);
  color: #e5e7eb; font: inherit; font-size: 11.5px; line-height: 1;
  display: inline-flex; align-items: center; gap: 5px;
}
.vr-btn2:hover { background: rgba(255, 255, 255, .14); }
.vr-btn2.primary { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
.vr-btn2.primary:hover { background: #1d4ed8; }
.vr-btn2[disabled] { opacity: .45; cursor: default; }

.vr-body { flex: 1; overflow-y: auto; padding: 12px 16px 16px; }
.vr-grid {
  display: grid; gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
}
.vr-cell {
  position: relative; border-radius: 9px; overflow: hidden; cursor: pointer;
  background: rgba(255, 255, 255, .05); border: 2px solid transparent;
  aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center;
  outline: none;
}
.vr-cell img {
  width: 100%; height: 100%; object-fit: cover; display: block;
  background: rgba(255, 255, 255, .03);
}
.vr-cell:hover { border-color: rgba(96, 165, 250, .6); }
.vr-cell:focus-visible { border-color: #60a5fa; box-shadow: 0 0 0 2px rgba(96, 165, 250, .35); }
.vr-cell.sel { border-color: #2563eb; }
.vr-cell.sel::after {
  content: '✓'; position: absolute; right: 5px; top: 5px;
  width: 18px; height: 18px; border-radius: 50%;
  background: #2563eb; color: #fff; font: 700 11px/18px sans-serif; text-align: center;
}
.vr-cell.done::before {
  content: ''; position: absolute; inset: 0; background: rgba(22, 163, 74, .28);
}
.vr-cell .dim {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 3px 5px; font-size: 10px; color: #fff;
  background: linear-gradient(transparent, rgba(0, 0, 0, .78));
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.vr-custom { margin-top: 8px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.vr-custom[hidden] { display: none; }
.vr-custom .vr-kw { flex: 0 0 110px; min-width: 90px; }
.vr-custom .err { color: #f87171; font-size: 11px; }
.vr-custom .err[hidden] { display: none; }
.vr-empty {
  padding: 40px 0; text-align: center; color: rgba(255, 255, 255, .45); font-size: 12.5px;
}
.vr-empty button { margin-top: 10px; }

.vr-foot {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-top: 1px solid rgba(255, 255, 255, .08);
  background: rgba(255, 255, 255, .02);
}
.vr-foot .s { flex: 1; font-size: 11.5px; color: rgba(255, 255, 255, .6); }
.vr-foot .s b { color: #fff; }

@media (max-width: 640px) {
  .vr-panel { width: calc(100vw - 16px); max-height: calc(100vh - 32px); }
  .vr-grid { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .vr-float, .vr-panel { transition: none; }
}
`;

    /* ---------------- 浮标 ---------------- */

    function loadPos() {
        try {
            const raw = localStorage.getItem(FLOAT_POS_KEY);
            if (!raw) { return null; }
            const p = JSON.parse(raw);
            if (typeof p.right === 'number' && typeof p.bottom === 'number') { return p; }
        } catch (e) { /* ignore */ }
        return null;
    }

    function savePos(pos) {
        try { localStorage.setItem(FLOAT_POS_KEY, JSON.stringify(pos)); } catch (e) { /* ignore */ }
    }

    function floatOff() {
        try { return sessionStorage.getItem(FLOAT_OFF_KEY) === '1'; } catch (e) { return false; }
    }

    function applyFloatPos() {
        if (!floatBtn) { return; }
        const p = loadPos();
        if (p) {
            floatBtn.style.right = p.right + 'px';
            floatBtn.style.bottom = p.bottom + 'px';
        }
    }

    function refreshCount() {
        if (!floatBtn || !enabled) { return; }
        let n = 0;
        try {
            items = U.scanImages(document, { minWidth: U.MIN_SIZE, minHeight: U.MIN_SIZE, dedupe: true });
            n = items.length;
        } catch (e) { n = 0; }
        if (!n || floatOff()) {
            floatBtn.classList.remove('on');
            return;
        }
        floatNum.textContent = n > 99 ? '99+' : String(n);
        floatBtn.classList.add('on');
        floatBtn.setAttribute('aria-label', '本页 ' + n + ' 张图片，点击查看清单');
        if (open) { renderAll(); }
    }

    function scheduleCount() {
        if (countTimer) { return; }
        countTimer = setTimeout(() => {
            countTimer = 0;
            refreshCount();
        }, COUNT_THROTTLE);
    }

    function bindDrag() {
        let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false, moved = false;

        floatBtn.addEventListener('pointerdown', ev => {
            if (ev.button !== 0) { return; }
            dragging = true;
            moved = false;
            const r = floatBtn.getBoundingClientRect();
            sx = ev.clientX; sy = ev.clientY;
            ox = r.right; oy = r.bottom;
            try { floatBtn.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        });

        floatBtn.addEventListener('pointermove', ev => {
            if (!dragging) { return; }
            const dx = ev.clientX - sx;
            const dy = ev.clientY - sy;
            if (!moved && Math.abs(dx) + Math.abs(dy) < 4) { return; }
            moved = true;
            const vw = document.documentElement.clientWidth || window.innerWidth;
            const vh = document.documentElement.clientHeight || window.innerHeight;
            const right = Math.max(4, Math.min(vw - 44, ox - dx));
            const bottom = Math.max(4, Math.min(vh - 44, oy - dy));
            floatBtn.style.right = right + 'px';
            floatBtn.style.bottom = bottom + 'px';
        });

        floatBtn.addEventListener('pointerup', ev => {
            if (!dragging) { return; }
            dragging = false;
            try { floatBtn.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
            if (moved) {
                savePos({
                    right: parseInt(floatBtn.style.right, 10) || 16,
                    bottom: parseInt(floatBtn.style.bottom, 10) || 16
                });
            } else {
                openPanel();
            }
        });

        floatBtn.addEventListener('pointercancel', () => { dragging = false; });
    }

    /* ---------------- 面板 ---------------- */

    function currentList() {
        let list = U.filterByTier(items, tierMin);
        list = U.filterByKeyword(list, keyword);
        return U.sortItems(list, sortMode);
    }

    function updateTitle() {
        const all = items.length;
        const shown = currentList().length;
        titleEl.innerHTML = '本页图片 <b>' + shown + '</b> 张' +
            (shown !== all ? '（共 ' + all + ' 张）' : '');
    }

    function updateTiers() {
        if (!tierRow) { return; }
        const c = U.tierCounts(items);
        for (const b of tierRow.querySelectorAll('.vr-tier')) {
            const key = b.getAttribute('data-tier');
            const cnt = b.querySelector('.c');
            if (key === 'custom') { continue; }
            if (cnt) { cnt.textContent = String(c[key] || 0); }
            b.disabled = (c[key] || 0) === 0;
        }
    }

    function cellEl(it) {
        const cell = document.createElement('div');
        cell.className = 'vr-cell';
        cell.tabIndex = 0;
        cell.setAttribute('data-url', it.url);
        if (selected.has(it.url)) { cell.classList.add('sel'); }

        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = it.url;
        img.alt = '';
        img.addEventListener('error', () => { cell.style.opacity = '.35'; });

        const dim = document.createElement('span');
        dim.className = 'dim';
        dim.textContent = it.w + ' × ' + it.h;

        cell.appendChild(img);
        cell.appendChild(dim);
        return cell;
    }

    function renderGrid() {
        if (!grid) { return; }
        const list = currentList();
        grid.innerHTML = '';
        rendered = 0;
        if (!list.length) {
            emptyEl.hidden = false;
            return;
        }
        emptyEl.hidden = true;
        appendMore(list);
    }

    function appendMore(list) {
        const slice = list.slice(rendered, rendered + PAGE_SIZE);
        const frag = document.createDocumentFragment();
        for (const it of slice) { frag.appendChild(cellEl(it)); }
        grid.appendChild(frag);
        rendered += slice.length;
    }

    function renderAll() {
        updateTitle();
        updateTiers();
        renderGrid();
        updateSel();
    }

    function updateSel() {
        const n = selected.size;
        selCountEl.innerHTML = '已选 <b>' + n + '</b> 张';
        dlBtn.disabled = n === 0;
        dlBtn.textContent = n ? '下载选中 ' + n : '下载选中';
    }

    function onGridClick(ev) {
        const cell = ev.target.closest ? ev.target.closest('.vr-cell') : null;
        if (!cell) { return; }
        const url = cell.getAttribute('data-url');
        if (!url) { return; }

        if (ev.shiftKey && anchorUrl) {
            const list = currentList().map(x => x.url);
            const a = list.indexOf(anchorUrl);
            const b = list.indexOf(url);
            if (a >= 0 && b >= 0) {
                const lo = Math.min(a, b), hi = Math.max(a, b);
                for (let i = lo; i <= hi; i++) { selected.add(list[i]); }
                anchorUrl = url;
                syncCells();
                updateSel();
                return;
            }
        }

        if (selected.has(url)) { selected.delete(url); } else { selected.add(url); }
        anchorUrl = url;
        syncCells();
        updateSel();
    }

    function syncCells() {
        if (!grid) { return; }
        for (const cell of grid.querySelectorAll('.vr-cell')) {
            const u = cell.getAttribute('data-url');
            cell.classList.toggle('sel', selected.has(u));
        }
    }

    /* ---------------- 下载 ---------------- */

    function itemsForUrls(urls) {
        const want = new Set(urls);
        const pageTitle = String(document.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        return items
            .filter(it => want.has(it.url))
            .map(it => ({
                url: it.url,
                candidates: (it.candidates && it.candidates.length) ? it.candidates : [it.url],
                title: pageTitle
            }));
    }

    function downloadSelected() {
        if (!selected.size) { return; }
        const B = self.VRImgBridge;
        if (!B || !B.download) { return; }
        const payload = itemsForUrls(Array.from(selected));
        if (!payload.length) { return; }
        dlBtn.disabled = true;
        dlBtn.textContent = '下载中…';
        const urls = payload.map(p => p.url);
        B.download(payload).then(res => {
            if (res && res.ok) {
                for (const u of urls) {
                    const cell = grid.querySelector('.vr-cell[data-url="' + cssEsc(u) + '"]');
                    if (cell) { cell.classList.add('done'); }
                }
            }
            updateSel();
        });
    }

    function cssEsc(s) {
        return String(s).replace(/["\\]/g, '\\$&');
    }

    /* ---------------- 键盘 ---------------- */

    function onKey(ev) {
        if (!open) { return; }
        const tag = (ev.target && ev.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            if (ev.key === 'Escape') { ev.stopPropagation(); closePanel(); }
            return;
        }
        const cells = Array.from(grid.querySelectorAll('.vr-cell'));
        // 焦点在 Shadow DOM 里时 document.activeElement 只会返回 host，
        // 必须读 shadowRoot.activeElement 才拿得到真正的格子（踩过）。
        const root = shadow || document;
        const ae = (root.activeElement) || document.activeElement;
        const cur = ae && ae.classList && ae.classList.contains('vr-cell') ? ae : null;

        if (ev.key === 'Escape') { ev.preventDefault(); closePanel(); return; }

        if (ev.key === 'j' || ev.key === 'J' || ev.key === 'ArrowDown') {
            ev.preventDefault();
            if (!cells.length) { return; }
            const i = cur ? cells.indexOf(cur) : -1;
            cells[Math.min(cells.length - 1, i + 1)].focus();
            return;
        }
        if (ev.key === 'k' || ev.key === 'K' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            if (!cells.length) { return; }
            const i = cur ? cells.indexOf(cur) : 0;
            cells[Math.max(0, i - 1)].focus();
            return;
        }
        if (ev.key === 'x' || ev.key === 'X' || ev.key === ' ') {
            if (!cur) { return; }
            ev.preventDefault();
            const u = cur.getAttribute('data-url');
            if (!u) { return; }
            if (selected.has(u)) { selected.delete(u); } else { selected.add(u); }
            anchorUrl = u;
            syncCells();
            updateSel();
            return;
        }
        if (ev.key === 'a' || ev.key === 'A') {
            ev.preventDefault();
            for (const it of currentList()) { selected.add(it.url); }
            syncCells();
            updateSel();
            return;
        }
        if (ev.key === 'Enter') {
            ev.preventDefault();
            if (selected.size) { downloadSelected(); return; }
            if (cur) {
                const u = cur.getAttribute('data-url');
                if (u) { selected.add(u); syncCells(); updateSel(); downloadSelected(); }
            }
        }
    }

    /* ---------------- 打开/关闭 ---------------- */

    function openPanel() {
        if (!enabled || !ensureUI()) { return; }
        open = true;
        refreshCount();
        renderAll();
        mask.classList.add('on');
        panel.classList.add('on');
        const first = grid.querySelector('.vr-cell');
        if (first) { first.focus(); }
    }

    function closePanel() {
        open = false;
        if (mask) { mask.classList.remove('on'); }
        if (panel) { panel.classList.remove('on'); }
    }

    /* ---------------- UI 构建 ---------------- */

    function ensureUI() {
        if (host && host.isConnected) { return true; }
        if (!document.documentElement) { return false; }

        host = document.createElement('div');
        host.id = HOST_ID;
        host.setAttribute('data-vr-img-panel', '1');
        host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;' +
            'pointer-events:none;z-index:2147483003;';
        shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
        const root = shadow || host;

        const style = document.createElement('style');
        style.textContent = CSS;

        /* 浮标 */
        floatBtn = document.createElement('div');
        floatBtn.className = 'vr-float';
        floatBtn.setAttribute('role', 'button');
        floatBtn.setAttribute('tabindex', '0');
        floatBtn.title = '本页图片（点击查看清单）';
        const ico = document.createElement('span');
        ico.innerHTML = ICON_IMG;
        floatNum = document.createElement('span');
        floatNum.className = 'n';
        floatNum.textContent = '0';
        floatBtn.appendChild(ico);
        floatBtn.appendChild(floatNum);
        applyFloatPos();
        bindDrag();

        /* 遮罩 */
        mask = document.createElement('div');
        mask.className = 'vr-mask';
        mask.addEventListener('click', closePanel);

        /* 面板 */
        panel = document.createElement('div');
        panel.className = 'vr-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', '本页图片清单');

        const head = document.createElement('div');
        head.className = 'vr-head';
        titleEl = document.createElement('div');
        titleEl.className = 't';
        const xBtn = document.createElement('button');
        xBtn.type = 'button';
        xBtn.className = 'vr-x';
        xBtn.title = '关闭（Esc）';
        xBtn.innerHTML = ICON_CLOSE;
        xBtn.addEventListener('click', closePanel);
        head.appendChild(titleEl);
        head.appendChild(xBtn);

        /* 过滤区 */
        const filters = document.createElement('div');
        filters.className = 'vr-filters';

        const line1 = document.createElement('div');
        line1.className = 'vr-line';
        const lbl1 = document.createElement('span');
        lbl1.className = 'vr-lbl';
        lbl1.textContent = '尺寸';
        line1.appendChild(lbl1);
        tierRow = document.createElement('span');
        tierRow.style.cssText = 'display:inline-flex;gap:6px;flex-wrap:wrap;';
        const tierDefs = U.TIERS.map(t => ({ key: t.key, label: t.label, min: t.min }));
        tierDefs.push({ key: 'custom', label: '自定义', min: -1 });
        for (const td of tierDefs) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'vr-tier' + (td.min === U.MIN_SIZE ? ' on' : '');
            b.setAttribute('data-tier', td.key);
            b.setAttribute('data-min', String(td.min));
            // 自定义档还没选阈值时显示「…」，不要显示 0（0 会被读成「一张都没有」）
            b.innerHTML = td.label + ' <span class="c">' + (td.key === 'custom' ? '…' : '0') + '</span>';
            b.addEventListener('click', () => {
                if (td.key === 'custom') { askCustomTier(b); return; }
                tierMin = td.min;
                for (const x of tierRow.querySelectorAll('.vr-tier')) {
                    x.classList.toggle('on', x === b);
                }
                renderAll();
            });
            tierRow.appendChild(b);
        }
        line1.appendChild(tierRow);

        const line2 = document.createElement('div');
        line2.className = 'vr-line';
        kwInput = document.createElement('input');
        kwInput.type = 'search';
        kwInput.className = 'vr-kw';
        kwInput.placeholder = 'URL 关键词过滤…';
        kwInput.addEventListener('input', () => {
            keyword = kwInput.value;
            renderAll();
        });
        sortSel = document.createElement('select');
        sortSel.className = 'vr-sel';
        sortSel.title = '排序';
        sortSel.innerHTML = '<option value="page">页面顺序</option>' +
            '<option value="size-desc">尺寸从大到小</option>' +
            '<option value="size-asc">尺寸从小到大</option>';
        sortSel.addEventListener('change', () => {
            sortMode = sortSel.value;
            renderAll();
        });
        line2.appendChild(kwInput);
        line2.appendChild(sortSel);

        const line3 = document.createElement('div');
        line3.className = 'vr-line';
        const selAll = document.createElement('button');
        selAll.type = 'button';
        selAll.className = 'vr-btn2';
        selAll.textContent = '全选';
        selAll.addEventListener('click', () => {
            for (const it of currentList()) { selected.add(it.url); }
            syncCells();
            updateSel();
        });
        const invBtn = document.createElement('button');
        invBtn.type = 'button';
        invBtn.className = 'vr-btn2';
        invBtn.textContent = '反选';
        invBtn.addEventListener('click', () => {
            for (const it of currentList()) {
                if (selected.has(it.url)) { selected.delete(it.url); } else { selected.add(it.url); }
            }
            syncCells();
            updateSel();
        });
        const clrBtn = document.createElement('button');
        clrBtn.type = 'button';
        clrBtn.className = 'vr-btn2';
        clrBtn.textContent = '清空';
        clrBtn.addEventListener('click', () => {
            selected.clear();
            syncCells();
            updateSel();
        });
        line3.appendChild(selAll);
        line3.appendChild(invBtn);
        line3.appendChild(clrBtn);

        // 自定义档位的内联输入行（默认隐藏）
        customRow = document.createElement('div');
        customRow.className = 'vr-custom';
        customRow.hidden = true;
        const cLbl = document.createElement('span');
        cLbl.className = 'vr-lbl';
        cLbl.textContent = '短边 ≥';
        customInput = document.createElement('input');
        customInput.type = 'text';
        customInput.className = 'vr-kw';
        customInput.placeholder = '像素，如 800';
        customInput.setAttribute('inputmode', 'numeric');
        customErr = document.createElement('span');
        customErr.className = 'err';
        customErr.hidden = true;
        customOk = document.createElement('button');
        customOk.type = 'button';
        customOk.className = 'vr-btn2 primary';
        customOk.textContent = '确定';
        customCancel = document.createElement('button');
        customCancel.type = 'button';
        customCancel.className = 'vr-btn2';
        customCancel.textContent = '取消';
        customRow.appendChild(cLbl);
        customRow.appendChild(customInput);
        customRow.appendChild(customOk);
        customRow.appendChild(customCancel);
        customRow.appendChild(customErr);

        filters.appendChild(line1);
        filters.appendChild(line2);
        filters.appendChild(line3);
        filters.appendChild(customRow);

        /* 主体 */
        const body = document.createElement('div');
        body.className = 'vr-body';
        grid = document.createElement('div');
        grid.className = 'vr-grid';
        emptyEl = document.createElement('div');
        emptyEl.className = 'vr-empty';
        emptyEl.hidden = true;
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'vr-btn2';
        resetBtn.textContent = '重置条件';
        resetBtn.addEventListener('click', () => {
            tierMin = U.MIN_SIZE;
            keyword = '';
            kwInput.value = '';
            sortMode = 'page';
            sortSel.value = 'page';
            for (const x of tierRow.querySelectorAll('.vr-tier')) {
                x.classList.toggle('on', x.getAttribute('data-tier') === 'small');
            }
            renderAll();
        });
        emptyEl.innerHTML = '当前条件下没有图片<br>';
        emptyEl.appendChild(resetBtn);
        body.appendChild(grid);
        body.appendChild(emptyEl);

        /* 底部 */
        const foot = document.createElement('div');
        foot.className = 'vr-foot';
        selCountEl = document.createElement('span');
        selCountEl.className = 's';
        dlBtn = document.createElement('button');
        dlBtn.type = 'button';
        dlBtn.className = 'vr-btn2 primary';
        dlBtn.textContent = '下载选中';
        dlBtn.disabled = true;
        dlBtn.addEventListener('click', downloadSelected);
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'vr-btn2';
        closeBtn.textContent = '关闭';
        closeBtn.addEventListener('click', closePanel);
        foot.appendChild(selCountEl);
        foot.appendChild(dlBtn);
        foot.appendChild(closeBtn);

        panel.appendChild(head);
        panel.appendChild(filters);
        panel.appendChild(body);
        panel.appendChild(foot);

        grid.addEventListener('click', onGridClick);

        root.appendChild(style);
        root.appendChild(floatBtn);
        root.appendChild(mask);
        root.appendChild(panel);
        document.documentElement.appendChild(host);

        document.addEventListener('keydown', onKey, true);

        // 懒渲染：滚动到底部追加
        body.addEventListener('scroll', () => {
            if (!open) { return; }
            if (body.scrollTop + body.clientHeight >= body.scrollHeight - 80) {
                const list = currentList();
                if (rendered < list.length) { appendMore(list); }
            }
        });

        // 图片增删 → 1s 节流重算数量
        try {
            observer = new MutationObserver(muts => {
                // 只关心「有 img 进来/出去」；纯文本变动不重算，避免频繁全页扫描
                for (const m of muts) {
                    for (const n of m.addedNodes || []) {
                        if (n.nodeName === 'IMG' || (n.querySelector && n.querySelector('img'))) {
                            scheduleCount(); return;
                        }
                    }
                    for (const n of m.removedNodes || []) {
                        if (n.nodeName === 'IMG' || (n.querySelector && n.querySelector('img'))) {
                            scheduleCount(); return;
                        }
                    }
                }
            });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        } catch (e) { /* ignore */ }

        refreshCount();
        return true;
    }

    /* 自定义档位：用面板内联输入，不用 prompt/alert——
     * 站点的 CSP 可能拦掉原生弹窗，而且原生弹窗会打断视觉。
     * 点「自定义」时在过滤行下面展开一个小输入行，回车生效、Esc 取消。 */
    function askCustomTier(btn) {
        if (!customRow) { return; }
        customRow.hidden = false;
        customInput.value = String(tierMin || U.MIN_SIZE);
        customErr.hidden = true;
        customInput.focus();
        customInput.select();

        const commit = () => {
            const m = U.parseTierMin(customInput.value);
            if (!m) {
                customErr.textContent = '请输入正整数像素（例如 800）';
                customErr.hidden = false;
                return;
            }
            tierMin = m;
            for (const x of tierRow.querySelectorAll('.vr-tier')) {
                x.classList.toggle('on', x === btn);
            }
            btn.innerHTML = '自定义 ' + m + ' <span class="c"></span>';
            updateTiers();
            renderAll();
            customRow.hidden = true;
        };
        const cancel = () => {
            customRow.hidden = true;
            customErr.hidden = true;
            // 自定义没生效就退回原档位高亮
            for (const x of tierRow.querySelectorAll('.vr-tier')) {
                x.classList.toggle('on', Number(x.getAttribute('data-min')) === tierMin);
            }
        };
        customOk.onclick = commit;
        customCancel.onclick = cancel;
        customInput.onkeydown = ev => {
            if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commit(); }
            if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancel(); }
        };
    }

    function teardown() {
        clearTimeout(countTimer);
        countTimer = 0;
        try { if (observer) { observer.disconnect(); } } catch (e) { /* ignore */ }
        observer = null;
        try { document.removeEventListener('keydown', onKey, true); } catch (e) { /* ignore */ }
        if (host && host.parentNode) { host.parentNode.removeChild(host); }
        host = shadow = floatBtn = floatNum = mask = panel = grid = titleEl = null;
        emptyEl = tierRow = kwInput = sortSel = selCountEl = dlBtn = null;
        customRow = customInput = customOk = customCancel = customErr = null;
        open = false;
        selected.clear();
    }

    /* ---------------- 对外 ---------------- */

    /* 主动初始化：浮标本身就是入口，不能等「点浮标」才建 UI
     * （否则 ensureUI 永远没机会跑，浮标永远不出现——踩过）。 */
    function boot() {
        if (!enabled) { return; }
        if (!document.documentElement) {
            // 极早期注入时 body 还没有，等 DOM 就绪再来
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', boot, { once: true });
            }
            return;
        }
        if (!ensureUI()) { return; }
        // 数量延后算：scanImages 要遍历全页并读 naturalWidth，
        // 页面刚加载时立刻跑会阻塞主线程、拖慢其他内容脚本（实测把悬停按钮拖到超时）。
        // 空闲时再算，赶不上就退回定时器。
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => refreshCount(), { timeout: 2000 });
        } else {
            setTimeout(refreshCount, 300);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

    self.VRImgPanel = {
        open: openPanel,
        close: closePanel,
        _state() {
            return {
                open: open,
                count: items.length,
                tierMin: tierMin,
                keyword: keyword,
                sortMode: sortMode,
                selected: Array.from(selected),
                shown: currentList().length
            };
        }
    };
})();
