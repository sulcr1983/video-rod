# 图片批量下载 · I3 实现规格

> 版本：v1.0 ｜ 日期：2026-10-24 ｜ 状态：**实施中** ｜ 分支 `feat/image-i3`
> 上游方案：[IMAGE-DOWNLOAD-PLAN.md](IMAGE-DOWNLOAD-PLAN.md) v1.2（交互与候选链的权威口径）
> 前置：[IMAGE-I1I2-IMPL.md](IMAGE-I1I2-IMPL.md)（单张悬停下载，已完成并全绿）
> 交互基准：`deliverables/prototypes/image-hover-prototype-v1.html`（v1.2，确认条 + 进度条）
> 本文范围：**只做 I3**（本页一键全下 + 队列 + 进度 + 取消）。浮标/清单面板（I4）、
> 设置与快捷键（I5）、图集（I6）不在本次实现内，但接口按本文预留。

---

## 0. 边界（先说清不做什么）

| 项 | 本次 | 说明 |
|---|---|---|
| 一键下载本页全部 | ✅ | 悬停条右侧「全部 N」→ 确认条 → 队列下载 |
| 并发队列 + 进度 + 取消 | ✅ | 并发 3，进度实时回传，可中途取消 |
| 已下载去重 | ✅ | 用 `vrDownloaded` 表跳过本页重复图 |
| 单批上限 | ✅ | 默认 200 张，超出提示分批 |
| 失败不中断 | ✅ | 单张失败计数 + 记录，队列继续 |
| 浮标、清单面板、勾选批量 | ❌ | I4 |
| 设置页 UI（并发/上限/开关） | ❌ | I5；本次读 `vrLibSettings` 缺省值 |
| 图集 / 分页翻页 | ❌ | I6 |
| iframe 内图片 | ❌ | `all_frames:false`（与 I1/I2 一致） |
| 断点续传 / 重试 | ❌ | 失败项只报告，不自动重试 |

---

## 1. 文件清单

| # | 文件 | 类型 | 职责 |
|---|---|---|---|
| 1 | `docs/IMAGE-I3-IMPL.md` | 新增 | 本文，先于代码 |
| 2 | `js/image-batch.js` | 新增 | `VRImgBatch`：确认条、进度条、队列编排、取消 |
| 3 | `js/background.js` | 修改 | `vrImg.batch` 消息分支：并发池 + 进度广播 + 取消 |
| 4 | `manifest.json` | 修改 | 注册 `js/image-batch.js`（在 `image-hover.js` 之后） |
| 5 | `tools/test-image-batch.js` | 新增 | 队列纯逻辑单测（并发/去重/上限/取消） |
| 6 | `tools/cdp-image-batch-test.py` | 新增 | 端到端：确认条 → 下载 N 张 → 进度 → 落盘 → 取消 |
| 7 | `deliverables/assets/image-batch-{confirm,progress}.png` | 新增 | 验收截图 |

**不改**：`library.html`、`css/library.css`、`js/library/*`、`options.html`、`js/lib-image-util.js`、
`js/image-hover.js`（只通过既有 `VRImageUtil` 与消息协议协作）。

---

## 2. 交互

### 2.1 入口

悬停条从「单个下载原图」扩成两个按钮（原型 §1.1）：

```
┌──────────────┐
│ [⤓ 下载原图] [⤓ 全部 23] │
└──────────────┘
```

- 右侧按钮文案 `全部 N`，N = 本页符合过滤条件的图片数（`scanImages` 结果长度）；
- N === 0 时右侧按钮不渲染（避免「全部 0」）；
- 点击右侧按钮 → **不立刻下载**，弹确认条。

> 与 I1/I2 的关系：`image-hover.js` 已建好 Shadow DOM 宿主。本次在**同一个宿主内**
> 追加第二个按钮，不改 `image-hover.js` 的悬停/隐藏状态机，只扩展按钮组布局。

### 2.2 确认条

固定在视口底部居中，宽 `min(560px, calc(100vw - 32px))`：

```
┌─────────────────────────────────────────────┐
│ 本页找到 23 张图（已过滤 8 张小图）            │
│ 浏览器可能询问「是否允许下载多个文件」          │
│                    [下载 23 张] [先看清单] [取消] │
└─────────────────────────────────────────────┘
```

| 元素 | id | 行为 |
|---|---|---|
| 文案 | `vrImgCfText` | `本页找到 <b>N</b> 张图（已过滤 <b>M</b> 张小图）` |
| 下载 | `vrImgCfGo` | 关确认条 → 开进度条 → 调 `vrImg.batch` |
| 先看清单 | `vrImgCfList` | **I4 才实现**；本次点击提示「清单面板即将上线」并关闭确认条 |
| 取消 | `vrImgCfCancel` | 关确认条，什么都不做 |

- `Esc` 关确认条；
- 确认条同时只存在一个；再次点「全部」先关旧的再开新的。

### 2.3 进度条

底部居中，与确认条同位置：

```
┌─────────────────────────────────────────────┐
│ 正在下载 7/23 · 失败 1                  [取消] │
│ ████████░░░░░░░░░░░░░░░░░░░                │
└─────────────────────────────────────────────┘
```

| 状态 | 表现 |
|---|---|
| 进行中 | `正在下载 <done>/<total>` + 失败数（>0 才显示）+ 进度条宽度 = done/total |
| 完成 | `已下载 <ok> 张` + `失败 <fail> 张`（>0 时），3 秒后自动消失 |
| 取消中 | `正在取消…`，等已发出的请求返回后收尾 |
| 取消完成 | `已取消（完成 <done>/<total>）`，3 秒后消失 |

- 取消按钮在完成/取消完成后变为不可点；
- 进度条是 `<i>` 元素，必须 `display:block`（踩过：inline 不显示宽度）。

### 2.4 状态机

```
IDLE ──(点「全部 N」)──> CONFIRM ──(下载)──> RUNNING ──(全部完成)──> DONE ──(3s)──> IDLE
                            │                  │
                            ├─(取消/Esc)──> IDLE ├─(点取消)──> CANCELING ──> CANCELED ──(3s)──> IDLE
                            └─(先看清单)──> IDLE（I4 接面板）
```

`RUNNING` 期间：再次点「全部 N」无效（防重复入队）。

---

## 3. 技术实现

### 3.1 消息协议（`vrImg.batch`）

```js
// content → SW
{
  Message: 'vrImg.batch',
  action: 'vrImg.batch',
  items: [{ url, candidates, title }],   // 已去重、已过滤
  pageUrl, pageTitle,
  concurrency: 3,
  batchId: 'b-<timestamp>-<rand>'        // content 生成，用于进度匹配与取消
}
// SW → content（多次进度事件）
{ Message: 'vrImg.batchProgress', batchId, done, ok, fail, total, current }
// SW → content（最终）
{ ok: true, batchId, ok: N, fail: M, failures: [{url, code}] }
```

取消：

```js
// content → SW
{ Message: 'vrImg.batchCancel', action: 'vrImg.batchCancel', batchId }
// SW → content
{ ok: true, canceled: true, done: N }
```

- 进度广播用 `chrome.runtime.sendMessage`（content 侧 `onMessage` 监听，按 `batchId` 过滤）；
- SW 侧维护 `Map<batchId, {canceled:boolean}>`，每个任务开始前检查；
- SW 被回收后进度事件自然停止——content 侧有 60s 无进度超时，按「中断」处理。

### 3.2 并发池

```js
async function runPool(tasks, concurrency, worker) {
  let i = 0;
  const runners = Array.from({length: Math.min(concurrency, tasks.length)}, async () => {
    while (i < tasks.length) {
      const idx = i++;
      await worker(tasks[idx], idx);
    }
  });
  await Promise.all(runners);
}
```

- 并发默认 **3**（`vrLibSettings.imgConcurrency`，缺省 3，上限 8）；
- 每完成一张就广播一次进度（节流 200ms，避免刷屏）；
- **失败不中断**：`worker` 内部 try/catch，失败计入 `fail` 并记录 `{url, code}`。

### 3.3 去重

两级：

1. **页内去重**：`scanImages` 已按 URL 去重（I1 实现）；
2. **跨会话去重**：读 `vrLibSettings` 里的 `vrDownloaded` 表（relPath → 时间戳）。
   本次只做**同 URL 已下载则跳过**，键用候选链解析后的最终 URL。

> `vrDownloaded` 表当前不存在，本次新建：`chrome.storage.local` 键 `vrImgDownloaded`，
> 结构 `{ [url]: timestamp }`，上限 2000 条，超了按时间淘汰最旧。

### 3.4 上限

- 单批上限 `vrLibSettings.imgBatchLimit`，缺省 **200**；
- 超过则只取前 200 张，确认条文案追加「（本次只下前 200 张）」；
- 这是硬保护：`chrome.downloads` 短时间大量调用会触发浏览器「多文件下载」拦截。

### 3.5 落位

完全复用 I2 的 `vrImg.download` 逻辑：`video-rod/<平台>/<博主>/图片/<日期>_<标题>.<ext>`。
批量里每张的 `title` 取 `document.title`，重名由 `conflictAction: 'uniquify'` 生成 `(1)`。

> 批量时**不逐张弹 toast**（会刷屏），只在进度条里汇总；单张悬停下载仍走原来的 toast。

### 3.6 与 I1/I2 的协作边界

| 模块 | 职责 |
|---|---|
| `lib-image-util.js` | 只提供 `scanImages` / `collectCandidates`，**不改** |
| `image-hover.js` | 负责悬停状态机与「下载原图」按钮；本次**追加**「全部 N」按钮，共享宿主 |
| `image-batch.js` | 确认条、进度条、队列编排、取消；**不碰悬停逻辑** |
| `background.js` | `vrImg.batch` 并发池 + 进度广播 + 取消；复用 `vrImgDownload()` |

`image-batch.js` 与 `image-hover.js` 通过一个极小的共享对象通信：

```js
self.VRImgBridge = {
  count()            // 当前页可下数量（image-batch 提供，hover 读取）
  requestAll()       // 悬停条「全部 N」点击 → image-batch 弹确认条
};
```

> 为什么用 bridge 而不是直接互相 require：两个都是 content script，注入顺序固定，
> 但职责要分开（hover 只管悬停，batch 只管批量），用一个 20 行的桥最省事。

---

## 3.7 实测结果（2026-10-24）

| 套件 | 结果 |
|---|---|
| `node tools/test-image-batch.js` | **27 / 27** |
| `tools/cdp-image-batch-test.py` | **35 / 35** |
| 回归 `cdp-image-test.py`（I1/I2） | **34 / 34** |
| 回归 `cdp-library-page-test.py` | **30 / 30** |
| 回归 `cdp-trash-test.py` | **27 / 27** |

### 3.7.1 实施中踩的坑（都已修，别再犯）

1. **DNR 规则 id 撞车**：原用 `9000 + Date.now() % 900`，批量并发 3 时同一毫秒会拿到同一个 id，
   先完成的 `finally` 把别人的规则删掉 → 表现为「5 张只下到 3 张」。改成单调递增计数器。
2. **规则删太早**：`downloads.download()` 一返回就撤规则，此时请求可能还没发出，
   Referer 就丢了。改成等 `downloads.onChanged` 到 `complete`/`interrupted` 再撤（30s 兜底）。
3. **capture 阶段 stopPropagation**：给确认条/进度条加 `addEventListener('click', stop, true)`
   会把事件挡在按钮之前，按钮自己的 click 永远收不到。改为冒泡阶段拦。
4. **CSS `display` 重复声明**：`.vr-wrap` 里既写 `display:none` 又写 `display:flex`，
   后者覆盖前者 → 悬停条永远显示。一个选择器里只写一次 `display`。
5. **pending 阶段没取消计时器**：鼠标 300ms 内划过时，`mouseout` 只处理 `shown`，
   pending 的 `showTimer` 没清 → 按钮还是会弹出来（快速划过闪一下）。新增 `onLeaveImage()`。
6. **窄图盖满按钮组**：两个按钮加起来约 200px，会盖住小缩略图。图宽 < 140px 时
   「全部 N」收成纯图标（数字放 `aria-label`），功能仍可发现。
7. **按钮组盖住图片中心 → 自己把自己藏了**：按钮组宽约 200px，200px 的图几乎完全重合，
   鼠标停在图片中心其实已经落在按钮上，触发 `mouseout` → 按钮隐藏 → I1/I2 的 F1 间歇失败。
   修法：**按钮组宽度超过图宽 75%（且图宽 < 320）时也收成图标**，让按钮只占右上角一小块。
   判断用固定估算值 200px，不读 `offsetWidth`——否则收成图标后组变窄，下帧又判「不宽」，来回抖。

### 3.7.2 测试脚手架的坑

1. **`downloads.search` 计数不可靠**：记录登记时机不受控，SW 说「成功 5 张」时
   可能还有几条 `in_progress`。改用**磁盘文件集合**做最终判定。
2. **下载目录残留**：不清磁盘只擦记录，`uniquify` 会一直加 `(1)(2)`，计数全错。
   测试开头必须清磁盘。
3. **去重表异步写**：`vrImgRememberUrl` 是异步的，`clear_seen` 后可能又被写回。
   清两次 + 断言为空再继续。
4. **取消窗口极短**：本地测试站毫秒级下完 30 张，取消常常没赶上。
   测试里点完「下载」立刻点取消，并把「没赶上」如实打印出来，不假装成功。

## 4. 验收标准

### 4.1 单测 `tools/test-image-batch.js`（纯 Node，≥20 条）

覆盖：
1. `runPool` 并发不超过设定值；
2. 任务全部执行且只执行一次；
3. 单个任务抛错不影响其它任务；
4. 取消后剩余任务不再启动；
5. 去重表命中则跳过；
6. 上限截断到 N 且保留顺序；
7. 进度计数（done/ok/fail）准确。

### 4.2 端到端 `tools/cdp-image-batch-test.py`

必须覆盖：
1. 悬停条出现两个按钮，右侧文案 `全部 5`（夹具 5 张大图）；
2. 点「全部」弹确认条，文案含张数与过滤数；
3. 点「下载」→ 进度条出现，`正在下载 x/5`；
4. 全部完成后进度条显示 `已下载 5 张`，`chrome.downloads` 有 5 条 complete；
5. 落位路径全部含 `video-rod/.../图片/`，文件名格式正确；
6. 二次点「全部」→ 确认条提示「已下载过」（去重生效）；
7. 取消：点「全部」→「下载」→ 立刻点「取消」→ 状态变 `已取消`，已下的不删；
8. 上限：`imgBatchLimit=2` 时只下 2 张，文案含「只下前 2 张」；
9. 控制台 0 error / 0 exception；
10. 产出截图 `image-batch-confirm.png`、`image-batch-progress.png`。

### 4.3 回归（必须全绿）

| 套件 | 基线 |
|---|---|
| `tools/test-image-util.js` | 58/58 |
| `tools/cdp-image-test.py` | 34/34 |
| `tools/cdp-library-page-test.py` | 30/30 |
| `tools/cdp-trash-test.py` | 27/27 |

> `cdp-image-test.py` 的 B3 断言校验悬停按钮文案为「下载原图」，I3 追加第二个按钮后
> **第一个按钮文案不变**，断言应仍然通过；若失败说明改坏了 hover。

### 4.4 人工确认

- 确认条与进度条在 1440 与 900 宽度下都不遮挡页面主要内容；
- 深色站点对比度正常；
- 连点「全部」不会重复入队。

---

## 5. 已知边界与风险

1. **浏览器「多文件下载」拦截**：Chrome 首次批量下载会弹权限提示，用户必须点允许；
   文案里已提前告知（确认条第二行）。这不是 bug，无法用代码绕过。
2. **并发过高反而慢**：`chrome.downloads` 是单队列，并发 3 是实测折中；设置项留给 I5。
3. **SW 被回收**：长时间批量（>30s 无消息）SW 可能休眠，进度中断 → content 侧 60s 超时兜底。
4. **去重表容量**：2000 条上限，超出淘汰最旧；不做精确清理（收益低）。
5. **标题相同**：同页多图共用一个 `document.title`，文件名靠 `uniquify` 区分 `(1)(2)`，
   不做「按图片 alt 命名」（alt 普遍为空或广告词）。
6. **data URI 图**：`scanImages` 已过滤，批量不含。
