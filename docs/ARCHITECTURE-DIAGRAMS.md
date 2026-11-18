# video-rod 架构图（实测版）

> 日期：2026-11-18 ｜ **全部依据代码调用关系绘制，不依据文档**
> 配套：`ARCHITECTURE-HEALTH-AUDIT.md`（1004 行审计）｜`ENUMERATE-LAYER-DESIGN.md`（枚举层）
> 每张图下的「看图要点」指出**代码里的真实情况**（包括不一致处）

---

## 图 1 · 整体架构（运行时全景）

```mermaid
flowchart TB
  subgraph WEB["网页上下文（每个标签页）"]
    direction TB
    MAIN["<b>MAIN world</b><br/>net-sniff.js<br/>twitter-timeline-hook.js<br/>（劫持 fetch/XHR）"]
    CS["<b>隔离世界 · 通用</b><br/>content-script.js<br/>naming.js<br/>video-quality.js"]
    IMGG["<b>隔离世界 · 图片组</b><br/>lib-image-util.js（deepQuery）<br/>image-scan-service.js<br/>image-hover / panel / batch<br/>image-album / image-drag"]
    SITE["<b>隔离世界 · 站点适配</b><br/>x-button.js · bulk-profile.js<br/>xhs-batch.js · weibo-*.js<br/>douyin.js · bili-whole.js"]
  end

  subgraph SW["Service Worker（background.js 8435 行）"]
    direction TB
    ROUTER["<b>onMessage 路由</b><br/>（按 Message/tp 分发）"]
    DL["<b>vrDownloadWithName</b><br/>统一落盘出口<br/>（14 处调用）"]
    SAVE["<b>VRSave.saveFile</b><br/>FSA 优先 → downloads 兜底"]
    IMGB["vrImgBatch / vrImgDownload<br/>（图片执行层）"]
    BULK["vrBulkDownload<br/>vrBulkSaveItem"]
    YT["ytCollectFormats<br/>VRYtQueue"]
    MERGE["offscreen 编排<br/>m3u8 / mpd"]
    LIB["<b>VRLib</b>（预登记/入库）<br/>VRIndex（索引/快照）<br/>VRDedup（指纹）"]
    ENUM["<b>VREnum</b>（新）<br/>targets/pager/normalize/store<br/>bili-wbi"]
  end

  subgraph EXT["扩展页面"]
    direction TB
    POPUP["popup.html<br/>媒体列表 / 批量"]
    IMGPAGE["image.html<br/>图片侧边栏"]
    LIBPAGE["library.html<br/>媒体库（管理）"]
    OPTS["options.html<br/>设置"]
    YTDL["yt-download.html<br/>下载小窗"]
    Q["queue.html<br/>任务列表"]
    OFF["offscreen.html<br/>合并/取流"]
    VIEWER["<b>本地库.html</b>（新）<br/>离线只读查看器"]
  end

  subgraph STORE["存储层"]
    direction TB
    IDB[("<b>IndexedDB vr-library</b><br/>file / thumb / setting<br/>handle / oplog")]
    SESS[("<b>storage.session</b><br/>vrPendingMeta<br/>枚举任务断点")]
    LOCAL[("<b>storage.local</b><br/>vrSettings（视频/YT）<br/>vrLibSettings（库/图片）<br/>vrMediaSeen / vrImgDownloaded")]
    DISK[("<b>磁盘库根</b><br/>平台/作者/类型/文件名<br/>_library/ · _回收站/ · _migration/")]
  end

  MAIN -.->|"postMessage"| CS
  CS -->|"消息"| ROUTER
  IMGG -->|"vrImg.scan / vrImg.batch"| ROUTER
  SITE -->|"vrVideoDownload / vrLib.saveOne"| ROUTER
  POPUP -->|"vrLib.saveOne"| ROUTER
  IMGPAGE -->|"vrImg.batch / vrVideoDownload"| ROUTER

  ROUTER --> DL
  ROUTER --> IMGB
  ROUTER --> BULK
  ROUTER --> YT
  ROUTER --> MERGE
  ROUTER --> ENUM

  DL --> SAVE
  SAVE --> DISK
  SAVE --> LIB
  IMGB --> DL
  BULK --> DL
  YT -->|"FSA 直写"| DISK
  YT -->|"vrLib.ingest"| LIB
  MERGE --> OFF
  OFF --> DISK

  LIB --> IDB
  LIB --> DISK
  LIB --> SESS
  ENUM --> SESS
  ROUTER --> LOCAL

  LIBPAGE -->|"① 直接读"| IDB
  LIBPAGE -->|"② 直接读写句柄"| DISK
  OPTS -->|"直接读写句柄"| DISK
  LIBPAGE -.->|"导出（makeZip）"| VIEWER

  classDef danger fill:#ffe6e6,stroke:#cc0000,stroke-width:2px
  classDef newmod fill:#e6f3ff,stroke:#0066cc,stroke-width:2px
  class LIBPAGE,OPTS danger
  class ENUM,VIEWER newmod
```

### 看图要点（**与文档说法不同的地方**）

| # | 代码事实 | 影响 |
|---|---|---|
| **1** | **红色框**：`library.html` 与 `options.html` **直接读写磁盘句柄，绕过 SW** | ADR-069「单写盘通道」只约束了下载，**没约束管理操作** |
| **2** | **「统一出口」只成立一半** | m3u8 独立页、YouTube 下载页、B站页面内合成、options 校验落盘，**四类不走 `vrDownloadWithName`** |
| **3** | **蓝色框**：`VREnum` 与 `本地库.html` 是**本轮新增**，尚未接线 | 枚举层只有纯函数，未接适配器 |
| **4** | **SW 与页面共享同一个 IndexedDB，但无跨上下文写锁** | `sw-library.writeQueue` 只在 SW 内串行 |
| **5** | `MAIN world` 用**点线**连接 | 它通过 `postMessage` 通信，不是直接调用 |

---

## 图 2 · 下载 → 落盘 → 入库（核心链路）

```mermaid
flowchart TB
  A["用户操作<br/>（点击 / 批量 / 右键）"] --> B{"入口类型"}

  B -->|"单张/单卡"| C1["vrDownloadWithName"]
  B -->|"图片批量"| C2["vrImgBatch"]
  B -->|"视频批量"| C3["vrBulkDownload"]
  B -->|"YouTube"| C4["yt-download.js"]
  B -->|"m3u8"| C5["m3u8.js<br/><b>独立通道</b>"]

  C2 --> C1
  C3 --> C1

  C1 --> D["VRSave.saveFile"]
  D --> E{"有 FSA 句柄<br/>且已授权？"}

  E -->|"是"| F["FSA 直写<br/>（可 freeName 改名）"]
  E -->|"否"| G["chrome.downloads.download<br/>（文件名可能被改）"]

  F --> H["writeOne / ingestResolved"]
  G --> I["onChanged complete"]
  I --> J{"落点在库根内？"}
  J -->|"是"| H
  J -->|"否"| K["state = outOfRoot<br/><b>不可见 / 不可清</b>"]

  H --> L["VRDedup.afterDownload<br/>（算 sha256）"]
  L --> M{"命中已有？"}
  M -->|"否"| N["写 isRef=0"]
  M -->|"是"| O["写 isRef=1 + refOf<br/>removePhysical(新副本)"]
  O --> P["⚠️ fetch(file://,DELETE)<br/><b>假删除</b>"]

  N --> Q["VRDB.putFiles"]
  O --> Q
  Q --> R["广播 vrLib.added"]
  Q --> S["indexer.scheduleSnapshot(30s)"]

  C4 --> T["FSA 直写 + vrLib.ingest"]
  T --> Q
  C5 --> U["downloads.download<br/><b>不入库</b>"]

  classDef bug fill:#ffe6e6,stroke:#cc0000,stroke-width:2px
  class P,K,U bug
```

### 看图要点

| # | 事实 |
|---|---|
| **1** | **红色**：`removePhysical` 用 `fetch(file://,{method:'DELETE'})` —— 同仓库 `save.js:794` 明确写「返回 ok 但不删」 |
| **2** | **红色**：`outOfRoot` 条目**主页看不到、回收站不管、对账不清**（占盘但不可管理） |
| **3** | **红色**：`m3u8` 完全不入库（HLS 站点素材不进库） |
| **4** | 同一次下载可能跑**两遍内容去重**：`writeOne` 一次、`vrImgContentDedupe` 一次 |

---

## 图 3 · 回收站状态机（四方一致性）

```mermaid
stateDiagram-v2
  [*] --> Ok: 下载完成

  Ok --> Trashed: trash.remove()
  note right of Trashed
    ① 索引：state='trashed'
    ② 物理：搬到 _回收站/<批次>/<原相对路径>
    ③ 缩略图：保留（gc 时清）
    ④ 引用：refCount 排除 trashed
  end note

  Trashed --> Ok: trash.restore()
  Trashed --> Purged: purgeOne / empty
  Ok --> Purged: 文件已不存在（cleaned）

  Ok --> RefOnly: 引用数 > 1
  note right of RefOnly
    refOnly=true 时<b>不搬文件</b>
    只打 trashNoFile=1
  end note

  RefOnly --> Trashed: 最后一条引用被删
  RefOnly --> Purged: 只删索引行

  state "⚠️ 引用卡悬空" as Dangling
  Ok --> Dangling: 先删实体（引用数=2）
  note right of Dangling
    实体进回收站 → 引用卡 refOf 仍指原路径
    且 isRef 豁免 missing → 永远打不开也不标缺失
  end note

  classDef bug fill:#ffe6e6,stroke:#cc0000,stroke-width:2px
  class Dangling bug
```

### 看图要点

| # | 事实 |
|---|---|
| **1** | **红色**：先删实体、后删引用 → 引用卡**永久悬空**，且因 `isRef` 豁免 `missing` 而**不显示缺失** |
| **2** | `VRDedup.onDelete` **全库零调用** —— 设计里的「删引用」入口从未接上，真实删除走 `trash.js` 自写的 `refCount` 判断 |

---

## 图 4 · 枚举层（本轮新增，未接线）

```mermaid
flowchart LR
  subgraph ENUM["js/enumerate/（纯函数，可单测）"]
    T["targets.js<br/>URL → 博主身份<br/><b>33 断言</b>"]
    P["pager.js<br/>分页纯构造器<br/><b>22 断言</b>"]
    N["normalize.js<br/>item 归一<br/><b>20 断言</b>"]
    S["store.js<br/>断点持久化<br/><b>20 断言</b>"]
    W["bili-wbi.js<br/>wbi 签名<br/><b>6/6 MD5 向量</b>"]
  end

  I["博主主页 URL"] --> T
  T -->|"platform + ownerId"| P
  P -->|"下一页 URL"| EXEC["<b>执行器（待写）</b><br/>页面上下文 fetch"]
  W -->|"w_rid"| P
  EXEC -->|"响应 JSON"| N
  N -->|"items[]"| OUT{"分发"}
  OUT -->|"kind=image"| IMGB["vrImgBatch"]
  OUT -->|"kind=video"| BULK["vrBulkDownload"]
  S -.->|"断点 cursor"| P
  S -.->|"markInterrupted"| UI["UI 显示「已中断」"]

  classDef done fill:#e6ffe6,stroke:#009900
  classDef todo fill:#fff3e6,stroke:#cc6600,stroke-width:2px
  class T,P,N,S,W done
  class EXEC todo
```

### 看图要点

| # | 事实 |
|---|---|
| **1** | **绿色全部完成**（95 条断言 + MD5 验证） |
| **2** | **橙色**：执行器未写 —— 它是「把 URL 变成响应」的那一步 |
| **3** | **关键**：`pager.js` 的 B站策略**必须配 `bili-wbi.js`**，否则 `-352` 必失败 |

---

## 图 5 · 离线库（本轮新增）

```mermaid
flowchart TB
  subgraph ONLINE["扩展内（有写权限）"]
    APP["library.html<br/>管理：增删改查 / 批量 / 回收站"]
    IDB[("IndexedDB<br/>file store")]
    SNAP[("_library/index.json<br/>schema:2")]
    ZIP["makeZip（已存在）<br/>STORE 不压缩"]
    APP --> IDB
    IDB --> SNAP
    SNAP --> ZIP
  end

  subgraph OFFLINE["离线包（只读，无写权限）"]
    HTML["本地库.html<br/>（索引内联）"]
    THUMB["_library/thumbs/*.webp<br/>（相对路径）"]
    MEDIA["素材本体<br/>（可选包含）"]
    HTML --> THUMB
    HTML -.-> MEDIA
  end

  ZIP -->|"导出"| HTML

  note1["关键约束：<br/>file:// 下 fetch 被 CORS 拦截<br/>→ 索引必须内联进 HTML"]
  note2["只读原因：<br/>浏览器外无 showDirectoryPicker<br/>→ 删除/改名/移动做不到"]

  classDef newmod fill:#e6f3ff,stroke:#0066cc,stroke-width:2px
  class HTML newmod
```

### 看图要点

| # | 事实 |
|---|---|
| **1** | 导出能力**已存在**（`settings.js` `makeZip`），只缺 `本地库.html` |
| **2** | **蓝色**：离线页是新增，纯静态、零 `chrome.*` |
| **3** | 只读不是妥协，是**技术约束**（无写权限） |

---

## 图 6 · 数据模型与身份问题

```mermaid
flowchart TB
  subgraph THREE["三个「身份」被混成了一个"]
    PHYS["<b>物理文件身份</b><br/>absPath / inode"]
    LOGIC["<b>逻辑素材身份</b><br/>relPath（主键）"]
    CONTENT["<b>内容身份</b><br/>sha256"]
  end

  PHYS -.->|"应该分离"| LOGIC
  CONTENT -.->|"只有它能跨 URL 归一"| LOGIC

  LOGIC --> P1["改名 → 换主键"]
  LOGIC --> P2["移动 → 换主键"]
  LOGIC --> P3["引用 refOf 指向它<br/>→ 路径一变就悬空"]

  subgraph KEYS["三套去重键，互不知道对方"]
    K1["vrMediaIdentity<br/>site|work|media|kind|path"]
    K2["vrCanonMediaUrl<br/>host+path 归一"]
    K3["sha256<br/>内容指纹"]
  end

  classDef bug fill:#ffe6e6,stroke:#cc0000,stroke-width:2px
  class P3 bug
```

### 看图要点

| # | 事实 |
|---|---|
| **1** | `relPath` **同时是**「主键」和「归档意图」——改路径等于改身份 |
| **2** | 三套去重键各写一套，**互不知道对方存在** |
| **3** | 这是「引用卡悬空」「改名要换主键」「三套键打架」的**共同根因** |

---

## 附：图与代码的对应表

| 图中元素 | 代码位置 |
|---|---|
| `vrDownloadWithName` | `js/background.js:770` |
| `VRSave.saveFile` | `js/library/save.js` |
| `writeOne` / `ingestResolved` | `js/library/sw-library.js:273` / `:207` |
| `VRDedup.afterDownload` | `js/library/dedup.js:180` |
| `removePhysical`（假删除） | `js/library/dedup.js:249` |
| `trash.remove` / `purgeOne` | `js/library/trash.js:477` / `:914` |
| `isRef` 豁免 missing | `js/library/indexer.js:1146` |
| `deepQuery`（Shadow DOM） | `js/lib-image-util.js:869` |
| `vrCanonMediaUrl` | `js/background.js:5493` |
| `vrImgRuleId`（DNR 单调） | `js/background.js:932` |
| `js/enumerate/*` | 本轮新增（95 断言） |
| `makeZip` | `js/library/settings.js:1031` |
