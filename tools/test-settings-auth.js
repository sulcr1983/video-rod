#!/usr/bin/env node
/**
 * settings.js 授权链路单测（A1–A9）
 *
 * 为什么要有这套测试（2026-11-13 苏哥 Win11 报 NotAllowedError）：
 *   「授权写入」曾先 await IndexedDB 读句柄、再 await requestPermission，
 *   最后才弹 showDirectoryPicker；用户手势在往返里过期，选择器就被拒。
 *   这类 bug 靠肉眼看 diff 很容易漏（顺序改一行就复发），所以用假环境
 *   真实加载 settings.js，记录「选择器被调用时是否已经进入过异步 API」。
 *
 * 覆盖：
 *   A1–A3  authDefault：picker 同步调用、之前无任何异步、mode=readwrite
 *   A4     授权成功后写入 VRIndex.setRoot
 *   A5/A6  restoreAuth：用缓存句柄恢复、无句柄时不弹选择器
 *   A7/A8  describePickerError：两种成因给不同出路（中文、含设置页路径）
 *   A9     refreshAuthState：权限为 prompt 时亮出「恢复上次授权」
 *   M1     反证：把 await 插回选择器之前，A1/A2 必须失败（证明测试非恒真）
 *
 * 用法：node tools/test-settings-auth.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/library/settings.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; console.log('FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function flush(ms) { return new Promise(function (r) { setTimeout(r, ms || 15); }); }

/** 造一个最小假环境，加载 settings.js 并返回可操作的句柄 */
function buildEnv(opts) {
    opts = opts || {};
    const src = opts.src || SRC;
    const els = new Map();
    function el(id) {
        if (!els.has(id)) {
            els.set(id, {
                id: id, _ev: {}, style: {}, textContent: '', hidden: false,
                checked: false, disabled: false, value: '',
                classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
                addEventListener(t, f) { (this._ev[t] || (this._ev[t] = [])).push(f); },
                dispatch(t) { (this._ev[t] || []).forEach(function (f) { f({ target: this }); }, this); },
                appendChild() {}, removeChild() {}, focus() {},
                querySelector() { return null; }, querySelectorAll() { return []; },
                getAttribute() { return null; }, setAttribute() {}
            });
        }
        return els.get(id);
    }
    el('vrLibSubdir').value = 'video-rod';

    const doc = {
        readyState: 'complete',
        activeElement: null,
        getElementById: el,
        createElement: function () { return el('__tmp' + Math.random()); },
        addEventListener() {},
        body: { appendChild() {}, removeChild() {} }
    };

    /* sawAsync：任何异步 API 被「进入」就置 true。
     * 选择器被调用时若它为 true，说明前面已经 await 过别的东西 —— 正是要抓的 bug。 */
    const probe = { sawAsync: false, pickerCalls: [], setRootCalls: [], permCalls: 0 };

    let permState = opts.permState || 'prompt';
    function makeHandle(name) {
        return {
            kind: 'directory', name: name,
            queryPermission: function () { probe.sawAsync = true; return Promise.resolve(permState); },
            requestPermission: function () {
                probe.sawAsync = true; probe.permCalls++;
                return Promise.resolve(opts.grant || 'granted');
            },
            getDirectoryHandle: function (n) {
                probe.sawAsync = true;
                return Promise.resolve(makeHandle(n));
            }
        };
    }
    const rootHandle = opts.handle === undefined ? makeHandle('video-rod') : opts.handle;

    const chrome = {
        storage: { local: {
            get: function (k, cb) {
                probe.sawAsync = true;
                if (cb) { cb({ vrLibSettings: { mode: 'system', subdir: 'video-rod' } }); }
            },
            set: function (o, cb) { probe.sawAsync = true; if (cb) { cb(); } }
        } },
        downloads: {
            search: function (q, cb) { probe.sawAsync = true; if (cb) { cb([]); } }
        },
        runtime: {
            lastError: null,
            getURL: function (p) { return 'chrome-extension://fake/' + p; },
            sendMessage: function (m, cb) { probe.sawAsync = true; if (cb) { cb({ ok: false }); } }
        }
    };

    const fakeSelf = {
        showDirectoryPicker: function (o) {
            /* 记录「调用瞬间」的状态，不记录调用之后 */
            probe.pickerCalls.push({ sawAsyncAtCall: probe.sawAsync, mode: o && o.mode });
            return Promise.resolve(opts.pickResult === undefined ? makeHandle('video-rod') : opts.pickResult);
        },
        VRDB: { getHandle: function () { probe.sawAsync = true; return Promise.resolve(rootHandle); } },
        VRHandleStore: {
            get: function () { probe.sawAsync = true; return Promise.resolve(rootHandle); },
            put: function () { probe.sawAsync = true; return Promise.resolve(true); }
        },
        VRIndex: {
            setRoot: function (h, a, s) { probe.sawAsync = true; probe.setRootCalls.push({ name: h && h.name, abs: a, sub: s }); return Promise.resolve(true); }
        },
        VRPath: { typeOf: function () { return 'other'; } }
    };

    const navigator = { userAgent: opts.ua || 'Mozilla/5.0 Chrome/120' };

    /* settings.js 的 IIFE 参数是 (typeof self !== 'undefined' ? self : this) */
    // eslint-disable-next-line no-new-func
    const factory = new Function('self', 'window', 'document', 'chrome', 'navigator',
        src + '\nreturn self.VRSettings;');
    const api = factory(fakeSelf, fakeSelf, doc, chrome, navigator);

    return { api: api, els: els, probe: probe, doc: doc, chrome: chrome };
}

(async function main() {
    /* ---------- A1–A4：authDefault 必须先弹选择器 ---------- */
    {
        const env = buildEnv();
        await flush(30);                       // 等 init 的异步链（refreshAuthState 等）走完
        env.probe.sawAsync = false;            // 页面加载阶段的异步不算数
        env.probe.pickerCalls.length = 0;

        env.els.get('vrLibAuthDefault').dispatch('click');   // 同步派发

        /* 同步检查：不能 await 任何东西后再看，否则就测不出「是否同步」 */
        ok('A1 点击后选择器已同步弹出', env.probe.pickerCalls.length === 1,
            'pickerCalls=' + JSON.stringify(env.probe.pickerCalls));
        ok('A2 弹选择器时尚未进入任何异步 API',
            env.probe.pickerCalls.length === 1 && env.probe.pickerCalls[0].sawAsyncAtCall === false,
            JSON.stringify(env.probe.pickerCalls[0] || null));
        ok('A3 选择器以 readwrite 模式打开',
            !!env.probe.pickerCalls[0] && env.probe.pickerCalls[0].mode === 'readwrite',
            JSON.stringify(env.probe.pickerCalls[0] || null));

        await flush(30);
        ok('A4 授权成功后写入索引根', env.probe.setRootCalls.length === 1,
            JSON.stringify(env.probe.setRootCalls));
    }

    /* ---------- A5/A6：restoreAuth 用缓存句柄，不弹选择器 ---------- */
    {
        const env = buildEnv({ permState: 'prompt' });
        await flush(30);
        env.probe.pickerCalls.length = 0;

        ok('A9 权限为 prompt 时亮出「恢复上次授权」',
            env.els.get('vrLibAuthRestore').hidden === false,
            'hidden=' + env.els.get('vrLibAuthRestore').hidden);

        env.els.get('vrLibAuthRestore').dispatch('click');
        ok('A5 恢复时同步申请权限', env.probe.permCalls === 1,
            'permCalls=' + env.probe.permCalls);
        ok('A5b 恢复过程不弹目录选择器', env.probe.pickerCalls.length === 0,
            'pickerCalls=' + env.probe.pickerCalls.length);

        await flush(30);
        ok('A5c 恢复成功后写回索引根', env.probe.setRootCalls.length >= 1,
            JSON.stringify(env.probe.setRootCalls));
    }
    {
        const env = buildEnv({ handle: null });   // 没有任何已存句柄
        await flush(30);
        env.probe.pickerCalls.length = 0;
        env.els.get('vrLibAuthRestore').dispatch('click');
        ok('A6 无句柄时恢复不弹选择器', env.probe.pickerCalls.length === 0);
        ok('A6b 无句柄时给出提示', /没有可恢复/.test(env.els.get('vrLibAuthMsg').textContent),
            env.els.get('vrLibAuthMsg').textContent);
    }

    /* ---------- A7/A8：报错文案要翻成人话 ---------- */
    {
        /* A7 默认文案：没有任何句柄时才应显示「未授权」。
         * 注意：这里必须传 handle:null —— 默认环境带句柄，会走「已选过目录」分支。 */
        const envUnauth = buildEnv({ handle: null });
        await flush(30);
        const defaultMsg = envUnauth.els.get('vrLibAuthMsg').textContent;
        ok('A7 未授权时提示说明两个按钮的分工',
            /未授权/.test(defaultMsg) && /授权写入/.test(defaultMsg),
            defaultMsg);

        /* A7b/A7c：NotAllowedError 必须翻译成中文可操作指引，且带设置页路径 */
        const boomMsg = 'The request is not allowed by the user agent or the platform in the current context.';
        const env3 = buildEnv({
            src: SRC.replace(
                "picked = await root.showDirectoryPicker({ mode: 'readwrite' });",
                "throw Object.assign(new Error(" + JSON.stringify(boomMsg) + "), { name: 'NotAllowedError' });"
            )
        });
        await flush(30);
        env3.els.get('vrLibAuthDefault').dispatch('click');
        await flush(30);
        const msg = env3.els.get('vrLibAuthMsg').textContent;
        ok('A7b NotAllowedError 提示含设置页路径', /fileEditing/.test(msg), msg);
        ok('A7c NotAllowedError 提示是中文可操作指引', /浏览器|重试/.test(msg), msg);

        const env4 = buildEnv({
            src: SRC.replace(
                "picked = await root.showDirectoryPicker({ mode: 'readwrite' });",
                "throw Object.assign(new Error('Must be handling a user gesture to show a file picker.'), { name: 'SecurityError' });"
            )
        });
        await flush(30);
        env4.els.get('vrLibAuthDefault').dispatch('click');
        await flush(30);
        const msg4 = env4.els.get('vrLibAuthMsg').textContent;
        ok('A8 手势类错误提示让用户重试', /重试|刷新/.test(msg4), msg4);
    }

    /* ---------- M1：反证，确认测试能抓到回归 ---------- */
    {
        /* 把 await 插回选择器之前，模拟旧实现 */
        const mutated = SRC.replace(
            'var picked;\n        try {\n            picked = await root.showDirectoryPicker',
            "var picked;\n        await root.VRDB.getHandle('root');\n        try {\n            picked = await root.showDirectoryPicker"
        );
        ok('M0 变异生效（源码被改写）', mutated !== SRC);
        const env = buildEnv({ src: mutated });
        await flush(30);
        env.probe.sawAsync = false;
        env.probe.pickerCalls.length = 0;
        env.els.get('vrLibAuthDefault').dispatch('click');
        /* 变异后选择器不再同步调用 —— A1 在变异版本上必须失败 */
        ok('M1 反证：旧顺序下「同步弹出」断言会失败', env.probe.pickerCalls.length === 0,
            '若此处为 1，说明本测试无法区分新旧实现');
    }

    console.log('\n==== settings 授权链路 ' + (pass + fail) + ' 项：' + pass + ' 通过，' + fail + ' 失败 ====');
    process.exit(fail ? 1 : 0);
})();