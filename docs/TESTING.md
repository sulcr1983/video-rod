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
8. **系统代理会骗过 curl 探活**：本机设了 `http_proxy=127.0.0.1:5576`，curl 探 `127.0.0.1:9223/18080` 会被代理截走报 "upstream connect failed"——探活要用 `curl --noproxy '*'` 或 `netstat -ano | grep :<port>`；但 `tools/cdp_client.py` 用 `ProxyHandler({})` 显式绕过代理，Python 测试连 CDP 不受影响。测试服务器（python -m http.server 18080）在本会话里反复无故退出，跑 M11 测试前务必 `netstat` 确认 18080 在监听，否则 sniff 全 0
9. **单例锁吞调试端口**：twinkstar 进程没清干净就带 `--remote-debugging-port=9223` 重拉，会报「另一个会话中打开」、调试端口不绑定；必须 `taskkill //F //IM twinkstar.exe` 全杀 + 删 `SingletonLock`（`AppData\Local\Twinkstar\User Data\SingletonLock`）+ 等 4-5 秒再拉

## 8. M9/M10/M11 星愿真机验收记录（2026-10-18）

### M9 下载历史面板（tools/test-m9-history.py，6 项全过）
- 下载完成后 `chrome.storage.local` 历史表写入（标题/来源/大小/时间/缩略图/状态）
- popup 设置抽屉历史入口可进；列表按时间分组渲染；缩略图显示；点重下复用既有下载管线；一键清空
- 待办：真实站点实测（装机后苏哥验）

### M10 侧边栏模式（tools/test-m10-sidepanel.py，7 项全过）
- `manifest.json` 加 `side_panel`；工具条按钮/右键菜单开侧边栏；窄宽 320px 适配
- 侧栏里下载走 `vrDownloadWithName` → 文件名保护不丢名（不复苏哥星愿 13 扩展冲突坑，ADR-027）
- 待办：真实站点实测

### M11 多段自动合并（tools/test-m11-automerge.py，5 项全过，ADR-028）
- 对抗：hls.html 双清晰度（master+变体）不误归组 → 徽标 0（PASS）
- 正向：multi.html 两段自动归组 → 徽标「2 段·将合并」→ 后台离屏直连管线合并 → 徽标「已拼好·点我保存」→ 点保存 → 「已保存」，落盘 `video-rod/split1.mp4`
- ffprobe 验：h264 640×360、duration 8.000s，有效（两段各 2 个 2 秒分片全拼对）
- 重构要点：删「驱动猫抓 m3u8 页」约 150 行；offscreen 文档内解析+下载+解密+转码；SW 仅编排+落盘（离屏无 `chrome.downloads`）
- 待办：**AES-128 解密仅在裸 TS 测试站验过，真实加密 HLS 未验**（真实站点多为 AES-128，漏了真机上拼乱码）；仅 HLS 不支持 DASH
