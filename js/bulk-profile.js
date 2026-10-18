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
    const isWeibo = /(^|\.)(weibo\.com|weibo\.cn)$/i.test(host);
    const isX = /(^|\.)(x\.com|twitter\.com)$/i.test(host);
    if (!isWeibo && !isX) { return; }
    const SITE = isWeibo ? 'weibo' : 'x';

    let profileUser = '';
    if (isX) {
        const m = location.pathname.match(
            /^\/([A-Za-z0-9_]{1,15})(?:\/(?:media|photo|with_replies|reposts))?\/?$/);
        if (!m || /^(home|explore|notifications|messages|search|settings|i|compose|login|logout)$/i.test(m[1])) {
            return;
        }
        profileUser = m[1];
    } else {
        const m = location.pathname.match(/\/(?:profile|u)\/(\d+)/);
        profileUser = m ? m[1] : '';
    }
    window.__vrBulkProfile = true;

    const MAX_ITEMS = 500;
    const items = [];
    const seen = new Set();
    const doneKeys = new Set();
    const doneKey = 'vrBulkDone:' + SITE + ':' + (profileUser || 'page');
    let ignoreRt = true;
    let ignoreDone = true;
    let typeFilter = 'all';
    let panel = null, btn = null, listEl = null, statusEl = null;
    let open = false;

    function markDone(key) {
        if (!key) { return; }
        doneKeys.add(key);
        const arr = Array.from(doneKeys).slice(-3000);
        try { chrome.storage.local.set({ [doneKey]: arr }); } catch (e) { /* ignore */ }
    }

    const doneReady = new Promise(function (resolve) {
        try {
            chrome.storage.local.get(doneKey, function (res) {
                ((res && res[doneKey]) || []).forEach(function (k) { doneKeys.add(k); });
                resolve();
            });
        } catch (e) { resolve(); }
    });

    function text(el) {
        return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    }

    /** 微博缩略图 → 大图；已经是 large 的不动 */
    function bigImage(src) {
        return String(src || '').replace(
            /\/(orj360|orj480|orj1080|mw690|mw1024|thumb150|thumbnail)\//, '/large/');
    }

    function add(item) {
        const key = item && (item.key || item.url);
        if (!key || seen.has(key)) { return; }
        if (item.url && !/^https?:/i.test(item.url)) { return; }
        if (!item.url && item.kind !== 'video') { return; }
        if (!item.key) { item.key = key; }
        seen.add(key);
        items.push(item);
        while (items.length > MAX_ITEMS) {
            const gone = items.shift();
            seen.delete(gone.key || gone.url);
        }
        renderCount();
        if (open) { renderList(); }
    }

    function visibleItems() {
        return items.map(function (it, i) { return { it: it, i: i }; }).filter(function (x) {
            if (ignoreDone && x.it.key && doneKeys.has(x.it.key)) { return false; }
            if (ignoreRt && x.it.isRt) { return false; }
            if (typeFilter === 'image' && x.it.kind !== 'image') { return false; }
            if (typeFilter === 'video' && x.it.kind !== 'video') { return false; }
            return true;
        });
    }

    function scan() {
        if (SITE === 'x') { scanX(); } else { scanWeibo(); }
    }

    function scanWeibo() {
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

    function tweetRef(article) {
        const a = article.querySelector('a[href*="/status/"]');
        if (!a) { return null; }
        const m = (a.getAttribute('href') || '').match(/\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,})/);
        return m ? { user: m[1], statusId: m[2] } : null;
    }

    function mediaIdFromArticle(article) {
        const v = article.querySelector('video');
        const poster = v ? (v.poster || '') : '';
        const m = poster.match(/(?:thumb|video)\/(\d{8,})\//) ||
            poster.match(/\/media\/([A-Za-z0-9_-]{8,})\./);
        return m ? m[1] : '';
    }

    function scanX() {
        document.querySelectorAll('article[data-testid="tweet"]').forEach(function (article) {
            const ref = tweetRef(article);
            if (!ref) { return; }
            const N = self.VideoRodNaming;
            let info = { author: '', authorId: '', title: '', post: '' };
            if (N) {
                try {
                    const i = N.extractTwitter(article, 'x.com');
                    info = {
                        author: i.author || '', authorId: i.authorId || '',
                        title: i.title || i.post || '', post: i.post || ''
                    };
                } catch (e) { /* 继续用 fallback */ }
            }
            const ctx = article.querySelector('[data-testid="socialContext"]');
            const isRt = !!ctx ||
                !!(profileUser && ref.user.toLowerCase() !== profileUser.toLowerCase());
            const hasVideo = !!article.querySelector('[data-testid="videoPlayer"], video');
            const base = {
                site: 'x', isRt: isRt,
                title: info.title || info.post || '',
                author: info.author || ref.user,
                authorId: info.authorId || ref.user,
                pageUrl: 'https://x.com/' + ref.user + '/status/' + ref.statusId
            };
            if (hasVideo) {
                const v = article.querySelector('video');
                add(Object.assign({}, base, {
                    key: 'x:video:' + ref.statusId,
                    kind: 'video', ext: 'mp4',
                    user: ref.user, statusId: ref.statusId,
                    mediaId: mediaIdFromArticle(article),
                    poster: v ? (v.poster || '') : ''
                }));
                return;
            }
            article.querySelectorAll('img[src*="pbs.twimg.com/media"]').forEach(function (img) {
                const raw = img.src || '';
                if (!raw || /profile_images|amplify_video_thumb/.test(raw)) { return; }
                const u = raw.split('?')[0] + '?name=orig';
                const ext = (u.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
                add(Object.assign({}, base, {
                    key: u, kind: 'image', url: u, ext: ext,
                    statusId: ref.statusId, mediaId: ''
                }));
            });
        });
    }

    /** 视频真正播放时才记录：主页卡片里只有封面/fid，真实地址在播放器里 */
    function onPlay(ev) {
        if (SITE !== 'weibo') { return; }
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
            '.vr-bulk-opt{display:flex;align-items:center;gap:3px;color:#4b5563;font-size:11px}',
            '.vr-bulk-type{border:1px solid #d1d5db;border-radius:7px;padding:3px 5px;font-size:11px;background:#fff}',
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
            (SITE === 'x'
                ? '<label class="vr-bulk-opt"><input type="checkbox" data-opt="ignoreRt" checked>忽略转载</label>'
                : '') +
            '<label class="vr-bulk-opt"><input type="checkbox" data-opt="ignoreDone" checked>忽略已下载</label>' +
            '<select class="vr-bulk-type" data-opt="type">' +
            '<option value="all">全部</option><option value="image">只要图片</option><option value="video">只要视频</option>' +
            '</select>' +
            '<button type="button" data-act="all">全选</button>' +
            '<button type="button" data-act="none">全不选</button>' +
            '<button type="button" data-act="invert">反选</button>' +
            '<button type="button" data-act="resetDone">清除已下载</button>' +
            '<button type="button" class="vr-primary" data-act="down">保存到文件夹</button>' +
            '<button type="button" data-act="clear">清空</button>' +
            '<span class="vr-bulk-status"></span></div>';
        document.documentElement.appendChild(panel);
        listEl = panel.querySelector('.vr-bulk-list');
        statusEl = panel.querySelector('.vr-bulk-status');
        panel.querySelector('.vr-bulk-close').addEventListener('click', function () {
            open = false; panel.classList.remove('vr-open');
        });
        panel.addEventListener('change', function (e) {
            const opt = e.target && e.target.getAttribute && e.target.getAttribute('data-opt');
            if (!opt) { return; }
            if (opt === 'ignoreRt') { ignoreRt = !!e.target.checked; }
            if (opt === 'ignoreDone') { ignoreDone = !!e.target.checked; }
            if (opt === 'type') { typeFilter = e.target.value || 'all'; }
            renderCount();
            renderList();
        });
        panel.addEventListener('click', function (e) {
            const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
            if (!act) { return; }
            if (act === 'all' || act === 'none') {
                const on = act === 'all';
                listEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { cb.checked = on; });
            } else if (act === 'invert') {
                listEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
                    cb.checked = !cb.checked;
                });
            } else if (act === 'resetDone') {
                doneKeys.clear();
                try { chrome.storage.local.remove(doneKey); } catch (e) { /* ignore */ }
                renderCount(); renderList();
                statusEl.textContent = '已清除下载记录';
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
        if (btn) { btn.textContent = '批量下载 (' + visibleItems().length + ')'; }
    }

    function renderList() {
        if (!listEl) { return; }
        const vis = visibleItems();
        if (!vis.length) {
            listEl.innerHTML = '<div class="vr-bulk-empty">' +
                (items.length
                    ? '没有新的媒体（可能被“忽略已下载/忽略转载”过滤了）。'
                    : '往下滚动，自动记录图片；视频点开播放后自动记录。不会自动翻页/滚动。') +
                '</div>';
            return;
        }
        const frag = document.createDocumentFragment();
        vis.forEach(function (x) {
            const it = x.it, i = x.i;
            const row = document.createElement('label');
            row.className = 'vr-bulk-row';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = true; cb.dataset.i = String(i);
            const thumb = document.createElement(
                it.kind === 'image' || it.poster ? 'img' : 'div');
            if (it.kind === 'image') { thumb.src = it.url; thumb.loading = 'lazy'; }
            else if (it.poster) { thumb.src = it.poster; thumb.loading = 'lazy'; }
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

    function resolveX(it) {
        return new Promise(function (resolve) {
            chrome.runtime.sendMessage({
                Message: 'vrResolveX',
                user: it.user, statusId: it.statusId, mediaId: it.mediaId
            }, function (res) {
                resolve((res && res.url) || '');
            });
        });
    }

    function sleep(ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    }
    function nextDelay() {
        // 稳妥模式：1.4~2.6 秒随机间隔，避免固定节奏被识别
        return 1400 + Math.floor(Math.random() * 1200);
    }
    async function fetchWithRetry(url, opts, maxRetry) {
        let lastErr = null;
        for (let attempt = 0; attempt <= maxRetry; attempt++) {
            try {
                const res = await fetch(url, opts);
                if (res.ok) { return res; }
                if (res.status === 429 || res.status >= 500) {
                    const retryAfter = Number(res.headers.get('retry-after')) || 0;
                    await sleep(Math.max(nextDelay(), retryAfter * 1000));
                    continue;
                }
                return res;   // 403 等鉴权/防盗链错误不重试，重试只会更快触发风控
            } catch (e) {
                lastErr = e;
                await sleep(nextDelay());
            }
        }
        throw lastErr || new Error('fetch-failed');
    }

    /** 选一次目录，按 作者(@UID)/ 直接写盘；这样批量不会被 Chrome 的自动下载限制拦。 */
    async function saveToDirectory(dir, chosen) {
        let done = 0;
        let failStreak = 0;
        if (statusEl) { statusEl.textContent = '稳妥模式：逐条保存，约 2 秒/个'; }
        for (let j = 0; j < chosen.length; j++) {
            const it = chosen[j];
            if (statusEl) { statusEl.textContent = '保存中 ' + (j + 1) + '/' + chosen.length; }
            try {
                let url = it.url;
                if (!url && it.kind === 'video' && it.site === 'x') {
                    url = await resolveX(it);
                }
                if (!url) { throw new Error('no-url'); }
                const sub = await dir.getDirectoryHandle(dirName(it), { create: true });
                const fh = await sub.getFileHandle(fileName(it, j), { create: true });
                const w = await fh.createWritable();
                const res = await fetchWithRetry(
                    url, { credentials: it.site === 'x' ? 'omit' : 'include' }, 2);
                if (!res.ok) { throw new Error('HTTP ' + res.status); }
                await w.write(await res.blob());
                await w.close();
                done++;
                failStreak = 0;
                markDone(it.key);
            } catch (e) {
                failStreak++;
                console.warn('[video-rod] 保存失败', it.url || it.statusId, e);
                if (failStreak >= 3) {
                    if (statusEl) {
                        statusEl.textContent = '连续失败 3 次，已暂停（可能触发风控）';
                    }
                    return;
                }
            }
            await sleep(nextDelay());
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
            } else if (res.paused) {
                statusEl.textContent = res.reason || '已暂停（连续失败）';
            } else {
                statusEl.textContent = '完成：' + res.done + '/' + res.total;
                if (res.done === res.total) {
                    chosen.forEach(function (it) { markDone(it.key); });
                }
            }
        });
    }

    chrome.runtime.onMessage.addListener(function (msg) {
        if (!msg || msg.Message !== 'vrBulkProgress') { return; }
        if (statusEl) {
            statusEl.textContent = msg.paused
                ? '已暂停：连续失败（可能触发风控）'
                : '下载中 ' + msg.done + '/' + msg.total;
        }
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
    doneReady.then(function () {
        renderCount();
        if (open) { renderList(); }
    });
})();
