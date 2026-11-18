/**
 * 枚举执行器单测（runner.js）
 *
 * 验证「博主 URL → items[]」这条链路，全部用假 fetch，不联网。
 * 重点覆盖：翻页、批内去重、上限、断点、错误、取消。
 *
 * 跑法：node tools/test-enum-runner.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

globalThis.self = globalThis;
const base = path.join(__dirname, '..', 'js', 'enumerate');
require(path.join(base, 'pager.js'));
require(path.join(base, 'bili-wbi.js'));
require(path.join(base, 'store.js'));
require(path.join(base, 'runner.js'));
require(path.join(base, 'adapters', 'index.js'));
require(path.join(base, 'adapters', 'bilibili.js'));

const R = globalThis.VREnumRunner;
const S = globalThis.VREnumStore;

/* 造一页 B站响应 */
function biliPage(total, pn, ps, n) {
    const vlist = [];
    for (let i = 0; i < n; i++) {
        vlist.push({
            bvid: 'BV' + pn + String(i).padStart(8, '0'),
            title: 'P' + pn + '-' + i,
            pic: '//i0.hdslb.com/c' + pn + i + '.jpg',
            author: 'UP主', mid: 12345678
        });
    }
    return { code: 0, data: { list: { vlist }, page: { pn, ps, count: total } } };
}

const TARGET = { platform: 'bilibili', ownerId: '12345678', ownerName: 'UP主', pageUrl: 'https://space.bilibili.com/12345678' };

/* ---------------- 正常流程 ---------------- */

test('run：3 页共 60 条 → 全部拿到', async () => {
    let calls = 0;
    const r = await R.run({
        target: TARGET,
        delay: 0,
        fetchJson: async (url) => {
            calls++;
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            return biliPage(60, pn, 20, 20);
        }
    });
    assert.equal(r.ok, true);
    assert.equal(r.pages, 3);
    assert.equal(r.items.length, 60);
    assert.equal(calls, 3);
});

test('run：每页回调被调用，且 next 状态正确', async () => {
    const seen = [];
    await R.run({
        target: TARGET,
        delay: 0,
        fetchJson: async (url) => {
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            return biliPage(40, pn, 20, 20);
        },
        onPage: (info) => seen.push(info)
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[0].next, true, '第 1 页后还有下一页');
    assert.equal(seen[1].next, false, '第 2 页是末页');
});

/* ---------------- 边界与保护 ---------------- */

test('run：limit 生效（不无限抓）', async () => {
    const r = await R.run({
        target: TARGET, delay: 0, limit: 25,
        fetchJson: async (url) => {
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            return biliPage(1000, pn, 20, 20);
        }
    });
    assert.ok(r.items.length <= 25, '不能超过 limit');
});

test('run：maxPages 生效', async () => {
    const r = await R.run({
        target: TARGET, delay: 0, maxPages: 2,
        fetchJson: async (url) => {
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            return biliPage(1000, pn, 20, 20);
        }
    });
    assert.equal(r.pages, 2);
});

test('run：批内去重（同一 mediaId 跨页重复只留一条）', async () => {
    const r = await R.run({
        target: TARGET, delay: 0,
        fetchJson: async (url) => {
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            /* 每页都返回同一个 bvid → 去重后只剩 1 条 */
            return { code: 0, data: { list: { vlist: [
                { bvid: 'BV_SAME', title: 'dup', pic: '//i0.hdslb.com/x.jpg', author: 'A', mid: 1 }
            ] }, page: { pn, ps: 20, count: 60 } } };
        }
    });
    assert.equal(r.items.length, 1, '同 mediaId 只保留一条');
});

test('run：shouldStop 能中断', async () => {
    let n = 0;
    const r = await R.run({
        target: TARGET, delay: 0,
        fetchJson: async (url) => {
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            return biliPage(1000, pn, 20, 20);
        },
        shouldStop: () => (++n > 2)
    });
    assert.equal(r.stopped, true);
    assert.ok(r.pages <= 3);
});

/* ---------------- 错误处理 ---------------- */

test('run：风控错误（-352）被带出且停止翻页', async () => {
    const r = await R.run({
        target: TARGET, delay: 0,
        fetchJson: async () => ({ code: -352, message: '风控校验失败' })
    });
    assert.ok(r.error.includes('-352'));
    assert.equal(r.items.length, 0);
    assert.equal(r.pages, 1, '出错后不该继续翻');
});

test('run：fetch 抛错时给出 fetch-failed', async () => {
    const r = await R.run({
        target: TARGET, delay: 0,
        fetchJson: async () => { throw new Error('network down'); }
    });
    assert.ok(r.error.startsWith('fetch-failed'));
});

test('run：缺 fetchJson 直接报 no-fetch', async () => {
    const r = await R.run({ target: TARGET });
    assert.equal(r.error, 'no-fetch');
});

test('run：缺 target 报 bad-target', async () => {
    const r = await R.run({ target: {}, fetchJson: async () => ({}) });
    assert.equal(r.error, 'bad-target');
});

test('run：不支持的平台报 unsupported-platform', async () => {
    const r = await R.run({
        target: { platform: 'nonexistent', ownerId: 'x' },
        fetchJson: async () => ({})
    });
    assert.ok(r.error.startsWith('unsupported-platform'));
});

/* ---------------- 断点 ---------------- */

test('run：有 store 时写断点，恢复后不重头开始', async () => {
    const backend = S.createMemoryBackend();
    const store = S.create({ backend });
    const key = 'bilibili:12345678';

    await store.start({ platform: 'bilibili', ownerId: '12345678', ownerName: 'UP主' });

    /* 第一次：只抓 1 页就停（模拟 SW 被杀） */
    await R.run({
        target: TARGET, delay: 0, maxPages: 1, store,
        fetchJson: async (url) => {
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            return biliPage(60, pn, 20, 20);
        }
    });

    const saved = await store.get(key);
    assert.ok(saved, '应写入任务记录');
    assert.ok(saved.cursor && saved.cursor.pageNo >= 2, '断点应记录到第 2 页');
    assert.equal(saved.done, 20);

    /* 第二次：从断点续跑 */
    const r2 = await R.run({
        target: TARGET, delay: 0, store,
        fetchJson: async (url) => {
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            return biliPage(60, pn, 20, 20);
        }
    });
    assert.equal(r2.pages, 2, '续跑只剩 2 页（第 2、3 页）');
});

/* ---- 断点恢复的边界（2026-11-18 真机修的两个真 bug） ----
 *
 * 实测证据（抖音某博主，站点公布数百条）：
 *   首次 maxPages=10 → 144 条
 *   之后再点「抓取全部」→ **只有 3 条**，且怎么重试都一样
 *   store 里躺着 {cursor:{maxCursor:…}, status:'done', done:3}
 *
 * 根因两条，都在这组测试里钉住：
 *   ① 上一轮**已跑完**（status=done）时不能再恢复它的队尾断点
 *   ② 撞 maxPages/limit 被截断**不算完整跑完**，不能写 done、不能算 disappeared
 */

test('run：任务已完成（status=done）时下次从头抓，不续队尾', async () => {
    const backend = S.createMemoryBackend();
    const store = S.create({ backend });
    const key = 'bilibili:12345678';
    await store.start({ platform: 'bilibili', ownerId: '12345678' });

    /* 把任务造成「已跑完，断点停在队尾」——这就是真机上那种残留状态 */
    await store.patch(key, {
        cursor: { pageNo: 99 }, done: 60, total: 60, pages: 3, status: 'done'
    });

    const r = await R.run({
        target: TARGET, delay: 0, store,
        fetchJson: async (url) => {
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            return biliPage(60, pn, 20, 20);
        }
    });
    /* 从头抓：3 页都在（若误用队尾断点，只会剩 0~1 页甚至 0 条） */
    assert.equal(r.pages, 3, 'status=done 时必须从头抓（3 页）');
    assert.equal(r.items.length, 60);
});

test('run：被截断（撞 maxPages）不算完整跑完，不写 done', async () => {
    const backend = S.createMemoryBackend();
    const store = S.create({ backend });
    const key = 'bilibili:12345678';
    await store.start({ platform: 'bilibili', ownerId: '12345678' });

    const r = await R.run({
        target: TARGET, delay: 0, maxPages: 1, store,
        fetchJson: async (url) => {
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            return biliPage(60, pn, 20, 20);
        }
    });
    assert.equal(r.truncated, true, '撞页数上限要标记 truncated');

    const saved = await store.get(key);
    assert.notEqual(saved.status, 'done', '截断不能写成 done（否则下次会误续队尾）');
});

test('run：截断时不覆盖 masterIds、不算 disappeared', async () => {
    const backend = S.createMemoryBackend();
    const store = S.create({ backend });
    const key = 'bilibili:12345678';
    await store.start({ platform: 'bilibili', ownerId: '12345678' });

    /* 上一轮完整枚举到 60 条 */
    const allIds = [];
    for (let pn = 1; pn <= 3; pn++) {
        for (let i = 0; i < 20; i++) { allIds.push('BV' + pn + String(i).padStart(8, '0')); }
    }
    await store.patch(key, { masterIds: allIds, disappeared: [], status: 'done', lastRun: 1 });

    /* 这一轮只跑 1 页就被截断 */
    const r = await R.run({
        target: TARGET, delay: 0, maxPages: 1, store,
        fetchJson: async (url) => {
            const pn = Number((url.match(/pn=(\d+)/) || [])[1]) || 1;
            return biliPage(60, pn, 20, 20);
        }
    });
    assert.equal(r.truncated, true);

    const saved = await store.get(key);
    /* 关键：masterIds 必须还是完整的 60 条，不能被这 20 条覆盖 */
    assert.equal(saved.masterIds.length, 60, '截断不得覆盖快照');
    /* 更关键：没翻到的 40 条**不能**被误标成「博主已删」 */
    assert.equal(saved.disappeared.length, 0,
        '截断时不得把没枚举到的作品标成消失（这是备份工具最不能犯的错）');
});

/* ---------------- 格式转换 ---------------- */

test('toBatchItem：adapter 字段 → vrImgBatch 契约', () => {
    const b = R.toBatchItem({
        url: 'https://i0.hdslb.com/a.jpg', kind: 'image', title: 'T',
        pageUrl: 'https://www.bilibili.com/video/BV1', author: 'UP', authorId: '99',
        mediaId: 'BV1'
    });
    assert.equal(b.url, 'https://i0.hdslb.com/a.jpg');
    assert.deepEqual(b.candidates, ['https://i0.hdslb.com/a.jpg']);
    assert.equal(b.title, 'T');
    assert.equal(b.authorFull, 'UP(@99)', '必须产出 authorFull 供命名引擎用');
    assert.equal(b.creatorId, '99');
    assert.equal(b.mediaId, 'BV1');
});

test('toBatchItem：无作者时不伪造 authorFull', () => {
    const b = R.toBatchItem({ url: 'https://a/b.jpg' });
    assert.equal(b.authorFull, '');
    assert.equal(b.creatorId, '');
});

test('toBatchItem：输出 site 短码（否则素材落「其他网页」目录）', () => {
    /* 2026-11-18 修（接线缺口）：原来不输出 site，而下游 vrMediaPath 的
     * site 三元链只认 x/weibo/xhs，其余全归 'other' →
     * B站/抖音/YouTube 的素材会进「其他网页」，索引 platform 反解为空。 */
    assert.equal(R.toBatchItem({ url: 'https://a/b.jpg', platform: 'bilibili' }).site, 'bilibili');
    assert.equal(R.toBatchItem({ url: 'https://a/b.jpg', platform: 'xiaohongshu' }).site, 'xhs');
    assert.equal(R.toBatchItem({ url: 'https://a/b.jpg', platform: 'douyin' }).site, 'douyin');
    /* 显式 site 优先 */
    assert.equal(R.toBatchItem({ url: 'https://a/b.jpg', platform: 'x', site: 'weibo' }).site, 'weibo');
    /* 都没有 → other（不是空串，下游要能判断） */
    assert.equal(R.toBatchItem({ url: 'https://a/b.jpg' }).site, 'other');
});

test('run：产出 item 自动补 platform（adapter 不产出这个键）', async () => {
    /* 2026-11-18 修（接线缺口）：adapter 只给业务字段，没有 platform。
     * runner 若不补，toBatchItem 查不到 SITE_OF → site 落 'other'。 */
    const items = [];
    const r = await R.run({
        target: TARGET, delay: 0, limit: 10,
        fetchJson: async () => biliPage(2, 1, 20, 2),
        onPage: () => {}
    });
    assert.ok(r.items.length > 0);
    r.items.forEach((it) => {
        assert.equal(it.platform, 'bilibili', '每条 item 都应带 platform');
    });
    /* 端到端：经 toBatchItems 后 site 正确 */
    const b = R.toBatchItems(r.items);
    b.forEach((x) => assert.equal(x.site, 'bilibili', 'site 不该是 other'));
});

test('toBatchItems：过滤掉非 http(s) 的条目', () => {
    const out = R.toBatchItems([
        { url: 'https://a/1.jpg' },
        { url: 'blob:https://a/2' },
        { url: '' },
        { url: 'http://a/3.jpg' }
    ]);
    assert.equal(out.length, 2);
});

test('toBatchItems：非数组输入不崩', () => {
    assert.deepEqual(R.toBatchItems(null), []);
    assert.deepEqual(R.toBatchItems(undefined), []);
});
