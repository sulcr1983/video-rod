/* eslint-disable */
/**
 * image-panel.js 的 CSS 契约测试（纯文本，不依赖浏览器）
 *
 * 为什么需要：2026-11-08 苏哥在小红书页实测「面板能显示，但 X、关闭、全选
 * 全部点不动」。根因是宿主 host 写了 `pointer-events:none`，而 pointer-events
 * 是**继承属性**，shadow 树里的面板会继承到 none —— 只有显式在开启态写
 * `pointer-events:auto` 才能点。
 *
 * 这类缺陷用逻辑单测测不出来（不是 JS 逻辑），真机验证又慢又怕风控，
 * 所以用文本契约把「某个选择器必须带某条声明」钉住。
 *
 * 跑法：node tools/test-panel-css.js
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'image-panel.js'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
    if (cond) { pass++; return; }
    fail++; fails.push(name);
    console.log('FAIL  ' + name + (extra ? '  ' + extra : ''));
}

/** 取出某个选择器的声明块（最后一个匹配，避免被注释里的同名串骗到） */
function ruleBody(selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc + '\\s*\\{([^}]*)\\}', 'g');
    let m, last = null;
    while ((m = re.exec(SRC)) !== null) { last = m[1]; }
    return last;
}

/* ---------- A. 宿主与面板的 pointer-events 契约 ---------- */
{
    const host = ruleBody('.vr-panel');
    const on = ruleBody('.vr-panel.on');
    ok('A1 .vr-panel 基础规则存在', host !== null);
    ok('A2 .vr-panel.on 开启态规则存在', on !== null);
    ok('A3 开态必须 pointer-events:auto',
        !!on && /pointer-events\s*:\s*auto/.test(on),
        on ? ('实际: ' + on.trim().slice(0, 60)) : '未找到');

    const maskOn = ruleBody('.vr-mask.on');
    ok('A4 .vr-mask.on 存在', maskOn !== null);
    ok('A5 遮罩开态必须 pointer-events:auto',
        !!maskOn && /pointer-events\s*:\s*auto/.test(maskOn),
        maskOn ? ('实际: ' + maskOn.trim()) : '未找到');
}

/* ---------- B. 宿主确实是 pointer-events:none（契约成立的前提） ---------- */
{
    ok('B1 宿主 host 仍是 pointer-events:none',
        /pointer-events:\s*none;/.test(SRC) && /host\.style\.cssText/.test(SRC),
        '若宿主改成 auto，A3/A5 的显式声明就是冗余但无害，可放宽此条');
}

/* ---------- C. 关闭入口齐全（点了没反应＝少入口或入口没绑定） ---------- */
{
    ok('C1 头部有 X 关闭按钮', /xBtn\.addEventListener\('click',\s*closePanel\)/.test(SRC));
    ok('C2 底部有「关闭」按钮绑定', /closeBtn\.addEventListener\('click',\s*closePanel\)/.test(SRC));
    ok('C3 遮罩点击关闭', /mask\.addEventListener\('click',\s*closePanel\)/.test(SRC));
    ok('C4 Esc 关闭', /closePanel\(\);/.test(SRC) && /Escape/.test(SRC));
    ok('C5 closePanel 会摘掉 on 类',
        /panel\.classList\.remove\('on'\)/.test(SRC) &&
        /mask\.classList\.remove\('on'\)/.test(SRC));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
    console.log('失败用例：' + fails.join(', '));
    process.exit(1);
}
