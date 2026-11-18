# 文档全景 · 该读哪份、可忽略哪份

> 更新：2026-11-18（文档收敛后）
> 用途：**取代「从头读 87 份」**。先看本文确定路径，再按需展开。
>
> **🚨 一进项目先读 `docs/MAIN-TRACK.md`**：它是**主线的唯一进度真源**——
> 已完成什么、还差什么、哪 6 个问题等你拍板，都在那一份里。
> 本文件解决的是「文档该读哪份」，MAIN-TRACK 解决的是「项目走到哪了」。

---

## 〇、三条阅读路径（按你的目的选）

| 你要做什么 | 按顺序读这三份 |
|---|---|
| **想知道「系统现在是什么样」** | `docs/current/*-STATUS.md`（6 份，每份 200 行内） |
| **想知道「为什么这么设计」** | `DECISIONS.md`（按编号查）→ `docs/archive/` 里的原始长文 |
| **要知道「现在还有什么没做/有问题」** | `BACKLOG.md` → `ARCHITECTURE-HEALTH-AUDIT.md` §5 |

---

## 一、必读（6 份，共约 1,300 行）

| 文档 | 内容 | 何时读 |
|---|---|---|
| `README.md` | 产品定位、能力清单 | 第一次接触 |
| `docs/DECISIONS.md` | **105 条 ADR**，每条「为什么」 | 改任何设计前 |
| `docs/BACKLOG.md` | **待办唯一真源** | 决定做什么 |
| `docs/INTERFACE-CONTRACT.md` | 前后交互契约、字段权威表 | 改消息/字段前 |
| `docs/ARCHITECTURE-HEALTH-AUDIT.md` | **本次审计**：架构判断、P0–P3 | 判断是否重构 |
| `docs/DOWNLOAD-PIPELINE.md` | 下载主链路：三条主干 + 13 入口 | 改下载前 |

---

## 二、领域现状（6 份，**新汇编**，每份 200 行内）

| 文档 | 覆盖 | 合并自 |
|---|---|---|
| `docs/current/YOUTUBE-STATUS.md` | YouTube 现状、卡点、演进链 | 9 份 → 1 |
| `docs/current/IMAGE-STATUS.md` | 图片四入口、设计决策、9 条踩坑 | 12 份 → 1 |
| `docs/current/LIBRARY-STATUS.md` | 资源库：磁盘契约、索引、溯源、查看器 | 16 份 → 1 |
| `docs/current/UI-STATUS.md` | 设计系统、token、依赖决策 | 10 份 → 1 |
| `docs/current/COMPETITOR-STATUS.md` | 竞品格局、三个可用发现、不抄清单 | 8 份 → 2 |
| `docs/current/TEST-STATUS.md` | 测试分层、门禁缺口、必跑组合 | 7 份 → 2 |

> **每份都标了原始出处。** 需要完整论证时，按出处去 `docs/archive/` 回溯。

---

## 三、设计与规范（4 份，保留在主目录）

| 文档 | 为什么留在主目录 |
|---|---|
| `docs/DESIGN-SYSTEM-STAGE.md` | **自称「全站视觉唯一真源」**，施工必查 |
| `docs/LIBRARY-PLAN.md` | 资源库权威方案 v1.5（目录规范、数据模型、迁移） |
| `docs/LIBRARY-PERSISTENCE-SPEC.md` | **S 级权威**：存储格式、接口契约 |
| `docs/FRONTEND-UI-SYSTEM.md` / `docs/OPTIONS-REDESIGN.md` | token/组件/设置页 IA |

---

## 四、测试（3 份，铁律类，保留）

| 文档 | 内容 |
|---|---|
| `docs/TESTING.md` | 测试策略 + 全部验收记录（1985 行） |
| `docs/TEST-ASSETS.md` | 真实 URL 素材登记 |
| `docs/TEST-BROWSER.md` | **登录态铁律**（违反会触发风控） |

---

## 五、本次新增（7 份）

| 文档 | 内容 |
|---|---|
| `docs/ARCHITECTURE-HEALTH-AUDIT.md` | 架构健康审计（891 行） |
| `docs/COMPETITOR-BATCH-ENUM.md` | **整博主批量协议实证**（抖珍藏/Plucker/爱哔哔） |
| `docs/ENUMERATE-LAYER-DESIGN.md` | 枚举层架构设计（4 段式） |
| `docs/current/*-STATUS.md` | 6 份领域汇编 |
| **`docs/research/extensions/`** | **竞品 12 家拆解（40 份 / 6910 行）**，见下 |
| **`docs/COMPETITOR-GAP-DIAGNOSIS.md`** | **竞品发现 → 功能块对照诊断**（223 行） |
| **`docs/REVIEW-LOCAL-VS-OFFLINE-LIBRARY.md`** | **本地库 vs 离线库评审**（250 行） |
| **`docs/RESEARCH-BILIBILI-WBI.md`** | **B站 wbi 核实**：取流不需要、枚举必需（实测） |
| **`docs/ARCHITECTURE-DIAGRAMS.md`** | **架构图 6 张**（全景/下载链路/回收站状态机/枚举层/离线库/数据模型） |

### 5.1 竞品拆解目录结构（`docs/research/extensions/`）

| 文件 | 说明 |
|---|---|
| `README.md` | **索引入口**：总表 + 七维对比 + 按问题索引 + 方法论 |
| `DEEP-01` ~ `DEEP-12` | **12 家深度拆解**（3059 行，本次主体） |
| `AIX-原图派生规则表.md` | 62 条「缩略图→原图」规则全表 |
| `VDH-下载协议与状态机.md` | 三态返回 + 15 种 HLS 标签 |
| `DouZhenCang-媒体库与目录状态机.md` | 7 表模型 + 10 种目录状态 |
| `ANALYSIS-01` ~ `ANALYSIS-12` | 工具生成的机器提取报告 |
| `01-*.md` ~ `12-*.md` | 第一轮拆解（4 份有误判，已加更正标注） |

**读法**：先看 `README.md` 的「按我们的问题索引」，直接定位到对应章节，不必从头读。

---

## 六、计划/方案类（7 份，**保留但降级**）

这些被 `BACKLOG` / `DECISIONS` / 审计报告引用，**归档会造成断链**，所以留在主目录，但**不代表当前状态**：

| 文档 | 真实地位 |
|---|---|
| `EXECUTION-PLAN-20261108.md` | 执行真源（Q-01~Q-15） |
| `PLAN.md` | 方案书 v1.1（执行地位被上一份取代） |
| `BUILD-PLAN.md` / `BUILD-PLAN-STAGE.md` | 施工计划（历史） |
| `REQUIREMENTS.md` / `REQUIREMENTS-CHECKLIST.md` | 需求规格（历史） |
| `FUNCTION-AUDIT-ENTRY.md` | 入口层审视 |

**判断规则**：这些文档里写的「未做/计划中」，**先去代码搜一眼再信**。

---

## 七、其余（约 8 份，低频）

| 文档 | 何时读 |
|---|---|
| `ARTIFACT-MANAGEMENT.md` | 构建/交付边界（`dist/` 纪律） |
| `SNIFF-RULES.md` | 改嗅探规则时 |
| `DEDUP-REF-DESIGN.md` | 改去重/引用时 |
| `VIDEO-XHS-ENHANCEMENT.md` | 改小红书/清晰度排序时 |
| `WEIBO-ALBUM-PLAN.md` | 改微博时 |
| `HLS-SITE-DIAGNOSIS.md` | HLS 站点出问题时 |
| `UX-ADVERSARIAL-REVIEW-2026-11-06.md` | 22 条 UX 问题（仍有效） |
| `UI-POLISH-2026-11-06.md` | UI 打磨快照（会过期） |

---

## 八、已归档（`docs/archive/`，**不要再当现状读**）

**归档总数：60 份。** 分类：

| 类别 | 份数 | 代表 |
|---|---|---|
| 交接文档 | 5 | `HANDOFF*.md` |
| 阶段快照 | 6 | `STATUS-*` / `MERGE-*` / `READINESS-*` / `INVENTORY-*` |
| 审计留痕 | 4 | `E2E-*` / `FIRST-RUN-*` / `TODO-VERIFIED` |
| 图片线原件 | 11 | `IMAGE-I1I2/I3/I4/I5` / `IMAGE-PIPELINE-REDESIGN` |
| 资源库原件 | 14 | `LIBRARY-STANDALONE` / `MEDIA-VIEWER` / `S5B-BATCH` |
| YouTube 原件 | 10 | `YT-FEASIBILITY` / `YT-DELIVERY` / `YOUTUBE-QUEUE-*` |
| UI 原件 | 7 | `DESIGN.md` / `DESIGN-SYSTEM-BD` / `BEUI-EVAL` |
| 竞品原件 | 5 | `COMPETITOR-EXTENSIONS` / `COMPETITOR-PLUCKER` |
| 测试原件 | 4 | `TEST-PLAN` / `TEST-MATRIX-P0` |

**归档不等于删除**：全部 `git mv`，`git log --follow` 可追溯。

---

## 九、已知文档漂移（别被误导）

| 文档说 | 实际 |
|---|---|
| `DESIGN.md` 提到 `js/image-scanner.js` / `bilibili.js` / `youtube.js` | **都不存在**，能力在 `popup-videorod.js` / `x-button.js` / `js/yt/` |
| ADR-043 说「YouTube 入口彻底移除」 | **已被推翻**，`js/yt/` 完整存在（已加标注） |
| ADR-018/021 说「在线 FFmpeg」 | **已作废**，改为离屏直连（已加标注） |
| `README.md` 说 30 套件 / 1426 断言 | 实测 **43 套件 / 约 1348 断言** |
| `DOC-INDEX.md` 自身 | **漏收录 17 份现行文档**（见其 §五之二） |

---

## 十、维护规则（防止再次膨胀）

1. **新文档必须先回答「它取代谁」**——否则不建
2. **同主题超过 3 份就汇编**——不要累积成编年史
3. **领域现状只维护 `docs/current/*-STATUS.md`**——原件进 archive
4. **ADR 只加不改**——失效就加标注，不删原文
5. **`BACKLOG.md` 是待办唯一真源**——其他文档不写待办状态