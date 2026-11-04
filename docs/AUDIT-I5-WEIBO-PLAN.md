# 方案审计 · 微博缺陷修复方案（HANDOFF-I5-WIP §9）

> 审计时间：2026-10-25 11:2x ｜ 对象：`docs/HANDOFF-I5-WIP.md` 第九节
> 方法：**逐条对照代码验证**，不采信文档自述；每条结论都标了代码位置。
> 结论：**方案方向正确、证据真实，但有 3 处会导致实施踩坑的缺陷，2 处事实表述不准。**

---

## 一、先确认：证据是真的

我把 `.work/` 下留存的诊断脚本逐个读了，**不是凭空写的结论**：

| 文档声称 | 对应脚本 | 核实结果 |
|---|---|---|
| 页面 fetch 200 / 扩展 fetch 403 | `.work/diag-fetch.py` | ✅ 脚本确实是双上下文对比，`PAGE_FETCH` 带 `credentials:'include'`，`EXT_FETCH` 不带 |
| `force-cache` 零请求 | `.work/diag-cache.py` | ✅ 用 `performance.getEntriesByType('resource')` 读 `transferSize`，方法正确 |
| blob → 命名管线接得住 | `.work/diag-blob2.py` | ✅ 先 `vrQueueFilename(blobUrl, target)` 再点 `<a>`，落盘确实是自定义名 |
| 覆盖层挡住悬停 | 文档帧 2 元素栈 | ✅ 与 `pickImg()` 实现吻合（见下） |

**根因定位也是准的**：

- `pickImg()`（`js/image-hover.js:346`）只遍历 `ev.composedPath()`。
  覆盖层是 IMG 的**兄弟或上层**，`composedPath()` 里根本不会有那个 IMG → 必然漏。
- `vrImgDownload()`（`js/background.js:610`）走 `vrDownloadWithName` → `chrome.downloads.download`，
  在**扩展进程**发起，不带页面 Referer → CDN 403。

这两条我都在代码里逐行确认过，方案没编。

---

## 二、🔴 三个会导致实施踩坑的缺陷

### 缺陷 1：`registerBlob` 的跨进程时序没写死「必须等回执」

方案 9.3 B3/B4 说「先 register 再点击」，但没明确**必须 `await` 回执**。

**为什么这是坑**：`chrome.runtime.sendMessage` 是异步的。
如果写成「发完消息立刻点 `<a>`」，`onDeterminingFilename` 触发时
`vrPendingNameByUrl` 里还没这条账 → 文件名退回服务器名（或 UUID）。

诊断脚本 `diag-blob2.py` 能成功，是因为它**直接调用了 `vrQueueFilename()`**（同进程同步），
压根没走消息。**诊断通过 ≠ 消息链路通过**。

**必须补的约束**：

```js
// 错：发出即点，必丢名
chrome.runtime.sendMessage({Message:'vrImg.registerBlob', ...});
a.click();

// 对：等回执确认账已登记，再点
await new Promise(res => chrome.runtime.sendMessage({Message:'vrImg.registerBlob', ...},
    r => res(r)));
a.click();
```

并且 `registerBlob` 的 SW 侧必须**在 `vrQueueFilename()` 返回之后**才 `sendResponse({ok:true})`。

> 这条要写进 §9.3 的代码步骤里，否则实施者大概率写成第一种。

### 缺陷 2：删 `vrImgBatch` 的影响面被低估（但可控）

方案 B5 说「`vrImgBatch` 删除」，同时 §9.4 T3 说「不动其余套件」。

**我查了实际依赖**：
- `tools/cdp-image-batch-test.py` 里对 `vrImg.batch` 的引用数 = **0**
- 该套件 45 条断言全部读 DOM（`.vr-cf` 确认条、`.vr-pg` 进度条）

**所以「不动套件」是成立的 —— 但有个前提方案没写**：
新的内容脚本并发池**必须原样保留这三个 UI 契约**：
1. 确认条 `.vr-cf` + `.txt` 文案（含「N 张图」）
2. 进度条 `.vr-pg` + `.t` 文案（含「已下载」）+ `.bar i` 宽度
3. 完成态 `.done` class

只要这三样不变，45 条断言不动也能过。**这条必须显式写进方案**，否则实施者会顺手改 UI 文案。

### 缺陷 3：`IMG_E_BLOCKED` 是新增码，但没有集中的文案表

我搜了全仓：现有错误码是**分散硬编码的字符串**，没有统一字典。

| 文件 | 现有码 |
|---|---|
| `js/background.js` | `IMG_E_FETCH`、`IMG_E_NO_URL` |
| `js/image-hover.js` | `IMG_E_BUSY`、`IMG_E_NO_TARGET`、`IMG_E_NO_URL` |

新增 `IMG_E_BLOCKED` 需要在 **3 处**同步：
1. SW 返回处（`vrImgDownload` 兜底路径）
2. 内容脚本 `flashFail(code)` 的文案映射
3. `image-batch.js` 的失败归类

方案 §9.3 C 只说了「→ `code: IMG_E_BLOCKED`」，没说这 3 处都要改。
漏一处就会出现「显示原始错误码」而不是「站点限制」。

---

## 三、🟡 两处事实表述不准

### 表述 1：DNR 那段会变成「半死代码」，方案说「保留不动」

方案 §9.8 写「不再投入 DNR 补 Referer（实测无效，已保留代码不动）」。

**实际情况**：DNR 代码在 `vrImgDownload()` 里（`background.js:662`）。
方案 B 把**主路径**改成 blob 后，这段只在「直连兜底」时才跑。
它不是完全的死代码，但**主路径永远不经过它**。

**建议**：在方案里改成「DNR 保留在兜底路径上，主路径不依赖它」，
而不是笼统的「保留不动」——否则后面的人会以为主路径还有 Referer 保护。

### 表述 2：§9.6 验收标准「批量 5 张 → 去重表 5 条真实 URL」缺前提

去重表写入是**串行链 + 内存缓存**（我昨晚刚修的并发覆盖 bug）。
验收时要断言「5 条」必须**等写入链跑完**，否则会读到 2~3 条就判失败。

**建议**：验收标准补一句「轮询等待去重表达到 5 条（最多 8 秒）」，
和 I3 测试里的做法一致。

---

## 四、✅ 方案里判断正确、可以直接执行的部分

| 判断 | 核实结果 |
|---|---|
| 不用 canvas 作主路径 | ✅ 诊断显示 33.6KB → 45.3KB，确实重编码丢字节 |
| 不引 Playwright | ✅ 项目已有 CDP 基建，换轮子成本高 |
| `vrQueueFilename` 加 `libUrl` 第 5 参 | ✅ 现有签名是 4 参（`background.js:367`），扩展可行，且入库必须用真实 URL |
| 批量改本地并发池 | ✅ 并发参数本来就靠消息传（`background.js:717` / `image-batch.js:389`），挪到本地反而少一跳 |
| 先文档后代码 | ✅ 符合项目规则 |

---

## 五、修正后的实施顺序（建议替换 §9.5）

```bash
# 1. 先提交本文档 + 审计（docs only）
git add docs/ && git commit -m "docs(image): 微博缺陷方案 + 方案审计"

# 2. 提交 I5 存量（避免混在一起）
git checkout -- deliverables/assets/
git add -A && git commit -m "feat(image): I5 设置项与快捷键" && git push

# 3. 改 A（悬停命中）—— 最小改动，先单独验证
#    overlay.html 夹具 → 跑 cdp-image-save-test.py 的用例 1

# 4. 改 B1/B2/B3（prepare / registerBlob / libUrl）
#    ⚠️ registerBlob 必须 await 回执再点 <a>（缺陷 1）
#    hotlink 夹具 → 跑用例 2/3

# 5. 改 B4/B5（saver + 批量本地池）
#    ⚠️ 保留 .vr-cf / .vr-pg / .done 三个 UI 契约（缺陷 2）
#    跑完整 I3 套件确认 45 条不动也过

# 6. 改 C（错误归类）
#    ⚠️ IMG_E_BLOCKED 要同步 3 处（缺陷 3）

# 7. 跑 T1 + T2，提交
git commit -m "fix(image): 覆盖层悬停命中 + 防盗链走页面取字节"
```

---

## 六、给方案的一句话总结

**方向对、证据真、能落地**，但要补三条约束：
1. `registerBlob` **必须等回执**再点 `<a>`（否则丢文件名）
2. 批量改本地池**必须保留** `.vr-cf`/`.vr-pg`/`.done` 三个 UI 契约（否则 I3 的 45 条断言全废）
3. `IMG_E_BLOCKED` 要**同步 3 处**（否则显示原始错误码）

另外两处表述建议改准：DNR 是「兜底路径保留」而非「保留不动」；
去重表验收要「轮询等写入链跑完」。
