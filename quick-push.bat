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

echo [STEP 1/7] Detect current branch...
set "BRANCH="
set "BRANCH_FILE=%TEMP%\flowid-branch.txt"
del /q "%BRANCH_FILE%" 2>nul
call git branch --show-current 1>"%BRANCH_FILE%" 2>nul
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
echo [STEP 2/7] Ensure remote origin...
call git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo [INFO] origin not set, adding: %REMOTE_URL%
  call git remote add origin "%REMOTE_URL%"
) else (
  echo [OK ] origin already set.
)

echo.
echo [STEP 3/7] Show working tree status...
call git status --short

echo.
set "MSG="
if defined AUTO_MSG (
  set "MSG=chore: update"
) else (
  set /p "MSG=Commit message (Enter=chore: update): "
  if "%MSG%"=="" set "MSG=chore: update"
)

echo.
echo [STEP 4/7] Stage changes...
call git add .
if errorlevel 1 (
  echo [ERR] git add failed.
  set "EXIT_CODE=12"
  goto :end
)

call git diff --cached --quiet
if not errorlevel 1 (
  echo [WARN] No staged changes. Nothing to commit.
  set "EXIT_CODE=0"
  goto :push_only
)
echo [OK ] Staged.

echo.
echo [STEP 5/7] Commit...
if not defined AUTO_YES (
  echo [INFO] About to commit with message: %MSG%
)
call git commit -m "%MSG%"
if errorlevel 1 (
  echo [ERR] git commit failed.
  set "EXIT_CODE=13"
  goto :end
)
echo [OK ] Committed.

:push_only
echo.
echo [STEP 6/7] Fetch origin and pull --rebase before push ^(avoids Gitee fetch-first reject^)
rem Nested parentheses + git.cmd on Windows can corrupt ERRORLEVEL; use CALL and flat flow.
call git fetch origin
if errorlevel 1 (
  echo [WARN] git fetch failed; push may still fail. Check network / SSH key / remote URL.
  goto :qp_push
)

call git show-ref --verify --quiet "refs/remotes/origin/%BRANCH%"
if errorlevel 1 (
  echo [INFO] No remote-tracking branch origin/%BRANCH% yet - skipping pull, typical on first push.
  goto :qp_push
)

rem --autostash: temp stash during pull when needed; requires Git 2.14+
call git pull --rebase --autostash origin %BRANCH%
if errorlevel 1 (
  echo [ERR] git pull --rebase failed. Likely merge conflicts or autostash pop conflicts.
  echo [HINT] Run: git status
  echo [HINT] Fix files, then: git add -A
  echo [HINT] Then: git rebase --continue
  echo [HINT] Or abort: git rebase --abort
  set "EXIT_CODE=15"
  goto :end
)
echo [OK ] Local branch rebased onto origin/%BRANCH%.

:qp_push
echo.
echo [STEP 7/7] Push to origin/%BRANCH%...
call git push -u origin %BRANCH%
if errorlevel 1 (
  echo [ERR] git push failed.
  echo [HINT] If you intentionally overwrite remote ^(dangerous^): git push --force-with-lease origin %BRANCH%
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