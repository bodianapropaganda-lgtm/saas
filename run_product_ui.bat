@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo  Regression Graph Product UI
echo ============================================================
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0run_product_ui.ps1"
