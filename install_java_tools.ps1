param(
  [string]$ToolsDir = ".tools",
  [string]$GlobalToolsDir = "C:\codex-tools\regression-graph"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tools = Join-Path $root $ToolsDir
$downloads = Join-Path $tools "downloads"
$jdkDir = Join-Path $tools "jdk-25"
$mavenDir = Join-Path $tools "apache-maven-3.9.16"

New-Item -ItemType Directory -Force -Path $downloads | Out-Null

function Download-File {
  param(
    [string]$Url,
    [string]$OutFile
  )
  Write-Host "[tools] Downloading $Url"
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
}

function Expand-SingleRootZip {
  param(
    [string]$Zip,
    [string]$Destination,
    [string]$ExpectedName
  )
  $temp = Join-Path $downloads ([System.IO.Path]::GetFileNameWithoutExtension($Zip) + "-extract")
  if (Test-Path $temp) {
    Remove-Item -LiteralPath $temp -Recurse -Force
  }
  if (Test-Path $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $temp | Out-Null
  Expand-Archive -LiteralPath $Zip -DestinationPath $temp -Force
  $rootChild = Get-ChildItem -LiteralPath $temp | Select-Object -First 1
  if (-not $rootChild) {
    throw "Archive $Zip is empty"
  }
  Move-Item -LiteralPath $rootChild.FullName -Destination $Destination
  Remove-Item -LiteralPath $temp -Recurse -Force
  Write-Host "[tools] Installed $ExpectedName to $Destination"
}

$jdkZip = Join-Path $downloads "temurin-jdk-25.zip"
$mavenZip = Join-Path $downloads "apache-maven-3.9.16-bin.zip"

if (-not (Test-Path (Join-Path $jdkDir "bin\java.exe"))) {
  Download-File "https://api.adoptium.net/v3/binary/latest/25/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk" $jdkZip
  Expand-SingleRootZip $jdkZip $jdkDir "Temurin JDK 25"
} else {
  Write-Host "[tools] JDK already installed at $jdkDir"
}

if (-not (Test-Path (Join-Path $mavenDir "bin\mvn.cmd"))) {
  try {
    Download-File "https://dlcdn.apache.org/maven/maven-3/3.9.16/binaries/apache-maven-3.9.16-bin.zip" $mavenZip
  } catch {
    Write-Host "[tools] Primary Maven mirror failed, trying archive.apache.org"
    Download-File "https://archive.apache.org/dist/maven/maven-3/3.9.16/binaries/apache-maven-3.9.16-bin.zip" $mavenZip
  }
  Expand-SingleRootZip $mavenZip $mavenDir "Apache Maven 3.9.16"
} else {
  Write-Host "[tools] Maven already installed at $mavenDir"
}

$globalJdkDir = Join-Path $GlobalToolsDir "jdk-25"
$globalMavenDir = Join-Path $GlobalToolsDir "apache-maven-3.9.16"
New-Item -ItemType Directory -Force -Path $GlobalToolsDir | Out-Null
if (-not (Test-Path (Join-Path $globalJdkDir "bin\java.exe"))) {
  Copy-Item -LiteralPath $jdkDir -Destination $GlobalToolsDir -Recurse -Force
}
if (-not (Test-Path (Join-Path $globalMavenDir "bin\mvn.cmd"))) {
  Copy-Item -LiteralPath $mavenDir -Destination $GlobalToolsDir -Recurse -Force
}

$env:JAVA_HOME = $globalJdkDir
$env:PATH = (Join-Path $globalJdkDir "bin") + ";" + (Join-Path $globalMavenDir "bin") + ";" + $env:PATH
& (Join-Path $globalJdkDir "bin\java.exe") -version
& (Join-Path $globalMavenDir "bin\mvn.cmd") -version
