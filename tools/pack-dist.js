#!/usr/bin/env node
/**
 * 打包发布包 —— 只打 dist/，绝不打仓库根。
 *
 * 规范：docs/ARTIFACT-MANAGEMENT.md §2（浏览器只加载 dist/）、§5（体积目标）
 *
 * 用法：
 *   node tools/pack-dist.js              # 打包 → ../work/vr-release/video-rod-<ver>.zip
 *   node tools/pack-dist.js --out x.zip  # 指定输出路径
 *   node tools/pack-dist.js --dry-run    # 只报告体积与内容，不落盘
 *
 * 为什么必须有这个脚本（2026-11-09 事故复盘）：
 *   手动 `zip -r pkg.zip .` 打的是**仓库根**，把 .git(42M) + deliverables(23M)
 *   + .reasonix(21M) 全卷进去 → 93MB 的包。浏览器加载后显示体积巨大、
 *   加载慢、审核麻烦，而扩展本体其实只有 5.1MB。
 *   dist 正确打包后 = 1.38MB。
 *
 * 零依赖，只用 Node 内置模块。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DRY = process.argv.includes('--dry-run');
const ALLOW_DIRTY = process.argv.includes('--allow-dirty');

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : '';
}

/** 压缩级别：9 = 最大压缩（发布包宁可多花 1 秒 CPU） */
const ZIP_LEVEL = 9;

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = base ? path.join(base, name) : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      walk(abs, rel, out);
    } else {
      out.push({ abs, rel, size: st.size });
    }
  }
}

function dirSize(dir) {
  let n = 0;
  for (const f of walk(dir, '', [])) n += f.size;
  return n;
}

function fmt(b) {
  return b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.round(b / 1024) + ' KB';
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error('dist/ 不存在 —— 先跑：node tools/build-dist.js --from-head');
    process.exit(1);
  }

  /* 发布前门禁（2026-11-09，ADR-075）：dist 必须恰好是 HEAD 的产物。
   * 没有这道门，谁带着未提交改动跑过 build-dist，脏代码就会跟着 zip 发出去，
   * 而且 dist 不进 git，事后完全看不出来。--allow-dirty 只给自测打包用。 */
  if (!ALLOW_DIRTY) {
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'build-dist.js'), '--check'],
        { cwd: ROOT, stdio: 'inherit' });
    } catch (e) {
      console.error('\n✗ 打包中止：dist/ 与 HEAD 不一致（见上）。');
      console.error('  修好再打：node tools/build-dist.js --from-head');
      console.error('  只是自测要看包：node tools/pack-dist.js --allow-dirty');
      process.exit(1);
    }
  } else {
    console.log('⚠ --allow-dirty：跳过「dist == HEAD」检查（此包禁止对外发布）');
  }

  const files = [];
  walk(DIST, '', files);
  const rawTotal = files.reduce((a, f) => a + f.size, 0);

  // manifest 在 zip 根（商店上传最常见的错误就是 manifest 套在子目录里）
  const mf = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
  const ver = mf.version || '0.0.0';

  // 体积红线：项目规范 §5 期望 dist 5–8MB；超过 12MB 报警，超过 20MB 失败
  const LIMIT_WARN = 12 * 1048576;
  const LIMIT_FAIL = 20 * 1048576;

  console.log('── 待打包内容（来自 dist/）');
  console.log('   文件数: %d', files.length);
  console.log('   原始体积: %s', fmt(rawTotal));
  console.log('   扩展版本: %s', ver);

  if (rawTotal > LIMIT_FAIL) {
    console.error('\n❌ dist 体积 %s 超过红线 %s —— 先查 build-dist.js 有没有把多余文件带进来',
      fmt(rawTotal), fmt(LIMIT_FAIL));
    process.exit(1);
  }
  if (rawTotal > LIMIT_WARN) {
    console.warn('\n⚠️  dist 体积 %s 偏大（红线 %s），建议查是否有可裁的第三方库', fmt(rawTotal), fmt(LIMIT_WARN));
  }

  // 禁带目录自检（防回归：曾经把仓库根整个压进去）
  const bad = files.filter(f => /(^|[\\/])(docs|deliverables|tools|test-site|archive|\.git|\.reasonix|\.workbuddy)([\\/]|$)/.test(f.rel));
  if (bad.length) {
    console.error('\n❌ dist 里混入了不该带的目录（%d 个）：', bad.length);
    bad.slice(0, 10).forEach(f => console.error('   ', f.rel));
    process.exit(1);
  }
  if (!files.some(f => f.rel === 'manifest.json')) {
    console.error('\n❌ dist/manifest.json 缺失，商店会拒绝上传');
    process.exit(1);
  }

  if (DRY) {
    console.log('\n（dry-run，未落盘）');
    files.sort((a, b) => b.size - a.size).slice(0, 12).forEach(f => {
      console.log('   %7s  %s', fmt(f.size), f.rel);
    });
    return;
  }

  // 输出到仓库外的工作区（规范 §3：产物不进仓库）
  let outPath = argVal('--out');
  if (!outPath) {
    const outDir = path.resolve(ROOT, '..', 'work', 'vr-release');
    fs.mkdirSync(outDir, { recursive: true });
    outPath = path.join(outDir, 'video-rod-' + ver + '.zip');
  } else {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
  }
  if (fs.existsSync(outPath)) fs.rmSync(outPath);

  // 用 PowerShell Compress-Archive：Windows 自带、压缩率高、无需 7z
  // （Git Bash 自带 zip 在 Windows 上对大文件表现不稳，故用 PS）
  const ps = [
    '$ErrorActionPreference="Stop";',
    '$src = "' + DIST.replace(/\\/g, '\\\\') + '\\*";',
    'Compress-Archive -Path $src -DestinationPath "' + outPath.replace(/\\/g, '\\\\') + '"',
    ' -CompressionLevel Optimal -Force'
  ].join(' ');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });

  const zipped = fs.statSync(outPath).size;
  console.log('\n✅ 打包完成');
  console.log('   输出: %s', outPath);
  console.log('   压缩后: %s', fmt(zipped));
  console.log('   压缩率: %d%%', Math.round((1 - zipped / rawTotal) * 100));
  if (zipped > rawTotal) {
    console.warn('   ⚠️ 压缩包比原目录还大，检查是否有已压缩内容（png/woff 二次压缩）');
  }
}

main();
