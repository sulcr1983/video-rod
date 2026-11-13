# HLS 站点下载诊断：xx.knit.bid（2026-11-13）

> 触发：苏哥报告 `https://xx.knit.bid/zh-hant/article/28212/` 视频无法下载，
> 而星愿浏览器可以。
> 本文只记录**实测数据**与推断，修法见后续 ADR。

---

## 一、结论先行

| 环节 | 结果 |
|---|---|
| 媒体嗅探（webRequest） | ✅ **成功**：该 tab 缓存 14 条（2 m3u8 + 12 ts） |
| 后台取 m3u8 | ✅ 200 / `application/vnd.apple.mpegurl` / 11 段 |
| 后台取 ts 分片 | ✅ 200 / `video/mp2t` / 12,042,152 字节 / 同步字节 `0x47` 正确 |
| 页面 `<video>` | `src` 与 `currentSrc` **都是 `blob:`**（MSE） |
| 页内悬浮键 | ❌ **未检出**（页面主世界找不到 host 元素） |

**所以问题不在「抓不到」，而在「抓到之后没送到用户手上」。**

---

## 二、页面与媒体形态

页面标题：`阿薰kaOri - 調教日記 122P - 阿薰卡奧里 - 爱妹子`

播放器：`video.js 7.8.0` + `hls.js`（MSE 喂流）。

### 2.1 `<video>` 元素（2 个）

| # | src / currentSrc | 时长 | 分辨率 | readyState |
|---|---|---|---|---|
| 1 | `blob:https://xx.knit.bid/bb52232b-...` | 208.97s | 1920×1080 | 4 |
| 2 | `blob:https://xx.knit.bid/12ee7b3b-...` | 68.03s | 1080×1920 | 4 |

**两条都是 `blob:`，没有直链。** 下载器取不到 blob 内容，必须走 m3u8 抓取。

### 2.2 真实媒体请求

| 类型 | URL | 说明 |
|---|---|---|
| m3u8 | `https://media.knit.bid/play/12a2fbff065d3fc0.m3u8` | 1156B，**11 段**，非 master |
| m3u8 | `https://media.knit.bid/play/7ed2fb73c1c1d55a.m3u8` | 491B，**4 段**，非 master |
| ts | `https://r2-media.knit.bid/uploads/0/9/4/0940007f...ts` | 12,042,152B |

### 2.3 响应头（实测）

```
m3u8: 200  content-type: application/vnd.apple.mpegurl
           content-length: 1156   content-range: (无)   accept-ranges: (无)
ts:   200  content-type: video/mp2t
           bytes: 12042152        首字节 0x47（TS 同步字节，正常）
```

页面无 iframe（`iframes: []`），排除「跨域 iframe 播放器」这条假设。

---

## 三、扩展侧实测

### 3.1 后台缓存（`chrome.storage` 的 `MediaData`）

从 Service Worker 上下文读取，目标 tab（`tabId=2047850319`）**共 14 条**：

```
7ed2fb73c1c1d55a.m3u8   ext=m3u8  type=application/vnd.apple.mpegurl  size=491
12a2fbff065d3fc0.m3u8   ext=m3u8  type=application/vnd.apple.mpegurl  size=1156
+ 12 条 .ts 分片（ext=ts）
```

**结论：嗅探链路完全正常，类型白名单认得出 `application/vnd.apple.mpegurl`。**

### 3.2 页内悬浮键

在页面主世界扫描 `#catCatch`、`#vr-hover`、`#video-rod` 等候选 id，
以及 `body > *` 的 shadowRoot，**全部为空**。

> 注意：页面上下文没有 `chrome` API（读 `chrome.storage` 报
> `Cannot read properties of undefined (reading 'session')`），
> 所以悬浮键检查必须改用「DOM 扫描」，不能靠调 API。

### 3.3 后台取流能力

在 SW 上下文直接 fetch：

```
m3u8 → 200, 1156 字节, 解析出 11 个 .ts
ts   → 200, 12042152 字节, 首字节 0x47
```

**下载能力本身没有问题。**

---

## 四、真正的断点

`ts` 的 `state` 在当前默认配置里是 **`false`**（关闭），见 `js/init.js`：

```json
{ "ext": "ts", "size": 0, "operator": ">=", "unit": "KB", "state": false }
```

同时该页面**只有 HLS 分片、没有直链**，一旦 m3u8 这条没被正确处理，
用户就看不到任何可下的东西。

---

## 五、星愿的对照实现（`resources2.pak` 反解）

星愿把 HLS 判定写得很宽：

```js
function is_m3u8_content(ct, url) {
  return ct.includes("application/x-mpegURL")
      || ct.includes("application/vnd.apple.mpegurl")
      || url_has_ext(url, ".m3u8");     // 不看 MIME，只看后缀
}

function is_mp4_content(ct, url) {
  return ct.includes("application/octet-stream") && url_has_ext(url, ".mp4");
}

function VideoInfoFromData(n) {
  // content-range 若不是 "bytes 0-" 开头 → 返回 null（分段请求不重复记）
  // 最终判据：ct.startsWith("video/") || isM3u8 || isMp4
  // 且 content-length === 0 → 丢弃
}
```

**可借鉴的两点**：

1. **m3u8 优先看后缀，不只看 MIME** —— 有些站返回 `text/plain` 或 `octet-stream`
2. **`content-range` 非 `bytes 0-` 的直接丢弃** —— 避免 Range 续传请求把列表刷成重复项

---

## 五之二、修法（待落地）

**根因只有一行**：`js/background.js:3766`

```js
// 现在
const VR_VIDEO_EXT = /^(mp4|webm|mkv|mov|flv|ts|avi|m4v|m4s)$/i;
// 缺 m3u8 与 mpd —— HLS/DASH 播放列表在候选过滤第一步就被丢掉
```

改成：

```js
const VR_VIDEO_EXT = /^(mp4|webm|mkv|mov|flv|ts|avi|m4v|m4s|m3u8|mpd)$/i;

/* HLS/DASH 的分片后缀：只有在**没有**播放列表时才单独当候选。
 * 有 m3u8/mpd 时，分片是同一条视频的碎片，全列出来只会让用户
 * 以为那是十几个不同的视频（实测就是这么误导的）。 */
const VR_SEGMENT_EXT = /^(ts|m4s)$/i;
```

**第二处（配套）**：在 `vrVideoOptions` 候选过滤之后（约 6227 行 `list` 构建完），
若列表里同时存在播放列表与分片，则丢弃分片：

```js
/* 有播放列表时丢掉裸分片：它们是同一条视频的碎片。
 * 星愿的 VideoInfoFromData 同样只把 m3u8/mp4 当条目，
 * 分片仅作为 playlist 内部数据，不进候选列表。 */
if (list.some(function (m) { return /\.(m3u8|mpd)(\?|$)/i.test(m.url || ''); })) {
    list = list.filter(function (m) { return !VR_SEGMENT_EXT.test(m.ext || ''); });
}
```

不这么做的后果（实测）：12 个 ts 占满 `slice(0, 8)` 名额，两个 m3u8 即使进来了也会被截掉。

**第三处（可选，与星愿对齐）**：`content-range` 非 `bytes 0-` 的请求直接丢弃 ——
星愿 `VideoInfoFromData` 就这么做，避免 Range 续传把同一条视频记成多条。
本页实测 m3u8/ts 都没有 `content-range`，所以这条**不是本次必需**。

**不需要改的**：`js/init.js` 的 `Type` 表。
计划里曾假设要补 `application/octet-stream`，但实测证明
`findMedia` 是「后缀命中即放行」（`if (!filter && ...)` 短路），
星愿的 `is_mp4_content`（octet-stream && .mp4 后缀）与我们等价。

---

## 六、复现命令

```bash
# 启动带扩展的调试 Edge（9480）
python "$TMPDIR/launch_edge.py"

# 打开目标页
python "$TMPDIR/open_target.py"

# 读页面视频与网络资源
python "$TMPDIR/probe_page.py"

# 读 m3u8 / ts 响应头
python "$TMPDIR/probe2_run.py"

# 从 SW 读后台媒体缓存（关键证据）
python "$TMPDIR/probe_sw.py"

# 验证后台取流能力
python "$TMPDIR/probe_dl.py"
```
