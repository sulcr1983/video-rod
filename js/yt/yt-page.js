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
            '<span class="tip">苏哥的钓鱼竿 · 支持 1080p / 4K</span>' +
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
            btn.querySelector('span').textContent = '打开中…';
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
                    btn.querySelector('span').textContent = ok ? '已打开' : '打开失败';
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

    schedule();
})();
