@echo off
chcp 65001 >nul
title S. cerevisiae RNA-seq Analyzer

echo ============================================================
echo   S. cerevisiae RNA-seq Analyzer - 서버 시작
echo ============================================================
echo.

:: Python 설치 확인
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Python이 설치되어 있지 않거나 PATH에 등록되지 않았습니다.
    echo Python 3.8 이상을 설치한 뒤 다시 실행해 주세요.
    pause
    exit /b 1
)

:: 필요 패키지 설치 확인 (없으면 자동 설치)
echo [1/3] 필요 패키지를 확인합니다...
pip show fastapi >nul 2>&1
if %errorlevel% neq 0 (
    echo      FastAPI 패키지를 설치합니다...
    pip install fastapi uvicorn pandas numpy scipy openpyxl xlrd requests urllib3 -q
    if %errorlevel% neq 0 (
        echo [오류] 패키지 설치에 실패했습니다. 인터넷 연결을 확인하세요.
        pause
        exit /b 1
    )
    echo      패키지 설치 완료!
) else (
    echo      패키지 확인 완료.
)

:: data_cache 폴더 생성
echo [2/3] 캐시 디렉토리를 확인합니다...
if not exist "data_cache" (
    mkdir data_cache
    echo      data_cache 폴더 생성 완료.
) else (
    echo      data_cache 폴더 확인 완료.
)

:: 서버 실행
echo [3/3] 서버를 시작합니다...
echo.
echo ============================================================
echo   서버 주소: http://127.0.0.1:8000
echo   브라우저에서 위 주소를 열어 대시보드를 사용하세요.
echo   종료하려면 이 창에서 Ctrl+C 를 누르세요.
echo ============================================================
echo.

:: 잠시 후 브라우저 자동 열기
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:8000"

:: FastAPI 서버 실행
python main.py

echo.
echo 서버가 종료되었습니다.
pause
