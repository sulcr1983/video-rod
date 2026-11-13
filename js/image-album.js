/**
 * 苏哥的钓鱼竿 —— 图集扫描（I6，模式 A 自动滚动）
 *
 * 职责边界：
 *   · 本文件只做「页面内的采集与入口 UI」：响应 SW 的逐屏扫描请求（复用 lib-image-util 的
 *     scanImages），并在清单面板里提供「图集扫描」按钮 / 进度 / 停止
 *   · 滚动动作不在这里：滚动必须由 SW 用 chrome.scripting 注入到目标标签页执行
 *     （见 background.js 的 vrAlbumScrollStep）。内容脚本自己滚会和用户操作抢滚动条
 *   · 下载也不在这里：收集到的 URL 交给 image-batch.js 的 VRImgBridge.download，
 *     走既有的并发队列与进度条，避免出现两套下载实现
 *
 * 依赖：js/lib-image-util.js（VRImageUtil）、js/image-batch.js（VRImgBridge）、
 *       js/image-panel.js（提供面板内的挂载容器）
 */
(() => {
    'use strict';
    if (self.__vrImgAlbumLoaded) { return; }
    self.__vrImgAlbumLoaded = true;

    const U = self.VRImageUtil;
    if (!U) { return; }

    const PAGES_KEY = 'vrImgAlbumPages';
    const DEFAULT_PAGES = 10;
    const MAX_PAGES = 50;
    const POLL_MS = 400;          // 轮询间隔：SW 推送丢失时靠它兜底
    const SEND_TIMEOUT = 8000;

    let box = null;               // 面板给的挂载容器
    let goBtn = null;
    let stopBtn = null;
    let dlBtn = null;
    let againBtn = null;
    let msgEl = null;
    let pagesInput = null;

    let taskId = '';
    let state = 'idle';           // idle | scanning | done | stopped | error
    let info = { page: 0, maxPages: DEFAULT_PAGES, collected: 0 };
    let errText = '';
    let pollTimer = 0;
    let mountTries = 0;

    /* ---------------- 消息 ---------------- */

    function send(msg) {
        return new Promise(resolve => {
            let done = false;
            const finish = res => {
                if (done) { return; }
                done = true;
                resolve(res);
            };
            try {
                chrome.runtime.sendMessage(msg, res => {
                    void chrome.runtime.lastError;   // 必须读一次，否则控制台会报未捕获错误
                    finish(res || null);
                });
            } catch (e) { finish(null); }
            setTimeout(() => finish(null), SEND_TIMEOUT);
        });
    }

    /**
     * SW 逐屏扫描时来要「当前这一屏有哪些图」（由 executeScript 直接调用本函数）。
     * 用 scanImages 而不是自己遍历：过滤口径（最小尺寸 / 占位图 / 长宽比 / 同 URL 去重）
     * 必须和悬停、面板完全一致，否则图集抓到的数量和用户看到的不一样。
     */
    async function collectForSw(min) {
        const m = Math.max(16, Number(min) || U.MIN_SIZE);

        /* 统一发现层（阶段三，B-83/B-85）：图集与侧栏 / popup 共用 VRImageScanService，
         * 不再各写一套「img + 背景 + 源码」编排 —— 图集此前无条件把源码通道的
         * 徽章/logo 收进来，就是「收集数超过页面有效图数」的根因。
         * service 缺失（扩展更新前打开的老标签页）时才退回下面的内联实现。 */
        const S = self.VRImageScanService;
        if (S && typeof S.collect === 'function') {
            const r = await S.collect({ minSize: m, bgScan: true, srcScan: true, max: 1000 });
            const items = (r && Array.isArray(r.items)) ? r.items : [];
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                if (it && !(it.candidates && it.candidates.length)) { it.candidates = [it.url]; }
            }
            return items;
        }

        const out = [];
        const have = Object.create(null);
        const push = (it) => {
            if (!it || !it.url || have[it.url]) { return; }
            have[it.url] = 1;
            out.push({
                url: it.url,
                w: Number(it.w) || 0,
                h: Number(it.h) || 0,
                bg: !!it.bg,
                srcOnly: !!it.srcOnly,
                candidates: (it.candidates && it.candidates.length) ? it.candidates : [it.url]
            });
        };

        /* 通道 ①：<img>（原实现只有这一条） */
        try {
            U.scanImages(document, {
                minWidth: m, minHeight: m, minShow: U.PANEL_MIN_SHOW, dedupe: true
            }).forEach(push);
        } catch (e) { /* 单通道失败不影响其它通道 */ }

        /* 通道 ②：背景图（2026-11-12 补，苏哥报「图集只扫到 1 张」）。
         * 微博/花瓣这类站点的信息流大量用 background-image 或把 <img> 藏起来，
         * 只扫 <img> 会得到个位数，而侧边栏（走三条通道）能扫到几十张 ——
         * 同一页面两个入口数量差 50 倍，用户只会觉得「这功能坏了」。 */
        try {
            if (U.scanBackgrounds) {
                U.scanBackgrounds(document, { minShow: U.PANEL_MIN_SHOW, dedupe: true })
                    .forEach(push);
            }
        } catch (e) { /* 同上 */ }

        /* 通道 ③：源码/JSON 里的地址（懒加载站点图只在脚本里，DOM 上还没有 <img>） */
        try {
            const S = self.VRDownloadScan;
            if (S && S.extractUrlsFromHtml && document.body) {
                S.extractUrlsFromHtml(document.body.innerHTML || '', location.href, 400)
                    .forEach(u => push({ url: u, w: 0, h: 0, srcOnly: true }));
            }
        } catch (e) { /* 同上 */ }

        /* 尺寸回填：懒加载站点扫描瞬间大量图未解码，w/h 全是 0
         * （微博信息流实测 53 张全「尺寸未知」）。在页面上下文预载一次拿真实尺寸，
         * 限 60 张 / 2.5 秒，超时保留「未知」，绝不拖住扫描。 */
        try {
            const miss = out.filter(x => !(x.w > 0 && x.h > 0)).map(x => x.url);
            if (miss.length && typeof U.fillSizes === 'function') {
                const got = await U.fillSizesV2(miss, {
                    max: 160, concurrency: 8, timeout: 2500, retry: 1, budget: 5000
                });
                out.forEach(x => {
                    if (x.w > 0 && x.h > 0) { return; }
                    const sz = got[x.url];
                    if (sz && sz.w > 0 && sz.h > 0) { x.w = sz.w; x.h = sz.h; }
                });
            }
        } catch (e) { /* 回填失败保持未知 */ }

        return out;
    }

    /* executeScript 是「序列化函数源码后单独求值」，拿不到本文件的闭包变量（U 会 undefined），
     * 所以把采集入口挂到 isolated world 的全局上，由 SW 侧一行包装函数转调。 */
    self.__vrImgAlbumCollect = collectForSw;

    try {
        chrome.runtime.onMessage.addListener(msg => {
            // SW 的进度推送：和轮询同一份数据处理，重复到达也无害（都是绝对值）
            if (msg && msg.Message === 'vrImg.albumProgress' && msg.taskId && msg.taskId === taskId) {
                applyProgress(msg);
            }
        });
    } catch (e) { /* 无 runtime 时静默 */ }

    /* ---------------- 状态与文案 ---------------- */

    function setState(next, detail) {
        state = next;
        if (detail != null) { errText = String(detail); }
        if (next !== 'scanning') { clearTimeout(pollTimer); pollTimer = 0; }
        render();
    }

    function applyProgress(p) {
        if (!p) { return; }
        if (typeof p.page === 'number') { info.page = p.page; }
        if (typeof p.maxPages === 'number' && p.maxPages) { info.maxPages = p.maxPages; }
        if (typeof p.collected === 'number') { info.collected = p.collected; }
        const st = p.state || 'scanning';
        if (st !== state) { setState(st); return; }
        render();
    }

    function fmt() {
        if (state === 'scanning') {
            return '第 <b>' + info.page + '</b>/' + info.maxPages + ' 屏 · 已收集 <b>' +
                info.collected + '</b> 张';
        }
        if (state === 'done') {
            return '扫描完成：<b>' + info.collected + '</b> 张（滚了 <b>' + info.page + '</b> 屏）';
        }
        if (state === 'stopped') {
            return '已停止：<b>' + info.collected + '</b> 张（第 <b>' + info.page + '</b> 屏）';
        }
        if (state === 'error') {
            return '扫描失败：' + escapeHtml(errText || '未知原因');
        }
        return '自动滚到底收集懒加载图片，最多 <b>' + info.maxPages + '</b> 屏';
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
        }[c]));
    }

    function render() {
        if (!box) { return; }
        msgEl.innerHTML = fmt();
        const scanning = state === 'scanning';
        const hasItems = info.collected > 0 && !scanning;
        goBtn.hidden = scanning || hasItems;
        stopBtn.hidden = !scanning;
        dlBtn.hidden = !hasItems;
        againBtn.hidden = !hasItems;
        pagesInput.hidden = scanning || hasItems;
        if (dlBtn.hidden === false) { dlBtn.textContent = '下载这 ' + info.collected + ' 张'; }
        box.classList.toggle('busy', scanning);
    }

    /* ---------------- 扫描控制 ---------------- */

    function readPages() {
        let n = 0;
        try { n = parseInt(String(pagesInput.value || ''), 10); } catch (e) { n = 0; }
        if (!isFinite(n) || n <= 0) { n = DEFAULT_PAGES; }
        return Math.max(1, Math.min(MAX_PAGES, n));
    }

    function savePages(n) {
        try { localStorage.setItem(PAGES_KEY, String(n)); } catch (e) { /* 隐私模式下会抛 */ }
    }

    function loadPages() {
        try {
            const n = parseInt(localStorage.getItem(PAGES_KEY) || '', 10);
            if (isFinite(n) && n > 0) { return Math.max(1, Math.min(MAX_PAGES, n)); }
        } catch (e) { /* 忽略 */ }
        return DEFAULT_PAGES;
    }

    async function start() {
        if (state === 'scanning') { return; }
        const maxPages = readPages();
        savePages(maxPages);
        // 先把旧 taskId 丢掉：万一新任务没建起来，下载按钮不会把上一轮的清单又交一遍
        taskId = '';
        info = { page: 0, maxPages: maxPages, collected: 0 };
        errText = '';
        setState('scanning');
        const res = await send({
            Message: 'vrImg.albumScan',
            action: 'vrImg.albumScan',
            maxPages: maxPages,
            mode: 'scroll'
        });
        if (!res || !res.taskId) {
            setState('error', (res && (res.message || res.code)) || '扩展后台没有响应');
            return;
        }
        taskId = res.taskId;
        if (typeof res.maxPages === 'number' && res.maxPages) { info.maxPages = res.maxPages; }
        render();
        schedulePoll();
    }

    async function stop() {
        if (state !== 'scanning' || !taskId) { return; }
        const res = await send({
            Message: 'vrImg.albumStop', action: 'vrImg.albumStop', taskId: taskId
        });
        if (res && res.ok) {
            // 不直接把状态改成 stopped：以 SW 的进度为准，避免「点了停止但后台还在滚」
            await pollOnce();
            if (state === 'scanning') { setState('stopped'); }
        } else {
            setState('error', '停止失败，后台任务可能已结束');
        }
    }

    /* ---------------- 进度轮询 ---------------- */

    function schedulePoll() {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(pollOnce, POLL_MS);
    }

    async function pollOnce() {
        pollTimer = 0;
        if (!taskId) { return; }
        const r = await send({
            Message: 'vrImg.albumProgress', action: 'vrImg.albumProgress', taskId: taskId
        });
        if (r && r.ok !== false) { applyProgress(r); }
        // SW 被回收时轮询本身就是「叫醒它」的手段：它冷启动会把扫描接回来，
        // 所以这里不能因为一次查不到就放弃（只有终态才停）。
        if (state === 'scanning') { schedulePoll(); }
    }

    /* ---------------- 交给批量下载 ---------------- */

    async function downloadAll() {
        if (!taskId) { return; }
        const r = await send({
            Message: 'vrImg.albumProgress', action: 'vrImg.albumProgress',
            taskId: taskId, withItems: true
        });
        const list = (r && Array.isArray(r.items)) ? r.items : [];
        if (!list.length) {
            toast('没有收集到可下载的图片');
            return;
        }
        let limit = 200;
        try {
            const o = await new Promise(res => chrome.storage.local.get('vrLibSettings', x => res(x || {})));
            const s = U.mergeSettings((o && o.vrLibSettings) || {});
            limit = Math.max(1, Math.min(2000, Number(s.imgBatchLimit) || 200));
        } catch (e) { /* 读不到就用默认上限 */ }
        const pageTitle = String(document.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        /* 序号必须带：图集收集到的图常常共用同一个页面标题，
         * 不带序号会得到一堆同名文件（与侧栏/悬停同一命名口径）。 */
        const payload = list.slice(0, limit).map((it, i) => ({
            url: it.url,
            candidates: (it.candidates && it.candidates.length) ? it.candidates : [it.url],
            title: pageTitle + '_' + String(i + 1).padStart(2, '0')
        }));
        const B = self.VRImgBridge;
        if (!B || !B.download) { toast('批量下载模块未就绪'); return; }
        if (list.length > limit) { toast('本次只下前 ' + limit + ' 张（共收集 ' + list.length + ' 张）'); }
        const out = await B.download(payload);
        /* 真实回执（阶段二口径）：没有回执 ≠ 成功；FSA 未授权要单独说清楚。 */
        if (!out) { toast('批量下载没有响应（扩展后台可能已休眠）'); return; }
        if (out.needGrant || out.code === 'IMG_E_FSA_PERM') {
            toast('批量保存需要先授权资源库目录');
            return;
        }
        const fresh = Math.max(0, (out.succeeded || 0) - (out.skipped || 0));
        toast('已保存 ' + fresh + ' 张'
            + (out.skipped ? '，已存在跳过 ' + out.skipped + ' 张' : '')
            + (out.fail ? '，失败 ' + out.fail + ' 张' : ''));
    }

    function toast(text) {
        const B = self.VRImgBridge;
        if (B && B.toast) { B.toast(text); }
    }

    /* ---------------- 面板挂载 ---------------- */

    function build(container) {
        container.innerHTML = '';
        container.classList.add('vr-album');

        msgEl = document.createElement('span');
        msgEl.className = 'msg';

        pagesInput = document.createElement('input');
        pagesInput.type = 'text';
        pagesInput.className = 'num';
        pagesInput.setAttribute('inputmode', 'numeric');
        pagesInput.setAttribute('aria-label', '最多滚多少屏');
        pagesInput.value = String(loadPages());

        goBtn = document.createElement('button');
        goBtn.type = 'button';
        goBtn.className = 'vr-btn2 primary go';
        goBtn.textContent = '图集扫描';
        goBtn.addEventListener('click', start);

        stopBtn = document.createElement('button');
        stopBtn.type = 'button';
        stopBtn.className = 'vr-btn2 stop';
        stopBtn.textContent = '停止';
        stopBtn.hidden = true;
        stopBtn.addEventListener('click', stop);

        dlBtn = document.createElement('button');
        dlBtn.type = 'button';
        dlBtn.className = 'vr-btn2 primary dl';
        dlBtn.textContent = '下载';
        dlBtn.hidden = true;
        dlBtn.addEventListener('click', downloadAll);

        againBtn = document.createElement('button');
        againBtn.type = 'button';
        againBtn.className = 'vr-btn2 again';
        againBtn.textContent = '重新扫描';
        againBtn.hidden = true;
        againBtn.addEventListener('click', start);

        // 顺序固定，hidden 只控制显隐：面板宽窄变化时不会因为换位置而抖
        container.appendChild(msgEl);
        container.appendChild(pagesInput);
        container.appendChild(goBtn);
        container.appendChild(stopBtn);
        container.appendChild(dlBtn);
        container.appendChild(againBtn);

        // 面板每次打开都会重建 DOM，所以挂载后要按当前状态重画一次
        render();
        if (state === 'scanning' && !pollTimer) { schedulePoll(); }
    }

    function mount(container) {
        if (!container) { return; }
        box = container;
        build(container);
    }

    function unmount() {
        clearTimeout(pollTimer);
        pollTimer = 0;
        box = null;
        goBtn = stopBtn = dlBtn = againBtn = msgEl = pagesInput = null;
        // 扫描任务不跟着面板关闭而取消：用户可能只是想先看看别的
    }

    /* 面板比本文件先加载（manifest 里本文件排在其后），
     * 所以首帧可能还没有容器；短轮询几次等面板把容器建好。 */
    function tryMount() {
        if (box && box.isConnected) { return; }
        let container = null;
        try {
            const host = document.getElementById('vr-img-panel-host');
            const root = host && host.shadowRoot;
            container = root ? root.querySelector('.vr-album') : null;
        } catch (e) { container = null; }
        if (container) { mount(container); return; }
        if (mountTries++ < 20) { setTimeout(tryMount, 150); }
    }

    /* ---------------- 切走标签页即停 ---------------- */

    document.addEventListener('visibilitychange', () => {
        // 后台标签页继续滚没有意义（用户看不见），而且会白白消耗站点请求
        if (document.hidden && state === 'scanning') {
            stop().then(() => {
                if (state === 'stopped') { errText = ''; render(); }
            });
        }
    });

    tryMount();

    self.VRImgAlbum = {
        mount: mount,
        unmount: unmount,
        start: start,
        stop: stop,
        download: downloadAll,
        _state() {
            return {
                state: state,
                taskId: taskId,
                page: info.page,
                maxPages: info.maxPages,
                collected: info.collected,
                error: errText
            };
        }
    };
})();
