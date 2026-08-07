@echo off
cd /d "%~dp0"

echo [Token Speed] Building frontend (tsc -b + vite build)...
cd frontend
call npm run build
if errorlevel 1 (
  echo [Token Speed] Build failed.
  exit /b 1
)
cd ..

echo [Token Speed] Build OK. Starting backend on :8000 (production, no reload)...
start "Token-Speed-Backend" cmd /c "python -m uvicorn backend.main:app --port 8000"

echo [Token Speed] Serving frontend build on :4173 (vite preview)...
start "Token-Speed-Frontend" cmd /c "cd frontend && npm run preview -- --port 4173"

echo.
echo Both services started:
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:4173
echo.
echo Close the terminal windows to stop.
pause
