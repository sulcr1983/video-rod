# video-rod 全面盘点 · 2026-11-06

> 范围：文档、代码、未提交改动、测试基线、真实库状态、原型符合度、外部可复用方案。
> 本轮**没有修改任何代码**，没有执行破坏性测试，没有 `push`。
> 结论以「仓库代码 + 9480 真机只读探测 + 现有测试产物」为依据；推断项单独标注，未验证项不写成结论。

---

## 0. 一句话结论

**主链路是通的，资源库“看起来有内容但用不了”的主要原因是测试污染和几个未闭环的集成点，而不是首屏渲染或数据库能力。**

- 当前 45 条库记录里只有 **35 条真实文件**；另外 **10 条是 e2e-buttons 种入的假数据**，其中 9 条还标着 `state=ok`，`absPath` 指向不存在的 `D:/f/*`。
- 假数据 `mtime` 最新，默认排序又**真的坏了**，所以首屏正好被假数据占满；用户看到的是一屏打不开的卡片。
- 本轮新增的「移动到…」调用了**未导出的 `VRTrash.moveFile`**，运行时是 `undefined`，即使有目录授权也必然失败。
- 重命名只写 `displayName`，但 `indexer.mergeEntry` 不保留该字段；**重扫后名字会丢**，列表视图还继续显示物理文件名。
- 当前 `VRIndex.resolveRoot()` 返回 `hasHandle:false`；删除/移动没有目录授权，页面也没有“只读模式”提示。
- 全量回归 `e2e-all` 会运行 `e2e-buttons`，而它会 **`deleteFiles(全部)` 后种入 10 条假数据**；越跑回归，库越脏。这是“检查很多次仍不能用”的核心流程原因。

---

## 1. 仓库、环境与基线

### 1.1 仓库状态

| 项 | 实测 |
|---|---|
| 最后提交 | `1e8d032`（播放器改用成熟开源方案 + 苏哥追加 7 条 bug） |
| 未提交 | **25 个路径** = 17 个已修改（`M`）+ 8 个未跟踪（`??`） |
| 交接文档说法 | “17 个文件未提交”只对应 `M` 的文件数，未算 8 个新增测试/文档 |
| 空白检查 | `git diff --check` 通过（只有 LF→CRLF 警告） |
| push | 未 push |

**17 个 `M`**：`js/background.js`、`js/bulk-profile.js`、`js/image-batch.js`、`js/image-hover.js`、`js/image-panel.js`、`js/library/app.js`、`js/library/lightbox.js`、`js/library/path.js`、`js/library/ui.js`、`js/yt/yt-download.html`、`js/yt/yt-download.js`、`js/yt/yt-page.js`、`library.html` + 4 个测试产物（3 张 PNG、`session-log.json`）。
**8 个 `??`**：`docs/HANDOFF-2026-11-06.md`、`deliverables/reviews/.../2026-11-05-bug反馈诊断与验收.md`、2 个 `test-runs/*.md`、2 个 `test-runs/*.json`、`tools/library-buttons-e2e.py`、`tools/library-functions-e2e.py`。

### 1.2 运行环境

| 项 | 实测 |
|---|---|
| 浏览器 | Edge `156.0.4314.58`，调试端口 `9480` 在线 |
| 扩展 ID | `ceogmckiinjolbbdkjfelmfcfepccabp` |
| 扩展版本 | 2.7.2.1 |
| 库根 | `D:\personal\Downloads\video-rod`（页面 `#rootBtn` 显示正确） |
| 旧 F 盘 | `F:\download\video-rod` **不存在**；当前设置没有指回 F 盘 |
| `resolveRoot()` | `absRoot=D:/personal/Downloads/video-rod`、`prefix=video-rod`、`source=settings`、**`hasHandle=false`** |
| 文件访问 | `chrome.extension.isAllowedFileSchemeAccess() = true`（当前 profile） |
| 启动埋点 | `window.__vrBoot = ["start","bind","bindMissing","favs","root","load:45"]` |
| DOM 卡片 | 45 张（含 10 条假数据） |

### 1.3 测试基线（沿用最新产物，未重跑）

| 套件 | 结果 | 说明 |
|---|---|---|
| `e2e-all` | **7/8** | 唯一失败 `download-path 6/10` |
| `library-functions-e2e` | **42/44** | 失败：排序、Plyr |
| `library-buttons-e2e` | **93 项 / 85 点击 / 0 异常** | 58 项 `changed:false`，不等于功能有效 |
| `download-path` | **6/10** | 测试先断言“无目录授权”，却又断言完整路径；是平台限制，不是本轮回归 |

> **本轮没有重跑 `e2e-all`**：`e2e-all` 包含 `e2e-buttons`，而 `e2e-buttons` 会清空真实索引并种入假数据（见 §4.1）。在隔离修好之前，重跑基线会再次破坏用户库。

---

## 2. 当前可用功能与问题清单

### 2.1 已确认可用

| 能力 | 状态 | 证据 / 边界 |
|---|---|---|
| 下载 → 归档 → 入库 | ✅ 主链路可用 | 35 条真实文件 `absPath` 均存在；下载记录可入库 |
| 资源库首屏启动 | ✅ 已修复 | `__vrBoot` 完整走到 `load:45`，`bind()` 不再中断 |
| 平台树 / 类型页签 / chips / 搜索 | ✅ 基本可用 | 45 张卡片、树计数、chip 过滤可响应 |
| 网格 / 列表切换 | ✅ UI 可切换 | 列表数据列可用 |
| 真实图片缩略图 | ✅ 链路可用 | 手动 enqueue 真实图片生成成功（225×400 blob） |
| 真实图片预览 | ✅ 可用 | 真实图片在预览层以 `file://` 加载成功（675×1200） |
| 真实视频预览 / Plyr | ✅ 播放器链路存在 | 真实 YouTube 视频打开后 `video` 存在、`.plyr` 存在、16 个控件 |
| 单条删除（回收站） | 🟡 代码已接 | 依赖 FSA 目录授权；当前无 handle，实际会提示授权 |
| 批量选择 / 全选 / 反选 | ✅ UI 可用 | 功能级 e2e 通过 |
| 标签加/删 | ✅ UI 可用 | 功能级 e2e 通过；但会写真实库，未清理 |
| 收藏夹菜单/抽屉 | 🟡 部分验证 | 只验证了打开；加入/移除/新建的持久化未完整验证 |
| 重命名（显示名） | 🟡 立即生效 | 网格/预览显示新名；重扫后会丢（见 §4.4） |
| 批量“移动到…” | ❌ 实际不可用 | 调用未导出的 `VRTrash.moveFile`（见 §4.3） |
| 批量“删除到回收站” | 🟡 代码已接 | 无 handle 时不可用；破坏性未 e2e |
| YouTube 后台合并/进度/声音 | ⚪ 未真机复验 | 仅代码层，见 §5.3 |
| X 批量 URL 修复 | ✅ 代码正确 | `format=jpg&name=orig` 保留；本轮未重跑真实站点 |
| 微博批量通用扫描 | ✅ 代码层 | 旧 `.wb-item` 改为通用 img 扫描；未重跑真实站点 |

### 2.2 问题清单

#### P0（直接影响“能不能用”）

| # | 问题 | 影响 |
|---|---|---|
| P0-1 | **e2e-buttons 每次清空索引并种 10 条假数据** | 全量回归越跑库越脏；45/45 卡片是假象；首屏被假数据占满 |
| P0-2 | **排序完全失效** | `S.sort` 初始 `'new'`，`#sort` change 只 `render()`；切 A-Z/大小顺序不变 |
| P0-3 | **批量“移动到…”必然失败** | `app.js` 调 `VRTrash.moveFile`，但 `trash.js` 没有导出；即使授权也报错 |
| P0-4 | **重命名不持久** | `displayName` 未进 `mergeEntry` 白名单；重扫/重建索引后名字回退 |
| P0-5 | **无目录授权 / 无只读提示** | 删除、移动无法执行；页面仍显示可用按钮，用户只看到“失败” |
| P0-6 | **测试断言覆盖不到真实结果** | 只测卡片数/点击，不测 `absPath` 存在、媒体真正加载、排序结果、重扫后名字 |

#### P1（影响体验/数据质量/验证可信度）

| # | 问题 | 影响 |
|---|---|---|
| P1-1 | 首屏缩略图大量为空 | 首次探测时 45 张里 39 张 `naturalWidth=0`；其中前 10 张是假数据，真实图需进入视口才生成；没有“失败/缺失”状态 |
| P1-2 | 真实条目历史命名差 | 35 条真实记录 `title` 均为空，卡片回退文件名；存在 `待整理`、`20261105_@... 的个人主页`、`20261105_图片`、`微博 – 随时随地发现新鲜事` 等 |
| P1-3 | YouTube 自动模式未真机验证 | 自动选最高、进度、音轨、关标签均只有代码层；`autoTimer` 无超时，`window.close()` 可能关不掉 `chrome.tabs.create` 的标签 |
| P1-4 | 批量删除未做破坏性验证 | 回收站真实链路未在 e2e 跑过；删除后 UI 的批量态也未验证完全退出 |
| P1-5 | 收藏夹持久化未完整验证 | 新建/加入/移除/重建索引后是否保留，缺断言 |
| P1-6 | Plyr e2e 选中假视频卡 | 测试先点第一张 `.is-video`，当前首屏是假数据；真实视频需单独选卡 |
| P1-7 | `file://` 依赖未做降级 | 当前 profile 允许文件 URL；新 profile 默认不允许时，缩略图/预览会静默失败，没有提示 |
| P1-8 | 根路径历史遗留 | 当前 D 盘正确，但 `F:\download\video-rod` 不存在；旧 `detectedRoot` 若回退会重现“扫不到文件” |

#### P2/P3（工程债/边界）

| # | 问题 | 说明 |
|---|---|---|
| P2-1 | 批量失败数可能重复计数 | `vrBulkDownload` 中 `hardFail++` 后又 `failed++`，返回 `failed: failed + hardFail`，内容错误会被算两次 |
| P2-2 | 批量删除后 UI 状态 | `S.select=false`/`S.sel.clear()` 后未显式隐藏 `#batchbar`、移除 `#selectBtn.is-on`，依赖后续 render |
| P2-3 | 列表视图不显示 `displayName` | `ui.js` 的 `cardHtml`/`rowHtml` 用 `fileName(e)`，与网格视图不一致 |
| P2-4 | 93MB 视频首帧仍可能失败 | 30 秒超时对 moov 在尾部的大文件不一定够；保留占位是正确策略，但需失败态 |
| P2-5 | 测试报告编码/产物噪声 | `test-runs` 中部分中文 Markdown 在终端显示乱码；PNG/session-log 变更增加提交噪声 |
| P3-1 | TikTok 403 / B站 blob / IG 登录态 | 站点侧限制或浏览器手势限制，非通用通道缺口 |
| P3-2 | C1–C5 待拍板 | chips/seg 增项、计数重复、圆角文档冲突、三线对齐 |
| P3-3 | `window.__vrBoot` 调试钩子 | 建议保留用于诊断，或加 debug 开关；不要作为用户功能 |

---

## 3. 原型与实际页面的差异

### 3.1 DOM/结构

| 项 | 结果 |
|---|---|
| 原型 `id` 数 | 228 |
| 实际 `id` 数 | 236 |
| 实际缺少 | `crumbBack`、`pvAuthorRetry`、`themeBtn` |
| 实际多出 | `batchMove`、`fDedup`、`pvSrcGroup`、`sdDirBtn`、`sdDirVal`、`sdIndexVal`、`sdOptionsLink`、`sdRebuildBtn`、`sdScanBtn`、`sdScanVal`、`sdTrashBtn`、`sdTrashVal` |
| 说明 | `themeBtn` 是 T4 明确退役的亮色主题按钮，缺失属预期；`crumbBack`/`pvAuthorRetry` 是次级差异；设置抽屉多出的 ID 是真实功能扩展 |

**结论：视觉/DOM 复刻度高，但“结构在”不等于“功能在”。**

### 3.2 功能语义差异

| 功能 | 原型行为 | 实际行为 | 判定 |
|---|---|---|---|
| 排序 | `#sort` 只有 `change→render`；`filtered()` 内**没有排序逻辑** | 新增了 `sorted()`，但 `S.sort` 固定 `'new'`，切换无效 | **两边都是“控件在、排序不成”**；实际更接近“实现了但没接线” |
| 批量“移动到…” | 按钮没有 `id`/handler，纯装饰；`pvMove` 明确 toast「原型未启用」 | 加了 `batchMove` + 真实实现，但调用未导出的 `VRTrash.moveFile` | 原型不是“有设计”，实际也仍是死键；交接文档的“原型有设计”表述不准确 |
| 批量删除到回收站 | mock `TRASH` 数组 | 接真实 `VRTrash.remove()` | 方向正确；但无 handle 不可用，破坏性未验证 |
| 重命名 | 改 `id`/目录，物理路径语义 | 只写 `displayName`（ADR-050 R2） | **有意偏离**；但网格/列表/排序未统一，用户会看到“两个名字” |
| 设置抽屉 | 原型未完整实现 | 真实换目录入口、扫描、重建、回收站 | 实际更完整；但“更换目录”按钮实际是打开完整设置页，不是直接授权当前目录 |
| 主题 | 有 `themeBtn` | 已移除 | 有意差异（T4） |

---

## 4. 根因、影响范围与需要复核的结论

### 4.1 P0-1：e2e-buttons 清空真实索引并种假数据（已确认）

代码位置：`tools/e2e-buttons.py:26-42`：

```js
await VRDB.deleteFiles((await VRDB.getAllFiles()).map(f => f.relPath));
await VRDB.putFiles(rows);   // 10 条 D:/f/* 假数据
```

- `e2e-all.py` 的 `SUITES` 包含 `e2e-buttons`，所以每次全量回归都会执行。
- 当前库的 10 条假数据与 SEED **逐条对应**：`旅行日记`、`第二集`、`咖啡`、`面包`、`长视频`、`晚安`、`街拍`、`丢失`、`折多山`、`reel`。
- 其中 9 条 `state:'ok'`，但 `absPath` 是 `D:/f/a.mp4` 之类，磁盘不存在；1 条 `state:'missing'`。
- `deleteFiles` 只删 **IndexedDB 索引**，不删磁盘文件；所以不会丢用户原文件，但会丢用户的收藏/标签/显示名/索引状态（因为整表被清）。
- `library-functions-e2e.py` 还会在真实库上写 `displayName='功能测试改名'`、加/删 `e2e标签`，且没有 `finally` 清理；JSON 里能看到 `phys:"晚安.mp3"` 的记录被改名。

**影响范围**：每次 `e2e-all` 后，真实库索引被清空；用户再点“重新扫描”会把 35 条真实记录加回来，与 10 条假数据混合 → 45 条。假数据 `mtime` 最新，默认 `new` 排序把它们排在最前。**这正好解释“卡片 45/45、首屏却打不开”。**

**需要复核**：`e2e-buttons` 是否应在 `finally` 里恢复原索引；是否有其他套件也 `deleteFiles(all)`（`stage-rewrite-test.py`、`cdp-library-page-test.py` 也需要审计）。

### 4.2 P0-2：排序是产品真 bug，不是测试脚本问题（已确认）

代码路径：

- `js/library/app.js:28-30`：`S = { type:'all', plat:'all', q:'', view:'grid', select:false, sel:new Set(), sort:'new', ... }`
- `js/library/app.js:161-170`：`var s = (S.sort || $('#sort') && $('#sort').value || 'new');` —— `S.sort` 初始非空，永远短路，读不到 `<select>` 的当前值。
- `js/library/app.js:587`：`sort.addEventListener('change', function () { render(); });` —— 只重绘，不更新 `S.sort`。

真机验证：把 `#sort` 从 `new` 切到 `name`、`size`，前 6 张卡片顺序**完全不变**；`order0/order1` 相同。功能级 e2e 的失败是**真实失败**，不是测试脚本问题。

补充：原型 `filtered()` 里也没有排序逻辑，`#sort` 只是 `change→render`。所以“原型有排序设计”本身也不成立；实际页面是“有 `sorted()` 函数但没接线”。

**修复要点**：`S.sort = sort.value; render();`；初始化时从 `#sort` 读；`name` 排序用 `_title || title`；用真实数据写断言（至少 3 条名字/大小/时间不同的真实行）。

### 4.3 P0-3：批量“移动到…”是死键（已确认 + 代码推断）

- `js/library/app.js:1101-1145` 新增 `#batchMove`，核心调用：
  ```js
  await root.VRTrash.moveFile(rr.handle, f.relPath, newRel);
  ```
- `js/library/trash.js` 末尾导出的是：
  ```js
  root.VRTrash = { TRASH_DIR, remove, list, status, restore, purge, empty, resolveRoot };
  ```
  **没有 `moveFile`**。真机执行 `typeof VRTrash.moveFile` 返回 `"undefined"`。
- 因此即使 `rr.handle` 存在，`moveFile(...)` 也会抛 `TypeError`，被 `catch` 计为 `failN`，最后 toast「移动完成：0 项，失败 N」。**这是“多次检查后仍无法真正使用”的典型：代码看起来补了，但集成点没通。**

即使补上导出，仍有三个问题（🟡 代码推断，需授权后真机确认）：

1. `newRel = 'video-rod/' + dest + '/' + name` 会丢掉原平台/作者/类型目录，所有文件被拍平到目标目录。
2. `absPath = rr.absRoot + '\\' + newRel`：当前 `rr.absRoot = D:/personal/Downloads/video-rod`，`newRel` 以 `video-rod/` 开头 → **`...\video-rod\video-rod\...` 双重前缀**。
3. `VRTrash.moveFile` 没有 `ensureRW`；`batchMove` 只检查 `rr.handle` 是否存在，没有检查/请求写权限；目标同名文件会被 `createWritable` 直接覆盖，没有冲突确认；DB 先 `deleteFiles` 后 `putFiles`，中间失败没有回滚。

**验收前必须补**：导出 API、`ensureRW`、路径相对前缀、`absPath` 正确拼接、同名冲突策略、失败回滚、真实临时目录测试。

### 4.4 P0-4：重命名不持久（已确认）

- `js/library/app.js:893`：`await root.VRDB.patchFile(renRel, { displayName: v });`
- `js/library/indexer.js:246-270` 的 `mergeEntry(old, item)` 白名单保留 `starred/tags/thumbKey/width/height/duration/title/platform/...`，**没有 `displayName`**。
- `js/library/ui.js:350-374` 的 `cardHtml/rowHtml` 用 `fileName(e)`，列表视图不读 `displayName`。
- `js/library/app.js:167` 的 `name` 排序用 `a.title`，不是 `_title`。

结果：网格/预览立即显示新名；**重扫/重建索引后 `displayName` 丢失**，名字回退；列表视图从头到尾显示物理文件名。功能级 e2e 只验证“改名后 DB 有 displayName、relPath 不变”，没有验证重扫后仍保留。

**影响**：用户会认为“重命名没生效/时好时坏”；这是数据持久化缺口，不是 UI 小问题。

### 4.5 P0-5 / P1-7：目录授权与 `file://` 依赖（已确认）

- `VRIndex.resolveRoot()` 返回 `hasHandle:false`；当前库根 D 盘正确，但写操作没有句柄。
- `VRTrash.remove()` 会 `ensureRW(rr.handle)`，无 handle 时明确报 `LIB_E_NO_PERM`；`batchMove` 的 `moveFile` 连 `ensureRW` 都没有。
- 页面没有“只读模式/未授权”横幅；批量条和单条删除按钮看起来都可点，失败后才告诉用户。
- `sdDirBtn`（设置抽屉里的“更换目录”）实际调用 `openOptions()` 打开完整设置页，不是直接对当前目录授权；`batchMove` 的提示“设置 → 保存位置”与这个按钮文案不一致。
- 当前 profile 的 `isAllowedFileSchemeAccess=true`，所以 `file://` 缩略图/预览可用；新 profile 默认可能为 `false`，届时所有 `file://` 媒体静默失败，页面没有检测/提示。
- `download-path 6/10` 的测试前提也是“无目录授权”，却断言完整路径；这是平台限制（Chrome 147+ 在无 FSA 时忽略 `filename`），不是本轮代码回归。

**建议**：增加 `isWritable` 状态；无权限时禁用删除/移动并显示原因；提供“授权当前目录”按钮；检测 `isAllowedFileSchemeAccess`，或在有 handle 时用 `getFile()` + blob URL 替代 `file://`。

### 4.6 P0-6：测试设计为什么没抓到这些问题

| 测试 | 覆盖了什么 | 没覆盖什么 |
|---|---|---|
| `library-buttons-e2e` | 93 个按钮存在、85 次点击、0 JS 异常 | 58 项 `changed:false`；破坏性操作跳过；不验证数据/媒体是否真的可用 |
| `library-functions-e2e` | 44 条功能断言 | 排序断言失败被当成测试问题；Plyr 选了假视频卡；改名不测重扫；不清理写库 |
| `e2e-buttons` | 资源库/设置页按钮 | **先清空再种假数据**；断言在假数据上通过 |
| `download-path` | 无授权下载路径 | 前提与断言矛盾；没有授权后的 10/10 用例 |
| 首屏验证 | `__vrBoot` + 45 卡片 | 没验证 45 条是否真实、首屏是否可点开、缩略图是否加载 |

**流程根因**：每次“检查”都在验证 DOM/计数/即时写入，而不是验证“真实文件能否打开、操作后是否持久、回归后数据是否还在”。测试自己还会改库，导致下一轮诊断看到的是测试留下的世界。

### 4.7 需要复核的结论（明确标注可信度）

| 结论 | 可信度 | 复核方式 |
|---|---|---|
| 45 条 = 35 真实 + 10 假 | ✅ 已确认 | `absPath` 逐条 `os.path.exists`；与 `e2e-buttons` SEED 逐条对应 |
| 首屏被假数据占满 | ✅ 已确认 | 默认 `new` 按 `mtime`；假数据 mtime 最新；前 10 张标题即 SEED |
| 排序失败是产品 bug | ✅ 已确认 | 代码 + 真机切换顺序不变 |
| Plyr 失败是“选了假视频卡” | ✅ 已确认主因 | 真实视频卡有 `video`/`.plyr`/16 控件；假卡无文件 |
| 真实图片缩略图/预览链路可用 | ✅ 已确认 | 手动 enqueue 成功 225×400；预览 675×1200 |
| 批量移动即使授权也失败 | ✅ 已确认 API 未导出 | `typeof VRTrash.moveFile === "undefined"` |
| 批量移动 absPath 双重前缀 | 🟡 代码推断 | 补导出 + 授权临时目录后真机验证 |
| 重命名重扫后丢失 | 🟡 代码推断（`mergeEntry` 未保留） | 改名 → `VRIndex.build({mode:'downloads'})` → 再读 |
| YouTube 自动模式可用 | ⚪ 未验证 | 真机 watch 页下载一条 1080p+，查音轨/进度/关标签 |
| 批量删除可恢复 | ⚪ 未验证 | 临时目录删除 2 条、恢复 1 条、彻底删 1 条 |
| 93MB 视频首帧 | ⚪ 未验证 | 用现有 93MB 文件重试缩略图 |
| F 盘问题已解决 | ✅ 当前正确 | 页面显示 D 盘；F 盘不存在；仍需防止旧设置回退 |

---

## 5. 外部可复用组件与成熟方案

> 原则：项目是**零构建、原生 JS、MV3 扩展**，优先原生能力和小依赖；不为了“先进”引入重框架。

### 5.1 建议直接采用（低成本/原生）

| 方案 | 用途 | 理由 |
|---|---|---|
| **IndexedDB 索引分页** | 用现有 `mtime`/`platform`/`type` 索引 + `openCursor`/`getAll(query, count)` 取代全量 `getAllFiles()` | 5 万条 `getAll` 833ms；首屏只需要 100–200 条；数据库本身不是瓶颈（`READINESS-20261104.md`） |
| **`content-visibility: auto` + `contain-intrinsic-size`** | 先降低离屏卡片布局/绘制成本 | Baseline 2024；不需要框架；用在分组/行容器上，先测量再决定是否逐卡应用 |
| **`createImageBitmap` + `OffscreenCanvas`** | 缩略图解码/缩放 | 原生、可在 Worker 中做；现有 `toCanvas` 可替换为 OffscreenCanvas，减少主线程卡顿 |
| **OPFS（`navigator.storage.getDirectory()`）** | 大量缩略图 blob 缓存 | 比 IDB blob 更适合文件型缓存；当前 34 张不必迁移，5 万张时作为选项 |
| **File System Access 权限流程** | `showDirectoryPicker` + `queryPermission`/`requestPermission` + handle 存 IDB | 原生；解决“无 handle”与授权文案；写操作必须在用户手势中请求 |
| **`chrome.extension.isAllowedFileSchemeAccess()` 检测** | 判断 `file://` 是否可用 | 当前 profile 为 true，新 profile 可能 false；false 时显示明确提示或改用 blob URL |
| **专用测试 profile / Playwright persistent context** | 隔离 e2e 数据 | 不再污染真实库；Playwright 支持 `--load-extension` 的持久化上下文；或继续 CDP 但用独立 `--user-data-dir` |

### 5.2 可评估引入（小依赖/局部替换）

| 方案 | 用途 | 评估 |
|---|---|---|
| **TanStack Virtual**（headless、framework-agnostic，约 10–15KB） | 真正的网格/列表虚拟滚动（lanes 支持多列） | 当前 `PAGE=120` 追加渲染仍保留全部 DOM；5 万条必须换 windowing。可 vendor 到 `js/lib/`，不引入构建 |
| **mp4box.js** | 解析 MP4 moov/轨道，辅助大文件视频缩略图/时长 | 对 moov 在尾部的 93MB 文件，`<video>` 30 秒仍可能失败；MP4Box 可读取元数据/样本，但接入成本中等，先作为 fallback 评估 |
| **PhotoSwipe v5** | 图片手势缩放/画廊 | 成熟、框架无关；但当前自定义预览已支持视频/GIF/信息面板/胶片条，整体替换收益低。可作为图片缩放交互参考，不建议整包替换 |
| **ThumbHash / BlurHash** | 缩略图加载前的低清占位 | 减少布局跳动/空白；需要额外生成与存储，优先级低于“先有真实缩略图” |
| **`browser-fs-access`** | FSA 不可用时的下载 fallback | 项目只面向 Chrome/Edge，且已有下载管线；暂不需要 |
| **Dexie.js / `idb`** | IndexedDB Promise 封装 | 当前 `db.js` 已够用；迁移收益低，READINESS 明确“不换数据库” |

### 5.3 仅作架构参考（不直接复用代码）

| 项目 | 可借鉴 |
|---|---|
| **Immich**（开源照片库） | 缩略图/元数据用后台 jobs/workers 异步生成；时间线 + 虚拟滚动；大量媒体时把“生成”与“浏览”解耦。参考其 jobs/workers 设计，不需要引入其服务端 |
| **PhotoPrism** | 服务端缩略图/索引/搜索分层；本项目是本地扩展，不能照搬，但可借鉴“缩略图与元数据分离” |
| **Eagle / Billfish** | 商业素材库的密度、智能夹、缩略图缓存体验；只作 UX 基准，非开源代码 |
| **digiKam / PhotoStructure** | 本地照片库的缩略图数据库、重复检测、批量重命名；可借鉴数据模型，不引入其技术栈 |
| **TagStudio** | 标签/元数据管理模型；可参考标签分组/别名，但当前不应扩 scope |

### 5.4 明确不建议（当前阶段）

| 方案 | 原因 |
|---|---|
| **SQLite WASM / 换数据库** | 5 万条仅 20.6MB，索引查询 153ms；瓶颈是 DOM/全量渲染，不是数据库。迁移成本高、收益低 |
| **Media Chrome / Vidstack 替换 Plyr** | Plyr 已工作（16 控件、倍速、视频）；替换会引入回归，ADR-050 已否决 Media Chrome |
| **ffmpeg.wasm** | 体积大、启动慢；当前 mux.js/自绘管线已满足；大文件缩略图优先用原生/MP4Box |
| **把 FileSystemObserver 当硬依赖** | Chrome 129+ origin trial，仍是实验性/非标准；可 feature-detect 做增强，不能作为唯一刷新机制 |
| **引入 React/Vue 重写资源库** | 与零构建、现有 DOM/CSS 复刻路线冲突；问题在数据和接线，不在框架 |

### 5.5 性能路线建议（按收益/成本）

1. **先修数据与接线**：清假数据、修排序/移动/重命名；否则性能优化没有意义。
2. **首屏分页**：`getAllFiles()` → 按 `mtime` 索引取 200 条；树计数用 `count()`/索引聚合。
3. **`content-visibility`**：对日期分组/离屏行启用，先测 1k/5k 的布局时间。
4. **真虚拟滚动**：TanStack Virtual 或自写 windowing；DOM 卡片数控制在 ~100–200。
5. **缩略图管线**：下载时生成 → IDB/OPFS 缓存 → 首屏优先 → 失败态。
6. **测试隔离**：专用 profile / 备份恢复；在 CI 中禁止清空真实库。

### 5.6 参考链接

- TanStack Virtual：<https://tanstack.com/virtual/latest>
- FileSystemObserver（实验性/origin trial）：<https://developer.chrome.com/blog/file-system-observer>
- `content-visibility`（MDN）：<https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility>
- Immich Jobs & Workers：<https://docs.immich.app/administration/jobs-workers/>
- PhotoSwipe：<https://photoswipe.com>
- mp4box.js：<https://github.com/gpac/mp4box.js>
- Playwright Chrome extension testing：<https://playwright.dev/docs/chrome-extensions>
- OPFS（MDN）：<https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system>
- Plyr：<https://plyr.io>
- browser-fs-access（当前不需要）：<https://github.com/GoogleChromeLabs/browser-fs-access>
- Dexie（当前不建议迁移）：<https://dexie.org>

---

## 6. 下一步工作计划与验收标准

> 顺序原则：**先存档 → 先隔离测试/清数据 → 再修用户可见功能 → 最后做性能与真机复验**。
> 每项都必须有“可复现的命令 + 真实数据 + 前后对比”，不能只用卡片数/按钮点击证明。
> 说明：本节编号用于计划管理，与 §2 的问题编号按主题独立；跨节引用时以任务名称为准。

### P0（必须先做）

| ID | 任务 | 具体动作 | 验收标准 |
|---|---|---|---|
| **P0-0** | **创建存档 commit** | 见 §7；先提交当前代码/测试/文档，不打 tag 也可 | `git status` 只剩明确保留的测试产物；`git diff --check` 通过；未 push；commit message 标注“checkpoint，已知排序/移动/重命名问题” |
| **P0-1** | **测试隔离 + 清假数据** | `e2e-buttons` 改为“备份→种子→finally 恢复”或使用独立 profile/DB；`library-functions` 清理 displayName/tags；默认拒绝在真实库上 `deleteFiles(all)`；一次性删除 10 条假 `relPath`（不删磁盘文件） | 连续跑两次 `e2e-all`：库条目数/内容哈希前后一致；0 条 `D:/f/*`；35 条真实记录仍在；报告含备份/恢复证据 |
| **P0-2** | **修复排序** | `#sort` change 写入 `S.sort`；初始化从 select 读；`name` 用 `_title || title`；补真实数据断言 | 3 条真实数据下，`new/old/size/name` 四种排序结果正确且互不相同；切换回来恢复；e2e 不再用 4 条同标题假数据 |
| **P0-3** | **修复批量移动** | 导出 `VRTrash.moveFile` 或新增 `moveTo`；补 `ensureRW`；目标路径相对 prefix；`absPath` 正确拼接；同名冲突策略；DB 两阶段+回滚 | 在**临时测试库**里复制 2 条真实文件（不要直接动用户 35 条）移动到 `未分类`：物理文件存在、DB `relPath/absPath` 正确、缩略图可重建；再移回；无覆盖/无丢失；未授权时按钮禁用并给出可操作提示 |
| **P0-4** | **修复重命名持久化** | `mergeEntry` 保留 `displayName`；列表视图用 `displayName`；搜索/排序包含 `displayName`；补“改名→重扫→再读”断言 | 改名后网格/列表/预览一致；`VRIndex.build({mode:'downloads'})` 后仍显示新名；`relPath` 不变；物理文件不动 |
| **P0-5** | **只读/授权 UX** | 增加 `isWritable`；无 handle 时禁用删除/移动并显示横幅；“授权当前目录”按钮；检测 `isAllowedFileSchemeAccess` | 无 handle：删除/移动不可点，提示原因；授权后可用；新 profile 无文件访问时明确提示；不再出现“点了才失败” |
| **P0-7** | **清理/归一化历史数据** | 为 35 条真实记录补 `displayName`/creator（优先从文件名解析）；不物理移动，除非用户确认；`待整理` 目录只改显示名 | 尽量让 35 条标题可读；无法自动推导的列入人工确认清单；UI 不再出现 `待整理`；重扫后 displayName 保留；无物理文件改动/丢失 |

### P1（P0 完成后）

| ID | 任务 | 验收标准 |
|---|---|---|
| P1-1 | 首屏缩略图与失败态 | 35 条真实卡首屏 100% 有缩略图（2 秒内）；假/缺失显示“文件缺失”，不显示空 `src`；93MB 视频有占位；objectURL 可释放 |
| P1-2 | 分页 + 真正虚拟滚动 | 1k/5k/50k 合成数据：首屏 <200ms（5 万目标 <100ms）；DOM 卡片 ≤200；树计数/筛选/搜索正确；滚动 60fps |
| P1-3 | YouTube 真机复验 | 一条 1080p+：无弹窗；右下角进度；字节级检查 2 条 trak + `mp4a`（环境有 ffprobe 再加验）；播放有声；完成后标签关闭；失败有明确提示 |
| P1-4 | 批量删除/回收站破坏性测试 | 临时目录删除 2 条→回收站 2 条→恢复 1 条→彻底删 1 条；DB/物理/manifest 一致；无数据丢失 |
| P1-5 | X/微博批量真机复测 | 隔离库中 X 4/4 缩略图、进度、落盘；404 不触发风控；微博扫描计数 >0；不产生假数据 |
| P1-6 | Plyr 测试修正 | 选真实视频卡，等 `readyState>=1`，播放/暂停 `paused` 变化；0.1/0.2/3 倍速可见；控制台 0 错误 |
| P1-7 | 收藏夹持久化 | 新建/加入/移除/删除/重建索引后状态正确；不动物理文件 |
| P1-8 | 根路径校验 | 启动/重扫时校验 `absRoot` 存在；F 盘旧值自动修复/提示；不出现“扫不到文件” |

### P2/P3（按需）

| ID | 任务 | 验收标准 |
|---|---|---|
| P2-1 | 修复批量失败数重复计数 | 内容错误只计一次；进度 `failed` 与实际一致 |
| P2-2 | 批量删除后 UI 复位 | 退出批量态后 `#batchbar` 隐藏、`#selectBtn` 去 active |
| P2-3 | 视频缩略图 fallback | 93MB 文件 30 秒内出帧，或明确“无法生成预览”占位；不无限转圈 |
| P2-4 | 报告/产物编码与入库策略 | 测试报告 UTF-8；PNG/session-log 不作为每次提交噪声 |
| P3-1 | TikTok/B站/IG 边界 | 维持现状并在文档标注；不因单站限制阻塞通用通道 |
| P3-2 | C1–C5 设计拍板 | 由苏哥确认后再动原型/计数/圆角/对齐 |

---

## 7. 关于“先把 17 个未提交文件做成 commit 存档点”的评估

**建议：要，但把它定位为“存档点”，不是“验收通过点”。**

理由：

1. 当前 25 个路径包含 13 个代码/HTML 修复、2 个新 e2e 脚本、2 份诊断文档；这些是下一步 P0 修复的基础，先提交可避免后续改动覆盖/丢失。
2. 代码里仍有已知 P0（排序、移动、重命名持久化、测试污染）；commit message 必须写清楚“checkpoint / known issues”，避免被误认为可发布。
3. 测试产物（PNG/session-log/test-runs）与代码分开更清晰；但为了 `git status` 干净，也可以一次性提交，后续再整理。

**推荐做法（二选一）：**

### 方案 A：一个干净存档 commit（推荐给“先保命”）

```bash
git add js/ library.html tools/library-buttons-e2e.py tools/library-functions-e2e.py \
        docs/HANDOFF-2026-11-06.md docs/INVENTORY-2026-11-06.md \
        "deliverables/reviews/2026-11-05-visual-audit/2026-11-05-bug反馈诊断与验收.md"
git commit -m "checkpoint(2026-11-06): 16 条反馈修复 + 首屏空白修复（已知排序/移动/重命名待修）"
```

- 这条 commit 覆盖 **13 个代码/HTML + 2 个工具 + 3 份文档 = 18 个文件**（含本盘点报告）；核心的 17 个文件对应交接文档所说的“17 个文件”。
- 4 个测试产物（3 PNG + session-log）和 3 个 `test-runs` 文件可另做 `test-evidence` commit，或暂时保留在工作区。
- 不 push；可打本地 tag `checkpoint/2026-11-06`。

### 方案 B：一次提交全部 25 个路径

- 优点：`git status` 立刻干净，回滚点完整。
- 缺点：3 张 PNG + session-log + 测试报告增加二进制/噪声；后续 review 不易区分代码与证据。
- 若选 B，建议 commit message 明确“含测试证据”，并在下一轮把 `deliverables/test-runs` 纳入 `.gitignore` 或单独的 evidence 分支策略。

**无论哪种，commit 前必须：**

- `git diff --check` 通过（已通过）；
- 确认没有 `.work/`、`__pycache__`、临时脚本、DB 导出文件；
- 确认没有把 `D:/f/*` 假数据或用户媒体文件带进 git（它们本就不在仓库）；
- 不 push（交接文档约束）。

---

## 8. 本轮盘点证据索引

| 证据 | 位置/命令 |
|---|---|
| 交接文档 | `docs/HANDOFF-2026-11-06.md` |
| 文档可信度 | `docs/DOC-INDEX.md` |
| 就绪度/性能 | `docs/READINESS-20261104.md` |
| 原型映射 | `docs/PROTOTYPE-MAPPING.md` |
| 施工清单 | `docs/BUILD-PLAN-STAGE.md` |
| 待办真源 | `docs/BACKLOG.md` |
| 最近全量回归 | `deliverables/test-runs/2026-11-06-0020-e2e-all.md` |
| 功能级明细 | `deliverables/test-runs/library-functions-e2e.json` |
| 按钮级明细 | `deliverables/test-runs/library-buttons-e2e.json` |
| 测试假数据源 | `tools/e2e-buttons.py:26-42` |
| 排序实现 | `js/library/app.js:28-30,161-170,587` |
| 批量移动 | `js/library/app.js:1101-1145`；`js/library/trash.js` 导出表 |
| 重命名/合并 | `js/library/app.js:864-898`；`js/library/indexer.js:246-270` |
| 列表标题 | `js/library/ui.js:350-374` |
| 缩略图 | `js/library/thumbs.js:116-160`；`js/library/app.js:368-399` |
| 根句柄 | `js/library/indexer.js:152-180` |
| 原型排序/移动 | `deliverables/prototypes/media-library-stage-v1.html:2291,2949,2825-2845` |

---

## 9. 最终判断

- **可以确认的“可用”**：真实文件的浏览、预览、播放链路；首屏启动修复；X URL 修复的代码正确性。
- **不能确认的“可用”**：排序、批量移动、重命名持久化、批量删除、YouTube 后台合并、Plyr 完整播放/声音、收藏夹持久化。
- **最该先做的不是继续加功能，而是：先把测试从真实库上隔离，清掉 10 条假数据，再修排序/移动/重命名的“最后一公里”。**
- **“45/45 卡片”不能作为验收口径**；应改为“35/35 真实文件可打开、可预览、可播放，操作后重扫仍保持”。
