/* ==========================================================
 * 枚举层 · 归一化（原始响应 → 统一 item）
 * 纯同步函数，不碰 chrome.* / DOM / fetch。
 *
 * 契约依据：现有两条批量链路实际消费的字段
 *   vrImgBatch   : url / title / pageUrl / authorFull / creatorId / candidates
 *   vrBulkDownload: url / kind / site / author / authorId / title / ext / pageUrl
 *                   / statusId|noteId|awemeId|mediaId
 * 本模块一次产出两者的并集，避免「加了字段只改一条链路」的老毛病。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VREnumNormalize = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    /* 平台 → site 短码（vrBulkMeta 认这三个，其余归 other） */
    var SITE_OF = {
        x: 'x', weibo: 'weibo', xiaohongshu: 'xhs',
        douyin: 'douyin', bilibili: 'bilibili', youtube: 'youtube'
    };

    var VIDEO_EXT = { mp4: 1, m4v: 1, mov: 1, webm: 1, mkv: 1, flv: 1, ts: 1 };
    var AUDIO_EXT = { mp3: 1, m4a: 1, aac: 1, wav: 1, flac: 1, ogg: 1, opus: 1 };
    var IMAGE_EXT = { jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, avif: 1, bmp: 1, heic: 1, heif: 1 };

    function str(v) { return String(v == null ? '' : v).trim(); }

    /** 从 URL 猜扩展名（忽略查询串） */
    function extOfUrl(url) {
        var s = str(url);
        if (!s) { return ''; }
        var m = s.split('#')[0].split('?')[0].match(/\.([A-Za-z0-9]{2,5})$/);
        return m ? m[1].toLowerCase() : '';
    }

    /** 从扩展名推 kind */
    function kindOfExt(ext) {
        var e = str(ext).toLowerCase().replace(/^\./, '');
        if (VIDEO_EXT[e]) { return 'video'; }
        if (AUDIO_EXT[e]) { return 'audio'; }
        if (IMAGE_EXT[e]) { return 'image'; }
        return '';
    }

    /** 「昵称(@id)」——与命名引擎、popup 通道的既有格式一致 */
    function authorFullOf(author, authorId) {
        var a = str(author), i = str(authorId);
        if (!a) { return ''; }
        return i ? a + '(@' + i + ')' : a;
    }

    /** 稳定媒体键：与 vrMediaIdentity 同构（site|作品|媒体|kind|origin+path） */
    function mediaIdentity(it) {
        var i = it || {};
        var clean = str(i.url);
        try {
            var u = new URL(clean);
            clean = u.origin + u.pathname;
        } catch (e) {
            clean = clean.split('?')[0].split('#')[0];
        }
        var work = i.statusId || i.noteId || i.awemeId || i.mediaId || '';
        return [i.site || '', work, i.mediaId || '', i.kind || '', clean].join('|');
    }

    /** 必填校验：给执行器一个明确的「这条能不能下」 */
    function isDownloadable(it) {
        if (!it || !it.url) { return false; }
        return /^https?:/i.test(it.url);
    }

    /**
     * 单条归一。
     * @param {object} raw   平台原始作品对象（由适配器负责解出）
     * @param {object} ctx   {platform, ownerName, ownerId, pageUrl, index}
     * @returns {object} 统一 item（字段是 vrImgBatch 与 vrBulkDownload 的并集）
     */
    function toItem(raw, ctx) {
        var r = raw || {};
        var c = ctx || {};
        var platform = str(c.platform);
        var url = str(r.url || r.mediaUrl || r.src);
        var ext = str(r.ext) || extOfUrl(url);
        var kind = str(r.kind) || kindOfExt(ext) || 'image';
        var author = str(r.author) || str(c.ownerName);
        var authorId = str(r.authorId) || str(c.ownerId);
        var item = {
            /* 两条链路公共 */
            url: url,
            kind: kind,
            title: str(r.title),
            pageUrl: str(r.pageUrl) || str(c.pageUrl),
            /* 作者：两种形态都给，避免再出现「只改一条链路」 */
            author: author,
            authorId: authorId,
            authorFull: authorFullOf(author, authorId),
            /* 平台 */
            site: SITE_OF[platform] || str(c.site) || 'other',
            platform: platform,
            /* 作品身份：按平台填其一 */
            statusId: str(r.statusId),
            noteId: str(r.noteId),
            awemeId: str(r.awemeId),
            mediaId: str(r.mediaId),
            /* 文件 */
            ext: ext,
            /* 候选链（图片链路用；视频链路忽略） */
            candidates: Array.isArray(r.candidates) && r.candidates.length
                ? r.candidates.slice() : (url ? [url] : []),
            /* 序号：命名 _01/_02 用 */
            index: Number.isFinite(c.index) ? c.index : 0
        };
        return item;
    }

    /**
     * 批量归一 + 批内去重（按 mediaIdentity）。
     * 返回顺序保持输入顺序，index 重新编号。
     * @returns {{items:Array, dropped:number}}
     */
    function normalizeBatch(raws, ctx) {
        var list = Array.isArray(raws) ? raws : [];
        var base = ctx || {};
        var seen = Object.create(null);
        var out = [];
        var dropped = 0;
        for (var i = 0; i < list.length; i++) {
            var c = {
                platform: base.platform, ownerName: base.ownerName, ownerId: base.ownerId,
                pageUrl: base.pageUrl, index: out.length
            };
            var it = toItem(list[i], c);
            if (!isDownloadable(it)) { dropped++; continue; }
            var key = mediaIdentity(it);
            if (seen[key]) { dropped++; continue; }
            seen[key] = 1;
            out.push(it);
        }
        return { items: out, dropped: dropped };
    }

    return {
        toItem: toItem,
        normalizeBatch: normalizeBatch,
        mediaIdentity: mediaIdentity,
        isDownloadable: isDownloadable,
        extOfUrl: extOfUrl,
        kindOfExt: kindOfExt,
        authorFullOf: authorFullOf,
        _SITE_OF: SITE_OF
    };
});