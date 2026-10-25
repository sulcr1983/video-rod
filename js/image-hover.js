/**
 * 苏哥的钓鱼竿 —— 图片悬停下载按钮（I2）
 *
 * 交互：鼠标在 <img> 上停留 300ms → 图片右上角浮出「下载原图」→ 点击落盘到
 *      video-rod/<平台>/<博主>/图片/<日期>_<标题>.<ext>
 *
 * 关键约束：
 *   · 按钮挂在 documentElement 下的单例宿主里，样式全部走 Shadow DOM，不污染站点
 *   · 不修改 <img> 任何属性、不改变原图点击（按钮点击 preventDefault + stopPropagation）
 *   · 事件委托（document mouseover），动态加载的图片天然覆盖
 *   · 滚动 / 缩放 / 移开即隐藏
 *   · 读 vrLibSettings.imgHover，缺省开；关闭后宿主节点直接移除
 *
 * 依赖：js/lib-image-util.js（self.VRImageUtil，manifest 中先加载）
 */
(() => {
    'use strict';
    if (window.__vrImgHoverLoaded) { return; }
    window.__vrImgHoverLoaded = true;

    const U = self.VRImageUtil;
    if (!U) { return; }

    const HIDE_DELAY = 300;
    let showDelay = 300;           // 可配（imgHoverDelay），缺省 300ms
    const DONE_MS = 1200;
    const FAIL_MS = 1800;
    const MIN = U.MIN_SIZE;
    /* 显示尺寸门槛（见 eligible 注释）：图标/按钮普遍在 16–40px，内容图基本 > 100px */
    const MIN_SHOW = U.MIN_SHOW;

    const HOST_ID = 'vr-img-hover-host';

    let enabled = true;
    let host = null;
    let shadow = null;
    let wrap = null;
    let btn = null;
    let txt = null;
    let allBtn = null;             // 「全部 N」批量入口（I3）
    let allTxt = null;
    let allNarrow = false;         // 图太窄时「全部 N」收成图标
    /* autoUpdate 的清理句柄：每次 show 换图都要先撤掉旧的，否则监听器越积越多。
     * 必须声明在顶部——hideNow/teardown 定义在 startAutoUpdate 之前，
     * 若 let 写在中间，那些函数被提前调用时会撞 TDZ。 */
    let stopAutoUpdate = null;
    let currentImg = null;
    let lastHoveredImg = null;     // 快捷键用：鼠标最后停过的 img（鼠标不动时没有新事件）
    let state = 'hidden';          // hidden | pending | shown | busy | done | fail
    let showTimer = 0;
    let hideTimer = 0;
    let resetTimer = 0;
    let clickSeq = 0;              // 失效化上一次点击的回调（换图/重开）

    /* ---------------- 设置 ---------------- */

    function applySettings(s) {
        const m = (self.VRImageUtil && self.VRImageUtil.mergeSettings)
            ? self.VRImageUtil.mergeSettings(s || {})
            : (s || {});
        enabled = m.imgHover !== false;
        if (typeof m.imgHoverDelay === 'number') { showDelay = m.imgHoverDelay; }
        if (!enabled) { teardown(); }
    }

    try {
        chrome.storage.local.get('vrLibSettings', res => applySettings(res && res.vrLibSettings));
        chrome.storage.onChanged.addListener((ch, area) => {
            if (area !== 'local' || !ch.vrLibSettings) { return; }
            applySettings(ch.vrLibSettings.newValue);
        });
    } catch (e) { /* 无 storage 权限时保持默认开 */ }

    /* ---------------- UI ---------------- */

    const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
        '<path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';

    const CSS = `
:host { all: initial; }
.vr-wrap {
  position: fixed; left: 0; top: 0;
  /* 默认隐藏，靠 .on 切到 flex；这里只写一次 display，别重复声明（写两遍后者覆盖前者） */
  display: none;
  pointer-events: none; z-index: 2147483000;
  font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Microsoft YaHei", sans-serif;
  color: #fff;
  gap: 6px; align-items: center;
}
.vr-wrap.on { display: flex; }
.vr-btn {
  pointer-events: auto;
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, .35); border-radius: 8px;
  background: rgba(17, 24, 39, .88); color: #fff;
  font: inherit; line-height: 1; cursor: pointer; white-space: nowrap;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .28);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  transition: background .15s, border-color .15s, transform .1s;
}
.vr-btn:hover { background: rgba(37, 99, 235, .94); border-color: rgba(255, 255, 255, .6); }
.vr-btn:active { transform: translateY(1px); }
.vr-btn:disabled { cursor: default; }
.vr-btn svg { width: 14px; height: 14px; display: block; }
.vr-ico { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; }
.vr-btn.busy .vr-ico {
  border: 2px solid rgba(255, 255, 255, .35); border-top-color: #fff;
  border-radius: 50%; width: 10px; height: 10px;
  animation: vr-spin .7s linear infinite;
}
.vr-btn.busy .vr-ico svg { display: none; }
.vr-btn.done { background: rgba(22, 163, 74, .94); border-color: rgba(255, 255, 255, .55); }
.vr-btn.fail { background: rgba(220, 38, 38, .94); border-color: rgba(255, 255, 255, .55); }
/* 「全部 N」按钮：批量入口，视觉上比单张按钮弱一级 */
.vr-btn.all { background: rgba(37, 99, 235, .9); border-color: rgba(255, 255, 255, .4); }
.vr-btn.all:hover { background: rgba(29, 78, 216, .96); }
.vr-btn.all[hidden] { display: none; }
/* 图比按钮组窄时，「全部 N」收成纯图标，避免盖满小图 */
.vr-btn.all.icon-only .vr-text { display: none; }
.vr-btn.all.icon-only { padding: 0 8px; }
@keyframes vr-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .vr-btn.busy .vr-ico { animation: none; } }
`;

    function ensureUI() {
        if (host && host.isConnected) { return true; }
        if (!document.documentElement) { return false; }
        host = document.createElement('div');
        host.id = HOST_ID;
        host.setAttribute('data-vr-img', '1');
        host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;' +
            'pointer-events:none;z-index:2147483000;';
        shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
        const root = shadow || host;

        const style = document.createElement('style');
        style.textContent = CSS;

        wrap = document.createElement('div');
        wrap.className = 'vr-wrap';

        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vr-btn';
        btn.title = '下载原图';
        btn.setAttribute('aria-label', '下载原图');

        const ico = document.createElement('span');
        ico.className = 'vr-ico';
        ico.innerHTML = ICON;
        txt = document.createElement('span');
        txt.className = 'vr-text';
        txt.textContent = '下载原图';
        btn.appendChild(ico);
        btn.appendChild(txt);

        btn.addEventListener('click', onClick);
        btn.addEventListener('mousedown', ev => { ev.stopPropagation(); }, true);
        wrap.appendChild(btn);

        // 「全部 N」批量入口（I3）：同一个宿主里追加第二个按钮
        allBtn = document.createElement('button');
        allBtn.type = 'button';
        allBtn.className = 'vr-btn all';
        allBtn.title = '下载本页全部图片';
        allBtn.setAttribute('aria-label', '下载本页全部图片');
        const allIco = document.createElement('span');
        allIco.className = 'vr-ico';
        allIco.innerHTML = ICON;
        allTxt = document.createElement('span');
        allTxt.className = 'vr-text';
        allTxt.textContent = '全部';
        allBtn.appendChild(allIco);
        allBtn.appendChild(allTxt);
        allBtn.addEventListener('click', onAll);
        allBtn.addEventListener('mousedown', ev => { ev.stopPropagation(); }, true);
        wrap.appendChild(allBtn);

        root.appendChild(style);
        root.appendChild(wrap);
        document.documentElement.appendChild(host);
        syncAllLabel();
        return true;
    }

    /** 刷新「全部 N」文案：数量为 0 时隐藏按钮 */
    function syncAllLabel() {
        if (!allBtn) { return; }
        const B = self.VRImgBridge;
        let n = 0;
        try { n = B && B.count ? B.count() : 0; } catch (e) { n = 0; }
        if (!n) {
            allBtn.hidden = true;
            return;
        }
        allBtn.hidden = false;
        // 图窄时只显示图标，数字放 title / aria
        allTxt.textContent = allNarrow ? '' : ('全部 ' + n);
        allBtn.title = '下载本页全部 ' + n + ' 张图片';
        allBtn.setAttribute('aria-label', '下载本页全部 ' + n + ' 张图片');
    }

    function onAll(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const B = self.VRImgBridge;
        if (!B || !B.requestAll) { return; }
        B.requestAll();
    }

    function teardown() {
        stopAutoUpdateNow();
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
        clearTimeout(resetTimer);
        showTimer = hideTimer = resetTimer = 0;
        if (host && host.parentNode) { host.parentNode.removeChild(host); }
        host = shadow = wrap = btn = txt = allBtn = allTxt = null;
        currentImg = null;
        state = 'hidden';
    }

    /**
     * 定位悬停条。
     *
     * 用 @floating-ui/dom 算位置，不再手算 left/top：
     *   · offset(8)        贴图片右上角内缩 8px
     *   · flip()           上方放不下就翻到下方（图片贴顶时不出界）
     *   · shift({padding:8}) 左右夹回视口，留 8px 安全边
     *   · autoUpdate       尺寸/滚动/缩放变化时自动重算 —— 这是替代手写
     *                      `void offsetWidth` 和 `opacity:0` 防抖的关键：
     *                      按钮宽度被「全部 N」文案撑开时，它会自己重新定位，
     *                      不会再出现「先出现再跳一下、点下去点空」。
     *
     * 参考点是图片本身（img 有 getBoundingClientRect，直接当 reference）。
     */
    function place(img) {
        if (!wrap || !img) { return; }
        const r = img.getBoundingClientRect();

        // 图太窄时把「全部 N」收成纯图标，避免整条盖满小图。
        //  1) 图宽 < 140（头像/图标那种）；
        //  2) 完整按钮组（约 200px）超过图宽的 75%——否则鼠标停在图片中心
        //     就已经落在按钮上，会触发 mouseout 把按钮自己藏起来（实测踩过）。
        if (allBtn && !allBtn.hidden) {
            const estFullW = 200;
            const narrow = r.width < 140 || (r.width < 320 && estFullW > r.width * 0.75);
            if (narrow !== !!allNarrow) {
                allNarrow = narrow;
                allBtn.classList.toggle('icon-only', narrow);
                syncAllLabel();
            }
        }

        const F = self.FloatingUIDOM;
        if (!F || !F.computePosition) {
            // 兜底：万一库没加载（例如老版本 manifest 缓存），退回手算，
            // 保证「按钮至少能出现」，不至于整块功能失效。
            const bw = wrap.offsetWidth || 96;
            const bh = wrap.offsetHeight || 30;
            const vw = document.documentElement.clientWidth || window.innerWidth;
            const vh = document.documentElement.clientHeight || window.innerHeight;
            let left = r.right - bw - 8;
            let top = r.top + 8;
            left = Math.max(4, Math.min(left, vw - bw - 4));
            top = Math.max(4, Math.min(top, vh - bh - 4));
            wrap.style.left = left + 'px';
            wrap.style.top = top + 'px';
            return;
        }

        // 目标是「贴在图片内部右上角，内缩 8px」：
        //   placement top-end  → 按钮底边贴图片上边（在图片外面），不符合
        //   用 top-end + offset 负值 → 把按钮往下推进图片内部
        //   offset({mainAxis: -(bh+8), alignmentAxis: -8})：mainAxis 沿「上方」反向推进
        // 但 mainAxis 依赖按钮高度，需要在测量后才知道，所以用函数式 offset。
        F.computePosition(img, wrap, {
            placement: 'top-end',
            strategy: 'fixed',
            middleware: [
                // top-end 把按钮右上角对到图片右上角（在外侧）。
                // mainAxis 正值 = 沿「上方」外侧推；要压回图片内部得用负值。
                //   -(h + 8)：按钮整体下移进图片，顶部内缩 8px
                //   alignmentAxis: -8：end 方向内侧再收 8px（实测该值方向为「向里为正」的反向）
                F.offset(({ rects }) => ({
                    mainAxis: -(rects.floating.height + 8),
                    alignmentAxis: 8
                })),
                F.flip({ padding: 4 }),
                F.shift({ padding: 8 })
            ]
        }).then(({ x, y }) => {
            if (!wrap) { return; }
            wrap.style.left = x + 'px';
            wrap.style.top = y + 'px';
        }).catch(() => {
            // 定位失败不能让按钮消失：保留上一次位置
        });
    }

    function setState(s, text) {
        state = s;
        if (!btn) { return; }
        btn.classList.toggle('busy', s === 'busy');
        btn.classList.toggle('done', s === 'done');
        btn.classList.toggle('fail', s === 'fail');
        btn.disabled = (s === 'busy' || s === 'done');
        txt.textContent = text;
    }

    function show(img) {
        if (!enabled || !ensureUI()) { return; }
        clearTimeout(resetTimer);
        resetTimer = 0;
        clickSeq++;               // 新图出现即作废上一张图的异步回调
        currentImg = img;
        // 顺序很重要：**先复位状态、先算「全部 N」文案，最后才显示并定位**。
        // 早先是 add('on') → syncAllLabel() → place()，显示时文案还是上一轮的，
        // 数量算完变宽后按钮已经按旧宽度定位过 —— 表现为「按钮先出现再跳一下」，
        // 用户点下去会点空（实测 C1 用例就是这个原因失败）。
        setState('shown', '下载原图');
        btn.title = '下载原图';
        wrap.classList.add('on');
        try { syncAllLabel(); } catch (e) { /* 数量算不出来不影响单张下载 */ }
        place(img);
        // 交给 autoUpdate：图片/按钮尺寸变化（「全部 N」文案定稿）、页面滚动、
        // 窗口缩放都会自动重算位置。手写的 `void offsetWidth` 与 `opacity:0`
        // 防抖都不再需要 —— 那是为了掩盖「定位算在文案定稿前」的问题，
        // 现在由库负责重算，按钮不会先出现再跳（这正是之前点空的根因）。
        startAutoUpdate(img);
        state = 'shown';
    }

    function startAutoUpdate(img) {
        stopAutoUpdate && stopAutoUpdate();
        stopAutoUpdate = null;
        const F = self.FloatingUIDOM;
        if (!F || !F.autoUpdate || !wrap || !img) { return; }
        try {
            stopAutoUpdate = F.autoUpdate(img, wrap, () => { place(img); });
        } catch (e) { /* 库异常不影响按钮显示 */ }
    }

    function stopAutoUpdateNow() {
        if (stopAutoUpdate) {
            try { stopAutoUpdate(); } catch (e) { /* 忽略 */ }
            stopAutoUpdate = null;
        }
    }

    function hideNow() {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
        showTimer = hideTimer = 0;
        stopAutoUpdateNow();
        if (wrap) { wrap.classList.remove('on'); }
        currentImg = null;
        if (state !== 'busy') {
            state = 'hidden';
            // 收起时把按钮态复位，避免下一张图继承 done/disabled
            if (btn) {
                btn.classList.remove('done', 'fail', 'busy');
                btn.disabled = false;
            }
        }
    }

    function scheduleHide() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            hideTimer = 0;
            if (state === 'shown') { hideNow(); }
        }, HIDE_DELAY);
    }

    /** 鼠标移开：shown 走延迟隐藏；pending 直接取消显示计时器。
     * pending 阶段还没出按钮，用户已经移开了就不该再弹出来（快速划过不该闪）。 */
    function onLeaveImage() {
        if (state === 'pending') {
            clearTimeout(showTimer);
            showTimer = 0;
            currentImg = null;
            state = 'hidden';
            return;
        }
        if (state === 'shown') { scheduleHide(); }
    }

    /* ---------------- 悬停判定 ---------------- */

    /**
     * 这张图值不值得给悬停按钮 —— 判定规则全部在 lib-image-util.isWorthDownloading，
     * 与清单面板共用一套，避免「悬停能出、面板不列」这种口径不一致。
     *
     * 关键：判**显示尺寸**，不是原始像素。一张 500px 的图标被 CSS 缩成 16px 显示时，
     * 原始尺寸仍然够大，只看 naturalWidth 会让满屏头像/按钮/表情都冒下载图标
     * （用户实测反馈的核心问题）。
     */
    function eligible(img) {
        if (!img || img.tagName !== 'IMG' || !img.isConnected) { return false; }
        if (host && (img === host || (host.contains && host.contains(img)))) { return false; }
        if (!U.isWorthDownloading(img, { minNatural: MIN, minShow: MIN_SHOW })) { return false; }
        const raw = img.currentSrc || img.src || img.getAttribute('src') || '';
        const url = U.absolutize(raw, document.baseURI);
        if (!url) { return false; }
        if (U.isDataUri(url) || U.isSvgUrl(url) || U.isPlaceholderUrl(url)) { return false; }
        return true;
    }

    /**
     * 用元素栈兜底找图。
     * 站点的播放按钮/遮罩（微博的 SPAN.mwbv-icon、B 站的 div）会盖在图上，
     * mouseover 的 target 是遮罩，composedPath() 里根本没有 IMG —— 只查路径必然漏。
     */
    function imgAtPoint(x, y) {
        if (typeof document.elementsFromPoint !== 'function') { return null; }
        var list = null;
        try { list = document.elementsFromPoint(x, y); } catch (e) { return null; }
        if (!list || !list.length) { return null; }
        for (var i = 0; i < list.length; i++) {
            var n = list[i];
            if (n && n.tagName === 'IMG') { return n; }
        }
        return null;
    }

    /**
     * 指针是否还在这个元素的矩形内（留 1px 容差，避免边界抖动）。
     * 优先用事件的 clientX/clientY；这两个值为 0 或缺失时退回 relatedTarget 判断。
     */
    function pointerInRect(el, ev) {
        if (!el || !el.getBoundingClientRect) { return false; }
        let r = null;
        try { r = el.getBoundingClientRect(); } catch (e) { return false; }
        if (!r || !r.width || !r.height) { return false; }
        const x = Number(ev.clientX);
        const y = Number(ev.clientY);
        // clientX/clientY 同时为 0 多半是拿不到真实指针位置（不是真的在左上角）
        if (!x && !y) {
            // 退路：如果 relatedTarget 是这张图的子孙，说明还在图里
            const to = ev.relatedTarget;
            if (to && to.nodeType === 1 && el.contains && el.contains(to)) { return true; }
            return false;
        }
        return x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1;
    }

    function pathOf(ev) {
        if (ev.composedPath) {
            try { return ev.composedPath() || []; } catch (e) { /* ignore */ }
        }
        return [];
    }

    function fromHost(ev) {
        if (!host) { return false; }
        const p = pathOf(ev);
        for (let i = 0; i < p.length; i++) {
            if (p[i] === host || (p[i] && p[i].id === HOST_ID)) { return true; }
        }
        return ev.target === host;
    }

    function pickImg(ev) {
        const p = pathOf(ev);
        for (let i = 0; i < p.length; i++) {
            const n = p[i];
            if (n && n.tagName === 'IMG') { return n; }
        }
        return ev.target && ev.target.tagName === 'IMG' ? ev.target : null;
    }

    document.addEventListener('mouseover', ev => {
        if (!enabled) { return; }
        if (fromHost(ev)) {
            clearTimeout(hideTimer);
            hideTimer = 0;
            return;
        }
        // 先查事件路径；遮罩盖住时路径里没有 IMG，用元素栈兜底
        const img = pickImg(ev) || imgAtPoint(ev.clientX, ev.clientY);
        if (!img) { return; }
        // 快捷键要能拿到「鼠标最后停过的那张」——鼠标不动时不会再有 mouseover
        lastHoveredImg = img;
        if (img === currentImg && (state === 'shown' || state === 'pending')) {
            clearTimeout(hideTimer);
            hideTimer = 0;
            return;
        }
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
        showTimer = 0;
        hideTimer = 0;
        if (state === 'shown') { hideNow(); }
        currentImg = img;
        state = 'pending';
        showTimer = setTimeout(() => {
            showTimer = 0;
            if (currentImg !== img || state !== 'pending') { return; }
            if (!eligible(img)) { currentImg = null; state = 'hidden'; return; }
            show(img);
        }, showDelay);
    }, true);

    document.addEventListener('mouseout', ev => {
        if (!enabled) { return; }
        if (fromHost(ev)) { return; }
        const to = ev.relatedTarget;
        if (to && host && (to === host || (host.contains && host.contains(to)))) { return; }
        if (!currentImg) { return; }
        // 用「指针是否还在当前图矩形内」判断，不依赖事件坐标：
        //  · 遮罩内部移动时指针仍在矩形内 → 不隐藏（这是覆盖层场景要的）
        //  · 真正移出图片 → 隐藏
        // mouseout 的 clientX/clientY 在部分浏览器里是目标元素坐标而非指针位置，
        // 用它判断会误判（踩过：按钮粘住不消失）。
        const inRect = pointerInRect(currentImg, ev);
        if (inRect) { return; }
        onLeaveImage();
    }, true);

    window.addEventListener('scroll', () => { hideNow(); }, true);
    window.addEventListener('resize', () => { hideNow(); }, true);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { hideNow(); }
    });

    /* ---------------- 点击 ---------------- */

    function send(msg, cb) {
        let done = false;
        const finish = res => {
            if (done) { return; }
            done = true;
            cb(res);
        };
        try {
            chrome.runtime.sendMessage(msg, res => {
                // 必须读一次 lastError，否则控制台会报 "Unchecked runtime.lastError"
                const err = chrome.runtime.lastError;
                finish(err ? null : res);
            });
        } catch (e) { finish(null); }
        setTimeout(() => finish(null), 8000);
    }

    /* 轻量提示：优先用面板的 toast（同页存在时），否则退回 console。
     * 本文件原来没有 toast，直接调会 ReferenceError 把 Promise 卡死（踩过）。 */
    function note(msg) {
        try {
            const B = self.VRImgBridge;
            if (B && typeof B.toast === 'function') { B.toast(msg); return; }
        } catch (e) { /* 忽略 */ }
        try { console.info('[video-rod] ' + msg); } catch (e) { /* 忽略 */ }
    }

    function pageTitle() {
        return String(document.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    }

    function flashFail(code) {
        if (!btn) { return; }
        setState('fail', '! 失败');
        btn.title = '下载失败' + (code ? '（' + code + '）' : '');
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
            resetTimer = 0;
            hideNow();
        }, FAIL_MS);
    }

    function onDone() {
        if (!btn) { return; }
        setState('done', '✓ 已存');
        btn.title = '已存入资源库';
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
            resetTimer = 0;
            hideNow();
        }, DONE_MS);
    }

    /**
     * 快捷键下载：不依赖按钮是否显示，直接用「最后悬停的那张图」。
     * 与点按钮的区别只是不碰 UI 状态（用户可能根本没等按钮出来）。
     */
    function hotkeyDownload() {
        const img = lastHoveredImg || currentImg;
        if (!img || !img.isConnected) {
            note('把鼠标移到图片上再按');
            return Promise.resolve({ ok: false, code: 'IMG_E_NO_TARGET' });
        }
        if (hotkeyBusy) { return Promise.resolve({ ok: false, code: 'IMG_E_BUSY' }); }
        hotkeyBusy = true;
        const pageUrl = location.href;
        const title = pageTitle();
        const candidates = U.collectCandidates(img, document);
        if (!candidates.length) {
            hotkeyBusy = false;
            note('这张图没有可下载的地址');
            return Promise.resolve({ ok: false, code: 'IMG_E_NO_URL' });
        }
        return new Promise(resolve => {
            send({
                Message: 'vrImg.resolve',
                action: 'vrImg.resolve',
                candidates: candidates,
                currentSrc: U.absolutize(img.currentSrc || img.src || '', document.baseURI),
                pageUrl: pageUrl
            }, res => {
                const url = (res && res.url) || candidates[candidates.length - 1];
                send({
                    Message: 'vrImg.download',
                    action: 'vrImg.download',
                    url: url,
                    candidates: candidates,
                    pageUrl: pageUrl,
                    title: title
                }, r2 => {
                    hotkeyBusy = false;
                    if (r2 && r2.ok) {
                        note('已下载：' + (r2.name || '图片'));
                    } else {
                        note('下载失败：' + ((r2 && r2.message) || (r2 && r2.code) || '未知原因'));
                    }
                    resolve(r2 || { ok: false });
                });
            });
        });
    }

    let hotkeyBusy = false;

    function onClick(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (!currentImg || state === 'busy' || state === 'done' || state === 'fail') { return; }

        const img = currentImg;
        const pageUrl = location.href;
        const title = pageTitle();
        const candidates = U.collectCandidates(img, document);
        if (!candidates.length) { flashFail('IMG_E_NO_URL'); return; }

        const seq = ++clickSeq;
        setState('busy', '解析中…');
        btn.title = '正在解析原图…';

        send({
            Message: 'vrImg.resolve',
            action: 'vrImg.resolve',
            candidates: candidates,
            currentSrc: U.absolutize(img.currentSrc || img.src || '', document.baseURI),
            pageUrl: pageUrl
        }, res => {
            if (seq !== clickSeq || !btn) { return; }
            const url = (res && res.url) || candidates[candidates.length - 1];
            setState('busy', '下载中…');
            send({
                Message: 'vrImg.download',
                action: 'vrImg.download',
                url: url,
                candidates: candidates,
                pageUrl: pageUrl,
                title: title
            }, r2 => {
                if (seq !== clickSeq) { return; }
                if (r2 && r2.ok) { onDone(); } else { flashFail(r2 && r2.code); }
            });
        });
    }

    /* ---------------- 快捷键入口（由 SW 的 chrome.commands 转发） ---------------- */

    try {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (!msg || msg.Message !== 'vrImg.hotkey') { return; }
            const action = msg.action || '';
            if (action === 'download') {
                hotkeyDownload().then(r => sendResponse(r || { ok: false }));
                return true;
            }
            if (action === 'panel') {
                // 面板归 image-panel.js 管，这里只应答一下表示收到
                sendResponse({ ok: true });
                return;
            }
        });
    } catch (e) { /* 无权限时快捷键不可用，不影响悬停 */ }

    /* 测试用：把「最后悬停的图」和下载入口暴露出去 */
    self.VRImgHover = {
        hotkeyDownload: hotkeyDownload,
        lastHovered: () => lastHoveredImg,
        _state: () => ({ enabled: enabled, showDelay: showDelay, state: state,
                         hasLast: !!lastHoveredImg })
    };
})();
