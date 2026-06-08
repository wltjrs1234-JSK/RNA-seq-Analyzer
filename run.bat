@echo off
chcp 65001 >nul
title S. cerevisiae RNA-seq Analyzer

:: ───────────────────────────────────────────────────────────────
::  bat 파일이 있는 폴더를 항상 작업 디렉토리로 설정
:: ───────────────────────────────────────────────────────────────
cd /d "%~dp0"

echo.
echo  ============================================================
echo    S. cerevisiae RNA-seq Analyzer
echo    서버를 시작합니다...
echo  ============================================================
echo.

:: ── Python 설치 확인 ──
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [오류] Python 이 설치되지 않았거나 PATH 에 없습니다.
    echo         https://www.python.org 에서 Python 3.8 이상을 설치하세요.
    echo.
    pause
    exit /b 1
)

:: ── 필수 패키지 자동 설치 ──
echo  [1/3] 필수 패키지 확인 중...
pip show fastapi >nul 2>&1
if %errorlevel% neq 0 (
    echo        fastapi 가 없습니다. 패키지를 설치합니다 (첫 실행 시 수 분 소요)...
    pip install fastapi "uvicorn[standard]" pandas numpy scipy openpyxl xlrd requests urllib3 python-multipart -q
    if %errorlevel% neq 0 (
        echo  [오류] 패키지 설치 실패 - 인터넷 연결을 확인하세요.
        pause
        exit /b 1
    )
    echo        설치 완료!
) else (
    echo        패키지 OK.
)

:: ── data_cache 폴더 보장 ──
echo  [2/3] 캐시 폴더 확인 중...
if not exist "data_cache\" mkdir data_cache
echo        OK.

:: ── 브라우저 자동 실행 (3초 후) ──
echo  [3/3] 서버 기동 중...
echo.
echo  ============================================================
echo    주소 :  http://127.0.0.1:8000
echo    종료 :  이 창에서  Ctrl+C  를 누르세요.
echo  ============================================================
echo.

start "" cmd /c "timeout /t 3 /nobreak >nul & (start chrome http://127.0.0.1:8000 || start http://127.0.0.1:8000)"

:: ── FastAPI 서버 실행 ──
python main.py

echo.
echo  서버가 종료되었습니다.
pause
