/**
 * 钓鱼竿 video-rod — 主页「半手动」批量记录（微博 P1）
 * ------------------------------------------------------------------
 * 苏哥的要求：进入某人主页，人工往下拉，扩展自动记录出现的图片；
 * 视频点开播放时记录真实直链；最后在面板里勾选批量下载。
 *
 * 为什么不做自动翻页/自动滚动：
 *  - 微博等站点有反爬/限流，自动翻页容易触发风控；
 *  - 与 ADR-010「只抓已加载，不自动滚动」一致。
 *
 * 只负责「记录 + 面板 + 发消息」；下载在 background 里队列执行。
 */
(() => {
    if (window.__vrBulkProfile) { return; }
    const host = location.hostname;
    if (!/(^|\.)(weibo\.com|weibo\.cn)$/i.test(host)) { return; }
    window.__vrBulkProfile = true;

    const MAX_ITEMS = 500;
    const items = [];
    const seen = new Set();
    let panel = null, btn = null, listEl = null, statusEl = null;
    let open = false;

    function text(el) {
        return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    }

    /** 微博缩略图 → 大图；已经是 large 的不动 */
    function bigImage(src) {
        return String(src || '').replace(
            /\/(orj360|orj480|orj1080|mw690|mw1024|thumb150|thumbnail)\//, '/large/');
    }

    function add(item) {
        if (!item || !item.url || !/^https?:/i.test(item.url) || seen.has(item.url)) { return; }
        seen.add(item.url);
        items.push(item);
        while (items.length > MAX_ITEMS) {
            const gone = items.shift();
            seen.delete(gone.url);
        }
        renderCount();
        if (open) { renderList(); }
    }

    function scan() {
        document.querySelectorAll('.wb-item').forEach(function (item) {
            const head = item.querySelector('header .m-text-box a[href*="/profile/"]');
            const author = head ? text(head).replace(/^@/, '') : '';
            const m = head ? (head.getAttribute('href') || '').match(/\/profile\/(\d+)/) : null;
            const authorId = m ? m[1] : '';
            const textEl = item.querySelector('article.weibo-main .weibo-text') ||
                item.querySelector('.weibo-text');
            let title = textEl ? text(textEl).replace(/^@[^:：]+[:：]\s*/, '') : '';
            if (title.length > 100) { title = title.slice(0, 100); }

            item.querySelectorAll('article.weibo-main img, .weibo-media img').forEach(function (img) {
                if (img.closest('.card-video, .mwb-video, .video-player')) { return; }
                const src = img.currentSrc || img.src || '';
                if (!/sinaimg/.test(src)) { return; }
                if (/avatar|face\.t|h5\.sinaimg|crop\./.test(src)) { return; }
                add({
                    site: 'weibo', kind: 'image', url: bigImage(src), ext: 'jpg',
                    title: title, author: author, authorId: authorId, pageUrl: location.href
                });
            });
        });
    }

    /** 视频真正播放时才记录：主页卡片里只有封面/fid，真实地址在播放器里 */
    function onPlay(ev) {
        const v = ev.target;
        if (!v || v.tagName !== 'VIDEO') { return; }
        const url = v.currentSrc || v.src || '';
        if (!/^https?:/i.test(url)) { return; }
        const meta = window.__vrFeedMeta || {};
        add({
            site: 'weibo', kind: 'video', url: url, ext: 'mp4',
            title: meta.title || '视频',
            author: meta.author || '',
            authorId: meta.authorId || '',
            pageUrl: location.href
        });
    }

    /* ---------- 面板 ---------- */
    function ensureUI() {
        if (btn) { return; }
        const style = document.createElement('style');
        style.textContent = [
            '.vr-bulk-btn{position:fixed;right:18px;bottom:18px;z-index:2147482000;',
            'padding:10px 14px;border-radius:10px;background:#111827;color:#fff;',
            'font:13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;',
            'box-shadow:0 6px 22px rgba(0,0,0,.35);cursor:pointer;user-select:none}',
            '.vr-bulk-btn:hover{background:#1f2937}',
            '.vr-bulk-panel{position:fixed;right:18px;bottom:64px;z-index:2147482000;',
            'width:380px;max-width:calc(100vw - 36px);max-height:62vh;display:none;',
            'flex-direction:column;background:#fff;color:#111;border-radius:12px;',
            'box-shadow:0 10px 34px rgba(0,0,0,.3);overflow:hidden;',
            'font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}',
            '.vr-bulk-panel.vr-open{display:flex}',
            '.vr-bulk-head{padding:10px 12px;background:#f3f4f6;font-weight:600;',
            'display:flex;align-items:center;justify-content:space-between}',
            '.vr-bulk-close{cursor:pointer;color:#6b7280;font-size:16px;line-height:1}',
            '.vr-bulk-list{overflow:auto;flex:1;padding:4px 8px}',
            '.vr-bulk-row{display:flex;gap:8px;align-items:center;padding:6px 4px;',
            'border-bottom:1px solid #f1f1f1;cursor:pointer}',
            '.vr-bulk-row img,.vr-bulk-thumb{width:40px;height:40px;border-radius:6px;',
            'object-fit:cover;background:#e5e7eb;flex:0 0 40px;display:flex;',
            'align-items:center;justify-content:center;font-size:18px}',
            '.vr-bulk-info{min-width:0;flex:1}',
            '.vr-bulk-info b{display:block;font-weight:600;white-space:nowrap;',
            'overflow:hidden;text-overflow:ellipsis}',
            '.vr-bulk-info span{display:block;color:#6b7280;white-space:nowrap;',
            'overflow:hidden;text-overflow:ellipsis}',
            '.vr-bulk-foot{display:flex;gap:6px;padding:8px 10px;background:#f9fafb;',
            'align-items:center;flex-wrap:wrap}',
            '.vr-bulk-foot button{border:1px solid #d1d5db;background:#fff;border-radius:7px;',
            'padding:5px 9px;cursor:pointer;font-size:12px}',
            '.vr-bulk-foot button.vr-primary{background:#111827;color:#fff;border-color:#111827}',
            '.vr-bulk-status{margin-left:auto;color:#6b7280;font-size:11px}',
            '.vr-bulk-empty{padding:14px 10px;color:#6b7280;line-height:1.6}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);

        btn = document.createElement('div');
        btn.className = 'vr-bulk-btn';
        btn.textContent = '批量下载 (0)';
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            open = !open;
            panel.classList.toggle('vr-open', open);
            if (open) { renderList(); }
        });
        document.documentElement.appendChild(btn);

        panel = document.createElement('div');
        panel.className = 'vr-bulk-panel';
        panel.innerHTML =
            '<div class="vr-bulk-head"><span>主页媒体（手动往下拉自动记录）</span>' +
            '<span class="vr-bulk-close" title="关闭">×</span></div>' +
            '<div class="vr-bulk-list"></div>' +
            '<div class="vr-bulk-foot">' +
            '<button type="button" data-act="all">全选</button>' +
            '<button type="button" data-act="none">全不选</button>' +
            '<button type="button" class="vr-primary" data-act="down">保存到文件夹</button>' +
            '<button type="button" data-act="clear">清空</button>' +
            '<span class="vr-bulk-status"></span></div>';
        document.documentElement.appendChild(panel);
        listEl = panel.querySelector('.vr-bulk-list');
        statusEl = panel.querySelector('.vr-bulk-status');
        panel.querySelector('.vr-bulk-close').addEventListener('click', function () {
            open = false; panel.classList.remove('vr-open');
        });
        panel.addEventListener('click', function (e) {
            const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
            if (!act) { return; }
            if (act === 'all' || act === 'none') {
                const on = act === 'all';
                listEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { cb.checked = on; });
            } else if (act === 'clear') {
                items.length = 0; seen.clear(); renderCount(); renderList();
                statusEl.textContent = '';
            } else if (act === 'down') {
                downloadSelected();
            }
        });
        statusEl.textContent = '';
        renderCount();
    }

    function renderCount() {
        if (btn) { btn.textContent = '批量下载 (' + items.length + ')'; }
    }

    function renderList() {
        if (!listEl) { return; }
        if (!items.length) {
            listEl.innerHTML = '<div class="vr-bulk-empty">往下滚动，自动记录图片；' +
                '视频点开播放后自动记录。不会自动翻页/滚动。</div>';
            return;
        }
        const frag = document.createDocumentFragment();
        items.forEach(function (it, i) {
            const row = document.createElement('label');
            row.className = 'vr-bulk-row';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = true; cb.dataset.i = String(i);
            const thumb = document.createElement(it.kind === 'image' ? 'img' : 'div');
            if (it.kind === 'image') { thumb.src = it.url; thumb.loading = 'lazy'; }
            else { thumb.className = 'vr-bulk-thumb'; thumb.textContent = '🎬'; }
            const info = document.createElement('div');
            info.className = 'vr-bulk-info';
            const b = document.createElement('b');
            b.textContent = (it.author ? '@' + it.author + ' ' : '') +
                (it.kind === 'image' ? '图片' : '视频');
            const sp = document.createElement('span');
            sp.textContent = it.title || '';
            info.appendChild(b); info.appendChild(sp);
            row.appendChild(cb); row.appendChild(thumb); row.appendChild(info);
            frag.appendChild(row);
        });
        listEl.innerHTML = '';
        listEl.appendChild(frag);
    }

    function safePart(s, max) {
        return String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
            .replace(/\s+/g, ' ').trim().slice(0, max || 60);
    }
    function dirName(it) {
        const a = safePart(it.author, 40);
        const id = safePart(it.authorId, 24);
        return a ? (id ? a + '(@' + id + ')' : a) : 'weibo';
    }
    function fileName(it, index) {
        let title = safePart(it.title, 80);
        if (title === '视频') { title = ''; }
        const ext = it.ext || (it.kind === 'image' ? 'jpg' : 'mp4');
        return (title || ('媒体_' + dirName(it))) + '_' +
            String(index + 1).padStart(2, '0') + '.' + ext;
    }

    /** 选一次目录，按 作者(@UID)/ 直接写盘；这样批量不会被 Chrome 的自动下载限制拦。 */
    async function saveToDirectory(dir, chosen) {
        let done = 0;
        for (let j = 0; j < chosen.length; j++) {
            const it = chosen[j];
            if (statusEl) { statusEl.textContent = '保存中 ' + (j + 1) + '/' + chosen.length; }
            try {
                const sub = await dir.getDirectoryHandle(dirName(it), { create: true });
                const fh = await sub.getFileHandle(fileName(it, j), { create: true });
                const w = await fh.createWritable();
                const res = await fetch(it.url, { credentials: 'include' });
                if (!res.ok) { throw new Error('HTTP ' + res.status); }
                await w.write(await res.blob());
                await w.close();
                done++;
            } catch (e) {
                console.warn('[video-rod] 保存失败', it.url, e);
            }
            await new Promise(function (r) { setTimeout(r, 300); });
        }
        if (statusEl) { statusEl.textContent = '完成：' + done + '/' + chosen.length; }
    }

    async function downloadSelected() {
        const chosen = [];
        listEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
            if (cb.checked) {
                const it = items[Number(cb.dataset.i)];
                if (it) { chosen.push(it); }
            }
        });
        if (!chosen.length) { statusEl.textContent = '没有选中媒体'; return; }

        // 首选：File System Access API，一次选目录，按作者建子文件夹，批量写盘
        if (typeof window.showDirectoryPicker === 'function') {
            let dir = null;
            try {
                statusEl.textContent = '请选择保存目录…';
                dir = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
            } catch (e) {
                if (e && e.name === 'AbortError') { statusEl.textContent = '已取消'; return; }
                statusEl.textContent = '目录选择失败，回退默认下载';
            }
            if (dir) { saveToDirectory(dir, chosen); return; }
        }

        // 回退：后台队列（多次 <a download> 可能被浏览器拦截）
        statusEl.textContent = '开始下载 ' + chosen.length + ' 个…';
        chrome.runtime.sendMessage({ Message: 'vrBulkDownload', items: chosen }, function (res) {
            if (chrome.runtime.lastError || !res || !res.ok) {
                statusEl.textContent = '下载失败';
            } else {
                statusEl.textContent = '完成：' + res.done + '/' + res.total;
            }
        });
    }

    chrome.runtime.onMessage.addListener(function (msg) {
        if (!msg || msg.Message !== 'vrBulkProgress') { return; }
        if (statusEl) { statusEl.textContent = '下载中 ' + msg.done + '/' + msg.total; }
    });

    /* ---------- 启动 ---------- */
    let timer = 0;
    function schedule() {
        if (timer) { return; }
        timer = setTimeout(function () { timer = 0; scan(); }, 600);
    }
    const mo = new MutationObserver(schedule);
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    window.addEventListener('scroll', schedule, { passive: true });
    document.addEventListener('play', onPlay, true);
    scan();
    ensureUI();
})();
