@echo off
cd /d "%~dp0"

echo [Token Speed] Starting backend...
start "Token-Speed-Backend" cmd /c "python -m uvicorn backend.main:app --reload --port 8000"

echo [Token Speed] Starting frontend...
start "Token-Speed-Frontend" cmd /c "cd frontend && npm run dev"

echo.
echo Both services started:
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:5173
echo.
echo Close the terminal windows to stop.
pause
