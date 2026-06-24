@echo off
setlocal

cd /d "%~dp0"

echo ============================================================
echo  Autonomous Discovery MVP demo
echo ============================================================
echo.
echo This command will:
echo   1. Compile the Java target app
echo   2. Run discovery against v1 and approve it as baseline
echo   3. Run discovery against v2
echo   4. Compare discovery graphs and generate an HTML report
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_discovery_demo.ps1"

set EXIT_CODE=%ERRORLEVEL%
echo.
if "%EXIT_CODE%"=="0" (
  echo Discovery demo finished successfully.
) else (
  echo Discovery demo failed with exit code %EXIT_CODE%.
)
echo.
pause
exit /b %EXIT_CODE%
