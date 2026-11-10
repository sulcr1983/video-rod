# 苏哥的钓鱼竿 — 测试策略与用例

> 版本：v1.9（合并版）｜ 日期：2026-11-04 ｜ 状态：已确认
> **本文件由两条开发线合并**：本地线 v1.4（2026-11-04）与远端线 v1.8（2026-10-25）。用例与验收记录一条不删，远端章节以「附」开头、编号自成体系。
> v1.9 变更（2026-11-04）：合并两条线；本地线 §8–§10 与远端线 §8–§26 并存。
> v1.4 变更（本地线）：§8 中 M9/M10 的「待办：真实站点实测」按实际结果回填关闭；待办状态统一迁至 `docs/BACKLOG.md`（唯一真源）。
> v1.8 变更（远端线）：I6 图集模式 A（§26；§24/§25 编号已被 I5 与发现度占用）；基线 21 套 / 614 条断言。
> 原则：小项目不搞重型测试框架，**冒烟 + 关键路径 + 回归清单**三件套，每个用例都是大白话可执行的。

> **⚠️ 路径口径变化（2026-11-08）**：本文 §8 之后的验收记录里出现的 `.work/...` 是**当时的历史路径**，保留原样作留证。
> 现行约定：测试产物一律写仓库外 `..\work\`，脚本通过 `tools/vr_testenv.py` 的
> `work_root()` 解析（优先级 `VR_WORK` > `..\work\` > `.work\` 兼容回退）。
> 规范见 [`ARTIFACT-MANAGEMENT.md`](ARTIFACT-MANAGEMENT.md) §3。

---

## 1. 测试策略

| 层 | 手段 | 工具 |
|---|---|---|
| 纯逻辑（起名引擎等） | Node 直接跑函数断言 | node |
| UI 原型 | 浏览器冒烟：无 JS 错误 + 交互有反馈 | chrome-devtools（已验证可行） |
| 扩展真机 | Load unpacked 装 Chrome，按用例表手测 | Chrome |
| 自动化边界 | chrome://extensions 的加载可用 CDP 合成点击 + 坐标填对话框（已验证 DOM 坐标可行）；日常测试以手测为主 | CDP + pyautogui（可选） |

**测试数据约定**：本地测试站 + 真实公开站点（B站公开视频、YouTube 公开播放列表、文章页、推特页）。不使用需要付费/登录的内容做常规回归，登录态单独验。

> **⚠️ 有头浏览器实例纪律（2026-11-10 苏哥拍板，所有会话 / 所有 e2e 必须遵守）**
>
> 1. **一轮任务只起一个实例**。多套 CDP 套件复用同一个隔离 Edge（固定端口 + 固定 `--user-data-dir`）串行跑完，禁止「一套脚本起一个浏览器」。前端有头模式 e2e 同样适用。
> 2. **两套库不混**：真实库实例用 `9480` + `D:/test/download/.edge-login-profile`；隔离套件必须另起 profile。凡是 `SETUP` 里 `VRDB.deleteFiles(all)` / `removeEntry(..., recursive)` 的脚本，**严禁**在真实 profile 上跑，否则清空真实索引。
> 3. **启动与测试写在同一条命令里**（Windows job object 会回收子进程），脚本用 `trap ... EXIT` 统一收工，不要靠「跑完想起来再关」。
> 4. **收工按实例精确回收**：优先发 CDP `Browser.close`（只关自己连的那个实例）；兜底也必须按自己 profile 的命令行关键字过滤后再 `Stop-Process`。**禁止 `taskkill /IM msedge.exe /F`**，也禁止用 Git Bash 的 `$!` 当 Windows PID（实测对不上，会留下 9 个孤儿进程），更不许误杀别的会话或苏哥自己的浏览器。
> 5. **收工必复核**：按 profile 关键字查一次进程数，确认 `left=0` 才算关干净；隔离 profile 目录随后删除。
> 6. 其它会话可能同时在跑有头 e2e，**只清理自己启动的那一个实例**，看到别的 Edge 进程一律不动。

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
| U7 | 右键菜单 | 网页区域右键出「苏哥的钓鱼竿下载这个视频」，触发下载 |
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

### 4.1 资源库持久化（2026-11-07 新增，670 条断言）

改 `js/library/` 下任何模块都要跑：

```bash
node tools/test-persistence.js     # 79  快照字段/root 自恢复/超限上报/缩略图失效判定
node tools/test-zip.js             # 40  zip 结构：CRC 标准向量、三个签名、UTF-8 名、偏移自洽
node tools/test-backup-restore.js  # 33  导出→解包→恢复全链路（含中文名与缩略图引用）
node tools/test-path.js            # 90  路径拼装与清洗
node tools/test-save.js            # 51  落盘模式决策与错误码
node tools/dedup-test.mjs          # 21  去重指纹与引用计数
```

**改字号/图标后另跑**（结构不能被样式改动破坏）：

```bash
python tools/e2e-all.py --isolated --only stage-rewrite
```

**改备份/恢复按钮后另跑**（需真实浏览器，会自己拉起隔离实例）：

```bash
python tools/e2e-backup-buttons.py --launch --port 9492   # 12/12
```

> 注：`e2e-backup-buttons.py` 会桩掉 `showDirectoryPicker` 并断言点击确实进入绑定逻辑；
> 真的弹原生目录框无法自动化，那是唯一需要真人补的一步。

### 4.2 图片侧边栏 / 下载扫描（2026-11-07 新增，69 条断言）

改 `js/lib-image-util.js`、`js/lib-download-scan.js`、`js/image-page.js` 后跑：

```bash
node tools/test-download-scan.js   # 69  移植自星愿两扩展：扩展名合法性/文件名清洗/全链接扫描/源码正则抓图/自定义过滤
node tools/test-image-util.js      # 108 图片扫描、候选链、尺寸档位、判定口径
node tools/test-image-batch.js     # 27  批量条目收集与命名
node tools/test-image-tier.js      # 57  尺寸档位统计
node tools/test-image-settings.js  # 50  设置项默认值与合并
node tools/test-img-filter.js      # 47  域名+正则过滤规则
node tools/test-album-sites.js     # 52  五站图集适配与原图派生
node tools/test-album-export.js    # 50  导出 txt/csv 与零依赖 ZIP
```

**源码抓图通道的验证页**（图片只写在脚本里，DOM 上没有 `<img>`）：

```bash
# 测试站起在 18080，然后打开
http://127.0.0.1:18080/src-only.html
```

> 验收口径：该页 DOM 只有 1 张图，源码通道应额外抓出 3 张（`original-1200.png`、
> `srcset-1200.png`、`i5-unique.png`）。少一张就说明正则又退回了「只认 `https?://`」的老写法
> ——单斜杠 `/media/x.jpg` 与协议相对 `//host/x.jpg` 必须都能抓到。

### 4.3 图片清单面板的 CSS 契约（2026-11-08 新增，11 条断言）

改 `js/image-panel.js` 的面板样式后必须跑：

```bash
node tools/test-panel-css.js       # 11  pointer-events 契约 + 四个关闭入口
```

> 为什么要有这条：宿主 host 写了 `pointer-events:none`，而它是**继承属性**，
> shadow 树里的面板会继承到 none —— 表现为「面板能打开，但 X、关闭、全选全都点不动」。
> 这类缺陷不是 JS 逻辑，普通单测抓不到；真机验证又慢又怕风控，所以用文本契约钉住：
> `.vr-panel.on` / `.vr-mask.on` 必须显式 `pointer-events:auto`。

### 4.4 抖音图文页图片入口（2026-11-09 新增，13 条断言）

改 `js/douyin.js`（noteFunc）、`js/douyin-note.js`、`js/background.js`（vrDouyinImages / vrImgBatch authorFull）、
`js/image-page.js`（扫描门槛 / 档位）后必须跑：

```bash
python tools/test-douyin-note.py      # 13  热重载 → 浮层按钮 → 点击终态文案 → 落盘 15 张 → 侧边栏扫描
```

> 三条口径必须同时成立，少一条就是回归：
> 1. 按钮张数 = Fiber `awemeInfo.images[]` 长度（不是 DOM 上的 `<img>` 数——图文页大图是 slide 的 background-image）；
> 2. 落盘走 **FSA 直写**，`chrome.downloads.search` 里**没有**条目，只能查磁盘；
> 3. 归档目录含作者段（`抖音/摄影师沙皮/<作品标题>/`），文件名带 `_01…_15` 序号。

### 4.5 下载去重链路（2026-11-09 新增，55 条断言）

改 `js/background.js`（vrCanonMediaUrl / vrImgDedupeKey / vrImgBatch / vrImgDownload）、
`js/library/dedup.js`、`js/library/indexer.js`、`js/library/trash.js`、`library.html` 后必须跑：

```bash
node tools/test-dedupe-key.js        # 19  归一键（抖音镜像/签名/tplv、小红书时间戳）+ compact
node tools/dedup-test.mjs            # 21  内容去重引用制（afterDownload / onDelete）
python tools/test-dedupe-live.py     # 15  同平台跳过 / 账本清空仍跳过 / 跨平台留一份 / 重建索引不丢指纹
```

> 三条口径必须同时成立：
> 1. 同平台换签名/换格式/换镜像 → `skipped=1` 且**文件数不变**；
> 2. 跨平台同图 → `skipped=0` 但**文件数不变**，库内多一条 `isRef=1`（引用）条目；
> 3. `VRIndex.build({mode:'downloads'})` 后，`sha256` / `isRef` / 条目数都不能减少
>    （FSA 直写素材没有下载记录，曾因此被整批抹掉）。
>
> 删除能力必须走 FSA：`fetch(file://, {method:'DELETE'})` 返回 ok 但**不删文件**（实测踩过）。

### 4.6 侧边栏尺寸档位布局（2026-11-09 新增，7 条断言）

改 `css/image-page.css` 的 `.ip-tiers` / `.ip-tier` 后必须跑：

```bash
node tools/test-tiers-css.js          # 7  换行 / 不隐藏溢出 / 不压缩 / 「全部」档不得被 100 兜底
python tools/test-sidebar-tiers.py    # 真机 390×780：5 个档位必须全部落在容器内（含「超大」）
```

> 背景：原来 `.ip-tiers` 是单行 nowrap + `overflow-x:auto` 且**隐藏滚动条**，
> 侧边栏 380px 放不下 5 个档位，「超大」被裁掉且没有可滚动提示（苏哥截图报过）。
> 契约钉死：档位行必须 `flex-wrap: wrap`，且 `allInside === true`。

### 4.7 内容级去重 / 作者段（2026-11-09 新增，27 条断言）

改 `js/background.js`（vrImgContentDedupe / vrResolveContentOrigin / vrImgBatch）、
`js/library/save.js`（resolveAbsPath / removeFile / 回传 relPath）、
`js/library/path.js`（作者兜底）后必须跑：

```bash
python tools/test-dedupe-content.py   # 12  同内容不同 URL / 同批同键 / 抖音图文作者段
python tools/test-dedupe-live.py      # 15  账本、库内来源键、跨平台留一份、重建索引
```

> 四条口径必须同时成立：
> 1. 同内容不同 URL → 物理**只留 1 份**，库里是「1 实体 + 1 引用」，引用 `refOf` 指向实体；
> 2. 同一批里同归一键 → 第二次直接计入「已存在跳过」，不落盘；
> 3. 抖音图文侧边栏批量 → 目录是 `抖音/<昵称>/…`，**不得**出现 `抖音/www.douyin.com/…`；
> 4. 删文件只走 `VRSave.removeFile`（FSA removeEntry + 复核）。
>    `fetch(file://,{method:'DELETE'})` 返回 ok 但不删文件，用它会造出「库说引用、盘上还在」。
> 5. `VRIndex.build()` 之后条目必须仍带 `sha256`（重建会补指纹）；
>    `downloads` 模式不得复活「文件已删、下载记录还在」的幽灵条目。
>
> ⚠️ 跑 e2e 时必须 `--isolated`：非隔离的 e2e 会清真实库（实测 72 条 → 9 条），
> 恢复方式是 `VRIndex.build({mode:'full'})` + `VRDedup.hashMissing()`。

### 4.8 侧边栏「未知尺寸」档（2026-11-09 新增，9 条断言）

改 `js/image-page.js` 的 `inTier` / `renderTiers` / 档位点击，或 `css/image-page.css`
的 `.ip-tier-unknown` / `.ip-tier-note` 后必须跑：

```bash
python tools/test-tier-unknown.py     # 9  未知档单独筛选 / 大图档不再混入未知 / 写回设置
node tools/test-tiers-css.js          # 7  档位行换行 / 不裁切契约
```

> 三条口径：
> 1. 「全部」含未知（懒加载站点整页图不能被吞）；
> 2. 具体尺寸档（小/中/大/超大）**只显示该档**，未知不混入；
> 3. 「未知」只显示没量出尺寸的图，且 `imgTierMin=-1` 要能存能读。

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
4. 测试站在 `D:/test/download/test-site/`，`python -m http.server 18080`（M0 起就在跑，重启需重新起）
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

1. **星愿里的苏哥的钓鱼竿扩展 ID = `bilfgmaaplmlfgpmjfhdaillmnonjlbj`**（手动「加载已解压」，location 4，在 `Default/Secure Preferences` 里查——`Default/Preferences` 的 extensions.settings 是空的！）；多扩展环境 `find_ext_id` 会误匹配，必须按精确 ID 查 SW
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
  - **后续状态（2026-11-04 追加）**：已关闭。星愿真机 6 项全过（记录写入/列表渲染/缩略图/重下/清空/设置入口），见 `docs/HANDOFF-20261019.md` §M9 与 BUILD-PLAN M9 检查站。

### M10 侧边栏模式（tools/test-m10-sidepanel.py，7 项全过）
- `manifest.json` 加 `side_panel`；工具条按钮/右键菜单开侧边栏；窄宽 320px 适配
- 侧栏里下载走 `vrDownloadWithName` → 文件名保护不丢名（不复苏哥星愿 13 扩展冲突坑，ADR-027）
- 待办：真实站点实测
  - **后续状态（2026-11-04 追加）**：已关闭。星愿真机 7 项全过，见 BUILD-PLAN M10 检查站。

### M11 多段自动合并（tools/test-m11-automerge.py，5 项全过，ADR-028）
- 对抗：hls.html 双清晰度（master+变体）不误归组 → 徽标 0（PASS）
- 正向：multi.html 两段自动归组 → 徽标「2 段·将合并」→ 后台离屏直连管线合并 → 徽标「已拼好·点我保存」→ 点保存 → 「已保存」，落盘 `video-rod/split1.mp4`
- ffprobe 验：h264 640×360、duration 8.000s，有效（两段各 2 个 2 秒分片全拼对）
- 重构要点：删「驱动猫抓 m3u8 页」约 150 行；offscreen 文档内解析+下载+解密+转码；SW 仅编排+落盘（离屏无 `chrome.downloads`）
- 待办：**AES-128 解密仅在裸 TS 测试站验过，真实加密 HLS 未验**（真实站点多为 AES-128，漏了真机上拼乱码）；仅 HLS 不支持 DASH
  - **后续状态（2026-11-04 追加）**：**仍未关闭**，已升为全项目 P0（`docs/BACKLOG.md` B-01）；DASH 保持不做（N-02）。

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

- 证据：`deliverables/assets/overlay-douyin.jpg`（右上角按钮实拍）。
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
| H4 | 限速/失败暂停 | ✅ 3–5 秒随机、不设条数上限、连续 3 次失败暂停 |
| H5 | 不自动翻页/不做写操作 | ✅ 只读当前笔记 `__INITIAL_STATE__` |
| H6 | 视频分支 | ✅ `mediaV2.stream` 优先带音轨 mp4；实测 mp4 31,344,820 B |
| H7 | 自动补全计数 | ✅ 图片 `files=1, skipped=0, errors=0`；视频 `files=1, skipped=1, errors=0` |
| H8 | 收藏/点赞页 | ✅ `?tab=fav` 20 条/20 token；`?tab=like` 30 条/30 token |

- 页面 fetch 被 CORS 拒绝，下载走 `chrome.downloads`；原图（`url` 为空）与签名接口未做，当前为 `urlDefault` webp。
- 小红书页面自身有 hydration/脚本报错，与扩展无关。

### 10.11 Instagram P1（ADR-042）

| # | 验收项 | 结果 |
|---|---|---|
| IG1 | 帖子页按钮注入 | ✅ `/p/test/` 出现「⬇ 下载当前帖」 |
| IG2 | 已加载图片提取 + 后台下载 | ✅ 本地 fixture → `video-rod/instagram/fixtureauthor/images/test_01.jpg`，15,324 B |
| IG3 | 真实 Instagram 帖子/Reel | ⏸️ 挂起：苏哥无 IG 账号，2026-10-19 决定暂不验证；blob 视频当前跳过 |

### 10.7 下载去重（ADR-037）

| # | 验收项 | 结果 |
|---|---|---|
| DED1 | 同一批内重复媒体只下一次 | ✅ 扩展 SW 内用真实 `vrMediaIdentity` + 批内 `Set` 验证：同标识命中跳过 |
| DED2 | 跨批次重复媒体不再下载 | ✅ 持久账本往返验证：`vrDedupSave` 后 `vrDedupLoad` 命中（测试后已还原账本） |
| DED3 | 签名参数变化仍判定为同一媒体 | ✅ 不同 `sig/exp` 的同路径 URL → 同一标识；不同路径 → 不同标识 |
| DED4 | 成功才写账本，失败可重试 | ✅ `seen.add` 仅在 `ok` 后执行 |
| DED5 | 内容相同但 URL 不同 | 📋 媒体库入库 SHA-256，待 P2 实施 |
| DED6 | 状态提示 | ✅ 返回 `skipped`，显示「跳过重复 N」 |
| DED7 | 单次 X 下载重复 | ✅ 第一次 1,336,765 B；第二次 `skipped:true`，无第二次文件 |
| DED8 | 单次下载入口 | ✅ `vrVideoDownload`/`vrQuickDownX` 查 `vrMediaSeen`；成功才记账 |

- 静态检查：`node --check js/background.js`、`js/bulk-profile.js` 通过。
- 去重键：`site | workId | mediaId | kind | origin+pathname`；不包含签名参数。
- 去重覆盖：主页批量（`vrBulkDownload`）+ 单次入口（`vrVideoDownload` 页内按钮、`vrQuickDownX` X 单条）；成功才写账本（见 DED7/DED8）。
- DED1/DED2/DED3 复验方式（2026-10-19）：在扩展 Service Worker 里直接调用真实 `vrMediaIdentity`/`vrDedupLoad`/`vrDedupSave` 验证标识与账本往返（不发起真实下载）；账本测试后已还原。真实"重复批量下载只下一次"的端到端仍以 DED7 的 X 单条实测为准。

### 10.8 X 单条视频下载按钮（2026-10-19）

| # | 验收项 | 结果 |
|---|---|---|
| X1 | 目标推文按钮可见 | ✅ `https://x.com/misscandace89/status/2111859456439185801`，蓝色胶囊「下载」65×32 |
| X2 | 点击后反馈 | ✅ `下载中…` → `已保存`（`vr-done`），2.2 秒后恢复「下载」 |
| X3 | 落盘命名/大小 | ✅ `奇趣蛋蛋(@misscandace89)_#KTV #公主 吃的真好 我也想吃.mp4`，1,336,765 B，`video/mp4` |
| X4 | fxtwitter 元数据 | ✅ 720×1280，3 档 MP4；按钮取最高档 |
| X5 | 同次点击出现原文件名文件 | ⚠️ 来自 **Plucker XBD**（`byExtensionId=piibekljdlkbkdchicfdjpnaggolndif`），不是钓鱼竿 |

- 结论：钓鱼竿单条下载链路正常；用户若看到原文件名文件，是另一个下载扩展同时接管了同一视频。
- 按钮样式：蓝色渐变实心胶囊 + 白色下载图标 + “下载”文字；不再使用灰色透明圆钮。

### 10.9 X 批量与默认媒体库路径（2026-10-19 反馈）

| # | 验收项 | 结果 |
|---|---|---|
| XB1 | X 主页批量队列 | ✅ `x.com/NASA/media` 8 条，完成 7 条，跳过 1 条重复 |
| XB2 | 落盘目录 | ✅ `Downloads/video-rod/x/NASA(@NASA)/videos/`，无按图片建目录 |
| XB3 | X 单条按钮 | ✅ `video-rod/x/奇趣蛋蛋(@misscandace89)/videos/...mp4` |
| XB4 | 选择器 | ✅ X/微博批量不再调用 `showDirectoryPicker` |
| XB5 | 限速 | ✅ X/XHS 3–5 秒/条；不设条数上限；fxtwitter 429 退避一次 |
| XB6 | 媒体库根目录 | ⚠️ 当前选中的根目录是 `download`，扫描 0；新增加自动下钻 `video-rod` 和“重置目录” |

- 旧根目录文件（如 `video-rod/奇趣蛋蛋...mp4`）是改动前遗留；新文件在平台/作者/类型子目录。
- 媒体库管理前需一次性重置目录并选择 `E:\personal\Downloads\video-rod`。

### 10.10 媒体库目录选择（showDirectoryPicker）

| # | 验收项 | 结果 |
|---|---|---|
| LIB1 | 选择器不再被固定 id 记忆到 F 盘 | ✅ 移除 `id`，`startIn:'downloads'` |
| LIB2 | 空目录允许 | ✅ 任意可写目录可用；0 个文件不报错 |
| LIB3 | 错误句柄自动清除 | ✅ 启动时无效句柄从 IndexedDB 删除（权限失效） |
| LIB4 | 正确目录 | ✅ F:\download\video-rod；任意有读写权限目录可选 |
| LIB5 | 扫描/预览/重命名/删除 | ✅ 22 项；临时文件重命名「已重命名」、删除「已移到回收站」 |
| LIB6 | 选择器从独立窗口触发 | ✅ 媒体库入口改为 `chrome.windows.create({type:'popup'})` |
| LIB7 | 选中后请求读写权限 | ✅ `requestPermission({mode:'readwrite'})` |
| LIB8 | 外部目录隔离 | ✅ 跳过 `xbd-downloader`(704)、`老黄的分享`(17)；文件保留 |
| LIB9 | 重命名 API | ✅ `move(parentDir,newName)`，不再读 `move()` 返回值 |
| LIB10 | P3 选择/标签/批量 | ✅ 临时文件：标签、全选 23、清除 0、移动 1、删除 1，回到 22 项 |
| LIB11 | P3 移动冲突 | ✅ `performMove` 仅对 `InvalidModificationError` 重试，其他错误立即失败 |
| LIB12 | P4 图片缩略图 | ✅ `_index/thumbs` 8 张；刷新后仍显示 |
| LIB13 | P4 SHA-256 查重 | ✅ 22 文件；3 组/9 个重复标记；`hashes.json` 持久化，刷新后保持 |
| LIB14 | P4 本地视频流式 | ✅ `preload=metadata`；duration 61.5s、readyState 4，可 seek；本地 object URL 不需要 HTTP Range |

- 参考：MDN `showDirectoryPicker` 的 `id` 记忆行为；Chromium issue 关于 `id`/`startIn` 被忽略的报告。

### 10.3 复现与坑

- 星愿调试端口 `9223`；扩展 ID `bilfgmaaplmlfgpmjfhdaillmnonjlbj`；改代码后在 `chrome://extensions` 卡片里点 `#dev-reload-button` 重载，并**刷新抖音页**（内容脚本只在页面加载时注入）。
- 抖音详情页必须在已登录标签页里打开；CDP 新建标签会掉登录态/白页。`/video/<id>` 与 `?modal_id=<id>` 两种地址都要支持。
- 抖音 CDN 的 403 是**请求头**问题，不是 URL 失效：无 Referer 返回 `403 text/html`，带 `Referer: https://www.douyin.com/` 返回 `206 video/mp4`。
- 页面内 `fetch(currentSrc)` 会被 CORS/CSP 拦；`<a download>` 跨域时 `download` 属性会被忽略、变成导航。所以下载必须走 `chrome.downloads` + DNR 补 Referer。
- 详情接口失败时不要硬失败：回退通用嗅探分支，保证「永远有得下」。

### 10.12 媒体库逐按钮全量（lib_full_test）

完整记录见 `docs/LIBRARY-FULL-TEST.md`。实测 27 项：搜索、平台筛选、类型 tab、排序、网格/列表、预览/键盘、标签、重扫、设置均通过；`_index` 27 条、`hashes.json` 27 条、`thumbs/` 12 张。全屏按钮在 CDP trusted click 下未进入（需真实点击复验）；`#pickBtn/#rootBtn` 原生 picker 与 `#resetRoot` 未在自动验收中执行。

---

## 附：远端线验收记录（2026-10-24 ~ 10-25，章节编号自成体系）

> 以下是另一台电脑那条线（I1–I6 图片能力 / YouTube 下载 / 资源库重构）的验收记录，章节号与上方不连续，勿混用。

7. 改扩展代码后星愿里重载：`chrome://extensions` → 找「苏哥的钓鱼竿」卡片 → `#dev-reload-button`（shadow DOM 里，JS `el.click()` 可靠）；重载后 SW 里 `typeof vrDownloadWithName === 'function'` 可验证新代码上线

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
- 截图：`deliverables/assets/library-v13-grid.jpg`、`library-v13-lightbox.png`、`library-v13-video.png`
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

1. ~~**图片/网址类下载未真机验证**~~ → ✅ **已覆盖**：图片线 I1–I5 已落地，`cdp-image-test.py` 等 5 套覆盖单张/批量/面板/设置/发现度。
2. ~~**缩略图未生成**~~ → ✅ **已做**：`js/library/thumbs.js` 已上线（页面侧生成，SW 无 DOM）。
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

---

## 14. 设置页重设计验收（2026-10-24）

### 14.1 环境与手法

Chrome for Testing 147（profile `.work/profiles/ext-test6`，端口 9346），`options.html` 直接加载（`Network.setCacheDisabled`）；结构断言 + 交互冒烟 + 既有回归，不依赖截图比对。

### 14.2 结构与布局

| 项 | 结果 |
|---|---|
| 分区 / 导航项 | 18 / 18 |
| 标题层级 | 1 个 `h1`（页面）+ 18 个 `h2.optionsTitle` |
| 重复 ID | **0**（原 `allDisable/allEnable` ×4 已改 `data-all`） |
| 横向溢出 | 1440px：`scrollWidth 1430`；900px：`890` → 均无溢出 |
| 移动导航 | <980px 侧栏变顶部横向 chips，滚动条隐藏 |
| 关于分区 | 4 张卡片（项目 / 上游与许可 / 本 fork 增量 / 开发手记）+ 4 个数据块；版本 `苏哥的钓鱼竿 v2.7.2.1`、作者 chip 正常 |
| 控制台 | 0 error / exception |

### 14.3 交互冒烟

| 项 | 结果 |
|---|---|
| 动态表格 | `#extList` 33→34 行；输入 `zzztest` 写入 `storage.sync`；删除回到 33 行 |
| 一键禁用/启用 | `data-all=0` 全部关闭、`data-all=1` 全部开启 |
| 导航高亮 | 资源库 → 后缀 → 关于；页尾落在「关于」 |
| i18n / 版本 | 导航「后缀」等文案正常；`苏哥的钓鱼竿 v2.7.2.1` |
| 保存提示 | `storage.sync` 变更后出现「已保存」轻提示（不影响字段逻辑） |

### 14.4 回归

| 套件 | 结果 |
|---|---|
| `tools/cdp-s1a-test.py` | **17/17** |
| `tools/cdp-indexer-test.py` | **35/35** |
| `tools/cdp-index-test.py` | **14/14** |
| `tools/cdp-migrate-test.py` | **39/39** |

### 14.5 未覆盖

1. 未跑 axe / 真实屏幕阅读器；只验证了结构、aria 注入、键盘焦点。
2. 深色模式只做了 token 设计与截图，未逐项测对比度。
3. 表格在 <640px 仍横向滚动（列多，堆叠会丢语义），属有意取舍。
4. `lang="zh-CN"` 固定，i18n 切语言后不同步（原页面为 `en`，同样问题）。


---

## 15. popup 与资源库统一重设计验收（2026-10-24）

### 15.1 环境

Chrome for Testing 147（profile `.work/profiles/ext-test6`，端口 9346），测试站 18080；资源库用 6 条种子数据（视频/图片/音频/两平台/星标/缺失）验证。

### 15.2 popup

| 项 | 结果 |
|---|---|
| 定宽 | 400px，无横向滚动 |
| 主色 | 强调蓝 `#1a73e8`；批量下载按钮蓝底白字；筛选胶囊 chip |
| 控件 | 勾选 17px、图标按钮 30px、`:focus-visible` 蓝环 |
| M1 冒烟 | `errors: []`；卡片 1 张（图片夹具页）、设置视图开合、批量命名、全选正常 |
| M2 下载 | 两条下载完成、去重生效、`errors: []` |

> 视频页 `Page.captureScreenshot` 会卡死（CDP/媒体合成限制），不代表产品问题；截图改用图片夹具页。

### 15.3 资源库

| 项 | 结果 |
|---|---|
| 新增文件 | `library.html`、`css/library.css`、`js/library/ui.js`、`js/library/thumbs.js` |
| 布局 | 全宽；侧栏 208px；卡片 `minmax(320px,1fr)`、4:3 缩略图；1280px 三列 |
| 浏览 | 6 条渲染、类型/平台/星标筛选、搜索、排序、网格/列表切换 |
| 查看器 | 单击打开、`←/→` 翻页、`Esc` 关闭、底部信息 +「在文件中打开」 |
| 响应式 | 900px / 860px 无横向溢出；860px 侧栏折叠为顶部筛选 chips |
| 端到端 | `tools/cdp-library-page-test.py` **22/22**，控制台 0 error |

### 15.4 回归

| 套件 | 结果 |
|---|---|
| `tools/cdp-s1a-test.py` | **17/17** |
| `tools/cdp-index-test.py` | **14/14** |
| `tools/cdp-indexer-test.py` | **35/35** |
| `tools/cdp-m1-test.py` | `errors: []`（报告型） |
| `tools/cdp-m2-test.py` | 2 条下载 + 去重，`errors: []` |

### 15.5 未覆盖 / 边界

1. ~~查看器视频暂用原生 `controls`；S4 再换自绘控件~~ → ✅ **已做**：`video.js` 自绘控件（进度/音量/倍速/全屏/连播）+ `keyboard.js`（↑↓ 切条、←→ ±5s、Shift ±30s、空格）已上线。
2. 缩略图/预览依赖「允许访问文件网址」，正式 Chrome 需手动开启。
3. 资源库尚未做 1k 条性能压测（缩略图懒加载已按 IntersectionObserver 实现）。
4. 源文件被移动/删除时只标灰，重新定位留 S5。

---

## 16. 资源库 v2（概览可视化 + 表格）验收（2026-10-24）

### 16.1 本轮改动

| 模块 | 内容 |
|---|---|
| 资源概览 | 4 个 KPI（总文件 / 占用空间 / 图片 / 视频），大号数字 + 占比条 + 脚注 |
| 平台分布 | 8px 堆叠条 + 双列图例（色点 / 名称 / 数量 / 占比） |
| 博主产量 | Top 5 横向条形，按最大值归一 |
| 博主速览 | 头像（平台色渐变）+ 名称/ID/图片·视频计数 + 单封面或 2×2 拼图 |
| 列表视图 | 真表格：8 列表头、数字列右对齐、等宽数字、`.lib-row` 行可点 |
| 分组 | 「平铺 / 按日期」；网格用 `.lib-day` 分隔，表格用 `.day-row` |
| 响应式 | ≤899px 侧栏折叠为横向筛选条（平台 + 博主 chips），`.mobile-plat` 兜底 |
| 视觉 | 平台色点/分布条；卡片占位大图标；细滚动条；深色模式 |

### 16.2 端到端验收（`tools/cdp-library-page-test.py`）

| 组 | 断言 | 结果 |
|---|---|---|
| A | 扩展加载、页面模块、种子 6 条 | 3/3 |
| B | 网格 6 卡、空态隐藏、总数 742 MB、类型计数、**KPI 6/742/2/3**、**分布 4 段 + 4 图例**、**博主速览 5 卡**、**Top5 条形**、**表格 8 列**、**表头文案**、**按日期分组** | 11/11 |
| C–G | 类型/平台/星标筛选、搜索、按大小排序 | 5/5 |
| H | 列表 6 行、点行开查看器、翻页、Esc 关闭 | 4/4 |
| I | 无结果空态、清空恢复 | 2/2 |
| K | 900px 无横向溢出、860px 侧栏折叠为横条 | 2/2 |
| L | 控制台 0 error | 1/1 |

合计 **29/29**；其中 B5–B11、K2 为本轮新增/改写。

### 16.3 截图

`deliverables/assets/`：`library-page-grid.png`（1440 默认，概览收起）、`library-page-overview.png`（展开概览）、`library-page-cards.png`（大卡）、`library-page-table.png`（表格）、`library-page-900.png`（860 横向筛选条）、`library-page-dark.png`（深色）；查看器见 §17.3。

### 16.4 边界与已知取舍

1. 概览统计是**索引全局**，不随筛选变化（区块右侧标注「索引全局」）；筛选后的数量看标题下方。
2. 表格列在窄屏逐级隐藏：≤1199 博主、≤999 类型、≤899 时间；宽屏完整 8 列。
3. 视频缩略图抽帧失败时显示类型占位（大图标 + 文案），不阻塞列表。
4. 博主速览最多 12 张卡；<4 项时用单封面，避免拼图空格。
5. 概览 + 博主速览合计约 470px；表格视图会收起两者，保证内容直接进视野。

---

## 17. 查看器 v2（S4）验收（2026-10-24）

### 17.1 本轮改动

| 模块 | 内容 |
|---|---|
| 概览收起 | 资源概览默认收起，只留「N 项 · 大小 · M 个平台 [展开]」；状态写 `localStorage.vrLibOverview` |
| 查看器 | 顶栏（标题/序号/信息/在文件中打开）、舞台、信息面板、缩略图带、图片缩放工具、视频自绘控件 |
| 图片 | 滚轮缩放 1–5×、放大后拖拽平移、双击复位、`+/-/0` 键盘缩放 |
| 视频 | 播放/暂停、进度、时间、音量、静音、倍速、全屏、连播开关；`Space`、`←/→ ±5s`、`Shift ±30s`、`↑/↓` 切条 |
| 信息面板 | 平台/博主/标题/文件名/类型/大小/尺寸/时长/相对路径/原始地址/下载时间/状态；复制路径 |
| 缩略图带 | 当前项前后各 12 条，高亮 + 点击跳转；缩略图复用 `VRThumbs` 队列 |

### 17.2 端到端验收（`tools/cdp-viewer-test.py`）

| 组 | 断言 | 结果 |
|---|---|---|
| A | 模块加载（VRViewer/VRVideo/VRKeys）、种子 4 条 | 3/3 |
| B | 点卡片打开、标题/序号/队列、无 `controls` 属性、自绘控件可见、信息面板字段/路径/大小、面板收展 | 6/6 |
| C | 媒体就绪、静音、`Space` 播放、`→` 快进、`Shift+←` 回退 30s、seek 边界算法 | 5/5 |
| D | `↓` 切到图片、控件随类型切换、图片尺寸写入信息 | 3/3 |
| E | 缩放 1→1.5625→1、复位无位移、图片 `←/→` 切队列 | 4/4 |
| F | 缩略图带 4 条、点击跳转并高亮 | 2/2 |
| G | 连播默认开、`ended` 自动下一条 | 2/2 |
| H | `Esc` 关闭、清空舞台、隐藏视频控件 | 1/1 |
| L | 控制台 0 error | 1/1 |

合计 **27/27**。

### 17.3 截图

`viewer-image.png`（大图 + 信息面板 + 缩略图带）、`viewer-zoom.png`（156% 放大）、`viewer-video.png`（自绘控件 + 连播）。

### 17.4 边界与已知取舍

1. 自动播放受浏览器策略限制：无用户手势时 `play()` 被拒，界面保持暂停；点击卡片/空格后可播。
2. 短片 seek 会夹到 `duration - 0.05`，避免一按 → 就触发 `ended`。
3. 小于舞台的图片按原始尺寸显示（不强行放大），可用缩放按钮放大。
4. 全屏 API 需要真实用户手势，自动化未覆盖；失败静默降级。
5. 缩略图带只渲染当前项前后 12 条，超大索引不会一次性建几百个 `<img>`。

---

## 18. 删除与回收站验收（S5）

### 18.1 本轮改动

| 模块 | 内容 |
|---|---|
| 引擎 | `trash.js`（VRTrash）：软删除到 `_回收站/<批次>/<原相对路径>`、批次 `_manifest.json`、恢复、彻底删除、清空、审计日志 |
| 界面 | `trash-ui.js`（VRTrashUI）：卡片右键菜单、悬停 `⋯`、回收站抽屉、确认框、Toast |
| 入口 | 卡片右键 / `⋯`、查看器信息面板「移到回收站」、侧栏底部「回收站 N」 |
| 索引 | 删除 = 行打 `state='trashed'`（不删行）；恢复 = 打回 `ok`；清空 = 删副本 + 删缩略图（IDB+磁盘）+ 删行 |
| 清空 | `VRTrash.empty()` 幂等：删物理副本 → 删缩略图 → 删索引行 → 删空批次目录 → 收掉被搬空的空壳目录 |
| 安全 | 需要 `readwrite` 句柄；无权限返回 `LIB_E_NO_PERM` 并提示去设置页授权；恢复不覆盖同名文件 |

### 18.2 端到端验收（ADR-074 之后，2026-11-09）

旧的 `tools/cdp-trash-test.py` 是 `#libGrid` 那一版 UI 的用例，随页面重构早已跑不动（选择器全失效），已删除；由下面两套取代：

| 套件 | 断言 | 结果 |
|---|---|---|
| `tools/cdp-trash-empty-repro.py` | 删除标 trashed（行保留）→ 主页 0 卡 → 恢复一条 → 二次删除 → 搬空目录收尾 → UI 清空 → file 表 0 / IDB 缩略图 0 / 回收站目录空 / 再清空幂等 → snapshot·reconcile·full 三种扫描不复活 → **清空核验 verified/leftover、注入死卡兜底、重复删除无孤儿批次** | **23/23** |
| `tools/cdp-trash-dup-index-test.py` | 同一物理文件两条索引（有/无 `video-rod` 前缀）：启动自愈归并、清空清「幽灵行」、搬运窗口内不误判复活 | **9/9** |
| `tools/cdp-trash-stale-state-test.py` | 2026-11-10 新增：FSA `InvalidStateError`(code 11) 状态抖动 → 重解析句柄+重试后删除成功；持续抖动如实 failed+回滚+不留脏批次；`exists()` 严格化；**真实 UI** Delete→确认框→失败 toast 说「删除失败」并给「重试」→重试成功才报「已移入回收站」 | **17/17** |

> **已知过期套件（2026-11-10 收尾实测）**：`tools/cdp-batch-test.py` 是 S5b 旧 UI（`#libGrid` / `.lib-card` / `#libBatch`）用例。页面换成 `#grid` / `.card` 后，A4 起 40+ 条断言全部失效（实测 A1-A3 PASS、A4/A5 FAIL、随后 `#libBatch` 为 null 抛 `TypeError`）——**不是产品回归**。现加「旧 UI 守卫」：检测到旧 DOM 不存在即打印 SKIP、退出码 3；同时从 `tools/cdp-run.py` 的 `full` / `library` 默认套件摘除，杜绝假绿/假失败。按当前 UI 重写需单独立项，本次不做无关重构。
>
> 同轮修正 `tools/cdp_client.py` 的 `find_ext_id`：Edge 内置扩展的 SW 也叫 `background.js`，冷启动先注册时宽松的 `"background.js" in url` 会返回别人的扩展 ID，令 `library.html` 报 `ERR_FILE_NOT_FOUND`、四个模块全 `undefined`；改为按 manifest 全路径 `/js/background.js` 严格匹配。

跑法：`python tools/cdp-run.py tools/cdp-trash-empty-repro.py`（自动起隔离 Edge 实例）。
一轮跑多套时按 §1「有头浏览器实例纪律」复用同一个实例串行执行，不要每套各起一个窗口。

### 18.3 截图

`trash-menu.png`（右键菜单）、`trash-confirm.png`（确认框）、`trash-drawer.png`（回收站抽屉）。

### 18.4 边界与后续

1. 删除/恢复需要一次 `readwrite` 目录授权（设置页「授权目录并全量扫描」）；未授权时明确报错，不静默失败。
2. 批次目录用 `YYYYMMDD-HHmmss-xxxx`（比方案里的「日期」多时间与随机后缀），避免同日同名冲突；清单在批次内。
3. 只展示带 `_manifest.json` 的批次；手工丢进 `_回收站` 的目录不列出。
4. 本次不含**重命名**与**批量选择**（原型里的批量条），留在 S5b。
5. 移动用「复制 → 校验大小 → 删源」，不是 FSA `move()`；Windows 上先关查看器再移动，避免文件占用。

---

## 19. 批量选择 + 重命名验收（S5b）

> 实现口径：`docs/S5B-BATCH-RENAME.md`（与本文冲突时以该文为准）。

### 19.1 本轮改动

| 模块 | 内容 |
|---|---|
| 选择态 | `batch.js`（VRBatch）：`body.batch-mode` 驱动样式，**不改网格 DOM**（表格仍 8 列） |
| 浮条 | `#libBatchBar`：已选 N 项 / 全选 / 取消 / 移到回收站 / 退出；`Esc` 退出 |
| 批量删除 | 复用 `VRTrash.remove(relPaths)` 单批次 + 现有确认框；成功后退出模式并刷新徽标 |
| 重命名 | `rename.js`（VRRename）：引擎 + 自绘弹窗；复制→校验大小→删源；索引删旧写新 |
| 入口 | 右键菜单「重命名…」（批量模式下仅选中 1 项可用，其余 `disabled`） |
| 错误码 | `LIB_E_NAME` / `LIB_E_EXISTS` / `LIB_E_NO_PERM` / `LIB_E_NOT_FOUND` / `LIB_E_COPY` / `LIB_E_DB` |

### 19.2 端到端验收（`tools/cdp-batch-test.py`）

| 组 | 断言 | 结果 |
|---|---|---|
| A | 扩展加载、模块加载、OPFS + 索引 3 条、3 张卡、顶栏批量按钮 | 5/5 |
| B | 进入模式、勾选框与计数、勾选 1/2 项不打开查看器、全选、取消、Esc/退出、筛选与搜索清空选择 | 14/14 |
| C | 右键重命名弹窗、默认选中文件名主体、目录提示、非法字符就地报错、Enter 提交 | 7/7 |
| D | 新文件存在且内容不变、旧文件已删、索引换 key、保留星标/标签、`thumbKey` 置空、`absPath` 更新、条数不变 | 7/7 |
| E | 非法字符/空名/同名 → `LIB_E_NAME`、目标存在 → `LIB_E_EXISTS`、源不存在 → `LIB_E_NOT_FOUND`、扩展名保护 | 5/5 |
| F | 批量删除 2 项：确认文案、退出模式、回收站 count=2、索引只留 1 条、文件进批次、原路径清空 | 7/7 |
| G | 无句柄 → `LIB_E_NO_PERM` | 1/1 |
| L | 控制台 0 error | 1/1 |

合计 **47/47**。

### 19.3 回归

`cdp-library-page-test.py` 30/30、`cdp-trash-empty-repro.py` 23/23、`cdp-trash-dup-index-test.py` 9/9、`cdp-viewer-test.py` 27/27。

### 19.4 截图

`batch-bar.png`（批量浮条 + 勾选态）、`rename-dialog.png`（重命名弹窗，默认选中主体）。

### 19.5 边界与后续

1. **不做批量重命名**（编号/替换/正则），本轮只做单条。
2. 全选范围是「当前渲染列表」，受筛选/搜索影响，不做跨页/跨全库。
3. 重命名是「复制→校验→删源」，失败会清理目标副本；成功即生效，**无撤销**。
4. 大小写重命名（`b.png → B.png`）在 Windows 下判为同名，返回 `LIB_E_NAME`，本轮不支持两步改名。
5. 旧缩略图 blob 不级联删除（`VRDB` 无 `deleteThumb`），留待 S6 清理任务。

---

## 20. 图片悬停下载验收（I1 + I2）

> 实现口径：`docs/IMAGE-I1I2-IMPL.md`。

### 20.1 本轮改动

| 模块 | 内容 |
|---|---|
| 工具 | `lib-image-util.js`（`self.VRImageUtil`，Node 可 require）：五级候选、srcset 最大 w、扫描过滤、扩展名 |
| 入口 | `image-hover.js`：悬停 300ms 出「下载原图」，Shadow DOM 隔离，滚动/缩放/移开即隐藏 |
| SW | `vrImg.resolve` / `vrImg.download`：逐候选 fetch 校验 `image/*`，全失败回退最后一个 |
| 防盗链 | **DNR 会话规则**补 `Referer`（`downloads.download` 的 `headers` 会被拒） |
| 开关 | `vrLibSettings.imgHover`，缺省开；关闭后宿主节点移除 |

### 20.2 单测（`tools/test-image-util.js`）

覆盖 URL 规范化、占位图判定、srcset 选择、五级候选顺序与去重、扫描过滤、扩展名推导。
合计 **58/58**。

### 20.3 端到端验收（`tools/cdp-image-test.py`）

| 组 | 断言 | 结果 |
|---|---|---|
| A | 扩展加载、夹具齐全 | 2/2 |
| B | 页面加载无注入节点、快速划过不出、悬停出按钮、Shadow DOM 内、位置内缩 8px、移开隐藏 | 6/6 |
| C | 点击 3 秒内完成（实测 0.26s）、路径含 `图片/`、按 host 归入其他网页、文件名格式、内容与源图一致 | 6/6 |
| D | 夹具注入并解码 | 1/1 |
| E–G | `a[href]` / `srcset` / 懒加载 三种场景各 4 条：出按钮、下载完成、取到原图、不触发链接跳转 | 12/12 |
| H | 16×16 / SVG / 占位图 / data URI 均不出按钮 | 4/4 |
| I | `imgHover=false` 无节点且悬停不出；`true` 恢复 | 2/2 |
| J | 控制台 0 error | 1/1 |

合计 **34/34**。

### 20.4 关键坑（已修，别再踩）

1. **`downloads.download` 不接受 `Referer`**：传 `headers:[{name:'Referer'}]` 直接报
   `Unsafe request header name`，下载根本发不出去，`vrImg.download` 恒返回 `IMG_E_FETCH`
   且 `chrome.downloads` 里查不到任何记录。必须用 **DNR 会话规则**补头（id 从 9000 起，
   一次性使用、`finally` 里撤销）。详见 `IMAGE-I1I2-IMPL.md` §4.3.1。
2. **内容脚本在 isolated world**：主世界读 `window.__vrImgHoverLoaded` 恒为 `false`，
   断言要改看「无宿主节点 + 悬停不出按钮」这两个可跨 world 观测的事实。
3. **测试脚手架两处**（非产品缺陷）：`scrollIntoView` 后要等一帧再取 `getBoundingClientRect`；
   点完一张图后按钮有 1.2s 的 `done` 态，下一张必须**重新悬停**，否则点到旧坐标、下到上一张图。

### 20.5 截图

`image-hover-button.png`（悬停态）、`image-hover-done.png`（✓ 已存）。

### 20.6 边界与后续

1. **未做**：I3 批量队列、I4 浮标 + 清单面板、I5 设置/快捷键、I6 图集。
2. 单张重复点击会按 `uniquify` 生成 `(1)` 文件，已下载去重（`vrDownloaded`）留给批量阶段。
3. iframe 内图片不抓（`all_frames:false`，用户明确要求）。
4. 深色站点按钮对比度按站点后续适配；Shadow DOM 用 `mode:'open'`，自用优先可测性。

---

## 21. 图片批量下载验收（I3）

> 实现口径：`docs/IMAGE-I3-IMPL.md`。

### 21.1 本轮改动

| 模块 | 内容 |
|---|---|
| 悬停条 | 追加「全部 N」按钮（`image-hover.js`）；图宽 < 140px 时收成纯图标 |
| 批量 UI | `image-batch.js`（`VRImgBatch`）：确认条 + 进度条 + 取消 + 去重 + 上限 |
| SW | `vrImg.batch` / `vrImg.batchCancel`：并发池（缺省 3）、进度广播（200ms 节流）、可取消 |
| 去重 | `chrome.storage.local` 键 `vrImgDownloaded`，上限 2000 条按时间淘汰 |
| 上限 | `vrLibSettings.imgBatchLimit`，缺省 200 |

### 21.2 单测（`tools/test-image-batch.js`）

并发上限、任务只跑一次、失败/异常不中断、取消不再启动、去重跳过、上限截断、进度节流、去重键规范化、空批次。
合计 **27/27**。

### 21.3 端到端验收（`tools/cdp-image-batch-test.py`）

| 组 | 断言 | 结果 |
|---|---|---|
| A | 扩展/夹具/页面、8 张 img | 4/4 |
| B | 悬停条两个按钮、单张文案不变、「全部 5」、不重叠 | 4/4 |
| C | 确认条出现、文案含张数与过滤数、按钮文案、取消关闭且不下载 | 6/6 |
| D | 批量下载 5 张、进度条、文案、完成、5 个文件、路径/文件名/字节数 | 9/9 |
| E | 二次批量全部跳过（去重生效，无新增文件） | 3/3 |
| F | 上限 2：文案「下载 2 张」、只下 2 张、新增 2 个文件 | 4/4 |
| G | 30 张页「全部 30」、批量启动、取消链路有响应 | 3/3 |
| H | `imgBatch=false` 无宿主；`true` 恢复 | 2/2 |
| J | 控制台 0 error | 1/1 |

合计 **35/35**。

### 21.4 截图

`image-batch-hoverbar.png`（悬停条两个按钮）、`image-batch-confirm.png`（确认条）、
`image-batch-progress.png`（进度条完成态）。

### 21.5 关键坑（都已修）

**产品侧**

1. **DNR 规则 id 撞车**：`9000 + Date.now() % 900` 在并发 3 时会拿到同一 id，
   先完成的把别人的规则删了 → 「5 张只下到 3 张」。改单调递增计数器。
2. **DNR 规则删太早**：`download()` 返回就撤，此时请求可能还没发出，Referer 丢失。
   改成等 `downloads.onChanged` 到终态再撤（30s 兜底）。
3. **capture 阶段 stopPropagation**：会把事件挡在按钮之前，按钮 click 收不到。改冒泡阶段。
4. **CSS `display` 重复声明**：`.vr-wrap` 写了两次 `display`，后者覆盖前者 → 悬停条永远显示。
5. **pending 未取消计时器**：快速划过时按钮仍会弹。新增 `onLeaveImage()`。
6. **按钮组盖住图片中心 → 自己把自己藏了**：200px 的图上，按钮组几乎全覆盖，
   鼠标停在中心已落在按钮上 → 触发 `mouseout` 隐藏 → I1/I2 的 F1 间歇失败。
   修法：按钮组宽度 > 图宽 75%（且图宽 < 320）时也收成纯图标。

**测试侧**

1. `downloads.search` 记录登记时机不受控 → 改用**磁盘文件集合**判定。
2. 下载目录残留会让 `uniquify` 加序号 → 测试开头必须清磁盘。
3. 去重表异步写入 → 清两次并断言为空。
4. 本地测试站毫秒级下完 → 取消常常没赶上，测试如实打印，不假装成功。

### 21.6 边界与后续

1. **未做**：I4 浮标 + 清单面板、I5 设置 UI/快捷键、I6 图集。确认条里「先看清单」目前提示「I4 上线」。
2. 浏览器首次批量下载会弹「是否允许下载多个文件」，确认条已提前告知，无法用代码绕过。
3. 并发过高反而慢（`chrome.downloads` 是单队列），并发 3 是实测折中，设置项留给 I5。

---

## 22. 图片浮标 + 清单面板验收（I4）

> 实现口径：`docs/IMAGE-I4-IMPL.md`。

### 22.1 本轮改动

| 模块 | 内容 |
|---|---|
| 浮标 | `js/image-panel.js`：右下角 40px 圆标，角标=可下张数，可拖动、可关闭（`sessionStorage`） |
| 清单面板 | 缩略图网格（首屏 24 张、滚动追加）+ 尺寸档位 + URL 过滤 + 排序 + 勾选 + 批量下载 |
| 尺寸档位 | 小≥100 / 中≥500 / 大≥1200 / 超大≥2000 / 自定义，**每档实时显示命中数**，按**短边**判定 |
| 勾选 | 单击切换、`Shift+单击` 区间、全选/反选/清空，以 URL 为键（排序过滤后不丢） |
| 键盘 | `Esc` 关、`J/K` 移动、`X` 勾选、`A` 全选、`Enter` 下载 |
| 工具函数 | `js/lib-image-util.js` 新增 `shortSide/parseTierMin/tierCounts/filterByTier/filterByKeyword/sortItems` |
| 队列复用 | `js/image-batch.js` 抽出 `runQueue(items)`，暴露 `VRImgBridge.download(items)` 给面板 |

### 22.2 单测（`tools/test-image-tier.js`）**57/57**

短边判定、四档阈值边界（99/100、499/500、1199/1200、1999/2000）、竖图按短边、
每档命中数、自定义阈值合法性、URL 关键词、三种排序、组合取交集、空/null 安全。

### 22.3 端到端（`tools/cdp-image-panel-test.py`）**46/46**

| 组 | 断言 |
|---|---|
| A | 扩展/夹具、浮标出现、角标=8、距右下 16px |
| B | 点浮标开面板、标题含张数、首屏 8 张、显示尺寸 |
| C | 小 8 / 中 2 / 大 2 / 超大 0 且禁用、切档网格数、自定义 1200 命中 2 |
| D | 关键词 sprite=1、cover=2、无命中空态、清空恢复 |
| E | 单击勾选、已选计数、下载可用、Shift 区间 4 张、清空、全选 8、反选 0 |
| F | 尺寸降序顺序变化、排序后勾选不丢 |
| G | `A` 全选、`X` 取消当前项、`J` 移动焦点 |
| H | 下载选中 2 张落盘、文件名含日期前缀 |
| I | `Esc` 关闭 |
| J | 浮标拖动改位置、位置持久化 |
| K | 关闭后本页不再显示 |
| L | `imgPanel=false` 无宿主 / `true` 恢复 |
| M | 控制台 0 error |

### 22.4 截图

`image-panel-float.png`（浮标）、`image-panel-grid.png`（面板网格）、
`image-panel-tier.png`（切大档）。

### 22.5 关键坑（都已修）

1. **浮标永远不出现**：`ensureUI()` 只在开面板时调，而浮标是入口 → 死循环。
   修法：脚本末尾主动 `boot()`，`DOMContentLoaded` 兜底；设置关→开时重建。
2. **Shadow DOM 焦点**：`document.activeElement` 只返回 host，`J/K/X` 全失效。
   修法：读 `shadowRoot.activeElement`。
3. **`prompt`/`alert` 可能被 CSP 拦**：自定义档位改**面板内联输入行**。
4. **自定义档位显示 0**：会被读成「一张都没有」，改初始显示「…」。
5. **`total` 与档位计数语义不同**：`total` 含不达任何档的图，档位计数才是有阈值的。

### 22.6 边界与后续

1. **未做**：设置页 UI 与快捷键（I5）、图集/多页（I6）。
2. 只认 `<img>`：CSS 背景图、`<picture>` 的 `<source>`、Canvas 扫不到（与 I1–I3 一致）。
3. 懒加载图未解码时不进清单（`scanImages` 已过滤），滚动后才补。
4. 浮标关闭用 `sessionStorage`（刷新恢复）；位置用 `localStorage`（跨站共享偏移，I5 可按站点存）。

---

## 23. YouTube 播放器下载验收（YT）

> 脚本：`tools/yt-download-test.py`（**21 条断言，离线**）+ `tools/yt-ext-test.py`（真机级联，需网络）
> 实现与背景：`docs/YT-IMPLEMENTATION.md`、`docs/YT-FEASIBILITY.md`

### 23.1 为什么单开一套「离线端到端」

YouTube 的接口会按 IP/时段风控，把「能不能取到格式」写进回归会导致**测试结果随环境漂移**。
所以这套测试只把「取格式」打桩，其余全是产品代码原样执行：

1. 本地起带 CORS 的静态服务，吐出真实的一对 DASH 轨（`.work/_video.mp4` / `_audio.mp4`）；
2. `Page.addScriptToEvaluateOnNewDocument` 在页面脚本之前替换 `chrome.runtime.sendMessage`，
   只拦 `ytFormats` 并回假档位，其余消息透传；
3. 用内存 mock 顶替 FSA 根句柄（记录 path/size/blob），因为 `showDirectoryPicker` 无法自动化。

于是「档位渲染 → n 参数判断 → 拉流 → fMP4 合并 → 三段路径 → FSA 写盘 → Chrome 解码」
这条链完全可无人值守回归，且不依赖 YouTube 是否放行。

### 23.2 用例（21 条）

| 组 | 断言 |
|---|---|
| 加载 | 扩展加载成功；`downloads.download.__vrNameHooked` 为真；`VRPath.buildRelPath` 可用 |
| 档位 | 4K60 / 1080p / 720p / 360p(免合并) / 仅音频 全部渲染；**4K 档没被 codec 过滤掉** |
| 落盘 | 只写 1 个文件；路径含 `video-rod/YouTube/<博主>/视频/`；文件名带分辨率；字节数与合并结果一致 |
| 兜底 | 未走 `chrome.downloads`；没有任何 UUID 名文件 |
| 容器 | 能取到合并字节；`MediaError=0`；时长 12.10s；**视频/音频解码字节均 > 0** |

### 23.3 踩过的坑（测试脚手架，不是产品缺陷）

1. **mock 的 `createWritable()` 必须返回 Promise** —— 真 FSA API 返回 Promise，返回普通对象会在 `.then` 上炸，
   表现为「FSA 静默失败、悄悄退回下载器」。
2. **小窗里解码会被节流** —— 下载页是 popup 窗口，后台状态下 `<video>` 的 `readyState` 停在 0 且
   `play()` 会把 CDP 连接挂死；校验要搬到前台标签页（`data:` URL）做。
3. **CDP 固定端口会连到上一轮没退干净的 Chrome** —— 症状是「点下载的瞬间 socket closed」；
   端口改成随机即稳定。
4. **`Page.captureScreenshot` 的 clip 是文档坐标** —— 要加 `scrollX/scrollY`，否则截到视口外的位置。

### 23.4 边界

1. **不测**「YouTube 接口通不通」——那由 `tools/yt-ext-test.py` 单独跑，且允许失败（受风控影响）。
2. 只覆盖 MP4 容器：WebM/Opus 档不在本套断言内。
3. 4K 长视频的内存峰值未做压力测试（>1GB 有 OOM 风险，见实现文档 §6）。

---

## 23. 图片设置与快捷键验收（I5）

> 实现口径：`docs/IMAGE-I5-IMPL.md`。

### 23.1 本轮改动

| 模块 | 内容 |
|---|---|
| 设置项定义 | `js/lib-image-util.js` 新增 `DEFAULT_SETTINGS` / `RANGES` / `parseIntRange` / `validateSetting` / `mergeSettings`（纯函数） |
| 面板设置区 | `js/image-panel.js` 标题栏齿轮 → 替换主体的设置区：5 个开关 + 4 个数值 + 恢复默认 |
| 上游设置页 | `options.html` 新增 `#anchorImage` 分区 + 侧栏项；`js/library/settings.js` 加 `VRImgSettings` 读写 |
| 快捷键 | manifest 声明 `imgDownload`（Alt+Shift+D）/ `imgPanelOpen`（Alt+Shift+A），SW `chrome.commands` 转发 `vrImg.hotkey` |
| 悬停延迟可配 | `js/image-hover.js` 的 `SHOW_DELAY` 改为 `showDelay`（读 `imgHoverDelay`） |

### 23.2 单测（`tools/test-image-settings.js`）**47/47**

`DEFAULT_SETTINGS` 键与类型、`RANGES` 边界、`parseIntRange` 九种输入、
`validateSetting` 十二种情况（含边界 16/4096/8/0）、`mergeSettings` 十三种合并场景。

### 23.3 端到端（`tools/cdp-image-settings-test.py`）**48/48**

| 组 | 断言 |
|---|---|
| A | 扩展加载、未写入时无该键、面板兜底 100、扩展页 `mergeSettings` 兜底 |
| B | 面板打开、齿轮存在、设置区打开、标题变化、5 个开关全开、4 个数值与默认一致 |
| C | 改最小尺寸 → 落库 1200 且面板张数降到 2；延迟/并发/上限逐项落库 |
| D | 非数字/空值/超上限 → 标红 + 提示 + **不落库**；恢复 100 后张数回 8 |
| E | 面板改 → 设置页读到（4 个数值 + 开关状态） |
| F | 设置页改 → 面板读到；设置页超范围不落库 |
| G | 关「全部按钮」→ 悬停条只剩一个；关「右下浮标」→ 宿主消失；都能开回 |
| H | 恢复默认：第一次点击变「确定恢复？」，确认后四项回默认 |
| I | 快捷键：找 tab、悬停记录目标、`panel` 开面板、`download` 落盘 1 个文件、关开关后落库 |
| J | 关悬停 → 宿主移除；开回 → 按钮恢复 |
| L | 控制台 0 error |

### 23.4 关键坑（都已修）

1. **`settings` 变量根本没声明**：一次 patch 三处替换，第三处失败导致整个写文件没执行，
   前两处白改。表现是「UI 变了但存储永远空」。**教训：一次 patch 只改一处，改完立刻 grep 验证。**
2. **`toast` 在 `image-hover.js` 里不存在**：它在 `image-batch.js`。快捷键下载里直接调会
   `ReferenceError`，把 Promise 永久卡住 → `sendResponse` 永不触发。改用 `note()` 兜底。
3. **`display:flex` 盖掉 `hidden`**：设置区打开时底部仍显示「已选 0 张」。
   修法：显式写 `.vr-foot[hidden] { display:none }`（I3 的 `.vr-wrap` 踩过同一个坑）。

### 23.5 测试脚手架的坑

1. **`chrome.storage` 在页面主世界不可用**：`cdp.eval` 默认主世界，读写全报
   `Cannot read properties of undefined`。存储与 `chrome.tabs.sendMessage` 一律在扩展页执行。
2. **`VRImageUtil` / `VRImgPanel` / `VRImgHover` 都在隔离世界**：主世界 `typeof` 为
   `undefined`，断言要用 DOM 表现间接验证。
3. **写 storage 是异步的**：改完立刻断言必挂，加 `wait_setting()` 轮询。
4. **文件名日期前缀每天变**：早先写死 `20261024_` 判测试产物，第二天失效。改成含「测试站」。

---

## 26. 图集扫描验收（I6 模式 A：自动滚动）

> 脚本：`tools/cdp-image-album-test.py`（40 条）｜夹具：`test-site/album.html`（24 张 ≥600×600，纵向懒加载）

### 26.1 覆盖范围

| 组 | 验什么 |
|---|---|
| A | 扩展加载、夹具存在、图集页为可见标签、拿到 tabId、24 张 img、初始只加载首屏、页高 > 3 屏 |
| B | 直接打三条协议：`albumScan` 返回 taskId、初始 `scanning`、进度四字段齐全、`maxPages` 回显、滚动后 `collected`/`page` 双递增、`albumStop` 返回 `ok` 且 `stopped`、停止后不再滚且已收集保留、`withItems` 能取回清单、`paging` 模式如实拒绝 |
| C | 面板入口：图集条存在、按钮文案「图集扫描」、扫描时出现「停止」、进度文案含「第 N/10 屏 · 已收集 M 张」且数字递增、停止后文案「已停止」、出现「下载这 N 张」与「重新扫描」 |
| D | 滚到底：文案「扫描完成」、收集 ≥20 张、不超过页面有效图数、24 张全加载、下载按钮把清单交给既有批量下载（真产生下载记录） |
| J | 控制台 0 error/exception |

### 26.2 关键坑

1. **后台标签页不触发 IntersectionObserver**：Chrome 会节流不可见标签，懒加载图永不出现，
   测出来是 0 张（会误判成扩展坏了）。测试里必须 `Target.activateTarget` 再断言 `visibilityState`。
2. **`rootMargin` 让「初始只加载 1 张」不成立**：夹具第一版用 `rootMargin:'200px'`，
   首屏就预载了第 2 张，断言写死 1 会假失败。改成 `0px`，断言放宽为「≤3 张」。
3. **`executeScript` 拿不到内容脚本的闭包**：序列化函数后单独求值，`U`（VRImageUtil）
   在那边是 `undefined`。采集入口必须挂到 isolated world 的 `self` 上，由 SW 侧一行包装函数转调。
4. **SW 会被回收**：任务状态（已滚几屏 / 已收集 URL）必须落 `chrome.storage.session`，
   面板的 400ms 轮询同时充当「叫醒 + 续跑探针」，否则长图集扫到一半就断。
5. **停止不能只信内存**：SW 重建后 `VR_ALBUM_STOP` 这个 Set 就空了，
   所以每轮循环都回读一次存储里的 `state`，只认落库的状态。


---

## 附 · 单写盘通道与测试卫生（2026-11-08 新增）

| 套件 | 命令 | 测什么 |
|---|---|---|
| qa-single-channel-e2e | `python tools/qa-single-channel-e2e.py --port 9490`（先 boot --keep-isolated） | ADR-069/070 全链路：接管、待归档如实记账、看门狗、失败可重试、真实 Downloads 零写入。14/14 |
| test-xhs-note-filter | `python tools/test-xhs-note-filter.py --port 9490` | ADR-071 详情页白名单：本体不误杀/推荐被滤/非详情回退。4/4 |

**测试卫生铁律（B-40）**：隔离实例启动即把下载目录重定向到 `work/dl/isolated`，
任何下载类测试禁止写真实 Downloads；跑下载类测试后必须核对该目录为空。
**测后清场铁律**：真实库上的实测产物，当轮必须清理（快照 → 删记录 → 删文件 → 复核），
「当作真实素材保留」是错误做法（2026-11-08 教训）。

| qa-xhs-author-e2e | `python tools/qa-xhs-author-e2e.py --port 9490`（先 boot --keep-isolated） | ADR-072/073 双通道接线：popup 批量 state 作者注入、面板 vrImg.batch 权威 title/author、去重键迁移、非详情回退、面板全部/未知档。13/13（本地 fixture，零风控面） |

| qa-pack-verify | `python tools/qa-pack-verify.py` | 发布包真实加载：解压 zip → 用解压物（不是仓库根）启动 Edge → SW 存活/popup 可开/能嗅探/体积<8MB。6/6 |
| pack-dist.js | `node tools/pack-dist.js`（`--dry-run` 只报告） | 发布包打包（只打 dist/，禁带目录自检，体积红线 12MB 警告/20MB 失败）。产物 `..\work\vr-release\video-rod-<ver>.zip` |
| qa-preview-page | `python tools/qa-preview-page.py --port 9490` | preview 独立窗口页专项（补测试盲区）：script 加载清单、mqtt 默认不静态加载、按需注入缺库时明确 reject。12/12 |

---

## 附 · 回收站状态机（ADR-074，2026-11-09 新增）

| 套件 | 命令 | 测什么 |
|---|---|---|
| cdp-trash-empty-repro | `python tools/cdp-run.py tools/cdp-trash-empty-repro.py` | 删除→索引标 trashed（行保留）→主页 0 卡→恢复一条→二次删除→UI 清空→file/thumb 双双归零→幂等再清空→snapshot/reconcile/full 三种扫描不复活→清空核验与死卡兜底、重复删除无孤儿。23/23 |
| cdp-trash-dup-index-test | `python tools/cdp-run.py tools/cdp-trash-dup-index-test.py` | 同一物理文件两条索引（有/无 `video-rod` 前缀）：启动自愈按前缀归并、清空时清「幽灵行」，主页 0 死卡。7/7 |

**口径（改回收站前必读）**：
1. `state='trashed'` 的索引行**不删**，主页/树/统计/判重/下载查重全部要排除它；
2. 清空 = 删物理副本 + 删缩略图（IDB `t:<relPath>` + 磁盘 webp）+ 删索引行，必须幂等；
3. `_manifest.json` 只是跨浏览器备份，真源是索引；
4. 任何扫描源（downloads / snapshot）都必须有磁盘证据才能新增条目，`d.exists` 不可信。
