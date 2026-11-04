# YouTube 高清下载可行性研究（真机实测）

> 日期：2026-10-24 ｜ 结论：**可行，且已跑通到「拿到真实媒体字节」这一步**
> 反驳对象：ADR-019「2026 起纯扩展基本无解」——这条要改，但不是全改。
> 探针脚本：`tools/yt-probe.py` · `yt-clients.py` · `yt-dl-test.py` · `yt-feasibility.py` · `yt-sabr.py`
> 环境：Chrome for Testing 147 + 本机代理（出口 203.10.99.42），未登录 YouTube

---

## 一句话结论

> **不是「YouTube 封死了纯扩展」，是「Web 客户端封死了」**。
> 换客户端拿直链 → 需要解 `n` 参数 → 解完就能下（已实测 206 + 真实 MP4 字节）。
> 直链不稳时 → 复放页面自己的 SABR 链接 → 也能下（已实测 200 + 真实 EBML 字节）。
> **两条路都不需要服务器、不需要 poToken、不需要 yt-dlp。**

---

## 一、先钉死事实：Web 客户端确实全封了

在真实 watch 页主世界读 `ytInitialPlayerResponse`（Big Buck Bunny 4K60）：

| 观测项 | 结果 |
|---|---|
| `streamingData` 的 key | `expiresInSeconds` / `adaptiveFormats` / `serverAbrStreamingUrl` |
| adaptiveFormats 条数 | **40** |
| 带 `url` 的条数 | **0** |
| 带 `signatureCipher` 的条数 | **0** |
| `<video>.src` | `blob:https://www.youtube.com/...`（MSE） |
| 页面实际发出的媒体请求 | **1 条** POST `rr2---sn-*.googlevideo.com/videoplayback?...&sabr=1&rqh=1&c=WEB` |

格式元数据（itag / 分辨率 / 码率 / 体积）都还在，**只是没有可下载的地址**。这就是猫抓嗅探在 YouTube 上失效的根因：不是嗅探不到，是**根本不存在那条 URL**。

## 二、换客户端：直链回来了

在**同一个页面上下文**（同源、带 cookie、带页面自己的 `visitorData`）里，用不同 innertube 客户端打 `/youtubei/v1/player`：

| 客户端 | 结果 | 带 url |
|---|---|---|
| WEB | UNPLAYABLE / Video unavailable | 0 |
| **MWEB** | **OK** | **41 / 41，最高 2160p60** |
| ANDROID | 无响应 | 0 |
| IOS | 无响应 | 0 |
| TVHTML5 | UNPLAYABLE（需重载） | 0 |
| ANDROID_VR | LOGIN_REQUIRED「Sign in to confirm you're not a bot」 | 0 |
| ANDROID_TESTSUITE | UNPLAYABLE | 0 |
| WEB_EMBEDDED_PLAYER | ERROR | 0 |
| TVHTML5_SIMPLY_EMBEDDED | ERROR「no longer supported」 | 0 |

**只有 MWEB 活着。** 它返回的 URL 里 **没有 `pot` 参数**——不需要 poToken。

## 三、直链 403 的唯一原因：`n` 参数没转换

拿到 URL 后直接 Range 请求 → `403`，body 为空。逐个排除：

| 假设 | 实验 | 结论 |
|---|---|---|
| UA 不匹配 | 默认 / 桌面 / Android Chrome / iOS App 四种 UA 全试 | ❌ 与 UA 无关，全 403 |
| 出口 IP 与 URL 里 `ip=` 不符 | URL 里 `ip=203.10.99.42`，代理出口实测 `203.10.99.42` | ❌ 完全一致 |
| 链接过期 | `expire` 比当前时间晚约 6 小时 | ❌ 未过期 |
| 需要 poToken | URL 里无 `pot=` | ❌ 不需要 |
| **`n` 参数未做签名变换** | 去掉 `n` 也是 403（googlevideo 对无效 n 回 403 空 body） | ✅ **就是它** |

### 解掉它：47 毫秒

用 `youtubei.js` v18.3.0 的 `Player.decipher`（纯 JS，从 `base.js` 里正则抽出 n 函数再求值）：

```
player_id = cbcfbf2f | sigTs = 20746
原始 n = 42HfXLqpGqlhB6AStTo
变换耗时 47ms | 新 n = X0E2T2yRXefMdQ
Range: status=206 len=1024 type=video/mp4
前 12 字节 =     ftypdash   <== 媒体数据到手
```

**itag 299（1080p60 AVC）→ 206 Partial Content → 真实 MP4 字节。** 这一条就把「纯扩展能不能下 YouTube 高清」回答完了：**能**。

> MV3 注意：`decipher` 需要 `eval`，而扩展页 CSP 禁 `eval`。
> 解法是 **sandbox 页**（`content_security_policy.sandbox` 里放 `'unsafe-eval'`）——Tubly 的 manifest 就是这么写的，现在明白它为什么需要那段 CSP 了。

## 四、但直链不稳：几分钟就被风控

同一套请求连续跑十几次后：

```
MWEB   UNPLAYABLE  n=0  url=0  sabr=False   reason: Video unavailable
```

同样的脚本、同样的页面，5 分钟前还能拿到 41 条直链。**这是 IP 级/会话级风控，不是代码问题。**
而且后来复测时 `adaptiveFormats` 里出现「只有 360p 渐进档 itag 18 带 url、其余全 SABR」的混合态——说明 SABR 灰度还在推进，**MWEB 直链是随时会没的临时窗口**。

用它可以，但**不能当唯一路径**。

## 五、稳的那条：复放页面自己的 SABR 链接

浏览器已经在用的那条 SABR 链接是**预签名且被授权**的。把它的请求抓下来原样复放：

```
POST <serverAbrStreamingUrl>
Content-Type: application/x-protobuf
→ 200  application/vnd.yt-ump
```

空 body 时的响应：`sabr.malformed_config` —— 意思是「**鉴权通过了，只是你没带配置**」。没有 403、没有 poToken 挑战、没有 bot 验证。

带上播放器自己发的请求体（1749 字节）复放：

```
status=200  type=application/vnd.yt-ump  收到 0.9MB / 0.28s
UMP 分片：0x14 MediaHeader(itag 251) → 0x15 Media(EBML/WebM 头 + 数据) → ...
payload 里出现 \x1aE\xdf\xa3（EBML magic）  <== 真的媒体流
```

而且请求体里**同时选了** 4K（2160×3840 / itag 315）、1080p（299）、1440p（308）和音轨（249/251/140）——**播放器本来就在拉多档，我们要哪档只是改一个字段**。

这条路的价值：
- 不碰 innertube API → **不会触发风控**
- 不用解 `n` → URL 里已经是变换后的
- 不用 poToken → 页面会话已授权
- 与播放器完全一致 → 稳定性 = 播放器能不能播

代价：要自己实现 UMP 分片重组（type + varint 长度 + payload），以及从 MediaHeader 里认 format id 分组。这是 yt-dlp `_download_sabr` 干的事，量级约 300–500 行。

## 六、三条路的技术账

| 路线 | 已验证 | 稳定性 | 工作量 | 依赖 |
|---|---|---|---|---|
| **A. MWEB 直链 + n 变换** | ✅ 206 拿到真实 MP4 | ⚠️ 中（会风控） | 2–3 天 | 需 sandbox 页做 eval；需按视频缓存格式 |
| **B. SABR 复放** | ✅ 200 拿到真实 EBML | ✅ 高（等同播放器） | 4–6 天 | 需端口 UMP 重组；需 page 上下文取 URL+body |
| **C. chrome.debugger 抓流** | 未测（原理可行） | 🟡 中（要播放/拖动） | 3–4 天 | 需要 `debugger` 权限 + 顶部黄条 |
| D. 原生 yt-dlp 伴生 | 社区已验证 | ✅ 最高 | 1 天 | 违背 ADR-008「装个扩展就能用」 |

**建议：A 做 MVP 打开局面，B 做稳定版替换。** A 已经证明可行，先让「能下 1080p/4K」这件事发生；B 是长期正确的形态。

两者共用同一套骨架，所以 A 的投入不会浪费：

```
① 内容脚本注入 #below 按钮（学 Tubly 的锚点策略）
② 点击 → executeScript(world:"MAIN") 同源取 streamingData
      · 路线 A：MWEB 客户端打 /player → 拿 iframe 格式列表
      · 路线 B：直接读 ytInitialPlayerResponse.serverAbrStreamingUrl + adaptiveFormats
③ sandbox 页解 n（A）或 重组 UMP（B）
④ offscreen / SW 流式落盘（复用我们的 StreamSaver + 背压）
⑤ 我们已有的 FFmpeg/mux.min.js 合流（video-only + audio-only → mp4）
⑥ 资源库自动入库（已有 S2 indexer）
```

## 七、对既有决策的修订

- **ADR-019「YouTube 降级 P1、不投入对抗」→ 作废重生。** 它基于「2026 无纯扩展方案」的判断，被本次实测推翻：**有**，只是入口在 MWEB 客户端 + `n` 参数，不在 Web 页面。
- **ADR-008「不装外部程序」→ 保持。** 三条候选路线都不需要 yt-dlp。
- **ADR-028「能抄就抄」→ 继续适用。** `youtubei.js`（MIT）的 `Player.decipher` 就是我们要的那 47ms。

## 八、风险与边界

| 风险 | 说明 | 缓解 |
|---|---|---|
| MWEB 直链窗口关闭 | 灰度随时可能把 MWEB 也 SABR 化 | 以 B 为主路径，A 作快速通道 |
| 风控 | 短时间大量请求会 UNPLAYABLE | 每视频只打 1 次 API + 本地缓存；批量下载串行限速 |
| `n` 变换随 base.js 变化而失效 | YouTube 改混淆就崩 | 用 youtubei.js 的提取器（社区持续维护），不自己写正则 |
| 会员/私密/年龄限制视频 | 需要登录态 | 请求在用户自己的页面里发，cookie 自动带 |
| 直播 / 首播 | 无固定时长 | 明确报错，不做 |
| MV3 CSP | `eval` 被禁 | sandbox 页（Tubly 同款做法） |

---

## 附：复现命令

```bash
# 1. Web 页面到底有没有直链
python tools/yt-probe.py aqz-KE-bpKQ

# 2. 哪个客户端还能给直链
python tools/yt-clients.py

# 3. 直链 403 的原因定位（UA / Range / itag 三维扫）
python tools/yt-dl-test.py

# 4. 多视频取格式 + 写 .work/yt-urls.json
python tools/yt-feasibility.py

# 5. SABR 抓包 + 复放
python tools/yt-sabr.py LXb3EKWsInQ
```

> 全部走系统 Python 3.12（`C:\Users\XPENG\AppData\Local\Programs\Python\Python312\python.exe`），
> 代理硬编码在脚本顶部 `PROXY`，换网络环境改这一处即可。
