# 资源库脱离浏览器扩展：架构改造方案（审计稿）

- 日期：2026-11-07 ｜ 状态：**探针已跑完，方案按实测修订（仍未动工）**
- 背景：用户选定方案 **B（file:// 本地 HTML + FSA 授权读写）**
- 参考对象：`E:\抖音收藏`（抖珍藏 v2.8.50，扩展 + 本地 HTML 的成熟范本，源码已拆解）

> 本文档是**审计材料**：每个决策都给出依据、候选方案、取舍理由。
> 按用户铁律，先搜索开源方案，找不到才自建，且要说明为什么。
>
> **2026-11-07 更新**：`file://` 下的能力不再靠推断。已用真实 Chrome、
> 不加任何放行参数、纯默认配置实测 13 项，结果见 §0。
> 探针资产：`tools/probe-standalone/`，原始数据 `verdict.json` / `verdict-resume.json`。

---

## 〇、探针实测结论（先看这个，后面所有判断都以它为准）

**测试条件**：Chrome 正式版（`C:\Program Files\Google\Chrome\Application\chrome.exe`），
`file:///E:/test/vr-standalone-probe/probe.html`，**未传 `--allow-file-access-from-files`
等任何放行参数**，全新 profile。

| 编号 | 检查项 | 结果 | 实测值 |
|---|---|---|---|
| T1 | 图片：相对路径直读（4 种文件名） | ✅ | 4/4 变体通过 |
| T2 | 动图 GIF：相对路径直读 | ✅ | 4/4 变体通过 |
| T3 | 视频 MP4：相对路径直读 + seek | ✅ | 4/4 变体通过 |
| T4 | 音频 WAV：相对路径直读 | ✅ | 4/4 变体通过 |
| T5 | `<script src>` 加载索引 | ✅ | 200 条 / 5–6ms |
| T6 | `fetch()` 加载索引 | ❌ | `TypeError: Failed to fetch` |
| T7 | `XMLHttpRequest` 加载索引 | ❌ | onerror / timeout（网络层拒绝） |
| T8 | IndexedDB 可用 | ✅ | open + write ok |
| T9 | localStorage 可用 | ✅ | readback ok |
| T10 | `showDirectoryPicker` 能弹出 | ✅ | 选中 `video-rod`，权限 granted |
| T11 | 目录句柄写入 IDB | ✅ | 写入成功 |
| T11b | 同一 profile **重启后**句柄是否还在 | ⚠️ **在，但权限降为 `prompt`** | `hasHandle=true`, `handleType=directory`, `permission=prompt` |
| T12 | `DecompressionStream('gzip')` | ✅ | 68B → 还原 8000B |
| T13 | 5 万条索引加载 + 解析 | ✅ | **580–644ms** / 再序列化 60ms / JSON 8MB / 堆 43MB |
| T14 | Worker 可用 | ✅ | constructed（**推翻「file:// 不能开 Worker」**） |

### 这张表推翻了原稿的 4 个判断

| 原稿断言 | 实测 | 影响 |
|---|---|---|
| 「`file://` 下 IDB 不可用」（§3.3 隐含、§2.4 推理） | **可用** | 星标/收藏夹/缩略图/设置都能存，不必重造存储层 |
| 「`file://` 不能开 Worker」（§3.4） | **能开** | 解压/合并可挪进 Worker，不必靠 rAF 让出 |
| 「以 FSA 写盘是抖珍藏范本」（§1.2） | 本地库是**纯读**，0 处 FSA/IDB/fetch | 本地库形态是「相对路径 + 只读快照」 |
| 「需引入 gzip+base64 才装得下」（§1.3 沿用） | 5 万条明文 JSON 仅 **8MB**、解析 580ms | 压缩不是必需，是 `fetch` 不可用下的**妥协** |

### 唯一被证实的硬限制：索引只能用 `<script src>` 读

T6/T7 双双失败，T5 成功。原因：`file://` 页面的 `fetch`/XHR 受 CORS 拒绝，
而 `<script src>` 属于经典脚本加载，不受同源策略约束。

**推论（重要）**：索引文件必须是**可被 `<script>` 执行**的形态
（`window.__x = {...}`），不能是纯 `.json`。
这也正是抖珍藏用 `window.dbv_base64 = "..."` 而不是 `.json` 的真实原因——
**不是因为它想压缩，而是因为 `.json` 根本读不到**。

### 对「方便查看/管理」两条判据的回答

| 判据 | 结论 | 依据 |
|---|---|---|
| 双击后 **0 次交互**就能看到素材 | ✅ 成立 | T1–T4 全通过（相对路径） |
| 整理后刷新**还在** | ✅ 成立 | T8/T9/T11 通过：状态可存 IDB |
| 每次打开要不要重新授权 | ⚠️ **要，但只点一次「允许」，不用重选文件夹** | T11b：句柄保留、权限 `prompt` |

最后一行是原方案里被低估的体验成本：**不是完全免授权，也不是每次重选目录**，
而是每次打开点一次授权确认。这是 `file://` opaque origin 决定的，改不了。

---

## 一、现状证据（先摆事实）

### 1.1 资源库对扩展 API 的依赖极弱

统计 `js/library/*.js` 里出现的 `chrome.*` 调用（`grep -ro "chrome\.[a-zA-Z]*"`）：

| API | 次数 | 用途 | 桌面上能否替代 |
|---|---|---|---|
| `chrome.storage` | **26** | 读设置、站点名字典 | ✅ 换成 IndexedDB（T8 实测可用） |
| `chrome.runtime` | **26** | 页面/后台通信、lastError | ✅ 换成直接调用 |
| `chrome.downloads` | **24** | 查下载记录补元数据 | ✅ 索引已完成即可省 |
| `chrome.tabs` | **6** | 定位标签页 | ⚠️ 仅扩展侧需要 |
| `chrome.extension` | **3** | 取扩展 URL | ✅ 相对路径替代 |
| **合计** | **85** | | |

> **更正记录（2026-11-07 探针后）**：本节原写 14/14/12/4/3（合计 47），实测为
> 26/26/24/6/3（合计 **85**），**低估 1.8 倍**。原数字漏掉了 `chrome.runtime.lastError`
> 这类连带引用和 `settings.js` 里集中出现的 8 处 storage 调用。
>
> 耦合**分布极不均匀**：`settings.js` 一个文件就有 24 处（1263 行），
> `app.js` 15 处，其余模块大多是 0–3 处。所以「抽象一层 env 适配」
> 的真实工作量集中在 `settings.js`，不是均匀铺开。

**结论**：资源库页面本身**没有任何 DOM 抓取、注入、标签页操作**。
它不需要「扩展身份」，只需要「读写本地文件」。

### 1.2 抖珍藏的实证（可对标的成熟实现）

扩展本体 **106KB**，`manifest.permissions` 是 **`None`（零权限）**：

```json
// E:\...\kaepaapgaokpobjhamjjekinijbcoihe\2.8.50_0\manifest.json
"permissions": null,
"host_permissions": null,
"background": { "service_worker": "background.js" },
"content_scripts": [["c.js"]]
```

它用到的全部 chrome API：`runtime`（7）、`tabs`（3）、`action`（1）。

**写文件走的是浏览器标准 FSA，不是扩展专有权限**（位置在**扩展侧**，不在本地库页面）：

```js
showDirectoryPicker({ startIn: 'videos', mode: 'readwrite' })
  → getDirectoryHandle('data') → getDirectoryHandle('.appdata')
  → getFileHandle('db_videos.js', { create: true })
  → createWritable() → 写入
```

本地库是纯 HTML，唯一依赖一行：

```html
<script src="data/.appdata/app.js"></script>
```

> **关键更正（2026-11-07 实测）**：抖珍藏的**本地库页面是纯读的**。
> 在 `data/.appdata/app.js`（320KB）里检索：
>
> | 符号 | 出现次数 |
> |---|---|
> | `indexedDB` | **0** |
> | `localStorage` | **0** |
> | `sessionStorage` | **0** |
> | `showDirectoryPicker` | **0** |
> | `createWritable` | **0** |
> | `fetch(` | **0** |
>
> 它只靠 `<script src>` 注入一份 `gzip+base64` 的数据、解压（1 处
> `DecompressionStream`）、渲染，素材用**相对路径**引用（`封面/…jpg`）。
> 写盘全部发生在扩展侧。
>
> 所以它能「零权限」，真正原因有两条，缺一不可：
> **① 只读**（不需要写权限）＋ **② 相对路径**（不需要 file:// 读取权限）。
> 原稿只写了 ①，漏了 ②——而 ② 才是本地 HTML 能显示素材的根本。

### 1.3 抖珍藏的数据分片机制（已完整解出）

6 个独立 JS 文件，每个形如 `window.dbv_base64 = "H4sIAAAA..."`：

| 文件 | 全局变量 | 内容 | 实测大小 |
|---|---|---|---|
| `db_videos.js` | `dbv_base64` | 视频元数据 **23807 条** | 1.07 MB |
| `db_authors.js` | `dba_base64` | 作者 8428 条 | 880 KB |
| `db_texts.js` | `dbvd_base64` | 描述文本 | 1.25 MB |
| `db_bookmarked.js` | `dbb_base64` | 收藏 | 721 KB |
| `db_likes.js` | `db_base64` | 点赞列表 | 11 KB |
| `db_following.js` | `dbf_base64` | 关注 | 43 KB |

首条记录结构（解压实测）：

```json
{ "authorId": "2586464118644075", "createTime": 1687910017,
  "diggCount": 6593, "size": "2.4MB", "audioId": "6727819676476246788" }
```

**双格式策略**（关键设计）：明文优先，base64 兜底。

```js
if (window.dbv) { ... }                              // 明文：快，体积大
else if (window.dbv_base64) { ... }                  // 压缩：体积小 4 倍
else throw new Error("where is dbv?")                // 缺文件明确报错
```

**解压只用了 6 行、零依赖**（浏览器原生 API）：

```js
async function Gg(e) {
  let t = new DecompressionStream("gzip");
  let r = t.writable.getWriter();
  r.write(e); r.close();
  let n = await new Response(t.readable).arrayBuffer();
  return new TextDecoder().decode(n);
}
```

**用完即删，释放内存**：

```js
async function ft(e) {                 // 动态插 <script>
  let t = document.createElement('script');
  t.src = e;
  await new Promise((r,n) => { t.onload=r; t.onerror=n; document.head.appendChild(t); });
}
// 调用方随后 delete window.dbv_base64
```

### 1.4 抖珍藏做不到的事（我们的差异点）

| 能力 | 抖珍藏 | 我们的需求 |
|---|---|---|
| 浏览 | ✅ | ✅ |
| 删除素材 | ❌ 只能回扩展里删 | ✅ 要在 HTML 里删 |
| 重命名 | ❌ | ✅ |
| 星标/标签/收藏夹 | 部分（依赖独立 db 文件） | ✅ 双向持久化 |
| 数据更新 | 全量重写 | 全量重写即可（**实测 8MB，无写放大**） |

**根因**：`file://` 沙盒下，JS 不能任意写本地文件。
抖珍藏绕开这个限制的方式是「只读快照」；我们要双向，必须用 FSA 再授权一次。

> **实测补充（T10/T11b）**：`showDirectoryPicker` 在 `file://` 下**能弹出、能写入**，
> 句柄也能存进 IndexedDB 并在重启后读回——**但权限会降为 `prompt`**。
> 所以「再授权一次」的真实含义是「每次打开点一次允许」，不是「每次重选目录」。
>
> **另**：抖珍藏「全量重写 1MB/次」看似落后，但实测我们 5 万条的明文 JSON 也只有 8MB、
> 解析 580ms。**它不是设计缺陷，是当时数据量下的合理选择**；我们照做即可，
> 原稿设想的「追加日志 + 定期合并」是**为一个不存在的 40MB 问题**增加的复杂度。

---

## 二、开源方案检索结果（按铁律，先搜后写）

### 2.1 检索方法与结果

用 `npm view` 逐个核实（版本、许可证、分发格式、体积），不凭印象。

| 需求 | 候选 | 版本 | 许可 | UMD/IIFE 可用 | 体积 | 结论 |
|---|---|---|---|---|---|---|
| **FSA 封装** | `browser-fs-access` | 0.38.0 | Apache-2.0 | ⚠️ 仅 cjs/esm，需自转 | 43 KB | **不采用**，见 2.2 |
| **压缩** | `fflate` | 0.8.3 | MIT | ✅ `umd/index.js` | 797 KB(包) | **不采用**，原生够用 |
| **全文搜索** | `minisearch` | 7.2.0 | MIT | ✅ `dist/umd/index.js` | 827 KB(包) | **可选**，见 2.3 |
| **IndexedDB** | `dexie` | 4.4.7 | Apache-2.0 | ✅ `dist/dexie.min.js`（UMD 头已核实） | **94 KB** | **候选**，见 2.4 |
| **IndexedDB** | `idb-keyval` | 6.3.0 | Apache-2.0 | ✅ `dist/umd.js` | 小 | **不采用**，功能太薄 |
| **图片画廊** | `photoswipe` | 5.4.4 | MIT | ✅ `dist/umd/photoswipe.umd.min.js` | **54 KB + CSS 7 KB** | **推荐**，见 2.5 |
| **虚拟滚动** | `@tanstack/virtual-core` | 3.19.11 | MIT | ⚠️ cjs/esm，无 UMD | — | **不采用**，见 2.6 |
| **Worker 通信** | `comlink` | 4.4.2 | Apache-2.0 | ⚠️ esm | — | **不采用**，当前无 Worker |

### 2.2 `browser-fs-access` 为什么不采用

它做的事：FSA 不可用时降级到 `<input type=file>`、统一 API。

**不采用理由**：
1. 我们**已经在用原生 FSA**（`app.js:1465` `showDirectoryPicker`、`getDirectoryHandle`、`createWritable`），且已验证可用；
2. 它只发布 `cjs` / `.modern.js`，**没有 UMD**。要放进扩展得自己用 esbuild 转一次，引入构建工具链——违背「零依赖、静态打包」现状；
3. 它的核心价值是「兼容旧浏览器降级」，而我们只跑 Edge/Chrome，不需要。

**结论**：自建薄封装（约 40 行），比引入它更划算。**这是「找不到合适轮子」的正当情形，但要如实记录。**

### 2.3 `minisearch` 可选

用途：5 万条时替代现在的 `indexOf` 子串匹配，支持前缀/模糊/权重。

**暂不采用理由**：
- 当前 63 条，`filtered()` 里的 `indexOf` 完全够用（实测 <1ms）
- 引入后要重构搜索语义（`-词` 排除、`@作者` 前缀），测试成本高
- 等数据量过万再评估

**记录为「待触发条件」**：条目数 > 10000 且用户抱怨搜索慢时再引入。

### 2.4 `dexie` 候选（需用户决策）

用途：替换自建 `db.js`（229 行 IndexedDB 封装）。

**优点**：UMD 直接可用；事务/版本迁移/索引声明式，成熟稳定（周下载 200 万+）。
**代价**：现有 `db.js` 已跑通（含 5 万条实测 105ms 首屏），换库要重写 3 处调用（indexer/save/sw-library）并重跑测试。

> **实测更正**：原稿推理里隐含「dexie 依赖 IndexedDB，而 `file://` 下 IDB 不可用，
> 所以它自相矛盾」。**这条推理是错的**——T8 实测 `file://` 下 IDB 完全可用
> （open + write ok）。所以 dexie 在目标环境**技术上没有障碍**。

**建议**：**暂不换**。理由只剩一条且是真实理由——它不是瓶颈（`db.js` 已跑通），
属于「为换而换」。与 `file://` 可用性无关。

### 2.5 `photoswipe` 推荐（与本方案无关，但可一并做）

用途：替换自建 `lightbox.js` 983 行里的图片缩放/手势/键盘导航。

**核实结果**：`dist/umd/photoswipe.umd.min.js` **54 KB**、`photoswipe.css` **7 KB**，MIT 许可，可静态放入 `lib/`。

**但与本次架构改造耦合度低**，建议**单独立项**，不混进这次数据层重构。

### 2.6 `@tanstack/virtual-core` 为什么不采用

只有 cjs/esm，无 UMD；且现有虚拟滚动（`app.js:616` `appendMore` + `paintWindow`）已实测 5 万条 105ms。

---

## 三、目标架构（方案 B）

### 3.1 目录形态

```
D:\personal\Downloads\video-rod\
├── 资源库.html                  ← 双击打开（本地入口，**必须与素材同级**）
├── _library/                     ← 复用现有索引目录，不另建 _index/
│   ├── index-20261107.json       ← 现有格式，扩展侧写（人可读、可拷走）
│   ├── index-20261107.json.js    ← 同一份数据的 <script> 可执行版（T5 唯一可用通道）
│   └── app.js                    ← 前端脚本（按序 <script> 加载，无需构建）
├── _回收站/                      ← 现有回收站，不变
├── 花瓣/ …                       ← 素材本体，不变
└── 其他站点/ …
```

> **两处修正**：
> 1. **不再新建 `_index/`**。现有 `indexer.js` 已经把快照写在 `<根>/_library/index-YYYYMMDD.json`
>    （`SNAP_DIR='_library'`，`SNAP_RE=/^index-(\d{8})\.json$/`，保留 7 份）。另起 `_index/`
>    会产生**两套互不兼容的快照格式**，必然分叉。
> 2. **`_index` 必须进 `SKIP_DIRS`**。`indexer.js:30` 现在是
>    `{_verify, _回收站, _library, _migration, _selftest}`——若真新建 `_index/`，
>    全量扫描会把索引文件当素材收进库。既然改为复用 `_library`，此坑自然消失
>    （`_library` 已在跳过表里）。

### 3.2 运行时职责划分

| 环节 | 扩展（MV3） | 本地 HTML |
|---|---|---|
| 下载时抓站名/作者 | ✅ 有 DOM | ❌ |
| 写素材文件 | ✅ FSA | ✅（可写，T10 实测） |
| 写索引快照 | ✅ 主写方 | ⚠️ 技术上可行，但两边同写需防冲突 |
| 浏览/筛选/预览 | — | ✅ 主战场 |
| 删除/改名/星标 | 可做但体验差 | ✅ 主战场（状态存 IDB，T8 实测可用） |

**关键**：两边都能通过 **FSA 目录句柄**写同一批文件，不需要后台服务、不需要端口。
但**同一时刻只让一边写索引快照**——写入方是扩展，HTML 侧只写自己的 IDB 状态。

### 3.3 数据流

```
下载时（扩展）
  抓站名 → 写素材文件 → 写 VRDB(file/thumb/setting) → 更新 _library 快照
                         ↓
打开 资源库.html
  1) <script src="_library/index-*.json.js">   ← 唯一能用的读取通道（T5）
  2) 读自己的 IndexedDB（星标/收藏夹/缩略图缓存/设置）  ← T8 实测可用
  3) 合并 → 渲染
  4) 首次：showDirectoryPicker 选根目录，句柄存 IDB
     之后每次打开：句柄还在，但权限是 prompt → 点一次「允许」即可（T11b）
                         ↓
用户在 HTML 里删除/改名
  → FSA 改/删真实文件
  → 更新 IDB 里的条目状态
  → 扩展下次唤醒时以磁盘为准校正快照
```

> **修正**：原稿写「句柄存 IndexedDB」是对的（T11 通过），但漏了一个关键事实——
> **重启后权限会从 `granted` 降为 `prompt`**（T11b）。所以体验是
> 「**不用重新选文件夹，但每次打开要点一次允许**」，不是完全免授权。
> 这个成本必须在方案里如实写明，不能当作「秒开」。

### 3.4 索引格式与写入策略

**实测数据**：5 万条明文 JSON 为 **8MB**，`<script src>` 加载 + 解析 **580–644ms**，堆占用 43MB。

**方案：明文 JS 单文件 + 定期重写**

| 时机 | 动作 | 成本 |
|---|---|---|
| 扩展入库 | 写 VRDB；快照按现有 `snapshot()` 每天一份 | 一次性 8MB |
| 打开 HTML | `<script src>` 读最新快照 | ~0.6s（5 万条） |
| 状态变更（星标/标签） | 只写 HTML 侧 IDB | 毫秒级 |

**为什么不压缩（推翻原稿 §3.4 和 §1.3 的沿用）**：
- 原稿担心「5 万条 40MB，不能全量重写」。实测明文 JSON 只有 **8MB**，
  不是 40MB；而 gzip+base64 反而**多一层解码**。
- 抖珍藏用 gzip+base64 的真实动机不是省体积，而是 **`.json` 读不到，只能走
  `<script src>` 注入 `window.xxx = "..."`**（T6/T7 失败、T5 通过证明）。
- 结论：**存成 `.js` 是必须的，压缩是可选的**。先用明文 `.js`，
  若将来真到几十万条再考虑在扩展侧压缩。

**为什么不引入 SQLite**（原稿两条理由，实测后只剩一条）：
- ❌ 原稿说「`file://` 不能开 Worker」——**实测可开（T14）**，此理由作废。
- ✅ 仍然成立的理由：`file://` 下无法用 OPFS，sql.js 需 1.5MB WASM，
  而 8MB 明文 + 0.6s 解析**已经够用**。按「零依赖优先」铁律，不引入。

### 3.5 兼容性风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 每次打开要点一次「允许」授权 | 1 次点击 | 如实告知；用一句话说明「只点允许，不必重选目录」 |
| `fetch`/XHR 读不到本地文件 | 只能用 `<script src>` | 索引固定输出 `.js` 形态（已实测） |
| `file://` 的 IDB 与扩展 IDB **互相隔离** | 两边状态不同步 | 以磁盘文件为唯一真相源；HTML 侧 IDB 只存视图态 |
| 用户误删 `_library/` | 打不开 | `资源库.html` 内嵌兜底提示（学抖珍藏 `.fallback`） |
| 换了盘符/目录 | 相对路径失效 | 页面与素材必须同级；移动整目录即可 |

---

## 四、改造清单（分阶段，每阶段可独立验收）

### 阶段 1：索引输出 `.js` 形态（只读打通）

| # | 文件 | 动作 |
|---|---|---|
| 1.1 | `js/library/indexer.js` | `snapshot()` 现在只写 `_library/index-YYYYMMDD.json`；**同一份 payload 再写一份 `.json.js`**（`window.__vrIndex = {...}`），供 `file://` 页面用 `<script src>` 读取 |
| 1.2 | `js/library/snapshot-loader.js`（新增，~60 行） | `loadSnapshot()`：动态插 `<script>` → 读 `window.__vrIndex` → 删全局变量释放内存。**不压缩、不解码** |
| 1.3 | `js/library/indexer.js` | 确认 `SKIP_DIRS` 已含 `_library`（现状已含，无需改） |

**验收**：扩展里点「写快照」→ `_library/` 下同时出现 `.json` 与 `.json.js` → 本地 HTML 能读到条目。

> **原阶段 1 全部作废**：原稿的 `snapshot.js` / `saver.js` / `loader.js` 三件套是**重复造轮子**——
> `indexer.js` 已有 `snapshot()`（写快照）、`latestSnapshot()`（读最新快照）、
> `scanSnapshot()`（解析成条目），且已跑通 35/35 测试。
> 原稿要的「gzip → base64 → 追加日志 → 满 500 条合并」整套机制，
> 在实测（8MB / 580ms）面前没有必要。

### 阶段 2：本地 HTML 入口（无构建）

| # | 文件 | 动作 |
|---|---|---|
| 2.1 | `资源库.html`（新增，模板） | 与素材同级；按序 `<script src>` 加载现有模块（`library.html` 实测 18 个 `<script>`），**不需要 esbuild** |
| 2.2 | `js/library/env.js`（新增） | 环境探测：`chrome` 存在 → 走扩展 API；不存在 → 走 `snapshot-loader.js` + FSA |
| 2.3 | `js/library/settings.js` | 24 处 `chrome.storage` 改走 `env.getSetting()`（**最大工作量集中在这**，1263 行） |
| 2.4 | `js/library/ui.js` | **不打包**：942 行，仓库内无任何 HTML 引用它，属死代码 |

**验收**：双击 `资源库.html` → 看到素材、能筛选、能预览（对应 T1–T5 已通过的能力）。

### 阶段 3：状态存储 + 授权

| # | 文件 | 动作 |
|---|---|---|
| 3.1 | `js/library/fsa.js`（新增，~40 行） | `pickRoot()` / `getRoot()` / `verify()`；句柄存 IndexedDB（T11 实测可存） |
| 3.2 | 授权流程 | 首次：`showDirectoryPicker` 选根目录；**之后每次打开：句柄已在，权限 `prompt`，只需点一次「允许」**（T11b 实测） |
| 3.3 | 状态层 | 星标/标签/收藏夹/缩略图缓存 → HTML 侧自己的 IndexedDB（T8 实测可用）；`app.js` 的 `saveFavs()`、`thumbs.js` 直接复用 |

**验收**：HTML 里加星标 → 刷新还在 → HTML 里删一张图 → 磁盘文件消失。

### 阶段 4：扩展瘦身（可选）

扩展只保留：内容脚本抓取、下载、写快照。资源库页面从扩展里移除（或保留作兼容）。

---

## 五、明确不做的（范围边界）

| 不做 | 理由 |
|---|---|
| 引入 SQLite / WASM | 8MB 明文 + 580ms 解析已够用（T13）；`file://` 下无 OPFS。**注**：原稿理由「Worker 不可用」已被 T14 推翻 |
| 引入 React / Vue | 现有原生 JS 已跑通，重写风险远大于收益 |
| 引入 `browser-fs-access` | 已复核：0.38.0 的 `exports` 只给 cjs/modern，**确实无 UMD**；且我们已用原生 FSA |
| 引入 `dexie` | 非瓶颈，为换而换（**与可用性无关**：T8 证明 IDB 在 `file://` 下可用） |
| 起本地 HTTP 服务 | 违背「双击即用」，且要处理端口/防火墙 |
| gzip + base64 + `DecompressionStream` | 实测明文只有 8MB；压缩是为绕过 `fetch` 不可用而做的妥协，而 `.js` 形态已解决读取问题 |
| 追加日志 + 满 500 条合并 | 它解决的是「40MB 全量重写」，实测总量只有 8MB，问题不存在 |

---

## 六、已定的决策（原「待确认」逐条落定）

| # | 原问题 | 结论 | 依据 |
|---|---|---|---|
| 1 | 阶段 2 要不要引入 esbuild | **不引入**，按序 `<script>` 加载 | `library.html` 现为 18 个 script，`file://` 下本地请求无网络成本 |
| 2 | `资源库.html` 放哪 | **素材库根目录**，与素材同级 | **这是相对路径能用的前提**（T1–T4 实测），不是审美偏好 |
| 3 | 旧 `library.html` 是否保留 | **保留**，两者并存 | 用户拍板；扩展页有持久句柄与全功能，本地页负责便携/离线 |
| 4 | 写操作模型 | **HTML 内直接 FSA**，每次会话点一次「允许」 | 用户拍板；T11b 证明不必重选目录 |
| 5 | 每次打开都要授权吗 | **要点一次「允许」，不重选目录** | T11b：`permission=prompt` |

---

## 七、审计要点（已完成，保留供复核）

1. ~~**1.2/1.3 结论是否有误**~~ → **已实测更正**：抖珍藏本地库是**纯读**
   （`indexedDB`/`localStorage`/`showDirectoryPicker`/`createWritable`/`fetch` 全为 0 处）；
   它零权限的真正原因是「只读 + 相对路径」两条，不是「FSA 双写」。**B 方案仍然成立**
   （T1–T4 全通过），但成立的理由与原稿不同。
2. ~~**3.4 增量策略是否有更简单的做法**~~ → **有，而且不需要任何机制**：
   实测 5 万条明文 8MB / 580ms，直接全量写即可。原「40MB 写放大」不成立。
3. ~~**2.2 自建 FSA 封装是否偷懒**~~ → **不是偷懒**：已复核 `browser-fs-access` 0.38.0
   只发布 cjs/modern，无 UMD，MV3 下必须打包才能用，违背零构建现状。自建 40 行成立。
4. ~~**阶段 2 的构建能否避免**~~ → **能，已定不引入 esbuild**。原稿担心的「6 次请求」
   实际是 18 个本地 script，`file://` 下无网络往返，成本可忽略。