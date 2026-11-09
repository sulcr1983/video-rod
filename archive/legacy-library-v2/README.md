# archive/legacy-library-v2 —— 旧版资源库页（v2 架构）留证

**归档日期**：2026-11-09
**归档原因**：体积审计发现这 4 个文件在现行 `library.html` 里**零引用**，
是 v2 架构的遗留实现。删掉不划算（上游/历史代码，留证比删干净更安全），
所以移到这里 —— 源码区不再携带它们，发布包也不再包含。

## 文件清单

| 文件 | 体积 | 原职责 | 为什么不加载 |
|---|---|---|---|
| `ui.js` | 38.7 KB | 资源库页 v2：概览 / 博主速览 / 网格 / 表格渲染 | 现行库页改用 `js/library/app.js` 体系 |
| `trash-ui.js` | 15.3 KB | 旧版回收站 UI（`#libGrid` / `#libTrashDrawer` / `#libConfirmMask`） | `js/library/ctx-menu.js` 头部注释已写明：那套 DOM 节点在当前 `library.html` 里不存在，挂上去会空指针 |
| `batch.js` | 6.9 KB | 批量选择状态 + 底部浮条 + 批量删除编排（`VRBatch`） | 依赖 `VRTrashUI`（已归档）与 `ui.js`；现行库页无 `VRBatch` 引用 |
| `video.js` | 6.1 KB | 查看器自绘视频控件（`VRVideo`：播放/进度/倍速/全屏） | 现行库页走 `plyr.min.js`（`library.html` 引入），无 `VRVideo` 引用 |

合计 **66.9 KB**（解压后），发布包少 4 个文件。

## 核实方式（不是凭感觉归档）

1. **引用扫描**：全仓 grep 这 4 个文件名 → 现行 `library.html` 的
   `<script src>` 清单里没有它们；`app.js` / `ctx-menu.js` / `lightbox.js` /
   `anim.js` / `keyboard.js` / `trash.js` 里对 `VRBatch` / `VRVideo` /
   `VRTrashUI` 三个全局符号的引用数 = **0**。
2. **代码自证**：`ctx-menu.js` 的头部注释明确写了「为什么不用
   `js/library/trash-ui.js`：那套是旧版库页的 DOM」。
3. **运行时验证**：归档后重建 dist，跑离线全量回归
   （stage-rewrite 21/21、skin 20/20、e2e-buttons 32/32、e2e-popup 8/8、
   e2e-overlay 16/16）+ 发布包真实加载 6/6 —— 全绿。

## 恢复方式

如果将来要回到 v2 架构：

```bash
git mv archive/legacy-library-v2/*.js js/library/
node tools/build-dist.js
```

历史版本也可以直接查 git（这几个文件在归档前都有完整提交历史）。
