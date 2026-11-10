#!/usr/bin/env node
/**
 * 生成 dist/ —— 扩展的「唯一可加载目录」。
 *
 * 规范：docs/ARTIFACT-MANAGEMENT.md §2（含 §2.4 构建纪律）
 *
 * 用法：
 *   node tools/build-dist.js              # 从**工作区**构建（有未提交改动时拒绝，见下）
 *   node tools/build-dist.js --allow-dirty # 明知有未提交改动，仍从工作区构建（自测专用）
 *   node tools/build-dist.js --from-head   # 从 **HEAD 干净树**构建（发布/交付唯一正确姿势）
 *   node tools/build-dist.js --check       # 校验 dist/ 是否与 HEAD 逐文件一致（部署前门禁）
 *   node tools/build-dist.js --dry-run     # 只打印将拷贝什么，不落盘
 *
 * 为什么默认拒绝「脏工作区」（2026-11-09 踩过两次）：
 *   dist/ 是所有会话共用的运行目录，谁跑一次 build 都会把**别人未提交的源码**打进去。
 *   结果：用户加载的版本里混着半成品功能，而且看不出来（dist 不进 git，没有 diff 可查）。
 *   所以默认拦住，只给两条明确的路：自测用 --allow-dirty，交付用 --from-head。
 *
 * 设计要点：
 * - 白名单整目录拷贝，而不是按 manifest.json 枚举文件。
 *   原因：background.js 里有大量 importScripts / 动态注入，
 *   manifest.json 并未列全（dedup.js / xhs-media.js / yt-download.js 等）。
 * - 黑名单自检：一旦 dist 里出现 docs/tools/deliverables 等目录，直接报错退出。
 * - 零依赖，只用 Node 内置模块（--from-head / --check 依赖系统 git 与 tar）。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes('--dry-run');
const ALLOW_DIRTY = ARGS.includes('--allow-dirty');
const FROM_HEAD = ARGS.includes('--from-head');
const CHECK = ARGS.includes('--check');

/** 允许带进 dist 的目录（整目录递归拷贝；_locales 以 _ 开头，一并列出） */
const ALLOW_DIRS = ['css', 'img', 'js', 'lib', 'catch-script'];

/** _locales 只带中英双语（2026-11-09 苏哥定）。
 *  11 种语言 = 308 KB（解压后），发布包多占 ~200 KB；
 *  裁到 en + zh_CN 后仍满足 manifest.default_locale=en 的回退要求。 */
const ALLOW_LOCALES = ['en', 'zh_CN'];

/** 按需库：源码保留、默认不进包（2026-11-09）
 *
 *  mqtt.min.js = 361 KB，本 fork 里是死代码：
 *   · G.mqttEnable 在 init.js 硬编码 false
 *   · options 页 0 个 MQTT 配置项
 *   · sendToMQTT 第一步 if (!G.mqttEnable) reject
 *   → HTML 已改为按需注入（popup-utils.js 的 vrEnsureMqttLib），
 *     将来开启 G.mqttEnable 时把本行去掉即可恢复。
 */
const OPTIONAL_LIBS = ['lib/mqtt.min.js'];

/** 允许带进 dist 的根文件 */
const ALLOW_ROOT_FILES = ['manifest.json'];

/**
 * 运行时「备份扩展到用户文件夹」用的导出清单文件名。
 * 由构建期生成（列出 dist 的全部文件相对路径），不在 HEAD 里 ——
 * 所以 --check 比较 dist==HEAD 时必须豁免它，否则永远报「多出」。
 * 命名以 _ 开头，避开 walk() 的「. 开头」过滤，也避开 FORBIDDEN_FILE。
 */
const EXPORT_MANIFEST = '_vr_export.json';

/** 永不进 dist 的一级条目（自检用） */
const FORBIDDEN_TOP = [
  'docs', 'deliverables', 'tools', 'test-site', 'archive',
  '.git', '.work', 'node_modules', '.reasonix', '.workbuddy',
];

/** 永不进 dist 的文件名模式 */
const FORBIDDEN_FILE = [/\.md$/i, /^manifest\.firefox\.json$/i, /\.zip$/i, /\.crx$/i, /\.pem$/i];

/* ---------------- 小工具 ---------------- */

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

function git(args, opts) {
  return execFileSync('git', args, Object.assign({ cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, opts || {}));
}

function isGitRepo() {
  try { git(['rev-parse', '--git-dir'], { stdio: ['ignore', 'pipe', 'ignore'] }); return true; }
  catch (e) { return false; }
}

/** 这个相对路径会不会被打进 dist（用来判断「未提交改动是否影响发布物」） */
function isSourcePath(rel) {
  const p = String(rel).replace(/\\/g, '/');
  if (ALLOW_ROOT_FILES.includes(p)) return true;
  if (p.endsWith('.html') && p.indexOf('/') < 0) return true;
  if (p === '_locales' || p.startsWith('_locales/')) {
    const seg = p.split('/');
    return seg.length === 1 || ALLOW_LOCALES.includes(seg[1]);
  }
  return ALLOW_DIRS.some((d) => p.startsWith(d + '/'));
}

/** 工作区里影响 dist 的未提交改动（含未跟踪文件） */
function dirtySourceFiles() {
  if (!isGitRepo()) return [];
  let raw = '';
  try {
    raw = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  } catch (e) { return []; }
  const out = [];
  const parts = raw.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line || line.length < 4) continue;
    const code = line.slice(0, 2);
    const rel = line.slice(3);
    if (code[0] === 'R' || code[0] === 'C') { i++; }   // 重命名：下一条是原路径，跳过
    if (isSourcePath(rel)) out.push(`${code.trim() || '??'} ${rel}`);
  }
  return out;
}

/** 收集要进 dist 的文件清单（srcRoot = 仓库根 or HEAD 解压出的干净树） */
function collectFiles(srcRoot) {
  const files = [];

  // 根 HTML
  for (const name of fs.readdirSync(srcRoot)) {
    if (!name.endsWith('.html')) continue;
    const abs = path.join(srcRoot, name);
    if (!fs.statSync(abs).isFile()) continue;
    files.push({ abs, rel: name, size: fs.statSync(abs).size });
  }

  // 允许的根文件
  for (const name of ALLOW_ROOT_FILES) {
    const abs = path.join(srcRoot, name);
    if (!fs.existsSync(abs)) {
      console.error(`✗ 缺少必需文件：${name}`);
      process.exit(1);
    }
    files.push({ abs, rel: name, size: fs.statSync(abs).size });
  }

  // 允许的目录（整目录递归）
  for (const dir of ALLOW_DIRS) {
    const abs = path.join(srcRoot, dir);
    if (!fs.existsSync(abs)) {
      console.error(`✗ 缺少必需目录：${dir}`);
      process.exit(1);
    }
    walk(abs, dir, files);
  }

  // _locales：只带中英双语（其余 9 种语言不进包）
  const localesDir = path.join(srcRoot, '_locales');
  if (!fs.existsSync(localesDir)) {
    console.error('✗ 缺少必需目录：_locales');
    process.exit(1);
  }
  for (const loc of ALLOW_LOCALES) {
    const abs = path.join(localesDir, loc);
    if (!fs.existsSync(abs)) {
      console.error(`✗ 缺少语言包：_locales/${loc}`);
      process.exit(1);
    }
    walk(abs, path.join('_locales', loc), files);
  }

  // 剔除按需库（源码保留，只是不进包）
  const optSet = new Set(OPTIONAL_LIBS.map((x) => x.replace(/\\/g, '/')));
  const kept = [];
  let dropped = 0;
  for (const f of files) {
    if (optSet.has(f.rel.replace(/\\/g, '/'))) { dropped++; continue; }
    kept.push(f);
  }
  if (dropped) {
    console.log(`  （按需库不入包：${OPTIONAL_LIBS.join(', ')}）`);
    return kept;
  }
  return files;
}

/** 把 HEAD 检出到临时目录，返回 { dir, cleanup }
 *
 * 为什么用 git worktree 而不是 `git archive | tar`：
 *   Windows 上的 GNU tar 会把 `C:\…` 当成「远程主机 C」，直接报
 *   `tar: Cannot connect to C: resolve failed`（2026-11-09 实测）。
 *   worktree 是 git 原生能力，不依赖 tar，也不动工作区。 */
function exportHead() {
  if (!isGitRepo()) {
    console.error('✗ --from-head / --check 需要 git 仓库');
    process.exit(1);
  }
  const dir = path.join(os.tmpdir(), 'vr-head-' + process.pid + '-' + Date.now());
  try {
    git(['worktree', 'add', '--detach', '--force', dir, 'HEAD'], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    rmrf(dir);
    console.error('✗ 导出 HEAD 失败：' + (e && e.message));
    process.exit(1);
  }
  return {
    dir,
    cleanup: () => {
      try { git(['worktree', 'remove', '--force', dir], { stdio: 'ignore' }); } catch (e) { /* 忽略 */ }
      rmrf(dir);
    }
  };
}

function headInfo() {
  try {
    const rev = git(['rev-parse', '--short', 'HEAD']).trim();
    const subject = git(['log', '-1', '--format=%s']).trim();
    return `${rev} ${subject}`;
  } catch (e) { return '(unknown)'; }
}

/* ---------------- --check：dist 是否恰好等于 HEAD ---------------- */

function runCheck() {
  if (!fs.existsSync(DIST)) {
    console.error('✗ dist/ 不存在 —— 先跑：node tools/build-dist.js --from-head');
    process.exit(1);
  }
  const head = exportHead();
  let problems = [];
  try {
    const want = collectFiles(head.dir);
    const wantMap = new Map(want.map((f) => [f.rel.replace(/\\/g, '/'), f]));
    const gotMap = new Map();
    (function collect(dir, base) {
      for (const name of fs.readdirSync(dir)) {
        const abs = path.join(dir, name);
        const rel = base ? path.join(base, name) : name;
        if (fs.statSync(abs).isDirectory()) collect(abs, rel);
        else gotMap.set(rel.replace(/\\/g, '/'), abs);
      }
    })(DIST, '');

    for (const [rel, f] of wantMap) {
      if (!gotMap.has(rel)) { problems.push(`缺少 ${rel}`); continue; }
      const a = fs.readFileSync(f.abs);
      const b = fs.readFileSync(gotMap.get(rel));
      if (!a.equals(b)) problems.push(`内容不同 ${rel}（dist 不是 HEAD 版本）`);
    }
    for (const rel of gotMap.keys()) {
      if (rel === EXPORT_MANIFEST) { continue; }   // 构建期派生的导出清单，不在 HEAD
      if (!wantMap.has(rel)) problems.push(`多出 ${rel}（不在 HEAD 里）`);
    }
  } finally {
    head.cleanup();
  }
  if (problems.length) {
    console.error(`✗ dist/ 与 HEAD 不一致（${problems.length} 处）：`);
    for (const p of problems.slice(0, 15)) console.error('  - ' + p);
    if (problems.length > 15) console.error(`  … 还有 ${problems.length - 15} 处`);
    console.error('\n  多半是有会话带着未提交改动构建过 dist。修复：');
    console.error('    node tools/build-dist.js --from-head');
    process.exit(1);
  }
  console.log(`✓ dist/ 与 HEAD 完全一致（${gotCount()} 个文件）· ${headInfo()}`);
  function gotCount() {
    let n = 0;
    (function c(d) { for (const x of fs.readdirSync(d)) { const p = path.join(d, x); if (fs.statSync(p).isDirectory()) c(p); else n++; } })(DIST);
    return n;
  }
}

/* ---------------- 构建 ---------------- */

function runBuild() {
  if (CHECK) return;                       // 已在调用处分流

  let srcRoot = ROOT;
  let head = null;

  if (FROM_HEAD) {
    head = exportHead();
    srcRoot = head.dir;
    console.log(`源：HEAD 干净树 · ${headInfo()}`);
  } else {
    const dirty = dirtySourceFiles();
    if (dirty.length && !ALLOW_DIRTY) {
      console.error('✗ 工作区有未提交改动，会一起打进 dist/（用户加载的就是它）：');
      for (const d of dirty.slice(0, 12)) console.error('    ' + d);
      if (dirty.length > 12) console.error(`    … 还有 ${dirty.length - 12} 个文件`);
      console.error('\n  两条路，二选一：');
      console.error('    · 只是自测 → node tools/build-dist.js --allow-dirty');
      console.error('    · 要交付/发布 → node tools/build-dist.js --from-head（只打已提交的 HEAD）');
      console.error('\n  规则见 docs/ARTIFACT-MANAGEMENT.md §2.4');
      process.exit(1);
    }
    if (dirty.length) {
      console.log(`⚠ --allow-dirty：以下未提交改动会进入 dist（仅供自测，禁止发布）`);
      for (const d of dirty.slice(0, 8)) console.log('    ' + d);
    }
    console.log(`源：工作区 · HEAD ${headInfo()}`);
  }

  try {
    const files = collectFiles(srcRoot);
    const total = files.reduce((n, f) => n + f.size, 0);
    console.log(`将写入 ${files.length} 个文件，合计 ${(total / 1024 / 1024).toFixed(2)} MB`);
    console.log(`目标：${DIST}`);

    const byTop = new Map();
    for (const f of files) {
      const top = /[\\/]/.test(f.rel) ? f.rel.split(/[\\/]/)[0] : '(根文件)';
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

    /* 生成运行时导出清单：列出 dist 里「可加载扩展所需」的全部文件相对路径。
     * 用户在授权文件夹时若选「备份扩展程序」，运行时按这份清单 fetch 自己并写出。
     * 清单本身不列自己 —— 它只是元数据，导出的目标是一个可加载的扩展目录。 */
    const exportList = files.map((f) => f.rel.replace(/\\/g, '/'));
    fs.writeFileSync(path.join(DIST, EXPORT_MANIFEST), JSON.stringify(exportList, null, 1), 'utf8');

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
    if (!fs.existsSync(path.join(DIST, 'manifest.json'))) problems.push('dist 缺少 manifest.json');
    if (!fs.existsSync(path.join(DIST, 'js', 'background.js'))) problems.push('dist 缺少 js/background.js');

    if (problems.length) {
      console.error('\n✗ 自检失败：');
      for (const p of problems) console.error('  - ' + p);
      process.exit(1);
    }

    console.log(`\n✓ dist/ 已生成：${produced.length} 个文件`);
    if (!FROM_HEAD) {
      console.log('⚠ 这是「工作区」构建：含未提交改动时不要发布，发布请用 --from-head');
    }
    console.log('下一步：edge://extensions 上点「重新加载」。');
  } finally {
    if (head) head.cleanup();
  }
}

if (CHECK) runCheck();
else runBuild();
