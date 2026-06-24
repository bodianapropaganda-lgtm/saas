$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'target-app\backend'
$source = Join-Path $backend 'src\main\java\com\example\targetapp\TargetAppServer.java'
$classes = Join-Path $backend 'build\classes'
$config = Join-Path $root 'discovery\target-java.json'
$baseline = Join-Path $root 'baselines\discovery-target-java'
$runV1 = Join-Path $root 'runs\discovery-target-java-v1'
$runV2 = Join-Path $root 'runs\discovery-target-java-v2'
$report = Join-Path $root 'reports\discovery-target-java-v2-report.html'

$pythonCandidates = @(
  'python',
  'py',
  'A:\mssunspot_local_bot_runtime\python\python.exe'
)

$python = $null
foreach ($candidate in $pythonCandidates) {
  try {
    & $candidate --version *> $null
    $python = $candidate
    break
  } catch {
  }
}

if (-not $python) {
  throw 'Python was not found. Install Python 3.10+ or edit this script to point at your interpreter.'
}

New-Item -ItemType Directory -Force -Path $classes | Out-Null
javac -encoding UTF-8 -d $classes $source

Write-Host 'Starting Java target app v1 for discovery...'
$server = Start-Process -FilePath 'java' -ArgumentList @('-cp', $classes, 'com.example.targetapp.TargetAppServer', '--version', 'v1', '--port', '8130') -WorkingDirectory $backend -WindowStyle Hidden -PassThru
try {
  Start-Sleep -Seconds 1
  Push-Location $root
  & $python discover.py discover --config $config --base-url http://127.0.0.1:8130 --out $runV1
  & $python discover.py approve --run $runV1 --baseline $baseline
} finally {
  Pop-Location
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}

Write-Host 'Starting Java target app v2 for discovery...'
$server = Start-Process -FilePath 'java' -ArgumentList @('-cp', $classes, 'com.example.targetapp.TargetAppServer', '--version', 'v2', '--port', '8131') -WorkingDirectory $backend -WindowStyle Hidden -PassThru
try {
  Start-Sleep -Seconds 1
  Push-Location $root
  & $python discover.py discover --config $config --base-url http://127.0.0.1:8131 --out $runV2
  & $python discover.py compare --baseline $baseline --run $runV2 --report $report
  if ($LASTEXITCODE -eq 2) {
    Write-Host 'Compare returned expected discovery regression differences.'
    $global:LASTEXITCODE = 0
  }
} finally {
  Pop-Location
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}

Write-Host "Done. Open: $report"
