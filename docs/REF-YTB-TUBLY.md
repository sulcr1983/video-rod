# YTB.crx（Tubly 下载器）拆包分析 & 融合评估

> 时间：2026-10-24 ｜ 样本：`YTB.crx`（942 KB，MV3，v1.6.2，min Chrome 110）
> 拆包产物：`.work/_ytb_unpack/`（`.work/` 已 gitignore，随时可删）
> 结论先行：**代码没得抄（核心根本不在 crx 里），但架构有 7 个模式值得抄，其中 2 个能直接解决我们卡住的问题。**

---

## 一、它是什么

| 项 | 值 |
|---|---|
| 产品名 | **Tubly — YouTube MP3/MP4/Shorts 下载器** |
| 官网 | `https://tubly.download`（应用页 `/app/`，认证 `auth.tubly.download`） |
| 商业模式 | Supabase 登录 + 订阅制（免费档只能下低画质，专业版 4K/1080p，2 天试用，超额按次计费，推荐送月） |
| 技术栈 | Vue 3 + Tailwind（编译产物）、Supabase JS（整包塞进 SW）、Rust→WASM（RSA/JWT） |
| 语言 | 13 个 locale |

**权限清单**（读懂它想干什么）：

```
alarms  cookies  declarativeNetRequestWithHostAccess  downloads  downloads.open
identity  scripting  storage  unlimitedStorage  downloads.ui  offscreen
optional_host_permissions: <all_urls>
host_permissions: *.youtube.com  *.googlevideo.com  www.google.com  *.tubly.download  *.ytb.download  *.workers.dev
```

`downloads.ui` + `offscreen` + `declarativeNetRequestWithHostAccess` + `cookies` 这四件套，是「自己做下载引擎」的标配，不是嗅探器。

## 二、文件清单（谁负责什么）

| 文件 | 大小 | 角色 |
|---|---|---|
| `libs/CX7MsfHy.js` | 137 KB | **Service Worker**。消息路由器（`ytw/ytac/ytak/ytal/ytam/ytaq/ytan/ytap`）+ Supabase 客户端全量 + offscreen 生命周期 + 下载事件聚合 |
| `libs/tPNT3UO6.js` | 163 KB | **YouTube 内容脚本**。Vue 应用，往播放器下面注入下载按钮 |
| `libs/Dbdte0vF.js` | 156 KB | **popup**。账户/订阅/设置/更新检查/错误码映射 |
| `libs/DlRjR0a.js` | 448 KB | **同源 fetch 桥 + 324 KB Rust WASM**。无任何 HTML 引用，靠 `executeScript` 动态注入 |
| `libs/DMqzgWeh.js` | 7.8 KB | `fetch.html` 的代理内核（在目标站点 iframe 里跑 `fetch`） |
| `libs/DZ8_1rR1.js` | 11.6 KB | `persist.html`（offscreen）——任务保活 + 自动关窗 + 埋点 |
| `libs/BJCUmAid.js` | 4 KB | 注入到 `tubly.download/app/saveas.html` 的桥，把网页的 `postMessage` 转成 `chrome.runtime.sendMessage` |

## 三、最重要的发现：crx 里没有 YouTube 解析器

全文 grep，以下关键词 **命中 0 次**：

```
googlevideo   streamingData   ytInitialPlayerResponse   poToken
adaptiveFormats   signatureCipher   n-param / decipher   youtubei/v1/player
```

唯一一次 `sabr` 命中，落在 WASM 的 base64 数据块里，是误伤。

那 324 KB 的 WASM 是什么？字符串表给了答案：

```
jwt-simple-0.11.9   rsa-0.7.2   ring_core_0_17_14   num-bigint-dig
PS256   PKCS#8   JWTClaims: iat exp nbf iss sub aud jti nonce
shared/wasm/src/validate/mod.rs     src/main_page.rs
```

**是授权/许可证 JWT 的 RSA-PSS 校验器**，对应错误码 `1019 errorWasmFeatureUnsupported`，不是解析器。

真正的解析发生在哪？看内容脚本点下载那一步：

```js
const e  = await chrome.runtime.sendMessage({ rfa: "ytaj" });          // 拿 tabId
const h  = Oc("saveas.html", { videoId, tid: String(e), lang });        // → https://tubly.download/app/saveas.html?...
const m  = await chrome.runtime.sendMessage({ rfa: "ytaq", rfb: [h, 600, 260, cx, cy] }); // 开 600×260 小窗
```

**它开了一个自家域名的小窗去下载。** 引擎是 `tubly.download/app/` 服务端交付的 JS，扩展只负责把浏览器特权借给它：cookie、DNR 改头、`executeScript` 注入、`chrome.downloads`、FSA 目录句柄。

### 完整数据流

```
[YouTube 页面]
  tPNT3UO6.js  inject #video-downloader-container → Vue UI（按钮/画质下拉/进度）
        │ 用户点击
        ▼
  chrome.windows.create(popup 600×260, url=https://tubly.download/app/saveas.html?videoId&tid)
        │
        ▼
[自家网页 saveas.html]  ← 服务端下发的引擎 JS（闭源，crx 里没有）
        │ postMessage { rfg:"__tydpb", rfa:"ytm" }
        ▼
  BJCUmAid.js ──► chrome.runtime.sendMessage { rfa:"ytan" }
        │
        ▼
[Service Worker]  ── 特权 RPC 服务端
   ytak → declarativeNetRequest.updateDynamicRules（改 UA / 删 cookie）
   ytal → scripting.executeScript({world:"MAIN", allFrames:true, tabId})
   ytam → cookies.get（含 CHIPS partitionKey）
   ytaq → windows.create；  ytan → tabs.sendMessage
        │
        ▼
[隐藏 iframe @ 目标站点]  ← MAIN world 里跑引擎注入的函数，同源 fetch，cookie 自动带
        │ 分块回传（含背压）
        ▼
  写入：FSA 目录（showDirectoryPicker，用户自选文件夹）或 offscreen → chrome.downloads
```

## 四、值得抄的 7 个模式

### ① 隐藏 iframe + MAIN world 执行 + 同源 fetch（最值钱）

`ca()` 干了三件事：

```js
// 1. 建一个隐藏 iframe，指向目标站点（这里是 youtube.com 的某个页面）
const e = document.createElement("iframe");
e.style.display = "none";
document.body.append(e);
if (d) await Q({ removeRuleIds:[3], addRules:[{ id:3, priority:1,
  action:{ type:"modifyHeaders", requestHeaders:[{ header:"cookie", operation:"remove" }] },
  condition:{ resourceTypes:["sub_frame"], urlFilter:d } }] });   // ← 让 iframe 变成「游客」
e.src = d;

// 2. 等 load，然后往所有 frame 的 MAIN world 注入一个 RPC 函数
await chrome.scripting.executeScript({ target:{ allFrames:true, tabId }, world:"MAIN", func:B, args:[...] });

// 3. 之后所有 fetch 都在那个 iframe 的 origin 里执行 → 无 CORS、cookie 自动带、页面变量可读
```

**为什么这是杀手级**：`fetch` 在 `https://www.youtube.com` 的 frame 里跑，就是同源请求。`visitorData`、`ytcfg`、WBI key、XSRF token 全都能直接读，不需要算签名、不需要绕 CORS、不需要手动拼 cookie。

顺带还演示了反向用法：**用 DNR 删 `cookie` 请求头，把 iframe 变成匿名会话**（对应它的「默认匿名下载，私密/会员内容才提示发 cookie」产品逻辑）。

**给我们的用法**（对应 `docs/DECISIONS.md` ADR-019 的死结）：
在 youtube.com 的隐藏 iframe 里同源调 `youtubei/v1/player`，用**页面自己的** `visitorData` + `X-Goog-Visitor-Id`。poToken/SABR 之所以封死纯扩展，是因为我们在扩展进程里请求，身份是「一个陌生的第三方」；把请求放回 YouTube 自己的页面里发，身份就是「YouTube 自己在播视频」。**这条值得花 30 分钟做一次验证**（见第六节）。

> 前提：目标站不能有 `X-Frame-Options: SAMEORIGIN`/`DENY`。YouTube 的 watch 页可以。B站不行——但 DNR 也能 `responseHeaders` 里把 `x-frame-options` / `content-security-policy` 的 `frame-ancestors` 摘掉，这条同样适用于 B站和任何站点。

### ② postMessage 双向 RPC + 结构化帧

协议就三个魔数：`__tydfp`（请求）/ `__tydfer`（响应）/ `__tydpb`（桥转发）。

请求帧（数组下标压缩，省体积）：

```
[1] id            [2] mode: 1=json 3=stream 4=readableStream
[3] url           [4] frameUrl（要 iframe 到哪个站点）
[5] fetch init    [6] 状态码     [7] 预算错误     [8] header 注入表（值从 cookie 取）
[9] body 补丁     [10] 响应写回 window 的路径映射   [11] 响应补丁   [12] UA 覆写
```

响应帧：`[1] id  [2] headers  [3] finalUrl  [4] json  [5] stream  [6] status  [7] error  [8] 帧类型`
帧类型：`1`=headers 首发、`2`=chunk、`3`=end、`4`=error。

**给我们的用法**：我们有 StreamSaver 落盘，但 SW 侧 fetch 和页面侧写盘之间的流式传输是手写的。这套「id + 帧类型 + 结束/错误帧」的枚举，直接用来替换我们的临时实现，能省掉一类竞态 bug。

### ③ 背压：额度计数 + wake 唤醒

```js
function J(k, n){ k.g || n <= 0 || (k.h += n, k.wake?.()) }        // 还额度
async function K(k){ while(!k.g && k.h <= 0) await new Promise(r => { k.wake = r }), k.wake = void 0; return !k.g }
// 每推一块 h--，消费方处理完发 control 帧 h += bytes
```

15 行解决「生产者比消费者快，内存爆掉」。我们下 4K 大文件时正需要。

### ④ DNR 规则用完即删，id + urlFilter 定向

```js
// 加
chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds:[3], addRules:[{ id:3, ... }] });
// 删
chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds:[3] });
```

非扩展上下文（iframe/网页里）调不到 DNR，它做了 fallback：`sendMessage({ rfa:"ytak" })` 让 SW 代劳。**我们的 ADR-035 已经踩到 DNR 只能走 SW 这个点**，可以把这个 fallback 封装抽出来复用。

> 改进建议：它用固定 rule id `3`，多个下载并发时会互相覆盖；我们应该用 `condition.tabIds` 或自增 id 池。

### ⑤ offscreen 存在性判断用 `runtime.getContexts`

```js
const [ctx] = await chrome.runtime.getContexts({ documentUrls: [chrome.runtime.getURL("/persist.html")] });
if (!ctx) await chrome.offscreen.createDocument({ url, reasons:["BLOBS"], justification:"..." });
```

比 `chrome.offscreen.hasDocument()`（无参、跨文档场景不精确）靠谱。

### ⑥ 页面内按钮注入的锚点策略

```js
const anchors = [["#below", "afterbegin"], ["ytd-watch-metadata", "beforebegin"]];  // 多候选，降级
if (document.getElementById("video-downloader-container")) return;                   // 幂等
div.id = "video-downloader-container"; div.className = "tailwind"; div.style.margin = "8px 0";
anchor.insertAdjacentElement(pos, div);
```

Shorts 单独处理：挂到 `.short-video-container, .ytd-reel-video-renderer`，父元素强制 `position:relative; overflow:visible` 再绝对定位角标。

**给我们的用法**：`js/x-button.js` 是同一类需求（推特操作栏插按钮）。它的「多候选锚点 + 幂等 + 父元素定位修正」三件套，正好补我们 SPA 重挂时的稳定性。

### ⑦ 错误码表集中化 + 帮助页锚点

```js
const CODES = {
  22:   refreshPage,          3003: maxConcurrent,      3004: needToLogin,
  10:   updateRequired,       8:    updateRequired,     36:   notAllowedContent,
  6:    extensionCorrupted,   3:    errorNetwork,       1018: livestream,
  1019: wasmUnsupported,      1009: noQuota,            3021: fileSystemError,
};
```

UI 只显示码，文档锚点 `help.html#error-codes`。它的错误码值本身不值钱，**这个「一张表 + 文档锚点」的组织方式**值钱——我们现在的错误提示散在 popup/content 各处。

### ⑧ 附赠：`downloads.ui` 隐藏下载气泡

```js
await chrome.downloads.setUiOptions({ enabled: false });        // 下之前
setTimeout(() => chrome.downloads.setUiOptions({ enabled: true }), 5000);  // 下之后恢复
```

我们已经有自绘进度条，把浏览器原生气泡关掉界面会干净很多。

### ⑨ 附赠：FSA 小窗保活 + 自动收尾

`showDirectoryPicker` 拿到的目录句柄绑在窗口生命周期上。它的做法：独立小窗 + `setInterval(60s)` 保活 + 任务队列空 → 2.5s 后 `window.onbeforeunload = null; window.close()`。我们做 S0–S2 迁移时踩过句柄失效的坑，这套收尾逻辑可以参考。

## 五、抄不动的部分（别浪费时间）

| 项 | 原因 |
|---|---|
| YouTube 解析引擎 | 在 `tubly.download/app/` 服务端下发，crx 里一行都没有 |
| WASM | Rust 写的授权校验器，与下载无关 |
| 订阅/计费/推荐/试用 | Supabase + Stripe + 微信支付宝，自用无意义 |
| 13 国语言包 | 自用不需要 |
| 强制更新门（`version.json` + critical update） | 自用不需要 |

**法务口径**：这是闭源商业产品。反编译做研究没问题（我们干的就是这个），把它的代码搬进自己仓库不行。但结论更简单——**没有可搬的东西**。所以 ADR-028「能抄就抄」在这里自然退化为「只抄模式」，和 ADR-028 第 3 条例外一致。

## 六、建议的融合动作（按性价比排序）

| # | 动作 | 落点 | 成本 | 价值 |
|---|---|---|---|---|
| 1 | **同源 iframe 探针实验**：在 youtube.com 隐藏 iframe 里 MAIN world 调 `youtubei/v1/player`，看能否拿到未降级 formats | `tools/cdp-probe.py` 加一个用例 | 半天 | 🔥 决定 ADR-019 要不要翻案 |
| 2 | 抽 `js/same-origin-bridge.js`：隐藏 iframe + `executeScript(MAIN)` + RPC 帧协议 + 背压 | 新模块 | 1 天 | 🔥 一次写好，B站/YouTube/X 都能用 |
| 3 | 抽 `js/dnr-rules.js`：规则池 + tabId 定向 + SW fallback + 用完即删 | 新模块（ADR-035 收编） | 半天 | 高 |
| 4 | `downloads.ui` 关气泡 + offscreen 用 `getContexts` 判断 | `js/background.js` | 1 小时 | 中 |
| 5 | 页面按钮注入锚点策略补到 `js/x-button.js` | 改造现有 | 2 小时 | 中 |
| 6 | 错误码表集中化 | `js/` 新常量 + docs 锚点 | 2 小时 | 中 |
| 7 | YouTube 播放器下方下载按钮（学它的 `#below` 注入 + 画质下拉 + 悬浮菜单） | 新 content script | 1–2 天 | 看 #1 结果再定 |

**#1 是唯一真正的技术赌注。** 如果它成立，我们的 YouTube 支持从「能抓多少抓多少」升级为「按需选画质」；如果不成立，就老老实实维持 ADR-019，把力气全投 B站 + 通用嗅探增强。

## 七、一句话结论

> 它不是一个「更聪明的嗅探器」，而是一个**特权代理 + 云端引擎**：扩展把自己变成 cookie/DNR/注入/落盘的服务端，业务逻辑全在自家网页里跑。
> 我们抄不到引擎，但抄得到那个**代理层**——而这一层恰好是我们 ADR-019 里最缺的一块。
