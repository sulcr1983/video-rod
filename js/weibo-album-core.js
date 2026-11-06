/* ==========================================================
 * VRWeiboAlbum —— 微博相册分页与分桶（纯逻辑，可 Node 单测）
 *
 * 职责：
 *   · 月份字符串运算（'YYYY-MM' 加减）
 *   · 从接口条目取月份（timeline_year/month，缺失时用 created_at 兜底）
 *   · 由 pid 构造候选链（档位顺序即优先级）
 *   · 单页分桶 + 判定是否已越过起始月
 *   · 分页循环：双重终止 + 页数硬上限 + 可中断
 *
 * 约定：
 *   - 不碰 chrome.*、不写 DOM、不发网络请求（fetchPage 由调用方注入）
 *   - 浏览器/内容脚本挂 self.VRWeiboAlbum；Node 走 module.exports
 *   - 零依赖，ES5 为主
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRWeiboAlbum = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    var API = 'https://weibo.com/ajax/profile/getImageWall';
    var MAX_PAGES = 200;

    /* 候选链顺序即优先级。
     * 末级第三方代理按苏哥拍板保留，但不作主路径。 */
    var CDN = {
        large: 'https://wx3.sinaimg.cn/large/',
        original: 'https://wx3.sinaimg.cn/original/',
        thumb: 'https://wx3.sinaimg.cn/orj360/'
    };

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function thumbOf(pid) {
        return CDN.thumb + pid + '.jpg';
    }

    /**
     * 档位顺序（顺序即优先级）。
     *
     * 2026-11-06 真实登录态实测（Edge 9480，3 个样本）推翻了原设计：
     *   oslarge  690×847 / 161 KB      ← 比 large 小，原来却排在第一位
     *   large    744×913 / 353 KB      ← 实际最大
     *   original 744×913 / 353 KB      ← 与 large 完全一致（尺寸与字节都相同）
     *   lz       TypeError: Failed to fetch（跨域 3/3 全失败）
     * 所以 large 作首选，original 作等价备份；oslarge、lz、第三方代理一并移除。
     */
    var TIER_ORDER = ['large', 'original'];

    /** 档位名 → URL 前缀（large 优先；original 是实测等价的备份） */
    function tierPrefix(tier) {
        if (tier === 'original') { return CDN.original; }
        return CDN.large;
    }

    /**
     * 由 pid 构造候选链；可指定首选档位（探测结果）。
     * 指定档位排第一，其余按 TIER_ORDER 补齐，不丢任何一级。
     */
    function candidates(pid, firstTier) {
        var lead = TIER_ORDER.indexOf(firstTier) >= 0 ? firstTier : TIER_ORDER[0];
        var order = [lead].concat(TIER_ORDER.filter(function (t) { return t !== lead; }));
        return order.map(function (t) { return tierPrefix(t) + pid + '.jpg'; });
    }

    /**
     * 候选地址是否真的是一张图（而不是占位图 / 错误页）。
     *
     * 为什么不能只看 HTTP 200：实测 sinaimg 对无效 pid 返回
     *   200 + image/gif + final URL 重写为 .../images/default_s_<档位>.gif
     * 只看状态码会把它当成功，把占位图存进用户相册。
     *
     * @param {{status:number, type:string, finalUrl:string, bytes:number}} r
     * @returns {{ok:boolean, why:string}}
     */
    function usableImage(r) {
        var x = r || {};
        var status = Number(x.status);
        var type = String(x.type || '').toLowerCase();
        var finalUrl = String(x.finalUrl || '');
        var bytes = Number(x.bytes) || 0;

        if (status !== 200) { return { ok: false, why: 'status ' + status }; }
        if (type.indexOf('image/') !== 0) { return { ok: false, why: 'content-type ' + (type || '(none)') }; }
        if (/\/images\/default_/.test(finalUrl)) { return { ok: false, why: 'placeholder' }; }
        if (bytes > 0 && bytes < 1024) { return { ok: false, why: 'too-small ' + bytes }; }
        /* 微博相册真实作品是 jpg；gif 基本都是占位/表情，不当原图 */
        if (type === 'image/gif') { return { ok: false, why: 'gif' }; }
        return { ok: true, why: 'ok' };
    }

    /**
     * 从探测结果里挑第一个可用档位。
     * @param {Array<{tier:string, status:number, type:string, finalUrl:string, bytes:number}>} probes
     * @returns {{tier:string, ok:boolean, tried:number}}
     */
    function pickTier(probes) {
        var list = Array.isArray(probes) ? probes : [];
        for (var i = 0; i < list.length; i++) {
            var p = list[i] || {};
            var u = usableImage(p);
            if (u.ok) { return { tier: p.tier || TIER_ORDER[0], ok: true, tried: i + 1 }; }
        }
        return { tier: TIER_ORDER[0], ok: false, tried: list.length };
    }

    /**
     * 探测各档位是否真的可取到图（IO 通过 fetchFn 注入，便于单测）。
     *
     * 为什么需要探测：候选池机制在当前 background.js 里并不存在
     * （`vrBulkSaveItem` 只用单个 it.url），所以「把整条链交上去逐级回退」不成立。
     * 改为下载前用一张样本图探一次，把验证过的档位当作首选地址 ——
     * 同一相册里所有图的档位可用性一致，一次探测即可代表整批。
     *
     * @param {string} pid 样本 pid
     * @param {Function} fetchFn (url) => Promise<{status,type,finalUrl,bytes}>
     * @param {string[]} [tiers] 默认 TIER_ORDER
     * @returns {Promise<{tier:string, ok:boolean, tried:number, probes:Array}>}
     */
    async function probeTiers(pid, fetchFn, tiers) {
        var order = Array.isArray(tiers) && tiers.length ? tiers : TIER_ORDER;
        var probes = [];
        if (!pid || typeof fetchFn !== 'function') {
            return { tier: TIER_ORDER[0], ok: false, tried: 0, probes: probes };
        }
        for (var i = 0; i < order.length; i++) {
            var tier = order[i];
            var rec = null;
            try {
                var r = (await fetchFn(tierPrefix(tier) + pid + '.jpg')) || {};
                rec = {
                    tier: tier,
                    status: Number(r.status) || 0,
                    type: String(r.type || ''),
                    finalUrl: String(r.finalUrl || ''),
                    bytes: Number(r.bytes) || 0
                };
            } catch (e) {
                rec = { tier: tier, status: 0, type: '', finalUrl: '', bytes: 0 };
            }
            probes.push(rec);
            if (usableImage(rec).ok) { break; }   // 命中即停：后面的档位不必再打
        }
        var picked = pickTier(probes);
        picked.probes = probes;
        return picked;
    }

    /**
     * 按 pid 过滤掉已下载过的条目。
     *
     * 为什么需要（而不是依赖后端的去重键）：`vrMediaIdentity()` 的键里
     * **仍包含 URL 的 origin+pathname**，而同一张图在不同档位下 pathname 不同
     * （/oslarge/ vs /large/）。档位一变，后端就算出不同的键 → 判成新图 → 重复下载。
     * 所以在内容脚本侧按 pid（与 CDN 域名、档位都无关）再兜一层。
     *
     * @param {Array} items 待下载条目
     * @param {Set|Array} done 已下载 pid 集合
     * @returns {{fresh:Array, skipped:number}}
     */
    function filterDone(items, done) {
        var set = done instanceof Set ? done : new Set(Array.isArray(done) ? done : []);
        var arr = Array.isArray(items) ? items : [];
        var fresh = [];
        var skipped = 0;
        for (var i = 0; i < arr.length; i++) {
            var it = arr[i];
            var pid = it && (it.mediaId || pidOf(it.url));
            if (pid && set.has(pid)) { skipped++; continue; }
            fresh.push(it);
        }
        return { fresh: fresh, skipped: skipped };
    }

    /** 把本批条目的 pid 并入已完成集合，并按上限滚动淘汰（防止无限增长） */
    function mergeDone(done, items, limit) {
        var set = done instanceof Set ? done : new Set(Array.isArray(done) ? done : []);
        var arr = Array.isArray(items) ? items : [];
        for (var i = 0; i < arr.length; i++) {
            var pid = arr[i] && (arr[i].mediaId || pidOf(arr[i].url));
            if (pid) { set.add(pid); }
        }
        var max = Number(limit) || 20000;
        var out = Array.from(set);
        if (out.length > max) { out = out.slice(out.length - max); }
        return new Set(out);
    }

    /**
     * 归类一次批量下载的最终结果（不把失败当成功）。
     *
     * 与后台既有行为保持一致的地方：
     *   · `.htm` 残件由后台 `vrDropDownload(id)` 在 interrupted 分支清理，这里不重复处理；
     *   · 后台把「内容错误」（404/无效文件）计入 hardFail 且不触发风控暂停，这里照抄口径；
     *   · 后台 paused=true 表示「连败 3 次且零成功」，属疑似风控，直接停下。
     *
     * 本函数只做「怎么说、要不要记已完成」两个决定：
     *   state: 'ok'      全部到位（含重复跳过）
     *          'partial' 有成功也有失败 —— 不记已完成，下次重跑还能补
     *          'blocked' 一条没成 —— 多为站点限制/档位不可用
     *          'paused'  被风控暂停
     *          'error'   后台没应答
     *
     * @param {object} res 后台返回 {ok,total,done,skipped,failed,hardFail,paused,reason}
     * @param {number} total 本次实际提交的条数
     * @param {number} localSkipped 本地按 pid 跳过的条数
     * @returns {{state:string, msg:string, markDone:boolean, failed:number}}
     */
    function classifyBulkResult(res, total, localSkipped) {
        var n = Number(total) || 0;
        var local = Number(localSkipped) || 0;
        var r = res || null;

        if (!r || r.ok === false) {
            var why = r && r.reason ? '：' + r.reason : '';
            return { state: 'error', msg: '下载失败' + why, markDone: false, failed: n };
        }

        var done = Number(r.done) || 0;
        var skipped = Number(r.skipped) || 0;
        var failed = Number(r.failed) || 0;
        var hardFail = Number(r.hardFail) || 0;
        var settled = done + skipped + local;

        if (r.paused) {
            return {
                state: 'paused',
                msg: (r.reason || '已暂停（连续失败，可能触发风控）') +
                    (settled ? '，已存 ' + settled + ' 张' : ''),
                markDone: false,
                failed: failed
            };
        }

        if (failed > 0 || hardFail > 0) {
            var head = done === 0
                ? '全部未成功（' + (failed + hardFail) + ' 张）'
                : '完成 ' + done + '/' + (n + local);
            var tail = '，失败 ' + failed;
            if (hardFail) { tail += '（其中内容错误 ' + hardFail + '）'; }
            if (done === 0) {
                tail += '。可能是站点限制了直链下载，或图已删除';
            } else {
                tail += '。可稍后重跑，只会补下缺的那些';
            }
            return {
                state: done === 0 ? 'blocked' : 'partial',
                msg: head + tail,
                markDone: false,
                failed: failed + hardFail
            };
        }

        /* 零失败：还要确认条数对得上，才算「全部到位」 */
        var msg = '完成：' + done + '/' + n;
        if (skipped) { msg += '，重复跳过 ' + skipped; }
        if (local) { msg += '，本地跳过 ' + local; }
        return {
            state: settled >= n + local ? 'ok' : 'partial',
            msg: msg,
            markDone: settled >= n + local,
            failed: 0
        };
    }

    /** 从 sinaimg 地址取出 pid；非 sinaimg / 无扩展名 / 解析失败返回 '' */
    function pidOf(url) {
        var s = String(url || '');
        var m = s.match(/[a-z0-9]+\.sinaimg\.cn\/[^/]+\/([A-Za-z0-9_-]{8,})\.(?:jpe?g|png|gif|webp)/i);
        if (m) { return m[1]; }
        /* 相对地址（页面里偶见 //wx3... 或 /large/xxx.jpg）也兜一下 */
        var m2 = s.match(/\/([A-Za-z0-9_-]{8,})\.(?:jpe?g|png|gif|webp)$/i);
        return m2 ? m2[1] : '';
    }

    /**
     * 由任意 sinaimg 地址构造候选链（顺序即优先级）。
     * 已是本域名的图或页面实际地址会作为兜底插入；非 sinaimg 原样返回单元素。
     * @param {string} src 页面上的图片地址
     * @returns {string[]}
     */
    function candidatesFromUrl(src) {
        var s = String(src || '');
        if (!s) { return []; }
        var pid = pidOf(s);
        if (!pid) { return [s]; }
        var out = [];
        function push(u) { if (u && out.indexOf(u) < 0) { out.push(u); } }
        /* 顺序：large → original → 页面实际地址。
         * 页面地址放最后兜底：它是页面上真实显示的图，一定取得到，只是分辨率可能低。
         * （原设计里的第三方代理与 lz 域名在 2026-11-06 实测中 3/3 全部 Failed to fetch，已移除。） */
        candidates(pid).forEach(push);
        push(s);
        return out;
    }

    function apiUrl(uid, sinceid) {
        return API + '?uid=' + encodeURIComponent(uid) +
            '&sinceid=' + encodeURIComponent(sinceid) + '&has_album=true';
    }

    /**
     * 单页收集（不再按月分桶）。
     *
     * 2026-11-06 真实登录态实测：timeline_year/timeline_month 大面积缺失 ——
     *   第 1 页 21 条只有 6 条有月份；第 2 页起 24 条**全部为空**。
     *   三页共 71 条，65 条无月份，按 mid 分组只能补回 8 条，57 条救不回来。
     * 所以不再用月份做分组或终止条件，改为「按接口顺序收集」：
     * 接口本身按时间倒序返回，顺序就是天然的时间序。
     *
     * 跳过两类条目（实测都会导致下载失败）：
     *   · 没有 pid：接口首条就是 object_id:null + 无 pid，硬拼会得到 undefined.jpg
     *   · 非 pic 类型：目前只有 pic，保留过滤以免将来混入视频条目
     *
     * @param {Array} list 接口返回的 data.list
     * @param {Array} out 收集容器 [{pid, mid}]
     * @param {Set} seen 已收集的 pid（跨页去重）
     * @returns {{added:number, skipped:number}}
     */
    function collectPage(list, out, seen) {
        var arr = Array.isArray(list) ? list : [];
        var added = 0;
        var skipped = 0;
        var set = seen instanceof Set ? seen : new Set();
        for (var i = 0; i < arr.length; i++) {
            var it = arr[i];
            if (!it || !it.pid) { skipped++; continue; }
            if (it.type && it.type !== 'pic') { skipped++; continue; }
            if (set.has(it.pid)) { skipped++; continue; }     // 翻页边界可能重复
            set.add(it.pid);
            out.push({ pid: it.pid, mid: it.mid ? String(it.mid) : '' });
            added++;
        }
        return { added: added, skipped: skipped };
    }

    /**
     * 分页循环。终止条件（任一成立即停）：
     *   ① 列表为空
     *   ② 游标未推进（防接口返回同一 since_id 导致死循环）
     *   ③ 收集够 limit 条（默认不限）
     *   ④ 达到 maxPages 硬上限
     *   ⑤ 调用方 isStopped() 返回 true（用户点「停止」）
     *
     * 注：不再用月份做终止条件 —— 实测月份字段大面积缺失（见 collectPage 注释）。
     *
     * @param {object} opt { uid, limit, fetchPage(sinceid)->Promise<data>,
     *                       maxPages, gapMs, sleep(ms), isStopped(), onPage(info) }
     * @returns {Promise<{state, pages, items, cursor, reason, skipped}>}
     *   state: 'done' | 'stopped' | 'maxed' | 'error' | 'limit'
     */
    async function paginate(opt) {
        var o = opt || {};
        var items = [];
        var seen = new Set();
        var skipped = 0;
        var maxPages = Math.max(1, Number(o.maxPages) || MAX_PAGES);
        var limit = Number(o.limit) > 0 ? Number(o.limit) : Infinity;
        var sleep = typeof o.sleep === 'function'
            ? o.sleep
            : function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        var gapMs = Number(o.gapMs) >= 0 ? Number(o.gapMs) : 900;
        var cursor = '0';
        var pages = 0;
        var state = 'done';
        var reason = '';

        try {
            while (pages < maxPages) {
                if (typeof o.isStopped === 'function' && o.isStopped()) {
                    state = 'stopped';
                    break;
                }
                var data = await o.fetchPage(cursor);
                pages++;

                var list = (data && Array.isArray(data.list)) ? data.list : [];
                if (!list.length) { state = 'done'; reason = 'empty'; break; }

                var got = collectPage(list, items, seen);
                skipped += got.skipped;
                if (typeof o.onPage === 'function') {
                    try {
                        o.onPage({ page: pages, cursor: cursor, added: got.added, total: items.length });
                    } catch (e) { /* 回调异常不影响翻页 */ }
                }

                if (items.length >= limit) { state = 'limit'; reason = 'limit'; break; }

                var next = data && data.since_id;
                if (!next || String(next) === String(cursor)) {
                    state = 'done'; reason = 'cursor-stalled'; break;
                }

                cursor = String(next);
                if (gapMs && pages < maxPages) { await sleep(gapMs); }
            }
            if (pages >= maxPages && state === 'done' && !reason) {
                state = 'maxed';
                reason = 'max-pages';
            }
        } catch (e) {
            state = 'error';
            reason = String((e && e.message) || e).slice(0, 160);
        }

        return {
            state: state, pages: pages, items: items,
            cursor: cursor, reason: reason, skipped: skipped
        };
    }

    /**
     * 扫描代际守卫。
     * 用途：SPA 切用户时让「还在飞的扫描」失效，避免旧用户的相册结果
     * 写回新用户的界面（异步 await 回来后必须能判断「我还是不是当前这一代」）。
     * 返回 { gen(), bump(), is(token) }。
     */
    function makeScanGuard() {
        var g = 0;
        return {
            gen: function () { return g; },
            bump: function () { return (g += 1); },
            is: function (token) { return token === g; }
        };
    }

    /**
     * 由收集到的条目构造下载请求（送 vrBulkDownload）。
     *
     * 字段对照消费端（js/background.js）：
     *   site/kind/ext/author/authorId/pageUrl → vrBulkName / vrBulkMeta（归档目录与元数据）
     *   url                                    → 首选地址（探测出的档位）
     *   urls                                   → 备用地址链（便于排查；后端当前只用 url）
     *   mediaId                                → 去重依据（不依赖 CDN 域名与档位）
     *   key                                    → 面板「忽略已下载」标记
     *
     * @param {Array} collected [{pid, mid}]（来自 collectPage / paginate）
     * @param {object} meta { author, authorId, pageUrl }
     * @param {string} [firstTier] 探测出的可用档位，作为每条的首选地址
     * @returns {Array} 条目数组
     */
    function buildItems(collected, meta, firstTier) {
        var m = meta || {};
        var lead = firstTier || TIER_ORDER[0];
        var arr = Array.isArray(collected) ? collected : [];
        var out = [];
        var seen = Object.create(null);
        for (var i = 0; i < arr.length; i++) {
            var it = arr[i];
            if (!it || !it.pid) { continue; }
            if (seen[it.pid]) { continue; }        // 翻页边界重复只收一次
            seen[it.pid] = 1;
            var cands = candidates(it.pid, lead);
            out.push({
                site: 'weibo',
                kind: 'image',
                mediaId: it.pid,
                ext: 'jpg',
                url: cands[0],
                urls: cands,
                thumb: thumbOf(it.pid),
                title: '',
                author: String(m.author || ''),
                authorId: String(m.authorId || ''),
                pageUrl: String(m.pageUrl || ''),
                key: 'weibo:image:' + it.pid
            });
        }
        return out;
    }

    return {
        API: API,
        MAX_PAGES: MAX_PAGES,
        CDN: CDN,
        pad2: pad2,
        thumbOf: thumbOf,
        pidOf: pidOf,
        TIER_ORDER: TIER_ORDER,
        tierPrefix: tierPrefix,
        candidates: candidates,
        candidatesFromUrl: candidatesFromUrl,
        usableImage: usableImage,
        pickTier: pickTier,
        probeTiers: probeTiers,
        filterDone: filterDone,
        mergeDone: mergeDone,
        classifyBulkResult: classifyBulkResult,
        apiUrl: apiUrl,
        collectPage: collectPage,
        paginate: paginate,
        buildItems: buildItems,
        makeScanGuard: makeScanGuard
    };
});