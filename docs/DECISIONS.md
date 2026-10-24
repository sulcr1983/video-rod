# 苏哥的钓鱼竿 — 决策记录（ADR）

> Architecture Decision Records。记录「为什么这么做」，防止以后回头看忘记当初的理由。
> 状态图例：✅ 已生效 ｜ 🟡 生效中（施工期） ｜ 📋 已计划未开工

---

## ADR-001 底座选型：fork 猫抓，不从零造轮子

- **日期**：2026-10-17 ｜ **状态**：✅
- **背景**：要做「CocoCut 式视频嗅探下载浏览器」，从零写 MV3 嗅探引擎工作量巨大且站点适配永远追不完。
- **决策**：fork 猫抓 cat-catch v2.7.2 作底座，嗅探内核/下载器/FFmpeg 合并全部沿用原样。
- **理由**：猫抓是成熟开源项目（GPLv3），站点适配脚本持续更新；fork 后仍可 cherry-pick 上游更新。私有自用不分发，保留 LICENSE 与上游署名即可。
- **影响**：全部改造被约束在「外壳层」，内核文件列为禁改区（见 ADR-015）。
- **修订（2026-10-24）**：项目确认为**私有仓库、本机自用、不分发**，原文"个人自用无分发义务"成立；实现边界见 ADR-028（只学交互、不抄代码）。

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
- **决策（校准后的真实增量）**：本项目的核心增量 = ① 智能起名（页面识别：文章标题/推文正文/作者前缀，猫抓模板没这些变量）② 按平台/作者自动分目录（猫抓只有按网页标题）③ 图片批量扫描（嗅探清单确实无 image/*，init.js:63-73 实锤）④ 右键秒存 + 快捷键 + 批量管理 UI。命名/目录的叙事从「从无到有」改为「从有到好」，不夸大。
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
- **背景**：星愿浏览器（苏哥日常主力）里，`downloads.download({filename})` 被忽略，文件落成服务器名/UUID。根因 = **Chromium bug 579563**：浏览器内任何扩展注册 `chrome.downloads.onDeterminingFilename` 监听后，其他扩展的 `filename` 参数即失效；官方 workaround 是自己也注册该监听、对自己的下载 suggest 文件名。苏哥星愿装了 13 个扩展，其中 XBD（`piibeklj`）、CocoCut（`ekhbcipn`）、Imageye（`agionbom`）三个下载类扩展全部注册了该监听——完全吻合症状（单扩展的测试 Chromium 无此问题）。
- **决策**：按苏哥指示逆向他浏览器里装的扩展，抄三家的成熟写法（三家独立实现，套路一致，可信度高）：
  - **URL 预记账**：下载前把 `url → {filename, conflictAction}` 写进 SW 内存 Map；`onDeterminingFilename` 触发时按 `item.url`/`item.finalUrl`（重定向后地址）双查 suggest。不用 downloadId 记账——id 下载前不存在
  - **三道防线**（抄 XBD）：① `byExtensionId` 是别的扩展 → 直接 return 不碰（做好公民，多家下载扩展共存）；② 命中预记账 → suggest 记账名；③ 是自己的下载却没记账（SW 重启丢账）→ item.filename 是绝对路径 suggest 用不了，弃权降级
  - **页面侧 hook**（`js/vr-download-hook.js`）：popup/options/m3u8/downloader 四个页面加载，monkey-patch `chrome.downloads.download`，**等 SW 记账 IPC 应答后才发起下载**——blob:/data: 下载不走网络，onDeterminingFilename 几乎立即触发，fire-and-forget 式记账赛不过（实测第一版就栽在这）
  - 记账**取用不删 + 10 分钟 TTL**：同 URL 重复/并发下载都能拿到名字（实测同 URL 双下载得 `x.ico` + `x (1).ico`，uniquify 自动去重）；重下会以新记账覆盖；SW 侧 `vrDownloadWithName()` 统一入口替代 3 处裸 `downloads.download`
  - conflictAction 统一 `"uniquify"`（不覆盖已有文件）；suggest 同步调用；防御性 try/catch 包监听注册（API 异常不拖垮 SW）
- **理由**：三家生产扩展的独立趋同实现 = 经过真实用户验证的方案；自研（如按 downloadId 记账、异步 suggest）必然重复踩坑。ADR-002「先对标再动手」的又一次执行。
- **仲裁规则（官方文档）**：多扩展都 suggest 时**最后安装的赢**；调 `suggest()` 无参 = 弃权不参与竞争。我们只对自己的下载 suggest，XBD/CocoCut/Imageye 对我们的下载全部弃权 → 我们赢。
- **影响**：M8 里程碑；`js/background.js`（记账+监听+3 处下载点改造）、`js/vr-download-hook.js`（新建）、4 个 HTML 挂载；星愿真机三链路验证通过（TESTING §7）：popup blob / SW 直连 / X 按钮落盘 `video-rod/唐十七呀(@m0ve0f).mp4`（29,359,763 B，ffprobe 验证 h264 2160×3840 + aac 双轨）

## ADR-028 复用策略：私有自用库，开源代码能抄就抄

- **日期**：2026-10-24 ｜ **状态**：✅（v1.4 定稿）
- **背景**：苏哥先要求"把开源产品的好用法抄过来"，随后明确：项目是**私有库、本机自用**，"能抄袭就抄袭啊！"。
- **决策**：
  1. **定位**：本项目是**私有仓库、本机自用、不分发**。上游 cat-catch 为 GPL-3.0，私有使用不触发分发义务；仓库保留上游 LICENSE 与署名即可。
  2. **复用优先**：成熟开源实现优先**直接复用代码**（MIT / Apache-2.0 / GPL 均可）。取用方式限定为"无需构建的成品文件"（UMD / 单文件 dist / 可直接运行的单文件 JS），放进 `lib/` 并在页面 `<script>` 引入，**保留原版权声明**。
  3. **例外**：只有两种情况才自己写——① 组件只有 ESM/依赖 bundler，接入成本高于自研；② 通用组件的交互与"平台→博主→类型 + 视频键盘"等本项目特有需求冲突。
  4. **登记**：新增第三方库同步写入 `lib/third-party-libraries.md`（来源 / 版本 / 许可）。
- **理由**：私有自用没有分发压力，不必为许可妥协质量；成熟组件的边界情况（手势、缩放惯性、缩略图过渡）是别人踩过的坑，重写等于重踩一遍。判断标准只有一条：**引入成本 < 自研成本就抄**。
- **影响**：`README.md`、`PLAN.md`、`LIBRARY-PLAN.md` §0.1/§2.3/§6.2/§8/§11.4/§12 按此口径定稿。

## ADR-029 产出物边界：仓库内四类落点 + `.work/` 临时工作区

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：做资源库方案与 P0 探针期间，`E:\test\` 根目录散落了 5 个临时目录（3 个 Chrome profile 共 125 MB、1 个测试媒体目录、1 个草稿脚本目录），交付物与临时件混在一起，既污染工作区也有误提交风险。
- **决策**：
  1. **四类落点**：交付物 → `deliverables/`；工程文档 → `docs/`；可复用工具 → `tools/`；本机临时件 → `.work/`。
  2. **`.work/` 定义**：仓库内的本机临时工作区，含 `profiles/`（Chrome profile）、`media/`（测试媒体）、`scripts/`（一次性草稿）；**已加入 `.gitignore`，可整体删除**。
  3. **硬规则**：项目产生的任何文件不得散落在仓库外（如 `E:\test\` 根目录）；新增文件前先确认落点。
  4. **清理方式**：先关测试用 Chrome，再删 `.work/`（命令见 `.work/README.md`）。
- **理由**：临时件和交付物混放会导致 ① 误提交大文件（profile 动辄几十 MB）；② 找不到最新版本；③ 换机/交接时无法区分"要留的"和"可扔的"。把边界写死比靠记忆可靠。
- **影响**：`deliverables/DELIVERABLES.md` 新增 §1.1「工作区边界」并升 v1.6；`.gitignore` 增 `/.work/`；`E:\test\` 已清理为仅 `video-rod`（本项目）与 `wechatca2`（无关项目）；两个草稿脚本转正为 `tools/cdp-library-test.py`、`tools/probe-file-access/run-probe.py`。

## ADR-030 索引三源与「缺失不删」语义

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：S2 要支持重建索引，来源有三种：下载历史（downloads）、磁盘快照（`_library/index-*.json`）、FSA 全量扫描。三者覆盖面不同——下载历史只认识"经本扩展下载"的文件，快照可能过期，全量扫描需要用户授权。若统一按"扫不到就删条目"，换根、换机、清下载历史都会把索引误清空，连带丢掉星标与标签。
- **决策**：
  1. **三源分工**：`downloads` 只做 upsert，不判定缺失；`snapshot` / `full` 覆盖全量，扫不到的旧条目标 `state:'missing'`，**永不自动删除**。
  2. **missing 是状态不是删除**：文件重新出现（重新扫描/校对命中）即回 `ok`；条目本身保留，用户数据（starred/tags/thumbKey/title）不随重建丢失。
  3. **快照不存 absPath**：只存 `relPath + size + mtime + 元数据`；换根后按"当前根 + relPath"重算，避免快照把旧根路径带回来。
  4. **无句柄不假装全量**：没有 FSA 授权时只允许 downloads 源；`full`/`snapshot` 直接报 `LIB_E_NO_PERM`。
  5. **reconcile 三级判定**：先 `downloads.search({id}).exists`（免授权）→ 再 FSA `getFile()` → 都没有记 `unknown`，不改状态。
- **理由**：§5 原则一"文件系统是唯一真相，索引可随时重建"。误删索引条目会丢用户数据，代价远高于多几条 `missing`；而"猜一个路径当作存在"会在换机/换根后产生幽灵条目，比诚实标灰更糟。
- **影响**：`js/library/indexer.js`、`options.html` 资源库维护区、`tools/cdp-indexer-test.py`；S3 缩略图与 S5 删除都依赖 `missing` 语义（标灰、可重新定位，不自动清理）。

## ADR-031 设置页信息架构：四组侧栏 + 分区卡片 + 兼容式重设计

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：设置页有 18 个平铺分区、151 个唯一 ID、40 处内联样式、8 个重复 ID；侧栏无分组、无当前态，资源库分区把配置/状态/维护/迁移混在一列；窗口 <980px 时侧栏固定定位会压住内容。
- **决策**：
  1. **信息架构固定为四组**：资源库 / 抓取规则 / 下载与工具 / 通用；分组顺序与 DOM 顺序一致，不跨组搬运分区，避免锚点与回填异常。
  2. **重设计以「不改功能」为硬约束**：151 个 ID、`save` 属性、`.resetOption` 作用域、动态表格 `<tr>` 结构、i18n 钩子全部保留；新样式只在 `body.options-page` 下生效，`options.css` 同时被 downloader/json/m3u8/mpd 使用，不能影响它们。
  3. **视觉基线**：`#f6f8fb` 页底 + 白卡片 + 1px 边框 + 12px 圆角；标题 18px/600；正文 13px；主操作每屏最多一个蓝钮；危险操作独立红卡。
  4. **响应式**：≥980px 侧栏常驻（236/208px）；<980px 变顶部横向导航；<640px 配置行标签与控件各占一行；规则表保留横向滚动（列语义优先于硬堆叠）。
  5. **字体用系统栈**，不用 Google Fonts：扩展离线运行，不引入外部网络依赖。
  6. **重复 ID 修掉**：`allDisable/allEnable` 改 `data-all="0|1"`，同步 JS 选择器；这是本次唯一改动的选择器契约。
- **理由**：设置页的问题主要是层级与排布，不是功能；重写逻辑风险远大于收益。作用域化 CSS + ID 全保留，可以随时回滚，也能与上游猫抓的 options.css 共存。
- **影响**：`options.html`、`css/options.css`（追加块）、`js/options.js`、`js/library/settings.js`；方案与实施记录见 `docs/OPTIONS-REDESIGN.md`，验收见 TESTING §14。

## ADR-032 资源库以「看内容」为第一优先级：全宽大卡 + 全屏查看器

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：资源库第一版按「管理表格」思路做成 220px 小卡 + 1560px 上限，信息密度高但缩略图小；而资源库的真实使用场景是**翻图片、看视频**，不是读元数据。
- **决策**：
  1. **布局**：去掉内容区最大宽度，侧栏固定 208px，剩余空间全部给媒体；卡片 `minmax(320px, 1fr)`、缩略图 4:3，1280px 三列、1920px 四到五列。
  2. **查看**：单击卡片直接进全屏查看器（深色遮罩），`←/→` 翻页、`Esc` 关闭；底部只留文件名/来源/大小与「在文件中打开」。
  3. **缩略图**：并发 2、IntersectionObserver 懒触发、视频抽 1s 帧、WebP 存 IDB；失败保留类型占位，不阻塞列表。
  4. **统一**：popup、设置页、资源库共用 `#1a73e8` 强调色与蓝灰中性色；popup 保留 400px/66px 行高，不被资源库的宽松布局带跑。
  5. **视频暂用原生 controls**：S4 再换自绘控件；当前优先保证「能看、能翻页」。
- **理由**：媒体库的竞争力是「看图爽不爽」；管理属性（标签、批量、回收站）是第二层。把空间让给内容，比在 220px 卡片里塞 5 行元数据更符合使用频率。
- **影响**：`library.html` / `css/library.css` / `js/library/ui.js` / `js/library/thumbs.js`；popup token；TESTING §15。

## ADR-033 删除走自建回收站：批次目录 + 清单，不依赖 chrome.downloads

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：Chrome 扩展没有通用文件删除能力；`chrome.downloads.removeFile()` 只能删本扩展经 Chrome 下载的文件，且不可恢复、对迁移进来的旧文件无效。
- **决策**：
  1. 软删除到 `<根>/_回收站/<YYYYMMDD-HHmmss-xxxx>/<原相对路径>`，保留目录结构；
  2. 每个批次写 `_manifest.json`（完整索引字段），恢复按清单走，IDB 清空也能恢复；
  3. 复制 → 校验大小 → 删源；恢复时原路径必须为空，不覆盖；
  4. 每次操作写 `_migration/ops-<时间戳>.json`，失败不阻断；
  5. 需要 `readwrite` 句柄，未授权明确报 `LIB_E_NO_PERM`。
- **理由**：可恢复、对旧文件同样有效、审计可查；批次时间戳避免同日重名。
- **影响**：`js/library/trash.js`、`trash-ui.js`、`library.html`、`css/library.css`、`ui.js`、`lightbox.js`；TESTING §18。

## ADR-034 批量选择只改 class 不动 DOM；重命名走「复制→校验→删源」

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：S5b 要加批量条与重命名。原型里的批量态是重新渲染一版带勾选框的卡片；但 S3/S4 的回归断言依赖网格 DOM 结构与表格 8 列，重渲染会连带改测试。
- **决策**：
  1. **选择态用 `body.batch-mode` + `.lib-card.sel` 驱动样式**，勾选元素常驻 DOM、默认 `display:none`，不重建节点；
  2. 选择集合以 `relPath` 为键；筛选/搜索变化清空选择（模式保留）；`Esc` 先交给弹窗/菜单/查看器；
  3. **重命名不做 `move()`**（FSA 没有），沿用回收站口径：复制 → 校验大小 → 删源；
  4. 扩展名保护：输入不含 `.` 且原名有扩展名时补回；显式写扩展名则以用户为准；
  5. 索引删旧 key → 写新 key，`thumbKey` 置空让缩略图重生成，`starred`/`tags` 等字段保留；
  6. **本轮不做批量重命名**，右键入口在批量模式下仅选中 1 项可用。
- **理由**：DOM 结构稳定 → 既有回归零改动；重命名与回收站共用同一套文件搬运与校验，减少两套易错逻辑。
- **影响**：`js/library/batch.js`、`rename.js`、`ui.js`、`trash-ui.js`、`library.html`、`css/library.css`；TESTING §19。

## ADR-035 图片下载的 Referer 只能走 DNR，不能塞进 downloads 的 headers

- **日期**：2026-10-24 ｜ **状态**：✅（踩坑后修正）
- **背景**：I1/I2 落盘时给 `chrome.downloads.download` 传 `headers: [{name:'Referer', value: pageUrl}]` 以过防盗链。实测**下载根本发不出去**：`chrome.runtime.lastError.message` 为 `Unsafe request header name`，`chrome.downloads` 里连一条记录都没有，`vrImg.download` 恒返回 `IMG_E_FETCH`。
- **决策**：
  1. `Referer` 属浏览器受控头，`downloads` API 只允许自定义头 → **改用 `declarativeNetRequest` 会话规则**补头（与 `function.js` 的 `setRequestHeaders` 同思路）；
  2. 规则 id 从 **9000** 起，避开 `function.js` 拿 tabId 当 id 的既有规则；
  3. `urlFilter` 用「去掉协议的完整图片 URL」做子串匹配，比 `||域名` 更精确；
  4. **一次性使用**：`downloads.download` 返回后（成功或失败）立刻撤销，避免规则堆积；
  5. DNR 不可用时降级为不补头，下载照常发起。
- **理由**：这是 API 硬约束，没有第二种写法；DNR 是扩展里唯一能改受控请求头的通道。
- **影响**：`js/background.js`（`vrImgRefererRule` / `vrImgClearRefererRule`）、`docs/IMAGE-I1I2-IMPL.md` §4.3.1；TESTING §20.4。

## ADR-036 批量下载用 SW 侧并发池 + 进度广播，不用 content 侧串行

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：I3 要一次下几十张图。若在 content script 里逐张发消息，每次都要等回执，
  50 张就是 50 个来回，慢且容易被页面生命周期打断。
- **决策**：
  1. 队列放 **Service Worker** 里跑，content 只发一次 `vrImg.batch`，带 `batchId`；
  2. 并发缺省 **3**（上限 8）：`chrome.downloads` 本身是单队列，并发再高反而排队更慢；
  3. 进度用 `chrome.runtime.sendMessage` 广播，**200ms 节流**（否则几十张会刷爆消息通道）；
  4. 取消用 `vrImg.batchCancel` 置标志位，只拦「还没开始的」任务，已发出的请求跑完；
  5. 失败不中断，逐条记 `{url, code}`，最终回执汇总（明细截断 50 条）。
- **理由**：一次消息替代 N 次往返；SW 有 `host_permissions` 可跨域校验；页面刷新也不影响已在跑的批次。
- **影响**：`js/background.js`（`vrImgBatch` / `vrImgBatchCancel`）、`js/image-batch.js`；TESTING §21。

## ADR-037 已下载去重与单批上限：宁可少下，不可失控

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：批量最容易出两类事故——同一张图反复下（重复文件堆满目录）、一次点下几百张（浏览器弹拦截 + 卡死）。
- **决策**：
  1. **去重表** `chrome.storage.local` 键 `vrImgDownloaded`（url → 时间戳），上限 **2000** 条，超出按时间淘汰最旧；
  2. 命中去重表则**跳过但算成功**（进度条照走，用户看到的是「已完成」而不是「失败」）；
  3. **单批上限** `vrLibSettings.imgBatchLimit` 缺省 **200**，确认条上直接写明「本次只下前 N 张」，
     不等到下到一半才发现被截断。
- **理由**：去重和上限都是「保护用户磁盘和浏览器」的硬约束，必须在**确认条**这个决策点就告知，
  而不是事后报错。
- **影响**：`js/background.js`（`vrImgSeenUrls` / `vrImgRememberUrl`）、`js/image-batch.js`（`collectItems`）；TESTING §21。

## ADR-038 参考 Tubly（YTB.crx）：只取代理层模式，不取代码；YouTube 翻案待验证

- **日期**：2026-10-24 ｜ **状态**：🟡 待验证（实验 #1 未跑）
- **背景**：拆解商业扩展 `YTB.crx`（Tubly，订阅制 YouTube 下载器，MV3）后确认：
  1. **crx 内不含任何 YouTube 解析代码**（`googlevideo`/`streamingData`/`poToken`/`decipher` 全文 0 命中）；
     引擎由 `tubly.download/app/` 服务端下发，扩展只提供特权 RPC（cookie / DNR / `executeScript` / `downloads` / FSA）；
  2. 其真正的技术手法是**把请求放回目标站点自己的页面里发**：隐藏 iframe 指向 `youtube.com`
     → `executeScript({world:"MAIN"})` → 在 iframe 的 origin 内同源 `fetch`，`visitorData`/`ytcfg` 直接可读；
  3. 反向能力同样成立：DNR `modifyHeaders` 删 `cookie`，同一 iframe 即变匿名会话。
- **决策**：
  1. **不搬代码**。闭源商业产品，且无代码可搬（引擎不在包里）；复用策略仍按 ADR-028，但本例退化为「只抄模式」。
  2. **收编其代理层设计**为自有模块：同源桥（iframe + MAIN world + 帧协议 + 背压）、DNR 规则池（按 `tabIds` 定向，替代固定 id）、
     `downloads.ui` 关气泡、`runtime.getContexts` 判 offscreen。
  3. **ADR-019 的 YouTube 结论暂不推翻**，但开一个实验口子：先验证「隐藏 iframe 内同源调 `youtubei/v1/player`
     能否拿到未降级 formats」。验证通过则 ADR-019 的 P1 降级翻案；不通过则维持原判，力气投 B站与通用嗅探。
- **理由**：poToken/SABR 封的是「扩展进程作为第三方身份去请求」，而站点自有页面内的请求身份天然合法。
  这条路径不依赖签名对抗，符合 ADR-019「搭便车而非对抗」的既定精神。
- **影响**：新增 `docs/REF-YTB-TUBLY.md`（拆包与融合评估全文）；待建 `js/same-origin-bridge.js`、`js/dnr-rules.js`；
  `tools/cdp-probe.py` 增加同源探针用例。若实验失败，本 ADR 第 3 条标注为「已验证不可行」留档。

## ADR-039 YouTube 高清下载：可行，路线改为「MWEB 直链 + SABR 复放」，ADR-019 作废

- **日期**：2026-10-24 ｜ **状态**：✅（实测已证，待实现）
- **背景**：ADR-019 判定「2026 起纯扩展基本无解」，YouTube 降为 P1、不投入对抗。本次对真实页面做了分层实测
  （`docs/YT-FEASIBILITY.md` 有全部证据与复现脚本），结论被推翻：
  1. **Web 客户端确实全封**：`adaptiveFormats` 40 条，带 `url` 的 **0 条**，只剩 `serverAbrStreamingUrl`；
     `<video>.src` 是 blob，媒体走单条 `sabr=1` POST。这是猫抓嗅探失效的根因——不是嗅不到，是不存在那条 URL。
  2. **换客户端直链就回来了**：同页同源打 `/youtubei/v1/player`，**MWEB 返回 41/41 全带 url，最高 2160p60**，
     且 URL 无 `pot` 参数（不需要 poToken）。其余 8 种客户端全灭。
  3. **403 的唯一原因是 `n` 未变换**：UA / 出口 IP / 过期 / poToken 逐项排除。
     用 `youtubei.js` 的 `Player.decipher` 纯 JS 变换（**47ms**）后 → **206 Partial Content + `ftypdash`**，
     itag 299（1080p60）**真实媒体字节到手**。
  4. **但直链不稳**：连续调用十几分钟后 MWEB 回落 `UNPLAYABLE`，且出现「只有 itag 18 带 url」的混合态
     —— SABR 灰度仍在推进，MWEB 直链是临时窗口。
  5. **稳的那条是 SABR 复放**：页面自己那条预签名链接可被外部复放，空 body 回 `200 + application/vnd.yt-ump`
     且仅报 `sabr.malformed_config`（= 鉴权已过）；带播放器请求体复放可拿到 EBML/WebM 媒体字节。
     不碰 API、不解 `n`、不需 poToken，稳定性等价于「播放器能不能播」。
- **决策**：
  1. **ADR-019 的 YouTube 部分作废**（B站部分不变）。YouTube 回到 P0。
  2. 主路径 **B：SABR 复放**（4–6 天，需端口 UMP 分片重组），快速通道 **A：MWEB + `n` 变换**（2–3 天，已验证）。
     两者共用「页面同源取 streamingData → sandbox 解 n / 重组 UMP → 流式落盘 → FFmpeg 合流 → 资源库入库」骨架。
  3. **MVP 走 A**：先让「能下 1080p/4K」发生；A 的骨架全部被 B 复用，不浪费。
  4. 需要 **sandbox 页**（`content_security_policy.sandbox` 允许 `'unsafe-eval'`）承载 `n` 变换——
     MV3 扩展页禁 `eval`，Tubly 的同一段 CSP 即为同一原因。
  5. **仍不装外部程序**（ADR-008 维持）：三条候选路线都不需要 yt-dlp。
- **理由**：被封的是「Web 客户端这个身份」，不是「浏览器这个运行环境」。入口换到 MWEB / SABR，
  请求仍然由用户的浏览器发出，身份天然合法——与 ADR-019「搭便车而非对抗」的原始精神一致，只是搭的车换了。
- **影响**：新增 `docs/YT-FEASIBILITY.md`；新增五个探针脚本 `tools/yt-probe.py` / `yt-clients.py` /
  `yt-dl-test.py` / `yt-feasibility.py` / `yt-sabr.py`；待建 `js/yt/`（page-bridge / nsig-sandbox / sabr-ump / downloader）。

### ADR-039 实施补充（同日）

- **已落地**：`js/yt/`（内容脚本注入 / 下载小窗 / n 沙箱 / fMP4 合并）、`lib/youtubei.min.js`、
  `background.js` 的 `ytCollectFormats`。详见 `docs/YT-IMPLEMENTATION.md`。
- **新增决策**：
  1. **取格式按 MWEB → ANDROID → IOS → TVHTML5 依次试**，取第一个有直链的。单一客户端太脆（灰度按客户端+地区+时间走）。
  2. **合并自己写，不调 ffmpeg**：googlevideo 的 `sparams` 含 `ip`，签名把 IP 绑死，
     在线 FFmpeg（ADR-021 那条）换个 IP 去拉必然 403；ffmpeg.wasm 30MB+ 不划算。
     分片 MP4 合并只需改 `track_ID` + 重建 `moov` + 按 `tfdt` 交织，约 200 行无依赖。
- **验证状态**：容器合并已用公开 DASH 真实双轨验证（Chrome 解出双轨、时长正确、无 MediaError）；
  注入按钮 / 开窗 / 消息链路已 CDP 真机验证。**活链路取格式尚未通过**——研究阶段对同一出口 IP
  打了约 40 次接口，触发风控（`UNPLAYABLE：The page needs to be reloaded.`，四客户端一致），
  待真实账号环境复验。若长期不通，退回路线 B（SABR 复放）。


## ADR-038 尺寸档位按「短边」判定，并在档位上直接显示命中数

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：主流扩展（Imageye/Fatkun）都让用户手填「最小宽×高」。实测这是最不直观的一项：
  用户不知道页面上有什么尺寸，只能瞎填再试，填 500 可能一张都筛不出来也不知道为什么。
- **决策**：
  1. 提供 **小≥100 / 中≥500 / 大≥1200 / 超大≥2000 / 自定义** 五个档位；
  2. **按短边判定**——竖图 600×2000 算「中」而不是「大」，符合「这图清不清楚」的直觉；
  3. 每个档位上**直接显示命中张数**（`中 8`），一眼看出该选哪档，不用试错；
  4. 命中为 0 的档位置灰禁用，避免点进空列表。
- **理由**：档位把「我不知道该填多少」变成「我看看哪个档有我想要的」，这是本项目相对现有扩展的改进点。
- **影响**：`js/lib-image-util.js`（`shortSide`/`tierCounts`/`filterByTier`）、`js/image-panel.js`；TESTING §22。

## ADR-039 面板下载复用 I3 队列，不另起一套

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：I3 的 `startDownload()` 自己扫描全页再跑队列，I4 需要「只下勾选的那几张」。
  若复制一份队列逻辑，并发/去重/取消/进度就会有两套实现，必然走偏。
- **决策**：把 I3 的队列抽成 `runQueue(items, opts)`，两条路径共用：
  - `VRImgBridge.download(items)` → 面板用（不弹确认条，进度仍走底部进度条）；
  - 「全部 N」按钮 → 仍走 `collectItems()` + `runQueue()`（行为不变）。
- **理由**：队列是有状态、易出错的部分（并发池、取消标志、进度节流），只允许存在一份实现。
- **影响**：`js/image-batch.js`（`runQueue`）、`js/image-panel.js`；回归 `cdp-image-batch-test.py` 35/35 未变。

## ADR-040 自定义阈值用面板内联输入，不用 prompt

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：`prompt()` / `alert()` 在内容脚本里可能被站点 CSP 拦截，且样式无法控制、会打断视觉。
- **决策**：点「自定义」在过滤区下方展开一行内联输入（`短边 ≥ [___] 确定 取消`），
  回车生效、Esc 取消、非法值就地红字提示。
- **理由**：可控、不会被 CSP 拦、与面板视觉一致；还能在输入时就提示格式错误。
- **影响**：`js/image-panel.js`（`askCustomTier`）；TESTING §22 C8/C9。

---

## ADR-040 `onDeterminingFilename` 在 Chrome 147 失效：文件名保护改走 FSA

- **日期**：2026-10-24 ｜ **状态**：✅（已实测，影响面待评估）
- **背景**：YouTube 下载要做「按模板起名 + 三段目录落盘」，沿用项目原来的文件名保护套路：
  下载前经 `vr-download-hook.js` 把 `url → filename` 预记账给 SW，
  再由 SW 的 `chrome.downloads.onDeterminingFilename` 监听 `suggest()` 回来
  （Chromium bug 579563 的官方 workaround，写法抄自 XBD/CocoCut/Imageye）。
- **实测结果（Chrome for Testing 147）**：**这套不再生效。**

  | 下载源 | 期望文件名 | 实际落盘 |
  |---|---|---|
  | `blob:` URL | `…_1080p.mp4` | `997b0753-…-ef4f343e356e.mp4`（UUID） |
  | `http:` URL | `probe/http-name-test.mp4` | `_video.mp4`（URL 末段） |

  钩子确实装上了（`downloads.download.__vrNameHooked === true`）、预记账也确实发了，
  **但 `suggest()` 的结果被忽略**。连 http 都不生效 → 不是 blob 特例，是机制整体失效。
- **决策**：
  1. 新功能（YouTube 下载）**主通道改为 File System Access**：拿 `VRDB.getHandle('root')`
     根句柄，按 `relPath` 建子目录、`createWritable()` 直写。文件名 100% 归我们管，
     顺带消掉「整包塞进 blob 再交下载管理器」的内存峰值。这也解释了 Tubly 为什么开
     「另存为」小窗用 `showDirectoryPicker`——同一个原因。
  2. 无授权句柄 / 不支持 FSA 时退回 `chrome.downloads`，并在完成文案里
     **如实告知「文件名可能被浏览器改成随机名」**，不假装成功。
  3. **存量功能（弹窗下载、图片批量、m3u8 合并）暂不动**，但记为待办：
     它们同样受此影响，只是以前没人注意落盘名不对。
- **理由**：`downloads` API 没有改名口子，onDeterminingFilename 一旦失效就没有替代品；
  FSA 是唯一能同时解决「名字」和「大文件内存」的正路，而且项目已经在用它做资源库迁移。
- **影响**：`js/yt/yt-download.js`（`save()` 双通道）、`js/yt/yt-download.html`（引入 `library/db.js`）；
  `docs/YT-IMPLEMENTATION.md` §4④；**待办：评估存量下载路径是否整体迁移到 FSA**。

---

*新增决策在此追加，编号顺延。*
