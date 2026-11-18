/**
 * 博主 / 合集枚举页（2026-11-18）
 *
 * 为什么要有这一页：
 *   `js/enumerate/*` + `vrEnumOwner` 把「整博主 / 合集 / 番剧」的枚举能力做完了，
 *   但**没有任何 UI 入口** —— 用户完全用不到。这个页面就是那个入口。
 *
 * 与「抓图」页（image.html）的分工：
 *   · image.html   看**当前这一页**上已经加载的图片
 *   · 本页          看**整个博主/合集/整季**的作品（要翻页、要调 API）
 *
 * 下载怎么走（这里是最容易做错的地方）：
 *   枚举产出的是「作品条目」（封面图 + 视频页 URL），**不是媒体文件**。
 *   所以点下载时不能直接把封面当视频下 —— 那样子用户拿到的是一堆缩略图。
 *   正确做法：交给 SW 的 `vrEnum.download`，按 kind 分流：
 *     · 视频型 → 解析 playurl 拿真实视频流（B站已实测可免标签页直取）
 *     · 图片型 → 走既有批量图片通道
 */
(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const el = {
        url: $('url'), kind: $('kind'), count: $('count'), incr: $('incr'),
        btnFromTab: $('btnFromTab'), btnStart: $('btnStart'), btnStop: $('btnStop'),
        tip: $('tip'),
        stat: $('stat'), sumTotal: $('sumTotal'), sumPages: $('sumPages'),
        sumKind: $('sumKind'), sumBar: $('sumBar'),
        grid: $('grid'), empty: $('empty'),
        btnAll: $('btnAll'), btnNone: $('btnNone'),
        selCount: $('selCount'), selTotal: $('selTotal'), btnDl: $('btnDl')
    };

    /** 全量结果（含未选中的） */
    let allItems = [];
    const selected = new Set();      // 用 mediaId 当键（比下标稳，重排不串）
    let running = false;
    let lastTarget = null;

    /* ---------------- 小工具 ---------------- */

    function tip(msg, kind) {
        el.tip.textContent = msg || '';
        el.tip.className = 'tip' + (kind ? ' ' + kind : '');
    }

    function str(v) { return String(v == null ? '' : v); }

    /** 秒 → 1:23 / 1:02:03 */
    function durText(sec) {
        const n = Number(sec) || 0;
        if (n <= 0) { return ''; }
        const h = Math.floor(n / 3600);
        const m = Math.floor((n % 3600) / 60);
        const s = Math.floor(n % 60);
        const p2 = (x) => (x < 10 ? '0' + x : String(x));
        return h > 0 ? (h + ':' + p2(m) + ':' + p2(s)) : (m + ':' + p2(s));
    }

    /** 时间戳 → 2024-01-02 */
    function dateText(ts) {
        const n = Number(ts) || 0;
        if (n <= 0) { return ''; }
        try {
            const d = new Date(n * 1000);
            if (isNaN(d.getTime())) { return ''; }
            const p2 = (x) => (x < 10 ? '0' + x : String(x));
            return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
        } catch (e) { return ''; }
    }

    function itemKey(it) {
        return str(it.mediaId) || str(it.url) || '';
    }

    /* ---------------- 消息 ---------------- */

    function sendMsg(msg) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(msg, (res) => {
                    void chrome.runtime.lastError;
                    resolve(res || { ok: false, error: 'no-response' });
                });
            } catch (e) {
                resolve({ ok: false, error: String((e && e.message) || e) });
            }
        });
    }

    /* ---------------- 取当前页地址 ---------------- */

    async function urlFromActiveTab() {
        try {
            const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            const t = tabs && tabs[0];
            if (!t || !t.url) { return ''; }
            if (!/^https?:/i.test(t.url)) { return ''; }
            return t.url;
        } catch (e) { return ''; }
    }

    /* ---------------- 渲染 ---------------- */

    function render() {
        const total = allItems.length;
        el.selTotal.textContent = String(total);

        if (!total) {
            el.grid.innerHTML = '';
            el.empty.hidden = false;
            el.btnDl.disabled = true;
            el.selCount.textContent = '0';
            return;
        }
        el.empty.hidden = true;

        const frag = document.createDocumentFragment();
        allItems.forEach((it) => {
            const k = itemKey(it);
            const on = selected.has(k);

            const cell = document.createElement('div');
            cell.className = 'cell' + (on ? ' on' : '');
            cell.setAttribute('role', 'checkbox');
            cell.setAttribute('aria-checked', on ? 'true' : 'false');
            cell.title = str(it.title) + (it.pageUrl ? '\n' + it.pageUrl : '');

            const th = document.createElement('div');
            th.className = 'th';
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            /* 封面可能取不到（防盗链/已删）→ 留空底，不要显示破图 */
            img.onerror = function () { this.style.visibility = 'hidden'; };
            img.src = str(it.url);
            img.alt = '';
            th.appendChild(img);

            const ck = document.createElement('span');
            ck.className = 'ck';
            ck.textContent = '✓';
            th.appendChild(ck);

            const d = durText(it.duration);
            if (d) {
                const dEl = document.createElement('span');
                dEl.className = 'dur';
                dEl.textContent = d;
                th.appendChild(dEl);
            }

            const bd = document.createElement('div');
            bd.className = 'bd';
            const ttl = document.createElement('div');
            ttl.className = 'ttl';
            ttl.textContent = str(it.title) || '(无标题)';
            bd.appendChild(ttl);

            const mt = document.createElement('div');
            mt.className = 'mt';
            const dt = dateText(it.createdAt);
            if (dt) {
                const s = document.createElement('span');
                s.textContent = dt;
                mt.appendChild(s);
            }
            if (it.mediaId) {
                const s2 = document.createElement('span');
                s2.textContent = str(it.mediaId);
                mt.appendChild(s2);
            }
            bd.appendChild(mt);

            cell.appendChild(th);
            cell.appendChild(bd);

            cell.addEventListener('click', () => {
                if (!k) { return; }
                if (selected.has(k)) { selected.delete(k); } else { selected.add(k); }
                render();
            });

            frag.appendChild(cell);
        });

        el.grid.innerHTML = '';
        el.grid.appendChild(frag);

        el.selCount.textContent = String(selected.size);
        el.btnDl.disabled = selected.size === 0 || running;
        el.btnDl.textContent = selected.size
            ? ('下载选中（' + selected.size + '）')
            : '下载选中';
    }

    /* ---------------- 枚举 ---------------- */

    function setRunning(on) {
        running = on;
        el.btnStart.disabled = on;
        el.btnStop.disabled = !on;
        el.btnStart.textContent = on ? '枚举中…' : '开始枚举';
        el.btnDl.disabled = on || selected.size === 0;
    }

    async function startEnum() {
        const url = str(el.url.value).trim();
        if (!url) { tip('先填一个地址，或点「取当前页」', 'err'); return; }
        if (!/^https?:\/\//i.test(url)) { tip('地址要以 http:// 或 https:// 开头', 'err'); return; }

        setRunning(true);
        tip('正在识别这个地址…');
        el.stat.hidden = false;
        el.sumTotal.textContent = '0';
        el.sumPages.textContent = '0';
        el.sumBar.style.width = '0%';

        /* 先让 SW 解析地址（targetKind / collectionId / seasonId 都在那里定）。
         *
         * ⚠️ 2026-11-18 修（渲染验收发现的 UI 欺骗）：下拉框原来**只改显示值**、
         * 从不传给 SW —— 用户手选「合集」或「番剧」完全没有效果，而 UI 上
         * 明明写着「由地址自动判断，可手动改」。要么让它真生效，要么别提供。
         * 现在把选择传下去：SW 用它覆盖自动判定，但**参数不足时明确报错**
         * （例如选了合集、地址却不是合集页）—— 不能静默按整博主处理。 */
        const res = await sendMsg({
            Message: 'vrEnum.owner',
            url: url,
            targetKind: str(el.kind.value) || 'owner',
            count: Number(el.count.value) || 20,
            incremental: !!el.incr.checked,
            limit: 3000        /* 安全上限，避免超大 UP 主一口气拉爆 */
        });

        setRunning(false);

        if (!res || !res.ok) {
            const why = (res && res.error) || 'unknown';
            const hint = why === 'not-an-owner-url' ? '（这个地址不像博主/合集/番剧页）'
                : (why === 'not-a-collection-url' ? '（你选了「合集」，但这个地址不是合集页）'
                    : (why === 'not-a-bangumi-url' ? '（你选了「番剧」，但这个地址不是番剧页）' : ''));
            tip('枚举失败：' + why + hint, 'err');
            render();
            return;
        }

        allItems = Array.isArray(res.items) ? res.items : [];
        lastTarget = {
            platform: res.platform || '',
            targetKind: res.targetKind || 'owner',
            pageUrl: url
        };

        el.sumTotal.textContent = String(res.total || allItems.length);
        el.sumPages.textContent = String(res.pages || 0);
        el.sumKind.textContent = res.targetKind === 'collection' ? '合集'
            : (res.targetKind === 'bangumi' ? '番剧' : '整博主');
        el.sumBar.style.width = '100%';

        /* 默认全选：用户点「枚举」的意图通常就是「都要」 */
        selected.clear();
        allItems.forEach((it) => {
            const k = itemKey(it);
            if (k) { selected.add(k); }
        });

        render();
        tip('枚举完成：' + allItems.length + ' 条，已默认全选', 'ok');
    }

    /* ---------------- 下载 ---------------- */

    async function downloadSelected() {
        if (!selected.size) { return; }
        const items = allItems.filter((it) => selected.has(itemKey(it)));
        if (!items.length) { return; }

        setRunning(true);
        el.btnDl.textContent = '正在提交…';
        tip('正在把 ' + items.length + ' 条交给下载链路…');

        const res = await sendMsg({
            Message: 'vrEnum.download',
            items: items,
            pageUrl: (lastTarget && lastTarget.pageUrl) || str(el.url.value).trim(),
            platform: (lastTarget && lastTarget.platform) || ''
        });

        setRunning(false);
        render();

        if (!res || !res.ok) {
            tip('下载失败：' + ((res && (res.error || res.reason)) || 'unknown'), 'err');
            return;
        }
        const okN = Number(res.succeeded) || 0;
        const failN = Number(res.fail) || 0;
        const skipN = Number(res.skipped) || 0;
        const parts = ['成功 ' + okN];
        if (skipN) { parts.push('已存在跳过 ' + skipN); }
        if (failN) { parts.push('失败 ' + failN); }
        tip('下载完成：' + parts.join('，'), failN ? 'err' : 'ok');
    }

    /* ---------------- 事件绑定 ---------------- */

    el.btnFromTab.addEventListener('click', async () => {
        const u = await urlFromActiveTab();
        if (!u) { tip('取不到当前标签页的地址（可能是浏览器内部页）', 'err'); return; }
        el.url.value = u;
        /* 顺手猜一下类型，让用户知道它被认成了什么 */
        const guess = guessKind(u);
        if (guess) { el.kind.value = guess; }
        tip('已填入当前页地址');
    });

    /** 粗略猜类型（真正的判定在 targets.js；这里只为让下拉框显示得对） */
    function guessKind(u) {
        if (/\/bangumi\/play\//.test(u)) { return 'bangumi'; }
        if (/\/channel\/collectiondetail/.test(u) || /\/medialist\/detail\//.test(u)) { return 'collection'; }
        if (/space\.bilibili\.com\/\d+/.test(u)) { return 'owner'; }
        return '';
    }

    el.btnStart.addEventListener('click', () => { if (!running) { startEnum(); } });

    el.btnStop.addEventListener('click', () => {
        /* 真正的中断要等 SW 支持；这里先复位按钮，避免用户以为卡死 */
        setRunning(false);
        tip('已停止（已拿到的结果保留在列表里）');
    });

    el.btnAll.addEventListener('click', () => {
        selected.clear();
        allItems.forEach((it) => { const k = itemKey(it); if (k) { selected.add(k); } });
        render();
    });

    el.btnNone.addEventListener('click', () => {
        selected.clear();
        render();
    });

    el.btnDl.addEventListener('click', () => { if (!running) { downloadSelected(); } });

    /* 回车即开始 */
    el.url.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !running) { startEnum(); }
    });

    /* 首次进入：自动填入当前标签页地址（省一次点击） */
    (async () => {
        const u = await urlFromActiveTab();
        if (u && !el.url.value) {
            el.url.value = u;
            const g = guessKind(u);
            if (g) { el.kind.value = g; }
            tip('已自动填入当前页地址，按「开始枚举」即可');
        }
    })();

    render();
})();