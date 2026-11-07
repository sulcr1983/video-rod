# 图片侧边栏 + AIX/Fatkun 能力采纳清单

> 日期：2026-11-06 ｜ 级别：**S（实测可复现）** ｜ 配套：`DECISIONS.md` ADR-058
> 触发：苏哥「侧边点击打开就出现页面上的图片列表，有预览图，可以点选下载，选择都是默认下载」+
> 「先参考星愿浏览器新装的两个扩展，逆向和抄他们的功能」

---

## 一、逆向对象（星愿 = Twinkstar 的扩展目录）

扩展本体在 `C:\Users\Administrator\AppData\Local\Twinkstar\User Data\Default\Extensions\`，
manifest 未混淆、可直接读；两家的 JS 都是 webpack 产物，**靠 manifest + `_locales` + 目录结构 + CSS 类名反推**，不硬啃混淆代码。

| 扩展 | 目录 ID | 版本 | 读到的能力面 |
|---|---|---|---|
| **AIX 智能下载器** | `pljfekbkmmbkdfhddpebdlmfngigcohc` | 9.0.58 | `imagePage/`（tabs → filter-row → image-grid → action-bar）、尺寸滑块、站点图集表、下载管理、归类 router、**图片过滤（域名+正则）**、拖拽/框选/右键、`{NO001}` 模板、WEBP→JPG、打包、导出链接 |
| **Fatkun 图片批量下载** | `kmljkmnhnejpjbfmnpegkppbfjdeifim` | 5.1.6 | 图片网格 + 全选/反选 + 尺寸过滤 + 多页抓取 |

`css` 类名直接印证了布局：`.aix-image-grid` / `.aix-image-card` / `.aix-filter-row--slider` /
`.aix-slider-control` / `.aix-action-bar` / `.aix-tabs`。
`_locales/zh_CN/messages.json` 里能读出全部功能文案（EXELeftTitle「下载管理」、imgFilter 系列、router 系列、ruleDetail 系列）。

---

## 二、采纳与不采纳

| AIX/Fatkun 能力 | 我们的处理 | 理由 |
|---|---|---|
| imagePage 三栏布局 | ✅ 采纳，但按苏哥选的 **A 网格**（档位 + 两列 + 底栏） | 侧边栏只有 380px，三栏放不下 |
| 尺寸滑块（min/max） | ✅ 改为**档位 + 命中数量** | 滑块要用户猜该设多少；档位直接显示能选多少张 |
| 站点图集表 | ✅ 采纳 5 站（微博/豆瓣/堆糖/花瓣/图虫） | 其余站点多为单站特化，通用性差 |
| 下载管理（任务/进度/暂停/重试） | ✅ 采纳，**直读 `chrome.downloads`** | 自建任务表必然和浏览器不一致 |
| 图片过滤（域名+正则） | ✅ 采纳，黑名单语义 + 导入导出 | 实际诉求都是「某站的图永远别出现」 |
| 拖拽下载 / 框选 / 右键 | ✅ 采纳，框选需按 Alt | 无条件接管拖拽会和站点打架 |
| `{NO001}/{PAGETITLE}/{DATE}` | ✅ 采纳，映射到项目 `${...}` | 迁移用户不用改模板 |
| WEBP→JPG / 打包 / 导出链接 | ✅ 采纳；ZIP 用 **STORE 自实现**（零依赖） | 图片已压缩，再 deflate 收益≈0，不值得背 100KB 依赖 |
| **下载归类（按扩展名分目录）** | ❌ 不采纳 | 项目已有三段式目录（平台/博主/类型），按扩展名分会打架 |
| **评论页数翻页** | ❌ 不采纳 | 单站特化 |
| canvas 导出主路径 | ❌ 不采纳（沿用页面上下文 fetch） | 重编码丢字节，且我们已有防盗链方案 |

---

## 三、落地清单（文件 → 职责）

| 文件 | 类型 | 职责 | 单测 |
|---|---|---|---|
| `image.html` | 新增 | 侧边栏图片页（A 网格） | — |
| `css/image-page.css` | 新增 | 该页样式，token 取自 DESIGN-SYSTEM-STAGE | — |
| `js/image-page.js` | 新增 | 注入扫描 / 勾选 / 批量 / 预览 / 导出打包 / 翻页入口 | — |
| `js/album-sites.js` | 新增 | 五站适配表：识站 + 原图派生 + 分页规则（纯函数） | `test-album-sites.js` 50 |
| `js/album-export.js` | 新增 | CRC32 / ZIP STORE / txt·csv 导出 / 模板归一 / WEBP 判断 | `test-album-export.js` 50 |
| `js/img-filter.js` | 新增 | 域名 + 正则过滤规则（纯函数） | `test-img-filter.js` 47 |
| `js/image-drag.js` | 新增 | 拖拽接收区 + Alt 框选 | 端到端 |
| `downloads.html` / `css/downloads.css` / `js/downloads-page.js` | 新增 | 下载管理页（直读 chrome.downloads） | 端到端 |
| `js/background.js` | 改 | `vrImg.sidePanelPath` 消息、`vrAlbumPageLoop`（后台标签翻页）、右键两个新入口 | — |
| `js/naming.js` | 改 | AIX 占位符映射（含补零） | `test-naming.js` N9 |

---

## 四、实测数字（Edge 9480 + 测试站 18080）

| 项 | 结果 |
|---|---|
| 扫描（images.html） | 2 张，档位计数 小 2 / 中 2 / 大 0 / 超大 0，零报错 |
| 批量落盘 | 2 张，命名 `..._01.jpg` / `..._02.png`（修掉了同名） |
| 预览层取图 | `media/big-square.png`，**未**误取 `a[href]` 的 `detail.html` |
| 档位记忆 | `imgMinSize` 100 → 1200 落库，重开仍是「大 ≥1200」 |
| 翻页抓全 | 3 页 × 2 张 = **6 张全中**，`state=done`，起始页 URL 未被改动，后台标签自动关闭 |
| 导出 txt | 79 B，两行地址 |
| 打包 zip | 5329 B，`PK\x03\x04` … `PK\x05\x06` 结构合法 |
| 下载管理 | 99 条任务，筛选 82 完成 / 17 失败；进行中 16%→28% 实时增长 |
| 暂停 / 继续 | 暂停后 `st-paused` + 按钮变「继续」，继续后 `paused=false` |
| 过滤规则 UI | 添加 2 条落库一致；非法正则 `[` 就地报错不写入；停用/删除均正确 |
| 新交互 | 点图 `lbOpen=true` 且勾选不变；点圈只改勾选；全选 `dlBefore=99=dlAfter`（不下载） |
| 控制台 | 全程 **0 error** |

node 单测合计 **424 条全通过**（util 100 / batch 27 / tier 57 / settings 50 / naming 43 / sites 50 / export 50 / filter 47）。

---

## 五、踩坑记录（写进来免得重犯）

1. **`mergeSettings` 会把数组型设置转成数字** —— 对非布尔项一律 `parseIntRange`，新增的
   `imgFilterRules` 是数组，规则全丢。改为按默认值类型分派。
2. **暂停的下载在 Chrome 里 `state` 仍是 `in_progress`**，只有 `paused=true`。
   先判 `state` 会让暂停行显示「下载中」且没有「继续」按钮。
3. **AIX 占位符替换顺序** —— `{author}` 会命中 `${author}` 的括号部分留下孤零零的 `$`（一次打挂 11 条断言）；
   `${NO}` 会被 `{NO}` 命中变半截 `$7`。铁律：先换 `${...}`，AIX 正则加 `(?<!\$)`。
4. **跨域 CDN 不能按站点域名选派生规则** —— 页面在 weibo.com、图在 `wx1.sinaimg.cn`，
   先 `matchSite` 再查规则会全部落空。改为「站点规则优先，失败按 CDN 特征逐条试」。
5. **候选链首项可能是详情页** —— `collectCandidates` 第 ① 级取 `a[href]`，那可能是 `/detail.html`。
   必须先用 `isProbablyImage` 过滤，否则预览和下盘都指向网页。
6. **同页多图同名** —— 统一用页面标题时 `cover.jpg`/`sprite.png` 落成同名 `.jpg`/`.png`，改为 `_01/_02`。
7. **`imgHoverMinSize` 曾被误改成 500**（ADR 定 600），被 `test-image-settings.js` A1b 抓到。
8. **PowerShell/GBK 控制台打印 emoji 会 UnicodeEncodeError** —— 探测脚本要 `PYTHONIOENCODING=utf-8`，
   否则 `⧉` 直接让脚本崩掉（不是产品缺陷）。
9. **`image-batch.js` 的 `collectItems` 漏传 `minShow`**（2026-11-07 修，**真实用户可见**）：
   不传就落到默认 `MIN_SHOW(500)`（悬停按钮的克制门槛），而面板/侧边栏用 `PANEL_MIN_SHOW(48)`。
   结果 320px 的正文配图在「全部下载」时被静默漏掉 —— 确认条说 5 张，实际只落 4 张。
   **三处扫描口径必须一致**，这是本项目反复踩的同一类坑。
10. **批量下载的每张图共用同一标题**（2026-11-07 修，**真实用户可见**）：
    `title: pageTitle` 让 5 张图都叫 `日期_标题`，Chrome 只能加 `(1)(2)` 后缀，
    用户分不清哪张是哪张，去重表也会因文件名相同互相覆盖。改为 `标题_01`、`标题_02`（与侧边栏一致）。
11. **拖拽门槛错用悬停门槛**（2026-11-07 修）：`image-drag.js` 的 `dragstart`
    用了 `U.MIN_SHOW(500)`，导致 260px 的正文配图**拖不动**（实测接收区不出现）。
    拖拽是用户显式动作，应与框选/面板一致用 `PANEL_MIN_SHOW(48)`。
12. **`nearestCard` 一路上溯到 `<body>`**（2026-11-07 修）：下载名变成整段页面说明文字
    （实测 `20261107_真实尺寸（按短边）：480_300_...→_06.jpg`）。
    改为遇 `BODY/HTML` 返回 null，且要求容器里不只有这一张图。
13. **面板浮标数字不刷新**（2026-11-07 修）：`applySettings` 只在「关→开」时重建 UI，
    改 `imgMinSize` 后浮标仍显示旧张数。改为数值变化时单独 `scheduleCount()`（不重建，保住选中态）。
14. **侧边栏入口三重失效**（2026-11-07 修，用户报「点图标没反应」的根因）：
    ① `action.default_popup` 存在时 Chrome 把点击交给 popup，`openPanelOnActionClick` 完全不生效；
    ② `setPanelBehavior` 只在 `InitOptions` 里设一次，SW 冷启动后 `getPanelBehavior()` 读到 false；
    ③ 侧边栏里切页调 `window.close()` 会被静默忽略。三者都已修（详见 `DECISIONS.md` ADR-058 补记）。
15. **测试脚本硬编码了另一台机器的路径**：`D:\Users\liq21\...`（下载目录）与
    `E:/test/video-rod/test-site`（夹具根）在本机都不存在，导致「落盘 0 个文件」「夹具页不存在」
    这类**看起来像产品回归、其实是环境不匹配**的失败。已改为 `VR_*` 环境变量优先 + 仓库相对路径。
16. **尺寸档位在 0 张时被禁用，把用户锁死**（2026-11-07 用户报「大中小没法选」）：
    原逻辑 `n === 0 → disabled`。一旦当前档位是「大 ≥1200」而该档 0 张，
    三个更大的档位全灰、只剩当前这个可点，**再也切不回小档**。
    档位本质是筛选阈值，切过去是空列表也是明确结果，不该禁用。现已一律可点。
17. **预览层「下载这张」只加入已选集**（2026-11-07 用户报「应该直接下载」）：
    原实现是 `selected.add(key)` 然后等用户再去点底部按钮，多一步且让人以为没生效。
    现改为直接走单张 `vrImg.download`（复用 DNR 补 Referer / FSA 直写），
    按钮就地反馈「已保存 ✓ / 已存在 ✓」，并保持预览层打开以便连续看下一张。

18. **点图标打开侧边栏后嗅探不到图**（2026-11-07 用户报「打开上面的扩展页没嗅探到」，**真机复现**）：
    三个叠加原因，缺一不可：
    ① **`tabs.query({active:true,currentWindow:true})` 在侧边栏里返回的是侧边栏自己**（`image.html`），
       于是 `executeScript` 去扫扩展页 → 报 `Cannot access contents of url chrome-extension://...`
       → 静默得到 0 张。改为「当前窗口里 active 的**网页**标签（排除扩展页/chrome://），
       没有则取 `lastAccessed` 最大的」。
    ② **`scanImages` 丢弃未解码的图**：花瓣首页 557 张 `<img>` 里 540 张 `naturalWidth=0`（懒加载），
       一律 `continue` 导致几乎全被吞掉。改为「有 width/height 属性就用属性，都没有则标记 `undecoded` 收进来」。
    ③ **`scanInPage` 在工具模块未注入时静默 `return []`**，界面显示「0 张」让人以为页面真没图
       （实测该页有 82 张）。改为返回 `{__noUtil:true, imgs:N}`，界面提示「刷新一次即可」。
19. **档位过滤把尺寸未知的图全滤掉**：`shortSide(0,0)=0 < tierMin` 恒成立。
    配合上一条，扫描收进 182 张、界面却只剩 6 张。改为「尺寸未知的不参与档位过滤」，
    并新增「全部」档位（默认选中）作为兜底视图。
20. **花瓣原图派生匹配不到真实 URL**：列表页给的是 `..._fw480webp`（尺寸与格式连写、无点），
    原正则要求 `_fw\d+` 后跟可选 `.ext`，完全匹配不上 → 一张原图都派生不出来。
21. **大图预览空白**（2026-11-07 用户报「点击进去图片查看大图，没有大图」，真机复现）：
    截图里候选链显示的是 `https://huaban.com/pins/6019884…` —— **详情页地址被当成了原图**。
    根因在 `isProbablyImage`：它对「无扩展名的 http 地址」一律返回 true（本意是放行 `/img?id=1`
    这类动态图片），而花瓣详情页 `pins/<id>` 恰好也没有扩展名。
    修法：新增 `looksLikePage()`，按路径特征（`pins/photos/notes/status/detail/watch…`、
    末段纯数字 id、站根）排除明显的网页，再退回「无扩展名当图片」的宽容策略。
    实测修复后：`LB_SRC` 变成 `gd-hbimg-edge.huaban.com/..._fw1200webp`，
    `<img>` 的 `naturalWidth/naturalHeight = 1200 / 4800`，大图正常显示。
22. **侧边栏图片页没有任何通往资源库的入口**（2026-11-07 用户问「在这种图片网页，我想进入资源库，怎么进？」）：
    顶栏只有 刷新 / 图集 / 更多 / 切嗅探，`⋯` 菜单里只有导出与打包。
    现在 `⋯` 菜单顶部加了「打开资源库」「下载管理」两项，独立窗口打开，与 popup 同名入口行为一致。
23. **「一直在嗅探 / 需要刷新一次」**（2026-11-07 用户报，真机复现）：
    用户装好或更新扩展后，**已经打开的标签页不会重新注入 content_scripts**，
    于是 `self.VRImageUtil` 不存在，扫描只能返回「本页 0 张 + 请刷新」。
    让用户手动刷新不是解法——扩展自己就能补。
    现在 `scanInPage()` 先探测 `self.VRImageUtil` 是否存在，缺失就
    `executeScript({files:['js/lib-image-util.js']})` 补注入，再执行扫描
    （两者落在同一隔离世界，前者的 `self` 对后者可见）。
    实测：手动 `delete self.VRImageUtil` 制造未注入状态 → 打开侧边栏 → 扫描成功（2 张），
    事后 `typeof self.VRImageUtil === 'object'`，确认补注入生效。
24. **资源库入口藏得太深**（2026-11-07 用户：「光下载也没啥用，在上面扩展栏打开要显示资源库」）：
    资源库只在 `⋯` 菜单里，而那个菜单默认是折叠的，等于没有入口。
    现在顶栏加了常驻一级按钮 **▤**（`ipLibrary`，title「打开资源库（已下载的都在这里）」），
    与「⟳ 重扫 / ⧉ 图集 / ⋯ 更多 / ▶ 切嗅探」并列；点击以独立窗口打开 `library.html`。
    地址也可直接访问：`chrome-extension://<扩展ID>/library.html`。

---

## 六、剩余风险（已登记 BACKLOG）

- **B-27**：五站规则只有纯 URL 单测，**没有登录态真机样本**（豆瓣/花瓣/图虫的相册分页与真实原图尺寸待验）。
- **B-28**：清单的「已下载」是 URL 级去重，资源库是内容级（SHA-256）；去掉 resize 参数后同一张图会被当新图重下。
- **B-29**：框选/拖拽只绑主文档，iframe 内的图墙选不到。