window.addEventListener('DOMContentLoaded', function () {
    // 多语言支持
    let currentLang = 'zh';

    function setLanguage(lang) {
        currentLang = lang;

        // 设置活动语言
        document.querySelectorAll('.lang-zh').forEach(el => {
            el.classList.toggle('active', lang === 'zh');
        });
        document.querySelectorAll('.lang-en').forEach(el => {
            el.classList.toggle('active', lang === 'en');
        });

        // 更新语言切换按钮
        document.getElementById('langText').textContent = lang === 'zh' ? 'English' : '中文';
        document.getElementById('langEmoji').textContent = lang === 'zh' ? '🌐' : '🇨🇳';

        // 更新动态文本
        if (lang === 'en') {
            document.getElementById('main-title').textContent = 'Video Rod is ready';
            document.getElementById('subtitle').textContent = 'Catch, file, archive — all in one';
            document.getElementById('welcome-title').textContent = 'Your web media, in your own library';
            document.getElementById('privacy-title').textContent = 'Privacy Policy';
            document.getElementById('disclaimer-title').textContent = 'Disclaimer';
            document.getElementById('issue-title').textContent = 'Issue Submission';
            document.getElementById('agreeText').textContent = 'Agree';
            document.getElementById('uninstallText').textContent = 'Uninstall Extension';
        } else {
            document.getElementById('main-title').textContent = '苏哥的钓鱼竿 已就位';
            document.getElementById('subtitle').textContent = '抓取 → 归档 → 入库，一条龙';
            document.getElementById('welcome-title').textContent = '网页里的视频和图片，从此进你自己的库';
            document.getElementById('privacy-title').textContent = '隐私政策 / Privacy Policy';
            document.getElementById('disclaimer-title').textContent = '免责声明 / Disclaimer';
            document.getElementById('issue-title').textContent = '问题提交 / Issue Submission';
            document.getElementById('agreeText').textContent = '同意';
            document.getElementById('uninstallText').textContent = '卸载扩展';
        }
    }

    // 语言切换功能
    document.getElementById('langToggle').addEventListener('click', function () {
        const newLang = currentLang === 'zh' ? 'en' : 'zh';
        setLanguage(newLang);
    });

    // 按钮事件处理
    document.getElementById('agreeBtn').addEventListener('click', function () {
        closeTab();
    });

    document.getElementById('uninstallBtn').addEventListener('click', function () {
        chrome.management.uninstallSelf({ showConfirmDialog: true });
    });

    const lang = navigator.language || navigator.userLanguage;
    const isChinese = lang.startsWith('zh');
    setLanguage(isChinese ? 'zh' : 'en');

    // 添加动画效果
    document.querySelector('.card').classList.add('fade-in');
    document.getElementById('agreeBtn').focus();
});