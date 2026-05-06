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
REM Do not use netstat|findstr :3721 (false positives e.g. port 13721 contains substring :3721). Use exact LocalPort below.
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (@(Get-NetTCPConnection -State Listen -LocalPort 3721 -ErrorAction SilentlyContinue).Count -gt 0) { exit 0 } else { exit 1 }"
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
echo [STEP 2/4] Check web dev server (5173, Vite)...
REM Do not use netstat|findstr :5173 (false positives: e.g. :15173 contains :5173). Use exact LocalPort below.
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (@(Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue).Count -gt 0) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo [INFO] web dev not running, starting one instance...
  echo [INFO] First start may take 1-3 min ^(Vite + native deps^). Waiting for http://127.0.0.1:5173/
  echo [INFO] If this seems stuck, open: "%APP_DIR%\logs\web-dev.log"
  start "" /B cmd /c call "%APP_DIR%\tools\run-web-hidden.bat"
)
REM Always wait for HTTP 200 on Vite (avoids race and wrong netstat positives).
powershell -NoProfile -ExecutionPolicy Bypass -Command "$max=180;$ok=$false;for($i=1;$i -le $max;$i++){try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 4 -ErrorAction Stop;if($r.StatusCode -eq 200){$ok=$true;break}}catch{};if(($i %% 10) -eq 0){Write-Host ('  still waiting Vite HTTP 200: '+$i+'s / '+$max+'s')};Start-Sleep -Seconds 1};if(-not $ok){exit 1}"
if errorlevel 1 (
  echo [ERR] http://127.0.0.1:5173/ did not respond with HTTP 200 within wait window.
  echo [ERR] Read log: "%APP_DIR%\logs\web-dev.log"
  pause
  exit /b 2
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

