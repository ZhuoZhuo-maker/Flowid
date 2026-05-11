@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"

REM ---------- 首次运行：从示例生成你的私有配置（已生成则跳过）----------
if not exist "%~dp0pack-flowid-user-config.bat" (
  echo.
  echo [首次打包] 正在从示例创建 pack-flowid-user-config.bat ...
  copy /Y "%~dp0pack-flowid-user-config.bat.example" "%~dp0pack-flowid-user-config.bat" >nul
  echo 已创建。请把里面的 YOUR_SERVER_URL_HERE 改成你的真实后端地址，保存后关掉记事本，再重新双击本脚本。
  echo.
  start "" notepad "%~dp0pack-flowid-user-config.bat"
  pause
  exit /b 0
)

call "%~dp0pack-flowid-user-config.bat"

echo ==========================================
echo Flowid 桌面端 · 内测版 一键打包
echo ==========================================
echo 工作目录: %APP_DIR%
echo 将内置后端: %FLOWID_PUBLIC_SERVER%
echo.

if "%FLOWID_PUBLIC_SERVER%"=="" (
  echo [错误] pack-flowid-user-config.bat 里未设置 FLOWID_PUBLIC_SERVER。
  pause
  exit /b 1
)
echo.%FLOWID_PUBLIC_SERVER%| findstr /I "YOUR_SERVER_URL_HERE" >nul
if not errorlevel 1 (
  echo [错误] 请编辑 pack-flowid-user-config.bat，把 YOUR_SERVER_URL_HERE 换成真实地址后再打包。
  pause
  exit /b 1
)
echo 正在构建（会注入 VITE 环境变量，可能需要几分钟）...
echo.

call npx cross-env "VITE_FLOWID_PUBLIC_SERVER_ORIGIN=%FLOWID_PUBLIC_SERVER%" "VITE_LICENSE_API_URL=%FLOWID_PUBLIC_SERVER%/pts" "VITE_FLOWID_EXCHANGE_GROUP_QQ=%FLOWID_EXCHANGE_GROUP_QQ%" npm run desktop:build:deliverables
if errorlevel 1 (
  echo.
  echo [错误] 构建失败，请看上方日志。
  pause
  exit /b 1
)

echo.
echo [完成] 安装包已生成，目录：
echo     %APP_DIR%\deliverables\
echo 请将 deliverables 文件夹内安装程序发给内测用户（已标注内测版）。
echo.
start "" "%APP_DIR%\deliverables"
pause
exit /b 0
