/* ==========================================================
 * 枚举执行器：博主 URL → items[] → 下载链路
 *
 * 这是把「枚举层」与「下载层」接起来的唯一入口。
 *
 * 设计（2026-11-18）：
 *   · 执行器只负责循环：firstPage → fetch → parsePage → 下一页
 *   · fetch 由**注入**提供：SW 里用扩展 fetch，页面里用页面 fetch（带登录态）
 *   · 产出的 items 经 normalize 统一后，交给 vrImgBatch / vrBulkDownload
 *
 * 为什么不把 fetch 写死：
 *   B站/抖音/小红书都要求「页面上下文 + 登录态 cookie」，
 *   而 SW fetch 的 Referer/Origin 是 chrome-extension://，会被风控。
 *   所以取字节这一步必须由调用方决定在哪执行。
 * ========================================================== */
(function (root) {
    'use strict';

    var DEFAULT_LIMIT = 500;      // 安全上限：一次枚举最多这么多条
    var DEFAULT_DELAY = 600;      // 每页间隔（ms），避免触发风控
    /* D3：masterIds / disappeared 单任务上限。
     * ⚠️ 必须在这里**本地定义**，不能借用 store.js 里的同名变量 ——
     * 那是它的闭包私有量，runner 作用域里根本不存在；
     * 直接引用会在「写快照」那一支抛 ReferenceError，
     * 而 node --check 只查语法、查不出未定义标识符（本文件踩过一次）。 */
    var MAX_IDS = 2000;

    /* 平台 → site 短码（与 normalize.js 的 SITE_OF、vrBulkMeta 的识别口径一致）。
     * ⚠️ 2026-11-18 修（审计发现的接线缺口）：`toBatchItem` 原本**不输出 site**，
     * 而下游 `vrMediaPath` 的 site 三元链只认 x/weibo/xhs —— 其余全归 'other'
     * → B站/抖音/YouTube 的素材会落进「其他网页」目录，索引反解 platform 为空。
     * 枚举层自己补上，不指望下游猜。 */
    var SITE_OF = {
        x: 'x', weibo: 'weibo', xiaohongshu: 'xhs',
        douyin: 'douyin', bilibili: 'bilibili', youtube: 'youtube'
    };

    function str(v) { return String(v == null ? '' : v).trim(); }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    /**
     * 执行枚举。
     *
     * @param {object} opt
     * @param {object} opt.target     {platform, ownerId, ownerName, pageUrl}
     * @param {function} opt.fetchJson (url) → Promise<json>   由调用方注入
     * @param {object} [opt.state]    {mixinKey, queryId, wts, subTab, count}
     * @param {number} [opt.limit]    最多枚举多少条（默认 500）
     * @param {number} [opt.maxPages] 最多翻多少页（默认 50）
     * @param {number} [opt.delay]    每页间隔 ms（默认 600）
     * @param {function} [opt.onPage] (info) → void  每页回调（进度）
     * @param {function} [opt.store]  VREnumStore 实例（有则写断点）
     * @param {function} [opt.shouldStop] () → boolean  外部中断（用户取消）
     * @param {boolean} [opt.incremental] 增量模式：遇到「整页都已知」就提前停翻页
     *
     * ⚠️ 增量模式与 `disappeared` 互斥（2026-11-18 审计 D2/D3 的设计约束）：
     *   `disappeared` 是「上次有、这次没了」—— 必须**完整枚举**才能算准。
     *   增量模式提前停，没枚举到的不等于被删了。
     *   所以 `incremental=true` 时：masterIds 只**合并**不覆盖，disappeared 不更新。
     *   想算 disappeared 就关掉 incremental 跑一次全量。
     *
     * @returns {Promise<{ok, items, pages, total, stopped, error}>}
     */
    async function run(opt) {
        var o = opt || {};
        var target = o.target || {};
        var fetchJson = o.fetchJson;
        var limit = Number.isFinite(o.limit) ? o.limit : DEFAULT_LIMIT;
        var maxPages = Number.isFinite(o.maxPages) ? o.maxPages : 50;
        var delay = Number.isFinite(o.delay) ? o.delay : DEFAULT_DELAY;
        var onPage = typeof o.onPage === 'function' ? o.onPage : null;
        var shouldStop = typeof o.shouldStop === 'function' ? o.shouldStop : null;
        var store = o.store || null;
        var incremental = !!o.incremental;

        var out = { ok: false, items: [], pages: 0, total: 0, stopped: false, error: '' };

        if (typeof fetchJson !== 'function') {
            out.error = 'no-fetch';
            return out;
        }
        if (!target.platform || !target.ownerId) {
            out.error = 'bad-target';
            return out;
        }

        var P = root.VREnumPager;
        if (!P || typeof P.createPager !== 'function') {
            out.error = 'no-pager';
            return out;
        }

        /* 建分页器（会自动优先用 adapter） */
        var pager = P.createPager({
            platform: str(target.platform),
            ownerId: str(target.ownerId),
            ownerName: str(target.ownerName),
            subTab: str((o.state && o.state.subTab) || ''),
            count: Number((o.state && o.state.count)) || 20,
            mixinKey: str(o.state && o.state.mixinKey),
            queryId: str(o.state && o.state.queryId),
            wts: (o.state && o.state.wts),
            /* 2026-11-18（E2）：合集枚举。target 里带 targetKind/collectionId
             * （由 targets.detectOwnerTarget 解析出来），也可被 state 覆盖。 */
            targetKind: str((o.state && o.state.targetKind) || target.targetKind || 'owner'),
            collectionId: str((o.state && o.state.collectionId) || target.collectionId || ''),
            /* 2026-11-18（D10 修）：番剧参数**必须**一起传。
             * 原来只传了 collectionId，于是 `bangumiFirstPage` 拿不到 season/ep
             * → 返回空串 → runner 报 `no-first-page`（真机抓到：番剧 0 条）。 */
            seasonId: str((o.state && o.state.seasonId) || target.seasonId || ''),
            epId: str((o.state && o.state.epId) || target.epId || '')
        });

        if (!pager.supported) {
            out.error = 'unsupported-platform:' + str(target.platform);
            return out;
        }

        /* 断点恢复。
         * 2026-11-18（D10 连带）：任务键**必须**走统一出口 buildKey ——
         * 原来这里自己拼 `platform:ownerId`，于是「整博主」和「该 UP 的某个合集」
         * （两者 ownerId 都是 mid）撞在同一个键上，断点 cursor 与 masterIds 快照
         * 互相覆盖。buildKey 给合集/番剧加了后缀，两边规则一致才不会静默失败。 */
        var taskKey = (store && typeof store.buildKey === 'function')
            ? store.buildKey(target)
            : (str(target.platform) + ':' + str(target.ownerId));
        var prevIdSet = null;      // D2：上一轮 masterIds 的查找表（增量模式用）
        var prevMasterIds = null;  // D3：上一轮快照原样（收尾算差集用）
        var prevTaskExists = false; // 任务是否存在（决定收尾要不要 start；别拿 masterIds 是否为空代替）
        if (store && typeof store.get === 'function') {
            try {
                var saved = await store.get(taskKey);
                if (saved) { prevTaskExists = true; }
                /* 断点只在「上次没跑完」时才恢复（2026-11-18 真机修的真 bug）。
                 *
                 * 原来是无条件 `pager.restore(saved.cursor)` —— 于是**上一次已经
                 * 跑完的任务**，它的 cursor 停在队尾，下一次点「抓取全部」
                 * 就被当成「从队尾继续」，直接返回最后一页那几条。
                 *
                 * 实测证据（抖音某博主，总量数百条）：
                 *   · 首次 maxPages=10 → 144 条（正常）
                 *   · 之后再调（不论几页）→ **只有 3 条**
                 *   · store 里躺着 {cursor:{maxCursor:...}, status:'done', done:3}
                 * 用户看到的就是「抓取全部只抓到 3 条」，且**怎么重试都一样**，
                 * 因为每次都会再把这个断点写回去 —— 自锁。
                 *
                 * 正确语义：
                 *   running / interrupted（上次被打断）→ 续跑，恢复 cursor
                 *   done / failed / 无记录           → 从头抓
                 *   incremental（增量）              → 必须从头，靠整页已知提前停
                 *     （若恢复队尾断点，第 1 页就全是已知 → 立刻停，同样只拿到几条） */
                var st = String((saved && saved.status) || '');
                var resumeOk = (st === 'running' || st === 'interrupted') && !incremental;
                if (saved && saved.cursor && resumeOk) { pager.restore(saved.cursor); }
                if (saved && Number(saved.done)) { out.total = Number(saved.done); }
                /* 2026-11-18（D2/D3）：一次读出上一轮快照，循环里与收尾处共用。
                 * 循环里建查找表判「整页是否已知」；收尾处算 disappeared。
                 * 只读一次，避免翻页热路径反复打存储。 */
                if (saved && Array.isArray(saved.masterIds) && saved.masterIds.length) {
                    prevMasterIds = saved.masterIds.slice();
                    prevIdSet = Object.create(null);
                    prevMasterIds.forEach(function (id) { if (id) { prevIdSet[id] = 1; } });
                }
            } catch (e) { /* 断点读取失败不影响主流程 */ }
        }

        var seen = Object.create(null);   // 批内去重（同一条可能跨页重复出现）
        var url = pager.start();
        if (!url) {
            out.error = pager.error ? (pager.error() || 'no-first-page') : 'no-first-page';
            return out;
        }

        while (url && out.pages < maxPages && out.items.length < limit) {
            if (shouldStop && shouldStop()) { out.stopped = true; break; }

            var json = null;
            try {
                json = await fetchJson(url);
            } catch (e) {
                out.error = 'fetch-failed:' + String((e && e.message) || e);
                break;
            }

            /* advance 会解析本页 + 产出下一页 */
            var next = pager.advance(json);
            out.pages += 1;

            var pageItems = [];
            if (typeof pager.items === 'function') {
                pageItems = pager.items();
            }
            /* D2 增量模式：整页都是「上一轮已经枚举过」的作品 → 说明已经翻到旧内容，
             * 后面的更旧，没必要再翻（B站 order=pubdate、抖音/微博都是新到旧）。
             *
             * 判定用**本页全部**都已知，而不是「遇到第一个已知就停」：
             * 置顶、合集插入、跨页重排都会让新内容出现在旧内容后面，
             * 按单个条目停会漏掉后面的新作品（抖珍藏踩过同类问题）。 */
            var pageAllKnown = false;
            if (incremental && pageItems.length && prevIdSet) {
                pageAllKnown = pageItems.every(function (it) {
                    var id = str(it && (it.mediaId || it.awemeId || it.noteId || it.statusId));
                    return !!id && !!prevIdSet[id];
                });
            }
            pageItems.forEach(function (it) {
                if (out.items.length >= limit) { return; }
                var k = [str(it.site || target.platform), str(it.mediaId || it.url)].join('|');
                if (seen[k]) { return; }
                seen[k] = 1;
                /* 2026-11-18 修（接线缺口）：adapter 只产出业务字段，**不带 platform**
                 * （实测 toItem 里没有这个键）。下游 toBatchItem 靠 platform 查 SITE_OF
                 * 决定 site 短码，缺了就会全落 'other' → 素材进「其他网页」目录。
                 * 这里统一补上：item 自己的优先，否则用本次枚举的目标平台。 */
                if (!it.platform) { it.platform = str(target.platform); }
                out.items.push(it);
            });
            /* 已知页也照样收进 items（调用方要看到「这一页有什么」），
             * 只是不再继续翻下一页。 */
            if (pageAllKnown) {
                out.incrementalStopped = true;
                break;
            }

            out.total = out.items.length;

            /* 写断点（每页一次，SW 重启可续） */
            if (store && typeof store.patch === 'function') {
                try {
                    await store.patch(taskKey, {
                        cursor: pager.cursor(),
                        done: out.items.length,
                        total: out.items.length,
                        pages: out.pages,
                        status: next ? 'running' : 'done'
                    });
                } catch (e2) { /* 断点写失败不影响枚举 */ }
            }

            if (onPage) {
                try { onPage({ pages: out.pages, total: out.items.length, next: !!next }); }
                catch (e3) { /* 回调异常不打断 */ }
            }

            /* adapter 报错（如 -352 风控）→ 停止并把错误带出去 */
            if (typeof pager.error === 'function') {
                var err = pager.error();
                if (err) { out.error = err; break; }
            }

            url = next;
            if (url && delay > 0) { await sleep(delay); }
        }

        /* ==========================================================
         * 截断检测（2026-11-18 修，与断点恢复是同一个真 bug 的两面）
         *
         * `while` 的退出有四种原因，但原来只区分了「有没有 error/stopped」：
         *   ① url 为空            → 真到底，完整
         *   ② pages >= maxPages   → **撞页数上限，后面可能还有**
         *   ③ items >= limit      → **撞条数上限，后面可能还有**
         *   ④ break（error/停止/增量已知页）
         * ②③ 原来被当成「完整跑完」，后果有两个，都很严重：
         *   · 收尾写 status:'done' → 下次点「抓取全部」会恢复这个队中断点，
         *     只拿到最后一页那几条（抖音实测：数百条的作者只返回 3 条）
         *   · 用这份不完整的列表去算 disappeared → **把没翻到的作品
         *     全部误标成「博主已删」**。这是备份工具最不能犯的错：
         *     用户会以为自己保存的东西已经被原作者删除。
         * ========================================================== */
        var truncated = false;
        if (!out.error && !out.stopped && !out.incrementalStopped) {
            if (url && out.pages >= maxPages) { truncated = true; }
            if (out.items.length >= limit) { truncated = true; }
        }
        out.truncated = truncated;

        out.ok = out.items.length > 0 && !out.error;

        /* ==========================================================
         * D2/D3：masterIds / disappeared（借鉴抖珍藏，2026-11-18）
         *
         * disappeared = 「上一次枚举到的作品，这一次没有了」
         *   → 博主删了，但用户本地可能还留着。这是备份相对在线收藏的实质优势。
         *
         * ⚠️ 两种模式语义不同，必须分开处理：
         *   · 全量（默认）：只在**完整跑完**时覆盖快照并算差集。
         *     中断（取消 / 出错 / 撞上限）时没枚举到 ≠ 被删了。
         *   · 增量（incremental）：只**合并**新 ID，**绝不**更新 disappeared。
         *     它提前停翻页，后面那些没枚举到的作品都还在，若算差集会把整批误标成「已消失」。
         *     要算 disappeared 就用全量跑一次。
         * ========================================================== */
        if (store && typeof store.patch === 'function') {
            /* 增量提前停（incrementalStopped）不算「完整跑完」 */
            /* 截断（撞 maxPages/limit）不算「完整跑完」：
             * 既不能覆盖快照算 disappeared（会把没翻到的误标成已删除），
             * 也不能把 status 写成 done（会让下次点抓取全部变成续跑队尾）。 */
            var fullComplete = !out.stopped && !out.error &&
                !out.incrementalStopped && !truncated;
            var canWriteInc = incremental && !out.stopped && !out.error;

            if (fullComplete || canWriteInc) {
                var curIds = [];
                var idSeen = Object.create(null);
                out.items.forEach(function (it) {
                    var id = str(it && (it.mediaId || it.awemeId || it.noteId || it.statusId));
                    if (!id || idSeen[id]) { return; }
                    idSeen[id] = 1;
                    curIds.push(id);
                });

                /* 上一轮快照：优先用循环前读到的那份（少一次存储读）。
                 * ⚠️ 任务可能还不存在（runner 从不主动 start —— 只有调用方传了现成任务才有）。
                 *   patch 在任务缺失时直接返回 null，快照就永远写不进去：
                 *   「disappeared 永不生效」这种失败是**静默**的，最容易漏。
                 *   所以这里补一次「缺则创建」。 */
                var prevIds = prevMasterIds || [];
                if (!prevTaskExists && typeof store.start === 'function') {
                    try {
                        /* 2026-11-18（D10 连带）：**必须**把 targetKind 等一起传下去，
                         * 否则 store.start 会按 owner 规则算键，与上面的 taskKey 对不上
                         * —— 建出来的任务永远读不到，patch 全成 no-op（静默失败）。 */
                        await store.start({
                            platform: str(target.platform),
                            ownerId: str(target.ownerId),
                            ownerName: str(target.ownerName),
                            pageUrl: str(target.pageUrl),
                            targetKind: str(target.targetKind || 'owner'),
                            collectionId: str(target.collectionId || ''),
                            seasonId: str(target.seasonId || ''),
                            epId: str(target.epId || '')
                        });
                    } catch (eSt) { /* 创建失败：patch 会是 no-op，不影响本次结果 */ }
                }

                if (incremental) {
                    /* 增量：旧 ∪ 新（保序：已有在前，新发现的追加在后） */
                    var merged = prevIds.slice();
                    var mergedSet = Object.create(null);
                    merged.forEach(function (id) { mergedSet[id] = 1; });
                    curIds.forEach(function (id) {
                        if (!mergedSet[id]) { mergedSet[id] = 1; merged.push(id); }
                    });
                    if (merged.length > MAX_IDS) { merged = merged.slice(0, MAX_IDS); }

                    try {
                        /* **不传 disappeared** —— 保持上一次全量算出的结果 */
                        await store.patch(taskKey, {
                            masterIds: merged,
                            lastRun: Date.now(),
                            status: 'done'
                        });
                        out.masterIds = merged.length;
                        out.incremental = true;
                    } catch (eS2) { /* 快照写失败不影响本次枚举结果 */ }
                } else {
                    var disappeared = prevIds.filter(function (id) { return !idSeen[id]; });

                    /* 上限保护：超出部分按「最近枚举到的」优先保留（curIds 已按枚举顺序） */
                    if (curIds.length > MAX_IDS) { curIds = curIds.slice(0, MAX_IDS); }
                    if (disappeared.length > MAX_IDS) { disappeared = disappeared.slice(0, MAX_IDS); }

                    try {
                        await store.patch(taskKey, {
                            masterIds: curIds,
                            disappeared: disappeared,
                            lastRun: Date.now(),
                            status: 'done'
                        });
                        out.masterIds = curIds.length;
                        out.disappeared = disappeared;
                    } catch (eS) { /* 快照写失败不影响本次枚举结果 */ }
                }
            }
        }

        return out;
    }

    /**
     * 把 adapter 产出的 item 转成 vrImgBatch 要的格式。
     *
     * 字段差异（实测）：
     *   adapter:  {url, kind, title, pageUrl, author, authorId, authorFull?}
     *   vrImgBatch: {url, candidates, title, pageUrl, authorFull, creatorId}
     *
     * @param {object} it
     * @returns {object}
     */
    function toBatchItem(it) {
        var i = it || {};
        var author = str(i.author);
        var authorId = str(i.authorId);
        /* 2026-11-18（E2）：作者名的兜底。
         * 合集端点（seasons_archives_list）的 archives 条目里**没有作者字段**
         * （实测 itemKeys: aid/bvid/ctime/duration/pic/pubdate/stat/state/title…），
         * 作者只能来自调用方传的 ownerName；纯 URL 驱动时拿不到名字。
         * 这时至少不能把 creatorId 也丢掉 —— 下游归档要按 UP 主建目录，
         * 丢了 creatorId 就只能落在「待整理」里。 */
        var authorFull = str(i.authorFull) ||
            (author ? (authorId ? author + '(@' + authorId + ')' : author)
                : (authorId ? ('@' + authorId) : ''));
        return {
            url: str(i.url),
            candidates: Array.isArray(i.candidates) && i.candidates.length
                ? i.candidates.slice() : (i.url ? [str(i.url)] : []),
            title: str(i.title),
            pageUrl: str(i.pageUrl),
            /* 2026-11-18 修（真机抓到的真 bug）：**必须**透传 author/authorId。
             * 下游 vrBulkName / vrMediaPath / vrBulkMeta 读的是 `it.author`、
             * `it.authorId`，而这里原来只输出 authorFull/creatorId ——
             * 于是 B站/抖音条目在这三个函数里全部命中「拿不到作者」的兜底：
             *   · vrBulkName   → 前缀落到 'weibo'（三目兜底是 x/xhs/weibo）
             *   · vrMediaPath  → site 落到 'other' → platform='web'
             *   · siteOf 认不出平台 → 用**域名**当作者段
             * 实测后果（B站面板「保存选中」）：
             *   bilibili.com\www.bilibili.com\weibo_矛盾从来不是靠沟通解决的_01.mp4
             * 而正确应该是：
             *   B站\天涯神贴清念(@3494366599449160)\矛盾从来不是靠沟通解决的.mp4
             * 文件确实落盘了、界面也报「完成 2/2」，但目录与命名全错 ——
             * 属于「成功得不对」，比直接失败更难发现。 */
            author: str(i.author),
            authorId: authorId,
            authorFull: authorFull,
            creatorId: authorId,
            /* 平台短码：下游 vrMediaPath / vrBulkMeta 靠它决定归档目录与索引 platform。
             * 不传 → 落 'other' → 「其他网页」目录 + 库页筛不到平台。 */
            site: str(i.site) || SITE_OF[str(i.platform)] || 'other',
            /* 附带：便于下游判断类型与溯源 */
            kind: str(i.kind) || 'image',
            mediaId: str(i.mediaId),
            statusId: str(i.statusId),
            noteId: str(i.noteId),
            awemeId: str(i.awemeId)
        };
    }

    /** 批量转换 */
    function toBatchItems(items) {
        var list = Array.isArray(items) ? items : [];
        return list.map(toBatchItem).filter(function (x) {
            return /^https?:/i.test(x.url);
        });
    }

    root.VREnumRunner = {
        run: run,
        toBatchItem: toBatchItem,
        toBatchItems: toBatchItems,
        DEFAULT_LIMIT: DEFAULT_LIMIT,
        DEFAULT_DELAY: DEFAULT_DELAY
    };
})(typeof self !== 'undefined' ? self : this);
