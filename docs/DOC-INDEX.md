# 文档索引与可信度分级

> 更新：2026-11-06 晚 ｜ 共 **70 份**文档（新增 `IMAGE-SIDEBAR-AIX-ADOPT.md`）
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
| **`DECISIONS.md`** | 决策记录（56 条 ADR） | 每个「为什么」都有出处 |

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
| `IMAGE-SIDEBAR-AIX-ADOPT.md` | **图片侧边栏 + AIX/Fatkun 能力采纳清单**（ADR-058 配套：逆向对象、落地项、实测数字、踩坑） | S（2026-11-06 实测） |
| `IMAGE-*-RESEARCH/PLAN/IMPL.md` | 图片下载系列（调研→方案→实现） | I1–I5 已实现 |
| `INCIDENT-20261019-LIBRARY-DIR.md` | 媒体库目录限制复盘 | 教训仍有效 |
| `INVENTORY-2026-11-06.md` | 全面盘点 | 快照，会过期 |

---

## 四、P 级 · 规划（未实现部分属正常）

| 文档 | 内容 |
|---|---|
| `PLAN.md` | 方案书 v1.1 |
| `BUILD-PLAN.md` | 施工计划 M0–M11（+ M12 附录） |
| `BUILD-PLAN-STAGE.md` | 舞台换皮施工清单 |
| `REQUIREMENTS.md` / `REQUIREMENTS-CHECKLIST.md` | 需求规格 |
| `DESIGN.md` | 技术设计（部分模块名已漂移，见 §六） |
| `LIBRARY-PLAN-审计方案.md` | 方案审计 |
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

**我要知道某个决定为什么这么做**
→ `DECISIONS.md`（ADR-001 ~ ADR-055）
