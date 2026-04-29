@echo off
setlocal EnableExtensions
REM This file must stay ASCII-only. UTF-8 Chinese in .bat breaks under cmd (GBK), causes garbled lines and fake "not recognized command" errors.

set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LocalAppData%\Programs\node"

REM Optional if GitHub is blocked: uncomment and set your mirror root (no trailing slash ok)
REM set "YOUMIND_REFERENCES_BASE=https://cdn.jsdelivr.net/gh/YouMind-OpenLab/ai-image-prompts-skill@main/references"

title YouMind prompt export
cd /d "%~dp0" 2>nul
if errorlevel 1 (
  echo [ERROR] Cannot cd to folder of this bat file.
  goto END
)

if not exist "scripts\export-youmind-gpt-image-prompts.mjs" (
  echo [ERROR] Missing: scripts\export-youmind-gpt-image-prompts.mjs
  echo Put this bat in the FLOWID project root ^(same folder as scripts^).
  goto END
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node.exe not found in PATH.
  echo Install Node.js, or open CMD from Start menu, cd here, run:
  echo   node scripts\export-youmind-gpt-image-prompts.mjs
  goto END
)

echo Current dir: %CD%
echo Output: %CD%\exports\youmind-gpt-image-2-prompts
echo Ctrl+C to stop. Options: node scripts\export-youmind-gpt-image-prompts.mjs --help
echo.

node "scripts\export-youmind-gpt-image-prompts.mjs"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo [OK] Done. Output: %CD%\exports\youmind-gpt-image-2-prompts
) else (
  echo [FAIL] exit code %RC% - scroll up for node error.
)

:END
if not defined RC set RC=1
echo.
pause
endlocal & exit /b %RC%
