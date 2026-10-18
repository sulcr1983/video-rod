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
        '.vr-vob-main{width:44px;height:40px;border-radius:10px;position:relative}',
        '.vr-vob-main:hover{background:rgba(255,255,255,.16)}',
        '.vr-vob-more{width:26px;height:40px;border-radius:10px;opacity:.75}',
        '.vr-vob-more:hover{background:rgba(255,255,255,.16);opacity:1}',
        '.vr-vob-more svg{width:14px;height:14px}',
        '.vr-vob.vr-busy .vr-vob-main,.vr-vob.vr-busy .vr-vob-more{opacity:.5;pointer-events:none}',
        '.vr-vob.vr-done .vr-vob-main{color:#34d399}',
        '.vr-vob.vr-warn .vr-vob-main{color:#f87171}',
        '.vr-vob-pct{position:absolute;left:0;top:0;width:100%;height:100%;display:flex;',
        'align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff}',
        '.vr-vob-menu{position:absolute;right:0;top:100%;margin-top:6px;min-width:196px;',
        'background:rgba(18,20,24,.96);border-radius:10px;padding:5px;',
        'box-shadow:0 6px 20px rgba(0,0,0,.45);display:none;flex-direction:column}',
        '.vr-vob-menu.vr-open{display:flex}',
        '.vr-vob-item{width:100%;padding:9px 11px;border-radius:7px;font-size:12px;color:#e8eaed;',
        'text-align:left;justify-content:flex-start;gap:7px;line-height:1.4}',
        '.vr-vob-item:hover{background:rgba(255,255,255,.13)}',
        '.vr-vob-item b{font-weight:600}',
        '.vr-vob-item span{opacity:.6;font-size:11px}',
        '.vr-vob-empty{padding:9px 11px;font-size:12px;color:#9aa0a6;line-height:1.5}'
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
        ICON_DOWN + '<span class="vr-vob-pct" style="display:none"></span></button>' +
        '<button class="vr-vob-more" type="button" title="选择清晰度">' + ICON_MORE + '</button>' +
        '<div class="vr-vob-menu"></div>';
    document.documentElement.appendChild(panel);

    const btnMain = panel.querySelector('.vr-vob-main');
    const btnMore = panel.querySelector('.vr-vob-more');
    const menu = panel.querySelector('.vr-vob-menu');
    const pctEl = panel.querySelector('.vr-vob-pct');

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
    function setState(state, pct) {
        panel.classList.remove('vr-busy', 'vr-done', 'vr-warn');
        if (state) { panel.classList.add('vr-' + state); }
        // 每次重新查：非 busy 分支会重建 innerHTML，旧引用会变成游离节点
        const p = panel.querySelector('.vr-vob-pct');
        if (state === 'busy') {
            if (p) {
                p.style.display = 'flex';
                p.textContent = (pct != null ? pct : 0) + '%';
            }
            const svg = btnMain.querySelector('svg');
            if (svg) { svg.style.opacity = '.25'; }
        } else {
            const icon = state === 'done' ? ICON_OK
                : state === 'warn' ? ICON_BAD : ICON_DOWN;
            btnMain.innerHTML = icon +
                '<span class="vr-vob-pct" style="display:none"></span>';
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
        });
    });

    /* ---------- 下载 ---------- */
    function start(optionId, wantBest) {
        if (busy) { return; }
        busy = true;
        setState('busy', 0);
        chrome.runtime.sendMessage(
            { Message: 'vrVideoDownload', optionId: optionId, wantBest: !!wantBest },
            function (res) {
                if (chrome.runtime.lastError || !res || !res.ok) {
                    busy = false;
                    flash('warn', 2600);
                    return;
                }
                if (res.started) {
                    // B站 路线：后台会推 vrVideoProgress 过来，等它通知
                    return;
                }
                busy = false;
                flash('done', 2000);
            });
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
            flash(msg.ok ? 'done' : 'warn', msg.ok ? 2200 : 3000);
            return;
        }
        setState('busy', msg.pct || 0);
    });

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
            document.querySelectorAll('video').forEach(function (v) {
                if (usable(v)) { bind(v); }
            });
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
})();