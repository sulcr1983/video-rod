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
    /* 类型筛选（2026-11-13 新增）：面板不能只出图片，要兼容图片/动图/视频/音频。
     * 与 tierMin 是**两级**筛选：先按类型定大类，再按尺寸细分图片。
     * 默认 'all' —— 一进来就把视频藏起来，用户会以为又「嗅探不到」。 */
    let typeFilter = 'all';
    /* 2026-11-09（苏哥报）：尺寸未知的图混在「大 ≥1200」里，看着像筛选没生效。
     * 现在把它单列成一档。用 -1 而不是 0：0 已经被「全部」占了，且
     * `shortSide < 0` 恒为假，能安全复用同一套比较。 */
    const TIER_UNKNOWN = -1;
    let keyword = '';
    let downloaded = Object.create(null);   // 已下载去重表（归一化 URL → 1）
    let filteredOut = 0;                    // 被过滤规则拦下的张数（底部要明示）
    let batchId = '';
    let running = false;
    let autoScanTimer = 0;

    const $ = id => document.getElementById(id);
    const el = {
        site: $('ipSite'), count: $('ipCount'), search: $('ipSearch'),
        rescan: $('ipRescan'), openVideo: $('ipOpenVideo'), album: $('ipAlbum'),
        library: $('ipLibrary'),
        more: $('ipMore'), moreMenu: $('ipMoreMenu'), webp: $('ipWebp'),
        tiers: $('ipTiers'), types: $('ipTypes'), body: $('ipBody'), grid: $('ipGrid'),
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

    /** 把失败原因转成可插进 innerHTML 的安全文本 */
    function escText(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
        /* 统一走 SW 的 vrImg.scan：逐帧注入扫描库、合并网络缓存与源码通道。
         * 旧实现在这里又抄了一份扫描器，导致侧栏 / popup / 图集口径漂移；
         * 这一层只负责参数与错误提示，不再自己遍历 DOM。 */
        return send({
            Message: 'vrImg.scan',
            action: 'vrImg.scan',
            tabId: tabId,
            minSize: opts.minSize,
            bgScan: opts.bgScan,
            srcScan: opts.srcScan,
            max: opts.max || 400
        }).then(res => {
            if (!res || !res.ok) {
                return { __noUtil: true, imgs: 0, message: (res && res.message) || '扫描失败' };
            }
            if (res.noUtil) { return { __noUtil: true, imgs: 0 }; }
            return Array.isArray(res.items) ? res.items : [];
        });
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
            /* 网络层图片（ADR-082）已由 vrImg.scan / VRImageScanService 在页面上下文
             * 合并并做完尺寸回填，这里不再重复拉一次 netCache。 */
            downloaded = (await storageGet('vrImgDownloaded')) || {};

            /* 缩略图渲染前先给图床放行（2026-11-13，B-82）。
             * 侧栏是 chrome-extension:// 页面，直接 <img src="https://wx1.sinaimg.cn/...">
             * 会被防盗链 403 → 19 张卡片全是空框（微博实测，用户会以为「没识别到图」）。
             * 后台按结果里的域名批量设 Referer（DNR），10 分钟自动清。
             * 必须**在渲染之前**做：先渲染再设规则，失败的 img 不会自己重试。 */
            try {
                await new Promise(function (resolve) {
                    chrome.runtime.sendMessage({
                        Message: 'vrMedia.headers',
                        urls: (raw || []).map(function (x) { return x && x.url; }).filter(Boolean).slice(0, 80),
                        referer: pageUrl
                    }, function () { void chrome.runtime.lastError; resolve(1); });
                });
            } catch (e) { /* 设不上就照常渲染，最差是缩略图空白 */ }

            buildItems(raw);
            /* 音视频条目并入同一个 items（2026-11-13，t2b）：
             * 面板不能只出图片 —— 苏哥要的是「图片/动图/视频/音频都在这里分类下」。
             * 数据来自 vrVideoOptions（与浮标菜单同一份），所以排除站内已下载判断、
             * 去重、命名都天然一致。
             * 失败不影响图片列表：拿不到就只显示图片，绝不让整个面板空白。 */
            try {
                const vids = await fetchVideoItems();
                if (vids && vids.length) {
                    const seenK = Object.create(null);
                    for (const it of items) { seenK[it.key] = 1; }
                    for (const v of vids) {
                        if (seenK[v.key]) { continue; }
                        seenK[v.key] = 1;
                        items.push(v);
                    }
                }
            } catch (eV) { /* 视频嗅探失败不影响图片 */ }
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
            pruneSelection();
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

    /* ---------------- 音视频条目（2026-11-13 新增，t2b） ---------------- */
    /**
     * 从后台嗅探结果构造音视频条目，与图片共用同一个 items 网格。
     *
     * 数据源是 vrVideoOptions（浮标右键菜单用的同一个接口）：
     *   { ok, site, options: [{ id, url, label, note, size, ext, type, ... }] }
     * 每个 option 是一条「可下载的档位」，label 形如 `1080p` / `HLS` / `MP4`。
     *
     * 为什么复用它的输出而不是另开一套嗅探：
     *   1) 它已经做完站点适配（微博 $render_data、小红书 SSR、HLS 清单展开、
     *      m3u8 分片剔除）—— 面板再扫一遍必然口径漂移；
     *   2) 用户点「下载」时走的也是这套 option id（t2d），两边必须是同一份。
     */
    async function fetchVideoItems() {
        const r = await send({ Message: 'vrVideoOptions', tabId: tabId, frameId: 0 });
        const opts = (r && r.ok && Array.isArray(r.options)) ? r.options : [];
        /* 同一页所有档位共用一个封面（video.poster / og:image） */
        const cover = String((r && r.cover) || '');
        const out = [];
        for (let i = 0; i < opts.length; i++) {
            const o = opts[i] || {};
            /* pending（只有封面、还没有直链）：也要进清单 —— X 这类站点
             * 不点播放就没有可下地址，但用户至少应该看见「这里有个视频」。
             * 完全没图没链的才跳过。 */
            if (!o.url && !o.cover) { continue; }
            const ext = String(o.ext || '').toLowerCase();
            const isAudio = /^(mp3|m4a|aac|flac|wav|ogg|opus)$/i.test(ext);
            const k = 'v:' + (o.id != null ? o.id : keyOf(o.url));
            out.push({
                url: o.url,
                w: 0, h: 0, bg: false,
                candidates: [o.url],
                key: k,
                orig: o.url,
                better: false,
                done: false,
                kind: isAudio ? TYPE_AUDIO : TYPE_VIDEO,
                /* 视频专用展示字段：label 是清晰度（1080p/HLS/MP4），
                 * note 是「最高清 · 当前播放」这类说明，dim 位置改显示它们。 */
                vlabel: o.label || '',
                vnote: o.note || '',
                vsize: Number(o.size) || 0,
                optionId: o.id,
                /* 封面：优先用条目自带的（DOM 兜底收来的），否则用页面级封面
                 * （2026-11-13 苏哥「连视频预览都做不到」）。没有仍走 ▶/♪ 占位。 */
                poster: isAudio ? '' : String(o.cover || cover || ''),
                /* 只有封面、暂无直链：面板标「先点播放」，点击时提示而不是静默失败 */
                pending: !!o.pending
            });
        }
        return out;
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

    /* ---------------- 类型判定（2026-11-13 新增） ---------------- */
    /* 面板要同时容纳图片/动图/视频/音频，与尺寸档位是两级筛选：
     *   先选「看哪一类」→ 图片再按尺寸细分；视频/音频没有尺寸概念，尺寸档位对它们不生效。
     * 判定优先用条目自带的 kind（t2b 接入音视频时会带上），
     * 没有就按扩展名推断 —— 这样 t2a 先跑起来，t2b 接入时不用改这里。 */
    const TYPE_IMG = 'image', TYPE_GIF = 'gif', TYPE_VIDEO = 'video', TYPE_AUDIO = 'audio';
    const EXT_GIF = /\.(gif|apng)$/i;
    const EXT_VIDEO = /\.(mp4|webm|mov|mkv|m4v|flv|ts|m4s|m3u8|mpd|avi)$/i;
    const EXT_AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|opus|wma)$/i;

    function typeOf(it) {
        if (it && it.kind) { return it.kind; }
        const u = String((it && it.url) || '').split('#')[0].split('?')[0];
        if (EXT_AUDIO.test(u)) { return TYPE_AUDIO; }
        if (EXT_VIDEO.test(u)) { return TYPE_VIDEO; }
        if (EXT_GIF.test(u)) { return TYPE_GIF; }
        return TYPE_IMG;
    }

    /** 该条目是否属于当前类型筛选。'all' 恒真。 */
    function inType(it) {
        if (typeFilter === 'all') { return true; }
        return typeOf(it) === typeFilter;
    }

    /** 尺寸档位只对「静态图片」有意义；动图/视频/音频不参与尺寸筛选 */
    function inTierFor(it, min) {
        const t = typeOf(it);
        if (t === TYPE_VIDEO || t === TYPE_AUDIO) {
            /* 音视频没有「尺寸档」，任何尺寸档下都照常显示；
             * 但「未知」档专指没量出尺寸的图，音视频不该混进去。 */
            return min !== TIER_UNKNOWN;
        }
        return inTier(it, min);
    }

    function renderTypes() {
        if (!el.types) { return; }
        const counts = { all: items.length, image: 0, gif: 0, video: 0, audio: 0 };
        for (const it of items) {
            const t = typeOf(it);
            if (counts[t] != null) { counts[t]++; }
        }
        const tabs = [
            { k: 'all', label: '全部', n: counts.all },
            { k: TYPE_IMG, label: '图片', n: counts.image },
            { k: TYPE_GIF, label: '动图', n: counts.gif },
            { k: TYPE_VIDEO, label: '视频', n: counts.video },
            { k: TYPE_AUDIO, label: '音频', n: counts.audio }
        ];
        el.types.innerHTML = tabs.map(function (t) {
            /* 0 项的类别不置灰 —— 与尺寸档位同一条理由：
             * 置灰会让人以为「点不动=功能坏了」，而切过去看到空列表才是明确结果。 */
            const on = typeFilter === t.k ? ' on' : '';
            const zero = t.n === 0 ? ' zero' : '';
            return '<button class="ip-type' + on + zero + '" data-type="' + t.k + '">' +
                t.label + '<span class="c">' + t.n + '</span></button>';
        }).join('');
    }

    /**
     * 剔除失效的选中项：已被移除、或已经下载完成的图不再保留在选中集里。
     *
     * 历史坑（2026-11-13 苏哥截图）：这里原名 autoSelect()，会**把当前筛选下的
     * 所有条目自动加入选中集** —— 打开侧栏/切档位/搜索一下，整屏就全被框起来
     * （「已选 47/49」但用户从没点过全选）。勾选是用户的决定，程序不该替他做主，
     * 所以现在只做「清理」，新增只能来自用户点格子 / 点全选。
     */
    function pruneSelection() {
        const alive = new Set();
        for (const it of items) {
            if (it.done) { continue; }
            alive.add(it.key);
        }
        if (!selected.size) { return; }
        for (const k of Array.from(selected)) {
            if (!alive.has(k)) { selected.delete(k); }
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
        return items.filter(it => inType(it) && inTierFor(it, tierMin) && matchKeyword(it, keyword));
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

        /* 音视频条目（2026-11-13，t2b）：没有缩略图，用「类型徽标 + 清晰度」占位。
         * 不能塞 <img src="xxx.m3u8"> —— 清单不是图片，只会留一个裂图框，
         * 用户会以为「视频嗅探失败了」。 */
        const kindNow = typeOf(it);
        if (kindNow === TYPE_VIDEO || kindNow === TYPE_AUDIO) {
            /* 有封面就画真图（2026-11-13 苏哥：「连视频预览都做不到」）——
             * 视频档位的 poster 由 background 的 vrVideoOptions 从页面 <video> 取。
             * 取不到才退回 ▶/♪ 占位，绝不假装有图。 */
            const poster = String(it.poster || '');
            if (poster && kindNow === TYPE_VIDEO) {
                const cov = document.createElement('img');
                cov.className = 'ip-thumb';
                cov.loading = 'lazy';
                cov.referrerPolicy = 'no-referrer';
                cov.src = poster;
                cov.alt = '';
                cov.addEventListener('error', () => { div.classList.add('loadfail'); });
                div.appendChild(cov);
                const play = document.createElement('span');
                play.className = 'ip-play';
                play.textContent = '▶';
                div.appendChild(play);
            } else {
                const ph = document.createElement('div');
                ph.className = 'ip-media-ph' + (kindNow === TYPE_AUDIO ? ' audio' : '');
                ph.textContent = kindNow === TYPE_AUDIO ? '♪' : '▶';
                div.appendChild(ph);
            }
            /* 视频条目的「打开」没有意义（预览层只放图），改成直接下载这一条 */
            div.setAttribute('data-act', 'pick');
            div.title = it.pending
                ? '这个视频还没播放过，暂无可下地址 · 先在页面上点一下播放再「重新探测」'
                : ((it.vlabel || '') + (it.vnote ? ' · ' + it.vnote : ''));
        } else {
            const img = document.createElement('img');
            img.className = 'ip-thumb';
            img.loading = 'lazy';
            /* 缩略图裂（2026-11-12，苏哥微博页实测）：
             * 侧边栏是 chrome-extension:// 页面，加载图床图片时 Referer 是扩展来源，
             * 部分站点按 Referer 放行 → 整屏裂图、连带「尺寸未知」的观感更差。
             * 先按「不带 Referer」请求（多数图床允许，且不会带一个明显错误的来源），
             * 失败再退回默认策略试一次 —— 反过来（先默认后 no-referrer）会先裂一下。 */
            img.referrerPolicy = 'no-referrer';
            img.src = it.url;
            img.alt = '';
            img.addEventListener('error', () => {
                if (!div.dataset.retried) {
                    div.dataset.retried = '1';
                    try { img.referrerPolicy = 'origin'; } catch (e) { /* 老内核忽略 */ }
                    img.src = it.url;   // 重新发一次请求
                    return;
                }
                div.classList.add('loadfail');
            });
            div.appendChild(img);
        }

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
         * 早先一律写「背景图」，实测源码抓来的 3 张全被标成背景图（2026-11-07 端到端暴露）。
         *
         * 音视频（2026-11-13，t2b）：它们本来就没有像素尺寸，写「尺寸未知」是误导。
         * 改显示「清晰度 · 体积」（HLS 清单不显示体积，见 video-quality 的同款理由）。 */
        if (kindNow === TYPE_VIDEO || kindNow === TYPE_AUDIO) {
            const bits = [];
            if (it.vlabel) { bits.push(it.vlabel); }
            if (it.vsize > 0) { bits.push((it.vsize / 1048576).toFixed(1) + 'MB'); }
            dim.textContent = bits.join(' · ') || (kindNow === TYPE_AUDIO ? '音频' : '视频');
        } else {
            dim.textContent = (it.w && it.h)
                ? (it.w + ' × ' + it.h)
                : (it.bg ? '背景图' : '尺寸未知');
        }

        /* 不再有悬停放大镜：点图本身就是看大图，
         * 再放一个 ⌕ 会让人以为「这里才能看」，而且侧边栏窄，多一个控件就多一份误触。 */

        /* 注意：img / 占位块已在上面按类型 append 过，这里不能再 append(img) ——
         * 那个变量只在图片分支里存在，音视频分支走到这儿会抛
         * 「img is not defined」，整个扫描直接失败（2026-11-13 实测踩到）。 */
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
        renderTypes();
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
        /* 文案与主按钮保持一致（2026-11-13，t2c）：原来是 '⟳'，现在按钮带文字，
         * 忙时也要说清在做什么，而不是只把图标换成省略号。 */
        el.rescan.textContent = b ? '⟳ 探测中…' : '⟳ 重新探测';
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

    /* 类型栏（2026-11-13 新增）：先定「看哪一类」，尺寸档位在其下细分图片。
     * 点类型不重置尺寸档位 —— 从「大 ≥1200」切到「视频」再切回「全部」时，
     * 用户期望原来的尺寸筛选还在，而不是被悄悄清空。 */
    if (el.types) {
        el.types.addEventListener('click', ev => {
            const b = ev.target.closest ? ev.target.closest('.ip-type') : null;
            if (!b || b.disabled) { return; }
            const t = b.getAttribute('data-type');
            if (!t) { return; }
            typeFilter = t;
            pruneSelection();
            renderAll();
        });
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
        pruneSelection();
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
            pruneSelection();
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

    let lastFailedItems = [];

    /** 批量回执归一：失败/硬失败（FSA 未授权等）不能算成功（阶段二口径）。 */
    function normalizeRes(res, total) {
        const r = res || {};
        const hard = r.ok === false || !!r.code || !!r.needGrant;
        return {
            ok: !hard && !(Number(r.fail) || 0),
            succeeded: Number(r.succeeded) || 0,
            fail: Number(r.fail) || (hard ? total : 0),
            skipped: Number(r.skipped) || 0,
            failures: Array.isArray(r.failures) ? r.failures : [],
            needGrant: !!r.needGrant,
            code: String(r.code || ''),
            message: String(r.message || '')
        };
    }

    /** 失败明细 → 原条目（重试时用，保持原序号命名） */
    function failedItemsOf(list, failures) {
        if (!failures.length) { return []; }
        const bad = Object.create(null);
        for (const f of failures) {
            if (f && f.url) { bad[String(f.url)] = 1; }
        }
        return list.filter(it => bad[it.url] || bad[it.orig] || (it.live && bad[it.live]));
    }

    /** 重试按钮：动态插在底部文案旁，不改 image.html（避免与并行会话冲突） */
    function setRetryUi(on) {
        const box = el.sum && el.sum.parentElement;
        if (!box) { return; }
        let btn = document.getElementById('ipRetry');
        if (!on) {
            if (btn) { btn.remove(); }
            return;
        }
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'ipRetry';
            btn.type = 'button';
            btn.className = 'ip-icb';
            btn.textContent = '重试失败';
            btn.addEventListener('click', () => {
                if (!lastFailedItems.length) { return; }
                runBatch(lastFailedItems, { retry: true });
            });
            box.appendChild(btn);
        }
        btn.textContent = '重试失败 ' + lastFailedItems.length;
    }

    /* 音视频批量（2026-11-13，t2d）：
     * 复用 vrVideoDownload —— 浮标点下载走的就是它，含 HLS 清单展开、
     * 分片合并、改名、入库。这里**不重写内核**，只负责逐条发起 + 汇总结果。 */
    async function runMediaBatch(mediaList) {
        let ok = 0, fail = 0;
        for (let i = 0; i < mediaList.length; i++) {
            const it = mediaList[i];
            el.progT.textContent = '音视频 ' + (i + 1) + ' / ' + mediaList.length;
            el.progBar.style.width = Math.round((i + 1) / mediaList.length * 100) + '%';
            let r = null;
            try {
                r = await send({
                    Message: 'vrVideoDownload',
                    tabId: tabId,
                    optionId: it.optionId,
                    wantBest: false,
                    frameId: 0,
                    meta: { title: pageTitle, pageUrl: pageUrl }
                });
            } catch (e) { r = null; }
            if (r && r.ok && !r.skipped) {
                ok++;
                downloaded[it.key] = 1;
                it.done = true;
            } else if (r && r.ok && r.skipped) {
                /* 后台去重命中：算成功（文件已在库里），但不重复计数 */
                it.done = true;
            } else {
                fail++;
            }
        }
        return { ok: ok, fail: fail };
    }

    async function runBatch(list, opts) {
        const o = opts || {};
        if (!list.length) { return; }
        /* 拆分：音视频走 vrVideoDownload，图片继续走 vrImg.batch（原链路不动） */
        const mediaList = list.filter(it => {
            const t = typeOf(it);
            return t === TYPE_VIDEO || t === TYPE_AUDIO;
        });
        const imgList = list.filter(it => {
            const t = typeOf(it);
            return t !== TYPE_VIDEO && t !== TYPE_AUDIO;
        });
        running = true;
        setRetryUi(false);
        batchId = 'b-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        el.prog.hidden = false;
        el.progBar.style.width = '0%';
        el.progT.textContent = '0 / ' + list.length;
        renderFoot();

        /* 先跑音视频：数量少但单条耗时长（要拉分片合并），放前面用户能先看到进度 */
        let mediaOk = 0, mediaFail = 0;
        if (mediaList.length) {
            const mr = await runMediaBatch(mediaList);
            mediaOk = mr.ok;
            mediaFail = mr.fail;
            if (!imgList.length) {
                running = false;
                el.prog.hidden = true;
                pruneSelection();
                renderAll();
                el.sum.innerHTML = '已保存 <b>' + mediaOk + '</b> 个音视频' +
                    (mediaFail ? '，失败 <b style="color:var(--danger)">' + mediaFail + '</b> 个' : '');
                return;
            }
        }

        const payload = [];
        imgList.forEach((it) => {
            const pos = items.indexOf(it);
            const seq = (pos >= 0 ? pos : payload.length) + 1;
            payload.push({
                url: it.orig || it.url,
                candidates: it.candidates,
                /* 必须带序号：同页多张图共用 pageTitle 时，背景会按 title 命名，
                 * 两张同名只剩扩展名能区分（实测 cover.jpg / sprite.png 落成同名 .jpg/.png）。
                 * 序号用条目在全量清单里的位置，重试时命名不漂。 */
                title: (pageTitle || '图片') + '_' + String(seq).padStart(2, '0')
            });
            if (it.live) {
                payload.push({
                    url: it.live,
                    candidates: (it.liveBackup && it.liveBackup.length)
                        ? [it.live].concat(it.liveBackup) : [it.live],
                    title: (pageTitle || '图片') + '_' + String(seq).padStart(2, '0') + '_live'
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
            concurrency: Number(settings.imgConcurrency) || 2,
            batchId: batchId
        });

        running = false;
        el.prog.hidden = true;
        const out = normalizeRes(res, payload.length);
        lastFailedItems = out.fail ? failedItemsOf(imgList, out.failures) : [];
        renderFoot();

        if (out.needGrant || out.code === 'IMG_E_FSA_PERM') {
            el.sum.innerHTML = '<b style="color:var(--danger)">批量保存需要先授权资源库目录</b> · 去媒体库选目录后重试';
            return;
        }
        const fresh = Math.max(0, out.succeeded - out.skipped);
        if (out.fail) {
            /* 只标记真正成功的：失败项不能写「已下载」，否则下次被跳过（B-84 验收） */
            for (const it of imgList) {
                if (lastFailedItems.indexOf(it) >= 0) { continue; }
                downloaded[it.key] = 1; it.done = true;
            }
            pruneSelection();
            renderAll();
            el.sum.innerHTML = '完成 <b>' + (fresh + mediaOk) + '</b> 个，失败 <b style="color:var(--danger)">' +
                (out.fail + mediaFail) + '</b> 个' + (out.failures[0] ? '（' + escText(out.failures[0].message || out.failures[0].code) + '）' : '');
            setRetryUi(lastFailedItems.length > 0);
        } else {
            for (const it of imgList) { downloaded[it.key] = 1; it.done = true; }
            pruneSelection();
            renderAll();
            el.sum.innerHTML = '已保存 <b>' + (fresh + mediaOk) + '</b> 个' +
                (out.skipped ? '，已存在跳过 <b>' + out.skipped + '</b> 张' : '');
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
    async function fetchBytes(url, candidates) {
        try {
            /* 走后台统一候选解析：扩展页直接 fetch 不带页面 Referer，
             * 防盗链站点会 403（微博/小红书实测）。 */
            const r = await send({
                Message: 'vrImg.fetchBytes',
                action: 'vrImg.fetchBytes',
                url: url,
                candidates: (candidates && candidates.length) ? candidates : [url],
                pageUrl: pageUrl
            });
            if (!r || !r.ok || !r.buf) { return null; }
            return { buf: r.buf, ct: r.mime || '' };
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
            const got = await fetchBytes(src, it.candidates);
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
        pruneSelection();
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

        /* 页面变化自动重扫（ADR-080）：内容脚本的 MutationObserver 只发信号，
         * 侧栏在这里节流重扫；保留用户已选中的 key。 */
        try {
            chrome.runtime.onMessage.addListener((msg, sender) => {
                if (!msg || (msg.Message !== 'vrImg.pageChanged' && msg.action !== 'vrImg.pageChanged')) { return; }
                if (sender && sender.tab && sender.tab.id !== tabId) { return; }
                if (running) { return; }
                clearTimeout(autoScanTimer);
                autoScanTimer = setTimeout(async () => {
                    if (running) { return; }
                    const keep = new Set(selected);
                    await scan();
                    if (keep.size) {
                        const valid = new Set(items.map(it => it.key));
                        selected = new Set([...keep].filter(k => valid.has(k)));
                        syncCells();
                        renderFoot();
                    }
                }, 1800);
            });
        } catch (eWatch) { /* 无 runtime 时忽略 */ }
        bindWebpToggle();
    }

    init();
})();
