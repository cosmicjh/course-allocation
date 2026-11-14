@echo off
setlocal
cd /d "%~dp0"
if not exist runtime\installed.txt (
  echo Run setup.cmd first.
  pause
  exit /b 1
)
runtime\python.exe -m tt_solver open
if errorlevel 1 pause
