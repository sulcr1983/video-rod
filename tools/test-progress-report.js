/**
 * 进度上报契约单测（P1–P12）
 *
 * 为什么单独测这个：2026-11-10 苏哥报「B站下载只有 0%，没有进度信息」，
 * 根因是**两个通道对「进度对象」的字段契约不一致** ——
 * 页面侧只写 loaded/total，后台只读 pct，中间没有任何断言。
 * 这类 bug 不会抛错、不会进日志，只会让用户看到 0%，所以必须锁住契约。
 *
 * 覆盖：
 *   P1–P4   vrProgressReporter.note()：null / 0 / 非法值 / 阶段去重
 *   P5–P7   vrProgressReporter.bytes()：真实百分比 / 无总量 / 100 不越界
 *   P8–P10  bili durl 状态对象：pct 与 loaded/total 必须同时可用
 *   P11–P12 done 只生效一次
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

const ROOT = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'js/background.js'), 'utf8');

/* 把 vrProgressReporter 从 background.js 里摘出来单独跑。
 * 它只依赖 chrome.tabs.sendMessage，桩掉即可。 */
function loadReporter() {
    const start = bg.indexOf('function vrProgressReporter(');
    if (start < 0) { throw new Error('vrProgressReporter 没找到'); }
    // 从函数开头数大括号，找到配对的收尾
    let depth = 0, i = bg.indexOf('{', start), end = -1;
    for (; i < bg.length; i++) {
        if (bg[i] === '{') { depth++; }
        else if (bg[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const src = bg.slice(start, end);
    // eslint-disable-next-line no-new-func
    const factory = new Function('chrome', src + '; return vrProgressReporter;');
    return {
        /** 用给定的 chrome 桩造一个 reporter（每个用例一套独立的 sent） */
        makeWith: function (chromeStub, tabId, name) {
            return factory(chromeStub)(tabId, name);
        }
    };
}

const R = loadReporter();

/** 每次取一个全新的 reporter + 独立的 sent 数组（不能共享，否则用例互相污染） */
function fresh() {
    const sent = [];
    const chromeStub = {
        tabs: { sendMessage: function (tabId, msg) { sent.push(msg); } }
    };
    return { p: R.makeWith(chromeStub, 1, 'a.mp4'), sent: sent };
}

console.log('\n【note() —— 没有百分比时不许装作 0%】');
{
    const { p, sent } = fresh();
    p.note('下载中', null);
    ok('P1 pct=null → 发 indeterminate，不发 0%',
        sent.length === 1 && sent[0].indeterminate === true && sent[0].pct === undefined,
        JSON.stringify(sent[0]));

    const { p: p2, sent: s2 } = fresh();
    p2.note('下载中', null);
    p2.note('下载中', null);
    p2.note('下载中', null);
    ok('P2 同阶段不确定只报一次（别每秒刷消息）', s2.length === 1, '实际 ' + s2.length + ' 条');

    const { p: p3, sent: s3 } = fresh();
    p3.note('下载中', null);
    p3.note('合成中', null);
    ok('P3 换阶段要重新报（阶段文字是有效信息）', s3.length === 2, '实际 ' + s3.length + ' 条');

    const { p: p4, sent: s4 } = fresh();
    p4.note('下载中', NaN);
    p4.note('下载中', 'abc');
    ok('P4 NaN / 非数字 → 当作不确定，不产生 NaN%',
        s4.length === 1 && s4[0].indeterminate === true, JSON.stringify(s4));
}

console.log('\n【note() —— 有百分比时正常显示】');
{
    const { p, sent } = fresh();
    p.note('下载画面', 0);
    ok('P5 pct=0 是合法值，必须显示 0%（不是「没进度」）',
        sent.length === 1 && sent[0].pct === 0 && sent[0].phase === '下载画面',
        JSON.stringify(sent[0]));

    p.note('下载画面', 37);
    ok('P6 百分比递增会推送', sent.length === 2 && sent[1].pct === 37);

    p.note('下载画面', 37);
    ok('P7 同一百分比不重复推', sent.length === 2, '实际 ' + sent.length + ' 条');

    p.note('合成中', 150);
    ok('P8 超过 99 被夹到 99（100 只能由 done 报）',
        sent[sent.length - 1].pct === 99, JSON.stringify(sent[sent.length - 1]));
}

console.log('\n【bytes() —— 真实字节进度】');
{
    const { p, sent } = fresh();
    p.bytes(500, 1000);
    ok('P9 50% 正确换算', sent.length === 1 && sent[0].pct === 50);

    const { p: p2, sent: s2 } = fresh();
    p2.bytes(100, 0);
    ok('P10 没有总量 → indeterminate（不报 0%）',
        s2.length === 1 && s2[0].indeterminate === true, JSON.stringify(s2[0]));

    const { p: p3, sent: s3 } = fresh();
    p3.bytes(1000, 1000);
    ok('P11 100% 也夹到 99（100 由 done 负责）', s3[0].pct === 99, JSON.stringify(s3[0]));
}

console.log('\n【done() —— 终态只生效一次】');
{
    const { p, sent } = fresh();
    p.done(true, '', 12345);
    const n1 = sent.length;
    p.note('下载中', 50);
    p.bytes(1, 2);
    p.done(false, 'x');
    ok('P12 done 之后所有上报都被丢弃',
        n1 === 1 && sent.length === 1 && sent[0].done === true,
        'done 后共 ' + sent.length + ' 条');
}

console.log('\n【B站页面侧状态对象契约】');
{
    const bili = fs.readFileSync(path.join(ROOT, 'js/bili-whole.js'), 'utf8');
    const durlStart = bili.indexOf('function durlFunc(');
    const durlEnd = bili.indexOf('function dashFunc(');
    const durl = bili.slice(durlStart, durlEnd);

    ok('P13 durl 初始状态带 pct 字段（不能只有 loaded/total）',
        /pct\s*:/.test(durl), '页面侧不写 pct → 后台读不到 → 永远 0%');
    ok('P14 durl 的 onprogress 里算了百分比',
        /tick\s*\(\s*Math\.round\(\s*ev\.loaded\s*\/\s*ev\.total/.test(durl),
        '只在 onprogress 里存 loaded/total 是不够的');
    ok('P15 有「保存中」阶段（字节下完但落盘还要几秒）',
        /保存中/.test(durl));

    ok('P16 dash 的 tick 会挡掉 NaN',
        /isFinite\(p\)/.test(bili), 'NaN 会一路显示成 NaN%');

    const bgHasIndet = /note:\s*function\s*\(\s*phase\s*,\s*pct\s*\)[\s\S]{0,400}indeterminate:\s*true/.test(bg);
    ok('P17 reporter.note() 的 null 分支确实发 indeterminate', bgHasIndet);

    const overlay = fs.readFileSync(path.join(ROOT, 'js/video-overlay.js'), 'utf8');
    ok('P18 悬浮键能显示阶段文字（不然只有数字没有「在干什么」）',
        /vr-has-phase/.test(overlay));
    ok('P19 点击后先显示「准备中」而不是 0%',
        /setState\('busy',\s*null,\s*true,\s*'准备中'\)/.test(overlay));

    const popup = fs.readFileSync(path.join(ROOT, 'js/popup-videorod.js'), 'utf8');
    /* 只看代码行，不看注释 —— 注释里为了解释这个坑会引用旧写法，会误报 */
    const popupCode = popup.split('\n')
        .filter(function (l) { return !/^\s*(\/\/|\*|\/\*)/.test(l); })
        .join('\n');
    ok('P20 popup 不再用 if (st.pct) 判（0 是合法值且 falsy）',
        !/if\s*\(\s*st\.pct\s*\)/.test(popupCode));
    ok('P21 popup 用 isFinite 判 pct 合法性',
        /st\.pct\s*!=\s*null\s*&&\s*isFinite/.test(popupCode));
}

console.log('\n' + (fail ? '❌' : '✅') + ' 通过 ' + pass + ' / ' + (pass + fail) + '\n');
process.exit(fail ? 1 : 0);
