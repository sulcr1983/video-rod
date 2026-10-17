# 钓鱼竿 Video Rod — 技术设计文档

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
│   嗅探引擎 init.js ｜ 下载器 m3u8.js ｜ 合并 FFmpeg.wasm │
└────────────────────────────────────────────────────────┘
         ↕ chrome.storage.local（设置/去重记录/最近目录）
```

**核心设计原则**：
1. **外壳大改、内核不动**——猫抓的嗅探引擎、下载器、FFmpeg 合并链路一律不碰，保证随时 cherry-pick 上游站点适配更新
2. **独立模块挂载**——每个新功能一个模块文件，一个模块坏不影响其他，可单独开关
3. **失效兜底**——B站/YouTube 主动抓取失败自动退回嗅探模式，永远有得下

## 2. 模块划分与边界

| 模块 | 文件（规划） | 职责 | 依赖 |
|---|---|---|---|
| 智能起名引擎 | `js/naming.js`（新） | 页面识别（文章/推特/B站/小红书）→ 取标题/正文/作者 → 模板填充 → 清洗（非法字符/截断60字/重名序号/空段清理） | 无（纯函数） |
| 面板 UI | `popup.html/js/css`（改） | 媒体卡片（徽章/元信息/文件名输入/目录chip/清晰度下拉/分P展开）、类型筛选行、底部批量操作栏、设置抽屉 | naming.js、storage |
| 下载调度 | `js/function.js` 下载段（改） | `chrome.downloads.download({filename: "子目录/名字.ext"})`、批量队列（错峰）、去重记录写入 | naming.js、storage |
| m3u8 合并 | `m3u8.html` 相关（不动） | ts 碎片 → FFmpeg 合并 MP4，产物沿用自定义文件名 | 猫抓原生 |
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
  → 全部完成 → 面板内 toast 汇报
```

### 3.2 B站主动抓取链路

```
打开 B站播放页
  → bilibili.js：读 BV号 → view API 拿分P列表（借 cookie）
  → nav API 拿 WBI keys（缓存 24h）→ MD5 签名
  → playurl API（fnval=16/4048）拿 DASH 音视频流地址
  → 输出 MediaItem[]（带 parts 分P、headers.Referer=www.bilibili.com）
  → 用户勾选 → 音视频分别下载 → FFmpeg 合并（复用猫抓 wasm）
  → 任何一步失败 → 标记该项失效，退回嗅探结果（ADR-011）
```

### 3.3 YouTube 主动抓取链路

```
打开 YouTube 播放页/列表页
  → content script 抓页面全局变量 ytInitialPlayerResponse / ytData
  → youtube.js：提取全码率直链 + 签名 decipher（集成 avi12 实现）
  → 播放列表/频道展开（只取已加载项，不滚动）
  → 输出 MediaItem[] → 音视频/字幕/封面按需下载 → ffmpeg.wasm 合并
  → 失败 → 退回嗅探
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
  → contextMenus「钓鱼竿下载这个」
  → 取元素 currentSrc/地址 → naming.js 起名 + 默认目录
  → 直接下载，不开面板
```

## 4. 存储设计（chrome.storage.local）

| Key | 内容 | 写入方 |
|---|---|---|
| `settings` | 默认目录、命名模板、图片嗅探开关、主动抓取开关、清晰度策略 | options 页 |
| `downloaded` | URL hash 集合（去重，需 unlimitedStorage 权限） | 下载调度 |
| `recentDirs` | 最近使用的目录列表 | 下载调度 |
| `wbiKeys` | B站 WBI keys 缓存（24h 刷新） | bilibili.js |

## 5. 集成对象（抄谁，DECISIONS ADR-002）

| 功能 | 抄谁 | 抄什么 |
|---|---|---|
| 右键秒存/筛选/快捷键 | Video DownloadHelper | 交互范式 |
| 命名模板+单文件目录 | Plucker XBD | 产品体验 |
| 图片扫描四件套 | image-download-extension / picpicker / Sakura | DOM 扫描+过滤+currentSrc+MutationObserver |
| 分组文件夹 | Kromio 教程 `images/${domain}/` 思想 | 升级为按平台/作者分 |
| B站 WBI 签名 | bilibili-API-collect | JS 实现 |
| YouTube decipher | avi12/youtube-downloader | Apache-2.0，保留版权声明 |
| m3u8 合并 | 猫抓原生 | 不重复造 |

## 6. 安全与隐私

1. 纯本地运行，无任何网络上传（除下载媒体本身）
2. `.env` 含 GitHub token，`.gitignore` 已屏蔽，严禁入仓
3. 登录态只借本机浏览器 cookie，不外传不缓存到仓库
4. Apache-2.0 集成代码保留原版权声明

## 7. 风险与技术债

| 风险 | 对策 | 详见 |
|---|---|---|
| B站/YouTube 改接口 | 模块独立 + 失效退回嗅探；抄的开源库自身会跟更新 | BUILD-PLAN 风险表 |
| WBI keys 日轮换 | 24h 缓存策略（抄开源实现） | §3.2 |
| Chrome 禁 unpacked | 重装即可，配置在 profile 不丢 | PLAN.md 风险节 |
| m3u8 自定义命名复杂 | 列重点测试对象 | TESTING.md |
