# 全量按钮 E2E 审计（2026-11-06）

> 目的：回答「是不是很多按钮都是假的」。结论：**没有发现假按钮**；
> 上一轮报告里大量「无反应」全部是**测试前置条件缺失**或**原生对话框阻塞**导致的误报。

## 1. 方法（为什么不用 Playwright）

先按「先搜索再动手」的要求查了业界方案：

| 方案 | 结论 |
|---|---|
| `playwright` 1.65.0（Apache-2.0，微软） | 最主流，但对本项目是**重复建设**：它测 Chrome 扩展底层同样是 CDP，且要另下 ~500MB 浏览器 |
| `puppeteer-core` 25.16.0 | 同上，且不能直接用现有 Edge 登录态 |
| `chrome-remote-interface` 0.34.0 | 本项目 `tools/cdp_client.py` 已等价实现 |

**采用**：复用项目既有 CDP 基建（`tools/cdp_client.py` + `tools/e2e-all.py --isolated`），
零新依赖，直接跑真实 Edge、真实扩展上下文、真实 IndexedDB。

审计分三步：
1. **静态扫描**：解析 HTML 里所有 `button[id]/a[id]`，检查 id 是否在 JS 中出现。
2. **运行时全量点击**：逐按钮 `click()`，对比点击前后的 DOM 长度、弹层数量、网络请求、JS 异常。
3. **按前置条件分组复测**：对「无副作用」项补上前置状态再测（打开预览、进入选择模式、选中收藏夹等）。

## 2. 静态扫描结果

| 页面 | 按钮数 | id 完全不在 JS 中 |
|---|---|---|
| library.html | 83 | 0 |
| popup.html | 65 | 0 |
| options.html | 98 | 4（`ResetExt/ResetType/ResetRegex/ResetBlockUrl`） |

那 4 个是**误报**：它们靠 `data-reset` 属性走 jQuery 委托
（`js/options.js:232` `$("[data-reset]").bind("click", ...)`），静态按 id 找当然找不到。
运行时验证：点击触发 `confirm` → `chrome.storage.sync.set` → `location.reload()`，**功能真实存在**。

## 3. 运行时结果（真实库 39 条）

### ✅ 已验证可用
| 按钮 | 证据 |
|---|---|
| 预览 `pvPrev / pvNext` | 索引 `1/39` → `39/39` → `1/39`，标题跟着变 |
| 预览 `pvClose` | 预览层 `hidden=true` |
| `batchAll` | 已选 2 → **39 项** |
| `batchInvert` | 39 → **0 项** |
| `batchExit` | 批量条隐藏、选中清零 |
| 批量「加入收藏夹」 | 收藏 id 数 5 → 6，新条目确认写入 |
| 批量「移动到…」 | 弹出应用内文件夹选择器 |
| 批量「删除到回收站」 | 弹出确认框（本轮修复，见 §4） |
| 右键菜单 9 项 | 图片 10 项（含 Google 识图）/ 视频 9 项 |
| options 四个 Reset | `confirm` → 写 storage → reload |

### ⚠️ 需要前置条件（不是假按钮）
| 按钮 | 缺什么 |
|---|---|
| `pvFav / pvStar / pvTagSave` | 需先打开预览（已单独验证可用） |
| `favRename / favDelete / favExport` | 需先在左栏选中一个收藏夹（`S.fav`），否则只提示「先选一个收藏夹」 |
| `batchMove / batchTrash` | 需先选中素材 **且**有目录写权限 |
| `sdDirBtn / sdOptionsLink` | 打开设置页/抽屉，属导航 |
| `ksClose / dwClose / favDrawerClose` | 关闭面板，面板本身没开时无效果 |

### ❌ 本轮修掉的真实 bug
`batchTrash` 调用的 `ask()` 定义在 `bindMissing()` 内部，而它自己位于 `bind()`，
点击抛 `ReferenceError: ask is not defined`，界面毫无反应。已把确认框提到模块级。

## 4. 测试方法备忘（避免下次误判）

1. **隔离库是空的**：`e2e-all --isolated` 每次清 profile，`load:0`、0 张卡片。
   批量类按钮在空库里「点不动」是正常的，验证需用真实库或先种数据。
2. **原生对话框会阻塞 CDP**：`confirm/alert/prompt` 一旦弹出，后续 `Runtime.evaluate`
   全部超时。测试要先桩掉：`window.confirm=()=>true`，或在 `Page.javascriptDialogOpening` 时 `Page.handleJavaScriptDialog`。
3. **`location.reload()` 会断开连接**：`ResetExt` 这类按钮点击后页面重载，
   连接超时不代表功能坏。
4. **`element.click()` ≠ 真实点击**：前者不触发 `pointerdown/mousedown` 序列，
   与用户行为不完全等价，涉及事件委托时要一并验证。
5. **需要前置状态的按钮**：按「打开预览 → 再点预览按钮」「进入选择模式 → 再点批量按钮」的顺序测。

## 4.1 机器回归结果（真实库 39 条）

| 套件 | 结果 |
|---|---|
| `library-buttons-e2e.py --port 9480` | **99 个按钮 / 实点 91 / 跳过 8 个破坏性 / JS 异常 0 / 页面异常 0 / passed** |
| `library-functions-e2e.py --port 9480` | **44/44 PASS**（修了 3 条过期断言，见下） |

### 顺带修掉的过期断言
`library-functions-e2e.py` 有 3 条还在按旧行为断言，本轮同步：
- 「平台行=折叠开关(卡片数不变)」→ 左侧平台节点现在**就是筛选入口**，
  改为断言「卡片数收窄」；
- 两条 `#chips .chip` 断言 → 顶部 chips 已在 B-23 移除，改为点左侧树节点。

这不是放宽断言，而是把断言改到**当前正确行为**。

## 5. 结论

- **没有发现装饰性假按钮**。83 + 65 + 98 个按钮全部在 JS 中有对应处理。
- 本轮修掉 1 个真 bug（批量删除 `ask` 作用域）和 2 个可用性问题（只读态无提示、移动/删除静默失败）。
- 剩余「无反应」项全部有明确前置条件，属预期行为。

## 6. 复现

```bash
# 隔离回归（空库，适合纯 UI 断言）
python tools/e2e-all.py --isolated --only stage-rewrite,e2e-buttons

# 真实库（39 条，验证批量/预览这类依赖数据的按钮）
python tools/library-buttons-e2e.py --port 9480
python tools/library-functions-e2e.py --port 9480
```
