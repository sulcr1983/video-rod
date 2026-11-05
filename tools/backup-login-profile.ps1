# 备份测试浏览器登录态（Cookies / Login Data / Web Data / Local State）
# 建议在浏览器关闭后执行；运行中执行会跳过被锁定的文件（不会破坏原文件）
param(
  [string]$Profile = "D:\test\download\.edge-login-profile"
)

$ErrorActionPreference = "Continue"
if (-not (Test-Path $Profile)) { throw "profile 不存在：$Profile" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dst = "D:\test\download\.edge-login-profile-backup-$stamp"
New-Item -ItemType Directory -Path $dst -Force | Out-Null

$files = @(
  "Local State",
  "Default\Network\Cookies",
  "Default\Network\Cookies-journal",
  "Default\Login Data",
  "Default\Login Data For Account",
  "Default\Web Data",
  "Default\Preferences"
)

$ok = 0; $skip = 0
foreach ($f in $files) {
  $src = Join-Path $Profile $f
  if (-not (Test-Path $src)) { continue }
  $target = Join-Path $dst $f
  $dir = Split-Path $target -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  try {
    Copy-Item -LiteralPath $src -Destination $target -Force -ErrorAction Stop
    $ok++
  } catch {
    $skip++
    Write-Host "跳过（被占用）：$f"
  }
}

# 记录 UA / 版本，便于回滚时对齐
$verFile = Join-Path $dst "_meta.txt"
"backup_at=$stamp`r`nprofile=$Profile`r`ncopied=$ok`r`nskipped=$skip" | Set-Content -Path $verFile -Encoding UTF8

Write-Host "备份完成：$dst（成功 $ok，跳过 $skip）"
Write-Host "提示：关闭浏览器后再跑一次，可拿到完整 Cookies。"
