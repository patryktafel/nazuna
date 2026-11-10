@echo off
setlocal
cd /d "%~dp0"
title Budowanie Nazuny

echo.
echo   ============================================
echo     Nazuna - budowanie instalatora
echo   ============================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo   BLAD: nie znaleziono Node.js (https://nodejs.org, wersja LTS).
  echo.
  pause
  exit /b 1
)

echo   [1 z 3] npm install...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto blad

echo.
echo   [2 z 3] Silnik castLabs (Widevine)...
echo.
call npm run pobierz-silnik
if errorlevel 1 goto blad

echo.
echo   [3 z 3] electron-builder (NSIS)...
echo.
call npx electron-builder --config electron-builder.config.js --win nsis
if errorlevel 1 goto blad

echo.
echo   ============================================
echo     GOTOWE
echo.
echo     Instalator: folder dist
echo   ============================================
echo.
if exist "%~dp0dist" start "" "%~dp0dist"
pause
exit /b 0

:blad
echo.
echo   ============================================
echo     Budowanie przerwane - szczegoly bledu powyzej.
echo   ============================================
echo.
pause
exit /b 1
