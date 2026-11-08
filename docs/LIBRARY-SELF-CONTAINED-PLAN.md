# 资源库自包含化：架构方案（审计稿）

- 日期：2026-11-07 ｜ 状态：**方案已定稿，待施工**
- 方向变更：**放弃"本地 HTML 版资源库"**，改为把现有扩展做扎实
- 起因：用户确认真实痛点是「**重装系统后整理成果丢失**」，而不是「扩展不能用时还能看图」
- **配套文档**：`docs/LIBRARY-PERSISTENCE-SPEC.md`（存储格式、接口、迁移、验收标准）
- **本文定位**：解释「为什么这么做」，规格细节以 SPEC 为准

> **2026-11-07 二次修订**：本文经一轮红队审查（14 项发现）与一轮联网检索
> （5 项结论）后修正了 3 处错误，详见 §九「修订记录」。

---

## 〇、为什么放弃 HTML 方案

前一阶段做了完整的 `file://` 能力探针（`tools/probe-standalone/`），实测结论是：

| 判定 | 结果 |
|---|---|
| 双击 HTML 能看到素材 | ✅ 成立（T1–T4 全通过，含中文/空格/`#`/`%` 文件名） |
| 双击 HTML 能生成缩略图 | ❌ **失败**（T15/T16 `SecurityError` 画布污染） |
| 双击 HTML 能拿到最新数据 | ❌ 依赖快照，而快照**只在手动点按钮时才写** |
| 每次打开要授权 | ⚠️ 要点一次「允许」 |

**但更关键的一条是**：HTML 页读的是**同一份快照**。
用户真正在意的「收藏夹、缩略图、改名、来源信息」**根本不在快照里**
（见 §2 字段对照），所以做 HTML 页**并不能解决他的问题**——
它只是换一个入口看同样残缺的数据。

**结论**：不做 HTML 页。把痛点直接修在扩展侧，两处都受益。

---

## 一、现状架构（数据其实不在磁盘上）

```
浏览器 IndexedDB（真正的数据源）        磁盘（几乎为空壳）
┌───────────────────────────┐        ┌─────────────────────────┐
│ vr-library v1             │        │ video-rod/              │
│  ├ file    元数据           │        │  ├ _library/            │
│  ├ thumb   缩略图 blob      │ ──▶    │  │   index-*.json       │
│  ├ setting 设置 / 收藏夹    │ 仅快照  │  ├ 花瓣/…              │
│  ├ handle  目录句柄         │        │  ├ _回收站/            │
│  └ oplog                   │        │  └ _verify/ 等          │
└───────────────────────────┘        └─────────────────────────┘
        ↑ 重装系统 = 全部清空              ↑ 只有一个残缺快照
```

**这就是「重装丢整理成果」的根因**：所谓"资源库"其实住在浏览器里，
不在那个素材文件夹里。

---

## 二、快照字段对照（重装后到底丢什么）

`indexer.js:744-756` 实际写进快照的字段只有 9 个：

```js
relPath, size, mtime, platform, creatorId, type, fileName, starred, tags
```

| 数据 | 真实存储位置 | 重装后能恢复吗 |
|---|---|---|
| 素材文件 | 磁盘 | ✅ 本来就存在 |
| 星标 | 快照 `starred` | ⚠️ 仅当**写过快照** |
| 标签 | 快照 `tags` | ⚠️ 仅当**写过快照** |
| 平台 / 作者 / 类型 | 目录名反推 | ✅ 能 |
| **收藏夹** | `setting` store 的 `vrFavs` | ❌ **不在快照里** |
| **缩略图** | `thumb` store 的 blob | ❌ 丢，需重新解码生成 |
| **改名的显示名** | `file` store 的 `displayName` | ❌ 快照无此字段 |
| **分辨率 / 时长** | `file` store 的 `width/height/duration` | ❌ 快照无此字段 |
| **来源 URL / 原帖** | `file` store 的 `sourceUrl/pageUrl` | ❌ 快照无此字段 |

> **既有隐患确认（已核对代码，原表述有误需更正）**：
> - `mergeEntry`（`indexer.js:390-420`）**已**保住 `pageUrl/mediaUrl/authorUid/workId` 等
>   （F2 溯源那组字段）。所以 B-07 的「重建索引丢 pageUrl」**已经修好了**。
> - 真正的缺口在**快照 payload**：`snapshot()` 的 `files.map`
>   （`indexer.js:744-756`）只输出 9 个字段，`pageUrl/mediaUrl/displayName/width/height`
>   等**根本没进快照**。所以「重建索引」不丢，但「重装后从快照恢复」会丢。
>
> 这正是本方案阶段 1 要解决的。

---

## 三、目标架构

### 3.1 磁盘形态

```
video-rod/
├── _library/                      ← 自包含的唯一真相源（可整体备份/拷走）
│   ├── index.json                 ← 固定名，全量元数据（含收藏夹）
│   ├── index-YYYYMMDD.json        ← 按日期留 7 份（现有 pruneSnapshots 逻辑不变）
│   ├── thumbs/                    ← 缩略图落盘
│   │   └── <hash>.webp            ← 用 relPath 的 hash 命名（见 3.4）
│   └── meta.json                  ← 收藏夹、视图设置等轻量状态
├── 花瓣/ …                        ← 素材本体
└── _回收站/
```

**为什么用固定名 `index.json`**："先读索引、再对账"策略需要一个
**已知文件名**（无法在未授权时枚举目录，也就不能"找最新那份"）。
`SNAP_RE=/^index-(\d{8})\.json$/` 不匹配它，两份可安全共存
（已实测 6/6 通过，见 `docs/LIBRARY-STANDALONE-PLAN.md` §0）。

### 3.2 数据流（打开资源库时）

```
打开资源库
  ① 读 _library/index.json          ← 1 个文件，2 万条约几百毫秒
     ↓ 立刻有画面（不等扫描）
  ② 后台增量对账（不阻塞 UI）
     · 只 stat 文件是否存在（不读内容、不解码）
     · 磁盘新增 / 删除 → 只处理差异项
     · 缩略图缺失且有条目 → 补生成
  ③ 对账完成 → 写回 index.json
```

**与现状的差别**：现在 `mode:'full'` 会 `walk()` 全树 + 对**每个文件**调
`h.getFile()`（`indexer.js:542`），上万条必然慢。新策略把「拿到画面」
和「校对准确性」拆开，前者只读一个文件。

### 3.3 缩略图落盘

| 项 | 取值 | 依据 |
|---|---|---|
| 尺寸 | 最长边 400px | `thumbs.js:12` `MAX_EDGE` |
| 质量 | webp 0.66 | `thumbs.js:13` `QUALITY` |
| 单张估算 | 10–25KB | 实测口径 |
| 2 万条总量 | **约 200–500MB** | 用户已确认接受 |

**双写策略**：生成缩略图后
1. 照旧写 IDB `thumb` store（页面即时显示用它，最快）；
2. 同时写 `_library/thumbs/<hash>.webp`（重装恢复用它）。

读的时候优先 IDB → 缺失则读磁盘文件 → 都没有才生成。

### 3.4 文件名要用 hash，不能直接用 relPath

现状 `thumbKey = 't:' + entry.relPath`（`thumbs.js:186`），
形如 `t:花瓣/小鱼(@u1)/图片/面包.jpg`。

**问题**：含中文、`@`、`#`、斜杠，不能直接当文件名（斜杠会被解析成目录）。
**方案**：用 `relPath` 的 SHA-256 前 16 位做文件名，`thumbs/<hex16>.webp`。
`dedup.js:41` 已有 `crypto.subtle.digest('SHA-256', …)` 用法可参照。
映射关系存在 `index.json` 的条目里（`thumbFile` 字段），不靠重算。

### 3.5 扫描策略

| 阶段 | 动作 | 成本 |
|---|---|---|
| 冷启动 | 读 `index.json` | 2 万条 ~几百 ms |
| 增量对账 | 只 stat 差异项 | 只处理变化 |
| 缩略图补全 | 仅缺失项 | 并发 2（沿用现有限制） |

**`MAX_ITEMS` 处理**：现在 `indexer.js:26` 是 `20000` 硬上限，
超出**静默截断**。改为：
- 提到 10 万（内存可承受）；
- 且**保留超限提示**，不再静默。

---

## 四、改造清单（分阶段，每阶段可独立验收）

### 阶段 1：快照补全 + 自动化（直接解决「重装丢整理成果」）

| # | 文件 | 动作 |
|---|---|---|
| 1.1 | `js/library/indexer.js` | `snapshot()` 的 `files.map` 增加：`displayName / width / height / duration / sourceUrl / pageUrl / mediaUrl / mime / creatorFull / title` |
| 1.2 | `js/library/indexer.js` | payload 顶层增加 `favorites`（从 `VRDB.getSetting('vrFavs')` 读） |
| 1.3 | `js/library/indexer.js` | `scanSnapshot()` 读取时把新增字段还原进条目 |
| 1.4 | `js/library/indexer.js` | 同时写固定名 `_library/index.json`（与日期快照并存） |
| 1.5 | `js/library/sw-library.js` | 入库后（`ingestDirect` / 下载完成）触发一次快照写入，不再依赖手点按钮 |

**验收**：加星标 + 加标签 + 改名 + 建收藏夹 → 点一次快照 → 删 IDB →
`build({mode:'snapshot'})` → 星标/标签/改名/收藏夹**全部还在**。

### 阶段 2：缩略图落盘

| # | 文件 | 动作 |
|---|---|---|
| 2.1 | `js/library/thumbs.js` | 生成后同时写 `_library/thumbs/<hash16>.webp`，条目记 `thumbFile` |
| 2.2 | `js/library/thumbs.js` | 读取顺序改为 IDB → 磁盘文件 → 生成 |
| 2.3 | `js/library/indexer.js` | 快照 payload 带上 `thumbFile`，恢复时能对上 |
| 2.4 | `js/library/indexer.js` | `SKIP_DIRS` 已含 `_library`，`thumbs/` 在其下，自动免扫（确认即可） |

**验收**：清空 IDB → 重扫快照 → 缩略图**直接从磁盘读出**，无重新解码。

### 阶段 3：扫描策略改造

| # | 文件 | 动作 |
|---|---|---|
| 3.1 | `js/library/indexer.js` | 新增 `build({mode:'reconcile'})`：先读 `index.json` 出画面，再 stat 对账 |
| 3.2 | `js/library/indexer.js` | `MAX_ITEMS` 20000 → 100000，且超限时**明确提示**而非静默截断 |
| 3.3 | `js/library/ui.js` / `app.js`（资源库启动路径） | 冷启动走 `reconcile`，后台跑对账，进度条如实反映 |

**验收**：2 万条冷启动 < 1s 出画面；新增一个文件后打开，只处理该文件。

### 阶段 4：备份/恢复入口

| # | 文件 | 动作 |
|---|---|---|
| 4.1 | `js/library/settings.js` + `options.html` | 「导出 `_library/` 整包」（零依赖 STORE zip，含索引+收藏夹+缩略图）与「从 `_library/` 恢复」两个按钮 |

**状态：✅ 已实施（2026-11-07）**

> **实施补充（踩到的坑）**：阶段 1.5 原写「改 `sw-library.js`」，但实际只在
> `save.js` 的直调路径触发了自动快照，漏掉了两条：
> 1. `sw-library.js` 的 `vrLib.ingest` **消息通道**（YouTube/FSA 直写走这条）；
> 2. **`indexer.js` 根本没被 Service Worker 加载** —— 于是 SW 里
>    `root.VRIndex` 是 undefined，`scheduleSnapshot()` 静默不执行。
>
> 两处均已修复：`background.js` 主清单加 `js/library/indexer.js`（放在
> sw-library 之后），`sw-library.js` 的 ingest 回调补触发。

---

## 五、明确不做

| 不做 | 理由 |
|---|---|
| 本地 HTML 版资源库 | 它读同一份残缺快照，救不了收藏夹/缩略图；实测缩略图还会因画布污染全灰 |
| gzip + base64 压缩快照 | 2 万条明文 JSON 约 8MB（实测），压缩只多一层解码 |
| 引入 SQLite / WASM | 同上，明文文件足够 |
| 引入构建工具 | 现有模块按序 `<script>` 加载即可 |
| 每次打开全量遍历 | 上万条太慢，改「读索引 + 增量对账」 |

---

## 六、已定决策

| # | 问题 | 结论 | 依据 |
|---|---|---|---|
| 1 | 做 HTML 页还是修扩展 | **修扩展** | HTML 读同一份残缺数据，救不了痛点 |
| 2 | 缩略图是否落盘 | **落盘到 `_library/thumbs/`** | 用户确认接受 200–500MB |
| 3 | 扫描上限怎么办 | **改「读索引 + 增量对账」** | 用户库已上万条 |
| 4 | 固定名用什么 | `_library/index.json` | 正则实测不冲突，可共存 |

---

## 七、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 快照写入频繁拖慢下载 | 每次入库都写 8MB | 节流（如 30s 合并一次）+ 只写固定名，日期快照仍按天 |
| 缩略图落盘失败 | 磁盘满/权限问题 | 失败只影响重装恢复，不影响当前浏览，静默降级 |
| `thumbFile` 与 IDB 不一致 | 显示旧图 | **mtime + size 双字段**比较（仅比 mtime 不够：文件被替换后 mtime 可能更小，freedesktop 规范明确警告） |
| 2 万条以上 `index.json` 变大 | 读文件变慢 | 实测 5 万条 8MB / 580ms，可接受；超此再考虑分片 |
| 对账时文件被占用 | stat 失败 | 记为 unknown，不误判 missing（沿用 ADR-030 语义） |

---

## 八、与既有文档的关系

- `docs/LIBRARY-PERSISTENCE-SPEC.md`：**配套技术规格**，存储格式/接口/迁移/验收
- `docs/LIBRARY-STANDALONE-PLAN.md`：**保留**，作为「为什么不做 HTML」的证据存档；
  其 §0 的探针实测数据是本方案放弃 HTML 的直接依据。
- `tools/probe-standalone/`：**保留**，可复跑的 `file://` 能力探针，
  将来若重启 HTML 方案不必重测。
- `docs/BACKLOG.md` B-07：本方案阶段 1 顺带修复其记录的 `pageUrl` 丢失问题。

---

## 九、红队审查发现（14 项，逐条给出处置）

审查日期 2026-11-07。**每条都附了代码证据**，不是推测。

### 9.1 数据一致性（5 项）

| # | 发现 | 证据 | 处置 |
|---|---|---|---|
| a-1 | 固定名快照覆盖写无原子性保障 | `indexer.js:759-770` 只有 `write/close/abort` | ✅ **原判断被检索推翻**：MDN 明确 FSA 写入用户可见文件系统本身就是「temporary file + 校验后替换」，无需也无法自实现 rename（见 SPEC §3.4） |
| a-2 | 快照 `root` 字段**无人消费** | 全仓库 grep 无 `payload.root` 读取方 | ⚠️ **真实缺陷**，阶段 1 必须补：`resolveRoot()` 在 `absRoot` 空时回退读它 |
| a-3 | `fileExists()` 无法区分「不存在」与「读不到」 | `indexer.js:659-668` 所有异常都 `return false` | ⚠️ **真实缺陷**，阶段 3 需区分 `NotFoundError` 与其他错误 |
| a-4 | `putThumb` 与 `patchFile` 非原子 | `thumbs.js:192-205`，注释已自述该故障模式 | ⚠️ **真实缺陷**，阶段 2 改为先落盘再写条目 |
| a-5 | 页面侧与 SW 侧跨上下文写快照无锁 | `sw-library.js:24` 的 `writeQueue` 只在 SW 内有效 | ⚠️ 阶段 1 节流器需做**单写者**约束（只由 SW 触发） |

### 9.2 缩略图生命周期（4 项）

| # | 发现 | 证据 | 处置 |
|---|---|---|---|
| b-1 | `thumb` store **只增不减**，没有任何 delete 接口 | `db.js` 仅 `clear/put/get`（127/148/157） | ⚠️ **真实缺陷**，阶段 2 加 `deleteThumbs()` |
| b-2 | 删除素材只删 `file` 条目 | `trash.js:220/240/273` 均只调 `deleteFiles` | ⚠️ 阶段 2 同步删磁盘 webp |
| b-3 | 改名置空 `thumbKey` → 旧 blob 成孤儿 + 强制重建 | `rename.js:260` + `287-288` | ⚠️ 阶段 2 需按旧 hash 删文件 |
| b-4 | 移动素材同样置空 `thumbKey` | `move-picker.js:195` | ⚠️ 同上 |

**落盘后风险放大**：这些孤儿会从「IDB 里的隐形垃圾」变成「磁盘上的可见垃圾文件」。

### 9.3 性能与迁移（5 项）

| # | 发现 | 证据 | 处置 |
|---|---|---|---|
| c-1 | `MAX_ITEMS=20000` **静默截断** | `indexer.js:26` + `528/532/535` 三处直接 return | ⚠️ 阶段 3 提到 10 万 + 新增 `LIB_E_TRUNCATED` 提示 |
| c-2 | `MAX_DEPTH=8` 同样静默丢 | `indexer.js:27,528` | ⚠️ 同上，一起提示 |
| c-3 | `getAllFiles()` 全量读出现在 6 处 | `app.js:897/904`、`dedup.js:172/202/284/329` | ⚠️ 阶段 3 加 `queryFiles()` 按需查 |
| c-4 | 首屏依赖全表读取 | `app.js:897` 启动即 `getAllFiles()` | ✅ 阶段 3 改为「先读 index.json 出画面」 |
| c-5 | IDB schema 停在 v1 且无迁移分支 | `db.js:18` `DB_VERSION=1`，`onupgradeneeded` 只建 store | ✅ **无需升版**：新增字段是普通属性，IDB schemaless（SPEC §5.2） |

**结论**：14 项中 **9 项是真实缺陷需施工修复**，2 项被检索推翻/降级，3 项确认无需动作。

---

## 十、联网检索结论（5 项）

| # | 检索问题 | 结论 | 来源 | 影响 |
|---|---|---|---|---|
| 1 | FSA 有没有 `rename`/`move`？ | ❌ **没有**。`FileSystemHandle.move()` 至今 `status="In development"`、`is_released=false` | chromestatus API (id 5640802622504960) | 原「临时文件+rename」设计**作废** |
| 2 | 那怎么写才算原子？ | ✅ `createWritable()+close()` **本身就是**「临时文件 + 安全校验后替换」 | MDN *Origin private file system* | 直接用，不额外造轮子 |
| 3 | 能否用文件系统观察替代遍历？ | ⚠️ `FileSystemObserver` Chrome 133+ **默认启用**，但提案明确「cannot guarantee that changes are not missed」+ 事件会 coalesce/rate-limit + 有 per-origin 上限 | chromestatus + whatwg/fs 提案 | 只能做**加速**，不能做唯一来源；仍须对账兜底 |
| 4 | MV3 能不能用 WASM？ | ✅ 能。CSP 最低可到 `wasm-unsafe-eval` | Chrome 扩展 CSP 文档 | 原「不能引入 WASM」理由**不成立**；但仍不引入（无必要，见下） |
| 5 | 缩略图命名与失效有无成熟规范？ | ✅ **freedesktop Thumbnail Managing Standard**：哈希命名 + `Thumb::MTime`/`Thumb::Size` 双校验 + `fail/` 目录缓存失败 + 临时文件避免并发 | freedesktop.org spec v0.8.0 | 阶段 2 **直接对齐该规范的裁剪版** |

### 检索后仍决定不引入的东西

| 候选 | 版本/许可 | 为何不用 |
|---|---|---|
| `sql.js` | 1.15.2 MIT | 明文 8MB/580ms 已够；WASM 增 1.5MB + 初始化阻塞，收益为负 |
| `@sqlite.org/sqlite-wasm` | 3.54.1 Apache-2.0 | 同上 |
| `thumbhash` | 0.1.1 MIT（10KB） | 它是「图片加载前的模糊占位」方案，与「缩略图独立存储」不同层 |
| `FileSystemObserver` | Chrome 133+ | 仅作可选加速，不作为架构依赖（见上 #3） |
| `dexie` | 4.4.7 Apache-2.0 | 非瓶颈，为换而换 |
| `minisearch` | 7.2.0 MIT | 条目过万再评估，当前不是瓶颈 |
| `photoswipe` | 5.4.4 MIT | 与本次数据层重构无关，应单独立项 |

---

## 十一、修订记录

| 日期 | 修订 |
|---|---|
| 2026-11-07 初版 | 放弃 HTML 方案，转向「扩展自包含化」 |
| 2026-11-07 二次 | 红队审查 14 项 + 联网检索 5 项后修正：① 原子写结论反转（无需自实现）；② `FileSystemObserver` 降级为可选加速；③ 缩略图失效判定改 mtime+size 双字段、对齐 freedesktop 规范；④ 补 `thumb` store 无 delete、`root` 字段无人消费、`MAX_ITEMS` 静默截断三处真实缺陷 |