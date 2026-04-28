@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"

echo ==========================================
echo Flowid Desktop Launcher
echo ==========================================
echo.

echo [STEP 1/4] Check backend service (3721)...
netstat -ano | findstr :3721 | findstr LISTENING >nul
if errorlevel 1 (
  echo [INFO] backend not running, starting one instance...
  start "" /B cmd /c call "%APP_DIR%\tools\run-auth-hidden.bat"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..30 | ForEach-Object { if (Get-NetTCPConnection -State Listen -LocalPort 3721 -ErrorAction SilentlyContinue) { $ok=$true; break }; Start-Sleep -Seconds 1 }; if (-not $ok) { exit 1 }"
  if errorlevel 1 (
    echo [ERR] Backend did not start on 3721.
    pause
    exit /b 1
  )
)
echo [OK ] backend is ready on 3721.

echo.
echo [STEP 2/4] Check web dev server (5173)...
netstat -ano | findstr :5173 | findstr LISTENING >nul
if errorlevel 1 (
  echo [INFO] web dev not running, starting one instance...
  start "" /B cmd /c call "%APP_DIR%\tools\run-web-hidden.bat"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..35 | ForEach-Object { if (Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue) { $ok=$true; break }; Start-Sleep -Seconds 1 }; if (-not $ok) { exit 1 }"
  if errorlevel 1 (
    echo [ERR] Web dev server did not start on 5173.
    pause
    exit /b 2
  )
)
echo [OK ] web dev is ready on 5173.

echo.
echo [STEP 3/4] Launch Electron desktop...
if exist "node_modules\electron\dist\electron.exe" (
  "node_modules\electron\dist\electron.exe" "%APP_DIR%"
) else (
  npx electron "%APP_DIR%"
)
if errorlevel 1 (
  echo [ERR] Electron exited with error.
  pause
  exit /b 3
)

echo.
echo [STEP 4/4] Done.
exit /b 0

