# 苏哥的钓鱼竿 — 交接文档

> 更新：2026-10-24 ｜ 代码 HEAD：`f61ca96`（设置页重设计；其后仅文档提交）
> 用途：**接手 AI 的第一份必读文件**。读完本文 → `docs/LIBRARY-PLAN.md`（主线方案）→ `docs/TESTING.md` §10~§13（已验收记录）。
> 本文只写「现在是什么状态、怎么跑、别踩什么坑」，设计论证在 LIBRARY-PLAN 里。

---

## 0. 先遵守这三条项目规则

1. **每次任务开始先称呼用户「Sunny 姐姐」**（用户明确要求）。
2. **先文档后代码**：所有技术细节、前后端分工必须先写进文档，禁止边写边研究；**每次改代码前先把已有的改动 git commit + push**。
3. **私有自用库，能抄就抄**：本项目不上架、不分发，GPL-3.0 不产生分发义务；可复用开源实现，但保留下游能追溯的来源说明（ADR-028）。

---

## 1. 一句话现状

这不是从零开始的项目，也**不是**还在评审阶段：本地资源库主线已经落地 **S0 → S1a → S1b → 下载完成自动入库 → S2 索引服务**，五套回归全绿；
图片悬停下载只完成了**调研 + 方案 v1.2 + 可交互原型 v1.2**，**代码一行未写**。
下一步是 **S3 资源库页面**（`library.html` + `ui.js` + `thumbs.js`），索引数据底座已经就绪。

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
| `library.html` / `css/library.css` / `ui.js` / `thumbs.js` / `lightbox.js` / `video.js` / `keyboard.js` / `trash.js` / `archive.js` | S3–S5 的文件，**均不存在** | ❌ |

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
| 单测 | `tools/test-path.js` | **57/57** |
| 图片线 | 调研 v0.1（已拍板双入口/清单面板/优先原图）、方案 v1.2（尺寸档位 + 图集分页）、原型 v1.2 | 原型 CDP **24/24**；**实现 0 行** |

已拍板的产品口径（不要擅自改）：
- 双入口：图片悬停按钮 + 页面浮标；清单面板形态照 Imageye。
- 原图优先，五级候选；防盗链回退 + SW 侧校验。
- 尺寸用「小/中/大/超大」档位（按短边判定），不让用户手写像素。
- 图集支持「顺着下一页抓全部」（自动滚动 / 分页翻页 / 站点 API）。

---

## 5. 测试基线（改完必跑）

### 5.1 起环境

```powershell
# 1) 测试站（18080）
Start-Process python -ArgumentList '-m','http.server','18080','--bind','127.0.0.1' `
  -WorkingDirectory 'E:\test\video-rod\test-site'

# 2) 浏览器（改了 SW 引入的脚本就必须换新 profile + 新端口，见 §6.1）
$chrome = "C:\Users\XPENG\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe"
Start-Process $chrome -ArgumentList @(
  '--remote-debugging-port=9346',
  '--user-data-dir=E:\test\video-rod\.work\profiles\ext-test6',
  '--load-extension=E:\test\video-rod',
  '--no-first-run','--no-default-browser-check','about:blank')
```

### 5.2 五套回归（按顺序跑）

```powershell
$env:VR_CDP='http://127.0.0.1:9346'
# 注意：CDP 脚本要用「装了 websocket-client 的解释器」——本机是系统 Python 3.12，
# 不是 WorkBuddy 托管的 3.13（后者没装 websocket）。
$py = "C:\Users\XPENG\AppData\Local\Programs\Python\Python312\python.exe"

node tools/test-path.js            # 57/57   纯 Node，无浏览器
& $py tools/cdp-s1a-test.py        # 17/17   设置页 + 三段目录真落盘（会留下一个下载文件）
& $py tools/cdp-index-test.py      # 14/14   下载 → 自动入库 → 设置页刷新（自动清理）
& $py tools/cdp-migrate-test.py    # 39/39   OPFS 句柄注入，三种迁移 + 回滚
& $py tools/cdp-indexer-test.py    # 35/35   OPFS 句柄 + 真实下载，三源索引/快照/缺失语义
```

原型回归（与扩展无关，单独开一个带 `--remote-debugging-port=9333` 的 Chrome 并打开原型页）：

```powershell
# 页面：deliverables/prototypes/library-prototype-v1.html
$env:CDP='http://127.0.0.1:9333'; python tools/cdp-library-test.py   # 42/42
```

> 图片悬停原型的断言脚本是临时件 `.work/scripts/test-image-proto.py`（24/24），**没进 tools/**；`.work/` 被清理后需重写。原型本身是静态单文件，可直接打开复核。

### 5.3 跑测试前必看

- **测试会真下载到 `D:\Users\liq21\Downloads\video-rod\...`**：S1a 脚本不自动删，`cdp-index-test` / `cdp-migrate-test` / `cdp-indexer-test` 会自清理。
- 记一次基线：**五条命令全绿**才算环境正常。任何一条失败先看 §6，不要先改代码。
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

### 7.2 S3–S5（资源库页面与交互，下一步是 S3）

- S3：`library.html` + `css/library.css` + `ui.js` + `thumbs.js`（缩略图并发 2、懒生成、WebP 缓存；届时 `manifest.json` 补 `unlimitedStorage`），并在 popup/options 加「打开资源库」入口。**数据直接用 `VRIndex`/`VRDB`，不要再写一套索引逻辑。**
- S4：`lightbox.js` + `video.js` + `keyboard.js`（自绘控件；↑↓ 切队列、←→ ±5s、Shift ±30s、空格、连播）。
- S5：`trash.js` + 右键菜单 + 回收站 UI（`_回收站/` 已约定；索引已忽略 `_` 开头目录）。

交互与验收对照原型 `deliverables/prototypes/library-prototype-v1.html`（v1.3）与 LIBRARY-PLAN §6。

### 7.3 图片下载实现（I1–I6，一条未写）

顺序：`lib-image-util.js`（原图候选/尺寸档位）→ `image-hover.js`（悬停按钮 + 事件委托 + Shadow DOM）→ 批量队列 → 浮标 + 清单面板 → 设置/快捷键 → 图集模式。
方案 `docs/IMAGE-DOWNLOAD-PLAN.md` v1.2 已经把交互、候选链、失败回退写死；原型 v1.2 可直接对照。**注意**：图片落库走的是已经跑通的自动入库链路，不要再另写一套。

### 7.4 已知缺口 / 技术债（先认账，别当成新发现）

1. **B 模式（自定义目录）还不完整**：`archive.js` 未实现。现在切到 `custom` 只改设置，**新下载仍落系统下载目录**；`VRMigrate` 只能搬存量文件。
2. **没有资源库页面**：目前只能在设置页维护索引、看「索引状态 / 最近入库」文字列表；浏览界面是 S3。
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
| `deliverables/DELIVERABLES.md` | **产出物登记宪法**（新增文件先读 §1.1 落点规则，落地当天登记） |
| `docs/DECISIONS.md` | ADR-001~031（ADR-027 文件名保护、ADR-028 复用策略、ADR-029 工作区边界、ADR-030 索引三源与缺失不删、ADR-031 设置页信息架构） |
| `docs/IMAGE-DOWNLOAD-RESEARCH.md` / `IMAGE-DOWNLOAD-PLAN.md` | 图片线调研（已拍板）与方案 v1.2 |
| `docs/IMAGE-AUTO-INDEX-RESEARCH.md` | 自动入库方案的落地映射（已实现） |
| `docs/LIBRARY-PLAN-审计方案.md` | 给评审人/审计 AI 的找茬手册（已执行过一轮，结论在 §12） |
| `deliverables/prototypes/library-prototype-v1.html` | 资源库交互基准（v1.3） |
| `deliverables/prototypes/image-hover-prototype-v1.html` | 图片悬停交互基准（v1.2） |
| `docs/MOBILE-RESEARCH.md` | **已封存**，不要继续投入移动端 |

---

## 9. 接手第一小时清单

1. `git status` 应干净；`git log -1` 应不早于 `f61ca96`（设置页重设计；其后是文档提交）。
2. 读本文 §3（代码地图）与 §7（未完成）。
3. 起环境（§5.1），按 §5.2 跑五条命令，**确认 57/57、17/17、14/14、39/39、35/35**。
4. 打开设置页 `chrome-extension://<id>/options.html#anchorLibrary` 看「资源库」分区：点一次「校验落盘」确认根目录探测；再点「写快照」确认 `_library/index-*.json` 落盘。
5. 再动 S3：先补 `library.html` / `ui.js` / `thumbs.js` 的实现细节到 LIBRARY-PLAN（如有新增决策），再写代码；索引直接复用 `VRIndex`/`VRDB`，不要重写。
6. 每次代码改动前后都 `git commit + push`（用 §2 的身份参数）。

---

## 10. 恢复上下文提示词（直接复制给下一个 AI）

```
你是接手「苏哥的钓鱼竿」的 AI。先读 docs/HANDOFF.md，再读 docs/LIBRARY-PLAN.md 和 docs/TESTING.md §10~§13。
项目是私有自用 Chrome MV3 扩展，主线是本地资源库；S0/S1a/S1b/自动入库/S2 索引已完成并全绿，下一步 S3 资源库页面（library.html + ui.js + thumbs.js）。
规矩：每次任务先叫我 Sunny 姐姐；先文档后代码；改代码前后都要 git commit + push（仓库没配 user.name，用
git -c user.name="sulcr1983" -c user.email="sulcr1983@users.noreply.github.com" commit -m "..."）。
改 SW 引入脚本必须换新 profile 跑测试；测试浏览器用 Chrome for Testing 147，不要用正式 Chrome；CDP 脚本用系统 Python 3.12（装了 websocket-client）。
开始前先按 docs/HANDOFF.md §5 跑一遍五套回归（57/17/14/39/35），确认全绿再动代码。
```
