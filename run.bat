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
echo  [1/2] 필수 패키지 확인 및 자동 설치 중...
pip install fastapi "uvicorn[standard]" pandas numpy scipy openpyxl xlrd requests urllib3 python-multipart -q
if %errorlevel% neq 0 (
    echo  [오류] 패키지 설치 실패 - 인터넷 연결을 확인하세요.
    pause
    exit /b 1
)
echo        패키지 준비 완료.

:: ── data_cache 폴더 보장 ──
echo  [2/2] 캐시 폴더 확인 중...
if not exist "data_cache\" mkdir data_cache
echo        OK.

:: ── FastAPI 서버 실행 ──
echo.
echo  ============================================================
echo    주소 :  http://127.0.0.1:8000
echo    잠시 후 Chrome 브라우저로 대시보드가 자동으로 열립니다.
echo    종료 :  이 창에서  Ctrl+C  를 누르세요.
echo  ============================================================
echo.

python main.py

echo.
echo  서버가 종료되었습니다.
pause
