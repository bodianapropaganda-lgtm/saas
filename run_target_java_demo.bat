@echo off
setlocal

cd /d "%~dp0"

echo ============================================================
echo  Full-stack regression MVP: Java target app demo
echo ============================================================
echo.
echo This command will:
echo   1. Compile the Java backend
echo   2. Start version v1 and capture a baseline
echo   3. Start version v2 and capture a new snapshot
echo   4. Compare v2 with the baseline
echo   5. Generate an HTML report
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_target_java_demo_verbose.ps1"

set EXIT_CODE=%ERRORLEVEL%
echo.
if "%EXIT_CODE%"=="0" (
  echo Demo finished successfully.
) else (
  echo Demo failed with exit code %EXIT_CODE%.
)
echo.
pause
exit /b %EXIT_CODE%
