/**
 * 苏哥的钓鱼竿 —— 侧边栏图片页（image.html）
 *
 * 职责边界（与既有模块不重叠）：
 *   · 扫描口径归 js/lib-image-util.js（scanImages + scanBackgrounds）
 *   · 落盘与防盗链归 background.js 的 vrImg.batch（DNR 补 Referer、FSA 直写保文件名）
 *   · 页面内浮标/悬停归 image-panel.js / image-hover.js，本文件不碰页面 DOM
 *
 * 本文件只做：在扩展页里取目标 tab → 注入扫描 → 渲染网格 → 勾选 → 发批量消息。
 *
 * 关键约束（踩过才记住的）：
 *   · image.html 是**扩展页面**，读不到网页 DOM，必须 chrome.scripting.executeScript
 *   · 注入函数运行在 isolated world，那里有 manifest 注入的 self.VRImageUtil
 *   · 注入函数的返回值必须可结构化克隆，不能带 DOM 节点
 */
(() => {
    'use strict';

    const U = self.VRImageUtil;
    if (!U) { return; }

    const PAGE_SIZE = 60;          // 首屏 + 滚动追加的批量大小

    /* ---------------- 状态 ---------------- */

    let tabId = -1;
    let pageUrl = '';
    let pageTitle = '';
    let settings = U.mergeSettings({});
    let items = [];                // [{url,w,h,bg,candidates,key,done,orig}]
    let selected = new Set();      // 选中的 key
    let rendered = 0;
    let tierMin = 0;   // 0 = 全部（含尺寸未知的懒加载图）；TIER_UNKNOWN = 只看尺寸未知
    /* 2026-11-09（苏哥报）：尺寸未知的图混在「大 ≥1200」里，看着像筛选没生效。
     * 现在把它单列成一档。用 -1 而不是 0：0 已经被「全部」占了，且
     * `shortSide < 0` 恒为假，能安全复用同一套比较。 */
    const TIER_UNKNOWN = -1;
    let keyword = '';
    let downloaded = Object.create(null);   // 已下载去重表（归一化 URL → 1）
    let filteredOut = 0;                    // 被过滤规则拦下的张数（底部要明示）
    let batchId = '';
    let running = false;

    const $ = id => document.getElementById(id);
    const el = {
        site: $('ipSite'), count: $('ipCount'), search: $('ipSearch'),
        rescan: $('ipRescan'), openVideo: $('ipOpenVideo'), album: $('ipAlbum'),
        library: $('ipLibrary'),
        more: $('ipMore'), moreMenu: $('ipMoreMenu'), webp: $('ipWebp'),
        tiers: $('ipTiers'), body: $('ipBody'), grid: $('ipGrid'),
        empty: $('ipEmpty'), emptyT: $('ipEmptyT'), emptyS: $('ipEmptyS'),
        all: $('ipAll'), sum: $('ipSum'), dl: $('ipDl'),
        prog: $('ipProg'), progT: $('ipProgT'), progBar: $('ipProgBar'), progX: $('ipProgX'),
        lb: $('ipLb'), lbImg: $('ipLbImg'), lbName: $('ipLbName'),
        lbUrl: $('ipLbUrl'), lbChain: $('ipLbChain'), lbDl: $('ipLbDl'),
        lbClose: $('ipLbClose'), lbPrev: $('ipLbPrev'), lbNext: $('ipLbNext')
    };

    /* ---------------- 工具 ---------------- */

    function send(msg) {
        return new Promise(resolve => {
            try {
                chrome.runtime.sendMessage(msg, res => {
                    void chrome.runtime.lastError;
                    resolve(res);
                });
            } catch (e) { resolve(null); }
        });
    }

    function storageGet(key) {
        return new Promise(resolve => {
            try {
                chrome.storage.local.get(key, o => resolve((o || {})[key]));
            } catch (e) { resolve(null); }
        });
    }

    /** 同一张图的原图/降采样版本归一到同一个 key，用于去重与「已下载」判断 */
    function keyOf(url) {
        const s = String(url || '').split('#')[0];
        try {
            const big = U.stripResizeParams(s);
            return big || s;
        } catch (e) { return s; }
    }

    function shortSide(w, h) {
        const a = Number(w) || 0;
        const b = Number(h) || 0;
        return Math.min(a, b);
    }

    /* ---------------- 目标标签页 ---------------- */

    function resolveTab() {
        let q = '';
        try { q = new URLSearchParams(location.search).get('tabId') || ''; } catch (e) { q = ''; }
        const fromQuery = parseInt(q, 10);
        if (fromQuery > 0) {
            tabId = fromQuery;
            return Promise.resolve(tabId);
        }
        /* 没有 tabId 时（点图标直接开侧边栏走的就是这条），**不能**用
         * `tabs.query({active:true,currentWindow:true})`：
         * 在侧边栏上下文里，那个查询返回的是**侧边栏自己**（image.html），
         * 于是 scanInPage 去扫扩展页 → "Cannot access contents of url chrome-extension://..."
         * → 扫描失败、一张图都没有。这正是「打开扩展页没嗅探到」的根因（实测复现）。
         *
         * 正确做法：取当前窗口里**最近活跃的普通网页标签**（排除扩展页与特殊页）。
         * tabs.query 的返回顺序就是按「最近使用」排的，所以取第一个合法项即可。 */
        return new Promise(resolve => {
            const isWeb = t => {
                const u = String((t && t.url) || '');
                return t && t.id > 0 && /^https?:\/\//i.test(u);
            };
            const pick = list => {
                const web = (list || []).filter(isWeb);
                if (!web.length) { tabId = -1; resolve(-1); return; }
                /* 优先级：① 窗口里 active 的网页标签（最贴近用户「我正在看这页」）
                 *          ② 否则取最近访问的（tabs.query 的 sort 结果不稳定，
                 *             有 lastAccessed 时用它，没有就退回列表第一个） */
                const active = web.find(t => t.active);
                if (active) { tabId = active.id; resolve(tabId); return; }
                let best = web[0];
                for (const t of web) {
                    if (typeof t.lastAccessed !== 'number') { continue; }
                    if (typeof best.lastAccessed !== 'number' || t.lastAccessed > best.lastAccessed) {
                        best = t;
                    }
                }
                tabId = best.id;
                resolve(tabId);
            };
            try {
                chrome.tabs.query({ currentWindow: true }, list => {
                    void chrome.runtime.lastError;
                    if (list && list.length) { pick(list); return; }
                    // 侧边栏在独立窗口里时 currentWindow 可能为空，退回全部标签
                    chrome.tabs.query({}, all => { void chrome.runtime.lastError; pick(all); });
                });
            } catch (e) { tabId = -1; resolve(-1); }
        });
    }

    /* ---------------- 扫描 ---------------- */

    /**
     * 注入到目标页执行扫描。
     * 注入函数里**不能**引用外部闭包变量，只能靠参数与 self.VRImageUtil。
     */
    function scanInPage(opts) {
        /* 先确保扫描模块在页面上可用，**再**扫描。
         *
         * 为什么不能只依赖 manifest 的 content_scripts：
         * 用户装好/更新扩展后，**已经打开的标签页不会重新注入内容脚本**，
         * 于是侧边栏显示「本页 0 张 / 这个页面需要刷新一次」，要用户手动刷新才行。
         * 那不是他该做的事——扩展自己有能力补注入。
         *
         * `chrome.scripting.executeScript({files})` 与 `{func}` 都落在同一隔离世界，
         * 前者的 `self.VRImageUtil` 对后者可见，所以按顺序串起来即可。 */
        return chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: o => ({
                has: typeof self.VRImageUtil !== 'undefined',
                hasScan: typeof self.VRDownloadScan !== 'undefined'
            }),
            args: [opts]
        }).then(res => {
            const r = (res && res[0] && res[0].result) || {};
            /* 两个模块各自判断，缺哪个补哪个。
             * VRDownloadScan 是 2026-11-07 新增（抄星愿两个扩展的源码抓图），
             * 老标签页里必然没有 —— 不补注入的话源码通道会静默失效。 */
            const need = [];
            if (!r.has) { need.push('js/lib-image-util.js'); }
            if (!r.hasScan) { need.push('js/lib-download-scan.js'); }
            if (!need.length) { return null; }
            return chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: need
            });
        }).then(() => chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: o => {
                const U = self.VRImageUtil;
                /* 工具模块没注入时**不能静默返回空数组** —— 那会让人误以为
                 * 「这个页面真的没有图」。实测花瓣 pins 页就是因为内容脚本未注入，
                 * 界面显示「0 张」，而页面上其实有 82 张 <img>。
                 * 这里返回带标记的结果，由调用方给出可操作的提示。 */
                if (!U) {
                    return { __noUtil: true, imgs: document.images ? document.images.length : 0 };
                }
                let imgs = [];
                let bgs = [];
                let fromSrc = [];
                try {
                    imgs = U.scanImages(document, {
                        minWidth: o.minSize,
                        minHeight: o.minSize,
                        minShow: U.PANEL_MIN_SHOW,
                        dedupe: true
                    });
                } catch (e) { imgs = []; }
                if (o.bgScan) {
                    try {
                        bgs = U.scanBackgrounds(document, {
                            minShow: U.PANEL_MIN_SHOW,
                            dedupe: true
                        });
                    } catch (e) { bgs = []; }
                }
                /* 源码通道（抄星愿「图片下载器」contentScript.js 的 body.innerHTML 正则）：
                 * 懒加载站点把图片地址只写在脚本/JSON 里，DOM 上还没有 <img>，
                 * 只扫标签会整批漏掉。抓到的地址没有尺寸信息，交给下面标 0 由 UI 显示「尺寸未知」。 */
                if (o.srcScan) {
                    try {
                        const S = self.VRDownloadScan;
                        if (S && S.extractUrlsFromHtml && document.body) {
                            fromSrc = S.extractUrlsFromHtml(document.body.innerHTML || '', location.href, 400);
                        }
                    } catch (e) { fromSrc = []; }
                }
                const out = [];
                const all = imgs.concat(bgs);
                for (let i = 0; i < all.length; i++) {
                    const it = all[i];
                    if (!it || !it.url) { continue; }
                    const cands = (it.candidates && it.candidates.length)
                        ? it.candidates.slice()
                        : [it.url];
                    out.push({
                        url: it.url,
                        w: Number(it.w) || 0,
                        h: Number(it.h) || 0,
                        bg: !!it.bg,
                        candidates: cands
                    });
                }
                /* 源码里多出来的地址（DOM 上还没有对应 <img>）追加在最后。
                 * 已在 out 里的跳过，避免同一张图出现两次。 */
                const have = Object.create(null);
                for (let i = 0; i < out.length; i++) { have[out[i].url] = 1; }
                for (let i = 0; i < fromSrc.length; i++) {
                    const u = fromSrc[i];
                    if (!u || have[u]) { continue; }
                    have[u] = 1;
                    out.push({ url: u, w: 0, h: 0, bg: false, srcOnly: true, candidates: [u] });
                }
                return out;
            },
            args: [opts]
        }))
          .then(res => (res && res[0] && res[0].result) || []);
    }

    async function scan() {
        if (tabId < 0) {
            showEmpty('没有可扫描的页面', '请在普通网页标签里打开侧边栏，或先切到要抓图的页面。');
            return;
        }
        setBusy(true);
        try {
            const raw = await scanInPage({
                /* 采集门槛恒为 1：**档位是前端筛选，不是采集门槛**。
                 * 2026-11-09 苏哥报「抖音图文页点扩展后嗅探不到本页内容」，
                 * 根因就在这里：浏览器里存着 imgTierMin=2000（之前点过「超大」档），
                 * 下次打开侧边栏就把它当成扫描门槛传下去 → 1066×1424 的作品图
                 * 在 scanImages 阶段被整批判死 → 列表只剩源码正则抓来的无尺寸地址，
                 * 全是「尺寸未知」，看着就像没嗅探到东西。
                 * 档位只该影响 visibleItems（显示），不该影响采不采。 */
                minSize: 1,
                bgScan: settings.imgBgScan !== false,
                /* 源码通道（2026-11-07 抄星愿「图片下载器」）：
                 * 懒加载站点把图只写在脚本/JSON 里，只扫 DOM 会整批漏掉。 */
                srcScan: true
            });
            /* 内容脚本没注入（页面是扩展更新前打开的，或站点禁止注入）：
             * 直接说清楚「刷新一下」，而不是显示「0 张」让人以为页面真没图。 */
            if (raw && raw.__noUtil) {
                showEmpty(
                    '这个页面需要刷新一次',
                    '页面里其实有 ' + (raw.imgs || 0) + ' 个 <img>，但嗅探脚本还没注入。' +
                    '刷新网页后重新点「⟳」即可。'
                );
                return;
            }
            downloaded = (await storageGet('vrImgDownloaded')) || {};
            buildItems(raw);
            /* 小红书 live 图（实况照片）补链（2026-11-11）：侧栏扫到的只是静态首帧，
             * 实况的那段 2~3 秒 mp4 在 SSR state 里。拿到后按「素材 id」把
             * `it.live = mp4地址` 挂到对应条目上 —— 批量下载时静态+实况一起落。 */
            try {
                await attachXhsLive();
            } catch (eL) { /* live 拿不到不影响普通下载 */ }
            /* 档位自愈：上次存的档位把本页真图全筛掉了（列表只剩「尺寸未知」的
             * 源码地址），自动退回「全部」并记住 —— 否则用户看到的就是
             * 「一张真图都没有、全是尺寸未知」，误判成没嗅探到（2026-11-09 抖音图文页）。
             * 判据用「有尺寸的图被筛光」而不是「列表为空」，避免盖掉用户的筛选意图。 */
            let tierResetTo = 0;
            let hintUnknown = 0;
            if (tierMin > 0) {
                const withSize = items.filter(it => it.w > 0 && it.h > 0);
                const kept = withSize.filter(it => shortSide(it.w, it.h) >= tierMin);
                if (withSize.length && !kept.length) {
                    tierResetTo = tierMin;
                    tierMin = 0;
                    saveTierMin(0);
                } else if (!withSize.length) {
                    /* 本页一张都没量出尺寸（懒加载站点）：别硬切回「全部」——
                     * 用户可能就是想看这批，明说一句「去点『未知』」即可。 */
                    hintUnknown = items.length;
                }
            }
            autoSelect();
            renderAll();
            if (tierResetTo) {
                setFootNote('本页没有 ≥' + tierResetTo + ' 的图，已切回「全部」');
            } else if (hintUnknown) {
                setFootNote('本页 ' + hintUnknown + ' 张都没量出尺寸，点「未知」可以单独看');
            }
        } catch (e) {
            showEmpty('扫描失败', String((e && e.message) || e));
        } finally {
            setBusy(false);
        }
    }

    /** 把扫描结果归一：按 key 去重、标记已下载、找出「可换原图」、应用过滤规则 */
    function buildItems(raw) {
        const seen = Object.create(null);
        const F = self.VRImgFilter;
        const rules = settings.imgFilterRules || [];
        items = [];
        filteredOut = 0;
        for (const it of raw) {
            const key = keyOf(it.url);
            if (!key || seen[key]) { continue; }
            seen[key] = 1;

            // 过滤规则：命中即不进列表（AIX 「图片过滤」语义）
            if (F && rules.length && F.isFiltered(it.url, rules)) {
                filteredOut++;
                continue;
            }

            const orig = bestCandidate(it);
            items.push({
                url: it.url,
                w: it.w,
                h: it.h,
                bg: it.bg,
                candidates: it.candidates && it.candidates.length ? it.candidates : [it.url],
                key: key,
                orig: orig,
                /* 「可换原图」：候选链里存在比显示地址更大的版本 */
                better: !!orig && orig !== it.url,
                done: !!(downloaded[key] || downloaded[it.url])
            });
        }
    }

    /**
     * 取候选链里「最可能是图片」的最大版本。
     *
     * 逻辑已抽到 lib-image-util.js 的 bestCandidate（纯函数，可单测）：
     * 2026-11-08 苏哥报「嗅探不准确」，根因就是这段逻辑只有侧边栏有一份，
     * 而三处批量下载都直接用 it.url（页面显示的预览版），
     * 同一张图单张下是原图、批量下是缩略图。
     */
    function bestCandidate(it) {
        return U.bestCandidate(it.candidates, it.url);
    }

    /* ---------------- 小红书实况（live 图） ---------------- */

    /** 素材 id：URL pathname 尾段，剥掉 `!xx` 变体后缀（与 background 同规则） */
    function stillKey(u) {
        try {
            const seg = new URL(u).pathname.split('/').pop() || '';
            return seg.replace(/![a-z0-9_]+$/i, '').toLowerCase();
        } catch (e) { return ''; }
    }

    /**
     * 小红书实况图补链（2026-11-11）：把 SSR state 里的实况 mp4 挂到扫描条目上。
     * 侧边栏扫 DOM 只能拿到静态首帧，实况视频从 background 的 vrXhsLiveProbe 来；
     * 两者按「素材 id」匹配（实测 DOM 图与 state.urlDefault 尾段完全一致）。
     */
    async function attachXhsLive() {
        if (!/^https?:/i.test(pageUrl)) { return; }
        try {
            if (!/(^|\.)xiaohongshu\.com$/i.test(new URL(pageUrl).hostname)) { return; }
        } catch (e) { return; }
        if (!/\/(explore|discovery\/item)\/[0-9a-f]{20,}/i.test(pageUrl)) { return; }

        let res = null;
        try {
            res = await send({ Message: 'vrXhsLive', action: 'vrXhsLive', tabId: tabId });
        } catch (e) { return; }
        if (!res || !Array.isArray(res.rows) || !res.rows.length) { return; }

        const map = Object.create(null);
        for (const r of res.rows) { if (r && r.key && r.url) { map[r.key] = r; } }

        let hit = 0;
        for (const it of items) {
            const k = stillKey(it.orig || it.url);
            const row = map[k];
            if (row) {
                it.live = row.url;
                it.liveBackup = Array.isArray(row.backup) ? row.backup : [];
                hit++;
            }
        }
    }

    /* ---------------- 默认全选口径 ---------------- */

    /**
     * 默认全选：排除已下载。
     * 小图/条状图已在 scanImages 阶段被同一套门槛滤掉（与面板、悬停口径一致），
     * 所以这里只需要再挡「已下载」——否则每次打开都重复勾一堆下过的。
     */
    /**
     * 档位判定 —— visibleItems / autoSelect / 计数三处共用同一口径。
     *
     * 2026-11-09 苏哥报「未知尺寸为啥和其他一起混着」：原来「未知」不参与尺寸档过滤，
     * 于是切到「大 ≥1200」时，一堆没量出尺寸的图照旧显示，看着就像筛选没生效。
     * 现在拆开：
     *   全部(0)        → 什么都要（含未知）
     *   具体尺寸(>0)   → 只要该档；尺寸未知的**不混进来**
     *   未知(-1)       → 只要尺寸未知的（懒加载没解码 / 背景图 / 只有源码地址）
     */
    function inTier(it, min) {
        const known = it.w > 0 && it.h > 0;
        if (min === TIER_UNKNOWN) { return !known; }
        if (min > 0) { return known && shortSide(it.w, it.h) >= min; }
        return true;
    }

    function autoSelect() {
        selected.clear();
        for (const it of items) {
            if (it.done) { continue; }
            /* 与 visibleItems 同口径：看不见的不该被勾上，否则「已选 10 张」里有 8 张
             * 根本不在当前筛选结果里，用户会以为程序乱选。 */
            if (!inTier(it, tierMin)) { continue; }
            if (!matchKeyword(it, keyword)) { continue; }
            selected.add(it.key);
        }
    }

    function matchKeyword(it, kw) {
        if (!kw) { return true; }
        const s = String(kw).trim();
        if (!s) { return true; }
        // /正则/ 形式按正则匹配，写错自动退回子串
        if (s.length > 2 && s.charAt(0) === '/' && s.charAt(s.length - 1) === '/') {
            try {
                const re = new RegExp(s.slice(1, -1));
                return re.test(it.url);
            } catch (e) { /* 落到子串 */ }
        }
        return it.url.toLowerCase().indexOf(s.toLowerCase()) >= 0;
    }

    /* ---------------- 渲染 ---------------- */

    function visibleItems() {
        return items.filter(it => inTier(it, tierMin) && matchKeyword(it, keyword));
    }

    function renderTiers() {
        const counts = { all: items.length, unknown: 0, small: 0, medium: 0, large: 0, huge: 0 };
        for (const it of items) {
            /* 尺寸未知的图（懒加载未解码、背景图、只有源码地址）单独记一档，
             * 不再算进任何尺寸档 —— 它们不是「小图」，只是还没量出尺寸。 */
            if (!(it.w > 0 && it.h > 0)) { counts.unknown++; continue; }
            const s = shortSide(it.w, it.h);
            if (s >= 2000) { counts.huge++; }
            if (s >= 1200) { counts.large++; }
            if (s >= 500) { counts.medium++; }
            if (s >= 100) { counts.small++; }
        }
        el.tiers.innerHTML = (() => {
            /* 头一个「全部」档位：包含尺寸未知的图。
             * 懒加载站点（花瓣实测）大量 <img> 还没解码，按尺寸分档它们不属于任何一档，
             * 只看尺寸档会让人以为「整页只有几张图」。 */
            const allBtn = '<button class="ip-tier' + (tierMin === 0 ? ' on' : '') +
                '" data-min="0">全部<span class="c">' + counts.all + '</span></button>';
            const tiers = U.TIERS.map(t => {
                const n = counts[t.key] || 0;
                const on = t.min === tierMin ? ' on' : '';
                /* 档位一律可点，**不做 disabled**。
                 * 早先 `n === 0 → disabled`，看着合理其实把用户锁死了：
                 * 一旦切到「大 ≥1200」而该档是 0 张，三个大档全灰、只剩当前这个，
                 * 用户再也切不回小档（实测截图：中/大/超大都是 0 且点不动）。
                 * 档位是「筛选阈值」，切过去是空列表也是一个明确结果，不该禁用。 */
                return '<button class="ip-tier' + on + '" data-min="' + t.min + '">' +
                    t.label + ' ≥' + t.min + '<span class="c">' + n + '</span></button>';
            }).join('');
            /* 「未知」独立一档（2026-11-09 苏哥要求）：想单独挑出没量出尺寸的图
             * （懒加载、背景图、只在源码里的地址）时，不用再从「全部」里肉眼找。 */
            const unknownBtn = counts.unknown
                ? '<button class="ip-tier ip-tier-unknown' + (tierMin === TIER_UNKNOWN ? ' on' : '') +
                    '" data-min="unknown" title="没量出尺寸的图：懒加载没解码、背景图、只有源码地址">' +
                    '未知<span class="c">' + counts.unknown + '</span></button>'
                : '';
            /* 选中「未知」时补一句说明（只在这一档出现，不占常驻空间）：
             * 这批图默认会被全选，不说清楚用户容易一键下几百张图标头像。
             * 不能借用底部 setFootNote —— 那是 ipSum，会在 renderFoot 里被「已选 N」覆盖。 */
            const unknownNote = (tierMin === TIER_UNKNOWN && counts.unknown)
                ? '<span class="ip-tier-note">多半是图标/头像/占位图，建议挑着下</span>'
                : '';
            return allBtn + tiers + unknownBtn + unknownNote;
        })();
    }

    function cellEl(it) {
        const div = document.createElement('div');
        div.className = 'ip-cell' + (selected.has(it.key) ? ' sel' : '') + (it.done ? ' done' : '');
        div.tabIndex = 0;
        div.setAttribute('data-key', it.key);
        div.setAttribute('data-act', 'open');
        div.title = it.done ? '已下载 · 点击看大图' : '点击看大图';

        const img = document.createElement('img');
        img.className = 'ip-thumb';
        img.loading = 'lazy';
        img.src = it.url;
        img.alt = '';
        img.addEventListener('error', () => div.classList.add('loadfail'));

        /* 勾选是**独立控件**：点图看大图，点这个圈才改勾选状态。
         * 这样「看」和「选」不会互相误触 —— 之前点图即勾选，
         * 想放大看一眼结果先把图选上了。 */
        const ck = document.createElement('button');
        ck.type = 'button';
        ck.className = 'ip-ck';
        ck.textContent = '✓';
        ck.setAttribute('data-act', 'pick');
        ck.setAttribute('data-key', it.key);
        ck.title = selected.has(it.key) ? '取消勾选' : '勾选这张';
        ck.setAttribute('aria-label', ck.title);

        const badge = document.createElement('span');
        badge.className = 'ip-badge' + (it.better ? ' orig' : '');
        badge.textContent = it.done ? '已下载' : (it.better ? '可换原图' : (it.bg ? '背景图' : ''));

        /* 小红书实况（live 图）角标：这张静态图带 2~3 秒实况 mp4，
         * 勾选下载时静态+实况会一起落（见 runBatch）。 */
        let liveTag = null;
        if (it.live) {
            liveTag = document.createElement('span');
            liveTag.className = 'ip-live';
            liveTag.textContent = '实况';
            liveTag.title = '这张是实况图：下载时静态图 + 实况视频一起保存';
        }

        const dim = document.createElement('span');
        dim.className = 'ip-dim';
        /* 尺寸未知分两种来源，不能一律叫「背景图」：
         *   · 背景图（it.bg）：确实没有 img 标签，本来就没有宽高
         *   · 源码通道抓到的（srcOnly）：DOM 里还没 <img>，尺寸无从得知
         * 早先一律写「背景图」，实测源码抓来的 3 张全被标成背景图（2026-11-07 端到端暴露）。 */
        dim.textContent = (it.w && it.h)
            ? (it.w + ' × ' + it.h)
            : (it.bg ? '背景图' : '尺寸未知');

        /* 不再有悬停放大镜：点图本身就是看大图，
         * 再放一个 ⌕ 会让人以为「这里才能看」，而且侧边栏窄，多一个控件就多一份误触。 */

        div.appendChild(img);
        div.appendChild(ck);
        if (liveTag) { div.appendChild(liveTag); }
        if (badge.textContent) { div.appendChild(badge); }
        div.appendChild(dim);
        return div;
    }

    function renderGrid() {
        const list = visibleItems();
        el.grid.innerHTML = '';
        rendered = 0;
        if (!list.length) {
            showEmpty('本页没扫到可下载的图片', '试试放宽尺寸档位，或滚动加载后再扫描。');
            return;
        }
        el.empty.hidden = true;
        appendMore(list);
    }

    function appendMore(list) {
        const slice = list.slice(rendered, rendered + PAGE_SIZE);
        if (!slice.length) { return; }
        const frag = document.createDocumentFragment();
        for (const it of slice) { frag.appendChild(cellEl(it)); }
        el.grid.appendChild(frag);
        rendered += slice.length;
    }

    function renderCount() {
        el.count.textContent = String(items.length);
        el.site.textContent = pageUrl ? pageUrl.replace(/^https?:\/\//, '').slice(0, 60) : '—';
    }

    function renderFoot() {
        const list = visibleItems();
        const n = list.filter(it => selected.has(it.key)).length;
        const total = list.length;
        const skipped = items.filter(it => it.done).length;
        el.sum.innerHTML = '已选 <b>' + n + '</b> / ' + total +
            (skipped ? ' · 跳过 ' + skipped + ' 张已下载' : '') +
            (filteredOut ? ' · 规则过滤 ' + filteredOut + ' 张' : '');
        el.dl.disabled = n === 0 || running;
        el.dl.textContent = running ? '下载中…' : (n ? '下载选中 ' + n : '下载选中');
        el.all.checked = total > 0 && n === total;
    }

    function renderAll() {
        renderCount();
        renderTiers();
        renderGrid();
        renderFoot();
    }

    function showEmpty(title, sub) {
        el.empty.hidden = false;
        el.grid.innerHTML = '';
        el.emptyT.textContent = title;
        el.emptyS.textContent = sub || '';
    }

    function setBusy(b) {
        el.rescan.disabled = b;
        el.rescan.textContent = b ? '…' : '⟳';
    }

    /* ---------------- 交互：勾选 ---------------- */

    function toggle(key) {
        if (selected.has(key)) { selected.delete(key); } else { selected.add(key); }
    }

    function syncCells() {
        for (const cell of el.grid.querySelectorAll('.ip-cell')) {
            cell.classList.toggle('sel', selected.has(cell.getAttribute('data-key')));
        }
    }

    el.grid.addEventListener('click', ev => {
        /* 两种点击，泾渭分明：
         *   点勾选圈（data-act=pick） → 只改勾选状态，不打开大图
         *   点图/点格子其它位置     → 打开大图预览（用户 2026-11-06 明确要求）
         * 不用双击：双击在触控板/移动端识别不稳，而且与「点开看」的心智重复。 */
        const pick = ev.target.closest ? ev.target.closest('[data-act="pick"]') : null;
        if (pick) {
            ev.stopPropagation();
            const k = pick.getAttribute('data-key');
            if (k) {
                toggle(k);
                syncCells();
                renderFoot();
                updateCkTitles();
            }
            return;
        }

        const cell = ev.target.closest ? ev.target.closest('.ip-cell') : null;
        if (!cell) { return; }
        const key = cell.getAttribute('data-key');
        if (!key) { return; }
        openPreview(key);
    });

    /** 勾选后同步每个圈的无障碍标题（读屏/悬停提示都要跟着变） */
    function updateCkTitles() {
        for (const b of el.grid.querySelectorAll('[data-act="pick"]')) {
            const k = b.getAttribute('data-key');
            const on = selected.has(k);
            b.title = on ? '取消勾选' : '勾选这张';
            b.setAttribute('aria-label', b.title);
        }
    }

    el.tiers.addEventListener('click', ev => {
        const b = ev.target.closest ? ev.target.closest('.ip-tier') : null;
        if (!b || b.disabled) { return; }
        const raw = b.getAttribute('data-min');
        /* 「未知」档用字符串标记，不走 parseInt —— 传数字会跟「0=全部」撞车 */
        tierMin = (raw === 'unknown') ? TIER_UNKNOWN : parseInt(raw, 10);
        /* 「全部」档 data-min=0：早先写 `|| 100` 会把它偷偷变成 100 门槛，
         * 下次扫描又拿 100 去筛图（档位本该只管显示）。显式判 NaN 才不会吞 0。 */
        if (!Number.isFinite(tierMin)) { tierMin = 0; }
        saveTierMin(tierMin);
        /* 「未知」档的说明写在档位行里（见 renderTiers 的 ip-tier-note），
         * 不能写 setFootNote —— 那会覆盖底部的「已选 N」。 */
        // 改档位等于改「什么算值得下」，重算默认勾选
        autoSelect();
        renderAll();
    });

    /**
     * 记住尺寸档位：写回 vrLibSettings.**imgTierMin**。
     *
     * 必须与 imgMinSize 分开：那个是「页面浮标/清单面板」的原始像素门槛，
     * 默认 100，用来滤掉图标；这里的档位默认是「全部」(0)。
     * 混用同一个键会导致——用户在侧边栏切「全部」，
     * 浮标那边的最小尺寸被改成 0，图标全冒出来。
     */
    function saveTierMin(v) {
        try {
            chrome.storage.local.get('vrLibSettings', o => {
                const s = Object.assign({}, (o && o.vrLibSettings) || {});
                s.imgTierMin = v;
                chrome.storage.local.set({ vrLibSettings: s });
            });
        } catch (e) { /* 无 storage 权限时只在本会话生效 */ }
    }

    let searchTimer = 0;
    el.search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            keyword = el.search.value;
            autoSelect();
            renderAll();
        }, 150);
    });

    el.all.addEventListener('change', () => {
        const list = visibleItems();
        if (el.all.checked) {
            for (const it of list) { selected.add(it.key); }
        } else {
            for (const it of list) { selected.delete(it.key); }
        }
        syncCells();
        renderFoot();
    });

    /* 滚动到底再追加（IntersectionObserver 比 scroll 事件省） */
    el.body.addEventListener('scroll', () => {
        if (rendered >= visibleItems().length) { return; }
        if (el.body.scrollTop + el.body.clientHeight >= el.body.scrollHeight - 200) {
            appendMore(visibleItems());
        }
    }, { passive: true });

    /* ---------------- 预览层 ---------------- */

    let lbKey = '';

    function openPreview(key) {
        lbKey = key;
        paintPreview();
        el.lb.hidden = false;
    }

    function closePreview() {
        el.lb.hidden = true;
    }

    function paintPreview() {
        const list = visibleItems();
        const it = list.find(x => x.key === lbKey);
        if (!it) { closePreview(); return; }
        const src = it.orig || it.url;
        el.lbImg.src = src;
        el.lbName.textContent = (it.w && it.h ? it.w + ' × ' + it.h + '   ' : '') +
            (it.bg ? '背景图' : '图片') + (it.done ? '   （已下载）' : '');
        el.lbUrl.textContent = it.url;
        el.lbChain.textContent = it.better
            ? '候选链：' + src + '（已去降采样参数，将按此地址下载）'
            : '候选链：原图直链（无降采样参数）';
        /* 按钮文案恒为「下载这张」：它是**立即下载**，与「是否已勾选」无关。
         * 早先按勾选态显示「已勾选 ✓」，会让人误以为点了只是选中。 */
        el.lbDl.textContent = '下载这张';
        el.lbDl.disabled = false;
    }

    function stepPreview(dir) {
        const list = visibleItems();
        if (!list.length) { return; }
        const i = list.findIndex(x => x.key === lbKey);
        const n = (i + dir + list.length) % list.length;
        lbKey = list[n].key;
        paintPreview();
    }

    el.lbClose.addEventListener('click', closePreview);
    el.lb.addEventListener('click', ev => { if (ev.target === el.lb) { closePreview(); } });
    el.lbPrev.addEventListener('click', () => stepPreview(-1));
    el.lbNext.addEventListener('click', () => stepPreview(1));
    el.lbDl.addEventListener('click', async () => {
        const it = items.find(x => x.key === lbKey);
        if (!it || running) { return; }
        /* 「下载这张」= 立刻下载这一张，**不是**加入已选集。
         * 用户在大图预览里点它，意图非常明确：我就要这张。
         * 早先只做 selected.add() 再去点底部按钮，等于多一步，且会让人以为没生效。
         * 走单张 vrImg.download（复用 DNR 补 Referer / FSA 直写），不占用批量队列。 */
        const btn = el.lbDl;
        btn.disabled = true;
        btn.textContent = '下载中…';

        const title = (pageTitle || '图片') + '_' +
            String(items.indexOf(it) + 1).padStart(2, '0');
        const res = await send({
            Message: 'vrImg.download',
            action: 'vrImg.download',
            url: it.orig || it.url,
            candidates: it.candidates,
            title: title,
            pageUrl: pageUrl,
            /* 实况图：把这段 2~3 秒的 mp4 一起交给后台（title 自动加 _live）。
             * 后台统一处理，这里不重复发第二条消息 —— 两条消息在批量场景下会互相
             * 抢并发槽，还会让「已选 N 张 / 已保存 N 张」的账对不上。 */
            liveUrl: it.live || '',
            liveCandidates: it.liveBackup || [],
            /* 扩展页面无网页 DOM：带 tabId 让后台注入取站名。 */
            tabId: tabId
        });

        btn.disabled = false;
        if (res && res.ok) {
            it.done = true;
            downloaded[it.key] = 1;
            btn.textContent = res.duplicate ? '已存在 ✓' : '已保存 ✓';
            syncCells();
            renderFoot();
            /* 保持预览层打开：用户常要连着看下一张、再存下一张。
             * 2 秒后把按钮文案还原，方便继续操作。 */
            setTimeout(() => {
                if (!el.lb.hidden) { paintPreview(); }
            }, 1500);
        } else {
            btn.textContent = '下载失败';
            setTimeout(() => {
                if (!el.lb.hidden) { paintPreview(); }
            }, 1800);
        }
    });

    document.addEventListener('keydown', ev => {
        if (el.lb.hidden) { return; }
        if (ev.key === 'Escape') { closePreview(); }
        if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepPreview(-1); }
        if (ev.key === 'ArrowRight') { ev.preventDefault(); stepPreview(1); }
    });

    /* ---------------- 下载 ---------------- */

    el.dl.addEventListener('click', () => {
        if (running) { return; }
        const list = visibleItems().filter(it => selected.has(it.key));
        if (!list.length) { return; }
        runBatch(list);
    });

    async function runBatch(list) {
        running = true;
        batchId = 'b-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        el.prog.hidden = false;
        el.progBar.style.width = '0%';
        el.progT.textContent = '0 / ' + list.length;
        renderFoot();

        const payload = [];
        list.forEach((it, i) => {
            payload.push({
                /* 用 it.orig（候选链里最像原图的那条），不是 it.url。
                 * 2026-11-08 苏哥报「嗅探不准确」：单张下载走的是 it.orig，
                 * 批量却用 it.url（页面显示的预览版），同一张图两条路径落盘尺寸不同。
                 * 小红书实测 26 张全是 640 宽的预览档，就是这条造成的。 */
                url: it.orig || it.url,
                candidates: it.candidates,
                /* 必须带序号：同页多张图共用 pageTitle 时，背景会按 title 命名，
                 * 两张同名只剩扩展名能区分（实测 cover.jpg / sprite.png 落成同名 .jpg/.png）。
                 * 序号补零到两位，超过 99 张自然变成三位，不截断。 */
                title: (pageTitle || '图片') + '_' + String(i + 1).padStart(2, '0')
            });
            /* 实况图：静态图后面跟一条实况 mp4（2026-11-11）。
             * 同一队列里，去重/进度/失败统计天然覆盖；实况失败只算它自己一条。 */
            if (it.live) {
                payload.push({
                    url: it.live,
                    candidates: (it.liveBackup && it.liveBackup.length)
                        ? [it.live].concat(it.liveBackup) : [it.live],
                    title: (pageTitle || '图片') + '_' + String(i + 1).padStart(2, '0') + '_live'
                });
            }
        });

        const res = await send({
            Message: 'vrImg.batch',
            action: 'vrImg.batch',
            items: payload,
            pageUrl: pageUrl,
            pageTitle: pageTitle,
            /* 本页是扩展页面，读不到网页 DOM，拿不到站名。
             * 带上 tabId，由后台注入目标页取一次站名并落库。 */
            tabId: tabId,
            concurrency: Number(settings.imgConcurrency) || 3,
            batchId: batchId
        });

        running = false;
        el.prog.hidden = true;
        renderFoot();

        if (res && typeof res.succeeded === 'number') {
            const fail = Number(res.fail) || 0;
            if (fail) {
                el.sum.innerHTML = '完成 ' + res.succeeded + ' 张，失败 <b style="color:var(--danger)">' + fail + '</b> 张';
            } else {
                // 下完就标记，下次打开默认不再勾
                for (const it of list) { downloaded[it.key] = 1; it.done = true; }
                autoSelect();
                renderAll();
                el.sum.innerHTML = '已保存 <b>' + res.succeeded + '</b> 张';
            }
        }
    }

    el.progX.addEventListener('click', () => {
        if (!batchId) { return; }
        send({ Message: 'vrImg.batchCancel', action: 'vrImg.batchCancel', batchId: batchId });
        el.progT.textContent = '已取消';
    });

    /* 进度广播：SW 侧 200ms 节流后推过来 */
    try {
        chrome.runtime.onMessage.addListener(msg => {
            if (!msg || msg.Message !== 'vrImg.batchProgress') { return; }
            if (msg.batchId !== batchId) { return; }
            const total = Number(msg.total) || 0;
            const done = Number(msg.done) || 0;
            el.progT.textContent = done + ' / ' + total +
                (Number(msg.fail) ? ' · 失败 ' + msg.fail : '');
            el.progBar.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
        });
    } catch (e) { /* 无 runtime 时忽略 */ }

    /* ---------------- 更多操作：导出 / ZIP / WEBP 转 JPG ---------------- */

    const X = self.VRAlbumExport;

    function toggleMore(force) {
        if (!el.moreMenu) { return; }
        const show = force === undefined ? el.moreMenu.hidden : !!force;
        el.moreMenu.hidden = !show;
    }

    if (el.more) {
        el.more.addEventListener('click', ev => {
            ev.stopPropagation();
            toggleMore();
        });
    }
    // 点面板别处就收起菜单（与页面其它浮层一致的心智）
    document.addEventListener('click', ev => {
        if (!el.moreMenu || el.moreMenu.hidden) { return; }
        if (ev.target.closest && (ev.target.closest('#ipMoreMenu') || ev.target.closest('#ipMore'))) { return; }
        toggleMore(false);
    });

    /** 触发一次文件保存。扩展页里用 a[download]，不依赖 SW 与下载器。 */
    function saveBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            try { document.body.removeChild(a); } catch (e) { /* 忽略 */ }
            URL.revokeObjectURL(url);
        }, 2000);
    }

    function exportName(ext) {
        const t = String(pageTitle || '图片清单').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 60);
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        return t + '_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.' + ext;
    }

    /** 导出链接：txt 一行一个 / csv 带尺寸表 */
    function exportLinks(fmt) {
        const list = visibleItems().filter(it => selected.has(it.key));
        if (!list.length) { el.sum.textContent = '先勾选要导出的图片'; return; }
        /* 文件名列不能留空：CSV 里一整列空着等于没有信息。
         * 用 2026-11-07 抄自 Download Master 的推导链（丢弃 php/asp 这类动态脚本名、
         * 去非法字符、截 200），与它 utils.getDownloadFilename 同口径。 */
        const S = self.VRDownloadScan;
        const text = X.buildExport(list.map(it => ({
            url: it.url, orig: it.orig, w: it.w, h: it.h,
            name: (S && S.downloadName) ? (S.downloadName(it.orig || it.url) || '') : ''
        })), fmt);
        const mime = fmt === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8';
        // CSV 加 BOM：Excel 打开中文才不乱码（这是个老问题，不加就永远是乱码）
        const body = fmt === 'csv' ? '\uFEFF' + text : text;
        saveBlob(new Blob([body], { type: mime }), exportName(fmt));
        el.sum.innerHTML = '已导出 <b>' + list.length + '</b> 条链接（' + fmt + '）';
        toggleMore(false);
    }

    /**
     * 取一张图的字节。
     * 注意：扩展页面的 fetch 不带页面 Referer，防盗链站点（微博等）会 403 ——
     * 这是已知限制，取不到就跳过并如实报数，不假装成功。
     */
    async function fetchBytes(url) {
        try {
            const r = await fetch(url, { credentials: 'include' });
            if (!r.ok) { return null; }
            const ct = r.headers.get('content-type') || '';
            const buf = await r.arrayBuffer();
            return { buf, ct };
        } catch (e) { return null; }
    }

    /** WEBP/AVIF → JPEG（canvas 重编码）。失败返回 null，由调用方回退原始字节。 */
    async function toJpeg(buf, ct) {
        try {
            const blob = new Blob([buf], { type: ct || 'image/webp' });
            const bmp = await createImageBitmap(blob);
            const cv = document.createElement('canvas');
            cv.width = bmp.width;
            cv.height = bmp.height;
            const cx = cv.getContext('2d');
            // 透明区域转 JPEG 会变黑，先铺白底
            cx.fillStyle = '#fff';
            cx.fillRect(0, 0, cv.width, cv.height);
            cx.drawImage(bmp, 0, 0);
            const out = await new Promise(res => cv.toBlob(b => res(b), 'image/jpeg', 0.92));
            if (!out) { return null; }
            return new Uint8Array(await out.arrayBuffer());
        } catch (e) { return null; }
    }

    /** 打包 ZIP：逐张取字节 → （可选）转 JPG → STORE 打包 → 保存 */
    async function packZip() {
        const list = visibleItems().filter(it => selected.has(it.key));
        if (!list.length) { el.sum.textContent = '先勾选要打包的图片'; return; }

        const wantJpeg = !!(el.webp && el.webp.checked);
        el.prog.hidden = false;
        el.progBar.style.width = '0%';
        toggleMore(false);

        const files = [];
        const failed = [];
        let jpegCount = 0;
        const pad2 = n => String(n).padStart(2, '0');

        for (let i = 0; i < list.length; i++) {
            const it = list[i];
            el.progT.textContent = '打包 ' + (i + 1) + ' / ' + list.length;
            el.progBar.style.width = Math.round((i / list.length) * 100) + '%';

            const src = it.orig || it.url;
            const got = await fetchBytes(src);
            if (!got) { failed.push(src); continue; }

            let bytes = new Uint8Array(got.buf);
            let ext = (src.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
            if (!/^(jpg|jpeg|png|gif|webp|avif|bmp)$/.test(ext)) { ext = 'jpg'; }

            if (wantJpeg && X.needsJpeg(src)) {
                const conv = await toJpeg(got.buf, got.ct);
                if (conv) { bytes = conv; ext = 'jpg'; jpegCount++; }
            }

            const base = String(pageTitle || '图片').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 60);
            files.push({
                name: base + '_' + pad2(i + 1) + '.' + ext,
                data: bytes
            });
        }

        el.progBar.style.width = '100%';
        if (!files.length) {
            el.prog.hidden = true;
            el.sum.innerHTML = '打包失败：<b style="color:var(--danger)">0</b> 张取到字节（多为防盗链拦截）';
            return;
        }

        const zip = X.zipStore(files);
        saveBlob(new Blob([zip], { type: 'application/zip' }), exportName('zip'));
        el.prog.hidden = true;

        let msg = '已打包 <b>' + files.length + '</b> 张';
        if (jpegCount) { msg += ' · 转 JPG ' + jpegCount + ' 张'; }
        if (failed.length) {
            msg += ' · <span style="color:var(--danger)">跳过 ' + failed.length + ' 张</span>（防盗链或跨域）';
        }
        el.sum.innerHTML = msg;
    }

    /** WEBP 开关状态持久化：与其它图片设置共用 vrLibSettings */
    function bindWebpToggle() {
        if (!el.webp) { return; }
        el.webp.checked = settings.imgWebpToJpg === true;
        el.webp.addEventListener('change', () => {
            settings.imgWebpToJpg = !!el.webp.checked;
            try {
                chrome.storage.local.get('vrLibSettings', o => {
                    const s = Object.assign({}, (o && o.vrLibSettings) || {});
                    s.imgWebpToJpg = !!el.webp.checked;
                    chrome.storage.local.set({ vrLibSettings: s });
                });
            } catch (e) { /* 无 storage 时只在本会话生效 */ }
        });
    }

    if (el.moreMenu) {
        el.moreMenu.addEventListener('click', ev => {
            const b = ev.target.closest ? ev.target.closest('[data-more]') : null;
            if (!b) { return; }
            const act = b.getAttribute('data-more');
            if (act === 'webp') { return; }        // 交给 checkbox 的 change
            ev.stopPropagation();
            if (act === 'txt' || act === 'csv') { exportLinks(act); }
            if (act === 'zip') { packZip(); }
            if (act === 'library') { openLibrary(); }
            if (act === 'libraryLink') { copyLibraryLink(); }
            if (act === 'downloads') { openDownloads(); }
        });
    }

    /**
     * 复制媒体库直达链接（2026-11-08 苏哥反馈：媒体库太难进去）。
     * 扩展没有固定 key，ID 随加载路径变，所以地址必须运行时取。
     */
    async function copyLibraryLink() {
        let url = '';
        try { url = chrome.runtime.getURL('library.html'); } catch (e) { url = ''; }
        if (!url) { setFootNote('取不到资源库地址'); return; }
        try {
            await navigator.clipboard.writeText(url);
            setFootNote('已复制媒体库链接');
        } catch (e) {
            /* 侧边栏可能没有剪贴板权限：退回到输入框手选，让用户自己 Ctrl+C */
            try {
                const ta = document.createElement('textarea');
                ta.value = url;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                setFootNote('已复制媒体库链接');
            } catch (e2) {
                setFootNote('复制失败，可在设置页手动复制');
            }
        }
        toggleMore(false);
    }

    /* 资源库 / 下载管理：独立窗口打开（与 popup 里的同名入口一致）。
     * 用户原话「在这种图片网页，我想进入资源库，怎么进？」——
     * 之前侧边栏图片页确实没有任何入口，只能退回 popup 再找。 */
    function openLibrary() {
        try {
            const url = chrome.runtime.getURL('library.html');
            if (chrome.windows && chrome.windows.create) {
                chrome.windows.create({ url: url, type: 'popup', width: 1280, height: 900, focused: true });
            } else {
                chrome.tabs.create({ url: url });
            }
            toggleMore(false);
        } catch (e) { setFootNote('打不开资源库：' + e); }
    }

    function openDownloads() {
        try {
            const url = chrome.runtime.getURL('downloads.html');
            if (chrome.windows && chrome.windows.create) {
                chrome.windows.create({ url: url, type: 'popup', width: 900, height: 680, focused: true });
            } else {
                chrome.tabs.create({ url: url });
            }
            toggleMore(false);
        } catch (e) { setFootNote('打不开下载管理：' + e); }
    }

    /* ---------------- 入口 ---------------- */

    el.rescan.addEventListener('click', scan);

    /* 顶栏「▤」= 资源库直达。
     * 用户原话：「光下载也没啥用，在上面扩展栏打开要显示资源库」——
     * 资源库入口不能只藏在 `⋯` 菜单里，必须是常驻可见的一级按钮。 */
    if (el.library) { el.library.addEventListener('click', openLibrary); }

    /* 图集翻页抓全：调 SW 的 vrImg.albumScan（mode=pages），轮询进度，把结果并入列表。
     * 翻页在**后台标签**里跑（SW 侧实现），所以不会把用户正在看的页面导航走。 */
    let albumTaskId = '';
    let albumTimer = 0;

    el.album.addEventListener('click', () => {
        if (tabId < 0) { showEmpty('没有可扫描的页面', '请先在普通网页标签里打开侧边栏。'); return; }
        if (albumTaskId) { return; }          // 已在跑，避免重复开任务
        const S = self.VRAlbumSites;
        const site = S ? S.matchSite(pageUrl) : null;
        const name = site ? site.name : '通用';
        if (!confirm('从当前页开始翻页抓全（最多 10 页，站点：' + name + '）？\n翻页会在后台标签里进行，不会打断你正在看的页面。')) {
            return;
        }
        startAlbum();
    });

    async function startAlbum() {
        el.album.textContent = '…';
        el.album.disabled = true;
        const res = await send({
            Message: 'vrImg.albumScan',
            action: 'vrImg.albumScan',
            mode: 'pages',
            tabId: tabId,
            maxPages: 10,
            minSize: Number(settings.imgMinSize) || U.MIN_SIZE,
            startUrl: pageUrl
        });
        if (!res || !res.ok || !res.taskId) {
            el.album.textContent = '⧉';
            el.album.disabled = false;
            showEmpty('翻页扫描启动失败', (res && res.message) || '未知原因');
            return;
        }
        albumTaskId = res.taskId;
        pollAlbum();
    }

    async function pollAlbum() {
        clearTimeout(albumTimer);
        const p = await send({
            Message: 'vrImg.albumProgress',
            action: 'vrImg.albumProgress',
            taskId: albumTaskId,
            withItems: true
        });
        if (p && p.ok) {
            el.album.textContent = String(p.collected || 0);
            if (p.state === 'scanning') {
                albumTimer = setTimeout(pollAlbum, 700);
                return;
            }
            // 结束：把抓到的并入当前列表
            if (Array.isArray(p.items) && p.items.length) {
                mergeAlbumItems(p.items);
            }
            el.album.textContent = '⧉';
            el.album.disabled = false;
            albumTaskId = '';
            const msg = p.message || (p.state === 'done' ? '翻页完成' : p.state);
            el.sum.innerHTML = '翻页抓全：<b>' + (p.collected || 0) + '</b> 张 · ' + msg;
        } else {
            el.album.textContent = '⧉';
            el.album.disabled = false;
            albumTaskId = '';
        }
    }

    /** 把翻页结果并入 items：按 key 去重，已下载的标记出来 */
    function mergeAlbumItems(raw) {
        const seen = Object.create(null);
        for (const it of items) { seen[it.key] = 1; }
        for (const it of raw) {
            const url = it && it.url;
            if (!url) { continue; }
            const key = keyOf(url);
            if (!key || seen[key]) { continue; }
            seen[key] = 1;
            const cands = (it.candidates && it.candidates.length) ? it.candidates : [url];
            items.push({
                url: url,
                w: Number(it.w) || 0,
                h: Number(it.h) || 0,
                bg: false,
                candidates: cands,
                key: key,
                orig: bestCandidate({ url: url, candidates: cands }),
                better: false,
                done: !!(downloaded[key] || downloaded[url])
            });
        }
        autoSelect();
        renderAll();
    }

    el.openVideo.addEventListener('click', () => {
        if (tabId < 0) { return; }
        /* 切回嗅探列表：让 SW 把该 tab 的侧边栏路径换成 popup.html。
         *
         * 注意：**不能**在切换后调 window.close() —— 侧边栏不是独立窗口，
         * close() 只会被浏览器忽略（实测点了没反应）。正确做法是切完路径后
         * 提示用户，同时把面板本身留在这里（路径下一次打开才会生效）。
         * 为了让它「立刻可见」，这里改成先切路径再重载当前面板到 popup.html。 */
        send({ Message: 'vrImg.sidePanelPath', path: 'popup.html', tabId: tabId })
            .then(res => {
                if (!res || !res.ok) { setFootNote('切换失败，可点扩展图标重开'); return; }
                try {
                    location.href = chrome.runtime.getURL('popup.html?tabId=' + tabId);
                } catch (e) {
                    setFootNote('已切到嗅探列表，重新打开侧边栏即可看到');
                }
            });
    });

    /** 底部状态行临时提示（不打断勾选，也不弹 toast） */
    function setFootNote(text) {
        const elx = document.getElementById('ipSum');
        if (elx) { elx.textContent = text; }
    }

    /* ---------------- 启动 ---------------- */

    async function init() {
        settings = U.mergeSettings((await storageGet('vrLibSettings')) || {});
        /* 默认「全部」档（tierMin=0）：用户打开就想看到本页所有图。
         * 不再从 imgMinSize 初始化 —— 那是页面浮标/面板的门槛，
         * 这里的档位是「筛选显示」，默认全显示、由用户自己收窄更符合直觉。
         * 注意 `Number(0) || U.MIN_SIZE` 会得到 100，必须显式判 null。 */
        const savedMin = settings.imgTierMin;
        /* savedMin 允许 -1（「未知」档）：早先只认 >=0，切到「未知」后重开侧边栏
         * 会静默退回「全部」，用户以为档位没记住。 */
        tierMin = (typeof savedMin === 'number' && (savedMin >= 0 || savedMin === TIER_UNKNOWN))
            ? savedMin : 0;

        const t = await resolveTab();
        if (t > 0) {
            try {
                const info = await chrome.tabs.get(t);
                pageUrl = (info && info.url) || '';
                pageTitle = String((info && info.title) || '').slice(0, 80);
            } catch (e) { /* 拿不到就用空 */ }
        }
        await scan();
        bindWebpToggle();
    }

    init();
})();
