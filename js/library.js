/**
 * 钓鱼竿 video-rod — 媒体库 P1/P2
 * 目录选择 → 递归扫描 → _index/index.json → 树/网格/预览/重命名/回收站
 */
(() => {
    'use strict';

    const $ = s => document.querySelector(s);
    const $$ = s => Array.from(document.querySelectorAll(s));
    const IMG_EXT = new Set(['jpg','jpeg','png','webp','gif','avif','bmp']);
    const VID_EXT = new Set(['mp4','webm','mov','m4v','mkv','avi']);
    const PLATFORM_META = {
        weibo: { name: '微博', mark: '微', color: '#ff6b35', soft: '#fff1eb' },
        x: { name: 'X / Twitter', mark: 'X', color: '#1d2129', soft: '#f2f3f5' },
        douyin: { name: '抖音', mark: '抖', color: '#00b8b8', soft: '#e6fbfb' },
        xiaohongshu: { name: '小红书', mark: '红', color: '#ff2442', soft: '#ffecef' },
        instagram: { name: 'Instagram', mark: 'IG', color: '#c13584', soft: '#fbeef7' },
        other: { name: '其他', mark: '·', color: '#86909c', soft: '#f2f3f5' }
    };

    const state = {
        platform: 'all', author: 'all', type: 'all', q: '', sort: 'new', view: 'grid',
        treeQ: '', treeLimit: {}, expanded: {}
    };
    let rootHandle = null;
    let files = [];
    let urls = new Map();
    let previewList = [];
    let previewIndex = -1;
    let zoom = 1, panX = 0, panY = 0;
    let dragging = false, dragStart = null;
    let modalSave = null;

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    const fmtSize = n => {
        if (!n && n !== 0) { return '—'; }
        if (n < 1024) { return n + ' B'; }
        if (n < 1048576) { return (n / 1024).toFixed(1) + ' KB'; }
        if (n < 1073741824) { return (n / 1048576).toFixed(1) + ' MB'; }
        return (n / 1073741824).toFixed(2) + ' GB';
    };
    const fmtDate = t => {
        if (!t) { return '—'; }
        const d = new Date(t);
        const p = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    };
    const platformOf = p => PLATFORM_META[p] || PLATFORM_META.other;

    function normalizePlatform(raw) {
        const s = String(raw || '').toLowerCase();
        if (s.includes('weibo') || s.includes('微博')) { return 'weibo'; }
        if (s === 'x' || s.includes('twitter') || s.includes('推特')) { return 'x'; }
        if (s.includes('douyin') || s.includes('抖音')) { return 'douyin'; }
        if (s.includes('xiaohongshu') || s.includes('xhs') || s.includes('小红书')) { return 'xiaohongshu'; }
        if (s.includes('instagram') || s === 'ig') { return 'instagram'; }
        return 'other';
    }

    function toast(msg) {
        const t = $('#toast');
        t.textContent = msg;
        t.classList.add('on');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => t.classList.remove('on'), 2600);
    }

    /* ---------------- IndexedDB 句柄 ---------------- */
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('vrLibrary', 1);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains('handles')) {
                    req.result.createObjectStore('handles');
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    async function idbGet(key) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('handles', 'readonly');
            const r = tx.objectStore('handles').get(key);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
        });
    }
    async function idbSet(key, value) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('handles', 'readwrite');
            tx.objectStore('handles').put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
    async function idbDel(key) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('handles', 'readwrite');
            tx.objectStore('handles').delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    /** 如果选中的是 Downloads，自动下钻到 video-rod 子目录 */
    async function resolveRoot(handle) {
        if (!handle) { return null; }
        if (handle.name === 'video-rod') { return handle; }
        try {
            const sub = await handle.getDirectoryHandle('video-rod');
            return sub;
        } catch (e) {
            return handle;
        }
    }

    /* ---------------- 扫描 ---------------- */
    function parseAuthor(folder) {
        const s = String(folder || '');
        const m = s.match(/^(.*?)(?:\(@?([^)]+)\))?$/);
        return { author: (m && m[1]) || s || '未分类', authorId: (m && m[2]) || '' };
    }

    function classify(path, name) {
        const parts = path.split('/');
        const lower = parts.map(x => x.toLowerCase());
        const typeAt = lower.indexOf('images') >= 0 ? lower.indexOf('images') :
            (lower.indexOf('videos') >= 0 ? lower.indexOf('videos') : -1);
        const ext = (name.split('.').pop() || '').toLowerCase();
        const kind = IMG_EXT.has(ext) ? 'image' : (VID_EXT.has(ext) ? 'video' : '');
        if (!kind) { return null; }
        let platform = 'other', author = '未分类', authorId = '';
        if (typeAt >= 2) {
            platform = normalizePlatform(parts[typeAt - 2]);
            const a = parseAuthor(parts[typeAt - 1]);
            author = a.author; authorId = a.authorId;
        } else {
            platform = normalizePlatform(parts[0] || '');
            const a = parseAuthor(parts[1] || '');
            author = a.author; authorId = a.authorId;
        }
        return {
            id: path, name, ext, kind,
            title: name.replace(/\.[^.]+$/, ''),
            path, platform, author, authorId,
            platformName: platformOf(platform).name
        };
    }

    async function walk(dir, prefix) {
        let n = 0;
        for await (const [name, handle] of dir.entries()) {
            if (!name || name.startsWith('.') || name === '_index' || name === '_thumbs' || name === '_trash') {
                continue;
            }
            const rel = prefix ? prefix + '/' + name : name;
            if (handle.kind === 'directory') {
                await walk(handle, rel);
            } else {
                const item = classify(rel, name);
                if (!item) { continue; }
                try {
                    const file = await handle.getFile();
                    item.size = file.size;
                    item.lastModified = file.lastModified;
                    item.handle = handle;
                    files.push(item);
                } catch (e) { /* skip unreadable */ }
            }
            if (++n % 40 === 0) {
                await new Promise(r => setTimeout(r, 0));
            }
        }
    }

    async function scan() {
        if (!rootHandle) {
            $('#statusText').textContent = '请选择媒体目录';
            render();
            return;
        }
        try {
            const p = await rootHandle.queryPermission({ mode: 'readwrite' });
            if (p !== 'granted') {
                const req = await rootHandle.requestPermission({ mode: 'readwrite' });
                if (req !== 'granted') { toast('需要目录读写权限'); return; }
            }
        } catch (e) { /* ignore */ }
        $('#statusText').textContent = '正在扫描…';
        $('#syncText').textContent = '正在扫描…';
        revokeUrls();
        files = [];
        try {
            await walk(rootHandle, '');
            files.sort((a, b) => String(b.lastModified || 0).localeCompare(String(a.lastModified || 0)));
            $('#syncText').textContent = '刚刚扫描 · ' + files.length + ' 个文件';
            $('#statusText').textContent = '扫描完成';
            if (!files.length) {
                $('#statusText').textContent = '扫描完成：0 个文件（目录可以正常使用）';
            }
            await writeIndex();
        } catch (e) {
            $('#statusText').textContent = '扫描失败：' + String(e).slice(0, 80);
            toast('扫描失败：' + String(e).slice(0, 80));
        }
        render();
    }

    async function writeIndex() {
        try {
            const dir = await rootHandle.getDirectoryHandle('_index', { create: true });
            const fh = await dir.getFileHandle('index.json', { create: true });
            const w = await fh.createWritable();
            await w.write(JSON.stringify({
                version: 1,
                scannedAt: new Date().toISOString(),
                files: files.map(f => ({
                    id: f.id, name: f.name, title: f.title, kind: f.kind,
                    size: f.size, lastModified: f.lastModified, platform: f.platform,
                    platformName: f.platformName, author: f.author, authorId: f.authorId,
                    path: f.path
                }))
            }, null, 2));
            await w.close();
        } catch (e) { /* index is optional */ }
    }

    function revokeUrls() {
        urls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
        urls.clear();
    }

    async function fileUrl(item) {
        if (urls.has(item.id)) { return urls.get(item.id); }
        const file = await item.handle.getFile();
        const url = URL.createObjectURL(file);
        urls.set(item.id, url);
        return url;
    }

    /* ---------------- 过滤 / 渲染 ---------------- */
    function filtered() {
        let rows = files.filter(f =>
            (state.platform === 'all' || f.platform === state.platform) &&
            (state.author === 'all' || f.author === state.author) &&
            (state.type === 'all' || f.kind === state.type)
        );
        if (state.q) {
            const q = state.q.toLowerCase();
            rows = rows.filter(f => [f.title, f.name, f.author, f.authorId, f.platformName, f.path]
                .join(' ').toLowerCase().includes(q));
        }
        rows.sort((a, b) => {
            if (state.sort === 'size') { return (b.size || 0) - (a.size || 0); }
            if (state.sort === 'name') { return String(a.title).localeCompare(String(b.title), 'zh-CN'); }
            if (state.sort === 'old') { return (a.lastModified || 0) - (b.lastModified || 0); }
            return (b.lastModified || 0) - (a.lastModified || 0);
        });
        return rows;
    }

    function renderTabs() {
        let base = files.filter(f =>
            (state.platform === 'all' || f.platform === state.platform) &&
            (state.author === 'all' || f.author === state.author)
        );
        if (state.q) {
            const q = state.q.toLowerCase();
            base = base.filter(f => [f.title, f.name, f.author, f.authorId, f.platformName, f.path]
                .join(' ').toLowerCase().includes(q));
        }
        const counts = {
            all: base.length,
            image: base.filter(f => f.kind === 'image').length,
            video: base.filter(f => f.kind === 'video').length
        };
        $$('#typeTabs [data-type]').forEach(b => {
            b.classList.toggle('active', b.dataset.type === state.type);
            const n = b.querySelector('b');
            if (n) { n.textContent = counts[b.dataset.type]; }
        });
    }

    function renderTree() {
        const q = state.treeQ.trim().toLowerCase();
        const platforms = {};
        files.forEach(f => {
            platforms[f.platform] = platforms[f.platform] || {};
            const key = f.author + '|' + f.authorId;
            platforms[f.platform][key] = platforms[f.platform][key] || {
                author: f.author, authorId: f.authorId, n: 0, img: 0, vid: 0
            };
            platforms[f.platform][key].n++;
            if (f.kind === 'image') { platforms[f.platform][key].img++; } else { platforms[f.platform][key].vid++; }
        });

        let html = '<button class="tree-node root ' + (state.platform === 'all' ? 'active' : '') + '" data-p="all">' +
            '<span class="twisty"></span><span class="label">🗂 媒体库</span><span class="count">' + files.length + '</span></button>';

        Object.keys(platforms).forEach(pid => {
            const meta = platformOf(pid);
            const authors = Object.values(platforms[pid]);
            if (q && !meta.name.toLowerCase().includes(q) &&
                !authors.some(a => (a.author + a.authorId).toLowerCase().includes(q))) { return; }
            const exp = q || state.expanded[pid] !== false;
            const pActive = state.platform === pid && state.author === 'all';
            html += '<div class="tree-node platform ' + (pActive ? 'active' : '') + '" data-p="' + esc(pid) + '">' +
                '<span class="twisty" data-toggle="' + esc(pid) + '">' + (exp ? '▾' : '▸') + '</span>' +
                '<span class="tree-mark" style="--pc:' + meta.color + ';--pbg:' + meta.soft + '">' + meta.mark + '</span>' +
                '<span class="label">' + esc(meta.name) + '</span><span class="count">' +
                authors.reduce((s, a) => s + a.n, 0) + '</span></div>';
            if (!exp) { return; }
            let list = authors.sort((a, b) => b.n - a.n);
            if (q) { list = list.filter(a => (a.author + a.authorId).toLowerCase().includes(q)); }
            const limit = q ? list.length : (state.treeLimit[pid] || 6);
            list.slice(0, limit).forEach(a => {
                const active = state.platform === pid && state.author === a.author;
                html += '<div class="tree-node author ' + (active ? 'active' : '') + '" data-p="' + esc(pid) +
                    '" data-a="' + esc(a.author) + '"><span class="twisty"></span><span>@</span>' +
                    '<span class="label">' + esc(a.author) + '</span><span class="count">' + a.n + '</span></div>';
                if (!active) { return; }
                html += '<div class="tree-node type ' + (state.type === 'image' ? 'active' : '') +
                    '" data-p="' + esc(pid) + '" data-a="' + esc(a.author) + '" data-t="image">' +
                    '<span class="twisty"></span><span class="label">▣ 图片</span><span class="count">' + a.img + '</span></div>';
                html += '<div class="tree-node type ' + (state.type === 'video' ? 'active' : '') +
                    '" data-p="' + esc(pid) + '" data-a="' + esc(a.author) + '" data-t="video">' +
                    '<span class="twisty"></span><span class="label">▶ 视频</span><span class="count">' + a.vid + '</span></div>';
            });
            if (list.length > limit) {
                html += '<button class="tree-more" data-more="' + esc(pid) + '">显示更多 ' + (list.length - limit) + ' 位博主…</button>';
            }
        });
        $('#tree').innerHTML = html;
        $('#sidebarCount').textContent = files.length;
        $('#sidebarSize').textContent = fmtSize(files.reduce((s, f) => s + (f.size || 0), 0));
        $('#storageBar').style.width = files.length ? '34%' : '0%';
    }

    function renderHeader(rows) {
        let title = '媒体库';
        if (state.author !== 'all') { title = state.author; }
        else if (state.platform !== 'all') { title = platformOf(state.platform).name; }
        $('#pageTitle').textContent = title;

        const crumbs = ['媒体库'];
        if (state.platform !== 'all') { crumbs.push(platformOf(state.platform).name); }
        if (state.author !== 'all') { crumbs.push(state.author); }
        if (state.type !== 'all') { crumbs.push(state.type === 'image' ? '图片' : '视频'); }
        $('#breadcrumb').innerHTML = crumbs.map((c, i) =>
            '<span class="' + (i === crumbs.length - 1 ? 'last' : '') + '">' + esc(c) + '</span>'
        ).join('<span class="sep">/</span>');

        $('#pageSub').textContent = (state.q ? '搜索「' + state.q + '」· ' : '') +
            '共 ' + rows.length + ' 个素材 · ' + (files.length ? '来自当前目录' : '请选择媒体目录');
        $('#statCount').textContent = rows.length;
        $('#statImages').textContent = rows.filter(f => f.kind === 'image').length;
        $('#statVideos').textContent = rows.filter(f => f.kind === 'video').length;
        $('#statSize').textContent = fmtSize(rows.reduce((s, f) => s + (f.size || 0), 0));

        const chips = [];
        if (state.platform !== 'all') {
            chips.push('<button class="chip" data-clear="platform">平台：' + esc(platformOf(state.platform).name) + ' ×</button>');
        }
        if (state.author !== 'all') {
            chips.push('<button class="chip" data-clear="author">博主：' + esc(state.author) + ' ×</button>');
        }
        if (state.q) {
            chips.push('<button class="chip" data-clear="q">搜索：' + esc(state.q) + ' ×</button>');
        }
        $('#chips').innerHTML = chips.join('');
    }

    function cardHTML(f) {
        const meta = platformOf(f.platform);
        const isVideo = f.kind === 'video';
        return '<article class="card" data-id="' + esc(f.id) + '" data-platform="' + esc(f.platform) + '">' +
            '<div class="thumb">' +
            (isVideo
                ? '<div class="videoThumb" style="background:linear-gradient(135deg,' + meta.color + ',#0f172a)">▶</div>'
                : '<img alt="' + esc(f.title) + '" loading="lazy">') +
            '<span class="badge">' + (isVideo ? '视频' : '图片') + '</span>' +
            '<div class="play"><span>' + (isVideo ? '▶' : '⤢') + '</span></div>' +
            '</div>' +
            '<div class="body">' +
            '<div class="title" title="' + esc(f.title) + '">' + esc(f.title) + '</div>' +
            '<div class="sub">' + esc(f.platformName) + ' · ' + esc(f.authorId ? '@' + f.authorId : '') + '</div>' +
            '<div class="metarow"><span class="author"><span class="avatar">' +
            esc((f.author || '?').slice(0, 1)) + '</span>' + esc(f.author) + '</span><span>' + fmtSize(f.size) + '</span></div>' +
            '<div class="path">' + esc(f.path) + '</div>' +
            '</div></article>';
    }

    function renderGrid(rows) {
        const grid = $('#grid');
        grid.classList.toggle('list', state.view === 'list');
        grid.innerHTML = rows.map(cardHTML).join('');
        $('#empty').classList.toggle('hidden', rows.length > 0);
        grid.classList.toggle('hidden', rows.length === 0);

        rows.forEach(f => {
            if (f.kind !== 'image') { return; }
            const card = grid.querySelector('[data-id="' + CSS.escape(f.id) + '"]');
            if (!card) { return; }
            const img = card.querySelector('img');
            fileUrl(f).then(url => { if (img) { img.src = url; } }).catch(() => {});
        });
    }

    function render() {
        const rows = filtered();
        renderTree();
        renderTabs();
        renderHeader(rows);
        renderGrid(rows);
    }

    /* ---------------- 预览 ---------------- */
    function cur() { return previewList[previewIndex] || null; }
    function applyZoom() {
        const img = $('#pvImg');
        img.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
    }
    function showPreview(show) {
        $('#preview').classList.toggle('hidden', !show);
        document.body.style.overflow = show ? 'hidden' : '';
    }
    function closePreview() {
        $('#pvVideo').pause();
        showPreview(false);
        if (location.hash) { location.hash = ''; }
    }
    function step(dir) {
        const at = previewIndex;
        const n = at + dir;
        if (n < 0 || n >= previewList.length) { return; }
        location.hash = 'preview=' + encodeURIComponent(previewList[n].id);
    }
    function albumStep(dir) {
        const d = cur();
        if (!d || d.kind !== 'image') { return; }
        const album = previewList.filter(f => f.kind === 'image' && f.platform === d.platform && f.author === d.author);
        const at = album.findIndex(f => f.id === d.id);
        const n = at + dir;
        if (at >= 0 && n >= 0 && n < album.length) {
            location.hash = 'preview=' + encodeURIComponent(album[n].id);
        }
    }
    async function renderPreview() {
        const d = cur();
        if (!d) { closePreview(); return; }
        $('#pvCrumb').textContent = ['媒体库', platformOf(d.platform).name, d.author, d.kind === 'image' ? '图片' : '视频'].join(' / ');
        $('#pvCount').textContent = (previewIndex + 1) + ' / ' + previewList.length;
        $('#pvPrev').disabled = previewIndex <= 0;
        $('#pvNext').disabled = previewIndex >= previewList.length - 1;
        $('#pvEyebrow').textContent = (d.kind === 'image' ? '图片' : '视频') + ' · ' + d.platformName;
        $('#pvTitle').textContent = d.title;
        $('#pvAvatar').textContent = (d.author || '?').slice(0, 1);
        $('#pvAuthor').textContent = d.author + (d.authorId ? ' (@' + d.authorId + ')' : '');
        $('#pvMeta').innerHTML =
            '<div>平台<b>' + esc(d.platformName) + '</b></div>' +
            '<div>类型<b>' + (d.kind === 'image' ? '图片' : '视频') + '</b></div>' +
            '<div>大小<b>' + fmtSize(d.size) + '</b></div>' +
            '<div>保存时间<b>' + fmtDate(d.lastModified) + '</b></div>';
        $('#pvPath').textContent = d.path;
        $('#pvType').textContent = d.kind === 'image' ? '图片预览' : '视频预览';
        const img = $('#pvImg'), video = $('#pvVideo');
        video.pause();
        if (d.kind === 'video') {
            img.classList.add('hidden');
            video.classList.remove('hidden');
            video.src = await fileUrl(d);
        } else {
            video.classList.add('hidden');
            video.removeAttribute('src');
            img.classList.remove('hidden');
            img.src = await fileUrl(d);
            zoom = 1; panX = 0; panY = 0; applyZoom();
        }
        renderFilm();
    }
    async function renderFilm() {
        const film = $('#pvFilm');
        film.innerHTML = previewList.map((f, i) => {
            const active = i === previewIndex;
            return '<button class="pv-filmItem ' + (active ? 'active' : '') + '" data-index="' + i + '">' +
                (f.kind === 'image' ? '<img alt="">' : '<span class="fplay">▶</span>') +
                '<span>' + (f.kind === 'image' ? '图片' : '视频') + '</span></button>';
        }).join('');
        const items = previewList.filter(f => f.kind === 'image');
        for (let i = 0; i < previewList.length; i++) {
            const f = previewList[i];
            if (f.kind !== 'image') { continue; }
            const btn = film.querySelector('[data-index="' + i + '"] img');
            if (!btn) { continue; }
            fileUrl(f).then(url => { btn.src = url; }).catch(() => {});
        }
        const active = film.querySelector('.pv-filmItem.active');
        if (active) { active.scrollIntoView({ block: 'nearest', inline: 'center' }); }
    }
    function route() {
        const m = location.hash.match(/^#preview=(.+)$/);
        if (!m) { closePreview(); return; }
        const id = decodeURIComponent(m[1]);
        previewList = filtered();
        previewIndex = previewList.findIndex(f => f.id === id);
        if (previewIndex < 0) { closePreview(); return; }
        showPreview(true);
        renderPreview();
    }
    function openPreview(id) {
        location.hash = 'preview=' + encodeURIComponent(id);
        route();
    }

    /* ---------------- CRUD ---------------- */
    function openModal(title, value, cb) {
        $('#modalTitle').textContent = title;
        $('#modalInput').value = value || '';
        modalSave = cb;
        $('#modal').classList.remove('hidden');
        setTimeout(() => $('#modalInput').focus(), 30);
    }
    function closeModal() {
        $('#modal').classList.add('hidden');
        modalSave = null;
    }
    async function rename(item) {
        if (!item || !item.handle || typeof item.handle.move !== 'function') {
            toast('当前浏览器不支持重命名');
            return;
        }
        openModal('重命名', item.name, async () => {
            const v = $('#modalInput').value.trim();
            if (!v || v === item.name) { closeModal(); return; }
            try {
                const h = await item.handle.move(v);
                item.handle = h;
                item.name = h.name;
                item.title = h.name.replace(/\.[^.]+$/, '');
                closeModal();
                toast('已重命名');
                closePreview();
                await scan();
            } catch (e) {
                toast('重命名失败：' + String(e).slice(0, 80));
            }
        });
    }
    async function trash(item) {
        if (!item || !item.handle || typeof item.handle.move !== 'function') {
            toast('当前浏览器不支持移动文件');
            return;
        }
        if (!confirm('把「' + item.title + '」移到 _trash/？')) { return; }
        try {
            const dir = await rootHandle.getDirectoryHandle('_trash', { create: true });
            await item.handle.move(dir, Date.now() + '_' + item.name);
            closePreview();
            toast('已移到回收站');
            await scan();
        } catch (e) {
            toast('删除失败：' + String(e).slice(0, 80));
        }
    }

    /* ---------------- 事件 ---------------- */
    async function pickRoot() {
        if (!window.showDirectoryPicker) {
            toast('当前浏览器不支持目录选择');
            return;
        }
        try {
            $('#statusText').textContent = '正在等待系统目录窗口…';
            try { window.focus(); } catch (e) { /* ignore */ }
            const picked = await window.showDirectoryPicker({
                mode: 'readwrite',
                startIn: rootHandle || 'downloads'
            });
            const perm = await picked.requestPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
                $('#statusText').textContent = '目录读写权限未授予；请重新选择';
                toast('需要读写权限才能管理媒体库');
                return;
            }
            rootHandle = await resolveRoot(picked);
            await idbSet('root', rootHandle);
            $('#rootPath').textContent = rootHandle.name;
            await scan();
        } catch (e) {
            if (e && e.name === 'AbortError') {
                $('#statusText').textContent = '已取消目录选择';
            } else {
                $('#statusText').textContent = '目录选择失败：' + String(e).slice(0, 80);
                toast('目录选择失败：' + String(e).slice(0, 80));
            }
        }
    }

    $('#pickBtn').addEventListener('click', pickRoot);
    $('#rootBtn').addEventListener('click', pickRoot);
    $('#resetRoot').addEventListener('click', async () => {
        if (!confirm('重置媒体库目录？之后需要重新选择 Downloads/video-rod。')) { return; }
        try { await idbDel('root'); } catch (e) { /* ignore */ }
        rootHandle = null;
        files = [];
        revokeUrls();
        $('#rootPath').textContent = '选择媒体目录';
        $('#statusText').textContent = '请选择 Downloads/video-rod';
        $('#syncText').textContent = '尚未扫描';
        render();
    });
    $('#rescanBtn').addEventListener('click', scan);
    $('#search').addEventListener('input', e => { state.q = e.target.value.trim(); render(); });
    $('#treeSearch').addEventListener('input', e => { state.treeQ = e.target.value; render(); });
    $('#sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
    $('#typeTabs').addEventListener('click', e => {
        const b = e.target.closest('[data-type]');
        if (!b) { return; }
        state.type = b.dataset.type;
        render();
    });
    $('#chips').addEventListener('click', e => {
        const b = e.target.closest('[data-clear]');
        if (!b) { return; }
        const k = b.dataset.clear;
        if (k === 'q') { state.q = ''; $('#search').value = ''; }
        else { state[k] = 'all'; }
        render();
    });
    $('#tree').addEventListener('click', e => {
        const more = e.target.closest('[data-more]');
        if (more) {
            state.treeLimit[more.dataset.more] = (state.treeLimit[more.dataset.more] || 6) + 12;
            render();
            return;
        }
        const tgl = e.target.closest('[data-toggle]');
        if (tgl) {
            state.expanded[tgl.dataset.toggle] = state.expanded[tgl.dataset.toggle] === false;
            render();
            return;
        }
        const n = e.target.closest('.tree-node');
        if (!n) { return; }
        const p = n.dataset.p, a = n.dataset.a, ty = n.dataset.t;
        if (p === 'all') { state.platform = 'all'; state.author = 'all'; state.type = 'all'; }
        else {
            state.platform = p;
            state.expanded[p] = true;
            state.author = a || 'all';
            state.type = ty || 'all';
        }
        render();
    });
    $$('.viewtoggle button').forEach(b => b.addEventListener('click', () => {
        state.view = b.dataset.view;
        $$('.viewtoggle button').forEach(x => x.classList.toggle('active', x === b));
        render();
    }));
    $('#grid').addEventListener('click', e => {
        const card = e.target.closest('.card');
        if (card) { openPreview(card.dataset.id); }
    });
    $('#pvBack').addEventListener('click', closePreview);
    $('#pvClose').addEventListener('click', closePreview);
    $('#pvPrev').addEventListener('click', () => step(-1));
    $('#pvNext').addEventListener('click', () => step(1));
    $('#pvFilm').addEventListener('click', e => {
        const b = e.target.closest('[data-index]');
        if (!b) { return; }
        const f = previewList[Number(b.dataset.index)];
        if (f) { location.hash = 'preview=' + encodeURIComponent(f.id); }
    });
    $('#pvInfoBtn').addEventListener('click', () => $('#pvBody').classList.toggle('no-info'));
    $('#pvFullBtn').addEventListener('click', () => {
        const p = $('#preview');
        if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); }
        else if (p.requestFullscreen) { p.requestFullscreen().catch(() => {}); }
    });
    $('#pvHelpBtn').addEventListener('click', () => toast('↑↓ 切换媒体；←→ 视频进度/图片同专辑；Space 播放；F 全屏；Esc 返回'));
    $('#pvRename').addEventListener('click', () => rename(cur()));
    $('#pvDelete').addEventListener('click', () => trash(cur()));
    $('#pvReveal').addEventListener('click', () => toast('请在系统资源管理器中打开：' + (cur() ? cur().path : '')));
    $('#modalCancel').addEventListener('click', closeModal);
    $('#modalSave').addEventListener('click', () => { if (modalSave) { modalSave(); } });
    $('#modal').addEventListener('click', e => { if (e.target === $('#modal')) { closeModal(); } });
    $('#pvStage').addEventListener('wheel', e => {
        if (!cur() || cur().kind !== 'image') { return; }
        e.preventDefault();
        zoom = Math.max(.4, Math.min(4, zoom + (e.deltaY < 0 ? .12 : -.12)));
        applyZoom();
    }, { passive: false });
    $('#pvImg').addEventListener('dblclick', () => {
        if (!cur() || cur().kind !== 'image') { return; }
        zoom = zoom > 1 ? 1 : 2; panX = 0; panY = 0; applyZoom();
    });
    $('#pvImg').addEventListener('mousedown', e => {
        if (!cur() || cur().kind !== 'image' || zoom <= 1) { return; }
        dragging = true; dragStart = { x: e.clientX, y: e.clientY, px: panX, py: panY };
        $('#pvImg').classList.add('dragging');
    });
    window.addEventListener('mousemove', e => {
        if (!dragging || !dragStart) { return; }
        panX = dragStart.px + e.clientX - dragStart.x;
        panY = dragStart.py + e.clientY - dragStart.y;
        applyZoom();
    });
    window.addEventListener('mouseup', () => {
        dragging = false; dragStart = null; $('#pvImg').classList.remove('dragging');
    });
    document.addEventListener('keydown', e => {
        if ($('#preview').classList.contains('hidden')) { return; }
        if (!$('#modal').classList.contains('hidden')) {
            if (e.key === 'Escape') { closeModal(); }
            return;
        }
        const d = cur();
        if (e.key === 'Escape') { e.preventDefault(); closePreview(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); step(1); return; }
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            if (d && d.kind === 'video') { $('#pvVideo').currentTime = Math.max(0, $('#pvVideo').currentTime - 5); }
            else { albumStep(-1); }
            return;
        }
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            if (d && d.kind === 'video') { $('#pvVideo').currentTime = Math.min($('#pvVideo').duration || 0, $('#pvVideo').currentTime + 5); }
            else { albumStep(1); }
            return;
        }
        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            if (d && d.kind === 'video') { $('#pvVideo').paused ? $('#pvVideo').play() : $('#pvVideo').pause(); }
            return;
        }
        if (e.key === 'm' || e.key === 'M') { $('#pvVideo').muted = !$('#pvVideo').muted; }
        if (e.key === 'f' || e.key === 'F') { $('#pvFullBtn').click(); }
        if (e.key === 'i' || e.key === 'I') { $('#pvBody').classList.toggle('no-info'); }
        if (e.key === '+' || e.key === '=') { zoom = Math.min(4, zoom + .2); applyZoom(); }
        if (e.key === '-') { zoom = Math.max(.4, zoom - .2); applyZoom(); }
        if (e.key === '0') { zoom = 1; panX = 0; panY = 0; applyZoom(); }
    });
    window.addEventListener('hashchange', route);
    window.addEventListener('beforeunload', revokeUrls);

    /* ---------------- 启动 ---------------- */
    (async () => {
        try {
            const h = await idbGet('root');
            if (h) {
                rootHandle = await resolveRoot(h);
                if (rootHandle !== h) { await idbSet('root', rootHandle); }
                $('#rootPath').textContent = rootHandle.name;
                try {
                    const p = await rootHandle.queryPermission({ mode: 'readwrite' });
                    if (p === 'granted') { await scan(); }
                    else { $('#statusText').textContent = '目录权限已失效，请重新选择'; }
                } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ignore */ }
        render();
        route();
    })();
})();
