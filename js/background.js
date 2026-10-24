/**
 * chrome 使用v3 background.service_worker 加载模式
 * firefox 使用v2 background.scripts 加载模式
 * firefox 在 manifest 文件中已经加载以下脚本，如果已经加载 G 变量存在，不再加载。
 */
if (typeof G === 'undefined') {
    importScripts("/js/polyfill.js", "/js/function.js", "/js/templates.js", "/js/init.js",
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
                    vrDownloadWithName(info.url, fileName);
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
                resolve(Object.assign(Object.create(null), (o && o.vrImgDownloaded) || {}));
            });
        } catch (e) { resolve(Object.create(null)); }
    });
}

function vrImgRememberUrl(key) {
    if (!key) { return; }
    try {
        chrome.storage.local.get('vrImgDownloaded', function (o) {
            const map = (o && o.vrImgDownloaded) || {};
            map[key] = Date.now();
            const keys = Object.keys(map);
            if (keys.length > VR_IMG_SEEN_MAX) {
                keys.sort(function (a, b) { return map[a] - map[b]; });
                const drop = keys.length - VR_IMG_SEEN_MAX;
                for (let i = 0; i < drop; i++) { delete map[keys[i]]; }
            }
            chrome.storage.local.set({ vrImgDownloaded: map });
        });
    } catch (e) { /* ignore */ }
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
 * 注入到 YouTube 页面主世界执行：用 MWEB 客户端取格式列表。
 *
 * 这段函数会被 chrome.scripting.executeScript 序列化后送到页面里跑，
 * 所以不能引用任何外层变量（只能用它自己的参数和页面全局）。
 *
 * 为什么是 MWEB：实测九种客户端，只有 MWEB 还在返回带 url 的 adaptiveFormats
 * （41/41，最高 2160p60，且不需要 poToken）；WEB 已全面 SABR 化，返回 0 条直链。
 * 详见 docs/YT-FEASIBILITY.md。
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
            var client = ctx.client || {};
            var visitor = client.visitorData || '';
            var VER = client.clientVersion || '2.20261023.01.00';
            var body = {
                context: {
                    client: {
                        clientName: 'MWEB',
                        clientVersion: VER,
                        hl: cfg.get('HL') || 'en',
                        gl: cfg.get('GL') || 'US',
                        visitorData: visitor
                    },
                    user: { lockedSafetyMode: false },
                    request: { useSsl: true }
                },
                videoId: videoId,
                contentCheckOk: true,
                racyCheckOk: true
            };
            var headers = {
                'Content-Type': 'application/json',
                'X-Youtube-Client-Name': '2',
                'X-Youtube-Client-Version': VER
            };
            if (visitor) { headers['X-Goog-Visitor-Id'] = visitor; }

            var resp = await fetch('/youtubei/v1/player?key=' +
                encodeURIComponent(key) + '&prettyPrint=false', {
                method: 'POST',
                credentials: 'include',
                headers: headers,
                body: JSON.stringify(body)
            });
            var json = await resp.json();
            var ps = json.playabilityStatus || {};
            if (ps.status !== 'OK') {
                return { ok: false, error: (ps.status || '未知状态') + '：' + (ps.reason || '') };
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
    // YouTube：页面按钮点击 → 开下载窗口（单开小窗的理由见 js/yt/yt-download.js 抬头注释）
    if (Message && Message.Message === 'ytOpen') {
        var ytUrl = chrome.runtime.getURL('js/yt/yt-download.html') +
            '?videoId=' + encodeURIComponent(Message.videoId || '') +
            '&tabId=' + encodeURIComponent(String((sender.tab && sender.tab.id) || 0)) +
            '&title=' + encodeURIComponent(Message.title || '') +
            '&author=' + encodeURIComponent(Message.author || '');
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

// 苏哥的钓鱼竿：X(推特) 推文内联按钮下载（M8）
// content script 从 video.poster 提取媒体 ID，这里在嗅探缓存里匹配 URL 并下载。
// 页面只传 mediaId 和文件名，URL 一律从缓存取——页面无法借道下载任意地址。
// 优先完整渐进式 MP4（X 播放器必请求）；无则最高清视频轨 m3u8 → 打开猫抓 m3u8.html 兜底。
// X 的视频：页面播放走分轨 HLS（fMP4 分片），但平台另提供**已合并好音视频的完整 MP4**直链。
// 直链 URL 无法拼（每个分辨率独立文件名+tag），只能查——用 fxtwitter 开源 API 取（免鉴权，
// 不碰登录态，只发公开推文 ID；比下载分片再合成、比送在线 FFmpeg 都省事，业界通行做法）。
async function fetchXVideo(user, statusId, mediaId, wantBest) {
    if (!user || !statusId) { return null; }
    const r = await fetch("https://api.fxtwitter.com/" + user + "/status/" + statusId);
    if (!r.ok) { return null; }
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
        if (id === null) {
            console.warn('[video-rod] 秒存失败', chrome.runtime.lastError);
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