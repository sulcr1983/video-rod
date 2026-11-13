# 调研：回收站删除被重扫复活 / 详情页「定位」开成网页

> 日期：2026-11-13 ｜ 触发：苏哥报「回收站删除后点全量刷新又出现」「详情页定位在网页里出现文件夹，不合理」
> 结论用于：ADR-085（扫描不许撤销删除）、ADR-086（定位走系统文件管理器）

## 一、问题域拆解

两个问题的公共点：**扩展被当成「浏览器页面」而不是「文件管理器」在用**。

| 能力 | 浏览器扩展能做什么 | 不能做什么 |
|---|---|---|
| 删除文件 | FSA `removeEntry` / 移到 `<根>/_回收站` | 调系统回收站（Windows 回收站） |
| 显示文件位置 | `chrome.downloads.show(downloadId)` | 按任意路径唤起资源管理器 |
| 打开文件夹 | `showDefaultFolder()`（只会是默认下载目录） | 打开任意目录 |
| 打开 `file://` 路径 | 用标签页打开（= 浏览器内目录索引页） | 唤起系统文件管理器 |

## 二、删除标记 vs 重扫：主流语义

结论：**删除优先（tombstone 优先）**。

1. 删除动作写入显式状态（软删除标记 / 回收站批次 / manifest），该状态是权威记录。
2. 扫描器只负责「发现新增」，不负责「撤销删除」。扫到同一路径时：
   - 若该路径存在删除标记 → 保持删除态，不复活；
   - 若用户**显式恢复** → 清除标记，文件回到原位。
3. 若要支持「文件确实被外部改回」的自愈，判据必须来自**独立证据**（回收站里没有副本、manifest 无记录），不能只看「原位有文件」—— 因为引用式删除（同内容多条目）本来就把文件留在原位。

这套语义与 ADR-074 第 4 条「扫描不许复活」一致；本项目的问题是该规则只落到 `downloads` / `snapshot` 两个源，`full` / `reconcile` 漏了，且 `mergeEntry()` 里还有一处「扫到就清 trashed」的隐式恢复。

## 三、「定位」到资源管理器：合法途径

### 3.1 官方文档原文

`chrome.downloads.show(downloadId)`：

> Show the downloaded file **in its folder in a file manager**.

`chrome.downloads.showDefaultFolder()`：

> Show the **default Downloads folder** in a file manager.

要点：
- `show()` 是唯一能「在文件管理器中显示该文件」的扩展 API，**只接受 downloadId，不接受路径**。
- `showDefaultFolder()` 只能打开默认下载目录，不能带参数指向子目录。
- 因此「按任意绝对路径定位」在纯扩展能力内**不可能**。

来源：
- Chrome Extensions — `chrome.downloads`：https://developer.chrome.com/docs/extensions/reference/api/downloads
- MDN — `downloads.show()`：https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/show

### 3.2 要「精确按路径定位」必须加本地宿主

`chrome.runtime.sendNativeMessage` / `connectNative` + 本机注册表项：

> 注册表 `HKEY_CURRENT_USER\SOFTWARE\Google\Chrome\NativeMessagingHosts\<name>` 默认值指向 host manifest 的绝对路径；manifest 里 `allowed_origins` 必须是扩展 id。

宿主程序在 Windows 上执行 `explorer.exe /select,<path>` 即可精确选中文件。代价：

- 需要安装本地程序 + 写注册表（Chrome / Edge 各自一套键）；
- 商店分发时要解释「为什么装扩展还要装个 exe」，劝退率高；
- 需要 `nativeMessaging` 权限与 host manifest 签名/路径维护。

来源：https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging

### 3.3 无宿主时的可行降级

多数同类扩展（纯扩展形态，无本地程序）的现实做法：

1. 条目带 `downloadId` 且记录仍在 → `downloads.show(id)`（最准）。
2. 没有 `downloadId` → 在 `downloads.search({limit:N})` 里找**同目录**的任意一条记录，用它的 id 调 `show()`。目录能准确打开；选中项可能是同目录的其它文件（可接受的近似）。
3. 连目录都拼不出来 → `showDefaultFolder()` + 复制路径到剪贴板，并在提示里说清原因。

**明确禁止**：用 `chrome.tabs.create({url:'file:///…'})` 充当「打开文件夹」。它只会生成一个浏览器内目录列表页，和用户的预期（弹出资源管理器）完全不同，属于「报成功但没做到」。

## 四、对本项目的直接结论

| # | 结论 | 落点 |
|---|---|---|
| C1 | `full` / `reconcile` 必须与 `downloads` / `snapshot` 同口径跳过 `trashed` 行 | `js/library/indexer.js` `build()` |
| C2 | `mergeEntry()` 不得清除 `trashed` 状态 | 同上 |
| C3 | `sweep()` 不得用「原位有文件」推断「没删」；refOnly 先判，回滚需「回收站无副本」 | `js/library/trash.js` |
| C4 | 「定位」只用 `downloads.show` / `showDefaultFolder`，禁用 `file://` 标签页 | `js/library/app.js` `revealWithoutDownload()` |
| C5 | 精确选中文件需 native host，本轮不做（安装成本与商店审核代价过高），在文档与提示中如实说明上限 | 本文件 §3.2 |

## 五、未采纳的方案与理由

| 方案 | 不采纳原因 |
|---|---|
| 定位时用 `file://` 打开目录 | 用户看到的是网页目录列表，不是资源管理器（本次 bug 本身） |
| 删除时直接物理删除、不做回收站 | 违反 ADR-033 / ADR-074，用户失去可恢复性 |
| 扫描后按「磁盘有文件」自动恢复 | 正是复活 bug 的根因；引用式删除永远会把文件留在原位 |
| 引入 native messaging 宿主 | 安装/分发成本高，非本轮范围；已记为后续可选能力 |