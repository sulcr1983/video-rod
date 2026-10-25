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
        if (btnSettings) { btnSettings.addEventListener('click', function () { openDrawer('vrSettings'); }); }
        if (btnAdvTools) { btnAdvTools.addEventListener('click', function () { openDrawer('vrTools'); }); }

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

        var skipped = 0;
        var planned = [];

        items.forEach(function (d) {
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
        if (!planned.length) {
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
     * 十一、站点增强（M3 的 B站分P / M4 的 YouTube 提示）
     * ========================================================== */

    var siteInfo = { bili: null, youtube: false };
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

    function buildYoutubeBanner() {
        if (el('vrYtBanner')) { return; }
        var box = document.createElement('div');
        box.id = 'vrYtBanner';
        box.className = 'vr-banner vr-banner-warn';
        box.innerHTML =
            '<div class="vr-banner-head">' +
            '<span class="vr-banner-tag warn">YouTube</span>' +
            '<span class="vr-banner-txt">2026 起 YT 强制 SABR + poToken，纯扩展多半抓不到。<br>' +
            '能抓到就直接下；抓不到属已知限制，不折腾签名对抗。</span>' +
            '</div>';
        var anchor = el('Tips');
        anchor.parentNode.insertBefore(box, anchor);
    }

    function detectSite() {
        var tabId = (window.G && G.tabId) || -1;
        if (tabId < 0) { return; }

        currentPageUrl().then(function (url) {
            if (/youtube\.com/i.test(url)) {
                siteInfo.youtube = true;
                buildYoutubeBanner();
            }

            // B站：不看域名看数据——页面里有 __INITIAL_STATE__.videoData 就是分P页
            // （顺带兼容镜像站；非 B站页面注入后直接返回 null，成本几毫秒）
            fetchBiliParts(tabId).then(function (info) {
                if (!info) { return; }
                siteInfo.bili = info;
                buildBiliBanner(info);
            });
        });
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
            bindClearDownloaded();
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
            waitTabId(function (id) {
                if (id < 0) { return; }
                fillPageInfo();
                detectSite();
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
