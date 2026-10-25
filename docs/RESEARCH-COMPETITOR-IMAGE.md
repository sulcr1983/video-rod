# 竞品逆向 · 批量图片下载扩展怎么做

> 日期：2026-10-25 ｜ 目的：回答「批量下载该放页面还是放扩展」
> 方法：读两个有完整源码的项目的 README + 提交记录 + 目录结构
> **结论先行：Sunny 姐姐的判断是对的，业界主流都不在页面上放常驻浮标。**

---

## 一、选了两个样本

| 项目 | 定位 | 为什么选它 |
|---|---|---|
| **Image Downloader Continued (IDC)** | `github.com/kisdma/image-downloader-cnt` | 是 Chrome 商店老牌 **Image Downloader**（百万级用户）的活跃 fork，图片发现能力做到极致，是最能代表「成熟做法」的样本 |
| **Image Harvest** | `github.com/zbw-zbw/image-harvest` | 2026 年新项目，MV3 + TypeScript + Preact，处理了 CSS 背景图 / Shadow DOM / iframe，是「现代做法」的样本 |

---

## 二、最重要的发现：**入口形态**

### 2.1 两家都不在页面上放常驻浮标

| 项目 | 入口 | 页面上有什么 |
|---|---|---|
| **IDC** | 点击工具栏图标 → **popup 网格** | 无浮标。只有注入的 CSS 防 adblock 隐藏自己的元素 |
| **Image Harvest** | 点击图标 / `Ctrl+Shift+S` → **Side Panel 为主，popup 为辅**（可切换） | 无浮标。只有「选中图片时的高亮遮罩框」（`content/highlight.ts`），**不是常驻下载按钮** |

> **这是本轮调研最直接的证据：两家都把批量操作放在扩展自己的界面里，页面上只做「辅助高亮」不做「常驻入口」。**

Image Harvest 还踩过一个有意思的坑（提交记录）：
从 side panel 切到 popup 时，**必须先对每个打开过的 tab 显式关闭 side panel，再注册 popup**，否则 panel 会残留。

### 2.2 对我们意味着什么

我们现在是「**右下角浮标常驻 + 点开面板**」，**两家都不这么做**。

这印证了 Sunny 姐姐的判断：
> 「批量下载很少用，保留在扩展程序里面好，需要的时候点扩展程序，再在页面探测」

**业界实践 + 用户直觉 + 成本匹配（低频操作不该占常驻 UI）三者一致。**

---

## 三、图片发现：我们缺的能力（值得抄）

两家在「怎么找到图」上投入最多，这部分我们明显落后。

### 3.1 IDC 覆盖的来源（README 明确列出）

| 来源 | 我们的现状 |
|---|---|
| `<img>` 的 `src` / **`srcset`（含 1x/2x 多分辨率）** / `lowsrc` | 部分有（`collectCandidates` 有五级候选） |
| `<picture>` 内 `<source>` 的 `srcset` | ❌ 没有 |
| `<video>` 的 `poster` | ❌ 没有 |
| `<svg>` 内含 `<image>`，否则整个 SVG 转 base64 | ❌ 没有 |
| `<a href>` 里的图片链接（正则限定后缀，避免发大量请求） | ❌ 没有 |
| **`background-image`（CSS 背景图）** | ❌ 没有 |
| **内联 `style` 里的 `url()`** | ❌ 没有 |
| **`<style>` 标签里的 `url()` 和 `data:image`** | ❌ 没有 |
| **跨域 CSS：fetch CSS 文本自行解析**（绕开 `cssRules` 跨域限制） | ❌ 没有 |
| **Shadow DOM（含反 `closed` 模式注入）** | ❌ 没有 |
| **MutationObserver 捕获动态/无限滚动图片** | 面板有重扫，但不是持续监听 |
| **canvas → dataURL**（对付 DevTools 都看不到的保护图） | ❌ 没有 |
| **站点特化：YouTube 高清缩略图、cloudfront 高清、去掉 URL 里 `resize` 参数拿原图** | ❌ 没有 |

> **「去掉 URL 的 `resize` 参数拿原图」这条特别值得抄** —— 很多 CDN 用 `?w=300` 这种参数降分辨率，
> 我们现在的五级候选是「换 URL 前缀」，没有「改查询参数」这一路。

### 3.2 Image Harvest 的现代做法

- `getComputedStyle` **运行时**取 `background-image`（不是静态解析 CSS 文本）—— 更稳
- `IntersectionObserver` + 滚动触发处理懒加载
- 同源 iframe 递归
- `parseSrcset` 抽成纯函数（**可单测**，和我们 `lib-image-util` 的思路一致）
- 深度扫描的 stalled 判定：只在「文档高度持续增长但无产出」或「scrollY 无法前进」才报卡住 —— 避免长页面误报

---

## 四、下载方式：两家都是 `chrome.downloads`，**都没解决防盗链**

### 4.1 关键对比

| 项目 | 单图下载 | 批量下载 | 防盗链/Referer |
|---|---|---|---|
| **IDC** | `chrome.downloads.download({url})` | 同左（逐张） | **完全没有**。对付受保护图靠 **canvas 转 dataURL** |
| **Image Harvest** | 推断 `chrome.downloads` | **JSZip 本地打包**（必须先 fetch 成 blob） | **文档完全没提** |

### 4.2 这对我们意味着什么（重要）

**我们遇到的问题，这两个成熟项目也没解决。**

- IDC 直接把 URL 交给 `chrome.downloads` → 请求由**浏览器下载器**发起，不带页面 Referer → 微博那种 CDN 同样会 403
- IDC 的应对是 **canvas 导出**（把已渲染的图重编码）→ 和我们的诊断结论一致：**能用但丢原始字节**（我们实测 33.6KB → 45.3KB）
- Image Harvest 的批量 ZIP 要 fetch blob，但如果它在**扩展上下文** fetch，一样会 403

> 所以我们的「页面上下文 fetch」方案，在这个具体问题上**比这两家更进一步**。
> 注意：内容脚本的 fetch 天然带页面 Origin/Referer/Cookie，这正是它能过的原因。

### 4.3 值得抄的一点：JSZip 批量打包

Image Harvest 用 JSZip 把批量结果打成一个 zip 下载。

**好处**：避免「批量下载触发浏览器多文件确认弹窗」这个我们方案里列为风险的问题。
**代价**：要在内存里攒全部字节，大图批量会吃内存。

> 可以作为后续可选项：批量 > 20 张时改打包 zip。

---

## 五、过滤规则：比我们细

| 维度 | IDC | 我们 |
|---|---|---|
| 尺寸 | min/max 宽 + 高 | 最小短边 + 长宽比（本轮刚加） |
| URL | **普通 / 通配符 / 正则** 三模式 | 只有关键字搜索 |
| 只显示被链接的图 | ✅ | ❌ |
| 排序 | 按宽 / 按宽+高，可反向 | 有档位 + 排序 |
| 过滤器状态持久化 | ✅ | 设置里有，但过滤器本身没存 |

**「URL 正则过滤」值得抄**：抓素材时经常要「只要 `sinaimg.cn` 的大图」，正则最直接。

---

## 五之二、本轮已抄的三条（2026-10-25 下午）

| 能力 | 实现 | 覆盖场景 |
|---|---|---|
| **`<picture>` 的 `<source srcset>`** | `pickLargestPictureSource()` | 响应式站点：`img` 只有 400w 兜底小图，大图写在兄弟 `source` 上 |
| **CSS `background-image`** | `parseBgImage()` + `scanBackgrounds()` | 封面做成 `div` 背景图的站点（img 标签里根本没有） |
| **去掉 resize 参数拿原图** | `stripResizeParams()` | `?w=300`、七牛 `imageView2/2/w/300`、阿里 `x-oss-process=image/resize,w_300` |
| **URL 正则过滤** | `filterByKeyword()` 增强 | 输入 `/sinaimg\.cn/` 即按正则匹配；写错自动退回子串 |

单测：`tools/test-image-util.js` **89/89**（新增 31 条）。
端到端：`tools/cdp-image-discover-test.py` **17/17** + `test-site/discover.html` 夹具。

### 实施中踩的两个坑

1. **派生必须在「显示地址」之后做**：我一开始把 `stripResizeParams` 放在候选链第 4 级，
   那时 `out` 还是空的（这张图没有 srcset、没有链接）→ 派生无对象，一条都产不出。
   正确顺序是「先把显示地址加进来，再对已有候选做派生」。
2. **调整顺序时误删了 `data-ri` 那一级**：单测立刻报出来（89→88），及时补回。
   **教训：改候选链这种有序列表，改完必须立刻跑单测。**

## 六、对我们的三条具体建议（按性价比排序）

### 建议 1（最高优先，也是 Sunny 的诉求）：**入口收进扩展，去掉常驻浮标**

- `imgPanel` 默认改 `false`（浮标默认不出现，设置里可开回）
- 接上 popup 里那个**已经存在但从未绑定**的「抓图」按钮
- 参考 Image Harvest：**Side Panel 比 popup 更适合图片网格**（宽度够，能常驻对照页面）

> 我们的 popup 已经是资源库入口，加一个图片网格页签比新开 side panel 改动小。
> 先做 popup，如果觉得挤再考虑 side panel。

### 建议 2（中等成本，收益明显）：**补 `srcset` / `background-image` / 查询参数原图**

这三条能覆盖大量现在漏掉的图：

```js
// ① srcset 取最大候选（IDC 和 Image Harvest 都做）
// ② getComputedStyle(el).backgroundImage 取 url()
// ③ URL 查询参数里的 resize/width/w → 去掉后重试
```

**只做这三条，不做 canvas、不做 Shadow DOM**（后者成本高、收益窄）。

### 建议 3（低成本）：**URL 正则过滤**

面板搜索框加一个「正则」开关，复用现有 `keyword` 过滤链路。

---

## 七、明确不抄的部分（避免过度设计）

| 不抄 | 理由 |
|---|---|
| canvas 导出主路径 | 重编码丢字节（实测 33.6→45.3KB），我们已有更好的页面 fetch 方案 |
| Shadow DOM 反 `closed` 注入 | 侵入性强，站点兼容风险高，收益窄 |
| 跨域 CSS fetch 解析 | 需要 `all_urls` 权限，我们有但不想为这个场景扩权 |
| 站点特化（YouTube/Maps/cloudfront） | 维护成本高，且我们已有 yt 专项 |
| 反广告拦截注入 | 与我们无关（我们不是广告类扩展） |

---

## 八、一句话结论

**Sunny 姐姐的产品判断被两个成熟项目验证了：批量下载都放在扩展界面（popup / side panel），页面上不放常驻入口。**

而且我们的 popup 里**早就有一个「抓图」按钮，功能是完整实现的**（`js/popup-videorod.js:1214 bindImageScan`
→ 扫描本页 → 打开图片弹窗 → 勾选 → 批量保存）。

> ⚠️ 我最初判断它是「死按钮」是**错的**：`grep vrScanImages` 只搜了 `popup.js`，
> 实际代码在 `popup-videorod.js`。**教训：确认「没有引用」之前，必须全仓搜（含 `--include` 之外的目录）。**

所以这轮不是「设计新入口」，而是：
1. 把页面浮标默认关掉（减少打扰）；
2. 让 popup 的「抓图」更好用 —— 它现在的小图过滤用的是 `naturalWidth < 120`，
   **和页面悬停犯的是同一个错误**（一张 640×480 的图标被 CSS 缩成 16px 显示仍会通过），
   应该复用本轮新增的 `VRImageUtil.isWorthDownloading`。

**技术层面我们还占一个优势**：防盗链（微博那种 403）这两家都没真正解决，我们的「页面上下文 fetch」比他们的「chrome.downloads 直连」更对症。
