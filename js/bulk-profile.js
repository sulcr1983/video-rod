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
    const isXhs = /(^|\.)xiaohongshu\.com$/i.test(host);
    if (!isWeibo && !isX && !isXhs) { return; }

    let noteId = '';
    if (isXhs) {
        // 只做详情页单篇：/explore/<id> 或 /discovery/item/<id>
        const m = location.pathname.match(/\/(?:explore|discovery\/item)\/([0-9a-f]{16,})/);
        if (!m) { return; }
        noteId = m[1];
    }
    const SITE = isWeibo ? 'weibo' : (isX ? 'x' : 'xhs');

    let profileUser = '';
    if (isX) {
        const m = location.pathname.match(
            /^\/([A-Za-z0-9_]{1,15})(?:\/(?:media|photo|with_replies|reposts))?\/?$/);
        if (!m || /^(home|explore|notifications|messages|search|settings|i|compose|login|logout)$/i.test(m[1])) {
            return;
        }
        profileUser = m[1];
    } else if (isWeibo) {
        const m = location.pathname.match(/\/(?:profile|u)\/(\d+)/);
        profileUser = m ? m[1] : '';
    } else {
        profileUser = noteId;
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

    /**
     * 微博缩略图地址 → 候选链（顺序即优先级）。
     *
     * 2026-11-06 升级：原来只把 /orj360|mw690|…/ 替换成 /large/ 就完事，
     * 但实测 oslarge 目录真实存在且未下线（方案文档 §3.4），原图档位应当排在前面。
     * 返回数组而不是单个 URL —— 调用方把整条链交给 vrBulkSaveItem 的候选池。
     *
     * 具体档位顺序由 VRWeiboAlbum.candidatesFromUrl 统一维护（与相册备份同一份规则），
     * 这里不重复实现，避免两处规则漂移。
     *
     * @returns {string[]} 非 sinaimg 地址原样返回单元素数组（无从构造档位）
     */
    function bigImage(src) {
        const s = String(src || '');
        if (!s) { return []; }

        const A = self.VRWeiboAlbum;
        if (A && typeof A.candidatesFromUrl === 'function') {
            return A.candidatesFromUrl(s);
        }

        /* 兜底：本文件在 X / 小红书页面也会加载，那两个分支没有 weibo-album-core.js。
         * 保持升级前的行为（缩略图档位 → /large/），不引入对 core 的硬依赖。 */
        return [s.replace(
            /\/(orj360|orj480|orj1080|mw690|mw1024|thumb150|thumbnail)\//, '/large/')];
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
        if (SITE === 'x') { scanX(); }
        else if (SITE === 'xhs') { scanXhs(); }
        else { scanWeibo(); }
    }

    function scanWeibo() {
        /* 新版微博 DOM 已无 .wb-item / article.weibo-main，旧选择器实测扫到 0 条，
         * 表现就是「滚到底还是第一页」。改成通用扫描：所有 img 里挑 sinaimg 大图，
         * 再向上找最近的内容卡片取正文与博主。任何页面结构变化都不会让它归零。 */
        document.querySelectorAll('img').forEach(function (img) {
            if (img.closest('.vr-bulk-panel, .vr-bulk-btn')) { return; }
            if (img.closest('video, .card-video, .mwb-video, .video-player')) { return; }
            const src = img.currentSrc || img.src || '';
            if (!/sinaimg/i.test(src)) { return; }
            if (/avatar|face\.|h5\.sinaimg|crop\./i.test(src)) { return; }
            const rc = img.getBoundingClientRect();
            if (Math.max(rc.width, rc.height) < 120) { return; }

            let card = img.closest('article, [class*="Feed"], [class*="feed"], [class*="card"], [class*="wb"]') || img.parentElement;
            let box = card;
            for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
                const t = text(box);
                if (t && t.length > 12) { card = box; break; }
            }
            let author = '', authorId = '';
            const a = card && card.querySelector('a[href*="/u/"], a[href*="/profile/"]');
            if (a) {
                author = text(a).replace(/^@/, '').slice(0, 30);
                const m = (a.getAttribute('href') || '').match(/\/(?:u|profile)\/(\d+)/);
                authorId = m ? m[1] : '';
            }
            let title = text(card).replace(/^@[^:：\s]{1,20}[:：]?\s*/, '').replace(/\s+/g, ' ').trim();
            if (title.length > 100) { title = title.slice(0, 100); }
            const chain = bigImage(src);
            if (!chain.length) { return; }
            add({
                site: 'weibo', kind: 'image', url: chain[0], urls: chain, ext: 'jpg',
                title: title, author: author, authorId: authorId, pageUrl: location.href
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
                /* X 媒体 URL 有两种形态：
                 *   .../HWSp9nzXsAAazfF?format=jpg&name=medium
                 *   .../HWTE5NjXsAA5oDT.jpg
                 * 之前一律 split('?')[0]+'?name=orig'，第一种丢掉 format → 404：
                 * 缩略图全裂、下载全失败、还误报「风控」（2026-11-05 实测）。
                 * 修法：有 format 参数就带回去；有 .jpg 后缀就保留后缀。 */
                const stem = raw.split('?')[0];
                const fmtRaw = ((raw.match(/[?&]format=(\w+)/) || [])[1] ||
                    (/\.\w+$/.test(stem) ? stem.split('.').pop().toLowerCase() : 'jpg'));
                const fmt = fmtRaw === 'jpeg' ? 'jpg' : fmtRaw;
                const u = /\.\w+$/.test(stem)
                    ? stem + '?name=orig'
                    : stem + '?format=' + fmt + '&name=orig';
                add(Object.assign({}, base, {
                    key: u, kind: 'image', url: u, ext: fmt,
                    /* 面板缩略图用 name=small，不必为列表预览拉原图 */
                    thumb: u.replace('name=orig', 'name=small'),
                    statusId: ref.statusId, mediaId: ''
                }));
            });
        });
    }

    /** 小红书详情页：只读当前笔记的 __INITIAL_STATE__，不自动翻页/不写操作 */
    function scanXhs() {
        const m = location.pathname.match(/\/(?:explore|discovery\/item)\/([0-9a-f]{16,})/);
        if (!m) { return; }
        chrome.runtime.sendMessage({ Message: 'vrXhsScan', noteId: m[1] }, function (res) {
            if (chrome.runtime.lastError || !res || !res.ok || !res.items) { return; }
            res.items.forEach(function (it) {
                if (!it || !it.url) { return; }
                add({
                    site: 'xhs', kind: it.kind, url: it.url,
                    ext: it.ext || (it.kind === 'image' ? 'webp' : 'mp4'),
                    title: res.title || it.title || '小红书笔记',
                    author: res.author || '', authorId: res.authorId || '',
                    pageUrl: location.href,
                    key: 'xhs:' + res.noteId + ':' + it.kind + ':' + it.index + ':' + it.url
                });
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
            '.vr-bulk-btn{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147482000;',
            'padding:14px 8px;border-radius:10px 0 0 10px;background:linear-gradient(180deg,#1677ff,#0f5fd1);color:#fff;',
            'font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;',
            'box-shadow:-4px 6px 22px rgba(15,95,209,.28);cursor:pointer;user-select:none;writing-mode:vertical-rl;letter-spacing:.08em}',
            '.vr-bulk-btn:hover{background:linear-gradient(180deg,#0f6fe8,#0a4fae)}',
            '.vr-bulk-panel{position:fixed;right:0;top:0;bottom:0;z-index:2147482000;',
            'width:360px;max-width:100vw;display:flex;flex-direction:column;background:#fff;color:#111;',
            'border-left:1px solid #e5e8ef;box-shadow:-12px 0 40px rgba(15,23,42,.18);overflow:hidden;',
            'transform:translateX(100%);visibility:hidden;transition:transform .22s ease,visibility .22s;',
            'font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}',
            '.vr-bulk-panel.vr-open{transform:none;visibility:visible}',
            '.vr-bulk-head{padding:14px 16px;background:linear-gradient(90deg,#f7f9fc,#fff);font-weight:650;font-size:13px;',
            'display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e8ef;color:#1d2129}',
            '.vr-bulk-close{cursor:pointer;color:#86909c;font-size:20px;line-height:1;padding:0 2px}',
            '.vr-bulk-close:hover{color:#1d2129}',
            '.vr-bulk-list{overflow:auto;flex:1;padding:4px 10px}',
            '.vr-bulk-row{display:flex;gap:8px;align-items:center;padding:8px 2px;',
            'border-bottom:1px solid #f0f2f6;cursor:pointer}',
            '.vr-bulk-row:hover{background:#f7f9fc;border-radius:6px}',
            '.vr-bulk-row img,.vr-bulk-thumb{width:42px;height:42px;border-radius:6px;',
            'object-fit:cover;background:#eef1f6;flex:0 0 42px;display:flex;',
            'align-items:center;justify-content:center;font-size:18px}',
            '.vr-bulk-info{min-width:0;flex:1}',
            '.vr-bulk-info b{display:block;font-weight:600;white-space:nowrap;',
            'overflow:hidden;text-overflow:ellipsis;color:#1d2129}',
            '.vr-bulk-info span{display:block;color:#86909c;white-space:nowrap;',
            'overflow:hidden;text-overflow:ellipsis;margin-top:2px}',
            '.vr-bulk-foot{display:flex;gap:6px;padding:10px 12px;background:#f7f9fc;',
            'align-items:center;flex-wrap:wrap;border-top:1px solid #e5e8ef}',
            '.vr-bulk-foot button{border:1px solid #d9dee8;background:#fff;border-radius:7px;',
            'padding:6px 9px;cursor:pointer;font-size:11px;color:#4e5969}',
            '.vr-bulk-foot button:hover{border-color:#bcd7ff;color:#1677ff}',
            '.vr-bulk-foot button.vr-primary{background:#1677ff;color:#fff;border-color:#1677ff;font-weight:600}',
            '.vr-bulk-foot button.vr-primary:hover{background:#0958d9;border-color:#0958d9;color:#fff}',
            '.vr-bulk-status{margin-left:auto;color:#86909c;font-size:10.5px}',
            '.vr-bulk-opt{display:flex;align-items:center;gap:3px;color:#4e5969;font-size:10.5px}',
            '.vr-bulk-type{border:1px solid #d9dee8;border-radius:7px;padding:4px 6px;font-size:11px;background:#fff;color:#4e5969}',
            '.vr-bulk-empty{padding:20px 12px;color:#86909c;line-height:1.7}',
            /* ---- 舞台皮肤覆盖（与资源库同一套 token；原型是设计真源） ---- */
            '.vr-bulk-btn{background:#2C2418!important;color:#E8B04B!important;',
            'border:1px solid #4A3A1D;border-right:none;box-shadow:-4px 6px 22px rgba(0,0,0,.5)}',
            '.vr-bulk-btn:hover{background:#3A2F1C!important;color:#F0C878!important}',
            '.vr-bulk-panel{background:#100F0E!important;color:#EFEAE0!important;',
            'border-left:1px solid #2B2620;box-shadow:-12px 0 40px rgba(0,0,0,.6);',
            'font-family:"Noto Sans SC",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
            '.vr-bulk-head{background:#191715!important;border-bottom:1px solid #2B2620!important;color:#EFEAE0!important}',
            '.vr-bulk-close,.vr-bulk-close:hover{color:#8C8478!important}',
            '.vr-bulk-row{border-bottom:1px solid #211E1A!important}',
            '.vr-bulk-row:hover{background:#1F1C18!important}',
            '.vr-bulk-row img,.vr-bulk-thumb{background:#241F19!important;color:#8C8478}',
            '.vr-bulk-info b{color:#EFEAE0!important}',
            '.vr-bulk-info span,.vr-bulk-status,.vr-bulk-empty,.vr-bulk-opt{color:#8C8478!important}',
            '.vr-bulk-foot{background:#191715!important;border-top:1px solid #2B2620!important}',
            '.vr-bulk-foot button{background:#1F1C18!important;border:1px solid #2B2620!important;color:#C8C0B2!important}',
            '.vr-bulk-foot button:hover{border-color:#4A3A1D!important;color:#E8B04B!important}',
            '.vr-bulk-foot button.vr-primary{background:#E8B04B!important;border-color:#E8B04B!important;color:#17130D!important}',
            '.vr-bulk-foot button.vr-primary:hover{background:#F2C46E!important;color:#17130D!important}',
            '.vr-bulk-type{background:#1F1C18!important;border:1px solid #2B2620!important;color:#C8C0B2!important}',
            '.vr-bulk-list input[type=checkbox]{accent-color:#E8B04B}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);

        btn = document.createElement('div');
        btn.className = 'vr-bulk-btn';
        btn.textContent = '批量下载 (0)';
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            setBulkOpen(!open);
        });
        document.documentElement.appendChild(btn);

        function setBulkOpen(v) {
            open = !!v;
            /* 与「相册备份」面板互斥：两个都是全高右栏、同一 z-index，
             * 同时打开会叠在一起互相遮挡（用户 2026-11-07 反馈「同时弹出 2 个页面」）。
             * 这里只做「打开前先关掉对方」，不改对方任何行为。 */
            if (open) { closeWeiboAlbumPanel(); }
            panel.classList.toggle('vr-open', open);
            btn.style.display = open ? 'none' : '';
            if (open) { renderList(); }
        }

        /** 关掉微博相册备份面板（点它自己的关闭按钮，避免两处状态不同步） */
        function closeWeiboAlbumPanel() {
            const other = document.querySelector('.vr-wb-panel.vr-open');
            if (!other) { return; }
            const c = other.querySelector('.vr-wb-close');
            if (c) { c.click(); }
        }

        panel = document.createElement('div');
        panel.className = 'vr-bulk-panel';
        panel.innerHTML =
            '<div class="vr-bulk-head"><span>' +
            (SITE === 'xhs' ? '当前笔记媒体（手动打开）' : '主页媒体（手动往下拉自动记录）') +
            '</span>' +
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
            '<button type="button" class="vr-primary" data-act="saveall">一键保存本页</button>' +
            '<button type="button" data-act="down">保存选中</button>' +
            '<button type="button" data-act="clear">清空</button>' +
            '<span class="vr-bulk-status"></span></div>';
        document.documentElement.appendChild(panel);
        listEl = panel.querySelector('.vr-bulk-list');
        statusEl = panel.querySelector('.vr-bulk-status');
        panel.querySelector('.vr-bulk-close').addEventListener('click', function () {
            setBulkOpen(false);
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
            } else if (act === 'down' || act === 'saveall') {
                if (act === 'saveall') {
                    if (!visibleItems().length) {
                        statusEl.textContent = '先手动往下拉，记录媒体后再保存';
                        return;
                    }
                    listEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
                        cb.checked = true;
                    });
                }
                downloadSelected();
            }
        });
        statusEl.textContent = '';
        renderCount();

        /* 苏哥 2026-11-05：进页面不许自动弹大窗，挡视线。
         * 右侧竖标签常驻，用户想采集时自己点开（与 Fatkun「点图标才开面板」一致）。 */
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
            if (it.kind === 'image') { thumb.src = it.thumb || it.url; thumb.loading = 'lazy'; }
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
        if (a) { return id ? a + '(@' + id + ')' : a; }
        return it.site === 'xhs' ? '小红书' : (it.site === 'x' ? 'x' : 'weibo');
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
        let chosen = [];
        listEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
            if (cb.checked) {
                const it = items[Number(cb.dataset.i)];
                if (it) { chosen.push(it); }
            }
        });
        if (!chosen.length) { statusEl.textContent = '没有选中媒体'; return; }

        // 小红书：页面 fetch 被 CORS 拒绝，走 downloads + 作者目录；
        // 不设条数上限，后台 3–5 秒/条，遇风控失败自动暂停。
        if (SITE === 'xhs') {
            statusEl.textContent = '开始保存 ' + chosen.length + ' 条（3–5 秒/条）…';
            chrome.runtime.sendMessage({ Message: 'vrBulkDownload', items: chosen }, function (res) {
                if (chrome.runtime.lastError || !res || !res.ok) {
                    statusEl.textContent = '下载失败';
                } else if (res.paused) {
                    statusEl.textContent = res.reason || '已暂停（连续失败）';
                } else {
                    const skipped = res.skipped || 0;
                    statusEl.textContent = '完成：' + res.done + '/' + res.total + (skipped ? '，跳过重复 ' + skipped : '');
                    if (res.done + skipped === res.total) {
                        chosen.forEach(function (it) { markDone(it.key); });
                    }
                }
            });
            return;
        }

        // 统一保存到默认媒体库（Downloads/video-rod），不再弹目录选择器
        statusEl.textContent = '保存到媒体库…';

        // 回退：后台队列（多次 <a download> 可能被浏览器拦截）
        statusEl.textContent = '开始下载 ' + chosen.length + ' 个…';
        chrome.runtime.sendMessage({ Message: 'vrBulkDownload', items: chosen }, function (res) {
            if (chrome.runtime.lastError || !res || !res.ok) {
                statusEl.textContent = '下载失败';
            } else if (res.paused) {
                statusEl.textContent = res.reason || '已暂停（连续失败）';
            } else {
                const skipped = res.skipped || 0;
                statusEl.textContent = '完成：' + res.done + '/' + res.total + (skipped ? '，跳过重复 ' + skipped : '');
                if (res.done + skipped === res.total) {
                    chosen.forEach(function (it) { markDone(it.key); });
                }
            }
        });
    }

    chrome.runtime.onMessage.addListener(function (msg) {
        if (!msg || msg.Message !== 'vrBulkProgress') { return; }
        if (statusEl) {
            statusEl.textContent = msg.paused
                ? (msg.reason || '已暂停（连续失败）')
                : '下载中 ' + msg.done + '/' + msg.total +
                  (msg.skipped ? '，跳过重复 ' + msg.skipped : '') +
                  (msg.failed ? '，失败 ' + msg.failed : '');
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
    if (SITE === 'xhs') {
        let lastHref = location.href;
        setInterval(function () {
            if (location.href !== lastHref) { lastHref = location.href; scan(); }
        }, 1200);
    }
    doneReady.then(function () {
        renderCount();
        if (open) { renderList(); }
    });
})();
