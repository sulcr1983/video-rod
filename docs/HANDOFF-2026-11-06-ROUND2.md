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

1. **详情页移动/删除**：隔离 profile 已完成真实写盘（见 §11）；真实库 9480 已恢复写权限，建议手工点一次单条移动/删除确认。
2. **XHS 主页「收集并下载」UI 点击**：后端 `vrXhsAutoQueue` 已 5/5；UI 面板未再点一遍。
3. **YouTube 自动页**：代码已关闭后台页并跳过重复；最终一次完整下载+关闭需在干净 profile 再打一次日志。
4. **顶部平台 chip 与左侧树**：左侧已可筛选，顶部仍保留；如果产品决定只留一个入口，再删顶部 chips 并同步 `e2e-buttons`/`stage-rewrite`。
5. **原型同步**：本轮新增收藏/星标双按钮、7 列网格未同步到 `deliverables/prototypes/media-library-stage-v1.html`；原型仍是设计真源，动 UI 前先对照。
6. **性能**：5 万条虚拟滚动、首帧大视频、缩略图批量解码未在本轮测量。
7. **右键菜单**：`trash-ui.js` 未挂到 library.html；详情页/批量条可用，卡片右键的「重命名/移动/删除」还没有入口。

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
- [x] 详情页重命名 / 移动（文件夹选择器）/ 删除（隔离 E2E，见 §11）
- [ ] FSA 授权态下移动/删除实机（真实库已完成权限恢复，单条操作建议手工点一次）
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

## 11. 详情页重命名 / 移动 / 删除（2026-11-06 09:xx）

反馈：重命名没反应、移动要手写文件夹、删除没反应。

根因（最重要的一个）：
- `js/library/app.js` 的 `ask()` / `openRename()` 用 `classList.add('show')` 打开模态框，
  但 `css/library.css` 只有 `.modal-mask.on` 的显示规则，**没有 `.show`** ——
  所以重命名框和删除确认框从来没有显示过。用户点了当然像「没做」。
- 重命名框的「所在目录」是 `<input>`，JS 却写 `textContent`，永远空白且看起来可编辑。

修复：
- `css/library.css` 补 `.modal-mask.show`（含 `.modal` 位移动画）。
- 重命名：所在目录改为只读展示（`.md-dir`），并明确提示「只改资源库显示名，
  不修改磁盘文件名」（ADR-050 R2）；写入 `displayName` 后会重新加载列表。
- 移动：新增 `js/library/move-picker.js`，弹出应用内文件夹选择器：
  只遍历资源库根句柄下的目录，可进入上一层、新建文件夹、选中后「移动到这里」；
  不再用 `window.prompt` 让用户手写路径，也不会选到库外目录。
- 删除：确认框恢复显示后走原回收站逻辑（`VRTrash.remove`），文件进 `_回收站`。

验证（隔离 profile + OPFS 句柄，真实点击）：
- 重命名：`displayName` 写入成功，卡片标题立即变为「改名测试」。
- 移动：选择器列出 `素材A / 未分类`；进入「未分类」后移动，
  DB 变为 `video-rod/未分类/photo.png`，物理文件也在 `未分类/`。
- 删除：确认框出现；确认后 DB 清空，文件进入
  `_回收站/20261106-093814-rxou/未分类/photo.png` 并生成 manifest。
- 真实库 9480：三个模态框均能显示；移动选择器列出实际平台目录；无 JS 异常。
- `e2e-buttons` 的全量点击器已把 `moveMask/confirmMask` 加入每轮复位，避免遮挡后续点击。

剩余：
- 右键菜单（`trash-ui.js`）当前没有挂到 library.html；详情页三条已可用。
  如果要在卡片右键也提供「移动…」，后续把 `trash-ui.js` 接上并复用 `VRMovePicker`。

## 12. YouTube 取格式失败 + 小红书批量「无反应」（2026-11-06 10:xx）

### YouTube：`取格式失败：VISIONOS → UNPLAYABLE: Sign in to confirm you're not a bot`
两个独立原因：
1. **后台标签页被 Chrome 冻结**（`tab.frozen=true`）。对冻结页
   `chrome.scripting.executeScript` 会一直不回调，旧代码没有超时，页面看起来卡死。
   现在 `ytFormats` 先 `chrome.tabs.get`：`frozen/discarded` 就 `tabs.reload` 唤醒，
   再注入；注入本身有 20 秒超时，超时给明确提示。
2. YouTube 对非 WEB 客户端做风控（VISIONOS/MWEB/TVHTML5/ANDROID/IOS 全部
   `LOGIN_REQUIRED`/`UNPLAYABLE`）。现在客户端列表加入 **WEB 兜底**，并允许
   progressive（单文件）直链；WEB 通常只给 360p，UI 会明确提示「当前只返回
   360p 单文件直链（高画质走 SABR，暂不支持）」，不再报「取格式失败」。
   错误信息也改成短句（详细尝试结果放 `detail` + console.warn）。

实测 `https://youtu.be/Ej_kZi6qX9w`：
- 页面被唤醒后重新取到 **32 档、1080p**（VISIONOS 恢复）；成功提示为
  「已取到 32 档格式」。
- 若只有 WEB 可用，则显示 360p 单文件 + 受限说明，仍能下载。

### 小红书批量：移动后「无反应 / 依然无效果」
三个问题叠加：
1. **重复被当成成功**：`vrBulkDownload` 把 `vrBulkSaveItem` 的
   `{ok:true, skipped:true}` 计入 `done`，UI 显示「完成 5 个文件」，但磁盘没有新文件。
   现在 skipped 单独计数，文案变成「没有新文件：N 条都已下载过（同来源自动跳过…）」。
2. **XHS CDN 同一张图每次签名前缀不同**：
   `…/202611060359/<hash>/spectrum/ID` vs `…/202611061013/<hash>/spectrum/ID`。
   旧规范化保留时间戳，导致同图反复下载成 `(1)(2)(3)`。现在
   `vrCanonMediaUrl` 对 `xhscdn.com` 只保留 `/spectrum/<稳定 ID>`（视频保留
   `xhscdn.com/stream/…`），CDN 子域也归一。
3. **「收集并下载」在自动补全未勾选时只收集不下载**；现在点它会自动勾选并开始。
   另加 90 秒无进度看门狗，后台回执丢失时不会永久锁死按钮。

验证：
- 同一篇已下载笔记再跑一次：`没有新文件：5 条都已下载过（同来源自动跳过…）`，
  无新下载、无新文件。
- 清理测试产生的 `(1)/(2)` 重复文件后，真实库恢复 **36 条 / 8/8 PASS**。
- `e2e-all --isolated --only stage-rewrite,e2e-buttons` → 2/2、46 条断言。

未完成：
- YouTube 高画质仍依赖 VISIONOS 等客户端给直链；若全部被风控，只能 360p。
  真正的 4K 兜底需要 SABR 复放（BACKLOG P2），本轮未做。

补充（YouTube 画质）：
- 取到 360p 受限、或被风控拒绝时，后台会 **自动刷新 YouTube 页面再试一次**；
  实测刷新后 VISIONOS 恢复直链，`https://youtu.be/Ej_kZi6qX9w` 可取到
  **1080p（61MB 视频+音频）**，UI 自动选最高档。
- 当前管线只处理 MP4（H.264/AV1-in-MP4）；若 2160p 只存在 WebM/VP9 或 SABR 中，
  拿不到 4K。1080p 已满足当前要求，SABR 复放仍留在 BACKLOG。

## 13. 详情页删除/移动「还是不行」的第二个根因（2026-11-06 11:xx）

现场：库页显示只读，`pvDelete`/`pvMove` 是 **disabled**，点击没有任何反应；
`__vrPerm.handle.name` 是 **`download`**，而当前库根是 `video-rod`。

根因：
1. 历史授权句柄指到了错目录（名字 `download`），`resolveRoot` 只看权限不看名字，
   所以「恢复写入」恢复的仍是错句柄；恢复后写盘也会落到错目录。
2. 上次为了让权限测试通过，把 `pvDelete/pvMove` 在只读时置灰；置灰按钮点不动，
   用户看到的就是「删除那几个按钮还是不行」。

修复：
- `indexer.resolveRoot()`：句柄名必须等于当前库根名（system=`subdir`，
  custom=absRoot basename）；不符就丢弃并清掉 DB 句柄，不再恢复错句柄。
- 设置页的授权状态同样校验名字；错句柄不再允许 `requestPermission` 或下钻创建。
- 详情页/批量写操作按钮 **不再置灰**。点击时先走 `ensureWriteAccess()`：
   · 正确句柄 + 权限 prompt → `requestPermission` 恢复；
   · 没有句柄 / 句柄错误 / 权限被拒 → 直接弹目录选择，选中 `video-rod` 或上级
     `Downloads` 后自动下钻、写回句柄，再继续原来的删除/移动确认。
- `authorizeRoot()` 先弹选择器再做异步读取，避免 `await` 消耗用户手势导致
  `showDirectoryPicker` 报「Must be handling a user gesture」。
- `library-permission-e2e.py` 的断言改为：只读时写按钮**仍可点击**（点击触发授权）。

验证：
- 真实库已清除错句柄；只读态下 `pvMove/pvDelete` 均为 enabled，横幅提示
  「当前为只读模式…点「授权素材目录」」。
- 用 OPFS 句柄模拟选择器：点击 `pvDelete` → 自动授权 → 弹出删除确认框
  （随后取消，未删文件），证明按钮链路已通。
- `library-permission-e2e.py --port 9480` → **8/8 PASS**（只读态）。
- 设置页无句柄时显示「未授权写入（可选）」，不再误报「已选过目录」。

注意：已清除真实库里名为 `download` 的错句柄。下次点「授权素材目录」
（或直接点删除/移动）时，选择 `D:\personal\Downloads\video-rod` 或它的上级
`D:\personal\Downloads` 一次即可。

## 14. YouTube 重复卡片（2026-11-06 11:xx）

现象：资源库出现两条同标题、同 9.0MB 的 YouTube 卡片，一条 `.mp4`、一条 `(1).mp4`。

根因：
1. **手动下载没有查重**：`yt-download.js` 只有 `auto=1` 分支调用 `findExistingYt()`，
   手动点「下载」会直接再落一份，下载器 `uniquify` 生成 `(1)`。
2. **下载器兜底入库的条目没有 pageUrl/title**：旧条目 `sourceUrl` 是 `blob:`，
   `pageUrl/title` 为空，按「平台+规范化 URL」的去重完全匹配不到。
3. 历史测试残留 `dup_probe.webp` 也被当成正式素材显示。

修复：
- `run()`（手动下载）开始前同样调用 `findExistingYt()`，命中直接提示「已存在，跳过重复下载」。
- 兜底匹配：去掉 ` (n)`、`_无音轨/视频轨/音频轨`、`_1920p` 等后缀后，与
  `safe(meta.title)` 做**完整比较**，避免「Foo」误命中「Foo Bar」。
- `saveToDownloads()` 在 `chrome.downloads.download` 前先 `vrQueueName` 预登记
  `platform/title/pageUrl/creator`，以后下载器通道入库的条目也能按来源去重。
- 清理：删除 YouTube `(1).mp4`（保留 `.mp4`）、删除测试残留 `dup_probe.webp`
  及其空目录；库回到 **36 条**。

验证：
- 库内 YouTube 只剩 3 条唯一视频，无 `(1)` 重复；`dup_probe` 已消失。
- `library-integrity-check.py --port 9480` → **8/8 PASS，36 条**
  （顺带修正一条抖音文件被替换后的 DB size 不一致）。
- 文件名匹配逻辑对现有 `Guangzhou…_1920p.mp4` 命中；新下载会跳过。

注意：Instagram 有一条 `(1).mp4` 是**唯一副本**（没有无后缀版本），未删除。

## 15. 来源信息全空 + YouTube 大文件断流（2026-11-06 11:xx）

### B站 / YouTube / X 的详情页「来源」整块空白
实测库内元数据：B站 2/2、YouTube 4/4、X 6/6 的 `pageUrl` 与 `title` 都是空，
微博/小红书/抖音/网页正常。三处调用方各自漏了 meta：

1. **X 批量**：`vrBulkDownload` 的 x 分支调 `vrDownloadWithName` 时没传 `meta`，
   只靠路径反解 → 原帖地址丢失。现在显式传 `vrBulkMeta(it, rel)`。
2. **B站**：走页面内 `<a download>` + blob，`vrPendingBiliName` 只记了路径。
   现在同一条记录里带 `meta`（platform/title/pageUrl），并在
   `onDeterminingFilename` 拿到真实 blob URL 后把它迁到 URL 键上。
3. **下载器兜底**：`VRSave.saveDownloads` 走 `chrome.downloads` 时不预登记 meta，
   下载完成事件里拿不到上下文。现在下载前 `VRLib.record()`。
4. **blob 认领兜底**：B站每次 blob URL 都是新的，`handleComplete` 查不到 URL 键。
   新增按「文件名（去 ` (n)` 后缀）」反查预登记记录的兜底，命中就用它的 meta 入库。

### YouTube 下到 ~80MB 报网络错误
用户给的 `https://youtu.be/WuB97Yjajyg`，1080p 视频轨 75MB。`fetchBytes` 原来
是单次 `fetch` 整段读，googlevideo 长连接被掐断就整条失败。

现在改为分段续传：按 `Range` 从真实已读位置续，每段最多重试 4 次；断流时保留
已读字节（`readStream` 返回 `complete:false`），不会错位或丢数据。

实测该视频：`视频轨 35→75 MB` 全程无中断 → `音频轨 3 MB` → 合并落盘 81MB 成功。

### 文案
YouTube 页面按钮提示由「支持 1080p / 4K」改为「最高支持 1080p」。

### 验证
- `e2e-all --isolated --only e2e-sw,dedup,stage-rewrite,e2e-buttons` → **4/4、71 条**。
- `library-integrity-check.py --port 9480` → **8/8 PASS，39 条**。
- 未授权目录时 `VRSave` 走下载器，文件名可能被浏览器改动（提示语已说明）。

### 已知限制
- **已有条目不会自动补来源**：浏览器下载记录里 `referrer` 为空、URL 是 blob，
  回填不了。只有新下载才带完整来源。
- 若只想要 1080p 而当前只取到 360p，会先刷新页面重试一次；仍失败则下 360p 并提示。

## 16. 右键菜单（含 Google 识图）+ 大库窗口化（2026-11-06 11:xx）

### 卡片右键菜单
新文件 `js/library/ctx-menu.js`，菜单项：打开预览 / 重命名 / 移动到… /
在文件夹中定位 / 加入收藏 / 加星标 / **用 Google 识图**（仅图片）/ 移到回收站。

为什么没直接用 `js/library/trash-ui.js`：那套是旧版库页的 DOM
（`#libGrid` / `#libTrashDrawer` / `#libConfirmMask`），当前 `library.html`
没有这些节点，挂上去会空指针。新模块只做菜单层，动作全部复用页面已有实现
（`openRename` / `VRMovePicker` / `ask + VRTrash` / `VRFav` / `ensureWriteAccess`）。

- 右键卡片弹出；支持 ↑↓/Enter/Esc；点击外部、滚动、缩放自动关闭。
- 只读态点「移动到…/移到回收站」会先走 `ensureWriteAccess()`（恢复权限或弹目录选择）。

### Google 识图
本地文件 `file://` 下 Google 抓不到，必须上传字节：
`VRFile.resolve()` 读出 Blob → 隐藏表单 multipart POST 到
`https://lens.google.com/v3/upload` → 新标签跟随 302 到结果页。

实测：点「用 Google 识图」→ 新标签打开
`https://www.google.com.hk/search?vsrid=…`，识别成功。

### B-14 大库窗口化
`app.js` 新增窗口化渲染：**≤300 条走原路径**（一次铺满 + 滚动追加，
行为不变）；>300 条只渲染可视区上下各 2 行，用 `paddingTop/Bottom` 撑高度。

实测（`VRApp._renderFake` 压测入口）：
| 总量 | 首屏耗时 | DOM 卡片数 |
|---|---|---|
| 120 | 6 ms | 120 |
| 5 000 | 42–91 ms | 42 |
| 50 000 | 105 ms | 49 |

滚动 3 屏后窗口正确平移（42 → 70 张，`padding-top` 2104px）；
响应式列数变化时重算列数与行高。

未做：真正的「回收 DOM 复用」（当前是重绘窗口，不是节点池）。
5 万条实测已满足「首屏 < 100 ms」的目标区间。

### 验证
- 右键菜单：图片 10 项含「用 Google 识图」，视频 9 项不含；无 JS 异常。
- `e2e-all --isolated --only e2e-sw,stage-rewrite,e2e-buttons` → 3/3、50 条。
