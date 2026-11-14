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

/* ---------------- 2026-11-14：句柄不在库根层时必须失败 ---------------- */
/* 背景：句柄指到上级「下载」时，stripPrefix 会把 video-rod 剥掉，
 * 文件直接写进下载根。这种「层级不对」不能降级到下载器 ——
 * 下载器落点就是那个上级目录，等于换个通道继续越界。 */
eq('decideMode 层级错误 → none（不降级下载器）',
    S.decideMode({ prefer: 'auto', fsa: true, hasHandle: false, downloads: true, layerError: true }).mode,
    'none');
eq('decideMode 层级错误带 ROOT_LAYER 码',
    S.decideMode({ prefer: 'auto', fsa: true, hasHandle: false, downloads: true, layerError: true }).code,
    S.CODES.ROOT_LAYER);
ok('CODES 里确实有 ROOT_LAYER', !!S.CODES.ROOT_LAYER);
/* 回归：普通「没有句柄」（用户从没授权）仍应降级下载器，不能被上面这条误伤 */
eq('decideMode 仅无句柄时仍降级下载器',
    S.decideMode({ prefer: 'auto', fsa: true, hasHandle: false, downloads: true }).mode, 'downloads');

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

    /* ---------------- 入库路径必须带 subdir 前缀 ---------------- */
    /* 回归：FSA 落盘时 relOut 是把根句柄那层剥掉的（微博/xxx/视频/a.mp4），
     * 但入库必须补回 video-rod/ 前缀，否则 parseRelPath 把「微博」当 subdir，
     * 从第二段找平台 → 找不到 → platform/type 全空（资源库不分组、查重失效）。
     * 2026-11-06 实测：库里 27 个视频 mediaUrl 全空、platform 大量为空，就是这条链路断的。 */
    /* path.js 是 IIFE，挂到 self（Node 里就是 globalThis），不走 module.exports */
    require(path.join(__dirname, '..', 'js', 'library', 'path.js'));
    const V = globalThis.VRPath;
    ok('VRPath 已加载', !!(V && typeof V.parseRelPath === 'function'));

    const noPrefix = V.parseRelPath('微博/weibo.com/视频/a.mp4');
    /* 2026-11-07：站点段改为「允许出现在任意位置」，所以缺前缀时
     * weibo.com 也能被认出来（旧实现返回空）。这属于更宽容的识别，
     * 不是回归 —— 老结构里本来就不该出现这种路径，认出来比丢掉好。 */
    eq('入库路径缺前缀 → 仍能认出站点', noPrefix.platform, 'weibo.com');

    const withPrefix = V.parseRelPath('video-rod/微博/weibo.com/视频/a.mp4');
    eq('补齐前缀后 platform 正确', withPrefix.platform, 'weibo');
    eq('补齐前缀后 type 正确', withPrefix.type, 'video');

    /* ---------------- 入库字段必须包含 mediaUrl ---------------- */
    /* 查重（vrFindExistingMedia）同时比对 sourceUrl 与 mediaUrl，
     * 任一侧漏搬都会让同一素材反复下载。这里直接扫源码确认字段被搬运，
     * 因为 ingest 是内部函数、Node 里调不到。 */
    const saveSrc = require('fs').readFileSync(SRC, 'utf8');
    ok('save.ingest 搬运 mediaUrl', /mediaUrl:\s*m\.mediaUrl/.test(saveSrc));
    ok('save.ingest 搬运 sourceUrl', /sourceUrl:\s*m\.sourceUrl/.test(saveSrc));

    const swSrc = require('fs').readFileSync(
        path.join(__dirname, '..', 'js', 'library', 'sw-library.js'), 'utf8');
    /* ingestDirect 的 mediaUrl 现在走 pickSourceUrl()：
     * sourceUrl / mediaUrl 互为兜底，且 blob: 一律不落库（存进去是死键）。
     * 断言随之改为「字段仍在 + 有兜底逻辑」，不再死抠 m.mediaUrl 字面量。 */
    ok('sw-library.ingestDirect 保留 mediaUrl 字段', /mediaUrl:\s*pickSourceUrl\(/.test(swSrc));
    ok('sw-library mediaUrl 与 sourceUrl 互为兜底',
        /mediaUrl:\s*pickSourceUrl\(\s*m\.mediaUrl\s*\|\|\s*m\.sourceUrl/.test(swSrc));
    ok('sw-library 过滤 blob 源（pickSourceUrl 只认 http）',
        /function pickSourceUrl[\s\S]{0,400}\^https\?:\/i\.test/.test(swSrc));

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
