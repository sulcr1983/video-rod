/**
 * 钓鱼竿 video-rod — 页内视频悬浮下载按钮（ADR-030）
 * ------------------------------------------------------------------
 * 苏哥的原话：「鼠标放在视频画面上，左上角就出现一个下载的图标，点一下就自动下载，
 * 或者可以出几个清晰度给我选。打开插件再选下载太麻烦。」
 *
 * 所以本模块只干一件事：**在画面上画一个按钮**。取流/命名/下载全在后台，
 * 走 chrome.runtime 消息（vrVideoOptions / vrVideoDownload），
 * 跟 js/x-button.js（X 推文按钮）是同一套路子。
 *
 * 三个设计决定（都是踩过坑才这么定的）：
 *  1. **浮层用 position:fixed 挂在 body 下，不用「插进 video 父容器」**。
 *     各站播放器布局千差万别，父容器可能是 overflow:hidden、有 transform、
 *     或者被播放器自己的 z-index 层级压住。fixed + 自己算坐标最不容易被环境坑。
 *  2. **每个 video 不单独建浮层，全局只留一个**，鼠标进哪个 video 就飘到哪个上面。
 *     页面里十几个 video 时不会插十几个 DOM。
 *  3. **按钮是页面里的真实元素 → 点击带真实用户手势**。
 *     这顺带解决了 ADR-029 里记的隐患：Chrome 会拦「脚本触发的自动下载」，
 *     而这儿是用户自己点的，不会触发那个拦截。
 *
 * 已知边界：全屏时隐藏（全屏下坐标体系不同，且不该挡画面）。
 */
(() => {
    if (window.__vrVideoOverlay) { return; }
    window.__vrVideoOverlay = true;

    // X/Twitter 已有专门的推文按钮（x-button.js），别在人家地盘上重复加
    if (/^https?:\/\/(x\.com|twitter\.com)\//i.test(location.href)) { return; }
    // YouTube 明确不做（ADR-019/022：SABR+poToken 死局），页面不挂下载按钮
    if (/(^|\.)youtube\.com$/i.test(location.hostname) ||
        /(^|\.)youtu\.be$/i.test(location.hostname)) { return; }

    const MIN_W = 200, MIN_H = 120;      // 太小的 video（广告/装饰）不加按钮

    /* ---------- 样式 ---------- */
    const STYLE = document.createElement('style');
    STYLE.textContent = [
        '.vr-vob{position:fixed;z-index:2147483000;display:flex;align-items:center;gap:2px;',
        'padding:4px;border-radius:12px;background:rgba(18,20,24,.86);',
        'backdrop-filter:blur(6px);box-shadow:0 4px 16px rgba(0,0,0,.4);',
        'opacity:0;pointer-events:none;transform:translateY(-4px);',
        'transition:opacity .16s ease,transform .16s ease;font-family:inherit}',
        '.vr-vob.vr-on{opacity:1;pointer-events:auto;transform:translateY(0)}',
        '.vr-vob button{border:none;background:transparent;color:#fff;cursor:pointer;',
        'display:flex;align-items:center;justify-content:center;padding:0;margin:0}',
        '.vr-vob svg{width:21px;height:21px;pointer-events:none}',
        '.vr-vob-main{width:44px;height:40px;border-radius:10px;position:relative;',
        'display:flex;align-items:center;justify-content:center}',
        '.vr-vob-main:hover{background:rgba(255,255,255,.16)}',
        '.vr-vob-more{width:26px;height:40px;border-radius:10px;opacity:.75}',
        '.vr-vob-more:hover{background:rgba(255,255,255,.16);opacity:1}',
        '.vr-vob-more svg{width:14px;height:14px}',
        '.vr-vob.vr-busy .vr-vob-main,.vr-vob.vr-busy .vr-vob-more{opacity:.5;pointer-events:none}',
        '.vr-vob.vr-done .vr-vob-main{color:#34d399}',
        '.vr-vob.vr-warn .vr-vob-main{color:#f87171}',
        /* 进度文字：不要用 absolute 铺满 —— 父按钮在忙碌时会加宽，
         * absolute+100% 跟着变宽没错，但会把「加宽」的基准锁死成 44px。
         * 用流式排列，宽度由内容决定。 */
        '.vr-vob-pct{display:none;align-items:center;justify-content:center;',
        'font-size:12px;font-weight:700;color:#fff;white-space:nowrap;line-height:1}',
        /* 有阶段文字时（下载画面/合成中）字号让位，别把 44px 挤爆 */
        '.vr-vob-pct.vr-has-phase{font-size:10px;font-weight:600;letter-spacing:0}',
        /* 主按钮在忙碌时按文字加宽 —— 44px 装不下「下载中」三个字，
         * 不加宽就会被压成竖排（实测截图很难看）。 */
        '.vr-vob.vr-busy .vr-vob-main{width:auto;min-width:52px;padding:0 8px}',
        /* 忙碌时隐藏图标，只留文字 + 底部细进度条 */
        '.vr-vob.vr-busy .vr-vob-main > svg{display:none}',
        /* 进度条：只有真百分比才显示，indeterminate 时是一条来回滑的细线 */
        '.vr-vob-bar{position:absolute;left:5px;right:5px;bottom:3px;height:2px;',
        'border-radius:2px;background:rgba(255,255,255,.22);overflow:hidden}',
        '.vr-vob-bar i{display:block;height:100%;width:0;background:#e8b04b;transition:width .3s}',
        '.vr-vob.vr-busy.vr-indet .vr-vob-bar i{width:40%;animation:vr-indet 1.1s ease-in-out infinite}',
        '@keyframes vr-indet{0%{margin-left:-40%}100%{margin-left:100%}}',
        '.vr-vob-menu{position:absolute;right:0;top:100%;margin-top:6px;min-width:196px;',
        'background:rgba(18,20,24,.96);border-radius:10px;padding:5px;',
        'box-shadow:0 6px 20px rgba(0,0,0,.45);display:none;flex-direction:column}',
        '.vr-vob-menu.vr-open{display:flex}',
        '.vr-vob-item{width:100%;padding:9px 11px;border-radius:7px;font-size:12px;color:#e8eaed;',
        'text-align:left;justify-content:flex-start;gap:7px;line-height:1.4}',
        '.vr-vob-item:hover{background:rgba(255,255,255,.13)}',
        '.vr-vob-item b{font-weight:600}',
        '.vr-vob-item span{opacity:.6;font-size:11px}',
        '.vr-vob-empty{padding:9px 11px;font-size:12px;color:#9aa0a6;line-height:1.5}',
        /* 录制兜底：和普通清晰度项在视觉上分开，别让人误以为这是另一档画质 */
        '.vr-vob-cap{border-top:1px solid rgba(255,255,255,.12);margin-top:4px;padding-top:9px;border-radius:0 0 7px 7px}',
        '.vr-vob-cap b{color:#f0b24b}',
        '.vr-vob-cap[disabled]{opacity:.45;pointer-events:none}',
        /* 页内提示条：浮标只有一个图标位，装不下「为什么没下」。
         * 2026-11-12 苏哥报「B站下载不了」，实际是去重把整页当作品跳过了，
         * 而跳过时浮标只闪一个绿勾 —— 和「下载成功」完全分不出来。 */
        '.vr-votoast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);',
        'z-index:2147483001;max-width:78vw;padding:9px 14px;border-radius:9px;',
        'background:rgba(18,20,24,.94);color:#f0dfc0;font-size:13px;line-height:1.5;',
        'box-shadow:0 6px 22px rgba(0,0,0,.45);opacity:0;pointer-events:none;',
        'transition:opacity .18s ease;font-family:inherit;text-align:center}',
        '.vr-votoast.vr-on{opacity:1}'
    ].join('');
    (document.head || document.documentElement).appendChild(STYLE);

    /* ---------- 图标 ---------- */
    const ICON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
        '<path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
    const ICON_MORE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M6 9l6 6 6-6"/></svg>';
    const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M20 6L9 17l-5-5"/></svg>';
    const ICON_BAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 8v5"/><path d="M12 17h.01"/></svg>';

    /* ---------- 浮层 ---------- */
    const panel = document.createElement('div');
    panel.className = 'vr-vob';
    panel.innerHTML =
        '<button class="vr-vob-main" type="button" title="钓鱼竿：下载这个视频（最高清）">' +
        ICON_DOWN + '<span class="vr-vob-pct" style="display:none"></span>' +
        '<span class="vr-vob-bar" style="display:none"><i></i></span></button>' +
        '<button class="vr-vob-more" type="button" title="选择清晰度">' + ICON_MORE + '</button>' +
        '<div class="vr-vob-menu"></div>';
    document.documentElement.appendChild(panel);

    const btnMain = panel.querySelector('.vr-vob-main');
    const btnMore = panel.querySelector('.vr-vob-more');
    const menu = panel.querySelector('.vr-vob-menu');
    const pctEl = panel.querySelector('.vr-vob-pct');

    /* 页内提示条（与浮标同一套内联样式，不进 shadow） */
    const toastEl = document.createElement('div');
    toastEl.className = 'vr-votoast';
    document.documentElement.appendChild(toastEl);
    let toastTimer = 0;
    function vtoast(text, ms) {
        if (!text) { return; }
        toastEl.textContent = text;
        toastEl.classList.add('vr-on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('vr-on'); }, ms || 3200);
    }

    let activeVideo = null;      // 当前鼠标所在的 video
    let overPanel = false;       // 鼠标是否在浮层上
    let busy = false;
    let rafId = 0;
    let hideTimer = 0;

    /* ---------- 显示/隐藏 ---------- */
    function place() {
        const v = activeVideo;
        if (!v) { return; }
        const r = v.getBoundingClientRect();
        // 视频滚出视口就收起来，别飘在半空
        if (r.bottom < 40 || r.top > innerHeight - 20 || r.width < 1 || r.height < 1) {
            panel.classList.remove('vr-on');
            return;
        }
        if (document.fullscreenElement) { panel.classList.remove('vr-on'); return; }
        // 靠视频右上角（苏哥 2026-10-19 反馈：左上角常被播放器自己的标题/
        // 头像/音乐封面占住）。仍然往下让开顶部控件条，避免和清晰度/全屏图标叠。
        const bh = panel.offsetHeight || 48;
        const bw = panel.offsetWidth || 78;
        // 让开的距离按视频高度给（12%，16~76px）。
        // 固定写死一个数值会在高视频上顶到画面中间、小视频上照样压住。
        const dy = Math.max(16, Math.min(76, Math.round(r.height * 0.12)));
        const left = Math.max(6, Math.min(r.right - bw - 14, innerWidth - bw - 6));
        let top = r.top + dy;
        top = Math.min(top, r.bottom - bh - 10);       // 别越过视频下沿
        top = Math.max(6, Math.min(top, innerHeight - bh - 8));
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.classList.add('vr-on');
    }

    function loop() {
        rafId = 0;
        if (!activeVideo) { return; }
        place();
        if (panel.classList.contains('vr-on')) { rafId = requestAnimationFrame(loop); }
    }

    function show(v) {
        clearTimeout(hideTimer);
        activeVideo = v;
        place();
        // 通用能力：页面不自动播放时，悬停即静音播放触发嗅探。
        // 这不是为了某个站点写特例——任何靠用户点击才发媒体请求的页面
        // （TikTok/某些信息流）都因此能被通用通道嗅到。
        if (v.paused) {
            try {
                v.muted = true;
                var pr = v.play();
                if (pr && pr.catch) { pr.catch(function () { /* 用户手势不足，静默 */ }); }
            } catch (e) { /* 忽略 */ }
        }
        if (!rafId) { rafId = requestAnimationFrame(loop); }
    }

    function scheduleHide() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            if (overPanel || busy) { return; }
            activeVideo = null;
            panel.classList.remove('vr-on');
            menu.classList.remove('vr-open');
        }, 260);
    }

    /* ---------- 状态 ---------- */
    /** phase：B站那种「下载画面 / 合成中」的阶段文字；有它就把数字挤小一点 */
    function setState(state, pct, indeterminate, phase) {
        panel.classList.remove('vr-busy', 'vr-done', 'vr-warn', 'vr-indet');
        if (state) { panel.classList.add('vr-' + state); }
        if (state === 'busy' && indeterminate) { panel.classList.add('vr-indet'); }
        // 每次重新查：非 busy 分支会重建 innerHTML，旧引用会变成游离节点
        const p = panel.querySelector('.vr-vob-pct');
        const bar = panel.querySelector('.vr-vob-bar');
        const fill = bar && bar.querySelector('i');
        if (state === 'busy') {
            if (p) {
                p.style.display = 'flex';
                /* indeterminate：拿不到总字节（FSA 直写 / 服务器没给 Content-Length /
                 * B站 durl 只给 loaded,total 还没算成百分比）→ 显示「…」而不是假的 0%。
                 * 苏哥 2026-11-09 与 11-10 两次报的「一直 0%」都是这一类。 */
                const ph = String(phase || '');
                if (indeterminate) {
                    p.classList.add('vr-has-phase');
                    p.textContent = ph ? ph : '…';
                } else {
                    p.classList.toggle('vr-has-phase', !!ph);
                    /* 有阶段文字时显示「画面 37%」这种；纯数字时字大一点 */
                    p.textContent = ph ? (ph + ' ' + (pct != null ? pct : 0) + '%')
                                       : ((pct != null ? pct : 0) + '%');
                }
            }
            if (bar) {
                bar.style.display = 'block';
                if (fill && !indeterminate) { fill.style.width = (pct != null ? pct : 0) + '%'; }
            }
        } else {
            const icon = state === 'done' ? ICON_OK
                : state === 'warn' ? ICON_BAD : ICON_DOWN;
            btnMain.innerHTML = icon +
                '<span class="vr-vob-pct" style="display:none"></span>' +
                '<span class="vr-vob-bar" style="display:none"><i></i></span>';
        }
    }

    function flash(state, ms) {
        setState(state);
        setTimeout(function () { setState(null); }, ms || 1800);
    }

    /* ---------- 清晰度菜单 ---------- */
    function closeMenu() { menu.classList.remove('vr-open'); }

    btnMore.addEventListener('click', function (ev) {
        ev.stopPropagation();
        ev.preventDefault();
        if (busy) { return; }
        if (menu.classList.contains('vr-open')) { closeMenu(); return; }
        menu.innerHTML = '<div class="vr-vob-empty">正在问这个网站能下哪些清晰度…</div>';
        menu.classList.add('vr-open');
        chrome.runtime.sendMessage({ Message: 'vrVideoOptions' }, function (res) {
            if (chrome.runtime.lastError || !res || !res.ok) {
                menu.innerHTML = '<div class="vr-vob-empty">没问到可下的清晰度。<br>' +
                    '试试先让视频播一会儿，再用面板嗅探。</div>';
                return;
            }
            const opts = res.options || [];
            if (!opts.length) {
                menu.innerHTML = '<div class="vr-vob-empty">这个页面的视频还没被嗅探到。<br>' +
                    '先播放几秒再点这里。</div>';
                /* 没有候选时更要给录制入口 —— 这正是录制存在的意义 */
                appendCaptureItem(menu);
                return;
            }
            menu.innerHTML = '';
            opts.forEach(function (o) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'vr-vob-item';
                b.innerHTML = '<b></b><span></span>';
                b.querySelector('b').textContent = o.label || '视频';
                b.querySelector('span').textContent = o.note || '';
                b.addEventListener('click', function (e) {
                    e.stopPropagation();
                    closeMenu();
                    start(o.id, false);
                });
                menu.appendChild(b);
            });
            appendCaptureItem(menu);
        });
    });

    /* ---------- 录制兜底（抄 Video Downloader Pro 的 captureStream） ----------
     * 放在菜单最后一项：正常情况用不上，但「地址全都拿不到」时它是唯一出路。
     * 明确写出代价（要播完、画质是重编码），不让用户以为这是无损下载。 */
    var capTimer = 0;
    function stopCapTimer() {
        if (capTimer) { clearInterval(capTimer); capTimer = 0; }
    }
    function appendCaptureItem(host) {
        var cap = window.__vrCap;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vr-vob-item vr-vob-cap';
        btn.innerHTML = '<b></b><span></span>';
        var bEl = btn.querySelector('b');
        var sEl = btn.querySelector('span');

        var paint = function (recording, t0) {
            if (!recording) {
                bEl.textContent = '录下来';
                sEl.textContent = cap ? '要播完 · 画质是重编码' : '当前页不支持录制';
                btn.disabled = !cap;
                return;
            }
            bEl.textContent = '停止录制';
            var s = Math.floor((Date.now() - t0) / 1000);
            sEl.textContent = '已录 ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' · 点这里停止';
        };

        var recStart = 0;
        var recording = false;
        paint(false);

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            if (!window.__vrCap) { return; }
            if (!recording) {
                var r = null;
                try { r = window.__vrCap.start(); } catch (err) { r = { ok: false, message: '录制启动失败' }; }
                if (!r || !r.ok) {
                    sEl.textContent = (r && r.message) || '这个视频录不了';
                    return;
                }
                recording = true;
                recStart = Date.now();
                paint(true, recStart);
                stopCapTimer();
                capTimer = setInterval(function () { paint(true, recStart); }, 1000);
                return;
            }
            /* 停止：先关计时，再让后台拼盘落盘 */
            recording = false;
            stopCapTimer();
            bEl.textContent = '正在保存…';
            sEl.textContent = '录到的内容会直接存进资源库';
            try {
                window.__vrCap.stop().then(function () { closeMenu(); }, function () { closeMenu(); });
            } catch (err) { closeMenu(); }
        });

        host.appendChild(btn);
    }

    /* ---------- 下载 ---------- */
    /* 兜底超时：后台说「已开始」后如果迟迟收不到任何进度（页面被切/后台被回收），
     * 按钮不能永远卡在 busy —— 否则用户只能刷新页面。 */
    var busyWatchdog = 0;
    function armWatchdog() {
        clearWatchdog();
        busyWatchdog = setTimeout(function () {
            busyWatchdog = 0;
            if (!busy) { return; }
            busy = false;
            flash('warn', 3000);
        }, 30 * 60 * 1000);
    }
    function clearWatchdog() {
        if (busyWatchdog) { clearTimeout(busyWatchdog); busyWatchdog = 0; }
    }

    function start(optionId, wantBest) {
        if (busy) { return; }
        busy = true;
        /* 点下去到第一条真实进度之间有个空窗（要探测候选/探可达性/建连接，
         * B站还要先要 playurl）。这期间**不能显示 0%** —— 苏哥两次报的
         * 「只有 0% 没有进度信息」有一半就是这半秒到几秒的观感。
         * 先给「准备中 + 不确定」，等后台第一条真进度再换成数字。 */
        setState('busy', null, true, '准备中');
        armWatchdog();
        // 扩展被更新/重新加载后，旧页面的 content script 会变成「孤儿」，
        // 此时 sendMessage 会同步抛 "Extension context invalidated."（Edge 错误面板可查）。
        // 以前这里没包 try，用户点一下按钮就是一条红色错误且永久 busy。
        try {
            chrome.runtime.sendMessage(
                { Message: 'vrVideoDownload', optionId: optionId, wantBest: !!wantBest },
                function (res) {
                    if (chrome.runtime.lastError || !res || !res.ok) {
                        busy = false;
                        flash('warn', 2600);
                        /* 说清为什么，别只闪个红叹号。
                         * no-option：一集都问不到（还没播/登录态/会员专享）。
                         * download-failed：真的失败了。 */
                        if (res && res.reason === 'no-option') {
                            vtoast('没问到可下载的视频：先让它播几秒再点，或换清晰度菜单里的其它档');
                        } else if (res && res.reason === 'download-failed') {
                            vtoast('下载失败：换个清晰度再试，或刷新页面');
                        }
                        return;
                    }
                    if (res.started) {
                        // 后台接管了：等它推 vrVideoProgress（含 done）
                        armWatchdog();
                        return;
                    }
                    busy = false;
                    flash('done', 2000);
                    /* 跳过必须给文字：以前只闪绿勾，用户以为下载成功了，
                     * 实际是去重按「整条页面」判重把每一集都跳过了。 */
                    if (res.skipped) {
                        vtoast(res.reason === 'duplicate-source'
                            ? '这个视频已经在库里了，没有重复下载'
                            : '这一集（同清晰度）刚下过，没有重复下载');
                    }
                });
        } catch (e) {
            busy = false;
            flash('warn', 3200);
            try { console.warn('[video-rod] 扩展已更新，请刷新本页面后再下载'); } catch (e2) { }
        }
    }

    btnMain.addEventListener('click', function (ev) {
        ev.stopPropagation();
        ev.preventDefault();
        start(null, true);        // 大图标 = 一键最高清
    });

    // 点页面别处收起菜单
    document.addEventListener('click', function (ev) {
        if (!panel.contains(ev.target)) { closeMenu(); }
    }, true);

    /* ---------- 后台推来的进度 ---------- */
    chrome.runtime.onMessage.addListener(function (msg) {
        if (!msg || msg.Message !== 'vrVideoProgress') { return; }
        if (msg.done) {
            busy = false;
            clearWatchdog();
            flash(msg.ok ? 'done' : 'warn', msg.ok ? 2200 : 3000);
            return;
        }
        if (msg.indeterminate) {
            /* 没有真实百分比（等 Content-Length / 直写磁盘 / 页面通道还没算出来）
             * → 显示「…」或阶段文字，保持 busy，不要用 0% 糊弄用户。 */
            setState('busy', null, true, msg.phase);
            armWatchdog();
            return;
        }
        setState('busy', msg.pct || 0, false, msg.phase);
        armWatchdog();
    });

    /* 微博 feed：点击视频卡片时先记下这条微博的作者/文案。
       播放后 <video> 会被搬到全屏播放层，就再也找不到它属于哪条微博了；
       所以必须在点击时从原卡片抓，存到 window.__vrFeedMeta（后台 executeScript 可读）。 */
    if (/(^|\.)(weibo\.com|weibo\.cn)$/i.test(location.hostname)) {
        document.addEventListener('click', function (ev) {
            try {
                const t = ev.target;
                const card = t && t.closest &&
                    t.closest('.card-video, .wb-item, article, [class*="card-wrap"]');
                if (!card) { return; }
                const item = card.closest('.wb-item') || card.closest('article') ||
                    card.closest('[class*="card-wrap"]') || card;
                // 发布者昵称在 header（头像旁边），不要在正文里找——正文里的 @ 是转发对象
                let authorA = null;
                const headLinks = item.querySelectorAll(
                    'header a[href*="/profile/"], header a[href*="/u/"], ' +
                    '.m-text-box a[href*="/profile/"], .m-text-box a[href*="/u/"]');
                for (let i = 0; i < headLinks.length; i++) {
                    if ((headLinks[i].innerText || '').trim()) { authorA = headLinks[i]; break; }
                }
                if (!authorA) {
                    const links = item.querySelectorAll('a[href*="/profile/"], a[href*="/u/"]');
                    for (let i = 0; i < links.length; i++) {
                        if ((links[i].innerText || '').trim()) { authorA = links[i]; break; }
                    }
                }
                let author = authorA
                    ? (authorA.innerText || '').replace(/^@/, '').replace(/\s+/g, ' ').trim()
                    : '';
                let authorId = '';
                if (authorA) {
                    const m = (authorA.getAttribute('href') || '').match(/\/(?:profile|u)\/(\d+)/);
                    if (m) { authorId = m[1]; }
                }
                // 正文优先取发布者正文（article.weibo-main 的第一段），纯转发再退到转发区
                const textEl = item.querySelector('article.weibo-main .weibo-text') ||
                    item.querySelector('.weibo-text') || item.querySelector('.txt') ||
                    item.querySelector('[class*="text"]');
                let title = textEl ? (textEl.innerText || '').replace(/\s+/g, ' ').trim() : '';
                title = title.replace(/^@[^:：]+[:：]\s*/, '').slice(0, 200);
                if (author || title) {
                    window.__vrFeedMeta = {
                        author: author, authorId: authorId,
                        title: title, post: title, site: 'weibo', at: Date.now()
                    };
                }
            } catch (e) { /* DOM 抖动，忽略 */ }
        }, true);
    }

    /* ---------- 扫描页面里的 video ---------- */
    const BOUND = [];            // 已经认领的 video，鼠标命中判定用

    function usable(v) {
        if (!v || v.dataset.vrVobBound) { return false; }
        // 只认尺寸够大的；太小的多半是广告/背景装饰
        const r = v.getBoundingClientRect();
        return r.width >= MIN_W && r.height >= MIN_H;
    }

    function bind(v) {
        v.dataset.vrVobBound = '1';
        BOUND.push(v);
        // 这里**不再**用 video 的 mouseleave 收起：
        // 播放器覆盖层一动，video 就会误报 mouseleave，把按钮闪掉。
        // 收起统一交给上面的 mousemove 矩形判定 + 滚动判定。
        v.addEventListener('mouseenter', function () { show(v); });
    }

    function scan() {
        try {
            const vs = document.querySelectorAll('video');
            vs.forEach(function (v) {
                if (usable(v)) { bind(v); }
            });
            /* 页面一旦有了 video，链接兜底按钮就让位 —— 它只为「一个 video 都没有」
             * 的页面存在，不该和悬浮键抢戏。 */
            if (vs.length && linkBtn && linkBtn.style.display !== 'none') {
                linkBtn.style.display = 'none';
                hideLinks();
            }
        } catch (e) { /* DOM 抖动，下轮再试 */ }
    }

    /* 坐标命中判定（为什么不用 video 的 mouseenter 就完了）：
     * 微博、抖音、B站的播放器都会在 video 上面盖一层自己的覆盖层（封面、播放键、
     * 作者信息、控制条）。鼠标实际落在覆盖层上，video 收不到 mouseenter，
     * 按钮就永不出现——微博上实测就是这个问题。
     * 所以改成 document 上听 mousemove，按 video 的矩形做命中判定，
     * 上面盖了几层都无所谓。60ms 节流，跟手且不烧 CPU。 */
    let lastMoveAt = 0;
    document.addEventListener('mousemove', function (ev) {
        const now = Date.now();
        if (now - lastMoveAt < 60) { return; }
        lastMoveAt = now;
        if (overPanel) { return; }

        const x = ev.clientX, y = ev.clientY;
        let hit = null;
        for (let i = 0; i < BOUND.length; i++) {
            const v = BOUND[i];
            if (!v.isConnected) { BOUND.splice(i--, 1); continue; }
            const r = v.getBoundingClientRect();
            if (r.width < MIN_W || r.height < MIN_H) { continue; }
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                hit = v;
                break;
            }
        }
        if (hit) {
            if (hit !== activeVideo) { show(hit); } else { clearTimeout(hideTimer); }
        } else if (activeVideo) {
            scheduleHide();
        }
    }, true);

    panel.addEventListener('mouseenter', function () { overPanel = true; clearTimeout(hideTimer); });
    panel.addEventListener('mouseleave', function () {
        overPanel = false;
        scheduleHide();
    });

    // 鼠标窜出窗口 / 切走标签页时也收起来，别留一个按钮僵在画面上
    document.documentElement.addEventListener('mouseleave', function () {
        if (!overPanel) { scheduleHide(); }
    });
    window.addEventListener('blur', function () {
        if (!overPanel) { scheduleHide(); }
    });

    const mo = new MutationObserver(function () { scan(); });
    if (document.body) {
        mo.observe(document.body, { childList: true, subtree: true });
    }
    scan();
    // 播放器常常是稍后才插入 video，头几秒多扫几次
    [500, 1500, 3000].forEach(function (d) { setTimeout(scan, d); });

    /* ---------- 纯静态下载站：链接兜底入口 ----------
     * 触发条件很窄：**页面里一个 <video> 都没有**。
     * 这时候悬浮键永远挂不出来（没有 video 可挂），而页面上明明有
     * `<a href="xxx.mp4">点此下载</a>` —— 老式下载站、网盘直链页全是这种。
     * Download Master 靠「把所有链接甩给用户挑」号称全站可下，我们收敛成
     * 一个按钮（右下角），不是把几十条链接糊在页面上。
     * 一旦页面出现 video，这个按钮自动消失，不与悬浮键抢戏。 */
    var linkBtn = null, linkPanel = null, linkBusy = false, linkDone = false;

    function ensureLinkUI() {
        if (linkBtn && linkBtn.isConnected) { return; }
        linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        linkBtn.textContent = '下载链接';
        linkBtn.style.cssText =
            'position:fixed;right:16px;bottom:96px;z-index:2147483646;display:none;' +
            'padding:8px 13px;border-radius:18px;border:0;cursor:pointer;' +
            'background:rgba(24,26,30,.94);color:#f0b24b;font-size:12px;font-weight:600;' +
            'box-shadow:0 4px 16px rgba(0,0,0,.35);font-family:system-ui,sans-serif';
        linkBtn.addEventListener('click', toggleLinkPanel);
        (document.body || document.documentElement).appendChild(linkBtn);

        linkPanel = document.createElement('div');
        linkPanel.style.cssText =
            'position:fixed;right:16px;bottom:136px;z-index:2147483646;display:none;' +
            'min-width:240px;max-width:420px;max-height:52vh;overflow:auto;padding:6px;' +
            'border-radius:12px;background:rgba(18,20,24,.97);color:#e8eaed;' +
            'box-shadow:0 8px 28px rgba(0,0,0,.5);font-family:system-ui,sans-serif';
        (document.body || document.documentElement).appendChild(linkPanel);
    }

    function hideLinks() {
        if (linkPanel) { linkPanel.style.display = 'none'; }
    }

    function toggleLinkPanel(ev) {
        if (ev) { ev.stopPropagation(); ev.preventDefault(); }
        if (!linkPanel) { return; }
        if (linkPanel.style.display === 'block') { hideLinks(); return; }
        var links = (linkBtn && linkBtn.__links) || [];
        if (!links.length) { return; }
        linkPanel.innerHTML = '';
        links.forEach(function (it) {
            var row = document.createElement('button');
            row.type = 'button';
            row.style.cssText =
                'display:block;width:100%;text-align:left;padding:8px 10px;margin:2px 0;' +
                'border:0;border-radius:8px;background:transparent;color:#e8eaed;' +
                'font-size:12px;cursor:pointer;line-height:1.4;font-family:inherit';
            row.addEventListener('mouseenter', function () { row.style.background = 'rgba(255,255,255,.12)'; });
            row.addEventListener('mouseleave', function () { row.style.background = 'transparent'; });
            var name = it.label || '';
            try { name = name || decodeURIComponent(String(it.url).split('/').pop() || ''); } catch (e) { name = name || it.url; }
            row.innerHTML = '<b></b><span></span>';
            row.querySelector('b').textContent = String(name).slice(0, 46);
            row.querySelector('b').style.cssText = 'font-weight:600;display:block';
            row.querySelector('span').textContent = String(it.url).slice(-60);
            row.querySelector('span').style.cssText = 'opacity:.55;font-size:10.5px;word-break:break-all';
            row.addEventListener('click', function (e) {
                e.stopPropagation();
                e.preventDefault();
                row.disabled = true;
                row.style.opacity = '.5';
                try {
                    chrome.runtime.sendMessage(
                        { Message: 'vrLinkDownload', url: it.url, pageUrl: location.href },
                        function (res) {
                            if (chrome.runtime.lastError || !res || !res.ok) {
                                row.style.opacity = '1';
                                row.disabled = false;
                                row.querySelector('span').textContent = '下载失败：' +
                                    ((res && (res.reason || res.error)) || '未知原因');
                                return;
                            }
                            row.querySelector('span').textContent = '已开始下载';
                        });
                } catch (err) {
                    row.disabled = false;
                    row.style.opacity = '1';
                }
            });
            linkPanel.appendChild(row);
        });
        linkPanel.style.display = 'block';
    }

    function maybeScanLinks() {
        if (linkDone || linkBusy) { return; }
        try { if (document.querySelectorAll('video').length) { return; } } catch (e) { return; }
        linkBusy = true;
        try {
            chrome.runtime.sendMessage({ Message: 'vrScanLinks' }, function (res) {
                linkBusy = false;
                linkDone = true;
                if (chrome.runtime.lastError || !res || !res.ok) { return; }
                var links = res.links || [];
                if (!links.length) { return; }
                ensureLinkUI();
                linkBtn.__links = links;
                linkBtn.textContent = '下载链接 ' + links.length;
                linkBtn.style.display = 'block';
            });
        } catch (e) { linkBusy = false; }
    }
    setTimeout(maybeScanLinks, 3500);
    // SPA 换页后可能从「有视频」变成「没视频」，再补一次
    window.addEventListener('popstate', function () { linkDone = false; setTimeout(maybeScanLinks, 1500); });
    document.addEventListener('click', function (ev) {
        if (linkPanel && linkPanel.style.display === 'block' &&
            !linkPanel.contains(ev.target) && ev.target !== linkBtn) {
            hideLinks();
        }
    }, true);
})();