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

## 9. B站真实站点验收（2026-10-18，苏哥给的 BV1DVaZ6hEK6）

**环境**：星愿浏览器（Twinkstar 11.4 / Chromium 144），扩展 ID `bilfgmaaplmlfgpmjfhdaillmnonjlbj`，CDP 9223。

### 9.1 结论速览
| 能力 | 结果 | 证据 |
|---|---|---|
| 扩展安装/加载 | ✅ 通过 | SW 存在，`G.enable=true`，popup 版本 v2.7.2.1 |
| 页面加载与播放 | ✅ 通过 | `<video>` MSE 播放，readyState=4 |
| **B站嗅探** | ✅ **通过** | 面板「嗅探到 3 个」，3 张卡（`…-100026.m4s` 12.4MB 视频 / `…-30280.m4s` 2.1MB 音频），截图 `tools/bili-popup-proof.png` |
| 自定义文件名（M8） | ✅ 通过 | `chrome.downloads.search` 返回 `filename=E:\personal\Downloads\钓鱼竿B站片段测试_自定义名.m4s`（未被服务器名覆盖） |
| **实际下载 .m4s** | ❌ **被拒** | `state=interrupted, error=SERVER_FORBIDDEN` |
| 完整视频合并 | ❌ 未实现 | B站是 DASH（音视频分离 .m4s），M11 仅支持 HLS/m3u8 |

### 9.2 根因（如实认账）
1. **嗅探链路正常**：`webRequest.onResponseStarted` 抓到 `.m4s`（ext 白名单含 m4s，state=true），popup 正确渲染 3 卡。
2. **下载被 CDN 防盗链拦**：B站媒体 CDN（`*.bilivideo.com`）要求请求带 `Referer: https://www.bilibili.com/`，否则 403。`chrome.downloads.download` 无法自定义请求头 → `SERVER_FORBIDDEN`。
3. **离屏合并也不通**：`js/m3u8-merge.js` 的 `fetchBytes` 仅 `credentials:'include'`，**未带 Referer**；即便带，B站是 DASH 分片，不是 m3u8 列表，M11 现管线不适用。
4. 猫抓自带 `m3u8.js`/`mpd.js` 解析页**能**用 XHR 设 Referer，但那是「解析页」流程，非本扩展 M11 离屏流程。

### 9.3 已解决：完整视频下载（ADR-029，2026-10-18 同日打通）

苏哥提示「参考已在用的插件」→ 逆向 `b站视频下载助手`(pamdgobbggbpfpnadidipelihgkafiid v1.0.16)，
按 ADR-029 落地 **B站「完整视频」入口**（面板上方横幅 + 进度条）：

| # | 验收项 | 结果 |
|---|---|---|
| W1 | B站视频页自动弹出「完整视频（整段MP4，不用合并）」入口，带大小/格式 | ✅ `13.9MB · mp4720` |
| W2 | 点击后真实下载，文件落盘 `E:\personal\Downloads` | ✅ id 3751 `complete` |
| W3 | 文件名走用户命名模板（作者_标题） | ✅ `一瓶Vc_四位比例优越数值怪｜【恋爱的条件】—BESTie｜路演翻跳原相机不拉腿.mp4` |
| W4 | 文件完整可播（含音轨，无需音视频合并） | ✅ ffprobe：h264 1280×720 + aac，duration 190.523s，14,538,650 B |
| W5 | 面板进度条推进 | ✅ 3% → 50% → 100% |
| W6 | 记进下载历史/去重 | ✅ `markDownloaded()` → `vrDownloaded` 存储 |

**关键修复原理**：把取数与下载搬到**页面主世界**（`world:'MAIN'`），并向 playurl 要 `durl`（整段 MP4），
不再是「扩展后台下载被 CDN 拒」的那条路。详见 ADR-029。

### 9.5 已解决：1080P 高清路线（ADR-029 补记，2026-10-19）

苏哥质疑「别人可以在登录态下下载到最高清的，不是固定 720P」→ 成立。重新扫 `fnval × qn` 组合后
确认：**durl（整段MP4）与 DASH 的档位是分开给的，有的视频 durl 只到 720P 而 DASH 能给 1080P**。
于是横幅改成**两条路并列两个按钮**，谁高给谁：

| # | 验收项 | 结果 |
|---|---|---|
| H1 | 横幅同时显示标清/高清两档 | ✅ `13.9MB · 720P　｜　1080P（需合成，体积比标清大）` |
| H2 | 两个按钮分别绑定 durl / dash 路线 | ✅ `下载 720P · 快` / `下载 1080P · 高清` |
| H3 | 高清按钮触发 DASH 下载 + 页面内合成 + 落盘 | ✅ 73,698,485 B |
| H4 | 合成产物**画面+声音都在且可播** | ✅ ffprobe：h264 1080×1920 + aac 44100Hz/2ch，156.83s |
| H5 | 标清路线未被改动破坏（回归） | ✅ 14,538,650 B，h264 1280×720 + aac，190.52s |
| H6 | 合成耗时可接受 | ✅ 190s 视频约 1.4s（5710 画面帧 + 8205 声音帧） |
| H7 | 另一支竖屏视频复验 | ✅ 32,609,576 B，1080×1918，176.22s |

**合成踩坑（写下来避免重蹈）**：mp4box **不能** `appendBuffer(视频)+appendBuffer(音频)` 直接导出——
它只保留第一个 moov（音频轨道丢失）且 mdat 载荷会被丢弃（导出只有 73KB 空壳）。
必须分别解析两个 m4s、按 `samples[i].offset/size` 从原始 buffer 切片取数据，再 `addTrack`+`addSample` 重建。

### 9.6 剩余限制（如实记录）
- **不支持子目录**：`<a download>` 只认文件名 → B站整段落 Downloads 根目录，不进 `video-rod/平台/`。
- **清晰度动态取最高**：请求 `qn=127`，显示 B站 实际返回档位；DASH 档位**不高于** durl 时只显示一个按钮（不做无意义的合成）。
- **DASH 不显示文件大小**：只给码率、按码率估会差一倍（实测预估 69MB / 实际 32MB），故不显示。
- **合成产物比源文件大约 5%**：每帧一个 moof 的分片开销（27.5MB → 28.9MB）。
- **合成产物帧数比源少 1 帧**（5709/8204 vs 5710/8205），ffprobe 有一条 `non monotonically increasing dts` 警告；
  全片 `ffmpeg -xerror` 解码无错误，播放无影响。
- **Chrome 可能拦截同一页面的多次自动下载**：`<a download>` 由脚本触发、不带真实用户手势。
  实测首次下载正常；连续多次下载建议刷新页面。真机测试脚本里用 `Browser.setDownloadBehavior` 放行。
- M3 plan 中的 B2（DASH 合并）**现已实现**（高清路线）。

## 10. 页内悬浮按钮 + 抖音取流（2026-10-19 真机，ADR-030/031）

### 10.1 页内悬浮下载按钮

| # | 验收项 | 结果 |
|---|---|---|
| O1 | 鼠标移到视频上出现下载按钮 | ✅ 抖音/B站/普通页均出现 |
| O2 | 按钮位于视频**右上角**、不遮挡播放器控件 | ✅ 抖音 1920×887：`right=1906`（距视频右缘 14px）、`top=76` |
| O3 | 覆盖层场景仍能命中（不用 `video.mouseenter`） | ✅ `document.mousemove` + 矩形判定；抖音播放器覆盖层不影响 |
| O4 | 清晰度菜单右对齐、不顶出屏幕 | ✅ 菜单 `right:0`，在按钮下方展开 |
| O5 | 全屏/滚出视口/切标签页自动收起 | ✅ 逻辑覆盖 |
| O6 | X/Twitter 不重复加按钮 | ✅ `video-overlay.js` 在 x.com/twitter.com 直接 return，走 `x-button.js` |

- 证据：`deliverables/assets/overlay-douyin.png`（右上角按钮实拍）。
- 脚本：`tools/overlay-pos.py`（B站位置诊断）、`tools/overlay-check.py`（通用站点体检）、`tools/test-video-overlay.py`（端到端）。
- 截图必须用 CDP `fromSurface:false`；`fromSurface:true` 在窗口被遮时会拍出白底破图残影（测试伪影，不是 UI）。

### 10.2 抖音命名与取流

| # | 验收项 | 结果 |
|---|---|---|
| D1 | 识别抖音站点 | ✅ `naming.js` 新增 `extractDouyin` + `douyin.com` 规则 |
| D2 | 作者昵称 + 抖音号进文件名 | ✅ `东方街拍(@22994771145)_...mp4` |
| D3 | 描述作为标题 | ✅ `放慢脚步，幸福会追上你！ #瑜伽裤穿搭 #散步随拍 #户外拍摄` |
| D4 | 不选错视频（详情页多 `<video>`） | ✅ 按 URL `/video/<id>` / `?modal_id=<id>` 调详情接口，不走嗅探缓存 |
| D5 | 一键最高清 | ✅ `bit_rate` 按短边分辨率降序；实测 2160P 档 |
| D6 | 下载落盘且含音轨 | ✅ hevc 2160×3840 + aac，16.35s，7,260,920 B |
| D7 | 大文件连续下载 | ✅ 99,973,037 B，`state=complete`，mime `video/mp4` |
| D8 | CDN Referer | ✅ 无 Referer 403；DNR set Referer/Origin 后 206 |
| D9 | 通用选流回归 | ✅ 「当前在播」优先、体积兜底；选项标注「当前播放」 |
| D10 | 起名引擎单测 | ✅ `node tools/test-naming.js` 32/32（新增 5 条抖音断言） |

- 详情接口：页面主世界同源 `GET /aweme/v1/web/aweme/detail/?aweme_id=<id>&aid=6383&device_platform=webapp`，返回 `status_code:0`、`aweme_detail.author.{nickname,unique_id,uid}`、`desc`、`video.bit_rate[]`。
- 下载请求头：`chrome.declarativeNetRequest.updateSessionRules` 规则 id `91001`，对 `douyinvod.com` set `referer`/`origin`，`resourceTypes:["other","media","xmlhttprequest","image"]`，10 分钟 alarm 清理。
- 通用直链：`vrSetMediaHeadersFor(pick.url, pageUrl)` 按目标 host 回放页面 Referer（CocoCut 同款通用能力）。

### 10.2b 微博下载（ADR-031 补记）

| # | 验收项 | 结果 |
|---|---|---|
| W1 | 微博视频被识别为当前播放 | ✅ `m.weibo.cn` 播放页拿到 `f.video.weibocdn.com/...mp4?label=mp4_hd` |
| W2 | 作者/正文进文件名 | ✅ `安然cn(@2042052593)_【阿塞拜疆的这个女孩说...….mp4` |
| W3 | 页面内 fetch → blob 下载成功 | ✅ `kind=page-blob`，5,817,304 B，`state=complete` |
| W4 | 音视频完整 | ✅ ffprobe：h264 **540×960** + aac，81.316s |
| W5 | 嗅探缓存为空时仍能下 | ✅ 当前 `currentSrc` 直接补入选项（不依赖缓存） |
| W6 | 页面 fetch 失败自动回退 | ✅ 回退 `downloads` + DNR Referer（抖音仍走专属分支） |

- 现象与根因：`chrome.downloads` 请求微博 CDN 返回 `SERVER_FORBIDDEN`（238 字节 HTML）；curl 对照「浏览器 UA + 无 Referer」= 403，「浏览器 UA + Referer」= 206。微博是 Referer ACL。
- 解法：页面主世界 `fetch(url, {credentials:'include'})` → `blob` → `<a download>`。页面请求天然带 Referer/Cookie，微博 CORS 允许（200/5.8MB）。与 B站 durl 同一成熟路线；CocoCut 也走页面/内容脚本 fetch。
- 取舍：`<a download>` 不支持子目录，微博文件落 `Downloads/` 根目录（与 B站 durl 同限制）。

### 10.4 微博主页半手动批量（ADR-033 P1）

| # | 验收项 | 结果 |
|---|---|---|
| B1 | 人工往下拉自动记录图片 | ✅ 主页滚动记录 4 张（缩略图转 `/large/` 大图） |
| B2 | 播放视频自动记录真实直链 | ✅ 第 5 项为视频，`currentSrc=f.video.weibocdn.com/...mp4` |
| B3 | 面板列表/全选/清空/保存按钮 | ✅ |
| B4 | 按 `作者(@UID)/` 建目录写盘 | ✅ OPFS 等价目录写入 125,443 B JPEG（原生目录选择待苏哥点一次确认） |
| B5 | 不自动翻页/滚动 | ✅ 只随用户滚动/播放记录 |
| B6 | 批量不受 Chrome 自动下载拦截 | ✅ 走 File System Access，不触发多次 `<a download>` |
| B7 | 微博 downloads/DNR 回退 | ❌ 仍 403，最终走页面 fetch/目录写入 |

- 模块：`js/bulk-profile.js`（manifest content script，微博域名）。
- 操作：右下角「批量下载 (N)」→ 勾选 →「保存到文件夹」→ 选一次目录（默认 Downloads）→ 按作者 UID 建子目录。
- 注意：原生目录选择器必须由用户点击触发；自动化只验证到 OPFS 等价写盘。

### 10.5 X 主页半手动批量（ADR-033 P1）

| # | 验收项 | 结果 |
|---|---|---|
| X1 | `/NASA/media` 自动记录视频 | ✅ 7 条视频（statusId/mediaId/poster） |
| X2 | 作者/文案提取 | ✅ `@NASA` + 推文正文，面板显示正确 |
| X3 | 忽略转载 | ✅ 有 `socialContext` 或 `ref.user != profileUser` 标记；真机测试页无转帖，逻辑待手动确认 |
| X4 | 忽略已下载 | ✅ `chrome.storage.local['vrBulkDone:x:<user>']`；写入后过滤（真机懒加载数量需手动确认），可「清除已下载」 |
| X5 | 只图片/只视频 + 反选 | ✅ 面板下拉/按钮 |
| X6 | 批量视频落盘 | ✅ `video-rod/NASA(@NASA)_TEST X BULK_01.mp4`，8,401,119 B |
| X7 | 批量图片落盘 | ✅ `video-rod/NASA(@NASA)_TEST X IMAGE_01.jpg`，232,912 B |
| X8 | X 单条按钮 mediaId 修复 | ✅ `/NASA/media` 按钮 4→7；单条下载 8,401,119 B |
| X9 | 稳妥模式/反爬 | ✅ 串行 1.4–2.6s 随机间隔、429/5xx 退避、连续 3 次失败暂停 |

- 视频保存：内容脚本按推文坐标请求后台 `vrResolveX` → fxtwitter 完整 MP4；图片 `pbs.twimg.com/media?name=orig`。
- 保存目录：File System Access 一次选目录 → `作者(@handle)/`；fallback 用 downloads + `video-rod/` 子目录。
- 注意：自动化下 `x.com/NASA/photo` 会被重定向，图片分支用合成 `article` 验证；X 主页懒加载导致过滤数量不稳定。

### 10.6 小红书详情页单篇（ADR-036 A 方案）

| # | 验收项 | 结果 |
|---|---|---|
| H1 | 详情页出现「当前笔记媒体」面板 | ✅ `/explore/6accad…?xsec_token=…` 面板 1 项 |
| H2 | 作者/文案 | ✅ 「小高今天找到工作了么」+ `#留学生找工作[话题]# #秋招[话题]#` |
| H3 | 图片落盘 | ✅ `video-rod/小红书/小高…(@5904068850c4b46b86967480)_…_01.webp`，64,510 B，image/webp |
| H4 | 限速/上限/失败暂停 | ✅ 3–5 秒随机、单次 20 条、连续 3 次失败暂停 |
| H5 | 不自动翻页/不做写操作 | ✅ 只读当前笔记 `__INITIAL_STATE__` |
| H6 | 视频分支 | 🟡 代码已支持 `video.media.stream`，当前测试笔记为图文，待视频笔记复验 |

- 页面 fetch 被 CORS 拒绝，下载走 `chrome.downloads`；原图（`url` 为空）与签名接口未做，当前为 `urlDefault` webp。
- 小红书页面自身有 hydration/脚本报错，与扩展无关。

### 10.7 下载去重（ADR-037）

| # | 验收项 | 结果 |
|---|---|---|
| DED1 | 同一批内重复媒体只下一次 | 🟡 代码已接入 `batch Set`，待真机重复项验证 |
| DED2 | 跨批次重复媒体不再下载 | 🟡 持久账本 `vrMediaSeen` 已接入，待重启扩展复验 |
| DED3 | 签名参数变化仍判定为同一媒体 | 🟡 标识已去 query/hash；待抖音/微博签名 URL 对照 |
| DED4 | 成功才写账本，失败可重试 | ✅ `seen.add` 仅在 `ok` 后执行 |
| DED5 | 内容相同但 URL 不同 | 📋 媒体库入库 SHA-256，待 P2 实施 |
| DED6 | 状态提示 | ✅ 返回 `skipped`，显示「跳过重复 N」 |

- 静态检查：`node --check js/background.js`、`js/bulk-profile.js` 通过。
- 去重键：`site | workId | mediaId | kind | origin+pathname`；不包含签名参数。
- 当前只覆盖主页批量；页内悬浮按钮单次下载尚未接账本。

### 10.3 复现与坑

- 星愿调试端口 `9223`；扩展 ID `bilfgmaaplmlfgpmjfhdaillmnonjlbj`；改代码后在 `chrome://extensions` 卡片里点 `#dev-reload-button` 重载，并**刷新抖音页**（内容脚本只在页面加载时注入）。
- 抖音详情页必须在已登录标签页里打开；CDP 新建标签会掉登录态/白页。`/video/<id>` 与 `?modal_id=<id>` 两种地址都要支持。
- 抖音 CDN 的 403 是**请求头**问题，不是 URL 失效：无 Referer 返回 `403 text/html`，带 `Referer: https://www.douyin.com/` 返回 `206 video/mp4`。
- 页面内 `fetch(currentSrc)` 会被 CORS/CSP 拦；`<a download>` 跨域时 `download` 属性会被忽略、变成导航。所以下载必须走 `chrome.downloads` + DNR 补 Referer。
- 详情接口失败时不要硬失败：回退通用嗅探分支，保证「永远有得下」。
