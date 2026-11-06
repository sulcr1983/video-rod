/**
 * 钓鱼竿 video-rod — 小红书主页/收藏/点赞「半手动收集」
 * ------------------------------------------------------------------
 * 只收集当前页面已经渲染的笔记卡片，不自动滚动/翻页/打开详情；
 * 用户手动滚动后点「收集当前页」入队。
 *
 * 自动补全详情默认关闭：开启后由 background 逐篇打开详情、
 * 读取 __INITIAL_STATE__ 并下载；3–5 秒/篇，不设条数上限。
 */
(() => {
    if (window.__vrXhsBatch) { return; }
    if (!/(^|\.)xiaohongshu\.com$/i.test(location.hostname)) { return; }
    if (!/^\/user\/profile\//.test(location.pathname)) { return; }
    window.__vrXhsBatch = true;

    const KEY = 'vrXhsQueue';
    let queue = [];
    let btn = null, panel = null, listEl = null, statusEl = null;
    let autoEl = null, downloadBtn = null, running = false, runTimer = 0;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function cardsOnPage() {
        const out = new Map();
        document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/user/profile/"]').forEach(a => {
            let u;
            try { u = new URL(a.href, location.href); } catch (e) { return; }
            const m = u.pathname.match(/\/(?:explore|discovery\/item)\/([0-9a-f]{16,})/) ||
                u.pathname.match(/\/user\/profile\/[0-9a-f]+\/([0-9a-f]{16,})/);
            if (!m) { return; }
            const id = m[1];
            const token = u.searchParams.get('xsec_token') || '';
            const prev = out.get(id);
            // 同一卡片常有隐藏 /explore/id（无 token）和可见封面链接（带 token）。
            // 后出现的 token 必须补到已有记录上，不能因为先看到隐藏链接就丢掉。
            if (prev) {
                if (token && !prev.xsecToken) { prev.xsecToken = token; }
                return;
            }
            const card = a.closest('section, article, li') ||
                a.closest('div[class*="note"], div[class*="cover"]') || a;
            const img = card.querySelector('img') || a.querySelector('img');
            const title = (img && (img.alt || img.title)) ||
                (card.innerText || '').split('\n').map(x => x.trim()).filter(Boolean)[0] || '未命名笔记';
            const isVideo = !!card.querySelector('video, [class*="play"], [class*="video"]');
            out.set(id, {
                noteId: id,
                xsecToken: token,
                title: title.slice(0, 120),
                cover: (img && img.src) || '',
                type: isVideo ? 'video' : 'image',
                page: location.href,
                collectedAt: Date.now()
            });
        });
        return [...out.values()];
    }

    function load() {
        try {
            chrome.storage.local.get(KEY, res => {
                queue = (res && res[KEY]) || [];
                if (!Array.isArray(queue)) { queue = []; }
                render();
                setStatus('共 ' + queue.length + ' 条；手动滚动不会自动翻页');
            });
        } catch (e) { render(); }
    }

    function save() {
        try { chrome.storage.local.set({ [KEY]: queue.slice(-500) }); } catch (e) { /* ignore */ }
    }

    function setStatus(text) {
        if (statusEl) { statusEl.textContent = text; }
    }

    function render() {
        if (!btn) { return; }
        btn.textContent = '小红书批量 (' + queue.length + ')';
        if (!listEl) { return; }
        const items = queue.slice(-30).reverse();
        listEl.innerHTML = items.length ? items.map(n =>
            '<div class="vr-xhs-row"><span class="dot ' + (n.type === 'video' ? 'video' : '') + '"></span>' +
            '<span class="t" title="' + esc(n.title) + '">' + esc(n.title) + '</span>' +
            '<span class="ty">' + (n.type === 'video' ? '视频' : '图片') + '</span></div>'
        ).join('') : '<div class="vr-xhs-empty">还没有收集。手动滚动页面后点「收集当前页」。</div>';
        if (statusEl && !statusEl.textContent) {
            statusEl.textContent = '共 ' + queue.length + ' 条；手动滚动不会自动翻页';
        }
        if (downloadBtn) { downloadBtn.disabled = !queue.length || running; }
    }

    function ensureUI() {
        if (btn) { return; }
        const style = document.createElement('style');
        style.textContent = `
.vr-xhs-btn{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147483001;border:0;border-radius:10px 0 0 10px;background:linear-gradient(180deg,#ff2442,#c8102e);color:#fff;font:600 12px/1.2 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:14px 8px;box-shadow:-4px 6px 22px rgba(200,16,46,.25);cursor:pointer;writing-mode:vertical-rl;letter-spacing:.08em}
.vr-xhs-btn:hover{background:linear-gradient(180deg,#e11d38,#a90c25)}
.vr-xhs-panel{position:fixed;right:0;top:0;bottom:0;z-index:2147483002;width:360px;max-width:100vw;height:100vh;max-height:none;display:flex;flex-direction:column;background:#fff;color:#1d2129;border-left:1px solid #e5e8ef;box-shadow:-12px 0 40px rgba(15,23,42,.18);font:12px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden}
.vr-xhs-panel.hidden{display:none}
.vr-xhs-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #eef1f6;font-size:13px;background:linear-gradient(90deg,#fff5f7,#fff)}
.vr-xhs-head button{border:0;background:transparent;color:#86909c;font-size:20px;cursor:pointer;line-height:1}
.vr-xhs-tip{padding:8px 16px;color:#86909c;font-size:10.5px;background:#f7f9fc}
.vr-xhs-actions{display:flex;gap:7px;padding:10px 16px}
.vr-xhs-actions button,.vr-xhs-foot button{border:1px solid #e5e8ef;background:#fff;color:#344054;border-radius:6px;padding:6px 9px;font-size:11px;cursor:pointer}
.vr-xhs-actions button.primary{background:#ff2442;border-color:#ff2442;color:#fff}
.vr-xhs-actions button:hover,.vr-xhs-foot button:hover{border-color:#ffb3c0;color:#ff2442}
.vr-xhs-auto{display:flex;gap:7px;align-items:flex-start;padding:0 16px 9px;color:#86909c;font-size:10.5px;cursor:pointer}
.vr-xhs-auto input{accent-color:#ff2442;margin-top:2px}
.vr-xhs-list{flex:1;max-height:none;overflow:auto;border-top:1px solid #eef1f6;border-bottom:1px solid #eef1f6}
.vr-xhs-row{display:flex;align-items:center;gap:7px;padding:8px 12px;border-bottom:1px solid #f4f6f9}
.vr-xhs-row:last-child{border-bottom:0}
.vr-xhs-row .dot{width:6px;height:6px;border-radius:50%;background:#1677ff;flex:0 0 6px}
.vr-xhs-row .dot.video{background:#ff2442}
.vr-xhs-row .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#344054}
.vr-xhs-row .ty{color:#a0a8b4;font-size:9.5px}
.vr-xhs-empty{padding:22px 14px;color:#a0a8b4;text-align:center}
.vr-xhs-foot{display:flex;align-items:center;gap:6px;padding:10px 12px;background:#f7f9fc;border-top:1px solid #eef1f6;flex-wrap:wrap}
.vr-xhs-foot span{flex:1;color:#86909c;font-size:10.5px}
.vr-xhs-foot button{background:#fff}
.vr-xhs-foot button[data-collect-download]{background:#ff2442;border-color:#ff2442;color:#fff;font-weight:600}
.vr-xhs-foot button[data-collect-download]:hover{background:#e11d38;border-color:#e11d38;color:#fff}
.vr-xhs-foot button:disabled{opacity:.45;cursor:default}
@media(max-width:520px){.vr-xhs-panel{right:0;left:0;width:auto}.vr-xhs-btn{right:0;top:45%;bottom:auto}}
`;
        document.documentElement.appendChild(style);

        btn = document.createElement('button');
        btn.className = 'vr-xhs-btn';
        btn.type = 'button';
        btn.textContent = '小红书批量 (0)';
        btn.addEventListener('click', () => {
            const closed = panel.classList.contains('hidden');
            panel.classList.toggle('hidden', !closed);
            btn.style.display = closed ? 'none' : '';
        });
        document.documentElement.appendChild(btn);

        panel = document.createElement('div');
        panel.className = 'vr-xhs-panel';
        panel.innerHTML =
            '<div class="vr-xhs-head"><b>小红书主页收集</b><button type="button" data-close>×</button></div>' +
            '<div class="vr-xhs-tip">手动滚动页面，只收集已渲染卡片；不自动翻页、不点赞/收藏。</div>' +
            '<div class="vr-xhs-actions"><button type="button" class="primary" data-collect>收集当前页</button>' +
            '<button type="button" data-clear>清空</button></div>' +
            '<label class="vr-xhs-auto"><input type="checkbox" data-auto> 自动补全详情（默认关闭；会逐篇打开详情，有风控风险）</label>' +
            '<div class="vr-xhs-list" data-list></div>' +
            '<div class="vr-xhs-foot"><span data-status>共 0 条；手动滚动不会自动翻页</span>' +
            '<button type="button" data-collect-download>收集并下载</button>' +
            '<button type="button" data-download>下载队列</button></div>';
        document.documentElement.appendChild(panel);

        listEl = panel.querySelector('[data-list]');
        statusEl = panel.querySelector('[data-status]');
        autoEl = panel.querySelector('[data-auto]');
        downloadBtn = panel.querySelector('[data-download]');

        panel.querySelector('[data-close]').addEventListener('click', () => {
            panel.classList.add('hidden');
            btn.style.display = '';
        });
        panel.querySelector('[data-collect]').addEventListener('click', collect);
        panel.querySelector('[data-collect-download]').addEventListener('click', function () {
            collect();
            if (!queue.length) { setStatus('没有收集到笔记：先手动滚动页面再点'); return; }
            /* 按钮写着「收集并下载」，就不该因为一个默认关闭的勾选框变成只收集。
             * 点它视为用户明确要下载，自动勾上并继续。 */
            if (!autoEl.checked) {
                autoEl.checked = true;
                setStatus('已自动开启「自动补全详情」，开始下载…');
            }
            download();
        });
        panel.querySelector('[data-clear]').addEventListener('click', () => {
            if (queue.length && confirm('清空已收集的 ' + queue.length + ' 条笔记？')) {
                queue = []; save(); setStatus('已清空'); render();
            }
        });
        downloadBtn.addEventListener('click', download);
        render();
        btn.style.display = 'none';
    }

    function collect() {
        const found = cardsOnPage();
        let added = 0;
        found.forEach(n => {
            if (!queue.some(q => q.noteId === n.noteId)) {
                queue.push(n);
                added++;
            }
        });
        save();
        render();
        setStatus('本页识别 ' + found.length + ' 条，新增 ' + added + ' 条，共 ' + queue.length + ' 条');
    }

    function resetRunning() {
        running = false;
        if (runTimer) { clearTimeout(runTimer); runTimer = 0; }
        if (downloadBtn) { downloadBtn.disabled = !queue.length; }
    }
    /** 长任务回执可能丢失；90 秒没有进度就解锁按钮，避免永久「无反应」 */
    function armWatchdog() {
        if (runTimer) { clearTimeout(runTimer); }
        runTimer = setTimeout(function () {
            if (!running) { return; }
            resetRunning();
            setStatus('后台 90 秒没有进度，可能已中断；已完成的文件不会重复下载，可直接重试');
        }, 90000);
    }
    function download() {
        if (!queue.length || running) { return; }
        if (!autoEl || !autoEl.checked) {
            setStatus('请手动逐篇打开笔记；开启「自动补全详情」可批量（有风控风险）');
            return;
        }
        running = true;
        if (downloadBtn) { downloadBtn.disabled = true; }
        armWatchdog();
        setStatus('自动补全中：' + queue.length + ' 条，3–5 秒/篇…');
        try {
            chrome.runtime.sendMessage({
                Message: 'vrXhsAuto',
                notes: queue.slice()
            }, res => {
                resetRunning();
                if (chrome.runtime.lastError || !res || !res.ok) {
                    setStatus('自动补全失败：' + (res && res.reason ? res.reason : '请查看扩展日志'));
                    return;
                }
                var f = res.files || 0, sk = res.skipped || 0, er = res.errors || 0;
                if (!f && sk && !er) {
                    setStatus('没有新文件：' + sk + ' 条都已下载过（同来源自动跳过；若文件被手动移动，请先在资源库重扫）');
                } else {
                    setStatus('完成：' + f + ' 个文件，跳过 ' + sk +
                        '，' + er + ' 篇失败' + (res.stopped ? '；' + res.stopped : ''));
                }
                render();
            });
        } catch (e) {
            resetRunning();
            setStatus('无法连接后台：' + String(e).slice(0, 80));
        }
    }

    try {
        chrome.runtime.onMessage.addListener(msg => {
            if (!msg || msg.Message !== 'vrXhsAutoProgress') { return; }
            armWatchdog();
            if (msg.finished || (msg.total && msg.done >= msg.total) || msg.stop) {
                resetRunning();
            }
            if (msg.finished) {
                var f = msg.files || 0, sk = msg.skipped || 0, er = msg.errors || 0;
                setStatus((!f && sk && !er)
                    ? ('没有新文件：' + sk + ' 条都已下载过（同来源自动跳过；若文件被手动移动，请先在资源库重扫）')
                    : ('完成：' + f + ' 个文件，跳过 ' + sk + '，' + er + ' 篇失败' +
                        (msg.stop ? '；' + msg.stop : '')));
                render();
                return;
            }
            setStatus('自动补全 ' + msg.done + '/' + msg.total +
                '，已下载 ' + (msg.files || 0) + ' 个' +
                (msg.skipped ? '，跳过重复 ' + msg.skipped : '') +
                (msg.errors ? '，失败 ' + msg.errors + ' 篇' : '') +
                (msg.stop ? '；' + msg.stop : ''));
        });
    } catch (e) { /* ignore */ }

    ensureUI();
    load();
})();
