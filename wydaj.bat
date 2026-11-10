@echo off
setlocal
cd /d "%~dp0"
title Publikowanie wydania Nazuny

echo.
echo   ============================================
echo     Nazuna - budowanie i publikowanie wydania
echo   ============================================
echo.
echo   DROGA AWARYJNA. Zwykle wydanie idzie przez GitHub Actions:
echo   wystarczy wypchnac znacznik wersji, np. v0.1.100.
echo.
echo   Ten plik buduje wydanie na tym komputerze i wysyla gotowy
echo   instalator na GitHuba, do repozytorium nazuna-updates -
echo   stamtad przegladarki juz zainstalowane u ludzi same wykryja
echo   nowa wersje. Do zwyklego budowania testowego sluzy
echo   zbuduj.bat - on niczego nie publikuje.
echo.

rem Token z otoczenia nie moze trafic do skryptow npm ponizej.
set "GH_TOKEN="
set "GITHUB_TOKEN="

where npm >nul 2>nul
if errorlevel 1 (
  echo   BLAD: nie znaleziono Node.js (https://nodejs.org, wersja LTS).
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0github-token.txt" (
  echo   BLAD: brakuje pliku github-token.txt obok wydaj.bat.
  echo.
  echo   Plik ma zawierac (w jednej linii) token GitHub z prawem zapisu
  echo   w repozytorium nazuna-updates. Jest w .gitignore.
  echo.
  pause
  exit /b 1
)

rem Bez certyfikatu electron-builder zbudowalby instalator bez podpisu, a takiego
rem zainstalowane kopie Nazuny nie przyjma: aktualizacje stanelyby dla wszystkich.
if not defined CSC_LINK goto brakcert
if not defined CSC_KEY_PASSWORD goto brakcert

rem Przygotowanie bez tokenu i bez certyfikatu: widza je dopiero kroki, ktore ich
rem potrzebuja, a nie skrypty instalacyjne zaleznosci. Kroki takie same jak w
rem "npm run dist:publish" - przy zmianie tam trzeba zmienic i tutaj.
setlocal
set "CSC_LINK="
set "CSC_KEY_PASSWORD="

echo   [1 z 3] npm ci...
echo.
call npm ci --no-audit --no-fund
rem Bez goto: ten plik ma konce linii LF, a wtedy cmd potrafi nie znalezc etykiety
rem (sprawdzone: wlasnie tu "goto blad" konczylo skrypt bez komunikatu).
if errorlevel 1 (
  echo.
  echo   BLAD: nie udalo sie pobrac skladnikow. Niczego nie opublikowano.
  echo.
  pause
  exit /b 1
)

echo.
echo   [2 z 3] Lista blokera, silnik z obsluga DRM, opis wydania...
echo.
call node tools/build-adblock.js
if errorlevel 1 goto blad
call node tools/pobierz-electron-wv.js
if errorlevel 1 goto blad
call node tools/generuj-notatki-wydania.js
if errorlevel 1 goto blad
endlocal

for /f "usebackq delims=" %%T in ("%~dp0github-token.txt") do set "GH_TOKEN=%%T"
if not defined GH_TOKEN (
  echo   BLAD: plik github-token.txt jest pusty.
  echo.
  pause
  exit /b 1
)

echo.
echo   [3 z 3] electron-builder: instalator + publikacja na GitHubie...
echo.
call "%~dp0node_modules\.bin\electron-builder.cmd" --config electron-builder.config.js --win nsis --publish always
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

:brakcert
echo   BLAD: brakuje certyfikatu podpisujacego. Nie publikuje instalatora
echo   bez podpisu, bo zainstalowane kopie Nazuny by go odrzucily.
echo.
echo   Wydaj przez GitHub Actions, wypychajac znacznik wersji, albo ustaw
echo   zmienne CSC_LINK i CSC_KEY_PASSWORD i uruchom ten plik jeszcze raz.
echo.
pause
exit /b 1

:blad
set "GH_TOKEN="
echo.
echo   ============================================
echo     Budowanie przerwane - szczegoly bledu powyzej.
echo   ============================================
echo.
pause
exit /b 1
