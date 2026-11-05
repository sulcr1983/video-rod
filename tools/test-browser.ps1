# 启动测试浏览器（固定 profile，保住登录态）
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\test-browser.ps1
#   powershell -ExecutionPolicy Bypass -File tools\test-browser.ps1 -Urls "https://x.com/NASA"
#   powershell -ExecutionPolicy Bypass -File tools\test-browser.ps1 -Headless
param(
  [switch]$Headless,
  [string[]]$Urls
)

$ErrorActionPreference = "Stop"
$exe     = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$profile = "D:\test\download\.edge-login-profile"
$ext     = "D:\test\download\video-rod"
$port    = 9480

if (-not (Test-Path $exe)) { throw "找不到 Edge：$exe" }
if (-not (Test-Path $ext)) { throw "找不到扩展目录：$ext" }

# profile 不存在才创建；已存在绝不清空（登录态本体）
if (-not (Test-Path $profile)) {
  New-Item -ItemType Directory -Path $profile -Force | Out-Null
  Write-Host "已创建 profile：$profile"
} else {
  Write-Host "复用 profile：$profile"
}

# 端口已被占用 → 说明已有实例在跑，直接复用，不再启动第二个
$busy = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($busy) {
  Write-Host "端口 $port 已被占用：已有测试实例在跑，直接复用（不新开）"
  exit 0
}

$args = @(
  "--user-data-dir=$profile",
  "--disable-extensions-except=$ext",
  "--load-extension=$ext",
  "--remote-debugging-port=$port",
  "--remote-debugging-address=127.0.0.1",
  "--no-first-run",
  "--no-default-browser-check"
)
if ($Headless) { $args += "--headless=new" } else { $args += "--window-size=1600,1000" }
if ($Urls -and $Urls.Count -gt 0) { $args += $Urls }

Start-Process -FilePath $exe -ArgumentList $args
Start-Sleep -Seconds 5

$ok = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($ok) { Write-Host "已启动，调试端口 $port 在线" }
else { Write-Host "警告：端口 $port 未监听，检查是否有其它 Edge 实例抢占了 profile" }
