# 嗅探规则总账（图片 / 视频）

> 日期：2026-11-09 ｜ 起因：苏哥发来 MSN 视频页「识别成图片、下载不了」，要求「查一下通用的规则，图片和视频都嗅探是怎么做的」
> 结论先行：**视频靠网络嗅探，图片靠 DOM 扫描 —— 两套完全不同的通道**。这次坏在视频那条链路上，图片通道没参与。

---

## 一、一句话对照

| | 图片 | 视频 |
|---|---|---|
| 数据从哪来 | **页面 DOM 的 `<img>` 标签** | **浏览器的网络请求** |
| 什么时候拿到 | 用户点「抓图」/ 悬停时现扫 | 页面加载、播放时持续收集 |
| 靠什么判定 | `naturalWidth/Height` ≥ 门槛（默认 120px）| 响应头 `Content-Type` + URL 扩展名 |
| 存哪 | 不缓存，每次现扫 | `cacheData[tabId]` 内存数组 |
| 典型失败 | 懒加载未解码（已修）| 播放器按字节切片（本次修）|

**为什么视频不能靠 DOM**：`<video src>` 拿到的是页面写进去的地址，可能只是播放列表；真正常见的还有 `blob:`（MSE）、iframe 内播放、接口下发。只有看网络请求才知道浏览器到底在下载什么。

**为什么图片不能靠网络**：一张页面上百张图，网络层只能看到请求，分不清「正文配图」还是「按钮图标 / 头像 / 表情」。DOM 里有尺寸和位置，才能判断。

---

## 二、视频嗅探：四条链路，按可靠性排序

### ① webRequest（最准，`,background.js` 的 `findMedia`）

```
onSendHeaders → 提前记 requestHeaders（Referer/Cookie 要在这一步抢）
        ↓
onResponseStarted → 拿到响应头 → 判定 → 入 cacheData
```

判定顺序（`findMedia` 第 260-290 行）：

| 步骤 | 依据 | 说明 |
|---|---|---|
| ① 扩展名 | `CheckExtension(ext)` | `G.Ext` 白名单 33 项（mp4/webm/m3u8/mpd/flv…）|
| ② Content-Type | `CheckType(type)` | `G.Type` 白名单：`video/*`、`audio/*`、`application/x-mpegurl`、`application/dash+xml` |
| ③ Content-Disposition | 附件头里的文件名 | 下载接口常用 |
| ④ `data.type === 'media'` | 浏览器自己认定的媒体 | 兜底 |

> ⚠️ `G.Type` 里**没有 `image/*`** —— 图片压根不走这条路。

### ② net-sniff（补「接口里藏地址」的漏，`js/net-sniff.js`）

页面主世界劫持 `fetch` / `XHR` / `JSON.parse`，扫响应体里的媒体地址。

适用：抖音（播放地址在 aweme detail 接口里，页面根本不发 `.mp4` 请求）。

四条正则：

| 正则 | 覆盖 |
|---|---|
| `MEDIA_RE` | 带扩展名的地址（`.mp4/.m3u8/.mpd/…`）|
| `PATHY_RE` | 无扩展名但路径明确的（`/video/tos/`、`playwm`、`playlist`、`vod/`）|
| `XHS_ANY_RE` | 小红书 CDN（无扩展名，靠目录判定）|
| `PerformanceObserver` | `<img>` 直接加载的资源（小红书搜索页）|

**本次修复**：原来 `all_frames: false` —— **只注入顶层 frame**。MSN 这类站点的播放器在 iframe 里，接口响应一条都扫不到。已改 `all_frames: true`。

### ③ 页面内嵌数据（`vrPageEmbeddedVideoProbe`）

前两条都空时，从页面变量（`__INITIAL_STATE__`、`__NUXT__` 之类）里挖。

### ④ 播放器直读（站点增强，不通用）

抖音爬 React Fiber（`js/douyin.js`），B站问 playurl（`js/bili-whole.js`），X 走 syndication。
这些是「通用通道抓不到时的增强」，不替代 ①。

---

## 三、图片嗅探：只有一条路（`js/lib-image-util.js` 的 `scanImages`）

```js
doc.querySelectorAll('img')
  → currentSrc || src
  → 排除 data: / svg / 占位图
  → naturalWidth/Height ≥ 120（尺寸未知时不拦）
  → 按显示尺寸再过滤小图标
  → 按 URL 去重
```

三个刻意不拦的情况（都是实测踩出来的）：

| 情况 | 处理 | 原因 |
|---|---|---|
| `naturalWidth === 0`（懒加载未解码）| 用 `width/height` 属性；都没有则仍收录、尺寸标 0 | 花瓣首页 557 张图里 540 张未解码，一律丢弃等于「本页只有 6 张图」|
| 尺寸未知 | 不拦截，交给调用方标「尺寸未知」| 同上 |
| `<source srcset>` | 解析 `srcset` 取最大候选 | 响应式图片常只在 srcset 里给大图 |

---

## 四、竞品怎么做的（星愿已装，2026-11-09 复读）

| 扩展 | 嗅探方式 | 格式覆盖 |
|---|---|---|
| **Video Downloader Plus** 4.0.0 | 扩展名白名单 21 项 + 少量 MIME | `mp4 webm m3u8 mpd mp3 m4v mkv ts aac mov m4a flac avi ogg wav mpg wmv flv 3gp m2ts mts` |
| **Video Downloader Pro** 0.1.11 | MIME 分类 + `document_start` 全站注入（含 iframe）| `direct` / `stream` 两类；HLS + DASH 并列 |
| **Chrono** 0.13.12 | 遍历 `document.links/images/audio/video/source` | 定位是下载管理器，嗅探极简 |
| **Tubly** | 把 Cookie 和视频信息**发给自家服务器**解析 | ❌ 不抄（隐私）|

**和我们比的差距**：

- 两家都覆盖 **iframe**（`all_frames: true`），我们原来只有 content-script 覆盖 —— 已修
- Plus 有 `m2ts` / `mts` / `mpg` 三个我们 `G.Ext` 里没有的扩展名（**待办**：加默认值需配套设置迁移，否则老用户拿不到）
- 三家都**没有**处理 `?start=&end=` 这种字节分片 —— 这是本次我们自己补的

---

## 五、本次修的四个缺陷

### 5.1 字节分片被当成完整文件（核心）

**现象**：MSN 视频「下载不了」。

**实测证据**：

| 请求 | 结果 |
|---|---|
| `…/xxx.mp4_bd.mp4?start=0&end=15&_t=179422…` | `206` + `Content-Range: bytes 48846-679008/3505399` ← **碎片** |
| `…/xxx.mp4_bd.mp4`（剥掉参数）| `200` + `Content-Length: 3505399` ← **完整文件** |
| `…/xxx.mp4`（原始直链，无 `_bd`）| `403` + `text/html` ← **死链** |

**修法**：`VRVideoQuality.unsegmentUrl()`（13 条单测 H1-H18）

铁律：**只在确认是字节分片时才动手**，签名参数一律保留。

| 情况 | 动作 |
|---|---|
| `start` + `end` 同时存在且都是纯数字 | 剥掉两者 + 防缓存戳（`_t`/`ts` 等 10 位以上纯数字）|
| `bytestart` + `byteend`（Instagram）| 同上，但 `efg`/`oh` 等签名保留 |
| `range=0-1234` | 剥掉 `range`，其余保留 |
| 只有 `start`（可能是播放起点）| **不动** |
| `start`/`end` 不是纯数字（ISO 时间）| **不动** |

**验收**：还原地址下载落盘 **13,935,291 字节**，与服务器 `Content-Range` 报告的总长**完全一致**；MP4 结构 `ftyp + moov(187KB) + free + mdat(13.7MB)` 完整可播，不是碎片。

### 5.2 同一个视频被记成好几条

**现象**：一个 7 条视频的页面，列表里 23 条。

**修法**：`vrNormalizeCandidates()` —— 按「同媒体主干」归并

```
https://cdn/video/087d2e….mp4        ┐
https://cdn/video/087d2e….mp4_bd.mp4 ┘ → 主干 …/video/087d2e…  → 一条
```

归并时保留信息最全的那条（有 `Content-Type` / 有体积的，说明浏览器真拉成功过）。

主干识别要求名称长度 ≥ 16（hash/UUID 长度），避免把 `video.mp4` 这种通用名误合。

### 5.3 死链混在列表里，点哪条都失败

**修法**：`vrProbeCandidates()` —— 出列表前用 `Range: bytes=0-1` 探一次

| 探测结果 | 处理 |
|---|---|
| `4xx / 5xx` | 丢弃（服务器自己说不行）|
| `2xx / 206` | 留下，回填 `Content-Type` 与真实体积 |
| 网络错误 / CORS | 留下（扩展探测不了 ≠ 不可用）|
| **全部被判死** | **原样放回**并标记 `probeDead`，note 显示「地址已失效 · 先播放几秒再试」|

最后一条是保险：探测在页面主世界跑，可能被 CORS / 防盗链误杀（抖音 `video/tos` 只认特定 Referer）。**宁可多列几条，也不能让列表空着。**

### 5.4 iframe 里的播放器挖不到

**修法**：`net-sniff.js` → `all_frames: true`；`addMedia` 改用 `sender.tab.id` 归位

顺手修的一个隐患：原来 `addMedia` 拿 `href` 去 `tabs.query` 里比对，iframe 发来的 `href` 是 **iframe 的 URL**，永远匹配不到 → 落到「当前激活 tab」。用户切到别的标签再触发，地址就归错页了。

---

## 六、已知边界（说清做不到的）

| 情况 | 现状 | 原因 |
|---|---|---|
| 页面没播放过，只有签名直链 | 列表显示「地址已失效 · 先播放几秒再试」| 签名地址由播放器现算，扩展拿不到 |
| MSE（`blob:` 流） | 抓不到 | `blob:` 没有网络请求，只能录屏 |
| iframe 里的播放器 | 已覆盖（本次）| — |
| 直播 | 不支持 | 定位是「下载已有素材」|
| `m2ts` / `mts` / `mpg` | 未收录 | 需配套设置迁移 |

---

## 七、代码索引

| 能力 | 文件 | 函数 |
|---|---|---|
| 网络嗅探主链路 | `js/background.js` | `findMedia`（189）|
| 类型/扩展名白名单 | `js/init.js` | `G.OptionLists.Ext / Type`（29/63）|
| 分片还原 | `js/video-quality.js` | `unsegmentUrl` |
| 候选归并 | `js/background.js` | `vrNormalizeCandidates` / `vrMediaStem` |
| 可达性预检 | `js/background.js` | `vrProbeCandidates` |
| 页面侧挖地址 | `js/net-sniff.js` | `scan` / `guessExt` |
| 图片扫描 | `js/lib-image-util.js` | `scanImages`（632）|
| 候选排序 | `js/video-quality.js` | `sortCandidates` |
