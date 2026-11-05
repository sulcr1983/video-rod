# 文档索引与可信度分级

> 更新：2026-10-25 ｜ 用途：接手时先看这份，知道**哪份文档能信、哪份只能当历史看**
>
> 项目里文档有 30+ 份，但**性质不同**。混着读会被过时信息误导（本轮已踩过）。

---

## 一、分级标准

| 级别 | 含义 | 能不能当现状用 |
|---|---|---|
| **S** 权威 | 由代码实测/核查得出，随时可复现 | ✅ 能 |
| **A** 现状 | 描述当前实现，但需偶尔核对 | ⚠️ 大体能，关键处核对代码 |
| **P** 规划 | 早期设计/计划，**未实现的部分属正常** | ❌ 只能当「当初想做什么」看 |
| **H** 历史 | 决策记录、审计过程、阶段性交接 | ❌ 只当「为什么这么定」看 |

---

## 二、S 级：权威（可直接信）

| 文档 | 内容 | 为什么权威 |
|---|---|---|
| **`TODO-VERIFIED.md`** | 未完成清单 | 2026-10-25 逐项用代码核实 |
| **`TESTING.md`** | 测试策略与用例 | 基线数字来自 `--suite full` 实测（20 套 / 574 条） |
| **`DEPENDENCY-EVAL-FLOATING-UI.md`** | 浮层定位依赖评估 | 含实际落地参数与踩坑记录 |
| **`RESEARCH-COMPETITOR-IMAGE.md`** | 竞品逆向 | 基于两个开源项目源码 + 提交记录 |
| **`YT-CLIENT-STATUS.md`** | YouTube 客户端实测 | 带时间戳的真机实测结果 |

---

## 三、A 级：现状（大体可信）

| 文档 | 内容 | 注意 |
|---|---|---|
| **`HANDOFF.md`** | 交接主文档 | §7 有过时内容，已加警告指向 TODO-VERIFIED |
| **`IMAGE-I1I2-IMPL.md`** | 图片悬停实现 | 实现细节准；DNR 坑必读 |
| **`IMAGE-I3-IMPL.md`** | 图片批量实现 | 同上 |
| **`IMAGE-I4-IMPL.md`** | 清单面板实现 | 实现细节准；**浮标现已默认关闭**（`imgPanel: false`），该文档未提默认值，以代码为准 |
| **`IMAGE-I5-IMPL.md`** | 设置项与快捷键 | 已补 `imgBgScan`，`imgPanel` 默认值已修正 |
| **`PRODUCT-IMAGE-ENTRY.md`** | 图片入口产品方案 | 含已落地改动 |
| **`DECISIONS.md`** | ADR 决策记录 | 早期条目是历史背景，结论仍有效 |

---

## 四、P 级：规划（未实现属正常）

| 文档 | 内容 | 未实现部分 |
|---|---|---|
| **`LIBRARY-PLAN.md`** | 资源库主线方案 | `archive.js`（B 模式）、`bridge.js`（能力已并入） |
| **`IMAGE-DOWNLOAD-PLAN.md`** | 图片下载总方案 | I6 图集：模式 A（滚动）已落地，B（翻页）/C（站点 API）未做 |
| **`DESIGN.md`** | 早期设计稿 | `image-scanner.js` / `bilibili.js` / `youtube.js` 都换了落点，已加阅读须知 |
| **`BUILD-PLAN.md`** | 构建计划 | 构建链未建（无 `package.json`） |
| **`FRONTEND-UI-SYSTEM.md`** | UI 体系 | 部分设想未落地 |
| **`MOBILE-RESEARCH.md`** | 移动端调研 | 纯调研，无实现 |

> ⚠️ 读 P 级文档时记住：**看到「（新）」就是「当时计划」，不代表现在有**。

---

## 五、H 级：历史（只当背景）

| 文档 | 内容 |
|---|---|
| **`HANDOFF-I5-WIP.md`** | I5 中途交接（已过时） |
| **`AUDIT-I5-WEIBO-PLAN.md`** | 微博适配审计 |
| **`IMAGE-DOWNLOAD-RESEARCH.md`** | 早期调研 |
| **`IMAGE-AUTO-INDEX-RESEARCH.md`** | 自动索引调研 |
| **`YT-FEASIBILITY.md`** | YouTube 可行性论证 |
| **`REF-YTB-TUBLY.md`** | 参考项目分析 |
| **`S5B-BATCH-RENAME.md`** | S5b 专项记录 |
| **`LIBRARY-PLAN-审计方案.md`** | 外部审计方案 |
| **`PLAN.md`** / **`REQUIREMENTS.md`** | 最初的需求与计划 |

---

## 六、怎么保持同步

**已内置检查工具**：

```bash
python tools/check-doc-sync.py     # 核查文档引用的文件是否存在
python tools/cdp-run.py --suite docs   # 走启动器（同上）
```

**它做什么**：
- 扫描 `docs/*.md` 里所有 `js/xxx.js` 引用
- 区分四类：正常 / 元引用（在说明某文件去向）/ 位置变更 / 失效
- 当前结果：**53 个引用，46 个存在，0 失效，0 位置变更** ✅

**判定规则**（避免误报）：
- 行内含「不存在 / 原计划 / 实际路径 / 并入 / 移到」→ 元引用，不算失效
- `js/hls.js` 实为 `lib/hls.min.js` → 省略 `.min` 的第三方库，不算失效
- 设计文档里的「（新）」→ 规划项，不算失效

**维护约定**：
1. 改了文件名 → 同步更新文档，或在 `MOVED` 表里登记
2. 新增未实现的功能 → 在 `NOT_IMPLEMENTED` 里登记，并在 `TODO-VERIFIED.md` 记一条
3. 提交前跑一次 `--suite docs`，别让漂移积累

---

## 七、2026-11 舞台重设计套件（ADR-052 重写路线，读到先看这节）

> 这批是"用户拍板过的产品真源"，**优先级高于旧计划文档**。旧文档若与之冲突，以本节为准。

| 文档/文件 | 级别 | 内容 | 用法 |
|---|---|---|---|
| `deliverables/prototypes/media-library-stage-v1.html` | **S** | 媒体库完整可交互原型（4313 行，CDP 验证过） | **产品真源**，施工照此复刻 |
| `deliverables/prototypes/popup-stage-v1.html` | **S** | popup 舞台版原型（462 行） | popup 重写真源 |
| `deliverables/prototypes/settings-stage-v1.html` | **S** | 设置页舞台版原型（884 行） | 设置页重写真源 |
| `docs/DESIGN-SYSTEM-STAGE.md` v1.1 | **S** | 舞台 token + 组件规范 + **DOM 骨架** | 视觉/结构唯一真源 |
| `docs/BUILD-PLAN-STAGE.md` v2.0 | **S** | 重写路线施工清单（R0-R8/T3/T4/F/V） | 施工顺序唯一真源 |
| `docs/PROTOTYPE-MAPPING.md` v2.0 | **S** | **原型复刻规范**：数据契约（VRDB→卡片模型）、模块处置、mock→真实接入点、平台字典缺口 | 重写必读；v1.0 已作废 |
| `docs/TEST-ASSETS.md` | **S** | 9 条真实测试素材 + 星愿 CDP 测试方法 | V 批次执行依据 |
| `deliverables/reviews/2026-11-04-library-redesign-directions*.md` | **H** | 九方向评审稿（暗房/档案室/仪表盘/舞台/目录/天文台/宋册/唱片墙/标本柜） | 只当"为什么选舞台"背景 |
| `deliverables/prototypes/library-redesign-options-v1.html` | **H** | 九方向速选页 | 历史 |

**已作废**：`PROTOTYPE-MAPPING.md` v1.0（"改视觉补缺口"路线）、BUILD-PLAN-STAGE v1.x 的 T1/T2"换皮/结构同步"措辞。

