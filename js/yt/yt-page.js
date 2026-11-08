/**
 * 苏哥的钓鱼竿：YouTube 页面注入
 *
 * 职责只有三件：认出这是哪个视频、在播放器下面放一个按钮、点了把活交给扩展页。
 * 真正的下载逻辑不在这里（内容脚本拿不到 googlevideo 的响应，也不方便在内存里合轨）。
 *
 * 注入用的是 Shadow DOM：YouTube 的全局 CSS 又长又霸道，直接插 DOM 容易被它的
 * 选择器改样式；Shadow 边界一隔，两边互不干扰，顺带也不用给样式加前缀。
 *
 * 锚点策略抄 Tubly 的多候选降级：先找 #below（播放器正下方），没有再退
 * ytd-watch-metadata，两个都没有就说明页面结构变了，安静退出不报错。
 */
(function () {
    'use strict';

    var HOST_ID = 'vr-yt-dl-host';
    var BTN_ID = 'vr-yt-dl-btn';
    var lastVideoId = '';

    function currentVideoId() {
        try {
            var u = new URL(location.href);
            if (u.pathname === '/watch') { return u.searchParams.get('v') || ''; }
            var m = u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{6,})/);
            if (m) { return m[1]; }
        } catch (e) { /* 忽略 */ }
        return '';
    }

    function pageMeta() {
        var title = '';
        var author = '';
        var authorId = '';
        try {
            var t = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string');
            title = (t && t.textContent || document.title || '').replace(/\s*-\s*YouTube\s*$/, '').trim();
            // 元数据还没渲染出来时 document.title 会退化成「YouTube」，别把这个当标题
            if (title === 'YouTube') { title = ''; }
            var a = document.querySelector('#owner #channel-name a, ytd-channel-name a');
            author = (a && a.textContent || '').trim();
            // 频道 @handle：资源库要用「昵称(@账号)」当博主目录
            var href = (a && a.getAttribute('href')) || '';
            var m = href.match(/^\/(@[\w.\-]+)/) || href.match(/^\/channel\/([\w\-]+)/);
            if (m) { authorId = m[1]; }
        } catch (e) { /* 忽略 */ }
        return { title: title, author: author, authorId: authorId };
    }

    function makeButton(floating) {
        var host = document.createElement('div');
        host.id = HOST_ID;
        host.style.cssText = floating
            // Shorts 没有「播放器下方」这种位置，改右下角悬浮，不参与页面布局
            ? 'position:fixed;right:16px;bottom:96px;z-index:2147483000;display:block;'
            : 'display:block;margin:8px 0 4px;';

        var root = host.attachShadow({ mode: 'open' });
        root.innerHTML =
            '<style>' +
            ':host{all:initial}' +
            '.wrap{display:flex;align-items:center;gap:10px;font:500 13px/1.4 ' +
            '-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}' +
            'button{' +
            'display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 16px;' +
            'border:0;border-radius:18px;cursor:pointer;color:#fff;font:600 13px/1 inherit;' +
            'background:#2563eb;transition:background .15s;}' +
            'button:hover{background:#1d4ed8}' +
            'button:active{background:#1e40af}' +
            'button[disabled]{background:#94a3b8;cursor:default}' +
            '.ico{width:16px;height:16px;flex:0 0 16px}' +
            '.tip{color:#606060;font-size:12px;font-weight:400}' +
            '</style>' +
            '<div class="wrap">' +
            '<button id="' + BTN_ID + '" type="button">' +
            '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/></svg>' +
            '<span>下载</span></button>' +
            '<span class="tip">苏哥的钓鱼竿 · 画质不设限</span>' +
            '</div>';

        var btn = root.getElementById(BTN_ID);
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var vid = currentVideoId();
            if (!vid) {
                btn.querySelector('span').textContent = '认不出视频';
                return;
            }
            var meta = pageMeta();
            btn.disabled = true;
            btn.querySelector('span').textContent = '开始下载…';
            try {
                chrome.runtime.sendMessage({
                    Message: 'ytOpen',
                    videoId: vid,
                    title: meta.title,
                    author: meta.author,
                    authorId: meta.authorId,
                    pageUrl: location.href
                }, function (res) {
                    btn.disabled = false;
                    var ok = res && res.ok;
                    btn.querySelector('span').textContent = ok ? '已开始' : '启动失败';
                    setTimeout(function () {
                        btn.querySelector('span').textContent = '下载';
                    }, 1800);
                });
            } catch (err) {
                btn.disabled = false;
                btn.querySelector('span').textContent = '扩展未就绪';
            }
        });
        return host;
    }

    function ensureButton() {
        var vid = currentVideoId();
        if (!vid) {
            var old = document.getElementById(HOST_ID);
            if (old) { old.remove(); }
            lastVideoId = '';
            return;
        }
        var exist = document.getElementById(HOST_ID);
        if (exist) {
            if (lastVideoId === vid) { return; }
            exist.remove();     // 换视频了，挪到新位置
        }

        // Shorts：没有 #below，也没有稳定的元数据区，直接右下角悬浮
        if (/^\/shorts\//.test(location.pathname)) {
            document.body.appendChild(makeButton(true));
            lastVideoId = vid;
            return;
        }

        var anchors = [
            ['#below', 'afterbegin'],
            ['ytd-watch-metadata', 'beforebegin'],
            ['#above-the-fold', 'afterend']
        ];
        for (var i = 0; i < anchors.length; i++) {
            var box = document.querySelector(anchors[i][0]);
            if (box) {
                box.insertAdjacentElement(anchors[i][1], makeButton(false));
                lastVideoId = vid;
                return;
            }
        }
        // 兜底：Shorts 形态 / 新版布局没有 #below 等锚点时，按钮会整个消失
        // （2026-11-05 watch 页实测）。改成右下角悬浮，保证「有视频就有入口」。
        try {
            document.body.appendChild(makeButton(true));
            lastVideoId = vid;
        } catch (e) { /* 页面结构异常不影响观看 */ }
    }

    // SPA 导航 + DOM 变动，双保险
    var pending = null;
    function schedule() {
        if (pending) { return; }
        pending = setTimeout(function () {
            pending = null;
            try { ensureButton(); } catch (e) { /* 页面结构异常不影响观看 */ }
        }, 400);
    }

    window.addEventListener('yt-navigate-finish', schedule, true);
    window.addEventListener('yt-page-data-updated', schedule, true);
    document.addEventListener('DOMContentLoaded', schedule, true);

    var mo = new MutationObserver(schedule);
    try {
        mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* 忽略 */ }

    /** HTML 转义：浮层要渲染 YouTube 标题，直接塞进 innerHTML 会被注入。 */
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /* ---------- 后台合并进度浮层（右下角，苏哥 2026-11-05） ----------
     * 2026-11-08 起不再只是「进度条」：还要让用户选清晰度、看容量、能取消。
     * 原来 .box 是 pointer-events:none，点不动任何东西。 */
    var PROG_ID = 'vr-yt-prog-host';
    var progRoot = null;
    var progTimer = 0;
    function ensureProg() {
        var h = document.getElementById(PROG_ID);
        if (!h) {
            h = document.createElement('div');
            h.id = PROG_ID;
            document.body.appendChild(h);
        }
        if (!h.shadowRoot) {
            var r = h.attachShadow({ mode: 'open' });
            r.innerHTML =
                '<style>' +
                '.box{position:fixed;right:18px;bottom:18px;z-index:2147483000;width:292px;' +
                'padding:12px 14px;border-radius:12px;background:#191715;color:#EFEAE0;' +
                'border:1px solid #2B2620;box-shadow:0 12px 36px rgba(0,0,0,.6);' +
                'font:12px/1.5 "Noto Sans SC",system-ui,sans-serif;opacity:0;transform:translateY(8px);' +
                'transition:opacity .2s,transform .2s;pointer-events:none}' +
                '.box.on{opacity:1;transform:none;pointer-events:auto}' +
                '.hd{display:flex;align-items:center;gap:8px;margin-bottom:6px}' +
                '.tt{flex:1;min-width:0;font-size:12px;font-weight:600;color:#EFEAE0;' +
                'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
                '.x{flex:0 0 auto;border:0;background:transparent;color:#8B8175;cursor:pointer;' +
                'font-size:15px;line-height:1;padding:0 2px}' +
                '.x:hover{color:#EFEAE0}' +
                '.t{font-size:11px;color:#BDB3A6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
                '.t.ok{color:#4FBF8B}.t.err{color:#E86466}.t.warn{color:#E8B04B}' +
                '.bar{height:4px;margin-top:8px;border-radius:2px;background:#2B2620;overflow:hidden}' +
                '.bar.hide{display:none}' +
                '.bar i{display:block;height:100%;width:0;background:#E8B04B;transition:width .25s}' +
                '.opts{display:flex;flex-direction:column;gap:5px;margin-top:9px;' +
                'max-height:212px;overflow-y:auto}' +
                '.opts:empty{display:none}' +
                '.opt{display:flex;align-items:center;justify-content:space-between;gap:10px;' +
                'padding:7px 10px;border-radius:8px;border:1px solid #2B2620;background:#211E1A;' +
                'color:#EFEAE0;font:inherit;cursor:pointer;text-align:left;width:100%}' +
                '.opt:hover{border-color:#E8B04B;background:#2B2620}' +
                '.opt .q{font-weight:600;display:flex;align-items:center;gap:6px}' +
                '.opt .sz{color:#9C9286;font-size:11px;white-space:nowrap;flex:0 0 auto}' +
                '.opt .bd{font-size:10px;color:#E8B04B;border:1px solid #4A4235;' +
                'border-radius:5px;padding:0 4px;font-weight:400}' +
                '.ft{margin-top:9px;display:none}' +
                '.ft.on{display:block}' +
                '.cancel{width:100%;padding:7px 0;border-radius:8px;border:1px solid #4A2B2B;' +
                'background:#2A1A1A;color:#E86466;font:inherit;font-weight:600;cursor:pointer}' +
                '.cancel:hover{background:#352020}' +
                '</style>' +
                '<div class="box" id="box">' +
                '<div class="hd"><span class="tt" id="tt">苏哥的钓鱼竿</span>' +
                '<button class="x" id="x" type="button" title="关闭">×</button></div>' +
                '<div class="t" id="t"></div>' +
                '<div class="bar hide" id="bar"><i id="i"></i></div>' +
                '<div class="opts" id="opts"></div>' +
                '<div class="ft" id="ft">' +
                '<button class="cancel" id="cancel" type="button">取消下载</button></div>' +
                '</div>';
        }
        progRoot = h.shadowRoot;
        return progRoot;
    }
    /* 绑定一次事件：档位点击 / 取消 / 关闭。
     * 每次 ensureProg 只绑一次（shadowRoot 存在即复用）。 */
    var progBound = false;
    /* 最近一次收到的档位列表：下载失败/取消后浮层要能恢复出选项，
     * 否则用户只能关掉浮层再回页面重新点一次「下载」。 */
    var lastOptions = null;
    function bindProg(r) {
        if (progBound) { return; }
        progBound = true;
        try {
            r.getElementById('x').addEventListener('click', function () {
                var b = r.getElementById('box');
                if (b) { b.classList.remove('on'); }
            });
            r.getElementById('cancel').addEventListener('click', function () {
                try {
                    chrome.runtime.sendMessage({ Message: 'vrYtCancel' }, function (res) {
                        void chrome.runtime.lastError;
                        renderProg({ text: (res && res.ok) ? '正在取消…' : '没有正在进行的下载', kind: 'warn' });
                    });
                } catch (e) { /* ignore */ }
            });
            r.getElementById('opts').addEventListener('click', function (ev) {
                var btn = ev.target && ev.target.closest ? ev.target.closest('.opt') : null;
                if (!btn) { return; }
                var key = btn.getAttribute('data-key') || '';
                if (!key) { return; }
                /* 立刻反馈，避免点了没反应 */
                btn.disabled = true;
                var sz = btn.querySelector('.sz');
                if (sz) { sz.textContent = '准备中…'; }
                try {
                    chrome.runtime.sendMessage({ Message: 'vrYtChoose', key: key, start: true }, function (res) {
                        void chrome.runtime.lastError;
                        if (!res || !res.ok) {
                            btn.disabled = false;
                            if (sz) { sz.textContent = (res && res.reason === 'already-downloading') ? '正在下载中' : '失败，重试'; }
                            return;
                        }
                        renderProg({ text: '开始下载…', pct: 0 });
                    });
                } catch (e) {
                    btn.disabled = false;
                }
            });
        } catch (e) { /* 浮层交互失败不影响下载 */ }
    }

    /** 渲染档位列表（清晰度 + 体积）。这是「让用户自己选」的落地点。 */
    function renderOptions(m) {
        try {
            var r = ensureProg();
            bindProg(r);
            var box = r.getElementById('box');
            var tt = r.getElementById('tt');
            var opts = r.getElementById('opts');
            var ft = r.getElementById('ft');
            var t = r.getElementById('t');
            box.classList.add('on');

            if (m.title) { tt.textContent = m.title; }
            var list = Array.isArray(m.options) ? m.options : [];
            /* 记下来：下载失败/取消后要靠它把选项恢复出来 */
            lastOptions = (list.length ? m : null);
            if (opts) {
                var html = '';
                for (var i = 0; i < list.length; i++) {
                    var o = list[i] || {};
                    var label = o.label || (o.height ? o.height + 'p' : '未知');
                    /* fix_c3：体积未知时明确写「大小未知」，不要留空白让用户以为是 0。
                     * 优先用下载页算好的 sizeText；兜底也走同一个纯逻辑模块，
                     * 避免同一体积在两处显示成不同结果。 */
                    var sizeText = o.sizeText ||
                        (self.VRYtOptions ? self.VRYtOptions.sizeText(o.size) : '') ||
                        (o.size ? (o.size >= 1073741824
                            ? (o.size / 1073741824).toFixed(2) + ' GB'
                            : Math.round(o.size / 1048576) + ' MB')
                            : '大小未知');
                    html += '<button class="opt" type="button" data-key="' + esc(o.key || '') + '">' +
                        '<span class="q">' + esc(label) +
                        (o.badge ? '<span class="bd">' + esc(o.badge) + '</span>' : '') + '</span>' +
                        '<span class="sz">' + esc(sizeText) + '</span></button>';
                }
                opts.innerHTML = html;
            }
            if (ft) { ft.classList.remove('on'); }   // 未开始下载时不显示取消
            if (t) {
                t.className = 't';
                t.textContent = list.length ? '选一个清晰度开始下载' : '没有可用的档位';
            }
            clearTimeout(progTimer);
        } catch (e) { /* 浮层失败不影响下载 */ }
    }

    function renderProg(m) {
        try {
            var r = ensureProg();
            bindProg(r);
            var box = r.getElementById('box');
            var t = r.getElementById('t');
            var bar = r.getElementById('i');
            var barBox = r.getElementById('bar');
            var opts = r.getElementById('opts');
            var ft = r.getElementById('ft');
            box.classList.add('on');
            t.className = 't' + (m.done ? (m.kind === 'err' ? ' err' : (m.kind === 'warn' ? ' warn' : ' ok')) : '');

            /* 用下载页显式上报的 busy 判断「是否在下载」。
             * 不能只看 pct：'准备链路…' '下载音频轨…' 这些阶段没有百分比，
             * 但此时取消按钮必须可点。也不能用 m.done === false ——
             * setMsg 的每条消息都带 done:false。 */
            var downloading = (m.busy === true) || (m.pct !== null && m.pct !== undefined);
            if (downloading) {
                if (opts) { opts.innerHTML = ''; }
                if (ft) { ft.classList.add('on'); }
                if (barBox) { barBox.classList.remove('hide'); }
            }

            if (m.text) { t.textContent = m.text; }
            else if (m.pct !== null && m.pct !== undefined) { t.textContent = '后台合并中… ' + Math.round(m.pct) + '%'; }
            if (m.pct !== null && m.pct !== undefined) { bar.style.width = Math.max(0, Math.min(100, m.pct)) + '%'; }
            clearTimeout(progTimer);
            if (m.done) {
                if (ft) { ft.classList.remove('on'); }
                /* 失败或取消后要能重来：把档位列表放回去，
                 * 否则用户只能关掉浮层再重新点页面上的「下载」。 */
                if (m.kind === 'err' || m.kind === 'warn') {
                    if (barBox) { barBox.classList.remove('hide'); }
                    var again = r.getElementById('opts');
                    /* lastOptions 存的是「整条 vrYtOptions 消息」，不是数组，
                     * 所以要判 options 数组的长度，不能写 lastOptions.length。 */
                    var saved = (lastOptions && Array.isArray(lastOptions.options))
                        ? lastOptions.options.length : 0;
                    if (again && !again.innerHTML && saved) {
                        renderOptions(lastOptions);
                    }
                }
                progTimer = setTimeout(function () { box.classList.remove('on'); }, 6000);
            }
        } catch (e) { /* 浮层失败不影响下载 */ }
    }
    try {
        chrome.runtime.onMessage.addListener(function (msg) {
            if (!msg) { return; }
            if (msg.Message === 'vrYtProgress') { renderProg(msg); }
            if (msg.Message === 'vrYtOptions') { renderOptions(msg); }
        });
    } catch (e) { /* ignore */ }

    schedule();
})();
