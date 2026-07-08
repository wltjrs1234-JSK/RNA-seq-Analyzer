@echo off
:: Last Updated: 2026-07-08 11:00 (Hotfixed custom gene add-handler routing integration and Chrome-prioritized launcher)
title S. cerevisiae RNA-seq Analyzer Launcher
cd /d "%~dp0"

echo ============================================================
echo   S. cerevisiae RNA-seq Analyzer Launcher
echo ============================================================
echo.
echo * [INFO] Cleaning up any previous server instances on port 8500...
:: Hybrid port cleanup (netstat + powershell fallback) to prevent port binding conflicts in restricted environment policies
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8500" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
powershell -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 8500 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo * [INFO] Launching background FastAPI server...
echo * [INFO] Checking for SGD cache downloads (this may take a few seconds)...

:: Start run_server.bat minimized, which completely bypasses VBScript security restrictions
start "RNA-seq Analyzer Server" /min "%~dp0run_server.bat"

echo * [INFO] Waiting for server on http://127.0.0.1:8500 to become active...
echo * [INFO] (Timeout: 60 seconds)

:: Precise TCP connection wait loop using PowerShell TcpClient with 60s timeout & ExecutionPolicy Bypass
powershell -ExecutionPolicy Bypass -Command "$timeout = 60; $start = [DateTime]::Now; while ($true) { try { $conn = New-Object System.Net.Sockets.TcpClient('127.0.0.1', 8500); if ($conn.Connected) { $conn.Close(); exit 0; } } catch {} if (([DateTime]::Now - $start).TotalSeconds -gt $timeout) { exit 1; } Start-Sleep -Seconds 1 }"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] FastAPI server was not activated within 60 seconds.
    echo Background server launch failed or internet was disconnected during installation.
    echo.
    echo To manually debug the server state, please run 'run_server.bat' directly.
    echo.
    pause
    exit /b 1
)

echo * [INFO] Server detected! Launching browser...

:: Check if Chrome exists in standard program files path, otherwise use default start
set CHROME_PATH=""
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME_PATH="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME_PATH="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set CHROME_PATH="%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not %CHROME_PATH%=="" (
    echo * [INFO] Chrome detected. Launching Chrome...
    start "" %CHROME_PATH% "http://127.0.0.1:8500"
) else (
    echo * [INFO] Chrome not found. Launching default browser...
    start http://127.0.0.1:8500
)

echo * [SUCCESS] Launcher completed successfully.
echo ============================================================
exit /b
