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

    function applyLibraryVisibility() {
        var b = el('vrOpenLibrary');
        if (b) { b.style.display = settings.libraryEnabled === false ? 'none' : ''; }
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
        return true;
    }

    var batchTotal = 0;
    var batchDone = 0;

    /** 记录本批下载 id（monkey-patch chrome.downloads.download） */
    function hookDownloadsApi() {
        try {
            var api = chrome.downloads;
            var orig = api.download;
            if (!orig || orig.__vrHooked) { return; }
            var wrapped = function (opts, cb) {
                return orig.call(api, opts, function (id) {
                    if (id) { batchIds.push(id); }
                    cb && cb(id);
                });
            };
            wrapped.__vrHooked = true;
            api.download = wrapped;
        } catch (e) { /* 个别版本 API 只读，忽略 */ }
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
                    if (batchIds.indexOf(delta.id) >= 0) {
                        batchDone++;
                        if (batchTotal && batchDone >= batchTotal) {
                            tip('批量完成：' + batchDone + ' 个文件已保存');
                            batchTotal = 0;
                            batchDone = 0;
                            batchIds = [];
                        }
                    }
                }
                if (delta.state && delta.state.current === 'interrupted') {
                    if (data) {
                        data.html.removeClass('done');
                        data.html.attr('data-vr-state', '失败');
                        // 失败了就把去重记录撤掉，允许重试
                        var key = hashKey(data.downFileName || '');
                        if (downloaded[key]) {
                            delete downloaded[key];
                            saveDownloaded();
                        }
                        tip('下载失败：' + (delta.error && delta.error.current || '未知原因'));
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
                var p;
                if (st.pct) { p = Math.min(100, Math.round(st.pct)); }
                else if (st.total) { p = Math.min(100, Math.round(st.loaded / st.total * 100)); }
                if (p != null && pctEl && bar) {
                    pctEl.textContent = (st.phase && !st.done) ? (st.phase + ' ' + p + '%') : (p + '%');
                    bar.style.width = p + '%';
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

    function collectImagesInPage() {
        var tabId = (window.G && G.tabId) || -1;
        if (!chrome.scripting || tabId < 0) { return Promise.resolve([]); }

        return chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: function () {
                var out = [];
                var seen = {};
                // 与 js/lib-image-util.js 的 MIN_SHOW / MAX_ASPECT 保持一致。
                // 这里是 executeScript 注入到页面的函数，拿不到外部模块变量，
                // 只能就地写一份；改门槛时**两处都要改**（当前 600 / 6）。
                var MIN_SHOW = 600;
                var MAX_ASPECT = 6;
                function push(src, w, h, alt) {
                    if (!src || src.indexOf('data:') === 0 || seen[src]) { return; }
                    seen[src] = 1;
                    out.push({ src: src, w: w || 0, h: h || 0, alt: alt || '' });
                }
                // <img>
                var imgs = document.querySelectorAll('img');
                for (var i = 0; i < imgs.length && out.length < 300; i++) {
                    var im = imgs[i];
                    var src = im.currentSrc || im.src;
                    var w = im.naturalWidth || im.width || 0;
                    var h = im.naturalHeight || im.height || 0;
                    // 明确加载失败的图（complete 且无固有尺寸）直接跳过，
                    // 还没加载完的保留——可能是懒加载，扫描后正好触发加载
                    if (im.complete && !im.naturalWidth) { continue; }
                    // 跳过图标/小图：判**显示尺寸**而不是原始像素。
                    // 早先只看 naturalWidth<120，一张 640x480 的图标被 CSS 缩成 16px 显示
                    // 仍然会通过 —— 和页面悬停踩的是同一个坑（见 docs/RESEARCH-COMPETITOR-IMAGE.md）。
                    var box = null;
                    try { box = im.getBoundingClientRect(); } catch (e) { box = null; }
                    var dw = box ? Math.round(box.width) : (im.clientWidth || 0);
                    var dh = box ? Math.round(box.height) : (im.clientHeight || 0);
                    // 门槛与页面悬停共用同一份常量（MIN_SHOW / MAX_ASPECT），
                    // 不在这里写死数字 —— 早先写死 48，用户把门槛调到 600 后两边就不一致了。
                    if (dw > 0 && dh > 0) {
                        if (Math.min(dw, dh) < MIN_SHOW) { continue; }
                        var ratio = Math.max(dw, dh) / Math.min(dw, dh);
                        if (ratio > MAX_ASPECT) { continue; }
                    } else if (w && h && (w < MIN_SHOW || h < MIN_SHOW)) {
                        continue;   // 量不到显示尺寸时退回原始像素兜底
                    }
                    push(src, w, h, im.alt);
                }
                // background-image（只扫前 3000 个节点，避免卡）
                var all = document.querySelectorAll('*');
                var limit = Math.min(all.length, 3000);
                for (var j = 0; j < limit && out.length < 300; j++) {
                    var bg = getComputedStyle(all[j]).backgroundImage;
                    if (!bg || bg === 'none') { continue; }
                    var m = /url\(["']?(.*?)["']?\)/.exec(bg);
                    if (m) { push(m[1], 0, 0, ''); }
                }
                // srcset 里的大图已由 currentSrc 覆盖
                return out;
            }
        }).then(function (res) {
            return (res && res[0] && res[0].result) || [];
        }).catch(function () { return []; });
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

    function openImageModal(images) {
        ensureImageModal();
        scannedImages = images;
        var list = el('vrImgList');
        el('vrImgCount').textContent = images.length;

        if (!images.length) {
            list.innerHTML = '<div style="font-size:10.5px;color:#77808f;padding:8px 0">本页没扫到可保存的图片（大于 120×120）</div>';
        } else {
            list.innerHTML = images.map(function (im, i) {
                return '<label class="vrimg-row">' +
                    '<input type="checkbox" class="chk vrimg-chk" data-i="' + i + '" checked>' +
                    '<img src="' + esc(im.src) + '" loading="lazy" onerror="this.style.opacity=.2">' +
                    '<span class="vrimg-meta">' + (im.w ? im.w + '×' + im.h : '背景图') + '</span>' +
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
            var ext = (im.src.split('#')[0].split('?')[0].split('.').pop() || 'jpg').toLowerCase();
            if (!/^(jpg|jpeg|png|gif|webp|avif|bmp)$/.test(ext)) { ext = 'jpg'; }
            var nm;
            if (N && N.buildNameFromInfo) {
                nm = N.buildNameFromInfo({ title: base, site: '' }, im.src, {
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
                url: im.src,
                title: names[i],
                index: i,
                pageUrl: (G && G.pageUrl) || ''
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
            collectImagesInPage().then(function (images) {
                btn.disabled = false;
                btn.textContent = '抓图';
                openImageModal(images);
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
    ['vrOpenLibrary', 'vrOpenLibrarySettings'].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) { b.addEventListener('click', openMediaLibrary); }
    });
})();
