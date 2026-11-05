# 实测素材登记（TEST-ASSETS）

> **登录态保全（必读）**：所有需要登录的实测必须复用固定 profile `D://test//download//.edge-login-profile`（详见 `docs/TEST-BROWSER.md`）。禁止删除/更换 profile，否则要重新登录并触发风控。


> 建立：2026-11-05 ｜ 来源：苏哥提供 ｜ 状态：持续登记
> 本文件是「多平台登录态实测」的素材真源：哪个平台、哪条地址、测什么、对应哪个任务，全在这里。
> 测试方法见 §1；每次验证完成后在 §3 表回填结果，素材地址不轻易删（过期了标注 ⚠️ 并注明替换）。

---

## 1. 测试方法（2026-11-05 与苏哥确认）

**主方案：星愿浏览器（twinkstar）+ CDP 直驱**——苏哥日常登录态都在里面，免重复登录。

标准拉起流程（防"单例锁吞调试端口"，TESTING 踩坑第 9 条）：
```bash
taskkill //F //IM twinkstar.exe        # 全杀，一个不留
rm -f "<Twinkstar User Data>/SingletonLock"   # 删锁文件
sleep 5                                # 等进程退净
twinkstar.exe --remote-debugging-port=<port> --remote-debugging-address=127.0.0.1 \
  --load-extension=<video-rod 仓库路径> --no-first-run "<测试URL>"
```
验收动作：CDP `/json/version` 通 → 扩展 SW 存在 → 打开测试页 → 跑下载 → 查落盘文件与库索引。

**备用方案：Playwright 可控浏览器**——苏哥现场登录一次后持续复用 profile；用于星愿不可用或要干净环境的场景。

## 2. 平台登录态覆盖情况（苏哥口径 2026-11-05）

X ✅ ｜ 小红书 ✅ ｜ 微博 ✅ ｜ 抖音 ✅ ｜ B站 ✅ ｜ YouTube（谷歌）✅ ｜ Instagram ❌ 未登录（B-03 继续挂起，代码已提交 6bd6d19）

## 3. 素材清单

| # | 平台 | 地址 | 测什么 | 对应任务 | 结果 |
|---|------|------|--------|----------|------|
| A1 | 小红书 | https://www.xiaohongshu.com/explore/6ad7233f000000000c00fe24?xsec_token=ABvvJ23oTn68bAeFLKewnzZxSOlK6SIKIDY2iuOoCojbU=&xsec_source=pc_search | 图片 + 视频下载（图文/视频混合能力） | V4/B-16；兼 V2 去后缀素材① | ⬜ 待验 |
| A2 | 小红书 | https://www.xiaohongshu.com/discovery/item/6a065a7a000000003601b78d?source=webshare&xhsshare=pc_web&xsec_token=ABXmuExu05VNDaPIg2iSvW1j4gSFtktkzOlOSNW68-J8M=&xsec_source=pc_share | 图文笔记（去 CDN 后缀取更大图对比：原始地址/去后缀地址/落盘字节/实际分辨率 四项） | **V2/B-02**（ADR-044 真机验证，素材阻塞解除） | ⬜ 待验 |
| A3 | YouTube | https://www.youtube.com/shorts/_XS4l8VivP4 | 单视频下载（Shorts 形态；nsig 解密本机首次真机确认） | **V3/B-13** | ⬜ 待验 |
| A4 | X | https://x.com/NASA | **批量下载 10 个视频和图片**（主页混合媒体批量） | V4/B-16 | ⬜ 待验 |
| A5 | 花瓣网 | https://huaban.com/pins/6293511672?from=similarMaterial | **通用通道验收料**（苏哥定口径 2026-11-05：不做单站适配——有图能单张/批量下载是通用底线能力，花瓣只测这条通道） | 新任务 **V9 通用图/视频通道**（见 BUILD-PLAN-STAGE）；B-19 撤销 | ⬜ 待验 |
| A6 | 抖音 | https://v.douyin.com/8pGobUZIy84/ | 单视频下载（分享短链解析） | V4/B-16 回归 | ⬜ 待验 |
| A7 | 微博 | https://weibo.com/u/5750600479 | **批量下载 10 个图片和视频**（博主主页九宫格+视频混排） | V4/B-16 | ⬜ 待验 |
| A8 | B站 | https://www.bilibili.com/video/BV17Rxm6wEud/?spm_id_from=333.40138.feed-card.all.click | 视频下载（登录态 1080P/多P 场景回归） | V4/B-16 回归 | ⬜ 待验 |
| A9 | Instagram | https://www.instagram.com/neuronvisuals/reel/DeZjO87xrHl/ | reel 视频下载，**无登录态**（苏哥 2026-11-05 提供；B-03 首次可试。IG 未登录有登录墙风险，结果如实记录：能嗅=关闭 B-03 主场景，被墙=记录拦截证据继续挂账号需求） | **V5/B-03**（从"待账号"转为"可试"） | ⬜ 待验 |

**缺口**：V1（AES-128 加密 HLS）未给地址——按 ADR-050 由设计线找公开测试流（Wowza/Netflix test stream 类）登记至此。

## 4. 执行顺序建议（V4/B-16 批次）

按登录态成熟度与风险排：**A2 小红书（顺带关 V2）→ A7 微博批量 → A4 X 批量 → A6 抖音单视频 → A3 YouTube（顺带关 V3）→ A8 B站 → A5+A9 通用通道与 IG**；每验一条回填 §3 结果列 + 截图进 `deliverables/assets/`。

## 5. 设计定位（苏哥原话入档，2026-11-05）

> "花瓣网这种应该是通用适配下载图片的吧？不一定要每个网站都适配吧？**有图片就可以单独下载或者批量，有视频就可以单独下载或者批量。这才是我们设计的意义。**"

**通用优先，专站增强**：嗅探引擎对任何页面的图/视频必须做到单张/批量可下（这是底线，缺陷按 bug 修通道本身，绝不为单站写特例）；单站适配（猫抓式规则）只用于增强体验——页面悬浮按钮、命名模板变量、文件夹归组、防盗链头、防失效取源。新站点诉求先问"通用通道为什么不行"，答不出才立适配任务。
