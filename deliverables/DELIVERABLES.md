# 苏哥的钓鱼竿 — 产出物管理规范

> 版本：v2.8 ｜ 日期：2026-10-24 ｜ 状态：✅ 已生效
> 一句话：**产出物有家、有版本、有状态、找得到。** 本文件是 deliverables/ 目录的宪法，新增任何产出物前先读这份。
> v2.8 变更：登记 YouTube 播放器下载（`js/yt/` 五件 + `lib/youtubei.min.js` + 三份文档 + 八个探针/验收脚本 + 两张截图）；补登图片线 I4（浮标 + 清单面板）；`HANDOFF.md` 升 v2.1（16 套 571 条基线、新增 §6.7 多线覆盖 / §6.8 行尾两个坑）；`TESTING.md` 升 v1.6（§21 I3 / §22 I4 / §23 YouTube）。
> v2.7 变更：S5 删除与回收站——`trash.js` / `trash-ui.js`、软删除批次与清单、恢复/彻底删除/清空、右键菜单与抽屉，验收 27/27。
> v2.6 变更：S4 查看器 v2——`lightbox.js` / `video.js` / `keyboard.js`、图片缩放拖拽、信息面板、缩略图带、视频自绘控件、键盘与连播；概览默认收起；验收 27/27。
> v2.5 变更：资源库 v2——概览 KPI / 平台分布 / 博主速览 / 真表格 / 日期分组，验收 29/29；截图更新为 6 张。
> v2.4 变更：新增资源库页面（全宽大图 / 全屏查看器 / 懒缩略图）与 22 条验收；popup 统一蓝灰；登记 `FRONTEND-UI-SYSTEM.md` 与 5 张截图。
> v2.3 变更：全局更名「苏哥的钓鱼竿」（扩展名 / 界面 / 文档 / locale）；关于页补上游署名与本 fork 增量、开发手记与数据块。
> v2.2 变更：登记设置页重设计三件（方案 `OPTIONS-REDESIGN.md`、样式/交互改造、8 张验收截图）。
> v2.1 变更：登记 S2 索引两件（`indexer.js` / `cdp-indexer-test.py`）；`db.js` 升 v1.1（handle 读写）、`settings.js` 升 v1.3（索引维护入口）、LIBRARY-PLAN 升 v2.0（§13.11 索引规格 + S2 完成）。
> v2.0 变更：登记交接文档 `docs/HANDOFF.md`（接手 AI 入口，含现状/环境/代码地图/测试基线/坑/未完成）。
> v1.9 变更：登记 S1b 迁移三件（`migrate.js` / `migrate-ui.js` / `cdp-migrate-test.py`）；`settings.js` 升 v1.2、`options.html` 迁移面板；S1a 脚本 B5 断言随按钮启用同步；LIBRARY-PLAN 升 v1.8（§13.10 迁移规格）。
> v1.8 变更：登记自动入库三件套（`db.js` / `sw-library.js` / `cdp-index-test.py`）+ `parseRelPath` 与 SW 消息转发；`test-path.js` 升 v1.1（57/57）；自动入库调研文档转「已实现」。

---

## 1. 目录结构总览（四类分离，各司其职）

```
video-rod/
├── README.md              # 🚪 门面：唯一项目入口，指向一切
├── docs/                  # 📐 工程文档：长期有效，随项目演进持续更新
│   ├── REQUIREMENTS.md    #   需求规格
│   ├── DESIGN.md          #   技术设计
│   ├── TESTING.md         #   测试策略
│   ├── DECISIONS.md       #   决策记录（ADR）
│   ├── PLAN.md            #   方案书（论证过程）
│   └── BUILD-PLAN.md      #   施工计划（M0-M6）
├── deliverables/          # 📦 产出物：有版本、有状态、需评审的实物
│   ├── DELIVERABLES.md    #   本规范（目录宪法）
│   ├── prototypes/        #   可交互原型（定交互/排版，不动源码）
│   ├── reviews/           #   评审/审计报告（日期化命名）
│   └── assets/            #   生成的静态资产（图标、预览图）
├── tools/                 # 🔧 工具脚本：纯脚本，不是产出物
├── .work/                 # 🧹 本机临时工作区：不进 git，可整体删除
│   ├── profiles/          #   测试用 Chrome profile（原型回归 / P0 探针）
│   ├── media/             #   测试媒体样本（probe.jpg / probe.mp4）
│   └── scripts/           #   一次性脚本草稿（正式脚本请放 tools/）
└── archive/               # 🗄️ 归档：上游遗产+作废产出物，留证不删
```

**分类原则**（拿不准时对号入座）：
- 写「项目应该是什么样」→ `docs/`
- 做出来一个「能给苏哥看/能点/能用」的实物 → `deliverables/`
- 「跑一下干个活」的脚本 → `tools/`
- 「只有本机跑一次、删了也不影响」的 → `.work/`（**不进 git**）
- 「没用了但删了心虚」→ `archive/`

### 1.1 工作区边界（v1.6 新增）

**硬规则：本项目产生的任何文件，都不允许散落在仓库外（如 `E:\test\` 根目录）。**

| 类型 | 落点 | 进 git？ | 可删？ | 例子 |
|---|---|---|---|---|
| 交付物 | `deliverables/` | ✅ | 仅按 §5 生命周期 | 原型、审计报告、预览图 |
| 工程文档 | `docs/` | ✅ | 仅按 ADEC 流程 | 方案、需求、测试策略 |
| 可复用工具 | `tools/` | ✅ | 否 | CDP 测试脚本、探针扩展 |
| 本机临时件 | `.work/` | ❌（已 gitignore） | ✅ 随时 | Chrome profile、测试媒体、草稿 |
| 归档留证 | `archive/` | ✅ | 否 | 上游遗产、作废原型 |

`.work/` 的说明与清理命令见 [.work/README.md](../.work/README.md)。

## 2. 命名规范

| 类型 | 位置 | 命名模式 | 示例 |
|---|---|---|---|
| 工程文档 | `docs/` | 大写下划线分类名，不带日期/版本 | `REQUIREMENTS.md`、`DESIGN.md` |
| 原型 | `deliverables/prototypes/` | `名称-vN.html`（N 从 1 递增，**保留最新，旧的进 archive/**） | `popup-prototype-v5.html` |
| 评审/审计 | `deliverables/reviews/` | `YYYY-MM-DD-主题.md`（日期即版本，不改写只追加新日期） | `2026-10-17-audit.md` |
| 静态资产 | `deliverables/assets/` | 小写中划线，带用途 | `icon-preview.png` |
| 工具脚本 | `tools/` | 小写中划线，带语言后缀 | `video-rod-icon.py`、`cdp-test.py` |
| 归档 | `archive/` | 原名 + 进 archive 时在文件名/目录名注明来源 | `archive/README-assets/`（猫抓 README 截图）、`archive/CHANGELOG.md`（上游日志） |

## 3. 版本与状态机

每个登记在册的产出物都有**状态**（记在 §4 登记表里）：

```
草案(Draft) ──提交评审──► 评审中(Review) ──苏哥拍板──► 已定稿(Approved) ──过期/被取代──► 已归档(Archived)
```

| 状态 | 含义 | 谁能改 |
|---|---|---|
| 草案 | 我在做，没给苏哥看过 | 我 |
| 评审中 | 已交付苏哥，等反馈 | 我改，苏哥看 |
| 已定稿 | 苏哥拍板，作为后续工作的基准 | **冻结**，要改必须走 ADR 新增决策记录 |
| 已归档 | 被新版本取代或使命结束 | 任何人都不改，只查阅 |

**版本号规则**：
- 原型：`vN` 整数递增，改交互/排版就 +1
- 文档（docs/）：内容演进不跳版本号，看 git 历史；重大重构在文档头版本行 +1（如 v1.0 → v1.1）
- 审计/评审：日期唯一，不改写历史报告（发现新问题写新日期文件）

## 4. 产出物登记表（新增必须登记）

| 产出物 | 路径 | 当前版本 | 状态 | 说明 |
|---|---|---|---|---|
| popup 交互原型 | `deliverables/prototypes/popup-prototype-v5.html` | v5 | 已定稿 | M1 面板施工基准；浏览器直接打开 |
| 外部审计报告 | `deliverables/reviews/2026-10-17-audit.md` | 2026-10-17 | 已定稿 | 3 硬阻塞已核验并落实到 ADR-018/019/020 |
| 图标预览图 | `deliverables/assets/icon-preview.png` | — | 已定稿 | 新图标三尺寸预览 |
| 方案书 | `docs/PLAN.md` | v1.4 | 已定稿 | 功能设计+竞品对标+决策记录；决策点全关闭 |
| 施工计划 | `docs/BUILD-PLAN.md` | v1 | 已定稿 | M0-M6，总工期 1.5-2 周；苏哥 10-17 批准开工 |
| 需求规格 | `docs/REQUIREMENTS.md` | v1.1 | 已定稿 | P0 11 项（F9 嗅探增强改版） |
| 技术设计 | `docs/DESIGN.md` | v1.1 | 已定稿 | 含 §6.5 增量盘点、§8 合并三路线 |
| 测试策略 | `docs/TESTING.md` | v1.1 | 已定稿 | 用例表+回归清单 |
| 决策记录 | `docs/DECISIONS.md` | v1.1 | 进行中 | ADR-001~027，追加式；ADR-025 = popup 浅色重设计定案（方案 A 全量整合）；ADR-026 = X 按钮预混流直链；ADR-027 = 下载文件名保护（抄 XBD/CocoCut/Imageye 的 onDeterminingFilename 套路） |
| 智能起名引擎 | `js/naming.js` | v0.2 | 已定稿 | M0 产物；27/27 测试通过；M1 已接入 popup（新增 buildNameFromInfo） |
| 起名引擎测试 | `tools/test-naming.js` | v1.0 | 已定稿 | 27 条断言全绿；真实网址验证延至 M1 |
| popup 重设计三方向 | `deliverables/prototypes/popup-redesign-options-v2.html` | v2 | 已定稿 | 浅色 A/B/C 三方案可点原型；苏哥拍板方案 A「收网」（ADR-025），已全量整合进产品代码 |
| popup 重设计三方向（旧） | `archive/prototypes/popup-redesign-options-v1.html` | v1 | 已归档 | 首版交付（6 条数据、行高 59px）；苏哥确认 v2 后按 §5.1 归档；配套调研脚本 probe12.py/shot_v2.py 同迁 archive/prototypes/ |
| 重设计方案说明 | `deliverables/reviews/2026-10-17-popup-redesign.md` | 2026-10-17 | 已定稿 | 调研依据 + 现状诊断 + 推荐 A + 10+ 滚动规则 + 落地契约；方案 A 已施工完毕 |
| popup 外壳 | `popup.html` + `css/videorod.css` | v2.0 | 已定稿 | M1 按原型 v5 重写（v1.0）；M7 浅色重设计整合（v2.0）：浅色 token + 头部两行化 + 66px 干净行卡片 + 设置 4 组全屏视图 |
| popup 浅色覆盖层 | `css/popup-light.css` | v1.0 | 已定稿 | M7 新建；`#vrShell` 作用域内把猫抓 17 个原生变量钉为浅色（ID 特异性压制 dark media query，不动猫抓源码） |
| popup 交互层 | `js/popup-videorod.js` | v1.2 | 已定稿 | M1 打底（v1.0）+ M2 下载管线 + M3/M4 站点增强 + M5 图片批量（v1.1）+ M7 设置视图/高级工具入口适配（v1.2）；`currentPageUrl()` 改走 `chrome.tabs.get` |
| 猫抓内核最小触碰 | `js/popup.js` | v1.1 | 已定稿 | M7 三处最小改动：模板 meta 段显 `.name` + 新增 `.metasub`；url 面板显隐给 `.panel` 加/删 `vr-open` class；改名失焦同步标题文本 |
| M1 有头浏览器验收脚本 | `tools/cdp-m1-test.py` | v1.1 | 已定稿 | CDP 连有头 Chromium，DOM 断言+交互冒烟+状态截图；v1.1 增加 biliBanner/partChips/ytBanner 断言 |
| M1 面板截图（深色版） | `deliverables/assets/m1-panel-{list,settings,rename,dirmenu}.png` | 2026-10-17 | 已归档 | M1 深色外壳四态实拍；M7 浅色化后由 final-m7-plain/settings.png 取代 |
| CDP 公用客户端 | `tools/cdp_client.py` | v1.1 | 已定稿 | `Cdp` 类 + `find_ext_id` + `open_popup`；v1.1 内建「新建标签页 + 禁缓存」修掉复用旧标签页嗅探为 0 的坑 |
| M2 下载管线验收脚本 | `tools/cdp-m2-test.py` | v1.0 | 已定稿 | 真落盘 + 去重 + 完成态；测完自动清理本次新增文件 |
| M3+M5 合并验收脚本 | `tools/cdp-m3-m5-test.py` | v1.1 | 已定稿 | B站分P横幅 + 图片弹层 + 图片真落盘（`VR_DL=1` 开启落盘）；v1.1 加 try/except+traceback，崩了留现场不再空文件 |
| M5b 秒存/快捷键验收脚本 | `tools/cdp-m5b-test.py` | v1.0 | 已定稿 | 走 `vrSaveContextMedia` 真实路径验右键秒存落盘；CDP 真实派发 Alt+Shift+V 验快捷键 |
| SW 状态诊断探针 | `tools/cdp-probe.py` | v1.0 | 已定稿 | 读 service worker 的 G/cacheData 状态，排查「嗅探为 0」类问题用 |
| M2 面板回归截图（深色版） | `deliverables/assets/m1-regress.png` | 2026-10-17 | 已归档 | M2 阶段复跑 M1 断言集的实拍（防重构改坏）；浅色版现行 |
| P0 探针扩展（file:// 直读 + downloads 绝对路径） | `tools/probe-file-access/` | v1.0 | 已定稿 | 最小 MV3 扩展：`probe.html` + `probe.js`，结果写 `window.__PROBE__` 供 CDP 读取；三项全过（TESTING §9）。配套 `run-probe.py` 为 CDP 执行器，媒体默认在 `.work/media/probe` |
| 资源库原型回归脚本（CDP） | `tools/cdp-library-test.py` | v1.0 | 已定稿 | 原型 v1.3 的 A–I 九组共 42 条断言；2026-10-24 实测 **42/42 通过、控制台 0 错误**。端口 `CDP` 环境变量可覆盖（默认 9333） |
| 资源库原型验收截图 | `deliverables/assets/library-v13-{grid,lightbox,video}.png` | v1.3 | 已定稿 | 三态实拍：网格（星标+标签+键盘高亮）、灯箱（缩略图带）、视频弹层（进度时间气泡）；1440×900 |
| 资源库路径引擎 | `js/library/path.js` | v1.1 | 已定稿 | 平台识别 / 类型推断 / 博主段 / 三段目录拼装 / 长度保护 / `file://` 编码；被 popup、background（秒存）、x-button（X 按钮）三处下载链路复用；v1.1 新增 `parseRelPath()` 反解（relPath → 平台/博主/类型），供预登记 meta 与入库兜底使用 |
| 资源库设置页脚本 | `js/library/settings.js` | v1.3 | 已定稿 | options.html「资源库」分区：子目录名、落盘模式、FSA 授权、**校验落盘**（微下载反推真实根目录）；v1.1 索引状态/最近入库；v1.2 新增 `setSubdir()` 供迁移成功后同步子目录名；v1.3 新增「索引维护」三入口（重建索引 / 写快照 / 授权目录并全量扫描）与状态行 |
| 资源库迁移引擎 | `js/library/migrate.js` | v1.0 | 已定稿 | 新建。三种形态（改子目录名 / 换根 / 整理旧文件）共用：扫描（跳过 `.part`/`_migration`/`_回收站`/`_verify`/点文件）→ dry-run 分类（move/skip/conflict/blocked）→ 流式复制 → 校验（size + 首尾 64KB，可选 SHA-256）→ 删源 → 逐条落日志 → 逆序回滚；任一条失败即中止且不删源；迁移后同步索引 relPath/absPath |
| 资源库迁移面板 | `js/library/migrate-ui.js` | v1.0 | 已定稿 | 新建。设置页 `#vrLibMigPanel`：三方式切换、FSA 选目录（句柄缓存 IDB）、预演表格（前 50 行 + 计数/总大小）、执行进度条、回滚上次；成功后自动同步 `subdir` |
| 迁移端到端验收脚本 | `tools/cdp-migrate-test.py` | v1.0 | 已定稿 | **39/39**：OPFS 句柄注入（绕开原生目录选择器），覆盖预演不改文件、执行/校验、回滚、冲突口径、改名+索引同步、整理旧文件、采样校验、面板交互（TESTING §12） |
| 资源库索引服务（三源） | `js/library/indexer.js` | v1.0 | 已定稿 | 新建。`VRIndex.build({mode:'downloads'|'snapshot'|'full'})` + `reconcile()` + `snapshot()`；根解析三档（内存 / VRDB handle / 旧授权库·仅 custom）；downloads 只 upsert、snapshot/full 扫不到标 `missing` 不删除；重建保留 starred/tags/thumbKey/title；快照写 `<根>/_library/index-YYYYMMDD.json`（不存 absPath，按当前根重算），保留 7 份；句柄指向资源库根、索引 key 首段固定 `subdir`（ADR-030） |
| 索引端到端验收脚本 | `tools/cdp-indexer-test.py` | v1.0 | 已定稿 | **35/35**：OPFS 句柄注入覆盖全量扫描/快照恢复/缺失语义/reconcile；真实下载验证 downloads 源；无句柄降级报 `LIB_E_NO_PERM`；设置页三个维护按钮；测完清文件+擦记录+清索引（TESTING §13） |
| 资源库页面（S3 核心） | `library.html` + `css/library.css` + `js/library/ui.js` + `js/library/thumbs.js` | v1.1 | 已定稿 | 概览 4 KPI + 平台分布堆叠条 + 博主 Top5 + 博主速览卡；全宽大卡（4:3）；**真表格 8 列**（表头/右对齐数字）；筛选/搜索/排序/**日期分组**；全屏查看器；懒缩略图；≤899 侧栏折叠为横条；深色模式 |
| 资源库页面验收脚本 | `tools/cdp-library-page-test.py` | v1.2 | 已定稿 | **30/30**：种子渲染/计数、KPI、平台分布、博主速览、Top5、表格 8 列、日期分组、概览收起、筛选/搜索/排序、查看器、空态、900/860 响应式、控制台 0 error（TESTING §16） |
| 查看器 v2（S4） | `js/library/lightbox.js` + `js/library/video.js` + `js/library/keyboard.js` | v1.0 | 已定稿 | VRViewer：队列/图片缩放拖拽/信息面板/缩略图带；VRVideo：自绘控件（进度/时间/音量/倍速/全屏/连播）；VRKeys：输入框不劫持的统一键盘 |
| 查看器验收脚本 | `tools/cdp-viewer-test.py` | v1.0 | 已定稿 | **27/27**：图片缩放复位、信息面板、←/→ 切条、缩略图带、视频无原生 controls、Space、seek ±5/±30、↑/↓、连播、Esc（TESTING §17） |
| 查看器截图 | `deliverables/assets/{viewer-image,viewer-zoom,viewer-video}.png` | v1.0 | 已定稿 | 1440 图片 + 信息面板 + 缩略图带、156% 放大、视频自绘控件 |
| 删除与回收站（S5） | `js/library/trash.js` + `js/library/trash-ui.js` | v1.0 | 已定稿 | VRTrash：软删除批次/清单/恢复/彻底删除/清空/审计日志；VRTrashUI：右键菜单、`⋯`、回收站抽屉、确认框、Toast |
| 删除验收脚本 | `tools/cdp-trash-test.py` | v1.0 | 已定稿 | **27/27**：OPFS 句柄注入、移动/清单/索引/恢复/彻底删除/清空、无权限报错、右键菜单、确认框、抽屉恢复（TESTING §18） |
| 删除截图 | `deliverables/assets/{trash-menu,trash-confirm,trash-drawer}.png` | v1.0 | 已定稿 | 右键菜单、确认框、回收站抽屉（批次/恢复/彻底删除/清空） |
| 批量选择 + 重命名（S5b） | `js/library/batch.js` + `js/library/rename.js` | v1.0 | 已定稿 | VRBatch：`body.batch-mode` 驱动样式（不改网格 DOM）、浮条全选/取消/批量软删除、筛选搜索变化清空选择；VRRename：引擎 + 自绘弹窗、复制→校验大小→删源、扩展名保护、索引删旧写新、六种错误码 |
| 批量/重命名验收脚本 | `tools/cdp-batch-test.py` | v1.0 | 已定稿 | **47/47**：OPFS 句柄注入 + 真实文件；批量模式/勾选/全选/退出、重命名成功与六类错误码、批量删除进回收站（TESTING §19） |
| 批量/重命名截图 | `deliverables/assets/{batch-bar,rename-dialog}.png` | v1.0 | 已定稿 | 批量浮条（已选 2 项）+ 勾选态、重命名弹窗（默认选中文件名主体） |
| 图片悬停下载实现规格 | `docs/IMAGE-I1I2-IMPL.md` | v1.0 | 已定稿 | I1/I2 唯一口径：候选五级优先级、SW 消息协议、**DNR 补 Referer 的原因与写法**、错误码、实测结果与踩坑 |
| 图片工具（I1） | `js/lib-image-util.js` | v1.0 | 已定稿 | 纯函数（`self.VRImageUtil` / Node 可 require）：URL 规范化、占位图/SVG/data URI 判定、srcset 最大 w、五级候选去重、`scanImages` 过滤、扩展名推导 |
| 图片悬停按钮（I2） | `js/image-hover.js` | v1.0 | 已定稿 | content script：悬停 300ms 出「下载原图」、Shadow DOM 隔离、滚动/缩放/移开即隐藏、`imgHover` 开关、busy/done/fail 三态 |
| 图片下载 SW 分支 | `js/background.js`（`vrImg.resolve` / `vrImg.download`） | v1.1 | 已定稿 | 逐候选 fetch 校验 `content-type:image/*`、全失败回退最后一个；落 `video-rod/<平台>/<博主>/图片/<日期>_<标题>.<ext>`；**Referer 走 DNR 会话规则**（downloads 的 headers 会被拒） |
| 图片工具单测 | `tools/test-image-util.js` | v1.0 | 已定稿 | **58/58**：候选顺序与去重、srcset、扫描过滤、URL 规范化、扩展名 |
| 图片悬停验收脚本 | `tools/cdp-image-test.py` | v1.0 | 已定稿 | **34/34**：悬停出现/划过不出/移开隐藏、点击落盘 0.26s、路径与文件名、候选优先（a[href]/srcset/懒加载）、四类过滤、开关（TESTING §20） |
| 图片悬停截图 | `deliverables/assets/{image-hover-button,image-hover-done}.png` | v1.0 | 已定稿 | 悬停态「下载原图」贴图片右上角、完成态「✓ 已存」 |
| 图片批量下载实现规格 | `docs/IMAGE-I3-IMPL.md` | v1.0 | 已定稿 | I3 唯一口径：确认条/进度条状态机、`vrImg.batch` 协议、并发池/去重/上限、实测与 6 个产品坑 + 4 个测试坑 |
| 图片批量 UI（I3） | `js/image-batch.js` | v1.0 | 已定稿 | VRImgBatch：确认条（张数/过滤数/只下前 N 张）、底部进度条（done/total/失败数）、取消、Toast；对外暴露 VRImgBridge 给悬停条 |
| 悬停条扩展（I3） | `js/image-hover.js`（追加「全部 N」按钮） | v1.1 | 已定稿 | 同一 Shadow DOM 宿主内两个按钮；图宽 < 140px 时「全部 N」收成纯图标（数字在 aria-label）；修了 pending 未取消计时器与 CSS display 重复声明 |
| 批量下载 SW 分支（I3） | `js/background.js`（`vrImg.batch` / `vrImg.batchCancel`） | v1.2 | 已定稿 | 并发池（缺省 3、上限 8）、200ms 节流进度广播、可取消、失败不中断；去重表 vrImgDownloaded（2000 条淘汰）；DNR 规则 id 改单调递增 + 等下载终态再撤 |
| 批量队列单测 | `tools/test-image-batch.js` | v1.0 | 已定稿 | **27/27**：并发上限、只跑一次、失败/异常不中断、取消不再启动、去重跳过、上限截断、进度节流、去重键规范化、空批次 |
| 批量端到端验收脚本 | `tools/cdp-image-batch-test.py` | v1.0 | 已定稿 | **35/35**：悬停条两按钮、确认条、5 张真下载、路径/文件名/字节数、去重、上限 2、30 张取消、开关（TESTING §21） |
| 批量截图 | `deliverables/assets/{image-batch-hoverbar,image-batch-confirm,image-batch-progress}.png` | v1.0 | 已定稿 | 悬停条两个按钮、确认条（本页找到 5 张/已过滤 3 张）、进度条完成态 |
| 批量测试夹具 | `test-site/batch.html` + `test-site/batch-many.html` | v1.0 | 已定稿 | 5 张大图 + 小图 + 重复 + 坏图；30 张用于验证取消链路 |
| 前端统一设计方案 | `docs/FRONTEND-UI-SYSTEM.md` | v1.0 | 已定稿 | popup + 资源库共用 token/组件；现状审计、全宽布局、全屏查看器、响应式与实施记录 |
| 前端统一改造截图 | `deliverables/assets/{popup-after,library-page-grid,library-page-overview,library-page-cards,library-page-table,library-page-900,library-page-dark}.png` | v2.1 | 已定稿 | popup 蓝色统一；资源库 1440 默认（概览收起）/ 展开概览 / 大卡 / 表格、860 横条、深色 |
| 设置页重设计方案 | `docs/OPTIONS-REDESIGN.md` | v1.0 | 已定稿 | 现状审计（18 分区 / 151 个唯一 ID / 40 处内联样式 / 8 类问题）+ 四组信息架构 + 视觉 token + 组件规范 + 响应式断点 + 兼容清单 + 实施记录（TESTING §14） |
| 设置页重设计样式与交互 | `options.html` + `css/options.css` + `js/options.js` | v1.0 | 已定稿 | 四组侧栏与当前项高亮、分区卡片化、统一配置行/开关/按钮/表格；资源库拆三卡；危险操作独立红卡；<980px 顶部导航；深色 token；保存轻提示、开关/删除 aria；151 个 ID 与全部存储键保留 |
| 设置页重设计截图 | `deliverables/assets/options-redesign-{1440,900,dark,library,table,form,danger,about,full}.png` | v1.1 | 已定稿 | 1440×900 / 900×900 / 深色 / 资源库三卡 / 规则表 / 表单行 / 危险操作 / 关于页（上游与本 fork 增量）/ 整页长图；实测 0 横向溢出、0 控制台错误 |
| 资源库索引层（IDB） | `js/library/db.js` | v1.1 | 已定稿 | 新建。库 `vr-library` v1，五个 store：`file`（keyPath relPath，索引 platform/creatorId/type/mtime/starred）、`thumb`、`setting`、`handle`、`oplog`；SW 与页面共用，API 挂 `self.VRDB`；单连接缓存 + `onversionchange` 让路；v1.1 补 `getHandle/setHandle`（S2 快照/全量扫描复用授权） |
| 资源库 SW 入库服务 | `js/library/sw-library.js` | v1.0 | 已定稿 | 新建。预登记表存 `chrome.storage.session`（TTL 10 分钟、上限 500、200ms 节流），`downloads.onChanged` complete → 反查绝对路径 → 合并 meta 落 IDB → 广播 `vrLib.added`；处理 `vrLib.record/list/stats/clear`；忽略 `_verify/`、`_回收站/`；无根目录时用「预登记目录 + 实际文件名」兜底（覆盖 uniquify 改名）；重下同名文件保留星标/标签 |
| 自动入库端到端验收脚本 | `tools/cdp-index-test.py` | v1.0 | 已定稿 | **14/14**：清空索引 → 批量下载 → 轮询索引出现 → 字段校验（三段目录/平台/类型/大小/绝对路径/文件名/计数）+ 设置页索引状态自动刷新 + 控制台零错误；测完自动删文件+擦记录+清索引（TESTING §11） |
| 路径引擎单测 | `tools/test-path.js` | v1.1 | 已定稿 | **57/57**：4 个平台识别、类型推断、博主段、长度截断、`file://` 往返编码；v1.1 新增 9 条 `parseRelPath` 反解往返断言 |
| S1a 端到端验收脚本 | `tools/cdp-s1a-test.py` | v1.0 | 已定稿 | **17/17**：扩展加载 + 设置页 7 项 + 三段目录落盘 6 项 + 控制台零错误（TESTING §10） |
| 图片悬停下载调研 | `docs/IMAGE-DOWNLOAD-RESEARCH.md` | v0.1（已拍板） | 已定稿 | 参考 ClickSave / Imageye / Image Swooper / Cxrompix；三项拍板（双入口 / 清单面板 / 优先原图）+ 防盗链回退补强 |
| 图片下载后自动入库调研 | `docs/IMAGE-AUTO-INDEX-RESEARCH.md` | v0.1 | 已实现 | Downloads API 完成事件 + 预登记元数据（session storage）+ 懒缩略图；三方案对比、7 个坑与解法、数据契约、8 条验收。**已按方案落地并通过 14/14 验收**（TESTING §11） |
| 图片悬停下载方案 | `docs/IMAGE-DOWNLOAD-PLAN.md` | v1.2 | 待评审 | 三态交互、原图五级候选 + SW 校验回退 + DNR 补 Referer、批量队列；**v1.2 新增**尺寸档位（小/中/大/超大/自定义，按短边判定并显示命中数）与图集模式（自动滚动 + 分页翻页，10 页上限/可停止/连续 2 页失败中止） |
| 图片悬停下载原型 | `deliverables/prototypes/image-hover-prototype-v1.html` | v1.2 | 待评审 | 单文件零依赖：SVG 封面、悬停 300ms 出按钮、单张/全部/确认条/进度、浮标 + 清单面板（**尺寸档位**、图集加载下一页、过滤/勾选/批量）、键盘操作；**CDP 24/24** |
| 图片悬停原型截图 | `deliverables/assets/image-hover-v1-{hover,confirm,progress,panel,album}.png` | v1.2 | 已定稿 | 五态实拍：悬停按钮 / 全下确认条 / 批量进度 / 清单面板（档位+图集条） / 图集加载后 24 张 |
| 本地资源库方案（评审版） | `docs/LIBRARY-PLAN.md` | v2.0 | 已定稿（S0–S2 已实现） | 调研 + 架构选型 + 中文目录命名 + 数据模型 + 删除/迁移 + 开源 UX 取舍 + §11 审计指北 + §12 审计复核 + §13 实现规格 + §13.7 S0 实测 + §13.10 S1b 迁移规格 + **§13.11 S2 索引规格**（三源/快照/缺失语义/8 条验收）；v1.7 = 根目录定为 `<下载目录>\video-rod` 子目录 |
| 本地资源库交互原型 | `deliverables/prototypes/library-prototype-v1.html` | v1.3 | 待二次评审 | 单文件可交互原型（27 条演示数据）；视频键盘 ↑↓/←→ 与连播（**自绘播放控件**，解决原生 controls 吞键）；时间线视图、右键菜单、悬停预览、回收站；**v1.3 新增**：星标+只看星标、轻量标签 chips+标签筛选、J/K/Enter/F 键盘导航、灯箱缩略图带、进度条悬停时间气泡；内建「评审说明」 |
| M3 B站分P横幅截图 | `deliverables/assets/m3-bili-banner.png` | 2026-10-17 | 已定稿 | M7 回归时重拍为浅色版（12 分P横幅 + 展开态），与 final-m7-bili.png 同内容 |
| M4 YouTube 限制横幅截图（深色版） | `deliverables/assets/m4-yt-banner.png` | 2026-10-17 | 已归档 | 离线等效验证（域名映射）下的橙色警示横幅；浅色版见 final-m7-ytbanner.png |
| M5 图片弹层截图 | `deliverables/assets/m5-img-modal.png` | 2026-10-17 | 已定稿 | M7 回归时重拍为浅色版（2 张有效图，坏图/小图/重复图已滤掉），与 final-m7-imgmodal.png 同内容 |
| HLS 流媒体回归截图（深色版） | `deliverables/assets/hls-regress.png` | 2026-10-17 | 已归档 | m3u8 双清晰度卡 + 清晰度下拉；浅色版回归由断言集覆盖（hls 页 cardCount=2/qualities=2） |
| M6 全功能回归截图（深色版） | `deliverables/assets/final-{m1,hls,yt}.png` | 2026-10-17 | 已归档 | M6 深色版三页实拍；M7 浅色化后由 final-m7-* 五态截图取代 |
| 测试站页面 | `test-site/{index,hls,bili-fake,images,yt-fake}.html` | 2026-10-17 | 已定稿 | 五类测试夹具：直链视频/HLS/B站分P/图片批量/YouTube（域名映射） |
| 右键秒存 + 快捷键 | `js/init.js` + `js/background.js` + `manifest.json` | v1.0 | 已定稿 | M5 产物；两个一级右键菜单 + `vrSaveContextMedia()` + Alt+Shift+V |
| README 使用说明 | `README.md` §使用说明 | v1.2 | 已定稿 | M6 产物：九节大白话完整指引；M7 随浅色重设计更新（行展开改名/抓图位置/设置视图四组 9 项+高级工具） |
| 测试策略文档 | `docs/TESTING.md` | v1.4 | 已定稿 | M6 产物：用例表+回归清单+M2–M5 冒烟记录；M7 补浅色重设计全量回归记录 + 3 条新测试环境限制；M8 §7 补文件名保护星愿真机三链路记录 + 7 条新坑（星愿扩展 ID/下载目录/blob IPC 赛跑/X 懒加载/后台启动/hook 假阴性/重载方式）；**§10~§12 补 S1a / 自动入库 / S1b 三套验收** |
| 交接文档 | `docs/HANDOFF.md` | v2.1 | 已定稿 | 接手 AI 入口：项目规则 / 环境（含 git 身份参数、Chrome for Testing 路径）/ 代码地图与数据流 / **16 套 571 条**回归命令与基线 / 11 类坑（v2.1 新增 §6.7 多线并发覆盖、§6.8 行尾、Chrome 147 文件名保护失效）/ 未完成与技术债 / 文档索引 / 第一小时清单 / 恢复提示词 |
| M8 下载文件名保护 | `js/background.js` 记账+监听段 + `js/vr-download-hook.js`（新建）+ 4 个 HTML 挂载 | v1.1 | 已定稿 | 修「星愿忽略 filename」（Chromium bug 579563）：SW 侧 URL 预记账 Map + 自注册 onDeterminingFilename 三道防线 + `vrDownloadWithName()` 统一入口（3 处下载点改造）；页面侧 hook 等记账 IPC 应答后再下载；keep-on-take + 10 分钟 TTL + uniquify。ADR-027；v1.1 = 加固版（try/catch 防御 + 同 URL 重复下载不丢名） |
| M8 文件名保护验收脚本 | `tools/test-x-name-fix.py` | v1.0 | 已定稿 | 星愿真机三链路：popup blob（hook IPC）/ SW 直连（网络 URL）/ X 按钮（推文页懒加载等待+滚动触发）；判定落盘名=模板名+ffprobe 验双轨；加固回归（同 URL 双下载）内嵌 |
| M8 X(推特) 推文内联下载按钮 | `js/x-button.js` + `manifest.json` content_scripts + `background.js` handler | v1.0 | 已定稿 | 推文操作栏 [role=group] 注入按钮 → 后台查预混流直链（fxtwitter）→ 最高画质一键落盘；ADR-026 |
| M8 端到端测试脚本 | `tools/test-x-button5.py` | v1.0 | 已定稿 | 重载扩展→刷新推文页→等按钮→点击→轮询下载记录，星愿真机回归用 |
| M4 YouTube 验收脚本 | `tools/cdp-m4-test.py` | v1.0 | 已定稿 | M7 新建（M4 此前只有临时探针）；导航 `http://notyoutube.com:18080/`（必须带端口，见 TESTING §5），验 YT 横幅 + 嗅探卡片 + 浅色 |
| z 序回归探针 | `tools/probe-zorder.py` | v1.0 | 已定稿 | M7 新建；elementFromPoint 验证各浮层完整盖住底栏—— flex item z-index 陷阱的回归防线，改外壳 CSS 后必跑 |
| M7 归档截图工具 | `tools/shot-m7-final.py` | v1.0 | 已定稿 | 五状态归档截图（普通/设置/YT横幅/B站/图片弹层）；内建 settle+retry 绕 CDP 懒帧、显式 force 绕卡死过渡 |
| M7 回归截图（五态） | `deliverables/assets/final-m7-{plain,settings,ytbanner,bili,imgmodal}.png` | 2026-10-17 | 评审中 | 浅色重设计落地实拍：普通列表/设置 4 组视图/YT 警示横幅/B站 12 分P 展开/图片弹层 |
| YouTube 播放器下载 | `js/yt/{yt-page,yt-download,nsig-sandbox,fmp4-merge}.js` + `js/yt/{yt-download,nsig-sandbox}.html` + `lib/youtubei.min.js` + `background.js`(ytCollectFormats/ytOpen/ytFormats) | v1.0 | 评审中 | 播放器下方按钮 → 小窗选清晰度 → 双轨下载 → 容器级合并（不重编码）→ FSA 直写资源库三段目录。取格式按 MWEB→ANDROID→IOS→TVHTML5 轮替；n 参数在 sandbox 页解（MV3 禁 eval）；落盘优先 FSA、无授权退回下载器（ADR-039/040）。**待真机复验** |
| YouTube 拆包分析 | `docs/REF-YTB-TUBLY.md` | v1.0 | 已定稿 | Tubly(YTB.crx) 拆包：crx 内**没有**解析器（引擎走服务端）、WASM 是授权校验、可复用的 7 个代理层模式 |
| YouTube 可行性实测 | `docs/YT-FEASIBILITY.md` | v1.0 | 已定稿 | Web 客户端 0 条直链（SABR）→ 九种客户端矩阵 → 403 归因到 n 参数 → 47ms 解出 206+ftypdash；SABR 复放 200+EBML；三条路线技术账 |
| YouTube 实现与验收记录 | `docs/YT-IMPLEMENTATION.md` | v1.0 | 已定稿 | 文件地图 / 数据流 / 四个关键设计（小窗、沙箱、自写合并、FSA 落盘）/ 验证矩阵 / 已知限制 |
| YouTube 探针与验收脚本 | `tools/yt-{probe,clients,dl-test,feasibility,sabr,download-test,ext-test,shot}.py` | v1.0 | 已定稿 | 前五个是研究期探针（取格式/客户端矩阵/403 归因/SABR 复放）；`yt-download-test.py` 是离线端到端（21 条，进 full 套件）；`yt-ext-test.py` 真机级联；`yt-shot.py` 截图 |
| YouTube 验收截图 | `deliverables/assets/yt-button-injected.png` / `yt-download-window.png` | 2026-10-24 | 评审中 | 播放器下方按钮实拍 + 480×700 下载小窗实拍 |
| 图片浮标 + 清单面板（I4） | `js/image-panel.js` + `manifest.json` content_scripts + `docs/IMAGE-I4-IMPL.md` | v1.0 | 实施中（I3 回归 C1 红） | 浮标入口 + 清单面板；配套改 `image-batch.js` / `lib-image-util.js` / `TESTING.md` §22 / `cdp-run.py`；验收 `cdp-image-panel-test.py` 46/46、`test-image-tier.js` 57/57 |

> 登记规则：新产出物落地当天登记；状态变化当天更新；每完成一个 M 里程碑过一遍表。

## 5. 生命周期规则

1. **原型迭代**：新版直接覆盖旧版号位前的文件……不，**新版本建新号**（v6 就新建文件），旧版 `git mv` 进 `archive/prototypes/`，登记表更新路径
2. **文档定稿后要改**：走「ADEC 流程」——在 DECISIONS.md 追加一条 ADR 说明改什么、为什么，再改文档。保证「当初为什么这么定」永远可追溯
3. **审计/评审报告**：只追加不改写。新审计写新日期文件，老报告留着对照
4. **上游遗产**（cat-catch 的 README 多语言/截图/issue 模板/CHANGELOG）：已进 `archive/`，留证备查，不参与构建
5. **绝不随手删**：任何文件消失必须是「进了 archive」或「苏哥明确说可以删」

## 6. git 提交规则

| 规则 | 说明 |
|---|---|
| `.env` 等凭据 | 严禁入仓（.gitignore 已挡），泄了立刻去 GitHub 吊销重签 |
| 大文件（>1MB） | 图片/视频类产出物能压缩先压缩；确认不会频繁变的才进仓 |
| 生成物 | 图标预览图这类可再生成的产物，登记在册但可随时重生，不是源码 |
| 提交信息 | 说清「做了什么+为什么」，参照 git log 既有风格 |
| 每个 M 里程碑 | 一个提交节点，坏了能回滚 |
| 临时工作区 | `.work/` 已在 `.gitignore`；**禁止把 profile / 测试视频 / 临时草稿提交进仓** |
| 仓库外零散落 | 新增文件前先确认落点；项目文件不得放在 `E:\test\` 等仓库外的裸目录 |

## 7. 本规范的维护

- 规范本身也要版本化（文档头版本行），改规范 = 在 DECISIONS.md 补一条说明
- 苏哥觉得哪条规则别扭，随时说，改规范比憋着遵守重要
