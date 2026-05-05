@echo off
setlocal
cd /d "%~dp0.."
echo This removes deliverables\Flowid_v0.0.1_windows_x64_installer\Flowid_v0.0.1.exe from ALL commits.
echo Gitee rejects pushes when any blob in history is over 100MB.
echo After this you MUST: git push --force-with-lease origin master
echo.
echo Press Ctrl+C to cancel, or
pause

set "FILTER_BRANCH_SQUELCH_WARNING=1"
git filter-branch --force --index-filter "git rm --cached --ignore-unmatch deliverables/Flowid_v0.0.1_windows_x64_installer/Flowid_v0.0.1.exe" --prune-empty HEAD
if errorlevel 1 exit /b 1

rmdir /s /q .git\refs\original 2>nul
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo Done. Run: git push --force-with-lease origin master
pause
