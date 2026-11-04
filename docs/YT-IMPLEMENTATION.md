# YouTube 高清下载：实现记录

> 日期：2026-10-24 ｜ 状态：**功能完成，除 YouTube 接口本身外全链路已验证（21/21 断言）**
> 前置研究：`docs/YT-FEASIBILITY.md`（为什么这条路成立，全部实测证据）
> 决策：ADR-039、ADR-040

---

## 一、做了什么

在播放器下面加一个「下载」按钮，点开一个小窗，选清晰度，落一个**带声音的 MP4**。

| 项 | 支持 |
|---|---|
| 分辨率 | 到 2160p（4K/HDR 走 MP4 里的 AV1） |
| 编码 | MP4 容器内全部收：AVC1 / AV01 / VP09-in-MP4 |
| 容器 | MP4（自动挑最兼容的一档：同分辨率优先 AVC） |
| 音视频合并 | ✅ 本地容器级合并，**不重新编码**，画质零损失 |
| 落盘 | ✅ 优先 FSA 直写资源库三段目录；无授权时退回浏览器下载器 |
| 文件名 | `博主_标题_1080p.mp4`，同名自动 `_01` |
| 仅音频 | ✅ 导出 `.m4a` |
| Shorts | ✅ 右下角悬浮按钮 |
| 失败重试 | ✅ 403/解密失败自动重解一次 |
| WebM / VP9-in-WebM / Opus | 暂不支持 |

## 二、文件地图

```
manifest.json                     + youtube content script / sandbox 页 / sandbox CSP
js/yt/yt-page.js                  内容脚本：注入按钮（Shadow DOM），点了发消息
js/yt/yt-download.html            下载小窗（480×700）
js/yt/yt-download.js              编排：取格式 → 解 n → 拉双轨 → 合并 → 落盘
js/yt/nsig-sandbox.html           沙箱页：唯一允许 eval 的地方
js/yt/nsig-sandbox.js             沙箱逻辑：跑 youtubei 的 n 参数变换
js/yt/fmp4-merge.js               fMP4 双轨合并（不重编码）
lib/youtubei.min.js               youtubei.js@18.3.0 → esbuild IIFE（仅导出 Player）
js/background.js                  + ytCollectFormats（注入主世界取格式）/ ytOpen / ytFormats
tools/yt-ext-test.py              扩展级联调（按钮 → 小窗 → 状态）
tools/yt-shot.py                  截图取证
```

## 三、数据流

```
用户点按钮（youtube.com 页面）
   ↓ chrome.runtime.sendMessage({Message:'ytOpen'})
Service Worker
   ↓ chrome.windows.create(480×700, yt-download.html?videoId&tabId)
下载小窗
   ↓ sendMessage({Message:'ytFormats'})
Service Worker
   ↓ chrome.scripting.executeScript({world:'MAIN', func: ytCollectFormats})
页面主世界（同源、带 cookie、带 visitorData）
   ↓ POST /youtubei/v1/player  client=MWEB → ANDROID → IOS → TVHTML5 依次试
   ↑ 返回带 url 的 adaptiveFormats（2160p ~ 144p + 音轨）
下载小窗
   ↓ postMessage → sandbox iframe
沙箱页（允许 eval）
   ↓ youtubei Player.decipher()：base.js 里抽 n 函数并求值
   ↑ 变换后的直链（否则一律 403）
下载小窗
   ↓ fetch 视频轨 + 音频轨（ReadableStream，带进度）
   ↓ VRFmp4.merge()  ← 容器级合并
   ↓ 落盘：FSA 直写资源库三段目录（无授权时退回 chrome.downloads）
Downloads/video-rod/YouTube/<作者>_<标题>_<高>p.mp4
   ↓ 写盘成功后调 vrLib.ingest  ← FSA 没有下载事件，必须显式入库（ADR-044）
资源库立刻出现这张卡（不用等 indexer 全量扫描）
```

## 四、三个关键设计决定

### ① 为什么必须单开一个小窗

三个能力在内容脚本里都拿不到或不好用：读 googlevideo 的响应（CORS）、在内存里合并两条轨（没有合适执行环境）、`chrome.downloads` 落盘。
所以「编排」这件事必须在一个**扩展页**里做——这也正是 Tubly 开 600×260 小窗的原因，我们独立推导出了同一个答案。

### ② 为什么 n 参数必须去沙箱

`n` 变换要执行 YouTube 的混淆 `base.js`，靠 `eval`。MV3 扩展页 CSP 禁 `eval`，所以 manifest 里声明了 `sandbox.pages` + `sandbox` CSP 带 `'unsafe-eval'`。
沙箱是 opaque origin，直接 fetch 会被 CORS 拦，因此**所有网络请求 postMessage 回父页面代取**——父页面有 `<all_urls>` 权限，顺手把 CORS 也绕了。

### ③ 为什么自己写 fMP4 合并，而不是调 ffmpeg

- 在线 FFmpeg（`ffmpeg.bmmmd.com`，ADR-021 那条路）不能用：googlevideo 的 `sparams` 里含 `ip`，**签名把 IP 绑死了**，服务器换个 IP 去拉必然 403。
- ffmpeg.wasm 要 30MB+，为一次合并不值得。
- 分片 MP4 的合并其实不需要解码：`trun.data_offset` 相对 `moof` 起点，只要 `moof`+`mdat` 贴着不动，偏移就一直有效。**唯一要改的是 `track_ID`**（两轨都是 1 会打架），它在 `tkhd`/`trex`/`tfhd` 里各一处，都是定长 4 字节。

所以 `js/yt/fmp4-merge.js` 只做三件手术：重写 `track_ID`、用两条 `trak` + 两条 `trex` 重建 `moov`、按 `tfdt` 解码时间交织分片。约 200 行，无依赖。

### ④ 为什么落盘改成 FSA 优先（重要发现）

原本想沿用项目的「文件名保护」套路：`chrome.downloads.onDeterminingFilename` + 下载前预记账。**这套在 Chrome 147 上已经失效了。**

实测（同一份代码、同一个 SW、同一次运行）：

| 下载源 | 结果 |
|---|---|
| `blob:` URL | 文件名变成 `997b0753-....mp4`（UUID） |
| `http:` URL | 文件名变成 `_video.mp4`（URL 末段） |
| 期望 | `probe/http-name-test.mp4` |

连 http 都不生效，说明不是 blob 特例，而是 `suggest()` 整体被忽略。这条对**项目所有下载路径**都成立（弹窗下载、图片批量、m3u8），不只是 YouTube——已记为 ADR-040。

所以主通道改成 **File System Access**：拿资源库已授权的根句柄 `VRDB.getHandle('root')`，按 `relPath` 建子目录、写文件。文件名 100% 归我们管，还顺带绕开了「先把整个文件塞进 blob 再交给下载管理器」的内存峰值。

> ⚠️ 这里有个**必踩的坑**（HANDOFF §6.6）：句柄指向的是**资源库根**（A 模式 = `<下载目录>/video-rod`），
> 里面没有 `video-rod/` 这一层。所以写盘前必须把 `relPath` 的首段前缀（`subdir` / db 里的 `rootPrefix`）剥掉，
> 否则会落成 `video-rod/video-rod/YouTube/…`。首版就踩了，现在有断言卡着。

没有授权目录 / 不支持 FSA 时，退回 `chrome.downloads`，并在完成文案里**如实说明名字可能被改**——不假装成功。

（Tubly 那个 600×260「另存为」小窗用 `showDirectoryPicker`，是同一个原因：下载管理器给不了可靠的文件名。）

## 五、已验证 / 未验证

### ✅ 已通过

**自动化：`tools/yt-download-test.py` → 21 / 21 断言全绿**

这个测试把「取格式」打桩（本地起 CORS 服务吐出真实的一对 DASH 轨，用
`Page.addScriptToEvaluateOnNewDocument` 替换 `chrome.runtime.sendMessage`），
**其余全程是产品代码原样执行**：渲染档位 → 判断 n 参数 → 拉流 → fMP4 合并 →
三段路径 → FSA 写盘 → 用 Chrome 解码校验。

| 项 | 结果 |
|---|---|
| 档位渲染 | 4K60 / 1080p / 720p / 360p(免合并) / 仅音频，全部正确 |
| 4K 档没被 codec 过滤掉 | ✅（AV1-in-MP4 保留） |
| n 参数判断 | 无 `n` 的直链直接拉，不起沙箱 |
| **fMP4 合并** | 675433 字节；`readyState=4`、时长 12.10s、**视频/音频解码字节均 > 0**、无 `MediaError` |
| 三段路径 | `<库根>/YouTube/测试频道/视频/测试视频…_1080p.mp4`（已剥 `video-rod` 前缀） |
| FSA 落盘 | ✅ 只写 1 个文件，字节数一致 |
| 未走下载器兜底 | ✅ 没有任何 UUID 名文件 |
| 注入按钮 / 开窗 / 消息链路 | ✅ CDP 真机（`deliverables/assets/yt-button-injected.png`） |
| 既有功能回归 | naming 27 / path 57 / image-util 58，全绿 |

### 🔄 2026-10-24 晚更新：MWEB 已被关闭，改用 VISIONOS

用户实测报错 `TVHTML5 → UNPLAYABLE`，复查发现**研究阶段的结论已经过期**：
MWEB 现在也统一回 `UNPLAYABLE: The page needs to be reloaded`。

逐客户端实测（`docs/YT-CLIENT-STATUS.md` 有完整表格）：

| 客户端 | 结果 |
|---|---|
| **VISIONOS** | ✅ **32 条格式全带直链，最高 2160p，且 URL 里没有 `n`（不用跑 sandbox）** |
| MWEB / TVHTML5 | ❌ UNPLAYABLE |
| ANDROID / IOS | ❌ HTTP 400（客户端版本失效） |
| ANDROID_VR | ❌ 要求登录验证 |
| WEB | ⚠️ OK 但 0 条直链（全 SABR） |

**已改**：客户端顺序换成 `VISIONOS → MWEB → TVHTML5 → ANDROID → IOS`。

**顺带修了一个误导人的 bug**：原来错误只保留**最后一个**客户端的失败原因，
所以用户只看到 TVHTML5 那一行，前三个的真实原因全被覆盖。现在收集全部并分类：

| code | 含义 | UI 行为 |
|---|---|---|
| `YT_E_UNAVAILABLE` | 视频本身不可播（下架/私有/会员/地区） | 提示「换一个视频」，**不提供重试**（重试无意义） |
| `YT_E_LOGIN` | 需要登录 | 提示先登录 |
| `YT_E_BLOCKED` | 客户端全被拒（限流） | 提示刷新/等几分钟，可重试 |

> 用户报的那个 Shorts（`DtY-bKDvl4I`）实测 `playabilityStatus.status = ERROR`、
> `reason = 此视频不能观看` —— **页面自己都播不了**，不是扩展的问题。

### ⏳ 仍未通过：浏览器侧拉流极慢（网络环境，非代码）

同一 URL、同一条代理：

| 拉取方式 | 吞吐 |
|---|---|
| Python `urllib` 经代理 | 1.4–2.0 MB/s |
| 浏览器 `fetch`（扩展页） | 2–190 KB/s |

已排除 CORS（扩展页 fetch 返回 206 正常）、直链过期、`n` 参数。
怀疑是 URL 里 `ip=2a09:bac5:...` 是 **IPv6**，而代理出口是 IPv4，浏览器优先走 IPv6 连接导致绕路。

待验证：代理开 IPv4 优先 / Chrome `--disable-ipv6` / 换出口节点。

**这意味着**：取格式（0.2s）、Range 探测（206）、合并器都已验证可用；
只有「把几十上百 MB 完整拉下来」这一步在当前网络下会很慢。

## 六、已知限制

| 限制 | 说明 | 后续 |
|---|---|---|
| 内存合并 | 双轨全量进内存，4K 长视频（>1GB）有 OOM 风险；>700MB 会在提示行预警 | 改流式 + 分段写盘 |
| 只有 MP4 容器 | VP9-in-WebM / Opus 的档被过滤（4K 有 AV1-in-MP4 兜底，实际很少缺档） | 加 WebM 合并支持 |
| AV1 兼容性 | 4K/HDR 档常是 AV1，老播放器/剪映旧版可能不认 | 提示行已标注，可选 1080p AVC |
| 直链时效 | googlevideo 直链约 6 小时过期 | 已按需即时取 + 403 自动重解一次 |
| 风控 | 短时间批量下载会被限流 | 已有四客户端轮替；后续加节流 |
| 目录授权 | FSA 需要资源库根目录已授权，首次要手动授权 | 未授权时自动退回下载器并明示 |
| 索引 | ~~FSA 写入后靠 indexer 全量扫描纳入~~ → **已修**：写盘成功后主动调 `vrLib.ingest` 直接入库（ADR-044），资源库立刻可见 | ✅ 已完成 |

## 七、复现

```bash
# 端到端（推荐）：21 条断言，不依赖 YouTube
python tools/yt-download-test.py

# 扩展级联调（按钮 → 小窗 → 真实取格式）
python tools/yt-ext-test.py aqz-KE-bpKQ

# 截图取证
python tools/yt-shot.py aqz-KE-bpKQ

# 合并器单测（纯 node，不启浏览器）
node .work/merge-test.mjs
```

> `yt-download-test.py` 依赖 `.work/_video.mp4` / `.work/_audio.mp4`（公开 DASH 双轨素材），
> 没有的话见 `docs/YT-FEASIBILITY.md` 附的抓取方式；它跑完会清理自己的临时目录。
