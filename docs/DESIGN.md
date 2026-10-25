# 苏哥的钓鱼竿 — 技术设计文档

> 版本：v1.0 ｜ 日期：2026-10-17 ｜ 状态：已确认（苏哥拍板）
> 配套：REQUIREMENTS.md（需求）、PLAN.md（方案书）、BUILD-PLAN.md（施工计划）、TESTING.md（测试）

---

## 1. 总体架构

Chrome MV3 扩展，沿用猫抓底座的三件套，新功能以**独立模块挂在壳上**：

```
┌────────────────────────────────────────────────────────┐
│ popup（面板 UI）        ← 大改：卡片/筛选/批量/目录chip  │
│   ↓ 读                                            ↑    │
│ options（设置页）       ← 加：默认目录/命名模板/开关     │
├────────────────────────────────────────────────────────┤
│ content script          ← 加：YouTube 页面变量读取、     │
│                         图片扫描、右键菜单数据            │
├────────────────────────────────────────────────────────┤
│ service worker          ← 加：下载调度(目录/去重/队列)、  │
│ (background.js)          B站解析、右键秒存、快捷键       │
├────────────────────────────────────────────────────────┤
│ 猫抓内核（不动）                                        │
│   嗅探引擎 init.js ｜ 下载器 m3u8.js ｜ 合并 在线FFmpeg  │
│   （注意：在线FFmpeg=远程第三方服务，见 §8 合并路线）      │
└────────────────────────────────────────────────────────┘
         ↕ chrome.storage.local（设置/去重记录/最近目录）
```

**核心设计原则**：
1. **外壳大改、内核不动**——猫抓的嗅探引擎、下载器、FFmpeg 合并链路一律不碰，保证随时 cherry-pick 上游站点适配更新
2. **独立模块挂载**——每个新功能一个模块文件，一个模块坏不影响其他，可单独开关
3. **失效兜底**——B站/YouTube 主动抓取失败自动退回嗅探模式，永远有得下

## 2. 模块划分与边界

> ⚠️ **阅读须知**：本章是**早期设计稿**（2026-10 初），标注「（新）」的是**当时计划**的文件。
> 实际实施时部分文件改了名或合并了能力，**判断现状请以代码为准**，或用 `python tools/check-doc-sync.py` 核查。
>
> 已知差异（2026-10-25 核实）：
> | 设计稿写的 | 实际落点 |
> |---|---|
> | `js/image-scanner.js`（新） | 能力在 `js/lib-image-util.js`（纯函数扫描）+ `js/image-hover.js` / `js/image-batch.js` / `js/image-panel.js` |
> | `js/bilibili.js`（新） | **未单独建**：走「嗅探增强」路线（ADR-019），能力在 `js/popup-videorod.js` / `js/x-button.js` |
> | `js/youtube.js`（新） | **实际是 `js/yt/yt-page.js`** + `yt-download.js` / `fmp4-merge.js` / `nsig-sandbox.js` |

| 模块 | 文件（规划） | 职责 | 依赖 |
|---|---|---|---|
| 智能起名引擎 | `js/naming.js`（新） | 页面识别（文章/推特/B站/小红书）→ 取标题/正文/作者 → 模板填充 → 清洗（非法字符/截断60字/重名序号/空段清理） | 无（纯函数） |
| 面板 UI | `popup.html/js/css`（改） | 媒体卡片（徽章/元信息/文件名输入/目录chip/清晰度下拉/分P展开）、类型筛选行、底部批量操作栏、设置抽屉 | naming.js、storage |
| 下载调度 | `js/function.js` 下载段（改） | `chrome.downloads.download({filename: "子目录/名字.ext"})`、批量队列（错峰）、去重记录写入 | naming.js、storage |
| m3u8 合并 | `m3u8.html` 相关（不动） | ts 碎片 → 合并 MP4，产物沿用自定义文件名。⚠️ **猫抓的合并是「在线FFmpeg」远程服务**（ffmpeg.bmmmd.com / ffmpeg.94cat.com，init.js:213 实锤），不是本地 wasm；lib/ 目录无 ffmpeg.wasm。隐私影响与三条路线见 §8 | 猫抓原生（远程） |
| 图片扫描器 | `js/image-scanner.js`（新） | DOM 扫描（img/srcset/背景图/懒加载/shadow DOM）+ 尺寸过滤 + MutationObserver | 无 |
| 右键秒存 | `background.js` contextMenus 段（改） | 网页视频/图片右键 → 直接走「智能起名+目录」下载 | naming.js、下载调度 |
| B站解析 | `js/bilibili.js`（新） | BV→分P→WBI签名→playurl→DASH流，输出标准下载任务 | 抄 bilibili-API-collect 的 WBI JS 实现 |
| YouTube 解析 | `js/youtube.js`（新） | 页面变量读取 + 签名 decipher + 播放列表/频道展开，输出标准下载任务 | 抄 avi12/youtube-downloader（Apache-2.0，留版权声明） |
| 快捷键 | manifest commands（已有） | Alt+Shift+V 唤起面板 | 猫抓原生机制 |

### 模块间数据契约

所有解析模块（B站/YouTube/图片/嗅探）统一产出**标准媒体项**，面板和下载调度只认这一种结构：

```js
MediaItem = {
  url: string,          // 媒体地址
  title: string,        // 智能标题（naming 引擎产出）
  author?: string,      // "昵称(@账号)"，可空
  ext: "mp4"|"ts"|"jpg"|"png"|...,
  type: "video"|"image"|"stream",
  quality?: "auto"|"1080p"|...,  // m3u8 多档；auto=最高
  parts?: Part[],       // B站分P等（可展开勾选）
  size?: number,
  headers?: Record<string,string>  // Referer 等
}
```

## 3. 关键数据流

### 3.1 主链路：嗅探 → 起名 → 落盘

```
页面加载
  → 猫抓嗅探引擎发现媒体（内核，不改）
  → 面板展示卡片，每项调用 naming.js 预填智能文件名+默认目录
  → 用户勾选/改名/改目录/选清晰度
  → 点「下载选中」
  → 下载调度：查去重记录 → 跳过已下 → 排队
  → chrome.downloads.download({filename: "video-rod/平台/作者/名字.ext"})
  → m3u8 类走合并管线（猫抓内核）→ 产物落同一目录
    ⚠️ 隐私注：此合并默认走「在线FFmpeg」= 视频分片 blob 发送到猫抓作者远程
    服务器处理（bmmmd.com/94cat.com）。苏哥若介意，见 §8 三条路线选一条。
  → 全部完成 → 面板内 toast 汇报
```

### 3.2 B站链路（2026-10 改版：嗅探增强，弃签名对抗）

> **改版背景（ADR-020）**：原方案「抄 bilibili-API-collect 的 WBI 签名 + playurl 主动抓取」
> 前提已崩塌——该仓库 2026-01-28 收律师函关停删码，BBDown 归档、哔哩下载姬/BiliTools
> 2026-07-06 同日收函关停。B站生态已无成熟开源实现可抄，且律师函点名的正是
> 「突破登录态访问控制、绕过签名鉴权、抓取付费内容、强取最高清晰度」。
>
> **新路线：零签名对抗**。核心思路——**所有下载请求都由浏览器自己发出**，扩展只做两件事：
> ① 从页面 DOM/状态读分P列表（不调 API，不碰 WBI 签名）；② 嗅探浏览器实际发出的
> DASH 流（m4s 直链）。大会员内容天然支持：浏览器能播放 = 请求已带 cookie = 嗅探即得。

```
打开 B站播放页
  → bilibili.js（轻量）：读页面分P列表（DOM/页面状态，无 API 调用）
  → 面板展示分P卡，用户勾选
  → 用户点某分P → 扩展驱动页面切换分P（点击/跳转，浏览器自己去请求）
  → 猫抓嗅探引擎捕获浏览器发出的 DASH 音视频流（m4s，带 Referer/cookie）
  → 输出 MediaItem[]（headers.Referer=www.bilibili.com）
  → 音视频分别下载 → 合并（按 §8 选定路线）
  → 失效兜底：任一步失败退回纯嗅探结果（ADR-011），永远有得下
```

### 3.3 YouTube 链路（2026-10 改版：降级为 P1，默认只走嗅探）

> **改版背景（ADR-020）**：原方案「读 ytInitialPlayerResponse + 签名 decipher」前提已崩塌。
> 2026-01 起 YouTube 强制 SABR + poToken：浏览器扩展是被打击最重的品类，
> 多方信源确认「2026 年没有 Chrome 扩展能可靠下载 YouTube 视频」；yt-dlp 活着
> 但需外部运行时（Deno + PO token provider），违背 ADR-008「不装外部程序」。
> **结论：纯扩展 YouTube 抓取 2026 年基本是死局，降级 P1，能做多少做多少，
> 不投入签名对抗。** 苏哥若刚需 YouTube：唯一稳路是猫挑内置的 m3u8dl 协议外挂
> N_m3u8DL-RE（装一个本机程序，违背 ADR-008 但那是成熟方案）——列为待选项。

```
打开 YouTube 播放页/列表页
  → 猫抓嗅探引擎捕获浏览器播放时实际发出的流（SABR 场景下可能只能抓到部分）
  → youtube.js（轻量）：尝试从页面数据展开播放列表条目（只取已加载项）
  → 输出 MediaItem[] → 下载 → 按需合并
  → 抓不到就抓不到：标记「当前 YouTube 限制」，退回普通嗅探结果
```

### 3.4 图片扫描链路

```
content script 注入 image-scanner.js
  → 扫 <img>/srcset/背景图/懒加载属性/shadow DOM
  → 取 currentSrc 最高清 → <100×100 过滤 → 去重
  → MutationObserver 跟动态加载，增量汇报给面板
  → 图片卡片与视频同款（改名/目录/批量）
```

### 3.5 右键秒存链路

```
网页 video/img 元素上右键
  → contextMenus「苏哥的钓鱼竿下载这个」
  → 取元素 currentSrc/地址 → naming.js 起名 + 默认目录
  → 直接下载，不开面板
```

## 4. 存储设计（chrome.storage.local）

| Key | 内容 | 写入方 |
|---|---|---|
| `settings` | 默认目录、命名模板、图片嗅探开关、抓取路线开关、清晰度策略 | options 页 |
| `downloaded` | 去重记录（需 unlimitedStorage 权限） | 下载调度 |
| `recentDirs` | 最近使用的目录列表 | 下载调度 |

## 5. 集成对象（抄谁，DECISIONS ADR-002）

| 功能 | 抄谁 | 抄什么 |
|---|---|---|
| 右键秒存/筛选/快捷键 | Video DownloadHelper | 交互范式 |
| 命名模板+单文件目录 | Plucker XBD | 产品体验 |
| 图片扫描四件套 | image-download-extension / picpicker / Sakura | DOM 扫描+过滤+currentSrc+MutationObserver |
| 分组文件夹 | Kromio 教程 `images/${domain}/` 思想 | 升级为按平台/作者分 |
| B站 WBI 签名 | ~~bilibili-API-collect~~ | ❌ **已关停**（2026-01-28 律师函，删码）。B站生态无源可抄 → 改零签名对抗路线（§3.2） |
| YouTube decipher | avi12/youtube-downloader | Apache-2.0。⚠️ 2026 SABR/poToken 下纯扩展基本失效，路线降级 P1（§3.3） |
| m3u8 合并 | 猫抓原生 | 不重复造 |

## 6. 安全与隐私

1. **媒体不出本机**——唯一例外是猫抓的「在线FFmpeg」合并：开启合并时视频分片 blob 会发送到猫抓作者远程服务器（bmmmd.com/94cat.com）处理。介意就走 §8 的本地合并路线
2. `.env` 含 GitHub token，`.gitignore` 已屏蔽，严禁入仓
3. 登录态只借本机浏览器 cookie，不外传不缓存到仓库
4. Apache-2.0 集成代码保留原版权声明

## 6.5 猫抓已有能力盘点（2026-10 源码审计，校准「核心增量」成色）

| 能力 | 猫抓现状（源码位置） | 本项目的真实增量 |
|---|---|---|
| 嗅探引擎 | ✅ 成熟（init.js Ext/Type 清单） | 无，直接用 |
| 下载到目录 | ✅ **已有**：按网页标题建子目录下载（background.js:281 `stringModify(title)+"/"`） | 增量=按**平台/作者**自动分目录 + 每条手动指定 + 批量管理 |
| 文件名自定义 | ✅ **已有**：popup 内联编辑 + 模板 `downFileName`（popup.js:73、init.js:101） | 增量=**页面智能识别**（文章标题/推文正文/作者前缀）——模板变量猫抓只有 title/url/date/ext |
| 文件名清洗 | ✅ 已有：`<>:"|?*`→实体、`\`/`/`→`&bsol;`/`&sol;` 实体、零宽字符清除、首尾不能是`.`（function.js:249-285） | 增量=允许 `/` 当**目录分隔符**（目前被转义成实体，需改造 stringModify 用法）+ Windows 保留名（CON/PRN）+ 路径总长限制 |
| 图片右键保存 | ✅ 已有：单张保存（background.js:794） | 增量=**批量扫描**（四件套）——嗅探清单确实无 image/*（init.js:63-73 实锤） |
| 外部下载器 | ✅ 已有：m3u8dl 协议（N_m3u8DL-RE）、aria2 RPC（init.js:85-88、110-114） | 无（ADR-008 不用；列为 YouTube 备选路） |
| 清晰度默认最高 | ✅ 已有（m3u8.js:352-359 maxBandwidth 默认勾选） | 无，纯确认 |
| m3u8 合并 | ✅ 已有，但是**远程服务** | 见 §8 |

**结论：本项目真正的核心增量 = 智能起名（页面识别）+ 按平台/作者分目录 + 图片批量 + 右键秒存 + 快捷键。命名/目录的「从无到有」叙事要改成「从有到好」。**

## 7. 风险与技术债

| 风险 | 对策 | 详见 |
|---|---|---|
| B站/YouTube 生态剧变 | 2026 年成熟开源工具集体关停（律师函）+ YouTube 强制 SABR/poToken → 弃签名对抗，改零对抗嗅探路线 | §3.2/§3.3、ADR-020 |
| 在线FFmpeg 隐私 | 视频分片上传第三方服务器 → §8 三路线择一 | §8 |
| Chrome 禁 unpacked | 重装即可，配置在 profile 不丢 | PLAN.md 风险节 |
| m3u8 自定义命名复杂 | 列重点测试对象 | TESTING.md |
| 站点 DOM 改版 | 页面识别失效 → 退回网页标题（兜底） | §3.2 |

## 8. m3u8 合并三条路线（✅ 已定稿：路线 A，ADR-018）

猫抓的合并是**远程服务**（视频分片发去 bmmmd.com/94cat.com 处理），个人自用介意隐私的话有三条路：

| 路线 | 做法 | 开发量 | 隐私 | 缺点 |
|---|---|---|---|---|
| ~~A. 保持现状~~ | 沿用猫抓在线FFmpeg | 0 | ❌ 分片上传第三方 | 依赖对方服务器；隐私裸露 |
| B. 本地合并 | 引入 ffmpeg.wasm 或 mediabunny 进 lib/ | 中 | ✅ 纯本地 | ffmpeg.wasm 有 ~2GB wasm 内存上限、MV3 需 offscreen 文档 + CSP 'wasm-unsafe-eval'；mediabunny 无此墙但较新需评估 |
| C. 不合并 | B站 DASH 音视频分别存两个文件 / 或只存浏览器给的已合并流 | 0 | ✅ 纯本地 | 音视频分离，播放需手动；体验降级 |

**苏哥拍板（2026-10-17）：走 A。** 个人自用不过度设计，0 开发量保住一键合并体验；隐私暴露仅在「开启合并时」，且设置里「m3u8 自动合并为 MP4」开关（`#vrSetMerge`）就是刹车——关掉它即等效 C。B/C 方案留档，未来隐私诉求升级可从 ADR-018 恢复，代码零沉没成本。
