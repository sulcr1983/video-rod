# 通用性差距分析 —— 13 个下载扩展逐个拆解

> 日期：2026-11-09 ｜ 起因：苏哥「人家都号称可以兼容下载所有视频，我们反而在通用性方面很多没做好」
> 方法：直接读星愿浏览器 `Default/Extensions/` 下的源码（未压缩的读源码，打包过的读常量、API 名与调用链）
> 结论先行：**人家「什么都能下」靠的不是嗅探更强，是三样我们没做的东西 —— 录制兜底、下载后校验、DOM 全扫描。**

---

## 一、拆解范围（13 个）

| # | 扩展 | 版本 | 定位 | 技术路线 |
|---|---|---|---|---|
| 1 | **Video Downloader Plus** | 4.0.0 | 通用 | webRequest + 扩展名白名单（21 种）+ DOM 扫 `a/video/audio/source` |
| 2 | **Video Downloader Pro** | 0.1.11 | 通用 | webRequest + DNR + **captureStream 录制** + 直播录制 |
| 3 | **SnapHD 高清视频下载** | 1.0.1 | 半通用 | 每站一个适配器 + ffmpeg.wasm 合并 + **下载后校验** |
| 4 | **Download Master** | 2026.10.14 | 通用 | **纯 DOM 扫描**（零 webRequest，权限只要 activeTab+scripting）|
| 5 | **Chrono 下载管理器** | 0.13.12 | 通用 | DOM 全量遍历 + 5 线程 Range 分段 |
| 6 | **Tubly（YouTube）** | 1.6.4 | 站点 | Cookie 外发到自家服务器解析签名 |
| 7 | **DownXVideo（Twitter）** | 0.6.2 | 站点 | syndication 接口 + 全量码率排序 |
| 8 | **Plucker XBD（X）** | 5.9 | 站点 | 620KB content-script，站点数据结构解析 |
| 9 | **笃笃（微博/抖音）** | 0.16.14 | 站点 | `ajax/statuses/show` 换高清直链 |
| 10 | **抖珍藏（抖音）** | 2.8.50 | 站点 | 抖音专用抓取 |
| 11 | **智小抖（抖音）** | 2.4.5 | 站点 | React Fiber 抠 awemeInfo（已拆，见 `reviews/2026-11-09-智小抖拆解`）|
| 12 | **小红书下载助手** | 1.0.2 | 站点 | 页面数据解析 |
| 13 | **小红薯 / 小金薯** | 1.4.61 / 1.0.9 | 站点 | 页面数据解析 + 批量 |

排除：AdBlock、视频去广告、GitHub 增强、DeepSeek 插件（非下载器）。

---

## 二、五种技术路线（人家怎么做到的）

### 路线 A：纯 DOM 扫描（Download Master —— 最反常识）

权限只有 `activeTab` + `scripting`，**连 webRequest 都没有**。用户点扩展图标时才注入：

```js
// scripts/content.js（全文就这一坨，未压缩）
for (var i = 0; i < document.links.length; i++) {
  lines.push({ link: document.links[i].toString(), linkName: ... });
}
[{sel:'video[src]',attr:'src'}, {sel:'audio[src]',attr:'src'},
 {sel:'source[src]',attr:'src'}, {sel:'embed[src]',attr:'src'},
 {sel:'object[data]',attr:'data'}].forEach(...)   // 跳过 blob:
port.postMessage({ links: e });
```

**没有类型判定、没有去重、没有大小检查** —— 全部链接甩给弹窗，用户自己按扩展名勾选。

它为什么敢说「所有视频都能下」：**因为任何页面上的媒体地址，最终总有一个落在 `<a>` / `<video>` / `<source>` / `<embed>` / `<object>` 上**。

### 路线 B：webRequest + MIME（Plus / Pro）

```
onBeforeRequest / onHeadersReceived → 看 Content-Type → 命中白名单就收集
```

Plus 的格式表：`mp4 webm m3u8 mpd mp3 m4v mkv ts aac mov m4a flac avi ogg wav mpg wmv flv 3gp m2ts mts`

### 路线 C：录制兜底（Pro —— 最值钱）

```js
// helper.OA7RSn-U.js（RecorderController.start）
if (!this.el.captureStream) throw new Error('CAPTURESTREAM_UNSUPPORTED');
this.stream = this.el.captureStream();
const r = MediaRecorder.isTypeSupported(this.options.mimeType)
        ? this.options.mimeType : 'video/webm';
this.rec = new MediaRecorder(this.stream, ...);
```

**不管什么协议、什么保护、什么分片** —— 只要能播，就能录成 WebM。

配套还有 `contentNNTLiveRecorder`（直播录制）。

### 路线 D：ffmpeg.wasm 合并（SnapHD）

`offscreen/ffmpeg-worker.js`（module worker + dynamic import）：

```js
var module = await import(coreURL);
ffmpegCore = await createFFmpegCore({ mainScriptUrlOrBlob: coreURL + '#' + btoa(...) });
```

在离屏文档里跑 wasm ffmpeg，音视频分离的流能直接 `-c copy` 合成。

### 路线 E：站点接口（Tubly / 笃笃 / 智小抖）

知道站点数据在哪（接口 / React Fiber / syndication），直接取全量码率。
Tubly 甚至把 Cookie 发给自家服务器算签名 —— 我们不抄（隐私）。

---

## 三、通用性差距（六条，按价值排序）

### 差距 1 ✅ 已实施 —— 录制兜底是「能下一切」的底牌

| 我们有 | Pro 有 |
|---|---|
| 抓地址 → 下不到就报失败 | 抓不到/下不到 → **`captureStream` 录下来** |

**什么时候会救场**：

- MSE / `blob:` 流（地址是临时的，抓不到也不可复用）
- 加密但可播的流
- 地址有极短时效签名，抓到就过期
- 播放器只肯给分片、不给完整地址
- 需要复杂鉴权的直播

**代价（必须说清）**：录的是**实时时长**（1 小时视频要录 1 小时），而且经过一次实时重编码，画质不原始。

**已实施（2026-11-09）**：`js/vr-capture.js`（页面侧录制器）+ `background.js` 的 `vrCapSessions` / `vrCapFlush`（拼盘落盘）

| 决策 | 内容 |
|---|---|
| 入口 | 悬浮键菜单**最后一项**「录下来」，明确标注「要播完 · 画质是重编码」 |
| 无候选时 | 菜单原本只显示「没嗅探到」，现在**必定附上录制入口** —— 这正是它存在的意义 |
| 触发 | 只在用户主动点时启动，不参与正常下载路径，零开销 |
| 分片 | `MediaRecorder.start(2000)`，每 2 秒一块，来一块推一块 |
| 自动停止 | 视频播完时 MediaRecorder 会自己停（`onstop`）→ 走同一个 `finishOnce()` 落盘 |
| 落盘 | 后台拼 `Blob` → `VRSave.saveFile` → 进资源库（标 `recorded:true`）|
| 格式 | 优先 `video/webm;codecs=vp9,opus`，逐级降级到 vp8 / webm / mp4 |

**传输踩了三个坑（都记在代码注释里）**：

1. **Port 会在 SW 回收时静默断开** → `postMessage` 抛错被 catch 掉，数据无声丢失。
   改为每次 `ensurePort()` 重连 + `onDisconnect` 时先把已收到的落盘。
2. **`sendMessage` 传 base64 走不通** —— 后台 `atob` 稳定报
   `The string to be decoded is not correctly encoded`，清洗字符也救不回来。
3. **`port.postMessage(ArrayBuffer)` 也传不过去** —— Chrome 扩展消息是 **JSON 序列化**
   （不是结构化克隆），ArrayBuffer 到对面变成空对象，`parts` 恒为 0。
   最终方案：转**数字数组**（体积膨胀 3~4 倍，2 秒一块完全扛得住，且不会被改坏）。

**验收（真机，iframe 内视频）**：

- 录制 6 秒 → 后台收到 `parts: 2 / 954KB` → 落盘 **1.50 MB**
- 文件头 `1a 45 df a3`（EBML magic）→ **有效 WebM**
- 菜单实测：`[MP4 · 1.1MB 最高清 · 当前播放]` + `[录下来 要播完 · 画质是重编码]`

---

### 差距 2 ✅ 已实施 —— 下载「成功」但内容是错的，我们不校验

SnapHD 的 `download-tracker.js`：

```js
if (download.state === 'complete') {
  const mime = download.mime || '';
  const looksInvalid = (mime && !/^(video|image|audio)\//i.test(mime)
                        && !/octet-stream/i.test(mime)) || download.totalBytes === 0;
  if (looksInvalid) {
    chrome.downloads.removeFile(delta.id).catch(() => {});   // 删文件
    chrome.downloads.erase({ id: delta.id }).catch(() => {}); // 删记录
    sendProgress(..., { state: 'interrupted', reason: 'invalid-content' });
    return;
  }
}
```

**我们现在的行为**：只看 `state === 'interrupted'`。如果服务器返回 200 + HTML 错误页（软墙、风控页、登录页），下载器认为**成功**，我们就落一个 .mp4 —— 打开是白屏或一段 HTML。

**实证**：今天查库时发现的那几条抖音 15KB / 848KB「视频」，就是这种。

**已实施（2026-11-09）**：`vrDownloadLooksInvalid(it)` + `vrDiscardBadDownload(id)`

- `vrWatchDownloadId` 的 complete 分支：判坏 → 删文件 + 删记录 + 推「不是视频」
- `vrVideoDownload` 的 2.5 秒短等待分支：判坏 → **清掉假文件后继续走回退路线**（页面 fetch / 离屏直连有时能带对 Cookie 拿到真内容，直接报失败等于白放弃）
- 规则比 SnapHD 保守：只拦 `text/*` 与 `application/json|xml`（字幕 `vtt/plain/srt` 除外）+ 0 字节；
  未知 mime 一律放过。SnapHD 用 `!/^(video|image|audio)\//` 白名单会把 `application/mp4` 也判死
- 9 条用例验证：正常视频 / 未知 mime / octet-stream / application/mp4 / vtt 都放过，
  text/html / application/json / 空文件判坏

---

### 差距 3 ⛔ 已核实「不需要」—— MV3 SW 保活（人家有，但我们不用抄）

SnapHD 的做法：

```js
function startKeepAlive(platform) {
  keepAliveAlarmName = `dlall_keepalive_${platform}_${Date.now()}`;
  chrome.alarms.create(keepAliveAlarmName, { periodInMinutes: 0.4 });  // 每 24 秒唤一次
}
```

**它为什么需要**：它的 `FETCH_MEDIA_AS_BLOB` 是**一次性长 fetch**（`fetch(url).then(res => res.blob())`），
全程只有一次扩展 API 调用 —— 中间几 MB 的传输期间 SW 真的会空闲到被回收，一死就全断。

**我们为什么不需要**：`vrWatchDownloadId` 是**每 500ms 调一次 `chrome.downloads.search`**，
这个调用本身就会重置 SW 的空闲计时器。轮询间隔远小于回收阈值，等于自带保活。

**唯一残留风险**：`VRSave.saveFile` 的流式 fetch —— 但它每 4MB 触发一次 `onProgress`，
回调链路上也有扩展侧动作，同样会刷新。

**结论**：不加 alarms。加了反而有害 —— `chrome.alarms` 最小周期是 1 分钟，
比 30 秒的空闲窗口还长，根本来不及；照抄等于给自己加一个假的安心。

> 这条特意写出来：**拆解竞品不是为了全抄**。人家的补丁是给人家的架构打的，
> 我们的架构已经把这个问题绕过去了。

---

### 差距 4 ★★★☆☆ DOM 扫描漏了 `a` / `source` / `embed` / `object`

我们扫 `<video>`（悬浮键）和 `<img>`（图片浮标），**没有扫链接**。

| 场景 | 我们的表现 | 为什么漏 |
|---|---|---|
| `<video><source src="x.mp4"></video>` | `<video>` 没有 `src` → 抓不到 | 只查 `video[src]` |
| 下载站：`<a href="xxx.mp4">点此下载</a>` | 页面没有 video → 什么都抓不到 | 不扫 `a[href]` |
| `<embed src>` / `<object data>`（老式播放器）| 同上 | 不扫 |

net-sniff 的 `PATHY_RE` 能补一部分（从接口 JSON 里挖），但**纯静态页**（下载站、老站）没有 JSON 可挖。

**建议**：`video-overlay` 的 `scan()` 增加 `source[src]`（这是最便宜的补漏，且 `<source>` 就在 video 里，不增加打扰）；`popup` 增加一个「扫本页链接」按钮（对齐 Download Master 的做法，按扩展名过滤后列出）。

---

### 差距 5 ★★☆☆☆ 合并靠手写，人家用 ffmpeg.wasm

我们用自己写的 m3u8 / mpd 合并器（`js/m3u8-merge.js` 等）。SnapHD 直接在离屏文档里跑 ffmpeg.wasm。

**我们的优势**：轻（几十 KB vs 几 MB wasm），且能控制进度。
**我们的劣势**：兼容性靠自己维护 —— 遇到非常规封装、多音轨、加密变体就崩。

**建议**：不强求换。但**遇到手写合并失败的样本时，可以加一条「用 ffmpeg.wasm 重试」的兜底**（按需加载，不常驻）。

---

### 差距 6 ★★☆☆☆ 大文件下载只有单线程

Chrono 有 5 线程 Range 分段（`max_threads_config: 5`、`finished_bytes`、`resume`、`checksum`）。

我们走 `chrome.downloads` 单线程。几百 MB 的文件，速度差距明显。

**建议**：优先级低（改动面大，且 `chrome.downloads` 本身也支持多连接）。先记着。

---

## 四、我们比它们强的地方（别把自己说没了）

| 能力 | 谁有 | 说明 |
|---|---|---|
| **字节分片还原**（`?start=&end=`）| **只有我们** | MSN 那种按字节切片拉流的，三家都没处理 |
| **同媒体变体探测**（`_bd`）| **只有我们** | 签名墙下换免签变体，三家都没有 |
| **DNR 改 Referer** | **只有我们** | SnapHD 注释里明说：`chrome.downloads` 的 `headers` 不收 Referer（forbidden header），所以它放弃了。我们用 declarativeNetRequest 做到了 |
| **命名模板 + 资源库 + 去重** | **只有我们** | 人家是「下到 Downloads 拉倒」，我们是「归档 + 可检索」 |
| HLS master / DASH 解析 | 我们 + Plus + Pro | 已对齐 |
| 直播录制 | Pro | 我们没有（定位不同，缓）|

---

## 五、建议动手顺序

| 优先 | 事项 | 理由 | 状态 |
|---|---|---|---|
| P0 | **下载后内容校验** | 直接消灭「下了一堆假文件」，今天已经在库里见到实证 | ✅ **已实施**（`vrDownloadLooksInvalid` + `vrDiscardBadDownload`，9 条用例全过）|
| ~~P0~~ | ~~SW 保活~~ | 核实后确认我们的 500ms 轮询自带保活，**不用抄** | ⛔ 已排除（见 §3 差距 3）|
| P1 | **`source[src]` 扫描** | 最便宜的补漏，`<video><source>` 是很常见的写法 | 待办 |
| P1 | **popup「扫本页链接」** | 对齐 Download Master 的兜底思路，纯静态页也能救 | 中 |
| P2 | **录制兜底** | 真正的「什么都能下」，但代价是实时时长 + 重编码，要产品上想清楚入口 | 大 |
| P3 | ffmpeg.wasm 兜底合并 | 遇到失败样本再做 | 中 |
| P3 | 多线程分段下载 | 体验优化，非功能缺口 | 大 |

---

## 六、复现方法

```bash
# 列出星愿所有扩展及真实名称
python - <<'PY'
import json, io, os
base = r'C:\Users\Administrator\AppData\Local\Twinkstar\User Data\Default\Extensions'
for ext in sorted(os.listdir(base)):
    d = os.path.join(base, ext)
    if not os.path.isdir(d): continue
    for ver in os.listdir(d):
        mp = os.path.join(d, ver, 'manifest.json')
        if os.path.exists(mp):
            m = json.load(io.open(mp, encoding='utf-8'))
            print(ext, ver, m.get('name'))
PY
```

关键源码位置：

| 扩展 | 文件 | 看什么 |
|---|---|---|
| Download Master | `scripts/content.js` | 全文 1.6KB，DOM 扫描 |
| SnapHD | `background/download-tracker.js` | 下载后校验 + alarms 保活 |
| SnapHD | `offscreen/ffmpeg-worker.js` | ffmpeg.wasm 加载 |
| Pro | `assets/js/helper.OA7RSn-U.js` | 搜 `captureStream` / `RecorderController` |
| Plus | `background/service_worker.js` | 搜 `chrome.downloads.download` |
