# 依赖评估 · 浮层定位与图片发现（按「先搜索再写代码」铁律）

> 日期：2026-10-25 ｜ 触发：我手写了两块本可以用现成轮子的逻辑，需要按规则重新评估
> **结论：定位应该换 `@floating-ui/dom`（成熟、零依赖、社区标准）；图片发现自建是合理的（无匹配轮子）。**

---

## 一、我违反规则的地方（先认账）

| 我手写的 | 本该怎么做 | 判断 |
|---|---|---|
| 悬停浮层定位（`place()` 手算 left/top + 夹回视口 + `void offsetWidth` 防抖） | 搜浮层定位库 | ❌ **应该复用 Floating UI** |
| 图片发现（srcset / picture / background-image / resize 参数） | 搜图片提取库 | ✅ 搜了，无合适轮子，自建合理（见 §3） |

第一条是明确的重复造轮子。我为了修「按钮抖动」在 `show()` 里加 `opacity:0`、在 `place()` 里加 `void offsetWidth`，
这些**都是 Floating UI 的 `autoUpdate` + `shift` 已经解决好的问题**。

---

## 二、浮层定位：应该用 `@floating-ui/dom`

### 2.1 候选对比

| 方案 | 体积 | 依赖 | 维护 | 许可证 | 适配我们的场景 |
|---|---|---|---|---|---|
| **`@floating-ui/dom`** | ~7KB gzip（tree-shake 后更小） | **零依赖** | 极活跃（社区标准，Radix/Floating UI 生态基石） | MIT | ✅ 完美 |
| `@floating-ui/react` | 更大 | React | 活跃 | MIT | ❌ 我们无 React |
| `tippy.js` | 较大 | 依赖 floating-ui | 活跃 | MIT | ❌ 自带整套 UI/交互，我们只要定位 |
| `popper.js` v2 | 中等 | 零依赖 | **已进入维护模式**（官方推荐迁移到 Floating UI） | MIT | ❌ 上一代方案 |
| 手写（现状） | 0 | 0 | 自己维护 | — | ⚠️ 视口夹取/抖动/滚动跟随都要自己踩坑 |

**选 `@floating-ui/dom`**：零依赖、MIT、纯 DOM 版、体积小，正好是「只要定位不要 UI」的场景。

### 2.2 它能解决我踩过的哪些坑

| 我踩过的坑 | Floating UI 对应能力 |
|---|---|
| 按钮先出现再跳一下（文案变宽后位置没更新） | `autoUpdate`：元素尺寸变化自动重算 |
| 手动 `void wrap.offsetWidth` 强制回流 | 不需要——`computePosition` 自己会测量 |
| 手算「贴图片右上角内缩 8px」+ 夹回视口 | `offset(8)` + `flip()` + `shift({padding: 8})` |
| 滚动/缩放时浮层不跟随 | `autoUpdate` 监听 scroll/resize |
| 图片贴边时浮层出界 | `shift` middleware 自动夹取 |

### 2.3 引入方式（需要你批准）

**这是新增依赖，按规则必须先问。**

两种方案：

**A. 引入 npm 包（推荐）**
```
npm i @floating-ui/dom
```
然后把 `dist/floating-ui.dom.min.js` 放进 `js/lib/`，manifest 里在 `image-hover.js` 之前加载。
- 优点：官方构建，后续可升级
- 缺点：需要 npm 环境（项目当前无 `package.json`）

**B. 直接把官方 UMD 单文件放进仓库**
从 unpkg 取 `@floating-ui/dom` 的 UMD 构建（约 30KB 未压缩 / 7KB gzip），存为 `js/lib/floating-ui.dom.min.js`。
- 优点：不动构建体系，符合项目现状（纯静态扩展、无打包）
- 缺点：升级要手动替换

> **我倾向 B**：项目没有 `package.json`、没有打包步骤，所有 js 都是直接 `<script>` 加载。
> 引入一个 UMD 单文件是改动最小的做法，也不破坏现有结构。

**需要你决定：A 还是 B？或者暂不引入、继续手写？**

---

## 三、图片发现：自建是合理的

### 3.1 搜到的候选

| 包 | 是否可用 | 原因 |
|---|---|---|
| **`@howells/srcfull`** | ⚠️ 部分参考 | 功能最接近（`extractImageCandidatesFromHtml`、resize 参数还原、srcset/picture），但：**面向 Node/服务端**、周下载量 **1**、5 个月前发布、需要传 HTML 字符串而非 live DOM。**不适合浏览器扩展** |
| `fetch-page-assets` | ❌ | Node 专用（用 fs 落盘），服务端抓页面用 |
| `lazyish` / `ezlazy` | ❌ | 是**懒加载**库（加载图片），不是**提取**库，方向相反 |
| `webcloner-js` | ❌ | 整站克隆工具，依赖 Node + 网络爬取，不是扩展内提取 |
| IDC / Image Harvest 的源码 | ⚠️ 参考思路 | 都是**各自扩展内的私有代码**，没有发布成可复用包 |

### 3.2 结论

**没有能直接复用的浏览器端「从 live DOM 提取图片」的包。** 原因很清楚：

- 这类逻辑强依赖**运行在页面里**（要读 `getComputedStyle`、要遍历 Shadow DOM、要处理站点私有懒加载属性）
- 做这事的项目（IDC、Image Harvest）都把它当扩展的内部实现，不对外发包

所以自建是**符合规则的**（"找不到才自建"），而且我参考了 IDC / Image Harvest 的公开做法（README 里写了思路）。
**但我要在代码注释里写清「为什么没有复用」**——这是规则第 3 条的要求。

### 3.3 补一条：`@howells/srcfull` 值得单独看

它的 `resolveImageUrl` 做的「CDN 变换 URL → 还原成大图」比我的 `stripResizeParams` 更完整
（它会**探测**多种变体，不只剥参数）。如果以后要做得更彻底，可以读它的 pattern 实现思路。
但**不引入**：它是 Node 包，且周下载量 1，不适合作为依赖。

---

## 四、待你决定的事项

1. **浮层定位**：A（npm）/ B（UMD 单文件）/ 暂不引入？
2. 如果选 B，我需要联网取一次官方构建产物（`unpkg.com/@floating-ui/dom`），**这是一次外部下载，需你确认**。

---

## 五、已执行（选 B）

**用户批准方案 B，已完成接入。**

### 5.1 落地方式

```
js/lib/floating-ui.core.umd.min.js   12552 B  @floating-ui/core@1.8.0  UMD
js/lib/floating-ui.dom.umd.min.js    10042 B  @floating-ui/dom@1.8.0   UMD
```

> UMD 版把 core 当外部依赖（`t.FloatingUICore`），所以**两个文件都要加载，core 在前**。
> 已在 manifest 的 content_scripts 里插在 `image-hover.js` 之前。
> 合计约 22KB 未压缩（gzip 后约 7KB），零运行时依赖，MIT。

### 5.2 代码改动

`js/image-hover.js`：

| 删掉的 | 换成的 |
|---|---|
| `place()` 里手算 `left/top` + 夹回视口 | `computePosition` + `offset` / `flip` / `shift` |
| `void wrap.offsetWidth` 强制回流 | `autoUpdate` 自动重算 |
| `wrap.style.opacity = '0' → '1'` 藏抖动 | 不需要了 |

保留了一个**兜底分支**：`self.FloatingUIDOM` 不存在时退回原手算逻辑，
保证「库没加载时按钮至少能出现」，不会整块功能失效。

`autoUpdate` 的清理句柄 `stopAutoUpdate` **必须声明在文件顶部**——
`hideNow` / `teardown` 定义在 `startAutoUpdate` 之前，若 `let` 写在中间，提前调用会撞 TDZ。

### 5.3 参数调试记录（给后续维护者）

`offset` 的两个轴方向容易搞反，实测结论：

```js
F.offset(({ rects }) => ({
    mainAxis: -(rects.floating.height + 8),  // 负值 = 往下压回图片内部
    alignmentAxis: 8                         // 正值 = end 方向内缩
}))
```

- `alignmentAxis: -8` → 按钮右边缘跑到图片外 8px（656 vs 期望 640）
- `alignmentAxis: +8` → 精确 640 ✅
- `mainAxis` 必须用函数式（依赖按钮高度，测量后才知道）

### 5.4 验证结果

`cdp-image-test.py` **34/34 通过**，位置断言精确：
`wrap右 = 640 = 图右(648) - 8`、`wrap顶 = 97.5 = 图顶(89.5) + 8`。

之前失败的三条（B3 文案有但不可见、B5 位置偏、C1 点击点空）全部修好——
**它们本来就是手写防抖的副作用，换库后自然消失**。

---

### 6.1 当初的判断（已验证）

**选 B。** 理由：
- 零依赖、MIT、社区标准（Radix 等都在用它的底层）
- 只加一个静态文件，不动构建体系
- 能直接消掉我踩过的「抖动 / 夹取 / 滚动跟随」三类坑，代码量反而减少

如果引入，我会：
1. 把 `place()` 换成 `computePosition` + `offset/flip/shift`
2. 用 `autoUpdate` 替掉手写的 `void offsetWidth` 和 `opacity:0` 防抖
3. 跑一遍 `cdp-image-test.py`（34 条）和 `cdp-image-hover-hit-test.py`（26 条）验证
