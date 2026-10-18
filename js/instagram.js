/* 钓鱼竿 video-rod — Instagram P1
 * 只处理当前已加载的单帖/Reel 媒体；不自动翻页、不点开评论、不写操作。
 * 图片/视频直链由页面 DOM 读取，后台负责下载与 Referer 回放。
 */
(() => {
    'use strict';
    const POST_RE = /^\/(p|reel|tv)\/([^/?#]+)/;
    const BTN_ID = 'vr-ig-download-btn';
    let busy = false;

    function shortcode() {
        const m = location.pathname.match(POST_RE);
        return m ? m[2] : '';
    }
    function extOf(url, fallback) {
        try {
            const p = new URL(url).pathname;
            const m = p.match(/\.([a-z0-9]{2,5})$/i);
            if (m) {
                const e = m[1].toLowerCase();
                if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'm4v', 'mov', 'webm'].includes(e)) { return e === 'jpeg' ? 'jpg' : e; }
            }
        } catch (e) { /* ignore */ }
        return fallback;
    }
    function mediaKey(url) {
        try {
            const u = new URL(url);
            return u.origin + u.pathname;
        } catch (e) { return String(url || ''); }
    }
    function authorInfo() {
        const root = document.querySelector('article') || document.querySelector('main') || document;
        const links = [...root.querySelectorAll('header a[href^="/"], a[href^="/"]')];
        const a = links.find(x => !/^\/(explore|reels?|direct|accounts|stories|about|legal|privacy|terms)/.test(x.getAttribute('href') || ''));
        const author = a ? (a.textContent || '').trim().replace(/^@/, '') : '';
        const authorId = a ? (a.getAttribute('href') || '').split('/').filter(Boolean)[0] : '';
        return { author: author || 'instagram', authorId };
    }
    function caption(shortcodeValue) {
        const h1 = document.querySelector('article h1, main h1');
        const og = document.querySelector('meta[property="og:description"]');
        const text = (h1 && h1.innerText) || (og && og.content) || shortcodeValue || 'instagram';
        return String(text).replace(/\s+/g, ' ').trim().slice(0, 120);
    }
    function collect() {
        const sc = shortcode();
        if (!sc) { return { items: [], shortcode: '' }; }
        const { author, authorId } = authorInfo();
        const cap = caption(sc);
        const items = [];
        const seen = new Set();
        function add(kind, url, idx) {
            if (!url || !/^https?:/i.test(url)) { return; }
            if (/profile_pic|s150x150|s320x320|static\.cdninstagram/i.test(url)) { return; }
            const key = kind + '|' + mediaKey(url);
            if (seen.has(key)) { return; }
            seen.add(key);
            items.push({
                kind: kind,
                url: url,
                ext: extOf(url, kind === 'video' ? 'mp4' : 'jpg'),
                index: idx,
                author: author,
                authorId: authorId,
                filename: sc + '_' + String(idx + 1).padStart(2, '0'),
                shortcode: sc,
                caption: cap
            });
        }
        const root = document.querySelector('article') || document.querySelector('main') || document;
        root.querySelectorAll('img').forEach(img => {
            if (img.naturalWidth && img.naturalWidth < 200) { return; }
            add('image', img.currentSrc || img.src, items.length);
        });
        root.querySelectorAll('video').forEach(v => {
            let src = v.currentSrc || v.src || '';
            if (!/^https?:/i.test(src)) {
                const s = v.querySelector('source[src]');
                src = s ? s.src : '';
            }
            add('video', src, items.length);
        });
        return { items, shortcode: sc, author, authorId, caption: cap };
    }
    function toast(msg) {
        let el = document.getElementById('vr-ig-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'vr-ig-toast';
            el.style.cssText = 'position:fixed;right:20px;bottom:76px;z-index:2147483647;background:rgba(29,33,41,.94);color:#fff;border-radius:8px;padding:9px 13px;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.22);max-width:320px';
            document.documentElement.appendChild(el);
        }
        el.textContent = msg;
        el.style.display = 'block';
        clearTimeout(el._vrTimer);
        el._vrTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
    }
    function download() {
        if (busy) { return; }
        const data = collect();
        if (!data.items.length) {
            toast('未发现已加载媒体；视频若仍是 blob，请先点播放再试');
            return;
        }
        busy = true;
        const b = document.getElementById(BTN_ID);
        if (b) { b.textContent = '下载中…'; b.disabled = true; }
        chrome.runtime.sendMessage({ Message: 'vrIgDownload', items: data.items }, res => {
            busy = false;
            if (b) { b.textContent = '⬇ 下载当前帖'; b.disabled = false; }
            if (chrome.runtime.lastError || !res || !res.ok) {
                toast('下载失败：' + ((res && res.reason) || '后台未响应'));
                return;
            }
            toast('已下载 ' + (res.done || 0) + ' 个' + (res.failed ? '，失败 ' + res.failed : ''));
        });
    }
    function ensureButton() {
        const isPost = POST_RE.test(location.pathname);
        let b = document.getElementById(BTN_ID);
        if (!isPost) {
            if (b) { b.style.display = 'none'; }
            return;
        }
        if (!b) {
            b = document.createElement('button');
            b.id = BTN_ID;
            b.type = 'button';
            b.textContent = '⬇ 下载当前帖';
            b.title = '下载当前帖子已加载的图片/视频';
            b.style.cssText = 'position:fixed;right:20px;bottom:24px;z-index:2147483647;border:0;border-radius:10px;padding:10px 14px;background:linear-gradient(135deg,#405de6,#c13584);color:#fff;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 6px 20px rgba(64,93,230,.35);cursor:pointer';
            b.addEventListener('click', download);
            document.documentElement.appendChild(b);
        }
        b.style.display = 'block';
    }
    ensureButton();
    setInterval(ensureButton, 1200);
})();
