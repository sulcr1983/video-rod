/* ==========================================================
 * VRPeers —— 「同一个博主」判据（2026-11-18）
 *
 * 为什么单独成模块（苏哥报「只看此人的筛选规则好似不对」）：
 *   旧判据是「有 authorId 就严格比对 id，没有才退回昵称」。实测会被
 *   同一个博主的多种 ID 形态拆散：
 *     · 抖音的 authorId 有「抖音号 / 数字 UID / sec_uid」三条回退路径
 *       （js/naming.js 里唯一/uid/sec_uid 依次兜底），不同批次下载落到不同形态。
 *       库里「张见识」因此成了 @4091707616143916 / @56675926250 / @MS4w... 三个目录，
 *       「只看此人」只看到同目录那一队。
 *     · B 站等站点还存在「有 id / 无 id」并存，没 id 的条目被直接排除。
 *   反过来，纯按昵称匹配会把不同平台的同名博主混成一个人，
 *   也会把「待整理」这种占位名并成一大坨。
 *
 * 判据（按优先级逐级放宽，且始终限定同一平台）：
 *   ① 同平台 + 同 authorId —— 有 id 时最精确，能覆盖改昵称的情况
 *   ② 同平台 + 同昵称     —— id 形态漂移、或一方缺 id 时仍能归队
 *   占位名（待整理/未知/未分类…）不参与昵称合并。
 *
 * 纯函数、无 DOM 依赖，供 lightbox 与单测共用。
 * ========================================================== */
(function (root) {
    'use strict';

    /* 这些不是真正的作者名，按昵称合并会把一堆无主素材并成一个人 */
    var PLACEHOLDER_AUTHORS = {
        '待整理': 1, '未知': 1, '未知来源': 1, '未分类': 1, '其他': 1,
        '网页': 1, '本地素材': 1, 'unknown': 1, 'untracked': 1
    };

    function normName(f) {
        return String((f && f.author) || '').trim().toLowerCase();
    }

    /** 作者去重键：平台 + 昵称；昵称为空或占位名返回空串（不参与合并） */
    function authorKeyOf(f) {
        var name = normName(f);
        if (!name || PLACEHOLDER_AUTHORS[name]) { return ''; }
        return String((f && f.plat) || '') + '|' + name;
    }

    /** 判断 two 是否与 one 属于同一博主（同一平台内） */
    function sameAuthor(one, two) {
        if (!one || !two) { return false; }
        if (one.relPath && two.relPath && one.relPath === two.relPath) { return false; }
        if (String(one.plat || '') !== String(two.plat || '')) { return false; }
        var uid = String(one.authorId || '').trim();
        if (uid && String(two.authorId || '').trim() === uid) { return true; }
        var key = authorKeyOf(one);
        return !!key && authorKeyOf(two) === key;
    }

    /** 从全量条目里筛出与 self 同博主的其他条目（不含 self 本身） */
    function peersOf(all, self) {
        if (!self || !Array.isArray(all)) { return []; }
        var who = String(self.author || '').trim();
        var uid = String(self.authorId || '').trim();
        if (!who && !uid) { return []; }
        return all.filter(function (x) { return sameAuthor(self, x); });
    }

    root.VRPeers = {
        PLACEHOLDER_AUTHORS: PLACEHOLDER_AUTHORS,
        authorKeyOf: authorKeyOf,
        sameAuthor: sameAuthor,
        peersOf: peersOf
    };
    if (typeof module === 'object' && module.exports) { module.exports.VRPeers = root.VRPeers; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
