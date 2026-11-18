/**
 * 离线媒体库导出器单测（抖珍藏式架构）
 *
 * 架构（2026-11-18 调整）：
 *   · index.html  固定不变，只在查看器代码更新时重写
 *   · data.js     每次导出覆盖（素材增删只改这一个文件）
 *   · thumbs/     复用库里的 _library/thumbs/（不复制）
 *   · 素材本体    相对路径直读库里文件（不复制）
 *
 * 前置实测（Edge 157）：file:// 下 <script src> 与 fetch 同目录文件都可用。
 *
 * 跑法：node tools/test-offline-export.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

globalThis.self = globalThis;
require(path.join(__dirname, '..', 'js', 'library', 'offline-export.js'));

const E = globalThis.VROfflineExport;

function snapshot(extra) {
    return Object.assign({
        schema: 2,
        version: 1,
        at: 1700000000000,
        root: 'D:/Media/video-rod',
        subdir: 'video-rod',
        count: 3,
        favorites: [{ id: 'f1', name: '收藏夹' }],
        files: [
            {
                relPath: 'video-rod/bilibili/碧诗/视频/a.mp4',
                fileName: 'a.mp4', displayName: '作品A', size: 1048576,
                mtime: 1700000000000, platform: 'bilibili', creatorFull: '碧诗(@2)',
                type: 'video', title: '作品A标题', starred: 1, tags: ['测试'],
                thumbFile: 'abc123', width: 1920, height: 1080, duration: 63,
                pageUrl: 'https://www.bilibili.com/video/BV1xx',
                mediaUrl: 'https://cdn.example.com/a.mp4?sign=SECRET'
            },
            {
                relPath: 'video-rod/xiaohongshu/某人/图片/b.jpg',
                fileName: 'b.jpg', size: 2048, mtime: 1700000001000,
                platform: 'xiaohongshu', creatorFull: '某人(@u1)', type: 'image',
                title: '图片B', starred: 0, tags: []
            },
            {
                relPath: 'video-rod/weibo/甲乙/音频/c.mp3',
                fileName: 'c.mp3', size: 52428800, mtime: 1700000002000,
                platform: 'weibo', creatorFull: '甲乙(@w1)', type: 'audio',
                title: '音频C'
            }
        ]
    }, extra || {});
}

/* ---------------- slim：字段与相对路径 ---------------- */

test('slim：schema 升级到 3（相对路径架构）', () => {
    const d = E.slim(snapshot());
    assert.equal(d.schema, 3);
});

test('slim：保留查看器需要的字段', () => {
    const d = E.slim(snapshot());
    assert.equal(d.count, 3);
    const f = d.files[0];
    assert.equal(f.p, 'video-rod/bilibili/碧诗/视频/a.mp4');
    assert.equal(f.n, '作品A');
    assert.equal(f.t, 'video');
    assert.equal(f.pl, 'bilibili');
    assert.equal(f.a, '碧诗(@2)');
    assert.equal(f.ti, '作品A标题');
    assert.equal(f.st, 1);
    assert.equal(f.w, 1920);
    assert.equal(f.d, 63);
});

test('slim：**剥掉 subdir 前缀**，素材路径相对库根', () => {
    const d = E.slim(snapshot());
    const f = d.files[0];
    /* relPath 是 video-rod/bilibili/...，剥掉 video-rod/ 后是 bilibili/... */
    assert.equal(f.mp, '../../bilibili/碧诗/视频/a.mp4');
});

test('slim：缩略图输出相对路径 ../thumbs/<key>.webp', () => {
    const d = E.slim(snapshot());
    assert.equal(d.files[0].tp, '../thumbs/abc123.webp');
    assert.equal(d.files[0].th, 'abc123');
});

test('slim：无缩略图条目不带 tp', () => {
    const d = E.slim(snapshot());
    assert.equal(d.files[1].tp, undefined);
});

test('slim：**不把带签名的直链写进数据**（安全约束）', () => {
    const json = JSON.stringify(E.slim(snapshot()));
    assert.equal(json.indexOf('SECRET') >= 0, false);
    assert.equal(json.indexOf('sign=') >= 0, false);
});

test('slim：保留原帖链接', () => {
    const d = E.slim(snapshot());
    assert.equal(d.files[0].pu, 'https://www.bilibili.com/video/BV1xx');
});

test('slim：rootRel 可配置', () => {
    const d = E.slim(snapshot(), { rootRel: '../../../' });
    assert.equal(d.files[0].mp, '../../../bilibili/碧诗/视频/a.mp4');
});

test('slim：脏输入不崩', () => {
    [null, undefined, {}, { files: null }, { files: 'x' }].forEach((s) => {
        const d = E.slim(s);
        assert.equal(Array.isArray(d.files), true);
        assert.equal(d.files.length, 0);
    });
});

test('stripSubdir：剥首段，不匹配则不剥', () => {
    assert.equal(E.stripSubdir('video-rod/a/b.mp4', 'video-rod'), 'a/b.mp4');
    assert.equal(E.stripSubdir('other/a/b.mp4', 'video-rod'), 'other/a/b.mp4');
    assert.equal(E.stripSubdir('a/b.mp4', ''), 'a/b.mp4');
});

/* ---------------- buildHtml：外部数据文件 ---------------- */

test('buildHtml：**数据走外部 data.js**，不内联', () => {
    const html = E.buildHtml(E.slim(snapshot()));
    assert.ok(html.includes('<script src="data.js"></script>'), '应引用外部数据文件');
    assert.equal(html.includes('id="vr-data"'), false, '默认不再内联');
});

test('buildHtml：可选内联（兼容模式）', () => {
    const html = E.buildHtml(E.slim(snapshot()), { inlineData: true });
    assert.ok(html.includes('id="vr-data"'));
    assert.equal(html.includes('<script src="data.js">'), false);
});

test('buildHtml：产出完整 HTML 且体积小（不含数据）', () => {
    const html = E.buildHtml(E.slim(snapshot()));
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.trim().endsWith('</html>'));
    /* 不含数据 → 应该远小于 100KB */
    assert.ok(html.length < 100000, 'HTML 不该内嵌数据，实际 ' + html.length);
});

test('buildHtml：无外部样式依赖', () => {
    const html = E.buildHtml(E.slim(snapshot()));
    assert.equal(/<link[^>]+href="(?!data:)/i.test(html), false);
});

test('buildHtml：标题与时间戳', () => {
    const html = E.buildHtml(E.slim(snapshot()), { title: '我的库' });
    assert.ok(html.includes('<title>我的库</title>'));
    assert.ok(html.includes('数据截止'));
});

/* ---------------- buildDataJs ---------------- */

test('buildDataJs：产出 window.VR_LIB 赋值语句', () => {
    const d = E.slim(snapshot());
    const js = E.buildDataJs(d);
    assert.ok(js.includes('window.VR_LIB = '), 'file:// 下 script 加载需要这个');
    assert.ok(js.includes('"作品A标题"'));
    assert.ok(js.trimEnd().endsWith(';'));
});

test('buildDataJs：带注释说明（用户能看懂）', () => {
    const js = E.buildDataJs(E.slim(snapshot()));
    assert.ok(js.includes('本地媒体库数据'));
    assert.ok(js.includes('index.html'));
});

test('buildDataJs：可被 JS 解析（合法赋值）', () => {
    const js = E.buildDataJs(E.slim(snapshot()));
    /* 用 Function 模拟浏览器执行，验证语法合法且能取出数据 */
    const sandbox = {};
    const fn = new Function('window', js);
    fn(sandbox);
    assert.ok(sandbox.VR_LIB, '应挂到 window 上');
    assert.equal(sandbox.VR_LIB.count, 3);
});

/* ---------------- 查看器能力 ---------------- */

test('查看器：支持搜索 / 类型 / 平台 / 排序 / 星标 / 灯箱', () => {
    const html = E.buildHtml(E.slim(snapshot()));
    ['id="q"', 'id="fType"', 'id="fPlat"', 'id="fSort"', 'id="fStar"', 'id="lb"']
        .forEach((k) => assert.ok(html.includes(k), '缺 ' + k));
});

test('查看器：数据来源优先 window.VR_LIB', () => {
    const html = E.buildHtml(E.slim(snapshot()));
    assert.ok(html.includes('window.VR_LIB'));
});

test('查看器：素材直接读库里文件（不复制）', () => {
    const html = E.buildHtml(E.slim(snapshot()));
    assert.ok(html.includes('mediaOf'), '应通过 mediaOf 取素材路径');
    assert.ok(html.includes('f.mp'), '应使用 mp 字段（相对库根）');
});

test('查看器：缩略图用 tp 相对路径', () => {
    const html = E.buildHtml(E.slim(snapshot()));
    assert.ok(html.includes('f.tp'));
    assert.ok(html.includes('thumbs/'));
});

test('查看器：**没有写操作**（只读）', () => {
    const html = E.buildHtml(E.slim(snapshot()));
    ['deleteFile', 'removeEntry', 'showDirectoryPicker', 'createWritable']
        .forEach((k) => assert.equal(html.includes(k), false, '只读查看器不该出现 ' + k));
});

test('查看器：搜索支持 -词 排除', () => {
    const html = E.buildHtml(E.slim(snapshot()));
    assert.ok(html.includes('charAt(0)!=="- "') || html.includes('charAt(0)!=="-"'));
});

test('查看器：大量条目截断渲染', () => {
    const files = [];
    for (let i = 0; i < 5000; i++) {
        files.push({ relPath: 'video-rod/a/' + i + '.jpg', fileName: i + '.jpg', type: 'image' });
    }
    const html = E.buildHtml(E.slim({ subdir: 'video-rod', files }));
    assert.ok(html.includes('slice(0,600)'));
});

/* ---------------- buildBundle：两个文件 ---------------- */

test('buildBundle：产出 html + dataJs 两个文件', async () => {
    const r = await E.buildBundle(snapshot(), null, { title: '测试库' });
    assert.ok(r.html, '应有 html');
    assert.ok(r.dataJs, '应有 dataJs');
    assert.equal(r.count, 3);
    assert.ok(r.html.includes('<script src="data.js">'));
    assert.ok(r.dataJs.includes('window.VR_LIB'));
});

test('buildBundle：素材更新只改 dataJs，html 不变', async () => {
    const r1 = await E.buildBundle(snapshot(), null, { title: '库' });
    const snap2 = snapshot();
    snap2.files.push({
        relPath: 'video-rod/douyin/新人/视频/d.mp4', fileName: 'd.mp4',
        size: 999, type: 'video', title: '新素材'
    });
    snap2.count = 4;
    const r2 = await E.buildBundle(snap2, null, { title: '库' });

    /* HTML 结构完全相同（数据不进 HTML） */
    assert.equal(r1.html, r2.html, 'HTML 不应随数据变化');
    assert.notEqual(r1.dataJs, r2.dataJs, 'dataJs 应更新');
    assert.ok(r2.dataJs.includes('新素材'));
});

test('buildBundle：旧签名兼容（deps 可为 null）', async () => {
    const r = await E.buildBundle(snapshot(), null, {});
    assert.ok(r.html);
    assert.ok(r.dataJs);
});
