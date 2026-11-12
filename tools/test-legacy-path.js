/**
 * 历史作者 ID 污染自愈（2026-11-12）纯逻辑测试
 *
 * 测的是 js/library/app.js 里的三小段 helper，用 new Function 从源文件切出来，
 * 不起浏览器、不碰真实库。覆盖：
 *  · 假 ID 文本归一
 *  · 整条记录迁移时星标/标签/指纹/来源不丢
 *  · creatorId 只清那个已知假 ID，真 ID 保留
 *  · 迁移只写脏条目，干净条目一个都不动
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'library', 'app.js'), 'utf8');

function cut(a, b) {
    const i = src.indexOf(a);
    const j = src.indexOf(b, i);
    if (i < 0 || j < 0) { throw new Error('cut failed: ' + a); }
    return src.slice(i, j);
}

const code = cut('var LEGACY_BAD_CREATOR =', 'async function load(retry, recheck) {');
const M = new Function('root', code + '\nreturn {cleanLegacyCreatorText: cleanLegacyCreatorText,'
    + 'legacyCreatorRow: legacyCreatorRow,'
    + 'migrateLegacyCreatorPaths: migrateLegacyCreatorPaths,'
    + 'BAD: LEGACY_BAD_CREATOR};')({});

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, '|', JSON.stringify(extra)); }
}
function eq(name, got, want) { ok(name, got === want, { got, want }); }

const BAD = M.BAD;

// ---- 文本归一 ----
eq('T1a 去掉假 ID', M.cleanLegacyCreatorText('人民空军' + BAD + '_视频.mp4'), '人民空军_视频.mp4');
eq('T1b 多处都去掉', M.cleanLegacyCreatorText('B站/人民空军' + BAD + '/人民空军' + BAD + '_a.mp4'),
   'B站/人民空军/人民空军_a.mp4');
eq('T1c 非字符串原样返回', M.cleanLegacyCreatorText(42), 42);
eq('T1d 空值原样返回', M.cleanLegacyCreatorText(null), null);
ok('T1e 不含假 ID 的文本不变', M.cleanLegacyCreatorText('微博/张三(@123)_a.mp4') === '微博/张三(@123)_a.mp4');

// ---- 整条记录 ----
const row = {
    relPath: 'video-rod/B站/人民空军' + BAD + '/视频/人民空军' + BAD + '_麒麟.mp4',
    absPath: 'D:/personal/Downloads/video-rod/B站/人民空军' + BAD + '/视频/人民空军' + BAD + '_麒麟.mp4',
    creatorFull: '人民空军' + BAD,
    creatorId: '360421127',
    displayName: '人民空军' + BAD + '_麒麟',
    starred: 1,
    tags: ['军事', '航展'],
    sha256: 'a'.repeat(64),
    sourceUrl: 'https://cdn.example/a.mp4',
    pageUrl: '',
    type: 'video'
};
const n = M.legacyCreatorRow(row);
ok('T2a relPath 归一化且不含假 ID', n.relPath.indexOf(BAD) < 0 && n.relPath.indexOf('人民空军/视频/人民空军_麒麟.mp4') > 0, n.relPath);
ok('T2b absPath 同步归一', n.absPath.indexOf(BAD) < 0, n.absPath);
eq('T2c 星标保留', n.starred, 1);
eq('T2d 标签保留', JSON.stringify(n.tags), JSON.stringify(['军事', '航展']));
eq('T2e 指纹保留', n.sha256, 'a'.repeat(64));
eq('T2f 来源保留', n.sourceUrl, 'https://cdn.example/a.mp4');
eq('T2g 假 creatorId 清空', n.creatorId, '');
eq('T2h 原对象不被改动', row.creatorId, '360421127');

const good = { relPath: 'video-rod/B站/影视飓风(@946974)/视频/a.mp4', creatorId: '946974', starred: 1 };
const ng = M.legacyCreatorRow(good);
eq('T3a 真 ID 保留', ng.creatorId, '946974');
eq('T3b 正常路径原样', ng.relPath, good.relPath);

// ---- 迁移（mock VRDB）----
(async function () {
    const calls = { put: [], del: [] };
    const VRDB = {
        putFiles: async function (a) { calls.put.push(a); },
        deleteFiles: async function (a) { calls.del.push(a); }
    };
    const rootStub = { VRDB: VRDB };
    // 重新构造一个带 mock root 的实例
    const M2 = new Function('root', code + '\nreturn {migrateLegacyCreatorPaths: migrateLegacyCreatorPaths};')(rootStub);
    const list = [
        Object.assign({}, row),
        { relPath: 'video-rod/B站/影视飓风(@946974)/视频/a.mp4', starred: 0 }
    ];
    const cnt = await M2.migrateLegacyCreatorPaths(list);
    eq('T4a 迁移 1 条', cnt, 1);
    eq('T4b putFiles 只写 1 条', calls.put[0].length, 1);
    eq('T4c deleteFiles 只删旧主键', calls.del[0].length, 1);
    ok('T4d 删的是旧 relPath', calls.del[0][0].indexOf(BAD) >= 0, calls.del[0]);
    ok('T4e 写的是新 relPath', calls.put[0][0].relPath.indexOf(BAD) < 0, calls.put[0][0].relPath);
    ok('T4f list 原地更新（本次渲染即刻生效）', list[0].relPath.indexOf(BAD) < 0, list[0].relPath);
    ok('T4g 干净条目未被写库', calls.put[0].length === 1);

    const empty = { put: [], del: [] };
    const M3 = new Function('root', code + '\nreturn {migrateLegacyCreatorPaths: migrateLegacyCreatorPaths};')({
        VRDB: { putFiles: async a => empty.put.push(a), deleteFiles: async a => empty.del.push(a) }
    });
    eq('T5a 无污染时不迁移', await M3.migrateLegacyCreatorPaths([{ relPath: 'video-rod/微博/a.jpg' }]), 0);
    eq('T5b 无污染时零写入', empty.put.length + empty.del.length, 0);
    eq('T5c 空列表安全', await M3.migrateLegacyCreatorPaths([]), 0);
    eq('T5d 无 VRDB 安全', await new Function('root', code + '\nreturn {migrateLegacyCreatorPaths: migrateLegacyCreatorPaths};')({})
        .migrateLegacyCreatorPaths([{ relPath: 'x' + BAD }]), 0);

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})();
