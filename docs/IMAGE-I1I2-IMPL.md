# 图片悬停下载 · I1 + I2 实现规格

> 版本：v1.0 ｜ 日期：2026-10-24 ｜ 状态：**实施中** ｜ 分支 `feat/image-i1i2`
> 上游方案：[IMAGE-DOWNLOAD-PLAN.md](IMAGE-DOWNLOAD-PLAN.md) v1.2（交互与候选链的权威口径）
> 调研依据：[IMAGE-DOWNLOAD-RESEARCH.md](IMAGE-DOWNLOAD-RESEARCH.md)
> 交互基准：`deliverables/prototypes/image-hover-prototype-v1.html`（v1.2）
> 本文范围：**只做 I1 + I2**（单张悬停下载）。批量、浮标、清单面板、图集（I3–I6）不在本次实现内，但接口预留。

---

## 0. 边界（先说清不做什么）

| 项 | 本次 | 说明 |
|---|---|---|
| 悬停单张下载 | ✅ | 悬停 300ms 出现「下载原图」，点击落盘 |
| 原图五级候选 + SW 校验/回退 | ✅ | 与 PLAN §2.3 一致 |
| 设置开关 `imgHover` | ✅ | 读 `vrLibSettings.imgHover`，缺省 `true`；**不加设置页 UI**（options.html 属于本次禁改文件） |
| 批量、浮标、清单面板、图集 | ❌ | I3–I6；消息协议与工具函数已预留，不实现入口 |
| 已下载去重（`vrDownloaded`） | ❌ | 批量阶段统一做；单张重复点击会按 `uniquify` 生成 `(1)` 文件 |
| iframe 内图片 | ❌ | `all_frames: false`（用户明确要求）；主文档覆盖足够 |
| 快捷键 | ❌ | I5 |

---

## 1. 文件清单（本次真正改动的）

| # | 文件 | 类型 | 职责 |
|---|---|---|---|
| 1 | `docs/IMAGE-I1I2-IMPL.md` | 新增 | 本文，先于代码 |
| 2 | `js/lib-image-util.js` | 新增 | 纯函数：候选解析、扫描过滤、扩展名/占位判断。挂 `self.VRImageUtil`，Node 可 `require` |
| 3 | `js/image-hover.js` | 新增 content script | 悬停判定、Shadow DOM 按钮、点击下载 |
| 4 | `js/background.js` | 修改 | `vrImg.resolve` / `vrImg.download` 两个消息分支 + `importScripts` 引入工具 |
| 5 | `manifest.json` | 修改 | 注册 `lib-image-util.js` + `image-hover.js`（http/https、`document_idle`、`all_frames:false`） |
| 6 | `tools/test-image-util.js` | 新增 | Node 单测（≥30 条） |
| 7 | `tools/cdp-image-test.py` | 新增 | 端到端：悬停 → 按钮 → 点击 → 落盘 → 候选优先 |
| 8 | `deliverables/assets/image-hover-button.png` / `image-hover-done.png` | 新增 | 验收截图 |

**不改**：`library.html`、`css/library.css`、`js/library/ui.js`、`trash*.js`、`lightbox.js`、`video.js`、`keyboard.js`、`options.html`、五份共享文档。

---

## 2. I1：`js/lib-image-util.js`

### 2.1 形态

- 零依赖、ES5 + 少量 ES6（`URL`）语法，IIFE + UMD 尾巴：
  - 浏览器/内容脚本/Service Worker：`self.VRImageUtil`
  - Node：`require('../js/lib-image-util.js')` 返回同一对象
- **纯函数**：不碰 `chrome.*`、不写 DOM、不抛异常（所有输入异常都降级为空值）。

### 2.2 导出签名

```js
VRImageUtil = {
  MIN_SIZE: 100,

  // URL 规范化
  absolutize(url, baseUrl) -> string,        // 相对 → 绝对；javascript:/about: 等返回 ''
  isDataUri(url) -> boolean,
  isSvgUrl(url) -> boolean,
  isPlaceholderUrl(url) -> boolean,          // placeholder/loading/blank/spacer/1x1…
  isProbablyImage(url) -> boolean,           // 图片扩展名或“无扩展名”，明显非图返回 false

  // 候选与扫描
  pickLargestSrcset(srcset, baseUrl) -> string,
  collectCandidates(img, doc) -> string[],   // 五级优先级、去重、绝对化
  scanImages(doc, opts) -> ImgItem[],        // 过滤 + 去重
  sizeOf(img) -> {w, h},

  // 命名辅助（SW 与单测共用）
  extFromUrl(url) -> string,                 // 'jpg' | ''（不含点）
  extFromContentType(ct) -> string
}
```

`ImgItem = { el, url, w, h, ok: true, candidates }`。
`scanImages` 的 `opts`：`{ minWidth = 100, minHeight = 100, dedupe = true, limit = 0 }`（`limit=0` 不限）。

### 2.3 `collectCandidates` 五级优先级

按 PLAN §2.3，**顺序固定**；每级取到值后仍继续收集（去重），最终数组顺序即尝试顺序：

| 级 | 来源 | 细节 |
|---|---|---|
| ① | `img.closest('a[href]')` 的 `href` | 图被链接包裹（图库/论坛「点开看大图」）。`javascript:`/`about:` 丢弃 |
| ② | `srcset` 中 `w` 描述符最大项 | 无 `w` 时按 `x` 描述符最大；都没有时取最后一项；相对地址按 `document.baseURI` 绝对化 |
| ③ | `data-src` / `data-original-src` / `data-iurl` / `data-lazy-src` / `data-actualsrc` | 按此固定顺序逐个取，跳过空值与占位图 |
| ④ | 祖先 `[data-ri]` 的 JSON 元数据 | 向上最多 6 层；`JSON.parse` 后按 `ou` → `origUrl` → `original` → `src` → `url` 取第一个字符串，再退化到正文里的首个图片绝对 URL |
| ⑤ | `img.currentSrc \|\| img.src` | 页面实际显示的，保底 |

去重规则：同一个绝对 URL 只保留**最先出现**的那一次（即优先级更高者）。
`collectCandidates` 对 `img` 为 `null`、`doc` 缺失、属性异常一律返回 `[]`。

> ①不做「必须像图片」的过滤：图库的详情页 `/photo/123` 没有扩展名，靠 SW 的 `content-type` 校验兜底；校验失败的候选不会影响最终下载。

### 2.4 `scanImages` 过滤规则

| 规则 | 判定 |
|---|---|
| 尺寸 | `naturalWidth/naturalHeight` 优先；未加载（0）时退回 `width/height` 属性；短边 < 100 跳过 |
| 占位图 | `isPlaceholderUrl` 命中、或 URL 为空、或 `naturalWidth === 0 && naturalHeight === 0 && 无属性尺寸` |
| data URI | `isDataUri` 跳过 |
| SVG | `isSvgUrl` 跳过（多为图标） |
| 同 URL 去重 | 默认开，保留首次出现（页面顺序） |
| 非 `<img>` | `doc.querySelectorAll('img')` 天然排除 CSS 背景图 |
| Shadow DOM 内图片 | 本函数**不遍历** shadow root（PLAN §2.4 口径：悬停走事件 `composedPath()`，扫描面板阶段再补） |

### 2.5 可测性设计

`collectCandidates/scanImages` 只依赖元素的最小接口（`getAttribute`、`closest`、`srcset`、`src`、`currentSrc`、`naturalWidth/Height`、`parentElement`、`tagName`），
因此单测用**手写 fake 元素**即可，不引入 jsdom。

---

## 3. I2：悬停按钮（`js/image-hover.js`）

### 3.1 交互

| 规则 | 值 |
|---|---|
| 出现延迟 | 300ms（鼠标划过不出现） |
| 隐藏延迟 | 300ms（留时间把鼠标移到按钮） |
| 立即隐藏 | `scroll`（capture）/ `resize` / `mouseleave` 到按钮与图片之外 |
| 位置 | 图片**右上角**内缩 8px（本次按任务书；PLAN §1.1 写的是右下角，此处以任务书为准） |
| 文案 | 图标 + 「下载原图」 |
| 尺寸 | 高 30px，宽度自适应（约 96px） |
| 不显示 | 短边 < 100、占位图、data URI、SVG |
| **不显示（悬停专属门槛）** | **显示尺寸宽或高 < 600px**（2026-10-25 用户要求「尺寸太小的不要出现下载按钮」）。判**显示尺寸**而非原始像素：缩略图列表里的小图一律不打扰，哪怕原图很大 |

> **两个门槛的分工**（容易混，写清楚）：
>
> | 场景 | 门槛 | 来源 | 判什么 |
> |---|---|---|---|
> | 页面悬停按钮 | 设置项 `imgHoverMinSize`（默认 **600**） | `chrome.storage` | 显示尺寸 |
> | 清单面板扫描 | 设置项 `imgMinSize`（默认 100） | `chrome.storage` | 原始像素 + 显示尺寸（固定 48 挡图标） |
>
> 为什么不一样：悬停是**被动打扰**，宁严勿松；面板是**用户主动去看全部图**，漏图比打扰更糟。
>
> **两个门槛都可配**（2026-10-25 晚）。悬停门槛进设置页与面板设置区，
> 改完由 `chrome.storage.onChanged` 即时生效，不用刷新页面。

### 3.2 结构（Shadow DOM 隔离）

```
<html>
  └─ <div id="vr-img-hover-host">        ← 唯一注入节点，position:fixed; z-index:2147483000
       └─ #shadow-root (mode: open)
            └─ .vr-wrap (position:fixed; all:initial; pointer-events:none)
                 └─ <button class="vr-btn">  ← pointer-events:auto
```

- 站点 CSS 无法穿透 Shadow DOM；按钮内部 `all: initial` 重置继承。
- 按钮点击 `preventDefault + stopPropagation`，**不改变原图点击行为**（图片被 `<a>` 包裹时不会跳转）。
- 全局标记 `window.__vrImgHoverLoaded` 防重复注入。

### 3.3 状态机

`HIDDEN` →(悬停 300ms) `SHOWN` →(点击) `BUSY` →(resolve+download 返回) `DONE` / `FAILED` →(1.2s) `HIDDEN`

- `BUSY`：按钮禁用 + CSS 旋转圈；
- `DONE`：`✓`，1.2s 后隐藏并复位；
- `FAILED`：`!`，`title` 提示错误码，1.8s 后复位。

### 3.4 设置开关

```js
chrome.storage.local.get('vrLibSettings') → imgHover !== false
```

- 缺省（键不存在 / 值非 false）为**开**；
- `chrome.storage.onChanged` 监听 `vrLibSettings`，关闭时**移除 host 节点**并解绑悬停计时器（验收第 10 条：关闭后 DOM 无 `vr-img` 节点）。

### 3.5 点击链路

```
点击
 → collectCandidates(img, document)
 → sendMessage {Message:'vrImg.resolve', action:'vrImg.resolve', candidates, currentSrc, pageUrl}
 ← {ok, url, tried, fallback, contentType}
 → sendMessage {Message:'vrImg.download', action:'vrImg.download', url, candidates, pageUrl, title}
 ← {ok, downloadId, path} | {ok:false, code}
```

- `pageUrl = location.href`，`title = document.title`（去首尾空白，截断 80 字）。
- 消息同时带 `Message` 与 `action`：`Message` 给现有 SW 分发器，`action` 满足任务书协议，二者值相同。
- `/resolve` 超时或 `lastError` 时**不阻断**：直接用 `currentSrc` 调 `/download`。
- 下载一定尝试：`resolve` 全失败也会回退到最后一个候选（`fallback: true`）。

---

## 4. I2：Service Worker（`js/background.js`）

### 4.1 消息协议

| action | 入参 | 出参 | 说明 |
|---|---|---|---|
| `vrImg.resolve` | `{candidates: string[], currentSrc?, pageUrl}` | `{ok, url, tried, fallback, contentType}` | 逐个 fetch；`content-type: image/*` 才算命中 |
| `vrImg.download` | `{url, candidates?, pageUrl, title, platform?}` | `{ok, downloadId?, path?, code?, message?}` | 落位 + 下载 |

两个分支都放在 `G.initLocalComplete` 检查**之前**（与 `vrQueueName` 同级）：SW 刚被消息唤醒时不能因为初始化标志未就绪而失败。

### 4.2 `vrImg.resolve` 算法

```js
list = dedupe([...candidates, currentSrc])           // 保持顺序，绝对化
for (url of list) {
  tried++
  r = await fetch(url, {
        headers: { Referer: pageUrl },               // 尽量满足防盗链
        credentials: 'include',                      // 带登录态
        referrer: pageUrl,
        cache: 'no-store'
      })
  ct = r.headers.get('content-type') || ''
  if (r.ok && /^image\//i.test(ct)) return {ok:true, url, tried, fallback:false, contentType:ct}
  r.body?.cancel?.()                                  // 不把整张图读进内存
}
return {ok:false, url:last, tried, fallback:true, contentType:''}
```

- `Referer` 属于浏览器受控头，Chrome 可能忽略；忽略时不报错，仍靠 `referrer` 选项与 cookie。**失败不阻断**。
- 仅接受 `image/*`；`text/html`（防盗链/登录页）视为未命中 → 换下一候选。
- 全部失败时不抛错，返回最后一个候选 + `fallback:true`，保证「点了必有动作」。

### 4.3 `vrImg.download` 算法

1. **URL 校验**：空 / 非 `http(s)|data|blob` → `{ok:false, code:'IMG_E_NO_URL'}`。
2. **扩展名**：`extFromContentType` → `extFromUrl` → `jpg`。
3. **标题**：`title` → `VRPath.cleanSeg` 清洗；空则 `图片`；截断 60 字。
4. **文件名**：`<YYYYMMDD>_<标题>.<ext>`（本地时区日期，与 naming.js 的 UTC 日期不同，图片线以本机直觉为准）。
5. **目录**：`VRPath.buildRelPath({ pageUrl, type:'image', ext, fileName, subdir })`
   - `subdir` 取 `vrLibSettings.subdir`，缺省 `video-rod`；
   - 平台由 `pageUrl` 识别；识别不出 → `其他网页/<host>`（`path.js` 既有规则）；
   - 结果形如 `video-rod/其他网页/127.0.0.1/图片/20261024_测试站C图片批量保存.png`。
6. **防盗链 Referer：必须走 DNR，不能走 `headers`**（实测结论，见下）。
7. **下载**：`vrDownloadWithName(url, relPath, { meta })`
   - `meta` 含 `relPath/platform/creatorFull/creatorId/type/pageUrl/title`，供自动入库预登记；
   - 不绕开 `vrDownloadWithName`（ADR-027 文件名保护）。
8. **返回**：`{ok:true, downloadId, path}`；`downloadId === null` 映射 `IMG_E_NO_PERM`（`net::ERR_ACCESS_DENIED` / `FILE_ACCESS_DENIED`）或 `IMG_E_FETCH`。

#### 4.3.1 为什么 Referer 不能放进 `downloads.download` 的 `headers`

`chrome.downloads.download({ headers: [{name:'Referer', value: pageUrl}] })`
**直接报错**，下载根本发不出去：

```
Unsafe request header name        ← chrome.runtime.lastError.message
```

`Referer` 属浏览器受控请求头，`downloads` API 只允许自定义头，不允许改受控头。
因此改用 **DNR 会话规则**补头（与 `js/function.js` 的 `setRequestHeaders` 同思路）：

```js
chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [id],
  addRules: [{
    id, priority: 1,
    action: { type: 'modifyHeaders',
              requestHeaders: [{ header: 'Referer', operation: 'set', value: pageUrl }] },
    condition: { urlFilter: '<去掉协议的完整图片 URL>',
                 resourceTypes: ['image','xmlhttprequest','media','other'] }
  }]
});
```

- 规则 id 从 **9000** 起（避开 `function.js` 拿 tabId 当 id 的既有规则）；
- `urlFilter` 用完整 URL 做子串匹配，比 `||域名` 更精确；
- **一次性使用**：`downloads.download` 返回后（成功或失败）立刻 `removeRuleIds` 撤销，避免规则堆积；
- DNR 不可用（旧版本/Firefox）时降级为不补头，下载照常发起（多数站点无防盗链）。

> 测试证据：修复前 `vrImg.download` 恒返回 `IMG_E_FETCH` 且 `chrome.downloads` 里没有任何记录；
> 加 DNR 后同一调用 0.26s 完成，落盘字节数与源图一致。


### 4.4 错误码（对齐 PLAN §2.9，补 3 个本阶段必需的）

| 码 | 场景 | 用户文案 |
|---|---|---|
| `IMG_E_NO_URL` | 候选为空 / URL 非法 | 没找到可下载的图片 |
| `IMG_E_FETCH` | 下载发起失败（网络/404/取消） | 下载失败，站点可能限制了直链 |
| `IMG_E_TYPE` | `content-type` 明确不是图片（resolve 阶段不致命，仅记录） | 这不是图片 |
| `IMG_E_NO_PERM` | 扩展无该站点/下载权限 | 当前页面不允许扩展操作 |
| `IMG_E_BLOCKED` | 403 且回退也失败（I3 批量用） | 站点限制下载，已跳过 |
| `IMG_E_TOO_SMALL` | 小于阈值（悬停阶段直接不显示，不下发消息） | 图片太小，已过滤 |
| `IMG_E_DUPLICATE` | 已下载过（I3 用） | 这张已经存过了 |
| `IMG_E_LIMIT` | 超过单批上限（I3 用） | 最多一次下载 200 张 |

---

## 5. manifest 变更

```json
{
  "matches": ["https://*/*", "http://*/*"],
  "js": ["js/lib-image-util.js", "js/image-hover.js"],
  "run_at": "document_idle",
  "all_frames": false
}
```

- 顺序保证工具先于入口；
- 不新增权限（fatch 用现有 `host_permissions`）；
- **改动 SW / 内容脚本后必须换新 profile + 新端口**（HANDOFF §6.1）。

---

## 6. 验收（本次只对 I1 + I2）

| # | 项 | 判定 | 方式 |
|---|---|---|---|
| A1 | 单测 | `node tools/test-image-util.js` ≥30 条全过 | Node |
| A2 | 悬停出现 | 停留 300ms 后 Shadow DOM 出现按钮，文案含「下载原图」 | CDP |
| A3 | 划过不出现 | 快速移过（<300ms）无按钮 | CDP |
| A4 | 移开消失 | 移出 300ms 后按钮不可见 | CDP |
| A5 | 落盘 | 点击后 3 秒内 `complete`，文件存在且大小 > 0 | CDP |
| A6 | 路径 | 含 `video-rod/.../图片/`，文件名 `<8位日期>_<标题>.<ext>` | CDP |
| A7 | 候选优先 | `a[href]` 场景取到链接原图（文件字节 = 原图）；`srcset` 场景取最大 `w` | CDP |
| A8 | 过滤 | 16×16、data URI、SVG 悬停无按钮；占位图无按钮 | CDP |
| A9 | 样式隔离 | 按钮位于 Shadow DOM，宿主样式不影响；不改变原图点击 | CDP |
| A10 | 开关 | `imgHover:false` 后无 `#vr-img-hover-host` 节点 | CDP |
| A11 | 控制台 | 页面/扩展 0 error、0 exception | CDP |
| A12 | 回归 | `cdp-s1a-test.py` 17/17、`cdp-index-test.py` 14/14 | CDP |

### 6.1 实测结果（2026-10-24）

| 套件 | 结果 |
|---|---|
| `node tools/test-image-util.js` | **58 / 58** |
| `tools/cdp-image-test.py` | **34 / 34** |
| `tools/cdp-s1a-test.py` | **17 / 17** |
| `tools/cdp-index-test.py` | **14 / 14** |

两个测试脚本的修正记录（属脚手架问题，非产品缺陷）：

1. `rect()` 在 `scrollIntoView` 后立刻取 `getBoundingClientRect()`，拿到的还是旧坐标，
   鼠标落到图外 → 加 180ms 等布局稳定再取。
2. `click_and_size()` 复用了上一张图残留的 `done` 态按钮坐标（1.2s 才隐藏），
   下到的还是上一张图 → 改为每次强制重新悬停。
3. `I1` 断言读 `window.__vrImgHoverLoaded`：内容脚本在 isolated world，主世界读不到，
   恒为 `false` → 改为只看「无宿主节点 + 悬停不出按钮」两个可跨 world 观测的事实。

---

## 7. 测试夹具（不进 git）

- HTTP 服务：`test-site`（`test-site/media/` 已 gitignore）。
- 需要的图：`cover.jpg(640×480)`、`sprite.png(300×300)`、`tiny.png(16×16)`、`thumb-320.png`、`original-1200.png`、`placeholder.png(600×300)`、`icon.svg`。
- `a[href]` / `srcset` 夹具由 CDP 在 `images.html` 里**动态插入**，避免改动既有夹具影响 `cdp-m3-m5`（该页断言「抓图 2 张」）。
- 测试下载落 `D:\Users\liq21\Downloads\video-rod\其他网页\127.0.0.1\图片\`，脚本结束删除文件 + 擦除下载记录。

---

## 8. 已知风险

| 风险 | 影响 | 处理 |
|---|---|---|
| Chrome 忽略 `Referer` fetch 头 | 防盗链站点 resolve 失败 | 回退 `currentSrc` 仍能下；下载侧已改用 DNR 补头（§4.3.1），实际有效 |
| DNR 规则清理时序 | 规则残留堆积 | `finally` 里同步撤销；规则 id 每次递增，不会互相覆盖 |
| `fetch` 校验会真的拉一遍图 | 大图多耗流量 | `r.body.cancel()`；I5 可换 Range/HEAD |
| Shadow DOM `mode:'open'` | 站点理论上可探测 | 自用优先可测性；后续可切 closed + 内部调试口 |
| 深色站点按钮对比度 | 可读性 | 半透明深底 + 白字 + 描边，后续按站点适配 |
| 图片在 iframe | 抓不到 | 明确不做（`all_frames:false`） |
