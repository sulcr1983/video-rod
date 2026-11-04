# 媒体溯源元数据方案（Media Provenance Metadata）

- **日期**：2026-11-04 ｜ **状态**：📋 方案评审中（等苏哥拍板后施工）
- **范围**：A 档（最小可用回溯集）
- **关联**：`docs/BACKLOG.md`、ADR-037（去重账本）、`docs/MEDIA-LIBRARY-PLAN.md`

---

## 0. 一句话

**下载成功的那一刻，把「我还能回到哪」记下来——现在这些信息代码里全都有，只是一条都没存。**

---

## 1. 目标与非目标

### 目标（A 档）

1. 每个下载的素材，能回答三个问题：**这是谁发的、原帖在哪、什么时候下的**。
2. 媒体库预览页能直接点开博主主页和原帖。
3. 搜索能按 @handle 和域名命中。
4. 整个过程**不改变现有下载行为**，失败不影响下载本身。

### 非目标（本期不做，登记在 BACKLOG）

- 发布时间、正文、点赞数等「平台侧属性」——需要每站单独抓，站点改版即失效。
- 历史素材的真实回填——扫描拿不到，只能标 `inferred`。
- 导出 CSV / API——等有真实使用需求再说。
- 文件内嵌元数据（ffmpeg 写 MP4 tag）——扩展调不了 ffmpeg。

---

## 2. 现状诊断：信息丢在哪一环

媒体库的元数据**不是下载时记录的，而是扫描目录时反推的**：

```
walk() 遍历目录 → parsePath() 从路径拆平台/作者 → 拼出 title
```

File System Access API 扫描只能看到 **文件名 / 大小 / mtime**，读不到内容。所以：

| 字段 | 现状 | 根因 |
|---|---|---|
| 博主名 | ✅ 有 | 目录名 `平台/作者/` 里带 |
| 博主 ID | ⚠️ 半有 | 只有目录名写成 `作者(@handle)` 才有（`parseAuthor`） |
| 主页链接 | ❌ 无 | 下载时没记，事后推不出 |
| **作品页链接** | ❌ 无 | **`tab.url` 就是它，`vrVideoDownload` 已经读出来传给 dedupKey 和 Referer 了，但没存** |
| 原始直链 | ❌ 无 | `pick.url` 有，同样没存 |
| 下载时间 | ❌ 无 | `chrome.downloads` 事件里有，没落盘 |

**关键结论**：这不是「抓不到」，是「抓到了没写」。所以成本主要在埋点和存储，不在抓取。

---

## 3. 业界参照

| 参照 | 做法 | 采用什么 |
|---|---|---|
| **yt-dlp** | `--write-info-json` 给每个文件写 `.info.json`，字段固定 | **字段语义对齐**（`uploader` / `uploader_id` / `webpage_url` / `original_url`） |
| **Eagle** | Inspector 有 Tags / Notes / **URL** 三个独立字段 | **来源 URL 是一等字段**，不与备注混在一起 |
| **学术归档** | info.json 汇总成 CSV，`webpage_url` + `extracted_at` 必留 | 说明「导出」是常见后置需求，但本期不做 |

**共性**：来源链接必须独立存储、可点击、指向**原始页面**。

---

## 4. 关键判断：两个 url 必须分开

| 字段 | 是什么 | 会不会过期 | 用途 |
|---|---|---|---|
| `webpageUrl` | 作品页（`x.com/NASA/status/123`） | 不会（除非删帖） | **回溯锚点**，UI 主按钮 |
| `originalUrl` | CDN 直链（`video.twimg.com/...`） | **会**（抖音/小红书带签名与时效） | 审计「当时从哪下的」，UI 只做次要展示 + 过期提示 |

把两者混成一个 `url`，用起来会误导——用户点「重新下载」时发现 404 却不知道为什么。

---

## 5. 字段设计

内部用 camelCase（与项目现有风格一致），语义对齐 yt-dlp。

```jsonc
{
  "x/NASA/videos/artemis-ii.mp4": {
    "v": 1,                                   // 记录版本，便于以后迁移
    "platform": "x",                          // 对应目录首层
    "title": "Artemis II 发射演练 4K 实拍",
    "pageUrl": "https://x.com/NASA/status/123",   // ≡ yt-dlp webpage_url
    "mediaUrl": "https://video.twimg.com/...",    // ≡ original_url（会过期）

    "author": "NASA",                         // ≡ uploader（显示名）
    "authorId": "NASA",                       // ≡ uploader_id（@handle / uid）
    "authorUrl": "https://x.com/NASA",        // 主页

    "workId": "123",                          // 作品 ID（推文/笔记/视频/稿件）
    "mediaId": "0",                           // 同作品内第几个媒体（多图/视频+封面）

    "downloadedAt": 1760000000000,            // 毫秒时间戳
    "source": "download",                     // download = 下载时记录 | inferred = 从路径反推
    "bytes": 193000000                        // 可选，下载完成时拿到的实际大小
  }
}
```

**为什么留 `v`**：以后加字段（发布时间、正文）时，能按版本迁移，不用猜旧记录长什么样。

**为什么不存 sha256**：`_index/hashes.json` 已经有一份，重复存会不一致。

---

## 6. 数据流：为什么不能直接写盘

**硬约束**：MV3 的 Service Worker **没有 File System Access API**，下载发生的地方（SW）写不了 F 盘。

所以走两段式：

```
①  下载成功
    vrDownloadWithName()  ← 所有下载路径的唯一出口
         │  组装 record
         ▼
    chrome.storage.local["vrMediaMeta"]      ← 待同步队列（KV：filename → record）

②  打开媒体库（library.html，有目录句柄）
    scan() 开始时
         │  读 storage.vrMediaMeta
         ▼
    F:\download\video-rod\_index\meta.json   ← 落盘副本（KV：相对路径 → record）
         │
         ▼
    渲染 / 搜索 / 预览都用内存里合并后的 Map
```

**为什么这样设计**：

- 两份互为备份：F 盘丢了能从 storage 恢复；storage 被清也能用 F 盘那份。
- `_index/meta.json` 和 `_index/index.json` 放一起，符合「整个媒体库可以整体搬走」的直觉。
- storage 只是队列，可以被安全清理，不承担长期存储责任。

**容量**：单条约 500–700 B，1000 条约 0.6 MB，`storage.local` 默认 10 MB 完全够。超过 5000 条时再考虑分片。

---

## 7. 各平台可获取矩阵（诚实版）

✅ 已有可直接用 ｜ 🟡 要补几行代码 ｜ ❌ 拿不到

| 平台 | 作品页 | 博主名 | 博主 ID | 主页 | 直链 | 备注 |
|---|---|---|---|---|---|---|
| X / Twitter | ✅ `x.com/{user}/status/{id}` | ✅ | ✅ handle | ✅ 拼 | ✅ | `x-button.js` 已传 `user/statusId` |
| 抖音 | ✅ `/video/{id}` | ✅ nickname | ✅ uniqueId / uid | 🟡 需 `secUid` | ✅ | `douyin.js` 详情接口已有 `secUid` |
| 小红书 | ✅ 详情页 URL | ✅ | 🟡 需 user_id | 🟡 | ✅ | 详情 state 里有 `user.userId` |
| 微博 | 🟡 `$render_data` 拼 | ✅ | 🟡 uid | 🟡 `weibo.com/u/{uid}` | ✅ | 需从 `status.user` 取 uid |
| B站 | ✅ `BV{bvid}` | ✅ | ✅ mid | ✅ 拼 | ✅ | `bili-whole.js` 有 |
| Instagram | ✅ `/p/{shortcode}` | ✅ | ✅ username | ✅ 拼 | ✅ | `instagram.js` 已取 |
| 通用/右键 | ✅ `tab.url` | ❌ | ❌ | ❌ | ✅ | 没有博主概念，留空 |

**拿不到就留空，不编。** UI 里显示「未记录」，而不是显示一个猜的链接。

---

## 8. 匹配策略：文件名会变，路径会动

`meta.json` 的 key 用**相对媒体库根的路径**（`x/NASA/videos/a.mp4`）。

三个已知问题与对策：

| 问题 | 对策 |
|---|---|
| 下载 filename 带 `video-rod/` 前缀，媒体库路径不带 | 归一化：从第一个已知平台段开始截取 |
| 用户在媒体库里重命名/移动 | 监听现有 `rename()` / `performMove()`，同步改 meta 的 key |
| 用户在资源管理器里挪动文件 | 用 `hashes.json` 的 sha256 做二次匹配，命中则改 key 并标记 `relinkedAt` |

第三条是兜底，只在扫描时对「有 hash 但无 meta」的文件执行一次，不做全量比对。

---

## 9. 改动清单

| 文件 | 改动 | 风险 |
|---|---|---|
| `js/background.js` | 新增 `vrBuildMeta()` / `vrRecordMeta()`；`vrDownloadWithName()` 成功后调用；各下载入口补传 `pageUrl/author/authorId/authorUrl` | **中**——下载链是核心，埋点必须 try/catch 全包，失败静默 |
| `js/x-button.js` | 消息体补 `pageUrl`（可由 user+statusId 拼） | 低 |
| `js/douyin.js` / `js/xhs-batch.js` / `js/instagram.js` / `js/bili-whole.js` | 各自 meta 里补 `authorUrl` / `workId`（多数已有，只差拼链接） | 低 |
| `js/library/indexer.js` | 读 storage → 合并溯源字段进索引条目 | **中** |
| `js/library/lightbox.js` | 预览渲染「来源」组（现有 `paintFacts()` 12 项平铺，改为分组） | **中** |
| `js/library/ui.js` | 搜索纳入 meta 字段 | 低 |
| `js/library/rename.js` | 重命名/移动时改 meta 的 key | 低 |

> **2026-11-04 注**：合并后媒体库已模块化（`js/library/` 17 个模块），单文件 `js/library.js` 已归档为 `archive/library-legacy-singlefile.js`。本节落点已按新结构更正，逐项对照见 `docs/PROTOTYPE-MAPPING.md`。
| `library.html` / `css/library.css` | 预览信息栏加「来源」区块（按原型 v1 落地） | 低 |
| `docs/TESTING.md` | 新增 META-1~6 用例 | 低 |

**不动的东西**：嗅探内核、去重账本 `vrMediaSeen`、命名模板、下载文件名逻辑。溯源是**旁挂**，不能影响主链。

---

## 10. UI 设计（见原型）

> **2026-11-04 更新**：UI 已按「信息栏 v2」重排——来源块折叠为一行、状态徽标区分完整/部分/未记录/推断。详见 `docs/MEDIA-VIEWER-PLAN.md` §11。下面是最初的草图，仅作历史参考。

预览信息栏新增「来源」块，位于「路径」下方：

```
来源
┌──────────────────────────────────────┐
│  NASA  @NASA                    ↗ 主页│
│  x.com/NASA/status/123          ↗ 原帖│
│  video.twimg.com/...  ⧉ 复制   ⚠ 可能已过期
│  下载于 2026-11-04 15:42
└──────────────────────────────────────┘
```

补充：

- 卡片上**不加**来源图标（避免噪音），只在预览和搜索结果里体现。
- 搜索框支持 `@NASA` 和 `x.com` 直接命中。
- `source: inferred` 的记录，整块显示为浅灰 + 「从目录推断，无原始链接」。

---

## 11. 历史素材怎么办

F 盘现有 19 项素材**没有原始链接**，且永远补不回来。处理方式：

1. 扫描时对无 meta 的文件生成一条 `source: "inferred"` 记录：`platform` / `author` / `authorId`（若目录名带 `(@xxx)`）/ `title` 从路径反推。
2. 不伪造 `pageUrl` / `authorUrl`。
3. UI 明确标注「从目录推断」。
4. 提供「补录」入口：用户在预览页手动粘贴原帖链接，一条一条补（低频操作，不做批量）。

---

## 12. 验收标准

| # | 用例 | 判定 |
|---|---|---|
| META-1 | X 单条按按钮下载 | `meta.json` 出现该文件记录，`pageUrl` 等于推文地址，`authorId` 等于 handle |
| META-2 | 抖音视频下载 | `authorUrl` 指向 `douyin.com/user/{secUid}`，可点开 |
| META-3 | 批量下载 4 条 | 4 条都有记录，`mediaId` 互不相同 |
| META-4 | 媒体库预览 | 「来源」块显示博主/原帖/直链/下载时间；点原帖能在新标签打开 |
| META-5 | 搜索 `@NASA` | 只出该博主的素材 |
| META-6 | 埋点异常 | 故意让 `vrRecordMeta` 抛错，下载**仍然成功**，控制台无未捕获异常 |
| META-7 | 历史素材 | 无原始链接的显示「从目录推断」，不显示假链接 |

**META-6 是重点**：溯源是增值功能，绝不能拖垮下载。

---

## 13. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 埋点抛错拖垮下载 | 核心功能挂 | 全 try/catch，异步不 await，失败只记日志 |
| storage 配额 | 记录写不进 | 超 5 MB 时按时间裁剪最旧的，并在设置页提示 |
| 路径改 key 出错 | 记录错位 | 先写新 key 再删旧 key，失败回滚 |
| 平台拼 URL 规则变化 | 链接失效 | 只拼「确定性高」的（x/douyin/ig/bili），微博/小红书拿不到就留空 |
| 用户删掉 F 盘 meta.json | 记录丢失 | storage 里那份作为备份，下次扫描自动重建 |

**回滚**：所有改动集中在新增函数与新增 UI 块，删掉调用即恢复原状；`_index/meta.json` 是独立新文件，删了不影响索引。

---

## 14. 分期

| 期 | 内容 | 状态 |
|---|---|---|
| A | 本文档所述范围 | **待施工** |
| B | 发布时间、正文、分辨率/时长（按平台逐个抓） | 未排期，先看 A 用一个月再说 |
| C | 导出 CSV/JSON、按时间轴浏览 | 未排期 |
