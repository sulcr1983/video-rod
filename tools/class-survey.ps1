$ErrorActionPreference = 'Stop'
$root = 'D:\test\download\video-rod'

$ui   = Get-Content "$root\js\library\ui.js"   -Raw -Encoding utf8
$html = Get-Content "$root\library.html"       -Raw -Encoding utf8
$lb   = Get-Content "$root\js\library\lightbox.js" -Raw -Encoding utf8

$pattern = 'class="([a-zA-Z][a-zA-Z0-9_\- ]*)"'

$uiCls = [regex]::Matches($ui, $pattern) | ForEach-Object { $_.Groups[1].Value -split ' ' } |
         Where-Object { $_ } | Sort-Object -Unique
$htmlCls = [regex]::Matches($html, $pattern) | ForEach-Object { $_.Groups[1].Value -split ' ' } |
           Where-Object { $_ } | Sort-Object -Unique
$lbCls = [regex]::Matches($lb, $pattern) | ForEach-Object { $_.Groups[1].Value -split ' ' } |
         Where-Object { $_ } | Sort-Object -Unique

Write-Output ("ui.js 动态 class  : {0}" -f $uiCls.Count)
Write-Output ("library.html     : {0}" -f $htmlCls.Count)
Write-Output ("lightbox.js      : {0}" -f $lbCls.Count)
Write-Output ""
Write-Output "--- ui.js 前 40 个 ---"
Write-Output (($uiCls | Select-Object -First 40) -join ', ')
Write-Output ""
Write-Output "--- lightbox.js 前 30 个 ---"
Write-Output (($lbCls | Select-Object -First 30) -join ', ')
