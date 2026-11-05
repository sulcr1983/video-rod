# 测试浏览器 · 登录态保全规则（TEST-BROWSER v1.0）

> 苏哥 2026-11-05 明确要求：**登录态要保住，测试很多次，不能每次新开无登录态**（反复登录会触发风控）。

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

## 五、自动化测试怎么用登录态

```bash
# 1) 先优雅关闭有头实例（Cookie 落盘）
python tools/test-browser-close.py
# 2) 用同一 profile 起 headless（带扩展）
powershell -ExecutionPolicy Bypass -File tools\test-browser.ps1 -Headless
# 3) 跑测试脚本
python tools/stage-rewrite-test.py --port 9480
# 4) 测完关掉，下次要用有头再起
python tools/test-browser-close.py
```
