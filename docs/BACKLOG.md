# 待办真源（BACKLOG）

> **唯一真源。** 全项目「还没做完的事」只在这里登记、只在这里改状态。
> 其它文档（HANDOFF / BUILD-PLAN / DECISIONS / TESTING / DELIVERABLES）里的待办条目一律视为**历史记录**，不写状态；要查当前状态，回到本文件。
>
> **判据**：只有「① 会影响苏哥拿到坏结果」或「② 阻塞后续决策」才进 P0。其它一律往下压。
>
> 最后更新：2026-11-06 晚（图片侧边栏 + AIX/Fatkun 能力面已实施，见 ADR-058；新增 B-26~B-29）
> 上一版：2026-11-05（ADR-050 四悬项拍板：B-08/B-12/B-18 阻塞解除，B-01/B-02 素材改公开测试料；**测试素材已登记 `TEST-ASSETS.md`（A1-A7），测试方法=星愿+CDP 主方案**）
> **施工顺序指针（2026-11-04 ADR-049）**：舞台换皮施工期，B-01~B-18 全部已映射进 `BUILD-PLAN-STAGE.md`（§5 全覆盖核对表）。**状态真源仍是本文件**；开工顺序、依赖与验收标准以 BUILD-PLAN-STAGE 为准。

---

## P0 · 会影响结果正确性

| # | 任务 | 为什么是 P0 | 阻塞条件 | 验收方式 | 出处 |
|---|---|---|---|---|---|
| B-01 | **AES-128 真实加密 HLS 真机验证** | 代码已写（`js/m3u8-merge.js:121 decryptAes128`，WebCrypto AES-CBC + PKCS7，IV 缺省用媒体序列号），**只在裸 TS 测试站验过**。真实站点多为 AES-128，一旦解错就是**整片花屏/乱码**，而且用户会以为视频本身坏了 | **需要苏哥给一条真实加密流地址** | 走现有离屏管线合并 → ffprobe 验编码/时长 → 抽帧目视无花屏 | BUILD-PLAN M11；DECISIONS:235；**素材改公开测试流（ADR-050），设计线找料登记地址** |
| B-02 | **小红书图片「去 CDN 后缀取更大图」真机验证** | ADR-044 已实现去后缀优先 + 失败回退，但**没有任何真实图文笔记样本**。可能拿到 404，也可能后缀去掉后尺寸没变 | 需要一条真实图文笔记 URL | 记原始地址 / 去后缀地址 / 落盘字节数 / 实际分辨率四项对比 | ADR-044；HANDOFF §5；**✅ 素材已由苏哥提供（2026-11-05）：`TEST-ASSETS.md` A2（图文笔记）+A1（图片+视频），可直接开工** |
| B-07 | **媒体溯源元数据（A 档，预研完成待批）** | 现在只靠目录名反推，作品页/博主主页/直链全丢；晚一天做，那天的下载就永久补不回来。**2026-11-04 预研结论：能做、半天工作量，埋点统一收在 `vrDownloadWithName` 漏斗（try/catch 全包）；另发现既有隐患：`pageUrl` 已入库但重建索引会整列丢失（indexer.js:246-261 白名单缺），必须随施工一起修** | 预研已出（`docs/PREWORK-PROVENANCE.md`），等苏哥批准后施工 | META-1~7 七条用例，重点 META-6：埋点异常不得影响下载 | 2026-11-04 苏哥拍板 A 档 |
| B-09 | **合并后实机验证（P0，未验不能推 master）** | 41e1d80 合并了两条线，静态检查全过但**没在浏览器里跑过**；扩展能否加载、F 盘 19 项素材能否被新版资源库识别、两个浮层是否打架，全未知 | 需要 Chrome for Testing（正在下载）或苏哥在星愿里重载 | 扩展 SW 无报错；打开资源库能列出 19 项；页面只有一个浮层 | MERGE-20261104 §3 G-3/G-4 |
| B-10 | **标签：补 UI 入口（不是重做）** | 实测 `indexer.js:228` 有 `tags: []`、`mergeEntry` 会保住 `old.tags`、`db.js` 建了索引——**数据层是通的，缺的是界面入口**（信息栏没有标签区、卡片不显示标签） | 依赖 B-09 通过 | 预览页能加/删标签并落库；重建索引后标签不丢；**标签旁带计数徽标（booru 帖数计数，LIBRARY-BENCHMARK §B）**；数据模型预留 parent/alias（TagStudio） | `PROTOTYPE-MAPPING.md` §6 |
| B-11 | **分辨率回写（有时间窗，别拖）** | `lightbox.js:256` 把「尺寸」写死成 `'—'`；`indexer.js` 从未写入 `width/height`；但 `thumbs.js:124/128` 生成缩略图时**能拿到 `naturalWidth`/`videoWidth`**——那是唯一一次能看到真实分辨率的时机。索引建完就不再解码文件，**之后再补要把全库重新解码一遍** | 无（随时可做，越早越省事） | 重建索引后，信息栏「分辨率」显示真实宽×高；抽 3 个不同尺寸文件核对 | `PROTOTYPE-MAPPING.md` §2.1 |
| B-14 | **虚拟滚动 / 首屏分页（大数据量的硬门槛）** | 实测：5 万条元数据只占 20.6 MB、`getAll` 833 ms、索引查询 153 ms——**数据库完全没问题**；但全量渲染要 **65 万 DOM 节点、光布局 3.29 s**，10 万条直接跑崩。不修的话库一大就没法用 | 无（可独立开工） | 5 万条首屏渲染 < 100 ms；滚动不卡；侧栏计数/概览仍正确。**施工拆解含 Pinterest 式分级加载：低清占位（存宽高免跳动）→懒加载缩略图→预览才取原图（LIBRARY-BENCHMARK §B-P0）** | `READINESS-20261104.md` §2-3 |
| B-15 | 缩略图降规格（480→360 px、质量 0.72→0.65） | 5 万张缩略图约 1.2 GB，是元数据的 50 倍，空间大头在这 | 无 | 同图对比无明显糊；5 万张省约 40% | 同上 §2.4 |
| B-12 | **内容去重：本地只存一份，下载只记引用**（2026-11-04 苏哥定方向：网盘原理） | 不同链接同内容：物理文件只存一份，后续下载不落盘、只在库加一条引用（SHA-256 内容寻址 + 引用计数）。方案已成文（`docs/DEDUP-REF-DESIGN.md`）：库层引用（保住人类可读目录）而非 CAS 改 hash 文件名；删除按引用计数、重命名只改显示名、统计双口径、老库懒补算。估 2.5 天 | ✅ R1/R2 已批（ADR-050，2026-11-05）：删除=减引用、最后引用才删物理；重命名只改显示名。可施工 | DD-1~7 用例（秒传/引用计数删除/恢复/重命名/双口径统计/异常不影响下载/缺失态） | 2026-11-05 已批待施工 |
| B-08 | **媒体查看器改造（视频控件 / 图片 / GIF）** | 查看器已有自绘控件（倍速/连播/进度，v2.6 已验收）；缺 GIF 暂停逐帧、图片旋转/适应/1:1 | ✅ 已批（ADR-050）：视频自绘保留，**只引 gifuct-js** 补 GIF 逐帧；否决 Media Chrome | VW-1~10 十条用例（视频控件改为回归现有自绘），重点 VW-2 键盘全矩阵、VW-9 超大 GIF 不卡死 | 2026-11-05 已批待施工 |

---

## P1 · 待验证（挂起或环境受限，不是代码缺陷）

| # | 任务 | 卡在哪 | 解除条件 |
|---|---|---|---|
| B-03 | Instagram P1 真实登录态下载验证 | 代码已提交 `6bd6d19`，按钮注入 + 本地 fixture 通过。**2026-11-05 更新：苏哥给无登录态公开 reel 素材（TEST-ASSETS A9），可先试**；登录墙拦截与否如实记录 | 先按 A9 验未登录场景；完整功能仍需 IG 账号 |
| B-04 | 原生 picker 三按钮（`#pickBtn`/`#rootBtn`/`#resetRoot`）自动验收 | CDP 驱不动系统原生选择器，属环境限制 | 手动点一次并截图即可关闭，不必上自动化 |
| B-05 | `fillMissingThumbs()` 补缺分支实证 | 真机 19 卡 0 缺图，但「本来缺、扫描后补上」这条路径还没被真实触发 | 往库里丢一条无缩略图的新素材，重扫后看是否自动生成 |
| B-17 | **收藏夹落地（原型已完成，待审批后施工）** | 新需求，一级栏目。原型已验证 15 项断言。定位为「视图不是位置」：文件不动，只记 id；星标做成规则型系统收藏夹 | 等原型审批 | 新建/重命名/删除/排序/加入/退出全部可用；删夹不删文件；改名后成员不丢 | `PROTOTYPE-MAPPING.md` §14 |
| B-16 | **多平台登录态实测（方案已定）** | 苏哥 2026-11-05 拍板：**主方案=直接驱星愿浏览器（CDP），登录态现成**（X/小红书/微博/抖音/B站/谷歌均登录，IG 除外）；备用=Playwright 可控浏览器现场登录。拉起必须先 taskkill twinkstar + 删 SingletonLock + 等 5 秒（TESTING 坑 9）；若星愿内核禁了 `--load-extension` 即切备用 | 素材已登记 `TEST-ASSETS.md` A1/A3/A4/A6/A7（含批量口径） | 四类下载各跑通，记录落盘路径与文件完整性，逐条回填 TEST-ASSETS §3 | `STATUS-20261104.md` §6；`TEST-ASSETS.md` |
| B-13 | **YouTube 真实页面下载验证（翻案后新增）** | 合并进来的 YouTube 实现只在另一台电脑的登录态下跑通过；本机没验过。nsig 解密依赖 sandbox 页，MV3 CSP 下是否正常未在本机确认 | **✅ 素材已给（2026-11-05）：`TEST-ASSETS.md` A3（Shorts 单视频）**；星愿加载扩展即可开验，试 720p/1080p |
| B-18 | **入口层 + 页面侧 UI 重设计（原型已完成，待审批后施工）** | 苏哥要求「不只配色，功能按钮都要想」。popup 成品 v3.1（B+D 统一 + 概览条/存到哪/已下载/体积，砍媒体控制）CDP 14/14；页面侧 7 平台原型 v1 CDP 14/14；功能审视见 `docs/FUNCTION-AUDIT-ENTRY.md` | ✅ 四项全照原型批（ADR-050，2026-11-05）：砍媒体控制/两层设置=库内抽屉+完整页/popup 按 v3.1/已下载提示照做。按映射施工 | 2026-11-05 已批待施工 |
| B-06 | 清晰度「多码率（HLS master）自动选最高」未单独验 | 单码率站点全通；master 带多 variant 时，偏好注入后是否真选到目标档没单独验过 | 找一条 master playlist 有 2 档以上的流，看落盘分辨率是否等于所选档；失败会退回默认档，不崩 |
| B-19 | ~~花瓣网批量下载~~ → **已撤销（ADR-051）** | 苏哥定口径：通用优先、专站增强——花瓣**不做单站适配**，素材 A5 转为「通用图/视频通道」验收料 | 并入 V9/B-20 通用通道任务 | 见 B-20 | 2026-11-05 ADR-051 撤销 |
| B-20 | **通用图/视频通道验收（V9）**（ADR-051 新立，取代 B-19） | 定位底线：任何页面有图/视频可单张+批量下载。以花瓣 A5 为首块验收料；不通过点常见于懒加载/render 图（cat-catch 系有 catch-img/catch-screens 同源扫描可对照增强） | 素材已备（TEST-ASSETS A5） | 花瓣 pin 页：单张下载 ✓ 批量下载 ✓ 懒加载图全部嗅到 ✓；失败则修通用通道（禁写站点特例） | 2026-11-05 ADR-051 |
| B-25 | **微博相册备份（走站点 API，ADR-056 方案已定待施工）** | 现有微博批量只能记到「人工往下拉」已加载的图。参考星愿里的「叫小微」拆解后确认：官方相册接口 `/ajax/profile/getImageWall?uid=&sinceid=&has_album=true` 可用 `since_id` 游标分页拿到**整个相册历史**，按 `timeline_year/month` 分桶。落盘复用 `vrBulkDownload`→`vrBulkSaveItem` 逐张进资源库，不新增下载实现、不打内存 zip | 方案已定（`docs/WEIBO-ALBUM-PLAN.md` + ADR-056）；**无外部依赖可开工**。仅「档位真实像素对比 / since_id 推进语义」两项未实测，已用同级回退 + 双重终止条件消除依赖 | 方案 §7 七条：候选链判定单测、分页终止单测、pid 候选构造单测、某博主 1 个月实站入库、重跑去重、无 `.htm` 残件、既有微博批量不回归 | 2026-11-06 ADR-056；`WEIBO-ALBUM-PLAN.md` |

---

## P2 · 已明确不做（**别当待办，别提案**）

| # | 项 | 结论 | 依据 |
|---|---|---|---|
| N-01 | ~~YouTube 下载~~ → **翻案，改为要做** | **2026-11-04 苏哥推翻**：早先"不做"是因为当时结论"做不了"，但另一台电脑已把路走通（sandbox + nsig 解密），合并后代码已可用 | ADR-043 作废；改为 B-13 验证真实页面 |
| N-02 | DASH(mpd) 合并 | 不做，M11 只覆盖 HLS | BUILD-PLAN M11 |
| N-03 | 并发动态拆段 / 慢段救援 | 不做，固定 4 路够用 | BUILD-PLAN M11（不过度设计） |
| N-04 | 合并路线 A/B/C（在线 FFmpeg 隐私） | **已由 M11 离线直连 + mux.js 取代**，原「待拍板」作废 | ADR-028 |
| N-05 | 清晰度下拉影响单条按钮 | 不改，按钮恒取最高是苏哥明确要求 | BUILD-PLAN M8 |
| N-06 | 远程 HTTP Range 流式预览 | 不做，本地媒体库不需要 | BUILD-PLAN M11 §4.4 |
| N-07 | srcset 列出全部尺寸 | 不做，只取 `currentSrc` | BUILD-PLAN M5 |
| N-08 | info/librqbit/mcp 等 OmniGet 桌面端能力 | 架构不成立（MV3 无 fs、无常驻进程） | `deliverables/reviews/2026-11-04-omniget-review.md` |
| N-09 | **对外发布扩展**（2026-11-04 拍板暂不发布，先自用） | 五道关已评估：GPL 开源、大会员/YT 功能裁剪、商店审核、脱敏（81 文件含个人称呼）、维护成本。路线图与脱敏清单已成文，触发条件满足时按文档执行 | `docs/RELEASE-FEASIBILITY.md` |

---

## P3 · 文档与工程债（不影响使用，影响接手）

| # | 任务 | 现状 | 目标 |
|---|---|---|---|
| D-01 | BUILD-PLAN 只写到 M11 | M12（B站完整视频）/ 1080P DASH / 悬浮按钮 / 抖音 / 微博 / X 按钮 / 主页批量 / 媒体库 P1-P4 / 小红书 / Instagram / 去重 都没进施工计划 | 已在 BUILD-PLAN 追加「M12+ 附录」，按 ADR 编号索引 |
| D-02 | 拆巨型文件 | `js/m3u8.js` 2446 行、`js/background.js` 2523 行 | **先补回归测试再拆**；OmniGet 的六文件拆分可作参考，不是现在做 |
| D-03 | 可编辑捕获规则 | 未做，现在匹配逻辑硬编码在 background | 属新功能，不插队；若做必须配「命中日志」 |
| D-04 | 下载任务快照 + 改参数重试 | 未做，M9 历史面板已覆盖大半 | 属 UX 增强，不插队 |
| D-05 | **项目名统一为「苏哥的钓鱼竿」（真实代码）** | 扩展名/资源库标题已是；但 popup.html:6/:43 还带 `video-rod` 副标题，语言包 messages.json 有 6 处「猫抓 设置/下载器/M3U8解析器/json格式化/dash解析器/始终不启用猫抓下载器」窗口标题未改 | 改上述可见名；**保留**下载路径 `video-rod` 与 GPL 署名「基于猫抓 fork」。原型层已统一（4 份原型 + 资源库品牌名） |

---

## 已关闭 / 已解决（留痕，避免重复提案）

| 事项 | 结论 | 时间 |
|---|---|---|
| 回收站恢复遇同名文件（DEF-02 尾巴） | **✅ 已修（ADR-079，2026-11-12）**：同内容自动消重、异内容改名 `_restored` 恢复，索引主键与 absPath 同步换；`test-path` 100/100 + 真机 `qa-trash-conflict` 6/6、`qa-trash-dedup` 5/5；顺带修掉「全批恢复后批次目录残留」。浏览器用例见 tools/qa-trash-*.py | 2026-11-12 |
| 真实网址联网验证（M0） | 已由 M1 有头浏览器阶段完成 | 2026-10-17 |
| B站分P 真实页面 | **部分**：B站完整视频 `BV1DVaZ6hEK6` 真机通过（TESTING §9）；**多P 纪录片形态未单独验**，选择器失效会自动退回纯嗅探 | 2026-10-18 |
| m3u8 文件名 `.m3u8` → `.mp4` | 已统一 | 2026-10-17 |
| 根目录散落文件 / `小红书/` 扁平目录 | 已归档并入 `xiaohongshu/` | 2026-10-19 |
| 全屏按钮「点不动」 | 复验通过，此前是标签页后台未聚焦（`Page.bringToFront`） | 2026-10-19 |
| 单次下载重复落盘 | 已接 `vrMediaSeen` 账本 | 2026-10-19 |
| 清晰度下拉「只记录偏好」 | 已由 M2 `hookDownloadsApi` 接入下载管线 | 2026-10-17 |
| OmniGet 可借鉴性 | 结论：无可抄代码（其 JS 重叠部分源自 cat-catch）；3 条启发均不立项 | 2026-11-04 |

---

## 怎么用这份文件

1. **开工前**：看 P0，有样本就干；没样本往下看 P1/P3。
2. **做完一件事**：从 P0/P1 移到「已关闭」，写一句结论 + 依据 + 日期，不删记录。
3. **发现新问题**：先判断是不是 P2 里已明确不做的，是就别记；不是就按 P0/P1/P3 归位。
4. **别在别的文档里写待办状态**——只写「详见 `docs/BACKLOG.md`」。

---

## 2026-11-06 核实：BACKLOG 状态更正（代码为准）

> 以下每条都到代码里核对过，不是照抄文档。**已在代码里实现的条目移出 P0/P1，留痕在此。**

| # | 原状态 | 核实结果 | 依据 |
|---|---|---|---|
| B-07 溯源元数据 | P0 待批 | ✅ **已实现** | `sw-library.js` / `save.js` 均写入 `pageUrl/mediaUrl/sourceUrl`；`indexer.mergeEntry` 白名单已含 `pageUrl/mediaUrl` 等，重建索引不再丢 |
| B-08 查看器 GIF | P0 已批待施工 | ✅ **已实现** | `js/library/anim.js` 用原生实现逐帧/暂停/倍速/循环；不引 gifuct-js（离线优先） |
| B-10 标签 UI | P0 待做 | ✅ **已实现（2026-11-07 补齐左栏）** | 详情页 `#pvTagAdd` + `lightbox.js` 增删；**左栏标签区（默认折叠成一行，点开就地展开）**：点击筛选、Ctrl 叠加取交集、计数徽标、悬停出改名/删除。数据层 `counts()/countsInScope()` 均产出 tags 计数 |
| B-11 分辨率回写 | P0 有时间窗 | ✅ **已实现** | `thumbs.js` 写 `width/height`；实测库内 **39/39 条都有宽高** |
| B-12 内容去重引用 | P0 已批待施工 | ✅ **已实现** | `js/library/dedup.js`：SHA-256 + `isRef/refOf` + 引用计数删除；`app.js` 有双口径统计 |
| B-14 大库渲染 | P0 | 🟡 **部分实现** | 首屏 120 条 + 滚动追加（`PAGE=120`、`appendMore`）+ 缩略图 IntersectionObserver 懒加载；**但不是虚拟滚动**，DOM 仍随滚动增长。5 万条压测未做 |
| B-15 缩略图规格 | P0 | ✅ **已实现** | `thumbs.js` `MAX_EDGE=400`、`QUALITY=0.66`（480→400、0.72→0.66，口径与条目略有差异） |
| B-17 收藏夹 | P1 待审批 | ✅ **已实现** | `app.js` `VRFav`（addToFav/addToDefault/toggleStar）+ `library.html` 收藏夹抽屉/星标 |

**仍然真正未完成：**

| # | 事项 | 卡点 | 备注 |
|---|---|---|---|
| B-01 | AES-128 加密 HLS 真机 | 需要一条真实加密流地址 | 代码已在 `m3u8-merge.js:122` 实现，只差真实样本 |
| B-02 | 小红书去 CDN 后缀取大图 | 需真实图文笔记对比四项数据 | 代码已实现去后缀优先 + 回退（`background.js` xhs 分支） |
| B-03 / B-16 | IG 登录态 / 多平台登录态实测 | 需真实登录浏览器 | B-16 主方案=驱星愿 |
| B-04 | 原生 picker 三按钮 | CDP 驱不动系统对话框 | **手动点一次即可关闭** |
| B-05 | `fillMissingThumbs` 补缺分支 | 需人工造一条无缩略图素材 | 低优先 |
| B-06 | HLS master 多码率自选 | 需一条多 variant 流 | 默认已选最高码率 |
| B-09 | 合并后实机验证 | 需浏览器实跑 | 本轮已在 9480 真实库跑通，可视作已关闭 |
| B-13 | YouTube 真实页面下载 | 素材已有 | **本轮已实测 1080p + 断流续传，可关闭** |
| B-14 | 5 万条压测 / 真虚拟滚动 | 无阻塞 | 唯一真正需要的性能项 |
| B-18 | 入口层 UI 重设计 | 已批待施工 | 大项，未开工 |
| B-20 | 通用图/视频通道验收 | 素材已有 | 图片侧已由 B-26 覆盖（侧边栏/翻页/批量）；视频通道仍待验 |

**本轮新增待办：**

| # | 事项 | 说明 |
|---|---|---|
| B-21 | 卡片右键菜单 | `trash-ui.js` 已实现但未挂到 `library.html`；详情页/批量条可用。接上即可复用 `VRMovePicker` |
| B-22 | 原型同步 | 收藏/星标、7 列网格、保存位置新流程、移动文件夹选择器均未回写 `media-library-stage-v1.html`（原型现仍是固定 4 列） |
| B-23 | 顶部平台 chip 与左侧树二选一 | 两个入口并存，需产品拍板 |
| B-24 | 存量条目来源回填 | 浏览器下载记录 `referrer` 为空、URL 是 blob，**无法回填**；只能保证新下载带来源 |
| B-26 | ~~图片侧边栏 + AIX 能力面~~ **✅ 已实施（ADR-058）** | 2026-11-06 完成：`image.html`（A 网格，侧边栏默认页）/ 候选链过滤详情页 / 翻页抓全（后台标签）/ 五站适配表（微博·豆瓣·堆糖·花瓣·图虫）/ 导出 txt·csv / 零依赖 ZIP / WEBP→JPG / AIX 占位符 / 下载管理页 / 过滤规则（域名+正则）/ 拖拽·框选·右键。单测 424 条全通过 |
| B-27 | **站点图集适配的登录态真机验证** | 五站规则目前只有**纯 URL 单测**（50/50）。豆瓣/花瓣/图虫在无登录态下的相册分页、以及各站原图派生是否真的返回原图尺寸，**没有真机样本**。需要苏哥给 3 条真实相册/图集 URL（TEST-ASSETS 登记） |
| B-28 | **图片清单的「已下载」判断与压缩去重不一致** | 清单用 `vrImgDownloaded`（URL 级），资源库用 SHA-256+引用计数（ADR-046）。同一张图换了 URL（去 resize 参数后）会被当成新图再下一遍。需要一次对账，把 URL 级去重升级为内容级 |
| B-29 | **框选/拖拽在 iframe 与 Shadow DOM 内失效** | 两个手势都绑定在主文档，`all_frames:false` 的图片脚本只跑顶层。嵌在 iframe 的图墙（部分相册站）框选不到。属已知边界，非缺陷，需要时再评估 |

---

## 工程债收口（2026-11-06 本轮）

| 项 | 现状 | 结论 |
|---|---|---|
| `background.js` 拆巨型文件（D-02） | 当前约 4545 行，下载/入库/YouTube/微博都在里面 | **本轮不拆**。没有覆盖主链路的回归测试就拆文件，风险和收益不成比例；继续按 D-02「先补测试再拆」执行 |
| 静默 `catch` | `background.js` 共 128 处 `catch`，严格静默（空块/仅「忽略」）4 处 | 2 处属可接受降级：`vrVideoProgress` 的 `sendMessage`（页面按钮已卸载，高频轮询不刷屏）、`vrEntryFileAlive` 的同步异常（按「文件不在」处理）。其余 2 处应补 `console.warn`：B 站元数据迁移（会导致溯源空白）、`vrNameInTab` 读设置失败 |
| 上述 2 处日志补强 | **未执行**：`js/background.js` 本轮被另一会话持有写权（`workspace.write_conflict`） | 待该会话释放后按本表补上，不改逻辑、只加一行带上下文的 `console.warn` |

> 本轮对库页（`js/library/*.js`）新增的异常分支都带上下文日志或明确降级说明，未新增静默 `catch`。
| B-30 | **站点名的真机交叉验证（自动抓取 vs 预置表）** | 已实测 10 个真实站点：花瓣网/知乎/豆瓣/GitHub/Pixso 靠抓取成功，Pixabay/Unsplash/Dribbble/Behance/500px 因 Cloudflare 或超时回退预置表。**2026-11-08 补**：站点名链路代码已全部提交（`e025d82`），离线校验 `test-site-name` **84/84**、`check-site-names` **5/5** 全绿，但这只覆盖纯逻辑与表结构。**「扩展真机里 service worker 的 fetch 与 Node 一致」仍未验**——这是本条唯一未解除的卡点 | 扩展加载后打开 5 个站点各下载一次，看设置页「站点名称」是否出现真实站名（而非域名） | 真机走一遍，核对 vrSiteNames 实际写入内容与来源标记（需带登录态的 Edge 实例，无法在本环境完成） |
| B-31 | **预置表 381 条的站名准确性抽查** | 表内 host 与显示名的**格式**已全部机器校验通过（2026-11-08 复跑 `check-site-names`：381 条 / 391 host 格式合法、显示名唯一且可原样落盘、均为可注册域名、byHost/byName 自反命中）。卡点只剩**语义层**：「小众站点官方到底叫什么」没有与官网逐条对照，错的显示名会直接变目录名 | 抽查 30 条（尤其中文小站）与官网对照 | 发现错误就改 `site-names-preset.js` 后跑 `node tools/check-site-names.js`（该脚本已验证可用，改完立即能判格式是否仍合法） |
| B-36 | **全链接扫描未接 UI（模块已就绪）** | `js/lib-download-scan.js` 的 `collectLinks`（`a[href]` 全量 + `video/audio/source/embed/object`）已实现且有单测，但没接进侧边栏：我们的 `vrImgDownload` 会把 `VR_IMG_EXT_OK` 白名单外的扩展名**一律强转 `jpg`**，接上去等于列出 PDF 却存成 .jpg（曾加过菜单项，随即撤掉，不留死按钮） | **前置**：`vrImgDownload` 的 `type` 从硬编码 `'image'` 改为按扩展名推导，白名单外走通用 `vrDownloadWithName` | 改完后接 `data-more="files"` 菜单项 + 列表项 `kind` 支持 doc/media | `COMPETITOR-EXTENSIONS.md` §8.4、ADR-065 决策三 |
| B-37 | **小红书原图未接入图片链路** | `js/xhs-media.js` 的 `originalUrl()` 能把 `sns-*.xhscdn.com` 预览档推导成 `ci.xiaohongshu.com` 原图（25 条单测通过），但它**不在图片内容脚本组**里（`manifest.json` 的图片组只有 lib-image-util / lib-download-scan / image-*），所以 `collectCandidates` 拿不到原图候选，清单里全是 640 宽预览档。另注：`ci` 域对**部分**素材 ID 返回 404（2026-11-07 实测），不能盲目优先 | **前置**：① 把 `js/xhs-media.js` 加进图片内容脚本组；② `collectCandidates` 对 xhscdn 追加 ci 原图候选（**排在末位**，不夺首选）；③ 下载侧失败要能回退到预览档（`vrImgDownload` 目前不消费 candidates，需一并改） | 改完跑 `node tools/test-xhs-media.js` + `test-image-util.js`，并真机验 1 个笔记 | `COMPETITOR-EXTENSIONS.md` §8.1、ADR-065 |

---

## 资源库持久化（2026-11-07 新增，方案见 `LIBRARY-SELF-CONTAINED-PLAN.md`）

| # | 任务 | 为什么 | 阻塞条件 | 验收方式 | 出处 |
|---|---|---|---|---|---|
| B-32 | **✅ 已实施** · 快照补全 + 自动化 + 路径自恢复 | 用户核心痛点：重装系统后整理成果丢失。实测快照只存 9 个字段，收藏夹/改名/分辨率/来源 URL 全不在内；`snapshot()` 只有设置页手动按钮一个调用点；`payload.root` 写入但无代码读取 | — | 已交付：17 字段 + `favorites` + 固定名 `index.json` + `root` 自恢复 + 入库后 30s 节流自动写 | `LIBRARY-PERSISTENCE-SPEC.md` §6.1 |
| B-33 | **✅ 已实施** · 缩略图落盘 + 生命周期管理 | 缩略图只存 IDB blob，重装即失；`thumb` store 无 delete；改名/删除/移动产生孤儿 | — | 已交付：`thumbs/<16hex>.webp` 落盘、`deleteFor`/`gc`、mtime+size 双校验失效判定、启动后自动清孤儿 | `LIBRARY-PERSISTENCE-SPEC.md` §6.2 |
| B-34 | **✅ 已实施** · 冷启动「读索引 + 增量对账」+ 超限提示 | `mode:'full'` 对每文件 `getFile()`；`MAX_ITEMS/MAX_DEPTH` 三处静默截断 | — | 已交付：新增 `mode:'reconcile'`、`MAX_ITEMS` 2 万→10 万、`MAX_DEPTH` 8→12、超限经 `reportTruncation` toast 告知 | `LIBRARY-PERSISTENCE-SPEC.md` §6.3 |
| B-35 | **✅ 已实施** · 按需查询替代全量读表 | `getAllFiles()` 6 处无条件调用；已有索引未充分利用 | — | 已交付：`queryFiles`/`findBy`/`countBy` 游标查询；首屏大库只取一页（`count()` 判据）；dedup 三处改用游标 | `LIBRARY-PERSISTENCE-SPEC.md` §3.1 |

> **2026-11-07 实施完成**：B-32→B-35 四步全部落地，另加阶段 4 备份/恢复入口。
> 红队 14 项缺陷中，9 项真实缺陷已全部修复（2 项经检索认定无需改、3 项确认无动作）。
>
> **回归结果（670 条断言）**：
> `test-persistence` 79 · `test-zip` 40 · `test-backup-restore` 33 ·
> `test-path` 90 · `test-save` 51 · `dedup` 21 · `naming` 43 ·
> `img-filter` 47 · `image-tier` 57 · `album-sites` 52 · `site-name` 84 ·
> `image-util` 108 · `check-site-names` 5 —— **全部 0 失败**。
>
> **Edge 隔离套件**：5/8 通过。3 个 FAIL 经「改动前基线对照」证实为既有问题：
> `skin` 19/20（前后一致）、`e2e-buttons` 26/28（前后一致，失败项同为
> 「树节点 8」「B站节点筛选 3」）、`download-path` 6/10（文档已记录的
> "无 FSA 时 Chrome 忽略 filename" 限制）。

> **回滚方式（任一阶段出问题）**：
> 删掉 `_library/index.json` 即回退快照改动；`git checkout css/` 回退字号；
> IDB schema 从未升版，浏览器数据不受影响。

> **施工建议顺序**：B-32 → B-33 → B-34 → B-35。
> B-32 单独就有价值（直接解决重装丢失），改动最小且可回滚
> （删掉 `_library/index.json` 即可回退，IDB 从未被改动）。

---

## QA 审计后续（2026-11-08 新增，来源 `deliverables/reviews/2026-11-08-QA审计报告.md`，计划 `EXECUTION-PLAN-20261108.md`）

| # | 任务 | 为什么 | 阻塞条件 | 验收方式 | 出处 |
|---|---|---|---|---|---|
| B-38 | **✅ 代码完成 · 单写盘通道（DEF-02）**（2026-11-08：ADR-069 落地 popup 批量接管→SW vrLib.saveOne；专项 qa-single-channel-e2e 14/14；离线全量 7/8 无回归） | 批量下载三个落点、37/50 未归档、relPath 与物理脱节；用户无感 | ADR-069/070 已拍板；需改 popup 批量循环 + `VRSave` 回写 + 缺失判定 | 隔离批量 20/20 落点一致；A2 真实页复测 0 兜底丢失；e2e-popup/e2e-sw 全绿 | ADR-069/070、Q-01~Q-03 |
| B-39 | **✅ 代码完成 · 详情页嗅探边界（DEF-07）**（2026-11-08：net-sniff 详情页白名单，test-xhs-note-filter 4/4；真实 A2 页复测留待实例配额恢复） | 详情页混入推荐流封面，全部用页面标题命名，无法分辨 | ADR-071 已拍板；需 XHS infoList 白名单 + 无命中回退 | A2 重测：行数=笔记实际图数、0 混入；其他站点回归全绿 | ADR-071、Q-04 |
| B-40 | **✅ 已实施 · 测试卫生：隔离下载目录**（2026-11-08：e2e-all 启动写 Preferences 重定向 work/dl/isolated；X2 断言真实 Downloads 0 写入通过） | 隔离实例与真实环境共用 Downloads，历轮测试留下 UUID 残渣；本轮实测产物落进用户真实库 | 无（先于一切下载类测试） | 跑一轮离线套件后真实 Downloads 0 新文件 | Q-05 |
| B-41 | **🟡 dry-run 完成 · 历史数据迁移（DEF-04）**（tools/migrate-relpath.py 就绪，18 条变更清单已出；--apply 属破坏性写库，等苏哥过目清单后执行） | 18 条无前缀 relPath、8 条缺平台字段、3 条文件缺失；每次审计重复报 | B-38 语义定稿后；dry-run 人工过目 + 快照 | integrity 4/8→≥7/8；非目标字段 0 变化 | Q-07/Q-08 |
| B-42 | **P1 · 测试体系补齐** | 新套件未入 runner、断言漂移无防护、真机矩阵有洞、门禁靠自觉 | B-38 完成后 | 套件清单=runner 一致；真机三项有记录；发布报告含 first-run-audit | D-05、Q-06/Q-11~Q-14 |
| B-43 | **P1 · 文档同步（Q-15）** | D-02/D-07 改动涉及需求/契约/测试口径多份文档 | B-38/B-39/B-41 完成后 | DOC-INDEX 更新 + 各文档「最后核对日期」刷新 | EXECUTION-PLAN §二 |
| B-44 | **✅ 代码+fixture 完成 · 小红书权威命名（苏哥截图三问题之②）** | DOM 选择器失效致作者=域名、标题=页面标题；双通道（popup 批量 + 图片面板）已接 state 权威源 | ADR-072；qa-xhs-author-e2e 13/13 | **⬜ 真实 A2 页复测**（实例配额，明天补） | 2026-11-08 |
| B-45 | **✅ 完成 · 图片面板档位吞图（苏哥截图问题①）** | 懒加载未知尺寸被 continue+默认档100 双重吞掉，「没得选只能全下」 | ADR-073；D8-D10 单测 + N7 3/3 + 全量回归 | 真实首页抽验（明天与 B-44 一起） | 2026-11-08 |
| B-46 | **P1 · 首页按笔记分组命名（苏哥截图问题③）【视频侧 feed 图文绑定 2026-11-12 已修复】** | 首页 feed 每张卡属不同笔记/微博，单一页面标题必然全同名；需按图反查所属分组 | **视频侧（微博等 feed）已修**：`vrExtractCardMeta` 浮标挂载点→所属卡片现场锚定，meta 随 `vrVideoDownload` 消息带出，SW `metaOverride` 优先（兼容最高清探测），14/14 真实 DOM 单测通过；小红书笔记分组（图片版）仍按原嗅探+命名两层设计推进 | 视频侧验收：首页多视频分别下载，各自图文+各自最高清档位正确（待真机 weibo 复验） | `deliverables/reviews/2026-11-12-图文绑定修复方案.md`（含决策落地） |
| B-47 | **✅ 完成 · 发布包体积治理（93MB 事故根治）** | 手工 zip 仓库根把 .git/deliverables/.reasonix 卷进去 → 93MB；且隔离实例一直加载仓库根，发布包从未被验证过 | 无 | pack-dist 产物 1.22MB（-98.7%）；发布包真实加载 6/6；qa-preview-page 12/12；离线全量无回归 | ARTIFACT-MANAGEMENT §5、pack-dist.js |
| B-48 | **✅ 完成 · 死代码处置** | mqtt.min.js 361KB 死代码（从未执行）；旧版库页 4 文件 66.9KB 零引用 | 无 | dist 4.54MB→4.12MB；全量回归 7/8（download-path 仍 ADR-040 已知项） | archive/legacy-library-v2/README.md |
| B-58 | **✅ 完成 · 抖音图文页图片入口 + 侧边栏门槛失效（苏哥 2026-11-09 报）** | ①图文作品图是轮播透明 `<button>` 的 background-image，悬停只绑 `<img>` → 页面零入口；②侧边栏把档位 `imgTierMin` 当采集门槛（存了 2000），1066×1424 真图被 `scanImages` 筛光 → 只剩 297 条「尺寸未知」；③「超大隐形按钮」是抖音轮播自己的 slide 按钮，非我方元素 | 扫描门槛恒 1、档位只筛选 + 「全部」档 `\|\|100` bug + 档位自愈；新增 Fiber `noteFunc` + `vrDouyinImages` + `js/douyin-note.js` 浮层；批量消息透传 authorFull | 真机 11/11（15 张/1.7MB/序号/作者目录）；Node 381 断言；离线 e2e 7/9（两项非回归，见报告 §五） | `deliverables/reviews/2026-11-09-抖音图文页诊断.md` | 2026-11-09 |
| B-59 | **✅ 完成 · 下载去重链路（苏哥：同平台不重复/跨平台留一份/索引多份）** | 四层同时失效：①账本键=整条 URL（签名变→永远新）②图片入库无 sourceUrl（库内查重永远查不到）③索引重建丢 sha256/isRef ④库页未载 dedup.js + `fetch(file://,DELETE)` 假删除 | 归一键+平台分账、meta 补来源键、mergeEntry/快照保住指纹与引用、引用条目豁免 missing、downloads 重建不抹 FSA 条目、compact 必须带 FSA remover、库页补模块与入口 | `test-dedupe-key` 19/19、`dedup-test` 21/21、`test-dedupe-live` 15/15；真实库 61→16 文件（合并 48 条）；e2e 7/9（两项非回归）+ e2e-buttons 隔离 32/32 | `deliverables/reviews/2026-11-09-去重链路修复.md` | 2026-11-09 |
| B-60 | **✅ 完成 · 侧边栏尺寸档位被裁切（苏哥 2026-11-09 报）** | `.ip-tiers` 单行 nowrap + `overflow-x:auto` 且隐藏滚动条 → 380px 侧栏放不下 5 个档位，「超大」被切且无滚动提示，用户不知道后面还有什么 | 改 `flex-wrap: wrap` + 取消溢出隐藏；档位 pill padding 10→9px | `test-tiers-css` 7/7；真机 390×780 五档 2 行、allInside=true（截图 `deliverables/assets/2026-11-09-sidebar-tiers.png`） | `css/image-page.css` | 2026-11-09 |
| B-61 | **✅ 完成（2026-11-09）· P0 · 首页平台货架 + 平台内页**（原型 `media-library-shelf-compact-v1.html` 已验收） | 素材上千后平铺墙来源混杂，"从某站抓的一批"找不回；平台数有限（≤10）而批次无限，故按平台分行、行数天然封顶 | 规格 §5：平台内页批次组头依赖 batchId（数据层无此字段）→ 本轮降级为单平台时间线 | 行数=平台数；每行≤12张；行头计数准确；1440/1000 双宽无断档 | `deliverables/reviews/2026-11-09-平台货架改版变更规格.md` R1–R3 |
| B-62 | **✅ 完成（2026-11-09）· P0 · 筛选体系（筛选条 + 已选条件栏 + 更多筛选抽屉）** | 筛选散在类型 seg / 左树 / 搜索四处、口径不一；大目录须"搜索+筛选"并存（UX-081），结果数须可见（UX-082） | 无（savedAt/starred/size/width/height/tags/creatorFull 全有） | 任意组合后「共N项」=实际卡片数；条件可单删/全清；抽屉命中数与主界面一致 | 规格 R4–R6、R8 |
| B-63 | **✅ 完成（2026-11-09）· P1 · 原生 select 改自绘下拉** | 深色皮肤下原生 `<select>` 弹层由系统渲染（白底/蓝高亮），CSS 不可控；涉及排序 `#sort` 与批量 `#batchByType` | 无 | 下拉为深色、选中金色对勾、点空白收起、键盘可选 | 规格 R7 |
| B-64 | **✅ 完成（2026-11-09）· P2 · 删除左树搜索框** | 与标题行全局搜索重复；只搜平台/作者，且树本身不长 | 无 | 左树渲染与点击正常；全站仅一个搜索框 | 规格 R9 |
| B-65 | **✅ 完成（2026-11-09）· P0 · 新 Chromium 废弃 `display:-webkit-box` 兼容修复** | 卡片 `.title`（两行截断）与详情 `.pv-info h2`（三行截断）依赖该属性；新内核实测 h2 塌陷为 0 高（标题消失）——产品级 bug | 无（独立可修，建议先于 B-61） | 新版 Chrome/Edge 下卡片与详情标题均正常；旧版无回归 | 原型 CDP 实测 `display=flow-root, h=0` |
| B-66 | **✅ 完成 · 抖音图文按钮「点了没反应」** | ①全跳过时 `runQueue` 没回传 `skipped`，调用方把 15 张重复当成「已下载 15 张」；②进度条把 duplicate 算进「已下载」；③页面全局监听偶发吞掉按钮 click | 三个 settle 分支回传 skipped；按钮三分支终态 + toast；capture+pointerup 双保险；meta 缺失现场补读；进度条改 `ok-skipped` | `test-douyin-note` 13/13；全新下载/重复点击两条路径均实测（截图 2026-11-09-note-skip-feedback.png） | `js/douyin-note.js` / `js/image-batch.js` | 2026-11-09 |
| B-67 | **✅ 完成 · 去重二修：内容指纹 + 作者段（苏哥 2026-11-09 二次报「去重还是出现了」）** | ①`VRDedup.afterDownload` 从未被下载链路调用（同图换 URL 永远重下）；②作者拿不到时路径层用域名兜底 → 同一作品同时存在 `抖音/www.douyin.com/…` 与 `抖音/摄影师沙皮/…` 两套；③批量只查跨批账本、不查本批；④`freeName` 改名后调用方仍用预测路径，判重会删错文件；⑤索引重建后条目变裸（无指纹/无来源）、downloads 模式还会复活已删文件的幽灵条目 → 去重链断 | 新增 `vrImgContentDedupe`（落盘算 sha→删副本→标引用，删文件走 FSA removeEntry + 复核）、`save.js` 回传真实 relPath、作者兜底改「待整理」+ 抖音图文注入 noteFunc 取昵称、批量加 `batchSeen`、索引重建后自动补指纹 + downloads 每条探盘 | `test-dedupe-content` 12/12、`test-dedupe-live` 15/15、`test-douyin-note` 13/13、Node 381 全绿、e2e 6/9（skin 为并行会话安装页改动、buttons 隔离 32/32、qa-preview 既有）；真实库 6 组同内容归零 | `deliverables/reviews/2026-11-09-去重二修-内容指纹.md` | 2026-11-09 |
| B-68 | **✅ 完成 · 侧边栏「未知尺寸」独立档（苏哥 2026-11-09 报）** | 尺寸未知的图不参与尺寸过滤（为防懒加载整页被吞），于是选中「大 ≥1200」时混进一堆「尺寸未知」，看着像筛选没生效，且没有入口单独挑出来 | 抽出 `inTier()` 三处共用：全部含未知、尺寸档只要该档、新增「未知」档（data-min=unknown，值 -1，虚线边框），档位行加一句「多半是图标/头像」；`imgTierMin` 允许 -1 存读 | `test-tier-unknown` 9/9（真机 392 张：未知 324、大档只剩 1 张）；`test-tiers-css` 7/7、`test-image-tier` 60/60；截图 2026-11-10-tier-unknown.png | `js/image-page.js` / `css/image-page.css` | 2026-11-09 |
| B-69 | **✅ 完成（2026-11-10）· P0 · 站点名显示域名 + 历史站点自动补齐（苏哥 11-10 报）** | ①库页从不 `ST.ready()` → learned 层缺席，左栏只剩预置表；②`nameOf()` 不归一，`www.bizhi66.com` 查不到字典；③ADR-061 只在下载时抓站名，历史条目无回补通道 | F1 boot 里 await ready+refresh；F2 新增 `lookupRow()` 归一；F4 新增 `site-name-fill.js` 库页自动串行探测公开首页补名（限速/上限/7天重试/不带 cookie/不搬目录）。**F3 预置表人工补名按苏哥意见否决** | 真机 F4 `3/3` 学到「一点资讯 / 4k壁纸 / 百变桌面」，左栏三域名全消失、原 6 站名不变；`vrSiteNames` 1→4 条；Node 28/28、`test-site-name` 92/92、`test-site-name-fill` 27/27；截图 `2026-11-10-site-name-fill.png` | `js/library/{app,site-registry,site-name-fill}.js` / `library.html` / `tools/test-site-name*.js|py` | ADR-077；诊断 `2026-11-10-站点名显示域名诊断.md`；实施 `2026-11-10-站点名自动补齐实施.md` |
| B-70 | **✅ 完成 · 小红书视频「下错」（通用性缺陷，苏哥 2026-11-11 报）** | ①笔记页 `<video>` 是 `blob:`（MSE），「正在播放」探测失效；②嗅探缓存按 tabId 累积，SPA 切笔记不清 → 池子里混着多篇笔记；③通用排序把「分辨率最高」排第一、「正在播放」只当平手加权 → 别的笔记更高清就赢；④pageUrl 存了带 xsec_token 的一次性地址 | 新增 `VRXhsVideoProbe`（SSR state 取当前笔记 video.media.stream，只给完整 mp4）；通用层加 `VRVideoQuality.docKey` 按文档归属过滤候选 + `prioritizePlaying` 两段式（先锁作品再族内取最高，CDN 节点用 familyKey 归一）；pageUrl 改用确定性 noteId/awemeId | `test-video-quality` 100/100（J 选源 + K 文档键）；真机两条笔记互不串、文件名/作者/标题正确、库 pageUrl 归一；隔离 e2e 6/9（stage-rewrite/skin 失败项在资源库 UI 与安装页，非本次） | `deliverables/reviews/2026-11-11-小红书视频取址修复.md` | 2026-11-11 |
| B-71 | **✅ 完成 · 小红书实况图（live photo）下载（苏哥 2026-11-11 问）** | 实况 = 静态 JPEG + 2~3 秒 mp4；此前只下到静态首帧，用户拿到的是一张不会动的图。数据在 `imageList[i].stream.EF4[0].masterUrl`，侧栏扫 DOM 拿不到 | 新增 `vrXhsLiveProbe` + `vrXhsLive` 消息（按素材 id 配对 DOM 图与 state 条目，不按 index）；卡片加「实况」角标；批量/预览下载时静态图后追加 `_live` 条目；`vrImgExt` 放行 .mp4 结尾（否则 mp4 被强改成 jpg）；库内新增「实况」类型页签/角标/预览（照片+同前缀 _live.mp4 成对才归实况）| 真机 5 张全实况笔记：角标 5、只勾这 5 张 → 落 10 个文件（5 张 jpg + 5 个 live.mp4，文件头 ftypisom 正确）、库内 type 分别为 image/video；图片相关单测 260 条全绿 | `deliverables/reviews/2026-11-11-小红书实况图下载.md` | 2026-11-11 |
| B-72 | **✅ 完成 · B站「又下载不了」+ 库页左上角不是换文件夹（苏哥 2026-11-12 报）** | ①B站选项是 durl/dash、没有直链 URL → 去重键退化成「整条页面 URL」，一条页面多集时下过一集就把其余全判重复（且 `vrFindExistingMedia` 的 pageUrl 兜底同理）；②跳过时浮标只闪绿勾，与「下载成功」无法区分；③`probeFunc` 用 SSR 的 videoData.cid，SPA 切 P 不更新 → 下到第 1P；④B站命名在 probe 之前算，拿不到 UP 主 → 所有文件名挂同一个 `(@360421127)`；⑤2026-11-10 删了设置里的「保存位置」又把路径卡改成 openOptions，两边都没换目录入口 | 去重键改 `bvid_cid_档位`（`vrFindExistingMedia` 支持 workId 且不再用 pageUrl 兜底）；浮标加 `.vr-votoast` 说明跳过/失败原因；probeFunc 按 `?p=` 取 pages[N-1].cid 并带回 partTitle/ownerMid；命名改到 probe 之后并用探针作者；路径卡主体改为弹目录选择器（上级目录自动下钻、空目录二次确认、取消静默、显示文件夹名），右侧箭头仍去完整设置 | `test-bili-source` 12/12（含分P 假 state 注入）；真机 durl 720P 51.9MB、dash 1080P 76.7MB 完整落盘；path 90 / save 51 / quality 100 全绿；隔离 e2e 6/9（stage-rewrite、skin 为并行会话），e2e-buttons 单独 32/32（顺手修掉指向已删 `#setdrawer` 的陈旧断言） | `deliverables/reviews/2026-11-12-B站下载失效与库页换目录.md` | 2026-11-12 |
| B-73 | **✅ 完成 · 测试方案 v1 + 一键体检入口（苏哥 2026-11-12「老是出问题，出个测试方案」）** | ①31 个单测（775 条断言）与 9 个界面套件没有统一入口，改一行要手敲 9 条命令 → 实际没人跑；②没有冒烟档（全量 3 分钟起，改代码时不现实）；③无发布门禁，dist/包是否最新靠人记；④测试腐烂无人查：`e2e-buttons` 断言 2026-11-10 已删的 `#setdrawer`/`#sdDirVal`，静默红了两周；⑤套件互相污染：批次内 e2e-buttons 因 `_selftest` 残留被护栏拒绝、e2e-overlay 因开关被改红 11/12，单跑却全绿 | 新增 `tools/health-check.py`（冒烟/全量/真实站点三档，结论人话 + 归档 md/json）、`tools/check-assert-dom.py`（断言契约检查）、`tools/health-baseline.json`（已知失败登记）；`e2e-all` 加套件级重试 + 套件间回收标签页（保留 1 个，关到 0 会让 Edge 退出）+ 每套件前复位 imgHover/imgBatch/imgTierMin；`e2e-buttons` 护栏判据修正（`_selftest`、隔离下载目录不算真实数据）；文档 `docs/TEST-PLAN.md`（分层模型 / 功能矩阵 / 门禁 / 缺陷闭环 / 缺口路线） | 冒烟 37.7s 全过；全量连续两次「可以发」（31/31 单测 785 条断言、7-8/9 套件 + 2 项基线已知失败）；断言契约 34/34（并验证能抓出人为植入的 setdrawer 引用） | `docs/TEST-PLAN.md` / `tools/health-check.py` | 2026-11-12 |
| B-74 | **✅ 完成 · 测试方案 P0 两项：真实站点清单 + 视觉回归基线（2026-11-12）** | ①站点适配最容易悄悄坏（改版/签名/登录态），机器测不出，只有用户点才发现（B站「下载不了」就是）；②换皮/改布局只能靠人截图看，看完就没了，下次没人看 | 新增 `tools/live-sites.json` + `tools/live-sites.py`：6 条固定清单（本地 HLS 嗅探、本地图片扫描、B站公开视频必过；小红书/抖音/微博探活），`required` 失败才拦、optional 只 WARN；新增 `tools/visual-baseline.py` + `deliverables/visual-baseline/`：popup/options/install 三屏像素基线，差异 >0.15% 判红并出红色 diff 图，截图前固定一次性引导与动态路径文案、禁动画；两者接进 `health-check.py` 第 6/7 步（全量跑本地夹具，`--live` 跑真站） | `live-sites` 6/6（B站 workId=BV1GJ411x7h7_137649199、HLS 嗅到 2 条、图片 5 张）；`visual-baseline` 连测多次 0.000%，人为涂 7200 像素能抓（3.469%）、30 像素微扰放过（0.014%）；`health-check --full` 8 项全绿（视觉在 9 个套件之后仍 3/3） | `tools/live-sites.py` / `tools/visual-baseline.py` / `docs/TEST-PLAN.md` | 2026-11-12 |
| B-75 | **✅ 完成 · 三项遗留清零（苏哥 2026-11-12「一并解决，不要留着」）** | ①`stage-rewrite`/`skin` 长期红登记在已知失败基线里，实际是断言过时；②B站 4 个作者目录 + 5 个文件全挂着同一个假 ID `(@360421127)`（早期命名在探针前算，拿不到 UP 主 mid）；③磁盘改名会让 IndexedDB 旧 relPath 变成 missing 死卡 | ①重写两套件断言跟真源（实况页签 / #setModal / --gold / .pain / 本仓库 issues），清空 baseline；②备份后去掉磁盘假 ID（5 文件内容哈希不变）、同步 `_library/index.json` 快照；③`app.js` 加 `migrateLegacyCreatorPaths`：打开库页自动把旧 relPath 迁到新路径，保留星标/标签/指纹/来源并删旧主键，只认这一个已知污染标记；新增 26 条纯逻辑单测 | 两套件 21/21、22/22 转绿；`test-legacy-path` 26/26；隔离实例端到端验证「种假条目→reload→新路径且旧主键 0」PASS；`health-check --full` 9/9 套件 + 8 项全绿；备份 `D://test//download//work//vr-release//backup-B站-20261112-1840` | `docs/TESTING.md` §4.12 / `tools/test-legacy-path.js` | 2026-11-12 |
| B-76 | **✅ 完成 · 微博默认最高清（4K 可达）+ 回收站改弹窗（苏哥 2026-11-12 报）** | ①`vrWeiboHdProbe` 在页面主世界引用 `self.VRVideoQuality`（模块只在后台 SW），`if(!Q) return null` 恒真 → 补高清从上线起没成功过；②请求用的是 media_id，接口要微博正文 id → 恒返回 20101「该微博不存在」；③4K/2K 只在 `media_info.playback_list`，老代码按固定字段名挑一条，最高只到 1080p；④`familyKey` 按 pathname 归族，微博各码率文件名不同 → 4K 被当成「另一个视频」，锁不到；⑤竖屏按 height 显示成 1920p；⑥嗅探条目 height 为空导致入池去重失效（出现重复档）；⑦downloads 记录 mime 常空 → 238 字节反爬页被当成功落成 .htm；⑧回收站右侧抽屉 440px 太窄 | 探针改为「页面只找 id+取 JSON、后台解析」，id 按 URL/query(fid)/DOM 属性/发布时间链接收集；新增 `weiboVariants` 读全档位（老字段兜底且不重排）；`familyKey` 对微博按 media_id 归族；档位取短边 + 同档去重（入池比较用有效高度）；`vrDownloadLooksInvalid` 补后缀判据 → 自动降级离屏直连；回收站只改 CSS 成 760px 居中弹窗（关闭态 visibility:hidden + pointer-events:none），清空成功后自动关窗 | `test-weibo-variants` 32/32；真机苏哥那条 4K 微博 5 档、2160p·161.4MB 居首、下载 1135983 字节成功；竖屏微博 3 档无重复；回收站 760×339 居中开合正常；全量 8 项全绿、9/9 套件、33/33 单测 1361 断言 | `deliverables/reviews/2026-11-12-微博4K与回收站弹窗.md` | 2026-11-12 |
| B-77 | **✅ 完成 · 深色主题文字/窗格对比度（苏哥 2026-11-12「灰字看不清」）** | ①`--faint` 库页 #685F52=2.85:1、侧边栏 #5F5950=2.58:1（正文要 4.5），用在表单标签/分组标题/说明文字/空态/关闭按钮；②`--muted` 4.84 只是刚过线，11~12px 小字仍吃力；③**`public.css` 留着浅色时代的 `button:disabled{background:#ccc;color:#666}`** —— 全站改深色时漏了，每个禁用按钮在深色页面上都是一块浅灰（3.58:1，光回收站就两个常驻）；④`--line` 1.19:1、`--line-2` 1.08:1，弹窗边框与表格线失形；⑤卡片副标题的 `·` 跟着 --line 走等于看不见；⑥「文件缺失」角标白字压 --danger 只有 3.26:1 | faint→#988F81（4.56）、muted→#A8A093（6.91）、line→#443C32（1.65）/line-2→#2C2723；禁用态改深底深字+opacity .6；`·` 改 --faint；缺失角标改深字压红（5.4:1）；新增 `tools/contrast-scan.js` + `tools/check-contrast.py`（遍历可见文字、向上叠背景、算 WCAG），接入 `health-check` 第 7/8 步 | 修前库页/设置弹窗 15 处、回收站 18 处不达标；修后全量 **9860 元素 0 不达标**；`health-check --full` **9 项全绿**；panel-css 11 / tiers-css 7 / image 117·60·27 / quality 100 全绿 | `tools/check-contrast.py` / `css/library.css` / `css/public.css` | 2026-11-12 |
| B-78 | **✅ 完成 · 本页批量下图的图扫不到/尺寸全未知（苏哥 2026-11-12 报）** | ①**图集面板只扫 `<img>`**，没走背景图与源码/JSON 通道 → 微博信息流面板只 1 张、侧边栏同页面 53 张（差 50 倍）；②**扫描发生在图片解码之前**，懒加载站点 naturalWidth=0 → 整列表「尺寸未知」（微博 53 张全中），既不能按档位筛也看不出哪张是大图；③侧边栏缩略图在扩展页加载外部图，Referer 是扩展来源 → 图床按 Referer 放行时整屏裂图；④（自测引入）`fillSizes` 导出引用了未定义的函数 → 整个 VRImageUtil 挂掉，表现是「扩展所有界面全灭 + 扩展 ID 探测失败」；⑤`e2e-all` 的扩展探测只认 SW target，MV3 无事件时 SW 不起来 → 探测失败退回硬编码 ID，整套界面测试全灭 | 新增 `fillSizes`（页面上下文 `new Image()` 预载，限 60 张/2.5 秒）并接入侧栏与图集扫描；图集 `collectForSw` 补齐背景图 + 源码通道；缩略图先 `no-referrer` 再退回默认；`detect_ext_id` 增加从 Secure Preferences 读扩展 ID 的兜底；新增 `test-site/lazy-images.html` 夹具 | `fillSizes` 6ms 返回 900×900/640×480/300×220（不存在的正确跳过）；端到端：lazy 夹具页档位从「全部=未知」变成 小 23/中 12/大 6、卡片显示真实尺寸；`health-check --full` 9 项全绿（9/9 套件、33/33 单测 1361 断言） | `tools/e2e-all.py` / `test-site/lazy-images.html` / `docs/TESTING.md` §4.15 | 2026-11-12 |
| B-79 | **✅ 完成 · 「抓图」完全不可用（苏哥 2026-11-12 报，微博页 53 张图只列 2 张裂图）** | ①popup 抓图**自己抄了一份扫描器**，门槛写成「显示尺寸**短边** ≥ 600」——信息流图片显示宽 300~500，一张都过不了，只剩两张背景广告位；②不校验可达性 → 裂图进列表；③只扫 `<img>`，不扫背景图/源码，也不走 `data-src`（占位 src 被整张丢弃）；④微博清晰度在**路径段**（`/mw690/`），「去 query 参数」那套拿不到原图，存下来是 690px 压缩图 | 改为复用页面已注入的 `VRImageUtil`（= 侧栏清单同一模块，口径天然一致）+ 缺注入时补一次；采集门槛回到原始像素 ≥100、显示尺寸只挡图标；新增 `upgradeSinaimg`（`/thumb150/` `/bmiddle/` `/mw690/` → `/large/`，且必须是候选**首位**，拿不到自动退下一个）；`fillSizes` 记 `fail` 并剔除坏图（提示剔了几张）；`scanImages` 新增 `pickUrl`：占位 src 自动回退 `data-src` | `test-image-util` **127/127**（新增 9 条）+ `test-grab-scan` **10/10**（离线复刻翻车形态）；新增 `tools/e2e-grab.py`（10 条断言，已接入 `e2e-all`）；**端到端实测 10/10**（截图 `deliverables/assets/e2e-grab-modal.png`：7 张、尺寸全回填、缩略图可读、无遮挡无裂图）；`health-check --full` **9 项全过「可以发」**（10/10 套件、34/34 单测 1381 断言）。端到端同时暴露并修掉 3 个单测看不到的问题：①未解码小图标混入清单（回填后没过门槛）②弹窗被猫抓原生提示条 `#TipsFixed`(9999) 压住（z-index 400/450 抬到 10000/10005）③`loading=lazy` 在后台标签页不加载导致「整批红单跑绿」（断言前 bringToFront + 复位 imgMinSize/imgBgScan） | `deliverables/reviews/2026-11-12-抓图不可用复盘与对标.md` | 2026-11-12 |
| B-80 | **P2 · 「图片」计数恒 0 + 「图片嗅探」是死开关**（2026-11-12 复盘发现） | popup 顶部「图片 N」统计的是网络嗅探条目（按内容类型白名单 `G.Type` 收），图片类型默认未启用 → 微博页恒 0，用户以为没图；设置里 `imgSniff` 开关**全仓无消费方**，纯摆设 | 建议：点「图片」这个 chip 直接打开抓图弹窗（数字由扫描结果回填），而不是把整页图片塞进媒体列表；死开关要么接上要么删 | 待拍板 | 同上 | 2026-11-12 |
| B-81 | **✅ 已完成真机验证 · 微博图片识别全错（苏哥 2026-11-13 截图：侧栏收到「新/上新/沸/辟谣」徽章 + 裂图，正文图 0 张）** | 真机诊断（登录态实例 dump）暴露三处：①`isWorthDownloading` 的「显示短边 ≥200」是**硬编码**，侧栏传 `minShow:48` 改不动它 → 微博正文图显示宽 133~542 全被挡；②头像原图 750×750、页面显示 52×52，按原始像素判拦不住，成了清单里的噪音；③**源码通道无条件跑**，把热搜徽章/logo/箭头图标（无 DOM、无尺寸）当图收进来；④`<img src="https://weibo.com/">` 这种站点写坏的假图进了列表（裂图）；⑤侧栏缩略图在扩展页 403（sinaimg 按 Referer 放行，`referrerPolicy` 与手动设头都无效），整屏空框 | 新增 `LIST_MIN_SHORT=80` 清单专用短边门槛（`isWorthDownloading` 支持 `minShort`，悬停仍 200）；`scanImages` 丢弃「图片地址 == 当前页面地址」的假图；源码通道改为**只在 DOM+背景都为空时兜底**（image-page + popup 两处）；新增 `vrMedia.headers` 消息 → 复用既有 `vrSetMediaHeaders`（DNR 按结果域名设 Referer、10 分钟自动清），侧栏**渲染前**调用 | 真机：微博首页 57 张 `<img>` → 清单 14~19 张**全是正文配图**（商品图/文字截图/视频封面），尺寸全部回填，无徽章无头像无裂图；缩略图 `naturalWidth=360` 正常显示；`vrImgResolve` 命中 `/large/` 原图（tried:1, image/jpeg）；`test-image-util` 127/127、`test-grab-scan` 10/10、`e2e-grab` 10/10、`e2e-popup` 8/8、冒烟 6 项全过。证据截图 `deliverables/assets/diag-weibo-sidebar-005335.png` | `deliverables/reviews/2026-11-12-抓图不可用复盘与对标.md` | 2026-11-13 |
