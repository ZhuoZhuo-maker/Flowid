@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"

REM First run: create pack-flowid-user-config.bat from example
if not exist "%~dp0pack-flowid-user-config.bat" (
  echo.
  echo [pack] Creating pack-flowid-user-config.bat from example ...
  copy /Y "%~dp0pack-flowid-user-config.bat.example" "%~dp0pack-flowid-user-config.bat" >nul
  echo [pack] Edit FLOWID_PUBLIC_SERVER in that file, save, then run this script again.
  echo.
  start "" notepad "%~dp0pack-flowid-user-config.bat"
  pause
  exit /b 0
)

call pack-flowid-user-config.bat
cd /d "%~dp0"

set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"

echo ==========================================
echo Flowid desktop pack (internal test build)
echo ==========================================
echo Work dir: %APP_DIR%
echo Public server: %FLOWID_PUBLIC_SERVER%
echo Local gallery (bundled presets + inspiration): %FLOWID_LOCAL_GALLERY%
echo.

if "%FLOWID_PUBLIC_SERVER%"=="" (
  echo [ERR] Set FLOWID_PUBLIC_SERVER in pack-flowid-user-config.bat
  pause
  exit /b 1
)
echo.%FLOWID_PUBLIC_SERVER%| findstr /I "YOUR_SERVER_URL_HERE" >nul
if not errorlevel 1 (
  echo [ERR] Replace YOUR_SERVER_URL_HERE in pack-flowid-user-config.bat with your real URL.
  pause
  exit /b 1
)
if not exist "node_modules\.bin\cross-env.cmd" (
  echo [ERR] Missing node_modules\.bin\cross-env.cmd - run: npm install
  pause
  exit /b 1
)

if "%FLOWID_LOCAL_GALLERY%"=="1" (
  REM Gallery export: default local Auth (npm run auth:dev). Cloud URL stays in FLOWID_PUBLIC_SERVER for the built app only.
  if not defined FLOWID_EXPORT_GALLERY_BASE set "FLOWID_EXPORT_GALLERY_BASE=http://127.0.0.1:3721"
  echo [pack] Local gallery ON: syncing public/flowid-bundled from local Auth ...
  echo [pack] FLOWID_EXPORT_GALLERY_BASE=%FLOWID_EXPORT_GALLERY_BASE%
  echo [pack] (Start auth on this machine first, e.g. npm run auth:dev)
  node scripts/export-flowid-bundled-gallery.mjs
  if errorlevel 1 (
    echo.
    echo [ERR] export-flowid-bundled-gallery failed. Start local Auth at 127.0.0.1:3721 or set FLOWID_EXPORT_GALLERY_BASE in pack-flowid-user-config.bat
    pause
    exit /b 1
  )
  echo.
)

echo [pack] Building (VITE env inject). This may take several minutes ...
echo.

call "node_modules\.bin\cross-env.cmd" "VITE_FLOWID_PUBLIC_SERVER_ORIGIN=%FLOWID_PUBLIC_SERVER%" "VITE_LICENSE_API_URL=%FLOWID_PUBLIC_SERVER%/pts" "VITE_FLOWID_EXCHANGE_GROUP_QQ=%FLOWID_EXCHANGE_GROUP_QQ%" "VITE_FLOWID_LOCAL_GALLERY=%FLOWID_LOCAL_GALLERY%" npm run desktop:build:deliverables
if errorlevel 1 (
  echo.
  echo [ERR] Build failed. See messages above.
  pause
  exit /b 1
)

echo.
echo [OK] Installer output folder:
echo     %APP_DIR%\deliverables\
echo.
start "" "%~dp0deliverables"
pause
exit /b 0
