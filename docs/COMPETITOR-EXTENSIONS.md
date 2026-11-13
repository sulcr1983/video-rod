# 竞品扩展拆解总账（星愿浏览器已装扩展）

> 日期：2026-11-07 ｜ 状态：持续更新 ｜ 用途：**别人扩展的能力清单**，逐条评估「抄 / 不抄」
> 方法：直接读星愿浏览器 `Default/Extensions/` 下的扩展源码（未压缩的读源码，混淆的读常量与权限）
>
> 配套代码：`js/video-quality.js`（清晰度解析与排序，纯函数 + 57 条单测）

---

## 一、为什么要有这份文档

苏哥反复要求「参考别人的扩展」。零散结论散在对话里会丢，这里统一记账：
**每个扩展做了什么、我们抄了哪条、为什么不抄、落在哪个文件**。

评审时只看两列：**「抄了什么」** 和 **「明确不抄」**。

---

## 二、已装扩展清单（2026-11-07 实读）

| 扩展 ID | 版本 | 名称 |
|---|---|---|
| `hkdmdpdhfaamhgaojpelccmeehpfljgf` | 4.0.0 | **Video Downloader Plus** |
| `npolimekdjdhijlfikfghaipaijbbobj` | 1.6.4 | **YouTube Downloader by Tubly** |
| `lmiohojceikgjanglcbkcofbbaadjjnk` | 0.16.14 | **笃笃微博抖音下载器** |
| `nddgpbijffhefkchebjjmfdbeonnbfol` | 0.6.2 | **Twitter 视频下载器 – DownXVideo** |
| `mciiogijehkdemklbdcbfkefimifhecn` | 0.13.12 | **Chrono 下载管理器** |
| `blddglfgbnfkbgaecaamfipgaiihgpog` | 0.1.11 | **Video Downloader Pro – 极速视频下载器 & 录制器** |
| `kaepaapgaokpobjhamjjekinijbcoihe` | 2.8.50 | 抖珍藏 - 下载备份你爱过的所有抖音 |
| `piibekljdlkbkdchicfdjpnaggolndif` | 5.9 | Plucker XBD - X(推特)媒体一键下载器 |
| `ndcileolkflehcjpmjnfbnaibdcgglog` | 6.52.0 | AdBlock |
| `gjnklekhgijlmadcjdnkcamcbpppmkdo` | 2.1.0 | 视频去广告-Video Adblocker |

---

## 三、逐条拆解

### 3.1 Video Downloader Plus 4.0.0 —— ✅ 抄了「HLS master 解析」

**它怎么做**

- 全站注入：`matches: *://*/*`，`document_end`
- 后台按 MIME + 扩展名分类：`application/vnd.apple.mpegurl` / `application/x-mpegURL` / `video/vnd.mpeg.dash.mpd` / `application/dash+xml` / `text/x-mpegURL`
- 解析 HLS master 的每个 variant：
  ```js
  const n = e.match(/BANDWIDTH=(\d+)/i);      // estimatedBandwidth
  const u = e.match(/RESOLUTION=(\d+)x(\d+)/i); // width / height
  ```
- 递归展开（`Do()`），并对已处理的播放列表打标记避免重复

**我们抄了什么**

`js/video-quality.js` 的 `parseHlsMaster()` + `pickBestVariant()`：
标准 `#EXT-X-STREAM-INF` 解析，相对地址补绝对，按 height → bandwidth 排序。

**业界为什么这么做**：master 里每一档都写着真实分辨率，比在 URL 上猜可靠。

---

### 3.2 Twitter DownXVideo 0.6.2 —— ✅ 抄了「排序规则 + 尺寸解析」

**它怎么做**

- `document_start` 注入 **MAIN world**（`page-media-capture.js`），在页面加载前就拦截
- 走 Twitter syndication 接口拿 `video_info.variants`（**全量码率**，不是嗅探）
- 排序函数（`local-parsers.js:586`）：
  ```js
  function compareVariants(left, right) {
    return Number(right.height || 0) - Number(left.height || 0)
      || Number(right.bitrate || 0) - Number(left.bitrate || 0)
      || Number(right.width || 0) - Number(left.width || 0);
  }
  ```
- 从 URL 路径解析尺寸（`parseDimensions`）：`/\/(\d{2,5})x(\d{2,5})\//`

**我们抄了什么**

1. `sortCandidates()` 采用**同款排序键**：height 降序 → bitrate/size 降序。
   关键修正：**「正在播放」只作最后一级加权**，不像旧代码那样无条件置顶
   （微博信息流默认播 720p，置顶就等于永远拿 720p）。
2. `heightFromUrl()` 增加 `WxH` 路径解析（对应它的 `parseDimensions`）。

**没抄**：syndication 接口（X 平台专属，我们已有 `fetchXVideo` 走 fxtwitter）。

---

### 3.3 笃笃微博抖音下载器 0.16.14 —— ⚠️ 部分抄，有坑

**它怎么做**

```js
// content.js
const e = (id) => request(`https://${location.hostname}/ajax/statuses/show`, { id, locale: 'zh-CN' });
const I = (Z) => {
  const { stream_url, stream_url_hd, mp4_sd_url, mp4_hd_url } = Z;
  return mp4_hd_url || stream_url_hd || mp4_sd_url || stream_url;
};
```

即：`mid` → `ajax/statuses/show` → `page_info.media_info.mp4_hd_url`。

**实测踩到的坑（重要）**

- `tv/show/1034:xxx` 里的 id **不能**直接当 mid 用：接口返回
  `{"ok":0,"message":"该微博不存在","error_code":20101}`。
- 该方法只对**信息流卡片**（有 `mblogid`）有效。
- 扩展上下文请求会被微博 302 到 `passport.weibo.com/visitor/visitor`，
  **必须在页面主世界 fetch**。

**我们抄了什么**

`js/video-quality.js` 的 `pickWeiboHdUrl()`（字段优先级）+ `weiboMidFromUrl()`（mid 提取），
配合 `background.js` 的 `vrWeiboHdProbe()`（页面上下文 fetch，6s 超时）。

**明确不抄**：把它当唯一路径。`tv/show` 页拿不到 mid 时静默回落嗅探结果，不报错。

---

### 3.4 Chrono 下载管理器 0.13.12 —— ⏸ 分段下载待评估

**它怎么做**

- 定位是**下载管理器**，不是嗅探器
- 嗅探脚本极简（`cs/sniffer.js` 仅 1.4KB）：全量遍历
  `document.links` / `images` / `audio` / `video` / `source` / `script` / `link`，
  并抓 `a.download` 属性作为文件名、`alt`/`text` 作描述
- 每个下载任务带 `max_threads_config: 5`（默认 5 线程）
- 任务字段：`finished_bytes` / `batch_num` / `resume` / `Range` / `checksum`
- 鼠标按下时抓 `a[href]` 与 `img[src]` 并上报（`url_desc`）

**可借鉴**

| 点 | 价值 | 风险 |
|---|---|---|
| 5 线程 Range 分段 | 大文件明显提速 | 需重写下载层，回归面大 |
| `a.download` 属性作文件名 | 低成本、立刻可用 | 本站点常为空 |
| 全量 DOM 遍历（含 `source`/`link`） | 补漏嗅探 | 与现有嗅探重叠 |

**当前状态**：**未实施**。需要单独立项，不能混在清晰度改动里。

---

### 3.5 Tubly（YouTube Downloader）1.6.4 —— ❌ 不抄（隐私代价）

**它怎么做**

```js
// BYMRNK0U.js
cookies.get(d).then(e => e?.value)            // 取 YouTube Cookie
b = await chrome.runtime.sendMessage({ rfa: "sham", rfb: b })  // 发给 tubly.download
```

- 权限：`cookies` + `declarativeNetRequestWithHostAccess` + `offscreen`
- host 权限含 `*.googlevideo.com`、`*.tubly.download`、`*.workers.dev`
- 把所有视频信息 + **Cookie 外发到自家服务器**解析，服务器返回可下载直链

**为什么它能下 4K/8K**：签名/解密在它服务器上做，本地只是个壳。

**明确不抄**：Cookie 外传 = 把用户登录态交给第三方。我们已有本地 nsig/ssig 解密
（`js/yt/yt-page.js`），能力上不需要它。

---

### 3.6 Video Downloader Pro 0.1.11 —— ✅ 抄了「DASH 格式覆盖」

**它怎么做**

- 权限：`scripting` / `webRequest` / `declarativeNetRequest` / `sidePanel`
- 全站 `document_start` 注入（`all_frames: true`）
- 后台按 MIME 分类，把 **HLS 与 DASH 并列支持**：
  ```js
  else if (/^video\/vnd\.mpeg\.dash\.mpd/i.test(p) || /^text\/xml/i.test(p) && /\.mpd($|\?)/.test(e))
    l.mimeType = "video/vnd.mpeg.dash.mpd";
  ```
- `videoType`: `direct`（直链）/ `stream`（流）
- 带直播录制（`contentNNTLiveRecorder`）

**我们抄了什么**

`js/video-quality.js` 的 `parseDashMpd()`：解析 `<Representation>` 的
`width` / `height` / `bandwidth` / `codecs`，跳过纯音频轨，
再用同一条 `pickBestVariant()` 排序。

配合 `background.js` 的 `vrProbeDashMpd()`，让候选列表能显示
`4320p` 这类真实档位，而不是把 `.mpd` 当成一个不明大小的 MP4。

**已知坑**：解析属性必须加词边界，否则 `width` 会匹配到 `bandwidth="..."` 里的 width
（单测 G2 固定了这条）。

**没抄**：直播录制（与我们「下载已有素材」的定位不同）。

---

### 3.7 复读两个视频下载器 —— ✅ 抄了「iframe 覆盖」，❌ 谁都没解决字节分片

> 2026-11-09，苏哥发来 MSN 视频页「下载不了」，要求「看人家是怎么嗅探各种视频格式的」。

**它们各自的判定**

- **Video Downloader Plus 4.0.0**：扩展名白名单 21 项（`mp4 webm m3u8 mpd mp3 m4v mkv ts aac mov m4a flac avi ogg wav mpg wmv flv 3gp m2ts mts`）+ 少量 MIME。
  比我们多 `m2ts` / `mts` / `mpg` 三项。
- **Video Downloader Pro 0.1.11**：`document_start` 全站注入且 **`all_frames: true`**，MIME 分 `direct` / `stream` 两类，HLS/DASH 并列。

**抄了什么**

1. **iframe 覆盖**。我们 `net-sniff.js` 原来是 `all_frames: false` —— 只注入顶层。
   MSN / 新闻站的播放器都在 iframe 里，接口响应一条都挖不到。已改 `all_frames: true`。
2. 顺带修了 `addMedia` 的归位：iframe 发来的 `href` 是 iframe 的 URL，
   拿它去 `tabs.query` 比对永远匹配不到，会落到「当前激活 tab」。

**它们也没做到的（我们自己补）**

两家的嗅探都是「看到请求就收录」，**没有一家处理 `?start=0&end=15` 这种字节分片地址**。
MSN 就是这种：播放器把单个 MP4 按字节切片反复拉，每次响应都是 206 片段。
抄它们的做法只会得到一堆碎片。我们的解法见 `docs/SNIFF-RULES.md` §5.1。

**明确不抄**：`m2ts` / `mts` / `mpg` 暂不补进 `G.Ext` 默认值 —— 白名单是用户可见设置项，
加默认值需要配套的设置迁移，否则老用户拿不到，属于「改了等于没改」。

---

## 四、汇总：抄了什么 / 不抄什么

| 能力 | 来源 | 状态 | 落点 |
|---|---|---|---|
| HLS master 解析（RESOLUTION/BANDWIDTH） | Video Downloader Plus | ✅ 已实现 | `video-quality.js` `parseHlsMaster` |
| 候选排序 height→bitrate→当前播放 | DownXVideo | ✅ 已实现 | `video-quality.js` `sortCandidates` |
| URL `WxH` 尺寸解析 | DownXVideo | ✅ 已实现 | `video-quality.js` `heightFromUrl` |
| DASH MPD 解析 | Video Downloader Pro | ✅ 已实现 | `video-quality.js` `parseDashMpd` |
| 微博 `statuses/show` 取高清 | 笃笃 | ✅ 已实现（限信息流） | `background.js` `vrWeiboHdProbe` |
| iframe 嗅探覆盖 | Plus / Pro | ✅ 已实现（2026-11-09） | `manifest.json` `net-sniff` → `all_frames: true` |
| 字节分片还原 | **三家都没有** | ✅ 自研 | `video-quality.js` `unsegmentUrl` |
| 5 线程分段下载 | Chrono | ⏸ 待立项 | — |
| `a.download` 作文件名 | Chrono | ⏸ 待评估 | — |
| 云端代理解析 | Tubly | ❌ 不抄（隐私） | — |
| 直播录制 | Video Downloader Pro | ❌ 不抄（定位不同） | — |
| 付费/积分墙 | 笃笃、小微 | ❌ 不抄 | — |

---

## 五、这一轮发现的自身问题（修复记录）

### 5.1 微博视频永远只有 720p

**根因**：`vrVideoOptions` 的排序把「正在播放」**无条件置顶**，
而微博信息流默认播 720p → 一键下载永远拿 720p。

**修复**：改为 `height → size → 当前播放`，且 `list.unshift(playing)` 也改走同一排序。

### 5.2 菜单里 6 个档位看起来像 6 个视频

**根因**：标签只有 `MP4 · 4.0MB`，同一视频的不同码率无法区分。

**修复**：标签带分辨率（`1080p · 45.6MB`），并新增 `collapseByAsset()` 可按素材归组。

### 5.3 YouTube 只能 1080p

**根因**：**产品策略**，不是技术限制。`js/yt/yt-download.js` 里写死：
```js
/* 画质硬上限：1080p。苏哥 2026-11-06 定：1080p 够用，超过的不提供。 */
var MAX_HEIGHT = 1080;
```
`.filter(f => f.height <= MAX_HEIGHT)` 主动丢弃 4K/8K。

**修复（苏哥 2026-11-07 拍板）**：`MAX_HEIGHT` 放开到 **2160（4K）**，
`MAX_TRACK_BYTES` 从 400MB 提到 700MB（4K 单轨常见 200~500MB），
提示文案同步改为「最高支持 4K（2160p），8K 档位已隐藏」。
**8K 仍不提供**：单轨常超 1GB，本机双轨合并必失败。

---

## 六、待办（按优先级）

| # | 事项 | 说明 |
|---|---|---|
| 1 | 分段下载立项 | Chrono 的 5 线程 Range；需重写下载层，单独评估 |
| 2 | 微博信息流高清实测 | `statuses/show` 路径需在**信息流卡片**上验证（`tv/show` 的 id 无效） |
| 3 | 4K 合并实测 | 放开上限后要真机验证一次 4K 双轨合并是否稳定 |
| 4 | 更多站点适配 | XBD / 抖珍藏 的可借鉴点尚未拆解 |

---

## 七、复现方法

```bash
# 列出星愿里所有扩展及真实名称
python $TMPDIR/list_ext.py

# 读某个扩展的源码
# C:\Users\Administrator\AppData\Local\Twinkstar\User Data\Default\Extensions\<id>\<version>_0\
```

**不要**把扩展源码复制进仓库：只记录结论与关键片段，避免许可证风险
（其中 weibo-crawler、weibo-extend 无 LICENSE，XBD 系为闭源）。
---

## 八、第二批拆解（2026-11-07 晚）

### 8.1 小红书下载助手 - 图片视频下载 v1.0.2 ✅ 已抄 2 条

扩展 ID `edeaccoppfnefdnpdgmmamcgibbgkdpl`，代码**未混淆**，质量高。

**它怎么做**

| 环节 | 做法 | 位置 |
|---|---|---|
| 取笔记数据 | MAIN world 读 `__INITIAL_STATE__.note.noteDetailMap[id].note` | `content/page-agent.js:95` |
| **批量不开标签页** | background **直接 fetch 详情页 HTML**，正则截 `__INITIAL_STATE__` 再 parse | `background.js:467-483` |
| **原图推导** | `pathname.split('!')[0]` → 改写 `https://ci.xiaohongshu.com/{notes_pre_post|spectrum}/{key}` | `background.js:325-335` |
| 择优 | 读文件头 256KB 探测真实宽高/格式，按像素取最大 | `background.js:385-428` |
| 扩展名 | 按响应 MIME 校正（`onDeterminingFilename`） | `background.js:37-48` |
| 批量 | 纯串行，无 sleep、无翻页、不滚动 | `content.js:2032-2077` |
| 命名 | 模板 token + Windows 保留名 + 180 字符截断 | `content.js:46-101` |

**我们抄了什么**

1. **原图推导** → `js/xhs-media.js` 的 `originalUrl()`
   `!nd_dft_wlteh_webp_3` 这类 CDN 处理指令截断后，改写 ci 域。三条规则：
   `notes_pre_post/<key>` / `spectrum/<key>` / 纯 `1040...` 素材 ID。
2. **候选链** → `imageCandidate()`：**原有可用地址为首选**，原图作额外候选。

> ⚠️ **2026-11-07 实测修正（重要）**：`ci.xiaohongshu.com` 对**部分**素材 ID 返回 404。
> 实测样本：`1040g2sg3271c1gng6qdg491k3adll5k` → `ci` **404 text/plain**，
> 而原地址 `sns-webpic-qc.xhscdn.com/.../1040g2sg...` 正常。
>
> 对方之所以没踩坑，是因为它用 `probeImage` 读文件头逐个探测后才排序，
> 404 的自然被排除。我们不做探测，所以**绝不能盲目把原图放首位** ——
> 那等于每张图先白跑一次失败，比原来更慢（负优化）。
>
> 最终实现：**保持原有可用地址为首选**（不破坏既有能力），
> 原图仅在 `probeOriginal`（HEAD 探测）通过后才升级。

**没抄**

- 文件头探测（每张多一次请求，我们优先用候选链回退替代）
- 不滚动/不翻页的批量（我们有 `xhs-batch.js` 的半自动收集）

**明确记下的差距（后续可做）**

| # | 差距 | 价值 |
|---|---|---|
| 1 | **后台 fetch 详情页 HTML 解 SSR**（不开标签页） | 高：我们现在 `tabs.create` 逐篇开，慢且易风控 |
| 2 | 按响应 MIME 校正扩展名 | 中：解 webp 被写成 `.jpg` |
| 3 | 文件头探测真实尺寸 | 中 |
| 4 | 收藏/点赞分类 + aria-selected 判定 | 中 |
| 5 | blob 视频流式保存 + 500MB 熔断 | 中 |

### 8.2 Download Master 2026.10.14.0 ❌ 无可抄的下载内核

扩展 ID `ameobllgfelffdengghkfoeagpohnhjk`。

**结论：它是「链接扫描器 + `chrome.downloads.download` 批量投递器」，不是下载管理器。**

| 关注点 | 结论 |
|---|---|
| 多线程/分段 | **完全没有**（0 处 `Range`，串行 1 个） |
| 断点续传 | 无（交给 Chrome 原生） |
| 任务持久化 | 无（状态在 SW 内存，休眠即丢） |
| 重试 | 仅 1 次，且只在 `downloads.download` **同步拒绝**（多为 filename 非法）时；网络中断不重试 |
| 接管理下载 | 无（无 `onDeterminingFilename`/`onCreated`/DNR） |

**唯一可抄**：文件名推导链——丢弃 `php/asp/aspx/jsp` 这类动态脚本名，收尾去点与空格，截断 200。

> **比 Chrono 弱一个量级**。要补大文件成功率，该抄的是 Chrono 的分段 + `finished_bytes` + `resume`
> （见 §3.4），不是这个样本。

### 8.3 图片下载器 4.0.0 ✅ 已抄 1 条（源码抓图）

扩展 ID `flbolonkboilcbnohjlchlfgdalomdpl`（v4.0.0，通用工具，非小红书专用）。

**结论：图片收集的「通道」比我们全，但下载内核极弱（只有 `chrome.downloads.download` 单发）。**

| 关注点 | 它的做法 | 结论 |
|---|---|---|
| multipart 收集 | `<img>` + `srcset`（逐个 `new Image()` 比面积取最大）+ computed `background-image` | 我们已有，且更严（带尺寸门槛与条状图排除） |
| **源码正则抓图** | `document.body.innerHTML.match(/https?:\/\/[^"\s]+?\.(jpg\|png\|…)/gi)` | ✅ **已抄**（见下） |
| **iframe 递归** | 向每个子 frame 注入 `iFrame.js`，用 `window.onmessage` 收回结果 | ❌ 未抄：`all_frames:false` 是我们既有边界（B-29），单独立项 |
| 图片上悬浮下载钮 | 每张图套 wrapper，右下角一个 `⬇`，`MutationObserver` 跟进新增图 | ❌ 不抄：我们走侧边栏清单，图上挂钮在长页面上会糊满屏幕 |
| 下载内核 | `chrome.downloads.download` 单发 + `onChanged` 回状态 | ❌ 不抄：我们已有 FSA 直写 + 候选链回退 + 离屏兜底 |

**抄了什么（落点 `js/lib-download-scan.js` → `extractUrlsFromHtml`）**

原式**只认 `https?://`**，实机测试页上 3 张只抓到 1 张。补了两条：

1. `https?:` 前缀可选 → 兼容协议相对地址 `//cdn.x.com/a.jpg`
2. 增加单斜杠分支 `\/(?!\/)` → 兼容站内绝对路径 `/media/x.jpg`（真实站点 JSON 里最常见）

修正后同一测试页 **1 张 → 4 张**（DOM 1 + 源码 3）。
写进 `js/image-page.js` 的 `srcScan` 通道，结果标记 `srcOnly:true`，尺寸记 0 由 UI 显示「尺寸未知」。

> 验收页：`test-site/src-only.html`（图片只写在脚本里，DOM 上没有 `<img>`）。

### 8.4 Download Master 的「全链接扫描」——已移植，但未接 UI

§8.2 说它「唯一可抄是文件名推导链」，这次把另外两条也一并移植了：

| 能力 | 落点 | 当前状态 |
|---|---|---|
| 文件名推导链（丢弃 php/asp 等动态脚本名、清洗非法字符、截 200） | `downloadName` / `sanitizeFilename` | ✅ **已接进导出**：CSV「文件名」列此前恒为空，现在有值 |
| 全链接扫描（`a[href]` 全量 + `video/audio/source/embed/object`） | `collectLinks` | ⚠️ 模块可用、**未接 UI**（见下） |
| 自定义过滤（子串 + `/正则/`） | `matchesFilter` | ⚠️ 同上；且修掉了它「非法正则直接抛错」的毛病 |

**为什么不接全链接扫描进侧边栏**：试过加一个「扫描本页文件（PDF/压缩包/视频）」菜单项，
但我们的下载链路 `vrImgDownload` 会把非图片扩展名一律强转 `jpg`（`VR_IMG_EXT_OK` 白名单），
接上去等于**列出 PDF 却存成 .jpg**。要么改造整条命名/路径链，要么不接——
这一轮选了「不接」，并把那个半成品菜单项删掉（不留死按钮）。

> 后续要做，前置条件是：`vrImgDownload` 的 `type` 从硬编码 `'image'` 改为按扩展名推导，
> 且 `VR_IMG_EXT_OK` 白名单之外的扩展名走通用的 `vrDownloadWithName`。
> 这是一次涉及路径/入库/重命名的改动，单独立项，别顺手塞进图片功能里。

### 8.5 待续

- **Video Download Helper** `jmkaglaafmhbcpleggkmaliipiilhldn` v10.6.7.2（老牌跨站，嗅探规则值得看）
- **SnapHD** `gjnfclcmckeleebakeghdbhjfcbpaafn` v1.0.1

### 8.6 ImageAssistant 1.70.7 —— ✅ 抄 5 条，❌ 不抄 4 条（2026-11-13 实读）

扩展 ID `odphnbhiddhdpoccbialllejaajemdio`，星愿里版本 **1.70.7**，代码未混淆。路径：
`C:\Users\Administrator\AppData\Local\Twinkstar\User Data\Default\Extensions\odphnbhiddhdpoccbialllejaajemdio\1.70.7_0\`

**它怎么做（源码证据）**

| 能力 | 实现 | 落点 |
|---|---|---|
| 全 frame + document_start | `manifest.json:22-27` 的 `content_scripts`：`all_frames:true`、`matches:<all_urls>`；`inspector.js` 先注入 MAIN world | 我们的图片组 `all_frames:false` |
| 三路网络嗅探 | `scripts/inspector.js`：劫持 `XMLHttpRequest.send`、`window.fetch`、`window.Image` 的 `src` setter；响应为 `image/*` 时收 `responseURL`；响应文本（`text/*`、JSON/XML）用图片扩展名正则提取；每 512ms 批量回传 | `js/net-sniff.js` 只抓视频 + 小红书 |
| 响应头缓存 | `scripts/background.js` `_o_initHeadListener`：`webRequest.onHeadersReceived`，`type==='image'` 或 `content-type:image/*` 且 `content-length` 为空/大于 0 → 按 tab 收进 imageMap，附 pageURL/pageTitle/referer/serial | `js/init.js` 的 `G.Type` 不含 `image/*` |
| 多来源合并 | `_o_pushExtractedImage`：同一 URL 合并 DOM/网络/Image 钩子，保留来源优先级与最早 serial；按域名记 referer | 我们只按 DOM 去重 |
| 全属性提取 | `scripts/script.js` `_o_digElement`：遍历元素**所有属性**（含 `style` 内 `url()`），正则提取后用 `new Image()` 预载验证可达才收；`_o_extractImageFromLink` 扫 `<a href>` | `scanImages` 只扫固定 `DATA_ATTRS` |
| iframe 递归 | `_o_zhuruJSYongHash`：`chrome.webNavigation.getAllFrames()` 后逐 frame 注入并提取 | `executeScript` 不传 `allFrames` |
| 原图规则表 | `defaultRegexpUrlRule.properties`：60+ 条 `匹配正则${#^_^#}替换模板`，递归深度 4；微博 `/large/`、Pinterest `/originals/`、豆瓣 `/l/`、知乎、花瓣、堆糖、wallhaven 等 | 只有硬编码 `upgradeSinaimg` + 通用 query 剥离 |
| 尺寸预载 | `scripts/imageExtractor.js`：`_o_max_loading=8` 并发、`_o_img_load_failed_set` 定时重试、`_o_dyLoadSize` 动态载入阈值（离屏用 1px 占位）、按尺寸排序；尺寸漏斗只隐藏不删除 | `fillSizes` 一次性 60 张/2.5s，面板没接 |
| 下载 | `scripts/function.js` `_w_rebate`：逐张 `chrome.downloads.download({url, filename, saveAs:false, conflictAction:'uniquify'})`；防盗链特殊场景用页面上下文 `blobUtil.imgSrcToBlob` 兜底 | 我们把 fetch + FSA 写 + 哈希 + 入库全塞进单张链路 |

**抄什么（落到 B-83/B-84）**

1. **网络层图片缓存**：`onHeadersReceived` 按 tab+frame 收 `image/*`，`Image.src`/fetch/XHR 补动态地址。落 `js/image-net-cache.js` + 扩 `js/net-sniff.js`。
2. **全 frame**：图片组 `all_frames:true`；`vrImg.scan` 用 `webNavigation.getAllFrames` 逐 frame 注入。落 `manifest.json` + `background.js`。
3. **全属性通扫**：`data-*`、`style` 内 `url()`、`srcset`/`picture`、`video poster`、`a[href]`、SVG `<image>`。落 `lib-image-util.js`。
4. **原图规则表**：把 `defaultRegexpUrlRule.properties` 的站点规则改为可配置表（不是硬编码）；递归生成候选，候选校验后再定案。落新 `image-url-rules.js` + `lib-image-util.collectCandidates`。
5. **尺寸预载队列**：并发 8、失败重试、动态载入、只隐藏不删除。落 `fillSizesV2` + 侧栏/面板渲染。

**不抄什么**

1. **不抄 jQuery/Bootstrap/colorbox 的 UI 框架**：与现有设计系统冲突，且体积大。
2. **不抄闭源代码**：只做行为对标，不复制 `inspector.js`/`function.js` 的实现文本。
3. **不抄无上限抓取**：它没有 per-tab 缓存上限；我们按 ADR-082 限 2000 条/24h，避免内存与隐私问题。
4. **不抄“所有下载都串行 + 只依赖 downloads 文件名”**：它放弃目录控制、依赖浏览器改名；我们要求落资源库目录（ADR-081），保留 FSA 主通道 + 并发 2。

> 结论：ImageAssistant 的强项是「网络层缓存 + 全 frame/全属性 + 候选校验 + 轻量下载」；我们的差距在发现层覆盖与批量执行层的候选回退，不在 UI。
