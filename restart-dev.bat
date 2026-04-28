@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=5173"
set "WAIT_MAX=25"
set "EXIT_CODE=0"

echo [STEP 1/4] Stop old process on port %PORT%...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
  echo [INFO] kill PID %%a
  taskkill /PID %%a /F >nul 2>nul
)

echo.
echo [STEP 2/4] Verify port %PORT%...
netstat -ano | findstr :%PORT% | findstr LISTENING >nul
if not errorlevel 1 (
  echo [ERR] Port %PORT% is still in use.
  set "EXIT_CODE=31"
  goto :end
) else (
  echo [OK ] Port %PORT% is free.
)

echo.
echo [STEP 3/4] Start Vite dev server...
start "Flowid Dev Server" powershell -NoExit -Command "Set-Location -LiteralPath '%~dp0'; npm run dev"
echo [OK ] Dev server window started.

echo.
echo [STEP 4/4] Wait for port %PORT% then open browser...
set /a WAIT_COUNT=0
:wait_port
set /a WAIT_COUNT+=1
netstat -ano | findstr :%PORT% | findstr LISTENING >nul
if not errorlevel 1 goto open_browser
if %WAIT_COUNT% GEQ %WAIT_MAX% goto timeout_open_browser
ping 127.0.0.1 -n 2 >nul
goto wait_port

:timeout_open_browser
echo [WARN] Port %PORT% not ready after wait timeout. Open browser anyway.

:open_browser
start "" "http://localhost:5173/"
echo [OK ] Browser open command sent.

:end
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] restart-dev finished successfully.
) else (
  echo [DONE] restart-dev finished with error code %EXIT_CODE%.
)
exit /b %EXIT_CODE%
