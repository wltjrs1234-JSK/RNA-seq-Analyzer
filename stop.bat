@echo off
title Stop S. cerevisiae RNA-seq Analyzer
cd /d "%~dp0"

echo ============================================================
echo   Stopping S. cerevisiae RNA-seq Analyzer Server (Port: 8500)
echo ============================================================
echo.

:: Detect Python
set PYTHON_CMD=none
py --version >nul 2>&1
if %errorlevel% equ 0 (
    set PYTHON_CMD=py
    goto :python_found
)
python --version >nul 2>&1
if %errorlevel% equ 0 (
    set PYTHON_CMD=python
    goto :python_found
)

:python_found
if "%PYTHON_CMD%"=="none" (
    :: Fallback to taskkill by image name if python is not available
    taskkill /F /IM python.exe /T >nul 2>&1
    taskkill /F /IM uvicorn.exe /T >nul 2>&1
    goto :done
)

:: Kill process occupying port 8500 via python
%PYTHON_CMD% -c "import os, subprocess; lines = subprocess.check_output('netstat -ano', shell=True).decode('utf-8').split('\n'); pids = [line.strip().split()[-1] for line in lines if ':8500' in line and 'LISTENING' in line]; [subprocess.call('taskkill /F /PID ' + pid, shell=True) for pid in set(pids) if pid.isdigit()]" >nul 2>&1

:done
echo Server has been successfully stopped.
echo.
pause
