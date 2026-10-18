# 钓鱼竿 Video Rod — 决策记录（ADR）

> Architecture Decision Records。记录「为什么这么做」，防止以后回头看忘记当初的理由。
> 状态图例：✅ 已生效 ｜ 🟡 生效中（施工期） ｜ 📋 已计划未开工

---

## ADR-001 底座选型：fork 猫抓，不从零造轮子

- **日期**：2026-10-17 ｜ **状态**：✅
- **背景**：要做「CocoCut 式视频嗅探下载浏览器」，从零写 MV3 嗅探引擎工作量巨大且站点适配永远追不完。
- **决策**：fork 猫抓 cat-catch v2.7.2 作底座，嗅探内核/下载器/FFmpeg 合并全部沿用原样。
- **理由**：猫抓是成熟开源项目（GPLv3），站点适配脚本持续更新；fork 后仍可 cherry-pick 上游更新。个人自用无分发义务，保留 LICENSE 与上游署名即可。
- **影响**：全部改造被约束在「外壳层」，内核文件列为禁改区（见 ADR-015）。

## ADR-002 工作方法：所有功能先对标标杆，不自己造轮子

- **日期**：2026-10-17 ｜ **状态**：✅
- **背景**：苏哥原话「你不要自己造轮子，一定要参考人家优秀的插件是怎么做的」。
- **决策**：每个功能先找到业界标杆的成熟做法，抄设计、抄实现思路，不自创方案。对标表见 PLAN.md「参考实现对标」节。
- **理由**：标杆做法经过大量用户验证，坑都踩过；自创方案必然重复踩坑。
- **影响**：技术选型全部有出处（VDH / Plucker / 图片下载四件套 / bilibili-API-collect / avi12）。

## ADR-003 破解定位：能力拉满，不做商店式自我审查

- **日期**：2026-10-17 ｜ **状态**：✅
- **背景**：我曾按商店扩展的自我审查逻辑回避「接口破解」。苏哥纠偏：「我是自用的，又不是商业也不分发也不会公开，自己做插件肯定是为了破解啊！更多功能啊。全功能啊」。
- **决策**：B站/YouTube 主动抓取做全功能：分P/合集/播放列表/频道/登录态内容全支持。
- **理由**：自用工具无商店审核、无分发风险，能力拉满就是第一需求。
- **影响**：M3/M4 从「可选增强」升级为 P0 核心模块。

## ADR-004 起名策略：智能识别 + 作者前缀

- **日期**：2026-10-17 ｜ **状态**：🟡（M0 实现中）
- **背景**：苏哥要求「视频名字要用文章标题，或者推特正文为文件名」「小红书推特要带着原主的id，更方便寻找」。
- **决策**：
  1. 智能识别：文章页取大标题（剥「标题_网站名」尾巴）、推特页取推文正文（去前缀/引号/t.co 链接/换行压空格）、认不出退网页标题
  2. 作者前缀：`昵称(@账号)_标题.ext`；推特取 @handle+显示名，小红书取昵称+小红书号
  3. 作者缺失自动跳过该段，不留空下划线
  4. 模板变量：`${title} ${post} ${author} ${site} ${index} ${date} ${ext}`
- **理由**：带回原作者 ID 方便回溯来源；自动剥尾巴/去前缀保证文件名干净可用。
- **影响**：naming.js 成为全局依赖模块，先行开发（M0）。

## ADR-005 目录策略：按平台/作者自动分文件夹

- **日期**：2026-10-17 ｜ **状态**：🟡
- **决策**：默认总目录 `Downloads/video-rod/`；小红书/推特等平台自动 `平台/昵称(@账号)/` 分目录；每条可手动改；提供最近目录+新建。
- **理由**：与文件名作者双保险；抄 Kromio 的 `images/${domain}/` 分组思想，升级为按平台/作者分。
- **技术约束**：chrome.downloads 的 filename 只支持相对下载目录的子路径——「下载到文件夹」= 下载目录下建子目录，与 Plucker 同款实现。

## ADR-006 清晰度：默认自动选最高档

- **日期**：2026-10-17 ｜ **状态**：✅（猫抓原生行为，纯确认）
- **决策**：m3u8 多档时默认勾选最大带宽档；设置里可关、可改成「记住上次选择」。
- **理由**：猫抓默认就是最高档，零开发；符合「下就下最好的」直觉。

## ADR-007 图片功能进 P0

- **日期**：2026-10-17 ｜ **状态**：✅
- **背景**：图片批量下载原定 P1，苏哥问「还可以下载图片？」后拍板提前。
- **决策**：网页图片批量下载进第一批（F7），抄业界四件套：DOM 扫描（img/srcset/背景图/懒加载/shadow DOM）+ <100×100 过滤 + currentSrc 最高清 + MutationObserver。

## ADR-008 B站/YouTube 纯扩展实现，不装 yt-dlp

- **日期**：2026-10-17 ｜ **状态**：🟡（M3/M4）
- **决策**：B站/YouTube 解析全部用扩展内置 JS 实现，不装 yt-dlp/Python/任何外部程序。B站抄 bilibili-API-collect 的 WBI 签名；YouTube 抄 avi12/youtube-downloader 的页面变量+decipher（Apache-2.0，保留版权声明）。
- **理由**：自用工具要保持「装个扩展就能用」的干净形态；社区成熟 JS 实现已存在，集成即可。

## ADR-009 登录态内容：支持

- **日期**：2026-10-17 ｜ **状态**：✅
- **决策**：借浏览器 cookie，大会员/会员内容可下。
- **理由**：苏哥定：自用范畴，不分享不外传。

## ADR-010 懒加载：只抓已加载项，不自动滚动

- **日期**：2026-10-17 ｜ **状态**：✅
- **决策**：主动抓取只取当前页已加载内容，不自动滚动页面。
- **理由**：自动滚动有副作用（触发播放、加载量失控）；「先做稳的」。

## ADR-011 兜底：主动抓取失效自动退回嗅探

- **日期**：2026-10-17 ｜ **状态**：✅
- **决策**：B站/YouTube 解析任一步失败，自动退回「当前页已加载」嗅探模式。
- **理由**：站点改接口是常态，兜底保证「永远有得下」；两解析模块相互独立，一家失效不影响另一家；设置里有开关可整体关掉主动抓取。

## ADR-012 DRM 站点不做

- **日期**：2026-10-17 ｜ **状态**：✅
- **决策**：爱奇艺/腾讯/Netflix 等 DRM 严密封锁站点不做；主攻 B站+YouTube。加密站点逆向留 rea 工具作显微镜，真遇到再说。
- **理由**：全球无解（只能录制兜底），投入产出比极低。

## ADR-013 完成提醒：仅面板内 toast

- **日期**：2026-10-17 ｜ **状态**：✅
- **决策**：下载完成只在面板内 toast 汇报，不上系统通知。
- **理由**：苏哥定；面板内提示足够，不打扰。

## ADR-014 右键秒存/快捷键进 P0

- **日期**：2026-10-17 ｜ **状态**：✅
- **决策**：右键秒存（抄 VDH：元素上右键直接下）、快捷键 Alt+Shift+V（chrome.commands 官方机制）进第一批。
- **理由**：日常高频动作，值得第一批就位。

## ADR-015 拆分策略：外壳大改、内核不动

- **日期**：2026-10-17 ｜ **状态**：✅
- **决策**：猫挑嗅探引擎（init.js）、下载器（m3u8.js）、FFmpeg 合并链路为禁改区；所有新功能以独立模块挂载；每个里程碑一个 git 回滚点。
- **理由**：猫挑价值一半在持续更新的站点适配脚本；内核不动才能随时 cherry-pick 上游。模块独立保证一个坏不影响其他。

## ADR-016 命名细节：截断 60 字 + 重名序号

- **日期**：2026-10-17 ｜ **状态**：✅
- **决策**：超长文件名保留前 60 字 + 「…」；同页同名自动 `_01` `_02`；非法字符换下划线；emoji 默认删除（嫌难看可改保留）。
- **理由**：防路径超系统上限导致下载失败；重名序号防覆盖。

## ADR-017 仓库与流程：GitHub 私有库 + 正规文档

- **日期**：2026-10-17 ｜ **状态**：✅（本次执行）
- **背景**：苏哥要求「按照正规软件工程的开发过程，先补齐正规文档……必须有的需求，技术，测试等等相应文档都得有」。
- **决策**：
  1. 建 GitHub 私有库 video-rod（不上公开）
  2. 补齐文档：README（门面）+ REQUIREMENTS（需求）+ DESIGN（技术）+ TESTING（测试）+ DECISIONS（本文件）+ 既有 PLAN/BUILD-PLAN
  3. GitHub token 存 `.env`，`.gitignore` 屏蔽，严禁入仓
  4. origin 改为自己的私有库，猫抓上游 rename 为 upstream 保留 cherry-pick 能力
- **理由**：小项目但流程要正规，文档是以后的记忆；私有库满足自用定位。

## ADR-018 合并路线：在线FFmpeg 是远程服务，三路线待选

- **日期**：2026-10-17（晚，外部审计后）｜ **状态**：✅ **已定稿（苏哥拍板：路线 A）**
- **背景**：此前方案一直写「FFmpeg 合并（猫抓原生）/复用猫抓 wasm 能力」。源码审计实锤：猫抓**没有本地 ffmpeg.wasm**，其「合并」是**在线FFmpeg**——用 iframe/标签页打开 `https://ffmpeg.bmmmd.com/` 或 `https://ffmpeg.94cat.com/`（init.js:213），把视频分片 blob **发送到猫抓作者的远程服务器**处理（downloader.js:90/214）。lib/ 目录只有 mux.js/hls.js 等，无任何 wasm 转码器。
- **事实认定**：原文档「FFmpeg 合并（猫抓原生）」表述没错但严重不完整，「纯本地运行无上传」（DESIGN §6 原第 1 条）**是错的**——开合并就会上传。
- **决策（2026-10-17 苏哥拍板）**：**走路线 A——保持猫抓在线FFmpeg现状，不开发本地合并**。理由：个人自用、不要过度设计，0 开发量保住 m3u8 一键合并体验；隐私暴露面仅「开启合并时」的分片上传，且默认已在 M2 设置里留「m3u8 自动合并为 MP4」开关（`#vrSetMerge`），介意的人关掉开关即回到 C 的效果。B（ffmpeg.wasm/mediabunny 本地合并）留档不实施；若未来隐私诉求升级，从 ADR-018 本条目恢复 B/C 方案即可，代码零沉没成本。
- **附带纠正**：mux.js 是单流转封装器（TS→fMP4），**合并不了分离的音频+视频两路流**——B站 DASH 场景别指望 mux.js。

## ADR-019 B站/YouTube 改版：弃签名对抗，改零对抗嗅探路线

- **日期**：2026-10-17（晚，外部审计后）｜ **状态**：🟡 已改文档，⏳ 开工即按此执行
- **背景**：外部审计报告提出 3 个硬阻塞，经本地源码 + 联网双重核验**全部属实**（比报告说的还严峻）：
  1. **bilibili-API-collect 已关停**（2026-01-28 收 B站律师函，删码停更，GitHub 仓库页面确认）。顺带查到：BBDown 2026-05-14 归档、哔哩下载姬/downkyicore/BiliTools 2026-07-06 同日收函关停——**B站下载开源生态 2026 年集体团灭**，且律师函点名行为正是「突破登录态访问控制、绕过签名鉴权、抓取付费内容、强取最高清晰度」。
  2. **YouTube 2026-01 起强制 SABR + poToken**：多方信源确认「2026 年没有 Chrome 扩展能可靠下载 YouTube 视频」，扩展是被 poToken 打击最重的品类；yt-dlp 活着但需外部运行时（Deno + PO token provider）。
  3. （见 ADR-018：合并是远程服务。）
- **决策**：
  - **B站（P0）**：改「零签名对抗」嗅探增强——分P列表从页面 DOM/状态读（不调 API、不碰 WBI），扩展驱动页面切换分P，**下载请求全部由浏览器自己发出**，猫抓嗅探实际发出的 DASH 流。大会员天然支持（浏览器能播放=请求已带 cookie）。
  - **YouTube（降级 P1）**：只走嗅探，能抓多少抓多少，不投入签名对抗。苏哥刚需时的备选路：猫抓内置 m3u8dl 协议外挂 N_m3u8DL-RE（本机程序，违背 ADR-008 但成熟稳）——⏳ 待苏哥定。
  - ADR-003「能力拉满」精神不变，但实现方式从「对抗」改为「搭便车」——2026 年对抗路线对个人开发者已无性价比。
- **影响**：M3/M4 工作量预估大幅下降（无签名/ decipher 开发）；BUILD-PLAN 的 M3/M4 目标改写；TESTING 的 B/Y 用例改写。

## ADR-020 生态剧变的事实存档（审计结论）

- **日期**：2026-10-17（晚）｜ **状态**：✅
- **背景**：本次审计由苏哥转来外部审计报告，我以「较真核验」立场逐条对质——**3 个硬阻塞全部属实**，另发现报告 1 处不准 + 2 处漏报：
  - ❌ 报告不准：「filterFileName 不滤 `\`/`/`」——实际 `stringModify` 单独处理了斜杠（转 `&bsol;`/`&sol;` 实体，function.js:252）。实质结论（斜杠被转义、不能直接当目录分隔符）仍成立。
  - 📌 漏报一：**猫抓原生已支持目录下载**（background.js:281 按网页标题建子目录 `CatCatch/` 或 `标题/`）——「下载到文件夹」不是从无到有。
  - 📌 漏报二：**猫抓原生已有文件名内联编辑 + 模板**（popup.js:73、init.js:101 `downFileName`，变量 title/url/date/ext）——「自定义命名」也不是从无到有。
- **决策（校准后的真实增量）**：钓鱼竿的核心增量 = ① 智能起名（页面识别：文章标题/推文正文/作者前缀，猫抓模板没这些变量）② 按平台/作者自动分目录（猫抓只有按网页标题）③ 图片批量扫描（嗅探清单确实无 image/*，init.js:63-73 实锤）④ 右键秒存 + 快捷键 + 批量管理 UI。命名/目录的叙事从「从无到有」改为「从有到好」，不夸大。
- **留档**：本 ADR 是 2026-10 时点的事实快照。若未来 B站/YouTube 生态回暖（或出现新的成熟开源实现），可重估 ADR-019 的路线。

## ADR-021 合并路线定案：A（保持在线FFmpeg 现状）+ 设置留开关

- **日期**：2026-10-17 ｜ **状态**：✅
- **决策**：m3u8 合并默认沿用猫抓「在线FFmpeg」远程服务（A 路线，0 开发）；M2 设置里加「合并路线」开关（A/B/C 三选），苏哥哪天介意隐私一键切本地合并（B）或不合并（C）。B/C 的实现列为 P1，开关先占位。
- **理由**：按苏哥「不要过度设计」校准——当前不为隐私洁癖提前开发，但保留随时切换的能力；远程服务是猫挑作者自用级基础设施，个人偶尔使用风险可接受。
- **影响**：DESIGN §8 三路线表标记 A 为默认；TESTING M1/M2 用例（合并路线开关）调整为「开关占位、A 为默认值」。

## ADR-022 YouTube 外挂：先不做，能抓则抓

- **日期**：2026-10-17 ｜ **状态**：✅
- **决策**：不走 m3u8dl 外挂 N_m3u8DL-RE（不装本机外部程序，守住 ADR-008 立场）；YouTube 保持「只走嗅探、能抓则抓、抓不到标记限制」的降级路线。
- **理由**：外挂要装程序、要维护两套体验；个人使用频率不明，不值得提前背这个成本。真到刚需那天，开关式加回来即可（猫抓已内置 m3u8dl 协议，接入只是配置层）。
- **影响**：PLAN 决策点 #8 关闭；M4 工作=验证+边界记录，不开发。

## ADR-023 默认下载目录：Downloads/video-rod/

- **日期**：2026-10-17 ｜ **状态**：✅
- **决策**：全局默认目录 `Downloads/video-rod/`（浏览器下载目录下建总文件夹），平台/作者子目录在此之下：`video-rod/平台/昵称(@账号)/`。
- **理由**：下载目录下建总文件夹，与系统 Downloads 根目录干净隔离，清空/迁移都方便；与 Plucker 的 Folder 思想一致。

## ADR-024 去重检测进 P0

- **日期**：2026-10-17 ｜ **状态**：✅
- **决策**：去重（下载前查记录、跳过已下地址）进 P0，随 M2 下载管线一起实现。
- **理由**：实现就几十行，防手残重复下载；chrome.storage.local 存储 + unlimitedStorage 权限（manifest 已含则不加）。
- **实现细节定案**：去重 key 不用裸 URL hash——m3u8/带签名直链每次 URL 都变，对流失效；改用 `hash(站点+标题+作者)` 兜底 + 提供「忽略去重强制重下」的单条覆盖入口。

## ADR-025 popup 浅色重设计定案：方案 A「收网」（全量整合）

- **日期**：2026-10-17 ｜ **状态**：✅（苏哥拍板）
- **决策**：popup 按另一会话调研的方案 A「收网·清单式」做浅色重设计，**全量整合**（不是渐进试点）：浅色 token 体系 + 头部两行化 + 行卡片精简（每行 1 个控件）+ 设置 4 组收编。DOM 钩子全保留，每步过有头浏览器回归。
- **理由**：① 猫抓原生主题本就是浅色（`public.css` 白底黑字，仅 dark media query 翻深），我们 M1 的深色外壳是包在外面的——浅色化 = 让猫抓原生变量在我们作用域内回归浅色，阻力最小；② 方案 A 的「清单感」最契合个人工具「快速扫一眼、批量勾选、一把薅走」的核心动线；③ 苏哥明确「个人自用、不要过度设计」，全量整合避免 AB 混搭的中间态长期化。
- **关键实现手法（留档）**：
  - 深色压制：猫抓样式靠 `#vrShell`（ID 特异性 100）> `:root`（10），media query 不参与特异性 → 新建 `css/popup-light.css` 在 `#vrShell` 作用域内钉住猫抓 17 个原生变量为浅色
  - 行展开：`:has(.url:not(.hide))` 方案失效（jQuery toggle 后 class 与 inline style 并存）→ 改 JS 在 url 面板显隐时给 `.panel` 加/删 `vr-open` class，CSS 据此控制 row2
  - 文件名展示：行卡片模板 `.name` 原本带 `hide`（一直靠 row2 输入框展示）→ 改为显示 `.name` + 新增 `.metasub` 包裹 size+mime，改名时同步标题文本
  - **z 序陷阱**：猫抓 `popup.css` 给 `#down` 带 `z-index:999`（原为 fixed 浮动底栏）；我们改 static 后，作为 `#vrShell` 的 flex item，static 元素的 z-index 仍创建层叠上下文，把 setview(470)/drawer(460)/modal(450) 全压在脚下 → `videorod.css` 补 `z-index:auto` 修复。**教训：flex item 的 z-index 不挑 position，换定位方式必须连 z-index 一起清**
- **影响**：M7 里程碑（BUILD-PLAN）；`popup.html`/`css/videorod.css`/`css/popup-light.css`/`js/popup.js`/`js/popup-videorod.js` 全量回归通过（TESTING §6 M7 记录）

## ADR-026 X(推特) 推文内联下载按钮：取平台「预混流」直链，不下载分片

- **日期**：2026-10-17 ｜ **状态**：✅
- **决策**：推文视频下载走**平台已合并好音视频的完整 MP4 直链**（`video.twimg.com/.../vid/avc1/{W}x{H}/{hash}.mp4?tag=N`），由开源元数据服务 fxtwitter（`api.fxtwitter.com/{user}/status/{id}`，免鉴权）查询得到；按码率降序自动取最高档。**不下载 HLS 分片、不本地合成、不走在线 FFmpeg**。
- **理由**：① 调研确认 X 的 `/vid/avc1/0/0/*.mp4` 是 DASH 初始化段（904B，放不了），页面播放走的是分轨 HLS——自己合成要引入 demux/mux 库并踩时间戳坑，属于自造轮子；② yt-dlp 等成熟工具走的就是这条预混流直链；③ 猫抓官方对分轨 HLS 的解法是「勾选视频轨+音频轨 → 合并下载」，我们的一键场景不适合让人手动选。
- **代价与边界**：
  - 多一个只读外部依赖（fxtwitter，只发公开推文 ID，不碰登录态、不上传视频文件）；服务不可用时应退回面板嗅探 + 手动合并
  - 直链 URL 无法拼（每个分辨率独立文件名 + tag 参数），必须查
  - fxtwitter 的 `variants` 不一定带 `container` 字段 → 按 URL 后缀 `.mp4` 判断（踩过：按 container 过滤会全部滤空）
- **已知待办**：① ~~星愿浏览器下 `chrome.downloads.download` 的 `filename` 被忽略（文件落成服务器名），模板命名待修~~ → 已修，见 ADR-027；② 设置里的「清晰度默认选最高档」目前只影响面板批量下载，按钮恒取最高

## ADR-027 下载文件名保护：自注册 onDeterminingFilename + URL 预记账（抄 XBD/CocoCut/Imageye）

- **日期**：2026-10-18 ｜ **状态**：✅
- **背景**：星愿浏览器（苏哥日常主力）里钓鱼竿的 `downloads.download({filename})` 被忽略，文件落成服务器名/UUID。根因 = **Chromium bug 579563**：浏览器内任何扩展注册 `chrome.downloads.onDeterminingFilename` 监听后，其他扩展的 `filename` 参数即失效；官方 workaround 是自己也注册该监听、对自己的下载 suggest 文件名。苏哥星愿装了 13 个扩展，其中 XBD（`piibeklj`）、CocoCut（`ekhbcipn`）、Imageye（`agionbom`）三个下载类扩展全部注册了该监听——完全吻合症状（单扩展的测试 Chromium 无此问题）。
- **决策**：按苏哥指示逆向他浏览器里装的扩展，抄三家的成熟写法（三家独立实现，套路一致，可信度高）：
  - **URL 预记账**：下载前把 `url → {filename, conflictAction}` 写进 SW 内存 Map；`onDeterminingFilename` 触发时按 `item.url`/`item.finalUrl`（重定向后地址）双查 suggest。不用 downloadId 记账——id 下载前不存在
  - **三道防线**（抄 XBD）：① `byExtensionId` 是别的扩展 → 直接 return 不碰（做好公民，多家下载扩展共存）；② 命中预记账 → suggest 记账名；③ 是自己的下载却没记账（SW 重启丢账）→ item.filename 是绝对路径 suggest 用不了，弃权降级
  - **页面侧 hook**（`js/vr-download-hook.js`）：popup/options/m3u8/downloader 四个页面加载，monkey-patch `chrome.downloads.download`，**等 SW 记账 IPC 应答后才发起下载**——blob:/data: 下载不走网络，onDeterminingFilename 几乎立即触发，fire-and-forget 式记账赛不过（实测第一版就栽在这）
  - 记账**取用不删 + 10 分钟 TTL**：同 URL 重复/并发下载都能拿到名字（实测同 URL 双下载得 `x.ico` + `x (1).ico`，uniquify 自动去重）；重下会以新记账覆盖；SW 侧 `vrDownloadWithName()` 统一入口替代 3 处裸 `downloads.download`
  - conflictAction 统一 `"uniquify"`（不覆盖已有文件）；suggest 同步调用；防御性 try/catch 包监听注册（API 异常不拖垮 SW）
- **理由**：三家生产扩展的独立趋同实现 = 经过真实用户验证的方案；自研（如按 downloadId 记账、异步 suggest）必然重复踩坑。ADR-002「先对标再动手」的又一次执行。
- **仲裁规则（官方文档）**：多扩展都 suggest 时**最后安装的赢**；调 `suggest()` 无参 = 弃权不参与竞争。我们只对自己的下载 suggest，XBD/CocoCut/Imageye 对我们的下载全部弃权 → 我们赢。
- **影响**：M8 里程碑；`js/background.js`（记账+监听+3 处下载点改造）、`js/vr-download-hook.js`（新建）、4 个 HTML 挂载；星愿真机三链路验证通过（TESTING §7）：popup blob / SW 直连 / X 按钮落盘 `video-rod/唐十七呀(@m0ve0f).mp4`（29,359,763 B，ffprobe 验证 h264 2160×3840 + aac 双轨）

---

## ADR-028 多段合并(M11)：放弃「驱动猫抓 m3u8 页」，改为离屏直连管线

- **日期**：2026-10-18 ｜ **状态**：✅
- **背景**：M11 第一版选了「开后台标签跑猫抓 m3u8 页面、拦它的下载来驱动合并」。但猫抓的 m3u8 页是给「人手动点一个标签页」设计的，不是给程序调用的——结果在真机上踩了约 8 个衍生坑：iframe 里 `chrome.tabs.getCurrent` 崩（只能开真标签）；合并完可能走「在线 FFmpeg」分支、字节不到下载接口；输出格式受两个全局设置控制（得临时改苏哥的设置再还原）；大文件过 runtime 消息有上限；手动兜底页内联脚本被 MV3 CSP 拦；测试里猫抓默认勾卡片导致「全选」反全取消白跑两轮。这是苏哥第三次提醒我「先调研再动手」——这些坑不是 8 个独立 bug，是「一条错路线上的 8 个必然」。
- **决策**：彻底删除「驱动猫抓 m3u8 页」代码路径，改为**离屏文档(offscreen)内直连完成全管线**：解析 m3u8 清单 → `fetch` 直接拉分片（扩展有全站 host_permissions）→ AES-128 解密（WebCrypto）→ 拼接 → mux.js 转 MP4 → 持有 blob 等保存。SW 只做编排（确保离屏文档在位 + 转发开始指令 + 保存时走 `vrDownloadWithName` 落盘，因为离屏上下文没有 `chrome.downloads`）。自动归组与手动贴 URL 两处入口共用同一条管线。
- **理由**：① 调研两个成熟开源 MV3 扩展——Fluxon（offscreen 内一口气做完拉分片/解密/合并，大块数据走 IndexedDB 中转）、Media Bridge（SW 只调度、分片存 IndexedDB、offscreen 合并）——**没有一家去驱动别人的扩展页面**，全都是自己解析+自己下载+自己合并在一个稳定上下文里完成；② 顺带对照 FluxDown（zerx-lab）：它用本地 Rust 守护进程 + Native Messaging，浏览器只嗅探转发——这套太重（要在苏哥机器装独立程序），不符合「个人自用、不过度设计」，但**核心第一性原理和咱们一致：插件只嗅探，重活在稳定上下文**；③ 咱们 offscreen 文档就是那个「稳定上下文」，等价于它们的 native engine / background worker。
- **代价与边界**：
  - 解密/转码沿用仓库自带的 mux.js（TS→MP4 转码），AES-128 用浏览器原生 WebCrypto，不引 30MB 的 ffmpeg.wasm
  - 合并产物复用 ADR-027 的 `vrDownloadWithName` 文件名保护 + uniquify，不另写落盘逻辑
  - 删掉约 150 行「驱动猫抓」相关代码；复用早期脚手架（offscreen 文档、归组识别、徽标 UI、文件名保护），只换中间层
- **已知待办（如实记录）**：① **AES-128 解密代码已写，但只在「裸 TS」测试站验过，真实加密 HLS 尚未在真机验过**——真实站点（B站等）多为 AES-128 加密，这条漏了真机上会拼出乱码，待补一个加密流测试；② 仅支持 HLS(m3u8)，DASH(mpd) 不在 M11 范围（YouTube 部分走 DASH，是另一个话题）；③ 并发固定 4 路，未做 FluxDown 式「慢段救援」动态拆段（苏哥自用小视频够用，不过度设计）

---

*新增决策在此追加，编号顺延。*
## ADR-029 B站完整视频下载：在「页面主世界」直面 CDN，并优先要整段 MP4(durl)

- **日期**：2026-10-18 ｜ **状态**：✅
- **背景**：B站实站验收（TESTING §9）发现：嗅探正常抓到 `.m4s` 分片、自定义文件名也生效，但**实际下载被 `SERVER_FORBIDDEN` 拒**。苏哥提示「有个已经在用的插件好似可以」→ 逆向了星愿里已装的 **`b站视频下载助手`(pamdgobbggbpfpnadidipelihgkafiid v1.0.16)**，扒出其三条关键做法，并在真机验证有效。
- **决策**：钓鱼竿的 B站完整视频下载采用同一条路线，但用 MV3 原生方式实现：
  1. **回到页面主世界取数/下载**：用 `chrome.scripting.executeScript({world:'MAIN'})`（复用项目已有的 `fetchBiliParts` 同款写法）读 `__INITIAL_STATE__` 拿 cid/bvid，并在主世界里发请求。
  2. **向 playurl 要「整段 MP4」**：`https://api.bilibili.com/x/player/playurl?cid=<cid>&qn=80&bvid=<bvid>&otype=json`（**不带 `fnval`**）→ 返回 `durl[0]` 单条完整 MP4 直链，而非 DASH 音视频分离流。
  3. **主世界 XHR → Blob → `<a download>` 存盘**：`responseType='blob'`，完成后建 `<a download="文件名.mp4">` 触发保存。
- **为什么这就通了（根因）**：**不是下不了，是「在哪儿下」**。扩展后台/offscreen 发起的请求不带 B站页面的 Referer 与登录态 → CDN 拒；而页面主世界自己的 XHR 天然带这些 → 放行。存盘走 Blob+锚点，绕开 `chrome.downloads.download` 无法自定义请求头的限制。
- **为什么不走 prior plan（解析 DASH + 音视频合成）**：playurl 不带 fnval 时给的就是整段 MP4，**天生不需要合并**。省掉 DASH 清单解析与 mux 的复杂度，符合「个人自用、不过度设计」。
- **为什么不需要加 `cookies` 权限**：主世界 `fetch(..., {credentials:'include'})` 自带 B站页面 cookie（实测 `code:0` 拿到 durl）。加 cookies 权限反而会触发星愿权限升级、要重装扩展——得不偿失。
- **落地位置**：全部在 `js/popup-videorod.js`（`fetchBiliWhole` / `buildBiliWholeBanner` / `startBiliWhole` / `pollBiliWhole`）+ `css/videorod.css` 样式；**未改动 `background.js` 与 `content-script.js`**，风险最低。命名走既有 `VideoRodNaming.buildNameFromInfo`（跟随用户模板），历史/去重走既有 `markDownloaded()`（`vrDownloaded` 存储）。
- **取舍与边界（如实记录）**：
  - **不支持子目录**：`<a download>` 的 download 属性只认文件名、路径分隔符会被忽略 → B站整段下载不进 `video-rod/平台/` 子目录，直接落在 Downloads 根目录。这是 Blob+锚点方案的固有代价（要子目录就得走 downloads API，而那条路正是被 Referer 卡死的）。
  - **只覆盖「给 durl」的视频**：有些视频/更高清晰度 B站只给 DASH → 探测阶段拿不到 durl 就**不显示入口**（避免点了才失败）。这类视频仍需后续支持 DASH 合并。
  - **清晰度（2026-10-18 苏哥纠正后修正）**：**不写死**，改为直接要最高档(`qn=127&platform=html5&high_quality=1`)，B站 按登录态/会员等级返回它能给的最高档，面板显示**实际拿到的清晰度**（如「720P 准高清」）。
  - **面板关了也能下完**：下载在标签页里跑，不在 popup；轮询只在 popup 存活时更新进度。
- **验证**：BV1DVaZ6hEK6 端到端通过——弹出「完整视频 13.9MB · mp4720」入口 → 点击 → 进度 3%→100% → 落盘 `一瓶Vc_四位比例优越数值怪｜【恋爱的条件】—BESTie｜路演翻跳原相机不拉腿.mp4`；ffprobe 验 h264 1280×720 + aac、duration 190.52s、14,538,650 B（含音轨，无需合并）。

### ADR-029 补记（2026-10-19）：1080P 走 DASH + 页面内合成

- **苏哥的质疑**：「别人是可以在登录态下下载到最高清的，不是固定 720P」→ 成立，我上一版文档把话说死了。
- **重新实测（扫 fnval × qn）**：`fnval=0/1/2` → 只给 `durl`（整段 MP4），清晰度 `quality=64`；`fnval=16/80/4048` → 给 `dash`（画面/声音分离），`quality=80`、**1920×1080**，`accept_quality` 含 `116,80,64,32,16`。
  即：**「整段 MP4 直链」这条路的档位由 B站 按视频+账号给，实测有的视频只到 720P，此时 DASH 仍能给 1080P**（也有的视频 durl 本身就给 1080P，那就没必要合成）。所以**不能一概而论「封顶 720P」**，正确做法是**两条路都探，谁高给谁入口**。
- **决策**：保留 durl「快」路线，新增 DASH「高清」路线，二者在横幅上并列成两个按钮（仅当 DASH 档位严格高于 durl 时才显示高清按钮，否则只留一个）。
- **合成怎么做（关键，踩了两个坑）**：
  1. **不能用 `appendBuffer(视频); appendBuffer(音频); getBuffer()`**：实测 mp4box 只保留第一个 moov（音频轨道根本没进来，`trakCount=1`），且 **mdat 载荷会被丢弃（`mdatDataTotal=0`）** → 导出的文件只有 73KB 空壳。
  2. **正确做法**：分别 `createFile()` 解析两个 m4s → 用 `trak.samples[i].offset/size` 从**原始 ArrayBuffer 切片**取样本数据（不能用 `getSample()`，它依赖 flush 后会清掉的 stream 缓冲）→ 新建输出文件 `addTrack()`（视频带 `avcC`、音频带 `esds`，靠 `description_boxes` 挂进去）→ 按时间交错 `addSample()` → `getBuffer()`。
  3. `addSample()` 的 `dts/cts/is_sync` 要照抄源样本；`addTrack()` 要带 `default_sample_duration`，否则末尾帧时长为 0。
  4. `getBuffer()` 才是导出方法，`write()` 需要传 DataStream 参数（直接 `write()` 会报 `getPosition` undefined）。
- **性能**：实测 190s 视频（5710 画面帧 + 8205 声音帧）合成耗时约 **1.4 秒**（首次未预热时曾测到 28 秒，属浏览器当时负载，复测稳定在 1~2 秒量级）。写入按 2000 帧一让出，避免长任务把页面卡死。
- **已知小瑕疵（如实记录，不影响播放）**：产出是 fMP4（每帧一个 moof），比源文件大 ~5%（27.5MB→28.9MB）；ffprobe 统计帧数比源**各少 1 帧**（5709/8204 vs 5710/8205），并有一条 `non monotonically increasing dts` 警告。全片 `ffmpeg -xerror` 解码无错误。
- **新增第三方库**：`lib/mp4box.all.min.js`（mp4box.js 0.5.2，MIT），已在 `lib/third-party-libraries.md` 登记。仅在走高清路线时用 `executeScript({world:'MAIN', files:[...]})` 注入，**标清路线不加载**。
- **DASH 不显示文件大小**：DASH 只给码率不给体积，按码率估会差一倍（实测预估 69MB、实际 32MB），与其给错数字不如不给。
- **验证（真机，两条路各一次）**：
  - 标清：横幅「13.9MB · 720P ｜ 1080P（需合成，体积比标清大）」→ 点「下载 720P · 快」→ 进度 19%→100% → 落盘 14,538,650 B，ffprobe `h264 1280×720 + aac 44100Hz/2ch`，190.52s。
  - 高清：点「下载 1080P · 高清」→ 落盘 73,698,485 B，ffprobe `h264 1080×1920 + aac 44100Hz/2ch`，156.83s（另一支竖屏视频；另一次 32,609,576 B / 1080×1918 / 176.22s）。

---

## ADR-030 页内悬浮下载按钮：固定浮层 + 矩形命中 + 右上角

- **日期**：2026-10-19 ｜ **状态**：✅
- **背景**：苏哥要「鼠标放到视频上，出现下载图标，点一下自动下，也可以出几个清晰度给我选」。第一版做完后反馈「按钮被图标遮住」；2026-10-19 又明确要求放到**右上角**。
- **决策**：
  1. **全局只留一个浮层**，`position:fixed` 挂在 `documentElement` 下，鼠标进哪个 `video` 就飘到哪个。不插进播放器父容器——各站父容器可能有 `overflow:hidden` / `transform` / 自己的 z-index，插进去必被坑。
  2. **命中判定不用 `video.mouseenter`**：微博/抖音/B站都会在 `video` 上盖一层自己的覆盖层（封面、播放键、作者条），鼠标实际落在覆盖层上，`video` 收不到事件。改成 `document` 上听 `mousemove`（60ms 节流）+ 按 `video` 矩形命中；滚动出视口、鼠标出窗、窗口失焦时收起。
  3. **定位右上角**：按钮右缘距视频右缘 14px；`top` 按视频高度让开 12%（16~76px），避开播放器顶部控件；`z-index: 2147483000`；全屏时隐藏。清晰度菜单右对齐，避免顶出屏幕。
  4. **按钮只负责画 UI**：取流/命名/下载全部走 background 的 `vrVideoOptions` / `vrVideoDownload`，与 `x-button.js` 同一套路。
- **验证**：B站、普通测试页、抖音均已实测；抖音 1920×887 视频上按钮 `right=1906`（距视频右缘 14px）、`top=76`，截图 `deliverables/assets/overlay-douyin.png`。
- **边界**：X/Twitter 已有专属 `x-button.js`，不在其地盘重复加；只处理 ≥200×120 的 `video`；全屏不显示；B站/抖音的实际下载仍在页面主世界跑（见 ADR-029/031）。

## ADR-031 抖音取流/命名 + 媒体 CDN 的 Referer 回放（参考 CocoCut / yt-dlp）

- **日期**：2026-10-19 ｜ **状态**：✅
- **背景**：苏哥报抖音「能下载，但下错视频 + 起名错，拿不到作者 ID 和标题」。实探确认三件事：
  1. 抖音详情页同时有当前播放的 `<video>` 和推荐位/预览位的 `<video>`，通用分支「按体积选最大」会选歪；页面实际播放的还是低码率自适应档。
  2. `js/naming.js` 没有 douyin 规则，掉进 `article` 兜底，作者/抖音号全空。
  3. 抖音 CDN 直链**不带 Referer 返回 403**；CocoCut 3.89 能下，逆向发现它在 webRequest 里保存 `requestHeaders.referer`，并用 `declarativeNetRequest.updateSessionRules` 给媒体请求 set Referer。
- **决策**：
  1. **命名**：`naming.js` 新增 `extractDouyin`，只依赖 `data-e2e` 稳定锚点（`user-info` / `detail-video-info`），取昵称、作者数字 UID、描述；标题兜底 `document.title` 去「 - 抖音」。
  2. **取流**：新增 `js/douyin.js`。页面主世界同源 fetch `aweme/v1/web/aweme/detail/?aweme_id=...`（yt-dlp DouyinIE 同款路线，Unlicense；页面自己请求过，无需签名）。从 URL 的 `/video/<id>` 或 `?modal_id=<id>` 定位作品，一次拿 `nickname` / `unique_id`(抖音号) / `uid` / `desc` / `duration` / 无水印 `play_addr` / 全档 `bit_rate`；按短边分辨率降序、同分辨率码率降序，一键取最高档。不依赖嗅探缓存，也不会选到推荐位。
  3. **下载**：DNR session rule 对 `douyinvod.com` set `Referer` + `Origin`（`resourceTypes: other/media/xmlhttprequest/image`），10 分钟后用 alarm 清理。**通用直链**也按目标 URL 的 host 回放页面 Referer（抄 CocoCut 的通用做法），解决其他站点的防盗链 403。
  4. **通用选流**：通用分支改成「当前正在播/可见的 `video`」优先，体积最大只作兜底；选项标注「当前播放」。
- **验证**：
  - `东方街拍(@22994771145)_感知幸福用心寻找！ #瑜伽裤穿搭 #散步随拍 #街拍美女.mp4`：hevc **2160×3840** + aac，16.35s，7,260,920 B。
  - `老马探秘社(@72091560982)_五角大楼...mp4`：99,973,037 B，`state=complete`，mime `video/mp4`。
  - curl 对照：无 Referer → `403 text/html`；带 `Referer: https://www.douyin.com/` → `206 video/mp4`。
  - 命名单测 32/32（新增 5 条抖音断言）。
- **代价与边界（如实记录）**：
  - 详情接口依赖页面登录态与同源环境；接口风控/改版失败时自动回退通用嗅探分支（仍能下，但可能不是最高清）。
  - 抖音号 `unique_id` 只在接口里有；DOM 兜底用 `author_id` 数字 UID。
  - DNR 规则用固定 id（91001），连续下载不同站点会互相覆盖；10 分钟自动清理，影响面可控。
  - 抖音当前给的是 mp4 直链（含音轨），未走 ADR-028 的 HLS 管线；遇到加密 HLS 站点仍需另行验证。
- **参考**：CocoCut 3.89（`pagehelper.js` 回传 `requestHeaders.referer`；`popup.js` 的 DNR `updateSessionRules`；`background.js` 的 `allRequestHeaders`）；yt-dlp `DouyinIE`（同源 detail 接口，Unlicense）。

### ADR-031 补记（2026-10-19）：微博走页面内 fetch + blob

- **背景**：苏哥反馈微博视频下不下来。实测 `chrome.downloads.download` 请求微博 CDN `f.video.weibocdn.com` 返回 `SERVER_FORBIDDEN`（238 字节 HTML）；curl 对照：
  - curl 默认 UA、无 Referer → `206 video/mp4`；
  - **浏览器 UA、无 Referer → `403 text/html`**；
  - 浏览器 UA + `Referer: https://m.weibo.cn/...` → `206 video/mp4`。
  即微博是 Referer ACL，而 downloads 请求不带 Referer；DNR 规则（`other/media/xmlhttprequest/image`）没有落到 downloads 请求上。
- **决策**：
  1. 通用直链优先走**页面主世界 fetch → blob → `<a download>`**。页面请求天然带 Referer/Cookie，微博实测 CORS 允许（200，5,817,304 B）。这条路线与 B站 durl 完全一致（ADR-029），CocoCut 也是在页面/内容脚本里 fetch（`myContent.js` 的 `fetchByCsAB`）。
  2. 页面 fetch 失败（CORS / 非 2xx / 文件过小）时自动回退 `downloads.download` + DNR Referer；抖音仍走专属分支。
  3. 微博命名：`vrPageMetaInTab()` 在 MAIN world 读 `window.$render_data.status`，取 `user.screen_name`、`user.id`、`text`，经 `vrNameInTab` 的 override 生成 `作者(@UID)_正文.mp4`。
  4. 通用选项兜底：嗅探缓存为空时，把页面当前在播/有 `currentSrc` 的 URL 直接补进选项，不再依赖缓存。
- **验证**：
  - 微博 81.3s 视频：`page-blob`，5,817,304 B，`state=complete`；ffprobe `h264 540×960 + aac`。
  - 文件名：`安然cn(@2042052593)_【阿塞拜疆的这个女孩说...….mp4`。
- **代价与边界**：
  - `<a download>` 只认文件名，**不支持子目录** → 微博文件落 `Downloads/` 根目录（与 B站 durl 同限制）。
  - 页面 fetch 受 CORS 限制；不允许时回退 downloads+DNR（微博这类 ACL 站点回退会继续 403，但至少不阻塞其他站点）。
  - 微博 `$render_data` 结构可能随版本变化；PC/移动版字段不同时，命名退回 `naming.js` 兜底。

---

## ADR-032 暂不引入服务端代理：保持纯浏览器端取流

- **日期**：2026-10-19 ｜ **状态**：✅
- **背景**：苏哥观察到 CocoCut 可能把视频链接发到自家服务器，提议在 Cloudflare 跑一个按需代理。当前抖音/微博已分别用「同源详情接口 + DNR Referer」和「页面内 fetch→blob」在浏览器端下载成功。
- **决策**：**暂不引入服务端代理**。保留纯浏览器端路线；把 Cloudflare Worker 方案记录为可选兜底，不写代码、不加配置项。
- **理由**：
  1. 当前不需要：抖音 4K、微博 540×960 均已真机下载成功；页面 fetch 是 CocoCut 也在用的成熟路线。
  2. 隐私：视频 URL/内容会经过 Cloudflare；签名 URL 可能含账号信息。
  3. 合规/稳定性：Cloudflare 对视频代理的流量/条款有限制，免费计划不保证。
  4. 安全：开放代理需要 Token/签名 + 域名白名单，否则易被滥用。
  5. 维护成本与 ADR-008「纯扩展」原则冲突。
- **未来触发条件**：遇到「页面 fetch 被 CORS 拒绝 + downloads 被 Referer 403」的站点，且用户明确需要时，再做一个**默认关闭**的可选 Worker：
  - Worker 只允许白名单域名（如 `*.weibocdn.com`），带 Token/一次性签名；
  - 扩展设置里填 Worker URL/Token，仅在两条本地路线都失败时调用；
  - 流式转发，不落盘、不记录 URL。
- **影响**：不新增依赖/域名/密钥；当前架构保持「扩展内完成」。

---

## ADR-033 微博/X 主页批量下载：复用页面分页接口 + 批量队列（待实施）

- **日期**：2026-10-19 ｜ **状态**：🟡 P1 已实施（微博半手动），P2 待做
- **背景**：苏哥要「进入某人的主页，可以下载这个人的全部视频和图片」，参考 XBD。
- **XBD 5.9 逆向结论（只支持 X）**：
  1. `injected.js` 在页面主世界拦截 X 自己的 GraphQL（`UserTweets` / `UserMedia` / `UserPhotoTimeline` / `UserVideoTimeline`），拿到 `queryId`、请求头和 `cursor`；再按 `userId + cursor + count=500` 分页拉全量，`fetchAllProgress` 记录进度。
  2. 每条推文解析 `medias`：`media_type`（image/video）、`photoDownloadUrl` / `video`、`entityId`；`user_profile` 带 `name` / `screen_name` / `rest_id`。
  3. 下载走 `chrome.downloads.download` + URL 预记账 + `onDeterminingFilename`（与我们 ADR-027 同款）；`buildFilePath` 失败时 `buildFallbackFilePath`。
  4. 目录/文件名模板：`baseSaveDirectory`（默认 `/xbd-downloader`）、`directoryName`（支持 `{{UserName}}` / `{{@UserId}}`）、`fileName`（支持 `{{Text Summary}}` / `{{Published Time}}` / `{{DownloadDate}}`）；图片/视频可合并或分目录。
  5. UI：范围（当前列表 / 最近 N 条 / 全部）、类型（视频/图片/全部）、全选/忽略已下载/进度/停止。
- **我们的方案**：
  1. 新增 `js/bulk-profile.js`（内容脚本，按站点注入）：微博/X 用户主页、`/media` 页显示「批量下载」浮层；面板含范围/类型/全选/目录预览。
  2. **微博**：页面内复用微博自己的分页接口（`m.weibo.cn/api/container/getIndex?containerid=107603<uid>&page=N`，PC 侧 `/ajax/statuses/mymblog`），解析 `pic_infos`（图片大图）和 `page_info.media_info`（视频直链）；视频用页面 fetch→blob（已实现），图片直链走 `vrDownloadWithName`；接口失败回退 DOM 已加载卡片扫描。
  3. **X**：照 XBD 拦截 `UserTweets` / `UserMedia` 的 GraphQL（queryId/headers/cursor 动态拿）；图片 `pbs.twimg.com` 直链，视频用现有 `fetchXVideo`（fxtwitter）或 GraphQL `video_info.variants` 选最高码率；失败回退 `/media` 页 DOM 扫描。
  4. 队列/命名/目录：复用 `vrDownloadWithName` + `naming.js`；目录 `作者(@UID)/`，文件名模板 `${author}_${title}_${index}`；限速、重试、跳过已下载。
  5. **分两期**：P1 当前已加载媒体扫描 + 批量下载（低风险）；P2 全量分页（微博 API / X GraphQL）+ 自动滚动/停止。
- **工作量**：微博 P1 0.5–1 天、P2 1–2 天；X P1 0.5–1 天、P2 1–2 天；共用 UI/队列约 1 天。建议先微博（页面 fetch/命名已通），再做 X。
- **风险**：微博 API 风控/cookie、视频 URL 需页面上下文；X GraphQL queryId 会变、429/登录态；大批量限速与重名；自动滚动有副作用（ADR-010 只抓已加载，需要用户显式点「加载全部」）。

### ADR-033 实施补记（2026-10-19）：微博主页 P1 改为「半手动记录」

- **苏哥的修正**：站点有反爬，不允许自动下载全部；改为人工往下拉，扩展自动记录视频/图片地址，最后批量保存。
- **实现**：新增 `js/bulk-profile.js`（微博 content script）：
  - `MutationObserver` + `scroll` 节流扫描 `.wb-item`：记录正文图片（缩略图 `/orj360|orj480|mw690/` → `/large/`），过滤头像/表情/视频封面；不自动滚动/翻页。
  - 监听 `video` 的 `play`：记录真实 `currentSrc`，作者/文案取 `video-overlay.js` 点击卡片时写入的 `__vrFeedMeta`。
  - 右下角「批量下载 (N)」面板：列表/全选/反选/清空；不自动触发下载。
  - 保存：优先 `File System Access API`（`showDirectoryPicker`）一次选目录 → 按 `作者(@UID)/` 建子目录、逐条 `fetch` + `createWritable()` 写盘；不支持时回退后台 `vrBulkDownload`（页面 fetch→blob→`<a download>`）。
  - 串行 + 300~700ms 间隔，降低风控/失败率；不自动翻页。
- **验证**：微博主页滚动记录 4 张图；点开一个视频后记录到第 5 项（`🎬 @史老柒 视频 …`）；面板/全选/保存按钮正常；OPFS 等价目录写入 125,443 B JPEG 成功；微博 CDN 仍需页面上下文（downloads/DNR 403）。
- **边界**：原生目录选择器需要用户点一次（浏览器安全要求）；微博文件不进 `Downloads/video-rod/`，而是写入用户选的目录下的 `作者(@UID)/`；X/Instagram 尚未接入该面板。

### ADR-033 实施补记 2（2026-10-19）：X 主页 P1（照 XBD）

- **XBD 5.9 逆向补充**：`dlFilter` 默认 `["ignoreDownloaded"]`；`onlyHimself` 同时忽略 `is_rt`（转帖）和 `is_quote`（引用）；`only_image` / `only_video` 媒体类型过滤；范围 `current/recent/all`；每条媒体有 `is_download`，本地任务库记录 `tweet_id/media_id/media_type/media_url/tweet_text/is_retweet/local_download_status`；已下载缓存键 `sk_download_user_history_cache_key_<uid>`；保存目录/文件名模板在 Web App 配置。
- **实现**：`js/bulk-profile.js` 扩展到 `x.com` / `twitter.com` 用户主页（`/`、`/media`、`/photo`）：
  - 按 `article[data-testid="tweet"]` 提取作者/文案（`naming.extractTwitter(article,'x.com')`）；图片记录 `pbs.twimg.com/media/...?name=orig`；视频记录 `statusId/mediaId/poster`，保存时通过 `vrResolveX` 调 fxtwitter 解析完整 MP4。
  - **忽略转载**：`socialContext` 或 `ref.user != profileUser`；**忽略已下载**：`chrome.storage.local['vrBulkDone:x:<user>']` 记录 `x:video:<statusId>` / 图片 URL，保存成功才写入；面板可「清除已下载」。
  - 抄 XBD 的 `只图片/只视频` 筛选、反选、下载进度。
  - 保存仍走 File System Access（一次选目录 → `作者(@handle)/`）；不支持时走 `vrBulkDownload` 回退，X 用 downloads + `video-rod/` 子目录（X CDN 允许）。
- **X 单条按钮修复**：`mediaIdFromArticle` 支持 `pbs.twimg.com/media/<字母数字ID>`；无 mediaId 也可按推文用 fxtwitter 解析；有 `<video>` 就注入按钮（NASA `/media` 按钮从 4 个变 7 个）。
- **稳妥模式（反爬）**：保存与后台批量全部串行，1.4–2.6 秒随机间隔；429/5xx 按 `Retry-After`/指数退避重试（403 不重试）；连续 3 次失败自动暂停；X 视频等每个 `downloads` 任务落定后再下一条。不自动翻页/滚动。
- **验证**：`/NASA/media` 记录 7 条视频、7 个按钮；批量视频 `video-rod/NASA(@NASA)_TEST X BULK_01.mp4`（8,401,119 B）、图片 `video-rod/NASA(@NASA)_TEST X IMAGE_01.jpg`（232,912 B）；合成图片推文被记录为 `@NASA 图片 测试图片文案`；X 单条按钮下载 8,401,119 B。
- **边界（如实记录）**：自动化下 `x.com/NASA/photo` 会被重定向，图片分支用合成推文验证；主页懒加载导致「忽略已下载」数量需手动确认；引用推文暂未单独过滤（只过滤转帖）。

---

## ADR-034 YouTube/Instagram 下载可行性调研（2026-10-19）

- **日期**：2026-10-19 ｜ **状态**：📋 已调研：YouTube 不做，Instagram 待实施
- **YouTube：纯扩展不可行（不建议做）**
  - yt-dlp 官方 PO Token Guide（2026-07 更新）：`web` 客户端**只提供 SABR 格式**，GVS/Subs 需要 PO Token；PO Token 绑定视频 ID，每个视频都要重新生成；官方已不建议手动提取，推荐 PO Token Provider 插件。
  - 2026 年 YouTube 反爬是「协议层 + 令牌层 + TLS 层」叠加，yt-dlp 也频繁 403，需要 PO token provider、JS runtime、住宅 IP；纯 MV3 扩展无法完成 attestation/PO token。
  - CocoCut 3.89 代码里 `DISABLE_DOWNLOADING_FROM_YOUTUBE_REGEXP=/^https?:\/\/www\.youtube\.com\//`，popup/background 主动拒绝 YouTube（提示“不支持此网页”）。
  - **结论**：不做纯扩展 YouTube 下载。若将来必须支持，只能走外部 yt-dlp/cobalt 服务（违背 ADR-008/032 的纯浏览器端原则，且仍可能 403）；面板继续保留“YouTube 仅嗅探/提示限制”。
- **Instagram：可行，参考成熟 MV3 实现**
  - 开源项目 `mcanti/Instagram-Downloader`（MV3）已支持 posts、carousel、reels、TV、stories、highlights，覆盖 home feed / profile grids / Explore / post modal；manifest 用两组 content scripts，其中一组 `world:"MAIN"`（home-scroll/stories/post-modal/reels handlers + overlay injector），说明它读页面 React props/GraphQL 并注入下载按钮。
  - 方案：内容脚本扫描 `article` / `img[src*="cdninstagram"]` / `video` / `a[href*="/p/"]`、`/reel/`；MAIN world 读 React props 或拦截 GraphQL（`PolarisProfilePostsQuery`、`/api/v1/media/<id>/info/`）拿 `image_versions2.candidates` / `video_versions`；CDN 下载用页面 fetch→blob（同微博，已验证）或 downloads+DNR；按作者/短代码建目录，批量队列复用 ADR-033 的 `bulk-profile.js` 框架。
  - 分期：P1 单帖/已加载媒体扫描 + 批量下载（1–2 天）；P2 主页/Explore 全量 GraphQL 分页（2–3 天）；Stories/Highlights 需登录态，最后做。
  - 风险：登录墙/限流、GraphQL query hash 会变、CDN 签名/Referer、Stories 需登录、批量下载要限速。
- **影响**：YouTube 不投入；Instagram 作为 ADR-033 批量框架的第二个站点，优先级低于微博/X 主页批量。

---

## ADR-035 媒体库：固定目录 + HTML 管理页（含增删改查）（P1/P2 已实施）

- **日期**：2026-10-19 ｜ **状态**：🟡 P1/P2 已实施（扫描/索引/搜索/预览/基础 CRUD；P3 移动/标签、P4 未做）
- **背景**：苏哥要下载文件固定在一个目录，按「平台 → 博主 → 图片/视频」分层；用 HTML 页面直接查看、搜索、播放，并能对文件做增删改查。
- **结论**：可行，且是下载器自然演进成「个人媒体库」；推荐**扩展托管的 library.html + File System Access API + IndexedDB + index.json**，先不做本地服务器。
- **当前产出**：`docs/MEDIA-LIBRARY-PLAN.md`（完整方案）+ `deliverables/prototypes/media-library-v1.html`（可交互高保真原型，已实开验证：筛选/搜索/网格/详情/上一张下一张/最大化/图片缩放/视频播放/CRUD 界面）。
- **目录规范**：
  ```
  video-rod/
    weibo/<作者(@UID)>/images|videos/
    x/<作者(@handle)>/images|videos/
    douyin/<作者(@UID)>/videos/
    instagram/<作者(@handle)>/images|videos/
    _index/index.json
    _thumbs/<hash>.jpg
    _trash/...
  ```
- **技术方案**：
  1. **管理页**：`library.html` 由扩展托管（`chrome-extension://`），不依赖外部服务；首次点「选择媒体根目录」→ `showDirectoryPicker({mode:'readwrite'})`，把 `FileSystemDirectoryHandle` 存进 IndexedDB（扩展 origin）。下次打开检查 `queryPermission`，失效时在用户手势里 `requestPermission`。
  2. **索引**：根目录 `_index/index.json` 为可移植主索引；IndexedDB 做内存/查询缓存。字段：`id, platform, author, authorId, type, title, ext, bytes, duration, width, height, savedAt, pageUrl, sourceUrl, filePath, thumb, tags`。写入用「临时文件 + 覆盖」避免半截 JSON。
  3. **CRUD**：`getDirectoryHandle/getFileHandle/createWritable/removeEntry`；重命名优先 `FileSystemHandle.move()`，不支持则「复制 + 删除」；删除先移到 `_trash/` 并二次确认；改标题/标签只改索引（可选写 sidecar `.json`）。
  4. **播放/预览**：`getFile()` → `URL.createObjectURL` → `<img>/<video>`；大文件 P2 用 Service Worker 做 Range 流式（避免整段 blob 进内存）。HEVC 能否播放取决于系统解码器（B站 1080P 产物是 h264，无此问题）。
  5. **缩略图**：图片用 `createImageBitmap`/canvas；视频用已有 poster 或首帧；存 `_thumbs/`，懒加载。
  6. **搜索**：先纯前端内存索引 + 过滤（平台/作者/类型/关键词/日期）；数据量大再考虑 SQLite WASM 或 MiniSearch（新依赖先给苏哥过目）。
  7. **下载落盘统一**：X/抖音/B站走 `chrome.downloads` + `platform/author/type/` 子目录；微博必须页面 fetch，建议由**扩展页/离屏上下文**写入同一根目录（因为 File System Access 的 handle 与 origin 绑定，内容脚本在 `m.weibo.cn` 选中的目录不能直接给扩展页复用），或先落根目录由 library 整理。
- **分期**：
  - P1：目录规范 + `index.json` 元数据（下载时写）。
  - P2：library 只读：扫描/搜索/筛选/网格/预览/播放。
  - P3：CRUD：重命名/移动/删除（trash）/改标题标签；重建索引；重复检测。
  - P4：大文件 Range 流式、缩略图缓存、收藏/标签。
- **风险/边界**：File System Access handle 的 origin 绑定；`file://` 读取限制；大目录扫描性能；删除误操作；索引并发写；HEVC 解码；浏览器重装/换机后需重新授权目录。
- **参考**：XBD 的 Web App + 本地任务库/媒体归档；Eagle、PhotoPrism、Immich、Stash 的资产库交互；gallery-dl 的 archive 记录。

### ADR-035 实施补记（2026-10-19，P1/P2）

- **页面**：`library.html` + `css/library.css` + `js/library.js`；popup 顶部新增「媒体库」入口。
- **目录**：`showDirectoryPicker({mode:'readwrite', id:'vrLibrary'})`，句柄存 IndexedDB；下次打开 `queryPermission`，失效提示重新授权。
- **扫描**：递归扫描根目录，按 `platform/author(@id)/images|videos/` 解析；跳过 `_index`/`_thumbs`/`_trash`；写 `_index/index.json`（失败不阻塞浏览）。
- **UI**：资源树、树内搜索/懒展开、类型标签、搜索/排序、网格/列表、图片/视频预览、胶片、↑↓/←→ 键盘映射、信息栏。
- **CRUD**：重命名（`FileSystemFileHandle.move`）、删除到 `_trash/`；不支持 move 时明确提示。移动/标签留到 P3 后续。
- **验证**：`node --check js/library.js` 通过；`library.html` 在 1440×900 实开截图，空状态与布局正常。**真实目录选择/扫描需苏哥手动授权一次**（原生 picker 无法自动化）。
- **后续**：P3 移动/标签/批量，P4 Range 流式/缩略图/内容哈希去重。

---

## ADR-036 小红书不并入主页自动批量：只建议做详情页单篇（待拍板）

- **日期**：2026-10-19 ｜ **状态**：🟡 A 方案已实施（详情页单篇）
- **实探结论（真机）**：
  - 主页/探索网格只给 `noteId + xsec_token + 封面`（`sns-webpic...!nc_n_webp_mw_1`），**没有完整图片/视频**。
  - 笔记详情 `__INITIAL_STATE__.note.noteDetailMap[id].note.imageList` 只有 `urlPre` / `urlDefault`（webp，1200×1600 量级），原始 `url` 为空；视频需要详情 state/签名接口。
  - 页面内 `fetch` XHS CDN 被 CORS 拒绝；`downloads` 能下默认 webp（实测 64,510 B），但批量/原图/视频仍受风控。
  - 反爬是组合拳：`x-s` / `x-t` 动态签名、`xsec_token`（逐笔记）、设备指纹、行为序列、频率限制；常见 `461 Rate Limit`、`471 风控/验证码`。**写操作（点赞/关注/评论）风险更高，没必要碰。**
- **方案**：
  - **A（推荐）详情页单篇**：用户手动打开笔记 → 扩展读 `__INITIAL_STATE__` 记录当前笔记图片/视频 → 下载；3–5 秒随机间隔、单次上限 10–20 条、遇 461/471/验证码立即停止；不自动翻页/不自动打开详情、不做任何写操作。
  - **B 主页自动批量**：自动打开/请求详情，需要签名/xsec_token，风控/封号风险高；**不推荐**。
  - **C 外部工具**：XHS-Downloader（GPL-3.0）等成熟工具做全量；不自研签名，风险自担。
- **影响**：不把小红书加进 `bulk-profile.js` 的自动主页批量；如做只加「详情页单篇」适配器，并复用稳妥限速/失败暂停。

### ADR-036 实施补记（2026-10-19）：A 方案已落地

- **实现**：`js/bulk-profile.js` 增加小红书详情页适配；`vrXhsScan` 在 MAIN world 只读 `__INITIAL_STATE__.note.noteDetailMap[noteId].note`。
  - 图片：优先 `imageList.infoList` 的 `WB_DFT`，退回 `urlDefault`/`urlPre`（webp）。
  - 视频：`video.media.stream.h264/h265/av1[].masterUrl`（当前测试笔记为图文，视频分支待真机补验）。
  - 下载：走 `chrome.downloads` + `video-rod/小红书/<作者(@小红书号)>/`；页面 fetch 因 CORS 不走。
  - 限速：串行 3–5 秒随机间隔；单次最多 20 条；连续 3 次失败暂停；不自动翻页/不自动打开详情/不做写操作。
- **验证**：笔记 `6accad21000000001c02fd82` → 面板 1 张图（作者「小高今天找到工作了么」、文案「#留学生找工作[话题]# #秋招[话题]#」）→ 落盘 `video-rod/小红书/小高今天找到工作了么(@5904068850c4b46b86967480)_#留学生找工作[话题]# #秋招[话题]#_01.webp`，64,510 B，`image/webp`，complete。
- **边界**：当前拿到的是 `urlDefault` 级别 webp（约 1200×1600），原始 `url` 为空；要原图/视频需详情接口签名，未做。页面自身的 hydration 报错与扩展无关。

---

## ADR-037 下载去重：稳定媒体标识优先，内容哈希兜底

- **日期**：2026-10-19 ｜ **状态**：🟡 批量下载已实施；媒体库入库哈希待实施
- **背景**：同一博主/作品反复批量下载会重复占空间，也增加风控风险。平台 CDN 的签名参数每次变化，不能直接拿完整 URL 当去重键。
- **决策**：
  1. **下载前稳定标识**：`site | workId | mediaId | kind | origin+pathname`。`workId` 依次取 `statusId`/`noteId`/`awemeId`/`mediaId`/`key`；URL **去掉 query/hash**，签名变化不影响判定。
  2. **持久账本**：`chrome.storage.local.vrMediaSeen`（最多 8000 条）。批量开始先加载，命中的媒体**不发起下载**；同一批内再用 `Set` 去重。只有下载成功才写入账本。
  3. **状态反馈**：`vrBulkDownload` 返回 `skipped`，进度显示「已跳过重复 N」；全部是重复时也视为完成。
  4. **内容级兜底**：媒体库入库/扫描时对文件做 SHA-256，写入 `_index`；哈希相同则移入 `_trash/` 或丢弃。File System Access 写盘先用「同名 + 同大小」快速跳过。
  5. **画质策略**：当前同作品同媒体一律跳过；后续账本增加 `bytes/bitrate`，新素材明显更高清时允许替换旧文件。
- **验证**：`node --check js/background.js` / `js/bulk-profile.js` 通过；重复下载真机用例待补（见 TESTING §10.7）。
- **边界（如实记录）**：
  - 页内悬浮按钮的单次下载暂未接账本，先覆盖主页批量；接入时同样调用 `vrMediaIdentity`。
  - 同一内容被不同作品 ID 重新上传，预下载标识不同，只有入库 SHA-256 能识别。
  - 账本只保留最近 8000 条；超出后老记录淘汰，可能重新下载。

---

## ADR-038 小红书主页/收藏/点赞「下载全部」：可行性评估（B 已实施）

- **日期**：2026-10-19 ｜ **状态**：🟡 B 方案已实施（收集器已验证；自动补全首轮部分通过，待复验）
- **需求**：进入某人主页，手动翻页/滚动，收集该人的全部图片和视频；也支持自己的笔记、收藏、点赞。
- **事实（基于实测）**：
  1. 主页/收藏/点赞网格通常只稳定暴露 `noteId + xsec_token + 封面`；完整图集/视频在**详情页** `__INITIAL_STATE__.note.noteDetailMap[id].note`。
  2. 读取已渲染的 DOM/state 是本地行为；但“下载全部”必须逐篇打开详情或请求详情接口，**不是纯本地缓存**，是持续的网络读取。
  3. 小红书有 461/471/验证码等风控；只读、不点赞不收藏能降低“账号操作”风险，但**不能保证不被识别**，批量枚举和 CDN 下载仍有风险。
  4. 收藏/点赞可能包含已删除、私密、他人内容；失败率和权限问题会高于自己的笔记。
- **方案**：
  - **A. 半手动收集 + 逐篇详情（推荐）**：用户手动滚动主页/收藏/点赞，扩展只记录已渲染卡片（noteId/xsec_token/cover/类型）；“收集本页”入队；用户逐篇打开笔记，复用现有 `vrXhsScan` 读取详情并保存；串行 3–5 秒、单次最多 20 条、连续失败/461/471 立即停；不自动滚动、不自动打开、不点赞/收藏/评论。
  - **B. A + 可选自动补全详情**：用户显式开启后，扩展在同一标签页按队列逐篇请求详情（或自动打开下一篇），3–5 秒/篇、最多 20 篇，遇风控立即停；默认关闭，明确提示风险。**不建议默认开启**。
  - **C. 维持现状**：只支持手动打开的单篇详情。
- **安全边界**：
  - 只读页面状态比写操作安全，但不等于“完全安全”；不要高频、不要并发、不要自动翻页。
  - 仅个人备份，不公开传播；尊重原作者与平台条款。
  - 下载前用 `vrMediaSeen` 去重；自己的收藏/点赞里可能包含别人内容，按个人归档处理。
- **建议**：先做 A，验证 1–2 个主页/收藏页的真实成功率，再决定是否加 B。

### ADR-038 实施补记（2026-10-19，苏哥选 B）

- **收集器**：`js/xhs-batch.js` 在 `/user/profile/<uid>`（含收藏/点赞标签页）显示「小红书批量」面板；手动滚动后「收集当前页」，只读已渲染卡片（noteId/xsec_token/封面/类型），不自动翻页、不自动点赞/收藏。
- **自动补全**：面板内开关默认关闭；开启后 `js/background.js` 的 `vrXhsAutoQueue` 逐篇打开详情（inactive tab），用 `vrXhsScanInPage` 读 `__INITIAL_STATE__`，再复用 `vrBulkDownload` 下载；单次最多 20 篇、3–5 秒/篇、连续 3 篇无详情即停。
- **验证**：主页 `5904068850c4b46b86967480` 识别 30 条、入队 30 条；自动补全 1 条时落盘 `video-rod/小红书/嫣号正品(@63287358000000002303a729)_初秋内衣…_01.webp`（22,696 B），但函数返回 `errors=1`（文件已下载），需复验计数/详情读取。
- **边界**：automatic 模式会打开详情网络请求，仍有 461/471 风险；收藏/点赞可能含他人/私密/已删内容；仅个人备份。

---

*新增决策在此追加，编号顺延。*
