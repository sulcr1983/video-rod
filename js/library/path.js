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
        douyin: '抖音',
        weibo: '微博',
        instagram: 'Instagram',
        tiktok: 'TikTok',
        web: '其他网页'
    };

    /** 媒体类型 → 目录名 */
    var TYPE_DIR = {
        video: '视频',
        image: '图片',
        audio: '音频',
        other: '其他'
    };

    /** 收录平台拿不到作者时的目录段。
     *  不用域名：域名会伪装成「作者」，让同一作品从不同通道落进两个文件夹。 */
    var FALLBACK_CREATOR = '待整理';

    /**
     * 兼容早期/特例落盘的英文目录段（IG 走 background.js 硬编码 'instagram/videos'）。
     * 只用于「反解识别」，不改写入规则——老文件认得出、新文件仍走中文字典。
     */
    var PLATFORM_ALIAS = {
        instagram: 'instagram', ig: 'instagram',
        douyin: 'douyin',
        weibo: 'weibo',
        bilibili: 'bilibili', b站: 'bilibili',
        xiaohongshu: 'xiaohongshu', xhs: 'xiaohongshu',
        youtube: 'youtube', yt: 'youtube',
        x: 'x', twitter: 'x',
        tiktok: 'tiktok',
        web: 'web'
    };

    var TYPE_ALIAS = {
        videos: 'video', video: 'video',
        images: 'image', image: 'image', photos: 'image',
        audios: 'audio', audio: 'audio', music: 'audio'
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
     * 从页面 URL 识别平台（**保持旧语义：未收录返回 'web'**）。
     *
     * 为什么不在这里返回域名：
     *   background.js 拿它当查重（vrFindExistingMedia）的 site 预筛条件，
     *   历史记录存的都是 'web'；一旦改成域名，老素材的查重会整体失效。
     *   「未收录站点叫什么」由 detectSite()/siteOf() 负责，与查重解耦。
     */
    function detectPlatform(url) {
        var host = hostOf(url);
        if (!host) { return 'web'; }
        if (/(^|\.)bilibili\.com$/.test(host) || /(^|\.)b23\.tv$/.test(host)) { return 'bilibili'; }
        if (/(^|\.)xiaohongshu\.com$/.test(host) || /(^|\.)xhslink\.com$/.test(host)) { return 'xiaohongshu'; }
        if (host === 'x.com' || /(^|\.)twitter\.com$/.test(host)) { return 'x'; }
        if (/(^|\.)youtube\.com$/.test(host) || /(^|\.)youtu\.be$/.test(host)) { return 'youtube'; }
        if (/(^|\.)douyin\.com$/.test(host) || /(^|\.)iesdouyin\.com$/.test(host)) { return 'douyin'; }
        if (/(^|\.)weibo\.com$/.test(host) || /(^|\.)weibo\.cn$/.test(host)) { return 'weibo'; }
        if (/(^|\.)instagram\.com$/.test(host)) { return 'instagram'; }
        if (/(^|\.)tiktok\.com$/.test(host)) { return 'tiktok'; }
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
            // 作者名里没有 ID、但调用方另外给了 creatorId（B站 UP 主 mid 等）→ 补进目录名，
            // 否则同名作者会挤进同一个文件夹，分不清是谁。
            if (id) { return cleanSeg(full) + '(@' + cleanSeg(id) + ')'; }
            return cleanSeg(full);
        }
        if (id) { return '@' + cleanSeg(id); }
        return '';
    }

    /* ---------------- 主入口 ---------------- */

    /**
     * 站点段解析：**站名优先**，域名只做兜底。
     *
     * 顺序（与 site-registry.js 的优先级一致）：
     *   registry.detect()（含 手改 > 预置 > 自动 ）
     *   → 调用方刚抓到的 siteName
     *   → 已知平台中文名
     *   → 可注册域名
     *
     * 不直接依赖 registry：内容脚本只加载了 site-name.js，
     * 拿不到 registry 时必须能降级工作，否则下载会整条失败。
     */
    function siteOf(o) {
        var pageUrl = o.pageUrl || o.mediaUrl || '';
        var hint = String(o.siteName || o.site || '').trim();

        var R = root.VRSiteRegistry;
        if (R && typeof R.detect === 'function') {
            try {
                var d = R.detect(pageUrl, hint);
                if (d && d.dir) { return { key: d.key || '', dir: d.dir, name: d.name || '' }; }
            } catch (e) { /* 落回下面的降级链 */ }
        }

        var host = hostOf(pageUrl);
        if (hint) { return { key: host || hint, dir: cleanSeg(hint) || hint, name: hint }; }

        var platform = o.platform || detectPlatform(pageUrl);
        if (platform !== 'web') {
            var zh = PLATFORM_DIR[platform] || platform;
            return { key: platform, dir: zh, name: zh };
        }
        /* 未收录站点：一个网站一个目录，用可注册域名 */
        var key = host || '其他网页';
        try {
            var SN = root.VRSiteName;
            if (SN && SN.registrableDomain && host) { key = SN.registrableDomain(host) || host; }
        } catch (e) { /* 用原 host */ }
        return { key: key, dir: cleanSeg(key) || key, name: '' };
    }

    /** 对外：识别站点（页面 URL → {key, host, name, dir}） */
    function detectSite(url, hint) {
        return siteOf({ pageUrl: url, siteName: hint });
    }

    /**
     * 拼相对目录（不含文件名）
     *
     * 目录形态（2026-11-07 按用户要求调整）：
     *   普通内容：  video-rod/<站点>/<作者>/<文件>
     *   多P / 多集： video-rod/<站点>/<作者>/<分P名>/<文件>
     *
     * 为什么**不再写「视频 / 图片 / 音频」这一段**：
     *   图片和视频本来就是同一条内容的两种形态，分开放会让同一作者
     *   的素材散在两处。文件扩展名已足够区分，浏览时也更连贯。
     *
     * @param {object} opt
     *   pageUrl    页面 URL（优先，用于站点识别）
     *   mediaUrl   媒体 URL（兜底）
     *   siteName   本次抓到的站名（下载链路会传）
     *   site       naming.js 的站点名（旧字段，兼容）
     *   authorFull "昵称(@ID)"
     *   creatorId  博主 ID（可空）
     *   type       video|image|audio|other（仅用于判定，不再落目录）
     *   ext        扩展名
     *   part       多P/多集名称（有则单独一层）
     *   keepType   true 时仍写类型段（迁移/兼容老结构用）
     *   subdir     第一段子目录，默认 video-rod
     * @returns {string} 例：video-rod/B站/影视飓风(@946974)
     */
    function buildRelDir(opt) {
        var o = opt || {};
        var sub = cleanSeg(o.subdir || 'video-rod') || 'video-rod';
        var pageUrl = o.pageUrl || o.mediaUrl || '';
        var site = siteOf(o);
        var type = typeOf(o);

        var creator = creatorSegment(o.authorFull, o.creatorId || creatorIdFromUrl(pageUrl));
        /* 拿不到作者时的兜底（2026-11-09 B-67 改口径）。
         *
         * 原来一律用域名兜底 —— 对收录平台是灾难：抖音图文从侧边栏下载时
         * 作者拿不到，落成「抖音/www.douyin.com/<标题>/」，而页面浮标那条通道
         * 有作者，落成「抖音/摄影师沙皮/<标题>/」。同一个作品的图被劈成两个
         * 文件夹，用户在库里看到的就是「重复」，怎么去重都去不掉。
         *
         * 现在：收录平台用「待整理」（作者确实没拿到，诚实标注，且不会伪造
         * 一个假作者）；未收录站点仍用域名 —— 那时站点段就是域名，域名才有
         * 区分意义（不写会全平铺在一层）。 */
        if (!creator) {
            var knownPlatform = !!(site && PLATFORM_DIR[site.key]);
            if (knownPlatform) {
                creator = FALLBACK_CREATOR;
            } else {
                var host = hostOf(pageUrl);
                if (host) {
                    var hSeg = cleanSeg(host);
                    if (hSeg && hSeg.toLowerCase() !== String(site.dir).toLowerCase()) {
                        creator = hSeg;
                    }
                }
            }
        }

        var dirs = [sub, site.dir];
        if (creator) { dirs.push(creator); }

        /* 网页/图集分组：同一网页的一批素材收进以标题命名的子文件夹。
         * 用户 2026-11-07 明确要求「一个网页九张图，就建一个文件夹放进去」，
         * 否则同题图会平铺在站点目录下，只能靠文件名分辨。
         *
         * 与站点名/作者名相同的分组名要跳过：豆瓣页面标题就是「豆瓣」，
         * 再加一层会得到 豆瓣/豆瓣 这种重复结构。 */
        if (o.part) {
            var p = cleanSeg(o.part);
            var dupOfSite = p && p.toLowerCase() === String(site.dir).toLowerCase();
            var dupOfCreator = p && creator && p.toLowerCase() === String(creator).toLowerCase();
            if (p && !dupOfSite && !dupOfCreator) { dirs.push(p); }
        }

        /* 类型段默认不写；迁移老结构或调用方显式要求时才保留 */
        if (o.keepType && TYPE_DIR[type]) { dirs.push(TYPE_DIR[type]); }

        return dirs.join('/');
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

    /**
     * relPath → 缩略图文件名（16 位 hex，不含扩展名）
     *
     * 为什么用 hash 而不是直接用 relPath：
     *   thumbKey 形如 `t:花瓣/小鱼(@u1)/图片/面包.jpg`，含斜杠、中文、@、#、%，
     *   不能直接当文件名（斜杠会被解析成目录层级）。
     *   这是 freedesktop Thumbnail Managing Standard 的通行做法（2001 年即用 MD5 哈希命名）。
     *
     * 为什么取 SHA-256 前 8 字节：
     *   16 hex = 64 bit，2 万条量级碰撞概率可忽略；文件名短、目录不膨胀。
     *
     * @param {string} relPath 相对资源库根的路径
     * @returns {Promise<string>} 16 位小写 hex
     */
    function thumbFileName(relPath) {
        var src = String(relPath == null ? '' : relPath);
        var subtle = root.crypto && root.crypto.subtle;
        if (subtle && typeof subtle.digest === 'function' && typeof TextEncoder !== 'undefined') {
            var buf = new TextEncoder().encode(src);
            return Promise.resolve(subtle.digest('SHA-256', buf)).then(function (d) {
                var bytes = new Uint8Array(d);
                var hex = '';
                for (var i = 0; i < 8; i++) {
                    hex += ('0' + bytes[i].toString(16)).slice(-2);
                }
                return hex;
            }, function () {
                return fnv1a32(src);
            });
        }
        /* 老环境没有 WebCrypto：退化成纯 JS 哈希。
         * 明确声明：这不是加密用途，只求「同一路径稳定、不同路径基本不撞」。 */
        return Promise.resolve(fnv1a32(src));
    }

    /** 两个 32 位哈希拼成 16 hex（WebCrypto 不可用时的兜底） */
    function fnv1a32(s) {
        var str = String(s == null ? '' : s);
        var h1 = 0x811c9dc5, h2 = 0x01000193;
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            h1 ^= c; h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;
            h2 = (h2 ^ (c + i)) >>> 0;
            h2 = (h2 * 16777619) >>> 0;
        }
        return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
    }

    /** 形如 huaban.com / pixso.cn / v.qq.com 的域名段 */
    function looksLikeHost(seg) {
        var s = String(seg || '');
        if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s)) { return false; }
        return /[a-z]{2,}$/i.test(s);
    }

    /** 站名 → 站点 key（先问 registry，再查预置表；都认不出返回空） */
    function siteKeyFromName(name) {
        var n = String(name || '').trim();
        if (!n) { return ''; }
        var R = root.VRSiteRegistry;
        if (R && typeof R.keyOfName === 'function') {
            try { var k = R.keyOfName(n); if (k) { return k; } } catch (e) { /* 落回预置表 */ }
        }
        var PP = root.VRSiteNamesPreset;
        if (PP && typeof PP.byName === 'function') {
            try {
                var it = PP.byName(n);
                if (it && it.h && it.h.length) { return String(it.h[0]).toLowerCase(); }
            } catch (e) { /* 认不出 */ }
        }
        return '';
    }

    function isTypeSeg(seg) {
        var s = String(seg || '');
        var t;
        for (t in TYPE_DIR) { if (TYPE_DIR[t] === s) { return t; } }
        var a = TYPE_ALIAS[s.toLowerCase()];
        return a || '';
    }

    /**
     * 从相对路径反解（入库时补元数据用）。
     *
     * 支持两种结构：
     *   新：video-rod/<站名或域名>/<作者>/[<分P>/]<文件>
     *   老：video-rod/<平台中文名>/<作者>/<图片|视频>/<文件>
     *       video-rod/其他网页/<域名>/<类型>/<文件>
     *       video-rod/xiaohongshu/<作者>/images/<文件>（英文别名）
     *
     * 关键行为：老结构里的「其他网页」会**继续看下一段域名**，把 platform
     * 落到域名上 —— 这样历史素材重扫后能自动按站点分组，不必手工迁移。
     */
    function parseRelPath(rel) {
        var segs = String(rel || '').split('/').filter(Boolean);
        var out = {
            subdir: segs[0] || '',
            platform: '', platformName: '',
            siteHost: '',
            creatorFull: '', creatorId: '',
            type: '', part: '',
            fileName: segs.length ? segs[segs.length - 1] : ''
        };
        var pIdx = -1, k, i;

        /* ① 找站点段：跳过首段（subdir），最后一段是文件名 */
        for (i = 1; i < segs.length - 1 && pIdx < 0; i++) {
            var seg = segs[i];
            var key = '', name = '';

            /* 中文平台名（老结构的 B站/小红书/其他网页…，也是内置站名） */
            for (k in PLATFORM_DIR) {
                if (PLATFORM_DIR[k] === seg) { key = k; name = seg; break; }
            }
            /* 英文别名（instagram / xiaohongshu / weibo…） */
            if (!key) {
                var alias = PLATFORM_ALIAS[String(seg).toLowerCase()];
                if (alias) { key = alias; name = PLATFORM_DIR[alias] || seg; }
            }
            /* 域名形式（未收录站点直接以域名成目录） */
            if (!key && looksLikeHost(seg)) { key = String(seg).toLowerCase(); name = seg; }
            /* 站名反查（花瓣 / Pixso / 腾讯视频…） */
            if (!key) {
                var nk = siteKeyFromName(seg);
                if (nk) { key = nk; name = seg; }
            }
            if (!key) { continue; }

            /* 「其他网页」不是站点，只是老结构的兜底段：下一段域名才是站点 */
            if (key === 'web') {
                var nxt = segs[i + 1] || '';
                if (looksLikeHost(nxt)) {
                    key = String(nxt).toLowerCase();
                    name = nxt;
                    i = i + 1;
                }
            }
            out.platform = key;
            out.platformName = name;
            if (looksLikeHost(key)) { out.siteHost = key; }
            pIdx = i;
        }

        if (pIdx > 0) {
            /* ② 站点段之后：过滤掉类型段，剩余依次是 作者、分P */
            var rest = [];
            for (var j = pIdx + 1; j < segs.length - 1; j++) {
                if (isTypeSeg(segs[j])) { out.type = out.type || isTypeSeg(segs[j]); continue; }
                rest.push(segs[j]);
            }
            out.creatorFull = rest[0] || '';
            var m = out.creatorFull.match(/\(@([^)]+)\)/);
            if (m) { out.creatorId = m[1]; }
            if (rest.length > 1) { out.part = rest[1]; }
        }

        /* ③ 类型：目录里没写就用扩展名推断（新结构不再有类型段） */
        if (!out.type) {
            out.type = typeOf({ fileName: out.fileName });
        }
        return out;
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
        PLATFORM_ALIAS: PLATFORM_ALIAS,
        TYPE_ALIAS: TYPE_ALIAS,
        MAX_REL_LEN: MAX_REL_LEN,
        detectPlatform: detectPlatform,
        detectSite: detectSite,
        siteOf: siteOf,
        siteKeyFromName: siteKeyFromName,
        looksLikeHost: looksLikeHost,
        typeOf: typeOf,
        creatorIdFromUrl: creatorIdFromUrl,
        creatorSegment: creatorSegment,
        buildRelDir: buildRelDir,
        buildRelPath: buildRelPath,
        parseRelPath: parseRelPath,
        clampLength: clampLength,
        cleanSeg: cleanSeg,
        cleanPath: cleanPath,
        toFileUrl: toFileUrl,
        checkLength: checkLength,
        thumbFileName: thumbFileName,
        _fnv1a32: fnv1a32
    };
    if (typeof module === 'object' && module.exports) { module.exports.VRPath = root.VRPath; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
