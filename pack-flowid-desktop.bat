@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"

echo ==========================================
echo Flowid Desktop - one-click pack
echo ==========================================
echo.
echo Working dir: %APP_DIR%
echo Command: npm run desktop:build:deliverables
echo.

call npm run desktop:build:deliverables
if errorlevel 1 (
  echo.
  echo [ERR] Build failed (see messages above).
  pause
  exit /b 1
)

echo.
echo [OK] Done. Installers under:
echo     %APP_DIR%\deliverables\
echo.
start "" "%APP_DIR%\deliverables"
echo Press any key to close this window...
pause >nul
exit /b 0
