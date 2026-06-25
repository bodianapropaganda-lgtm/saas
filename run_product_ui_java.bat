@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "PORT=8765"
set "GLOBAL_TOOLS=C:\codex-tools\regression-graph"
set "GLOBAL_JAVA_HOME=%GLOBAL_TOOLS%\jdk-25"
set "LOCAL_JAVA_HOME=%ROOT%.tools\jdk-25"
set "JAR=%ROOT%backend-java\target\regression-graph-backend-0.1.0.jar"
set "LOG_DIR=%ROOT%logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>nul
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%I"
set "LOG_FILE=%LOG_DIR%\java-ui-%STAMP%.log"

echo [Regression Graph] Java backend launcher
echo [Regression Graph] Root: %ROOT%
echo [Regression Graph] Log: %LOG_FILE%
echo.

if exist "%GLOBAL_JAVA_HOME%\bin\java.exe" (
  set "JAVA_HOME=%GLOBAL_JAVA_HOME%"
) else if exist "%LOCAL_JAVA_HOME%\bin\java.exe" (
  set "JAVA_HOME=%LOCAL_JAVA_HOME%"
)

if defined JAVA_HOME (
  set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"
  set "PATH=%JAVA_HOME%\bin;%PATH%"
) else (
  set "JAVA_EXE=java"
)

if defined JAVA_HOME (
  if not exist "%JAVA_EXE%" (
    echo [ERROR] Java executable was not found:
    echo [ERROR] %JAVA_EXE%
    echo [ERROR] Run install_java_tools.ps1 or install JDK 25.
    echo [ERROR] Log: %LOG_FILE%
    pause
    exit /b 1
  )
) else (
  where java >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Java is not available.
    echo [ERROR] Run install_java_tools.ps1 or install JDK 25.
    echo [ERROR] Log: %LOG_FILE%
    pause
    exit /b 1
  )
)

if not exist "%JAR%" (
  echo [ERROR] Backend jar was not found:
  echo [ERROR] %JAR%
  echo.
  echo Build it once from backend-java:
  echo   mvn -DskipTests package
  echo.
  echo If Maven tries to download dependencies, run it from a terminal with internet access.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$client = [Net.Sockets.TcpClient]::new(); try { $iar = $client.BeginConnect('127.0.0.1', %PORT%, $null, $null); if ($iar.AsyncWaitHandle.WaitOne(500) -and $client.Connected) { Write-Host '[ERROR] Port %PORT% is already busy on 127.0.0.1.'; exit 2 }; exit 0 } finally { $client.Close() }"
if errorlevel 1 (
  echo.
  echo Current listeners for port %PORT%:
  netstat -ano | findstr :%PORT%
  echo.
  echo Close the process that uses port %PORT%, or change PORT in this file.
  pause
  exit /b 1
)

echo [Regression Graph] Java version:
"%JAVA_EXE%" -version
echo.
echo [Regression Graph] Starting Spring Boot on http://127.0.0.1:%PORT%
echo [Regression Graph] Press Ctrl+C to stop.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "& { Set-Location -LiteralPath '%ROOT%backend-java'; & '%JAVA_EXE%' -jar '%JAR%' '--server.port=%PORT%' 2>&1 | Tee-Object -FilePath '%LOG_FILE%' -Append; exit $LASTEXITCODE }"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo [Regression Graph] Process finished with code %EXIT_CODE%.
echo [Regression Graph] Log saved to:
echo %LOG_FILE%

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Java backend stopped with an error. The window will stay open.
  pause
)

exit /b %EXIT_CODE%
