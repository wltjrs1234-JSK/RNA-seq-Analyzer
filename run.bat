@echo off
if "%1"=="h" goto begin

:: Create temporary VBScript to run this batch file silently
echo Set WshShell = CreateObject("WScript.Shell") > "%temp%\run_silent.vbs"
echo WshShell.Run "cmd.exe /c """"%~f0"" h", 0, False >> "%temp%\run_silent.vbs"
wscript.exe "%temp%\run_silent.vbs"
del "%temp%\run_silent.vbs"
exit /b

:begin
title S. cerevisiae RNA-seq Analyzer Launcher
cd /d "%~dp0"

echo ============================================================
echo   S. cerevisiae RNA-seq Analyzer Launcher (Port: 8500)
echo ============================================================
echo.
echo * [INFO] 백그라운드 서버 종료를 원하시면 'stop.bat'을 실행하세요.
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
    echo [ERROR] Python이 설치되어 있지 않거나 환경 변수 PATH에 등록되지 않았습니다.
    echo https://www.python.org 에서 Python을 다운로드하여 설치해 주세요.
    echo (설치 시 "Add Python to PATH" 항목을 반드시 체크해야 합니다.)
    echo.
    pause
    exit /b 1
)

echo Using Python command: %PYTHON_CMD%
%PYTHON_CMD% --version

:: 2. Check and free port 8500 if occupied
echo Cleaning up port 8500 if occupied...
%PYTHON_CMD% -c "import os, subprocess; lines = subprocess.check_output('netstat -ano', shell=True).decode('utf-8').split('\n'); pids = [line.strip().split()[-1] for line in lines if ':8500' in line and 'LISTENING' in line]; [subprocess.call('taskkill /F /PID ' + pid, shell=True) for pid in set(pids) if pid.isdigit()]" >nul 2>&1

:: 3. Install required library packages
echo Checking and installing Python packages...
%PYTHON_CMD% -m pip install fastapi "uvicorn[standard]" pandas numpy scipy openpyxl xlrd requests urllib3 python-multipart -q
if %errorlevel% neq 0 (
    echo [ERROR] 패키지 설치에 실패했습니다. 인터넷 연결 상태를 확인해 주세요.
    pause
    exit /b 1
)

:: 4. Ensure directories exist
if not exist "data_cache\" mkdir data_cache
if not exist "data\" mkdir data

:: 5. Launch application
echo.
echo ============================================================
echo   대시보드 서버가 http://127.0.0.1:8500 에서 시작됩니다.
echo   잠시 후 크롬 브라우저가 자동으로 실행됩니다.
echo   서버를 중단하려면 이 창에서 [Ctrl + C]를 누르세요.
echo ============================================================
echo.

%PYTHON_CMD% "%~dp0main.py"
if %errorlevel% neq 0 (
    echo Server process exited with code %errorlevel%.
    pause
)
