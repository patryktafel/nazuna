/* npm start: Nazuna z kodu (Electron z node_modules) na prawdziwych danych.

   Zainstalowana Nazuna ma wlaczony fuse EnableCookieEncryption - ciasteczka w
   %LOCALAPPDATA%\Nazuna sa szyfrowane kluczem Windows (DPAPI). Electron z npm
   ma ten fuse WYLACZONY, wiec nie umial ich odczytac i po kazdym `npm start`
   uzytkownik byl wylogowany ze wszystkich stron takze w zainstalowanej wersji.
   Tu, przed startem, wlaczamy ten jeden fuse w node_modules/electron (tylko
   tam - nie w electron-wv, z ktorego buduje sie instalator). Po `npm install`
   Electron wraca do stanu z paczki, wiec sprawdzamy to przy kazdym starcie. */
const path = require('path');
const { spawn } = require('child_process');
const { getCurrentFuseWire, flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

const ROOT = path.join(__dirname, '..');
const electron = require('electron'); // sciezka do electron.exe z node_modules
const WLACZONY = '1'.charCodeAt(0);

(async () => {
  try {
    const wire = await getCurrentFuseWire(electron);
    if (wire[FuseV1Options.EnableCookieEncryption] !== WLACZONY) {
      await flipFuses(electron, { version: FuseVersion.V1, resetAdHocDarwinSignature: process.platform === 'darwin', [FuseV1Options.EnableCookieEncryption]: true });
      console.log('[start-dev] wlaczono szyfrowanie ciasteczek w Electronie z npm (jak w zainstalowanej Nazunie)');
    }
  } catch (err) {
    // Np. electron.exe zajety przez dzialajaca wersje z npm. Nie startujemy wtedy
    // bez szyfrowania - to wlasnie wylogowywalo ze wszystkiego.
    console.error('[start-dev] nie udalo sie wlaczyc szyfrowania ciasteczek:', err.message);
    console.error('[start-dev] zamknij Nazune uruchomiona z npm start i sprobuj jeszcze raz.');
    process.exit(1);
  }
  const p = spawn(electron, [ROOT, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: false });
  p.on('exit', (code) => process.exit(code || 0));
})();
