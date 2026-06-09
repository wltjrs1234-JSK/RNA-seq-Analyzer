@echo off
title S. cerevisiae RNA-seq Analyzer Launcher

:: Force working directory to the batch file location
cd /d "%~dp0"

echo ============================================================
echo   S. cerevisiae RNA-seq Analyzer Launcher
echo ============================================================
echo.

:: 1. Find working python executable
echo Detecting Python environment...
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
    echo [ERROR] Python is not installed or not registered in environment PATH.
    echo Please download and install Python from https://www.python.org
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

echo Using Python command: %PYTHON_CMD%
%PYTHON_CMD% --version

:: 2. Check and free port 8000 if occupied (Using Python to safely parse netstat and taskkill)
echo Cleaning up port 8000...
%PYTHON_CMD% -c "import os, subprocess; lines = subprocess.check_output('netstat -ano', shell=True).decode('utf-8').split('\n'); pids = [line.strip().split()[-1] for line in lines if ':8000' in line and 'LISTENING' in line]; [subprocess.call('taskkill /F /PID ' + pid, shell=True) for pid in set(pids) if pid.isdigit()]" >nul 2>&1

:: 3. Install required library packages
echo Checking and installing packages...
%PYTHON_CMD% -m pip install fastapi "uvicorn[standard]" pandas numpy scipy openpyxl xlrd requests urllib3 python-multipart -q
if %errorlevel% neq 0 (
    echo [ERROR] Package installation failed. Please check your internet connection.
    pause
    exit /b 1
)

:: 4. Ensure data cache directory exists
if not exist "data_cache\" mkdir data_cache

:: 5. Launch application
echo.
echo ============================================================
echo   Server starting at http://127.0.0.1:8000
echo   Dashboard will open in Chrome automatically in a moment.
echo   Press [Ctrl + C] in this window to stop the server.
echo ============================================================
echo.

%PYTHON_CMD% "%~dp0main.py"
if %errorlevel% neq 0 (
    echo Server process exited with code %errorlevel%.
    pause
)
