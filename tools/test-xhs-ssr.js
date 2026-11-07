#!/usr/bin/env node
/**
 * 小红书 SSR state 提取单测
 *
 * 覆盖 VRXhsSsr：截取赋值体 / JS 字面量规范化 / 解析 / 取笔记
 *
 * 来源：拆解「小红书下载助手」v1.0.2（background.js:467-483）
 * 关键难点：SSR state 是 hydration 过的 JS 字面量，含 undefined / new Map([])，
 *          直接 JSON.parse 必失败；但替换时不能误伤字符串里的同名字样。
 *
 * 用法：node tools/test-xhs-ssr.js
 */
'use strict';

const S = require('../js/xhs-ssr.js');

let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, detail) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; fails.push(name); console.log('FAIL  ' + name + (detail ? '  ' + detail : '')); }
}
function eq(name, got, expect) {
    const a = JSON.stringify(got), b = JSON.stringify(expect);
    ok(name, a === b, 'got=' + a + ' expect=' + b);
}

/* ---------- A. 截取赋值体 ---------- */
{
    const html = '<html><script>window.__INITIAL_STATE__={"a":1}</script></html>';
    eq('A1 截出 JSON', S.extractStateSource(html), '{"a":1}');
}
{
    const html = 'xxx window.__INITIAL_STATE__ = {"a": [1,2]} </script>';
    eq('A2 容忍空格', S.extractStateSource(html).trim(), '{"a": [1,2]}');
}
eq('A3 无 state 返回空', S.extractStateSource('<html></html>'), '');
eq('A4 空输入', S.extractStateSource(''), '');

/* ---------- B. 字面量规范化 ---------- */
eq('B1 undefined → null', S.normalizeJsLiteral('{"a":undefined}'), '{"a":null}');
eq('B2 new Map([]) → []', S.normalizeJsLiteral('{"a":new Map([])}'), '{"a":[]}');
eq('B3 new Set([]) → []', S.normalizeJsLiteral('{"a":new Set([])}'), '{"a":[]}');
eq('B4 带空格的 new Map( [] )', S.normalizeJsLiteral('{"a":new Map( [] )}'), '{"a":[]}');

/* 关键：字符串里的同名样不能被替换 */
eq('B5 字符串内 undefined 保留',
    S.normalizeJsLiteral('{"t":"this is undefined text"}'),
    '{"t":"this is undefined text"}');
eq('B6 字符串内 new Map 保留',
    S.normalizeJsLiteral('{"t":"new Map([]) here"}'),
    '{"t":"new Map([]) here"}');
eq('B7 转义引号不破坏分段',
    S.normalizeJsLiteral('{"t":"a\\"b","x":undefined}'),
    '{"t":"a\\"b","x":null}');

/* ---------- C. 完整解析 ---------- */
{
    const html = '<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"abc":{"note":{"title":"标题","imageList":[{"url":"x"}]}}}}}</script>';
    const st = S.parseState(html);
    ok('C1 解析成功', !!st);
    eq('C2 取到标题', st && st.note.noteDetailMap.abc.note.title, '标题');
}
{
    /* 真实 SSR 常见形态：undefined 混在对象里 */
    const html = '<script>window.__INITIAL_STATE__={"a":undefined,"b":{"c":1}}</script>';
    const st = S.parseState(html);
    ok('C3 含 undefined 也能解析', !!st);
    eq('C4 undefined 变 null', st && st.a, null);
}
{
    /* new Map([]) 在数组里 */
    const html = '<script>window.__INITIAL_STATE__={"list":[new Map([])]}</script>';
    const st = S.parseState(html);
    ok('C5 含 Map 也能解析', !!st);
    eq('C6 Map 变空数组', st && st.list, [[]]);
}

eq('C7 无 state 返回 null', S.parseState('<html></html>'), null);
eq('C8 非法 JSON 返回 null', S.parseState('<script>window.__INITIAL_STATE__={bad json</script>'), null);

/* ---------- D. 取笔记 ---------- */
{
    const state = { note: { noteDetailMap: { id1: { note: { title: 'T', imageList: [] } } } } };
    const n = S.noteOf(state, 'id1');
    ok('D1 取到笔记', !!n);
    eq('D2 标题正确', n && n.title, 'T');
}
{
    /* 关键：空对象是 truthy，必须按「有没有字段」判 */
    const state = { note: { noteDetailMap: { id1: { note: {} } } } };
    eq('D3 空笔记返回 null', S.noteOf(state, 'id1'), null);
}
{
    const state = { note: { noteDetailMap: { id1: { note: { title: 'x' } } } } };
    eq('D4 不存在的 id', S.noteOf(state, 'nope'), null);
    eq('D5 空 id', S.noteOf(state, ''), null);
    eq('D6 无 map', S.noteOf({}, 'id1'), null);
    eq('D7 state 为 null', S.noteOf(null, 'id1'), null);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
    console.log('失败用例：' + fails.join(', '));
    process.exit(1);
}