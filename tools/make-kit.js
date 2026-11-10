#!/usr/bin/env node
/**
 * 组装「拷到别的电脑也能用」的分发文件夹。
 *
 * 产物结构（输出的顶层文件夹就叫 video-rod，整份拷走即可）：
 *
 *   video-rod/
 *     使用说明.html          ← 双击就开，教人怎么导入扩展
 *     下载的文件在哪里.txt
 *     extension/            ← 浏览器要加载的就是这一层（里面有 manifest.json）
 *     请先看这里.txt        ← 最外层的引导，防止有人跳过 html
 *
 * 为什么要有这个脚本（2026-11-10 苏哥提的需求）：
 *   之前只有 dist/ 和 zip 包 —— zip 解压出来是一堆散文件，谁知道哪层是扩展本体、
 *   更不知道要去 edge://extensions 开开发者模式。给非技术用户等于没用。
 *   「扩展从哪儿来」这件事必须自己带着走，不能靠记。
 *
 * 与 pack-dist.js 的分工：
 *   pack-dist.js  → 给「上架商店 / 自己留档」的 zip（只含扩展，manifest 在 zip 根）
 *   make-kit.js   → 给「发给别人用」的自包含文件夹（含说明书，manifest 在 extension/ 里）
 *
 * 用法：
 *   node tools/make-kit.js                 # 输出到 ../work/vr-kit/video-rod/
 *   node tools/make-kit.js --out D:/x      # 指定输出目录
 *   node tools/make-kit.js --zip           # 组装完再压一个 zip 方便传输
 *   node tools/make-kit.js --allow-dirty   # 跳过「dist 必须是 HEAD 产物」门禁（仅自测）
 *
 * 零依赖，只用 Node 内置模块。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const KIT_SRC = path.join(__dirname, 'dist-kit');
const ALLOW_DIRTY = process.argv.includes('--allow-dirty');
const WANT_ZIP = process.argv.includes('--zip');

function argVal(flag) {
    const i = process.argv.indexOf(flag);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : '';
}

function fmt(b) {
    return b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.round(b / 1024) + ' KB';
}

/** 递归统计体积（目录不存在返回 0） */
function dirSize(dir) {
    if (!fs.existsSync(dir)) { return 0; }
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
    }
    return n;
}

/** 递归复制（保留目录结构） */
function copyDir(from, to, skip) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        if (skip && skip(e.name)) { continue; }
        const s = path.join(from, e.name);
        const d = path.join(to, e.name);
        if (e.isDirectory()) { copyDir(s, d, skip); }
        else { fs.copyFileSync(s, d); }
    }
}

function main() {
    if (!fs.existsSync(DIST) || !fs.existsSync(path.join(DIST, 'manifest.json'))) {
        console.error('✗ dist/ 缺失或不完整 —— 先跑：node tools/build-dist.js --from-head');
        process.exit(1);
    }

    /* 门禁：dist 必须恰好是 HEAD 的产物。
     * 不设这道门，谁带着未提交改动构建过 dist，脏代码就会跟着发出去，
     * 而 dist 不进 git，事后完全看不出来（2026-11-09 事故复盘，ADR-075）。 */
    if (!ALLOW_DIRTY) {
        try {
            execFileSync(process.execPath, [path.join(__dirname, 'build-dist.js'), '--check'],
                { cwd: ROOT, stdio: 'pipe' });
        } catch (e) {
            console.error('✗ 组装中止：dist/ 与 HEAD 不一致。');
            const out = String((e.stdout || '') + (e.stderr || ''));
            out.split('\n').filter(l => /内容不同|缺失|多出/.test(l)).slice(0, 6)
                .forEach(l => console.error('   ' + l.trim()));
            console.error('  修好再打：node tools/build-dist.js --from-head');
            console.error('  只是自测：node tools/make-kit.js --allow-dirty');
            process.exit(1);
        }
    } else {
        console.log('⚠ --allow-dirty：跳过「dist == HEAD」检查（此套件禁止外发）\n');
    }

    const mf = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
    const ver = mf.version || '0.0.0';

    // 输出位置：仓库外（规范 §3：产物不进仓库）
    let outRoot = argVal('--out');
    if (!outRoot) {
        outRoot = path.resolve(ROOT, '..', 'work', 'vr-kit');
    }
    const kitDir = path.join(outRoot, 'video-rod');

    console.log('── 组装分发文件夹');
    console.log('   扩展版本: %s', ver);
    console.log('   输出目录: %s', kitDir);

    fs.rmSync(kitDir, { recursive: true, force: true });
    fs.mkdirSync(kitDir, { recursive: true });

    // 1) 扩展本体 → extension/（这一层里有 manifest.json，就是浏览器要选的那层）
    copyDir(DIST, path.join(kitDir, 'extension'));

    // 2) 说明书 + 说明文件（版本号占位符按 manifest 实际版本替换，防两处版本对不上）
    if (!fs.existsSync(path.join(KIT_SRC, '使用说明.html'))) {
        console.error('✗ 缺少 tools/dist-kit/使用说明.html');
        process.exit(1);
    }
    const manual = fs.readFileSync(path.join(KIT_SRC, '使用说明.html'), 'utf8')
        .replace(/__KIT_VERSION__/g, ver);
    fs.writeFileSync(path.join(kitDir, '使用说明.html'), manual, 'utf8');
    if (fs.existsSync(path.join(KIT_SRC, '下载的文件在哪里.txt'))) {
        fs.copyFileSync(path.join(KIT_SRC, '下载的文件在哪里.txt'),
            path.join(kitDir, '下载的文件在哪里.txt'));
    }

    // 3) 最外层引导：防止有人只看 txt 不看 html
    fs.writeFileSync(path.join(kitDir, '请先看这里.txt'), [
        '苏哥的钓鱼竿 · 视频/图片下载扩展',
        '版本 ' + ver + ' · Edge / Chrome 通用 · 纯本地运行',
        '',
        '怎么用：',
        '',
        '  1. 双击本文件夹里的【使用说明.html】，用浏览器打开',
        '  2. 照着里面的四步做（大约两分钟）',
        '',
        '  最关键的一步：在扩展管理页点「加载解压缩的扩展」时，',
        '  要选本文件夹里的【extension】子目录 ——',
        '  判断标准：进到能直接看到 manifest.json 的那一层。',
        '',
        '为什么不用商店：',
        '',
        '  扩展就装在这个文件夹里，不依赖任何商店，换电脑整份拷走就能重装。',
        '',
        '注意：',
        '',
        '  这个文件夹不要删、不要改名、不要移动。浏览器是「就地加载」的，',
        '  一挪位置扩展就失效，要在扩展页点「重新加载」救回来。',
        ''
    ].join('\r\n'), 'utf8');

    // 体积报告
    const extSize = dirSize(path.join(kitDir, 'extension'));
    const total = dirSize(kitDir);
    console.log('\n   extension/      %s（扩展本体）', fmt(extSize));
    console.log('   使用说明.html   %s', fmt(fs.statSync(path.join(kitDir, '使用说明.html')).size));
    console.log('   合计            %s', fmt(total));

    // 自检：manifest 必须在 extension/ 这一层
    const kitManifest = path.join(kitDir, 'extension', 'manifest.json');
    if (!fs.existsSync(kitManifest)) {
        console.error('\n✗ 自检失败：extension/manifest.json 不存在');
        process.exit(1);
    }
    // 自检：manifest 里引用的关键文件得真的在（防「引用了没入库」）
    const mfKit = JSON.parse(fs.readFileSync(kitManifest, 'utf8'));
    const missing = [];
    let checked = 0;
    const check = (rel) => {
        if (!rel || typeof rel !== 'string') { return; }
        if (/^(https?:|data:|\/\/)/.test(rel)) { return; }
        checked++;
        const p = path.join(kitDir, 'extension', rel.replace(/^\/+/, ''));
        if (!fs.existsSync(p)) { missing.push(rel); }
    };
    (mfKit.content_scripts || []).forEach(cs => (cs.js || []).forEach(check));
    if (mfKit.background && mfKit.background.service_worker) { check(mfKit.background.service_worker); }
    Object.values(mfKit.icons || {}).forEach(check);
    if (missing.length) {
        console.error('\n✗ 自检失败：manifest 引用了不存在的文件（%d 个）：', missing.length);
        missing.slice(0, 8).forEach(m => console.error('   ', m));
        process.exit(1);
    }
    console.log('\n   自检：manifest 引用 %d 项全部存在 ✓', checked);

    // 可选压缩
    if (WANT_ZIP) {
        const zipPath = path.join(outRoot, 'video-rod-kit-' + ver + '.zip');
        if (fs.existsSync(zipPath)) { fs.rmSync(zipPath); }
        const ps = [
            '$ErrorActionPreference="Stop";',
            'Compress-Archive -Path "' + kitDir.replace(/\\/g, '\\\\') + '"',
            '-DestinationPath "' + zipPath.replace(/\\/g, '\\\\') + '"',
            '-CompressionLevel Optimal -Force'
        ].join(' ');
        execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
        console.log('   压缩包: %s（%s）', zipPath, fmt(fs.statSync(zipPath).size));
    }

    console.log('\n✅ 完成');
    console.log('   把整个「video-rod」文件夹拷走，双击 使用说明.html 即可。');
    console.log('   浏览器加载目录：%s', path.join(kitDir, 'extension'));
}

main();
