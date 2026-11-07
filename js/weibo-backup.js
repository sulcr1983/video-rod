/**
 * 钓鱼竿 video-rod — 微博相册备份（ADR-056 / docs/WEIBO-ALBUM-PLAN.md）
 * --------------------------------------------------------------------
 * 职责边界：
 *   · 本文件只做「采集 + 入口 UI」：打微博官方相册接口分页、按接口顺序收集、渲染图片列表
 *   · 下载不在这里：选中的条目交给既有 `vrBulkDownload` → `vrBulkSaveItem`
 *     （候选池 → downloads → 离屏 fetch → FSA），不新增第二套下载实现
 *   · 不自动滚动页面、不自动翻页：扫描由用户点「开始」触发，可随时「停止」（ADR-010 / ADR-033）
 *
 * 为什么走 API 而不是 DOM 扫描：
 *   `scanWeibo()` 只能记到「人工往下拉」已加载的图；相册接口用 since_id 游标分页，
 *   能拿到整个相册历史，且不触发播放、不操作用户滚动条 —— 与 ADR-010 不冲突。
 *
 * 实测约束（详见方案文档 §3）：
 *   · 端点需登录态 + 站点 Referer → 必须在页面上下文 fetch（自带 Cookie 与 Referer）
 *   · sinaimg 对「Chrome UA 且无 Referer」返回 403
 *   · 无效 pid 会返回 200 + image/gif 占位图，所以候选校验不能只看 HTTP 200
 */
(() => {
    'use strict';
    if (window.__vrWeiboBackup) { return; }

    /* 只在 weibo.com 桌面版启用：m.weibo.cn 与 weibo.com 跨域，页面 fetch 会被 CORS 拦 */
    if (!/(^|\.)weibo\.com$/i.test(location.hostname)) { return; }
    window.__vrWeiboBackup = true;

    /* 分页 / 分桶 / 候选链全部走 VRWeiboAlbum（纯逻辑，Node 单测覆盖）：
     * 这里只保留 IO 与 UI，避免同一套规则存在两份实现。 */
    const A = self.VRWeiboAlbum;
    if (!A) { return; }

    const PAGE_GAP = 900;           // 页间隔：实测过低会触发风控
    const FETCH_TIMEOUT = 20000;
    const DEFAULT_LIMIT = 200;      // 默认最多取多少张（接口每页 21~24 条）

    let uid = '';
    let author = '';
    let phase = 'idle';             // idle | scanning | done | stopped | error
    let collected = [];             // [{pid, mid}]，按接口顺序（时间倒序）
    let picked = new Set();         // 已勾选的 pid
    /* 尺寸档：big=原图 / mid≈440 / small≈360（实测见 weibo-album-core.js）。
     * 用户 2026-11-07 反馈「不可选大中小」，此前是后台自动探测、用户无从选择。 */
    let sizeTier = 'big';
    let pageCount = 0;
    let errText = '';
    let busyDownload = false;
    let donePids = new Set();        // 本博主已下载的 pid（与档位/CDN 无关）

    /* 扫描代际：SPA 切用户/换路由时 bump()，让「还在飞的扫描」作废，
     * 否则旧用户的结果会在 await 回来后写进新用户的界面。 */
    const scanGuard = A.makeScanGuard();

    const DONE_LIMIT = 20000;        // 单博主最多记 2 万条，超出滚动淘汰

    function doneKey() {
        return 'vrWeiboDone:' + (uid || '');
    }

    /** 读取本博主已下载 pid 集合（存储不可用时降级为空集合，不影响下载） */
    function loadDone() {
        return new Promise(function (resolve) {
            try {
                chrome.storage.local.get(doneKey(), function (obj) {
                    void chrome.runtime.lastError;
                    const arr = (obj && obj[doneKey()]) || [];
                    resolve(new Set(Array.isArray(arr) ? arr : []));
                });
            } catch (e) { resolve(new Set()); }
        });
    }

    function saveDone(set) {
        try {
            const obj = {};
            obj[doneKey()] = Array.from(set);
            chrome.storage.local.set(obj);
        } catch (e) { /* 存不下就只保内存态 */ }
    }

    let btn = null;
    let panel = null;
    let listEl = null;
    let statusEl = null;
    let limitInput = null;          // 「最多取 N 张」
    let scanBtn = null;
    let stopBtn = null;
    let dlBtn = null;

    /* ---------------- 工具 ---------------- */

    function getUid() {
        const m = location.pathname.match(/\/(?:u|profile)\/(\d{4,})/);
        return m ? m[1] : '';
    }

    /** 页面上取博主名（取不到就留空，命名会退到平台/uid，不会崩） */
    function readAuthor() {
        const sels = [
            'div[class*="ProfileHeader_name_"]',
            'h1 .ProfileHeader_name',
            '.ProfileHeader_name',
            '.gn_name .G_link'
        ];
        for (let i = 0; i < sels.length; i++) {
            let el = null;
            try { el = document.querySelector(sels[i]); } catch (e) { el = null; }
            if (el && el.textContent) {
                return el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
            }
        }
        return '';
    }

    /* ---------------- 采集 ---------------- */

    async function fetchPage(sinceid) {
        const url = A.apiUrl(uid, sinceid);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
        try {
            const r = await fetch(url, {
                credentials: 'include',
                signal: ctrl.signal,
                headers: { accept: 'application/json, text/plain, */*' }
            });
            const text = await r.text();
            let j = null;
            try { j = JSON.parse(text); } catch (e) { j = null; }
            if (!r.ok) { throw new Error('HTTP ' + r.status); }
            if (!j || !j.data) {
                /* 未登录时实测返回 { ok:-100, url: login.php } */
                const hint = j && (j.msg || j.errno);
                throw new Error(hint ? String(hint) : '接口返回异常（可能未登录）');
            }
            return j.data;
        } finally {
            clearTimeout(timer);
        }
    }

    async function scan() {
        if (phase === 'scanning') { return; }
        if (!uid) { setStatus('请打开微博个人主页（/u/<uid>）'); return; }

        /* 不再选月份：实测 timeline_year/month 大面积缺失（71 条里 65 条为空，
         * 第 2 页起整页为空），无法作为筛选依据。改为「最多取 N 张」。 */
        const limit = Math.max(1, Number(limitInput && limitInput.value) || DEFAULT_LIMIT);

        collected = [];
        picked = new Set();
        pageCount = 0;
        errText = '';
        phase = 'scanning';
        author = readAuthor();
        render();

        /* 分页与收集全部由 VRWeiboAlbum 负责（Node 单测覆盖）：
         * 这里只注入 IO 与「是否被用户停止」，不再写第二套循环。 */
        const token = scanGuard.bump();
        const res = await A.paginate({
            uid: uid,
            limit: limit,
            gapMs: PAGE_GAP,
            fetchPage: fetchPage,
            isStopped: function () { return phase !== 'scanning' || !scanGuard.is(token); },
            onPage: function (info) {
                if (!scanGuard.is(token)) { return; }
                pageCount = info.page;
                render();
            }
        });

        /* 扫描期间切了用户/换了路由：本次结果作废，绝不能写进新用户的界面 */
        if (!scanGuard.is(token)) { return; }

        collected = res.items || [];
        pageCount = res.pages || 0;

        if (res.state === 'done') {
            phase = 'done';
        } else if (res.state === 'limit') {
            phase = 'done';
        } else if (res.state === 'stopped') {
            phase = 'stopped';
            errText = '已手动停止';
        } else if (res.state === 'maxed') {
            phase = 'stopped';
            errText = '已达页数上限 ' + A.MAX_PAGES + ' 页，已自动停止';
        } else {
            phase = 'error';
            errText = res.reason || '扫描失败';
        }

        /* 默认只勾选「未下载过」的，已下载的留着但不打勾 */
        collected.forEach(function (it) {
            if (!donePids.has(it.pid)) { picked.add(it.pid); }
        });
        render();
    }

    function stop() {
        if (phase !== 'scanning') { return; }
        phase = 'stopped';
        render();
    }

    function totalCount() {
        return collected.length;
    }

    function pickedCount() {
        let n = 0;
        collected.forEach(function (it) { if (picked.has(it.pid)) { n++; } });
        return n;
    }

    /* ---------------- 下载 ---------------- */

    function buildItems(firstTier) {
        /* 条目构造放在 VRWeiboAlbum 里（Node 单测覆盖字段形状）：
         * 这里只负责「当前选中的 pid + 当前博主的身份」。
         * sizeTier 一并传下去：它决定候选链用哪一档前缀，而不是探测结果说了算。 */
        const chosen = collected.filter((it) => picked.has(it.pid));
        return A.buildItems(chosen, {
            author: author,
            authorId: uid,
            pageUrl: 'https://weibo.com/u/' + uid
        }, firstTier, sizeTier);
    }

    /** 取一个样本 pid（选中的第一条），供档位探测 */
    function samplePid() {
        const first = collected.find((it) => picked.has(it.pid));
        return (first && first.pid) || '';
    }

    /**
     * 探测哪个档位真的能取到图。
     *
     * 为什么需要：`vrBulkSaveItem` 只用一个 it.url（当前代码没有候选池），
     * 所以「把五级链交上去让它逐级回退」不成立。这里先用一张样本图探一次，
     * 把验证过的档位作为整批的首选地址 —— 同一相册的档位可用性一致。
     *
     * 用页面上下文 fetch：自带 Cookie 与 Referer（实测 sinaimg 对
     * 「Chrome UA 且无 Referer」返回 403）。只读响应头，读完立即 cancel body。
     */
    async function probePreferredTier(pid) {
        var fallbackTier = (A.tiersOfSize ? A.tiersOfSize(sizeTier)[0] : 'large');
        if (!pid) { return { tier: fallbackTier, ok: false, tried: 0 }; }
        try {
            return await A.probeTiers(pid, async (url) => {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 8000);
                try {
                    const r = await fetch(url, {
                        credentials: 'include',
                        signal: ctrl.signal,
                        cache: 'no-store'
                    });
                    const out = {
                        status: r.status,
                        type: String(r.headers.get('content-type') || ''),
                        finalUrl: r.url || url,     // 跟随重定向后的真实地址（占位图靠它识别）
                        bytes: Number(r.headers.get('content-length')) || 0
                    };
                    try { if (r.body && r.body.cancel) { r.body.cancel(); } } catch (e) { /* ignore */ }
                    return out;
                } finally {
                    clearTimeout(timer);
                }
            }, null, sizeTier);
        } catch (e) {
            return { tier: fallbackTier, ok: false, tried: 0 };
        }
    }

    async function download() {
        if (busyDownload) { return; }
        if (phase === 'scanning') { setStatus('还在扫描，先停止或等扫完'); return; }
        /* 「最多取 N 张」：实测 timeline_year/month 大面积为空，
         * 不能按月分组，所以只判断「有没有勾选任何图片」。 */
        if (!pickedCount()) {
            setStatus('没有选中任何图片');
            return;
        }

        busyDownload = true;
        setStatus('正在探测可用档位…');

        const pick = await probePreferredTier(samplePid());
        if (!busyDownload) { return; }        // 探测期间面板被关/换用户

        const built = buildItems(pick.tier);
        if (!built.length) {
            busyDownload = false;
            setStatus('没有选中任何月份');
            return;
        }

        /* 本地按 pid 去重：后端 vrMediaIdentity 的键里含 URL pathname，
         * 档位一变（oslarge↔large）就会被判成新图重复下载。
         * pid 与档位、CDN 域名都无关，这里兜一层。 */
        const filtered = A.filterDone(built, donePids);
        const items = filtered.fresh;
        const skippedLocal = filtered.skipped;

        if (!items.length) {
            busyDownload = false;
            setStatus('选中的 ' + built.length + ' 张都已下载过');
            return;
        }

        setStatus('开始保存 ' + items.length + ' 张'
            + (skippedLocal ? '（跳过已下载 ' + skippedLocal + ' 张）' : '')
            + (pick.ok ? '' : '（档位探测未通过，仍按默认尝试）') + '…');

        try {
            chrome.runtime.sendMessage({ Message: 'vrBulkDownload', items: items }, (res) => {
                busyDownload = false;
                void chrome.runtime.lastError;

                /* 结果归类放在核心模块（Node 单测覆盖），这里只显示与记账。
                 * 判定口径与后台一致：failed/hardFail 不算成功；paused 是疑似风控。 */
                const verdict = A.classifyBulkResult(res, items.length, skippedLocal);
                setStatus(verdict.msg);

                /* 只有「全部到位」才把整批 pid 记为已完成。
                 * 有失败时不记：宁可下次重跑，也不能漏下。 */
                if (verdict.markDone) {
                    donePids = A.mergeDone(donePids, built, DONE_LIMIT);
                    saveDone(donePids);
                    render();
                }
            });
        } catch (e) {
            busyDownload = false;
            setStatus('发送失败：' + String(e).slice(0, 80));
        }
    }

    function onBulkProgress(msg) {
        if (!msg || msg.Message !== 'vrBulkProgress') { return; }
        if (!busyDownload) { return; }     // 只显示本面板发起的任务
        let s = msg.paused
            ? (msg.reason || '已暂停')
            : '下载中 ' + msg.done + '/' + msg.total;
        if (msg.skipped) { s += '，跳过重复 ' + msg.skipped; }
        if (msg.failed) { s += '，失败 ' + msg.failed; }
        setStatus(s);
    }

    /* ---------------- UI ---------------- */

    function setStatus(s) {
        if (statusEl) { statusEl.textContent = String(s || ''); }
    }

    function ensureUI() {
        if (btn) { return; }

        const style = document.createElement('style');
        style.textContent = [
            /* 浮标：常驻右侧，位置在既有「批量下载」下方，互不遮挡 */
            '.vr-wb-btn{position:fixed;right:0;top:calc(50% + 84px);transform:translateY(-50%);',
            'z-index:2147482000;padding:14px 8px;border-radius:10px 0 0 10px;',
            'background:#2C2418;color:#E8B04B;border:1px solid #4A3A1D;border-right:none;',
            'box-shadow:-4px 6px 22px rgba(0,0,0,.5);cursor:pointer;user-select:none;',
            'writing-mode:vertical-rl;letter-spacing:.08em;',
            'font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}',
            '.vr-wb-btn:hover{background:#3A2F1C;color:#F0C878}',
            '.vr-wb-btn[hidden]{display:none}',
            '.vr-wb-panel{position:fixed;right:0;top:0;bottom:0;z-index:2147482000;width:360px;',
            'max-width:100vw;display:flex;flex-direction:column;background:#100F0E;color:#EFEAE0;',
            'border-left:1px solid #2B2620;box-shadow:-12px 0 40px rgba(0,0,0,.6);overflow:hidden;',
            'transform:translateX(100%);visibility:hidden;transition:transform .22s ease,visibility .22s;',
            'font:12px/1.45 "Noto Sans SC",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
            '.vr-wb-panel.vr-open{transform:none;visibility:visible}',
            '.vr-wb-head{padding:14px 16px;background:#191715;border-bottom:1px solid #2B2620;',
            'color:#EFEAE0;font-weight:650;font-size:13px;display:flex;align-items:center;',
            'justify-content:space-between}',
            '.vr-wb-close{cursor:pointer;color:#8C8478;font-size:20px;line-height:1;padding:0 2px}',
            '.vr-wb-close:hover{color:#E8B04B}',
            /* 块一：起止月份 + 开始/停止 */
            '.vr-wb-range{padding:12px;border-bottom:1px solid #211E1A;display:flex;',
            'flex-wrap:wrap;gap:8px;align-items:center;background:#141210}',
            '.vr-wb-range label{display:flex;align-items:center;gap:5px;color:#8C8478;font-size:11px}',
            '.vr-wb-range input[type=number]{background:#1F1C18;border:1px solid #2B2620;',
            'color:#C8C0B2;border-radius:6px;padding:5px 7px;font-size:11px;color-scheme:dark;',
            'width:64px}',
            '.vr-wb-range button{border:1px solid #2B2620;background:#1F1C18;color:#C8C0B2;',
            'border-radius:7px;padding:6px 10px;cursor:pointer;font-size:11px}',
            '.vr-wb-range button:hover{border-color:#4A3A1D;color:#E8B04B}',
            '.vr-wb-range button.vr-primary{background:#E8B04B;border-color:#E8B04B;',
            'color:#17130D;font-weight:600}',
            '.vr-wb-range button.vr-primary:hover{background:#F2C46E;color:#17130D}',
            /* 尺寸档：大/中/小三段，默认「大」。
               用户 2026-11-07 反馈「不可选大中小」——此前尺寸由后台自动探测，
               用户完全无从选择，面板上也没有任何相关控件。 */
            '.vr-wb-size{padding:9px 12px;border-bottom:1px solid #211E1A;background:#141210;',
            'display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
            '.vr-wb-size-lab{color:#8C8478;font-size:11px;margin-right:2px}',
            '.vr-wb-size button{border:1px solid #2B2620;background:#1F1C18;color:#C8C0B2;',
            'border-radius:7px;padding:5px 9px;cursor:pointer;font-size:11px;font-variant-numeric:tabular-nums}',
            '.vr-wb-size button:hover{border-color:#4A3A1D;color:#E8B04B}',
            '.vr-wb-size button.on{background:#2C2418;border-color:#E8B04B;color:#E8B04B;font-weight:600}',
            '.vr-wb-size[disabled] button{opacity:.55;cursor:not-allowed}',
            /* 块二：图片列表 */
            '.vr-wb-list{overflow:auto;flex:1;padding:4px 10px}',
            '.vr-wb-row{display:flex;gap:8px;align-items:center;padding:9px 4px;',
            'border-bottom:1px solid #211E1A;cursor:pointer}',
            '.vr-wb-row:hover{background:#1F1C18;border-radius:6px}',
            '.vr-wb-row input[type=checkbox]{accent-color:#E8B04B;flex:0 0 auto}',
            '.vr-wb-ym{flex:1;font-weight:600;color:#EFEAE0;font-variant-numeric:tabular-nums}',
            '.vr-wb-n{color:#8C8478;font-size:11px;font-variant-numeric:tabular-nums}',
            '.vr-wb-thumb{width:38px;height:38px;border-radius:5px;object-fit:cover;',
            'background:#241F19;flex:0 0 38px}',
            '.vr-wb-empty{padding:20px 12px;color:#8C8478;line-height:1.7}',
            /* 块三：底部操作 */
            '.vr-wb-foot{display:flex;gap:6px;padding:10px 12px;background:#191715;',
            'align-items:center;flex-wrap:wrap;border-top:1px solid #2B2620}',
            '.vr-wb-foot button{border:1px solid #2B2620;background:#1F1C18;color:#C8C0B2;',
            'border-radius:7px;padding:6px 9px;cursor:pointer;font-size:11px}',
            '.vr-wb-foot button:hover{border-color:#4A3A1D;color:#E8B04B}',
            '.vr-wb-foot button.vr-primary{background:#E8B04B;border-color:#E8B04B;',
            'color:#17130D;font-weight:600}',
            '.vr-wb-foot button.vr-primary:hover{background:#F2C46E;color:#17130D}',
            '.vr-wb-status{margin-left:auto;color:#8C8478;font-size:10.5px}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);

        btn = document.createElement('div');
        btn.className = 'vr-wb-btn';
        btn.textContent = '相册备份';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            setOpen(!panel.classList.contains('vr-open'));
        });
        document.documentElement.appendChild(btn);

        panel = document.createElement('div');
        panel.className = 'vr-wb-panel';
        panel.innerHTML =
            '<div class="vr-wb-head"><span>相册备份</span>' +
            '<span class="vr-wb-close" title="关闭">×</span></div>' +
            '<div class="vr-wb-range">' +
            '<label>最多取 <input type="number" data-k="limit" min="1" max="5000" step="50"></label> 张' +
            '<button type="button" data-act="scan" class="vr-primary">开始扫描</button>' +
            '<button type="button" data-act="stop">停止</button>' +
            '</div>' +
            '<div class="vr-wb-size">' +
            '<span class="vr-wb-size-lab">尺寸</span>' +
            '<button type="button" data-size="big" class="on">大 · 原图</button>' +
            '<button type="button" data-size="mid">中 · 440</button>' +
            '<button type="button" data-size="small">小 · 360</button>' +
            '</div>' +
            '<div class="vr-wb-list"></div>' +
            '<div class="vr-wb-foot">' +
            '<button type="button" data-act="all">全选</button>' +
            '<button type="button" data-act="none">全不选</button>' +
            '<button type="button" data-act="down" class="vr-primary">下载选中</button>' +
            '<span class="vr-wb-status"></span></div>';
        document.documentElement.appendChild(panel);

        listEl = panel.querySelector('.vr-wb-list');
        statusEl = panel.querySelector('.vr-wb-status');
        limitInput = panel.querySelector('input[data-k="limit"]');
        scanBtn = panel.querySelector('button[data-act="scan"]');
        stopBtn = panel.querySelector('button[data-act="stop"]');
        dlBtn = panel.querySelector('button[data-act="down"]');

        if (limitInput) { limitInput.value = String(DEFAULT_LIMIT); }

        panel.querySelector('.vr-wb-close').addEventListener('click', () => setOpen(false));

        /* 尺寸档切换：只改「下载时用哪个前缀」，不影响已扫描到的 pid。
         * 扫描中禁止切换 —— 中途换档会让同批文件尺寸不一致，用户很难察觉。 */
        var sizeBox = panel.querySelector('.vr-wb-size');
        function paintSize() {
            if (!sizeBox) { return; }
            [].forEach.call(sizeBox.querySelectorAll('button[data-size]'), (b) => {
                b.classList.toggle('on', b.getAttribute('data-size') === sizeTier);
            });
        }
        if (sizeBox) {
            sizeBox.addEventListener('click', (e) => {
                var b = e.target && e.target.closest && e.target.closest('button[data-size]');
                if (!b) { return; }
                if (phase === 'scanning') { setStatus('扫描中不能改尺寸，等扫完再切'); return; }
                var v = b.getAttribute('data-size');
                if (A.SIZE_ORDER.indexOf(v) < 0) { return; }
                sizeTier = v;
                paintSize();
                render();
            });
        }
        paintSize();

        panel.addEventListener('click', (e) => {
            const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
            if (!act) { return; }
            if (act === 'scan') { scan(); }
            else if (act === 'stop') { stop(); }
            else if (act === 'down') { download(); }
            else if (act === 'all' || act === 'none') {
                picked = new Set();
                if (act === 'all') { collected.forEach((it) => picked.add(it.pid)); }
                render();
            }
        });

        /* 单条勾选 */
        panel.querySelector('.vr-wb-list').addEventListener('change', (e) => {
            const cb = e.target;
            if (!cb || cb.type !== 'checkbox') { return; }
            const pid = cb.getAttribute('data-pid');
            if (!pid) { return; }
            if (cb.checked) { picked.add(pid); } else { picked.delete(pid); }
            render();
        });

        render();
        syncVisibility();
    }

    function setOpen(v) {
        if (!panel) { return; }
        /* 与「批量下载」面板互斥：两个都是全高右栏、同一 z-index，
         * 同时打开会叠在一起互相遮挡（用户 2026-11-07 反馈「同时弹出 2 个页面」）。 */
        if (v) { closeBulkPanel(); }
        panel.classList.toggle('vr-open', !!v);
        if (btn) { btn.hidden = !!v; }
        if (v) { render(); }
    }

    /** 关掉「批量下载」面板（点它自己的关闭按钮，避免两处状态不同步） */
    function closeBulkPanel() {
        const other = document.querySelector('.vr-bulk-panel.vr-open');
        if (!other) { return; }
        const c = other.querySelector('.vr-bulk-close');
        if (c) { c.click(); }
    }

    /** 非个人主页时隐藏浮标与面板（SPA 切走也立即收起） */
    function syncVisibility() {
        const show = !!getUid();
        if (btn) { btn.hidden = !show; }
        if (panel && !show) { setOpen(false); }
    }

    function render() {
        if (!listEl) { return; }

        if (scanBtn) { scanBtn.disabled = phase === 'scanning'; }
        if (stopBtn) { stopBtn.disabled = phase !== 'scanning'; }
        if (dlBtn) { dlBtn.disabled = phase === 'scanning' || !totalCount(); }

        /* 原先是 !order.length —— order 是已废弃的月份列表且从未声明，
         * 这里真正要判的是「还没扫到任何条目」。 */
        if (!totalCount()) {
            let hint;
            if (phase === 'scanning') {
                hint = '正在扫描第 ' + pageCount + ' 页…（可点「停止」）';
            } else if (phase === 'error') {
                hint = '扫描失败：' + (errText || '未知错误') + '\n请确认已登录微博，然后点「开始扫描」';
            } else if (phase === 'stopped') {
                hint = (errText ? errText + '。' : '已停止。') + '可调整张数后重新扫描。';
            } else {
                hint = '设定「最多取 N 张」后点「开始扫描」。\n会直接读取相册接口，不滚动、不翻动你的页面。';
            }
            listEl.innerHTML = '<div class="vr-wb-empty">' + escapeHtml(hint) + '</div>';
            if (phase === 'scanning') {
                setStatus('扫描中，第 ' + pageCount + ' 页');
            } else if (phase === 'error') {
                setStatus('扫描失败');
            }
            return;
        }

        /* 列表：一行一张图（缩略图 + pid 尾号 + 已下载标记）。
         * 不再按月份分组 —— 接口的 timeline 月份实测大面积缺失。 */
        const frag = document.createDocumentFragment();
        collected.forEach((it, idx) => {
            const row = document.createElement('label');
            row.className = 'vr-wb-row';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = picked.has(it.pid);
            cb.setAttribute('data-pid', it.pid);

            const img = document.createElement('img');
            img.className = 'vr-wb-thumb';
            img.loading = 'lazy';
            img.src = A.thumbOf(it.pid);
            img.alt = '';

            const name = document.createElement('span');
            name.className = 'vr-wb-ym';
            name.textContent = '#' + (idx + 1) + '  ' + String(it.pid).slice(-10);

            const tag = document.createElement('span');
            tag.className = 'vr-wb-n';
            tag.textContent = donePids.has(it.pid) ? '已下载' : '';

            row.appendChild(cb);
            row.appendChild(img);
            row.appendChild(name);
            row.appendChild(tag);
            frag.appendChild(row);
        });

        listEl.innerHTML = '';
        listEl.appendChild(frag);

        let s = '共 ' + totalCount() + ' 张';
        if (pickedCount() !== totalCount()) { s += '，已选 ' + pickedCount() + ' 张'; }
        if (phase === 'scanning') { s = '扫描中（第 ' + pageCount + ' 页）· ' + s; }
        else if (phase === 'stopped') { s = '已停止 · ' + s; }
        setStatus(s);
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"]/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
        )).replace(/\n/g, '<br>');
    }

    /* ---------------- 启动与 SPA 路由 ---------------- */

    function resetAll() {
        /* 让「还在飞的扫描」立刻作废：否则旧 uid 的分页结果会在 await 回来后写进新界面 */
        scanGuard.bump();
        collected = [];
        picked = new Set();
        donePids = new Set();
        pageCount = 0;
        phase = 'idle';
        errText = '';
        author = '';
        if (listEl) { render(); }
        if (uid) { loadDone().then(function (set) { donePids = set; render(); }); }
    }

    let lastHref = location.href;
    function onRouteChange() {
        /* 微博是 SPA：切用户/切页时 location 变但内容脚本不重载。
         * 不重置的话，A 的相册会被当成 B 的继续用（小微有这段，我们原来没有）。 */
        if (location.href === lastHref) { return; }
        lastHref = location.href;
        const next = getUid();
        if (next !== uid) {
            uid = next;
            resetAll();
            syncVisibility();
        }
    }

    function boot() {
        uid = getUid();
        ensureUI();

        /* 路由监听必须在「当前不是个人主页」时也装上：
         * 否则从首页 SPA 跳进主页时浮标永不出现（微博是单页应用，内容脚本只注入一次）。 */
        try {
            new MutationObserver(onRouteChange)
                .observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) { /* ignore */ }
        setInterval(onRouteChange, 1500);

        window.addEventListener('pagehide', () => {
            if (phase === 'scanning') { phase = 'stopped'; }
        });

        try { chrome.runtime.onMessage.addListener(onBulkProgress); } catch (e) { /* ignore */ }

        /* 载入本博主已下载的 pid，用于默认不勾选与列表标记 */
        if (uid) {
            loadDone().then(function (set) {
                donePids = set;
                if (listEl) { render(); }
            });
        }

        syncVisibility();
    }

    if (document.body) { boot(); }
    else { document.addEventListener('DOMContentLoaded', boot, { once: true }); }
})();