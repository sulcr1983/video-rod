/**
 * chrome 使用v3 background.service_worker 加载模式
 * firefox 使用v2 background.scripts 加载模式
 * firefox 在 manifest 文件中已经加载以下脚本，如果已经加载 G 变量存在，不再加载。
 */
if (typeof G === 'undefined') {
    importScripts("/js/polyfill.js", "/js/function.js", "/js/templates.js", "/js/init.js",
        "/js/bili-whole.js", "/js/douyin.js",
        "/js/site-name.js", "/js/site-name-store.js", "/js/library/site-names-preset.js",
        "/js/library/path.js", "/js/library/db.js", "/js/library/dedup.js", "/js/library/sw-library.js",
        /* indexer 必须在 sw-library 之后：它依赖 VRDB + VRPath；
         * sw-library 的 ingest 回调会调 VRIndex.scheduleSnapshot()。 */
        "/js/library/indexer.js",
        "/js/lib-image-util.js", "/js/album-sites.js", "/js/video-quality.js", "/js/xhs-media.js", "/js/xhs-ssr.js", "/js/yt/yt-queue.js");
}
// 已加载过 G 的场景（Firefox）单独补资源库脚本，保证 VRPath/VRLib 可用
if (typeof self.VRVideoQuality === 'undefined') {
    try { importScripts("/js/video-quality.js"); } catch (e) { /* 已加载或环境不支持 */ }
}
if (typeof self.VRXhsMedia === 'undefined') {
    try { importScripts("/js/xhs-media.js"); } catch (e) { /* 已加载或环境不支持 */ }
}
if (typeof self.VRXhsSsr === 'undefined') {
    try { importScripts("/js/xhs-ssr.js"); } catch (e) { /* 已加载或环境不支持 */ }
}
if (typeof self.VRYtQueue === 'undefined') {
    try { importScripts("/js/yt/yt-queue.js"); } catch (e) { /* 已加载或环境不支持 */ }
}
if (typeof self.VRSiteName === 'undefined') {
    try { importScripts("/js/site-name.js"); } catch (e) { /* 已加载或环境不支持 */ }
}
if (typeof self.VRSiteNameStore === 'undefined') {
    try { importScripts("/js/site-name-store.js"); } catch (e) { /* 已加载或环境不支持 */ }
}
/* 预置站名表：探测/解析时反爬站点（Cloudflare 403）的唯一兜底 */
if (typeof self.VRSiteNamesPreset === 'undefined') {
    try { importScripts("/js/library/site-names-preset.js"); } catch (e) { /* 已加载或环境不支持 */ }
}
if (typeof self.VRPath === 'undefined') {
    try { importScripts("/js/library/path.js"); } catch (e) { /* 已加载或环境不支持 */ }
}
if (typeof self.VRDB === 'undefined') {
    try { importScripts("/js/library/db.js"); } catch (e) { /* 已加载或环境不支持 */ }
}
if (typeof self.VRLib === 'undefined') {
    try { importScripts("/js/library/sw-library.js"); } catch (e) { /* 已加载或环境不支持 */ }
}
if (typeof self.VRImageUtil === 'undefined') {
    try { importScripts("/js/lib-image-util.js"); } catch (e) { /* 已加载或环境不支持 */ }
}
/* 图集站点适配表（纯 URL 规则）：分页模式靠它算下一页与原图 */
if (typeof self.VRAlbumSites === 'undefined') {
    try { importScripts("/js/album-sites.js"); } catch (e) { /* 已加载或环境不支持 */ }
}
/* VRSave 依赖 VRPath（算相对路径）与 VRLib（FSA 写完后主动入库），
 * 所以必须放在这两个之后加载。 */
if (typeof self.VRSave === 'undefined') {
    try { importScripts("/js/library/save.js"); } catch (e) { /* 已加载或环境不支持 */ }
}

/* VRIndex：SW 侧也要能调 scheduleSnapshot()，否则「入库后自动写快照」
 * （B-32 阶段 1.5）在 SW 链路里恒为 no-op —— save.js 里那句
 * `typeof root.VRIndex.scheduleSnapshot === 'function'` 会静默失败。
 * indexer.js 不依赖 DOM（已核：无 document./window. 引用），SW 可加载。 */
if (typeof self.VRIndex === 'undefined') {
    try { importScripts("/js/library/indexer.js"); } catch (e) { /* 已加载或环境不支持 */ }
}

// Service Worker 5分钟后会强制终止扩展
// https://bugs.chromium.org/p/chromium/issues/detail?id=1271154
// https://stackoverflow.com/questions/66618136/persistent-service-worker-in-chrome-extension/70003493#70003493
chrome.webNavigation.onBeforeNavigate.addListener(function () { return; });
chrome.webNavigation.onHistoryStateUpdated.addListener(function () { return; });

/* 侧边栏「点图标即打开」——必须在 SW 顶层每次启动都设一遍。
 *
 * 踩过的坑（实测 Edge 156）：manifest 已去掉 action.default_popup，
 * 但 cold start 后 chrome.sidePanel.getPanelBehavior() 读到的是
 * {openPanelOnActionClick:false}，于是点图标**什么都不发生**。
 * 原因是 init.js 里那次 setPanelBehavior 只跟着 InitOptions 走一次，
 * 而 SW 被回收再唤醒时不会再执行那段逻辑。
 *
 * 所以这里独立于存储状态，无条件设 true：这是产品刚需（苏哥要「点一下就出图片列表」），
 * 不该因为它依赖一个可能没跑到的初始化路径而失效。
 * 用户若在设置里显式关掉（sidePanel:false），init.js 的 onChanged 仍会改回 false。 */
try {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
        var __pb = { openPanelOnActionClick: true };
        /* 返回值类型随版本而异：Chrome 先支持 callback，后加 Promise。
         * 直接给返回值加 .catch 在老版本上会抛 TypeError，所以先判类型。 */
        var __ret = chrome.sidePanel.setPanelBehavior(__pb);
        if (__ret && typeof __ret.catch === 'function') {
            __ret.catch(function () {
                try {
                    chrome.sidePanel.setPanelBehavior(__pb, function () {
                        void chrome.runtime.lastError;
                    });
                } catch (e) { /* 忽略 */ }
            });
        }
    }
} catch (e) {
    try {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }, function () {
            void chrome.runtime.lastError;
        });
    } catch (e2) { /* 忽略 */ }
}
chrome.runtime.onConnect.addListener(function (Port) {
    if (chrome.runtime.lastError || Port.name !== "HeartBeat") return;
    Port.postMessage("HeartBeat");
    Port.onMessage.addListener(function (message, Port) { return; });
    const interval = setInterval(function () {
        clearInterval(interval);
        Port.disconnect();
    }, 250000);
    Port.onDisconnect.addListener(function () {
        interval && clearInterval(interval);
        if (chrome.runtime.lastError) { return; }
    });
});
setInterval(chrome.runtime.getPlatformInfo, 25 * 1000);

// 全局变量
let debounce = undefined;
let debounceCount = 0;
let debounceTime = 0;
const reFilename = /filename="?([^"]+)"?/;

G.deepSearchTemporarilyClose = null; // 深度搜索临时变量
G.urlMap = new Map();   // url查重map
G.requestHeaders = new Map();   // 临时储存请求头
G.blackList = new Set();    // 正则屏蔽资源列表

/**
 *  定时任务
 *  nowClear clear 清理冗余数据
 *  save 保存数据
 */
chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === "nowClear" || alarm.name === "clear") {
        clearRedundant();
        return;
    }
    if (alarm.name === "save") {
        (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData });
        return;
    }
});

// onBeforeRequest 浏览器发送请求之前使用正则匹配发送请求的URL
// chrome.webRequest.onBeforeRequest.addListener(
//     function (data) {
//         try { findMedia(data, true); } catch (e) { console.log(e); }
//     }, { urls: ["<all_urls>"] }, ["requestBody"]
// );
// 保存requestHeaders
chrome.webRequest.onSendHeaders.addListener(
    function (data) {
        if (G && G.initSyncComplete && !G.enable) { return; }
        if (data.requestHeaders) {
            G.requestHeaders.set(data.requestId, data.requestHeaders);
            data.allRequestHeaders = data.requestHeaders;
        }
        try { findMedia(data, true); } catch (e) { console.log(e); }
    }, { urls: ["<all_urls>"] }, ['requestHeaders',
        chrome.webRequest.OnBeforeSendHeadersOptions.EXTRA_HEADERS].filter(Boolean)
);
// onResponseStarted 浏览器接收到第一个字节触发，保证有更多信息判断资源类型
chrome.webRequest.onResponseStarted.addListener(
    function (data) {
        try {
            data.allRequestHeaders = G.requestHeaders.get(data.requestId);
            if (data.allRequestHeaders) {
                G.requestHeaders.delete(data.requestId);
            }
            findMedia(data);
        } catch (e) { console.log(e, data); }
    }, { urls: ["<all_urls>"] }, ["responseHeaders"]
);
// 删除失败的requestHeadersData
chrome.webRequest.onErrorOccurred.addListener(
    function (data) {
        G.requestHeaders.delete(data.requestId);
        G.blackList.delete(data.requestId);
    }, { urls: ["<all_urls>"] }
);

function findMedia(data, isRegex = false, filter = false, timer = false) {
    // Service Worker被强行杀死之后重新自我唤醒，等待全局变量初始化完成。
    if (!G || !G.initSyncComplete || !G.initLocalComplete || G.tabId == undefined || cacheData.init) {
        if (timer) { return; }
        setTimeout(() => {
            findMedia(data, isRegex, filter, true);
        }, 500);
        return;
    }

    if (G.damn && G.damnUrlSet.has(data.tabId)) {
        return;
    }

    /**
     * 以下情况不处理
     * 是否全局启用
     * 当前标签是否在屏蔽列表中
     * OPTIONS 请求不处理
     */
    const blockUrlFlag = data.tabId && data.tabId > 0 && G.blockUrlSet.has(data.tabId);
    if (!G.enable || (G.blockUrlWhite ? !blockUrlFlag : blockUrlFlag) || data?.method == "OPTIONS") {
        return;
    }

    data.getTime = Date.now();

    if (!isRegex && G.blackList.has(data.requestId)) {
        G.blackList.delete(data.requestId);
        return;
    }
    // 屏蔽特殊页面发起的资源
    if (data.initiator != "null" &&
        data.initiator != undefined &&
        isSpecialPage(data.initiator)) { return; }
    if (G.isFirefox &&
        data.originUrl &&
        isSpecialPage(data.originUrl)) { return; }
    // 屏蔽特殊页面的资源
    if (isSpecialPage(data.url)) { return; }
    const urlParsing = new URL(data.url);
    let [name, ext] = fileNameParse(urlParsing.pathname);

    //正则匹配
    if (isRegex && !filter) {
        for (let key in G.Regex) {
            if (!G.Regex[key].state) { continue; }
            G.Regex[key].regex.lastIndex = 0;
            let result = G.Regex[key].regex.exec(data.url);
            if (result == null) { continue; }
            if (G.Regex[key].blackList) {
                G.blackList.add(data.requestId);
                return;
            }
            data.extraExt = G.Regex[key].ext ? G.Regex[key].ext : undefined;
            if (result.length == 1) {
                findMedia(data, true, true);
                return;
            }
            result.shift();
            result = result.map(str => decodeURIComponent(str));
            if (!result[0].startsWith('https://') && !result[0].startsWith('http://')) {
                result[0] = urlParsing.protocol + "//" + data.url;
            }
            data.url = result.join("");
            findMedia(data, true, true);
            return;
        }
        return;
    }

    // 非正则匹配
    if (!isRegex) {
        // 获取头部信息
        data.header = getResponseHeadersValue(data);
        //检查后缀
        if (!filter && ext != undefined) {
            filter = CheckExtension(ext, data.header?.size);
            if (filter == "break") { return; }
        }
        //检查类型
        if (!filter && data.header?.type != undefined) {
            filter = CheckType(data.header.type, data.header?.size);
            if (filter == "break") { return; }
        }
        //查找附件
        if (!filter && data.header?.attachment != undefined) {
            const res = data.header.attachment.match(reFilename);
            if (res && res[1]) {
                [name, ext] = fileNameParse(decodeURIComponent(res[1]));
                filter = CheckExtension(ext, 0);
                if (filter == "break") { return; }
            }
        }
        //放过类型为media的资源
        if (data.type == "media") {
            filter = true;
        }
    }

    if (!filter) { return; }

    // 谜之原因 获取得资源 tabId可能为 -1 firefox中则正常
    // 检查是 -1 使用当前激活标签得tabID
    data.tabId = data.tabId == -1 ? G.tabId : data.tabId;

    cacheData[data.tabId] ??= [];
    cacheData[G.tabId] ??= [];

    // 缓存数据大于9999条 清空缓存 避免内存占用过多
    if (cacheData[data.tabId].length > G.maxLength) {
        cacheData[data.tabId] = [];
        (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData });
        return;
    }

    // 查重 避免CPU占用 大于500 强制关闭查重
    // if (G.checkDuplicates && cacheData[data.tabId].length <= 500) {
    //     for (let item of cacheData[data.tabId]) {
    //         if (item.url.length == data.url.length &&
    //             item.cacheURL.pathname == urlParsing.pathname &&
    //             item.cacheURL.host == urlParsing.host &&
    //             item.cacheURL.search == urlParsing.search) { return; }
    //     }
    // }

    if (G.checkDuplicates && cacheData[data.tabId].length <= 500) {
        const tabFingerprints = G.urlMap.get(data.tabId) || new Set();
        if (tabFingerprints.has(data.url)) {
            return; // 找到重复，直接返回
        }
        tabFingerprints.add(data.url);
        G.urlMap.set(data.tabId, tabFingerprints);
        if (tabFingerprints.size >= 500) {
            tabFingerprints.clear();
        }
    }

    chrome.tabs.get(data.tabId, async function (webInfo) {
        if (chrome.runtime.lastError) { return; }
        data.requestHeaders = getRequestHeaders(data);
        // requestHeaders 中cookie 单独列出来
        if (data.requestHeaders?.cookie) {
            data.cookie = data.requestHeaders.cookie;
            data.requestHeaders.cookie = undefined;
        }
        const info = {
            name: name,
            url: data.url,
            size: data.header?.size,
            ext: ext,
            type: data.mime ?? data.header?.type,
            tabId: data.tabId,
            isRegex: isRegex,
            requestId: data.requestId ?? Date.now().toString(),
            initiator: data.initiator,
            requestHeaders: data.requestHeaders,
            cookie: data.cookie,
            // cacheURL: { host: urlParsing.host, search: urlParsing.search, pathname: urlParsing.pathname },
            getTime: data.getTime
        };
        // 不存在扩展使用类型
        if (info.ext === undefined && info.type !== undefined) {
            info.ext = info.type.split("/")[1];
        }
        // 正则匹配的备注扩展
        if (data.extraExt) {
            info.ext = data.extraExt;
        }
        // 不存在 initiator 和 referer 使用web url代替initiator
        if (info.initiator == undefined || info.initiator == "null") {
            info.initiator = info.requestHeaders?.referer ?? webInfo?.url;
        }
        // 装载页面信息
        info.title = webInfo?.title ?? "NULL";
        info.favIconUrl = webInfo?.favIconUrl;
        info.webUrl = webInfo?.url;
        // 屏蔽资源
        if (!isRegex && G.blackList.has(data.requestId)) {
            G.blackList.delete(data.requestId);
            return;
        }
        // 发送到popup 并检查自动下载
        chrome.runtime.sendMessage({ Message: "popupAddData", data: info }, function () {
            if (G.featAutoDownTabId.size > 0 && G.featAutoDownTabId.has(info.tabId) && chrome.downloads?.State) {
                try {
                    const downDir = info.title == "NULL" ? "CatCatch/" : stringModify(info.title) + "/";
                    let fileName = isEmpty(info.name) ? stringModify(info.title) + '.' + info.ext : decodeURIComponent(stringModify(info.name));
                    if (G.TitleName) {
                        fileName = filterFileName(templates(G.downFileName, info));
                    } else {
                        fileName = downDir + fileName;
                    }
                    vrDownloadWithName(info.url, fileName).then(function (id) {
                        if (id !== null) { vrMarkDownloaded(fileName); }
                    });
                } catch (e) { return; }
            }
            if (chrome.runtime.lastError) { return; }
        });

        // 数据发送
        if (G.send2local) {
            try { send2local("catch", { ...info, requestHeaders: data.allRequestHeaders }, info.tabId); } catch (e) { console.log(e); }
        }

        // 储存数据
        cacheData[info.tabId] ??= [];
        cacheData[info.tabId].push(info);

        // 当前标签媒体数量大于100 开启防抖 等待5秒储存 或 积累10个资源储存一次。
        if (cacheData[info.tabId].length >= 100 && debounceCount <= 10) {
            debounceCount++;
            clearTimeout(debounce);
            debounce = setTimeout(function () { save(info.tabId); }, 5000);
            return;
        }
        // 时间间隔小于500毫秒 等待2秒储存
        if (Date.now() - debounceTime <= 500) {
            clearTimeout(debounce);
            debounceTime = Date.now();
            debounce = setTimeout(function () { save(info.tabId); }, 2000);
            return;
        }
        save(info.tabId);
    });
}
// cacheData数据 储存到 chrome.storage.local
function save(tabId) {
    clearTimeout(debounce);
    debounceTime = Date.now();
    debounceCount = 0;
    if (cacheData[tabId]) {
        // 单个标签数据超过99条 不再保存到storage
        if (cacheData[tabId]?.length <= 99) {
            (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData }, function () {
                chrome.runtime.lastError && console.log(chrome.runtime.lastError);
            });
        }
        SetIcon({ number: cacheData[tabId].length, tabId: tabId });
    }
}

// ===== 苏哥的钓鱼竿：下载文件名保护（M8 修复「星愿忽略 filename」）=====
// 根因：Chromium bug 579563——浏览器内任何扩展注册 chrome.downloads.onDeterminingFilename
// 监听后，其他扩展 downloads.download({filename}) 的 filename 即被忽略（落盘变服务器名）。
// 官方 workaround：自己也注册该监听、对自己的下载 suggest 文件名。
// 写法抄自苏哥星愿里装的三个下载扩展（XBD/CocoCut/Imageye 同款套路）：
//   1. 下载前按 URL 预记账（url -> {filename, conflictAction}），确定文件名时一次性取用；
//   2. onDeterminingFilename 三道防线：别人的下载不碰 → 按 url/finalUrl 取账 suggest
//      → 是自己的下载才用 item.filename 兜底 re-suggest；
//   3. suggest 同步调用，conflictAction 统一 "uniquify"（不覆盖已有文件）。
// popup/options/m3u8/downloader 页面自身发起的下载，经 js/vr-download-hook.js
// 发 vrQueueName 消息在这里记账（页面上下文与 SW 不共享内存）。

const vrPendingNameByUrl = new Map();   // url -> {filename, conflictAction, at}
// B站页面内合成（dash/durl 用 <a download>）不带目录；下载前记住完整归档路径，
// 由 onDeterminingFilename 补回去。2 分钟窗口，避免误伤之后无关的下载。
let vrPendingBiliName = null;
const VR_NAME_TTL = 10 * 60 * 1000;     // 记账保留 10 分钟：兼容同 URL 重复/并发下载
const VR_NAME_MAP_MAX = 300;            // 防御性上限，防异常残留撑爆内存

function vrQueueFilename(url, filename, conflictAction, meta) {
    if (!url || !filename) { return; }
    // 资源库：预登记元数据（下载完成时页面上下文已丢失，必须提前存）
    if (self.VRLib) {
        try {
            self.VRLib.record(url, Object.assign({ relPath: filename }, meta || {}));
        } catch (e) { /* 入库失败不影响下载 */ }
    }
    vrPendingNameByUrl.set(url, {
        filename: filename,
        conflictAction: conflictAction || "uniquify",
        at: Date.now()
    });
    if (vrPendingNameByUrl.size > VR_NAME_MAP_MAX) {
        // 超量先清过期项，仍超量再退最早的
        const now = Date.now();
        for (const [k, v] of vrPendingNameByUrl) {
            if (now - v.at > VR_NAME_TTL) { vrPendingNameByUrl.delete(k); }
        }
        while (vrPendingNameByUrl.size > VR_NAME_MAP_MAX) {
            vrPendingNameByUrl.delete(vrPendingNameByUrl.keys().next().value);
        }
    }
}

function vrAbortFilename(url, filename) {
    const hit = vrPendingNameByUrl.get(url);
    if (hit && hit.filename === filename) {
        vrPendingNameByUrl.delete(url);
    }
}

// hashKey 必须与 popup-videorod.js 里的实现保持一致（djb2 变体），
// 两边写同一份 chrome.storage.local.vrDownloaded 账本。
function vrHashKey(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
        h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return 'k' + (h >>> 0).toString(36);
}

/**
 * SW 侧下载成功后记账（与 popup 的去重账本同一份数据）。
 * 下载历史面板（M9）读的就是它；popup 批量去重也认它。
 * 代价：SW 与 popup 各持一份内存副本，极少数并发下载可能互相覆盖丢一条记录
 * ——只影响「某文件可重下」，不阻塞下载，个人自用可接受。
 */
function vrMarkDownloaded(path) {
    if (!path) { return; }
    try {
        chrome.storage.local.get(['vrDownloaded'], function (res) {
            if (chrome.runtime.lastError) { return; }
            const rec = (res && res.vrDownloaded) || {};
            rec[vrHashKey(path)] = { p: path, t: Date.now() };
            // 与 popup 侧相同的 2000 条上限，超量退最早的
            const keys = Object.keys(rec);
            if (keys.length > 2000) {
                keys.sort(function (a, b) { return (rec[a].t || 0) - (rec[b].t || 0); });
                keys.slice(0, keys.length - 2000).forEach(function (k) { delete rec[k]; });
            }
            chrome.storage.local.set({ vrDownloaded: rec });
        });
    } catch (e) { /* 忽略：记账失败不影响下载 */ }
}

/* ===== 钓鱼竿：M11 多段自动合并编排（SW 侧，直连管线版）=====
 * 第一性原理重构（2026-10-18）：不再驱动猫抓 m3u8 页面（给人手动操作的 UI，
 * 无头驱动必然衍生一堆坑），改为：
 *   popup 认组发 vrMergeStart → SW 确保离屏文档在位 → 转发 vrMergeRun →
 *   离屏文档内直连完成「解析清单 + 拉分片 + 解密 + 合并」→ vrMergeReady →
 *   popup 显示「已拼好」→ 用户点保存 → vrMergeSave → 离屏文档落盘。
 * 参考社区成熟方案：Fluxon（offscreen 直连管线）、Media Bridge（SW 只做调度）。
 * 手动兜底页 m3u8-multi.html 走同一条管线，不再有第二套实现。
 */
const vrMergeTasks = {};    // taskId -> {urls, state, bytes, ext}
/* ===== YouTube 下载串行队列（2026-11-08）=====
 * 同一时间只允许一个 YouTube 任务在跑：多个 4K 并发会互相抢带宽，
 * 同时对 googlevideo 开多条大流量连接更容易触发限流。
 * 队列语义（去重 / 一次一个 / 结束放行 / 启动失败不卡死）在
 * js/yt/yt-queue.js 里，配 tools/test-yt-queue.js 26 条单测。 */

/** 开一个下载页；由队列模块回调 */
function vrYtLaunch(job) {
    var ytUrl = chrome.runtime.getURL('js/yt/yt-download.html') +
        '?videoId=' + encodeURIComponent(job.videoId) +
        '&tabId=' + encodeURIComponent(String(job.tabId || 0)) +
        '&title=' + encodeURIComponent(job.title || '') +
        '&author=' + encodeURIComponent(job.author || '') +
        '&authorId=' + encodeURIComponent(job.authorId || '') +
        '&pageUrl=' + encodeURIComponent(job.pageUrl || '') +
        '&auto=1';
    chrome.tabs.create({ url: ytUrl, active: false }, function (t) {
        if (chrome.runtime.lastError || !t) {
            /* 开页失败：丢弃这个任务，继续下一个，别把队列堵死 */
            vrYtQ.release();
            return;
        }
        vrYtQueueTabId = t.id;
    });
}

var vrYtQueueTabId = null;       // 正在执行的下载页标签 id
var vrYtQ = self.VRYtQueue
    ? self.VRYtQueue.create({ startFn: vrYtLaunch, delayMs: 600 })
    : { push: function () { return { ok: false, reason: 'queue-unavailable' }; },
        release: function () { return false; },
        status: function () { return { active: '', queued: 0, list: [] }; } };

/** 任务结束（成功/失败/页面被关）后释放队列位 */
function vrYtRelease(tabId) {
    /* 只认「正在跑的那一页」的结束信号；别的页关掉不该影响队列 */
    if (vrYtQueueTabId != null && tabId != null && vrYtQueueTabId !== tabId) {
        return;
    }
    vrYtQueueTabId = null;
    vrYtQ.release();
}

function vrMergeNotify(msg) {
    try {
        chrome.runtime.sendMessage(msg, function () { void chrome.runtime.lastError; });
    } catch (e) { /* popup 可能没开 */ }
}

function vrMergeEnsureOffscreen() {
    return new Promise(function (resolve) {
        var p = null;
        try {
            // ⚠️ chrome.offscreen.createDocument 只有 Promise 形态，**不接受 callback**。
            //    以前按 callback 写，resolve 永不触发 → 调用方永久挂起（2026-11-05 实测踩到）。
            p = chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['BLOBS'],
                justification: 'M11 多段合并 / 防盗链直连：解析、下载、解密、转码需要稳定的 blob 上下文'
            });
        } catch (e) {
            resolve();      // 老版本同步抛错：当作已就绪
            return;
        }
        if (p && typeof p.then === 'function') {
            // 已存在（Only a single offscreen document may be created）也视为就绪
            p.then(function () { resolve(); }, function () { resolve(); });
        } else {
            resolve();
        }
    });
}

/** 离屏文档刚 createDocument 时脚本可能还没加载完，发消息要带重试 */
function vrMergeSendToOffscreen(msg, tries) {
    const n = tries || 0;
    return new Promise(function (resolve) {
        try {
            chrome.runtime.sendMessage(msg, function () {
                if (chrome.runtime.lastError) {
                    if (n < 12) {
                        setTimeout(function () {
                            vrMergeSendToOffscreen(msg, n + 1).then(resolve);
                        }, 350);
                    } else {
                        resolve(false);
                    }
                } else {
                    resolve(true);
                }
            });
        } catch (e) {
            if (n < 12) {
                setTimeout(function () { vrMergeSendToOffscreen(msg, n + 1).then(resolve); }, 350);
            } else {
                resolve(false);
            }
        }
    });
}

function vrMergeStart(taskId, urls) {
    if (!taskId || !urls || urls.length < 2) {
        vrMergeNotify({ Message: 'vrMergeError', taskId: taskId, error: '参数不完整' });
        return;
    }
    vrMergeTasks[taskId] = { id: taskId, urls: urls, state: 'running' };
    vrMergeEnsureOffscreen().then(function () {
        return vrMergeSendToOffscreen({ Message: 'vrMergeRun', taskId: taskId, urls: urls });
    }).then(function (ok) {
        if (!ok) {
            delete vrMergeTasks[taskId];
            vrMergeNotify({ Message: 'vrMergeError', taskId: taskId, error: '离屏文档没响应' });
        }
    });
}

/** 离屏文档直连下载（防盗链站点的最后一条路）。
 *  扩展上下文 fetch：有 host_permissions 不受 CORS 限制，DNR 补的 Referer 对 fetch 生效；
 *  拿到 blob 再交下载器落盘。抖音实测只有这条路能过 403（2026-11-05）。 */
function vrOffscreenDownload(url, filename) {
    return vrMergeEnsureOffscreen().then(function () {
        // createDocument 返回时脚本可能还没注册 listener，第一次发会 no-response。
        // 批量并发实测 3 张会挂 1 张就是这个。重试 3 次，间隔递增。
        function attempt(n) {
            return new Promise(function (resolve) {
                var done = false;
                var finish = function (r) { if (!done) { done = true; resolve(r); } };
                var timer = setTimeout(function () { finish({ ok: false, reason: 'offscreen-timeout' }); }, 25000);
                try {
                    chrome.runtime.sendMessage(
                        { Message: 'vrOffscreenDownload', url: url, filename: filename },
                        function (res) {
                            clearTimeout(timer);
                            void chrome.runtime.lastError;
                            finish(res || { ok: false, reason: 'no-response' });
                        });
                } catch (e) {
                    clearTimeout(timer);
                    finish({ ok: false, reason: String(e).slice(0, 120) });
                }
            }).then(function (r) {
                if ((r && r.ok) || n >= 2) { return r; }
                return new Promise(function (go) { setTimeout(go, 700 * (n + 1)); })
                    .then(function () { return attempt(n + 1); });
            });
        }
        return attempt(0);
    }).catch(function (e) {
        return { ok: false, reason: String(e).slice(0, 120) };
    });
}

/**
 * 带文件名保护的下载（SW 侧统一入口）。
 * 先记账再下载；失败撤账。返回 Promise<downloadId|null>。
 */
function vrDownloadWithName(url, filename, extra) {
    vrQueueFilename(url, filename, extra && extra.conflictAction, extra && extra.meta);
    const opts = Object.assign(
        { url: url, filename: filename, saveAs: false, conflictAction: "uniquify" },
        extra || {}
    );
    delete opts.meta;   // meta 只用于资源库预登记，不是 chrome.downloads 的合法参数
    delete opts.onProgress;   // 同上：进度回调只给 FSA 直写用，别塞进 downloads API

    // Chrome 147 起 chrome.downloads 的文件名保护全面失效（ADR-040）：
    // blob 落盘成 UUID、http 丢名退化成 URL 末段、suggest() 被忽略。
    // 所以优先走 FSA 直写；FSA 不可用（用户没授权目录 / 非 SW 环境）才回退下载器。
    // 回退时返回的 id 仍走原来的记账链路，行为与改造前一致，不会把功能搞挂。
    const save = self.VRSave;
    if (save && typeof save.saveFile === 'function') {
        return save.saveFile({
            relPath: filename,
            blobOrUrl: url,
            mime: (extra && extra.mime) || '',
            referrer: (extra && extra.referrer) || '',
            meta: (extra && extra.meta) || null,
            prefer: 'auto',
            /* FSA 直写本来是「没有进度」的黑盒（苏哥 2026-11-09 报进度条永远 0%）。
             * save.js 的 pumpBlob/pumpUrl 早就带 onProgress(got,total) 钩子，
             * 只是没人接 —— 这里原样透传，让调用方能把它变成界面上动的百分比。 */
            onProgress: (extra && typeof extra.onProgress === 'function') ? extra.onProgress : null
        }).then(function (r) {
            if (r && r.ok && r.mode === 'fsa') {
                // FSA 直写没有下载事件，入库已在 save.js 内部做完了。
                // 这里返回一个「假 downloadId」会污染记账表（那张表靠真 id 撤账），
                // 所以统一返回 null 并打标记，让调用方知道「下成功了但不是下载器下的」。
                vrAbortFilename(url, filename);
                /* relPath 用 save.js 回传的真实落盘路径（同名会被 freeName 改成 _01），
                 * 不能用入参预测的那个 —— 否则后续判重/删文件会打到别的条目上。 */
                return { __fsa: true, path: r.path, relPath: r.relPath || filename };
            }
            if (r && r.ok && r.mode === 'downloads') {
                // 契约要求「名字可能被浏览器改名（ADR-040）要如实告知用户」：
                // 打一个会话级标记，popup 的完成提示读到它就追加说明，不假装没问题。
                try {
                    chrome.storage.session.set({ vrNameFallback: true });
                } catch (e0) { /* 标记失败不影响下载本身 */ }
                return r.downloadId || null;
            }
            vrAbortFilename(url, filename);
            return null;
        }).catch(function () {
            vrAbortFilename(url, filename);
            return null;
        });
    }

    return new Promise(function (resolve) {
        chrome.downloads.download(opts, function (id) {
            if (chrome.runtime.lastError || id === undefined) {
                vrAbortFilename(url, filename);
                resolve(null);
            } else {
                resolve(id);
            }
        });
    });
}

/* ==========================================================
 * 图片悬停下载（I1/I2）：原图校验 + 单张落位
 * 协议见 docs/IMAGE-I1I2-IMPL.md §4
 * ========================================================== */

var VR_IMG_EXT_OK = /^(jpg|jpeg|jpe|jfif|png|apng|webp|gif|avif|bmp|heic|heif|tif|tiff|ico)$/;

/** 候选去重（保序） */
function vrImgList(msg) {
    const out = [];
    const seen = Object.create(null);
    const push = function (raw) {
        const u = String(raw == null ? '' : raw).trim();
        if (!u || seen[u]) { return; }
        if (!/^(https?:|data:)/i.test(u)) { return; }
        seen[u] = 1;
        out.push(u);
    };
    const arr = Array.isArray(msg && msg.candidates) ? msg.candidates : [];
    for (let i = 0; i < arr.length; i++) { push(arr[i]); }
    if (msg) { push(msg.currentSrc); push(msg.url); }
    return out;
}

/**
 * 逐个候选 fetch：content-type 以 image/ 开头才算命中。
 * 全失败不抛错，回退最后一个候选（fallback:true）——「绝不空点」。
 */
async function vrImgResolve(msg) {
    const pageUrl = String((msg && msg.pageUrl) || '');
    const list = vrImgList(msg);
    if (!list.length) {
        return { ok: false, url: '', tried: 0, fallback: true, code: 'IMG_E_NO_URL' };
    }
    let tried = 0;
    for (let i = 0; i < list.length; i++) {
        const url = list[i];
        tried++;
        if (/^data:/i.test(url)) {
            // data URI 不需要网络校验；类型看前缀
            if (/^data:image\//i.test(url) && !/^data:image\/svg/i.test(url)) {
                return { ok: true, url: url, tried: tried, fallback: false, contentType: '' };
            }
            continue;
        }
        try {
            const init = {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: { 'Referer': pageUrl }
            };
            if (/^https?:/i.test(pageUrl)) { init.referrer = pageUrl; }
            const r = await fetch(url, init);
            const ct = String(r.headers.get('content-type') || '').toLowerCase();
            try {
                if (r.body && r.body.cancel) { r.body.cancel().catch(function () { /* ignore */ }); }
            } catch (e) { /* ignore */ }
            if (r.ok && ct.indexOf('image/') === 0) {
                return { ok: true, url: url, tried: tried, fallback: false, contentType: ct };
            }
        } catch (e) { /* 换下一个候选 */ }
    }
    return {
        ok: false,
        url: list[list.length - 1],
        tried: tried,
        fallback: true,
        code: 'IMG_E_FETCH'
    };
}

/** 资源库子目录（vrLibSettings.subdir，缺省 video-rod） */
function vrImgSubdir() {
    return new Promise(function (resolve) {
        try {
            chrome.storage.local.get('vrLibSettings', function (obj) {
                const s = obj && obj.vrLibSettings;
                resolve((s && s.subdir) || 'video-rod');
            });
        } catch (e) { resolve('video-rod'); }
    });
}

/** 本地日期 YYYYMMDD（图片线按本机直觉，不用 UTC） */
function vrImgDate(d) {
    const t = d || new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return String(t.getFullYear()) + p(t.getMonth() + 1) + p(t.getDate());
}

/* DNR 会话规则：给单个图片 URL 的下载请求补 Referer。
 * 为什么不用 downloads.download 的 headers：Referer 属浏览器受控头，
 * 传进去直接报 "Unsafe request header name"，下载根本发不出去。
 * 规则按 urlFilter 精确匹配 + 一次性使用，用完即撤。 */
var VR_IMG_RULE_BASE = 9000;
var VR_IMG_RULE_SEQ = 0;

function vrImgRuleId() {
    // 9000 起，避开 function.js 用 tabId 当 id 的既有规则。
    // 必须单调递增：批量并发 3 时若用 Date.now() % 900，同一毫秒内多个任务
    // 会撞同一个 id，先完成的 finally 会把别人的规则删掉，导致下载失败（踩过）。
    VR_IMG_RULE_SEQ = (VR_IMG_RULE_SEQ + 1) % 900;
    return VR_IMG_RULE_BASE + VR_IMG_RULE_SEQ;
}

function vrImgRefererRule(url, pageUrl) {
    return new Promise(function (resolve) {
        if (!chrome.declarativeNetRequest) { resolve(0); return; }
        const id = vrImgRuleId();
        // urlFilter 用「去掉协议的完整 URL」做子串匹配：比 ||域名 更精确，
        // 又不必处理 DNR 的锚点语法；同一张图的多次点击各自成规则，互不影响。
        const filter = String(url).replace(/^https?:\/\//i, '');
        try {
            chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [id],
                addRules: [{
                    id: id,
                    priority: 1,
                    action: {
                        type: 'modifyHeaders',
                        // origin 必须 remove：扩展 fetch 自带 chrome-extension:// 的 Origin，
                        // 微博 sinaimg 见到就 403（2026-11-05 实测，只补 Referer 不够）
                        requestHeaders: [
                            { header: 'Referer', operation: 'set', value: pageUrl },
                            { header: 'Origin', operation: 'remove' }
                        ]
                    },
                    condition: {
                        urlFilter: filter,
                        resourceTypes: ['image', 'xmlhttprequest', 'media', 'other']
                    }
                }]
            }, function () {
                resolve(chrome.runtime.lastError ? 0 : id);
            });
        } catch (e) {
            resolve(0);
        }
    });
}

function vrImgClearRefererRule(id) {
    try {
        chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] });
    } catch (e) { /* ignore */ }
}

/**
 * 等这笔下载进入终态（complete / interrupted）再撤 DNR 规则。
 * download() 返回时请求往往还没发出，立刻撤会导致请求丢 Referer；
 * 批量并发时这个问题最明显（表现为只下到一两张）。
 * 30 秒兜底，避免规则永久残留。
 */
function vrImgClearRuleAfterDownload(ruleId, downloadId) {
    let cleared = false;
    const clear = function () {
        if (cleared) { return; }
        cleared = true;
        vrImgClearRefererRule(ruleId);
        try { chrome.downloads.onChanged.removeListener(onChanged); } catch (e) { /* ignore */ }
        clearTimeout(timer);
    };
    const onChanged = function (delta) {
        if (!delta || delta.id !== downloadId) { return; }
        if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
            clear();
        }
    };
    const timer = setTimeout(clear, 30000);
    try {
        chrome.downloads.onChanged.addListener(onChanged);
    } catch (e) {
        clear();
    }
}

function vrImgExt(url, contentType) {
    const U = self.VRImageUtil;
    let ext = U ? U.extFromContentType(contentType) : '';
    if (!ext && U) { ext = U.extFromUrl(url); }
    if (!ext) {
        const m = String(url || '').split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i);
        ext = m ? m[1].toLowerCase() : '';
    }
    /* 实况图附带的 mp4（小红书 live，2026-11-11）：走图片下载队列，但扩展名必须是
     * mp4。VR_IMG_EXT_OK 只有图片扩展，不特判会把 mp4 强改成 jpg —— 文件头是 ftypisom
     * （真的是 mp4）、后缀却是 .jpg，播放器/库全认错。 */
    if (ext === 'mp4' && /\.mp4(?:[?#]|$)/i.test(String(url || ''))) { return 'mp4'; }
    if (!VR_IMG_EXT_OK.test(ext)) { ext = 'jpg'; }
    return ext;
}

/**
 * 从目标标签页取一次站名。
 * 扩展页面（侧边栏 / 面板）读不到网页 DOM，只能注入一次去取。
 */
async function vrSiteNameFromTab(tabId) {
    const empty = { name: '', src: '', host: '', manifest: '' };
    if (!chrome.scripting || !(tabId > 0)) { return empty; }
    /* 会被序列化丢进页面，不能引用外部变量 */
    const probe = function () {
        try {
            var S = self.VRSiteName;
            if (!S || !S.screen) { return null; }
            var r = S.screen(document, location.href);
            return { name: r.name || '', src: r.src || '', host: r.host || '', manifest: r.manifest || '' };
        } catch (e) { return null; }
    };
    try {
        /* 多数标签页已由 manifest 注入过 site-name.js，先直接试一次；
         * 只有返回 null（旧标签页在扩展更新前打开）才补注入再试。 */
        let res = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: probe });
        let r = res && res[0] && res[0].result;
        if (!r) {
            await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['js/site-name.js'] });
            res = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: probe });
            r = res && res[0] && res[0].result;
        }
        return r || empty;
    } catch (e) { return empty; }
}

/**
 * 站名解析（三级回退，成本从低到高）：
 *   ① 发送方已抓到 —— 网页内触发点，零额外开销
 *   ② 注入目标页取一次 —— 扩展页面没有 DOM 时
 *   ③ 本地缓存 —— 之前学过，重扫/迁移时唯一可用的一级
 * 解析到就顺手落库，供以后无 DOM 的场景复用；已有记录（含手改）自动跳过。
 * @returns {Promise<{name:string, src:string, host:string}>}
 */
async function vrResolveSiteName(msg) {
    const pageUrl = String((msg && msg.pageUrl) || '');
    const SN = self.VRSiteName;
    const ST = self.VRSiteNameStore;
    const host = (SN && SN.hostOf) ? SN.hostOf(pageUrl) : '';
    let name = '', src = '';

    try {
        name = String((msg && msg.siteName) || '').trim();
        if (name) { src = 'page'; }
    } catch (e) { name = ''; }

    /* 批量下载：入口已经解析并落库一次，子任务带 _siteResolved 直接复用，
     * 不再逐张读改写整张 vrSiteNames 表（200 张图 × 全表读写不可接受）。 */
    if (msg && msg._siteResolved) {
        return { name: name, src: src || 'page', host: host };
    }

    if (!name && msg && Number(msg.tabId) > 0) {
        const fromTab = await vrSiteNameFromTab(Number(msg.tabId));
        if (fromTab.name) { name = fromTab.name; src = fromTab.src || 'tab'; }
    }

    if (!name && ST && host) {
        try {
            await ST.ready();
            const rec = ST.peek(host);
            if (rec && rec.name) { name = rec.name; src = rec.src || 'cache'; }
        } catch (e) { /* 缓存读失败不阻断下载 */ }
    }

    if (name && ST && host) {
        /* 落库失败不影响下载；已有记录（尤其 manual）由 store 自己跳过 */
        try { ST.learn(host, name, src || 'learned'); } catch (e) { /* ignore */ }
    }
    return { name: name || '', src: src, host: host };
}

/**
 * 站点名探测：给一个域名/网址，后台抓首页并解析站名。
 *
 * 为什么必须走后台：扩展页面（options / 侧边栏）的跨域 fetch 受 CORS 限制，
 * 而 service worker 有 host_permissions（*://*）授权。设置页里「输入域名 →
 * 获取站名并加入」靠的就是这条路径 —— 用户常常先知道域名、还没在这台机器
 * 上下载过，只有这里能提前把名字拿到。
 */
async function vrSiteNameProbe(msg) {
    const SN = self.VRSiteName;
    const ST = self.VRSiteNameStore;
    const raw = String((msg && (msg.domain || msg.url)) || '').trim();
    if (!raw) { return { ok: false, message: '请输入域名', host: '', name: '' }; }
    if (!SN) { return { ok: false, message: '站点名模块未加载', host: '', name: '' }; }

    let input = raw;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) { input = 'https://' + input; }
    let host = '';
    let url = '';
    try {
        const u = new URL(input);
        host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
        url = u.origin + '/';
    } catch (e) {
        return { ok: false, message: '域名格式不对', host: '', name: '' };
    }
    if (!host) { return { ok: false, message: '域名格式不对', host: '', name: '' }; }

    /* 归一成可注册域名再登记，保证与下载链路用同一把钥匙 */
    let key = host;
    try { key = SN.registrableDomain(host) || host; } catch (e) { key = host; }

    /* 预置表已收录：先记下来，探测失败时可以兜底，且能告诉用户「本来就有」 */
    const presetHit = (self.VRSiteNamesPreset && self.VRSiteNamesPreset.byHost)
        ? self.VRSiteNamesPreset.byHost(key) : null;

    let html = '';
    let fetchErr = '';
    try {
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctl ? setTimeout(function () { ctl.abort(); }, 8000) : 0;
        const res = await fetch(url, {
            /* 不带 cookie：只要公开页面上的站名，避免把登录态送到第三方页面；
             * 少数站点因此拿不到，会退回预置表或域名。 */
            credentials: 'omit',
            redirect: 'follow',
            signal: ctl ? ctl.signal : undefined
        });
        if (timer) { clearTimeout(timer); }
        if (!res || !res.ok) { throw new Error('HTTP ' + (res ? res.status : '?')); }
        const text = await res.text();
        /* 站名在 <head>，首页常常几百 KB 起：截断到 300KB 足够，别整页吞下 */
        html = text.length > 300000 ? text.slice(0, 300000) : text;
    } catch (e) {
        fetchErr = String((e && e.message) || e || '');
        if (/abort/i.test(fetchErr)) { fetchErr = '请求超时（8 秒）'; }
    }

    const info = html ? SN.parseHtmlInfo(html, url) : { host: key, name: '', src: '', title: '' };
    let name = info.name || '';
    let src = info.src || '';

    /* 页面没声明就用预置名：比域名强，且与界面口径一致 */
    if (!name && presetHit) { name = presetHit.n; src = 'preset'; }

    if (ST) {
        try {
            if (name) {
                /* override：用户主动点探测，期望刷新已有自动记录；
                 * store 内部仍会保护 manual。 */
                await ST.put(key, name, src || 'probe', { override: true });
            } else {
                /* 连名字都没拿到也登记域名，面板里能看到并手填 */
                await ST.addHost(key, 'probe');
            }
        } catch (e) { /* 落库失败不影响返回探测结果 */ }
    }

    return {
        ok: !!(name || !fetchErr),
        host: key,
        name: name,
        src: src,
        title: info.title || '',
        preset: !!(presetHit && presetHit.n === name),
        message: name ? '' : (fetchErr || '页面没有声明站名')
    };
}

/**
 * 单张下载：命名 <日期>_<标题>.<ext>，落 video-rod/<平台>/<博主>/图片/
 * 走 vrDownloadWithName（ADR-027 文件名保护），并预登记资源库 meta。
 */
async function vrImgDownload(msg) {
    const P = self.VRPath;
    const url = String((msg && msg.url) || '').trim();
    if (!url || !/^(https?:|data:)/i.test(url)) {
        return { ok: false, code: 'IMG_E_NO_URL', message: '没找到可下载的图片' };
    }
    if (!P || !P.buildRelPath) {
        return { ok: false, code: 'IMG_E_FETCH', message: '路径模块未加载' };
    }

    const pageUrl = String((msg && msg.pageUrl) || '');
    /* 站名：消息里带的（网页内触发点）→ 注入目标页（扩展页面）→ 本地缓存。
     * 解析到就顺手落库，供以后重扫磁盘（无 DOM）时复用。 */
    const site = await vrResolveSiteName(msg);
    try {
        const plat = (P.detectPlatform ? P.detectPlatform(pageUrl) : '');
        const dupe = await vrFindExistingMedia({ site: plat, kind: 'image', url: url, pageUrl: pageUrl });
        if (dupe) {
            /* 苏哥口径（2026-11-09）：同一平台不允许重复下。命中就跳过，
             * 并把 skipped 带回去，批量进度才能报「N 张已存在」。 */
            return { ok: true, duplicate: true, skipped: true, path: dupe.relPath, downloadId: null };
        }
    } catch (e) { /* 查重失败不阻断下载 */ }
    const ext = vrImgExt(url, msg && msg.contentType);
    let title = '';
    try { title = P.cleanSeg(String((msg && msg.title) || '')) || ''; } catch (e) { title = ''; }
    // 标题太弱就换更有信息量的：
    //   · 空 / 只剩标点（微博实测会得到「- 微博」这种）
    //   · 页面标题跟站点名一样（X 的 title 是空串，只剩「图片」）
    // 宁可用「平台名」或 URL 末段，也不要用一个点开才能分辨的名字。
    const weak = (s) => !s || s.replace(/[\s\-_.·|:：]/g, '').length < 2;
    if (weak(title)) {
        let alt = site.name || '';
        if (weak(alt)) {
            try {
                const u = new URL(pageUrl || url);
                const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
                if (seg && seg.length <= 40 && !/^\d+$/.test(seg)) { alt = seg.replace(/^@/, ''); }
            } catch (e) { /* ignore */ }
        }
        title = weak(alt) ? '图片' : alt;
    }
    if (title.length > 60) { title = title.slice(0, 60); }

    /* 分组文件夹名。同一网页的一批图收进这里，避免九张同题图平铺。
     * 优先用调用方显式给的 part（多P/多集），其次用网页标题。 */
    const partName = String((msg && (msg.part || msg.pageTitle)) || '');

    /* 文件名维持原规则：日期_标题.ext。
     * 用户 2026-11-07 明确要求不要用 01/02 默认序号：
     * 没标题时沿用上面的回退（站点名 → URL 末段 → 「图片」），不额外造名字。 */
    const fileName = vrImgDate() + '_' + title + '.' + ext;
    const subdir = await vrImgSubdir();
    let relPath;
    try {
        relPath = P.buildRelPath({
            pageUrl: pageUrl || url,
            type: 'image',
            ext: ext,
            fileName: fileName,
            subdir: subdir,
            /* 网页/图集分组：一个网页的一批图收进以标题命名的子文件夹，
             * 否则九张同题图会平铺在站点目录下，只能靠文件名分辨。 */
            part: partName,
            /* 站名（已解析：消息 → 注入 → 缓存）。路径层用它决定一级目录，
             * 拿不到时路径层自行回退域名，不在这里兜底。 */
            siteName: site.name || '',
            /* 苏哥 2026-11-05：图片之前拿不到博主，全落进「待整理」。
             * 现在 content script 会把这条内容的博主带过来，直接自动分类。 */
            authorFull: String((msg && msg.authorFull) || ''),
            creatorId: String((msg && msg.creatorId) || '')
        });
    } catch (e) {
        return { ok: false, code: 'IMG_E_FETCH', message: '路径拼装失败' };
    }

    // 资源库预登记：平台/博主从最终相对路径反解，保证入库字段与磁盘一致
    let meta = {
        relPath: relPath,
        platform: '', platformName: '',
        creatorFull: '', creatorId: '',
        type: 'image',
        pageUrl: pageUrl,
        title: String((msg && msg.title) || ''),
        /* 2026-11-09 去重根因：这里原来只给 relPath/title，**没给 sourceUrl/mediaUrl**，
         * 入库条目因此没有来源键 → 下次下载 vrFindExistingMedia 永远查不到
         * → 「同一张图点几次就下几份」。补上后，库里条目可被认出并跳过。
         * mediaUrl 存原始签名直链也没关系：比对侧会先过 vrCanonMediaUrl。 */
        sourceUrl: url,
        mediaUrl: url
    };
    try {
        const p = P.parseRelPath(relPath) || {};
        meta.platform = p.platform || '';
        meta.platformName = p.platformName || '';
        meta.creatorFull = p.creatorFull || '';
        meta.creatorId = p.creatorId || '';
        meta.type = p.type || 'image';
    } catch (e) { /* 反解失败不影响下载 */ }

    // 防盗链：chrome.downloads.download 不接受 Referer 这类受控头
    // （实测直接报 "Unsafe request header name"），只能用 DNR 会话规则补。
    const ruleId = /^https?:/i.test(pageUrl) ? await vrImgRefererRule(url, pageUrl) : 0;

    let downloadId = null;
    try {
        downloadId = await vrDownloadWithName(url, relPath, { meta: meta });
    } catch (e) {
        downloadId = null;
    }
    // FSA 直写成功时没有 downloadId（也没走下载器），返回的是 {__fsa, path}。
    // 这是**成功**，不能当失败处理——否则批量下载会把已落盘的图计成失败。
    if (downloadId && typeof downloadId === 'object' && downloadId.__fsa) {
        if (ruleId) { vrImgClearRefererRule(ruleId); }   // 没发下载请求，规则立刻撤
        /* 真实落盘路径（freeName 可能已经把文件名改成 _01），判重与删文件都必须用它 */
        const relReal = String(downloadId.relPath || relPath);
        /* 落盘后立刻做内容判重（2026-11-09，B-67）：
         * URL 归一键挡得住「同图换签名/镜像/格式」，挡不住「同图换路径/换桶」，
         * 也挡不住「别的平台同一个文件」。以前只靠用户手动点「扫描重复」，
         * 所以苏哥体感就是「点了还是多出一份」。这里算 sha256 → 命中就删掉
         * 刚落盘的副本 → 库里留一条引用卡（物理一份、索引多份）。 */
        const ded = await vrImgContentDedupe(relReal);
        return {
            ok: true, fsa: true, duplicate: !!ded.dup, skipped: !!ded.dup,
            downloadId: null, path: relReal,
            refOf: ded.refOf || '', sha256: ded.hash || ''
        };
    }
    if (downloadId === null || downloadId === undefined) {
        // 没发起下载，规则立刻撤
        if (ruleId) { vrImgClearRefererRule(ruleId); }
        return { ok: false, code: 'IMG_E_FETCH', message: '下载发起失败，站点可能限制了直链', path: relPath };
    }

    // 快速失败检测 + 离屏兜底（2026-11-05）。
    // 微博 sinaimg 这类 CDN 只认 Referer，而 downloads 请求带不上（DNR 对它不生效），
    // 于是会落一个 0 字节文件再报 SERVER_FORBIDDEN。以前这里直接当成功，用户看到空文件。
    // 现在 2.5s 内判到 interrupted 就撤账、清残件，改走离屏直连（扩展上下文 fetch 能带 Referer）。
    const outcome = await vrWaitDownload(downloadId, 2500);
    if (outcome && outcome.state === 'interrupted') {
        try { vrAbortFilename(url, relPath); } catch (e) { /* ignore */ }
        vrDropDownload(downloadId);
        // ⚠️ 规则不能在这里撤：下面的离屏 fetch 还要靠它补 Referer。
        //    先撤规则再取流 = 403（2026-11-05 批量下载 2/3 失败就是踩的这个）。
        const off = await vrOffscreenDownload(url, String(relPath).split('/').pop());
        if (ruleId) { vrImgClearRefererRule(ruleId); }
        if (off && off.ok && off.blobUrl) {
            const id2 = await vrDownloadWithName(off.blobUrl, relPath, { meta: meta });
            if (id2 && typeof id2 === 'object' && id2.__fsa) {
                /* 离屏兜底也是 FSA 落盘，同样要过内容判重（同样用真实落盘路径） */
                const relReal2 = String(id2.relPath || relPath);
                const ded2 = await vrImgContentDedupe(relReal2);
                return {
                    ok: true, fsa: true, duplicate: !!ded2.dup, skipped: !!ded2.dup,
                    downloadId: null, path: relReal2,
                    refOf: ded2.refOf || '', sha256: ded2.hash || ''
                };
            }
            if (id2 !== null && id2 !== undefined) {
                return { ok: true, downloadId: id2, path: relPath, via: 'offscreen' };
            }
        }
        return {
            ok: false, code: 'IMG_E_FETCH',
            message: '站点防盗链拦了直链（已尝试离屏直连）',
            path: relPath,
            offscreen: off || null
        };
    }

    // 规则要覆盖到请求真正发出为止，不能 download() 一返回就删——
    // 那时请求可能还没发，删早了下载就丢 Referer（批量并发时尤其明显）。
    if (ruleId) { vrImgClearRuleAfterDownload(ruleId, downloadId); }
    return { ok: true, downloadId: downloadId, path: relPath };
}

/* ==========================================================
 * 图片批量下载（I3）：并发池 + 进度广播 + 可取消
 * 协议见 docs/IMAGE-I3-IMPL.md §3.1
 * ========================================================== */

var VR_IMG_BATCH = new Map();          // batchId -> {canceled:boolean}
var VR_IMG_BATCH_MAX = 200;
var VR_IMG_BATCH_CONC = 3;

/** 进度节流：200ms 内多次完成只发一次 */
function vrImgProgressThrottle(batchId, state) {
    var now = Date.now();
    if (now - (state.lastEmit || 0) < 200 && state.done < state.total) { return; }
    state.lastEmit = now;
    try {
        chrome.runtime.sendMessage({
            Message: 'vrImg.batchProgress',
            batchId: batchId,
            done: state.done,
            ok: state.ok,
            fail: state.fail,
            skipped: state.skipped || 0,
            total: state.total
        }, function () {
            // 必须读一次 lastError：content 页可能已关闭
            void chrome.runtime.lastError;
        });
    } catch (e) { /* content 不在，忽略 */ }
}

/**
 * 批量下载：每张走 vrImgDownload（复用 I2 的落位与 DNR 补头）。
 * 失败不中断；取消只影响「还没开始的」任务。
 */
async function vrImgBatch(msg, sender) {
    const batchId = String((msg && msg.batchId) || ('b-' + Date.now()));
    const raw = Array.isArray(msg && msg.items) ? msg.items : [];
    const conc = Math.max(1, Math.min(8, Number(msg && msg.concurrency) || VR_IMG_BATCH_CONC));
    const pageUrl = String((msg && msg.pageUrl) || '');
    const pageTitle = String((msg && msg.pageTitle) || '');
    /* 批量只解析一次站名：把结果塞进每个子任务，避免逐张注入目标页。
     * 单张 vrImgDownload 走第一级（消息里已带）即时返回，不再注入。 */
    const site = await vrResolveSiteName(msg);

    /* M-2b（2026-11-08 审计）：小红书详情页批量——面板消息只带 document.title，
     * 作者从来没人传（content 注释是空头支票），路径层只能回退域名/待整理。
     * 这里用 state 权威值覆盖标题并补作者；面板通道是 content→SW，
     * sender.tab 可用（不像 popup 通道有 M-1 的 no-tab 坑）。
     * 非详情页/解析失败 → xhs=null，完整维持现状。 */
    let xhs = null;
    if (/\/(?:explore|discovery\/item)\/[0-9a-f]{12,32}/i.test(pageUrl)) {
        const tid = sender && sender.tab && sender.tab.id;
        if (tid > 0) {
            /* noteId 必须给空串不能给 undefined——executeScript args 序列化
             * 拒收 undefined 直接 TypeError（消息通道同款写法 Message.noteId || ''）。
             * 2026-11-08 fixture 实测：漏了这个参数，state 永远拿不到。 */
            try { xhs = await vrXhsScanInTab(tid, ''); } catch (e) { xhs = null; }
        }
    }

    /* 本批次的平台键：账本按「平台 + 归一键」记账（同平台去重、跨平台放行） */
    const platKey = (self.VRPath && self.VRPath.detectPlatform)
        ? String(self.VRPath.detectPlatform(pageUrl) || '') : '';

    /* 抖音图文页补作者（2026-11-09，B-67）。
     * 作者只存在于 React Fiber（DOM 选择器已哈希化，拿不到）；侧边栏/面板通道
     * 消息里从来没有作者，路径层于是退回「待整理」，而页面浮标那条通道有作者 →
     * 同一作品被劈成两个文件夹，用户看到的就是「重复」。这里注入一次补上。 */
    let dyAuthor = String((msg && msg.authorFull) || '');
    if (!dyAuthor && platKey === 'douyin' && /\/note\//i.test(pageUrl)) {
        const dyTabId = sender && sender.tab && sender.tab.id;
        if (dyTabId > 0) {
            try {
                const dm = await vrDouyinImages(sender);
                if (dm && dm.ok && dm.meta && dm.meta.nickname) {
                    dyAuthor = String(dm.meta.nickname) +
                        (dm.meta.uniqueId ? '(@' + String(dm.meta.uniqueId) + ')' : '');
                }
            } catch (eDy) { /* 拿不到就落「待整理」，不伪造作者 */ }
        }
    }

    const items = raw.slice(0, VR_IMG_BATCH_MAX);
    const state = { canceled: false, done: 0, ok: 0, fail: 0, skipped: 0, total: items.length, lastEmit: 0, failures: [] };
    VR_IMG_BATCH.set(batchId, state);

    if (!items.length) {
        VR_IMG_BATCH.delete(batchId);
        return { ok: true, batchId: batchId, done: 0, succeeded: 0, fail: 0, failures: [], canceled: false };
    }

    // 已下载去重表：同 URL 不再重复下
    const seen = await vrImgSeenUrls();
    /* 本批内去重（2026-11-09，B-67）：一次扫描里同一张图经常出现多次
     * （同一 sprite 用在多个元素、缩略图+大图同源）。原来只查跨批账本，
     * 同批的重复会各下一份 —— 390 张里能多下 6~10 份完全相同的文件。
     * 收集阶段 add 之前没有 await，单线程下不会漏。 */
    const batchSeen = new Set();

    let cursor = 0;
    const worker = async function () {
        while (true) {
            if (state.canceled) { return; }
            const idx = cursor++;
            if (idx >= items.length) { return; }
            const it = items[idx] || {};
            const url = String(it.url || '');
            const key = vrImgDedupeKey(url, platKey);
            const rawKey = url.split('#')[0].trim();

            /* 老账本里存的是「整条 URL」，新账本存归一键 —— 两边都要认，
             * 否则升级后会把历史下过的图重下一遍。 */
            if ((key && seen[key]) || (rawKey && seen[rawKey])) {
                // 已经下过：跳过，不重复落盘
                state.done++; state.ok++; state.skipped++;
                vrImgProgressThrottle(batchId, state);
                continue;
            }
            /* 同一批里出现两次（不同 URL、同一张图）→ 第二次直接跳过 */
            if (key) {
                if (batchSeen.has(key)) {
                    state.done++; state.ok++; state.skipped++;
                    vrImgProgressThrottle(batchId, state);
                    continue;
                }
                batchSeen.add(key);
            }
            try {
                const r = await vrImgDownload({
                    url: url,
                    candidates: it.candidates || [url],
                    pageUrl: pageUrl,
                    siteName: site.name || '',
                    _siteResolved: true,
                    /* 同一网页的一批图收进以网页标题命名的子文件夹：
                     * 用户要的是「九张图一个文件夹」，而不是九张平铺。 */
                    pageTitle: (xhs && xhs.ok && xhs.title) || pageTitle,
                    title: (xhs && xhs.ok && xhs.title) || it.title || pageTitle || '图片',
                    /* state 权威作者（格式与 popup 通道/路径引擎一致：昵称(@id)）。
                     * 小红书走 state 覆盖；其它站点（抖音图文浮层）由消息自带。 */
                    authorFull: (xhs && xhs.ok && xhs.author)
                        ? String(xhs.author) + (xhs.authorId ? '(@' + String(xhs.authorId) + ')' : '')
                        : (dyAuthor || String((msg && msg.authorFull) || '')),
                    creatorId: (xhs && xhs.ok)
                        ? String(xhs.authorId || '')
                        : String((msg && msg.creatorId) || '')
                });
                if (r && r.ok) {
                    state.ok++;
                    /* 下载前查重命中（库里已有同平台同一张）：
                     * 不落盘、只算「跳过」，并且要把 URL 记进账本，下次直接命中。 */
                    if (r.duplicate) { state.skipped++; }
                    /* 只记「平台|归一键」。整条 URL 不再入账：它会让跨平台同图
                     * 被误判成重复，导致库里缺一张卡。旧账本里的整条 URL 仍会被
                     * 上面的 rawKey 检查认出来（一次性向后兼容）。 */
                    if (key) { seen[key] = 1; vrImgRememberUrl(key); }
                } else {
                    state.fail++;
                    // 失败详情必须带出来：批量只报 IMG_E_FETCH 时根本查不出是哪一步挂的
                    // （2026-11-05 微博批量 3 张挂 2 张就是这样盲了半小时）
                    state.failures.push({
                        url: url,
                        code: (r && r.code) || 'IMG_E_FETCH',
                        message: (r && r.message) || '',
                        offscreen: (r && r.offscreen) ? { ok: false, reason: String(r.offscreen.reason || '') } : null
                    });
                }
            } catch (e) {
                state.fail++;
                state.failures.push({ url: url, code: 'IMG_E_FETCH' });
            }
            state.done++;
            vrImgProgressThrottle(batchId, state);
        }
    };

    const runners = [];
    const n = Math.min(conc, items.length);
    for (let i = 0; i < n; i++) { runners.push(worker()); }
    await Promise.all(runners);

    vrImgProgressThrottle(batchId, state);
    VR_IMG_BATCH.delete(batchId);
    return {
        ok: true,
        batchId: batchId,
        done: state.done,
        succeeded: state.ok,
        skipped: state.skipped || 0,
        fail: state.fail,
        failures: state.failures.slice(0, 50),
        canceled: state.canceled
    };
}

function vrImgBatchCancel(msg) {
    const batchId = String((msg && msg.batchId) || '');
    const st = VR_IMG_BATCH.get(batchId);
    if (st) { st.canceled = true; }
}

/* ==========================================================
 * 图集扫描（I6 模式 A：自动滚动）
 * 协议见 docs/IMAGE-DOWNLOAD-PLAN.md §2.6
 *
 * 为什么状态要落 chrome.storage.session 而不是只放内存：
 *   MV3 的 SW 空闲 30s 就会被回收，扫一个长图集很容易超过。任务状态（已滚几屏、
 *   已收集哪些 URL）放内存等于「SW 一睡就全丢」，面板轮询回来只能看到空白。
 *   落 session 后，内容脚本每 400ms 的轮询会把 SW 叫醒，接着从断点继续滚。
 *   用 session 而不是 local：这些是临时任务数据，浏览器关掉就该消失。
 * ========================================================== */

var VR_ALBUM_KEY = 'vrImgAlbumTasks';
var VR_ALBUM_MAX_TASKS = 8;          // 只留最近几个任务，防 session 存储无限长
var VR_ALBUM_MAX_URLS = 1000;        // 单任务收集上限，防极端页面把存储撑爆
var VR_ALBUM_SETTLE_MS = 450;        // 滚动后等懒加载的固定时间
var VR_ALBUM_RUNNING = new Set();    // 正在跑的 taskId（防同一任务被并发续跑）
var VR_ALBUM_STOP = new Set();       // 用户点了停止的 taskId（内存侧快速判定）

function vrAlbumArea() {
    return chrome.storage.session || chrome.storage.local;
}

function vrAlbumReadAll() {
    return new Promise(function (resolve) {
        try {
            vrAlbumArea().get(VR_ALBUM_KEY, function (o) {
                void chrome.runtime.lastError;
                resolve((o && o[VR_ALBUM_KEY]) || {});
            });
        } catch (e) { resolve({}); }
    });
}

function vrAlbumWriteAll(map) {
    return new Promise(function (resolve) {
        try {
            var obj = {};
            obj[VR_ALBUM_KEY] = map;
            vrAlbumArea().set(obj, function () {
                void chrome.runtime.lastError;
                resolve();
            });
        } catch (e) { resolve(); }
    });
}

function vrAlbumGet(taskId) {
    return vrAlbumReadAll().then(function (map) { return map[taskId] || null; });
}

function vrAlbumPut(task) {
    if (!task || !task.taskId) { return Promise.resolve(); }
    task.updatedAt = Date.now();
    return vrAlbumReadAll().then(function (map) {
        map[task.taskId] = task;
        var ids = Object.keys(map);
        if (ids.length > VR_ALBUM_MAX_TASKS) {
            ids.sort(function (a, b) { return (map[a].updatedAt || 0) - (map[b].updatedAt || 0); });
            var drop = ids.length - VR_ALBUM_MAX_TASKS;
            for (var i = 0; i < drop; i++) { delete map[ids[i]]; }
        }
        return vrAlbumWriteAll(map);
    });
}

function vrAlbumNewId() {
    return 'a-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

/** 进度广播：和批量下载一样 200ms 节流，扫得快时不会把消息通道刷爆 */
function vrAlbumEmit(task, force) {
    if (!task) { return; }
    var now = Date.now();
    if (!force && now - (task.lastEmit || 0) < 200 && task.state === 'scanning') { return; }
    task.lastEmit = now;
    try {
        chrome.runtime.sendMessage({
            Message: 'vrImg.albumProgress',
            taskId: task.taskId,
            page: task.page,
            maxPages: task.maxPages,
            collected: task.urls.length,
            state: task.state
        }, function () {
            void chrome.runtime.lastError;   // 页面已关时必读，否则控制台报未捕获
        });
    } catch (e) { /* content 不在，忽略 */ }
}

function vrAlbumSleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

function vrAlbumRunScript(tabId, func, args) {
    return new Promise(function (resolve) {
        try {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: func,
                args: args || []
            }, function (res) {
                if (chrome.runtime.lastError) {
                    resolve({ ok: false, message: chrome.runtime.lastError.message });
                    return;
                }
                var r = res && res[0] ? res[0].result : null;
                resolve({ ok: true, result: r });
            });
        } catch (e) {
            resolve({ ok: false, message: String(e && e.message || e) });
        }
    });
}

/* 滚一屏。必须在目标页里执行：SW 没有 DOM，也没有视口。 */
function vrAlbumScrollStep() {
    var before = window.scrollY || 0;
    var vh = window.innerHeight || 0;
    var step = Math.max(200, Math.floor(vh * 0.9));
    window.scrollTo(0, before + step);
    var docH = Math.max(
        (document.documentElement && document.documentElement.scrollHeight) || 0,
        (document.body && document.body.scrollHeight) || 0
    );
    var after = window.scrollY || 0;
    return {
        before: before,
        y: after,
        innerH: vh,
        docH: docH,
        moved: after > before,
        atBottom: after + vh >= docH - 4
    };
}

/**
 * 采集当前页已加载的图片。
 * 走 self.__vrImgAlbumCollect（image-album.js 挂的入口）：过滤口径必须与面板/悬停一致。
 * 内容脚本没注入时返回 null，由调用方按失败处理。
 */
function vrAlbumCollectStep(min) {
    if (typeof self.__vrImgAlbumCollect !== 'function') { return null; }
    return self.__vrImgAlbumCollect(min);
}

/**
 * 在目标页里找「下一页」候选（DOM 读取只能在页面侧做，SW 没有 DOM）。
 * 只收集候选，**判定归 VRAlbumSites.pickNext** —— 纯函数才能单测。
 */
function vrAlbumNextStep() {
    var out = [];
    var as;
    try { as = document.querySelectorAll('a[href]'); } catch (e) { return { href: location.href, candidates: [] }; }
    for (var i = 0; i < as.length && out.length < 60; i++) {
        var a = as[i];
        var href = a.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#') { continue; }
        if (/^javascript:/i.test(href)) { continue; }
        var text = String(a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20);
        var rel = a.getAttribute('rel') || '';
        // 只回传「像下一页」的，避免把几百个链接全塞进消息里
        if (rel && /next/i.test(rel)) {
            out.push({ href: href, text: text, rel: rel });
            continue;
        }
        if (/^(下一页|下页|next|›|»|→)$/i.test(text) || /下一页/.test(text)) {
            out.push({ href: href, text: text, rel: rel });
        }
    }
    return { href: location.href, candidates: out };
}

/** 等某个标签页加载完成（导航后用），带超时；超时返回 false */
function vrAlbumWaitLoad(tabId, timeout) {
    return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () { finish(false); }, timeout || 15000);
        function finish(ok) {
            if (done) { return; }
            done = true;
            clearTimeout(timer);
            try { chrome.tabs.onUpdated.removeListener(onUpd); } catch (e) { /* 忽略 */ }
            resolve(ok);
        }
        function onUpd(id, info) {
            if (id !== tabId) { return; }
            if (info && info.status === 'complete') { finish(true); }
        }
        try { chrome.tabs.onUpdated.addListener(onUpd); } catch (e) { finish(false); }
    });
}

function vrAlbumCreateTab(url) {
    return new Promise(function (resolve) {
        try {
            // active:false —— 翻页会在后台跑，绝不能把用户正在看的标签抢走或改掉
            chrome.tabs.create({ url: url, active: false }, function (t) {
                void chrome.runtime.lastError;
                resolve((t && t.id) ? t.id : 0);
            });
        } catch (e) { resolve(0); }
    });
}

/**
 * 分页模式（B）：在**后台标签页**里逐页翻，每页采集一次。
 *
 * 为什么开新标签而不是复用用户的 tab：
 *   · 复用会把用户正在看的页面导航走，翻 10 页就等于抢了 10 次；
 *   · 用户翻到一半自己点链接，会和我们抢同一个标签，互相打断。
 *   代价是多开一个后台标签（跑完即关），换来的是完全不打扰。
 */
async function vrAlbumPageLoop(taskId) {
    if (VR_ALBUM_RUNNING.has(taskId)) { return; }
    VR_ALBUM_RUNNING.add(taskId);
    let workTab = 0;
    try {
        let task = await vrAlbumGet(taskId);
        if (!task) { return; }
        if (task.state !== 'scanning') { return; }

        const seen = Object.create(null);
        for (let i = 0; i < task.urls.length; i++) { seen[task.urls[i].url] = 1; }
        const seenPage = Object.create(null);

        let url = String(task.startUrl || '');
        if (!url) {
            task.state = 'error';
            task.message = '拿不到起始页地址';
            await vrAlbumPut(task); vrAlbumEmit(task, true);
            return;
        }
        seenPage[url] = 1;

        workTab = await vrAlbumCreateTab(url);
        if (!workTab) {
            task.state = 'error';
            task.message = '无法创建翻页标签页';
            await vrAlbumPut(task); vrAlbumEmit(task, true);
            return;
        }
        task.workTabId = workTab;
        await vrAlbumWaitLoad(workTab, 15000);
        await vrAlbumSleep(VR_ALBUM_SETTLE_MS);

        while (task.state === 'scanning') {
            if (VR_ALBUM_STOP.has(taskId)) { task.state = 'stopped'; break; }
            const live = await vrAlbumGet(taskId);
            if (!live) { return; }
            if (live.state !== 'scanning') { task.state = live.state; break; }
            if (task.page >= task.maxPages) { task.state = 'done'; break; }

            // ① 采集当前页
            const got = await vrAlbumRunScript(workTab, vrAlbumCollectStep, [task.minSize]);
            if (got.ok && Array.isArray(got.result)) {
                for (let i = 0; i < got.result.length; i++) {
                    const it = got.result[i];
                    if (!it || !it.url || seen[it.url]) { continue; }
                    seen[it.url] = 1;
                    task.urls.push(it);
                    if (task.urls.length >= VR_ALBUM_MAX_URLS) { break; }
                }
            }
            task.page += 1;
            await vrAlbumPut(task);
            vrAlbumEmit(task);

            if (task.urls.length >= VR_ALBUM_MAX_URLS) { task.state = 'done'; break; }

            // ② 找下一页：页面给的链接 + 站点规则算参数
            const nx = await vrAlbumRunScript(workTab, vrAlbumNextStep);
            const cands = (nx.ok && nx.result && nx.result.candidates) ? nx.result.candidates : [];
            const S = self.VRAlbumSites;
            if (!S) { task.state = 'done'; task.message = '站点规则模块未加载'; break; }
            const nextHref = S.pickNext(cands);
            const next = S.nextPageUrl(url, S.matchSite(url), { nextHref: nextHref });

            if (!next || next === url) {
                task.state = 'done';
                task.message = '没有下一页了（第 ' + task.page + ' 页）';
                break;
            }
            if (seenPage[next]) {          // 防翻页环（站点把「下一页」指回自己）
                task.state = 'done';
                task.message = '分页出现循环，已停止';
                break;
            }
            seenPage[next] = 1;
            url = next;

            // ③ 导航并等加载
            try {
                chrome.tabs.update(workTab, { url: url });
            } catch (e) {
                task.state = 'error';
                task.message = '翻页导航失败：' + String((e && e.message) || e);
                break;
            }
            const loaded = await vrAlbumWaitLoad(workTab, 15000);
            if (!loaded) {
                task.state = 'error';
                task.message = '第 ' + (task.page + 1) + ' 页加载超时';
                break;
            }
            await vrAlbumSleep(VR_ALBUM_SETTLE_MS);
        }

        task.message = task.message || '';
        await vrAlbumPut(task);
        vrAlbumEmit(task, true);
    } catch (e) {
        try {
            const t = await vrAlbumGet(taskId);
            if (t) {
                t.state = 'error';
                t.message = String((e && e.message) || e);
                await vrAlbumPut(t);
                vrAlbumEmit(t, true);
            }
        } catch (e2) { /* 收尾失败不影响已有数据 */ }
    } finally {
        VR_ALBUM_RUNNING.delete(taskId);
        if (workTab) {
            try { chrome.tabs.remove(workTab, function () { void chrome.runtime.lastError; }); }
            catch (e) { /* 已关则忽略 */ }
        }
    }
}

/**
 * 扫描主循环。可重入：SW 被回收后由 albumProgress 的轮询再次拉起，从 task.page 接着滚。
 */
async function vrAlbumLoop(taskId) {
    if (VR_ALBUM_RUNNING.has(taskId)) { return; }
    VR_ALBUM_RUNNING.add(taskId);
    try {
        let task = await vrAlbumGet(taskId);
        if (!task) { return; }
        if (task.state !== 'scanning') { return; }

        const seen = Object.create(null);
        for (let i = 0; i < task.urls.length; i++) { seen[task.urls[i].url] = 1; }

        while (task.state === 'scanning') {
            if (VR_ALBUM_STOP.has(taskId)) {
                task.state = 'stopped';
                break;
            }
            // 每轮都回读一次状态：停止可能来自「另一个 SW 实例」（SW 被回收后
            // 内存里的 VR_ALBUM_STOP 就没了），只信存储里的 state 才不会白滚。
            const live = await vrAlbumGet(taskId);
            if (!live) { return; }
            if (live.state !== 'scanning') {
                task.state = live.state;
                break;
            }
            if (task.page >= task.maxPages) { task.state = 'done'; break; }

            const sc = await vrAlbumRunScript(task.tabId, vrAlbumScrollStep);
            if (!sc.ok) {
                task.state = 'error';
                task.message = '无法在目标页执行滚动：' + (sc.message || '页面可能已关闭');
                break;
            }
            const geo = sc.result || {};
            task.page += 1;

            // 滚动后等懒加载。固定等待而不是 MutationObserver：SW 里没有 DOM，
            // 观察器只能放页面侧，反而要多一轮消息；这里 450ms 已覆盖绝大多数站点。
            await vrAlbumSleep(VR_ALBUM_SETTLE_MS);

            const got = await vrAlbumRunScript(task.tabId, vrAlbumCollectStep, [task.minSize]);
            if (got.ok && Array.isArray(got.result)) {
                for (let i = 0; i < got.result.length; i++) {
                    const it = got.result[i];
                    if (!it || !it.url || seen[it.url]) { continue; }
                    seen[it.url] = 1;
                    task.urls.push(it);
                    if (task.urls.length >= VR_ALBUM_MAX_URLS) { break; }
                }
            }

            // 到页面底部时再补采一次：最后一屏的图常常在滚动后 1s 才 naturalWidth > 0，
            // 只采一次会少几张（表现为「明明到底了却少几张」）。
            if (geo.atBottom) {
                await vrAlbumSleep(VR_ALBUM_SETTLE_MS);
                const again = await vrAlbumRunScript(task.tabId, vrAlbumCollectStep, [task.minSize]);
                if (again.ok && Array.isArray(again.result)) {
                    for (let i = 0; i < again.result.length; i++) {
                        const it = again.result[i];
                        if (!it || !it.url || seen[it.url]) { continue; }
                        seen[it.url] = 1;
                        task.urls.push(it);
                        if (task.urls.length >= VR_ALBUM_MAX_URLS) { break; }
                    }
                }
                task.state = 'done';
                break;
            }

            // 滚不动了（页面已到顶或没有可滚区域）也算到底
            if (!geo.moved) {
                task.state = 'done';
                break;
            }

            await vrAlbumPut(task);
            vrAlbumEmit(task);
        }

        task.message = task.message || '';
        await vrAlbumPut(task);
        vrAlbumEmit(task, true);
    } catch (e) {
        try {
            const t = await vrAlbumGet(taskId);
            if (t) {
                t.state = 'error';
                t.message = String((e && e.message) || e);
                await vrAlbumPut(t);
                vrAlbumEmit(t, true);
            }
        } catch (e2) { /* 收尾失败也不影响已有数据 */ }
    } finally {
        VR_ALBUM_RUNNING.delete(taskId);
    }
}

async function vrAlbumScan(msg, tabId) {
    const mode = String((msg && msg.mode) || 'scroll');
    if (mode !== 'scroll' && mode !== 'pages') {
        return { ok: false, code: 'IMG_E_UNSUPPORTED', message: '只支持 scroll（滚动）或 pages（翻页）' };
    }
    const maxPages = Math.max(1, Math.min(50, Number(msg && msg.maxPages) || 10));
    const id = String((msg && msg.taskId) || vrAlbumNewId());
    const min = Math.max(16, Number(msg && msg.minSize) || 100);

    if (!tabId) {
        return { ok: false, code: 'IMG_E_NO_TAB', message: '拿不到标签页 ID' };
    }

    /* 翻页模式需要起始地址：优先用消息里带的，其次查标签页当前 URL。
     * 必须在这里取定，不能进循环后再查——翻页会把后台标签导航走，
     * 那时查到的已经是第 N 页，再也回不到起点。 */
    let startUrl = String((msg && msg.startUrl) || '');
    if (mode === 'pages' && !startUrl) {
        startUrl = await new Promise(function (resolve) {
            try {
                chrome.tabs.get(tabId, function (t) {
                    void chrome.runtime.lastError;
                    resolve((t && t.url) ? t.url : '');
                });
            } catch (e) { resolve(''); }
        });
    }

    const task = {
        taskId: id,
        tabId: tabId,
        mode: mode,
        maxPages: maxPages,
        minSize: min,
        page: 0,
        urls: [],
        state: 'scanning',
        message: '',
        startUrl: startUrl,
        updatedAt: Date.now(),
        lastEmit: 0
    };
    VR_ALBUM_STOP.delete(id);
    await vrAlbumPut(task);
    vrAlbumEmit(task, true);
    // 不 await：扫描要跑几十秒，立刻回 taskId 让面板能开始轮询
    if (mode === 'pages') { vrAlbumPageLoop(id); } else { vrAlbumLoop(id); }
    return { ok: true, taskId: id, mode: mode, maxPages: maxPages, state: 'scanning' };
}

async function vrAlbumProgress(msg) {
    const id = String((msg && msg.taskId) || '');
    if (!id) { return { ok: false, code: 'IMG_E_NO_TASK' }; }
    let task = await vrAlbumGet(id);
    if (!task) {
        return { ok: false, code: 'IMG_E_NO_TASK', message: '任务不存在（可能已过期）' };
    }
    // 轮询顺带当「续跑探针」：SW 被回收后内存里没有循环，这里把它重新拉起来
    if (task.state === 'scanning' && !VR_ALBUM_RUNNING.has(id) && !VR_ALBUM_STOP.has(id)) {
        vrAlbumLoop(id);
    }
    const out = {
        ok: true,
        taskId: id,
        page: task.page,
        maxPages: task.maxPages,
        collected: task.urls.length,
        state: task.state,
        message: task.message || ''
    };
    if (msg && msg.withItems) {
        out.items = task.urls.slice();
    }
    return out;
}

async function vrAlbumStop(msg) {
    const id = String((msg && msg.taskId) || '');
    if (!id) { return { ok: false, code: 'IMG_E_NO_TASK' }; }
    VR_ALBUM_STOP.add(id);
    const task = await vrAlbumGet(id);
    if (!task) { return { ok: false, code: 'IMG_E_NO_TASK', message: '任务不存在' }; }
    if (task.state === 'scanning') {
        task.state = 'stopped';
        await vrAlbumPut(task);
        vrAlbumEmit(task, true);
    }
    return {
        ok: true,
        taskId: id,
        page: task.page,
        collected: task.urls.length,
        state: task.state
    };
}

/* 已下载去重表：chrome.storage.local 键 vrImgDownloaded，上限 2000 条按时间淘汰 */
var VR_IMG_SEEN_MAX = 2000;

function vrImgDedupeKey(url, site) {
    /* 去重键必须是「同一张图的不变量」，不是整条 URL。
     * 2026-11-09 苏哥报「点多几次就不断下载」：原来 return 整条 URL，
     * 而抖音/小红书图床每次加载都会换 x-signature / 镜像子域 / tplv 格式参数，
     * 于是同一张图每次都是「新图」——去重表形同虚设。
     * 统一走 vrCanonMediaUrl（它已经处理了小红书 spectrum 与抖音图床）。 */
    const canon = vrCanonMediaUrl(url) || String(url || '').split('#')[0].trim();
    /* 键要带平台：苏哥口径是「同一平台不许重复，不同平台保留一份但索引可以多份」。
     * 不带平台的话，微博下同一张图会被抖音那条账本挡住 —— 用户看不到任何反馈，
     * 库里也不会出现微博这张卡。带平台后：同平台命中 → 跳过；跨平台 → 走内容指纹
     * 判重，物理只留一份、库里补一条引用卡（见 VRDedup.afterDownload）。 */
    const pk = String(site || '').trim().toLowerCase();
    return pk ? (pk + '|' + canon) : canon;
}

function vrImgSeenUrls() {
    return new Promise(function (resolve) {
        try {
            chrome.storage.local.get('vrImgDownloaded', function (o) {
                const stored = (o && o.vrImgDownloaded) || {};
                // 外部可能清过表（设置页/测试），缓存要跟着失效，
                // 否则会拿旧缓存把已清掉的记录又写回去（踩过）
                if (!Object.keys(stored).length) { vrImgSeenCache = null; }
                resolve(Object.assign(Object.create(null), stored));
            });
        } catch (e) { resolve(Object.create(null)); }
    });
}

/* 去重表写入必须串行。
 *
 * 早先是「读-改-写」直接发：批量下载 5 张时 5 个调用并发跑，
 * 各自读到同一个旧 map，然后依次写回 —— 后写的把先写的覆盖掉，
 * 5 张最后只剩 1~2 条记录。表现是「明明下过却不去重」（实测踩过）。
 *
 * 改成一条 promise 链：前一次写完才读下一次，谁也覆盖不了谁。
 * 内存里也留一份，省掉每轮的 get。 */
let vrImgSeenCache = null;
let vrImgSeenChain = Promise.resolve();

function vrImgRememberUrl(key) {
    if (!key) { return; }
    vrImgSeenChain = vrImgSeenChain.then(function () {
        return new Promise(function (resolve) {
            const apply = function (map) {
                map[key] = Date.now();
                const keys = Object.keys(map);
                if (keys.length > VR_IMG_SEEN_MAX) {
                    keys.sort(function (a, b) { return map[a] - map[b]; });
                    const drop = keys.length - VR_IMG_SEEN_MAX;
                    for (let i = 0; i < drop; i++) { delete map[keys[i]]; }
                }
                chrome.storage.local.set({ vrImgDownloaded: map }, function () { resolve(); });
            };
            if (vrImgSeenCache) { apply(vrImgSeenCache); return; }
            try {
                chrome.storage.local.get('vrImgDownloaded', function (o) {
                    vrImgSeenCache = (o && o.vrImgDownloaded) || {};
                    apply(vrImgSeenCache);
                });
            } catch (e) { resolve(); }
        });
    }).catch(function () { /* 单条失败不影响后续 */ });
}

// 文件名确定事件：官方约束每扩展只许注册一个监听器，suggest 必须同步调用。
// 防御性 try/catch：万一 downloads API 异常，绝不能被拖垮整个 SW。
try {
    chrome.downloads.onDeterminingFilename.addListener(function (item, suggest) {
        const me = chrome.runtime.id;
        const by = item.byExtensionId;
        // 防线 1：别的扩展发起的下载，不碰（做好公民，避免抢名）
        if (typeof by === "string" && by.length > 0 && by !== me) { return; }
        // 防线 2：预记账取用（url / finalUrl 双查，重定向后的最终地址也能命中）。
        // 取用不删账：同一 URL 的重复/并发下载都能拿到名字（靠 TTL 自然过期，
        // 重下会以新记账覆盖）；快速双击、批量去重场景不再丢名。
        const urls = [item.url, item.finalUrl].filter(function (u) {
            return typeof u === "string" && u.length > 0;
        });
        const now = Date.now();
        for (let i = 0; i < urls.length; i++) {
            const hit = vrPendingNameByUrl.get(urls[i]);
            if (!hit) { continue; }
            if (now - hit.at > VR_NAME_TTL) {
                vrPendingNameByUrl.delete(urls[i]);
                continue;
            }
            const name = String(hit.filename).replace(/\\/g, "/");
            // suggest 只收相对下载目录的路径；绝对路径/空路径会被浏览器忽略
            if (name && !/^([a-zA-Z]:|\/)/.test(name)) {
                suggest({ filename: name, conflictAction: hit.conflictAction });
                return;
            }
        }
        // 防线 2.5：B站页面内合成的 blob 下载。它没有 URL 预记账（<a download>），
        // 但下载前 SW 已经记下完整 relPath —— 在这里补回目录，避免落进下载根目录。
        const bl = vrPendingBiliName;
        // 只认 blob: 下载（B站页面内合成），别按 .mp4 后缀猜：
        // 窗口期内任何无关的 mp4 下载都会被改错路径。
        if (bl && now - bl.at < 120000 &&
            /^blob:/i.test(String(item.url || ''))) {
            vrPendingBiliName = null;
            const rel = String(bl.full).replace(/\\/g, '/');
            /* 把元数据从「路径键」迁到真实 blob URL 上：入库链路是按下载记录的
             * url 找预登记的，不迁等于没登记（B站详情页来源空白的老问题）。 */
            if (bl.meta && self.VRLib && item.url) {
                try {
                    self.VRLib.record(String(item.url), Object.assign({}, bl.meta, { relPath: rel }));
                } catch (e) { /* 忽略 */ }
            }
            if (rel && !/^([a-zA-Z]:|\/)/.test(rel)) {
                suggest({ filename: rel, conflictAction: 'uniquify' });
                return;
            }
        }
        // 防线 3：自己的下载却没记账（SW 重启丢账等极端情况）。item.filename 是绝对路径，
        // suggest 用不了，弃权让系统按默认名处理——降级兜底，正常流程不该走到这。
        if (by === me && item.filename) {
            const name = String(item.filename).replace(/\\/g, "/");
            if (name && !/^([a-zA-Z]:|\/)/.test(name)) {
                suggest({ filename: name, conflictAction: "uniquify" });
            }
        }
    });
} catch (e) {
    console.warn("[video-rod] onDeterminingFilename 注册失败", e);
}

/**
 * 监听 扩展 message 事件
 */
/**
 * 注入到 YouTube 页面主世界执行：取格式列表（带直链的那种）。
 *
 * 这段函数会被 chrome.scripting.executeScript 序列化后送到页面里跑，
 * 所以不能引用任何外层变量（只能用它自己的参数和页面全局）。
 *
 * 为什么要在页面里发而不是扩展进程里发：
 *   这条链的身份包含页面自己的 cookie 与 visitorData，换个上下文就变成
 *   「陌生第三方」，直接 UNPLAYABLE。
 *
 * 为什么按 MWEB → ANDROID → IOS → TVHTML5 依次试：
 *   实测（docs/YT-FEASIBILITY.md）九种客户端里只有 MWEB 稳定返回带 url 的
 *   adaptiveFormats，但 YouTube 的灰度是按客户端+地区+时间的，今天 MWEB 能用
 *   不代表明天；多试几种比写死一种活得更久。第一个返回了直链的就用它。
 */
function ytCollectFormats(videoId) {
    return (async function () {
        try {
            var cfg = window.ytcfg;
            if (!cfg || !cfg.get) {
                return { ok: false, error: '页面还没就绪（ytcfg 缺失），刷新一下再试' };
            }
            var key = cfg.get('INNERTUBE_API_KEY');
            var ctx = cfg.get('INNERTUBE_CONTEXT') || {};
            var visitor = (ctx.client || {}).visitorData || '';
            var webVer = (ctx.client || {}).clientVersion || '2.20261023.01.00';

            // [显示名, clientName, 数字 id, clientVersion]
            //
            // 2026-10 实测（docs/YT-CLIENT-STATUS.md）：MWEB 已经被关掉了——
            // 它现在统一回 UNPLAYABLE「The page needs to be reloaded」，不再是
            // 研究阶段那个「只有它活着」的状态。ANDROID/IOS 直接 400（版本过期），
            // TVHTML5 同样 UNPLAYABLE，ANDROID_VR 要登录验证。
            //
            // 现在稳定给直链的是 **VISIONOS**：32 条格式全部带 url、最高 2160p，
            // 且 URL 里**没有 n 参数**（不需要跑 sandbox 解密）。
            // 它排在第一位；后面几个是备用，YouTube 灰度随时会变，多留几个活得久。
            var clients = [
                ['VISIONOS', 'VISIONOS', '101', '0.1'],
                /* WEB 是最后的保底：它通常只给 SABR + 一个 360p 单文件直链，
                 * 但比「所有客户端都失败」强。高画质需要 SABR 复放，见 BACKLOG。 */
                ['WEB', 'WEB', '1', webVer],
                ['MWEB', 'MWEB', '2', webVer],
                ['TVHTML5', 'TVHTML5', '7', '7.20261023.00.00'],
                ['ANDROID', 'ANDROID', '3', '19.44.38'],
                ['IOS', 'IOS', '5', '19.45.4']
            ];

            var lastErr = '';
            var tried = [];          // 每个客户端的结果都留一条，别只留最后一个
            var json = null;

            for (var ci = 0; ci < clients.length; ci++) {
                var c = clients[ci];
                var clientObj = {
                    clientName: c[1],
                    clientVersion: c[3],
                    hl: 'en',
                    gl: 'US'
                };
                if (visitor) { clientObj.visitorData = visitor; }
                if (c[1] === 'ANDROID' || c[1] === 'IOS' || c[1] === 'ANDROID_VR') {
                    clientObj.androidSdkVersion = 34;
                    clientObj.osName = 'Android';
                    clientObj.osVersion = '14';
                }
                var headers = {
                    'Content-Type': 'application/json',
                    'X-Youtube-Client-Name': c[2],
                    'X-Youtube-Client-Version': c[3]
                };
                if (visitor) { headers['X-Goog-Visitor-Id'] = visitor; }
                try {
                    var resp = await fetch('/youtubei/v1/player?key=' +
                        encodeURIComponent(key) + '&prettyPrint=false', {
                        method: 'POST',
                        credentials: 'include',
                        headers: headers,
                        body: JSON.stringify({
                            context: {
                                client: clientObj,
                                user: { lockedSafetyMode: false },
                                request: { useSsl: true }
                            },
                            videoId: videoId,
                            contentCheckOk: true,
                            racyCheckOk: true
                        })
                    });
                    var j = await resp.json();
                    var ps = j.playabilityStatus || {};
                    if (ps.status !== 'OK') {
                        lastErr = c[0] + ' → ' + (ps.status || '?') + '：' + (ps.reason || '');
                        tried.push(lastErr);
                        continue;
                    }
                    var sd0 = j.streamingData || {};
                    /* adaptive 有直链最好；只有 progressive（常见于 WEB）也接受。
                     * 之前只认 adaptive，导致 WEB 明明有 360p 直链却被当成失败。 */
                    var hasAdaptiveUrl = (sd0.adaptiveFormats || []).some(function (f) { return !!f.url; });
                    var hasProgressUrl = (sd0.formats || []).some(function (f) { return !!f.url; });
                    if (!hasAdaptiveUrl && !hasProgressUrl) {
                        lastErr = c[0] + ' → 只有 SABR，没有直链';
                        tried.push(lastErr);
                        continue;
                    }
                    json = j;
                    break;
                } catch (e) {
                    lastErr = c[0] + ' → 请求异常：' + String((e && e.message) || e);
                    tried.push(lastErr);
                }
            }

            if (!json) {
                // 把失败分成两类，UI 才能给对的建议：
                //  · 视频本身不可播（unavailable / 私有 / 会员）→ 换视频，别让用户等
                //  · 客户端全被拒（限流/风控）→ 建议刷新、等几分钟
                var joined = tried.join(' ｜ ');
                var videoDead = /this video is unavailable|video unavailable|此视频不能观看|private|members-only|age/i
                    .test(joined);
                var loginNeeded = /LOGIN_REQUIRED|Sign in to confirm/i.test(joined);
                var code = videoDead ? 'YT_E_UNAVAILABLE' : (loginNeeded ? 'YT_E_LOGIN' : 'YT_E_BLOCKED');
                var hint = videoDead
                    ? '这个视频在 YouTube 侧本身不可播放（已下架/私有/地区或会员限制），换一个视频试试。'
                    : (loginNeeded
                        ? 'YouTube 要求「确认不是机器人」。保持已登录，刷新视频页后重试；仍失败时可先播放几秒再点下载。'
                        : 'YouTube 正在限制本机请求。刷新视频页、等几分钟，或确认已登录后再试。');
                var summary = videoDead
                    ? '视频不可播放'
                    : (loginNeeded ? 'YouTube 要求登录验证（风控）' : 'YouTube 限制了本机请求');
                try { console.warn('[video-rod] ytFormats 全部失败:', joined); } catch (e2) { /* 忽略 */ }
                return {
                    ok: false,
                    code: code,
                    error: summary,
                    detail: joined || lastErr || '所有客户端都拿不到直链',
                    tried: tried,
                    hint: hint
                };
            }

            var sd = json.streamingData || {};
            var progressive = sd.formats || [];
            var adaptive = sd.adaptiveFormats || [];
            var out = [];
            adaptive.concat(progressive).forEach(function (f) {
                if (!f.url) { return; }           // 没直链的（SABR-only）直接丢
                var mt = f.mimeType || '';
                out.push({
                    itag: f.itag,
                    mime: mt.split(';')[0],
                    codec: (mt.split('codecs="')[1] || '').split('"')[0],
                    height: f.height || 0,
                    width: f.width || 0,
                    fps: f.fps || 0,
                    bitrate: +f.bitrate || 0,
                    size: +f.contentLength || 0,
                    qualityLabel: f.qualityLabel || f.audioQuality || '',
                    audioQuality: f.audioQuality || '',
                    hasAudio: progressive.indexOf(f) >= 0,
                    url: f.url
                });
            });
            var pjs = cfg.get('PLAYER_JS_URL') || '';
            var m = String(pjs).match(/\/s\/player\/([^\/]+)\//);
            var vd = json.videoDetails || {};
            var limited = !out.some(function (f) { return !f.hasAudio && f.height; });
            return {
                ok: true,
                formats: out,
                title: vd.title || document.title,
                author: vd.author || '',
                durationSec: +vd.lengthSeconds || 0,
                playerId: m ? m[1] : '',
                /* 高画质轨只有 SABR 直链时，当前管线只能下 360p 单文件 */
                limited: limited,
                limitedReason: limited ? 'YouTube 当前只返回 360p 单文件直链（高画质走 SABR，暂不支持）' : ''
            };
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
        }
    })();
}


chrome.runtime.onMessage.addListener(function (Message, sender, sendResponse) {
    if (chrome.runtime.lastError) { return; }
    // 苏哥的钓鱼竿：下载文件名记账（popup/options 等页面经 vr-download-hook.js 转发）。
    // 必须放在 init 检查之前——SW 刚被消息唤醒时 init 标志可能还没就绪，
    // 而记账只碰内存 Map，不依赖任何初始化状态；漏记账 = 文件名被浏览器忽略。
    if (Message && Message.Message == "vrQueueName") {
        vrQueueFilename(Message.url, Message.filename, Message.conflictAction, Message.meta);
        sendResponse({ ok: true });
        return true;
    }
    /* 抖音图文页（/note/<id>）取原图列表。
     * 图文作品的照片是轮播 slide 的 CSS 背景图，页面上没有大 <img>，
     * 通用 DOM 扫描只能拿到容器尺寸、拿不到真身；真身在 React Fiber 里。
     * 这里主世界注入一次，把 images[]（无水印 urlList）取回来给页面浮层。 */
    if (Message && Message.Message == "vrXhsLive") {
        /* 调用方是扩展页（image.html 侧边栏），sender.tab 是**侧边栏自己**的 tab，
         * 不是目标网页 —— 必须用消息里显式传的 tabId。用错会让 probe 注入到
         * 扩展页上、拿不到任何 SSR state（2026-11-11 实测：rows 恒为空）。 */
        const liveTabId = (Number(Message.tabId) > 0)
            ? Number(Message.tabId)
            : (sender && sender.tab && sender.tab.id) || -1;
        vrXhsLiveProbe(liveTabId)
            .then(function (r) { sendResponse(r || { noteId: '', rows: [] }); })
            .catch(function (e) { sendResponse({ noteId: '', rows: [], error: String((e && e.message) || e) }); });
        return true;
    }
    if (Message && Message.Message == "vrDouyinImages") {
        vrDouyinImages(sender).then(function (r) { sendResponse(r); })
            .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
        return true;
    }
    // ---- M11 多段自动合并（直连管线版）----
    // popup 认组后发起（fire-and-forget，结果经 vrMergeProgress/Done/Error 异步回）
    if (Message && Message.Message == "vrMergeStart") {
        vrMergeStart(Message.taskId, Message.urls);
        return;
    }
    // 离屏文档：拼好了 / 拼错了 / 存完了 —— 转 popup 并维护 SW 侧状态
    if (Message && Message.Message == "vrMergeReady") {
        const task = vrMergeTasks[Message.taskId];
        if (task) {
            task.state = "ready";
            task.bytes = Message.bytes;
            task.ext = Message.ext;
            task.blobUrl = Message.blobUrl;   // 离屏上下文建的 blob URL，SW 负责落盘
        }
        // 对 popup 统一用 vrMergeDone（ready 是离屏→SW 的内部消息名）
        vrMergeNotify({ Message: 'vrMergeDone', taskId: Message.taskId, bytes: Message.bytes, ext: Message.ext });
        return;
    }
    if (Message && Message.Message == "vrMergeError") {
        // 来自离屏文档（SW 自己 vrMergeNotify 发的不会回投自身，无冲突）
        delete vrMergeTasks[Message.taskId];
        vrMergeNotify(Message);
        return;
    }
    // popup 点保存：SW 用 downloads 落盘（离屏文档没有 downloads 权限），
    // 走 vrDownloadWithName 保留「文件名保护」；完成后通知离屏释放 blob
    if (Message && Message.Message == "vrMergeSave") {
        const task = vrMergeTasks[Message.taskId];
        const filename = Message.filename;
        if (!task || !task.blobUrl) {
            vrMergeNotify({ Message: 'vrMergeSaved', taskId: Message.taskId, ok: false, error: '合并结果已不在（浏览器重启过？）' });
            return;
        }
        vrDownloadWithName(task.blobUrl, filename).then(function (id) {
            const ok = id !== null;
            if (ok) {
                delete vrMergeTasks[Message.taskId];
                vrMergeSendToOffscreen({ Message: 'vrMergeRevoke', taskId: Message.taskId });
            }
            vrMergeNotify({
                Message: 'vrMergeSaved', taskId: Message.taskId, ok: ok,
                error: ok ? null : String(chrome.runtime.lastError && chrome.runtime.lastError.message)
            });
        });
        return;
    }
    // popup 开机/重开时问：有没有拼好等保存的活
    if (Message && Message.Message == "vrMergeStatus") {
        const list = Object.keys(vrMergeTasks).map(function (id) {
            const t = vrMergeTasks[id];
            return { taskId: id, state: t.state, bytes: t.bytes || 0, ext: t.ext || "mp4", urls: t.urls };
        });
        sendResponse({ tasks: list });
        return true;
    }
    // YouTube 后台合并进度：工作页 → 原 YouTube 标签右下角浮层
    if (Message && Message.Message === 'vrYtProgress') {
        const tid = Number(Message.tabId || 0);
        if (tid) {
            try {
                chrome.tabs.sendMessage(tid, {
                    Message: 'vrYtProgress',
                    text: Message.text || '', pct: Message.pct,
                    done: !!Message.done, kind: Message.kind || '',
                    /* busy 原样转发：浮层靠它决定是否显示「取消下载」——
                     * 只靠 pct 会漏掉「准备链路…」这种没有百分比的阶段。 */
                    busy: !!Message.busy
                }, function () { void chrome.runtime.lastError; });
            } catch (e) { /* 原标签已关就算了 */ }
        }
        /* 自动下载页广播 done 后关闭它自己（页面发来的 vrYtClose 在部分 Chrome
         * 版本会被忽略；这里按 sender.tab 关闭，保证“无感”）。
         * 同时释放串行队列：YouTube 同一时间只跑一个任务。 */
        try {
            const st = sender && sender.tab;
            if (Message.done && st && /yt-download\.html/.test(st.url || '') && /auto=1/.test(st.url || '')) {
                setTimeout(function () { try { chrome.tabs.remove(st.id); } catch (e) { /* ignore */ } }, 1200);
                vrYtRelease(st.id);
            }
        } catch (e) { /* ignore */ }
        sendResponse({ ok: true });
        return true;
    }
    // YouTube 后台页完成后关闭自身（window.close 对 chrome.tabs.create 的扩展页不可靠）
    if (Message && Message.Message === 'vrYtClose') {
        const tid = sender && sender.tab && sender.tab.id;
        if (tid) { try { chrome.tabs.remove(tid); } catch (e) { /* ignore */ } }
        sendResponse({ ok: true });
        return true;
    }
    // YouTube：取消正在跑的下载（来源：YouTube 页面右下角浮层的「取消」）
    //
    // 2026-11-08 苏哥反馈「下载没有终止按钮」，一个 15GB 的任务点下去只能等。
    // 这里把取消指令转给正在跑的下载页（vrYtQueueTabId），由页面 abort 所有 fetch。
    //
    // 顺序很重要：**先通知下载页、再释放队列位**。
    // 反过来的话，下一个排队任务会在当前连接还没断开时就启动，两条大流量并存。
    if (Message && Message.Message === 'vrYtCancel') {
        const target = vrYtQueueTabId;
        const done = function (cancelled) {
            /* 无论页面有没有回执，都要释放队列，否则下一个任务永远排队。
             * vrYtRelease 内部有 600ms 延迟，给 abort 收尾留出时间。 */
            vrYtRelease(target);
            try {
                sendResponse({
                    ok: true,
                    cancelled: !!cancelled,
                    tabId: target,
                    queue: vrYtQ.status()
                });
            } catch (e) { /* 调用方已关 */ }
        };
        if (target == null) {
            /* 没有在跑的下载页：可能已经结束或被关了，直接告诉调用方 */
            done(false);
            return true;
        }
        try {
            chrome.tabs.sendMessage(target, { Message: 'vrYtCancel' }, function (res) {
                void chrome.runtime.lastError;
                done(!!(res && res.ok));
            });
        } catch (e) {
            done(false);
        }
        return true;
    }
    // YouTube：用户在页面浮层选定了某个清晰度（来源：vrYtOptions 渲染出的按钮）
    //
    // 2026-11-08：不再由下载页擅自挑最高档（曾经在 91vZf7QNTpE 上直接拉 15.66GB），
    // 改为把档位交给用户，选完再转给下载页点选 + 开始。
    if (Message && Message.Message === 'vrYtChoose') {
        const target = vrYtQueueTabId;
        const key = String(Message.key || '');
        if (target == null || !key) {
            sendResponse({ ok: false, reason: target == null ? 'no-active-download' : 'no-key' });
            return true;
        }
        try {
            chrome.tabs.sendMessage(target, {
                Message: 'vrYtChoose',
                key: key,
                start: Message.start !== false
            }, function (res) {
                void chrome.runtime.lastError;
                sendResponse({
                    ok: !!(res && res.ok),
                    key: key,
                    reason: (res && res.ok) ? '' : 'download-page-rejected'
                });
            });
        } catch (e) {
            sendResponse({ ok: false, reason: 'send-failed' });
        }
        return true;
    }
    // YouTube：页面浮层要档位列表（打开浮层/切视频后主动拉一次）
    if (Message && Message.Message === 'vrYtRequestOptions') {
        const target = vrYtQueueTabId;
        if (target == null) {
            sendResponse({ ok: false, reason: 'no-active-download', options: [] });
            return true;
        }
        try {
            chrome.tabs.sendMessage(target, { Message: 'vrYtRequestOptions' }, function (res) {
                void chrome.runtime.lastError;
                sendResponse(res || { ok: false, options: [] });
            });
        } catch (e) {
            sendResponse({ ok: false, reason: 'send-failed', options: [] });
        }
        return true;
    }
    // YouTube：下载页把档位列表（含体积）广播给原页面
    if (Message && Message.Message === 'vrYtOptions') {
        const tid = Number(Message.tabId || 0);
        if (tid) {
            try {
                chrome.tabs.sendMessage(tid, {
                    Message: 'vrYtOptions',
                    title: Message.title || '',
                    author: Message.author || '',
                    duration: Message.duration || 0,
                    options: Array.isArray(Message.options) ? Message.options : []
                }, function () { void chrome.runtime.lastError; });
            } catch (e) { /* 原标签已关就算了 */ }
        }
        sendResponse({ ok: true });
        return true;
    }
    // YouTube：页面按钮点击 → 开下载窗口（单开小窗的理由见 js/yt/yt-download.js 抬头注释）
    if (Message && Message.Message === 'ytOpen') {
        /* 串行队列：同一时间只跑一个 YouTube 下载。
         *
         * 2026-11-08 苏哥要求：YouTube 不允许同时下多个，要排队。
         * 原因有两层：
         *   ① 多个 4K 任务并发会互相抢带宽，每个都变得极慢；
         *   ② 同时对 googlevideo 发起多条大流量连接更容易触发限流。
         *
         * 实现：SW 内一个内存队列 + 当前任务 id。前一个任务结束（收到
         * vrYtClose 或标签页关闭）后自动启动下一个。
         * SW 被回收时队列会丢 —— 这是可接受的：用户重开页面会重新入队，
         * 而持久化队列会让「幽灵任务」永久卡住队列，得不偿失。 */
        const job = {
            videoId: Message.videoId || '',
            tabId: (sender.tab && sender.tab.id) || 0,
            title: Message.title || '',
            author: Message.author || '',
            authorId: Message.authorId || '',
            pageUrl: Message.pageUrl || ''
        };
        if (!job.videoId) {
            sendResponse({ ok: false, error: 'no-video-id' });
            return true;
        }
        /* 入队：去重、串行、结束放行的语义都在 js/yt/yt-queue.js 里 */
        const r = vrYtQ.push(job);
        sendResponse({
            ok: r.ok !== false,
            reason: r.reason,
            queued: r.queued,
            position: r.position,
            active: vrYtQ.status().active
        });
        return true;
    }
    if (Message && Message.Message === 'ytQueueStatus') {
        const st = vrYtQ.status();
        sendResponse({ ok: true, active: st.active, queued: st.queued, list: st.list });
        return true;
    }
    if (Message && Message.Message === 'ytOpenOld') {
        var ytUrl = chrome.runtime.getURL('js/yt/yt-download.html') +
            '?videoId=' + encodeURIComponent(Message.videoId || '') +
            '&tabId=' + encodeURIComponent(String((sender.tab && sender.tab.id) || 0)) +
            '&title=' + encodeURIComponent(Message.title || '') +
            '&author=' + encodeURIComponent(Message.author || '') +
            '&authorId=' + encodeURIComponent(Message.authorId || '') +
            '&pageUrl=' + encodeURIComponent(Message.pageUrl || '');
        /* 苏哥 2026-11-05：不要弹出那个下载窗口。改成后台标签（不抢焦点），
         * 页面自己选最高画质、后台合并音视频，进度广播回原页面右下角。 */
        ytUrl += '&auto=1';
        chrome.tabs.create({ url: ytUrl, active: false }, function (t) {
            if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                return;
            }
            sendResponse({ ok: true, tabId: t && t.id });
        });
        return true;
    }
    // YouTube：在目标页主世界里同源取格式。
    // 必须在页面里发（不是扩展进程）：MWEB 这条链的身份包括页面自己的 cookie 与
    // visitorData，换个上下文就变成「陌生第三方」，直接 UNPLAYABLE。实测结论见
    // docs/YT-FEASIBILITY.md 第二节。
    if (Message && Message.Message === 'ytFormats') {
        var ytTabId = parseInt(Message.tabId, 10) || 0;
        if (!ytTabId) {
            sendResponse({ ok: false, error: '拿不到标签页 ID（页面可能已关闭）' });
            return true;
        }
        /* 后台标签页会被 Chrome 冻结（frozen）；对冻结页 executeScript 会一直不回调。
         * 用户遇到的表现就是「取格式失败」或一直转圈。这里先探状态：
         * 冻结/丢弃就先 reload 唤醒，再注入；同时给注入加超时，绝不让 UI 无限等。 */
        var responded = false;
        var sendOnce = function (x) { if (!responded) { responded = true; sendResponse(x); } };
        var best = null;          // 保留「只有 360p」的可用结果，重试失败时回退
        var retriedQuality = false;
        var finish = function (r) {
            if (r && r.ok) { best = r; }
            /* 只拿到 progressive 360p，或被风控拒绝：刷新一次页面再试。
             * 实测刷新后 visitorData / 会话更新，VISIONOS 会重新给出 1080p 直链。 */
            var needRetry = !retriedQuality && r && (
                (r.ok && r.limited) ||
                (!r.ok && (r.code === 'YT_E_LOGIN' || r.code === 'YT_E_BLOCKED'))
            );
            if (needRetry) {
                retriedQuality = true;
                chrome.tabs.reload(ytTabId, {}, function () {
                    if (chrome.runtime.lastError) { sendOnce(best || r); return; }
                    setTimeout(runInject, 3500);
                });
                return;
            }
            sendOnce(best || r || { ok: false, error: '页面没有返回数据' });
        };
        var runInject = function () {
            var timer = setTimeout(function () {
                if (best) { sendOnce(best); return; }
                sendOnce({
                    ok: false, code: 'YT_E_TIMEOUT',
                    error: 'YouTube 页面无响应（可能被浏览器冻结）',
                    hint: '切到 YouTube 标签页刷新一下，再回来点下载。'
                });
            }, 20000);
            try {
                chrome.scripting.executeScript({
                    target: { tabId: ytTabId },
                    world: 'MAIN',
                    func: ytCollectFormats,
                    args: [String(Message.videoId || '')]
                }, function (res) {
                    clearTimeout(timer);
                    if (chrome.runtime.lastError) {
                        finish({ ok: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    finish(res && res[0] && res[0].result || { ok: false, error: '页面没有返回数据' });
                });
            } catch (e) {
                clearTimeout(timer);
                finish({ ok: false, error: String((e && e.message) || e) });
            }
        };
        chrome.tabs.get(ytTabId, function (t) {
            if (chrome.runtime.lastError || !t) {
                sendOnce({ ok: false, error: 'YouTube 标签页已关闭，请重新打开视频页' });
                return;
            }
            if (t.frozen || t.discarded) {
                chrome.tabs.reload(ytTabId, {}, function () {
                    if (chrome.runtime.lastError) {
                        sendOnce({ ok: false, error: 'YouTube 页面被浏览器冻结，请切到该标签页刷新后重试' });
                        return;
                    }
                    setTimeout(runInject, 2500);
                });
            } else {
                runInject();
            }
        });
        return true;
    }
    // 资源库：入库查询/预登记（由 sw-library.js 处理）
    if (Message && String(Message.Message || '').indexOf('vrLib.') === 0 && self.VRLib) {
        try {
            self.VRLib.handleMessage(Message, sendResponse);
            return true;
        } catch (e) {
            sendResponse({ ok: false, code: 'LIB_E_SW', message: String(e) });
            return true;
        }
    }
    // 图片悬停下载（I1/I2）：同样放在 init 检查之前——SW 冷启动时消息可能先到。
    // 内容脚本同时带 Message 与 action，兼容两套命名。
    if (Message && (Message.Message === 'vrImg.resolve' || Message.action === 'vrImg.resolve')) {
        vrImgResolve(Message).then(function (res) {
            sendResponse(res);
        }).catch(function (e) {
            sendResponse({ ok: false, url: '', tried: 0, fallback: true, code: 'IMG_E_FETCH', message: String(e) });
        });
        return true;
    }
    if (Message && (Message.Message === 'vrImg.download' || Message.action === 'vrImg.download')) {
        (async function () {
            try {
                const res = await vrImgDownload(Message);
                /* 实况图：静态图存好后，把那段 2~3 秒的实况一起下（2026-11-11，B-71）。
                 *
                 * 只放在后台这一个入口，不在每个调用方各写一遍 —— 侧边栏、大图预览、
                 * 面板、拖拽入库四条路都发同一条消息，后台做一次就全覆盖。 */
                if (res && res.ok && Message.liveUrl) {
                    try {
                        const v = await vrImgDownload({
                            url: String(Message.liveUrl),
                            candidates: Array.isArray(Message.liveCandidates) && Message.liveCandidates.length
                                ? Message.liveCandidates : [String(Message.liveUrl)],
                            title: String(Message.title || '') + '_live',
                            pageUrl: Message.pageUrl,
                            siteName: Message.siteName,
                            tabId: Message.tabId,
                            authorFull: Message.authorFull,
                            creatorId: Message.creatorId,
                            contentType: Message.liveContentType || ''
                        });
                        /* 实况失败不回滚静态图，但要把原因带回给调用方，别静默 */
                        res.video = v && v.ok
                            ? { ok: true, skipped: !!v.skipped, path: v.path || '' }
                            : { ok: false, message: (v && v.message) || '实况视频没下来' };
                    } catch (e2) {
                        res.video = { ok: false, message: String((e2 && e2.message) || e2) };
                    }
                }
                sendResponse(res);
            } catch (e) {
                sendResponse({ ok: false, code: 'IMG_E_FETCH', message: String(e) });
            }
        })();
        return true;
    }
    // 图片批量下载（I3）：并发池 + 进度广播 + 可取消
    /* 历史条目补算内容指纹（库页「扫描重复」整理前调用）。
     * 只能在 SW 跑：只有它能读本地文件算 SHA-256。删文件则相反 ——
     * 必须由库页用 FSA 句柄删，所以这里只做「算」，不碰任何文件。 */
    if (Message && (Message.Message === 'vrDedup.hashMissing' || Message.action === 'vrDedup.hashMissing')) {
        (async function () {
            try {
                if (!self.VRDedup || typeof self.VRDedup.hashMissing !== 'function') {
                    sendResponse({ ok: false, message: '去重模块未加载', hashed: 0 });
                    return;
                }
                const r = await self.VRDedup.hashMissing({ maxHash: Number(Message.maxHash) || 500 });
                sendResponse(Object.assign({ ok: true }, r));
            } catch (e) {
                sendResponse({ ok: false, message: String((e && e.message) || e), hashed: 0 });
            }
        })();
        return true;
    }
    if (Message && (Message.Message === 'vrImg.batch' || Message.action === 'vrImg.batch')) {
        vrImgBatch(Message, sender).then(function (res) {
            sendResponse(res);
        }).catch(function (e) {
            sendResponse({ ok: false, code: 'IMG_E_FETCH', message: String(e), ok: 0, fail: 0 });
        });
        return true;
    }
    if (Message && (Message.Message === 'vrImg.batchCancel' || Message.action === 'vrImg.batchCancel')) {
        vrImgBatchCancel(Message);
        sendResponse({ ok: true, canceled: true });
        return true;
    }
    /* 站点名探测：输入域名 → 后台抓网页 → 解析站名。
     * 走后台而不是设置页，是因为扩展页面的跨域 fetch 受 CORS 限制，
     * 而 SW 有 host_permissions（*://*&#47;*）授权。 */
    if (Message && (Message.Message === 'vrSiteName.probe' || Message.action === 'vrSiteName.probe')) {
        vrSiteNameProbe(Message).then(function (res) {
            sendResponse(res);
        }).catch(function (e) {
            sendResponse({ ok: false, message: String(e), name: '', host: '' });
        });
        return true;
    }
    // 图集扫描（I6 模式 A）：长任务，状态落 storage.session；滚动由 executeScript 到目标标签页
    if (Message && (Message.Message === 'vrImg.albumScan' || Message.action === 'vrImg.albumScan')) {
        const scanTabId = parseInt(Message.tabId, 10) || (sender && sender.tab ? sender.tab.id : 0);
        vrAlbumScan(Message, scanTabId).then(function (res) {
            sendResponse(res);
        }).catch(function (e) {
            sendResponse({ ok: false, code: 'IMG_E_FETCH', message: String(e) });
        });
        return true;
    }
    if (Message && (Message.Message === 'vrImg.albumProgress' || Message.action === 'vrImg.albumProgress')) {
        vrAlbumProgress(Message).then(function (res) {
            sendResponse(res);
        }).catch(function (e) {
            sendResponse({ ok: false, code: 'IMG_E_FETCH', message: String(e) });
        });
        return true;
    }
    if (Message && (Message.Message === 'vrImg.albumStop' || Message.action === 'vrImg.albumStop')) {
        vrAlbumStop(Message).then(function (res) {
            sendResponse(res);
        }).catch(function (e) {
            sendResponse({ ok: false, code: 'IMG_E_FETCH', message: String(e) });
        });
        return true;
    }
    /* 侧边栏路径切换：image.html（图片清单） ↔ popup.html（嗅探列表）。
     * 必须按 tabId 设 setOptions——不设 tabId 会覆盖整个窗口的默认路径。 */
    if (Message && (Message.Message === 'vrImg.sidePanelPath' || Message.action === 'vrImg.sidePanelPath')) {
        const targetTab = parseInt(Message.tabId, 10) || (sender && sender.tab ? sender.tab.id : 0);
        const path = String(Message.path || 'image.html');
        try {
            if (chrome.sidePanel && chrome.sidePanel.setOptions) {
                const opts = { path: path + (targetTab > 0 ? '?tabId=' + targetTab : '') };
                if (targetTab > 0) { opts.tabId = targetTab; }
                chrome.sidePanel.setOptions(opts);
            }
        } catch (e) { /* 无侧边栏 API 时忽略 */ }
        if (Message.open) {
            try {
                const openOpts = {};
                if (Message.windowId) { openOpts.windowId = Message.windowId; }
                else if (targetTab > 0) { openOpts.tabId = targetTab; }
                chrome.sidePanel.open(openOpts).catch(function () { /* 需用户手势，失败正常 */ });
            } catch (e) { /* 忽略 */ }
        }
        sendResponse({ ok: true, path: path, tabId: targetTab });
        return true;
    }
    if (!G.initLocalComplete || !G.initSyncComplete) {
        sendResponse("error");
        return true;
    }
    // 以下检查是否有 tabId 不存在使用当前标签
    Message.tabId = Message.tabId ?? G.tabId;

    // 从缓存中保存数据到本地
    if (Message.Message == "pushData") {
        (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData });
        sendResponse("ok");
        return true;
    }
    // 获取所有数据
    if (Message.Message == "getAllData") {
        sendResponse(cacheData);
        return true;
    }
    /**
     * 设置扩展图标数字
     * 提供 type 删除标签为 tabId 的数字
     * 不提供type 删除所有标签的数字
     */
    if (Message.Message == "ClearIcon") {
        Message.type ? SetIcon({ tabId: Message.tabId }) : SetIcon();
        sendResponse("ok");
        return true;
    }
    // 启用/禁用扩展
    if (Message.Message == "enable") {
        G.enable = !G.enable;
        chrome.storage.sync.set({ enable: G.enable });
        chrome.action.setIcon({ path: G.enable ? "/img/icon.png" : "/img/icon-disable.png" });
        sendResponse(G.enable);
        return true;
    }
    /**
     * 提供requestId数组 获取指定的数据
     */
    if (Message.Message == "getData" && Message.requestId) {
        // 判断Message.requestId是否数组
        if (!Array.isArray(Message.requestId)) {
            Message.requestId = [Message.requestId];
        }
        const response = [];
        if (Message.requestId.length) {
            for (let item in cacheData) {
                for (let data of cacheData[item]) {
                    if (Message.requestId.includes(data.requestId)) {
                        response.push(data);
                    }
                }
            }
        }
        sendResponse(response.length ? response : "error");
        return true;
    }
    /**
     * 提供 tabId 获取该标签数据
     */
    if (Message.Message == "getData") {
        sendResponse(cacheData[Message.tabId]);
        return true;
    }
    /**
     * 获取各按钮状态
     * 模拟手机 自动下载 启用 以及各种脚本状态
     */
    if (Message.Message == "getButtonState") {
        let state = {
            MobileUserAgent: G.featMobileTabId.has(Message.tabId),
            AutoDown: G.featAutoDownTabId.has(Message.tabId),
            enable: G.enable,
        }
        G.scriptList.forEach(function (item, key) {
            state[item.key] = item.tabId.has(Message.tabId);
        });
        sendResponse(state);
        return true;
    }
    // 对tabId的标签 进行模拟手机操作
    if (Message.Message == "mobileUserAgent") {
        mobileUserAgent(Message.tabId, !G.featMobileTabId.has(Message.tabId));
        chrome.tabs.reload(Message.tabId, { bypassCache: true });
        sendResponse("ok");
        return true;
    }
    // 对tabId的标签 开启 关闭 自动下载
    if (Message.Message == "autoDown") {
        if (G.featAutoDownTabId.has(Message.tabId)) {
            G.featAutoDownTabId.delete(Message.tabId);
        } else {
            G.featAutoDownTabId.add(Message.tabId);
        }
        (chrome.storage.session ?? chrome.storage.local).set({ featAutoDownTabId: Array.from(G.featAutoDownTabId) });
        sendResponse("ok");
        return true;
    }
    // 对tabId的标签 脚本注入或删除
    if (Message.Message == "script") {
        if (G.damn && G.damnUrlSet.has(Message.tabId)) {
            return;
        }
        if (!G.scriptList.has(Message.script)) {
            sendResponse("error no exists");
            return false;
        }
        const script = G.scriptList.get(Message.script);
        const scriptTabid = script.tabId;
        const refresh = Message.refresh ?? script.refresh;
        if (scriptTabid.has(Message.tabId)) {
            scriptTabid.delete(Message.tabId);
            if (Message.script == "search.js") {
                G.deepSearchTemporarilyClose = Message.tabId;
            }
            refresh && chrome.tabs.reload(Message.tabId, { bypassCache: true });
            sendResponse("ok");
            return true;
        }
        scriptTabid.add(Message.tabId);
        if (refresh) {
            chrome.tabs.reload(Message.tabId, { bypassCache: true });
        } else {
            const files = [`catch-script/${Message.script}`];
            script.i18n && files.unshift("catch-script/i18n.js");
            chrome.scripting.executeScript({
                target: { tabId: Message.tabId, allFrames: script.allFrames },
                files: files,
                injectImmediately: true,
                world: script.world
            });
        }
        sendResponse("ok");
        return true;
    }
    // 脚本注入 脚本申请多语言文件
    if (Message.Message == "scriptI18n") {
        chrome.scripting.executeScript({
            target: { tabId: Message.tabId, allFrames: true },
            files: ["catch-script/i18n.js"],
            injectImmediately: true,
            world: "MAIN"
        });
        sendResponse("ok");
        return true;
    }
    // Heart Beat
    if (Message.Message == "HeartBeat") {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0] && tabs[0].id) {
                G.tabId = tabs[0].id;
            }
        });
        sendResponse("HeartBeat OK");
        return true;
    }
    // 苏哥的钓鱼竿：X(推特) 推文内联按钮下载（M8），js/x-button.js 发起
    // 钓鱼竿：页内视频悬浮按钮（ADR-030），js/video-overlay.js 发起
    if (Message.Message == "vrVideoOptions") {
        const tabId = (sender && sender.tab && sender.tab.id != null)
            ? sender.tab.id : (Message.tabId != null ? Message.tabId : G.tabId);
        /* frameId 来自注入点：按钮挂在 iframe 里时，要按那个 frame 去找「正在播的」 */
        const fId = (sender && sender.frameId != null) ? sender.frameId : Message.frameId;
        vrVideoOptions(tabId, fId).then(function (r) {
            sendResponse({ ok: true, site: r.site, options: r.options });
        }).catch(function (e) {
            sendResponse({ ok: false, reason: String(e).slice(0, 120) });
        });
        return true;
    }
    /* ================= 纯静态下载站：直接按 URL 下 =================
     * 什么时候用：页面里压根没有 <video>（下载站、老站、网盘直链），
     * 悬浮键挂不出来、嗅探也抓不到 —— 但页面上明明有 <a href="xxx.mp4">。
     * Download Master 就是靠「扫所有链接甩给用户」做到「全站可下」的，
     * 我们补上这一环，但只作为**最后一条路**：有视频元素时不启用。
     */
    if (Message.Message == "vrScanLinks") {
        const tabId = (sender && sender.tab && sender.tab.id != null)
            ? sender.tab.id : (Message.tabId != null ? Message.tabId : G.tabId);
        vrScanMediaLinks(tabId).then(function (r) { sendResponse(r); })
            .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
        return true;
    }
    if (Message.Message == "vrLinkDownload") {
        const tabId = (sender && sender.tab && sender.tab.id != null)
            ? sender.tab.id : (Message.tabId != null ? Message.tabId : G.tabId);
        vrLinkDownload(tabId, Message.url || '', Message.pageUrl || '').then(function (r) {
            sendResponse(r);
        }).catch(function (e) {
            sendResponse({ ok: false, error: String((e && e.message) || e) });
        });
        return true;
    }
    if (Message.Message == "vrVideoDownload") {
        const tabId = (sender && sender.tab && sender.tab.id != null)
            ? sender.tab.id : (Message.tabId != null ? Message.tabId : G.tabId);
        const fId = (sender && sender.frameId != null) ? sender.frameId : Message.frameId;
        vrVideoDownload(tabId, Message.optionId, Message.wantBest !== false, fId, Message.meta || null)
            .then(function (r) {
                // 诊断：把「有几个可选源 / 选了哪个 / 结果」记一条到 storage。
                // 用户反馈「点了没反应」时，先看这条就知道是没源、还是下载被拒。
                try {
                    vrVideoOptions(tabId).then(function (o) {
                        const opts = (o && o.options) || [];
                        chrome.storage.local.set({
                            vrLastVideoDown: {
                                at: Date.now(),
                                ok: !!(r && r.ok),
                                reason: (r && r.reason) || '',
                                site: (o && o.site) || '',
                                options: opts.length,
                                top: String((opts[0] && opts[0].url) || '').slice(0, 220)
                            }
                        });
                    }).catch(function () { });
                } catch (e) { /* 诊断失败不影响下载 */ }
                sendResponse(r);
            })
            .catch(function (e) {
                sendResponse({ ok: false, reason: String(e).slice(0, 120) });
            });
        return true;
    }
    // 钓鱼竿：主页半手动批量下载（ADR-033），js/bulk-profile.js 发起
    if (Message.Message == "vrBulkDownload") {
        const tabId = (sender && sender.tab && sender.tab.id != null) ? sender.tab.id : null;
        vrBulkDownload(Message.items || [], tabId)
            .then(function (r) { sendResponse(r); })
            .catch(function (e) {
                sendResponse({ ok: false, reason: String(e).slice(0, 120) });
            });
        return true;
    }
    // 钓鱼竿：小红书详情页单篇（A 方案），只读当前笔记 state，不自动翻页
    if (Message.Message == "vrXhsScan") {
        /* popup 是扩展页，sender.tab 恒空 —— 必须允许调用方显式传 tabId，
         * 否则 popup 侧永远拿不到 state（2026-11-08 对抗性审计 M-1 实证）。 */
        const tabId = (typeof Message.tabId === 'number' && Message.tabId > 0)
            ? Message.tabId
            : (sender && sender.tab ? sender.tab.id : null);
        if (tabId == null) { sendResponse({ ok: false, reason: 'no-tab' }); return true; }
        /* 单篇扫描必须带重试：页面 __INITIAL_STATE__ 是异步填的，
         * 目标笔记的 .note 一开始往往是空对象 {}。只调一次就返回的话，
         * 用户点下载的瞬间恰好早于填充完成 —— 直接失败（「有时成功有时不行」）。
         * vrXhsScanInTab 已有 ~8 秒的轮询重试，这里复用它，
         * 与自动补全走同一条路径，行为一致。 */
        vrXhsScanInTab(tabId, Message.noteId || '').then(function (res) {
            sendResponse(res || { ok: false, reason: 'no-result' });
        }).catch(function (e) {
            sendResponse({ ok: false, reason: String(e).slice(0, 120) });
        });
        return true;
    }
    // 钓鱼竿：小红书主页/收藏/点赞收集后，可选「自动补全详情」（默认关闭）
    if (Message.Message == "vrXhsAuto") {
        const sourceTabId = sender && sender.tab ? sender.tab.id : null;
        vrXhsAutoQueue(Message.notes || [], sourceTabId)
            .then(function (r) { sendResponse(r); })
            .catch(function (e) {
                sendResponse({ ok: false, reason: String(e).slice(0, 120) });
            });
        return true;
    }
    // 钓鱼竿：Instagram 单帖/Reel 已加载媒体（P1）
    if (Message.Message == "vrIgDownload") {
        const items = Array.isArray(Message.items) ? Message.items : [];
        (async () => {
            let done = 0, failed = 0;
            const safe = s => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
            for (const it of items) {
                const url = it && it.url;
                if (!url || !/^https?:/i.test(url)) { failed++; continue; }
                try {
                    const dupe = await vrFindExistingMedia({ site: 'instagram', kind: it.kind || 'image', url: url, pageUrl: 'https://www.instagram.com/' });
                    if (dupe) { done++; continue; }
                } catch (e) { /* 查重失败不阻断下载 */ }
                const kindDir = it.kind === 'video' ? 'videos' : 'images';
                const author = safe(it.author || 'instagram') || 'instagram';
                const base = safe(it.filename || ('ig_' + (it.index + 1))) || ('ig_' + (it.index + 1));
                const ext = safe(it.ext || (it.kind === 'video' ? 'mp4' : 'jpg')).replace(/^\./, '') || 'jpg';
                const fname = 'video-rod/instagram/' + author + '/' + kindDir + '/' + base + '.' + ext;
                try {
                    await vrSetMediaHeadersFor(url, 'https://www.instagram.com/');
                    const id = await vrDownloadWithName(url, fname);
                    if (id === null) { failed++; continue; }
                    const outcome = await vrWaitDownload(id, 20000);
                    if (outcome && outcome.state === 'interrupted') {
                        try { vrDropDownload(id); } catch (e) { /* ignore */ }
                        failed++;
                    } else {
                        done++;
                    }
                } catch (e) { failed++; }
                await vrBulkSleep(1200 + Math.floor(Math.random() * 800));
            }
            sendResponse({ ok: true, total: items.length, done: done, failed: failed });
        })();
        return true;
    }
    // 钓鱼竿：X 主页批量里视频是 blob，内容脚本按推文坐标来解析直链
    if (Message.Message == "vrResolveX") {
        fetchXVideo(Message.user, Message.statusId, Message.mediaId, true)
            .then(function (url) { sendResponse({ ok: !!url, url: url || '' }); })
            .catch(function (e) {
                sendResponse({ ok: false, reason: String(e).slice(0, 120) });
            });
        return true;
    }
    // 取 X 的「已合并音视频」完整 MP4 直链 → 直接下载。不下载分片、不合成、不走在线 FFmpeg。
    // 页面只传 user/statusId/mediaId 和文件名，直链由后台查——页面无法借道下载任意地址。
    if (Message.Message == "vrQuickDownX") {
        const tabId = sender && sender.tab ? sender.tab.id : G.tabId;
        (async () => {
            /* 站名：x-button 在页面内已取到，落库供以后重扫/迁移（无 DOM）复用。
             * 失败不影响下载本身。 */
            try {
                await vrResolveSiteName({
                    pageUrl: Message.pageUrl || 'https://x.com/',
                    siteName: Message.siteName || '',
                    tabId: tabId
                });
            } catch (e) { /* ignore */ }
            try {
                const url = await fetchXVideo(
                    Message.user, Message.statusId, Message.mediaId, Message.wantBest !== false);
                if (!url) {
                    sendResponse({ ok: false, reason: "no-mp4", tabId: tabId });
                    return;
                }
                const ext = (url.split("?")[0].split(".").pop() || "mp4").toLowerCase();
                const fname = (Message.filename || "")
                    .replace(/\.(mp4|m4v|webm|mov)$/i, "") + "." + ext;
                const dedupKey = vrMediaIdentity({
                    site: 'x', statusId: Message.statusId,
                    mediaId: Message.mediaId || '', url: url, kind: 'video'
                });
                const seen = await vrDedupLoad();
                if (dedupKey && seen.has(dedupKey)) {
                    sendResponse({ ok: true, skipped: true, kind: 'mp4' });
                    return;
                }
                vrDownloadWithName(url, fname).then(function (id) {
                    // FSA 直写成功返回 {__fsa,path}，不是 null —— 只有真 null 才算失败
                    if (id === null || id === undefined) {
                        console.warn("[video-rod] X按钮下载失败", chrome.runtime.lastError);
                    } else {
                        if (dedupKey) { seen.add(dedupKey); vrDedupSave(seen); }
                        vrMarkDownloaded(fname);
                    }
                });
                sendResponse({ ok: true, kind: "mp4", url: url.slice(0, 120) });
            } catch (e) {
                sendResponse({ ok: false, reason: "api-fail", detail: String(e).slice(0, 80) });
            }
        })();
        return true;
    }
    // 清理数据
    if (Message.Message == "clearData") {
        // 当前标签
        if (Message.type) {
            delete cacheData[Message.tabId];
            (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData });
            clearRedundant();
            sendResponse("OK");
            return true;
        }
        // 其他标签
        for (let item in cacheData) {
            if (item == Message.tabId) { continue; }
            delete cacheData[item];
        }
        (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData });
        clearRedundant();
        sendResponse("OK");
        return true;
    }
    // 清理冗余数据
    if (Message.Message == "clearRedundant") {
        clearRedundant();
        sendResponse("OK");
        return true;
    }
    // 从 content-script 或 catch-script 传来的媒体url
    if (Message.Message == "addMedia") {
        /* 优先用发送方所在 tab：net-sniff 现在也跑在 iframe 里（MSN/新闻站的
         * 播放器都在 iframe），此时 href 是 **iframe 的 URL**，
         * 拿它去 tabs.query 里比对永远匹配不到 → 会落到「当前激活 tab」。
         * 用户切到别的标签之后，挖到的地址就归错页了。 */
        const senderTabId = sender && sender.tab && sender.tab.id;
        if (senderTabId != null && senderTabId >= 0) {
            findMedia({
                url: Message.url, tabId: senderTabId, extraExt: Message.extraExt,
                mime: Message.mime, requestId: Message.requestId,
                requestHeaders: Message.requestHeaders, initiator: Message.href
            }, true, true);
            sendResponse("ok");
            return true;
        }
        chrome.tabs.query({}, function (tabs) {
            for (let item of tabs) {
                if (item.url == Message.href) {
                    findMedia({ url: Message.url, tabId: item.id, extraExt: Message.extraExt, mime: Message.mime, requestId: Message.requestId, requestHeaders: Message.requestHeaders }, true, true);
                    return true;
                }
            }
            findMedia({ url: Message.url, tabId: -1, extraExt: Message.extraExt, mime: Message.mime, requestId: Message.requestId, initiator: Message.href, requestHeaders: Message.requestHeaders }, true, true);
        });
        sendResponse("ok");
        return true;
    }
    // ffmpeg网页通信
    if (Message.Message == "catCatchFFmpeg") {
        const data = { ...Message, Message: "ffmpeg", tabId: Message.tabId ?? sender.tab.id, version: G.ffmpegConfig.version };
        chrome.tabs.query({ url: G.ffmpegConfig.url + "*" }, function (tabs) {
            if (chrome.runtime.lastError || !tabs.length) {
                chrome.tabs.create({ url: G.ffmpegConfig.url, active: Message.active ?? true }, function (tab) {
                    if (chrome.runtime.lastError) { return; }
                    G.ffmpegConfig.tab = tab.id;
                    G.ffmpegConfig.cacheData.push(data);
                });
                return true;
            }
            if (tabs[0].status == "complete") {
                chrome.tabs.sendMessage(tabs[0].id, data);
            } else {
                G.ffmpegConfig.tab = tabs[0].id;
                G.ffmpegConfig.cacheData.push(data);
            }
        });
        sendResponse("ok");
        return true;
    }
    // 发送数据到本地
    if (Message.Message == "send2local" && G.send2local) {
        try { send2local(Message.action, Message.data, Message.tabId); } catch (e) { console.log(e); }
        sendResponse("ok");
        return true;
    }
    if (Message.Message == "damnUrlHas") {
        sendResponse(G.damnUrlSet.has(Message.tabId));
        return true;
    }
    if (Message.Message == "closeScript") {
        if (!Message.script || !G.scriptList.has(Message.script)) {
            sendResponse("error");
            return false;
        }
        const script = G.scriptList.get(Message.script);
        const scriptTabid = script.tabId;
        if (scriptTabid.has(Message.tabId)) {
            scriptTabid.delete(Message.tabId);
        }
        sendResponse("ok");
        return true;
    }
});

/**
 * 监听 外部扩展 message 事件
 */
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    if (request.action === "getData") {
        if (request.tabId) {
            sendResponse(cacheData[request.tabId] ?? null);
            return true;
        }
        sendResponse(cacheData);
        return true;
    } else if (request.action === "getCurrentTabData") {
        const tabId = request.tabId ?? G.tabId;
        sendResponse(cacheData[tabId] ?? null);
        return true;
    }
});

// 选定标签 更新G.tabId
// chrome.tabs.onHighlighted.addListener(function (activeInfo) {
//     if (activeInfo.windowId == -1 || !activeInfo.tabIds || !activeInfo.tabIds.length) { return; }
//     G.tabId = activeInfo.tabIds[0];
// });

/**
 * 监听 切换标签
 * 更新全局变量 G.tabId 为当前标签
 */
chrome.tabs.onActivated.addListener(function (activeInfo) {
    G.tabId = activeInfo.tabId;
    if (cacheData[G.tabId] !== undefined) {
        SetIcon({ number: cacheData[G.tabId].length, tabId: G.tabId });
        return;
    }
    SetIcon({ tabId: G.tabId });
});

// 切换窗口，更新全局变量G.tabId
chrome.windows.onFocusChanged.addListener(function (activeInfo) {
    if (activeInfo == -1) { return; }
    chrome.tabs.query({ active: true, windowId: activeInfo }, function (tabs) {
        if (tabs[0] && tabs[0].id) {
            G.tabId = tabs[0].id;
        } else {
            G.tabId = -1;
        }
    });
});

/**
 * 监听 标签页面更新
 * 检查 清理数据
 * 检查 是否在屏蔽列表中
 */
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (isSpecialPage(tab.url) || tabId <= 0 || !G.initSyncComplete) { return; }
    // console.log('onUpdated', tabId, changeInfo, tab);
    if (changeInfo.status && changeInfo.status == "loading" && G.autoClearMode == 2) {
        G.urlMap.delete(tabId);
        chrome.alarms.get("save", function (alarm) {
            if (!alarm) {
                delete cacheData[tabId];
                SetIcon({ tabId: tabId });
                chrome.alarms.create("save", { when: Date.now() + 1000 });
            }
        });
    }
    // 检查当前标签是否在屏蔽列表中
    if (changeInfo.url && tabId > 0) {
        if (G.blockUrl.length) {
            G.blockUrlSet.delete(tabId);
            if (isLockUrl(changeInfo.url)) {
                G.blockUrlSet.add(tabId);
            }
        }

        G.damnUrlSet.delete(tabId);
        if (isDamnUrl(changeInfo.url)) {
            G.damnUrlSet.add(tabId);
        }
    }
    try {
        if (chrome.sidePanel && chrome.sidePanel.setOptions) {
            // 侧边栏默认就是「本页图片清单」：点侧边栏/按 Alt+Shift+A 直接看到图，
            // 不用先进嗅探列表再点「抓图」。嗅探列表仍在 popup.html，图片页右上角可切回。
            chrome.sidePanel.setOptions({ tabId: tabId, path: "image.html?tabId=" + tabId });
        }
    } catch (e) { /* Edge/旧版无 sidePanel：忽略 */ }
});

/**
 * 监听 frame 正在载入
 * 检查 是否在屏蔽列表中 (frameId == 0 为主框架)
 * 检查 自动清理 (frameId == 0 为主框架)
 * 检查 注入脚本
 */
chrome.webNavigation.onCommitted.addListener(function (details) {
    if (isSpecialPage(details.url) || details.tabId <= 0 || !G.initSyncComplete) { return; }
    // console.log('onCommitted', details);

    // 刷新页面 检查是否在屏蔽列表中
    if (details.frameId == 0) {
        G.blockUrlSet.delete(details.tabId);
        if (isLockUrl(details.url)) {
            G.blockUrlSet.add(details.tabId);
        }

        G.damnUrlSet.delete(details.tabId);
        if (isDamnUrl(details.url)) {
            G.damnUrlSet.add(details.tabId);
        }
    }

    // 刷新清理角标数
    if (details.frameId == 0 && (!['auto_subframe', 'manual_subframe', 'form_submit'].includes(details.transitionType)) && G.autoClearMode == 1) {
        delete cacheData[details.tabId];
        G.urlMap.delete(details.tabId);
        (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData });
        SetIcon({ tabId: details.tabId });
    }

    // chrome内核版本 102 以下不支持 chrome.scripting.executeScript API
    if (G.version < 102) { return; }

    if (!G.blockUrlSet.has(details.tabId) && G.deepSearch && G.deepSearchTemporarilyClose != details.tabId) {
        G.scriptList.get("search.js").tabId.add(details.tabId);
        G.deepSearchTemporarilyClose = null;
    }

    // catch-script 脚本
    G.scriptList.forEach(function (item, script) {
        if (!item.tabId.has(details.tabId) || !item.allFrames) { return true; }

        const files = [`catch-script/${script}`];
        item.i18n && files.unshift("catch-script/i18n.js");
        chrome.scripting.executeScript({
            target: { tabId: details.tabId, frameIds: [details.frameId] },
            files: files,
            injectImmediately: true,
            world: item.world
        });
    });

    // 模拟手机
    if (G.initLocalComplete && G.featMobileTabId.size > 0 && G.featMobileTabId.has(details.tabId)) {
        chrome.scripting.executeScript({
            args: [G.MobileUserAgent.toString()],
            target: { tabId: details.tabId, frameIds: [details.frameId] },
            func: function () {
                Object.defineProperty(navigator, 'userAgent', { value: arguments[0], writable: false });
            },
            injectImmediately: true,
            world: "MAIN"
        });
    }
});

/**
 * 监听 标签关闭 清理数据
 */
chrome.tabs.onRemoved.addListener(function (tabId) {
    // 清理缓存数据
    chrome.alarms.get("nowClear", function (alarm) {
        !alarm && chrome.alarms.create("nowClear", { when: Date.now() + 1000 });
    });
    if (G.initSyncComplete) {
        G.blockUrlSet.has(tabId) && G.blockUrlSet.delete(tabId);
        G.damnUrlSet.has(tabId) && G.damnUrlSet.delete(tabId);
    }
    /* YouTube 下载页被关（用户手动关 / 浏览器回收）也要释放串行队列，
     * 否则下一个任务会永远排队等一个不存在的页面。 */
    try { vrYtRelease(tabId); } catch (e) { /* ignore */ }
});

// 苏哥的钓鱼竿：X(推特) 推文内联按钮下载（M8）
// content script 从 video.poster 提取媒体 ID，这里在嗅探缓存里匹配 URL 并下载。
// 页面只传 mediaId 和文件名，URL 一律从缓存取——页面无法借道下载任意地址。
// 优先完整渐进式 MP4（X 播放器必请求）；无则最高清视频轨 m3u8 → 打开猫抓 m3u8.html 兜底。
// X 的视频：页面播放走分轨 HLS（fMP4 分片），但平台另提供**已合并好音视频的完整 MP4**直链。
// 直链 URL 无法拼（每个分辨率独立文件名+tag），只能查——用 fxtwitter 开源 API 取（免鉴权，
// 不碰登录态，只发公开推文 ID；比下载分片再合成、比送在线 FFmpeg 都省事，业界通行做法）。
async function fetchXVideo(user, statusId, mediaId, wantBest) {
    if (!user || !statusId) { return null; }
    let r = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            r = await fetch("https://api.fxtwitter.com/" + user + "/status/" + statusId);
        } catch (e) {
            if (attempt === 0) {
                await new Promise(function (res) { setTimeout(res, 2500); });
                continue;
            }
            return null;
        }
        if (r.ok) { break; }
        if ((r.status === 429 || r.status >= 500) && attempt === 0) {
            await new Promise(function (res) { setTimeout(res, 3000); });
            continue;
        }
        return null;
    }
    if (!r || !r.ok) { return null; }
    const d = await r.json();
    const vids = (((d.tweet || {}).media || {}).videos) || [];
    if (!vids.length) { return null; }
    // 多视频推文：用 mediaId（与 video.poster 同源）定位是哪一条
    let v = vids[0];
    if (mediaId) {
        const hit = vids.find(x =>
            (x.thumbnail_url || "").includes(mediaId) || (x.url || "").includes(mediaId));
        if (hit) { v = hit; }
    }
    // 注意：fxtwitter 的 variants 不一定带 container 字段，按 URL 后缀判断才稳
    const mps = (v.variants || []).filter(x => x.url && /\.mp4(\?|$)/i.test(x.url));
    if (!mps.length) { return null; }
    mps.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));   // 码率降序
    // wantBest（默认）：最高档（这条推文是 2160p）；否则退到 720p 以内省流量
    const pick = wantBest ? mps[0]
        : (mps.find(x => {
            const m = x.url.match(/\/(\d{2,4})x\d{2,4}\//);
            return m && parseInt(m[1], 10) <= 720;
        }) || mps[0]);
    return pick ? pick.url : null;
}

// 右键菜单 和 快捷键 复用函数
/**
 * 苏哥的钓鱼竿：右键秒存（M5）
 * 在页面里跑 naming.js 算出「作者_标题」，直接落到 默认目录/名字.ext
 */
/* ==========================================================
 * 页内悬浮下载按钮的背后支撑（ADR-030）
 * js/video-overlay.js 只管「画一个按钮」，取流/命名/下载全在这儿：
 *   vrNameInTab      —— 复用既有命名引擎（注入 naming.js 到页面，用页面自己的信息起名）
 *   vrVideoOptions   —— 这个标签页能下哪些清晰度
 *   vrVideoDownload  —— 按选项执行下载，完成后主动推消息给按钮更新状态
 * ========================================================== */

/** 在指定标签页里跑命名引擎 → 返回「目录/文件名」。
 *  做法与 vrSaveContextMedia 一致：把 naming.js 注入页面，用页面自己的 document 提取信息。
 *  override：调用方已经知道作者/标题时直接给（如 B站 从 __INITIAL_STATE__ 拿到的 UP 主），
 *  否则页面提取常常拿不到作者，文件名就会少一段前缀。 */
async function vrNameInTab(tabId, ext, override) {
    let settings = {};
    try {
        const res = await chrome.storage.local.get('vrSettings');
        settings = (res && res.vrSettings) || {};
    } catch (e) { /* 忽略 */ }
    const dir = String(settings.defaultDir || 'video-rod')
        .replace(/[<>:"|?*\\]/g, '').replace(/^\/+|\/+$/g, '') || 'video-rod';
    const tpl = settings.template || '${author}_${title}';

    let name = '';
    // override（页面侧已知的作者/作品）优先于 DOM 提取，供分目录与命名共用
    const info = {
        author: (override && override.author) || '',
        authorId: (override && override.authorId) || '',
        pageUrl: (override && override.pageUrl) || ''
    };
    try {
        await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['js/naming.js'] });
        const r = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: function (tpl, ext, ov) {
                const N = self.VideoRodNaming;
                if (!N) { return ''; }
                try {
                    const i = N.extractPageInfo(document, location.href);
                    // 调用方已知作者/标题时覆盖页面提取（抖音详情接口、B站 UP 主等），
                    // 否则页面 DOM 常常拿不到作者，文件名就少一段前缀。
                    if (ov) {
                        if (ov.title) { i.title = ov.title; i.post = ov.post || ov.title; }
                        if (ov.author) { i.author = ov.author; }
                        if (ov.authorId) { i.authorId = ov.authorId; }
                        if (ov.site) { i.site = ov.site; }
                        i.authorFull = N.buildAuthorFull(i.author, i.authorId);
                    }
                    // 一起把归档分目录要用的字段带回来，省一次注入
                    return {
                        n: N.buildNameFromInfo(i, location.href, { tpl: tpl, ext: ext }),
                        a: i.author || '',
                        ai: i.authorId || '',
                        u: location.href || ''
                    };
                } catch (e) { return ''; }
            },
            args: [tpl, ext, override || null]
        });
        const v = (r && r[0] && r[0].result) || null;
        if (v && typeof v === 'object') {
            name = v.n || '';
            info.author = v.a || '';
            info.authorId = v.ai || '';
            info.pageUrl = v.u || '';
        } else if (typeof v === 'string') {
            name = v;
        }
    } catch (e) { /* 受限页面，退回时间戳名 */ }

    if (!name) { name = 'media_' + Date.now() + '.' + ext; }

    /* 归档分目录（苏哥第一性原则 P2）：video-rod/<平台>/<作者(@ID)>/<视频|图片|音频>/<名>
       拿不到页面地址（chrome:// 等受限页）就退回平铺，不硬造「其他网页/待整理」垃圾目录。
       settings.subdirByPlatform === false 时也平铺（给不想分层的用户留口子）。 */
    let sub = dir;
    try {
        if (info.pageUrl && self.VRPath && self.VRPath.buildRelDir && settings.subdirByPlatform !== false) {
            sub = self.VRPath.buildRelDir({
                subdir: dir,
                pageUrl: info.pageUrl,
                ext: ext,
                type: '',
                authorFull: info.author,
                creatorId: info.authorId,
                site: (override && override.site) || ''
            }) || dir;
        }
    } catch (e) { sub = dir; }
    return (sub + '/' + name).replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

const VR_VIDEO_EXT = /^(mp4|webm|mkv|mov|flv|ts|avi|m4v|m4s)$/i;

/**
 * 静态资源排除：有些站点把登录页背景图、占位动画也用 .mp4 命名（实测 TikTok 的
 * ttwstatic.com/tiktok_web_login_static/*.mp4 是 webp 静态图）。
 * 这些不是视频，混进「按体积选最大」会把用户带到错的素材上。
 * 判据：路径里带明显的静态资源目录/文件名标记 → 排除。
 */
const VR_STATIC_ASSET = /(web_login_static|\/static\/|\/assets\/|\/images?\/|\/icons?\/|\/sprites?\/|\.gif$|\.png$|\.jpe?g$|\.webp$|\.svg$)/i;

/* 清晰度解析与候选排序统一放在 js/video-quality.js（纯函数，可 Node 单测）。
 * 曾经的临时实现留在这里会被两处调用点重复维护，已删除。
 * 通用规则：分辨率优先 → 体积次之 → 「正在播放」仅作次要加权。 */

/* ---------- 媒体 CDN 的 Referer 保护 ----------
 * 抖音直链不带 Referer 会 403（实测：无 Referer 403 text/html，带 Referer 206 video/mp4）。
 * CocoCut 的做法是下载前用 declarativeNetRequest 临时给媒体请求 set Referer/Origin。
 * 规则只加在指定域名上，10 分钟后自动清掉，避免长期影响页面自己的请求。 */
/* 规则 ID 池：以前只有一条 91001，批量下载时「图片 → 视频」交替设置会互相覆盖，
 * 后面那条一覆盖，前面的域名就再也拿不到 Referer。
 * 小红书实测：图片在 sns-webpic-qc、视频在 sns-video-v6，两个域名必须同时生效，
 * 否则视频落到下载器就是 NETWORK_FAILED（2026-11-06 用户反馈）。 */
const VR_MEDIA_HEADER_RULE_BASE = 91001;
const VR_MEDIA_HEADER_RULE_MAX = 12;
const VR_MEDIA_HEADER_ALARM = 'vrClearMediaHeaders';

/** 域名 → 规则 ID（会话内稳定分配，同域名重复设置只覆盖自己那条） */
const vrHeaderRuleByDomain = new Map();

async function vrSetMediaHeaders(domain, referer) {
    try {
        if (!chrome.declarativeNetRequest || !domain || !referer) { return; }
        let origin = '';
        try { origin = new URL(referer).origin; } catch (e) { /* ignore */ }
        // origin 必须 **remove** 而不是 set（2026-11-05 实测）：
        // 扩展上下文的 fetch 会自带 `Origin: chrome-extension://<id>`，微博 sinaimg 见到
        // 这个 Origin 直接 403（同样请求用 curl 不带 Origin 就是 200）。
        // 只 set referer 不够，必须把这个头去掉 —— 抖音/微博图片都靠这条才通。
        const headers = [
            { header: 'referer', operation: 'set', value: referer },
            { header: 'origin', operation: 'remove' }
        ];
        /* 同域名复用同一个 ID；新域名顺延分配，超出上限就淘汰最早的一个 */
        let id = vrHeaderRuleByDomain.get(domain);
        if (!id) {
            const used = new Set(vrHeaderRuleByDomain.values());
            for (let i = 0; i < VR_MEDIA_HEADER_RULE_MAX; i++) {
                const cand = VR_MEDIA_HEADER_RULE_BASE + i;
                if (!used.has(cand)) { id = cand; break; }
            }
            if (!id) {
                /* 池满：淘汰最早的一条 */
                const oldest = vrHeaderRuleByDomain.keys().next().value;
                id = vrHeaderRuleByDomain.get(oldest);
                vrHeaderRuleByDomain.delete(oldest);
                try {
                    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] });
                } catch (e) { /* ignore */ }
            }
            vrHeaderRuleByDomain.set(domain, id);
        }
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [id],
            addRules: [{
                id: id,
                priority: 1,
                action: { type: 'modifyHeaders', requestHeaders: headers },
                condition: {
                    urlFilter: '||' + domain,
                    resourceTypes: ['other', 'media', 'xmlhttprequest', 'image']
                }
            }]
        });
        try {
            chrome.alarms.create(VR_MEDIA_HEADER_ALARM, { when: Date.now() + 10 * 60 * 1000 });
        } catch (e) { /* ignore */ }
    } catch (e) { /* 规则失败不阻塞下载 */ }
}

/** 通用直链：按目标 URL 的 host 回放页面 Referer（抄 CocoCut 的通用做法）。
 *  很多站的 CDN 会校验 Referer；blob:/data: 没有 host，直接跳过。 */
async function vrSetMediaHeadersFor(url, referer) {
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') { return; }
        await vrSetMediaHeaders(u.hostname, referer);
    } catch (e) { /* 非法 URL 不处理 */ }
}

/** 等 downloads 任务落定（识别 CDN 403 这类快速失败，再决定是否走页面 fetch）。
 *  返回 complete/interrupted 的 item；还在下载则返回 null（视为已开始，不打断）。 */
function vrWaitDownload(id, ms) {
    return new Promise(function (resolve) {
        /* 防御：id 必须是数字。FSA 直写会返回 {__fsa:true,path} 这种对象，
         * 一旦传进来，downloads.search({id}) 会抛 TypeError 并把整个调用链搞崩
         * （表现是「文件下好了按钮却报失败」）。这里直接当「不是下载器任务」处理。 */
        if (typeof id !== 'number' || !isFinite(id)) { resolve(null); return; }
        const until = Date.now() + ms;
        function tick() {
            chrome.downloads.search({ id: id }, function (items) {
                const it = items && items[0];
                if (!it) { resolve(null); return; }
                if (it.state === 'complete' || it.state === 'interrupted') { resolve(it); return; }
                if (Date.now() >= until) { resolve(null); return; }
                setTimeout(tick, 250);
            });
        }
        tick();
    });
}

/** 下载项看起来是坏的（空文件 / 服务器给回来的是网页）。
 *
 *  「下载成功」不等于「内容是好的」：CDN 的风控页、登录页、反爬页
 *  经常以 **200 + text/html** 返回，chrome.downloads 照单全收 —— 落盘就是坏文件。
 *  2026-11-09 查库时见到实证：抖音那几条 15KB / 848KB 的「视频」就是这种。
 *
 *  规则比 SnapHD（download-tracker.js）更保守：它用 `!/^(video|image|audio)\//`
 *  白名单，会把 application/mp4 之类的合法类型也判死（误删真文件）。
 *  我们只拦**明确是文本/网页**的类型 + 0 字节，未知 mime 一律放过。
 */
function vrDownloadLooksInvalid(it) {
    if (!it) { return false; }
    const mime = String(it.mime || '').toLowerCase();
    const bytes = Number(it.fileSize) || Number(it.totalBytes) || 0;
    if (!bytes) { return true; }

    /* 后缀判据（2026-11-12 补）：downloads 记录里 `mime` 经常是空的，
     * 只看 mime 会让「服务器给了一张 238 字节的 .htm 反爬页」被当成成功 ——
     * 微博视频就是这么落了一个 .htm 出去（实测，用户看到的是「下载了但打不开」）。
     * 说明：下载是我们自己发起的，落盘后缀变成网页/数据文件就一定是错的。
     * 字幕（.vtt/.srt/.ass）本来就不走这条函数，不必特判。 */
    const fn = String(it.filename || '').toLowerCase().split('?')[0];
    if (/\.(html?|xhtml|json|xml)$/.test(fn)) { return true; }

    return /^(text\/|application\/(json|xml|xhtml\+xml))/i.test(mime)
        && !/^text\/(vtt|plain|srt)/i.test(mime);     // 字幕是文本，别误杀
}

/** 删掉坏下载：文件 + 记录一起清，否则资源库里会留一张死卡 */
function vrDiscardBadDownload(id) {
    try {
        chrome.downloads.removeFile(id, function () { void chrome.runtime.lastError; });
    } catch (e) { /* 文件可能已不存在 */ }
    try {
        chrome.downloads.erase({ id: id }, function () { void chrome.runtime.lastError; });
    } catch (e) { /* ignore */ }
}

/* ==================================================================
 * 视频录制兜底（L5）—— 抄 Video Downloader Pro v0.1.11
 *
 * 什么时候用：L1~L4 全部失败，而页面上有一个能播的 video。
 * 这是「什么都能下」的最后一张牌 —— MSE 流、加密可播、短时效签名、
 * 只给分片的直播，前面所有路都走不通时，只有录下来这条路。
 *
 * 数据通路：内容脚本 vr-capture.js 每 2 秒切一个 MediaRecorder chunk，
 * 攒 8 个就 base64 推上来（走 Port）。这里按序累积，done 时拼 Blob 落盘。
 * 为什么不在页面里拼好再一次性传：几百 MB 的 base64 会直接撑爆消息体积。
 * ================================================================== */
var vrCapSessions = new Map();      // `${tabId}:${frameId}` -> { parts, tabId, frameId, meta, error }

function vrCapKey(tabId, frameId) { return String(tabId) + ':' + String(frameId || 0); }

function vrCapB64ToU8(b64) {
    /* 必须先清洗：FileReader 在部分环境会按 76 字符折行，
     * atob 不容忍换行/空格，直接抛 "not correctly encoded"（实测踩到）。 */
    var s = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
    /* 补回被削掉的 padding */
    var pad = s.length % 4;
    if (pad === 2) { s += '=='; } else if (pad === 3) { s += '='; }
    var bin = atob(s);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { u8[i] = bin.charCodeAt(i); }
    return u8;
}

/** 收尾：拼 Blob → 落盘 → 清会话。parts 为空时静默清理（用户中途取消过）。 */
async function vrCapFlush(key) {
    var sess = vrCapSessions.get(key);
    if (!sess) { return null; }
    vrCapSessions.delete(key);

    var parts = sess.parts || [];
    if (!parts.length) {
        if (sess.error) { return { ok: false, reason: sess.error }; }
        return null;
    }

    var mime = (sess.meta && sess.meta.mimeType) || 'video/webm';
    var ext = /mp4/i.test(mime) ? 'mp4' : 'webm';
    var bytes = parts.reduce(function (n, p) { return n + p.length; }, 0);

    var filename = '';
    try {
        filename = await vrNameInTab(sess.tabId, ext, null);
    } catch (e) {
        filename = 'video-rod/录制_' + Date.now() + '.' + ext;
    }
    if (!filename) { filename = 'video-rod/录制_' + Date.now() + '.' + ext; }

    var save = self.VRSave;
    if (!save || typeof save.saveFile !== 'function') {
        return { ok: false, reason: 'no-save' };
    }
    var blob = new Blob(parts, { type: mime });
    var r = null;
    try {
        r = await save.saveFile({ relPath: filename, blobOrUrl: blob, mime: mime, prefer: 'auto' });
    } catch (e) {
        return { ok: false, reason: 'save-failed', error: String((e && e.message) || e) };
    }
    /* 录制产物也要进资源库：不然用户下完在库里找不到，等于白录 */
    try {
        if (self.VRLib && typeof self.VRLib.record === 'function') {
            var tab = null;
            try { tab = await chrome.tabs.get(sess.tabId); } catch (e) { /* ignore */ }
            self.VRLib.record(filename, {
                platform: (self.VRPath && self.VRPath.detectPlatform) ? self.VRPath.detectPlatform((tab && tab.url) || '') : '',
                type: 'video',
                title: filename.split('/').pop().replace(/\.[^.]+$/, ''),
                pageUrl: (tab && tab.url) || '',
                relPath: filename,
                recorded: true
            });
        }
    } catch (e) { /* 入库失败不影响文件本身 */ }

    try {
        chrome.tabs.sendMessage(sess.tabId, {
            Message: 'vrVideoProgress', name: filename,
            done: true, ok: !!(r && r.ok !== false), bytes: bytes, phase: '录制完成'
        });
    } catch (e) { /* 页面没了 */ }

    return { ok: !!(r && r.ok !== false), path: filename, bytes: bytes, mode: r && r.mode };
}

/* 录制分片入口。
 *
 * 为什么用 Port 传 ArrayBuffer，而不是 sendMessage 传 base64：
 *   base64 那条路实测走不通 —— 字符串在传输环节被改动，后台 atob 稳定报
 *   "The string to be decoded is not correctly encoded"（清洗字符也救不回来）。
 *   Port 的 postMessage 走结构化克隆，二进制直传，没有编码这一步。
 * 代价是 Port 会随 SW 回收断开 —— 所以每块都 ensurePort() 重连，且 onDisconnect 时
 * 把已收到的部分先落盘（录了一半也比全丢强）。
 */
try {
    chrome.runtime.onConnect.addListener(function (port) {
        if (!port || port.name !== 'vrCap') { return; }
        var tabId = port.sender && port.sender.tab && port.sender.tab.id;
        if (!(tabId > 0)) { return; }
        var frameId = (port.sender && port.sender.frameId) || 0;
        var key = vrCapKey(tabId, frameId);

        var sess = vrCapSessions.get(key);
        if (!sess) {
            sess = { parts: [], tabId: tabId, frameId: frameId, meta: null, error: null, done: false };
            vrCapSessions.set(key, sess);
        }

        port.onMessage.addListener(function (m) {
            if (!m || !m.type) { return; }
            if (m.type === 'chunk') {
                try {
                    /* 页面侧发的是数字数组（Chrome 消息是 JSON 序列化，ArrayBuffer 传不过来） */
                    var arr = m.bytes;
                    if (arr && arr.length) {
                        sess.parts.push(Uint8Array.from(arr));
                    } else {
                        sess.error = 'empty-chunk:' + (arr ? arr.length : 'nil');
                    }
                } catch (e) {
                    sess.error = 'decode:' + String((e && e.message) || e);
                }
                return;
            }
            if (m.type === 'done') {
                sess.meta = { mimeType: m.mimeType || 'video/webm', ms: m.ms || 0 };
                sess.done = true;
                vrCapFlush(key);
                return;
            }
            if (m.type === 'error') {
                sess.error = m.message || 'record-error';
            }
        });

        /* 端口断开 = 页面关了 / SW 被回收。已经收到的分片照样拼盘，不白录。 */
        port.onDisconnect.addListener(function () { vrCapFlush(key); });
    });
} catch (e) { /* 注册失败不影响其他功能 */ }

/** 扫页面上的媒体链接 —— 纯静态下载站（`<a href="xxx.mp4">`）的唯一入口。
 *
 *  为什么要它：页面里没有 <video> 时，悬浮键挂不出来、嗅探也抓不到，
 *  但用户明明看得到「点此下载」。Download Master 就是靠「把页面所有链接
 *  甩给用户挑」做到号称全站可下的 —— 它连 webRequest 都没用。
 *  我们补这一环，但**只作为最后一条路**：页面有 video 时不走这里。
 */
async function vrScanMediaLinks(tabId) {
    try {
        const r = await vrWithTimeout(chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: function () {
                var MEDIA = /\.(mp4|webm|mov|mkv|flv|m4v|avi|wmv|mp3|m4a|aac|flac|wav|ogg|m3u8|mpd)$/i;
                var VID = /\.(mp4|webm|mov|mkv|flv|m4v|m3u8|mpd)$/i;
                var out = [];
                var seen = Object.create(null);

                var add = function (raw, label) {
                    if (!raw) { return; }
                    var u = '';
                    try { u = new URL(raw, location.href).href; } catch (e) { return; }
                    if (!/^https?:/i.test(u)) { return; }          // 跳过 blob:/data:/javascript:
                    if (!MEDIA.test(u.split('?')[0].split('#')[0])) { return; }
                    if (seen[u]) { return; }
                    seen[u] = 1;
                    out.push({ url: u, label: String(label || '').replace(/\s+/g, ' ').trim().slice(0, 60) });
                };

                var links = document.querySelectorAll('a[href]');
                for (var i = 0; i < links.length && out.length < 60; i++) {
                    var a = links[i];
                    var h = a.getAttribute('href') || '';
                    /* 下载站常把地址 URL 编码一层（xxx%2Emp4），先解一次再判 */
                    if (/%2[EFef]|%3[0-9A-Fa-f]/i.test(h)) {
                        try { h = decodeURIComponent(h); } catch (e) { /* 保持原样 */ }
                    }
                    add(h, a.textContent || a.getAttribute('title') || '');
                }
                ['source[src]', 'embed[src]', 'object[data]'].forEach(function (sel) {
                    var els = document.querySelectorAll(sel);
                    for (var j = 0; j < els.length && out.length < 60; j++) {
                        add(els[j].getAttribute('src') || els[j].getAttribute('data'),
                            sel.split('[')[0]);
                    }
                });

                /* 视频排前面，然后路径短的靠前（带长 query 的广告跳转链通常很长） */
                out.sort(function (x, y) {
                    var vx = VID.test(x.url) ? 0 : 1, vy = VID.test(y.url) ? 0 : 1;
                    if (vx !== vy) { return vx - vy; }
                    return x.url.length - y.url.length;
                });
                return { ok: true, links: out.slice(0, 24) };
            }
        }), 6000, 'scan-links');
        return (r && r[0] && r[0].result) || { ok: true, links: [] };
    } catch (e) {
        return { ok: false, error: String((e && e.message) || e), links: [] };
    }
}

/** 按单条 URL 下载：走统一落盘（命名模板 / 归档目录 / 资源库 / 内容校验都在里面） */
async function vrLinkDownload(tabId, url, pageUrl) {
    if (!/^https?:/i.test(url)) { return { ok: false, reason: 'bad-url' }; }
    var ext = '';
    try { ext = (new URL(url).pathname.split('.').pop() || '').toLowerCase(); } catch (e) { ext = ''; }
    if (!/^[a-z0-9]{2,5}$/.test(ext)) { ext = 'mp4'; }

    var filename = '';
    try { filename = await vrNameInTab(tabId, ext, null); }
    catch (e) { filename = 'video-rod/link_' + Date.now() + '.' + ext; }
    if (!filename) { filename = 'video-rod/link_' + Date.now() + '.' + ext; }

    var page = pageUrl || '';
    if (!page) { try { var t = await chrome.tabs.get(tabId); page = (t && t.url) || ''; } catch (e) { /* ignore */ } }
    try { if (page) { await vrSetMediaHeadersFor(url, page); } } catch (e) { /* 规则失败不影响下载 */ }

    var trace = {
        pageUrl: page || '', mediaUrl: url, sourceUrl: url,
        platform: (self.VRPath && self.VRPath.detectPlatform) ? self.VRPath.detectPlatform(page || '') : '',
        type: 'video'
    };

    var id = await vrDownloadWithName(url, filename, { meta: trace });
    if (id === null || id === undefined) { return { ok: false, reason: 'download-failed' }; }
    if (typeof id === 'object' && id.__fsa) {
        return { ok: true, kind: 'fsa', filename: filename, path: id.path || filename };
    }
    var outcome = await vrWaitDownload(id, 2500);
    if (outcome && outcome.state === 'interrupted') {
        vrDropDownload(id);
        return { ok: false, reason: 'interrupted' };
    }
    if (outcome && outcome.state === 'complete') {
        if (vrDownloadLooksInvalid(outcome)) {
            vrDiscardBadDownload(id);
            return { ok: false, reason: 'invalid-content' };
        }
        vrMarkDownloaded(filename);
        return { ok: true, kind: 'url', filename: filename };
    }
    vrWatchDownloadId(id, function () { });      // 大文件：交给进度观察器收尾
    return { ok: true, started: true, filename: filename };
}

/** 清掉快速失败的下载记录和残留文件（微博 403 会落一个 .htm） */
function vrDropDownload(id) {
    try {
        chrome.downloads.removeFile(id, function () {
            try { chrome.downloads.erase({ id: id }); } catch (e) { /* ignore */ }
        });
    } catch (e) { /* ignore */ }
}

/** 页面主世界 fetch → blob → <a download>。
 *  与 B站 durl 同一套路（ADR-029）：页面自己发请求，Referer/Cookie 天然正确，
 *  绕开 downloads API 不带 Referer 被 CDN 403 的问题（微博实测必须走这条）。
 *  CocoCut 也是在内容脚本/页面里 fetch（myContent.js 的 fetchByCsAB）。
 *  跨域 CORS 不允许时返回 ok:false，由调用方回退 downloads + DNR。 */
async function vrTryPageDownload(tabId, url, name) {
    try {
        const r = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            args: [url, name],
            func: async function (u, n) {
                try {
                    const res = await fetch(u, { credentials: 'include' });
                    if (!res.ok) {
                        return { ok: false, status: res.status, reason: 'http-' + res.status };
                    }
                    const blob = await res.blob();
                    if (!blob || blob.size < 1024) {
                        return { ok: false, status: res.status, size: blob ? blob.size : 0, reason: 'too-small' };
                    }
                    const a = document.createElement('a');
                    const bu = URL.createObjectURL(blob);
                    a.href = bu;
                    a.download = n || 'video.mp4';
                    (document.body || document.documentElement).appendChild(a);
                    a.click();
                    a.remove();
                    // 大 blob 别急着回收：给浏览器落盘留时间（B站踩过的坑）
                    setTimeout(function () { URL.revokeObjectURL(bu); }, 180000);
                    return { ok: true, bytes: blob.size, type: blob.type || '' };
                } catch (e) {
                    return { ok: false, reason: String(e).slice(0, 160) };
                }
            }
        });
        return (r && r[0] && r[0].result) || { ok: false, reason: 'no-result' };
    } catch (e) {
        return { ok: false, reason: String(e).slice(0, 160) };
    }
}

/** 页面主世界里的站点元数据（目前：微博 $render_data）。
 *  内容脚本是 isolated world，读不到页面的 $render_data；这里用 MAIN world 读。
 *  拿不到就返回 null，命名继续走 naming.js 的页面提取。 */
/** 小红书详情页：只读当前笔记 __INITIAL_STATE__（MAIN world）。
 *  不调用签名接口、不自动翻页、不做任何写操作；只返回当前笔记媒体。 */
function vrXhsScanInPage(noteId, injectedState) {
    try {
        /* injectedState：SSR 版把从详情页 HTML 里解出的 __INITIAL_STATE__ 直接传进来，
         * 复用同一套解析，避免「开标签页」和「fetch HTML」两条路各写一份解析逻辑。
         * 不传时仍读页面自己的 state（页面主世界调用）。
         * typeof 判断：本函数也在 SW 里被复用，SW 没有 window。 */
        const st = injectedState ||
            ((typeof window !== 'undefined' && window) ? window.__INITIAL_STATE__ : null);
        const n = st && st.note;
        const map = n && n.noteDetailMap;
        if (!map) { return { ok: false, reason: 'no-state' }; }
        /* 2026-11-06 实测（真实登录态页面取证），这里有两个坑：
         *
         * ① noteDetailMap 里混着**空条目**：key 是 'undefined' 和 ''，
         *    它们的 .note 是**没有任何字段的空对象 {}**。空对象是 truthy，
         *    所以原来的 `if (!note)` / `if (cand)` 判空全部失效 —— 明明没数据
         *    却被当成「找到了」，解析出 0 个媒体。
         *    这正是「有时能下、有时失败」的机制：页面 state 是异步填的，
         *    读得早就碰上空对象（失败），读得晚就有数据（成功）。
         *    所以判据必须是「有没有实际字段」，不是「引用是否非空」。
         *
         * ② currentNoteId 实测是 **object** 不是字符串，直接当 key 会变成
         *    '[object Object]'，永远查不到。
         *
         * 重要：目标笔记没填好时**绝不能拿 map 里别的笔记顶替**。
         * map 里同时有推荐流的十几篇笔记，抓到哪篇就下错哪篇的内容 ——
         * 那比失败更糟（用户会拿到完全无关的视频/图片）。
         * 正确做法是返回 note-loading，让上层 vrXhsScanInTab 继续重试。 */
        const noteUsable = function (x) {
            return !!x && typeof x === 'object' && !Array.isArray(x) &&
                Object.keys(x).length > 0;
        };

        /* 目标 id：调用方参数优先；其次从 URL 路径取（本函数在页面主世界，
         * location 可用）；最后才用 currentNoteId。 */
        let target = String(noteId || '');
        if (!target) {
            /* typeof 判断：本函数也被 SSR 版在 SW 里复用，SW 没有 location，
             * 直接访问会 ReferenceError。 */
            const loc = (typeof location !== 'undefined' && location) ? location : null;
            const pm = loc ? String(loc.pathname || '')
                .match(/\/(?:explore|discovery\/item)\/([0-9a-f]{16,})/) : null;
            if (pm) { target = pm[1]; }
        }
        if (!target) {
            const curId = n.currentNoteId;
            if (typeof curId === 'string' || typeof curId === 'number') { target = String(curId); }
            else if (curId && typeof curId === 'object' && curId.noteId) { target = String(curId.noteId); }
        }

        const id = target;
        let note = null;
        if (id && map[id] && noteUsable(map[id].note)) { note = map[id].note; }
        if (!noteUsable(note)) {
            /* 目标笔记还没加载完：交给上层重试，不抓别人的笔记。 */
            return { ok: false, reason: 'note-loading', noteId: id || '' };
        }
        const d = map[id];

        const u = note.user || {};
        const author = u.nickname || u.nickName || '小红书用户';
        const authorId = u.redId || u.red_id || u.userId || '';
        const title = String(note.title || note.desc || '小红书笔记')
            .replace(/\s+/g, ' ').slice(0, 100);
        const items = [];

        function xhsImgExt(u) {
            const e = (String(u).split('#')[0].split('?')[0].split('!')[0].split('.').pop() || '').toLowerCase();
            return /^(jpg|jpeg|png|webp|gif|heic)$/.test(e) ? (e === 'jpeg' ? 'jpg' : e) : 'webp';
        }
        function xhsHttps(u) {
            return String(u || '').replace(/^http:\/\//i, 'https://');
        }

        /* 小红书原图推导 / 扩展名 / 候选链，规则集中在 js/xhs-media.js
         * （纯函数，tools/test-xhs-media.js 23 条单测）。这里只做适配，不再重复实现。 */
        const xhsOriginalUrl = function (raw) {
            return self.VRXhsMedia ? self.VRXhsMedia.originalUrl(raw) : '';
        };
        (note.imageList || []).forEach(function (im, i) {
            /* 2026-11-06 实测：imageList.url 常为空；infoList 的 WB_DFT 才带
             * CDN 必需的 `!nd_dft_...` 后缀。旧代码把它当「尺寸后缀」剥掉，
             * 得到裸地址直接 403（A2 五张图全失败）。这里保留完整后缀并升级
             * 到 HTTPS；裸地址只作为最后回退，不再优先。 */
            const info = im.infoList || [];
            const dft = info.find(function (x) { return x.imageScene === 'WB_DFT' && x.url; });
            const any = info.find(function (x) { return x.url; });
            const raw = (dft && dft.url) || (any && any.url) ||
                im.urlDefault || im.url || im.urlPre || '';
            if (!raw) { return; }
            const url = xhsHttps(raw);
            const item = { kind: 'image', url: url, ext: xhsImgExt(url), index: i };

            /* 原图候选（抄「小红书下载助手」v1.0.2 的 sourceImageUrl）。
             * ⚠️ 2026-11-07 实测：ci.xiaohongshu.com 对部分素材 ID 返回 404
             *    （例 1040g2sg3271c1gng6qdg491k3adll5k → 404 text/plain）。
             *    对方之所以安全，是因为它用 probeImage 逐个探测后才排序。
             * 所以这里**保持原有可用地址为首选**，原图只作额外候选；
             * 由 VRXhsMedia.probeOriginal 探测通过后才升为首选（见 downloadQueue 前处理）。 */
            const original = xhsOriginalUrl(url) || xhsOriginalUrl(im.urlDefault || im.url || '');
            if (original && original !== url) {
                item.xhsOriginalUrl = original;      // 候选，不直接当首选
            }
            const preFallback = xhsHttps(im.urlPre || im.url || '');
            if (preFallback && preFallback !== url) {
                item.urlFallback = preFallback;
                item.extFallback = xhsImgExt(preFallback);
            }
            items.push(item);
        });

        const vids = new Map();
        function addVideo(v, idx) {
            /* 字段名在 mediaV2 / media.stream 两代结构里各不相同：
             * master_url / masterUrl / url / backupUrls[0]。少认一个就整条视频丢失。 */
            const raw = (v && (v.master_url || v.masterUrl || v.url)) ||
                (v && Array.isArray(v.backupUrls) && v.backupUrls[0]) || '';
            const url = xhsHttps(raw);
            if (!url) { return; }
            /* 同一视频在 media.stream 与 mediaV2 里会重复出现（EF4/EF5/EF6/EF7
             * 加上 h264/h265/av1 两代结构），按 URL 去重会留下低清那条。
             * 这里改成按「素材 ID」聚合：取 URL 里最后一段去掉清晰度后缀的
             * 稳定 ID，同 ID 只保留分辨率/码率最高的一个。 */
            const idMatch = url.match(/\/([0-9a-f]{20,})[_-]\d+\.mp4/i) || url.match(/\/([0-9a-f]{20,})\.mp4/i);
            const vid = idMatch ? idMatch[1] : url;
            const cand = {
                kind: 'video', url: url, ext: 'mp4', index: idx || 0,
                format: String(v.format || '').toLowerCase(),
                width: Number(v.width) || 0,
                height: Number(v.height) || 0,
                bitrate: Number(v.avg_bitrate || v.video_bitrate || 0),
                quality: v.quality_type || ''
            };
            const prev = vids.get(vid);
            if (!prev) { vids.set(vid, cand); return; }
            /* 同 ID：留更高的（高度优先，其次码率） */
            const better = (cand.height - prev.height) || (cand.bitrate - prev.bitrate);
            if (better > 0) { vids.set(vid, cand); }
        }
        const oldStreams = note.video && note.video.media && note.video.media.stream;
        if (oldStreams) {
            ['h264', 'h265', 'av1'].forEach(function (k) {
                (oldStreams[k] || []).forEach(function (v, j) { addVideo(v, j); });
            });
        }
        try {
            let mv = note.video && note.video.mediaV2;
            if (typeof mv === 'string') { mv = JSON.parse(mv); }
            const stream = (mv && mv.stream) || {};
            Object.keys(stream).forEach(function (k) {
                (stream[k] || []).forEach(function (v, j) { addVideo(v, j); });
            });
        } catch (e) { /* old state / malformed mediaV2 */ }
        const videoList = Array.from(vids.values()).sort(function (a, b) {
            // 优先带音轨的 mp4（EF4），再按分辨率/码率选最高
            const amp4 = a.format === 'mp4' ? 1 : 0;
            const bmp4 = b.format === 'mp4' ? 1 : 0;
            return (bmp4 - amp4) || (b.height - a.height) || (b.bitrate - a.bitrate);
        });
        if (videoList.length) {
            items.push(videoList[0]);
        }
        return {
            ok: true, noteId: id, title: title,
            desc: String(note.desc || '').slice(0, 200),
            author: author, authorId: authorId, items: items
        };
    } catch (e) {
        return { ok: false, reason: String(e).slice(0, 120) };
    }
}

function vrXhsWaitTab(tabId, timeout) {
    return new Promise(function (resolve) {
        const start = Date.now();
        function poll() {
            chrome.tabs.get(tabId, function (tab) {
                if (chrome.runtime.lastError || !tab) { resolve(false); return; }
                if (tab.status === 'complete') {
                    setTimeout(function () { resolve(true); }, 1200);
                    return;
                }
                if (Date.now() - start > timeout) { resolve(false); return; }
                setTimeout(poll, 300);
            });
        }
        poll();
    });
}

/** 详情页的 __INITIAL_STATE__ 是异步填充的；等待最多 ~7 秒，避免视频笔记首次扫描为空。 */
/**
 * 小红书：不开标签页，直接 fetch 详情页 HTML 解 SSR state。
 *
 * 抄「小红书下载助手」v1.0.2（background.js:467-483）的做法。
 *
 * 为什么值得抄：原实现每篇要 `tabs.create` + 等 18 秒 + 1.2 秒缓冲，
 * 批量 20 篇就是 6 分钟起，且开页会挤占用户窗口、更容易触发风控。
 * 直接 fetch HTML 一次往返就能拿到同样的 `__INITIAL_STATE__`。
 *
 * 技术要点（对方踩过的坑，照搬）：
 *   · SSR 里的 state 是 hydration 过的 JS 字面量，含 `undefined` / `new Map([])`，
 *     直接 JSON.parse 会失败 —— 必须先做文本替换再 parse。
 *   · 必须 `credentials: 'include'`，否则拿不到登录态下的笔记。
 *
 * @param {string} noteId
 * @param {string} xsecToken 可空
 * @returns {Promise<object|null>} 与 vrXhsScanInPage 同形的结果
 */
async function vrXhsScanViaHtml(noteId, xsecToken) {
    const id = String(noteId || '');
    if (!id) { return null; }
    const token = xsecToken
        ? '?xsec_token=' + encodeURIComponent(xsecToken) + '&xsec_source=pc_user'
        : '';
    const url = 'https://www.xiaohongshu.com/explore/' + encodeURIComponent(id) + token;

    try {
        const ctrl = new AbortController();
        const timer = setTimeout(function () { ctrl.abort(); }, 12000);
        let html = '';
        try {
            const r = await fetch(url, {
                credentials: 'include',
                signal: ctrl.signal,
                headers: { accept: 'text/html,application/xhtml+xml' }
            });
            if (!r.ok) { return null; }
            html = await r.text();
        } finally {
            clearTimeout(timer);
        }
        if (!html || html.length < 200) { return null; }

        /* 解析逻辑统一在 js/xhs-ssr.js（26 条单测）。
         * 那里处理了 SSR 的 JS 字面量（undefined / new Map([])），
         * 且替换时不会误伤字符串里的同名字样。 */
        const state = self.VRXhsSsr ? self.VRXhsSsr.parseState(html) : null;
        if (!state) { return null; }

        /* 复用页面版解析：传 state 进去，避免两套逻辑漂移。
         * vrXhsScanInPage 依赖 location，但在 SW 里没有 location ——
         * 它只在 target 为空时才读 location，这里已经显式传了 noteId。 */
        const res = vrXhsScanInPage(id, state);
        return (res && res.ok && res.items && res.items.length) ? res : null;
    } catch (e) {
        return null;
    }
}

async function vrXhsScanInTab(tabId, noteId) {
    let last = null;
    for (let i = 0; i < 12; i++) {
        try {
            const r = await chrome.scripting.executeScript({
                target: { tabId: tabId }, world: 'MAIN',
                args: [noteId], func: vrXhsScanInPage
            });
            last = r && r[0] && r[0].result;
            if (last && last.ok && last.items && last.items.length) { return last; }
        } catch (e) {
            last = { ok: false, reason: String(e).slice(0, 120) };
        }
        await new Promise(function (resolve) { setTimeout(resolve, 700); });
    }
    return last;
}

/** 可选：逐篇打开详情，读 state 后复用 vrBulkDownload；默认关闭。
 *  不设条数上限，只靠 3–5 秒/篇和连续失败停止控制风险。 */
async function vrXhsAutoQueue(notes, sourceTabId) {
    const list = Array.isArray(notes) ? notes.slice() : [];
    let done = 0, files = 0, skipped = 0, errors = 0, stopped = '';
    /* 复用一个后台标签页，全程只改 URL 导航 —— 绝不逐篇开/关。
     * 2026-11-08 苏哥实测：原来的「每篇 tabs.create + tabs.remove」
     * 会让小红书判定为机器行为并触发风控。
     * 复用同一个页面 + 站内导航，行为与人工逐个点开笔记一致。 */
    let reuseTabId = null;
    try {
        const t = await chrome.tabs.create({
            url: 'https://www.xiaohongshu.com/explore',
            active: false
        });
        reuseTabId = t && t.id;
        if (reuseTabId != null) {
            await vrXhsWaitTab(reuseTabId, 15000);
            await vrBulkSleep(1200 + Math.floor(Math.random() * 800));
        }
    } catch (e) { reuseTabId = null; }

    for (let i = 0; i < list.length; i++) {
        const n = list[i] || {};
        if (!n.noteId) { done++; continue; }
        let tabId = null;
        let noteOk = false;
        try {
            /* 快路径（抄「小红书下载助手」v1.0.2）：先直接 fetch 详情页 HTML 解 SSR，
             * 成功就完全不开标签页 —— 省掉 18 秒等待 + 开页开销，也不占用户窗口。
             * 失败（未登录/被风控/页面结构变化）则**无痕回退**到原来的开标签页路径，
             * 所以这条快路径只可能加速，不会让原本能下的变成下不了。 */
            let fastData = await vrXhsScanViaHtml(n.noteId, n.xsecToken);
            if (fastData && fastData.ok && fastData.items && fastData.items.length) {
                const fastItems = fastData.items.map(function (it) {
                    return Object.assign({}, it, {
                        site: 'xhs', title: fastData.title, author: fastData.author,
                        authorId: fastData.authorId,
                        pageUrl: 'https://www.xiaohongshu.com/explore/' + encodeURIComponent(fastData.noteId),
                        key: 'xhs:' + fastData.noteId + ':' + it.kind + ':' + it.index + ':' + it.url
                    });
                });
                const fastRes = await vrBulkDownload(fastItems, sourceTabId);
                files += (fastRes && fastRes.done) || 0;
                skipped += (fastRes && fastRes.skipped) || 0;
                if (fastRes && fastRes.paused) { stopped = fastRes.reason || '下载连续失败'; }
                noteOk = !!((fastRes && (fastRes.done || fastRes.skipped)) || (fastRes && fastRes.paused));
                if (!noteOk) { errors++; }
                done++;
                if (noteOk) { errors = 0; }
                if (sourceTabId != null) {
                    try {
                        chrome.tabs.sendMessage(sourceTabId, {
                            Message: 'vrXhsAutoProgress',
                            done: done, files: files, skipped: skipped,
                            errors: errors, total: list.length, via: 'ssr'
                        });
                    } catch (e) { /* 页面关了 */ }
                }
                continue;      // 快路径成了，不开标签页
            }

            const token = n.xsecToken
                ? '?xsec_token=' + encodeURIComponent(n.xsecToken) + '&xsec_source=pc_user'
                : '';
            const targetUrl = 'https://www.xiaohongshu.com/explore/' +
                encodeURIComponent(n.noteId) + token;
            /* 复用同一个标签页：只导航，不开关。
             * 首次若没有可复用页（上面创建失败），才退回新建一次。 */
            if (reuseTabId != null) {
                try {
                    await chrome.tabs.update(reuseTabId, { url: targetUrl });
                    tabId = reuseTabId;
                } catch (e) {
                    reuseTabId = null;      // 页面被用户关了
                }
            }
            if (tabId == null) {
                const tab = await chrome.tabs.create({ url: targetUrl, active: false });
                tabId = tab.id;
                reuseTabId = tab.id;
            }
            /* 导航后等内容渲染：模拟人工阅读的停顿，避免固定节奏被判机器 */
            const loaded = await vrXhsWaitTab(tabId, 18000);
            if (loaded) {
                await new Promise(function (r) {
                    setTimeout(r, 1800 + Math.floor(Math.random() * 1400));
                });
            }
            if (!loaded) {
                errors++;
            } else {
                const data = await vrXhsScanInTab(tabId, n.noteId);                if (!data || !data.ok || !data.items || !data.items.length) {
                    errors++;
                } else {
                    const items = data.items.map(function (it) {
                        return Object.assign({}, it, {
                            site: 'xhs', title: data.title, author: data.author,
                            authorId: data.authorId,
                            /* 自动补全路径必须带 pageUrl：vrBulkSaveItem 靠它补
                             * Referer/remove Origin，否则 XHS CDN 直接 403。 */
                            pageUrl: 'https://www.xiaohongshu.com/explore/' + encodeURIComponent(data.noteId),
                            key: 'xhs:' + data.noteId + ':' + it.kind + ':' + it.index + ':' + it.url
                        });
                    });
                    const res = await vrBulkDownload(items, tabId);
                    files += (res && res.done) || 0;
                    skipped += (res && res.skipped) || 0;
                    if (res && res.paused) { stopped = res.reason || '下载连续失败'; }
                    noteOk = !!((res && (res.done || res.skipped)) || (res && res.paused));
                    if (!noteOk) { errors++; }
                }
            }
        } catch (e) {
            errors++;
        }
        /* 不再逐篇 remove —— 复用页留到整个队列结束再关（见函数末尾）。 */
        done++;
        if (noteOk) { errors = 0; }
        if (sourceTabId != null) {
            try {
                chrome.tabs.sendMessage(sourceTabId, {
                    Message: 'vrXhsAutoProgress', done: done, total: list.length,
                    files: files, skipped: skipped, errors: errors, stop: stopped
                });
            } catch (e) { /* ignore */ }
        }
        if (stopped) { break; }
        if (errors >= 3) {
            stopped = '连续 3 篇没有可用详情，已停止';
            break;
        }
        if (i < list.length - 1) {
            await vrBulkSleep(3000 + Math.floor(Math.random() * 2000));
        }
    }
    /* 队列结束：统一关掉复用页（全程只开过这一个）。
     * 给一点缓冲再关，避免「刚读完就消失」的突兀感，也更像人工行为。 */
    if (reuseTabId != null) {
        try {
            await vrBulkSleep(1500 + Math.floor(Math.random() * 1000));
            await chrome.tabs.remove(reuseTabId);
        } catch (e) { /* 用户已手动关掉 */ }
        reuseTabId = null;
    }

    /* 明确告诉页面「队列结束」：长任务的回执可能先断，
     * 页面不能只靠 sendMessage 回调解除 running，否则按钮会永久卡住。 */
    if (sourceTabId != null) {
        try {
            chrome.tabs.sendMessage(sourceTabId, {
                Message: 'vrXhsAutoProgress', done: done, total: list.length,
                files: files, skipped: skipped, errors: errors, stop: stopped,
                finished: true
            });
        } catch (e) { /* 页面关了 */ }
    }
    return { ok: true, total: list.length, done: done, files: files, skipped: skipped, errors: errors, stopped: stopped };
}

/** 主页批量：文件名 = 作者(@UID)_正文_序号.ext（<a download> 不支持子目录） */
function vrBulkName(item, index) {
    const i = item || {};
    const author = String(i.author || '').trim();
    const id = String(i.authorId || '').trim();
    const who = author ? (id ? author + '(@' + id + ')' : author)
        : (i.site === 'xhs' ? '小红书' : (i.site === 'x' ? 'x' : 'weibo'));
    let title = String(i.title || '').replace(/\s+/g, ' ').trim();
    if (title === '视频') { title = ''; }
    let name = who + (title ? '_' + title : '') + '_' +
        String(index + 1).padStart(2, '0') + '.' + (i.ext || (i.kind === 'image' ? 'jpg' : 'mp4'));
    try {
        const N = self.VideoRodNaming;
        if (N && N.sanitizeName) {
            name = N.sanitizeName(name, { keepEmoji: false, keepPath: false });
        }
    } catch (e) { /* ignore */ }
    return name.slice(0, 160);
}

/** 主页批量：逐条页面 fetch → blob → <a download>（微博 CDN 只认页面上下文）。
 *  稳妥模式：串行 + 1.4~2.6 秒随机间隔；连续 3 次失败自动暂停，避免触发风控。 */
function vrBulkSleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
}
function vrBulkDelay() {
    return 1400 + Math.floor(Math.random() * 1200);
}

/** 媒体库路径：video-rod/<平台>/<作者(@ID)>/images|videos/<文件名> */
function vrMediaPath(item, name) {
    const i = item || {};
    const site = i.site === 'x' ? 'x'
        : i.site === 'weibo' ? 'weibo'
            : i.site === 'xhs' ? 'xiaohongshu' : 'other';
    /* 统一走 VRPath 三段式（平台/作者/类型 + 中文目录名）：
     * 以前这里硬编码 'xiaohongshu/…/videos/'，和资源库的 '小红书/…/视频/'
     * 不是一套 —— 同一批素材散在两个目录，索引反解拿不到 platform/type。
     * 2026-11-06 实测：小红书视频入库后 platform 为空，根源就是这条路径。 */
    if (self.VRPath && self.VRPath.buildRelPath) {
        try {
            const rel = self.VRPath.buildRelPath({
                platform: site === 'other' ? 'web' : site,
                authorFull: i.author || '',
                creatorId: i.authorId || '',
                type: i.kind === 'video' ? 'video' : (i.kind === 'audio' ? 'audio' : 'image'),
                ext: i.ext || (i.kind === 'video' ? 'mp4' : 'jpg'),
                fileName: name,
                pageUrl: i.pageUrl || '',
                subdir: 'video-rod'
            });
            if (rel) { return rel; }
        } catch (e) { /* 退回下面的简单路径 */ }
    }
    /* 2026-11-10 单目录铁律（兜底分支）：VRPath 不可用时也不能落英文平台目录，
     * 否则同一平台又会劈成 `weibo/` 与 `微博/` 两个目录。内联同一张映射表，
     * 与 path.js 的 PLATFORM_DIR 保持一致（只在 VRPath 加载失败时走到）。 */
    const PLAT_DIR = {
        bilibili: 'B站', xiaohongshu: '小红书', x: 'X', youtube: 'YouTube',
        douyin: '抖音', weibo: '微博', instagram: 'Instagram', tiktok: 'TikTok'
    };
    const TYPE_DIR = { video: '视频', image: '图片', audio: '音频' };
    const dirName = PLAT_DIR[site] || site;
    const kindDir = TYPE_DIR[i.kind] || TYPE_DIR.image;
    const author = String(i.author || '').replace(/[<>:"/\|?* -]/g, '_').trim().slice(0, 60);
    const id = String(i.authorId || '').replace(/[<>:"/\|?* -]/g, '_').trim().slice(0, 40);
    const folder = author ? (id ? author + '(@' + id + ')' : author) : '待整理';
    return 'video-rod/' + dirName + '/' + folder + '/' + kindDir + '/' + name;
}

/** 批量条目的资源库元数据。必须显式写全：FSA 直写不会产生下载事件，
 *  仅靠路径反解在自定义目录或作者缺失时会得到空 platform/type。 */
function vrBulkMeta(item, relPath) {
    const i = item || {};
    const author = String(i.author || '').trim();
    const id = String(i.authorId || '').trim();
    const creatorFull = author ? (id ? author + '(@' + id + ')' : author) : '';
    const site = String(i.site || '');
    const platform = site === 'x' ? 'x'
        : site === 'weibo' ? 'weibo'
            : site === 'xhs' ? 'xiaohongshu' : (site || 'other');
    const platformName = site === 'x' ? 'X'
        : site === 'weibo' ? '微博'
            : site === 'xhs' ? '小红书' : '';
    return {
        relPath: relPath,
        platform: platform,
        platformName: platformName,
        creatorFull: creatorFull,
        creatorId: id,
        type: i.kind === 'video' ? 'video' : (i.kind === 'audio' ? 'audio' : 'image'),
        title: String(i.title || ''),
        pageUrl: String(i.pageUrl || ''),
        sourceUrl: String(i.url || '')
    };
}

/** 微博等防盗链站点：下载器直连 403 时，改由离屏文档用扩展 fetch 取字节，
 *  再交回统一入口落盘。离屏只负责取流，绝不在页面里用 <a download>。 */
async function vrBulkOffscreenSave(item, relPath, meta) {
    const it = item || {};
    const off = await vrOffscreenDownload(it.url, String(relPath).split('/').pop());
    if (!off || !off.ok || !off.blobUrl) {
        return { ok: false, reason: (off && off.reason) || 'offscreen-fetch-failed', path: relPath };
    }
    let id = null;
    try {
        id = await vrDownloadWithName(off.blobUrl, relPath, { meta: meta });
    } catch (e) {
        return { ok: false, reason: String(e).slice(0, 120), path: relPath };
    }
    if (id && typeof id === 'object' && id.__fsa) {
        return { ok: true, fsa: true, path: id.path || relPath, via: 'offscreen' };
    }
    if (id === null || id === undefined) {
        return { ok: false, reason: 'offscreen-download-start-failed', path: relPath };
    }
    const outcome = await vrWaitDownload(id, 20000);
    if (outcome && outcome.state === 'interrupted') {
        try { vrDropDownload(id); } catch (e) { /* ignore */ }
        return { ok: false, reason: outcome.error || 'interrupted', id: id, path: relPath };
    }
    return { ok: true, id: id, path: relPath, via: 'offscreen' };
}

/** 批量单条落盘：优先 FSA/带 filename 的下载器直写，绝不再用 <a download>。
 *  <a download> 不认目录，微博批量曾因此只把第 1 条落到 Downloads 根目录，
 *  文件名被压成 video-rod_weibo_…，入库 platform/type 全空（2026-11-05 实测）。
 *  返回 {ok, fsa?, path?, id?, reason?}，调用方只按真实终态计数。 */
/** 库内条目指向的文件是否还在磁盘上（用于识别幽灵记录）。 */
async function vrEntryFileAlive(e) {
    try {
        if (!e) { return false; }
        if (e.downloadId != null) {
            const got = await new Promise(function (resolve) {
                try {
                    chrome.downloads.search({ id: e.downloadId }, function (list) {
                        void chrome.runtime.lastError;
                        resolve(list && list[0] || null);
                    });
                } catch (err) { resolve(null); }
            });
            if (got) { return got.exists !== false; }
        }
        /* 没有 downloadId（FSA 直写）：用库里的 size 兜底 —— size=0 基本可以判定写盘没成 */
        if (!Number(e.size)) { return false; }
        return !!e.relPath;
    } catch (err) { return true; }
}

async function vrBulkSaveItem(item, name, timeoutMs) {
    const it = item || {};
    const relPath = vrMediaPath(it, name);
    if (!it.url || !/^https?:/i.test(it.url)) {
        return { ok: false, reason: 'bad-url', path: relPath };
    }
    // 先查库：同一平台、同一规范化源 URL 直接跳过，不再发起下载。
    const existing = await vrFindExistingMedia(it);
    if (existing) {
        /* 必须确认这条记录指向的文件**真的还在**。
         * 2026-11-06 实测：库里留下 size=0 的幽灵记录（写盘失败但仍入库），
         * 之后每次下载都被判「重复」直接跳过，用户永远下不到——
         * 表现就是「点了没反应 / 网络问题」。文件不在就当没命中，重新下载。 */
        const alive = await vrEntryFileAlive(existing);
        if (alive) {
            return { ok: true, skipped: true, path: existing.relPath, reason: 'duplicate-source' };
        }
        try { await self.VRDB.deleteFiles([existing.relPath]); } catch (e) { /* 忽略 */ }
    }
    // 微博/小红书 CDN 认 Referer、拒绝扩展 Origin；DNR 对下载器与 SW fetch 都生效。
    const referer = String(it.pageUrl || '');
    if (referer) {
        try { await vrSetMediaHeadersFor(it.url, referer); } catch (e) { /* 头规则失败仍可试下载 */ }
    }
    const meta = vrBulkMeta(it, relPath);
    let id = null;
    try {
        id = await vrDownloadWithName(it.url, relPath, { meta: meta });
    } catch (e) {
        return { ok: false, reason: String(e).slice(0, 120), path: relPath };
    }
    if (id && typeof id === 'object' && id.__fsa) {
        return { ok: true, fsa: true, path: id.path || relPath };
    }
    if (id === null || id === undefined) {
        return { ok: false, reason: 'download-start-failed', path: relPath };
    }
    // 只等 4 秒判快速 403；大文件仍在下载时 outcome=null，不能当失败重下。
    const outcome = await vrWaitDownload(id, Math.min(4000, timeoutMs || 20000));
    if (outcome && outcome.state === 'interrupted') {
        try { vrDropDownload(id); } catch (e) { /* ignore */ }
        // 微博 sinaimg 对下载器请求返回 403（DNR 也补不上），页面/离屏 fetch 才 200。
        return await vrBulkOffscreenSave(it, relPath, meta);
    }
    return { ok: true, id: id, path: relPath };
}

/** 下载前去重：同一平台 + 同一规范化媒体 URL 视为同源重复。
 *  去掉 query/hash 与 CDN 的 !nd_* 变换后缀；不同平台允许同内容。
 *  没有 http 源（blob/data）不参与 URL 判重，交给既有下载后指纹逻辑。 */
function vrCanonMediaUrl(raw) {
    const s = String(raw || '').trim();
    if (!/^https?:/i.test(s)) { return ''; }
    try {
        const u = new URL(s);
        let path = u.pathname.split('!')[0].replace(/\/+$/, '');
        const host = u.hostname.replace(/^www\./i, '').toLowerCase();
        /* 小红书 CDN 的同一张图每次签名会换「时间戳/哈希」前缀：
         *   .../202611060359/afb41021.../spectrum/1040g34o3205sjv8tk8605
         *   .../202611061013/014f4926.../spectrum/1040g34o3205sjv8tk8605
         * 只有 /spectrum/ 之后才是稳定的素材 ID；CDN 节点子域也会变，
         * 所以统一归一到 xhscdn.com。不这么做，同一批图会被反复下载成 (2)(3)。 */
        if (/(^|\.)xhscdn\.com$/i.test(host)) {
            const m = path.match(/\/spectrum\/(.+)$/i);
            if (m) { return 'xhscdn.com/spectrum/' + m[1].toLowerCase(); }
            return 'xhscdn.com' + path.toLowerCase();
        }
        /* 抖音图床（2026-11-09）：同一个素材每次加载都会换镜像节点和签名，
         * 真正常量只有「桶 + 素材 ID」：
         *   p3-pc-sign.douyinpic.com/tos-cn-i-0813c000-ce/<id>~tplv-dy-aweme-images:q75.webp
         *   p9-pc.douyinpic.com/tos-cn-i-0813c000-ce/<id>~tplv-dy-aweme-images:q75.jpeg
         * `~tplv-` 之后是「处理指令/格式」，同一张图会在 webp/jpeg/q75 之间来回换，
         * 不剥掉就永远判不出「这是同一张」。**只用于识别**，下载仍用原始 URL。 */
        if (/(^|\.)douyinpic\.com$/i.test(host)) {
            path = path.replace(/~tplv-[^/]*$/i, '');
            return ('douyinpic.com' + path).toLowerCase();
        }
        return (host + path).toLowerCase();
    } catch (e) {
        return s.split('#')[0].split('?')[0].split('!')[0].toLowerCase();
    }
}

function vrSiteKey(site) {
    const x = String(site || '').toLowerCase();
    if (x === 'xhs') { return 'xiaohongshu'; }
    if (x === 'x') { return 'x'; }
    return x;
}

async function vrFindExistingMedia(item) {
    try {
        if (!self.VRDB || typeof self.VRDB.getAllFiles !== 'function') { return null; }
        const it = item || {};
        const key = vrCanonMediaUrl(it.url);
        const plat = vrSiteKey(it.site);
        const kind = String(it.kind || '');
        const workId = String(it.workId || '');
        if (!key && !(kind === 'video' && (it.pageUrl || workId))) { return null; }
        const all = await self.VRDB.getAllFiles();
        for (let i = 0; i < all.length; i++) {
            const e = all[i] || {};
            if (!e.relPath || e.state === 'missing') { continue; }
            if (plat && e.platform && e.platform !== plat) { continue; }
            const vals = [vrCanonMediaUrl(e.sourceUrl), vrCanonMediaUrl(e.mediaUrl)].filter(Boolean);
            if (key && vals.indexOf(key) >= 0) { return e; }
            /* 作品键优先（B站 bvid_cid_档位）：一条页面多集时，pageUrl 相同
             * 绝不能当重复 —— 那会把第 2P、第 3P 全拦掉（2026-11-12 报障根因）。 */
            if (workId && e.workId && String(e.workId) === workId && e.type === 'video') { return e; }
            /* 视频以原帖作为来源键 —— 但必须确认那条记录**也是视频**。
             * 2026-11-06 实测：同一条小红书笔记的图片和视频共享 pageUrl，
             * 图片先入库后，视频被这条兜底误判成「重复」直接跳过，
             * 用户看到的就是「下载失败 / 没有视频」。
             * 只有图片端（kind=video）与记录端（e.type=video）都成立才算重复。 */
            if (!workId && kind === 'video' && it.pageUrl && e.pageUrl &&
                e.pageUrl === it.pageUrl && e.type === 'video') { return e; }
        }
        return null;
    } catch (e) { return null; }
}

async function vrResolveContentOrigin(hit, selfRel) {
    try {
        if (!hit) { return null; }
        let cur = hit;
        let hops = 0;
        /* 引用只允许一跳，指向实体。历史上出现过「两张互相指向的引用卡」
         * （2026-11-09 实测：一条实体都不剩，预览全挂）—— 这里顺着 refOf
         * 追到实体；追不到（链断/自指/环）就当没有原件，让当前条目自己当实体。 */
        while (cur && cur.isRef && cur.refOf && hops++ < 6) {
            if (cur.refOf === selfRel) { return null; }
            const next = await self.VRDB.getFile(cur.refOf);
            if (!next) { return null; }
            cur = next;
        }
        if (!cur || cur.isRef) { return null; }
        if (selfRel && cur.relPath === selfRel) { return null; }
        return cur;
    } catch (e) {
        return null;
    }
}

/**
 * 落盘后的**内容**判重（2026-11-09，B-67）。
 *
 * 为什么需要第三道：URL 归一键只认「同一个素材地址的不同变体」，认不出
 * 「同一张图换了路径/换了图床桶/另一个平台发的」。苏哥的原话是「点了还是
 * 多一份」—— 实测就是这类：sha256 相同、URL 不同、URL 级永远放行。
 *
 * 做法：算指纹 → 库里已有同指纹（非引用/非回收站）→ 删掉刚落盘的副本 →
 * 库里把这条标成 isRef 引用卡（物理一份、索引多份，符合苏哥口径）。
 *
 * 两条铁律（都踩过）：
 *   ① 删文件只能走 FSA 句柄（VRSave.removeFile）。fetch(file://,DELETE)
 *      返回 ok 但根本不删 —— 会出现「库说引用、盘上还在」。
 *   ② 先改库、后删文件，且**只有条目真的在库里**才删；否则会留下一条
 *      指向已删文件的死卡。删失败就回滚成实体条目，宁可留着副本也不说谎。
 *
 * @param {string} relPath 库内相对路径（与入库 relPath 同口径）
 * @returns {Promise<{hash:string, dup:boolean, removed:boolean, refOf:string}>}
 */
async function vrImgContentDedupe(relPath) {
    const out = { hash: '', dup: false, removed: false, refOf: '' };
    try {
        const D = self.VRDedup, S = self.VRSave, DB = self.VRDB;
        if (!D || typeof D.hashFile !== 'function' || !DB || !relPath) { return out; }
        if (!S || typeof S.resolveAbsPath !== 'function' || typeof S.removeFile !== 'function') { return out; }

        const abs = await S.resolveAbsPath(relPath);
        if (!abs) { return out; }
        const hash = await D.hashFile(abs);
        if (!hash) { return out; }
        out.hash = hash;

        const origin = await vrResolveContentOrigin(await D.findByHash(hash, relPath), relPath);
        if (!origin) {
            /* 首次见到这个内容（或者命中的是坏引用链）：记住指纹，让「同一批里
             * 连下两份」也能判出来；同时显式把 isRef 归零，自愈历史坏链。 */
            if (typeof D.rememberHash === 'function') { D.rememberHash(hash, relPath, abs); }
            try { await DB.patchFile(relPath, { sha256: hash, isRef: 0, refOf: '' }); } catch (e0) { /* 条目可能还没入库 */ }
            return out;
        }

        out.dup = true;
        out.refOf = String(origin.relPath || '');
        let patched = null;
        try {
            patched = await DB.patchFile(relPath, {
                sha256: hash,
                isRef: 1,
                refOf: origin.relPath,
                absPath: origin.absPath || abs
            });
        } catch (e1) { patched = null; }

        if (!patched) {
            /* 条目不在库（relPath 口径不一致，比如用户自定义目录）→ 绝不能删文件，
             * 否则磁盘少一份、库里也查不到，用户直接丢图。 */
            out.dup = false;
            return out;
        }

        const gone = await S.removeFile(relPath);
        if (gone) {
            out.removed = true;
            return out;
        }

        /* 删不掉：回滚成实体条目。库与磁盘必须一致 —— 宁可承认「有副本」，
         * 也不能出现「库说没有、盘上躺着一份」的幽灵状态。 */
        out.removed = false;
        try {
            await DB.patchFile(relPath, { isRef: 0, refOf: '', absPath: abs });
        } catch (e2) { /* 回滚失败也只能记账，下次「扫描重复」会修 */ }
        return out;
    } catch (e) {
        return out;
    }
}

/**
 * 「这份文档」的归属键：用来判断一条嗅探记录是不是属于当前页面。
 *
 * 2026-11-11（苏哥报「小红书下到的不是我点那个视频」，且怀疑是通用问题 —— 确实是）：
 * 嗅探缓存是**按 tabId 累积**的，而小红书/微博/YouTube 这类 SPA 切换内容不换 tab。
 * 逛过 A、B 两篇笔记后，池子里同时躺着 A 和 B 的视频；再按「分辨率最高」排序，
 * 拿到的往往是被逛过的那条更高清的 B —— 点的 A、下的是 B。
 *
 * 规则：origin(去 www) + pathname + 「内容 id 类」查询参数。
 * 签名/token/utm 一律丢掉（小红书每次进笔记的 xsec_token 都不同，整串比较会误杀）。
 */
function vrDocKey(u) {
    /* 实现在 VRVideoQuality.docKey（纯函数，tools/test-video-quality.js 有单测）。
     * 模块没加载时退回「去掉 query/hash 的整串」，宁可宽松也不误杀。 */
    try {
        if (self.VRVideoQuality && typeof self.VRVideoQuality.docKey === 'function') {
            return self.VRVideoQuality.docKey(u);
        }
    } catch (e) { /* 落到兜底 */ }
    try {
        return String(u || '').split('#')[0].split('?')[0].toLowerCase();
    } catch (e2) {
        return '';
    }
}

/** 去重标识：不依赖 URL 的签名/token 参数。同作品同媒体视为重复。
 *  statusId/noteId/awemeId/mediaId 优先，URL 只保留 origin+pathname。 */
function vrMediaIdentity(it) {
    const i = it || {};
    let clean = String(i.url || '');
    try {
        const u = new URL(clean);
        clean = u.origin + u.pathname;
    } catch (e) {
        clean = clean.split('?')[0].split('#')[0];
    }
    const work = i.statusId || i.noteId || i.awemeId || i.mediaId || i.key || '';
    return [i.site || '', work, i.mediaId || '', i.kind || '', clean].join('|');
}

function vrDedupLoad() {
    return new Promise(function (resolve) {
        try {
            chrome.storage.local.get('vrMediaSeen', function (x) {
                const arr = (x && x.vrMediaSeen) || [];
                resolve(new Set(Array.isArray(arr) ? arr : []));
            });
        } catch (e) {
            resolve(new Set());
        }
    });
}

function vrDedupSave(seen) {
    try {
        chrome.storage.local.set({ vrMediaSeen: Array.from(seen).slice(-8000) });
    } catch (e) { /* ignore */ }
}

async function vrBulkDownload(items, tabId) {
    const raw = Array.isArray(items) ? items : [];
    const list = raw.slice();
    const seen = await vrDedupLoad();
    const batch = new Set();
    let done = 0;
    let skipped = 0;
    let failed = 0;
    let hardFail = 0;
    let failStreak = 0;
    let paused = false;
    let pauseReason = '';
    for (let i = 0; i < list.length; i++) {
        const it = list[i] || {};
        // X 主页视频是 blob，按推文坐标用 fxtwitter 解析完整 MP4
        if (!it.url && it.kind === 'video' && it.site === 'x') {
            it.url = await fetchXVideo(it.user, it.statusId, it.mediaId, true);
        }
        const mediaKey = vrMediaIdentity(it);
        if (mediaKey && (seen.has(mediaKey) || batch.has(mediaKey))) {
            // 已有记录 / 本次已入队：跳过，不发起下载
            skipped++;
            try {
                chrome.tabs.sendMessage(tabId, {
                    Message: 'vrBulkProgress', done: done, skipped: skipped,
                    total: list.length, paused: false
                });
            } catch (e) { /* ignore */ }
            continue;
        }
        if (mediaKey) { batch.add(mediaKey); }
        if (!it.url || !/^https?:/i.test(it.url)) {
            failStreak++;
        } else {
            const name = vrBulkName(it, i);
            let ok = false;
            let skipDup = false;
            if (it.site === 'x') {
                // X CDN 允许 downloads；按媒体库平台/作者/类型落盘。
                // meta 必须显式传：FSA 直写不产生下载事件，只靠路径反解会丢
                // 原帖地址（详情页「来源」整块空白，2026-11-06 反馈）。
                const xRel = vrMediaPath(it, name);
                const id = await vrDownloadWithName(it.url, xRel, { meta: vrBulkMeta(it, xRel) });
                if (id !== null) {
                    const outcome = await vrWaitDownload(id, 15000);
                    if (outcome && outcome.state === 'interrupted') {
                        try { vrDropDownload(id); } catch (e) { /* ignore */ }
                        /* 404（SERVER_BAD_CONTENT）是内容不存在，不是风控：
                         * 之前 URL 拼错全 404，连败 3 次误报「疑似风控」暂停。
                         * 内容错误不计入风控连败，继续下一条。 */
                        if (outcome.error === 'SERVER_BAD_CONTENT' ||
                            outcome.error === 'FILE_INVALID' ||
                            outcome.error === 'SERVER_BAD_RANGE') {
                            hardFail++;
                            ok = null;   // null=内容错误：不算成功也不算风控失败
                        }
                    } else {
                        ok = true;
                    }
                }
            } else if (it.site === 'xhs') {
                // 小红书页面 fetch 被 CORS 拒绝，走后台下载；统一进媒体库目录。
                // 图片优先试「去后缀原图」，失败自动回退带后缀的原始地址。
                const attempt = async function (u, ext) {
                    const savedUrl = it.url;
                    const savedExt = it.ext;
                    if (u) { it.url = u; }
                    if (ext) { it.ext = ext; }
                    const nm = vrBulkName(it, i);
                    const r = await vrBulkSaveItem(it, nm, 20000);
                    it.url = savedUrl;
                    it.ext = savedExt;
                    return r || null;
                };
                /* 原图升级（抄「小红书下载助手」的做法，但不盲目）：
                 * 先用 HEAD 探一下 ci.xiaohongshu.com 那条原图地址是否真的存在。
                 * 实测有素材 ID 在 ci 上是 404（1040g2sg... 样本），
                 * 不探测就优先原图 = 每张图先白跑一次失败。
                 * 探测通过才用原图，否则完全保持原来的路径 —— 只可能更好，不会更差。 */
                let firstUrl = it.url;
                let firstExt = it.ext;
                if (it.xhsOriginalUrl && self.VRXhsMedia && self.VRXhsMedia.probeOriginal) {
                    try {
                        const hasOriginal = await self.VRXhsMedia.probeOriginal(it.xhsOriginalUrl, 3000);
                        if (hasOriginal) {
                            firstUrl = it.xhsOriginalUrl;
                            firstExt = 'jpg';           // ci 域回原始 jpeg
                        }
                    } catch (e) { /* 探测失败就当没有原图 */ }
                }
                let r = await attempt(firstUrl, firstExt);
                if ((!r || !r.ok) && it.urlFallback) { r = await attempt(it.urlFallback, it.extFallback); }
                if (r && r.skipped) { skipDup = true; }
                ok = !!(r && r.ok);
            } else {
                // 微博等主页批量：不能走页面 <a download>（不认目录、多次点击会被
                // 浏览器拦截，实测只剩第 1 条落到 Downloads 根目录）。这里统一走
                // 带 filename + 预登记 meta 的下载器/FSA 通道。
                const r = await vrBulkSaveItem(it, name, 20000);
                if (r && r.skipped) { skipDup = true; }
                ok = !!(r && r.ok);
            }
            if (ok === true) {
                /* 重复来源不发起下载，也不能算「完成 N 个文件」——
                 * 之前这里把 skipped 当成功，UI 显示下载了 5 个但磁盘没有新文件。 */
                if (skipDup) { skipped++; }
                else { done++; }
                failStreak = 0;
                if (mediaKey) { seen.add(mediaKey); }
            } else if (ok === null) {
                failed++;          // 内容错误：计入失败但不触发风控暂停
                failStreak = 0;
            } else {
                failed++;
                failStreak++;
            }
        }
        /* 只有限流类失败（403/网络错误）才暂停；404 内容错误继续走。
         * 且只有「还没成功过就连续失败」才像风控——成功过几条后再失败
         * 更可能是单条内容问题。 */
        if (failStreak >= 3 && done === 0) {
            paused = true;
            pauseReason = '连续失败 3 次且无一成功，已暂停（可能触发风控）';
            break;
        }
        try {
            chrome.tabs.sendMessage(tabId, {
                Message: 'vrBulkProgress', done: done, skipped: skipped,
                failed: failed, total: list.length, paused: paused,
                reason: pauseReason
            });
        } catch (e) { /* 页面关了 */ }
        await vrBulkSleep((it.site === 'x' || it.site === 'xhs')
            ? 3000 + Math.floor(Math.random() * 2000)
            : vrBulkDelay());
    }
    vrDedupSave(seen);
    return {
        ok: true, total: list.length, done: done, skipped: skipped,
        failed: failed + hardFail, hardFail: hardFail,
        paused: paused, reason: pauseReason
    };
}

/**
 * F2 溯源：在页面上下文抓「原帖/作者ID/作品ID/平台」。
 * 全部 try/catch 包裹——埋点异常不得影响下载（铁律）。
 * 优先用 naming.js 已提取的页面信息，失败退回 URL 解析。
 */
async function vrTraceMetaInTab(tabId) {
    try {
        const r = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: function () {
                try {
                    var N = self.VideoRodNaming;
                    var info = N ? (N.extractPageInfo(document, location.href) || {}) : {};
                    var out = {
                        pageUrl: location.href || '',
                        author: info.author || '',
                        authorId: info.authorId || '',
                        authorHandle: info.authorHandle || '',
                        authorState: info.author ? 'ok' : 'unsupported',
                        title: info.title || '',
                        post: info.post || '',
                        site: info.site || ''
                    };
                    // 作品 ID：优先页面显式链接，其次 URL 里的 id 段
                    var work = '';
                    var a = document.querySelector('a[href*="/video/"], a[href*="/status/"], a[href*="/note/"], a[href*="/watch"], a[href*="/p/"]');
                    if (a) {
                        var m = String(a.getAttribute('href') || '').match(/\/(?:video|status|note|watch|p)\/([A-Za-z0-9_-]{6,})/);
                        if (m) { work = m[1]; }
                    }
                    if (!work) {
                        var mu = String(location.href).match(/[?&](?:item_?id|v=|status_?id|video_?id)=([A-Za-z0-9_-]{6,})/i);
                        if (mu) { work = mu[1]; }
                    }
                    out.workId = work;
                    return out;
                } catch (e) { return null; }
            }
        });
        const v = r && r[0] && r[0].result;
        return v || null;
    } catch (e) { return null; }
}

async function vrPageMetaInTab(tabId) {
    // 1) 微博 feed：内容脚本在点击视频卡片时记录了作者/文案（isolated world）
    try {
        const r = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: function () { return window.__vrFeedMeta || null; }
        });
        const m = r && r[0] && r[0].result;
        if (m && (m.author || m.title) && (!m.at || Date.now() - m.at < 30 * 60 * 1000)) {
            return m;
        }
    } catch (e) { /* ignore */ }

    // 2) 微博 status 页：MAIN world 的 $render_data
    try {
        const r = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            func: function () {
                try {
                    const rd = window.$render_data;
                    let s = rd && rd.status;
                    if (Array.isArray(s)) { s = s[0]; }
                    if (!s) { return null; }
                    let text = s.text || '';
                    text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    const u = s.user || {};
                    return {
                        title: text.slice(0, 200),
                        post: text.slice(0, 200),
                        author: u.screen_name || '',
                        authorId: u.id ? String(u.id) : '',
                        site: 'weibo'
                    };
                } catch (e) { return null; }
            }
        });
        return (r && r[0] && r[0].result) || null;
    } catch (e) { return null; }
}

try {
    chrome.alarms.onAlarm.addListener(function (a) {
        if (a && a.name === VR_MEDIA_HEADER_ALARM) {
            /* 清理整池规则（原来是单条 91001，现在按域名分配多个 ID） */
            const ids = [];
            for (let i = 0; i < VR_MEDIA_HEADER_RULE_MAX; i++) {
                ids.push(VR_MEDIA_HEADER_RULE_BASE + i);
            }
            vrHeaderRuleByDomain.clear();
            chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
        }
    });
} catch (e) { /* ignore */ }

/** 页内按钮：查询这个标签页能下哪些清晰度 */
/** 给可能卡死的异步步骤加硬超时。
 *  2026-11-05 实测：抖音详情接口偶发不返回，executeScript 会一直 pending，
 *  面板就永远停在「正在问这个网站能下哪些清晰度…」，用户只能看着转圈。
 *  超时后抛错 → 上层 catch 落到下一个分支（最差也有嗅探缓存可用）。 */
function vrWithTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise(function (_, reject) {
            setTimeout(function () { reject(new Error('timeout:' + label + ':' + ms)); }, ms);
        })
    ]);
}

/**
 * 微博：用 mid 去详情接口换最高清直链。
 *
 * 背景：嗅探只能看到浏览器实际请求过的码率，微博信息流默认播 720p，
 * 所以「排序嗅探结果」永远拿不到 1080p —— 必须主动问接口。
 *
 * 参考实现：星愿里装的「笃笃微博视频下载器」v0.16.14，
 * 它用 `GET /ajax/statuses/show?id=<mid>&locale=zh-CN` 取
 * `page_info.media_info`，再按 mp4_hd_url > stream_url_hd > mp4_sd_url 取直链。
 *
 * 关键差异：**必须在页面主世界 fetch**。
 * 扩展上下文请求会被微博 302 到 passport.weibo.com/visitor/visitor（实测），
 * 页面上下文自带 Cookie 与 Referer 才通。
 *
 * @param {number} tabId
 * @param {string} mid
 * @returns {Promise<{variants:Array<{url:string,height:number,size:number,bitrate:number,quality:string}>}|null>}
 */
async function vrWeiboHdProbe(tabId, seedIds) {
    const seeds = (Array.isArray(seedIds) ? seedIds : [seedIds]).filter(Boolean).slice(0, 4);
    try {
        const r = await vrWithTimeout(chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            args: [seeds.map(String)],
            func: async function (extraIds) {
                /* ⚠️ 这里跑在**页面主世界**，没有 VRVideoQuality（它只装在后台 SW 里）。
                 * 老实现写成 `const Q = self.VRVideoQuality; if (!Q) return null;`
                 * —— 恒真分支，补高清从来没成功过，用户看到的上限就是嗅探到那一档。
                 * 现在这里只负责「找 id + 取 JSON」，解析交给后台。 */
                const ids = [];
                const push = function (v) {
                    v = String(v == null ? '' : v).trim();
                    if (/^\d{15,20}$/.test(v) && ids.indexOf(v) < 0) { ids.push(v); }
                };

                /* status id（微博正文 id）来源：
                 *   · URL：/status/<id>、/detail/<id>、/<uid>/<id>
                 *   · 卡片属性：mid / data-mid / data-status-id
                 *   · 链接：//weibo.com/<uid>/<statusId>（tv/show 页的发布时间链接）
                 * 注意 ajax/statuses/show 要的是**正文 id**，不是 media_id；
                 * 传 media_id 会返回 {ok:0, error_code:20101, 该微博不存在}。 */
                const path = String(location.pathname || '');
                let m;
                if ((m = path.match(/\/(?:status|detail)\/(\d{15,20})/))) { push(m[1]); }
                if ((m = path.match(/\/\d{5,15}\/(\d{15,20})(?:[/?#]|$)/))) { push(m[1]); }
                /* video.weibo.com/show?fid=1034:<id> —— 视频播放页的 id 在 query 里，
                 * 不解析 query 就只剩 DOM 一条来源（2026-11-12 苏哥给的 t.cn 短链
                 * 展开后正是这种形态）。 */
                const qs = String(location.search || '');
                if ((m = qs.match(/[?&]fid=\d+:(\d{15,20})/))) { push(m[1]); }
                if ((m = qs.match(/[?&](?:mid|id)=(\d{15,20})/))) { push(m[1]); }

                try {
                    document.querySelectorAll('[mid],[data-mid],[data-status-id]').forEach(function (el) {
                        push(el.getAttribute('mid'));
                        push(el.getAttribute('data-mid'));
                        push(el.getAttribute('data-status-id'));
                    });
                } catch (e0) { /* 选择器异常不影响继续 */ }

                try {
                    document.querySelectorAll('a[href]').forEach(function (a) {
                        const h = a.getAttribute('href') || '';
                        let mm;
                        if ((mm = h.match(/\/(?:status|detail)\/(\d{15,20})/))) { push(mm[1]); }
                        else if ((mm = h.match(/weibo\.(?:com|cn)\/\d{5,15}\/(\d{15,20})/))) { push(mm[1]); }
                        else if ((mm = h.match(/^\/\d{5,15}\/(\d{15,20})$/))) { push(mm[1]); }
                    });
                } catch (e1) { /* 同上 */ }

                extraIds.forEach(push);   // media_id 等兜底种子，放最后

                const base = 'https://' + (location.hostname || 'weibo.com');
                for (let i = 0; i < ids.length && i < 4; i++) {
                    try {
                        const res = await fetch(base + '/ajax/statuses/show?id=' +
                            encodeURIComponent(ids[i]) + '&locale=zh-CN', {
                            credentials: 'include',
                            headers: { accept: 'application/json, text/plain, */*' }
                        });
                        if (!res.ok) { continue; }
                        const j = await res.json();
                        if (!j || Number(j.ok) !== 1) { continue; }   // 20101 = 不是正文 id
                        const pi = (j.page_info && j.page_info.media_info) || null;
                        if (!pi) { continue; }
                        /* 只回传需要的部分：整条微博对象几十上百 KB，没必要跨界搬。 */
                        return { statusId: ids[i], media: pi };
                    } catch (e2) { /* 试下一个 */ }
                }
                return null;
            }
        }), 8000, 'weibo-hd');
        const got = r && r[0] && r[0].result;
        if (!got || !got.media) { return null; }
        const Q = self.VRVideoQuality;
        if (!Q || typeof Q.weiboVariants !== 'function') { return null; }
        const variants = Q.weiboVariants({ page_info: { media_info: got.media } });
        if (!variants.length) { return null; }
        return { variants: variants, statusId: got.statusId || '' };
    } catch (e) { return null; }
}

/**
 * 展开 HLS master：把每个 variant 拉成独立候选。
 *
 * 拉取放在页面主世界（带 Cookie/Referer），解析交给 VRVideoQuality.parseHlsMaster。
 * 只处理 master（含 #EXT-X-STREAM-INF）；媒体清单（纯分片）没有 variant，直接跳过。
 *
 * @param {number} tabId
 * @param {string[]} urls master 地址列表
 * @returns {Promise<Array<{url:string, height:number, bandwidth:number}>>}
 */
async function vrExpandHlsMasters(tabId, urls) {
    const list = Array.isArray(urls) ? urls.filter(Boolean).slice(0, 3) : [];
    if (!list.length) { return []; }
    try {
        const r = await vrWithTimeout(chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            args: [list],
            func: async function (masters) {
                const Q = self.VRVideoQuality;
                if (!Q) { return []; }
                const out = [];
                for (const u of masters) {
                    try {
                        const res = await fetch(u, { credentials: 'include' });
                        if (!res.ok) { continue; }
                        const text = await res.text();
                        const variants = Q.parseHlsMaster(text, u);
                        for (const v of variants) {
                            out.push({ url: v.url, height: v.height || 0,
                                bandwidth: v.bandwidth || 0 });
                        }
                    } catch (e) { /* 单个 master 失败不影响其他 */ }
                }
                return out.slice(0, 12);
            }
        }), 8000, 'hls-master');
        return (r && r[0] && r[0].result) || [];
    } catch (e) { return []; }
}

/**
 * 探测 DASH MPD：拉取并解析，返回最高视频档的宽高与码率。
 *
 * 只用于「识别 + 排序」，不在这里合并分片（合并交给既有 mpd 处理页）。
 * 拉取在页面主世界做（带 Cookie/Referer），解析用 VRVideoQuality.parseDashMpd。
 *
 * @param {number} tabId
 * @param {string[]} urls
 * @returns {Promise<{height:number, width:number, bandwidth:number}|null>}
 */
async function vrProbeDashMpd(tabId, urls) {
    const list = Array.isArray(urls) ? urls.filter(Boolean).slice(0, 2) : [];
    if (!list.length) { return null; }
    try {
        const r = await vrWithTimeout(chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            args: [list],
            func: async function (mpds) {
                const Q = self.VRVideoQuality;
                if (!Q) { return null; }
                for (const u of mpds) {
                    try {
                        const res = await fetch(u, { credentials: 'include' });
                        if (!res.ok) { continue; }
                        const text = await res.text();
                        const reps = Q.parseDashMpd(text);
                        if (!reps.length) { continue; }
                        const best = Q.pickBestVariant(reps);
                        if (best) {
                            return { height: best.height || 0, width: best.width || 0,
                                bandwidth: best.bandwidth || 0 };
                        }
                    } catch (e) { /* 换下一个 */ }
                }
                return null;
            }
        }), 8000, 'dash-mpd');
        return (r && r[0] && r[0].result) || null;
    } catch (e) { return null; }
}

/** 通用：从页面内嵌 JSON / 全局变量里找视频直链。
 *  为什么需要：TikTok 等站用 MSE(blob:) 播放，网络嗅探看到的是分片，
 *  通用嗅探缓存里一条完整 mp4 都没有 → 面板显示「还没被嗅探到」。
 *  这些站会把 playAddr / downloadAddr 等直链写进页面内嵌数据。
 *  这是通法（任何页面内嵌视频地址都受益），不是站点特例。 */
async function vrPageEmbeddedVideoProbe(tabId) {
    try {
        const r = await vrWithTimeout(chrome.scripting.executeScript({
            target: { tabId: tabId }, world: 'MAIN',
            func: function () {
                // 用一次 JSON.stringify + 正则，不递归对象树：
                // 递归遍历 TikTok 的 200KB+ 内嵌数据会卡住页面主线程（实测 WS 超时）。
                var urls = [], seen = Object.create(null);
                var names = Object.keys(window).filter(function (k) { return /^__/.test(k); });
                for (var i = 0; i < names.length && urls.length < 6; i++) {
                    var txt;
                    try { txt = JSON.stringify(window[names[i]]); } catch (e) { continue; }
                    if (!txt || txt.length > 3000000) { continue; }
                    var cand = txt.match(/https?:[^"'\s\\]{20,700}/g) || [];
                    for (var j = 0; j < cand.length && urls.length < 6; j++) {
                        var u = cand[j].replace(/\\\//g, '/');
                        if (!/mime_type=video_mp4|\.mp4(\?|$)|\/video\/tos\//i.test(u)) { continue; }
                        if (!seen[u]) { seen[u] = 1; urls.push(u); }
                    }
                }
                var ss = document.querySelectorAll('script[type="application/json"]');
                for (var k = 0; k < ss.length && urls.length < 6; k++) {
                    var raw = String(ss[k].textContent || '');
                    var m2 = raw.match(/https?:[^"'\s\\]{20,700}/g) || [];
                    for (var n = 0; n < m2.length && urls.length < 6; n++) {
                        var u2 = m2[n];
                        if (/mime_type=video_mp4|\.mp4(\?|$)/i.test(u2) && !seen[u2]) {
                            seen[u2] = 1; urls.push(u2);
                        }
                    }
                }
                return { urls: urls, title: String(document.title || '') };
            }
        }), 6000, 'embedded-video');
        return (r && r[0] && r[0].result) || { urls: [] };
    } catch (e) {
        return { urls: [] };
    }
}

/** Instagram：从页面 hydration JSON 的 video_versions 取完整 MP4。
 *  网络嗅探看到的是 MSE 分片（带 bytestart/byteend），单独下下来只有 moof，
 *  没有 ftyp/moov，Chrome 无法播放。video_versions 的首条是完整 progressive MP4。 */
async function vrIgVideoUrls(tabId) {
    try {
        const r = await vrWithTimeout(chrome.scripting.executeScript({
            target: { tabId: tabId }, world: 'MAIN',
            func: function () {
                const txt = [...document.scripts].map(function (s) { return s.textContent || ''; }).join('\n');
                const i = txt.indexOf('video_versions');
                if (i < 0) { return []; }
                const seg = txt.slice(i, i + 8000);
                const decoded = seg
                    .replace(/\\u([0-9a-f]{4})/gi, function (_, h) {
                        return String.fromCharCode(parseInt(h, 16));
                    })
                    .replace(/\\\//g, '/')
                    .replace(/\\"/g, '"');
                const out = [], seen = {};
                const re = /"url"\s*:\s*"(https?:[^"]+)"/g;
                let m;
                while ((m = re.exec(decoded)) && out.length < 3) {
                    const u = m[1].replace(/\\u0026/g, '&');
                    if (!/\.mp4(\?|$)/i.test(u)) { continue; }
                    // 只要完整文件；分片地址下下来是不可播放的 moof
                    if (/[?&](bytestart|byteend)=/i.test(u)) { continue; }
                    if (!seen[u]) { seen[u] = 1; out.push(u); }
                }
                return out;
            }
        }), 6000, 'ig-video-versions');
        return (r && r[0] && r[0].result) || [];
    } catch (e) {
        return [];
    }
}

/** 取「同一媒体」的主干键：目录 + 文件名去掉变体后缀与扩展名。
 *
 *  典型变体（实测 MSN）：
 *    https://msn2.go2yd.com/video/087d2e….mp4            原始直链（403，需签名）
 *    https://msn2.go2yd.com/video/087d2e….mp4_bd.mp4     转码直链（可用）
 *  两者是同一个片子。主干 = 目录 + 32 位 hash。
 *
 *  只有主干足够长（≥16）才当媒体名，否则 `video.mp4` 这种会把整站合成一条。
 */
function vrMediaStem(url) {
    const s = String(url || '').split('#')[0].split('?')[0];
    const i = s.lastIndexOf('/');
    const dir = i >= 0 ? s.slice(0, i) : '';
    let name = i >= 0 ? s.slice(i + 1) : s;
    /* 反复剥：`x.mp4_bd.mp4` 要剥两层（先扩展名、再变体后缀，然后再一次扩展名）
     * 才能和 `x.mp4` 落到同一个主干。只剥一遍会得到 `x.mp4` ≠ `x`（实测踩到）。 */
    let prev = '';
    for (let guard = 0; guard < 6 && name !== prev; guard++) {
        prev = name;
        name = name.replace(/\.(?:mp4|webm|mov|mkv|flv|m4v|ts|m4s|m3u8|mpd|mp3|m4a|aac)$/i, '');
        /* 常见变体后缀：_bd / _hd / _sd / -hd / _1080p / _720p … */
        name = name.replace(/[-_](?:bd|hd|sd|ld|uhd|fhd|\d{3,4}p)$/i, '');
    }
    if (name.length < 16) { return ''; }
    return dir + '/' + name;
}

/** 候选归一化：分片还原 + 同媒体归并。
 *  @param {Array} list 嗅探缓存里的候选（形如 {url, ext, size, type}）
 *  @returns {Array} 归并后的候选；被还原的项带 srcUrl（原始分片地址，下载失败时回退）
 */
function vrNormalizeCandidates(list) {
    const VQ = self.VRVideoQuality;
    const byStem = new Map();
    const out = [];

    /* 信息完整度：有 content-type 和体积的，是「浏览器真拉成功过」的实测记录 */
    const score = function (x) {
        return (x && x.type ? 2 : 0) + (Number(x && x.size) ? 1 : 0);
    };

    (list || []).forEach(function (m) {
        if (!m || !m.url) { return; }

        const seg = VQ && VQ.unsegmentUrl ? VQ.unsegmentUrl(m.url) : { segmented: false, url: m.url };
        const item = Object.assign({}, m);
        if (seg.segmented) {
            item.srcUrl = m.url;      // 原始分片地址，只在完整地址失败时回退
            item.url = seg.url;
            item.segmented = true;
        }

        /* 归并键：优先按「同媒体主干」，主干认不出来才退回整条 URL */
        const stem = vrMediaStem(item.url);
        const key = stem || item.url;
        const prev = byStem.get(key);
        if (!prev) {
            byStem.set(key, item);
            out.push(item);
            return;
        }

        /* 已有同媒体的：保留信息更全的那条，另一条只用来补缺 */
        const win = score(item) > score(prev) ? item : prev;
        const lose = win === item ? prev : item;
        if (!win.srcUrl && lose.srcUrl) { win.srcUrl = lose.srcUrl; }
        if (!win.size && lose.size) { win.size = lose.size; }
        if (!win.type && lose.type) { win.type = lose.type; }
        if (!win.height && lose.height) { win.height = lose.height; }
        if (!win.segmented && lose.segmented) { win.segmented = true; }
        if (win !== prev) {
            const i = out.indexOf(prev);
            if (i >= 0) { out[i] = win; }
            byStem.set(key, win);
        }
    });

    return out;
}

/** 出列表前给候选做一次可达性预检。
 *
 *  为什么必须有（苏哥 2026-11-09「MSN 这个视频下载不了」）：
 *  同一个片子会被嗅探记成两条 ——
 *    · `.../video/<hash>.mp4`          原始直链，需签名 → 直接请求 **403**
 *    · `.../video/<hash>.mp4_bd.mp4`   转码直链 → 200 可用
 *  页面预加载时先发的是前者，于是列表里一半是死链，用户点哪条都失败。
 *  光靠「有没有 content-type」分不出来（死链那条可能压根没记录响应头）。
 *
 *  规则（保守，宁可留下不可用的，也不误杀可用的）：
 *    · 明确 4xx/5xx        → 丢弃（服务器自己说不行）
 *    · 2xx / 206            → 留下，并回填 type 与真实大小（Content-Range 的总长）
 *    · 网络错误 / CORS 拦截 → 留下（扩展探测不了 ≠ 不可用）
 *
 *  请求都在页面主世界发，自带 Referer/Cookie —— 扩展上下文发会被 CDN 拒。
 *  每条 3 秒超时，整批并发，不阻塞列表打开。
 */
async function vrProbeCandidates(tabId, list) {
    const rows = (list || []).filter(function (m) { return m && /^https?:/i.test(m.url || ''); });
    if (!rows.length) { return list; }

    /* 已经有 type + 体积的，说明浏览器真拉成功过，不用再探 */
    const need = rows.filter(function (m) { return !(m.type && Number(m.size)); });
    if (!need.length) { return list; }

    /* 在页面主世界探测：自带 Referer/Cookie，扩展上下文发会被部分 CDN 拒。
     * Range: bytes=0-1 只取 2 字节，代价可忽略。 */
    const probe = async function (urls) {
        if (!urls || !urls.length) { return []; }
        try {
            const r = await vrWithTimeout(chrome.scripting.executeScript({
                target: { tabId: tabId },
                args: [urls],
                func: function (list) {
                    return Promise.all(list.map(function (u) {
                        return new Promise(function (res) {
                            var done = false;
                            var finish = function (o) { if (done) { return; } done = true; res(o); };
                            var ac = new AbortController();
                            var tm = setTimeout(function () {
                                try { ac.abort(); } catch (e) { /* ignore */ }
                                finish({ u: u, state: 'timeout' });
                            }, 3000);
                            fetch(u, { headers: { Range: 'bytes=0-1' }, signal: ac.signal })
                                .then(function (resp) {
                                    clearTimeout(tm);
                                    var cr = resp.headers.get('content-range') || '';
                                    var cl = Number(resp.headers.get('content-length')) || 0;
                                    var total = 0;
                                    var m = /\/(\d+)\s*$/.exec(cr);
                                    if (m) { total = Number(m[1]) || 0; }
                                    if (!total && cl && resp.status === 200) { total = cl; }
                                    finish({
                                        u: u, state: 'http', status: resp.status,
                                        type: (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(),
                                        size: total
                                    });
                                }, function () {
                                    clearTimeout(tm);
                                    /* 网络/CORS 失败：不当成「不可用」 */
                                    finish({ u: u, state: 'neterr' });
                                });
                        });
                    }));
                }
            }), 8000, 'candidate-probe');
            return (r && r[0] && r[0].result) || [];
        } catch (e) { return []; }
    };

    const byUrl = {};
    (await probe(need.map(function (m) { return m.url; }))).forEach(function (x) {
        if (x && x.u) { byUrl[x.u] = x; }
    });

    /* ---- 第二轮：死链试「同媒体变体」 ----
     *
     * 苏哥 2026-11-09「MSN 的视频为什么下不了」的根因就在这里：
     * 原始直链是**签名墙**的（403，换什么 Referer/Origin/UA 都没用，实测 6 种组合全 403），
     * 而同一份文件的转码变体是**免签**的：
     *   …/video/xxx.mp4        → 403
     *   …/video/xxx.mp4_bd.mp4 → 206 + 完整 Content-Range  ✅
     * 播放器只在「真的开始播」时才去拉转码地址，用户不播就永远只看到死链。
     * 所以这里主动试一次变体 —— 不用等用户播放。 */
    const VQ = self.VRVideoQuality;
    const deadRows = rows.filter(function (m) {
        const p = byUrl[m.url];
        return p && p.state === 'http' && p.status >= 400;
    });
    if (deadRows.length && VQ && typeof VQ.variantUrls === 'function') {
        const pairs = [];
        deadRows.forEach(function (m) {
            VQ.variantUrls(m.url).forEach(function (alt) { pairs.push({ src: m.url, alt: alt }); });
        });
        if (pairs.length) {
            const byAlt = {};
            (await probe(pairs.map(function (x) { return x.alt; }))).forEach(function (x) {
                if (x && x.u) { byAlt[x.u] = x; }
            });
            pairs.forEach(function (x) {
                const p = byAlt[x.alt];
                if (!p || p.state !== 'http' || p.status >= 400) { return; }
                const m = rows.filter(function (y) { return y.url === x.src; })[0];
                if (!m) { return; }
                /* 换地址，并把原死链留作回溯 */
                m.srcUrl = m.srcUrl || m.url;
                m.url = x.alt;
                m.variant = true;
                delete byUrl[x.src];
                byUrl[x.alt] = p;
            });
        }
    }

    const alive = [];
    const dead = [];
    rows.forEach(function (m) {
        const p = byUrl[m.url];
        if (p && p.state === 'http' && p.status >= 400) { dead.push(m); return; }
        if (p && p.state === 'http') {
            if (!m.type && p.type && /^(video|audio|image)\//.test(p.type)) { m.type = p.type; }
            if (!Number(m.size) && p.size) { m.size = p.size; }
        }
        alive.push(m);
    });

    /* 全被判死 → 原样放回，标记 probeDead。
     * 绝不能因为探测结果把列表清空：探测在页面主世界跑，可能受 CORS/防盗链
     * 影响而误杀（抖音 video/tos、部分 CDN 只认特定 Referer）。
     * 有可用的就只给可用的（MSN 那种一半死链的场景）；一个可用都没有时
     * 宁可把死链列出来让用户看到名字，也不显示「本页没有视频」。 */
    if (!alive.length && dead.length) {
        dead.forEach(function (m) { m.probeDead = true; });
        return dead;
    }
    return alive;
}

/**
 * 抖音图文页取原图列表（Fiber，主世界注入）。
 * 只在 /note/<id> 有 images[]；普通视频页返回 NO_IMAGES，由调用方忽略。
 */
async function vrDouyinImages(sender) {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!(tabId > 0)) { return { ok: false, error: 'NO_TAB' }; }
    if (!self.VR_DOUYIN || typeof self.VR_DOUYIN.noteFunc !== 'function') {
        return { ok: false, error: 'NO_MODULE' };
    }
    try {
        const r = await vrWithTimeout(chrome.scripting.executeScript({
            target: { tabId: tabId }, world: 'MAIN',
            func: self.VR_DOUYIN.noteFunc
        }), 6000, 'douyin-note');
        const info = r && r[0] && r[0].result;
        if (!info || !Array.isArray(info.images) || !info.images.length) {
            return { ok: false, error: 'NO_IMAGES' };
        }
        return {
            ok: true,
            meta: {
                awemeId: info.awemeId || '',
                title: info.title || '',
                nickname: info.nickname || '',
                uniqueId: info.uniqueId || '',
                images: info.images
            }
        };
    } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
    }
}

/**
 * 小红书：从页面 SSR state 里取「当前这篇笔记自己的」视频流（2026-11-11）。
 *
 * 为什么必须单独一条路：
 *   ① 嗅探缓存是**按 tabId 累积**的，小红书切笔记是 SPA（不换 tab、不触发 loading），
 *      逛过 A、B 两篇后池子里混着两条，按「分辨率最高」排第一的往往不是你在看的这条；
 *   ② 笔记页的 <video> 是 `blob:`（MSE），通用分支的「正在播放」探测拿不到真实地址，
 *      于是两段式排序也退化成全局排序 —— 这正是苏哥报的「点的 A、下的 B」。
 *
 * 数据来源：`window.__INITIAL_STATE__.note.noteDetailMap[noteId].note.video.media.stream`，
 * 结构是 { EF4: [...], EF5: [...] }：EF4 是完整 mp4，EF5 是 fmp4 **分片**（.m4s）。
 * 分片单独下一个只有几秒，必须优先完整文件（同 MSN 那个坑）。
 */
async function vrXhsVideoProbe(tabId) {
    try {
        const r = await vrWithTimeout(chrome.scripting.executeScript({
            target: { tabId: tabId }, world: 'MAIN',
            func: function () {
                const m = String(location.pathname || '').match(
                    /\/(?:explore|discovery\/item)\/([0-9a-f]{20,})/i);
                const noteId = m ? m[1] : '';
                const s = window.__INITIAL_STATE__;
                const map = s && s.note && s.note.noteDetailMap;
                if (!map) { return null; }
                let note = (noteId && map[noteId] && map[noteId].note) || null;
                if (!note || !Object.keys(note).length) {
                    /* 详情还没写进对应 key 时，退到「map 里唯一那条带 video 的」 */
                    const k = Object.keys(map).find(function (x) {
                        return map[x] && map[x].note && map[x].note.video;
                    });
                    note = k ? map[k].note : null;
                }
                if (!note) { return null; }
                const v = note.video || null;
                const user = note.user || {};
                const rows = [];
                if (v && v.media && v.media.stream) {
                    Object.keys(v.media.stream).forEach(function (k) {
                        (v.media.stream[k] || []).forEach(function (it) {
                            if (!it || !it.masterUrl) { return; }
                            const url = String(it.masterUrl).replace(/^http:/i, 'https:');
                            rows.push({
                                url: url,
                                backup: (it.backupUrls || []).map(function (u) {
                                    return String(u).replace(/^http:/i, 'https:');
                                }),
                                w: Number(it.width) || 0,
                                h: Number(it.height) || 0,
                                br: Number(it.videoBitrate || it.avgBitrate) || 0,
                                fmt: String(it.format || ''),
                                full: /\.mp4(\?|$)/i.test(url) && !/\.m4s(\?|$)/i.test(url)
                            });
                        });
                    });
                }
                return {
                    noteId: noteId || '',
                    title: String(note.title || '').slice(0, 140),
                    user: String(user.nickname || user.nickName || ''),
                    userId: String(user.userId || ''),
                    rows: rows
                };
            }
        }), 6000, 'xhs-video-probe');
        const info = r && r[0] && r[0].result;
        if (!info || !Array.isArray(info.rows) || !info.rows.length) { return null; }
        return info;
    } catch (e) {
        return null;
    }
}

/**
 * 小红书 live 图（实况照片）探测（2026-11-11）。
 *
 * 每张实况图 = 静态 JPEG（urlDefault）+ 一段 2~3 秒的实况 mp4（stream.EF4）。
 * 侧边栏/面板扫 DOM 只能拿到静态首帧 —— 实况视频必须从 SSR state 里取：
 *   note.noteDetailMap[noteId].note.imageList[i].stream.EF4[0].masterUrl
 *
 * 返回的 rows 每条带 `key`：图片素材 id（URL pathname 尾段、剥掉 `!xx` 变体后缀）。
 * 侧边栏扫描出的 <img> 与 state 的 urlDefault 尾段完全一致（实测），按它匹配
 * 就能把「这张静态图对应的实况 mp4」挂到扫描条目上，不依赖顺序。
 */
async function vrXhsLiveProbe(tabId) {
    try {
        const r = await vrWithTimeout(chrome.scripting.executeScript({
            target: { tabId: tabId }, world: 'MAIN',
            func: function () {
                const m = String(location.pathname || '').match(
                    /\/(?:explore|discovery\/item)\/([0-9a-f]{20,})/i);
                const noteId = m ? m[1] : '';
                const s = window.__INITIAL_STATE__;
                const map = s && s.note && s.note.noteDetailMap;
                if (!map) { return null; }
                let note = (noteId && map[noteId] && map[noteId].note) || null;
                if (!note || !Object.keys(note).length) {
                    const k = Object.keys(map).find(function (x) {
                        return map[x] && map[x].note && Array.isArray(map[x].note.imageList) &&
                            map[x].note.imageList.some(function (im) { return im && im.livePhoto; });
                    });
                    note = k ? map[k].note : null;
                }
                if (!note || !Array.isArray(note.imageList)) { return null; }
                const keyOf = function (u) {
                    try {
                        const seg = new URL(u).pathname.split('/').pop() || '';
                        return seg.replace(/![a-z0-9_]+$/i, '').toLowerCase();
                    } catch (e) { return ''; }
                };
                const rows = [];
                note.imageList.forEach(function (x) {
                    if (!x || !x.livePhoto) { return; }
                    const st = (x.stream && x.stream.EF4) || [];
                    const it = st.find(function (e) { return e && e.masterUrl; });
                    if (!it) { return; }
                    const fix = function (u) { return String(u || '').replace(/^http:/i, 'https:'); };
                    rows.push({
                        key: keyOf(x.urlDefault || (x.infoList && x.infoList[0] && x.infoList[0].url)),
                        url: fix(it.masterUrl),
                        backup: (it.backupUrls || []).map(fix)
                    });
                });
                return { noteId: noteId || '', rows: rows };
            }
        }), 6000, 'xhs-live-probe');
        const info = r && r[0] && r[0].result;
        if (!info || !Array.isArray(info.rows) || !info.rows.length) { return null; }
        return info;
    } catch (e) {
        return null;
    }
}

async function vrVideoOptions(tabId, frameId) {
    const out = { site: 'generic', options: [] };

    // 抖音优先：详情接口一次拿到「当前这条」的元数据和全部清晰度。
    // 不走嗅探缓存 → 不会把推荐位/预览片当成目标（苏哥 2026-10-19 报的选错）。
    //
    // 2026-11-09 改造（拆「智小抖 v2.4.5」所得，见
    // deliverables/reviews/2026-11-09-智小抖拆解-抖音取标题机制.md）：
    // 原来只有一条路 —— parseAwemeId(tab.url) 从 URL 里取作品 ID 再调详情接口。
    // 但抖音精选页/首页的 URL 是 https://www.douyin.com/jingxuan，**不含作品 ID**，
    // 这条路直接返回空 → 掉进通用嗅探分支 → 标题全靠 DOM 选择器 →
    // 而新版抖音把 data-e2e 内容锚点全删了 → 文件名只剩作者名（苏哥报的现象）。
    //
    // 现在两条路：① 爬 React Fiber 从播放器组件抠当前视频（全场景，不依赖 URL/选择器/签名）
    //            ② Fiber 没命中再按 URL 调详情接口（老路，兜底）
    let douyinTried = false;
    try {
        const tab = await chrome.tabs.get(tabId);
        const tabUrl = (tab && tab.url) || '';
        if (/douyin\.com/i.test(tabUrl)) { douyinTried = true; }

        // ① Fiber：不依赖 URL，首页/精选/搜索/用户主页都能拿到当前播放这条
        if (douyinTried) {
            let info = null;
            try {
                const pr = await vrWithTimeout(chrome.scripting.executeScript({
                    target: { tabId: tabId }, world: 'MAIN',
                    func: self.VR_DOUYIN.playerFunc
                }), 6000, 'douyin-fiber');
                info = pr && pr[0] && pr[0].result;
            } catch (e) { /* Fiber 失败 → 落详情接口 */ }

            const rows = info ? self.VR_DOUYIN.normalize(info) : [];
            if (info && rows.length) {
                out.site = 'douyin';
                out.meta = self.VR_DOUYIN.metaFrom(info);
                out.options = rows.map(function (x, i) {
                    return {
                        id: 'dy' + i, kind: 'url', url: x.url,
                        label: self.VR_DOUYIN.labelFor(x),
                        note: i === 0 ? '最高清' : ''
                    };
                });
                return out;
            }
        }

        // ② 详情接口：URL 里有作品 ID 时的老路（Fiber 没命中 / 页面还没渲染完）
        const awemeId = self.VR_DOUYIN.parseAwemeId(tabUrl);
        if (awemeId) {
            const r = await vrWithTimeout(chrome.scripting.executeScript({
                target: { tabId: tabId }, world: 'MAIN',
                args: [awemeId], func: self.VR_DOUYIN.probeFunc
            }), 8000, 'douyin-detail');
            const info = r && r[0] && r[0].result;
            const rows = self.VR_DOUYIN.normalize(info);
            if (info && rows.length) {
                out.site = 'douyin';
                out.meta = self.VR_DOUYIN.metaFrom(info);
                out.options = rows.map(function (x, i) {
                    return {
                        id: 'dy' + i, kind: 'url', url: x.url,
                        label: self.VR_DOUYIN.labelFor(x),
                        note: i === 0 ? '最高清' : ''
                    };
                });
                return out;
            }
        }
    } catch (e) { /* 不是抖音 / 接口失败 → 走后面的分支 */ }

    // B站优先：主动向 playurl 要，两条路都探，不依赖嗅探缓存
    try {
        const r = await vrWithTimeout(chrome.scripting.executeScript({
            target: { tabId: tabId }, world: 'MAIN', func: self.VR_BILI.probeFunc
        }), 8000, 'bili-probe');
        const info = r && r[0] && r[0].result;
        if (info && (info.hasDurl || info.hasDash)) {
            out.site = 'bili';
            /* 作品键 = bvid + cid（分P 各算一集）。
             * ⚠️ 2026-11-12 苏哥报「B站又下载不了」的真根因就在这里：
             * 以前没有 meta，下载侧去重只能拿**整条页面 URL** 当作品键，
             * 于是同一页下过一次之后，再点任何一集/任何清晰度都会被判
             * 「已存在」直接跳过 —— 按钮一闪就回原样，看着就是「下不了」。
             * 一条 B 站页面可能有很多集（分P/合集），页面 URL 根本不是作品。 */
            out.meta = {
                site: 'bilibili',
                workId: String(info.bvid || '') + '_' + String(info.cid || ''),
                title: String(info.partTitle || info.title || ''),
                author: String(info.owner || '')
                    + (info.ownerMid ? '(@' + String(info.ownerMid) + ')' : ''),
                authorId: info.ownerMid ? String(info.ownerMid) : '',
                pageUrl: 'https://www.bilibili.com/video/'
                    + String(info.bvid || '')
                    + (info.part ? ('?p=' + info.part) : '')
            };
            if (info.hasDurl) {
                out.options.push({
                    id: 'durl', kind: 'durl',
                    label: (self.VR_BILI.qShort(info.quality) || info.qualityText || '标清'),
                    note: info.size ? (info.size / 1048576).toFixed(1) + 'MB · 快' : '快'
                });
            }
            // 只有 DASH 档位更高才给高清选项——一样高就别让用户白等合成
            if (info.hasDash &&
                (!info.hasDurl || Number(info.dashQuality) > Number(info.quality || 0))) {
                out.options.push({
                    id: 'dash', kind: 'dash',
                    label: (self.VR_BILI.qShort(info.dashQuality) || info.dashQualityText || '高清'),
                    note: '高清 · 需合成'
                });
            }
            if (out.options.length) { return out; }
        }
    } catch (e) { /* 不是 B站 或探测失败 → 走通用 */ }

    /* 小红书优先：用 SSR state 精确取「这篇笔记」的视频流（见 vrXhsVideoProbe 注释）。
     * 嗅探缓存混着别的笔记、页面 <video> 又是 blob:，靠通用排序必然出错。 */
    try {
        const xv = await vrXhsVideoProbe(tabId);
        if (xv && xv.rows && xv.rows.length) {
            const rows = xv.rows.slice().sort(function (a, b) {
                if (a.full !== b.full) { return a.full ? -1 : 1; }   /* 完整 mp4 优先，别拿 m4s 分片 */
                const pa = a.w * a.h, pb = b.w * b.h;
                if (pa !== pb) { return pb - pa; }
                return (b.br || 0) - (a.br || 0);
            });
            /* 只给「完整文件」当选项：EF5 那些 4K 档是 fmp4 分片（.m4s），
             * 单下一个分片只有几秒，用户会当成「下错了/播不了」（MSN 同款坑）。
             * 整篇一个完整 mp4 都没有时，才退回分片并明确标注。 */
            const fullRows = rows.filter(function (x) { return x.full; });
            const useRows = fullRows.length ? fullRows : rows;

            const seen = {};
            const options = [];
            for (let i = 0; i < useRows.length && options.length < 4; i++) {
                const x = useRows[i];
                if (!x.url || seen[x.url]) { continue; }
                seen[x.url] = 1;
                /* 竖屏视频 height=1920/width=1080，按短边叫「1080p」才符合直觉 */
                const shortSide = Math.min(x.w || 0, x.h || 0) || x.h || 0;
                const px = shortSide ? (shortSide + 'p') : 'MP4';
                const kbps = x.br ? (' · ' + Math.round(x.br / 1000) + 'kbps') : '';
                options.push({
                    id: 'xhs' + options.length,
                    kind: 'url',
                    url: x.url,
                    candidates: [x.url].concat(x.backup || []),
                    label: px + kbps,
                    note: options.length === 0
                        ? (x.full ? '最高清' : '最高清 · 分片，需合并')
                        : (x.full ? '' : '分片')
                });
            }
            if (options.length) {
                out.site = 'xiaohongshu';
                /* meta 跟 pick 同一时刻取自同一个 note 对象 —— 下载侧用它命名/溯源，
                 * 不再二次抠页面（抖音那边就踩过「隔几秒抠到另一条」的坑）。 */
                out.meta = {
                    site: 'xiaohongshu',
                    author: xv.user || '',
                    authorId: xv.userId || '',
                    title: xv.title || '',
                    workId: xv.noteId || '',
                    pageUrl: xv.noteId
                        ? ('https://www.xiaohongshu.com/explore/' + xv.noteId)
                        : ''
                };
                out.options = options;
                return out;
            }
        }
    } catch (e) { /* 不是小红书 / state 未就绪 → 走通用分支 */ }

    // 通用站点：先问页面「现在正在播的是哪个」，再回落到嗅探缓存。
    // 多视频页面（信息流/推荐位）里「体积最大」不等于「你正在看的」。
    let playing = '';
    try {
        const pr = await vrWithTimeout(chrome.scripting.executeScript({
            /* 按钮可能挂在 iframe 里（MSN/新闻站的播放器都在 iframe 中）。
             * 不指定 frameIds 就只能读到顶层 frame 的 video —— 而顶层往往一个都没有，
             * 于是「正在播放」永远为空，选中哪条全靠运气。 */
            target: (frameId != null && frameId >= 0)
                ? { tabId: tabId, frameIds: [frameId] }
                : { tabId: tabId },
            func: function () {
                const vs = Array.from(document.querySelectorAll('video'));
                const v = vs.filter(function (x) { return x.currentSrc && !x.paused; })[0]
                    || vs.filter(function (x) { return x.currentSrc; })[0];
                return v ? v.currentSrc : '';
            }
        }), 4000, 'playing-probe');
        playing = (pr && pr[0] && pr[0].result) || '';
    } catch (e) { /* 受限页面，退回体积排序 */ }

    /* 只保留「当前这份文档」的记录（见 vrDocKey 注释）。
     * 没有 webUrl 的老记录 / 归一失败时保留，宁可多一条也不误杀。 */
    let docKey = '';
    try {
        const tabNow = await chrome.tabs.get(tabId);
        docKey = vrDocKey((tabNow && tabNow.url) || '');
    } catch (e) { docKey = ''; }

    let list = (cacheData[tabId] || []).filter(function (m) {
        if (!m || !m.url) { return false; }
        if (!VR_VIDEO_EXT.test(m.ext || '') || VR_STATIC_ASSET.test(m.url || '')) { return false; }
        if (docKey && m.webUrl) {
            const k = vrDocKey(m.webUrl);
            if (k && k !== docKey) { return false; }
        }
        return true;
    });
    /* 归一化：字节分片还原 + 同一媒体归并（苏哥 2026-11-09「MSN 这个视频下不了」）。
     *
     * 现象：一个页面本该是 6 个视频，列表里却有 23 条 —— 同一个视频被记录多次
     * （播放器按字节切片反复拉，每次一个 requestId），而每条都只是**碎片**。
     * 拿这种地址去下，落盘的是几百 KB 的 moof，播放器打不开 = 「下载不了」。
     *
     * 规则（见 VRVideoQuality.unsegmentUrl）：
     *   ① ?start=0&end=15&_t=… 这类分片参数剥掉，向同一地址要完整文件（实测 200 + 全量）；
     *   ② 同一 URL 的多条只留信息最全的一条（有 content-type / 有体积的优先）；
     *   ③ 同一目录下主干相同的变体（x.mp4 / x.mp4_bd.mp4）视为同一媒体 —— 只对
     *      主干足够长（≥16 位 hash/UUID）的生效，避免把 video.mp4 这种通用名误合。 */
    list = vrNormalizeCandidates(list);

    /* 可达性预检：把 403 死链从列表里清掉，顺便回填真实体积。
     * 这一步是「下载不了」的另一半原因 —— 归并只解决碎片，
     * 若留下的那条本身是 403，点了照样失败。 */
    list = await vrProbeCandidates(tabId, list);

    /* 两段式排序（2026-11-11 改，见 VRVideoQuality.prioritizePlaying）：
     * ① 先用「正在播放」锁定是哪个作品；② 再在这个作品的所有码率里取最高。
     * 老实现是「全页按分辨率排第一」，多视频页面里必然下错（苏哥报的现象）。 */
    list = self.VRVideoQuality.prioritizePlaying(list, playing);

    /* Instagram 优先取 hydration JSON 的完整 progressive MP4。
     * 嗅探缓存里的 MSE 分片带 bytestart/byteend，单下只有 moof、没有 ftyp/moov，
     * 落盘后 Chrome 播放不了。完整地址放在最前，分片变体从列表剔除。 */
    try {
        const tab = await chrome.tabs.get(tabId);
        if (/instagram\.com/i.test((tab && tab.url) || '')) {
            const full = await vrIgVideoUrls(tabId);
            if (full.length) {
                const fullRows = full.map(function (u) { return { url: u, ext: 'mp4', size: 0 }; });
                const rest = list.filter(function (m) { return !/[?&](bytestart|byteend)=/i.test(m.url || ''); });
                list = fullRows.concat(rest);
            }
        }
    } catch (e) { /* IG 探测失败时继续用嗅探列表 */ }


    // 嗅探缓存里没有当前正在播的 URL 时，直接把它补进来。
    // 页面自己播放的地址一定是最准的（微博刷新/扩展重载后缓存可能为空）。
    if (playing && /^https?:/i.test(playing) &&
        !list.some(function (m) { return m.url === playing; })) {
        const pExt = (playing.split('#')[0].split('?')[0].split('.').pop() || 'mp4').toLowerCase();
        if (VR_VIDEO_EXT.test(pExt)) {
            list.push({ url: playing, ext: pExt, size: 0 });
            /* 补进来的这条也要走同一套两段式：先锁作品，再族内取最高。 */
            list = self.VRVideoQuality.prioritizePlaying(list, playing);
        }
    }

    // 嗅探缓存为空（MSE/分片站点）时，用页面内嵌数据补一次；
    // 找不到就保持空列表，面板会提示「先播放几秒」，绝不假装有源。
    if (!list.length) {
        const emb = await vrPageEmbeddedVideoProbe(tabId);
        (emb.urls || []).forEach(function (u) {
            if (!list.some(function (m) { return m.url === u; })) {
                list.push({ url: u, ext: 'mp4', size: 0 });
            }
        });
    }

    /* 主动补高清档（通用思路，微博先落地）。
     *
     * 为什么必须有这一步：嗅探只能看到浏览器**实际请求过**的码率。
     * 微博信息流默认播 720p，所以嗅探到的最高就是 720p —— 光排序永远拿不到 1080p。
     * 真正的做法是拿作品 id 去站点详情接口换高清直链：
     * 笃笃微博下载器 v0.16.14（星愿里那个）用 `ajax/statuses/show?id=` 取
     * `page_info.media_info.mp4_hd_url`，本实现照此思路，但走页面上下文 fetch
     * （自带 Cookie/Referer，扩展上下文会被微博 302 到访客页）。
     *
     * 失败不阻断：拿不到就沿用嗅探结果，面板照常可用。 */
    try {
        /* 只在微博域下调：探针会发站内请求，别的站点上跑纯属浪费（还有风控风险）。 */
        let isWeibo = false;
        try {
            const t0 = await chrome.tabs.get(tabId);
            isWeibo = /(^|\.)weibo\.(com|cn)$/i.test(String((t0 && t0.url) || '')
                .replace(/^https?:\/\//i, '').split('/')[0]);
        } catch (e0) { isWeibo = false; }

        /* media_id 只是兜底种子：接口要的是**正文 id**，media_id 会返回 20101。
         * 真正的 id 由探针在页面里自己找（DOM 上的发布时间链接 / mid 属性）。 */
        const mid = self.VRVideoQuality.weiboMidFromUrl(
            (list[0] && list[0].url) || playing || '');
        if (isWeibo) {
            const hd = await vrWeiboHdProbe(tabId, mid ? [mid] : []);
            const vs = (hd && Array.isArray(hd.variants)) ? hd.variants : [];
            if (vs.length) {
                /* 全部档位入池（4K/2K/1080p/720p…），不是只取最高一条：
                 * 苏哥 2026-11-12 明确「默认最高清，需要低的自己选」。
                 * 只塞一条最高清 = 面板里没有低档可选；只塞一条 1080p = 4K 永远拿不到。 */
                vs.forEach(function (v) {
                    if (!v || !v.url) { return; }
                    if (list.some(function (m) { return m.url === v.url; })) { return; }
                    const vh = Number(v.height) || self.VRVideoQuality.heightFromUrl(v.url) || 0;
                    /* 同档位已经有一条（嗅探来的，地址不同但同一个文件）就不再插，
                     * 否则面板里会出现两个「1080p」，用户以为选错了。
                     * 比较时必须用「有效高度」：嗅探条目的 height 字段经常是空的
                     * （只在渲染时才从 URL 猜），直接读 m.height 会恒为 0、去重失效
                     * —— 苏哥那条 4K 微博就多出了两个重复的 720p/480p（实测）。
                     * 保留先到的嗅探条：它是页面真实在播的那条，下载最稳。 */
                    if (vh && list.some(function (m) {
                        const mh = Number(m.height) ||
                            self.VRVideoQuality.heightFromUrl(m.url) || 0;
                        return mh === vh;
                    })) { return; }
                    list.push({
                        url: v.url,
                        ext: 'mp4',
                        size: Number(v.size) || 0,
                        height: vh,
                        bitrate: Number(v.bitrate) || 0
                    });
                });
                /* 重排：微博各档位的 CDN 文件名不同，靠 familyKey 按 media_id 归族，
                 * 才能让「正在播放」锁到同一个作品、再在族内取到 4K。 */
                list = self.VRVideoQuality.prioritizePlaying(list, playing);
            }
        }
    } catch (e) { /* 补高清失败不影响已有候选 */ }

    /* HLS master 展开（通用，抄 Video Downloader Plus v4.0.0 的做法）。
     *
     * 为什么需要：HLS 站点（B站/YouTube/多数流媒体）拿到的是 master 地址，
     * 里面每个 #EXT-X-STREAM-INF 都带 RESOLUTION= 与 BANDWIDTH=。
     * 只把 master 当一个候选交出去，下载器拿到的是一张「清单」而不是视频，
     * 更不可能知道哪档最高。展开后每个 variant 都是独立候选，按分辨率排序即可。
     *
     * master 拉取放在页面主世界（带 Cookie/Referer），失败就保持原样。 */
    try {
        const masters = list.filter(function (m) {
            return m && /\.m3u8(\?|$)/i.test(m.url || '');
        });
        if (masters.length) {
            const expanded = await vrExpandHlsMasters(tabId, masters.map(function (m) { return m.url; }));
            if (expanded.length) {
                /* 移除 master 本身，换成展开出的 variant */
                const masterUrls = {};
                masters.forEach(function (m) { masterUrls[m.url] = 1; });
                list = list.filter(function (m) { return !masterUrls[m.url]; });
                expanded.forEach(function (v) {
                    if (!list.some(function (m) { return m.url === v.url; })) {
                        list.push({ url: v.url, ext: 'm3u8', size: 0, height: v.height || 0 });
                    }
                });
                list = self.VRVideoQuality.sortCandidates(list, playing);
            }
        }
    } catch (e) { /* HLS 展开失败不影响已有候选 */ }

    /* DASH MPD 探测（通用，参考 Video Downloader Pro v0.1.11 的格式覆盖）。
     *
     * 为什么要动它：我们原来只在独立页 js/mpd.js 里解析 MPD，主下载链路
     * 根本不认 .mpd，遇到 DASH 站点只能看到一个「清单」地址。
     * 这里只做「识别 + 标注最高档分辨率」，真正的分片合并仍交给既有
     * m3u8/mpd 处理页 —— 不在这条链路上重写合并器（风险太高）。
     *
     * 目的很具体：让候选列表里出现 `4320p · 8K` 这类真实档位，
     * 而不是把 .mpd 当成一个不明大小的 MP4。 */
    try {
        const mpds = list.filter(function (m) {
            return m && /\.mpd(\?|$)/i.test(m.url || '');
        });
        if (mpds.length) {
            const info = await vrProbeDashMpd(tabId, mpds.map(function (m) { return m.url; }));
            if (info && info.height) {
                mpds.forEach(function (m) { m.height = info.height; });
                if (info.bandwidth) { mpds.forEach(function (m) { m.size = m.size || info.bandwidth; }); }
                list = self.VRVideoQuality.sortCandidates(list, playing);
            }
        }
    } catch (e) { /* MPD 探测失败不影响已有候选 */ }

    out.options = list.slice(0, 8).map(function (m, i) {
        /* 标签带上分辨率，用户才能一眼看出哪档更高。
         * 旧标签只有 "MP4 · 4.0MB"，6 个档位看起来像 6 个不同大小的视频，
         * 实际是同一个视频的不同码率（2026-11-07 苏哥反馈「每个都一样」）。 */
        const h = m.height || self.VRVideoQuality.heightFromUrl(m.url);
        return {
            id: 'm' + i, kind: 'url', url: m.url,
            /* 原始分片地址：只在完整地址下不了时回退用，正常不碰 */
            srcUrl: m.srcUrl || '',
            segmented: !!m.segmented,
            height: h,
            label: self.VRVideoQuality.labelOf(m),
            /* 预检判死的条目仍会列出来（否则列表空着更让人慌），
             * 但要说清原因 —— 直接说「下不了」等于没说。 */
            note: m.probeDead ? '地址已失效 · 先播放几秒再试'
                : (i === 0 ? ((playing && m.url === playing) ? '最高清 · 当前播放' : '最高清')
                    : ((playing && m.url === playing) ? '当前播放' : ''))
        };
    });
    return out;
}

/** 页内按钮：按选项下载。完成后主动推 vrVideoProgress 给按钮更新状态。
 *  B站 的两条路都必须在页面主世界跑（CDN 要页面 Referer，ADR-029）。 */
async function vrVideoDownload(tabId, optionId, wantBest, frameId, metaFromCaller) {
    const opt = await vrVideoOptions(tabId, frameId);
    let pick = null;
    if (wantBest || !optionId) {
        // 一键下载 = 最高清：B站 有更高档的 DASH 就用它（合成只多一两秒），
        // 没有就退回整段 MP4；通用站取体积最大的那条。
        // 想要「快」的用户从箭头菜单里挑标清那条。
        if (opt.site === 'bili') {
            pick = opt.options.filter(function (o) { return o.kind === 'dash'; })[0] ||
                   opt.options[0];
        } else {
            pick = opt.options[0];
        }
    } else {
        pick = opt.options.filter(function (o) { return o.id === optionId; })[0];
    }
    if (!pick) { return { ok: false, reason: 'no-option' }; }

    /* 作品键（B站：bvid_cid_档位）。只有 B 站给，其它站为空 → 行为不变。
     * 带档位是为了「先点快的 720P，再点高清 1080P」不被拦。
     * ⚠️ 必须声明在 try 外面：下面算 dedupKey 的那段也要用，放在 try 里的
     * const 是块级作用域，外面拿不到会抛 ReferenceError，被 catch 静默吞掉
     * → dedupKey 恒为空 → 去重彻底失效（自测当天就踩到）。 */
    const workKey = (opt.meta && opt.meta.workId)
        ? (String(opt.meta.workId) + '_' + String(pick.kind || pick.id || ''))
        : '';
    try {
        const tab = await chrome.tabs.get(tabId);
        const dupe = await vrFindExistingMedia({
            site: opt.site || '', kind: 'video', url: pick.url,
            pageUrl: (tab && tab.url) || '', workId: workKey
        });
        if (dupe) { return { ok: true, skipped: true, reason: 'duplicate-source', path: dupe.relPath }; }
    } catch (e) { /* 查重失败不阻止下载 */ }

    const seen = await vrDedupLoad();
    let dedupKey = '';
    try {
        const tab = await chrome.tabs.get(tabId);
        const pageUrl = (tab && tab.url) || '';
        dedupKey = vrMediaIdentity({
            site: opt.site || 'generic',
            url: pick.url || pageUrl,
            /* B 站把作品键塞进 mediaId：vrMediaIdentity 里 work 取的是
             * statusId||noteId||awemeId||mediaId||key，mediaId 非空就不再落到 key，
             * 所以传 workKey 才能真正按「这一集 + 这一档」记账。 */
            mediaId: workKey || pick.kind || pick.id || '',
            kind: 'video',
            key: pageUrl
        });
    } catch (e) { /* ignore */ }
    if (dedupKey && seen.has(dedupKey)) {
        return { ok: true, skipped: true, reason: 'duplicate' };
    }
    const finish = function (res) {
        if (res && res.ok && !res.skipped && dedupKey) {
            seen.add(dedupKey);
            vrDedupSave(seen);
        }
        return res;
    };

    // ---- 抖音：详情接口已经给了作者/抖音号/描述，命名直接用 override ----
    // 注意（2026-11-05 实测）：抖音 CDN 对 downloads 直连回 SERVER_FORBIDDEN，
    // 且会落一个 0 字节 .htm 残件。这里不再单独走 downloads，交给下面通用分支的
    // 「downloads → 2.5s 内被拒则撤账清残件 → 页面主世界 fetch」两段式，
    // 页面 fetch 天然带 Referer/Cookie 才能过。
    let metaOverride = null;
    // feed 列表页图文绑定（B-46 视频版）：
    // 抖音/小红书用自家 note 级 meta（已稳，不覆盖）；
    // 通用/微博 feed 优先用浮标在点下载瞬间现场抽到的「这条视频所属卡片」文字，
    // 直接解决列表页张冠李戴；无则回退 vrPageMetaInTab（读 __vrFeedMeta / 页面级）。
    if (opt.site === 'douyin' || opt.site === 'xiaohongshu') {
        metaOverride = opt.meta || null;
    } else if (metaFromCaller && (metaFromCaller.title || metaFromCaller.author)) {
        metaOverride = metaFromCaller;
    }
    if (opt.site === 'douyin' || opt.site === 'xiaohongshu') {
        /* 标签页可能在探测/选源期间被用户关掉：这里必须兜住。
         * 另外 5 处 tabs.get（3970/4051/4116/4127/4164）都判了 try，
         * 唯独这一处是裸 await —— 关页后整次下载会以未捕获 Promise 拒绝结束
         * （edge://extensions 里表现为「No tab with id: xxx」）。 */
        let douyinTabUrl = '';
        try {
            const tab = await chrome.tabs.get(tabId);
            douyinTabUrl = (tab && tab.url) || '';
        } catch (e) { /* 页面已关：退回落站地址，规则仍可用 */ }
        await vrSetMediaHeaders('douyinvod.com', douyinTabUrl || 'https://www.douyin.com/');
    }

    // ---- 通用站点：直链交给既有的自定义文件名下载（M8） ----
    if (pick.kind === 'url') {
        let pageUrl = '';
        try {
            const tab = await chrome.tabs.get(tabId);
            pageUrl = (tab && tab.url) || '';
        } catch (e) { /* ignore */ }
        const ext = (pick.url.split('#')[0].split('?')[0].split('.').pop() || 'mp4').toLowerCase();
        // 微博等站点：页面 $render_data 里有作者/正文，优先用它命名
        const meta = metaOverride || await vrPageMetaInTab(tabId);
        const filename = await vrNameInTab(tabId, VR_VIDEO_EXT.test(ext) ? ext : 'mp4', meta || null);

        // F2 溯源：把「原帖地址/作者/作品ID/直链」一起预登记进库，
        // 否则库里来源永远是「未记录」。埋点失败绝不影响下载。
        const trace = {
            /* meta.pageUrl 优先（2026-11-11）：小红书/抖音这类 SPA，tab.url 里塞着
             * xsec_token / modal_id 这类一次性参数，写进库里既不能当稳定来源、
             * 也让「同一篇笔记」的溯源键每次都不同。options 那边的 meta 是与
             * pick.url 同一时刻取的确定性地址（explore/<noteId> 或 video/<awemeId>）。 */
            pageUrl: (meta && meta.pageUrl) || pageUrl || '',
            mediaUrl: pick.url || '',
            /* sourceUrl 也要写：查重（vrFindExistingMedia）同时比对 sourceUrl 与 mediaUrl，
             * 只写一边会让老条目/另一条路径的下载查不到重复。 */
            sourceUrl: pick.url || '',
            author: (meta && meta.author) || '',
            authorId: (meta && meta.authorId) || '',
            workId: (meta && meta.workId) || '',
            title: (meta && meta.title) || '',
            /* platform 必须按页面 URL 推断：meta.site 在通用分支是空的
             * （微博视频走的是 generic），直接取值会让入库条目 platform/type 全空，
             * 既进不了资源库的站点分组，也削弱查重（查重会按 platform 预筛）。 */
            platform: (meta && meta.site) ||
                (self.VRPath && typeof self.VRPath.detectPlatform === 'function'
                    ? self.VRPath.detectPlatform(pageUrl || '')
                    : '') || '',
            type: 'video'
        };
        try {
            const nm = await vrTraceMetaInTab(tabId);
            /* ⚠️ 必须是「meta 优先、nm 只补空」，不能 Object.assign 无条件覆盖。
             * 2026-11-09 实测踩到：meta 来自 vrVideoOptions 那一次 Fiber（与 pick.url 同一时刻，
             * 两者必然对应同一条视频）；而这里再抠一次 Fiber，中间隔了几百毫秒到几秒，
             * 首页/精选页一旦自动切到下一条，抠到的就是**另一条**的标题和 pageUrl。
             * 无条件覆盖的后果：文件本身下对了，库里标题却变成下一条的名字
             * （苏哥实测：烧鸡视频被记成「万磁侠第9集」）。
             * 所以这里只允许 nm 填 meta 里没有的字段。 */
            if (nm) {
                ['pageUrl', 'author', 'authorId', 'workId', 'title'].forEach(function (k) {
                    if (!trace[k] && nm[k]) { trace[k] = nm[k]; }
                });
            }
        } catch (e) { /* 埋点失败不影响下载 */ }

        /* 抖音：pageUrl 用作品 ID 拼一条确定性地址。
         * tab.url 可能是带 modal_id 的首页地址（用户点下载时弹窗里是另一条），
         * 直接用会把「来源原帖」指向错误的视频。有 awemeId 就以它为准。 */
        if (opt.site === 'douyin' && trace.workId && /^\d{10,}$/.test(String(trace.workId))) {
            trace.pageUrl = 'https://www.douyin.com/video/' + trace.workId;
        }

        // 路线 1（默认）：downloads API + DNR 回放页面 Referer。
        // 保留子目录和文件名保护；普通站点/抖音都走这条。
        if (pageUrl) { await vrSetMediaHeadersFor(pick.url, pageUrl); }

        /* 真实字节进度 → 页内按钮。统一走 vrProgressReporter，
         * 不再在这里手写 sendMessage（B-52：进度必须只有一个出口）。 */
        const P = vrProgressReporter(tabId, filename);

        const id = await vrDownloadWithName(pick.url, filename, { meta: trace, onProgress: P.bytes });
        let pageDl = null;
        /* FSA 直写成功时没有 downloadId，返回的是 {__fsa:true, path} —— 对象不是数字。
         * 原代码直接把对象丢给 vrWaitDownload，后者拿它当 downloads.search({id}) 的 id，
         * Chrome 抛 "Invalid type: expected integer, found object"，整个 vrVideoDownload
         * 以 TypeError 结束 → 按钮收到 ok:false → 显示叹号。
         * 而文件其实**已经落盘成功**（FSA 直写，无需下载器）—— 这就是「静默下好了却报失败」。
         * 仓库里另外 5 处（905/931/2507/3457/3527）都判了 __fsa，唯独这条路径漏了。 */
        if (id && typeof id === 'object' && id.__fsa) {
            /* 直写已经结束（saveFile 返回即写完），补一个终态。
             * 没有终点消息的话按钮会永远卡在「…」，比 0% 更糟。 */
            P.done(true, '', 0);
            vrMarkDownloaded(filename);
            return finish({ ok: true, kind: 'fsa', filename: filename, path: id.path || filename });
        }
        if (id !== null) {
            const outcome = await vrWaitDownload(id, 2500);
            if (outcome && outcome.state === 'interrupted') {
                // CDN 403 快速失败：撤账、清掉 .htm 残留，改走页面 fetch
                try { vrAbortFilename(pick.url, filename); } catch (e) { /* ignore */ }
                vrDropDownload(id);
            } else if (outcome && outcome.state === 'complete' && !vrDownloadLooksInvalid(outcome)) {
                vrMarkDownloaded(filename);
                P.done(true, '', 0);
                return finish({ ok: true, kind: 'url', filename: filename });
            } else if (outcome && outcome.state === 'complete') {
                /* 下完了但内容是坏的（空文件 / 服务器给的是反爬网页）。
                 * 清掉假文件，**继续往下走回退路线** —— 页面 fetch / 离屏直连
                 * 有时能带对 Cookie 拿到真内容，直接报失败等于白放弃。
                 * 2026-11-09：抖音那几条 15KB / 848KB 的「视频」就是这种假成功。 */
                vrDiscardBadDownload(id);
                try { vrAbortFilename(pick.url, filename); } catch (e) { /* ignore */ }
            } else {
                /* 2.5 秒内没下完 = 还在跑（大文件基本都走这里）。
                 * 交给统一 reporter 的字节轮询报百分比，完成/中断由它推终态。
                 * 必须带 started：视频页按钮看到它才会保持 busy 等进度，
                 * 否则会立刻显示「完成」——苏哥 2026-11-09 报的「一直 0%」
                 * 就是这个：没人报进度 + 2.5 秒就报成功。 */
                P.watch(id);
                return finish({ ok: true, started: true, kind: 'url', filename: filename });
            }
        }

        // 路线 2（回退）：页面主世界 fetch → blob → <a download>。
        // 页面请求天然带 Referer/Cookie，微博这类 Referer ACL 站点只有这条能过；
        // 与 B站 durl 的成熟路线一致，CocoCut 也是在页面/内容脚本里 fetch。
        /* 这条路上整段 blob 在页面里一次拉完，中途没有可观测的字节数。
         * 以前什么都不报，按钮就一直停在 0% —— 用户以为死了，其实在跑。
         * 至少给个「不确定 + 阶段」，让界面有东西在动。 */
        P.note('页面取流中', null);
        pageDl = await vrTryPageDownload(tabId, pick.url, filename.split('/').pop());
        if (pageDl && pageDl.ok) {
            const saved = filename.split('/').pop();   // <a download> 只认文件名，不支持子目录
            vrMarkDownloaded(saved);
            P.done(true, '', pageDl.bytes || 0);
            return finish({ ok: true, kind: 'page-blob', filename: saved, bytes: pageDl.bytes || 0 });
        }

        // 路线 3（最后兜底）：离屏文档直连。
        // 抖音 CDN 只认 Referer，而 downloads 请求带不上、页面 fetch 被 CORS 拦，
        // 只有扩展上下文的 fetch 能同时满足「带 Referer + 不被 CORS 拦」。
        // 取到字节后**必须**回到 vrDownloadWithName 落盘：那里有文件名记账、
        // 归档子目录、资源库入库。离屏里直接 <a download> 会丢目录也不进库，已否决。
        P.note('离屏直连中', null);
        const off = await vrOffscreenDownload(pick.url, filename.split('/').pop());
        if (off && off.ok && off.blobUrl) {
            const id2 = await vrDownloadWithName(off.blobUrl, filename, { meta: trace });
            if (id2 !== null) {
                vrMarkDownloaded(filename);
                P.done(true, '', off.bytes || 0);
                return finish({ ok: true, kind: 'offscreen-blob', filename: filename, bytes: off.bytes || 0 });
            }
        }
        P.done(false, '下载失败', 0);
        return { ok: false, reason: 'download-failed', page: pageDl || null, offscreen: off || null };
    }

    // ---- B站：走页面主世界 ----
    const probe = await chrome.scripting.executeScript({
        target: { tabId: tabId }, world: 'MAIN', func: self.VR_BILI.probeFunc
    });
    const info = probe && probe[0] && probe[0].result;
    if (!info || !(info.hasDurl || info.hasDash)) {
        return { ok: false, reason: 'no-bili-info' };
    }

    /* 命名必须带探针给的作者/标题（2026-11-12 修）：
     * 以前先 vrNameInTab 再 probe，命名拿不到 UP 主信息，只能从页面/DOM 猜 ——
     * 实测库里所有 B 站文件名都挂着同一个 `(@360421127)`（串了别人的 mid），
     * 分P 视频还会全部同名。 */
    const nameMeta = {
        /* 不传 site：归档目录名由 VRPath 从 pageUrl 推断（B站 → 「B站」），
         * 这里塞 'bilibili' 会让目录变成英文键名。
         * author 只给**名字**：naming.js 的 buildAuthorFull 会自己拼 (@ID)，
         * 这里再拼一遍会得到「索尼音乐中国(@123)(@123)」（自测踩到）。 */
        author: String(info.owner || ''),
        authorId: info.ownerMid ? String(info.ownerMid) : '',
        title: String(info.partTitle || info.title || ''),
        workId: String(info.bvid || '') + '_' + String(info.cid || ''),
        pageUrl: 'https://www.bilibili.com/video/' + String(info.bvid || '')
            + (info.part ? ('?p=' + info.part) : '')
    };
    // <a download> 不支持子目录（ADR-029 已知限制），只取文件名
    const full = await vrNameInTab(tabId, 'mp4', nameMeta);
    const name = full.split('/').pop() || full;

    /* 记完整归档路径（含 video-rod/B站/<作者>/视频/），页面里的 <a download> 只认文件名。
     * 同时带 meta：B站走页面内 blob 下载，没有预登记的话入库条目
     * platform/type/pageUrl/title 全是空（详情页「来源」整块空白）。 */
    let biliTabUrl = '';
    try { const bt = await chrome.tabs.get(tabId); biliTabUrl = (bt && bt.url) || ''; } catch (e) { /* ignore */ }
    let biliTitle = '';
    try {
        const pg = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: function () { return document.title || ''; }
        });
        biliTitle = String((pg && pg[0] && pg[0].result) || '').replace(/\s*-\s*哔哩哔哩.*$/, '').trim();
    } catch (e) { /* ignore */ }
    /* workId 必须和下载侧去重用的 workKey 同口径（bvid_cid_档位），
     * 否则「库里查重」永远对不上，重复下载拦不住。 */
    const biliWork = String(info.bvid || '') + '_' + String(info.cid || '');
    const biliWorkKey = biliWork + '_' + String(pick.kind || pick.id || '');
    const biliMeta = {
        platform: 'bilibili',
        platformName: 'B站',
        type: 'video',
        /* 分P 用该集标题（多P 视频每集不同），没有才用总标题 */
        title: String(info.partTitle || biliTitle || info.title || ''),
        author: String(info.owner || '')
            + (info.ownerMid ? '(@' + String(info.ownerMid) + ')' : ''),
        authorId: info.ownerMid ? String(info.ownerMid) : '',
        workId: biliWorkKey,
        /* 来源固定成 bvid（带 p）：tab.url 里可能挂着 spm_id_from/vd_source
         * 这类参数，每进一次都不一样，当溯源键不稳定。 */
        pageUrl: 'https://www.bilibili.com/video/' + String(info.bvid || '')
            + (info.part ? ('?p=' + info.part) : ''),
        relPath: full
    };
    vrPendingBiliName = { full: full, at: Date.now(), meta: biliMeta };
    if (self.VRLib) {
        try {
            /* blob 下载没有可预登记的 URL（页面自己 createObjectURL），
             * 用「路径键」登记一份，onDeterminingFilename 拿到真实 blob URL 后再补。 */
            self.VRLib.record('vrblob:' + full, biliMeta);
        } catch (e) { /* 入库失败不影响下载 */ }
    }
    if (pick.kind === 'dash') {
        await chrome.scripting.executeScript({
            target: { tabId: tabId }, world: 'MAIN', files: ['lib/mp4box.all.min.js']
        });
        await chrome.scripting.executeScript({
            target: { tabId: tabId }, world: 'MAIN',
            args: [name, info.cid, info.bvid], func: self.VR_BILI.dashFunc
        });
    } else {
        await chrome.scripting.executeScript({
            target: { tabId: tabId }, world: 'MAIN',
            args: [name, info.cid, info.bvid], func: self.VR_BILI.durlFunc
        });
    }

    // 下载在页面里跑，后台盯着进度，完成后主动通知按钮（走统一 reporter）
    vrWatchBiliDownload(tabId, name, vrProgressReporter(tabId, name));
    return finish({ ok: true, kind: pick.kind, filename: name, started: true });
}

/* ==========================================================
 * 统一下载进度上报（B-52｜苏哥 2026-11-09「所有网站的进度统一一下」）
 * ----------------------------------------------------------
 * 现状问题：进度是**每个站点各写一套**，所以覆盖必然不全。
 *   · B站：读页面里的 window.__vrBiliDL —— 只有它有
 *   · 通用站/抖音：走 downloads API 或 FSA 直写 —— 谁都不报，永远 0%
 *   · FSA 直写：save.js 的 pumpBlob/pumpUrl 早就有 onProgress(got,total)，
 *     但从来没人接
 *
 * 收敛方案：一个 reporter 对象，三条链路共用同一条出口。
 *   ① downloads 任务   → P.watch(downloadId)
 *   ② FSA / fetch 流   → P.bytes(got, total)
 *   ③ 页面内自跑(B站)  → P.note(phase, pct) / P.done()
 *
 * 契约：
 *   · bytes() 只报 0–99，绝不报 100（100 由 done() 负责，避免"100% 但还在写"）
 *   · 拿不到总字节时报 indeterminate（界面显示「…」），不假装 0%
 *   · done() 只生效一次，之后任何上报都被丢掉
 *   · 新加下载通道请复用本对象，**不要再自己拼 chrome.tabs.sendMessage**
 * ========================================================== */
function vrProgressReporter(tabId, name) {
    var closed = false;
    var lastPct = -1;
    var sentIndet = false;
    var lastIndetPhase = '';

    /** force=true 时忽略 closed —— done() 就是靠它把终态送出去的。
     *  2026-11-10 单测抓到的真 bug：done() 先把 closed 置 true 再调 send()，
     *  而 send() 开头 `if (closed) return` 直接吞掉 → **终态永远发不出去**。
     *  大文件下完按钮就一直 busy，只能等 30 分钟看门狗变叹号（用户以为失败）。 */
    function send(payload, force) {
        if (closed && !force) { return; }
        try {
            chrome.tabs.sendMessage(tabId, Object.assign(
                { Message: 'vrVideoProgress', name: name }, payload));
        } catch (e) { /* 页面关了就静默 */ }
    }

    return {
        /** 已知字节：报真实百分比；拿不到总量则报「不确定」。 */
        bytes: function (got, total) {
            if (closed) { return; }
            var t = Number(total) || 0;
            var g = Number(got) || 0;
            if (!t) {
                if (!sentIndet) { sentIndet = true; send({ indeterminate: true, phase: '下载中' }); }
                return;
            }
            var pct = Math.max(0, Math.min(99, Math.round(g / t * 100)));
            if (pct === lastPct) { return; }
            lastPct = pct;
            send({ pct: pct, phase: '下载中' });
        },
        /** 带阶段文字的进度（B站 合成/转码这类没有字节的阶段用）。
         *
         * ⚠️ pct 为 null 时**必须发 indeterminate，不能发 0**。
         * 2026-11-10 苏哥报「B站下载只有 0%，没有进度信息」就是这里：
         * 页面侧 durl 通道只写 loaded/total 不写 pct → 这里收到 null →
         * 老代码发 {pct: 0} → 前端老老实实显示 0%，而且每秒刷新一次，
         * 看着就像「卡死在 0%」。不知道就别装作知道。
         */
        note: function (phase, pct) {
            if (closed) { return; }
            if (pct == null || pct === '' || !isFinite(Number(pct))) {
                /* 同一阶段只发一次 indeterminate，别每秒刷一遍消息 */
                if (sentIndet && phase === lastIndetPhase) { return; }
                sentIndet = true;
                lastIndetPhase = phase || '';
                send({ indeterminate: true, phase: phase || '' });
                return;
            }
            var p = Math.max(0, Math.min(99, Math.round(Number(pct) || 0)));
            if (p === lastPct) { return; }
            lastPct = p;
            send({ pct: p, phase: phase || '' });
        },
        /** 交给 downloads 任务的字节轮询。 */
        watch: function (id) {
            if (closed || typeof id !== 'number' || !isFinite(id)) { return; }
            var sentWatchIndet = false;
            vrWatchDownloadId(id, function (payload) {
                if (payload.done) {
                    closed = true;
                    send(payload, true);      // 终态必须强发，见 send() 的注释
                    return;
                }
                if (payload.pct != null) {
                    sentWatchIndet = false;
                    if (payload.pct === lastPct) { return; }
                    lastPct = payload.pct;
                    send(payload);
                    return;
                }
                /* 拿不到总字节（服务器没给 Content-Length）：只报一次不确定，
                 * 别每 500ms 刷一条 —— 白耗电，前端也会被反复重绘。 */
                if (!sentWatchIndet) {
                    sentWatchIndet = true;
                    send(payload);
                }
            });
        },
        /** 终态。只生效一次；之后所有上报丢弃。 */
        done: function (ok, err, bytes) {
            if (closed) { return; }
            closed = true;
            send({ done: true, ok: !!ok, error: err || '', bytes: Number(bytes) || 0 }, true);
        },
        isClosed: function () { return closed; }
    };
}

/** 按 downloadId 轮询真实字节进度，回调 {pct} 或 {done,ok,error,bytes}。
 *  30 分钟硬上限，防定时器泄漏。 */
function vrWatchDownloadId(id, cb) {
    let ticks = 0;
    let lastPct = -1;
    const timer = setInterval(async function () {
        ticks++;
        if (ticks > 3600) {            // 500ms × 3600 ≈ 30 分钟
            clearInterval(timer);
            return;
        }
        let d = null;
        try {
            const list = await new Promise(function (res) {
                chrome.downloads.search({ id: id }, function (l) {
                    res(chrome.runtime.lastError ? [] : (l || []));
                });
            });
            d = list && list[0];
        } catch (e) { /* 下一次再试 */ }

        if (!d) { clearInterval(timer); return; }

        const total = Number(d.totalBytes) || Number(d.fileSize) || 0;
        const got = Number(d.bytesReceived) || 0;

        if (d.state === 'complete') {
            clearInterval(timer);
            /* 「下载成功」不等于「内容是好的」。
             * CDN 的风控页 / 登录页 / 反爬页经常以 **200 + text/html** 返回，
             * chrome.downloads 照单全收 —— 落盘就是一个打不开的坏文件。
             * 2026-11-09 查库时见到实证：抖音那几条 15KB / 848KB 的「视频」就是这种。
             *
             * 抄 SnapHD（background/download-tracker.js）的校验思路，但比它更保守：
             *   它用 `!/^(video|image|audio)\//` 白名单，会把 application/mp4、
             *   video/quicktime 之外的合法类型也判死（误删真文件）。
             * 我们只拦**明确是文本/网页**的类型 + 0 字节，未知 mime 一律放过 ——
             * 宁可留一个可疑文件让用户自己看，也不能删掉真视频。 */
            const bytes = Number(d.fileSize) || got || 0;
            if (vrDownloadLooksInvalid(d)) {
                vrDiscardBadDownload(id);
                const mime = String(d.mime || '').toLowerCase();
                const why = !bytes
                    ? '下载到的文件是空的'
                    : ('服务器返回的是网页（' + mime + '），不是视频 —— 多半是反爬/登录页');
                cb({ done: true, ok: false, error: why, invalidContent: true });
                return;
            }
            try { vrMarkDownloaded(d.filename || ''); } catch (e) { /* 记账失败不影响下载结果 */ }
            cb({ done: true, ok: true, bytes: bytes });
            return;
        }
        if (d.state === 'interrupted') {
            clearInterval(timer);
            cb({ done: true, ok: false, error: d.error || '下载中断' });
            return;
        }
        if (!total) {                  // 服务器没给 Content-Length：老实说不知道进度
            cb({ indeterminate: true, phase: '下载中' });
            return;
        }
        const pct = Math.max(0, Math.min(99, Math.round(got / total * 100)));
        if (pct !== lastPct) {
            lastPct = pct;
            cb({ pct: pct, phase: '下载中' });
        }
    }, 500);
}

/** B站：下载在页面主世界里自己跑，进度写在 window.__vrBiliDL。
 *  这里只做「读页面状态 → 转给统一 reporter」，不自己发消息。 */
function vrWatchBiliDownload(tabId, name, P) {
    const rep = P || vrProgressReporter(tabId, name);
    let ticks = 0;
    const timer = setInterval(async function () {
        ticks++;
        let st = null;
        try {
            const r = await chrome.scripting.executeScript({
                target: { tabId: tabId }, world: 'MAIN',
                func: function () { return window.__vrBiliDL || null; }
            });
            st = r && r[0] && r[0].result;
        } catch (e) { /* 页面关了 */ }

        const timeout = ticks > 600;   // 约 10 分钟（合成大文件可能久）
        if (!st || !st.done) {
            if (!timeout) {
                /* st 为 null 说明页面侧还没把 __vrBiliDL 建起来（刚发起的那一两秒）。
                 * 以前这里直接 return，一个字都不报 —— 按钮就一直停在点击那一刻的 0%，
                 * 用户完全看不出「到底在跑还是死了」。现在统一报「不确定 + 阶段」。 */
                rep.note((st && st.phase) || '准备中',
                         (st && st.indeterminate) ? null : (st ? st.pct : null));
                return;
            }
        }
        clearInterval(timer);
        const err = (st && st.error) || (timeout ? '超时' : '');
        rep.done(!err, err, (st && st.bytes) || 0);
    }, 1000);
}

async function vrSaveContextMedia(info, isImage) {
    if (!info || !info.srcUrl) { return; }
    const tabId = info.tabId != null ? info.tabId : G.tabId;

    // 扩展名：从 URL 猜一个，猜不到就用默认
    let ext = (info.srcUrl.split('#')[0].split('?')[0].split('.').pop() || '').toLowerCase();
    const allow = isImage
        ? /^(jpg|jpeg|png|gif|webp|avif|bmp|svg)$/
        : /^(mp4|webm|mkv|mov|m4v|m4a|mp3|aac|flac|wav|ogg|ts)$/;
    if (!allow.test(ext)) { ext = isImage ? 'jpg' : 'mp4'; }

    let settings = {};
    try {
        const res = await chrome.storage.local.get('vrSettings');
        settings = (res && res.vrSettings) || {};
    } catch (e) { /* 忽略 */ }

    const tpl = settings.template || '${author}_${title}';

    let name = '';
    let pageUrl = '';
    let authorFull = '';
    try {
        await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['js/naming.js'] });
        const r = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: function (tpl, ext) {
                const N = self.VideoRodNaming;
                if (!N) { return null; }
                try {
                    const i = N.extractPageInfo(document, location.href);
                    return {
                        name: N.buildNameFromInfo(i, location.href, { tpl: tpl, ext: ext }),
                        info: i,
                        pageUrl: location.href
                    };
                } catch (e) { return null; }
            },
            args: [tpl, ext]
        });
        const r0 = (r && r[0] && r[0].result) || null;
        if (r0) {
            name = r0.name || '';
            pageUrl = r0.pageUrl || '';
            authorFull = (r0.info && r0.info.authorFull) || '';
        }
    } catch (e) { /* 受限页面，退回时间戳名 */ }

    if (!name) { name = 'media_' + Date.now() + '.' + ext; }

    // 目录：优先走三段结构（子目录/平台/博主/类型），失败退回旧逻辑
    let dir = '';
    if (self.VRPath && self.VRPath.buildRelDir) {
        try {
            dir = self.VRPath.buildRelDir({
                pageUrl: pageUrl,
                mediaUrl: info.srcUrl,
                authorFull: authorFull,
                ext: ext,
                subdir: settings.defaultDir || 'video-rod'
            });
        } catch (e2) { /* 退回 */ }
    }
    if (!dir) {
        dir = String(settings.defaultDir || 'video-rod').replace(/[<>:"|?*\\]/g, '').replace(/^\/+|\/+$/g, '') || 'video-rod';
    }
    const filename = (dir + '/' + name).replace(/\\/g, '/').replace(/\/{2,}/g, '/');

    /* 右键秒存也上进度（B-52 统一）：同一个 reporter，页内按钮一样能看到百分比。
     * 以前这条路径什么都不报，用户点了只能干等。 */
    const P = vrProgressReporter(tabId, filename);
    vrDownloadWithName(info.srcUrl, filename, { onProgress: P.bytes }).then(function (id) {
        // 同上：FSA 成功返回对象，只有真 null 才是失败
        if (id === null || id === undefined) {
            P.done(false, '下载失败');
            console.warn('[video-rod] 秒存失败', chrome.runtime.lastError);
            return;
        }
        if (id && typeof id === 'object' && id.__fsa) {
            P.done(true, '', 0);
        } else {
            P.watch(id);        // 走下载器：按真实字节继续报，完成时 reporter 收尾
        }
        vrMarkDownloaded(filename);
    });
}

const runCommands = (command, data) => {
    if (command == "auto_down") {
        if (G.featAutoDownTabId.has(G.tabId)) {
            G.featAutoDownTabId.delete(G.tabId);
        } else {
            G.featAutoDownTabId.add(G.tabId);
        }
        (chrome.storage.session ?? chrome.storage.local).set({ featAutoDownTabId: Array.from(G.featAutoDownTabId) });
    } else if (command == "catch") {
        const scriptTabid = G.scriptList.get("catch.js").tabId;
        scriptTabid.has(G.tabId) ? scriptTabid.delete(G.tabId) : scriptTabid.add(G.tabId);
        chrome.tabs.reload(G.tabId, { bypassCache: true });
    } else if (command == "m3u8") {
        chrome.tabs.create({ url: "m3u8.html" });
    } else if (command == "clear") {
        delete cacheData[G.tabId];
        (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData });
        clearRedundant();
        SetIcon({ tabId: G.tabId });
    } else if (command == "enable") {
        G.enable = !G.enable;
        chrome.storage.sync.set({ enable: G.enable });
        chrome.action.setIcon({ path: G.enable ? "/img/icon.png" : "/img/icon-disable.png" });
    } else if (command == "reboot") {
        chrome.runtime.reload();
    } else if (command == "deepSearch") {
        const script = G.scriptList.get("search.js");
        const scriptTabid = script.tabId;
        if (scriptTabid.has(G.tabId)) {
            scriptTabid.delete(G.tabId);
            G.deepSearchTemporarilyClose = G.tabId;
            chrome.tabs.reload(G.tabId, { bypassCache: true });
            return;
        }
        scriptTabid.add(G.tabId);
        chrome.tabs.reload(G.tabId, { bypassCache: true });
    } else if (command == "preview") {
        chrome.tabs.create({ url: `preview.html?tabId=${G.tabId}` });
    } else if (command == "image-save") {
        chrome.downloads.download({
            url: data.srcUrl,
            saveAs: G.saveAs
        }, () => {
            chrome.runtime.lastError && console.error(chrome.runtime.lastError);
            G.downDataImageSave = data;
        });
    } else if (command == "vr-video-save" || command == "vr-image-save") {
        vrSaveContextMedia(data, command == "vr-image-save");
    } else if (command == "vr-image-panel") {
        /* 右键 → 本页所有图片：直接把侧边栏切到 image.html 并打开。
         * 必须按 tabId 设路径（不设会覆盖整个窗口的默认路径）。 */
        const tId = (data && data.tabId) || G.tabId;
        try {
            if (chrome.sidePanel && chrome.sidePanel.setOptions) {
                chrome.sidePanel.setOptions({ tabId: tId, path: "image.html?tabId=" + tId });
            }
            if (chrome.sidePanel && chrome.sidePanel.open) {
                const ret = chrome.sidePanel.open({ tabId: tId });
                if (ret && typeof ret.catch === 'function') {
                    ret.catch(function () { /* 无手势上下文时失败，可接受 */ });
                }
            }
        } catch (e) { /* 无侧边栏 API：忽略 */ }
    } else if (command == "vr-downloads-page") {
        try { chrome.tabs.create({ url: "downloads.html" }); } catch (e) { /* 忽略 */ }
    }
}
chrome.downloads.onChanged.addListener(function (item) {
    if (G.catDownload) { delete G.downDataImageSave; return; }
    const errorList = ["SERVER_BAD_CONTENT", "SERVER_UNAUTHORIZED", "SERVER_FORBIDDEN", "SERVER_UNREACHABLE", "SERVER_CROSS_ORIGIN_REDIRECT", "SERVER_FAILED", "NETWORK_FAILED"];
    if (item.error && errorList.includes(item.error.current) && G.downDataImageSave) {
        const data = { requestHeaders: { referer: G.downDataImageSave.pageUrl }, requestId: G.tabId, url: G.downDataImageSave.srcUrl };
        chrome.tabs.create({ url: `downloader.html?JSON=${JSON.stringify(data)}&autoClose=true`, active: false });
        delete G.downDataImageSave;
    }
});

/**
 * 浏览器 扩展快捷键
 */
/* 图片下载快捷键（I5）：Alt+Shift+D 下载悬停图 / Alt+Shift+A 开清单。
 * 走 chrome.commands 而不是页面 keydown——全局生效、不与站点按键冲突、
 * 用户还能在 chrome://extensions/shortcuts 自己改键。 */
function vrImgHotkey(command, tab) {
    if (!tab || !tab.id) { return; }
    var action = command === 'imgDownload' ? 'download'
        : (command === 'imgPanelOpen' ? 'panel' : '');
    if (!action) { return; }
    chrome.storage.local.get('vrLibSettings', function (o) {
        var st = (o && o.vrLibSettings) || {};
        if (st.imgHotkeys === false) { return; }              // 快捷键总开关
        if (action === 'download' && st.imgHover === false) { return; }
        /* panel：打开「本页图片清单」。
         * 2026-11-06 改为直接打开侧边栏 image.html —— 批量入口已从页面浮标收进侧边栏，
         * 旧逻辑要 imgPanel !== false 才生效，而 imgPanel 默认就是 false，
         * 等于这个快捷键一直是死的（按了没反应）。 */
        if (action === 'panel') {
            try {
                if (chrome.sidePanel && chrome.sidePanel.setOptions) {
                    chrome.sidePanel.setOptions({ tabId: tab.id, path: 'image.html?tabId=' + tab.id });
                }
                if (chrome.sidePanel && chrome.sidePanel.open) {
                    var ret = chrome.sidePanel.open({ tabId: tab.id });
                    if (ret && typeof ret.catch === 'function') {
                        ret.catch(function () { /* 无手势上下文时失败，可接受 */ });
                    }
                    return;
                }
            } catch (e) { /* 无侧边栏 API：退回页面浮标面板 */ }
        }
        chrome.tabs.sendMessage(tab.id, { Message: 'vrImg.hotkey', action: action }, function () {
            void chrome.runtime.lastError;   // 页面上没有内容脚本（如 chrome://）属正常
        });
    });
}

chrome.commands.onCommand.addListener(function (command, tab) {
    if (command === 'imgDownload' || command === 'imgPanelOpen') {
        // 快捷键可能在没有 tab 上下文时触发，补一次查询
        if (tab && tab.id) { vrImgHotkey(command, tab); return; }
        chrome.tabs.query({ active: true, currentWindow: true }, function (list) {
            if (list && list[0]) { vrImgHotkey(command, list[0]); }
        });
        return;
    }
    runCommands(command);
});

/* 点工具栏图标 → 直接开侧边栏图片页。
 *
 * 为什么需要这一段：manifest 里已去掉 action.default_popup，正常情况下
 * chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}) 就会接管点击。
 * 但 Edge 旧版 / 用户手动关过侧边栏开关 / setPanelBehavior 失败时，点击会变成
 * 「什么都不发生」——那正是苏哥报的「点不开」。这里用 onClicked 兜底：
 * 只有当 setPanelBehavior 明确不可用时才介入，避免正常情况下被调用两次。
 *
 * 注意：有 default_popup 时 onClicked 根本不会触发（浏览器优先弹 popup），
 * 所以本兜底与「去掉 default_popup」是配套的，缺一不可。 */
if (chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener(function (tab) {
        var tid = tab && tab.id;
        if (!(tid > 0)) { return; }
        try {
            if (!chrome.sidePanel || !chrome.sidePanel.open) { return; }
            if (chrome.sidePanel.setOptions) {
                chrome.sidePanel.setOptions({ tabId: tid, path: 'image.html?tabId=' + tid });
            }
            var ret = chrome.sidePanel.open({ tabId: tid });
            if (ret && typeof ret.catch === 'function') {
                ret.catch(function () {
                    /* 无用户手势上下文时会被拒（例如 SW 恢复场景）。
                     * 这时退回 popup.html，总比什么都不发生好。 */
                    try { chrome.action.openPopup && chrome.action.openPopup(); } catch (e) { /* 忽略 */ }
                });
            }
        } catch (e) { /* 无侧边栏 API：什么都不做 */ }
    });
}

/**
 * 监听 右键菜单事件
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
    runCommands(info.menuItemId, info);
});

/**
 * 监听 页面完全加载完成 判断是否在线ffmpeg页面
 * 如果是在线ffmpeg 则发送数据
 */
chrome.webNavigation.onCompleted.addListener(function (details) {
    if (G.ffmpegConfig.tab && details.tabId == G.ffmpegConfig.tab) {
        setTimeout(() => {
            G.ffmpegConfig.cacheData.forEach(data => {
                chrome.tabs.sendMessage(details.tabId, data);
            });
            G.ffmpegConfig.cacheData = [];
            G.ffmpegConfig.tab = 0;
        }, 500);
    }
});

// 操作符检查
function operatorCheck(size, Obj) {
    const unitNumber = {
        "B": 1,
        "BYTE": 1,
        "KB": 1024,
        "MB": 1048576,
        "GB": 1073741824
    };
    const unit = (Obj.unit || "B");
    const targetSize = Obj.size * (unitNumber[unit] || 1);
    switch (Obj.operator) {
        case "=":
            return size == targetSize;
        case "<":
            return size < targetSize;
        case ">":
            return size > targetSize;
        case "<=":
            return size <= targetSize;
        case ">=":
            return size >= targetSize;
        case "!=":
            return size != targetSize;
        case "~":
            return (Obj.min ? size >= Obj.min * (unitNumber[unit] || 1) : true) && (Obj.max ? size <= Obj.max * (unitNumber[unit] || 1) : true);
        default:
            return size <= targetSize;
    }
}

/**
 * 检查扩展名和大小
 * @param {String} ext 
 * @param {Number} size 
 * @returns {Boolean|String}
 */
function CheckExtension(ext, size) {
    const Ext = G.Ext.get(ext);
    if (!Ext) { return false; }
    if (!Ext.state) { return "break"; }
    if (Ext.size != 0 && size != undefined && !operatorCheck(size, Ext)) {
        return "break";
    }
    return true;
}

/**
 * 检查类型和大小
 * @param {String} dataType 
 * @param {Number} dataSize 
 * @returns {Boolean|String}
 */
function CheckType(dataType, dataSize) {
    const typeInfo = G.Type.get(dataType.split("/")[0] + "/*") || G.Type.get(dataType);
    if (!typeInfo) { return false; }
    if (!typeInfo.state) { return "break"; }
    if (typeInfo.size != 0 && dataSize != undefined && !operatorCheck(dataSize, typeInfo)) {
        return "break";
    }
    return true;
}

/**
 * 获取文件名及扩展名
 * @param {String} pathname 
 * @returns {Array}
 */
function fileNameParse(pathname) {
    let fileName = decodeURI(pathname.split("/").pop());
    let ext = fileName.split(".");
    ext = ext.length == 1 ? undefined : ext.pop().toLowerCase();
    return [fileName, ext ? ext : undefined];
}

/**
 * 获取响应头信息
 * @param {Object} data 
 * @returns {Object}
 */
function getResponseHeadersValue(data) {
    const header = {};
    if (data.responseHeaders == undefined || data.responseHeaders.length == 0) { return header; }
    for (let item of data.responseHeaders) {
        item.name = item.name.toLowerCase();
        if (item.name == "content-length") {
            header.size ??= parseInt(item.value);
        } else if (item.name == "content-type") {
            header.type = item.value.split(";")[0].toLowerCase();
        } else if (item.name == "content-disposition") {
            header.attachment = item.value;
        } else if (item.name == "content-range") {
            let size = item.value.split('/')[1];
            if (size !== '*') {
                header.size = parseInt(size);
            }
        }
    }
    return header;
}

/**
 * 获取请求头
 * @param {Object} data 
 * @returns {Object|Boolean}
 */
const DIRECT_INCLUDE_HEADERS = new Set([
    "referer",
    "origin",
    "cookie",
    "authorization",
    "auth",
    "token",
    "key",
    "access-token",
    "api-key",
    "app-token",
    "authtoken",
    "session-id"
]);
const X_AUTH_KEYWORD_REG = /(auth|token|sign|key|ticket|session)/;
function getRequestHeaders(data) {
    if (!data?.allRequestHeaders?.length) {
        return false;
    }
    const header = {};
    for (let item of data.allRequestHeaders) {
        if (!item.name || !item.value) continue;
        const lowerName = item.name.toLowerCase();
        if (DIRECT_INCLUDE_HEADERS.has(lowerName)) {
            header[lowerName] = item.value;
            continue;
        }
        if (lowerName.startsWith("x-") && X_AUTH_KEYWORD_REG.test(lowerName)) {
            header[lowerName] = item.value;
        }
    }
    return Object.keys(header).length > 0 ? header : false;
}
//设置扩展图标
function SetIcon(obj) {
    if (obj?.number == 0 || obj?.number == undefined) {
        chrome.action.setBadgeText({ text: "", tabId: obj?.tabId ?? G.tabId }, function () { if (chrome.runtime.lastError) { return; } });
        // chrome.action.setTitle({ title: "还没闻到味儿~", tabId: obj.tabId }, function () { if (chrome.runtime.lastError) { return; } });
    } else if (G.badgeNumber) {
        obj.number = obj.number > 999 ? "999+" : obj.number.toString();
        chrome.action.setBadgeText({ text: obj.number, tabId: obj.tabId }, function () { if (chrome.runtime.lastError) { return; } });
        // chrome.action.setTitle({ title: "抓到 " + obj.number + " 条鱼", tabId: obj.tabId }, function () { if (chrome.runtime.lastError) { return; } });
    }
}

// 模拟手机端
function mobileUserAgent(tabId, change = false) {
    if (change) {
        G.featMobileTabId.add(tabId);
        (chrome.storage.session ?? chrome.storage.local).set({ featMobileTabId: Array.from(G.featMobileTabId) });
        chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [tabId],
            addRules: [{
                "id": tabId,
                "action": {
                    "type": "modifyHeaders",
                    "requestHeaders": [{
                        "header": "User-Agent",
                        "operation": "set",
                        "value": G.MobileUserAgent
                    }]
                },
                "condition": {
                    "tabIds": [tabId],
                    "resourceTypes": Object.values(chrome.declarativeNetRequest.ResourceType)
                }
            }]
        });
        return true;
    }
    G.featMobileTabId.delete(tabId) && (chrome.storage.session ?? chrome.storage.local).set({ featMobileTabId: Array.from(G.featMobileTabId) });
    chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [tabId]
    });
}

// 判断特殊页面
function isSpecialPage(url) {
    if (!url || url == "null") { return true; }
    return !(url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:"));
}

/**
 * 清理冗余数据
 */
function clearRedundant() {
    chrome.tabs.query({}, function (tabs) {
        const allTabId = new Set(tabs.map(tab => tab.id));

        if (!cacheData.init) {
            // 清理 缓存数据
            let cacheDataFlag = false;
            for (let key in cacheData) {
                if (!allTabId.has(Number(key))) {
                    cacheDataFlag = true;
                    delete cacheData[key];
                }
            }
            cacheDataFlag && (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData });
        }

        // 清理
        G.urlMap.forEach((_, key) => {
            !allTabId.has(key) && G.urlMap.delete(key);
        });

        // 清理脚本
        G.scriptList.forEach(function (scriptList) {
            scriptList.tabId.forEach(function (tabId) {
                if (!allTabId.has(tabId)) {
                    scriptList.tabId.delete(tabId);
                }
            });
        });

        if (!G.initLocalComplete) { return; }

        // 清理 declarativeNetRequest 模拟手机
        chrome.declarativeNetRequest.getSessionRules(function (rules) {
            let mobileFlag = false;
            for (let item of rules) {
                if (item.condition.tabIds) {
                    // 如果tabIds列表都不存在 则删除该条规则
                    if (!item.condition.tabIds.some(id => allTabId.has(id))) {
                        mobileFlag = true;
                        item.condition.tabIds.forEach(id => G.featMobileTabId.delete(id));
                        chrome.declarativeNetRequest.updateSessionRules({
                            removeRuleIds: [item.id]
                        });
                    }
                } else if (item.id == 1) {
                    // 清理预览视频增加的请求头
                    chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1] });
                }
            }
            mobileFlag && (chrome.storage.session ?? chrome.storage.local).set({ featMobileTabId: Array.from(G.featMobileTabId) });
        });
        // 清理自动下载
        let autoDownFlag = false;
        G.featAutoDownTabId.forEach(function (tabId) {
            if (!allTabId.has(tabId)) {
                autoDownFlag = true;
                G.featAutoDownTabId.delete(tabId);
            }
        });
        autoDownFlag && (chrome.storage.session ?? chrome.storage.local).set({ featAutoDownTabId: Array.from(G.featAutoDownTabId) });

        G.blockUrlSet = new Set([...G.blockUrlSet].filter(x => allTabId.has(x)));
        G.damnUrlSet = new Set([...G.damnUrlSet].filter(x => allTabId.has(x)));

        if (G.requestHeaders.size >= 10240) {
            G.requestHeaders.clear();
        }
    });
}

// 扩展升级，清空本地储存
chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason == "update") {
        chrome.storage.local.clear(function () {
            if (chrome.storage.session) {
                chrome.storage.session.clear(InitOptions);
            } else {
                InitOptions();
            }
        });
        chrome.alarms.create("nowClear", { when: Date.now() + 3000 });
    }
    if (details.reason == "install") {
        chrome.tabs.create({ url: "install.html" });
    }
});

// 测试
// chrome.storage.local.get(function (data) { console.log("storageLocal", data.MediaData) });
// chrome.storage.session.get(function (data) { console.log("storageSession", data.MediaData) });
// chrome.declarativeNetRequest.getSessionRules(function (rules) { console.log("sessionRules", rules); });
// chrome.tabs.query({}, function (tabs) { for (let item of tabs) { console.log("tabId", item.id); } });