# 苏哥的钓鱼竿 — 交接文档

> 更新：2026-10-24 ｜ 代码 HEAD：`2a18d65`（S5b 批量重命名 + I1/I2 图片悬停下载已合并）
> 用途：**接手 AI 的第一份必读文件**。读完本文 → `docs/LIBRARY-PLAN.md`（主线方案）→ `docs/TESTING.md` §10~§13（已验收记录）。
> 本文只写「现在是什么状态、怎么跑、别踩什么坑」，设计论证在 LIBRARY-PLAN 里。

---

## 0. 先遵守这三条项目规则

1. **每次任务开始先称呼用户「Sunny 姐姐」**（用户明确要求）。
2. **先文档后代码**：所有技术细节、前后端分工必须先写进文档，禁止边写边研究；**每次改代码前先把已有的改动 git commit + push**。
3. **私有自用库，能抄就抄**：本项目不上架、不分发，GPL-3.0 不产生分发义务；可复用开源实现，但保留下游能追溯的来源说明（ADR-028）。

---

## 1. 一句话现状

这不是从零开始的项目，也**不是**还在评审阶段：本地资源库主线已经落地 **S0 → S1a → S1b → 自动入库 → S2 索引 → S3 资源库页面 → S4 查看器 v2 → S5 删除与回收站 → S5b 批量选择/重命名**；
图片线 **I1+I2（单张悬停下载）也已落地**，两条支线都已合并进 master，**十一套回归全绿（318 条断言）**。
下一步是 **图片线 I3–I6**（批量队列 → 浮标 + 清单面板 → 设置/快捷键 → 图集），接口已按 I1/I2 预留。

| 项 | 值 |
|---|---|
| 仓库 | `E:\test\video-rod`（`origin` = `github-video-rod:sulcr1983/video-rod.git`） |
| 分支 / HEAD | `master` / `0132072 feat(library): 索引服务——downloads/快照/全量三源 + 快照破死锁` |
| 形态 | Chrome MV3 扩展（猫抓 cat-catch 的 fork），Service Worker 版 background |
| 下载根目录 | `<Chrome 下载目录>\video-rod\<平台>\<博主(@ID)>\<类型>\<文件名>`（本机实测 `D:\Users\liq21\Downloads\video-rod`） |
| 索引 | IndexedDB `vr-library` v1（5 个 store） |
| 构建链 | **本机不可用**：无 `package.json`，`bash/just/zip/crx3/openssl` 全缺；只能「加载已解压的扩展程序」 |

---

## 2. 环境（都已配好，别重复安装、别改）

| 项 | 内容 |
|---|---|
| git push | 必须走 SSH 别名 `github-video-rod`（`ssh.github.com:443`，专用 Deploy Key） |
| Deploy Key | `C:\Users\XPENG\.ssh\id_ed25519_video-rod_deploy`（**无口令**，勿改勿外发），指纹 `SHA256:cu9oIptg9UnyWeehYkdPK3Y1eQmgFecmDbYi2mR0018` |
| **git 提交身份** | **仓库没有本地 user.name/user.email**，直接 `git commit` 会报 `Author identity unknown`。请用一次性参数，**不要改 git config**：<br>`git -c user.name="sulcr1983" -c user.email="sulcr1983@users.noreply.github.com" commit -m "..."` |
| 测试浏览器 | **Chrome for Testing 147**：`C:\Users\XPENG\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe`<br>（Chrome 137+ 正式版已移除 `--load-extension`，正式 Chrome 无法命令行加载扩展） |
| 测试 profile | `.work/profiles/ext-test*`（`.work/` 不进 git，可整体删除） |
| 测试站 | `test-site/`（`python -m http.server 18080 --bind 127.0.0.1`） |
| Python 依赖 | `websocket-client`（`tools/cdp_client.py` 用），已装 |

---

## 3. 代码地图

### 3.1 内核（上游猫抓，**不要大改**）

| 文件 | 说明 |
|---|---|
| `manifest.json` | MV3；后台 `js/background.js`；权限含 `tabs/webRequest/downloads/storage/webNavigation/alarms/declarativeNetRequest/scripting/sidePanel/contextMenus`；**未加 `unlimitedStorage`**（S3 缩略图落地时再补） |
| `js/popup.js` | 猫抓面板内核（只做了 3 处最小改动，见 ADR-025） |
| `js/init.js` / `js/function.js` / `js/templates.js` / `js/polyfill.js` | 猫抓公共层 |
| `js/background.js` | 嗅探 + 下载记账 + 文件名保护 + 右键菜单 + **资源库三个脚本的 importScripts 与消息转发** |
| `popup.html` / `css/*` | 浅色重设计外壳（M7 已完成）；**2026-10 设置页重设计**：四组侧栏 + 卡片化分区 + 响应式，方案见 `docs/OPTIONS-REDESIGN.md`（TESTING §14） |

### 3.2 资源库（本项目的核心增量）

| 文件 | 职责 | 状态 |
|---|---|---|
| `js/library/path.js` | `VRPath`：平台识别 / 类型推断 / 博主段 / 三段路径拼装 / 长度保护 / `file://` 编码 / `parseRelPath()` 反解 | ✅ 单测 57/57 |
| `js/library/db.js` | `VRDB`：IDB `vr-library` v1（`file/thumb/setting/handle/oplog`），单连接缓存，SW 与页面共用 | ✅ |
| `js/library/sw-library.js` | `VRLib`：预登记表（`chrome.storage.session`）→ `downloads.onChanged(complete)` → 反查绝对路径 → 落 IDB → 广播 `vrLib.added`；处理 `vrLib.record/list/stats/clear` | ✅ |
| `js/library/settings.js` | `VRSettings`：`vrLibSettings` 读写、设置页渲染、校验落盘、索引状态 UI、`setSubdir()` | ✅ |
| `js/library/migrate.js` | `VRMigrate`：三种迁移（改子目录名 / 换根 / 整理旧文件）；扫描 → dry-run → 流式复制 → 校验（size + 首尾 64KB，可选 SHA-256）→ 删源 → 日志 → 回滚 | ✅ 39/39 |
| `js/library/migrate-ui.js` | 设置页 `#vrLibMigPanel`：选目录 / 预演表格 / 进度 / 回滚 | ✅ |
| `js/vr-download-hook.js` | 页面侧包装 `chrome.downloads.download`：先记账（含资源库 meta）再下载，解决 Chromium bug 579563 丢文件名 | ✅（ADR-027） |
| `js/library/indexer.js` | `VRIndex`：三源建索引（downloads / 快照 / FSA 全量）+ `reconcile()` + 快照落盘与恢复；根解析三档；缺失只标不删（ADR-030） | ✅ 35/35 |
| `library.html` / `css/library.css` / `js/library/ui.js` / `js/library/thumbs.js` | 资源库页面（S3 核心）：概览 KPI/平台分布/博主速览（可收起）、全宽大卡网格、真表格、筛选/搜索/排序/分组、懒缩略图 | ✅ 30/30 |
| `js/library/lightbox.js` / `video.js` / `keyboard.js` | 查看器 v2（S4）：队列、图片缩放拖拽、信息面板、缩略图带、视频自绘控件、键盘与连播 | ✅ 27/27 |
| `js/library/trash.js` / `trash-ui.js` | 删除与回收站（S5）：软删除/清单/恢复/彻底删除/清空、右键菜单、抽屉、确认框 | ✅ 27/27 |
| `archive.js` | B 模式（custom）的下载后搬移，**不存在** | ❌ |

### 3.3 关键数据流（别绕开）

```
页面点下载
  → vr-download-hook.js 生成 meta（relPath/platform/creatorFull/type…）
  → sendMessage{Message:'vrQueueName', url, filename, meta}
  → SW: vrQueueFilename(url, filename, conflictAction, meta)
        ├─ 文件名记账（onDeterminingFilename 用）
        └─ VRLib.record() 预登记（chrome.storage.session，TTL 10min，上限 500）
  → downloads.onChanged(state=complete)
  → downloads.search({id}) 取「最终」绝对路径（uniquify 改名后的真名）
  → relPath = 绝对路径 - detectedRoot；算不出则用「预登记目录 + 实际文件名」兜底
  → VRDB.putFiles([item])（保留旧 starred/tags）
  → 广播 {Message:'vrLib.added'} → 设置页/未来资源库页面增量刷新
```

**迁移**：`showDirectoryPicker()` 拿目录句柄 → `VRMigrate.plan*/run/rollback`。全程 FSA，不经 `chrome.downloads`（它读不了本地文件）。

---

## 4. 已经完成什么（都有实测记录）

| 步骤 | 内容 | 验收 |
|---|---|---|
| **S0** | P0 探针：`<img>/<video src="file://">` 直读、视频 seek、`downloads.search` 返回绝对路径 | 三项全过（TESTING §9） |
| **原型** | 资源库交互原型 v1.3（27 条演示数据、视频键盘、灯箱、回收站） | CDP **42/42**（TESTING §8） |
| **S1a** | 三段中文目录落盘 + 设置页「资源库」分区 + 校验落盘反推真实根目录 | **17/17**（TESTING §10） |
| **自动入库** | 预登记 + 完成确认 + 索引落库 + 设置页索引状态/最近入库 | **14/14**（TESTING §11） |
| **S1b** | 三种迁移 + dry-run + 流式复制 + 校验 + 回滚 + 迁移后索引同步 | **39/39**（TESTING §12） |
| **S2** | `indexer.js`：三源建索引 + 快照破死锁 + reconcile + 设置页三个维护入口 | **35/35**（TESTING §13） |
| **S3** | 资源库页面：概览可视化（可收起）+ 全宽大卡 + 表格 + 筛选/搜索/排序/分组 | **30/30**（TESTING §15/§16） |
| **S4** | 查看器 v2：缩放/拖拽、信息面板、缩略图带、视频自绘控件、键盘与连播 | **27/27**（TESTING §17） |
| **S5** | 删除与回收站：软删除/清单/恢复/彻底删除/清空、右键菜单、抽屉、确认框 | **27/27**（TESTING §18） |
| **S5b** | 批量选择（顶栏批量 / 底部浮条 / 全选 / 批量软删除）+ 单条重命名（复制校验删源） | **47/47**（TESTING §19） |
| **I1+I2** | 图片悬停下载：五级候选 + SW 校验回退 + Shadow DOM 按钮 + DNR 补 Referer | 单测 **58/58**、CDP **34/34**（TESTING §20） |
| 单测 | `tools/test-path.js` | **57/57** |
| 图片线 | 调研 v0.1、方案 v1.2、原型 v1.2 | 原型 CDP **24/24** |

已拍板的产品口径（不要擅自改）：
- 双入口：图片悬停按钮 + 页面浮标；清单面板形态照 Imageye。
- 原图优先，五级候选；防盗链回退 + SW 侧校验。
- 尺寸用「小/中/大/超大」档位（按短边判定），不让用户手写像素。
- 图集支持「顺着下一页抓全部」（自动滚动 / 分页翻页 / 站点 API）。

---

## 5. 测试基线（改完必跑）

### 5.1 起环境（推荐：一键启动器）

**不用再手动开浏览器。** `tools/cdp-run.py` 负责：自动挑空闲端口 → 起全新 profile 的浏览器
→ 需要时拉起测试站 → 跑完（含失败/异常）一定关掉浏览器。

```powershell
$py = "C:\Users\XPENG\AppData\Local\Programs\Python\Python312\python.exe"

& $py tools/cdp-run.py --suite full          # 全部 11 套，约 2 分钟
& $py tools/cdp-run.py --suite library       # 资源库 4 套
& $py tools/cdp-run.py --suite image         # 图片线 2 套
& $py tools/cdp-run.py tools/cdp-trash-test.py   # 单套
& $py tools/cdp-run.py --keep tools/cdp-viewer-test.py   # 跑完保留浏览器（调试）
```

- 每次自动用**新 profile + 新端口**，天然规避 §6.1 的 SW 脚本缓存问题，不用再记端口号；
- 跑完自动关闭浏览器；profile 目录留在 `.work/profiles/`（要清理就整个删掉，不要单个删）；
- 退出码 0 = 全绿，1 = 有套件失败（失败的套件不会中断后续，便于一次看全）。

手动起环境（只在需要排查启动问题时）：

```powershell
# 测试站（18080）
Start-Process python -ArgumentList '-m','http.server','18080','--bind','127.0.0.1' `
  -WorkingDirectory 'E:\test\video-rod\test-site'

# 浏览器（改了 SW 引入的脚本就必须换新 profile + 新端口，见 §6.1）
$chrome = "C:\Users\XPENG\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe"
Start-Process $chrome -ArgumentList @(
  '--remote-debugging-port=9346',
  '--user-data-dir=E:\test\video-rod\.work\profiles\ext-test6',
  '--load-extension=E:\test\video-rod',
  '--no-first-run','--no-default-browser-check','about:blank')
```

### 5.1.1 标签不会残留

所有脚本用 `Target.createTarget` 建的标签，由 `cdp_client.Cdp` **自动登记**，进程退出时
（含 `sys.exit` / 异常）统一 `Target.closeTarget` 关掉——不用逐个脚本写 close。
这是 `atexit` 兜的底，脚本里**不要**再手动关标签，重复关会报错但不影响结果。

### 5.2 十一套回归（按顺序跑）

```powershell
$env:VR_CDP='http://127.0.0.1:9346'
# 注意：CDP 脚本要用「装了 websocket-client 的解释器」——本机是系统 Python 3.12，
# 不是 WorkBuddy 托管的 3.13（后者没装 websocket）。
$py = "C:\Users\XPENG\AppData\Local\Programs\Python\Python312\python.exe"

node tools/test-path.js            # 57/57   纯 Node，无浏览器
node tools/test-image-util.js      # 58/58   纯 Node，图片候选链/扫描过滤
& $py tools/cdp-s1a-test.py        # 17/17   设置页 + 三段目录真落盘（会留下一个下载文件）
& $py tools/cdp-index-test.py      # 14/14   下载 → 自动入库 → 设置页刷新（自动清理）
& $py tools/cdp-migrate-test.py    # 39/39   OPFS 句柄注入，三种迁移 + 回滚
& $py tools/cdp-indexer-test.py    # 35/35   OPFS 句柄 + 真实下载，三源索引/快照/缺失语义
& $py tools/cdp-library-page-test.py  # 30/30   资源库：概览收起/表格/筛选/搜索/排序/分组/响应式
& $py tools/cdp-viewer-test.py       # 27/27   查看器：缩放/信息/缩略图带/视频控件/键盘/连播
& $py tools/cdp-trash-test.py        # 27/27   删除/回收站：OPFS 句柄注入 + 真实文件
& $py tools/cdp-batch-test.py        # 47/47   批量选择 + 重命名：OPFS 句柄注入 + 真实文件
& $py tools/cdp-image-test.py        # 34/34   图片悬停：悬停/下载/候选优先/过滤/开关（需测试站 18080）
```

> **合计 11 套 / 318 条断言**。`cdp-image-test.py` 依赖 `test-site` 的图片夹具与 18080 端口，
> 会真下载到 `Downloads\video-rod\其他网页\127.0.0.1\图片\`，脚本结束自行清理。

原型回归（与扩展无关，单独开一个带 `--remote-debugging-port=9333` 的 Chrome 并打开原型页）：

```powershell
# 页面：deliverables/prototypes/library-prototype-v1.html
$env:CDP='http://127.0.0.1:9333'; python tools/cdp-library-test.py   # 42/42
```

> 图片悬停原型的断言脚本是临时件 `.work/scripts/test-image-proto.py`（24/24），**没进 tools/**；`.work/` 被清理后需重写。原型本身是静态单文件，可直接打开复核。

### 5.3 跑测试前必看

- **测试会真下载到 `D:\Users\liq21\Downloads\video-rod\...`**：S1a 脚本不自动删，`cdp-index-test` / `cdp-migrate-test` / `cdp-indexer-test` 会自清理。
- 记一次基线：**八条命令全绿**才算环境正常。任何一条失败先看 §6，不要先改代码。
- 测试产生的空目录（`video-rod\_verify\`、`其他网页\127.0.0.1\视频\`）属正常残留，不删也不影响。

---

## 6. 踩过的坑（按危险程度，全部实测过）

### 6.1 SW 脚本缓存 —— 最坑的一个

改了 `js/background.js` 顶部 `importScripts` 列表后，**老 profile 会继续跑缓存版脚本**：表现为 `VRLib`/`VRDB` undefined、`vrQueueFilename.length` 还是旧值。
扩展重载、`chrome://serviceworker-internals` 重注册**都无效**。

> **规则：改 SW 引入脚本 → 换全新 profile（+ 新端口）跑测试。** 已用 `ext-test2/3/4` 验证过。

另外：`importScripts()` **只能在 SW 首次求值**时调用，运行期调用抛
`importScripts() of new scripts after service worker installation is not allowed`。
`background.js` 里那些 try 补载只对 Firefox 首求值场景兜底，不能指望热补。

### 6.2 扩展没有任意文件读写权限

- `chrome.downloads.download()` 只能**从 URL 写**，读不了本地文件；
- 写/删/移动本地文件只有 **FSA 目录句柄**一条路，且只能在**扩展页面**（options / 未来 library）里做，SW 拿不到句柄；
- 所以 `VRMigrate.planRebase()` 参数是 **DirectoryHandle**，不是路径字符串（LIBRARY-PLAN §13.10）。

### 6.3 原生控件与键盘

- 原生 `<video controls>` 会吞掉 ↑↓/←→/空格，资源库视频弹层必须**自绘控件**（原型已按此实现）。

### 6.4 下载与命名

- `chromium bug 579563`：只要有扩展注册 `onDeterminingFilename`，`downloads.download` 的 `filename` 就会被忽略 → 已有 ADR-027 三道防线，**不要绕开 `vrDownloadWithName()` 直接下载**。
- `conflictAction: uniquify` 会把 `a.mp4` 变成 `a (1).mp4`：索引以 `downloads.search` 的实际文件名为准，不要用预登记名。

### 6.5 环境类

- Chrome 137+ 正式版没有 `--load-extension`，测试一律用 Chrome for Testing。
- 正式 Chrome 读 `file://` 需在 `chrome://extensions` 手动开「允许访问文件网址」；P0 探针环境默认为 true，正式版不默认。
- 浏览器进程跑久了媒体管道会卡死（`readyState=0`、`networkState=2`）：**先重启浏览器**，别排查网络/代码。
- FSA 句柄跨浏览器会话可能回到 `prompt` 状态：读文件（`file://`）不受影响，删除/迁移前需重新授权（`LIB_E_AUTH_LOST`）。

### 6.6 索引 key 带 `subdir` 前缀，句柄却指向资源库根

这是 S2 最容易写错的一处，已经踩过一次：

- 索引 `relPath` 形如 `video-rod/B站/博主/视频/a.mp4`（首段是子目录，B 模式下是虚拟前缀）；
- FSA 句柄指向**资源库根**（A 模式 = `<下载目录>/video-rod`，B 模式 = `customRoot`），里面**没有** `video-rod/` 这一层；
- 所以任何「拿 relPath 直接去句柄里找文件」的代码都必须先 `stripPrefix(relPath, prefix)`。

首版 `reconcile()` 忘了剥前缀，结果把整个索引全标成 missing（D4 断言当场抓到）。

---

## 7. 未完成（按建议顺序）

### 7.1 S2 已完成（不要重做）

`js/library/indexer.js`（`VRIndex`）已上线，能力与口径见 LIBRARY-PLAN §13.11，关键点：

- 三源：`downloads`（只 upsert）/ `snapshot`（需句柄）/ `full`（需句柄）；
- 扫不到的旧条目只标 `state:'missing'`，**永不自动删除**；重建保留 starred/tags/thumbKey/title；
- 快照写 `<根>/_library/index-YYYYMMDD.json`，保留 7 份；不存 absPath，恢复时按当前根重算；
- 设置页「索引维护」三个按钮：重建索引 / 写快照 / 授权目录并全量扫描。

**唯一还要补的**：`library.html` 首次打开时如果还没有索引，应自动跑一次 `build({mode:'full'})`（需句柄）或 `build({mode:'snapshot'})`——这属于 S3 的启动逻辑，不要现在改 indexer。

### 7.2 资源库后续（S5b 已完成）

- S3 ✅：概览（可收起）、全宽大卡、真表格、筛选/搜索/排序/分组、懒缩略图；popup/options 入口已加。**不要再写一套索引逻辑。**
- S4 ✅：查看器拆成 `lightbox.js`（VRViewer）+ `video.js`（VRVideo）+ `keyboard.js`（VRKeys）；图片缩放/拖拽/双击复位、信息面板、缩略图带、视频自绘控件（进度/音量/倍速/全屏/连播）、↑↓ 切条、←→ ±5s、Shift ±30s、空格。**不要再往 ui.js 里塞查看器逻辑。**
- S5 ✅：`trash.js` + `trash-ui.js`；软删除到 `_回收站/<批次>/<原相对路径>`、批次清单、单条/整批恢复、彻底删除、清空、右键菜单、确认框、审计日志。**删除前先关查看器**，避免 Windows 文件占用。
- S5b ✅：`batch.js`（`VRBatch` 选择态，`body.batch-mode` 驱动样式、**不改网格 DOM**）+ `rename.js`（`VRRename` 引擎与弹窗，复制→校验大小→删源）。**不做批量重命名**；筛选/搜索变化清空选择；`Esc` 先让弹窗/菜单/查看器处理。
  - 路径口径坑：索引 key 首段是 `subdir`，句柄可能指向资源库根（无首段）或下载目录（有首段），`VRRename` 按「先剥前缀再原样」探测。

交互与验收对照原型 `deliverables/prototypes/library-prototype-v1.html`（v1.3）与 LIBRARY-PLAN §6。

### 7.3 图片下载实现（I1/I2 已完成，I3–I6 未做）

- **I1 ✅** `js/lib-image-util.js`：纯函数（`self.VRImageUtil`，Node 可 require）。五级候选链（`a[href]` → srcset 最大 w → data-* 懒加载 → `data-ri` JSON → `currentSrc`）、`scanImages` 过滤（短边 <100 / data URI / SVG / 占位图）、`extFromContentType`。
- **I2 ✅** `js/image-hover.js`：悬停 300ms 出「下载原图」，Shadow DOM 隔离，滚动/缩放/移开即隐藏；读 `vrLibSettings.imgHover`（缺省开），关闭即移除宿主节点。
- **SW ✅** `vrImg.resolve` / `vrImg.download`：逐个候选 `fetch` 校验 `content-type: image/*`，全失败回退最后一个（**绝不空点**）。
- **⚠️ 关键坑（已踩）**：`chrome.downloads.download` 的 `headers` **不接受 `Referer`**，直接报 `Unsafe request header name`，下载根本发不出去。必须用 **DNR 会话规则**补头（id 从 9000 起，一次性使用、`finally` 里撤销）。详见 `docs/IMAGE-I1I2-IMPL.md` §4.3.1。
- **未做**：I3 批量队列、I4 浮标 + 清单面板、I5 设置/快捷键、I6 图集。消息协议与工具函数已预留，直接接入口即可。
- 图片落库走**已经跑通的自动入库链路**，不要再另写一套。

### 7.4 已知缺口 / 技术债（先认账，别当成新发现）

1. **B 模式（自定义目录）还不完整**：`archive.js` 未实现。现在切到 `custom` 只改设置，**新下载仍落系统下载目录**；`VRMigrate` 只能搬存量文件。
2. **资源库查看器是基础版**：图片/视频可全屏看、←/→ 翻页，但视频用原生 controls；自绘控件、↑↓ 队列与连播留 S4。
3. **缩略图未生成**：`thumb` store 建了但为空，S3 才做。
4. **深校验开关未进 UI**：`vrLibSettings.deepVerify` 引擎已支持，设置页没有控件。
5. **文档漂移**：`docs/DESIGN.md` 里写的 `js/image-scanner.js`、`js/bilibili.js`、`js/youtube.js` 不存在，能力实际在 `popup-videorod.js` / `x-button.js`。
6. **构建链缺失**：产不出 `.crx/.zip`，只能开发者模式加载。
7. **自动入库的未覆盖项**：批量并发、SW 中途被杀、图片类型（`type=image`）真机未验（TESTING §11.4）。
8. **迁移的未覆盖项**：原生目录选择器未自动化（只剩「拿句柄」一步）、配额不足/文件占用分支未构造（TESTING §12.5）。
9. **索引的未覆盖项**：1k 文件首屏性能未测（S2 只测正确性，真实首屏要等 S3）；快照保留 7 份的清理分支、downloads 超 5000 条的 `truncated` 分支未构造（TESTING §13.5）。
10. **原生目录选择器仍未自动化**：`VRIndex` 的 full/snapshot 只用 OPFS 句柄验证过，「用户点选目录」靠手动；S3 做页面时要顺便把这一步的人工验收写进 TESTING。

---

## 8. 文档索引（谁说了算）

| 文档 | 地位 |
|---|---|
| `docs/LIBRARY-PLAN.md` | **主线权威方案 v2.0**：架构、目录命名、数据模型、删除/迁移、§11 审计指北、§12 审计复核、§13 实现规格、§13.10 S1b 规格、**§13.11 S2 索引规格** |
| `docs/TESTING.md` | **验收记录**：§8 原型 42/42、§9 P0、§10 S1a、§11 自动入库、§12 S1b、**§13 S2 索引 35/35**、§14 设置页重设计；含环境限制与坑 |
| `docs/OPTIONS-REDESIGN.md` | 设置页重设计：现状审计、四组信息架构、视觉/组件规范、响应式、实施记录（ADR-031） |
| `docs/FRONTEND-UI-SYSTEM.md` | 前端统一设计：popup + 资源库共用 token/组件、全屏查看器、**§11 资源库 v2（概览/表格）**、验收记录（TESTING §15/§16） |
| `deliverables/DELIVERABLES.md` | **产出物登记宪法**（新增文件先读 §1.1 落点规则，落地当天登记） |
| `docs/DECISIONS.md` | ADR-001~032（ADR-027 文件名保护、ADR-028 复用策略、ADR-029 工作区边界、ADR-030 索引三源与缺失不删、ADR-031 设置页信息架构、ADR-032 资源库媒体优先） |
| `docs/IMAGE-DOWNLOAD-RESEARCH.md` / `IMAGE-DOWNLOAD-PLAN.md` | 图片线调研（已拍板）与方案 v1.2 |
| `docs/IMAGE-AUTO-INDEX-RESEARCH.md` | 自动入库方案的落地映射（已实现） |
| `docs/LIBRARY-PLAN-审计方案.md` | 给评审人/审计 AI 的找茬手册（已执行过一轮，结论在 §12） |
| `deliverables/prototypes/library-prototype-v1.html` | 资源库交互基准（v1.3） |
| `deliverables/prototypes/image-hover-prototype-v1.html` | 图片悬停交互基准（v1.2） |
| `docs/S5B-BATCH-RENAME.md` | **S5b 唯一实现口径**：批量选择状态机、重命名引擎 API、路径口径、错误码、验收标准 |
| `docs/IMAGE-I1I2-IMPL.md` | **I1/I2 唯一实现口径**：候选链五级优先级、SW 消息协议、DNR 补 Referer 的原因与写法 |
| `docs/MOBILE-RESEARCH.md` | **已封存**，不要继续投入移动端 |

---

## 9. 接手第一小时清单

1. `git status` 应干净；`git log -1` 应不早于 `2a18d65`（S5b + I1/I2 合并）。
2. 读本文 §3（代码地图）与 §7（未完成）。
3. 起环境（§5.1），按 §5.2 跑十一条命令，**确认 57/58/17/14/39/35/30/27/27/47/34 全绿**。
4. 打开设置页 `chrome-extension://<id>/options.html#anchorLibrary` 看「资源库」分区：点一次「校验落盘」确认根目录探测；再点「写快照」确认 `_library/index-*.json` 落盘。
5. 再动图片线 I3（批量队列）：先补实现口径文档，再写代码；图片落库直接复用自动入库链路，候选/扫描复用 `VRImageUtil`，不要重写。
6. 每次代码改动前后都 `git commit + push`（用 §2 的身份参数）。

---

## 10. 恢复上下文提示词（直接复制给下一个 AI）

```
你是接手「苏哥的钓鱼竿」的 AI。先读 docs/HANDOFF.md，再读 docs/LIBRARY-PLAN.md 和 docs/TESTING.md §10~§13。
项目是私有自用 Chrome MV3 扩展，主线是本地资源库 + 图片悬停下载；S0→S5b 与 I1/I2 已完成并全绿（11 套 318 条），下一步图片线 I3 批量队列。
规矩：每次任务先叫我 Sunny 姐姐；先文档后代码；改代码前后都要 git commit + push（仓库没配 user.name，用
git -c user.name="sulcr1983" -c user.email="sulcr1983@users.noreply.github.com" commit -m "..."）。
改 SW 引入脚本必须换新 profile 跑测试；测试浏览器用 Chrome for Testing 147，不要用正式 Chrome；CDP 脚本用系统 Python 3.12（装了 websocket-client）。
开始前先按 docs/HANDOFF.md §5 跑一遍十一套回归（57/58/17/14/39/35/30/27/27/47/34），确认全绿再动代码。
```
