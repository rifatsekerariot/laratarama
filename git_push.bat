@echo off
echoARIOT - GitHub Upload Tool
echo ============================

:: Check Git
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Git is not installed!
    pause
    exit /b
)

:: Initialize
if not exist .git (
    echo [INFO] Initializing Git repository...
    git init
)

:: Add Files
echo [INFO] Adding files...
git add .

:: Commit
set /p commitMsg="Enter commit message (default: Initial Commit): "
if "%commitMsg%"=="" set commitMsg="Initial Commit"
git commit -m "%commitMsg%"

:: Remote
echo.
echo [INFO] Please create a repository on GitHub first.
set /p repoUrl="Enter your GitHub Repository URL (e.g., https://github.com/user/ariot.git): "

git remote remove origin >nul 2>&1
git remote add origin %repoUrl%

:: Push
echo [INFO] Pushing to GitHub...
git branch -M main
git push -u origin main

echo.
echo [SUCCESS] Done!
pause
