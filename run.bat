@echo off
chcp 65001 >nul
title S. cerevisiae RNA-seq Analyzer Launcher

:: 작업 디렉토리를 이 배치파일이 위치한 폴더로 명시적 강제 이동
cd /d "%~dp0"

set LOG_FILE=startup_error.log
if exist %LOG_FILE% del %LOG_FILE%

echo ============================================================
echo   S. cerevisiae RNA-seq Analyzer Launcher (진단 및 실행)
echo ============================================================
echo.

:: ── [진단 1] 8000번 포트 충돌 확인 및 해제 ──
echo [1/4] 8000번 포트 점유 상태 확인 중...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do (
    if not "%%a"=="" (
        echo      기존에 실행 중인 서버 프로세스(PID: %%a)를 발견했습니다.
        echo      새로운 연결을 위해 해당 프로세스를 종료합니다.
        taskkill /F /PID %%a >nul 2>&1
    )
)
echo      포트 확인 완료 (8000번 포트 준비됨)

:: ── [진단 2] Python 실행 환경 감지 ──
echo [2/4] Python 실행 파일을 탐색 중입니다...
set PYTHON_CMD=none

:: 1. py 명령어 작동 테스트
py --version >nul 2>&1
if %errorlevel% equ 0 (
    set PYTHON_CMD=py
    goto :python_found
)

:: 2. python 명령어 작동 테스트
python --version >nul 2>&1
if %errorlevel% equ 0 (
    :: MS 스토어 가짜 python.exe 우회 확인 (용량이 0이거나 스토어 링크인 경우 필터)
    where python >temp_py_path.txt 2>nul
    set /p PY_PATH=<temp_py_path.txt
    if exist temp_py_path.txt del temp_py_path.txt
    
    :: 실제 설치 폴더 확인
    python -c "import sys; print(sys.prefix)" >nul 2>&1
    if %errorlevel% equ 0 (
        set PYTHON_CMD=python
        goto :python_found
    )
)

:python_found
if "%PYTHON_CMD%"=="none" (
    echo [오류] Python이 컴퓨터에 설치되어 있지 않거나 환경 변수(PATH)에 등록되어 있지 않습니다.
    echo.
    echo ────────────────────────────────────────────────────────
    echo 해결 방법:
    echo 1. https://www.python.org/downloads/ 에 접속하여 최신 Python을 다운로드하세요.
    echo 2. 설치 과정에서 반드시 "Add Python to PATH" (PATH에 추가) 옵션에 체크하세요.
    echo 3. 설치 완료 후 이 창을 닫고 run.bat을 다시 실행하세요.
    echo ────────────────────────────────────────────────────────
    echo.
    echo [진단 정보] 검색 실패 >> %LOG_FILE%
    pause
    exit /b 1
)

echo      사용할 파이썬 명령어: %PYTHON_CMD%
%PYTHON_CMD% --version

:: ── [진단 3] 패키지 라이브러리 검사 및 설치 ──
echo [3/4] 필수 라이브러리 검사 및 자동 설치 중...
%PYTHON_CMD% -m pip install --upgrade pip -q >nul 2>&1

echo      라이브러리 패키지를 다운로드하는 중입니다 (약 30초~1분 소요)...
%PYTHON_CMD% -m pip install fastapi "uvicorn[standard]" pandas numpy scipy openpyxl xlrd requests urllib3 python-multipart >%LOG_FILE% 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [오류] 라이브러리 설치 중 오류가 발생했습니다.
    echo        상세 오류는 폴더 내 '%LOG_FILE%' 파일을 메모장으로 확인해 주세요.
    echo        인터넷 연결 상태나 방화벽/프록시 설정을 확인해야 할 수 있습니다.
    echo.
    pause
    exit /b 1
)
echo      라이브러리 준비 완료.
if exist %LOG_FILE% del %LOG_FILE%

:: ── [진단 4] 캐시 폴더 보장 ──
echo [4/4] 데이터 캐시 폴더 확인 중...
if not exist "data_cache\" mkdir data_cache
echo      준비 완료.

:: ── 서버 기동 ──
echo.
echo ============================================================
echo   서버 기동에 성공했습니다!
echo   주소: http://127.0.0.1:8000
echo   잠시 후 Chrome (또는 기본 웹 브라우저)이 자동으로 열립니다.
echo   서버를 종료하려면 이 창에서 [Ctrl + C]를 누르고 Y를 입력하세요.
echo ============================================================
echo.

%PYTHON_CMD% main.py
if %errorlevel% neq 0 (
    echo.
    echo [경고] 서버 프로세스가 비정상 종료되었습니다 (에러 코드: %errorlevel%).
    pause
)
