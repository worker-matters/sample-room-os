param([Parameter(Mandatory = $true)][string]$JobId)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# This is intentionally read-only. Future high-risk actions are separate,
# fixed scripts and are not implemented in LCM-02.
$checks = @(
  [pscustomobject]@{ name = "powershell"; ok = $true; detail = "Runner diagnostic handler is available." },
  [pscustomobject]@{ name = "docker_cli"; ok = [bool](Get-Command docker -ErrorAction SilentlyContinue); detail = "Docker CLI availability was checked without changing containers." }
)
[pscustomobject]@{ jobId = $JobId; ok = (($checks | Where-Object { -not $_.ok }).Count -eq 0); checks = $checks } | ConvertTo-Json -Compress
