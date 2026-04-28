@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "OLLAMA_HOST=127.0.0.1"
set "OLLAMA_PORT=11434"
set "MODEL=qwen3:14b"
set "WAIT_MAX=25"

echo ==========================================
echo Flowid - Ollama One Click Start
echo ==========================================
echo.

where ollama >nul 2>nul
if errorlevel 1 (
  echo [ERR] ollama command not found.
  echo [HINT] install Ollama first: https://ollama.com/download
  exit /b 21
)

echo [STEP 1/4] Check Ollama port %OLLAMA_PORT%...
netstat -ano | findstr :%OLLAMA_PORT% | findstr LISTENING >nul
if not errorlevel 1 (
  echo [OK ] Ollama already running at %OLLAMA_HOST%:%OLLAMA_PORT%.
) else (
  echo [STEP 2/4] Start Ollama service...
  start "Ollama Serve" cmd /k "ollama serve"
  echo [INFO] New Ollama window started, waiting for port ready...
  powershell -NoProfile -Command "$ok=$false; 1..%WAIT_MAX% | ForEach-Object { if (Get-NetTCPConnection -State Listen -LocalPort %OLLAMA_PORT% -ErrorAction SilentlyContinue) { $ok=$true; break }; Start-Sleep -Seconds 1 }; if (-not $ok) { exit 1 }"
  if errorlevel 1 (
    echo [ERR] Timeout waiting for %OLLAMA_PORT%. Check Ollama window logs.
    exit /b 22
  )
  echo [OK ] Ollama started at %OLLAMA_HOST%:%OLLAMA_PORT%.
)

echo [STEP 3/4] Check model %MODEL%...
ollama list | findstr /I /C:"%MODEL%" >nul
if errorlevel 1 (
  echo [WARN] Model %MODEL% not found locally.
  echo [HINT] Run manually: ollama pull %MODEL%
) else (
  echo [OK ] Model %MODEL% exists.
)

echo [STEP 4/4] Recommended project settings:
echo   provider = ollama
echo   endpoint = http://%OLLAMA_HOST%:%OLLAMA_PORT%/v1/chat/completions
echo   model    = %MODEL%
echo.
echo [DONE] Ollama is ready for Flowid.
exit /b 0
