/**
 * 苏哥的钓鱼竿 —— 抖音图文（/note/<id>）图片下载入口
 * ------------------------------------------------------------------
 * 苏哥 2026-11-09 报：「抖音图文页没有图片下载按钮，点扩展也嗅探不到本页内容」。
 *
 * 为什么必须单独做一个入口（真机取证见 deliverables/reviews/2026-11-09-抖音图文页诊断.md）：
 *  1. 图文作品的照片**不是 <img>**，是轮播每页那个 1369×876 的透明 <button> 的
 *     `background-image`。悬停按钮只绑 <img>，所以整页零入口；
 *     页面 DOM 里也没有「标题/作者/序号」这些能拿来命名的锚点。
 *  2. 真身（无水印 urlList + 真实宽高）只在 React Fiber 的 `awemeInfo.images[]` 里，
 *     和视频那条路同源 —— 见 js/douyin.js 的 noteFunc。
 *
 * 职责边界：
 *   · 取数：background.vrDouyinImages（主世界注入 Fiber 爬取）
 *   · 落盘：完全复用既有批量通道 self.VRImgBridge.download（image-batch.js）
 *   · 本文件只画一个按钮 + 组织 items（标题_序号），不碰命名/路径/下载实现
 *
 * 通用底线不受影响：侧边栏「抓图」对任何页面依旧可用（ADR-047 通用优先）。
 * 这里只是抖音图文的体验增强：看得见、点得到、名字对。
 */
(() => {
    'use strict';
    if (self.__vrDouyinNoteLoaded) { return; }
    self.__vrDouyinNoteLoaded = true;

    const HOST_ID = 'vr-note-host';
    const RETRY_MS = 1200;
    const MAX_RETRY = 4;

    let host = null;
    let shadow = null;
    let btn = null;
    let labelEl = null;
    let numEl = null;
    let meta = null;             // {awemeId,title,nickname,images[]}
    let loadedFor = '';          // 已经取过数的路径（防重复请求）
    let state = 'idle';          // idle | busy | done | warn
    let retry = 0;
    let retryTimer = 0;
    let rafId = 0;

    const ICON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
        '<path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
    const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M20 6L9 17l-5-5"/></svg>';
    const ICON_BAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 8v5"/><path d="M12 17h.01"/></svg>';

    const CSS = `
:host { all: initial; }
.vr-nd {
  position: fixed; z-index: 2147483000;
  display: none; align-items: center; gap: 7px;
  padding: 8px 12px 8px 10px; border-radius: 11px; border: 1px solid rgba(255,255,255,.16);
  background: rgba(18,20,24,.9); color: #fff; cursor: pointer;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  box-shadow: 0 4px 18px rgba(0,0,0,.42);
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Microsoft YaHei", sans-serif;
}
.vr-nd.on { display: inline-flex; }
.vr-nd:hover { background: rgba(37,99,235,.95); border-color: rgba(255,255,255,.3); }
.vr-nd svg { width: 17px; height: 17px; display: block; }
.vr-nd .t { white-space: nowrap; }
.vr-nd .n {
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: rgba(255,255,255,.16); color: #fff;
  font: 700 10.5px/18px -apple-system, "PingFang SC", sans-serif; text-align: center;
}
.vr-nd.busy { opacity: .7; pointer-events: none; }
.vr-nd.done { background: rgba(22,163,74,.95); }
.vr-nd.warn { background: rgba(185,28,28,.95); }
`;

    /* ---------------- UI ---------------- */

    function ensureUI() {
        if (host && host.isConnected) { return true; }
        if (!document.documentElement) { return false; }

        host = document.createElement('div');
        host.id = HOST_ID;
        host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;' +
            'pointer-events:none;z-index:2147483000;';
        shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
        const style = document.createElement('style');
        style.textContent = CSS;
        shadow.appendChild(style);

        btn = document.createElement('div');
        btn.className = 'vr-nd';
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        btn.title = '下载这个图文作品的全部图片（无水印）';
        const ico = document.createElement('span');
        ico.innerHTML = ICON_DOWN;
        labelEl = document.createElement('span');
        labelEl.className = 't';
        labelEl.textContent = '下载本作品图片';
        numEl = document.createElement('span');
        numEl.className = 'n';
        numEl.textContent = '0';
        btn.appendChild(ico);
        btn.appendChild(labelEl);
        btn.appendChild(numEl);
        /* 点击必须 capture + pointerup 双保险。
         * 2026-11-09 苏哥报「点了没反应」：抖音页面的全局事件监听偶发在捕获阶段
         * 截断冒泡，挂在按钮上的普通 click 监听收不到；自动化点一次能中、真人点
         * 不中，极难复现。capture 阶段先抢，pointerup 再兜一层（400ms 去重）。 */
        let lastFire = 0;
        const fire = ev => {
            try { ev.preventDefault(); ev.stopPropagation(); } catch (e) { /* 忽略 */ }
            const now = Date.now();
            if (now - lastFire < 400) { return; }     // click / pointerup 双触发去重
            lastFire = now;
            start();
        };
        btn.addEventListener('click', fire, true);
        btn.addEventListener('pointerup', fire, true);
        btn.addEventListener('keydown', ev => {
            if (ev.key === 'Enter' || ev.key === ' ') { fire(ev); }
        });
        /* 按钮自己会跟着容器走，鼠标进出不用收起来（它不是悬停态 UI） */
        btn.addEventListener('pointerdown', ev => ev.stopPropagation());

        shadow.appendChild(btn);
        document.documentElement.appendChild(host);
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        return true;
    }

    function teardown() {
        clearTimeout(retryTimer);
        retryTimer = 0;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        try {
            window.removeEventListener('scroll', place, true);
            window.removeEventListener('resize', place);
        } catch (e) { /* 忽略 */ }
        if (host && host.parentNode) { host.parentNode.removeChild(host); }
        host = shadow = btn = labelEl = numEl = null;
        meta = null;
        loadedFor = '';
        retry = 0;
        state = 'idle';
    }

    /* ---------------- 定位 ---------------- */

    /** 画在「画面左上角」：抖音图文把照片铺在轮播容器里，右侧是点赞/评论条、
     *  顶部是作者栏，左上角是唯一长期空旷的角（视频浮层用右上角，避免叠）。 */
    function place() {
        rafId = 0;
        if (!btn || !btn.classList.contains('on')) { return; }
        const box = document.querySelector('.basePlayerContainer') ||
            document.querySelector('[class*="note-detail-container"]') ||
            document.querySelector('main');
        if (!box) { return; }
        const r = box.getBoundingClientRect();
        if (r.width < 40 || r.height < 40 ||
            r.bottom < 60 || r.top > innerHeight - 40) {
            btn.style.visibility = 'hidden';
            return;
        }
        btn.style.visibility = 'visible';
        const bw = btn.offsetWidth || 140;
        const bh = btn.offsetHeight || 34;
        const left = Math.max(6, Math.min(r.left + 14, innerWidth - bw - 6));
        const top = Math.max(6, Math.min(r.top + 62, r.bottom - bh - 8));
        btn.style.left = Math.round(left) + 'px';
        btn.style.top = Math.round(top) + 'px';
    }

    function schedulePlace() {
        if (!rafId) { rafId = requestAnimationFrame(place); }
    }

    /* ---------------- 状态 ---------------- */

    function paint(st, text) {
        if (!btn) { return; }
        state = st || 'idle';
        btn.classList.toggle('busy', state === 'busy');
        btn.classList.toggle('done', state === 'done');
        btn.classList.toggle('warn', state === 'warn');
        const ico = btn.querySelector('svg');
        const icon = state === 'done' ? ICON_OK : state === 'warn' ? ICON_BAD : ICON_DOWN;
        if (ico) { ico.outerHTML = icon; }
        labelEl.textContent = text || (state === 'busy' ? '正在下载…'
            : state === 'done' ? '已开始下载'
                : state === 'warn' ? '下载失败，点我重试'
                    : '下载本作品图片');
    }

    function flash(st, ms, text) {
        paint(st, text);
        setTimeout(() => { if (state === st) { paint('idle'); } }, ms || 2200);
    }

    /* ---------------- 取数 ---------------- */

    function isNote() {
        return /^\/note\/\d{6,}/.test(location.pathname || '');
    }

    function ask() {
        return new Promise(resolve => {
            let done = false;
            const finish = v => { if (!done) { done = true; resolve(v); } };
            try {
                chrome.runtime.sendMessage({ Message: 'vrDouyinImages' }, res => {
                    void chrome.runtime.lastError;
                    finish(res && res.ok ? res.meta : null);
                });
            } catch (e) { finish(null); }
            setTimeout(() => finish(null), 9000);
        });
    }

    async function load(path) {
        loadedFor = path;
        const m = await ask();
        if (!isNote()) { teardown(); return; }
        if (!m || !m.images || !m.images.length) {
            /* 页面还没渲染完（SPA 首屏/接口慢）：退避重试，别在页面上留个 0 张的按钮 */
            if (retry < MAX_RETRY) {
                retry++;
                clearTimeout(retryTimer);
                retryTimer = setTimeout(() => {
                    if (loadedFor === path) { load(path); }
                }, RETRY_MS * retry);
            }
            return;
        }
        retry = 0;
        meta = m;
        if (!ensureUI()) { return; }
        numEl.textContent = String(m.images.length);
        btn.classList.add('on');
        btn.title = (m.title ? m.title.slice(0, 60) + '\n' : '') +
            '作者：' + (m.nickname || '未知') + '　共 ' + m.images.length + ' 张（无水印）';
        paint('idle');
        schedulePlace();
    }

    function check() {
        if (!isNote()) {
            if (host) { teardown(); }
            loadedFor = '';
            return;
        }
        const path = location.pathname;
        if (path !== loadedFor) {
            clearTimeout(retryTimer);
            retry = 0;
            load(path);
        }
        schedulePlace();
    }

    /* ---------------- 下载 ---------------- */

    function baseTitle() {
        const raw = String((meta && meta.title) || document.title || '抖音图文')
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/[\\/:*?"<>|]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return raw.slice(0, 60) || '抖音图文';
    }

    /** 统一提示出口：优先用批量模块的 toast，退化到按钮文案 */
    function say(text) {
        try {
            const B = self.VRImgBridge;
            if (B && typeof B.toast === 'function') { B.toast(text); return; }
        } catch (e) { /* 忽略 */ }
        try { labelEl.textContent = text; } catch (e2) { /* 忽略 */ }
    }

    function start() {
        if (state === 'busy') { return; }
        if (!meta || !meta.images || !meta.images.length) {
            /* 2026-11-09 苏哥报「点了没反应」：作品数据可能还没读到（Fiber 慢/被清空），
             * 原来这里只闪一下黄字就没了 —— 现在现场补读一次，补不到也明说。 */
            flash('busy', 1200, '正在读取作品…');
            load(location.pathname).then(() => {
                if (meta && meta.images && meta.images.length) { start(); }
                else { flash('warn', 3000, '没读到作品图片，点我重试'); }
            });
            return;
        }
        const B = self.VRImgBridge;
        if (!B || typeof B.download !== 'function') {
            /* 批量下载在设置里被关了：明说，别让按钮点了没反应 */
            try {
                if (B && typeof B.toast === 'function') { B.toast('图片批量下载已在设置里关闭'); }
                else { labelEl.textContent = '批量下载已关闭'; }
            } catch (e) { /* 忽略 */ }
            flash('warn', 2600);
            return;
        }
        const title = baseTitle();
        const items = meta.images.map((it, i) => ({
            url: it.url,
            candidates: (it.candidates && it.candidates.length) ? it.candidates : [it.url],
            /* 序号必须带：同名图会互相覆盖，用户也分不清哪张是哪张 */
            title: title + '_' + String(i + 1).padStart(2, '0')
        }));
        paint('busy');
        /* 作者与作品 ID 一起带下去：归档才能落到 <平台>/<作者>/ 而不是域名目录 */
        const authorFull = meta.nickname
            ? (meta.nickname + (meta.uniqueId ? '(@' + meta.uniqueId + ')' : ''))
            : '';
        B.download(items, {
            showBar: true,
            authorFull: authorFull,
            creatorId: meta.uniqueId || ''
        }).then(out => {
            /* 三种终态要分清楚，否则「全部已存在」会被显示成「已下载 15 张」——
             * 用户看到没新增文件，就会觉得点了没反应（2026-11-09 实报）。 */
            const okN = (out && out.succeeded) || 0;
            const skipN = (out && out.skipped) || 0;
            const failN = (out && out.fail) || 0;
            const fresh = Math.max(0, okN - skipN);
            if (failN && !fresh) {
                flash('warn', 4200, skipN ? '失败 ' + failN + ' 张，点我重试' : '下载失败，点我重试');
                say('有 ' + failN + ' 张没下来，稍后可以再点一次');
                return;
            }
            if (!fresh && skipN) {
                flash('done', 5000, '已存在 ' + skipN + ' 张');
                say('这 ' + skipN + ' 张之前下过了，没有重复下载');
                return;
            }
            if (skipN) {
                flash('done', 5000, '新下 ' + fresh + ' 张 · 已存在 ' + skipN);
                say('新下 ' + fresh + ' 张，另有 ' + skipN + ' 张已存在，已跳过');
                return;
            }
            flash('done', 5000, '已下载 ' + fresh + ' 张');
            say('已下载 ' + fresh + ' 张（资源库 · ' + (meta.nickname || '抖音') + '）');
        }).catch(() => { flash('warn', 4200, '下载失败，点我重试'); });
    }

    /* ---------------- 启动 / SPA 跟随 ---------------- */

    check();
    /* 抖音是 SPA：/note/a → /note/b 不刷新文档，content script 不会重跑。
     * 用低频轮询盯路径（1s 一次，开销可忽略），路由变了重新取数；同时顺便重定位。
     * 不用 MutationObserver：抖音信息流每秒几十次 DOM 变更，监听等于给自己找事。 */
    setInterval(check, 1000);
})();
