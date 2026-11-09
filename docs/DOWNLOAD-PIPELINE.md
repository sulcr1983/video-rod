# 下载管线统一清单（DOWNLOAD-PIPELINE）

> 建立：2026-11-09 ｜ 触发：苏哥「下载进度统一一下，所有网站都按这个做」「再检查一下各个地方的下载统一组件，包括下载图片的、下载视频的，能统一的都统一」
> 本文是**盘点 + 契约**：哪些入口已收敛、哪些故意不合并、后续新加通道必须怎么接。

## 一、三条主干（所有下载最终都落到这里）

```
① 命名       VideoRodNaming (js/naming.js)         视频模板 ${author}_${title}
             VRPath.buildRelPath / cleanSeg        图片 日期_标题.ext + 目录拼装

② 落盘       vrDownloadWithName(url, relPath, extra)        ← SW 唯一出口
                └ VRSave.saveFile → FSA 直写（优先） / downloads API（回退）

③ 入库       VRLib.record / meta 预登记 → VRDB

④ 进度       vrProgressReporter(tabId, name)                ← 唯一进度出口（B-52）
                ├ P.bytes(got,total)   FSA 分片写 / fetch 流
                ├ P.note(phase,pct)    页面内自跑（B站 合成）
                ├ P.watch(downloadId)  downloads 任务字节轮询
                └ P.done(ok,err)
```

## 二、入口盘点

| # | 入口 | 触发文件 | 消息 / 调用 | 落盘 | 入库 | 进度 |
|---|---|---|---|---|---|---|
| 1 | 视频页内悬浮按钮 | `video-overlay.js` | `vrVideoDownload` | ✅ 统一出口 | ✅ | ✅ B-52 |
| 2 | 右键「下载此视频」 | `contextMenus` | `vrSaveContextMedia` | ✅ | ✅ | ✅ B-52 |
| 3 | popup 单卡下载 | `popup-videorod.js` | `vrLib.saveOne` | ✅ **B-52 新收敛** | ✅ | 面板汇总 |
| 4 | popup 批量下载 | `popup-videorod.js` | `vrLib.saveOne` ×N | ✅ ADR-069 | ✅ | 面板汇总 |
| 5 | B站 完整视频（popup 内嵌） | `popup-videorod.js` + `bili-whole.js` | 页面内 durl/dash | `<a download>` | ✅ 预登记 | ✅ 自带百分比 |
| 6 | 图片悬停按钮 | `image-hover.js` | `vrImg.download` | ✅ | ✅ | 无（单张） |
| 7 | 图片清单面板 | `image-panel.js` → hover/batch | `vrImg.download` / `vrImg.batch` | ✅ | ✅ | 批量计数 |
| 8 | 图片批量 | `image-batch.js` | `vrImg.batch` | ✅ | ✅ | ✅ `vrImg.batchProgress`（张数） |
| 9 | 图集整页 | `image-album.js` | `vrImg.albumScan` | ✅ | ✅ | ✅ `vrImg.albumProgress` |
| 10 | 拖拽/快捷键存图 | `image-drag.js` | `vrImg.download` / `vrImg.batch` | ✅ | ✅ | 批量计数 |
| 11 | m3u8 / mpd | `m3u8.js` / `mpd.js` | 独立下载器 | ❌ 不经过统一出口 | ❌ | 自带 |
| 12 | YouTube | `js/yt/yt-download.js` | `chrome.downloads.download` | ❌ | ❌ | 自带 |
| 13 | 资源库设置「测试下载」 | `library/settings.js` | `chrome.downloads.download` | ❌ | — | — |

> 11–13 是**历史遗留独立通道**，本次不动（各自的下载器/合并流程与素材库无关），但已记录在案。

## 三、本轮统一的四件事（B-52）

1. **进度统一出口**：`vrProgressReporter()`。
   以前 B站 读页面变量、通用站/抖音谁都不报、FSA 直写有 `onProgress` 钩子却没人接。
   现在三条链路共用同一个对象，`done()` 只生效一次、`bytes()` 不报 100（100 只由 done 负责）。

2. **popup 单卡下载收敛到 SW 单通道**。
   原来「设好名字 → 放行给猫抓 popup.js 直调 `chrome.downloads.download`」，后果三件全丢：
   不预登记资源库、无进度、ADR-040 后 downloads 不认 filename 可能落成 UUID/丢子目录。
   批量早就收敛了（ADR-069），单卡漏了；现在复用 `vrRunBatchSw(single=true)`。

3. **消息助手去重**：新增 `js/vr-msg.js`（`VRMsg.send/request`）。
   `image-hover.js` 与 `image-batch.js` 原来各有一份逐字相同的 `send()`，只有超时值不同（8s/120s）。

4. **下载进度语义统一**：`{pct}` / `{indeterminate}` / `{done, ok, error}`。

## 四、故意不合并的地方（说清原因，避免后人重复踩）

| 项 | 为什么不合并 |
|---|---|
| 图片命名 vs 视频命名 | 产品规则不同：图片 `<日期>_<标题>.<ext>`（同题九图靠日期+分组目录区分），视频 `<作者>(@ID)_<标题>`。硬合并会改用户可见文件名。 |
| 图片批量进度（张数）vs 视频（字节） | 语义不同：50 张图看「下到第几张」比看字节有用；单个视频看「下了百分之几」才有意义。消息名保留 `vrImg.batchProgress`，字段口径一致。 |
| 视频防盗链 `vrSetMediaHeaders`（按域名，10 分钟 TTL）vs 图片 `vrImgRefererRule`（按完整 URL + 移除 Origin） | 图片那条是为了微博 sinaimg（见 `Origin` 就 403，2026-11-05 实测），必须逐 URL 精确匹配并删 Origin；视频按域名批量设置更省规则配额。合并要牺牲其中一方的正确性。 |
| 文件名清洗函数（现存 6 份） | `naming.js:cleanSegment`、`library/path.js:cleanSeg`、`library/save.js:cleanSeg`、`library/settings.js:cleanSeg`、`popup-videorod.js:cleanSeg`、`lib-download-scan.js:sanitizeFilename`。规则差异真实存在（保留路径分隔符 / 长度上限 / emoji / 保留设备名），且分别作用于「模板变量」「相对路径段」「整条路径」「扫描结果」。**目前不合并**，若将来统一须先补一组跨实现的对照测试，否则会静默改掉用户的落盘名。 |

## 五、新加下载通道的检查清单

1. 落盘必须走 `vrDownloadWithName(url, relPath, extra)` —— 不要直接 `chrome.downloads.download`。
2. 需要进度就把 `tabId` 交给 `vrProgressReporter(tabId, name)`，用 `bytes/watch/note/done`；
   **不要再自己拼 `chrome.tabs.sendMessage({Message:'vrVideoProgress'})`**。
3. 命名复用 `VideoRodNaming`，图片走 `VRPath.buildRelPath`；不要在调用点手搓文件名。
4. 入库 meta 至少带 `pageUrl / sourceUrl / title / platform`，否则资源库「来源」永远是空。
5. 页面侧消息用 `VRMsg.send/request`（`js/vr-msg.js`），别再写第三份 `send()`。
