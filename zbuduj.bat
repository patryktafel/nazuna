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
  echo   BLAD: nie znaleziono Node.js.
  echo.
  echo   Zainstaluj go ze strony https://nodejs.org
  echo   Wybierz duzy zielony przycisk z napisem LTS.
  echo   Podczas instalacji klikaj Dalej, nic nie zmieniaj.
  echo   Potem zamknij to okno i uruchom zbuduj.bat jeszcze raz.
  echo.
  pause
  exit /b 1
)

echo   [1 z 3] Pobieram skladniki. Pierwszy raz potrwa kilka minut...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto blad

echo.
echo   [2 z 3] Pobieram silnik z obsluga DRM...
echo.
call npm run pobierz-silnik
if errorlevel 1 goto blad

echo.
echo   [3 z 3] Skladam instalator Nazuny. To potrwa kilka minut...
echo.
call npx electron-builder --config electron-builder.config.js --win nsis
if errorlevel 1 goto blad

echo.
echo   ============================================
echo     GOTOWE
echo.
echo     Instalator Nazuny lezy w folderze dist
echo   ============================================
echo.
if exist "%~dp0dist" start "" "%~dp0dist"
pause
exit /b 0

:blad
echo.
echo   ============================================
echo     Cos poszlo nie tak.
echo.
echo     Zrob zrzut ekranu tego okna razem z tekstem
echo     powyzej i wyslij mi go.
echo   ============================================
echo.
pause
exit /b 1
