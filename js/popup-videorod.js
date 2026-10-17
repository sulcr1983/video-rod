/**
 * 钓鱼竿 video-rod — popup 交互层（M1）
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
        badge: true
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
        return (data && data.vrDir) || settings.defaultDir;
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
     * 三、抽屉：设置 / 工具
     * ========================================================== */

    function openDrawer(id) {
        closeDrawers();
        var d = el(id);
        if (d) { d.classList.add('on'); }
    }

    function closeDrawers() {
        document.querySelectorAll('.drawer.on').forEach(function (d) { d.classList.remove('on'); });
    }

    function bindDrawers() {
        var btnSettings = el('btnSettings');
        var btnTools = el('btnTools');
        if (btnSettings) { btnSettings.addEventListener('click', function () { openDrawer('vrSettings'); }); }
        if (btnTools) { btnTools.addEventListener('click', function () { openDrawer('vrTools'); }); }

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
            if (!e.target.closest('.drawer') && !e.target.closest('.iconbtn')) { closeDrawers(); }
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
            vrSetBadge: 'badge'
        };
        Object.keys(toggles).forEach(function (id) {
            var box = el(id);
            if (box) { box.checked = !!settings[toggles[id]]; }
        });
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
            vrSetBadge: 'badge'
        };
        Object.keys(toggles).forEach(function (id) {
            var box = el(id);
            if (!box) { return; }
            box.addEventListener('change', function () {
                settings[toggles[id]] = this.checked;
                saveSettings();
                if (toggles[id] === 'smartName') { applySmartNaming(true); }
                if (toggles[id] === 'badge') { applyBadgeVisibility(); }
            });
        });
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

        var pageUrl = '';
        try { pageUrl = (window.G && G.webUrl) || ''; } catch (e) { /* 忽略 */ }

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
     * 九、启动
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
            bindFoot();
            bindDirMenu();
            bindRenameModal();
            watchList();

            // 先按现有数据刷一遍，再等 tabId 落地做页面信息 + 智能起名
            updateCounts();
            waitTabId(function (id) {
                if (id < 0) { return; }
                fillPageInfo();
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
})();
