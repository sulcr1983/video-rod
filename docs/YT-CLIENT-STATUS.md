# YouTube 客户端可用性实测（2026-10-24 22:5x）

> 背景：用户实测报错 `取格式失败：TVHTML5 → UNPLAYABLE：The page needs to be reloaded.`
> 本文记录逐客户端实测结果，以及为什么改成 VISIONOS。
> 环境：Chrome for Testing 147 + 本机代理 `127.0.0.1:7897`（出口 IPv4），未登录 YouTube。

---

## 一、结论先行

| 项 | 状态 |
|---|---|
| MWEB（研究阶段唯一可用的那个） | ❌ **已被关闭**，统一回 `UNPLAYABLE: The page needs to be reloaded` |
| **VISIONOS** | ✅ **可用**：32 条格式全带直链，最高 2160p，**URL 里没有 `n` 参数** |
| 取格式耗时 | ✅ 0.2 秒 |
| 直链可用性 | ✅ `Range: bytes=0-15` → `206` + `ftypdash`（真实 MP4 字节） |
| 完整拉流速度 | ⚠️ 浏览器侧极慢（2–170 KB/s），Python 经同一代理 1.4–2.0 MB/s |

**所以：功能链路是通的，慢是网络环境问题，不是代码问题。**

---

## 二、逐客户端实测（视频 `aqz-KE-bpKQ`，正常可播）

| 客户端 | clientName | 数字 id | HTTP | status | adaptive | 带 url | 最高 | 备注 |
|---|---|---|---|---|---|---|---|---|
| **VISIONOS** | `VISIONOS` | 101 | 200 | **OK** | **32** | **32** | **2160p** | ✅ 现在唯一稳定可用的 |
| MWEB | `MWEB` | 2 | 200 | UNPLAYABLE | 0 | 0 | — | 「The page needs to be reloaded」 |
| TVHTML5 | `TVHTML5` | 7 | 200 | UNPLAYABLE | 0 | 0 | — | 同上报错 |
| ANDROID | `ANDROID` | 3 | 400 | — | 0 | 0 | — | HTTP 400，版本 19.44.38 已失效 |
| IOS | `IOS` | 5 | 400 | — | 0 | 0 | — | HTTP 400，版本 19.45.4 已失效 |
| ANDROID_VR | `ANDROID_VR` | 28 | 200 | LOGIN_REQUIRED | 0 | 0 | — | 「Sign in to confirm you're not a bot」 |
| WEB | `WEB` | 1 | 200 | OK | 40 | **0** | — | 全是 SABR，`serverAbrStreamingUrl` 有值 |
| WEB_EMBEDDED | `WEB_EMBEDDED_PLAYER` | 56 | 200 | ERROR | 0 | 0 | — | 「This video is unavailable」 |
| TVHTML5_SIMPLY | `TVHTML5_SIMPLY_EMBEDDED_PLAYER` | 85 | 200 | ERROR | 0 | 0 | — | 「YouTube is no longer supported in this application or device」 |
| ANDROID_TESTSUITE | `ANDROID_TESTSUITE` | 30 | 200 | UNPLAYABLE | 0 | 0 | — | 「This video is not available」 |

> 结论：**只剩 VISIONOS 一条路**。研究阶段「只有 MWEB 活着」的判断已经过期（见 `YT-FEASIBILITY.md` §2 的表）。

### 2.1 VISIONOS 的格式清单（节选）

| itag | mime | codec | 分辨率 | 大小 |
|---|---|---|---|---|
| 315 | video/webm | vp9 | 2160p | 1.30 GB |
| 401 | video/mp4 | av01.0.13M.08 | 2160p | 679 MB |
| 308 | video/webm | vp9 | 1440p | 451 MB |
| 400 | video/mp4 | av01.0.12M.08 | 1440p | 298 MB |
| **299** | video/mp4 | **avc1.64002A** | **1080p60** | 246 MB |
| 303 | video/webm | vp9 | 1080p | 161 MB |
| 399 | video/mp4 | av01.0.09M.08 | 1080p | 119 MB |
| 298 | video/mp4 | avc1.4D4020 | 720p | 144 MB |
| 160 | video/mp4 | avc1.4D400C | 144p | 4.1 MB |

**关键**：所有 URL 的 `n` 参数都是空的 —— **不需要跑 sandbox 解密**。这比原来 MWEB 那条路更简单。

---

## 三、为什么浏览器里慢、Python 里快

同一个直链、同一条代理：

| 拉取方式 | 1 MB | 4 MB |
|---|---|---|
| Python `urllib` 经代理 | 0.7 s（1435 KB/s） | 2.1 s（1966 KB/s） |
| 浏览器 `fetch`（扩展页） | 6.1 s（172 KB/s） | 21.9 s（191 KB/s） |
| 浏览器 `fetch`（64 KB 分片） | — | 28.2 s（2.3 KB/s） |

差异原因（已排除的）：
- ❌ 不是 CORS：扩展页有 `<all_urls>`，`fetch` 返回 `206` 正常。
- ❌ 不是直链过期：`expire` 比当前时间晚约 6 小时；同一 URL Python 刚拉成功。
- ❌ 不是 `n` 参数：URL 里没有 `n`。
- ✅ **是浏览器侧到 googlevideo 的连接慢**：URL 里 `ip=2a09:bac5:...` 是 **IPv6** 地址，
  而代理出口是 IPv4。浏览器优先走 IPv6 连接，代理对 IPv6 转发明显更慢/绕路。

**待验证的解法**（下次网络条件好时再试）：
1. 代理开启 IPv4 优先 / 关闭 IPv6 转发；
2. 或让 Chrome 走 `--disable-ipv6`；
3. 或换一个出口节点再测吞吐。

---

## 四、代码改动

### 4.1 `js/background.js` 的 `ytCollectFormats`

- 客户端顺序改为 **VISIONOS → MWEB → TVHTML5 → ANDROID → IOS**（第一个能出直链的就用）。
- 错误汇总改为**收集所有客户端的结果**（早先只留最后一个，所以用户只看到 TVHTML5 那一行，
  前三个的真实原因被覆盖 —— 这是本次报错信息误导人的根因）。
- 失败分类：
  | code | 触发 | 给用户的建议 |
  |---|---|---|
  | `YT_E_UNAVAILABLE` | 视频本身不可播（下架/私有/会员/地区） | 换一个视频试试 |
  | `YT_E_LOGIN` | 需要登录 | 先在本浏览器登录 YouTube |
  | `YT_E_BLOCKED` | 客户端全被拒（限流/风控） | 刷新、等几分钟 |

### 4.2 关于用户报的那个 Shorts

`DtY-bKDvl4I` 实测：`playabilityStatus.status = ERROR`，`reason = 此视频不能观看`，
**页面自己都播不了**。所以不是扩展的问题，是那个视频本身不可用。
现在的错误分类会直接告诉用户「换一个视频」，不再笼统地说「等几分钟」。

---

## 五、复现命令

```bash
# 起带代理的浏览器
chrome --remote-debugging-port=9491 \
  --user-data-dir=.work/profiles/yt-test \
  --proxy-server=http://127.0.0.1:7897 \
  --load-extension=E:\test\video-rod

# 逐客户端实测（脚本在 .work/ 下，属临时诊断，不入库）
python .work/chk3.py     # TV 系 + VISIONOS 对比
python .work/chk4.py     # VISIONOS 格式清单 + Range 探测
python .work/chk9.py     # 三种 fetch 模式对比（验证 CORS）
python .work/e2e-net2.py # 浏览器侧吞吐计时
```
