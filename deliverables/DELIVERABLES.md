# 苏哥的钓鱼竿 — 产出物管理规范

> 版本：v3.9 ｜ 日期：2026-11-04 ｜ 状态：✅ 已生效
> 一句话：**产出物有家、有版本、有状态、找得到。** 本文件是 deliverables/ 目录的宪法，新增任何产出物前先读这份。
> v3.0 变更（2026-11-04）：**合并两条开发线**——本地线 v1.43（资源库 P1–P4 / B站抖音微博小红书 IG / m3u8 合并）与远端线 v2.8（图片 I1–I6 / YouTube 下载 / 资源库模块化重构 / 设置页重设计）。两侧变更记录全部保留，按线分段列出。

### 远端线（另一台电脑，v1.8 → v2.8）
> v2.8 变更：登记 YouTube 播放器下载（`js/yt/` 五件 + `lib/youtubei.min.js` + 三份文档 + 八个探针/验收脚本 + 两张截图）；补登图片线 I4（浮标 + 清单面板）；`HANDOFF.md` 升 v2.1（16 套 571 条基线、新增 §6.7 多线覆盖 / §6.8 行尾两个坑）；`TESTING.md` 升 v1.6（§21 I3 / §22 I4 / §23 YouTube）。
> v2.7 变更：S5 删除与回收站——`trash.js` / `trash-ui.js`、软删除批次与清单、恢复/彻底删除/清空、右键菜单与抽屉，验收 27/27。
> v2.6 变更：S4 查看器 v2——`lightbox.js` / `video.js` / `keyboard.js`、图片缩放拖拽、信息面板、缩略图带、视频自绘控件、键盘与连播；概览默认收起；验收 27/27。
> v2.5 变更：资源库 v2——概览 KPI / 平台分布 / 博主速览 / 真表格 / 日期分组，验收 29/29；截图更新为 6 张。
> v2.4 变更：新增资源库页面（全宽大图 / 全屏查看器 / 懒缩略图）与 22 条验收；popup 统一蓝灰；登记 `FRONTEND-UI-SYSTEM.md` 与 5 张截图。
> v2.3 变更：全局更名「苏哥的钓鱼竿」（扩展名 / 界面 / 文档 / locale）；关于页补上游署名与本 fork 增量、开发手记与数据块。
> v2.2 变更：登记设置页重设计三件（方案 `OPTIONS-REDESIGN.md`、样式/交互改造、8 张验收截图）。
> v2.1 变更：登记 S2 索引两件（`indexer.js` / `cdp-indexer-test.py`）；`db.js` 升 v1.1（handle 读写）、`settings.js` 升 v1.3（索引维护入口）、LIBRARY-PLAN 升 v2.0（§13.11 索引规格 + S2 完成）。
> v2.0 变更：登记交接文档 `docs/HANDOFF.md`（接手 AI 入口，含现状/环境/代码地图/测试基线/坑/未完成）。
> v1.9 变更：登记 S1b 迁移三件（`migrate.js` / `migrate-ui.js` / `cdp-migrate-test.py`）；`settings.js` 升 v1.2、`options.html` 迁移面板；S1a 脚本 B5 断言随按钮启用同步；LIBRARY-PLAN 升 v1.8（§13.10 迁移规格）。
> v1.8 变更：登记自动入库三件套（`db.js` / `sw-library.js` / `cdp-index-test.py`）+ `parseRelPath` 与 SW 消息转发；`test-path.js` 升 v1.1（57/57）；自动入库调研文档转「已实现」。

### 本地线（这台电脑，v1.2 → v1.43）
> v1.2 变更：M7 popup 浅色重设计整合产出物登记（浅色覆盖层/重画外壳/五态回归截图/三个新测试脚本），popup 重设计原型 v2 与方案说明转「已定稿」（苏哥拍板方案 A），v1 原型按 §5.1 归档。
> v1.3 变更：M9 下载历史面板 / M10 侧边栏模式 / M11 多段自动合并（离屏直连管线，ADR-028）产出物登记；补充 3 个里程碑验收脚本 + 3 张回归截图。
> v1.4 变更：B站「完整视频」下载入口产出物登记（ADR-029，参考 b站视频下载助手）；决策记录主线更新至 ADR-029。
> v1.5 变更：B站 1080P 高清路线（DASH + 页面内 mp4box 合成）产出物登记；新增 `lib/mp4box.all.min.js`（第三方库已登记）、`tools/bili-mux-lab.py`+`mux-attempt.js` 合成实验室、`tools/bili-1080-probe.py` 清晰度扫描器、`tools/test-bili-1080.py` 双路线端到端脚本。
> v1.6 变更：页内悬浮下载按钮（ADR-030：右上角/矩形命中）与抖音取流命名（ADR-031：详情接口 + DNR Referer 回放）产出物登记；新增 `js/video-overlay.js`、`js/douyin.js`、`js/bili-whole.js`、overlay 测试脚本与 `assets/overlay-douyin.png`；决策记录主线更新至 ADR-031。同日补微博：通用直链优先页面 fetch→blob→`<a download>`（微博 Referer ACL），失败回退 downloads+DNR；微博 `$render_data` 取作者/正文命名（ADR-031 补记）。
> v1.7 变更：ADR-034 YouTube/Instagram 调研；ADR-033 P1 微博主页「半手动批量」落地（`js/bulk-profile.js`：滚动记录图片、播放记录视频、File System Access 按作者建目录写盘）；登记主页批量产出物与 TESTING §10.4。
> v1.8 变更：ADR-033 P1 扩展到 X 主页（照 XBD：忽略转载/已下载、图片视频筛选、反选、清除记录、稳妥限速）；修复 X 单条按钮 mediaId；新增 ADR-035 媒体库（固定目录 + HTML 管理页 + CRUD）方案。
> v1.9 变更：ADR-036 小红书反爬评估：不做主页自动批量，建议只做「详情页单篇」；新增主页网格/详情 state/CORS/461/471 实探结论。
> v1.10 变更：媒体库方案 `docs/MEDIA-LIBRARY-PLAN.md` + 可交互 HTML 原型 `deliverables/prototypes/media-library-v1.html` 登记；ADR-035 状态更新为「方案+原型完成，待实施」。
> v1.11 变更：ADR-036 A 方案落地——小红书详情页单篇适配（`vrXhsScan` 只读 `__INITIAL_STATE__`，图片/视频记录，`video-rod/小红书/作者/` 下载，3–5 秒限速、单次 20 条、失败暂停）。
> v1.12 变更：媒体库原型 v2（独立图片/视频预览页 + 鼠标/键盘快捷方式 + 资源树搜索/懒展开）；开源组件选型与大量数据管理方案登记。
> v1.13 变更：ADR-037 下载去重——批量下载前按稳定媒体标识查 `vrMediaSeen` 账本，重复直接跳过并显示「跳过重复 N」；内容哈希作为媒体库入库兜底。
> v1.14 变更：媒体库原型 v3（浅色大厂后台视觉：白色侧栏/蓝色主色/卡片统计/精致网格；预览页白底工具条 + 深色画布 + 白色信息栏）。
> v1.15 变更：媒体库原型 v4（标准企业中后台 + 平台品牌色 + 彩色统计图标 + 标题渐变/下划线 + 平台分布徽标 + 更多图标/表情）。
> v1.16 变更：v4 预览键盘映射按通用查看器调整——↑/↓ 切换媒体；←/→ 视频快退/快进 5 秒，图片在同一博主专辑内上一张/下一张。
> v1.17 变更：小红书主页/收藏/点赞半手动收集器 + 可选自动补全详情（`js/xhs-batch.js` + `vrXhsAutoQueue`）；收集器实测 30 条入队，自动补全首轮落盘 22,696 B 但计数异常待复验。
> v1.18 变更：媒体库 P1/P2 落地——`library.html` + `css/library.css` + `js/library.js`；File System Access 选目录/递归扫描/`_index/index.json`、资源树/搜索/类型标签/网格、图片视频预览与键盘、重命名/删除到 `_trash`；popup 新增入口。
> v1.19 变更：X 单条下载按钮改为高对比蓝色胶囊「下载」，补「下载中/已保存/失败」反馈；实测目标推文落盘 1,336,765 B MP4。
> v1.20 变更：设置页 UX/UI 重构——五组语义色卡片（下载位置蓝/命名紫/画质橙/面板绿/媒体库青）、彩色开关、红色危险操作；新增“启用媒体库”开关与“打开/选目录”入口；截图 `deliverables/assets/settings-after-library.png`。
> v1.21 变更：X/微博/小红书主页右侧批量抽屉（自动展开、收起标签、一键保存/收集并下载）；所有保存默认落 `Downloads/video-rod/<平台>/<作者>/images|videos/`，X/微博批量不再弹目录选择器。
> v1.22 变更：取消批量条数上限（只保留 3–5 秒/条 + 失败即停）；X fxtwitter 429 退避；实测 NASA 8 条完成 7 条、跳过 1 条重复；媒体库增加自动下钻 `video-rod` 与重置目录。
> v1.23 变更：媒体库目录选择修复——移除 `showDirectoryPicker` 固定 `id`（被记忆到 F 盘空目录），改 `startIn:'downloads'`；新增目录内容校验、无效句柄清除和明确路径提示（ADR-040）。
> v1.24 变更：对照抖珍藏 2.8.44，确认同为 File System Access；媒体库改独立 popup 窗口触发选择器，补 `requestPermission({mode:'readwrite'})` 与“等待系统窗口”状态。
> v1.25 变更：移除媒体库目录白名单硬校验（`hasMediaEntries`）；任何有读写权限的目录都可选，空目录显示 0 个文件，不再弹“目录不对”。
> v1.26 变更：媒体库根目录定为 F；排除 `xbd-downloader`/`老黄的分享` 外部目录；修复 `FileSystemFileHandle.move` 重命名；新增复盘 `docs/INCIDENT-20261019-LIBRARY-DIR.md` 与 `assets/library-after.png`。
> v1.27 变更：媒体库 P3 落地——选择/全选/反选/清除、批量移动到 `平台/博主/images|videos`、批量删除到 `_trash`、标签 `_index/tags.json`；`performMove` 只对同名冲突重试；交接文档同步 P3 已验收。
> v1.28 变更：媒体库 P4 落地——图片缩略图持久化 `_index/thumbs`、SHA-256 查重 `_index/hashes.json`、本地视频 `preload=metadata` 可 seek；22 文件发现 3 组/9 个重复；`223fdc1`。
> v1.29 变更：小红书修复——卡片 token 提取、`mediaV2` 视频 mp4、自动补全 files/skipped/errors 计数、详情 state 重试；视频 mp4 31,344,820 B；收藏/点赞页 token 20/20、30/30；`1e93106`。
> v1.30 变更：Instagram P1 落地——`js/instagram.js` 帖子/Reel 按钮、当前已加载图片/视频提取；`vrIgDownload` 落 `video-rod/instagram/<作者>/images|videos`；fixture 15,324 B；真实登录态待验（`6bd6d19`）。
> v1.31 变更：单次下载去重——`vrVideoDownload`/`vrQuickDownX` 查 `vrMediaSeen` 并成功记账；同一 X 视频第二次 `skipped`，无重复文件（`24b59e2`）。
> v1.32 变更：媒体库逐按钮全量验收——27 项搜索/筛选/类型/排序/视图/预览/标签/重扫/设置通过；新增 `docs/LIBRARY-FULL-TEST.md`；全屏与原生 picker 环境限制已记录。
> v1.33 变更：媒体库视频首帧缩略图——`js/library.js` 新增 `videoFrameBlob`（隐藏 `<video>` → seek → canvas → JPEG），`thumbUrl` 统一图片/视频，`renderGrid` 视频卡改真实缩略图 + 渐变兜底；`css/library.css` `.thumb.is-video`；隔离环境实测 480px 非纯色（2026-10-19）。另：F 根目录 5 个历史文件归档完毕，测试残留目录已清。
> v1.34 变更：媒体库预览「进入视频自动播放」——`js/library.js` 预览视频分支 `preload='auto'` + `video.play()`；带声被拦则退静音自动播兜底；切图/关闭仍暂停。2026-10-19 苏哥实测通过。
> v1.35 变更：YouTube 入口彻底移除（ADR-043：页面悬浮按钮 + popup 限制横幅）；小红书图片「去 CDN 后缀取更大图」尝试（ADR-044，失败回退原地址，未真机验证）；F 库整理（`小红书/` 并入 `xiaohongshu/`、测试残留清空）；媒体库视频首帧缩略图端到端真机通过、去重 DED1/2/3 真机验证通过。
> v1.36 变更：媒体库缩略图**自动补缺**（`scan()` 收尾 `fillMissingThumbs()` 自动生成缺失缩略图写 `_index/thumbs`，视频串行/图片并发，无需手动）；抽帧超时 8s→20s、多视频不再同时解码、失败不缓存可重试；预览视频**默认带声**（被策略拦才静音，下次点击自动恢复）。
> v1.37 变更：媒体库**全屏按钮复验通过**（此前失败因标签页在后台未聚焦）；LIBRARY-FULL-TEST §4.1 补记、HANDOFF §4.8/§5 同步。
> v1.38 变更（2026-11-04）：**建立待办唯一真源 `docs/BACKLOG.md`**，其余文档待办条目冻结为历史；修正 4 处硬伤（HANDOFF 仓库路径 E→D、决策记录版本 038→044、TESTING §8 M9/M10 待办回填、BUILD-PLAN 合并路线 A/B/C 关闭）；BUILD-PLAN 追加「M12 及之后」补录（M12–M23）与各里程碑「后续状态」追加行；登记 OmniGet 参考价值评审。
> v1.39 变更（2026-11-04）：媒体库重设计原型 v1（`deliverables/prototypes/media-library-redesign-v1.html`）与四张状态截图登记；确立媒体库设计系统（近黑主色与 popup 统一、Lucide 内联图标、无框架无 webfont）。
> v1.40 变更（2026-11-04）：原型升 v1.1，预览信息栏新增「来源」溯源块（已记录 / 从目录推断两态）；登记媒体溯源元数据方案 `docs/MEDIA-METADATA-PLAN.md`（A 档待施工）。
> v1.41 变更（2026-11-04）：原型升 v1.2，新增视频控件条 / 图片缩放工具栏 / GIF 帧控条 / 快捷键面板四态；登记媒体查看器方案 `docs/MEDIA-VIEWER-PLAN.md`（含 Plyr 已废弃等选型情报，A/B/C 三档分期）。
> v1.42 变更（2026-11-04）：动图扩到 GIF/WebP/APNG 三格式并单列筛选；来源状态徽标改为「完整/部分/未记录/推断」四态，不再把缺链接标成已记录。
> v1.61 变更（2026-11-04）：**发布可行性评估成文，决策=暂不发布先自用**。新增 `docs/RELEASE-FEASIBILITY.md`：五道关（GPL-3.0 强制开源 / 大会员与 YT 功能裁剪 / 商店审核 / 脱敏清单 81 文件实扫 / 维护成本）、三步走（GitHub 开源→裁剪→商店）、触发再评估条件。BACKLOG 增 N-09（暂缓留档）。README 同日已全面更新（v1.60 前后两笔）。
> v1.60 变更（2026-11-04）：**去重引用方案成文**（本会话只出方案不动页面，页面归新会话）。苏哥定方向「不同链接同内容本地只存一份，后面只引用——网盘原理」。新增 `docs/DEDUP-REF-DESIGN.md`：库层引用（SHA-256 + 引用计数，保住可读目录） vs CAS（hash 文件名，否决）；命中流程/四条引用语义规则/统计双口径/老库懒补算/三层防重合拢/DD-1~7 验收用例/估 2.5 天。BACKLOG B-12 同步改写。
> v1.75 变更（2026-11-05）：**ADR-051 产品定位原则入册——通用优先、专站增强**（苏哥："有图片就可以单独下载或者批量，有视频就可以单独下载或者批量，这才是我们设计的意义"）——花瓣**不做单站适配**：B-19 撤销、新立 B-20/V9 通用通道验收（A5 为验收料，单张/批量/懒加载三点）；新素材 A8（B站 BV 视频回归）、A9（IG 无登录态 reel——B-03 从"待账号"转"可试"）登记 TEST-ASSETS §3；TEST-ASSETS 增 §5 定位原则存档；BUILD-PLAN-STAGE V 表同步（映射 19/19 无遗漏）。
> v1.74 变更（2026-11-05）：**实测素材登记 `docs/TEST-ASSETS.md`**（苏哥给料 7 条：小红书图文×2、YouTube Shorts、X/NASA 批量 10、花瓣 pin、抖音短链、微博主页批量 10）——测试方法定稿：**主=星愿浏览器 CDP 直驱（登录态现成，拉起走 taskkill+删 SingletonLock+等 5 秒流程），备=Playwright 可控浏览器**；登录态覆盖 X/小红书/微博/抖音/B站/谷歌 ✅，IG ❌ 继续挂 B-03。BACKLOG 更新：B-02/B-13 素材阻塞解除、B-16 方案改星愿主案、**新增 B-19 花瓣口径待苏哥定**（新平台适配 vs 仅网页通道测试料）。V1 加密 HLS 仍缺，设计线去找公开测试流。
> v1.73 变更（2026-11-05）：**四悬项全部拍板，文档定稿**——新增 **ADR-050**（①去重 R1+R2 照批网盘语义 ②查看器只引 gifuct-js、否决 Media Chrome ③入口层四项全照原型批 ④V1/V2 素材改设计线找公开测试料）；`BUILD-PLAN-STAGE.md` 升 **v1.1 定稿**（无待决项，可交编码会话按序施工）；BACKLOG B-08/B-12/B-18 阻塞解除、B-01/B-02 素材来源更新、B-08 描述纠偏（自绘控件 v2.6 已有）。
> v1.72 变更（2026-11-04）：**文档三件套开工（ADR-049 落地）**——① `docs/DECISIONS.md` 追加 **ADR-049 全站切舞台皮肤**（亮色不留/不留功能/原型真源/先出文档，四决策入册）；② 新建 `docs/DESIGN-SYSTEM-STAGE.md` v1.0（舞台 token 唯一真源：暖黑族/暖纸白/舞台金钉死值表、字体三档、间距铁律 26px、组件规范 10 条含去重铁律、反例自查清单）；③ 新建 `docs/BUILD-PLAN-STAGE.md` v1.0（T0 合并验证锁门→T1-T6 换皮与新功能→F1-F9 功能补债→V1-V8 待料验证，**BACKLOG B-01~B-18 全 18 条映射覆盖 0 遗漏**，串行主线+4 个待拍板项）；BACKLOG 头部加施工顺序指针。
> v1.71 变更（2026-11-04）：**全原型系统查重 + 标签组一行化**（苏哥："下载时间和保存时间不也重复了吗？检查整个原型重复内容"）——详情面板再删四重复：①下载时间（=保存时间）②平台行（面包屑+标题角标已两处标明，第三处不留）③作者 ID（作者行 @handle 已展示）④格式/文件名上轮已删；标签组改「标题+标签+添加」一行化（实测中线差<16px）。JS 同步删 4 处写入，引用残留 0，切视频/图片/动图卡回归 0 错误；截图 `proto-stage-dedup.png`。查重原则成文：**凡可从面包屑/角标/路径推导的字段，详情面板不单列**。
> v1.70 变更（2026-11-04）：**详情面板再消重**（苏哥点名"格式和文件名重复"）——删「格式」「文件名」两行（扩展名=路径末段后缀、文件名=路径末段，路径行已全包含）；JS 同步删 pvFmt/fmtText/pvFileName/base/extMap/fname 计算段，引用残留 0；文件组终态=大数字卡（分辨率/大小/时长）+ 保存时间 + 路径（带复制）+ 帧数（仅动图）。CDP 0 JS 错误，截图 `proto-stage-detail2.png`。
> v1.69 变更（2026-11-04）：**详情面板（预览器右侧）四病同治**（苏哥："没对齐"+UI 经理自查）——① 大数字卡与列表前三行数据重复：删大小/分辨率重复行，帧数行仅动图显示（信息不丢）；② dt 列 58→76px + nowrap，"保存时间/下载时间"不再折行，值列左缘实测统一 1156px；③ 组头 space-between 导致标题忽左忽中忽右：改 flex-start + 徽标 margin-left:auto，三组左缘 1070 对齐；④ JS 写 pvThirdK 抹掉图标致标签列参差：改 innerHTML 保留图标。CDP 实测 0 JS 错误，截图 `proto-stage-detail.png`。
> v1.68 变更（2026-11-04）：**顶部留白修复**（苏哥："面包屑不要贴近上面，留点空"）——main 顶部 padding 0→26px（小屏 18px），面包屑距顶实测 33px；截图 `proto-stage-air.png`，0 JS 错误。
> v1.67 变更（2026-11-04）：**统计条删除 + 重扫/设置上右上角**（苏哥："格子毫无作用，下面就有重复的；重新扫描和设置放最上面右上角，不然空荡荡"）——stats-inline 整条移除（数字与工具条 seg tabs 完全重复），扫描态降为标题旁 11px 小字（绿点），sCount 等 4 个写入加 setTxt 守卫；重新扫描/设置 移入 `.crumb-row` 右侧（右上角），工具条 .tools 只留「选择」。CDP 回归全 True：统计消失/扫描小字同行/右上两按钮/抽屉/重扫 toast/搜索，0 JS 错误；截图 `proto-stage-final.png`。
> v1.66 变更（2026-11-04）：**标题行收纳一切 + 设置入资源库**（苏哥四点）——① 删「来自 X 个平台·Y 位博主」与「N 分钟前扫描完成」独立行，扫描态并入统计条末格（绿点+文字）；② 搜索框并入标题行右侧，h1+统计+搜索一行收纳（中线对齐实测 True）；③ 顶栏整行取消：选择/重新扫描/设置 挪到工具条「最新保存」左侧，**「选择目录」删除**（与侧栏「更换目录」重复）；④ 新增**设置抽屉**：点「设置」在资源库内右侧滑出（下载目录/扫描/索引/回收站/文件名规则 五项即改即用 + 完整设置出口），不跳 options；补 sprite i-search/i-settings，pageSub/topbar 三处 JS 引用加守卫；CDP 回归 0 JS 错误，搜索/⌘K/Esc 正常，截图 `proto-stage-compact.png` / `proto-stage-settings-drawer.png`。
> v1.65 变更（2026-11-04）：**统计条并入标题行**（苏哥："为啥要2行，放一块，全部素材右边跟着各种，格子分开好看"）——`media-library-stage-v1.html` 的 stats-inline 从 pagehead 右侧独立行移入 `.ph-title-row`，紧跟 h1 同行；样式升级为连排格子（segment 条：外框圆角 9px + 格间细竖线 + hover 淡底 + 等宽数字）；pagehead 高度 119px，右侧空白消失；CDP 实测同行对齐 True、0 JS 错误，截图 `proto-stage-oneline.png`。
> v1.64 变更（2026-11-04）：**舞台套件落地**——① 苏哥拍板统计款 B（一行内联）+ 树款 C（编号索引），已落回 `media-library-stage-v1.html`（保留 sCount 等 id 与折叠交互，编号按 TREE 全量预计算不漂移，占比条统一金色）；② popup 与设置页出舞台版：`popup-stage-v1.html`（纸感浅→暖黑深整体翻转，金色按钮文字翻深）、`settings-stage-v1.html`（D 影院深色 token 换舞台金 + 默认主题改 dark）；三页 Edge 无头 CDP 实测 0 JS 错误，截图 `proto-stage-bc-v1.png` / `proto-popup-stage-v1.png` / `proto-settings-stage-v1.png`。
> v1.63 变更（2026-11-04）：**舞台皮肤局部款式对比** `deliverables/prototypes/stage-parts-options-v1.html`——苏哥嫌弃统计卡（彩色图标块）与资源树（彩点+彩头像块），两块各出 4 款舞台系选项（统计：金线条/一行内联/四格连排/环形小图；树：纯文字金线/金环彩点/编号索引/标签纸条），只改这两块其他不动；Edge 无头截图 0 JS 错误 `assets/stage-parts-options-v1.png`；待苏哥回编号后落回 `media-library-stage-v1.html`。
> v1.62 变更（2026-11-04）：**舞台皮肤原型** `deliverables/prototypes/media-library-stage-v1.html`——苏哥拍板九方向中的「舞台」，按其配色与设计风格对 `media-library-redesign-v1.html` 做**纯换皮**（结构文案零改动）：剧场暖黑 #100F0E 族底、舞台金 #E8B04B 强调、暖纸白文字、悬停聚光/选中金色光晕增强；冷蓝黑与 #FF7A45 橙全部清零残留；Edge 无头 CDP 实测 0 JS 错误，截图 `assets/proto-stage-dark.png` / `-preview.png`。误产出的「今晚的剧目」文案版 `library-stage-prototype-v1.html` 已删除（方向误解，苏哥原话驳回）。另：九方向可视化速选页 `deliverables/prototypes/library-redesign-options-v1.html`（可切换九向带假数据的可玩对比屏）随本批产出，配套断言脚本 `tools/cdp-library-options-test.py`。
> v1.61 变更（2026-11-04）：**资源库重设计第二辑四方向** `deliverables/reviews/2026-11-04-library-redesign-directions-b.md`（天文台/宋册卷轴/唱片墙/标本柜，与第一辑五向在色温·材质·交互哲学三轴零重叠；两辑合计九方向待苏哥九选一或杂交；第二辑内推荐天文台首选）。
> v1.60 变更（2026-11-04）：**资源库页面重设计五方向评审稿** `deliverables/reviews/2026-11-04-library-redesign-directions.md`（暗房/档案室/仪表盘/舞台/目录，五个风格立场方向，每个覆盖 12 细节维度+线框+响应式；推荐暗房首选、舞台次选）；新建设计上下文 `.impeccable.md`（impeccable 技能的项目档案：用户/场景/调性/约束）。
> v1.59 变更（2026-11-04）：**苏哥四连改**。①收藏夹再挪：顶栏下拉→**侧栏底部**（索引区上方按钮，向上弹面板），四个预置栏目删（「我只要收藏夹」），已加星标改动态（有星标才出现），初始空态；②**删库内「查重」按钮**——苏哥质疑「下载不允许重复就不会有重复」，方向修正为下载时 MD5 前置防重（B-12 改写）；③信息栏字段图标黑色实心 bug 修复（k-ico 漏 fill:none）；④资源树改**折叠式**（平台行点击展开/收起博主，默认收起只 5 行，搜索自动展开——治「很多平台博主甩长滚动条」）；⑤**全站换思源字体**（Noto Sans SC 正文 + Noto Serif SC 标题，OFL 免费商用；Windows 宋体深色发糊是「字体奇怪」根因；正式实现=子集化自托管）。verify-side-fav.py 12/12 + 三套回归 9/9、9/9、6/6 全绿，0 JS 错误。
> v1.58 变更（2026-11-04）：**对抗性自查 6 项修复**。苏哥点名收藏夹侧栏常驻没必要 → 顶栏「收藏夹 ▾」下拉（节点搬移 id 零改动）；自查另修 5 项：标题 36 项 pill 删（三处重复计数）、选择目录橙钮降级（低频不占最强强调色）、封面渐变降饱和（52%→26% + 深色再压，让位给功能色）、侧栏底部收纳（删 index.json 行）、智能夹漏斗随菜单走。verify-fav-menu 7/8（1 条 display:none 假阴性，截图证实）+ 三套回归 9/9/9/9/6/6 全绿、0 JS 错误。截图 audit-1~5。
> v1.57 变更（2026-11-04）：**首页默认 D 深色（H-12 修订 H-8）+ 图标规划感**。苏哥看实图：①首页「还不如用 D 的深色」→ 默认主题改 dark，B 纸感降为可切换浅色；②统计卡图标难看 → 彩色徽章（素材橙/图片蓝/动图紫/视频绿，浅色下自动加深）；③信息栏要「表情颜色加粗边框规划感」→ 用彩色 SVG 字段图标（14 个，非 emoji）+ 分组微卡片（边框+圆角）+ 三组色系（文件青/来源橙/标签紫）+ 组色点。新增 verify-dark-ui.py：6/6 PASS + 定稿回归 9/9、0 JS 错误。DESIGN-SYSTEM-BD 口径同步修订。
> v1.56 变更（2026-11-04）：**资源库同行调研 + 三增量进原型（原型升 v2.1）**。调研 Eagle/Billfish/digiKam/Lightroom/TagStudio(10k★)/booru/Pinterest/资源管理器 → `docs/LIBRARY-BENCHMARK.md`（三档归类：已有对标 / 值得补 / 明确不做）。结论：组织层已到 Eagle 档位（收藏夹=Lightroom 智能集对标，连播预览领先），短板在浏览性能与键盘层。落地三增量：①空格键快速预览（预览内让位给视频播放暂停）②搜索交集/排除语法（`词1 词2`、`-词`）③「把当前筛选存为智能收藏夹」（漏斗按钮，favHas 支持 smart 规则）。CDP 9/9 PASS + 卡片定稿回归 9/9、0 JS 错误。BACKLOG：B-10 加标签计数/别名预留、B-14 加分级加载拆解；UI-IMPL-PLAN 验收清单 +3 条。
> v1.55 变更（2026-11-04）：**第一性原理拍板 + 竞品印证落地**。苏哥授权按「用户要很快很方便地下载」定夺，补竞品调研（VDH 800万/Fatkun 400万/Image Downloader/Chrono/Download All Images/B站助手/Pixiv Downloader/上游猫抓）写进 FUNCTION-AUDIT-ENTRY §5-6——**关键发现：去重防重复是全行业共性缺口（仅 Pixiv Downloader 做了），钓鱼竿有 IndexedDB 可做成差异化**。拍板 6 项全落地：媒体控制砍、齿轮一步直达完整设置页（拆快捷抽屉层）、页面侧统一深色玻璃+平台色点胶囊、已存标记全端铺开（popup 行内+批量抽屉）、popup 每行独立下载键（共性2）、主按钮恒最高画质（N-05）。popup v3.2 CDP 15/15、页面侧 v2 CDP 17/17、0 JS 错误。
> v1.54 变更（2026-11-04）：**入口层 + 页面侧原型补齐，全站设计统一**。① 新增**页面侧注入 UI 原型** `page-ui-prototype-v1.html`（7 平台场景：视频浮层/图片悬停/清单面板/X/微博/小红书/IG/YouTube，14/14 实测 PASS，配色忠于现有代码的深色玻璃+蓝）；② 新增**popup 成品原型** `popup-redesign-v3-bd.html`（方案A收网 + B纸感 token，与媒体库/设置页交叉核对 token 一致，13/13 实测 PASS）——原 popup v2（teal/navy/blue 三方向探索）作废；③ `DESIGN-SYSTEM-BD.md` 补「入口层已套 B / 页面侧故意用深色玻璃不混用」说明；④ REQUIREMENTS-CHECKLIST 增 H-10 入口层统一、H-11 设置两层待合并。附 pageui-*.png / popup-v3-*.png 共 14 张截图。
> v1.53 变更（2026-11-04）：**原型定稿**。苏哥拍板去掉卡片底部路径行（H-7，实测 9/9 断言 + 0 JS 错误）；REQUIREMENTS-CHECKLIST 升 v1.1（H-7/H-8/H-9 定稿决策）、UI-IMPL-PLAN 升 v1.1（B+D 令牌 + 卡片去路径进验收清单）；新增**前后交互契约** `docs/INTERFACE-CONTRACT.md`（IndexedDB 结构 / file 条目字段权威表 / 消息通道 / 写入方清单 / pageUrl 重建丢字段等两坑）与**溯源预研** `docs/PREWORK-PROVENANCE.md`（结论：能做、半天工作量、埋点收在 vrDownloadWithName 漏斗、发现 pageUrl 白名单既有隐患）；BACKLOG B-07 更新为预研完成待批。
> v1.52 变更（2026-11-04）：**全站换皮 B+D**。主原型与设置页统一到暖白纸感（#F7F4EE + 赭石 #A8502E），暗色模式整套换成 D 影院（#0A0B0E + 暖橙 #FF7A45）；预览层用 `.preview` 局部变量覆盖固定走深色。封面渐变整体提亮（原暗部 14% → 26%）、封面色系重排（去紫色扎堆）、平台徽标按主题切换白底/深底。圆角体系收敛到 3 种。新增 `docs/DESIGN-SYSTEM-BD.md`。**只改 CSS 与 token，未动一行 JS**。
> v1.51 变更（2026-11-04）：新增**界面风格探索** `style-explorations-v1.html`（四方向 + 控件对照，5 个标签可切）与说明 `docs/STYLE-OPTIONS.md`。苏哥反馈「整体设计、色调、图标、菜单都不太满意」，故先定视觉语言、再细化原型。
> v1.50 变更（2026-11-04）：原型升 v1.8，新增**收藏夹**（一级栏目）——侧栏独立区块（星标自动夹 + 手动夹 + 超过 5 个进管理抽屉）、收藏夹视图（复用主网格，叠加类型/平台/关键词筛选）、右键与批量「加入收藏夹」多选浮层、内联新建、管理抽屉（上移下移/重命名/删除）；空收藏夹独立空态；统计卡改为「素材/图片/动图/视频」使数字可加和（36=13+5+18）。PROTOTYPE-MAPPING 增 §14。
> v1.49 变更（2026-11-04）：原型升 v1.7，新增**播放速度选择**（8 档 0.1/0.25/0.5/0.75/1/1.25/1.5/2，浮层选档 + `>` `<` 键步进，视频与动图共用）；PROTOTYPE-MAPPING 增 §13（档位理由、交互、落地坑：`preservesPitch`、换 src 后 playbackRate 会被重置、动图帧间隔下限）。
> v1.48 变更（2026-11-04）：新增需求清单 `docs/REQUIREMENTS-CHECKLIST.md`（73 条，待苏哥补充）与 beUI 评估 `docs/BEUI-EVAL.md`；原型加「预览分层进入」动效（舞台→信息栏→胶片条依次落位，尊重 prefers-reduced-motion）。
> v1.47 变更（2026-11-04）：原型升 v1.6，补齐**操作类界面**（空状态三场景 / 索引进度 / 重命名 / 确认框 / 批量条）；新增**设置页原型** `settings-redesign-v1.html`（含文件名模板实时预览）；新增**界面落地技术文档** `docs/UI-IMPL-PLAN.md`（含类名映射表、三步策略、9 批次计划）。三份均**待苏哥审批**。
> v1.46 变更（2026-11-04）：新增就绪度评估 `docs/READINESS-20261104.md`（IndexedDB 承载力实测 1万/5万条 + 功能完成度自查）；附压测页 `deliverables/bench/db-bench.html` 与原始数据 `result.txt`；BACKLOG 增 B-14（虚拟滚动，实测硬瓶颈）、B-15（缩略图降规格）、B-16（多平台登录态实测方案）。
> v1.45 变更（2026-11-04）：登记阶段汇报 `docs/STATUS-20261104.md` 与增量影响分析 `docs/IMPACT-ANALYSIS-UI-REDESIGN.md`；按影响分析结论，在 `MEDIA-VIEWER-PLAN.md` / `MEDIA-METADATA-PLAN.md` 顶部加失效警示（不删正文，保留调研记录）。
> v1.44 变更（2026-11-04）：原型升 v1.5，补画**回收站抽屉**与**右键菜单**（这两块代码里已有、原型原先没画，照原型改会丢功能）；加 YouTube 平台条目与链接规则；信息栏长值改单行省略（悬停看全），列表「保存」列改用真实时间。新增 `docs/PROTOTYPE-MAPPING.md` —— 原型 ↔ 代码模块 三方对照，含 17 个模块落点、字段级差异、键盘矩阵差异、9 步施工顺序。
> v1.43 变更（2026-11-04）：**信息栏 v3**——v1.3 误把「乱」理解成「信息多」而去删字段，已推翻；改为分组 + `<dt>/<dd>` 两列对齐，文件组 6 项、来源组 5 项一项不少；修正视频格式误显示 JPEG、补回保存时间。

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
├── .work/                 # 🧹 本机临时工作区：不进 git，可整体删除
│   ├── profiles/          #   测试用 Chrome profile（原型回归 / P0 探针）
│   ├── media/             #   测试媒体样本（probe.jpg / probe.mp4）
│   └── scripts/           #   一次性脚本草稿（正式脚本请放 tools/）
└── archive/               # 🗄️ 归档：上游遗产+作废产出物，留证不删
```

**分类原则**（拿不准时对号入座）：
- 写「项目应该是什么样」→ `docs/`
- 做出来一个「能给苏哥看/能点/能用」的实物 → `deliverables/`
- 「跑一下干个活」的脚本 → `tools/`
- 「只有本机跑一次、删了也不影响」的 → `.work/`（**不进 git**）
- 「没用了但删了心虚」→ `archive/`

### 1.1 工作区边界（v1.6 新增）

**硬规则：本项目产生的任何文件，都不允许散落在仓库外（如 `E:\test\` 根目录）。**

| 类型 | 落点 | 进 git？ | 可删？ | 例子 |
|---|---|---|---|---|
| 交付物 | `deliverables/` | ✅ | 仅按 §5 生命周期 | 原型、审计报告、预览图 |
| 工程文档 | `docs/` | ✅ | 仅按 ADEC 流程 | 方案、需求、测试策略 |
| 可复用工具 | `tools/` | ✅ | 否 | CDP 测试脚本、探针扩展 |
| 本机临时件 | `.work/` | ❌（已 gitignore） | ✅ 随时 | Chrome profile、测试媒体、草稿 |
| 归档留证 | `archive/` | ✅ | 否 | 上游遗产、作废原型 |

`.work/` 的说明与清理命令见 [.work/README.md](../.work/README.md)。

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
| 决策记录 | `docs/DECISIONS.md` | v1.23 | 进行中 | ADR-001~044；ADR-035~041 媒体库（方案/根目录 F/目录坑/重命名）；ADR-037 下载去重；ADR-042 Instagram P1；ADR-043 YouTube 入口移除；ADR-044 小红书去后缀（未真机验证） |
| 待办真源 | `docs/BACKLOG.md` | v1.0 | 已定稿 | **全项目唯一待办真源**：P0 两项待验（AES-128 加密 HLS、小红书去后缀）、P1 三项挂起、P2 八项明确不做、P3 四项工程债；其它文档的待办条目一律视为历史 |
| 下载去重（ADR-037） | `js/background.js`(vrMediaIdentity / vrDedupLoad / vrDedupSave / vrBulkDownload) + `js/bulk-profile.js` | v1.0 | 已实施 | 稳定标识 `site|workId|mediaId|kind|origin+pathname`（去签名参数）；持久账本 `vrMediaSeen` 上限 8000；同批 Set + 跨批账本；成功才写入；跳过数量回传 UI；内容 SHA-256 入库兜底待 P2 |
| 媒体库方案 | `docs/MEDIA-LIBRARY-PLAN.md` | v1 | 评审中 | 固定目录（平台/博主@ID/图片|视频）+ index.json + 扩展托管 library.html；File System Access + IndexedDB；搜索/筛选/播放/CRUD/回收站；四期实施计划；参考 Eagle/PhotoPrism/Immich/Stash/XBD；§10 开源组件选型；§11 大量博主/内容管理 |
| 媒体库 P1/P2（真实页面） | `library.html` + `css/library.css` + `js/library.js` + `popup.html`/`js/popup-videorod.js` 入口 | v1.0 | 评审中 | 选目录/句柄持久化/递归扫描/平台-博主-类型解析/`_index/index.json`；资源树/搜索/排序/类型标签/网格；图片视频预览与 ↑↓←→ 键盘；重命名、删除到 `_trash`；实施规格见 `docs/LIBRARY-IMPLEMENTATION.md` |
| 设置页 UX/UI 重构 | `popup.html` + `css/videorod.css` + `js/popup-videorod.js` + `deliverables/assets/settings-after-library.png` | v1.0 | 评审中 | 五组语义色卡片、彩色开关、红色危险操作；媒体库设置组（启用开关 + 打开/选目录）；顶部媒体库入口随开关显隐；截图验证 400×900 |
| 媒体库原型 v2 | `deliverables/prototypes/media-library-v2.html` | v1.0 | 评审中 | 资源树 平台→博主→图片/视频；独立图片/视频预览页；鼠标两侧箭头/底部胶片/滚轮缩放/双击/拖拽；键盘 ←→↑↓、Space、M、F、I、+/-/0、Esc、Home/End；树内搜索 + 每平台懒展开 |
| 媒体库原型 v3 | `deliverables/prototypes/media-library-v3.html` | v1.0 | 评审中 | 大厂后台浅色视觉：白色侧栏 + 蓝色主色 + 卡片统计 + 精致网格；独立图片/视频预览页；预览页白底工具条 + 深色画布 + 白色信息栏；鼠标/键盘快捷方式与 v2 一致 |
| 媒体库原型 v4（最新视觉） | `deliverables/prototypes/media-library-v4.html` | v1.1 | 评审中 | 标准企业中后台：平台品牌色徽标；彩色统计卡（emoji 图标）；标题渐变 + 下划线 + 平台分布徽标；卡片平台色顶边与彩色类型角标；资源树平台色；预览页 ↑/↓ 切换媒体、←/→ 视频快退/快进或图片同专辑切换 |
| 媒体库 HTML 原型 | `deliverables/prototypes/media-library-v1.html` | v1 | 评审中 | 可交互高保真原型：平台/博主/类型筛选、搜索、网格/列表、批量选择、详情检查器、上一张/下一张、最大化、图片缩放、视频播放、重命名/改标签/移动/删除/复制路径；已浏览器实开验证 |
| 智能起名引擎 | `js/naming.js` | v0.2 | 已定稿 | M0 产物；27/27 测试通过；M1 已接入 popup（新增 buildNameFromInfo） |
| 起名引擎测试 | `tools/test-naming.js` | v1.0 | 已定稿 | 27 条断言全绿；真实网址验证延至 M1 |
| popup 重设计三方向 | `deliverables/prototypes/popup-redesign-options-v2.html` | v2 | 已定稿 | 浅色 A/B/C 三方案可点原型；苏哥拍板方案 A「收网」（ADR-025），已全量整合进产品代码 |
| popup 重设计三方向（旧） | `archive/prototypes/popup-redesign-options-v1.html` | v1 | 已归档 | 首版交付（6 条数据、行高 59px）；苏哥确认 v2 后按 §5.1 归档；配套调研脚本 probe12.py/shot_v2.py 同迁 archive/prototypes/ |
| 重设计方案说明 | `deliverables/reviews/2026-10-17-popup-redesign.md` | 2026-10-17 | 已定稿 | 调研依据 + 现状诊断 + 推荐 A + 10+ 滚动规则 + 落地契约；方案 A 已施工完毕 |
| popup 外壳 | `popup.html` + `css/videorod.css` | v2.0 | 已定稿 | M1 按原型 v5 重写（v1.0）；M7 浅色重设计整合（v2.0）：浅色 token + 头部两行化 + 66px 干净行卡片 + 设置 4 组全屏视图 |
| popup 浅色覆盖层 | `css/popup-light.css` | v1.0 | 已定稿 | M7 新建；`#vrShell` 作用域内把猫抓 17 个原生变量钉为浅色（ID 特异性压制 dark media query，不动猫抓源码） |
| popup 交互层 | `js/popup-videorod.js` | v1.2 | 已定稿 | M1 打底（v1.0）+ M2 下载管线 + M3/M4 站点增强 + M5 图片批量（v1.1）+ M7 设置视图/高级工具入口适配（v1.2）；`currentPageUrl()` 改走 `chrome.tabs.get` |
| 猫抓内核最小触碰 | `js/popup.js` | v1.1 | 已定稿 | M7 三处最小改动：模板 meta 段显 `.name` + 新增 `.metasub`；url 面板显隐给 `.panel` 加/删 `vr-open` class；改名失焦同步标题文本 |
| M1 有头浏览器验收脚本 | `tools/cdp-m1-test.py` | v1.1 | 已定稿 | CDP 连有头 Chromium，DOM 断言+交互冒烟+状态截图；v1.1 增加 biliBanner/partChips/ytBanner 断言 |
| M1 面板截图（深色版） | `deliverables/assets/m1-panel-{list,settings,rename,dirmenu}.png` | 2026-10-17 | 已归档 | M1 深色外壳四态实拍；M7 浅色化后由 final-m7-plain/settings.png 取代 |
| CDP 公用客户端 | `tools/cdp_client.py` | v1.1 | 已定稿 | `Cdp` 类 + `find_ext_id` + `open_popup`；v1.1 内建「新建标签页 + 禁缓存」修掉复用旧标签页嗅探为 0 的坑 |
| M2 下载管线验收脚本 | `tools/cdp-m2-test.py` | v1.0 | 已定稿 | 真落盘 + 去重 + 完成态；测完自动清理本次新增文件 |
| M3+M5 合并验收脚本 | `tools/cdp-m3-m5-test.py` | v1.1 | 已定稿 | B站分P横幅 + 图片弹层 + 图片真落盘（`VR_DL=1` 开启落盘）；v1.1 加 try/except+traceback，崩了留现场不再空文件 |
| M5b 秒存/快捷键验收脚本 | `tools/cdp-m5b-test.py` | v1.0 | 已定稿 | 走 `vrSaveContextMedia` 真实路径验右键秒存落盘；CDP 真实派发 Alt+Shift+V 验快捷键 |
| SW 状态诊断探针 | `tools/cdp-probe.py` | v1.0 | 已定稿 | 读 service worker 的 G/cacheData 状态，排查「嗅探为 0」类问题用 |
| M2 面板回归截图（深色版） | `deliverables/assets/m1-regress.png` | 2026-10-17 | 已归档 | M2 阶段复跑 M1 断言集的实拍（防重构改坏）；浅色版现行 |
| P0 探针扩展（file:// 直读 + downloads 绝对路径） | `tools/probe-file-access/` | v1.0 | 已定稿 | 最小 MV3 扩展：`probe.html` + `probe.js`，结果写 `window.__PROBE__` 供 CDP 读取；三项全过（TESTING §9）。配套 `run-probe.py` 为 CDP 执行器，媒体默认在 `.work/media/probe` |
| 资源库原型回归脚本（CDP） | `tools/cdp-library-test.py` | v1.0 | 已定稿 | 原型 v1.3 的 A–I 九组共 42 条断言；2026-10-24 实测 **42/42 通过、控制台 0 错误**。端口 `CDP` 环境变量可覆盖（默认 9333） |
| 资源库原型验收截图 | `deliverables/assets/library-v13-{grid,lightbox,video}.png` | v1.3 | 已定稿 | 三态实拍：网格（星标+标签+键盘高亮）、灯箱（缩略图带）、视频弹层（进度时间气泡）；1440×900 |
| 资源库路径引擎 | `js/library/path.js` | v1.1 | 已定稿 | 平台识别 / 类型推断 / 博主段 / 三段目录拼装 / 长度保护 / `file://` 编码；被 popup、background（秒存）、x-button（X 按钮）三处下载链路复用；v1.1 新增 `parseRelPath()` 反解（relPath → 平台/博主/类型），供预登记 meta 与入库兜底使用 |
| 资源库设置页脚本 | `js/library/settings.js` | v1.3 | 已定稿 | options.html「资源库」分区：子目录名、落盘模式、FSA 授权、**校验落盘**（微下载反推真实根目录）；v1.1 索引状态/最近入库；v1.2 新增 `setSubdir()` 供迁移成功后同步子目录名；v1.3 新增「索引维护」三入口（重建索引 / 写快照 / 授权目录并全量扫描）与状态行 |
| 资源库迁移引擎 | `js/library/migrate.js` | v1.0 | 已定稿 | 新建。三种形态（改子目录名 / 换根 / 整理旧文件）共用：扫描（跳过 `.part`/`_migration`/`_回收站`/`_verify`/点文件）→ dry-run 分类（move/skip/conflict/blocked）→ 流式复制 → 校验（size + 首尾 64KB，可选 SHA-256）→ 删源 → 逐条落日志 → 逆序回滚；任一条失败即中止且不删源；迁移后同步索引 relPath/absPath |
| 资源库迁移面板 | `js/library/migrate-ui.js` | v1.0 | 已定稿 | 新建。设置页 `#vrLibMigPanel`：三方式切换、FSA 选目录（句柄缓存 IDB）、预演表格（前 50 行 + 计数/总大小）、执行进度条、回滚上次；成功后自动同步 `subdir` |
| 迁移端到端验收脚本 | `tools/cdp-migrate-test.py` | v1.0 | 已定稿 | **39/39**：OPFS 句柄注入（绕开原生目录选择器），覆盖预演不改文件、执行/校验、回滚、冲突口径、改名+索引同步、整理旧文件、采样校验、面板交互（TESTING §12） |
| 资源库索引服务（三源） | `js/library/indexer.js` | v1.0 | 已定稿 | 新建。`VRIndex.build({mode:'downloads'|'snapshot'|'full'})` + `reconcile()` + `snapshot()`；根解析三档（内存 / VRDB handle / 旧授权库·仅 custom）；downloads 只 upsert、snapshot/full 扫不到标 `missing` 不删除；重建保留 starred/tags/thumbKey/title；快照写 `<根>/_library/index-YYYYMMDD.json`（不存 absPath，按当前根重算），保留 7 份；句柄指向资源库根、索引 key 首段固定 `subdir`（ADR-030） |
| 索引端到端验收脚本 | `tools/cdp-indexer-test.py` | v1.0 | 已定稿 | **35/35**：OPFS 句柄注入覆盖全量扫描/快照恢复/缺失语义/reconcile；真实下载验证 downloads 源；无句柄降级报 `LIB_E_NO_PERM`；设置页三个维护按钮；测完清文件+擦记录+清索引（TESTING §13） |
| 资源库页面（S3 核心） | `library.html` + `css/library.css` + `js/library/ui.js` + `js/library/thumbs.js` | v1.1 | 已定稿 | 概览 4 KPI + 平台分布堆叠条 + 博主 Top5 + 博主速览卡；全宽大卡（4:3）；**真表格 8 列**（表头/右对齐数字）；筛选/搜索/排序/**日期分组**；全屏查看器；懒缩略图；≤899 侧栏折叠为横条；深色模式 |
| 资源库页面验收脚本 | `tools/cdp-library-page-test.py` | v1.2 | 已定稿 | **30/30**：种子渲染/计数、KPI、平台分布、博主速览、Top5、表格 8 列、日期分组、概览收起、筛选/搜索/排序、查看器、空态、900/860 响应式、控制台 0 error（TESTING §16） |
| 查看器 v2（S4） | `js/library/lightbox.js` + `js/library/video.js` + `js/library/keyboard.js` | v1.0 | 已定稿 | VRViewer：队列/图片缩放拖拽/信息面板/缩略图带；VRVideo：自绘控件（进度/时间/音量/倍速/全屏/连播）；VRKeys：输入框不劫持的统一键盘 |
| 查看器验收脚本 | `tools/cdp-viewer-test.py` | v1.0 | 已定稿 | **27/27**：图片缩放复位、信息面板、←/→ 切条、缩略图带、视频无原生 controls、Space、seek ±5/±30、↑/↓、连播、Esc（TESTING §17） |
| 查看器截图 | `deliverables/assets/{viewer-image,viewer-zoom,viewer-video}.png` | v1.0 | 已定稿 | 1440 图片 + 信息面板 + 缩略图带、156% 放大、视频自绘控件 |
| 删除与回收站（S5） | `js/library/trash.js` + `js/library/trash-ui.js` | v1.0 | 已定稿 | VRTrash：软删除批次/清单/恢复/彻底删除/清空/审计日志；VRTrashUI：右键菜单、`⋯`、回收站抽屉、确认框、Toast |
| 删除验收脚本 | `tools/cdp-trash-test.py` | v1.0 | 已定稿 | **27/27**：OPFS 句柄注入、移动/清单/索引/恢复/彻底删除/清空、无权限报错、右键菜单、确认框、抽屉恢复（TESTING §18） |
| 删除截图 | `deliverables/assets/{trash-menu,trash-confirm,trash-drawer}.png` | v1.0 | 已定稿 | 右键菜单、确认框、回收站抽屉（批次/恢复/彻底删除/清空） |
| 批量选择 + 重命名（S5b） | `js/library/batch.js` + `js/library/rename.js` | v1.0 | 已定稿 | VRBatch：`body.batch-mode` 驱动样式（不改网格 DOM）、浮条全选/取消/批量软删除、筛选搜索变化清空选择；VRRename：引擎 + 自绘弹窗、复制→校验大小→删源、扩展名保护、索引删旧写新、六种错误码 |
| 批量/重命名验收脚本 | `tools/cdp-batch-test.py` | v1.0 | 已定稿 | **47/47**：OPFS 句柄注入 + 真实文件；批量模式/勾选/全选/退出、重命名成功与六类错误码、批量删除进回收站（TESTING §19） |
| 批量/重命名截图 | `deliverables/assets/{batch-bar,rename-dialog}.png` | v1.0 | 已定稿 | 批量浮条（已选 2 项）+ 勾选态、重命名弹窗（默认选中文件名主体） |
| 图片悬停下载实现规格 | `docs/IMAGE-I1I2-IMPL.md` | v1.0 | 已定稿 | I1/I2 唯一口径：候选五级优先级、SW 消息协议、**DNR 补 Referer 的原因与写法**、错误码、实测结果与踩坑 |
| 图片工具（I1） | `js/lib-image-util.js` | v1.0 | 已定稿 | 纯函数（`self.VRImageUtil` / Node 可 require）：URL 规范化、占位图/SVG/data URI 判定、srcset 最大 w、五级候选去重、`scanImages` 过滤、扩展名推导 |
| 图片悬停按钮（I2） | `js/image-hover.js` | v1.0 | 已定稿 | content script：悬停 300ms 出「下载原图」、Shadow DOM 隔离、滚动/缩放/移开即隐藏、`imgHover` 开关、busy/done/fail 三态 |
| 图片下载 SW 分支 | `js/background.js`（`vrImg.resolve` / `vrImg.download`） | v1.1 | 已定稿 | 逐候选 fetch 校验 `content-type:image/*`、全失败回退最后一个；落 `video-rod/<平台>/<博主>/图片/<日期>_<标题>.<ext>`；**Referer 走 DNR 会话规则**（downloads 的 headers 会被拒） |
| 图片工具单测 | `tools/test-image-util.js` | v1.0 | 已定稿 | **58/58**：候选顺序与去重、srcset、扫描过滤、URL 规范化、扩展名 |
| 图片悬停验收脚本 | `tools/cdp-image-test.py` | v1.0 | 已定稿 | **34/34**：悬停出现/划过不出/移开隐藏、点击落盘 0.26s、路径与文件名、候选优先（a[href]/srcset/懒加载）、四类过滤、开关（TESTING §20） |
| 图片悬停截图 | `deliverables/assets/{image-hover-button,image-hover-done}.png` | v1.0 | 已定稿 | 悬停态「下载原图」贴图片右上角、完成态「✓ 已存」 |
| 图片批量下载实现规格 | `docs/IMAGE-I3-IMPL.md` | v1.0 | 已定稿 | I3 唯一口径：确认条/进度条状态机、`vrImg.batch` 协议、并发池/去重/上限、实测与 6 个产品坑 + 4 个测试坑 |
| 图片批量 UI（I3） | `js/image-batch.js` | v1.0 | 已定稿 | VRImgBatch：确认条（张数/过滤数/只下前 N 张）、底部进度条（done/total/失败数）、取消、Toast；对外暴露 VRImgBridge 给悬停条 |
| 悬停条扩展（I3） | `js/image-hover.js`（追加「全部 N」按钮） | v1.1 | 已定稿 | 同一 Shadow DOM 宿主内两个按钮；图宽 < 140px 时「全部 N」收成纯图标（数字在 aria-label）；修了 pending 未取消计时器与 CSS display 重复声明 |
| 批量下载 SW 分支（I3） | `js/background.js`（`vrImg.batch` / `vrImg.batchCancel`） | v1.2 | 已定稿 | 并发池（缺省 3、上限 8）、200ms 节流进度广播、可取消、失败不中断；去重表 vrImgDownloaded（2000 条淘汰）；DNR 规则 id 改单调递增 + 等下载终态再撤 |
| 批量队列单测 | `tools/test-image-batch.js` | v1.0 | 已定稿 | **27/27**：并发上限、只跑一次、失败/异常不中断、取消不再启动、去重跳过、上限截断、进度节流、去重键规范化、空批次 |
| 批量端到端验收脚本 | `tools/cdp-image-batch-test.py` | v1.0 | 已定稿 | **35/35**：悬停条两按钮、确认条、5 张真下载、路径/文件名/字节数、去重、上限 2、30 张取消、开关（TESTING §21） |
| 批量截图 | `deliverables/assets/{image-batch-hoverbar,image-batch-confirm,image-batch-progress}.png` | v1.0 | 已定稿 | 悬停条两个按钮、确认条（本页找到 5 张/已过滤 3 张）、进度条完成态 |
| 批量测试夹具 | `test-site/batch.html` + `test-site/batch-many.html` | v1.0 | 已定稿 | 5 张大图 + 小图 + 重复 + 坏图；30 张用于验证取消链路 |
| 前端统一设计方案 | `docs/FRONTEND-UI-SYSTEM.md` | v1.0 | 已定稿 | popup + 资源库共用 token/组件；现状审计、全宽布局、全屏查看器、响应式与实施记录 |
| 前端统一改造截图 | `deliverables/assets/{popup-after,library-page-grid,library-page-overview,library-page-cards,library-page-table,library-page-900,library-page-dark}.png` | v2.1 | 已定稿 | popup 蓝色统一；资源库 1440 默认（概览收起）/ 展开概览 / 大卡 / 表格、860 横条、深色 |
| 设置页重设计方案 | `docs/OPTIONS-REDESIGN.md` | v1.0 | 已定稿 | 现状审计（18 分区 / 151 个唯一 ID / 40 处内联样式 / 8 类问题）+ 四组信息架构 + 视觉 token + 组件规范 + 响应式断点 + 兼容清单 + 实施记录（TESTING §14） |
| 设置页重设计样式与交互 | `options.html` + `css/options.css` + `js/options.js` | v1.0 | 已定稿 | 四组侧栏与当前项高亮、分区卡片化、统一配置行/开关/按钮/表格；资源库拆三卡；危险操作独立红卡；<980px 顶部导航；深色 token；保存轻提示、开关/删除 aria；151 个 ID 与全部存储键保留 |
| 设置页重设计截图 | `deliverables/assets/options-redesign-{1440,900,dark,library,table,form,danger,about,full}.png` | v1.1 | 已定稿 | 1440×900 / 900×900 / 深色 / 资源库三卡 / 规则表 / 表单行 / 危险操作 / 关于页（上游与本 fork 增量）/ 整页长图；实测 0 横向溢出、0 控制台错误 |
| 资源库索引层（IDB） | `js/library/db.js` | v1.1 | 已定稿 | 新建。库 `vr-library` v1，五个 store：`file`（keyPath relPath，索引 platform/creatorId/type/mtime/starred）、`thumb`、`setting`、`handle`、`oplog`；SW 与页面共用，API 挂 `self.VRDB`；单连接缓存 + `onversionchange` 让路；v1.1 补 `getHandle/setHandle`（S2 快照/全量扫描复用授权） |
| 资源库 SW 入库服务 | `js/library/sw-library.js` | v1.0 | 已定稿 | 新建。预登记表存 `chrome.storage.session`（TTL 10 分钟、上限 500、200ms 节流），`downloads.onChanged` complete → 反查绝对路径 → 合并 meta 落 IDB → 广播 `vrLib.added`；处理 `vrLib.record/list/stats/clear`；忽略 `_verify/`、`_回收站/`；无根目录时用「预登记目录 + 实际文件名」兜底（覆盖 uniquify 改名）；重下同名文件保留星标/标签 |
| 自动入库端到端验收脚本 | `tools/cdp-index-test.py` | v1.0 | 已定稿 | **14/14**：清空索引 → 批量下载 → 轮询索引出现 → 字段校验（三段目录/平台/类型/大小/绝对路径/文件名/计数）+ 设置页索引状态自动刷新 + 控制台零错误；测完自动删文件+擦记录+清索引（TESTING §11） |
| 路径引擎单测 | `tools/test-path.js` | v1.1 | 已定稿 | **57/57**：4 个平台识别、类型推断、博主段、长度截断、`file://` 往返编码；v1.1 新增 9 条 `parseRelPath` 反解往返断言 |
| S1a 端到端验收脚本 | `tools/cdp-s1a-test.py` | v1.0 | 已定稿 | **17/17**：扩展加载 + 设置页 7 项 + 三段目录落盘 6 项 + 控制台零错误（TESTING §10） |
| 图片悬停下载调研 | `docs/IMAGE-DOWNLOAD-RESEARCH.md` | v0.1（已拍板） | 已定稿 | 参考 ClickSave / Imageye / Image Swooper / Cxrompix；三项拍板（双入口 / 清单面板 / 优先原图）+ 防盗链回退补强 |
| 图片下载后自动入库调研 | `docs/IMAGE-AUTO-INDEX-RESEARCH.md` | v0.1 | 已实现 | Downloads API 完成事件 + 预登记元数据（session storage）+ 懒缩略图；三方案对比、7 个坑与解法、数据契约、8 条验收。**已按方案落地并通过 14/14 验收**（TESTING §11） |
| 图片悬停下载方案 | `docs/IMAGE-DOWNLOAD-PLAN.md` | v1.2 | 待评审 | 三态交互、原图五级候选 + SW 校验回退 + DNR 补 Referer、批量队列；**v1.2 新增**尺寸档位（小/中/大/超大/自定义，按短边判定并显示命中数）与图集模式（自动滚动 + 分页翻页，10 页上限/可停止/连续 2 页失败中止） |
| 图片悬停下载原型 | `deliverables/prototypes/image-hover-prototype-v1.html` | v1.2 | 待评审 | 单文件零依赖：SVG 封面、悬停 300ms 出按钮、单张/全部/确认条/进度、浮标 + 清单面板（**尺寸档位**、图集加载下一页、过滤/勾选/批量）、键盘操作；**CDP 24/24** |
| 图片悬停原型截图 | `deliverables/assets/image-hover-v1-{hover,confirm,progress,panel,album}.png` | v1.2 | 已定稿 | 五态实拍：悬停按钮 / 全下确认条 / 批量进度 / 清单面板（档位+图集条） / 图集加载后 24 张 |
| 本地资源库方案（评审版） | `docs/LIBRARY-PLAN.md` | v2.0 | 已定稿（S0–S2 已实现） | 调研 + 架构选型 + 中文目录命名 + 数据模型 + 删除/迁移 + 开源 UX 取舍 + §11 审计指北 + §12 审计复核 + §13 实现规格 + §13.7 S0 实测 + §13.10 S1b 迁移规格 + **§13.11 S2 索引规格**（三源/快照/缺失语义/8 条验收）；v1.7 = 根目录定为 `<下载目录>\video-rod` 子目录 |
| 本地资源库交互原型 | `deliverables/prototypes/library-prototype-v1.html` | v1.3 | 待二次评审 | 单文件可交互原型（27 条演示数据）；视频键盘 ↑↓/←→ 与连播（**自绘播放控件**，解决原生 controls 吞键）；时间线视图、右键菜单、悬停预览、回收站；**v1.3 新增**：星标+只看星标、轻量标签 chips+标签筛选、J/K/Enter/F 键盘导航、灯箱缩略图带、进度条悬停时间气泡；内建「评审说明」 |
| M3 B站分P横幅截图 | `deliverables/assets/m3-bili-banner.png` | 2026-10-17 | 已定稿 | M7 回归时重拍为浅色版（12 分P横幅 + 展开态），与 final-m7-bili.png 同内容 |
| M4 YouTube 限制横幅截图（深色版） | `deliverables/assets/m4-yt-banner.png` | 2026-10-17 | 已归档 | 离线等效验证（域名映射）下的橙色警示横幅；浅色版见 final-m7-ytbanner.png |
| M5 图片弹层截图 | `deliverables/assets/m5-img-modal.png` | 2026-10-17 | 已定稿 | M7 回归时重拍为浅色版（2 张有效图，坏图/小图/重复图已滤掉），与 final-m7-imgmodal.png 同内容 |
| HLS 流媒体回归截图（深色版） | `deliverables/assets/hls-regress.png` | 2026-10-17 | 已归档 | m3u8 双清晰度卡 + 清晰度下拉；浅色版回归由断言集覆盖（hls 页 cardCount=2/qualities=2） |
| M6 全功能回归截图（深色版） | `deliverables/assets/final-{m1,hls,yt}.png` | 2026-10-17 | 已归档 | M6 深色版三页实拍；M7 浅色化后由 final-m7-* 五态截图取代 |
| 测试站页面 | `test-site/{index,hls,bili-fake,images,yt-fake}.html` | 2026-10-17 | 已定稿 | 五类测试夹具：直链视频/HLS/B站分P/图片批量/YouTube（域名映射） |
| 右键秒存 + 快捷键 | `js/init.js` + `js/background.js` + `manifest.json` | v1.0 | 已定稿 | M5 产物；两个一级右键菜单 + `vrSaveContextMedia()` + Alt+Shift+V |
| README 使用说明 | `README.md` §使用说明 | v1.2 | 已定稿 | M6 产物：九节大白话完整指引；M7 随浅色重设计更新（行展开改名/抓图位置/设置视图四组 9 项+高级工具） |
| 测试策略文档 | `docs/TESTING.md` | v1.4 | 已定稿 | M6 产物：用例表+回归清单+M2–M5 冒烟记录；M7 补浅色重设计全量回归记录 + 3 条新测试环境限制；M8 §7 补文件名保护星愿真机三链路记录 + 7 条新坑（星愿扩展 ID/下载目录/blob IPC 赛跑/X 懒加载/后台启动/hook 假阴性/重载方式）；**§10~§12 补 S1a / 自动入库 / S1b 三套验收** |
| 交接文档 | `docs/HANDOFF.md` | v2.1 | 已定稿 | 接手 AI 入口：项目规则 / 环境（含 git 身份参数、Chrome for Testing 路径）/ 代码地图与数据流 / **16 套 571 条**回归命令与基线 / 11 类坑（v2.1 新增 §6.7 多线并发覆盖、§6.8 行尾、Chrome 147 文件名保护失效）/ 未完成与技术债 / 文档索引 / 第一小时清单 / 恢复提示词 |
| M8 下载文件名保护 | `js/background.js` 记账+监听段 + `js/vr-download-hook.js`（新建）+ 4 个 HTML 挂载 | v1.1 | 已定稿 | 修「星愿忽略 filename」（Chromium bug 579563）：SW 侧 URL 预记账 Map + 自注册 onDeterminingFilename 三道防线 + `vrDownloadWithName()` 统一入口（3 处下载点改造）；页面侧 hook 等记账 IPC 应答后再下载；keep-on-take + 10 分钟 TTL + uniquify。ADR-027；v1.1 = 加固版（try/catch 防御 + 同 URL 重复下载不丢名） |
| M8 文件名保护验收脚本 | `tools/test-x-name-fix.py` | v1.0 | 已定稿 | 星愿真机三链路：popup blob（hook IPC）/ SW 直连（网络 URL）/ X 按钮（推文页懒加载等待+滚动触发）；判定落盘名=模板名+ffprobe 验双轨；加固回归（同 URL 双下载）内嵌 |
| M8 X(推特) 推文内联下载按钮 | `js/x-button.js` + `manifest.json` content_scripts + `background.js` handler | v1.0 | 已定稿 | 推文操作栏 [role=group] 注入按钮 → 后台查预混流直链（fxtwitter）→ 最高画质一键落盘；ADR-026 |
| M8 端到端测试脚本 | `tools/test-x-button5.py` | v1.0 | 已定稿 | 重载扩展→刷新推文页→等按钮→点击→轮询下载记录，星愿真机回归用 |
| M4 YouTube 验收脚本 | `tools/cdp-m4-test.py` | v1.0 | 已定稿 | M7 新建（M4 此前只有临时探针）；导航 `http://notyoutube.com:18080/`（必须带端口，见 TESTING §5），验 YT 横幅 + 嗅探卡片 + 浅色 |
| z 序回归探针 | `tools/probe-zorder.py` | v1.0 | 已定稿 | M7 新建；elementFromPoint 验证各浮层完整盖住底栏—— flex item z-index 陷阱的回归防线，改外壳 CSS 后必跑 |
| M7 归档截图工具 | `tools/shot-m7-final.py` | v1.0 | 已定稿 | 五状态归档截图（普通/设置/YT横幅/B站/图片弹层）；内建 settle+retry 绕 CDP 懒帧、显式 force 绕卡死过渡 |
| M7 回归截图（五态） | `deliverables/assets/final-m7-{plain,settings,ytbanner,bili,imgmodal}.png` | 2026-10-17 | 评审中 | 浅色重设计落地实拍：普通列表/设置 4 组视图/YT 警示横幅/B站 12 分P 展开/图片弹层 |
| M9 下载历史面板 | `js/background.js`(history 段) + `popup.html`(入口) + `css/videorod.css`(历史视图) + `js/popup-videorod.js` | v1.0 | 已定稿 | M9 产物：下载完成入历史（storage.local）；设置抽屉历史入口；按时间分组/重下/清空；星愿真机 6 项全过 |
| M10 侧边栏模式 | `manifest.json`(side_panel) + `js/background.js` + `js/popup-videorod.js` + `css/videorod.css` | v1.0 | 已定稿 | M10 产物：工具条按钮/右键开侧边栏；侧栏窄宽适配；侧栏下载都走 `vrDownloadWithName` 带文件名保护；星愿真机 7 项全过 |
| M11 离屏直连合并管线 | `js/m3u8-merge.js` + `js/m3u8-multi.js` + `m3u8-multi.html` + `offscreen.html` + `js/background.js`(M11 段) + `js/popup-videorod.js` + `js/vr-download-hook.js` | v1.0 | 已定稿 | M11 产物（ADR-028）；离屏文档内解析+下载+解密+转码全链路；删旧「驱动猫抓 m3u8 页」约 150 行；星愿真机 5 项全过，落盘 h264 640×360 8.000s 有效 |
| M9 历史面板验收脚本 | `tools/test-m9-history.py` | v1.0 | 已定稿 | 星愿真机：记录写入/列表/缩略图/重下/清空/设置入口 |
| M10 侧边栏验收脚本 | `tools/test-m10-sidepanel.py` | v1.0 | 已定稿 | 星愿真机：侧栏开合/窄宽渲染/侧栏下载带文件名保护 |
| M11 多段合并验收脚本 | `tools/test-m11-automerge.py` + `tools/test-m11-multimerge.py` | v1.0 | 已定稿 | 星愿真机：对抗不误归组/归组徽标/后台合并/点保存落盘/合并文件落地；修复收尾 closeTarget 容错 |
| M9 历史面板截图 | `deliverables/assets/m9-history-view.png` + `deliverables/assets/m9-settings-history-entry.png` | 2026-10-18 | 已定稿 | M9 实拍：历史列表视图 + 设置抽屉历史入口 |
| M10 侧边栏截图 | `deliverables/assets/m10-sidepanel.png` | 2026-10-18 | 已定稿 | M10 实拍：侧边栏窄宽渲染 |
| YouTube 播放器下载 | `js/yt/{yt-page,yt-download,nsig-sandbox,fmp4-merge}.js` + `js/yt/{yt-download,nsig-sandbox}.html` + `lib/youtubei.min.js` + `background.js`(ytCollectFormats/ytOpen/ytFormats) | v1.0 | 评审中 | 播放器下方按钮 → 小窗选清晰度 → 双轨下载 → 容器级合并（不重编码）→ FSA 直写资源库三段目录。取格式按 MWEB→ANDROID→IOS→TVHTML5 轮替；n 参数在 sandbox 页解（MV3 禁 eval）；落盘优先 FSA、无授权退回下载器（ADR-039/040）。**待真机复验** |
| YouTube 拆包分析 | `docs/REF-YTB-TUBLY.md` | v1.0 | 已定稿 | Tubly(YTB.crx) 拆包：crx 内**没有**解析器（引擎走服务端）、WASM 是授权校验、可复用的 7 个代理层模式 |
| YouTube 可行性实测 | `docs/YT-FEASIBILITY.md` | v1.0 | 已定稿 | Web 客户端 0 条直链（SABR）→ 九种客户端矩阵 → 403 归因到 n 参数 → 47ms 解出 206+ftypdash；SABR 复放 200+EBML；三条路线技术账 |
| YouTube 实现与验收记录 | `docs/YT-IMPLEMENTATION.md` | v1.0 | 已定稿 | 文件地图 / 数据流 / 四个关键设计（小窗、沙箱、自写合并、FSA 落盘）/ 验证矩阵 / 已知限制 |
| YouTube 探针与验收脚本 | `tools/yt-{probe,clients,dl-test,feasibility,sabr,download-test,ext-test,shot}.py` | v1.0 | 已定稿 | 前五个是研究期探针（取格式/客户端矩阵/403 归因/SABR 复放）；`yt-download-test.py` 是离线端到端（21 条，进 full 套件）；`yt-ext-test.py` 真机级联；`yt-shot.py` 截图 |
| YouTube 验收截图 | `deliverables/assets/yt-button-injected.png` / `yt-download-window.png` | 2026-10-24 | 评审中 | 播放器下方按钮实拍 + 480×700 下载小窗实拍 |
| 图片浮标 + 清单面板（I4） | `js/image-panel.js` + `manifest.json` content_scripts + `docs/IMAGE-I4-IMPL.md` | v1.0 | 实施中（I3 回归 C1 红） | 浮标入口 + 清单面板；配套改 `image-batch.js` / `lib-image-util.js` / `TESTING.md` §22 / `cdp-run.py`；验收 `cdp-image-panel-test.py` 46/46、`test-image-tier.js` 57/57 |

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
| 临时工作区 | `.work/` 已在 `.gitignore`；**禁止把 profile / 测试视频 / 临时草稿提交进仓** |
| 仓库外零散落 | 新增文件前先确认落点；项目文件不得放在 `E:\test\` 等仓库外的裸目录 |

## 7. 本规范的维护

- 规范本身也要版本化（文档头版本行），改规范 = 在 DECISIONS.md 补一条说明
- 苏哥觉得哪条规则别扭，随时说，改规范比憋着遵守重要
| B站完整视频下载（M12） | `js/popup-videorod.js`(fetchBiliWhole/buildBiliWholeBanner/startBiliWhole/pollBiliWhole) + `css/videorod.css`(vr-banner-whole/vr-whole-prog) | v1.0 | 已定稿 | ADR-029 产物：主世界 executeScript 读 cid → playurl(不带fnval) 要 durl 整段MP4 → 页面 XHR blob → `<a download>` 存盘；命名走既有模板、历史走 markDownloaded；未改动 background/content-script。星愿真机 BV1DVaZ6hEK6 端到端通过（h264 1280×720 + aac，190.523s，14,538,650 B） |
| B站实站验收脚本 | `tools/bili-diag.py`、`tools/bili-netcap.py`、`tools/bili-correct.py`、`tools/bili-download.py`、`tools/bili-shot.py` | v1.0 | 已定稿 | B站实站：目标/网络抓包/对照 cacheData/下载与落盘/面板截图证据；`bili-popup-proof.png` 为嗅探证据截图 |
| B站 1080P 高清下载（DASH+合成） | `js/popup-videorod.js`(runBiliDash/resetBiliButtons/qShort/buildBiliWholeBanner) + `css/videorod.css`(vr-whole-btns/vr-whole-hd) + `lib/mp4box.all.min.js` | v1.0 | 已定稿 | ADR-029 补记：横幅并列「标清(durl) / 高清(DASH)」两按钮，仅当 DASH 档位更高才显示高清；高清路线向页面主世界注入 mp4box，分离解析画面/声音 m4s → 按样本切片取数据 → addTrack/addSample 重建 → `<a download>`。真机双路线通过：标清 14,538,650B/1280×720、高清 73,698,485B/1080×1920（另一支 32,609,576B/1080×1918），均含 aac 音轨 |
| B站双清晰度横幅截图 | `deliverables/assets/bili-1080-banner.png` | 2026-10-19 | 已定稿 | 面板实拍：「23.5MB · 720P ｜ 1080P（需合成，体积比标清大）」+ 深绿「下载 720P · 快」/ 橙色「下载 1080P · 高清」两按钮 |
| mp4box 合成库 | `lib/mp4box.all.min.js` | 0.5.2 | 已定稿 | gpac/mp4box.js，MIT；已在 `lib/third-party-libraries.md` 登记。仅高清路线注入，标清不加载 |
| mp4box 合成实验室 | `tools/bili-mux-lab.py` + `tools/mux-attempt.js` | v1.0 | 已定稿 | 缓冲缓存在页面(`window.__vrDash`)、合成代码单独放 JS，改算法不用重下 27MB；`VR_LIMIT` 限量模式、`VR_REFETCH` 强制重取。踩坑留证：appendBuffer 两文件不可行、getBuffer 才是导出方法 |
| B站清晰度扫描器 | `tools/bili-1080-probe.py` | v1.0 | 已定稿 | 扫 `fnval × qn` 组合，列出每条路是 durl 还是 dash、实际 quality/尺寸，用于判断「B站给不给 1080P」 |
| B站双路线端到端脚本 | `tools/test-bili-1080.py` | v1.0 | 已定稿 | `VR_MODE=durl/dash` 选路线：重载扩展→开 popup→读横幅→点按钮→盯进度→ffprobe 验落盘文件 |
| 页内悬浮下载按钮（ADR-030） | `js/video-overlay.js` + `manifest.json` content_scripts | v1.0 | 已定稿 | 全局一个 `position:fixed` 浮层；`document.mousemove` 60ms 节流 + 矩形命中（解决微博/抖音/B站覆盖层导致按钮不出现）；右上角定位、右缘 14px、top 让开 12%；主按钮 44×40 + 箭头 26×40；一键最高清/菜单选档；全屏隐藏；X 站让给 `x-button.js` |
| 主页半手动批量（ADR-033 P1 / ADR-036 A / ADR-038 B） | `js/bulk-profile.js` + `js/xhs-batch.js` + `manifest.json` content_scripts + `js/background.js`(vrBulkDownload/vrResolveX/vrXhsScan/vrXhsAutoQueue) | v1.3 | 评审中 | 微博/ X / 小红书详情；小红书主页/收藏/点赞卡片收集，手动滚动；可选自动补全详情默认关闭，≤20 篇、3–5 秒/篇、失败即停；XBD 过滤/去重；下载去重账本 |
| 抖音取流模块（ADR-031） | `js/douyin.js` + `js/background.js`(抖音分支/DNR) + `js/naming.js`(extractDouyin) | v1.1 | 已定稿 | 页面主世界同源 `aweme/v1/web/aweme/detail/`；URL `/video/<id>` 或 `?modal_id=<id>` 定位作品；按短边分辨率降序选最高档；DNR session rule set Referer/Origin 解决 CDN 403。v1.1 增加微博同类问题：通用直链优先页面 fetch→blob→`<a download>`，失败回退 downloads+DNR；微博 `$render_data` 取作者/正文命名 |
| B站取流模块 | `js/bili-whole.js` | v1.0 | 已定稿 | popup 与 SW 共用的 B站主世界取流核心（ADR-029/补记），从 `popup-videorod.js` 抽出；background `importScripts` 加载 |
| 悬浮按钮测试脚本 | `tools/overlay-pos.py`、`tools/overlay-check.py`、`tools/test-video-overlay.py`、`tools/shot-overlay.py` | v1.0 | 已定稿 | 位置诊断/通用站点体检/端到端验证/早期截图；CDP 截图统一 `fromSurface:false`，避免白底破图伪影 |
| 悬浮按钮截图 | `deliverables/assets/overlay-douyin.png` | 2026-10-19 | 已定稿 | 抖音 1920×887 实拍：按钮在右上角（right gap 14px、top 76px），不与播放器控件重叠 |
| 抖音/微博/X/小红书真机验收记录 | `docs/TESTING.md` §10 | v1.8 | 已定稿 | 按钮 O1-O6、抖音 D1-D10、微博 W1-W6、主页批量 B1-B7、X 主页 X1-X9、小红书 H1-H6；4K hevc+aac 7,260,920 B；99MB complete；微博 540×960+aac 5,817,304 B；X 视频 8,401,119 B、图片 232,912 B；小红书 webp 64,510 B；稳妥限速/失败暂停 |
| 媒体库目录复盘（2026-10-19） | `docs/INCIDENT-20261019-LIBRARY-DIR.md` | v1.0 | 已定稿 | 解释 `hasMediaEntries` 白名单、E/F 混淆、原生选择器窗口、外部目录污染与重命名 API；含修复提交和当前状态 |
| 媒体库修复后截图 | `deliverables/assets/library-after.png` | 2026-10-19 | 已定稿 | F 盘 22 项：X 10 / 小红书 7 / 其他 5；`xbd-downloader` 与“老黄的分享”已隔离 |
| 媒体库扫描/CRUD 修复 | `js/library.js`（walk/rename/parentDir） | v1.1 | 已定稿 | 跳过 `xbd-downloader`、`老黄的分享`、`_index/_trash/_thumbs`；`move(parentDir,newName)` 修复星愿重命名 `NotAllowedError`；临时文件实测重命名/删除通过 |
| 媒体库 P3 批量/标签 | `library.html` + `css/library.css` + `js/library.js` | v1.0 | 已定稿 | 选择模式/全选/反选/清除；批量移动到 `平台/博主/images|videos`；批量删除到 `_trash`；标签 `_index/tags.json`；临时文件验收 23→22，移动/删除/标签均通过（`cdcc9f8`） |
| 媒体库 P4 缩略图/查重 | `library.html` + `css/library.css` + `js/library.js` | v1.0 | 已定稿 | 图片缩略图 480px 持久化 `_index/thumbs`（8 张）；SHA-256 `_index/hashes.json`（22 文件，3 组/9 个重复标记）；查重按钮；本地视频 `preload=metadata` 可 seek（`223fdc1`）。边界：远程 HTTP Range 未做（视频首帧缩略图已由 v1.33 补上） |
| 小红书 token/视频/计数修复 | `js/xhs-batch.js`（cardsOnPage）+ `js/background.js`（vrXhsScanInTab/vrXhsScanInPage/vrXhsAutoQueue） | v1.0 | 已定稿 | 卡片同时读 `/user/profile/...?xsec_token`；详情 state 最多 8 次等待；`mediaV2.stream` 优先带音轨 mp4；files/skipped/errors 分开计数。实测图片 files=1/errors=0，视频 done=1/skipped=1/errors=0，mp4 31,344,820 B；收藏/点赞 token 20/20、30/30（`1e93106`） |
| Instagram P1 | `js/instagram.js` + `manifest.json` + `js/background.js`（vrIgDownload） | v1.0 | 评审中 | 帖子/Reel 按钮；当前 DOM 图片/视频；作者/文案/shortcode；落 `video-rod/instagram/<作者>/images|videos`；fixture 15,324 B。真实登录态下载待验，blob 视频未做（`6bd6d19`，ADR-042） |
| 单次下载去重 | `js/background.js`（vrVideoDownload/vrQuickDownX）+ `js/x-button.js` | v1.0 | 已定稿 | 查 `vrMediaSeen`，成功后记账；B站按页面+清晰度，直链按去签名 URL；X 按钮显示「已存在」。实测同一 X 视频第一次 1,336,765 B、第二次 `skipped`，无第二次文件（`24b59e2`） |
| 媒体库逐按钮全量验收 | `docs/LIBRARY-FULL-TEST.md` | v1.0 | 已定稿 | 27 项：搜索 8、平台小红书 12、图片 12/视频 15、排序/视图/预览/标签/重扫/设置通过；`_index` 27、hashes 27、thumbs 12；**全屏按钮 2026-10-19 已复验通过**（后台未聚焦才是此前失败原因）；原生 picker 环境限制仍在 |
| 媒体库视频首帧缩略图 | `js/library.js`(videoFrameBlob/thumbUrl/renderGrid) + `css/library.css`(.thumb.is-video) | v1.0 | 已定稿 | 本地 mp4 首帧 480px JPEG 持久化 `_index/thumbs`；失败退回渐变占位；隔离环境 + 媒体库真机端到端均通过（480×270 / 270×480，2026-10-19）；扫描后 `fillMissingThumbs()` 自动补缺（视频串行/图片并发，无需手动） |
| YouTube 入口移除（ADR-043） | `js/video-overlay.js` + `js/popup-videorod.js` + `css/videorod.css` | v1.0 | 已定稿 | 移除 YouTube 页面悬浮下载按钮与 popup 限制横幅；站点排除加 youtube.com/youtu.be（含子域）；`cdp-m4-test.py`/`yt-fake.html` 作废 |
| 小红书图片去后缀取更大图（ADR-044） | `js/background.js`(vrXhsScanInPage/vrBulkDownload) | v1.0 | 评审中 | 图片优先去 CDN 处理后缀（`!nd_`/`!nc_`/`?imageView2`），失败回退带后缀原地址；**未真机验证**（需真实图文笔记） |
| 媒体库预览进入视频自动播放 | `js/library.js`(renderPreview 视频分支) | v1.0 | 已定稿 | `preload='auto'` + `video.play()`，**默认带声**；被策略拦才静音、下次点击/按键自动恢复声音；切图/关闭仍 `pause()`；2026-10-19 苏哥实测通过 |
| OmniGet 参考价值评审 + 未完成任务盘点 | `deliverables/reviews/2026-11-04-omniget-review.md` | 2026-11-04 | 评审中 | 结论：无可抄代码（其 JS 重叠部分源自 cat-catch，即我上游）；推翻「Cookie 泄露」「按码率猜体积」两条误判（我们已有白名单 + 10 段 HEAD 采样）；同时盘点 P0 待验 2 项（AES-128 真机、小红书去后缀）、P3 文档不一致 3 项 |
| **B+D 设计系统（定稿）** | `docs/DESIGN-SYSTEM-BD.md` | v1.0 | ✅ 已生效 | 苏哥拍板 B 纸感 + D 影院。完整 token 表（浅色/暗色/预览三套）、圆角与字号规范、组件细则（卡片 16:10、按钮胶囊、侧栏深半档、右键菜单 212px）。**核心工程决定：预览层用 `.preview` 局部覆盖变量，一套 CSS 两套皮肤**。含衬线的中文硬限制（只能 ≥20px） |
| **界面风格探索 v1（四方向）** | `deliverables/prototypes/style-explorations-v1.html` + `assets/style-A-blueprint.png` / `-B-paper.png` / `-C-gallery.png` / `-D-cinema.png` / `-E-controls.png` | v1 | **待苏哥选** | 四套**视觉语言**（不是四种配色）：A 图纸（深灰细线 3px 圆角 / CAD 感）、B 纸感（暖白 30px 衬线 / 画册感）、C 画廊（近白 16px 大圆角 / Pinterest 感）、D 影院（近黑 26px 紧凑 / Netflix 感）。第 5 个标签「E 控件对照」把按钮/输入/下拉/开关/标签/右键菜单/图标四套并排。18 条真实素材、封面带颗粒与光斑。推荐 B+D（界面浅色 + 预览深色） |
| **风格方向说明** | `docs/STYLE-OPTIONS.md` | v1.0 | 待确认 | 四款取舍、控件级差异表、推荐理由（图片占一半→浅底不偏色；浅界面+深画布是 Eagle/Lightroom 通行做法）、衬线字体的中文硬限制、三个待定问题 |
| 媒体库重设计原型 v1 | `deliverables/prototypes/media-library-redesign-v1.html` + `assets/proto-shot-1.png` / `-list.png` / `-preview.png` / `-dark.png` | v2.0 | ✅ 已换皮 | **B 纸感** 暖白 #F7F4EE / 赭石 #A8502E（与 popup 方案 A 统一）+ 强调蓝 #337CCC；图标用 **Lucide v0.544.0（ISC）** 内联 svg sprite，零网络请求；覆盖网格 / 列表（带表头固定列）/ 预览（舞台+信息栏+胶片条）/ 暗色四态；可交互：筛选、平台 chips、选择模式、预览切换、主题切换。**v1.1 增「来源」溯源块**；**v1.2 增三套查看器控件**（视频控件条 / 图片缩放工具栏 / 动图帧控条 + 快捷键面板 `proto-vw-*.png`）；**v1.3 曾误删字段做折叠**（已废弃）；**v1.4 信息栏 v3：信息一个不删，改成分组 + 标签/值两列对齐**——文件组（大小/分辨率/时长/格式/保存时间/路径）、来源组（平台/作品 ID/原帖/直链/下载时间）、标签组、同作者 12 图；状态徽标四态；`proto-info-v3-video.png`（信息栏 v3 定稿，文件组 7 行 + 来源组 5 行）；动图三格式（GIF/WebP/APNG）与「动图」独立筛选（`proto-anim-tab.png`）；**v1.5 补回收站抽屉 + 右键菜单**（`proto-trash-drawer.png` / `proto-ctxmenu.png` / `proto-trash-dark.png` / `proto-ctxmenu-dark.png`）；**v1.8 收藏夹（一级栏目）**（侧栏独立区块 + 视图 + 加入浮层 + 管理抽屉，`proto-fav-main.png` / `-view.png` / `-pop.png` / `-drawer.png` / `-empty.png`）；**v1.7 播放速度浮层**（8 档 0.1–2×，`>` `<` 键步进，视频/动图共用，`proto-rate-pop.png` / `-set.png`）；**v1.6 补操作类界面**——空状态三场景（`proto-state-empty.png`）、索引进度（`proto-state-scan.png`）、重命名对话框（扩展名锁定，`proto-modal-rename.png`）、确认对话框（`proto-modal-confirm.png`）、批量条含退出（`proto-batch.png`）。YouTube 平台条目，长值单行省略 + title 悬停，列表「保存」列取真实时间。刻意不引入 JS 框架与 webfont |
| 媒体查看器方案 | `docs/MEDIA-VIEWER-PLAN.md` | v1.0 | 评审中 | 视频用 **Media Chrome**（纯控件层套原生 video，不接 Video.js 全量播放器）；图片不引库只补旋转/适应/1:1；GIF 用 **gifuct-js** 解帧自绘。含关键情报：**Plyr 已官方废弃**、PhotoSwipe 30 个月未发版、lightGallery 是 GPLv3（与本项目兼容）。附鼠标+键盘完整矩阵、VW-1~10 验收用例 |
| 阶段汇报（2026-11-04） | `docs/STATUS-20261104.md` | v1.0 | 已交付 | 大白话版进度：现在能用的 13 项能力、这半个月做完的三块、P0 五条、三个真实风险、**「重复造轮子」专章**——外部对照 6 个现成方案（Eagle / TagStudio 7k星 / Monbooru / Billfish / digiKam / 猫抓），结论：单看素材库我们不如人，但「网页抓取→本地库→自动溯源」这条链没人做完整，据此定下资源纪律：通用库功能抄现成，火力押在链路 |
| **就绪度评估：数据库实测 + 功能自查** | `docs/READINESS-20261104.md` + `deliverables/bench/db-bench.html` + `bench/result.txt` | v1.0 | 已交付 | **真跑出来的数字，不是估算**。数据库是 IndexedDB（5 个 store），不是 JSON。实测 1万/5万条：getAll 203ms/833ms、元数据 4.1MB/20.6MB、索引查询 53ms/153ms、内存 filter 11ms/27ms——**数据库完全不是瓶颈**；但全量渲染 13万/65万 DOM 节点、布局 1.67s/3.29s，**这才是墙**（10万条直接跑崩）。空间大头是缩略图不是元数据（480px WebP，5万张约 1.2GB）。结论：不用换库，要加虚拟滚动（B-14）。功能自查：假实现只有 1 处（分辨率写死），下载能力已完成、IG/YT 未验 |
| 增量影响分析（新需求接入） | `docs/IMPACT-ANALYSIS-UI-REDESIGN.md` | v1.0 | 已交付 | 8 节标准格式。**指出自己方案文档的 3 处错**：① 溯源存 `_index/meta.json` 已失效（合并后是 IndexedDB）② 推荐 Media Chrome 属过度设计（现有 8 键已能用）③「CSS 整体重写」估计基于已归档的 197 行旧版，当前 2981 行 + 30 处动态 class。给出 8 批次最小改动方案，判断「现在不能开工」，前置 3 条 |
| **需求清单（待苏哥补充）** | `docs/REQUIREMENTS-CHECKLIST.md` | v1.0 | **待确认** | 从全部对话里提取的 73 条需求，分 A 下载(21) / B 资源库(21) / C 查看(9) / D 数据(4) / E 界面(6) / F 我猜的(12) / G 规矩(7)。每条标 ✅已有 / 🟡有未验 / ⛔没有，供逐条核对补漏 |
| **beUI 评估** | `docs/BEUI-EVAL.md` | v1.0 | 已交付 | beUI = `starc007/ui-components`，1,920★ MIT，2026-11-02 仍活跃。**但是 React + Next.js + Tailwind v4 + Motion**，我们是零构建原生 JS → **引入等于重写，不能引**。改抄它的 6 个动效手法（纯 CSS 可做），其中「预览分层进入」已做进原型，「从缩略图放大进预览」列为下一版 |
| **页面侧注入 UI 原型 v2（组件统一）** | `deliverables/prototypes/page-ui-prototype-v1.html` + `assets/pageui-*.png`（10 张） | v2.0 | **待苏哥审** | 7 平台场景不变；**v2 组件统一**：全平台下载按钮统一「深色玻璃胶囊 + 左侧平台色点」（不再整条品牌渐变/白底，消灭五颜六色），微博/小红书/X 抽屉统一一套深色玻璃组件，已存标记+忽略已下载开关铺进两个抽屉，悬停按钮带尺寸（下载原图 1200×1600），IG 去 emoji 换 SVG。CDP 17/17 PASS、0 JS 错误。依据 FUNCTION-AUDIT-ENTRY §5-6 |
| **popup 入口层成品 v3.2（B+D）** | `deliverables/prototypes/popup-redesign-v3-bd.html` + `assets/popup-v3-*.png`（5 张） | v3.2 | **待苏哥审** | 方案 A「收网」清单式（380×560，行距 66px，改名点标题、展开看落盘路径）+ **B 纸感 token**（#F7F4EE/#A8502E/#1F1D1A），与 media-library / settings 交叉核对 token 一致。**v3.1 按功能审视（FUNCTION-AUDIT-ENTRY.md）改的不只是配色**：砍「媒体控制」页签（收进齿轮）、加**本页概览条**（点类型=只勾该类，一键）、加**「存到哪」一行**、加**「已下载」置灰标记 + 忽略已下载开关**、下载键带**数量+体积**、默认最高画质徽标（守 N-05）。**v3.2 按竞品共性 9 拆掉快捷设置抽屉层：齿轮一步直达完整设置页**；按共性 2 加**每行独立下载键**（hover 行尾出现，单击即下单条，下载后自动转已存）。CDP 15/15 PASS、0 JS 错误。**取代旧 popup-redesign-options-v2.html（teal/navy/blue 三方向探索，作废）** |
| **设置页原型** | `deliverables/prototypes/settings-redesign-v1.html` + `assets/proto-set-dl.png` / `-name.png` / `-adv.png` / `-dark.png` | v1.0 | **待审批** | 7 组设置（保存位置 / 文件命名 / 画质与合并 / 索引与扫描 / 外观 / 快捷键 / 高级工具）。核心是**文件名模板编辑器**：变量点选插入 + **实时显示落盘路径**，不认识的变量原样保留不吞掉。与主界面同一套设计令牌 |
| **界面落地技术文档** | `docs/UI-IMPL-PLAN.md` | v1.0 | **待审批** | 三条硬内容：① 原型与代码是**两套类名**（`.card`↔`.ccard`、`.badge`↔`.c-plat`…），**直接拷 CSS 一条都不生效**，附完整映射表；② 三步策略（先换令牌 → 按映射表逐组件 → 最后只改必要结构）；③ 9 个批次，每批可独立回退，批次 0 实机验证不过就不开工 |
| 原型→代码落地映射 | `docs/PROTOTYPE-MAPPING.md` | v1.0 | 评审中 | **合并后最重要的一份对齐文档**：原型（`pv*` 命名）与模块化代码（`lib*` 命名）三方对照。含 17 个模块落点、信息栏 16 字段逐项判定、键盘 21 键差异、原型没画但代码已有的 9 项（不能丢）、9 步施工顺序。两条硬结论：①「分辨率」代码里位置有、数据没写，而缩略图生成时能拿到真值——**错过那一刻就要重新解码全库**；②「标签」不是丢了，是 `tags:[]` 字段在、UI 没入口 |
| 媒体溯源元数据方案 | `docs/MEDIA-METADATA-PLAN.md` | v1.0 | 评审中 | A 档：作品页 + 博主名/ID/主页 + 直链 + 下载时间，统一在 `vrDownloadWithName` 埋点；存储走 storage.local 队列 → `_index/meta.json`（SW 无 FS Access）；字段语义对齐 yt-dlp；区分 `pageUrl`（不失效）与 `mediaUrl`（会过期）；七条验收用例，重点「埋点异常不得影响下载」 |
| **资源库重设计五方向评审稿** | `deliverables/reviews/2026-11-04-library-redesign-directions.md` | 2026-11-04 | **待苏哥选** | 五个**风格立场**方向（不是五种配色）：暗房（图像优先+显影加载）/ 档案室（抽屉拉出+著录卡）/ 仪表盘（仪器读数+扫描点亮）/ 舞台（追光灯搜索+聚光悬停）/ 目录（条码索书号+插卡动效）。每方向覆盖 12 细节维度 + ASCII 线框 + 响应式策略；推荐暗房首选、舞台次选 |
| **资源库重设计第二辑四方向** | `deliverables/reviews/2026-11-04-library-redesign-directions-b.md` | 2026-11-04 | **待苏哥选** | 与第一辑零重叠的新四向：天文台（深蓝黑星图，**星座线搜索**+悬停聚亮）/ 宋册卷轴（宣纸留白，圈点朱印+竖排题签）/ 唱片墙（胡桃褐货架，**抽套落针**即播）/ 标本柜（灰绿玻璃黄铜，红针+掠光）。含两辑九向总对比表与杂交预案；第二辑内推荐天文台首选 |
| 设计上下文档案 | `.impeccable.md` | v1.0 | ✅ 已生效 | impeccable 技能的项目设计档案：用户（苏哥/非技术）、场景（渔获盘点/翻查/整理）、调性（高端克制反 AI 感）、硬约束（零框架/子集字体/1440 基准/虚拟滚动前提/DOM 契约） |
| **舞台皮肤原型** | `deliverables/prototypes/media-library-stage-v1.html` + `assets/proto-stage-dark.png` / `assets/proto-stage-preview.png` | v1.0 | ✅ 待苏哥验收 | 苏哥九方向拍板「舞台」→ 对 `media-library-redesign-v1.html` **纯换皮**（结构/文案/交互零改动，只改深色主题色值）：剧场暖黑族底 #100F0E/#191715/#1F1C18/#2B2620、舞台金强调 #E8B04B/#F0C878/#C98A2E、暖纸白文字 #EFEAE0/#E8E3DA/#B0A89A/#8C8478；悬停聚光+选中金色光晕+脚灯线增强（仅 dark）；冷蓝黑与 #FF7A45 橙残留=0；Edge 无头 CDP 实测 0 JS 异常。**v1.1 追加**：统计区换 B 款一行内联、资源树换 C 款编号索引（苏哥拍板），截图 `proto-stage-bc-v1.png` |
| **舞台局部款式对比（统计卡+资源树）** | `deliverables/prototypes/stage-parts-options-v1.html` + `assets/stage-parts-options-v1.png` | v1.0 | ✅ 已选定 | 统计卡 4 款 + 资源树 4 款对比；苏哥拍板 **统计 B（一行内联）+ 树 C（编号索引）**，已落回舞台皮肤原型 |
| **popup 舞台版原型** | `deliverables/prototypes/popup-stage-v1.html` + `assets/proto-popup-stage-v1.png` | v1.0 | ✅ 待苏哥验收 | `popup-redesign-v3-bd.html`（纸感浅色版）整体翻转为舞台暖黑+金：token 全量映射、金色按钮/勾选文字翻深、缩略图占位色板与平台品牌色保留；380×560 结构与交互零改动 |
| **设置页舞台版原型** | `deliverables/prototypes/settings-stage-v1.html` + `assets/proto-settings-stage-v1.png` | v1.0 | ✅ 待苏哥验收 | `settings-redesign-v1.html` 深色 token 换皮（D影院橙→舞台金，~50 色值映射，冷色残留 0）+ 默认主题改 dark；亮色 B 纸感保留可切换；布局文案零改动 |
