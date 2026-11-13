# 图片管线重构设计（IMAGE-PIPELINE v2）

> 日期：2026-11-13 ｜ 状态：待实施 ｜ 依据：`deliverables/reviews/2026-11-13-图片批量失败审计.md`
> 目标：把「本页图片」的四条入口收敛成**一套发现层 + 一套执行层**，让批量下载和批量嗅探在真实站点上可用、可重试、可验证。
> 原则：**复用现有模块，不新造第二套框架**；所有改动可灰度、可回退；真实登录态只做只读验证。

---

## 一、目标与非目标

### 1.1 目标

1. 同一页面四个入口（侧栏 `image.html`、popup 抓图、资源库面板、悬停「全部 N」）扫描数量一致、口径一致。
2. 批量下载遇到候选 404/403 时自动回退，不整张失败。
3. 批量结果按真实落盘判定：成功/失败/跳过分开报，失败可重试。
4. 批量文件必须落到资源库目录；FSA 未授权时阻止并引导授权，不静默回退浏览器下载目录。
5. 嗅探覆盖：主文档 + iframe + Shadow DOM + 背景图（含伪元素）+ 网络层已加载图片 + 源码/JSON。
6. 批量 200 张在 2 并发下可控完成，中断可续跑，不依赖 SW 长时间存活。
7. 把批量落盘纳入门禁：坏掉必须变红。

### 1.2 非目标（本版不做）

- 不做站点专有选择器堆叠；站点差异优先走「URL 规则表 + 通用通道」。
- 不把整页图片塞进媒体嗅探列表（B-80 口径：点「图片」直接开抓图/侧栏）。
- 不做 JSZip 打包下载的新实现；现有 ZIP 只改为复用统一取字节。
- 不改资源库页面 UI；只补「失败/重试/真实落点」提示。
- 不复制 ImageAssistant 的源码（仅做行为对标）。

---

## 二、总体架构

```
┌──────────────── 入口层（只做 UI） ────────────────┐
│ 侧栏 image.html │ popup 抓图 │ 面板 │ 悬停条 │ 图集 │
└───────────────┬──────────────────────────────────┘
                │ 统一消息：vrImg.scan / vrImg.batch / vrImg.batchRetry
┌───────────────▼──────────────────────────────────┐
│ SW 编排层（background.js）                         │
│  · vrImgScan：webNavigation.getAllFrames + 逐帧注入 │
│  · vrImgPipeline：候选解析 / 队列 / 落盘 / 回执     │
└───────┬───────────────────────┬──────────────────┘
        │                       │
┌───────▼─────────┐   ┌─────────▼──────────────────┐
│ 发现层（页面）   │   │ 数据/落盘层                 │
│ lib-image-util   │   │ VRSave（FSA） / VRPath      │
│ lib-download-scan│   │ VRDB / VRDedup / VRLib      │
│ net-sniff（MAIN）│   │ VRSiteName / VRSiteNameStore│
└─────────────────┘   └────────────────────────────┘
```

**边界**：

- 入口层不再自己扫描、不再自己拼下载 URL、不再自己标记“已下载”。
- 发现层只负责“找出图片和候选”，不做下载判定。
- 执行层只负责“把一张图可靠落盘”，不关心入口。
- 数据层保持现有 `VRSave`/`VRPath`/`VRDB`/`VRDedup` 契约，不新造存储。

---

## 三、统一数据结构

### 3.1 ImageItem（发现层输出）

```js
{
  url: string,              // 页面当前显示/主地址（绝对 URL）
  candidates: string[],     // 原图候选，按优先级排序；首位最可能是原图
  w: number, h: number,     // 已知尺寸（原始像素）；0 表示未知
  naturalW: number, naturalH: number,
  source: 'dom'|'bg'|'network'|'src'|'iframe'|'shadow',
  frameId: number,          // 0 = 主 frame
  referer: string,          // 该图所属页面/ frame 的 URL
  cardKey: string,          // 所属内容卡（笔记/微博/帖子）的稳定键；取不到为空
  title: string,            // 所属内容标题；取不到为空
  authorFull: string,
  creatorId: string,
  liveUrl: string,          // 小红书实况 mp4；无则空
  extHint: string,          // 从 content-type / URL 得到的扩展名提示
  dead: boolean,            // 预载明确失败（404/解码失败）
  tiny: boolean             // 回填后确认是图标（仅用于 UI 默认不勾选）
}
```

### 3.2 BatchJob（执行层）

```js
{
  batchId: string,
  tabId: number,
  pageUrl: string,
  pageTitle: string,
  siteName: string,
  authorFull: string,
  creatorId: string,
  concurrency: number,      // 2~3，默认 2
  items: ImageItem[],
  status: 'running'|'done'|'canceled'|'error',
  done: number, ok: number, fail: number, skipped: number,
  failures: [{ url, code, message }],
  paths: string[],
  startedAt: number,
  updatedAt: number
}
```

断点存 `chrome.storage.session.vrImgBatchJobs[batchId]`，每 10 项或 3 秒写一次；只存 `done/ok/fail/skipped/failures/paths/status` 和剩余 item 索引，不存整页 DOM。

### 3.3 结果对象

```js
{
  ok: boolean,
  code: string,             // 见 §八
  message: string,
  url: string,              // 实际使用的候选
  usedCandidate: string,
  fallback: boolean,        // 是否用了回退候选
  path: string,             // 库内相对路径（真实落点）
  fsa: boolean,
  duplicate: boolean,
  skipped: boolean,
  bytes: number,
  mime: string
}
```

---

## 四、发现层设计

### 4.1 统一入口

新增 **SW 侧** `vrImgScan(msg)`，入口层只发一条消息：

```js
{ Message: 'vrImg.scan', tabId, level: 2, includeNetwork: true, max: 2000 }
```

SW 负责：

1. `chrome.webNavigation.getAllFrames({tabId})` 拿全部 frame。
2. 对每个 frame：`chrome.scripting.executeScript({target:{tabId, frameIds:[frameId]}, func: collectInFrame, args:[opts]})`。
3. 把各 frame 结果按 `url` 合并（保留最早 `frameId` 与最强来源优先级）。
4. 合并 SW 侧网络缓存（`vrImgNetCache`）。
5. 统一去重、排序、截断；返回 `ImageItem[]`。

`collectInFrame` 只做通道编排，过滤规则全部调用 `VRImageUtil`，**不允许再写第二份扫描器**。

### 4.2 通道与优先级

| 优先级 | 来源 | 实现 |
|---|---|---|
| 1 | DOM `<img>` | `VRImageUtil.scanImages` 扩展全属性通扫 |
| 2 | 背景图 | `VRImageUtil.scanBackgrounds` 扩展伪元素 `::before/::after` |
| 3 | 其他 DOM | `<video poster>`、`<a href>` 图片链接、SVG `<image>` |
| 4 | Shadow DOM | 递归 `shadowRoot`（open；closed 用页面侧注入钩子） |
| 5 | 网络缓存 | SW `vrImgNetCache`（`onHeadersReceived`） |
| 6 | 源码/JSON | `VRDownloadScan.extractUrlsFromHtml` + JSON 结构化提取 |

**合并规则**：

- 同一 URL 只保留一条；`source` 取优先级最高者；`candidates` 取并集并保持“原图优先”。
- 网络缓存的项若 DOM 已有，补充 `referer`/`naturalW`/`extHint`，不新增条目。
- 源码通道只补充 DOM/网络都没有的 URL，且必须过 `isWorthDownloading` 的“可解码/非占位”判定。

### 4.3 全属性通扫

在 `lib-image-util.js` 扩展 `collectCandidates` 与 `scanImages`：

- `<img>`：`src`、`currentSrc`、`srcset`、`<picture><source srcset>`、`data-*`（现有 `DATA_ATTRS` 保留，另加 `data-original`、`data-lazy`、`data-echo`、`data-actualsrc`、`data-original-src`、`data-highres`）。
- 元素属性：遍历 `el.attributes`，对 `style` 与任意 `data-*` 跑图片 URL 正则（只接受 `http(s):`/`data:image`）。
- 背景：`getComputedStyle(el).backgroundImage` + `::before`/`::after` 的 `content:url()`/`backgroundImage`。
- 链接：`<a href>` 且 `isProbablyImage(href)` 或路径含图片扩展名。
- 媒体：`<video poster>`、`<source srcset>`。
- SVG：`<image href/xlink:href>`。
- 嵌套：`<iframe>` 交给 frame 注入，不在 DOM 里递归 `contentDocument`（跨域）。
- Shadow DOM：`el.shadowRoot` 递归；closed 模式在页面侧注入 `Element.prototype.attachShadow` 钩子，把 root 记录到 WeakSet（只读，不改页面行为）。

### 4.4 网络层缓存

新增 `js/image-net-cache.js`（SW 侧，纯逻辑 + 存储适配）：

- `chrome.webRequest.onHeadersReceived`（`urls:['<all_urls>']`, `['responseHeaders']`）：
  - 条件：`details.tabId >= 0`，且 `details.type === 'image'` 或 `content-type` 以 `image/` 开头；`content-length` 为空或 > 0。
  - 写入：`{ url, tabId, frameId, referer, pageUrl, contentType, bytes, at }`。
- 页面 MAIN world（扩展现有 `js/net-sniff.js`）：
  - 保留现有视频正则；新增图片扩展名正则与 `data:image`。
  - 钩住 `XMLHttpRequest`、`fetch`、`window.Image` 的 `src` setter；响应为 `image/*` 时收 `responseURL`；响应文本（`text/*`、JSON/XML）用图片正则提取。
  - 每 512ms 批量回传（沿用 ImageAssistant 的节流思路），交给 content script 转发 SW。
- 容量与过期：
  - 每 tab 最多 2000 条；超过按 `at` 淘汰最旧。
  - TTL 24 小时；`chrome.storage.session` 存，浏览器关闭即清。
  - 不写入磁盘、不同步、不跨设备。
- 开关：`imgSniff` 重新定义为“网络图片缓存”，默认开；关闭时只跑 DOM/源码通道。

### 4.5 尺寸探测

从扫描链路里移出：

- `scanImages` 不再等尺寸；未解码项 `w/h=0`，`undecoded=true`。
- 视图层（侧栏/面板/popup）拿到列表后调用 `VRImageUtil.fillSizesV2(urls, {concurrency:8, timeout:12000, retry:1})`：
  - 并发 8（ImageAssistant 实测值）；
  - 每张 8 秒超时；失败重试 1 次；
  - 返回 `{url:{w,h,fail}}`；
  - UI 先渲染占位，回填后增量更新档位/尺寸；**不因未探测到就丢图**。
- 侧栏与面板都必须接 `fillSizesV2`；popup 保留“明确失败剔除、tiny 默认不勾选”。

### 4.6 持续监听

- 页面侧 `MutationObserver`（`childList/subtree/attributes`）监听 `img/src/srcset/style/data-*` 变化，500ms 节流后触发一次增量扫描。
- 滚动/可见性变化触发一次增量扫描（`IntersectionObserver` 或 `scroll` 节流 800ms）。
- 增量结果通过 `vrImg.scanDelta` 推给侧栏/面板（新增消息），UI 按 URL 去重追加；第一版也可以直接重扫全量（节流 1s），但必须自动，不要求用户点 ⟳。
- SPA 路由变化（`history.pushState/replaceState` 钩子 + `popstate`）触发重扫。

### 4.7 门槛

- 采集门槛只挡：`data:` 非图片、SVG、占位（1×1/blank/placeholder）、URL == 当前页面、明确 `dead`。
- 显示尺寸只用于：
  - 默认不勾选 `tiny`（回填后 < `PANEL_MIN_SHOW`）；
  - 排序/筛选。
- 不再用 `LIST_MIN_SHORT=80` 在采集阶段静默丢图；保留为 UI 的“默认隐藏小图”开关，可一键显示。

---

## 五、执行层设计

### 5.1 入口

保留现有消息名，内部全部走 `vrImgPipeline`：

- `vrImg.download`（单张）
- `vrImg.batch`（批量）
- `vrImg.batchRetry`（新增：只重试 `failures` 里的项）
- `vrImg.batchProgress`（保留，增加 `paths`/`failures`）

### 5.2 候选解析（核心）

`resolveCandidates(item, ctx)`：

```
for url of item.candidates (去重、最多 8 条):
  if url 是 data:image → 直接命中
  HEAD 或 Range GET（bytes=0-1023），credentials:include，cache:no-store
  如果 2xx 且 content-type 以 image/ 开头且首字节是图片头：
     命中，返回 {url, mime, bytes, usedCandidate:url}
  否则下一个
全失败：
  用 item.url 作为最后候选再试一次
  仍失败 → {ok:false, code:'IMG_E_CANDIDATE_ALL_FAILED'}
```

要点：

- **单张和批量共用同一函数**；不再有“批量直接用 bestCandidate”的分叉。
- 防盗链：解析前注册 DNR `Referer`（复用 `vrImgRefererRule`），解析后按需保留到下载完成。
- `mime` 用于决定扩展名（`image/webp → .webp`），不再靠 URL 猜。
- 失败详情带 `status`/`contentType`/`candidateIndex`，便于 UI 显示“为什么失败”。

### 5.3 落盘

`vrImgSave(item, resolved, ctx)`：

1. `VRSave.probeEnv()` / `queryPermission({mode:'readwrite'})`；无权限 → `IMG_E_FSA_PERM` + `needGrant:true`。批量在开始前统一检查一次，未授权直接返回，不逐张失败。
2. `VRSave.saveFile({relPath, blobOrUrl:resolved.url, mime, referrer, meta, onProgress})`。
3. 写后校验：
   - `size > 0`；
   - 读前 16 字节判断图片头（JPEG `FF D8 FF`、PNG `89 50 4E 47`、GIF `47 49 46 38`、WebP `RIFF....WEBP`、AVIF `ftypavif`）；
   - 扩展名与 `mime` 一致；不一致 → 改名或按 `mime` 重算 relPath。
4. 失败 → 删除半成品（`VRSave.removeFile`），返回 `IMG_E_CONTENT_INVALID`。
5. 成功 → 用 `saveFile` 返回的真实 `relPath`（`freeName` 可能改名）做入库/去重/UI。
6. `VRLib.record` / `ingest` 由现有链路负责；本层不重复写库。

### 5.4 去重

批量开始前加载一次快照：

```js
{
  byCanon: Map<canonUrl, entry>,   // 由 VRDB.getAllFiles() 一次构建
  bySha: Map<sha256, entry>,
  alive: Map<relPath, boolean>     // 按需校验，最多 N 条
}
```

- `vrFindExistingMedia` 改为接受快照，不再每张 `getAllFiles()`。
- 命中条目必须 `vrEntryFileAlive(entry)` 为真；否则从快照删除并继续下载（幽灵记录不拦）。
- 批量内 `batchSeen` 防重；跨批 `vrImgDownloaded` 继续用，但只记成功项。
- 内容指纹：落盘后算 sha；命中同 sha → 删副本 + 标引用（复用 `vrImgContentDedupe`，但传入快照，避免全表查）。
- 兼容旧账本：`vrImgDownloaded` 的整条 URL 键继续认；新键用 `platform|canonUrl`。

### 5.5 队列与生命周期

- 并发：默认 2（可配 1~4）；`chrome.downloads` 是单队列，FSA 直写并发过高反而慢。
- 单张超时：解析 15s + 落盘 30s；总 45s。
- 重试：失败 1 次（只对网络类错误；`IMG_E_CONTENT_INVALID`/`PERM` 不重试）。
- 断点：`chrome.storage.session.vrImgBatchJobs[batchId]` 每 10 项写一次；SW 重启后 `vrImg.batchProgress` 轮询可续跑。
- 取消：`vrImg.batchCancel` 置 `status='canceled'`；已开始的项允许完成，未开始的跳过。
- 大批量分片：单批最多 200；超过由 UI 分页/分批，不一次塞 1000。
- 进度：`vrImg.batchProgress` 200ms 节流，带 `done/ok/fail/skipped/total/paths/failures`。

### 5.6 命名

统一函数 `vrImgName({date, pageTitle, index, ext, authorFull, part})`：

- 默认 `YYYYMMDD_页面标题_序号.ext`；序号两位，超过 99 自然三位。
- 标题清洗复用 `VRPath.cleanSeg`；空标题回退站名/URL 末段/`图片`。
- 扩展名以解析到的 `mime` 为准；`image/jpeg → jpg`、`image/svg+xml → svg`（SVG 单独处理）、`image/avif → avif`。
- popup 不再传带扩展名的 title；面板必须传序号；微博 `vrBulkName` 与图片命名共用同一清洗函数。
- 分组目录：`part`（页面标题/作品标题）由入口传入；同一批图落同一目录。

### 5.7 ZIP 打包

- `packZip` 改为调用 `vrImgFetchBytes`（SW 统一取字节，带 DNR Referer/候选回退），不再在扩展页直接 `fetch`。
- 复用同一候选解析；失败项在进度里列出，不静默跳过。

---

## 六、入口收敛

| 入口 | 扫描 | 批量 | 失败 UI |
|---|---|---|---|
| 侧栏 `image.html` | `vrImg.scan` | `vrImg.batch` | 列表底部“失败 K 张 / 重试” |
| popup 抓图 | `vrImg.scan` | `vrImg.batch` | 弹窗内进度 + 失败列表 |
| 资源库面板 | `vrImg.scan`（或页面内统一扫描） | `VRImgBridge.download` → `vrImg.batch` | 卡片失败态 + 重试 |
| 悬停「全部 N」 | `VRImgBridge.count` 用统一口径 | `vrImg.batch` | 进度条 + 失败数 |
| 图集 | `vrImg.albumScan` 内部用统一扫描 | `vrImg.batch` | 图集面板显示失败/停止 |
| 微博备份 | `vrImg.scan` 的条目结构 | `vrBulkDownload` 补候选/校验 | 面板失败列表 |

删除：

- `popup-videorod.js` 的 `collectImagesInPage` 扫描逻辑（改为调 `vrImg.scan`）。
- `image-page.js` 的 `scanInPage` 注入逻辑（改为调 `vrImg.scan`）。
- `image-panel.js` 的独立 `scanImages` 调用（改为统一扫描/共享结果）。
- 三处 `bestCandidate` 直接拼 URL 的批量代码。

保留：

- `image-hover.js` 的悬停判定/按钮 UI（只改下载调用）。
- `image-drag.js` 的拖拽/框选（只改下载调用）。
- `VRImgBridge` 的对外桥（签名兼容，内部走 pipeline）。

---

## 七、设置项

| 键 | 默认 | 说明 |
|---|---|---|
| `imgSniff` | `true` | 网络图片缓存开关（原死开关接上） |
| `imgFetchLevel` | `2` | 1 本页 DOM / 2 +网络缓存 / 3 +源码深度 |
| `imgConcurrency` | `2` | 批量并发 1~4 |
| `imgBatchLimit` | `200` | 单批上限 |
| `imgRetry` | `1` | 网络类失败重试次数 |
| `imgScanMax` | `2000` | 单页扫描上限 |
| `imgNetCacheSize` | `2000` | 每 tab 网络缓存条数 |
| `imgNetCacheTTL` | `24` | 小时 |
| `imgMinSize` | `100` | 原始像素门槛（不是采集丢弃，是默认筛选） |
| `imgBgScan` | `true` | 背景图通道 |
| `imgPipelineV2` | `false` | 灰度开关；阶段六切默认 |

---

## 八、失败码

沿用现有 `IMG_E_*` 命名，新增/明确：

| 码 | 含义 | UI 文案 | 重试 |
|---|---|---|---|
| `IMG_E_NO_URL` | 没有可用地址 | 没找到可下载的图片 | 否 |
| `IMG_E_CANDIDATE_ALL_FAILED` | 全部候选 404/403/非图片 | 原图地址都打不开 | 是（1 次） |
| `IMG_E_HTTP` | 单个候选 HTTP 失败 | 站点拒绝（HTTP xxx） | 是 |
| `IMG_E_CONTENT_INVALID` | 落盘内容不是图片/0 字节 | 下载到的不是图片 | 否 |
| `IMG_E_EXT_MISMATCH` | 扩展名与内容不符 | 文件类型不一致 | 否（自动改名） |
| `IMG_E_FSA_PERM` | 未授权资源库目录 | 请先授权资源库目录 | 否（引导） |
| `IMG_E_FSA_WRITE` | FSA 写盘失败 | 写入失败（磁盘/权限） | 是 |
| `IMG_E_TIMEOUT` | 解析/落盘超时 | 下载超时 | 是 |
| `IMG_E_BATCH_CANCELED` | 用户取消 | 已取消 | 否 |
| `IMG_E_DEDUPE_SKIP` | 库里已有/本批重复 | 已存在，跳过 | 否 |
| `IMG_E_SOURCE_DEAD` | 预载/探测明确失败 | 图片已失效 | 否 |

---

## 九、性能与上限

- 扫描：单 frame ≤ 5000 节点；`scanBackgrounds` 先按面积/标签预筛；目标 < 300ms（不含尺寸回填）。
- 网络缓存：每 tab 2000 条；合并 O(n)；`storage.session` 写入节流 1s。
- 批量：200 张、并发 2、单张 45s 上限；目标 < 5 分钟；超过 200 由 UI 分批。
- 内容哈希：只对本次新落盘文件算；批量快照避免全表读；大文件采样策略沿用 `dedup.js`。
- 内存：候选每项 ≤ 8 条；扫描结果每页 ≤ `imgScanMax`。

---

## 十、兼容与迁移

- 旧消息保留：`vrImg.download` 不传 `candidates` 时按 `[url]` 处理；`vrImg.batch` 的 item 结构向后兼容。
- 旧账本 `vrImgDownloaded` 继续读；新写入仍用同一 storage key，避免迁移。
- 旧库条目无 `sourceUrl` 的按 `relPath` 兼容；幽灵记录校验只提示，不自动删文件。
- 旧设置 `imgSniff` 从“无消费方”变为“网络缓存开关”；`imgMinSize` 语义从“采集门槛”改为“默认筛选”，文档与 UI 文案同步。
- `LIST_MIN_SHORT` 保留为 UI 默认隐藏阈值，不再参与采集丢弃。

---

## 十一、灰度与回滚

1. `imgPipelineV2=false` 时保持旧链路；新链路只在 `true` 时接管。
2. 阶段一先并行跑“新扫描 vs 旧扫描”只读对比：同一页记录两套数量/差异 URL，写日志，不改变 UI。
3. 阶段二在隔离实例上切新下载执行器；旧执行器保留一个版本。
4. 阶段六确认无回归后删旧代码，`imgPipelineV2` 默认 `true`。
5. 回滚：关开关 + 重启扩展；不涉及数据迁移，旧账本/旧库可直接用。

---

## 十二、验收标准

1. 同一页面四个入口扫描数量一致；差异只允许来自“默认隐藏小图”开关。
2. 候选首个 404 时批量仍成功（自动回退）；403 时能走 DNR/离屏兜底。
3. 批量 N 张全部落在资源库目录；文件名唯一、扩展名与内容一致。
4. 失败项在 UI 可见、可重试；中断后能续跑；失败不写“已下载”账本。
5. FSA 未授权时批量被阻止并给出授权入口，不产生浏览器下载目录文件。
6. iframe、Shadow DOM、伪元素背景、网络缓存四类夹具全部能扫到。
7. 200 张批量在隔离实例上完成，进度真实，无“扩展后台休眠”误报。
8. 人为去掉候选回退/内容校验，门禁必须变红。
9. 真实登录态只读扫描：微博/小红书各一次，记录数量/截图，不触发批量下载。
10. `health-check --full` 全绿，且新增批量套件在门禁内。

---

## 十三、实施顺序

1. 发现层（阶段一）：先 DOM 全属性 + iframe + 网络缓存；再 Shadow DOM/伪元素/持续监听。
2. 执行层（阶段二）：先候选解析 + 内容校验 + 队列；再断点/重试/ZIP。
3. 入口收敛（阶段三）：侧栏 → popup → 面板 → 悬停 → 图集 → 微博。
4. 落盘/去重（阶段四）：FSA 强制 + 快照 + 命名。
5. 门禁（阶段五）：套件接入 + 夹具 + 反证 + 真实只读。
6. 收口（阶段六）：灰度、删旧、文档。

> 每个阶段独立提交；阶段一/二可以并行开工，但接口以本文 §三/§五 为准。
