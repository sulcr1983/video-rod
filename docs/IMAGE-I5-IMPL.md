# 图片下载设置与快捷键 · I5 实现规格

> 版本：v1.0 ｜ 日期：2026-10-25 ｜ 状态：**实施中**
> 上游方案：[IMAGE-DOWNLOAD-PLAN.md](IMAGE-DOWNLOAD-PLAN.md) v1.2 §1.7 快捷键 + §2.1 文件清单第 5/7 项
> 前置：[IMAGE-I3-IMPL.md](IMAGE-I3-IMPL.md)（批量队列）、[IMAGE-I4-IMPL.md](IMAGE-I4-IMPL.md)（浮标 + 面板）
> 本文范围：**只做 I5**（设置项 + 快捷键 + 性能收尾）。图集（I6）不在本次内。

---

## 0. 决策（用户已确认）

| 项 | 决定 |
|---|---|
| 设置落点 | **两处都做**：清单面板内齿轮 + 上游设置页新增「图片下载」分区，共用同一份 `vrLibSettings` |
| 快捷键 | **做，默认开启**（`Alt+Shift+D` 下载悬停图 / `Alt+Shift+A` 开清单） |

---

## 1. 设置项定义

全部存在 `chrome.storage.local` 的 `vrLibSettings` 下（沿用既有键，不新建命名空间）。

| 键 | 类型 | 缺省 | 范围 | 含义 |
|---|---|---|---|---|
| `imgHover` | bool | `true` | — | 悬停显示「下载原图」按钮（I1/I2） |
| `imgBatch` | bool | `true` | — | 悬停条显示「全部 N」按钮（I3） |
| `imgPanel` | bool | **`false`** | — | 右下角浮标 + 清单面板（I4）。**2026-10-25 改为默认关**：批量下载是低频操作，不该占常驻 UI（竞品 Image Downloader / Image Harvest 也都不放页面浮标，见 `docs/RESEARCH-COMPETITOR-IMAGE.md` §2）。设置里可开回。 |
| `imgMinSize` | int | `100` | 16–4096 | 最小尺寸（短边像素），滤掉图标/装饰图 |
| `imgPreferOriginal` | bool | `true` | — | 优先取原图（五级候选），关掉则直接用 `currentSrc` |
| `imgConcurrency` | int | `3` | 1–8 | 批量并发数 |
| `imgBatchLimit` | int | `200` | 1–2000 | 单批上限 |
| `imgHotkeys` | bool | `true` | — | 启用 `Alt+Shift+D` / `Alt+Shift+A` |
| `imgHoverDelay` | int | `300` | 0–1500 | 悬停多久出按钮（ms） |
| `imgBgScan` | bool | `true` | — | **2026-10-25 新增**：清单面板是否也扫 CSS `background-image`。很多站点把封面做成背景图，只看 `<img>` 会漏；但背景图扫描要 `getComputedStyle`，长页面上有开销，故给开关 |

> `imgHoverDelay` 是本次新增：原来写死 300ms，有人嫌快有人嫌慢，做成可调。
> `imgBgScan` 是 2026-10-25 新增（`js/lib-image-util.js` 的 `scanBackgrounds`）。

---

## 2. 面板内设置（`js/image-panel.js`）

### 2.1 入口

面板标题栏加一个齿轮按钮（`⚙`），点开**替换**面板主体内容为设置区（不是弹窗，避免又一层遮罩）。

```
┌──────────────────────────────────────┐
│ 图片下载设置                    [×]  │
│                                      │
│ 悬停按钮        [开关] 下载原图      │
│ 全部按钮        [开关] 显示「全部 N」│
│ 右下浮标        [开关] 本页图片清单  │
│ 最小尺寸        [100] px（短边）     │
│ 悬停延迟        [300] ms             │
│ 优先原图        [开关] 五级候选      │
│ 批量并发        [3]   （1–8）        │
│ 单批上限        [200] 张             │
│ 快捷键          [开关] Alt+Shift+D/A │
│                                      │
│              [恢复默认]  [完成]      │
└──────────────────────────────────────┘
```

### 2.2 行为

- 改动**立即生效并保存**（不设「保存」按钮，避免忘记点）；
- 「恢复默认」二次确认（就地变成「确定恢复？」再点一次）；
- 非法值（空/超范围/非数字）**就地红字提示，不写入**；
- 改 `imgHover` / `imgBatch` / `imgPanel` 后，对应模块通过 `storage.onChanged` 自行 teardown/重建，面板不用管。

---

## 3. 上游设置页分区（`options.html`）

在「其他设置」之后新增 `#anchorImage`：

```html
<section id="anchorImage">
  <h2>图片下载</h2>
  <!-- 与面板同一批键，双向同步 -->
</section>
```

- 侧栏加一项「图片下载」锚点；
- 控件复用上游已有的 `.switch` / `.input` 样式，不新造视觉；
- 读写走 `chrome.storage.local` 的 `vrLibSettings`，与面板**同一份数据**，改一边另一边即时反映。

---

## 4. 快捷键

### 4.1 定义

| 键 | 行为 | 前提 |
|---|---|---|
| `Alt+Shift+D` | 下载**鼠标当前悬停**的那张图 | `imgHover` 与 `imgHotkeys` 都开 |
| `Alt+Shift+A` | 打开本页图片清单 | `imgPanel` 与 `imgHotkeys` 都开 |

### 4.2 实现方式

用 **`chrome.commands`**（manifest 里声明），不用页面内 `keydown` 监听：

| 方式 | 优点 | 缺点 |
|---|---|---|
| **`chrome.commands`（选这个）** | 全局生效、不与页面按键冲突、用户可在 `chrome://extensions/shortcuts` 自行改键 | 需要 SW 转发到 tab |
| 页面内 keydown | 简单 | 会被站点抢、输入框里误触、无法改键 |

流程：

```
用户按 Alt+Shift+D
  ↓ chrome.commands.onCommand（SW 侧）
SW 查 imgHover/imgHotkeys 是否开启
  ↓ chrome.tabs.sendMessage({Message:'vrImg.hotkey', action:'download'})
内容脚本
  ↓ 取「最后一次 mouseover 的 img」（VRImgHover 记录）
  ↓ 走与点按钮完全相同的下载路径
```

> **关键**：内容脚本必须记录「最近悬停的 img」。鼠标不动只按键时，没有新事件，
> 所以 `image-hover.js` 里要在 `mouseover` 时把 `img` 存到 `lastHoveredImg`。

### 4.3 无悬停目标时

- toast 提示「把鼠标移到图片上再按」；
- 不做「猜你想下哪张」这类猜测。

---

## 5. 性能收尾（I5 附带）

| 项 | 现状 | 本次 |
|---|---|---|
| `scanImages` 调用频率 | 悬停时 500ms 缓存（I4 已加） | 缓存键加 `imgMinSize`，改尺寸后立即失效 |
| 面板首屏 | 24 张 | 保持；但**滚动追加改 `IntersectionObserver`**（比 scroll 事件省） |
| MutationObserver | 只对 img 进/出触发 | 保持 |
| 悬停条创建 | 每次 hover 新建？ | 复用同一宿主，只改位置（已如此，补断言） |

---

## 6. 文件清单

| # | 文件 | 类型 | 职责 |
|---|---|---|---|
| 1 | `docs/IMAGE-I5-IMPL.md` | 新增 | 本文 |
| 2 | `js/image-panel.js` | 修改 | 齿轮 + 设置区（读/写/校验/恢复默认） |
| 3 | `js/image-hover.js` | 修改 | 记录 `lastHoveredImg`；`imgHoverDelay` 可配；响应 `vrImg.hotkey` |
| 4 | `js/lib-image-util.js` | 修改 | 新增 `parseIntRange` / `DEFAULT_SETTINGS`（纯函数，可单测） |
| 5 | `js/background.js` | 修改 | `chrome.commands.onCommand` 转发 |
| 6 | `manifest.json` | 修改 | `commands` 增两条 |
| 7 | `options.html` | 修改 | 新增 `#anchorImage` 分区 + 侧栏项 |
| 8 | `tools/test-image-settings.js` | 新增 | 设置校验纯函数单测 |
| 9 | `tools/cdp-image-settings-test.py` | 新增 | 端到端：面板设置 / 设置页 / 双向同步 / 快捷键 |
| 10 | `deliverables/assets/image-settings-*.png` | 新增 | 截图 |

---

## 7. 验收标准

### 7.1 单测 `tools/test-image-settings.js`（≥30 条）

1. `parseIntRange` 边界：空/非数字/负数/0/超上限/小数/带单位；
2. `DEFAULT_SETTINGS` 字段完整性与类型；
3. 合并逻辑：部分键缺失时补默认、多余键保留、类型不符时纠正；
4. 每个设置项的合法范围校验。

### 7.2 端到端 `tools/cdp-image-settings-test.py`

必须覆盖：
1. 面板齿轮打开设置区、标题正确；
2. 改「最小尺寸」→ 面板张数变化、`vrLibSettings` 落库；
3. 改「悬停延迟」→ 悬停按钮出现时机变化；
4. 关「悬停按钮」→ 悬停不再出按钮；开回来恢复；
5. 关「右下浮标」→ 浮标消失；开回来恢复；
6. 关「全部按钮」→ 悬停条只剩一个按钮；
7. 非法值（空、`abc`、`9999`）→ 红字提示且不写入；
8. 「恢复默认」→ 所有键回到缺省；
9. **双向同步**：设置页改 → 面板读到新值；面板改 → 设置页读到新值；
10. 快捷键 `Alt+Shift+A` 打开面板；
11. 快捷键 `Alt+Shift+D` 下载悬停图（落盘 1 个文件）；
12. 关 `imgHotkeys` 后快捷键无效；
13. 控制台 0 error。

### 7.3 回归（必须全绿）

| 套件 | 基线 |
|---|---|
| `test-image-util.js` | 58/58 |
| `test-image-batch.js` | 27/27 |
| `test-image-tier.js` | 57/57 |
| `cdp-image-test.py` | 34/34 |
| `cdp-image-batch-test.py` | 35/35 |
| `cdp-image-panel-test.py` | 46/46 |
| `yt-download-test.py` | 21/21 |
| 其余资源库套件 | 全绿 |

---

## 7.4 实测结果（2026-10-25）

| 套件 | 结果 |
|---|---|
| `node tools/test-image-settings.js` | **47 / 47** |
| `tools/cdp-image-settings-test.py` | **48 / 48** |

### 7.5 实施中踩的坑（都已修）

1. **`settings` 变量根本没声明**：一次 patch 里三处替换，第三处匹配失败导致整个
   `open(...).write()` 没执行，前两处白改。表现是「UI 变了但存储永远是空」。
   **教训**：一次 patch 只改一处，或者改完立刻 grep 验证。
2. **`toast` 在 `image-hover.js` 里不存在**：它在 `image-batch.js`。快捷键下载里直接调
   `toast(...)` 会抛 `ReferenceError`，把 Promise 永久卡住 → `sendResponse` 永不触发。
   修法：加 `note()`，优先用 `VRImgBridge.toast`，否则退回 console。
3. **`display:flex` 盖掉 `hidden`**：`.vr-foot` 的 `display:flex` 让 `hidden` 失效，
   设置区打开时底部还挂着「已选 0 张 / 下载选中」。
   修法：显式写 `.vr-foot[hidden] { display:none }`（I3 的 `.vr-wrap` 踩过同一个坑）。
4. **`chrome.storage` 在页面主世界不可用**：测试里 `cdp.eval` 默认在主世界，
   读写存储全部报 `Cannot read properties of undefined (reading 'local')`。
   修法：存储与 `chrome.tabs.sendMessage` 一律在扩展页（`osid`）执行，页面侧只做 DOM 操作。
5. **`VRImageUtil` / `VRImgPanel` / `VRImgHover` 都在隔离世界**：主世界 `typeof` 是
   `undefined`。断言要用 DOM 表现（悬停条出现、面板张数）间接验证，不能直接读对象。

### 7.6 测试脚手架的坑

1. **写 storage 是异步的**：改完设置立刻断言必挂。加 `wait_setting()` 轮询到目标值。
2. **文件名日期前缀每天变**：`20261025_测试站 xxx.jpg`，早先写死 `20261024_` 判断测试产物，
   第二天就失效 → 「快捷键下载落盘 0 个文件」。改成**含「测试站」**判定。

## 8. 风险与边界

1. **`chrome.commands` 可能被系统或其他扩展占用**：注册失败时 SW 记日志，设置页显示「快捷键未生效，可在 chrome://extensions/shortcuts 改」。
2. **快捷键在输入框里触发**：`chrome.commands` 是浏览器级，输入框聚焦时也会触发。判断 `document.activeElement` 是 input/textarea/contenteditable 时忽略 `D`。
3. **设置项过多导致面板臃肿**：设置区是**替换主体**而非并列，不占常驻空间。
4. **`imgMinSize` 与 `scanImages` 的 `MIN_SIZE` 常量**：原来写死 100，现在要读设置。`MIN_SIZE` 保留作缺省值，实际用 `settings.imgMinSize`。
