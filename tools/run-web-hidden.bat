@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."
if not exist "logs" mkdir "logs"
npm run dev > "logs\web-dev.log" 2>&1
