# 原型复刻施工规范 · PROTOTYPE-MAPPING v2.0

> 版本：v2.0（**重写**）｜ 日期：2026-11-05 ｜ 状态：✅ 施工真源（ADR-052）
> **v1.0 已作废**：旧版开篇写"代码已实现约六成，只需改视觉补缺口"——把定稿原型当"对旧页面的改造建议"，方向错误。苏哥两次纠正后按 ADR-052 重写本文。
> 真源原型：`deliverables/prototypes/media-library-stage-v1.html`（4313 行）/ `popup-stage-v1.html`（462 行）/ `settings-stage-v1.html`（884 行）
> 本文解决的问题：**原型是完整可交互的产品实现，真实页面怎么在"保留真实数据与副作用"的前提下逐块复刻它。**

---

## 0. 一句话结论

**UI 层照原型重写，数据层照旧复用。**

原型里的 `FILES` 数组 / `FAVORITES` 常量 / `TRASH` 数组 = mock 数据，落地时换成 `VRDB.getAllFiles()` / 新增 `fav` store / 现有回收站；原型里的 DOM、CSS、渲染函数、事件绑定 = 施工蓝图，**逐块复刻不改形**。

三条边界：

| 层 | 处理 | 例子 |
|---|---|---|
| **UI 层**（DOM / CSS / 交互） | **按原型重写** | `library.html` 的 sidebar/tree/pagehead/toolbar/grid/preview 全部照原型结构 |
| **数据层**（读写真实素材） | **保留复用** | `db.js`（IndexedDB）、`indexer.js`（扫描）、`thumbs.js`（缩略图）、`path.js`（路径解析） |
| **副作用层**（动文件/动下载） | **保留复用** | `save.js`（落盘）、`trash.js`（回收站）、`rename.js`（改名）、`background.js`（下载管线） |
| **适配层**（新增） | **新写** | `toCardModel()`：VRDB 条目 → 原型卡片模型；`fav` store：收藏夹持久化 |

---

## 1. 原型三段解构（复刻对象）

`media-library-stage-v1.html` 精确分段：

| 段 | 行范围 | 行数 | 复刻方式 |
|---|---|---|---|
| `<style>` | 7–2103 | 2096 | 抽出为 `css/library.css`（选择器作用域收敛到 `.library-page`），token 已是舞台值 |
| `<body>` DOM | 2105–2658 | 553 | 抽出为 `library.html` 的 body（保留 id/class 原样，数据钩子不改名） |
| `<script>` | 2659–4311 | 1652 | 拆为 `js/library/app.js`（渲染+交互）+ 复用真实数据模块 |

**DOM 骨架（必须逐块存在）**：

```
#app
├─ aside.sidebar
│   ├─ .brand（logo + 苏哥的钓鱼竿 / Media Library）
│   ├─ .root-btn（F:\download\video-rod · 点击更换目录）
│   ├─ .side-label（资源树 + treeTotal）
│   ├─ .tree-search
│   ├─ nav.tree#tree（00 全部资源 / 01 X / 01·1 NASA …编号索引）
│   ├─ .fav-side（收藏夹 + fav-menu）
│   └─ .side-foot（N 个文件 / 体积 / meter / 回收站 / 换目录）
└─ main
    ├─ section.pagehead
    │   ├─ .crumb-row（.crumb + .crumb-acts: 重新扫描/设置）
    │   ├─ .ph-title-row（h1#pageTitle + .scan-note + .searchbox）
    │   └─ .ph-fav-acts（收藏夹操作：重命名/复制清单/删除收藏夹）
    ├─ .toolbar
    │   ├─ .seg#typeTabs（全部/图片/动图/视频）
    │   ├─ .chips#chips（全部平台/X/小红书/抖音/微博/YouTube/Instagram/网页）
    │   └─ .tools（选择 + 排序 + 视图切换）
    ├─ .batchbar#batchbar
    ├─ .listhead#listhead（名称/平台/作者/大小/保存）
    ├─ .grid#grid
    ├─ .empty#empty
    └─ .scan#scanState（索引进度）
.preview#preview
├─ .pv-head（返回/面包屑/计数/连播/信息/全屏/快捷键/关闭）
├─ .pv-body
│   ├─ .pv-stage（media + .vctl 视频控件 + .imgbar 图片工具 + .gifbar 动图控件 + .ratepop 倍速浮层 + 左右箭头）
│   └─ aside.pv-info（head/title/author/acts + 文件组 + 来源组 + 标签组 + 同作者 + pi-foot）
└─ .pv-film（胶片条）
.keysheet#keysheet
.trash-drawer / .rename-box / .ctxmenu / .toast / 设置抽屉
```

---

## 2. 数据契约：VRDB 条目 → 原型卡片模型（`toCardModel()`）

这是本次预研的**核心新增**——旧预研完全没有这张表。

### 2.1 字段对照

| 原型字段 | 真实来源（VRDB `file` 条目） | 转换规则 | 缺口处理 |
|---|---|---|---|
| `id` | `relPath` | 原样 | — |
| `title` | `title` → 缺则 `fileName` 去扩展名 | 原样 | 无标题时用文件名，不留空 |
| `plat` | `platform` | 见 §2.2 平台映射 | 认不出 → `web` |
| `author` | `creatorFull`，形如 `影视飓风(@946974)` | 正则拆出名字 + `(@id)` | 空 → `''` + `authorState='unsupported'` |
| `authorId` | `creatorId`（`(@xxx)` 里的值） | 原样 | 空 → 隐藏（不显示 @空） |
| `kind` | `type` + 扩展名 | 见 §2.3 类型映射（`image`+gif/webp/apng → `anim`） | `audio`/`other` → 归入「其他」（原型无此页签，需补） |
| `size` | `size`（字节） | `/1024/1024` → MB 数字 | — |
| `dlAt` / `savedAt` | `mtime`（毫秒） | 格式化 `YYYY-MM-DD HH:mm` | 0 → `—` |
| `tags` | `tags` | 原样（空数组） | — |
| `starred` | `starred`（0/1） | Boolean | — |
| `dur` | `duration`（秒，若已存） | `mm:ss` | 无 → 不显示角标 |
| `h` | 无直接字段 | 用 `thumb` 的 w/h 算比例；无缩略图给固定 180 | 缺 → 固定值，瀑布流不跳 |
| `fmt` | 由 `fileName` 扩展名推导 | 大写（GIF/WebP/APNG） | — |
| `frames` | 无 | — | 不显示帧数行（原型「帧数仅动图」→ 无值即隐藏） |
| `workId` / `authorUid` / `source` / `pageUrl` / `mediaUrl` | **无** | — | **不假装有**：来源组显示「未记录」，F2 补采集后才出现 |
| `state` | `state`（`ok`/`missing`） | 原样 | `missing` → 显示状态行 + 卡片角标 |

### 2.2 平台字典缺口（**必须先补，否则抖音/微博/IG 全掉进"未分类"**）

真实 `js/library/path.js` 的 `PLATFORM_DIR` 只有 5 个：

```
bilibili → B站 ｜ xiaohongshu → 小红书 ｜ x → X ｜ youtube → YouTube ｜ web → 其他网页
```

原型 chips 有 7 个：`x / xiaohongshu / douyin / weibo / youtube / instagram / web`（另加 B站）。

**实测缺口**：`background.js:1964` 写 IG 路径用的是英文原始目录 `video-rod/instagram/<author>/<kind>/...`；抖音/微博同理。这些目录不在 `PLATFORM_DIR` 里 → `parseRelPath()` 认不出平台 → 库页面归成"未分类"。

**修法（施工第 1 块）**：扩展 `path.js` 的平台字典与 `detectPlatform`，补齐 `douyin → 抖音 / weibo → 微博 / instagram → Instagram`，并兼容已落盘的英文目录名（`instagram`/`douyin`/`weibo` 直接映射）。这是**通用能力修复**，不是站点特例（ADR-051）。

### 2.3 类型映射

真实 `path.js` 的 `EXT_TYPE`：`gif/webp/avif` 都算 `image`；`audio` 单列；其余 `other`。

原型 `kind` 只有 `video / image / anim`。

映射：

| 真实 | 原型 | 说明 |
|---|---|---|
| `type=video` | `video` | 直接 |
| `type=image` 且扩展名 ∈ {gif, webp, apng} | `anim` | 原型动图页签 + 动图控件 |
| `type=image` 其余 | `image` | 直接 |
| `type=audio` | **`audio`（原型已补页签 + 播放器面板）** | 2026-11-06 已补音频 tab 与 `.pv-audio` 面板；真实库复用通用管理链路 |
| `type=other` | **`other`（原型需补）** | 同上 |

> **决策**：原型只画了三个页签，但真实库有音频文件。按 ADR-052"不留功能"原则，页签补为 **全部 / 图片 / 动图 / 视频 / 音频**（音频用 `i-volume-2` 图标），不把音频藏起来。

---

## 3. 模块处置表（哪些留、哪些重写）

| 模块 | 行数 | 处置 | 说明 |
|---|---|---|---|
| `js/library/db.js` | 246 | ✅ **保留** | IndexedDB 封装；新增 `fav` store 时扩 version |
| `js/library/path.js` | 281 | ✅ 保留 + **补平台字典** | §2.2 缺口 |
| `js/library/indexer.js` | — | ✅ 保留 | 扫描/快照/合并；F1 分辨率回写落点 |
| `js/library/thumbs.js` | — | ✅ 保留 | 缩略图；F1 顺带回写真实宽高 |
| `js/library/save.js` | — | ✅ 保留 | 落盘 |
| `js/library/trash.js` | — | ✅ 保留 | 回收站后端（列表/恢复/清空） |
| `js/library/rename.js` | — | ✅ 保留 | 改名后端 |
| `js/library/settings.js` | — | ✅ 保留 | 设置读写 |
| `js/library/keyboard.js` | — | ✅ 保留 + 扩键位 | 原型键盘矩阵更全 |
| `js/library/migrate*.js` | — | ✅ 保留 | 迁移向导（原型未画，转次级入口） |
| `js/library/sw-library.js` | — | ✅ 保留 | SW 侧库逻辑 |
| `library.html` | 388 → **重写** | 🔁 按原型 DOM 重写 | 保留模块 `<script>` 引用 |
| `css/library.css` | ~2200 → **重写** | 🔁 用原型 CSS 为准 | 原型 `<style>` 抽出，作用域收敛 |
| `js/library/ui.js` | 942 → **重写** | 🔁 拆成 `app.js`（渲染+交互） | 旧渲染函数不沿用 |
| `js/library/lightbox.js` | ~1179 → **重写** | 🔁 按原型 `.preview` 结构 | 视频/图片/动图控件分开 |
| `js/library/video.js` | 281 → **适配** | ⚙ 保留播放逻辑，控件接原型 `.vctl` | 真播放入口不变 |
| `js/library/trash-ui.js` | — → **重写** | 🔁 按原型抽屉结构 | 后端不动 |
| `js/library/batch.js` | — → **适配** | ⚙ 批量逻辑保留，条 UI 接原型 `.batchbar` | 真实批量操作不动 |
| **新增** `js/library/app.js` | — | 🆕 新写 | 原型渲染+交互逻辑，接真实数据 |
| **新增** `js/library/fav.js` | — | 🆕 新写 | 收藏夹 store + UI |
| **新增** `js/library/settings-drawer.js` | — | 🆕 新写 | T5 设置抽屉，聚合真实逻辑 |

---

## 4. Mock → 真实：数据接入点清单

原型里每一处 mock 读写，落地时换成真实调用（**漏一个就出假数据**）：

| 原型写法 | 真实替换 | 落点 |
|---|---|---|
| `FILES` 常量数组 | `await VRDB.getAllFiles()` → `map(toCardModel)` | `app.js` 启动 |
| `FILES.push/splice`（恢复/删除） | `VRDB.putFiles` / `deleteFiles` + 重读 | `trash`/`rename` 后端 |
| `FAVORITES` 常量 | 新 `fav` store：`{id,name,desc,order,ids[],sys,smart}` | 新增 `fav.js` |
| `TRASH` 数组 | 现有 `trash.js`（真实回收站） | `trash.js` |
| `toast()` | 原型 toast（保留视觉），消息来自真实结果 | `app.js` |
| `openPreview(f)` 里 `<img src>` / `<video src>` | 真实 `file://` 或 blob URL（`getUrl(entry)`） | `app.js` |
| `renderTree` 的 `TREE` 常量 | 由真实 `all` 聚合：平台→博主，编号预计算 | `app.js` |
| `counts()` | 由真实 `all` 计算 | `app.js` |
| 搜索 `filtered()` | 保留 booru 语法，字段换成真实模型 | `app.js` |
| 设置抽屉「换目录/扫描/重建索引」 | 真实调用 `chrome.fileSystem`/`VRIndex.build()`/`VRDB` | `settings-drawer.js` |
| 「重新扫描」按钮 | `VRIndex.build({mode:'full'})` + 重读 | `app.js` |

---

## 5. 分块施工顺序（每块 CDP 验收，失败即回滚）

| 块 | 内容 | 验收断言 |
|---|---|---|
| **R0** | 平台字典补齐（douyin/weibo/instagram + 英文目录兼容） | `parseRelPath('.../instagram/x/images/a.jpg')` 返回 `platform=instagram`；5+3 平台全识别 |
| **R1** | 原型 CSS 抽出为 `css/library.css`（`.library-page` 作用域） | 页面底色 `#100F0E`；无冷色/橙残留；0 JS 错误 |
| **R2** | 原型 DOM 抽出为 `library.html`（保留真实模块 script） | DOM 节点数对比原型 ≥95%；`#tree/#grid/#search/#typeTabs/#chips` 全在 |
| **R3** | `toCardModel()` + 渲染核心（tree/grid/toolbar/空态） | 真实数据条数=卡片数；平台/作者/大小/时间正确；三态空态正确 |
| **R4** | 搜索/筛选/排序/视图/批量（booru 语法） | `空格=交集`/`-词=排除` 命中数正确；批量选择/删除落真实库 |
| **R5** | 预览层（图片/视频/动图 + 信息面板分组 + 胶片条） | 三类各切 3 张 0 错误；信息面板无重复字段；dt 单行 |
| **R6** | 收藏夹（fav store + 侧栏 + 加入浮层 + 智能夹） | 新建/加/删不动物理文件；重建索引不丢 |
| **R7** | 设置抽屉（五项真实聚合） | 换目录后树路径同步；重建索引可用；Esc/遮罩关闭 |
| **R8** | 回归基线（T6） | 对齐断言 + 交互断言 + 0 JS 错误全绿 |

---

## 6. 旧页面独有功能取舍（原型未画）

| 功能 | 原型 | 处置 |
|---|---|---|
| 概览 KPI 卡 | 未画（原型明确删统计条） | **删**（与类型 seg 重复） |
| 平台堆叠图 / 博主产量 | 未画 | **移入设置抽屉「库统计」次级页**，不占主屏 |
| 索引迁移向导 | 未画 | **移入设置抽屉「高级」**，保功能不占位 |
| 列表视图表头 | 原型有 | 照原型 |

---

## 7. 验收清单（施工完逐条打勾）

- [ ] 扩展加载 0 报错；资源库列出真实全部条目（含 F 盘/下载目录）
- [ ] 侧栏编号树 00/01/01·1 与平台页签计数自洽（图片+动图+视频+音频=全部）
- [ ] 搜索 booru 语法（交集/排除）命中正确
- [ ] 网格/列表切换；列表五列对齐
- [ ] 预览：图片缩放/旋转/1:1；视频控件全套；动图暂停/逐帧
- [ ] 信息面板分组（文件/来源/标签），无重复字段，缺字段不假装有
- [ ] 收藏夹：新建/加入/删除不动物理文件；星标为系统夹
- [ ] 设置抽屉五项可用；换目录后树同步
- [ ] 批量：全选/反选/删除落真实库；回收站可恢复
- [ ] 三档响应式（1440/1024/860）不折行、不溢出
- [ ] 0 JS 错误；冷色/橙/蓝残留 0

---

## 8. 与 v1.0 的差异（为什么重写）

| 维度 | v1.0（作废） | v2.0（本版） |
|---|---|---|
| 路线 | 以旧代码为骨架，改视觉补缺口 | 以原型为骨架，接真实数据 |
| 差距判断 | "代码已实现六成" | 交互层几乎全缺（搜索语法/收藏夹/设置抽屉/信息面板分组） |
| 数据接入 | 未写 | §2 字段契约 + §4 mock→真实清单 |
| 平台缺口 | 未发现 | §2.2 抖音/微博/IG 目录认不出 |
| 模块处置 | "改样式保留" | §3 逐模块 保留/重写/适配 |
| 施工顺序 | 9 步按喜好 | §5 R0-R8 按依赖，每块可验收 |
