window.addEventListener('DOMContentLoaded', function () {
    // 多语言：文案全部写在 HTML 的 .lang-zh / .lang-en 里，这里只切 active
    let currentLang = 'zh';

    function setLanguage(lang) {
        currentLang = lang;

        document.querySelectorAll('.lang-zh').forEach(el => {
            el.classList.toggle('active', lang === 'zh');
        });
        document.querySelectorAll('.lang-en').forEach(el => {
            el.classList.toggle('active', lang === 'en');
        });

        document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
        document.title = lang === 'zh' ? '苏哥的钓鱼竿 · 安装完成' : "Su Ge's Video Rod · Installed";

        const btnText = document.getElementById('langText');
        const btnEmoji = document.getElementById('langEmoji');
        if (btnText) btnText.textContent = lang === 'zh' ? 'English' : '中文';
        if (btnEmoji) btnEmoji.textContent = lang === 'zh' ? '🌐' : '🇨🇳';
    }

    const langToggle = document.getElementById('langToggle');
    if (langToggle) {
        langToggle.addEventListener('click', function () {
            setLanguage(currentLang === 'zh' ? 'en' : 'zh');
        });
    }

    // ---------- 邮箱点击即复制 ----------
    const toast = document.getElementById('toast');
    let toastTimer = null;

    function showToast(text) {
        if (!toast) return;
        toast.textContent = text;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
    }

    function copyText(text) {
        // 剪贴板 API 在无焦点/受限上下文里可能既不 resolve 也不 reject，
        // 所以加 600ms 超时兜底，超时或失败都走 execCommand
        const direct = (navigator.clipboard && navigator.clipboard.writeText)
            ? navigator.clipboard.writeText(text).then(() => true).catch(() => false)
            : Promise.resolve(false);

        const timeout = new Promise(resolve => setTimeout(() => resolve(false), 600));

        return Promise.race([direct, timeout]).then(ok => (ok ? true : fallbackCopy(text)));
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (e) {
            ok = false;
        }
        ta.remove();
        return ok;
    }

    const copyBtn = document.querySelector('.copy-mail');
    if (copyBtn) {
        const hintZh = copyBtn.querySelector('.lang-zh');
        const hintEn = copyBtn.querySelector('.lang-en');
        const originZh = hintZh ? hintZh.textContent : '';
        const originEn = hintEn ? hintEn.textContent : '';

        copyBtn.addEventListener('click', function () {
            const mail = copyBtn.getAttribute('data-copy') || '';
            copyText(mail).then(ok => {
                if (!ok) {
                    showToast(currentLang === 'zh' ? '复制失败，请手动复制 ' + mail : 'Copy failed: ' + mail);
                    return;
                }
                copyBtn.classList.add('copied');
                if (hintZh) hintZh.textContent = '已复制';
                if (hintEn) hintEn.textContent = 'copied';
                showToast(currentLang === 'zh' ? '邮箱已复制：' + mail : 'Email copied: ' + mail);
                setTimeout(function () {
                    copyBtn.classList.remove('copied');
                    if (hintZh) hintZh.textContent = originZh;
                    if (hintEn) hintEn.textContent = originEn;
                }, 1800);
            });
        });
    }

    // ---------- 按钮 ----------
    const agreeBtn = document.getElementById('agreeBtn');
    if (agreeBtn) {
        agreeBtn.addEventListener('click', function () {
            closeTab();
        });
    }

    const uninstallBtn = document.getElementById('uninstallBtn');
    if (uninstallBtn) {
        uninstallBtn.addEventListener('click', function () {
            chrome.management.uninstallSelf({ showConfirmDialog: true });
        });
    }

    const lang = navigator.language || navigator.userLanguage || 'zh';
    setLanguage(lang.toLowerCase().startsWith('zh') ? 'zh' : 'en');

    /* ==========================================================
     * 媒体库入口（ADR-078）：装完必须让用户知道主界面在哪
     *
     * 为什么地址不能写死在 HTML 里：本扩展没给 manifest 加 "key"，
     * 未打包扩展的 ID 由**加载路径**派生 —— 换个文件夹装就是另一个 ID。
     * 所以地址必须运行时取（chrome.runtime.getURL）。
     * ========================================================== */
    const libUrlBox = document.getElementById('vrLibUrl');
    const libCopyBtn = document.getElementById('vrLibCopy');
    const libOpenBtn = document.getElementById('vrLibOpen');
    const libBmBtn = document.getElementById('vrLibBookmark');

    let libUrl = '';
    try { libUrl = chrome.runtime.getURL('library.html'); } catch (e) { libUrl = ''; }
    if (libUrlBox && libUrl) {
        libUrlBox.textContent = libUrl;
        libUrlBox.title = libUrl;
    }

    /* 复制：先试 Clipboard API，失败退回 execCommand（复用上面的 copyText） */
    if (libCopyBtn && libUrl) {
        const copyZh = libCopyBtn.querySelector('.lang-zh');
        const copyEn = libCopyBtn.querySelector('.lang-en');
        libCopyBtn.addEventListener('click', function () {
            copyText(libUrl).then(function (ok) {
                if (!ok) {
                    /* 剪贴板被拒时选中文本让用户 Ctrl+C，别卡住 */
                    if (libUrlBox) {
                        const r = document.createRange();
                        r.selectNodeContents(libUrlBox);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(r);
                    }
                    showToast(currentLang === 'zh' ? '请按 Ctrl+C 复制' : 'Press Ctrl+C to copy');
                    return;
                }
                if (copyZh) copyZh.textContent = '已复制';
                if (copyEn) copyEn.textContent = 'Copied';
                showToast(currentLang === 'zh' ? '媒体库地址已复制' : 'Library address copied');
                setTimeout(function () {
                    if (copyZh) copyZh.textContent = '复制地址';
                    if (copyEn) copyEn.textContent = 'Copy';
                }, 1800);
            });
        });
    }

    /* 打开媒体库：新标签页（不是弹窗，关掉也一直在） */
    if (libOpenBtn && libUrl) {
        libOpenBtn.addEventListener('click', function () {
            try { chrome.tabs.create({ url: libUrl }); }
            catch (e) { window.open(libUrl, '_blank'); }
        });
    }

    /* 加收藏夹：
     *   · 必须先 search 查重 —— 实测连点两次会真的产生两条一样的书签，
     *     浏览器不查重（见 tools/probe-bookmark-popup.py 的 Q3）。
     *   · 父节点 '1' = 书签栏（Edge/Chrome 一致）。
     *   · 没 bookmarks 权限时明确告知，不静默失败。 */
    function setBmDone(zh, en) {
        if (!libBmBtn) return;
        libBmBtn.classList.add('done');
        libBmBtn.dataset.done = '1';
        const zhEl = libBmBtn.querySelector('.lang-zh');
        const enEl = libBmBtn.querySelector('.lang-en');
        if (zhEl && zh) zhEl.textContent = zh;
        if (enEl && en) enEl.textContent = en;
    }

    function bmRestore() {
        if (!libBmBtn) return;
        const zhEl = libBmBtn.querySelector('.lang-zh');
        const enEl = libBmBtn.querySelector('.lang-en');
        if (zhEl) zhEl.textContent = '加入收藏夹';
        if (enEl) enEl.textContent = 'Add to bookmarks';
    }

    if (libBmBtn && libUrl) {
        const api = (typeof chrome !== 'undefined') ? chrome.bookmarks : null;

        if (!api || typeof api.create !== 'function') {
            libBmBtn.textContent = '';
            libBmBtn.textContent = '无书签权限';
            libBmBtn.disabled = true;
        } else {
            /* 进页面先查一次：已经收藏过就直接显示终态，避免用户重复加 */
            try {
                api.search({ url: libUrl }, function (items) {
                    if (chrome.runtime.lastError) return;
                    if (items && items.length) setBmDone('✓ 已在收藏夹', '✓ Bookmarked');
                });
            } catch (e) { /* 忽略：查不到就当没加过 */ }

            libBmBtn.addEventListener('click', function () {
                if (libBmBtn.dataset.done === '1') return;   // 已加过，不再写第二条

                function doCreate() {
                    try {
                        api.create({ parentId: '1', title: '媒体库 · 苏哥的钓鱼竿', url: libUrl },
                            function (node) {
                                const err = chrome.runtime.lastError;
                                if (err) {
                                    bmRestore();
                                    showToast((currentLang === 'zh' ? '添加失败：' : 'Failed: ') + err.message);
                                    return;
                                }
                                setBmDone('✓ 已在收藏夹', '✓ Bookmarked');
                                showToast(currentLang === 'zh'
                                    ? '已放进收藏夹栏，以后点一下就进来'
                                    : 'Added to your bookmarks bar');
                            });
                    } catch (e) {
                        bmRestore();
                        showToast(currentLang === 'zh' ? '添加失败：' + e.message : 'Failed: ' + e.message);
                    }
                }

                /* 点之前再查一次：用户可能在另一个标签页已经加过了 */
                try {
                    api.search({ url: libUrl }, function (items) {
                        if (chrome.runtime.lastError) { doCreate(); return; }
                        if (items && items.length) {
                            setBmDone('✓ 已在收藏夹', '✓ Bookmarked');
                            showToast(currentLang === 'zh' ? '这个地址已经在收藏夹里了' : 'Already bookmarked');
                            return;
                        }
                        doCreate();
                    });
                } catch (e) { doCreate(); }
            });
        }
    }

    if (agreeBtn) agreeBtn.focus();
});
