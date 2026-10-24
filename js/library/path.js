/* ==========================================================
 * VRPath —— 资源库路径拼装（S1a）
 *
 * 职责：把「平台 / 博主 / 类型 / 文件名」拼成 chrome.downloads 可用的
 *       相对路径（相对 Chrome 下载目录），并处理中文目录、非法字符、
 *       路径长度与 file:// URL 编码。
 *
 * 约定：
 *   - 相对路径形如：video-rod/B站/影视飓风(@946974)/视频/20261024_xxx.mp4
 *   - 第一段是「子目录」（默认 video-rod），可通过设置改
 *   - 项目为私有自用，零依赖、ES5 语法，挂 window.VRPath
 * ========================================================== */
(function (root) {
    'use strict';

    /** 平台 → 目录名（与界面显示一致，中文） */
    var PLATFORM_DIR = {
        bilibili: 'B站',
        xiaohongshu: '小红书',
        x: 'X',
        youtube: 'YouTube',
        web: '其他网页'
    };

    /** 媒体类型 → 目录名 */
    var TYPE_DIR = {
        video: '视频',
        image: '图片',
        audio: '音频',
        other: '其他'
    };

    /** 扩展名 → 类型 */
    var EXT_TYPE = {
        mp4: 'video', mkv: 'video', webm: 'video', mov: 'video', m4v: 'video',
        flv: 'video', ts: 'video', avi: 'video', m3u8: 'video', mpd: 'video',
        jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image',
        avif: 'image', bmp: 'image', svg: 'image', heic: 'image',
        mp3: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', wav: 'audio',
        flac: 'audio', opus: 'audio'
    };

    /** Windows 安全边界：相对下载目录这一段的长度上限（绝对路径另有前缀） */
    var MAX_REL_LEN = 170;

    var RESERVED_SEG = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

    /* ---------------- 基础清洗 ---------------- */

    function cleanSeg(seg) {
        var t = String(seg == null ? '' : seg)
            .replace(/[<>:"|?*\u0000-\u001F]/g, '_')   // Windows 非法字符
            .replace(/[\\/]/g, '_')                    // 段内不允许分隔符
            .replace(/\s+/g, ' ')
            .trim();
        t = t.replace(/^[.\s]+|[.\s]+$/g, '');         // 首尾不能是点/空格
        if (!t) { return ''; }
        if (RESERVED_SEG.test(t)) { t = '_' + t; }     // CON / COM1 …
        // emoji 去掉（与 naming.js 默认行为一致）
        t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '');
        return t.trim();
    }

    /** 整条相对路径清洗：逐段清洗，丢空段 */
    function cleanPath(p) {
        return String(p || '').split('/').map(cleanSeg).filter(Boolean).join('/');
    }

    /* ---------------- 平台 / 类型识别 ---------------- */

    function hostOf(url) {
        var s = String(url || '');
        try {
            return new URL(s).hostname.toLowerCase();
        } catch (e) {
            var m = s.match(/^[a-z]+:\/\/([^/?#]+)/i);
            return m ? m[1].toLowerCase() : '';
        }
    }

    /**
     * 从页面 URL 识别平台。
     * 注意：优先传「页面 URL」，不要传媒体直链（CDN 域名会误判成 web）。
     */
    function detectPlatform(url) {
        var host = hostOf(url);
        if (!host) { return 'web'; }
        if (/(^|\.)bilibili\.com$/.test(host) || /(^|\.)b23\.tv$/.test(host)) { return 'bilibili'; }
        if (/(^|\.)xiaohongshu\.com$/.test(host) || /(^|\.)xhslink\.com$/.test(host)) { return 'xiaohongshu'; }
        if (host === 'x.com' || /(^|\.)twitter\.com$/.test(host)) { return 'x'; }
        if (/(^|\.)youtube\.com$/.test(host) || /(^|\.)youtu\.be$/.test(host)) { return 'youtube'; }
        return 'web';
    }

    /** 从扩展名或显式类型推断目录类型 */
    function typeOf(opt) {
        var o = opt || {};
        if (o.type && TYPE_DIR[o.type]) { return o.type; }
        var ext = String(o.ext || '').toLowerCase().replace(/^\./, '');
        if (!ext) {
            var m = String(o.fileName || o.url || '').match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
            ext = m ? m[1].toLowerCase() : '';
        }
        return EXT_TYPE[ext] || 'other';
    }

    /* ---------------- 博主段 ---------------- */

    /** 从页面 URL 提取博主 ID（拿不到就返回空，绝不猜） */
    function creatorIdFromUrl(url) {
        var s = String(url || '');
        var m;
        m = s.match(/xiaohongshu\.com\/user\/profile\/([\w-]+)/i);
        if (m) { return m[1]; }
        m = s.match(/space\.bilibili\.com\/(\d+)/i);
        if (m) { return m[1]; }
        m = s.match(/youtube\.com\/channel\/([\w-]+)/i);
        if (m) { return m[1]; }
        m = s.match(/youtube\.com\/@([\w.-]+)/i);
        if (m) { return '@' + m[1]; }
        m = s.match(/(?:^|\/\/)(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
        if (m && !/^(i|home|explore|search|settings|messages)$/i.test(m[1])) { return '@' + m[1]; }
        return '';
    }

    /** 从 authorFull（"昵称(@id)"）里解出 id */
    function idFromAuthorFull(authorFull) {
        var m = String(authorFull || '').match(/\(@([^)]+)\)\s*$/);
        return m ? m[1] : '';
    }

    /**
     * 博主目录段：优先 "昵称(@ID)"；只有昵称就只用昵称；都没有则「待整理」。
     */
    function creatorSegment(authorFull, creatorId) {
        var full = String(authorFull || '').trim();
        var id = String(creatorId || '').trim().replace(/^@/, '');
        if (full) {
            var m = full.match(/^(.+?)\s*\(@([^)]+)\)\s*$/);
            if (m) {
                return cleanSeg(m[1]) + '(@' + cleanSeg(m[2]) + ')';
            }
            var tail = idFromAuthorFull(full);
            if (tail) { return cleanSeg(full.replace(/\(@[^)]*\)\s*$/, '')) + '(@' + cleanSeg(tail) + ')'; }
            return cleanSeg(full);
        }
        if (id) { return '待整理(@' + cleanSeg(id) + ')'; }
        return '待整理';
    }

    /* ---------------- 主入口 ---------------- */

    /**
     * 拼相对目录（不含文件名）
     * @param {object} opt
     *   pageUrl    页面 URL（优先，用于平台识别）
     *   mediaUrl   媒体 URL（兜底）
     *   site       naming.js 提取的站点名（兜底）
     *   authorFull "昵称(@ID)"
     *   creatorId  博主 ID（可空）
     *   type       video|image|audio|other（可空，用 ext 推断）
     *   ext        扩展名
     *   subdir     第一段子目录，默认 video-rod
     * @returns {string} 例：video-rod/B站/影视飓风(@946974)/视频
     */
    function buildRelDir(opt) {
        var o = opt || {};
        var sub = cleanSeg(o.subdir || 'video-rod') || 'video-rod';
        var pageUrl = o.pageUrl || o.mediaUrl || '';
        var platform = o.platform || detectPlatform(pageUrl);
        var type = typeOf(o);
        var typeSeg = TYPE_DIR[type] || TYPE_DIR.other;

        var creator;
        if (platform === 'web') {
            // 无法识别平台时，用页面域名当「博主」占位；拿不到就「待整理」
            var host = hostOf(pageUrl) || cleanSeg(o.site || '');
            creator = host ? cleanSeg(host) : creatorSegment(o.authorFull, o.creatorId);
        } else {
            creator = creatorSegment(o.authorFull, o.creatorId || creatorIdFromUrl(pageUrl));
        }

        return [sub, PLATFORM_DIR[platform] || PLATFORM_DIR.web, creator, typeSeg].join('/');
    }

    /**
     * 拼完整相对路径（目录 + 文件名），并做长度保护
     */
    function buildRelPath(opt) {
        var o = opt || {};
        var dir = buildRelDir(o);
        var fileName = cleanPath(o.fileName || o.name || '');
        if (!fileName) { fileName = 'file.' + (o.ext || 'mp4'); }
        var full = dir + '/' + fileName;
        return clampLength(full);
    }

    /** 超长时只截文件名段，保住目录结构 */
    function clampLength(relPath, maxLen) {
        var limit = maxLen || MAX_REL_LEN;
        var full = String(relPath || '');
        if (full.length <= limit) { return full; }
        var parts = full.split('/');
        var file = parts.pop() || '';
        var dot = file.lastIndexOf('.');
        var stem = dot > 0 ? file.slice(0, dot) : file;
        var ext = dot > 0 ? file.slice(dot) : '';
        var room = Math.max(24, limit - parts.join('/').length - 1 - ext.length);
        parts.push(stem.slice(0, room) + ext);
        return parts.join('/');
    }

    /**
     * 相对路径 + 下载根目录 → 规范化 file:// URL
     * 每段单独 encodeURIComponent，处理中文、空格、#、%
     */
    function toFileUrl(absPath) {
        var s = String(absPath || '').replace(/\\/g, '/');
        if (!s) { return ''; }
        var isUnc = s.indexOf('//') === 0;
        var segs = s.split('/');
        var out = segs.map(function (seg, i) {
            if (i === 0 && /^[A-Za-z]:$/.test(seg)) { return seg; }  // 盘符不编码
            if (i === 0 && seg === '' && isUnc) { return ''; }
            return encodeURIComponent(seg);
        }).join('/');
        return 'file:///' + out.replace(/^\/+/, '');
    }

    /** 长度自检 */
    function checkLength(relPath, maxLen) {
        var limit = maxLen || MAX_REL_LEN;
        var total = String(relPath || '').length;
        return { ok: total <= limit, total: total, limit: limit, overflow: Math.max(0, total - limit) };
    }

    root.VRPath = {
        PLATFORM_DIR: PLATFORM_DIR,
        TYPE_DIR: TYPE_DIR,
        MAX_REL_LEN: MAX_REL_LEN,
        detectPlatform: detectPlatform,
        typeOf: typeOf,
        creatorIdFromUrl: creatorIdFromUrl,
        creatorSegment: creatorSegment,
        buildRelDir: buildRelDir,
        buildRelPath: buildRelPath,
        clampLength: clampLength,
        cleanSeg: cleanSeg,
        cleanPath: cleanPath,
        toFileUrl: toFileUrl,
        checkLength: checkLength
    };
})(typeof self !== 'undefined' ? self : this);
