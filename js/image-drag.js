/**
 * 苏哥的钓鱼竿 —— 图片拖拽下载 + 框选（AIX 的 dragDownload / boxSelect）
 *
 * 两个手势，都只在「按住了才开始」的前提下介入，平时零打扰：
 *   1) 从页面里拖一张图 → 松手在页面右下角浮出的接收区 → 存到默认目录
 *   2) 按住 Alt 拖出矩形 → 框内图片全部加入清单（不自动下载，先看再决定）
 *
 * 为什么框选要按 Alt：不按修饰键的拖拽是站点自己的「选中文字/拖动元素」，
 * 无条件接管会和站点交互打架（AIX 也是靠开关+修饰键控制）。
 *
 * 依赖：js/lib-image-util.js（VRImageUtil）。落盘走 vrImg.download。
 */
(() => {
    'use strict';
    if (self.__vrImgDragLoaded) { return; }
    self.__vrImgDragLoaded = true;

    const U = self.VRImageUtil;
    if (!U) { return; }

    const HOST_ID = 'vr-img-drag-host';
    const MIN_BOX = 24;              // 小于这个尺寸的拖动当误触，不框选
    let enabled = true;
    let boxEnabled = true;

    let host = null;
    let shadow = null;
    let dropZone = null;
    let rubber = null;
    let dragging = null;             // 正在拖的图片 URL
    let boxStart = null;             // 框选起点
    let boxEl = null;

    /* ---------------- 设置 ---------------- */

    function applySettings(s) {
        const o = s || {};
        enabled = o.imgDragDownload !== false;
        boxEnabled = o.imgBoxSelect !== false;
        if (!enabled && !boxEnabled) { teardown(); }
    }

    try {
        chrome.storage.local.get('vrLibSettings', res => applySettings(res && res.vrLibSettings));
        chrome.storage.onChanged.addListener((ch, area) => {
            if (area !== 'local' || !ch.vrLibSettings) { return; }
            applySettings(ch.vrLibSettings.newValue);
        });
    } catch (e) { /* 无 storage 时保持默认开 */ }

    /* ---------------- 样式 ---------------- */

    const CSS = `
:host { all: initial; }
.vr-drop {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483002;
  width: 190px; padding: 14px 14px 12px;
  border: 1px dashed rgba(232, 176, 75, .75);
  border-radius: 10px;
  background: rgba(25, 23, 21, .96);
  color: #EFEAE0;
  font: 500 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Microsoft YaHei", sans-serif;
  text-align: center;
  display: none;
  box-shadow: 0 12px 32px rgba(0, 0, 0, .55);
  transition: background .16s, border-color .16s, opacity .16s;
  pointer-events: none;
}
.vr-drop.on { display: block; }
.vr-drop.hit {
  background: rgba(44, 36, 24, .98);
  border-color: #E8B04B;
  border-style: solid;
}
.vr-drop .ico { font-size: 20px; color: #E8B04B; line-height: 1; margin-bottom: 6px; }
.vr-drop .t { color: #EFEAE0; font-weight: 600; }
.vr-drop .s { margin-top: 3px; font-size: 10.5px; color: #8C8478; }
.vr-drop .thumb {
  margin: 8px auto 0; width: 100%; height: 64px;
  border-radius: 4px; overflow: hidden; background: #2B2620;
  background-size: cover; background-position: center;
}
.vr-rubber {
  position: fixed; z-index: 2147483003; pointer-events: none;
  border: 1px solid #E8B04B;
  background: rgba(232, 176, 75, .12);
  border-radius: 2px;
  display: none;
}
.vr-rubber.on { display: block; }
.vr-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  z-index: 2147483004; pointer-events: none;
  padding: 8px 14px; border-radius: 8px;
  background: rgba(17, 15, 14, .96);
  border: 1px solid rgba(232, 176, 75, .45);
  color: #EFEAE0;
  font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Microsoft YaHei", sans-serif;
  opacity: 0; transition: opacity .2s;
}
.vr-toast.on { opacity: 1; }
`;

    /* ---------------- UI ---------------- */

    function ensureUI() {
        if (host) { return; }
        host = document.createElement('div');
        host.id = HOST_ID;
        host.style.cssText = 'position:fixed;inset:0;width:0;height:0;pointer-events:none;z-index:2147483002;';
        shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
        const root = shadow || host;

        const style = document.createElement('style');
        style.textContent = CSS;
        root.appendChild(style);

        dropZone = document.createElement('div');
        dropZone.className = 'vr-drop';
        dropZone.innerHTML =
            '<div class="ico">⤓</div>' +
            '<div class="t">松手保存这张图</div>' +
            '<div class="s">存到默认下载目录</div>' +
            '<div class="thumb" style="display:none"></div>';
        root.appendChild(dropZone);

        rubber = document.createElement('div');
        rubber.className = 'vr-rubber';
        root.appendChild(rubber);

        document.documentElement.appendChild(host);

        // 接收区必须真的能接住 drop：它默认 pointer-events:none 是为了不挡页面，
        // 拖动期间才打开（见 onDragStart）。
        dropZone.addEventListener('dragover', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            dropZone.classList.add('hit');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('hit'));
        dropZone.addEventListener('drop', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            dropZone.classList.remove('hit');
            dropZone.classList.remove('on');
            const url = dragging || pickUrlFromDataTransfer(ev.dataTransfer);
            dragging = null;
            if (url) { saveOne(url); }
        });
    }

    function toast(text) {
        if (!host) { return; }
        const root = shadow || host;
        let t = root.querySelector('.vr-toast');
        if (!t) {
            t = document.createElement('div');
            t.className = 'vr-toast';
            root.appendChild(t);
        }
        t.textContent = text;
        t.classList.add('on');
        clearTimeout(t.__timer);
        t.__timer = setTimeout(() => t.classList.remove('on'), 2600);
    }

    function teardown() {
        if (host && host.parentNode) { host.parentNode.removeChild(host); }
        host = shadow = dropZone = rubber = null;
        dragging = null;
        boxStart = null;
    }

    /* ---------------- 拖拽下载 ---------------- */

    /** 从 DataTransfer 里尽量捞出一个地址：uri-list 最可靠，其次 text/url、text/plain */
    function pickUrlFromDataTransfer(dt) {
        if (!dt) { return ''; }
        try {
            const uri = dt.getData('text/uri-list') || dt.getData('text/x-moz-url') || '';
            const first = String(uri).split(/\r?\n/).filter(Boolean)[0] || '';
            if (/^https?:/i.test(first)) { return first; }
            const plain = String(dt.getData('text/plain') || '').trim();
            if (/^https?:\/\/\S+$/i.test(plain)) { return plain; }
        } catch (e) { /* 某些站点禁止读取 */ }
        return '';
    }

    function onDragStart(ev) {
        if (!enabled) { return; }
        const t = ev.target;
        if (!t || t.tagName !== 'IMG') { return; }
        /* 拖拽是**用户显式动作**（主动按住拖走），门槛应与面板/框选一致用 PANEL_MIN_SHOW(48)，
         * 而不是悬停按钮那个 MIN_SHOW(500)。500 是「鼠标划过就别打扰」的克制门槛，
         * 拿它挡拖拽会让 260px 的正文配图直接拖不动（实测 DRAG shown=null）。
         * 框选在下面也用同一个值，两处口径必须一致。 */
        if (!U.isWorthDownloading(t, { minNatural: U.MIN_SIZE, minShow: U.PANEL_MIN_SHOW })) { return; }

        ensureUI();
        const cands = U.collectCandidates(t, document);
        dragging = (cands && cands.length) ? cands[0] : (t.currentSrc || t.src || '');
        if (!dragging) { return; }

        // 只在拖动期间打开命中区，平时完全不挡页面
        dropZone.style.pointerEvents = 'auto';
        dropZone.classList.add('on');
        const thumb = dropZone.querySelector('.thumb');
        if (thumb) {
            thumb.style.backgroundImage = 'url("' + String(t.currentSrc || t.src || '').replace(/"/g, '\\"') + '")';
            thumb.style.display = '';
        }
        // dragend 一定会来（无论落到哪里），上来就把界面收回去，避免残留
        const cleanup = () => {
            if (dropZone) {
                dropZone.classList.remove('on', 'hit');
                dropZone.style.pointerEvents = 'none';
            }
            dragging = null;
            document.removeEventListener('dragend', cleanup, true);
        };
        document.addEventListener('dragend', cleanup, true);
    }

    async function saveOne(url) {
        const pageTitle = String(document.title || '').replace(/\s+/g, ' ').trim().slice(0, 60) || '图片';
        try {
            chrome.runtime.sendMessage({
                Message: 'vrImg.download',
                action: 'vrImg.download',
                url: url,
                candidates: [url],
                title: pageTitle,
                pageUrl: location.href
            }, res => {
                void chrome.runtime.lastError;
                toast((res && res.ok) ? '已保存：' + pageTitle : '保存失败，换个方式试试');
            });
        } catch (e) { toast('保存失败：' + e); }
    }

    /* ---------------- 框选 ---------------- */

    function onMouseDown(ev) {
        if (!boxEnabled) { return; }
        // Alt + 左键：与站点默认的「选文字 / 拖元素」区分开
        if (ev.button !== 0 || !ev.altKey) { return; }
        const tag = (ev.target && ev.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (ev.target && ev.target.isContentEditable)) { return; }

        boxStart = { x: ev.clientX, y: ev.clientY };
        ensureUI();
        rubber.classList.add('on');
        paintRubber(boxStart.x, boxStart.y, boxStart.x, boxStart.y);
        ev.preventDefault();
    }

    function paintRubber(x1, y1, x2, y2) {
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        rubber.style.left = left + 'px';
        rubber.style.top = top + 'px';
        rubber.style.width = Math.abs(x2 - x1) + 'px';
        rubber.style.height = Math.abs(y2 - y1) + 'px';
    }

    function onMouseMove(ev) {
        if (!boxStart) { return; }
        paintRubber(boxStart.x, boxStart.y, ev.clientX, ev.clientY);
        ev.preventDefault();
    }

    function onMouseUp(ev) {
        if (!boxStart) { return; }
        const x1 = Math.min(boxStart.x, ev.clientX);
        const y1 = Math.min(boxStart.y, ev.clientY);
        const x2 = Math.max(boxStart.x, ev.clientX);
        const y2 = Math.max(boxStart.y, ev.clientY);
        boxStart = null;
        if (rubber) { rubber.classList.remove('on'); }

        if (Math.abs(x2 - x1) < MIN_BOX || Math.abs(y2 - y1) < MIN_BOX) { return; }

        const picked = [];
        const imgs = document.querySelectorAll('img');
        for (const img of imgs) {
            let box;
            try { box = img.getBoundingClientRect(); } catch (e) { continue; }
            // 用中心点判定：图片部分进入框内也算（避免大图只露出一角就选不中）
            const cx = box.left + box.width / 2;
            const cy = box.top + box.height / 2;
            if (cx < x1 || cx > x2 || cy < y1 || cy > y2) { continue; }
            if (!U.isWorthDownloading(img, { minNatural: U.MIN_SIZE, minShow: U.PANEL_MIN_SHOW })) { continue; }
            const cands = U.collectCandidates(img, document);
            const url = (cands && cands.length) ? cands[0] : (img.currentSrc || img.src || '');
            if (url) { picked.push({ url: url, candidates: (cands && cands.length) ? cands : [url] }); }
        }

        if (!picked.length) { toast('框内没有可下载的图片'); return; }

        // 交给 SW：直接把这一批加进清单页更符合「先看再决定」，
        // 但清单页在扩展上下文，跨上下文传大量数据没必要 —— 这里直接批量下载。
        const pageTitle = String(document.title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || '图片';
        try {
            chrome.runtime.sendMessage({
                Message: 'vrImg.batch',
                action: 'vrImg.batch',
                items: picked.map((p, i) => ({
                    url: p.url,
                    candidates: p.candidates,
                    title: pageTitle + '_' + String(i + 1).padStart(2, '0')
                })),
                pageUrl: location.href,
                pageTitle: pageTitle,
                concurrency: 2,
                batchId: 'box-' + Date.now()
            }, res => {
                void chrome.runtime.lastError;
                /* 回执里 succeeded 可能包含「已下载过、直接被跳过」的张数，
                 * 所以不能把它当成「新增了多少文件」四处报喜。 */
                const okN = res && typeof res.succeeded === 'number' ? res.succeeded : 0;
                const failN = res && typeof res.fail === 'number' ? res.fail : 0;
                if (!okN && !failN) { toast('框选提交 ' + picked.length + ' 张，稍后看下载管理'); return; }
                let msg = '框选 ' + picked.length + ' 张：成功 ' + okN;
                if (failN) { msg += '，失败 ' + failN; }
                toast(msg);
            });
        } catch (e) { toast('框选下载失败：' + e); }
    }

    /* Alt 键的视觉提示：按住 Alt 时鼠标变成十字，让人知道能框选 */
    function onKeyDown(ev) {
        if (!boxEnabled) { return; }
        if (ev.key === 'Alt') { document.documentElement.style.cursor = 'crosshair'; }
    }
    function onKeyUp(ev) {
        if (ev.key === 'Alt') { document.documentElement.style.cursor = ''; }
    }

    /* ---------------- 绑定 ---------------- */

    try {
        document.addEventListener('dragstart', onDragStart, true);
        document.addEventListener('mousedown', onMouseDown, true);
        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mouseup', onMouseUp, true);
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('keyup', onKeyUp, true);
    } catch (e) { /* 极端环境下不绑定 */ }

    self.VRImgDrag = {
        enabled() { return enabled; },
        boxEnabled() { return boxEnabled; }
    };
})();