#!/usr/bin/env node
/**
 * 微博相册采集纯逻辑单测（ADR-056）
 *
 * 2026-11-06 真实登录态实测后重写：
 *   · 档位：large 最大（744×913），oslarge 更小，lz/proxy 全失败 → 只留 large/original
 *   · 月份：timeline_year/month 大面积缺失 → 不再按月分组，改按接口顺序收集
 *
 * 覆盖 VRWeiboAlbum：
 *   A 档位与候选链   B 条目收集   C 分页终止   D 可用性判定与探测
 *   E 下载条目构造   F 按 pid 去重   G 结果归类   H 代际守卫
 *
 * 全部离线：fetchPage 由用例注入假实现，不碰网络、不碰 chrome API。
 *
 * 用法：node tools/test-weibo-album.js
 */
'use strict';

const A = require('../js/weibo-album-core.js');

let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, detail) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else {
        fail++; fails.push(name);
        console.log('FAIL  ' + name + (detail ? '  ' + detail : ''));
    }
}
function eq(name, got, expect) {
    const a = JSON.stringify(got), b = JSON.stringify(expect);
    ok(name, a === b, 'got=' + a + ' expect=' + b);
}

const PI = '006haVSDly1iiqannkobqj30ko0pd7dl';

/* ---------- A. 档位与候选链 ---------- */
eq('A1 档位顺序只有 large/original', A.TIER_ORDER, ['large', 'original']);
ok('A2 首选是 large（实测最大）', A.TIER_ORDER[0] === 'large');
ok('A3 oslarge 已移除', !A.TIER_ORDER.includes('oslarge'));
ok('A4 lz 已移除（实测全失败）', !A.TIER_ORDER.includes('lz'));
ok('A5 第三方代理已移除', !A.TIER_ORDER.includes('proxy'));

{
    const c = A.candidates(PI);
    eq('A6 候选链两级', c.length, 2);
    ok('A7 第 1 级 large', c[0].indexOf('/large/') > 0);
    ok('A8 第 2 级 original', c[1].indexOf('/original/') > 0);
    ok('A9 都带 pid 与 .jpg', c.every((u) => u.indexOf(PI + '.jpg') > 0));
}
{
    const c = A.candidates(PI, 'original');
    ok('A10 指定 original 时排第一', c[0].indexOf('/original/') > 0);
    ok('A11 其余档位仍补齐', c.length === 2);
}
{
    const c = A.candidates(PI, 'nonexistent');
    ok('A12 非法档位回退到首选', c[0].indexOf('/large/') > 0);
}
{
    const chain = A.candidatesFromUrl('https://wx3.sinaimg.cn/orj360/' + PI + '.jpg');
    ok('A13 链首 large', chain[0].indexOf('/large/') > 0);
    ok('A14 链含 original', chain.some((u) => u.indexOf('/original/') > 0));
    ok('A15 页面原地址保留为兜底', chain.indexOf('https://wx3.sinaimg.cn/orj360/' + PI + '.jpg') >= 0);
    eq('A16 无重复', new Set(chain).size, chain.length);
}
eq('A17 pid 提取', A.pidOf('https://wx3.sinaimg.cn/large/' + PI + '.jpg'), PI);
eq('A18 非 sinaimg 无 pid', A.pidOf('https://example.com/a/b.jpg'), '');
eq('A19 非 sinaimg 原样单元素', A.candidatesFromUrl('https://example.com/a/b.jpg'),
    ['https://example.com/a/b.jpg']);
eq('A20 空输入空数组', A.candidatesFromUrl(''), []);

/* ---------- A2. 尺寸档（大/中/小，苏哥 2026-11-07 要求可选） ---------- */
/* 真实尺寸实测（同一 pid，img.naturalWidth）：
 *   large/original/mw2000 → 744×913（原图）
 *   bmiddle               → 440×540
 *   orj360                → 360×442
 *   thumbnail             → 98×120
 */
eq('A21 三档顺序', A.SIZE_ORDER, ['big', 'mid', 'small']);
{
    const b = A.candidates(PI, 'large', 'big');
    ok('A22 大档首选 large', b[0].indexOf('/large/') > 0);
    ok('A23 大档含 original 备份', b.some((u) => u.indexOf('/original/') > 0));
    ok('A24 大档含 mw2000 备份', b.some((u) => u.indexOf('/mw2000/') > 0));
}
{
    const m = A.candidates(PI, 'bmiddle', 'mid');
    ok('A25 中档首选 bmiddle', m[0].indexOf('/bmiddle/') > 0);
    ok('A26 中档不越级到原图', !m.some((u) => /\/large\/|\/original\//.test(u)));
}
{
    const s = A.candidates(PI, 'orj360', 'small');
    ok('A27 小档首选 orj360', s[0].indexOf('/orj360/') > 0);
    /* 关键：选「小」若失败回退到原图，体积反而更大，等于把选择权骗走 */
    ok('A28 小档绝不回退到原图', !s.some((u) => /\/large\/|\/original\/|\/mw2000\//.test(u)));
}
{
    const s = A.candidates(PI, 'nonexistent', 'small');
    ok('A29 非法首选仍留在本尺寸档', s[0].indexOf('/orj360/') > 0);
}
{
    const x = A.candidates(PI, 'large', 'nope');
    ok('A30 未知尺寸档退回大档行为', x[0].indexOf('/large/') > 0);
    eq('A31 未知尺寸档仍是两级链', x.length, 2);
}
{
    eq('A32 tiersOfSize(big) 覆盖原图三前缀', A.tiersOfSize('big'), ['large', 'original', 'mw2000']);
    eq('A33 tiersOfSize(mid)', A.tiersOfSize('mid'), ['bmiddle', 'mw690']);
    eq('A34 tiersOfSize(small)', A.tiersOfSize('small'), ['orj360', 'thumbnail']);
    eq('A35 tiersOfSize 未知退回大档', A.tiersOfSize('nope'), ['large', 'original', 'mw2000']);
}
{
    const items = A.buildItems([{ pid: 'p1' }], { author: 'a' }, 'orj360', 'small');
    ok('A36 buildItems 带 size 时用该档前缀', items[0].url.indexOf('/orj360/') > 0);
    eq('A37 buildItems 记录所选尺寸档', items[0].size, 'small');
    ok('A38 该尺寸下候选链不越级', !items[0].urls.some((u) => /\/large\//.test(u)));
}
{
    const items = A.buildItems([{ pid: 'p1' }], { author: 'a' }, 'large');
    eq('A39 不传 size 时默认大档', items[0].size, 'big');
    ok('A40 不传 size 时用 large', items[0].url.indexOf('/large/') > 0);
}

/* ---------- B. 条目收集（不再按月分桶） ---------- */
{
    const out = [];
    const seen = new Set();
    const r = A.collectPage([
        { pid: 'p1', mid: '100', type: 'pic' },
        { pid: 'p2', mid: '100', type: 'pic' },
        { pid: 'p3', mid: '101', type: 'pic' }
    ], out, seen);
    eq('B1 三条全收', r.added, 3);
    eq('B2 收集顺序即接口顺序', out.map((x) => x.pid), ['p1', 'p2', 'p3']);
    eq('B3 mid 一并保留', out[0].mid, '100');
    eq('B4 无跳过', r.skipped, 0);
}
{
    /* 实测首条就是 object_id:null + 无 pid */
    const out = [];
    const r = A.collectPage([
        { mid: '5362225311122454', type: 'pic', object_id: null },
        { pid: 'p2', mid: '5361585174611858', type: 'pic' }
    ], out, new Set());
    eq('B5 无 pid 被跳过', out.length, 1);
    eq('B6 跳过计数', r.skipped, 1);
    ok('B7 收下的是有 pid 的那条', out[0].pid === 'p2');
}
{
    const out = [];
    const r = A.collectPage([{ pid: 'v1', type: 'video', mid: '1' }], out, new Set());
    eq('B8 非 pic 类型被跳过', out.length, 0);
    eq('B9 类型跳过计数', r.skipped, 1);
}
{
    /* 翻页边界可能重复：跨页去重 */
    const out = [];
    const seen = new Set();
    A.collectPage([{ pid: 'x', mid: '1', type: 'pic' }], out, seen);
    const r2 = A.collectPage([{ pid: 'x', mid: '1', type: 'pic' }], out, seen);
    eq('B10 跨页重复不再收', out.length, 1);
    eq('B11 重复计入 skipped', r2.skipped, 1);
}
{
    /* 月份缺失不影响收集 —— 这正是改动的目的 */
    const out = [];
    A.collectPage([
        { pid: 'a', timeline_year: '', timeline_month: '', type: 'pic', mid: '1' },
        { pid: 'b', timeline_year: '2026', timeline_month: '11', type: 'pic', mid: '2' }
    ], out, new Set());
    eq('B12 无月份条目也收', out.length, 2);
}

/* ---------- C. 分页终止 ---------- */
const noSleep = () => Promise.resolve();
function mkFetch(pages) {
    let i = 0;
    return async function () {
        const p = pages[Math.min(i, pages.length - 1)];
        i++;
        return p;
    };
}
const OPT = { uid: 'u1', sleep: noSleep, gapMs: 0, maxPages: 50 };

(async () => {
    {
        const r = await A.paginate(Object.assign({}, OPT, {
            fetchPage: mkFetch([{ list: [], since_id: null }])
        }));
        eq('C1 空页 → done', r.state, 'done');
        eq('C2 终止原因 empty', r.reason, 'empty');
        eq('C3 只读 1 页', r.pages, 1);
    }
    {
        let calls = 0;
        const r = await A.paginate(Object.assign({}, OPT, {
            fetchPage: async function () {
                calls++;
                return { list: [{ pid: 'p' + calls, type: 'pic', mid: '1' }], since_id: 'SAME' };
            }
        }));
        eq('C4 游标不推进 → done', r.state, 'done');
        eq('C5 原因 cursor-stalled', r.reason, 'cursor-stalled');
        ok('C6 未死循环', r.pages <= 2, 'pages=' + r.pages);
    }
    {
        const r = await A.paginate(Object.assign({}, OPT, {
            fetchPage: mkFetch([
                { list: [{ pid: 'a', type: 'pic', mid: '1' }], since_id: 'c1' },
                { list: [{ pid: 'b', type: 'pic', mid: '2' }], since_id: 'c2' },
                { list: [{ pid: 'c', type: 'pic', mid: '3' }], since_id: 'c3' },
                { list: [], since_id: null }
            ])
        }));
        eq('C7 空页收尾', r.state, 'done');
        eq('C8 收集到 3 条', r.items.length, 3);
        eq('C9 顺序保持', r.items.map((x) => x.pid), ['a', 'b', 'c']);
    }
    {
        /* limit 达到即停：这是取代月份的核心能力 */
        let n = 0;
        const r = await A.paginate(Object.assign({}, OPT, {
            limit: 5,
            fetchPage: async function () {
                n++;
                return {
                    list: Array.from({ length: 3 }, (_, i) => ({ pid: 'p' + n + '_' + i, type: 'pic', mid: '1' })),
                    since_id: 'c' + n
                };
            }
        }));
        eq('C10 达到 limit → limit', r.state, 'limit');
        ok('C11 收集数不少于 limit', r.items.length >= 5, 'items=' + r.items.length);
        ok('C12 不无限翻页', r.pages <= 3, 'pages=' + r.pages);
    }
    {
        let n = 0;
        const r = await A.paginate(Object.assign({}, OPT, {
            maxPages: 3,
            fetchPage: async function () {
                n++;
                return { list: [{ pid: 'p' + n, type: 'pic', mid: '1' }], since_id: 'c' + n };
            }
        }));
        eq('C13 达上限 → maxed', r.state, 'maxed');
        eq('C14 请求次数等于上限', r.pages, 3);
    }
    {
        let stopped = false;
        const r = await A.paginate(Object.assign({}, OPT, {
            isStopped: () => stopped,
            fetchPage: async function () {
                stopped = true;
                return { list: [{ pid: 'p1', type: 'pic', mid: '1' }], since_id: 'c1' };
            }
        }));
        eq('C15 用户停止 → stopped', r.state, 'stopped');
        eq('C16 只读 1 页', r.pages, 1);
    }
    {
        const r = await A.paginate(Object.assign({}, OPT, {
            fetchPage: async function () { throw new Error('HTTP 403'); }
        }));
        eq('C17 异常 → error', r.state, 'error');
        ok('C18 错误透传', r.reason.indexOf('403') >= 0, r.reason);
    }
    {
        const r = await A.paginate(Object.assign({}, OPT, {
            fetchPage: mkFetch([{ list: [{ pid: 'a', type: 'pic', mid: '1' }], since_id: 'c1' }]),
            onPage: () => { throw new Error('boom'); }
        }));
        eq('C19 回调抛错不影响', r.state, 'error' === r.state ? 'error' : 'done');
    }

    /* ---------- D. 可用性判定与探测 ---------- */
    {
        const ph = A.usableImage({
            status: 200, type: 'image/gif',
            finalUrl: 'https://wx1.sinaimg.cn/large/images/default_s_large.gif#103', bytes: 7092
        });
        eq('D1 占位图不可用', ph.ok, false);
        eq('D2 真 jpeg 可用', A.usableImage({
            status: 200, type: 'image/jpeg', finalUrl: 'https://x/large/a.jpg', bytes: 353486
        }).ok, true);
        eq('D3 403 不可用', A.usableImage({ status: 403, type: 'text/html', bytes: 238 }).ok, false);
        eq('D4 HTML 200 不可用', A.usableImage({ status: 200, type: 'text/html', bytes: 500 }).ok, false);
        eq('D5 太小不可用', A.usableImage({ status: 200, type: 'image/jpeg', bytes: 10 }).ok, false);
        eq('D6 gif 不可用', A.usableImage({ status: 200, type: 'image/gif', bytes: 40000 }).ok, false);
        eq('D7 空对象不可用', A.usableImage(null).ok, false);
    }
    {
        const probes = [
            { tier: 'large', status: 403, type: 'text/html' },
            { tier: 'original', status: 200, type: 'image/jpeg', finalUrl: 'https://x', bytes: 30000 }
        ];
        eq('D8 跳过不可用档位', A.pickTier(probes).tier, 'original');
        eq('D9 尝试次数', A.pickTier(probes).tried, 2);
        eq('D10 全失败回退首选', A.pickTier([{ tier: 'large', status: 500 }]).tier, 'large');
    }
    {
        const calls = [];
        const hit = await A.probeTiers(PI, async (url) => {
            calls.push(url);
            if (url.indexOf('/large/') > 0) { return { status: 403, type: 'text/html' }; }
            return { status: 200, type: 'image/jpeg', finalUrl: url, bytes: 50000 };
        });
        eq('D11 探到 original', hit.tier, 'original');
        eq('D12 命中即停（2 次）', calls.length, 2);
        ok('D13 先打 large', calls[0].indexOf('/large/') > 0);
        ok('D14 再打 original', calls[1].indexOf('/original/') > 0);
    }
    {
        const errPick = await A.probeTiers(PI, async (url) => {
            if (url.indexOf('/large/') > 0) { throw new Error('network'); }
            return { status: 200, type: 'image/jpeg', finalUrl: url, bytes: 20000 };
        });
        eq('D15 抛错后继续下一档', errPick.tier, 'original');
    }
    {
        const allPh = await A.probeTiers(PI, async () => ({
            status: 200, type: 'image/gif', finalUrl: 'x/images/default_s_large.gif', bytes: 7092
        }));
        eq('D16 全占位图判失败', allPh.ok, false);
        eq('D17 无 pid 直接失败', (await A.probeTiers('', async () => ({}))).ok, false);
        eq('D18 无 fetchFn 直接失败', (await A.probeTiers(PI, null)).ok, false);
    }

    /* ---------- E. 下载条目构造 ---------- */
    {
        const meta = { author: '地球知识局', authorId: '5750600479', pageUrl: 'https://weibo.com/u/5750600479' };
        const items = A.buildItems([
            { pid: 'AAA', mid: '1' }, { pid: 'BBB', mid: '1' }, { pid: 'CCC', mid: '2' }
        ], meta);
        eq('E1 条目数', items.length, 3);
        const one = items[0];
        eq('E2 site', one.site, 'weibo');
        eq('E3 kind', one.kind, 'image');
        eq('E4 mediaId=pid', one.mediaId, 'AAA');
        eq('E5 ext=jpg', one.ext, 'jpg');
        eq('E6 url 为 large（实测最大档）', one.url, 'https://wx3.sinaimg.cn/large/AAA.jpg');
        eq('E7 urls 两级', one.urls.length, 2);
        eq('E8 thumb', one.thumb, 'https://wx3.sinaimg.cn/orj360/AAA.jpg');
        eq('E9 作者透传', one.author, '地球知识局');
        eq('E10 authorId 透传', one.authorId, '5750600479');
        eq('E11 key', one.key, 'weibo:image:AAA');
        ok('E12 不再带 month 字段', !('month' in one));
        ok('E13 全部字段完整', items.every((x) =>
            x.site && x.kind && x.url && Array.isArray(x.urls) && x.urls.length && x.mediaId));
    }
    {
        const meta = { author: '', authorId: 'u', pageUrl: '' };
        const byOrig = A.buildItems([{ pid: 'P1', mid: '1' }], meta, 'original');
        ok('E14 指定 original 时首选 original', byOrig[0].url.indexOf('/original/') > 0);
        const dup = A.buildItems([{ pid: 'X' }, { pid: 'X' }], meta);
        eq('E15 重复 pid 只收一次', dup.length, 1);
        eq('E16 空输入', A.buildItems([], meta).length, 0);
    }

    /* ---------- F. 按 pid 去重 ---------- */
    {
        const items = [
            { mediaId: 'A1', url: 'https://wx3.sinaimg.cn/large/A1.jpg' },
            { mediaId: 'A2', url: 'https://wx3.sinaimg.cn/large/A2.jpg' }
        ];
        const r = A.filterDone(items, new Set(['A2']));
        eq('F1 已下载被过滤', r.fresh.length, 1);
        eq('F2 跳过计数', r.skipped, 1);
        eq('F3 换档位仍判重复', A.filterDone(
            [{ mediaId: 'A2', url: 'https://wx3.sinaimg.cn/original/A2.jpg' }], new Set(['A2'])
        ).fresh.length, 0);
        eq('F4 数组入参等价', A.filterDone(items, ['A1', 'A2']).fresh.length, 0);
        eq('F5 无 mediaId 时用 url 的 pid', A.filterDone(
            [{ url: 'https://wx3.sinaimg.cn/large/' + PI + '.jpg' }], new Set([PI])
        ).fresh.length, 0);

        const merged = A.mergeDone(new Set(['OLD']), items, 20000);
        ok('F6 合并不丢旧值', merged.has('OLD'));
        ok('F7 合并且加入新值', merged.has('A1') && merged.has('A2'));
        eq('F8 超上限滚动淘汰', Array.from(
            A.mergeDone(new Set(), [{ mediaId: 'X1' }, { mediaId: 'X2' }, { mediaId: 'X3' }], 2)
        ).sort(), ['X2', 'X3']);
    }

    /* ---------- G. 结果归类 ---------- */
    {
        const okAll = A.classifyBulkResult({ ok: true, total: 3, done: 3, skipped: 0, failed: 0 }, 3, 0);
        eq('G1 全成功', okAll.state, 'ok');
        eq('G2 全成功记已完成', okAll.markDone, true);

        const dup = A.classifyBulkResult({ ok: true, total: 2, done: 0, skipped: 2, failed: 0 }, 2, 0);
        eq('G3 全重复跳过也算成功', dup.state, 'ok');

        const part = A.classifyBulkResult({ ok: true, total: 5, done: 3, failed: 2 }, 5, 0);
        eq('G4 部分失败', part.state, 'partial');
        eq('G5 部分失败不记已完成', part.markDone, false);

        const blocked = A.classifyBulkResult({ ok: true, total: 3, done: 0, failed: 3 }, 3, 0);
        eq('G6 全失败', blocked.state, 'blocked');
        ok('G7 全失败提示站点限制', blocked.msg.indexOf('站点限制') >= 0);

        const paused = A.classifyBulkResult(
            { ok: true, total: 10, done: 2, failed: 1, paused: true, reason: '疑似风控' }, 10, 0);
        eq('G8 风控暂停', paused.state, 'paused');
        eq('G9 暂停不记已完成', paused.markDone, false);

        eq('G10 无应答 error', A.classifyBulkResult(null, 4, 0).state, 'error');
        eq('G11 ok:false error', A.classifyBulkResult({ ok: false, reason: 'no-tab' }, 1, 0).state, 'error');

        const hard = A.classifyBulkResult({ ok: true, total: 4, done: 3, failed: 0, hardFail: 1 }, 4, 0);
        eq('G12 内容错误不记已完成', hard.markDone, false);
        ok('G13 内容错误单独提示', hard.msg.indexOf('内容错误') >= 0);
    }

    /* ---------- H. 代际守卫 ---------- */
    {
        const g = A.makeScanGuard();
        ok('H1 初始 0', g.gen() === 0);
        const t = g.bump();
        eq('H2 bump 递增', t, 1);
        ok('H3 旧 token 失效', g.is(0) === false);
        ok('H4 新 token 有效', g.is(t));
        g.bump();
        ok('H5 再次 bump 让上次失效', g.is(t) === false);

        const guard = A.makeScanGuard();
        const token = guard.bump();
        let pages = 0;
        const r = await A.paginate(Object.assign({}, OPT, {
            isStopped: () => !guard.is(token),
            fetchPage: async () => {
                pages++;
                guard.bump();
                return { list: [{ pid: 'p' + pages, type: 'pic', mid: '1' }], since_id: 'c' + pages };
            }
        }));
        eq('H6 切用户后扫描停止', r.state, 'stopped');
        eq('H7 只读一页', r.pages, 1);
    }

    console.log('');
    console.log(pass + ' passed, ' + fail + ' failed');
    if (fail) {
        console.log('失败用例：' + fails.join(', '));
        process.exit(1);
    }
})();