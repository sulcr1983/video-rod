/**
 * 离线库自动维护单测（offline-sync.js）
 *
 * 验证「索引变化 → 防抖 → 重写 data.js」这条链路。
 * 用内存版 FSA 桩，不碰真实磁盘。
 *
 * 跑法：node tools/test-offline-sync.js
 */
'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

globalThis.self = globalThis;
const base = path.join(__dirname, '..', 'js', 'library');
require(path.join(base, 'offline-export.js'));
require(path.join(base, 'offline-sync.js'));

const E = globalThis.VROfflineExport;
const SYNC = globalThis.VROfflineSync;

/* ---------------- 内存版 FSA 桩 ---------------- */

function makeFakeRoot() {
    const files = new Map();   // 'a/b/c.txt' -> string

    function dirOf(p) { return p.split('/').slice(0, -1).join('/'); }
    function nameOf(p) { return p.split('/').pop(); }

    const root = {
        _files: files,
        async getDirectoryHandle(name, opt) {
            /* 目录句柄：只记录前缀，不真建树 */
            return makeDirHandle(name);
        },
        async getFileHandle(name, opt) {
            return makeFileHandle(name);
        }
    };

    function makeDirHandle(prefix) {
        return {
            async getDirectoryHandle(name, opt) {
                return makeDirHandle(prefix + '/' + name);
            },
            async getFileHandle(name, opt) {
                return makeFileHandle(prefix + '/' + name);
            }
        };
    }

    function makeFileHandle(p) {
        const key = String(p).replace(/^\/+/, '');
        return {
            async createWritable() {
                const buf = [];
                return {
                    async write(chunk) { buf.push(String(chunk)); },
                    async close() { files.set(key, buf.join('')); }
                };
            },
            async getFile() {
                if (!files.has(key)) {
                    const err = new Error('not found');
                    err.name = 'NotFoundError';
                    throw err;
                }
                const text = files.get(key);
                return { text: async () => text, size: text.length };
            }
        };
    }

    return root;
}

function setup(opts) {
    const o = opts || {};
    const fakeRoot = o.root || makeFakeRoot();
    const data = o.files || [
        { relPath: 'video-rod/bilibili/UP/视频/a.mp4', fileName: 'a.mp4', type: 'video', size: 100, thumbFile: 'k1' }
    ];
    globalThis.VRSave = { probeEnv: async () => ({ root: fakeRoot }) };
    globalThis.VRDB = {
        getAllFiles: async () => data,
        getSetting: async () => 'video-rod'
    };
    return { fakeRoot, data };
}

/* ---------------- syncNow ---------------- */

test('syncNow：写出 data.js 到 _library/_offline/', async () => {
    const { fakeRoot } = setup();
    const r = await SYNC.syncNow({});
    assert.equal(r.ok, true, r.error);
    assert.ok(fakeRoot._files.has('_library/_offline/data.js'), '应写 data.js');
});

test('syncNow：同时写出 index.html（首次）', async () => {
    const { fakeRoot } = setup();
    await SYNC.syncNow({});
    assert.ok(fakeRoot._files.has('_library/_offline/index.html'), '应写 index.html');
});

test('syncNow：写出库根入口页 离线库.html', async () => {
    const { fakeRoot } = setup();
    await SYNC.syncNow({});
    assert.ok(fakeRoot._files.has('离线库.html'), '库根应有入口页');
});

test('syncNow：入口页指向正确目标', async () => {
    const { fakeRoot } = setup();
    await SYNC.syncNow({});
    const entry = fakeRoot._files.get('离线库.html');
    assert.ok(entry.includes('_library/_offline/index.html'));
    assert.ok(entry.includes('meta http-equiv="refresh"'));
});

test('syncNow：data.js 内容含素材', async () => {
    const { fakeRoot } = setup();
    await SYNC.syncNow({});
    const js = fakeRoot._files.get('_library/_offline/data.js');
    assert.ok(js.includes('window.VR_LIB'));
    assert.ok(js.includes('a.mp4'));
});

test('syncNow：无库根句柄时返回明确错误', async () => {
    globalThis.VRSave = { probeEnv: async () => ({ root: null }) };
    globalThis.VRDB = { getAllFiles: async () => [], getSetting: async () => '' };
    const r = await SYNC.syncNow({});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'no-root-handle');
});

test('syncNow：缺导出模块时报 no-export-module', async () => {
    /* 不覆盖全局（会污染后续测试）：临时摘掉模块，跑完立刻还原 */
    const saved = globalThis.VROfflineExport;
    const g = globalThis;
    try {
        delete g.VROfflineExport;
        const r = await SYNC.syncNow({});
        assert.equal(r.error, 'no-export-module');
    } finally {
        g.VROfflineExport = saved;
    }
});

/* ---------------- 幂等与增量 ---------------- */

test('syncNow：index.html 已存在时不重写（省 IO）', async () => {
    const { fakeRoot } = setup();
    await SYNC.syncNow({});
    const first = fakeRoot._files.get('_library/_offline/index.html');

    /* 手动改一下，模拟「旧版 HTML」 */
    fakeRoot._files.set('_library/_offline/index.html', 'OLD-HTML');
    await SYNC.syncNow({});
    assert.equal(fakeRoot._files.get('_library/_offline/index.html'), 'OLD-HTML',
        '未强制时不该覆盖已有 HTML');
    assert.notEqual(first, 'OLD-HTML');
});

test('syncNow：forceHtml 时强制重写 index.html', async () => {
    const { fakeRoot } = setup();
    await SYNC.syncNow({});
    fakeRoot._files.set('_library/_offline/index.html', 'OLD-HTML');
    await SYNC.syncNow({ forceHtml: true });
    assert.notEqual(fakeRoot._files.get('_library/_offline/index.html'), 'OLD-HTML');
    assert.ok(fakeRoot._files.get('_library/_offline/index.html').includes('<!doctype html>'));
});

test('syncNow：数据变化后 data.js 更新，HTML 不变', async () => {
    const { fakeRoot, data } = setup();
    await SYNC.syncNow({});
    const html1 = fakeRoot._files.get('_library/_offline/index.html');
    const data1 = fakeRoot._files.get('_library/_offline/data.js');

    data.push({ relPath: 'video-rod/x/新素材.mp4', fileName: '新素材.mp4', type: 'video', size: 5 });
    await SYNC.syncNow({});

    assert.equal(fakeRoot._files.get('_library/_offline/index.html'), html1, 'HTML 应不变');
    assert.notEqual(fakeRoot._files.get('_library/_offline/data.js'), data1, 'data.js 应更新');
    assert.ok(fakeRoot._files.get('_library/_offline/data.js').includes('新素材'));
});

/* ---------------- 防抖调度 ---------------- */

test('schedule：不立即写，等窗口结束', async () => {
    const { fakeRoot } = setup();
    const r = SYNC.schedule(50);
    assert.equal(r.scheduled, true);
    assert.equal(fakeRoot._files.has('_library/_offline/data.js'), false, '防抖窗口内不该写');

    await new Promise((res) => setTimeout(res, 120));
    assert.ok(fakeRoot._files.has('_library/_offline/data.js'), '窗口后应写入');
});

test('schedule：同一窗口内多次调用合并成一次', async () => {
    const { fakeRoot } = setup();
    const r1 = SYNC.schedule(60);
    const r2 = SYNC.schedule(60);
    assert.equal(r1.merged, false);
    assert.equal(r2.merged, true, '第二次应标记为合并');
    await new Promise((res) => setTimeout(res, 140));
    assert.ok(fakeRoot._files.has('_library/_offline/data.js'));
});

test('flush：立即刷掉待写任务', async () => {
    const { fakeRoot } = setup();
    SYNC.schedule(10000);   // 很久以后
    const r = await SYNC.flush();
    assert.ok(r && r.ok, 'flush 应立刻执行');
    assert.ok(fakeRoot._files.has('_library/_offline/data.js'));
});

test('flush：没有待写任务时返回 null', async () => {
    setup();
    await SYNC.flush();          // 清掉可能残留
    const r = await SYNC.flush();
    assert.equal(r, null);
});

/* ---------------- status ---------------- */

test('status：反映 pending / lastAt', async () => {
    setup();
    /* 先做一次真实同步，保证 lastAt 被写入 */
    const r0 = await SYNC.syncNow({});
    assert.equal(r0.ok, true, r0.error);

    SYNC.schedule(5000);
    const s1 = SYNC.status();
    assert.equal(s1.pending, true);

    await SYNC.flush();
    const s2 = SYNC.status();
    assert.equal(s2.pending, false);
    assert.ok(s2.lastAt > 0, '成功后 lastAt 应更新');
});
