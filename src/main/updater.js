'use strict';
const { app } = require('electron');

/* Automatyczne aktualizacje maja sens tylko na spakowanej wersji dla
   Windows - to jedyna platforma, ktora ma instalator NSIS (electron-updater
   podmienia pliki wlasnie przez taki instalator). Wersja portable nie ma
   z czego sie aktualizowac (nie ma gdzie zapisac nowego pliku bez utraty
   danych na pendrivie), a macOS/Linux buduja sie tu jako dir/deb, wiec ich
   tez nie obejmujemy - do zmiany, gdyby te platformy dostaly wlasny target
   z publikacja. */
function dostepny() {
  return app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR;
}

let autoUpdater = null;
let stanAktualizacji = { status: 'niedostepna' };
let nasluchujacy = null;

function ustaw(patch) {
  stanAktualizacji = { ...stanAktualizacji, ...patch };
  if (nasluchujacy) { try { nasluchujacy(stanAktualizacji); } catch (_) {} }
}

/* onZmiana(stan) wywoluje sie przy kazdej zmianie stanu - main.js rozglasza
   to do wszystkich okien, zeby karta nazuna://about mogla pokazac postep. */
function init(onZmiana) {
  nasluchujacy = onZmiana;

  if (!dostepny()) { ustaw({ status: 'niedostepna' }); return; }

  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    ustaw({ status: 'blad', komunikat: 'Modul aktualizacji nie jest dostepny w tej kopii.' });
    return;
  }

  // Tak jak w Chrome czy Firefoksie: znaleziona aktualizacja pobiera sie sama,
  // w tle, bez pytania, a instaluje sie sama przy najblizszym zamknieciu
  // programu - bez wymuszania restartu w trakcie pracy. Karta w rogu okna i
  // przycisk w nazuna://about zostaja, dla kogos kto wolałby zrobic to od
  // razu, ale nie trzeba juz nic klikac, zeby aktualizacja w ogole ruszyla.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => ustaw({ status: 'sprawdzanie', komunikat: null }));
  autoUpdater.on('update-available', (info) => ustaw({ status: 'dostepna', wersja: info.version, komunikat: null }));
  autoUpdater.on('update-not-available', () => ustaw({ status: 'aktualna', wersja: null, komunikat: null }));
  autoUpdater.on('download-progress', (p) => ustaw({ status: 'pobieranie', procent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => ustaw({ status: 'pobrana', wersja: info.version, komunikat: null }));
  autoUpdater.on('error', (err) => ustaw({ status: 'blad', komunikat: (err && err.message) || 'Nieznany błąd' }));

  ustaw({ status: 'gotowa' });
}

async function sprawdz() {
  if (!autoUpdater) return stanAktualizacji;
  try { await autoUpdater.checkForUpdates(); } catch (err) { ustaw({ status: 'blad', komunikat: err.message }); }
  return stanAktualizacji;
}

function pobierz() {
  if (!autoUpdater) return;
  autoUpdater.downloadUpdate().catch((err) => ustaw({ status: 'blad', komunikat: err.message }));
}

function zainstaluj() {
  if (!autoUpdater) return;
  autoUpdater.quitAndInstall(false, true);
}

function stan() { return stanAktualizacji; }

module.exports = { init, sprawdz, pobierz, zainstaluj, stan, dostepny };
