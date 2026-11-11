/* ==========================================================
 * VRCtxMenu —— 卡片右键菜单（2026-11-06）
 *
 * 为什么不用 js/library/trash-ui.js：那套是旧版库页的 DOM
 * （#libGrid / #libTrashDrawer / #libConfirmMask），当前 library.html
 * 没有这些节点，直接挂上去会报空指针。这里复用库页已有的
 * 重命名 / 移动 / 删除 / 收藏 / 星标实现，只补一层菜单。
 *
 * 依赖（全部可选，缺了就隐藏对应项）：
 *   VRFile.resolve   读本地文件（Google 识图上传要用）
 *   VRPreview        打开详情
 *   showToast        提示
 *
 * 零依赖、ES5，挂 self.VRCtxMenu。
 * ========================================================== */
(function (root) {
    'use strict';

    var M = { open: false, entry: null, items: [], idx: -1 };
    var H = {};                 // 由 app.js 注入的回调

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /** 菜单项定义：type 决定图标，filter 决定是否出现 */
    function buildItems(f) {
        var isImage = f.kind === 'image' || f.kind === 'anim' || f.kind === 'live';
        var items = [
            { act: 'preview', label: '打开预览', icon: 'i-maximize' },
            { act: 'rename', label: '重命名', icon: 'i-pencil' },
            { act: 'move', label: '移动到…', icon: 'i-folder-input' },
            { act: 'reveal', label: '在文件夹中定位', icon: 'i-folder-open' },
            { sep: true },
            { act: 'fav', label: f.inFav ? '取消收藏' : '加入收藏', icon: 'i-bookmark' },
            { act: 'star', label: f.starred ? '取消星标' : '加星标', icon: 'i-star' }
        ];
        /* 图片才给「Google 识图」：视频发过去没意义，还会传一大堆字节 */
        if (isImage) {
            items.push({ act: 'gimage', label: '用 Google 识图', icon: 'i-search' });
        }
        items.push({ sep: true });
        items.push({ act: 'delete', label: '移到回收站', icon: 'i-trash-2', danger: true });
        return items;
    }

    function render() {
        var box = $('vrCtxMenu');
        if (!box) { return; }
        var html = M.items.map(function (it, i) {
            if (it.sep) { return '<div class="vr-ctx-sep"></div>'; }
            return '<button type="button" class="vr-ctx-item' + (it.danger ? ' danger' : '') + '"' +
                ' data-idx="' + i + '" role="menuitem">' +
                '<svg class="i"><use href="#' + it.icon + '"/></svg>' +
                '<span>' + esc(it.label) + '</span></button>';
        }).join('');
        box.innerHTML = html;
    }

    function place(x, y) {
        var box = $('vrCtxMenu');
        if (!box) { return; }
        box.hidden = false;
        var w = box.offsetWidth || 200;
        var h = box.offsetHeight || 260;
        var left = x, top = y;
        if (left + w > window.innerWidth - 8) { left = window.innerWidth - w - 8; }
        if (top + h > window.innerHeight - 8) { top = window.innerHeight - h - 8; }
        box.style.left = Math.max(8, left) + 'px';
        box.style.top = Math.max(8, top) + 'px';
    }

    function close() {
        var box = $('vrCtxMenu');
        if (box) { box.hidden = true; }
        M.open = false;
        M.entry = null;
        M.items = [];
    }

    /**
     * @param {object} card 卡片模型（relPath / kind / title / absPath / mediaUrl…）
     * @param {number} x
     * @param {number} y
     */
    function open(card, x, y) {
        if (!card) { return; }
        M.entry = card;
        M.items = buildItems(card);
        M.open = true;
        M.idx = -1;
        render();
        place(x, y);
        var first = $('vrCtxMenu').querySelector('.vr-ctx-item');
        if (first) { first.focus(); }
    }

    /* ---------------- Google 识图 ---------------- */

    /** 把本地文件变成可以 POST 的 Blob；拿不到就返回 null */
    async function fileBlob(f) {
        if (!root.VRFile) { return null; }
        var r = null;
        try { r = await root.VRFile.resolve(f); } catch (e) { r = null; }
        if (!r || !r.url) { return null; }
        try {
            if (r.file) {
                /* 已经是 File/Blob（句柄路径），直接用，少一次 decode */
                return { blob: r.file, revoke: r.revoke || null };
            }
            var resp = await fetch(r.url);
            var blob = await resp.blob();
            return { blob: blob, revoke: r.revoke || null };
        } catch (e) {
            return null;
        }
    }

    /**
     * Google 识图：lens 的上传接口是 POST /v3/upload，浏览器会自动跳转到结果页。
     * 不能只给 URL——本地素材在 file:// 下 Google 抓不到，必须把字节传上去。
     */
    async function googleImage(f) {
        if (f.kind !== 'image' && f.kind !== 'anim' && f.kind !== 'live') {
            toast('只有图片可以识图');
            return;
        }
        var got = await fileBlob(f);
        if (!got || !got.blob) {
            toast('读不到本地文件，无法上传识图');
            return;
        }
        toast('正在打开 Google 识图…');
        try {
            var fd = new FormData();
            var name = String(f.relPath || 'image').split('/').pop() || 'image.png';
            fd.append('encoded_image', got.blob, name);
            fd.append('image_content', '');

            /* 隐藏表单 POST：新标签打开结果页，不离开资源库。
             * 直接 fetch 会被 CORS 拦住，只有顶层表单提交能跟着 302 走。
             * target 用显式窗口名，避免程序化 submit 被当成弹窗拦截。 */
            var winName = 'vr_lens_' + Date.now();
            try { window.open('', winName); } catch (e) { /* 拦截了就退回 _blank */ }
            var form = document.createElement('form');
            form.method = 'POST';
            form.action = 'https://lens.google.com/v3/upload?stcs=' + Date.now();
            form.target = winName;
            form.enctype = 'multipart/form-data';
            form.style.display = 'none';
            form.appendChild(fdField(fd));
            document.body.appendChild(form);
            try { form.submit(); } catch (e) { toast('打开失败：' + ((e && e.message) || e)); }
            setTimeout(function () { try { form.remove(); } catch (e) { /* 忽略 */ } }, 1000);
        } catch (e) {
            toast('识图失败：' + ((e && e.message) || e));
        } finally {
            if (got.revoke) { try { got.revoke(); } catch (e) { /* 忽略 */ } }
        }
    }

    /** FormData 不能直接 append 到 form，需要转成隐藏 input（file 用 DataTransfer 塞） */
    function fdField(fd) {
        var wrap = document.createElement('div');
        wrap.style.display = 'none';
        fd.forEach(function (val, key) {
            if (typeof val === 'string') {
                var inp = document.createElement('input');
                inp.type = 'hidden'; inp.name = key; inp.value = val;
                wrap.appendChild(inp);
                return;
            }
            /* Blob/File：用一个 file input 塞进去 */
            try {
                var dt = new DataTransfer();
                var name = (val && val.name) || 'image.png';
                dt.items.add(val instanceof File ? val : new File([val], name, { type: (val && val.type) || 'image/png' }));
                var fi = document.createElement('input');
                fi.type = 'file';
                fi.name = key;
                fi.files = dt.files;
                wrap.appendChild(fi);
            } catch (e) { /* DataTransfer 不可用：识别会失败，下方统一提示 */ }
        });
        return wrap;
    }

    function toast(msg) {
        try {
            if (typeof H.toast === 'function') { H.toast(msg); }
        } catch (e) { /* 忽略 */ }
    }

    /* ---------------- 动作分发 ---------------- */

    async function run(act) {
        var f = M.entry;
        if (!f) { return; }
        close();
        try {
            if (act === 'preview') {
                if (root.VRPreview && root.VRPreview.open) { root.VRPreview.open(f, H.list ? H.list() : [f]); }
                else if (H.preview) { H.preview(f); }
                return;
            }
            if (act === 'rename') { if (H.rename) { H.rename(f); } return; }
            if (act === 'move') { if (H.move) { await H.move(f); } return; }
            if (act === 'reveal') { if (H.reveal) { H.reveal(f); } return; }
            if (act === 'fav') { if (H.fav) { await H.fav(f); } return; }
            if (act === 'star') { if (H.star) { await H.star(f); } return; }
            if (act === 'delete') { if (H.remove) { await H.remove(f); } return; }
            if (act === 'gimage') { await googleImage(f); return; }
        } catch (e) {
            toast('操作失败：' + ((e && e.message) || e));
        }
    }

    /* ---------------- 绑定 ---------------- */

    function init(hooks) {
        H = hooks || {};
        var box = $('vrCtxMenu');
        if (box) {
            box.addEventListener('click', function (ev) {
                var b = ev.target.closest('[data-idx]');
                if (!b) { return; }
                var it = M.items[Number(b.getAttribute('data-idx'))];
                if (it && it.act) { run(it.act); }
            });
            box.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
        }

        document.addEventListener('click', function (ev) {
            if (!M.open) { return; }
            if (ev.target.closest && ev.target.closest('#vrCtxMenu')) { return; }
            close();
        }, true);

        document.addEventListener('contextmenu', function (ev) {
            var card = ev.target.closest && ev.target.closest('#grid .card');
            if (!card) { return; }
            ev.preventDefault();
            var id = card.getAttribute('data-id');
            var f = H.find ? H.find(id) : null;
            if (!f) { return; }
            var r = card.getBoundingClientRect();
            open(f, ev.clientX || r.left, ev.clientY || r.top);
        });

        document.addEventListener('keydown', function (ev) {
            if (!M.open) { return; }
            var items = Array.prototype.slice.call($('vrCtxMenu').querySelectorAll('.vr-ctx-item'));
            if (ev.key === 'Escape') { close(); ev.preventDefault(); return; }
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                ev.preventDefault();
                if (!items.length) { return; }
                M.idx = (M.idx + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[M.idx].focus();
                return;
            }
            if (ev.key === 'Enter' && document.activeElement && document.activeElement.dataset.idx) {
                ev.preventDefault();
                document.activeElement.click();
            }
        });

        window.addEventListener('scroll', function () { if (M.open) { close(); } }, true);
        window.addEventListener('resize', function () { if (M.open) { close(); } });
    }

    root.VRCtxMenu = {
        init: init,
        open: open,
        close: close,
        _googleImage: googleImage,
        _buildItems: buildItems
    };
})(typeof self !== 'undefined' ? self : this);
