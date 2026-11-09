/* 去重键归一 + 存量整理（compact）单元测试（Node，无浏览器）
   跑法：node tools/test-dedupe-key.js
   目的：钉住 2026-11-09「点几次就下几份」的两个根因
     1. vrImgDedupeKey 必须对「同一张图的不同签名/镜像/tplv 格式」给出同一个键
     2. VRDedup.compact 必须把同指纹的物理副本删到 1 份、索引保留多条（引用制）
*/
const { readFileSync } = require('fs');
const vm = require('vm');
const crypto = require('crypto');

let pass = 0, fail = 0;
function eq(name, got, want) {
    if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('PASS  ' + name); }
    else { fail++; console.log('FAIL  ' + name + '\n      got=' + JSON.stringify(got) + '\n     want=' + JSON.stringify(want)); }
}

/* ---------------- 1. 从 background.js 抠出归一函数 ---------------- */
const bg = readFileSync('js/background.js', 'utf8');
function cut(startMark, endMark) {
    const i = bg.indexOf(startMark);
    const j = bg.indexOf(endMark, i);
    if (i < 0 || j < 0) { throw new Error('找不到源码片段：' + startMark); }
    return bg.slice(i, j);
}
const canonSrc = cut('function vrCanonMediaUrl(raw)', 'function vrSiteKey(') +
    cut('function vrImgDedupeKey(url, site)', 'function vrImgSeenUrls(');

const ctx1 = { URL };
vm.createContext(ctx1);
vm.runInContext(canonSrc + '\nthis.__canon = vrCanonMediaUrl; this.__key = vrImgDedupeKey;', ctx1);
const canon = ctx1.__canon;
const key = ctx1.__key;

const DY = 'https://p3-pc-sign.douyinpic.com/tos-cn-i-0813c000-ce/oMqdCgDQIFAzQeC7iAEnAGAAE1oyf9ndqlaHwO';
const q1 = '?biz_tag=aweme_images&from=327834062&x-expires=1796821200&x-signature=AdV%2Ba1gQeMfZvRGe4vBpWGMeGVE%3D';
const q2 = '?biz_tag=aweme_images&from=327834062&x-expires=1796900000&x-signature=ZZZ%2Bdifferent%3D';

eq('K1 抖音：webp 与 jpeg 视为同一张',
    key(DY + '~tplv-dy-aweme-images:q75.webp' + q1),
    key(DY + '~tplv-dy-aweme-images:q75.jpeg' + q1));
eq('K2 抖音：镜像节点 p3/p9 视为同一张',
    key(DY + '~tplv-dy-aweme-images:q75.webp' + q1),
    key(DY.replace('p3-pc-sign', 'p9-pc-sign') + '~tplv-dy-aweme-images:q75.webp' + q2));
eq('K3 抖音：签名变化（重新加载）视为同一张',
    key(DY + '~tplv-dy-aweme-images:q75.webp' + q1),
    key(DY + '~tplv-dy-aweme-images:q75.webp' + q2));
eq('K4 抖音：不同素材 ID 不能撞键',
    key(DY + '~tplv-dy-aweme-images:q75.webp' + q1) ===
    key(DY.replace('oMqdCgDQIFAzQeC7iAEnAGAAE1oyf9ndqlaHwO', 'ooEdvuPBAu9DkAxMoa0I63hL6DA3ALpiA3iin') +
        '~tplv-dy-aweme-images:q75.webp' + q1), false);
eq('K5 归一键形如 douyinpic.com/tos-cn-...',
    key(DY + '~tplv-dy-aweme-images:q75.webp' + q1),
    'douyinpic.com/tos-cn-i-0813c000-ce/omqdcgdqifazqec7iaenagaae1oyf9ndqlahwo');

const XHS1 = 'https://sns-webpic-qc.xhscdn.com/202611060359/afb41021/spectrum/1040g34o3205sjv8tk8605';
const XHS2 = 'https://sns-webpic-qc.xhscdn.com/202611061013/014f4926/spectrum/1040g34o3205sjv8tk8605';
eq('K6 小红书：不同时间戳前缀视为同一张', key(XHS1), key(XHS2));

eq('K7 普通站点只去 query', key('https://a.com/x/y.jpg?v=1'), 'a.com/x/y.jpg');
eq('K8 非 http(s) 返回空串', canon('data:image/png;base64,AAAA'), '');
eq('K9 非法 URL 不抛异常', typeof key('not a url'), 'string');

/* ---------------- 2. VRDedup.compact ---------------- */
const dedupSrc = readFileSync('js/library/dedup.js', 'utf8');
const files = new Map();
const deleted = [];
function mk(rel, abs, sha, size) {
    files.set(rel, { relPath: rel, absPath: abs, sha256: sha, size: size, state: 'ok' });
}
mk('video-rod/A/p/x1.jpg', '/root/x1.jpg', 'H1', 100);
mk('video-rod/B/p/x1.jpg', '/root/x1-dupe.jpg', 'H1', 100);
mk('video-rod/A/p/x2.jpg', '/root/x2.jpg', 'H2', 200);

const droot = {
    crypto: { subtle: crypto.webcrypto.subtle },
    fetch: async (url, opts) => {
        if (opts && opts.method === 'DELETE') { deleted.push(url); return { ok: true }; }
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    },
    VRPath: { toFileUrl: p => 'file:///' + String(p).replace(/\\/g, '/') },
    VRDB: {
        getAllFiles: async () => Array.from(files.values()),
        getFile: async rel => files.get(rel) || null,
        patchFile: async (rel, patch) => {
            const cur = files.get(rel);
            if (!cur) { return null; }
            const next = Object.assign({}, cur, patch);
            files.set(rel, next);
            return next;
        },
        putFiles: async () => 0,
        findBy: async () => [],
        countBy: async () => 0
    }
};
const ctx2 = { self: droot, window: droot, crypto: crypto.webcrypto, fetch: droot.fetch, console };
vm.createContext(ctx2);
vm.runInContext(dedupSrc, ctx2);
const D = droot.VRDedup;

(async () => {
    eq('C0 compact 存在', typeof D.compact, 'function');
    // 没有 remove 回调时只报告、绝不动库（防止「删不掉却改了索引」）
    const r0 = await D.compact();
    eq('C0b 无删除能力时不动库', [r0.merged, r0.noRemover > 0], [0, true]);
    // 有 remove 回调才真正合并
    const r = await D.compact({ remove: async rel => { deleted.push(rel); return true; } });
    eq('C1 识别 1 组重复', r.groups, 1);
    eq('C2 合并 1 条', r.merged, 1);
    eq('C3 删掉 1 个物理副本', deleted.length, 1);
    eq('C4 被合并的条目变成引用',
        files.get('video-rod/B/p/x1.jpg').isRef, 1);
    eq('C5 引用指向原件',
        files.get('video-rod/B/p/x1.jpg').refOf, 'video-rod/A/p/x1.jpg');
    eq('C6 索引条数不变（物理 1 份、索引多份）', files.size, 3);
    eq('C7 原件不受影响', files.get('video-rod/A/p/x1.jpg').isRef || 0, 0);
    const r2 = await D.compact({ remove: async rel => { deleted.push(rel); return true; } });
    eq('C8 幂等：再跑一次没有可合并的', r2.merged, 0);

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})();
