/* ==========================================================
 * VRImgFilter —— 图片过滤规则（域名 + 正则）纯逻辑，可 Node 单测
 *
 * 对应 AIX 的「图片过滤」：
 *   域名一个框 + 正则一个框，域名留空或写 * 表示全网。
 *   命中即**不显示**（黑名单语义），持久化在 vrLibSettings.imgFilterRules。
 *
 * 为什么不做成「白名单」：用户的实际诉求几乎都是「某站的广告图/表情永远别出现在清单里」，
 * 黑名单一条就够了；白名单还要维护「允许什么」，反而更容易漏。
 *
 * 约定：不碰 chrome.*、不读 DOM；浏览器挂 self.VRImgFilter，Node 走 module.exports。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRImgFilter = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    var MAX_RULES = 200;

    /* ---------------- 域名匹配 ---------------- */

    function hostOf(url) {
        try { return String(new URL(String(url || '')).hostname || '').toLowerCase(); }
        catch (e) { return ''; }
    }

    /**
     * 域名匹配：支持
     *   `*` 或空   → 全网
     *   `example.com` → 该域及其所有子域（www.example.com 也命中）
     *   `*.example.com` → 仅子域（含同级任意子域）
     * 不允许写协议/路径：这类输入常常是从地址栏整段粘进来的，
     * 直接整体当子串匹配会什么都匹配不上 —— 这里先剥成 host。
     */
    function hostMatches(ruleHost, url) {
        var r = String(ruleHost || '').trim().toLowerCase();
        if (!r || r === '*') { return true; }
        // 宽容：用户粘了整条 URL 就取它的 host
        if (r.indexOf('://') >= 0 || r.indexOf('/') >= 0) { r = hostOf(r) || r; }
        r = r.replace(/^\*\./, '');
        if (!r) { return true; }
        var h = hostOf(url);
        if (!h) { return false; }
        return h === r || h.slice(-(r.length + 1)) === '.' + r;
    }

    /* ---------------- 正则匹配 ---------------- */

    /**
     * 编译规则里的正则。写错不抛给用户，返回 null（该条规则不生效）。
     * 支持 `/re/flags` 写法，也支持裸表达式。
     */
    function compilePattern(pat) {
        var s = String(pat == null ? '' : pat);
        if (!s) { return null; }
        var flags = '';
        var body = s;
        var m = /^\/(.+)\/([gimsuy]*)$/.exec(s);
        if (m) { body = m[1]; flags = m[2]; }
        try { return new RegExp(body, flags.replace(/g/g, '')); }
        catch (e) { return null; }
    }

    /** 空正则 = 该域下所有图都过滤（对齐 AIX 的 `.*?` 语义） */
    function patternMatches(pattern, url) {
        var s = String(pattern == null ? '' : pattern);
        if (!s || s === '.*' || s === '.*?') { return true; }
        var re = compilePattern(s);
        if (!re) { return false; }          // 写错的正则不该把图全吞掉
        return re.test(String(url || ''));
    }

    /* ---------------- 规则判定 ---------------- */

    /**
     * 单条规则是否命中。
     * @param {{host:string, re:string, enabled:boolean}} rule
     * @param {string} url
     */
    function ruleHits(rule, url) {
        if (!rule) { return false; }
        if (rule.enabled === false) { return false; }
        if (!hostMatches(rule.host, url)) { return false; }
        return patternMatches(rule.re, url);
    }

    /**
     * 该 URL 是否应被过滤掉（任一启用的规则命中即过滤）。
     * @param {string} url
     * @param {Array} rules
     */
    function isFiltered(url, rules) {
        var list = Array.isArray(rules) ? rules : [];
        for (var i = 0; i < list.length; i++) {
            if (ruleHits(list[i], url)) { return true; }
        }
        return false;
    }

    /** 批量过滤：返回 { kept, removed } */
    function apply(items, rules) {
        var list = Array.isArray(items) ? items : [];
        var rl = Array.isArray(rules) ? rules : [];
        var kept = [];
        var removed = [];
        for (var i = 0; i < list.length; i++) {
            var it = list[i] || {};
            var url = String(it.url || it || '');
            if (isFiltered(url, rl)) { removed.push(it); } else { kept.push(it); }
        }
        return { kept: kept, removed: removed };
    }

    /* ---------------- 规则清洗与导入导出 ---------------- */

    /**
     * 归一一条规则：补默认值、去空白、截断超长字段。
     * @returns {{host:string, re:string, enabled:boolean}|null}
     */
    function normalizeRule(raw) {
        if (!raw || typeof raw !== 'object') { return null; }
        var host = String(raw.host == null ? '' : raw.host).trim().slice(0, 120);
        var re = String(raw.re == null ? '' : raw.re).trim().slice(0, 300);
        // 全空规则没有意义，还会误伤（空域名 + 空正则 = 全网全图过滤）
        if (!host && !re) { return null; }
        return { host: host || '*', re: re, enabled: raw.enabled !== false };
    }

    function normalizeRules(raw) {
        var list = Array.isArray(raw) ? raw : [];
        var out = [];
        for (var i = 0; i < list.length && out.length < MAX_RULES; i++) {
            var r = normalizeRule(list[i]);
            if (r) { out.push(r); }
        }
        return out;
    }

    /** 导出为可读 JSON（带版本号，方便以后迁移） */
    function exportRules(rules) {
        return JSON.stringify({
            v: 1,
            exportedAt: null,          // 保持纯函数：时间由调用方补
            rules: normalizeRules(rules)
        }, null, 2);
    }

    /**
     * 导入：接受 {v,rules:[...]} 或裸数组；坏的条目跳过而不是整体失败。
     * @returns {{rules:Array, skipped:number}}
     */
    function importRules(text) {
        var data = null;
        try { data = JSON.parse(String(text || '')); }
        catch (e) { return { rules: [], skipped: 0, error: 'JSON 解析失败' }; }
        var raw = Array.isArray(data) ? data : (data && Array.isArray(data.rules) ? data.rules : []);
        var before = raw.length;
        var rules = normalizeRules(raw);
        return { rules: rules, skipped: before - rules.length };
    }

    /** 规则的展示文案（列表里一行说清它拦什么） */
    function describe(rule) {
        var r = normalizeRule(rule);
        if (!r) { return ''; }
        var host = r.host === '*' ? '全网' : r.host;
        var re = r.re ? r.re : '所有图片';
        return host + ' · ' + re;
    }

    return {
        MAX_RULES: MAX_RULES,
        hostOf: hostOf,
        hostMatches: hostMatches,
        compilePattern: compilePattern,
        patternMatches: patternMatches,
        ruleHits: ruleHits,
        isFiltered: isFiltered,
        apply: apply,
        normalizeRule: normalizeRule,
        normalizeRules: normalizeRules,
        exportRules: exportRules,
        importRules: importRules,
        describe: describe
    };
});