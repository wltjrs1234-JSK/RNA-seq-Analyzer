@echo off
title Stop S. cerevisiae RNA-seq Analyzer
cd /d "%~dp0"

echo ============================================================
echo   Stopping S. cerevisiae RNA-seq Analyzer Server (Port: 8500)
echo ============================================================
echo.

:: Kill process occupying port 8500 via PowerShell
echo * [INFO] Terminating all background servers running on port 8500...
powershell -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 8500 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

:done
echo Server has been successfully stopped.
echo.
pause
