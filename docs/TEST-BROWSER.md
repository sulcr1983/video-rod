# 测试浏览器 · 登录态保全规则（TEST-BROWSER v1.1）

> 苏哥 2026-11-05 明确要求：**登录态要保住，测试很多次，不能每次新开无登录态**（反复登录会触发风控）。
>
> **v1.1 追加（同日，风控事故后）**：测试**不许反复开关浏览器**。一次开起来，所有套件跑完，实例留着继续用。违反此条会直接触发站点风控。

## 零、风控铁律（EL 系列，优先级最高）

| 编号 | 铁律 | 落地手段 |
|---|---|---|
| EL-01 | 同一时刻只允许**一个**测试实例（固定 profile + 固定端口 9480） | `vr-session.py` 端口探测，在线即复用 |
| EL-02 | 两次**启动**之间强制冷却 240 秒 | `vr-session.py` 拒绝并提示剩余秒数 |
| EL-03 | 每日启动上限 6 次 | 超限直接拒绝，要求合并批次 |
| EL-04 | 每次启动记档（时间/原因）可审计 | `deliverables/test-runs/session-log.json` |
| EL-05 | **跑完不关浏览器**，留着下一批复用 | `e2e-all.py` 默认不关，只有 `--close` 才关 |
| EL-06 | 真实站点套件默认不跑，显式 `--live` 才跑；站点间强制 20-35s 随机间隔 | `e2e-all.py` 节流 |
| EL-07 | 同一站点只访问一次；不在套件内反复刷新 | 套件内 URL 固定，禁止轮询刷新 |
| EL-08 | 启动进程必须**脱离调用方的 job object**，否则实例会在命令结束后 30-60 秒被静默回收 | `vr-session.py` 用 WMI `Win32_Process.Create` 拉起，不用 `Popen` / `Start-Process` |

**唯一正确姿势**（两条命令走完一天）：

```bash
python tools/e2e-all.py --reason "说明这次测什么"     # 一次开实例 → 跑完全部离线套件 → 实例留着
python tools/e2e-all.py --live --reason "补真实站点"   # 复用同一实例，只多跑 live 套件
```

临时查状态 / 真要关：

```bash
python tools/vr-session.py status
python tools/vr-session.py close      # 只在收工时用
```

`vr-session.py` 是最底层闸门，直接调 `test-browser.ps1` 会绕过冷却与配额，**不要用**。

## 一、固定 profile（唯一真源）

| 项 | 值 |
|---|---|
| profile 目录 | `D:\test\download\.edge-login-profile` |
| 扩展目录 | `D:\test\download\video-rod` |
| 调试端口 | `9480`（固定） |
| Cookies 位置 | `<profile>\Default\Network\Cookies` |

**所有需要登录态的测试（V2/V4/V5/V9、A1-A9）必须用这个 profile，不得新建、不得删除。**

## 二、铁律（出现即返工）

1. **禁止 `rm -rf .edge-login-profile`**——这是登录态本体。
2. **禁止换 profile 名**——换名等于重新登录一次。
3. **同一 profile 只能单实例**——浏览器开着时再启动会"交接退出"，端口不绑定；要么复用已开的，要么先优雅关闭。
4. **优先优雅关闭**（`Browser.close` / 正常关窗），让 Cookie 落盘；`Stop-Process -Force` 可能丢未落盘的会话 Cookie。
5. **headless 自动化可以用同一 profile，但必须先关掉有头实例**（锁冲突）。
6. 临时 profile（`.edge-r*`）只用于**不需要登录**的界面回归；不要用它跑真实站点。

## 三、工具

### 启动（登录用，有头）
```powershell
powershell -ExecutionPolicy Bypass -File tools\test-browser.ps1 -Urls "https://x.com/NASA","https://weibo.com/u/5750600479"
```
不带 `-Urls` 则只开空白窗口；扩展自动加载；profile 不存在时才创建（不会清空）。

### 优雅关闭（保 Cookie）
```bash
python tools/test-browser-close.py
```

### 备份登录态（浏览器关闭后执行）
```powershell
powershell -ExecutionPolicy Bypass -File tools\backup-login-profile.ps1
```
输出到 `D:\test\download\.edge-login-profile-backup-<时间戳>\`（Cookies / Login Data / Web Data / Local State）。

## 四、当前状态（2026-11-05 11:26）

- 实例在线：Edge 156.0.4314.58，端口 9480，11 个页签（9 条测试链接 + 资源库 + 设置页）
- profile 体积约 668 MB
- Cookies 文件存在

## 五、自动化测试怎么用登录态（v1.1 改写）

> 旧的「关掉→headless 起→跑一个脚本→关掉」流程**已废止**，那就是风控的元凶。

**正确流程**：一个实例跑完全部套件，实例常驻。

```bash
python tools/e2e-all.py --reason "全量回归"          # 首次：启动一次，跑完不关
python tools/e2e-all.py --only e2e-buttons          # 补测单个：复用在线实例，0 次启动
python tools/e2e-all.py --live --reason "真实站点验收"  # 真实站点：复用实例 + 站间节流
python tools/vr-session.py status                   # 随时看：在线状态 / 今日启动次数 / 冷却剩余
```

**为什么不用 headless**：有头实例能同时用于截图取证和人工核对；headless 与有头抢同一 profile 必须先关有头，等于多一次开关。日常回归统一走有头，实例留着。

## 归档目录前置检查（2026-11-05 新增）

**症状**：`chrome.downloads.download` 带子目录时永远 `in_progress`（headless 下 `USER_CANCELED`），不带子目录正常。

**真因**：`D://personal//Downloads//video-rod` 曾是指向 `F://download//video-rod` 的**悬空软链**（F 盘已不存在）。Chrome 写不进软链目录，下载直接挂住。

**结论**：Chrome/Edge 的子目录下载本身没问题（实测多级目录 + 中文 + 空格都 OK）。归档目录必须是**真实目录**，不能是软链/网盘占位。

**下次排查顺序**：
1. `ls -la "$DOWNLOADS/video-rod"` 看是不是 `->` 软链
2. 目标盘还在不在（本例 F 盘已没）
3. 确认真实目录后再测

跑法：`python tools/download-path-test.py --port <调试端口>`（10 条断言）

## 故障档案：实例「起来又消失」（2026-11-05）

**症状**：会话闸门显示"在线且稳定"，但 30-60 秒后端口变 `TimeWait`，后续套件全部 `ConnectionRefused`；已跑过的套件表现为页面白底、`VRDB is not defined`、`document.title` 返回 URL 等一串**假失败**。

**根因**：命令执行环境把子进程收进 job object，父命令一结束就整组回收。`subprocess.Popen(DETACHED_PROCESS)` 与 `Start-Process` 两种拉起方式都在这个 job 内，撑不过命令边界。（以前的测试脚本没暴露这个问题，是因为它们一直在同一条命令内「起→测→杀」。）

**修复**：改用 WMI `Win32_Process.Create`（父进程是 WmiPrvSE 服务，不在调用方 job 内），可跨命令常驻。实测 15:00 起实例，连续多批套件复用，全程 0 次重启。

**判别顺序（重要）**：批次里出现 `VRDB is not defined` / 白底 / title 是 URL → **先查实例在线状态**，不要急着改代码。曾据此误判过一次，实际代码 19/19 全绿。
