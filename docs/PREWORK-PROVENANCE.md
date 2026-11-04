# 技术预研 · 下载溯源字段（B-07 / A 档）

> 版本：v1.0 ｜ 日期：2026-11-04 ｜ 状态：**预研完成，待苏哥审批后施工**
> 要回答的三个问题：**能不能做？代价多大？有没有更省事的做法？**
> 依据：代码实测（2026-11-04，全部结论带行号）；契约见 `docs/INTERFACE-CONTRACT.md`

---

## 〇、结论先行（大白话）

1. **能做，而且比想的省事。** 下载时能拿到的信息比我们以为的多：原帖链接、作者名、作者 ID 大半已经在链路里传了，只是没存全。
2. **埋一个点管所有下载。** 所有下载都汇到 `vrDownloadWithName` 一个漏斗，在那里记一笔就行，不用改十几个站点脚本。
3. **发现一个既有 bug 顺手修**：原帖链接（pageUrl）现在其实存进库了，但「重建索引」会把这一列整列抹掉——这个不修，溯源做多少丢多少。
4. **异常绝对不影响下载**：埋点放进现成的 try/catch（background.js:378-382 同款），记账失败就当没发生，下载照常。

---

## 一、埋点位置（唯一漏斗）

```
js/background.js:529   function vrDownloadWithName(url, filename, extra)
js/background.js:530     vrQueueFilename(url, filename, ...)   ← 统一记账入口
js/background.js:378-382   try { self.VRLib.record(url, {relPath, ...meta}) } catch(e){}
                           ↑ 埋点扩在这里：已有 try/catch，失败不影响下载
```

- 现状：**11 个调用点**全部经 `vrDownloadWithName`（自动下载 / 单图 / m3u8 合并 / Instagram / X 按钮 / 主页批量 / 抖音视频 / 通用视频 / 右键秒存），只有 1 处（`background.js:825` 单图）传了 meta。
- 结论：**在漏斗处收口 + 各调用点补传 meta**，两件事都要做。

## 二、字段来源逐项核实

| 字段 | 能不能拿到 | 来源 | 还差什么 |
|---|---|---|---|
| 媒体直链 `mediaUrl` | ✅ 已入库 | 就是 `vrDownloadWithName` 的 `url`，已作为 `sourceUrl` 落库（sw-library.js:194） | 无 |
| 作品页 `pageUrl` | 🟡 半成品 | 链路里已有：bulk-profile.js:217/237、yt-page.js:101、x-button.js:91 都拿到了；SW 也写了（sw-library.js:195） | ①部分调用点没传；②**indexer 白名单不保留，重建即丢**（indexer.js:246-261） |
| 博主名 `author` | ✅ 大半有 | payload 已带：bulk-profile（xhs/weibo）、instagram.js:59-68、naming.js extractPageInfo | X 按钮、抖音、右键秒存这几路要补 |
| 可读账号 `authorHandle` | ✅ 大半有 | 即 `creatorId`（@NASA / 抖音号），同上 | 同上 |
| 作者主页 `authorUrl` | ❌ 没有 | 需按站点规则从 pageUrl 拼（如 X → `x.com/{user}`） | 新增站点规则表 |
| 作品 ID `workId` | 🟡 现成零散 | X `statusId`、IG `shortcode`、小红书 `noteId` 都在 payload 里（background.js:2764 vrMediaIdentity 已归一） | 统一写入一个字段 |
| 下载时间 `dlAt` | ✅ 白捡 | downloads.onChanged state=complete 的 `d.endTime`（sw-library.js:255-261、:192）已在监听 | 落库时多写一个字段 |

## 三、更省事的做法：分两档施工

| 档 | 内容 | 代价 | 覆盖率 |
|---|---|---|---|
| **P0（建议先做）** | `pageUrl` + `author` + `authorHandle` + `workId` + `dlAt`：漏斗埋点 + 11 个调用点补传 + indexer 白名单补漏（含 pageUrl 既有隐患） | 改 1 个漏斗函数 + 11 处调用点加参数 + 2 个落库函数 + 白名单 1 行 ≈ **半天内** | 常用路径全覆盖 |
| P1（随用随补） | `authorUrl` 站点规则表（x.com/{user}、weibo.com/u/{uid}…）+ `authorUid` | 每个站点 1-3 行规则 | 先覆盖 X/微博/小红书/B站 |

**不建议**的替代方案：从文件路径/目录名反推（现在就是这么干的，正是要废掉的做法）；或下载后再回头解析页面（要重新发请求，容易触发风控，且 CDN 直链会过期）。

## 四、落库与迁移（不用迁移老数据）

- 写入点：sw-library.js `writeOne`(:182-201) 与 `ingestDirect`(:127-146) 各加几个字段。
- `entryFromRel`（indexer.js:209-231）补默认值，`mergeEntry` 白名单（:246-261）补 6 个字段。
- **老条目不用迁移**：缺字段显示「未记录」徽标（原型四态已设计好），新下载自动带全。

## 五、风险与红线

1. **埋点必须 try/catch 全包**（红线）：参考现成范式 background.js:378-382；`vrMergeSave`（:1604）这条链上层没有兜底 catch，埋点绝不能在这条链上裸抛。
2. **meta 与 downloads 参数隔离**：`extra.meta` 进函数后先 `delete`（background.js:535 现状），新字段照旧。
3. **不碰下载主流程**：埋点只读不写下载参数，失败静默。
4. **验收红线 META-6**：人为让埋点抛异常，下载必须照常成功——这条进用例清单。

## 六、工期与验收

| 项 | 估 |
|---|---|
| P0 施工 + 自测 | 0.5 天 |
| 验收 | META-1~7 用例（重点 META-6 异常不影响下载、META-2 X 单图全字段、META-5 重建索引字段不丢） |
| P1 站点规则表 | 每站 10 分钟，随站点验证一起做 |

> 审批通过后按 `docs/MEDIA-METADATA-PLAN.md` 用例施工，本预研只定方案不改代码（G-1 铁律）。
