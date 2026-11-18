/* ==========================================================
 * 图片面板 · 样式与图标常量（2026-11-18，审计 D11 拆分）
 *
 * 为什么单独成文件：
 *   `image-panel.js` 原来 1508 行，其中**236 行是纯 CSS 字符串**、
 *   18 行是三个内联 SVG。这些是纯数据，却和执行逻辑混在一个闭包里，
 *   读代码时要在「一个 300 行的样式模板」和「真正的逻辑」之间来回跳。
 *
 * 拆分边界（只搬纯字符串，**零逻辑改动**）：
 *   · 不改任何函数、不改任何状态、不改行为
 *   · 新文件只在 window 上挂 VRImgPanelStyle，由 image-panel.js 读取
 *   · 加载顺序要求：本文件必须在 image-panel.js **之前**
 *     （manifest 里紧挨着放，见那一处注释）
 *
 * 为什么不用 ES module：
 *   本项目是 MV3 content_scripts 直接注入普通脚本（非 module），
 *   用全局挂载与其它模块（VRImageUtil / VRImgBridge）保持一致。
 * ========================================================== */
(() => {
    'use strict';

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

    self.VRImgPanelStyle = { CSS: CSS, ICON_IMG: ICON_IMG, ICON_CLOSE: ICON_CLOSE, ICON_GEAR: ICON_GEAR };
})();
