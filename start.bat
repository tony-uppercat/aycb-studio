@echo off
:: ============================================================
::  AYCB Studio v2 - portable launcher
::  Works on any PC. No hardcoded username or Python path.
::  Requires: Python on PATH, Node/npm on PATH, deps installed
::  (see SETUP.md). Place this file in the repo root.
:: ============================================================
setlocal
cd /d "%~dp0"

:: --- Kill anything already on ports 5100 / 5101 ---
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5101 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5100 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 /nobreak >nul

:: --- Backend: FastAPI + uvicorn (--reload is MANDATORY) ---
start "AYCB Backend" cmd /k "cd /d "%~dp0" && python -m uvicorn src.api:app --host 0.0.0.0 --port 5101 --reload"
timeout /t 1 /nobreak >nul

:: --- Frontend: Vite dev server ---
start "AYCB Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

:: --- Open browser after a short wait ---
timeout /t 5 /nobreak >nul
start http://localhost:5100
start http://localhost:5100/review

endlocal
