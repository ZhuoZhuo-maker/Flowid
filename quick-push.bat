@echo off
setlocal EnableExtensions EnableDelayedExpansion
if defined FLOWID_DEBUG echo on
cd /d "%~dp0"

set "EXIT_CODE=0"
set "BRANCH="
set "NO_PAUSE="
set "REMOTE_URL=git@gitee.com:zhuozhuo1786449/flowid-v2.0.git"
set "AUTO_MSG="
set "AUTO_YES="

if /i "%~1"=="--no-pause" set "NO_PAUSE=1"
if /i "%~1"=="--yes" set "AUTO_YES=1"
if /i "%~2"=="--yes" set "AUTO_YES=1"
if /i "%~1"=="--auto" set "AUTO_YES=1"
if /i "%~2"=="--auto" set "AUTO_YES=1"
if /i "%~1"=="--auto" set "AUTO_MSG=1"
if /i "%~2"=="--auto" set "AUTO_MSG=1"

echo [STEP 1/6] Detect current branch...
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
  echo        - Alternatively: run "git init" then add a remote.
  set "EXIT_CODE=11"
  goto :end
)
echo [OK ] Branch: %BRANCH%

echo.
echo [STEP 2/6] Ensure remote origin...
git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo [INFO] origin not set, adding: %REMOTE_URL%
  git remote add origin "%REMOTE_URL%"
) else (
  echo [OK ] origin already set.
)

echo.
echo [STEP 3/6] Show working tree status...
git status --short

echo.
set "MSG="
if defined AUTO_MSG (
  set "MSG=chore: update"
) else (
  set /p "MSG=Commit message (Enter=chore: update): "
  if "%MSG%"=="" set "MSG=chore: update"
)

echo.
echo [STEP 4/6] Stage changes...
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
  goto :push_only
)
echo [OK ] Staged.

echo.
echo [STEP 5/6] Commit...
if not defined AUTO_YES (
  echo [INFO] About to commit with message: %MSG%
)
git commit -m "%MSG%"
if errorlevel 1 (
  echo [ERR] git commit failed.
  set "EXIT_CODE=13"
  goto :end
)
echo [OK ] Committed.

:push_only
echo.
echo [STEP 6/6] Push to origin/%BRANCH%...
git push -u origin %BRANCH%
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