[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,
  [switch]$Quiet
)

$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot -ErrorAction Stop).Path.TrimEnd('\', '/')
$processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
$devRoots = @(
  $processes | Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -and
    $_.CommandLine.IndexOf($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $_.CommandLine -match '(?i)electron-vite' -and
    $_.CommandLine -match '(?i)(?:^|\s)dev(?:\s|$)'
  }
)

if ($devRoots.Count -eq 0) {
  exit 0
}

$childrenByParent = @{}
foreach ($process in $processes) {
  $parentId = [int]$process.ParentProcessId
  if (-not $childrenByParent.ContainsKey($parentId)) {
    $childrenByParent[$parentId] = [System.Collections.Generic.List[int]]::new()
  }
  $childrenByParent[$parentId].Add([int]$process.ProcessId)
}

$orderedIds = [System.Collections.Generic.List[int]]::new()
$seenIds = [System.Collections.Generic.HashSet[int]]::new()
function Add-ProcessTree {
  param([int]$ProcessId)

  if (-not $seenIds.Add($ProcessId)) {
    return
  }

  if ($childrenByParent.ContainsKey($ProcessId)) {
    foreach ($childId in $childrenByParent[$ProcessId]) {
      Add-ProcessTree -ProcessId $childId
    }
  }

  $orderedIds.Add($ProcessId)
}

foreach ($rootProcess in $devRoots) {
  Add-ProcessTree -ProcessId ([int]$rootProcess.ProcessId)
}

foreach ($processId in $orderedIds) {
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}

$deadline = [DateTime]::UtcNow.AddSeconds(5)
do {
  $remainingIds = @(
    $orderedIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
  )
  if ($remainingIds.Count -eq 0) {
    break
  }
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)

if ($remainingIds.Count -gt 0) {
  Write-Error "Could not stop the existing Travel Agent development process tree: $($remainingIds -join ', ')."
  exit 1
}

if (-not $Quiet) {
  Write-Host "Stopped the existing Travel Agent development instance for $resolvedRoot."
}
