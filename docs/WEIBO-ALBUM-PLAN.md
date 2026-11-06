# 微博相册备份方案（参考「叫小微」拆解）

> 日期：2026-11-06 ｜ 状态：**已实现，端到端实测通过**
> 触发：苏哥要求「参考星愿浏览器里装的『叫小微--微博相册备份/无水印下载』，拆解它、看能不能参考」
> 本文档可信度：**混合**。§2 拆解结论来自**源码实读**（S 级）；§3 平台约束来自**本机实测**（S 级）；
> §3.5 记录了**首版设计被实测推翻**的两条，以及据此做的返工。§4 之后是实现说明。

---

## 一、一句话结论

小微值得抄的是**采集方式**（微博官方相册接口分页），但不值得抄它的**下载方式**（内存打 zip + 第三方图片代理 + 无目录文件名）。

**实测还推翻了它两个具体假设**：`oslarge` 并不是最大档（`large` 才是），
`timeline_year/month` 也**不能**用来按月分组（大面积为空）。

我们的下载链路（`vrBulkSaveItem` → 进资源库 → 去重 → 元数据）已经比它强，
所以本轮只新增采集层，落盘完全复用既有链路。

---

## 二、小微的拆解（源码实读）

扩展 ID `gkdmgafcigdgbobmkjbdhbehldipmkki`，v1.0.2，MV3，Edge 商店包。
文件构成：

| 文件 | 大小 | 作用 |
|---|---|---|
| `manifest.json` | 2 KB | 只匹配 `*://weibo.com/*`（**不含 `m.weibo.cn`**） |
| `service_worker.js` | 4 KB | 只有 `DOWNLOAD_ITEM` 与 `BUY_NOW` 两条消息 |
| `content_script.js` | **347 KB** | 全部业务逻辑；jQuery 3.7.1 + Bootstrap + datetimepicker + JSZip + FileSaver 全量内联 |
| `popup.js` | 大 | 当前标签页检测 + 付费墙 |

### 2.1 四条核心链路

**① 入口：只认 `/u/<uid>`**

`chrome.tabs.query` 取当前 URL，判断含 `weibo.com/` 且含 `/u/`，截取 `/u/` 后的数字为 uid；
不满足则整页显示「请打开微博用户主页再开始」。随后 `tabs.sendMessage({messageType:'DATA_ACTION'})` 唤醒内容脚本。

内容脚本用 `MutationObserver` 监听 `location.href`，SPA 内切到 `/u/` 时重置游标。**这条我们有缺口**（见 §2.3）。

**② 数据源：官方相册 API 按月翻页**（最关键）

```js
fetch(`https://weibo.com/ajax/profile/getImageWall?uid=${uid}&sinceid=${cursor}&has_album=true`)
// → data: { since_id, list: [{ pid, timeline_year, timeline_month, ... }] }
```

- `since_id` 作游标循环取页；
- 每条只需要 `pid` + `timeline_year` + `timeline_month`，按 `year-month` 分桶成「月份卡片」；
- 循环终止：返回月份**早于用户选的起始月**即 `break`。

这拿到的是**整个相册历史**，不受「页面滚到哪」限制。

**③ 一张图三个地址**

```js
const Cs = "https://wx3.sinaimg.cn/orj360/";
thumb = Cs + pid + ".jpg";                                          // 列表缩略图
large = "https://i3.wp.com/lz.sinaimg.cn/oslarge/" + pid + ".jpg";   // 主下载（第三方代理）
bk    = "https://wx3.sinaimg.cn/oslarge/" + pid + ".jpg";            // 失败回退
```

**④ 两种下载形态**

- 单图：`chrome.downloads.download({url, filename: pid + '.jpg'})` —— 无目录、无 `.catch()`，失败静默。
- 批量：**内容脚本并发拉字节 → JSZip 内存打包 → FileSaver 存盘**。并发用 `s.length >= 10 && await Promise.race(s)`；失败条目**全部跑完后**用 `bk` 地址重试一轮；`generateAsync({type:'blob', compression:'DEFLATE', level:9})`。

### 2.2 还有一层不抄的：远端积分墙

`geckoinfo.cloud` 的注册/登录/额度接口（`/web/users/{register,login,user-limit,update-limit}`），
赠 5 积分、每张扣 1、不足弹订阅。这是商业模式，与技术方案无关。

### 2.3 逐项对照：抄什么、不抄什么

| 能力 | 小微 | video-rod 现状 | 结论 |
|---|---|---|---|
| 相册历史（不靠滚动） | `getImageWall` 分页 | 无，只有 DOM 扫描 | **抄** |
| 原图档位 `oslarge` | 主用 | 只到 `/large/`（`bulk-profile.js` `bigImage()`） | **抄**（需校验，见 §3.3） |
| 防盗链取字节 | 页面 XHR + 第三方代理 | 离屏 fetch（`vrOffscreenDownload`） | 我们更好，**不抄代理为主路径** |
| 多地址回退 | 失败后重试 `bk` | **无**（`vrBulkSaveItem` 只用单个 `it.url`，2026-11-06 核实） | 需自建，见 §4.2 |
| 批量落盘 | 内存 zip | downloads → 离屏 → FSA 三段 | 我们更强，**不抄 zip 为默认** |
| 命名 | `pid.jpg` / `月份/序号_pid.jpg` | `VRPath` 三段式 + 中文目录 + 入库元数据 | 我们更强 |
| SPA 切用户重置 | `MutationObserver` | 无（`bulk-profile.js` 在 `document_idle` 一次性取 `profileUser`） | **抄**（小改） |
| 去重 | 靠勾选框 | `vrFindExistingMedia` + `vrMediaIdentity`（键含 URL 路径，档位变化会漏判） | 内容脚本侧按 pid 再兜一层 |
| 付费墙 | 有 | 无（也不需要） | 不抄 |

### 2.4 明确不抄的四条

1. **不把整月相册在内存里打 zip**：FileSaver 落一个 zip，文件进不了资源库、没法预览/去重/检索，且 level 9 压缩在大相册上耗时明显。
2. **不用第三方图片代理作主下载地址**：会把用户的私人相册请求转给第三方；且实测该域名在 `curl` 路径上不可用（见 §3.2）。
3. **不注入 347 KB 的 jQuery + Bootstrap**：我们现有的图片线是 6 个按需脚本，不回退到这个形态。
4. **不抄付费墙与远端记账**。

---

## 三、平台约束（本机实测，S 级）

> 以下每条都在本机跑过，命令与结果见 §3.5。探测脚本与会话临时文件均在 `$TMPDIR`，**未进仓库**。

### 3.1 相册 API 真实存在，但需要登录态

```
GET https://weibo.com/ajax/profile/getImageWall?uid=<uid>&sinceid=0&has_album=true
→ 200  {"ok":-100,"url":"https://weibo.com/login.php?url=..."}
```

- 端点**不是 404**：返回业务错误码 `ok:-100` + 登录跳转，说明接口在线、只是缺登录 Cookie。
- 不带 `UA`/`Referer` 时返回 **403**；带站点 `Referer` 才进业务层。→ **请求必须由页面上下文或携带 Referer 的离屏上下文发出。**

### 3.2 域名可达性（含一处此前的误判修正）

| 域名 | 结论 |
|---|---|
| `wx1/2/3/4.sinaimg.cn` | 可达 |
| `ww1.sinaimg.cn`、`lz.sinaimg.cn` | 可达 |
| `i3.wp.com`（小微的第三方代理） | **urllib 200，但 curl 一律 `000`** |

> **误判修正**：本轮我一度写下「`i3.wp.com` 完全不可达」，那是**错的** —— 当时只用了 curl。
> 对照实验中同一个 URL 用 `urllib` 返回 `200 / image/gif / 7092B`。该域名在 curl 的 TLS/DNS 路径上有问题，
> 不等于服务不可用。**这条修正必须保留**，否则后续会基于错误前提把它整个删掉。

### 3.3 sinaimg 的防盗链是「UA + Referer」组合判定（本轮最重要的一条）

同一 URL 的四种组合实测：

| 请求形态 | 结果 |
|---|---|
| Chrome UA，**无** Referer | **403**（`text/html`，238 B） |
| Chrome UA + `Referer: https://weibo.com/` | **200** |
| 无 UA | **200** |

**这条直接决定实现方式**：`sinaimg` 不是「只认 Referer」，而是「见到 Chrome UA 就必须有 Referer」。
因此候选链**不能裸直连**，必须走：

- 页面上下文 `fetch`（自带页面 Referer 与 Cookie），或
- 离屏文档 `fetch`（扩展上下文，配 DNR 补 Referer / 显式 Referer）

> 也与既有记录吻合：`HANDOFF-2026-11-06.md:211` 记过「扩展发起的请求自带 `Origin: chrome-extension://<id>`，
> sinaimg 会直接拒」。两条是同一类机制的不同触发条件。

### 3.4 占位图陷阱：**只看 HTTP 200 会把失败当成功**

sinaimg 对**无效 pid** 不返回 404，而是返回 **200 + image/gif 占位图**，且 final URL 会重写成档位专属的默认图：

```
https://wx1.sinaimg.cn/oslarge/<无效pid>.jpg
  → 200  image/gif  7092 B   final: .../oslarge/images/default_s_oslarge.gif#103
https://lz.sinaimg.cn/oslarge/<无效pid>.jpg
  → 200  image/gif  7092 B   final: .../oslarge/images/default_s_oslarge.gif#103
```

而 `orj360` 返回的是 `default_s_orj360.gif`（5373 B）。**文件名带档位名**这一点，反过来证明
**四个档位目录各自真实存在、不是统一兜底**（含 `oslarge`，即小微用的那个档位没有下线）。

判定规则（已固化为可回归用例 `chain_rule_test.py`，7/7 通过）：

```js
可用 = status === 200
    && content-type 以 image/ 开头
    && !/\/images\/default_/.test(finalUrl)   // 占位图
    && bytes >= 1024
    && content-type !== 'image/gif'           // 微博相册真实作品是 jpg
```

### 3.5 实测补充：首版设计被推翻的两条（2026-11-06 登录态实测）

用 Edge（`Edg/156`，CDP 9480）的真实登录态，在 `weibo.com/u/5750600479` 页面上下文实测，结论如下。

**① 档位排序反了 —— `large` 才是最大，不是 `oslarge`**

三个样本一致：

| 档位 | 尺寸 | 字节 | 结果 |
|---|---|---|---|
| `oslarge` | 690×847 / 648×844 / 380×514 | 161 KB / 150 KB / 32 KB | 比 large 小 |
| **`large`** | **744×913 / 648×844 / 380×514** | **353 KB / 294 KB / 33 KB** | **最大** |
| `original` | 与 large **完全相同**（尺寸与字节都相等） | — | 等价备份 |
| `lz.sinaimg.cn` | — | — | `Failed to fetch`（3/3 全失败） |
| `webp720` | 720×884 | 62 KB | webp 有损，不作原图 |

→ 档位改为 **`large` 首选、`original` 备份**；`oslarge`、`lz`、第三方代理**全部移除**。

**② `timeline_year/month` 不能用来按月分组**

| 观测 | 数据 |
|---|---|
| 第 1 页 | 21 条，仅 6 条有月份 |
| 第 2 页起 | 24 条**全部**无月份 |
| 三页合计 | 71 条中 **65 条无月份** |
| 按 mid 分组补齐 | 仅补回 **8 条**，仍有 **57 条救不回来** |
| 逐条反查 `statuses/show?id=<mid>` | 能拿到准确时间，但 65 条 = 65 次请求，风控风险高 |

→ **放弃按月分组**，改为「按接口顺序收集 + 最多取 N 张」。接口本身按时间倒序返回，顺序即天然时间序。

**③ 顺带发现：首条条目没有 `pid`**

返回的第一条是 `object_id: null` 且无 `pid`，直接拼 URL 会得到 `undefined.jpg`（首版探针就撞上了）。
→ 收集时必须跳过无 `pid` 的条目。

> 以上均为**登录态实测**，不再是间接证据。早期的「未实测」缺口已经关闭。

### 3.6 探测命令（可复现）

```bash
# ① 端点存在性与登录要求（无登录态时应返回 ok:-100 登录跳转，而不是 404）
curl -s --noproxy '*' -H "User-Agent: ...Chrome/144..." \
     -H "Referer: https://weibo.com/u/<uid>" \
     "https://weibo.com/ajax/profile/getImageWall?uid=<uid>&sinceid=0&has_album=true"

# ② 档位真实对比（必须用**真实 pid**，无效 pid 只会返回占位图）
#    实测结论：large 744x913/353KB > oslarge 690x847/161KB，original == large

# ③ UA/Referer 组合判定（对照实验，避免把自己打成限流）
#    关键结果：wx*.sinaimg.cn 在「Chrome UA 且无 Referer」下 403，其余 200

# ④ 候选可用性判定规则：占位图必须被拒
#    sinaimg 对无效 pid 返回 200 + image/gif + final URL 含 /images/default_
#    所以判定不能只看 HTTP 200（规则见 §3.4）
```

> 探测用的临时脚本按约定放在会话临时目录，**不进仓库**（会话结束后随之清理）。
> 长期可回归的判定规则应落到 `tools/` 下的单测里，见 §7 验收第 1 条。

---

## 四、我们的方案

### 4.1 架构：只加采集层，落盘复用既有链路

```
[新] js/weibo-backup.js + weibo-album-core.js    [既有] js/background.js
  · 独立浮标「相册备份」            · vrBulkDownload（去重 / 风控暂停 / 进度）
  · 「最多取 N 张」                 · vrBulkSaveItem（单地址 → 离屏兜底 → FSA）
  · getImageWall 分页               · vrMediaPath / VRPath（三段式命名 + 中文目录）
  · 按接口顺序收集（不按月）        · vrBulkMeta（资源库元数据）
  · 档位探测 + 按 pid 去重          · vrFindExistingMedia / vrMediaIdentity
  · 选中 → sendMessage
```

**不新增下载实现，也不改 `background.js`**。采集、探测与去重都在内容脚本侧完成，
只把「已确定好首选地址的条目」交给既有 `vrBulkDownload`。

> **两处前提修正（2026-11-06 实测）**：
> ① 计划初稿写「复用 `vrBulkSaveItem` 的 `it.urls` 候选池」，但该候选池**并不存在**
>    （`vrBulkSaveItem` 只用单个 `it.url`，当前版本、HEAD、git 全历史都搜不到）；
> ② 计划初稿写「按月分组」，但 `timeline_year/month` 实测大面积为空（见 §3.5）。
> 因此改为「按接口顺序收集 + 下载前探一次档位」。

### 4.2 候选链与档位探测

```js
// 两级，顺序即优先级（js/weibo-album-core.js 的 TIER_ORDER）
['large', 'original']
```

> 首版是五级 `oslarge → large → original → lz → proxy`，被实测推翻：
> `large` 才是最大档，`lz`/`proxy` 3/3 全部 `Failed to fetch`。现已收敛为两级。

因为后端只认一个地址，不能指望它逐级回退，所以**下载前用一张样本图探一次**：

1. 取选中条目里的第一个 pid，按 `TIER_ORDER` 依次请求（页面上下文 fetch，自带 Referer）；
2. 命中第一个通过 §3.4 判定的档位就停下 —— 实测 `large` 通常**第一次就命中**（`tried: 1`）；
3. 该档位作为**整批**的首选地址 —— 同一相册的档位可用性一致；
4. 全部档位都不可用时仍按 `large` 提交，并在状态栏注明「档位探测未通过」；
5. 条目里同时带 `urls` 数组，便于将来后端支持候选池时直接受益，也便于排查。

- 每级都必须过 §3.4 的判定，**占位图不算成功**；
- 失败不静默：结果按 `ok / partial / blocked / paused / error` 五态归类，风控时立刻停。

### 4.3 消息与数据形状

发送给既有 `vrBulkDownload`，每条形如：

```js
{
  site: 'weibo', kind: 'image',
  mediaId: pid,                     // 去重依据，不依赖 CDN 域名与档位
  ext: 'jpg',
  url: <large 档地址>,              // 探测出的首选档位
  urls: [<large>, <original>],      // 备用链（后端当前只用 url）
  thumb: 'https://wx3.sinaimg.cn/orj360/<pid>.jpg',
  title: '', author: '', authorId: <uid>,
  pageUrl: 'https://weibo.com/u/<uid>',
  key: 'weibo:image:<pid>'
}
```

> 已**不带 `month` 字段** —— 月份实测不可靠，UI 也不再按月份分组。

`mediaId=pid` 是关键，但**单靠它不够**：`vrMediaIdentity()` 的键是
`[site, work, mediaId, kind, url的origin+pathname]` —— URL 路径仍参与成键，
而同一张图在 `/large/` 与 `/original/` 下 pathname 不同，档位一变就会被判成新图。
所以内容脚本侧另按 pid 过滤已下载（`filterDone` / `mergeDone`，存 `chrome.storage.local`
的 `vrWeiboDone:<uid>`，2 万条上限滚动淘汰），与 CDN 域名和档位都无关。

### 4.4 分页终止（多重保险）

```js
while (pages < maxPages) {
  const d = await fetchPage(cursor);
  if (!d.list.length) break;                 // ① 空页
  collectPage(d.list, items, seen);          //    跳过无 pid、非 pic、重复
  if (items.length >= limit) break;          // ② 取够 N 张
  if (!d.since_id || d.since_id === cursor) break;  // ③ 游标没推进（防死循环）
  cursor = d.since_id;
}
// ④ maxPages 硬上限（默认 200 页）  ⑤ 用户点「停止」随时中断
```

> 早期版本的终止条件里还有「月份早于起始月即停」，实测月份不可靠后已移除。

`MAX_PAGES` 硬上限（默认 200 页），另给「停止」按钮。

---

## 五、风险与回滚

| 风险 | 处理 |
|---|---|
| 微博限流 / 风控 | 分页间隔 ≥900ms；`vrBulkDownload` 已有「连败 3 次且零成功即暂停」；失败归类透传 `rate-limited` |
| `since_id` 语义变化（如恒等或缺失） | 多重终止已覆盖：空页 / 取够 N 张 / 游标不推进 / 页数上限，任一即停 |
| 字段名变更（`pid` / `mid`） | 解析层逐条容错：无 `pid` 的条目跳过（实测首条就是这种），不整批失败 |
| 档位策略再变（如 `large` 失效） | 仍有 `original` 兜底；探测会在首批命中前逐级回退，最差等同现状 |
| 相册很大（数千张） | 先只取元数据（pid + mid，体积小），命中 N 张即停；用户勾选后再下载，不一次性全抓 |
| 月份信息确实需要 | 可逐条调 `statuses/show?id=<mid>` 反查 `created_at`（实测可用），但每条约一次请求，默认不做 |
| 回滚 | 新增 2 个文件 + `manifest.json` 1 行 + `bulk-profile.js` 的 `bigImage()` 改造；`git revert` 单提交即可 |

## 六、明确不做

- 不做整月内存 zip（§2.4-1）
- 不引 jQuery / Bootstrap / JSZip
- 不做付费墙与远端记账
- 不改 `background.js`（含 `vrBulkSaveItem` 与三段兜底）：候选探测与去重都在内容脚本侧完成
- 不替代现有 DOM 滚动记录：滚动记录继续管「随手刷到的」，相册备份管「历史全量」
- 不按月分组、不逐条反查时间（月份实测不可靠且反查代价高）

---

## 七、验收

### 7.1 已通过（2026-11-06 实测）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 单测：`node tools/test-weibo-album.js` | **113 / 113 通过** |
| 2 | 端到端（Edge 真实登录态，CDP 9480） | `state: limit`、2 页、**44 张**、跳过 1 条无 pid |
| 3 | 档位探测实跑 | `picked: large, ok: true, tried: 1`，字节 **353486**（与独立探针一致） |
| 4 | 条目构造实跑 | `url` 为 `/large/`、`urls` 两级、无 `month` 字段 |

> 端到端验证方式：在扩展页调 `chrome.scripting.executeScript({world:'ISOLATED'})` 注入微博页，
> **注入函数必须 `try/catch` + 返回 `JSON.stringify(...)` 字符串** —— 直接返回对象会得到 `result: null`
> （Chrome 不回传注入函数的运行期异常，且不可序列化的返回值会退化为空）。

### 7.2 待人工验收

| # | 用例 | 通过标准 |
|---|---|---|
| 5 | 实站：点「下载选中」 | 逐张进资源库；目录 `video-rod/微博/<作者>(@uid)/图片/`；元数据 platform/type/sourceUrl 齐全 |
| 6 | 实站：重跑同一批 | 命中去重，不产生 `(2)(3)` 副本 |
| 7 | 实站：目录无 `.htm` | 全程不出现 `.htm` 残件 |
| 8 | 回归：既有批量 | `vrBulkDownload` 微博分支行为不变（滚动记录仍可用） |