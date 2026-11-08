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
    let settings = U.mergeSettings({});   // 全部设置项（含 imgMinSize 等）
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
    let footEl = null;             // 面板底部（已选 N + 下载按钮）
    let albumBox = null;           // 图集扫描条（image-album.js 填充）
    let gearBtn = null;            // 设置齿轮
    let setBox = null;             // 设置区主体
    let setFoot = null;            // 设置区底部按钮
    let settingsOpen = false;
    let setErr = null;
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
        const prevMin = settings.imgMinSize;
        const prevBg = settings.imgBgScan;
        settings = U.mergeSettings(s || {});
        enabled = settings.imgPanel !== false;
        // 设置页改了值也要同步到面板的控件上（两边共用一份存储）
        try { if (setBox) { syncSettingsUI(); } } catch (e) { /* 忽略 */ }
        if (!enabled) { teardown(); return; }
        // 从关到开：重建 UI（teardown 已经把宿主删了）
        if (!was) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', boot, { once: true });
            } else {
                boot();
            }
            return;
        }
        /* 已经在跑：数值变化（门槛/背景图开关）要**重算计数**，否则浮标数字停在旧值。
         * 早先只在「关→开」时重建，改 imgMinSize 后浮标仍显示旧张数（实测 C2 用例）。
         * 这里不重建 UI，只刷计数 —— 重建会丢掉用户当前的滚动位置与选中态。 */
        if (settings.imgMinSize !== prevMin || settings.imgBgScan !== prevBg) {
            scheduleCount();
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
    const ICON_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="3"/>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06' +
        'a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09' +
        'a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06' +
        'a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09' +
        'a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06' +
        'a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09' +
        'a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06' +
        'a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09' +
        'a1.65 1.65 0 0 0-1.51 1z"/></svg>';

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
.vr-mask.on { display: block; pointer-events: auto; }
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
/* pointer-events 是**继承属性**，宿主 host 写了 pointer-events:none，
   shadow 树里的面板会继承到 none —— 于是面板能显示、但 X、「关闭」、
   「全选」全部点不动（2026-11-08 苏哥在小红书页实测）。
   对照 image-batch.js 的 .vr-cf.on 里的 pointer-events:auto，
   这里必须同样在开启态显式打开，否则继承下来的是 none。 */
.vr-panel.on { display: flex; opacity: 1; transform: translate(-50%, -50%) scale(1); pointer-events: auto; }

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
/* ---------- 设置区 ---------- */
.vr-set { padding: 4px 16px 16px; overflow-y: auto; flex: 1; }
.vr-set[hidden] { display: none; }
.vr-row {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 0; border-bottom: 1px solid rgba(255, 255, 255, .06);
}
.vr-row:last-child { border-bottom: 0; }
.vr-row .lab { flex: 1; min-width: 0; }
.vr-row .lab .n2 { font-size: 12.5px; color: #e5e7eb; }
.vr-row .lab .h { font-size: 11px; color: rgba(255, 255, 255, .42); margin-top: 2px; }
.vr-row .num {
  width: 76px; height: 28px; padding: 0 8px; text-align: right;
  border-radius: 7px; border: 1px solid rgba(255, 255, 255, .14);
  background: rgba(255, 255, 255, .05); color: #fff; font: inherit; font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.vr-row .num:focus { outline: none; border-color: #3b82f6; }
.vr-row .num.bad { border-color: #f87171; }
.vr-row .unit { font-size: 11px; color: rgba(255, 255, 255, .4); width: 30px; }
.vr-sw {
  position: relative; width: 38px; height: 22px; border-radius: 11px; cursor: pointer;
  background: rgba(255, 255, 255, .16); border: 0; padding: 0;
  transition: background .15s; flex: 0 0 38px;
}
.vr-sw::after {
  content: ''; position: absolute; left: 2px; top: 2px; width: 18px; height: 18px;
  border-radius: 50%; background: #fff; transition: transform .15s;
}
.vr-sw.on { background: #2563eb; }
.vr-sw.on::after { transform: translateX(16px); }
.vr-set .err2 { color: #f87171; font-size: 11px; margin-top: 6px; }
.vr-set .err2[hidden] { display: none; }
.vr-set-foot {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px; border-top: 1px solid rgba(255, 255, 255, .08);
}
.vr-set-foot .sp { flex: 1; }
.vr-set-foot[hidden] { display: none; }
.vr-custom { margin-top: 8px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.vr-custom[hidden] { display: none; }
.vr-custom .vr-kw { flex: 0 0 110px; min-width: 90px; }
.vr-custom .err { color: #f87171; font-size: 11px; }
.vr-custom .err[hidden] { display: none; }

/* ---------- 图集扫描（I6，由 image-album.js 填充） ---------- */
.vr-album {
  display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  padding: 8px 16px; border-bottom: 1px solid rgba(255, 255, 255, .08);
  background: rgba(255, 255, 255, .015);
}
.vr-album .msg { flex: 1; min-width: 160px; font-size: 11.5px; color: rgba(255, 255, 255, .62); }
.vr-album .msg b { color: #fff; font-variant-numeric: tabular-nums; }
.vr-album.busy .msg b { color: #60a5fa; }
.vr-album .num {
  width: 52px; height: 26px; padding: 0 6px; text-align: right;
  border-radius: 7px; border: 1px solid rgba(255, 255, 255, .14);
  background: rgba(255, 255, 255, .05); color: #fff; font: inherit; font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.vr-album .num:focus { outline: none; border-color: #3b82f6; }
.vr-album .num[hidden] { display: none; }
.vr-album .vr-btn2[hidden] { display: none; }
/* display:flex 会盖掉 hidden 属性，必须显式声明（本文件里踩过一次） */
.vr-album[hidden] { display: none; }
.vr-empty {
  padding: 40px 0; text-align: center; color: rgba(255, 255, 255, .45); font-size: 12.5px;
}
.vr-empty button { margin-top: 10px; }

.vr-foot {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-top: 1px solid rgba(255, 255, 255, .08);
  background: rgba(255, 255, 255, .02);
}
/* display:flex 会盖掉 hidden 属性，必须显式声明（踩过） */
.vr-foot[hidden] { display: none; }
.vr-body[hidden] { display: none; }
.vr-filters[hidden] { display: none; }
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
            const ms = settings.imgMinSize || U.MIN_SIZE;
            // 面板门槛跟随设置项 `imgMinSize`（默认 100），**不是**悬停那个 600。
            // 用户的选择：悬停按钮只在大图上出现（避免打扰），但清单面板是「主动去看全部图」，
            // 漏图比打扰更糟。
            //
            // 两个维度要分开传，不能都用 ms：
            //   minWidth/minHeight → 判**原始像素**，这是 imgMinSize 的本义
            //                        （设 1200 就只要原图 ≥1200 的）
            //   minShow            → 判**显示尺寸**，只用来挡图标/按钮，用固定的 48
            // 早先图省事把 minShow 也传成 ms，结果 imgMinSize=1200 时
            // 连「原图 1200 但显示 160px」的图都被挡掉，面板直接空（踩过）。
            items = U.scanImages(document, {
                minWidth: ms, minHeight: ms, minShow: U.PANEL_MIN_SHOW, dedupe: true
            });
            // 站点常把封面做成 CSS 背景图（img 标签里没有），只看 <img> 会整片漏掉。
            // 追加在后面，按 URL 去重，避免和 img 结果重复。
            if (settings.imgBgScan !== false) {
                try {
                    const seenUrl = Object.create(null);
                    for (let i = 0; i < items.length; i++) { seenUrl[items[i].url] = 1; }
                    // 背景图没有「原始像素」概念（容器尺寸即图片尺寸），
                    // 只用固定的显示门槛挡图标
                    const bgs = U.scanBackgrounds(document, { minShow: U.PANEL_MIN_SHOW, dedupe: true });
                    for (let i = 0; i < bgs.length; i++) {
                        if (seenUrl[bgs[i].url]) { continue; }
                        seenUrl[bgs[i].url] = 1;
                        items.push(bgs[i]);
                    }
                } catch (e) { /* 背景图扫描失败不影响 img 结果 */ }
            }
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

    function openPanel(force) {
        /* force：用户在别处主动点「选择图片」时要能打开，
         * 不能因为「右下浮标」开关关着就静默无反应（苏哥反馈的 bug）。 */
        if ((!enabled && !force) || !ensureUI()) { return; }
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
        // 先把面板摘掉：toggleSettings 会走 renderAll()，它万一抛错，
        // 后面的 mask/panel 就永远摘不掉 —— 表现为「× 点了没反应」（踩过）。
        if (mask) { mask.classList.remove('on'); }
        if (panel) { panel.classList.remove('on'); }
        if (settingsOpen) {
            try { toggleSettings(false); } catch (e) { /* 关不掉设置区也不能挡住关闭 */ }
        }
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
        gearBtn = document.createElement('button');
        gearBtn.type = 'button';
        gearBtn.className = 'vr-x';
        gearBtn.title = '设置';
        gearBtn.innerHTML = ICON_GEAR;
        gearBtn.addEventListener('click', () => toggleSettings());
        head.appendChild(titleEl);
        head.appendChild(gearBtn);
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

        /* 图集扫描条：容器由本文件建，内容由 image-album.js 填（职责分离，
         * 面板不需要知道图集是怎么滚的）。按钮只在这里，不另做浮标。 */
        albumBox = document.createElement('div');
        albumBox.className = 'vr-album';

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
        footEl = foot;
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

        buildSettings();

        panel.appendChild(head);
        panel.appendChild(albumBox);
        panel.appendChild(filters);
        panel.appendChild(body);
        panel.appendChild(setBox);
        panel.appendChild(setFoot);
        panel.appendChild(foot);

        grid.addEventListener('click', onGridClick);

        root.appendChild(style);
        root.appendChild(floatBtn);
        root.appendChild(mask);
        root.appendChild(panel);
        document.documentElement.appendChild(host);

        // 图集条的内容归 image-album.js（它在 manifest 里排在本文件之后）。
        // 面板每次重建都会换掉 DOM，所以这里主动通知它重挂，不靠它自己猜时机。
        try {
            const A = self.VRImgAlbum;
            if (A && A.mount) { A.mount(albumBox); }
        } catch (e) { /* 图集模块缺失不影响面板主功能 */ }

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

    /* ---------------- 设置区 ---------------- */

    /* 设置项定义：键、标题、说明、控件类型。
     * 顺序就是面板里的显示顺序（功能开关在前，数值在后，快捷键最后）。 */
    const SET_FIELDS = [
        { key: 'imgHover', type: 'bool', label: '悬停按钮', hint: '鼠标停在图片上时出现「下载原图」' },
        { key: 'imgBatch', type: 'bool', label: '全部按钮', hint: '悬停条上显示「全部 N」' },
        { key: 'imgPanel', type: 'bool', label: '右下浮标', hint: '本页图片清单入口' },
        { key: 'imgPreferOriginal', type: 'bool', label: '优先原图', hint: '按五级候选找最大的一张；关掉则用当前显示的那张' },
        { key: 'imgBgScan', type: 'bool', label: '扫背景图', hint: '把 CSS 背景图也算进来；长页面上会略慢' },
        { key: 'imgHoverMinSize', type: 'num', label: '悬停门槛', hint: '页面图宽高都≥此值才出按钮（判显示尺寸）', unit: 'px' },
        { key: 'imgMinSize', type: 'num', label: '面板最小尺寸', hint: '清单只列原图短边≥此值的图（与悬停门槛互不影响）', unit: 'px' },
        { key: 'imgHoverDelay', type: 'num', label: '悬停延迟', hint: '停多久才出按钮', unit: 'ms' },
        { key: 'imgConcurrency', type: 'num', label: '批量并发', hint: '同时下载几张；太高反而排队更慢', unit: '张' },
        { key: 'imgBatchLimit', type: 'num', label: '单批上限', hint: '一次最多下多少张，防误点', unit: '张' },
        { key: 'imgHotkeys', type: 'bool', label: '快捷键', hint: 'Alt+Shift+D 下载悬停图 / Alt+Shift+A 开清单' }
    ];

    let setCtrls = {};   // key -> { kind:'bool', el } | { kind:'num', input, err }

    function buildSettings() {
        setBox = document.createElement('div');
        setBox.className = 'vr-set';
        setBox.hidden = true;

        for (const f of SET_FIELDS) {
            const row = document.createElement('div');
            row.className = 'vr-row';

            const lab = document.createElement('div');
            lab.className = 'lab';
            const n2 = document.createElement('div');
            n2.className = 'n2';
            n2.textContent = f.label;
            const h = document.createElement('div');
            h.className = 'h';
            h.textContent = f.hint;
            lab.appendChild(n2);
            lab.appendChild(h);
            row.appendChild(lab);

            if (f.type === 'bool') {
                const sw = document.createElement('button');
                sw.type = 'button';
                sw.className = 'vr-sw';
                sw.setAttribute('role', 'switch');
                sw.setAttribute('aria-label', f.label);
                sw.setAttribute('data-key', f.key);
                sw.addEventListener('click', () => {
                    const next = !sw.classList.contains('on');
                    writeSetting(f.key, next);
                });
                row.appendChild(sw);
                setCtrls[f.key] = { kind: 'bool', el: sw };
            } else {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'num';
                input.setAttribute('inputmode', 'numeric');
                input.setAttribute('data-key', f.key);
                input.setAttribute('aria-label', f.label);
                const unit = document.createElement('span');
                unit.className = 'unit';
                unit.textContent = f.unit || '';
                input.addEventListener('change', () => {
                    const v = U.validateSetting(f.key, input.value);
                    if (!v.ok) {
                        input.classList.add('bad');
                        showSetErr(f.label + '：' + v.reason);
                        return;
                    }
                    input.classList.remove('bad');
                    showSetErr('');
                    writeSetting(f.key, v.value);
                });
                input.addEventListener('input', () => { input.classList.remove('bad'); showSetErr(''); });
                row.appendChild(input);
                row.appendChild(unit);
                setCtrls[f.key] = { kind: 'num', input };
            }
            setBox.appendChild(row);
        }

        setErr = document.createElement('div');
        setErr.className = 'err2';
        setErr.hidden = true;
        setBox.appendChild(setErr);

        setFoot = document.createElement('div');
        setFoot.className = 'vr-set-foot';
        setFoot.hidden = true;
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'vr-btn2';
        resetBtn.textContent = '恢复默认';
        let armed = false;
        let armTimer = 0;
        resetBtn.addEventListener('click', () => {
            if (!armed) {
                armed = true;
                resetBtn.textContent = '确定恢复？';
                armTimer = setTimeout(() => {
                    armed = false;
                    resetBtn.textContent = '恢复默认';
                }, 3000);
                return;
            }
            clearTimeout(armTimer);
            armed = false;
            resetBtn.textContent = '恢复默认';
            writeSettings(U.mergeSettings({}), true);
        });
        const sp = document.createElement('span');
        sp.className = 'sp';
        const doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'vr-btn2 primary';
        doneBtn.textContent = '完成';
        doneBtn.addEventListener('click', () => toggleSettings(false));
        setFoot.appendChild(resetBtn);
        setFoot.appendChild(sp);
        setFoot.appendChild(doneBtn);
    }

    function showSetErr(msg) {
        if (!setErr) { return; }
        setErr.textContent = msg || '';
        setErr.hidden = !msg;
    }

    /** 把当前 settings 刷到控件上 */
    function syncSettingsUI() {
        for (const f of SET_FIELDS) {
            const c = setCtrls[f.key];
            if (!c) { continue; }
            const v = settings[f.key];
            if (c.kind === 'bool') {
                c.el.classList.toggle('on', !!v);
                c.el.setAttribute('aria-checked', v ? 'true' : 'false');
            } else if (document.activeElement !== c.input) {
                c.input.value = String(v);
                c.input.classList.remove('bad');
            }
        }
    }

    function toggleSettings(force) {
        if (!setBox) { return; }
        const next = (force === undefined) ? !settingsOpen : !!force;
        settingsOpen = next;
        setBox.hidden = !next;
        setFoot.hidden = !next;
        // 设置打开时把网格/过滤/底部操作收起来，避免两块内容抢空间
        const bodyEl = grid && grid.parentNode;
        if (bodyEl) { bodyEl.hidden = next; }
        if (footEl) { footEl.hidden = next; }
        const filtersEl = setBox.parentNode && setBox.parentNode.querySelector('.vr-filters');
        if (filtersEl) { filtersEl.hidden = next; }
        // 图集条也收起来：设置区里出现「图集扫描」按钮会让人误以为它是个设置项
        if (albumBox) { albumBox.hidden = next; }
        if (next) {
            syncSettingsUI();
            showSetErr('');
            titleEl.textContent = '图片下载设置';
        } else {
            renderAll();
        }
    }

    /** 写一个设置项：落库 + 本地立即生效 */
    function writeSetting(key, value) {
        const patch = {};
        patch[key] = value;
        writeSettings(patch, false);
    }

    function writeSettings(patch, replaceAll) {
        const next = replaceAll
            ? U.mergeSettings(patch)
            : U.mergeSettings(Object.assign({}, settings, patch));
        settings = next;

        // 先落库：UI 刷新万一抛错，也不能把「保存」这件事带崩（踩过——
        // syncSettingsUI 放在前面时，任何 UI 异常都会让 storage 那行永远不执行）
        try {
            chrome.storage.local.get('vrLibSettings', o => {
                try {
                    const merged = U.mergeSettings(Object.assign({}, (o && o.vrLibSettings) || {}, next));
                    chrome.storage.local.set({ vrLibSettings: merged }, () => {
                        // 把最后一次写入结果留在这里，方便排查「设置没生效」
                        try {
                            const le = chrome.runtime.lastError;
                            self.__vrLastSet = le ? ('ERR: ' + le.message) : 'ok';
                        } catch (x) { /* 忽略 */ }
                    });
                } catch (e2) {
                    self.__vrLastSet = 'ERR: ' + String((e2 && e2.message) || e2);
                }
            });
        } catch (e) {
            self.__vrLastSet = 'ERR_OUTER: ' + String((e && e.message) || e);
        }

        // 再刷 UI（包起来，出错不影响已保存的值）
        try { syncSettingsUI(); } catch (e) { /* 忽略 */ }

        // 尺寸变了要重扫（items 里存的是旧阈值的结果）
        if (Object.prototype.hasOwnProperty.call(patch, 'imgMinSize')) {
            try {
                refreshCount();
                if (open && !settingsOpen) { renderAll(); }
            } catch (e) { /* 忽略 */ }
        }
        // 悬停门槛改了不用刷面板（它只管悬停按钮），
        // 但内容脚本靠 storage.onChanged 自动生效，这里不需要额外动作。
        // 留着这个分支是为了让「改过什么」一目了然，别误以为漏了处理。
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
        // 先让图集模块松手（它还握着容器引用，清空后再拆宿主会报错）
        try {
            const A = self.VRImgAlbum;
            if (A && A.unmount) { A.unmount(); }
        } catch (e) { /* 忽略 */ }
        try { if (observer) { observer.disconnect(); } } catch (e) { /* ignore */ }
        observer = null;
        try { document.removeEventListener('keydown', onKey, true); } catch (e) { /* ignore */ }
        if (host && host.parentNode) { host.parentNode.removeChild(host); }
        host = shadow = floatBtn = floatNum = mask = panel = grid = titleEl = null;
        emptyEl = tierRow = kwInput = sortSel = selCountEl = dlBtn = null;
        customRow = customInput = customOk = customCancel = customErr = null;
        footEl = gearBtn = setBox = setFoot = setErr = null;
        albumBox = null;
        setCtrls = {};
        settingsOpen = false;
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

    /* 快捷键：SW 转发 vrImg.hotkey/panel 过来 */
    try {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (!msg || msg.Message !== 'vrImg.hotkey' || msg.action !== 'panel') { return; }
            if (!enabled) { sendResponse({ ok: false, code: 'IMG_E_OFF' }); return; }
            openPanel();
            sendResponse({ ok: true });
        });
    } catch (e) { /* 忽略 */ }

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
                shown: currentList().length,
                settingsOpen: settingsOpen,
                settings: Object.assign({}, settings)
            };
        },
        _settings: () => Object.assign({}, settings)
    };
})();
