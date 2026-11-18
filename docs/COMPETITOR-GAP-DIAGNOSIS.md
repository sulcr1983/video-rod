# 竞品发现 → video-rod 功能块对照诊断

> 日期：2026-11-17 ｜ 依据：`docs/research/extensions/DEEP-*.md`（12 家深度拆解）
> 方法：**每条竞品发现都先核实我们自己的代码**，再判定「用得上 / 已有 / 用不上」
> 第一性原理：**最简单方便地下载视频/图片/动图/音频 → 单独或批量 → 整博主 → 分类归档 → 统一媒体库**

---

## 〇、判定口径

| 判定 | 含义 |
|---|---|
| **✅ 已有** | 我们已实现，竞品只是印证（不必动） |
| **🔧 有缺口** | 我们有该功能块，但竞品的做法更完整/更稳 → **值得补** |
| **➕ 空白** | 我们完全没有这个能力 → 看是否服务第一性原理 |
| **❌ 不用** | 与我们的定位冲突（自用/不分发/全本地） |

---

## 一、按第一性原理六条需求对照

### 1.1 需求①：下载视频/图片/动图/音频

| 竞品发现 | 来源 | 我们现状（代码核实） | 判定 |
|---|---|---|---|
| **62 条「缩略图→原图」规则表** | AIX | `js/album-sites.js` 有 `originalOf()`，覆盖 **5 站**（微博/豆瓣/堆糖/花瓣/图虫） | **🔧 有缺口**：机制已对，**覆盖少 57 条** |
| 原图派生「站点优先 + CDN 回退」 | — | ✅ 已实现（`originalOf` 的 ① ② 两步） | **✅ 已有**（设计比 AIX 更好） |
| HEAD + Range 探测（206/200） | Chrono | `background.js:6372` 用 `Range: bytes=0-1` 探测；**未分支 206/200** | **🔧 有缺口**：没做「是否支持分段」的决策 |
| `content-length` + abort 省流量 | 爱哔哔 | 同上有 Range 探测，未用 abort | 🔧 小优化 |
| 清晰度码表（qn 映射） | 爱哔哔 | `js/video-quality.js`（100 断言） | ✅ 已有 |
| 15 种 HLS 标签解析 | VDH | `js/m3u8.js`（2446 行） | ⚠️ **需核对 `EXT-X-MAP`** |
| MP4 box 纯字节解析 | 抖珍藏 | `thumbs.js` 用 `<video>` 元素读元数据 | ❌ 不用（我们是浏览器环境，渲染更简单） |
| SVG → base64 | Imageye | 当前过滤掉 SVG | ❌ 不用（场景极小） |
| `abort` 释放连接 | 爱哔哔 | — | 🔧 可选优化 |

**结论**：需求①**基本满足**，最大缺口是**原图派生覆盖**（5 vs 62）。

---

### 1.2 需求②③：单独下载 / 批量下载合集

| 竞品发现 | 来源 | 我们现状 | 判定 |
|---|---|---|---|
| **整博主枚举（5 端点 + 分页器）** | 抖珍藏 | `js/enumerate/` 已建 4 模块（targets/pager/normalize/store），**未接适配器** | **🔧 进行中**（本次已写 95 断言） |
| 合集/收藏夹 API | 爱哔哔 | 未实现 `medialist/resource/list` | **➕ 空白** |
| 番剧剧集列表 API | 爱哔哔 | 未实现 `pgc/view/web/ep/list` | **➕ 空白** |
| `masterList` 增量同步 | 抖珍藏 | `vrMediaSeen` 只记已下载；**无服务器全量比对** | **➕ 空白** |
| `disappeared` 集合 | 抖珍藏 | 无 | **➕ 空白**（备份价值核心） |
| **XHR 被动拦截** | Plucker | `net-sniff.js` 用 `webRequest` 监听 | ✅ 已有（方式不同） |
| `navigation` API 检测 SPA | Plucker | `x-button.js` 用 `MutationObserver` | 🔧 可优化 |
| `cursorType === "Bottom"` 终止 | Plucker | `pager.js` 用 `nextCursorId` 重复检测 | 🔧 可补精确判据 |
| iframe 深度扫描 | Imageye | `all_frames: true` 声明式注入 | ✅ 已有（更可靠） |
| `ID_SCRAPING_FRAME` 防自抓 | Imageye | 不创建扫描 iframe | ❌ 不用 |
| `all_frames: true` | 多家 | ✅ 已用 | ✅ 已有 |

**结论**：需求②③最大缺口是**整博主枚举落地**（基础设施已备好）+ **增量同步模型**。

---

### 1.3 需求④：分门别类入不同文件夹

| 竞品发现 | 来源 | 我们现状 | 判定 |
|---|---|---|---|
| **FSA 目录句柄（授权一次批量写）** | 抖珍藏 | `VRSave.saveFile` FSA 优先 | ✅ 已有 |
| **`showSaveFilePicker` 单文件另存为** | Fitkun | — | ❌ 不用（不是批量） |
| **10 种目录状态校验** | 抖珍藏 | `root-guard.js` 只判断「是否库根」 | **🔧 有缺口**：缺 `unexpectedly_empty` / `belongs_to_another_*` |
| `counter.json` 日期分桶计数 | 抖珍藏 | 无 | ➕ 可选（统计用） |
| `revision`/`writtenRevision` 乐观并发 | 抖珍藏 | `sw-library.writeQueue` 串行队列 | ✅ 已有（不同解） |
| 7 表拆 7 文件 | 抖珍藏 | IDB 单表 | ❌ 不用（过度设计） |
| 日期滚动备份（10 份） | 抖珍藏 | `indexer` 快照 7 份 | ✅ 已有（只备份索引） |

**结论**：需求④**基本满足**，缺口是**目录安全校验**（防选错目录/混账号）。

---

### 1.4 需求⑤：统一媒体库查看/删除

| 竞品发现 | 来源 | 我们现状 | 判定 |
|---|---|---|---|
| **离线 `本地库.html`** | 抖珍藏 | 放弃过（`LIBRARY-STANDALONE-PLAN`） | **➕ 空白**（但有新思路） |
| 5 万条窗口化（105ms） | — | ✅ 已实现 | ✅ 已有 |
| 批量选择 / 重命名 / 回收站 | — | ✅ 已实现 | ✅ 已有 |
| 媒体库 7 域模型 | 抖珍藏 | `file` 单表 + 索引 | ✅ 已有（更简单） |

**结论**：需求⑤**已满足**。离线 HTML 是可选增量。

---

### 1.5 跨需求的架构能力

| 竞品发现 | 来源 | 我们现状 | 判定 |
|---|---|---|---|
| **8 通道 RPC 协议** | VDH | `chrome.runtime.sendMessage` + 类型字符串 | 🔧 可选（我们参与者少） |
| **`BroadcastChannel` 广播** | VDH | 逐点 `sendMessage` | **🔧 有缺口**：页面多时会漏 |
| **`storage.session` 任务持久化** | Chrono/MAX/Fitkun | `js/enumerate/store.js` 刚建 | **🔧 进行中** |
| `session` + `local` 双写 | MAX | 只用 `session` | **🔧 有缺口**：SW 重启数据全丢 |
| **`markInterrupted` 中断标记** | 竞品共识 | `store.js` 已实现 | ✅ 已有 |
| **`getContexts` 三级降级** | MAX | 直接 `createDocument` + catch | 🔧 可优化 |
| **单飞（single-flight）创建** | MAX | 无 | 🔧 可补 |
| **DNR 规则按 jobId 回收** | MAX | `vrImgRuleId()` 单调递增 + `clearRuleAfterDownload` | ✅ **已有**（且踩过坑） |
| `__serde_tag` 自定义序列化 | VDH | — | ❌ 不用（`sendMessage` JSON 够用） |
| **`aborted_no_partial` 三态** | VDH | 无 | **🔧 有缺口**：不知道失败是否留垃圾 |
| **跨世界取值协议（315B）** | Fitkun | `executeScript({world:"MAIN"})` | ✅ 已有（足够） |
| **`worker.js` importScripts 加载器** | 1.18 | ✅ 同样做法 | ✅ 已有 |
| **Shadow DOM 递归遍历** | Imageye | `lib-image-util.js` `deepQuery()` **已实现同样算法** | ✅ **已有** |
| `AbortController` 统一管理监听 | Plucker | 部分使用 | 🔧 可系统化 |
| **`onEnabled` 补注入所有标签** | 图片下载器4.0 | 无 | **🔧 有缺口**（我们踩过「需刷新」） |
| `Map<downloadId,{tabId,msgId}>` 映射 | 图片下载器4.0 | `vrWatchDownloadId` 类似 | ✅ 已有 |
| 3KB SW（超薄） | 抖珍藏/图片下载器4.0 | `background.js` 8435 行 | ❌ 不用（重构风险高） |
| 按站拆脚本（25 组） | VDH | `content-script` 内分支 | 🔧 可选（长期） |
| `_untrusted` 分层 | VDH | 无 | ❌ 不用（场景不同） |
| `world:"MAIN"` 轮询等待 | MAX | 无轮询 | 🔧 可补 |

---

## 二、判定汇总

### 2.1 ✅ 已有（竞品印证，不必动）—— **21 项**

| 能力 | 我们的实现 | 验证来源 |
|---|---|---|
| 原图派生「站点优先 + CDN 回退」 | `album-sites.js` `originalOf()` | AIX 同构 |
| Shadow DOM 递归遍历 | `lib-image-util.js` `deepQuery()` | Imageye 同算法 |
| DNR 规则单调递增 id | `vrImgRuleId()`（踩过坑后修正） | MAX 同思路 |
| `importScripts` 加载器 | `background.js` 顶部 | 1.18 同做法 |
| FSA 目录句柄批量写 | `VRSave.saveFile` | 抖珍藏同类 |
| `downloadId` 状态映射 | `vrWatchDownloadId` | 图片下载器4.0 同类 |
| iframe 内媒体抓取 | `all_frames: true`（4 组） | VDH/MAX/1.18 同类 |
| 5 万条窗口化 | `app.js` 105ms / 49 DOM | 竞品未做 |
| 批量选择/重命名/回收站 | `batch.js`/`rename.js`/`trash.js` | 竞品未做 |
| 索引快照 7 份 | `indexer.snapshot` | 抖珍藏 10 份同类 |
| 清晰度排序 | `video-quality.js`（100 断言） | 爱哔哔同类 |
| **跨世界取值** | `executeScript({world:"MAIN"})` | Fitkun `message.js`（我们够用） |
| **XHR 钩子** | `net-sniff.js` `XMLHttpRequest.prototype` | Plucker 同类 |
| **CSSOM 背景图** | `lib-image-util.js` 9 处 `getComputedStyle`/`backgroundImage` | Imageye `deepCss`（已有） |
| **`AbortController`** | 6 个文件（`background.js` 5 处） | Plucker 同思路 |
| **`all_frames` + `document_start`** | manifest 4 组 | 1.18/VDH 同类 |
| **`onChanged` 状态追踪** | `vrWatchDownloadId` | 图片下载器4.0 同类 |
| **幂等标记** | `dataset`/`state` 字段 | 图片下载器4.0 同类 |
| **`storage.session`** | `js/enumerate/store.js` | Chrono/MAX/Fitkun 共识 |
| **`markInterrupted`** | `store.js` 已实现 | 竞品共识 |
| **零依赖 zip 打包** | `settings.js` `makeZip`（STORE） | AIX 同类 |

### 2.2 🔧 有缺口（值得补）—— **21 项**

> **⚠️ 2026-11-18 补全**：第一版只覆盖 6 家（AIX/Chrono/VDH/抖珍藏/MAX/图片下载器4.0），
> **漏了 Fitkun / Plucker / 爱哔哔 / Imageye / 1.18 五家的可借项**。现已逐条核实补入（#13~#21）。

| # | 缺口 | 来源 | 我们现状（代码核实） | 服务哪条需求 | 成本 |
|---|---|---|---|---|---|
| 1 | **原图派生覆盖 5 → 62 站** | AIX | `album-sites.js` 有 `originalOf()` 覆盖 5 站 | ① 下载质量 | 低 |
| 2 | **HEAD+Range 的 206/200 分支** | Chrono | 有 Range 探测，**未分支 206/200** | ① 可靠性 | 低 |
| 3 | **`EXT-X-MAP` 初始化段** | VDH | `m3u8.js` 待核对 | ① HLS 正确性 | 低 |
| 4 | **整博主枚举接适配器** | 抖珍藏 | `js/enumerate/` 4 模块已备，未接 | ②③ 核心缺口 | 中 |
| 5 | **`masterList` 增量同步** | 抖珍藏 | `vrMediaSeen` 只记已下载 | ②③ 省流量 | 中 |
| 6 | **`disappeared` 集合** | 抖珍藏 | **无** | ③ 备份价值 | 低 |
| 7 | **目录安全校验（10 态）** | 抖珍藏 | `root-guard` 只判库根 | ④ 防写错 | 中 |
| 8 | **`aborted_no_partial` 三态** | VDH | **无**（`save.js`/`dedup.js` 零命中） | ① 失败清理 | 低 |
| 9 | **`BroadcastChannel` 广播** | VDH | 逐点 `sendMessage` | 跨需求 | 低 |
| 10 | **`session` + `local` 双写** | MAX | `store.js` 只用 `session` | 跨需求 | 低 |
| 11 | **`getContexts` 三级降级** | MAX | 直接 `createDocument` + catch | 跨需求 | 低 |
| 12 | **`onEnabled` 补注入** | 图片下载器4.0 | **无** | 跨需求「需刷新」 | 低 |
| **13** | **`navigation` API 检测 SPA** | **Plucker** | **零命中**（`x-button.js` 用 `MutationObserver`） | ③ 站点适配 | 低 |
| **14** | **`cursorType === "Bottom"`** | **Plucker** | `pager.js` 用重复游标检测 | ②③ X 分页 | 低 |
| **15** | **`medialist/resource/list` 合集** | **爱哔哔** | **零命中** | ②③ 合集批量 | 低 |
| **16** | **`pgc/view/web/ep/list` 番剧** | **爱哔哔** | **零命中** | ① 番剧 | 低 |
| **17** | **`wbi` 签名处理** | **爱哔哔** | **零命中**；**实测：取流不需要，枚举必需**（见 `RESEARCH-BILIBILI-WBI.md`） | ②③ **枚举阻断级** | 中 |
| **18** | **`content-length` + abort 探测** | **爱哔哔** | 用 `Range: bytes=0-1`（也可） | ① 省流量 | 低 |
| **19** | **`deepCss` 解析 CSSOM** | **Imageye** | `lib-image-util.js` 有 9 处 `getComputedStyle`/`backgroundImage` | ① 背景图 | ✅ **已有** |
| **20** | **模块按职责拆分** | **Imageye** | `image-panel.js` 1507 行 / `image-page.js` 1717 行 | 可维护性 | 中 |
| **21** | **`watcher.js` 独立监听模块** | **1.18** | 嗅探在 `background.js` + `net-sniff.js` | 可维护性 | 中 |

### 2.2.1 补全时确认「已有」的（不再提案）

| 项 | 来源 | 我们现状 |
|---|---|---|
| **`message.js` 跨世界取值** | Fitkun | `executeScript({world:"MAIN"})` 已够用 |
| **原图规则表** | Fitkun | 与 AIX 同一套，已在 #1 |
| **清晰度码表** | 爱哔哔 | `video-quality.js` 已按 label/height 解析 |
| **XHR 包装** | Plucker | `net-sniff.js` 有 `XMLHttpRequest.prototype` 钩子 |
| **`querySelectorAllShadows`** | Imageye | `lib-image-util.js` `deepQuery()` 已实现 |
| **`AbortController`** | Plucker | 6 个文件已用（`background.js` 5 处） |
| **`worker.js` importScripts** | 1.18 | `background.js` 同样做法 |
| **`svgToBase64`** | Imageye | 我们过滤 SVG，场景极小 |
| **`ID_SCRAPING_FRAME`** | Imageye | 不创建扫描 iframe |
| **`main.js` 精简 chunk** | 1.18 | 我们零构建，无 chunk 问题 |

### 2.3 ➕ 空白（看是否服务第一性原理）—— **4 项**

| # | 空白 | 来源 | 是否值得做 |
|---|---|---|---|
| 1 | 合集/收藏夹 API | 爱哔哔 | ✅ **已定：先做 B站合集** |
| 2 | 番剧剧集 API | 爱哔哔 | ⚠️ 低（我们非番剧工具） |
| 3 | 离线 `本地库.html` | 抖珍藏 | ✅ **已定：要做**，见 `REVIEW-LOCAL-VS-OFFLINE-LIBRARY.md` |
| 4 | `counter.json` 统计 | 抖珍藏 | ❌ 低（自用不需要） |

### 2.3.1 小金薯：**正面结论是「无可借鉴」**（不是遗漏）

| 它的做法 | 我们的做法 | 结论 |
|---|---|---|
| 纯 DOM 提取（0 个 API） | DOM + SSR + 网络缓存三层 | **我们更全** |
| 1.6MB element-ui | 手写 CSS | **我们更轻** |
| 全站注入 1.6MB 只处理一站 | 按需启用 | **我们更省** |
| 无 `downloads` 权限 | FSA + downloads 双路 | **我们更稳** |
| 无整博主枚举（架构决定做不到） | `pager.js` 已备（有 `arc/search`） | **我们更强** |

### 2.4 ❌ 不用（与定位冲突）—— **8 项**

| 项 | 理由 |
|---|---|
| `showSaveFilePicker` 单文件 | 不是批量 |
| 7 表拆 7 文件 | 过度设计 |
| MP4 box 纯字节解析 | 浏览器环境渲染更简单 |
| SVG→base64 | 场景极小 |
| `__serde_tag` 序列化 | `sendMessage` 够用 |
| `_untrusted` 分层 | 场景不同 |
| 3KB SW 重构 | 风险高收益低 |
| 30MB/7MB ffmpeg wasm | 我们容器级合并无损 |

---

## 三、优先级建议（按第一性原理）

### 3.1 立刻可做（低风险、直接服务需求①②）

| 优先级 | 项 | 为什么先做 | 成本 |
|---|---|---|---|
| **P0** | **原图派生扩到 62 站** | 已有机制，只需补规则表；**直接提升下载质量** | 半天 |
| **P1** | **`onEnabled` 补注入** | 我们踩过「需刷新一次」的坑，这个能根治 | 2 小时 |
| **P1** | **`aborted_no_partial` 三态** | 补「失败是否留垃圾」 | 半天 |
| **P2** | **`session` + `local` 双写** | `store.js` 现在只用 session，SW 重启全丢 | 半天 |

### 3.2 中等成本（服务需求③）

| 优先级 | 项 | 说明 |
|---|---|---|
| **P1** | **整博主枚举接适配器** | 基础设施（4 模块/95 断言）已备，接 B站 最简 |
| **P2** | **`masterList` + `disappeared`** | 增量同步 + 备份价值 |

### 3.3 需要判断

| 项 | 判断 |
|---|---|
| **离线 `本地库.html`** | 抖珍藏证明可行，但前提是「数据落成文件」。我们数据在 IDB。**若要做，需先决定是否导出数据文件**——这是产品决策，不是技术决策 |
| **合集/收藏夹 API** | 取决于你是否常用「收藏夹批量下载」 |
| **`BroadcastChannel`** | 我们页面少（popup/侧栏/库页），收益有限 |

---

## 四、必须说明的三件事

### 4.1 我之前有 4 处误判，已修正

见 `docs/research/extensions/README.md` §〇「旧文档更正记录」。**这提醒我：不能凭 grep 下结论。**

### 4.2 有三条我原以为缺、实际已有

| 我原以为 | 实际 |
|---|---|
| Shadow DOM 需要实现 | `lib-image-util.js` `deepQuery()` **已实现同样算法** |
| DNR id 碰撞未解决 | `vrImgRuleId()` **已改单调递增**，注释记着踩坑经过 |
| 原图派生只有 2 条 | `album-sites.js` **有 5 站规则 + 站点优先/CDN 回退** |

**这三条不该再重复提案。**

### 4.3 最有价值的不是"抄代码"，而是"补规则表"

12 家里最实用的发现是 **AIX 的 62 条规则表**——不是因为技术难，而是因为**它是一份现成的、经过验证的站点知识库**。

我们的 `originalOf` 机制已经比 AIX 更好（有 CDN 回退），**缺的只是数据**。这属于「低风险、直接见效」的事。
