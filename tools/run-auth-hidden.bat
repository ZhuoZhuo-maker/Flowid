@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."
if not exist "logs" mkdir "logs"
npm run auth:dev > "logs\auth-dev.log" 2>&1
