# 苏哥的钓鱼竿 — 移动端可行性调研

> 版本：v1.0 ｜ 日期：2026-10-24 ｜ 状态：调研结论，未执行
> 问题：现有 Chrome 扩展能否在移动端也下载？需要做 App、小程序，还是别的方案？
> 结论：**不做小程序；不先做 App。** 先在安卓侧载验证，再决定是否投入开发。

---

## 1. 结论先行

| 判断 | 内容 |
|---|---|
| 微信小程序 | **不可行**（技术上嗅不到浏览器流量 + 域名白名单限制；合规上「视频下载/侵权资源共享」类目基本不放行） |
| iOS 浏览器扩展 | **不可行**（Safari 扩展在 iOS 不支持 `webRequest`，也没有 `downloads` API） |
| 安卓原生 App | **非首选**（成本最高；仅在需要离线/后台/原生体验时才做） |
| 安卓第三方浏览器侧载扩展 | **先验证这条**（零改动，半天可出结论） |
| PC/NAS 自建下载服务 + PWA | **兜底最优**（安卓/iOS 通吃，成本最低，但不是任意网页嗅探） |

---

## 2. 现有扩展的移动端依赖点

| 依赖 | 位置 | 移动端影响 |
|---|---|---|
| `chrome.webRequest` 嗅探 | `js/init.js`、`js/background.js`、`js/function.js` | 大多数移动浏览器/小程序都拿不到，是核心卡点 |
| `chrome.downloads.download` | 全项目 **27 处 / 8 个文件**（`background.js`、`m3u8.js`、`popup.js`、`downloader.js` 等） | Firefox Android 不支持该 API；侧载宿主也可能缺 |
| `side_panel` | `manifest.json` | 手机端普遍没有侧边栏，只能走 popup |
| 远程 FFmpeg 合并 | `js/init.js` 第 213 行（`ffmpeg.bmmmd.com` / `ffmpeg.94cat.com`） | 依赖远程服务可用性，且分片会离开本机 |

> 结论：这不是「改个响应式就能上手机」的项目，最少也要替换下载落盘层与面板形态。

---

## 3. 宿主支持现状（2026-10 调研）

| 宿主 | 扩展支持 | `webRequest` | `downloads` API | 结论 |
|---|---|---|---|---|
| Chrome for Android | 不支持 | — | — | 排除 |
| Kiwi Browser | 2025-01 已停更归档 | — | — | 不建议再装（无安全更新） |
| Edge Android 稳定版 | 仅内置白名单 | 未知 | 未知 | 任意扩展需 Canary |
| Firefox Android | 支持（2023 起对全体开发者开放） | 完整支持 | **不支持** | 能嗅探但存不下来 |
| iOS Safari 扩展 | 支持安装 | **不支持** | **不支持** | 核心链路归零 |
| 安卓 Lemur / Mises | 声称完整支持 Chrome 扩展 | 需实测 | 需实测 | 唯一「零改动」候选 |
| 微信小程序 | 无浏览器流量 | 无 | 域名白名单 | 不可行 |

---

## 4. 四条路线对比

| 路线 | 开发量 | 覆盖范围 | 主要风险 |
|---|---|---|---|
| **A. 侧载现有扩展到安卓第三方 Chromium**（Lemur/Mises/Edge Canary） | 0～小改 | 浏览器内网页 | 宿主可能缺 `downloads`/`sidePanel`；更新与安全不透明 |
| **B. 自建下载服务 + PWA 分享入口**（MeTube / yt-dlp，跑 PC/NAS） | 低（Docker 一条命令 + 分享页） | yt-dlp 支持的上千站点，安卓/iOS 通用 | 需常开机器；不是任意网页嗅探 |
| **C. 安卓原生 App**（内置 WebView 嗅探 + `youtubedl-android`） | 高 | 浏览器内网页，可后台/离线 | 维护成本最高；iOS 上架基本无望，自签需 7 天重签 |
| **D. 微信小程序** | — | — | 技术与合规双重不可行 |

### 现成轮子（不重复造）

- 安卓端图形壳：[Seal](https://github.com/JunkFood02/Seal)、[YTDLnis](https://ytdlnis.org/)
- 把 yt-dlp 嵌进 App：[youtubedl-android](https://jitpack.io/p/yausername/youtubedl-android)（约 30MB，含 ffmpeg）
- 服务端 Web UI：[MeTube](https://github.com/alexta69/metube)（Docker 部署，支持 yt-dlp）
- 手机分享入口：PWA [`share_target`](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target)

---

## 5. 建议执行顺序

### 阶段 0：验证（半天，零代码，先做这个）

在安卓机安装 Lemur 或 Mises，侧载本仓库目录，逐项实测：

1. `chrome.webRequest` 能否嗅到 m3u8 / 视频直链
2. `chrome.downloads` 是否存在，能否落进 `Downloads/video-rod/`
3. popup 面板在触控下是否可用（`side_panel` 预期不存在）
4. 远程 FFmpeg 合并链路是否仍可用

**判定**：第 1、2 项通过 → 移动端需求当场解决，不做 App；否则进入阶段 1。

### 阶段 1：兜底方案（第 0 步失败，或需要 iOS）

只做路线 B：PC/NAS 跑 MeTube，手机端做 PWA 分享页。不写原生代码，两端通用。

### 阶段 2：原生体验（仅在前两步都不满足时）

路线 C，可复用 `js/naming.js`（纯函数，WebView 内可直接运行）。

---

## 6. 待确认问题（决定最终选型）

1. **目标平台**：只安卓，还是 iOS 也要？（iOS 只能走 B）
2. **要下什么**：浏览器网页里的视频，还是抖音/小红书等 App 内的视频？（后者扩展嗅不到，只能分享链接给服务端解析）
3. **有没有常开的 PC/NAS**？（有 → B 最优；没有 → A 或 C）

---

## 7. 证据来源

- [Chrome for Android 不支持扩展（Google 社区）](https://support.google.com/chrome/thread/417456458/malicious-extension?hl=ml-ML)
- [Kiwi Browser 已停更（Quetta）](https://www.quetta.net/blog/the-best-alternatives-to-kiwi-browser)
- [Edge Android 扩展需 Canary / 仅白名单（Microsoft Q&A）](https://learn.microsoft.com/zh-cn/answers/questions/2337658/edge)
- [MDN: WebExtensions downloads API（Firefox for Android 不支持）](https://developer.mozilla.org/ja/docs/Mozilla/Add-ons/WebExtensions/API/downloads)
- [Apple: Safari 扩展兼容性（iOS 不支持 webRequest）](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility?language=_1)
- [Apple 论坛：Safari 尚无 browser.downloads API](https://developers.apple.com/forums/thread/660046)
- [微信小程序网络能力：服务器域名白名单](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network)
- [微信审核：涉及「侵权资源共享」暂不支持](https://developers.weixin.qq.com/community/develop/doc/00086e538e8de8a8f3447646b62800)
- [MeTube：自建 yt-dlp Web UI](https://github.com/alexta69/metube)
- [Seal：Android yt-dlp 开源客户端](https://github.com/JunkFood02/Seal)
- [YTDLnis：Android yt-dlp 图形界面](https://ytdlnis.org/docs/guides/getting-started)
- [youtubedl-android：安卓内嵌 yt-dlp 库](https://jitpack.io/p/yausername/youtubedl-android)
- [MDN: PWA share_target](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target)
- [狐猴浏览器：支持 Chrome/Edge 扩展](https://www.lemurbrowser.com/new_version_test/app/en.html)
- [Mises Browser：支持 Chrome 扩展](https://www.mises.site/introduction)
