@echo off
setlocal

echo [Token Speed] Building frontend...
cd /d "%~dp0frontend"
call npm run build
if errorlevel 1 (
  echo [ERROR] Frontend build failed
  exit /b 1
)

echo.
echo [Token Speed] Packaging desktop app...
cd /d "%~dp0"
python -m PyInstaller token-speed.spec --noconfirm --clean
if errorlevel 1 (
  echo [ERROR] PyInstaller failed
  exit /b 1
)

echo.
echo [Token Speed] Done. Output: dist\TokenSpeed\
echo.
pause
