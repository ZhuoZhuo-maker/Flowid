@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"
set "PORT=5173"
set "EXIT_CODE=0"

echo [STEP 1/3] Stop process on port %PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$items = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; " ^
  "if (-not $items) { Write-Host '[WARN] no listening process found'; exit 0 }; " ^
  "$procIds = $items | Select-Object -ExpandProperty OwningProcess -Unique; " ^
  "foreach ($procId in $procIds) { " ^
  "  Write-Host ('[INFO] kill PID ' + $procId); " ^
  "  try { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Host ('[OK ] killed PID ' + $procId) } catch { Write-Host ('[ERR] failed PID ' + $procId + ': ' + $_.Exception.Message) } " ^
  "}"

echo.
echo [STEP 2/3] Verify port %PORT%...
netstat -ano | findstr :%PORT% | findstr LISTENING >nul
if not errorlevel 1 (
  echo [ERR] Port %PORT% is still in use.
  set "EXIT_CODE=21"
) else (
  echo [OK ] Port %PORT% is free.
)

echo.
echo [STEP 3/3] Finish...
if "%EXIT_CODE%"=="0" (
  echo [DONE] stop-dev finished successfully.
) else (
  echo [DONE] stop-dev finished with error code %EXIT_CODE%.
)
exit /b %EXIT_CODE%
