# 资源库持久化技术规格（S 级 · 权威）

- 日期：2026-11-07 ｜ 状态：**规格已定，待施工**
- 文档级别：**S**（接口与字段均对照现有代码逐条核实，可复现）
- 上位方案：`docs/LIBRARY-SELF-CONTAINED-PLAN.md`（为什么这么做）
- 本文只回答：**存什么、存哪、什么格式、怎么恢复、怎么验收**

> **给接手者**：读完本文即可施工，不需要读任何对话记录。
> 所有「现状」行号均为 2026-11-07 的 `js/library/` 代码实测值。

---

## 一、设计约束（先看这条，它决定所有取舍）

| 约束 | 事实 | 来源 |
|---|---|---|
| 用户唯一 | 单人自用，不上架 | `.impeccable.md` |
| 无构建链 | 原生 ES5+Promise，按序 `<script>` 加载 | 现有 18 个 `<script>` |
| 零网络请求 | 全部本地 | 现有实现 |
| 数据量 | **上万条**（用户确认），2 万条以上会触发现有上限 | 用户口述 + `indexer.js:26` |
| 真正痛点 | **重装系统后整理成果丢失** | 用户确认 |
| 唯一真相源 | 必须落在素材文件夹内，可整体拷走 | 用户要求 |
| **浏览器基线** | `manifest.json:18` 声明 `minimum_chrome_version: 93`。**本方案的必做项全部只需 ≤93 的 API**（FSA 目录句柄 + `createWritable` + `crypto.subtle`），不依赖任何更高版本特性 | 代码核查 |
| **可选增强的版本门槛** | `FileSystemObserver` 需 **Chrome 133**（`chromestatus`: desktop 133, "Enabled by default"）。**仅作加速，不作为依赖**，低版本自动退化为轮询对账 | chromestatus API |

> **版本策略**：本方案**不提高** `minimum_chrome_version`。
> 若将来要用 `FileSystemObserver` 加速，必须写成 `if ('FileSystemObserver' in self)` 特性探测，
> 探测失败走原对账路径——绝不让低版本浏览器失去核心功能。

**非目标**（明确不做，见 §八）：本地 HTML 版资源库、离线优先、多端同步、SQLite/WASM。

---

## 二、存储格式规范

### 2.1 磁盘布局

```
<资源库根>/                      例：D:\personal\Downloads\video-rod\（本机真实值）
├── _library/                    ← 元数据根（已在 SKIP_DIRS，永不被当素材扫描）
│   ├── index.json               ← 【新增】固定名全量快照（含收藏夹）
│   ├── index-YYYYMMDD.json      ← 【现有】按日快照，保留 7 份
│   ├── thumbs/                  ← 【新增】缩略图落盘
│   │   └── <hash16>.webp
│   └── meta.json                ← 【新增】轻量状态（视图偏好等）
├── 花瓣/                        ← 素材本体（不动）
├── _回收站/                      ← 回收站（不动）
└── _verify/ _migration/         ← 临时目录（不动）
```

**为什么 `_library/` 安全**：`indexer.js:30` 的
`SKIP_DIRS = {'_verify','_回收站','_library','_migration','_selftest'}`
已包含 `_library`，其下所有内容（含新增的 `thumbs/`）全量扫描时**自动跳过**，无需改代码。

### 2.2 `index.json`（固定名全量快照）

**格式**：UTF-8 明文 JSON，**不压缩、不 base64**。
**实测依据**：5 万条明文 8MB、加载+解析 580–737ms、堆 43MB
（`tools/probe-standalone/verdict.json` T13）。

```jsonc
{
  "schema": 2,                    // 【新增】格式版本，见 §2.5
  "version": 1,                   // 保留现有字段，勿删（老代码读它）
  "at": 1762500000000,            // 写入时间戳（ms）
  "root": "D:/personal/Downloads/video-rod",  // 【必须被消费】见 §4.2 路径自恢复
  "subdir": "video-rod",
  "count": 12873,
  "favorites": [                  // 【新增】收藏夹，原来只在 IDB setting.vrFavs
    { "id": "fav-1", "name": "收藏", "ids": ["花瓣/a.jpg", "X/b.mp4"] }
  ],
  "files": [
    {
      // —— 现有 9 字段（不要改动语义）——
      "relPath": "花瓣/小鱼(@u1)/图片/面包.jpg",
      "size": 204800,
      "mtime": 1762400000000,
      "platform": "huaban",
      "creatorId": "u1",
      "type": "image",
      "fileName": "面包.jpg",
      "starred": 1,
      "tags": ["风景", "人像"],

      // —— 新增 8 字段（阶段 1 补全）——
      "displayName": "面包（改过名）",   // 改名后的显示名
      "width": 1200,
      "height": 800,
      "duration": 0,                  // 视频秒数，图片为 0
      "sourceUrl": "https://.../orig.jpg?token=...",
      "mediaUrl": "https://.../orig.jpg",
      "pageUrl": "https://huaban.com/pins/123",
      "mime": "image/jpeg",

      // —— 新增缩略图字段（阶段 2 补全）——
      "thumbFile": "a3f9c1e28b7d4f60", // _library/thumbs/ 下的文件名（不含 .webp）
      "thumbSrc": { "mtime": 1762400000000, "size": 204800 }  // 失效判定用，见 §2.4
    }
  ]
}
```

**字段省略规则**：新增字段缺省时**必须省略该键**，不要写 `null`/`0`，
避免老快照被误判为「有值」。

### 2.3 `index-YYYYMMDD.json`（现有按日快照）

保持不变。`SNAP_RE = /^index-(\d{8})\.json$/` 只匹配它，
**不匹配** `index.json`（无日期段），因此两份可安全共存，
`pruneSnapshots()` 也不会误删它（已用 `node` 实测 6/6 通过，
见 `docs/LIBRARY-STANDALONE-PLAN.md` §0）。

`pruneSnapshots()` 只删日期快照，保留 7 份，**永不碰** `index.json`。

### 2.4 `thumbs/<hash16>.webp`

| 项 | 规范 | 依据 |
|---|---|---|
| 文件名 | `relPath` 的 SHA-256 十六进制**前 16 位** + `.webp` | 不能用 relPath：含 `/`、中文、`@` |
| 尺寸 | 最长边 400px | `thumbs.js:12` `MAX_EDGE` |
| 质量 | webp `0.66` | `thumbs.js:13` `QUALITY` |
| 单张 | 约 10–25KB | 实测口径 |
| 2 万条 | 约 200–500MB | 用户已确认接受 |

**为什么哈希而不是 relPath**：现有 `thumbKey = 't:' + relPath`
（`thumbs.js:186`）形如 `t:花瓣/小鱼(@u1)/图片/面包.jpg`，
斜杠会被文件系统解析成目录层级，中文与 `@` 也有编码风险。

**这是 freedesktop Thumbnail Managing Standard 的通行做法**
（该规范 2001 年即用 MD5 哈希作缩略图文件名，沿用至今）。

**hash 计算的唯一入口**（新增函数，放 `path.js`）：

```js
// VRPath.thumbFileName(relPath) -> Promise<string>  // 返回 16 位 hex，不含扩展名
async function thumbFileName(relPath) {
  var buf = new TextEncoder().encode(String(relPath));
  var digest = await crypto.subtle.digest('SHA-256', buf);
  var bytes = new Uint8Array(digest);
  var hex = '';
  for (var i = 0; i < 8; i++) { hex += ('0' + bytes[i].toString(16)).slice(-2); }
  return hex;   // 8 字节 = 16 hex 字符
}
```

> 参照 `dedup.js:41` 已有的 `crypto.subtle.digest('SHA-256', buf)` 用法。

### 2.5 `meta.json`（轻量状态）

只存「不属于任何单条素材」的少量状态。**故意做小**，因为它会被频繁重写。

```jsonc
{
  "schema": 2,
  "at": 1762500000000,
  "view": "grid",              // grid | list
  "sort": "mtime-desc",
  "lastReconcileAt": 1762500000000
}
```

### 2.6 schema 版本与兼容

| 版本 | 含义 | 读取策略 |
|---|---|---|
| 无 `schema` 键 | 旧快照（只有 9 字段） | 正常读，缺失字段用默认值 |
| `schema: 2` | 本规格 | 全字段读取 |
| `schema > 2` | 更新版写的 | 读已知字段，忽略未知键，**不报错** |

**原则**：读取永远「尽力而为」，缺字段不影响渲染；写入永远写最高版本。

---

## 三、接口契约

### 3.1 现有 `VRDB`（不改签名，只加能力）

```js
// js/library/db.js 现有导出（db.js:229-247）
VRDB.open()                     -> Promise<IDBDatabase>
VRDB.putFiles(files)            -> Promise<number>
VRDB.getAllFiles()              -> Promise<File[]>        // 全量，1 万条有成本
VRDB.getFile(relPath)           -> Promise<File|null>
VRDB.patchFile(relPath, patch)  -> Promise<File|null>
VRDB.deleteFiles(relPaths)      -> Promise<number>
VRDB.clearAll()                 -> Promise<boolean>
VRDB.count()                    -> Promise<number>
VRDB.putThumb(thumbKey, blob, w, h) -> Promise
VRDB.getThumb(thumbKey)         -> Promise<{blob,w,h,at}|null>
VRDB.getSetting(key, def)       -> Promise<any>
VRDB.setSetting(key, value)     -> Promise
VRDB.log(op, payload, result)   -> Promise
VRDB.getHandle(key)             -> Promise<FileSystemHandle|null>
VRDB.setHandle(key, handle)     -> Promise
```

**新增（阶段 2）**：

```js
VRDB.deleteThumbs(thumbKeys)    -> Promise<number>
// 批量删缩略图。现 store 只有 clear/put/get（db.js:127/148/157），
// 没有删除能力，导致改名/删除后缩略图永久残留（红队发现 b-1）。
```

**新增（阶段 3，按需查询，替代全量）**：

```js
VRDB.queryFiles({ platform, creatorId, type, starred, limit, offset }) -> Promise<File[]>
// 走已建好的索引（db.js:29-33 有 platform/creatorId/type/mtime/starred 索引）。
// 目的：replace 掉 6 处无条件的 getAllFiles()（app.js:897/904、
// dedup.js:172/202/284/329 每次全表读）。
```

### 3.2 `VRThumbs`（缩略图模块）

```js
// 现有（thumbs.js:290-297）
VRThumbs.enqueue(entry)   // 入队，自动去重与并发限制（MAX_RUNNING=2）
VRThumbs.retry(relPath)   // 允许重试
VRThumbs.clear()          // 清空队列
```

**新增（阶段 2）**：

```js
VRThumbs.fileNameOf(relPath) -> Promise<string>   // 16 hex
VRThumbs.loadFromDisk(relPath) -> Promise<Blob|null>
VRThumbs.saveToDisk(relPath, blob) -> Promise<boolean>
VRThumbs.gc()                 -> Promise<{removed:number, kept:number}>
// 清理 _library/thumbs/ 里没有任何 index.json 条目引用的孤儿文件。
```

### 3.3 `VRIndex`（索引服务）

```js
// 现有（indexer.js:797-814）
VRIndex.build({ mode, onProgress })  // mode: 'downloads'|'snapshot'|'full'
VRIndex.snapshot()                   // 写按日快照，返回绝对路径
VRIndex.reconcile()                  // 核对缺失
VRIndex.status()                     // {count, missing, hasRoot, absRoot, ...}
VRIndex.resolveRoot()                // {handle, absRoot, prefix, source}
```

**新增（阶段 1/3）**：

```js
VRIndex.writeFixedSnapshot()   -> Promise<string>
// 写 <根>/_library/index.json（固定名），与 snapshot() 共用 payload 构造。
// 用 createWritable()+close()，它本身已是「临时文件 + 校验后替换」，
// 无需也无法自行实现 rename（FileSystemHandle.move() 至今未发布）。

VRIndex.readFixedSnapshot()    -> Promise<{json, at}|null>
// 读固定名快照。先试 index.json；不存在则回退 latestSnapshot()（按日）。

VRIndex.build({ mode: 'reconcile' })  // 新增 mode
// 先读 index.json 出画面，再只 stat 差异项对账，不遍历整个目录树。
```

### 3.4 快照写入的原子性（结论与依据）

**红队原判断**：固定名覆盖写有「写一半崩溃毁掉唯一副本」风险，需临时文件 + rename。

**检索更正**：MDN 明确说明 FSA 写入用户可见文件系统时
「writes are **not in-place**, and instead use a **temporary file**.
The original is not modified unless it passes all security checks.」
（出处：MDN *Origin private file system* 导言段）

而 `FileSystemHandle.move()` 在 chromestatus 上至今
`status="In development"`、`is_released=false`、无 milestone——
**标准 API 没有 rename，外部也做不到手工 rename**。

**最终方案**：
1. `createWritable()` + `write()` + `close()` 本身即原子替换，**直接用**；
2. **不用 `keepExistingData: true`**（那是「就地修改」，反而破坏原子性）；
3. 写失败时 `abort()`，并**保留上一份 `index.json` 不动**（因为从未被修改）；
4. 兜底：`readFixedSnapshot()` 解析失败时自动回退按日快照。

---

## 四、关键流程

### 4.1 下载入库 → 写快照（阶段 1 核心）

```
VRSave.writeFsa 成功
  → VRLib.ingestDirect(info)              ← 现状已有（sw-library.js:134）
  → VRDB.putFiles([item])                 ← 现状已有
  → 【新增】scheduleFixedSnapshot()       ← 节流 30s 合并
       └→ VRIndex.writeFixedSnapshot()
            ├ 读 VRDB.getAllFiles()
            ├ 读 VRDB.getSetting('vrFavs')
            └ 写 _library/index.json
```

**为什么节流**：每次入库都写 8MB（2 万条）会拖慢批量下载。
30s 窗口内多次入库合并为一次写入；页面关闭/浏览器退出前不掉数据
（因为 IDB 才是即时真相，快照是派生）。

### 4.2 打开资源库 → 出画面 → 对账（阶段 3）

```
① VRIndex.readFixedSnapshot()
   ├ 成功 → 渲染（不等扫描）
   └ 失败/不存在 → 回退 VRIndex.build({mode:'snapshot'}) 或 'downloads'
② 后台 VRIndex.build({mode:'reconcile'})
   ├ 遍历目录树，但每个文件只 getFileHandle（不读内容）
   ├ 与快照比对 mtime/size → 差异项才更新
   └ 完成后 rewriteFixedSnapshot()
③ 缩略图按视口懒生成（沿用 thumbs.js 现有队列）
```

**与现状的关键差异**：
现状 `walk()` 在 `indexer.js:542` 对每个文件调 `h.getFile()`（读完整元数据对象），
新流程只 `getFileHandle()` 判存在 + 在需要时取 `getFile()` 拿 size/mtime。
对 1 万条可显著减少 FSA 调用次数。

### 4.3 重装系统后的恢复路径（用户真正关心的）

```
重装前：index.json 已在磁盘（含收藏夹/改名/标签/缩略图引用）
   ↓
重装后：装扩展 → 打开资源库 → 授权目录
   ↓
① 读 index.json  → 立刻看到全部条目与整理成果
② 读 _library/thumbs/*.webp → 缩略图直接显示，无需重新解码
③ 后台 reconcile → 校正磁盘实际存在的文件
```

**关键点**：`root` 字段必须被消费。
现状写入 `payload.root`（`indexer.js:741`）但**全仓库无任何代码读取它**
（红队发现 a-2），重装后路径仍依赖 `chrome.storage.detectedRoot`。
本规格要求：`resolveRoot()` 在 `absRoot` 为空时回退读 `index.json` 的 `root` 字段。

---

## 五、迁移步骤（新老数据兼容）

### 5.1 存量用户升级（IDB v1 已有数据）

| 步骤 | 动作 | 是否破坏数据 |
|---|---|---|
| M1 | 部署新代码，`DB_VERSION` 保持 `1` | 否 |
| M2 | 首次打开 → 检测 `index.json` 不存在 | 否 |
| M3 | `writeFixedSnapshot()` 生成第一份固定快照 | 否（只读 IDB） |
| M4 | 缩略图：存量条目 `thumbFile` 为空 → 视口触发时补生成并落盘 | 否 |
| M5 | 可选：`VRThumbs.backfill()` 批量补落盘（后台低优先级） | 否 |

**不做数据迁移脚本**：`index.json` 是**派生数据**（IDB 才是主），
生成它不需要改动任何现有记录。这是本设计最重要的安全属性。

### 5.2 IDB schema 是否升版

**结论：不升版（保持 `DB_VERSION = 1`）**。

理由：新增的 `thumbFile`/`thumbSrc`/`displayName` 等都是**条目上的普通属性**，
IDB 是 schemaless 的（`file` store 只有 `keyPath: 'relPath'`，
不声明固定字段），加字段无需 `onupgradeneeded`。

**唯一例外**：若将来要让 `thumbFile` 可索引，才需升 v2 并加 `createIndex`。
现阶段用不到。

### 5.3 回滚方案

若阶段 1 出问题：
1. 删掉 `_library/index.json`（它是派生文件，删了不影响任何现有功能）；
2. 恢复旧代码即可；
3. IDB 从未被改动，`snapshot()` 的按日快照逻辑也未变。

---

## 六、验收标准

每条都可机械执行，不依赖主观判断。

### 6.1 阶段 1：快照补全 + 自动化

| # | 用例 | 通过标准 |
|---|---|---|
| A1 | 加星标 + 加 2 个标签 + 改名 + 建 1 个收藏夹 → 触发快照 | `index.json` 中存在 `starred:1`、`tags` 长度 2、`displayName`、`favorites` 非空 |
| A2 | 清空 IDB 后 `build({mode:'snapshot'})` | 上述 4 项**全部恢复** |
| A3 | 下载 1 张图 → **不回设置页** → 重新打开资源库 | 能看到这张新图（验证快照自动化） |
| A4 | 连续下载 10 张 → 观察写入次数 | 30s 窗口内合并，`index.json` 的 `at` 变化次数 < 10 |
| A5 | 删除 IDB 中的 `chrome.storage.detectedRoot` 后打开 | 能从 `index.json` 的 `root` 恢复路径，仍能浏览 |

### 6.2 阶段 2：缩略图落盘

| # | 用例 | 通过标准 |
|---|---|---|
| B1 | 生成一张缩略图 | `_library/thumbs/<16hex>.webp` 存在且 size > 0 |
| B2 | 清空 IDB 的 `thumb` store → 重新打开 | 缩略图从磁盘**直接显示**，无重新解码（Network/CPU 无尖峰） |
| B3 | 改名一个文件 | 旧 hash 文件被删除，新 hash 文件生成（**无孤儿**） |
| B4 | 删除一个文件 | 对应 `.webp` 被删除 |
| B5 | 手动在 `thumbs/` 放一个无主 webp → 跑 `gc()` | 该文件被清除 |
| B6 | 修改源文件 size 但保持 mtime（或反之） | 缩略图判定失效并重建（验证 mtime+size 双校验） |

### 6.3 阶段 3：扫描策略

| # | 用例 | 通过标准 |
|---|---|---|
| C1 | 1 万条库冷启动 | 出画面 < 1s（首屏不等对账完成） |
| C2 | 新增 1 个文件后打开 | 对账只处理该文件（FSA 调用数 ≈ 1，非全量） |
| C3 | 库超过 `MAX_ITEMS` | **明确提示**「已扫描 N 条，超出上限 M 条未纳入」，不静默 |
| C4 | 目录深度超过 `MAX_DEPTH` | 同样明确提示，不静默丢 |
| C5 | 对账时某文件被占用 | 记为 unknown，**不**标 missing（沿用 ADR-030） |

### 6.4 回归（必须全绿）

```bash
node tools/test-path.js
node tools/test-save.js
python tools/cdp-index-test.py      # 35/35 现有索引用例
python tools/cdp-run.py --suite library
```

---

## 七、错误码约定（沿用现有风格）

| 码 | 触发 | 用户可见文案 |
|---|---|---|
| `LIB_E_NO_PERM` | 无目录句柄 | 需要一次目录授权 |
| `LIB_E_NO_SNAPSHOT` | `_library/` 无任何快照 | 还没有索引快照 |
| `LIB_E_SNAPSHOT_PARSE` | 快照 JSON 损坏 | 快照损坏，已回退更早的 |
| `LIB_E_TRUNCATED` | 【新增】超 `MAX_ITEMS`/`MAX_DEPTH` | 已扫描 N 条，超出 M 条未纳入 |
| `LIB_E_THUMB_DISK` | 【新增】缩略图落盘失败 | 缩略图未能保存到磁盘（不影响浏览） |
| `SAVE_E_*` | 见 `save.js:30-41` | 不变 |

**原则**：缩略图落盘失败**永不阻断浏览**，静默降级到「本次会话内生成」。

---

## 八、明确不做（与本规格的边界）

| 不做 | 理由（含实测/检索依据） |
|---|---|
| 本地 HTML 版资源库 | 它读同一份快照，救不了收藏夹/缩略图；且 `file://` 下画布污染使缩略图全灰（T15/T16） |
| 自行实现「临时文件 + rename」 | `FileSystemHandle.move()` 在 chromestatus 上仍是 `In development`，标准 API 无 rename；而 `createWritable()` 本身已是临时文件+替换 |
| 依赖 `FileSystemObserver` 做唯一增量来源 | 提案原文明确「cannot guarantee that changes are not missed」，且事件会被 coalesce/rate-limit、有 per-origin 上限；MV3 的 SW 生命周期短，不能长期持有观察 |
| 引入 SQLite / WASM | 明文 8MB / 580ms 已满足；WASM 增约 1.5MB 且需放宽 CSP 到 `wasm-unsafe-eval`（MV3 允许但无必要） |
| 引入 `thumbhash` | 它是「10KB 级占位图 hash」（用于图片加载前的模糊占位），与「缩略图落盘」不是同一层问题 |
| gzip + base64 压缩快照 | 压缩是为绕过 `file://` 页 `fetch` 不可用（T6/T7）而做的妥协；本方案不依赖 `file://` 页，无需压缩 |
| 升 IDB 版本做数据迁移 | `index.json` 是派生数据，IDB 是主；生成派生文件不需要改任何现有记录（§5.2） |

---

## 九、与现有代码的对应关系（接手速查）

| 关注点 | 文件:行 | 说明 |
|---|---|---|
| 快照写入 | `js/library/indexer.js:730-775` | `snapshot()`，阶段 1 在此扩展 |
| 快照读取 | `indexer.js:468-492` | `latestSnapshot()`，按 `SNAP_RE` 找最新 |
| 快照解析 | `indexer.js:494-523` | `scanSnapshot()`，阶段 1 在此补字段还原 |
| 用户数据保留 | `indexer.js:390-420` | `mergeEntry()` 白名单，B-07 的 `pageUrl` 缺口在此 |
| 扫描上限 | `indexer.js:26-28` | `MAX_ITEMS=20000` / `MAX_DEPTH=8` / `DL_LIMIT=5000` |
| 遍历实现 | `indexer.js:527-548` | `walk()`，每个文件 `getFile()`（阶段 3 优化点） |
| 根路径解析 | `indexer.js:156-208` | `resolveRoot()` 三档：内存→VRDB→旧授权库 |
| 缩略图生成 | `js/library/thumbs.js:125-210` | `toCanvas` / `canvasToBlob` / `generate` |
| 缩略图键 | `thumbs.js:186` | `'t:' + relPath`（阶段 2 改为 hash 文件名） |
| 缩略图存储 | `js/library/db.js:145-160` | `putThumb` / `getThumb`，无 delete |
| IDB schema | `js/library/db.js:17-58` | `DB_VERSION=1`，5 个 store |
| 下载入库 | `js/library/sw-library.js:134` | `ingestDirect()`，阶段 1 在此挂钩 |
| 写队列 | `sw-library.js:24,291` | `writeQueue` 串行化（并发已统一） |
| 删除/改名/移动 | `trash.js:220` / `rename.js:260` / `move-picker.js:195` | 三处都置空 `thumbKey`，阶段 2 需同步删磁盘缩略图 |
| 目录跳过表 | `indexer.js:30` | `SKIP_DIRS` 已含 `_library`，新增子目录自动免扫 |

---

## 十、变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-07 | 首版。合并红队审查 14 项发现 + 联网检索 5 项结论，修正 3 处原设计错误（原子写、observer 定位、缩略图失效判定） |
