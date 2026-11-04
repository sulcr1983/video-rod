# 交接文档 · I5 图片设置与快捷键（进行中）

> 日期：2026-10-25 02:xx ｜ 状态：**新增：微博实测发现 2 个真缺陷，修复方案见第九节（优先于测试稳定性）**
>
> 优先级调整：手动验收微博发现「悬停不出按钮」「下载 403 落成 .htm」，
> 这是真实用户可见缺陷，**优先修第九节**；原第四节的两处测试不稳定降级处理（瘦身而非加固）。
> 上一提交：`fc24fdd fix(yt): MWEB 已被关闭，取格式改用 VISIONOS`
> 本文档目的：**如实交接当前状态**，包括「哪些是真的好」「哪些是我没搞定的」。

---

## 一、一句话现状

I5（设置项 + 快捷键）的**功能已经实现并通过了端到端测试（48/48）**，
但**改动全部还没提交**，而且 `--suite full` 跑全套时暴露出 **2 处测试不稳定**：

| 套件 | 单跑 | 全套 | 说明 |
|---|---|---|---|
| `test-image-settings.js` | 47/47 ✅ | 47/47 ✅ | 纯 Node 单测，稳定 |
| `cdp-image-settings-test.py` | 48/48 ✅ | 48/48 ✅ | 端到端，稳定 |
| `cdp-image-test.py`（I1/I2） | 34/34 ✅ | **B3/B4 偶发失败** | 悬停按钮有时不出现 |
| `cdp-image-batch-test.py`（I3） | 35/35 ✅ | **G0b 偶发失败 / 曾卡 150s** | 30 张页确认条没开 |

**结论：I5 本身是好的，问题在 I1/I2 与 I3 的测试稳定性 —— 而这两个的不稳定在我改 I5 之前就存在过**（见 HANDOFF §7.4-15）。

---

## 二、I5 到底做了什么（功能清单）

### 2.1 九个设置项（`js/lib-image-util.js`）

```js
DEFAULT_SETTINGS = {
  imgHover: true,          // 悬停显示「下载原图」
  imgBatch: true,          // 悬停条显示「全部 N」
  imgPanel: true,          // 右下角浮标 + 清单面板
  imgMinSize: 100,         // 最小尺寸（短边像素）
  imgPreferOriginal: true, // 优先原图（五级候选）
  imgConcurrency: 3,       // 批量并发 1–8
  imgBatchLimit: 200,      // 单批上限 1–2000
  imgHotkeys: true,        // 快捷键总开关
  imgHoverDelay: 300       // 悬停延迟 0–1500ms（新增）
}
```

配套纯函数：`parseIntRange` / `validateSetting` / `mergeSettings` / `RANGES`。

### 2.2 两处设置入口（用户明确要求「两处都做」）

| 位置 | 文件 | 形态 |
|---|---|---|
| 清单面板 | `js/image-panel.js` | 标题栏齿轮 → **替换面板主体**为设置区（不叠第二层遮罩） |
| 上游设置页 | `options.html` + `js/library/settings.js` | 新增 `#anchorImage` 分区 + 侧栏「图片下载」项 |

两边共用同一份 `chrome.storage.local` 的 `vrLibSettings`，都监听 `storage.onChanged`。

### 2.3 快捷键（用户要求「默认开启」）

| 键 | 行为 | 实现 |
|---|---|---|
| `Alt+Shift+D` | 下载鼠标最后悬停的那张图 | `chrome.commands` → SW → `vrImg.hotkey/download` |
| `Alt+Shift+A` | 打开本页图片清单 | 同上，`vrImg.hotkey/panel` |

关键点：`image-hover.js` 在 `mouseover` 时把 img 存进 `lastHoveredImg`（鼠标不动时没有新事件）。

---

## 三、⚠️ 必须知道的坑（这轮踩的，都已修但有教育意义）

### 3.1 一次 patch 改多处 = 全部白改

我写 I5 时用一个 patch 做三处替换，**第三处匹配失败抛 AssertionError，
整个 `open(...).write()` 没执行**，前两处白改。

表现极迷惑：UI 正常变了（因为第三处是 DOM 逻辑，早先已生效），
但 `settings` 变量从未声明，**存储永远写不进去**。
我花了很久才定位——因为「UI 变了」让我以为代码生效了。

> **规矩：一次 patch 只改一处，改完立刻 `grep` 验证。**

### 3.2 `toast` 在 `image-hover.js` 里不存在

它在 `image-batch.js`。快捷键下载里直接调 `toast()` 会 `ReferenceError`，
把 Promise **永久卡住** → `sendResponse` 永不触发 → 前端表现为「无响应」。
已改用 `note()`（优先 `VRImgBridge.toast`，否则 console）。

### 3.3 `display:flex` 盖掉 `hidden`（第二次踩）

`.vr-foot` 写了 `display:flex`，`hidden` 属性失效，设置区打开时底部还挂着「已选 0 张」。
必须显式写 `.vr-foot[hidden]{display:none}`。I3 的 `.vr-wrap` 踩过同一个坑。

### 3.4 去重表并发写入互相覆盖（**这是真 bug，不是测试问题**）

`vrImgRememberUrl` 原来是「读-改-写」直接发：批量下 5 张时 5 个调用并发跑，
各自读到同一个旧 map 再依次写回，**后写的把先写的覆盖掉** —— 5 张最后只剩 1~2 条记录。
表现是「明明下过却不去重」。

**已修**：改成 promise 链串行写 + 内存缓存；`vrImgSeenUrls` 读到存储为空时清缓存
（外部清表后不能拿旧缓存又写回去）。

### 3.5 测试里 `chrome.*` 在页面主世界不可用

`cdp.eval` 默认主世界，读写 storage 全部报 `Cannot read properties of undefined (reading 'local')`；
`VRImageUtil` / `VRImgPanel` / `VRImgHover` 在主世界也是 `undefined`（它们在隔离世界）。

> **规矩：存储与 `tabs.sendMessage` 一律在扩展页（osid）执行，页面侧只做 DOM 操作。**

### 3.6 测试产物判定不能写死日期

文件名形如 `20261025_测试站 F：xxx.jpg`，日期每天都变。
早先写死 `20261024_` 前缀，第二天就失效 → 「快捷键下载落盘 0 个文件」假失败。
已改成**含「测试站」**判定（三个图片测试都改了）。

---

## 四、🔴 我没搞定的两个问题（下一步从这里开始）

> **2026-10-25 更新**：本节降级为「测试方法问题」，不再是主线。
> 真实用户可见缺陷见**第九节**（微博悬停命中 + 防盗链下载）。

### 4.1 I1/I2 的 B3/B4 偶发失败

**现象**：`--suite full` 里 `cdp-image-test.py` 有时在 B3「悬停出现『下载原图』」失败，
`button_state` 返回 `None`（悬停宿主根本没建）。单跑 34/34 正常。

**已排除**：
- 不是 yt 干扰（移除 yt 条目后仍偶发，恢复后仍偶发）
- 不是 `imgHoverDelay` 被 I5 污染（I5 在套件顺序里排最后，且已加 cleanup）

**怀疑**：浏览器连跑 10 套后渲染变慢，`hover()` 固定等 0.65s 不够。
HANDOFF §7.4-15 记过同类问题，当时的修法是 `hover_until_shown()` 三次重试 —— 但**这次重试也没兜住**。

**建议排查方向**：
1. 把 `hover()` 的固定等待换成「轮询等悬停条可见」（`wait_button` 已有，但 `hover()` 本身没有）
2. 或给 B3 加诊断：失败时 dump `document.getElementById('vr-img-hover-host')` 是否存在、
   `VRImgHover._state()`（需在隔离世界读）

### 4.2 I3 的 G0b 偶发失败 + 曾卡 150 秒

**现象 1**：30 张页点「全部」后确认条没打开。
**现象 2**：我加的 `stable_click_bar` 里 `hover_bar_state` 高频轮询把 CDP 连接拖到
`Connection timed out`，整套卡 150 秒。

**已做**：`stable_click_bar` 限制为最多 6 次轮询、间隔 0.25s。
**未验证**：这个限流是否真的解决了卡死（最后一轮没跑完就被中断了）。

---

## 五、当前代码状态（未提交）

```
M  docs/DECISIONS.md          +ADR-047（设置两处入口）/ ADR-048（快捷键走 commands）
M  docs/HANDOFF.md            18 套 711 条基线、补 7 条新坑
M  docs/TESTING.md            +§23 I5 验收记录
A  docs/IMAGE-I5-IMPL.md      I5 实现规格（含实测与踩坑）
M  js/lib-image-util.js       DEFAULT_SETTINGS / RANGES / parseIntRange / validateSetting / mergeSettings
M  js/image-panel.js          齿轮 + 设置区（5 开关 + 4 数值 + 恢复默认）
M  js/image-hover.js          showDelay 可配、lastHoveredImg、hotkeyDownload、note()
M  js/image-batch.js          VRImgBridge 暴露 toast
M  js/background.js           去重表串行写（修并发覆盖）、vrImgHotkey、错误分类
M  js/library/settings.js     VRImgSettings（设置页读写）
M  manifest.json              commands: imgDownload / imgPanelOpen
M  options.html               #anchorImage 分区 + 侧栏项 + 加载 lib-image-util
A  tools/test-image-settings.js       47/47
A  tools/cdp-image-settings-test.py   48/48
M  tools/cdp-image-batch-test.py      去重等待、stable_click_bar、前缀判定
M  tools/cdp-image-panel-test.py      前缀判定
M  tools/cdp-run.py                   两套新测试进 full/image 分组
M  deliverables/assets/*.png          测试跑动重写的截图（**应 git checkout 回滚，别提交**）
```

> **截图噪音**：`deliverables/assets/*.png` 是测试跑动时重写的像素级差异，
> 提交前务必 `git checkout -- deliverables/assets/`。

---

## 六、下一步建议（按优先级）

### 第一步：先让基线回到全绿（别急着加功能）

1. 修 I1/I2 的 B3：把 `hover()` 改成轮询等按钮可见，而不是固定 sleep
2. 修 I3 的 G0b：确认 `stable_click_bar` 的限流生效，必要时改成「元素派发点击」而非坐标
3. 跑 `--suite full` 连续两次，两次都全绿才算稳定

### 第二步：提交 I5

```bash
git checkout -- deliverables/assets/          # 回滚截图噪音
git add -A
git commit -m "feat(image): I5 设置项与快捷键（面板齿轮 + 设置页分区 + Alt+Shift+D/A）"
```

### 第三步：I6（图集）

按 `docs/IMAGE-DOWNLOAD-PLAN.md` §1.5，图集模式：自动滚动加载、分页链接识别、翻页抓取。

---

## 七、环境与命令速查

```bash
# 全套回归（约 7 分钟）
VR_NODE="C:/Users/XPENG/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" \
  "C:/Users/XPENG/AppData/Local/Programs/Python/Python312/python.exe" \
  tools/cdp-run.py --suite full

# 只跑图片线
... tools/cdp-run.py --suite image

# 单套
... tools/cdp-run.py tools/cdp-image-settings-test.py

# 纯 Node 单测（不用浏览器）
node tools/test-image-settings.js   # 47/47
node tools/test-image-tier.js       # 57/57
```

- 测试站端口：18080（`test-site/` 目录）
- 下载目录：`D:\Users\liq21\Downloads\video-rod\其他网页\127.0.0.1\图片`
- Python 依赖：`websocket-client`（已装）

---

## 八、给接手者的话

这轮我把 I5 的功能做完了，端到端 48/48 是真实通过的。
但**全套回归里 I1/I2 和 I3 各有 1 条不稳定**，我没能在中断前彻底解决。

**这两条不稳定不是我改 I5 引入的**——I1/I2 的 B3 在 22:5x 那轮就偶发过
（HANDOFF §7.4-15 有记录），I3 的 G0b 也是同类时序问题。
但**现在它们更频繁了**，可能与浏览器连跑多套后的状态有关。

建议先用「轮询等可见」替换所有固定 `sleep`，再跑两遍全套确认。
如果两遍都绿，就可以提交 I5 了。

> **2026-10-25 更新**：以上降级。测试白盒点击自家浮层本身就是 flaky 源头，
> 后续按「删掉坐标点击、只留黑盒断言」瘦身，不再加固。

---

## 九、微博实测发现的两个真缺陷 + 修复方案（待执行）

### 9.0 结论先行

手动验收微博时发现：**识别到 21 张图，但悬停不出按钮、下载也失败**。
用 Chrome for Testing 有头浏览器 + CDP 完整复现，确认是**两个独立缺陷**：

| # | 现象 | 根因 | 影响面 |
|---|---|---|---|
| 1 | 悬停不出「下载原图」 | 图片被站点的播放按钮/遮罩覆盖，鼠标事件目标是 `SPAN`/`BUTTON`，不是 `IMG` | 微博、B 站、抖音、小红书视频封面等所有带遮罩的站点 |
| 2 | 点下载后落盘成 `.htm` | 微博 CDN 防盗链：扩展上下文请求 403，页面上下文请求 200 | 所有校验 Referer 的 CDN（微博、知乎、部分电商） |

### 9.1 实测证据（可复现）

**帧 1：识别正常，面板正常**

```
m.weibo.cn：img 总数 63，浮标数字 21
面板档位：小 21 / 中 0 / 大 0 / 超大 0（微博图短边多为 480，全落在「小」）
勾选后：已选 1 张，下载按钮可用 → 面板本身没坏
```

**帧 2：悬停命中被覆盖层挡住**

```
point(102,358) 元素栈（从上到下）：
  SPAN.mwbv-icon
  BUTTON.mwbv-play-button
  IMG                      ← 图片在第 3 层
  DIV.m-img-box
```

**帧 3：下载失败，落成错误页**

```
state: interrupted   error: SERVER_FORBIDDEN
file: ...\video-rod\其他网页\m.weibo.cn\图片\20261025_微博.htm   ← 存的是 403 页面
```

**帧 4：两条请求路径对比（同一 URL）**

| 上下文 | status | 结果 |
|---|---|---|
| 页面上下文 `fetch`（带页面 Referer/Cookie） | 200 | `type: cors`、`image/jpeg`、24981 B |
| 扩展上下文 `fetch` | **403** | `text/html` |

**帧 5：读浏览器缓存 vs 重新请求**

| 方式 | 耗时 | `transferSize` | 说明 |
|---|---|---|---|
| `fetch` 默认 | 16 ms | 300 B | 只有协商开销 |
| `fetch` `force-cache` | **3 ms** | **0 B** | 完全命中浏览器缓存，零请求 |
| canvas 导出像素 | — | 0 B | 可用但 33.6KB → 45.3KB，**重新编码丢原始字节** |

> 结论：优先 `force-cache` 读缓存；未命中时回落默认 fetch（此时才真的走网络，
> 但因为带页面 Referer，不会 403）；canvas 不作为主路径。

**帧 6：整条链路已端到端验证**

```
页面 fetch(blob) → vrQueueFilename(blobUrl, relPath) → <a download> 点击
结果：state=complete, bytes=53660
file: D:\...\Downloads\微博\_diag\图片\20261025_blob管线验证.jpg
```

说明**现有命名/归目录管线不用重写**，只要把「扩展直接下 CDN」换成「页面取字节」。

### 9.2 根因定位（代码级）

| 缺陷 | 位置 | 现有逻辑 | 为什么失效 |
|---|---|---|---|
| 1 | [image-hover.js](../js/image-hover.js) `pickImg()` | 只遍历 `ev.composedPath()` 找 `IMG` | 覆盖层是 `IMG` 的**兄弟/上层**，路径里根本没有 `IMG` |
| 2 | [background.js](../js/background.js) `vrImgDownload()` | `chrome.downloads.download(url)`，靠 DNR 补 Referer | 实测 DNR `modifyHeaders` 未生效（403 依旧）；且 `downloads` 不会走页面缓存 |

### 9.3 修复方案

#### A. 悬停命中：用元素栈兜底

文件：`js/image-hover.js`

```js
/** 站点的播放按钮/遮罩会抢走 mouseover，用元素栈兜底找底下的 IMG */
function imgAtPoint(x, y) {
    var list = document.elementsFromPoint ? document.elementsFromPoint(x, y) : null;
    if (!list) { return null; }
    for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].tagName === 'IMG') { return list[i]; }
    }
    return null;
}
```

`mouseover`：`var img = pickImg(ev) || imgAtPoint(ev.clientX, ev.clientY);`

`mouseout` 改成「按坐标判断是否真的离开当前图」，否则按钮会粘住：

```js
var under = pickImg(ev) || imgAtPoint(ev.clientX, ev.clientY);
if (!under || under !== currentImg) { onLeaveImage(); }
```

> 为什么这样改：鼠标在覆盖层里移动时 `under` 仍是 `currentImg`，不会误隐藏；
> 真正移出图片才隐藏。覆盖层内部不再需要特殊分支。

#### B. 下载取字节：页面 fetch → blob → `<a download>`

**B1** `js/background.js`：从 `vrImgDownload` 抽出 `vrImgPlan(msg)`，
只做校验 + 算 `relPath` + 组 `meta`，**不发起下载**，返回
`{ ok, url, relPath, meta, ext, title }`。

**B2** `vrQueueFilename(url, filename, conflictAction, meta, libUrl)` 增加第 5 参：

- 命名账按 `url`（这里传 `blobUrl`）登记，`onDeterminingFilename` 才认得出；
- 入库 `VRLib.record(libUrl, meta)` 与去重键必须用**真实图片地址**，
  绝不能用 `blob:...`（否则跨会话永久失效）。

**B3** `js/background.js` 新增两个消息：

| 消息 | 作用 |
|---|---|
| `vrImg.prepare` | 返回 `vrImgPlan` 的结果（只算名字，不下载） |
| `vrImg.registerBlob` | 入参 `{blobUrl, relPath, realUrl, meta}`；登记命名账 + 入库记录 + 去重预告；返回 `{ok}` |

并用 `chrome.downloads.onCreated` 匹配 `blobUrl` 拿 `downloadId`，
`onChanged` 到终态时：`complete` → 写去重表；`interrupted` → 回退去重标记 + 通知内容脚本失败。

**B4** 内容脚本 saver（放 `js/image-batch.js`，暴露 `VRImgBridge.saveImage`）：

```
1) vrImg.prepare           → relPath / meta
2) fetch(url, { mode:'cors', credentials:'include', cache:'force-cache' })
   抛错或 !r.ok → 回落 { cache:'default' } 再试一次
   仍失败       → 回落老的 vrImg.download（直连，保留原有 DNR 逻辑）
3) blob → URL.createObjectURL → vrImg.registerBlob(blobUrl, relPath, realUrl, meta)
4) <a href=blobUrl download=basename> 点击并移除
5) 30s 后 revokeObjectURL（批量用 60s 兜底，避免内存堆积）
```

必须**先 register 再点击**：否则 `onDeterminingFilename` 拿不到名字，会落成服务器名。

> ⚠️ **必须等回执，不能「发出即点」**（审计缺陷 1）：
> `sendMessage` 是异步的，如果发完立刻 `a.click()`，`onDeterminingFilename` 触发时
> `vrPendingNameByUrl` 里还没这条账 → 名字退回服务器名/UUID。
> 诊断脚本能成功是因为它**直接调 `vrQueueFilename()`（同进程同步）**，压根没走消息 ——
> **诊断通过 ≠ 消息链路通过**。
>
> ```js
> // 对：等 SW 回 ok 再点
> await new Promise(res => chrome.runtime.sendMessage(
>     { Message: 'vrImg.registerBlob', ... }, r => res(r)));
> a.click();
> ```
> SW 侧 `registerBlob` 也必须**在 `vrQueueFilename()` 之后**才 `sendResponse({ok:true})`。

**B5** 批量：`js/image-batch.js` 的 `runQueue` 改为本地并发池，逐张调用
`saveImage`；进度/取消都在内容脚本内完成。`background.js` 里的
`vrImgBatch` 删除（避免两套逻辑），批量兜底就是逐张走直连。

> ⚠️ **必须原样保留三个 UI 契约**（审计缺陷 2）：
> `cdp-image-batch-test.py` 的 45 条断言**全部读 DOM**，不碰消息，所以改实现不会挂 ——
> 前提是新并发池保留：
> 1. 确认条 `.vr-cf` + `.txt` 文案（含「N 张图」）
> 2. 进度条 `.vr-pg` + `.t` 文案（含「已下载」）+ `.bar i` 的 `style.width`
> 3. 完成态 `.done` class
>
> 这三样一改，45 条断言全废。别顺手改文案。

#### C. 失败归类与垃圾文件清理

- `403` / `SERVER_FORBIDDEN` → `code: IMG_E_BLOCKED`，文案「站点限制了直链下载」；
  ⚠️ **这个码要同步 3 处**（审计缺陷 3，现有错误码是分散硬编码、无统一字典）：
  `background.js` 返回处、`image-hover.js` 的 `flashFail` 文案、`image-batch.js` 的失败归类。
  漏一处就会把原始错误码直接显示给用户；
- 直连兜底如果产生了 `.htm` 错误页，在 `onChanged.interrupted` 里
  `chrome.downloads.removeFile(id)` + `erase`，不留垃圾；
- 悬停按钮显示「! 站点限制」而不是笼统的「失败」。

### 9.4 测试方案（三层，都不依赖外网）

#### T1 本地夹具（可重复，进 CI）

新增三个小文件：

| 文件 | 作用 |
|---|---|
| `test-site/overlay.html` | `<img>` 上盖一层 `div`（模拟微博播放按钮），验证悬停兜底 |
| `tools/test-site-guard.py` | 监听 **18081**（跨源），`/guarded/*` 要求 `Referer` 以 `http://127.0.0.1:18080` 开头并回 `ACAO:*`，否则 403 |
| `test-site/hotlink.html` | 引用 `http://127.0.0.1:18081/guarded/cover.jpg`，复刻防盗链 |

新增 `tools/cdp-image-save-test.py`（**1 套，约 10 条断言**）：

1. overlay 页：悬停 300ms 内出现「下载原图」（连跑 3 次都要过）
2. 守卫 URL 用扩展上下文直连 → 断言 403（证明夹具有效）
3. 新路径下载 → `complete`、`bytes` 与夹具文件一致、路径含 `video-rod/`
4. 批量 3 张 → 全部成功，且去重表写入真实 URL
5. 失败路径：故意让守卫 403 且禁用回落 → 断言提示 `IMG_E_BLOCKED`，无 `.htm` 残留

#### T2 真实站点手动清单（每次发版，5 分钟）

| 站点 | 动作 | 通过标准 |
|---|---|---|
| 微博 `m.weibo.cn` | 单图悬停下载 | 出按钮、文件是 `.jpg` 且能打开、大小与原图一致 |
| 微博 | 多图笔记「全部 N」 | 当前页全部落盘，无 `.htm` |
| 小红书 | 单图 + 批量 | 同上；文件名带博主 |

#### T3 回归口径

- 本次只**新增 1 套**（`cdp-image-save-test.py`），不动其余套件；
- I1/I2/I3 里靠坐标点自家浮层的断言，后续按瘦身计划改成 DOM 派发或直接删除；
- 目标口径：node 5 套 + CDP 4 套以内，总时长 < 2 分钟。

### 9.5 实施顺序（遵守「先文档、后代码」）

```bash
# 1. 文档先行（本次）
git add docs/HANDOFF-I5-WIP.md && git commit -m "docs(image): 微博实测缺陷与修复方案"

# 2. 先把 I5 存量改动提交推送，避免和本次混在一起
git checkout -- deliverables/assets/
git add -A && git commit -m "feat(image): I5 设置项与快捷键" && git push

# 3. 改 A（悬停命中）→ 用 overlay.html 验证
# 4. 改 B（页面取字节）→ 用 hotlink.html + 18081 守卫验证
# 5. 改 C（错误归类 / 清理 .htm）
# 6. 跑 T1；再做一遍 T2
# 7. git commit -m "fix(image): 覆盖层下的悬停命中与防盗链下载（缓存优先 + blob 落盘）"
```

### 9.6 验收标准（可量化）

- overlay 夹具：3 次连跑，悬停按钮均在 300ms 内出现
- hotlink 夹具：直连 403；新路径 `complete`、字节数**完全相等**、目录正确
- 微博实站：下载的 `.jpg` 用看图软件能打开，大小与 CDN 原图一致
- 全程目录下**不出现 `.htm` 文件**
- 批量 5 张：`complete` 5 条，去重表 5 条真实 URL
  （去重表是串行链 + 内存缓存，**必须轮询等待达到 5 条**，最多 8 秒；直接断言会读到 2~3 条就假失败）

### 9.7 风险与回滚

| 风险 | 处理 |
|---|---|
| 批量触发浏览器「是否允许下载多个文件」提示 | 属浏览器行为，UI 文案提示一次；不尝试绕过 |
| 大图 blob 占内存 | 单张 ≤10MB 正常；批量逐张 revoke，60s 兜底 |
| 站点 CSP 禁止 `blob:` 导航 | 自动回落直连 `vrImg.download`，并提示 |
| `force-cache` 未命中 | 实测首次必然回落 `default`，属预期，不算失败 |
| 去重键写错成 `blobUrl` | 代码里显式区分 `url` 与 `libUrl`，单测覆盖 |
| 回滚 | 只涉及 3 个文件 + 1 套新测试，`git revert` 单提交即可回到直连 |

### 9.8 明确不做

- 不引入 Playwright / Puppeteer（换一套轮子，还要重写全部测试）
- 不再投入 DNR 补 Referer（实测无效）。**注意**：DNR 代码留在 `vrImgDownload()` 的
  **直连兜底路径**上，主路径（blob）不经过它 —— 不是「保留不动」，是「降级为兜底」
- 不用 canvas 作主路径（重新编码，33.6KB → 45.3KB，丢原始字节）
- 不在本轮改 18 套回归结构（只新增 1 套）

### 9.9 给接手者的最短路径

```bash
# 复现（有头、可调试）
python tools/cdp-run.py --keep .work/diag-blob2.py     # 落盘链路
python tools/cdp-run.py --keep .work/diag-cache.py     # 缓存/耗时
python tools/cdp-run.py --keep .work/diag-weibo2.py    # 面板与 403 证据

# 注意：.work/ 已被 gitignore，诊断脚本不进仓库；
#      需要固化的用例请写进 tools/cdp-image-save-test.py
```
