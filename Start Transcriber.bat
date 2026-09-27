@echo off
title Nico's Transcriber
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed.
  echo  Download the LTS version from https://nodejs.org , install it, then run this again.
  echo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing, this takes a minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :fail
)

echo Starting Nico's Transcriber from source...
call npm run app
exit /b 0

:fail
echo.
echo Something went wrong during setup. Copy the messages above into an issue on GitHub.
pause
exit /b 1
