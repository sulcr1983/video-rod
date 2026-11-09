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

    if (agreeBtn) agreeBtn.focus();
});
