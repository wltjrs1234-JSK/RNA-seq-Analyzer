@echo off
title S. cerevisiae RNA-seq Analyzer Launcher

:: Force working directory to the batch file location
cd /d "%~dp0"

echo ============================================================
echo   S. cerevisiae RNA-seq Analyzer Launcher
echo ============================================================
echo.

:: 1. Check and free port 8000 if occupied
echo Checking port 8000 status...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do (
    if not "%%a"=="" (
        echo Found existing process %%a on port 8000. Terminating...
        taskkill /F /PID %%a >nul 2>&1
    )
)

:: 2. Find working python executable
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
