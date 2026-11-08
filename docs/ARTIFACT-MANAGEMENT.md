# 苏哥的钓鱼竿 — 产出物与工作区管理规范

> 版本：v1.0 ｜ 日期：2026-11-08 ｜ 状态：草案（待苏哥审核）
> 一句话：**源码、构建产物、测试残留、交付文档四类东西各有各的地方，谁也不许污染谁。**
> 与 [`deliverables/DELIVERABLES.md`](../deliverables/DELIVERABLES.md) 的关系：那份管「交付物怎么登记、怎么定稿」，本份管「东西该放哪个物理位置、哪些绝不能进仓库和加载目录」。两份同时有效，冲突以本份为准。

---

## 0. 为什么有这份规范

2026-11-08 在 `edge://extensions` 上发现扩展显示 **1,405 MB**，而扩展本体只有约 5 MB。拆开看：

| 混进来的东西 | 体积 | 本该在哪 |
|---|---|---|
| `.work/`（E2E 浏览器 profile、探针残留） | 611 MB | 仓库外 |
| `deliverables/assets/`（审计截图，已进 git） | 109 MB | 见 §4 |
| `.git/`（含上述截图历史） | 212 MB | 不可避免但可瘦身 |
| **合计虚胖** | **约 1.4 GB** | — |

根因不是「文件太大」，而是**没有物理边界**：加载目录 = 仓库根目录，于是文档、测试残留、交付物全被算进扩展体积，也全被 git 管着。

本规范要建立三条边界：

1. **加载边界**：浏览器只加载 `dist/`，那里只有扩展运行时文件。
2. **工作区边界**：测试 profile、下载样本、一次性草稿全部在仓库外。
3. **仓库边界**：进 git 的只有源码、文档索引和少量必需资产。

---

## 1. 四个位置，各管一段

```
D:\test\download\
├── work\                     # 🧹 工作区（仓库外，不进 git，可随时删）
│   ├── profiles\             #   浏览器 profile（E2E / 探针 / 登录态）
│   ├── media\                #   测试媒体样本
│   ├── downloads\            #   测试下载落盘
│   ├── snapshots\            #   IndexedDB 快照、恢复点
│   └── scratch\              #   一次性脚本草稿、临时输出
│
├── video-rod\                # 📦 仓库（git 管这一层）
│   ├── docs\                 #   工程文档
│   ├── deliverables\         #   交付物（登记见 DELIVERABLES.md）
│   ├── tools\                #   可复用测试/构建脚本
│   ├── archive\              #   归档留证
│   ├── dist\                 #   ⚙️ 构建产物（gitignore，由脚本生成）
│   └── <扩展源码>            #   js/ css/ lib/ img/ _locales/ catch-script/ *.html manifest*.json
│
└── ...
```

**判断口诀**（拿不准时对号入座）：

| 你想放的 | 放哪 | 理由 |
|---|---|---|
| 扩展跑起来要读的文件 | 仓库根（源码区） | 进 dist 的源头 |
| 跑测试产生的垃圾 | `..\work\` | 不是产品的一部分 |
| 能给人看的原型/截图/报告 | `deliverables/` | 要登记、要定稿 |
| 装给别人用的包 | `dist/` | 一次性生成，随时可重建 |
| 没用了但删了心虚 | `archive/` | 留证 |

**硬规则**：`work\` 与 `dist\` **都不进 git**，且都**不能被浏览器加载**。

---

## 2. 加载边界：浏览器只加载 `dist/`

### 2.1 规则

- `edge://extensions` / `chrome://extensions` 里 **只允许加载 `video-rod\dist\`**，禁止再加载仓库根目录。
- `dist/` 由 `node tools/build-dist.js` 生成，**禁止手工往里放文件**。
- `dist/` 已在 `.gitignore` 中，永不提交。

### 2.2 `dist/` 里允许有什么

白名单（**只有这些**）：

| 条目 | 说明 |
|---|---|
| `manifest.json` | 运行时清单（不带 `.firefox` 变体） |
| `*.html` | 扩展页面（popup / options / library / image / m3u8 / mpd / preview / downloads / downloader / json / offscreen / install） |
| `css/` | 全部样式 |
| `img/` | 图标与 UI 图 |
| `js/` | 全部脚本（含 `js/lib/`、`js/library/`、`js/yt/`） |
| `lib/` | 第三方库（含 `lib/plyr/`） |
| `_locales/` | 11 种语言 |
| `catch-script/` | 运行时注入脚本（`background.js` 动态 importScripts 需要） |

黑名单（**永不进 dist**）：`docs/` `deliverables/` `tools/` `test-site/` `archive/` `dist/` 自身、`.work/`、`.git/`、`*.md`、`manifest.firefox.json`、`node_modules/`、任何 `*.zip`。

> **为什么不能只按 manifest.json 枚举**：`background.js` 里有大量 `importScripts` 与动态注入，`manifest.json` 并未列全（例如 `js/library/dedup.js`、`js/xhs-media.js`、`js/yt/yt-download.js`）。按白名单整目录拷贝比按文件枚举稳。

### 2.3 验收

改完源码后必须：

```bash
node tools/build-dist.js          # 重新生成 dist/
# 然后 edge://extensions 上点「重新加载」
```

验收三条：
1. `dist/` 内不含 `docs`、`tools`、`deliverables`、`test-site`（脚本自检，不全则报错退出）。
2. 扩展详情页显示的大小 ≈ 扩展本体大小（不应再出现百 MB 级数字）。
3. 所有功能页能打开、控制台 0 error。

---

## 3. 工作区边界：测试产物一律在仓库外

### 3.1 位置

**唯一合法位置：`D:\test\download\work\`**（仓库的上一级）。

不允许：
- 在仓库内新建 `.work/`、`tmp/`、`test-output/` 等目录放测试产物；
- 在 `D:\test\download\` 下再新建 `.edge-*`、`.vr-*`、`.chromium-*` 这类散落 profile 目录（**历史遗留需一次性清理，见 §6**）。

### 3.2 脚本怎么找到它

测试脚本统一从环境变量读根目录，**禁止硬编码**：

```js
// tools 下新增/修改脚本一律这样写
const WORK = process.env.VR_WORK || path.resolve(__dirname, '..', '..', 'work');
```

```python
# Python 版
WORK = Path(os.environ.get("VR_WORK") or Path(__file__).resolve().parents[2] / "work")
```

- 默认值 = 仓库上一级的 `work`，正常情况无需设置环境变量。
- 需要临时改位置时：`set VR_WORK=D:\somewhere\work`。
- 迁移期兼容：若 `VR_WORK` 未设置且仓库内仍存在旧 `.work/`，脚本可回退使用旧路径并在启动时打印一行提示（可选实现，不作为要求）。

### 3.3 `work/` 内部约定

| 子目录 | 放什么 | 谁清理 |
|---|---|---|
| `profiles/` | 浏览器 profile（按测试名分子目录） | E2E 启动前自删重建 |
| `media/` | 测试视频/图片样本 | 手动，可随时删 |
| `downloads/` | 测试下载落盘 | 手动，可随时删 |
| `snapshots/` | DB 快照、restore 点 | 保留最近 N 份，其余手动删 |
| `scratch/` | 一次性草稿、临时 json/png | 随时删 |

**整个 `work/` 都是可丢弃的**：删掉不影响扩展运行，只影响下次测试要重新建 profile。

### 3.4 清理策略

- 每次 E2E 运行前，脚本删除自己的 profile 目录（保持空库语义）。
- 探针类脚本（一次性、跑完即弃）**必须**把自己的输出写进 `work/scratch/<任务名>/`，并在报告里注明。
- 建议每完成一个大里程碑，人工清一次 `work/profiles/` 里不再使用的 profile（判断标准：3 个版本内没跑过的）。

---

## 4. 仓库边界：什么进 git

### 4.1 必进

| 内容 | 理由 |
|---|---|
| 扩展源码（`js/ css/ lib/ img/ _locales/ catch-script/ *.html manifest*.json`） | 产品本体 |
| `docs/` | 工程文档 |
| `tools/` | 可复现测试与构建脚本 |
| `deliverables/DELIVERABLES.md`、`deliverables/reviews/*.md`、`deliverables/prototypes/*.html` | 规范、报告、原型，都是纯文本或小文件 |
| `archive/` | 归档留证 |
| 少量关键截图（`deliverables/assets/` 里被文档引用的） | 见 §4.2 |

### 4.2 `deliverables/assets/` 的收紧（v1.0 新增）

历史背景：该目录 109 MB、265 个文件全部进过 git，直接把 `.git` 撑到 212 MB。

新规则：

1. **新截图默认不进 git**。截图属于「可再生成的过程证据」，放 `work/scratch/shots/` 或本地，需要长期留存时按下面第 2 条处理。
2. **只有被文档引用的截图才可进 git**，且单张 **≤ 300 KB**（超过先压成 WebP/JPEG q80）。
3. 进 git 的截图必须登记在 `deliverables/DELIVERABLES.md` §4 登记表里（沿用既有规则）。
4. `deliverables/assets/` 的新增总量控制在 **10 MB 以内**；超了就说明该清理了。

### 4.3 永不进 git

`.work/`、`work/`、`dist/`、`node_modules/`、`*.zip`、`*.crx`、`*.pem`、`.env`、`*.local`、`__pycache__/`、`.tmp/`、测试媒体。

（`.gitignore` 已覆盖大部分，本规范以 `.gitignore` 为准；新增忽略项必须先改 `.gitignore`。）

### 4.4 历史瘦身（一次性）

> 执行前置：本机需安装 `git filter-repo`。安装方式见 §7。

目标：把已被 git 跟踪的大体积截图从历史中移除，`.git` 从 212 MB 降到约 30 MB 量级。

**必须遵守的顺序**：
1. **先完整备份仓库**（含 `.git`）到仓库外，例如 `D:\test\download\work\backup\video-rod-<日期>\`。
2. 记录当前所有分支与 tag（`git branch -a`、`git tag`）到 `work/scratch/`。
3. 用 `--dry-run` 先跑一遍，确认要移除的路径清单符合预期。
4. 正式重写后核对：`git log` 条数与提交信息、`git status` 干净、`git count-objects -vH` 体积下降。
5. 重写会改变所有 commit hash，**若有远端仓库必须先与远端解绑或强推**；本项目为本机自用，无远端。

**不做的事**：不重写源码历史、不合并提交、不改提交信息。

---

## 5. 扩展显示体积的目标值

| 状态 | 期望显示 |
|---|---|
| `dist/` 加载 | **约 5–8 MB**（扩展本体） |
| 若仍加载仓库根 | 不应被允许（见 §2.1），且会随 `work`/`deliverables` 膨胀 |

`edge://extensions` 的数字 = 加载目录的磁盘占用，**不是**扩展代码的真实大小。它虚胖的唯一原因就是加载了不该加载的目录。

---

## 6. 一次性清理清单（2026-11-08 已执行）

> 历史欠账，规范生效后不再产生。下表记录**实际执行结果**。

### 6.1 仓库内

| 对象 | 动作 | 状态 |
|---|---|---|
| `dist/` | 新增，由 `tools/build-dist.js` 生成 | ✅ 已生成（179 文件 / 4.71 MB） |
| `.work/`（仓库内） | 保留现存内容，新测试一律写仓库外 | ⚠️ 未迁移（29 个脚本仍引用 `.work`，见 §3.2 兼容说明） |
| `deliverables/assets/` 大图 | 历史瘦身 | ⏳ 待执行（需先装 `git filter-repo`） |

### 6.2 上级目录 `D:\test\download\`

**已清理**（2026-11-08）：
- 101 个测试 profile 目录（`.edge-*` / `.vr-*` / `.chromium-*` / `.test-*` / `.twinkstar-*`），约 103 个中的 101 个
- 调研残留：`_cft.zip`(80M)、`_gh_*.json`、`tw-list.json`、`tw2.json`、`_local_tree.txt`、`_beui2.json`、`_cft.json`
- 临时包：`mp4box-2.4.1.tgz`、`mp4-muxer.tgz`、`package/`、`vr-test/`

**保留**：

| 条目 | 原因 |
|---|---|
| `video-rod\` | 仓库本体 |
| `work\` | 新建的工作区（规范 §3） |
| `.edge-login-profile\` | 站点登录态（B站/X/小红书/微博等），删除需重新登录 |
| `_backup-video-rod-20261104\` | 历史瘦身前作为保险，瘦身完成并核对后可删 |
| `test-site\`（上级那个 3.4M） | 疑似较早的测试站副本，仓库内已有 `test-site/`；确认无引用后可删 |
| `.reasonix\`、`.workbuddy\` | 工具自身数据 |

> 清理原则：**删除前先列清单给人确认，不静默删**。

---

## 7. 工具与命令

| 命令 | 作用 |
|---|---|
| `node tools/build-dist.js` | 生成/刷新 `dist/`，带黑名单自检 |
| `set VR_WORK=D:\test\download\work` | 临时指定工作区（通常不需要） |
| `git count-objects -vH` | 查看 `.git` 体积构成（含垃圾对象） |
| `git gc --prune=now` | 回收游离对象（不重写历史） |
| `git filter-repo --path <路径> --invert-paths` | 从历史中移除指定路径（**需先备份**） |

安装 `git filter-repo`：

```bash
python -m pip install git-filter-repo
# 或 scoop install git-filter-repo
```

---

## 8. 规范维护

- 本规范与 `deliverables/DELIVERABLES.md` 并行有效；**物理位置**（§1–§3）以本份为准，**交付物登记与状态机**以那份为准。
- 改本规范 = 在 `docs/DECISIONS.md` 追加一条 ADR 说明改什么、为什么。
- 新增任何「放文件」的地方前，先回到 §1 的口诀对号入座；对不上就先问，别先建目录。
