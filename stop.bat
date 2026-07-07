@echo off
:: Last Updated: 2026-07-07 10:35 (Added custom pathway alignment tools, node theme color pickers, duplicate gene badge rendering support, and Ctrl-drawing snaps)
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
