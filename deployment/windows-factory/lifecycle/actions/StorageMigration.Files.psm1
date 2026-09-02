Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-StorageTreeEntries {
  param([Parameter(Mandatory = $true)][string]$Root)
  $entries = New-Object 'System.Collections.Generic.List[object]'
  $pending = New-Object 'System.Collections.Generic.Stack[object]'
  $pending.Push([pscustomobject]@{ path = $Root; relativePath = "" })
  while ($pending.Count -gt 0) {
    $directory = $pending.Pop()
    foreach ($item in Get-ChildItem -LiteralPath $directory.path -Force -ErrorAction Stop) {
      $relativePath = if ([string]::IsNullOrEmpty($directory.relativePath)) {
        $item.Name
      } else {
        Join-Path $directory.relativePath $item.Name
      }
      if ($item.PSIsContainer) {
        if ($item.Name -eq ".lifecycle-readiness") { continue }
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        $pending.Push([pscustomobject]@{ path = $item.FullName; relativePath = $relativePath })
        continue
      }
      $entries.Add([pscustomobject]@{ file = $item; relativePath = $relativePath })
    }
  }
  return $entries.ToArray()
}

function Get-StorageTreeSummary {
  param([Parameter(Mandatory = $true)][string]$Root)
  $entries = @(Get-StorageTreeEntries -Root $Root)
  $files = @($entries | ForEach-Object { $_.file })
  $bytes = ($files | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $bytes) { $bytes = [Int64]0 }
  return [pscustomobject]@{ count = $files.Count; bytes = [Int64]$bytes; files = $files; entries = $entries }
}

function Test-StorageTreesEqual {
  param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$Target)
  $sourceSummary = Get-StorageTreeSummary $Source
  $targetSummary = Get-StorageTreeSummary $Target
  if ($sourceSummary.count -ne $targetSummary.count -or $sourceSummary.bytes -ne $targetSummary.bytes) { throw "The copied business files did not match the current data." }
  foreach ($entry in $sourceSummary.entries) {
    $targetFile = Join-Path $Target $entry.relativePath
    if (-not (Test-Path -LiteralPath $targetFile)) { throw "A copied business file is missing." }
    if ((Get-FileHash -LiteralPath $entry.file.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash) { throw "A copied business file did not pass verification." }
  }
  return $true
}

function Copy-StorageTreeVerified {
  param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$Target)
  if (Test-Path -LiteralPath $Target) { throw "The temporary copy location already exists." }
  & robocopy.exe $Source $Target /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ /XD ".lifecycle-readiness" /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Business data could not be copied to the new location." }
  Test-StorageTreesEqual -Source $Source -Target $Target | Out-Null
}

Export-ModuleMember -Function Get-StorageTreeSummary,Test-StorageTreesEqual,Copy-StorageTreeVerified