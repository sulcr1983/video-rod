/* ==========================================================
 * 设置页 · 舞台章节外壳（2026-11-05 原型纠偏）
 *
 * 真源：deliverables/prototypes/settings-stage-v1.html
 *   顶部窄条 + 左侧 3 组章节导航 + 主区单章内容 + 24px 衬线标题
 *
 * 重要：这是**非破坏性外壳**。
 *   - options.html 里 18 个旧 section、所有 input/select、猫抓原生 init.js
 *     的读写逻辑全部原样保留，一个 DOM 都不删。
 *   - 旧 .sidebar 只是隐藏，不 remove；章节按钮点击时切 section 显隐。
 *   - 未显式归类的 section 一律进「高级工具」，保证没有设置项被丢掉。
 * ========================================================== */
(function () {
    'use strict';

    /* 章节定义：顺序与文字严格按原型 364-377 行 */
    var GROUPS = [
        {
            key: 'dl', label: '保存位置', group: '下载',
            sub: '决定文件存在哪、怎么分文件夹。改完点右下角保存。',
            ids: ['anchorLibrary']
        },
        {
            key: 'name', label: '文件命名', group: '下载',
            sub: '文件名怎么生成、哪些资源要收进来。',
            ids: ['anchorReplaceTags', 'anchorSuffix', 'anchorType']
        },
        {
            key: 'quality', label: '画质与合并', group: '下载',
            sub: '下载器与 m3u8 合并的行为。',
            ids: ['anchorDownloader', 'anchorM3u8Parser']
        },
        {
            key: 'lib', label: '索引与扫描', group: '资源库',
            sub: '图片与资源的扫描入库规则。',
            ids: ['anchorImage']
        },
        {
            key: 'play', label: '查看与连播', group: '资源库',
            sub: '页面操作与复制行为。',
            ids: ['anchorOperation', 'anchorCopy']
        },
        {
            key: 'theme', label: '外观', group: '资源库',
            sub: '界面显示与自定义样式。',
            ids: ['anchorCustomCSS', 'anchorOtherSettings']
        },
        {
            key: 'keys', label: '快捷键', group: '其他',
            sub: '脚本、屏蔽与匹配规则。',
            ids: ['anchorScriptSettings', 'anchorBlockUrl', 'anchorRegexMatch']
        },
        {
            key: 'adv', label: '高级工具', group: '其他',
            sub: '外部下载器、协议调用与关于。',
            ids: ['anchorAria2Rpc', 'anchorSend2local', 'anchorM3u8dl',
                  'anchorInvokeApp', 'anchorAbout']
        }
    ];

    function q(sel, root) { return (root || document).querySelector(sel); }
    function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    var sections = qa('main.content section[id]');
    if (!sections.length) { return; }

    /* 原型「保存位置」主区只有一张卡：路径 + 分层开关。
     * anchorLibrary 里原本还挂着「索引」卡，把它**移动**（不是删除）到
     * 「索引与扫描」章节，元素与所有 input id 原样保留，读写逻辑不受影响。 */
    var libSec = document.getElementById('anchorLibrary');
    var imgSec = document.getElementById('anchorImage');
    if (libSec && imgSec) {
        var libCards = qa('.card', libSec);
        libCards.slice(1).forEach(function (c) { imgSec.appendChild(c); });
    }

    /* 未归类的 section 自动进「高级工具」，绝不遗漏 */
    var mapped = {};
    GROUPS.forEach(function (g) { g.ids.forEach(function (id) { mapped[id] = g.key; }); });
    sections.forEach(function (sec) {
        if (!mapped[sec.id]) { GROUPS[GROUPS.length - 1].ids.push(sec.id); mapped[sec.id] = 'adv'; }
    });

    /* 顶部窄条（原型 .top，54px） */
    var top = document.createElement('header');
    top.className = 'stage-top';
    top.innerHTML =
        '<div class="stage-brand"><span class="brand-mark">VR</span>' +
        '<strong>苏哥的钓鱼竿</strong><small>设置</small></div>' +
        '<span class="stage-spacer"></span>' +
        '<button class="stage-back" id="vrStageBackLib">打开资源库</button>';
    document.body.insertBefore(top, document.body.firstChild);

    /* 左侧 3 组章节导航（原型 .side / .side-group / .side-label / button[data-go]） */
    var side = document.createElement('nav');
    side.className = 'stage-side';
    side.setAttribute('aria-label', '设置章节');
    var html = '', lastGroup = '';
    GROUPS.forEach(function (g, i) {
        if (g.group !== lastGroup) {
            if (lastGroup) { html += '</div>'; }
            html += '<div class="side-group"><div class="side-label">' + g.group + '</div>';
            lastGroup = g.group;
        }
        var n = g.ids.filter(function (id) { return !!document.getElementById(id); }).length;
        html += '<button type="button" data-go="' + g.key + '"' + (i === 0 ? ' class="on"' : '') + '>' +
                g.label + '<span class="n">' + n + '</span></button>';
    });
    html += '</div>';
    side.innerHTML = html;
    document.body.insertBefore(side, top.nextSibling);

    /* 主区标题（原型 #pageTitle / .sub） */
    var title = q('#pageTitle');
    var sub = q('#pageSub');

    function show(key, scrollToAnchor) {
        var g = GROUPS.filter(function (x) { return x.key === key; })[0];
        if (!g) { return; }
        sections.forEach(function (sec) {
            sec.classList.toggle('vr-stage-off', mapped[sec.id] !== key);
        });
        qa('.stage-side button[data-go]').forEach(function (b) {
            b.classList.toggle('on', b.getAttribute('data-go') === key);
        });
        if (title) { title.textContent = g.label; }
        if (sub) { sub.textContent = g.sub; }
        if (scrollToAnchor) {
            var target = document.getElementById(scrollToAnchor);
            if (target && target.scrollIntoView) { target.scrollIntoView({ block: 'start' }); }
        } else {
            window.scrollTo(0, 0);
        }
    }

    side.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-go]');
        if (!b) { return; }
        show(b.getAttribute('data-go'));
    });

    /* 「打开资源库」沿用扩展内页面 */
    var back = q('#vrStageBackLib');
    if (back) {
        back.addEventListener('click', function () {
            try { window.open(chrome.runtime.getURL('library.html'), '_blank'); }
            catch (e) { location.href = 'library.html'; }
        });
    }

    /* 兼容旧锚点：带 #anchorX 打开时自动切到它所在章节，不丢直达链接 */
    var anchor = (location.hash || '').replace(/^#/, '');
    if (anchor && mapped[anchor]) {
        show(mapped[anchor], anchor);
    } else {
        show('dl');
    }
    window.addEventListener('hashchange', function () {
        var a = (location.hash || '').replace(/^#/, '');
        if (a && mapped[a]) { show(mapped[a], a); }
    });
})();
