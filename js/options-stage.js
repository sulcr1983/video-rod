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

    /* ==========================================================
     * 图片过滤规则（域名 + 正则）
     * 数据存在 chrome.storage.local.vrLibSettings.imgFilterRules，
     * 与侧边栏图片页共用同一份 —— 在这里加的规则，清单里立刻生效。
     * ========================================================== */
    bindImgFilter();

    function bindImgFilter() {
        var listEl = document.getElementById('ImgFilterList');
        var hostEl = document.getElementById('ImgFilterHost');
        var reEl = document.getElementById('ImgFilterRe');
        var addBtn = document.getElementById('ImgFilterAdd');
        var expBtn = document.getElementById('ImgFilterExport');
        var impBtn = document.getElementById('ImgFilterImport');
        var fileEl = document.getElementById('ImgFilterFile');
        var noteEl = document.getElementById('ImgFilterNote');
        if (!listEl || !addBtn) { return; }

        var F = self.VRImgFilter;
        var rules = [];

        function read() {
            return new Promise(function (resolve) {
                try {
                    chrome.storage.local.get('vrLibSettings', function (o) {
                        void chrome.runtime.lastError;
                        var s = (o && o.vrLibSettings) || {};
                        rules = F ? F.normalizeRules(s.imgFilterRules) : (s.imgFilterRules || []);
                        resolve(rules);
                    });
                } catch (e) { rules = []; resolve([]); }
            });
        }

        function write() {
            return new Promise(function (resolve) {
                try {
                    chrome.storage.local.get('vrLibSettings', function (o) {
                        var s = Object.assign({}, (o && o.vrLibSettings) || {});
                        s.imgFilterRules = rules;
                        chrome.storage.local.set({ vrLibSettings: s }, function () {
                            void chrome.runtime.lastError;
                            resolve();
                        });
                    });
                } catch (e) { resolve(); }
            });
        }

        function render() {
            listEl.innerHTML = '';
            if (!rules.length) {
                noteEl.textContent = '还没有规则 —— 加一条就能把不想要的图永久挡在清单外';
                return;
            }
            var on = rules.filter(function (r) { return r.enabled !== false; }).length;
            noteEl.textContent = rules.length + ' 条规则，启用 ' + on + ' 条';

            rules.forEach(function (r, i) {
                var row = document.createElement('div');
                row.className = 'vr-rule' + (r.enabled === false ? ' off' : '');

                var ck = document.createElement('input');
                ck.type = 'checkbox';
                ck.checked = r.enabled !== false;
                ck.title = '启用/停用这条规则';
                ck.addEventListener('change', function () {
                    rules[i].enabled = ck.checked;
                    write().then(render);
                });

                var rh = document.createElement('span');
                rh.className = 'rh';
                rh.textContent = r.host === '*' ? '全网' : r.host;

                var rr = document.createElement('span');
                rr.className = 'rr';
                rr.textContent = r.re ? r.re : '（所有图片）';
                rr.title = r.re || '';

                var del = document.createElement('button');
                del.className = 'rdel';
                del.type = 'button';
                del.title = '删除这条规则';
                del.textContent = '✕';
                del.addEventListener('click', function () {
                    rules.splice(i, 1);
                    write().then(render);
                });

                row.appendChild(ck);
                row.appendChild(rh);
                row.appendChild(rr);
                row.appendChild(del);
                listEl.appendChild(row);
            });
        }

        addBtn.addEventListener('click', function () {
            var host = (hostEl.value || '').trim();
            var re = (reEl.value || '').trim();
            if (!host && !re) {
                noteEl.textContent = '域名和正则至少填一个';
                return;
            }
            if (F && re && !F.compilePattern(re)) {
                // 正则写错就地提示，不写进存储（否则这条规则永远不生效还查不出原因）
                noteEl.textContent = '正则写法有误：' + re + '（可写 ad_ 或 /\\.gif$/i）';
                return;
            }
            var rule = F ? F.normalizeRule({ host: host, re: re, enabled: true })
                         : { host: host || '*', re: re, enabled: true };
            if (!rule) { noteEl.textContent = '域名和正则至少填一个'; return; }
            rules.push(rule);
            hostEl.value = '';
            reEl.value = '';
            write().then(render);
        });

        // 回车即添加（输入框里更顺手）
        [hostEl, reEl].forEach(function (input) {
            if (!input) { return; }
            input.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter') { ev.preventDefault(); addBtn.click(); }
            });
        });

        if (expBtn) {
            expBtn.addEventListener('click', function () {
                if (!rules.length) { noteEl.textContent = '还没有规则可导出'; return; }
                var text = F ? F.exportRules(rules) : JSON.stringify({ rules: rules }, null, 2);
                var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = 'image-filter-rules.json';
                document.body.appendChild(a);
                a.click();
                setTimeout(function () {
                    try { document.body.removeChild(a); } catch (e) { /* 忽略 */ }
                    URL.revokeObjectURL(url);
                }, 1500);
                noteEl.textContent = '已导出 ' + rules.length + ' 条规则';
            });
        }

        if (impBtn && fileEl) {
            impBtn.addEventListener('click', function () { fileEl.click(); });
            fileEl.addEventListener('change', function () {
                var f = fileEl.files && fileEl.files[0];
                if (!f) { return; }
                var reader = new FileReader();
                reader.onload = function () {
                    var out = F ? F.importRules(String(reader.result || ''))
                                : { rules: [], skipped: 0, error: '规则模块未加载' };
                    if (out.error) { noteEl.textContent = '导入失败：' + out.error; return; }
                    if (!out.rules.length) { noteEl.textContent = '文件里没有可用的规则'; return; }
                    rules = rules.concat(out.rules);
                    write().then(function () {
                        render();
                        noteEl.textContent = '已导入 ' + out.rules.length + ' 条' +
                            (out.skipped ? '，跳过 ' + out.skipped + ' 条无效' : '');
                    });
                };
                reader.readAsText(f, 'utf-8');
                fileEl.value = '';
            });
        }

        read().then(render);
    }
})();
