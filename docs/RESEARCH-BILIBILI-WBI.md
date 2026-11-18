# 核实：B站 wbi 签名到底影响哪些接口

> 日期：2026-11-18 ｜ 方式：**免登录直接实测**（未使用苏哥的登录态）
> 触发：竞品诊断 #17「爱哔哔有 `x/player/wbi/playurl`，我们零命中」
> 结论：**`wbi` 影响「空间/博主枚举」，不影响「视频取流」**——但我们的 `pager.js` 正好用了受影响的那个。

---

## 一、实测结果（全部免登录，公开视频）

测试视频：`BV1xx411c7mD`（av2，公开），`cid=62131`

| # | 接口 | 结果 | 结论 |
|---|---|---|---|
| 1 | `x/player/pagelist?bvid=` | **code 0 OK** | ✅ 可用 |
| 2 | `x/web-interface/view?bvid=` | **code 0 OK** | ✅ 可用 |
| 3 | **`x/player/playurl`**（我们用的） | **code 0 OK**，`quality:80`，`durl:true`，`dash:false` | ✅ **可用，但默认给单流** |
| 4 | `x/player/playurl` + `fnval=16` | **code 0 OK**，`quality:32`，**`dash:true`，4 路视频流** | ✅ **可用，拿到 DASH** |
| 5 | `x/player/playurl` + `fnval=4048&fourk=1` | **code 0 OK**，**6 路视频流** | ✅ **最高档** |
| 6 | `x/player/wbi/playurl`（**不带签名**） | **code 0 OK**，4 路 | ✅ **居然也能用** |
| 7 | **旧 `x/space/arc/search`** | **HTTP 412** | ❌ **被拒** |
| 8 | **新 `x/space/wbi/arc/search`**（不带签名） | **code -352 `风控校验失败`** | ❌ **必须签名** |

---

## 二、三个关键结论

### 2.1 `wbi` 只影响「空间/枚举」类接口，不影响「取流」

| 接口族 | 是否要 wbi |
|---|---|
| `player/playurl`（取流） | ❌ **不要**（带不带都返回 code 0） |
| `player/pagelist`（分P） | ❌ 不要 |
| `web-interface/view`（元数据） | ❌ 不要 |
| **`space/arc/search`（UP 主作品）** | ✅ **必须**（-352） |

**所以「我们 B站下载失败是因为没有 wbi」这个担心不成立**——取流接口不需要签名。

### 2.2 但发现了一个**真实缺陷**：我们没有正确请求 DASH

我们代码（`js/bili-whole.js:80-84`）：

```js
var apiDurl = 'https://api.bilibili.com/x/player/playurl?cid=' + cid +
    '&qn=127' + COMMON;                                    // ← 无 fnval
var apiDash = 'https://api.bilibili.com/x/player/playurl?cid=' + cid +
    '&qn=127' + COMMON + '&fnval=4048';                     // ← 有 fnval=4048
```

**代码本身是对的**（`apiDash` 带了 `fnval=4048`）。但实测发现一个隐患：

| 请求 | 返回 |
|---|---|
| 无 `fnval` | `dash: false`，`durl: true`，`quality: 80` |
| `fnval=16` | `dash: true`，**4 路**，`quality: 32` |
| `fnval=4048` | `dash: true`，**6 路**，`quality: 32` |

**注意 `quality` 的差异**：
- 无 `fnval` → `quality: 80`（1080P）**单流**
- 带 `fnval` → `quality: 32`（480P）**但多路 DASH**

**`quality: 32` 不代表只能下 480P**——DASH 的真实画质在 `dash.video[]` 每一路的 `id` 里（我实测 6 路，最高应是 4K）。**顶层 `quality` 字段在 DASH 模式下不代表最高可用档**。

**风险点**：如果代码里某处用 `data.quality` 判断「能不能下高清」，会误判成 480P。

### 2.3 `pager.js` 的 B站策略**必须加 wbi 签名**

```js
// js/enumerate/pager.js 的 bilibiliStrategy
var p = new URL('https://api.bilibili.com/x/space/wbi/arc/search');
p.searchParams.set('mid', state.ownerId);
p.searchParams.set('ps', String(state.count));
p.searchParams.set('pn', String(pageNo));
// ↑ 实测：不带签名 → code -352 风控校验失败
```

**这是我写的代码的真实缺陷**——设计时没验证。**整博主枚举要能用，必须实现 wbi 签名。**

---

## 三、wbi 签名的实现要求（未实现，需补）

B站 wbi 签名流程（社区公开算法）：

```text
1. 从 /x/web-interface/nav 拿 img_url / sub_url
2. 取文件名（去掉路径和扩展名）拼成 imgKey + subKey
3. 按固定 64 位置换表重排 → mixinKey
4. 参数按 key 字典序排序 → 拼接 query string
5. wts = 当前秒级时间戳
6. w_rid = md5(query + mixinKey)
7. 最终 URL 追加 wts 与 w_rid
```

**关键约束**：
- `mixinKey` 每天变（`img_url` 的文件名会更新）
- 必须带 `Referer: https://www.bilibili.com/`（实测 412 就是缺这个）
- `wts` 与服务器时间偏差不能太大

---

## 四、修正诊断报告 #17

| 原判定 | 修正后 |
|---|---|
| `wbi` 签名「零命中，B站必需」 | **只对枚举类接口必需；取流不需要** |
| 优先级「中」 | **对「整博主枚举」是阻断级**（不做就 100% 失败） |
| — | **新增**：发现 `fnval` 与 `quality` 字段的语义陷阱 |

---

## 五、需要登录态才能确认的两件事（暂未做）

| 项 | 为什么需要登录 | 不确认的风险 |
|---|---|---|
| 登录后 DASH 是否给更高档（4K/8K） | 游客只给 480P 起 | 不知道实际能下到多高 |
| `space/wbi/arc/search` 签名后是否真能拿到列表 | 需要真实 `mid` | 枚举层可能白写 |

**这两条可以等你方便时用登录态验证，不阻塞当前工作。**

---

## 六、证据（可复现）

```bash
# 免登录实测，全部返回 code 0
GET https://api.bilibili.com/x/player/pagelist?bvid=BV1xx411c7mD
GET https://api.bilibili.com/x/player/playurl?cid=62131&bvid=BV1xx411c7mD&qn=127&fnval=4048&fourk=1

# 必须 Referer，否则 412
Headers: Referer: https://www.bilibili.com/
         User-Agent: Mozilla/5.0 ... Chrome/157

# 枚举接口不带签名 → -352
GET https://api.bilibili.com/x/space/wbi/arc/search?mid=2&ps=5&pn=1
→ {"code":-352,"message":"风控校验失败"}
```
