# S5b：批量选择 + 重命名

> 日期：2026-10-24 ｜ 分支：`feat/s5b` ｜ 前置：S5 删除与回收站（`docs/FRONTEND-UI-SYSTEM.md` §13）
> 本文是 S5b 的唯一实现口径：先定交互与 API，再写代码；与 `docs/FRONTEND-UI-SYSTEM.md`、`docs/TESTING.md` 冲突时以本文为准（S5b 范围）。

---

## 1. 范围与不做的事

### 1.1 做

| 块 | 内容 |
|---|---|
| 批量选择 | 顶部「批量」按钮进入选择模式；卡片/表格行出现勾选；底部浮条（已选 N 项 / 全选 / 取消 / 移到回收站 / 退出）；`Esc` 退出；筛选/搜索变化清空选择 |
| 批量删除 | 复用 `VRTrash.remove(relPaths)`（单批次）与现有确认框；成功后刷新列表、退出选择模式、刷新回收站徽标 |
| 重命名 | 右键菜单「重命名」（单选用）；`VRRename.rename(relPath, newName)` 引擎；自绘弹窗；文件复制→校验→删源；索引换 key |
| 测试 | 新增 `tools/cdp-batch-test.py`；回归 `cdp-library-page-test.py` / `cdp-trash-test.py` / `cdp-viewer-test.py` |

### 1.2 不做（明确排除）

- **不做批量重命名**（编号/替换/正则）。原型有入口，本轮只做单条重命名。
- **不做批量移动/导出清单**。回收站与批量删除之外的动作不进本轮。
- **不改 `trash.js` / `trash-ui.js` 的既有行为**，只在 `trash-ui.js` 的菜单里加一个 `rename` 分支。
- 不改 `manifest.json`、`background.js`、图片下载线；本轮不动 Service Worker，因此**不需要新 profile**。
- 不做重命名的撤销/回滚（复制校验失败时清理目标副本，仅此）。

---

## 2. 批量选择

### 2.1 状态机

```
idle ──(点 #libBatch)──> selecting ──(点 #libBatch / 退出 / Esc)──> idle
                            │
                            ├─ 点卡片/行：切换该条勾选（不打开查看器）
                            ├─ 全选：把「当前渲染列表」全部加入选择
                            ├─ 取消：清空选择，仍留在 selecting
                            ├─ 移到回收站：确认 → VRTrash.remove → 刷新 → idle
                            └─ 筛选/搜索变化：清空选择，仍留在 selecting
```

- 选择态用 `document.body.classList('batch-mode')` 驱动样式，**不改网格 DOM 结构**（表格列数保持 8 列，回归断言依赖）。
- 勾选元素 `.batch-check` 常驻 DOM、默认 `display:none`，仅 `batch-mode` 下显示；选中态由 `.lib-card.sel` / `.lib-row.sel` 表达。
- 卡片右上角的星标 `☆` 与 `⋯` 在批量模式下隐藏（避免误触）；右键菜单仍可用。
- 选择集合以 `relPath` 为键，保持插入顺序（底部浮条不需要顺序，但删除批次清单顺序稳定）。

### 2.2 交互细则

| 对象 | 操作 | 行为 |
|---|---|---|
| 顶栏 | `#libBatch` | 进入/退出选择模式；`aria-pressed` 同步 |
| 卡片 | 单击 | 选择模式：切换勾选；普通模式：打开查看器（行为不变） |
| 卡片 | `Enter` / `Space` | 与单击一致（键盘可达） |
| 表格行 | 单击 | 同上 |
| 底部浮条 | `#libBatchAll` | 全选当前渲染项（受筛选/搜索影响，不是全库） |
| 底部浮条 | `#libBatchClear` | 清空选择，留在选择模式 |
| 底部浮条 | `#libBatchTrash` | 0 项时禁用；确认框 → 批量软删除 |
| 底部浮条 | `#libBatchExit` | 清空选择并退出 |
| 键盘 | `Esc` | 退出选择模式；**若确认框/右键菜单/重命名弹窗/查看器开着，交给它们处理**（不抢 Esc） |
| 筛选 | 类型/平台/博主/星标 chip、搜索框、排序无关 | 清空选择，模式保留 |
| 批量删除后 | — | 退出模式 + 重新拉索引 + 刷新徽标 + Toast |

批量删除的确认文案固定为：

> 已选 N 项将移到 _回收站，之后可以从回收站恢复。

失败时（无句柄/权限）：Toast 复用 `VRTrashUI` 的 `LIB_E_NO_PERM` 文案，指向设置页「授权目录并全量扫描」。

### 2.3 新增 DOM（`library.html`）

| id | 位置 | 说明 |
|---|---|---|
| `libBatch` | `.top-actions` | 顶栏「批量」按钮 |
| `libBatchBar` | `</main>` 之后、页面级 | 底部浮条，`hidden` 默认 |
| `libBatchCount` | 浮条内 | `已选 N 项` |
| `libBatchAll` / `libBatchClear` / `libBatchTrash` / `libBatchExit` | 浮条内 | 见上表 |

### 2.4 模块边界

新增 `js/library/batch.js`（`VRBatch`），只负责选择状态、浮条与批量删除编排；**渲染仍归 `ui.js`**，`ui.js` 提供三个回调：

```js
VRBatch.init({
  getRendered: () => rendered,          // 当前渲染列表（全选范围）
  getEntry: rel => map[rel],            // 取索引条目
  reload: loadData,                     // 删除后重拉
  toast: VRTrashUI.toast
});
```

`ui.js` 在 `renderMain()` 末尾调 `VRBatch.refresh()` 重新套用选中态（重渲染后 DOM 会丢 class）；在 `apply()` 入口调 `VRBatch.clearSelection()` 实现「筛选变化清空选择」。

---

## 3. 重命名

### 3.1 引擎 API（`js/library/rename.js`，`VRRename`）

```js
const r = await VRRename.rename(relPath, newName);
// → { relPath, fileName }
```

约束：

1. `newName` 是**最终文件名**，不是路径；目录不变。
2. 扩展名保护：`newName` 不含 `.` 且原文件有扩展名时，补回原扩展名（`b` → `b.png`）。显式写扩展名则以用户输入为准（允许改扩展名，`type` 按新扩展名重算）。
3. 同目录内「复制 → 校验大小 → 删源」，因为 FSA 没有 `move()`；与 `VRTrash.moveFile()` 同口径。
4. 需要 `readwrite` 目录句柄；无句柄或未授权 → `LIB_E_NO_PERM`。
5. 索引：删旧 key → 写新 key；`relPath` / `fileName` / `absPath` / `thumbKey` 更新；`starred` / `tags` / `platform` / `creatorId` / `mtime` / `size` / `duration` 等保留。
6. `thumbKey` 置空，让 `VRThumbs` 下次渲染重新生成（旧缩略图 blob 暂留 `thumb` store，不做级联删除，见 §6）。
7. 写 `<根>/_migration/ops-<stamp>.json` 审计（`action: 'rename'`），失败不阻断主流程。

### 3.2 路径口径（最容易错的地方）

索引 key 首段是 `subdir`（`video-rod/...`），而目录句柄可能指向两种位置：

- **资源库根**（`<下载目录>/video-rod`）：句柄里**没有**首段，需要 `stripPrefix(relPath, prefix)`；
- **下载目录**（`<下载目录>`，OPFS 测试注入即此形态）：句柄里**有**首段，直接用完整 `relPath`。

因此引擎按「**先剥前缀，再原样**」的顺序探测，取第一个真实存在的路径作为文件系统路径；两者都不存在 → `LIB_E_NOT_FOUND`。新路径与旧路径同目录，只替换最后一段。

### 3.3 校验与错误码

| 码 | 触发条件 | 界面表现 |
|---|---|---|
| `LIB_E_NAME` | 空名/全空白；含 `\ / : * ? " < > \|`；含控制字符；`.` 或 `..`；以点或空格结尾；与原文件名相同 | 弹窗内就地红字，不关闭 |
| `LIB_E_EXISTS` | 同目录已有同名文件（大小写不敏感比较） | 就地提示「同目录已有同名文件」 |
| `LIB_E_NO_PERM` | 无目录句柄 / 未授予 readwrite | 就地提示去设置页授权 |
| `LIB_E_NOT_FOUND` | 源文件不存在（索引与磁盘不同步） | 就地提示，可刷新列表 |
| `LIB_E_COPY` | 复制后大小不一致（空间不足/占用） | 清理目标副本，提示重试 |
| `LIB_E_DB` | 索引读写失败 | 提示刷新；文件已改名时以磁盘为准 |

错误对象同时带 `code` 与 `vrCode`（与 `trash.js` / `indexer.js` 两种历史写法兼容）。

### 3.4 界面

- 入口：卡片/表格行右键 → 「重命名…」（`data-act="rename"`）。
  - 仅单选可用：普通模式恒可用；批量模式下**已选恰好 1 项**时可用，其他情况 `disabled` + `title="批量选择时只能重命名单个文件"`。
  - 查看器信息面板不加按钮（本轮范围）。
- 弹窗（自绘，替代 `prompt()`）：

| id | 说明 |
|---|---|
| `libRenameMask` | 遮罩层，点空白关闭 |
| `libRenameTitle` / `libRenameDir` | 标题；「目录：video-rod/X/u/图片/」只读展示 |
| `libRenameInput` | 文件名输入；打开时**选中主体（不含扩展名）**；`b.png` → 选中 `b` |
| `libRenameError` | 就地错误行，默认隐藏 |
| `libRenameOk` / `libRenameCancel` | 保存 / 取消 |

- 键盘：`Enter` 提交、`Esc` 取消（两者都先于全局 Esc 处理）。
- 提交前若查看器开着先关闭（Windows 文件占用，和删除同口径）。
- 成功后：Toast「已重命名：<新名>」+ `loadData()` 刷新；失败：弹窗保持打开、就地报错。

### 3.5 模块边界

`rename.js` 同时含引擎与弹窗（本轮只有一个入口，拆两文件不划算），导出：

```js
VRRename = { rename, open(relPath), init(opts), _validate(name, oldName) }
```

`ui.js` 通过 `VRTrashUI.init({ rename: rel => VRRename.open(rel) })` 把入口接进右键菜单；`rename.js` 自己不监听卡片事件。

---

## 4. 索引与统计的连带影响

| 位置 | 影响 |
|---|---|
| 概览 KPI | 重命名不改 `size`/`type`（扩展名不变时），数字不变；批量删除后条数与占用下降 |
| 平台/博主计数 | 目录不变，计数不变 |
| 回收站徽标 | 批量删除后 +N；重命名不影响 |
| 缩略图 | `thumbKey` 置空 → 下次进入视野重新生成；当前页刷新后短时显示占位图 |
| 快照 | 不主动重写；下次「写快照」时以新 `relPath` 落盘（旧快照仍指向旧路径，属已知行为） |

---

## 5. 验收标准

### 5.1 新增 `tools/cdp-batch-test.py`（OPFS 句柄注入 + 真实文件）

必须覆盖：

1. 模块加载：`VRBatch` / `VRRename` 均为 object；页面渲染种子卡片数正确。
2. 进入批量：`body.batch-mode`、浮条可见、勾选框可见、计数 `已选 0 项`。
3. 勾选 2 项：计数 `已选 2 项`、两张卡 `sel`、**查看器未打开**。
4. 全选 → 当前渲染数；取消 → 0 且仍在批量模式。
5. 批量删除 2 项：确认框出现且文案含条数 → 确认后 `VRTrash.status().count === 2`、索引少 2 条、原路径无文件、`_回收站` 下有文件；模式已退出。
6. 退出/`Esc` 均能退出；筛选变化清空选择。
7. 重命名 `b.png → c.png`：新文件存在且内容不变、旧文件不存在、索引新 key 有值且 `fileName/absPath/thumbKey` 正确、`starred`/`tags` 保留、旧 key 不存在。
8. 错误码：非法字符/空名/同名 → `LIB_E_NAME`；目标已存在 → `LIB_E_EXISTS`；无句柄 → `LIB_E_NO_PERM`。
9. 控制台 0 error / 0 exception。
10. 产出截图 `deliverables/assets/batch-bar.png`、`deliverables/assets/rename-dialog.png`。

### 5.2 回归（必须全绿）

| 套件 | 基线 |
|---|---|
| `tools/cdp-library-page-test.py` | 30/30 |
| `tools/cdp-trash-test.py` | 27/27 |
| `tools/cdp-viewer-test.py` | 27/27 |

> 说明：`cdp-trash-test.py` 的 C2 断言校验右键菜单项列表，S5b 新增「重命名」后预期列表同步为
> `preview / open / copy / star / rename / trash`（断言条数不变，仍为 27 条）。

### 5.3 人工确认

- 网格/表格两种视图下勾选框位置不挤压内容；900px 与 860px 断点无横向溢出。
- 深色模式下浮条与弹窗对比度正常（复用 `--lib-*` token）。
- 重命名弹窗默认选中文件名主体，直接键入即替换。

---

## 6. 已知边界与风险

1. **不做撤销**：重命名是「复制→删源」，中途失败已清理目标副本；成功即生效。
2. **旧缩略图 blob 残留**：`thumbKey` 置空后旧 blob 不删（`VRDB` 无 `deleteThumb`），属可接受的少量垃圾，后续 S6 清理任务处理。
3. **大小写重命名**：Windows 大小写不敏感，`b.png → B.png` 会被判为同名（`LIB_E_NAME`）。FSA 下做两步重命名（临时名）成本高，本轮不支持，界面提示改用不同名字。
4. **符号链接/占用**：重命名会先关闭查看器；若外部程序占用源文件，删源失败 → 返回 `LIB_E_COPY` 语义的失败提示，文件保持原名（复制副本已清理）。
5. **快照不联动**：旧快照仍含旧 `relPath`，恢复旧快照会把历史路径写回索引（ADR-030 的「缺失只标不删」会兜住，不会丢文件）。
6. **批量选择范围**：只对「当前筛选结果」全选，不做跨页/跨全库。
