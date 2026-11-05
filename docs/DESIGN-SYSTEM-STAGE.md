# 舞台设计系统 · DESIGN-SYSTEM-STAGE v1.1

> 日期：2026-11-04（v1.1：2026-11-05 补 §4.5 DOM 骨架）｜ 状态：✅ 定稿（ADR-049；重写路线 ADR-052）｜ 真源原型：`deliverables/prototypes/media-library-stage-v1.html`、`popup-stage-v1.html`、`settings-stage-v1.html`
> 本文件是全站视觉与结构的**唯一真源**。编码会话照此施工，任何色值/间距/DOM 与本文件冲突时，先改文档再改码（走 ADR 追加）。
> **亮色皮肤已退役（苏哥拍板）**：产品端不再提供浅色主题，`prefers-color-scheme` 与主题切换逻辑随施工移除，本文件只定义一套深色。

---

## 1. 色彩 token（钉死值，禁近似）

### 1.1 表面（剧场暖黑族——注意全部带暖味，禁止冷蓝黑回潮）

| token | 值 | 用途 |
|-------|-----|------|
| `--bg` | `#100F0E` | 页面底（body/main 区） |
| `--surface` | `#191715` | 卡片、面板、抽屉 |
| `--surface-2` | `#1F1C18` | 次级面（hover 底、分组底、seg 槽） |
| `--surface-3` | `#2B2620` | 三级面（选中底、徽标底、滚动条 hover） |
| `--line` | `#2B2620` | 主分隔线/描边 |
| `--line-2` | `#211E1A` | 弱分隔线（内行线） |
| 顶栏渐变 | `linear-gradient(180deg,#171513,#121010)` | popup/工具条底 |
| 噪点 | `feTurbulence 0.85 / alpha .05` data-uri | 纸面质感，仅大面积底使用，opacity ≤5% |

### 1.2 文字（暖纸白族——无纯白 #FFF、无冷灰）

| token | 值 | 用途 |
|-------|-----|------|
| `--ink` | `#EFEAE0` | 主文字、大数字 |
| `--ink-2` | `#C8C0B2` / `#B0A89A` | 次级文字 |
| `--muted` | `#8C8478` | 标签、说明 |
| `--faint` | `#5F5950` | 占位、禁用、图标默认 |

### 1.3 强调（舞台金——全站唯一）

| token | 值 | 用途 |
|-------|-----|------|
| `--accent` | `#E8B04B` | 选中、焦点环、链接、激活、开关 on |
| `--accent-2` | `#F0C878` | 高亮文字、hover 提亮 |
| `--accent-deep` | `#C98A2E` | 按钮 hover 下沉、渐变暗端 |
| `--accent-soft` | `#2C2418` | 金色底纹（选中背景、focus ring 3px） |
| 金色按钮文字 | `#141210` | **金底上永远用深字**，禁白字 |

### 1.4 语义色

| token | 值 |
|-------|-----|
| `--danger` | `#E86466`（底纹 `#2A1618`） |
| `--ok` | `#4FBF8B`（底纹 `#132A21`；扫描绿点带 6px 光晕） |
| `--warn` | `#E0B062`（底纹 `#2A2116`） |

### 1.5 平台品牌色（保留、降面积使用——只做 5-7px 圆点/2px 顶带，不做大面积）

B站 `#FB7299` ｜ X `#8FA0B8` ｜ 微博 `#E6506D` ｜ 小红书 `#FF2442` ｜ 抖音 `#25C8D4` ｜ IG `#C13584` ｜ 网页 `#8B93A1`

---

## 2. 字体

| 用途 | 栈 | 规格 |
|------|-----|------|
| 正文/UI | `"Noto Sans SC", -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif` | 13px / 1.5 |
| 标题/品牌/组头 | `"Noto Serif SC", "Source Han Serif SC", Georgia, "SimSun", serif` | **仅 ≥20px**（中文衬线小字发糊铁律）；字距 .06-.1em |
| 数字/路径/编号 | `ui-monospace, "Cascadia Mono", Consolas, monospace` | 大数字 14-17px 600；元数据 10-11px；tabular |

三档制：大（衬线/等宽数字）— 正文 13 — 注 10.5-11。字重只用 400/500/600。

## 3. 间距与栅格

- 主区 padding：`26px 28px 48px`（**顶部 26px 是铁律**——面包屑距顶实测 33px，禁止归零）
- 卡片网格 gap `24px 22px`；工具条内 gap 10-11；行组件基线 gap 14
- 圆角：卡片 3px、面板/抽屉 10-12px、控件 2-4px（舞台=小圆角克制系，禁 8px+ 大圆角滥用）
- popup 固定 380×560；资源库基准 1440，最小 860

## 4. 组件规范（原型定稿形态，逐条可验收）

1. **标题行一行收纳**：h1 + 扫描态小字 + 搜索框同行；搜索框右缘、右上角按钮组右缘、工具条右缘**三线对齐同一像素**（实测 1440 下全 = 1363）
2. **右上角动作区**：重新扫描 / 设置 常驻面包屑行右侧；popup 与库页同规则
3. **工具条两行制**：第一行=类型 seg + 右侧（选择/排序/视图）；第二行=平台 chips 通栏左对齐，**任何宽度下不得出现孤行半排**
4. **资源树=编号索引**：`00 全部素材 / 01 X / 01·1 NASA`，等宽金字；禁彩色圆点、禁首字母头像块；占比条统一金色低透明
5. **统计条已删除**：数字唯一来源=类型 seg 的计数；页面任何位置不得再出现第二组总数卡
6. **详情面板双竖线**：标签列固定 76px 单行不折（四字标签+图标实测需 ≥76px），值列左缘一线对齐；组头=色点+名称左对齐、徽标右靠（flex-start + margin-left:auto，禁 space-between 推标题乱跑）
7. **详情面板字段去重铁律**：**凡可从面包屑/角标/路径推导的字段不单列**——格式（=路径后缀）、文件名（=路径末段）、下载时间（=保存时间）、平台（=面包屑+角标）、作者 ID（=作者行 @handle）均已删；帧数仅动图显示
8. **标签组一行化**：组头"标签"+标签 chips+「+ 添加」同一行
9. **悬停=聚光**：卡片 hover 缩略图亮度 .6→1 + 深阴影；选中/命中=1px 金描边；transition 120-250ms ease-out，禁回弹
10. **设置抽屉**（新功能）：右侧 380px 滑出，聚合：下载目录+更换 / 立即扫描 / 重建索引 / 回收站 / 文件名规则 / 完整设置出口；Esc+遮罩关闭

## 4.5 DOM 骨架（重写蓝图，ADR-052）

施工时 DOM **照此铺**，id/class 不改名（数据钩子）；结构缺一块即返工。

### 4.5.1 媒体库 `library.html`

```
body.library-page
#app
├─ aside.sidebar
│   ├─ .brand（.logo + .brand-txt: 苏哥的钓鱼竿 / Media Library）
│   ├─ button.root-btn#rootBtn（.rb-ico + .rb-body 路径/提示 + chev）
│   ├─ .side-label（资源树 + #treeTotal）
│   ├─ .tree-search（#treeSearch）
│   ├─ nav.tree#tree（编号索引 00/01/01·1）
│   ├─ .fav-side（#favMenuBtn + #favMenu: #favList / #favNewRow / #favMore）
│   └─ .side-foot（#fCount / #fSize / #meterBar / #trashBtn / #resetBtn）
└─ main
    ├─ section.pagehead > .ph-left
    │   ├─ .crumb-row（#crumb + .crumb-acts: #rescanBtn / #settingsBtn）
    │   ├─ .ph-title-row（h1#pageTitle + .scan-note#syncText + .searchbox#search）
    │   └─ .ph-fav-acts#favActs（#favRename / #favExport / #favDelete）
    ├─ .toolbar
    │   ├─ .seg#typeTabs（data-type=all/image/anim/video/audio）
    │   ├─ .chips#chips（data-plat=all/x/xiaohongshu/douyin/weibo/youtube/instagram/web/bilibili）
    │   └─ .tools（#selectBtn + select#sort + .viewtoggle#viewToggle）
    ├─ .batchbar#batchbar（#batchCount/#batchAll/#batchInvert/#batchClear/#batchFav/#batchTrash/#batchExit）
    ├─ .listhead#listhead（名称/平台/作者/大小/保存）
    ├─ .grid#grid（.card * n）
    ├─ .empty#empty（#emptyIco/#emptyTitle/#emptyText/#emptyAction）
    └─ .scan#scanState（#scanText/#scanSub）
.preview#preview（.pv-head + .autobar + .pv-body[.pv-stage/.pv-info] + .pv-film）
.keysheet#keysheet
.trash-mask/.trash-drawer（#libTrash* → 原型结构）
.rename-mask/.rename-box
.ctxmenu
.toast
.settings-drawer（R7 新增：遮罩 + 380px 抽屉）
```

### 4.5.2 预览层 `.pv-info` 分组（去重后终态）

```
.pi-head（#pvPlat 平台·类型 + #pvOpenTop 原帖）
h2#pvTitle
.pi-author#pvAuthorRow（#pvAvatar + #pvAuthor + go）
.pi-acts（#pvRename/#pvMove/#pvReveal/#pvDelete）
.pi-group 文件（--grp 青色）
  ├─ .pi-stats（#st1v 分辨率 / #st2v 大小 / #st3v 保存）
  ├─ .pi-item#pvStateRow（仅缺失时显示）
  └─ details.pi-fold 更多文件信息（帧数[仅动图] / 保存时间 / 路径+复制）
.pi-group 来源（--grp 金色；#pvSrcBadge 四态徽标）
  ├─ a.pi-item#pvPageRow 原帖
  ├─ .pi-item#pvMediaRow 直链（+ 过期警示 + 复制）
  ├─ .pi-item#pvSrcMiss（历史素材提示）
  └─ details.pi-fold 溯源详情（作品 ID）
.pi-group.grp-tags 标签（--grp 紫）
  └─ .pi-tags 一行：.pi-label「标签」+ #pvTags + #pvTagAdd「+ 添加」+ 输入行
.pi-more（同作者 N 项 + 网格）
.pi-foot（? 快捷键）
```

**硬约束**：`.fact dt` / `.pi-item dt` 宽度 76px 且 `white-space:nowrap`；值列左缘一线；组头 `flex-start` + 徽标 `margin-left:auto`；统计条**不得存在**（数字唯一来源=类型 seg）。

### 4.5.3 popup / 设置页

结构照 `popup-stage-v1.html` / `settings-stage-v1.html` 原样复刻；popup 固定 380×560，三区（顶栏 / 列表 / 底栏）禁用 `vh`；设置页章节顺序与原型一致，删主题切换入口。

---

## 5. 图标

Lucide 内联 sprite（现状不变），1.5-2px stroke；默认 `--faint`，激活/悬停 `--accent`；禁彩色图标底块（统计卡彩块教训）。

## 6. 动效

仅 opacity/filter/transform；120-250ms；cubic-bezier(.2,.7,.3,1)；`prefers-reduced-motion` 全关。抽屉/灯箱 280-300ms。

## 7. 反例清单（施工自查，出现即返工）

冷蓝黑（#0A0B0E/#12141A 族）、影院橙 #FF7A45、强调蓝 #337CCC、赭石 #A8502E、金底白字、大圆角+通用阴影、彩色统计卡、双份计数、space-between 组头、dt 折行、chips 孤行、顶部 0 padding。
