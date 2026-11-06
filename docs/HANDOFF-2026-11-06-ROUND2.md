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
