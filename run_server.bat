@echo off
title S. cerevisiae RNA-seq Analyzer Launcher
cd /d "%~dp0"

echo ============================================================
echo   S. cerevisiae RNA-seq Analyzer Launcher (Port: 8500)
echo ============================================================
echo.
echo * [INFO] To stop the background server, please run 'stop.bat'.
echo ============================================================
echo.

:: 1. Find working python executable
echo Detecting Python environment...
set PYTHON_CMD=none

where py >nul 2>&1
if not errorlevel 1 set PYTHON_CMD=py
if "%PYTHON_CMD%"=="none" where python >nul 2>&1
if "%PYTHON_CMD%"=="none" if not errorlevel 1 set PYTHON_CMD=python

if "%PYTHON_CMD%"=="none" (
    echo [ERROR] Python is not installed.
    pause
    exit /b 1
)

echo Using Python command: %PYTHON_CMD%
%PYTHON_CMD% --version

:: 2. Check and Setup Virtual Environment (.venv)
if not exist ".venv" %PYTHON_CMD% -m venv .venv

set RUN_PYTHON=.venv\Scripts\python.exe
if not exist ".venv\Scripts\python.exe" set RUN_PYTHON=%PYTHON_CMD%

:: 3. Install required library packages
echo Checking and installing Python packages...
"%RUN_PYTHON%" -m pip install --upgrade pip -q
"%RUN_PYTHON%" -m pip install --upgrade pip -q
"%RUN_PYTHON%" -m pip install fastapi "uvicorn[standard]" pandas numpy scipy openpyxl xlrd requests urllib3 python-multipart -q
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install packages. Please check internet connection.
    pause
    exit /b 1
)

:: 4. Ensure directories exist
if not exist "data_cache" mkdir data_cache
if not exist "data" mkdir data

:: 6. Launch application
echo.
echo ============================================================
echo   Dashboard server starting at http://127.0.0.1:8500
echo   Chrome browser will be launched automatically soon.
echo   To stop the server, press [Ctrl + C] in this window.
echo ============================================================
echo.

"%RUN_PYTHON%" "%~dp0main.py"
if %errorlevel% neq 0 (
    echo Server process exited with code %errorlevel%.
    pause
)
