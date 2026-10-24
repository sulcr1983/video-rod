# LIBRARY-PLAN v1.5 方案审计方案

> 版本：Audit-Plan v1.0 ｜ 日期：2026-10-24 ｜ 编制：QoderWork ｜ 委托：Sunny姐姐
> 被审对象：`docs/LIBRARY-PLAN.md` v1.5（含 §13.7 S0 实测结果）+ `deliverables/prototypes/library-prototype-v1.html`（v1.3，约 110 KB 单文件）
> **口径更新（v1.4）**：项目是**私有仓库、本机自用、不分发**（上游 GPL-3.0 不产生分发义务）。**开源代码能抄就抄**，按引入成本择优（§6.2）。本手册中凡涉及许可证义务的段落均以此为准。
> 交付：本文件即审计执行手册，审计人按此走一遍即可给出通过/条件通过/否决结论。

---

## 0. 审计定位（先讲清楚"审什么、审到什么程度"）

**审什么**：方案能不能立得住、会不会掉数据、Chrome 侧的限制是否被正确绕过、开源做法取舍是否有依据。

**不审什么**：不评代码质量（还没写产品码），不评 UI 美学（原型已看过），不评需求本身对不对（是 Sunny 自用，需求成立由她自己确认）。

**三态结论**：
- **PASS** 通过，可进入 P0 探针与 P1 实施
- **CONDITIONAL** 有条件通过，须补 N 条设计约束
- **FAIL** 阻断，需重新选型或大改方案

---

## 1. 审计方法论（对抗性 4 步法）

每一步都对每一条"设计断言"走一遍。断言来自 LIBRARY-PLAN 里所有"可以/已实测/不会/复用/已拍板"这类句式。

| 步骤 | 做什么 | 产出 |
|---|---|---|
| ① 断言还原 | 把方案里的每条主张写成"如果 X，则 Y，因为 Z" | 断言清单（本文 §2 已初拟） |
| ② 反例构造 | 对每条断言，构造一个能让 Y 不成立的场景（断电、边界值、并发、企业策略、旧版浏览器、恶意文件名…） | 攻击矩阵（§3） |
| ③ 外部证据核对 | 每条断言到官方规范、Chromium issue、上游源码、类似开源项目找证据；不接受"我觉得行" | 证据核对表（§4） |
| ④ 兜底/退化 | 若反例成立，问：方案里的退化路径能不能真的兜住？兜不住要补什么约束？ | 结论 + 补充约束清单 |

**为什么用对抗性而不是清单式打勾**：LIBRARY-PLAN 已经自带 §11 "审计指北"，普通走查只是复述它的 Q1–Q5。对抗性要求**主动想方案没写到的失败模式**——比如 §5.4 的"复制→删源"没考虑杀毒锁文件、§5.3 回收站与 Windows 回收站的关系、§4.4 `file://` 与 MV3 CSP 的兼容、GPL-3.0 与"内核不动"的传染性、↑↓ 键盘被原生 video controls 吞掉——这些一旦落地就是事故。

---

## 2. 断言清单（从 LIBRARY-PLAN 里抽取，共 24 条）

编号 A01–A24，供 §3 攻击矩阵引用。

| # | 断言 | 出处 |
|---|---|---|
| A01 | 现有代码已具备下载、命名、嗅探，只差资源库页面 | §0.2 |
| A02 | 复用猫抓内核，只加不改，回归风险可控 | §0.1 |
| A03 | Chrome 下载目录可一次性指定，扩展只写相对路径即可 | §4.4 |
| A04 | `chrome.downloads.search()` 能返回**绝对路径** `filename` | §4.4 |
| A05 | 扩展页面开启"允许访问文件网址"后 `<img>/<video src="file://…">` 可直接播放 | §4.4 |
| A06 | 因此"日常使用不需要每次启动授权目录" | §4.4 |
| A07 | FSA 句柄只在首次全量扫描与迁移用一次 | §4.4 |
| A08 | 中文目录 + `@ID` 括号 + 日期前缀 + 序号，Windows/macOS/Linux 主流工具兼容 | §4.1/4.2 |
| A09 | 单段 ≤60 字符、总路径 ≤240 字符是 Windows 安全边界 | §4.2 |
| A10 | `naming.js` 的 `SITE_RULES` 能覆盖 B站/小红书/X/YouTube 主要场景 | §4.1 |
| A11 | 博主改名不会分裂同一人（用 `creatorId` 归并） | §5 |
| A12 | 索引可从文件系统随时重建 | §5 |
| A13 | 缩略图懒生成 + 队列串行 + 并发 2 不会白屏 | §5/§8 |
| A14 | 迁移采用 dry-run→复制→校验大小→删源，安全可回滚 | §5.4 |
| A15 | 迁移日志 JSON 可反向执行回滚 | §5.4 |
| A16 | 软删除到 `_回收站/日期/原相对路径` 可原样恢复 | §5.3 |
| A17 | 二次确认显示文件名与大小即可防误删 | §5.3 |
| A18 | 视频 ↑↓ 切换、←→ ±5 秒 在弹层内不冲突 | §6/§6.1 |
| A19 | 悬停视频 550ms 触发静音循环预览不影响性能 | §6 |
| A20 | 连播在最后一个视频停止并提示 | §6 |
| A21 | 1 万级文件可用；10 万级偏吃力需升级本地索引服务 | §三 |
| A22 | 全本地、无云端、隐私无忧 | §一/§8 |
| A23 | 私有库自用不分发，GPL-3.0 不产生分发义务；开源代码按成本择优复用 | §0.1、§6.2 |
| A24 | v1 不做云同步/AI 打标/转码/移动端 是合理边界 | §一 |

---

## 3. 对抗性攻击矩阵（对 §2 每条断言构造反例）

严重度：S1 阻断 / S2 需补设计约束 / S3 需实测确认 / S4 记录即可。

| 攻击 # | 目标断言 | 反例场景（怎么打破它） | 若成立 → 影响 | 建议严重度 |
|---|---|---|---|---|
| ATK-01 | A04 | 用户手动"清除下载记录" / 使用无痕窗口 / 换设备登录 | 绝对路径全丢，索引失联，只剩全量扫描兜底 | S2 |
| ATK-02 | A04 | `downloads.search({})` 未加 `query`，大库一次返回上万条 | 首屏 OOM / 主线程冻结 | S2 |
| ATK-03 | A05 | Chrome 137+ 逐步收紧扩展访问 `file://`；MV3 CSP 默认 `img-src` 是否放行 `file:` scheme 未验证 | 播放方案退化到 FSA blob URL，每次重启都要用户手势授权（A06 崩塌） | S1 |
| ATK-04 | A05 | `file://` URL 里的路径含 `@`、中文、空格、`()`——浏览器是否 URL-encode？扩展拿到 `filename` 拼 `file:///D:/xxx` 是否会因编码错乱 404？ | 大量文件"点不开" | S1 |
| ATK-05 | A03 | 企业 Chrome 有 `DownloadDirectory` / `DefaultDownloadDirectory` 策略锁定；或用户是家长监管账号 | 用户不能改下载目录，方案第一步就卡住 | S2 |
| ATK-06 | A03 | Chrome 下载路径与用户手改的下载目录不一致（OneDrive 重定向 `Downloads`） | 相对路径写到 OneDrive，触发按需下载把本地"占位符"当文件索引 | S2 |
| ATK-07 | A06 | 用户把根目录挪到 `D:\Media` 之外的位置（外置硬盘、云同步盘） | 盘符变了 / 挂载点掉了 → 索引失联 | S2 |
| ATK-08 | A07 | FSA 句柄存 IDB 后跨会话重启，`queryPermission` 返回 `prompt`——Chrome 官方文档明确说要**用户手势重新授权**（developer.chrome.com blog） | 迁移/写权限每次会话首次都要点一次"授权"，与"不每次授权"承诺矛盾 | S1 |
| ATK-09 | A08 | macOS HFS+/APFS 对全角字符 NFC/NFD 归一化差异；`@xiaoyu123` 中的 `@` 在 shell 补全、Git 索引、某些云盘（Google Drive 的 `@` 有时被识别为 shared drive 引用）会踩坑 | 迁移或分享后目录名对不上 | S3 |
| ATK-10 | A09 | Windows 260 是**旧 API** 限制；开启 `LongPathsEnabled` 后可到 32767，但 Explorer/一些压缩工具/杀软仍按 260 处理；`\\?\` 前缀通过 FSA/`chrome.downloads` 不透明 | 长标题 + 深博主目录，写到边界 Chrome 静默失败 | S2 |
| ATK-11 | A10 | 小红书分享链是 `xhslink.com/xxx` 短链，落到落地页 URL 结构变了；X 的 `twitter.com` 与 `x.com` 双域名；B 站空间页和视频页 host 相同但结构不同 | 平台识别错误 → 文件进错目录 | S2 |
| ATK-12 | A11 | 小红书/抖音的博主 ID 会因登录态、地区、URL 参数（`?xsec_token=`）变化，同一人不同链接得到不同 ID | "creatorId 归并"失效，同一博主裂成 N 个目录 | S1 |
| ATK-13 | A12 | 索引重建依赖 URL→平台反查；下载历史丢失时，只有文件名，反查不到 source URL，`sourceUrl`/`downloadId` 字段永远缺失 | "重建索引不丢数据"承诺打折扣：目录不丢但元数据丢 | S2 |
| ATK-14 | A13 | 视频首帧解码在 ARM 笔记本 + 硬件解码偶发失败；WebP 缩略图 blob 存 IDB 无驱逐策略，1 万张 × 80KB ≈ 800MB，逼近 Chrome 存储配额 | 缩略图静默丢失、播放失败 | S2 |
| ATK-15 | A14 | "校验大小"≠"内容一致"：NTFS 复制后大小可对但字节不同（罕见）；更常见是杀软/索引服务在删源前锁住新文件 | 半途状态：源文件已删，新文件不可读 | S1 |
| ATK-16 | A14 | 目标目录已存在同名但**内容不同**的文件（用户手动放过），方案的"冲突跳过"→用户看到"待整理"，实际未迁移 | 用户以为已迁移，重复操作 | S2 |
| ATK-17 | A15 | 用户手工清理了 `_migration/` 目录（当作垃圾），回滚失败 | 无法回滚 | S2 |
| ATK-18 | A16 | `_回收站` 是应用内概念，用户在 Windows 回收站找不到；备份软件（Time Machine、NBU、Syncthing）会同步整个根目录含回收站 | 备份体积翻倍 / 用户误以为不可恢复 | S2 |
| ATK-19 | A16 | 回收站"超过 30 天或 5 GB 提示清理"——如果用户按提示清理且当时有未察觉的误删 | 永久丢失 | S2 |
| ATK-20 | A17 | 二次确认弹窗在批量删除 100 个时展示什么？文件名列表？截断？用户可能不滚动就点确认 | 批量误删 | S2 |
| ATK-21 | A18 | `<video controls>` 原生控件在**焦点位于 video 元素时**吞掉 ↑↓（调节音量/亮度）和空格（播放/暂停），方案的 `document.addEventListener('keydown')` 收不到——需要 `preventDefault` 或自绘 controls | 键盘体验与文档不一致 | S2 |
| ATK-22 | A19 | 悬停预览并发加载多个视频样本，弱网下 550ms 内可能一个都出不来，多个 loading 状态堆叠 | 视觉抖动 / 流量浪费 | S3 |
| ATK-23 | A20 | 连播到最后一个视频：`ended` 事件后停止——但若用户在最后一个视频上按 ↓，行为未定义 | 交互含糊 | S4 |
| ATK-24 | A21 | 1 万级阈值是拍脑袋数字：`downloads.search` + 缩略图并发生成，实际首屏时间未测 | 阈值可能低也可能高 | S3 |
| ATK-25 | A22 | 若审计者关心供应链：远程原型样本（MDN mp4、trae-api 图）在评审机上会向第三方发请求，日志暴露 IP + UA | 隐私与"全本地"叙事冲突（原型侧，非产品） | S3 |
| ATK-26 | A23 | 猫抓上游 LICENSE 是 **GPL-3.0**（GitHub repo 明示；1.0 曾为 MIT，2.0 起改 GPL v3）。本项目**私有库自用不分发**，不触发分发义务 | 义务不触发；第三方代码保留版权声明即可 | S2（v1.4 从 S1 降级） |
| ATK-27 | A24 | "v1 不做移动端"是合理边界，但"不做云同步"意味着换设备就要迁移一次——用户是否有第二台电脑？ | 需求边界与真实使用可能错位 | S4 |
| ATK-28 | A01/A02 | 猫抓上游正在推进 MV3 适配 / m3u8 加密流；fork 与上游脱钩后，安全修复（如 CSP 绕过）不会自动同步 | 长期维护成本被低估 | S3 |

---

## 4. 外部证据核对表（审计人逐条查证）

**规则**：每条断言至少一个权威来源。找不到来源的断言必须实测，实测结果作为附件。不接受"文档里这么说"作为证据。

| 断言 | 建议核对源 | 期望结论 |
|---|---|---|
| A03 下载目录策略 | Chrome Enterprise Policy `DefaultDownloadDirectory` | 若企业策略设置，用户不可改；需写入"已知限制" |
| A04 `downloads.search` 返回绝对路径 | Chrome 官方 API 文档 `chrome.downloads.DownloadItem.filename` | 文档明示 "absolute path"；但受"清除下载记录"影响 |
| A05 扩展访问 `file://` | MDN `extension.isAllowedFileSchemeAccess`；Chromium issue tracker；Chrome 137 release notes | 需实测：<img> 与 <video> 分别测；CSP 是否放行 `file:` scheme |
| A06/A07 FSA 句柄跨会话 | Chrome Blog "Persistent permissions for the File System Access API" | 句柄**可**存 IDB，但 `queryPermission` 在跨会话后返回 `prompt`，需用户手势重新授权 |
| A08 中文 + `@` 兼容性 | Microsoft Docs 路径限制、Google Drive 文件名规则、APFS 归一化 | 括号 `()` 与 `@` 在部分同步盘有边角；写"已知限制" |
| A09 路径长度 | Microsoft "Maximum Path Length Limitation" | 260 是旧 API；`LongPathsEnabled` 需注册表；Chrome FSA 是否透传需实测 |
| A10 平台识别 | 猫抓 `naming.js` 与 `SITE_RULES` 源码；小红书/X 域名变更历史 | 短链、多域名、`xsec_token` 参数是已知不稳定源 |
| A12 索引重建 | `downloads.search` 与文件系统枚举的能力差异 | 只能保"文件在"，`sourceUrl` 不可恢复 |
| A13 存储配额 | W3C Storage Manager API、Chrome quota 文档 | `navigator.storage.estimate()` 提供上限；需定义驱逐策略 |
| A15/A16 备份/回收站 | Windows Shell 命名空间、Syncthing/Dropbox 中文路径已知 issue | 应用内回收站不被 Windows 感知 |
| A18 键盘冲突 | W3C HTMLMediaElement 键盘行为；MDN `controls` 属性 | 焦点在 video 时原生控件优先；需 `preventDefault` 或自绘 |
| A23 上游 license | GitHub `xifangczy/cat-catch` README + LICENSE 文件 | **GPL-3.0**；本项目私有自用不分发，不触发义务；第三方代码保留版权声明（§6.2） |
| 方法论 | OWASP SAMM、STRIDE、Software Architecture Review Checklist（vickybytes） | 4 步对抗法与业界 review 清单同构 |

**审计执行方式**：允许审计人现场开 Chrome 做 15 分钟内的最小 PoC，尤其 A05/A07/A09/A18。方案文档 §4.4 已经写了 P0 探针清单——审计人应该照那个清单再核一遍，不接受"作者说已实测"（作者本人只测了 FSA 与扩展页面可用性，`file://` 直读**尚未测**）。

---

## 5. 需求覆盖度审计（R1–R14 逐条压力测试）

方案 §0.3 给了 14 条需求→章节的映射。审计要问的不是"有没有映射"，而是"映射是否真的兑现"。

| 需求 | 方案落点 | 审计追问 |
|---|---|---|
| R1 下载图片/视频 | 复用猫抓 | 猫抓已支持的 m3u8 合并、加密流、DRM 是否都能落到目录规范里？非 m3u8 分片怎么办？ |
| R2 资源库查看 | `library.html` | 单页面能撑多大？虚拟滚动方案？分页 60 张对搜索/筛选是否够用？ |
| R3 平台/博主/类型 | §4.1 | "待整理"目录会不会变成黑洞？多久清理一次？ |
| R4 命名规范 | §4.2 | 无标题时的 `${site}_${hash8}` 用户可辨识度 0；是否可接受？ |
| R5 多平台多博主查看 | §6 | 侧栏"博主（当前平台）"若某平台 500+ 博主怎么办？搜索博主？虚拟列表？ |
| R6 视频点开就播 | §5.2/§6 | 依赖 A05/A06，未实测；失败即退化 |
| R7 图片放大 | 灯箱 | 超大图（10MB+ HEIF/AVIF）解码上限？ |
| R8 不每次授权 | §4.4 | ATK-03/05/07/08 联合攻击，方案退化路径不完整 |
| R9 中文目录 | §4.1 | ATK-09/10 |
| R10 旧文件迁移 | §5.4 | ATK-15/16/17，"校验大小"太弱 |
| R11 删除权限 | §5.3 | ATK-18/19/20，回收站与系统回收站关系未定义 |
| R12 键盘切换 | §6 | ATK-21，原生控件冲突未处理 |
| R13 连播 | §6 | ATK-23，最后视频行为含糊 |
| R14 抄开源优秀做法 | §6.1 8 项 | 参考系是否完整？Eagle 智能文件夹、ExifTool 元数据、Lightroom 集合、digiKam 去重未评估 |

---

## 6. 原型行为审计（对照方案文档，逐项核一致性）

打开 `library-prototype-v1.html`，按下列 18 项操作走一遍，任何与方案文档文字不一致的地方记 FAIL 或 REVIEW。

| # | 操作 | 期望（方案文档） | 审计要点 |
|---|---|---|---|
| P1 | 点顶栏 `?` 评审说明 | 弹窗显示浏览顺序、快捷键、边界 | 内容是否与 §11.2 一致 |
| P2 | 点侧栏 B 站 | 过滤到 412 条 | 数字与方案 §6 布局示例是否吻合 |
| P3 | 搜索"海边" | 中文即时过滤 | 是否命中标题、文件名、博主名 |
| P4 | 切"列表" | 显示文件名+大小+路径 | 相对路径还是绝对路径？与 §4.4 一致性 |
| P5 | 点图片 | 灯箱打开 | 滚轮缩放范围与 §6 承诺 100%–400% 是否一致 |
| P6 | 灯箱 ← → | 切换上一张/下一张 | 与 §6 一致 |
| P7 | 双击图 | 100%/适应切换 | §6 承诺 |
| P8 | 点视频 | 弹层播放 | 演示样本 5.05 秒；真实 4K 长视频未测（§11.3 已声明） |
| P9 | 视频 ↑↓ | 切换上一个/下一个 | 焦点是否在 video 元素上时↑↓被吞（ATK-21）？ |
| P10 | 视频 ←→ | ±5s；Shift ±30s | 时长 5.05 秒时 ±5 是否越界钳位？ |
| P11 | 空格 | 播放/暂停 | 焦点在 video 时原生控件已处理，方案的 keydown 会不会双触发？ |
| P12 | 视频"连播"开关 | 播完自动下一个 | 演示样本极短，验证不到"最后一个停止"逻辑 |
| P13 | 卡片右键 | 上下文菜单 5 项 | 与 §6 交互清单一一对齐 |
| P14 | 悬停视频卡 | 550ms 静音预览 | 演示网络下能否稳定触发 |
| P15 | 删除 | 二次确认+显示文件名与大小 | 与 §5.3 一致？批量删除时如何呈现？ |
| P16 | 回收站恢复 | 单条/全部恢复 | 演示数据无原相对路径，"原样恢复"验证不到 |
| P17 | 迁移 dry-run | 生成计划、冲突标注 | "冲突跳过"文案与 §5.4 对齐？ |
| P18 | 断网打开原型 | 图片 onerror 兜底、视频加载遮罩 | 评审人网络差时的体验兜底是否真起作用 |

---

## 7. 数据与安全专项审计

**七问，必答**：

1. **唯一真相是文件系统**——那"索引丢了但文件在"能不能完全重建？答：目录能重建，`sourceUrl`/`downloadId` 不能。是否可接受？
2. **迁移过程中断**（断电/Chrome 崩/用户强杀）——复制完成但删源前崩溃，用户看到两份；下一次扫描如何处理？方案未定义"孤儿重复"检测。
3. **回收站与外部工具的关系**——用户在 Windows 资源管理器把 `_回收站` 里文件手动删了，索引怎么同步？
4. **符号链接 / 硬链接 / 重解析点**——OneDrive"按需文件"是重解析点；FSA 打开触发下载；`file://` 直读是否也触发？方案未处理。
5. **权限中途撤销**——迁移到一半用户在 chrome://extensions 关掉"允许访问文件网址"，怎么办？
6. **磁盘满**——复制中途 ENOSPC，方案"不 move"是对的，但错误处理没写。
7. **GPL-3.0 传染性**——fork 若上架 Chrome 商店或发给同事即触发开源义务。**v1.3 已更正**：项目已公开开源，copyleft 已履行；审计只需核对"是否引入了 GPL 不兼容的第三方源码"。

---

## 8. 与优秀方案对照（补齐 §6.1 之外的参考系）

审计人应到这些项目主页/文档过一遍，判断 LIBRARY-PLAN 是否漏掉了"别人踩过坑"的东西。

| 项目 | 参考点 | 若 LIBRARY-PLAN 缺失要补什么 |
|---|---|---|
| **Photoview** | 只读扫描、目录即相册 | 与方案同构，重点看它的**增量扫描**实现 |
| **Immich** | 大规模（5 万+）性能做法 | 参考它的**分片缩略图生成 + 队列** |
| **Eagle** | 智能文件夹 / 标签 / 评分 | v1 不做，但审计要看清"不做"的代价 |
| **Billfish** | 索引模式（不改原文件） | 方案 C 兜底已列，看索引模式是否可插拔 |
| **TagStudio** | 元数据 sidecar 方案 | 若将来做打标，`.tagsx` 思路值得抄 |
| **digiKam** | 数据库与文件系统双写 | 反面教材：过重 |
| **PhotoSwipe 5** | 灯箱事件模型 | 键盘处理与 ATK-21 直接相关 |
| **cat-catch** | 上游嗅探与下载实现 | License 与被 fork 的边界，看 README 与 LICENSE 文件 |
| **Chrome 官方 File System Access Blog** | 跨会话授权规则 | ATK-08 直接依据 |

---

## 9. 反脆弱补充审计（作者容易忽略、业界普遍踩坑）

| 主题 | 检查点 |
|---|---|
| 磁盘热插拔 | 根目录在外置硬盘上，硬盘拔了如何提示、如何恢复不崩溃 |
| 网络驱动器 | UNC 路径 `\\NAS\share` Chrome 是否支持；FSA 是否可用 |
| 云盘 | OneDrive/iCloud/Dropbox/坚果云的按需文件、路径重映射、`@` 与中文兼容性 |
| 多 Chrome Profile | 用户在 profile A 装了扩展，profile B 也装；索引/下载目录是否共享 |
| 无痕模式 | `downloads.search` 在无痕下不记录；方案未提 |
| 系统休眠 | 迁移中途休眠 → 恢复时的状态 |
| 杀软实时防护 | 复制后新文件被扫描锁定，删除源前 `EBUSY` |
| 权限降级 | `chrome.downloads` 无 `downloadsFilename` 权限时行为 |
| 时区 | `YYYYMMDD` 用本地还是 UTC；跨国时目录分组错乱 |
| 排序稳定性 | 同一秒内多个文件排序是否稳定 |
| 并发写 | 用户在 Explorer 里同时改名 |
| 大小写 | Windows 大小写不敏感但索引 key 是否统一 |

---

## 10. 待决策开放问题（请审计人给出倾向性意见）

从 LIBRARY-PLAN §11 五个 Q 深化到 8 问：

1. **Q1'** "不每次授权"是硬需求还是软偏好？如果 ATK-03/08 让承诺打折扣，用户能接受什么级别的退化？（可接受"每次会话第一次点一下"吗？）
2. **Q2'** P0 探针（file:// 直读）不通过时，方案的 B 计划是什么？（现在只写了"退化到 FSA"，但 FSA 每次会话都要授权）
3. **Q3'** 迁移"复制→校验大小→删源"是否升级为"复制→校验 SHA-256→删源"？成本约 30MB/s × 文件数，用户能否接受？
4. **Q4'** `_回收站` 与 Windows 回收站的关系要不要明示给用户？侧栏要不要加"系统回收站也有一份"提示？
5. **Q5'** `creatorId` 归并在小红书 `xsec_token` 会失效——是否宁可退回"每次识别都新目录 + 用户手动合并"的笨办法？
6. **Q6'** GPL-3.0 义务——**v1.4 已关闭**：项目私有自用不分发，不触发义务；第三方代码保留版权声明即可（§6.2）。
7. **Q7'** 视频键盘与原生 `<video controls>` 冲突——保留原生控件（`preventDefault` 局部键）还是自绘控件？成本 + 复杂度差多少？
8. **Q8'** 1 万阈值、550ms 悬停、±5s 步进——这些数字是拍脑袋还是有基准？

---

## 11. 审计产出模板（审计人按此填）

对每条 ATK（§3）与每条 A（§2）给一个三态结论 + 一句理由 + 一条建议。示例：

```
ATK-03 (A05, file:// 直读)：CONDITIONAL
理由：Chromium 137 起收紧扩展访问 file scheme；方案文档已声明"待实测"，未实测即交付风险大。
建议：把 P0 探针作为进入 P1 的**强制门槛**，探针失败即触发方案重构（考虑纯 FSA + 每次会话首次授权，明写为用户可接受代价）。
```

最后汇总：

| 结论维度 | 判定 |
|---|---|
| 架构选型（§三） | PASS / CONDITIONAL / FAIL |
| Chrome 限制绕过（§4.4/A03–A07） |  |
| 数据安全（§5.3/§5.4/A14–A17） |  |
| 交互完整性（§6/A18–A20） |  |
| 需求覆盖（§0.3/R1–R14） |  |
| 开源做法参考系（§6.1/A24） |  |
| 合规与许可（A23/§7） |  |
| 原型与方案一致性（§6 表） |  |
| 已知限制诚实度（§11.4） |  |
| **总体** |  |

**放行门槛**：S1 攻击项必须全部为 PASS 或已给出可执行退化；S2 至少 80% 有条件通过并写入方案文档 v1.2 的"已知限制/补充约束"章节；S3 允许留待 P0/P1 实测；S4 只记录。

---

## 12. 时间盒与工具

- 阅读 LIBRARY-PLAN.md 全文：30 分钟
- 打开原型走完 §6 的 18 项：20 分钟
- 现场跑 5 个关键 PoC（`file://` 直读、FSA 跨会话、长路径、中文+`@`+`()`、原生 controls 键盘冲突）：90 分钟
- 填 §3/§4/§5/§11 结论：60 分钟
- 复核方案 §11 五个 Q 是否被回答：15 分钟
- **合计约 3.5 小时**

工具：Chrome Dev Edition（另装，不动现有 Chrome）；PowerShell `New-Item -ItemType Directory/File` 造长路径 + 中文 + `@()` 样例；7-Zip 测压缩兼容性；Notepad++ 测 UTF-8 BOM/无 BOM；`nproc`/`wmic` 测磁盘。

---

## 13. 一句话结论模板（审计人最后交这个）

> 本方案在 **___** 项上完全成立，**___** 项需补约束（清单见附件 A），**___** 项需要 P0 实测（清单见附件 B），**___** 项判断为 FAIL 建议重构（附件 C）。**总体判断：通过 / 有条件通过 / 否决**。附加条件：___。

---

## 附录 A：外部权威链接一览（审计人核对用）

- [Persistent permissions for the File System Access API](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)
- [chrome.downloads API reference](https://developer.chrome.com/docs/extensions/reference/api/downloads)
- [Chromium issue 40453079 – download filename path](https://issues.chromium.org/40453079)
- [extension.isAllowedFileSchemeAccess (MDN)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/extension/isAllowedFileSchemeAccess)
- [Determine if "Allow access to file URLs" is enabled](https://stackoverflow.com/questions/48037986/determine-if-allow-access-to-file-urls-is-enabled-chrome-extension)
- [Maximum Path Length Limitation (Windows)](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)
- [Chrome Enterprise Policy – DefaultDownloadDirectory](https://chromeenterprise.google/policies/default-download-directory/)
- [xifangczy/cat-catch GitHub](https://github.com/xifangczy/cat-catch)
- [PhotoSwipe 5](https://photoswipe.com/)
- [Billfish](https://www.billfish.cn/)
- [Eagle alternatives that don't copy files](https://www.refern.app/blog/best-eagle-alternatives-without-copying-files-2026)
- [Self-hosting photo management (Photoview/Immich)](https://selfhosting.sh/best/photo-management/)
- [Software Architecture Review Checklist](https://vickybytes.com/blog/software-architecture-review-checklist)
- [Security Architecture Review Process and Checklist 2026](https://www.decryptiondigest.com/blog/what-is-security-architecture-review-how-to-run-one)

---

## 附录 B：S1 攻击项快速判读速查表

审计时间不够时，先只跑 S1（ATK-03, 04, 08, 12, 15, 26）——任一 FAIL 都不建议进入实施。

| 攻击 | 5 分钟能做的事 | PASS 信号 |
|---|---|---|
| ATK-03 file:// 直读 | 用 `--load-extension` 加载最小 MV3，页面里 `<img src="file:///C:/test/1.jpg">`，chrome://extensions 打开"允许访问文件网址" | `naturalWidth > 0` |
| ATK-04 中文 + `@()` 路径 | 造 `D:\test\B站\小鱼的旅行日记(@xiaoyu123)\视频\20261024_海边_三天两夜_[1080p].mp4`，走 ATK-03 同样的 video 标签 | `readyState ≥ 3` |
| ATK-08 FSA 跨会话 | `showDirectoryPicker()` 拿句柄存 IDB，重启 Chrome，读回句柄调 `queryPermission` | 返回 `granted` = 承诺成立；`prompt` = 承诺不成立 |
| ATK-12 creatorId 归并 | 小红书分享链接带 `xsec_token=` vs 不带，看 `naming.js` 抽出的 ID 是否一致 | 一致 = PASS；不一致 = FAIL 需改归并 key |
| ATK-15 迁移大小校验 | 手工造两个 8MB 但内容不同的 mp4，模拟 dry-run 冲突判定 | 应报冲突，实际可能只比大小 |
| ATK-26 GPL-3.0 | 读 cat-catch `LICENSE` 文件 + 检查原型/方案是否引入第三方源码 | LICENSE 为 GPL-3.0；项目已公开开源即义务已履行；若发现复制粘贴的第三方源码片段则 FAIL |

---

*审计方案到此结束。审计人交付物是一份填了结论的 §11 表 + 一段 §13 总结。*
