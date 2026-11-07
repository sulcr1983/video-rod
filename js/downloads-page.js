/**
 * 苏哥的钓鱼竿 —— 下载管理页（downloads.html）
 *
 * 数据源直接用 chrome.downloads（而不是自建任务表）：
 *   · 浏览器下载器才是真相，自建表会和它不一致（进度、暂停、失败原因都要自己追）
 *   · 暂停/继续/重试/取消全都有现成 API，不需要自己实现状态机
 *   · 缺点：拿不到「这是我们扩展发起的」以外的来源标记 —— 用 filename 前缀区分即可
 *
 * 本文件只做：读列表 → 按状态分组 → 渲染 → 调 downloads API 操作 → 事件刷新。
 */
(() => {
    'use strict';

    const $ = id => document.getElementById(id);
    const el = {
        note: $('dlNote'), refresh: $('dlRefresh'),
        seg: $('dlSeg'), search: $('dlSearch'),
        body: $('dlBody'), list: $('dlList'),
        empty: $('dlEmpty'), emptyT: $('dlEmptyT'), emptyS: $('dlEmptyS'),
        sum: $('dlSum'), openDir: $('dlOpenDir'), clearDone: $('dlClearDone'),
        cntAll: $('cntAll'), cntProg: $('cntProg'), cntDone: $('cntDone'), cntFail: $('cntFail')
    };

    let all = [];              // chrome.downloads.search 的原始结果
    let status = 'all';        // all | progress | done | failed
    let keyword = '';
    let refreshTimer = 0;

    /* ---------------- 工具 ---------------- */

    function fmtBytes(n) {
        const v = Number(n) || 0;
        if (v <= 0) { return '—'; }
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        let x = v;
        while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
        return (i === 0 ? String(Math.round(x)) : x.toFixed(1)) + ' ' + units[i];
    }

    function fmtTime(t) {
        if (!t) { return ''; }
        const d = new Date(t);
        if (isNaN(d.getTime())) { return ''; }
        const p = n => String(n).padStart(2, '0');
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function baseName(p) {
        const s = String(p || '');
        const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
        return i >= 0 ? s.slice(i + 1) : s;
    }

    /**
     * 状态归类：进行中 / 已完成 / 失败 / 已暂停。
     *
     * ⚠️ 必须先判 paused 再判 state：Chrome 里暂停的下载
     * state 仍然是 'in_progress'，只有 paused 变成 true（实测）。
     * 早先只在 interrupted 分支判 paused，结果暂停后行还显示「下载中」、
     * 按钮还是「暂停」，点不到「继续」。
     */
    function stateOf(d) {
        if (!d) { return 'failed'; }
        if (d.paused) { return 'paused'; }
        if (d.state === 'complete') { return 'done'; }
        if (d.state === 'interrupted') { return 'failed'; }
        return 'progress';       // in_progress 或还没开始
    }

    const STATE_LABEL = { progress: '下载中', done: '已完成', failed: '失败', paused: '已暂停' };

    function progressOf(d) {
        const total = Number(d.totalBytes) || 0;
        const got = Number(d.bytesReceived) || 0;
        if (d.state === 'complete') { return 100; }
        if (!total) { return 0; }
        return Math.max(0, Math.min(100, Math.round(got / total * 100)));
    }

    function metaLine(d) {
        const parts = [];
        const size = Number(d.totalBytes) || Number(d.bytesReceived) || 0;
        if (size) { parts.push(fmtBytes(size)); }
        const t = d.startTime ? fmtTime(d.startTime) : '';
        if (t) { parts.push(t); }
        if (d.error) { parts.push('错误：' + String(d.error)); }
        if (d.state === 'in_progress' && d.totalBytes) {
            parts.push(progressOf(d) + '%');
        }
        const url = String(d.url || '');
        if (url && url.indexOf('blob:') !== 0 && url.indexOf('data:') !== 0) {
            parts.push(url.slice(0, 72));
        }
        return parts.join(' · ');
    }

    /* ---------------- 过滤与统计 ---------------- */

    function matchKeyword(d, kw) {
        if (!kw) { return true; }
        const s = kw.trim();
        if (!s) { return true; }
        const hay = (String(d.filename || '') + ' ' + String(d.url || '')).toLowerCase();
        if (s.length > 2 && s.charAt(0) === '/' && s.charAt(s.length - 1) === '/') {
            try { return new RegExp(s.slice(1, -1)).test(hay); } catch (e) { /* 落到子串 */ }
        }
        return hay.indexOf(s.toLowerCase()) >= 0;
    }

    function visible() {
        return all.filter(d => {
            if (status !== 'all') {
                const st = stateOf(d);
                if (status === 'progress') {
                    if (st !== 'progress' && st !== 'paused') { return false; }
                } else if (st !== status) { return false; }
            }
            return matchKeyword(d, keyword);
        });
    }

    function counts() {
        const c = { all: all.length, progress: 0, done: 0, failed: 0 };
        for (const d of all) {
            const st = stateOf(d);
            if (st === 'progress' || st === 'paused') { c.progress++; }
            else if (st === 'done') { c.done++; }
            else { c.failed++; }
        }
        return c;
    }

    function renderCounts() {
        const c = counts();
        el.cntAll.textContent = String(c.all);
        el.cntProg.textContent = String(c.progress);
        el.cntDone.textContent = String(c.done);
        el.cntFail.textContent = String(c.failed);
    }

    /* ---------------- 渲染 ---------------- */

    const ICON_PAUSE = '⏸';
    const ICON_RESUME = '▶';
    const ICON_RETRY = '↻';
    const ICON_CANCEL = '✕';
    const ICON_FOLDER = '⌸';

    function rowEl(d) {
        const st = stateOf(d);
        const row = document.createElement('div');
        row.className = 'dl-row st-' + st;
        row.setAttribute('data-id', String(d.id));

        const main = document.createElement('div');
        main.className = 'dl-main';

        const name = document.createElement('div');
        name.className = 'dl-name';
        name.textContent = baseName(d.filename) || '(未知文件名)';
        name.title = String(d.filename || '');

        const meta = document.createElement('div');
        meta.className = 'dl-meta';
        meta.textContent = metaLine(d);

        const bar = document.createElement('div');
        bar.className = 'dl-bar';
        const fill = document.createElement('i');
        fill.style.width = progressOf(d) + '%';
        bar.appendChild(fill);

        main.appendChild(name);
        main.appendChild(meta);
        if (st === 'progress' || st === 'paused' || st === 'done') { main.appendChild(bar); }

        const badge = document.createElement('span');
        badge.className = 'dl-badge st-' + st;
        badge.textContent = STATE_LABEL[st] || st;

        const acts = document.createElement('div');
        acts.className = 'dl-acts';

        function addAct(icon, title, cls, fn) {
            const b = document.createElement('button');
            b.className = 'dl-act' + (cls ? ' ' + cls : '');
            b.textContent = icon;
            b.title = title;
            b.addEventListener('click', ev => { ev.stopPropagation(); fn(); });
            acts.appendChild(b);
        }

        if (st === 'progress') {
            addAct(ICON_PAUSE, '暂停', '', () => chrome.downloads.pause(d.id, () => schedule()));
            addAct(ICON_CANCEL, '取消', 'danger', () => chrome.downloads.cancel(d.id, () => schedule()));
        } else if (st === 'paused') {
            addAct(ICON_RESUME, '继续', '', () => chrome.downloads.resume(d.id, () => schedule()));
            addAct(ICON_CANCEL, '取消', 'danger', () => chrome.downloads.cancel(d.id, () => schedule()));
        } else if (st === 'failed') {
            addAct(ICON_RETRY, '重试', '', () => retry(d));
            addAct(ICON_CANCEL, '从列表移除', 'danger', () => chrome.downloads.erase({ id: d.id }, () => schedule()));
        } else {
            /* chrome.downloads.show 在「文件还没落盘 / 已被移走」时会抛
             * "Download must be complete"（MV3 下是 Promise 拒绝）。
             * 以前直接裸调，用户点「打开文件」就在错误页攒一条
             * Unchecked runtime.lastError。这里既接同步抛错，也接 Promise 拒绝。 */
            addAct(ICON_FOLDER, '打开文件', '', () => {
                try {
                    var p = chrome.downloads.show(d.id);
                    if (p && typeof p.catch === 'function') {
                        p.catch(function () { /* 尚未完成或文件已不在 */ });
                    }
                } catch (e) { /* 同上，静默 */ }
            });
            addAct(ICON_CANCEL, '从列表移除', 'danger', () => chrome.downloads.erase({ id: d.id }, () => schedule()));
        }

        row.appendChild(main);
        row.appendChild(badge);
        row.appendChild(acts);
        return row;
    }

    /**
     * 重试：必须用**原 URL 重新发起**，而不是 resume。
     * resume 只能续传被暂停的传输；interrupted 的任务在 Chrome 里没有可续的句柄，
     * 对 interrupted 调 resume 会直接报错（实测）。
     */
    function retry(d) {
        const url = String(d.url || '');
        if (!url || url.indexOf('blob:') === 0) {
            // blob 地址随页面销毁已失效，不可能重试成功 —— 如实告知，不假装重试
            el.sum.textContent = '这条任务的地址已失效（blob 链接随页面关闭而失效），无法重试';
            return;
        }
        try {
            chrome.downloads.download({
                url: url,
                filename: d.filename || undefined,
                conflictAction: 'uniquify',
                saveAs: false
            }, () => {
                void chrome.runtime.lastError;
                schedule();
            });
        } catch (e) {
            el.sum.textContent = '重试失败：' + e;
        }
    }

    function render() {
        renderCounts();
        const list = visible();
        el.list.innerHTML = '';
        if (!list.length) {
            el.empty.hidden = false;
            const c = counts();
            if (status === 'all' && c.all === 0) {
                el.emptyT.textContent = '还没有下载任务';
                el.emptyS.textContent = '用侧边栏抓图、嗅探列表或右键菜单下载，任务会出现在这里。';
            } else if (keyword) {
                el.emptyT.textContent = '没有匹配「' + keyword + '」的任务';
                el.emptyS.textContent = '换个关键词，或清空搜索框。';
            } else {
                el.emptyT.textContent = '这个分组是空的';
                el.emptyS.textContent = '切到「全部」看看其它状态的任务。';
            }
            el.sum.textContent = '共 ' + list.length + ' 条';
            return;
        }
        el.empty.hidden = true;
        const frag = document.createDocumentFragment();
        for (const d of list.slice(0, 300)) { frag.appendChild(rowEl(d)); }
        el.list.appendChild(frag);

        const c = counts();
        el.sum.innerHTML = '显示 <b>' + Math.min(list.length, 300) + '</b> / ' + list.length +
            ' 条 · 进行中 ' + c.progress + ' · 已完成 ' + c.done + ' · 失败 ' + c.failed;
    }

    /* ---------------- 数据加载 ---------------- */

    function load() {
        return new Promise(resolve => {
            try {
                chrome.downloads.search({ orderBy: ['-startTime'], limit: 500 }, list => {
                    void chrome.runtime.lastError;
                    all = Array.isArray(list) ? list : [];
                    resolve(all);
                });
            } catch (e) { all = []; resolve([]); }
        });
    }

    async function reload() {
        await load();
        el.note.textContent = all.length
            ? '最近 ' + all.length + ' 条 · 数据来自浏览器下载器'
            : '暂无记录';
        render();
    }

    /** 事件里可能一秒几十次，合并到下一帧 */
    function schedule() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { reload(); }, 180);
    }

    /* ---------------- 交互 ---------------- */

    el.refresh.addEventListener('click', reload);

    el.seg.addEventListener('click', ev => {
        const b = ev.target.closest ? ev.target.closest('button[data-st]') : null;
        if (!b) { return; }
        status = b.getAttribute('data-st');
        for (const x of el.seg.querySelectorAll('button')) {
            x.classList.toggle('on', x === b);
        }
        render();
    });

    let searchTimer = 0;
    el.search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            keyword = el.search.value;
            render();
        }, 150);
    });

    el.openDir.addEventListener('click', () => {
        try { chrome.downloads.showDefaultFolder(); } catch (e) { /* 忽略 */ }
    });

    el.clearDone.addEventListener('click', () => {
        const doneIds = all.filter(d => stateOf(d) === 'done').map(d => d.id);
        if (!doneIds.length) {
            el.sum.textContent = '没有已完成的任务需要清空';
            return;
        }
        // 二次确认就地改文案，避免又弹一个窗
        if (el.clearDone.dataset.armed !== '1') {
            el.clearDone.dataset.armed = '1';
            el.clearDone.textContent = '再点一次，清空 ' + doneIds.length + ' 条';
            setTimeout(() => {
                el.clearDone.dataset.armed = '';
                el.clearDone.textContent = '清空已完成';
            }, 3000);
            return;
        }
        el.clearDone.dataset.armed = '';
        el.clearDone.textContent = '清空已完成';
        chrome.downloads.erase({ state: 'complete' }, () => {
            void chrome.runtime.lastError;
            reload();
        });
    });

    /* ---------------- 浏览器事件 ---------------- */

    try {
        chrome.downloads.onCreated.addListener(schedule);
        chrome.downloads.onChanged.addListener(schedule);
        chrome.downloads.onErased.addListener(schedule);
    } catch (e) { /* 无权限时忽略，仍可手动刷新 */ }

    // 有进行中的任务时慢速轮询：downloads.onChanged 在暂停态不一定再推，
    // 不轮询的话进度条会停住不动（用户会以为卡死）
    setInterval(() => {
        if (all.some(d => stateOf(d) === 'progress' || stateOf(d) === 'paused')) {
            reload();
        }
    }, 1200);

    reload();
})();