# 图片管线 v2 测试方案

> 日期：2026-11-13 ｜ 对应设计：`docs/IMAGE-PIPELINE-REDESIGN.md` ｜ 对应审计：`deliverables/reviews/2026-11-13-图片批量失败审计.md`
> 原则：**复用现有测试工具，不新造第二套框架**；真实登录态只读、单页、不进循环；批量下载回归全部在隔离实例上跑。

---

## 一、铁律（先于所有用例）

1. **真实登录态浏览器只许“看”**：不反复开关面板/弹窗、不循环刷新、不批量开关标签页、不在真实账号上跑批量下载（`docs/TESTING.md §0.0`）。
2. **一个页面测完就走**：真实站点只打开一次、只读一次、截图/记录后交还。
3. **批量下载/失败重试/落盘/去重**：只在隔离实例跑（`tools/e2e-all.py --isolated`，端口 9490，profile `.work/e2e-profile`，下载目录 `work/dl/isolated`）。
4. **实例闸门**：真实实例走 `tools/vr-session.py`；冷却 240 秒、每日启动上限 6 次、跑完不关（`docs/TEST-BROWSER.md` EL-01~EL-08）。
5. **收工精确回收**：隔离实例默认由 `e2e-all` 关闭；真实实例按需 `vr-session.py close`；收工复核 `left=0`，禁止 `taskkill /IM msedge.exe`。
6. **每条新断言必须有反证**：临时去掉对应修复，确认会红；把反证命令写进本文（沿用 `TESTING.md §4.16` 的做法）。

---

## 二、工具复用清单（不新增框架）

| 用途 | 现有工具 | 本次怎么用 |
|---|---|---|
| 一键体检 | `tools/health-check.py` | 冒烟/全量/`--live`；把图片批量套件纳入全量 |
| 套件编排 | `tools/e2e-all.py` | `--isolated` 跑批量；补 `VR_CDP`/`VR_DL_DIR` 注入 |
| 单张/扫描 | `tools/cdp-image-test.py` | 现有断言保留，补候选回退 |
| 批量落盘 | `tools/cdp-image-batch-test.py` | 现有 35 条保留，补 404/403/无后缀/同名/中断 |
| 面板 | `tools/cdp-image-panel-test.py` | 现有 46 条保留，补序号/失败态/重试 |
| 图集 | `tools/cdp-image-album-test.py` | 现有 40 条保留，补内部滚动/加载更多 |
| 抓图弹窗 | `tools/e2e-grab.py` | 现有 10 条保留，补“保存选中”落盘 |
| 真实页诊断 | `tools/diag-weibo-images.py`、`diag-weibo-sidebar.py` | 登录态只读扫描对照 |
| 真实站点清单 | `tools/live-sites.py` + `live-sites.json` | `local-image` 保持 required；批量另走隔离 |
| 视觉回归 | `tools/visual-baseline.py` | 侧栏/popup 改动后跑 |
| 断言契约 | `tools/check-assert-dom.py` | 新增/改 UI 后跑 |
| 单测 | `node tools/test-*.js` | 新增 `test-image-pipeline.js`、扩 `test-image-util.js` |

**禁止**：为图片管线新写一套“起浏览器 + 点页面 + 断言”的脚本；需要新场景时，在现有套件里加组/加夹具。

---

## 三、环境矩阵

| 层 | 实例 | 端口 | profile | 下载目录 | 能做什么 |
|---|---|---|---|---|---|
| L1 纯逻辑 | 无浏览器 | — | — | — | Node 单测：候选解析、命名、队列、去重快照、扫描通道 |
| L2 离线夹具 | 隔离 | 9490 | `.work/e2e-profile` | `work/dl/isolated` | 扫描/批量/落盘/重试/图集/面板，可反复跑 |
| L3 登录态只读 | 真实 | 9480 | `.edge-login-profile` | 不下载 | 打开一次真实页，只读扫描/截图/记录数量 |
| L4 真实批量（人工） | 真实或隔离 | 9480/9490 | 对应 | 用户指定 | 苏哥手动点一次；或隔离 + 公开页面小批量 |

> L3 不写盘、不点“下载/保存选中/全部下载”。L4 不由自动化反复执行。

---

## 四、夹具清单（放 `test-site/`，用现有 `http.server`）

| 夹具 | 覆盖 | 关键元素 |
|---|---|---|
| `pipeline-candidates.html` | 候选回退 | 首选 `/media/missing-404.png`，次选真实图；srcset 最大 404、次大可用；`a[href]` 是详情页 |
| `pipeline-auth.html` | 防盗链 403 | 服务端按 Referer 放行；无 Referer 403、带正确 Referer 200 |
| `pipeline-noext.html` | 无后缀 CDN | `/media/noext?id=webp` 返回 `image/webp`，URL 无扩展名 |
| `pipeline-dup.html` | 同名/内容重复 | 多张同标题、不同内容；两张同内容不同 URL |
| `pipeline-slow.html` | 超时/中断 | 一张延迟 10s，一张中途断开；用于超时/重试/取消 |
| `pipeline-iframe.html` | iframe | 主文档 3 张 + 子 frame 4 张（同源/跨源各一） |
| `pipeline-shadow.html` | Shadow DOM | open shadow root 内 3 张；closed 模式 1 张（页面注入钩子） |
| `pipeline-bg.html` | 背景/伪元素 | `background-image`、`::before content:url()`、`<video poster>`、SVG `<image>` |
| `pipeline-network.html` | 网络缓存 | 图片先由 JS `fetch`/`Image.src` 请求，再从 DOM 移除；只应靠网络通道扫到 |
| `pipeline-lazy.html` | 懒加载/尺寸 | 800×600 缩到 320px 展示；未解码图；`data-src` 占位 |
| `pipeline-batch-many.html` | 大批量 | 200 张，用于并发/断点/进度/取消 |

服务端：`python -m http.server 18080 --directory test-site`；403 用同源 Python 小服务或 `fetch` 拦截模拟，不引入新框架。

---

## 五、用例与断言

### 5.1 L1 单测（Node）

新增/扩展：

- `tools/test-image-pipeline.js`
  - `P-01` 候选顺序：首个 404 → 第二个命中；全失败 → `IMG_E_CANDIDATE_ALL_FAILED`。
  - `P-02` 内容类型：`image/webp` → `.webp`；`text/html` → 拒绝。
  - `P-03` 命名：同标题多张生成 `_01/_02`；空标题回退；双扩展名不出现。
  - `P-04` 队列：并发上限、失败不中断、取消、断点续跑、上限截断。
  - `P-05` 去重快照：同 canon URL 命中；幽灵记录（size=0）不拦。
  - `P-06` 失败码：每个码都有 UI 文案与是否重试的映射。
- `tools/test-image-util.js` 扩展
  - `S-01` 全属性：`data-original`/`style=url()`/`srcset` 最大项。
  - `S-02` 背景：`background-image` + 伪元素 + `video poster`。
  - `S-03` 门槛：显示 40px、原图 1200px 的图**不被采集丢弃**，只标 `tiny`。
  - `S-04` 占位回退：1×1 + `data-src`。
  - `S-05` URL == 当前页面丢弃。
- `tools/test-download-scan.js` 扩展
  - `S-06` 源码/JSON 通道补充，不重复。

### 5.2 L2 隔离实例 e2e（复用现有套件）

| 组 | 套件 | 断言 |
|---|---|---|
| A | `cdp-image-batch-test.py` | 现有 A~J 35 条 + 新增：候选 404 仍成功、403 走兜底、内容校验拒绝 HTML、同名不覆盖、中断可续、失败可重试 |
| B | `cdp-image-panel-test.py` | 现有 46 条 + 新增：批量带序号、失败卡片态、重试、真实落点 |
| C | `cdp-image-album-test.py` | 现有 40 条 + 新增：内部滚动容器、加载更多、连续失败停 |
| D | `cdp-image-test.py` | 现有单张 + 扫描；补候选回退、`vrImg.resolve` 与批量同口径 |
| E | `e2e-grab.py` | 现有 10 条 + 新增：保存选中落盘 N 张、失败提示、二次点击不跳过失败项 |
| F | 新增组（仍放现有套件内） | iframe 4 张、shadow 3+1 张、伪元素 1 张、网络缓存 1 张；四入口数量一致 |

命令：

```bash
python tools/e2e-all.py --isolated --only cdp-image-test,cdp-image-batch,cdp-image-panel,cdp-image-album,e2e-grab
```

> 前置：`e2e-all.py` 的 `run_suite` 必须注入 `VR_CDP=http://127.0.0.1:<port>` 和 `VR_DL_DIR=<work/dl/isolated>/...`；四个 `cdp-image-*` 套件必须读 `VR_CDP`/`VR_DL_DIR`，不能默认 9222 / 真实下载目录。此条是阶段零的脚手架验收项。

### 5.3 L3 登录态只读（真实站点）

| 站点 | 页面 | 做什么 | 记录 | 禁止 |
|---|---|---|---|---|
| 微博 | 首页或指定博主页（一次） | 打开侧栏，只读扫描一次；截图 | 扫描数、来源分布（DOM/网络/源码）、尺寸未知数、控制台错误 | 不点批量、不刷新、不反复开关 |
| 小红书 | 一条图文笔记（一次） | 同上 | 同上 + 是否扫到正文全部图 | 不点批量、不切换笔记 |
| 抖音 | 一条图文作品（一次） | 同上 | 同上 + 轮播背景图 | 不点批量、不循环播放 |
| 花瓣 | 一个 pin 页（一次） | 同上（公开页，可隔离实例） | 同上 | — |

命令：

```bash
python tools/vr-session.py status
python tools/vr-session.py ensure --reason "图片扫描只读诊断"
python tools/diag-weibo-images.py --url https://weibo.com/
python tools/diag-weibo-sidebar.py --port 9480
```

> 这些诊断脚本是既有工具，只读；不要改成会点下载的脚本。

### 5.4 L4 真实批量（人工）

- 由苏哥在真实登录态手动点一次「全部下载」/「保存选中」，张数控制在 3~5 张。
- 记录：落盘路径、文件名、扩展名、文件头、库内条目。
- 自动化不重复执行；测试报告注明“人工验收”。

---

### 5.5 阶段零基线（2026-11-13 隔离实例实测）

> 命令：`python tools/e2e-all.py --isolated --only <套件> --reason "图片管线脚手架验证"`
> 实测时间：2026-11-13 02:14–02:30；隔离实例 9490、profile `work/e2e-profile`、下载目录 `work/dl/isolated`。

| 套件 | 结果 | 说明 |
|---|---|---|
| `cdp-image-batch` | **35/35** | 端口/下载目录注入后全绿；D6/D7/D9/F2/F3 的旧口径已修（递归扫描 `video-rod`、D7 改判资源库路径、F2 允许“已下载 2 张，已存在跳过 N 张”） |
| `cdp-image-panel` | **46/46** | H3 改为按 basename 判日期前缀；重试后全绿（第二次曾因 CDP 截图超时抖一次，非断言） |
| `cdp-image-test` | **31/32** | 仅 `G2 下载完成` 红：`#lazy`（`data-original-src`）点击后未产生新下载 → **阶段二候选/落盘输入**，不在阶段零修 |
| `cdp-image-album` | **35/40** | B7/C6/C7/D3/D4/D6：图集收集数超页面有效图、UI 文案、滚动收集不全/落盘 → **阶段一图集重构输入** |

**阶段零已完成的脚手架修正**：

- `tools/cdp_client.py`：`Cdp()` 每次读 `VR_CDP`（不再固定 import 时的 9222）。
- 四个 `cdp-image-*` 套件支持 `--port`；`e2e-all.run_suite` 注入 `VR_CDP` 与 `VR_DL_DIR`。
- `batch`/`panel` 的落盘扫描改为递归 `work/dl/isolated/video-rod`，默认值不再指向真实 Downloads。
- 补 `test-site/media/icon.svg`（原夹具列表有、磁盘缺失，导致 A2/D0 红）。
- `batch` D7 改判 `video-rod/<站点>/...`（`path.js:259-265` 已明确不再写 `图片/` 段）。

**结论**：脚手架可用，批量/面板全绿；test 的 G2、album 的 5 条是真实产品缺口，按阶段一/二修，不作为阶段零失败。

---

## 六、反证要求

每条关键修复必须有“去掉就红”的反证：

| 修复 | 反证方法 | 期望 |
|---|---|---|
| 候选回退 | 把 `resolveCandidates` 改回只用 `item.url` | `P-01` / 批量 A 组红 |
| 内容校验 | 关闭图片头校验 | 403/HTML 夹具红（`IMG_E_CONTENT_INVALID` 断不到） |
| 幽灵记录校验 | 去掉 `vrEntryFileAlive` | 批量全部跳过，D 组红 |
| 命名序号 | 面板批量 title 去掉序号 | 同名覆盖/数量不符，B 组红 |
| FSA 强制 | 恢复静默回退 downloads | 落盘路径断言红（不在资源库目录） |
| 网络缓存 | 关 `imgSniff` | 网络缓存夹具扫不到，F 组红 |
| iframe | `allFrames:false` | iframe 夹具少 4 张，F 组红 |
| 显示尺寸不丢图 | 恢复 `LIST_MIN_SHORT=80` 采集丢弃 | 40px 显示/1200px 原图夹具少 1 张，S-03 红 |

反证命令写进 `TESTING.md §4.17`，并附“改哪一行、期望哪条红”。

---

## 七、门禁接入

1. `tools/e2e-all.py` 的 `SUITES` 增加：
   - `cdp-image-test`
   - `cdp-image-batch`
   - `cdp-image-panel`
   - `cdp-image-album`
2. `run_suite` 注入：
   - `env["VR_CDP"] = "http://127.0.0.1:%d" % port`
   - `env["VR_DL_DIR"] = os.path.join(work_root(), "dl", "isolated", ...)`
3. `health-check.py` 的全量单测自动发现 `test-image-pipeline.js`；界面套件通过 `e2e-all` 跑。
4. `live-sites.json`：
   - `local-image` 保持 `required:true`，断言从 2 张扩到“有效图 2 张 + 无裂图 + 尺寸回填”。
   - 新增 `local-image-pipeline`（可选 required）：批量夹具跑 5 张落盘、候选回退 1 张。
5. `visual-baseline.py`：侧栏/抓图弹窗改动后跑，差异 >0.15% 先人工确认再 `--update`。

---

## 八、报告与证据

- 批次报告：`deliverables/test-runs/<时间>-e2e-all.md`；分套件日志 `deliverables/test-runs/parts/<suite>.log`。
- 体检报告：`deliverables/test-runs/health-<时间>.md`。
- 截图：`deliverables/assets/`，命名 `2026-11-13-image-pipeline-<场景>.png`。
- 真实站点只读记录：`deliverables/reviews/2026-11-13-图片管线真机只读记录.md`（数量/来源分布/截图/控制台错误）。
- 反证记录：写进 `TESTING.md §4.17`，包含命令与期望红。

---

## 九、收工检查

```bash
python tools/vr-session.py status          # 真实实例：在线/今日启动次数/冷却
# 隔离实例由 e2e-all 自动关闭；如保留：
# python tools/test-browser-close.py --port 9490
# 复核 left=0（按 profile 关键字）
```

- 隔离 profile `.work/e2e-profile` 跑完删除（`e2e-all` 默认）。
- 隔离下载目录 `work/dl/isolated` 的测试产物清掉，不进入真实库。
- 真实 profile 不删、不换名、不备份到仓库。
- 报告与截图落 `deliverables/`，源码目录不留临时脚本。

---

## 十、阶段验收清单

- [ ] `e2e-all --isolated` 能跑四个图片套件，端口/目录正确。
- [ ] 批量夹具：候选 404 仍成功；403 兜底；无后缀 webp 扩展名正确；同名不覆盖；中断可续；失败可重试。
- [ ] 扫描夹具：iframe/shadow/伪元素/网络缓存四类都扫到；四入口数量一致。
- [ ] FSA 未授权：批量被阻止并显示授权入口；不产生浏览器下载目录文件。
- [ ] 登录态只读：微博/小红书/抖音/花瓣各一次，记录完整，无批量点击。
- [ ] 每条新断言有反证记录。
- [ ] `health-check --full` 全绿；`health-baseline.json` 未新增豁免。
- [ ] 文档同步：`TESTING.md §4.17`、`BACKLOG`、`DECISIONS`、`DOC-INDEX`。
