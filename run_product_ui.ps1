$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
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

function Test-PortAvailable {
  param([int]$Port)
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) {
      $listener.Stop()
    }
  }
}

$port = $null
foreach ($candidate in 8765..8775) {
  if (Test-PortAvailable -Port $candidate) {
    $port = $candidate
    break
  }
}

if (-not $port) {
  throw 'No free local port found in range 8765..8775.'
}

$url = "http://127.0.0.1:$port"
Write-Host "Starting Regression Graph Product UI on $url"
Start-Process $url
Push-Location $root
try {
  & $python product_server.py $port
} finally {
  Pop-Location
}
