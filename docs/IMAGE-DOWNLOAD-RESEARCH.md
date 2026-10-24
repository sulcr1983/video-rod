# 图片悬停下载 + 一键全下 · 调研与方案（v0.1）

> 日期：2026-10-24 ｜ 状态：**待拍板** ｜ 关联：LIBRARY-PLAN v1.7（S1a 已完成三段目录落盘）
> 目标：页面里鼠标悬停任意图片 → 出现下载按钮 → 一点即下载并归入资源库；旁边提供「本页全部下载」。
> 定位：私有自用，参考开源实现的做法直接抄，不重造。

---

## 一、参考了哪些产品

| 产品 | 形态 | 值得抄的点 | 来源 |
|---|---|---|---|
| **ClickSave**（Owen Hsiao / Felix Falkenberg，开源） | 悬停按钮 + 批量 ZIP | 悬停延迟防闪烁、最高分辨率解析、按钮可拖动、批量并发池 | [Chrome 商店](https://chromewebstore.google.com/detail/clicksave-image-downloade/dnpcmckikleafkojcfjhfamkdafmlhjk) ｜ [作者实现手记](https://owenhsiao.com/en/blog/clicksave-image-downloader/) |
| **Imageye** | 侧栏面板列出全页图片 | 按宽高/URL 过滤、勾选批量下载、看每张体积、复制原图 URL | [Chrome 商店](https://chromewebstore.google.com/detail/image-downloader-imageye/agionbommeaifngbhincahgmoflcikhm) ｜ [Firefox 版说明](https://addons.mozilla.com/en-US/firefox/addon/imageye_image_downloader/) |
| **Image Swooper** | 悬停 + 热键 | 悬停即抓；多版本自动取最大；可连按修饰键进入「连续下载」模式 | [Chrome 商店](https://chromewebstore.google.com/detail/image-swooper-download-im/acclmlnjmpomacdlncikbepbbnofjblm) |
| **Cxrompix** | 悬停浮层按钮 + 批量 | 明确把「只在悬停时出现、平时不可见」当作卖点 | [Chrome 商店](https://chromewebstore.google.com/detail/cxrompix-web-image-extrac/obnhmlmiifgnhmbifldbkidihdlhpekn) |
| **免费图片下载器（Edge 版）** | 整页扫描打包 ZIP | 批量把整页图打包、绕过右键禁用 | [Edge Addons](https://microsoftedge.microsoft.com/addons/detail/cnboafhdigdhcebdpfikbgmeakokmlcc) |

> 结论：这类产品的差异不在「能不能下载」，而在**悬停判定稳不稳、抓到的是不是原图、批量会不会把浏览器打爆**。下面逐条拆。

---

## 二、他们踩过的坑（直接决定我们的实现）

### 2.1 悬停判定：三段延时 + 事件委托

ClickSave 作者的原话是「看起来简单，实际一个问题接一个问题」：按钮闪烁、页面卡顿、部分图片检测不到、位置错乱。

最终做法（可直接照抄思路）：

| 环节 | 做法 | 为什么 |
|---|---|---|
| 监听 | `document` 上 `mouseover` 事件委托，只判断 `e.target.tagName === 'IMG'` | 动态加载的图片（无限滚动/SPA）也能覆盖，不用 MutationObserver 逐个绑定 |
| 出现 | 停留 **200ms** 后才显示按钮 | 鼠标划过时按钮乱闪 |
| 记录 | `currentImage` 去重，同一张图不重复触发 | 避免反复创建 DOM |
| 消失 | `mouseout` 后再等 **300ms** 才隐藏 | 留出鼠标从图片移到按钮的时间，否则永远点不到 |

### 2.2 原图解析：按优先级逐级尝试

展示的是缩略图、真正想要的是原图——这是这类产品最难的部分。优先级：

1. 图片被 `<a href="...">` 包着 → 用 `a.href`（很多图库/论坛是「点开看大图」）
2. `srcset` 里取**最大**候选（按 `w` 描述符排序）
3. `data-src` / `data-original-src` / `data-iurl` / `data-lazy-src`（懒加载站点的真实地址）
4. 父级 `[data-ri]`（Google Images 的元数据）
5. 兜底 `img.currentSrc`（浏览器实际选中的那个）

**防盗链风险**：原图直链可能带 Referer 校验，直接下载会 403。策略：先用 `img.currentSrc`（页面上能显示说明请求合法），原图只作为可选尝试，失败不阻断。

### 2.3 装饰图过滤：不打扰才是好体验

必须跳过：

- 1×1 追踪像素
- 小于阈值的小图标（业界常见 100×100 或 50×50）
- loading 占位（gif/svg、`naturalWidth === 0`）
- 纯 CSS 背景图（不是 `<img>`，悬停无意义）
- 透明占位（部分站点的 lazy 占位是 1×1 透明 PNG）

### 2.4 按钮样式与位置

- 默认贴右下角，**可拖动**——因为固定角落会遮住水印/文字
- 拖动要限制在图片边界内（否则飞出图片）
- 必须重置页面样式影响（`all: initial` 或 Shadow DOM），否则会被站点 CSS 改得面目全非
- 高 `z-index`，但不能盖住站点的弹窗层级

### 2.5 批量下载：并发池 + 进度 + 去重

- **不能一次发几百个请求**：浏览器会限流/弹权限提示，需要并发池（业界常见 3–5）
- 单张失败不能中断整批（`Promise.allSettled`）
- 需要进度反馈（第 N / 总数）
- 同一 URL 去重（滚动加载会重复出现同一张图）

---

## 三、我们的落地方案

### 3.1 交互（推荐形态）

```
┌─────────────────────────────────────────┐
│  页面（任意站点）                          │
│                                          │
│   [图片]  ← 悬停 300ms                    │
│         └─▶ 右下角浮出两个按钮：            │
│              [⤓]  下载这一张               │
│              [⤓ 全部 23]  本页全部下载      │
│                                          │
│  页面右下角常驻小浮标（可收起）：            │
│              [🖼 23]  点开图片清单面板       │
└─────────────────────────────────────────┘
```

三层入口，覆盖三种使用习惯：

| 入口 | 行为 | 复用点 |
|---|---|---|
| 悬停单张 | 点图标 → 立即下载 → 落到 `video-rod/平台/博主/图片/` | 走 `vrDownloadWithName`（ADR-027 防丢名） |
| 悬停「全部」 | 扫描本页全部图片 → 过滤 → 逐个下载，带进度 | 复用 popup 现有图片批量思路（`downloadPickedImages`） |
| 常驻浮标 | 打开图片清单：缩略图网格、按尺寸/URL 过滤、勾选下载 | 复用 Imageye 的产品形态；面板可直接跳资源库 |

> 「入库」这一步 S1a 已经成立：文件落到库目录后，S2 的索引就能扫到。S2 之前，文件在磁盘上也是按平台/博主/类型分好的。

### 3.2 文件与接入

| 文件 | 类型 | 职责 |
|---|---|---|
| `js/image-hover.js` | 新增 content script | 悬停判定、按钮注入（Shadow DOM）、原图解析、单张下载 |
| `js/image-panel.js` | 新增 content script | 常驻浮标 + 图片清单面板（缩略图网格、过滤、勾选、批量） |
| `css/image-hover.css` | 新增（或注入 style） | 按钮与面板样式（隔离命名 `vr-img-*`） |
| `manifest.json` | 修改 | content_scripts 增加上述两个脚本（`all_frames: true`），并在设置里加开关 |
| `js/background.js` | 修改 | 新增消息：`vrImg.download`（单张）、`vrImg.batch`（批量，含队列与进度） |
| `js/library/path.js` | 复用 | 图片落位走 `buildRelPath({type:'image'})` |
| `js/popup-videorod.js` | 复用 | 设置项（悬停开关、最小尺寸、是否取原图） |

### 3.3 默认参数（可改）

| 项 | 默认值 | 理由 |
|---|---|---|
| 悬停延迟 | 300ms | 比 ClickSave 的 200ms 稍长，减少误触 |
| 隐藏延迟 | 300ms | 留时间移到按钮 |
| 最小尺寸 | 100×100 | 滤掉图标与装饰图 |
| 看作原图 | 开 | 但失败自动回退到 `currentSrc` |
| 批量并发 | 3 | Chrome 对并发下载有限制 |
| 批次上限 | 200 张 | 防止误点「全部」把几万张图打下来 |

---

## 四、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 全站注入拖慢页面 | 浏览卡顿 | 只做事件委托，不遍历 DOM；按钮用单例 DOM，隐藏即移除；设置里可一键关闭 |
| 站点 CSS 干扰按钮 | 按钮变形/被裁 | Shadow DOM 承载按钮，样式完全隔离 |
| 图片在 iframe / Shadow DOM 内 | 抓不到 | content script `all_frames: true`；Shadow DOM 用 `composedPath()` 取真实目标 |
| 防盗链 403 | 下载失败 | 优先 `currentSrc`；原图仅尝试，失败回退，不报错打扰 |
| 站点检测到注入 | 被风控/封禁 | 按钮不放站点 DOM 里（Shadow DOM 挂 body）、不修改图片属性、不频繁请求 |
| 批量把浏览器打爆 | 下载队列卡死 | 并发 3 + 批次上限 200 + 进度可取消 |
| 重复下载 | 浪费流量 | 同 URL 去重 + 复用现有 `vrDownloaded` 去重表 |
| 懒加载占位图被下错 | 下到 1×1 图 | `naturalWidth` 校验 + 尺寸阈值 + 占位特征识别 |

---

## 五、待拍板（三选一 / 可多选）

| # | 问题 | 选项 |
|---|---|---|
| 1 | 「全部下载」的入口形态 | **A. 悬停时按钮旁显示「全部 N 张」+ 页面常驻小浮标（推荐）** ｜ B. 只要悬停按钮旁 ｜ C. 只在 popup 面板里 |
| 2 | 是否要图片清单面板（缩略图网格 + 过滤 + 勾选） | **A. 要（Imageye 形态，推荐）** ｜ B. 先不做，只做一键全下 |
| 3 | 原图解析激进程度 | **A. 先 currentSrc，再尝试原图（推荐，稳）** ｜ B. 一律优先原图（可能 403） |

> 拍板后：先写方案文档 + 可交互原型（悬停按钮/浮标/面板三态），再进实现。

---

## 六、来源

- [ClickSave Image Downloader（Chrome 商店）](https://chromewebstore.google.com/detail/clicksave-image-downloade/dnpcmckikleafkojcfjhfamkdafmlhjk)
- [How I Built a Chrome Image Downloader Extension（作者实现手记）](https://owenhsiao.com/en/blog/clicksave-image-downloader/)
- [Imageye - Image downloader（Chrome 商店）](https://chromewebstore.google.com/detail/image-downloader-imageye/agionbommeaifngbhincahgmoflcikhm)
- [Imageye（Firefox 版说明）](https://addons.mozilla.com/en-US/firefox/addon/imageye_image_downloader/)
- [Image Swooper（Chrome 商店）](https://chromewebstore.google.com/detail/image-swooper-download-im/acclmlnjmpomacdlncikbepbbnofjblm)
- [Cxrompix: Web Image Extractor（Chrome 商店）](https://chromewebstore.google.com/detail/cxrompix-web-image-extrac/obnhmlmiifgnhmbifldbkidihdlhpekn)
- [Free Online Image Downloader（Edge Addons）](https://microsoftedge.microsoft.com/addons/detail/cnboafhdigdhcebdpfikbgmeakokmlcc)
