# 视频清晰度与小红书增强 · 技术实现

> 日期：2026-11-07 ｜ 状态：**已实现并通过实测**
> 关联：`ADR-064`（清晰度决策）、`COMPETITOR-EXTENSIONS.md`（竞品拆解总账）
> 单测：`test-video-quality` 57 ／ `test-xhs-media` 25 ／ `test-xhs-ssr` 26 ／ `test-range-split` 18

---

## 一、要解决的问题

苏哥报的三个现象：

| # | 现象 | 实际根因 |
|---|---|---|
| 1 | 微博视频「最多还是 720p」 | 排序把「正在播放」无条件置顶，而信息流默认播 720p |
| 2 | 「每个视频都是一样的大小，只嗅探了一个」 | 菜单里 6 项其实是**同一视频的 6 个码率**，标签只显示 `MP4 · 4.0MB`，看不出区别 |
| 3 | YouTube 只能 1080p | **产品策略**（`MAX_HEIGHT = 1080`），不是技术限制 |

---

## 二、清晰度：统一规则

### 2.1 排序（核心修正）

`js/video-quality.js` 的 `sortCandidates()`：

```
① height 降序        ← 分辨率优先
② size  降序         ← 同分辨率挑大的
③ 「正在播放」       ← 仅当前两者都相同时才偏好
```

**与旧实现相反**：旧代码是 `(正在播放 ? 0 : 1) || (size 降序)`，
即「正在播放」**无条件置顶**。微博信息流默认 720p，所以一键下载永远拿 720p。
代码注释写的是「通用站取体积最大的那条」，**注释与实现不一致** —— 这是问题 1 的全部原因。

配套修正：补入当前播放时原来用 `list.unshift()`，会再次把它压到第一位，
现改为 `push()` + 重新排序。

### 2.2 分辨率解析优先级

`heightFromUrl()` 按此顺序匹配（先精确标记，避免被路径数字干扰）：

| 顺序 | 形态 | 例 |
|---|---|---|
| ① | `label` / `quality` 参数 | `?label=mp4_1080p` |
| ② | 显式高度参数 | `?height=1080`、`&h=720` |
| ③ | 文件名/路径 `NNNp` | `/hd/720p/video.mp4` |
| ④ | 路径 `WxH` | `/1280x720/`、`template=1922x1080` |
| ⑤ | 短标记 | `uhd`/`fhd`/`hd`/`sd` |

> ④ 抄自 DownXVideo v0.6.2 的 `parseDimensions()`。
> 微博的 `template=1922x1080.25.0` 就走这条。

### 2.3 HLS master 展开

`parseHlsMaster()`：解析 `#EXT-X-STREAM-INF` 的 `RESOLUTION=WxH` 与 `BANDWIDTH`，
相对地址补绝对，再按 height → bandwidth 排序。

**为什么必须有**：HLS 站点拿到的是 master 地址（一张清单），
不展开就只能看到一个「不明大小的 MP4」，更不知道哪档最高。

> 抄自 Video Downloader Plus v4.0.0。

### 2.4 DASH MPD 解析

`parseDashMpd()`：解析 `<Representation>` 的 `width`/`height`/`bandwidth`/`codecs`，
跳过纯音频轨（无宽高），复用同一条排序。

> 抄自 Video Downloader Pro v0.1.11（它把 m3u8 与 mpd 并列支持）。

**踩过的坑**：属性正则必须加词边界，否则 `width` 会匹配到 `bandwidth="..."` 里的 width。
单测 G2 固定了这条。

### 2.5 微博高清直链

`pickWeiboHdUrl()` 字段优先级（抄笃笃 v0.16.14）：

```
mp4_1080p_url > mp4_hd_url > stream_url_hd > mp4_sd_url > stream_url > url
```

配合 `background.js` 的 `vrWeiboHdProbe()`，**在页面主世界 fetch**
（扩展上下文会被 302 到 `passport.weibo.com/visitor/visitor`）。

> **已知限制（实测）**：`ajax/statuses/show` 只对**信息流卡片**的 mid 有效。
> `tv/show/1034:xxx` 的 id 传进去返回 `error_code: 20101「该微博不存在」`。
> 所以这条路径失败必须静默回落，不能阻断下载。

---

## 三、小红书

### 3.1 原图推导（`js/xhs-media.js`）

```js
// 1. pathname 按 ! 截断（丢掉 !nd_dft_wlteh_webp_3 这类 CDN 处理指令）
// 2. .../notes_pre_post/<key> 或 .../spectrum/<key> → ci 域同路径
// 3. 最后一段像素材 ID（1040 开头长串）→ ci 域 + 该 ID
```

### 3.2 ⚠️ 关键实测修正：原图不能盲目优先

**实测证据**：

| 素材 ID | `ci.xiaohongshu.com` 结果 |
|---|---|
| `1040g2sg3271c1gng6qdg491k3adll5k` | **404** text/plain |
| `1040g2sg3271c1gng6qdg491k3adll5kaq9kb9fo` | **200** ✅ |

同一个域名，不同素材 ID 结果不同。

**对方（小红书下载助手 v1.0.2）为什么没事**：它用 `probeImage()` 读文件头
逐个探测，404 的自然被排除在排序之外。

**我们的处理**（不引入探测开销，也不负优化）：

1. **首选仍是「原有可用地址」** —— 这是实测一直能用的路径，不动它
2. 原图只作为 `xhsOriginalUrl` **额外候选**
3. 下载前用 `probeOriginal()`（HEAD，3s 超时）探一次，**200 才升级为首选**

净效果：原图可用时拿到原图，不可用时完全等同原行为。**只可能更好，不会更差。**

### 3.3 SSR 快路径（`js/xhs-ssr.js`）

**做法**：直接 `fetch` 详情页 HTML，从 `<script>` 里正则截出
`window.__INITIAL_STATE__` 再解析，**完全不开标签页**。

**实测数据**：

```
HTTP 200 ／ HTML 100,582 字节 ／ state 19,574 字节
JSON.parse 成功 ／ noteDetailMap 键 ["6ae7193c0000000025038f26"]
```

对比原路径：`tabs.create` + 等 18 秒 + 1.2 秒缓冲。**省掉 19 秒/篇。**

**技术难点**：SSR 注入的是**经过 hydration 的 JS 字面量**，不是纯 JSON：

```js
{"a": undefined, "b": new Map([])}     ← 直接 JSON.parse 必抛
{"a": null,      "b": []}              ← 规范化后才能解析
```

`normalizeJsLiteral()` 按字符串分段处理，**只替换字符串以外的部分** ——
否则标题里正好写了 `undefined` 就会被误改（单测 B5/B6 固定）。

**回退策略**：任何失败（未登录/风控/结构变化）都返回 `null`，
调用方**无痕回退**到原来的开标签页路径。

> **实测注意**：`xsec_token` 是必需的。不带 token 请求同一 URL 时
> `noteDetailMap[id]` 不存在（实测报 `Cannot read properties of undefined`）。

### 3.4 候选链与命名

- 图片首选：`infoList` 里 `WB_DFT` 场景的地址（带 `!nd_dft_` 后缀，CDN 必需）
- 兜底：`urlPre` → 原图（探测通过时）
- 地址统一升级 `http → https`（实测 `http://` 在页面 fetch 会 `Failed to fetch`）

---

## 四、Range 分段下载（`js/offscreen-fetch.js`）

### 4.1 参数

| 项 | 值 | 依据 |
|---|---|---|
| 并发段数 | **4** | Chrono 用 5；扩展上下文同时 5 条 fetch 对 CDN 压力偏大 |
| 最小分段体积 | **1 MB** | 小文件分段反而增加开销 |
| 单段重试 | 1 次 | 换连接，不改区间 |

### 4.2 启用条件（缺一不可）

1. HEAD 探测成功
2. `content-length ≥ 1MB`
3. 响应头含 `Accept-Ranges: bytes`

任一不满足 → **静默回退单次全量**。不因为想分段而把原本能下的搞挂。

### 4.3 分段边界

`[0, size-1], [size, 2size-1], ...` 最后一段用 `Math.min(..., total-1)` 收尾。
单测 `test-range-split` 覆盖：完整覆盖、无缝隙、无重叠、不越界。

---

## 五、YouTube 上限放开

`js/yt/yt-download.js`：

| 常量 | 原值 | 现值 |
|---|---|---|
| `MAX_HEIGHT` | 1080 | **2160** |
| `MAX_TRACK_BYTES` | 400 MB | **700 MB** |

**8K 仍不提供**：单轨常超 1GB，本机双轨全量进内存再合并必失败。

> 这是**产品策略**调整（苏哥 2026-11-07 拍板），不是技术限制。
> 代码里原本就有「只有 4K 没有 1080p」的兜底分支，说明技术上一直拿得到。

---

## 六、验证记录

### 6.1 单测

| 套件 | 结果 |
|---|---|
| `test-video-quality` | **57 / 57** |
| `test-xhs-media` | **25 / 25** |
| `test-xhs-ssr` | **26 / 26** |
| `test-range-split` | **18 / 18** |
| 既有套件（naming/save/path/image-util/image-batch） | 全绿 |

### 6.2 真实环境实测（Edge 9480，登录态）

| 项 | 结果 |
|---|---|
| 小红书 SSR fetch | 200 ／ 100,582 字节 ／ 解析成功 |
| `noteDetailMap` | 命中目标笔记 |
| `ci` 原图 HEAD | 200（该素材）／ 404（另一素材） |
| 带签名 CDN 地址页面 fetch | `Failed to fetch`（故不能作首选） |
| 微博 `statuses/show` | `tv/show` id 返回 20101（故只限信息流） |

---

## 七、明确没做的

| 项 | 原因 |
|---|---|
| 文件头探测真实宽高 | 每张图多一次请求；改用 HEAD 探测 + 候选回退替代 |
| Tubly 的云端代理解析 | 需把 Cookie 发到第三方，隐私不可接受 |
| 8K 下载 | 本机内存撑不住双轨合并 |
| 小红书批量自动翻页 | 维持「只处理已渲染卡片」的既有口径 |

---

## 八、复现命令

```bash
# 单测
node tools/test-video-quality.js
node tools/test-xhs-media.js
node tools/test-xhs-ssr.js
node tools/test-range-split.js

# 语法
node --check js/video-quality.js
node --check js/xhs-media.js
node --check js/xhs-ssr.js
node --check js/offscreen-fetch.js
```