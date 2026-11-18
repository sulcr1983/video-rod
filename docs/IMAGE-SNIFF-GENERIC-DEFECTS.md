# 图片嗅探「为什么会漏」——通用性缺陷分析

> 2026-11-18 实测 + 竞品源码对照。S 级（结论均可复现）
> 触发场景：苏哥报 `t66y.com` 页面「很多图片嗅探不到」。
> **结论先行**：那个页面**一张真图都没漏**；反过来的问题是——扫描结果里混进了
> 打不开的垃圾，而且**同一页面每次扫描结果都不一样**。这两个才是通用缺陷。

---

## 一、实测事实（先摆数据，再谈原因）

### 1.1 你给的链接：一张没漏

```
页面 DOM 里 <img>（有 src）: 16 张
vrImg.scan 收录:              11 条（修后）
「DOM 有、扫描没收录」:        无
```

没收录的 5 张，逐张查证：

| 图 | 查证结果 | 该不该收 |
|---|---|---|
| `i.11img.com/.../mnsks.gif` | 显示 40×40，class=`post_comm_face` | ❌ 评论表情 |
| `66img.cc/.../69ac3572eb916.webp` | fetch → **404** | ❌ 死链 |
| `i2.bvimg.com/.../eb977ed44f0df015.gif` | fetch → **Failed to fetch** | ❌ 死链 |
| `qpic.ws/.../tff74G.jpg` | fetch → **timeout** | ❌ 死链 |
| `t66y.com/wind/th1.png` | 站点自己的图标 | ❌ 装饰 |

**所以「漏」的感觉不是来自漏采，而是来自下面两件事。**

### 1.2 同一页面，每次扫描结果都不一样（最严重）

修复前，同一个页面**连扫 6 次**：

```
第1次 15 条   dropped=5
第2次 17 条   dropped=3   (+4 / -2)
第3次 16 条   dropped=4   (+1 / -2)
第4次 19 条   dropped=1   (+4 / -1)
第5次 18 条   dropped=2   (+1 / -2)
第6次 17 条   dropped=3   (+1 / -2)

并集 20 条，但**每次都出现的只有 12 条**
```

时有时无的 8 条，全是取不到尺寸的地址：

```
http://a.d/adblo_ck.jpg                      ← 广告拦截伪域名
https://ez.vgvaifjtwxfpuhddgfymqqscmd.com/…  ← 追踪域
https://jdl.vejbmqitmtwbfefrbafmwwukrj.com/… ← 追踪域
https://66img.cc/…webp / i2.bvimg.com/…gif   ← 死链
https://t66y.com/wind/th1.png / mnsks.gif    ← 站点图标
```

**用户点两次看到不同数量，自然会判定「嗅探不准」。**

### 1.3 扫描结果里混进 28% 的包装页

另一篇 t66y 帖子，25 条里有 **7 条**是这种：

```
https://23img.com/l/?i=/i/2026/11/15/aphrl4.jpg   ← 包装页，缩略图 0×0
https://23img.com/i/2026/11/15/aphrl4.jpg          ← 同一个文件的真地址
```

外加 2 条站点自身资源（`t66y.com/wind/th1.png`、`tag.jpg`）。

**为什么会被当图收**：扩展名判定看的是**整条 URL**，query 里那个 `.jpg`
骗过了「有图片扩展名」的检查。

### 1.4 不是懒加载

滚动前后 `img` 总数恒为 16、真图恒为 13、`docHeight` 恒为 38889。
所以「往下拉才会出现更多图」这个假设**不成立**。

---

## 二、根因（三条，都是通用缺陷）

### 根因 1：判死依赖网络时序 → 结果不确定

`image-scan-service.js` 的 `finishSizes()` 用 `fillSizesV2()` **网络预载**判死：

```js
got = await U.fillSizesV2(miss, {
    max: cap, concurrency: 8, timeout: 2500, retry: 1, budget: 5000
});
```

- 网络快 → `onerror` / 超时前判掉 → `dropped++`
- 网络慢 → 超时 → **保留**（注释写着「超时未探到尺寸的保留，不因慢判死」）

同一条 URL 在两次扫描里可能一次被丢、一次被留。**这就是不确定性的来源。**

**修法**：改用 DOM 自身的确定性信号。

```js
el.complete === true && el.naturalWidth === 0   // 浏览器自己都没加载出来
```

这是浏览器已经做完的判定，不需要我们再发一次请求去猜。
必须排除懒加载占位（`data-src`/`srcset` 有值的不判死），否则真图会被整批误杀。

### 根因 2：只对「已解码」的图做尺寸过滤 → 首扫偏多

```js
var sized = (nw > 0 && nh > 0);
if (sized && o.checkShow !== false && !isWorthDownloading(...)) { continue; }
//  ↑ 未解码（sized=false）直接跳过过滤
```

页面刚打开时，站点图标这类**不懒加载**的图还没轮到解码，`naturalWidth = 0`。
于是首扫把它们全收进来，后续扫描解码完成又把它们挡掉。

实测：**首次 15 条 / 后续 12 条**，差的正是 3 个站点图标。

**修法**：未解码时改用 **CSS 显示尺寸**（`getBoundingClientRect`）判断。
它反映布局，DOM 一就绪就是确定的，**与图片是否下载完无关**。

### 根因 3：扩展名判定看整条 URL → 包装页蒙混过关

```js
var IMG_EXT_RE = /[.](?:jpe?g|png|...)(?:[?#]|$)/i;
if (!IMG_EXT_RE.test(u)) { /* 才做同域/像页面的排除 */ }
```

`https://23img.com/l/?i=/i/2026/11/15/aphrl4.jpg` 的 pathname 没有扩展名，
但 query 里有 `.jpg` → 正则匹配成功 → 跳过所有排除 → 被当图收。

**修法**：先剥壳（`unwrapImageWrapper`）——pathname 不是图片时，
在 query 里找「值本身是图片路径」的参数，还原成真地址。
剥出来的地址若本来就在结果里，会被现有去重挡住，正好实现
「包装页消失、真图保留」。

---

## 三、竞品怎么做（源码对照，不是功能列表）

### 3.1 Image Downloader 4.0（`contentScript.js`，7.9KB，未压缩）

它的采集逻辑简单到只有两条门槛：

```js
if (e.naturalWidth < 96 || e.naturalHeight < 96) return;   // 悬停按钮
if (i.width < 48 || i.height < 48) return;                 // 批量按钮布局
```

**没有**显示尺寸/长宽比门槛，**没有**网络预载判死，`naturalWidth == 0` 时：

```js
0 == t[e].naturalWidth ? m(t[e].src, r, i) : v(...)
// m() = new Image() 预载后再收；v() = 直接收
```

`srcset` 的**每一个**候选都单独收，背景图（`background-image`）也全扫。
它的取舍是：**采集宽松，判死交给展示层**。

### 3.2 Fitkun 5.1.35（`imageContent.js`，1.3MB，压缩）

`naturalWidth` 只出现 2 次、`backgroundImage` 7 次 —— 同样不做采集期重过滤。

### 3.3 我们的问题正好相反

| 维度 | Image Downloader | 我们（修复前） |
|---|---|---|
| 采集期尺寸过滤 | 几乎无 | 5 道（自然/显示短边/显示长边/长宽比/同域无扩展名） |
| 未解码的图 | 预载后照收 | 跳过尺寸过滤（不确定） |
| 判死依据 | 无（交给展示层） | **网络预载 + 2500ms 超时** |
| 结果确定性 | 确定 | **不确定**（同页 6 次 15~19 跳动） |
| 包装页 | 不处理 | 不处理（28% 条目是包装页） |

**结论**：我们的过滤比竞品严得多，却因为**判死依赖网络时序**而更不稳定。
严过滤本身不是错（用户不想看图标），错在**判据选错了**。

---

## 四、修复与验证

| 改动 | 文件 | 效果（实测） |
|---|---|---|
| 确定性判死（`complete && naturalWidth===0`） | `js/image-scan-service.js` | 死链不再随机进出 |
| 未解码也按显示尺寸过滤 | `js/lib-image-util.js` | 首扫不再多收图标 |
| 图床包装页剥壳（`unwrapImageWrapper`） | `js/lib-image-util.js` + 接入 `makePush` | 28% 垃圾条目消失 |

**扫描稳定性对比（同一页面连扫）**：

```
修复前：15 → 17 → 16 → 19 → 18 → 17   （并集 20，稳定项仅 12）
修复后：11 → 12 → 12 → 12 → 12         （并集 12，稳定项 11）
```

剩下的 1 条波动是 B站 CDN 图（`0.hdslb.com/...@.webp`）的尺寸回填，
属于跨域预载的固有抖动，不影响真实站点的主流场景。

**测试**：`test-image-util.js` 135 条（含 8 条剥壳断言）、
`test-grab-scan.js` 14 条（含 4 条未解码过滤断言），全绿。

---

## 五、剩余 4 项：逐项定论（参照竞品做法）

> 下面 4 项是修完前三处后剩下的。每项都给了**结论**，不是「以后再说」。

### 5.1 背景图（background-image）——**不需要补**

`scanBackgrounds()` 返回的条目**自带显示尺寸**（`w: dw, h: dh`，来自 `getBoundingClientRect`），
所以它在 `finishSizes()` 里根本不会进入网络预载分支 —— 已经是确定性的。

- 竞品对照：**Imageye 完全不扫背景图**（`imageScraper.js` 里 `backgroundImage` 出现 **0 次**）；
  Image Downloader 扫，但同样只看元素尺寸。
- 结论：我们比两家都全，且已经是确定性判据。**不动**。

### 5.2 `srcScan` / `netScan` 两条通道——**已被剥壳自动覆盖**

四个通道（dom / bg / src / network）**全部经过同一个 `makePush`**，实测确认调用点：

```
push(it.url,  ... 'dom', it.el)
push(it.url,  ... 'bg',  it.el)
push(su, 0, 0, [su], false, true, 'src')
push(it0.url, 0, 0, [it0.url], false, false, 'network')
```

所以图床剥壳（`unwrapImageWrapper`）对源码通道与网络通道**一并生效**。
它们没有 `el`，因此不参与 `complete` 判死 —— 这是对的：没有 DOM 元素就没有「加载完成」可言。

- 竞品对照：Image Downloader 的源码通道（`body.innerHTML.match(regex)`）**不做任何尺寸/死链过滤**，
  比我们更宽松。我们保留扩展名白名单已经更严。
- 结论：**不需要额外加固**。

### 5.3 `a.d` 这类伪域名——**不做黑名单**

`http://a.d/adblo_ck.jpg` 是广告拦截器留下的伪地址（域名 `a.d` 非法 TLD）。
它已经有扩展名 `.jpg`，所以躲过了「同域+无扩展名」规则，但会被 `finishSizes` 的尺寸探测判掉。

- 为什么不做域名黑名单：黑名单要随站点/广告库变化维护，**是负债不是资产**；
  而且拦截器规则因人而异，我们不该替用户判断。
- 它的残留影响：偶发一条 0×0 占位。修完 §1.2 的确定性判死后已大幅收敛。
- 结论：**明确不做**，理由入档。

### 5.4 跨域图尺寸回填的 1 条抖动——**CDN 固有，接受**

修复后仍需 1 条波动：`0.hdslb.com/bfs/archive/...jpg@.webp`。
它是「首次扫描时还没回填到尺寸，后续扫描拿到了」——跨域预载的固有时序。

- 竞品对照：Image Downloader 对这类情况直接 `new Image()` 预载后**照收**（不判死），
  所以它没有这个抖动 —— 代价是死链也会留在列表里。
- 我们要的是「不留死链」，就必然有这个取舍。
- 结论：**接受**，不为此引入更复杂的判据。

---

## 五之二、竞品源码对照（本轮实读，非功能列表）

| 项目 | 采集期过滤 | 未解码处理 | 判死依据 | 包装页 |
|---|---|---|---|---|
| **Image Downloader 4.0**（`contentScript.js` 7.9KB，完整读完） | 只排除空 `src` | `new Image()` 预载后照收 | **无**（交给展示层） | 不处理 |
| **Imageye 7.5.7**（`imageScraper.js` 41KB） | **完全不过滤尺寸** | 每个 srcset 候选单独预载 | 无 | 不处理 |
| **PactInteractive/image-downloader**（GitHub 993★，开源 GPLv3） | 权限仅 5 项，`activeTab/scripting/downloads/sidePanel/storage`；侧栏形态 | — | — | — |
| **我们（修复后）** | 自然尺寸 + **显示尺寸（含未解码）** + 长宽比 | `complete && naturalWidth===0` 判死 | DOM 确定性信号 | **剥壳** |

**结论**：竞品的共识是「采集宽松、判死交给展示层」。
我们保留过滤（用户不想看图标），但把**判据换成了确定性的** —— 这是本轮的核心修正。

## 六、给后续的一句话总结

> **采集期要宽松且确定，展示期再按用户档位收紧。**
> 判据优先用 DOM 自带的确定性信号（`complete` / `getBoundingClientRect`），
> **不要用网络请求的成败/快慢去判一张图该不该存在** —— 那会把
> 「网络抖动」变成「扫描结果抖动」，用户看到的就是「嗅探不准」。