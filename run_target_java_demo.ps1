$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'target-app\backend'
$source = Join-Path $backend 'src\main\java\com\example\targetapp\TargetAppServer.java'
$classes = Join-Path $backend 'build\classes'
$scenario = Join-Path $root 'scenarios\target-java.json'
$baseline = Join-Path $root 'baselines\target-java'
$runV1 = Join-Path $root 'runs\target-java-v1'
$runV2 = Join-Path $root 'runs\target-java-v2'
$report = Join-Path $root 'reports\target-java-v2-report.html'

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

Write-Host 'Starting Java target app v1...'
$server = Start-Process -FilePath 'java' -ArgumentList @('-cp', $classes, 'com.example.targetapp.TargetAppServer', '--version', 'v1', '--port', '8120') -WorkingDirectory $backend -WindowStyle Hidden -PassThru
try {
  Start-Sleep -Seconds 1
  Push-Location $root
  & $python regress.py snapshot --scenario $scenario --base-url http://127.0.0.1:8120 --out $runV1
  & $python regress.py approve --run $runV1 --baseline $baseline
} finally {
  Pop-Location
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}

Write-Host 'Starting Java target app v2...'
$server = Start-Process -FilePath 'java' -ArgumentList @('-cp', $classes, 'com.example.targetapp.TargetAppServer', '--version', 'v2', '--port', '8121') -WorkingDirectory $backend -WindowStyle Hidden -PassThru
try {
  Start-Sleep -Seconds 1
  Push-Location $root
  & $python regress.py snapshot --scenario $scenario --base-url http://127.0.0.1:8121 --out $runV2
  & $python regress.py compare --baseline $baseline --run $runV2 --report $report
  if ($LASTEXITCODE -eq 2) {
    Write-Host 'Compare returned expected regression differences.'
    $global:LASTEXITCODE = 0
  }
} finally {
  Pop-Location
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}

Write-Host "Done. Open: $report"
