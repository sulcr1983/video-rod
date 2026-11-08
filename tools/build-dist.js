#!/usr/bin/env node
/**
 * 生成 dist/ —— 扩展的「唯一可加载目录」。
 *
 * 规范：docs/ARTIFACT-MANAGEMENT.md §2
 *
 * 用法：
 *   node tools/build-dist.js            # 全量重建 dist/
 *   node tools/build-dist.js --dry-run  # 只打印将拷贝什么，不落盘
 *
 * 设计要点：
 * - 白名单整目录拷贝，而不是按 manifest.json 枚举文件。
 *   原因：background.js 里有大量 importScripts / 动态注入，
 *   manifest.json 并未列全（dedup.js / xhs-media.js / yt-download.js 等）。
 * - 黑名单自检：一旦 dist 里出现 docs/tools/deliverables 等目录，直接报错退出。
 * - 零依赖，只用 Node 内置模块。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DRY = process.argv.includes('--dry-run');

/** 允许带进 dist 的目录（整目录递归拷贝；_locales 以 _ 开头，一并列出） */
const ALLOW_DIRS = ['css', 'img', 'js', 'lib', '_locales', 'catch-script'];

/** 允许带进 dist 的根文件 */
const ALLOW_ROOT_FILES = ['manifest.json'];

/** 永不进 dist 的一级条目（自检用） */
const FORBIDDEN_TOP = [
  'docs', 'deliverables', 'tools', 'test-site', 'archive',
  '.git', '.work', 'node_modules', '.reasonix', '.workbuddy',
];

/** 永不进 dist 的文件名模式 */
const FORBIDDEN_FILE = [/\.md$/i, /^manifest\.firefox\.json$/i, /\.zip$/i, /\.crx$/i, /\.pem$/i];

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = base ? path.join(base, name) : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      walk(abs, rel, out);
    } else {
      if (FORBIDDEN_FILE.some((re) => re.test(name))) continue;
      if (name.startsWith('.')) continue;
      out.push({ abs, rel, size: st.size });
    }
  }
}

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function main() {
  const files = [];

  // 根 HTML
  for (const name of fs.readdirSync(ROOT)) {
    if (!name.endsWith('.html')) continue;
    const abs = path.join(ROOT, name);
    if (!fs.statSync(abs).isFile()) continue;
    files.push({ abs, rel: name, size: fs.statSync(abs).size });
  }

  // 允许的根文件
  for (const name of ALLOW_ROOT_FILES) {
    const abs = path.join(ROOT, name);
    if (!fs.existsSync(abs)) {
      console.error(`✗ 缺少必需文件：${name}`);
      process.exit(1);
    }
    files.push({ abs, rel: name, size: fs.statSync(abs).size });
  }

  // 允许的目录（整目录递归）
  for (const dir of ALLOW_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) {
      console.error(`✗ 缺少必需目录：${dir}`);
      process.exit(1);
    }
    walk(abs, dir, files);
  }

  const total = files.reduce((n, f) => n + f.size, 0);
  console.log(`将写入 ${files.length} 个文件，合计 ${(total / 1024 / 1024).toFixed(2)} MB`);
  console.log(`目标：${DIST}`);

  // 按一级目录汇总
  const byTop = new Map();
  for (const f of files) {
    const top = f.rel.includes(path.sep) || f.rel.includes('/') ? f.rel.split(/[\\/]/)[0] : '(根文件)';
    byTop.set(top, (byTop.get(top) || 0) + f.size);
  }
  for (const [k, v] of [...byTop.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(16)} ${(v / 1024).toFixed(1)} KB`);
  }

  if (DRY) {
    console.log('--dry-run：未写入任何文件');
    return;
  }

  rmrf(DIST);
  for (const f of files) {
    const dest = path.join(DIST, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.abs, dest);
  }

  // ---- 自检 ----
  const problems = [];
  for (const bad of FORBIDDEN_TOP) {
    if (fs.existsSync(path.join(DIST, bad))) problems.push(`dist 内不应存在目录：${bad}`);
  }
  const produced = [];
  (function collect(dir, base) {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = base ? path.join(base, name) : name;
      if (fs.statSync(abs).isDirectory()) collect(abs, rel);
      else produced.push(rel);
    }
  })(DIST, '');
  for (const rel of produced) {
    const name = path.basename(rel);
    if (FORBIDDEN_FILE.some((re) => re.test(name))) problems.push(`dist 内不应存在文件：${rel}`);
  }
  for (const need of ['manifest.json']) {
    if (!fs.existsSync(path.join(DIST, need))) problems.push(`dist 缺少 ${need}`);
  }
  if (!fs.existsSync(path.join(DIST, 'js', 'background.js'))) {
    problems.push('dist 缺少 js/background.js');
  }

  if (problems.length) {
    console.error('\n✗ 自检失败：');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }

  console.log(`\n✓ dist/ 已生成：${produced.length} 个文件`);
  console.log('下一步：edge://extensions 上点「重新加载」。');
}

main();
