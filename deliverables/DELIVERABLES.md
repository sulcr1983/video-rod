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
> 2026-11-10 新增：**媒体库入口引导三方案原型**（`library-entry-guide-v1.html`）——诊断「用户不知道媒体库在哪」根因是装完从未告知，产出「欢迎页大卡 / popup 大字蒙层 / 顶栏金色胶囊」三层方案；书签写入能力已实机验证并附探针两枚。
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
| 删除验收脚本 | ~~`tools/cdp-trash-test.py`~~ → `tools/cdp-trash-empty-repro.py` / `tools/cdp-trash-dup-index-test.py` | v2.0 | 已替代 | 旧脚本基于 `#libGrid` 旧 UI，2026-11-09 随 ADR-074 状态机改造删除；新两套 18/18 + 9/9（TESTING §18.2） |
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
| 公众号成稿 · 杂志编辑版 | `deliverables/prototypes/wechat-article-magazine-v2.html` | v2 | 评审中 | **配色重做**：松烟墨 `#141A18` × 香槟金 `#B99A5B` × 冷象牙 `#FAF9F6`，替换 v1 米黄+土金（苏哥嫌旧、无质感）。文案定稿主题＝「不上架、只给自己用、只对我一个人的别扭负责」，先调研 6 类竞品各管一段与付费/商店政策限制，再走「一张图的一生」。双层渲染：`mag` 层＝内联 SVG 痛点示意插画 2 张 + 真实有头 e2e 截图 5 张（`layout-home`/`iframe-video-hover`/`setmodal`/`r1-detail`/`detail-stat`）；`wx` 层＝图位占位卡（微信只认素材库图，本地路径/SVG/base64 均被过滤，方案 Adopt 自 GitHub `starline-gzh-design` 无图床双层交付规范）。按钮：一键复制公众号 / 复制纯文本 / 复制配图清单 / 导出 2 张插画 PNG（浏览器原生 canvas，零依赖）/ 杂志版与兼容版切换 / 打印存 PDF。已 CDP 无头静态实测：结构闭合 0 错、JS 语法 OK、5 img + 2 svg 全加载、三段截图观感通过、实例 `left=0` 精确回收。**v1 冻结待归档**（文案与配色均被否） |
| 图文绑定修复方案（B-46 视频版） | `deliverables/reviews/2026-11-12-图文绑定修复方案.md` | v1.0 | 已拍板(吴八哥代) | 苏哥第一性原理：首页点下载须图文一致+兼容最高清，否则取消；专家判不取消。病根=`__vrFeedMeta` 单点全局+下载消息不带卡片标识（10 条代码证据）；外部调研星愿/油猴两派（DOM 锚定、网络响应锚定）；一期=浮标挂载点现场锚定（nearestTextCard 通用启发式）+meta 随消息+宁缺勿错护栏，**首页契约=精准文字+最高清同通道**；二期=MAIN world URL 索引；4 项待拍板已落定（取推荐项），待编程会话施工 |

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
| 悬浮按钮截图 | `deliverables/assets/overlay-douyin.jpg` | 2026-10-19 | 已定稿 | 抖音 1920×887 实拍：按钮在右上角（right gap 14px、top 76px），不与播放器控件重叠 |
| 抖音/微博/X/小红书真机验收记录 | `docs/TESTING.md` §10 | v1.8 | 已定稿 | 按钮 O1-O6、抖音 D1-D10、微博 W1-W6、主页批量 B1-B7、X 主页 X1-X9、小红书 H1-H6；4K hevc+aac 7,260,920 B；99MB complete；微博 540×960+aac 5,817,304 B；X 视频 8,401,119 B、图片 232,912 B；小红书 webp 64,510 B；稳妥限速/失败暂停 |
| 媒体库目录复盘（2026-10-19） | `docs/INCIDENT-20261019-LIBRARY-DIR.md` | v1.0 | 已定稿 | 解释 `hasMediaEntries` 白名单、E/F 混淆、原生选择器窗口、外部目录污染与重命名 API；含修复提交和当前状态 |
| 媒体库修复后截图 | `deliverables/assets/library-after.jpg` | 2026-10-19 | 已定稿 | F 盘 22 项：X 10 / 小红书 7 / 其他 5；`xbd-downloader` 与“老黄的分享”已隔离 |
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
| **QA 交付前审计（2026-11-08）** | `deliverables/reviews/2026-11-08-QA审计报告.md` + `tools/qa-toast-hint-test.py` / `tools/qa-live-real-site-e2e.py` | 2026-11-08 | 已交付 | 独立 QA 全量审计：离线 8 套件 132 断言 + 23 Node 套件全绿 + 9480 登录态「真实站点下载 50 张→媒体库显示」全链路 + 测试质量审计（worktree 故障注入验证测试能失败）。**修复 3 项并回归**：下载失败僵尸记录（重试永久被拦）、兜底改名无提示（vrNameFallback→toast）、测试断言腐烂 2 处（skin 标题/realdata 计数模型）。**暴露 P1 待拍板**：popup 批量与 SW 双写盘通道并存，Chrome 147+ 兜底丢目录前缀，50 张里 37 张落 Downloads 根未归档（文件不丢，归档语义失效） |
| **项目任务分解与实施计划（2026-11-08）** | `docs/EXECUTION-PLAN-20261108.md` | 2026-11-08 | 已交付 | 基于 QA 审计的完整执行计划：5 项待拍板决策（D-01~D-05）、6 阶段划分（决策→修复→数据债→测试→文档→发布）、Q-01~Q-15 任务表（依赖/优先级/验证）、16 份文档逐项修订判定（规范增量、日志不改，无整体重写项） |
| **小红书三扩展拆解与修复方案** | `deliverables/reviews/2026-11-08-小红书三扩展拆解与修复方案.md` + `..\work\ext-recon\`（CRX 解包） | 2026-11-08 | **待苏哥拍板** | 从官方商店拉包拆解小金薯/小红薯/小红书下载助手三家真实代码；取证我方三问题根因（①档位过滤吞掉懒加载图→没得选只能全下 ②popup 走 DOM 选择器而 SW 的 state 精确取数没接上→作者/标题全错 ③首页未按笔记分组）；给出 A/B/C 三方案与建议 |
| **小红书方案对抗性审计** | `deliverables/reviews/2026-11-08-小红书方案对抗性审计.md` | 2026-11-08 | 已交付 | 对前一份拆解方案做对抗性复审：10 条断言逐条行号取证（1 条证据链修正、1 条过时建议剔除）、stash 草稿查出 2 个硬 bug（relabel 无效调用 + index 对齐张冠李戴）、方案 2 处未定义行为补齐（首页回退边界/验证门禁）；产出修正版 M-1~M-5 实施清单（改动量减半，不碰单写盘通道） |
| **仓库分析包核验审计报告** | `deliverables/reviews/2026-11-09-仓库分析包核验审计报告.md` | 2026-11-09 | 已交付 | 对 `video-rod-repository-analysis.zip` 解压 → npm 装 93 包 → vite build / tsc / HTTP 200 → 25 个 Node 套件 25/25 → 42 条声明自动核验（正确 21 / 部分正确 10 / 错误 5 / 无法验证 6，0 检查器异常）。**开头明确「不支持 Firefox」**并优先列核验通过项；唯一 P0（B1）归因与修复方向被 ADR-040/069/070 证伪；含核验范围、逐条对照、证据摘要、风险影响、总体判断 |
| **仓库分析包核验修复文档** | `deliverables/reviews/2026-11-09-仓库分析包核验修复文档.md` | 2026-11-09 | 已交付 | R 系列 7 项（修报告）+ P 系列 13 项（修产品），逐项给优先级 / 影响范围 / 可测量验证标准；提出 Claim Ledger + 反证前置 + 数字单一真源 + CI 门禁的可复用流程；T1–T12 执行顺序、依赖与收尾门禁 |
| 声明核验器与证据包 | `.workbuddy/audit-work/audit_verify.py` / `audit-verdicts.json` / `audit-verdicts.md` / `evidence-static.txt` / `run_tests.py` / `verify_manifest.py` | 2026-11-09 | 已交付 | 可复用：`python audit_verify.py --repo <repo> --work <work> --out <work>`；42 条声明全部绑定可执行检查，检查器异常显式标「无法验证」而非静默通过；本次全部实跑输出已落盘 |
| **落盘归档 Bug 修复与 B1 复核** | `deliverables/reviews/2026-11-09-落盘bug修复与B1复核.md` | 2026-11-09 | 已交付 | Edge 157 有头实机复测推翻上一轮 B1 误判（审查包 B1 的 `vrQueueFilename` 修复方向正确、ADR-040「机制整体失效」结论不准）；最小改动 2 文件 16 行；验收 `download-path` 6/10→10/10、单通道 QA 14/14、Node 25/25、真实 Downloads 零写入；原报告不改写，以增量形式修正 |
| 实机验收记录 | `deliverables/test-runs/2026-11-09-{1212,1217,1225}-e2e-all.md` / `.workbuddy/audit-work/edge-landing-probe*.json` | 2026-11-09 | 已交付 | 修复前基线 6/10、修复中间态 6/10、最终 10/10 三份批次报告 + 四组对照探针 JSON（A 裸调 / B 预记账 / C 产品通道 / D 清账本干净复现） |
| **智小抖拆解 · 抖音取标题机制** | `deliverables/reviews/2026-11-09-智小抖拆解-抖音取标题机制.md` + `tools/analyze-zhixiaodou.py` | 2026-11-09 | 已交付 | 只读静态拆解星愿扩展「智小抖 v2.4.5」：核心是**爬 React Fiber 读播放器组件 props.awemeInfo** + 旁路 hook fetch/XHR 读页面自身响应，**全程不碰 a_bogus/msToken 签名**（0 次出现）。附 30 条拦截接口清单、`extractAwemeInfoFromPlayer` 等价代码、与我们实现的逐项对照、施工优先级 |
| **抖音标题/媒体库扫描/定位 三项修复**（B-47~B-49） | `js/douyin.js` / `js/naming.js` / `js/background.js` / `js/library/{app,indexer}.js` / `library.html` / `tools/test-naming.js` + 截图 `deliverables/assets/lib-final2.png` | 2026-11-09 | 已交付 | ① 抖音精选页无作品 ID 导致只出作者名：改用 Fiber 抠当前播放视频，实测拿到 desc/nickname/uid + 3 档清晰度，文件名 `作者(@UID)_标题.mp4`；② 「未整理」死代码（untracked 全仓库无置 1 路径）修复；③ 拆「快速扫描 / 全量扫描」两入口，修 autoIndex 降级链首步必成功导致 full 永不执行；④ 库根路径自恢复（从 chrome.downloads 反推 detectedRoot）→ 打开文件夹实测落到正确目录、快照写盘恢复跨浏览器链路。命名单测 56/56、Edge 157 有头实机全绿 |
| **抖音元数据错配 + 下载进度条 0%**（B-50/B-51） | `js/background.js` / `js/douyin.js` / `js/naming.js` / `js/video-overlay.js` | 2026-11-09 | 已交付 | ① 错配实证：文件名对（烧鸡）而库内 title/pageUrl 是另一条（万磁侠）→ 凶手 `Object.assign(trace, nm)` 无条件覆盖，`nm` 是几秒后**第二次**抠 Fiber 的结果；改为「meta 优先、nm 只补空」+ `metaFrom` 带 `workId` + 抖音 pageUrl 用 `/video/<awemeId>` 拼；再加容器 class `video_<id>` 权威 ID 校验与「在播/视口/面积」排序。② 进度条：按钮只由 B站 链路推百分比，通用/抖音无人报进度且 `vrWaitDownload` 2.5 秒超时即当成功 → 永远 0% 后突然完成；新增 `vrWatchUrlDownload`（bytesReceived/totalBytes）、把 `VRSave.saveFile` 早就存在但无人接的 `onProgress` 钩子透传、提前返回改 `started:true`、FSA 结束补 `done`、无总字节显示 `…` + 30 分钟看门狗。实测 40MB 直写进度回调 11 次 10%→100%；命名单测 56/56、Node 25/25 |
| **下载管线统一盘点**（B-52） | `docs/DOWNLOAD-PIPELINE.md` / `js/vr-msg.js` / `js/background.js` / `js/popup-videorod.js` / `js/image-hover.js` / `js/image-batch.js` / `manifest.json` | 2026-11-09 | 已交付 | ① 进度收敛为唯一出口 `vrProgressReporter(tabId,name)`（bytes/note/watch/done），三条链路共用；② **popup 单卡下载**从「猫抓直调 chrome.downloads」收敛到 SW 单通道（原来不落库、无进度、ADR-040 后可能丢目录），复用 `vrRunBatchSw(single)`；③ 新增 `js/vr-msg.js` 消掉 image-hover/image-batch 两份逐字相同的 `send()`；④ `docs/DOWNLOAD-PIPELINE.md` 盘 13 个下载入口的「落盘/入库/进度」现状 + 4 处**故意不合并**的原因（图片vs视频命名、张数vs字节进度、两套防盗链、6 份文件名清洗）+ 新通道接入检查清单。实测单图下载经统一通道 `fsa:true` 正确命名落盘；Node 25/25 |
| **视频缩略图取帧修复**（B-53） | `js/library/thumbs.js` / `tools/test-persistence.js` + 截图 `deliverables/assets/lib-thumb-v2.png` | 2026-11-09 | 已交付 | 苏哥报「信息对、视频不对」，查证**文件本身正确**（188.6s 与抖音接口 188.57s 一致，62s 画面即「巨墙」）。真凶是缩略图取帧：`Math.min(1, dur/3)` 把 seek 锁死在第 1 秒（注释写的「1/3 处」从未生效），开场是空镜的视频卡片图全是开头那一帧。修为 `min(dur-0.1, max(0.5, dur/3))`；配套修 cleanup 0ms 竞态（videoWidth 归零导致静默不生成）与 `saveToDisk` 无超时会永久挂死；新增 `THUMB_VER` 让旧图按新逻辑重建（版本判定须在磁盘兜底之前），重建失败沿用旧图避免变灰块。实测巨墙缩略图已变为巨墙本体；持久化 81 断言、Node 25/25 |
| **回收站清空失效诊断 + 修复**（P1 bug，ADR-074） | `deliverables/reviews/2026-11-09-回收站清空失效诊断.md` + `tools/cdp-trash-empty-repro.py` / `tools/cdp-trash-dup-index-test.py` | 2026-11-09 | 已实施 | Edge 156 隔离实例实测复现：`empty()` 只删 `_回收站/` 目录、不碰索引与缩略图；同一物理文件存在「有前缀 / 无前缀」两条索引时删一条 → 清空后留下死卡（列表+缩略图仍在、文件已删）——与苏哥现象完全吻合；IDB `thumb` 表从未被删（`deleteThumbs` 存在但无人调用）。附业内对照（Immich 状态化回收站 / freedesktop Trash 规范 info-先行）+ A 止血 / B 状态机改造两套方案 + T1–T6 验收断言 |
| **卡片星号移除 + 批次分组方案**（B-55 已实施 / B-56 待立项） | `deliverables/reviews/2026-11-09-媒体库卡片星号移除与批次分组方案.md` + `js/library/app.js` | 2026-11-09 | 已实施 | 苏哥拍板卡片星号难看删除（收藏收口详情页+键盘 S，starCard/已加星标筛选全保留）：净删 2 处 6 行，`node --check` 通过、无测试依赖。管理方案：业界四派对照（Eagle/Google相册/Lightroom/Pinterest）提炼 4 铁律，诊断「乱」的根源=缺批次维度，推荐方案 M 批次自动分组（batchId 入库+时间聚类兜底、组头含站点/时间/N项/整批收藏重命名、按批次/平铺可切换），智能夹 V2、手动拖文件夹与物理分库否决 |
| **嗅探规则总账 + 字节分片修复**（B-54） | `docs/SNIFF-RULES.md` / `js/video-quality.js` / `js/background.js` / `js/content-script.js` / `manifest.json` / `docs/COMPETITOR-EXTENSIONS.md` / `tools/test-video-quality.js` | 2026-11-09 | 已交付 | 苏哥报 MSN 视频「识别成图片、下载不了」，要求盘清图片/视频嗅探规则。结论：**视频靠网络嗅探（webRequest + net-sniff），图片靠 DOM 扫描（`scanImages`），两套通道**。实测三组硬证据：分片地址 `?start=0&end=15&_t=…` → 206 碎片（`Content-Range: bytes 48846-679008/3505399`）；**剥参数后同地址 → 200 + 完整 3505399 字节**；原始直链 `xxx.mp4` → 403 死链。修四处：① `unsegmentUrl` 字节分片还原（保守规则：只在成对纯数字分片时动手，签名参数一律保留）；② `vrNormalizeCandidates` 按同媒体主干归并（23→7，`x.mp4` 与 `x.mp4_bd.mp4` 合一）；③ `vrProbeCandidates` 可达性预检（403 清出列表、回填真实体积，全判死时原样放回并标「先播放几秒」）；④ `net-sniff` 改 `all_frames: true` + `addMedia` 用 `sender.tab.id` 归位（iframe 内的 `href` 匹配不到 tab）。**端到端验收：还原地址落盘 13,935,291 字节，与服务器 Content-Range 总长完全一致；MP4 结构 ftyp+moov+mdat 完整可播**。单测 57→74、Node 25/25 |
| **媒体库首页/详情页三方案可点原型**（B-56 批次分组前置探索） | `deliverables/prototypes/media-library-layout-options-v1.html` + 验收截图 `deliverables/assets/layout-{a,b,c}-home.png` / `layout-{a,c}-detail.png` | 2026-11-09 | 已交付 | 苏哥要「高级 UI 角度重规划首页+详情页、给几个可点方案对比」。**直接复用产品真源 `css/public.css` + `css/library.css` 与原版 DOM class（零自创颜色/按钮）**，同皮肤下 3 布局方案：**A 收网·分组流**（时间线按下载批次成组，组头=站点/时间/N项/整批收藏重命名）/ **B 画廊·沉浸看**（通栏顶栏+大图方卡）/ **C 管理台·三栏**（左树+列表+右侧常驻详情，点行即看）。可切方案/进详情/类型过滤，mock 30 条贴合真实场景。**无头 Chrome CDP 实机截图验收 5/5**（A/B/C 首页 + A/C 详情，0 console 错误）；**CSS 已全量内联为自包含单文件**（127KB，修复预览面板 `127.0.0.1/static-html/<hash>/` 隔离路径下 `../../css` 404 导致整页裸奔——已按「隔离子路径 HTTP 服务」复现苏哥访问方式复验：主文档 200、零 404、0 报错、5 张截图字节与 file:// 一致）；过程中修 2 个渲染 bug：① 三方案叠层（`.scheme-a/.scheme-c` 裸 display:flex 覆盖了默认 display:none）② B 顶栏与画廊并排（缺 flex-direction:column）；另发现并兜底新 Chromium 废弃 `display:-webkit-box` 导致详情 h2 塌陷 0 高（原型内联覆盖为 block，产品 CSS 未动、此兼容问题值得产品线关注）。待苏哥点选方向细化定稿 |
| **方案 A 长列表修正 · 货架两变体**（B-56 续） | `deliverables/prototypes/media-library-shelf-options-v1.html` + 验收截图 `deliverables/assets/shelf-*.png` | 2026-11-09 | 已交付 | 苏哥拍板选 A 后指出死穴：素材量大时（如抖音 1000 项）垂直分组流会把其它来源挤出屏幕。**关键判断：批次数量无限、平台数量有限（≤10），故首页按「平台」分行才稳定，批次分组降级进平台内页**。两变体同皮肤可点对比：**A2 平台货架（推荐）**=每平台固定一行，超出收敛为行尾「共 N 项 · 查看全部」渐变卡，点进平台内页（面包屑 媒体库/平台）看该平台全部批次；**A3 批次货架**=保留批次语义，每组一行可折叠/点开就地展成网格。均复用原版 CSS（已内联自包含）+ 原版 DOM class。隔离 HTTP 路径实机验收：A2 首页/A2 平台内页/A3 首页/A3 展开/A2 详情 5 张 0 报错；过程中修 3 处：`.app-shell` 丢 `#app` grid 列定义导致侧栏吃满整屏、未满一行仍显示 +N 悬空卡（改为测量后隐藏）、平台内页标题重复三层。mock 抖音 60 项专门用于演示长列表收敛 |
| **平台货架 · 紧凑版 + 筛选体系**（B-56 续，v3） | `deliverables/prototypes/media-library-shelf-compact-v1.html` + 验收截图 `deliverables/assets/compact-*.png` | 2026-11-09 | 已交付 | 苏哥四点反馈全部落地：①「整批改名」经核实是**原型自造、产品无此功能**，已从紧凑版删除（下载侧已有命名模板，事后批量改名价值低+重名风险）；②**筛选体系重构**：单一「筛选条」= 类型 seg + 时间（今天/本周/本月）+ 已星标 + 更多筛选，右侧实时「共 N 项」；有筛选时出现「已筛选」条件栏（每项可单删 + 清除全部）；无结果给出「清除全部筛选」出口（依据 ui-ux-pro-max UX-081/082/074/042）；③**双搜索去重**：删除左树「搜索平台/博主」输入框，全局仅保留标题行一个搜索（标题/作者/标签）；④**只保留平台货架并紧凑化**：卡片 168→128px、标题单行截断、去掉卡片平台角标（行头已有，避免重复）、大小/时间改为 hover 浮层、行末收敛改为独立虚线「共 N 项」卡（不再遮挡卡片）、平台行按最近下载倒序。视觉层级按 skill UX-029/036（色条+等宽数字+单一金色强调）。隔离 HTTP 实机验收 5 张（首页/星标筛选/平台内页/空态/详情）0 报错；过程中修 2 处：平台排序方向反了、卡片标题换行导致高度不齐。**「更多筛选」面板（大小/分辨率/标签/作者）为下一版待做** |
| **紧凑货架 v3.1：原生下拉替换 + 更多筛选真版 + 卡片空带修复** | `deliverables/prototypes/media-library-shelf-compact-v1.html` + 截图 `deliverables/assets/compact2-*.png` | 2026-11-09 | 已交付 | 苏哥三处指正全部落地：①**排序下拉白底灰字不是设计问题**——是浏览器原生 `<select>` 弹层（系统渲染，CSS 无法控制），已换成自绘深色下拉（surface-2 + 金色对勾，点空白收起）；②**「更多筛选」真版**：复用原版 `.setdrawer/.sd-*` 骨架做右侧 380px 抽屉，四组条件——大小（<1MB/1–10MB/10–100MB/>100MB）、分辨率（4K/1080p/竖构图）、标签（多选取交集）、作者（多选），底部实时「命中 N 项」+ 清除/完成；选完回主界面，条件栏逐项可删、「更多筛选」按钮挂金色数字徽标、计数联动；③**卡片下方空带根因**：原版 `.title` 写死 `height:2.9em`（两行高度）+ `-webkit-box` 截断，紧凑版只覆盖字号未覆盖高度 → 一行标题下方空出一行。修为 `display:block;height:auto;line-clamp:1`，卡高 136→110px（thumb 79 + body 29），并给行容器 `align-items:flex-start` 防拉伸。实机 CDP 量测 + 5 张截图（首页/下拉/抽屉/已选/结果）0 报错 |
| **货架行渲染改纯 CSS**（v3.2，修断档 bug） | `deliverables/prototypes/media-library-shelf-compact-v1.html` + 截图 `deliverables/assets/compact3-*.png` | 2026-11-09 | 已交付 | 苏哥截图暴露：卡片行只剩 1–2 张、虚线卡飘中间、右侧大片空白，下方平台行甚至无卡片。**根因=用 JS 量 `clientWidth` 决定隐藏几张，页面加载早期量到 0 宽 → 只留 1 张，之后无 resize 不再重算**（脆弱方案，窗口/时序稍变即崩）。彻底改法：**放弃 JS 测宽**，改为「每行渲染前 12 张 + `overflow:hidden` 自然裁切 + 右缘 64px 纯 CSS 渐隐」（Netflix/Apple TV 范式）；删除虚线「共 N 项」块，信息收口到行头「查看全部 60 项 →」。验收：1440 与 1000 两种宽度实机截图——行宽 1085px、12 张卡连续铺满到右缘渐隐，窄窗口同样饱满，各平台行均有卡，0 报错 |
| **平台货架改版 · 变更规格（PRD）** | `deliverables/reviews/2026-11-09-平台货架改版变更规格.md` + `docs/DECISIONS.md` ADR-076 + `docs/BACKLOG.md` B-61~B-65 | 2026-11-09 | 已交付 | 苏哥要求「只改要改的、其他不许动」并要正规工程流程。产出：R1–R9 九项变更清单（精确到文件/函数/class）、**红线不改清单**、原型专属不进产品的差异对照、技术前提（batchId 缺失→平台内页降级为时间线）、4 项已知风险（-webkit-box 废弃列 B-65 先修）、S1–S9 施工顺序（每步独立验收+实机截图+单次 commit）、8 条可测验收口径。ADR-076 记录决策与否决项；BACKLOG 新增 B-61 货架首页 / B-62 筛选体系 / B-63 自绘下拉 / B-64 删左树搜索 / B-65 -webkit-box 兼容 |
| **抖音图文页图片按钮/嗅探失效诊断与修复**（B-57） | `deliverables/reviews/2026-11-09-抖音图文页诊断.md` + `js/douyin-note.js` / `js/douyin.js` / `js/background.js` / `js/image-page.js` / `js/image-batch.js` / `manifest.json` / `tools/test-douyin-note.py` | 2026-11-09 | 已交付 | 三症状三根因：①图文作品图是轮播 1369×876 透明 `<button>` 的 background-image，悬停只绑 `<img>` → 零入口（另加浮标默认关）；②侧边栏把档位 `imgTierMin=2000` 当采集门槛，1066×1424 真图在 `scanImages` 阶段被筛光，只剩 297 条无尺寸源码地址；③「超大隐形按钮」是抖音轮播自己的透明 slide 按钮（10 个并排），非我方元素。修：扫描门槛恒 1、档位只筛选 + 「全部」档 `||100` bug + 档位自愈；新增 `douyin.js: noteFunc` 爬 Fiber 读 `awemeInfo.images[].urlList`（无水印，jpeg 优先）、`vrDouyinImages` 主世界注入、`js/douyin-note.js` 页面浮层「下载本作品图片 15」、批量消息透传 `authorFull` 落到 `抖音/摄影师沙皮/<标题>/`。验收：真机 11/11（15 张 1.7MB、序号完整、作者目录正确）、Node 381 断言全绿、离线 e2e 7/9（e2e-buttons 需隔离库，隔离重跑 32/32；qa-preview V6 为既有失败） |
| **视频悬浮键 iframe 覆盖**（B-55） | `manifest.json` / `js/image-hover.js` / `js/background.js` / `docs/SNIFF-RULES.md` §5.5 / `test-site/iframe-video.html` + `frame-inner-video.html` | 2026-11-09 | 已交付 | 苏哥截图确认「视频卡片右上角只有图片下载和合集，没有视频」。根因两层：① `video-overlay.js` 所在 content_scripts 是 `all_frames: false`，而 MSN 播放器在 iframe 里 → 顶层查不到 `<video>` → 视频键永不挂；② 图片浮标的 `nearVideo()` 只查 `<video>`，查不到 iframe 播放器 → 封面图上冒出「4 张图」按钮并盖住位置。修：video-overlay 拆独立注入组 `all_frames: true`；`nearVideo` 增加 iframe 判定（祖先里 iframe 面积 ≥ 图片 70% → 视为视频封面，图片浮标让位）；`vrVideoOptions/vrVideoDownload` 增加 `frameId` 参数，按按钮所在 frame 探测「正在播的」地址。实测测试页：修复前 iframe 内 `.vr-vob` 为 0 且顶层有图片浮标、两按钮重叠；修复后 iframe 内出现 `vr-vob vr-on`（80×48 右上角），顶层图片浮标 0 个，只剩视频键。Node 25/25 |
| **死链变体探测**（B-56） | `js/video-quality.js` `variantUrls` / `js/background.js` `vrProbeCandidates` 两轮探测 / `docs/SNIFF-RULES.md` §5.6 / `tools/test-video-quality.js` | 2026-11-09 | 已交付 | 苏哥追问「为什么 MSN 视频下不了，Plus 都能下」。先读透 Plus 4.0.0：它下载就一句 `chrome.downloads.download({url})`，地址原样甩给浏览器，**没有去重/分片还原/变体探测**，并不比我们强。真正缺的一步是：给 403 裸链换 6 种请求头（无/Referer×2/Origin/组合/UA）**全部 403** = 签名墙，改头无用；而同主干的转码变体 `xxx.mp4_bd.mp4` **206 + 完整 Content-Range**，三条全中。播放器只在真播放时才拉转码地址 → 不播就永远只有死链。修：`variantUrls()` 纯函数（I1-I7 七条单测）+ 预检改两轮（第一轮照常探、4xx/5xx 的进第二轮试变体、2xx 就换地址并留 `srcUrl` 回溯），正常路径零额外请求。**真机验收：3 条 403 裸链 → 全变 `_bd.mp4` → 点下载落盘 23.33MB，结构 ftyp+moov(183034)+mdat(24276172) 完整可播，文件名正确**。单测 74→81、Node 25/25 |
| **下载去重链路修复**（B-59） | `deliverables/reviews/2026-11-09-去重链路修复.md` + `js/background.js` / `js/library/dedup.js` / `js/library/indexer.js` / `js/library/trash.js` / `js/library/app.js` / `library.html` / `tools/test-dedupe-key.js` / `tools/test-dedupe-live.py` | 2026-11-09 | 已交付 | 四层同时失效才有「点几次下几份」：账本键是整条签名 URL、图片入库不带 sourceUrl、索引重建丢 sha256/isRef、库页未载 dedup.js 且用假删除。修法：归一键（抖音镜像/tplv/签名统一）+ 平台分账（同平台跳过、跨平台放行）、meta 补来源键、mergeEntry/快照保住指纹与引用、引用条目豁免 missing、downloads 重建不再抹掉 FSA 直写条目、compact 必须由库页用 FSA removeEntry 删（删不掉不改库）、库页补模块与「内容去重」入口。真实库 61→16 文件（合并 48 条、修复 49 条残留）；单测 19+21、真机 15/15、e2e 7/9 + 隔离按钮 32/32 |
| **13 个下载扩展逐个拆解 + 通用性差距**（B-57） | `docs/COMPETITOR-GENERIC-GAP.md` / `js/background.js` `vrDownloadLooksInvalid` + `vrDiscardBadDownload` | 2026-11-09 | 已交付 | 苏哥要求逐个拆解、找出通用性短板。13 个下载类扩展归成 5 条技术路线（纯 DOM 扫描 / webRequest+MIME / **captureStream 录制兜底** / ffmpeg.wasm 合并 / 站点接口）。最反常识：Download Master 连 webRequest 都没有，只扫 `document.links + video/audio/source/embed/object` 就「全站可下」—— 靠的不是嗅探强，是不挑。六条差距按价值排：①无录制兜底（Pro 的 captureStream+MediaRecorder，MSE/blob/加密可播全救，代价实时时长）②下载成功但内容是错的→**已实施校验**（判坏删文件+删记录，规则比 SnapHD 保守：只拦 text/* 与 json/xml + 0 字节，未知 mime 放过；2.5 秒短等待分支判坏后继续走回退路线而非直接失败；9 条用例全过）③SW 保活**核实后不用抄**（我们 500ms 轮询自带保活，且 alarms 最小 1 分钟 > 30 秒窗口，抄了是安慰剂）④DOM 漏扫 a/source/embed/object（纯静态下载站抓不到）⑤合并靠手写 vs ffmpeg.wasm ⑥单线程 vs 5 线程 Range。同时列出我们比它们强的四点：分片还原、变体探测、DNR 改 Referer（SnapHD 注释承认它放弃了）、命名+资源库+去重。Node 26/26 |
| **录制兜底**（B-58） | `js/vr-capture.js` / `js/video-overlay.js` / `js/background.js` `vrCapSessions`+`vrCapFlush` / `docs/COMPETITOR-GENERIC-GAP.md` §差距1 | 2026-11-09 | 已交付 | 苏哥拍板「人家的优势都要抄，按不同情况触发不同模块」。策略链 L0 地址准备 → L1 下载器 → L2 页面fetch → L3 离屏 → **L4 录制兜底**。`video.captureStream()` + `MediaRecorder`（vp9→vp8→webm→mp4 逐级降级），入口在悬浮键菜单最后一项「录下来 / 要播完 · 画质是重编码」，**无候选时也必定出现**。`rec.onstop = finishOnce` 接住「视频播完自动停止」，幂等。传输踩三个坑并写进注释：①Port 随 SW 回收静默断开 → 每次 ensurePort + onDisconnect 先落盘；②sendMessage 传 base64 → atob 稳定报 not correctly encoded（清洗也救不回）；③**port.postMessage(ArrayBuffer) 传不过去** —— Chrome 扩展消息是 JSON 序列化不是结构化克隆。最终用数字数组。真机验收：录 6 秒 → parts:2/954KB → 落盘 **1.50MB**，文件头 `1a45dfa3`（EBML magic）= 有效 WebM |
| **纯静态下载站兜底**（B-59） | `js/background.js` `vrScanMediaLinks`+`vrLinkDownload` / `js/video-overlay.js` 链接按钮 / `test-site/links-only.html` / `docs/COMPETITOR-GENERIC-GAP.md` §差距4 | 2026-11-09 | 已交付 | Trigger 刻意做窄：**只在页面一个 `<video>` 都没有时**才扫链接并出按钮，出现 video 自动隐藏。扫 `a[href]`/`source[src]`/`embed[src]`/`object[data]`，只收媒体扩展名、跳过 blob/data/javascript、同 URL 去重、视频优先+路径短的靠前、上限 24 条；下载站常把地址 URL 编码一层（`xxx%2Emp4`）先 decode 再判。下载走 `vrDownloadWithName`，命名/归档/入库/内容校验全复用。真机验收（0 个 video 的测试页）：按钮「下载链接 2」→ 面板两条 → 落盘 **1,128,375 字节**与源文件一致。**另两条差距判定不做**：多线程 Range（`chrome.downloads` 本身多连接，自研要重写落盘+断点续传，收益远小于风险）、ffmpeg.wasm（无真实失败样本，体积涨 3~5MB 不值）|
| **侧边栏尺寸档位裁切修复**（B-60） | `css/image-page.css` + `tools/test-tiers-css.js` / `tools/test-sidebar-tiers.py` + 截图 `deliverables/assets/2026-11-09-sidebar-tiers.png` | 2026-11-09 | 已交付 | `.ip-tiers` 由「单行 nowrap + 隐藏滚动条」改为 `flex-wrap: wrap`：侧边栏 380px 下 5 个档位（全部/小/中/大/超大）从「超大被裁掉」变成两行全部可见；pill padding 10→9px。契约测试 7/7；真机 390×780 实测 `rows=2, allInside=true`，最大右边界 326 < 390 |
| **抖音图文按钮「点了没反应」二修**（B-66） | `js/douyin-note.js` / `js/image-batch.js` / `tools/test-douyin-note.py` + 截图 `deliverables/assets/2026-11-09-note-skip-feedback.png` | 2026-11-09 | 已交付 | 根因三条：①全跳过时 `runQueue` 的 settle 没带 `skipped`，调用方看到 `succeeded=15` 就显示「已下载 15 张」，用户翻目录没有新文件 → 判定「没反应」；②进度条把 duplicate 算进「已下载」；③抖音页面全局监听偶发在捕获阶段吞掉 click。修：三个 settle 分支回传 skipped、按钮三分支终态（已下载 / 新下 X·已存在 Y / 已存在 N）+ 5 秒保持 + toast 明说、capture+pointerup 双保险、meta 缺失现场补读、进度条改 `ok-skipped`。真机 13/13；全新下载与重复点击两条路径均实测通过 |
| **去重二修：内容指纹 + 作者段**（B-67） | `deliverables/reviews/2026-11-09-去重二修-内容指纹.md` + `js/background.js` / `js/library/save.js` / `js/library/path.js` / `tools/test-dedupe-content.py` / `tools/test-dedupe-live.py` + 截图 `deliverables/assets/2026-11-09-dedupe-repeat-click.png` | 2026-11-09 | 已交付 | 上一版只做到 URL 级去重。本次补内容级：落盘后算 sha256 → 命中库里实体就删掉新副本并写引用卡（删文件走 FSA removeEntry + 复核，不再用假删除的 `fetch(file://,DELETE)`）；修掉作者段回退域名导致的「同一作品两套目录」（`抖音/www.douyin.com/…` vs `抖音/摄影师沙皮/…`），抖音图文侧边栏批量改为注入 noteFunc 取昵称；批量内加 `batchSeen` 同键去重；`save.js` 回传真实落盘 relPath（`freeName` 会改名，用预测路径会删错文件）。`test-dedupe-content` 12/12、`test-dedupe-live` 15/15、`test-douyin-note` 13/13、Node 381 全绿、e2e 6/9（三项非本次回归）；真实库同内容组 6→0 |
| **侧边栏「未知尺寸」独立档**（B-68） | `deliverables/reviews/2026-11-09-侧栏未知档.md` + `js/image-page.js` / `css/image-page.css` / `tools/test-tier-unknown.py` + 截图 `deliverables/assets/2026-11-10-tier-unknown.png` | 2026-11-09 | 已交付 | 原来尺寸未知的图不参与尺寸过滤（防懒加载整页被吞），结果选中「大 ≥1200」时混进一堆「尺寸未知」，既像筛选失效、又无法单独挑出。改：抽出 `inTier()` 统一口径 —— 全部含未知、尺寸档只显示该档、新增「未知」档（`data-min=unknown`，内部值 -1，虚线边框区分，选中后转实线）；「未知」档带一句「多半是图标/头像/占位图，建议挑着下」；`imgTierMin` 允许 -1 存读；整页都没量出尺寸时改为提示「点未知」，不再硬切回全部。真机 9/9（392 张里未知 324、大档只剩 1 张）、CSS 契约 7/7 |
| **回收站清空后死卡复发诊断 + 修复**（P1，ADR-074 补强） | `deliverables/reviews/2026-11-10-回收站清空后死卡复发诊断.md` + `js/library/trash.js` / `tools/cdp-trash-empty-repro.py` | 2026-11-10 | 已实施 | 真实库取证：清空确实执行（ops 日志 items=16）、但 24 条索引指向已删文件；排除「扫描复活」（reload + 四种 build 均 0 复活）；根因=删行静默吞错、只读 trashedRows、无清空后对账。修复：批量重删+读库核验、清理集合覆盖 manifest、dropDeadCards 死卡兜底（empty 含 missing / sweep 守 ADR-030）、重复删除不留孤儿副本。回归 23/23 + 9/9 + 9/9 + 28 按钮 0 错 + 8/8；真实库清完 50 行全部对上文件 |
| **本地播放器字幕 · 方案评审** | `deliverables/reviews/2026-11-10-本地播放器字幕方案评审.md` | 2026-11-10 | 已归档（不实施，苏哥拍板「不做了」） | 调研文档仅存档。三件事拆清：①**外挂字幕**（.srt/.vtt）能做、零依赖、Plyr 原生支持、实机验证中文正常显示；②**Chrome 自带实时字幕**现在就能用但浮窗归 Chrome 管、不可导出；③**内置 ASR**（Whisper 本地）=「又慢又大又卡」坑。坑：扩展页 `fetch('file://')` 受限，须走 `VRFile` 句柄。**格式兼容实测**（Chrome 156 canPlayType）：mp4(H.264/HEVC/AV1)+webm 稳放，mkv/mov/m4v 勉强，flv/ts/avi 放不了，m3u8/mpd 裸播放不了（canPlayType 返回 maybe 是假象）但下载管线落盘前已合成 mp4。**字幕 API**：OpenSubtitles/assrt.net 只认片名/IMDb，短视频搜不到。**小视频自动加字幕**=云 ASR（讯飞/阿里/腾讯/火山/Whisper，0.4~2.4 元/分钟）。探针脚本与验证页已随收工清理，仅存本文档 |
| **站点名显示成域名 · 诊断报告** | `deliverables/reviews/2026-11-10-站点名显示域名诊断.md` + `tools/diagnose-site-name-wiring.js` | 2026-11-10 | 已交付（诊断，未改产品代码） | 苏哥截图问「设计里有自动获取网站名字，为啥显示域名」。三层根因：①**库页从不调 `VRSiteNameStore.ready()`**（全仓只有 SW 下载链路与 options 设置页调），`VRSiteRegistry` 的 learned 层整体缺席，左栏只剩 381 条预置表 → 截图 6 个有名字的站全是预置表命中；②`nameOf()` 不归一域名，`www.bizhi66.com` 查不到字典里的 `bizhi66.com`（连 `www.xiaohongshu.com` 都查不到预置表），`siteGroupKey` 还会按 `www.` 裂组；③ADR-061 明定站名只在下载那一刻抓，历史条目无回补通道。离线探针逐项复现截图；三个站点首页实抓 + `parseHtmlInfo` 分别给出「一点资讯 / 4k壁纸 / 百变桌面」，证明提取器本身有效；下载链路 `detect()` 正常，不动。修复分 F1（boot 里 await ready + refresh）/ F2（nameOf 归一）/ F3（预置表补 3 条，最快见效）/ F4（一键批量补齐，需拍板外发请求）/ F5（回归断言）。**真机未连（9480 未监听），`vrSiteNames` 实际内容按 D1 铁律标 REVIEW**；F1 落在正被另一会话修改的 `app.js` 上，需协调写入 |
| **站点名自动补齐 · 实施报告**（F1/F2/F4，ADR-077 / B-69） | `deliverables/reviews/2026-11-10-站点名自动补齐实施.md` + `js/library/{app,site-registry,site-name-fill}.js` / `library.html` / `tools/{test-site-name.js,test-site-name-fill.js,test-site-name-fill-live.py,diagnose-site-name-wiring.js}` | 2026-11-10 | 已实施 | 苏哥拍板「名字要自动探测，不许人工指定」+ 准许 F4。F3 预置表补名**否决**，一个字未写进预置表。真机 F4 自动抓出「一点资讯 / 4k壁纸 / 百变桌面」（3/3），左栏三个裸域名全消失、原 6 站名不变；`vrSiteNames` 1→4 条，解除诊断报告 REVIEW 项；Node 28/28、92/92、27/27。附并发事故：根 `library.html` 曾被写成 100% NUL 文件，已从 dist 完好版恢复并补回脚本引用 |
| **站点名补齐真机截图** | `deliverables/assets/2026-11-10-site-name-fill.png` | 2026-11-10 | 已交付 | Edge 157 有头实拍，左栏「其他站点」展开态：小红书/抖音/B站/**一点资讯**/Pixso/网页/Instagram/Pixabay/腾讯视频/**4k壁纸**/**百变桌面**；右侧货架行头同步换成新名字 |
| **微博视频删不掉 · 诊断与修复**（2026-11-10 12:26 复发，非上次死卡问题） | `deliverables/reviews/2026-11-10-微博删除失败诊断.md` + `js/library/{trash,app}.js` / `tools/{cdp-trash-stale-state-test.py,cdp-batch-test.py}` | 2026-11-10 | 已实施 | 真实库 ops 日志抓到 `delete failed=1, code=11 InvalidStateError`：文件在、权限 granted、句柄链全 ok，纯 FSA 状态缓存抖动；旧代码不重试→回滚打标→卡片还在、回收站 0 项，而三处单条删除 UI 无视 `rr.failed` 照弹「已移入回收站」。修复：只对 InvalidStateError 重解析句柄+退避重试 3 次、`exists()` 严格化防「静默假删」、failed 带原生错误名、三处 UI 统一如实回执并给「重试」。新套件 17/17（含真实 UI Delete→确认框→失败 toast→重试），既有 23/23 + 9/9 未回归。数据未丢，用户重载扩展后再删一次即可。同时把「有头 e2e 一轮只起一个实例、精确回收、不碰其它会话」写进 TESTING.md §1 / ARTIFACT-MANAGEMENT.md §2.5 / cdp-run.py 头 |
| **媒体库入口引导三方案原型**（用户「不知道媒体库在哪」） | `deliverables/prototypes/library-entry-guide-v1.html` + 截图 `../work/shots/0{1,2,3,4}-*.png` + 探针 `tools/probe-bookmark-ext.py` / `tools/probe-bookmark-popup.py` | 2026-11-10 | 已交付（原型，待拍板实施） | 苏哥报「大家不知道媒体库在哪儿」。诊断：不是入口藏得深，是**从来没告诉过用户有这么个东西**——装完自动打开的 `install.html` 整页讲功能/隐私/免责，零处提媒体库；popup 里它只是顶栏第 3 个 16px 灰图标，和设置/侧边栏长得一样。三层方案可点原型：**①装完那一眼**=欢迎页四条能力下方插金色大卡（34px 大字「媒体库，在另一个页面里」+ 地址条复制 + 打开/加收藏夹）；**②点开图标**=popup 盖暗色蒙层+26px 金字卡（380 宽下的最大可读字号），完成首次认知，完成任一动作即永久静默、最多弹 3 次；**③长期入口**=顶栏金色胶囊「媒体库」替代灰图标（跟随现有「启用媒体库」开关，不新增设置项）。**技术前提已实机验证**（Edge 156 隔离实例，探针两枚）：扩展能在 popup 上下文直接 `bookmarks.create` 写 `chrome-extension://` 地址并读回，**无需 userGesture**；收藏栏节点 id=`1`；**坑：连点两次会产生两条重复书签**（浏览器不查重）→ 必须先 `search` 再决定加不加。**顺带查出真 bug**：`popup.html` 里 `vrOpenLibrary` 这个 id 写了两遍（顶栏图标 + 工具抽屉「资源库」按钮），`getElementById` 只认第一个 → 设置里「关掉媒体库入口」只关得掉顶栏那个。截图验收 4 张 0 报错（含「已加收藏夹」终态）；过程中修 1 个渲染 bug（`.meta .t` 缺 `display:block` 导致文件名与规格挤同一行） |
| **媒体库入口引导 · 已实施**（v2.7.2.2，ADR-078 落地） | `install.html` / `css/install.css` / `js/install.js` / `popup.html` / `css/videorod.css` / `js/popup-videorod.js` + 验收 `tools/qa-install-gate.py`（17/17）/ `tools/qa-lib-intro.py`（16/16）+ 截图 `deliverables/assets/2026-11-10-{popup-libintro,install-gate-full,install-gate-card}.png` | 2026-11-10 | 已实施 | 三层全部落地：**①欢迎页改版**——原四宫格换成「5 条痛点 → 解法」对照卡（苏哥口述五条，暗红痛点条 + 金色解法条，第 5 条跨两列防失衡，结语卡列明 7 个深度适配站点 / 0.1–3× 十档倍速 / Chromium 93+ 全兼容，每条文案均经代码核实未夸大）；**②媒体库入口大卡**（34px 大字「媒体库，在另一个页面里」+ 地址条 + 复制 / 打开 / 加收藏夹）；**③popup**——顶栏灰图标改金色胶囊「媒体库」（67px 带文字）+ 首次大字蒙层（26px「素材库在这」），弹出策略=完成任一动作永久静默 / 什么都不做最多 3 次。**实机修掉三个坑**：a) 连点两次书签会重复 → create 前必 search 查重（进页面先查 + 点击再查，双保险）；b) 猫抓原生提示 #TipsFixed z-index=9999 会浮在蒙层上遮大字 → 蒙层提到 10001；c) `vrOpenLibrary` 重复 id → 抽屉按钮改名 `vrOpenLibraryDrawer`，`applyLibraryVisibility` 改为同时管三处（修复「关掉开关抽屉照旧显示」）。**测试脚本踩坑留档**：Edge 自带 8 个内置扩展，CDP 探测扩展 ID 不能取列表第一个 `chrome-extension://`（会拿到内置扩展 → popup 404 → 断言全灭），必须按 install/popup/library 特征页定位；`open_popup` 复用旧标签页会读到改 storage 前的旧 DOM → 每次先关旧标签；`Browser.close` 后进程异步退出，立即复核会误报残留 → 等待循环后再复核。manifest 版本 2.7.2.1 → 2.7.2.2 |
| **下载进度全链路修复**（B-60） | `js/background.js` `vrProgressReporter` / `js/bili-whole.js` `durlFunc`+`dashFunc` / `js/video-overlay.js` `setState` / `js/popup-videorod.js` `pollBiliWhole` / `tools/test-progress-report.js` / `test-site/progress-probe.html` | 2026-11-10 | 已交付 | 苏哥报「B站下载只有 0%，没有进度信息」。排查全部 7 条下载通道，发现三层问题：① **B站 durl 通道只写 loaded/total 不写 pct**，后台只读 pct → 悬浮键永远 0%（dash 通道有 pct 所以没事）；② `note()` 收到 null 百分比时发 `{pct:0}` —— 把「不知道」伪装成 0%，每秒还刷一次；③ **done() 的终态消息永远发不出去**（先置 closed 再调 send，而 send 开头 `if (closed) return`）—— 大文件下完按钮一直 busy，只能等 30 分钟看门狗变叹号（单测 P12 抓到）。修：页面侧统一契约（pct/phase/indeterminate 三字段，indeterminate 明确标注「不知道」）；reporter null 百分比改发 indeterminate 且同阶段只报一次；done 强发；悬浮键加进度条 + 阶段文字（「下载画面 37%」，按钮忙碌时自动加宽防竖排）；点击后先显示「准备中」而不是 0%；popup 修掉 `if (st.pct)` 把 0 当 falsy 的坑。真机端到端：真消息驱动 37%→82%→done 全部正确渲染。单测 21 条新增，Node 29/29 |\n
| **小红书视频「下错」修复**（B-70） | `deliverables/reviews/2026-11-11-小红书视频取址修复.md` + `js/background.js` / `js/video-quality.js` / `tools/test-video-quality.js` | 2026-11-11 | 已交付 | 根因四条：笔记页 `<video>` 是 blob:（MSE）导致「正在播放」探测失效；嗅探缓存按 tabId 累积、SPA 切笔记不清理，池子里混着多篇笔记；通用排序「分辨率最高」压过「正在播放」；pageUrl 带一次性 token。修：`VRXhsVideoProbe` 直接读 SSR state 里当前 note 的 `video.media.stream`（只给完整 mp4，不拿 m4s 分片）；通用层 `VRVideoQuality.docKey` 按文档归属过滤候选 + `prioritizePlaying` 两段式（先锁作品、族内取最高，CDN 节点用 familyKey 归一）；pageUrl 改用 `explore/<noteId>`/`video/<awemeId>`。单测 100/100；真机两条笔记各自下对（文件名含正确作者标题、pageUrl 归一）；隔离 e2e 6/9（3 项非本次） |
| **小红书实况图下载**（B-71） | `deliverables/reviews/2026-11-11-小红书实况图下载.md` + `js/background.js` / `js/image-page.js` / `css/image-page.css` + 截图 `deliverables/assets/2026-11-11-xhs-live.png` | 2026-11-11 | 已交付 | 实况图 = 静态首帧 + 2~3 秒 mp4，此前只下到首帧。新增 `vrXhsLiveProbe` 从 SSR state 取 `imageList[i].stream.EF4[0].masterUrl`，用「素材 id」（pathname 尾段剥 !xx）与 DOM 图配对；卡片加「实况」角标；批量与单张预览下载都在静态图后追加 `_live` mp4；`vrImgExt` 放行 .mp4（原会被 VR_IMG_EXT_OK 强改成 jpg，文件头是 mp4、后缀却是 jpg）。库内新增「实况」类型页签+金色角标+预览（照片+同前缀 `_live.mp4` 成对才归实况，`test-live-pair` 17/17）；动图 gif/apng 下载与逐帧预览本就支持。真机 5 张全实况：角标 5 个、只勾这 5 张落 10 个文件（5 jpg + 5 mp4，ftypisom 正确）。未做：库内照片+实况一体化预览、其它平台实况 |
| **B站下载失效 + 库页换目录**（B-72） | `deliverables/reviews/2026-11-12-B站下载失效与库页换目录.md` + `js/bili-whole.js` / `js/background.js` / `js/video-overlay.js` / `js/library/app.js` / `tools/test-bili-source.py` / `tools/e2e-buttons.py` | 2026-11-12 | 已交付 | B站「下载不了」真因是去重按整条页面记账：选项只有 durl/dash 没有直链 URL，键退化成 pageUrl，一条页面多集时下过一集就把其余全判重复，而跳过只闪绿勾看不出原因。改：去重键 `bvid_cid_档位`、`vrFindExistingMedia` 支持 workId 且不再用 pageUrl 兜底、浮标加文字提示（跳过/无源/失败）、probeFunc 按 `?p=` 取对应 cid 并带回分P 标题与 UP 主 mid、命名改到 probe 之后。另修库页左上角：2026-11-10 删掉设置里的保存位置又把路径卡改成跳设置页，导致没有换目录入口；现改为点主体弹目录选择器（上级目录自动下钻、空目录二次确认、取消静默、显示文件夹名），右侧箭头仍去完整设置。验证：`test-bili-source` 12/12、真机 durl 51.9MB/dash 76.7MB 落盘、path 90 / save 51 / quality 100、e2e-buttons 隔离 32/32 |
