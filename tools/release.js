#!/usr/bin/env node
/**
 * 一键发布 —— 从 HEAD 到「可发朋友」的包，一条命令。
 *
 * 规范：docs/ARTIFACT-MANAGEMENT.md §2（浏览器只加载 dist/）、§2.4（构建纪律）、§5（体积目标）
 *
 * 用法：
 *   node tools/release.js              # 全流程：构建→门禁→商店zip→朋友kit→真实加载验证
 *   node tools/release.js --no-verify  # 跳过真实加载验证（只出包）
 *   node tools/release.js --dry-run    # 只打印将做什么，不落盘
 *
 * 它把以下步骤串起来（每步都有门禁，任一步失败即中止）：
 *   1. git 状态检查：源码（js/css/lib/img/manifest）必须干净，有未提交源码改动就拒发
 *   2. node tools/build-dist.js --from-head   —— 只打 HEAD 干净树（发布铁律）
 *   3. node tools/build-dist.js --check      —— dist 必须与 HEAD 逐文件一致
 *   4. node tools/pack-dist.js               —— 商店留档 zip（manifest 在 zip 根）
 *   5. node tools/make-kit.js --zip          —— 发朋友的自包含 kit（带说明书）
 *   6. python tools/qa-pack-verify.py        —— 发布包真实加载 6 项断言
 *
 * 为什么必须 --from-head（2026-11-09 事故）：
 *   谁带着未提交改动跑过 build-dist，脏代码就会跟着 zip 发出去，
 *   而 dist 不进 git，事后完全看不出来。所以发布物只能是 HEAD 的产物。
 *
 * 零依赖，只用 Node 内置模块（验证步骤调用 python，缺 python 则自动跳过并提示）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NO_VERIFY = process.argv.includes('--no-verify');
const DRY = process.argv.includes('--dry-run');

/** 影响发布物的源码目录/文件（这些有未提交改动 = 拒绝发布） */
const SOURCE_PATHS = [
  'js/', 'css/', 'lib/', 'img/', 'catch-script/', '_locales/',
  'manifest.json', 'manifest.firefox.json',
];

function fmt(b) {
  return b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.round(b / 1024) + ' KB';
}

function step(title) {
  console.log('\n━━━ ' + title);
}

function runNode(script, args, opts) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...(args || [])], {
    cwd: ROOT, encoding: 'utf8', stdio: 'inherit', ...(opts || {}),
  });
  return r.status === 0;
}

function runPython(script, args, opts) {
  const r = spawnSync('python', [path.join(__dirname, script), ...(args || [])], {
    cwd: ROOT, encoding: 'utf8', stdio: 'inherit', ...(opts || {}),
  });
  return r.status === 0;
}

/** 检查源码是否干净（未提交改动只允许出现在 deliverables/ 等非源码区） */
function checkSourceClean() {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  const lines = (r.stdout || '').split('\n').filter(Boolean);
  const dirty = lines
    .map(l => l.slice(3))
    .filter(p => SOURCE_PATHS.some(sp => p.startsWith(sp)));
  return { clean: dirty.length === 0, dirty };
}

function main() {
  console.log('🎯 苏哥的钓鱼竿 · 一键发布');
  console.log('   仓库: %s', ROOT);

  /* 步骤 1：源码干净检查 */
  step('1/6 检查源码是否干净（发布物只能含已提交代码）');
  const { clean, dirty } = checkSourceClean();
  if (DRY) {
    console.log('   （dry-run）源码改动: %s', dirty.length ? dirty.join(', ') : '无');
  } else if (!clean) {
    console.error('\n❌ 源码有未提交改动，拒绝发布（先 commit 或确认改动不需要）：');
    dirty.forEach(p => console.error('   ', p));
    console.error('   确认只发已提交代码：git stash / git commit 后重试');
    process.exit(1);
  } else {
    console.log('   ✓ 源码干净（未提交改动仅存在于 deliverables/ 等非源码区，不影响发布物）');
  }

  /* 步骤 2：从 HEAD 干净树构建 dist */
  step('2/6 从 HEAD 干净树构建 dist（发布铁律）');
  if (DRY) {
    console.log('   （dry-run）node tools/build-dist.js --from-head');
  } else if (!runNode('build-dist.js', ['--from-head'])) {
    console.error('\n❌ dist 构建失败，中止');
    process.exit(1);
  }

  /* 步骤 3：门禁——dist 与 HEAD 一致 */
  step('3/6 门禁：dist 与 HEAD 逐文件一致');
  if (DRY) {
    console.log('   （dry-run）node tools/build-dist.js --check');
  } else if (!runNode('build-dist.js', ['--check'])) {
    console.error('\n❌ dist 与 HEAD 不一致，中止（先修好再发）');
    process.exit(1);
  } else {
    console.log('   ✓ dist == HEAD');
  }

  /* 步骤 4：商店留档 zip */
  step('4/6 打商店留档 zip');
  if (DRY) {
    console.log('   （dry-run）node tools/pack-dist.js');
  } else if (!runNode('pack-dist.js')) {
    console.error('\n❌ 商店 zip 打包失败，中止');
    process.exit(1);
  }

  /* 步骤 5：发朋友的 kit */
  step('5/6 打发朋友的自包含 kit（带说明书）');
  if (DRY) {
    console.log('   （dry-run）node tools/make-kit.js --zip');
  } else if (!runNode('make-kit.js', ['--zip'])) {
    console.error('\n❌ 分发 kit 打包失败，中止');
    process.exit(1);
  }

  /* 步骤 6：真实加载验证 */
  step('6/6 发布包真实加载验证（6 项断言）');
  if (NO_VERIFY || DRY) {
    console.log('   （%s）跳过验证', NO_VERIFY ? '--no-verify' : 'dry-run');
  } else {
    const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'manifest.json'), 'utf8'));
    const zip = path.resolve(ROOT, '..', 'work', 'vr-release', 'video-rod-' + mf.version + '.zip');
    // 验证脚本需要 python + websocket-client；缺环境则跳过并提示，不视为失败
    const pyCheck = spawnSync('python', ['-c', 'import websocket'], { cwd: ROOT, encoding: 'utf8' });
    if (pyCheck.status !== 0) {
      console.log('   ⚠️  跳过：本机缺 python websocket-client（装：pip install websocket-client）');
    } else if (!runPython('qa-pack-verify.py', ['--zip', zip])) {
      console.error('\n❌ 发布包验证未通过，此包不要外发');
      process.exit(1);
    } else {
      console.log('   ✓ 发布包 6/6 通过');
    }
  }

  /* 汇总 */
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'manifest.json'), 'utf8'));
  const ver = mf.version;
  const head = spawnSync('git', ['log', '-1', '--format=%h %s'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const zipPath = path.resolve(ROOT, '..', 'work', 'vr-release', 'video-rod-' + ver + '.zip');
  const kitPath = path.resolve(ROOT, '..', 'work', 'vr-kit', 'video-rod-kit-' + ver + '.zip');

  step('✅ 发布完成');
  console.log('   版本:    %s', ver);
  console.log('   提交:    %s', head);
  console.log('');
  console.log('   【发朋友】%s', kitPath);
  console.log('              （自包含 kit，含使用说明.html，双击即看怎么装）');
  console.log('   【商店/留档】%s', zipPath);
  console.log('              （纯扩展 zip，manifest 在根，供上架或自留）');
  console.log('');
  console.log('   下次更新：改完源码 commit 后，再跑一次 node tools/release.js 即可。');
}

main();
