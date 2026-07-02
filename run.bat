@echo off
echo Set WshShell = CreateObject("WScript.Shell") > "%temp%\run_silent.vbs"
echo WshShell.Run Chr(34) ^& "%~dp0run_server.bat" ^& Chr(34), 0, False >> "%temp%\run_silent.vbs"
wscript.exe "%temp%\run_silent.vbs"
del "%temp%\run_silent.vbs"

:: Wait briefly for FastAPI backend startup
timeout /t 2 /nobreak >nul

:: Launch default web browser to the dashboard URL
start http://127.0.0.1:8500
exit /b
