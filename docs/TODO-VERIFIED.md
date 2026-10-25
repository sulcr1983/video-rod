# 未完成任务清单（核实版）

> 生成：2026-10-25 15:50 ｜ 方法：逐项用**实际代码**核实，不采信过时文档
> 代码 HEAD：`6cd444a`
> ⚠️ 本文替代 `HANDOFF.md` §7 的过时部分（那份停留在 2026-10-24，多项已做完但仍标「未做」）

---

## 一、先说结论

| 线 | 状态 |
|---|---|
| 资源库 S0 → S5b | ✅ 全部落地 |
| 图片线 I1 → I5 | ✅ 全部落地（本轮刚修完 I4/I5 的三个 bug + 补齐发现能力） |
| **图片线 I6（图集）** | ❌ **未开始**（`js/image-collection.js`、`js/album.js` 都不存在） |
| YouTube 下载 | ✅ 链路已通（VISIONOS 客户端可用，32 条格式带直链，最高 2160p） |
| **YouTube 深水区** | ❌ 未做（SABR 复放、流式落盘、WebM） |

**回归现状**：`--suite image` **10 套全绿**（本轮验证）。全量 5 组共 40 个套件条目。

---

## 二、真正未做的（按建议优先级）

### P1 · 图片线 I6 图集（唯一整块未开始的功能）

`HANDOFF` 里写「下一步是 I6」，核实确认**确实没做**：

| 预期文件（按设计文档口径） | 状态 |
|---|---|
| `js/image-album.js`（content script） | ❌ 不存在 |
| SW 侧 `vrImg.albumScan` / `albumProgress` / `albumStop` | ❌ **一条都没实现**（`background.js` 里 0 处引用） |

**注意**：HANDOFF 里只写了「I6 图集」四个字，实际设计在
`docs/IMAGE-DOWNLOAD-PLAN.md` §1.5 与 §2b（第 209 行），包含三种模式：

| 模式 | 做法 | 成本 |
|---|---|---|
| A. 自动滚动 | 滚动触发懒加载，边滚边收集 | 低 |
| B. 分页图集 | 识别「下一页」链接 → 逐页抓 | 中（慢，可能触发风控） |
| C. 站点 API | 直接调 JSON 接口 | 最高（要逐站适配） |

**开工前必须读 §1.5 + §2b**，不要凭一句话就动手。

### P2 · YouTube 深水区（三项，都是硬骨头）

| 项 | 现状 | 影响 |
|---|---|---|
| **SABR 复放** | 未做（路线 B 备选） | 若 VISIONOS 被关就无路可走 |
| **流式落盘** | 未做，双轨全量进内存 | 4K 长视频（>1GB）有 OOM 风险（>700MB 有预警） |
| **WebM(VP9)/Opus** | 只覆盖 MP4 容器 | 碰上只有 WebM 的档就只能拿低清 |

### P3 · 存量下载路径迁 FSA（文件名会退化）

**已核实**：`js/image-batch.js` 和 `js/background.js` 里 **0 处** FSA 相关代码。

Chrome 147 上 `chrome.downloads.download` 的文件名保护已失效（ADR-040 实测）：
blob 落盘成 UUID、http 下载丢名退化成 URL 末段、`suggest()` 被忽略。

**受影响**：弹窗下载 / 图片批量 / m3u8 —— 都会**静默落成随机名**。
新代码走 FSA 直写（`js/yt/yt-download.js` 的 `save()` 是范例），存量尚未迁移。

### P4 · B 模式（自定义目录）不完整

`js/library/archive.js` **不存在**。现在切到 `custom` 只改设置，
**新下载仍落系统下载目录**；`VRMigrate` 只能搬存量。

---

## 三、已被文档误标为「未做」但实际已完成（不要重做）

| 文档原话 | 核实结果 |
|---|---|
| 「I4 浮标 + 清单面板、I5 设置 UI/快捷键 —— 未做」 | ✅ **已做**：`js/image-panel.js` 存在且本轮刚修 × / 遮罩关闭 bug |
| 「缩略图未生成：`thumb` store 建了但为空，S3 才做」 | ✅ **已做**：`js/library/thumbs.js` 存在 |
| 「资源库查看器是基础版…自绘控件、↑↓ 队列与连播留 S4」 | ✅ **已做**：`video.js` / `keyboard.js` / `lightbox.js` 都在 |
| 「YouTube 线没验过活链路…需要 Sunny 复验」 | ✅ **已通**：`docs/YT-CLIENT-STATUS.md` 记录 VISIONOS 可用、32 条格式带直链、0.2 秒 |

---

## 四、还挂着的缺口（小项，非阻塞）

| # | 项 | 核实 |
|---|---|---|
| 1 | `deepVerify` 设置 UI | ✅ **确认缺失**：`options.html` / `settings.js` 里 0 处引用（引擎已支持） |
| 2 | `library.html` 首次打开自动索引 | ✅ **确认缺失**：没有 `build({mode:...})` 调用 |
| 3 | 构建链（产 `.crx/.zip`） | ✅ **确认缺失**：无 `package.json`，只能开发者模式加载 |
| 4 | 文档漂移：`DESIGN.md` 写的 `js/image-scanner.js` / `bilibili.js` / `youtube.js` 不存在 | 能力实际在 `popup-videorod.js` / `x-button.js` |
| 5 | 原生目录选择器未自动化 | full/snapshot 只用 OPFS 句柄验证过，「用户点选目录」靠手动 |
| 6 | 1k 文件首屏性能未压测 | 索引只测了正确性 |
| 7 | 快照保留 7 份的清理分支、downloads 超 5000 条的 `truncated` 分支未构造 | 测试覆盖缺口 |
| 8 | FSA 直写的文件不会自动入库 | YouTube 走 FSA 无下载事件，只能靠 indexer 全量扫描兜底 |

---

## 五、本轮刚做完的（避免重复劳动）

- 悬停定位改用 `@floating-ui/dom`（删掉手写防抖）
- 补齐图片发现：`picture>source`、CSS 背景图、去 resize 参数、URL 正则过滤
- 修三个实测 bug：小图误伤、面板关不掉、按钮抖动
- 浮标默认关闭（批量低频不占常驻 UI）
- 新增 `cdp-image-hover-hit-test.py`（26 条）、`cdp-image-discover-test.py`（17 条）
- 单测 `test-image-util.js` 89/89

---

## 六、我的建议顺序

1. **先补 `deepVerify` 设置 UI 和 `library.html` 自动索引** —— 都是一两小时的小活，补完资源库体验才闭环
2. **再做 I6 图集** —— 唯一整块未开始的功能，但要先读 `IMAGE-DOWNLOAD-PLAN.md`
3. **然后存量下载迁 FSA** —— 文件名退化是**用户可感知**的问题（下下来的文件叫 UUID），比 YouTube 深水区更值得先修
4. **YouTube 深水区放最后** —— 现状可用，只是 4K 长视频有 OOM 风险，属于「不碰就没事」
5. **B 模式（archive.js）** —— 如果 Sunny 实际不用自定义目录，可以一直不做

> 优先级判断依据：**用户可感知的问题 > 内部技术债**。文件名退化成 UUID 是天天看得见的，
> 而 SABR / WebM 是「万一碰上」。
