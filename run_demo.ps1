$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$candidates = @(
  'python',
  'py',
  'A:\mssunspot_local_bot_runtime\python\python.exe'
)

$python = $null
foreach ($candidate in $candidates) {
  try {
    if ($candidate -eq 'py') {
      & $candidate --version *> $null
    } else {
      & $candidate --version *> $null
    }
    $python = $candidate
    break
  } catch {
  }
}

if (-not $python) {
  throw 'Python was not found. Install Python 3.10+ or edit run_demo.ps1 to point at your interpreter.'
}

Write-Host "Using Python: $python"

$server = Start-Process -FilePath $python -ArgumentList @('demo_app.py', '--version', 'v1', '--port', '8010') -WorkingDirectory $root -WindowStyle Hidden -PassThru
try {
  Start-Sleep -Seconds 1
  Push-Location $root
  & $python regress.py snapshot --scenario scenarios/demo.json --base-url http://127.0.0.1:8010 --out runs/baseline
  & $python regress.py approve --run runs/baseline --baseline baselines/demo
} finally {
  Pop-Location
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}

$server = Start-Process -FilePath $python -ArgumentList @('demo_app.py', '--version', 'v2', '--port', '8010') -WorkingDirectory $root -WindowStyle Hidden -PassThru
try {
  Start-Sleep -Seconds 1
  Push-Location $root
  & $python regress.py snapshot --scenario scenarios/demo.json --base-url http://127.0.0.1:8010 --out runs/v2
  & $python regress.py compare --baseline baselines/demo --run runs/v2 --report reports/v2-report.html
  if ($LASTEXITCODE -eq 2) {
    Write-Host 'Compare returned expected regression differences.'
    $global:LASTEXITCODE = 0
  }
} finally {
  Pop-Location
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}

Write-Host "Done. Open: $root\reports\v2-report.html"
