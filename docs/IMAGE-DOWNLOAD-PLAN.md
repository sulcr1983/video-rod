# 图片悬停下载 + 一键全下 · 方案 v1.1

> 版本：v1.1 ｜ 日期：2026-10-24 ｜ 状态：**待评审** ｜ 范围：方案 + 可交互原型，不含产品代码
> 前置调研：[IMAGE-DOWNLOAD-RESEARCH.md](IMAGE-DOWNLOAD-RESEARCH.md)（参考 ClickSave / Imageye / Image Swooper / Cxrompix）
> 配套原型：[image-hover-prototype-v1.html](../deliverables/prototypes/image-hover-prototype-v1.html)（单文件，双击打开）
> 依赖：[LIBRARY-PLAN.md](LIBRARY-PLAN.md) v1.7（三段目录已实现，S1a 完成）
> 定位：私有自用，成熟做法直接抄；交互自研，代码走本项目现有链路

---

## 零、目标与范围

### 0.1 要解决什么

现在存图要「右键 → 另存为 → 选路径」，一张两张还行，逛小红书/图库时效率极低。目标：

1. **悬停即出现下载按钮**，一点就存，并且自动落到 `video-rod/平台/博主/图片/`
2. **一键全部下载**：本页所有符合条件的图片，批量存下来
3. **可挑图**：缩略图清单面板，按尺寸/URL 过滤后勾选下载

### 0.2 不做（v1 边界）

| 不做 | 原因 |
|---|---|
| 云相册/同步 | 与资源库定位一致：纯本地 |
| 图片格式转换（PNG↔WebP） | ClickSave 有，但属额外功能，v1 不做 |
| 打包成 ZIP 下载 | Chrome 扩展写 ZIP 需要额外库，且用户要的是「入库」不是「打包」 |
| 视频/背景图悬停 | 视频已有猫抓嗅探；CSS 背景图不是 `<img>`，悬停语义不清 |
| 移动端 | 已封存 |

---

## 一、交互规格

### 1.1 悬停单张（核心）

```
鼠标停在图片上 300ms
        ↓
图片右下角浮出两个按钮（Shadow DOM，不污染站点样式）
  ┌──────────────┐
  │ [⤓]   [⤓ 23] │   ← 左：下载这一张；右：本页全部 23 张
  └──────────────┘
        ↓ 点左键
按钮变成「转圈」→ 成功后变「✓」并 1.2s 后淡出
        ↓
toast（右下角，非阻塞）：已存入 小红书/小鱼(@xiaoyu123)/图片/
```

| 规则 | 值 | 说明 |
|---|---|---|
| 出现延迟 | 300ms | 鼠标划过不弹，减少闪烁 |
| 隐藏延迟 | 300ms | 留时间把鼠标移到按钮上 |
| 按钮位置 | 图片右下角，内缩 8px | 不遮左上角信息与中心内容 |
| 可拖动 | 是 | 拖动后记住该站点偏移（localStorage），避免遮挡水印 |
| 按钮尺寸 | 32×32（单张）/ 自适应（全部） | 小图不至于被按钮盖满 |
| 不显示条件 | `naturalWidth < 100` 或 `naturalHeight < 100` 或占位图 | 见 §3.4 |

### 1.2 悬停「全部 N 张」

- 按钮文案：`全部 23`（N 为当前页符合过滤条件的图片数）
- 点击后：**不立刻全下**，先弹一个轻量确认条（可关）：

```
┌─────────────────────────────────────┐
│ 本页找到 23 张图（已过滤 8 张小图）    │
│ [下载 23 张]  [先看清单]  [取消]      │
└─────────────────────────────────────┘
```

- 「下载 23 张」→ 底部进度条（可取消）：`正在下载 7/23 · 失败 1`
- 「先看清单」→ 打开 §1.4 的清单面板

> **为什么要确认**：一键全下可能触发浏览器「多文件下载」提示，且误点代价高。确认条只出现一次（同站点 24h 内可记住选择）。

### 1.3 页面浮标（常驻入口）

- 位置：右下角，距边 16px，直径 40px 圆形
- 内容：`🖼` 图标 + 当前页图片数角标（`23`）
- 行为：点击打开清单面板；**可拖动**；可关闭（关闭后本页不再显示，刷新恢复）
- 遮挡处理：靠近站点自己的悬浮组件时自动半透明（`opacity: .45`），悬停恢复

### 1.4 图片清单面板（Imageye 形态）

```
┌──────────────────────────────────────────────────────┐
│ 本页图片  23 张                          [×]          │
│ 过滤：[最小宽 100] [最小高 100] [URL 关键词____]      │
│ 操作：[全选] [反选] [下载选中 0] [下载全部 23]        │
├──────────────────────────────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                   │
│ │ ✓  │ │    │ │ ✓  │ │    │ │    │   ← 缩略图网格     │
│ │1200│ │ 800│ │2000│ │ 640│ │1024│   ← 显示尺寸      │
│ └────┘ └────┘ └────┘ └────┘ └────┘                   │
│  ……（懒加载，滚动到底再渲染下一批）                    │
└──────────────────────────────────────────────────────┘
```

| 能力 | 规格 |
|---|---|
| 缩略图 | 直接用图片 URL 的 `loading="lazy"`，不额外生成缩略图（省算力） |
| **尺寸档位（v1.2 新增）** | **小 / 中 / 大 / 超大 / 自定义** 五个一键档位，每个档位实时显示命中数量；不用手写像素 |
| 尺寸显示 | `naturalWidth × naturalHeight`，未加载的显示「…」 |
| 过滤 | 档位之外，仍保留 URL 关键词过滤 |
| 勾选 | 单击切换；`Shift+单击` 范围选择 |
| 批量 | 复用 §3.5 队列；显示进度；可取消 |
| 排序 | 默认按页面出现顺序；可切「尺寸从大到小」 |
| 关闭方式 | `Esc` / 点遮罩 / 点 × |
| 键盘 | `J/K` 移动、`X` 勾选、`Enter` 下载选中（与资源库一致） |

**尺寸档位定义**（按最短边判定，避免竖图被误判为小图）：

| 档位 | 判定 | 典型用途 | 业界对照 |
|---|---|---|---|
| 小 `≥100` | 短边 ≥ 100px | 默认过滤线，滤掉图标/装饰图 | Imageye 评测文建议 min-width 500 用于电商；100 适合图文站 |
| 中 `≥500` | 短边 ≥ 500px | 普通可用的配图 | 电商场景常用阈值 |
| 大 `≥1200` | 短边 ≥ 1200px | 壁纸/高清素材 | — |
| 超大 `≥2000` | 短边 ≥ 2000px | 4K/印刷级 | — |
| 自定义 | 手填宽×高 | 特殊需求 | Fatkun/Imageye 的做法 |

> 为什么不用业界普遍的"手填最小宽高"：实测那是最不直观的一项——用户不知道页面上有什么尺寸，只能瞎填再试。
> 改成档位后，**每个档位直接显示「命中 N 张」**，一眼看出该选哪档。这是本项目相对现有扩展的改进点。

### 1.5 图集 / 多页模式（v1.2 新增）

> 用户原话：「那种下一页下一页的，就是整个图片专辑的那种，能不能也顺着图片地址一起下载全部？」

**答案：能，分三种情况，按可靠性从高到低实现。**

| 场景 | 实现方式 | 可靠性 | 代价 |
|---|---|---|---|
| **A. 无限滚动 / 懒加载** | 自动滚动到底，`MutationObserver` 统计新增图片，静止后再继续 | ★★★ 最高 | 只影响当前页，不触发风控 |
| **B. 分页图集**（有「下一页」链接） | 识别分页链接 → 后台逐个打开（或当前标签顺序导航）→ 每页抓图 → 汇总 | ★★ 中 | 慢（每页 1–2s）；连续翻页可能触发站点风控 |
| **C. 站点图集 API** | 直接调站点 JSON 接口拿全部原图 URL | ★★★ 最高 | 需要逐站适配（可后补） |

**业界现状**（调研结论）：

| 产品 | 做法 |
|---|---|
| **Fatkun** | 「Open multiple pages and then download all images via Download All Pages」——批量打开多个页面后统一抓取 |
| **Bulk Image Downloader from URL List** | 「Pagination: follow next-page links automatically」，可设**扫描时长**（30s/1m/2m）或**最大页数** |
| **All Images Downloader** | 「Scan & Auto-Scroll」——自动滚动，边滚边收集懒加载图片 |
| **Download All Images** | 只抓当前页（不做翻页） |

**我们的实现策略**（v1 只做 A + B）：

```
面板底部：
┌─────────────────────────────────────────────────────┐
│ 本页 12 张 · [⤓ 加载更多] 最多 10 页  [停止]         │
└─────────────────────────────────────────────────────┘

点「加载更多」：
  ① 先自动滚动到底（触发懒加载），图片数 12 → 23
  ② 找到「下一页」链接 → 后台打开该页 → 抓图 → 关闭
  ③ 重复，直到：没有下一页 / 达到 10 页 / 用户点停止
  ④ 全部结果并入清单，统一勾选下载
```

| 参数 | 默认 | 说明 |
|---|---|---|
| 最大页数 | 10 | 防止无休止抓取 |
| 每页等待 | 1.5s + 滚动静止检测 | 等懒加载与图片尺寸读取 |
| 翻页方式 | 后台标签打开后关闭（不打断当前浏览） | 比顺序导航体验好；代价是内存 |
| 停止 | 随时可停，已抓到的保留 | — |
| 进度 | `第 3/10 页 · 已收集 46 张` | — |
| 风控保护 | 每页间隔 ≥1.2s；连续 2 页失败即停 | 避免把站点惹毛 |

**分页链接识别优先级**：

1. `<a rel="next">`
2. `<a>` 文案含「下一页 / 下页 / Next / › / »」
3. 分页器里当前页 +1 的链接（`?page=2`、`/p2`、`/2`）
4. 站点适配规则（后续加）

> **不做的**：不尝试"从图片 URL 反推专辑其他图"——命中率低且容易越界抓到无关内容。
> 真正稳的 C 方案（站点 API）留作后续按平台补：先小红书/B站，再 Pixiv/微博。

### 1.6 状态与反馈

| 状态 | 表现 |
|---|---|
| 解析中 | 按钮转圈（解析原图 + 校验可达性） |
| 已提交下载 | 按钮变 `↓…`（队列中） |
| 完成 | 按钮变 `✓`，1.2s 后淡出；右下角 toast 显示落位路径 |
| 失败 | 按钮变 `!`，toast 说明原因（403 / 无权限 / 已去重） |
| 已下载过 | 按钮直接显示 `✓`（复用现有 `vrDownloaded` 去重表），点击时提示「已下过」 |
| 批量进行中 | 底部进度条，可取消；已完成项在清单里打勾标记 |

### 1.7 快捷键（可选，默认关）

| 键 | 行为 |
|---|---|
| `Alt+Shift+D` | 下载鼠标当前悬停的图片（不开按钮也能用） |
| `Alt+Shift+A` | 打开本页图片清单 |

> 与现有 `Alt+Shift+V` 唤起面板不冲突。

---

## 二、技术规格

### 2.1 文件清单

| # | 文件 | 类型 | 职责 |
|---|---|---|---|
| 1 | `js/image-hover.js` | 新增 content script | 悬停判定、按钮注入（Shadow DOM）、原图候选收集、单张下载触发 |
| 2 | `js/image-panel.js` | 新增 content script | 浮标 + 清单面板（网格/档位过滤/勾选/批量） |
| 2b | `js/image-album.js` | 新增 content script | 图集模式：自动滚动加载、分页链接识别、翻页抓取、进度与停止 |
| 3 | `js/lib-image-util.js` | 新增（注入到两个页面共用） | 图片扫描、过滤、候选 URL 解析、尺寸读取（纯函数，可单测） |
| 4 | `js/background.js` | 修改 | 新增 `vrImg.resolve`（SW 侧校验原图可达）、`vrImg.download`、`vrImg.batch` |
| 5 | `manifest.json` | 修改 | content_scripts 增 3 个脚本（`all_frames: true`，`run_at: document_idle`）；commands 增两个快捷键 |
| 6 | `js/library/path.js` | 复用 | 落位走 `buildRelPath({type:'image'})` |
| 7 | `options.html` + `js/library/settings.js` | 修改 | 新增图片下载设置（开关/最小尺寸/优先原图/并发/上限） |
| 8 | `tools/test-image-util.js` | 新增 | 扫描/过滤/候选解析的 Node 单测 |
| 9 | `tools/cdp-image-test.py` | 新增 | 端到端：悬停出按钮 → 点击 → 落盘路径正确 |

### 2.2 运行时架构

```
页面（content script）                          Service Worker
┌────────────────────────┐                    ┌─────────────────────────┐
│ image-hover.js          │  vrImg.resolve     │ 校验候选 URL（跨域 fetch）│
│  · mouseover 委托        │ ─────────────────▶ │  · 带 Referer + cookie   │
│  · 300ms 延迟            │ ◀───────────────── │  · 返回第一个可用 URL    │
│  · Shadow DOM 按钮       │   {url, fallback}  │                         │
│                         │                    │                         │
│ 点击 → vrImg.download    │ ─────────────────▶ │ vrDownloadWithName()    │
│                         │                    │  → chrome.downloads     │
│ image-panel.js          │  vrImg.batch       │                         │
│  · 扫描全页图片          │ ─────────────────▶ │ 并发池 3 + 进度回传      │
│  · 网格/过滤/勾选        │ ◀── progress ───── │                         │
└────────────────────────┘                    └─────────────────────────┘
```

**为什么校验放 SW**：content script 的 `fetch` 受页面 CORS 限制，跨域读 `content-type` 会被挡；SW 有 `host_permissions: *://*/*`，可跨域请求。

### 2.3 原图候选解析（五级优先级，用户拍板"一律优先原图"）

```js
// lib-image-util.js（纯函数，Node 可测）
collectCandidates(img, doc) -> string[]   // 去重、绝对化、按优先级排序
  1. img.closest('a[href]')?.href         // 图被链接包裹（图库/论坛最常见）
  2. srcset 里 w 描述符最大的那一项
  3. data-src / data-original-src / data-iurl / data-lazy-src / data-actualsrc
  4. 父级 [data-ri] 的 JSON 元数据里的原图 URL（Google Images）
  5. img.currentSrc（页面正在显示的，保底）
```

**SW 校验**（`vrImg.resolve`）：

```js
for (const url of candidates) {
  try {
    const r = await fetch(url, { headers: { Referer: pageUrl }, credentials: 'include' });
    const ct = r.headers.get('content-type') || '';
    if (r.ok && ct.startsWith('image/')) return url;
  } catch (e) { /* 继续下一个 */ }
}
return candidates[candidates.length - 1];   // 全失败 → currentSrc
```

- **仍然失败**：用 `declarativeNetRequest` 动态规则给该请求补 `Referer`（已有权限，不新增）
- **绝不空点**：无论解析成功与否，点击后一定会尝试下载 `currentSrc`

### 2.4 图片扫描与过滤（清单面板与「全部」共用）

```js
scanImages(doc) -> ImgItem[]
ImgItem = { el, url, w, h, ok: true }
```

过滤规则（可配置）：

| 规则 | 默认 | 说明 |
|---|---|---|
| 最小宽/高 | 100×100 | 滤图标、装饰图、追踪像素 |
| 占位图 | 跳过 | `naturalWidth === 0`、URL 含 `placeholder`/`loading`/`blank.gif` |
| data URI | 跳过 | 体积大且无意义 |
| SVG | 跳过 | 多为图标 |
| 同 URL 去重 | 是 | 滚动加载会重复出现同一张 |
| `_` 开头目录 | 不适用 | 那是资源库侧规则 |

扫描范围：`document.querySelectorAll('img')` + `img` 在 Shadow DOM 内的（用 `composedPath()` 从事件目标取，不遍历所有 shadow root）。

### 2.5 批量下载队列

| 参数 | 值 | 说明 |
|---|---|---|
| 并发 | 3 | Chrome 对并发下载有限制，过高会排队卡死 |
| 单批上限 | 200 | 防误点全下几万张 |
| 重试 | 0 | 图片下载失败基本是 403/404，重试无意义 |
| 去重 | 复用 `vrDownloaded` | 已下过的直接跳过并标记 |
| 取消 | 支持 | 取消后不再发起新任务，已完成的保留 |
| 进度 | 每完成 1 张回传 | 面板显示 `7/23 · 失败 1` |

### 2.6 消息协议（页面 → SW）

| action | 入参 | 出参 | 说明 |
|---|---|---|---|
| `vrImg.resolve` | `{candidates: string[], pageUrl}` | `{url, tried: number, fallback: boolean}` | 原图校验 |
| `vrImg.download` | `{url, pageUrl, title, platform?, index?}` | `{ok, downloadId?, path?, code?}` | 单张下载 + 落位 |
| `vrImg.batch` | `{items: [{url, title, index}], pageUrl, concurrency}` | `{batchId}` | 建批次 |
| `vrImg.batchProgress` | `{batchId}` | `{done, total, failed, state}` | 轮询进度 |
| `vrImg.batchCancel` | `{batchId}` | `{ok}` | 取消 |
| `vrImg.albumScan` | `{maxPages, mode: "scroll"\|"paging", tabId}` | `{taskId}` | 图集扫描（滚动 + 翻页） |
| `vrImg.albumProgress` | `{taskId}` | `{page, maxPages, collected, state}` | 图集进度 |
| `vrImg.albumStop` | `{taskId}` | `{ok}` | 停止图集扫描 |

### 2.7 设置项（`vrLibSettings` 扩展）

```js
{
  imgHover: true,            // 悬停按钮总开关
  imgFloating: true,         // 页面浮标开关
  imgSizePreset: "small",    // small(≥100) | medium(≥500) | large(≥1200) | huge(≥2000) | custom
  imgMinWidth: 100,          // custom 档位才用
  imgMinHeight: 100,
  imgPreferOriginal: true,   // 优先原图（拍板）
  imgConcurrency: 3,
  imgBatchLimit: 200,
  imgHotkeys: false,
  imgAlbumMode: "scroll",    // scroll | paging（图集模式默认先滚动）
  imgAlbumMaxPages: 10       // 翻页上限
}
```

### 2.8 状态机

| 对象 | 迁移 |
|---|---|
| 悬停按钮 | `HIDDEN` →(悬停 300ms) `SHOWN` →(点击) `RESOLVING` →(收到 URL) `DOWNLOADING` →(完成) `DONE` / (失败) `FAILED` →(1.2s) `HIDDEN` |
| 批量 | `IDLE` →(确认) `RUNNING` →(全部完成) `FINISHED` / (用户取消) `CANCELLED` / (全部失败) `FAILED` |
| 清单面板 | `CLOSED` →(点浮标/快捷键) `OPEN` →(扫描) `READY` →(下载中) `BUSY` →(完成) `READY` →(Esc) `CLOSED` |
| 图集任务 | `IDLE` →(点加载更多) `SCROLLING` →(滚动静止) `PAGING` ⇄ `SCROLLING` →(无下一页/达上限/用户停) `DONE` / (连续 2 页失败) `ABORTED` |

### 2.9 错误码

| 码 | 场景 | 用户文案 |
|---|---|---|
| `IMG_E_BLOCKED` | 原图 403 且回退也失败 | 站点限制下载，已跳过 |
| `IMG_E_TOO_SMALL` | 小于尺寸阈值 | 图片太小，已过滤 |
| `IMG_E_DUPLICATE` | 已下载过 | 这张已经存过了 |
| `IMG_E_LIMIT` | 超过单批上限 | 最多一次下载 200 张 |
| `IMG_E_NO_PERM` | 扩展无该站点权限 | 当前页面不允许扩展操作 |

---

## 三、与现有代码的接入

| 能力 | 现有入口 | 新功能怎么用 |
|---|---|---|
| 落位 | `js/library/path.js` → `buildRelPath({type:'image'})` | 图片统一进 `video-rod/<平台>/<博主>/图片/` |
| 下载 | `js/background.js` → `vrDownloadWithName(url, filename, extra)` | 统一入口，避免星愿丢文件名（ADR-027） |
| 去重 | `popup-videorod.js` 的 `vrDownloaded` + `isDownloaded/markDownloaded` | 批量前先过滤已下载 |
| 命名 | `js/naming.js` → `buildNameFromInfo` | 单张用页面标题；批量追加 `_01 _02` 序号 |
| 设置 | `chrome.storage.local` 的 `vrLibSettings` | 新增 `img*` 键，不混写 `vrSettings` |
| 协议 | 现有 `chrome.runtime.sendMessage` | 新增 `vrImg.*`，与 `vrQueueName` 并列 |

---

## 四、性能与安全

| 关注点 | 做法 |
|---|---|
| 页面性能 | 只用事件委托，不遍历 DOM；按钮单例 DOM；面板关闭即卸载 |
| 样式隔离 | 按钮与面板全部在 Shadow DOM，`all: initial` 重置 |
| 内存 | 面板缩略图 `loading="lazy"`；关闭后清空 DOM；扫描结果不缓存超过 1 次会话 |
| 风控 | 不修改原图属性；不往站点 DOM 插节点（挂 `body` + Shadow DOM）；下载间隔由并发池控制 |
| 权限 | 不新增权限；复用 `host_permissions` + `declarativeNetRequest` |
| 隐私 | 全程本地；不把图片 URL 发往任何第三方（`vrImg.resolve` 只向图片原站发请求） |

---

## 五、验收标准

1. **悬停**：停留 300ms 出现按钮；鼠标划过不出现；移开 300ms 消失
2. **单张**：点击后 3 秒内落盘，路径符合 `video-rod/<平台>/<博主>/图片/<日期>_<标题>.jpg`
3. **原图**：在带 srcset 的页面上取到最大尺寸；在防盗链站点失败时自动回退且**仍然下成功**
4. **过滤**：1×1、<100×100、占位图、data URI 不加按钮
5. **全下**：确认条 → 进度 → 完成；单张失败不中断；可取消
6. **面板**：扫描数量与页面实际一致；过滤/勾选/批量可用；Esc 关闭
7. **去重**：同图第二次点击提示「已存过」，不重复落盘
8. **性能**：普通图文页（200 张图）注入后主线程无长时间阻塞（`Performance` 无 >100ms 长任务由注入引起）
9. **隔离**：按钮样式不受站点 CSS 影响；站点弹窗不被遮挡
10. **可关**：设置里关掉后页面无任何注入痕迹（DOM 里无 `vr-img` 节点）
11. **尺寸档位**：小/中/大/超大/自定义五档可切换；每档显示的命中数量与列表实际条数一致；按短边判定（竖图不误判）
12. **图集-滚动**：无限滚动页点「加载更多」后图片数持续增加，滚动静止即停；不重复计入已收集图片
13. **图集-翻页**：有「下一页」的页面上，能连续抓取后续页；达到 10 页或用户点停止即停；已抓到的保留；连续 2 页失败自动中止

---

## 六、分阶段实施

| 步骤 | 内容 | 验收 | 提交信息 |
|---|---|---|---|
| **I1** | `lib-image-util.js` + 单测 | 扫描/过滤/候选解析全过（Node） | `feat(image): 图片扫描与候选解析 + 单测` |
| **I2** | `image-hover.js` + SW `vrImg.resolve/download` | 悬停出按钮、单张落盘正确、原图回退可用 | `feat(image): 悬停下载按钮 + 原图解析与回退` |
| **I3** | 全部下载（确认条 + 队列 + 进度） | 23 张批量成功、失败不中断、可取消 | `feat(image): 一键全部下载——队列/进度/取消` |
| **I4** | `image-panel.js` 浮标 + 清单面板 | 扫描/过滤/勾选/批量/键盘 | `feat(image): 图片清单面板（浮标入口）` |
| **I5** | 设置项 + 快捷键 + 性能打磨 | 验收 10 条全过；截图归档 | `feat(image): 设置项/快捷键/性能收尾` |
| **I6** | 尺寸档位（大中小）+ 图集模式（滚动/翻页） | 验收 11–13 全过；图集抓取有进度、可停止 | `feat(image): 尺寸档位与图集翻页抓取` |

> 每档独立提交、独立验收；I2 完成即可日常使用，I4 是增强。

---

## 七、风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 站点结构千差万别 | 原图解析命中率不稳 | 五级候选 + SW 校验 + 回退 `currentSrc`，保证「至少能存下看到的」 |
| 防盗链 | 403 | SW 带 Referer/cookie 校验；必要时 DNR 补 Referer |
| 与站点自身的悬停 UI 冲突 | 按钮互相遮挡 | 按钮贴图片右下角内缩；站点浮层 `z-index` 更高时半透明 |
| 无限滚动页面 | 图片数量持续变化 | 浮标角标实时更新（节流 1s）；面板打开时冻结快照 |
| 批量触发浏览器多文件提示 | 用户被弹窗打断 | 首次全下前出确认条，文案说明「浏览器可能询问是否允许多文件下载」 |
| 站点风控 | 账号异常 | 不修改页面、不注入站点 DOM、并发 3、默认关闭热键 |
| 内容脚本重复注入 | 双份按钮 | 用 `window.__vrImgHoverLoaded` 全局标记防重入 |

---

## 八、版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-10-24 | 首版：三态交互（悬停/浮标/面板）+ 原图五级候选与 SW 校验回退 + 批量队列 + I1–I5 分阶段 |
| v1.1 | 2026-10-24 | 配套可交互原型完成（`deliverables/prototypes/image-hover-prototype-v1.html`）：12 张本地 SVG 封面、悬停 300ms 出按钮、单张/全部/确认条/进度、浮标 + 清单面板（过滤/勾选/批量）、键盘 J/K/X/Enter/Esc；CDP 验收 **18/18**，控制台 0 错误；四态截图归档 |
| v1.2 | 2026-10-24 | **尺寸档位 + 图集模式**：① 面板改为「小/中/大/超大/自定义」五档（按短边判定，每档显示命中数量），替代手填像素；② 新增 §1.5 图集/多页：自动滚动（A）与分页翻页（B）两种模式，10 页上限、可停止、连续 2 页失败中止；③ 站点 API（C）留作后续按平台补；④ 文件清单加 `image-album.js`、消息协议加 3 条 album 接口、设置项加 `imgSizePreset/imgAlbumMode/imgAlbumMaxPages`；⑤ 验收补 11–13，实施加 I6 |
