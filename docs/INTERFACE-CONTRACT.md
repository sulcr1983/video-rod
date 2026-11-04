# 前后交互契约 · 资源库 UI ↔ 后台/存储

> 版本：v1.0 ｜ 日期：2026-11-04 ｜ 状态：**待苏哥审批**
> 回答一个问题：**界面要什么数据、后台给什么、存在哪、谁写谁读、改哪边会牵连哪边。**
> 事实来源：代码实测（2026-11-04，附行号）；原型：`deliverables/prototypes/media-library-redesign-v1.html`

---

## 一、总图：数据怎么流

```
content script / popup / 右键菜单
        │  发下载消息（payload 里带 author/authorId/pageUrl 等）
        ▼
background.js  vrDownloadWithName(url, filename, extra)
        │  extra.meta ──► vrQueueFilename 的 try{ VRLib.record(...) }  ← 预登记点（埋点也在这）
        ▼
sw-library.js  下载完成（downloads.onChanged state=complete）
        │  writeOne() ──► IndexedDB「vr-library」store:file
        ▼
IndexedDB vr-library  ←—— library 页直接读，不走消息
        ▲
        │  VRDB.getAllFiles()
library 页 ui.js  loadData() → filtered() → render()
        （vrLib.added 广播 → 增量刷新）
```

**一句话**：后台只管往 IndexedDB 写；资源库页只管从 IndexedDB 读；两边唯一的实时通道是 `vrLib.added` 广播。

---

## 二、IndexedDB 结构（js/library/db.js:17-46）

库名 `vr-library`，版本 1。五个 store：

| store | keyPath | 索引 | 装什么 |
|---|---|---|---|
| `file` | `relPath` | `platform / creatorId / type / mtime / starred` | 素材条目（本文主角） |
| `thumb` | `thumbKey` | 无 | 缩略图 Blob（480px WebP） |
| `setting` | `key` | 无 | 库设置 |
| `handle` | `key` | 无 | FSA 目录句柄 |
| `oplog` | `id`(自增) | 无 | 操作日志 |

---

## 三、file 条目字段契约（唯一权威表）

### 3.1 现有字段（entryFromRel，indexer.js:213-230）

| 字段 | 类型 | 谁写 | UI 用在哪 |
|---|---|---|---|
| `relPath` | string | indexer / sw-library | 主键；卡片不显示（2026-11-04 定稿），信息栏「路径」显示 |
| `absPath` | string | indexer | 定位/打开 |
| `platform` / `platformName` | string | indexer / sw-library | 卡片平台徽标、侧栏树、筛选 |
| `creatorFull` | string | naming.js / payload | **作者昵称**（原型 `author`） |
| `creatorId` | string | naming.js / payload | **可读账号**（原型 `authorHandle`）；侧栏作者树 |
| `type` | string | indexer / payload | 类型页签（image/video/…） |
| `fileName` | string | indexer | 重命名、信息栏 |
| `size` | number | indexer | 卡片、统计 |
| `mtime` | number | indexer / sw-library(`endTime`) | 排序、时间列；**兼任下载时间**（≈dlAt，见 §5） |
| `mime` | string | indexer | 格式显示 |
| `sourceUrl` | string | indexer:237 / sw-library:194 | 信息栏「直链」= **媒体直链已入库** |
| `downloadId` | number | indexer / sw-library | 关联下载任务 |
| `starred` | boolean | ui.js | 星标；「已加星标」系统收藏夹 |
| `tags` | string[] | ui.js（UI 未做，字段已通） | 卡片 tag 行、信息栏 |
| `state` | string | indexer | `ok` 等 |
| `title` | string | sw-library / meta | 卡片标题（原型已用） |
| `pageUrl` | string | sw-library:195/140 | 信息栏「原帖」——⚠️ **重建索引会丢，见 §6** |

### 3.2 预留字段（溯源 A 档，暂无代码，见预研文档）

| 字段 | 含义 | 来源 |
|---|---|---|
| `authorUrl` | 博主主页链接 | 各站点规则，从 pageUrl 推导 |
| `authorUid` | 平台内部数字 ID | payload（如 X `user.id`） |
| `workId` | 作品 ID | payload 的 `statusId/noteId/awemeId/mediaId` |
| `dlAt` | 下载完成时间戳 | downloads.onChanged 的 `d.endTime` |
| `width` / `height` / `duration` | 分辨率/时长 | thumbs.js 生成缩略图时回写（B-11，有时间窗） |

### 3.3 作者三态派生规则（UI 层约定，不落库）

| authorState | 判定 | UI 表现 |
|---|---|---|
| `ok` | `creatorFull` 非空 | 昵称（+账号，名字==账号去重） |
| `missing` | 两者皆空 | 徽标降为「部分记录」 |
| `unsupported` | 站点本身不给 | 显示「—」，不算缺失 |

---

## 四、消息通道（page ↔ Service Worker）

### 4.1 页 → SW（sw-library.js:265-307，background.js:1672 转发）

| 消息 | 作用 | 参数 |
|---|---|---|
| `vrLib.record` | 预登记（下载前记账） | `{relPath, ...meta}` |
| `vrLib.ingest` | FSA 直写文件显式入库 | `{relPath, meta}` |
| `vrLib.list` | 列条目 | — |
| `vrLib.stats` | 统计 | — |
| `vrLib.clear` | 清库 | — |

### 4.2 SW → 页

| 消息 | 触发 | 接收方现状 |
|---|---|---|
| `vrLib.added` | writeOne 入库后（sw-library.js:234） | settings.js:394 已监听；**library 页 ui.js 未监听**（改造时补：有新文件自动刷新） |
| `vrQueueName` | 页面侧 vr-download-hook.js:44 发出 | background.js:1565 记账 |

### 4.3 约定

- **库数据一律走 IndexedDB 直读**，不要新增"拉全量列表"的消息——5 万条走消息会序列化卡死。
- 新增字段只改「写入方 + indexer 白名单」，消息协议不动。

---

## 五、写入方清单（改字段时逐个核对）

| 写入方 | 位置 | 写什么 | 注意 |
|---|---|---|---|
| sw-library `writeOne` | :182-201 | 下载完成全字段 | `dlAt` 加在这（`d.endTime`） |
| sw-library `ingestDirect` | :127-146 | FSA 直写 | 同步加新字段 |
| indexer `build` | :394-445 | 目录扫描重建 | **必须过 mergeEntry 白名单** |
| indexer `entryFromRel` | :209-231 | 扫描时从目录名反推 | 新字段给默认值 `''` |
| rename.js / trash.js / migrate.js | 各文件 | 改路径/删除 | 不碰溯源字段 |

---

## 六、两个已知坑（改代码前必读）

1. **`pageUrl` 不在 mergeEntry 白名单（indexer.js:246-261）**——SW 辛苦存下的原帖链接，用户重建一次索引就全丢。加溯源字段时必须一起补，否则重蹈覆辙。
2. **meta 与 chrome.downloads 参数隔离**——`extra.meta` 只用于预登记，进 `vrDownloadWithName` 后第一时间 `delete opts.meta`（background.js:535）。新增字段继续走 meta，不得混进 downloads 参数。

---

## 七、UI 渲染层数据流（原型 → 代码映射）

```
loadData()  →  VRDB.getAllFiles() 全量进内存数组
            →  filtered()  [收藏夹 → 类型 → 平台 → 作者 → 关键词 → 排序]
            →  render()    卡片/列表 DOM（现状全量渲染）
            →  renderEmpty() / 统计卡（素材 = 图片 + 动图 + 视频，必须可加和）
```

- 原型统计卡口径：**素材 36 = 图片 13 + 动图 5 + 视频 18**，代码侧照此对齐。
- 全量渲染在大库是硬伤（5 万条 4.1s），虚拟滚动单独立项（BACKLOG B-14），本契约不受其影响——filtered() 的输入输出不变。
- 卡片不显示路径（2026-11-04 苏哥定稿）：`relPath` 仍进内存（信息栏、右键复制路径都要用），只是**不渲染到卡片 DOM**。
