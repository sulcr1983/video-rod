/**
 * 钓鱼竿 video-rod — X(推特) 推文内联下载按钮（M8 v1）
 * 只在 x.com / twitter.com 注入；独立模块，不碰猫抓 content-script.js
 *
 * 原理（ADR 后补）：
 *   1. 观察 article 出现，带 video 的推文在操作栏 [role="group"] 注入下载按钮
 *   2. 点击 → 从 video.poster 提取媒体 ID（*_thumb/<id>/，与嗅探 URL 的媒体 ID 同源）
 *   3. 发消息给后台，在嗅探缓存里匹配含此 ID 的媒体：
 *      优先完整渐进式 MP4（/vid/avc1/0/0/，X 播放器必请求，有声音有画面），
 *      无则最高分辨率视频轨 m3u8（打开猫抓 m3u8.html 解析页兜底）
 *   4. 文件名：naming.js 按 article 作用域提取 作者/正文 → 模板起名
 *   5. 页面只传媒体 ID 和文件名，URL 一律从后台嗅探缓存取——页面无法借道下载任意地址
 */
(() => {
    if (window.__vrXButton) { return; }
    window.__vrXButton = true;

    const N = self.VideoRodNaming;
    if (!N) { return; }

    /* ---------- 设置（与面板设置视图同一份 vrSettings） ---------- */
    let settings = { defaultDir: 'video-rod', template: '${author}_${title}' };
    chrome.storage.local.get('vrSettings', res => {
        if (res && res.vrSettings) { settings = Object.assign(settings, res.vrSettings); }
    });
    chrome.storage.onChanged.addListener((ch, area) => {
        if (area == 'local' && ch.vrSettings) {
            settings = Object.assign(settings, ch.vrSettings.newValue || {});
        }
    });

    /* ---------- 按钮 ---------- */
    const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
        '<path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
    const STYLE = document.createElement('style');
    STYLE.textContent = [
        '.vr-xbtn-wrap{display:flex;align-items:center;justify-content:center;margin-left:4px}',
        '.vr-xbtn{height:32px;min-width:42px;border:none;border-radius:999px;',
        'background:linear-gradient(135deg,#1d9bf0,#0a7bd1);color:#fff;cursor:pointer;',
        'display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:0 10px;',
        'box-shadow:0 2px 8px rgba(29,155,240,.32);transition:background .15s,box-shadow .15s,opacity .15s;',
        'font:600 12px/1 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;white-space:nowrap}',
        '.vr-xbtn svg{width:16px;height:16px;pointer-events:none;flex:0 0 16px}',
        '.vr-xbtn span{pointer-events:none}',
        '.vr-xbtn:hover{background:linear-gradient(135deg,#1a8cd8,#0868b4);box-shadow:0 3px 10px rgba(29,155,240,.42)}',
        '.vr-xbtn.vr-busy{opacity:.65;pointer-events:none}',
        '.vr-xbtn.vr-done{background:#00ba7c;box-shadow:0 2px 8px rgba(0,186,124,.32)}',
        '.vr-xbtn.vr-warn{background:#f4212e;box-shadow:0 2px 8px rgba(244,33,46,.32)}'
    ].join('');
    document.documentElement.appendChild(STYLE);

    /* ---------- 提取 ---------- */
    function mediaIdFromArticle(article) {
        const v = article.querySelector('video');
        const poster = v ? (v.poster || '') : '';
        // 多数视频封面是 amplify_video_thumb/<数字ID>/；也有 pbs.twimg.com/media/<字母数字ID>.jpg
        const m = poster.match(/(?:thumb|video)\/(\d{8,})\//) ||
            poster.match(/\/media\/([A-Za-z0-9_-]{8,})\./);
        return m ? m[1] : '';
    }

    /** 推文坐标：作者 handle + 推文 id（从推文自身的时间戳链接取） */
    function tweetRef(article) {
        const a = article.querySelector('a[href*="/status/"]');
        if (!a) { return null; }
        const m = (a.getAttribute('href') || '').match(/\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,})/);
        return m ? { user: m[1], statusId: m[2] } : null;
    }

    function tweetInfo(article) {
        try {
            // extractTwitter 接受任意带 querySelector 的对象 → article 元素即作用域
            const info = N.extractTwitter(article, 'x.com');
            return {
                authorFull: N.buildAuthorFull(info.author, info.authorId),
                title: info.title || info.post || ''
            };
        } catch (e) { return { authorFull: '', title: '' }; }
    }

    function buildFilename(article, ext) {
        const i = tweetInfo(article);
        const name = N.buildNameFromInfo(
            { title: i.title, post: i.title, authorFull: i.authorFull, site: 'x' },
            'https://x.com/', { tpl: settings.template, ext: ext });
        const dir = String(settings.defaultDir || 'video-rod')
            .replace(/[<>:"|?*\\]/g, '').replace(/^\/+|\/+$/g, '') || 'video-rod';
        const author = String(i.authorFull || 'x')
            .replace(/[<>:"/\\|?*]/g, '_').trim().slice(0, 60) || 'x';
        return dir + '/x/' + author + '/videos/' + name;
    }

    /* ---------- 交互 ---------- */
    function flash(btn, state) {
        btn.classList.add('vr-' + state);
        setTimeout(() => btn.classList.remove('vr-' + state), 1800);
    }

    function makeButton(article) {
        const wrap = document.createElement('div');
        wrap.className = 'vr-xbtn-wrap';
        wrap.setAttribute('data-vr-xbtn', '1');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vr-xbtn';
        btn.setAttribute('aria-label', '钓鱼竿下载此视频');
        btn.title = '钓鱼竿：下载这个视频';
        btn.innerHTML = ICON + '<span>下载</span>';
        wrap.appendChild(btn);

        function setLabel(text) {
            const span = btn.querySelector('span');
            if (span) { span.textContent = text; }
        }

        btn.addEventListener('click', ev => {
            ev.stopPropagation();
            ev.preventDefault();
            if (btn.classList.contains('vr-busy')) { return; }
            const mediaId = mediaIdFromArticle(article);
            const ref = tweetRef(article);
            if (!ref) { flash(btn, 'warn'); setLabel('失败'); return; }
            const filename = buildFilename(article, 'mp4');
            btn.classList.add('vr-busy');
            setLabel('下载中…');
            chrome.runtime.sendMessage(
                {
                    Message: 'vrQuickDownX',
                    user: ref.user, statusId: ref.statusId, mediaId: mediaId,
                    filename: filename,
                    // 按钮一键 = 最高画质（XBD 同款手感）；省流档位留给面板里的批量下载设置
                    wantBest: true
                },
                res => {
                    btn.classList.remove('vr-busy');
                    if (chrome.runtime.lastError || !res) {
                        flash(btn, 'warn'); setLabel('失败');
                        setTimeout(() => setLabel('下载'), 2200);
                        return;
                    }
                    if (res.ok) {
                        flash(btn, res.skipped ? 'link' : (res.kind == 'mp4' ? 'done' : 'link'));
                        setLabel(res.skipped ? '已存在' : '已保存');
                    } else {
                        flash(btn, 'warn');
                        setLabel('失败');
                    }
                    setTimeout(() => setLabel('下载'), 2200);
                });
        });
        return wrap;
    }

    /* ---------- 注入 ---------- */
    function inject(article) {
        if (article.querySelector('.vr-xbtn')) { return; }
        const group = article.querySelector('[role="group"]');
        if (!group) { return; }
        // 只给带视频的推文注入；图片推文走右键秒存/抓图
        if (!article.querySelector('video')) { return; }
        group.appendChild(makeButton(article));
    }

    let timer = null;
    function scan() {
        timer = null;
        try {
            document.querySelectorAll('article').forEach(inject);
        } catch (e) { /* DOM 抖动，下轮再试 */ }
    }
    const mo = new MutationObserver(() => {
        if (timer) { return; }
        timer = setTimeout(scan, 250);      // X 时间线滚动频繁，debounce
    });
    mo.observe(document.body, { childList: true, subtree: true });
    scan();
})();
