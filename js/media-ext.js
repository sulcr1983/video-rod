/* ==========================================================
 * VRMediaExt —— 媒体候选的「可接受后缀」与「播放列表/分片」判定
 *
 * 2026-11-13。起因：苏哥报 xx.knit.bid 上的视频下不了，而星愿能下。
 * 实测（详见 docs/HLS-SITE-DIAGNOSIS.md）后发现根因不在嗅探：
 * 该 tab 的缓存里有 14 条（2 个 m3u8 + 12 个 ts），但候选过滤把
 * **两个 m3u8 全丢了**，只剩 12 个 ts 分片，菜单显示成 8 个都叫「MP4」
 * 的选项，点哪个都只下到一个 12MB 的碎片。
 *
 * 丢的原因就一行：js/background.js 的
 *   const VR_VIDEO_EXT = /^(mp4|webm|mkv|mov|flv|ts|avi|m4v|m4s)$/i
 * 里面没有 m3u8 / mpd。
 *
 * 对照星愿浏览器（C:\Program Files\Twinkstar Browser\resources2.pak，
 * 函数 VideoInfoFromData / is_m3u8_content）：
 *
 *   function is_m3u8_content(ct, url) {
 *     return ct.includes("application/x-mpegURL")
 *         || ct.includes("application/vnd.apple.mpegurl")
 *         || url_has_ext(url, ".m3u8");     // ← 连 MIME 都不看，只看后缀
 *   }
 *   function is_mp4_content(ct, url) {
 *     return ct.includes("application/octet-stream")
 *         && url_has_ext(url, ".mp4");
 *   }
 *
 * 两条值得抄的设计：
 *   ① 播放列表以**后缀**为准，不被 MIME 卡住
 *   ② 分片（ts/m4s）是 playlist 的内部数据，不进候选列表
 *
 * 本模块是纯逻辑（UMD、零依赖、不碰 chrome.*），供 background.js 与单测共用。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRMediaExt = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    /* 可直接作为「视频候选」的后缀。
     * 2026-11-13：补 m3u8 / mpd（原来缺这两个，HLS/DASH 播放列表被判成非视频）。 */
    var CANDIDATE_EXT = /^(mp4|webm|mkv|mov|flv|ts|avi|m4v|m4s|m3u8|mpd)$/i;

    /* 播放列表（清单）后缀：本身不是视频数据，要走合并管线才成形。 */
    var PLAYLIST_EXT = /^(m3u8|mpd)$/i;

    /* 分片后缀：同一条视频的碎片。 **没有**播放列表时才单独当候选。 */
    var SEGMENT_EXT = /^(ts|m4s)$/i;

    /** 取 URL 路径部分的小写后缀（不含点）；取不到返回 '' */
    function extOf(url) {
        var s = String(url || '');
        if (!s) { return ''; }
        var clean = s.split('#')[0].split('?')[0];
        var seg = clean.split('/').pop() || '';
        var dot = seg.lastIndexOf('.');
        if (dot < 0 || dot === seg.length - 1) { return ''; }
        return seg.slice(dot + 1).toLowerCase();
    }

    /** 是否可作为候选（后缀在白名单内） */
    function isCandidateExt(ext) {
        return CANDIDATE_EXT.test(String(ext || ''));
    }

    /** 是否播放列表（m3u8 / mpd） */
    function isPlaylist(urlOrExt) {
        var v = String(urlOrExt || '');
        if (!v) { return false; }
        /* 允许直接传 ext，也允许传完整 URL */
        if (v.indexOf('/') < 0 && v.indexOf(':') < 0) {
            return PLAYLIST_EXT.test(v);
        }
        return PLAYLIST_EXT.test(extOf(v));
    }

    /** 是否分片（ts / m4s） */
    function isSegment(urlOrExt) {
        var v = String(urlOrExt || '');
        if (!v) { return false; }
        if (v.indexOf('/') < 0 && v.indexOf(':') < 0) {
            return SEGMENT_EXT.test(v);
        }
        return SEGMENT_EXT.test(extOf(v));
    }

    /**
     * 折叠规则：列表里只要有播放列表，就把裸分片丢掉。
     *
     * 为什么必须丢：分片是同一个视频的碎片，全列出来会让用户以为
     * 那是十几个不同的视频（实测就是这么误导的）；而且 12 个分片会
     * 占满候选上限（slice(0, 8)），把播放列表挤出去。
     *
     * @param {Array} list 每项至少含 {url} 或 {ext}
     * @returns {Array} 处理后的列表（不修改入参）
     */
    function foldSegments(list) {
        var arr = Array.isArray(list) ? list : [];
        var hasPlaylist = false;
        var i;
        for (i = 0; i < arr.length; i++) {
            var it = arr[i] || {};
            var u = it.url || '';
            if (isPlaylist(it.ext || u) || isPlaylist(u)) { hasPlaylist = true; break; }
        }
        if (!hasPlaylist) { return arr.slice(); }
        var out = [];
        for (i = 0; i < arr.length; i++) {
            var m = arr[i] || {};
            var url = m.url || '';
            if (isSegment(m.ext || url) || isSegment(url)) { continue; }
            out.push(m);
        }
        return out;
    }

    return {
        CANDIDATE_EXT: CANDIDATE_EXT,
        PLAYLIST_EXT: PLAYLIST_EXT,
        SEGMENT_EXT: SEGMENT_EXT,
        extOf: extOf,
        isCandidateExt: isCandidateExt,
        isPlaylist: isPlaylist,
        isSegment: isSegment,
        foldSegments: foldSegments
    };
});
