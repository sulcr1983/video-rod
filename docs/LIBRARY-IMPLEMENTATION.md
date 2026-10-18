# 媒体库 P1/P2 实施规格

> 关联：ADR-035、ADR-037；原型：`deliverables/prototypes/media-library-v4.html`
> 目标：把 v4 原型落成扩展内可用的真实媒体库页面。

## 1. 本期范围

- **P1**：File System Access 选目录、递归扫描、目录规范解析、`_index/index.json` 写入。
- **P2**：资源树、搜索/筛选/排序、网格/列表、图片/视频预览、键盘操作。
- **P3 基础**：重命名、删除到 `_trash/`；移动/标签留到下一期。
- **不在本期**：P4 大文件 Range 流式、缩略图缓存、收藏/标签、内容哈希去重（下载侧已有稳定标识去重）。

## 2. 目录契约

```
<根目录>/
├─ weibo/<作者(@ID)>/images|videos/
├─ x/<作者(@ID)>/images|videos/
├─ douyin/<作者(@ID)>/images|videos/
├─ xiaohongshu/<作者(@ID)>/images|videos/
├─ instagram/<作者(@ID)>/images|videos/
├─ _index/index.json
├─ _thumbs/            # P4
└─ _trash/             # 删除
```

- 扫描时跳过 `_index`、`_thumbs`、`_trash`、隐藏目录。
- 平台/博主从路径解析；解析失败归入 `other / 未分类`，不丢文件。
- 作者目录支持 `昵称(@ID)` 或 `昵称`。

## 3. 数据与持久化

- 目录句柄存 IndexedDB（`vrLibrary` / `handles` / `root`）；File System Access 句柄可结构化克隆。
- 每次扫描重建内存索引；写 `_index/index.json`（失败不阻塞浏览）。
- 素材对象：
  `id=path, name, ext, kind=image|video, size, lastModified, platform, author, authorId, path, handle`。
- 预览 URL 用 `getFile()` + `URL.createObjectURL`，离开/重扫时 revoke；不把二进制写入 IndexedDB。

## 4. 页面与交互

- 复用 v4 视觉：白色侧栏、蓝色主色、平台品牌色、彩色统计、类型分段。
- 左树：媒体库 → 平台 → 博主 → 图片/视频；树内搜索、每平台先显示 6 位博主。
- 主区：标题/统计、类型标签、搜索、排序、网格/列表。
- 预览页：图片/视频独立舞台、右侧信息栏、底部胶片。
- 键盘：`↑/↓` 切媒体；`←/→` 视频快退/快进、图片同博主专辑内切换；`Space/M/F/I/+/-/0/Esc`。
- CRUD：重命名（`FileSystemFileHandle.move(newName)`）、删除（移动到 `_trash/`）；不支持 move 时明确提示，不静默删文件。

## 5. 错误与权限

- 未选目录：空状态 + “选择媒体目录”。
- 句柄权限失效：提示重新授权/重新选择。
- `showDirectoryPicker` 不可用：提示浏览器不支持。
- 扫描单个文件失败：记录并继续，不中断整次扫描。
- 写 `_index` 失败：只在状态栏提示，不影响浏览。

## 6. 验收

1. 选择 `Downloads/video-rod` 后能扫描出平台/博主/图片/视频。
2. 搜索、平台/博主/类型筛选、排序正确。
3. 图片和视频能预览；`↑/↓`、`←/→` 行为符合查看器习惯。
4. 重命名后列表刷新；删除后文件进入 `_trash/`。
5. 刷新页面后目录句柄保留（权限仍有效时自动扫描）。
6. 页面无 CSP/控制台错误；`node --check js/library.js` 通过。

## 7. 后续

- P3 完整：移动平台/博主、标签、批量操作。
- P4：Range 流式、缩略图缓存、SHA-256 去重、收藏/智能视图。
- 大规模：虚拟滚动、分片索引、游标分页（见 `MEDIA-LIBRARY-PLAN.md` §11）。
