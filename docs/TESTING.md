# 钓鱼竿 Video Rod — 测试策略与用例

> 版本：v1.3 ｜ 日期：2026-10-17 ｜ 状态：已确认
> v1.3 变更：M7 浅色重设计全量回归记录 + 3 条新测试环境限制（域名映射端口/flex item z-index/CDP 懒帧）。
> 原则：小项目不搞重型测试框架，**冒烟 + 关键路径 + 回归清单**三件套，每个用例都是大白话可执行的。

---

## 1. 测试策略

| 层 | 手段 | 工具 |
|---|---|---|
| 纯逻辑（起名引擎等） | Node 直接跑函数断言 | node |
| UI 原型 | 浏览器冒烟：无 JS 错误 + 交互有反馈 | chrome-devtools（已验证可行） |
| 扩展真机 | Load unpacked 装 Chrome，按用例表手测 | Chrome |
| 自动化边界 | chrome://extensions 的加载可用 CDP 合成点击 + 坐标填对话框（已验证 DOM 坐标可行）；日常测试以手测为主 | CDP + pyautogui（可选） |

**测试数据约定**：本地测试站 + 真实公开站点（B站公开视频、YouTube 公开播放列表、文章页、推特页）。不使用需要付费/登录的内容做常规回归，登录态单独验。

## 2. 测试环境

- Chrome 当前稳定版（MV3）
- 安装方式：`chrome://extensions` → 开发者模式 → 加载已解压
- 下载目录：默认 `Downloads/video-rod/`
- 网络：普通家用网络（不代理）

## 3. 测试用例表

### 3.1 智能起名（M0，验收门槛）

| # | 用例 | 步骤 | 期望 |
|---|---|---|---|
| N1 | 文章页取名 | 打开新闻文章页，看预填文件名 | 取文章大标题，无「_网站名」尾巴，无非法字符 |
| N2 | 推特页取名 | 打开推文页，看预填文件名 | 取推文正文，无「某人 在 X:」前缀、无引号、无 t.co 链接 |
| N3 | 作者前缀 | 推特/小红书页看文件名 | `昵称(@账号)_标题.ext` |
| N4 | 作者缺失 | 普通网页视频看文件名 | 无空下划线（`test.mp4` 而非 `_test.mp4`） |
| N5 | 超长截断 | 造一个 100 字标题 | 保留前 60 字 + 「…」 |
| N6 | 重名序号 | 同页两个同名文件 | 第二个变 `标题_01` |
| N7 | 认不出页面 | 打开无结构化信息的页面 | 退回网页标题，文件名干净 |
| N8 | 模板变量 | 设置改模板为 `${author}/${title}` 等组合 | 各变量正确填充，空段自动跳过 |

### 3.2 面板与交互（M1）

| # | 用例 | 期望 |
|---|---|---|
| U1 | 装扩展开视频页 | 面板列出全部媒体，卡片信息完整 |
| U2 | 类型筛选行 | 全部/视频/图片/流媒体 切换正确（原型已验证 2/7 等计数） |
| U3 | 文件名输入框 | 可随手改，所见即所得 |
| U4 | 目录 chip | 可改目录、有最近目录、可新建 |
| U5 | 清晰度下拉 | 默认「自动（最高）」，可手动改 |
| U6 | B站分P卡 | 「分P ×N」点击展开/收起，可逐个勾选 |
| U7 | 右键菜单 | 网页区域右键出「钓鱼竿下载这个视频」，触发下载 |
| U8 | 空状态 | 无媒体页面面板显示友好空态 |
| U9 | 标签切换 | 当前页/其他页/媒体控制切换后列表与底栏不串位 |
| U10 | 批量命名同名 | 多条套同一模板时自动 `_01`/`_02`，不覆盖 |

> M1 实测（2026-10-17，Chromium 149 有头，`tools/cdp-m1-test.py`）：U1-U5、U9、U10 通过；U6/U7 属 M3/M5 范围尚未接入，U8 空态由猫抓原生 `#Tips` 承担。

### 3.3 下载管线（M2）

| # | 用例 | 期望 |
|---|---|---|
| D1 | 单个视频下载 | 真实落进 `Downloads/video-rod/`，文件名=预填名 |
| D2 | 自动分目录 | 小红书/推特媒体进 `平台/作者/` 子目录 |
| D3 | 手动改目录 | 改成什么就进什么文件夹 |
| D4 | 批量 5 个 | 全部落盘，名字目录互不干扰，错峰不卡浏览器 |
| D5 | m3u8 合并 | 碎片拼成完整 MP4，可正常播放 |
| D6 | 清晰度自动最高 | 多档时下到的确为最高清晰度 |
| D7 | 去重 | 同一地址二次下载被跳过/提示 |
| D8 | 完成提示 | 批量完成后面板内 toast 汇报结果 |
| D9 | 下载中取消 | 取消后不影响队列其他项 |

### 3.4 图片批量（M5）

| # | 用例 | 期望 |
|---|---|---|
| I1 | 小红书图片页 | 扫出全部大图，滤掉头像/图标（<100×100） |
| I2 | 懒加载页 | 滚动后 MutationObserver 增量扫到新图 |
| I3 | srcset 最高清 | 取到 srcset 中最高分辨率版本 |
| I4 | 背景图 | CSS 背景图能被扫到 |
| I5 | 图片改名/目录/批量 | 与视频同款卡片能力 |

### 3.5 B站嗅探增强（M3，2026-10 改版：零签名对抗）

| # | 用例 | 期望 |
|---|---|---|
| B1 | 多P纪录片 | 面板列出全部分P（从页面读，不调 API），勾选全下 |
| B2 | DASH 合并 | 音视频流合并成完整 MP4（合并路线按 DESIGN §8），音画同步 |
| B3 | Referer | 请求带 www.bilibili.com Referer，无 403 |
| B4 | 登录态 | 大会员内容能下（浏览器能播放=嗅探即得） |
| B5 | 失效兜底 | 页面结构变化/分P读不到时退回纯嗅探结果，仍有得下 |
| B6 | 不碰签名 | 全程无 WBI 签名请求（新路线的红线，保证不触对抗） |

### 3.6 YouTube 验证（M4，2026-10 改版：降级，只验证不开发）

| # | 用例 | 期望 |
|---|---|---|
| Y1 | 公开视频 | 能抓到则下；抓不到明确标记「当前 YouTube 限制」，不死等 |
| Y2 | 播放列表 | 页面已加载条目尽量展开，只取已加载项 |
| Y3 | SABR 边界 | 记录哪些场景（清晰度/登录态）下必然抓不到——写进已知限制 |
| Y4 | 备选路（可选） | 若苏哥拍板 m3u8dl 外挂：验证 N_m3u8DL-RE 协议链路 |

### 3.7 合并隐私（M2/M3，审计新增）

| # | 用例 | 期望 |
|---|---|---|
| M1 | 合并路线开关 | 设置里能选 A/B/C 路线（⏳ 待苏哥拍板后实现） |
| M2 | 隐私知情 | 若走 A（在线FFmpeg），面板/文档明确告知「分片将上传远程服务器」 |

### 3.7 右键秒存与快捷键（M5）

| # | 用例 | 期望 |
|---|---|---|
| R1 | 视频右键秒存 | 不开面板直接落盘，名字目录正确 |
| R2 | 图片右键秒存 | 同上 |
| R3 | Alt+Shift+V | 任意页面唤起面板 |

## 4. 回归清单（每次大改动后跑一遍）

- [ ] 装扩展无报错（chrome://extensions 无错误徽标）
- [ ] 普通视频页嗅探正常（猫抓内核没被改坏）
- [ ] N1-N8 起名全过
- [ ] D1/D5 单下载 + m3u8 合并过
- [ ] B1-B6 嗅探增强 + 兜底过；Y1-Y3 YouTube 边界确认过
- [ ] 右键秒存、快捷键过
- [ ] 面板无 JS 报错（控制台干净）

## 5. 已知限制（提前认账）

| 限制 | 说明 |
|---|---|
| DRM 站点 | 爱奇艺/腾讯/Netflix 不做，只能录制兜底（P2） |
| Chrome 政策 | 大版本可能再禁 unpacked → 重装一次即可，配置不丢 |
| YouTube 抓取 | 2026 SABR/poToken 下纯扩展基本死局：公开视频能抓则抓，抓不到标记限制，不上签名对抗（ADR-019）；刚需走 m3u8dl 外挂备选路（⏳ 待苏哥定） |
| 在线FFmpeg 隐私 | 合并默认走猫抓远程服务（分片上传 bmmmd.com/94cat.com）→ DESIGN §8 三路线择一 |
| 站点 DOM 改版 | B站分P读取/页面识别失效 → 退回网页标题/纯嗅探兜底 |
| **Chrome 155 禁命令行装扩展** | 官方版（137+）已彻底忽略 `--load-extension`，加 `--disable-features=DisableLoadExtensionCommandLineSwitch` 也无效 → 自动化验证改用 Chromium / Chrome for Testing；用户手动「加载已解压的扩展程序」不受影响 |
| 扩展就绪前打开的页面 | 首次加载扩展时，已存在的标签页不会被嗅探 → 刷新一次页面即可（后续新开页面正常） |
| **复用旧标签页会导致嗅探为 0（测试脚手架的坑，非产品缺陷）** | 对已打开的后台标签页做导航/cache-bust，子资源全命中 HTTP 缓存，webRequest 不触发 → 嗅探结果 0 条。**测试必须新建标签页并在导航前 `Network.setCacheDisabled(true)`**（`tools/cdp_client.py` 的 `open_popup()` 已内建该处理） |
| **测试浏览器必须 `--no-proxy-server`** | 沙箱/CI 环境若设了 `HTTP_PROXY`，Chrome 会走代理，代理自己解析域名 → `--host-resolver-rules` 的 MAP 规则被绕过（表现为请求跑到公网、返回 Cloudflare 的 400）。域名映射类测试必须加 `--no-proxy-server` |
| **`chrome.runtime.reload()` 会弄丢命令行加载的扩展** | 对 `--load-extension` 装入的未打包扩展调 `runtime.reload()`，扩展直接消失（extId 变、service worker 没了）→ 改代码后必须重启浏览器，不能热重载 |
| **youtube.com 在 HSTS 预载列表** | 无法用 host-resolver 把 `youtube.com` 指到本地 HTTP 服务（会被强制升级 HTTPS）→ 用含 `youtube.com` 子串且未预载的域名（如 `notyoutube.com`）做离线等效验证 |
| **域名映射测试必须带端口** | `MAP notyoutube.com 127.0.0.1` 后访问 `http://notyoutube.com/`（80 端口）会被 Chromium「公网域名→私有 IP」防护拦成 `net::ERR_BLOCKED_BY_CLIENT`（页面根本不加载，嗅探 0 卡）→ 必须导航到 `http://notyoutube.com:18080/`。**症状是嗅探 0 卡时先看页面本身加载没有** |
| **flex item 的 z-index 不挑 position** | 猫抓 `popup.css` 给 `#down` 带了 `z-index:999`（原为 fixed 浮动底栏）；改成 static 文档流底栏后，作为 flex item 的 z-index 依然创建层叠上下文，把 setview(470)/drawer(460)/modal(450) 全压在脚下（底栏浮在设置视图上面）→ 换定位方式必须连 z-index 一起清（`z-index:auto`）。**验浮层遮挡只能用 elementFromPoint，不能只看 class** |
| **CDP 驱动的 popup 页 compositor 懒帧** | 有头 Chromium 里 CDP 创建的 popup 目标不主动产帧：① 打开后立即 `captureScreenshot` 会挂 60s 超时（重试/等待后恢复）② compositor 驱动的 transform 过渡不推进（`.setview.on` 的 class 加了但 computed transform 卡在 translateX(400px），关掉 class 也回不来）→ 测试脚本截图要 settle+retry，验浮层位置要显式 inline force（`transition:none;transform:none`）。**真实浏览器无此现象，非产品缺陷** |
| Firefox | 不承诺兼容（底座有 manifest 但不保证） |

## 6. 冒烟自测记录

- popup 原型 v5：chrome-devtools 冒烟 0 JS 错误（筛选切换/右键菜单/右键秒存/分P展开/无作者命名干净）✅
- **M1 面板（2026-10-17）：Chromium 149 + 测试站 127.0.0.1:18080，CDP 脚本自动断言** ✅
  - 卡片 2/2、徽章/规格/文件名/目录 chip 全对；HLS 页 2 条流媒体卡带清晰度下拉
  - 类型筛选互斥正确（点图片 → 全隐藏，计数 2/2/0/0）
  - 批量命名弹层 + 实时预览 + 同名 `_01` 去重
  - 智能起名：注入 naming.js 取到页面标题并套进文件名（emoji 按规则清除）
  - 设置/工具抽屉开合、标签三页切换、目录菜单翻转定位
  - 控制台 0 报错 0 异常

### M2 下载管线（2026-10-17 复验通过）

- 2 张卡批量下载 → 真落盘 `Downloads/video-rod/test.mp4`(29151B)、`test2.mp4`(121747B)
- 二次点「批量下载」被去重拦下：文件数不变，toast「批量完成：2 个文件已保存」
- 2 张卡同时打上「✓ 已完成」态
- 「清空下载记录」可清除 done 态
- 控制台 0 报错

### M3 B站分P（2026-10-17 通过）

- `bili-fake.html`（`__INITIAL_STATE__.videoData.pages` 12 个分P）→ 横幅出现「本页共 **12** 个分P」
- 展开 → 12 条 `vr-partrow` 全部渲染，按钮变「收起」；再点收起
- 非 B站页面（index/hls/images）不出现横幅（`fetchBiliParts` 返回 null）
- 控制台 0 报错

### M4 YouTube（2026-10-17 通过，离线等效）

- 用 `--host-resolver-rules="MAP notyoutube.com 127.0.0.1"` + `--no-proxy-server` 把含 `youtube.com` 子串的域名指到本地测试站
- 面板出现橙色警示横幅：「2026 起 YT 强制 SABR + poToken，纯扩展多半抓不到。能抓到就直接下；抓不到属已知限制，不折腾签名对抗。」
- 同页仍能正常嗅探到 1 张视频卡（证明横幅不阻塞嗅探）
- 非 YouTube 页面不出现该横幅

### M5 图片批量 / 右键秒存 / 快捷键（2026-10-17 通过）

- `images.html` 点「抓图」→ 弹层打开，**2 张**（cover.jpg 640×480、sprite.png 300×300）
  - 重复 URL 去重 ✓；16×16 小图按尺寸过滤 ✓；**加载失败的图（mp4 冒充 img）被过滤** ✓（本次新增）
  - 「全选」按钮改为状态化切换：全选 ↔ 全不选，标签随状态变
- 真落盘：`测试站 C：图片批量保存_01.jpg`(15324B)、`_02.png`(1037B)，命名走 `${title}_${index}`，toast「已保存 2 张图片到 video-rod/」
- **右键秒存**：调 `vrSaveContextMedia`（菜单点击的最终路径）→ `测试站 C：图片批量保存.jpg`(15324B) 落盘，名字由页面标题经模板生成
- **快捷键**：CDP 真实派发 Alt+Shift+V → `chrome.commands.onCommand('_execute_action')` 触发 → 面板页 `popup.html?tabId=…` 打开
- 控制台 0 报错

### M7 popup 浅色重设计整合（2026-10-17 全量回归通过）

- M1 断言集三页：index（2 卡）/ hls（2 卡 + 2 清晰度）/ **notyoutube.com:18080**（2 卡 + YT 横幅）——DOM 断言全过、控制台 0 报错；`bodyBg` 全白（浅色生效）
- M2 批量下载：2 卡真落盘（29151B/121747B）、二次点击去重 toast、完成态、自动清理
- M3 B站分P：12 分P 横幅 + 展开/收起 + 非 B 站页面不出现
- M5 图片批量：2 张有效图（640×480/300×300）、全选按钮状态化切换、真落盘 _01.jpg/_02.png + toast
- M5b 右键秒存 + 快捷键：`vrSaveContextMedia` 路径落盘 15324B；Alt+Shift+V 派发 → 面板打开
- **z 序专项**（本次新发现并修复）：elementFromPoint 验证设置视图/工具抽屉/命名弹层均完整盖住底栏（修复前底栏浮在设置视图上，根因是猫抓 `#down` 的 z-index:999 在 static flex item 上依然生效）
- 归档截图：`deliverables/assets/final-m7-{plain,settings,ytbanner,bili,imgmodal}.png`
- 新增脚本：`tools/cdp-m4-test.py`（M4 正式化，带端口导航）、`tools/probe-zorder.py`（z 序回归）、`tools/shot-m7-final.py`（归档截图，内建 settle+retry+浮层强制）

### 测试脚手架要点（复现测试必读）
1. 浏览器：Playwright 内置 Chromium 149（`chromium-1228`），Chrome 155 官方版不支持 `--load-extension`
2. 启动参数：`--remote-debugging-port=9226 --remote-debugging-address=127.0.0.1 --load-extension=<仓库> --no-proxy-server`；域名映射类再加 `--host-resolver-rules`
3. `tools/cdp_client.py` 的 `open_popup()` 已内建：清理旧标签页 → 新建前台标签页 → `Network.setCacheDisabled(true)` → 导航 → 开面板
4. 测试站在 `E:/test/download/test-site/`，`python -m http.server 18080`（M0 起就在跑，重启需重新起）
5. 改代码后**必须重启浏览器**（`runtime.reload()` 会丢扩展）
6. 跑下载类测试会写真实 `Downloads/video-rod/`，脚本测完自动清理本次新增文件


## 7. M8 文件名保护 星愿真机记录（2026-10-18 全链路通过）

> 环境：星愿浏览器 Twinkstar 11.4（Chromium 144.0.7559.110），苏哥主力浏览器、13 个扩展全装（含 XBD/CocoCut/Imageye 三个下载类）、登录态在位。脚本 `tools/test-x-name-fix.py`（三链路）+ `/tmp/regress.py`（加固回归）。

### 三链路验证（ADR-027）

| 链路 | 路径 | 结果 |
|---|---|---|
| A | popup 页 blob 下载 → hook 等 SW 记账 IPC → suggest | `E:/personal/Downloads/vr-fix-test/hook_*.txt` 分毫不差 |
| A2 | SW 内 `vrDownloadWithName` 网络 URL → suggest | `E:/personal/Downloads/vr-fix-test/swdirect_*.ico` 分毫不差 |
| B | 推文页点按钮 → `vrQuickDownX` → suggest | `E:/personal/Downloads/video-rod/唐十七呀(@m0ve0f).mp4` 29,359,763B，ffprobe：h264 2160×3840 + aac 双轨（最高画质预混流） |

- 加固回归：同 URL 双下载（keep-on-take + uniquify）→ `dup_*.ico` + `dup_* (1).ico` 双双落名
- 修复前对照：同环境 blob 下载落 `229b7e7c-825f-4d65-819a-ff4681bd8ec4.txt`（UUID 名，即 bug 症状）

### 逆向苏哥扩展的收获（2026-10-18，苏哥指示「看看有没有可抄袭的」）

- 星愿 13 个扩展里 3 个注册 `onDeterminingFilename`：**XBD**（`piibekljdlkbkdchicfdjpnaggolndif`，推特图片视频批量下载，写法最完整：URL 预记账 + byExtensionId 防火墙 + 三级文件名降级 Invalid filename 重试）、**CocoCut**（`ekhbcipncbkfpkaianbjbcbmfehjflpf`，纯 URL 记账、不认识的一律 `suggest()` 空过）、**Imageye**（`agionbommeaifngbhincahgmoflcikhm`，用临时目录标记识别自己的下载，确定文件名时再替换）
- 三家独立实现套路一致 → 采纳为 ADR-027 方案；XBD 的 `queueFilenameForUrl` / `takePendingFilenameForDownload` / `handleDeterminingFilename` 结构被完整借鉴

### 新坑（复现测试必读）

1. **星愿的钓鱼竿扩展 ID = `bilfgmaaplmlfgpmjfhdaillmnonjlbj`**（手动「加载已解压」，location 4，在 `Default/Secure Preferences` 里查——`Default/Preferences` 的 extensions.settings 是空的！）；多扩展环境 `find_ext_id` 会误匹配，必须按精确 ID 查 SW
2. **苏哥的浏览器下载目录 = `E:/personal/Downloads`**（不是 C 盘 Users 下）
3. **blob:/data: 下载的 IPC 记账赛跑**：不走网络的下载 onDeterminingFilename 几乎立即触发，popup 页 fire-and-forget 式 sendMessage 记账必输 → 必须等 SW 记账应答后再发起下载（hook v2 的核心修正）
4. **X 推文页懒加载**：新标签页打开后 ~10-15s article/video 才渲染，且要 `window.scrollBy` 滚动触发 video 懒加载，`.vr-xbtn` 才会注入；复用旧标签页 + Page.navigate 可能卡在 X 错误页（"Something went wrong"），必须新建标签页
5. **星愿浏览器必须 `run_in_background` 启动**：用 `&` 后台起的进程会被工具会话回收（端口 9223 静默死亡）；taskkill 全部进程后等 3-4 秒再带参重拉（老实例在跑时新启动的参数被单例锁吞掉）
6. **hook 检测假阴性**：popup.html 同时加载 `vr-download-hook.js`（`__vrNameHooked`）和 `popup-videorod.js` 的 `hookDownloadsApi`（`__vrHooked`），后者后包装会盖住前者的标记属性——检测 hook 是否装上要看功能（落盘名），不能看最外层 wrapper 的属性
7. 改扩展代码后星愿里重载：`chrome://extensions` → 找「钓鱼竿」卡片 → `#dev-reload-button`（shadow DOM 里，JS `el.click()` 可靠）；重载后 SW 里 `typeof vrDownloadWithName === 'function'` 可验证新代码上线

---

## 8. 本地资源库原型 v1.3 验收（2026-10-24）

> 对象：`deliverables/prototypes/library-prototype-v1.html` v1.3（方案见 `docs/LIBRARY-PLAN.md` v1.3）
> 方式：CDP 驱动本机 Chrome 打开 `file://` 原型，`Runtime.evaluate` 执行断言 + 收集 `Runtime.exceptionThrown` / `Log.entryAdded`
> 判定：**所有断言 PASS 且控制台 0 error/warning** 才算通过；截图另存 `deliverables/assets/`

### 8.1 断言分组（对应 LIBRARY-PLAN §9 验收 15–19）

| 组 | 覆盖 | 关键断言 |
|---|---|---|
| A 基础 | 渲染与数据 | 27 张卡片、初始 5 星标、标签下拉动态生成 |
| B 星标 | 四入口一致 | 卡片按钮、列表行、右键菜单、`F` 键；点星标不误开灯箱 |
| C 只看星标 | 叠加筛选 | 卡片数 == 星标数；按钮高亮；关闭后恢复全量 |
| D 标签筛选 | 动态集合 | 筛选后全部命中该标签；与星标/搜索互不重置 |
| E 键盘导航 | `J/K/Enter/F` | J/K 只高亮不打开；Enter 打开高亮项；F 切换星标；输入框内不触发 |
| F 灯箱缩略图带 | 同步 | 数量 == 图片数；当前项唯一高亮；点第 N 张后计数/主图/信息栏同步 |
| G 右键菜单 | 五项 + 星标 | 菜单出现、含"星标"项、Esc 关闭 |
| H 进度条气泡 | 时间换算 | 气泡出现、`mm:ss` 格式、不改变播放位置 |
| I 视频回归 | 自绘控件 | ↓ 切换、计数格式正确、Esc 关闭（防原生 controls 回归） |

### 8.2 已知限制（测试侧）

1. 视频样本走公网（MDN CC0，5.055 秒），首次加载可能需数秒——断言前先轮询 `readyState >= 1 && duration > 0`，最多等 30 秒
2. 图片样本走 `trae-api-cn.mchost.guru` 文生图接口，弱网会出现灰块（原型已有裂图兜底，不算失败）
3. 原型是单文件 `file://` 页面，与真实扩展页面的 CSP/权限行为不同——**§4.4 的 P0 探针不能由本测试替代**
4. **浏览器进程跑久了媒体管道会卡死**：表现为 `<video>` `networkState=2`、`readyState=0`、无 `error`，等待 30 秒也不恢复；本地文件与公网 URL 都一样卡。**重启浏览器即恢复**（不是产品缺陷，也不是网络问题）。同时 `Page.captureScreenshot` 也可能超时，同样重启解决。正常情况下视频约 10 秒内到 `readyState=4`

### 8.3 执行结果（2026-10-24）

- [x] A–I 全组跑通：**42/42 通过**，控制台 **0 error / 0 warning**
- 脚本：`tools/cdp-library-test.py`（端口用 `CDP` 环境变量覆盖，默认 `http://127.0.0.1:9333`）
- 截图：`deliverables/assets/library-v13-grid.png`、`library-v13-lightbox.png`、`library-v13-video.png`
- 环境：Chrome 155 + profile `.work/profiles/chrome-prototype`，视口 1440×900
- 首轮 2 项失败的根因是**测试脚本自身**，非产品缺陷：
  - S32 右键菜单：dispatch 前未清理上次菜单状态、未加 `cancelable:true`、未等一帧 → 已修
  - S38 时间气泡：`mousemove` 监听绑在 `#vSeek`（input）上，脚本却 dispatch 到父容器 `.vseek` → 已改为 dispatch 到 input

---

## 9. P0 探针实测记录（2026-10-24，全部通过）

> 对应 LIBRARY-PLAN §13.7。对象：`tools/probe-file-access/`（最小 MV3 扩展）。
> 目的：决定资源库读取走 `file://` 直读还是退化为 FSA。

### 9.1 环境

| 项 | 值 |
|---|---|
| 浏览器 | Chrome for Testing 147.0.7727.15（`C:\Users\XPENG\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe`） |
| 启动参数 | `--remote-debugging-port=9341 --user-data-dir=...\profiles\cft-147-probe --load-extension=...\tools\probe-file-access --disable-extensions-except=...` |
| 扩展 ID | `bjfplhnnaanfpgioicjlnenplcpdblnm` |
| 测试文件 | `.work\media\probe\probe.jpg`（3803 B）、`probe.mp4`（1,128,375 B，MDN CC0，5.055s） |
| 文件访问开关 | `chrome.extension.isAllowedFileSchemeAccess() === true` |

### 9.2 结果

| # | 探测 | 结果 | 实测值 |
|---|---|---|---|
| 1 | `<img src="file:///E:/test/_vr-probe-media/probe.jpg">` | ✅ 通过 | `naturalWidth=320`、`naturalHeight=200` |
| 2 | `<video src="file:///.../probe.mp4">` 播放 + seek | ✅ 通过 | `readyState=4`、`duration=5.055`；`currentTime` 设 2.0 → 读回 2.0 |
| 3 | `chrome.downloads.search({limit:5})` | ✅ 通过 | `filename="D:\Users\liq21\Downloads\vr-probe-record.txt"`（绝对路径），`exists=true` |

**总判定：PASS（3/3）**

### 9.3 新坑（复现测试必读）

1. **正式版 Chrome 137+ 移除了 `--load-extension`**：Chrome 155 上加 `--load-extension` 无效，加
   `--disable-features=DisableLoadExtensionCommandLineSwitch` 也无效 → 命令行加载扩展只能改用 **Chrome for Testing**。
   日常使用仍走 `chrome://extensions` → 开发者模式 → 加载已解压。
2. **`chrome://extensions-internals` 可读扩展真实 ID**：比 `Preferences` / `Secure Preferences` 更可靠（新版 Chrome 那两个文件里已查不到 unpacked 扩展）。
3. **unpacked 扩展 ID 不等于路径 SHA256 推算值**：实测推算出的两个候选 ID 都是错误页，必须以 `extensions-internals` 里的 `path` 为准。
4. **探针造的下载记录会落在 Chrome 默认下载目录**（本机为 `D:\Users\liq21\Downloads`），测试后需手动清理。
5. **Chrome for Testing 默认允许文件访问**（`isAllowedFileSchemeAccess=true`），正式版默认关闭——不能把探针环境结论直接当成"正式版开箱即用"。
6. **临时目录已规范化**（2026-10-24）：本节当初的 `E:\test\_vr-probe-ct` 与 `E:\test\_vr-probe-media`
   已归入项目内的 `.work/profiles/cft-147-probe` 与 `.work/media/probe`（`.work/` 不进 git、可整体删除）。
   仓库外不再保留本项目文件，规则见 `deliverables/DELIVERABLES.md` §1.1。

---

## 10. S1a 三段中文目录验收（2026-10-24，17/17 通过）

> 对应 LIBRARY-PLAN §13.9 的 S1a：`path.js` + 下载落位 + 设置页「资源库」分区。

### 10.1 环境

| 项 | 值 |
|---|---|
| 浏览器 | Chrome for Testing 147（`--load-extension=E:\test\video-rod`，profile `.work/profiles/ext-test`） |
| 测试页 | `http://127.0.0.1:18080/index.html`（`test-site` 起 `python -m http.server`，视频夹具在 `test-site/media/`） |
| 下载根目录 | `D:\Users\liq21\Downloads`（由「校验落盘」实测得出，非猜测） |
| 脚本 | `tools/test-path.js`（48 条单测）、`tools/cdp-s1a-test.py`（17 条端到端） |

### 10.2 结果

| 组 | 断言 | 结果 |
|---|---|---|
| 单测 | 平台识别 / 类型推断 / 博主段 / 目录拼装 / 长度保护 / file:// 编码 | **48/48** |
| A 扩展 | 加载成功、SW 就绪 | 1/1 |
| B 设置页 | 分区存在、`VRSettings` 挂载、导航入口、子目录默认值、迁移按钮禁用、**校验落盘通过**、根目录显示 | 7/7 |
| C 落位 | 嗅探卡片、勾选、产生下载、**三段中文目录**、下载完成 | 6/6 |
| D 控制台 | 无 error / exception | 1/1 |

**实际落盘路径**：

```
D:\Users\liq21\Downloads\video-rod\其他网页\127.0.0.1\视频\test.mp4
└──── 下载根 ────┘└─ 子目录 ─┘└── 平台 ──┘└── 博主 ──┘└类型┘
```

### 10.3 已知点

1. **真机只测了 web 平台**：本地测试站域名是 `127.0.0.1`，落到「其他网页/127.0.0.1」。B站/小红书/X/YouTube 的目录拼装由 `tools/test-path.js` 单测覆盖（4 个平台各有断言），未用域名映射做真机验证。
2. **「校验落盘」会留一个空目录**：`video-rod/_verify/` 里的文件已用 `downloads.removeFile` 删除，但目录本身保留。索引阶段需忽略 `_` 开头目录（与 `_回收站` 同一规则）。
3. **单卡下载按钮是 SVG**：CDP 合成点击不稳定，端到端测试改用「勾选 + 批量下载」入口，两条路径最终都走 `vrFullPath`，落位逻辑一致。
4. **FSA 拿不到绝对路径**：设置页「选择文件夹并授权」只能存句柄，自定义目录的完整路径要手填；「校验落盘」反推的才是真实路径。

---

## 11. 图片下载自动入库验收（2026-10-24，14/14 通过）

> 对应 IMAGE-AUTO-INDEX-RESEARCH 的「预登记 + 完成确认」链路：`js/library/db.js`（IDB 索引）
> + `js/library/sw-library.js`（SW 侧记账与落库）+ `vrQueueFilename` 透传 meta + options 索引状态 UI。

### 11.1 环境

| 项 | 值 |
|---|---|
| 浏览器 | Chrome for Testing 147，**全新 profile** `.work/profiles/ext-test2` / `ext-test3`，调试端口 **9343 / 9344** |
| 测试页 | `http://127.0.0.1:18080/index.html`（`test-site` + `python -m http.server 18080`） |
| 下载根目录 | `D:\Users\liq21\Downloads\video-rod` |
| 脚本 | `tools/cdp-index-test.py`（`VR_CDP=http://127.0.0.1:9344`） |
| 单测 | `tools/test-path.js` **57/57**（新增 9 条 `parseRelPath` 往返断言） |
| 稳定性 | 连跑 **3 轮全绿**（`ext-test2` 首次含 uniquify 改名场景；`ext-test3` 复跑两轮干净落盘） |

### 11.2 结果

| 组 | 断言 | 结果 |
|---|---|---|
| A 准备 | 扩展加载、`vrLib.clear` 后 count=0 | 2/2 |
| B 嗅探 | popup 出现媒体卡片 | 1/1 |
| C 入库 | 下载完成 → 索引出现条目；relPath 含三段目录、platform=web、平台名「其他网页」、type=video、size>0、absPath 非空、fileName 非空、count=1 | 9/9 |
| C UI | `vrLib.added` 广播后设置页「已入库 1 条」+ 最近入库含该 relPath（无需手动刷新） | 1/1 |
| D 控制台 | 无 error / exception | 1/1 |

**入库实拍**（`chrome.downloads.onChanged → complete` 后由 SW 落 IDB）：

```json
{"relPath":"video-rod/其他网页/127.0.0.1/视频/test2 (1).mp4","platform":"web",
 "creatorFull":"127.0.0.1","type":"video","size":1128375,"mime":"video/mp4"}
```

### 11.3 本轮踩到并解决的坑

1. **SW 脚本缓存**：旧 profile（`.work/profiles/ext-test`）上运行的仍是缓存版 background —— `VRDB`/`VRLib` undefined、`vrQueueFilename.length=3`（旧签名）。
   `chrome://serviceworker-internals` 重注册、扩展重载均无效；**换全新 profile** 后立刻正常（`length=4`、`VRDB`/`VRLib` = object）。
   → **改 SW 引入的 importScripts 列表后，测试必须用新 profile**。
2. **运行期 `importScripts` 不可补救**：SW 已安装后再调 `importScripts()` 直接抛 `importScripts() of new scripts after service worker installation is not allowed`。
   所以 `background.js` 顶部那些 try 补载只对「首次求值已包含」的场景兜底，不能指望热补。
3. **`uniquify` 改名让相对路径算不出来**：`test2.mp4` 已存在 → 实际落盘 `test2 (1).mp4`，而预登记 meta 里的文件名是 `test2.mp4`。
   兜底逻辑：`detectedRoot` 缺失或前缀不匹配时，用「预登记 meta 的目录 + 实际 absPath 文件名」拼接相对路径——本轮 C2 就是用这条路径通过的。
4. **只认根目录内的下载**：`onChanged` 里算不出相对路径的下载直接忽略；反之落在 `video-rod` 根目录内、即使没预登记的也会收录（与 S2 全量扫描口径一致）。日常浏览器下载落在下载目录根部，不会被吸进资源库。

### 11.4 尚未覆盖

1. **图片/网址类下载未真机验证**：本轮只跑通视频（`type=video`）。图片链路的 `type=image`、EXIF/尺寸字段要等 I 系列（图片下载）落地后补测。
2. **缩略图未生成**：`thumb` store 已建但为空，懒缩略图由页面侧生成（SW 无 DOM），随 S2/灯箱一起做。
3. **SW 休眠恢复**：`chrome.storage.session` 存预登记表，理论上跨 SW 重启不丢；本轮 30 秒内完成下载，未构造「下载中途 SW 被杀」的极端场景。
4. **并发写入**：本次只有单条下载，多文件批量入库的 IDB 事务并发未压测。

### 11.5 对抗性复核加固（同轮补的两处）

| 隐患 | 触发条件 | 处理 |
|---|---|---|
| IDB 连接泄漏 / 版本升级被 blocked | 每次读写都 `indexedDB.open` 一条新连接，SW 长跑会累积；将来升 v2 会被老连接卡住 | `db.js` 缓存单条连接，`onversionchange` 主动关闭并置空 |
| 重下同名文件丢星标/标签 | `putFiles` 是覆盖写，`starred:0 / tags:[]` 会把用户之前标的星冲掉 | `sw-library.js` 落库前 `getFile(rel)` 读旧记录，保留非空 `starred`/`tags` |
| 未知 `vrLib.*` 动作无应答 | 消息前缀匹配上但 `handleMessage` 返回 false，调用方回调永不触发 | 统一回 `LIB_E_ACTION` 错误应答，并把预登记 key 按命中键删除（`url` / `finalUrl` 分别记账） |

---

## 12. S1b 迁移验收（2026-10-24，39/39 通过）

> 对应 LIBRARY-PLAN §13.10：`js/library/migrate.js`（引擎）+ `js/library/migrate-ui.js`（设置页面板）。
> 三种形态：改子目录名 / 换根（A↔B）/ 整理旧文件；统一 dry-run → 复制 → 校验 → 删源 → 日志 → 回滚。

### 12.1 环境与测试手法

| 项 | 值 |
|---|---|
| 浏览器 | Chrome for Testing 147，全新 profile `.work/profiles/ext-test4`，调试端口 **9345** |
| 脚本 | `tools/cdp-migrate-test.py`（`VR_CDP=http://127.0.0.1:9345`） |
| 目录来源 | **OPFS 句柄注入**：`navigator.storage.getDirectory()` 造真实 FSA 目录树，直接把句柄喂给 `VRMigrate` |
| 为什么这样做 | `showDirectoryPicker()` 是原生选择器，CDP 点不了；OPFS 走的是同一套 `createWritable` / `getFile` / `removeEntry` 代码路径 |
| 夹具 | `sub/clip.mp4`（2MB+123B）、`pic.jpg`（300KB+7B）、`note.part`、`readme.txt`、`_migration/log.json` |

### 12.2 结果（39 条）

| 组 | 断言 | 结果 |
|---|---|---|
| A 准备 | 扩展加载、VRMigrate/VRDB/VRSettings 已挂载 | 2/2 |
| B 预演 | 只列媒体文件、2 条可迁移、跳过/冲突/阻断为 0、总字节正确、**预演不改动文件** | 5/5 |
| C 执行 | 完成 2 条、未中止无失败、目标结构/大小一致、源媒体清空、非媒体与私有目录不动 | 6/6 |
| D 回滚 | 回滚成功、源复原、目标清空 | 3/3 |
| E 冲突 | 同名同大小 → skip；同名不同大小 → conflict；逐条动作正确 | 2/2 |
| F 改名 | 预演 1 条、目标路径正确、执行完成、新目录就位、旧目录清理、**索引 relPath 同步**、星标/标签保留 | 7/7 |
| G 整理 | 1 条可迁移（txt 不收）、三段路径正确、执行完成、文件落位、源删且非媒体保留 | 5/5 |
| H 校验 | 同文件通过、内容不同被拒、截断被拒 | 3/3 |
| I 面板 | 按钮可用、面板展开、三种方式、未预演禁用执行、缺目录给引导文案 | 5/5 |
| J 控制台 | 无 error / exception | 1/1 |

### 12.3 本轮修掉的两个真 bug

1. **换根被误判成「路径未变」**：`classify()` 原本只看 `from === to` 就 skip。换根时两边相对路径本来就相同，导致整盘跳过（首轮 B2 得到 move=0 / skip=2）。
   修法：只有**同一个根**（`srcHandle === dstHandle`）时 `from === to` 才算路径未变。整理旧文件仍走同根判定。
2. **测试辅助函数 `exists()` 只查文件**：查 `_migration` 目录时永远 false（C6 假失败）。改为先 `getFileHandle` 再 `getDirectoryHandle`。属测试缺陷，非产品缺陷。

### 12.4 回归

| 套件 | 结果 |
|---|---|
| `tools/test-path.js` | **57/57** |
| `tools/cdp-s1a-test.py` | **17/17**（B5 断言从「迁移按钮禁用」改为「已启用」） |
| `tools/cdp-index-test.py` | **14/14** |
| `tools/cdp-migrate-test.py` | **39/39** |

### 12.5 尚未覆盖 / 已知边界

1. **原生目录选择器没走自动化**：`showDirectoryPicker()` 的授权弹窗只能人点。引擎与 IO 已用 OPFS 全覆盖，剩下的是「拿句柄」这一步。
2. **失败中止分支未构造真实场景**：配额不足 / 文件被占用无法在 OPFS 里稳定复现，靠代码路径保证「失败不删源」；`aborted` 分支只有设计保证。
3. **深度校验（SHA-256）未跑**：`deepVerify` 开关存在但测试未开（大文件读两遍成本高）。
4. **索引 absPath 依赖 `detectedRoot`**：没跑过「校验落盘」的 profile 里，迁移只更新 relPath，absPath 保留原值等 S2 校对。
5. **改子目录名会自动改设置里的 `subdir`**（仅 UI 层）；引擎本身不改设置，避免测试互相污染。

---

## 13. S2 索引服务验收（2026-10-24，35/35 通过）

### 13.1 环境与测试手法

| 项 | 值 |
|---|---|
| 浏览器 | Chrome for Testing 147（profile `.work/profiles/ext-test6`，端口 9346） |
| 测试站 | `python -m http.server 18080`（`test-site/`） |
| 句柄来源 | **OPFS** `navigator.storage.getDirectory()` 造树，`VRIndex.setRoot(handle, 'D:/DL/idx-root', 'video-rod')` 注入（同 §12 思路，绕开原生目录选择器） |
| downloads 源 | 真实下载 `http://127.0.0.1:18080/media/test.mp4` → `video-rod/其他网页/127.0.0.1/视频/idx-dl.mp4`；跑完 `removeFile` + `erase` |
| 命令 | `VR_CDP=http://127.0.0.1:9346 python tools/cdp-indexer-test.py` |

OPFS 树：`B站/影视飓风(@946974)/视频/a.mp4`、`…/图片/p.jpg`、`其他网页/site/音频/s.mp3`，外加 `readme.txt`、`_verify/x.mp4`、`_library/index-20260101.json`、`part.mp4.part`（均应被跳过）。

### 13.2 结果（35 条）

| 组 | 覆盖 | 通过 |
|---|---|---|
| A 模块/根绑定 | 模块加载、`setRoot` 返回 absRoot+prefix | 4/4 |
| B 全量扫描 | 3 个媒体文件、跳过私有/临时目录、星标标签保留、absPath 重算、元数据反解、state=ok | 6/6 |
| C 快照 | 命名 `index-YYYYMMDD.json`、version/count/subdir、含全部条目、清库后恢复 3 条、星标标签保留、absPath 重算 | 7/7 |
| D 缺失语义 | 扫描 2 条/标缺失 2 条、条目不删（总数 4）、状态正确、`reconcile` 命中 2 个缺失、不删条目 | 5/5 |
| E 设置页 | 三个按钮存在、重建有结果、写快照给出路径、状态行显示已入库 | 4/4 |
| F 无句柄降级 | full/snapshot 均报 `LIB_E_NO_PERM`，downloads 仍可用 | 3/3 |
| G downloads 源 | 真实下载→清库→重建：条目出现、relPath 带 `video-rod/` 前缀、absPath 用下载真名、platform/type 正确、size>0 | 5/5 |
| H 控制台 | 无 error / exception | 1/1 |

### 13.3 本轮修掉的真 bug

1. **`reconcile()` 把整个索引误标 missing**：索引 key 带 `subdir` 前缀（`video-rod/…`），而 FSA 句柄指向资源库根，直接拿 `relPath` 去 `getFile()` 必然找不到。修法：先 `stripPrefix(relPath, prefix)` 再查。首轮 D4 把 4 条全标 missing 暴露了它。
2. **测试手法坑（非产品 bug）**：用 `data:text/plain` 发下载，Chrome 会按 MIME 把 `.mp4` 改成 `.txt`，被媒体过滤掉 → downloads 源测出 0 条。改用测试站的 `media/test.mp4` 后正常。

### 13.4 回归

| 套件 | 结果 |
|---|---|
| `tools/test-path.js` | **57/57** |
| `tools/cdp-s1a-test.py` | **17/17** |
| `tools/cdp-index-test.py` | **14/14** |
| `tools/cdp-migrate-test.py` | **39/39** |
| `tools/cdp-indexer-test.py` | **35/35** |

### 13.5 尚未覆盖 / 已知边界

1. **原生目录选择器仍未自动化**：只验证了 OPFS 句柄注入，「用户点选目录拿句柄」这一步靠手动。
2. **1k 文件首屏性能未测**：S2 只测正确性；「1k 文件 < 2s」要等 S3 页面出来才有真实首屏。
3. **快照只保留 7 份的清理分支未单独断言**（代码路径简单，未构造 8 份）。
4. **downloads 上限 5000 的 `truncated` 分支未构造**（需要 5000 条下载记录）。
5. **B 模式（custom）的 downloads 源不可用**：新下载仍落系统下载目录，要等 `archive.js`；S2 只保证 A 模式（默认）可用。
