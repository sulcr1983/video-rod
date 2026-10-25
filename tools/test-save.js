/**
 * VRSave 纯逻辑单测
 *
 * FSA 本身没法在 Node 里测（没有 File System Access API），
 * 所以这里只测**决策逻辑**——那是真正会出错的部分：
 *   · 路径解析（相对路径 → 目录段 + 文件名）
 *   · 模式选择（什么时候走 FSA、什么时候降级、什么时候彻底失败）
 *   · 错误码映射（DOMException → 业务码）
 *   · 重名处理
 *
 * 跑法：node tools/test-save.js
 */
'use strict';

const path = require('path');
const SRC = path.join(__dirname, '..', 'js', 'library', 'save.js');

// save.js 是 IIFE，挂到 self 上；Node 里用 globalThis 冒充
globalThis.self = globalThis;
require(SRC);

const S = globalThis.VRSave;

let pass = 0;
const fails = [];

function eq(name, got, expect) {
    const ok = got === expect;
    if (ok) { pass++; }
    else { fails.push(`${name}\n    got:    ${JSON.stringify(got)}\n    expect: ${JSON.stringify(expect)}`); }
}
function arr(name, got, expect) {
    const a = JSON.stringify(got), b = JSON.stringify(expect);
    if (a === b) { pass++; }
    else { fails.push(`${name}\n    got:    ${a}\n    expect: ${b}`); }
}
function ok(name, cond) {
    if (cond) { pass++; }
    else { fails.push(`${name}\n    expect truthy: ${JSON.stringify(cond)}`); }
}

/* ---------------- 模块存在 ---------------- */
ok('模块已加载', !!S);
ok('导出 saveFile', typeof S.saveFile === 'function');
ok('导出 decideMode', typeof S.decideMode === 'function');

/* ---------------- cleanSeg：单段清洗 ---------------- */
eq('cleanSeg 去首尾空白', S.cleanSeg('  a  '), 'a');
// cleanSeg 处理的是**单段**，斜杠属于非法字符 → 替换成 _（不是保留）
eq('cleanSeg 反斜杠变下划线', S.cleanSeg('a\\b'), 'a_b');
eq('cleanSeg 斜杠变下划线', S.cleanSeg('/a/'), '_a_');
eq('cleanSeg 空值', S.cleanSeg(''), '');
eq('cleanSeg null', S.cleanSeg(null), '');
// 非法文件名字符要替换（Windows 下会写失败）
ok('cleanSeg 处理非法字符', S.cleanSeg('a<b>c:d"e|f?g*h') === 'a_b_c_d_e_f_g_h');

/* ---------------- splitRel：拆目录与文件名 ---------------- */
arr('splitRel 正常路径', (() => {
    const r = S.splitRel('video-rod/bilibili/博主/video/a.mp4');
    return [r.dirs, r.fileName, r.relPath];
})(), [['video-rod', 'bilibili', '博主', 'video'], 'a.mp4', 'video-rod/bilibili/博主/video/a.mp4']);

arr('splitRel 单文件名', (() => {
    const r = S.splitRel('a.mp4');
    return [r.dirs, r.fileName];
})(), [[], 'a.mp4']);

eq('splitRel 空值返回 null', S.splitRel(''), null);
eq('splitRel 纯斜杠返回 null', S.splitRel('///'), null);

/* ---------------- stripPrefix：剥掉根前缀 ---------------- */
arr('stripPrefix 剥掉匹配的前缀',
    S.stripPrefix(['video-rod', 'bilibili', 'video'], 'video-rod'),
    ['bilibili', 'video']);
arr('stripPrefix 前缀不匹配则原样',
    S.stripPrefix(['other', 'video'], 'video-rod'),
    ['other', 'video']);
arr('stripPrefix 空前缀原样',
    S.stripPrefix(['a', 'b'], ''),
    ['a', 'b']);
arr('stripPrefix 空目录',
    S.stripPrefix([], 'video-rod'),
    []);

/* ---------------- decideMode：这是最容易错的地方 ---------------- */
// auto（默认）：FSA 可用就用，否则降级，绝不把功能废掉
eq('decideMode auto + FSA可用 → fsa',
    S.decideMode({ prefer: 'auto', fsa: true, hasHandle: true, downloads: true }).mode, 'fsa');
eq('decideMode auto + 有FSA但无句柄 → 降级 downloads',
    S.decideMode({ prefer: 'auto', fsa: true, hasHandle: false, downloads: true }).mode, 'downloads');
ok('decideMode 降级时带出原因码',
    S.decideMode({ prefer: 'auto', fsa: true, hasHandle: false, downloads: true }).code === S.CODES.NO_HANDLE);
eq('decideMode auto + 无FSA → downloads',
    S.decideMode({ prefer: 'auto', fsa: false, hasHandle: false, downloads: true }).mode, 'downloads');
eq('decideMode auto + 两个都没有 → none',
    S.decideMode({ prefer: 'auto', fsa: false, hasHandle: false, downloads: false }).mode, 'none');

// 强制 fsa：拿不到句柄就明确失败，不偷偷降级（调用方要能知道）
eq('decideMode prefer=fsa 无句柄 → none',
    S.decideMode({ prefer: 'fsa', fsa: true, hasHandle: false, downloads: true }).mode, 'none');
ok('decideMode prefer=fsa 无句柄带 NO_HANDLE',
    S.decideMode({ prefer: 'fsa', fsa: true, hasHandle: false, downloads: true }).code === S.CODES.NO_HANDLE);

// 强制 downloads
eq('decideMode prefer=downloads → downloads',
    S.decideMode({ prefer: 'downloads', fsa: true, hasHandle: true, downloads: true }).mode, 'downloads');
eq('decideMode prefer=downloads 无下载器 → none',
    S.decideMode({ prefer: 'downloads', fsa: true, hasHandle: true, downloads: false }).mode, 'none');

/* ---------------- mapError：DOMException → 业务码 ---------------- */
eq('mapError 权限拒绝', S.mapError({ name: 'NotAllowedError' }), S.CODES.PERM);
eq('mapError 安全错误', S.mapError({ name: 'SecurityError' }), S.CODES.PERM);
eq('mapError 配额不足', S.mapError({ name: 'QuotaExceededError' }), S.CODES.QUOTA);
// NotFoundError 映射到 NO_DIR（模块里没有 NOT_FOUND 这个码）
eq('mapError 找不到 → NO_DIR', S.mapError({ name: 'NotFoundError' }), S.CODES.NO_DIR);
eq('mapError 未知异常有兜底', typeof S.mapError({ name: 'WeirdError' }), 'string');
eq('mapError 空异常也有兜底', typeof S.mapError(null), 'string');

/* ---------------- uniqueName：重名加序号 ---------------- */
eq('uniqueName 首次不改名', S.uniqueName('a.jpg', 0), 'a.jpg');
eq('uniqueName 序号用 _01 格式', S.uniqueName('a.jpg', 1), 'a_01.jpg');
eq('uniqueName 保留扩展名', S.uniqueName('a.jpg', 1), 'a_01.jpg');
eq('uniqueName 两位序号', S.uniqueName('a.jpg', 12), 'a_12.jpg');
eq('uniqueName 无扩展名', S.uniqueName('a', 0), 'a');
eq('uniqueName 无扩展名也加序号', S.uniqueName('a', 2), 'a_02');

/* ---------------- saveFile 参数校验（不发网络） ---------------- */
const p1 = S.saveFile({ relPath: '', blobOrUrl: 'https://x.com/a.jpg' });
ok('saveFile 空路径返回 Promise', p1 && typeof p1.then === 'function');
p1.then(r => {
    eq('saveFile 空路径 → BAD_PATH', r.code, S.CODES.BAD_PATH);
    eq('saveFile 空路径 ok=false', r.ok, false);

    return S.saveFile({ relPath: 'a/b.jpg', blobOrUrl: null });
}).then(r => {
    eq('saveFile 无内容 → BAD_PATH', r.code, S.CODES.BAD_PATH);

    /* ---------------- 汇总 ---------------- */
    console.log(`\n${pass} 通过 / ${fails.length} 失败`);
    if (fails.length) {
        console.log('\n失败明细：');
        fails.forEach((f, i) => console.log(`${i + 1}. ${f}`));
        process.exit(1);
    }
}).catch(e => {
    console.error('单测异常：', e);
    process.exit(2);
});
