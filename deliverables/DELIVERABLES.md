# 钓鱼竿 Video Rod — 产出物管理规范

> 版本：v1.12 ｜ 日期：2026-10-19 ｜ 状态：✅ 已生效
> 一句话：**产出物有家、有版本、有状态、找得到。** 本文件是 deliverables/ 目录的宪法，新增任何产出物前先读这份。
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
| 决策记录 | `docs/DECISIONS.md` | v1.11 | 进行中 | ADR-001~036，追加式；ADR-030 = 页内悬浮按钮；ADR-031 = 抖音/微博取流与 Referer；ADR-032 = 暂不引入服务端代理；ADR-033 = 主页批量（微博/X P1 已实施）；ADR-034 = YouTube/Instagram 调研；ADR-035 = 媒体库（方案+原型完成，待实施）；ADR-036 = 小红书详情页单篇（A 方案已实施） |
| 媒体库方案 | `docs/MEDIA-LIBRARY-PLAN.md` | v1 | 评审中 | 固定目录（平台/博主@ID/图片|视频）+ index.json + 扩展托管 library.html；File System Access + IndexedDB；搜索/筛选/播放/CRUD/回收站；四期实施计划；参考 Eagle/PhotoPrism/Immich/Stash/XBD；§10 开源组件选型（PhotoSwipe/Plyr/Filebrowser/Immich…）；§11 大量博主/内容管理（懒加载/虚拟滚动/分片索引/游标分页） |
| 媒体库原型 v2 | `deliverables/prototypes/media-library-v2.html` | v1.0 | 评审中 | 资源树 平台→博主→图片/视频；独立图片/视频预览页；鼠标两侧箭头/底部胶片/滚轮缩放/双击/拖拽；键盘 ←→↑↓、Space、M、F、I、+/-/0、Esc、Home/End；树内搜索 + 每平台懒展开 |
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
| M3 B站分P横幅截图 | `deliverables/assets/m3-bili-banner.png` | 2026-10-17 | 已定稿 | M7 回归时重拍为浅色版（12 分P横幅 + 展开态），与 final-m7-bili.png 同内容 |
| M4 YouTube 限制横幅截图（深色版） | `deliverables/assets/m4-yt-banner.png` | 2026-10-17 | 已归档 | 离线等效验证（域名映射）下的橙色警示横幅；浅色版见 final-m7-ytbanner.png |
| M5 图片弹层截图 | `deliverables/assets/m5-img-modal.png` | 2026-10-17 | 已定稿 | M7 回归时重拍为浅色版（2 张有效图，坏图/小图/重复图已滤掉），与 final-m7-imgmodal.png 同内容 |
| HLS 流媒体回归截图（深色版） | `deliverables/assets/hls-regress.png` | 2026-10-17 | 已归档 | m3u8 双清晰度卡 + 清晰度下拉；浅色版回归由断言集覆盖（hls 页 cardCount=2/qualities=2） |
| M6 全功能回归截图（深色版） | `deliverables/assets/final-{m1,hls,yt}.png` | 2026-10-17 | 已归档 | M6 深色版三页实拍；M7 浅色化后由 final-m7-* 五态截图取代 |
| 测试站页面 | `test-site/{index,hls,bili-fake,images,yt-fake}.html` | 2026-10-17 | 已定稿 | 五类测试夹具：直链视频/HLS/B站分P/图片批量/YouTube（域名映射） |
| 右键秒存 + 快捷键 | `js/init.js` + `js/background.js` + `manifest.json` | v1.0 | 已定稿 | M5 产物；两个一级右键菜单 + `vrSaveContextMedia()` + Alt+Shift+V |
| README 使用说明 | `README.md` §使用说明 | v1.2 | 已定稿 | M6 产物：九节大白话完整指引；M7 随浅色重设计更新（行展开改名/抓图位置/设置视图四组 9 项+高级工具） |
| 测试策略文档 | `docs/TESTING.md` | v1.4 | 已定稿 | M6 产物：用例表+回归清单+M2–M5 冒烟记录；M7 补浅色重设计全量回归记录 + 3 条新测试环境限制；M8 §7 补文件名保护星愿真机三链路记录 + 7 条新坑（星愿扩展 ID/下载目录/blob IPC 赛跑/X 懒加载/后台启动/hook 假阴性/重载方式） |
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
| B站完整视频下载（M12） | `js/popup-videorod.js`(fetchBiliWhole/buildBiliWholeBanner/startBiliWhole/pollBiliWhole) + `css/videorod.css`(vr-banner-whole/vr-whole-prog) | v1.0 | 已定稿 | ADR-029 产物：主世界 executeScript 读 cid → playurl(不带fnval) 要 durl 整段MP4 → 页面 XHR blob → `<a download>` 存盘；命名走既有模板、历史走 markDownloaded；未改动 background/content-script。星愿真机 BV1DVaZ6hEK6 端到端通过（h264 1280×720 + aac，190.523s，14,538,650 B） |
| B站实站验收脚本 | `tools/bili-diag.py`、`tools/bili-netcap.py`、`tools/bili-correct.py`、`tools/bili-download.py`、`tools/bili-shot.py` | v1.0 | 已定稿 | B站实站：目标/网络抓包/对照 cacheData/下载与落盘/面板截图证据；`bili-popup-proof.png` 为嗅探证据截图 |
| B站 1080P 高清下载（DASH+合成） | `js/popup-videorod.js`(runBiliDash/resetBiliButtons/qShort/buildBiliWholeBanner) + `css/videorod.css`(vr-whole-btns/vr-whole-hd) + `lib/mp4box.all.min.js` | v1.0 | 已定稿 | ADR-029 补记：横幅并列「标清(durl) / 高清(DASH)」两按钮，仅当 DASH 档位更高才显示高清；高清路线向页面主世界注入 mp4box，分离解析画面/声音 m4s → 按样本切片取数据 → addTrack/addSample 重建 → `<a download>`。真机双路线通过：标清 14,538,650B/1280×720、高清 73,698,485B/1080×1920（另一支 32,609,576B/1080×1918），均含 aac 音轨 |
| B站双清晰度横幅截图 | `deliverables/assets/bili-1080-banner.png` | 2026-10-19 | 已定稿 | 面板实拍：「23.5MB · 720P ｜ 1080P（需合成，体积比标清大）」+ 深绿「下载 720P · 快」/ 橙色「下载 1080P · 高清」两按钮 |
| mp4box 合成库 | `lib/mp4box.all.min.js` | 0.5.2 | 已定稿 | gpac/mp4box.js，MIT；已在 `lib/third-party-libraries.md` 登记。仅高清路线注入，标清不加载 |
| mp4box 合成实验室 | `tools/bili-mux-lab.py` + `tools/mux-attempt.js` | v1.0 | 已定稿 | 缓冲缓存在页面(`window.__vrDash`)、合成代码单独放 JS，改算法不用重下 27MB；`VR_LIMIT` 限量模式、`VR_REFETCH` 强制重取。踩坑留证：appendBuffer 两文件不可行、getBuffer 才是导出方法 |
| B站清晰度扫描器 | `tools/bili-1080-probe.py` | v1.0 | 已定稿 | 扫 `fnval × qn` 组合，列出每条路是 durl 还是 dash、实际 quality/尺寸，用于判断「B站给不给 1080P」 |
| B站双路线端到端脚本 | `tools/test-bili-1080.py` | v1.0 | 已定稿 | `VR_MODE=durl/dash` 选路线：重载扩展→开 popup→读横幅→点按钮→盯进度→ffprobe 验落盘文件 |
| 页内悬浮下载按钮（ADR-030） | `js/video-overlay.js` + `manifest.json` content_scripts | v1.0 | 已定稿 | 全局一个 `position:fixed` 浮层；`document.mousemove` 60ms 节流 + 矩形命中（解决微博/抖音/B站覆盖层导致按钮不出现）；右上角定位、右缘 14px、top 让开 12%；主按钮 44×40 + 箭头 26×40；一键最高清/菜单选档；全屏隐藏；X 站让给 `x-button.js` |
| 主页半手动批量（ADR-033 P1 / ADR-036 A） | `js/bulk-profile.js` + `manifest.json` content_scripts + `js/background.js`(vrBulkDownload/vrResolveX/vrXhsScan) | v1.2 | 评审中 | 微博：滚动记录图片、播放记录视频；X：article 扫描图片/视频，作者/文案，视频走 fxtwitter；小红书：详情页只读 `__INITIAL_STATE__`，图片 WB_DFT/urlDefault、视频 stream；XBD 同款忽略转载/已下载、图片视频筛选、反选、清除；File System Access 按作者目录写盘（XHS 走 downloads `video-rod/小红书/`）；稳妥模式 1.4–2.6s（XHS 3–5s）+ 429/5xx 退避 + 连续 3 次失败暂停 |
| 抖音取流模块（ADR-031） | `js/douyin.js` + `js/background.js`(抖音分支/DNR) + `js/naming.js`(extractDouyin) | v1.1 | 已定稿 | 页面主世界同源 `aweme/v1/web/aweme/detail/`；URL `/video/<id>` 或 `?modal_id=<id>` 定位作品；按短边分辨率降序选最高档；DNR session rule set Referer/Origin 解决 CDN 403。v1.1 增加微博同类问题：通用直链优先页面 fetch→blob→`<a download>`，失败回退 downloads+DNR；微博 `$render_data` 取作者/正文命名 |
| B站取流模块 | `js/bili-whole.js` | v1.0 | 已定稿 | popup 与 SW 共用的 B站主世界取流核心（ADR-029/补记），从 `popup-videorod.js` 抽出；background `importScripts` 加载 |
| 悬浮按钮测试脚本 | `tools/overlay-pos.py`、`tools/overlay-check.py`、`tools/test-video-overlay.py`、`tools/shot-overlay.py` | v1.0 | 已定稿 | 位置诊断/通用站点体检/端到端验证/早期截图；CDP 截图统一 `fromSurface:false`，避免白底破图伪影 |
| 悬浮按钮截图 | `deliverables/assets/overlay-douyin.png` | 2026-10-19 | 已定稿 | 抖音 1920×887 实拍：按钮在右上角（right gap 14px、top 76px），不与播放器控件重叠 |
| 抖音/微博/X/小红书真机验收记录 | `docs/TESTING.md` §10 | v1.8 | 已定稿 | 按钮 O1-O6、抖音 D1-D10、微博 W1-W6、主页批量 B1-B7、X 主页 X1-X9、小红书 H1-H6；4K hevc+aac 7,260,920 B；99MB complete；微博 540×960+aac 5,817,304 B；X 视频 8,401,119 B、图片 232,912 B；小红书 webp 64,510 B；稳妥限速/失败暂停 |
