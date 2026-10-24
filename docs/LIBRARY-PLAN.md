# video-rod 本地资源库 · 方案评审版 v1.5

> 版本：v1.5 ｜ 日期：2026-10-24 ｜ 状态：**待二次评审** ｜ 范围：方案 + 可交互原型 + P0 探针实测，不含产品代码
> 目标读者：评审人（外部审计）、Sunny姐姐（项目所有者）
> 配套原型：[library-prototype-v1.html](../deliverables/prototypes/library-prototype-v1.html)（单文件，双击即可打开）
> 关联文档：[REQUIREMENTS.md](REQUIREMENTS.md#L124-L131)（P1 #13 下载历史）、[PLAN.md](PLAN.md#L75)

> **给评审人的三句话**
> 1. 这不是要你评审代码，而是评审**方案是否成立**：Chrome 的限制是否被正确绕过、数据是否安全、交互是否够用。
> 2. 所有"能不能做"的判断都标注了证据来源（官方文档 / 本机实测 / 同架构开源项目）。**未实测的会明确写"待实测"，不写含糊话。**
> 3. 最想被质疑的是第 §11 节列的 5 个点，请优先打那里。

---

## 零、背景与现状（评审前必读）

### 0.1 项目是什么

`video-rod（钓鱼竿）` 是基于开源项目**猫抓（cat-catch）** fork 的个人自用 Chrome MV3 扩展。设计原则是「**外壳大改、内核不动**」：嗅探、下载器、m3u8 合并等核心逻辑沿用上游，只重做界面与新增本地资源库。

> **项目定位与复用策略（v1.4 最终版）**：本项目是**私有仓库、本机自用**的扩展，不上架、不分发、不对外提供。
> 上游 cat-catch 为 GPL-3.0，私有自用**不触发分发义务**，仓库保留上游 `LICENSE` 与署名即可。
> 因此**开源代码能抄就抄**：成熟实现优先直接复用（MIT / Apache-2.0 / GPL 均可），比自己重写更稳、更快；
> 只在"外部库与零构建约束冲突"或"通用组件不适配本项目交互"时，才改为自己实现。
> 下文 §2 与 §6.1 标为"参考"的开源项目，均可在实现阶段直接取用其源码，保留原版权声明即可。

### 0.2 现状盘点（避免误判"已经做了"）

| 能力 | 现状 | 证据 |
|---|---|---|
| 网页视频/图片嗅探 | ✅ 已有（猫抓内核） | `js/popup.js`、`js/background.js` |
| 下载到本地 | ✅ 已有（`chrome.downloads`） | `js/popup-videorod.js` |
| 智能命名 | ✅ 已有（站点规则 + 正文提取） | `js/naming.js`：`SITE_RULES` / `buildNameFromInfo` / `sanitizeName` / `dedupeNames` |
| 下载记录 | ⚠️ 只有去重表，**无元数据** | `vrDownloaded` 只存 `hash(路径) → {path, timestamp}`，用于标"✓ 已完成" |
| **本地资源库页面** | ❌ **不存在** | 无 `library.html`；`git log -S '资源库'` 零命中 |
| 自动打包链 | ❌ Windows 不可用 | 无 `package.json`；脚本依赖 bash / just / zip / crx3 / openssl |

> 结论：本次方案是**从 0 新增一个资源库页面**，不是改造已有功能。命名与下载链路复用现有代码，不改内核。

### 0.3 需求覆盖矩阵（评审可逐条打勾）

| # | 原始需求（Sunny姐姐原话） | 设计落点 | 章节 |
|---|---|---|---|
| R1 | 下载网页平台的各种图片和视频 | 复用猫抓嗅探，入口不变 | §1 |
| R2 | 同时管理已下载的资料，用资源库方式查看 | 新增 `library.html` 独立页面 | §3、§5 |
| R3 | 目录按 **平台 → 博主 → 图片/视频** 划分 | 三段目录 + 平台/博主/类型过滤 | §4.1 |
| R4 | 文件名按规范命名 | 日期前缀 + 标题 + 清晰度 + 序号 | §4.2 |
| R5 | 页面方便查看多平台多博主内容 | 侧栏平台/博主 + 博主速览卡 + 搜索 | §6 |
| R6 | 视频点开就能播放 | `<video>` 弹层 + `file://` 读取 | §5.2、§6 |
| R7 | 图片可以放大 | 灯箱 100%–400% 缩放、拖拽、双击复位 | §6 |
| R8 | 根目录单独文件夹、默认下载、**不每次授权** | Chrome 设置指定下载目录 + `downloads.search` 建索引 | §4.4 |
| R9 | 目录用**中文**名 | `B站 / 小红书 / X / YouTube / 其他网页` | §4.1 |
| R10 | 旧文件**可以自动迁移** | dry-run → 复制 → 校验 → 删源 → 日志 → 可回滚 | §5.4 |
| R11 | 要有管理能力，**要有删除权限** | 软删除进 `_回收站` + 恢复 + 清空 + 重命名 | §5.3 |
| R12 | 视频 **↑↓ 切换、←→ 进度** | 弹层键盘：↑↓ 切换、←→ ±5s（Shift ±30s）、空格、Esc | §6 |
| R13 | **自动播放、连续播放** | `ended` 事件接下一个 + 弹层开关 | §6 |
| R14 | 抄开源优秀交互，更方便更好用 | 8 项开源 UX 逐条取舍，**v1.3 起 6 项已落地原型**（另 2 项明确不做），且**只学交互、代码全部自研** | §6.1、§6.2 |

---

## 一、目标与非目标

### 目标
1. **下载即归档**：每次下载自动落到 `平台 / 博主 / 类型` 三段目录，文件名统一规范。
2. **浏览器内资源库**：一个扩展页面就能按「平台 → 博主 → 图片/视频」浏览全部已下载内容。
3. **即点即用**：视频点开就能播（可拖进度），图片点开能放大、缩放、切换上一张/下一张。
4. **零外部依赖**：不装服务、不传云端、不改猫抓内核。

### 非目标（v1 明确不做）
- 云同步、多设备、多用户
- AI 打标、人脸识别、语义搜索
- 视频转码、剪辑、去重合并
- 支持移动端（已封存）
- 自动删除/移动用户已有文件

---

## 二、开源方案调研

### 2.1 桌面素材管理器（Eagle 类）

| 项目 | 模式 | 优点 | 不适合本项目的原因 |
|---|---|---|---|
| **Eagle** | 商业，默认**拷贝**进库 | 体验最成熟，标签/评分/颜色筛选 | 收费；文件被拷走一份，与"下载目录就是库"冲突 |
| **Billfish** | 免费，支持拷贝/移动/**索引**三种模式 | 中文、支持 4K 视频预览、可索引原目录 | 需装独立桌面端；无法嵌进浏览器扩展；索引库是私有格式 |
| **TagStudio** | 开源（alpha），标签驱动 | 纯本地、标签体系灵活、不改原文件 | alpha 稳定性；无"平台/博主"概念，靠手工打标 |
| **digiKam** | 开源，摄影资产管理 | 元数据/EXIF 最强 | 面向照片工作流，视频与网页内容场景错位 |
| **Allusion** | 开源，监听文件夹 | 结构简单、可索引现有目录 | 官方版本更新缓慢；无平台维度 |

结论：**没有一款能直接满足"平台→博主→类型 + 浏览器内查看"**，且都不适合塞进扩展。

### 2.2 自托管媒体库（目录即相册）

| 项目 | 核心机制 | 可借鉴点 |
|---|---|---|
| **Photoview** | 只读扫描既有目录树 → 相册/缩略图 | **目录结构即数据源**、绝不改原文件、索引可重建 —— 与我们的思路一致 |
| **PiGallery2** | 目录即相册，轻量 | 目录层级即导航层级，实现成本低 |
| **Immich** | 重服务 + 手机备份 | 功能强但需 Docker、数据库，个人自用过重 |
| **Piwigo / Lychee** | 传统相册 | 面向公开发布，不是本地整理 |
| **FileBrowser** | 网页文件管理器 | 可参考列表/网格切换与路径操作，但没有媒体语义 |

结论：**Photoview 的"扫目录、只读、缩略图"模式最适合**。但完整跑一个服务对个人自用过重，除非库规模超过阈值。

### 2.3 前端交互组件

| 组件 | 用途 | 许可 |
|---|---|---|
| **PhotoSwipe 5** | 图片灯箱：缩放、手势、缩略图过渡动画 | MIT（**可直接引入** src 单文件版） |
| **justified-layout**（Flickr） | 等比行式瀑布流 | MIT（**可直接引入** 单文件 dist） |
| 原生 `<video>` | 视频播放、进度拖动、全屏 | 浏览器内置 |
| OffscreenCanvas / createImageBitmap | 本地缩略图生成 | 浏览器内置 |

> **复用策略（v1.4 最终版）**：PhotoSwipe 5 与 justified-layout **可以直接抄进来用**。
> 唯一要绕开的坑是工程形态：本项目无 `package.json`、无打包链，所以只能取**无需构建的成品文件**
> （PhotoSwipe 的 `dist/` UMD 版 + CSS、justified-layout 的单文件 dist），放进 `lib/` 并在页面里 `<script>` 引入，
> 同时保留其 LICENSE 与版权头。若某个版本只有 ESM/需要 bundler，才退化为自研等价实现（原型现有代码可直接顶上）。
> 判断标准就一条：**引入成本 < 自研成本就抄，否则自己写**，不做版权层面的取舍。

### 2.4 关键可行性实测（本机已完成）

| 问题 | 实测结果 |
|---|---|
| 扩展页面能否选本地目录 | ✅ `chrome-extension://<id>/popup.html` 里 `typeof showDirectoryPicker === "function"`，`isSecureContext === true` |
| 能否读取本地文件并播放 | ✅ `FileSystemFileHandle.getFile()` → `URL.createObjectURL(file)` → `<video>`/`<img>` 可直接用 |
| 是否有 MV3 限制 | 无 `fileSystem` 旧 API，但 **File System Access API 在扩展页面可用**；不能在 Service Worker 里用，必须在页面（用户手势）里调用 |
| 旧 `file://` 方案（列目录） | ❌ 无法枚举目录 → **不采用它做扫描**。`file://` 只用于"路径已知时的读取/播放"，见 §4.4 |
| `file://` 资源能否在扩展页面直接 `<img>/<video>` | ✅ **已实测通过（S0，2026-10-24，Chrome for Testing 147）**：`<img>` `naturalWidth=320`；`<video>` `readyState=4`、`duration=5.055`、`currentTime=2` 可写回读；见 §14 |

参考：[File System Access API 官方文档](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)、[File System Access API 打开目录](https://photoswipe.com/)（组件）、[Photoview 目录扫描模式](https://selfhosting.sh/best/photo-management/)、[Billfish 官方](https://www.billfish.cn/)、[TagStudio/Eagle 替代对比](https://www.refern.app/blog/best-eagle-alternatives-without-copying-files-2026)

---

## 三、三套架构对比与选型

| 维度 | **A. 纯扩展 + 目录授权（推荐）** | B. 扩展 + 本地索引服务 | C. 直接用 Billfish / Photoview |
|---|---|---|---|
| 安装 | 只需扩展 | 扩展 + Node/Python 常驻 | 装第三方软件 + 扩展 |
| 读取目录 | 用户选一次根目录，句柄存 IndexedDB | 服务端扫盘 | 第三方软件索引 |
| 缩略图 | 浏览器 canvas 生成，存 IndexedDB | ffmpeg 生成，质量最好 | 现成 |
| 视频播放 | blob URL，原生播放器，可拖进度 | HTTP Range，最稳 | 现成播放器 |
| 大库性能 | 1 万级文件可用；10 万级偏吃力 | 强 | 强 |
| 隐私 | 全本地、无网络 | 本地端口 | 取决于软件 |
| 开发量 | 中（一个新页面 + 扫描/索引模块） | 大（另做服务与打包） | 小，但无法定制平台/博主维度 |
| 维护 | 低 | 中（服务要跟着升级） | 低但受制于人 |

**选型：A 为 v1 主线。** 触发条件出现时再升级 B：
- 索引文件数 > 3 万，首屏扫描超过 3 秒
- 需要 HEVC/AV1 等浏览器不能直接解码的格式
- 需要稳定的大文件 HTTP Range 播放（超长 4K 视频）

C 作为兜底：如果哪天不想维护，直接让 Billfish 以"索引模式"指向同一个根目录即可，目录规范保证可平滑迁移。

---

## 四、目录与命名规范 v1

### 4.1 目录结构（文件系统即数据库）

```
<根目录>/                        用户自选，例如 D:\Media\video-rod
└── B站/
    └── 影视飓风(@946974)/
        ├── 视频/
        │   └── 20261024_一次看懂HDR_2160p.mp4
        └── 图片/
            └── 20261024_一次看懂HDR_01.jpg
└── 小红书/
    └── 小鱼的旅行日记(@xiaoyu123)/
        ├── 图片/
        └── 视频/
└── X/
    └── Elon Musk(@elonmusk)/
└── YouTube/
└── 其他网页/                   无法识别平台的普通网页
    └── example.com/            站点域名作为"博主"占位
```

规则（**已拍板：目录用中文**）：
- **平台段**：`B站 / 小红书 / X / YouTube / 其他网页`（与界面显示一致，一眼可读）
- **博主段**=`昵称(@ID)`，沿用 `naming.js` 的 `authorFull`；拿不到作者时用 `待整理`
- **类型段**：`视频 / 图片 / 音频 / 其他`
- 平台识别来自 `naming.js` 的 `SITE_RULES`；未命中则 `其他网页/<hostname>`

### 4.2 文件名规范

| 类型 | 模板 | 示例 |
|---|---|---|
| 单视频 | `${date}_${title}[_${quality}]` | `20261024_一次看懂HDR_1080p.mp4` |
| B站多P | `${date}_${title}_P${index}` | `20261024_合集_P03.mp4` |
| 批量图片 | `${date}_${title}_${index}` | `20261024_秋日穿搭_01.jpg` |
| 音频 | `${date}_${title}` | `20261024_播客第12期.m4a` |
| 无法取标题 | `${date}_${site}_${hash8}` | `20261024_其他网页_a1b2c3d4.mp4` |

- `date` 用 `YYYYMMDD`（可排序，避免"最新"排序依赖文件时间）
- 单段 ≤ 60 字符、总路径 ≤ 240（Windows 安全边界），沿用 `naming.js` 的 `sanitizeName`
- 重名自动 `_01 _02`（沿用 `dedupeNames`）
- 非法字符、保留名（CON/COM1…）同 `naming.js` 现有规则

### 4.3 与现有代码的衔接
- `js/naming.js` **不改**：新增目录变量 `${platform} ${creator} ${type}` 由新模块 `js/library-path.js` 在调用 `buildNameFromInfo` 前拼装
- 下载入口统一改为：`<根>/<平台中文>/<博主>/<类型中文>/<文件名>`
- **旧文件自动迁移**（已拍板）：见 §5.3，先 dry-run 预览，再执行，全程可回滚

### 4.4 根目录与 Chrome 的限制（必须说明）

**Chrome 不允许扩展把下载写到任意绝对路径。** `chrome.downloads.download({filename})` 的 `filename` 只能相对「浏览器设置的下载目录」。
因此"默认下到自定义根目录"的正确做法是：

1. 用户在 **Chrome 设置 → 下载内容 → 位置** 选一次 `D:\Media\video-rod`（一次性，不影响以后使用）
2. 扩展只写相对路径：`B站/影视飓风(@946974)/视频/20261024_一次看懂HDR_2160p.mp4`
3. 若用户希望维持原 Downloads 目录给其他下载用，可改用扩展的「另存为」模式（每个文件选一次，不推荐日常使用）

读取侧（避免每次启动授权）：
- 开启一次 **chrome://extensions → 本扩展 → 允许访问文件网址**
- 资源库用 `chrome.downloads.search()` 拿**绝对路径**建索引，再用 `file:///D:/Media/...` 直接显示/播放，**不需要每次启动重新授权目录**
- 目录授权（FSA）只在两种场景使用：**首次全量扫描**（历史里没有的文件）与**迁移旧文件**（需要写权限）

> **P0 前置探针（✅ 已于 2026-10-24 执行通过）**
> 用一个最小 MV3 扩展页面（`tools/probe-file-access/`）验证三件事，结果如下：
>
> | # | 探测项 | 判定 | 实测值 |
> |---|---|---|---|
> | 1 | `<img src="file:///E:/test/_vr-probe-media/probe.jpg">` | ✅ 通过 | `naturalWidth=320`、`naturalHeight=200` |
> | 2 | `<video src="file:///.../probe.mp4">` 播放 + seek | ✅ 通过 | `readyState=4`、`duration=5.055`、`currentTime=2` 写回读一致 |
> | 3 | `chrome.downloads.search()` 的 `filename` | ✅ 通过 | `D:\Users\liq21\Downloads\vr-probe-record.txt`（绝对路径） |
>
> **测试环境**：Chrome for Testing 147.0.7727.15（正式版 Chrome 155 已移除 `--load-extension`，无法命令行加载探针扩展）。
> **结论**：主线（`downloads.search` 绝对路径 + `file://` 直读）成立，**退化到 FSA 的路径不触发**。
> **正式版注意事项**：正式 Chrome 默认关闭"允许访问文件网址"，需用户一次性在 `chrome://extensions` 打开；
> 未打开时 `isAllowedFileSchemeAccess()` 返回 `false`，页面按 §13.6 的 `LIB_E_AUTH_LOST` 显示引导横幅。

**退化路径的真实代价（审计 ATK-08 成立，且比其描述更严重）**

Chrome 的持久权限（Persistent Permissions，Chrome 122+）行为是：目录句柄可存入 IndexedDB，但**跨浏览器会话后
`queryPermission()` 返回 `prompt`**，必须由用户手势再次授权。也就是说：

- 主线（`downloads.search` + `file://` 读）**不受影响**，仍满足"不每次授权"
- 但一旦 P0 探针失败、退化到 FSA，则**每次启动都要点一次授权** → 与用户 R8 直接冲突

**更隐蔽的闭环死锁（我独立复核时发现，审计未指出）**

方案说"下载历史被清空时用全量扫描重建索引"。但全量扫描需要 FSA 授权；而 FSA 跨会话失效。
于是形成死锁：**每次重建索引都要求用户授权一次**，且索引为空的时机（新装机、清历史、换电脑）恰恰最需要它。

破局办法（已采纳）：
1. **优先用 `downloads.search()` 重建**——历史清空后它也是空的，因此必须配合下条
2. **自建索引快照**：把索引本身存 IndexedDB，并在根目录写一份 `_library/index-<日期>.json`（人可读、可拷走）。
   索引丢失时优先读快照，**避免为了重建而要求授权**
3. 仅在"快照也不存在 + 目录里有非本扩展下载的文件"时，才要求一次性授权扫描 —— 这是唯一合理的授权时机

---

## 五、数据模型与索引

```js
// IndexedDB: vr-library
handle:  { key: 'root', handle: FileSystemDirectoryHandle }   // 仅扫描/迁移时用
file:    { key: relPath, absPath, platform, creator, creatorId, type,
           name, size, mtime, width?, height?, duration?,
           thumbKey?, sourceUrl?, title?, downloadId? }        // 索引条目
thumb:   { key: thumbKey, blob: Blob }                        // WebP 缩略图缓存
setting: { key, value }                                        // 排序偏好等
```

原则：
1. **文件系统是唯一真相**，索引可随时重建；删除索引不丢数据
2. 日常索引来自 `chrome.downloads.search()`：拿到 `absPath` + `url` + 时间，**无需目录授权**
3. 扫描采用**增量**：`size + mtime` 未变则复用旧条目
4. 缩略图只在**可见时懒生成**，按队列串行，避免一次性解码上千张
5. 索引记录 `creatorId`，博主改名不会把同一人拆成两个

**`creatorId` 提取规则必须逐平台定义，否则会分裂目录（审计 ATK-12 的真实形态）**

| 平台 | creatorId 来源 | 反例（**不得**作为 ID） |
|---|---|---|
| B站 | `space.bilibili.com/<mid>` 的 `mid`，或 `b23.tv` 短链解析后的 mid | 昵称（可改）、`?spm_id_from=` 等追踪参数 |
| 小红书 | `/user/profile/<user_id>` 路径段的 `user_id`（24 位 hex） | `xsec_token=` / `xsec_source=`（**每次分享都变，是分享凭证不是用户 ID**）、`xhslink.com/a/xxx` 短链 |
| X | `/i/user/<numeric_id>` 的数字 ID，或 `screen_name` | 昵称（可改）、`?s=` 追踪参数 |
| YouTube | `@handle` 归一到 `channelId`（`UC...`） | handle（可改） |
| 其他网页 | `hostname` 作为占位 | URL query 参数 |

规则：
- **ID 只从 URL 路径/已知稳定字段提取**，query 参数一律不参与
- 短链/分享链接解析不出稳定 ID 时，落到 `待整理` 目录，**不猜**
- 同一 `creatorId` 下昵称变更 → 只改目录显示名，不重建目录（保留旧目录 + 新目录并存时提示"疑似同一博主，是否合并"）

### 5.3 删除与管理（已拍板：要有删除权限）

**原则：默认软删除，永不直接抹掉文件。**

1. **删除单个**：卡片悬停 → 删除 / 灯箱右侧 → 删除 → 二次确认
2. **批量删除**：勾选多项 → 底部操作条「删除」→ 确认框显示数量与总大小
3. **软删除**：移动到 `<根>/_回收站/<日期>/<原相对路径>`，保留目录结构，便于原样恢复
4. **回收站**：侧栏入口显示条数与占用；支持单条恢复、全部恢复、清空（清空才真正删除）
5. **重命名**：灯箱内直接改文件名，保持所在目录不变；重名自动 `_01` 后缀
6. **打开所在文件夹 / 复制路径**：只读操作，随时可用

实现要点：
- 删除/重命名需要**写权限**（File System Access API），与迁移流程共用一次目录授权
- 若用户未授权写权限：删除按钮置灰并提示"需一次目录授权"，不静默失败
- 每次删除/恢复写日志 `<根>/_migration/ops-<日期>.json`，供排错与回滚
- 回收站超过 30 天或超过 5 GB 时提示清理，不自动删

安全边界：
- 二次确认必须显示**文件名与大小**，不使用"确定吗？"这类模糊文案
- 不提供"删除整个博主/平台"的一键操作，避免误伤
- 清空回收站需输入确认或二次确认，且明确"不可恢复"

> 技术说明：`chrome.downloads.removeFile()` 只能删除"本扩展经 Chrome 下载"的文件且无法恢复；因此统一走自建 `_回收站` 方案，保证可恢复，且对迁移进来的旧文件同样有效。

### 5.4 旧文件自动迁移（已拍板）

**入口**：资源库右上「整理旧文件」。

1. **建索引**：`chrome.downloads.search()` 全量拉取，按 `url` 反查平台；文件名解析 `作者_标题`
2. **生成计划（dry-run）**：旧路径 → 新路径，逐条标注
   - `可直接迁移`：目标不存在
   - `冲突跳过`：目标同名已存在（比较 size + mtime，不一致则跳过并记录）
   - `待整理`：平台无法识别的，进 `其他网页/待整理/`
3. **用户确认**后执行：复制 → 校验 → 删除源文件（不 `move`，避免半途失败丢文件）
   - **校验口径（对审计 ATK-15 的取舍）**：默认 `size` 比对 + **首尾各 64KB 采样比对**；不默认做全量 SHA-256。
     理由：复制不会改变内容，真正的失败模式是**截断/写入中断**，而截断必然导致 `size` 不符，`size` 即可捕获；
     全量 SHA-256 会让每个视频多读一遍磁盘，个人自用场景收益不抵成本。
     设置里提供「深度校验」开关（全量 SHA-256），仅在迁移极重要素材时手动开启。
   - **必须处理的异常（审计真正有价值的补充）**：`EBUSY`（杀软/云盘占用）、`ENOSPC`（空间不足）、
     权限中途撤销、进程被杀。任一发生即：**停止后续条目 → 不删任何源文件 → 保留已完成部分的日志 → 提示可回滚**
4. **写迁移日志**：`<根>/_migration/20261024-1830.json`，记录每条 old→new，用于回滚
5. **可回滚**：按日志反向复制，成功后删除新文件
6. 迁移需要**写权限**：一次性选择根目录授权；只在此流程与首次全量扫描时要求

安全边界：
- 只处理已知媒体扩展名（mp4/mkv/webm/m4a/mp3/jpg/png/webp/gif/avif）
- 跳过 `.part`、`.crdownload`、隐藏文件、`_migration/` 自身
- 不覆盖、不合并、不删除无法对应日志的文件
- 迁移前后各做一次数量与总大小比对，不一致即中止并提示

---

## 六、资源库页面设计（原型已实现）

### 布局
```
┌──────────────────────────────────────────────────────────────┐
│ 顶栏：资源库  [搜索........................]  网格/列表  ⚙    │
├──────────────┬───────────────────────────────────────────────┤
│ 平台          │ 面包屑：小红书 / 小鱼的旅行日记 / 图片          │
│  全部 1,284   │ ┌─ 博主速览（未选具体博主时）────────────────┐ │
│  B站    412   │ │ [头像] 名称 图片 120 · 视频 8  [封面拼图]  │ │
│  小红书 386   │ └─────────────────────────────────────────────┘ │
│  X      301   │ 工具栏：全部/视频/图片/音频  排序  批量         │
│  YouTube 115  │ ┌────┐ ┌────┐ ┌────┐ ┌────┐                    │
│  其他    70   │ │图片│ │视频│ │图片│ │图片│   ← 媒体网格        │
│               │ └────┘ └────┘ └────┘ └────┘                    │
│ 博主（当前平台）│                                                │
│  小鱼 126     │                                                │
│  ...          │                                                │
├──────────────┤                                                │
│ 根目录 D:\... │                                                │
│ 上次扫描 ...  │                                                │
└──────────────┴───────────────────────────────────────────────┘
```

### 交互清单
| 交互 | 行为 |
|---|---|
| 点平台 | 过滤该平台；博主列表随之切换；面包屑更新 |
| 点博主 | 只看该博主；媒体区显示全部类型 |
| 搜索 | 即时过滤标题/文件名/博主/平台，支持中文 |
| 类型页签 | 全部 / 视频 / 图片 / 音频（带数量） |
| 排序 | 最新 / 最旧 / 名称 / 大小 |
| 网格 ↔ 列表 | 网格看封面；列表看文件名、大小、路径 |
| 点图片 | 灯箱：滚轮缩放、拖拽平移、双击 100%/适应、← → 切换、Esc 关闭、右侧元数据 |
| 点视频 | 弹层内播放，可拖进度、全屏（**自绘控件**，不用原生 `controls`，原因见下方） |
| 视频键盘 | **↑/↓ 切换上一个/下一个视频**；**←/→ 后退/前进 5 秒**（按住 Shift 为 30 秒）；空格 播放/暂停；Esc 关闭。**必须用自绘控件，不能用 `<video controls>`**（见下方说明） |
| 连续播放 | 视频结束后自动播放下一个，可在弹层内开关；播到最后一个时停止并提示 |
| 浏览方式 | **平铺 / 按日期**（时间线视图：今天 / 昨天 / 具体日期分组，组头带当天数量） |
| 右键卡片 | **上下文菜单**：播放视频 / 放大查看、打开所在文件夹、复制相对路径、重命名、移到回收站（网格与列表通用） |
| 悬停视频 | 停留 550ms 后卡片内静音循环预览，移开即停止并销毁（避免一次性加载大量视频） |
| 悬停卡片 | 显示 播放/放大、复制路径、定位文件、**删除** |
| **星标收藏** | 卡片右上角 `★` 一键收藏/取消；列表行左侧同步；右键菜单也有"加星标/取消星标"；灯箱与视频弹层内按 `F` 直接切换（v1.3） |
| **只看星标** | 工具栏星标按钮开关，叠加在当前平台/博主/搜索/标签筛选之上，不重置其他条件（v1.3） |
| **标签 chips** | 卡片正文区显示轻量标签（如 `旅行`/`教程`）；工具栏"全部标签"下拉按标签筛选；标签集合由数据动态生成，不写死（v1.3） |
| **键盘优先网格** | `J`/`K` 上下移动高亮（不打开）、`Enter` 打开高亮项、`F` 星标高亮项、`/` 聚焦搜索；高亮项自动 `scrollIntoView`；Tab 聚焦卡片时高亮同步（v1.3） |
| **灯箱缩略图带** | 灯箱底部横向缩略图条，当前项白框高亮并自动滚到可视区，点击直达任意一张（v1.3） |
| **进度条时间气泡** | 鼠标悬停视频进度条任意位置，浮出该位置的 `mm:ss` 时间提示，不改变播放位置；按住拖动才 seek（v1.3） |
| 批量 | 勾选后浮出操作条：全选 / 复制路径 / 导出清单 / **删除** |
| 回收站 | 侧栏入口显示条数与占用；单条恢复 / 全部恢复 / 清空（不可恢复） |
| 重命名 | 灯箱内改文件名，目录不变，重名自动加序号 |
| 命名规则 | 顶部"命名规则"打开说明弹窗，含模板变量与实时预览 |
| 重新授权 | 根目录失联时，横幅提示"重新授权目录"（一次点击） |

> **为什么必须自绘控件（审计 ATK-21，已实测确认）**
> 原生 `<video controls>` 获得焦点后，Chrome 会**内建**响应键盘：↑↓ 调音量、←→ 跳 5 秒、空格 播放/暂停。
> 这些是浏览器内部行为，JS 的 `preventDefault()` / `stopPropagation()` **拦不住**，结果是"双触发"：
> 按 ↓ 会同时降音量并切视频；按空格会切换两次（看起来像没反应）。
> 因此实现方案：**移除 `controls`，自绘播放条**（播放/暂停、进度条、时间、静音、全屏），
> 并给 `<video>` 设 `tabindex="-1"`，让键盘事件完全由页面接管。
> 原型 v1.2 已按此改造，实测 40 项断言：video 被聚焦时 ↓ 仍正常切视频、音量不变、空格只切换一次。

### 状态与边界
- 空目录 / 无结果：显示引导文案与"重新扫描"
- 权限失效：横幅提示，不弹错误弹窗
- 大库：分页渲染（每页 60 张，滚动加载）
- 浏览只读：不做剪辑/转码；删除走回收站，可恢复
- 时间线视图下批量选择、删除、重命名与平铺完全一致（同一套 data-id 渲染）

### 6.1 可直接借鉴的开源 UX（v1.3：6 项已落地原型）

| # | 做法 | 来源（仅交互参考） | 适配理由 | 复杂度 | 原型状态 |
|---|---|---|---|---|---|
| 1 | 时间线/日期分组浏览 | Photoview、Immich | 现在只有"平台→博主"两个维度，找"最近下载的"要靠排序猜；按日期分组最直观 | 低 | ✅ 已实现（工具栏「按日期」） |
| 2 | 右键上下文菜单 | FileBrowser | 卡片 hover 按钮只有 3 个，重命名/播放/复制路径分散；右键是桌面用户肌肉记忆 | 低 | ✅ 已实现（网格/列表通用，含星标项） |
| 3 | 视频卡片悬停静音预览 | Billfish | 封面是视频首帧，分辨内容效率低；悬停预览是素材工具标配 | 中 | ✅ 已实现（550ms 触发） |
| 4 | 灯箱底部缩略图带 | PhotoSwipe 5 | 一张张点左右切换效率低；缩略图带可直接跳转 | 中 | ✅ 已实现（当前项白框 + 自动滚入视野） |
| 5 | 收藏/星标 + 仅看星标 | Allusion、TagStudio | 比标签体系轻，个人自用够用；快速圈出"要用的素材" | 低 | ✅ 已实现（按钮 + 右键 + `F` 键三入口） |
| 6 | 键盘优先：`/` 搜索、`J/K` 移动、`Enter` 打开、`F` 星标 | Allusion、FileBrowser | 素材浏览是高频重复动作，键盘比鼠标快一个数量级 | 低 | ✅ 已实现（含高亮滚动、Tab 焦点同步） |
| 7 | 拖动进度条上的章节/关键帧缩略图 | Billfish | 长视频定位依赖缩略图时间轴；需要逐帧解码 + 缓存，成本高 | 高 | ❌ 不做；**已落地低成本替代**：进度条悬停时间气泡（`mm:ss`） |
| 8 | 标签/评分/人脸 | TagStudio、digiKam | 完整标签体系与评分需要人工持续维护，个人自用是负担 | 高 | 🟡 **只取轻量标签 chips + 标签筛选**（自动生成、零维护）；评分/人脸明确不做 |

> **取舍原则**：只借**能让"找→看→管"三步更短**的交互；不借需要长期人工维护元数据的重型功能。
> 第 8 项之所以只做"轻量标签"：标签值来自已有的平台/博主/内容类型语义，不需要用户额外录入即可用；
> 一旦引入"自定义标签 + 评分 + 人脸聚类"，就变成需要持续投入的资产管理工作，与个人自用的目标冲突。

### 6.2 抄代码策略（私有自用，能抄就抄）

私有库、本机自用、不分发，因此**代码层面可以直接复用开源实现**。取舍只看工程成本，不看许可：

| 场景 | 做法 |
|---|---|
| 成熟组件有**无需构建**的成品文件（UMD/单文件 dist） | **直接抄进 `lib/`**，页面 `<script>` 引入，保留原 LICENSE 与版权头 |
| 组件只有 ESM / 依赖 bundler | 二选一：抄其核心算法改写成 IIFE，或直接用本项目已有实现（原型可顶上） |
| 通用组件的交互与本项目特有需求冲突（视频键盘、平台/博主维度） | 抄它的交互设计，代码自己写（改造成本更低） |
| 上游猫抓已有的能力（嗅探/下载/合并/命名） | **一律复用，不改内核**（ADR-001、ADR-015） |

**判断标准**：`引入成本（含调试、CSP、打包） < 自研成本` 就抄，否则自己写。
`lib/third-party-libraries.md` 已登记现有第三方库，新增时同步登记来源、版本、许可。

**为什么不再坚持"全部自研"**：那是上一版我自己加的约束，苏哥没要求过。
成熟组件的边界情况（手势、缩放惯性、缩略图过渡）都是别人踩过的坑，重写等于把坑再踩一遍。

---

## 七、分阶段实施

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P1 目录与命名** | 下载路径改为 `平台/博主/类型`（中文）；文件名加日期前缀；B站多P `_P##`；根目录 = 用户在 Chrome 设置里选定的下载目录 | 单测覆盖 path 生成；真实下载 3 个平台各 1 个文件落位正确 |
| **P2 资源库 MVP** | `library.html`：`downloads.search` 建索引 → 网格/筛选/搜索 → 图片放大 / 视频播放（file:// 读取） | 1,000 文件内首屏 < 2s；视频可拖进度；图片可缩放 |
| **P3 增强 + 迁移** | 缩略图缓存、列表视图、批量、排序、失联提示、导出清单、**时间线视图**、**右键菜单**、**视频悬停预览**、**旧文件自动迁移**、**删除/回收站/重命名**、**星标+只看星标**、**轻量标签+标签筛选**、**J/K/Enter/F 键盘导航**、**灯箱缩略图带**、**进度条时间气泡** | 10,000 文件扫描不阻塞 UI；迁移/删除前后数量与大小一致 |
| **P4 可选** | 本地索引服务（B 方案）、完整标签体系/评分（仅当 P3 的轻量标签不够用时再评估） | 按需启动 |

---

## 八、风险与对抗性审查

| 风险 | 影响 | 缓解 |
|---|---|---|
| Chrome 不允许写任意绝对路径 | 无法"默认下到自定义目录" | 用户在 Chrome 设置里一次性指定下载目录；扩展只写相对路径（§4.4） |
| "允许访问文件网址"未开启或版本受限 | 图片/视频无法显示 | 启动时检测 `chrome.extension.isAllowedFileSchemeAccess()`；未开启则显示一次性引导横幅，退化为 FSA 授权读取 |
| 下载历史被清空 | 索引缺失 | 优先读 `_library/index-<日期>.json` 快照重建；快照也没有时才要求一次 FSA 扫描（见 §4.4 死锁分析） |
| 一次性扫描大目录卡顿 | 白屏 | Web Worker 扫描 + 分页渲染 + 增量索引 |
| 视频缩略图解码慢/失败 | 网格空白 | 懒生成 + 失败占位 + 并发上限 2 |
| 超大视频播放不稳 | 无法播放 | 优先用 `file://` 原生播放（支持 Range）；失败项引导"用系统播放器打开" |
| 迁移中断 | 文件半途丢失 | 先复制后删除 + 大小校验 + 日志 + 回滚；不 `move` |
| 迁移覆盖同名文件 | 数据丢失 | 目标已存在一律跳过并记录，绝不覆盖 |
| 博主改名导致目录分裂 | 同一人两个目录 | 索引以 `creatorId` 归并显示；`creatorId` 逐平台从 URL 路径提取（§5），query/token 参数一律不参与；短链落 `待整理` |
| 原生 `<video controls>` 吞键盘 | ↑↓ 切视频失效或双触发 | 移除原生 `controls`，自绘播放条 + `tabindex="-1"`（§6 已实测） |
| 迁移校验只看大小 | 截断文件被误判为成功 | 大小 + 首尾 64KB 采样；提供深度 SHA-256 开关 |
| 迁移遇 `EBUSY`/`ENOSPC`/权限撤销 | 半途失败 | 停止后续条目、不删源文件、保留日志、提示回滚 |
| 企业策略锁定下载目录 | 用户无法改到自定义根目录 | 启动时读取 `chrome.downloads` 记录与策略迹象；不可改时提示"改用另存为模式"，不静默失败 |
| 回收站与第三方索引工具冲突 | Billfish 等把回收站文件当正常素材 | `_回收站` 目录名以下划线开头 + 写 `.nomedia` 标记 + 文档说明排除该目录 |
| 项目许可证为 GPL-3.0（上游） | 私有自用不触发分发义务 | 仓库保留上游 LICENSE 与署名；**不分发**；第三方代码保留其版权声明（§6.2） |
| 中文目录兼容性 | 个别同步/压缩工具乱码 | Windows/macOS 主流工具均支持；迁移日志用 UTF-8；不支持时改为拼音（保留开关） |
| 文件名超长 | Windows 失败 | 沿用 60 字/段 + 240 路径上限 |
| 用户误删 | 数据丢失 | **默认软删除进 `_回收站`**；二次确认显示文件名；清空才永久删除 |
| 未授权写权限 | 删除/迁移失败 | 按钮置灰并提示一次授权，不静默失败 |
| 隐私 | 上传风险 | 全程本地；缩略图不联网；不请求平台接口 |
| 与猫抓内核冲突 | 下载链路回归 | 目录拼装放在独立模块，下载钩子只改路径参数 |

**对抗性结论（v1.2 修订，不再说"没有阻断项"）**

- ✅ 已消除：「每次启动重新授权」——主线靠 `downloads.search` 建索引 + `file://` 直读，配合 §4.4 的索引快照破死锁
- ✅ 已消除：原生视频控件吞键盘——改为自绘控件，已在原型实测
- ✅ **已消除（S0 实测）**：`file://` 直读通过——图片 `naturalWidth=320`、视频 `readyState=4` 且可 seek、
  `downloads.search` 返回绝对路径。退化到 FSA 的路径**不触发**；仅需用户一次性打开"允许访问文件网址"
- ✅ 已解除：GPL-3.0 义务——本项目为**私有库、本机自用、不分发**，上游许可不产生分发义务；
  仓库保留上游 LICENSE 与署名即可。第三方代码按 §6.2 直接复用并保留其版权声明
- ⚠️ 需用户接受的一次性设置成本：改 Chrome 下载目录（企业策略锁定时可能改不了）
- ✅ 迁移数据风险：先复制后删 + 大小/采样校验 + 日志 + 回滚 + 不覆盖 + 异常即停

**结论：P0 探针已于 2026-10-24 全部通过（§4.4 / §13.7），方案成立，可进入 S1（路径与下载落位）。**

---

## 九、验收标准（后续实现时按此测）

1. 命名/路径单测：平台、博主（有/无 ID）、多P、批量序号、非法字符、超长、保留名
2. 目录扫描：1k / 10k 文件耗时与内存
3. 资源库交互：平台切换、搜索、类型页签、排序、网格/列表
4. 媒体：图片 100%–400% 缩放与拖拽；视频播放/暂停/拖动/全屏
5. 视频键盘：↑↓ 切换顺序与当前筛选一致；←→ 正确 ±5 秒且不越界；空格播放/暂停
6. 连播：开启时播完自动下一个，最后一个停止并提示；关闭时不自动切换；队列随平台/博主/搜索变化
7. 浏览增强：按日期分组正确（今天/昨天/具体日期）；视频卡片悬停预览出现且移开即停止；右键菜单五项操作均可用
8. 权限：首次开启文件访问、下载历史为空时全量扫描、目录改名/移动后的失联提示
9. 迁移：dry-run 与实际结果一致；中断后可回滚；同名文件不被覆盖
10. 删除：单个/批量均二次确认；删除后进回收站可恢复；清空后不可恢复；无写权限时按钮置灰
11. **路径编码**：目录名含中文、`@()`、空格、`#`、`%` 时，拼出的 `file://` URL 在扩展页面能正常显示图片/播放视频
12. **视频键盘真实性**：video 元素被点击聚焦后，↑↓ 仍切换视频、音量不变、空格只切换一次（防原生控件双触发）
13. **索引韧性**：清空 `chrome.downloads` 历史后，能从 `_library/index-*.json` 快照恢复，不要求重新授权
14. **条目失联**：手动移动/改名文件后，资源库标为"失联"而非静默播放失败
15. **星标**：卡片/列表/右键/`F` 四个入口状态一致；「只看星标」与平台、博主、搜索、标签筛选叠加后结果正确；取消星标后若正处于"只看星标"则该项即时移出列表
16. **键盘导航**：`J`/`K` 只移动高亮不打开；`Enter` 打开当前高亮项；`F` 切换当前项星标；高亮项在长列表滚动时始终可见；在输入框/下拉框内按 `J/K/F` 不触发导航
17. **灯箱缩略图带**：条数与当前筛选下的图片数一致；当前项唯一高亮且自动滚到可视区；点击第 N 张后计数、主图、信息栏三处同步
18. **标签筛选**：标签集合由数据动态生成（不写死）；筛选后所有结果都含该标签；与星标/搜索叠加不互相重置
19. **进度条时间气泡**：仅悬停显示、不改变播放位置；气泡时间与进度条比例一致；鼠标移出即隐藏；视频元数据未加载时不显示错误时间

---

## 十、已拍板（2026-10-24）

1. **根目录**：单独设置一个文件夹（例如 `D:\Media\video-rod`），作为 Chrome 下载目录；扩展只写相对路径
2. **不要求每次启动授权**：靠 `downloads.search` + `file://` 读取；目录授权只在首次全量扫描与迁移时使用
3. **目录用中文**：`B站 / 小红书 / X / YouTube / 其他网页`，类型 `视频 / 图片 / 音频`
4. **旧文件自动迁移**：先 dry-run，再执行；日志 + 回滚 + 不覆盖
5. **资源库入口**：popup 设置里 + 可固定为独立标签页（按建议）

### 仍需你确认的小项
- 根目录具体盘符与路径（用于原型与后续默认值）
- 是否接受"一次性在 Chrome 设置里把下载目录改到该文件夹"

---

## 十一、给评审人的审计指北

### 11.1 请优先质疑这 5 点（方案成败在这里）

| # | 质疑点 | 若判断为"不成立"的后果 | 本方案的回答 | 需要评审人做什么 |
|---|---|---|---|---|
| Q1 | **"不每次授权"是否真能成立？** 依赖"Chrome 设置里固定下载目录 + `downloads.search` 拿绝对路径 + `file://` 直读" | 若 `file://` 在扩展页面读不了，就得每次启动选目录（用户明确不接受） | §4.4：读取走 `downloads.search`（不需授权）；`file://` 直读**已实测通过**（S0），退化路径不触发 | 判断这个链路是否还有未覆盖的失败模式 |
| Q2 | **`file://` 直读**（原"未实测"） | 核心体验（点开即播）可能退化 | ✅ **S0 已实测通过**：`<img>` 与 `<video>` 都能直读，`downloads.search` 返回绝对路径（§4.4 / §13.7） | 复核探针结果与测试环境（Chrome for Testing 147）是否可信 |
| Q3 | **迁移旧文件有数据风险** | 可能弄丢用户历史文件 | §5.4：dry-run → 复制 → 校验大小 → 删源 → 日志 → 可回滚 → 不覆盖 | 检查是否有遗漏的失败分支（断电、权限中途撤销、同名但内容不同） |
| Q4 | **删除权限的边界** | 误删不可恢复 | §5.3：默认软删除进 `_回收站`，二次确认显示文件名+大小，清空才永久删 | 判断"清空回收站"是否需要更强的确认（如输入文件名） |
| Q5 | **平台/博主识别准确率** | 目录分错、博主分裂 | 复用 `naming.js` 的 `SITE_RULES`；拿不到作者落 `待整理`；索引存 `creatorId` 归并 | 指出哪些平台无法稳定识别作者 |

### 11.2 评审方法与材料

1. **先读本文 §0.3 需求覆盖矩阵**，逐条确认"需求 → 设计"没有漏项。
2. **再打开原型**：`deliverables/prototypes/library-prototype-v1.html`，双击即可（单文件、无需服务器、无需扩展环境）。
3. 原型内的 **「评审说明」按钮（右上角 ?）** 列出了所有可操作项、快捷键与原型边界。
4. 原型是**纯前端演示**：数据为内置 27 条演示数据，媒体为远程样本；不代表真实文件系统行为。

### 11.3 原型能验证 / 不能验证什么

| 已验证（原型内可操作） | 不能验证（需真实扩展环境） |
|---|---|
| 平台/博主/类型/搜索/排序的过滤逻辑 | 真实文件读取与播放（`file://` / FSA） |
| 图片灯箱缩放、拖拽、切换 | 真实下载落盘路径是否正确 |
| 视频键盘 ↑↓ 切换、←→ 进度、连播 | 真实长视频的精确 ±5s 步进（原型样本仅 5.05 秒） |
| 删除确认、回收站恢复、重命名 | 写文件系统的权限行为 |
| 迁移预览（dry-run 文案与统计） | 迁移的实际复制/校验/回滚 |
| 时间线分组、右键菜单、悬停预览 | 大库（万级）性能 |
| **星标、只看星标、标签筛选与叠加逻辑** | 星标/标签的持久化（IndexedDB 读写） |
| **`J/K/Enter/F` 键盘导航与高亮滚动** | 与浏览器默认快捷键在真实扩展页面的冲突 |
| **灯箱缩略图带跳转、进度条时间气泡** | 真实长视频的时基精度 |

### 11.4 已知限制（不回避）

1. **必须一次性改 Chrome 下载目录**：Chrome 不允许扩展写任意绝对路径，这是浏览器硬限制，不是设计选择。
2. **必须一次性开启"允许访问文件网址"**：S0 已实测 `isAllowedFileSchemeAccess=true` 时直读可用；
   正式 Chrome 默认关闭该开关（Chrome for Testing 默认为开），需用户在 `chrome://extensions` 手动开一次。
3. **目录句柄不能跨浏览器重启持久化**：这是 Chrome 的限制，因此不把 FSA 作为日常读取路径。
4. **下载历史被清空会导致索引缺失**：提供"全量扫描"重建，但历史 URL 等元数据无法恢复。
5. **v1 不做**：云同步、AI 打标、视频转码、移动端。
6. **项目是私有自用库**（`LICENSE` 为上游 cat-catch 的 GPL-3.0）。私有使用、不分发，**不触发分发义务**；
   仓库保留上游 LICENSE 与署名即可。这不是"以后要开源"的承诺，而是当前的使用形态。
   因此第三方代码可以**直接复用**（§6.2），只需保留其版权声明；不因许可问题牺牲实现质量。
7. **企业策略可能锁死下载目录**（`DefaultDownloadDirectory`）：公司电脑上可能无法改到自定义根目录，
   此时只能用"另存为模式"，与"不每次授权"的体验目标冲突。
8. **原型不是产品**：原型用公网图片/视频样本，评审时可能因网络出现灰块或等待，不代表实现效果。

### 11.5 希望评审人产出的结论

- 每条 Q1–Q5：**成立 / 有风险 / 不成立**，附理由与替代方案
- §0.3 需求覆盖矩阵：是否有漏项或理解偏差
- 是否同意进入实现阶段（P0 探针 → P1 目录命名 → P2 资源库 MVP → P3 增强）

---

## 十二、对审计报告的独立复核（项目方回应）

> 审计方在《LIBRARY-PLAN-审计方案》中提出 28 条对抗性攻击（ATK-01~28），其中 6 条标为 S1 阻断。
> 本节是**项目方逐条独立复核**的结论——不是照单全收，也不辩解，凡是成立的直接改方案。

### 12.1 复核结论摘要

| 结论 | 条数 | 说明 |
|---|---|---|
| 成立，已修订方案 | 2 | `file://` 直读未验证、FSA 跨会话失效 |
| 成立但已解除 | 1 | GPL-3.0：私有库自用不分发，不触发分发义务（v1.4 更正） |
| 问题真实但因果描述有误，已修正定义 | 1 | creatorId 分裂（不是 `xsec_token` 导致） |
| 部分成立，采纳"轻量版"而非原建议 | 2 | 迁移校验（不采纳全量 SHA-256）、中文与特殊字符路径（降级为实现细节） |
| **新增、审计未指出** | 3 | 索引重建死锁、回收站与第三方索引冲突、`downloads` 记录与 `filename` 不一致 |

**严重度重判**：6 条 S1 中，真正"进 P1 前必须先做"的只有 1 条——`file://` P0 探针。
FSA 属条件性（仅当探针失败才触发）；GPL-3.0 因**私有库自用不分发**而不构成阻断（v1.4 更正）；
另外 3 条是实现期必须写对的细节，**不构成整体阻断**。

### 12.2 逐条复核（审计的 6 条速查项）

| 项 | 审计判断 | 我的复核 | 处理 |
|---|---|---|---|
| `file://` 直读 | S1 阻断 | **成立，已实测解除**。S0 探针（Cft 147）：`<img>` `naturalWidth=320`、`<video>` `readyState=4` 且 `currentTime=2` 可写回读、`downloads.search` 返回绝对路径 | §4.4 与 §13.7 记录实测值；Q2 关闭 |
| 中文 + `@()` 路径 | S1 阻断 | **部分成立，降级**。NTFS 支持 Unicode 与 `@()`；`chrome.downloads.download` 拒绝的是 `:*?"<>\|`，不是中文。真正要写对的是：本地路径 `\`→`/` 后逐段 `encodeURI` 才能拼成合法 `file://` URL（`#`、`%`、空格必须转义） | 归入实现检查单，不列为阻断 |
| FSA 跨会话 | S1 阻断 | **成立且更严重**。持久权限只到"同一会话"，跨会话 `queryPermission()` 返回 `prompt`。方案主线不依赖 FSA，但退化的代价必须写明 | §4.4 增"退化真实代价"；并补破死锁方案 |
| creatorId 稳定性 | S1 阻断 | **问题真实，因果错**。`xsec_token` 是分享凭证、每次都变，但它不是用户 ID；正确 ID 在 `/user/profile/<user_id>` 路径段。真实风险是**短链解析不出 ID** | §5 增逐平台提取规则；短链落 `待整理`，不猜 |
| 迁移大小校验 | S1 阻断 | **部分成立**。复制不改内容，"大小相同而内容不同"概率极低；真正失败模式是**截断**，而截断必然 size 不符。全量 SHA-256 会让每个视频多读一遍盘 | 采纳：size + 首尾 64KB 采样 + 深度校验开关；补 `EBUSY`/`ENOSPC`/权限撤销的处理 |
| cat-catch LICENSE | S1 阻断 | **成立，已解除**。已核实 `LICENSE` 首行为 GPL-3.0（上游 2.0 起从 MIT 转 GPL v3）。本项目为**私有库、本机自用、不分发**，不触发分发义务 | §11.4 第 6 条按"私有自用"口径重写；§8 风险行同步 |

### 12.3 我不采纳的部分（附理由）

1. **迁移全量 SHA-256**（ATK-15 的原始建议）
   - 不采纳理由：成本 = 每个视频额外完整读一遍磁盘（500MB × 数百个 = 数分钟到数十分钟），
     收益 = 只覆盖"内容不同但大小恰好相同"这一极低概率事件。
   - 替代：size + 首尾各 64KB 采样（能覆盖截断、头部损坏、尾部损坏）；设置里留深度校验开关。
2. **把中文目录路径列为 S1 阻断**
   - 不采纳理由：这是 URL 拼装实现细节，写对一次就不会复发，不具备"方案可能整体失败"的性质。
   - 但**接受它的提醒价值**：已在验收标准里加"路径含中文/`@()`/空格时 `file://` 可读"一条。

### 12.4 审计没指出、我补的三点

| # | 问题 | 为什么比审计的某些 S1 更危险 |
|---|---|---|
| N1 | **索引重建死锁**：全量扫描需要 FSA 授权，FSA 跨会话失效 → 每次重建索引都要授权一次；而"索引为空"恰恰是最需要重建的时刻 | 审计只说"FSA 退化与承诺冲突"，没看到它与"清空下载历史"叠加后形成死循环 |
| N2 | **回收站污染第三方索引**：`_回收站` 在库根目录下，Billfish/Photoview 会把软删除文件当正常素材 | 直接破坏"目录即数据源"这一核心前提 |
| N3 | **`downloads.search` 的 `filename` 与真实文件可能不同步**：用户"另存为"改名、或手动移动文件后，downloads 记录的路径会失效 | 会让资源库出现"点开播放失败"的坏条目，且不报错 |

对应处理：N1 → §4.4 索引快照；N2 → `_` 前缀 + `.nomedia`；N3 → 启动时校验存在性，失效条目降级为"失联"并提供重新定位。

### 12.5 我认可审计做得好的地方

- 用"构造攻击"而非"阅读挑错"的方式审查，逼出了 ATK-21（原生控件吞键）这类**只有动手才会发现**的问题。
  **这一条是本轮最有价值的发现**，原型因此从"能用"变成"真的能用"，已实测修复。
- 时间盒 + 三态结论表 + 5 分钟速查表，让审计可执行、可复现，这套方法建议保留到实现阶段验收。

---

## 十三、实现规格（开工即写码，不留待研究项）

> 本节是 v1.4 新增的**实现级规格**：文件清单、模块职责、函数签名、数据结构、状态机、错误码、接入点全部定死。
> 原则：**括号级细节可以边写边调，接口与数据契约定死后不再改**。所有模块均为普通 `<script>`（IIFE + 全局命名空间），零构建。

### 13.1 文件清单（新增 / 修改）

**前端（资源库页面）**

| # | 文件 | 类型 | 职责 | 依赖 |
|---|---|---|---|---|
| 1 | `library.html` | 新增 | 资源库独立页面：顶栏/侧栏/网格/列表/时间线/灯箱/视频弹层/右键菜单/批量条/回收站/迁移弹窗 | 下列全部 js + css |
| 2 | `css/library.css` | 新增 | 页面样式（沿用 popup 浅色变量） | — |
| 3 | `js/library/path.js` | 新增 | 目录拼装、相对/绝对路径互转、`file://` URL 编码、长度与保留名校验 | `naming.js`（仅 `sanitizeName`） |
| 4 | `js/library/db.js` | 新增 | IndexedDB 封装（file/thumb/setting/handle/oplog 五个 store） | — |
| 5 | `js/library/indexer.js` | 新增 | 三源建索引（downloads.search / 快照 / FSA 全量扫描）+ 失效条目核对 + 快照写回 | `db.js`、`path.js`、SW 桥 |
| 6 | `js/library/thumbs.js` | 新增 | 缩略图队列（并发 2、懒生成、失败占位、WebP 缓存） | `db.js` |
| 7 | `js/library/trash.js` | 新增 | 软删除、恢复、清空、重命名（走 FSA 写权限） | `db.js`、`path.js` |
| 8 | `js/library/migrate.js` | 新增 | 迁移 dry-run / 执行 / 校验 / 回滚（日志 JSON） | `db.js`、`path.js` |
| 9 | `js/library/ui.js` | 新增 | 状态容器 + 过滤/排序/渲染（网格、列表、时间线、侧栏、博主速览） | `db.js` |
| 10 | `js/library/lightbox.js` | 新增 | 图片灯箱：缩放、拖拽、切换、缩略图带、信息栏 | `ui.js` |
| 11 | `js/library/video.js` | 新增 | 视频弹层：**自绘控件**、↑↓ 切换、←→ ±5s（Shift ±30s）、空格、连播、进度气泡 | `ui.js` |
| 12 | `js/library/keyboard.js` | 新增 | 全局键盘路由：`/` `J/K` `Enter` `F` `Esc`，按弹层优先级分发 | `ui.js`、`lightbox.js`、`video.js` |
| 13 | `js/library/bridge.js` | 新增 | 页面 ↔ SW 消息桥：超时、重试、错误码归一 | `chrome.runtime` |
| 14 | `js/library/settings.js` | 新增 | 资源库设置读写（`chrome.storage.local` 的 `vrLibSettings`） | — |
| 15 | `lib/`（可选） | 新增 | PhotoSwipe 5 / justified-layout 的**无需构建成品文件**（按 §6.2 能抄就抄） | — |

**后端（Service Worker 侧）**

| # | 文件 | 类型 | 职责 |
|---|---|---|---|
| 16 | `js/sw-library.js` | 新增 | SW 侧资源库服务：索引快照落盘、文件操作（删除/恢复/迁移/重命名）、打开所在文件夹、批量查询 downloadId → 绝对路径 |
| 17 | `js/background.js` | 修改（仅顶部 1 行） | `importScripts("js/sw-library.js")`；不改任何内核逻辑 |
| 18 | `manifest.json` | 修改 | `permissions` 增 `unlimitedStorage`；`web_accessible_resources` 放行 `library.html` 所需的本地资源（如需）；`options_ui` 不变 |

**接入现有功能**

| # | 文件 | 类型 | 改动 |
|---|---|---|---|
| 19 | `js/popup-videorod.js` | 修改 | 下载前用 `VRPath.buildRelPath()` 拼 `平台/博主/类型/文件名`，再交给 `vrDownloadWithName` |
| 20 | `popup.html` / `options.html` | 修改 | 各加一个「打开资源库」入口（`chrome.tabs.create({url: 'library.html'})`） |
| 21 | `lib/third-party-libraries.md` | 修改 | 新增引入组件时登记来源/版本/许可 |

**测试**

| # | 文件 | 类型 | 用途 |
|---|---|---|---|
| 22 | `tools/cdp-library-test.py` | 新增 | 资源库页面 CDP 回归（对应 TESTING §8 的 A–I 九组） |
| 23 | `tools/probe-file-access/` | 新增（临时） | P0 探针扩展（见 §13.7），验证完可删 |

### 13.2 现有代码接入点（已核实，非猜测）

| 能力 | 真实入口 | 规格 |
|---|---|---|
| 命名引擎 | `js/naming.js` → `buildNameFromInfo(info, url, opts)`，`opts = {tpl, ext, index, date, keepEmoji}`；返回**可能带 `/`** 的路径串（内部 `sanitizeName(..., {keepPath:true})`） | 资源库**不重复实现命名**：先 `buildNameFromInfo` 得到文件名段，再由 `VRPath.buildRelPath()` 拼三段目录 |
| 导出方式 | `js/naming.js` 尾部 `return {...}`，以 UMD 形式挂 `self.VideoRodNaming` / `module.exports` | `path.js` 通过 `self.VideoRodNaming.sanitizeName` 取用，不复制其实现 |
| 下载入口 | `js/background.js` → `vrDownloadWithName(url, filename, extra)` → `Promise<downloadId \| null>`；内部 `vrQueueFilename(url, filename, conflictAction)` | 资源库页面**统一走这个入口**，不直接调 `chrome.downloads.download`（否则星愿下文件名会丢，见 ADR-027） |
| 设置存储 | `js/popup-videorod.js` → `chrome.storage.local`，键 `vrSettings` / `vrRecentDirs` | 资源库用**新键** `vrLibSettings`，不与 popup 设置混写 |
| 权限 | `manifest.json` 已有 `downloads` / `storage` / `scripting` / `tabs` | 仅需补 `unlimitedStorage`（缩略图缓存） |
| SW 形态 | `background.service_worker = js/background.js`（无 `type: module`） | 只能用 `importScripts`，不能用 `import` |
| content script | `js/content-script.js` 全站 `document_start`；`naming.js` 仅 x.com 注入 | 资源库页面**不注入**任何 content script，纯扩展页运行 |

### 13.3 数据契约

**IndexedDB：`vr-library`（version 1）**

```js
file:    keyPath "relPath"
         索引: platform / creatorId / type / mtime / starred
         字段: relPath, absPath, platform, platformName, creatorFull, creatorId,
               type, fileName, size, mtime, width?, height?, duration?,
               thumbKey?, sourceUrl?, title?, downloadId?, starred(0|1), tags(string[]),
               state: "ok" | "missing"
thumb:   keyPath "thumbKey"     字段: blob(WebP), w, h, at
setting: keyPath "key"          字段: value
handle:  keyPath "key"          字段: handle(FileSystemDirectoryHandle)
oplog:   keyPath "id" autoInc    字段: at, op, payload, result   // 迁移/删除审计
```

**设置键（`chrome.storage.local` → `vrLibSettings`）**

```js
{
  rootLabel: "D:\\Media\\video-rod",   // 仅显示用，真实根目录由 Chrome 下载设置决定
  sort: "new", view: "grid", group: "none",
  autoplay: true, hoverPreview: true,
  thumbQuality: 0.72, thumbMaxEdge: 480,
  deepVerify: false                    // 迁移时是否追加 SHA-256
}
```

**消息协议（页面 → SW → 页面）**：统一信封 `{ action, payload }`，SW 回 `{ ok: true, data }` 或 `{ ok: false, code, message }`

| action | 入参 | 出参 data | 说明 |
|---|---|---|---|
| `vrLib.ping` | — | `{version}` | 就绪探测 |
| `vrLib.resolvePaths` | `{downloadIds: number[]}` | `{ [id]: absPath }` | `downloads.search` 批量取绝对路径 |
| `vrLib.listDownloads` | `{since?: number, limit?: number}` | `FileMeta[]` | 增量拉取下载记录 |
| `vrLib.writeSnapshot` | `{json: string}` | `{absPath}` | 写 `_library/index-<日期>.json` |
| `vrLib.readSnapshot` | — | `{json, at} \| null` | 读最新快照 |
| `vrLib.openFolder` | `{absPath}` | `{ok}` | 打开所在文件夹（`downloads.show` 或 shell 兜底） |
| `vrLib.trash` | `{relPaths: string[]}` | `{moved, failed: [{relPath, code}]}` | 软删除（FSA 写权限） |
| `vrLib.restore` | `{trashPaths: string[]}` | `{restored, failed}` | 恢复 |
| `vrLib.purge` | `{confirm: "PURGE"}` | `{removed}` | 清空回收站（不可恢复） |
| `vrLib.rename` | `{relPath, newName}` | `{relPath}` | 同目录改名 |
| `vrLib.migratePlan` | `{mapping}` | `Plan` | dry-run |
| `vrLib.migrateRun` | `{planId}` | `Log` | 执行 |
| `vrLib.migrateRollback` | `{logId}` | `{rolledBack, failed}` | 回滚 |

### 13.4 模块 API（签名定死）

```js
// path.js
VRPath.PLATFORM_DIR = { bilibili:"B站", xiaohongshu:"小红书", x:"X", youtube:"YouTube", web:"其他网页" };
VRPath.TYPE_DIR     = { video:"视频", image:"图片", audio:"音频" };
VRPath.buildRelPath({ platform, creatorFull, creatorId, type, fileName }) -> string   // 三段+文件名，已 sanitize
VRPath.parseRelPath(relPath) -> { platform, creatorFull, creatorId, type, fileName }
VRPath.toFileUrl(absPath) -> string        // 每段 encodeURI，转义 # % ? 空格
VRPath.checkLength(relPath) -> { ok, total, overflow }
VRPath.creatorSegment(creatorFull, creatorId) -> string   // "影视飓风(@946974)"；缺 ID 时用 "待整理"

// db.js
VRDB.open() -> Promise<IDBDatabase>
VRDB.putFiles(files[]) / VRDB.getAllFiles() / VRDB.getFile(relPath)
VRDB.patchFile(relPath, patch) / VRDB.deleteFiles(relPaths[])
VRDB.putThumb(key, blob, w, h) / VRDB.getThumb(key)
VRDB.getSetting(key, def) / VRDB.setSetting(key, v)
VRDB.getHandle() / VRDB.setHandle(h)
VRDB.log(op, payload, result) / VRDB.listLogs(limit)

// indexer.js
VRIndex.build({ mode: "downloads" | "snapshot" | "full" }, onProgress) -> Promise<{total, ok, missing}>
VRIndex.reconcile() -> Promise<{missing: string[]}>      // 校对 existsSync 等价：FSA 能读才算存在
VRIndex.snapshot() -> Promise<string>                    // 生成并写回快照

// thumbs.js
VRThumbs.enqueue(fileEntry) / VRThumbs.pump() / VRThumbs.clear()
// 并发 2；失败标 thumbKey=null 并显示类型占位，不重试超过 1 次

// trash.js
VRTrash.softDelete(relPaths[]) -> Promise<{moved, failed}>
VRTrash.restore(trashPaths[]) -> Promise<{restored, failed}>
VRTrash.purge() -> Promise<{removed}>
VRTrash.list() -> Promise<TrashItem[]>

// migrate.js
VRMigrate.plan({mapping}) -> Promise<Plan>               // items: {from, to, action:"move"|"skip"|"conflict", size}
VRMigrate.run(planId, onProgress) -> Promise<Log>
VRMigrate.rollback(logId) -> Promise<{rolledBack, failed}>

// ui.js
VRUI.state  = { platform, creator, type, q, sort, view, group, starredOnly, tag, focusId }
VRUI.filter(state) -> FileEntry[]
VRUI.render() / VRUI.setView(v) / VRUI.setGroup(g) / VRUI.setTag(t)
VRUI.toggleStar(relPath) / VRUI.setFocus(relPath|null) / VRUI.moveFocus(step)

// video.js
VRVideo.open(entry, queue) / VRVideo.switch(step) / VRVideo.seekBy(sec) / VRVideo.toggle() / VRVideo.close()
// 控件全部自绘；<video tabindex="-1">；ended 时按 queue 顺序自动下一个

// lightbox.js
VRLightbox.open(index, list) / VRLightbox.paint() / VRLightbox.nav(step) / VRLightbox.zoomBy(d) / VRLightbox.close()

// bridge.js
VRBridge.call(action, payload, {timeout=8000}) -> Promise<data>
// 超时 / SW 未就绪 / 无响应分别归一为 LIB_E_TIMEOUT / LIB_E_SW_DOWN / LIB_E_NO_HANDLER
```

### 13.5 状态机

| 对象 | 状态迁移 |
|---|---|
| 索引 | `EMPTY` →(build) `BUILDING` →(成功) `READY`；无快照且无授权 → `DEGRADED`（横幅：重新授权目录）；快照过期 → `STALE`（后台增量补齐） |
| 条目 | `OK` →(文件消失/移动) `MISSING` →(重新定位) `OK`；`MISSING` 只标灰、不自动删除索引 |
| 删除 | `ACTIVE` →(软删除) `TRASHED` →(恢复) `ACTIVE`；`TRASHED` →(清空) `PURGED`（不可逆） |
| 迁移 | `PLANNED` →(复制) `COPYING` →(校验) `VERIFIED` →(删源) `SOURCE_DELETED` → `DONE`；任一步异常 → `ABORTED`，允许从日志回滚 |
| 视频 | `IDLE` →(open) `LOADING` →(canplay) `READY` →(play) `PLAYING` ⇄ `PAUSED` →(ended) `ENDED` →(next) `LOADING`；`ENDED` 且无下一项 → `FINISHED` |

### 13.6 错误码与降级矩阵

| 码 | 触发 | 用户可见文案 | 降级动作 |
|---|---|---|---|
| `LIB_E_NO_PERM` | FSA 写权限未授予 | 需要一次性授权目录才能删除/迁移 | 按钮置灰 + 授权引导 |
| `LIB_E_AUTH_LOST` | 会话重启后 `queryPermission()="prompt"` | 目录授权已失效 | 横幅重授权；读路径不受影响（`file://` 仍在） |
| `LIB_E_FILE_GONE` | 条目对应的物理文件不存在 | 文件已不在原位置 | 标 `MISSING`，提供"重新定位" |
| `LIB_E_PATH_TOO_LONG` | 拼装后 > 240 字符 | 路径过长，已自动截断标题 | 缩短标题段 + 保留序号 |
| `LIB_E_ENOSPC` | 迁移/写入时磁盘满 | 磁盘空间不足，已停止 | 停止后续条目，不删源，保留日志 |
| `LIB_E_EBUSY` | 文件被占用（杀软/播放器） | 文件被其他程序占用 | 重试 1 次后跳过该条，继续其余 |
| `LIB_E_HASH_MISMATCH` | 深度校验不一致 | 复制校验失败 | 不删源，标冲突，允许回滚 |
| `LIB_E_SNAPSHOT_STALE` | 快照日期早于最近下载 | 索引可能不是最新 | 后台增量补齐，不阻塞浏览 |
| `LIB_E_TIMEOUT` / `LIB_E_SW_DOWN` | SW 未启动/繁忙 | 后台未就绪，正在重试 | 指数退避重试 2 次后提示 |

### 13.7 P0 前置探针（✅ 已执行：2026-10-24，全部通过）

**形式**：`tools/probe-file-access/` 最小 MV3 扩展（`manifest.json` + `background.js` + `probe.html` + `probe.js`），
加载后打开 `chrome-extension://<id>/probe.html`，点「开始探测」；结果写入 `window.__PROBE__`，供 CDP 读取。

**执行结果**

| # | 探测 | 判定 | 实测 |
|---|---|---|---|
| 1 | `<img src="file:///E:/test/_vr-probe-media/probe.jpg">` | ✅ 通过 | `naturalWidth=320`、`naturalHeight=200` |
| 2 | `<video src="file:///.../probe.mp4">` + seek | ✅ 通过 | `readyState=4`、`duration=5.055`、`currentTime` 设为 2.0 后读回 2.0 |
| 3 | `chrome.downloads.search({limit:5})` | ✅ 通过 | `filename = D:\Users\liq21\Downloads\vr-probe-record.txt`（绝对路径） |

**环境**：Chrome for Testing 147.0.7727.15，独立 profile，`--load-extension` 加载。
**为什么不用正式 Chrome 155**：Chrome 137+ 移除了 `--load-extension`（即使加 `--disable-features=DisableLoadExtensionCommandLineSwitch` 也无效），
无法命令行加载探针扩展；日常使用仍走"开发者模式手动 Load unpacked"。
**正式版差异**：正式 Chrome 的 `isAllowedFileSchemeAccess` 默认为 `false`，需一次性手动开启；探针环境为 `true`。

**结论**：三项全过 → **主线成立，退化路径不触发**。§4.4 的备选方案保留，仅作为未来 Chrome 收紧策略时的预案。
**执行要求（已满足）**：结果同步写回 `docs/TESTING.md` §9。

### 13.8 组件取用决策（能抄就抄）

| 组件 | 决策 | 理由 |
|---|---|---|
| **PhotoSwipe 5** | **抄**：取 `dist/` UMD + CSS 进 `lib/` | 手势/缩放惯性/过渡动画成熟，自研边界情况多 |
| **justified-layout** | **抄**：取单文件 dist | 等比行式布局算法简单但调参烦，直接复用 |
| 视频弹层与键盘 | **自研** | 原生 `controls` 会吞 ↑↓/空格（§6 已实测），任何通用播放器都不满足"↑↓ 切队列" |
| 缩略图带 | PhotoSwipe 自带则用；否则用原型实现 | 避免重复造轮子 |
| 右键菜单 / 星标 / 标签 | **自研** | 与平台/博主筛选强耦合，通用组件改造成本更高 |
| 缩略图生成 | 浏览器原生 `createImageBitmap` + `OffscreenCanvas` | 无替代库必要 |

### 13.9 实施与提交切分（每步可独立验收）

| 步骤 | 内容 | 产出 | 验收 | 建议提交信息 |
|---|---|---|---|---|
| **S0** ✅ | P0 探针 | 探测扩展 + 结果记录 | **已完成 2026-10-24，三项全过**（§13.7） | `chore: P0 探针——file:// 直读与 downloads 绝对路径实测` |
| **S1** | `path.js` + 下载路径接管 | 新下载自动落三段中文目录 | `node tools/test-naming.js` 全绿 + 真机下 3 个平台各 1 个文件 | `feat(library): 下载落位改为 平台/博主/类型 三段中文目录` |
| **S2** | `db.js` + `indexer.js` + `sw-library.js` | 索引可建、可重建、有快照 | 1k 文件首屏 < 2s；清空下载历史后仍能列出 | `feat(library): 索引服务——downloads/快照/全量三源 + 快照破死锁` |
| **S3** | `library.html` + `ui.js` + `thumbs.js` | 可浏览、可筛选、可搜索 | TESTING §8 的 A/C/D 组 | `feat(library): 资源库页面——平台/博主/类型/标签/星标浏览` |
| **S4** | `lightbox.js` + `video.js` + `keyboard.js` | 看图/看视频/键盘 | TESTING §8 的 E/F/H/I 组 | `feat(library): 灯箱与视频弹层——缩略图带 + 自绘控件键盘` |
| **S5** | `trash.js` + `migrate.js` + 右键菜单 | 删除/恢复/迁移 | TESTING §8 的 B/G 组 + 迁移 dry-run 与回滚 | `feat(library): 删除回收站与旧文件迁移——可恢复、可回滚` |

> 每一档都必须：`git status` 干净 → 测试通过 → 截图归档 → 才进下一档。**不允许一次提交跨两档。**

---

## 十四、版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-10-24 | 初版：调研、架构选型、目录命名、数据模型、删除与迁移 |
| v1.1 | 2026-10-24 | 新增 §0 背景与需求覆盖矩阵、§6.1 开源 UX 取舍；落地视频键盘/连播、时间线视图、右键菜单、悬停预览；修正 §2.4 与 §4.4 关于 `file://` 的表述矛盾；新增 §11 审计指北 |
| v1.2 | 2026-10-24 | **回应审计报告**：新增 §12 独立复核（6 条 S1 逐条判断 + 3 处不采纳理由 + 3 处审计未发现项）；§5 增 `creatorId` 逐平台提取规则；§5.4 校验改为 size+首尾采样并补异常处理；§6 视频改为自绘控件（ATK-21 已实测修复）；§4.4 增 FSA 退化代价与索引重建死锁破解；§8 风险表 +7 条；§11.4 增 GPL-3.0 与策略锁目录；对抗性结论改为"2 条条件性阻断" |
| v1.3 | 2026-10-24 | **开源交互全量落地**：② §6 交互清单新增星标、只看星标、标签 chips、J/K/Enter/F 键盘导航、灯箱缩略图带、进度条时间气泡；③ §6.1 八项开源 UX 中 6 项标 ✅、1 项以时间气泡替代、1 项只取轻量标签；④ 新增 §6.2"只学交互、不抄代码"实现边界；⑤ §7 P3 补入新增交互；⑥ §9 验收新增 15–19 五条；⑦ §11.3 补"能验证/不能验证"三行；① 曾按"已公开开源"口径改写许可证段落 |
| v1.4 | 2026-10-24 | **口径定稿 + 实现规格**：① 确认项目为**私有仓库、本机自用、不分发**，GPL-3.0 不触发分发义务；§0.1 明确"**开源代码能抄就抄**，按引入成本择优"；② §2.3 改为可直接引入 PhotoSwipe 5 / justified-layout 的无需构建成品；③ §6.2 从"只学交互不抄代码"改写为"抄代码策略"；④ 新增 §13 实现规格（前后端文件清单、模块职责、函数签名、数据结构、错误码、状态机、P0 探针、S0–S5 提交切分），确保开工前无待研究项 |
| v1.5 | 2026-10-24 | **S0 探针实测通过**：`<img>`/`<video src="file://">` 直读、视频 seek、`downloads.search` 返回绝对路径三项全过（Chrome for Testing 147）；§2.4/§4.4/§8/§11.1/§11.4/§12.2/§13.7/§13.9 同步关闭待实测项；对抗性结论中的"条件性阻断 1"解除；记录正式 Chrome 需手动开"允许访问文件网址" |
| —— | —— | 注：v1.3 曾按"已公开开源"改写、并自加"全部自研"约束；v1.4 均已作废，以 v1.4 为准 |

