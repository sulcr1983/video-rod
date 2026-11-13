# 文档索引与可信度分级

> 更新：2026-11-13 ｜ 共 **81 份**文档（本次新增 `IMAGE-PIPELINE-REDESIGN.md`、
> `TEST-PLAN-IMAGE-PIPELINE.md`；审计报告在 `deliverables/reviews/2026-11-13-图片批量失败审计.md`）
> 用途：接手时先看这份，知道**哪份能信、哪份只能当历史看**。

---

## 一、分级标准

| 级别 | 含义 | 能不能当现状用 |
|---|---|---|
| **S** 权威 | 由代码实测/核查得出，随时可复现 | ✅ 能 |
| **A** 现状 | 描述当前实现，关键处需核对代码 | ⚠️ 大体能 |
| **P** 规划 | 早期设计/计划，**未实现部分属正常** | ❌ 只当「当初想做什么」 |
| **H** 历史 | 决策记录、审计过程、阶段性交接 | ❌ 只当「为什么这么定」 |

> **判断口诀**：文档里写的「待施工 / 计划中 / 未做」，先去代码里搜一眼再信。
> 本项目已发生多次「文档说没做、代码其实做了」（见 §六）。

---

## 二、S 级 · 权威（可直接信）

| 文档 | 内容 | 为什么权威 |
|---|---|---|
| **`BACKLOG.md`** | **待办唯一真源** | 状态只在这里改；2026-11-06 已按代码逐条核实 |
| **`E2E-BUTTON-AUDIT-2026-11-06.md`** | 全量按钮审计 | 99 按钮实点 91、JS 异常 0，可复现 |
| **`UX-ADVERSARIAL-REVIEW-2026-11-06.md`** | 对抗性 UX 审查 | 22 条问题，含实测数据与优先级 |
| **`INTERFACE-CONTRACT.md`** | 前后交互契约 | IndexedDB 结构、字段权威表、消息通道 |
| **`TEST-ASSETS.md`** | 实测素材登记 | 带真实 URL 与验证结果 |
| **`TEST-BROWSER.md`** | 测试浏览器与登录态规则 | 操作步骤可复现 |
| **`DESIGN-SYSTEM-STAGE.md`** | 设计 token 真源 | 改 UI 前必读 |
| **`DECISIONS.md`** | 决策记录（85 条 ADR，截至 ADR-068） | 每个「为什么」都有出处 |
| **`LIBRARY-PERSISTENCE-SPEC.md`** | **资源库持久化技术规格**：存储格式/接口/迁移/验收用例 | 字段与行号均对照代码核实（2026-11-07） |
| **`LIBRARY-PERSISTENCE-REQUIREMENTS.md`** | **资源库持久化需求规格**：用户故事、范围、取舍 | 用户原话与实测数据为据 |
| **`ARTIFACT-MANAGEMENT.md`** | **产出物与工作区管理规范**：源码/构建/测试/交付四类物理边界 | 2026-11-08 建立，配套 `tools/build-dist.js` |

---

## 三、A 级 · 现状（描述当前实现）

| 文档 | 内容 | 备注 |
|---|---|---|
| `LIBRARY-PLAN.md` | 资源库权威方案：目录规范、数据模型、迁移、索引 | S0–S2 已实现 |
| `YT-FEASIBILITY.md` | YouTube 可行性实测：SABR 真相、客户端矩阵 | 结论已落地 |
| `YT-IMPLEMENTATION.md` | YouTube 实现记录与验证状态 | — |
| `YT-CLIENT-STATUS.md` | YouTube 客户端可用性实测 | 有日期，需复核 |
| `DEDUP-REF-DESIGN.md` | 去重引用方案：SHA-256 + 引用计数 | **已实现** |
| `MEDIA-METADATA-PLAN.md` | 媒体溯源元数据方案 | **已实现** |
| `MEDIA-VIEWER-PLAN.md` | 查看器方案 | **已实现** |
| `PREWORK-PROVENANCE.md` | 下载溯源预研 | **已实现** |
| `LIBRARY-IMPLEMENTATION.md` | 媒体库 P1/P2 实施规格 | — |
| `PROTOTYPE-MAPPING.md` | 原型复刻施工规范 | 原型已部分超前 |
| `TESTING.md` | 测试策略与回归清单 | 基线数字可能滞后 |
| `TEST-MATRIX-P0.md` | P0 回归矩阵 | — |
| `TEST-PLAN-DOWNLOAD.md` | 下载链路验收清单 | — |
| `FRONTEND-UI-SYSTEM.md` | 前端统一设计 | 与 STAGE 版并存 |
| `DESIGN-SYSTEM-BD.md` | 设计系统 B+D | 被 STAGE 取代，留档 |
| `LIBRARY-BENCHMARK.md` | 素材库同行调研（八家） | 含「明确不做」清单 |
| `FUNCTION-AUDIT-ENTRY.md` | 入口层功能审视 | — |
| `RELEASE-FEASIBILITY.md` | 发布可行性（结论：暂不发布） | — |
| `MOBILE-RESEARCH.md` | 移动端可行性调研 | — |
| `BEUI-EVAL.md` | beUI 技术评估 | — |
| `DEPENDENCY-EVAL-FLOATING-UI.md` | 浮层定位依赖评估 | — |
| `REF-YTB-TUBLY.md` | Tubly 拆包分析 | — |
| `RESEARCH-COMPETITOR-IMAGE.md` | 竞品逆向 | — |
| `RESEARCH-TRASH-RESCAN-AND-REVEAL.md` | 回收站重扫复活 / 定位唤起资源管理器的外部调研（ADR-085/086） | — |
| `IMAGE-SIDEBAR-AIX-ADOPT.md` | **图片侧边栏 + AIX/Fatkun 能力采纳清单**（ADR-058 配套：逆向对象、落地项、实测数字、踩坑） | S（2026-11-06 实测） |
| `IMAGE-*-RESEARCH/PLAN/IMPL.md` | 图片下载系列（调研→方案→实现） | I1–I5 已实现 |
| `INCIDENT-20261019-LIBRARY-DIR.md` | 媒体库目录限制复盘 | 教训仍有效 |
| `INVENTORY-2026-11-06.md` | 全面盘点 | 快照，会过期 |
| `UI-POLISH-2026-11-06.md` | UI 打磨记录 | 快照 |

---

## 四、P 级 · 规划（未实现部分属正常）

| 文档 | 内容 |
|---|---|
| **`EXECUTION-PLAN-20261108.md`** | **当前执行真源**：QA 审计后的任务分解（Q-01~Q-15）、阶段划分、5 项待拍板决策、文档修订判定。取代 `PLAN.md` / `BUILD-PLAN.md` 的执行地位（二者仅作架构背景） |
| `PLAN.md` | 方案书 v1.1（执行地位已被 EXECUTION-PLAN-20261108 取代） |
| `BUILD-PLAN.md` | 施工计划 M0–M11（+ M12 附录） |
| `BUILD-PLAN-STAGE.md` | 舞台换皮施工清单 |
| `REQUIREMENTS.md` / `REQUIREMENTS-CHECKLIST.md` | 需求规格 |
| `DESIGN.md` | 技术设计（部分模块名已漂移，见 §六） |
| `LIBRARY-PLAN-审计方案.md` | 方案审计 |
| `LIBRARY-SELF-CONTAINED-PLAN.md` | **资源库自包含化架构方案**（含红队 14 项 + 检索 5 项结论；配套 SPEC/REQ） |
| `LIBRARY-STANDALONE-PLAN.md` | **已放弃**的本地 HTML 方案（证据存档：`file://` 探针 §0） |
| `LIBRARY-FULL-TEST.md` | 逐按钮验收（旧口径） |
| `MEDIA-LIBRARY-PLAN.md` | 早期媒体库方案 |
| `OPTIONS-REDESIGN.md` | 设置页重设计 |
| `UI-IMPL-PLAN.md` | 界面落地技术文档 |
| `IMPACT-ANALYSIS-UI-REDESIGN.md` | 增量影响分析 |
| `PRODUCT-IMAGE-ENTRY.md` | 图片入口收敛方案 |
| `S5B-BATCH-RENAME.md` | 批量选择 + 重命名 |
| `STYLE-OPTIONS.md` | 界面风格四方向 |
| `AUDIT-I5-WEIBO-PLAN.md` | 微博缺陷修复方案 |
| `WEIBO-ALBUM-PLAN.md` | 微博相册备份方案（含「叫小微」源码拆解与平台实测；ADR-056） |
| `COMPETITOR-EXTENSIONS.md` | **竞品扩展拆解总账**：Tubly/DownXVideo/Chrono/Video Downloader Plus/Pro/笃笃 + **ImageAssistant 1.70.7**（网络缓存/全 frame/规则表），逐条标注「抄/不抄」与落点 |
| `COMPETITOR-PLUCKER.md` | **Plucker XBD 5.9 逐层拆解**：`XBD__*` 消息协议表、GraphQL 拦截点与时间线解析（四级媒体回退/最高码率）、右侧面板、命名模板与目录、下载队列；含复用矩阵、≈4 天工作量与真机定性结论（ADR-084） |
| `HLS-SITE-DIAGNOSIS.md` | **HLS 站点下载诊断**：xx.knit.bid 实测（嗅探/取流/悬浮键三段分别验证），定位真实断点 |
| `IMAGE-PIPELINE-REDESIGN.md` | **图片管线 v2 设计**：发现层/执行层各一份、统一 item/消息/失败码、FSA 强制、灰度与验收（ADR-080/081/082） |
| `TEST-PLAN-IMAGE-PIPELINE.md` | **图片管线 v2 测试方案**：隔离实例批量、登录态只读、夹具/断言/反证/门禁接入 |
| `VIDEO-XHS-ENHANCEMENT.md` | **视频清晰度 + 小红书增强技术实现**：排序规则、HLS/DASH 解析、SSR 快路径、Range 分段、实测数据 |
| `IMAGE-AUTO-INDEX-RESEARCH.md` | 自动归类调研 |
| `READINESS-20261104.md` | 就绪度评估 |
| `MERGE-20261104.md` | 两线合并记录 |
| `STATUS-20261104.md` | 阶段性汇报 |

---

## 五、H 级 · 历史（交接与审计留痕）

| 文档 | 时间 | 说明 |
|---|---|---|
| `HANDOFF-2026-11-06-ROUND2.md` | 2026-11-06 | **最新交接**，含本轮全部修复记录（21 节） |
| `HANDOFF-2026-11-06.md` | 2026-11-06 上午 | 诊断交接，§6 根因档案仍有价值 |
| `HANDOFF-I5-WIP.md` | 2026-11-04 | I5 进行中快照 |
| `HANDOFF-20261019.md` | 2026-10-19 | 旧交接 |
| `HANDOFF.md` | 2026-10 | 最早交接 |
| `E2E-AUDIT-2026-11-06.md` | 2026-11-06 | E2E 审计记录 |
| `FIRST-RUN-AUDIT-2026-11-06.md` | 2026-11-06 | 首轮黑盒验收 |
| `TODO-VERIFIED.md` | 2026-10-25 | 已被 BACKLOG 取代 |

> ⚠️ `TODO-VERIFIED.md` 里的「未完成清单」**已过期**，状态以 `BACKLOG.md` 为准。

---

## 六、已知文档漂移（别被误导）

| 文档说 | 实际 |
|---|---|
| `DESIGN.md` 提到 `js/image-scanner.js`、`bilibili.js`、`youtube.js` | **不存在**；能力在 `popup-videorod.js` / `x-button.js` / `js/yt/` |
| `TODO-VERIFIED.md` 列了一堆「未做」 | 多数已实现，见 `BACKLOG.md` §2026-11-06 核实 |
| 旧 README 说「YouTube 纯扩展基本无解」 | **已实现 1080p 下载**（SABR 只挡更高档位） |
| 旧 README 说去重/溯源「待施工」 | **均已实现**（`dedup.js` / `sw-library.js`） |
| 旧 README 说「27 个脚本、600+ 断言」 | 实际 **54 个脚本、1336 条断言** |
| 旧 README 说「60+ 条 ADR」 | 实际 **55 条** |
| `MEDIA-LIBRARY-PLAN.md` 的 `index.json` 方案 | 最终采用 **IndexedDB**（见 ADR） |

---

## 七、按用途快速定位

**我要接手这个项目**
→ `README.md` → 本文件 → `HANDOFF-2026-11-06-ROUND2.md` → `BACKLOG.md`

**我要改资源库 UI**
→ `DESIGN-SYSTEM-STAGE.md`（token）→ `deliverables/prototypes/media-library-stage-v1.html`（原型）→ `INTERFACE-CONTRACT.md`

**我要改下载链路**
→ `LIBRARY-PLAN.md`（目录规范）→ `js/background.js` → `TEST-PLAN-DOWNLOAD.md`

**我要查某功能做没做**
→ 先搜代码，再看 `BACKLOG.md`，**不要**只看 `TODO-VERIFIED.md`

**我要跑测试**
→ `TESTING.md` + `TEST-BROWSER.md`；命令见 README「开发与测试」
→ 资源库持久化专项（670 条断言）：`TESTING.md` §4.1

**我要改资源库持久化（快照/缩略图/备份）**
→ `LIBRARY-PERSISTENCE-SPEC.md`（格式与接口）→ `LIBRARY-SELF-CONTAINED-PLAN.md`（为什么这么做）
→ 改完必跑：`node tools/test-persistence.js`、`test-zip.js`、`test-backup-restore.js`

**我要调字号/图标**
→ `DESIGN-SYSTEM-STAGE.md` §2（正文 14 / 下限 11 / 图标 18）
→ `node tools/bump-type-scale.js <css> [--conservative]`（带幂等标记，重复执行会拒绝）

**我要知道某个决定为什么这么做**
→ `DECISIONS.md`（ADR-001 ~ ADR-055）

**我要搞清文件该放哪 / 为什么扩展体积虚胖**
→ `ARTIFACT-MANAGEMENT.md`（四类边界：源码 / `dist/` / `../work/` / 交付物）
→ 重新生成可加载目录：`node tools/build-dist.js`，然后在扩展页点「重新加载」
