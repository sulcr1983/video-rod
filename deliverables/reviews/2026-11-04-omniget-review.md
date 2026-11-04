# OmniGet（OpenSelena）参考价值评审 + 本地未完成任务盘点

- **日期**：2026-11-04
- **状态**：评审中（等苏哥拍板）
- **对象**：https://github.com/OpenSelena/omniget
- **本地基线**：`79c297b`（文档）/ `151d81b`（代码），工作区干净
- **方法**：GitHub 页面 + raw 文件 + GitHub API 实抓；本地文档全量交叉核对 + 代码抽查验证

---

## 一、一句话结论

**这个仓库对我们没有可抄的代码，只有 1 条结构性启发和 1 个可选 UX 概念。**

原因很硬：它 92% 是 Rust（8.5 MB）跑在 Tauri 桌面壳里，核心全靠调 yt-dlp/ffmpeg 外部进程；我们是零后端纯 MV3 扩展，架构不交界。唯一重叠的 `browser-extension/chrome` 里，最像"能抄"的两个文件 `media-signature.js` / `hls-size.js`，**文件头自己写着 `Portions adapted from cat-catch (js/m3u8.js)`** —— 它抄的是我们的上游，抄回来是绕圈。

---

## 二、它是什么（实测数据）

| 项 | 事实 |
|---|---|
| 定位 | 桌面下载管理器 + 课程库 + 158 个工具箱 + AI agent 接口 |
| 技术栈 | Tauri 2 + Rust + SvelteKit + SQLite + yt-dlp/ffmpeg/gallery-dl/aria2 |
| 扩展的真实角色 | **只负责"发送"，不负责下载**：manifest 权限里没有 `downloads`，抓到 URL 后 POST 给本地 `127.0.0.1:47720` 桥 |
| 规模 | 仓库 78.7 MB；Rust 8.57 MB / JS 797 KB / TS 794 KB |
| 活跃度 | Star 1,868 / Fork 215 / 最后 push 2026-11-04（今天） |
| 创建时间 | 2026-07-08，4 个月 2,990 commits（≈25 次/天，commit 带 `Co-Authored-By: Claude`） |
| 许可证 | **GPL-3.0**（API `license.spdx_id` 确认，非 AGPL） |

**质量信号**：2026-10-31 一条 `chore(study): completely wipe out study feature` 把整个 Study 模块从仓库删干净；扩展里 `sniffer-toggle.js`/`deep-search-toggle.js`/`h264-toggle.js`/`open-app-toggle.js` 四个开关各写各的没抽象。**能当"看一眼别人怎么组织"的样本，不能当稳定依赖或结构范本。**

---

## 三、⚠️ 我推翻了 Agent 报告里的两个判断（已实测）

| Agent 的说法 | 实测结果 | 影响 |
|---|---|---|
| "我们现在把抓到的请求头整体转发，会泄露 Cookie" | **错**。`js/background.js:2362 getRequestHeaders()` 已经是白名单：只收 `DIRECT_INCLUDE_HEADERS` 里的名字 + `x-` 开头且命中 `X_AUTH_KEYWORD_REG` 的；且 `:238` 把 `cookie` 单独摘到 `data.cookie`，从转发头里置 undefined。**它就是 cat-catch 原生的白名单实现** | 借鉴点①作废，我们已有 |
| "我们的 HLS 体积估算现在按码率猜" | **错**。`js/m3u8.js:867 estimateFileInfo()` 已经是"采样 10 段 HEAD → 取平均 × 总段数"，和 OmniGet 的 `hls-size.js` 是同一套（因为同源） | 借鉴点③作废，我们已有 |

**结论：三个"最值得抄"的点里，两个我们本来就具备。** 这不是巧合——因为它的这两个文件就是从猫抓改的。

同时纠正一个长期误记：**本项目是 GPL-3.0，不是 MIT**（`LICENSE` 首行 + `README.md:194` 自述"猫抓衍生作品，整体遵循 GPLv3"）。这意味着本产品永久不能闭源、不能上付费墙。这条比 OmniGet 值不值得抄更重要。

---

## 四、可借鉴清单（只有 3 条，都很轻）

| 借鉴点 | 内容 | MV3 可行性 | 工作量 | 风险 |
|---|---|---|---|---|
| ① 嗅探层按职责拆文件 | 它把嗅探拆成 `media-sniffer` / `filters` / `signature` / `hls-size` / `track-pairing` / `capture-rules` 六个纯函数文件 | 可行，无构建工具也能拆（SW 里 `importScripts`） | **中** | 我们的 `js/m3u8.js`（2446 行）+ `js/background.js`（2523 行）是核心链路，**拆之前必须先有回归测试**，否则高风险 |
| ② 可编辑捕获规则 | 用户自己写 URL 特征规则决定抓什么（`capture-rules.js`） | 可行 | 中 | 规则冲突难排查，必须配"命中日志"，否则用户只会问"为什么不抓了" |
| ③ "任务快照 + 改一个参数重试" | 它记录实际执行的完整命令，可打开改了再跑 | 概念可迁移为"下载任务快照 + 一键重试" | 中 | 只是 UX 概念，抄不到代码；现有 history 面板（M9）已经覆盖大半 |

**①②③ 都不建议现在做。** ②③ 是新产品功能，和"未完成任务"抢工期；① 属于技术整理，该做但要先补测试。

---

## 五、绝对不要碰

| 不能碰 | 原因 | 硬度 |
|---|---|---|
| `src-tauri/` 全部（Rust 8.5 MB） | 需要本地可执行进程；MV3 无 fs、无长期后台进程、SW 会休眠 | ⛔ 物理不可能 |
| `local_bridge.rs` + `bridge-client.js`（127.0.0.1 桥） | 前提是有个常驻桌面端；我们没有也不该有 | ⛔ 架构不成立 |
| SQLite 任务队列 / 断点续传 / 分片调度 | 断点续传依赖 fs 随机写 + 常驻调度器；MV3 只能靠 `chrome.downloads.resume()`，能力弱得多 | ⛔ 能力不匹配 |
| yt-dlp / ffmpeg / aria2 / librqbit 调用 | 全部需要子进程 | ⛔ 物理不可能 |
| `mcp.rs` / `plugin_host.rs`（158 工具、插件 ABI） | 需要动态加载原生库；且与视频下载无关 | ⛔ 无关 |
| popup "一键发送到桌面应用"的交互模型 | 它是遥控器，我们是下载器本体，产品模型相反 | ⚠️ 会带偏方向 |

**许可证**：双方同为 GPL-3.0，法律上可互相借代码，需保留版权头并注明来源（OmniGet 自己就是这么做的）。无 AGPL 网络条款风险。真实风险不是法律而是**产品**：GPL-3.0 锁死了闭源与商业化路径（来自 cat-catch，非 OmniGet）。

---

## 六、本地未完成任务盘点（文档交叉核对结果）

代码层 `grep TODO/FIXME`（排除 lib）：**0 条**。任务全部沉在文档里。

### P0 — 真实功能风险（会影响用户拿到坏文件）

| # | 任务 | 出处 | 现状 |
|---|---|---|---|
| 1 | **AES-128 真实加密 HLS 未真机验证** | BUILD-PLAN M11、DECISIONS:235、TESTING:260 | 代码已写（`js/m3u8-merge.js:121 decryptAes128`，WebCrypto AES-CBC + PKCS7 + 媒体序列号做 IV），**只在裸 TS 测试站验过**。真实站点多为 AES-128，漏了会拼出乱码 |
| 2 | **小红书图片「去 CDN 后缀取更大图」未真机验证** | ADR-044、HANDOFF §5 | 逻辑已实现，**没有任何真实图文笔记样本**，去后缀地址是否 404 / 是否真更大均未确认 |

### P1 — 已挂起 / 环境受限

| # | 任务 | 现状 |
|---|---|---|
| 3 | Instagram P1 真实登录态验证 | 代码完成（`6bd6d19`），苏哥无 IG 账号，2026-10-19 决定挂起 |
| 4 | 原生 picker（`#pickBtn`/`#rootBtn`/`#resetRoot`）自动验收 | CDP 无法驱动系统原生选择器，属环境限制，非缺陷 |
| 5 | `fillMissingThumbs()` 补缺分支 | 逻辑已写，真机 19 卡 0 缺图，但"补缺"路径待新素材入库触发才算实证 |

### P2 — 文档已明确的边界（不需要做，别当成待办）

- DASH(mpd) 合并（M11 只做 HLS）
- 并发固定 4 路，无「慢段救援」动态拆段
- 清晰度下拉只影响面板批量，按钮恒取最高（苏哥明确要求，不再改）
- YouTube 不做（ADR-043，入口已移除）
- 远程 HTTP Range 流式（本地媒体库不需要）
- Instagram blob/MSE 视频跳过

### P3 — 文档一致性问题（会误导下一个接手的人）

| # | 问题 | 建议 |
|---|---|---|
| 6 | **BUILD-PLAN 里 M6–M10 仍挂着"真实站点实测——装机后苏哥自己验"**，但这些后续已被真机记录覆盖（TESTING §10） | 回填为"已由 §10 真机验收覆盖" |
| 7 | **"m3u8 合并路线 A/B/C 待苏哥拍板"（DESIGN §8 / M6 未完成项）已过时**：M11 用离屏直连 + mux.js 本地合并，方案已落地 | 关闭该条，注明由 ADR-028 取代 |
| 8 | BUILD-PLAN 只写到 M11，M12（B站完整视频）/ 媒体库 P3/P4 / 小红书 / Instagram 均未进施工计划 | 合并进一份 M12+ 附录或直接指向 HANDOFF |

---

## 七、给苏哥的建议

1. **OmniGet 不立项。** 花 30 分钟看目录够了，代码一行不用抄；真要借鉴只有"拆文件"这一条，且必须先补测试。
2. **真正的待办只有两件，都在 P0，都是"验一下"不是"写代码"**：AES-128 加密 HLS 真机跑一条、小红书图文笔记跑一条。这两件不做完，功能等于"看起来有、实际可能出乱码/下不到大图"。
3. **优先级：先验 AES-128 > 小红书 > 文档回填（P3）> Instagram（等账号）。** OmniGet 的①②③ 一个都别插队。

---

## 附：证据索引

| 来源 | 拿到什么 |
|---|---|
| `github.com/OpenSelena/omniget` + `raw/README.md` | 定位、技术栈、158 工具、插件体系 |
| `raw/LICENSE` | GPL-3.0 全文 |
| `raw/browser-extension/chrome/manifest.json` | 权限无 `downloads`，`host_permissions` 含 `127.0.0.1` |
| `raw/.../src/media-signature.js`、`hls-size.js` | 文件头 `adapted from cat-catch (js/m3u8.js)` |
| `api.github.com/repos/OpenSelena/omniget` | star 1868 / fork 215 / created 2026-07-08 / pushed 2026-11-04 |
| 本地 `js/background.js:2362` | `getRequestHeaders()` 白名单（推翻 Agent 的 Cookie 泄露判断） |
| 本地 `js/m3u8.js:867` | `estimateFileInfo()` 已是 10 段 HEAD 采样（推翻 Agent 的"按码率猜"） |
| 本地 `js/m3u8-merge.js:121` | `decryptAes128()` 已实现，待真机 |
| 本地 `LICENSE` 首行、`README.md:194` | GPL-3.0，非 MIT |
