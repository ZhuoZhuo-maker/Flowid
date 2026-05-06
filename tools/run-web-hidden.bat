@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."
if not exist "logs" mkdir "logs"
REM Vite only on 5173. Auth on 3721 is started separately; npm run dev would start a second auth and collide.
npm run dev:vite > "logs\web-dev.log" 2>&1
