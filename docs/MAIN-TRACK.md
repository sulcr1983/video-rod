# 主线进度与待拍板清单

> 更新：2026-11-18 ｜ **这是主线的唯一进度真源**。每次推进后更新本文件，不依赖对话记忆。
> 第一性原理（苏哥原话）：**最简单方便地下载网页上的各种视频/图片/动图/音频；可单独、可批量合集、可整博主；分门别类入不同文件夹；最终在统一媒体库里查看、删除。**

---

## 一、主线定义（七步）

```
① 拆解竞品 → ② 核对我们的代码 → ③ 升级架构文档 → ④ 修复 → ⑤ 测试 → ⑥ 验收 → ⑦ 沉淀
```

当前位置：**④ 修复已完成**（B/C/D/A/E 全部落地；下一步 ⑤ 验收与发布物重建）。

---

## 一之二、当前真实状态（2026-11-18 核实，不凭记忆）

| 指标 | 数值 |
|---|---|
| 全量回归 | **64/64 套件全绿** |
| 本轮新增测试套件 | **21 个**（347 条断言） |
| 本轮新增源文件 | 8 个（`js/enumerate/*` 7 个 + `sw-util.js`/`sw-download.js`/`offline-*.js`） |
| 真机验证 | B站枚举 18/18、离线库全链路、引用重指、补注入 8/8、**枚举页三态 17/17** |

### 已完成并验证（可交付）

| # | 项 | 验证方式 | 备注 |
|---|---|---|---|
| **B1** | `removePhysical` 假删除 → 改走 FSA 真删 | 单测 24 条 + 逻辑修正 | **真实缺陷，已修** |
| **B2** | 引用删除顺序保护（双向） | 单测 14 条 + 真机 | **防御性修复**：正常流不可达（`refOnly=true` 时文件不搬），兜脏数据 |
| **B3** | `outOfRoot` 可见化 | 真机验证（造数据→列表→删索引） | 提示条可点 → 弹列表 → 「仅删索引」；**不删物理文件** |
| **C1** | 原图派生扩到 47 组 CDN | 单测 6 条 / 57 用例 + 端到端 7/7 | `site-original-rules.js`；含安全约束（非目标域名不改写、原始 URL 返回空） |
| **C2** | `aborted_no_partial` 三态 | 单测 11 条 | `vrDropDownload` 返回 `cleanup: ok/failed/unknown`；复核「removeFile 没报错但文件仍在」 |
| **C3** | `session` + `local` 双写 | 单测 13 条（`test-enum-store-dual.js`） | SW 重启后从 local 恢复；`markInterrupted` 有东西可标 |
| **C4** | `EXT-X-MAP` / `EXT-X-BYTERANGE` | 单测 16 条 | fMP4 单文件流分片；**顺带修掉 `stripRepeatedInit` 丢 `moov` 的真 bug** |
| **E2** | B站合集枚举（`seasons_archives_list`） | 单测 18 条 + **真机 24/24** | 免登录可用；实测纠正竞品端点错误（`medialist` 翻页无效） |
| **E3** | 枚举 UI + 下载分流 | **真机三态 17/17** | `enumerate.html` 枚举页 + popup 入口；`vrEnum.download` 按平台分流（B站走 playurl 取真视频流，**不拿封面冒充视频**） |
| **D6** | 更新后补注入内容脚本 | **真机 8/8** | `onInstalled` 对现有 tab 补注入 `net-sniff.js`(MAIN) + `content-script.js`；两者加幂等保护，重复注入不双重 hook |
| **D5** | 消息下发三级降级 | 单测 10 条 | `vrSendToTab`：失败且属「无接收端」→ 补注入 → 重发一次；5 处指令下发改走它 |
| **D1** | 库根内容校验（6 态） | 单测 16 条 | `inspectRoot` 纯读校验：空/不像库/索引损坏/正常；选错目录当场提示，不等扫描才发现 |
| **D3** | `masterIds` / `disappeared` | 单测 9 条 | 博主删了本地还留着；**中断/出错时不更新快照**（没枚举到 ≠ 被删了） |
| **D7** | SPA `pushState` 导航感知 | 语法 + 真机 | MAIN world 包 `history.pushState/replaceState` → `postMessage` → 浮层重扫；`popstate` 本来就有 |
| **D2** | 增量同步（整页已知即停） | 单测 9 条 | `incremental` 模式：masterIds **合并**不覆盖、**不更新 disappeared**（提前停 ≠ 被删了） |
| **D10** | B站番剧枚举（`pgc/view/web/season`） | 单测 22 条 | 整季一次拿全；`duration` 毫秒→秒；**连带修掉「整博主/合集撞任务键」** |
| **D11** | `image-panel.js` 拆分 | 回归 64/64 + `panel-css` 11/11 | CSS(236行)+3 个 SVG 抽到 `image-panel-style.js`；**1508→1261 行**，零逻辑改动 |
| **A1** | B站 wbi 签名 | 单测 6/6 MD5 向量 + **真机 18/18** | 取流不需要，枚举必需 |
| **A2** | 枚举执行器（`runner.js`） | 单测 16 条 | 翻页/去重/断点/错误/取消全覆盖 |
| **A3** | adapter → 下载链路格式转换 | 单测 + 真机 | `toBatchItems` 产出 vrImgBatch 契约 |
| **A4** | 5 个平台 adapter | 单测 36 条 | B站/抖音/X/小红书/微博 |
| **E1** | 离线媒体库（抖珍藏式） | 单测 43 条 + **真机全链路** | 9KB HTML + 145KB data.js + 自动维护 + 库页按钮 |
| — | 拆分第 0 步 | 回归 54/54 | `sw-util.js` / `sw-download.js` 已抽出，委托包装 |

### 未开始（按优先级）

| # | 项 | 现状 |
|---|---|---|
| — | 拆分阶段 1~3（`background.js` 仍 8900+ 行） | 见 §三 |
| — | `image-panel.js` **逻辑**拆分（`ensureUI` 328 行 / `applySettings` 294 行，跨 40+ 共享闭包状态） | P3；第一期只做了纯常量外移 |

> **D1~D11 已全部处理完毕**：D1/D2/D3/D5/D6/D7/D8/D9/D10 已完成，D4 判定不做，D11 完成第一期。
> 明细见上表「已完成并验证」与 §三的各项状态。

> B1/B2/B3、C1~C4、E1~E3 已全部完成，明细见上表「已完成并验证」。

---

## 二、已完成（① ② ③）

### 2.1 ① 竞品拆解（12 家）

| 产出 | 位置 | 规模 |
|---|---|---|
| 12 家深度拆解 | `docs/research/extensions/DEEP-01~12.md` | 3059 行 |
| 3 份协议级专文 | `AIX-原图派生规则表.md` / `VDH-下载协议与状态机.md` / `DouZhenCang-媒体库与目录状态机.md` | — |
| 索引与方法论 | `docs/research/extensions/README.md` | — |
| 机器提取报告 | `ANALYSIS-01~12.md` | — |
| 整博主批量协议 | `docs/COMPETITOR-BATCH-ENUM.md` | — |

### 2.2 ② 核对我们的代码

| 产出 | 位置 | 结论 |
|---|---|---|
| 竞品 → 功能块对照诊断 | `docs/COMPETITOR-GAP-DIAGNOSIS.md` | **21 已有 / 21 缺口 / 4 空白 / 8 不用** |
| B站 wbi 实测 | `docs/RESEARCH-BILIBILI-WBI.md` | **取流不需签名，枚举必需** |
| 本地库 vs 离线库评审 | `docs/REVIEW-LOCAL-VS-OFFLINE-LIBRARY.md` | 我们库更强；离线库只读 |

### 2.3 ③ 升级架构文档

| 产出 | 位置 | 规模 |
|---|---|---|
| 架构健康审计（升级版） | `docs/ARCHITECTURE-HEALTH-AUDIT.md` | **1004 行**（原 891） |
| 架构图 6 张 | `docs/ARCHITECTURE-DIAGRAMS.md` | 343 行 |
| 枚举层设计 | `docs/ENUMERATE-LAYER-DESIGN.md` | — |

### 2.4 附带完成的代码（纯函数，已测）

| 模块 | 断言 | 状态 |
|---|---|---|
| `js/enumerate/targets.js` | 33 | ✅ |
| `js/enumerate/pager.js` | 22 | ✅ |
| `js/enumerate/normalize.js` | 20 | ✅ |
| `js/enumerate/store.js` | 20 | ✅ |
| `js/enumerate/bili-wbi.js` | MD5 6/6 向量 | ✅ |

**全量回归：64/64 全绿**（本轮新增 21 套件 / 347 断言）。

---

## 三、未完成（④ 修复阶段，21 项缺口）

> **进度更新（2026-11-18）**：
> - ✅ **B1 已修**：`removePhysical` 改走 FSA 真删（`dedup.js`），回归 64/64
> - ✅ **B2 已加防御**：引用删除双向保护（正常流不可达，兜脏数据）
> - ✅ **A1/A2 已建**：wbi 签名（MD5 6/6）+ 5 个 adapter + 4 个扩展器（95→215 断言）
> - ✅ **E1 已完成**：离线媒体库（9KB HTML + 145KB data.js + 自动维护 + 库页按钮）
> - ✅ **拆分第 0 步**：`sw-util.js` / `sw-download.js` 已抽出，委托包装
> - 回归：**50/50 全绿**

### 3.1 阻断级（不修则新功能跑不通）

| # | 项 | 现状 | 影响 |
|---|---|---|---|
| ~~A1~~ | ~~B站枚举 `wbi` 签名~~ | ✅ **已完成**（`bili-wbi.js` + 已接 adapter） | — |
| ~~A2~~ | ~~枚举执行器~~ | ✅ **已完成**（`pager.js` 双路径 + 5 adapter） | — |
| **A3** | 枚举结果 → 下载链路 | 未接线 | 端到端仍不通 |

### 3.2 正在发生的数据问题（P0）

| # | 项 | 现状 | 影响 |
|---|---|---|---|
| **B1** | **`removePhysical` 假删除** | `fetch(file://,{method:'DELETE'})` 返回 ok 但不删 | 每次去重命中都在盘上**多留一份副本** |
| **B2** | **引用删除无顺序保护** | 先删实体 → 引用卡 `refOf` 仍指原路径 | 引用卡**永久悬空且不显示缺失** |
| ~~**B3**~~ | ~~**`outOfRoot` 不可管理**~~ | ✅ **已修**（提示条可点 → 弹列表 → 仅删索引） | — |

### 3.3 高收益（P1）

| # | 项 | 现状 | 收益 |
|---|---|---|---|
| ~~**C1**~~ | ~~原图派生扩到 62 站~~ | ✅ **已完成**（`site-original-rules.js`，47 组 CDN） | — |
| ~~**C2**~~ | ~~`aborted_no_partial` 三态~~ | ✅ **已完成**（11 条单测） | — |
| ~~**C3**~~ | ~~`session` + `local` 双写~~ | ✅ **已完成**（`createDualBackend`，13 条单测） | — |
| ~~**C4**~~ | ~~`EXT-X-MAP` / `EXT-X-BYTERANGE`~~ | ✅ **已完成**（16 条单测；顺带修掉 `stripRepeatedInit` 丢 `moov` 的真 bug） | — |

### 3.4 中低优先级（P2）

| # | 项 |
|---|---|
| ~~D1~~ | ~~目录安全校验（10 态，含 `belongs_to_another_*`）~~ → ✅ 已完成（**6 态**；账号绑定态不适用：我们鼓励「拷文件夹到移动硬盘」，路径不同不是错误） |
| ~~D2~~ | ~~`masterList` 增量同步~~ → ✅ 已完成（`incremental` 模式，9 条单测；**与 D3 互斥**：增量不更新 disappeared） |
| ~~D3~~ | ~~`disappeared` 集合（服务器已删但本地有）~~ → ✅ 已完成（`masterIds` 快照 + 差集，9 条单测） |
| ~~D4~~ | ~~`BroadcastChannel` 广播~~ → ❌ **不做**：`chrome.storage.onChanged` 已覆盖同一需求（`image-batch.js:83`、`image-drag.js:45` 在用），再开一条通道等于两套真相 |
| ~~D5~~ | ~~`getContexts` 三级降级~~ → ✅ 已完成（**改用「失败→补注入→重试」**：`getContexts` 实测返回 0 context，不可用作判据） |
| ~~D6~~ | ~~`onEnabled` 补注入（解决「需刷新」）~~ → ✅ 已完成（`onInstalled` 补注入，真机 8/8） |
| ~~D7~~ | ~~`navigation` API 检测 SPA~~ → ✅ 已完成（**不用 navigation API**：包 `history.pushState/replaceState` 即可，兼容性更好） |
| ~~D8~~ | ~~`cursorType === "Bottom"` 终止判据~~ → ✅ 已完成（已在 `adapters/x.js` 的 `findBottomCursor` 落地，`test-enum-adapters2.js` 有断言） |
| ~~D9~~ | ~~B站合集 `medialist/resource/list`~~ → ✅ 已完成，并入 E2（实测正确端点是 `seasons_archives_list`，非 `medialist`） |
| ~~D10~~ | ~~B站番剧 `pgc/view/web/ep/list`~~ → ✅ 已完成（**改用 `pgc/view/web/season`**：实测结构更全、带 season_id/total） |
| ~~D11~~ | ~~模块按职责拆分（`image-panel.js` 1507 行）~~ → ✅ **第一期完成**（纯常量外移，1508→1261 行）；逻辑拆分见 P3 |

### 3.5 新功能

| # | 项 | 状态 |
|---|---|---|
| **E1** | **离线只读查看器** | ✅ **已完成**（`offline-export.js` + `offline-sync.js` + 库页按钮；真机验证） |
| **E2** | **B站合集批量** | ✅ **已完成**（走 `seasons_archives_list`，非竞品的 `medialist`；真机 24/24） |
| E3 | 整博主枚举接下载链路 | ✅ **已完成**（SW 加 `vrEnumOwner` + `vrEnum.owner`；**加上 `enumerate.html` 枚举页与 popup 入口**；`vrEnum.download` 按平台分流：B站解析 playurl 取真视频流、其余用 adapter 直链；**真机三态 17/17**） |

---

## 四、待苏哥拍板（必须你决定，我不能替你定）

| # | 问题 | 选项 | 我的建议 |
|---|---|---|---|
| **P-1** | **修复顺序** | ① 先修数据问题（B1/B2/B3）<br>② 先打通枚举（A1/A2）<br>③ 先做离线库（E1） | **①**：B1/B2 是正在丢数据/留垃圾，优先止血 |
| **P-2** | **离线库导出内容** | ① 只索引+缩略图（轻）<br>② 含素材本体（重，可能几十 GB）<br>③ 两种都支持 | **③**：默认轻，可选含原文件 |
| **P-3** | **`relPath` 主键问题是否动** | ① 不动（只止血）<br>② 引入稳定 `mediaId`，新数据双写<br>③ 全量迁移 | **①或②**：③风险最高，不建议 |
| **P-4** | **B站先做哪块** | ① 合集 `medialist`<br>② 整博主 `arc/search`（需 wbi）<br>③ 两个都做 | **②**：整博主是你的核心需求，合集是补充 |
| **P-5** | **登录态验证何时做** | ① 现在（需开浏览器）<br>② 等代码写完一次性验证 | **②**：减少启动次数，符合实例纪律 |
| **P-6** | **`background.js` 8435 行是否拆** | ① 不拆（风险高）<br>② 只拆下载编排三件<br>③ 按站拆脚本 | **①**：现在拆风险大于收益 |

---

## 五、明确不做（已决策，避免重复讨论）

| 项 | 理由 |
|---|---|
| 抖珍藏的窄权限（0 权限） | 我们做通用嗅探，必须全站 |
| `showSaveFilePicker` 单文件落盘 | 不是批量 |
| 30MB/7MB ffmpeg wasm | 我们 `fmp4-merge.js` 无损且体积小 ~500 倍 |
| 7 表拆 7 文件 | 过度设计 |
| MP4 box 纯字节解析 | 浏览器渲染更简单 |
| 离线页做管理功能 | 浏览器外无写权限，硬做只会「点了没反应」 |
| 云端订阅/配额/远端 UI | 与自用定位冲突 |
| 3KB SW 重构 | 风险高收益低 |
| 小金薯的任何做法 | 纯 DOM、1.6MB element-ui、无枚举能力 |

---

## 六、三条铁律（不可违反）

1. **真实登录态浏览器只许看**：禁反复开关面板/弹窗、禁循环刷新（`TESTING.md §0.0`）
2. **不装外部程序**（ADR-008）
3. **单写盘通道**（ADR-069）——注意：目前只约束下载，**管理操作绕过了**（图 1 红线）

---

## 七、下次对话怎么接上

**读这三份就够**：

1. 本文件（进度 + 待拍板）
2. `docs/DOC-MAP.md`（文档该读哪份）
3. `docs/ARCHITECTURE-DIAGRAMS.md`（6 张图看架构）

**然后直接问**：「P-1 到 P-6 定了吗？定了就从哪项开始。」
