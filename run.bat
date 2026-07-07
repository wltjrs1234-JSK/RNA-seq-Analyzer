@echo off
:: Last Updated: 2026-07-07 13:33 (Fixed client rendering crash due to missing customGenes declaration, resolved default/custom gene overlay missing and drag-select failures)
title S. cerevisiae RNA-seq Analyzer Launcher
cd /d "%~dp0"

echo ============================================================
echo   S. cerevisiae RNA-seq Analyzer Launcher
echo ============================================================
echo.
echo * [INFO] Cleaning up any previous server instances on port 8500...
powershell -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 8500 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

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

:: Detect Google Chrome location
set "CHROME_PATH="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

:: Launch Google Chrome or fallback to default system browser (Using --new-window and --incognito to bypass persistent caches completely)
if defined CHROME_PATH (
    start "" "%CHROME_PATH%" --new-window --incognito "http://127.0.0.1:8500"
) else (
    start http://127.0.0.1:8500
)

echo * [SUCCESS] Launcher completed successfully.
echo ============================================================
exit /b
