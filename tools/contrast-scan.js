/**
 * 页面文字对比度扫描（浏览器端脚本，由 tools/check-contrast.py 注入执行）。
 *
 * 为什么要有它：苏哥 2026-11-12 报「深色背景下灰字看不清」。实测下来
 * `--faint` 只有 2.85:1（正文要求 4.5），而且 `public.css` 里还留着浅色时代的
 * `button:disabled{background:#ccc;color:#666}` —— 禁用按钮在深色页面上变成
 * 一块浅灰。这类问题肉眼能感觉到，但改完没人复核就会退回，所以做成可重复跑的检查。
 *
 * 判定标准（WCAG 2.1）：正文 ≥4.5:1；大字（≥24px 或 ≥18.66px 且粗体）≥3:1。
 *
 * 两个必须注意的坑（都踩过）：
 *   1. 渐变背景：主按钮是金色渐变、引导卡是「金色微光 + 透明」，
 *      只读 backgroundColor 会把它们判成透明 → 白字/深字被算成 1.0:1 的假告警。
 *      取渐变**最后一个**色，末色透明则继续向上找背景。
 *   2. 语义：`·` 这类分隔符也算文字，必须跟着文字色走，不能拿边框色。
 *
 * 返回 JSON 字符串：{ total, bad, list:[{sel,text,color,bg,size,weight,ratio,need}] }
 */
(() => {
  function parseRGB(s) {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function blend(fg, bg) {
    const a = fg.a == null ? 1 : fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  function ratio(a, b) {
    const la = lum(a), lb = lum(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  function bgOf(el) {
    let cur = el, stack = [];
    while (cur && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      /* 渐变背景（金色主按钮）backgroundColor 是透明，只读它会把按钮文字
       * 判成「深色底上的深色字」= 1.07:1 的假告警（实测 4 个 .btn.primary 全中）。
       * 渐变取第一个颜色当背景近似，够判定用。 */
      const bgi = cs.backgroundImage || '';
      if (/gradient/i.test(bgi)) {
        /* 取渐变里**最后一个**颜色（通常是主体/终点色），不是第一个 ——
         * radial-gradient(320px 150px at 20% 0%, rgba(金,.12), transparent)
         * 这种「金色微光 + 透明」的卡片，取第一个色会把整张深色卡当成金色底，
         * 于是白字被判成 1.00:1（实测 popup 引导浮层 6 条全是这种误报）。
         * 末色接近透明则说明渐变只是叠加光，继续向上找真正的背景。 */
        const all = bgi.match(/rgba?\([^)]+\)/g) || [];
        const last = all.length ? parseRGB(all[all.length - 1]) : null;
        if (last && last.a >= 0.99) { stack.push(last); break; }
        if (last && last.a > 0.02) { stack.push(last); }
      }
      const c = parseRGB(cs.backgroundColor);
      if (c && c.a > 0.01) stack.push(c);
      if (c && c.a >= 0.99) break;
      cur = cur.parentElement;
    }
    // 兜底：body 的基色（radial-gradient 取深端）
    let base = { r: 16, g: 15, b: 14, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
    return base;
  }
  function sel(el) {
    if (!el || !el.tagName) return '';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.className && typeof el.className === 'string') {
      s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    return s;
  }
  const out = [];
  const els = document.querySelectorAll('body *');
  for (const el of els) {
    // 只看直接含文字的元素
    let hasText = false;
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim().length > 0) { hasText = true; break; }
    }
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (parseFloat(cs.opacity) < 0.15) continue;
    const fg0 = parseRGB(cs.color);
    if (!fg0) continue;
    const bg = bgOf(el);
    const fg = blend(fg0, bg);   // 处理 color 带 alpha
    const cr = ratio(fg, bg);
    const fs = parseFloat(cs.fontSize);
    const fw = parseInt(cs.fontWeight, 10) || 400;
    const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
    const need = large ? 3 : 4.5;
    if (cr < need) {
      out.push({
        sel: sel(el),
        text: (el.textContent || '').trim().slice(0, 24),
        color: cs.color,
        bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        size: fs, weight: fw,
        ratio: Math.round(cr * 100) / 100,
        need
      });
    }
  }
  // 去重（同选择器+同色只留一条）
  const seen = {};
  const uniq = [];
  for (const o of out) {
    const k = o.sel + '|' + o.color + '|' + o.size;
    if (seen[k]) continue;
    seen[k] = 1; uniq.push(o);
  }
  uniq.sort((a, b) => a.ratio - b.ratio);
  return JSON.stringify({ total: els.length, bad: uniq.length, list: uniq.slice(0, 30) });
})()
