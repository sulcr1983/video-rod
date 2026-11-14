/**
 * VRRootGuard 单测 —— 「库根层级」判据
 *
 * 背景（苏哥 2026-11-14 报）：资源库承诺「只扫自己和下属文件夹」，
 * 但上级「下载」目录里两张图也进了库，并显示成「网页」。
 * 复现链已在真机上确认：
 *   ① 用户点路径卡换目录时选到了上级「下载」；
 *   ② switchRootInteractive 下钻 video-rod 失败 → 静默把上级当库根；
 *   ③ save.js 的 stripPrefix 以为已经到库根，把 video-rod 剥掉 →
 *      文件直接写进下载根；
 *   ④ 入库 relPath 仍带 video-rod 前缀 → 磁盘与索引错位一层；
 *   ⑤ 路径只剩两段，parseRelPath 找不到站点 → platform 空 → UI 兜底「网页」。
 *
 * 这些判据必须可测：它们是「文件写错盘」与「库里出现幽灵条目」的最后一道闸。
 *
 * 跑法（两种都行）：
 *   node tools/test-root-guard.js
 *   node --test tools/test-root-guard.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

globalThis.self = globalThis;
require(path.join(__dirname, '..', 'js', 'library', 'root-guard.js'));
require(path.join(__dirname, '..', 'js', 'library', 'path.js'));

const G = globalThis.VRRootGuard;
const P = globalThis.VRPath;

/* ---------------- 模块与导出 ---------------- */
test('模块导出齐全', () => {
    assert.ok(G, 'VRRootGuard 未加载');
    /* resolveHandle / resolveDir 是「运行时入口」，漏掉导出不会报错，
     * 只会让调用方静默退回旧行为 —— 所以必须在这里逐个点名。
     * 已删除的死导出（plan / relInScope / resolveContext）不得再加回来：
     * 它们零生产引用，只会让后来者误以为「已经接上了」。 */
    ['normName', 'normPrefix', 'sameName', 'lastSeg', 'expectedName', 'classifyRel',
     'relFromRoot', 'inRoot', 'contextFromSettings',
     'resolveDir', 'resolveHandle']
        .forEach((k) => assert.strictEqual(typeof G[k], 'function', '缺少导出 ' + k));
});

/* ---------------- normName / sameName / lastSeg ---------------- */
test('normName：去斜杠、反斜杠归一', () => {
    assert.strictEqual(G.normName('/video-rod/'), 'video-rod');
    assert.strictEqual(G.normName('D:\\a\\video-rod'), 'D:/a/video-rod');
    assert.strictEqual(G.normName(null), '');
});

test('sameName：Windows 磁盘不区分大小写', () => {
    assert.strictEqual(G.sameName('Video-Rod', 'video-rod'), true);
    assert.strictEqual(G.sameName('video-rod/', 'video-rod'), true);
    assert.strictEqual(G.sameName('', 'video-rod'), false);
});

test('lastSeg：取末段', () => {
    assert.strictEqual(G.lastSeg('D:\\personal\\下载\\video-rod'), 'video-rod');
    assert.strictEqual(G.lastSeg('D:/personal/下载/video-rod/'), 'video-rod');
    assert.strictEqual(G.lastSeg(''), '');
});

/* ---------------- expectedName：库根该叫什么 ---------------- */
test('expectedName：system 模式取 detectedRoot/subdir 的末段', () => {
    assert.strictEqual(
        G.expectedName({ mode: 'system', subdir: 'video-rod', detectedRoot: 'D:/personal/下载' },
            'D:/personal/下载/video-rod'),
        'video-rod');
    assert.strictEqual(G.expectedName({ mode: 'system', subdir: 'video-rod' }, ''), 'video-rod');
});

test('expectedName：custom 模式取 customRoot 末段', () => {
    assert.strictEqual(
        G.expectedName({ mode: 'custom', customRoot: 'D:/素材/我的库', subdir: 'video-rod' },
            'D:/素材/我的库'),
        '我的库');
});

test('expectedName：custom 路径为空时退到 customName（历史漏洞）', () => {
    /* 原实现这时不校验句柄 → 任何目录都能当库根，正是本轮越界的入口之一 */
    assert.strictEqual(
        G.expectedName({ mode: 'custom', customRoot: '', customName: '我的库' }, ''),
        '我的库');
    /* 一个名字都没有 = 无法判定 → 返回空串（接受任意目录），
     * 绝不能退回 subdir：那会把「刚选好的新文件夹」误判成非法。 */
    assert.strictEqual(
        G.expectedName({ mode: 'custom', customRoot: '', customName: '' }, ''),
        '');
});

test('expectedName：空设置给默认 video-rod', () => {
    assert.strictEqual(G.expectedName({}, ''), 'video-rod');
});

/* ---------------- 句柄层级判定：全部走 resolveDir 真实实现 ---------------- */
/* 原先这里是 plan() 的纯判定（accept/drill/reject），但生产代码从未调用它 ——
 * 真正生效的是 resolveDir（inlines 同一套判断并做 FSA 下钻）。
 * 所以这里直接测真实函数：断言「结论」而不是「某个未被使用的中间函数」。 */

test('resolveDir：同名接受、大小写不敏感', async () => {
    assert.strictEqual((await G.resolveDir(fakeDir('video-rod'), 'video-rod')).layer, 'self');
    assert.strictEqual((await G.resolveDir(fakeDir('Video-Rod'), 'video-rod')).layer, 'self');
});

test('resolveDir：上级目录有子目录才允许下钻', async () => {
    const r = await G.resolveDir(fakeDir('下载', { 'video-rod': fakeDir('video-rod') }), 'video-rod');
    assert.strictEqual(r.layer, 'drilled');
});

test('resolveDir：上级目录且没有 video-rod 子目录时必须拒绝', async () => {
    const r = await G.resolveDir(fakeDir('下载'), 'video-rod');
    assert.strictEqual(r.handle, null);
    assert.strictEqual(r.reason, 'NOT_FOUND');
});

test('resolveDir：没有期望值时不猜也不拦', async () => {
    assert.strictEqual((await G.resolveDir(fakeDir('anything'), '')).layer, 'unknown');
});

/* ---------------- classifyRel：库内相对路径是否合法 ---------------- */
test('classifyRel：正常条目', () => {
    assert.strictEqual(G.classifyRel('video-rod/微博/作者/a.jpg', 'video-rod'), 'ok');
    assert.strictEqual(G.classifyRel('我的库/子库/B站/a.mp4', '我的库/子库'), 'ok');
    assert.strictEqual(G.classifyRel('video-rod\\微博\\a.jpg', 'video-rod'), 'ok');
});

test('classifyRel：平铺在上级目录的文件必须判为越界', () => {
    /* 本轮病灶：`星空皇冠小队成就界面.png` 在「下载」根上，首段无 video-rod */
    assert.strictEqual(G.classifyRel('星空皇冠小队成就界面.png', 'video-rod'), 'unprefixed');
    assert.strictEqual(G.classifyRel('其他库/微博/a.jpg', 'video-rod'), 'unprefixed');
});

test('classifyRel：前缀相近但不同不得误吃', () => {
    assert.strictEqual(G.classifyRel('video-rod-old/微博/a.jpg', 'video-rod'), 'unprefixed');
});

test('classifyRel：缺文件名 / 越级 / 绝对路径 / 空', () => {
    /* 只有前缀段，没有文件名 → 不是一条素材 */
    assert.strictEqual(G.classifyRel('video-rod', 'video-rod'), 'no-file');
    /* 前缀 + 一段 = 前缀段 + 文件名，合法（档名叫「微博」的图片） */
    assert.strictEqual(G.classifyRel('video-rod/微博', 'video-rod'), 'ok');
    assert.strictEqual(G.classifyRel('video-rod/../下载/a.jpg', 'video-rod'), 'escaping');
    assert.strictEqual(G.classifyRel('D:/下载/a.jpg', 'video-rod'), 'absolute');
    assert.strictEqual(G.classifyRel('', 'video-rod'), 'empty');
});

test('classifyRel：custom 平铺模式（空前缀）', () => {
    assert.strictEqual(G.classifyRel('微博/作者/a.jpg', ''), 'ok');
    assert.strictEqual(G.classifyRel('a.jpg', ''), 'no-file');
});

test('越界路径不得入库（classifyRel 的唯一判据）', () => {
    assert.strictEqual(G.classifyRel('video-rod/B站/a.mp4', 'video-rod'), 'ok');
    assert.strictEqual(G.classifyRel('星空.png', 'video-rod'), 'unprefixed');
});

/* ---------------- relFromRoot / inRoot：绝对路径边界 ---------------- */
test('relFromRoot：按段边界裁切', () => {
    assert.strictEqual(G.relFromRoot('D:/下载/video-rod/微博/a.jpg', 'D:/下载/video-rod'), '微博/a.jpg');
    assert.strictEqual(G.relFromRoot('D:\\下载\\video-rod\\a.jpg', 'D:\\下载\\video-rod'), 'a.jpg');
    assert.strictEqual(G.relFromRoot('d:/下载/VIDEO-ROD/a.jpg', 'D:/下载/video-rod'), 'a.jpg');
});

test('relFromRoot：上级目录与兄弟目录都不算库内', () => {
    assert.strictEqual(G.relFromRoot('D:/下载/a.jpg', 'D:/下载/video-rod'), '');
    assert.strictEqual(G.relFromRoot('D:/下载/video-rod-old/a.jpg', 'D:/下载/video-rod'), '');
    assert.strictEqual(G.relFromRoot('D:/a.jpg', ''), '');
});

test('inRoot：布尔判定', () => {
    assert.strictEqual(G.inRoot('D:/下载/video-rod/a.jpg', 'D:/下载/video-rod'), true);
    assert.strictEqual(G.inRoot('D:/下载/a.jpg', 'D:/下载/video-rod'), false);
});

/* ---------------- contextFromSettings：三处共用的根口径 ---------------- */
test('contextFromSettings：system 模式库根 = 下载根/subdir', () => {
    const c = G.contextFromSettings({ mode: 'system', subdir: 'video-rod', detectedRoot: 'D:/personal/下载' });
    assert.deepStrictEqual(
        [c.absRoot, c.prefix, c.expected, c.downloadRoot],
        ['D:/personal/下载/video-rod', 'video-rod', 'video-rod', 'D:/personal/下载']);
});

test('contextFromSettings：custom 模式库根 = customRoot', () => {
    const c = G.contextFromSettings({ mode: 'custom', customRoot: 'D:\\素材\\库' });
    assert.deepStrictEqual([c.absRoot, c.mode, c.expected], ['D:/素材/库', 'custom', '库']);
});

test('contextFromSettings：未探测下载根时宁可不索引', () => {
    assert.strictEqual(G.contextFromSettings({ mode: 'system', subdir: 'video-rod' }).absRoot, '');
    assert.strictEqual(G.contextFromSettings({ mode: 'system' }).prefix, 'video-rod');
});

/* ---------------- 与 VRPath 交接：越界路径「无站点」 ---------------- */
test('越界平铺路径识别不出站点（UI 才显示成「网页」）', () => {
    /* 钉住「界面显示成网页」的机制：路径只剩文件名单段时 parseRelPath 无站点段 */
    assert.strictEqual(P.parseRelPath('星空皇冠小队成就界面.png').platform, '');
    assert.strictEqual(P.parseRelPath('video-rod/微博/作者(@1)/a.jpg').platform, 'weibo');
    assert.strictEqual(G.classifyRel('星空皇冠小队成就界面.png', 'video-rod'), 'unprefixed');
    assert.strictEqual(G.classifyRel('video-rod/微博/作者(@1)/a.jpg', 'video-rod'), 'ok');
});

/* ---------------- resolveDir：FSA 定位（假句柄） ---------------- */
function fakeDir(name, children) {
    const kids = children || {};
    return {
        name: name,
        kind: 'directory',
        getDirectoryHandle(seg, opt) {
            if (Object.prototype.hasOwnProperty.call(kids, seg)) { return Promise.resolve(kids[seg]); }
            const e = new Error('not found');
            e.name = (opt && opt.create) ? 'NotAllowedError' : 'NotFoundError';
            return Promise.reject(e);
        }
    };
}

test('resolveDir：句柄已在期望层 → self', async () => {
    const r = await G.resolveDir(fakeDir('video-rod'), 'video-rod');
    assert.strictEqual(r.layer, 'self');
    assert.strictEqual(r.handle.name, 'video-rod');
});

test('resolveDir：上级目录且无子目录 → 不返回句柄（绝不降级为库根）', async () => {
    const r = await G.resolveDir(fakeDir('下载'), 'video-rod');
    assert.strictEqual(r.handle, null);
    assert.strictEqual(r.reason, 'NOT_FOUND');
});

test('resolveDir：上级目录有子目录 → 下钻一层', async () => {
    const r = await G.resolveDir(fakeDir('下载', { 'video-rod': fakeDir('video-rod') }), 'video-rod');
    assert.strictEqual(r.layer, 'drilled');
    assert.strictEqual(r.handle.name, 'video-rod');
});

test('resolveDir：没有句柄 / 没有期望值', async () => {
    assert.strictEqual((await G.resolveDir(null, 'video-rod')).reason, 'NO_HANDLE');
    assert.strictEqual((await G.resolveDir(fakeDir('下载'), '')).layer, 'unknown');
});

test('resolveDir：create=false 时不得凭空创建目录', async () => {
    const r = await G.resolveDir(fakeDir('下载'), 'video-rod', { create: false });
    assert.strictEqual(r.handle, null);
});
/* ==========================================================
 * 真实入库链路回归（2026-11-14）
 *
 * 上面钉的是纯判据；这里直接跑 sw-library / indexer 的实际函数，
 * 把苏哥报的现象原样复现成断言：
 *   D:\personal\下载\星空皇冠小队成就界面.png  ← 在「下载」根上，不在 video-rod 里
 * 旧实现的后果链（本次修复的对象）：
 *   ① sw-library 用「下载根」裁切 → rel 只剩文件名 → 入库；
 *   ② 首段被当成 subdir → parseRelPath 找不到站点 → UI 兜底成「网页」；
 *   ③ 保存链路 stripPrefix 以为已到库根 → 新下载也直接写进上级目录。
 * ========================================================== */

const DOWNLOAD_ROOT = 'D:/personal/下载';
const LIB_ROOT = DOWNLOAD_ROOT + '/video-rod';

/** 最小 chrome 假环境：只提供本链路真正用到的三个面 */
function fakeChrome(settings) {
    const cb = (fn, v) => setTimeout(() => fn(v), 0);
    return {
        storage: {
            session: {
                get: (_k, fn) => cb(fn, {}),
                set: (_o, fn) => cb(fn || (() => {}), undefined)
            },
            local: {
                get: (_k, fn) => cb(fn, { vrLibSettings: settings }),
                set: (_o, fn) => cb(fn || (() => {}), undefined)
            }
        },
        runtime: { sendMessage: (_m, fn) => { if (fn) { cb(fn, undefined); } }, lastError: null },
        downloads: { search: (_q, fn) => cb(fn, []), onChanged: { addListener: () => {} } }
    };
}

test('真实链路：用户日常下载（无预登记）绝不进库', async () => {
    const written = [];
    globalThis.chrome = fakeChrome({ mode: 'system', subdir: 'video-rod', detectedRoot: DOWNLOAD_ROOT });
    globalThis.VRDB = {
        getFile: () => Promise.resolve(null),
        putFiles: (fs) => { written.push(...fs); return Promise.resolve(fs.length); },
        getAllFiles: () => Promise.resolve([])
    };
    const R = require(path.join(__dirname, '..', 'js', 'library', 'sw-library.js'));
    const Lib = globalThis.VRLib || R;
    Lib._resetRootCache();

    /* 截图里那两张图：就在「下载」根上，没有任何预登记 meta */
    const out = await Lib._writeOne(null, {
        id: 7,
        filename: DOWNLOAD_ROOT + '/星空皇冠小队成就界面.png',
        state: 'complete',
        fileSize: 1700000,
        url: 'https://example.com/x.png'
    }, null);
    assert.strictEqual(out, null, '日常下载不得入库');
    assert.strictEqual(written.length, 0, '库里不该出现任何条目');
});

test('真实链路：库根内的下载正常入库，且 relPath 带 subdir 首段', async () => {
    const written = [];
    globalThis.chrome = fakeChrome({ mode: 'system', subdir: 'video-rod', detectedRoot: DOWNLOAD_ROOT });
    globalThis.VRDB = {
        getFile: () => Promise.resolve(null),
        putFiles: (fs) => { written.push(...fs); return Promise.resolve(fs.length); },
        getAllFiles: () => Promise.resolve([])
    };
    const Lib = globalThis.VRLib;
    Lib._resetRootCache();

    const meta = { relPath: 'video-rod/微博/作者(@1)/星空.png', platform: 'weibo', title: '星空' };
    const it = await Lib._writeOne(meta, {
        id: 8,
        filename: LIB_ROOT + '/微博/作者(@1)/星空.png',
        state: 'complete',
        fileSize: 1600000,
        url: 'https://example.com/a.png'
    }, null);

    assert.ok(it, '库根内的下载应当入库');
    assert.strictEqual(it.relPath, 'video-rod/微博/作者(@1)/星空.png');
    assert.strictEqual(it.state, 'ok');
    assert.strictEqual(it.platform, 'weibo', '站点段应被识别出来，而不是退化成空');
    assert.strictEqual(written.length, 1);
});

test('真实链路：扩展自己的下载若落在库根外，标为 outOfRoot 而不是正常卡片', async () => {
    const written = [];
    globalThis.chrome = fakeChrome({ mode: 'system', subdir: 'video-rod', detectedRoot: DOWNLOAD_ROOT });
    globalThis.VRDB = {
        getFile: () => Promise.resolve(null),
        putFiles: (fs) => { written.push(...fs); return Promise.resolve(fs.length); },
        getAllFiles: () => Promise.resolve([])
    };
    const Lib = globalThis.VRLib;
    Lib._resetRootCache();

    /* 下载器兜底丢了目录（ADR-070）：文件落到「下载」根，不在 video-rod 下 */
    const meta = { relPath: 'video-rod/微博/作者(@1)/星空.png' };
    const it = await Lib._writeOne(meta, {
        id: 9,
        filename: DOWNLOAD_ROOT + '/星空.png',
        state: 'complete',
        fileSize: 1200000,
        url: 'https://example.com/b.png'
    }, null);

    assert.ok(it);
    assert.strictEqual(it.state, 'outOfRoot', '库外条目不得是 ok，否则主页会出现一张打不开的卡');
    assert.strictEqual(it.outOfRoot, 1);
    assert.strictEqual(it.pendingArchive, 1, 'ADR-070 的待归档语义要保留');
    assert.ok(!Lib._isActive(it), '库外条目不算活跃条目（查重/统计都不该看到它）');
});

test('真实链路：ingestDirect 拒绝不属于本库的 relPath', async () => {
    globalThis.chrome = fakeChrome({ mode: 'system', subdir: 'video-rod', detectedRoot: DOWNLOAD_ROOT });
    const written = [];
    globalThis.VRDB = {
        getFile: () => Promise.resolve(null),
        putFiles: (fs) => { written.push(...fs); return Promise.resolve(fs.length); },
        getAllFiles: () => Promise.resolve([])
    };
    const Lib = globalThis.VRLib;
    Lib._resetRootCache();

    const bad = await Lib.ingestDirect({ relPath: '星空皇冠小队成就界面.png', type: 'image' });
    assert.strictEqual(bad, null, '平铺在根上的路径不是库内条目');
    assert.strictEqual(written.length, 0);

    const ok = await Lib.ingestDirect({ relPath: 'video-rod/微博/作者(@1)/b.png', type: 'image' });
    assert.ok(ok, '带 subdir 首段的路径应当入库');
});

/* ==========================================================
 * indexer.setRoot 的两种语义（2026-11-14）
 *
 * 这两个入口看起来都叫「设置库根」，但含义完全相反，混用就会出本轮的问题：
 *   authorize：给**已有**库根补授权 —— 句柄必须落在那一层，选到上级要拒绝；
 *   rebase   ：用户**显式**换一个素材文件夹 —— 他选谁就是谁，但范围要如实回报。
 * 混用的两种翻车方式：
 *   · 全是 authorize → 用户换库时，选个新名字的文件夹会被误拒；
 *   · 全是 rebase   → 补授权时选到「下载」也会被接受，扫描范围静默扩大。
 * ========================================================== */

const indexerPath = path.join(__dirname, '..', 'js', 'library', 'indexer.js');

/** 按需装配 indexer + 假 chrome/VRDB；返回 { I, written } */
function loadIndexer(settings, kids) {
    const written = { files: [], settings: {}, handle: 'unset' };
    globalThis.chrome = Object.assign(fakeChrome(settings || {}), {
        runtime: { sendMessage: () => {}, lastError: null }
    });
    globalThis.VRDB = {
        getAllFiles: () => Promise.resolve([]),
        putFiles: (fs) => { written.files.push(...fs); return Promise.resolve(fs.length); },
        getFile: () => Promise.resolve(null),
        getSetting: () => Promise.resolve(''),
        setSetting: (k, v) => { written.settings[k] = v; return Promise.resolve(true); },
        setHandle: (_k, h) => { written.handle = h; return Promise.resolve(true); },
        log: () => Promise.resolve(true)
    };
    globalThis.VRIndex = undefined;
    delete require.cache[require.resolve(indexerPath)];
    require(indexerPath);
    return { I: globalThis.VRIndex, written };
}

test('setRoot authorize：上级目录且下面没有 video-rod → 拒绝（LIB_E_ROOT_LAYER）', async () => {
    const { I } = loadIndexer({ mode: 'system', subdir: 'video-rod', detectedRoot: DOWNLOAD_ROOT });
    let err = null;
    try {
        await I.setRoot(fakeDir('下载', {}), LIB_ROOT, 'video-rod');
    } catch (e) { err = e; }
    assert.ok(err, '必须抛错，而不是把上级目录当库根');
    assert.strictEqual(err.vrCode, 'LIB_E_ROOT_LAYER');
    assert.match(err.message, /请选「video-rod」/);
});

test('setRoot authorize：上级目录但下面有 video-rod → 自动下钻，不报错', async () => {
    const { I } = loadIndexer({ mode: 'system', subdir: 'video-rod', detectedRoot: DOWNLOAD_ROOT });
    const child = fakeDir('video-rod');
    const r = await I.setRoot(fakeDir('下载', { 'video-rod': child }), LIB_ROOT, 'video-rod');
    assert.strictEqual(r.layer, 'drilled');
});

test('setRoot rebase：用户选到上级目录 → 接受但不自动下钻，并回报 layer=parent', async () => {
    /* 回归重点：不能在 rebase 时把用户选的「下载」偷偷换成 video-rod。
     * 那等于替他改了选择，而他明明说了要整个下载目录。 */
    const { I } = loadIndexer({ mode: 'system', subdir: 'video-rod', detectedRoot: DOWNLOAD_ROOT });
    const parent = fakeDir('下载', { 'video-rod': fakeDir('video-rod') });
    const r = await I.setRoot(parent, '', '下载', { mode: 'rebase' });
    assert.strictEqual(r.layer, 'parent', '必须如实回报「范围被放大」');
    assert.strictEqual(r.prefix, '下载', '索引首段要跟着真实层走，不能假装是 video-rod');
});

test('setRoot rebase：换成一个名字不同的新文件夹 → 合法，layer=self', async () => {
    const { I } = loadIndexer({ mode: 'custom', customRoot: 'D:/旧库', customName: '旧库' });
    const r = await I.setRoot(fakeDir('新素材'), '', '新素材', { mode: 'rebase' });
    assert.strictEqual(r.layer, 'self');
});

test('mergeEntry：越界标记在「文件真的进了库根」后必须重算为 ok', async () => {
    /* 不粘住的原因：用户把文件移进库根、或换回原库根后重新扫描，
     * 磁盘才是真相；粘住会让这些条目永远消失（比本轮 bug 更糟）。 */
    const { I } = loadIndexer({ mode: 'system', subdir: 'video-rod', detectedRoot: DOWNLOAD_ROOT });
    const old = { relPath: 'video-rod/微博/作者/a.png', state: 'outOfRoot', outOfRoot: 1, starred: 1 };
    const item = { relPath: 'video-rod/微博/作者/a.png', absPath: LIB_ROOT + '/微博/作者/a.png' };
    const out = I._mergeEntry(old, item);
    assert.strictEqual(out.state, 'ok');
    assert.ok(!out.outOfRoot);
    assert.strictEqual(out.starred, 1, '用户数据要保住');
});

test('mergeEntry：回收站标记仍然粘住（扫描无权替用户恢复）', async () => {
    const { I } = loadIndexer({ mode: 'system', subdir: 'video-rod', detectedRoot: DOWNLOAD_ROOT });
    const old = { relPath: 'video-rod/微博/作者/a.png', state: 'trashed', trashBatch: 'b1' };
    const out = I._mergeEntry(old, { relPath: 'video-rod/微博/作者/a.png' });
    assert.strictEqual(out.state, 'trashed');
    assert.strictEqual(out.trashBatch, 'b1');
});

/* ---------------- 下载根合法性：唯一真源 ---------------- */
/* 2026-11-14 收敛前，app.js / indexer.js / save.js 各写一份逐字相同的判据。
 * 这里把边界钉死，避免再次分叉。 */
test('isPlausibleDownloadRoot：拒绝浏览器 profile / 受管默认名', () => {
    assert.strictEqual(G.isPlausibleDownloadRoot('D:/personal/下载'), true);
    assert.strictEqual(G.isPlausibleDownloadRoot('\\nas\share'), true);
    assert.strictEqual(G.isPlausibleDownloadRoot('/home/u/Downloads'), true);
    assert.strictEqual(G.isPlausibleDownloadRoot('D:/Chrome/User Data/Default'), false);
    assert.strictEqual(G.isPlausibleDownloadRoot('E:/x/.edge-test/Default'), false);
    assert.strictEqual(G.isPlausibleDownloadRoot('C:/Webstore Downloads'), false);
    assert.strictEqual(G.isPlausibleDownloadRoot('relative/path'), false);
    assert.strictEqual(G.isPlausibleDownloadRoot(''), false);
    assert.strictEqual(G.isPlausibleDownloadRoot(null), false);
});

/* ---------------- 活跃条目 / 越界标记：唯一真源 ---------------- */
/* 之前 app / sw-library / dedup / trash / indexer 各写一遍
 * `state === 'outOfRoot' || e.outOfRoot`，改状态名必漏改。这里把语义钉死。 */
test('isOutOfRoot：兼容 state 与旧标记两种写法', () => {
    assert.strictEqual(G.isOutOfRoot({ state: 'outOfRoot' }), true);
    assert.strictEqual(G.isOutOfRoot({ outOfRoot: 1 }), true);
    assert.strictEqual(G.isOutOfRoot({ outOfRoot: true }), true);
    assert.strictEqual(G.isOutOfRoot({ state: 'ok' }), false);
    assert.strictEqual(G.isOutOfRoot(null), false);
});

test('isActiveEntry：回收站与越界都不算活跃', () => {
    assert.strictEqual(G.isActiveEntry({ state: 'ok' }), true);
    assert.strictEqual(G.isActiveEntry({ state: 'missing' }), true);   // 缺失仍是库里条目
    assert.strictEqual(G.isActiveEntry({ state: 'trashed' }), false);
    assert.strictEqual(G.isActiveEntry({ state: 'outOfRoot' }), false);
    assert.strictEqual(G.isActiveEntry({ outOfRoot: 1 }), false);
    assert.strictEqual(G.isActiveEntry(null), false);
});
