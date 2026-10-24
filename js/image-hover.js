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

    const SHOW_DELAY = 300;
    const HIDE_DELAY = 300;
    const DONE_MS = 1200;
    const FAIL_MS = 1800;
    const MIN = U.MIN_SIZE;

    const HOST_ID = 'vr-img-hover-host';

    let enabled = true;
    let host = null;
    let shadow = null;
    let wrap = null;
    let btn = null;
    let txt = null;
    let currentImg = null;
    let state = 'hidden';          // hidden | pending | shown | busy | done | fail
    let showTimer = 0;
    let hideTimer = 0;
    let resetTimer = 0;
    let clickSeq = 0;              // 失效化上一次点击的回调（换图/重开）

    /* ---------------- 设置 ---------------- */

    function applySettings(s) {
        enabled = !(s && s.imgHover === false);
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
  position: fixed; left: 0; top: 0; display: none;
  pointer-events: none; z-index: 2147483000;
  font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Microsoft YaHei", sans-serif;
  color: #fff;
}
.vr-wrap.on { display: block; }
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
        root.appendChild(style);
        root.appendChild(wrap);
        document.documentElement.appendChild(host);
        return true;
    }

    function teardown() {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
        clearTimeout(resetTimer);
        showTimer = hideTimer = resetTimer = 0;
        if (host && host.parentNode) { host.parentNode.removeChild(host); }
        host = shadow = wrap = btn = txt = null;
        currentImg = null;
        state = 'hidden';
    }

    function place(img) {
        if (!wrap) { return; }
        const r = img.getBoundingClientRect();
        const bw = wrap.offsetWidth || 96;
        const bh = wrap.offsetHeight || 30;
        const vw = document.documentElement.clientWidth || window.innerWidth;
        const vh = document.documentElement.clientHeight || window.innerHeight;
        // 右上角，内缩 8px；图片贴边时夹回视口
        let left = r.right - bw - 8;
        let top = r.top + 8;
        left = Math.max(4, Math.min(left, vw - bw - 4));
        top = Math.max(4, Math.min(top, vh - bh - 4));
        wrap.style.left = left + 'px';
        wrap.style.top = top + 'px';
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
        wrap.classList.add('on');
        setState('shown', '下载原图');
        btn.title = '下载原图';
        place(img);
        state = 'shown';
    }

    function hideNow() {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
        showTimer = hideTimer = 0;
        if (wrap) { wrap.classList.remove('on'); }
        currentImg = null;
        if (state !== 'busy') { state = 'hidden'; }
    }

    function scheduleHide() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            hideTimer = 0;
            if (state === 'shown') { hideNow(); }
        }, HIDE_DELAY);
    }

    /* ---------------- 悬停判定 ---------------- */

    function eligible(img) {
        if (!img || img.tagName !== 'IMG' || !img.isConnected) { return false; }
        if (host && (img === host || (host.contains && host.contains(img)))) { return false; }
        // 只认已成功解码的图：宽高属性可能只是占位（坏图/懒加载占位）
        const nw = Number(img.naturalWidth) || 0;
        const nh = Number(img.naturalHeight) || 0;
        if (nw < MIN || nh < MIN) { return false; }
        const raw = img.currentSrc || img.src || img.getAttribute('src') || '';
        const url = U.absolutize(raw, document.baseURI);
        if (!url) { return false; }
        if (U.isDataUri(url) || U.isSvgUrl(url) || U.isPlaceholderUrl(url)) { return false; }
        return true;
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
        const img = pickImg(ev);
        if (!img) { return; }
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
        }, SHOW_DELAY);
    }, true);

    document.addEventListener('mouseout', ev => {
        if (!enabled) { return; }
        if (fromHost(ev)) { return; }
        const img = pickImg(ev);
        if (!img || img !== currentImg) { return; }
        const to = ev.relatedTarget;
        if (to && host && (to === host || (host.contains && host.contains(to)))) { return; }
        if (state === 'shown' || state === 'pending') { scheduleHide(); }
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
})();
