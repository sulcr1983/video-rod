# HANDOFF — 2026-11-06 第二轮（下载/资源库/YouTube）

> 接手前先读：`docs/HANDOFF-2026-11-06.md`、`docs/E2E-AUDIT-2026-11-06.md`、`docs/TEST-ASSETS.md`。
> 当前工作区 `D:\test\download\video-rod`，分支 `merge/remote-20261104`，**未 push**。

## 1. 当前可用状态

- 真实库：**37 条**（`video-rod`，`D:\personal\Downloads\video-rod`），无测试假数据、无重复 relPath、无缺失文件。
- 完整性：`python tools/library-integrity-check.py --port 9480` → **8/8 PASS**。
- 隔离回归：`e2e-all --isolated --only stage-rewrite,e2e-buttons` → **2/2 套件，46 条断言全过**（stage 19/19、buttons 27/27）。
- 真实站点最近验证：微博批量 3/3；小红书 A2 5/5、A1 图片 1/1；Instagram 11 图 + 1 视频；花瓣 1 图；小红书 `vrXhsAutoQueue` 单篇 **5/5，errors=0**。
- YouTube：合并文件含音轨 track 2，Chrome `readyState=4`、`webkitAudioDecodedByteCount>0`；自动页为 `active:false` 后台标签，完成后可关闭。

## 2. 本轮已完成

### 下载与平台
- **微博批量**：不再走页面 `<a download>`，改为带 `filename`/meta 的下载器；403 时离屏 fetch 后回写资源库。修复只有第 1 条落到 Downloads 根目录、platform/type 为空。
- **小红书图片**：扫描保留 `infoList.WB_DFT` 的 `!nd_dft_*` 后缀并强制 HTTPS；修复 A2 五张 403。
- **小红书自动收集**：`vrXhsAutoQueue` 的 items 补 `pageUrl`，详情等待延长；实测 `files=5, errors=0`。
- **Instagram**：路径正则支持 `/用户名/reel/<短码>`；Reel 完整视频从 `video_versions` 取 progressive MP4，不再用 MSE 分片。
- **YouTube 音轨**：修复 `fmp4-merge.js` 的 `moof` 子 box 解析；`retagMoof`/`moofTime` 现在读取 `traf`，音轨 track_ID 正确为 2。
- **YouTube 自动**：`auto=1` 后台标签、自动选最高画质；下载完成广播后关闭后台页；同目标路径已存在时跳过重复。
- **YouTube 去重**：YouTube 内容命中不再写第二张引用卡；清理了历史 `(1)/(2)/(3)` 重复条目和物理文件。

### 资源库 UI
- **静态 WebP 归图片**：`EXT_ANIM` 只保留 GIF/APNG；小红书/花瓣 WebP 不再显示“动图”。
- **收藏/星标**：详情页新增显眼的「收藏」+「星标」两个按钮；收藏可再次点击取消；星标写 `starred`。
- **收藏夹收敛**：只保留一个「收藏」文件夹；旧的测试/失效 id 在加载时清理；新建收藏夹入口 CSS 隐藏；分类用标签。
- **长标题**：`.pv-info h2` 三行截断，保留 `title` 提示；信息栏可滚动。
- **详情操作**：重命名、移动、定位、删除按钮均有文字；重命名走 `displayName`；移动/删除在无 FSA 授权时给出明确提示。
- **左侧平台筛选**：点击左侧平台节点会真正写 `S.plat` 并重绘；顶部平台 chip 仍保留为快捷筛选，两者同步。
- **卡片密度**：`grid-template-columns:repeat(auto-fill,minmax(185px,1fr))`，1920 宽度约 7 列；缩略图改为 16:10。

### 工具
- `tools/live-eval.py --sw` 跳过 SW 不支持的 `Page.enable`，可直接诊断后台。
- C++ 无关的 `test-path` / `test-image-util` 旧期望已同步当前行为（`@ID/域名`、500 长边 + 200 短边）。

## 3. 未完成 / 需下一会话验证

1. **详情页移动/删除的真实写盘**：当前 9480 的 FSA 根句柄为 `null`，按钮会提示“先授权素材目录”，未在授权态走完物理移动/回收站。
2. **XHS 主页「收集并下载」UI 点击**：后端 `vrXhsAutoQueue` 已 5/5；UI 面板未再点一遍。
3. **YouTube 自动页**：代码已关闭后台页并跳过重复；最终一次完整下载+关闭需在干净 profile 再打一次日志。
4. **顶部平台 chip 与左侧树**：左侧已可筛选，顶部仍保留；如果产品决定只留一个入口，再删顶部 chips 并同步 `e2e-buttons`/`stage-rewrite`。
5. **原型同步**：本轮新增收藏/星标双按钮、7 列网格未同步到 `deliverables/prototypes/media-library-stage-v1.html`；原型仍是设计真源，动 UI 前先对照。
6. **性能**：5 万条虚拟滚动、首帧大视频、缩略图批量解码未在本轮测量。

## 4. 复现命令

```bash
cd /d D:\test\download\video-rod
python tools/e2e-all.py --isolated --only stage-rewrite,e2e-buttons
python tools/library-integrity-check.py --port 9480
python tools/first-run-audit.py
node tools/test-path.js
node tools/test-save.js
node tools/test-image-util.js
node tools/test-naming.js
```

浏览器：Edge `156.0.4314.58`，调试端口 `9480`，profile `D:\test\download\.edge-login-profile`，扩展 ID `ceogmckiinjolbbdkjfelmfcfepccabp`。
隔离测试用 `--isolated`（端口 9490），不要用真实库跑 `e2e-buttons`。

## 5. 关键文件

- `js/background.js`：批量落盘、XHS pageUrl、YouTube 关闭/进度。
- `js/yt/fmp4-merge.js`：moof/traf、track_ID、音轨片段。
- `js/yt/yt-download.js`：自动模式、下载竞态、重复跳过。
- `js/library/app.js`：筛选、收藏/星标、详情管理。
- `js/library/lightbox.js`：详情收藏/星标、标题、管理按钮。
- `js/library/sw-library.js`：YouTube 重复不写引用卡。
- `js/library/settings.js`：保存位置首开默认值、自选文件夹选择/导入、未整理统计。
- `js/library/indexer.js`：full 扫描无 absRoot、下载记录补元数据、`untracked`。
- `js/library/localfile.js`：无绝对路径时用目录句柄生成 Blob URL（缩略图/详情）。
- `js/library/thumbs.js` / `lightbox.js`：接入 `VRFile` 句柄回读。
- `library.html` / `css/library.css`：详情按钮、7 列网格、标题截断。

## 6. 交接检查清单

- [x] 真实库 37 条完整性 8/8
- [x] `stage-rewrite` 19/19、`e2e-buttons` 27/27（隔离）
- [x] 微博/小红书/IG/花瓣真实下载
- [x] YouTube 音轨与自动页代码
- [x] 收藏/星标、标题截断、左侧筛选、7 列密度
- [ ] FSA 授权态下移动/删除实机
- [ ] XHS 面板 UI 点击 + 原型同步
- [ ] 性能基准

## 7. 最终验证（2026-11-06 08:53）

- `python tools/e2e-all.py --isolated --only stage-rewrite,e2e-buttons --timeout 180` → **2/2 套件通过**：`stage-rewrite 19/19`、`e2e-buttons 27/27`。
- `python tools/library-integrity-check.py --port 9480` → **8/8 PASS，37 条**。
- 详情页收藏/星标：实测收藏可在“已收藏/收藏”间切换，星标可在“已星标/星标”间切换；收藏夹数据库只剩一条「收藏」。
- 左侧平台筛选：点击 B站节点后右侧只剩 1 张，顶部 B站 chip 同步 active。
- 网格：当前 6 列（列宽约 196px），1920 宽视口 7 列；缩略图 16:10。
- 小红书 `vrXhsAutoQueue`：`files=5, skipped=0, errors=0`。
- YouTube 自动页：后台 `active:false`；下载完成后自动关闭；同目标路径已存在时跳过重复。
- 本轮最终提交：`029cfde fix(youtube/library): 自动下载、收藏星标与详情交互`（未 push）。

仍建议下一会话补：FSA 授权态下详情移动/删除实机、XHS 面板 UI 实际点击、原型同步收藏/星标与 7 列网格、性能基准。

## 8. 下载前去重追加（2026-11-06 09:xx）

用户反馈“全部都是重复的”，要求同一链接/来源不再重复下载，不同平台和来源允许。

实现：
- `js/background.js` 新增 `vrCanonMediaUrl`：去掉协议差异、query/hash、CDN 的 `!nd_*` 变换后缀，只保留 host+path。
- `vrFindExistingMedia`：按「平台 + 规范化源 URL」查库；视频额外允许同 `pageUrl`。
- 在 `vrBulkSaveItem`、`vrImgDownload`、`vrIgDownload`、`vrVideoDownload` 下载前查重；命中直接返回 `skipped/duplicate`，**不发起下载**。
- 不同平台不互相判重（`plat` 不一致直接跳过匹配）。

实测：
- 同源 XHS 图片调用 `vrBulkSaveItem` → `{ok:true, skipped:true, reason:'duplicate-source'}`，无新文件。
- 同源 XHS 图片调用 `vrImgDownload` → `{ok:true, duplicate:true, downloadId:null}`。
- 清理最后一个 `isRef` 测试卡后：库 **36 条 / duplicateGroups=0 / refs=0**。
- 完整性 **8/8 PASS，36 条**。

注意：这是“下载前”的 URL/来源判重；不同 URL 但内容相同的文件仍由下载后的 SHA-256 去重兜底。真正的内容级预判需要 HEAD/ETag 或服务器摘要，当前平台不保证提供，未做。

## 9. 保存位置首开体验 + 自选文件夹导入（2026-11-06 09:xx）

用户反馈：首次打开「保存位置」只显示「未探测」，必须点「校验落盘」才算可用；
希望能默认用系统下载目录下的 video-rod，点保存即可；也可以选别的文件夹，
已有素材要扫描入库，认不出来源的进「未整理」。

实现：
- **首次打开即显示真实默认路径**：`settings.js` 在 system 模式下用下载记录反推
  `detectedRoot`；找不到时显示「系统下载目录\video-rod（首次下载时自动创建）」，
  不再出现「未探测」。
- **「位置与模式」改为两个选项卡**：默认位置（推荐）/ 自选文件夹；一个
  「保存并使用」按钮同时保存模式、子目录和目录授权。
- **自选文件夹**：`showDirectoryPicker` 后立刻统计媒体文件数；有下载记录能对上的
  文件会自动反推绝对路径（FSA 本身不给路径），对不上也能保存。
- **导入已有素材**：保存后调用 `VRIndex.build({mode:'full', markMissing:false})`
  扫描整个文件夹入库；原来的库条目不会被误标缺失。
- **未整理菜单**：全量扫描时认不出平台、且对不上下载记录的文件写 `untracked:1`，
  资源库左栏在「全部资源」下面出现「未整理 N」，点击即筛选。卡片平台显示「未整理」。
- **无绝对路径也能预览**：新增 `js/library/localfile.js`，`VRFile.resolve()` 在
  `absPath` 为空时用目录句柄读文件生成 Blob URL；缩略图队列和详情页都已接入。
- `js/library/indexer.js`：full 扫描允许无 absRoot；从下载记录按「绝对路径 →
  文件名+大小」补平台/来源；`setRoot` 会清掉过期 `rootAbs`。

验证：
- Node 单测式假句柄：full 扫描 → 未整理/已分类/下载记录匹配均正确。
- 隔离 profile（9490）+ OPFS 句柄：导入 2 个文件 → 库 2 条、未整理 1、
  左栏「未整理」筛选 1 条、两张缩略图均由句柄回读生成。
- 真实库（9480）：36 条不变；`e2e-all --isolated --only dedup,stage-rewrite,e2e-buttons`
  → **3/3 套件 67/67**（dedup 21/21、stage-rewrite 19/19、e2e-buttons 27/27）。
- 路径/落盘/图片/命名单测：57/57、42/42、100/100、32/32。

未完成 / 需人工：
- 「选择文件夹」会弹系统原生对话框，自动化点不了；授权后 → 扫描入库的整条链路
  需要用真实文件夹点一遍（本次用 OPFS 句柄等价验证了后半段）。
- 旧的 `F:\download\video-rod` 授权句柄与当前设置无关；切 system 时会清理。

注意：自选文件夹拿不到绝对路径时条目 `absPath` 为空（预览走句柄）。
`tools/library-integrity-check.py` 仍按 absPath 检查物理文件，此场景下会把这些条目
算作「缺失」；它是默认位置库的完整性检查，自选文件夹库请以页面预览/扫描结果为准。

## 10. 只读横幅误报（2026-11-06 09:xx）

反馈：已经在设置里选过目录，库页仍提示「当前为只读模式」。

根因两条：
1. 旧设置页的「选择文件夹并授权」只把句柄写进 **legacy IndexedDB `vr-lib-handle`**；
   `VRIndex.resolveRoot()` 只在 `mode === 'custom'` 时读它。system 模式下即使句柄存在，
   库页也拿不到 → 横幅显示成「没有授权」。
2. FSA 目录权限在页面刷新/重开后会从 `granted` 退回 `prompt`；旧按钮只会再弹一次
   目录选择框，用户觉得「我明明选过了」。

修复：
- `indexer.resolveRoot()`：system 模式也复用 legacy 句柄，但要求 `handle.name === subdir`
  （避免旧句柄指到别的目录）。
- 库页横幅：有句柄但权限为 `prompt` 时显示「浏览器收回了写入权限，点『恢复写入』即可，
  不用重选」；按钮优先 `requestPermission()` 复用原句柄，权限被拒才回退到目录选择。
- 设置页「默认位置」新增「授权写入」按钮 + 实时状态：已授权显示绿色路径；
  权限被收回显示琥珀色提示；没有句柄显示「可选」。
- 只读时同步禁用详情页「移动 / 删除」，不再点了才提示。

验证：
- `tools/library-permission-e2e.py --port 9480` → **8/8 PASS**（真实库、只读态）。
- 真实库 9480：`resolveRoot` 现在返回 `source:'legacy'`、`handle.name:'video-rod'`，
  横幅文案变为「已选过素材目录，但浏览器在刷新后收回了写入权限…」。
- `e2e-all --isolated --only dedup,stage-rewrite,e2e-buttons` → 3/3、67/67。

平台限制（不是代码能消除的）：
Chrome 的目录写权限不会跨页面刷新永久保留；恢复时必须由用户手势触发
`requestPermission()`，浏览器可能弹一次「允许编辑文件」确认。点「恢复写入」/「授权写入」
一次即可，不需要重新选目录。
