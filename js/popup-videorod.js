/**
 * 苏哥的钓鱼竿 video-rod — popup 交互层（M1）
 * ---------------------------------------------------------------
 * 定位：只做「外壳与交互」，猫抓内核算术（嗅探/下载器/m3u8）一行不动。
 * 依赖：popup.js 已把卡片渲染到 DOM，本文件在其之后加载，负责：
 *   1) 顶部页面信息条（站点/标题/数量）
 *   2) 类型筛选（全部/视频/图片/流媒体）——用独立 class，不与猫抓扩展名筛选打架
 *   3) 底部主操作栏（全选 / 批量命名 / 批量下载计数）
 *   4) 批量命名弹层（走 M0 的 naming.js）
 *   5) 目录 chip + 迷你菜单（默认目录 / 最近 / 新建）
 *   6) 设置抽屉 + 更多工具抽屉
 *   7) 页面识别（content 侧注入 naming.js 提取 作者/正文 → 智能起名）
 */
(function () {
    'use strict';

    if (typeof document === 'undefined') { return; }

    /* ==========================================================
     * 一、设置：存在 chrome.storage.local，键名 vrSettings
     * ========================================================== */

    var DEFAULTS = {
        defaultDir: 'video-rod',
        template: '${author}_${title}',
        imgSniff: true,
        smartName: true,
        qualityAuto: true,
        dedupe: true,
        m3u8Merge: true,
        badge: true,
        libraryEnabled: true
    };

    var settings = Object.assign({}, DEFAULTS);
    var recentDirs = [];
    var pageInfo = null;
    var hasPageInfo = false;

    function loadSettings(cb) {
        try {
            chrome.storage.local.get(['vrSettings', 'vrRecentDirs'], function (res) {
                if (res && res.vrSettings) {
                    settings = Object.assign({}, DEFAULTS, res.vrSettings);
                }
                if (res && Array.isArray(res.vrRecentDirs)) {
                    recentDirs = res.vrRecentDirs.slice(0, 4);
                }
                cb && cb();
            });
        } catch (e) {
            cb && cb();
        }
    }

    function saveSettings() {
        try {
            chrome.storage.local.set({ vrSettings: settings, vrRecentDirs: recentDirs });
        } catch (e) { /* 忽略：隐私模式下可能不可写 */ }
    }

    function el(id) { return document.getElementById(id); }

    function tip(text) {
        if (typeof Tips === 'function') { Tips(text, 1400); }
    }

    /* ==========================================================
     * 二、目录：vrDirOf / vrOpenDirMenu（被 popup.js 的卡片调用）
     * ========================================================== */

    function sanitizeDir(d) {
        return String(d || '')
            .replace(/\\/g, '/')
            .replace(/[<>:"|?*]/g, '')
            .replace(/^\/+|\/+$/g, '')
            .replace(/\/{2,}/g, '/')
            .replace(/^\.+/, '')
            .trim();
    }

    window.vrDirOf = function (data) {
        // 手动选过目录的条目优先；否则按「子目录/平台/博主/类型」自动拼
        if (data && data.vrDir) { return data.vrDir; }
        var P = window.VRPath;
        if (P && P.buildRelDir) {
            try {
                return P.buildRelDir({
                    pageUrl: (data && data.webUrl) || '',
                    mediaUrl: data && data.url,
                    site: pageInfo && pageInfo.site,
                    authorFull: pageInfo && pageInfo.authorFull,
                    creatorId: pageInfo && pageInfo.creatorId,
                    type: data && (data.type || data.mediaType),
                    ext: data && data.ext,
                    subdir: settings.defaultDir
                });
            } catch (e) { /* 出错退回默认目录，不阻断下载 */ }
        }
        return settings.defaultDir;
    };

    window.vrOpenDirMenu = function (anchor, data) {
        var menu = el('vrDirMenu');
        if (!menu) { return; }

        var cur = window.vrDirOf(data);
        var html = '<div class="grouplbl">默认目录</div>' +
            '<button data-d="' + esc(settings.defaultDir) + '" class="' + (cur === settings.defaultDir ? 'cur' : '') + '">📁 ' + esc(settings.defaultDir) + '/</button>';

        if (recentDirs.length) {
            html += '<div class="grouplbl">最近使用</div>';
            recentDirs.forEach(function (d) {
                html += '<button data-d="' + esc(d) + '" class="' + (cur === d ? 'cur' : '') + '">📁 ' + esc(d) + '/</button>';
            });
        }
        html += '<div class="grouplbl"></div><button class="newdir" data-d="__new">新建文件夹…</button>';
        menu.innerHTML = html;

        var r = anchor.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 216)) + 'px';
        menu.style.top = '0px';
        menu.classList.add('on');

        // 先量高度再定位：下方放不下就翻到 chip 上方，避免被窗口裁掉
        var mh = menu.offsetHeight || 190;
        var top = r.bottom + 5;
        if (top + mh > window.innerHeight - 8) {
            top = r.top - mh - 5;
        }
        menu.style.top = Math.max(8, top) + 'px';
        menu._vrTarget = data;
    };

    function applyDir(dir) {
        var targets = vrCheckedData();
        if (targets.length) {
            targets.forEach(function (d) {
                d.vrDir = dir;
                d.html.find('.vr-dir-txt').text(dir);
            });
            tip('已修改 ' + targets.length + ' 个文件的目录 → ' + dir + '/');
        } else {
            tip('先勾选要改目录的文件');
        }
        rememberDir(dir);
    }

    function rememberDir(dir) {
        if (!dir) { return; }
        recentDirs = [dir].concat(recentDirs.filter(function (d) { return d !== dir; })).slice(0, 4);
        saveSettings();
    }

    function bindDirMenu() {
        var menu = el('vrDirMenu');
        if (!menu) { return; }
        menu.addEventListener('click', function (e) {
            var b = e.target.closest('button');
            if (!b) { return; }
            menu.classList.remove('on');
            var d = b.getAttribute('data-d');
            if (d === '__new') {
                var name = prompt('新建文件夹名（建在 ' + settings.defaultDir + '/ 下）：', '新文件夹');
                if (name) {
                    applyDir(sanitizeDir(settings.defaultDir + '/' + name));
                }
                return;
            }
            applyDir(d);
        });
        document.addEventListener('click', function (e) {
            if (!e.target.closest('[data-vr-dir]') && !e.target.closest('#vrDirMenu')) {
                menu.classList.remove('on');
            }
        });
    }

    /* ==========================================================
     * 三、视图开合：设置视图（全屏）/ 高级工具抽屉
     * ========================================================== */

    function openDrawer(id) {
        closeDrawers();
        var d = el(id);
        if (d) { d.classList.add('on'); }
    }

    function closeDrawers() {
        document.querySelectorAll('.drawer.on, .setview.on').forEach(function (d) { d.classList.remove('on'); });
    }

    function bindDrawers() {
        var btnSettings = el('btnSettings');
        var btnAdvTools = el('vrAdvTools');
        var btnSidePanel = el('vrSidePanel');
        if (btnSettings) { btnSettings.addEventListener('click', function () { openDrawer('vrSettings'); }); }
        if (btnAdvTools) { btnAdvTools.addEventListener('click', function () { openDrawer('vrTools'); }); }
        if (btnSidePanel) {
            btnSidePanel.addEventListener('click', function () {
                // 侧边栏（M10）：不影响图标行为，随时把面板挪到浏览器侧边。
                // 注意：sidePanel.open() 必须传真实 windowId——WINDOW_ID_CURRENT(-2)
                // 会被拒（"No window with id: -2"，官方文档要求 windowId/tabId 至少一个）。
                // windows.getCurrent 的异步间隙在用户激活 5 秒窗口内，手势仍有效
                // （星愿真机 Input 真点击实测通过）。
                if (!chrome.sidePanel || !chrome.sidePanel.open) {
                    tip('当前浏览器不支持侧边栏');
                    return;
                }
                var doOpen = function (wid) {
                    if (wid === undefined || wid === null) { tip('打不开侧边栏：找不到窗口'); return; }
                    try {
                        // 必须用 Promise 形态：星愿（Twinkstar）实测 callback 形态
                        // 静默不生效，Promise 形态才真正打开面板
                        var ret = chrome.sidePanel.open({ windowId: wid });
                        if (ret && typeof ret.then === 'function') {
                            ret.then(null, function (e) {
                                tip('打不开侧边栏：' + ((e && e.message) || e));
                            });
                        }
                    } catch (e2) { tip('打不开侧边栏：' + e2); }
                };
                try {
                    chrome.windows.getCurrent(function (win) {
                        if (!chrome.runtime.lastError && win && win.id !== undefined) {
                            doOpen(win.id);
                            return;
                        }
                        // 兜底：拿焦点窗口或任意窗口
                        chrome.windows.getAll(function (wins) {
                            var w = wins && (wins.filter(function (x) { return x.focused; })[0] || wins[0]);
                            doOpen(w && w.id);
                        });
                    });
                } catch (e) { tip('打不开侧边栏：' + e); }
            });
        }

        document.querySelectorAll('[data-close]').forEach(function (x) {
            x.addEventListener('click', function () { closeDrawers(); });
        });

        // 工具抽屉里的「筛选/更多功能」是浮层面板，先关抽屉再开面板
        ['openFilter', 'more'].forEach(function (id) {
            var b = el(id);
            if (!b) { return; }
            b.addEventListener('click', function () { closeDrawers(); });
        });

        document.addEventListener('click', function (e) {
            if (!e.target.closest('.drawer') && !e.target.closest('.setview') && !e.target.closest('.iconbtn')) { closeDrawers(); }
        });
    }

    /* 媒体库入口跟随「启用媒体库」开关一起显示/隐藏。
     * 注意要连抽屉里那个一起管——历史上两处共用 vrOpenLibrary 一个 id，
     * getElementById 只认第一个，导致关掉开关后抽屉按钮照旧显示（ADR-078 已修）。 */
    function applyLibraryVisibility() {
        var hide = settings.libraryEnabled === false;
        ['vrOpenLibrary', 'vrOpenLibraryDrawer', 'vrOpenLibrarySettings'].forEach(function (id) {
            var b = el(id);
            if (b) { b.style.display = hide ? 'none' : ''; }
        });
    }

    function syncSettingsUI() {
        var map = {
            vrSetDefaultDir: settings.defaultDir,
            vrSetTemplate: settings.template
        };
        Object.keys(map).forEach(function (id) {
            var input = el(id);
            if (input) { input.value = map[id]; }
        });
        var toggles = {
            vrSetImg: 'imgSniff',
            vrSetSmart: 'smartName',
            vrSetQuality: 'qualityAuto',
            vrSetDedupe: 'dedupe',
            vrSetMerge: 'm3u8Merge',
            vrSetBadge: 'badge',
            vrSetLibrary: 'libraryEnabled'
        };
        Object.keys(toggles).forEach(function (id) {
            var box = el(id);
            if (box) { box.checked = !!settings[toggles[id]]; }
        });
        var ignoreBox = el('vrIgnoreDone');
        if (ignoreBox) { ignoreBox.checked = !!settings.dedupe; }
        applyLibraryVisibility();
        // 侧边栏开关是猫抓底座设置（storage.sync 的 sidePanel 键，init.js 接管
        // setPanelBehavior），不走 vrSettings，单独异步读
        var spBox = el('vrSetSidePanel');
        if (spBox) {
            try {
                chrome.storage.sync.get('sidePanel', function (res) {
                    if (!chrome.runtime.lastError) { spBox.checked = !!res.sidePanel; }
                });
            } catch (e) { /* 老版本无 sync 时忽略 */ }
        }
    }

    function bindSettingsInputs() {
        var dirInput = el('vrSetDefaultDir');
        if (dirInput) {
            dirInput.addEventListener('change', function () {
                var oldDefault = settings.defaultDir;
                settings.defaultDir = sanitizeDir(this.value) || DEFAULTS.defaultDir;
                this.value = settings.defaultDir;
                saveSettings();
                refreshDirChips(oldDefault);
            });
        }

        var tplInput = el('vrSetTemplate');
        if (tplInput) {
            tplInput.addEventListener('change', function () {
                settings.template = (this.value || '').trim() || DEFAULTS.template;
                this.value = settings.template;
                saveSettings();
                applySmartNaming(true);
            });
        }

        var toggles = {
            vrSetImg: 'imgSniff',
            vrSetSmart: 'smartName',
            vrSetQuality: 'qualityAuto',
            vrSetDedupe: 'dedupe',
            vrSetMerge: 'm3u8Merge',
            vrSetBadge: 'badge',
            vrSetLibrary: 'libraryEnabled'
        };
        Object.keys(toggles).forEach(function (id) {
            var box = el(id);
            if (!box) { return; }
            box.addEventListener('change', function () {
                settings[toggles[id]] = this.checked;
                saveSettings();
                if (toggles[id] === 'smartName') { applySmartNaming(true); }
                if (toggles[id] === 'badge') { applyBadgeVisibility(); }
                if (toggles[id] === 'libraryEnabled') { applyLibraryVisibility(); }
                if (toggles[id] === 'dedupe') {
                    var ig = el('vrIgnoreDone');
                    if (ig) { ig.checked = this.checked; }
                    applyIgnoreDone();
                }
            });
        });

        // 侧边栏开关（M10）：写 storage.sync 的 sidePanel 键，init.js 的
        // storage.onChanged 监听会自动调 setPanelBehavior 改变图标行为
        var spBox = el('vrSetSidePanel');
        if (spBox) {
            spBox.addEventListener('change', function () {
                var on = this.checked;
                try {
                    chrome.storage.sync.set({ sidePanel: on }, function () {
                        tip(on ? '已开：点工具栏图标进侧边栏（想回弹窗模式就关掉）'
                            : '已关：点工具栏图标还是弹小面板');
                    });
                } catch (e) { tip('设置失败：' + e); }
            });
        }
    }

    function refreshDirChips(oldDefault) {
        vrAllData().forEach(function (d) {
            if (!d || !d.html) { return; }
            // 只更新「没单独指定过」的（仍跟随默认目录的）卡片
            if (d.vrDir && d.vrDir !== oldDefault) { return; }
            d.vrDir = settings.defaultDir;
            d.html.find('.vr-dir-txt').text(settings.defaultDir);
        });
    }

    function applyBadgeVisibility() {
        // 徽章由猫抓 background 自己维护，这里不抢方向盘；
        // 设置里的开关留给 M5 统一接管 action badge 时启用。
    }

    function badgeTextFor(n) {
        if (!n) { return ''; }
        return n > 99 ? '99+' : String(n);
    }

    /* ==========================================================
     * 四、页面信息条
     * ========================================================== */

    function hostOf(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
    }

    function fillPageInfo() {
        var tabId = (window.G && G.tabId) || -1;
        if (tabId < 0) { return; }
        try {
            chrome.tabs.get(tabId, function (tab) {
                if (chrome.runtime.lastError || !tab) { return; }
                var site = hostOf(tab.url || '');
                // 扩展页上下文里 host 是扩展 ID，会当作站点名泄漏到 UI（审查 P1）。
                // 原型这条显示的是站点名；扩展页就显示「本地扩展页」。
                if (/^chrome-extension:/i.test(tab.url || '') || (site && site.indexOf('.') < 0)) {
                    site = '本地扩展页';
                }
                var siteEl = el('vrSite');
                var titleEl = el('vrPageTitle');
                if (siteEl && site) { siteEl.textContent = site; siteEl.title = tab.url || ''; }
                if (titleEl) { titleEl.textContent = tab.title || ''; titleEl.title = tab.title || ''; }
            });
        } catch (e) { /* 忽略 */ }
    }

    /** 注入 naming.js 到页面，提取 作者/正文/标题（智能起名用） */
    function fetchPageInfo(tryCount) {
        var attempt = tryCount || 0;
        var tabId = (window.G && G.tabId) || -1;
        if (!chrome.scripting || tabId < 0) { return Promise.resolve(null); }

        return currentPageUrl().then(function (pageUrl) {
            return chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['js/naming.js']
            }).then(function () {
                return chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: function () {
                        return self.VideoRodNaming
                            ? self.VideoRodNaming.extractPageInfo(document, location.href)
                            : null;
                    }
                });
            }).then(function (res) {
                var info = res && res[0] && res[0].result;
                if (!info) { return null; }
                info.site = info.site || hostOf(pageUrl);
                return info;
            });
        }).catch(function () {
            // 页面还在加载 / 正在跳转时会失败，隔一拍重试（最多 3 次）
            if (attempt >= 2) { return null; }
            return new Promise(function (resolve) {
                setTimeout(function () {
                    fetchPageInfo(attempt + 1).then(resolve);
                }, 700);
            });
        });
    }

    /* ==========================================================
     * 五、数据访问（复用 popup.js 的全局函数，拿不到就降级）
     * ========================================================== */

    function vrAllData() {
        if (typeof getAllData === 'function') {
            try { return getAllData(); } catch (e) { /* 降级 */ }
        }
        return [];
    }

    function vrCheckedData() {
        return vrAllData().filter(function (d) { return d && d.checked && d.html; });
    }

    function getVrCount() {
        return vrAllData().length;
    }

    /* ==========================================================
     * 六、类型筛选 + 底部计数
     * ========================================================== */

    var vrFilter = 'all';

    function panelType(panel) {
        if (panel.classList.contains('vr-img')) { return 'img'; }
        if (panel.classList.contains('vr-stream')) { return 'stream'; }
        if (panel.classList.contains('vr-video')) { return 'video'; }
        return 'other';
    }

    function applyTypeFilter() {
        document.querySelectorAll('.panel').forEach(function (p) {
            var match = vrFilter === 'all' || panelType(p) === vrFilter;
            p.classList.toggle('vr-type-off', !match);
        });
        updateCounts();
    }

    function updateCounts() {
        var panels = document.querySelectorAll('#mediaList .panel, #allMediaList .panel');
        var total = panels.length;
        var counts = { all: total, video: 0, img: 0, stream: 0 };
        panels.forEach(function (p) {
            var t = panelType(p);
            if (counts[t] !== undefined) { counts[t]++; }
        });

        var chips = document.querySelectorAll('#vrFilters .fchip');
        chips.forEach(function (c) {
            var f = c.getAttribute('data-f');
            var b = c.querySelector('b');
            if (b) { b.textContent = counts[f] !== undefined ? counts[f] : 0; }
        });

        var cnt = el('vrCount');
        if (cnt) { cnt.textContent = total; }
        var ovMap = { video: 'vrOvVideo', img: 'vrOvImg', stream: 'vrOvStream' };
        Object.keys(ovMap).forEach(function (k) {
            var b = el(ovMap[k]);
            if (b) { b.textContent = counts[k] || 0; }
        });
        var ovDir = el('vrOvDir');
        if (ovDir) { ovDir.textContent = settings.defaultDir || 'video-rod'; }
        var ovQ = el('vrOvQ');
        if (ovQ) {
            ovQ.textContent = settings.qualityAuto ? '画质 最高' : '画质 手动';
            ovQ.classList.toggle('off', !settings.qualityAuto);
        }
        applyIgnoreDone();
        applyBadgeVisibility();

        // 底部计数
        var checked = 0;
        panels.forEach(function (p) {
            var box = p.querySelector('.DownCheck');
            if (box && box.checked) { checked++; }
        });
        var batchCnt = el('vrBatchCnt');
        if (batchCnt) { batchCnt.textContent = checked; }
        var selTxt = el('selTxt');
        if (selTxt) { selTxt.textContent = checked ? ('已选 ' + checked + '/' + total) : '全选'; }
        var chkAll = el('chkAll');
        if (chkAll) { chkAll.checked = checked > 0 && checked === total; }
    }

    /** 「忽略已下载」：复用 settings.dedupe（与设置抽屉同一个键），
     *  只切显示态，不删数据也不重渲染，随时可切回来。 */
    function applyIgnoreDone() {
        document.querySelectorAll('.panel').forEach(function (p) {
            p.classList.toggle('vr-ignore-hidden',
                !!settings.dedupe && p.classList.contains('done'));
        });
    }

    /** 概览条按钮：全部接到现有功能上，不做静态假 UI */
    function bindOverview() {
        document.querySelectorAll('.ovt').forEach(function (b) {
            b.addEventListener('click', function () {
                var f = b.getAttribute('data-ot');
                var chip = document.querySelector('#vrFilters .fchip[data-f="' + f + '"]');
                if (chip) { chip.click(); }
            });
        });
        var save = el('vrOvSave');
        if (save) {
            save.addEventListener('click', function () {
                var btn = el('btnSettings');
                if (btn) { btn.click(); }
                var grp = document.querySelector('.sgroup[data-group="path"]');
                if (grp && grp.scrollIntoView) { grp.scrollIntoView({ block: 'nearest' }); }
            });
        }
        var q = el('vrOvQ');
        if (q) {
            q.addEventListener('click', function () {
                settings.qualityAuto = !settings.qualityAuto;
                saveSettings();
                var box = el('vrSetQuality');
                if (box) { box.checked = settings.qualityAuto; }
                updateCounts();
                tip(settings.qualityAuto ? '默认取最高画质' : '画质改为手动选择');
            });
        }
        var ig = el('vrIgnoreDone');
        if (ig) {
            ig.addEventListener('change', function () {
                settings.dedupe = this.checked;
                saveSettings();
                var box = el('vrSetDedupe');
                if (box) { box.checked = this.checked; }
                applyIgnoreDone();
            });
        }
    }

    function bindFilters() {
        var box = el('vrFilters');
        if (!box) { return; }
        box.addEventListener('click', function (e) {
            var b = e.target.closest('.fchip');
            if (!b) { return; }
            vrFilter = b.getAttribute('data-f');
            box.querySelectorAll('.fchip').forEach(function (c) {
                c.classList.toggle('on', c === b);
            });
            applyTypeFilter();
        });
    }

    function bindFoot() {
        var chkAll = el('chkAll');
        if (chkAll) {
            chkAll.addEventListener('change', function () {
                var want = this.checked;
                vrAllData().forEach(function (d) {
                    if (!d || !d.html || d.html.hasClass('vr-type-off')) { return; }
                    d.checked = want;
                });
                updateCounts();
            });
        }

        // 勾选变化 → 刷新计数（猫抓绑的是 click，这里用事件委托兜底）
        ['mediaList', 'allMediaList'].forEach(function (id) {
            var list = el(id);
            if (!list) { return; }
            list.addEventListener('click', function (e) {
                if (e.target && e.target.classList && e.target.classList.contains('DownCheck')) {
                    setTimeout(updateCounts, 0);
                }
            });
        });

        var renameBtn = el('vrRename');
        if (renameBtn) { renameBtn.addEventListener('click', openRenameModal); }
    }

    /* ==========================================================
     * 七、批量命名
     * ========================================================== */

    function naming() { return window.VideoRodNaming || null; }

    function nameFor(data, tpl, index) {
        var N = naming();
        var ext = data.ext || 'mp4';
        if (!N || !N.buildNameFromInfo) {
            return data.downFileName || data.name || ('file.' + ext);
        }
        var info = pageInfo || {
            title: data._title || data.title || '',
            post: '',
            authorFull: '',
            site: hostOf(data.webUrl || data.url || '')
        };
        try {
            return N.buildNameFromInfo(info, data.url || data.webUrl || '', {
                tpl: tpl || settings.template,
                ext: ext,
                index: index
            });
        } catch (e) {
            return data.downFileName || data.name || ('file.' + ext);
        }
    }

    function openRenameModal() {
        var sel = vrCheckedData();
        if (!sel.length) { tip('先勾选要改名的文件'); return; }
        var cnt = el('vrRenameCnt');
        if (cnt) { cnt.textContent = sel.length; }
        var input = el('vrTplInput');
        if (input) { input.value = settings.template; }
        renderTplPreview();
        el('vrMask').classList.add('on');
        el('vrRenameModal').classList.add('on');
    }

    function closeRenameModal() {
        el('vrMask').classList.remove('on');
        el('vrRenameModal').classList.remove('on');
    }

    function renderTplPreview() {
        var input = el('vrTplInput');
        var out = el('vrTplPreview');
        if (!input || !out) { return; }
        var tpl = input.value || settings.template;
        var sel = vrCheckedData();
        if (!sel.length) { out.textContent = '先勾选文件'; return; }

        var all = vrAllData();
        var computed = dedupe(sel.map(function (d) {
            return nameFor(d, tpl, all.indexOf(d));
        }));

        var lines = sel.slice(0, 3).map(function (d, i) {
            return '· ' + escHtml(d.downFileName || d.name || '') + ' → <b>' + escHtml(computed[i]) + '</b>';
        });
        if (sel.length > 3) { lines.push('· …共 ' + sel.length + ' 个（重名自动 _01）'); }
        out.innerHTML = '预览：<br>' + lines.join('<br>');
    }

    /** 重名自动加 _01 _02（走 M0 的 dedupeNames，拿不到就自己兜底） */
    function dedupe(names) {
        var N = naming();
        if (N && typeof N.dedupeNames === 'function') {
            try { return N.dedupeNames(names); } catch (e) { /* 降级 */ }
        }
        var seen = {};
        return names.map(function (n) {
            var k = String(n).toLowerCase();
            var c = seen[k] || 0;
            seen[k] = c + 1;
            if (!c) { return n; }
            var dot = n.lastIndexOf('.');
            return dot > 0
                ? n.slice(0, dot) + '_' + String(c).padStart(2, '0') + n.slice(dot)
                : n + '_' + String(c).padStart(2, '0');
        });
    }

    function bindRenameModal() {
        var mask = el('vrMask');
        if (mask) { mask.addEventListener('click', closeRenameModal); }

        var input = el('vrTplInput');
        if (input) {
            input.addEventListener('input', renderTplPreview);
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { applyTpl(); }
            });
        }

        var apply = el('vrApplyTpl');
        if (apply) { apply.addEventListener('click', applyTpl); }
    }

    function applyTpl() {
        var input = el('vrTplInput');
        var tpl = (input && input.value || '').trim() || settings.template;
        var sel = vrCheckedData();
        var all = vrAllData();

        // 先整体算名字，再统一去重（同一模板套多条会撞名）
        var names = dedupe(sel.map(function (d) {
            return nameFor(d, tpl, all.indexOf(d));
        }));

        sel.forEach(function (d, i) {
            d.downFileName = names[i];
            d.vrManuallyNamed = true;
            d.html.find('.vr-name').val(names[i]);
        });

        if (input) { input.value = tpl; }
        closeRenameModal();
        tip('已按规则重命名 ' + sel.length + ' 个文件');
    }

    /* ==========================================================
     * 八、智能起名：页面信息就绪后批量套模板
     * ========================================================== */

    function applySmartNaming(force) {
        if (!settings.smartName) { return; }
        if (!pageInfo || !pageInfo.title) { return; }

        var all = vrAllData().filter(function (d) { return d && d.html; });
        if (!all.length) { return; }

        // 单条媒体 → 一律用页面信息；多条 → 只在识别出作者时用（避免同名堆叠）
        var usePageName = all.length === 1 || !!pageInfo.author;

        if (usePageName) {
            var names = dedupe(all.map(function (d, i) {
                return nameFor(d, settings.template, i);
            }));
            all.forEach(function (d, i) {
                if (d.vrManuallyNamed && !force) { return; }
                if (!names[i]) { return; }
                d.downFileName = names[i];
                d.html.find('.vr-name').val(names[i]);
            });
            return;
        }

        all.forEach(function (d) {
            if (!d.html) { return; }
            if (d.vrManuallyNamed && !force) { return; }
            var name = d.downFileName || d.name;   // 保留猫抓按文件给的名字
            if (!name) { return; }
            d.html.find('.vr-name').val(name);
        });
    }

    /* ==========================================================
     * 九、下载管线（M2）：目录落盘 / 去重 / 完成汇报
     * ========================================================== */

    var RESERVED_SEG = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
    var MAX_PATH_LEN = 170;          // Downloads 前缀之外留足余量（Windows MAX_PATH 260）

    /** 单段清洗：非法字符、尾点尾空格、Windows 保留名 */
    function cleanSeg(seg) {
        var t = String(seg == null ? '' : seg)
            .replace(/[<>:"|?*\u0000-\u001F]/g, '_')
            .replace(/\\/g, '/')
            .trim();
        t = t.replace(/^[.\s]+|[.\s]+$/g, '');
        if (!t) { return ''; }
        if (RESERVED_SEG.test(t)) { t = '_' + t; }
        return t;
    }

    /** 整条相对路径清洗：逐段清洗 + 丢空段 */
    function cleanPath(p) {
        return String(p || '').split('/').map(cleanSeg).filter(Boolean).join('/');
    }

    /** 最终落盘路径（相对下载目录）：video-rod/平台/名字.mp4 */
    function vrFullPath(data) {
        var dir = cleanPath(window.vrDirOf(data)) || DEFAULTS.defaultDir;
        var name = cleanPath(data.downFileName || data.name || ('file.' + (data.ext || 'mp4')));
        if (!name) { name = 'file.' + (data.ext || 'mp4'); }
        if (name.indexOf(dir + '/') === 0) { return name; }   // 已带目录，幂等

        var full = dir + '/' + name;
        if (full.length > MAX_PATH_LEN) {
            // 太长就把最后一段（文件名）截短，保住目录结构
            var parts = full.split('/');
            var file = parts.pop();
            var dot = file.lastIndexOf('.');
            var stem = dot > 0 ? file.slice(0, dot) : file;
            var ext = dot > 0 ? file.slice(dot) : '';
            var room = Math.max(24, MAX_PATH_LEN - (parts.join('/').length + 1) - ext.length);
            parts.push(stem.slice(0, room) + ext);
            full = parts.join('/');
        }
        return full;
    }

    /* ---------- 去重记录 ---------- */
    var downloaded = {};          // { hash: {p, t} }
    var DOWNLOADED_MAX = 2000;

    function loadDownloaded(cb) {
        try {
            chrome.storage.local.get(['vrDownloaded'], function (res) {
                downloaded = (res && res.vrDownloaded) || {};
                cb && cb();
            });
        } catch (e) { cb && cb(); }
    }

    function saveDownloaded() {
        try {
            var keys = Object.keys(downloaded);
            if (keys.length > DOWNLOADED_MAX) {
                keys.sort(function (a, b) { return (downloaded[a].t || 0) - (downloaded[b].t || 0); });
                keys.slice(0, keys.length - DOWNLOADED_MAX).forEach(function (k) { delete downloaded[k]; });
            }
            chrome.storage.local.set({ vrDownloaded: downloaded });
        } catch (e) { /* 忽略 */ }
    }

    function hashKey(str) {
        var h = 5381;
        for (var i = 0; i < str.length; i++) {
            h = ((h << 5) + h + str.charCodeAt(i)) | 0;
        }
        return 'k' + (h >>> 0).toString(36);
    }

    function isDownloaded(path) {
        return settings.dedupe && !!downloaded[hashKey(path)];
    }

    function markDownloaded(path) {
        downloaded[hashKey(path)] = { p: path, t: Date.now() };
        saveDownloaded();
    }

    /* ---------- 卡片状态 ---------- */
    function markCardDone(data, label) {
        if (!data || !data.html) { return; }
        data.html.addClass('done');
        var box = data.html.find('.DownCheck');
        if (box.length && box.prop('checked')) {
            data.checked = false;     // 下过的自动取消勾选，避免重复提交
        }
        // 徽章文案由 CSS ::after 控制，这里只保证只有一个
        data.html.attr('data-vr-state', label || '已完成');
    }

    /** 找 DOM 对应的资源数据 */
    function dataOfEl(el) {
        var panel = el && el.closest ? el.closest('.panel') : null;
        if (!panel) { return null; }
        var all = vrAllData();
        for (var i = 0; i < all.length; i++) {
            if (all[i] && all[i].html && all[i].html[0] === panel) { return all[i]; }
        }
        return null;
    }

    /* ---------- 批量下载前置处理 ---------- */
    var batchIds = [];

    function beforeBatchDownload() {
        var items = vrCheckedData();
        if (!items.length) { return; }

        // M11：勾选里含多段组的，整组走后台合并，不进普通下载列表
        var groups = vrScanGroups();
        vrMergeGroups = groups;   // 与模块级账本同步：合并消息回来后按 taskId 找组靠它
        var groupOf = new Map();
        groups.forEach(function (g) {
            g.items.forEach(function (d) { groupOf.set(d, g); });
        });
        var mergeGroups = [];
        var skipped = 0;
        var planned = [];

        items.forEach(function (d) {
            var g = groupOf.get(d);
            if (g) {
                if (mergeGroups.indexOf(g) < 0) { mergeGroups.push(g); }
                return;
            }
            var full = vrFullPath(d);
            if (isDownloaded(full)) {
                skipped++;
                markCardDone(d, '已下载过');
                return;
            }
            d.downFileName = full;      // 目录 + 名字，交给猫抓的下载循环
            markDownloaded(full);       // 先记账：批量中途关面板也不会重复下
            planned.push(d);
        });

        if (skipped) {
            tip('跳过 ' + skipped + ' 个已下载过的文件');
        }

        // 组内卡片取消勾选（猫抓批量循环不再单独下它们），整组发起合并
        mergeGroups.forEach(function (g) {
            g.items.forEach(function (d) {
                d.checked = false;
                if (d.html && d.html.length) {
                    var box = d.html.find('.DownCheck');
                    if (box && box.length) { box.prop('checked', false); }
                }
            });
            vrStartGroupMerge(g);
        });

        if (!planned.length) {
            if (mergeGroups.length) {
                return false;           // 只有合并任务：拦下猫抓批量循环
            }
            tip('选中的都下载过了，换个页面或清空下载记录');
            return false;               // 调用方决定是否拦下
        }
        batchIds = [];
        batchTotal = planned.length;
        batchDone = 0;
        vrBatchPlan = planned.slice();     // ADR-069：交给单通道执行器
        return true;
    }

    var batchTotal = 0;
    var batchDone = 0;
    var batchFail = 0;
    var vrBatchPlan = [];                  // ADR-069：待走 SW 单通道的条目
    var vrSwPending = {};                  // ADR-069：兜底通道 downloadId -> {rel, d}（异步失败要回滚）

    /** 记录本批下载 id（monkey-patch chrome.downloads.download） */
    var batchIdNames = {};   // downloadId -> filename（失败回滚的独立依据，见 bindDownloadProgress）

    function hookDownloadsApi() {
        try {
            var api = chrome.downloads;
            var orig = api.download;
            if (!orig || orig.__vrHooked) { return; }
            var wrapped = function (opts, cb) {
                return orig.call(api, opts, function (id) {
                    if (id) {
                        batchIds.push(id);
                        // 猫抓 popup.js 下载出错时会 catDownload 重试并 delete downData[id]，
                        // 钓鱼竿的失败回滚若依赖 downData 就永远拿不到 —— 这里自记一份
                        // id→filename，失败回滚才有着落（2026-11-08 QA 实测踩坑）。
                        if (opts && opts.filename) { batchIdNames[id] = String(opts.filename); }
                    }
                    cb && cb(id);
                });
            };
            wrapped.__vrHooked = true;
            api.download = wrapped;
        } catch (e) { /* 个别版本 API 只读，忽略 */ }
    }

    /** 按 downFileName 找卡片并撤销「已完成」假象（失败回滚用） */
    function unmarkCardByFileName(full) {
        try {
            var all = vrAllData();
            for (var i = 0; i < all.length; i++) {
                var d = all[i];
                if (d && d.downFileName === full && d.html && d.html.length) {
                    d.html.removeClass('done');
                    d.html.attr('data-vr-state', '失败');
                }
            }
        } catch (e) { /* 找不到卡片就算了，去重表回滚不受影响 */ }
    }

    /* ==================== ADR-069 单写盘通道 ==================== */

    /** 批量是否可走 SW 单通道；aria2 / m3u8DL / m3u8 条目保持原通道。
     *  注意：m3u8AutoDown 默认 true 但只影响 parsing=='m3u8' 的条目，
     *  不能拿它整批排除（2026-11-08 实测踩坑：单通道被静默禁用）。 */
    function vrCanSwBatch() {
        try {
            if (typeof G !== 'undefined' && G) {
                if (G.enableAria2Rpc) { return false; }
                if (G.m3u8dl) {
                    for (var j = 0; j < vrBatchPlan.length; j++) {
                        var pj = String(vrBatchPlan[j].parsing || '');
                        if (pj === 'm3u8' || pj === 'mpd') { return false; }
                    }
                }
            }
            for (var i = 0; i < vrBatchPlan.length; i++) {
                var p = String(vrBatchPlan[i].parsing || '');
                if (p === 'm3u8' || p === 'mpd') { return false; }
            }
            return vrBatchPlan.length > 0;
        } catch (e) { return false; }
    }

    /** 单条入库 meta：popup 只能给标题/页面/直链，平台与目录由 SW 路径引擎推导 */
    function vrSaveMetaOf(d, pageUrl) {
        var u = String(d.url || '');
        return {
            title: d.title || '',
            pageUrl: pageUrl || d.pageUrl || '',
            sourceUrl: u.indexOf('blob:') === 0 ? '' : u
        };
    }

    /** M-2（2026-11-08 对抗性审计修正版）：小红书详情页批量下载前，把页面身份
     *  换成 state 权威值。naming.js 的 DOM 选择器在哈希 class 下全抓空，作者退回
     *  域名、标题退回页面标题（本轮「91 张同名」根因）。SW 的 vrXhsScanInPage 早
     *  就从 note.user.nickname 精确取到——这里接上它。
     *  边界（审计 D-2）：非详情页 / 取数失败 → 返回 false，完整维持现状命名。
     *  注意：不 relabel、不 index 对齐（草稿 BUG-S1/S2）；只更新 pageInfo，
     *  路径与文件名由既有 vrFullPath 链路（buildRelDir + ${title}_${index}）自动继承。 */
    function vrApplyXhsAuthor(pageUrl, tabId) {
        return new Promise(function (resolve) {
            if (!pageInfo || !(tabId > 0)) { resolve(false); return; }
            /* 判「详情页特征」而非域名：笔记 id 是 12-32 位 hex 的路径段。
             * 真正的护栏在 SW——vrXhsScanInPage 拿不到 noteDetailMap 就回 false，
             * 误判也无副作用；用域名匹配反而让本地 fixture 无法端到端测试。
             * （2026-11-08 审计 M-2 实施注记） */
            if (!/\/(?:explore|discovery\/item)\/[0-9a-f]{12,32}/i.test(String(pageUrl || ''))) {
                resolve(false); return;
            }
            try {
                chrome.runtime.sendMessage({ Message: 'vrXhsScan', tabId: tabId }, function (r) {
                    void chrome.runtime.lastError;
                    if (r && r.ok && r.author) {
                        pageInfo.authorFull = String(r.author) +
                            (r.authorId ? '(@' + String(r.authorId) + ')' : '');
                        pageInfo.creatorId = String(r.authorId || '');
                        if (r.title) { pageInfo.title = String(r.title).slice(0, 120); }
                        resolve(true);
                    } else { resolve(false); }
                });
            } catch (e) { resolve(false); }
        });
    }

    /** state 生效后重算已定稿路径：重算 downFileName + 迁移去重键。
     *  beforeBatchDownload 用旧命名记的账必须跟着搬，否则失败回滚找不到键。
     *  ⚠️ 重算前必须清空 downFileName——它此时是「旧目录全路径」，
     *  vrFullPath 会把非新目录前缀的整串当文件名拼到新目录下（路径套娃，
     *  2026-11-08 fixture 实测抓出的 BUG-M2-1）。原始名在 data.name 里。 */
    function vrReplanWithXhsAuthor(items) {
        for (var i = 0; i < items.length; i++) {
            var d = items[i];
            var oldRel = d.downFileName;
            var newRel;
            d.downFileName = '';
            try { newRel = vrFullPath(d); } catch (e) { newRel = null; }
            d.downFileName = newRel || oldRel;   // 重算失败保持原值
            if (!newRel || newRel === oldRel) { continue; }
            try {
                if (oldRel && downloaded[hashKey(oldRel)]) { delete downloaded[hashKey(oldRel)]; }
                markDownloaded(newRel);
            } catch (e0) { /* 迁移失败不阻断：最坏留旧记录，重试仍可用 */ }
        }
    }

    /** 逐条经 SW VRSave 保存；如实汇总（已归档 / 待归档 / 失败）
     *  single=true 时按单文件口吻汇总（单卡下载复用同一执行器，B-52）。 */
    function vrRunBatchSw(single) {
        var items = vrBatchPlan.slice();
        vrBatchPlan = [];
        var tabId = (typeof G !== 'undefined' && G && G.tabId) || -1;
        new Promise(function (res) {
            if (tabId > 0 && chrome.tabs && chrome.tabs.get) {
                chrome.tabs.get(tabId, function (t) {
                    void chrome.runtime.lastError;
                    res((t && t.url) || '');
                });
            } else { res(''); }
        }).then(function (pageUrl) {
            return vrApplyXhsAuthor(pageUrl, tabId).then(function (fixed) {
            if (fixed) { vrReplanWithXhsAuthor(items); }
            var okN = 0, pendN = 0, failN = 0, firstErr = '';
            var step = function (i) {
                if (i >= items.length) { vrBatchSummary(okN, pendN, failN, firstErr, single); return; }
                var d = items[i];
                var rel = d.downFileName || vrFullPath(d);
                var settled = false;
                var finish = function (r) {
                    if (settled) { return; }          // 看门狗与真实应答二选一，先到先得
                    settled = true;
                    if (!r || !r.ok) {
                        failN++;
                        if (!firstErr) { firstErr = String((r && (r.code || r.message)) || (r ? '未知' : 'timeout')); }
                        // 失败回滚（与 DEF-01 同规则）：撤去重记录 + 撤销卡片假完成
                        try {
                            var key = hashKey(rel);
                            if (downloaded[key]) { delete downloaded[key]; saveDownloaded(); }
                        } catch (e0) { /* 回滚失败不阻断后续 */ }
                        unmarkCardByFileName(rel);
                    } else if (r.mode === 'fsa') {
                        okN++;
                        markCardDone(d, '已完成');
                    } else {
                        pendN++;
                        markCardDone(d, '待归档');
                        // 兜底通道先受理后落盘：记下 id，异步失败由
                        // bindDownloadProgress 回滚（防 DEF-A 僵尸以新形态复发）
                        if (r.downloadId) { vrSwPending[r.downloadId] = { rel: rel, d: d }; }
                    }
                    setTimeout(function () { step(i + 1); }, 120);
                };
                try {
                    chrome.runtime.sendMessage({
                        Message: 'vrLib.saveOne',
                        url: d.url,
                        relPath: rel,
                        meta: vrSaveMetaOf(d, pageUrl)
                    }, function (r) {
                        void chrome.runtime.lastError;
                        finish(r || null);
                    });
                    // 看门狗：单条 20 秒无应答按失败处理，不拖死整批
                    setTimeout(function () { finish(null); }, 20000);
                } catch (e1) {
                    failN++;
                    if (!firstErr) firstErr = String(e1.message || e1);
                    setTimeout(function () { step(i + 1); }, 0);
                }
            };
            step(0);
            });
        });
    }

    /** 单通道汇总：三个数字必须如实。
     *  single=true → 改成单文件口吻，别让用户点一张图却看到「批量完成」。 */
    function vrBatchSummary(okN, pendN, failN, errName, single) {
        if (single) {
            if (failN) {
                tip('下载失败：' + (errName || '未知') + '（可重试）');
            } else if (pendN) {
                tip('已发起下载（未归档：文件落系统下载目录；在资源库设置里授权素材目录后可自动归档）');
            } else {
                tip('已保存到素材库');
            }
            try { if (typeof updateCounts === 'function') updateCounts(); } catch (e) { /* 忽略 */ }
            return;
        }
        var msg = '批量完成：' + okN + ' 个已归档';
        if (pendN) {
            msg += '，' + pendN + ' 个已发起下载（未归档：文件将落系统下载目录；在资源库设置里授权素材目录后可自动归档）';
        }
        if (failN) {
            msg += '，' + failN + ' 个失败（' + (errName || '未知') + '，可重试）';
        }
        tip(msg);
        try { if (typeof updateCounts === 'function') updateCounts(); } catch (e) { /* 忽略 */ }
    }

    /** 批量收尾汇总（成功/失败终点共用）：如实报数 + 兜底改名提示 */
    function tipBatchSummary(doneN, failN, errName) {        var base = '批量完成：' + doneN + ' 个文件已保存' +
            (failN ? '，' + failN + ' 个失败' +
                (errName ? '（' + errName + '，可重试）' : '（可重试）') : '');
        try {
            chrome.storage.session.get('vrNameFallback', function (o) {
                // 未授权素材目录时下载走浏览器下载器兜底，Chrome 147+ 会把文件名
                // 改成 UUID/URL 末段（ADR-040）。SW 兜底时会打标记 —— 如实说明。
                tip(base + ((o && o.vrNameFallback)
                    ? '；未授权素材目录，文件名可能被浏览器改名，在资源库设置里授权后可保住命名'
                    : ''));
            });
        } catch (e1) {
            tip(base);
        }
    }

    /** 完成/失败汇报 */
    function bindDownloadProgress() {
        try {
            chrome.downloads.onChanged.addListener(function (delta) {
                if (!delta || !delta.id) { return; }

                // 单条卡片状态：借猫抓的 downData 反查是哪个卡片
                var data = null;
                try {
                    if (typeof downData !== 'undefined' && downData[delta.id]) {
                        data = downData[delta.id];
                    }
                } catch (e) { /* 忽略 */ }

                if (delta.state && delta.state.current === 'complete') {
                    if (data) { markCardDone(data); }
                    delete batchIdNames[delta.id];
                    if (vrSwPending[delta.id]) { delete vrSwPending[delta.id]; }
                    if (batchIds.indexOf(delta.id) >= 0) {
                        batchDone++;
                        if (batchTotal && (batchDone + batchFail) >= batchTotal) {
                            tipBatchSummary(batchDone, batchFail, '');
                            batchTotal = 0;
                            batchDone = 0;
                            batchFail = 0;
                            batchIds = [];
                        }
                    }
                }
                if (delta.state && delta.state.current === 'interrupted') {
                    var errName = (delta.error && delta.error.current) || '未知原因';
                    var rollName = null;
                    // ADR-069：兜底通道「先受理后异步失败」→ 回滚去重与卡片，迟到但诚实
                    if (vrSwPending[delta.id]) {
                        rollName = vrSwPending[delta.id].rel;
                        unmarkCardByFileName(rollName);
                        delete vrSwPending[delta.id];
                    }
                    if (data) {
                        data.html.removeClass('done');
                        data.html.attr('data-vr-state', '失败');
                        rollName = data.downFileName || null;
                    }
                    // 上游 popup.js 出错时先 catDownload 重试并删掉 downData[id]，
                    // 这里 data 常为 null —— 用 monkey-patch 记下的 id→filename 兜底，
                    // 否则去重表留僵尸记录，重试被「选中的都下载过了」永久拦死（QA 实测）。
                    if (!rollName && batchIdNames[delta.id]) {
                        rollName = batchIdNames[delta.id];
                        unmarkCardByFileName(rollName);
                    }
                    delete batchIdNames[delta.id];
                    if (rollName) {
                        // 失败了就把去重记录撤掉，允许重试
                        var key = hashKey(rollName);
                        if (downloaded[key]) {
                            delete downloaded[key];
                            saveDownloaded();
                        }
                    }
                    if (batchIds.indexOf(delta.id) >= 0) {
                        batchFail++;
                        if (batchTotal && (batchDone + batchFail) >= batchTotal) {
                            tipBatchSummary(batchDone, batchFail, errName);
                            batchTotal = 0;
                            batchDone = 0;
                            batchFail = 0;
                            batchIds = [];
                        } else {
                            tip('下载失败：' + errName);
                        }
                    } else {
                        tip('下载失败：' + errName);
                    }
                }
            });
        } catch (e) { /* 忽略 */ }
    }

    /**
     * 下载前置钩子（捕获阶段，抢在猫抓的 jQuery 处理器之前）
     *  - 批量下载：算路径、去重、跳过已下过的
     *  - 单卡下载：算路径
     */
    function bindDownloadHooks() {
        document.addEventListener('click', function (e) {
            var target = e.target;

            // 单卡下载按钮
            var single = target.closest && target.closest('.icon.download');
            if (single) {
                var d = dataOfEl(single);
                if (d) {
                    var full = vrFullPath(d);
                    if (isDownloaded(full)) {
                        markCardDone(d, '已下载过');
                        tip('这个文件已经下过了（可在设置里清空记录）');
                        e.stopPropagation();
                        e.preventDefault();
                        return;
                    }
                    d.downFileName = full;
                    markDownloaded(full);
                    /* ADR-069 单写盘通道：单卡也走 SW VRSave，与批量同一条链路。
                     * 以前这里是「设好名字 → 放行给猫抓 popup.js 直调 chrome.downloads」，
                     * 后果是三件事全丢：① 不预登记资源库（下完库里查不到）
                     * ② 没有进度（面板上干等）③ ADR-040 后 downloads 不认 filename，
                     * 可能落成 UUID / 丢子目录。批量早就收敛了，单卡漏了（B-52）。 */
                    vrBatchPlan = [d];
                    batchTotal = 1;
                    batchDone = 0;
                    batchFail = 0;
                    if (vrCanSwBatch()) {
                        e.stopPropagation();
                        e.preventDefault();
                        vrRunBatchSw(true);
                    } else {
                        /* 走不了单通道（aria2 / m3u8 / mpd）→ 清干净，交给原通道。
                         * 不清的话残留的 plan 会被下一次批量误用。 */
                        vrBatchPlan = [];
                    }
                }
                return;
            }

            // 批量下载
            var batch = target.closest && target.closest('#DownFile');
            if (batch) {
                var ok = beforeBatchDownload();
                if (ok === false) {
                    e.stopPropagation();
                    e.preventDefault();
                    updateCounts();
                } else if (ok === true && vrCanSwBatch()) {
                    // ADR-069 单写盘通道：批量不再由猫抓 popup.js 直调 chrome.downloads，
                    // 统一经 SW VRSave（FSA 优先，兜底如实标待归档）。特殊模式自动回退原通道。
                    e.stopPropagation();
                    e.preventDefault();
                    vrRunBatchSw();
                }
            }
        }, true);
    }

    function bindClearDownloaded() {
        var btn = el('vrClearDownloaded');
        if (!btn) { return; }
        btn.addEventListener('click', function () {
            downloaded = {};
            saveDownloaded();
            document.querySelectorAll('.panel.done').forEach(function (p) {
                p.classList.remove('done');
                p.removeAttribute('data-vr-state');
            });
            tip('下载记录已清空，之前下过的可以重下了');
        });
    }

    /* ==========================================================
     * 九·补、下载历史视图（M9）
     * 数据源 = 去重记账（downloaded: {hash: {p, t}}），同一份数据两个用途：
     * 既当「下过没有」的去重依据，也当「下过什么」的历史清单。
     * ========================================================== */

    var HISTORY_VIEW_MAX = 200;   // 视图最多渲染条数，防长列表卡顿
    var VR_ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    var VR_ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

    function vrFmtTime(t) {
        if (!t) { return ''; }
        var d = new Date(t);
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function vrCopyText(text) {
        var done = function () { tip('已复制完整路径'); };
        var fallback = function () {
            try {
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                done();
            } catch (e) { tip('复制失败，请手动复制'); }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, fallback);
        } else {
            fallback();
        }
    }

    /** 记录变动后，把列表卡片的「已完成」态按最新去重账本刷新一遍 */
    function refreshCardDoneStates() {
        try {
            vrAllData().forEach(function (d) {
                if (!d || !d.html || !d.html.length) { return; }
                if (isDownloaded(vrFullPath(d))) {
                    markCardDone(d, '已下载过');
                } else {
                    d.html.removeClass('done');
                    d.html.removeAttr('data-vr-state');
                }
            });
        } catch (e) { /* 忽略：列表结构异常时不影响记录操作 */ }
    }

    function renderHistory() {
        var list = el('vrHistoryList');
        if (!list) { return; }
        var rows = Object.keys(downloaded).map(function (k) { return downloaded[k]; })
            .filter(function (r) { return r && r.p; })
            .sort(function (a, b) { return (b.t || 0) - (a.t || 0); });

        var cnt = el('vrHistoryCnt');
        if (cnt) { cnt.textContent = rows.length + ' 条'; }
        var empty = el('vrHistoryEmpty');
        if (empty) { empty.classList.toggle('on', rows.length === 0); }
        var note = el('vrHistoryNote');
        if (note) {
            note.textContent = rows.length > HISTORY_VIEW_MAX
                ? '仅显示最近 ' + HISTORY_VIEW_MAX + ' 条，共 ' + rows.length + ' 条'
                : '删记录只是取消「已下载」标记，文件还在磁盘上';
        }

        list.innerHTML = '';
        rows.slice(0, HISTORY_VIEW_MAX).forEach(function (r) {
            var p = String(r.p);
            var slash = p.lastIndexOf('/');
            var name = slash >= 0 ? p.slice(slash + 1) : p;
            var dir = slash >= 0 ? p.slice(0, slash + 1) : '';
            var row = document.createElement('div');
            row.className = 'hrow';
            row.innerHTML =
                '<div class="hmain"><div class="hname"></div><div class="hdir"></div></div>' +
                '<span class="htime"></span>' +
                '<button class="hbtn copy" title="复制完整路径">' + VR_ICON_COPY + '</button>' +
                '<button class="hbtn del" title="删除这条记录（该文件可重新下载）">' + VR_ICON_TRASH + '</button>';
            row.querySelector('.hname').textContent = name;
            row.querySelector('.hdir').textContent = dir;
            row.querySelector('.htime').textContent = vrFmtTime(r.t);
            row.querySelector('.copy').addEventListener('click', function () { vrCopyText(p); });
            row.querySelector('.del').addEventListener('click', function () {
                var key = hashKey(p);
                if (!downloaded[key]) { return; }
                delete downloaded[key];
                saveDownloaded();
                refreshCardDoneStates();
                renderHistory();
                tip('已删除 1 条记录，该文件可重新下载');
            });
            list.appendChild(row);
        });
    }

    function bindHistoryView() {
        var openBtn = el('vrOpenHistory');
        if (openBtn) {
            openBtn.addEventListener('click', function () {
                openDrawer('vrHistory');
                renderHistory();
            });
        }
        // 历史视图的返回键回设置视图（不是一关到底）
        document.querySelectorAll('#vrHistory [data-back]').forEach(function (x) {
            x.addEventListener('click', function () { openDrawer(x.getAttribute('data-back')); });
        });
        var clearBtn = el('vrHistoryClear');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                var rows = Object.keys(downloaded).length;
                if (!rows) { tip('下载历史本来就是空的'); return; }
                // 二次确认：第一下改文案，第二下才真清（防手残）
                if (clearBtn.dataset.armed !== '1') {
                    clearBtn.dataset.armed = '1';
                    clearBtn.textContent = '再点一次，清空 ' + rows + ' 条';
                    setTimeout(function () {
                        clearBtn.dataset.armed = '';
                        clearBtn.textContent = '清空全部';
                    }, 3000);
                    return;
                }
                downloaded = {};
                saveDownloaded();
                refreshCardDoneStates();
                clearBtn.dataset.armed = '';
                clearBtn.textContent = '清空全部';
                renderHistory();
                tip('下载历史已清空');
            });
        }
    }

    /* ==========================================================
     * 九·补二、M11 多段自动合并（认组 → 后台拼 → 点保存）
     * 苏哥原则：不让人选段、不让人填顺序，后台默认自己完成，人只点保存。
     * 识别：同标签页的多个 m3u8，网址只有序号不同、类型相同、标题相同 →
     * 判为「一个视频的多段」，列表打徽标；勾选下载时整组走合并。
     * ========================================================== */

    var vrMergeGroups = [];   // [{key, items:[data], taskId, state, ext}]

    /** 分组键：只认 m3u8；网址数字段归一后同 host 同路径同类型同标题 */
    function vrM3u8GroupKey(data) {
        if (!data || data.parsing !== 'm3u8' || !data.url) { return null; }
        try {
            var u = new URL(data.url);
            var path = u.pathname;
            if (!/\d/.test(path)) { return null; }   // 路径里没序号的不可能是分段
            var norm = path.replace(/\d+/g, '#');
            return (data.tabId ?? -1) + '|' + u.host + '|' + norm + '|' + (data.type || '') + '|' + (data.title || '');
        } catch (e) { return null; }
    }

    /**
     * 组内序号：路径名的数字段按位比，取第一处有差异的字段值。
     * 不能图省事取「URL 最后一个数字」——.m3u8 里的 8 会把所有序号都变成 8。
     * 返回 null = 路径数字段完全没差异（不是序号型分段，不认）。
     */
    function vrGroupSeqs(items) {
        var runs = items.map(function (d) {
            try { return new URL(d.url).pathname.match(/\d+/g) || []; } catch (e) { return []; }
        });
        var first = runs[0];
        for (var pos = 0; pos < first.length; pos++) {
            var vals = runs.map(function (r) { return parseInt(r[pos], 10); });
            var allSame = vals.every(function (v) { return v === vals[0]; });
            if (!allSame) { return vals; }
        }
        return null;
    }

    /** 扫当前列表，返回多段组（≥2 个同键 m3u8，序号严格连续；同 URL 先祛重） */
    function vrScanGroups() {
        var buckets = {};
        var seenUrl = {};
        try {
            vrAllData().forEach(function (d) {
                var key = vrM3u8GroupKey(d);
                if (!key) { return; }
                // 页面刷新/重复请求会把同一地址嗅探多次，先按 URL 祛重
                if (seenUrl[d.url]) { return; }
                seenUrl[d.url] = 1;
                (buckets[key] = buckets[key] || []).push(d);
            });
        } catch (e) { /* 列表异常时退化为不合并 */ }
        var groups = [];
        Object.keys(buckets).forEach(function (key) {
            var items = buckets[key];
            if (items.length < 2) { return; }
            var seqs = vrGroupSeqs(items);
            if (!seqs) { return; }   // 路径数字段没差异——不是序号型分段
            // 按序号排序，且必须严格连续（1,2,3…）：排掉同页多清晰度变体
            // （variant_180p/360p → 序号差 180）和大部分同页多视频误判
            var order = items.map(function (d, i) { return { d: d, s: seqs[i] }; });
            order.sort(function (a, b) { return a.s - b.s; });
            for (var i = 1; i < order.length; i++) {
                if (order[i].s - order[i - 1].s !== 1) { return; }
            }
            groups.push({
                key: key,
                items: order.map(function (x) { return x.d; }),
                taskId: null, state: 'idle', ext: 'mp4'
            });
        });
        return groups;
    }

    /** 给多段组卡片打静态徽标（列表变化时调用） */
    function vrMarkGroupBadges() {
        vrMergeGroups = vrScanGroups();
        vrMergeGroups.forEach(function (g) {
            g.items.forEach(function (d, i) {
                if (!d.html || !d.html.length) { return; }
                var panel = d.html[0];
                if (panel.querySelector('.vr-multibadge')) { return; }   // 已打过
                var badge = document.createElement('span');
                badge.className = 'vr-multibadge idle';
                badge.textContent = (i === 0 ? (g.items.length + ' 段 · 将合并') : g.items.length + ' 段');
                badge.title = '这 ' + g.items.length + ' 个是同一视频的分段，下载时自动拼成一个';
                var nameEl = panel.querySelector('.name') || panel.querySelector('.filename');
                if (nameEl && nameEl.parentNode) {
                    nameEl.parentNode.insertBefore(badge, nameEl.nextSibling);
                } else {
                    panel.appendChild(badge);
                }
            });
        });
    }

    /** 合并任务状态回写到卡片徽标 */
    function vrMergeBadge(data, state, taskId) {
        if (!data || !data.html || !data.html.length) { return; }
        var panel = data.html[0];
        var badge = panel.querySelector('.vr-multibadge');
        if (!badge) { return; }
        var map = {
            running: ['合并中…', 'running'],
            ready: ['已拼好 · 点我保存', 'ready'],
            saving: ['保存中…', 'running'],
            saved: ['已保存', 'saved'],
            error: ['合并失败', 'error']
        };
        var s = map[state] || map.error;
        badge.textContent = s[0];
        badge.className = 'vr-multibadge ' + s[1];
        if (state === 'ready') {
            badge.onclick = function () {
                var g = vrMergeGroups.filter(function (x) { return x.taskId === taskId; })[0];
                var name = g ? vrMergedName(g) : '';
                if (!name) { tip('找不到文件名，请刷新面板重试'); return; }
                vrMergeBadge(data, 'saving', taskId);
                markDownloaded(name);   // 保存即记账去重
                chrome.runtime.sendMessage({
                    Message: 'vrMergeSave', taskId: taskId, filename: name
                }, function () { void chrome.runtime.lastError; });
            };
        } else {
            badge.onclick = null;
        }
    }

    /** 合并输出文件名：组内第一条的模板名，扩展名按合并结果（mp4/ts） */
    function vrMergedName(g) {
        var full = vrFullPath(g.items[0]);
        return full.replace(/\.(m3u8|mp4|ts)$/i, '') + '.' + (g.ext || 'mp4');
    }

    /** 发起一个组的后台合并 */
    function vrStartGroupMerge(g) {
        if (g.state === 'running' || g.state === 'ready') { return; }
        g.taskId = 'mg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        g.state = 'running';
        g.items.forEach(function (d) { vrMergeBadge(d, 'running', g.taskId); });
        chrome.runtime.sendMessage({
            Message: 'vrMergeStart',
            taskId: g.taskId,
            urls: g.items.map(function (d) { return d.url; })
        }, function () { void chrome.runtime.lastError; });
        tip('检测到 ' + g.items.length + ' 段，后台自动合并中，拼好点保存');
    }

    /** 合并相关的后台消息 */
    function bindMergeMessages() {
        chrome.runtime.onMessage.addListener(function (Message) {
            if (!Message) { return; }
            if (Message.Message === 'vrMergeProgress') {
                vrMergeGroups.forEach(function (g) {
                    if (g.taskId === Message.taskId && g.items[0]) {
                        var badge = g.items[0].html && g.items[0].html.length
                            ? g.items[0].html[0].querySelector('.vr-multibadge') : null;
                        if (badge && Message.text) { badge.textContent = Message.text; }
                    }
                });
            }
            if (Message.Message === 'vrMergeDone') {
                vrMergeGroups.forEach(function (g) {
                    if (g.taskId !== Message.taskId) { return; }
                    g.state = 'ready';
                    g.ext = Message.ext || 'mp4';
                    g.items.forEach(function (d, i) {
                        vrMergeBadge(d, i === 0 ? 'ready' : 'ready', g.taskId);
                    });
                });
                tip('多段已拼好（' + (Message.bytes ? (Message.bytes / 1048576).toFixed(1) : '?') + ' MB），点卡片上的「保存」落盘');
            }
            if (Message.Message === 'vrMergeSaved') {
                vrMergeGroups.forEach(function (g) {
                    if (g.taskId !== Message.taskId) { return; }
                    g.state = 'saved';
                    g.items.forEach(function (d) {
                        vrMergeBadge(d, 'saved', g.taskId);
                        markCardDone(d, '已完成');
                    });
                });
                tip(Message.ok ? '合并文件已保存' : ('保存失败：' + (Message.error || '未知')));
            }
            if (Message.Message === 'vrMergeError') {
                vrMergeGroups.forEach(function (g) {
                    if (g.taskId !== Message.taskId) { return; }
                    g.state = 'error';
                    g.items.forEach(function (d) { vrMergeBadge(d, 'error', g.taskId); });
                });
                tip('合并失败：' + (Message.error || '未知错误'));
            }
        });
        // 面板重开：问 SW 有没有拼好等保存的活（SW 重启会丢，属已知限制）
        try {
            chrome.runtime.sendMessage({ Message: 'vrMergeStatus' }, function (res) {
                if (chrome.runtime.lastError || !res || !res.tasks) { return; }
                res.tasks.forEach(function (t) {
                    if (t.state !== 'ready') { return; }
                    // 按 urls 找回本面板的组
                    vrMarkGroupBadges();
                    vrMergeGroups.forEach(function (g) {
                        var same = g.items.length === t.urls.length &&
                            g.items.every(function (d, i) { return d.url === t.urls[i]; });
                        if (same) {
                            g.taskId = t.taskId;
                            g.state = 'ready';
                            g.ext = t.ext;
                            g.items.forEach(function (d, i) { vrMergeBadge(d, 'ready', g.taskId); });
                        }
                    });
                });
            });
        } catch (e) { /* 老版本忽略 */ }
    }



    /* ==========================================================
     * 十一、站点增强（M3 的 B站分P）
     * ========================================================== */

    var siteInfo = { bili: null };
    var biliExpanded = false;

    /** 当前标签页网址。G.webUrl 只在 background 上下文存在，面板里必须走 chrome.tabs.get */
    function currentPageUrl() {
        var tabId = (window.G && G.tabId) || -1;
        if (tabId < 0) { return Promise.resolve(''); }
        return new Promise(function (resolve) {
            try {
                chrome.tabs.get(tabId, function (tab) {
                    resolve((chrome.runtime.lastError || !tab) ? '' : (tab.url || ''));
                });
            } catch (e) { resolve(''); }
        });
    }

    /** B站：读页面 __INITIAL_STATE__ 拿分P列表（主世界执行，零签名对抗） */
    function fetchBiliParts(tabId) {
        return chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            func: function () {
                try {
                    var s = window.__INITIAL_STATE__;
                    if (!s || !s.videoData) { return null; }
                    var vd = s.videoData;
                    if (!vd.pages || !vd.pages.length) { return null; }
                    return {
                        bvid: vd.bvid || '',
                        title: vd.title || '',
                        pages: vd.pages.map(function (p) {
                            return { page: p.page, part: p.part || p.page, cid: p.cid };
                        })
                    };
                } catch (e) { return null; }
            }
        }).then(function (res) {
            return (res && res[0] && res[0].result) || null;
        }).catch(function () { return null; });
    }

    function buildBiliBanner(info) {
        var old = el('vrBiliBanner');
        if (old) { old.remove(); }
        if (!info || !info.pages || info.pages.length < 2) { return; }

        var box = document.createElement('div');
        box.id = 'vrBiliBanner';
        box.className = 'vr-banner';

        var n = info.pages.length;
        box.innerHTML =
            '<div class="vr-banner-head">' +
            '<span class="vr-banner-tag">B站</span>' +
            '<span class="vr-banner-txt">本页共 <b>' + n + '</b> 个分P</span>' +
            '<button class="fbtn vr-banner-toggle">展开</button>' +
            '<button class="fbtn primary vr-banner-open">后台打开全部</button>' +
            '</div>' +
            '<div class="vr-banner-body hide">' +
            info.pages.map(function (p) {
                return '<label class="vr-partrow"><span class="vr-partno">P' + p.page + '</span>' +
                    '<span class="vr-partname">' + escHtml(p.part) + '</span></label>';
            }).join('') +
            '</div>';

        var anchor = el('Tips');
        anchor.parentNode.insertBefore(box, anchor);

        var body = box.querySelector('.vr-banner-body');
        var toggle = box.querySelector('.vr-banner-toggle');
        toggle.addEventListener('click', function () {
            biliExpanded = !biliExpanded;
            body.classList.toggle('hide', !biliExpanded);
            toggle.textContent = biliExpanded ? '收起' : '展开';
        });

        if (biliExpanded) { body.classList.remove('hide'); toggle.textContent = '收起'; }

        box.querySelector('.vr-banner-open').addEventListener('click', function () {
            openAllParts(info);
        });

        // 给 B站 卡片挂上「分P ×N」chip（原型要求）
        vrAllData().forEach(function (d) {
            if (!d || !d.html) { return; }
            var u = d.webUrl || '';
            if (u.indexOf('bilibili.com/video') < 0) { return; }
            if (d.html.find('.partchip').length) { return; }
            var chip = $('<button class="partchip" title="展开本页分P列表">分P ×' + n + '</button>');
            chip.on('click', function (e) {
                e.stopPropagation();
                if (!biliExpanded) { toggle.click(); }
                box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });
            d.html.find('.icon.download').before(chip);
        });
    }

    var openingParts = false;
    function openAllParts(info) {
        if (openingParts) { return; }
        var n = info.pages.length;
        if (n > 12 && !confirm('要打开 ' + n + ' 个后台标签页，可能有点卡。继续？')) { return; }

        currentPageUrl().then(function (full) {
            var base = full.split('?')[0];
            if (!base || base.indexOf('bilibili.com/video') < 0) {
                tip('拿不到当前视频地址，先刷新一下页面');
                return;
            }
            openingParts = true;
            tip('正在后台打开 ' + n + ' 个分P，嗅探完成后到「其他页面」批量下载');

            var i = 0;
            var timer = setInterval(function () {
                if (i >= n) {
                    clearInterval(timer);
                    openingParts = false;
                    tip('已打开 ' + n + ' 个分P，切到「其他页面」看看');
                    return;
                }
                var p = info.pages[i++];
                chrome.tabs.create({ url: base + '?p=' + p.page, active: false });
            }, 700);
        });
    }

    function detectSite() {
        var tabId = (window.G && G.tabId) || -1;
        if (tabId < 0) { return; }

        currentPageUrl().then(function () {
            // YouTube 明确不做（ADR-019/022/034）：页面/面板不再给任何入口或提示横幅

            // B站：不看域名看数据——页面里有 __INITIAL_STATE__.videoData 就是分P页
            // （顺带兼容镜像站；非 B站页面注入后直接返回 null，成本几毫秒）
            fetchBiliParts(tabId).then(function (info) {
                if (!info) { return; }
                siteInfo.bili = info;
                buildBiliBanner(info);
            });
            // B站整段下载：先探能不能拿到「整段 MP4」(durl)，能才给入口，
            // 避免点了才失败（只会给 DASH 的片子集这部分不适用）
            fetchBiliWhole(tabId).then(function (info) {
                if (!info) { return; }
                biliWhole.info = info;
                buildBiliWholeBanner(info);
            });
        });
    }



    /* ==========================================================
     * 十一之二、B站「完整视频」下载（参考 b站视频下载助手，ADR-029）
     *
     * 关键认知：不是下不了，是「在哪儿下」。B站媒体 CDN 校验 Referer，
     * 扩展后台/offscreen 发起的请求没有 B站页面的 Referer 与登录态 →
     * SERVER_FORBIDDEN；而「页面主世界里自己的 XHR」天然带着这些 → 稳。
     * 再叠一层便利：向 B站 要「整段 MP4」(playurl 不带 fnval → durl)，
     * 拿到的就是一个完整文件，不用做 DASH 音视频合并。
     * ========================================================== */

    var biliWhole = { info: null, busy: false, timer: null };

    function fmtSize(n) {
        n = Number(n) || 0;
        if (!n) { return '大小未知'; }
        if (n < 1024 * 1024) { return (n / 1024).toFixed(0) + 'KB'; }
        return (n / 1024 / 1024).toFixed(1) + 'MB';
    }

    /** 探测能否拿到整段 MP4。拿不到就不显示入口（只给 DASH 的视频另行处理）
     *  主世界探测函数本体在 js/bili-whole.js（后台 SW 也要用同一份） */
    function fetchBiliWhole(tabId) {
        if (!chrome.scripting || tabId < 0 || !window.VR_BILI) { return Promise.resolve(null); }
        return chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            func: window.VR_BILI.probeFunc
        }).then(function (res) {
            var r = res && res[0] && res[0].result;
            return (r && (r.hasDurl || r.hasDash)) ? r : null;
        }).catch(function () { return null; });
    }

    /** 主世界：发起下载（不等完成），进度写进 window.__vrBiliDL 供轮询
     *  mode = 'durl'（整段MP4，快）| 'dash'（画面+声音分开，要合成，能上更高清晰度） */
    function startBiliWhole(info, box, mode) {
        if (biliWhole.busy) { tip('正在下载中，稍等'); return; }
        var tabId = (window.G && G.tabId) || -1;
        if (tabId < 0) { tip('拿不到当前标签页'); return; }

        var btns = box.querySelectorAll('.vr-whole-go');
        var prog = box.querySelector('.vr-whole-prog');
        for (var bi = 0; bi < btns.length; bi++) { btns[bi].disabled = true; }
        if (prog) { prog.classList.remove('hide'); }

        currentPageUrl().then(function (pageUrl) {
            var name = '';
            try {
                var N = window.VideoRodNaming;
                if (N) {
                    name = N.buildNameFromInfo({
                        title: info.title || '', post: '',
                        authorFull: info.owner || '', site: 'bilibili.com'
                    }, pageUrl, { tpl: settings.template, ext: 'mp4', index: 0 });
                }
            } catch (e) { name = ''; }
            if (!name) {
                name = cleanSeg((info.owner || '') + '_' + (info.title || '')) || 'bilibili';
                name = name + '.mp4';
            }
            // <a download> 不支持子目录，只能取文件名（这是本方案固有取舍，ADR-029）
            var segs = String(name).split('/');
            name = cleanSeg(segs[segs.length - 1]) || (info.bvid || 'bilibili') + '.mp4';

            biliWhole.busy = true;
            if (mode === 'dash') { return runBiliDash(tabId, name, info); }
            return chrome.scripting.executeScript({
                target: { tabId: tabId },
                world: 'MAIN',
                args: [name, info.cid, info.bvid],
                func: window.VR_BILI.durlFunc
            }).then(function () {
                pollBiliWhole(name, box, prog);
            });
        }).catch(function (e) {
            biliWhole.busy = false;
            resetBiliButtons(box, prog);
            tip('下载没起来：' + String((e && e.message) || e));
        });
    }

    function resetBiliButtons(box, prog) {
        var bs = box && box.querySelectorAll ? box.querySelectorAll('.vr-whole-go') : [];
        for (var i = 0; i < bs.length; i++) {
            bs[i].disabled = false;
            bs[i].textContent = bs[i].getAttribute('data-label') || '下载完整视频';
        }
        if (prog) { prog.classList.add('hide'); }
    }

    /** DASH 路线：页面主世界下载画面+声音 → mp4box 合成 → <a download> 落盘
     *  （ADR-029 补记：B站 把「整段MP4直链」封顶在 720P，1080P 只有 DASH 有，
     *   代价是音视频分开、必须在页面里合成——后台下不来，因为 CDN 要 B站 页面的 Referer） */
    function runBiliDash(tabId, name, info) {
        var box = el('vrBiliWhole');
        var prog = box && box.querySelector('.vr-whole-prog');
        // 先把合成库塞进页面主世界（147KB，只在走 1080P 时才注入）
        return chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            files: ['lib/mp4box.all.min.js']
        }).then(function () {
            return chrome.scripting.executeScript({
                target: { tabId: tabId },
                world: 'MAIN',
                args: [name, info.cid, info.bvid],
                func: window.VR_BILI.dashFunc
            });
        }).then(function () {
            pollBiliWhole(name, box, prog);
        }).catch(function (e) {
            biliWhole.busy = false;
            resetBiliButtons(box, prog);
            tip('高清下载没起来：' + String((e && e.message) || e));
        });
    }

    /** 轮询主世界进度（面板关了也没事：下载在页面里继续跑，落盘照旧） */
    function pollBiliWhole(name, box, prog) {
        var tabId = (window.G && G.tabId) || -1;
        var bar = box && box.querySelector('.vr-whole-bar i');
        var pctEl = box && box.querySelector('.vr-whole-pct');
        clearInterval(biliWhole.timer);

        function done(ok, msg) {
            clearInterval(biliWhole.timer);
            biliWhole.timer = null;
            biliWhole.busy = false;
            resetBiliButtons(box, prog);
            tip(msg);
            if (ok) {
                markDownloaded(name);      // 记进历史/去重（M9）
                if (typeof renderHistory === 'function') { renderHistory(); }
            }
        }

        biliWhole.timer = setInterval(function () {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                world: 'MAIN',
                func: function () { return window.__vrBiliDL || null; }
            }).then(function (res) {
                var st = res && res[0] && res[0].result;
                if (!st) { return; }
                /* ⚠️ 不能用 `if (st.pct)` 判 —— 0 是合法值，且 falsy。
                 * 早期版本这么写，刚起手的 0% 会被跳过、落到 loaded/total 分支；
                 * 两个都取不到就一个字都不更新，看着像卡死。 */
                var p = null;
                if (st.pct != null && isFinite(Number(st.pct))) {
                    p = Math.max(0, Math.min(100, Math.round(Number(st.pct))));
                } else if (st.total > 0) {
                    p = Math.max(0, Math.min(100, Math.round(st.loaded / st.total * 100)));
                }
                if (p != null && pctEl && bar) {
                    pctEl.textContent = (st.phase && !st.done)
                        ? (st.phase + ' ' + p + '%') : (p + '%');
                    bar.style.width = p + '%';
                } else if (st.phase && pctEl && !st.done) {
                    /* 没有百分比但有阶段：至少让人知道在动（准备/连接中/保存中） */
                    pctEl.textContent = st.phase;
                }
                if (st.done) {
                    if (st.error) { done(false, '下载失败：' + st.error); }
                    else { done(true, '已保存 ' + name + '（' + fmtSize(st.bytes) + '）'); }
                }
            }).catch(function () { /* 页面重载/标签关闭：静默收尾 */ });
        }, 700);
    }

    // B站清晰度档位 → 人话短标签：表在 js/bili-whole.js 里，全局只留一份
    function qShort(q) {
        return (window.VR_BILI && window.VR_BILI.qShort)
            ? window.VR_BILI.qShort(q) : (q ? ('qn' + q) : '');
    }

    function buildBiliWholeBanner(info) {
        var old = el('vrBiliWhole');
        if (old) { old.remove(); }
        if (!info) { return; }

        // 高清（DASH）比整段 MP4 档位高，才值得多给一个按钮；
        // 两条路档位一样时就只留「整段MP4」那个（它能一步到位，不用合成）
        var wantDash = !!info.hasDash &&
            (!info.hasDurl || Number(info.dashQuality) > Number(info.quality || 0));
        var meta = [];
        if (info.hasDurl) {
            meta.push(fmtSize(info.size) + ' · ' +
                (qShort(info.quality) || info.qualityText || info.format || 'mp4'));
        }
        // DASH 不显示大小：它只给码率不给实际体积，按码率估会差一倍（实测 69MB 预估 → 32MB 实际），
        // 与其给个错数字，不如不给
        if (wantDash) {
            meta.push((qShort(info.dashQuality) || info.dashQualityText || '高清') +
                '（需合成，体积比标清大）');
        }
        if (!meta.length && info.hasDash) {
            meta.push((qShort(info.dashQuality) || info.dashQualityText || '高清') +
                '（需合成）');
            wantDash = true;
        }

        var btns = '';
        if (info.hasDurl) {
            btns += '<button class="fbtn primary vr-whole-go" data-label="下载 ' +
                escHtml(qShort(info.quality) || '视频') + ' · 快">' +
                '下载 ' + escHtml(qShort(info.quality) || '视频') + ' · 快</button>';
        }
        if (wantDash) {
            btns += '<button class="fbtn vr-whole-go vr-whole-hd" data-label="下载 ' +
                escHtml(qShort(info.dashQuality) || '高清') + ' · 高清">' +
                '下载 ' + escHtml(qShort(info.dashQuality) || '高清') + ' · 高清</button>';
        }

        var box = document.createElement('div');
        box.id = 'vrBiliWhole';
        box.className = 'vr-banner vr-banner-whole';
        box.innerHTML =
            '<div class="vr-banner-head">' +
            '<span class="vr-banner-tag">B站</span>' +
            '<span class="vr-banner-txt"><b>完整视频</b><br>' +
            '<span class="vr-whole-meta">' + escHtml(meta.join('　｜　')) +
            (info.topAccept && info.quality && info.topAccept > info.quality && !wantDash
                ? ' · <span class="vr-whole-note">已按账号给到最高档</span>' : '') +
            '</span></span>' +
            '<span class="vr-whole-btns">' + btns + '</span>' +
            '</div>' +
            '<div class="vr-whole-prog hide">' +
            '<div class="vr-whole-bar"><i style="width:0%"></i></div>' +
            '<span class="vr-whole-pct">0%</span>' +
            '</div>';

        var anchor = el('Tips');
        anchor.parentNode.insertBefore(box, anchor);

        var goDurl = box.querySelector('.vr-whole-go:not(.vr-whole-hd)');
        if (goDurl) {
            goDurl.addEventListener('click', function () { startBiliWhole(info, box, 'durl'); });
        }
        var goDash = box.querySelector('.vr-whole-hd');
        if (goDash) {
            goDash.addEventListener('click', function () { startBiliWhole(info, box, 'dash'); });
        }
    }

    /* ==========================================================
     * 十二、图片批量保存（M5）
     * ========================================================== */

    var scannedImages = [];

    /* ---------------- 「本页图片」扫描 ---------------- */

    /* 默认值与 js/lib-image-util.js 的 DEFAULT_SETTINGS 对齐：
     * imgMinSize 判**原始像素**，imgBgScan 决定要不要扫 CSS 背景图。
     * 用户改过设置就跟着设置走 —— 否则侧栏清单 80 张、这里 60 张，又是两套口径。 */
    var IMG_SCAN_FALLBACK = { minSize: 100, bgScan: true };
    var scanOptsLast = { minSize: IMG_SCAN_FALLBACK.minSize, bgScan: IMG_SCAN_FALLBACK.bgScan };

    function readImgScanOpts() {
        return new Promise(function (resolve) {
            var out = { minSize: IMG_SCAN_FALLBACK.minSize, bgScan: IMG_SCAN_FALLBACK.bgScan };
            try {
                chrome.storage.local.get('vrLibSettings', function (x) {
                    void chrome.runtime.lastError;
                    var s = (x && x.vrLibSettings) || {};
                    var n = parseInt(s.imgMinSize, 10);
                    if (isFinite(n) && n >= 16 && n <= 4000) { out.minSize = n; }
                    if (s.imgBgScan !== undefined) { out.bgScan = !!s.imgBgScan; }
                    scanOptsLast = out;
                    resolve(out);
                });
            } catch (e) { resolve(out); }
        });
    }

    /**
     * 扫本页可保存的图片。
     *
     * 2026-11-12 重写（苏哥报「这个功能基本上不可用」，微博页 53 张图只出 2 张裂图）：
     *   ① 老实现自己抄了一份扫描逻辑，门槛写成「显示尺寸**短边** ≥ 600」。
     *      微博信息流图片显示宽度就 300~500，于是全被 `continue` 掉，只剩两张
     *      1024 的背景广告位 —— 而且那两张还打不开，就是用户截图里的样子。
     *   ② 现在复用页面里已注入的 VRImageUtil（= 侧栏清单/悬停同一个模块）：
     *      三条通道（img / 背景图 / 源码 JSON）+ 同一套尺寸口径。
     *      侧栏看到几张，这里就是几张，不会再各说各话。
     *   ③ 把 candidates（原图候选）一起带回。微博 /mw690/ → /large/ 的升级在
     *      collectCandidates 里做，后台逐个 fetch 校验，所以存下来的是原图。
     *   ④ 预载阶段明确 404/加载失败的地址标 fail 并剔掉，列表里不再有裂图；
     *      超时未探到尺寸的保留（不能因为慢就判死）。
     *
     * @returns {Promise<{list: Array, noUtil: boolean}>}
     */
    function collectImagesInPage() {
        var tabId = (window.G && G.tabId) || -1;
        if (!chrome.scripting || tabId < 0) {
            return Promise.resolve({ list: [], noUtil: false });
        }
        var target = { tabId: tabId };

        return readImgScanOpts().then(function (opts) {
            /* 工具模块是普通内容脚本（document_idle 注入）。刚打开的页面、或扩展
             * 重新加载后的老标签页里可能还没有 —— 先探一次，缺了就地补注入，
             * 否则会静默返回 0 张，用户只会以为「这功能彻底坏了」。 */
            return chrome.scripting.executeScript({
                target: target,
                func: function () {
                    return { has: typeof self.VRImageUtil !== 'undefined' };
                }
            }).then(function (res) {
                var r = (res && res[0] && res[0].result) || {};
                if (r.has) { return null; }
                return chrome.scripting.executeScript({
                    target: target,
                    files: ['js/lib-image-util.js', 'js/lib-download-scan.js']
                }).catch(function () { return null; });
            }).then(function () {
                return chrome.scripting.executeScript({
                    target: target,
                    /* async：末尾要等「尺寸回填 + 可达性探测」，executeScript 会等 Promise */
                    func: async function (o) {
                        var U = self.VRImageUtil;
                        if (!U) { return { __noUtil: true, items: [] }; }
                        var MIN = Math.max(16, Number(o.minSize) || U.MIN_SIZE);
                        var out = [];
                        var have = Object.create(null);

                        function push(url, w, h, cands, bg) {
                            if (!url || have[url]) { return; }
                            have[url] = 1;
                            out.push({
                                url: url,
                                w: Number(w) || 0,
                                h: Number(h) || 0,
                                bg: !!bg,
                                candidates: (cands && cands.length) ? cands.slice() : [url]
                            });
                        }
                        function take(list, isBg) {
                            for (var i = 0; i < list.length; i++) {
                                var it = list[i];
                                if (!it || !it.url) { continue; }
                                push(it.url, it.w, it.h, it.candidates, it.bg || isBg);
                            }
                        }

                        // 通道 ①：<img>（尺寸/占位/格式/重复过滤都在 scanImages 里）
                        try {
                            take(U.scanImages(document, {
                                minWidth: MIN, minHeight: MIN,
                                minShow: U.PANEL_MIN_SHOW, dedupe: true
                            }), false);
                        } catch (e) { /* 单通道失败不影响其它 */ }

                        // 通道 ②：CSS 背景图（信息流封面常做成 div 背景）
                        if (o.bgScan) {
                            try {
                                take(U.scanBackgrounds(document, {
                                    minShow: U.PANEL_MIN_SHOW, dedupe: true
                                }), true);
                            } catch (e) { /* 同上 */ }
                        }

                        // 通道 ③：源码/JSON 里的地址 —— 只在前两条通道一张都没扫到时兜底。
                        // 否则会把热搜徽章、logo、箭头图标一起抓进来（微博实测多 5 张噪音）。
                        if (out.length === 0) {
                            try {
                                var S = self.VRDownloadScan;
                                if (S && S.extractUrlsFromHtml && document.body) {
                                    var src = S.extractUrlsFromHtml(
                                        document.body.innerHTML || '', location.href, 400
                                    );
                                    for (var k = 0; k < src.length; k++) { push(src[k], 0, 0, [src[k]], false); }
                                }
                            } catch (e) { /* 同上 */ }
                        }

                        /* 尺寸回填 + 可达性探测（页面上下文预载，带正确 Referer/Cookie）。
                         * 懒加载站点扫描瞬间大量 naturalWidth=0，不补就全是「尺寸未知」。 */
                        try {
                            var miss = [];
                            for (var m = 0; m < out.length; m++) {
                                if (!(out[m].w > 0 && out[m].h > 0)) { miss.push(out[m].url); }
                            }
                            if (miss.length && typeof U.fillSizes === 'function') {
                                var got = await U.fillSizes(miss.slice(0, 60), 2500);
                                for (var n = 0; n < out.length; n++) {
                                    if (out[n].w > 0 && out[n].h > 0) { continue; }
                                    var sz = got[out[n].url];
                                    if (!sz) { continue; }
                                    if (sz.fail) { out[n].dead = true; continue; }
                                    if (sz.w > 0 && sz.h > 0) {
                                        /* 回填拿到真实尺寸后**再过一遍采集门槛**。
                                         * 未解码的图先收进来是为了不漏（懒加载），
                                         * 但补到尺寸才知道它其实是个 60×60 图标 ——
                                         * 不过这一道，批量清单里会混进一堆表情/图标。
                                         * 实测（e2e-grab）：不判就多收 1 张 60×60。 */
                                        if (sz.w < MIN || sz.h < MIN) {
                                            out[n].dead = true;
                                            out[n].tiny = true;
                                            continue;
                                        }
                                        out[n].w = sz.w;
                                        out[n].h = sz.h;
                                    }
                                }
                            }
                        } catch (e) { /* 回填失败保持「尺寸未知」 */ }

                        /* 明确打不开的剔掉（超时未探的不在此列）。
                         * 全页只剩坏图时宁可返回空 —— 空列表带提示，比一堆裂图诚实。 */
                        var alive = [];
                        var deadCnt = 0;
                        var tinyCnt = 0;
                        for (var q = 0; q < out.length; q++) {
                            if (!out[q].dead) { alive.push(out[q]); continue; }
                            if (out[q].tiny) { tinyCnt++; } else { deadCnt++; }
                        }
                        return { items: alive, dropped: deadCnt, tiny: tinyCnt };
                    },
                    args: [opts]
                });
            }).then(function (res) {
                var r = (res && res[0] && res[0].result) || {};
                if (r && r.__noUtil) { return { list: [], noUtil: true }; }
                return {
                    list: (r && r.items) || [],
                    noUtil: false,
                    dropped: r.dropped || 0,
                    tiny: r.tiny || 0
                };
            }).catch(function () { return { list: [], noUtil: false }; });
        });
    }

    function ensureImageModal() {
        if (el('vrImgModal')) { return; }
        var mask = document.createElement('div');
        mask.className = 'mask';
        mask.id = 'vrImgMask';

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'vrImgModal';
        modal.innerHTML =
            '<h3>本页图片 <span id="vrImgCount" style="color:var(--vr-cyan)">0</span></h3>' +
            '<div class="sub">勾选要保存的图片，按「页面标题_序号」命名，存进默认目录。</div>' +
            '<div class="vrimg-list" id="vrImgList"></div>' +
            '<div class="tplrow" style="margin-top:10px">' +
            '<button id="vrImgAll" style="background:#222736;border-color:#2c3444;color:#c6cdd9">全选</button>' +
            '<button id="vrImgDown">保存选中</button>' +
            '</div>';

        var shell = el('vrShell');
        shell.appendChild(mask);
        shell.appendChild(modal);

        mask.addEventListener('click', closeImageModal);
        modal.querySelector('#vrImgAll').addEventListener('click', function () {
            var boxes = modal.querySelectorAll('.vrimg-chk');
            var allOn = Array.prototype.every.call(boxes, function (b) { return b.checked; });
            Array.prototype.forEach.call(boxes, function (b) { b.checked = !allOn; });
            this.textContent = allOn ? '全选' : '全不选';
        });
        modal.querySelector('#vrImgDown').addEventListener('click', downloadPickedImages);
    }

    function closeImageModal() {
        if (el('vrImgMask')) { el('vrImgMask').classList.remove('on'); }
        if (el('vrImgModal')) { el('vrImgModal').classList.remove('on'); }
    }

    function openImageModal(scan) {
        ensureImageModal();
        var images = (scan && scan.list) || [];
        var noUtil = !!(scan && scan.noUtil);
        scannedImages = images;
        var list = el('vrImgList');
        el('vrImgCount').textContent = images.length;

        if (!images.length) {
            /* 空列表要分清「真没有图」和「扫描器没跑起来」——
             * 老实现两种情况都写「没扫到」，用户以为是页面没图。 */
            var why = noUtil
                ? '扫描模块没注入到这个页面（浏览器内部页/PDF 不支持）。请刷新页面后重试。'
                : '本页没扫到可保存的图片（尺寸门槛 ' + (scanOptsLast.minSize || 100)
                    + 'px，可在设置里调小）。';
            list.innerHTML = '<div style="font-size:11px;color:#98a2b3;padding:10px 0;line-height:1.7">'
                + why + '</div>';
        } else {
            list.innerHTML = images.map(function (im, i) {
                /* 元信息：有尺寸显示尺寸，「背景」标一下来源，都没有才是「尺寸未知」。
                 * 老实现把没有尺寸的一律写「背景图」—— 源码通道抓到的图也被标成背景，误导。 */
                var meta;
                if (im.w > 0 && im.h > 0) {
                    meta = im.w + '×' + im.h + (im.bg ? ' · 背景' : '');
                } else {
                    meta = (im.bg ? '背景图 · ' : '') + '尺寸未知';
                }
                return '<label class="vrimg-row">' +
                    '<input type="checkbox" class="chk vrimg-chk" data-i="' + i + '" checked>' +
                    '<img src="' + esc(im.url) + '" loading="lazy"' +
                    // 预载已剔除明确坏的；这里是兜底：万一弹窗内加载失败，标灰并说明
                    ' onerror="this.style.opacity=.25;this.alt=\'打不开\'">' +
                    '<span class="vrimg-meta">' + esc(meta) + '</span>' +
                    '</label>';
            }).join('');
        }
        el('vrImgMask').classList.add('on');
        el('vrImgModal').classList.add('on');
    }

    function downloadPickedImages() {
        var picked = [];
        document.querySelectorAll('#vrImgList .vrimg-chk').forEach(function (b) {
            if (b.checked) { picked.push(scannedImages[+b.dataset.i]); }
        });
        if (!picked.length) { tip('先勾选要保存的图片'); return; }

        var dir = cleanPath(settings.defaultDir) || DEFAULTS.defaultDir;
        var base = (pageInfo && pageInfo.title) || (el('vrPageTitle') && el('vrPageTitle').textContent) || '图片';
        var N = naming();

        var names = picked.map(function (im, i) {
            /* 扩展名按**实际会下载的地址**推：candidates[0] 是原图候选
             * （微博 /large/ 升级后的地址），拿显示地址推可能推错。 */
            var pick = (im.candidates && im.candidates.length) ? im.candidates[0] : im.url;
            var ext = (String(pick).split('#')[0].split('?')[0].split('.').pop() || 'jpg').toLowerCase();
            if (!/^(jpg|jpeg|png|gif|webp|avif|bmp)$/.test(ext)) { ext = 'jpg'; }
            var nm;
            if (N && N.buildNameFromInfo) {
                nm = N.buildNameFromInfo({ title: base, site: '' }, im.url, {
                    tpl: '${title}_${index}', ext: ext, index: i
                });
            } else {
                nm = base + '_' + String(i + 1).padStart(2, '0') + '.' + ext;
            }
            return nm;
        });
        names = dedupe(names);

        var ok = 0;
        picked.forEach(function (im, i) {
            var filename = dir + '/' + cleanPath(names[i]);
            if (isDownloaded(filename)) { return; }
            markDownloaded(filename);
            // 交给 SW 落盘（vrImg.download），不再直接调 chrome.downloads。
            // Chrome 147 起 downloads 的文件名保护失效（ADR-040），SW 侧会优先走
            // FSA 直写保住文件名，拿不到句柄才回退下载器。
            chrome.runtime.sendMessage({
                Message: 'vrImg.download',
                url: im.url,
                /* 候选一起给后台：vrImgResolve 会按顺序 fetch 校验，
                 * 微博 /large/ 拿不到就退 /mw690/，不会因为原图 404 就整张失败。 */
                candidates: (im.candidates && im.candidates.length) ? im.candidates : [im.url],
                title: names[i],
                index: i,
                pageUrl: (G && G.pageUrl) || '',
                /* 面板是扩展页面，无网页 DOM；带 tabId 让后台注入取站名。 */
                tabId: (G && G.tabId) || -1
            }, function (r) {
                if (chrome.runtime.lastError || !r || !r.ok) {
                    console.warn('[video-rod] 抓图落盘失败', chrome.runtime.lastError || r);
                }
            });
            ok++;
        });

        closeImageModal();
        tip(ok ? ('已保存 ' + ok + ' 张图片到 ' + dir + '/') : '这些图都下过了');
    }

    function bindImageScan() {
        var btn = el('vrScanImages');
        if (!btn) { return; }
        btn.addEventListener('click', function () {
            btn.disabled = true;
            btn.textContent = '扫描中…';
            collectImagesInPage().then(function (scan) {
                btn.disabled = false;
                btn.textContent = '抓图';
                openImageModal(scan);
                /* 剔掉东西要说一声，不能让用户以为「页面上本来就这么点图」。
                 * 两种原因分开讲：打不开（坏图）vs 太小（图标/表情）。 */
                if (scan && (scan.dropped > 0 || scan.tiny > 0)) {
                    var parts = [];
                    if (scan.dropped > 0) { parts.push(scan.dropped + ' 张打不开'); }
                    if (scan.tiny > 0) { parts.push(scan.tiny + ' 张太小（图标）'); }
                    tip('已过滤 ' + parts.join('、'));
                }
            });
        });
    }



    /* ==========================================================
     * 十三、启动
     * ========================================================== */

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escHtml(s) { return esc(s); }

    function setVersion() {
        var v = el('vrVer');
        if (!v) { return; }
        try {
            v.textContent = 'v' + chrome.runtime.getManifest().version;
        } catch (e) { /* 忽略 */ }
    }

    /** G.tabId 是异步查出来的（init.js 里 chrome.tabs.query），必须等它落地 */
    function waitTabId(cb, tries) {
        var n = tries || 0;
        if (window.G && G.tabId > 0) { cb(G.tabId); return; }
        if (n > 40) { cb(-1); return; }
        setTimeout(function () { waitTabId(cb, n + 1); }, 50);
    }

    var smartTimer = null;
    function scheduleSmart() {
        clearTimeout(smartTimer);
        smartTimer = setTimeout(function () { applySmartNaming(false); }, 120);
    }

    function watchList() {
        var list = el('mediaList');
        if (!list || typeof MutationObserver === 'undefined') { return; }
        var obs = new MutationObserver(function () {
            updateCounts();
            vrMarkGroupBadges();
            if (settings.smartName && pageInfo) { scheduleSmart(); }
        });
        obs.observe(list, { childList: true, subtree: false });
    }

    function boot() {
        setVersion();
        loadSettings(function () {
            syncSettingsUI();
            bindDrawers();
            bindSettingsInputs();
            bindFilters();
            bindOverview();
            bindFoot();
            bindDirMenu();
            bindRenameModal();
            bindClearDownloaded();
            bindHistoryView();
            bindMergeMessages();
            bindImageScan();
            watchList();

            // 下载管线（M2）：需要在猫抓绑定之前装好钩子
            loadDownloaded(function () {
                hookDownloadsApi();
                bindDownloadHooks();
                bindDownloadProgress();
            });

            // 先按现有数据刷一遍，再等 tabId 落地做页面信息 + 智能起名
            updateCounts();
            vrMarkGroupBadges();   // M11：已渲染的卡片立即归组打徽标（观察者只抓后续新增）
            waitTabId(function (id) {
                if (id < 0) { return; }
                fillPageInfo();
                detectSite();
                vrMarkGroupBadges();   // tabId 落地后数据可能才到齐，再归组一遍
                if (!settings.smartName) { return; }
                fetchPageInfo().then(function (info) {
                    pageInfo = info;
                    hasPageInfo = !!info;
                    if (info) { applySmartNaming(false); }
                });
            });
        });

        // 猫抓新增资源后，稍等一拍再刷新计数/补智能名
        try {
            chrome.runtime.onMessage.addListener(function (msg) {
                if (!msg) { return; }
                setTimeout(function () {
                    updateCounts();
                    if (settings.smartName && pageInfo) { applySmartNaming(false); }
                }, 60);
            });
        } catch (e) { /* 忽略 */ }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    function openMediaLibrary() {
        try {
            var url = chrome.runtime.getURL('library.html');
            if (chrome.windows && chrome.windows.create) {
                chrome.windows.create({ url: url, type: 'popup', width: 1280, height: 900, focused: true });
            } else {
                chrome.tabs.create({ url: url });
            }
        } catch (e) {
            tip('打开媒体库失败：' + e);
        }
    }
    ['vrOpenLibrary', 'vrOpenLibrarySettings', 'vrOpenLibraryDrawer'].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) { b.addEventListener('click', openMediaLibrary); }
    });

    /* ==========================================================
     * 媒体库首次引导（ADR-078）
     *
     * 起因：用户不知道媒体库在哪。装完欢迎页会讲一次，但很多人直接关掉；
     * 点开扩展图标时再用大字说一遍，才算真的"先让大家用起来"。
     *
     * 弹出策略（苏哥授权由我定）：
     *   · 完成任一动作（打开 / 加收藏 / 我知道了）→ 永久静默；
     *   · 什么都没做 → 最多弹 3 次，之后自动静默，不骚扰。
     *   为什么不是"每次都弹"：天天挡一次会让人讨厌这个功能，反而更不用它。
     *   为什么不是"只弹一次"：有人第一次手快关掉，再也没机会知道。
     *
     * 书签写入必须查重：实测连点两次会真的产生两条一样的书签
     * （见 tools/probe-bookmark-popup.py 的 Q3），浏览器不查重。
     * ========================================================== */
    var LIB_INTRO_KEY = 'vrLibIntroSeen';   // 已看过次数
    var LIB_INTRO_MAX = 3;
    var LIB_BM_TITLE = '媒体库 · 苏哥的钓鱼竿';

    function libUrl() {
        try { return chrome.runtime.getURL('library.html'); } catch (e) { return ''; }
    }

    function bindLibraryIntro() {
        var box = document.getElementById('vrLibIntro');
        if (!box) { return; }

        var url = libUrl();
        var openBtn = document.getElementById('vrLiOpen');
        var bmBtn = document.getElementById('vrLiBookmark');
        var skipBtn = document.getElementById('vrLiSkip');

        function hide() { box.hidden = true; }

        /* 标记已引导过：完成任一动作都算，之后永不再弹 */
        function markDone() {
            try { chrome.storage.local.set({ vrLibIntroDone: true }); } catch (e) { /* 忽略 */ }
        }

        function setBmDone() {
            if (!bmBtn) { return; }
            bmBtn.textContent = '✓ 已在收藏夹';
            bmBtn.classList.add('done');
            bmBtn.dataset.done = '1';
        }

        /* 打开媒体库：独立窗口（1280×900），关掉也一直在 */
        if (openBtn) {
            openBtn.addEventListener('click', function () {
                markDone();
                hide();
                openMediaLibrary();
            });
        }

        /* 加收藏夹：先 search 查重 → 没有再 create → 落到书签栏(id=1) */
        if (bmBtn) {
            var api = (typeof chrome !== 'undefined') ? chrome.bookmarks : null;

            if (!api || typeof api.create !== 'function') {
                bmBtn.textContent = '浏览器未授权书签';
                bmBtn.disabled = true;
            } else {
                /* 进 popup 先查一次：已收藏就直接显示终态 */
                try {
                    api.search({ url: url }, function (items) {
                        if (chrome.runtime.lastError) { return; }
                        if (items && items.length) { setBmDone(); }
                    });
                } catch (e) { /* 忽略 */ }

                bmBtn.addEventListener('click', function () {
                    if (bmBtn.dataset.done === '1') { return; }   // 已加过，不再写第二条

                    function doCreate() {
                        try {
                            api.create({ parentId: '1', title: LIB_BM_TITLE, url: url }, function () {
                                var err = chrome.runtime.lastError;
                                if (err) {
                                    bmBtn.textContent = '添加失败，可手动加';
                                    tip('加书签失败：' + err.message);
                                    return;
                                }
                                setBmDone();
                                markDone();
                                tip('已放进收藏夹栏，以后点一下就进来');
                                setTimeout(hide, 900);
                            });
                        } catch (e) {
                            bmBtn.textContent = '添加失败，可手动加';
                            tip('加书签失败：' + e.message);
                        }
                    }

                    try {
                        api.search({ url: url }, function (items) {
                            if (chrome.runtime.lastError) { doCreate(); return; }
                            if (items && items.length) {
                                setBmDone();
                                markDone();
                                tip('这个地址已经在收藏夹里了');
                                setTimeout(hide, 700);
                                return;
                            }
                            doCreate();
                        });
                    } catch (e) { doCreate(); }
                });
            }
        }

        /* 我知道了：永久静默 */
        if (skipBtn) {
            skipBtn.addEventListener('click', function () {
                markDone();
                hide();
            });
        }

        /* 点蒙层空白处也关掉（不标记 done，计入次数，下次还可能提示） */
        box.addEventListener('click', function (e) {
            if (e.target === box) { hide(); }
        });

        /* 决定这次弹不弹 */
        try {
            chrome.storage.local.get(['vrLibIntroDone', LIB_INTRO_KEY], function (res) {
                if (res && res.vrLibIntroDone) { return; }          // 已完成过，永不弹

                var seen = (res && Number(res[LIB_INTRO_KEY])) || 0;
                if (seen >= LIB_INTRO_MAX) { return; }              // 弹够次数了，静默

                try {
                    var o = {};
                    o[LIB_INTRO_KEY] = seen + 1;
                    chrome.storage.local.set(o);
                } catch (e) { /* 忽略 */ }

                box.hidden = false;
            });
        } catch (e) { /* storage 不可用时不弹，宁可少提示也不要报错 */ }
    }

    bindLibraryIntro();

    /* 顶栏「本页图片清单」：把侧边栏切到 image.html 再打开。
     * 与 vrSidePanel 的区别：那个只是把当前 popup 挪到侧边栏，
     * 这个直接进图片网格页（AIX imagePage 的对应物）。
     *
     * 两种情况要分开处理（踩过）：
     *   · 本页已在侧边栏里 → sidePanel.open() 不需要也不该调（它要用户手势，
     *     在已经打开的面板里调会静默失败），直接原地切 URL 最快最稳。
     *   · 本页是独立的 popup 窗口 → 需要 setOptions + open 把它挪进侧边栏。 */
    var btnImagePage = document.getElementById('vrOpenImagePage');
    if (btnImagePage) {
        btnImagePage.addEventListener('click', function () {
            var tid = (window.G && G.tabId) || -1;
            if (tid <= 0) { tip('拿不到当前标签页'); return; }

            function goImagePage() {
                try {
                    location.href = chrome.runtime.getURL('image.html?tabId=' + tid);
                } catch (e) { tip('打不开图片页：' + e); }
            }

            /* 是否已在侧边栏里：用显式 type 参数判断，不靠 innerWidth。
             * popup.js 的约定是 type=tab / type=window 表示「用户主动开成了标签/窗口」，
             * 没有 type 就是默认的侧边栏/工具栏弹窗形态。
             * 早先用 innerWidth < 520 判，结果独立 popup 窗口（380px）也被误判成侧边栏。 */
            var inSidePanel = false;
            try {
                var q = new URLSearchParams(location.search || '');
                inSidePanel = !q.get('type');
            } catch (e) { inSidePanel = true; }

            if (inSidePanel) {
                try {
                    chrome.runtime.sendMessage({
                        Message: 'vrImg.sidePanelPath',
                        path: 'image.html',
                        tabId: tid
                    }, function () { void chrome.runtime.lastError; });
                } catch (e) { /* 忽略 */ }
                goImagePage();
                return;
            }

            var finish = function (win) {
                var wid = win && win.id;
                if (wid === null || wid === undefined) { tip('打不开侧边栏：找不到窗口'); return; }
                try {
                    chrome.runtime.sendMessage({
                        Message: 'vrImg.sidePanelPath',
                        path: 'image.html',
                        tabId: tid,
                        windowId: wid,
                        open: true
                    }, function () { void chrome.runtime.lastError; });
                } catch (e) { tip('打不开图片页：' + e); }
            };
            try {
                chrome.windows.getCurrent(function (win) {
                    if (!chrome.runtime.lastError && win && win.id !== undefined) { finish(win); return; }
                    chrome.windows.getAll(function (wins) {
                        finish(wins && (wins.filter(function (x) { return x.focused; })[0] || wins[0]));
                    });
                });
            } catch (e) { tip('打不开图片页：' + e); }
        });
    }

    /* 「下载管理」：独立窗口打开 downloads.html。
     * 与「下载历史」的分工：
     *   下载历史 = 我们自己的去重账本（下过什么，可删记录）
     *   下载管理 = 浏览器下载器的实时任务（进度/暂停/继续/重试/取消） */
    var btnDownloads = document.getElementById('vrOpenDownloads');
    if (btnDownloads) {
        btnDownloads.addEventListener('click', function () {
            try {
                var url = chrome.runtime.getURL('downloads.html');
                if (chrome.windows && chrome.windows.create) {
                    chrome.windows.create({ url: url, type: 'popup', width: 900, height: 680, focused: true });
                } else {
                    chrome.tabs.create({ url: url });
                }
            } catch (e) { tip('打不开下载管理：' + e); }
        });
    }
})();
