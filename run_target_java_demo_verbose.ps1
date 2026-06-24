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
$jsonReport = Join-Path $root 'reports\target-java-v2-report.json'
$logsDir = Join-Path $root 'logs'
$logFile = Join-Path $logsDir ('target-java-demo-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

function Log {
  param([string] $Message)
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Message
  Write-Host $line
  Add-Content -Encoding UTF8 -Path $logFile -Value $line
}

function Run-Step {
  param(
    [string] $Title,
    [scriptblock] $Action
  )
  Log ''
  Log "STEP: $Title"
  try {
    & $Action 2>&1 | ForEach-Object {
      Log ('  ' + $_.ToString())
    }
    Log "OK: $Title"
  } catch {
    Log "FAILED: $Title"
    Log $_.Exception.Message
    throw
  }
}

function Find-Python {
  $pythonCandidates = @(
    'python',
    'py',
    'A:\mssunspot_local_bot_runtime\python\python.exe'
  )

  foreach ($candidate in $pythonCandidates) {
    try {
      $version = & $candidate --version 2>&1
      Log "Python candidate found: $candidate ($version)"
      return $candidate
    } catch {
    }
  }

  throw 'Python was not found. Install Python 3.10+ or edit run_target_java_demo_verbose.ps1 to point at your interpreter.'
}

function Stop-Server {
  param($Process)
  if ($null -ne $Process) {
    try {
      Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
      Log "Stopped Java server process PID=$($Process.Id)"
    } catch {
      Log "Could not stop Java server process PID=$($Process.Id): $($_.Exception.Message)"
    }
  }
}

Log 'Full-stack regression MVP demo started.'
Log "Root: $root"
Log "Log file: $logFile"

$python = Find-Python

Run-Step 'Check Java runtime' {
  cmd.exe /c "java -version 2>&1"
}

Run-Step 'Check Java compiler' {
  cmd.exe /c "javac -version 2>&1"
}

Run-Step 'Compile Java backend' {
  New-Item -ItemType Directory -Force -Path $classes | Out-Null
  javac -encoding UTF-8 -d $classes $source
}

$server = $null
Run-Step 'Start target app v1 and create baseline' {
  Log 'Starting Java target app v1 on http://127.0.0.1:8120'
  $script:server = Start-Process -FilePath 'java' -ArgumentList @('-cp', $classes, 'com.example.targetapp.TargetAppServer', '--version', 'v1', '--port', '8120') -WorkingDirectory $backend -WindowStyle Hidden -PassThru
  Log "Started v1 PID=$($script:server.Id)"
  Start-Sleep -Seconds 1
  Push-Location $root
  try {
    & $python regress.py snapshot --scenario $scenario --base-url http://127.0.0.1:8120 --out $runV1
    & $python regress.py approve --run $runV1 --baseline $baseline
  } finally {
    Pop-Location
    Stop-Server $script:server
    $script:server = $null
  }
}

Run-Step 'Start target app v2 and compare with baseline' {
  Log 'Starting Java target app v2 on http://127.0.0.1:8121'
  $script:server = Start-Process -FilePath 'java' -ArgumentList @('-cp', $classes, 'com.example.targetapp.TargetAppServer', '--version', 'v2', '--port', '8121') -WorkingDirectory $backend -WindowStyle Hidden -PassThru
  Log "Started v2 PID=$($script:server.Id)"
  Start-Sleep -Seconds 1
  Push-Location $root
  try {
    & $python regress.py snapshot --scenario $scenario --base-url http://127.0.0.1:8121 --out $runV2
    & $python regress.py compare --baseline $baseline --run $runV2 --report $report
    if ($LASTEXITCODE -eq 2) {
      Log 'Compare returned expected regression differences.'
      $global:LASTEXITCODE = 0
    }
  } finally {
    Pop-Location
    Stop-Server $script:server
    $script:server = $null
  }
}

if (Test-Path $jsonReport) {
  $diffs = Get-Content -Raw -Encoding UTF8 $jsonReport | ConvertFrom-Json
  Log ''
  Log ('Diffs found: ' + $diffs.Count)
  foreach ($diff in $diffs) {
    Log ('  - [' + $diff.severity + '] ' + $diff.checkId + ' / ' + $diff.kind + ': ' + $diff.message)
  }
}

Log ''
Log "HTML report: $report"
Log "JSON report: $jsonReport"
Log "Log file: $logFile"
Log 'Full-stack regression MVP demo finished.'

Write-Host ''
Write-Host '============================================================'
Write-Host 'Done.'
Write-Host "Open report: $report"
Write-Host "Open log:    $logFile"
Write-Host '============================================================'
