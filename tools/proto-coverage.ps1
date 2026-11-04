$ErrorActionPreference = 'Stop'
$root = 'D:\test\download\video-rod'
$html = Get-Content "$root\library.html" -Raw -Encoding utf8
$proto = Get-Content "$root\deliverables\prototypes\media-library-redesign-v1.html" -Raw -Encoding utf8

$codeIds = [regex]::Matches($html, 'id="(lib[A-Za-z0-9_]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
$protoIds = [regex]::Matches($proto, 'id="([A-Za-z0-9_\-]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique

Write-Output ("library.html ids : {0}" -f $codeIds.Count)
Write-Output ("prototype    ids : {0}" -f $protoIds.Count)
Write-Output ""

$groups = [ordered]@{
  'Options page   ' = @('libOptions','libKpiSizeUnit','libFootOptions')
  'Rename dialog  ' = @('libRenameMask','libRenameInput','libRenameOk','libRenameCancel','libRenameDir','libRenameError')
  'Batch bar      ' = @('libBatchBar','libBatchAll','libBatchClear','libBatchCount','libBatchExit','libBatchTrash')
  'Confirm dialog ' = @('libConfirmMask','libConfirmOk','libConfirmCancel')
  'Overview panel ' = @('libOverview','libOverviewBody','libOverviewToggle')
  'Creator nav    ' = @('libCreatorNav','libCreatorBars','libCreators')
  'Platform stack ' = @('libPlatStack','libPlatLegend','libPlatformSelect')
  'Empty state    ' = @('libEmpty','libEmptyTitle','libEmptyText','libEmptyAction')
  'Trash drawer   ' = @('libTrashDrawer','libTrashList')
  'Context menu   ' = @('libCtxMenu')
}

foreach ($k in $groups.Keys) {
  $hit = @($groups[$k] | Where-Object { $codeIds -contains $_ })
  Write-Output ("{0} code has {1,2} ids : {2}" -f $k, $hit.Count, ($hit -join ', '))
}
