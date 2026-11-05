/**
 * chrome 使用v3 background.service_worker 加载模式
 * firefox 使用v2 background.scripts 加载模式
 * firefox 在 manifest 文件中已经加载以下脚本，如果已经加载 G 变量存在，不再加载。
 */
if (typeof G === 'undefined') {
    importScripts("/js/polyfill.js", "/js/function.js", "/js/templates.js", "/js/init.js",
        "/js/bili-whole.js", "/js/douyin.js",
        "/js/library/path.js", "/js/library/db.js", "/js/library/sw-library.js",
        "/js/lib-image-util.js");
}
// 已加载过 G 的场景（Firefox）单独补资源库脚本，保证 VRPath/VRLib 可用
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
/* VRSave 依赖 VRPath（算相对路径）与 VRLib（FSA 写完后主动入库），
 * 所以必须放在这两个之后加载。 */
if (typeof self.VRSave === 'undefined') {
    try { importScripts("/js/library/save.js"); } catch (e) { /* 已加载或环境不支持 */ }
}

// Service Worker 5分钟后会强制终止扩展
// https://bugs.chromium.org/p/chromium/issues/detail?id=1271154
// https://stackoverflow.com/questions/66618136/persistent-service-worker-in-chrome-extension/70003493#70003493
chrome.webNavigation.onBeforeNavigate.addListener(function () { return; });
chrome.webNavigation.onHistoryStateUpdated.addListener(function () { return; });
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

function vrMergeNotify(msg) {
    try {
        chrome.runtime.sendMessage(msg, function () { void chrome.runtime.lastError; });
    } catch (e) { /* popup 可能没开 */ }
}

function vrMergeEnsureOffscreen() {
    return new Promise(function (resolve) {
        try {
            chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['BLOBS'],
                justification: 'M11 多段合并：解析/下载/解密/转码需要稳定的 blob 上下文'
            }, function () {
                // 已存在（Only one offscreen document allowed）也算就绪
                resolve();
            });
        } catch (e) {
            try {
                chrome.offscreen.createDocument({
                    url: 'offscreen.html',
                    reasons: ['BLOBS'],
                    justification: 'M11 多段合并'
                }).then(resolve, function () { resolve(); });
            } catch (e2) { resolve(); }
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
            prefer: 'auto'
        }).then(function (r) {
            if (r && r.ok && r.mode === 'fsa') {
                // FSA 直写没有下载事件，入库已在 save.js 内部做完了。
                // 这里返回一个「假 downloadId」会污染记账表（那张表靠真 id 撤账），
                // 所以统一返回 null 并打标记，让调用方知道「下成功了但不是下载器下的」。
                vrAbortFilename(url, filename);
                return { __fsa: true, path: r.path };
            }
            if (r && r.ok && r.mode === 'downloads') {
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
                        requestHeaders: [{ header: 'Referer', operation: 'set', value: pageUrl }]
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
    if (!VR_IMG_EXT_OK.test(ext)) { ext = 'jpg'; }
    return ext;
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
    const ext = vrImgExt(url, msg && msg.contentType);
    let title = '';
    try { title = P.cleanSeg(String((msg && msg.title) || '')) || ''; } catch (e) { title = ''; }
    if (!title) { title = '图片'; }
    if (title.length > 60) { title = title.slice(0, 60); }

    const fileName = vrImgDate() + '_' + title + '.' + ext;
    const subdir = await vrImgSubdir();
    let relPath;
    try {
        relPath = P.buildRelPath({
            pageUrl: pageUrl || url,
            type: 'image',
            ext: ext,
            fileName: fileName,
            subdir: subdir
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
        title: String((msg && msg.title) || '')
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
        return { ok: true, fsa: true, downloadId: null, path: downloadId.path || relPath };
    }
    if (downloadId === null || downloadId === undefined) {
        // 没发起下载，规则立刻撤
        if (ruleId) { vrImgClearRefererRule(ruleId); }
        return { ok: false, code: 'IMG_E_FETCH', message: '下载发起失败，站点可能限制了直链', path: relPath };
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
async function vrImgBatch(msg) {
    const batchId = String((msg && msg.batchId) || ('b-' + Date.now()));
    const raw = Array.isArray(msg && msg.items) ? msg.items : [];
    const conc = Math.max(1, Math.min(8, Number(msg && msg.concurrency) || VR_IMG_BATCH_CONC));
    const pageUrl = String((msg && msg.pageUrl) || '');
    const pageTitle = String((msg && msg.pageTitle) || '');

    const items = raw.slice(0, VR_IMG_BATCH_MAX);
    const state = { canceled: false, done: 0, ok: 0, fail: 0, total: items.length, lastEmit: 0, failures: [] };
    VR_IMG_BATCH.set(batchId, state);

    if (!items.length) {
        VR_IMG_BATCH.delete(batchId);
        return { ok: true, batchId: batchId, done: 0, succeeded: 0, fail: 0, failures: [], canceled: false };
    }

    // 已下载去重表：同 URL 不再重复下
    const seen = await vrImgSeenUrls();

    let cursor = 0;
    const worker = async function () {
        while (true) {
            if (state.canceled) { return; }
            const idx = cursor++;
            if (idx >= items.length) { return; }
            const it = items[idx] || {};
            const url = String(it.url || '');
            const key = vrImgDedupeKey(url);

            if (key && seen[key]) {
                // 已经下过：算成功跳过，不重复落盘
                state.done++; state.ok++;
                vrImgProgressThrottle(batchId, state);
                continue;
            }
            try {
                const r = await vrImgDownload({
                    url: url,
                    candidates: it.candidates || [url],
                    pageUrl: pageUrl,
                    title: (it.title || pageTitle || '图片')
                });
                if (r && r.ok) {
                    state.ok++;
                    if (key) { seen[key] = 1; vrImgRememberUrl(key); }
                } else {
                    state.fail++;
                    state.failures.push({ url: url, code: (r && r.code) || 'IMG_E_FETCH' });
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
    if (mode !== 'scroll') {
        // B 模式（分页翻页）尚未实现：如实拒绝，不做「假装支持」
        return { ok: false, code: 'IMG_E_UNSUPPORTED', message: '翻页模式尚未实现，请用滚动模式' };
    }
    const maxPages = Math.max(1, Math.min(50, Number(msg && msg.maxPages) || 10));
    const id = String((msg && msg.taskId) || vrAlbumNewId());
    const min = Math.max(16, Number(msg && msg.minSize) || 100);

    if (!tabId) {
        return { ok: false, code: 'IMG_E_NO_TAB', message: '拿不到标签页 ID' };
    }

    const task = {
        taskId: id,
        tabId: tabId,
        mode: 'scroll',
        maxPages: maxPages,
        minSize: min,
        page: 0,
        urls: [],
        state: 'scanning',
        message: '',
        updatedAt: Date.now(),
        lastEmit: 0
    };
    VR_ALBUM_STOP.delete(id);
    await vrAlbumPut(task);
    vrAlbumEmit(task, true);
    // 不 await：扫描要跑几十秒，立刻回 taskId 让面板能开始轮询
    vrAlbumLoop(id);
    return { ok: true, taskId: id, maxPages: maxPages, state: 'scanning' };
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

function vrImgDedupeKey(url) {
    const u = String(url || '').split('#')[0].trim();
    return u || '';
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
                    var hasUrl = (sd0.adaptiveFormats || []).some(function (f) { return !!f.url; });
                    if (!hasUrl) {
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
                        ? '这个视频需要登录才能播放。先在本浏览器登录 YouTube，再回来重试。'
                        : 'YouTube 正在限制本机请求。刷新视频页、等几分钟，或确认已登录后再试。');
                return {
                    ok: false,
                    code: code,
                    error: joined || lastErr || '所有客户端都拿不到直链',
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
            return {
                ok: true,
                formats: out,
                title: vd.title || document.title,
                author: vd.author || '',
                durationSec: +vd.lengthSeconds || 0,
                playerId: m ? m[1] : ''
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
    // YouTube：页面按钮点击 → 开下载窗口（单开小窗的理由见 js/yt/yt-download.js 抬头注释）
    if (Message && Message.Message === 'ytOpen') {
        var ytUrl = chrome.runtime.getURL('js/yt/yt-download.html') +
            '?videoId=' + encodeURIComponent(Message.videoId || '') +
            '&tabId=' + encodeURIComponent(String((sender.tab && sender.tab.id) || 0)) +
            '&title=' + encodeURIComponent(Message.title || '') +
            '&author=' + encodeURIComponent(Message.author || '') +
            '&authorId=' + encodeURIComponent(Message.authorId || '') +
            '&pageUrl=' + encodeURIComponent(Message.pageUrl || '');
        chrome.windows.create({
            url: ytUrl, type: 'popup', width: 480, height: 700, focused: true
        }, function (w) {
            if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                return;
            }
            sendResponse({ ok: true, windowId: w && w.id });
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
        chrome.scripting.executeScript({
            target: { tabId: ytTabId },
            world: 'MAIN',
            func: ytCollectFormats,
            args: [String(Message.videoId || '')]
        }, function (res) {
            if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                return;
            }
            var r = res && res[0] && res[0].result;
            sendResponse(r || { ok: false, error: '页面没有返回数据' });
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
        vrImgDownload(Message).then(function (res) {
            sendResponse(res);
        }).catch(function (e) {
            sendResponse({ ok: false, code: 'IMG_E_FETCH', message: String(e) });
        });
        return true;
    }
    // 图片批量下载（I3）：并发池 + 进度广播 + 可取消
    if (Message && (Message.Message === 'vrImg.batch' || Message.action === 'vrImg.batch')) {
        vrImgBatch(Message).then(function (res) {
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
        vrVideoOptions(tabId).then(function (r) {
            sendResponse({ ok: true, site: r.site, options: r.options });
        }).catch(function (e) {
            sendResponse({ ok: false, reason: String(e).slice(0, 120) });
        });
        return true;
    }
    if (Message.Message == "vrVideoDownload") {
        const tabId = (sender && sender.tab && sender.tab.id != null)
            ? sender.tab.id : (Message.tabId != null ? Message.tabId : G.tabId);
        vrVideoDownload(tabId, Message.optionId, Message.wantBest !== false)
            .then(function (r) { sendResponse(r); })
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
        const tabId = sender && sender.tab ? sender.tab.id : null;
        if (tabId == null) { sendResponse({ ok: false, reason: 'no-tab' }); return true; }
        chrome.scripting.executeScript({
            target: { tabId: tabId }, world: 'MAIN',
            args: [Message.noteId || ''], func: vrXhsScanInPage
        }).then(function (r) {
            sendResponse((r && r[0] && r[0].result) || { ok: false, reason: 'no-result' });
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
            chrome.sidePanel.setOptions({ tabId: tabId, path: "popup.html?tabId=" + tabId });
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
                    return N.buildNameFromInfo(i, location.href, { tpl: tpl, ext: ext });
                } catch (e) { return ''; }
            },
            args: [tpl, ext, override || null]
        });
        name = (r && r[0] && r[0].result) || '';
    } catch (e) { /* 受限页面，退回时间戳名 */ }

    if (!name) { name = 'media_' + Date.now() + '.' + ext; }
    return (dir + '/' + name).replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

const VR_VIDEO_EXT = /^(mp4|webm|mkv|mov|flv|ts|avi|m4v|m4s)$/i;

/**
 * 静态资源排除：有些站点把登录页背景图、占位动画也用 .mp4 命名（实测 TikTok 的
 * ttwstatic.com/tiktok_web_login_static/*.mp4 是 webp 静态图）。
 * 这些不是视频，混进「按体积选最大」会把用户带到错的素材上。
 * 判据：路径里带明显的静态资源目录/文件名标记 → 排除。
 */
const VR_STATIC_ASSET = /(web_login_static|\/static\/|\/assets\/|\/images?\/|\/icons?\/|\/sprites?\/|\.gif$|\.png$|\.jpe?g$|\.webp$|\.svg$)/i;

/* ---------- 媒体 CDN 的 Referer 保护 ----------
 * 抖音直链不带 Referer 会 403（实测：无 Referer 403 text/html，带 Referer 206 video/mp4）。
 * CocoCut 的做法是下载前用 declarativeNetRequest 临时给媒体请求 set Referer/Origin。
 * 规则只加在指定域名上，10 分钟后自动清掉，避免长期影响页面自己的请求。 */
const VR_MEDIA_HEADER_RULE_ID = 91001;
const VR_MEDIA_HEADER_ALARM = 'vrClearMediaHeaders';

async function vrSetMediaHeaders(domain, referer) {
    try {
        if (!chrome.declarativeNetRequest || !domain || !referer) { return; }
        let origin = '';
        try { origin = new URL(referer).origin; } catch (e) { /* ignore */ }
        const headers = [{ header: 'referer', operation: 'set', value: referer }];
        if (origin) { headers.push({ header: 'origin', operation: 'set', value: origin }); }
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [VR_MEDIA_HEADER_RULE_ID],
            addRules: [{
                id: VR_MEDIA_HEADER_RULE_ID,
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
function vrXhsScanInPage(noteId) {
    try {
        const st = window.__INITIAL_STATE__;
        const n = st && st.note;
        const map = n && n.noteDetailMap;
        if (!map) { return { ok: false, reason: 'no-state' }; }
        let id = noteId || n.currentNoteId || Object.keys(map)[0];
        let d = map[id];
        if (!d) { d = map[Object.keys(map)[0]]; }
        const note = d && d.note;
        if (!note) { return { ok: false, reason: 'no-note' }; }

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
        (note.imageList || []).forEach(function (im, i) {
            let url = im.url || '';
            if (!url && im.infoList) {
                const dft = im.infoList.find(function (x) { return x.imageScene === 'WB_DFT'; });
                const any = im.infoList.find(function (x) { return x.url; });
                url = (dft && dft.url) || (any && any.url) || '';
            }
            url = url || im.urlDefault || im.urlPre || '';
            if (!url) { return; }
            // 原图尝试：小红书 CDN 图上常带尺寸/格式预设后缀（`!nd_dft_...` / `!nc_n_...` 或 `?imageView2/...`），
            // 去掉后缀通常能拿到更大版本。若这个地址下不动，下载侧会用 urlFallback 自动回退到原始地址（不劣于现状）。
            const bare = String(url).split('#')[0].split('?')[0].split('!')[0];
            const best = (bare && bare !== url) ? bare : url;
            const item = { kind: 'image', url: best, ext: xhsImgExt(best), index: i };
            if (best !== url) {
                item.urlFallback = url;
                item.extFallback = xhsImgExt(url);
            }
            items.push(item);
        });

        const vids = new Map();
        function addVideo(v, idx) {
            const url = (v && (v.master_url || v.masterUrl || v.url)) || '';
            if (!url || vids.has(url)) { return; }
            vids.set(url, {
                kind: 'video', url: url, ext: 'mp4', index: idx || 0,
                format: String(v.format || '').toLowerCase(),
                width: Number(v.width) || 0,
                height: Number(v.height) || 0,
                bitrate: Number(v.avg_bitrate || v.video_bitrate || 0),
                quality: v.quality_type || ''
            });
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
async function vrXhsScanInTab(tabId, noteId) {
    let last = null;
    for (let i = 0; i < 8; i++) {
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
    for (let i = 0; i < list.length; i++) {
        const n = list[i] || {};
        if (!n.noteId) { done++; continue; }
        let tabId = null;
        let noteOk = false;
        try {
            const token = n.xsecToken
                ? '?xsec_token=' + encodeURIComponent(n.xsecToken) + '&xsec_source=pc_user'
                : '';
            const tab = await chrome.tabs.create({
                url: 'https://www.xiaohongshu.com/explore/' + encodeURIComponent(n.noteId) + token,
                active: false
            });
            tabId = tab.id;
            const loaded = await vrXhsWaitTab(tabId, 12000);
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
        } finally {
            if (tabId != null) {
                try { await chrome.tabs.remove(tabId); } catch (e) { /* ignore */ }
            }
        }
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
    const author = String(i.author || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 60);
    const id = String(i.authorId || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 40);
    const folder = author ? (id ? author + '(@' + id + ')' : author) : site;
    const kind = i.kind === 'video' ? 'videos' : 'images';
    return 'video-rod/' + site + '/' + folder + '/' + kind + '/' + name;
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
    let failStreak = 0;
    let paused = false;
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
            if (it.site === 'x') {
                // X CDN 允许 downloads；按媒体库平台/作者/类型落盘
                const id = await vrDownloadWithName(it.url, vrMediaPath(it, name));
                if (id !== null) {
                    const outcome = await vrWaitDownload(id, 15000);
                    if (outcome && outcome.state === 'interrupted') {
                        try { vrDropDownload(id); } catch (e) { /* ignore */ }
                    } else {
                        ok = true;
                    }
                }
            } else if (it.site === 'xhs') {
                // 小红书页面 fetch 被 CORS 拒绝，只能 downloads；统一进媒体库目录。
                // 图片优先试「去后缀原图」，失败自动回退带后缀的原始地址。
                const attempt = async function (u, ext) {
                    const saved = it.ext;
                    if (ext) { it.ext = ext; }
                    const nm = vrBulkName(it, i);
                    it.ext = saved;
                    const id = await vrDownloadWithName(u, vrMediaPath(it, nm));
                    if (id === null) { return false; }
                    const outcome = await vrWaitDownload(id, 20000);
                    if (outcome && outcome.state === 'interrupted') {
                        try { vrDropDownload(id); } catch (e) { /* ignore */ }
                        return false;
                    }
                    return true;
                };
                ok = await attempt(it.url, it.ext);
                if (!ok && it.urlFallback) { ok = await attempt(it.urlFallback, it.extFallback); }
            } else if (tabId != null) {
                const r = await vrTryPageDownload(tabId, it.url, vrMediaPath(it, name));
                ok = !!(r && r.ok);
                if (!ok) {
                    const id = await vrDownloadWithName(it.url, vrMediaPath(it, name));
                    ok = id !== null;
                }
            }
            if (ok) {
                done++;
                failStreak = 0;
                if (mediaKey) { seen.add(mediaKey); }
            } else {
                failStreak++;
            }
        }
        if (failStreak >= 3) { paused = true; break; }
        try {
            chrome.tabs.sendMessage(tabId, {
                Message: 'vrBulkProgress', done: done, skipped: skipped,
                total: list.length, paused: paused
            });
        } catch (e) { /* 页面关了 */ }
        await vrBulkSleep((it.site === 'x' || it.site === 'xhs')
            ? 3000 + Math.floor(Math.random() * 2000)
            : vrBulkDelay());
    }
    vrDedupSave(seen);
    return {
        ok: true, total: list.length, done: done, skipped: skipped,
        paused: paused, reason: paused ? '连续失败 3 次，已暂停（可能触发风控）' : ''
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
            chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [VR_MEDIA_HEADER_RULE_ID]
            });
        }
    });
} catch (e) { /* ignore */ }

/** 页内按钮：查询这个标签页能下哪些清晰度 */
async function vrVideoOptions(tabId) {
    const out = { site: 'generic', options: [] };

    // 抖音优先：详情接口一次拿到「当前这条」的元数据和全部清晰度。
    // 不走嗅探缓存 → 不会把推荐位/预览片当成目标（苏哥 2026-10-19 报的选错）。
    try {
        const tab = await chrome.tabs.get(tabId);
        const awemeId = self.VR_DOUYIN.parseAwemeId((tab && tab.url) || '');
        if (awemeId) {
            const r = await chrome.scripting.executeScript({
                target: { tabId: tabId }, world: 'MAIN',
                args: [awemeId], func: self.VR_DOUYIN.probeFunc
            });
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
        const r = await chrome.scripting.executeScript({
            target: { tabId: tabId }, world: 'MAIN', func: self.VR_BILI.probeFunc
        });
        const info = r && r[0] && r[0].result;
        if (info && (info.hasDurl || info.hasDash)) {
            out.site = 'bili';
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

    // 通用站点：先问页面「现在正在播的是哪个」，再回落到嗅探缓存。
    // 多视频页面（信息流/推荐位）里「体积最大」不等于「你正在看的」。
    let playing = '';
    try {
        const pr = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: function () {
                const vs = Array.from(document.querySelectorAll('video'));
                const v = vs.filter(function (x) { return x.currentSrc && !x.paused; })[0]
                    || vs.filter(function (x) { return x.currentSrc; })[0];
                return v ? v.currentSrc : '';
            }
        });
        playing = (pr && pr[0] && pr[0].result) || '';
    } catch (e) { /* 受限页面，退回体积排序 */ }

    const list = (cacheData[tabId] || []).filter(function (m) {
        return m && m.url && VR_VIDEO_EXT.test(m.ext || '') && !VR_STATIC_ASSET.test(m.url || '');
    }).slice().sort(function (a, b) {
        // 正在播的那条永远排第一；其余才按体积（单视频页面的老规则）
        const ap = (playing && a.url === playing) ? 0 : 1;
        const bp = (playing && b.url === playing) ? 0 : 1;
        return (ap - bp) || ((b.size || 0) - (a.size || 0));
    });

    // 嗅探缓存里没有当前正在播的 URL 时，直接把它补进来。
    // 页面自己播放的地址一定是最准的（微博刷新/扩展重载后缓存可能为空）。
    if (playing && /^https?:/i.test(playing) &&
        !list.some(function (m) { return m.url === playing; })) {
        const pExt = (playing.split('#')[0].split('?')[0].split('.').pop() || 'mp4').toLowerCase();
        if (VR_VIDEO_EXT.test(pExt)) {
            list.unshift({ url: playing, ext: pExt, size: 0 });
        }
    }

    out.options = list.slice(0, 6).map(function (m, i) {
        return {
            id: 'm' + i, kind: 'url', url: m.url,
            label: (m.ext || 'video').toUpperCase() +
                (m.size ? ' · ' + (m.size / 1048576).toFixed(1) + 'MB' : ''),
            note: i === 0 ? ((playing && m.url === playing) ? '当前播放' : '最大') : ''
        };
    });
    return out;
}

/** 页内按钮：按选项下载。完成后主动推 vrVideoProgress 给按钮更新状态。
 *  B站 的两条路都必须在页面主世界跑（CDN 要页面 Referer，ADR-029）。 */
async function vrVideoDownload(tabId, optionId, wantBest) {
    const opt = await vrVideoOptions(tabId);
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

    const seen = await vrDedupLoad();
    let dedupKey = '';
    try {
        const tab = await chrome.tabs.get(tabId);
        const pageUrl = (tab && tab.url) || '';
        dedupKey = vrMediaIdentity({
            site: opt.site || 'generic',
            url: pick.url || pageUrl,
            mediaId: pick.kind || pick.id || '',
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
    if (opt.site === 'douyin') {
        // 抖音 CDN 要 Referer；用 DNR 会话规则补上（抄 CocoCut，ADR-031）
        const tab = await chrome.tabs.get(tabId);
        await vrSetMediaHeaders('douyinvod.com', (tab && tab.url) || 'https://www.douyin.com/');
        const filename = await vrNameInTab(tabId, 'mp4', opt.meta);
        const id = await vrDownloadWithName(pick.url, filename);
        if (id === null) { return { ok: false, reason: 'download-failed' }; }
        vrMarkDownloaded(filename);
        return finish({ ok: true, kind: 'url', filename: filename });
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
        const meta = await vrPageMetaInTab(tabId);
        const filename = await vrNameInTab(tabId, VR_VIDEO_EXT.test(ext) ? ext : 'mp4', meta || null);

        // F2 溯源：把「原帖地址/作者/作品ID/直链」一起预登记进库，
        // 否则库里来源永远是「未记录」。埋点失败绝不影响下载。
        const trace = {
            pageUrl: pageUrl || (meta && meta.pageUrl) || '',
            mediaUrl: pick.url || '',
            author: (meta && meta.author) || '',
            authorId: (meta && meta.authorId) || '',
            workId: (meta && meta.workId) || '',
            title: (meta && meta.title) || '',
            platform: (meta && meta.site) || ''
        };
        try {
            const nm = await vrTraceMetaInTab(tabId);
            if (nm) { Object.assign(trace, nm); }
        } catch (e) { /* 埋点失败不影响下载 */ }

        // 路线 1（默认）：downloads API + DNR 回放页面 Referer。
        // 保留子目录和文件名保护；普通站点/抖音都走这条。
        if (pageUrl) { await vrSetMediaHeadersFor(pick.url, pageUrl); }
        const id = await vrDownloadWithName(pick.url, filename, { meta: trace });
        let pageDl = null;
        if (id !== null) {
            const outcome = await vrWaitDownload(id, 2500);
            if (!outcome || outcome.state !== 'interrupted') {
                vrMarkDownloaded(filename);
                return finish({ ok: true, kind: 'url', filename: filename });
            }
            // CDN 403 快速失败：撤账、清掉 .htm 残留，改走页面 fetch
            try { vrAbortFilename(pick.url, filename); } catch (e) { /* ignore */ }
            vrDropDownload(id);
        }

        // 路线 2（回退）：页面主世界 fetch → blob → <a download>。
        // 页面请求天然带 Referer/Cookie，微博这类 Referer ACL 站点只有这条能过；
        // 与 B站 durl 的成熟路线一致，CocoCut 也是在页面/内容脚本里 fetch。
        pageDl = await vrTryPageDownload(tabId, pick.url, filename.split('/').pop());
        if (pageDl && pageDl.ok) {
            const saved = filename.split('/').pop();   // <a download> 只认文件名，不支持子目录
            vrMarkDownloaded(saved);
            return finish({ ok: true, kind: 'page-blob', filename: saved, bytes: pageDl.bytes || 0 });
        }
        return { ok: false, reason: 'download-failed', page: pageDl || null };
    }

    // ---- B站：走页面主世界 ----
    // <a download> 不支持子目录（ADR-029 已知限制），只取文件名
    const full = await vrNameInTab(tabId, 'mp4');
    const name = full.split('/').pop() || full;

    const probe = await chrome.scripting.executeScript({
        target: { tabId: tabId }, world: 'MAIN', func: self.VR_BILI.probeFunc
    });
    const info = probe && probe[0] && probe[0].result;
    if (!info || !(info.hasDurl || info.hasDash)) {
        return { ok: false, reason: 'no-bili-info' };
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

    // 下载在页面里跑，后台盯着进度，完成后主动通知按钮
    vrWatchBiliDownload(tabId, name);
    return finish({ ok: true, kind: pick.kind, filename: name, started: true });
}

/** 盯页面里的下载进度，结束/出错时推消息给按钮 */
function vrWatchBiliDownload(tabId, name) {
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

        const timeout = ticks > 300;   // 约 5 分钟
        if (!st || !st.done) {
            if (st && !timeout) {
                try {
                    chrome.tabs.sendMessage(tabId, {
                        Message: 'vrVideoProgress', name: name,
                        pct: Math.round(st.pct || 0), phase: st.phase || ''
                    });
                } catch (e) { /* 页面没按钮了 */ }
                return;
            }
            if (!timeout) { return; }
        }
        clearInterval(timer);
        try {
            chrome.tabs.sendMessage(tabId, {
                Message: 'vrVideoProgress', name: name,
                done: true,
                ok: !!(st && !st.error),
                error: (st && st.error) || (timeout ? '超时' : ''),
                bytes: (st && st.bytes) || 0
            });
        } catch (e) { /* 页面关了就算了 */ }
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

    vrDownloadWithName(info.srcUrl, filename).then(function (id) {
        // 同上：FSA 成功返回对象，只有真 null 才是失败
        if (id === null || id === undefined) {
            console.warn('[video-rod] 秒存失败', chrome.runtime.lastError);
        } else {
            vrMarkDownloaded(filename);
        }
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
        if (action === 'panel' && st.imgPanel === false) { return; }
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