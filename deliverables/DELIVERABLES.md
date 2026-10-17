# 钓鱼竿 Video Rod — 产出物管理规范

> 版本：v1.1 ｜ 日期：2026-10-17 ｜ 状态：✅ 已生效
> 一句话：**产出物有家、有版本、有状态、找得到。** 本文件是 deliverables/ 目录的宪法，新增任何产出物前先读这份。
> v1.1 变更：M2–M6 里程碑产出物批量登记（下载管线/站点增强/周边/打磨四组共 18 条）。

---

## 1. 目录结构总览（四类分离，各司其职）

```
video-rod/
├── README.md              # 🚪 门面：唯一项目入口，指向一切
├── docs/                  # 📐 工程文档：长期有效，随项目演进持续更新
│   ├── REQUIREMENTS.md    #   需求规格
│   ├── DESIGN.md          #   技术设计
│   ├── TESTING.md         #   测试策略
│   ├── DECISIONS.md       #   决策记录（ADR）
│   ├── PLAN.md            #   方案书（论证过程）
│   └── BUILD-PLAN.md      #   施工计划（M0-M6）
├── deliverables/          # 📦 产出物：有版本、有状态、需评审的实物
│   ├── DELIVERABLES.md    #   本规范（目录宪法）
│   ├── prototypes/        #   可交互原型（定交互/排版，不动源码）
│   ├── reviews/           #   评审/审计报告（日期化命名）
│   └── assets/            #   生成的静态资产（图标、预览图）
├── tools/                 # 🔧 工具脚本：纯脚本，不是产出物
└── archive/               # 🗄️ 归档：上游遗产+作废产出物，留证不删
```

**分类原则**（拿不准时对号入座）：
- 写「项目应该是什么样」→ `docs/`
- 做出来一个「能给苏哥看/能点/能用」的实物 → `deliverables/`
- 「跑一下干个活」的脚本 → `tools/`
- 「没用了但删了心虚」→ `archive/`

## 2. 命名规范

| 类型 | 位置 | 命名模式 | 示例 |
|---|---|---|---|
| 工程文档 | `docs/` | 大写下划线分类名，不带日期/版本 | `REQUIREMENTS.md`、`DESIGN.md` |
| 原型 | `deliverables/prototypes/` | `名称-vN.html`（N 从 1 递增，**保留最新，旧的进 archive/**） | `popup-prototype-v5.html` |
| 评审/审计 | `deliverables/reviews/` | `YYYY-MM-DD-主题.md`（日期即版本，不改写只追加新日期） | `2026-10-17-audit.md` |
| 静态资产 | `deliverables/assets/` | 小写中划线，带用途 | `icon-preview.png` |
| 工具脚本 | `tools/` | 小写中划线，带语言后缀 | `video-rod-icon.py`、`cdp-test.py` |
| 归档 | `archive/` | 原名 + 进 archive 时在文件名/目录名注明来源 | `archive/README-assets/`（猫抓 README 截图）、`archive/CHANGELOG.md`（上游日志） |

## 3. 版本与状态机

每个登记在册的产出物都有**状态**（记在 §4 登记表里）：

```
草案(Draft) ──提交评审──► 评审中(Review) ──苏哥拍板──► 已定稿(Approved) ──过期/被取代──► 已归档(Archived)
```

| 状态 | 含义 | 谁能改 |
|---|---|---|
| 草案 | 我在做，没给苏哥看过 | 我 |
| 评审中 | 已交付苏哥，等反馈 | 我改，苏哥看 |
| 已定稿 | 苏哥拍板，作为后续工作的基准 | **冻结**，要改必须走 ADR 新增决策记录 |
| 已归档 | 被新版本取代或使命结束 | 任何人都不改，只查阅 |

**版本号规则**：
- 原型：`vN` 整数递增，改交互/排版就 +1
- 文档（docs/）：内容演进不跳版本号，看 git 历史；重大重构在文档头版本行 +1（如 v1.0 → v1.1）
- 审计/评审：日期唯一，不改写历史报告（发现新问题写新日期文件）

## 4. 产出物登记表（新增必须登记）

| 产出物 | 路径 | 当前版本 | 状态 | 说明 |
|---|---|---|---|---|
| popup 交互原型 | `deliverables/prototypes/popup-prototype-v5.html` | v5 | 已定稿 | M1 面板施工基准；浏览器直接打开 |
| 外部审计报告 | `deliverables/reviews/2026-10-17-audit.md` | 2026-10-17 | 已定稿 | 3 硬阻塞已核验并落实到 ADR-018/019/020 |
| 图标预览图 | `deliverables/assets/icon-preview.png` | — | 已定稿 | 新图标三尺寸预览 |
| 方案书 | `docs/PLAN.md` | v1.4 | 已定稿 | 功能设计+竞品对标+决策记录；决策点全关闭 |
| 施工计划 | `docs/BUILD-PLAN.md` | v1 | 已定稿 | M0-M6，总工期 1.5-2 周；苏哥 10-17 批准开工 |
| 需求规格 | `docs/REQUIREMENTS.md` | v1.1 | 已定稿 | P0 11 项（F9 嗅探增强改版） |
| 技术设计 | `docs/DESIGN.md` | v1.1 | 已定稿 | 含 §6.5 增量盘点、§8 合并三路线 |
| 测试策略 | `docs/TESTING.md` | v1.1 | 已定稿 | 用例表+回归清单 |
| 决策记录 | `docs/DECISIONS.md` | v1.0 | 进行中 | ADR-001~024，追加式 |
| 智能起名引擎 | `js/naming.js` | v0.2 | 已定稿 | M0 产物；27/27 测试通过；M1 已接入 popup（新增 buildNameFromInfo） |
| 起名引擎测试 | `tools/test-naming.js` | v1.0 | 已定稿 | 27 条断言全绿；真实网址验证延至 M1 |
| popup 重设计三方向 | `deliverables/prototypes/popup-redesign-options-v2.html` | v2 | 评审中 | 浅色 A/B/C 三方案可点原型；行高 66px，6/12 条数据量切换（默认 12）；不改源码 |
| popup 重设计三方向（旧） | `deliverables/prototypes/popup-redesign-options-v1.html` | v1 | 已被 v2 取代 | 首版交付（6 条数据、行高 59px）；苏哥确认 v2 后按 §5.1 归档 |
| 重设计方案说明 | `deliverables/reviews/2026-10-17-popup-redesign.md` | 2026-10-17 | 评审中 | 调研依据 + 现状诊断 + 推荐 A + 10+ 滚动规则 + 落地契约 |
| popup 外壳 | `popup.html` + `css/videorod.css` | v1.0 | 已定稿 | M1 产物；按原型 v5 重写，功能钩子全保留 |
| popup 交互层 | `js/popup-videorod.js` | v1.1 | 已定稿 | M1 打底（v1.0）+ M2 下载管线 + M3/M4 站点增强 + M5 图片批量；`currentPageUrl()` 改走 `chrome.tabs.get` |
| M1 有头浏览器验收脚本 | `tools/cdp-m1-test.py` | v1.1 | 已定稿 | CDP 连有头 Chromium，DOM 断言+交互冒烟+状态截图；v1.1 增加 biliBanner/partChips/ytBanner 断言 |
| M1 面板截图 | `deliverables/assets/m1-panel-{list,settings,rename,dirmenu}.png` | 2026-10-17 | 评审中 | 有头浏览器四态实拍（列表/设置/命名弹层/目录菜单） |
| CDP 公用客户端 | `tools/cdp_client.py` | v1.1 | 已定稿 | `Cdp` 类 + `find_ext_id` + `open_popup`；v1.1 内建「新建标签页 + 禁缓存」修掉复用旧标签页嗅探为 0 的坑 |
| M2 下载管线验收脚本 | `tools/cdp-m2-test.py` | v1.0 | 已定稿 | 真落盘 + 去重 + 完成态；测完自动清理本次新增文件 |
| M3+M5 合并验收脚本 | `tools/cdp-m3-m5-test.py` | v1.1 | 已定稿 | B站分P横幅 + 图片弹层 + 图片真落盘（`VR_DL=1` 开启落盘）；v1.1 加 try/except+traceback，崩了留现场不再空文件 |
| M5b 秒存/快捷键验收脚本 | `tools/cdp-m5b-test.py` | v1.0 | 已定稿 | 走 `vrSaveContextMedia` 真实路径验右键秒存落盘；CDP 真实派发 Alt+Shift+V 验快捷键 |
| SW 状态诊断探针 | `tools/cdp-probe.py` | v1.0 | 已定稿 | 读 service worker 的 G/cacheData 状态，排查「嗅探为 0」类问题用 |
| M2 面板回归截图 | `deliverables/assets/m1-regress.png` | 2026-10-17 | 评审中 | M2 阶段复跑 M1 断言集的实拍（防重构改坏） |
| M3 B站分P横幅截图 | `deliverables/assets/m3-bili-banner.png` | 2026-10-17 | 评审中 | 12 分P横幅 + 展开态 |
| M4 YouTube 限制横幅截图 | `deliverables/assets/m4-yt-banner.png` | 2026-10-17 | 评审中 | 离线等效验证（域名映射）下的橙色警示横幅 |
| M5 图片弹层截图 | `deliverables/assets/m5-img-modal.png` | 2026-10-17 | 评审中 | 抓图弹层：2 张有效图（坏图/小图/重复图已滤掉） |
| HLS 流媒体回归截图 | `deliverables/assets/hls-regress.png` | 2026-10-17 | 评审中 | m3u8 双清晰度卡 + 清晰度下拉 |
| M6 全功能回归截图 | `deliverables/assets/final-{m1,hls,yt}.png` | 2026-10-17 | 评审中 | M6 从已提交状态重跑 M1 断言集的实拍：index.html / hls.html / notyoutube.com 三页，errors 均 0 |
| 测试站页面 | `test-site/{index,hls,bili-fake,images,yt-fake}.html` | 2026-10-17 | 已定稿 | 五类测试夹具：直链视频/HLS/B站分P/图片批量/YouTube（域名映射） |
| 右键秒存 + 快捷键 | `js/init.js` + `js/background.js` + `manifest.json` | v1.0 | 已定稿 | M5 产物；两个一级右键菜单 + `vrSaveContextMedia()` + Alt+Shift+V |
| README 使用说明 | `README.md` §使用说明 | v1.1 | 已定稿 | M6 产物；九节大白话完整指引（安装/日常/秒存/批量/B站/命名/设置/认账/快捷键） |
| 测试策略文档 | `docs/TESTING.md` | v1.2 | 已定稿 | M6 产物；补 M2–M5 冒烟记录 + 4 条测试环境限制 + 脚手架要点 |
| 施工计划检查站记录 | `docs/BUILD-PLAN.md` §六 | v1.1 | 已定稿 | M6 产物；M2/M3/M4/M5/M6 五个检查站全部填毕 |

> 登记规则：新产出物落地当天登记；状态变化当天更新；每完成一个 M 里程碑过一遍表。

## 5. 生命周期规则

1. **原型迭代**：新版直接覆盖旧版号位前的文件……不，**新版本建新号**（v6 就新建文件），旧版 `git mv` 进 `archive/prototypes/`，登记表更新路径
2. **文档定稿后要改**：走「ADEC 流程」——在 DECISIONS.md 追加一条 ADR 说明改什么、为什么，再改文档。保证「当初为什么这么定」永远可追溯
3. **审计/评审报告**：只追加不改写。新审计写新日期文件，老报告留着对照
4. **上游遗产**（cat-catch 的 README 多语言/截图/issue 模板/CHANGELOG）：已进 `archive/`，留证备查，不参与构建
5. **绝不随手删**：任何文件消失必须是「进了 archive」或「苏哥明确说可以删」

## 6. git 提交规则

| 规则 | 说明 |
|---|---|
| `.env` 等凭据 | 严禁入仓（.gitignore 已挡），泄了立刻去 GitHub 吊销重签 |
| 大文件（>1MB） | 图片/视频类产出物能压缩先压缩；确认不会频繁变的才进仓 |
| 生成物 | 图标预览图这类可再生成的产物，登记在册但可随时重生，不是源码 |
| 提交信息 | 说清「做了什么+为什么」，参照 git log 既有风格 |
| 每个 M 里程碑 | 一个提交节点，坏了能回滚 |

## 7. 本规范的维护

- 规范本身也要版本化（文档头版本行），改规范 = 在 DECISIONS.md 补一条说明
- 苏哥觉得哪条规则别扭，随时说，改规范比憋着遵守重要
