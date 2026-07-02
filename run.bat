@echo off
:: Last Updated: 2026-07-03 07:44 (Resolved blurry text by adding high-res HTML text layers and magnet-style Flexbox alignment)
echo Set WshShell = CreateObject("WScript.Shell") > "%temp%\run_silent.vbs"
echo WshShell.Run Chr(34) ^& "%~dp0run_server.bat" ^& Chr(34), 0, False >> "%temp%\run_silent.vbs"
wscript.exe "%temp%\run_silent.vbs"
del "%temp%\run_silent.vbs"

:: Wait briefly for FastAPI backend startup
timeout /t 2 /nobreak >nul

:: Detect Google Chrome location
set "CHROME_PATH="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

:: Launch Google Chrome or fallback to default system browser
if defined CHROME_PATH (
    start "" "%CHROME_PATH%" "http://127.0.0.1:8500"
) else (
    start http://127.0.0.1:8500
)

exit /b
