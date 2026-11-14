/* ==========================================================
 * VR Library App —— 舞台原型复刻 + 真实数据（R3/R4）
 * 真源：deliverables/prototypes/media-library-stage-v1.html
 * 职责：VRDB 条目 → 卡片模型 → 原型 DOM 渲染；筛选/搜索/排序/批量
 * 数据层复用：VRDB / VRIndex / VRThumbs / VRPath
 * ========================================================== */
(function () {
    'use strict';

    var root = window;

    /* ---------- 平台字典（与原型 PLAT 对齐，补 B站/音频） ---------- */
    var PLAT = {
        x: { name: 'X', dot: '#8FA0B8', label: 'X' },
        xiaohongshu: { name: '小红书', dot: '#FF2442', label: '小红书' },
        douyin: { name: '抖音', dot: '#25C8D4', label: '抖音' },
        weibo: { name: '微博', dot: '#E6506D', label: '微博' },
        youtube: { name: 'YouTube', dot: '#FF0000', label: 'YouTube' },
        instagram: { name: 'Instagram', dot: '#C13584', label: 'Instagram' },
        bilibili: { name: 'B站', dot: '#FB7299', label: 'B站' },
        tiktok: { name: 'TikTok', dot: '#25F4EE', label: 'TikTok' },
        web: { name: '网页', dot: '#8B93A1', label: '网页' },
        untracked: { name: '未整理', dot: '#C9A227', label: '未整理' }
    };

    /* ---------- 状态 ---------- */
    var RAW = {};      // relPath -> 原始条目
    var FILES = [];    // 卡片模型
    var S = {
        type: 'all', plat: 'all', q: '', view: 'grid',
        /* R4：仅已星标（时间窗 chips 2026-11-10 苏哥拍板整组删除） */
        starOnly: false,
        /* R6：更多筛选（低频条件，抽屉里）——大小档 / 分辨率档 / 作者多选 */
        size: 'all', res: 'all', authors: [],
        /* 选中的标签（多选=交集）。用数组而不是 Set：要按点击顺序稳定渲染，
         * 且要能序列化进「智能收藏夹」。 */
        tags: [],
        select: false, sel: new Set(), sort: 'new', fav: null, idx: 0, list: []
    };
    var treeOpen = {};
    var objUrls = [];

    var $ = function (s) { return document.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
    var esc = function (s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    };
    function fmt(mb) {
        var n = Number(mb) || 0;
        if (n >= 1024) { return (n / 1024).toFixed(1) + ' GB'; }
        if (n >= 1) { return n.toFixed(1) + ' MB'; }
        return Math.round(n * 1024) + ' KB';
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function fmtDate(ts) {
        var d = new Date(Number(ts) || 0);
        if (!ts || isNaN(d.getTime())) { return ''; }
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
            + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    function shortDate(v) {
        if (!v) { return '—'; }
        var m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) { return m[2] + '-' + m[3]; }
        var m2 = String(v).match(/(\d{2})-(\d{2})/);
        return m2 ? m2[0] : '—';
    }
    function fmtDur(sec) {
        var s = Math.round(Number(sec) || 0);
        if (!s) { return ''; }
        var m = Math.floor(s / 60), r = s % 60;
        return pad(m) + ':' + pad(r);
    }

    /* ---------- 真实条目 → 卡片模型 ---------- */
    /* WebP 只是容器，不等于动图：小红书/Instagram 大量静态 WebP 必须归图片。
     * 只有 GIF/APNG 这类明确动图扩展才进入 anim（用户 2026-11-06 纠正）。 */
    var EXT_ANIM = /^(gif|apng)$/i;
    /* 小红书实况图（live photo，2026-11-11 B-71）：下载时静态图叫 `xxx.jpg`，
     * 实况视频叫 `xxx_live.mp4` —— 同一目录、同一前缀。库里把它们认成一对：
     * 照片卡显示「实况」角标、计数里单独一类，预览时照片下面直接播那段视频。
     * 不合并条目：用户可能只想要那张照片，删一条不该牵连另一条。 */
    var EXT_LIVE = /_live\.mp4$/i;

    /** 实况照片 → 对应视频的相对路径（同目录同前缀）；不是实况返回 '' */
    function livePathOf(rel) {
        var s = String(rel || '');
        if (!s || EXT_LIVE.test(s)) { return ''; }
        /* 无扩展名的地址（图床 hash 结尾、网页路径）不算实况候选 —— 猜不出
         * 它的「_live.mp4」该叫什么，宁可不标，也不能标错。 */
        if (!/\.[a-z0-9]{2,5}$/i.test(s)) { return ''; }
        return s.replace(/\.[a-z0-9]{2,5}$/i, '_live.mp4');
    }

    /**
     * 标记实况对（2026-11-11，B-71）：照片 + 同前缀 `_live.mp4` 都在库里，才把这张
     * 照片归成 `kind='live'`。为什么要整表判定：toCardModel 是单条转换，看不到
     * 「那个 mp4 到底在不在」—— 不在还标「实况」，预览就会破图。
     */
    function markLivePairs(list) {
        var have = Object.create(null);
        list.forEach(function (f) { have[String(f.relPath).toLowerCase()] = 1; });
        list.forEach(function (f) {
            if (f.kind !== 'image' || !f.livePair) { return; }
            if (!have[String(f.livePair).toLowerCase()]) { f.livePair = ''; return; }
            /* 照片卡自成一类：它和纯照片、动图、视频都不同 —— 筛选要能单独选出来 */
            f.kind = 'live';
        });
    }

    function toCardModel(e) {
        var P = root.VRPath || {};
        var rel = e.relPath || '';
        var parsed = {};
        try { parsed = P.parseRelPath ? (P.parseRelPath(rel) || {}) : {}; } catch (err) { parsed = {}; }
        var fileName = e.fileName || String(rel).split('/').pop() || '';
        var ext = (String(fileName).match(/\.([a-z0-9]{2,5})$/i) || [])[1] || '';
        var type = e.type || parsed.type || (P.typeOf ? P.typeOf({ fileName: fileName }) : 'other');

        var kind = type;
        if (type === 'image' && EXT_ANIM.test(ext)) { kind = 'anim'; }
        /* 实况标记：静态图旁边有同名 `_live.mp4` 才算（磁盘/索引里真有那条才亮）。
         * 这里只算出「它该配哪一条」，真正判定在 buildFiles() 里做 —— 
         * toCardModel 是单条转换，看不到全表。 */
        var livePair = (kind === 'image' && !EXT_LIVE.test(rel)) ? livePathOf(rel) : '';

        var creatorFull = String(e.creatorFull || parsed.creatorFull || '').trim();
        var m = creatorFull.match(/^(.+?)\s*\(@([^)]+)\)\s*$/);
        var author = (m ? m[1] : creatorFull).trim();
        var authorId = e.creatorId || parsed.creatorId || (m ? m[2] : '');

        var title = String(e.title || '').trim() || String(fileName).replace(/\.[^.]+$/, '');
        var sizeMb = (Number(e.size) || 0) / 1048576;

        return {
            id: rel,
            relPath: rel,
            absPath: e.absPath || '',
            /* 保留 downloads 记录 ID：详情页「定位」要靠它打开系统文件夹，
             * 而不是在浏览器里打开 file:// 目录。 */
            downloadId: (e.downloadId != null ? e.downloadId : null),
            plat: e.untracked ? 'untracked' : (e.platform || parsed.platform || 'web'),
            untracked: !!e.untracked,
            author: author,
            authorId: authorId,
            title: title,
            _title: (e.displayName || '').trim() || title,
            kind: kind,
            /* 若同目录真有 xxx_live.mp4，会被 buildFiles 改成 'live'
             * （照片 + 实况，筛选/角标/预览都按它走） */
            livePair: livePair,
            ext: String(ext).toUpperCase(),
            size: sizeMb,
            width: Number(e.width) || 0,
            height: Number(e.height) || 0,
            dur: fmtDur(e.duration),
            frames: Number(e.frames) || 0,
            h: 180,
            tags: Array.isArray(e.tags) ? e.tags : [],
            starred: !!e.starred,
            state: e.state || 'ok',
            isRef: e.isRef ? 1 : 0,
            refOf: e.refOf || '',
            sha256: e.sha256 || '',
            displayName: e.displayName || '',
            savedAt: fmtDate(e.mtime),
            savedTs: Number(e.mtime) || 0,
            dlAt: fmtDate(e.mtime),
            workId: e.workId || '',
            pageUrl: e.pageUrl || '',
            mediaUrl: e.mediaUrl || e.sourceUrl || '',
            authorUid: e.authorUid || '',
            authorHandle: e.authorHandle || '',
            authorState: e.authorState || (author ? 'ok' : 'unsupported')
        };
    }

    /* ---------- 统计 ---------- */
    /**
     * 统计口径：**按显示名归并**，不按原始 platform 字符串。
     *
     * 为什么：同一个站点在库里可能存着两种写法 —— 老条目是平台 key
     * （`weibo`），新条目是域名（`weibo.com`）。若按原始字符串分组，
     * 左栏就会出现两个「微博」。用户看到的是名字，分组也该按名字。
     */
    function counts() {
        var c = { all: FILES.length, image: 0, anim: 0, live: 0, video: 0, audio: 0, other: 0, starred: 0, platforms: {}, creators: {}, byPlat: {}, tags: {} };
        FILES.forEach(function (f) {
            c[f.kind] = (c[f.kind] || 0) + 1;
            var label = platLabel(f.plat);
            var key = siteGroupKey(f.plat, label);
            c.platforms[key] = (c.platforms[key] || 0) + 1;
            /* 记录「哪个原始 platform 值归到这个组」，筛选时按组匹配 */
            if (!c.byPlat[key]) { c.byPlat[key] = {}; }
            c.byPlat[key][f.plat] = 1;
            if (f.author) { c.creators[f.author] = (c.creators[f.author] || 0) + 1; }
            if (f.starred) { c.starred++; }
            /* 标签计数：booru 式的「这个标签有几张图」，左栏徽标直接用。
             * 大小写不敏感归并，但保留首次出现的原始写法作为显示名。 */
            var ts = Array.isArray(f.tags) ? f.tags : [];
            for (var i = 0; i < ts.length; i++) {
                var t = String(ts[i] || '').trim();
                if (!t) { continue; }
                var tk = t.toLowerCase();
                if (!c.tags[tk]) { c.tags[tk] = { label: t, count: 0 }; }
                c.tags[tk].count++;
            }
        });
        lastCounts = c;
        return c;
    }

    /**
     * 只统计「当前站点范围内」的素材，用于顶部类型 tab 的数字。
     *
     * 为什么不能直接用 counts()：counts() 是全库口径。选中小红书后，
     * tab 仍显示「视频 29」（全库），与实际筛出的 5 条对不上 ——
     * 用户 2026-11-07 报的就是这个「左侧与上面不联动」。
     *
     * 口径：站点筛选 + 收藏夹 + 搜索词都算「范围」，**唯独不含类型筛选本身**，
     * 否则点「视频」后「图片」会变 0，tab 就没法在类型之间来回切了。
     */
    function countsInScope() {
        var c = { all: 0, image: 0, anim: 0, live: 0, video: 0, audio: 0, other: 0, starred: 0, tags: {} };
        FILES.forEach(function (f) {
            if (S.fav) {
                var fav = findFav(S.fav);
                if (!fav || !favHas(fav, f)) { return; }
            }
            if (S.plat !== 'all') {
                if (f.plat !== S.plat) {
                    var gk = siteGroupKey(f.plat, platLabel(f.plat));
                    if (gk !== S.plat) { return; }
                }
            }
            if (S.q) {
                var raw = S.q.replace(/^@/, '').toLowerCase().trim();
                var terms = raw.split(/\s+/).filter(Boolean);
                var must = terms.filter(function (t) { return t.charAt(0) !== '-'; });
                var excl = terms.filter(function (t) { return t.charAt(0) === '-'; }).map(function (t) { return t.slice(1); }).filter(Boolean);
                var hay = ((f._title || f.title || '') + ' ' + (f.title || '') + ' ' + (f.author || '') + ' ' + (f.authorId || '') + ' ' + f.id + ' ' + f.plat).toLowerCase();
                if (must.length && !must.every(function (w) { return hay.indexOf(w) >= 0; })) { return; }
                if (excl.length && excl.some(function (w) { return hay.indexOf(w) >= 0; })) { return; }
            }
            c.all++;
            c[f.kind] = (c[f.kind] || 0) + 1;
            if (f.starred) { c.starred++; }
            /* 标签计数跟着「范围」联动：切到某平台后，左栏每个标签显示的是
             * 「该平台下有几张图」。注意这里**不按 S.tags 过滤**——
             * 否则选中「风景」后其它标签全变 0，就没法再叠加第二个标签了。 */
            var ts2 = Array.isArray(f.tags) ? f.tags : [];
            for (var j = 0; j < ts2.length; j++) {
                var t2 = String(ts2[j] || '').trim();
                if (!t2) { continue; }
                var tk2 = t2.toLowerCase();
                if (!c.tags[tk2]) { c.tags[tk2] = { label: t2, count: 0 }; }
                c.tags[tk2].count++;
            }
        });
        return c;
    }

    /**
     * 站点分组键：优先用显示名（「微博」「B站」），
     * 这样 `weibo` / `weibo.com` / `weibo.cn` 会落进同一组。
     * 显示名拿不到时才退回原始 key。
     */
    function siteGroupKey(plat, label) {
        var l = String(label || '').trim();
        if (l && l !== '网页' && l !== plat) { return '@' + l; }
        return String(plat || '');
    }

    /** 某个分组键包含的所有原始 platform 值（用于筛选） */
    function platsOfGroup(c, groupKey) {
        var m = c.byPlat && c.byPlat[groupKey];
        if (!m) { return [groupKey]; }
        return Object.keys(m);
    }

    /* ---------- 筛选 / 排序 ---------- */
    function filtered() {
        return FILES.filter(function (f) {
            if (S.fav) {
                var fav = findFav(S.fav);
                /* 找不到收藏夹时**不能放行**：原实现 `if (fav && ...)` 在 fav 为 null
                 * 时直接跳过筛选，结果「已加星标」这种虚拟夹（不在 FAVS 里）
                 * 会显示全部素材（2026-11-06 用户反馈：筛选出来根本不是收藏的东西）。 */
                if (!fav) { return false; }
                if (!favHas(fav, f)) { return false; }
            }
            if (S.type !== 'all' && f.kind !== S.type) { return false; }
            /* R4：仅已星标 */
            if (S.starOnly && !f.starred) { return false; }
            /* R6：大小档（f.size 单位是 MB） */
            if (S.size && S.size !== 'all') {
                var mb = Number(f.size || 0);
                if (S.size === 'lt1' && !(mb < 1)) { return false; }
                if (S.size === '1to10' && !(mb >= 1 && mb < 10)) { return false; }
                if (S.size === '10to100' && !(mb >= 10 && mb < 100)) { return false; }
                if (S.size === 'gt100' && !(mb >= 100)) { return false; }
            }
            /* R6：分辨率档（width/height 由缩略图解码回写） */
            if (S.res && S.res !== 'all') {
                var fw = Number(f.width || 0), fh = Number(f.height || 0);
                if (S.res === '4k' && !(fw >= 3840)) { return false; }
                if (S.res === 'fhd' && !(fw >= 1920)) { return false; }
                if (S.res === 'portrait' && !(fh > fw)) { return false; }
            }
            /* R6：作者多选（任一命中即保留） */
            if (S.authors && S.authors.length && S.authors.indexOf(f.author) < 0) { return false; }
            /* 标签筛选：多选时取**交集**（booru 用法）——
             * 选「风景」+「竖图」= 同时带这两个标签的图。
             * 大小写不敏感比对，与 counts() 的归并口径保持一致。 */
            if (S.tags && S.tags.length) {
                var mine = Array.isArray(f.tags) ? f.tags.map(function (x) {
                    return String(x || '').trim().toLowerCase();
                }) : [];
                for (var ti = 0; ti < S.tags.length; ti++) {
                    if (mine.indexOf(String(S.tags[ti]).toLowerCase()) < 0) { return false; }
                }
            }
            if (S.plat !== 'all') {
                /* 站点筛选按「分组键」比对：同一站点的不同原始写法
                 * （weibo / weibo.com）要被当成一个节点，否则点「微博」
                 * 只筛出一半素材。 */
                if (f.plat !== S.plat) {
                    var gk = siteGroupKey(f.plat, platLabel(f.plat));
                    if (gk !== S.plat) { return false; }
                }
            }
            if (S.q) {
                var raw = S.q.replace(/^@/, '').toLowerCase().trim();
                var terms = raw.split(/\s+/).filter(Boolean);
                var must = terms.filter(function (t) { return t.charAt(0) !== '-'; });
                var excl = terms.filter(function (t) { return t.charAt(0) === '-'; }).map(function (t) { return t.slice(1); }).filter(Boolean);
                var hay = ((f._title || f.title || '') + ' ' + (f.title || '') + ' ' + (f.author || '') + ' ' + (f.authorId || '') + ' ' + f.id + ' ' + f.plat).toLowerCase();
                if (must.length && !must.every(function (w) { return hay.indexOf(w) >= 0; })) { return false; }
                if (excl.length && excl.some(function (w) { return hay.indexOf(w) >= 0; })) { return false; }
            }
            return true;
        });
    }
    function sorted(rows) {
        var out = rows.slice();
        /* S.sort 必须由 #sort 的 change 事件写入。原来 S.sort 初始就是 'new'，
         * `S.sort || select.value` 永远短路到 'new'，切 A-Z/大小都没反应。 */
        var s = S.sort || 'new';
        var tie = function (a, b) { return String(a.relPath || '').localeCompare(String(b.relPath || '')); };
        out.sort(function (a, b) {
            var d = 0;
            if (s === 'old') { d = (a.savedTs || 0) - (b.savedTs || 0); }
            else if (s === 'size') { d = (b.size || 0) - (a.size || 0); }
            else if (s === 'recent') { d = (b.savedTs || 0) - (a.savedTs || 0); }
            else if (s === 'name') {
                /* 重命名写的是 displayName；卡片显示 _title，排序也必须用它，
                 * 否则改了名但 A-Z 仍按旧物理文件名排。 */
                d = String(a._title || a.title || '').localeCompare(String(b._title || b.title || ''), 'zh');
            }
            else { d = (b.savedTs || 0) - (a.savedTs || 0); }
            return d || tie(a, b);
        });
        return out;
    }

    /* ---------- 侧栏编号树 ---------- */

    /**
     * 升为一级节点的门槛（素材条数）。
     * 用户 2026-11-07 定的规则：素材多的站点单独成节点，长尾收进「其他站点」，
     * 否则站点一多左栏会被小站淹没。
     */
    var MIN_SITE = 5;

    /** 站点显示名：先问站点字典（手改 / 预置 / 自动学习），再退内置表 */
    function platLabel(key) {
        var k = String(key || '');
        /* 分组键形如「@微博」：直接返回名字本身（@ 是内部前缀，不给人看） */
        if (k.charAt(0) === '@') { return k.slice(1); }
        var R = root.VRSiteRegistry;
        if (R && typeof R.nameOf === 'function') {
            try {
                var n = R.nameOf(k);
                if (n) { return n; }
            } catch (e) { /* 落回内置表 */ }
        }
        var d = PLAT[k];
        if (d) { return d.name; }
        return k || '网页';
    }

    /** 站点色点：分组键没有原始 key，退中性色；否则按已知平台取色 */
    function platDot(key) {
        var k = String(key || '');
        if (k.charAt(0) === '@') {
            /* 归并组：用它包含的第一个原始 platform 取色 */
            var members = groupMembers(k);
            for (var i = 0; i < members.length; i++) {
                var d0 = PLAT[members[i]];
                if (d0 && d0.dot) { return d0.dot; }
            }
            return PLAT.web.dot;
        }
        var d = PLAT[k];
        return (d && d.dot) || PLAT.web.dot;
    }

    /** 分组键 → 原始 platform 列表（用最近一次 counts() 的结果） */
    var lastCounts = null;
    function groupMembers(gk) {
        if (!lastCounts) { return []; }
        var m = lastCounts.byPlat[gk];
        return m ? Object.keys(m) : [];
    }

    /** 「huaban.com」这类域名段 —— 它出现在作者位说明当年没抓到作者，不是人名 */
    function looksLikeHost(seg) {
        var s = String(seg || '');
        if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s)) { return false; }
        return /[a-z]{2,}$/i.test(s);
    }

    function buildTree() {
        var c = counts();
        var sites = Object.keys(c.platforms).filter(function (k) { return k !== 'untracked'; })
            .sort(function (a, b) { return c.platforms[b] - c.platforms[a]; });

        var rows = [{ kind: 'root', label: '全部资源', count: c.all }];
        /* 「未整理」是入口不是站点：固定放在「全部资源」下面，点击直接筛出来。 */
        if (c.platforms.untracked) {
            rows.push({ kind: 'untracked', label: '未整理', count: c.platforms.untracked });
        }

        /* 站点分两档：≥MIN_SITE 单独成一级；其余归「其他站点」（可展开） */
        var major = [], minor = [];
        sites.forEach(function (k) {
            (c.platforms[k] >= MIN_SITE ? major : minor).push(k);
        });

        var pi = 0;
        major.forEach(function (p) {
            pi++;
            pushSite(p, pad(pi), false);
        });

        if (minor.length) {
            var sum = 0;
            minor.forEach(function (k) { sum += c.platforms[k]; });
            rows.push({
                kind: 'others-head', label: '其他站点',
                count: sum, sites: minor.length
            });
            minor.forEach(function (p) { pushSite(p, '·', true); });
        }
        return rows;

        /**
         * 追加一个站点节点 + 它的作者二级。
         * 作者只认「真实名字」：空值、占位符、以及退化成域名的段都不生成二级，
         * 避免出现「花瓣 / huaban.com」这种重复一层的空壳。
         */
        function pushSite(p, num, inOthers) {
            rows.push({
                kind: 'plat', key: p, label: platLabel(p),
                count: c.platforms[p], num: num, inOthers: !!inOthers
            });
            var creators = {};
            var members = c.byPlat[p] || {};
            FILES.forEach(function (f) {
                if (!members[f.plat]) { return; }
                var name = String(f.author || '').trim();
                if (!name || name === '—' || name === '未知来源') { return; }
                if (looksLikeHost(name)) { return; }
                creators[name] = (creators[name] || 0) + 1;
            });
            var ck = Object.keys(creators).sort(function (a, b) { return creators[b] - creators[a]; });
            ck.forEach(function (name, i) {
                rows.push({
                    kind: 'author', plat: p, label: name, count: creators[name],
                    num: num + '·' + (i + 1)
                });
            });
        }
    }

    function renderTree() {
        var c = counts();
        var q = ($('#treeSearch') && $('#treeSearch').value || '').trim().toLowerCase();
        var rows = buildTree();
        var total = FILES.length || 1;
        var html = rows.filter(function (t) { return !q || String(t.label).toLowerCase().indexOf(q) >= 0; }).map(function (t) {
            var pct = t.kind === 'root' ? 100 : Math.max(2, Math.min(100, Math.round(t.count / total * 100)));
            if (t.kind === 'author' && !treeOpen[t.plat] && !q) { return ''; }
            /* 「其他站点」未展开时，里面的站点不占位 */
            if (t.kind === 'plat' && t.inOthers && !treeOpen.__others__ && !q) { return ''; }
            if (t.kind === 'others-head') {
                var open0 = !!treeOpen.__others__ || !!q;
                return '<button class="tree-node plat group' + (S.plat === 'others' ? ' active' : '') + '" data-group="others" style="--pct:' + pct + '%;--pc:' + PLAT.web.dot + '">' +
                    '<svg class="i i-sm chev" style="transform:rotate(' + (open0 ? 0 : -90) + 'deg)"><use href="#i-chevron-down"/></svg>' +
                    '<span class="ix">··</span><span class="label">' + esc(t.label) + '</span>' +
                    '<span class="count">' + t.count + '</span></button>';
            }
            if (t.kind === 'root') {
                return '<button class="tree-node' + (S.plat === 'all' ? ' active' : '') + '" style="--pct:' + pct + '%">' +
                    '<span class="ix">00</span><span class="label">' + esc(t.label) + '</span>' +
                    '<span class="count">' + c.all + '</span></button>';
            }
            if (t.kind === 'untracked') {
                return '<button class="tree-node plat untracked' + (S.plat === 'untracked' ? ' active' : '') + '" data-plat="untracked" style="--pct:' + pct + '%;--pc:' + PLAT.untracked.dot + '">' +
                    '<span class="ix">--</span><span class="label">' + esc(t.label) + '</span>' +
                    '<span class="count">' + t.count + '</span></button>';
            }
            if (t.kind === 'plat') {
                var open = !!treeOpen[t.key] || !!q;
                /* 「其他站点」里的站点缩进一级，视觉上表明它属于收纳区 */
                var cls = 'tree-node plat' + (t.inOthers ? ' nested' : '');
                return '<button class="' + cls + (S.plat === t.key ? ' active' : '') + '" data-plat="' + esc(t.key) + '" style="--pct:' + pct + '%;--pc:' + platDot(t.key) + '">' +
                    '<svg class="i i-sm chev" style="transform:rotate(' + (open ? 0 : -90) + 'deg)"><use href="#i-chevron-down"/></svg>' +
                    '<span class="ix">' + t.num + '</span><span class="label">' + esc(t.label) + '</span>' +
                    '<span class="count">' + t.count + '</span></button>';
            }
            /* 作者节点必须带上它所属的站点分组键（t.plat 就是 siteGroupKey 的结果）。
             * 不带的话，点击作者只会写搜索词，而平台筛选还留在上一次的状态：
             * 「微博」+「YouTube 作者名」叠加必然筛出 0 条
             * （2026-11-08 苏哥反馈：点作者后列表空了）。
             * active 也要按筛选状态算：点击时加的 class 在重绘后会丢，
             * 不在这里判断，用户就看不到「当前筛的是哪个作者」。 */
            var aOn = (S.plat === (t.plat || '')) && S.q &&
                (S.q === String(t.label || '').toLowerCase());
            return '<button class="tree-node lv2' + (aOn ? ' active' : '') + '" data-author="' + esc(t.label) + '" data-author-plat="' + esc(t.plat || '') + '" style="--pct:' + pct + '%">' +
                '<span class="ix">' + t.num + '</span><span class="label">' + esc(t.label) + '</span>' +
                '<span class="count">' + t.count + '</span></button>';
        }).join('');
        $('#tree').innerHTML = html || '<div class="side-empty">暂无素材</div>';
        var tt = $('#treeTotal');
        if (tt) { tt.textContent = FILES.length; }
    }

    /* ---------- 卡片 ---------- */
    function card(f) {
        var isV = f.kind === 'video', isA = f.kind === 'anim', isAu = f.kind === 'audio';
        var isL = f.kind === 'live';
        var p = PLAT[f.plat] || PLAT.web;
        /* 角标显示站点名：走站点字典拿人话名字（花瓣 / Pixso / 知乎），
         * 未收录站点才显示域名本身。这样不同站点在卡片上一眼能分开。 */
        var badgeLabel = platLabel(f.plat);
        if (!badgeLabel) { badgeLabel = p.label; }
        badgeLabel = String(badgeLabel).replace(/^\.+|\.+$/g, '').slice(0, 18);
        var corner = isV ? (f.dur || '') : (isA ? f.ext : (isAu ? f.ext : ''));
        var icon = isV ? 'i-film' : (isA ? 'i-repeat-1' : (isAu ? 'i-volume-2' : 'i-image'));
        var tags = (f.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
        return '<article class="card' + (S.sel.has(f.id) ? ' selected' : '') + '" data-id="' + esc(f.id) + '" tabindex="0">' +
            '<div class="thumb' + (isV ? ' is-video' : '') + (isA ? ' is-anim' : '') + (isAu ? ' is-audio' : '') + (isL ? ' is-live' : '') + '">' +
            '<div class="cover" style="--h:' + f.h + '"><span class="fig"><svg class="i"><use href="#' + icon + '"/></svg></span></div>' +
            '<img alt="" loading="lazy" data-thumb="' + esc(f.relPath) + '">' +
            '<span class="badge" data-site="' + esc(f.plat || '') + '" title="只看「' + esc(badgeLabel) + '」"><span class="dot" style="--pc:' + p.dot + '"></span>' + esc(badgeLabel) + '</span>' +
            (isL ? '<span class="live-tag">实况</span>' : '') +
            (corner ? '<span class="duration' + (isA ? ' anim' : '') + '">' + esc(corner) + '</span>' : '') +
            (f.state === 'missing' ? '<span class="missing-tag">文件缺失</span>' : '') +
            (f.isRef ? '<button type="button" class="ref-tag" data-refs="1" title="查看同内容的其它来源">引用</button>' : '') +
            '<div class="playbtn"><span><svg class="i"><use href="#i-' + (isV || isA || isAu ? 'play' : 'maximize') + '"/></svg></span></div>' +
            '</div>' +
            '<div class="body">' +
            '<div class="title">' + esc(f._title || f.title) + '</div>' +
            /* 货架专用副行（默认 display:none，只在 .shelf-line 里显示）：
             * 大小 + 保存时间，用等宽数字提升可读性；列表/网格视图不受影响。 */
            '<div class="card-sub">' + fmt(f.size) + '<i>·</i>' + esc(shortDate(f.savedAt)) + '</div>' +
            '<div class="metarow">' +
            '<span class="authorline"><span class="avatar">' + esc((f.author || '?').slice(0, 1)) + '</span>' +
            '<span class="nm">' + esc(f.author || '未知来源') + '</span></span>' +
            '<span class="size">' + fmt(f.size) + '</span>' +
            '</div>' +
            '<span class="platcell" style="--pc:' + p.dot + '">' + esc(badgeLabel) + '</span>' +
            '<span class="timecell">' + esc(shortDate(f.savedAt)) + '</span>' +
            (tags ? '<div class="tagrow">' + tags + '</div>' : '') +
            '</div>' +
            /* 2026-11-09 苏哥拍板：卡片星号删除（视觉杂乱）。
             * 星标功能收口到详情页（.pv-star）+ 键盘 S；starCard/已加星标筛选全部保留，
             * 已收藏的素材在网格里通过详情页或筛选器可见。 */
            '<input type="checkbox" class="selbox" aria-label="选择此素材"' + (S.sel.has(f.id) ? ' checked' : '') + '>' +
            '</article>';
    }

    /* ---------- 空态 ---------- */
    function renderEmpty(n, over) {
        var el = $('#empty');
        if (!el) { return; }
        if (n > 0) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        var v = over || {};
        var filtering = (v.filtering != null) ? !!v.filtering : !!(S.q || S.type !== 'all' || S.plat !== 'all');
        var noData = (v.noData != null) ? !!v.noData : (FILES.length === 0);
        /* 三种空态要给不同出路：授权没做好时让用户去点「扫描」只会一直失败，
         * 必须先告诉他去授权（2026-11-06 UX 审查 P1-8）。 */
        var unauth = (v.unauth != null) ? !!v.unauth : !!(window.__vrPerm && !window.__vrPerm.handle);
        var ico = function (h) { var i = $('#emptyIco'); if (i) { i.innerHTML = '<svg class="i"><use href="#' + h + '"/></svg>'; } };
        var title = $('#emptyTitle'), text = $('#emptyText'), act = $('#emptyAction');
        if (noData && unauth) {
            ico('i-folder');
            title.textContent = '还没有授权素材目录';
            text.innerHTML = '资源库需要先拿到一个本地文件夹的读写权限。<br>授权后这里会显示已有素材，之后下载的东西也会自动进来。';
            act.textContent = '授权素材目录'; act.dataset.act = 'auth';
        } else if (noData) {
            ico('i-folder');
            title.textContent = '这个目录里还没有素材';
            text.innerHTML = '在网页上抓到的东西会自动存进来。<br>也可以先扫一遍目录里已有的文件。';
            act.textContent = '扫描目录'; act.dataset.act = 'scan';
        } else if (filtering) {
            ico('i-search');
            title.textContent = '没有匹配的素材';
            var bits = [];
            if (S.q) { bits.push('关键词「' + S.q + '」'); }
            if (S.type !== 'all') { bits.push('类型筛选'); }
            if (S.plat !== 'all') { bits.push('平台筛选'); }
            text.textContent = '当前有 ' + bits.join(' + ') + '，库里共 ' + FILES.length + ' 项。换个条件或清掉筛选再试。';
            act.textContent = '清除筛选'; act.dataset.act = 'clear';
        }
    }

    /* ---------- 主渲染 ---------- */
    var PAGE = 120;          // 小库：首屏铺这么多，滚动再追加
    /* 大库阈值：超过就转窗口化渲染（只保留可视区附近的行），
     * 否则 5 万条会堆出 60 万 DOM 节点、布局 3 秒以上。 */
    var WIN_THRESHOLD = 300;
    var WIN_OVERSCAN = 2;    // 可视区上下各多渲染 2 行，滚动不闪白

    var win = {
        on: false,
        cols: 4,
        rowH: 0,
        start: 0,
        end: 0,
        totalRows: 0
    };

    /** 当前 grid 的实际列数（读 computedStyle，兼容响应式断点） */
    function gridCols(grid) {
        var tpl = String(getComputedStyle(grid).gridTemplateColumns || '');
        var n = tpl.split(' ').filter(Boolean).length;
        return n > 0 ? n : 1;
    }

    /** 测一行的高度：渲染完第一行后量卡片外框 */
    function measureRowH(grid) {
        var first = grid.querySelector('.card');
        if (!first) { return 0; }
        var r = first.getBoundingClientRect();
        if (!r.height) { return 0; }
        var gap = parseFloat(getComputedStyle(grid).rowGap || '0') || 0;
        return r.height + gap;
    }

    /** 窗口化：只渲染 [startRow, endRow) 的行，用 padding 撑起总高度 */
    function paintWindow() {
        var grid = $('#grid');
        var rows = S.rows || [];
        if (!grid || !rows.length || !win.on) { return; }
        var total = win.totalRows;
        var start = Math.max(0, win.start);
        var end = Math.min(total, win.end);
        var from = start * win.cols;
        var to = Math.min(rows.length, end * win.cols);
        grid.innerHTML = rows.slice(from, to).map(card).join('');
        /* padding 用 px 撑高度：5 万条×12 行会到 160 万 px，超出 Chrome 的
         * 布局可靠范围（约 33M px 才硬上限，但取整误差会累积成滚动跳动）。
         * 这里按整像素取整并夹住，滚动位置靠 window 重算，不依赖 padding 精确。 */
        var PAD_MAX = 2000000;
        var pt = Math.min(PAD_MAX, Math.round(start * win.rowH));
        var pb = Math.min(PAD_MAX, Math.round(Math.max(0, (total - end)) * win.rowH));
        grid.style.paddingTop = pt + 'px';
        grid.style.paddingBottom = pb + 'px';
        observeThumbs();
    }

    /** 根据滚动位置重算窗口；滚动时只在跨行时重绘 */
    function updateWindow(force) {
        if (!win.on) { return; }
        var grid = $('#grid');
        if (!grid) { return; }
        var top = grid.getBoundingClientRect().top;
        var viewH = window.innerHeight || 800;
        var firstRow = Math.floor((-top) / win.rowH);
        var visibleRows = Math.ceil(viewH / win.rowH) + 1;
        var start = Math.max(0, firstRow - WIN_OVERSCAN);
        var end = Math.min(win.totalRows, firstRow + visibleRows + WIN_OVERSCAN);
        if (!force && start === win.start && end === win.end) { return; }
        win.start = start;
        win.end = end;
        paintWindow();
    }

    /** 首屏骨架：boot() 串行等 favs→root→perm→load 约 2 秒，期间先铺占位卡片。
     *  render() 一跑就整体替换，不会残留。 */
    function renderSkeleton(n) {
        var grid = $('#grid');
        if (!grid) { return; }
        var count = Math.max(4, Math.min(12, Number(n) || 8));
        var one = '<div class="sk"><div class="sk-cover"></div><div class="sk-line"></div><div class="sk-line short"></div></div>';
        grid.className = 'grid loading';
        grid.innerHTML = new Array(count + 1).join(one);
    }

    /* ---------- R1/R2（2026-11-09）：平台货架 ----------
     * 首页网格改为「按 platform 分组、每平台一行」：
     *   · 每行最多渲染 SHELF_MAX 张（超出由 CSS overflow 裁切 + 右缘渐隐，禁止 JS 量宽隐藏 —— 见 ADR-076）
     *   · 分组后渲染量 = 平台数 × 12，可控，因此货架路径不参与虚拟滚动/分级加载
     *   · 列表视图（S.view === 'list'）完全保持原有逻辑，不做任何改动
     */
    var SHELF_MAX = 12;
    function shelvesHTML(rows) {
        var groups = {}, order = [];
        rows.forEach(function (f) {
            var k = f.plat || 'web';
            if (!groups[k]) { groups[k] = []; order.push(k); }
            groups[k].push(f);
        });
        /* 行序必须跟随排序键（2026-11-10 苏哥报「排序点了没反应」）。
         * 原实现写死「最近下载的平台排最上」，于是切「文件最大 / 标题 A-Z」时
         * 行与行的顺序纹丝不动，只有行内 12 张在换——用户看到的就是「没反应」。
         * 现在：new/old 按组内最新/最旧时间，size 按组内最大文件，name 按平台名。 */
        var maxTs = function (arr) {
            var m = 0;
            for (var i = 0; i < arr.length; i++) {
                var t = arr[i].savedTs || 0;
                if (t > m) { m = t; }
            }
            return m;
        };
        var minTs = function (arr) {
            var m = 0;
            for (var i = 0; i < arr.length; i++) {
                var t = arr[i].savedTs || 0;
                if (!m || (t && t < m)) { m = t; }
            }
            return m;
        };
        var maxSize = function (arr) {
            var m = 0;
            for (var i = 0; i < arr.length; i++) {
                var s = arr[i].size || 0;
                if (s > m) { m = s; }
            }
            return m;
        };
        var sortKey = S.sort || 'new';
        order.sort(function (a, b) {
            if (sortKey === 'old') { return minTs(groups[a]) - minTs(groups[b]); }
            if (sortKey === 'size') { return maxSize(groups[b]) - maxSize(groups[a]); }
            if (sortKey === 'name') {
                return String(platLabel(a) || a).localeCompare(String(platLabel(b) || b), 'zh');
            }
            return maxTs(groups[b]) - maxTs(groups[a]);
        });
        return order.map(function (k) {
            var arr = groups[k], first = arr[0];
            var p = PLAT[k] || PLAT.web;
            var label = platLabel(k) || p.label || k;
            /* 行头可视化：类型图标（最多 3 个）+ 总大小，比纯文字更快辨认这一行是什么 */
            var kinds = {};
            arr.forEach(function (f) { kinds[f.kind] = 1; });
            var kico = Object.keys(kinds).slice(0, 3).map(function (kk) {
                var ic = kk === 'video' ? 'i-film' : kk === 'anim' ? 'i-repeat-1' : kk === 'live' ? 'i-camera' : kk === 'audio' ? 'i-volume-2' : 'i-image';
                /* 必须带 .i：图标是 stroke 绘制（.i 里 fill:none;stroke:currentColor），
                 * 只写 .i-sm 会退回默认 fill:black，在深底上就是两个黑方块。 */
                return '<svg class="i i-sm kico" aria-hidden="true"><use href="#' + ic + '"/></svg>';
            }).join('');
            var totalMb = arr.reduce(function (a, f) { return a + (f.size || 0); }, 0);
            return '<section class="shelf" data-shelf="' + esc(k) + '">' +
                '<div class="shelf-head">' +
                    '<span class="bar" style="--pc:' + (p.dot || '#8B93A1') + '"></span>' +
                    '<b>' + esc(label) + '</b>' +
                    '<span class="kinds">' + kico + '</span>' +
                    '<span class="n">' + arr.length + '</span>' +
                    '<span class="meta">项 · ' + fmt(totalMb) + ' · 最近 ' + esc(shortDate(first.savedAt)) + '</span>' +
                    '<span class="grow"></span>' +
                    '<button type="button" class="open" data-shelf-open="' + esc(k) + '">查看全部 ' + arr.length + ' 项<svg class="i"><use href="#i-chevron-right"/></svg></button>' +
                '</div>' +
                '<div class="shelf-line">' + arr.slice(0, SHELF_MAX).map(card).join('') + '</div>' +
            '</section>';
        }).join('');
    }

    /* R3（2026-11-09）：平台内页的面包屑与标题跟随 S.plat。
     * 复用现有平台筛选状态，不新增路由/页面；从树、行头、徽标任一入口进来都一致。 */
    function syncHeader() {
        var crumb = $('#crumb');
        var title = $('#pageTitle');
        var onPlat = S.plat && S.plat !== 'all' && S.plat !== 'others' && S.plat !== 'untracked';
        var name = onPlat ? (platLabel(S.plat) || S.plat) : '';
        if (crumb) {
            crumb.innerHTML = onPlat
                ? '<a href="javascript:void 0" data-crumb-all style="color:var(--muted);text-decoration:none"><b>媒体库</b></a><span class="sep">/</span><span>' + esc(name) + '</span>'
                : '<b>媒体库</b><span class="sep">/</span><span>全部平台</span>';
        }
        if (title) { title.textContent = onPlat ? name : '全部资源'; }
    }

    /* R4：筛选条 chips 的选中态同步（仅已星标） */
    var KIND_LABEL = { image: '图片', anim: '动图', live: '实况', video: '视频', audio: '音频' };
    function syncFilterBar() {
        var sb = $('#starFilterBtn');
        if (sb) { sb.classList.toggle('on', !!S.starOnly); }
        var mb = $('#moreFilterBtn');
        if (mb) {
            var n = (S.size && S.size !== 'all' ? 1 : 0) + (S.res && S.res !== 'all' ? 1 : 0) + (S.authors ? S.authors.length : 0);
            mb.innerHTML = '<svg class="i"><use href="#i-funnel"/></svg>更多筛选' + (n ? ' <span class="hitn">' + n + '</span>' : '');
        }
    }

    /* R5：已选条件栏——每个条件可单删，末尾「清除全部」 */
    function renderActiveBar() {
        var bar = $('#activebar');
        if (!bar) { return; }
        var items = [];
        if (S.type !== 'all') { items.push({ k: 'type', t: '类型：' + (KIND_LABEL[S.type] || S.type) }); }
        if (S.starOnly) { items.push({ k: 'star', t: '仅已星标' }); }
        /* 平台不再进条件栏：面包屑「媒体库 / 抖音」已经说明了当前在哪，
         * 条件栏是"我筛了什么"的清单，平台是"我在哪一层"，两者重复会显得啰嗦。 */
        if (S.q && S.q.trim()) { items.push({ k: 'q', t: '搜索：' + S.q.trim() }); }
        (S.tags || []).forEach(function (t) { items.push({ k: 'tag:' + t, t: '标签：' + t }); });
        /* R6 的抽屉条件也要进条件栏，否则「筛过了但看不见」 */
        var SZT = { lt1: '< 1 MB', '1to10': '1–10 MB', '10to100': '10–100 MB', gt100: '> 100 MB' };
        var RST = { '4k': '4K 及以上', fhd: '1080p 及以上', portrait: '竖构图' };
        if (S.size && S.size !== 'all') { items.push({ k: 'size', t: '大小：' + (SZT[S.size] || S.size) }); }
        if (S.res && S.res !== 'all') { items.push({ k: 'res', t: '分辨率：' + (RST[S.res] || S.res) }); }
        (S.authors || []).forEach(function (a) { items.push({ k: 'author:' + a, t: '作者：' + String(a).split(' @')[0] }); });
        if (!items.length) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
        bar.classList.remove('hidden');
        bar.innerHTML = '<span class="lbl">已筛选</span>' + items.map(function (x) {
            return '<span class="acond">' + esc(x.t) +
                '<button type="button" data-fdel="' + esc(x.k) + '" aria-label="移除该条件"><svg class="i"><use href="#i-x"/></svg></button></span>';
        }).join('') + '<button type="button" class="clearall" data-fclear="1">清除全部</button>';
    }

    function render() {
        var rows = sorted(filtered());
        S.list = rows;
        S.rows = rows;
        var grid = $('#grid');
        grid.classList.remove('loading');

        if (S.view !== 'list') {
            /* R1/R2：平台货架（网格视图）。列表视图走下面的原路径，一行不改。 */
            win.on = false;
            grid.style.paddingTop = '';
            grid.style.paddingBottom = '';
            /* 已经在某个平台里（面包屑「媒体库 / 抖音」）时不再套货架：
             * 全部资源按平台分行是为了"分得清"，进了平台内页就只剩这一个平台，
             * 再套一层行头 + 「查看全部 33 项」等于让用户点进自己所在的地方。
             * 这里直接平铺，一屏看全。 */
            if (S.plat && S.plat !== 'all') {
                grid.className = 'shelves' + (S.select ? ' selecting' : '');
                grid.innerHTML = '<div class="shelf-line is-grid">' + rows.map(card).join('') + '</div>';
            } else {
                grid.className = 'shelves' + (S.select ? ' selecting' : '');
                grid.innerHTML = shelvesHTML(rows);
            }
            S.shown = rows.length;
        } else {
            grid.className = 'grid list' + (S.select ? ' selecting' : '');

            /* 小库：保持原路径（一次铺满，滚动追加），行为与以前完全一致 */
            if (rows.length <= WIN_THRESHOLD) {
                win.on = false;
                grid.style.paddingTop = '';
                grid.style.paddingBottom = '';
                S.shown = Math.min(PAGE, rows.length);
                grid.innerHTML = rows.slice(0, S.shown).map(card).join('');
            } else {
                /* 大库：先量列数/行高，再按窗口画 */
                win.on = true;
                win.cols = gridCols(grid);
                win.totalRows = Math.ceil(rows.length / win.cols);
                grid.style.paddingTop = '0px';
                grid.style.paddingBottom = '0px';
                if (!win.rowH) { win.rowH = 260; }       // 首次给个估值，画完立刻校正
                win.start = 0;
                win.end = Math.min(win.totalRows, Math.ceil((window.innerHeight || 800) / win.rowH) + WIN_OVERSCAN);
                paintWindow();
                var measured = measureRowH(grid);
                if (measured > 0 && Math.abs(measured - win.rowH) > 2) {
                    win.rowH = measured;
                    updateWindow(true);
                }
                S.shown = rows.length;
            }
        }
        var lh = $('#listhead');
        if (lh) { lh.classList.toggle('on', S.view === 'list'); }
        grid.classList.toggle('hidden', rows.length === 0);
        renderEmpty(rows.length);
        observeThumbs();

        var c = counts();
        var scope = countsInScope();
        var setTxt = function (sel, v) { var e = $(sel); if (e) { e.textContent = v; } };
        setTxt('#sCount', rows.length);
        setTxt('#sImg', c.image);
        setTxt('#sAnim', c.anim);
        setTxt('#sLive', c.live);
        setTxt('#sVid', c.video);
        setTxt('#fCount', rows.length);
        setTxt('#fSize', Math.round(rows.reduce(function (a, b) { return a + (b.size || 0); }, 0)) + ' MB');
        renderDedupStat(rows);
        renderSyncStatus();
        setTxt('#treeTotal', FILES.length);
        setTxt('#batchCount', '已选 ' + S.sel.size + ' 项');

        /* 类型 tab 的数字必须是「当前站点/搜索范围」内的，不是全库：
         * 否则选中「小红书」后上面还显示全库的「视频 29」，与卡片数量对不上。 */
        $$('#typeTabs button').forEach(function (b) {
            var t = b.dataset.type;
            var n = t === 'all' ? scope.all : (scope[t] || 0);
            var badge = b.querySelector('b'); if (badge) { badge.textContent = n; }
        });
        renderFavs();
        renderTags();
        setTxt('#fbCount', rows.length);
        syncFilterBar();
        renderActiveBar();
        syncHeader();
    }

    /* ---------- F7 分级加载（虚拟滚动轻量版） ---------- */
    function appendMore() {
        var rows = S.rows || [];
        if (!rows.length || S.shown >= rows.length) { return; }
        var grid = $('#grid');
        if (!grid) { return; }
        var next = Math.min(S.shown + PAGE, rows.length);
        var html = rows.slice(S.shown, next).map(card).join('');
        grid.insertAdjacentHTML('beforeend', html);
        S.shown = next;
        observeThumbs();
    }

    function nearBottom() {
        var grid = $('#grid');
        if (!grid) { return false; }
        var r = grid.getBoundingClientRect();
        return r.bottom - window.innerHeight < 600;
    }

    window.addEventListener('scroll', function () {
        if (win.on) { updateWindow(); return; }
        if (nearBottom()) { appendMore(); }
    }, { passive: true });

    window.addEventListener('resize', function () {
        if (!win.on) { return; }
        var grid = $('#grid');
        if (!grid) { return; }
        win.cols = gridCols(grid);
        win.totalRows = Math.ceil((S.rows || []).length / win.cols);
        var measured = measureRowH(grid);
        if (measured > 0) { win.rowH = measured; }
        updateWindow(true);
    });

    /* ---------- 索引状态：让「素材存全了没有」可回答 ----------
     * 旧实现把「2 分钟前扫描完成」写死在 library.html 里，全仓库没有任何 JS
     * 更新 #syncText —— 用户看到的时间永远不变，也看不到索引条数与待处理项。
     * 这里改成真实状态：已索引 N · 上次扫描 时间 · 待处理 M（未整理）。 */
    var LAST_SCAN = 0;

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    function fmtScanTime(ts) {
        var t = Number(ts) || 0;
        if (!t) { return ''; }
        var d = new Date(t);
        var now = new Date();
        var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
        if (d.toDateString() === now.toDateString()) { return '今天 ' + hm; }
        var y = new Date(now.getTime() - 86400000);
        if (d.toDateString() === y.toDateString()) { return '昨天 ' + hm; }
        var md = (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm;
        return d.getFullYear() === now.getFullYear() ? md : (d.getFullYear() + '-' + md);
    }

    function renderSyncStatus() {
        var el = $('#syncText');
        if (!el) { return; }
        var pending = 0;
        FILES.forEach(function (f) { if (f.untracked) { pending++; } });
        var txt = '已索引 ' + FILES.length;
        txt += LAST_SCAN ? ' · 上次扫描 ' + fmtScanTime(LAST_SCAN) : ' · 尚未扫描';
        if (pending) { txt += ' · 待处理 ' + pending; }
        el.textContent = txt;
        var note = el.closest ? el.closest('.scan-note') : null;
        if (note) {
            note.classList.toggle('stale', !LAST_SCAN);
            note.classList.toggle('pending', pending > 0);
            note.title = LAST_SCAN
                ? ('上次扫描：' + new Date(LAST_SCAN).toLocaleString() + (pending ? ('\n未整理素材：' + pending + ' 项') : ''))
                : '还没有完成过一次完整扫描';
        }
        /* 2026-11-14：越界条目必须让用户看得见（苏哥报的「上级目录的图也进了库」）。
         * 它们已经不在主页显示，但如果静默消失，用户会以为「东西丢了」；
         * 而它们确实不是库内素材。所以单独一行说明：有几条、怎么处理。
         *
         * 数据来自 VRIndex.status().outOfRoot，但**不能**在这里拉：
         * 本函数挂在 render() 里，每次搜索/筛选/切平台都会跑一次，
         * 而 status() 要 getAllFiles() 全表（万级条目时是明显的卡顿源）。
         * 所以改成：renderSyncStatus 只渲染缓存值，由 refreshRootScope() 在
         * 「加载完 / 扫描完」这类低频时机刷新一次。 */
        renderRootScopeWarn();
    }

    /** 越界条数缓存（只在页面生命周期内有效；扫描后由 refreshRootScope 刷新） */
    var ROOT_SCOPE_OUT = 0;

    /** 按缓存值渲染越界提示条（纯 DOM，不读库） */
    function renderRootScopeWarn() {
        var el = $('#syncText');
        if (!el) { return; }
        var warn = $('#rootScopeWarn');
        if (!warn) {
            var hostRow = el.closest ? el.closest('.ph-title-row') : null;
            if (!hostRow || !hostRow.parentNode) { return; }
            warn = document.createElement('div');
            warn.id = 'rootScopeWarn';
            warn.className = 'root-scope-warn hidden';
            /* 挂在标题行**之后**，不能塞进 .scan-note：
             * 那是 inline-flex 小字条，塞块级元素会把「已索引 N 项」挤成两行。 */
            hostRow.parentNode.insertBefore(warn, hostRow.nextSibling);
        }
        var n = Number(ROOT_SCOPE_OUT) || 0;
        if (!n) {
            warn.classList.add('hidden');
            warn.textContent = '';
            return;
        }
        warn.textContent = '另有 ' + n + ' 条素材在素材库文件夹之外，未计入资源库。' +
            '把文件移进素材库文件夹后再点「全量扫描」，它们就会收进来。';
        warn.classList.remove('hidden');
    }

    /** 刷新越界条数（低频，只在 load() 收尾时调用一次）。
     * 扫描/删除/移动最后都会走 load()，所以不必在每处重复调 ——
     * 放在一起既能覆盖这些场景，又不会在筛选热路径上全表扫描。 */
    function refreshRootScope() {
        try {
            if (!root.VRIndex || typeof root.VRIndex.status !== 'function') { return; }
            root.VRIndex.status().then(function (s) {
                ROOT_SCOPE_OUT = Number(s && s.outOfRoot) || 0;
                renderRootScopeWarn();
            }).catch(function () { /* 状态读不到就维持原值 */ });
        } catch (e) { /* 忽略 */ }
    }

    function readLastScan() {
        try {
            chrome.storage.local.get('vrLibSettings', function (o) {
                var s = (o && o.vrLibSettings) || {};
                LAST_SCAN = Number(s.lastScanAt) || 0;
                renderSyncStatus();
            });
        } catch (e) { renderSyncStatus(); }
    }

    async function recordScan() {
        LAST_SCAN = Date.now();
        renderSyncStatus();
        try {
            var s = await readLibSettings();
            s.lastScanAt = LAST_SCAN;
            s.indexedCount = FILES.length;
            chrome.storage.local.set({ vrLibSettings: s });
        } catch (e) { /* 记录失败不影响本次扫描结果 */ }
    }

    function showScan(msg, sub) {
        var el = $('#scanState');
        if (!el) { return; }
        el.classList.remove('hidden');
        var t = $('#scanText'); if (t) { t.textContent = msg || '正在扫描目录…'; }
        var s = $('#scanSub'); if (s) { s.textContent = sub || '正在读取文件列表…'; }
    }

    function hideScan() {
        var el = $('#scanState');
        if (el) { el.classList.add('hidden'); }
    }

    /* ---------- F5 去重统计：逻辑大小 vs 物理占用 ---------- */
    function renderDedupStat(rows) {
        var el = document.getElementById('fDedup');
        if (!el) { return; }
        var byHash = {};
        var logical = 0, physical = 0, refs = 0;
        rows.forEach(function (f) {
            logical += f.size || 0;
            if (f.sha256) {
                if (!byHash[f.sha256]) { byHash[f.sha256] = { size: f.size || 0, n: 0 }; }
                byHash[f.sha256].n++;
                if (f.isRef) { refs++; }
            } else {
                physical += f.size || 0;
            }
        });
        Object.keys(byHash).forEach(function (h) { physical += byHash[h].size; });
        if (!refs) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        el.textContent = '逻辑 ' + Math.round(logical) + ' MB · 物理 ' + Math.round(physical) + ' MB（' + refs + ' 条引用）';
    }

    /* ---------- 缩略图懒加载 ---------- */
    var io = null;
    function observeThumbs() {
        var nodes = $$('[data-thumb]');
        if (!('IntersectionObserver' in window)) {
            nodes.forEach(function (img) { var e = RAW[img.getAttribute('data-thumb')]; if (e && root.VRThumbs) { root.VRThumbs.enqueue(e); } });
            return;
        }
        if (io) { io.disconnect(); }
        io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting) { return; }
                var img = en.target;
                var e = RAW[img.getAttribute('data-thumb')];
                if (e && root.VRThumbs) { root.VRThumbs.enqueue(e); }
                io.unobserve(img);
            });
        }, { rootMargin: '200px' });
        nodes.forEach(function (img) { io.observe(img); });
    }

    window.addEventListener('vrthumb', function (ev) {
        var d = ev.detail || {};
        if (!d.blob) { return; }
        var url = URL.createObjectURL(d.blob);
        objUrls.push(url);
        $$('[data-thumb]').forEach(function (el) {
            if (el.getAttribute('data-thumb') !== d.relPath) { return; }
            el.src = url;
            el.classList.add('loaded');
        });
    });

    /* ---------- toast ---------- */
    var toastTimer = 0;
    /**
     * 提示条。action 可选：{ label, onClick, ms }
     * 删除后给「撤销」是防丢数据的关键：用户误删时第一反应是找撤销，
     * 只有「回收站」这条暗路的话，新用户会以为文件真没了。
     */
    function toast(msg, action) {
        var el = $('#toast');
        if (!el) { return; }
        var textEl = document.getElementById('toastText');
        var actEl = document.getElementById('toastAct');
        if (textEl) { textEl.textContent = msg; } else { el.textContent = msg; }
        if (actEl) {
            actEl.onclick = null;
            if (action && action.label) {
                actEl.textContent = action.label;
                actEl.hidden = false;
                actEl.onclick = function () {
                    el.classList.remove('on');
                    clearTimeout(toastTimer);
                    try { action.onClick(); } catch (e) { /* 忽略 */ }
                };
            } else {
                actEl.hidden = true;
            }
        }
        el.classList.add('on');
        clearTimeout(toastTimer);
        var ms = (action && action.ms) || (action ? 8000 : 2200);
        toastTimer = setTimeout(function () { el.classList.remove('on'); }, ms);
    }
    window.toast = toast;

    /* ---------- 删除回执（2026-11-10） ---------- */
    /**
     * VRTrash.remove() 不抛异常，失败放在 rr.failed 里。单条删除的三处入口
     * 以前都不看这个字段，一律 toast「已移入回收站」，于是出现
     * 「文件没搬走、卡片还在、回收站 0 项」却报成功 —— 苏哥说的「删除不了」
     * 有一半就是这个假回执。这里统一如实播报，并给「重试」入口。
     */
    function toastTrashResult(rr, okMsg, retry) {
        var failed = (rr && rr.failed) || [];
        if (!failed.length) { toast(okMsg || '已移入回收站'); return true; }
        var f0 = failed[0] || {};
        var short = String(f0.relPath || '').split('/').pop() || '该文件';
        var why = (f0.error === 'InvalidStateError' || f0.code === 11)
            ? '素材目录状态临时对不上，点「重试」再来一次；还不行去设置里重新授权素材目录'
            : (f0.message || f0.code || '未知原因');
        toast('删除失败：' + short +
            (failed.length > 1 ? ' 等 ' + failed.length + ' 项' : '') + '。' + why, {
                ms: 12000,
                label: typeof retry === 'function' ? '重试' : '',
                onClick: retry || null
            });
        return false;
    }

    async function retryTrashOne(relPath) {
        try {
            var rr = await root.VRTrash.remove([relPath]);
            await load(); await refreshDrawer();
            toastTrashResult(rr, '已移入回收站', function () { retryTrashOne(relPath); });
        } catch (e) {
            toast('重试失败：' + ((e && e.message) || '未知'));
        }
    }

    /* ---------- 数据加载 ---------- */
    /* ---------------- 历史作者 ID 污染自愈（2026-11-12） ----------------
     * 早期 B 站命名在探针之前算，拿不到 UP 主 mid，结果所有历史文件都挂上了
     * 同一个假 ID `(@360421127)`。B-72 已让新下载用真 ID；本轮把磁盘上的旧
     * 目录/文件名去掉这个假 ID，但库里 IndexedDB 的 relPath 还是旧值 ——
     * 不迁就会变成一批「文件缺失」死卡。
     * 做法：打开库页读到条目后，把含该标记的条目整条迁到新路径（星标、标签、
     * 指纹、来源全保留），再删旧主键。只认这一个已知污染标记，别的一律不碰。
     */
    var LEGACY_BAD_CREATOR = '(@360421127)';
    var LEGACY_BAD_MID = '360421127';
    var LEGACY_FIELDS = ['relPath', 'absPath', 'displayName', 'creatorFull', 'title',
                         'pageUrl', 'sourceUrl', 'mediaUrl', 'thumbKey'];

    function cleanLegacyCreatorText(v) {
        return typeof v === 'string' ? v.split(LEGACY_BAD_CREATOR).join('') : v;
    }

    /** 把一条历史记录映射成「去掉假 ID」的新记录（纯函数，单测覆盖） */
    function legacyCreatorRow(e) {
        var n = Object.assign({}, e || {});
        LEGACY_FIELDS.forEach(function (k) { n[k] = cleanLegacyCreatorText(n[k]); });
        if (String(n.creatorId || '') === LEGACY_BAD_MID) { n.creatorId = ''; }
        return n;
    }

    async function migrateLegacyCreatorPaths(list) {
        if (!root.VRDB || !list || !list.length) { return 0; }
        var bad = list.filter(function (e) {
            return e && e.relPath && String(e.relPath).indexOf(LEGACY_BAD_CREATOR) >= 0;
        });
        if (!bad.length) { return 0; }
        var adds = [], dels = [];
        bad.forEach(function (e) {
            adds.push(legacyCreatorRow(e));
            dels.push(e.relPath);
            // 本次渲染也用新值，别等下一次刷新才对得上
            LEGACY_FIELDS.forEach(function (k) { e[k] = cleanLegacyCreatorText(e[k]); });
            if (String(e.creatorId || '') === LEGACY_BAD_MID) { e.creatorId = ''; }
        });
        try {
            if (adds.length) { await root.VRDB.putFiles(adds); }
            if (dels.length) { await root.VRDB.deleteFiles(dels); }
            return dels.length;
        } catch (eM) { return 0; }   // 迁移失败绝不阻断渲染
    }

    async function load(retry, recheck) {
        if (!root.VRDB) { return; }
        var list = [];
        try {
            /* 大库（B-35）：先只取首屏那一页，避免上万条一次性铺进内存。
             * 小库走原来的全量读，行为完全不变。
             * 判据用 count()（O(1)），不看已加载条数——那正是我们要省掉的。 */
            var total = 0;
            try { total = await root.VRDB.count(); } catch (e0) { total = 0; }
            if (total > WIN_THRESHOLD && typeof root.VRDB.queryFiles === 'function') {
                list = await root.VRDB.queryFiles({ limit: PAGE });
            } else {
                list = await root.VRDB.getAllFiles();
            }
            /* 首屏可能撞上另一个标签正在重建索引：那一刻读到空表，
             * 之后数据回来了却没人再渲染 → 页面永远空白，只能手动重扫。
             * 读空时延迟复查一次，有数据就重新渲染（最多两级，不递归）。 */
            if (!list.length && !recheck) {
                setTimeout(function () {
                    try {
                        root.VRDB.getAllFiles().then(function (again) {
                            if (again && again.length) { load(0, true); }
                        }, function () { /* 仍失败就保持空态 */ });
                    } catch (e2) { /* 忽略 */ }
                }, 900);
            }
        } catch (e) {
            /* 别把读取失败当成「库里没有东西」：一次失败就永久空白，
             * 用户只能手动点重扫才看得到（2026-11-05 实测：4 个标签里 3 个空）。
             * 退避重试 3 次，仍失败才按空库处理。 */
            var n = Number(retry) || 0;
            if (n < 3) { setTimeout(function () { load(n + 1); }, 400 * (n + 1)); return; }
            list = [];
        }
        /* 磁盘已去掉历史假 ID，库里的旧 relPath 在这里一次性迁到新路径 */
        try { await migrateLegacyCreatorPaths(list); } catch (eMig) { /* 忽略 */ }
        /* 2026-11-14：落在库根之外的条目（state='outOfRoot'）不进主页。
         * 它们是「上级目录的素材被误收进库」留下的脏数据（苏哥报的那两张图）。
         * RAW 一并排除：否则收藏夹、灯箱相邻浏览、详情页还会从 RAW 里把它捞出来，
         * 表现成「主页看不见、收藏夹里点得到一张打不开的卡」。 */
        var isOutOfRoot = function (e) {
            var G = root.VRRootGuard;
            if (G && typeof G.isOutOfRoot === 'function') { return G.isOutOfRoot(e); }
            return !!(e && (e.state === 'outOfRoot' || e.outOfRoot));
        };
        list = list.filter(function (e) { return !isOutOfRoot(e); });
        RAW = {};
        list.forEach(function (e) { RAW[e.relPath] = e; });
        /* 2026-11-09：回收站条目在索引里保留行（state='trashed'），
         * 主页必须把它们过滤掉 —— 否则「删到回收站」之后卡片照旧在，
         * 用户会以为删除没生效。真源统一由 VRTrash.list() 读。 */
        FILES = list.filter(function (e) { return !root.VRTrash || e.state !== 'trashed'; })
            .map(toCardModel);
        markLivePairs(FILES);
        /* 收藏条目只保留仍在库里的 id；测试夹具/已删除文件不再占收藏夹。 */
        try {
            var changed = false;
            FAVS.forEach(function (fav) {
                var ids = (fav.ids || []).filter(function (id) { return !!RAW[id]; });
                if (ids.length !== (fav.ids || []).length) { fav.ids = ids; changed = true; }
            });
            if (changed) { saveFavs(); }
        } catch (e) { /* 忽略 */ }
        renderTree();
        render();
        renderRoot();
        /* 2026-11-14：越界条数只在「加载完」这种低频时机拉一次。
         * 不能放进 renderSyncStatus（那里随每次筛选跑），否则每次搜索都全表扫描。 */
        refreshRootScope();
    }

    function renderRoot() {
        var pathEl = $('#rootBtn .rb-path');
        var hintEl = $('#rootBtn .rb-hint');
        if (!pathEl) { return; }
        pathEl.textContent = '正在识别…';
        if (hintEl) { hintEl.textContent = '点击更换目录'; }
        try {
            chrome.storage.local.get('vrLibSettings', function (o) {
                var s = (o && o.vrLibSettings) || {};
                /* 自选文件夹可能没有绝对路径（FSA 只给句柄）：显示授权状态，
                 * 不要退回系统下载目录，也别写「未探测」吓用户。 */
                if (s.mode === 'custom') {
                    var cbase = s.customRoot ? String(s.customRoot).replace(/\//g, '\\') : '';
                    /* 浏览器只给句柄不给绝对路径：这时至少把**文件夹名**显示出来，
                     * 否则用户点了换目录、界面上什么都没变（还是一句「自选文件夹」），
                     * 会以为没生效。 */
                    pathEl.textContent = cbase || (s.customName ? s.customName : '自选文件夹（已授权）');
                    pathEl.title = cbase || ((s.customName ? s.customName + '\n' : '') + '浏览器不提供绝对路径，预览走目录授权');
                    return;
                }
                var base = s.detectedRoot ? s.detectedRoot + '\\' + (s.subdir || 'video-rod') : '';
                if (!base) {
                    pathEl.textContent = '系统下载目录\\' + (s.subdir || 'video-rod');
                    pathEl.title = '首次下载时自动创建';
                    return;
                }
                if (base) {
                    base = String(base).replace(/\//g, '\\');   // 统一成 Windows 反斜杠，别显示成 …/Downloads\video-rod
                    pathEl.textContent = base;
                    pathEl.title = base;
                }
            });
        } catch (e) { /* 非扩展环境 */ }
    }

    /* ---------- 全局兜底：别让「目录句柄失效」变成控制台红字 ----------
       陈旧的 FSA 句柄（换档案/换盘）会让 queryPermission / getDirectoryHandle
       抛 "Permissions check failed"。这类错误对用户没有意义，统一翻成一句可操作提示；
       其余异常不吞，照常抛出去（别掩盖真 bug）。 */
    function installGlobalErrorGuard() {
        function isPerm(msg) {
            return /Permissions check failed|not allowed to (read|write)|denied permission/i.test(String(msg || ''));
        }
        window.addEventListener('unhandledrejection', function (e) {
            var m = (e.reason && (e.reason.message || e.reason)) || '';
            if (isPerm(m)) {
                try { toast('目录授权已失效：到设置里重新选一次目录就能继续'); } catch (e2) { /* 忽略 */ }
                e.preventDefault();
            }
        });
        window.addEventListener('error', function (e) {
            if (isPerm(e && e.message)) {
                try { toast('目录授权已失效：到设置里重新选一次目录就能继续'); } catch (e2) { /* 忽略 */ }
            }
        });
    }

    /* ---------- 根目录自动探测（P2 前置） ----------
       根目录从来没被探测过时（vrLibSettings 只有 subdir），库页会一直显示「未探测」，
       索引也没有基准路径 → 容易把整个「下载」目录当成库。这里用最近的下载记录反推
       下载根目录，锁定到 <下载根>/<subdir>，和「校验落盘」算出来的口径一致。
       只写 detectedRoot，不动 mode/customRoot，用户显式设过自定义目录就不插手。 */
    function guessBaseFromDownloads(list, subdir) {
        var want = '/' + String(subdir || 'video-rod') + '/';
        var i;
        for (i = 0; i < list.length; i++) {
            var f = String((list[i] || {}).filename || '').replace(/\\/g, '/');
            var k = f.indexOf(want);
            if (k > 0) { return f.slice(0, k); }       // …/Downloads/video-rod/x → …/Downloads
        }
        /* 2026-11-08 修：这里原来有「拿最近任意一条下载的父目录当下载根」的兜底，
         * 结果把测试浏览器的 Webstore Downloads 当成了用户的下载目录，
         * 并持久化进 vrLibSettings.detectedRoot —— 用户看到默认下载文件夹被改。
         *
         * 为什么直接删掉兜底：`chrome.downloads` 不提供「系统默认下载目录」，
         * 只能从记录反推；而「任意一条下载」可能来自手动另存、临时目录、
         * 别的浏览器实例，完全不代表下载根。拿它当基准是猜测，不是事实。
         *
         * 正确做法：只认本扩展自己产物（路径里含 /<subdir>/）这一条硬证据。
         * 没有就返回空 → 设置页显示「未探测」，用户可以自己填，
         * 也绝不会把错误路径写进设置。 */
        return '';
    }

    function readLibSettings() {
        return new Promise(function (resolve) {
            try {
                chrome.storage.local.get('vrLibSettings', function (o) {
                    resolve((o && o.vrLibSettings) || {});
                });
            } catch (e) { resolve({}); }
        });
    }

    /**
     * 取「下载根目录」用于索引/缩略图拼绝对路径。
     *
     * 2026-11-08 苏哥定调：「不要写死！要相对路径！相对路径就是系统默认的下载文件夹，
     * 不同系统是不同的。」
     *
     * 因此这里不再把推导出的绝对路径写回 vrLibSettings：
     *   · 下载位置由浏览器/系统决定，chrome.downloads 的 filename 是相对路径，天然跨平台；
     *   · 绝对路径一旦持久化，换机器/换系统后会变成脏数据，
     *     还会被误读成「用户设置」，看起来像扩展改了他的下载文件夹。
     * 绝对路径只是一个可丢弃的推导结果，每次按需重算。
     *
     * 历史遗留的 s.detectedRoot 仍会被用作「候选」，但必须通过有效性校验。
     */
    async function ensureRoot() {
        var s = await readLibSettings();
        if ((s.mode || 'system') === 'custom' && s.customRoot) { return s; }

        /* 1) 优先：历史值（若仍在当前机器上说得通） */
        var legacy = String(s.detectedRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        if (legacy && isPlausibleRoot(legacy, s.subdir || 'video-rod')) {
            return Object.assign({}, s, { detectedRoot: legacy });
        }

        /* 2) 其次：从下载记录实时推导 */
        var list = await new Promise(function (resolve) {
            try {
                chrome.downloads.search({ limit: 50, orderBy: ['-startTime'] }, function (l) {
                    void chrome.runtime.lastError;
                    resolve(l || []);
                });
            } catch (e) { resolve([]); }
        });
        var base = guessBaseFromDownloads(list, s.subdir || 'video-rod');
        if (!base) { return Object.assign({}, s, { detectedRoot: '' }); }
        return Object.assign({}, s, { detectedRoot: base });
    }

    /**
     * 这个绝对路径在当前机器上说得通吗？
     *
     * 判据刻意保守——只拦「明显不该是下载根」的值，避免把用户的真实目录否掉：
     *   · 必须是绝对路径（盘符或 UNC / 以 / 开头）
     *   · 不能是浏览器 profile 内部目录（.../User Data/...、....edge-*）：
     *     那是浏览器自己的家目录，绝不该被当成用户下载位置
     *   · 不能是 Webstore Downloads 这类受管默认名（上次踩过的坑）
     */
    function isPlausibleRoot(p, subdir) {
        var G = root.VRRootGuard;
        var ok = (G && typeof G.isPlausibleDownloadRoot === 'function')
            ? G.isPlausibleDownloadRoot(p)
            : (function (v) {
                var s = String(v || '').replace(/\\/g, '/');
                if (!s) { return false; }
                if (!/^([A-Za-z]:\/|\/\/|\/)/.test(s)) { return false; }
                if (/\/(User Data|\.edge-[^/]+|Default)\//i.test(s + '/')) { return false; }
                if (/Webstore Downloads/i.test(s)) { return false; }
                return true;
            })(p);
        /* subdir 是这条判据的额外前提（app 侧要求「必须知道子目录名」） */
        return !!ok && !!subdir;
    }

    /**
     * 确保 vrLibSettings.detectedRoot 有值（跨浏览器/重装后的根路径自恢复）。
     *
     * 为什么必须有这一步（B-49，苏哥 2026-11-09 "换浏览器就认不出文件夹"）：
     *   库根的绝对路径只存在 vrLibSettings.detectedRoot 里，而它是**浏览器私有**的
     *   chrome.storage —— 换浏览器/重装扩展就没了。没有 absRoot 会连锁引发三件事：
     *     ① 全量扫描出来的条目 absPath 为空 →「打开文件夹」失效
     *     ② 写快照时 snapshotInner 直接抛「缺少资源库根目录」→ 跨浏览器恢复断链
     *     ③ 归档路径算不出来
     *   但路径其实可以从 chrome.downloads 反推：只要本浏览器下过任意一个落进
     *   <下载目录>/<subdir>/ 的文件，那条记录的 filename 就是绝对路径。
     *
     * 只写「反推出来的下载目录」，不动其它字段；已有值就原样返回。
     * @returns {Promise<string>} detectedRoot（拿不到返回空串）
     */
    async function ensureDetectedRoot() {
        var st = await new Promise(function (res) {
            try { chrome.storage.local.get('vrLibSettings', function (o) { res((o && o.vrLibSettings) || {}); }); }
            catch (e) { res({}); }
        });
        if (String(st.mode || 'system') === 'custom') { return ''; }   // 自选模式不写这个字段
        var cur = String(st.detectedRoot || '').trim();
        if (cur) { return cur; }

        var subdir = String(st.subdir || 'video-rod').replace(/^\/+|\/+$/g, '');
        var list = [];
        try {
            list = await new Promise(function (res) {
                chrome.downloads.search({ limit: 2000 }, function (l) {
                    res(chrome.runtime.lastError ? [] : (l || []));
                });
            });
        } catch (e) { list = []; }

        /* 从 <…>/<subdir>/… 里截出「下载目录」这一段（去掉 /subdir） */
        var sd = subdir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var pat = new RegExp('/' + sd + '/', 'i');
        var tally = {};
        list.forEach(function (d) {
            var p = String((d && d.filename) || '').replace(/\\/g, '/');
            var m = p.match(pat);
            if (!m) { return; }
            var base = p.slice(0, m.index);        // 去掉 /subdir/… 之后的下载目录
            if (base) { tally[base] = (tally[base] || 0) + 1; }
        });
        var keys = Object.keys(tally);
        if (!keys.length) { return ''; }
        keys.sort(function (a, b) { return tally[b] - tally[a]; });
        var root = keys[0];

        try {
            st.detectedRoot = root;
            st.detectedAt = Date.now();
            await new Promise(function (res) {
                chrome.storage.local.set({ vrLibSettings: st }, function () { res(); });
            });
        } catch (e) { /* 存不下去也不影响本次使用 */ }
        return root;
    }

    /* ---------- 首次自动索引 ---------- */
    /**
     * 扫描条目的统一入口（B-47，苏哥 2026-11-09 拍板「临时扫描 + 全量扫描」两个按钮）。
     *
     * mode:
     *   'quick' —— 临时扫描：下载记录 + 快照对账。秒级，不改磁盘现状，只补新下载的。
     *   'full'  —— 全量扫描：遍历整棵目录树，**磁盘为真相**。换浏览器/外部拷进来的
     *              素材靠这条才能进库；认不出站点的归「未整理」。
     *   'auto'  —— 首次进库时的自动降级链（老行为，保留）。
     *
     * 为什么要拆两个按钮：老实现只有一条 autoIndex 降级链
     * downloads → reconcile → full → snapshot，而 downloads 模式**几乎从不失败**
     * （它只需要 absRoot，不需要目录授权），所以永远在第一步就成功返回，
     * full/reconcile 根本没机会执行 —— 这就是「换浏览器后只认自己浏览器下过的」
     * 的根因（苏哥 2026-11-09 报的第三件事）。
     */
    async function runIndex(mode) {
        if (!root.VRIndex) { return { ok: false, reason: 'no-index' }; }

        /* 扫描前先把库根绝对路径补齐（跨浏览器/重装自恢复）。
         * 没有它：条目 absPath 为空、「打开文件夹」失效、写快照直接抛异常。 */
        try { await ensureDetectedRoot(); } catch (e) { /* 拿不到就用现有设置 */ }

        var showTxt = mode === 'full' ? '正在全量扫描文件夹…' : '正在快速扫描…';
        var showSub = mode === 'full'
            ? '正在遍历目录树，文件多时需要一会儿'
            : '正在读取下载记录与索引快照';
        showScan(showTxt, showSub);

        var onProgress = function (p) {
            if (!p) { return; }
            var s = $('#scanSub');
            if (!s) { return; }
            s.textContent = (p.phase === 'merge')
                ? ('正在合并索引 ' + (p.total || 0) + ' 项')
                : ('已发现 ' + (p.done || 0) + ' / ' + (p.total || 0));
        };

        var built = null, ok = false, err = null;
        if (mode === 'full') {
            /* 全量：直接走 full。失败时再退 snapshot（读上次落盘的索引） */
            try { built = await root.VRIndex.build({ mode: 'full', onProgress: onProgress }); ok = true; }
            catch (e1) {
                err = e1;
                try { built = await root.VRIndex.build({ mode: 'snapshot', onProgress: onProgress }); ok = true; err = null; }
                catch (e2) { err = e1; }
            }
        } else if (mode === 'quick') {
            /* 临时：下载记录优先，再试增量对账。两者都不需要遍历整棵树的语义。 */
            try { built = await root.VRIndex.build({ mode: 'downloads', onProgress: onProgress }); ok = true; }
            catch (e1) {
                try { built = await root.VRIndex.build({ mode: 'reconcile', onProgress: onProgress }); ok = true; }
                catch (e2) { err = e1; }
            }
        } else {
            /* auto：老降级链，保持原样（首次进库用） */
            try { built = await root.VRIndex.build({ mode: 'downloads', onProgress: onProgress }); ok = true; }
            catch (e1) {
                try { built = await root.VRIndex.build({ mode: 'reconcile', onProgress: onProgress }); ok = true; }
                catch (e2) {
                    try { built = await root.VRIndex.build({ mode: 'full', onProgress: onProgress }); ok = true; }
                    catch (e3) {
                        try { built = await root.VRIndex.build({ mode: 'snapshot', onProgress: onProgress }); ok = true; }
                        catch (e4) { err = e1; }
                    }
                }
            }
        }

        hideScan();
        try { reportTruncation(built); } catch (e) { /* 提示失败不影响索引 */ }
        if (ok) {
            await recordScan();
            /* 扫描完把索引写回磁盘（<根>/_library/index.json）。
             * 这一步是「换浏览器也能认」的关键：其它浏览器装着同一个扩展、
             * 授权到同一个文件夹后，读这份快照就能把整库恢复出来，
             * 而不必依赖各自浏览器私有的 chrome.downloads 历史（苏哥 2026-11-09 报的问题）。
             * 写失败不阻断扫描结果 —— 内存/IDB 里已经是新的了。 */
            try {
                if (root.VRIndex && typeof root.VRIndex.scheduleSnapshot === 'function') {
                    root.VRIndex.scheduleSnapshot(1200);
                }
            } catch (e) { /* 快照失败下次扫描再写 */ }
        }
        return { ok: ok, built: built, err: err };
    }

    async function autoIndex() {
        var r = await runIndex('auto');
        return !!r.ok;
    }

    /** 「临时扫描」按钮：秒级，只补新下载的 */
    async function scanQuick() {
        if (!root.VRIndex) { toast('索引模块未加载，请刷新页面'); return false; }
        var r = await runIndex('quick');
        if (!r.ok) {
            toast('快速扫描失败：' + indexErrText(r.err));
            return false;
        }
        await afterScanReset();
        var n = (r.built && r.built.total) || 0;
        toast('快速扫描完成：' + FILES.length + ' 项（本次识别 ' + n + ' 项）');
        return true;
    }

    /** 「全量扫描」按钮：遍历整棵树，磁盘为真相。
     *  换浏览器 / 从别处拷进来的素材，只有这条能把它们收进库。 */
    async function scanFull() {
        if (!root.VRIndex) { toast('索引模块未加载，请刷新页面'); return false; }
        var r = await runIndex('full');
        if (!r.ok) {
            var msg = indexErrText(r.err);
            /* 全量扫描需要一次目录授权：把原因说清，而不是甩一句「失败」 */
            toast('全量扫描失败：' + msg + '。若是首次使用，请在设置里「更换目录」授权一次文件夹', {
                label: '去授权', ms: 12000, onClick: openOptions
            });
            return false;
        }
        await afterScanReset();
        var n = (r.built && r.built.total) || 0;
        var un = 0;
        FILES.forEach(function (f) { if (f.untracked) { un++; } });
        toast('全量扫描完成：库内 ' + FILES.length + ' 项（本次识别 ' + n + ' 项'
            + (un ? '，其中 ' + un + ' 项未归类' : '') + '）');
        return true;
    }

    /** 扫描后的统一收尾：清筛选 + 重载 + 重绘左栏。
     *  不清筛选的话，旧关键词/平台还挂着，用户以为「没导入」（踩过）。 */
    async function afterScanReset() {
        S.q = ''; S.plat = 'all'; S.type = 'all';
        if ($('#search')) { $('#search').value = ''; }
        $$('#typeTabs button').forEach(function (x) { x.classList.toggle('active', x.dataset.type === 'all'); });
        await load();
        try { renderTree(); } catch (e) { /* 左栏重绘失败不影响主区 */ }
    }

    /** 把索引错误码翻成人话 */
    function indexErrText(e) {
        var code = '';
        try { code = (root.VRIndex && root.VRIndex.errCode) ? root.VRIndex.errCode(e) : ''; } catch (x) { code = ''; }
        var raw = (e && e.message) || '';
        if (code === 'LIB_E_NO_PERM') { return '没有文件夹读取权限'; }
        if (code === 'LIB_E_NO_SNAPSHOT') { return '还没有可用索引快照'; }
        if (code === 'LIB_E_ENOSPC') { return '磁盘空间不足'; }
        /* 2026-11-14：选到了上级目录 —— 必须说清「该选哪一层」，
         * 否则用户只会看到「目录层级不对」却不知道下一步怎么做。 */
        if (code === 'LIB_E_ROOT_LAYER') { return raw || '选择的文件夹不是素材库那一层'; }
        if (/LIB_E_NO_PERM|需要一次目录授权/.test(raw)) { return '没有文件夹读取权限'; }
        return raw || code || '未知原因';
    }

    /** 把「被上限截断」这件事如实告诉用户（B-34） */
    function reportTruncation(r) {
        if (!r || (!r.truncated && !r.depthLimited)) { return; }
        var msg = '已扫描 ' + (r.total || 0) + ' 项';
        if (r.skipped) { msg += '，另有 ' + r.skipped + ' 项因超出上限未纳入'; }
        if (r.depthLimited) { msg += '，部分深层目录未扫描'; }
        if (r.limit) { msg += '（上限 ' + r.limit.maxItems + ' 项 / ' + r.limit.maxDepth + ' 层）'; }
        toast(msg);
        try { console.warn('[vrLib] 索引被截断', r); } catch (e) { /* 忽略 */ }
    }

    /* ---------- 事件 ---------- */
    /* ---------- 确认框（模块级：bind 与 bindMissing 共用） ----------
     * 原实现把 ask() 定义在 bindMissing() 内部，而 batchTrash 在 bind() 里调用它，
     * 结果是「删除到回收站」点了抛 ReferenceError，界面毫无反应。 */
    var _confirmCb = null;
    function ask(msg, cb) {
        var m = document.getElementById('confirmMask');
        if (!m) { if (cb) { cb(); } return; }
        var t = document.getElementById('confirmMsg');
        if (t) { t.textContent = msg; }
        _confirmCb = cb;
        m.classList.add('show');
    }
    function closeAsk() {
        var m = document.getElementById('confirmMask');
        if (m) { m.classList.remove('show'); }
        _confirmCb = null;
    }
    function bindConfirm() {
        var ok = document.getElementById('confirmOk');
        var cancel = document.getElementById('confirmCancel');
        if (cancel) { cancel.addEventListener('click', closeAsk); }
        if (ok) {
            ok.addEventListener('click', function () {
                var cb = _confirmCb;
                closeAsk();
                if (cb) { cb(); }
            });
        }
    }

    function bind() {
        var tt = $('#typeTabs');
        if (tt) {
            tt.addEventListener('click', function (e) {
                var b = e.target.closest('button'); if (!b) { return; }
                $$('#typeTabs button').forEach(function (x) { x.classList.remove('active'); });
                b.classList.add('active'); S.type = b.dataset.type; render();
            });
        }
        var vt = $('#viewToggle');
        if (vt) {
            vt.addEventListener('click', function (e) {
                var b = e.target.closest('button'); if (!b) { return; }
                $$('#viewToggle button').forEach(function (x) { x.classList.remove('active'); });
                b.classList.add('active'); S.view = b.dataset.view; render();
            });
        }
        var search = $('#search');
        if (search) {
            /* 每敲一个字符就全量重渲染：5000 条时实测 64ms/键，连续打字明显掉帧；
             * 中文输入法组字时每个拼音都会触发，更糟。
             * 这里做两件事：① 150ms 防抖；② 组字期间不渲染，compositionend 再补。 */
            var qTimer = 0;
            var composing = false;
            var clearBtn = document.getElementById('searchClear');
            var syncClear = function () {
                if (clearBtn) { clearBtn.hidden = !search.value; }
            };
            var apply = function () {
                clearTimeout(qTimer);
                qTimer = 0;
                S.q = search.value.trim().toLowerCase();
                syncClear();
                render();
            };
            search.addEventListener('compositionstart', function () {
                composing = true;
                clearTimeout(qTimer);
            });
            search.addEventListener('compositionend', function () {
                composing = false;
                apply();
            });
            search.addEventListener('input', function () {
                if (composing) { return; }
                /* 清除按钮即时反映输入内容，不等防抖 */
                syncClear();
                clearTimeout(qTimer);
                /* 后台标签页的 setTimeout 会被浏览器节流到 ~1s，防抖反而变成延迟。
                 * 页面不可见时没有「打字掉帧」问题，直接同步渲染最稳。 */
                if (document.hidden) { apply(); return; }
                qTimer = setTimeout(apply, 150);
            });
            /* 清除按钮：一次点击回到「全部」 */
            if (clearBtn) {
                clearBtn.addEventListener('click', function () {
                    search.value = '';
                    S.q = '';
                    clearTimeout(qTimer);
                    syncClear();
                    render();
                    search.focus();
                });
            }
            /* Esc 清空并立即生效（用户按 Esc 时期望马上看到全部） */
            search.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && search.value) {
                    e.preventDefault();
                    search.value = '';
                    S.q = '';
                    clearTimeout(qTimer);
                    syncClear();
                    render();
                }
            });
            syncClear();
        }
        var sort = $('#sort');
        if (sort) {
            if (sort.value) { S.sort = sort.value; }
            sort.addEventListener('change', function () {
                S.sort = sort.value || 'new';
                render();
            });
        }
        /* B-63（2026-11-09）：原生 select 弹层无法着色（系统渲染），改为隐藏原生 + 自绘下拉。
           自绘只负责把 value 写回原生控件并派发 change —— 上面的排序逻辑一行没改。 */
        (function bindSortDD() {
            var dd = document.getElementById('sortDD');
            if (!dd || !sort) { return; }
            var btn = document.getElementById('sortBtn');
            var menu = document.getElementById('sortMenu');
            var label = document.getElementById('sortLabel');
            if (!btn || !menu || !label) { return; }
            var sync = function () {
                var opts = menu.querySelectorAll('button[data-sort]');
                for (var i = 0; i < opts.length; i++) {
                    var on = opts[i].getAttribute('data-sort') === sort.value;
                    opts[i].classList.toggle('on', on);
                    if (on) { label.textContent = opts[i].textContent.trim(); }
                }
            };
            var close = function () {
                menu.classList.add('hidden'); dd.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
            };
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var open = menu.classList.contains('hidden');
                menu.classList.toggle('hidden', !open);
                dd.classList.toggle('open', open);
                btn.setAttribute('aria-expanded', String(open));
            });
            menu.addEventListener('click', function (e) {
                var b = e.target.closest('button[data-sort]');
                if (!b) { return; }
                sort.value = b.getAttribute('data-sort');
                sort.dispatchEvent(new Event('change'));
                close();
                sync();
            });
            document.addEventListener('click', function (e) {
                if (!e.target.closest('#sortDD')) { close(); }
                /* R3：面包屑「媒体库」在 pagehead 里，不属于 #grid，需要文档级委托才能回到全部。 */
                if (e.target.closest('[data-crumb-all]')) {
                    e.preventDefault();
                    S.plat = 'all';
                    render();
                    renderTree();
                }
            });
            sync();
        })();

        /* R4/R5（2026-11-09）：筛选条 chips + 已选条件栏的增删（时间窗 chips 2026-11-10 删除） */
        var starBtn = $('#starFilterBtn');
        if (starBtn) {
            starBtn.addEventListener('click', function () { S.starOnly = !S.starOnly; render(); });
        }
        var abar = $('#activebar');
        if (abar) {
            abar.addEventListener('click', function (e) {
                var del = e.target.closest('[data-fdel]');
                if (del) {
                    var k = del.getAttribute('data-fdel');
                    if (k === 'type') { S.type = 'all'; }
                    else if (k === 'star') { S.starOnly = false; }
                    else if (k === 'plat') { S.plat = 'all'; }
                    else if (k === 'q') { S.q = ''; if ($('#search')) { $('#search').value = ''; } }
                    else if (k.indexOf('tag:') === 0) {
                        var t = k.slice(4);
                        S.tags = S.tags.filter(function (x) { return x !== t; });
                    }
                    else if (k === 'size') { S.size = 'all'; }
                    else if (k === 'res') { S.res = 'all'; }
                    else if (k.indexOf('author:') === 0) {
                        var aa = k.slice(7);
                        S.authors = (S.authors || []).filter(function (x) { return x !== aa; });
                    }
                    render(); renderTree(); return;
                }
                if (e.target.closest('[data-fclear]')) {
                    S.type = 'all'; S.starOnly = false; S.plat = 'all'; S.q = ''; S.tags = [];
                    S.size = 'all'; S.res = 'all'; S.authors = [];
                    if ($('#search')) { $('#search').value = ''; }
                    render(); renderTree();
                }
            });
        }

        /* R6（2026-11-09）：更多筛选——大小 / 分辨率 / 标签 / 作者。
         * 2026-11-10 苏哥：从右侧抽屉改为居中弹窗，与设置弹窗统一页面语言；作者支持搜索过滤。 */
        var filtAuthorQ = '';
        function renderFilt() {
            var body = $('#filtBody');
            if (!body) { return; }
            var SZ = [['all', '不限'], ['lt1', '< 1 MB'], ['1to10', '1–10 MB'], ['10to100', '10–100 MB'], ['gt100', '> 100 MB']];
            var RS = [['all', '不限'], ['4k', '4K 及以上'], ['fhd', '1080p 及以上'], ['portrait', '竖构图']];
            var tags = [], authors = [];
            FILES.forEach(function (f) {
                (Array.isArray(f.tags) ? f.tags : []).forEach(function (t) {
                    t = String(t || '').trim();
                    if (t && tags.indexOf(t) < 0) { tags.push(t); }
                });
                if (f.author && authors.indexOf(f.author) < 0) { authors.push(f.author); }
            });
            /* 作者搜索：只过滤候选，不动已选 */
            var filteredAuthors = authors;
            if (filtAuthorQ) {
                var q2 = String(filtAuthorQ).toLowerCase();
                filteredAuthors = authors.filter(function (a) { return String(a).toLowerCase().indexOf(q2) >= 0; });
            }
            var chips = function (list, cur, attr, labelFn) {
                var isPair = function (x) { return Object.prototype.toString.call(x) === '[object Array]'; };
                return list.map(function (x) {
                    /* 注意：不能用 x[0] 判断数组——字符串取下标同样有值，
                     * 会把「影视飓风」当成数组取成单字「影」（2026-11-09 实测踩到）。 */
                    var pair = isPair(x);
                    var v = pair ? x[0] : x;
                    var text = pair ? x[1] : (labelFn ? labelFn(x) : x);
                    var on = pair ? (cur === v) : ((cur || []).indexOf(v) >= 0);
                    return '<button type="button" class="fchip' + (on ? ' on' : '') + '" ' + attr + '="' + esc(v) + '">' + esc(text) + '</button>';
                }).join('');
            };
            var grin = function (ico, title, sub) {
                return '<h4><svg class="i fg-ico"><use href="#' + ico + '"/></svg>' + title +
                    (sub ? ' <span class="fg-sub">' + sub + '</span>' : '') + '</h4>';
            };
            body.innerHTML =
                '<div class="fg">' + grin('i-hard-drive', '大小') + '<div class="chips">' + chips(SZ, S.size, 'data-fsize') + '</div></div>' +
                '<div class="fg">' + grin('i-image', '分辨率') + '<div class="chips">' + chips(RS, S.res, 'data-fres') + '</div></div>' +
                '<div class="fg">' + grin('i-tag', '标签', '可多选 · 取交集') + '<div class="chips">' +
                    (tags.length ? chips(tags, S.tags || [], 'data-ftag') : '<span class="fg-empty">还没有标签</span>') +
                '</div></div>' +
                '<div class="fg">' +
                    '<div class="fg-head">' + grin('i-user', '作者', '可多选') +
                        '<input type="text" id="filtAuthorQ" class="sm-input fg-search" placeholder="筛作者…" spellcheck="false" value="' + esc(filtAuthorQ) + '">' +
                    '</div><div class="chips" id="filtAuthorChips">' +
                    (filteredAuthors.length ? chips(filteredAuthors, S.authors || [], 'data-fauthor', function (a) { return String(a).split(' @')[0].slice(0, 14); }) : '<span class="fg-empty">没有匹配的作者</span>') +
                '</div></div>';
            var hit = $('#filtHit');
            if (hit) { hit.textContent = filtered().length; }
        }
        function openFilt() {
            renderFilt();
            var m = $('#filtMask'), d = $('#filtModal');
            if (m) { m.classList.add('show'); }
            if (d) { d.classList.add('show'); }
        }
        function closeFilt() {
            var m = $('#filtMask'), d = $('#filtModal');
            if (m) { m.classList.remove('show'); }
            if (d) { d.classList.remove('show'); }
        }
        var moreBtn = $('#moreFilterBtn');
        if (moreBtn) { moreBtn.addEventListener('click', openFilt); }
        var fClose = $('#filtClose'), fDone = $('#filtDone'), fMask = $('#filtMask');
        if (fClose) { fClose.addEventListener('click', closeFilt); }
        if (fDone) { fDone.addEventListener('click', closeFilt); }
        if (fMask) { fMask.addEventListener('click', closeFilt); }
        var fClear = $('#filtClear');
        if (fClear) {
            fClear.addEventListener('click', function () {
                S.size = 'all'; S.res = 'all'; S.authors = []; filtAuthorQ = '';
                renderFilt(); render(); syncFilterBar();
            });
        }
        /* 作者搜索：只过滤候选列表，不动已选；输入时重渲染作者 chips */
        var fBody = $('#filtBody');
        if (fBody) {
            fBody.addEventListener('input', function (e) {
                if (e.target && e.target.id === 'filtAuthorQ') {
                    filtAuthorQ = e.target.value;
                    var pos = e.target.selectionStart;
                    renderFilt();
                    var el2 = $('#filtAuthorQ');
                    if (el2) { el2.focus(); try { el2.setSelectionRange(pos, pos); } catch (e2) { /* 忽略 */ } }
                }
            });
            fBody.addEventListener('click', function (e) {
                var b = e.target.closest('[data-fsize],[data-fres],[data-ftag],[data-fauthor]');
                if (!b) { return; }
                if (b.dataset.fsize !== undefined) { S.size = b.dataset.fsize; }
                else if (b.dataset.fres !== undefined) { S.res = b.dataset.fres; }
                else if (b.dataset.ftag !== undefined) {
                    var t = b.dataset.ftag, i = (S.tags || []).indexOf(t);
                    if (i >= 0) { S.tags.splice(i, 1); } else { S.tags.push(t); }
                } else if (b.dataset.fauthor !== undefined) {
                    var a = b.dataset.fauthor, j = (S.authors || []).indexOf(a);
                    if (j >= 0) { S.authors.splice(j, 1); } else { S.authors.push(a); }
                }
                renderFilt(); render(); syncFilterBar();
            });
        }

        var sb = $('#selectBtn');
        if (sb) {
            sb.addEventListener('click', function () {
                S.select = !S.select; S.sel.clear();
                sb.classList.toggle('is-on', S.select);
                var bb = $('#batchbar'); if (bb) { bb.classList.toggle('hidden', !S.select); }
                render();
            });
        }
        var on = function (id, fn) { var el = document.getElementById(id); if (el) { el.addEventListener('click', fn); } };
        on('batchClear', function () { S.sel.clear(); render(); });
        on('batchAll', function () { S.list.forEach(function (f) { S.sel.add(f.id); }); render(); });
        on('batchInvert', function () {
            var nx = new Set(); S.list.forEach(function (f) { if (!S.sel.has(f.id)) { nx.add(f.id); } }); S.sel = nx; render();
        });
        /* 批量条「按类型…」：想「只删视频」时不必手点每张卡片。
         * 语义是「在已选基础上追加该类型」，清空选择请用「清除」按钮。 */
        var byType = document.getElementById('batchByType');
        if (byType) {
            byType.addEventListener('change', function () {
                var k = byType.value;
                byType.value = '';
                if (!k) { return; }
                var n = 0;
                S.list.forEach(function (f) {
                    if (f.kind === k) { S.sel.add(f.id); n++; }
                });
                render();
                toast(n ? ('已按类型选中 ' + n + ' 项') : '当前列表里没有这类素材');
            });
        }
        /* B-63：批量「按类型…」同样换成自绘下拉（原生弹层白底不可着色）。 */
        (function bindBatchTypeDD() {
            var dd = document.getElementById('batchDD');
            if (!dd || !byType) { return; }
            var btn = document.getElementById('batchBtn');
            var menu = document.getElementById('batchMenu');
            if (!btn || !menu) { return; }
            var close = function () {
                menu.classList.add('hidden'); dd.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
            };
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var open = menu.classList.contains('hidden');
                menu.classList.toggle('hidden', !open);
                dd.classList.toggle('open', open);
                btn.setAttribute('aria-expanded', String(open));
            });
            menu.addEventListener('click', function (e) {
                var b = e.target.closest('button[data-bt]');
                if (!b) { return; }
                byType.value = b.getAttribute('data-bt');
                byType.dispatchEvent(new Event('change'));
                close();
            });
            document.addEventListener('click', function (e) {
                if (!e.target.closest('#batchDD')) { close(); }
            });
        })();
        on('batchExit', function () {
            S.select = false; S.sel.clear();
            $('#selectBtn').classList.remove('is-on');
            $('#batchbar').classList.add('hidden'); render();
        });
        on('batchTrash', async function () {
            /* 原实现是「批量删除将在 R5 接入真实回收站」的假按钮，但回收站（js/library/trash.js）
             * 早就做完了 —— 单条删除走的是它，批量却只弹一句提示。这里直接接同一套 API。 */
            if (S.batchBusy) { return; }
            var list = FILES.filter(function (f) { return S.sel.has(f.id); });
            if (!list.length) { toast('先选素材'); return; }
            markWritePending();
            if (!(await ensureWriteAccess())) { return; }
            ask('把选中的 ' + list.length + ' 项移入回收站？文件还能恢复。', async function () {
                if (!root.VRTrash) { toast('回收站模块没加载'); return; }
                /* 批量操作期间锁住按钮：没有进行中状态时用户会以为卡死并重复点击，
                 * 结果弹出多个确认框、重复删除同一批。 */
                S.batchBusy = true;
                var btn = document.getElementById('batchTrash');
                if (btn) { btn.disabled = true; }
                try {
                    toast('正在移入回收站 0/' + list.length + '…', { ms: 600000 });
                    /* 逐条拿结果：批量里有些是「文件已不存在」被清理（cleaned），
                     * 不该混进「已删除 N 项」里虚报。 */
                    var rr = await root.VRTrash.remove(list.map(function (f) { return f.relPath; }), {
                        onProgress: function (p) {
                            if (!p) { return; }
                            if (p.done === 1 || p.done % 5 === 0 || p.done === p.total) {
                                toast('正在移入回收站 ' + p.done + '/' + p.total + '…', { ms: 600000 });
                            }
                        }
                    });
                    S.sel.clear(); S.select = false;
                    await load(); await refreshDrawer();
                    var movedN = (rr && rr.moved) || 0;
                    var failedN = (rr && rr.failed && rr.failed.length) || 0;
                    var msg = '已移入回收站：' + movedN + ' 项';
                    if (failedN) {
                        /* 失败不能只说个数：用户不知道是哪几条，也就无从处理。 */
                        var names = (rr.failed || []).slice(0, 2).map(function (x) {
                            return String(x.relPath || '').split('/').pop();
                        }).filter(Boolean);
                        msg += '，失败 ' + failedN + ' 项' + (names.length ? '（' + names.join('、') + (failedN > 2 ? ' 等' : '') + '）' : '');
                    }
                    if (rr && rr.batch && movedN > 0) {
                        toast(msg, {
                            label: '撤销', ms: 8000,
                            onClick: async function () {
                                try {
                                    await root.VRTrash.restore(rr.batch);
                                    toast('已撤销删除（' + movedN + ' 项）');
                                    await load(); await refreshDrawer();
                                } catch (e2) { toast('撤销失败：' + ((e2 && e2.message) || '未知')); }
                            }
                        });
                    } else {
                        toast(msg);
                    }
                } catch (e) {
                    toast('批量删除失败：' + ((e && e.message) || '未知'));
                } finally {
                    S.batchBusy = false;
                    if (btn) { btn.disabled = false; }
                }
            });
        });

        var grid = $('#grid');
        if (grid) {
            grid.addEventListener('click', function (e) {
                /* R3：货架行头「查看全部 N 项 →」与面包屑「媒体库」的点击必须先于卡片判断——
                 * 这两个目标都不在 .card 里，被下面的 early-return 拦掉的话点了没反应。 */
                var shelfOpen = e.target.closest('[data-shelf-open]');
                if (shelfOpen) {
                    e.preventDefault();
                    S.plat = shelfOpen.getAttribute('data-shelf-open');
                    S.q = ''; S.type = 'all';
                    if ($('#search')) { $('#search').value = ''; }
                    $$('#typeTabs button').forEach(function (x) {
                        x.classList.toggle('active', x.dataset.type === 'all');
                    });
                    render();
                    renderTree();
                    return;
                }
                var c = e.target.closest('.card'); if (!c) { return; }
                var id = c.dataset.id;
                /* 引用角标是唯一一个「不打开素材、只看同内容来源」的入口：
                 * 角标本身就在卡片里，必须先于卡片点击拦截，否则会被当成打开预览。 */
                if (e.target.closest('[data-refs]')) {
                    e.preventDefault();
                    var rf = FILES.find(function (f) { return f.id === id; });
                    if (!rf) { return; }
                    openPreview(rf);
                    setTimeout(function () {
                        var d = document.getElementById('pvRefFold');
                        if (!d) { return; }
                        d.open = true;
                        try { d.scrollIntoView({ block: 'nearest' }); } catch (err) { /* ignore */ }
                    }, 40);
                    return;
                }
                /* 卡片星号按钮已随 B-54 删除，data-star 分支一并移除；
                 * starCard() 仍由键盘 S 与详情页 .pv-star 调用。 */
                /* 站点徽标 = 快捷筛选：点「花瓣」直接只看花瓣的素材。
                 * 比先去左侧树里找节点快一步，且卡片和左栏口径完全一致。 */
                var badgeEl = e.target.closest('[data-site]');
                if (badgeEl) {
                    e.preventDefault();
                    var sk = badgeEl.getAttribute('data-site');
                    if (sk) {
                        S.plat = (S.plat === sk) ? 'all' : sk;
                        S.q = ''; S.type = 'all';
                        if ($('#search')) { $('#search').value = ''; }
                        $$('#typeTabs button').forEach(function (x) {
                            x.classList.toggle('active', x.dataset.type === 'all');
                        });
                        render();
                        renderTree();
                    }
                    return;
                }
                if (S.select) {
                    if (S.sel.has(id)) { S.sel.delete(id); } else { S.sel.add(id); }
                    render(); return;
                }
                /* 胶片条跟随「当前所在分组」而不是整个媒体库：
                 * 在「全部资源」里点开 X 的一张图，底部却排出抖音的舞蹈视频，
                 * 上下文会断。货架视图里一张卡属于哪个平台行，就用那个平台的全部素材做序列
                 * （不止行内可见的 12 张）；列表视图保持原来的 S.list 行为。 */
                var line = c.closest('.shelf-line');
                var scopeList = null;
                if (line) {
                    var sec = line.closest('.shelf');
                    var sk = sec ? sec.getAttribute('data-shelf') : '';
                    if (sk) {
                        scopeList = (S.rows || []).filter(function (x) { return (x.plat || 'web') === sk; });
                    }
                }
                openPreview(FILES.find(function (f) { return f.id === id; }), scopeList);
            });
        }

        var tree = $('#tree');
        if (tree) {
            tree.addEventListener('click', function (e) {
                var n = e.target.closest('.tree-node'); if (!n) { return; }
                if (!n.dataset.plat && !n.dataset.author && !n.dataset.group) {
                    /* 根节点「全部资源」= 回到全库视图。
                     * 2026-11-08 修：原来只清 q/plat/type，漏了 S.fav ——
                     * 收藏筛选还挂着时点「全部资源」，列表仍是收藏里的几条，
                     * 用户看到的就是「点了没反应 / 库坏了」。
                     * 标签筛选同样属于「范围」，一并清掉。 */
                    S.q = ''; S.plat = 'all'; S.type = 'all'; S.fav = null; S.tags = [];
                    if ($('#search')) { $('#search').value = ''; }
                    $$('#typeTabs button').forEach(function (x) {
                        x.classList.toggle('active', x.dataset.type === 'all');
                    });
                    render();
                    renderTree();
                    return;
                }
                if (n.dataset.group === 'others') {
                    /* 「其他站点」只负责展开/收起，不做筛选：
                     * 它不是一个真实站点，点它却筛出全部长尾会很反直觉。 */
                    treeOpen.__others__ = !treeOpen.__others__;
                    renderTree();
                    return;
                }
                if (n.dataset.plat) {
                    var p = n.dataset.plat;
                    treeOpen[p] = !treeOpen[p];
                    /* 左侧平台节点也是筛选入口：旧代码只展开/收起，不写 S.plat，
                     * 用户点平台看起来毫无反应（只有顶部 chip 能筛）。
                     * 切平台属于「换一个范围」，收藏/标签筛选必须一起清掉，
                     * 否则「收藏里的微博」这类组合会让列表莫名其妙变空。 */
                    S.plat = (S.plat === p) ? 'all' : p;
                    S.q = '';
                    S.fav = null;
                    S.tags = [];
                    if ($('#search')) { $('#search').value = ''; }
                    render();
                    renderTree();
                    return;
                }
                $$('.tree-node').forEach(function (x) { x.classList.remove('active'); });
                n.classList.add('active');
                if (n.dataset.author) {
                    S.q = n.dataset.author.toLowerCase();
                    /* 必须同时把平台切到作者所属站点（2026-11-08 苏哥反馈：点作者后列表空了）。
                     * 原来只写搜索词，平台筛选还停在上一次的状态，
                     * 「微博」+「YouTube 作者名」叠加必然 0 条。
                     * 作者节点自带 data-author-plat，直接用它的分组键。 */
                    var ap = n.dataset.authorPlat || '';
                    if (ap) {
                        S.plat = ap;
                        treeOpen[ap] = true;   // 保证重绘后作者节点仍然展开可见
                    }
                    if ($('#search')) { $('#search').value = n.dataset.author; }
                    render();
                    /* 左栏跟着刷新：平台节点高亮、作者节点高亮都依赖 S.plat / S.q，
                     * 不重绘的话用户看到的还是点击前的状态（看起来「点了没反应」）。 */
                    renderTree();
                }
            });
        }
        var ts = $('#treeSearch');
        if (ts) { ts.addEventListener('input', renderTree); }

        on('rescanBtn', function () {
            /* 快速扫描：只补新下载的（下载记录 + 快照对账），秒级。
             * 不做全量遍历 —— 大目录全量扫一遍很慢，日常刷新用这个就够。 */
            scanQuick();
        });
        on('rescanFullBtn', function () {
            /* 全量扫描：磁盘为真相。换浏览器 / 从别处拷进来的素材靠这条进库，
             * 认不出站点的归「未整理」（苏哥 2026-11-09 明确要的两个入口）。 */
            scanFull();
        });
        /* ---- 设置弹窗（2026-11-10 苏哥：抽屉改居中弹窗，保存才生效并关闭；
           第二轮按使用频率重排——视频合并/图片行为置顶，低频保存位置整组删除） ---- */
        var LIB_SETTINGS_KEY = 'vrLibSettings';
        /* 独立键开关（chrome.storage.sync，以 id 为键——与 options 页同一套） */
        var SYNC_SWITCHES = ['M3u8Mp4', 'M3u8Ffmpeg'];
        function showSet(on) {
            var m = $('#setModal'), mk = $('#setmask');
            if (m) { m.classList.toggle('show', on); }
            if (mk) { mk.classList.toggle('show', on); }
        }
        function setSegVal(segId, v) {
            var seg = $('#' + segId);
            if (!seg) { return; }
            Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
                b.classList.toggle('active', String(b.getAttribute('data-v') || b.getAttribute('data-mode')) === String(v));
            });
        }
        function fillSetForm() {
            /* ① 库设置（vrLibSettings 合并键：图片行为 + 落盘校验） */
            try {
                chrome.storage.local.get(LIB_SETTINGS_KEY, function (o) {
                    var st = (o && o[LIB_SETTINGS_KEY]) || {};
                    var dv = $('#smDeepVerify');
                    if (dv) { dv.checked = !!st.deepVerify; }
                    var hv = $('#smImgHover');
                    if (hv) { hv.checked = !!st.imgHover; }
                    var bt = $('#smImgBatch');
                    if (bt) { bt.checked = !!st.imgBatch; }
                    setSegVal('smImgMinSeg', Number(st.imgMinSize) || 0);
                });
            } catch (e) { /* 存储不可用时保持默认展示 */ }
            /* ② 独立 sync 开关（M3u8Mp4 / M3u8Ffmpeg） */
            try {
                chrome.storage.sync.get(SYNC_SWITCHES, function (o) {
                    var mp4 = $('#smM3u8Mp4');
                    if (mp4) { mp4.checked = !!(o && o.M3u8Mp4); }
                    var ff = $('#smM3u8Ffmpeg');
                    /* ffmpeg 默认开：未写过该键时按 true 展示 */
                    if (ff) { ff.checked = !(o && o.M3u8Ffmpeg === false); }
                });
            } catch (e) { /* 忽略 */ }
            refreshDrawer();
        }
        function saveSet() {
            var seg = $('#smImgMinSeg');
            var act = seg ? seg.querySelector('button.active') : null;
            var patch = {
                deepVerify: !!(($('#smDeepVerify') || {}).checked),
                imgHover: !!(($('#smImgHover') || {}).checked),
                imgBatch: !!(($('#smImgBatch') || {}).checked),
                imgMinSize: act ? Number(act.getAttribute('data-v')) || 0 : 0
            };
            var syncPatch = {
                M3u8Mp4: !!(($('#smM3u8Mp4') || {}).checked),
                M3u8Ffmpeg: !!(($('#smM3u8Ffmpeg') || {}).checked)
            };
            try {
                /* 库设置：先读再合并，防抹掉别的键 */
                chrome.storage.local.get(LIB_SETTINGS_KEY, function (o) {
                    var cur = Object.assign({}, (o && o[LIB_SETTINGS_KEY]) || {}, patch);
                    var obj = {};
                    obj[LIB_SETTINGS_KEY] = cur;
                    chrome.storage.local.set(obj, function () {
                        try {
                            chrome.storage.sync.set(syncPatch, function () {
                                toast('设置已保存');
                                showSet(false);
                                try { load(); } catch (e) { /* 忽略 */ }
                            });
                        } catch (e) {
                            toast('设置已保存（部分开关未能写入）');
                            showSet(false);
                        }
                    });
                });
            } catch (e) { toast('保存失败：' + ((e && e.message) || e)); }
        }
        on('settingsBtn', function () { showSet(true); fillSetForm(); });
        on('setClose', function () { showSet(false); });
        on('setCancel', function () { showSet(false); });
        on('setmask', function () { showSet(false); });
        on('setSave', saveSet);
        /* 弹窗内 seg 通用切换（图片最小尺寸档等） */
        Array.prototype.forEach.call(document.querySelectorAll('#setModal .sm-seg'), function (seg) {
            seg.addEventListener('click', function (e) {
                var b = e.target.closest('button[data-v]');
                if (!b) { return; }
                Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) { x.classList.remove('active'); });
                b.classList.add('active');
            });
        });

        /* 点路径卡 = 换素材文件夹（2026-11-12 苏哥报「点了不是换文件夹，跳到别处」）。
         *
         * 历史：2026-11-10 为避免「路径卡与设置页重复」，这里改成了 openOptions()，
         * 而设置弹窗里的「保存位置」整组也在同日删掉 —— 结果两边都没有换目录入口，
         * 用户点路径卡只会跳到一个满是开关的扩展设置页，体感就是「换了个位置」。
         * 现在：路径卡自己换目录；右侧小箭头仍去完整设置。 */
        on('rootBtn', function (ev) {
            var chev = ev && ev.target && ev.target.closest ? ev.target.closest('.chev') : null;
            if (chev) { openOptions(); return; }
            switchRootInteractive();
        });
        /* 2026-11-10 盘查：resetBtn 已随 B-64 移除（换目录收敛为路径卡单入口），死绑定删除 */

        var emptyAct = $('#emptyAction');
        if (emptyAct) {
            emptyAct.addEventListener('click', async function () {
                var act = emptyAct.dataset.act;
                if (act === 'auth') {
                    var okA = await ensureWriteAccess();
                    if (okA) { await autoIndex(); await load(); }
                    return;
                }
                if (act === 'scan') { toast('正在扫描目录…'); await autoIndex(); await load(); }
                else { S.q = ''; S.type = 'all'; S.plat = 'all'; if ($('#search')) { $('#search').value = ''; } render(); }
            });
        }

        bindFavAndDrawer();

        document.addEventListener('keydown', function (e) {
            if (e.key === '/' && document.activeElement !== $('#search')) {
                var t = $('#search'); if (t) { e.preventDefault(); t.focus(); }
            }
            if (e.key === 'Escape') { closeSet(); }
        });
    }

    function openOptions() {
        try { chrome.runtime.openOptionsPage(); } catch (e) { location.href = 'options.html'; }
    }

    /** 当前库设置（异步读，失败给空对象） */
    function readLibSettings() {
        return new Promise(function (resolve) {
            try {
                chrome.storage.local.get('vrLibSettings', function (o) {
                    resolve((o && o.vrLibSettings) || {});
                });
            } catch (e) { resolve({}); }
        });
    }

    /** 数一下某个句柄下有多少媒体文件（限量，别在几万文件的目录上卡死） */
    async function countMediaQuick(handle, limit) {
        var n = 0;
        async function walk(dir, depth) {
            if (n >= limit || depth > 3) { return; }
            try {
                for await (var entry of dir.entries()) {
                    var name = entry[0];
                    if (/^(_library|_回收站|_migration|_selftest|node_modules|\.)/i.test(name)) { continue; }
                    if (entry[1].kind === 'file') {
                        if (/\.(mp4|m4v|webm|mkv|flv|mov|mp3|m4a|aac|wav|flac|jpe?g|png|webp|gif|apng|avif|bmp)$/i.test(name)) {
                            n++;
                            if (n >= limit) { return; }
                        }
                    } else if (depth < 3) {
                        await walk(entry[1], depth + 1);
                    }
                }
            } catch (e) { /* 读不了就按 0 算 */ }
        }
        await walk(handle, 0);
        return n;
    }

    /**
     * 换素材文件夹（点左上角路径卡触发）。
     *
     * 为什么不能「选完立刻切」：索引与设置都指向新根之后，旧库里的条目会全部
     * 变成 missing（文件还在原处，只是不在新根下）。用户误点一下就会觉得「库空了」。
     * 所以先数一眼新目录里有多少媒体文件，明显不对就要求二次确认。
     */
    async function switchRootInteractive() {
        if (typeof root.showDirectoryPicker !== 'function') {
            toast('这个浏览器不支持选文件夹，请到「完整扩展设置」里换目录');
            return;
        }
        var h = null;
        try {
            h = await root.showDirectoryPicker({ mode: 'readwrite' });
        } catch (e) {
            if (e && e.name === 'AbortError') { return; }   // 用户自己取消，不打扰
            toast('选文件夹失败：' + ((e && e.message) || e));
            return;
        }
        var st = await readLibSettings();
        var sub = st.subdir || 'video-rod';
        var picked = h;
        /* 用户在「下载」这类上级目录上点选时，自动进去 subdir（多半是想选那个） */
        if (sub && h.name !== sub) {
            var child = null;
            try { child = await h.getDirectoryHandle(sub); } catch (e2) { child = null; }
            if (child) { picked = child; }
        }
        /* 2026-11-14：下钻失败时**不再静默把上级目录当库根**（苏哥报的越界）。
         * 用户显式换库是允许选任意目录的，但必须让他知道「这一选会收进多少东西」：
         * 名称与 subdir 不符、且下面没有 subdir 时，说明他把范围放大到了上级。 */
        var widened = false;
        if (sub && picked === h && h.name !== sub) {
            widened = true;
        }
        var n = 0;
        try { n = await countMediaQuick(picked, 200); } catch (e3) { n = 0; }
        if (widened) {
            var goWide = root.confirm(
                '你选的是「' + picked.name + '」，不是素材库那一层（' + sub + '）。\n\n' +
                '继续的话，这个文件夹里的**所有内容**都会成为素材库（当前识别到 ' + n + ' 个媒体文件' +
                (n >= 200 ? '以上' : '') + '），包括上级目录里原本跟资源库无关的文件。\n\n' +
                '想只收「' + sub + '」里的素材，请重新选择并点进 ' + sub + ' 文件夹。\n\n' +
                '确定要把它整个当作素材库吗？'
            );
            if (!goWide) { return; }
        }
        if (n === 0) {
            var cur = FILES.length;
            var okEmpty = root.confirm(
                '「' + picked.name + '」里没找到媒体文件。\n\n' +
                (cur ? ('换过去之后，现在库里的 ' + cur + ' 条会显示不出来（文件还在原来那个文件夹，没被删）。\n\n') : '') +
                '确定要换到这个文件夹吗？'
            );
            if (!okEmpty) { return; }
        }
        try {
            /* 2026-11-14：索引首段必须是**句柄层真实名**，不能固定用 subdir。
             * 原来无论选到哪一层都写 prefix=video-rod，等于给上级目录的文件
             * 伪造了一个「video-rod/」身份 —— 它们于是被判成库内条目，
             * 库里显示成「网页」（首段不是站点、更不是真实目录）。
             * rebase 模式允许选任意目录，但首段要如实反映它是哪一层。 */
            var libPrefix = widened ? (picked.name || sub) : sub;
            await root.VRIndex.setRoot(picked, '', libPrefix, { mode: 'rebase' });
        } catch (e4) {
            toast('切换失败：' + ((e4 && e4.message) || e4));
            return;
        }
        /* 记住这是「自选文件夹」：否则 renderRoot 会退回系统下载目录那一套显示 */
        var next = Object.assign({}, st, {
            mode: 'custom',
            customRoot: '',
            customName: picked.name || '',
            /* subdir 同时用于「下次下载的落盘首段」，必须与索引首段一致，
             * 否则 save.js 剥前缀时会对不上，多套一层目录。 */
            subdir: widened ? (picked.name || sub) : sub
        });
        try {
            await new Promise(function (res) {
                chrome.storage.local.set({ vrLibSettings: next }, function () { res(1); });
            });
        } catch (e5) { /* 设置写失败也继续扫，至少这次能用 */ }

        toast('已切换到「' + (picked.name || '自选文件夹') + '」，正在重新扫描…');
        try { await root.VRIndex.build({ mode: 'full' }); } catch (e6) { /* 扫描失败也让人看到界面 */ }
        try { load(); } catch (e7) { location.reload(); }
        setTimeout(function () {
            toast('已切换。原来那些文件还在旧文件夹里，需要的话拷过来再点「全量扫描」');
        }, 1200);
    }

    /** 「定位」统一入口（ADR-086）。
     *  只有 `chrome.downloads.show(downloadId)` 能「在文件管理器中显示该文件」，
     *  且它只接受下载 id；没有再传路径的接口，也没有别的 API 能做到。
     *  没有可用 id 时的降级链见 revealWithoutDownload()（不再用 file:// 开标签页）。 */
    function revealFile(f) {
        if (!f) { return; }

        /* ① 有 downloadId：先确认记录还在再 show。
         *    浏览器重启后旧 downloadId 会失效，而 downloads.show 对无效 id
         *    不抛错也不弹窗（静默无操作）——直接 toast 成功会变成「点了没反应」。
         *    苏哥 2026-11-10 实测正是这个表现。
         *    2026-11-13（ADR-086）：show() 也接受回调，失败只能从 lastError 看出来；
         *    必须据此回退，否则「提示已定位、其实什么都没发生」会原样复发。 */
        if (f.downloadId != null && chrome.downloads && chrome.downloads.search) {
            chrome.downloads.search({ id: f.downloadId }, function (items) {
                var le = chrome.runtime && chrome.runtime.lastError;
                if (le || !items || !items.length || !chrome.downloads.show) {
                    revealWithoutDownload(f);
                    return;
                }
                try {
                    chrome.downloads.show(f.downloadId, function () {
                        if (chrome.runtime && chrome.runtime.lastError) {
                            revealWithoutDownload(f);
                            return;
                        }
                        toast('已在资源管理器中定位');
                    });
                } catch (e) {
                    revealWithoutDownload(f);
                }
            });
            return;
        }
        revealWithoutDownload(f);
    }

    /** ②③ 无有效 downloadId 时的定位链。
     *
     * 2026-11-13 重写（ADR-086）：原来这里用 `chrome.tabs.create({url:'file:///…/'})`
     * 兜底，结果是在浏览器里开了一个目录索引网页 —— 用户看到「文件夹出现在网页里」，
     * 完全不是「弹出资源管理器」。Chrome / MDN 文档都写明：能唤起文件管理器的只有
     * `chrome.downloads.show(downloadId)`（"Show the downloaded file in its folder
     * in a file manager"），而它只接受**下载 id**，不接受路径；
     * `showDefaultFolder()` 只能开默认下载目录。所以：
     *
     *   ⓐ 先算候选目录（absPath 所在目录，或 settings 根 + relPath 拼出来）；
     *   ⓑ 在下载记录里找**同目录**的任意一条 → 用它的 id 调 show()，目录准确打开；
     *   ⓒ 找不到任何同目录记录 → showDefaultFolder()（库就在下载目录的 subdir 下）
     *      + 复制路径；
     *   ⓓ 连默认目录都不可用 → 只给复制路径，并说清为什么。
     *
     * 上限（写在这里免得后人再踩）：没有 native messaging 宿主就无法「精确选中」
     * 任意路径的文件，ⓑ 只能保证目录对、选中项可能是同目录的别的素材。
     * 调研见 docs/RESEARCH-TRASH-RESCAN-AND-REVEAL.md §3。 */
    function revealWithoutDownload(f) {
        /* 打开「某个目录」的唯一合法手段：找一条落在该目录下的下载记录，用它的 id。
         * 返回值：true 已调用 show；false 这个目录没有可用记录。 */
        var showFolderByDownload = function (folderAbs, done) {
            var folder = String(folderAbs || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
            if (!folder) { done(false); return; }
            if (!chrome.downloads || !chrome.downloads.search || !chrome.downloads.show) {
                done(false); return;
            }
            try {
                chrome.downloads.search({ limit: 2000, orderBy: ['-startTime'] }, function (list) {
                    void chrome.runtime.lastError;
                    var hit = null;
                    (list || []).some(function (d) {
                        if (!d || !d.filename) { return false; }
                        var p = String(d.filename).replace(/\\/g, '/');
                        var dir = p.replace(/\/[^/]+$/, '').toLowerCase();
                        if (dir !== folder) { return false; }
                        hit = d;
                        return true;
                    });
                    if (!hit) { done(false); return; }
                    try {
                        chrome.downloads.show(hit.id);
                        toast('已在资源管理器中打开所在文件夹');
                        done(true);
                    } catch (e) { done(false); }
                });
            } catch (e) { done(false); }
        };

        /* 兜底 1：打开系统默认下载目录（库就在其 subdir 下） */
        var openDefaultFolder = function () {
            try {
                if (chrome.downloads && chrome.downloads.showDefaultFolder) {
                    chrome.downloads.showDefaultFolder();
                    toast('已打开下载文件夹；库里素材在其下的子目录中');
                    return true;
                }
            } catch (e) { /* 落到下面的复制路径 */ }
            return false;
        };

        var fallback = function (st, rel, rootGuessed) {
            if (openDefaultFolder()) {
                offerCopyPath(f, st, rel, rootGuessed, true);
                return;
            }
            offerCopyPath(f, st, rel, rootGuessed);
        };

        var proceedToSettings = function () {
            /* ③ 路径自恢复：settings 里的根 + 条目的相对路径 */
            try {
                chrome.storage.local.get('vrLibSettings', function (o) {
                    var st = (o && o.vrLibSettings) || {};
                    var rel = String(f.relPath || '').replace(/\\/g, '/');
                    var subdir = String(st.subdir || 'video-rod').replace(/^\/+|\/+$/g, '');
                    /* 条目 relPath 形如 video-rod/抖音/作者/视频/x.mp4；
                     * 根路径只需要前面那段（去掉 subdir 前缀）之后再拼。 */
                    var relFromRoot = rel;
                    if (subdir && relFromRoot.indexOf(subdir + '/') === 0) {
                        relFromRoot = relFromRoot.slice(subdir.length + 1);
                    }
                    var dirOf = function (base) {
                        if (!base) { return ''; }
                        var full = String(base).replace(/\/+$/, '') + '/' + relFromRoot;
                        return full.replace(/\/[^/]+$/, '');
                    };

                    /* ③a 设置里已经有根：直接按目录找下载记录 */
                    var guessed = '';
                    if (String(st.mode || 'system') === 'custom') {
                        guessed = dirOf(String(st.customRoot || '').trim());
                    } else {
                        var dr = String(st.detectedRoot || '').trim();
                        if (dr) { guessed = dirOf(dr + '/' + subdir); }
                    }
                    if (guessed) {
                        showFolderByDownload(guessed, function (ok) {
                            if (!ok) { fallback(st, rel, !!guessed); }
                        });
                        return;
                    }

                    /* ③b 设置里没有根 —— 从下载记录反推库根后再按目录找。
                     * 跨浏览器最实用的一条：新浏览器没有旧浏览器的下载历史，
                     * 但只要它自己下过任意一个落进 <根>/ 的文件，就能截出「…/video-rod」。 */
                    if (!chrome.downloads || !chrome.downloads.search) {
                        fallback(st, rel, false);
                        return;
                    }
                    chrome.downloads.search({ limit: 2000 }, function (list) {
                        var root = deriveRootFromDownloads(list || [], subdir);
                        if (!root) { fallback(st, rel, false); return; }
                        showFolderByDownload(dirOf(root), function (ok) {
                            if (!ok) { fallback(st, rel, !!root); }
                        });
                    });
                });
            } catch (e) {
                fallback(null, String(f.relPath || ''), false);
            }
        };

        /* ② 有绝对路径：按它所在目录找下载记录（不再 file:// 开标签页） */
        var abs = String(f.absPath || '').trim();
        if (abs) {
            var folder = abs.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
            if (folder) {
                showFolderByDownload(folder, function (ok) {
                    if (!ok) { proceedToSettings(); }
                });
                return;
            }
        }
        proceedToSettings();
    }

    /** 从下载记录里反推「库根」的绝对路径。
     *  判据：filename 里出现过 /<subdir>/ 段 → 取它前面那段当根。
     *  取出现次数最多的那个（避免个别脏记录把根带偏）。 */
    function deriveRootFromDownloads(list, subdir) {
        var sd = String(subdir || 'video-rod');
        var pat = new RegExp('/' + sd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/', 'i');
        var tally = {};
        (list || []).forEach(function (d) {
            var p = String((d && d.filename) || '').replace(/\\/g, '/');
            if (!p) { return; }
            var m = p.match(pat);
            if (!m) { return; }
            var root = p.slice(0, m.index + 1 + sd.length);
            if (root) { tally[root] = (tally[root] || 0) + 1; }
        });
        var keys = Object.keys(tally);
        if (!keys.length) { return ''; }
        keys.sort(function (a, b) { return tally[b] - tally[a]; });
        return keys[0];
    }

    /** 「定位」失败时的出路：复制路径 + 告诉用户为什么。
     *  @param {boolean} [folderOpened] 已经替用户打开了下载目录 ——
     *         这时文案不该再讲「打不开」，而要讲「目录已打开，路径在这里」。 */
    function offerCopyPath(f, st, rel, rootGuessed, folderOpened) {
        var r = String(rel || f.relPath || '');
        if (!r) { toast('这条素材没有可用的路径信息'); return; }
        var why;
        if (folderOpened) {
            why = '没能精确定位到这条素材；已打开下载文件夹，可复制路径去粘贴查找。';
        } else if (rootGuessed) {
            why = '按文件夹根路径拼了一下没找到可用的下载记录，可能文件夹被移动或改名了。';
        } else if (st && String(st.mode || 'system') === 'custom' && !String(st.customRoot || '').trim()) {
            why = '当前是自选文件夹模式，浏览器不提供绝对路径。可在「设置 → 媒体库位置」里填一次预览路径。';
        } else {
            why = '这条素材没有下载记录，也没能推出它所在文件夹的绝对路径。可在「设置 → 媒体库位置」里填一次预览路径。';
        }
        toast(why, {
            label: '复制路径', ms: 12000,
            onClick: function () {
                var done = function () { toast('已复制：' + r); };
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(r).then(done, function () { toast(r); });
                    } else { toast(r); }
                } catch (e) { toast(r); }
            }
        });
    }

    /* ---------- M5：只读 / 授权状态 ---------- */
    function rootBaseName(absRoot) {
        var p = String(absRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        var segs = p.split('/').filter(Boolean);
        return segs.length ? segs[segs.length - 1] : '';
    }
    function rootParentName(absRoot) {
        var p = String(absRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
        var segs = p.split('/').filter(Boolean);
        return segs.length >= 2 ? segs[segs.length - 2] : '';
    }

    /** 选择一个真正指向当前库根的目录（video-rod），并写入句柄。 */
    async function authorizeRoot() {
        if (typeof root.showDirectoryPicker !== 'function') {
            toast('此浏览器不支持目录授权，请到完整设置页操作');
            return false;
        }
        /* 先弹选择器，再做异步读取：目录选择要求用户手势，
         * 中间插太多 await 会丢掉 transient activation。 */
        var h = null;
        try {
            h = await root.showDirectoryPicker({ mode: 'readwrite' });
        } catch (e) {
            if (e && e.name === 'AbortError') { return false; }
            toast('授权失败：' + ((e && e.message) || e));
            return false;
        }
        var rr = null;
        try { rr = await root.VRIndex.resolveRoot(); } catch (e) { rr = null; }
        /* 期望层名与守卫同口径（2026-11-14）。原来这里只看 absRoot 末段：
         * 自选目录拿不到绝对路径时 expected 为空 → 整段校验被跳过，
         * 用户选到上级目录也会被当成合法授权（越界入口之一）。
         * 现在退到 customName / subdir，保证「永远有一个期望值」。 */
        var expected = '';
        try {
            if (root.VRRootGuard && typeof root.VRRootGuard.expectedName === 'function') {
                var stAuth = await readLibSettings();
                expected = root.VRRootGuard.expectedName(stAuth, rr && rr.absRoot);
            }
        } catch (eExp) { expected = ''; }
        if (!expected && rr && rr.absRoot) { expected = rootBaseName(rr.absRoot); }
        var parent = rr && rr.absRoot ? rootParentName(rr.absRoot) : '';
        if (expected && String(h.name || '').toLowerCase() !== String(expected).toLowerCase()) {
            var child = null;
            try { child = await h.getDirectoryHandle(expected); } catch (e2) { child = null; }
            if (!child && parent && h.name === parent) {
                try { child = await h.getDirectoryHandle(expected, { create: true }); }
                catch (e3) { child = null; }
            }
            if (!child) {
                toast('请选择「' + expected + '」文件夹' + (parent ? ('，或它的上级「' + parent + '」') : ''));
                return false;
            }
            h = child;
        }
        try {
            await root.VRIndex.setRoot(h, rr && rr.absRoot, rr && rr.prefix);
        } catch (e) {
            toast('写入授权失败：' + ((e && e.message) || e));
            return false;
        }
        toast('已授权素材目录');
        try { await refreshPermState(); } catch (e) { /* 忽略 */ }
        /* 授权成功 → 顺便问一句要不要备份扩展程序（苏哥 2026-11-10） */
        try {
            if (root.VRExportKit && root.VRExportKit.offerBackup) {
                var notify = function (m, k) {
                    toast(m, k === 'ok' ? { ms: 3500 } : { ms: 3000 });
                };
                root.VRExportKit.offerBackup(h, notify);
            }
        } catch (e) { /* 备份功能失败绝不干扰授权本身 */ }
        return true;
    }

    /** 写操作前的统一入口：能用原句柄恢复就恢复，否则直接弹目录选择。 */
    /** 写操作前先给一句明确反馈：无授权时系统目录框会弹出来，
     *  用户不知道发生了什么就容易判定「按钮坏了」。 */
    function markWritePending() {
        if (window.__vrPerm && window.__vrPerm.writable) { return; }
        toast('需要素材目录写权限：请在系统对话框里选择 video-rod 文件夹');
    }

    async function ensureWriteAccess() {
        if (window.__vrPerm && window.__vrPerm.writable) { return true; }
        var p = window.__vrPerm;
        if (p && p.handle && !p.rootInvalid && p.permState === 'prompt') {
            try {
                var st = await p.handle.requestPermission({ mode: 'readwrite' });
                if (st === 'granted') {
                    var rr0 = await root.VRIndex.resolveRoot();
                    await root.VRIndex.setRoot(p.handle, rr0.absRoot, rr0.prefix);
                    toast('已恢复写入权限');
                    await refreshPermState();
                    return true;
                }
            } catch (e) { /* 落到重新选择 */ }
        }
        /* 关键：走到这里说明自动恢复失败（常见于权限被浏览器收回后又拒绝，
         * 或 requestPermission 在无用户手势时被拒）。必须弹目录选择，
         * 并且无论成败都要给提示 —— 否则用户点「删除/移动」只会看到毫无反应。 */
        var ok = false;
        try { ok = await authorizeRoot(); } catch (e2) { ok = false; }
        if (!ok) {
            toast('需要先授权素材目录：点顶部横幅「恢复写入」，或右侧「授权素材目录」');
            var banner = $('#permBanner');
            if (banner) { banner.classList.remove('hidden'); }
        }
        return ok;
    }

    async function refreshPermState() {
        var banner = $('#permBanner'), txt = $('#permText'), auth = $('#permAuth');
        var rr = null;
        try { if (root.VRIndex && root.VRIndex.resolveRoot) { rr = await root.VRIndex.resolveRoot(); } } catch (e) { rr = null; }
        var handle = rr && rr.handle ? rr.handle : null;
        /* 期望层名与守卫同口径（2026-11-14）：原来只看 absRoot 末段，
         * 自选目录拿不到绝对路径时 expectedName 为空 → rootInvalid 恒 false，
         * 于是一个错层的句柄会被当成「有效授权」，横幅不提示、写操作照发。
         * 现在退到 customName / subdir，保证「永远有一个期望值」。 */
        var expectedName = '';
        try {
            if (root.VRRootGuard && typeof root.VRRootGuard.expectedName === 'function') {
                var stPerm = null;
                try {
                    stPerm = await new Promise(function (res) {
                        chrome.storage.local.get('vrLibSettings', function (o) { res((o && o.vrLibSettings) || {}); });
                    });
                } catch (eSt) { stPerm = {}; }
                expectedName = root.VRRootGuard.expectedName(stPerm, rr && rr.absRoot);
            }
        } catch (eExp) { expectedName = ''; }
        if (!expectedName) { expectedName = rr && rr.absRoot ? rootBaseName(rr.absRoot) : ''; }
        /* 句柄在上一级、但下面有正确的子目录 → 不算失效：resolveRoot 已经下钻过了。
         * 这里只把「真的对不上」判成失效。 */
        var rootInvalid = !!(handle && expectedName &&
            String(handle.name || '').toLowerCase() !== String(expectedName).toLowerCase());
        var writable = false;
        var permState = '';
        if (handle && !rootInvalid) {
            if (typeof handle.queryPermission !== 'function') { writable = true; permState = 'granted'; }
            else {
                try {
                    permState = await handle.queryPermission({ mode: 'readwrite' });
                    writable = permState === 'granted';
                } catch (e) { writable = false; permState = 'error'; }
            }
        }
        var fileAccess = true;
        try {
            if (chrome.extension && chrome.extension.isAllowedFileSchemeAccess) {
                fileAccess = await new Promise(function (res) {
                    chrome.extension.isAllowedFileSchemeAccess(function (v) { res(!!v); });
                });
            }
        } catch (e) { fileAccess = true; }

        var issues = [];
        if (!writable) {
            issues.push(rootInvalid
                ? ('当前授权句柄指向「' + (handle && handle.name) + '」，不是「' + expectedName + '」；点「重新授权」选择正确的素材库根目录。')
                : (handle
                    ? (permState === 'prompt'
                        ? '已选过素材目录，但浏览器在刷新后收回了写入权限，当前为只读；点「恢复写入」即可，不用重新选目录。'
                        : '素材目录当前不可写：点「恢复写入」重新授权；浏览/预览仍可用。')
                    : '当前为只读模式：浏览/预览可用；点「授权素材目录」选择素材库根目录。'));
        }
        if (!fileAccess) {
            issues.push('浏览器未允许访问本地文件，缩略图/预览可能失败；请在扩展详情打开「允许访问文件网址」。');
        }
        if (banner) { banner.classList.toggle('hidden', issues.length === 0); }
        if (txt) { txt.textContent = issues.join(' '); }
        if (auth) {
            auth.textContent = writable ? '查看设置' : (rootInvalid ? '重新授权' : (handle ? '恢复写入' : '授权素材目录'));
            auth.title = writable ? '打开设置'
                : (rootInvalid ? ('当前句柄是「' + (handle && handle.name) + '」，需要重新选择「' + expectedName + '」')
                    : (handle ? '沿用已选目录，重新申请写入权限' : '选择素材库根目录并授权读写'));
        }

        /* 写操作按钮不再置灰：点击时会先走 ensureWriteAccess（恢复权限/弹目录选择），
         * 置灰等于「点了没反应」，正是用户反馈的删除/移动按钮失效。 */
        ['batchMove', 'batchTrash', 'pvDelete', 'pvMove'].forEach(function (id) {
            var b = document.getElementById(id);
            if (b) { b.disabled = false; b.removeAttribute('title'); }
        });
        try {
            window.__vrPerm = {
                handle: handle, writable: writable, permState: permState,
                fileAccess: fileAccess, issues: issues,
                rootInvalid: rootInvalid, expectedName: expectedName
            };
        } catch (e) { /* 忽略 */ }
    }

    window.addEventListener('focus', function () { refreshPermState(); });

    /* ---------- 预览（R5 接入真实查看器，当前提示） ---------- */
    function openPreview(f, list) {
        if (!f) { return; }
        /* 胶片条的范围由调用方决定：从货架行点开 = 该平台全部素材（当前"子文件夹"），
         * 从列表视图 / 收藏夹 / 搜索点开 = 当前筛选结果 S.list。 */
        var arr = (list && list.length) ? list : S.list;
        if (root.VRPreview && root.VRPreview.open) { root.VRPreview.open(f, arr); return; }
        toast('预览器 R5 接入中');
    }

    /** 卡片/键盘共用的星标切换：先写库，成功后再更新 UI，失败不假装成功。 */
    async function starCard(f) {
        if (!f) { return; }
        if (!root.VRFav || typeof root.VRFav.toggleStar !== 'function') {
            toast('收藏模块没加载，刷新页面再试');
            return;
        }
        try {
            var next = await root.VRFav.toggleStar(f.relPath);
            f.starred = !!next;
            if (RAW[f.relPath]) { RAW[f.relPath].starred = next ? 1 : 0; }
            render();
            /* render 会重建卡片，把焦点还给同一张卡，S 键可以连续按。 */
            var again = document.querySelector('#grid .card[data-id="' + String(f.id).replace(/"/g, '\\"') + '"]');
            if (again && document.activeElement !== again) { try { again.focus(); } catch (e) { /* ignore */ } }
            toast(next ? '已加星标' : '已取消星标');
        } catch (e) {
            toast('星标失败：' + ((e && e.message) || '未知'));
        }
    }

    /* ---------- 卡片右键菜单（VRCtxMenu 接线） ---------- */
    /* 复用已有实现：重命名 openRename / 移动 VRMovePicker / 删除确认 ask
     * 都在 bindMissing 的闭包里，所以这里只注册回调，具体函数在 bindMissing 内注入。 */
    var ctxHooks = null;
    function initCtxMenu(hooks) {
        /* boot() 里还会无参调一次 initCtxMenu()（只做接线）；如果无条件赋值，
         * 会把 bindMissing 注册的那份回调（rename/reveal/remove）覆盖成 undefined，
         * 表现为右键「移到回收站 / 重命名 / 在文件夹中定位」点了没反应（2026-11-09 实测）。 */
        if (hooks) { ctxHooks = hooks; }
        if (!root.VRCtxMenu) { return; }
        root.VRCtxMenu.init({
            toast: toast,
            find: function (id) { return FILES.find(function (f) { return f.id === id; }) || null; },
            list: function () { return S.list; },
            preview: function (f) { openPreview(f); },
            rename: function (f) { if (ctxHooks && ctxHooks.rename) { ctxHooks.rename(f); } },
            move: async function (f) {
                if (!root.VRMovePicker) { toast('移动模块没加载，请刷新页面'); return; }
                if (typeof ensureWriteAccess === 'function' && !(await ensureWriteAccess())) { return; }
                root.VRMovePicker.open([f], moveHooks());
            },
            reveal: function (f) { if (ctxHooks && ctxHooks.reveal) { ctxHooks.reveal(f); } },
            fav: async function (f) {
                if (hasFavorite(f.relPath)) {
                    var fav = FAVS.filter(function (x) { return x.sys !== 'star'; })[0];
                    if (fav) {
                        fav.ids = (fav.ids || []).filter(function (id) { return id !== f.relPath; });
                        saveFavs(); renderFavs(); render();
                        toast('已取消收藏');
                    }
                    return;
                }
                addToDefault(f.relPath);
                renderFavs(); render();
                toast('已加入收藏');
            },
            star: async function (f) {
                if (root.VRFav && typeof root.VRFav.toggleStar === 'function') {
                    var next = await root.VRFav.toggleStar(f.relPath);
                    f.starred = !!next;
                    render();
                    toast(next ? '已加星标' : '已取消星标');
                }
            },
            remove: function (f) { if (ctxHooks && ctxHooks.remove) { ctxHooks.remove(f); } }
        });
    }

    /* ---------- 收藏夹（R6：真实持久化，收藏夹只记 id 不动物理文件） ---------- */
    var FAVS = [];

    async function loadFavs() {
        try {
            var v = await root.VRDB.getSetting('vrFavs', []);
            FAVS = Array.isArray(v) ? v.filter(function (f) { return f && f.sys !== 'star'; }) : [];
        } catch (e) { FAVS = []; }
        /* 用户 2026-11-06：收藏夹只需要一个，分类交给标签。
         * 旧测试/误操作留下的多个文件夹合并到第一个，避免侧栏继续膨胀。 */
        if (FAVS.length > 1) {
            var keep = FAVS[0];
            keep.ids = keep.ids || [];
            FAVS.slice(1).forEach(function (f) {
                (f.ids || []).forEach(function (id) {
                    if (keep.ids.indexOf(id) < 0) { keep.ids.push(id); }
                });
            });
            FAVS = [keep];
        }
        /* 2026-11-08 苏哥拍板：收藏是「点一下就看收藏内容」的视图，不是可命名的文件夹。
         *   · 名字固定为「收藏」，不再沿用历史遗留的自定义名
         *   · 库为空时也必须有这一行，否则左栏连可点的入口都没有
         * 这里只在必要时落库一次，不制造额外写入。 */
        var dirty = false;
        if (!FAVS.length) {
            FAVS = [{ id: 'fav-default', name: '收藏', ids: [] }];
            dirty = true;
        } else if (FAVS.length === 1 && FAVS[0].name !== '收藏') {
            FAVS[0].name = '收藏';
            dirty = true;
        }
        if (dirty) { saveFavs(); }
    }
    function saveFavs() {
        try {
            /* setSetting 是异步的：这里原来只 catch 同步异常，
             * 真正的写失败（配额满/库被关）会变成未处理的 rejection，
             * 用户加完收藏刷新一下全没了，且控制台什么都没有。 */
            var r = root.VRDB.setSetting('vrFavs', FAVS);
            if (r && typeof r.then === 'function') {
                r.then(null, function (e) {
                    console.warn('[favs] 保存收藏夹失败：', e && e.message);
                    toast('收藏夹保存失败，刷新后可能丢失');
                });
            }
        } catch (e) {
            console.warn('[favs] 保存收藏夹异常：', e && e.message);
            toast('收藏夹保存失败，刷新后可能丢失');
        }
    }
    /** 按 id 找收藏夹；`fav-star` 是虚拟的「已加星标」夹，不在 FAVS 里。 */
    function findFav(id) {
        if (!id) { return null; }
        if (id === 'fav-star') { return { id: 'fav-star', name: '已加星标', sys: 'star' }; }
        for (var i = 0; i < FAVS.length; i++) {
            if (FAVS[i].id === id) { return FAVS[i]; }
        }
        return null;
    }

    function favHas(fav, f) {
        if (!fav) { return false; }
        if (fav.sys === 'star') { return !!f.starred; }
        return (fav.ids || []).indexOf(f.id) >= 0;
    }
    function renderFavs() {
        var list = $('#favList');
        if (!list) { return; }
        /* 只有一行「收藏」（2026-11-08 苏哥拍板）：
         * 收藏是「点击查看收藏内容」的视图，不该有名字，也不该有第二个夹。
         * 星标仍保留，但入口在详情页/右键菜单，不再占左栏一行。 */
        list.innerHTML = FAVS.filter(function (fav) { return fav.sys !== 'star'; }).map(function (fav) {
            var n = FILES.filter(function (f) { return favHas(fav, f); }).length;
            var on = S.fav === fav.id;
            return '<button class="fav-row' + (on ? ' active' : '') + '" data-fav="' + esc(fav.id) + '">' +
                '<svg class="i fi"><use href="#i-bookmark"/></svg>' +
                '<span class="label">' + esc(fav.name) + '</span>' +
                '<span class="count">' + n + '</span></button>';
        }).join('');
        /* 计数只放在行尾（2026-11-08 二次修正）：
         * 上方那条「收藏 N」标题删掉后，这里不能再写 #favSideCnt，
         * 否则会恢复成「两行都是收藏」的观感。 */
    }

    /**
     * 左栏标签区渲染。
     *
     * 设计要点（2026-11-07 苏哥拍板）：
     *   · 计数徽标跟着「当前范围」走 —— 切到小红书后，标签显示的是该站下的张数
     *   · 多选=交集，选中用金色描边；收藏夹那种「唯一激活」不适合标签
     *   · 行尾改名/删除默认隐藏，悬停才出，避免左栏一片按钮
     *   · 默认只列前 MAX 个，其余收进「显示全部」，防止标签一多把左栏撑爆
     */
    var TAG_SHOW = 12;
    var tagExpanded = false;

    function renderTags() {
        var list = $('#tagList');
        if (!list) { return; }
        var c = countsInScope();
        var tags = Object.keys(c.tags || {}).map(function (k) {
            return { key: k, label: c.tags[k].label, count: c.tags[k].count };
        }).sort(function (a, b) {
            /* 选中的排最前（方便连续取消），其余按张数降序 */
            var ai = S.tags.indexOf(a.key) >= 0 ? 0 : 1;
            var bi = S.tags.indexOf(b.key) >= 0 ? 0 : 1;
            if (ai !== bi) { return ai - bi; }
            return b.count - a.count;
        });

        if (!tags.length) {
            list.innerHTML = '<div class="tag-empty">还没有标签。打开任意素材，在右侧「标签」里添加。</div>';
            var cnt0 = $('#tagSideCnt'); if (cnt0) { cnt0.textContent = '0'; }
            paintTagSelBadge(tags);
            return;
        }

        var shown = tagExpanded ? tags : tags.slice(0, TAG_SHOW);
        var html = shown.map(function (t) {
            var on = S.tags.indexOf(t.key) >= 0;
            return '<div class="tag-row' + (on ? ' active' : '') + '" data-tag="' + esc(t.key) + '" title="' + esc(t.label) + '（' + t.count + '）">' +
                '<span class="hash">#</span>' +
                '<span class="label">' + esc(t.label) + '</span>' +
                '<span class="count">' + t.count + '</span>' +
                '<button class="tag-act" data-tag-rename="' + esc(t.key) + '" title="重命名标签"><svg class="i" style="width:10px;height:10px"><use href="#i-pencil"/></svg></button>' +
                '<button class="tag-act danger" data-tag-del="' + esc(t.key) + '" title="删除标签（从所有素材移除）"><svg class="i" style="width:10px;height:10px"><use href="#i-x"/></svg></button>' +
                '</div>';
        }).join('');

        if (tags.length > TAG_SHOW) {
            html += '<button class="fav-more" id="tagMore">' +
                (tagExpanded ? '收起' : '显示全部（' + tags.length + '）') + '</button>';
        }
        list.innerHTML = html;

        var cnt = $('#tagSideCnt');
        if (cnt) { cnt.textContent = String(tags.length); }
        paintTagSelBadge(tags);
    }

    /**
     * 折叠条上的「正在筛选」提示。
     *
     * 为什么要有：标签区默认收起，如果收起后完全看不出筛了什么，
     * 用户会以为列表少了一半图却找不到原因。这里把已选标签名拼在折叠条上。
     */
    function paintTagSelBadge(tags) {
        var badge = $('#tagSelBadge');
        if (!badge) { return; }
        if (!S.tags || !S.tags.length) {
            badge.hidden = true;
            badge.textContent = '';
            return;
        }
        var byKey = {};
        (tags || []).forEach(function (t) { byKey[t.key] = t.label; });
        var names = S.tags.map(function (k) { return byKey[k] || k; });
        badge.hidden = false;
        badge.textContent = names.join(' + ');
        badge.title = '正在筛选：' + names.join('、') + '（取交集）';
    }

    /** 标签名归一：去首尾空白、折叠内部空格、限长 */
    function normTag(s) {
        return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    }

    /** 某个标签名是否已在这条素材上（大小写不敏感） */
    function hasTag(f, name) {
        var k = String(name).toLowerCase();
        return (f.tags || []).some(function (x) { return String(x).trim().toLowerCase() === k; });
    }

    /**
     * 新建标签：加到**当前勾选的素材**上。
     *
     * 标签没有独立注册表 —— 它只存在于素材条目的 tags 数组里（indexer 重建索引时
     * 靠 mergeEntry 保住）。所以「新建一个没有任何素材的标签」在数据上不存在，
     * 必须先选中素材。这也是 booru 系的语义：标签是对素材的描述。
     */
    async function createTag() {
        var inp = $('#tagNewInput'); if (!inp) { return; }
        var name = normTag(inp.value);
        if (!name) { toast('标签名不能为空'); return; }
        var targets = FILES.filter(function (f) { return S.sel.has(f.id); });
        if (!targets.length) { toast('先在右侧勾选素材，再新建标签'); return; }

        var n = 0;
        for (var i = 0; i < targets.length; i++) {
            var f = targets[i];
            if (hasTag(f, name)) { continue; }
            var next = (f.tags || []).slice();
            next.push(name);
            try {
                await root.VRDB.patchFile(f.relPath, { tags: next });
            } catch (e) { continue; }
            f.tags = next;
            n++;
        }
        inp.value = '';
        render();
        toast(n ? ('已给 ' + n + ' 项加上「' + name + '」') : '这些素材已经有该标签了');
    }

    /** 重命名标签：遍历带该标签的素材，就地改名（改名后同一条里可能重复，去重） */
    async function renameTag(key) {
        var c = counts();
        var t = c.tags[key];
        if (!t) { return; }
        var nv = window.prompt('重命名标签', t.label);
        if (nv === null) { return; }
        nv = normTag(nv);
        if (!nv || nv.toLowerCase() === key) { return; }

        var hits = FILES.filter(function (f) { return hasTag(f, key); });
        for (var i = 0; i < hits.length; i++) {
            var f = hits[i];
            var seen = {}, out = [];
            (f.tags || []).forEach(function (x) {
                var s = String(x).trim();
                if (s.toLowerCase() === key) { s = nv; }
                var k = s.toLowerCase();
                if (seen[k]) { return; }
                seen[k] = 1;
                out.push(s);
            });
            try {
                await root.VRDB.patchFile(f.relPath, { tags: out });
            } catch (e) { continue; }
            f.tags = out;
        }
        /* 选中的旧 key 跟着换，否则筛选项会指向一个已不存在的标签 */
        var idx = S.tags.indexOf(key);
        if (idx >= 0) { S.tags[idx] = nv.toLowerCase(); }
        render();
        toast('已重命名为「' + nv + '」');
    }

    /** 删除标签：从所有带它的素材上移除（素材本身不动，只清标签） */
    async function deleteTag(key) {
        var c = counts();
        var t = c.tags[key];
        if (!t) { return; }
        if (!window.confirm('删除标签「' + t.label + '」？\n会从 ' + t.count +
            ' 项素材上移除，素材本身不受影响。')) { return; }

        var hits = FILES.filter(function (f) { return hasTag(f, key); });
        for (var i = 0; i < hits.length; i++) {
            var f = hits[i];
            var out = (f.tags || []).filter(function (x) {
                return String(x).trim().toLowerCase() !== key;
            });
            try {
                await root.VRDB.patchFile(f.relPath, { tags: out });
            } catch (e) { continue; }
            f.tags = out;
        }
        var idx = S.tags.indexOf(key);
        if (idx >= 0) { S.tags.splice(idx, 1); }
        render();
        toast('已删除标签「' + t.label + '」');
    }

    function oneFav() {
        var fav = FAVS.filter(function (f) { return f.sys !== 'star'; })[0];
        if (!fav) {
            fav = { id: 'fav-default', name: '收藏', ids: [] };
            FAVS = [fav];
        }
        fav.name = '收藏';
        fav.ids = fav.ids || [];
        return fav;
    }
    function addToFav(ids) {
        if (!ids || !ids.length) { toast('先选素材'); return; }
        var fav = oneFav();
        ids.forEach(function (id) { if (fav.ids.indexOf(id) < 0) { fav.ids.push(id); } });
        saveFavs(); renderFavs(); render();
        toast('已加入收藏');
    }
    function hasFavorite(relPath) {
        var fav = FAVS.filter(function (f) { return f.sys !== 'star'; })[0];
        return !!(fav && (fav.ids || []).indexOf(relPath) >= 0);
    }
    function addToDefault(relPath) {
        if (!relPath) { return false; }
        var fav = oneFav();
        var i = fav.ids.indexOf(relPath);
        if (i >= 0) {
            fav.ids.splice(i, 1);
            saveFavs(); renderFavs(); render();
            toast('已取消收藏');
            return false;
        }
        fav.ids.push(relPath);
        saveFavs(); renderFavs(); render();
        toast('已收藏');
        return true;
    }

    /** 详情页收藏按钮：切换星标，返回 0/1；页面与库页共用同一份 DB 字段。 */
    async function toggleStar(relPath) {
        var row = null;
        for (var i = 0; i < FILES.length; i++) {
            if (FILES[i].id === relPath) { row = FILES[i]; break; }
        }
        if (!row) { return 0; }
        var next = row.starred ? 0 : 1;
        try {
            await root.VRDB.patchFile(relPath, { starred: next });
        } catch (e) {
            toast('收藏失败：' + (e && e.message || '数据库不可写'));
            return row.starred ? 1 : 0;
        }
        row.starred = !!next;
        if (RAW[relPath]) { RAW[relPath].starred = next; }
        renderFavs();
        render();
        toast(next ? '已收藏' : '已取消收藏');
        return next;
    }

    /* ---------- 设置弹窗（R7：真实动作；2026-11-10 抽屉改弹窗，重复项已去） ---------- */
    function setVal(id, v) { var e = document.getElementById(id); if (e) { e.textContent = v; } }

    async function refreshDrawer() {
        setVal('sdIndexVal', FILES.length + ' 项 · ' + Math.round(FILES.reduce(function (a, b) { return a + (b.size || 0); }, 0)) + ' MB');
        var tc = 0;
        try {
            if (root.VRTrash) { var st = await root.VRTrash.status(); tc = st.count || 0; }
        } catch (e) { tc = 0; }
        /* 计数徽标不再写死初值：为空时整块隐藏，避免首帧闪一个错误数字。 */
        var dcnt = document.getElementById('dwCnt');
        if (dcnt) {
            dcnt.textContent = tc;
            dcnt.hidden = !tc;
        }
        var tcnt = document.getElementById('trashCnt');
        if (tcnt) {
            tcnt.textContent = tc;
            tcnt.hidden = !tc;
        }
    }

    async function doScan() {
        /* 设置抽屉里的「立即扫描」= 全量扫描。
         * 用户主动点它的时候，意图通常是「把磁盘上的一并认进来」，
         * 而不是只补新下载的 —— 后者主界面上的「快速扫描」更顺手。 */
        var ok = await scanFull();
        await refreshDrawer();
        return ok;
    }

    /* ---------- 回收站（S5 完整版） ----------
     * 后端 VRTrash 早就齐了（remove/list/restore/purge/empty/preflightRestore），
     * 但抽屉只渲染了「名字 + 恢复」两样东西，单条彻底删除 purge 压根没有入口。
     * 这里把它做成一个能真正用的回收站：
     *   · 按批次分组显示（同一批删除的时间最有用）
     *   · 缩略图 + 文件名 + 相对路径 + 体积
     *   · 搜索过滤（删多了靠肉眼翻不现实）
     *   · 单条恢复 / 单条彻底删除
     *   · 多选：恢复所选 / 彻底删除所选 / 全选
     * 所有破坏性操作都先确认；彻底删除额外说明「不可恢复」。 */

    /* 抽屉的临时状态。不持久化：每次打开都从磁盘清单重建，
     * 避免 UI 状态和实际文件长期不一致。 */
    var TR = { batches: [], q: '', picked: {}, busy: false };

    function trSize(bytes) {
        var n = Number(bytes) || 0;
        var mb = n / 1048576;
        return fmt(mb);
    }

    function trGroupLabel(at, batch) {
        var d = new Date(Number(at) || 0);
        var today = new Date();
        var sameDay = d.toDateString() === today.toDateString();
        var y = new Date(today.getTime() - 86400000);
        var yest = d.toDateString() === y.toDateString();
        var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
        if (sameDay) { return '今天 ' + hm; }
        if (yest) { return '昨天 ' + hm; }
        if (!at) { return batch || ''; }
        return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm;
    }

    /* 缩略图：只有图片/视频才值得解码；视频用容器占位（回收站里取首帧成本太高）。 */
    function trThumb(it) {
        var ext = String(it.ext || it.relPath.split('.').pop() || '').toLowerCase();
        var isImg = /^(jpg|jpeg|png|webp|gif|bmp|avif|heic|heif)$/.test(ext);
        var isVid = it.kind === 'video' || /^(mp4|mov|webm|mkv)$/.test(ext);
        if (isImg) {
            /* 文件已经搬进回收站，原相对路径不再可直接访问；
             * 统一给图标占位，避免一次开几十个会 404 的请求。 */
            return '<div class="dw-thumb"><svg class="i"><use href="#i-image"/></svg></div>';
        }
        if (isVid) {
            return '<div class="dw-thumb"><svg class="i"><use href="#i-play"/></svg></div>';
        }
        return '<div class="dw-thumb"><svg class="i"><use href="#i-file-text"/></svg></div>';
    }

    /* 当前筛选结果（搜索命中 + 批次展开）。 */
    function trVisible() {
        var q = String(TR.q || '').trim().toLowerCase();
        var out = [];
        TR.batches.forEach(function (b) {
            var items = (b.items || []).filter(function (it) {
                if (!q) { return true; }
                return String(it.relPath || '').toLowerCase().indexOf(q) >= 0;
            });
            if (items.length) { out.push({ batch: b.batch, at: b.at, items: items }); }
        });
        return out;
    }

    function trPickedList() {
        var out = [];
        TR.batches.forEach(function (b) {
            (b.items || []).forEach(function (it) {
                var k = b.batch + '|' + it.relPath;
                if (TR.picked[k]) { out.push({ batch: b.batch, relPath: it.relPath, item: it }); }
            });
        });
        return out;
    }

    function trSyncPicked() {
        /* 清掉已经不在清单里的选择（恢复/删除后），否则批量操作会带上脏数据。 */
        var alive = {};
        TR.batches.forEach(function (b) {
            (b.items || []).forEach(function (it) { alive[b.batch + '|' + it.relPath] = 1; });
        });
        Object.keys(TR.picked).forEach(function (k) {
            if (!alive[k]) { delete TR.picked[k]; }
        });
        var n = Object.keys(TR.picked).length;
        var nEl = document.getElementById('dwPickN');
        if (nEl) { nEl.textContent = n; }
        var allEl = document.getElementById('dwPickAll');
        if (allEl) {
            var vis = trVisible();
            var total = vis.reduce(function (a, b) { return a + b.items.length; }, 0);
            allEl.checked = total > 0 && n >= total;
            allEl.indeterminate = n > 0 && n < total;
        }
        var btnR = document.getElementById('dwRestoreSel');
        var btnP = document.getElementById('dwPurgeSel');
        if (btnR) { btnR.disabled = !n || TR.busy; }
        if (btnP) { btnP.disabled = !n || TR.busy; }
    }

    function trRender() {
        var listEl = document.getElementById('dwList');
        if (!listEl) { return; }
        var vis = trVisible();
        if (!vis.length) {
            var total = TR.batches.reduce(function (a, b) { return a + (b.items || []).length; }, 0);
            listEl.innerHTML = total
                ? '<div class="dw-empty">没有匹配「' + esc(TR.q) + '」的条目</div>'
                : '<div class="dw-empty">回收站是空的<div style="margin-top:6px;font-size:10px">删除的文件会先放到这里，可以随时恢复</div></div>';
            trSyncPicked();
            return;
        }
        var html = vis.map(function (b) {
            var head = '<div class="dw-group"><b>' + esc(trGroupLabel(b.at, b.batch)) + '</b>' +
                '<span>' + b.items.length + ' 项</span></div>';
            var rows = b.items.map(function (it) {
                var k = b.batch + '|' + it.relPath;
                var on = !!TR.picked[k];
                var name = String(it.fileName || it.relPath.split('/').pop() || '');
                var dir = String(it.relPath || '').split('/').slice(0, -1).join('/');
                var meta = trSize(it.size) + (it.kind === 'video' ? ' · 视频' : (it.kind === 'image' ? ' · 图片' : ''));
                return '<div class="dw-item' + (on ? ' on' : '') + '" data-row="' + esc(k) + '">' +
                    '<label class="dw-check"><input type="checkbox" data-pick="' + esc(k) + '"' + (on ? ' checked' : '') + '></label>' +
                    trThumb(it) +
                    '<div class="dw-body">' +
                    '<div class="dw-name" title="' + esc(name) + '">' + esc(name) + '</div>' +
                    '<div class="dw-path" title="' + esc(dir) + '">' + esc(dir || '（根目录）') + '</div>' +
                    '<div class="dw-meta">' + esc(meta) + '</div>' +
                    '</div>' +
                    '<div class="dw-acts">' +
                    '<button data-restore="' + esc(k) + '" title="恢复"><svg class="i"><use href="#i-rotate-cw"/></svg></button>' +
                    '<button class="del" data-purge="' + esc(k) + '" title="彻底删除（不可恢复）"><svg class="i"><use href="#i-trash-2"/></svg></button>' +
                    '</div></div>';
            }).join('');
            return head + rows;
        }).join('');
        listEl.innerHTML = html;
        trSyncPicked();
    }

    async function trReload() {
        var listEl = document.getElementById('dwList');
        if (listEl) { listEl.innerHTML = '<div class="dw-empty">读取中…</div>'; }
        try {
            TR.batches = root.VRTrash ? await root.VRTrash.list() : [];
        } catch (e) {
            TR.batches = [];
            if (listEl) { listEl.innerHTML = '<div class="dw-empty">读取失败：' + esc(e && e.message || '未知') + '</div>'; }
            return;
        }
        trRender();
    }

    async function openTrash() {
        var drawer = $('#drawer'), mask = $('#dwMask');
        if (!drawer) { return; }
        drawer.classList.add('show');
        if (mask) { mask.classList.add('show'); }
        trRender();
        /* 徽标在抽屉头部：只刷列表不刷计数，会出现「列表 1 项、角标 0」。 */
        try { await refreshDrawer(); } catch (e) { /* 忽略 */ }
        await trReload();
    }

    /* 恢复所选：逐条恢复，统计成功/失败，最后一次性播报。
     * 不用「全部恢复」那条路径 —— 用户选了哪些就只动哪些。 */
    async function trRestorePicked() {
        var picks = trPickedList();
        if (!picks.length || TR.busy) { return; }
        /* 恢复前预检冲突，避免用户点了之后发现静默失败。 */
        var conflicts = [];
        try {
            var pf = await root.VRTrash.preflightRestore();
            if (pf && pf.conflicts && pf.conflicts.length) {
                var want = {};
                picks.forEach(function (p) { want[p.relPath] = 1; });
                conflicts = pf.conflicts.filter(function (p) { return want[p]; });
            }
        } catch (e) { /* 预检失败不阻断，restore 自己也会兜 */ }
        var msg = '恢复所选 ' + picks.length + ' 项？文件会回到原来的相对路径。';
        if (conflicts.length) {
            msg += '\n\n注意：' + conflicts.length + ' 项原位置已有同名文件。' +
                '内容一样的会自动合并，内容不同的会改名成「_restored」恢复，都不会覆盖原文件。';
        }
        ask(msg, async function () {
            TR.busy = true; trSyncPicked();
            var okN = 0, failN = 0, firstErr = '';
            for (var i = 0; i < picks.length; i++) {
                var p = picks[i];
                if (picks.length > 2) { toast('正在恢复 ' + (i + 1) + '/' + picks.length + '…', { ms: 600000 }); }
                try {
                    var r = await root.VRTrash.restore(p.batch, p.relPath);
                    if (r && r.restored) { okN += r.restored; }
                    if (r && r.failed && r.failed.length) {
                        failN += r.failed.length;
                        if (!firstErr) { firstErr = (r.failed[0].message || r.failed[0].code || ''); }
                    } else if (!r || !r.restored) { failN++; }
                } catch (e) {
                    failN++;
                    if (!firstErr) { firstErr = String(e && e.message || '未知'); }
                }
                delete TR.picked[p.batch + '|' + p.relPath];
            }
            TR.busy = false;
            await load(); await refreshDrawer(); await trReload();
            if (failN) {
                toast('恢复完成：成功 ' + okN + ' 项，失败 ' + failN + ' 项' + (firstErr ? '（' + firstErr + '）' : ''));
            } else {
                toast('已恢复 ' + okN + ' 项');
            }
        });
    }

    /* 彻底删除所选：purge 是真正不可逆的，确认文案必须说清楚。 */
    async function trPurgePicked() {
        var picks = trPickedList();
        if (!picks.length || TR.busy) { return; }
        var sample = picks.length <= 3
            ? '\n\n' + picks.map(function (p) { return '· ' + String(p.relPath).split('/').pop(); }).join('\n')
            : '\n\n其中：' + String(picks[0].relPath).split('/').pop() + ' 等';
        ask('彻底删除所选 ' + picks.length + ' 项？\n\n这会连同文件一起删除，**无法恢复**。' + sample, async function () {
            TR.busy = true; trSyncPicked();
            var okN = 0, failN = 0;
            for (var i = 0; i < picks.length; i++) {
                var p = picks[i];
                try {
                    await root.VRTrash.purge(p.batch, p.relPath);
                    okN++;
                    delete TR.picked[p.batch + '|' + p.relPath];
                } catch (e) { failN++; }
            }
            TR.busy = false;
            await load(); await refreshDrawer(); await trReload();
            toast(failN ? ('已彻底删除 ' + okN + ' 项，' + failN + ' 项失败') : ('已彻底删除 ' + okN + ' 项'));
        });
    }

    /* ==========================================================
       补齐原型里「有按钮、没接线」的死键（E2E 交叉比对查出 23 个）。
       规矩：每个按钮点了必须有真实动作或明确提示，不许点了没反应。
       ========================================================== */

    /* 移动：应用内文件夹选择（move-picker.js），不让用户手写路径 */
    function moveHooks() {
        return {
            getEntry: function (rel) { return RAW[rel] || null; },
            toast: toast,
            onNeedAuth: function () {
                toast('移动素材要先授权素材目录（设置 → 保存位置）');
                /* 走 settingsBtn 的点击链路，弹窗自动填充当前设置（2026-11-10 抽屉改弹窗） */
                var sb = $('#settingsBtn');
                if (sb) { sb.click(); }
            },
            onDone: async function () {
                S.sel.clear(); S.select = false;
                var sb = $('#selectBtn'); if (sb) { sb.classList.remove('is-on'); }
                var bb = $('#batchbar'); if (bb) { bb.classList.add('hidden'); }
                await load();
            }
        };
    }

    function bindMissing() {
        var on = function (id, fn) { var el = document.getElementById(id); if (el) { el.addEventListener('click', fn); } };
        var byId = function (id) { return document.getElementById(id); };

        /* ---- 重命名 ---- */
        var renRel = '';
        function openRename(f) {
            if (!f) { toast('先选一条素材'); return; }
            renRel = f.relPath;
            var m = byId('renameMask'); if (!m) { return; }
            var inp = byId('renameInput');
            /* 输入框只放「名字本体」，扩展名单独显示并锁定（否则会改出打不开的文件） */
            var ext = String(f.ext || '').toLowerCase();
            var base = String(f.displayName || f.title || '');
            if (ext && base.toLowerCase().endsWith('.' + ext)) { base = base.slice(0, -(ext.length + 1)); }
            if (inp) { inp.value = base; }
            var extEl = byId('renameExt');
            if (extEl) { extEl.textContent = ext ? ('.' + ext) : ''; }
            var d = byId('renameDir');
            if (d) { d.textContent = String(f.relPath).split('/').slice(0, -1).join(' / '); }
            m.classList.add('show');
            setTimeout(function () { if (inp) { inp.focus(); inp.select(); } }, 40);
        }
        function closeRename() { var m = byId('renameMask'); if (m) { m.classList.remove('show'); } }
        on('renameCancel', closeRename);
        var rmask = byId('renameMask');
        if (rmask) { rmask.addEventListener('click', function (e) { if (e.target === rmask) { closeRename(); } }); }
        /* ADR-050 R2 口径：重命名只改显示名（displayName），物理文件名不动。
         * 原来的实现走 VRRename 做「复制→校验→删源」的物理改名，
         * 没有目录授权时必然失败——用户点了只看到「重命名失败」，
         * 等于这个功能没做。改成写 displayName：无需授权、可回退、不动磁盘。 */
        async function commitRename(v) {
            if (!root.VRDB || !root.VRDB.patchFile) { toast('数据层没就绪，请重新加载扩展'); return; }
            try {
                await root.VRDB.patchFile(renRel, { displayName: v });
                closeRename();
                toast('已重命名（物理文件名不变，可在列表显示新名字）');
                var h2 = document.querySelector('.pv-info h2');
                if (h2 && !document.getElementById('preview').classList.contains('hidden')) { h2.textContent = v; }
                await load();
            } catch (e) {
                toast('重命名失败：' + ((e && e.message) || '未知'));
            }
        }

        on('renameOk', async function () {
            var inp = byId('renameInput');
            var v = String((inp && inp.value) || '').trim();
            if (!v) { toast('文件名不能为空'); return; }
            /* 重名校验：库里两张卡片显示同一个名字时，用户无法区分是哪一张，
             * 再想改回来也找不到（批量改名成「旅行」这类场景特别容易撞）。
             * 只比显示名，不比物理文件名——重命名本来就不动磁盘。 */
            var dup = FILES.filter(function (f) {
                if (!f || f.relPath === renRel) { return false; }
                return String(f._title || '').trim() === v;
            });
            if (dup.length) {
                var d0 = dup[0];
                toast('已有同名素材：' + (d0.author ? (d0.author + ' · ') : '') + String(d0.relPath).split('/').slice(-1)[0] +
                    '；换个名字或点「仍然重命名」', {
                    label: '仍然重命名', ms: 12000,
                    onClick: function () { commitRename(v); }
                });
                return;
            }
            commitRename(v);
        });

        /* ---- 预览层右侧按钮 ---- */
        function curPreview() {
            return (root.VRPreview && root.VRPreview.current) ? root.VRPreview.current() : null;
        }

        /* ---- 键盘矩阵：列表卡片 Space/Enter、F2、Del、?、Ctrl/Cmd+A ---- */
        function focusedCard() {
            var el = document.activeElement;
            if (!el || !el.closest) { return null; }
            var card = el.closest('#grid .card');
            if (!card) { return null; }
            var id = card.getAttribute('data-id');
            for (var i = 0; i < FILES.length; i++) {
                if (FILES[i].id === id) { return FILES[i]; }
            }
            return null;
        }

        function cardElById(id) {
            var cards = document.querySelectorAll('#grid .card');
            for (var i = 0; i < cards.length; i++) {
                if (cards[i].getAttribute('data-id') === id) { return cards[i]; }
            }
            return null;
        }

        /* 方向键在网格里移动焦点：Tab 逐个走太慢，素材一多就没法用。
         * 目标还没渲染时，小库先追加分页；窗口化模式先按行高估位置滚动再重画。 */
        function moveCardFocus(key) {
            var cur = document.activeElement && document.activeElement.closest
                ? document.activeElement.closest('#grid .card') : null;
            if (!cur) { return false; }
            var list = S.list || [];
            var id = cur.getAttribute('data-id');
            var idx = -1, i;
            for (i = 0; i < list.length; i++) { if (list[i].id === id) { idx = i; break; } }
            if (idx < 0) { return false; }
            var grid = document.getElementById('grid');
            var cols = grid ? (gridCols(grid) || 1) : 1;
            var step = key === 'ArrowLeft' ? -1
                : key === 'ArrowRight' ? 1
                    : key === 'ArrowUp' ? -cols : cols;
            var next = idx + step;
            if (next < 0 || next >= list.length) { return false; }
            var target = list[next];
            var el = cardElById(target.id);
            if (!el && !win.on) {
                while (S.shown < next + 1 && S.shown < list.length) { appendMore(); }
                el = cardElById(target.id);
            } else if (!el && win.on) {
                var row = Math.floor(next / cols);
                var rowH = Math.max(120, win.rowH || 260);
                var top = grid ? (grid.getBoundingClientRect().top + window.pageYOffset) : 0;
                window.scrollTo(0, Math.max(0, top + row * rowH - 120));
                updateWindow(true);
                el = cardElById(target.id);
            }
            if (!el) { return false; }
            try { el.focus(); el.scrollIntoView({ block: 'nearest' }); } catch (err) { /* ignore */ }
            return true;
        }
        document.addEventListener('keydown', function (e) {
            var el = document.activeElement;
            var tag = el ? el.tagName : '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) { return; }
            var preview = document.getElementById('preview');
            var previewOpen = !!(preview && !preview.classList.contains('hidden'));

            if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !e.ctrlKey && !e.metaKey && !e.altKey) {
                var ks = byId('keysheet');
                if (ks) { ks.classList.toggle('show'); e.preventDefault(); }
                return;
            }
            if (e.key === 'Escape') {
                var k = byId('keysheet'); if (k) { k.classList.remove('show'); }
                var cm = byId('confirmMask'); if (cm) { cm.classList.remove('show'); }
                closeRename();
                return;
            }
            if ((e.key === ' ' || e.key === 'Enter') && tag !== 'BUTTON' && tag !== 'A') {
                if (previewOpen) { return; }
                var f = focusedCard();
                if (f) { e.preventDefault(); openPreview(f); }
                return;
            }
            if (e.key === 'F2') {
                var rf = focusedCard() || (previewOpen ? curPreview() : null);
                if (rf) { e.preventDefault(); openRename(rf); }
                return;
            }
            if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
                var sf = focusedCard() || (previewOpen ? curPreview() : null);
                if (sf) { e.preventDefault(); starCard(sf); }
                return;
            }
            /* 预览层内方向键另有语义（视频 ±5 秒 / 图片缩放），这里不接管 */
            if (!previewOpen && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
                e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                if (moveCardFocus(e.key)) { e.preventDefault(); }
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                var df = focusedCard();
                if (!df) { return; }
                e.preventDefault();
                if (!window.__vrPerm || !window.__vrPerm.writable) {
                    toast('删除素材要先授权素材目录');
                    return;
                }
                ask('把「' + (df.title || df.fileName) + '」移入回收站？文件还能恢复。', async function () {
                    try {
                        var rrD = await root.VRTrash.remove([df.relPath]);
                        await load(); await refreshDrawer();
                        toastTrashResult(rrD, '已移入回收站', function () { retryTrashOne(df.relPath); });
                    } catch (err) { toast('删除失败：' + ((err && err.message) || '未知')); }
                });
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && !previewOpen) {
                e.preventDefault();
                S.select = true;
                S.sel = new Set((S.list || FILES).map(function (f) { return f.id; }));
                var sb = byId('selectBtn'); if (sb) { sb.classList.add('is-on'); }
                var bb = byId('batchbar'); if (bb) { bb.classList.remove('hidden'); }
                render();
            }
        }, true);

        on('pvRename', function () { openRename(curPreview()); });
        on('pvDelete', async function () {
            var f = curPreview(); if (!f) { return; }
            markWritePending();
            if (!(await ensureWriteAccess())) { return; }
            ask('把「' + (f.title || f.fileName) + '」移入回收站？文件还能恢复。', async function () {
                if (!root.VRTrash) { toast('回收站模块没加载'); return; }
                try {
                    var rr0 = await root.VRTrash.remove([f.relPath]);
                    if (root.VRPreview) { root.VRPreview.close(); }
                    await load(); await refreshDrawer();
                    if (rr0 && rr0.failed && rr0.failed.length) {
                        toastTrashResult(rr0, '', function () { retryTrashOne(f.relPath); });
                    } else if (rr0 && rr0.moved > 0 && rr0.batch) {
                        toast('已移入回收站', {
                            label: '撤销', ms: 8000,
                            onClick: async function () {
                                try {
                                    await root.VRTrash.restore(rr0.batch);
                                    toast('已撤销删除');
                                    await load(); await refreshDrawer();
                                } catch (e2) { toast('撤销失败：' + ((e2 && e2.message) || '未知')); }
                            }
                        });
                    } else {
                        toast('已移入回收站');
                    }
                } catch (e) { toast('删除失败：' + ((e && e.message) || '未知')); }
            });
        });
        on('pvReveal', function () { revealFile(curPreview()); });
        on('pvMove', async function () {
            var f = curPreview(); if (!f) { return; }
            if (!root.VRMovePicker) { toast('移动模块没加载，请刷新页面'); return; }
            markWritePending();
            if (!(await ensureWriteAccess())) { return; }
            root.VRMovePicker.open([f], moveHooks());
        });
        /* 右键菜单回调：复用这一层已有的 openRename / ask / 定位实现 */
        if (typeof initCtxMenu === 'function') {
            initCtxMenu({
                rename: function (f) { openRename(f); },
                reveal: function (f) { revealFile(f); },
                remove: async function (f) {
                    if (!f) { return; }
                    if (typeof ensureWriteAccess === 'function' && !(await ensureWriteAccess())) { return; }
                    ask('把「' + (f._title || f.title || f.fileName) + '」移入回收站？文件还能恢复。', async function () {
                        if (!root.VRTrash) { toast('回收站模块没加载'); return; }
                        try {
                            var rrC = await root.VRTrash.remove([f.relPath]);
                            if (root.VRPreview) { root.VRPreview.close(); }
                            await load(); await refreshDrawer();
                            toastTrashResult(rrC, '已移入回收站', function () { retryTrashOne(f.relPath); });
                        } catch (e) { toast('删除失败：' + ((e && e.message) || '未知')); }
                    });
                }
            });
        }

        var permAuth = byId('permAuth');
        if (permAuth) {
            permAuth.addEventListener('click', async function () {
                if (!window.__vrPerm || window.__vrPerm.writable) { openOptions(); return; }
                if (window.__vrPerm.rootInvalid) { await authorizeRoot(); return; }
                /* 已有正确句柄：先沿用句柄申请权限；失败/没有句柄再弹目录选择。 */
                var saved = window.__vrPerm.handle;
                if (saved && typeof saved.requestPermission === 'function') {
                    try {
                        var st = await saved.requestPermission({ mode: 'readwrite' });
                        if (st === 'granted') {
                            var rr0 = await root.VRIndex.resolveRoot();
                            await root.VRIndex.setRoot(saved, rr0.absRoot, rr0.prefix);
                            toast('已恢复写入权限');
                            await refreshPermState();
                            return;
                        }
                    } catch (e) { /* 落到重新选择 */ }
                }
                await authorizeRoot();
            });
        }

        on('pvHelpBtn', function () {
            var k = byId('keysheet'); if (k) { k.classList.add('show'); }
        });
        on('ksClose', function () {
            var k = byId('keysheet'); if (k) { k.classList.remove('show'); }
        });
        on('pvMoreAll', function () {
            var f = curPreview(); if (!f) { return; }
            var who = String(f.author || '').replace(/\(@[^)]*\)\s*$/, '').trim();
            if (!who) { toast('这条没记作者信息'); return; }
            var se = byId('search');
            if (se) { se.value = who; se.dispatchEvent(new Event('input', { bubbles: true })); }
            if (root.VRPreview) { root.VRPreview.close(); }
            toast('已按作者「' + who + '」筛选');
        });
        on('autoBtn', function (ev) {
            var b = ev.currentTarget || byId('autoBtn');
            var next = !(b && b.classList.contains('on'));
            if (b) { b.classList.toggle('on', next); b.setAttribute('aria-pressed', next ? 'true' : 'false'); }
            if (root.VRPreview && root.VRPreview.setAuto) { root.VRPreview.setAuto(next); }
            toast(next ? '连播：开' : '连播：关');
        });

        // 左侧栏「回收站」入口（此前只有设置抽屉里的那个有绑定）
        var sideTrash = byId('trashBtn');
        if (sideTrash) { sideTrash.addEventListener('click', function () { openTrash(); }); }
    }

    function bindFavAndDrawer() {
        /* 收藏区已改为平铺（2026-11-07）：不再有 favMenuBtn / favMenu 弹层。
         * 原来那两行 toggle 现在会拿到 null，留着只会误导后来人。 */
        var favList = $('#favList');
        if (favList) {
            favList.addEventListener('click', function (e) {
                var row = e.target.closest('.fav-row'); if (!row) { return; }
                var id = row.dataset.fav;
                S.fav = (S.fav === id) ? null : id;
                renderFavs(); render();
            });
        }
        /* 2026-11-08 苏哥拍板：收藏夹不命名、不新建。
         * 侧栏只有一行「收藏」，点击即筛选；分类交给标签。
         * 原先的 createFav（收藏夹名字输入框 + 创建按钮）已随 DOM 一并删除。 */

        /* ---------- 标签区（默认折叠） ---------- */
        /* 展开/收起：就地展开，不弹层。收起时仍能看见当前筛了哪些标签，
         * 否则用户筛完收起后不知道自己在看什么。 */
        var tagToggle = $('#tagToggle');
        if (tagToggle) {
            tagToggle.addEventListener('click', function () {
                var side = $('#tagSide');
                if (!side) { return; }
                var open = !side.classList.contains('open');
                side.classList.toggle('open', open);
                tagToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
        }
        var tagList = $('#tagList');
        if (tagList) {
            tagList.addEventListener('click', function (e) {
                /* 行尾的改名/删除按钮先拦下，别让它顺带触发筛选 */
                var ren = e.target.closest('[data-tag-rename]');
                if (ren) { e.stopPropagation(); renameTag(ren.getAttribute('data-tag-rename')); return; }
                var del = e.target.closest('[data-tag-del]');
                if (del) { e.stopPropagation(); deleteTag(del.getAttribute('data-tag-del')); return; }
                if (e.target.closest('#tagMore')) {
                    tagExpanded = !tagExpanded; renderTags(); return;
                }
                var row = e.target.closest('.tag-row'); if (!row) { return; }
                var key = row.getAttribute('data-tag');
                if (!key) { return; }
                var i = S.tags.indexOf(key);
                /* Ctrl/⌘ 点 = 叠加（取交集）；普通点 = 只留这一个，再点同一个则取消。
                 * 这样「点一个换一个」是默认心智，「多选」才需要按住修饰键。 */
                if (e.ctrlKey || e.metaKey) {
                    if (i >= 0) { S.tags.splice(i, 1); } else { S.tags.push(key); }
                } else {
                    S.tags = (i >= 0 && S.tags.length === 1) ? [] : [key];
                }
                renderTags(); render();
            });
        }
        var tagOk = $('#tagNewOk');
        if (tagOk) { tagOk.addEventListener('click', createTag); }
        var tagInp = $('#tagNewInput');
        if (tagInp) { tagInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { createTag(); } }); }

        var bmBtn = $('#batchMove');
        if (bmBtn) {
            bmBtn.addEventListener('click', async function () {
                var list = FILES.filter(function (f) { return S.sel.has(f.id); });
                if (!list.length) { toast('先选素材'); return; }
                if (!root.VRMovePicker) { toast('移动模块没加载，请刷新页面'); return; }
                markWritePending();
                if (!(await ensureWriteAccess())) { return; }
                root.VRMovePicker.open(list, moveHooks());
            });
        }

        var bf = $('#batchFav');
        if (bf) { bf.addEventListener('click', function () { addToFav(Array.from(S.sel)); }); }

        // 设置弹窗（2026-11-10：换目录/扫描/回收站已从弹窗移除——主页均有入口）
        var optLink = $('#sdOptionsLink');
        if (optLink) { optLink.addEventListener('click', function (e) { e.preventDefault(); openOptions(); }); }
        var rebuildBtn = $('#sdRebuildBtn');
        if (rebuildBtn) { rebuildBtn.addEventListener('click', async function () {
            toast('正在重建索引…');
            // 先走不需要授权的下载记录模式，别一上来就要目录权限（2026-11-05 修复）
            var done = false;
            try { await root.VRIndex.build({ mode: 'downloads' }); done = true; } catch (e) { /* 下一档 */ }
            if (!done) {
                try { await root.VRIndex.build({ mode: 'full' }); done = true; }
                catch (e) { toast('重建失败：' + (e && e.message || '未知')); }
            }
            if (done) { await load(); toast('索引重建完成'); }
            await refreshDrawer();
        }); }
        var dupBtn = $('#sdDupBtn');
        if (dupBtn) {
            dupBtn.addEventListener('click', async function () {
                if (!root.VRDedup || !root.VRDedup.scan) { toast('去重模块没加载'); return; }
                if (dupBtn.disabled) { return; }
                dupBtn.disabled = true;
                var old = dupBtn.textContent;
                dupBtn.textContent = '扫描中…';
                try {
                    var r = await root.VRDedup.scan();
                    var val = $('#sdDupVal');
                    if (!r.groups.length) {
                        if (val) { val.textContent = '没有重复'; }
                        toast('没有发现内容重复的素材');
                    } else {
                        var saved = fmt(r.reclaimBytes / 1048576);
                        if (val) { val.textContent = r.groups.length + ' 组 · ' + r.items + ' 条 · 可省 ' + saved; }
                        toast('发现 ' + r.groups.length + ' 组重复（' + r.items + ' 条，可省 ' + saved + '）');
                        /* 扫描只报告；整理必须用户点头（会删物理副本，不可逆）。
                         * 苏哥口径：物理只留一份，索引保留多份（引用制）。 */
                        var ask = '发现 ' + r.groups.length + ' 组内容相同的素材，共 ' + r.items + ' 条。\n' +
                            '整理后物理文件只留 1 份（约省 ' + saved + '），库里仍保留全部索引卡片。\n' +
                            '被合并的卡片会变成指向原件的引用，可正常预览/重命名。\n\n现在整理吗？';
                        if (root.confirm && root.confirm(ask)) {
                            dupBtn.textContent = '整理中…';
                            /* 两步走：
                             * ① 补算历史指纹 —— 必须回 SW（扩展页读 file:// 受限）
                             * ② 合并 —— 必须在本页（删文件要用 FSA 句柄，SW 没有）
                             * 删不掉就不改库：宁可少合并，也不能让索引指向已删文件。 */
                            var h = await new Promise(function (res) {
                                try {
                                    root.chrome.runtime.sendMessage(
                                        { Message: 'vrDedup.hashMissing', maxHash: 800 },
                                        function (x) {
                                            void (root.chrome.runtime.lastError);
                                            res(x || { ok: false });
                                        });
                                } catch (e) { res({ ok: false }); }
                            });
                            if (!h || !h.ok) { toast('补算指纹失败：' + ((h && h.message) || '未知')); }
                            var c = await root.VRDedup.compact({
                                remove: function (rel) {
                                    return (root.VRTrash && root.VRTrash.removeAt)
                                        ? root.VRTrash.removeAt(rel) : Promise.resolve(false);
                                }
                            });
                            if (val) {
                                val.textContent = '已合并 ' + c.merged + ' 条 · 释放 ' + fmt(c.removedBytes / 1048576) +
                                    ((h && h.hashed) ? ' · 补指纹 ' + h.hashed : '') +
                                    (c.failed ? ' · 失败 ' + c.failed : '');
                            }
                            toast('整理完成：合并 ' + c.merged + ' 条，释放 ' + fmt(c.removedBytes / 1048576));
                            try { if (root.VRIndex && root.VRIndex.scheduleSnapshot) { root.VRIndex.scheduleSnapshot(2000); } } catch (eS) { /* 忽略 */ }
                            await load();
                        }
                    }
                } catch (e) {
                    toast('扫描重复失败：' + ((e && e.message) || '未知'));
                } finally {
                    dupBtn.disabled = false;
                    dupBtn.textContent = old;
                }
            });
        }
        var dwClose = $('#dwClose');
        if (dwClose) { dwClose.addEventListener('click', function () { closeTrash(); }); }
        var dwMask = $('#dwMask');
        if (dwMask) { dwMask.addEventListener('click', function () { closeTrash(); }); }
        function closeTrash() {
            var d = $('#drawer'), m = $('#dwMask');
            if (d) { d.classList.remove('show'); }
            if (m) { m.classList.remove('show'); }
        }
        var dwList = $('#dwList');
        if (dwList) {
            /* 勾选框：只改选择状态，不重排列表（重排会让正在点的行跳位）。 */
            dwList.addEventListener('change', function (e) {
                var cb = e.target.closest && e.target.closest('[data-pick]');
                if (!cb) { return; }
                var k = cb.dataset.pick;
                if (cb.checked) { TR.picked[k] = 1; } else { delete TR.picked[k]; }
                var row = cb.closest('.dw-item');
                if (row) { row.classList.toggle('on', !!cb.checked); }
                trSyncPicked();
            });
            dwList.addEventListener('click', async function (e) {
                /* 点行本身也能切换勾选（勾选框太小，手机上不好点） */
                var restoreBtn = e.target.closest && e.target.closest('[data-restore]');
                var purgeBtn = e.target.closest && e.target.closest('[data-purge]');
                if (!restoreBtn && !purgeBtn) {
                    var row = e.target.closest && e.target.closest('[data-row]');
                    if (row && !(e.target.closest('input'))) {
                        var k = row.dataset.row;
                        if (TR.picked[k]) { delete TR.picked[k]; } else { TR.picked[k] = 1; }
                        trRender();
                    }
                    return;
                }
                /* 单条恢复 */
                if (restoreBtn) {
                    var pk = String(restoreBtn.dataset.restore || '');
                    var sep = pk.indexOf('|');
                    var batch = pk.slice(0, sep), rel = pk.slice(sep + 1);
                    if (!batch || !rel) { return; }
                    restoreBtn.disabled = true;
                    try {
                        var r = await root.VRTrash.restore(batch, rel);
                        if (r && r.restored) {
                            delete TR.picked[pk];
                            var re0 = (r.renamed && r.renamed[0]) || null;
                            if (re0) {
                                toast('已恢复，但原位置有同名文件，改名为 ' +
                                    String(re0.to).split('/').pop(), { ms: 6000 });
                            } else {
                                toast('已恢复');
                            }
                        } else {
                            var why = (r && r.failed && r.failed[0] && (r.failed[0].message || r.failed[0].code)) || '未知';
                            toast('恢复失败：' + why, { ms: 6000 });
                        }
                        await load(); await refreshDrawer(); await trReload();
                    } catch (err) {
                        toast('恢复失败：' + (err && err.message || '未知'));
                        restoreBtn.disabled = false;
                    }
                    return;
                }
                /* 单条彻底删除 */
                var pk2 = String(purgeBtn.dataset.purge || '');
                var sep2 = pk2.indexOf('|');
                var batch2 = pk2.slice(0, sep2), rel2 = pk2.slice(sep2 + 1);
                if (!batch2 || !rel2) { return; }
                var nm = String(rel2).split('/').pop();
                ask('彻底删除「' + nm + '」？\n\n这会连同文件一起删除，**无法恢复**。', async function () {
                    purgeBtn.disabled = true;
                    try {
                        await root.VRTrash.purge(batch2, rel2);
                        delete TR.picked[pk2];
                        toast('已彻底删除');
                        await load(); await refreshDrawer(); await trReload();
                    } catch (err) {
                        toast('彻底删除失败：' + (err && err.message || '未知'));
                        purgeBtn.disabled = false;
                    }
                });
            });
        }

        /* 搜索：输入即过滤，不请求磁盘（清单已在内存）。 */
        var dwSearch = $('#dwSearch');
        if (dwSearch) {
            dwSearch.addEventListener('input', function () {
                TR.q = String(dwSearch.value || '');
                trRender();
            });
        }

        /* 全选 / 取消全选：作用于「当前筛选结果」，与搜索口径一致。 */
        var dwSelAll = $('#dwSelAll');
        if (dwSelAll) {
            dwSelAll.addEventListener('click', function () {
                var vis = trVisible();
                var total = vis.reduce(function (a, b) { return a + b.items.length; }, 0);
                var cur = Object.keys(TR.picked).length;
                if (cur >= total && total > 0) {
                    TR.picked = {};
                } else {
                    vis.forEach(function (b) {
                        b.items.forEach(function (it) { TR.picked[b.batch + '|' + it.relPath] = 1; });
                    });
                }
                trRender();
            });
        }

        var dwPickAll = $('#dwPickAll');
        if (dwPickAll) {
            dwPickAll.addEventListener('change', function () {
                if (dwPickAll.checked) {
                    trVisible().forEach(function (b) {
                        b.items.forEach(function (it) { TR.picked[b.batch + '|' + it.relPath] = 1; });
                    });
                } else {
                    TR.picked = {};
                }
                trRender();
            });
        }

        var dwRestoreSel = $('#dwRestoreSel');
        if (dwRestoreSel) { dwRestoreSel.addEventListener('click', trRestorePicked); }
        var dwPurgeSel = $('#dwPurgeSel');
        if (dwPurgeSel) { dwPurgeSel.addEventListener('click', trPurgePicked); }

        var dwEmpty = $('#dwEmpty');
        if (dwEmpty) { dwEmpty.addEventListener('click', async function () {
            var st;
            try { st = await root.VRTrash.status(); } catch (e) { st = { count: 0 }; }
            if (!st || !st.count) { toast('回收站是空的'); return; }
            ask('清空回收站？\n\n里面 ' + st.count + ' 项文件会被**彻底删除**，无法恢复。',
                async function () {
                    try {
                        await root.VRTrash.empty();
                        TR.picked = {};
                        toast('回收站已清空');
                        /* 清空同时删了索引行与缩略图：主页必须重新读一次库，
                         * 否则「清空了但卡片还在」——原实现只刷回收站抽屉。 */
                        await load(); await refreshDrawer(); await trReload();
                        /* 清空后弹窗里只剩空态，继续开着没有意义 —— 自动关窗
                         * （2026-11-12 苏哥报「清空之后窗口应该自动关闭」）。
                         * 只对「清空」这么做；「彻底删除所选」可能只删了一部分，
                         * 用户还要接着挑，关掉反而碍事。 */
                        closeTrash();
                    } catch (e) { toast('清空失败：' + (e && e.message || '未知')); }
                });
        }); }
        var dwRestoreAll = $('#dwRestoreAll');
        if (dwRestoreAll) { dwRestoreAll.addEventListener('click', async function () {
            if (S.batchBusy) { return; }
            try {
                /* 「全部恢复」是破坏性操作：原来直接循环恢复，没有确认也没有冲突预检。
                 * 若原位置已有同名文件，restore() 会逐条失败，用户事先完全不知情。 */
                var pf = root.VRTrash.preflightRestore
                    ? await root.VRTrash.preflightRestore()
                    : { total: 0, conflicts: [] };
                if (!pf.total) { toast('回收站是空的'); return; }
                var warn = '';
                if (pf.conflicts.length) {
                    /* 2026-11-12：恢复不再「同名即失败」。内容一致自动消重，
                     * 内容不同自动改名（_restored），全程不覆盖。 */
                    warn = '\n\n注意：' + pf.conflicts.length + ' 项原位置已有同名文件。' +
                        '内容一样的会自动合并（不留副本），内容不同的会改名成「_restored」恢复，都不会覆盖原文件。\n例：' +
                        String(pf.conflicts[0]).split('/').pop();
                }
                S.batchBusy = true;
                ask('恢复回收站里的全部 ' + pf.total + ' 项？文件会回到原来的相对路径。' + warn, async function () {
                    try {
                        var batches = await root.VRTrash.list();
                        var okN = 0, failN = 0, reN = 0;
                        for (var i = 0; i < batches.length; i++) {
                            toast('正在恢复 ' + (i + 1) + '/' + batches.length + ' 批…', { ms: 600000 });
                            var r = await root.VRTrash.restore(batches[i].batch);
                            okN += (r && r.restored) || 0;
                            reN += (r && r.renamed && r.renamed.length) || 0;
                            failN += (r && r.failed && r.failed.length) || 0;
                        }
                        var msg = '已恢复 ' + okN + ' 项';
                        if (reN) { msg += '（其中 ' + reN + ' 项因同名改名恢复）'; }
                        if (failN) { msg += '，' + failN + ' 项失败'; }
                        toast(msg);
                        /* 恢复后清单整体变了，残留的勾选指向已不存在的条目，
                         * 不清掉会让紧随其后的批量操作带上脏数据。 */
                        TR.picked = {};
                        await load(); await refreshDrawer(); await trReload();
                    } catch (e) {
                        toast('恢复失败：' + (e && e.message || '未知'));
                    } finally {
                        S.batchBusy = false;
                    }
                });
            } catch (e) {
                S.batchBusy = false;
                toast('恢复失败：' + (e && e.message || '未知'));
            }
        }); }
    }

    /* ---------- 启动 ---------- */
    async function boot() {
        try { window.__vrBoot = ['start']; } catch (e) { /* 忽略 */ }
        try { installGlobalErrorGuard(); } catch (e) { /* 忽略 */ }
        /* 立刻铺骨架，别让用户在 2 秒空窗里以为库是空的。 */
        try { renderSkeleton(8); } catch (e) { /* 忽略 */ }
        try { bind(); window.__vrBoot.push('bind'); } catch (e) { window.__vrBoot.push('bind-ERR:' + e.message); throw e; }
        try { bindMissing(); window.__vrBoot.push('bindMissing'); } catch (e) { window.__vrBoot.push('bindMissing-ERR'); }
        try { initCtxMenu(); window.__vrBoot.push('ctx'); } catch (e) { window.__vrBoot.push('ctx-ERR:' + e.message); }
        try { bindConfirm(); window.__vrBoot.push('confirm'); } catch (e) { window.__vrBoot.push('confirm-ERR:' + e.message); }
        try { await loadFavs(); window.__vrBoot.push('favs'); } catch (e) { window.__vrBoot.push('favs-ERR:' + e.message); }
        /* 站点名缓存必须在首次渲染前读入（2026-11-10 F1）。
         * VRSiteRegistry.buildRows() 读的是 VRSiteNameStore 的同步内存镜像；
         * 库页过去从不调用 ready()，镜像恒为 null，自动学习层整体缺席，
         * 左栏只剩预置表 —— 小网站就全部显示成域名。
         * 这里 await 后再 refresh()，保证 load() 里的第一次 renderTree() 用上新索引。 */
        try {
            if (root.VRSiteNameStore && root.VRSiteRegistry) {
                await root.VRSiteNameStore.ready();
                root.VRSiteRegistry.refresh();
                window.__vrBoot.push('siteNames');
            }
        } catch (e) { window.__vrBoot.push('siteNames-ERR:' + (e && e.message || '')); }
        try { readLastScan(); } catch (e) { window.__vrBoot.push('scan-ERR'); }
        try { await ensureRoot(); window.__vrBoot.push('root'); } catch (e) { window.__vrBoot.push('root-ERR:' + e.message); }
        try { await refreshPermState(); window.__vrBoot.push('perm'); } catch (e) { window.__vrBoot.push('perm-ERR:' + e.message); }
        try { await load(); window.__vrBoot.push('load:' + FILES.length); } catch (e) { window.__vrBoot.push('load-ERR:' + e.message); }
        if (!FILES.length) {
            /* 索引建完必须重新读一次库（不管 build 返回什么）： */
            try { await autoIndex(); } catch (e) { /* 未授权等，落到空态 */ }
            await load();
        }
        /* 回收站计数必须在启动时刷一次。
         * 2026-11-06 实测：status() 明明返回 count=15、batches=4，
         * 但侧栏徽标一直停在初始的「0」且 hidden（设置抽屉里的「回收站」也显示 —）。
         * 原因是这里从来没调用过 refreshDrawer() —— 只有用户手动点开设置抽屉、
         * 或做过一次删除之后才会刷新。于是「回收站里明明有文件，界面上一个数字都没有」，
         * 看起来就像这个功能没做。 */
        try { await refreshDrawer(); window.__vrBoot.push('drawer'); }
        catch (e) { window.__vrBoot.push('drawer-ERR:' + (e && e.message || '')); }

        /* 孤儿缩略图清理：首屏之后延迟跑一次，静默失败（B-33） */
        try { scheduleThumbGC(); window.__vrBoot.push('thumbGC'); } catch (e) { /* 忽略 */ }

        /* 回收站/索引对账自愈：修历史脏数据（死回收站条目、前缀重复索引）。
         * 见 VRTrash.sweep()：只动索引，不动文件，失败静默。 */
        try { scheduleTrashSweep(); window.__vrBoot.push('trashSweep'); } catch (e) { /* 忽略 */ }

        /* 历史站点名自动补齐（2026-11-10 F4，苏哥拍板）：
         * 库里老条目的 platform 只有域名，下载那一刻没抓过站名。
         * 首屏之后异步串行探测公开首页，学到的名字刷新左栏；
         * 失败/超时都不影响浏览，也不搬动磁盘目录。 */
        try {
            if (root.VRSiteNameFill) {
                root.VRSiteNameFill.start();
                window.__vrBoot.push('siteNameFill');
            }
        } catch (e) { window.__vrBoot.push('siteNameFill-ERR:' + (e && e.message || '')); }
    }

    /**
     * 启动后延迟跑一次回收站索引对账（2026-11-09）。
     *
     * 为什么必须自愈而不是让用户点：
     *   存量库里有两类脏数据是「删除/清空操作本身修不掉」的 ——
     *   ① 同一物理文件有两条索引（老版本没有 video-rod 前缀），删一条另一条变死卡；
     *   ② 上次清空做到一半（缩略图/索引没删干净），残留条目永远恢复不了也删不掉。
     *   用户没有任何入口能修它们，只能靠启动时静默收尾。
     */
    function scheduleTrashSweep() {
        var run = function () {
            try {
                if (!root.VRTrash || typeof root.VRTrash.sweep !== 'function') { return; }
                if (!window.__vrPerm || !window.__vrPerm.handle) { return; }   // 没授权就别碰
                root.VRTrash.sweep().then(function (r) {
                    if (!r) { return; }
                    if (r.revived || r.dropped || r.merged) {
                        try { console.info('[trash-sweep] 修复索引脏数据', r); } catch (e) { /* 忽略 */ }
                        /* 真的动了数据才重绘：没动就别白白重排一次列表 */
                        try { load(); } catch (e2) { /* 忽略 */ }
                        try { refreshDrawer(); } catch (e3) { /* 忽略 */ }
                    }
                }, function () { /* 静默 */ });
            } catch (e) { /* 静默：对账失败不影响浏览 */ }
        };
        setTimeout(run, 2500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    /**
     * 启动后台清理孤儿缩略图（B-33 / US-2）。
     *
     * 为什么放在启动后延迟执行：
     *   · 必须等 FILES 加载完才知道哪些 thumbFile 是「活的」；
     *   · 必须避开首屏渲染，否则上万条遍历会拖慢打开速度；
     *   · 失败必须完全静默 —— 清垃圾失败不该打断用户浏览。
     */
    function scheduleThumbGC() {
        var run = function () {
            try {
                if (!root.VRThumbs || typeof root.VRThumbs.gc !== 'function') { return; }
                if (typeof root.VRIndex === 'undefined' || !root.VRIndex) { return; }
                root.VRThumbs.gc({ entries: FILES }).then(function (r) {
                    if (r && r.removed) {
                        try { console.info('[thumb-gc] 清理孤儿缩略图', r.removed, '个'); } catch (e) { /* 忽略 */ }
                    }
                }, function () { /* 静默 */ });
            } catch (e) { /* 静默：清垃圾失败不影响浏览 */ }
        };
        /* 首屏渲染之后再跑，且只跑一次 */
        setTimeout(run, 8000);
    }

    root.VRApp = {
        reload: load,
        toast: toast,
        getFiles: function () { return FILES; },
        /* 原始条目表（relPath → DB 行）：预览器取实况视频的 absPath 用。
         * 只读引用，不要改里面的对象（2026-11-11 B-71）。 */
        getRaw: function () { return RAW; },
        /* 空态钩子：自动化测试用，直接按给定条件重绘空态，不改真实数据。 */
        _renderEmpty: function (n, over) { renderEmpty(n, over); },
        /* 定位钩子：自动化测试用，直接驱动 revealFile 的无路径分支。 */
        _revealFile: function (f) { revealFile(f); },
        render: function () { render(); },
        /* 站名补齐后只重绘左栏树，不重读数据库（VRSiteNameFill 用） */
        renderTree: function () { renderTree(); },
        /* 骨架屏钩子：只给自动化测试用，正常启动由 boot() 自己调用。 */
        _renderSkeleton: function (n) { renderSkeleton(n); },
        /* 压测入口（B-14）：把合成条目塞进渲染链路，验证大库窗口化。
         * 只在显式调用时生效，不影响正常启动。 */
        _renderFake: function (n) {
            var base = FILES[0] || {};
            var fake = [];
            for (var i = 0; i < n; i++) {
                fake.push(Object.assign({}, base, {
                    id: 'fake/' + i, relPath: 'fake/' + i + '.jpg',
                    title: 't' + i, _title: 't' + i, kind: 'image', ext: 'JPG',
                    tags: [], starred: false, state: 'ok', isRef: 0, sha256: ''
                }));
            }
            FILES = fake;
            RAW = {};
            fake.forEach(function (e) { RAW[e.relPath] = e; });
            var t0 = performance.now();
            render();
            return {
                ms: Math.round(performance.now() - t0),
                domCards: document.querySelectorAll('#grid .card').length,
                total: n,
                padTop: document.getElementById('grid').style.paddingTop,
                padBottom: document.getElementById('grid').style.paddingBottom
            };
        }
    };
    root.VRFav = { toggleStar: toggleStar, addToFav: addToFav, addToDefault: addToDefault, hasFavorite: hasFavorite };
})();
