@echo off
echo Set WshShell = CreateObject("WScript.Shell") > "%temp%\run_silent.vbs"
echo WshShell.Run """%~dp0run_server.bat""", 0, False >> "%temp%\run_silent.vbs"
wscript.exe "%temp%\run_silent.vbs"
del "%temp%\run_silent.vbs"
exit /b
