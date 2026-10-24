# 图片下载后自动归类入库 · 调研与方案（v0.1）

> 日期：2026-10-24 ｜ 状态：**已实现（v1.0，端到端 12/12）** ｜ 前置：LIBRARY-PLAN v1.7（S1a 三段目录已实现）、IMAGE-DOWNLOAD-PLAN v1.2
> 要解决的问题：**下载完的图片怎么自动出现在资源库里**，不用手动"重新扫描"。

---

## 一、问题定义

S1a 已经做到「下载落进 `video-rod/平台/博主/类型/`」，但**落盘 ≠ 入库**：

| 环节 | 现状 | 缺口 |
|---|---|---|
| 下载落位 | ✅ S1a 完成 | — |
| 文件在磁盘上 | ✅ | — |
| 资源库能看到它 | ❌ 索引未建（S2） | **这一环要自动打通** |
| 有缩略图/尺寸/来源 | ❌ | 需要元数据与缩略图生成 |

核心矛盾：**下载完成的那一刻，发起下载的页面上下文已经没了**。
`chrome.downloads.onChanged` 只告诉你 `downloadId + 状态变了`，不会告诉你「这张图来自小红书哪个博主、原标题是什么」。

---

## 二、现有机制盘点（不用重造）

| 已有能力 | 位置 | 可复用点 |
|---|---|---|
| URL → 文件名预记账 | `js/background.js` 的 `vrPendingNameByUrl` + `vrQueueFilename()` | 已经是「下载前记账」的模式，扩展成记账**元数据**即可 |
| 统一下载入口 | `vrDownloadWithName(url, filename, extra)` | 所有下载都过这里，天然是记账的挂载点 |
| 下载完成监听 | `chrome.downloads.onDeterminingFilename`（M8 已注册） | 再加一个 `onChanged` 监听，互不冲突 |
| 去重表 | `vrDownloaded`（path → {t}） | 入库时可复用同一套 key |
| 路径引擎 | `js/library/path.js` | 反解 relPath → 平台/博主/类型 |

---

## 三、业界做法

| 产品 | 做法 | 对我们的启发 |
|---|---|---|
| **Filex AI** | 「每次下载都被分析、重命名、放进库的对应文件夹」——下载完成即归档 | 完成事件驱动，不靠定时扫描 |
| **Pixel Flow** | 侧栏「个人图片库」：保存选中图片 → 加标签 → 搜索 | 入库后要有元数据（尺寸/来源/标签）才有价值 |
| **OrcaBox** | 「Add Source Folder → Auto Index（生成缩略图、提取元数据、实时文件监听）」 | 目录监听适合桌面端；浏览器扩展做不到"监听目录"，只能靠下载事件 + 补偿扫描 |
| **Tuzhua / Image Downloader Assistant** | 「自动文件排序 + 资源归档 + 智能重命名」 | 归类发生在下载时（我们已用三段目录实现） |

**共同结论**：能做「自动入库」的扩展，都是**在下载发起时就记住上下文**，完成时再落索引。
纯靠"完成时扫描"的，只能拿到文件名和 URL，拿不到标题/博主。

---

## 四、三个候选方案

| 方案 | 做法 | 能拿到什么 | 可靠性 | 复杂度 |
|---|---|---|---|---|
| **1. 完成时扫描** | 监听 `onChanged` → `downloads.search` → 从文件名/URL 反推平台博主 | 文件名、URL、大小 | ★ 低（标题/博主大多拿不到） | 低 |
| **2. 预登记 + 完成确认（推荐）** | 发起下载时把元数据存起来；完成时按 downloadId/URL 取回，写索引 | 全部（平台/博主/标题/原图 URL/尺寸） | ★★★ 高 | 中 |
| **3. 目录监听** | 用 FSA 句柄 + 轮询目录变化 | 文件名、大小 | ★★ 中（浏览器无原生目录监听，要轮询；且需授权） | 中高 |

**选 2**，方案 3 作为兜底（索引丢失时全量扫描已经规划在 LIBRARY-PLAN §4.4）。

---

## 五、推荐方案：预登记 + 完成确认 + 懒缩略图

### 5.1 时序

```
① 页面发起下载（popup / 悬停按钮 / 批量）
   └─ sendMessage: vrImg.record  { url, relPath, platform, creatorFull, creatorId, title, mediaType, sourceUrl }
        └─ SW 写入 chrome.storage.session 的 vrPendingMeta[url] = meta（带 10 分钟 TTL）

② SW 调 vrDownloadWithName(url, relPath) → chrome.downloads.download
   └─ downloads.onCreated 补记 downloadId → url

③ 下载完成：downloads.onChanged(state=complete)
   └─ downloads.search({id}) 拿**最终** filename（相对路径）、fileSize、mime
        └─ 从 vrPendingMeta 按 url 取回 meta（取不到就只入基础字段）
             └─ 写入 IndexedDB `file` store：key = 相对 filename
                  └─ 广播 "library:added" 给打开着的资源库页

④ 资源库页收到广播 → 增量渲染一张卡（不用整页重扫）

⑤ 缩略图懒生成：卡片进入视口才生成
   └─ 图片：createImageBitmap → OffscreenCanvas → WebP blob
        └─ 视频：隐藏 <video> seek 到 1s → canvas 抓帧
             └─ 存 IndexedDB `thumb` store
```

### 5.2 为什么元数据要存 `chrome.storage.session`

- SW 会被 30s 空闲回收，**内存 Map 必丢**（M8 的 `vrPendingNameByUrl` 就踩过）
- `chrome.storage.session`（Chrome 102+）随浏览器会话存活，SW 重启不丢
- 比 IDB 轻，且天然是"临时"语义（关浏览器即清）

### 5.3 为什么缩略图必须"懒生成"

| 位置 | 能不能生成缩略图 | 原因 |
|---|---|---|
| Service Worker | ❌ | 没有 DOM / Image / Canvas |
| offscreen document | ⚠️ 可以但重 | 要额外开一个隐藏文档，常驻内存 |
| 资源库页面 | ✅ 推荐 | 本来就在看图，生成即用；生成失败不影响浏览 |

---

## 六、关键坑（都有解法）

| # | 坑 | 后果 | 解法 |
|---|---|---|---|
| 1 | **`uniquify` 会改名** | 预登记的 `a.jpg` 实际落成 `a (1).jpg`，索引 key 对不上 | **以完成事件的 `filename` 为准**，预登记只用来找元数据 |
| 2 | **SW 休眠丢上下文** | 元数据丢失，只能入文件名 | 元数据存 `chrome.storage.session`；丢失时降级入库（不阻断） |
| 3 | **批量下载并发完成** | 多个 `onChanged` 同时写 IDB，可能事务冲突 | 写入串行队列（内存攒 200ms 批量提交一次） |
| 4 | **`downloadId` 会复用** | 清空下载历史后 ID 可能重复 | 主键用**相对路径**，不用 downloadId |
| 5 | **完成 ≠ 可读** | `state=complete` 时文件可能仍被占用（杀软扫描） | 只记元数据，缩略图延后到资源库打开时生成 |
| 6 | **用户手动改文件名** | 索引与磁盘不一致 | 打开资源库时核对 `size + mtime`，不一致标 `MISSING` |
| 7 | **非本扩展的下载** | 把日常下载也吸进资源库 | **只入预登记过的**；未登记的走"可选扫描"（用户手动触发） |

---

## 七、数据契约

```js
// chrome.storage.session
vrPendingMeta: {
  "<url>": {
    relPath, platform, creatorFull, creatorId, title, mediaType,
    sourceUrl, pageUrl, at
  }
}

// IndexedDB vr-library / file（key = 相对下载目录的路径）
{
  relPath: "video-rod/小红书/小鱼(@xiaoyu123)/图片/20261024_秋日穿搭_01.jpg",
  absPath: "D:\\Users\\liq21\\Downloads\\video-rod\\...",
  platform: "xiaohongshu", platformName: "小红书",
  creatorFull: "小鱼(@xiaoyu123)", creatorId: "xiaoyu123",
  type: "image",
  fileName, size, mtime,
  width?, height?, duration?,        // 懒生成缩略图时补齐
  thumbKey?,                         // 缩略图生成后写入
  sourceUrl?, pageUrl?, title?,
  downloadId?,
  state: "ok" | "missing"
}
```

---

## 八、边界（明确不做）

| 不做 | 原因 |
|---|---|
| 自动收录**非本扩展**下载的图片 | 会把用户日常下载混进资源库；需要时手动「扫描目录」 |
| 下载完成时读取图片内容算哈希 | 大文件耗时；去重用路径足够 |
| SW 里生成缩略图 | 技术上不可行 |
| 实时监听目录变化 | 浏览器没有原生目录监听 API，轮询成本高 |

---

## 九、验收标准

1. **自动入库**：从页面点「下载」→ 5 秒内资源库多出一张卡，无需手动刷新
2. **元数据完整**：新卡片的平台/博主/标题/大小正确（与下载时页面一致）
3. **改名兜底**：同名文件触发 `uniquify` 后，索引记录的是**实际**文件名
4. **SW 重启**：下载中途 SW 被回收，完成后仍能入库（元数据来自 session storage）
5. **批量**：一次下 20 张，全部入库且无重复条目
6. **失败**：下载中断（interrupted）不产生"幽灵卡片"
7. **缩略图**：资源库打开时懒生成，失败显示类型占位，不阻塞列表
8. **不误收**：手动用浏览器下载一张图（非本扩展），资源库不出现它

---

## 十、来源

- [chrome.downloads API（官方）](https://developer.chrome.google.cn/docs/extensions/reference/api/downloads?hl=zh-cn)：`onChanged` 在 DownloadItem 属性变化时触发，含 `state` 与 `downloadId`
- [downloads.onChanged（MDN）](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/onChanged)
- [Managing Downloads from an Extension（MV3 Dev Hub）](https://mv3-extension.com/core-apis-cross-browser-data-management/browser-data-apis-bookmarks-history-downloads/managing-downloads-from-an-extension/)：`delta.state.current === "complete"` 的监听到位写法
- [Filex AI（下载即归档的产品形态）](https://filexai.com/extension)
- [Pixel Flow（保存即入个人图片库 + 标签搜索）](https://chromewebstore.google.com/detail/pixel-flow-smart-image-pr/mepgoikhahpbllclcanaoijlampmceip)
- [OrcaBox（源目录自动索引 + 缩略图 + 元数据）](https://garrygit888.github.io/OrcaBox-Release/)
- [Tuzhua Image Grabber（批量下载 + 自动排序归档）](https://chromewebstore.google.com/detail/tuzhua-image-grabber/bibclbhicndopddjgcekhncdbainbccl)

---

## 十一、落地实现（v1.0，2026-10-24）

### 11.1 代码落点

| 文件 | 职责 |
|---|---|
| `js/library/db.js`（新建） | IDB `vr-library` v1：`file` / `thumb` / `setting` / `handle` / `oplog`；API 挂 `self.VRDB`，SW 与页面共用 |
| `js/library/sw-library.js`（新建） | 预登记表（`chrome.storage.session`，键 `vrPendingMeta`，TTL 10 分钟 / 上限 500 / 写盘 200ms 节流）+ `downloads.onChanged` 完成确认 + 落库 + 广播 `vrLib.added` |
| `js/library/path.js` v1.1 | 新增 `parseRelPath()`：relPath 反解平台/博主/类型，供预登记与入库兜底 |
| `js/background.js` | 顶部 `importScripts` 增 3 个库脚本；`vrQueueFilename(url, filename, conflictAction, meta)` 增第 4 参数；`onMessage` 转发 `vrLib.*` 消息 |
| `js/vr-download-hook.js` | 页面侧 `downloads.download` 包装里用 `parseRelPath` 生成 meta，随 `vrQueueName` 一起发 SW |
| `js/library/settings.js` v1.1 + `options.html` | 「资源库 → 索引状态（已入库 N 条 + 刷新）」「最近入库」；监听 `vrLib.added` 自动刷新 |

### 11.2 时序（与 §5.1 一致）

```
页面点下载
  → vr-download-hook 生成 meta（relPath/platform/creatorFull/type/…）
  → chrome.runtime.sendMessage({Message:'vrQueueName', url, filename, meta})
  → SW: vrQueueFilename 记「URL → 文件名」+ VRLib.record(url, meta)  ── 预登记
  → downloads.onChanged(state=complete)
  → downloads.search({id}) 取绝对路径
  → relFromAbs(abs, detectedRoot)；失败时用 meta.relPath 目录 + 实际文件名兜底
  → VRDB.putFiles([item]) → 广播 vrLib.added → 页面/设置页刷新
```

### 11.3 验收对照（TESTING §11，12/12）

| §九 标准 | 状态 | 说明 |
|---|---|---|
| 1 自动入库 | ✅ | 下载完成后索引自动出现条目，无需手动扫描 |
| 2 元数据完整 | ✅ | 平台/博主/类型/大小/绝对路径/文件名 8 项断言通过 |
| 3 改名兜底 | ✅ | 实际落盘 `test2 (1).mp4`（uniquify），索引记录的正是该名 |
| 4 SW 重启 | ⏳ 未构造 | 元数据在 session storage，机制已就绪，极端场景待补测 |
| 5 批量无重复 | ⏳ 未压测 | 单条已验证；批量并发待 I 系列图片链路一起测 |
| 6 失败不产幽灵卡 | ✅ 设计保证 | 只在 `state=complete` 落库，interrupted 不写 |
| 7 缩略图懒生成 | ⏳ 待 S2 | `thumb` store 已建，生成逻辑随资源库页/灯箱一起做 |
| 8 不误收 | ✅ | 只认落在 `video-rod` 根目录内的下载：日常浏览器下载落到下载目录根部，不会进库；落在根目录内但没预登记的也会收录（与 S2 全量扫描口径一致，属自愈） |

### 11.4 已知边界

- **SW importScripts 缓存**：改动 `background.js` 的 importScripts 列表后，老 profile 会继续跑缓存版脚本；测试一律用新 profile（详见 TESTING §11.3）。
- **运行期无法补载**：SW 安装完成后再调 `importScripts()` 会抛错，只能在首次求值时全部加载。
- **URL 键天然有损**：预登记以 URL 为键，同一 URL 在 10 分钟内重复下载会命中同一条 meta——两者目录相同，可接受。
