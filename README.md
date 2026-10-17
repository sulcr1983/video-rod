# 🎣 钓鱼竿 Video Rod

> 个人自用的浏览器媒体嗅探下载扩展：**猫抓（cat-catch）的全站嗅探内核 × Plucker 式文件管理体验 × B站/YouTube 主动抓取**。
>
> 自用工具，不上架、不分发。开发者模式 Load unpacked 安装。

---

## 这是什么

钓鱼竿是一个 Chrome 扩展（MV3），把「网页里的视频和图片，按我想要的名字和文件夹，整整齐齐下到我电脑上」这件事做到极致：

- 视频自动嗅探（m3u8/直链/`<video>` 标签），多档清晰度**默认自动选最高**
- **智能起名**：文章页取文章标题、推特页取推文正文、B站/小红书带作者 `昵称(@账号)_标题`
- **下载到文件夹**：按 `平台/作者/` 自动分目录，每条也能手动改
- **批量下载**、m3u8 碎片**自动合并**成完整 MP4
- **网页图片批量下载**：扫 img/srcset/背景图/懒加载，滤掉小图标
- **右键秒存**：视频/图片上右键直接下，不用开面板
- **B站/YouTube 主动抓取**：分P/合集/播放列表/频道/会员内容，纯扩展内置实现
- 快捷键 `Alt+Shift+V` 唤起面板

## 安装（开发者模式）

1. 克隆本仓库到本地
2. Chrome 地址栏打开 `chrome://extensions`
3. 右上角打开「**开发者模式**」开关
4. 点「**加载已解压的扩展程序**」，选择本仓库目录
5. 完成。快捷键可在 `chrome://extensions/shortcuts` 自行修改

## 快速上手（大白话）

1. 打开任意有视频的网页，点工具栏的钓鱼竿图标（或按 `Alt+Shift+V`）
2. 面板列出当前页所有媒体：勾选想下的，文件名和文件夹不满意就手改
3. 点「下载选中」，文件排队下到 `Downloads/video-rod/平台/作者/` 里
4. 想单独下某个视频/图片：在它上面**右键 → 钓鱼竿下载这个**，直接落盘
5. B站/YouTube 播放页会自动列出全部分P/列表项，想下哪个勾哪个

详细使用说明见 M6 交付时的《使用说明》（施工计划最后一步）。

## 项目文档

| 文档 | 内容 |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | 方案书：功能设计、竞品调研对标、需求决策记录 |
| [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md) | 施工计划：7 个里程碑（M0-M6）与验收标准 |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 需求规格：用户故事、功能清单（P0-P2）、非功能需求 |
| [docs/DESIGN.md](docs/DESIGN.md) | 技术设计：架构、模块边界、数据流、集成对象 |
| [docs/TESTING.md](docs/TESTING.md) | 测试策略：用例表、验收标准、回归清单、已知限制 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 决策记录（ADR）：每个重要选择为什么这么做 |

## 致谢（本项目站在这些开源项目肩上）

| 项目 | 贡献 | 许可 |
|---|---|---|
| [猫抓 cat-catch](https://github.com/xifangczy/cat-catch) | 底座：嗅探内核、下载器、m3u8 合并、FFmpeg | GPLv3 |
| [Video DownloadHelper](https://www.downloadhelper.net/) | 右键秒存、类型筛选、快捷键交互范式 | 闭源（借鉴设计） |
| [Plucker XBD](https://chromewebstore.google.com/detail/plucker-xbd/...) | 自定义命名 + 下载到文件夹的产品体验 | 闭源（借鉴设计） |
| [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect) | B站 WBI 签名与 playurl 接口文档 | CC BY-NC-SA 4.0 |
| [avi12/youtube-downloader](https://github.com/avi12/youtube-downloader) | YouTube 页面变量提取 + 签名 decipher | Apache-2.0 |

## 许可证说明

本项目为猫抓的衍生作品：**整体遵循 GPLv3**（与猫抓一致），保留上游 LICENSE 与署名。个人自用不分发，无额外义务；集成自 Apache-2.0 项目的代码保留其版权声明。

> ⚠️ `.env` 等含凭据的文件已被 `.gitignore` 屏蔽，请勿手动提交。
