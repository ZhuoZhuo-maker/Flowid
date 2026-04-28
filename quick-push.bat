@echo off
setlocal EnableExtensions EnableDelayedExpansion
if defined FLOWID_DEBUG echo on
cd /d "%~dp0"

set "EXIT_CODE=0"
set "BRANCH="
set "NO_PAUSE="

if /i "%~1"=="--no-pause" set "NO_PAUSE=1"

echo [STEP 1/5] Detect current branch...
set "BRANCH="
set "BRANCH_FILE=%TEMP%\flowid-branch.txt"
del /q "%BRANCH_FILE%" 2>nul
git branch --show-current 1>"%BRANCH_FILE%" 2>nul
set /p BRANCH=<"%BRANCH_FILE%" 2>nul
del /q "%BRANCH_FILE%" 2>nul
if "%BRANCH%"=="" (
  echo [ERR] Cannot detect git branch.
  echo [HINT] This folder is likely NOT a git repository: missing .git; or git is unavailable.
  echo [HINT] Fix options:
  echo        - Open the REAL cloned repo folder; it should contain a .git directory. Then run again.
  echo        - Alternatively: run "git init" then "git remote add origin YOUR_URL"
  set "EXIT_CODE=11"
  goto :end
)
echo [OK ] Branch: %BRANCH%

echo.
echo [STEP 2/5] Show working tree status...
git status --short

echo.
set /p MSG=Commit message (Enter=chore: update): 
if "%MSG%"=="" set "MSG=chore: update"

echo.
echo [STEP 3/5] Stage changes...
git add .
if errorlevel 1 (
  echo [ERR] git add failed.
  set "EXIT_CODE=12"
  goto :end
)

git diff --cached --quiet
if not errorlevel 1 (
  echo [WARN] No staged changes. Nothing to commit.
  set "EXIT_CODE=0"
  goto :end
)
echo [OK ] Staged.

echo.
echo [STEP 4/5] Commit...
git commit -m "%MSG%"
if errorlevel 1 (
  echo [ERR] git commit failed.
  set "EXIT_CODE=13"
  goto :end
)
echo [OK ] Committed.

echo.
echo [STEP 5/5] Push to origin/%BRANCH%...
git push origin %BRANCH%
if errorlevel 1 (
  echo [ERR] git push failed.
  set "EXIT_CODE=14"
  goto :end
)
echo [OK ] Pushed to origin/%BRANCH%.

:end
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] quick-push finished successfully.
) else (
  echo [DONE] quick-push finished with error code %EXIT_CODE%.
)
if not defined NO_PAUSE (
  echo.
  echo [INFO] Press any key to close...
  pause >nul
)
exit /b %EXIT_CODE%