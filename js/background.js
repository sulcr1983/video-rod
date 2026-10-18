/**
 * chrome 使用v3 background.service_worker 加载模式
 * firefox 使用v2 background.scripts 加载模式
 * firefox 在 manifest 文件中已经加载以下脚本，如果已经加载 G 变量存在，不再加载。
 */
if (typeof G === 'undefined') {
    importScripts("/js/polyfill.js", "/js/function.js", "/js/templates.js", "/js/init.js",
        "/js/bili-whole.js", "/js/douyin.js");
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

// ===== 钓鱼竿：下载文件名保护（M8 修复「星愿忽略 filename」）=====
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

function vrQueueFilename(url, filename, conflictAction) {
    if (!url || !filename) { return; }
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
    vrQueueFilename(url, filename, extra && extra.conflictAction);
    const opts = Object.assign(
        { url: url, filename: filename, saveAs: false, conflictAction: "uniquify" },
        extra || {}
    );
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
chrome.runtime.onMessage.addListener(function (Message, sender, sendResponse) {
    if (chrome.runtime.lastError) { return; }
    // 钓鱼竿：下载文件名记账（popup/options 等页面经 vr-download-hook.js 转发）。
    // 必须放在 init 检查之前——SW 刚被消息唤醒时 init 标志可能还没就绪，
    // 而记账只碰内存 Map，不依赖任何初始化状态；漏记账 = 文件名被浏览器忽略。
    if (Message && Message.Message == "vrQueueName") {
        vrQueueFilename(Message.url, Message.filename, Message.conflictAction);
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
    // 钓鱼竿：X(推特) 推文内联按钮下载（M8），js/x-button.js 发起
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
                vrDownloadWithName(url, fname).then(function (id) {
                    if (id === null) {
                        console.warn("[video-rod] X按钮下载失败", chrome.runtime.lastError);
                    } else {
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
    chrome.sidePanel.setOptions({
        tabId,
        path: "popup.html?tabId=" + tabId
    });
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

// 钓鱼竿：X(推特) 推文内联按钮下载（M8）
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
 * 钓鱼竿：右键秒存（M5）
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

        (note.imageList || []).forEach(function (im, i) {
            let url = im.url || '';
            if (!url && im.infoList) {
                const dft = im.infoList.find(function (x) { return x.imageScene === 'WB_DFT'; });
                const any = im.infoList.find(function (x) { return x.url; });
                url = (dft && dft.url) || (any && any.url) || '';
            }
            url = url || im.urlDefault || im.urlPre || '';
            if (url) {
                items.push({ kind: 'image', url: url, ext: 'webp', index: i });
            }
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
                // 小红书页面 fetch 被 CORS 拒绝，只能 downloads；统一进媒体库目录
                const id = await vrDownloadWithName(it.url, vrMediaPath(it, name));
                if (id !== null) {
                    const outcome = await vrWaitDownload(id, 20000);
                    if (outcome && outcome.state === 'interrupted') {
                        try { vrDropDownload(id); } catch (e) { /* ignore */ }
                    } else {
                        ok = true;
                    }
                }
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
        return m && m.url && VR_VIDEO_EXT.test(m.ext || '');
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

    // ---- 抖音：详情接口已经给了作者/抖音号/描述，命名直接用 override ----
    if (opt.site === 'douyin') {
        // 抖音 CDN 要 Referer；用 DNR 会话规则补上（抄 CocoCut，ADR-031）
        const tab = await chrome.tabs.get(tabId);
        await vrSetMediaHeaders('douyinvod.com', (tab && tab.url) || 'https://www.douyin.com/');
        const filename = await vrNameInTab(tabId, 'mp4', opt.meta);
        const id = await vrDownloadWithName(pick.url, filename);
        if (id === null) { return { ok: false, reason: 'download-failed' }; }
        vrMarkDownloaded(filename);
        return { ok: true, kind: 'url', filename: filename };
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

        // 路线 1（默认）：downloads API + DNR 回放页面 Referer。
        // 保留子目录和文件名保护；普通站点/抖音都走这条。
        if (pageUrl) { await vrSetMediaHeadersFor(pick.url, pageUrl); }
        const id = await vrDownloadWithName(pick.url, filename);
        let pageDl = null;
        if (id !== null) {
            const outcome = await vrWaitDownload(id, 2500);
            if (!outcome || outcome.state !== 'interrupted') {
                vrMarkDownloaded(filename);
                return { ok: true, kind: 'url', filename: filename };
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
            return { ok: true, kind: 'page-blob', filename: saved, bytes: pageDl.bytes || 0 };
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
    return { ok: true, kind: pick.kind, filename: name, started: true };
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

    const dir = String(settings.defaultDir || 'video-rod').replace(/[<>:"|?*\\]/g, '').replace(/^\/+|\/+$/g, '') || 'video-rod';
    const tpl = settings.template || '${author}_${title}';

    let name = '';
    try {
        await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['js/naming.js'] });
        const r = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: function (tpl, ext) {
                const N = self.VideoRodNaming;
                if (!N) { return ''; }
                try {
                    const i = N.extractPageInfo(document, location.href);
                    return N.buildNameFromInfo(i, location.href, { tpl: tpl, ext: ext });
                } catch (e) { return ''; }
            },
            args: [tpl, ext]
        });
        name = (r && r[0] && r[0].result) || '';
    } catch (e) { /* 受限页面，退回时间戳名 */ }

    if (!name) { name = 'media_' + Date.now() + '.' + ext; }
    const filename = (dir + '/' + name).replace(/\\/g, '/').replace(/\/{2,}/g, '/');

    vrDownloadWithName(info.srcUrl, filename).then(function (id) {
        if (id === null) {
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
chrome.commands.onCommand.addListener(function (command) {
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