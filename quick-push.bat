@echo off
setlocal EnableExtensions EnableDelayedExpansion
if defined FLOWID_DEBUG echo on
cd /d "%~dp0"

rem =============================================================================
rem quick-push.bat — one-click sync to Gitee (origin, current branch)
rem   Double-click (no args): auto message "chore: update", no confirm prompt,
rem   then fetch origin ^<branch^> + rebase --autostash onto origin/^<branch^> + push (avoids "fetch first" reject).
rem   Optional: --no-pause  close window without "Press any key"
rem             --yes / --auto  same as no-arg for message/skip confirm
rem             custom message: quick-push.bat "your message"
rem
rem   Large folders: uses "git add ." which honors .gitignore — release/,
rem   Fetch is per-branch only so rebase does not see multi-branch FETCH_HEAD.
rem   deliverables/, dist/, node_modules/ are not staged. Do not "git add -f"
rem   installers; if something was committed earlier, git rm --cached then commit.
rem =============================================================================

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

rem No arguments (typical double-click): fully non-interactive commit + push
if "%~1"=="" (
  set "AUTO_MSG=1"
  set "AUTO_YES=1"
  echo [INFO] No args: using auto commit message and skip confirm ^(double-click mode^).
)

rem Single --no-pause: same as double-click + close window without keypress
if /i "%~1"=="--no-pause" if "%~2"=="" (
  set "AUTO_MSG=1"
  set "AUTO_YES=1"
  set "NO_PAUSE=1"
  echo [INFO] --no-pause only: auto message, skip confirm, no pause at end.
)

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
echo [STEP 4/7] Stage changes ^(release/ deliverables/ dist/ etc. ignored via .gitignore^)...
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
echo [STEP 6/7] Fetch origin/%BRANCH% and rebase ^(avoids Gitee fetch-first reject^)
rem Fetch only this branch so FETCH_HEAD is single-branch; full "git fetch origin" + pull can hit:
rem   fatal: Cannot rebase onto multiple branches.
call git fetch origin %BRANCH%
if errorlevel 1 (
  echo [WARN] git fetch failed; push may still fail. Check network / SSH key / remote URL.
  goto :qp_push
)

call git show-ref --verify --quiet "refs/remotes/origin/%BRANCH%"
if errorlevel 1 (
  echo [INFO] No remote-tracking branch origin/%BRANCH% yet - skipping rebase, typical on first push.
  goto :qp_push
)

rem --autostash: temp stash during rebase when needed; requires Git 2.14+
call git rebase --autostash origin/%BRANCH%
if errorlevel 1 (
  echo [ERR] git rebase onto origin/%BRANCH% failed. Likely merge conflicts or autostash pop conflicts.
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
  echo [HINT] Gitee: single file in history must be under 100MB. Large installers under deliverables/ must not be in Git.
  echo [HINT] After fixing history locally: git push --force-with-lease origin %BRANCH%
  echo [HINT] See scripts\strip-deliverables-exe-from-history.bat in this repo.
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