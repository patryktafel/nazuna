@echo off
setlocal
cd /d "%~dp0"
title Publikowanie wydania Nazuny

echo.
echo   ============================================
echo     Nazuna - budowanie i publikowanie wydania
echo   ============================================
echo.
echo   Ten plik robi to samo co zbuduj.bat, a na koniec
echo   dodatkowo wysyla gotowy instalator na GitHuba, do
echo   repozytorium nazuna-updates - stamtad przegladarki
echo   juz zainstalowane u ludzi same wykryja nowa wersje.
echo.
echo   Uzywaj go tylko wtedy, gdy naprawde chcesz wypuscic
echo   nowe wydanie. Do zwyklego budowania testowego sluzy
echo   zbuduj.bat - on niczego nie publikuje.
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo   BLAD: nie znaleziono Node.js.
  echo.
  echo   Zainstaluj go ze strony https://nodejs.org
  echo   Wybierz duzy zielony przycisk z napisem LTS.
  echo   Podczas instalacji klikaj Dalej, nic nie zmieniaj.
  echo   Potem zamknij to okno i uruchom wydaj.bat jeszcze raz.
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0github-token.txt" (
  echo   BLAD: brakuje pliku github-token.txt obok wydaj.bat.
  echo.
  echo   Wklej do niego, w jednej linii, token GitHub z uprawnieniem
  echo   do zapisu w repozytorium nazuna-updates - ten sam rodzaj
  echo   tokenu, ktory wczesniej wygenerowales dla mnie. Ten plik
  echo   nie trafia do repozytorium - zostaje tylko na tym komputerze.
  echo.
  pause
  exit /b 1
)
for /f "usebackq delims=" %%T in ("%~dp0github-token.txt") do set "GH_TOKEN=%%T"
if "%GH_TOKEN%"=="" (
  echo   BLAD: plik github-token.txt jest pusty.
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
echo   [3 z 3] Skladam instalator i publikuje wydanie na GitHubie...
echo   To potrwa kilka minut, wliczajac wysylke pliku do internetu.
echo.
call npx electron-builder --config electron-builder.config.js --win nsis --publish always
if errorlevel 1 goto blad

set "GH_TOKEN="

echo.
echo   ============================================
echo     GOTOWE
echo.
echo     Nowe wydanie jest juz na GitHubie. Zainstalowane
echo     kopie Nazuny same je znajda przy nastepnym sprawdzeniu
echo     aktualizacji (Nazuna -^> O programie).
echo.
echo     Instalator lezy tez lokalnie w folderze dist
echo   ============================================
echo.
if exist "%~dp0dist" start "" "%~dp0dist"
pause
exit /b 0

:blad
set "GH_TOKEN="
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
