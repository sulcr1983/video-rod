# 媒体库逐按钮全量验收（lib_full_test）

> 日期：2026-10-19 ｜ 环境：星愿 Twinkstar / CDP 9223 / 扩展 `bilfgmaaplmlfgpmjfhdaillmnonjlbj`
> 根目录：`F:\download\video-rod` ｜ 扫描：27 项（小红书 12、X 10、其他 5）
> 说明：本报告是实测记录，不修改任何用户素材；测试临时文件已清理或位于 `_trash`。

## 1. 结果总览

| # | 控件/功能 | 操作 | 结果 |
|---|---|---|---|
| 1 | 初始扫描 | 打开媒体库 | ✅ 27 项；平台树 小红书 12 / X 10 / 其他 5；类型 图片 12 / 视频 15 |
| 2 | 搜索 `#search` | 输入 `NASA` | ✅ 8 项；显示 chip「搜索：NASA ×」；清空恢复 27 |
| 3 | 资源树搜索 `#treeSearch` | 输入 `小红书` | ✅ 树只剩「媒体库 27 + 小红书 12」；清空恢复 14 个节点（只过滤树，不改变卡片） |
| 4 | 平台筛选 | 点击「小红书」 | ✅ 12 项；chip「平台：小红书 ×」；类型 tab 变为 全部 12 / 图片 11 / 视频 1 |
| 5 | 类型筛选 | 图片 / 视频 / 全部 | ✅ 图片 12；视频 15；全部 27；选中态正确 |
| 6 | 排序 `#sort` | 文件最大 | ✅ 首个为 31MB 的「洛克之路」视频 |
| 7 | 排序 `#sort` | 标题 A-Z | ✅ 首个变为「测试封面」；排序生效 |
| 8 | 视图切换 | 列表 / 网格 | ✅ `#grid.list` 与 `#grid` 正常切换，选中态正确 |
| 9 | 预览打开 | 点击卡片 | ✅ `#preview.preview`；标题正确 |
| 10 | 预览下一个 | `#pvNext` | ✅ 标题从 `洛克之路_01 (2)` → `洛克之路_02` |
| 11 | 信息栏 | `#pvInfoBtn` | ✅ `#pvBody.no-info` 切换，再点恢复 |
| 12 | 预览帮助 | `#pvHelpBtn` | ✅ toast：`↑↓ 切换媒体；←→ 视频进度/图片同专辑；Space 播放；F 全屏；Esc 返回` |
| 13 | 在文件夹中显示 | `#pvReveal` | ✅ toast 显示相对路径 `xiaohongshu/.../洛克之路_01 (2).webp` |
| 14 | 标签 | 添加 `fulltest` / 移除 | ✅ 预览标签出现后移除；`_index/tags.json` 回到 0 个 key |
| 15 | 重新扫描 | `#rescanBtn` | ✅ 27 项；状态「扫描完成」；`_index/index.json` 27 条 |
| 16 | 查重 | `#dedupBtn` | ✅ 27 个 SHA-256；4 组/12 个重复标记；`hashes.json` 27 条 |
| 17 | 设置页 | 打开设置 | ✅ 5 个分组；媒体库组存在 |
| 18 | 媒体库开关 | 关闭/开启 `#vrSetLibrary` | ✅ 关闭时 `#vrOpenLibrary` display=none；开启恢复 |
| 19 | 图片缩略图 | 卡片渲染 | ✅ `_index/thumbs` 12 张；刷新后仍显示 |
| 20 | 预览视频 | 本地 File object URL | ✅ `preload=metadata`；duration 61.5s、readyState 4（P4 已验） |

## 2. 前序已验项（本轮未重复破坏性操作）

| 功能 | 结果 |
|---|---|
| 重命名 | ✅ `move(parentDir,newName)`；toast「已重命名」 |
| 删除到 `_trash` | ✅ toast「已移到回收站」 |
| 选择模式 / 全选 / 反选 / 清除 | ✅ P3 实测 23→22 |
| 批量移动 | ✅ 临时文件 → `other/测试移动(@testid)/images/`，toast「已移动 1 个」 |
| 批量删除 | ✅ toast「已移到回收站 1 个」 |
| 单次下载去重 | ✅ 同一 X 视频第二次 `skipped:true` |

## 3. 后端文件

- `_index/index.json`：27 条（扫描索引）。
- `_index/tags.json`：0 个 key（测试标签已移除）。
- `_index/hashes.json`：27 条 SHA-256。
- `_index/thumbs/`：12 张 JPEG 缩略图。
- 根目录 27 项 = 小红书 12 + X 10 + 其他 5；`xbd-downloader`/`老黄的分享` 仍不扫描。

## 4. 未完成 / 环境限制（如实记录）

1. **全屏按钮**：CDP trusted mouse click 下 `document.fullscreenElement` 仍为空；可能是扩展页/自动化环境的 user-activation 限制，需真实用户点击复验。预览本身已覆盖整个视口。
2. **原生目录选择**：`#pickBtn`/`#rootBtn` 的 `showDirectoryPicker` 仍受浏览器用户手势限制；本轮未重复打开原生窗口（此前 `lib_manual` 已验证）。
3. **`#resetRoot`**：破坏性重置，未在自动验收中执行。
4. **排序「文件最大」**依赖 `lastModified/size` 元数据，已验证首个是 31MB 视频；未做逐项全排序核对。
5. 媒体库当前 27 项包含小红书/Instagram 测试下载；不是 22 项基线。
