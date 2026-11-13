# Plucker XBD 5.9 拆解 —— X(推特)媒体一键下载器

> 日期：2026-11-13 ｜ 状态：预研完成（Stage 1） ｜ 用途：为「推特下载模块」提供逐条「抄 / 不抄」依据
> 方法：读星愿浏览器 `Default/Extensions/piibekljdlkbkdchicfdjpnaggolndif/5.9_0/` 下的**未混淆常量与调用链**（`manifest.json` 明文；`background.js` 明文；`injected.js` / `content-scripts/main.js` 为 Vite 压缩单行，按符号与字符串常量抽取）
> 配套：`docs/COMPETITOR-EXTENSIONS.md` §3 总账 ｜ `docs/DECISIONS.md` ADR-033 / 新增 ADR ｜ 复用矩阵见 §五

---

## 一、为什么单独拆它

苏哥的要求：**进入某个博主主页，把这个人的全部内容（图片 + 视频）一次下下来**，体验照 Plucker 的右侧「全下载」模式；微博同样，小红书/抖音后做。

Plucker XBD 是星愿 13 个扩展里**唯一把「博主全量抓取」做成产品**的（其余要么单条、要么只扫当前页）。它也是本项目 ADR-033 的原始参照物。本文件把它的机制逐条记下来，作为施工依据。

---

## 二、扩展基本盘（实读）

| 项 | 值 |
|---|---|
| 版本 / ID | `5.9` / `piibekljdlkbkdchicfdjpnaggolndif` |
| manifest | MV3，`background.service_worker: background.js` |
| 权限 | `storage`、`unlimitedStorage`、`downloads`（**仅 3 个**） |
| host_permissions | `*://*.twitter.com/*`、`*://*.x.com/*` |
| content_scripts | `content-scripts/main.js`(620KB) + `twitter.js`(3.5KB)，`matches` 仅 twitter/x，`run_at: document_start` |
| web_accessible | `injected.js`(96KB)、`content-scripts/main.css` |
| 外部连接 | `externally_connectable`: `https://xbd.plucker.io/*` + twitter/x |
| 远端 | `https://xbd.plucker.io`（Web App）、`https://apixbd.plucker.io`（/api） |

**关键结论**：**没有 `tabs`/`scripting`/`webRequest`** —— 它不嗅探网络、不遍历标签，一切靠「读页面自己拿到的数据」+「页面主世界注入」。文件结构：

```
injected.js               ← MAIN world：hook fetch/XHR、解析时间线、抓 queryId/请求头
content-scripts/twitter.js ← 只负责把 injected.js 注入页面
content-scripts/main.js   ← Vue3+Pinia 右侧面板（620KB）
background.js             ← 下载队列 / 命名 / 目录 / 任务库 / Web App 桥
chunks/options-*.js       ← 选项页
```

---

## 三、逐层机制

### 3.1 页面主世界注入（`twitter.js` → `injected.js`）

`twitter.js` 只做一件事：`document.createElement('script'); s.src = chrome.runtime.getURL('/injected.js')`，在 `document_start` 插到页面，绕开 content script 的隔离世界。

### 3.2 `injected.js`：GraphQL 拦截 + 结构化解析

**拦截点（实读正则/字符串）**

```js
URL_MATCHERS: [
  e => /(api\.)?(twitter|x)\.com\/(i\/api\/)?(2|graphql|1\.1)\//i.test(e),
  e => e.includes('account/settings.json')
]
// XHR.open 里进一步匹配：
/\/graphql\/([^/]+)\/(UserVideoTimeline|UserPhotoTimeline)\b/   → media timeline（取 queryId + 类型 video/photo）
/\/graphql\/[^/]+\/UserTweets\b/                               → 推文时间线
```

- 同时 hook `XMLHttpRequest.prototype.open/setRequestHeader`，**抓 `Authorization` 与 `X-Client-Transaction-Id` 等请求头**（`pickXApiHeaders`/`pickHeaders`）。
- 也 hook `window.fetch`，命中即旁读响应 JSON（`extractFromResponse`）。

**消息协议常量表（`W`，逐字实读）**

| 常量名 | 值 | 方向 |
|---|---|---|
| `USER_PROFILE` | `XBD__INJECTED__USER_PROFILE` | 页面 → 扩展 |
| `MEDIA_TRANSMIT` | `XBD__INJECTED__MEDIA_TRANSMIT` | 页面 → 扩展 |
| `X_REQUEST_HEADERS` | `XBD__INJECTED__X_REQUEST_HEADERS` | 页面 → 扩展 |
| `X_API_REQUEST_HEADERS` | `XBD__INJECTED__X_API_REQUEST_HEADERS` | 页面 → 扩展 |
| `URL_CHANGED` | `XBD__INJECTED__URL_CHANGED` | 页面 → 扩展 |
| `STANDALONE_DOWNLOAD` | `XBD__INJECTED__STANDALONE_DOWNLOAD` | 页面 → 扩展 |
| `USER_MEDIA_QUERY_ID` | `XBD__INJECTED__USER_MEDIA_QUERY_ID` | 页面 → 扩展 |
| `MEDIA_TIMELINE_REQUEST` | `XBD__INJECTED__MEDIA_TIMELINE_REQUEST` | 页面 → 扩展 |
| `MEDIA_TIMELINE_RESPONSE` | `XBD__INJECTED__MEDIA_TIMELINE_RESPONSE` | 页面 → 扩展 |
| `USER_TWEETS_TIMELINE_REQUEST` | `XBD__INJECTED__USER_TWEETS_TIMELINE_REQUEST` | 页面 → 扩展 |
| `USER_TWEETS_TIMELINE_RESPONSE` | `XBD__INJECTED__USER_TWEETS_TIMELINE_RESPONSE` | 页面 → 扩展 |
| `REQUEST_MEDIA_CONTEXT` | `XBD__PAGE__REQUEST_MEDIA_CONTEXT` | 扩展 → 页面 |
| `STANDALONE_DOWNLOAD_STATUS` | `XBD__PAGE__STANDALONE_DOWNLOAD_STATUS` | 扩展 → 页面 |
| `DOWNLOAD_FILE` | `XBD__BG__DOWNLOAD_FILE` | 面板 → 后台 |
| `UPDATE_TWEET_DOWNLOAD_STATUS` | `XBD__BG__UPDATE_DOWNLOAD_STATUS` | 面板 → 后台 |
| `RELOAD_DOWNLOAD_TASK_FROM_STORAGE` | `XBD__DEPRECATED__RELOAD_TASKS` | 废弃 |
| `DOWNLOAD_SINGLE_TWEET_MEDIA_FILES` | `XBD__DEPRECATED__SINGLE_DOWNLOAD` | 废弃 |
| `CHECK_OPTIONS_PAGE_IS_OPEN` | `XBD__DEPRECATED__CHECK_OPTIONS` | 废弃 |
| `START_DOWNLOAD_TASK` | `XBD__DEPRECATED__START_TASK` | 废弃 |

**时间线解析（核心函数 `$`，实读逻辑）**

```
payload → 递归找所有 "instructions" 数组（findNestedProperty）
  → 过滤出 TimelineAddEntries / TimelinePinEntry
  → 收集 entries：
       TimelineTimelineItem + TimelineTweet  → 普通推文
       TimelineAddToModule / TimelineTimelineModule → 会话/模块内推文
       TimelineTimelineCursor(cursorType=Bottom) → nextCursorId
  → 逐条规范化：
       __typename === 'TweetWithVisibilityResults' ? tweet : 原对象   （解包）
       rest_id                                       → entityId
       legacy.user_id_str / core.user_results.result.rest_id → user_id_str
       legacy.full_text 去 https://t.co 尾部、压换行        → text
       legacy.created_at                                 → created_at(+_str)
       legacy.is_quote_status / quoted_status_result     → is_quote
       retweeted_status_result.result                    → is_rt / rt_* 字段
       feedSortKey（sortIndex）用于排序（置顶优先 + BigInt 比较）
  → 媒体提取（按优先级回退）：
       ① 转推 → retweeted_status_result.result.legacy.extended_entities.media
       ② 本体 → legacy.extended_entities.media
       ③ 引用 → quoted_status_result.result.legacy.extended_entities.media
       ④ 卡片 → card.legacy.binding_values[].value.string_value JSON 里的 media_entities
  → 每条 media 规范化 → medias[]：
       { id: id_str, entityId, media_type: video|image,
         matchPhoto: media_url_https 去扩展名,
         photoDownloadUrl: media_url_https,
         video: video_info.variants.filter(v => v.content_type==='video/mp4')
                  .sort((a,b)=>b.bitrate-a.bitrate)[0].url }
```

> **要点**：Plucker 从**同一份时间线响应**里就拿到了图片直链与视频 mp4 直链 —— 视频走 `video_info.variants` 选最高码率 mp4，**不需要额外请求**。这正是「拦截响应」路线最省事的地方（本项目预研需实测确认这点，见 §六）。

**用户资料提取**：`data.user.result`（`__typename==='User'`）→ `core/legacy` 的 `screen_name/name/rest_id/avatar`；仅当 `screen_name === 当前 URL 第一段`才上报（`parseUserProfileInfo`）。

**独立下载按钮**：给每条推文媒体生成 `button.extension-button`（含 loading/success/error 三态图标），点击 → `buildStandaloneMediaDtos` 造 DTO → 走 `STANDALONE_DOWNLOAD`。

### 3.3 时间线翻页（Plucker 的主路线 = **主动 GraphQL**）

`twitter.js` 的 `dataSender` 会把 `queryId`（`UserPhotoTimeline` / `UserVideoTimeline`）、`variables`/`features`/`fieldToggles` 和请求头都交给面板；面板据 `userId + cursor + count` **由扩展主动发 GraphQL 请求**翻页（`sendMediaTimelineRequest` / `sendUserTweetsTimelineRequest`），并把响应条数、`nextCursorId` 回传。

**UI 里的抓取方式（`tweetFetchMode`）**：两个选项 ——
- `Quick fetch (Recommended)`：主动 GraphQL 分页（最快最全）
- `Scroll to load (Backup)`：**不是自动滚动**，是「用户手动往下滚，扩展旁读 X 自己发出的请求」——即备选兜底

> **纠正一处常见误解**：Plucker **没有**实现自动滚动；它的 `pageScroll` 只是「手动滚 + 拦截」。所以本项目选的「自动滚动 + 拦截」是在 Plucker 之上的增量（更省事、更小风控面）。

进度与续抓：`saveFetchProgress(userId, ...)` / `clearFetchProgress()` / `Continue From Last Position`；遇到 X 限流（`XRateLimitError` / `X rate limit reached`）会提示等待或改用滚动加载。

### 3.4 右侧面板（`content-scripts/main.js`）

技术栈 Vue3 + Pinia + vue-i18n，13 语言。**右侧常驻侧栏**（`xbd-x-bulk-downloader`），实读词条：

- 抓取：`Fetching all media data`、`Fetching all tweets`、`Stop fetching`、`Continue From Last Position`、`Load more`、`Scroll to load (Backup)`、`Quick fetch (Recommended)`
- 过滤：`All media` / `All photos` / `All videos` / `All tweets` / `Images only` / `Videos only` / `Audio only`、`Ignore saved`(忽略已下载) / `Ignore retweet`(忽略转载)
- 范围：`current` / `recentTweetNum`(最近 N 条) / `all`
- 状态：`Pending` / `Downloading` / `Completed {done}/{total} ({pct}%)` / `Failed ({count})`
- 操作：`Save all matching media`、`Download this file`(`Download único`)、`Cancel`、`Delete`、`Export saved records`
- 媒体预览：`Media preview` / `Play video`（滚轮缩放 · 拖拽平移 · 双击复位）
- 设置入口：`Open Web App`、`Configure file naming rules and save directory on the Web App.`（**命名/目录在 Web App 配，不在扩展内**）

### 3.5 命名 / 目录（`background.js`，实读默认值）

```js
Ye = {
  baseSaveDirectory: "/xbd-downloader",
  mediaSaveType: "merge",                          // 图片/视频同目录 or 分离
  directoryName: "example_{{UserName}}",
  fileName: "example_{{Text Summary}}_{{Published Time}}",
  singleFileSaveType: "merge",
  singleFileSaveToRoot: false
}
```

模板变量（实读出现）：`{{UserName}}`、`{{Text Summary}}`、`{{Published Time}}`、`{{DownloadDate}}`、`{{DownloadTime}}`。
存储键：`sk_save_rules_settings_key`（命名规则本地缓存）、`xbd_synced_user_settings`（Web App 同步）。

### 3.6 下载队列（`background.js`）

- `chrome.downloads.download({ url, filename, saveAs:false, conflictAction:"uniquify" })`
- **URL 预记账防串名**：`pendingFilenameByUrl`（与 ADR-027 同款，本项目的文件名保护正是抄它）
- `onDeterminingFilename` 的 **`byExtensionId` 防火墙**：是别的扩展的下载 → 不碰（多下载扩展共存）
- `Invalid filename` **三级降级重试**：`filename` → `buildFallbackFilePath(item, t, i)` → `buildFallbackFilePath(item, t)`
- 任务引擎：`startBatch` / `runDownloadLoop` / `pause/resume/cancel`，状态机 `running/paused`，落 `downloadingItems` + `onDownloadFinished` 回写状态，历史写 buffer
- 本地任务库：`XBD__LOCAL_TASK__*`（CREATE/LIST/GET/CLAIM_DOWNLOADING/BATCH_UPDATE_RESULTS/...）+ 每日下载计数 `daily_download_count_storage_key`
- Web App 侧另有：`XBD__WEBAPP__SEND_DOWNLOAD_BATCH` / `CANCEL` / `PAUSE` / `RESUME` / `SYNC_AUTH_TOKEN` / `SUBMIT_TASK_DATA`（云端任务库，本扩展只做本地）

---

## 四、逐条「抄 / 不抄」

| # | Plucker 做法 | 决定 | 理由 / 落点 |
|---|---|---|---|
| 1 | MAIN world hook fetch/XHR 读时间线响应 | **抄** | 与 `js/net-sniff.js` 同路线（本项目有先例），新写 `js/lib/twitter-timeline.js` 做结构化解析 |
| 2 | 从同一响应直接取 `video_info.variants` 最高 mp4 | **抄** | 省一次请求；若实测响应不带再退回 `fetchXVideo`(fxtwitter) |
| 3 | `TweetWithVisibilityResults` 解包 / 转推·引用·卡片四级媒体回退 | **抄** | 覆盖漏抓场景，写进解析纯函数 |
| 4 | 抓 `Authorization`/`queryId` 后**主动发 GraphQL 分页** | **不抄** | 复用登录态主动发私有请求，风控/封号面大，queryId 随 X 更新易失效。改用「自动滚动 + 拦截」（苏哥 2026-11-13 拍板） |
| 5 | `pageScroll` = 手动滚 + 拦截 | **部分抄** | 把它升级为**扩展驱动自动滚动**（Plucker 没有的能力） |
| 6 | 右侧常驻面板 + 抓取/停止/续抓/过滤/进度 | **抄** | 新写 `js/x-bulk.js`，样式抄 `bulk-profile.js`（含「勾选状态存数据层」踩坑经验） |
| 7 | 命名模板 `{{UserName}}/{{Text Summary}}/{{Published Time}}` + 默认根目录 | **部分抄** | 变量思想抄，但**复用本项目 `naming.js` + `VRPath`**（`${author}_${title}`、`video-rod/X/作者(@handle)/视频|图片/`），不引入第二套模板引擎 |
| 8 | `chrome.downloads` + URL 预记账 + `byExtensionId` 防火墙 + Invalid filename 三级降级 | **已有** | 本项目 ADR-027 已等价实现（且用 FSA 直写优先，比 Plucker 更进一步），直接复用 |
| 9 | 本地任务库 / 每日计数 | **不抄** | 本项目用 `vrDedupLoad`/`vrMediaIdentity` 去重 + 资源库，避免重复建库 |
| 10 | Web App 云端任务库 / 授权 token | **不抄** | 与「纯浏览器端、离线优先」原则相悖，无外部依赖 |
| 11 | 独立下载按钮（每条推文媒体） | **已有** | 本项目 `js/x-button.js` 已做推文操作栏内联下载 |
| 12 | 13 语言 i18n | **不抄** | 本项目单语言（中文） |

---

## 五、复用矩阵（本项目现状 → 推特全下载模块）

| 能力 | 现有位置 | 复用度 | 备注 |
|---|---|---|---|
| MAIN world 旁读骨架 | `js/net-sniff.js` | 骨架抄，解析新写 | 现有只做 URL 正则，不解析结构 |
| 批量下载队列 + 风控熔断 | `vrBulkDownload`（`js/background.js:5436`） | **100%** | 串行、1.4–2.6s 随机、连败 3 次暂停 |
| X 分支落盘（FSA 优先→downloads 回退） | 同函数 `site==='x'` 分支 | **100%** | 带 url 的图片/视频都支持 |
| 无 url 视频自动解析 | `vrBulkDownload:5451` → `fetchXVideo` | **100%** | fxtwitter，`vrResolveX` 同源 |
| 命名 / 归档目录 | `naming.js`、`VRPath`、`vrBulkName`/`vrMediaPath` | **100%** | → `video-rod/X/作者(@handle)/视频|图片/` |
| 去重 | `vrMediaIdentity`/`vrDedupLoad` | **100%** | 上限 8000 条 |
| 缩略图防盗链 | `vrSetMediaHeaders`(DNR 改 Referer) | **100%** | 10 分钟自动清 |
| 右侧面板 UX | `js/bulk-profile.js` | 样式可抄 | 需新建独立文件，避免与现有面板互扰 |
| 推文内联下载 | `js/x-button.js` | **已有** | 不在本模块范围 |

**必须新写**：`js/lib/twitter-timeline.js`（MAIN world 结构化旁读）、`js/x-bulk.js`（自动滚动 + 面板）+ manifest 一条 MAIN world content script。

### 五bis、工作量结论（增量视角）

| 工作项 | 落点 | 复用度 | 估工 |
|---|---|---|---|
| MAIN world 结构化旁读 + 时间线解析纯函数 | 新 `js/lib/twitter-timeline.js`（≈250 行）+ 单测 | 解析逻辑参照 Plucker `$` 函数重写 | 1 天 |
| 自动滚动驱动 + 右侧面板 | 新 `js/x-bulk.js`（≈450 行，参照 `bulk-profile.js` 720 行） | 样式/勾选数据层/进度回调全抄 | 1.5 天 |
| manifest 注入 + 后台消息打通 | `manifest.json`、`js/background.js`（复用 `vrBulkDownload`/`vrResolveX`） | 队列/落盘/去重 100% 复用，仅加中转 | 0.5 天 |
| 微博「主页全部微博」改造 | `js/bulk-profile.js` 微博分支加全下载模式 | 扫描/命名/目录/熔断全复用 | 1 天 |
| 单测 + fixture + 真机验证 | `tools/test-x-timeline.js`、`test-site/x-timeline-fake.html`、真机探针 | — | 1 天 |
| **合计** | | | **≈5 天** |

> 结论：**「容易到中等」**。没有一处需要新建基建；难点集中在「时间线响应的结构化解析」与「自动滚动的终止条件」两个纯逻辑点，可离线单测先行，不依赖真机。

---

## 六、预研遗留（待真机定性）

| # | 未知项 | 为什么要紧 | 定性方法 |
|---|---|---|---|
| 1 | X 时间线 GraphQL 响应是否**直带** `video_info.variants` | 带 → 视频零额外请求；不带 → 每条约一次 fxtwitter（慢且有第三方依赖） | `tools/x-timeline-probe.py` dump 响应结构 |
| 2 | `pbs.twimg.com` 原图 / 视频 CDN **不带 Referer 是否 403** | X 分支落盘当前不设 Referer；若需则要接 `vrSetMediaHeaders` | 探针内直接 fetch 判状态 |
| 3 | 博主主页滚动**多少轮到底**、是否出现 429 | 决定自动滚动终止条件与节奏 | 探针观察 cursor 与网络状态 |
| 4 | 微博博主主页时间线接口与字段 | 微博「主页全部微博」实现依据 | `tools/weibo-profile-probe.py` |

---

## 七、结论

- Plucker 的「博主全下载」= **MAIN world 结构化拦响应 + 主动 GraphQL 分页 + 右侧面板 + chrome.downloads 队列**。
- 本项目**已具备其中 3/4 的基建**（队列/命名/目录/去重/面板/按钮），增量仅集中在「结构化旁读 + 自动滚动 + 独立面板」。
- 采用「自动滚动 + 拦截」（**不抄**主动 GraphQL）后：不碰鉴权头、不发私有请求，风控面显著小于 Plucker，代价是速度受页面加载限制。
- 可行性评级：**容易到中等**；唯一不确定是 §六 第 1/2 项，须真机定性后再定视频抓取路径。
