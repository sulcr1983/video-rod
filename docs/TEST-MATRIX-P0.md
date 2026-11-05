# P0 回归矩阵：按钮 / 功能 / 数据安全（2026-11-06）

> 目的：把验收口径从“按钮点了没报错”升级为“输入 → 输出符合设计，附带副作用也正确”。
> 背景：盘点发现 45 条库记录里 10 条是 e2e 假数据，按钮级 e2e 有 58 项 `changed:false`，部分“可用”只是 UI 层假象。
> 本轮已建立的隔离设施：`e2e-all --isolated`（测试专用 profile/9490）、`vr-db-snapshot.py`（真实库快照/恢复/清理）、`e2e-buttons` 真实库守卫。

---

## 0. 测试环境规则（先遵守，再谈覆盖）

| 场景 | 规则 |
|---|---|
| 离线 UI/按钮回归 | **必须** `python tools/e2e-all.py --isolated --only <suite>`；测试 profile 在 `.work/e2e-profile`，每次启动前删除，端口 9490 |
| 真实站点回归 | 当前 profile（9480）+ 测试前 `vr-db-snapshot.py backup`，测试后 `restore` |
| 破坏性操作（移动/删除/清空） | 只在**临时测试库/临时副本**上做；真实库不做破坏性验证 |
| 假数据 | 只允许存在于测试 profile；真实库 `status` 必须 `测试假数据: 0` |
| 按钮验收 | 必须断言“点击后状态/数据/副作用”，不能只断言“没抛异常” |
| 测试清理 | 每个套件必须能重复跑；跑两次结果一致，库内容前后一致 |

---

## 1. 数据安全门禁（每次回归前）

| 门禁 | 命令 | 通过标准 |
|---|---|---|
| 真实库无假数据 | `python tools/vr-db-snapshot.py status --port 9480` | `测试假数据: 0`，`真实路径` = 当前真实文件数 |
| 测试不碰真实库 | `python tools/e2e-buttons.py --port 9480` | 必须拒绝并提示用 `--isolated` |
| 备份可恢复 | `backup` → 改动 → `restore` → `verify` | 条目数/relPath 集合一致 |
| 测试后真实库不变 | 回归前后各跑一次 `status` | 总条目/真实路径/假数据三项一致 |

当前基线（2026-11-06 清理后）：

- 真实库：**35 条真实文件，0 条假数据，0 条测试改名残留，0 条 e2e 标签残留**。
- 页面：`__vrBoot` 到 `load:35`，卡片 **35**。
- `e2e-all --isolated --only e2e-buttons`：**27/27 PASS**（10 条测试夹具，仅存在于隔离 profile）。
- `e2e-buttons --port 9480`：**已拒绝**（检出 35 条真实数据，未清空）。

---

## 2. 按钮矩阵（资源库）

> “当前状态”基于 2026-11-06 隔离回归 + 代码审查；“待补”是 P0 必须补齐的断言。

### 2.1 顶栏 / 树 / 筛选

| 按钮/功能 | 预期 | 当前状态 | 待补/归属 |
|---|---|---|---|
| `#typeTabs` 全部/图片/动图/视频/音频 | 卡片只显示对应类型，徽标计数自洽 | 隔离 10 条夹具通过 | 真实 35 条再跑一次（M6） |
| `#chips` 平台 chip | 只显示该平台；点 chip 清空残留搜索词 | 通过（含 X chip 修复） | 真实平台计数（M6） |
| `#search` 输入 | 交集/排除语法；清空恢复 | 通过（“微博”/不存在词） | 加 `-词` 排除真实数据断言 |
| `#sort` 最新/最早/大小/A-Z | 真实顺序变化且正确 | **PASS**（M2：真实 35 条、4 模式 14/14） | 无 |
| `#viewToggle` 网格/列表 | class/布局切换 | 通过 | 列表视图改用 `displayName`（M4） |
| `#tree` 根节点“全部素材” | 重置 q/plat/type，卡片回到全量 | 通过 | 真实 35 条断言（M6） |
| `#tree` 平台节点 | 展开/折叠作者；点平台筛选 | 通过 | 折叠状态与计数（M6） |
| `#tree` 作者节点 | 只显示该作者；再次点击可回平台 | 通过（“待整理”旧数据除外） | 旧数据归一化（M6） |
| `#treeSearch` | 过滤树节点 | 通过 | 真实作者名（M6） |
| `#rescanBtn` | 重扫后清筛选、刷新列表、toast 数量 | 通过（代码层） | 需真实增量文件测试（M6） |
| `#settingsBtn` / `#setClose` | 抽屉开/关 | 通过 | 无 |

### 2.2 批量条

| 按钮 | 预期 | 当前状态 | 待补/归属 |
|---|---|---|---|
| `#selectBtn` | 进入/退出选择模式，批量条显示/隐藏 | 通过 | 退出时 `is-on`/`hidden` 复位（M3） |
| `#batchAll` / `#batchInvert` / `#batchClear` | 全选/反选/清空，计数同步 | 通过 | 真实 35 条计数（M6） |
| `#batchFav` | 加入收藏夹，持久化 | 只验证存在/打开 | 加入/移除/重载后保留（M6） |
| `#batchMove` | 真实移动文件 + DB `relPath/absPath` 更新 | **FAIL**：`VRTrash.moveFile` 未导出，必失败 | **M3 修复** |
| `#batchTrash` | 移入回收站、可恢复 | 代码已接，未破坏性验证 | 临时副本删 2 恢复 1（M6） |
| `#batchExit` | 退出批量态 | 通过 | 批量条/按钮状态复位（M3） |

### 2.3 预览 / 播放

| 按钮/功能 | 预期 | 当前状态 | 待补/归属 |
|---|---|---|---|
| 卡片点击 | 打开真实媒体；缺失文件有明确占位 | 真实图片/视频可开 | 假数据/缺失态（M6） |
| `#pvPrev` / `#pvNext` / 胶片条 | 切换素材，计数/索引同步 | 通过 | 真实视频/图片混合（M6） |
| `#pvInfoBtn` | 信息面板开/关，字段无重复 | 通过 | 分组/空字段（M6） |
| `#pvHelpBtn` / `#keysheet` | 快捷键面板开/关 | 通过 | 全键位矩阵（M6） |
| `#pvClose` / Esc | 关闭预览 | 通过 | 无 |
| `#pvRename` → `#renameOk` | 改显示名；网格/列表/预览一致 | 立即生效 | **M4：重扫后保留、列表同步** |
| `#pvDelete` | 删除到回收站 | 只登记不点 | 临时副本（M6） |
| `#pvMove` | 移动 | 当前只 toast + 打开设置 | **M3/M5：真实入口或明确禁用** |
| `#pvTagAdd` / 保存 | 标签写入/移除/重载保留 | 通过 | 重扫后保留（M4/M6） |
| Plyr 播放/暂停 | `paused` 真变化，声音不被静音 | 真实视频有 16 控件；测试选假卡 | **M6：选真实视频 + readyState 等待** |
| 倍速 0.1/0.2/3 | 菜单/自绘面板可选中 | 代码已加 | 真实点击选中（M6） |
| `#autoBtn` 连播 | 开关状态 + 自动下一条 | 通过（开关） | 真实连播（M6） |

### 2.4 收藏夹

| 按钮/功能 | 预期 | 当前状态 | 待补/归属 |
|---|---|---|---|
| `#favMenuBtn` / `#favMore` | 菜单/抽屉开 | 通过 | 无 |
| `#favNewBtn` / `#favNewOk` | 新建收藏夹 | 通过（隔离） | 真实库持久化（M6） |
| `#favDrawerClose` | 关闭抽屉 | 通过 | 无 |
| `#favSaveFilter` | 当前筛选存为智能夹 | 未验证 | 重载后保留、成员正确（M6） |
| 收藏夹重命名/删除 | 不动物理文件，成员不丢 | 未验证 | M6 |

### 2.5 回收站 / 设置抽屉

| 按钮/功能 | 预期 | 当前状态 | 待补/归属 |
|---|---|---|---|
| `#trashBtn` / `#dwClose` | 回收站抽屉开/关 | 通过 | 无 |
| `#dwList` 恢复/彻底删除/清空 | 真实文件移动/删除/恢复 | 未验证 | 临时副本（M6） |
| `#sdDirBtn` | 授权/更换目录 | 当前打开完整设置页 | **M5：明确“授权当前目录”** |
| `#sdScanBtn` | 扫描并刷新 | 代码层 | 真实增量（M6） |
| `#sdRebuildBtn` | 重建索引不丢用户数据 | 代码层 | displayName/标签保留（M4） |
| `#sdTrashBtn` / `#sdOptionsLink` | 打开回收站/设置 | 通过 | 无 |

### 2.6 键盘 / 批量选择

| 键 | 预期 | 当前状态 | 待补 |
|---|---|---|---|
| Space | 快速预览 | 未单独验证 | M6 |
| ←/→ | 上/下一张 | 未单独验证 | M6 |
| F2 | 重命名 | 未单独验证 | M6 |
| Del | 删除到回收站 | 未单独验证 | M6 |
| Esc | 关闭预览/弹层 | 未单独验证 | M6 |
| Ctrl/Cmd+A | 批量全选 | 未单独验证 | M6 |

---

## 3. 功能矩阵（按钮之外的附带能力）

| 功能 | 验收断言 | 当前状态 | 归属 |
|---|---|---|---|
| 排序 | 真实 35 条下 `new/old/size/name` 四种顺序正确且互不相同 | PASS（14/14） | M2 已完成 |
| 搜索语法 | `词1 词2` 交集、`-词` 排除；真实作者/标题命中 | 部分通过 | M6 |
| 重命名持久化 | 改名 → `VRIndex.build({mode:'downloads'})` → 名字仍在；`relPath` 不变；列表同步 | 代码缺口 | M4 |
| 批量移动 | 临时副本移动 2 条：物理文件、DB `relPath/absPath`、缩略图重建、可移回 | 死键 | M3 |
| 批量删除/恢复 | 临时副本删 2 → 回收站 2 → 恢复 1 → 彻底删 1；manifest/DB/物理一致 | 未验证 | M6 |
| 只读/授权 | 无 handle：移动/删除禁用并说明；授权后可用；新 profile 无 `file://` 权限有提示 | 未实现 | M5 |
| 缩略图 | 真实 35 条首屏可见；缺失/失败有占位；93MB 视频不无限转圈 | 部分 | M6 |
| 预览/播放 | 真实图片 675×1200、真实视频 Plyr 16 控件；声音/暂停真实 | 链路可用 | M6 |
| 收藏夹持久化 | 新建/加入/移除/重载/重建索引后保留；不动物理文件 | 未验证 | M6 |
| 重扫自愈 | 重扫后清筛选、数量正确、无重复/无幽灵条目 | 代码层 | M6 |
| 测试隔离 | 连续两次回归真实库状态不变 | 已建立 | M1（本矩阵） |

---

## 4. 测试分层与命令

### L0 数据安全

```bash
python tools/vr-db-snapshot.py status --port 9480
python tools/vr-db-snapshot.py backup --port 9480 --tag pre-live
python tools/vr-db-snapshot.py restore --port 9480 --file .work/db-snapshots/<file>.json
python tools/vr-db-snapshot.py verify --port 9480 --file .work/db-snapshots/<file>.json
python tools/vr-db-snapshot.py clean-fixtures --port 9480 --dry-run
```

### L1 离线 UI/按钮（隔离 profile）

```bash
python tools/e2e-all.py --isolated --only e2e-buttons --reason "按钮回归"
python tools/e2e-all.py --isolated --reason "离线全量"
```

### L2 真实数据冒烟（M2 已建：`tools/library-realdata-e2e.py`）

建议新增 `tools/library-realdata-e2e.py`：
- 读取真实库，断言 `35/35` 条 `absPath` 存在；
- 首屏卡片数 = 真实条目数；首屏缩略图有 `naturalWidth>0`；
- 排序 4 模式在真实数据上正确；
- 改名 → 重扫 → 名字保留；
- 打开真实视频，等 `readyState>=1`，播放/暂停；
- 不修改真实文件；改名/标签用快照恢复。

### L3 真实站点（当前 profile + 快照/恢复）

```bash
python tools/vr-db-snapshot.py backup --port 9480 --tag pre-live
python tools/e2e-all.py --live --skip e2e-buttons --reason "真实站点回归"
python tools/vr-db-snapshot.py restore --port 9480 --file .work/db-snapshots/<pre-live>.json
```

### L4 手工真机

- YouTube watch 页：无弹窗、右下角进度、音轨、声音、完成后标签关闭。
- X/微博批量：缩略图、进度、404 不误报风控。
- 批量删除/恢复：临时目录。
- 93MB 视频缩略图。

---

## 5. 当前已知的“假通过”

| 现象 | 为什么不能算通过 |
|---|---|
| `e2e-buttons 27/27` | 用的是 10 条假数据；只能证明“按钮接线/无异常”，不能证明真实文件可用 |
| `library-buttons 93/85/0 异常` | 58 项 `changed:false`；破坏性跳过；不验证数据/媒体 |
| `library-functions 42/44` | 旧基线；排序已在 M2 用真实数据 14/14 覆盖，Plyr/改名仍待 M6 重跑 |
| `__vrBoot load:45` | 只证明读到 45 条；不等于 45 条真实可用（已清理为 35） |
| `45/45 卡片` | 旧验收口径；现改为 `35/35 真实文件可打开` |

---

## 6. P0 完成定义（DoD）

- [x] M2：排序 4 模式在真实 35 条上正确；e2e 断言不再用同标题夹具（`library-realdata-e2e` 14/14）。
- [ ] M3：批量移动在临时副本上成功；导出 API、权限、路径、回滚全部验证。
- [ ] M4：改名 → 重扫 → 网格/列表/预览一致；`displayName` 不丢。
- [ ] M5：无 handle 时移动/删除禁用并说明；授权后可用；`file://` 不可用有提示。
- [ ] M6：`e2e-all --isolated` 离线全绿；真实数据冒烟 35/35；按钮矩阵逐项有输入→输出；
  YouTube/批量删除/X-微博按 L3/L4 有真机证据。
- [ ] 每次回归前后 `vr-db-snapshot.py status` 一致；真实库 0 假数据。

---

## 7. 下一步新增断言（按里程碑）

| 里程碑 | 新增断言 |
|---|---|
| M2 | `sort=new/old/size/name` 顺序、切回恢复；真实数据至少 3 条 |
| M3 | 临时副本移动 2 条；物理存在/DB 路径/缩略图/移回；无授权时按钮禁用 |
| M4 | 改名 → 重扫 → 名字保留；列表/网格/搜索/排序一致 |
| M5 | 无 handle 禁用；授权后启用；`isAllowedFileSchemeAccess=false` 提示 |
| M6 | 真实 35 条冒烟；批量删除/恢复；YouTube；Plyr 真实播放；按钮矩阵全量 |

---

**一句话：先用隔离 profile 和快照把“数据安全”锁住，再用真实 35 条逐项证明按钮的输入→输出，最后才谈性能和真机站点。**
