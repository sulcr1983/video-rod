# 苏哥的钓鱼竿 — 决策记录（ADR）

> Architecture Decision Records。记录「为什么这么做」，防止以后回头看忘记当初的理由。
> 状态图例：✅ 已生效 ｜ 🟡 生效中（施工期） ｜ 📋 已计划未开工
> **待办不记在这里**：ADR 只记「为什么这么定」，各 ADR 里的「已知待办 / 未验证」是**当时快照**；「还没做完的事」统一登记在 `docs/BACKLOG.md`（唯一真源）。

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

## ADR-041 尺寸档位按「短边」判定，并在档位上直接显示命中数

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

## ADR-042 面板下载复用 I3 队列，不另起一套

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：I3 的 `startDownload()` 自己扫描全页再跑队列，I4 需要「只下勾选的那几张」。
  若复制一份队列逻辑，并发/去重/取消/进度就会有两套实现，必然走偏。
- **决策**：把 I3 的队列抽成 `runQueue(items, opts)`，两条路径共用：
  - `VRImgBridge.download(items)` → 面板用（不弹确认条，进度仍走底部进度条）；
  - 「全部 N」按钮 → 仍走 `collectItems()` + `runQueue()`（行为不变）。
- **理由**：队列是有状态、易出错的部分（并发池、取消标志、进度节流），只允许存在一份实现。
- **影响**：`js/image-batch.js`（`runQueue`）、`js/image-panel.js`；回归 `cdp-image-batch-test.py` 35/35 未变。

## ADR-043 自定义阈值用面板内联输入，不用 prompt

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：`prompt()` / `alert()` 在内容脚本里可能被站点 CSP 拦截，且样式无法控制、会打断视觉。
- **决策**：点「自定义」在过滤区下方展开一行内联输入（`短边 ≥ [___] 确定 取消`），
  回车生效、Esc 取消、非法值就地红字提示。
- **理由**：可控、不会被 CSP 拦、与面板视觉一致；还能在输入时就提示格式错误。
- **影响**：`js/image-panel.js`（`askCustomTier`）；TESTING §22 C8/C9。

---

## ADR-044 FSA 直写的文件走 `vrLib.ingest` 显式入库，不等下载事件

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：资源库的常规入库靠 `chrome.downloads` 的 `complete` 事件：`sw-library.handleComplete`
  拿到 `d.filename` 反推相对路径再 `writeOne`。但 YouTube 下载走 File System Access 直写（ADR-040），
  **整个过程没有任何下载事件** —— 这条链路永远等不到，资源库里就不会出现这张卡，
  只能等 indexer 全量扫描兜底（慢，且要手动触发）。
- **决策**：
  1. `VRLib` 新增 `ingestDirect(info)` + `vrLib.ingest` 消息，按调用方给的 `relPath` 直接入库；
  2. `yt-download.js` 的 `save()` 改为返回 `{via, relPath, absPath, size}`，
     **必须带 uniquify 后的真实文件名**（重名会加 `_01`，用原路径入库就对不上文件）；
  3. 只在 `via==='fsa'` 时调；走下载器兜底的那条不调（它自己会经 `onChanged` 入库）。
- **理由**：两条落盘通道各有各的完成信号，入库必须挂在「真正写完」的那一侧，
  不能指望一个不存在的下载事件。`ingestDirect` 与 `writeOne` 共用同一份 item 结构，
  同名重下时星标/标签的保留口径也一致，不会出现两套语义。
- **影响**：`js/library/sw-library.js`（`ingestDirect` / `vrLib.ingest`）、`js/yt/yt-download.js`
  （`save` 返回值 / `ingestSaved` / `finish`）；回归 `yt-download-test.py` 21/21 未变。

## ADR-045 测试清理按文件名前缀圈定，不做无差别目录删除

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：图片测试需要在跑前清掉下载目录里的残留（否则 `conflictAction=uniquify` 会一直加 `(1)(2)`，
  计数全错）。早先的实现是「删目录里所有图片」，一次几十个 —— 触发宿主的**安全删除阈值**，
  整套测试直接被拦掉，而且表现很迷惑：退出码 1，却没有任何 FAIL 行。
- **决策**：`clean_disk()` / `disk_images()` 都按**文件名前缀**圈定测试站产物
  （`测试站` / `20261024_测试站`）。增量统计同口径，顺带解决「把用户真实文件算进增量」的问题。
- **理由**：测试只该动自己造的东西。前缀圈定既避免触发安全阈值，也避免误伤用户已有文件。
- **影响**：`tools/cdp-image-batch-test.py`、`tools/cdp-image-panel-test.py`；见 HANDOFF §7.4-17。

## ADR-046 YouTube 取格式客户端改用 VISIONOS（MWEB 已被关闭）

- **日期**：2026-10-24 ｜ **状态**：✅
- **背景**：ADR-039 的结论是「九种客户端里只有 MWEB 活着」，据此把 MWEB 排在第一位。
  2026-10-24 晚用户实测报错，复查发现 **MWEB 也已经被关闭**，统一回
  `UNPLAYABLE: The page needs to be reloaded`；ANDROID/IOS 直接 HTTP 400（版本失效）。
  这是 ADR-039 自己预判过的风险（「MWEB 直链窗口关闭」），只是比预期来得快。
- **决策**：客户端顺序改为 **`VISIONOS → MWEB → TVHTML5 → ANDROID → IOS`**。
  实测 VISIONOS 返回 32 条全带直链的格式、最高 2160p，**且 URL 里没有 `n` 参数**
  （连 sandbox 解密都不需要，比 MWEB 那条路更简单）。
- **理由**：YouTube 的客户端灰度是按「客户端 + 地区 + 时间」推的，任何单一路径都会过期。
  顺序里保留后面几个是「活得久」而不是「现在有用」；第一个返回直链的就用。
- **附带修**：错误汇总原来只保留**最后一个**客户端的失败原因，用户只看到 TVHTML5 那一行，
  前三个的真实原因被覆盖 —— 这正是这次报错信息误导人的根因。改为收集全部并按
  `YT_E_UNAVAILABLE` / `YT_E_LOGIN` / `YT_E_BLOCKED` 分类，UI 给不同建议
  （视频本身不可播时**不提供重试**，因为重试无意义）。
- **影响**：`js/background.js`（`ytCollectFormats`）、`js/yt/yt-download.js`（错误分类）；
  详见 `docs/YT-CLIENT-STATUS.md`。回归 `yt-download-test.py` 21/21 未变。

## ADR-047 图片设置两处入口共用一份 `vrLibSettings`

- **日期**：2026-10-25 ｜ **状态**：✅
- **背景**：I5 要暴露 9 个图片设置项（开关/尺寸/延迟/并发/上限/快捷键）。
  只放清单面板里，用户找不到；只放上游设置页，改完还得回面板看效果。
- **决策**：**两处都做，共用同一份 `chrome.storage.local` 的 `vrLibSettings`**：
  1. 面板标题栏齿轮 → 设置区（替换主体，不叠第二层遮罩）；
  2. `options.html` 新增 `#anchorImage` 分区，控件复用上游 `.switch` 样式；
  3. 两边都监听 `storage.onChanged`，改一边另一边即时反映。
- **理由**：设置跟着功能走（面板里能边改边看效果），同时保留「集中配置」的入口。
  共用一份存储就不会出现「两个地方的值不一致」这种最难排查的问题。
- **影响**：`js/lib-image-util.js`（`DEFAULT_SETTINGS`/`mergeSettings`）、`js/image-panel.js`、
  `options.html`、`js/library/settings.js`（`VRImgSettings`）；TESTING §23。

## ADR-048 快捷键走 `chrome.commands`，不走页面 keydown

- **日期**：2026-10-25 ｜ **状态**：✅
- **背景**：`Alt+Shift+D` 下载悬停图、`Alt+Shift+A` 开清单。页面内 `keydown` 实现最简单，
  但会被站点抢、输入框里误触、用户无法改键。
- **决策**：manifest 声明 `chrome.commands`（`imgDownload` / `imgPanelOpen`），
  SW 收到 `onCommand` 后查设置开关，再 `tabs.sendMessage({Message:'vrImg.hotkey'})` 转发。
  内容脚本里 `image-hover.js` 记录 `lastHoveredImg`，快捷键直接用它——鼠标不动时没有新事件，
  所以必须在 `mouseover` 时就把 img 存下来。
- **理由**：`chrome.commands` 全局生效、不与站点冲突，用户还能在
  `chrome://extensions/shortcuts` 自己改键；代价只是多一跳消息。
- **影响**：`manifest.json`（commands）、`js/background.js`（`vrImgHotkey`）、
  `js/image-hover.js`（`hotkeyDownload` / `lastHoveredImg`）、`js/image-panel.js`（`panel` 动作）。

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
- **验证**：B站、普通测试页、抖音均已实测；抖音 1920×887 视频上按钮 `right=1906`（距视频右缘 14px）、`top=76`，截图 `deliverables/assets/overlay-douyin.jpg`。
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

## ADR-039 页面内侧边栏 + 默认媒体库落盘

- **日期**：2026-10-19 ｜ **状态**：🟡 已实现（Weibo 页面 fetch 子目录待真机确认）
- **需求**：进入 X/微博/小红书个人主页时，侧边出现批量入口；点一下批量保存；所有内容默认进媒体库，不再每次弹目录选择器。
- **决策**：
  1. **页面内右侧抽屉**，不用 Chrome 原生 side panel：原生侧栏不能无手势自动弹出。进入主页自动展开，关闭后保留右侧竖标签。
  2. Weibo/X 由 `js/bulk-profile.js` 统一右侧抽屉，自动展开一次；补“一键保存本页”（全选当前可见媒体后直接保存）。
  3. 小红书主页由 `js/xhs-batch.js` 统一右侧抽屉，补“收集并下载”；自动补全详情开关保持默认关闭。
  4. **默认媒体库路径**：`Downloads/video-rod/<平台>/<作者(@ID)>/images|videos/<文件名>`。X one-click、X 主页批量、XHS 批量/详情都走这个路径；`vrMediaPath` 统一生成，不再对 X/微博批量调用 `showDirectoryPicker`。
  5. 媒体库设置组提供“启用媒体库”和“打开/选目录”；目录本身仍在媒体库页面选择（原生 picker 需要用户手势）。
- **验证**：X 主页面板自动展开 360×747，`一键保存本页` 存在；XHS 主页面板 360×849 展开，`收集并下载` 存在；`bulk-profile.js` 已无 `showDirectoryPicker` 调用；脚本语法通过。
- **待验证**：Weibo 的页面 fetch → `<a download>` 是否稳定支持带子目录文件路径；X 单条按钮新路径的真机下载记录（页面按钮注入受 X 懒加载影响）。
- **兼容**：媒体库平台识别同时接受 `x/xiaohongshu/weibo/douyin` 与旧中文目录 `小红书/微博/抖音/推特`。
- **补充（2026-10-19 苏哥反馈）**：
  - **不设条数上限**：按苏哥要求取消 20 条限制，只保留 3–5 秒/条、连续失败即停；XHS 自动补全同样不设条数上限。X 的 fxtwitter 429/5xx 增加一次退避重试。
  - **X 批量实测**：`x.com/NASA/media` 8 条 → 完成 7 条、跳过 1 条重复；文件全部落在 `video-rod/x/NASA(@NASA)/videos/`，没有按图片建目录。
  - **默认目录问题**：媒体库当前选中的根目录是 `download`，扫描 0 个；新增自动下钻 `video-rod` 子目录 + “重置目录”提示。下载文件本身在 `Downloads/video-rod/x/...`，旧根目录文件是改动前遗留。
  - **风险**：X 每条视频要查 fxtwitter 再下 X CDN；XHS 仍有 461/471。只读不等于无风控，靠限速/失败停止控制，不是零风险。

---

## ADR-040 showDirectoryPicker 目录记忆坑与媒体库根校验

- **日期**：2026-10-19 ｜ **状态**：✅
- **现象**：媒体库反复打开 `F:\download\video-rod`（只有 `_index`），看不到 E 盘实际下载文件。
- **网络资料**：
  - MDN：`showDirectoryPicker({id})` 会按 `id` 记住上次目录；再次使用同一 `id` 会在同一目录打开。
  - Chromium issue：`showDirectoryPicker()` 的 `id`/`startIn` 行为不一致；浏览器不允许网页直接指定绝对路径，`startIn` 只能给已知目录或已持有的 handle。
- **决策**：
  1. **移除固定 `id: 'vrLibrary'`**，改为 `startIn: 'downloads'`，避免被记忆目录拖回 F 盘。
  2. **移除 `hasMediaEntries` 硬校验**：任何用户授予读写权限的目录都可选；空目录也允许，只显示“0 个文件”。`resolveRoot` 仍会自动下钻到 `video-rod` 子目录。
  3. 已存句柄不再因为内容不符被自动清除；仅在权限失效时提示重新选择；保留「重置目录」。
  4. 期望路径明确提示 `E:\personal\Downloads\video-rod`。
- **边界**：仍然必须由用户完成一次原生目录授权；浏览器安全模型不允许扩展直接写绝对路径。目录内容不做白名单限制。
- **验证**：`node --check js/library.js` 通过；目录校验与句柄清除逻辑已接入。
- **抖珍藏 2.8.44 对照（2026-10-19）**：
  - `c.js` 在抖音页注入 `<aside>` + iframe `rl.html`（侧栏），`s.js` 在 iframe 中执行 `showDirectoryPicker({startIn: 已保存句柄 || 'videos', mode:'readwrite'})`。
  - 选中后调用 `rootHandle.requestPermission({mode:'readwrite'})`，再把 `archiveFolderHandle` 持久化；没有绕过浏览器权限，也不是下载 API 特殊能力。
  - 关键差异是**选择器从独立侧栏/窗口触发**，不会被主页面的最大化窗口盖住；我们此前在普通标签页里触发，原生窗口出现在 (0,0) 且被主窗口覆盖。
- **本实现调整**：媒体库入口改为 `chrome.windows.create({type:'popup'})` 独立窗口；选择前 `window.focus()` 并显示“正在等待系统目录窗口…”，选中后显式 `requestPermission({mode:'readwrite'})`。

---

## ADR-041 媒体库根目录改为 F + 外部目录隔离 + 重命名修复

- **日期**：2026-10-19 ｜ **状态**：✅
- **苏哥决定**：媒体库只用 **`F:\download\video-rod`**，不再要求 E 盘；E 盘容量不足。
- **根目录处理**：
  - E 的 `video-rod` 原目录（22 文件、约 143MB）移到 `F:\download\_e-video-rod-original` 备份；
  - `E:\personal\Downloads\video-rod` 建立 **目录 junction → `F:\download\video-rod`**，浏览器后续下载仍写 `video-rod` 路径时实际落 F；
  - 媒体库扫描 F，得到 **22 项**：X 10、小红书 7、其他 5（历史根目录文件）。
- **外部目录隔离**：`xbd-downloader`（704 文件）和 `老黄的分享`（17 个微信图片/视频）**保留在磁盘，但不进入媒体库扫描**；避免“其他”分类被外部下载淹没。仍保留 `_index/_trash/_thumbs` 跳过。
- **重命名修复**：星愿的 `FileSystemFileHandle.move(newName)` 抛 `NotAllowedError`；改为 `move(parentDir, newName)`，与删除到 `_trash` 的 `move(dir, name)` 一致。`move()` 返回 `undefined`，不得读取返回值的 `.name`。
- **验证**：临时文件 `test3.png` 预览 → 重命名 `test3-renamed.png`（toast「已重命名」）→ 删除到 `_trash`（toast「已移到回收站」）→ 媒体库回到 22 项；截图 `deliverables/assets/library-after.jpg`。
- **边界**：F 是唯一媒体库；E 的 junction 只解决“浏览器默认下载目录仍在 E”的问题。根目录 5 个历史文件暂归“其他”，P3 再做归档。

---

## ADR-042 Instagram P1：单帖/Reel 已加载媒体

- **日期**：2026-10-19 ｜ **状态**：✅ 代码完成；真实 Instagram 登录态下载待验
- **范围**：只处理 `instagram.com/p|reel|tv/<shortcode>` 当前 DOM 已加载的图片/视频；不自动翻页、不点开评论、不做写操作。
- **实现**：
  - `js/instagram.js`：帖子页注入「⬇ 下载当前帖」；读取 `article/main` 下图片/视频、作者、文案、shortcode；按 URL 去重；blob 视频跳过。
  - `manifest.json` 注入 `*://www.instagram.com/*`。
  - `js/background.js` `vrIgDownload`：落 `video-rod/instagram/<作者>/images|videos/<shortcode>_NN.<ext>`；`vrSetMediaHeadersFor` 回放 Referer；1.2–2 秒/条。
- **验证**：
  - `/p/test/` 页面按钮注入 ✅（帖子不可访问，按钮仍按路径注入）。
  - 本地 fixture：`cover.jpg` → `video-rod/instagram/fixtureauthor/images/test_01.jpg`，15,324 B ✅。
- **边界（如实记录）**：
  - 没有 Instagram 登录态，真实帖子/Reel 未做端到端下载验证；不能宣称真实站已通过。
  - 视频如果是 blob/MSE，当前跳过；轮播只收集已加载到 DOM 的媒体。
  - 文件名只用 shortcode 序号，未接 `naming.js` 的作者/文案模板。

---

## ADR-043 YouTube 入口彻底移除（苏哥拍板 2026-10-19）

- **日期**：2026-10-19 ｜ **状态**：✅ 已实施（代码 + CSS）
- **背景**：苏哥明确「YouTube 还是不做了」；既有的「YouTube 页面悬浮按钮 + popup 限制横幅」成了无意义入口，一并撤掉（延续 ADR-019/022/034）。
- **改动**：
  - `js/video-overlay.js`：站点排除加 `youtube.com` / `youtu.be`（含子域），YouTube 页面不再挂下载按钮。
  - `js/popup-videorod.js`：删 `buildYoutubeBanner()` 与 `siteInfo.youtube`，`detectSite` 不再对 YouTube 分支。
  - `css/videorod.css`：删只被该横幅使用的 `.vr-banner-warn`、`.vr-banner-tag.warn`。
- **影响**：`tools/cdp-m4-test.py`（断言 YT 横幅）、`test-site/yt-fake.html` 随之作废（保留归档备查，不再作为回归项）。B站分P横幅保留。
- **验证**：`node --check js/video-overlay.js`、`js/popup-videorod.js` 通过；YouTube 站点排除逻辑同 X 的既有排除套路。

---

## ADR-044 小红书图片「去 CDN 处理后缀取更大图」（尝试，未真机验证）

- **日期**：2026-10-19 ｜ **状态**：🟡 已实施；**未真机验证**
- **背景**：ADR-036 实探结论——详情 SSR `imageList` 只有 `urlPre`/`urlDefault`（webp，约 1200×1600），原始 `url` 为空；**真原图需详情接口签名**，风险高、不做。
- **决策**：不做签名接口；改为对拿到的图片 URL **去掉 CDN 处理预设后缀**（`!nd_dft_...` / `!nc_n_...` 或 `?imageView2/...`）当首选地址，通常能拿到更大版本；下载失败自动回退到带后缀的原地址。
- **实现**：
  - `js/background.js` `vrXhsScanInPage`：图片项产出 `url`（去后缀）、`ext`；当去后缀改变了 URL 时附带 `urlFallback`/`extFallback`。
  - `vrBulkDownload` 的 `xhs` 分支：先试 `url`，失败（含 interrupted）再试 `urlFallback`，文件名按实际使用的 ext 重算。
- **验证**：`node --check js/background.js` 通过；去后缀 + 取扩展名逻辑 node 单测符合预期。
- **未验证（如实记录）**：**没有任何真实图文笔记样本**，去后缀地址是否真能下到更大图、是否会 404，均未真机确认。需苏哥给一条真实图文笔记实测；若失败/扩展名不符，回退本次改动即可。

---

## ADR-049 全站切「舞台」皮肤：暖黑+舞台金，亮色不留（苏哥拍板 2026-11-04）

> 编号更正：本条初版误编为 ADR-045，与既有 ADR-045（测试清理）撞号，2026-11-05 统一更正为 049；原 ADR-046/047 同步更正为 050/051。

- **日期**：2026-11-04 ｜ **状态**：✅ 已拍板，待施工
- **背景**：B 纸感 + D 影院双皮肤用满一月，苏哥要求重设计资源库。impeccable 流程产出两辑共九个风格方向（`deliverables/reviews/2026-11-04-library-redesign-directions*.md`），可视化九向速选页（`deliverables/prototypes/library-redesign-options-v1.html`）对比后，苏哥钦点**舞台 Stage**：剧场暖黑 #100F0E 族底 + 舞台金 #E8B04B 强调 + 暖纸白文字，要求"图像是主角、界面克制有辨识度、杜绝 AI 模板感"。
- **决策**（苏哥原话四条）：
  1. **亮色不留**——只实施舞台深色一套；现有 B 纸感亮色皮肤退役，主题切换逻辑随之简化（产品端不再提供浅色）。
  2. **不留功能**——所有未完成功能（BACKLOG 全部 + 设置抽屉 + 详情面板字段去重等）一律列入施工清单，不许口头挂起。
  3. **真源锁定**——`media-library-stage-v1.html` / `popup-stage-v1.html` / `settings-stage-v1.html` 三个原型即视觉真源，施工照此复刻；文档与本 ADR 冲突时以本 ADR + 原型为准。
  4. **先出文档**——设计系统 token 文档（`DESIGN-SYSTEM-STAGE.md`）+ 施工清单（`BUILD-PLAN-STAGE.md`）先行，编码会话按清单逐任务施工、逐任务 CDP 验收。
- **否决**：暗房/档案室/仪表盘/目录/天文台/宋册/唱片墙/标本柜八方向（存档评审稿）；B+D 双皮肤继续演进（苏哥："好用但看腻了"）。
- **影响面**：`css/library.css`、`css/public.css`、popup/options 样式、`library.html` 结构（统计条删除、树编号、toolbar 两行、详情面板去重、标签组一行化）、设置抽屉为**新功能**（聚合 options 常用项入资源库，非纯换皮）。
- **蓝/赭退役**：popup 原强调蓝 #337CCC、设置页赭石/蓝色系全部退役，全站唯一强调色=舞台金。平台品牌色（B站粉/小红书红等）保留但降饱和使用。

---

## ADR-050 舞台施工四悬项拍板（苏哥 2026-11-05，全部按推荐）

- **日期**：2026-11-05 ｜ **状态**：✅ 已拍板，BUILD-PLAN-STAGE 随之定稿
- **决策**：
  1. **F5 去重语义 R1+R2 照批**（网盘原理）：删除=只减引用，最后一条引用清空才删物理文件；重命名只改显示名，物理文件不动。R3/R4 沿用 `DEDUP-REF-DESIGN.md` 原案。
  2. **F6 查看器：视频自绘控件保留，只引入 gifuct-js**（MIT，约 3KB，单一用途）补齐 GIF 暂停/逐帧；**否决 Media Chrome**——现有自绘已覆盖倍速/连播/进度，换引擎等于重写已验收功能，不划算。
  3. **F9 入口层四项全照原型批**：①popup 砍媒体控制 ②设置两层=库内抽屉(T5)+完整设置页 ③popup 新增项按 v3.1 原型（概览条/存到哪/已下载/体积）④页面侧「已下载」提示照原型做。
  4. **V1/V2 素材来源=公开测试素材**：AES-128 HLS 用公开测试流（Wowza/Netflix test stream 类），小红书图文用公开笔记链接；由设计/文档线找料并登记具体地址后进验证，跑通即关闭。V4 多平台登录态仍需苏哥配合登录一次（不变）。
- **影响**：BUILD-PLAN-STAGE v1.1 定稿；BACKLOG B-08/B-12/B-18 阻塞解除。

---

## ADR-051 产品定位原则：通用优先、专站增强（苏哥 2026-11-05）

- **日期**：2026-11-05 ｜ **状态**：✅ 已定，长期有效
- **背景**：苏哥给花瓣网测试料时澄清产品哲学（原话见 `TEST-ASSETS.md` §5）。此前 B-19 曾按"新平台适配 or 测试料"两口径请示，苏哥的回答超越了选项本身：这不该是二选一，而是定位问题。
- **决策**：
  1. **通用嗅探是底线能力**：任何页面，有图能单张/批量下载、有视频能单张/批量下载——通用通道做不到就是 **bug**，修通道本身，**不为单站写特例**。
  2. **单站适配只做体验增强**：悬浮按钮注入、命名模板变量、博主/分P 归组、防盗链头、防失效取源（ADR-044 类）——增强项，不是下载能力的前提。
  3. **新站点诉求的默认处理**：先回答"通用通道为什么不行"；答不出=立通道 bug 单（如懒加载/render 图嗅不到走 `catch-images` 同源扫描增强），答得出且值得=才立专站适配单。
  4. 花瓣网**不开专站适配任务**：B-19 撤销，素材 A5 转入新增 **V9「通用图/视频通道验收」**（含批量下载、单张下载、懒加载图捕获三点）。
- **同步**：IG 素材 A9（无登录态 reel）提供，B-03 从"待账号"转为"可试"；V5 结果两种走向均如实记录。
- **影响文件**：`TEST-ASSETS.md`（§5 原则、A5/A8/A9）、`BACKLOG.md`（B-19 撤、B-03 更新）、`BUILD-PLAN-STAGE.md`（新增 V9、V5 更新）。

---

## ADR-052 原型即产品真源：真实页面按原型**重写**，不做"旧代码映射"（苏哥 2026-11-05）

- **日期**：2026-11-05 ｜ **状态**：✅ 已定，推翻旧路线 ｜ **取代**：`PROTOTYPE-MAPPING.md` v1.0 的"改视觉补缺口"路线
- **背景**：苏哥连提两次——"你要按照原型图和文档去实现编程和代码，因为这个是我花了很多时间和你讨论出来的。之前是之前的，现在要重新做"；"你原来不是这样做的？那你的文档都要重新做啊。技术预研也要啊"。指出的核心错误：设计线此前把定稿原型当成"对旧页面的改造建议"（`PROTOTYPE-MAPPING.md` 开篇即写"代码已实现约六成，只需改视觉补缺口"），而原型本身就是**完整可交互的产品实现**（`media-library-stage-v1.html` 2100+ 行 DOM/CSS + 1000+ 行 JS，含搜索语法/收藏夹/批量/回收站/查看器/设置抽屉全套交互，CDP 断言通过）。两条路线相反：一条是"以旧代码为骨架贴新皮"，一条是"以原型为骨架接真实数据"。
- **决策**：
  1. **原型 = 产品真源**：`media-library-stage-v1.html` / `popup-stage-v1.html` / `settings-stage-v1.html` 三份原型的 **DOM 结构、CSS、交互逻辑**是施工蓝图，逐块复刻，不再"基于现有页面调整"。
  2. **真实页面按原型重写**：`library.html` / `popup.html` / `options.html` 的结构、样式、交互层**重写**为原型形态；**数据层与副作用层保留复用**（`js/library/db.js` IndexedDB、`indexer.js` 扫描、`thumbs.js` 缩略图、`path.js` 路径解析、`save.js` 落盘、`trash.js`/`rename.js`/`batch.js` 真实操作、`background.js` 下载管线）——这些是"真实功能"，原型里是 mock，**必须换成真实实现，不能丢**。
  3. **一句话边界**：**UI 层照原型重写，数据层照旧复用**。原型里的 `FILES` 数组 / `FAVORITES` 常量 / `TRASH` 数组 = mock，落地时替换为 `VRDB.getAllFiles()` / `fav` store / `trash` store；原型里的事件绑定和渲染函数 = 蓝图，落地时保留形状、把 mock 读写换成真实调用。
  4. **文档全部重做**：`PROTOTYPE-MAPPING.md` 作废重写为《原型复刻施工规范》（DOM/CSS/JS 三段对照 + 数据接入点）；`BUILD-PLAN-STAGE.md` 的 T2/T3/T4 从"改造/换皮"改为"重写/复刻"；`DESIGN-SYSTEM-STAGE.md` 补 DOM 结构规范；技术预研（查看器/溯源/去重）按新结构重写接口点。
- **为什么必须这样**（第一性原理）：
  - 原型里的交互（booru 搜索语法 `空格=交集 -词=排除`、收藏夹作为筛选第一层、查看器信息面板分组折叠、设置抽屉五项聚合）**旧页面根本没有**，靠"改视觉"永远出不来。
  - 旧页面的 DOM 命名（`lib*`）与原型（`pv*`/`grid`/`tree`）两套，强行映射会让每个功能都要写"翻译层"，长期维护成本高于一次重写。
  - 苏哥投入大量时间讨论出的成果就是原型本身，**把它当"参考图"是浪费**。
- **风险与对策**：
  - 重写面大 → 分块施工，每块 CDP 验收（对齐断言 + 交互断言 + 0 JS 错误），失败可 git 回滚。
  - 真实数据字段比原型 mock 少（原型有 `workId`/`authorUid`/`source`/`dur`/`h`，真实条目只有 `relPath`/`platform`/`creatorFull`/`creatorId`/`type`/`size`/`mtime`/`state`/`tags`/`starred`）→ 先写**字段适配层**（`toCardModel()`），缺字段按"未知/隐藏"处理，溯源类字段靠 F2 补采集，不假装有。
  - 旧页面的独有功能（概览卡/平台堆叠/博主产量/迁移向导）原型未画 → 按原型"克制"原则**取舍**：概览卡与统计条重复已删；平台堆叠/博主产量/迁移向导保留为**次级视图**（折叠在资源树/设置抽屉），不占主屏。
- **影响文件**：`library.html`、`css/library.css`、`js/library/ui.js`、`js/library/lightbox.js`、`js/library/video.js` 重写；`popup.html`、`js/popup*.js`、`options.html`、`js/options.js` 按对应原型重写；`docs/PROTOTYPE-MAPPING.md` 重写、`docs/BUILD-PLAN-STAGE.md` 升 v2.0、`docs/DESIGN-SYSTEM-STAGE.md` 升 v1.1（补 DOM 规范）。

---

## ADR-053 后台 service worker 启动铁律 + 防盗链三路线（2026-11-05）

- **日期**：2026-11-05 ｜ **状态**：✅ 已定 ｜ **触发**：苏哥报「抖音下载点了没反应」，实测挖出后台静默死亡

**事故链（按证据顺序）**

1. 抖音悬浮面板出现、点击后进入 `vr-busy 0%`，60 秒不落盘；但 `vrLastVideoDown` 读到 `null`，说明后台从没处理过下载请求。
2. 三条消息（`HeartBeat` / `getAllData` / `vrVideoOptions`）**全部超时**，`Target.getTargets` 里**根本没有扩展的 service_worker** → 后台从未启动。
3. 加启动打点定位到 `importScripts`：在 `js/library/dedup.js` 处中断。该文件第 15 行写死 `var root = window;`，而 SW 里没有 `window` → `ReferenceError` → `background.js` 第五行就断，`chrome.runtime.onMessage` 从未注册。
4. 表现之所以「看着都好」：资源库页面、皮肤、悬浮按钮全是 content script / 页面侧能力，不依赖后台。**此前 7 个套件全绿，没有一条验证过后台消息**——静默失效被完全掩盖。

**决策**

1. **凡被 `importScripts` 加载进 SW 的脚本，禁止直接引用 `window` / `document`**；统一写 `var root = (typeof window !== 'undefined') ? window : ((typeof self !== 'undefined') ? self : this);`。
2. **回归必须含「后台存活」套件**：新增 `tools/e2e-sw.py`（4 条：HeartBeat 应答 / getAllData 应答 / vrVideoOptions 12s 内返回 / 扩展上下文正常），置于 `e2e-all.py` 首位。后台静默死亡从此是红灯，不再是隐形。
3. **任何可能卡死的 await 必须有硬超时**：新增 `vrWithTimeout(promise, ms, label)`，已覆盖抖音详情探测（8s）、B站探测（8s）、命名注入（8s）、当前播放探测（4s）。超时即落到下一分支，永不把面板挂在「正在问…」。
4. **`chrome.offscreen.createDocument` 只有 Promise 形态、不接受 callback**。按 callback 写会让 `resolve` 永不触发、调用方永久挂起（实测踩到，m3u8 合并链路同样受影响，已一并修正）。
5. **防盗链站点按三路线递进**（抖音实测唯一可行序）：
   - ① `chrome.downloads` + DNR 补 Referer —— **抖音无效**（DNR 的 modifyHeaders 对下载器请求不生效），直链返回 `SERVER_FORBIDDEN` 并落 0 字节 `.htm` 残件。
   - ② 页面主世界 fetch → blob → `<a download>` —— **抖音无效**（CDN 跨域，`TypeError: Failed to fetch`）。
   - ③ **离屏文档直连**（`js/offscreen-fetch.js`）：扩展上下文 fetch 有 host_permissions 不受 CORS 限制、DNR 的 Referer 对 fetch 生效 → 取到 blob → `<a download>` 落盘。**实测 18.5MB 完整落盘、文件名正确**。
   - 注：离屏文档里 `chrome.downloads` 是 `undefined`，不能在里面调下载器；用 `<a download>` 才能保住文件名。

**已知残项（如实记录，未解决）**

- 路线③ 的 `<a download>` **不支持子目录**，文件落在 `Downloads` 根目录，未进 `video-rod/<平台>/<作者>/<类型>/` 归档结构（与 B站 durl / 微博 blob 路线同一取舍）。
- 无 FSA 目录授权时，`chrome.downloads` 回退路径会丢文件名与子目录（`download-path` 套件 6/10 即此原因，与 ADR-040 同源）。要完整命名 + 自动归档，需授权一次归档目录。


---

## ADR-054 全站下载/管理链路收口（2026-11-05 晚，苏哥要求第一性原理收尾）

目标只有两个：**能下载、能管理资源**。按这个标准逐条收口，不顺手加无关功能。

### 下载链路（真机实测，全部用带登录态的 Edge 实例）

| 站点 | 结果 |
|---|---|
| 抖音 | 1440P 四档 / 18.5MB → `video-rod/抖音/张见识(@56675926250)/视频/…mp4`，入库 |
| 小红书 | 视频笔记 93MB → `video-rod/小红书/星球档案馆/视频/…mp4` |
| 微博 | 单图 99,922B；**批量 3/3 成功**，共 8 张 → `video-rod/微博/待整理/图片/` |
| X | 悬停按钮恢复、点击落盘 → `video-rod/X/待整理(@NASA)/图片/` |
| B站 | 720P/1080P 可下（页面内合成） |
| YouTube | watch 页入口 → 下载页 28 档 → 1920p 9MB → `video-rod/YouTube/Exploropia(@Exploropia)/视频/` |
| TikTok | 页面可达（需代理）、通用取源到 6 个 MP4；**下载被 CDN 签名/会话绑定拒绝**，属站点侧限制 |

### 关键修复（按证据定位，不猜）

1. **图片批量 3 张挂 2 张**：离屏兜底里「先撤 DNR 规则再取流」顺序反了 → 改成取流成功后才撤规则；离屏文档首次创建后立刻发消息会 `no-response` → 加重试 3 次；长连接回执丢失时不能报「全部失败」，改以 `vrImg.batchProgress` 广播为准。并发 3→2（微博 CDN 对 3 并发不稳）。
2. **X 悬停按钮不出现**：`mergeSettings` 的默认 `imgHoverMinSize=600` 覆盖了代码里的 500（诊断钩子读到 `minShow:600` 才定位）。改默认值 + 尺寸判定内联到 image-hover（切断跨文件常量版本耦合）。
3. **资源库永远空**：首次自动索引只试需要 FSA 授权的 full/snapshot；实际 `scanDownloads` 读下载记录根本不需要授权。改三级兜底 + `d.exists === false` 过滤幽灵条目 + 跳过 `_selftest` + 补 `absPath`（缩略图/指纹要用）。16 条幽灵 → 15 条真实。
4. **YouTube 按钮消失**：Shorts 形态 watch 页没有 `#below` 等锚点 → 补右下角悬浮兜底。
5. **TikTok 等 MSE 站点取不到源**：新增**通用**「页面内嵌数据扫视频直链」（`vrPageEmbeddedVideoProbe`）。用一次 `JSON.stringify` + 正则，不递归（递归 200KB 内嵌数据会卡死页面主线程，实测踩到）。任何把 playAddr 写进页面数据的站点都受益，不写站点特例。
6. **B站归档**：`<a download>` 不支持子目录 → 下载前记完整 relPath，由 `onDeterminingFilename` 对 `blob:` 下载补回目录（只匹配 blob，避免误伤其它 mp4）。
7. **命名**：`pageTitle` 加 og:title → URL 末段 → 可见 h1 兜底；后端标题太弱（空/纯符号）时改 URL 末段。文件名从「图片」「- 微博」变成 `@地球知识局 的个人主页`。
8. **扩展更新后点按钮报 `Extension context invalidated`**：video-overlay 的 start() 包 try/catch 并复位 busy。
9. **扩展错误页 60 条错误的真实构成（2026-11-06 实测）**：不再凭截图推断，直接读取运行中的 Edge 错误页得到全量数据。60 条里 **36 条是孤儿上下文**（扩展重载后旧页面的 content script 仍存活，裸 `chrome.runtime.sendMessage` 逐条抛错，集中在 `content-script.js`，占 60%），**17 条是真实缺陷**，**7 条是已降级提示或浏览器侧限制**。
   - 孤儿上下文治理范围从「仅 video-overlay 点击路径」扩到 `content-script.js` 全量发送路径：新增 `runtimeAlive()`（判 `chrome.runtime && chrome.runtime.id`）、`safeSend()`、孤儿态 `bury()` 自毁（摘监听器 + 断保活）；HeartBeat 的 `onDisconnect` 改为具名回调并先判存活，避免递归重连风暴。裸调用从 7 处降至 0。
   - 真实缺陷里只修当前仍复现的：`weibo-backup.js` 两处引用从未声明的 `order`（月份选择已废弃）→ 改为 `pickedCount()`/`totalCount()`；`background.js` 抖音分支唯一未包 try 的 `await chrome.tabs.get`（`No tab with id` 未捕获拒绝）；`downloads-page.js` 的 `chrome.downloads.show` 补同步与 Promise 双重捕获（`Download must be complete`）。
   - **不修但要记住**：`moveHooks` / `ask` 报 not defined 是修复前旧脚本残留（当前 `app.js` 中二者均已声明）；`Invalid url pattern '*://127.0.0.1:18080/*'` 的 18080 在扩展源码里不存在，仅见于 `archive/` 与 `deliverables/` 原型页，来源未证实，不动代码。
   - 取证方法：Edge 的扩展错误只存在进程内存（`Extension State` leveldb 停在旧时间戳、无错误文本），**重启浏览器即清零**，所以不能用 CDP 重启方式读取；只能用 Windows UI Automation 读已渲染的错误页。新版本 Chrome/Edge 已移除 `--load-extension`，验证时改用 CDP `Extensions.loadUnpacked`。

### 护栏

- 回归 `e2e-all` 最终 7/8：`download-path` 6/10 为已知限制（无 FSA 目录授权时下载器丢名/丢目录），其余全绿。
- 真机结果全部回填 `docs/TEST-ASSETS.md`，包括 TikTok 的失败边界，不虚报。
- 测试实例加 `--proxy` 支持（TikTok 需要），今日启动 5/6 次，仍常驻不关。

### 边界（如实记录）

- TikTok 下载被 CDN 签名挡住，通用三条路线（downloads+DNR / 页面 fetch / 离屏直连）均 403；需要登录态或站点级签名方案，未做单站特例。
- `<a download>` 类下载（B站）在**自动化点击**下会被浏览器手势校验拦截，真人点击不受影响；因此归档补名未能在自动化里端到端复验。
- `download-path` 套件 6/10：无目录授权时 Chrome 147+ 忽略 filename，需一次 FSA 授权才能 10/10。


---

## ADR-055 原型纠偏收口 + 播放器改用成熟开源方案（2026-11-05 晚，苏哥连续拍板）

### 一、原型符合度纠偏（按已确认的第四阶段计划执行）

最小改动、只动 UI 层：popup 380×560、胶片条编号、资源库 h1 32px 衬线 / gap 18px 16px /
卡片 12px / 侧栏 268、预览标题 22px 衬线、设置页改为「顶部条 + 3 组 8 项章节 + 主区单章」。
设置页采用**非破坏性外壳**：19 个旧 section 与全部 input 一个不删，只做章节显隐收纳，
「索引」卡移动到索引章节；实测保存按钮仍回「已保存…」、高级工具 5 个 section 可切换。
C1-C5（chips/seg 增项、计数重复、圆角文档冲突、三线对齐）按约定未动，等苏哥拍板。

### 二、播放器：采用成熟开源方案，不再自绘控件

苏哥反馈四个 bug：视频没预览图、播放尺寸不按视频本身、滚轮方向反了、不要自己折腾播放器。
联网调研对比 Plyr / Video.js 8 / Vidstack / Media Chrome / Shaka 后选 **Plyr 3.8.3（MIT）**：
单 JS + 单 CSS + 内嵌 SVG sprite，本地 vendored 到 `lib/plyr/`，完全离线、无外部请求，
CSS 变量可直接对齐舞台金 #E8B04B；Video.js 8 更重且需额外字体资源，按最小改动原则不选。
已知 Plyr 官方标记为 deprecated（仅安全更新），但功能稳定；接口已收敛在 lightbox 的
`new Plyr(...)` 一处，将来要换 Video.js 成本低。**此条覆盖 ADR-046 中「查看器只引
gifuct-js、否决 Media Chrome」的播放器部分**，依据是苏哥 2026-11-05 的明确指令。

### 三、新增交互铁律

- **上下**（滚轮 deltaY / ↑↓）= 上一个 / 下一个素材；**左右**（滚轮 deltaX 或 Shift+滚轮 / ←→）= 进度 ±5 秒。
- Plyr 自带键盘全禁（`keyboard:{focused:false,global:false}`），否则它把 ↑↓ 抢去调音量。
- 视频按 `videoWidth/videoHeight` 给播放器外壳定尺寸，在保持原始比例前提下**占满可用高度**；
  `is-video` class 必须加，否则 `.fakeMedia` 仍是 62% 宽的 16:9 小框，四周大片留白。
- 右栏只显示有真实值的字段：空 / `—` / `-` 收起；无原帖无直链时整组「来源」收起；
  不显示「还没有标签」「同作者 0 项」「未记录提示」这类空占位。延续详情面板去重铁律。
- `blob:` / `data:` / `file:` 不是可回溯的网页直链，不作为「已记录」展示。

### 四、修掉的真实 bug（均有实机证据）

| bug | 根因 |
|---|---|
| 视频卡片 / 播放器都没预览图 | `loadVideoFrame()` 在 `draw()` 里先 `cleanup()` 清掉 video 的 src 再 resolve，canvas 画的是空白 |
| 大视频仍没预览图 | 8s 超时太短，93MB / 18.5MB 文件 10s 内连 loadedmetadata 都不触发；改 30s + seek 3s 兜底 |
| 视频一律默认尺寸 | 预览层从未给 `.pv-stage` 加 `is-video`，容器被锁死在 16:9 框 |
| 滚轮方向反了 | 预览层**根本没有** wheel 绑定，只有 autoBtn 文案写着「滚轮可切换」 |
| 胶片条一排空按钮 | `paintFilm()` 只渲染编号，没渲染 `.cover` 也没读缩略图缓存 |
| 右栏一堆「没记录」 | `pvMediaRow` / `pvMoreCount` 等 id 从未进 `cache()`，直链行永远显示默认 `—`；下载记录字段名是 `sourceUrl`，预览层只认 `mediaUrl` |

### 五、边界（如实记录，不虚报）

- 5 个视频中 4 个已生成真实抽帧预览图，胶片条 15 个按钮中 14 个有真实缩略图；
  **1 个 93MB 文件 30s 内仍未解出首帧**，保留渐变占位（不假装有图）。
- 竖屏视频在宽舞台里左右留白是「保持原始比例」的必然结果，不做拉伸填充。
- `download-path` 6/10 为无 FSA 目录授权的已知限制，非本轮引入。
- 测试基线同步：侧栏断言 264→268、popup 底色断言 → #0B0A09（原型是真源，改断言不改产品）。

---

## ADR-056 微博相册备份走站点 API + 逐张入库（2026-11-06）

- **日期**：2026-11-06 ｜ **状态**：✅ 已定，待施工 ｜ **触发**：苏哥要求参考星愿里装的「叫小微--微博相册备份/无水印下载」
- **方案全文**：`docs/WEIBO-ALBUM-PLAN.md`（含源码拆解、本机实测、候选链、验收）

**背景**

现有微博批量是「人工往下拉 + DOM 扫描」（`js/bulk-profile.js` 的 `scanWeibo()`），只能记到当前已加载的图。
小微的做法是打微博官方相册接口 `GET /ajax/profile/getImageWall?uid=&sinceid=&has_album=true`，
用 `since_id` 游标分页，拿到**整个相册历史**，再按 `timeline_year/month` 分桶。

**决策**

1. **引入相册 API，作为独立的「相册备份」入口**，与现有滚动记录**并存**，不替代：
   滚动记录管「随手刷到的」，相册备份管「历史全量」。现有 DOM 扫描一行不改（除 §4 的候选升级）。
2. **落盘逐张进资源库**，复用既有 `vrBulkDownload` → `vrBulkSaveItem`（单地址 → downloads → 离屏 → FSA），
   **不新增下载实现**，也**不做内存 zip**（小微那种 zip 落盘与资源库完全脱节，无法预览/去重/检索）。
   注意：`vrBulkSaveItem` **只使用单个 `it.url`**，没有候选池（2026-11-06 核实：当前版本、HEAD、git 全历史均无 `it.urls`）。
3. **候选链收到两级**：`wx3/large` → `wx3/original`。
   首版是五级 `oslarge → large → original → lz → proxy`，被**登录态实测推翻**：
   `large`（744×913 / 353KB）才是最大档，`oslarge`（690×847 / 161KB）更小；
   `original` 与 `large` 完全一致；`lz` 与第三方代理 3/3 全部 `Failed to fetch` —— 三者一并移除。
   因后端不遍历候选，改为**下载前用样本图探测一次**，把验证过的档位作为整批首选地址（`probeTiers`）。
4. **候选校验不能只看 HTTP 200**：实测 sinaimg 对无效 pid 返回 **200 + image/gif 占位图**
   （final URL 含 `/images/default_`），必须按「非占位图 + 非 gif + ≥1KB」判定。
5. **分页用多重终止、不按月**：实测 `timeline_year/month` 大面积为空（3 页 71 条中 65 条无月份，
   第 2 页起整页为空），故**不按月分组也不按月份终止**；终止条件为：空页 / 取够 N 张 / 游标不推进 / `MAX_PAGES` 上限 / 用户停止。
6. **去重按 `mediaId = pid` 双层保障**：`vrMediaIdentity()` 的键虽然含 `mediaId`，但**也含 URL 的
   `origin+pathname`** —— 档位从 `/large/` 换到 `/original/` 就会算出新键、判成新图。
   故内容脚本侧再按 pid 过滤（`filterDone`/`mergeDone`，存 `chrome.storage.local` 的 `vrWeiboDone:<uid>`）。
7. **无 `pid` 的条目必须跳过**：接口首条实测为 `object_id: null` 且无 `pid`，硬拼会得到 `undefined.jpg`。

**与 ADR-010 的关系（必须写清）**

ADR-010 是「只抓已加载项，**不自动滚动**」，理由写的是「自动滚动有副作用（触发播放、加载量失控）」。
本决策**不违反**它：

- 相册 API 是**一次同源 GET**，不滚动页面、不触发播放、不操作用户的滚动条 —— ADR-010 针对的副作用一个都不存在；
- 加载量由**用户设定的「最多取 N 张」**决定，且先只取元数据（pid + mid，体积很小），下载另由用户勾选触发 —— 比自动滚动更可控；
- 仍保留「不自动翻页」这条：分页循环由用户点「开始」触发、可随时「停止」，与 ADR-033 的「半手动」口径一致。

**实测依据（Edge 真实登录态，CDP 9480）**

- 端点存在且可用：`ok:1`，`since_id` 会推进。
- 防盗链是「UA + Referer」组合判定：`wx*.sinaimg.cn` 在「Chrome UA 且无 Referer」下 **403**，带 Referer 或无 UA 均 200
  → 取字节必须走页面上下文 fetch 或带 Referer 的离屏 fetch，**不能裸直连**。
- 档位真实对比（3 样本）：`large` 最大，`oslarge` 更小，`original` 与 `large` 相等，`lz`/`proxy` 全失败。
- 月份字段：71 条中 65 条为空，按 mid 分组仅补回 8 条，`statuses/show?id=<mid>` 可反查但每条约一次请求。
- 端到端：44 张收集成功、档位探测 `large` 首次命中、条目构造正确。

**已知未做（如实记录）**

- 实站「点下载选中 → 落盘入库」这一环尚未人工验收（采集与构造已实测通过）。
- 月份信息若确实需要，可走逐条 `statuses/show` 反查，默认不做（风控代价）。

**已知未实测（如实记录）**

- `since_id` 是否真会推进、翻到底的具体形态；
- 各档位的真实像素/字节对比（`oslarge` 是否真优于 `large`）。

根因：星愿未开 `--remote-debugging-port`，Cookie 库被浏览器独占锁定，开 CDP 需 `taskkill` 会关掉苏哥当前窗口，故未擅自执行。
代码已用**双重终止条件**与**同级回退**消除对前者的依赖；后者最差等同现状，不会更糟。

**影响面**

新增 `js/weibo-backup.js` + `js/weibo-album-core.js`；`manifest.json` 微博分支 +2 行（含加载顺序）；
`js/bulk-profile.js` 的 `bigImage()` 改为返回候选数组（`it.url` 不变，补 `it.urls`）。
`js/background.js` **一行未改**（候选探测与去重都在内容脚本侧）。回滚为单提交 `git revert`。

---

## ADR-057 视频预览图：根因是 type 空串，不是大文件（2026-11-06）

- **日期**：2026-11-06 ｜ **状态**：✅ 已修并实测 ｜ **触发**：苏哥报「微博下载的视频没有预览图」

**症状**：21 个视频里 4 个没有预览图，含一个 114MB 的大文件。

**初判是错的**：一开始按「moov atom 在文件尾部、要读完整 114MB」归因为大文件解码慢，
并据此把视频超时从 8s 调到 30s。**实测证伪** —— 修好后同一个 114MB 文件 **259ms** 就出图了。

**真根因（两条，都在 `js/library/thumbs.js`）**

1. **`enqueue()` 的 type 判断把条目拒了**：原逻辑 `if (entry.type !== 'image' && entry.type !== 'video') return;`。
   存量数据里有条目的 `type` 是**空字符串**（实测 VFE Team 那两个就是），于是**从未进过队列**，
   永远不会生成预览图 —— 跟文件大小毫无关系。
2. **失败后没有任何记忆**：`.catch` 只 `delete inflight`，等于「从未尝试」。
   虚拟滚动一次重绘就重新烧一遍超时，坏文件能把 `MAX_RUNNING=2` 的队列堵满。
   叠加第 1 条：这些条目此前根本没进队列，所以「30 秒超时」的解释从一开始就不成立。

**三处附带缺陷（同类症状，一并修）**

- `dbReady()` 为 false 时仍 `return` 对象 → UI 有图但**刷新即失**，条目永远没有 `thumbKey`。
- `patchFile` 被 `try/catch` 静默忽略 → thumb 表里有孤儿 blob、条目却没 `thumbKey`，
  `cached()` 永不命中 → 每次进视口重抽。**注意 `db.js:104-110` 在条目不存在时返回 `null` 而不是抛错**，
  必须显式检查返回值。
- 超时分支只 `reject` 不 `cleanup()` → 挂着的 `<video>` 一直占并发槽。

**修复**

1. 新增 `kindOf(entry)`：type 合法则用，否则**按扩展名推断**并回写 `entry.type`。
2. 新增失败记忆 `failed[relPath]` + `MAX_ATTEMPT = 2`；达上限后 `enqueue` 直接跳过；成功即清零。
3. 新增 `VRThumbs.retry(relPath)`（不传参则清全部），供手动重试。
4. `dbReady()` false 与 `patchFile` 返回 null 都当作失败抛出，计入失败记忆。
5. 超时兜底里 `cleanup()`，不再占并发槽。
6. 去掉 `onloadeddata` 里「无条件再等 3 秒」的盲等；seek 命中不到就退回当前首帧。

**实测结果（Edge 9480，真实库）**

| 项 | 修前 | 修后 |
|---|---|---|
| 缺预览图的视频 | **4** | **0** |
| VFE 视频（3MB） | 40s 超时 | **258ms** |
| 8K 视频（2MB） | — | **260ms** |
| 大文件（114MB） | 40s 超时 | **259ms** |
| 单测 `tools/test-thumbs-queue.js` | 无 | **17/17** |

**教训**：不要因为「文件大」就直接归因到解码性能。
先验证「任务到底有没有真的进入队列」—— 这次是 `type` 空串把它挡在门外，
调大超时、优化 seek 全是无效功。

---

## ADR-058 图片侧边栏独立成页 + 抄 AIX/Fatkun 的能力面（苏哥 2026-11-06）

- **日期**：2026-11-06 ｜ **状态**：✅ 已实施并实测 ｜ **触发**：苏哥「对于图片下载的需求，希望侧边点击打开就出现页面上的图片列表，然后有预览图，可以点选下载，选择都是默认下载」＋「先参考星愿浏览器新装的两个扩展，逆向和抄他们的功能」

**逆向对象（星愿 = Twinkstar 的扩展目录）**

| 扩展 | ID / 版本 | 抄到的能力 |
|---|---|---|
| **AIX 智能下载器** | `pljf…` 9.0.58 | `imagePage` 三栏布局（tabs + filter-row + image-grid + action-bar）、尺寸档位滑块、站点图集适配表（20+ 站）、下载管理（任务/进度/暂停/重试/清空）、下载归类、**图片过滤（域名+正则，可导入导出）**、拖拽下载、框选下载、`{NO001}/{PAGETITLE}/{DATE}` 模板、WEBP→JPG、打包、导出链接 |
| **Fatkun 图片批量下载** | `kmlj…` 5.1.6 | 图片网格 + 全选/反选 + 尺寸过滤 + 多页抓取（电商批量存图的心智） |

**决策**

1. **图片批量入口从「页面浮标」彻底收进侧边栏独立页** `image.html`。
   依据不是喜好，而是三方一致：业界（Image Downloader / Image Harvest / AIX / Fatkun 都不放常驻浮标）、
   用户直觉（点扩展才找功能）、成本匹配（低频操作不占常驻 UI）。
   `manifest.side_panel.default_path` 改为 `image.html`；每个 tab 的 `setOptions` 也指过去；
   `Alt+Shift+A` 改为**直接打开侧边栏图片页**（旧逻辑要求 `imgPanel!==false`，而该项默认 false，等于该快捷键一直是死的）。

   **补记（2026-11-07，实测才发现上面这段当时并没真正生效）**：
   - **`action.default_popup` 必须删掉**。只要它还在，Chrome 就把点击交给 popup，
     `sidePanel.setPanelBehavior({openPanelOnActionClick:true})` **完全不起作用** ——
     这就是「点了图标什么都不发生」的根因。已从 manifest 移除（Firefox 版保留，因为它没有 sidePanel）。
   - **`setPanelBehavior` 必须在 SW 顶层每次启动都设**。实测冷启动后
     `getPanelBehavior()` 读到的是 `{openPanelOnActionClick:false}`；
     原代码只在 `init.js` 的 `InitOptions` 里设一次，而 SW 被回收再唤醒不会重跑那段。
     现在 background.js 顶层无条件设 true，并在 `action.onClicked` 里兜底
     （setPanelBehavior 不可用时用 sidePanel.open 直接开）。
   - **侧边栏里切页不能用 `window.close()`**：侧边栏不是独立窗口，close 会被静默忽略
     （表现是「点 ▶ 没反应」）。改为「先 setOptions 切路径，再原地 `location.href` 跳转」。
2. **选定 A 网格形态**（苏哥看四款原型后拍板）：尺寸档位带命中数 + 两列卡片 + 底部批量栏。
   原型见 `deliverables/prototypes/image-sidebar-options-v1.html`（四款可切换，单文件离线可开）。
3. **交互模型（苏哥 2026-11-06 二次拍板）**：
   - **点图 = 看大图预览**（左右切换/单独下载），**不改勾选**
   - **勾选靠独立的圈**（20px，命中区外扩 6px）
   - **全选只勾选，不触发下载**
   - 默认勾选口径：排除已下载；小图/条状图/图标在扫描阶段就按与面板/悬停一致的门槛滤掉
4. **候选链取图必须过滤「非图片地址」**：`collectCandidates` 第 ① 级是包裹图片的 `a[href]`，
   那可能是**详情页**。直接取首项会让预览显示网页、下载存网页 —— 这是「下到的不是想要的」最常见成因。
   改为先用 `isProbablyImage` 过滤再取最靠前。
5. **翻页抓全在后台标签执行**：复用用户当前标签会把页面导航走，翻 10 页等于抢 10 次；
   改为 `tabs.create({active:false})` 跑完即关，完全不打扰。
6. **ZIP 自己实现（STORE，零依赖）**：图片本身已是压缩格式，再 deflate 几乎不减小体积，
   却要多背 ~100KB 依赖；STORE 已足够满足「一次下载多张、避开浏览器多文件确认弹窗」。
7. **下载管理页直读 `chrome.downloads`**，不自建任务表：浏览器下载器才是真相，
   自建表要和它对齐进度/暂停/失败原因，纯属重复实现且必然不一致。
8. **过滤规则用黑名单语义**（命中即不显示），不做白名单：实际诉求都是
   「某站的广告图/表情永远别出现」，白名单还要额外维护「允许什么」，更容易漏。

**实测结果**

| 套件 | 结果 |
|---|---|
| `tools/test-album-sites.js` | **50 / 50** |
| `tools/test-album-export.js` | **50 / 50** |
| `tools/test-img-filter.js` | **47 / 47** |
| `tools/test-naming.js`（含新增 N9） | **43 / 43** |
| `tools/test-image-settings.js` | **50 / 50** |
| `tools/test-image-util.js` / `batch` / `tier` | 100 / 27 / 57 全通过 |
| 真实扩展环境（Edge 9480） | 扫描 2/2、批量落盘 2 张、翻页 3 页抓全 6 张、导出 txt/zip 落盘、暂停/继续/重试可用、零控制台报错 |

**踩到的坑（都已修，写进来免得重犯）**

1. **`mergeSettings` 会把数组型设置转成数字**：它原本对所有非布尔项一律 `parseIntRange`，
   新增的 `imgFilterRules` 是数组，结果规则全丢。改为**按默认值类型分派**（number 才做范围解析）。
2. **暂停的下载在 Chrome 里 `state` 仍是 `in_progress`**，只有 `paused=true`。
   先判 `state` 会让暂停行仍显示「下载中」且没有「继续」按钮。改为**先判 `paused`**。
3. **AIX 占位符替换顺序**：`{author}` 会命中 `${author}` 的花括号，留下孤零零的 `$`（一次打挂 11 条命名断言）；
   且 `${NO}` 会被 `{NO}` 命中变成半截 `$7`。铁律：先换 `${...}`，AIX 正则加 `(?<!\$)` 负向后视。
4. **跨域 CDN 不能按站点域名选派生规则**：页面在 weibo.com，图片在 `wx1.sinaimg.cn`；
   先 `matchSite` 再查规则会全部落空。改为「站点规则优先，失败再按 CDN 特征逐条尝试」。
5. **`imgHoverMinSize` 被误改成 500**（ADR 定的是 600），被 `test-image-settings.js` 的 A1b 抓到。
6. **同页多图同名**：批量下载统一用页面标题时，`cover.jpg`/`sprite.png` 落成同名 `.jpg`/`.png`。
   改为按序号 `_01/_02` 命名。
7. **`nearestCard` 一路上溯到 `<body>`**（2026-11-07 修）：下载名变成整段页面说明文字
   （实测得到 `20261107_真实尺寸（按短边）：480_300_...→_06.jpg`）。
   改为遇 `BODY/HTML` 就返回 null，且要求容器里不只有这一张图。
8. **面板浮标数字不刷新**（2026-11-07 修）：`applySettings` 只在「关→开」时重建 UI，
   改 `imgMinSize` 后浮标仍显示旧张数。改为数值变化时单独 `scheduleCount()`（不重建，保住选中态）。
9. **测试脚本硬编码了另一台机器的路径**（2026-11-07 修）：`D:\Users\liq21\...`（下载目录）
   与 `E:/test/video-rod/test-site`（夹具根）在本机都不存在，导致「落盘 0 个文件」「夹具页不存在」
   这类**看起来像产品回归、其实是测试环境不匹配**的失败。改为 `VR_*` 环境变量优先、
   默认值按仓库相对路径/本机实测值推导。
10. **夹具素材尺寸与声明不符**（2026-11-07 修）：`panel.html` 注释写 640×480/300×300 等，
    实际素材是 800×700/700×650，导致档位计数断言对不上。已按声明重建素材。
11. **`image-batch.js` 的 `collectItems` 漏传 `minShow`**（2026-11-07 修，**真实用户可见**）：
    不传就落到默认 `MIN_SHOW(500)`，那是「悬停按钮」的门槛；
    而面板/侧边栏都用 `PANEL_MIN_SHOW(48)`。结果 320px 的正文配图在批量时被静默漏掉 ——
    确认条说「5 张」，实际只落 4 张。三处扫描口径必须一致，这是本项目反复踩的同一类坑。

**明确不做**

- 下载归类（router）按扩展名自动分目录：现有三段式目录（平台/博主/类型）已经是更好的结构，再按扩展名分会打架。
- AIX 的「评论页数」翻页：那是单站特化，通用性差。

---

---

## ADR-059 微博视频「下好了却显示叹号」：FSA 返回值被当成 downloadId（2026-11-06）

- **日期**：2026-11-06 ｜ **状态**：✅ 已修并实测 ｜ **触发**：苏哥报「点击微博视频后台会悄悄下载，但按钮出现叹号，让人以为没成功」

**现象**：点视频下载按钮 → 文件**确实落盘了**（14,592,126 字节，`state: complete`），
但按钮闪一下红色叹号（`vr-warn`），用户以为失败。

**证据链（真实下载记录，同一秒内两条）**

```
14:19:39  ...平台.mp4.htm   state=interrupted  bytes=0    error=SERVER_FORBIDDEN   ← 路线1 直连被拒的残件
14:19:41  ...平台 (1).mp4   state=complete     bytes=14592126                       ← 路线2 真的下好了
```

两条记录并存，正好对应「实际成功 + 界面报错」。

**根因**

`vrDownloadWithName()` 在 **FSA 直写成功**时返回的不是 downloadId（数字），而是一个对象：

```js
return { __fsa: true, path: r.path };   // background.js:600
```

但 `vrVideoDownload` 的通用 URL 分支没有判断它，直接把对象丢给 `vrWaitDownload`：

```js
const id = await vrDownloadWithName(...);
if (id !== null) {                      // 对象 !== null，直接进
    const outcome = await vrWaitDownload(id, 2500);   // ← 拿对象当 id
```

`vrWaitDownload` 里 `chrome.downloads.search({ id: <object> })` 于是抛：

```
TypeError: Error at property 'id': Invalid type: expected integer, found object
```

异常一路冒到 `sendMessage` 的回调 → `res.ok` 为假 → `flash('warn')` → **叹号**。

**关键点**：文件其实已经由 FSA 直写落到目标目录了，**整个下载是成功的**，
只是返回值处理崩了。这就是「悄悄下载 + 报失败」的全部机制。

**为什么只有这条路径出问题**

仓库里另外 5 处都判了 `__fsa`（`905` / `931` / `2507` / `3457` / `3527`），
唯独 `vrVideoDownload` 的通用 URL 分支漏了。属于「同一约定没在所有调用点落实」。

**修复**

1. `vrVideoDownload` 补 `__fsa` 判断：直接按成功返回
   `{ ok: true, kind: 'fsa', filename, path }`，不再走 `vrWaitDownload`。
2. `vrWaitDownload` 加防御：`id` 不是数字就直接 `resolve(null)`。
   所有调用点的语义都是「只有 `interrupted` 才算失败」，返回 `null` 等同于「没有中断」，
   所以这个防御不会把真失败误判成成功。

**实测结果**

| 项 | 修前 | 修后 |
|---|---|---|
| 返回值 | `null`（异常抛出） | `{ ok: true, kind: 'fsa', filename, path }` |
| 按钮 | 红色叹号 | 完成态 |
| 文件落盘 | 14,592,126 字节（成功） | 14,592,126 字节（成功） |

**顺带发现（未在本条修）**

FSA 直写那条入库记录的 `platform` / `type` 为空，因为 `vrVideoDownload` 传的 `trace.platform`
取自 `meta.site`，而微博走的是 `generic` 站点分支拿到空值。
这会让新条目在资源库里缺平台/类型 —— 与 ADR-057 的 `type` 空串是同一类数据问题，
建议后续统一在 `vrVideoDownload` 里按 `tab.url` 推断平台后补进 `trace`。

**教训**：`vrDownloadWithName` 有两种成功形态（数字 id / `{__fsa}` 对象）。
凡是消费它的返回值，必须先区分这两者；判 `!== null` 是不够的。

---

## ADR-060 重复下载的根因：mediaUrl 在入库链路上被丢掉（2026-11-06）

- **日期**：2026-11-06 ｜ **状态**：✅ 已修并实测 ｜ **触发**：苏哥报「还是很多重复，点几下就出现几次」

**症状**：同一素材反复下载，库里堆 `(1)(2)(3)` 副本。

**实测数据（修复前，真实库）**

```
总 47 条 / 视频 27 条
mediaUrl 为空：27 / 27     ← 全部为空
sourceUrl 为空：9 / 27
pageUrl   为空：13 / 27
platform  为空：8 条
```

**根因：三层各自丢字段，链路从头到尾没把 mediaUrl 运到 DB**

1. `js/background.js` 的 `vrVideoDownload` 组 `trace` 时**只写了 `mediaUrl`，没写 `sourceUrl`**。
2. `js/library/save.js` 的 `ingest()` 构造入库 `info` 时**漏搬运 `mediaUrl`**（只搬了 `sourceUrl`）。
3. `js/library/sw-library.js` 的 `ingestDirect()` 的 `item` **根本没有 `mediaUrl` 字段**。

查重函数 `vrFindExistingMedia` 是这么比的：

```js
const vals = [vrCanonMediaUrl(e.sourceUrl), vrCanonMediaUrl(e.mediaUrl)].filter(Boolean);
if (key && vals.indexOf(key) >= 0) { return e; }
```

两侧都是空串 → `.filter(Boolean)` 直接把它们滤掉 → **永远匹配不到** → 每次都当新素材下载。

**为什么之前「看起来有查重」却没生效**

查重代码本身是对的，`vrMediaIdentity()` 的内存去重也在跑；
但只要跨会话/重启（内存表清空），就只剩依赖 DB 的 `vrFindExistingMedia` 这一条，
而它因为字段空而失效 —— 所以表现为「同一次会话内偶尔能拦，隔一会儿点又重复下」。

**第二个连带缺陷：入库路径缺 subdir 前缀**

FSA 落盘时 `relOut` 是剥掉根句柄那一层的（`微博/weibo.com/视频/a.mp4`），
但入库也用了这个值。`parseRelPath()` 期望首段是 `video-rod`：

```js
subdir: 微博          ← 把平台名当成了 subdir
platform: ''          ← 从第二段开始找，weibo.com 不在别名表 → 反解失败
```

于是 `platform`/`type` 兜底全空。

**修复**

| 文件 | 改动 |
|---|---|
| `js/background.js` | `trace` 补 `sourceUrl`、`type: 'video'`；`platform` 改为按 `pageUrl` 走 `VRPath.detectPlatform()`（原来取 `meta.site`，通用分支是空） |
| `js/library/save.js` | `ingest()` 搬运 `mediaUrl`；FSA 成功入库时用 `prefix + '/' + relOut` 作为 DB 路径（**落盘路径不变**，不多建目录） |
| `js/library/sw-library.js` | `ingestDirect()` 的 `item` 增加 `mediaUrl` |

**实测（修复后）**

| 项 | 结果 |
|---|---|
| 第一次下载 | `{ ok: true, kind: 'fsa' }` |
| 第二次下载 | `{ ok: true, skipped: true, reason: 'duplicate' }` |
| 新增条目数 | **1**（不是 2） |
| 新条目元数据 | `platform: weibo`、`type: video`、`sourceUrl/mediaUrl/pageUrl` 全有 |
| 单测 | test-save 49/49、test-path 57/57、test-thumbs-queue 17/17、test-weibo-album 113/113 |

**存量数据未修（如实记录）**

库里 47 条历史条目的 `mediaUrl` 仍为空 —— 本次修复只保证**新下载**不再丢字段。
要让存量也能查重，需要一次回填（重扫时按 relPath/文件名推断，或从下载记录反查）。
未做，因为存量条目的原始直链已经无从获取。

**教训**：查重失效不一定出在查重代码本身。
这次是**上游三个环节依次丢字段**，任何一层漏了，下游比对就永远是空对空。
加字段时要一路跟到 DB，不能只看函数「有传参」。

---

## ADR-061 站点即分类维度：站名优先，域名兜底（苏哥 2026-11-07）

- **日期**：2026-11-07 ｜ **状态**：✅ 已实施 ｜ **触发**：苏哥发截图问「为啥菜单栏不能兼容所有来源？」

**症状**：64 条素材里 25 条挤在左栏「01 网页」一个节点下，卡片徽标全是 `pixso.cn` / `huaban.com`。
新增网站必须改代码，否则永远进不了正确的分类。

**根因**：一级目录来自写死的 8 站平台字典（`path.js` 的 `PLATFORM_DIR`），
`detectPlatform()` 对一切未收录站点返回 `'web'`，于是全部落进「其他网页」。
站名信息其实一直存在（磁盘上是 `其他网页/huaban.com/图片/`），只是被压平了。

**决策**

1. **站点即分类维度**：一级目录由素材的真实来源站点决定，不来自白名单。
2. **站名优先级**：`手工改名(manual) > 预置(preset) > 自动学习(learned) > 可注册域名(host)`。
   - 预置压过自动学习，因为 B站 的 `og:site_name` 可能给 `bilibili`，不适合做目录；
   - 自动学习服务长尾：小网站不在表里，第一次下载就学会。
3. **站名只在有 DOM 的时刻抓**（下载那一刻），抓到的立即落 `chrome.storage.local.vrSiteNames`。
   重扫磁盘、迁移都没有页面可读，只能消费缓存。
4. **目录形态改为 `站点/作者[@ID]/`，不再写类型层**：
   图片和视频是同一内容的两种形态，分开放会让同一作者散在两处。
5. **多P / 多集单独一层**：`B站/影视飓风(@946974)/第1话 开场/`。
6. **同一网页的批量图收进标题文件夹**，文件名仍是 `日期_标题.ext`：
   苏哥 2026-11-07 明确否掉了「只留 01/02 序号」的方案——没有标题时
   沿用原有回退（站点名 → URL 末段 → 「图片」），不另外造名字。
7. **左栏 ≥5 条升一级，其余归「其他站点」**（苏哥拍板），避免长尾站点淹没侧栏。
8. **两个不同站点同名时双方都加域名后缀**：`图片站 (a.com)` / `图片站 (b.com)`，
   而不是「第一个保留原名」——后者会让已有目录在新增站点时突然改名。

**实现落点**

| 文件 | 职责 |
|---|---|
| `js/site-name.js` | 页面提取（og/meta/manifest/JSON-LD/title）、中英日韩噪音清洗、可注册域名 |
| `js/site-name-store.js` | `vrSiteNames` 缓存，内存镜像供同步读（`buildRelDir` 是同步的） |
| `js/library/site-names-preset.js` | 381 条预置站名，按 16 类组织 |
| `js/library/site-registry.js` | 单一真源：合并三层，`detect()` / `nameOf()` / `keyOfName()` |
| `js/library/path.js` | `siteOf()` 走 registry，`buildRelDir()` 用站名，`parseRelPath()` 双结构兼容 |
| `js/library/indexer.js` | `resolveSite()` 把老 `'web'` 条目按路径自动纠正 |

**实测（真实网络，2026-11-07）**

```
抓取成功 5/10：花瓣网(title) Pixso(og) 知乎(title) 豆瓣(title) GitHub(og)
回退预置 5/10：Pixabay(403) Unsplash(401) Dribbble(202) Behance(超时) 500px(失败)
```

**如实记录的限制**：Cloudflare 保护的站点 fetch 拿不到，只能靠预置表；
从没在本机打开过、又不在预置表里的站，显示域名。这是信息本身的上限，不伪装能解决。

**教训**：分类维度不能写进白名单。一旦「谁存在」由代码决定，就必然追不上真实世界的网站数量。
正确的做法是把「识别」和「显示名」分开：识别永远能做（有域名），显示名逐级降级。

---

## ADR-062 标签：数据层早就通了，缺的是「能用」的那一层（苏哥 2026-11-07）

**背景**

B-10 在 2026-10-19 就标了「已实现」，但那只做到了**能写**：
详情页能加/删标签、`patchFile({tags})` 能落库、重建索引 `mergeEntry` 保得住。
实际用起来却发现：**打完标签没法按标签找图**。左栏只有平台/作者/收藏夹，
标签只作为卡片底部一行小字出现，列表视图还会被 `.grid.list .tagrow{display:none}` 隐藏。
等于「能写不能用」。

**决策**

1. **左栏加标签区**，补上缺失的那一环（点击筛选）。
2. **多选=交集**，Ctrl/⌘ 点击叠加。默认点击是「换一个」，
   和平台节点的「唯一激活」心智一致；要多选才按修饰键。
3. **计数徽标**（booru 帖数计数）：标签右侧显示「有几张图」，数据来自
   `counts()/countsInScope()` 新增的 `tags` 字段。
4. **计数跟着当前范围走**：切到小红书后，标签显示的是该站下的张数。
   但**计数不按已选标签过滤** —— 否则选中「风景」后其它标签全变 0，
   就没法再叠加第二个标签了。这是本设计最容易踩的坑。
5. **标签默认折叠成一行**，点开就地展开。

**为什么折叠（这条是苏哥现场否掉我第一版的）**

我第一版把标签平铺在收藏下方，理由是「标签是筛选主力，藏起来每次都要多点一次」。
苏哥看到截图后直接否掉：**「标签不要这样放，会很乱的，占据了左侧太多空间」**。

他是对的，我错在把「收藏」和「标签」当成了同一类东西：
- 收藏实际只有 2 行（代码里 2026-11-06 已强制只留一个收藏夹），平铺毫无压力；
- 标签数量**随素材增长**，20 个标签就把左栏吃掉了。

所以最终形态是：**收藏平铺（2 行）+ 标签折叠（1 行）**。
折叠条上仍显示「共 N 个标签」和「正在筛选：风景 + 竖图」，
收起后不会让人不知道自己在看什么。

**为什么不用向上弹层**

弹层会遮住资源树，且「点开→找标签→点击→再关掉」是四步；
就地展开只有两步，展开后还能连续点多个标签叠加。

**实现要点**

- `S.tags` 用数组不用 Set：要按点击顺序稳定渲染，且能序列化进智能收藏夹。
- 标签**没有独立注册表**，只存在于素材条目的 `tags` 数组里。
  所以「新建标签」必须先勾选素材 —— 空标签在数据上不存在，
  这也是 booru 系的语义（标签是对素材的描述）。
- 改名/删除是遍历所有命中素材逐条 `patchFile`，改名后同一条内去重；
  删除只清标签，素材本身不动。

**踩到的坑**

平铺改造时删掉了 `#favNewBtn`（原来的「+」展开按钮），
但 `.fav-new{display:none}` 还在 —— 新建输入框变成**永久不可见**。
脚本能给它赋值、测试能过，人却看不见。实机截图才暴露。
已补 `.fav-side .fav-new,.tag-side .fav-new{display:flex}`。
教训：删掉控制显隐的按钮时，必须同步删掉它所控制的 `display:none`。

---

## ADR-063 未登录微博：文件名变成站点名 + 只能下一条（2026-11-07）

- **日期**：2026-11-07 ｜ **状态**：✅ 命名已修；「只一条」确认是站点登录墙，非扩展缺陷
- **触发**：苏哥报「未登录时微博只能下载一个视频，而且名字也不对」

**实测事实（2026-11-07）**

未登录访问 `weibo.com/newlogin` 或 `weibo.com/`，服务端 302 到：

```
https://passport.weibo.com/visitor/visitor?entry=miniblog&url=...
```

该页面：

| 项 | 值 |
|---|---|
| `<title>` | **`Sina Visitor System`** |
| `og:title` | 无 |
| `meta[name=author]` | 无 |
| `<video>` 元素 | **0 个** |

**问题一：名字不对（已修）**

微博没有专属命名规则，走 `SITES_RULES` 的通用 `extractArticle`，
它的兜底是 `doc.title` → 于是文件名变成 `Sina Visitor System.mp4`。

修复（**通用缺陷，不是微博特例**，符合 ADR-051「修通用通道」）：

1. `js/naming.js` 新增 `isUselessTitle()`：识别访客墙/登录墙/反爬页标题
   （`Sina Visitor System`、`Just a moment...`、`登录 - xxx`、`403/404`、`无标题` 等），
   命中就把标题留空，不再当作品名。
2. 新增 `isDegenerateName()` + `fallbackNameFromUrl()`：模板变量全空时，
   原来会落成只有扩展名的 `mp4`；现在按 **URL 末段 → 时间戳** 降级：
   - `.../o0/video123.mp4` → `video123.mp4`
   - `.../visitor/visitor` → `visitor.mp4`
   - 纯哈希/纯数字末段 → `media_<时间戳>.mp4`

**问题二：只能下一个（不是扩展缺陷）**

页面里 `video` 元素数量为 **0**，没有可嗅探的源。
未登录用户被站点挡在内容之外，扩展无法凭空生成视频列表。

> 能下到的那一个，推测是访客页残留或某个预告片直链；**未实机验证**，
> 因为当时 Edge 的 CDP 端口（9480）未开启。

**给用户的建议（写进文档，不改代码）**

需要批量下载微博内容时请先登录。未登录能做的只有「嗅探到什么下什么」，
而访客页没有内容可嗅探 —— 这是站点行为，不是工具能力缺失。

**测试**

`tools/test-naming.js` 新增 8 条：访客页/反爬页/登录页标题被清空、
正常标题不受影响、URL 末段兜底、纯哈希末段时间戳兜底。
结果 **51/51 通过**（原 43 条无回归）。

---

## ADR-064 视频清晰度统一走「分辨率优先」，不再盲信「正在播放」（2026-11-07）

- **日期**：2026-11-07 ｜ **状态**：✅ 已实施（57 条单测）
- **触发**：苏哥报「微博最多还是 720p」「每个视频大小一样，只嗅探了一个」
- **拆解总账**：`docs/COMPETITOR-EXTENSIONS.md`

**根因（两处，都在 `vrVideoOptions`）**

1. **排序把「正在播放」无条件置顶**
   ```js
   const ap = (playing && a.url === playing) ? 0 : 1;
   return (ap - bp) || ((b.size || 0) - (a.size || 0));
   ```
   微博信息流默认播 720p → 一键下载永远拿 720p。而代码注释写的是
   「通用站取体积最大的那条」，**注释与实现不一致**。
2. **补入当前播放时用 `list.unshift()`**，又把它压回第一位，二次破坏排序。

第三处：`VR_VIDEO_EXT` 不含 `m3u8`/`mpd`，HLS/DASH 流根本进不了候选列表。

**决策：清晰度规则统一收敛到 `js/video-quality.js`（纯函数，可单测）**

| 能力 | 来源扩展 | 做法 |
|---|---|---|
| `heightFromUrl` | 自研 + DownXVideo `parseDimensions` | `label=mp4_1080p` → `template=1922x1080` → `/1280x720/` → `hd/uhd` |
| `sortCandidates` | DownXVideo `compareVariants` | **height 降序 → size 降序 → 最后才偏好当前播放** |
| `parseHlsMaster` | Video Downloader Plus 4.0.0 | 解析 `RESOLUTION=` / `BANDWIDTH=`，相对地址补绝对 |
| `parseDashMpd` | Video Downloader Pro 0.1.11 | 解析 `<Representation>` 的 width/height/bandwidth，跳过纯音频 |
| `pickWeiboHdUrl` | 笃笃 0.16.14 | `mp4_hd_url > stream_url_hd > mp4_sd_url > stream_url` |

**三条硬约束（踩过的坑）**

1. **「正在播放」只能作最低优先级**：它代表「浏览器当前的省流选择」，不代表最高画质。
2. **MPD 属性解析必须带词边界**：`width` 会匹配到 `bandwidth="..."` 里的 width（单测 G2 固定）。
3. **微博 `statuses/show` 只对信息流有效**：`tv/show/1034:xxx` 的 id 传进去返回
   `error_code: 20101「该微博不存在」`（实测）。失败必须静默回落，不能阻断下载。
4. **小红书 `ci.xiaohongshu.com` 原图不能盲目优先**：实测同一域名下
   `1040g2sg...aq9kb9fo` → **200**，`1040g2sg...adll5k` → **404**。
   对方（小红书下载助手）靠 `probeImage` 逐个探测才没踩坑。
   我们的处理：**首选保持原有可用地址**，原图只作候选，HEAD 探测 200 才升级。
   不这么做等于每张图先白跑一次失败，比原来更慢（负优化）。
5. **SSR 快路径必须带 `xsec_token`**：不带 token 请求同一 URL 时
   `noteDetailMap[id]` 不存在（实测 `Cannot read properties of undefined`）。
   失败要无痕回退到「开标签页」老路，不能让原本能下的变成下不了。

**明确不抄**

- **Tubly 的云端代理解析**：它用 `cookies` 权限把 YouTube 登录态发到自家服务器换取 4K/8K 直链。
  Cookie 外传不可接受；我们本地已有 nsig/ssig 解密，能力上不需要。
- **Tubly 之外的「分段下载」已实现**：Range 并发 4 段（Chrono 用 5，扩展上下文取 4），
  仅在服务端声明 `Accept-Ranges` 且文件 ≥1MB 时启用，否则回退单次全量。
  见 `js/offscreen-fetch.js` 与 `docs/VIDEO-XHS-ENHANCEMENT.md` §四。

**YouTube 上限：已全部放开（苏哥 2026-11-08 拍板）**

> 「放开啊。不要限制。没必要限制容量之类。怎么下载是用户的事情，能不能下载是软件的事情。」

`js/yt/yt-download.js` 现在**不设画质过滤、不设容量拦截**：

| 项 | 曾经 | 现在 |
|---|---|---|
| 画质 | `MAX_HEIGHT` 1080 → 2160，超出的档位不显示 | 不过滤，接口给几档列几档 |
| 容量 | `MAX_TRACK_BYTES` 400MB → 700MB → 2GB，超过直接拒绝 | 不拦截，仅超 2GB 时提示「会久一点」 |

依据是实测（200MB Blob 构造后 JS 堆只涨 119MB，Blob 存磁盘 backing store），
「大文件必然 OOM」是没验证过的推断。所以 8K 也会正常列出。

**测试**

`tools/test-video-quality.js` **57/57**：分辨率解析（A）、排序（B）、同素材归组（C）、
标签（D）、微博 mid 与高清挑选（E）、HLS master（F）、DASH MPD（G）。

---

## ADR-065 图片收集补「源码通道」：抄收集通道，不抄下载内核（苏哥 2026-11-07）

- **日期**：2026-11-07 ｜ **状态**：✅ 已实施（69 条单测 + 实机验收）
- **触发**：苏哥要求「直接完成扩展的内容」——把星愿浏览器新装的两个扩展拆完并落地
- **拆解总账**：`docs/COMPETITOR-EXTENSIONS.md` §8.3 / §8.4

**对象**

| 扩展 | ID | 版本 |
|---|---|---|
| 图片下载器 | `flbolonkboilcbnohjlchlfgdalomdpl` | 4.0.0 |
| Download Master | `ameobllgfelffdengghkfoeagpohnhjk` | 2026.10.14.0 |

**核心发现：它们的下载内核极弱，值得抄的是「收集通道」**

Download Master 零分段、零续传、状态存 SW 内存、重试只有 1 次（且只在
`downloads.download` 同步拒绝时）。图片下载器只有单发 `downloads.download`。
**我们已有 FSA 直写 + 候选链回退 + 离屏兜底，下载内核比它们强，不该反向抄。**

真正缺的是它们「找地址」的广度。图片下载器的 `contentScript.js` 除
`<img>` / `srcset` / `background-image` 之外，还拿 `document.body.innerHTML`
跑一条正则，把**只写在脚本/JSON 里、DOM 上还没有 `<img>`** 的地址捞出来。
懒加载站点正是这种情况。

**决策一：移植源码正则通道（已落地）**

`js/lib-download-scan.js` → `extractUrlsFromHtml`，接进 `image-page.js` 的
`srcScan` 分支。抓到的地址标 `srcOnly:true`、尺寸记 0，由 UI 显示「尺寸未知」。

**原式只认 `https?://`，实机测试页 3 张只抓到 1 张**。补了两条分支：

1. `https?:` 前缀可选 → 兼容协议相对地址 `//cdn.x.com/a.jpg`
2. 单斜杠 `\/(?!\/)` → 兼容站内绝对路径 `/media/x.jpg`（真实站点 JSON 里最常见）

`(?!\/)` 保证不会把 `//host` 拆成单斜杠匹配，两个分支不打架。

**实机验收**（`test-site/src-only.html`：DOM 1 张 + 脚本 3 张）：
修正前 `srcCount=0`，修正后 **1 → 4 张**，`pass:true`。

**决策二：移植文件名推导链，接进导出（已落地）**

导出 CSV 的「文件名」列此前**恒为空字符串**（`buildExport` 收到 `name:''`），
一整列没信息。改用该推导链：丢弃 `php/asp/aspx/jsp` 这类动态脚本名、
非法字符转 `_`、去首尾点与空格、截 200。与 Download Master
`utils.getDownloadFilename` 同口径。

**决策三：全链接扫描只做模块，不接 UI（明确不做）**

`collectLinks`（`a[href]` 全量 + `video/audio/source/embed/object`）已实现并有单测，
但**没有接进侧边栏**。原因：我们的 `vrImgDownload` 会把白名单外的扩展名
一律强转 `jpg`（`VR_IMG_EXT_OK`），接上去等于**列出 PDF 却存成 .jpg**。

曾试探性地加过「扫描本页文件（PDF/压缩包/视频）」菜单项，随即撤掉——
`image.html` 里有按钮、JS 里没实现，那是死按钮，比没有这个功能更糟。

> 要做得先改 `vrImgDownload`：`type` 从硬编码 `'image'` 改为按扩展名推导，
> 白名单外走通用 `vrDownloadWithName`。这牵动路径/入库/重命名三处，单独立项。

**明确不抄**

| 它有的 | 为什么不抄 |
|---|---|
| iframe 递归注入 + postMessage 收回 | 我们是 `all_frames:false` 的既有边界（B-29），单独立项 |
| 图片上悬浮下载钮 | 我们走侧边栏清单；图上挂钮在长页面上会糊满屏幕 |
| 全链接扫描直连 UI | 见决策三，会产出扩展名错误的文件 |

**教训**：拆竞品要先分清「它比我强的地方」和「我比它强的地方」。
这两个扩展的下载内核明显弱于我们，如果照着抄会把已有的 FBS 直写/候选回退丢掉。
真正值钱的是那两行「别人没想到的收集渠道」。

---

## ADR-066 小红书禁止逐篇开关标签页 + YouTube 串行下载队列（2026-11-08）

- **日期**：2026-11-08 ｜ **状态**：✅ 已实施（26 条单测）
- **触发**：苏哥报「小红书频繁打开关闭页面触发风控」+「YouTube 只允许同时一个，不能列队吗」

### 一、小红书：全程复用一个标签页

**问题**：原实现每篇笔记 `tabs.create` → 等 18 秒 → 扫描 → `tabs.remove`。
小红书把「频繁开关页面」判定为机器行为，直接风控。

**决策**：**全程只开一个后台标签页，只改 URL 导航**。

```
旧：create → 等 → 扫 → remove          （每篇一轮，开关即风控信号）
新：create 一次 → 循环 { tabs.update(url) → 等渲染 → 扫 } → 结束时 remove 一次
```

**配套降机器特征**：
- 导航后停顿改为 **1.8~3.2 秒随机**（原固定 1.2 秒）
- 复用页建好后随机停 1.2~2 秒
- 队列结束后随机停 1.5~2.5 秒再关页

**边界**：复用页被用户手动关掉时，自动退回「新建一次」继续，不中断队列。

### 二、YouTube：串行下载队列

**决策**：同一时间只允许一个 YouTube 下载任务，其余排队。

**理由**：
1. 多个 4K 并发互相抢带宽，每个都极慢；
2. 同时对 `googlevideo` 开多条大流量连接更容易触发限流。

**实现**：`js/yt/yt-queue.js`，语义见 `docs/VIDEO-XHS-ENHANCEMENT.md` §六点五。
关键约束：

- 同一 videoId 正在跑或已排队 → 不重复入队
- 任务结束**三个信号任一**都要放行下一个：
  ① `vrYtClose`　② 进度广播 `done`　③ `chrome.tabs.onRemoved`
- **启动抛错必须继续下一个**，不能把队列堵死

**踩到的真 bug**：`release()` 最初只清 `active` 没调 `pump()`，
导致「释放后下一个永远是排队状态」。单测 B2~B6 固定了这条。

**不做持久化队列**：SW 被回收时队列会丢。这是**有意为之** ——
持久化会让「幽灵任务」永久卡住队列，用户重开页面重新入队更简单可靠。

### 三、单轨上限：从「拒绝」到「不设限」（同批，两步走）

**第一步（本次先做）**：`MAX_TRACK_BYTES` 从 700MB → **2048MB**。

**第二步（同日苏哥拍板后完成）**：**整个上限机制移除**。

> 「放开啊。不要限制。没必要限制容量之类。怎么下载是用户的事情，能不能下载是软件的事情。」

现在 `js/yt/yt-download.js` 里只剩下 `BIG_FILE_WARN`（2GB），
它的作用只是超过时提示一句「文件较大，下载和合并会久一点」，**不拦截**。

**依据（实测）**：构造 200MB Blob（50 段），Edge 157 里
**JS 堆只涨 119MB**（且主要是构造用 Uint8Array 未及时 GC），
Blob 本体不进 JS 堆 —— Chromium 存在磁盘 backing store。

所以「合并大文件必然 OOM」是误判。真正会爆的是「同时持有两份完整数据」的实现，
而我们的 `mergeBlobs` 用 `Blob.slice` 引用原片段，不复制数据。

> 直接后果：4K 视频（截图里 926MB）此前被 700MB 上限拒掉，现已可下；
> 8K 也不再被隐藏，能不能下由用户自己判断。

---

## ADR-067 YouTube 不再替用户选档：先给清单（含体积）再下，且随时可停（2026-11-08）

- **日期**：2026-11-08 ｜ **状态**：✅ 已实施（50 条单测）
- **触发**：苏哥实测 `https://youtu.be/91vZf7QNTpE`，点下载直接显示 **15.66 GB**；
  且**没有任何终止按钮**。

### 一、根因：是我上一轮放开上限时埋的

| 现象 | 根因 |
|---|---|
| 15.66 GB | `auto=1` 的语义是「后台模式、**自动最高画质**」，代码无条件 `el.qc.children[0].click()`。上一轮删掉 `MAX_HEIGHT=2160` 过滤后，第一档直接变成 8K 长视频 |
| 看不到选项 | `body.vr-auto > * { display:none }` 把整个界面藏了，用户从未有机会选 |
| 停不下来 | `fetchBytes()` 里的 `fetch()` 从未接过 `signal`，物理上无法中断 |

**教训**：放开限制前，要先确认「谁在替用户做决定」。

### 二、决策一：先问再下

`auto=1` 不再自动挑档，改为：

```
取到格式 → 查重 → 把档位列表（清晰度 + 体积）广播给 YouTube 页面
        → 浮层展示 → 用户点某一档 → 才真正开始下载
```

- 备选**全部列出**（含 8K），体积独立标注
- 体积拿不到时显示「大小未知」，不留空白（否则会被误读成 0）
- 已存在的视频先查重并跳过，避免重复拉一遍 15 GB

### 三、决策二：随时可停

`AbortController` 贯穿下载链路：

- `fetchBytes()` / `fetchStream()` 接受 `signal`，请求带 `init.signal`
- **abort 不能被误判成断流**：`loop()` 的 catch 先判 `isAborted()`，命中即抛，
  绝不进「续传/重试」分支（否则点了取消还在后台跑）
- 取消与失败在 UI 上区分：取消播「已取消」中性文案，不报红错
- 三个结束信号任一都要释放串行队列：`vrYtClose` / 进度 `done` / `tabs.onRemoved`

**顺序**：先通知下载页 abort，**再**释放队列位。
反过来的话，下一个任务会在当前连接还没断开时启动，两条大流量并存。

### 四、决策三：状态显式上报，不靠猜

浮层判断「是否在下载」原本只看 `pct`。但 `setMsg('准备链路…')` 这类阶段提示
没有百分比，导致那几个阶段看不到取消按钮。

改为下载页在广播里带 `busy: !!state.busy`，后台原样转发，浮层据此显示取消区。

**踩到的两个坑（都已修）**：

1. 用 `m.done === false` 判断「在下载」是错的 —— `setMsg` 的每条消息都带 `done:false`，
   会把刚渲染好的档位列表立刻清空
2. `lastOptions` 存的是整条消息对象，不是数组，判长度要写 `lastOptions.options.length`

### 五、纯逻辑抽离

新增 `js/yt/yt-options.js`（UMD，零依赖），配 `tools/test-yt-options.js` 50 条断言：

| 函数 | 职责 | 为什么必须测 |
|---|---|---|
| `sizeText()` | 体积格式化；0/负数/NaN → 「大小未知」 | 算错会让用户误判要下多少 |
| `qualityLabel()` | 4320→8K / 2880→5K / 2160→4K / 1440→2K / Np | 标签错 = 选错档 |
| `buildAll()` | 由格式构造档位列表（视频轨+音频轨体积合并） | 体积少算音频 = 显示偏小 |
| `indexOfKey()` | 按 key 找下标，找不到返回 -1 | 找错下标 = 点成别的档 |

下载页 `qlabel()` 与浮层体积兜底都改为调用该模块，避免两处实现漂移
（漂移的后果是「显示 4K 却下了 1080p」）。

---

## ADR-068 建立产出物与工作区物理边界：只加载 dist/，测试产物出仓（2026-11-08）

- **日期**：2026-11-08 ｜ **状态**：✅
- **背景**：`edge://extensions` 显示扩展体积 **1,405 MB**，而本体只有约 5 MB。
  根因不是文件大，是**没有物理边界**——加载目录 = 仓库根目录，于是 `.work/`（611 MB 测试 profile）、
  `deliverables/assets/`（109 MB 截图）、`.git/`（212 MB）全被算进扩展体积；
  同期上级目录还堆着 101 个测试 profile 目录，与仓库、备份混在一起。
- **决策**：
  1. **加载边界**：浏览器只加载 `dist/`，由 `tools/build-dist.js` 白名单生成，
     白名单按目录整拷而非按 `manifest.json` 枚举（`background.js` 存在大量 `importScripts`
     与动态注入，manifest 列不全）。`dist/` 进 `.gitignore`，禁止手工放文件。
  2. **工作区边界**：测试产物一律写仓库外 `..\work\`，脚本读 `VR_WORK` 环境变量、默认回退该路径，
     禁止硬编码 `.work`。
  3. **仓库边界**：只有被文档引用的截图可进 git 且单张 ≤300 KB；`assets/` 新增总量 ≤10 MB。
  4. **历史瘦身**：用 `git filter-repo` 从历史移除大截图（须先备份、先 dry-run）。
- **理由**：体积虚胖是症状，**"东西没有家"才是病**。不建立物理边界，
  下次跑一批 E2E 就会原样复发；而边界一旦写进规范 + 构建脚本自检，
  违规（dist 里出现 docs/tools）会当场报错而不是慢慢变胖。
- **落地**：`docs/ARTIFACT-MANAGEMENT.md`（规范，S 级）、`tools/build-dist.js`（构建 + 黑名单自检）；
  上级目录 101 个测试 profile 与调研残留已清理，登录态 profile 与旧仓库备份保留。
- **不做**：不重写源码历史、不合并提交；`.work/` 现存内容暂不强制迁移
  （29 个测试脚本仍引用它，迁移按下表分批做，见规范 §3.2 兼容说明）。

---

## ADR-069 收敛单写盘通道：批量下载一律走 SW `VRSave`（2026-11-08）

- **日期**：2026-11-08 ｜ **状态**：✅ 已拍板（苏哥选项 A）｜ **来源**：QA 审计 DEF-02，`deliverables/reviews/2026-11-08-QA审计报告.md`
- **背景**：小红书 A2 实测批量 50 张，物理落点分裂三处——13 张 FSA 直写 `小红书/`、5 张 SW 三段式 `xiaohongshu/(@id)/`、37 张浏览器下载器兜底落 Downloads 根（Chrome 147+ 丢弃 filename 目录前缀）。库内 37 条 relPath 与物理位置脱节；用户无任何提示。
- **决策**：
  1. popup 批量下载循环**不再直调** `chrome.downloads.download`，统一发 SW 消息走 `VRSave.saveFile`（FSA 优先）。
  2. 兜底下载器时，**relPath 记实际落点**（库根之外的文件 relPath 只保留可推导部分），并写 `pendingArchive:1`；入库不得假装已归档。
  3. 批量汇总 toast 如实区分：已归档 / 兜底落盘（待归档）/ 失败。
- **理由**：双通道是历史遗留（猫抓原循环 + 我们后加的 FSA 层），继续并存则归档语义永远不可信；单通道后「文件在哪」只有一个答案。
- **落地**：`Q-01`（设计定稿）→ `Q-02`（实现）→ `Q-03`（授权引导）；验收=隔离批量 20/20 落点一致 + A2 真实页复测。
- **不做**：不重写猫抓上游 `popup.js` 的下载函数本体（只改调用点/加消息通道），保留上游可合并性。

## ADR-070 relPath / absPath 语义定稿：实际落点 vs 归档意图（2026-11-08）

- **日期**：2026-11-08 ｜ **状态**：✅ 已拍板 ｜ **来源**：DEF-02 数据侧；`LIBRARY-PERSISTENCE-SPEC.md` 需同步
- **决策**：
  1. `absPath` = 文件**真实绝对路径**（唯一权威，预览/定位/删除都以它为准）。
  2. `relPath` = 相对库根的**实际**路径；文件不在库根下时不得伪造归档路径，写 `pendingArchive:1`。
  3. **缺失判定**以 `absPath` 存在性为准（重扫不得因 relPath 不在库根树内就标 missing）；relPath 仅用于归档展示与树聚合。
- **理由**：本轮用户看到大量「文件缺失」卡片，根因是 relPath（意图位）与 absPath（实际位）混用 + 重扫按 relPath 判缺失；两条语义必须分开。
- **落地**：`js/library/indexer.js`（缺失判定）+ `js/library/save.js`（回写实际位）+ `LIBRARY-PERSISTENCE-SPEC.md` 同步。

## ADR-071 详情页嗅探边界：只取本页主体素材（2026-11-08）

- **日期**：2026-11-08 ｜ **状态**：✅ 已拍板（先 XHS 白名单，通用启发式待评估）｜ **来源**：QA 审计 DEF-07
- **背景**：小红书详情页批量下载 51 行，混入「相关推荐」流其他笔记封面（内容与主题无关，仍用页面标题命名），用户无法分辨。
- **决策**：
  1. 详情页优先用**本页主体素材白名单**（小红书=`infoList` 推导的图片/视频地址集合）；命中即只取白名单。
  2. **无命中必须回退**当前嗅探逻辑（宁可混入，不可漏下）。
  3. 通用启发式（尺寸/视口/来源域过滤）仅作后续候选，不在本批实施。
- **验收**：A2 真实页重测，下载行数=笔记实际图片数、0 推荐流封面；其他站点回归不受影响（e2e-popup/e2e-overlay 全绿）。

---

## ADR-072 下载命名以页面 state 为权威源（popup + 面板双通道）（2026-11-08）

- **日期**：2026-11-08 ｜ **状态**：✅ 苏哥「开工」令执行 ｜ **来源**：`deliverables/reviews/2026-11-08-小红书三扩展拆解与修复方案.md` + `2026-11-08-小红书方案对抗性审计.md`（修正版 M-1/M-2/M-2b）
- **背景**：naming.js 的 DOM 选择器在小红书哈希 class 下全抓空 → 作者退回域名、标题退回页面标题（「91 张同名」根因）；面板通道（vrImg.batch）从来只有 document.title，作者字段是空头支票。SW 的 `vrXhsScanInPage` 早已从 `__INITIAL_STATE__` 精确取到 nickname/redId/title，但 popup/面板两条链路都没接。
- **决策**：
  1. `vrXhsScan` 消息支持显式 `tabId`（popup 是扩展页 `sender.tab` 恒空）。
  2. popup 批量（`vrRunBatchSw`）：详情页特征 URL 先取 state，**单点更新 `pageInfo.authorFull/creatorId/title`**，路径与文件名由既有链路自动继承；重算 downFileName 时**必须先清空**（vrFullPath 会把旧全路径当文件名套娃拼接——BUG-M2-1 fixture 实测抓出）并迁移去重键。
  3. 面板批量（`vrImgBatch`）：SW 侧同用 `vrXhsScanInTab(tid, '')`（**第二参数不能省略**——executeScript args 拒收 undefined，M-2b 首版踩坑实测）把权威 title/authorFull 注入每张图的 relPath。
  4. 边界：非详情页 / state 取不到 → 完整回退现状命名（不做半吊子猜测）。
- **理由**：三家同类扩展（小金薯/小红薯）取数全部依赖 state 路线；DOM 选择器是维护性最差的一种。我们 SW 已有现成能力，缺的只是接线（审计结论：接线错误，不是模块该换）。
- **验收**：`tools/qa-xhs-author-e2e.py` fixture 13/13（N2/N3b 双通道作者注入、N3c 标题文件名、N5 去重键迁移、N6 回退不污染）；真实 A2 页复测 ⬜ 待实例配额（NOT RUN，如实记录）。

## ADR-073 图片面板默认「全部」档，尺寸未知不静默丢（2026-11-08）

- **日期**：2026-11-08 ｜ **状态**：✅ 苏哥「开工」令执行 ｜ **来源**：同上（M-3）
- **背景**：小红书首页懒加载图 `naturalWidth=0`，`tierCounts` 对未知尺寸直接 continue（连 total 都不计）+ 面板默认档 100 → 「扫到 70 张、四档全显示 0、没得选只能全下」（苏哥截图实测）。`scanImages` 早已遵循「没解码不等于不存在」，档位层与之自相矛盾。
- **决策**：
  1. `tierCounts` 新增 `unknown` 计数，`total` 含未知尺寸条目。
  2. 面板默认档改为「全部」（tierMin=0，复用 `filterByTier` 既有 m<=0 早退分支——**不改 filterByTier 本体**，否则高档位会混入未知图）。
  3. 新增「未知」档按钮（tierMin=-2 面板 `currentList` 特判），懒加载图可单独筛出勾选。
  4. 「全部/未知」按钮计数走 `c.total/c.unknown` 特判（c 无 all 键）。
- **验收**：test-image-tier D8/D9/D10 新断言 + 60/60 全过；fixture N7a/b/c 3/3（shadow DOM 内按钮存在、all=3、默认选中）；离线全量无回归（skin 20/20、buttons 32/32）。

## ADR-074 回收站改为「索引状态 + 磁盘实体」，清空必须级联索引与缩略图（2026-11-09）

- **日期**：2026-11-09 ｜ **状态**：✅ 苏哥拍板「A+B 一次做完」｜ **修订**：ADR-033（保留磁盘批次目录，改真源与清空语义）
- **背景**：苏哥实测「删到回收站 → 清空 → 素材又回主页，文件没了但卡片和缩略图还在」。诊断见 `deliverables/reviews/2026-11-09-回收站清空失效诊断.md`：`empty()` 只删 `_回收站/` 目录、不碰索引与缩略图；`remove()` 先搬文件后删索引且无回滚；同一物理文件存在「有/无 `video-rod` 前缀」两条索引时删一条会留死卡；IDB `thumb` 表从未清理（`deleteThumbs` 存在但无人调用）。
- **决策**：
  1. **真源改为索引**：删到回收站 = 索引行打 `state='trashed'` + `trashBatch` + `trashedAt`（**不删行**）；`_manifest.json` 降级为跨浏览器备份（IDB 被清后按清单恢复，ADR-033 原意保留）。
  2. **清空/彻底删除一处做完**：删物理副本 → 删缩略图（IDB `t:<relPath>` + 磁盘 webp）→ 删索引行，函数幂等，半状态下次再点即收尾。
  3. **顺序按 freedesktop Trash 规范**：清单先写 pending → 搬文件 → 回写终态；每行「先打标 → 再搬 → 搬失败回滚打标」，宁可「标记了但文件还在」（sweep 自愈），不许「卡片在、文件没了」。
  4. **扫描不许复活**：`build()` 的 downloads / snapshot 源跳过 `trashed` 行；downloads 源里新出现的条目必须真实探盘；snapshot 源逐条探盘（快照只是线索，磁盘才是真相）；`reconcile()` 不对 trashed 行做存在性判定；快照 payload 不写 trashed 行。
  5. **启动对账 `VRTrash.sweep()`**：修三类脏数据 —— 死回收站条目（回收站里没有实体）、搬失败残留（文件其实还在原位）、前缀重复索引（保留带前缀那条并合并星标/标签）。只动索引，不动文件。
  6. **清空时清「幽灵行」**：与刚删条目 `absPath` 相同、磁盘上又确实没有的活跃行一并删掉（死卡的最后一环）。
  7. **搬运窗口保护**：删除时先打 `trashPending`，搬完再撤；`sweep()` 跳过带标记的行、且跳过 15 秒内刚打标的行。否则启动自愈正好撞上用户刚点的删除，会把「已打标、文件还没搬走」判成「文件还在原位」打回 ok，自己造出一张死卡（2026-11-09 压测复现并修复）。
  8. **空壳目录收尾**：文件搬进回收站后，从源目录往上删掉变空的目录（遇到非空即停，`_回收站`/`_library`/`_migration`/`_selftest` 顶层永不删）。资源管理器删文件会顺手收尾，这里对齐；否则删几十条之后素材夹里全是空目录（真实库实测 20+ 个）。
  9. 引用计数（`refCount` / `countBy` / `findBy`）一律排除 `trashed`：否则「最后一条活跃引用」永远判不出来，文件删不掉；删掉的东西重新下载也会被判成「库里已有」。
- **影响**：`js/library/{trash,db,indexer,dedup,app,sw-library}.js`。
- **验收**：`tools/cdp-trash-empty-repro.py` 18/18（含清空后 file store/IDB 缩略图双双归零、恢复一条、幂等清空、空壳目录收尾、三种扫描不复活）；`tools/cdp-trash-dup-index-test.py` 9/9（重复索引自愈 + 幽灵行清理 + 搬运窗口竞态）；`library-move-e2e` 9/9；`library-buttons-e2e` 29 按钮 0 JS 错误。

## ADR-075 发布物只认 HEAD：构建脚本强制拒绝脏工作区（2026-11-09）

- **日期**：2026-11-09 ｜ **状态**：✅ 苏哥「帮我把协作坑规范一下」｜ **修订**：ADR-068（加载边界不变，补构建纪律）
- **背景**：`dist/` 是所有会话共用的运行目录，且不进 git。谁带着未提交源码跑 `build-dist`，半成品就会被打进去并被浏览器加载，事后**没有任何 diff 可查**。2026-11-09 一天内两次抓到 dist 混入另一会话未提交的 `js/douyin-note.js` / `js/background.js`；此前还发生过「93MB 打包事故」同源问题（产物不可控）。
- **决策**：
  1. `tools/build-dist.js` 新增三道闸：裸跑遇「影响 dist 的未提交改动」→ **拒绝并列出文件**（exit 1）；`--allow-dirty` 才放行且打印清单；`--from-head` 用 `git worktree` 检出 HEAD 干净树构建（发布唯一正确姿势）。
  2. 新增 `--check`：逐文件比对 dist 与 HEAD，不一致列出差异并 exit 1，作为**部署前门禁**。
  3. `tools/pack-dist.js` 打包前自动跑 `--check`，不一致直接中止（`--allow-dirty` 仅供自测）。
  4. 规则写进 `docs/ARTIFACT-MANAGEMENT.md` §2.4 + README 安装段，脚本里也留了引用（写死在报错文案里）。
- **为什么不用 `git archive | tar`**：Windows GNU tar 把 `C:\…` 当远程主机（`Cannot connect to C: resolve failed`）；worktree 是 git 原生能力，不依赖 tar、不动工作区。
- **影响**：`tools/build-dist.js`、`tools/pack-dist.js`、`README.md`、`docs/ARTIFACT-MANAGEMENT.md`。
- **验收**：脏工作区裸跑被拒（列出 6 个文件）；`--allow-dirty --dry-run` 打印清单不落盘；`--from-head` 产出 166 文件且 `--check` 全等；人为塞一个 `dist/js/__tamper.js` → `--check` 报「多出」、`pack-dist` 中止；恢复后 `--check` 再次全等。
