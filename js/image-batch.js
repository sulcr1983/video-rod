/**
 * 苏哥的钓鱼竿 —— 图片批量下载（I3）
 *
 * 交互：悬停条右侧「全部 N」→ 确认条 → 底部进度条 → 队列下载 → 可取消
 *
 * 职责边界：
 *   · 本文件只管「确认条 / 进度条 / 队列编排 / 取消」，不碰悬停逻辑
 *   · 悬停状态机与「下载原图」按钮归 image-hover.js
 *   · 图片扫描与候选链归 lib-image-util.js
 *   · 真正落盘归 background.js 的 vrImg.download（批量在 SW 侧并发池跑）
 *
 * 对外暴露：self.VRImgBridge（给 image-hover.js 用的 20 行桥）
 *   - count()      当前页可下数量
 *   - requestAll() 点「全部 N」→ 弹确认条
 *   - onCount(fn)  数量变化回调（悬停条刷新文案）
 */
(() => {
    'use strict';
    if (self.__vrImgBatchLoaded) { return; }
    self.__vrImgBatchLoaded = true;

    const U = self.VRImageUtil;
    if (!U) { return; }

    const HOST_ID = 'vr-img-batch-host';
    const DEFAULT_LIMIT = 200;
    // 2 而不是 3：微博 sinaimg 对 3 并发实测会拒掉 2 张（2026-11-05）
    const DEFAULT_CONCURRENCY = 2;
    const MAX_CONCURRENCY = 8;
    const DONE_HIDE_MS = 3000;
    const PROGRESS_TIMEOUT = 60000;   // 60s 无进度视为中断

    let enabled = true;
    let host = null;
    let shadow = null;
    let cfBox = null;        // 确认条
    let pgBox = null;        // 进度条
    let cfText = null;
    let cfGo = null;
    let cfList = null;
    let pgText = null;
    let pgBar = null;
    let pgCancel = null;

    let state = 'idle';      // idle | confirm | running | canceling | done | canceled
    let batch = null;        // { batchId, total, done, ok, fail, failures }
    let hideTimer = 0;
    let timeoutTimer = 0;
    let countListener = null;
    let cachedCount = 0;

    /* ---------------- 设置 ---------------- */

    function applySettings(s) {
        enabled = !(s && s.imgBatch === false);
        if (!enabled) { teardown(); }
    }

    try {
        chrome.storage.local.get('vrLibSettings', res => applySettings(res && res.vrLibSettings));
        chrome.storage.onChanged.addListener((ch, area) => {
            if (area !== 'local' || !ch.vrLibSettings) { return; }
            applySettings(ch.vrLibSettings.newValue);
        });
    } catch (e) { /* 无 storage 权限时保持默认开 */ }

    function settings() {
        return new Promise(resolve => {
            try {
                chrome.storage.local.get('vrLibSettings', o => {
                    resolve((o && o.vrLibSettings) || {});
                });
            } catch (e) { resolve({}); }
        });
    }

    /* ---------------- 样式 ---------------- */

    const CSS = `
:host { all: initial; }
.vr-cf, .vr-pg {
  position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%) translateY(8px);
  display: none; opacity: 0; pointer-events: none;
  width: min(560px, calc(100vw - 32px)); box-sizing: border-box;
  padding: 12px 14px; border-radius: 12px;
  background: rgba(17, 24, 39, .95); color: #fff;
  border: 1px solid rgba(255, 255, 255, .14);
  box-shadow: 0 10px 32px rgba(0, 0, 0, .38);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  font: 500 12.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Microsoft YaHei", sans-serif;
  z-index: 2147483001;
  transition: opacity .18s, transform .18s;
}
.vr-cf.on, .vr-pg.on {
  display: block; opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0);
}
.vr-cf .txt { color: rgba(255, 255, 255, .92); }
.vr-cf .txt b { color: #fff; font-weight: 700; }
.vr-cf .mini { margin-top: 3px; font-size: 11px; color: rgba(255, 255, 255, .55); }
.vr-cf .row { margin-top: 10px; display: flex; gap: 8px; justify-content: flex-end; }
.vr-btn2 {
  height: 30px; padding: 0 12px; border-radius: 8px; cursor: pointer;
  border: 1px solid rgba(255, 255, 255, .2);
  background: rgba(255, 255, 255, .1); color: #fff;
  font: inherit; line-height: 1; white-space: nowrap;
  transition: background .15s, border-color .15s;
}
.vr-btn2:hover { background: rgba(255, 255, 255, .18); }
.vr-btn2.primary { background: #2563eb; border-color: #2563eb; font-weight: 600; }
.vr-btn2.primary:hover { background: #1d4ed8; }
.vr-btn2:disabled { opacity: .5; cursor: default; }
.vr-pg .row { display: flex; align-items: center; gap: 10px; }
.vr-pg .row .t { flex: 1; color: rgba(255, 255, 255, .92); }
.vr-pg .row .t b { color: #fff; }
.vr-pg .cancel {
  font-size: 11.5px; color: rgba(255, 255, 255, .6);
  text-decoration: underline; cursor: pointer; background: none; border: 0;
  font-family: inherit; padding: 0;
}
.vr-pg .cancel:hover { color: #fff; }
.vr-pg .cancel:disabled { opacity: .4; cursor: default; text-decoration: none; }
.vr-pg .bar {
  margin-top: 9px; height: 5px; border-radius: 3px;
  background: rgba(255, 255, 255, .14); overflow: hidden;
}
.vr-pg .bar i {
  display: block; height: 100%; width: 0; background: #3b82f6;
  border-radius: 3px; transition: width .2s;
}
.vr-pg.done .bar i { background: #16a34a; }
@media (prefers-reduced-motion: reduce) {
  .vr-cf, .vr-pg, .vr-pg .bar i { transition: none; }
}
`;

    /* ---------------- UI ---------------- */

    function ensureUI() {
        if (host && host.isConnected) { return true; }
        if (!document.documentElement) { return false; }
        host = document.createElement('div');
        host.id = HOST_ID;
        host.setAttribute('data-vr-img-batch', '1');
        host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;' +
            'pointer-events:none;z-index:2147483001;';
        shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
        const root = shadow || host;

        const style = document.createElement('style');
        style.textContent = CSS;

        // 确认条
        cfBox = document.createElement('div');
        cfBox.className = 'vr-cf';
        cfBox.setAttribute('role', 'dialog');
        cfBox.setAttribute('aria-label', '批量下载确认');
        const cfTop = document.createElement('div');
        cfText = document.createElement('div');
        cfText.className = 'txt';
        const cfMini = document.createElement('div');
        cfMini.className = 'mini';
        cfMini.textContent = '浏览器可能询问「是否允许下载多个文件」，请选择允许。';
        cfTop.appendChild(cfText);
        cfTop.appendChild(cfMini);

        const cfRow = document.createElement('div');
        cfRow.className = 'row';
        cfGo = document.createElement('button');
        cfGo.type = 'button';
        cfGo.className = 'vr-btn2 primary';
        cfGo.textContent = '下载';
        cfList = document.createElement('button');
        cfList.type = 'button';
        cfList.className = 'vr-btn2';
        cfList.textContent = '选择图片';
        const cfCancel = document.createElement('button');
        cfCancel.type = 'button';
        cfCancel.className = 'vr-btn2';
        cfCancel.textContent = '取消';
        cfRow.appendChild(cfGo);
        cfRow.appendChild(cfList);
        cfRow.appendChild(cfCancel);
        cfBox.appendChild(cfTop);
        cfBox.appendChild(cfRow);

        // 进度条
        pgBox = document.createElement('div');
        pgBox.className = 'vr-pg';
        pgBox.setAttribute('role', 'status');
        pgBox.setAttribute('aria-live', 'polite');
        const pgRow = document.createElement('div');
        pgRow.className = 'row';
        pgText = document.createElement('span');
        pgText.className = 't';
        pgCancel = document.createElement('button');
        pgCancel.type = 'button';
        pgCancel.className = 'cancel';
        pgCancel.textContent = '取消';
        pgRow.appendChild(pgText);
        pgRow.appendChild(pgCancel);
        const bar = document.createElement('div');
        bar.className = 'bar';
        pgBar = document.createElement('i');
        bar.appendChild(pgBar);
        pgBox.appendChild(pgRow);
        pgBox.appendChild(bar);

        cfGo.addEventListener('click', startDownload);
        cfList.addEventListener('click', onList);
        cfCancel.addEventListener('click', closeConfirm);
        pgCancel.addEventListener('click', cancelBatch);
        for (const el of [cfBox, pgBox]) {
            // 只在冒泡阶段拦，别在 capture 阶段拦——capture + stopPropagation
            // 会把事件挡在按钮之前，按钮自己的 click 永远收不到（踩过）。
            el.addEventListener('mousedown', ev => ev.stopPropagation());
            el.addEventListener('click', ev => ev.stopPropagation());
        }

        root.appendChild(style);
        root.appendChild(cfBox);
        root.appendChild(pgBox);
        document.documentElement.appendChild(host);
        return true;
    }

    function teardown() {
        clearTimeout(hideTimer);
        clearTimeout(timeoutTimer);
        hideTimer = timeoutTimer = 0;
        if (host && host.parentNode) { host.parentNode.removeChild(host); }
        host = shadow = cfBox = pgBox = null;
        cfText = cfGo = cfList = pgText = pgBar = pgCancel = null;
        state = 'idle';
        batch = null;
    }

    /* ---------------- 计数 ---------------- */

    /* 数量缓存：scanImages 要遍历全页并读 naturalWidth，大页面上很慢。
     * 悬停时每次 show() 都调一次会明显卡顿（表现为按钮迟迟不出现），
     * 所以 500ms 内复用同一个结果；确认条打开时强制刷新。 */
    var countCache = { n: 0, at: 0 };

    function countNow(force) {
        const now = Date.now();
        if (!force && countCache.at && now - countCache.at < 500) {
            return countCache.n;
        }
        try {
            const items = U.scanImages(document, { minWidth: U.MIN_SIZE, minHeight: U.MIN_SIZE });
            cachedCount = items.length;
            countCache = { n: cachedCount, at: now };
            return cachedCount;
        } catch (e) { return countCache.n || 0; }
    }

    /* ---------------- 确认条 ---------------- */

    function openConfirm() {
        if (!enabled) { return false; }
        if (state === 'running' || state === 'canceling') { return false; }
        if (!ensureUI()) { return false; }
        clearTimeout(hideTimer);
        clearTimeout(timeoutTimer);
        hideTimer = timeoutTimer = 0;
        pgBox.classList.remove('on', 'done');

        const found = countNow(true);   // 确认条是决策点，必须用最新数字
        if (!found) {
            cfText.textContent = '本页没有可下载的图片';
            cfGo.disabled = true;
            cfGo.textContent = '下载';
        } else {
            // 上限要在确认条上就体现出来，不能等下到一半才发现被截断
            settings().then(s => {
                const max = Math.max(1, Math.min(999, Number(s.imgBatchLimit) || DEFAULT_LIMIT));
                const total = Math.min(found, max);
                const all = (() => {
                    try { return document.querySelectorAll('img').length; } catch (e) { return found; }
                })();
                const skipped = Math.max(0, all - found);
                cfText.innerHTML = '本页找到 <b>' + found + '</b> 张图' +
                    (skipped ? '（已过滤 <b>' + skipped + '</b> 张小图）' : '') +
                    (found > max ? '，本次只下前 <b>' + max + '</b> 张' : '');
                cfGo.textContent = '全部下载 ' + total + ' 张';
                cfGo.disabled = false;
            });
        }
        cfBox.classList.add('on');
        state = 'confirm';
        return true;
    }

    function closeConfirm() {
        if (cfBox) { cfBox.classList.remove('on'); }
        if (state === 'confirm') { state = 'idle'; }
    }

    function onList() {
        // 清单面板 I4 已经做完了（js/image-panel.js），这里原本还是「功能未完成」的占位 toast。
        // 直接复用现成组件，不重造。用户可在清单里逐张勾选后再下载。
        closeConfirm();
        try {
            if (self.VRImgPanel && typeof self.VRImgPanel.open === 'function') {
                self.VRImgPanel.open(true);
                return;
            }
        } catch (e) { /* 落到提示 */ }
        toast('清单面板未就绪，请用「全部下载」或右下角浮标打开清单');
    }

    /* ---------------- 进度条 ---------------- */

    function showProgress() {
        if (!ensureUI()) { return; }
        clearTimeout(hideTimer);
        hideTimer = 0;
        pgBox.classList.remove('done');
        pgBox.classList.add('on');
        pgCancel.disabled = false;
        pgCancel.textContent = '取消';
        renderProgress();
    }

    function renderProgress() {
        if (!pgText || !batch) { return; }
        const b = batch;
        const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
        pgBar.style.width = pct + '%';
        if (state === 'canceling') {
            pgText.innerHTML = '正在取消…（完成 <b>' + b.done + '</b>/' + b.total + '）';
        } else if (state === 'canceled') {
            pgText.innerHTML = '已取消（完成 <b>' + b.done + '</b>/' + b.total + '）';
            pgBox.classList.add('done');
            // 已经取消了，按钮不能再点
            pgCancel.disabled = true;
            pgCancel.textContent = '已取消';
        } else if (state === 'done') {
            pgText.innerHTML = '已下载 <b>' + b.ok + '</b> 张' +
                (b.fail ? '，失败 <b>' + b.fail + '</b> 张' : '');
            pgBox.classList.add('done');
            // 跑完了就没有「取消」可言，禁用掉（否则用户会以为还能停）
            pgCancel.disabled = true;
            pgCancel.textContent = '已完成';
        } else {
            pgText.innerHTML = '正在下载 <b>' + b.done + '</b>/' + b.total +
                (b.fail ? ' · 失败 <b>' + b.fail + '</b>' : '');
        }
    }

    function hideProgressLater() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            hideTimer = 0;
            if (pgBox) { pgBox.classList.remove('on'); }
            state = 'idle';
            batch = null;
        }, DONE_HIDE_MS);
    }

    /* ---------------- 下载编排 ---------------- */

    async function collectItems(limit) {
        const s = await settings();
        const max = Math.max(1, Math.min(999, Number(s.imgBatchLimit) || DEFAULT_LIMIT));
        let items = [];
        try {
            items = U.scanImages(document, {
                minWidth: U.MIN_SIZE,
                minHeight: U.MIN_SIZE,
                /* minShow 必须显式传 PANEL_MIN_SHOW(48)。
                 * 不传会落到默认值 MIN_SHOW(500)：那是**悬停按钮**的门槛，
                 * 用来保证「页面上看着够大才冒按钮」。批量下载是用户主动点「全部 N」，
                 * 门槛该与面板/侧边栏一致(48)，否则 320px 的正文配图会被静默漏掉 ——
                 * 表现是「确认条说 5 张，实际只落 4 张」（实测 D6）。 */
                minShow: U.PANEL_MIN_SHOW,
                dedupe: true
            });
        } catch (e) { items = []; }

        const pageTitle = String(document.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        /* 每张图必须带序号，否则批量下载会得到一串同名文件：
         * 底层按 `<日期>_<标题>.<ext>` 命名，5 张同标题 → Chrome 只能加 (1)(2) 后缀，
         * 用户在文件夹里根本分不清哪张是哪张，去重表也会因为文件名相同而互相覆盖。
         * 与侧边栏 image-page.js 保持同一口径：`标题_01`、`标题_02`… */
        const out = items.map((it, i) => ({
            /* 取候选链里最像原图的那条，不是页面显示的预览版。
             * 2026-11-08 苏哥报「嗅探不准确」：单张下载走 orig、批量走 url，
             * 同一张图两条路径落盘尺寸不同（小红书实测全是 640 预览档）。 */
            url: U.bestCandidate(it.candidates, it.url),
            candidates: (it.candidates && it.candidates.length) ? it.candidates : [it.url],
            title: pageTitle + '_' + String(i + 1).padStart(2, '0')
        }));
        const truncated = out.length > max;
        return { items: out.slice(0, max), total: Math.min(out.length, max), truncated, max };
    }

    /** 本页站名（页面级缓存；取不到返回空串，绝不回退域名） */
    function pageSiteNameNow() {
        try {
            var S = self.VRSiteName;
            return S && S.pageSiteName ? String(S.pageSiteName(document, location.href) || '') : '';
        } catch (e) { return ''; }
    }

    /**
     * 跑队列（面板与「全部 N」共用）。
     * items: [{url, candidates, title}]，调用方负责截断与去重。
     * 返回 Promise<{ok, succeeded, fail, canceled}>，进度同时走底部进度条。
     */
    function runQueue(items, opts) {        const list = Array.isArray(items) ? items.slice() : [];
        const o = opts || {};
        return new Promise(resolve => {
            if (!list.length) { resolve({ ok: true, succeeded: 0, fail: 0, canceled: false }); return; }
            settings().then(s => {
                const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY,
                    Number(s.imgConcurrency) || DEFAULT_CONCURRENCY));
                batch = {
                    batchId: 'b-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                    total: list.length,
                    done: 0,
                    ok: 0,
                    fail: 0,
                    failures: []
                };
                state = 'running';
                if (o.showBar !== false) { showProgress(); }
                if (typeof o.onStart === 'function') { o.onStart(batch); }

                send({
                    Message: 'vrImg.batch',
                    action: 'vrImg.batch',
                    items: list,
                    pageUrl: location.href,
                    pageTitle: String(document.title || '').slice(0, 120),
                    siteName: pageSiteNameNow(),
                    concurrency: concurrency,
                    batchId: batch.batchId
                }, res => {
                    const myBatch = batch;
                    const settle = out => {
                        if (state === 'running' || state === 'canceling') {
                            batch.ok = out.succeeded;
                            batch.fail = out.fail;
                            batch.done = out.succeeded + out.fail;
                            batch.failures = out.failures;
                            state = out.canceled ? 'canceled' : 'done';
                            if (o.showBar !== false) { renderProgress(); hideProgressLater(); }
                        }
                        if (typeof o.onDone === 'function') { o.onDone(out, myBatch); }
                        resolve(out);
                    };
                    if (res && (typeof res.succeeded === 'number' || typeof res.ok === 'number')) {
                        settle({
                            ok: true,
                            succeeded: typeof res.succeeded === 'number' ? res.succeeded : res.ok,
                            fail: res.fail || 0,
                            canceled: !!res.canceled,
                            failures: res.failures || []
                        });
                        return;
                    }
                    // 长连接回执丢了 ≠ 下载失败。批量是长任务，SW 通道可能先断；
                    // 结果以 vrImg.batchProgress 的广播为准，等进度收齐再结算，
                    // 否则会把「其实下完了」误报成「全部失败」（2026-11-05 实测）。
                    const t0 = Date.now();
                    const waitProgress = () => {
                        const b = batch || myBatch;
                        if (b && b.total > 0 && b.done >= b.total) {
                            settle({
                                ok: b.fail === 0, succeeded: b.ok, fail: b.fail,
                                canceled: state === 'canceling',
                                failures: (b.failures || []), viaProgress: true
                            });
                            return;
                        }
                        if (Date.now() - t0 > 25000) {
                            settle({
                                ok: false, succeeded: b ? b.ok : 0,
                                fail: b ? Math.max(0, b.total - b.done) + b.fail : list.length,
                                canceled: false, failures: (b && b.failures) || [],
                                message: '回执丢失且进度未收齐'
                            });
                            return;
                        }
                        setTimeout(waitProgress, 800);
                    };
                    waitProgress();
                });
            });
        });
    }

    async function startDownload() {
        if (state !== 'confirm') { return; }
        const { items, total, truncated } = await collectItems();
        if (!total) { closeConfirm(); return; }
        closeConfirm();
        const out = await runQueue(items);
        if (truncated) {
            toast('本次只下前 ' + total + ' 张，剩余请刷新后继续');
        }
        return out;
    }

    function failAll(msg) {
        if (!batch) { return; }
        state = 'done';
        batch.fail = batch.total - batch.ok;
        batch.done = batch.total;
        renderProgress();
        toast(msg);
        hideProgressLater();
    }

    function cancelBatch() {
        if (!batch || state !== 'running') { return; }
        state = 'canceling';
        pgCancel.disabled = true;
        renderProgress();
        send({
            Message: 'vrImg.batchCancel',
            action: 'vrImg.batchCancel',
            batchId: batch.batchId
        }, res => {
            if (state === 'canceling') {
                state = 'canceled';
                renderProgress();
                hideProgressLater();
            }
        });
    }

    /* ---------------- 消息 ---------------- */

    /* 与 image-hover 共用 js/vr-msg.js 的实现；批量任务超时给长（120s）。
     * 原来这里和 image-hover 各有一份逐字相同的 send()，只有超时值不同。 */
    function send(msg, cb) {
        if (self.VRMsg && typeof self.VRMsg.send === 'function') {
            return self.VRMsg.send(msg, cb, 120000);
        }
        let done = false;
        const finish = res => { if (!done) { done = true; cb(res); } };
        try {
            chrome.runtime.sendMessage(msg, res => {
                const err = chrome.runtime.lastError;
                finish(err ? null : res);
            });
        } catch (e) { finish(null); }
        setTimeout(() => finish(null), 120000);
    }

    try {
        chrome.runtime.onMessage.addListener(msg => {
            if (!msg || msg.Message !== 'vrImg.batchProgress') { return; }
            if (!batch || msg.batchId !== batch.batchId) { return; }
            batch.done = msg.done;
            batch.ok = msg.ok;
            batch.fail = msg.fail;
            batch.total = msg.total || batch.total;
            if (state === 'running' || state === 'canceling') {
                renderProgress();
                // 收到进度就重置超时，避免误判中断
                clearTimeout(timeoutTimer);
                timeoutTimer = setTimeout(() => {
                    if (state === 'running') { failAll('批量下载中断（扩展后台休眠）'); }
                }, PROGRESS_TIMEOUT);
            }
        });
    } catch (e) { /* 忽略 */ }

    /* ---------------- Toast ---------------- */

    function toast(text) {
        if (!ensureUI()) { return; }
        const el = document.createElement('div');
        el.textContent = text;
        el.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);' +
            'background:rgba(17,24,39,.94);color:#fff;padding:8px 14px;border-radius:8px;' +
            'font:500 12px/1.4 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
            'box-shadow:0 6px 20px rgba(0,0,0,.3);z-index:2147483002;max-width:min(420px,80vw);' +
            'text-align:center;pointer-events:none;';
        shadow.appendChild(el);
        setTimeout(() => { if (el.parentNode) { el.parentNode.removeChild(el); } }, 2600);
    }

    /* ---------------- 对外桥 ---------------- */

    self.VRImgBridge = {
        count() {
            if (!enabled) { return 0; }
            return countNow();
        },
        requestAll() {
            return openConfirm();
        },
        /** 面板用：直接下这批（不弹确认条），进度仍走底部进度条 */
        download(items, opts) {
            if (!enabled) { return Promise.resolve({ ok: false, succeeded: 0, fail: 0 }); }
            return runQueue(items, opts);
        },
        /** 让同页其它模块也能弹提示（悬停的快捷键下载会用到） */
        toast(text) {
            try { toast(text); } catch (e) { /* 忽略 */ }
        },
        onCount(fn) {
            countListener = fn;
            if (typeof fn === 'function') { fn(cachedCount); }
        },
        _state() { return state; },
        _batch() { return batch; }
    };

    // 数量变化时通知悬停条（图片懒加载会不断增加）
    if (countListener) { countListener(cachedCount); }
})();
