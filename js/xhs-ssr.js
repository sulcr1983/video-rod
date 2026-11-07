/* ==========================================================
 * VRXhsSsr —— 小红书详情页 SSR state 提取（纯逻辑，可 Node 单测）
 *
 * 来源：拆解「小红书下载助手 - 图片视频下载」v1.0.2
 *      （扩展 ID edeaccoppfnefdnpdgmmamcgibbgkdpl，background.js:467-483）
 *
 * 解决的问题：
 *   逐篇下载时原来要 `chrome.tabs.create` + 等 18 秒，
 *   批量 20 篇就是 6 分钟起，还占用户窗口、更容易触发风控。
 *   直接 fetch 详情页 HTML 就能拿到同样的 `__INITIAL_STATE__`。
 *
 * 技术难点（对方踩过的坑，照搬）：
 *   SSR 注入的 state 是**经过 hydration 的 JS 字面量**，不是纯 JSON：
 *   里面会出现 `undefined`、`new Map([])`、`new Set([])`。
 *   直接 JSON.parse 会抛 SyntaxError，必须先做文本规范化。
 *
 * 约定：不碰 chrome.*、不发请求、零依赖。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRXhsSsr = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    /** 从详情页 HTML 里截出 `window.__INITIAL_STATE__ = {...}` 的赋值体 */
    function extractStateSource(html) {
        var s = String(html || '');
        if (!s) { return ''; }
        var m = s.match(/window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/);
        return m ? m[1] : '';
    }

    /**
     * 把 JS 字面量规范化为可 JSON.parse 的文本。
     *
     * 只替换**字符串以外的** `undefined` 与 `new Map/Set([])`：
     * 若整体 replace 会误伤字符串内容（例如标题里正好写了 "undefined"）。
     *
     * 实现方式：按字符串分段，只对非字符串片段做替换。
     */
    function normalizeJsLiteral(src) {
        var s = String(src || '');
        if (!s) { return ''; }
        var out = '';
        var i = 0;
        while (i < s.length) {
            var ch = s.charAt(i);
            if (ch === '"' || ch === "'") {
                /* 整段字符串原样保留（含转义） */
                var quote = ch;
                var start = i;
                i++;
                while (i < s.length) {
                    var c = s.charAt(i);
                    if (c === '\\') { i += 2; continue; }
                    if (c === quote) { i++; break; }
                    i++;
                }
                out += s.slice(start, i);
                continue;
            }
            /* 非字符串片段：累积到下一个引号 */
            var next = i;
            while (next < s.length) {
                var c2 = s.charAt(next);
                if (c2 === '"' || c2 === "'") { break; }
                next++;
            }
            var chunk = s.slice(i, next);
            chunk = chunk
                .replace(/\bundefined\b/g, 'null')
                .replace(/new\s+(?:Map|Set)\s*\(\s*\[\s*\]\s*\)/g, '[]');
            out += chunk;
            i = next;
        }
        return out;
    }

    /**
     * HTML → state 对象。
     * @returns {object|null} 解析失败返回 null（调用方应回退到开标签页）
     */
    function parseState(html) {
        var src = extractStateSource(html);
        if (!src) { return null; }
        try {
            return JSON.parse(normalizeJsLiteral(src));
        } catch (e) {
            return null;
        }
    }

    /**
     * 从 state 里取指定笔记对象（含可用性判定）。
     *
     * 判据必须是「有没有实际字段」，不是「引用是否非空」：
     * noteDetailMap 里混着 key 为 'undefined' / '' 的空对象 `{}`，是 truthy。
     */
    function noteOf(state, noteId) {
        var st = state || {};
        var map = st.note && st.note.noteDetailMap;
        if (!map) { return null; }
        var id = String(noteId || '');
        if (!id) { return null; }
        var entry = map[id];
        var note = entry && entry.note;
        if (!note || typeof note !== 'object' || Array.isArray(note)) { return null; }
        if (!Object.keys(note).length) { return null; }
        return note;
    }

    return {
        extractStateSource: extractStateSource,
        normalizeJsLiteral: normalizeJsLiteral,
        parseState: parseState,
        noteOf: noteOf
    };
});