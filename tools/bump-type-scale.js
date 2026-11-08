#!/usr/bin/env node
/**
 * 字号 / 图标尺寸提升脚本（一次性迁移工具）
 *
 * 为什么需要它：
 *   资源库在 2K/4K 屏上小字（8–9.5px）不可读。设计里 400+ 处 font-size 全是
 *   硬编码 px，手工改必漏，所以用「分层映射表」批量替换，映射关系显式可审。
 *
 * 分层原则（不是统一乘系数，否则会压平视觉层级）：
 *   8–9.5px  → 11px    （原本不可读的元数据/徽标，抬到可读下限）
 *   10–10.5  → 11.5px
 *   11–11.5  → 12px
 *   12–12.5  → 13px
 *   13–13.5  → 14px    （正文基准 13 → 14）
 *   14–15.5  → 15–16px
 *   16px 以上不动     （标题层级本来就合适）
 *
 * 用法：node tools/bump-type-scale.js <css文件> [--dry]
 */
'use strict';
const fs = require('fs');

/* 字号映射：小字抬得多，大字基本不动 */
const FONT_MAP = {
  '8px': '11px',
  '8.5px': '11px',
  '9px': '11px',
  '9.5px': '11px',
  '10px': '11.5px',
  '10.5px': '11.5px',
  '11px': '12px',
  '11.5px': '12px',
  '12px': '13px',
  '12.5px': '13.5px',
  '13px': '14px',
  '13.5px': '14px',
  '14px': '15px',
  '14.5px': '15.5px',
  '15px': '16px',
  '15.5px': '16px',
  '16px': '17px',
  '17px': '18px',
  '18px': '19px',
  '19px': '20px',
  /* 20px 以上是标题级，保持不动 */
};

/* 图标尺寸映射：16px 基准偏小，提到 18px；小图标同比放大 */
const ICON_MAP = {
  '14px': '16px',   /* .i-sm */
  '16px': '18px',   /* .i 基准 */
  '19px': '21px',   /* .i-lg */
  '18px': '20px',   /* brand logo */
};

const file = process.argv[2];
const dry = process.argv.includes('--dry');
/* --conservative：只抬小字下限，大字最多 +1。
 * popup 固定 380px 宽，全量放大容易挤压；用这个模式既保住可读性又不撑破。 */
const conservative = process.argv.includes('--conservative');
if (!file) {
  console.error('用法: node tools/bump-type-scale.js <css文件> [--dry] [--conservative]');
  process.exit(2);
}

/* 保守映射：小字统一到 11px 下限，其余只 +1px，16px 以上不动 */
const CONSERVATIVE_MAP = {
  '8px': '11px', '8.5px': '11px', '9px': '11px', '9.5px': '11px',
  '10px': '11px', '10.5px': '11.5px',
  '11px': '11.5px', '11.5px': '12px',
  '12px': '12.5px', '12.5px': '13px',
  '13px': '13.5px', '13.5px': '14px',
  '14px': '15px', '14.5px': '15px',
  '15px': '16px', '15.5px': '16px',
};

let src = fs.readFileSync(file, 'utf8');
const before = src;

/* 幂等保护：
 * 这个脚本不幂等 —— 再跑一遍会把 14px 又推到 15px（曾因此把整站放大过头，
 * 只好 git checkout 全部重来）。所以在文件末尾写一行标记，
 * 已有标记就拒绝执行，逼你显式加 --force。
 */
const MARK = '/* type-scale-bumped */';
if (src.indexOf(MARK) >= 0 && !process.argv.includes('--force')) {
  console.log(file + ': 已提升过，跳过（要重跑请加 --force，并先 git checkout 该文件）');
  process.exit(0);
}

let fontHits = 0;
/* 只改 font-size 声明里的值，不碰其它属性。
 * 注意：要容忍冒号后的空格——videorod.css 全篇写成 `font-size: 11px`，
 * 早期版本只匹配 `font-size:11px`，结果那个文件一处都没改到。 */
src = src.replace(/font-size:(\s*)([0-9]+(?:\.[0-9]+)?px)/g, function (m, sp, val) {
  const map = conservative ? CONSERVATIVE_MAP : FONT_MAP;
  const to = map[val];
  if (!to) { return m; }
  fontHits++;
  return 'font-size:' + sp + to;
});

/* 图标：只改 .i / .i-sm / .i-lg 这类明确图标的 width/height 对 */
let iconHits = 0;
src = src.replace(/(\.i(?:-sm|-lg)?\{[^}]*?)width:\s*([0-9]+(?:\.[0-9]+)?px)/g,
  function (m, head, val) {
    const to = ICON_MAP[val];
    if (!to) { return m; }
    iconHits++;
    return head + 'width:' + to;
  });
src = src.replace(/(\.i(?:-sm|-lg)?\{[^}]*?)height:\s*([0-9]+(?:\.[0-9]+)?px)/g,
  function (m, head, val) {
    const to = ICON_MAP[val];
    if (!to) { return m; }
    return head + 'height:' + to;
  });
src = src.replace(/(\.i(?:-sm|-lg)?\{[^}]*?)flex:\s*0 0 ([0-9]+(?:\.[0-9]+)?px)/g,
  function (m, head, val) {
    const to = ICON_MAP[val];
    if (!to) { return m; }
    return head + 'flex:0 0 ' + to;
  });

if (!dry && src !== before) {
  /* 追加幂等标记（已存在则不重复） */
  if (src.indexOf(MARK) < 0) { src = src.replace(/\s*$/, '\n\n' + MARK + '\n'); }
  fs.writeFileSync(file, src);
}

console.log(file + ': font-size ' + fontHits + ' 处, 图标 ' + iconHits + ' 处' +
  (dry ? '（dry-run，未写入）' : (src !== before ? ' 已写入' : ' 无变化')));
