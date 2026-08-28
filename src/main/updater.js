'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

/* Dziennik do diagnozowania automatycznego sprawdzania w terenie - u kogos,
   kogo komputera nie widzimy. Zapisuje sie w folderze danych Nazuny
   (nazuna://about -> "Ta instalacja" -> "Otworz"), plik aktualizacje.log.
   Obejmuje zarowno nasze wlasne zdarzenia (kiedy odpala sie timer, jaki
   wynik), jak i wewnetrzny dziennik samego electron-updatera (dokladnie
   jakie zapytania wysyla i co dostaje w odpowiedzi). */
let logPath = null;
function log(poziom, ...args) {
  try {
    if (!logPath) logPath = path.join(app.getPath('userData'), 'aktualizacje.log');
    const tekst = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${poziom}: ${tekst}\n`);
  } catch (_) { /* dziennik nigdy nie moze wywrocic aplikacji */ }
}

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
  log('info', 'init() start, app.getVersion()=', app.getVersion(), 'dostepny()=', dostepny());

  if (!dostepny()) { ustaw({ status: 'niedostepna' }); return; }

  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    log('error', 'require(electron-updater) nie powiodlo sie:', err && err.message);
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
  // Wlasny dziennik zamiast domyslnego - przekazuje surowy, wewnetrzny log
  // electron-updatera (dokladne URL-e, odpowiedzi, porownania wersji) do
  // tego samego pliku co nasze zdarzenia wyzej.
  autoUpdater.logger = {
    info: (...a) => log('eu:info', ...a),
    warn: (...a) => log('eu:warn', ...a),
    error: (...a) => log('eu:error', ...a),
    debug: (...a) => log('eu:debug', ...a)
  };

  autoUpdater.on('checking-for-update', () => { log('info', 'checking-for-update'); ustaw({ status: 'sprawdzanie', komunikat: null }); });
  autoUpdater.on('update-available', (info) => { log('info', 'update-available', info && info.version); ustaw({ status: 'dostepna', wersja: info.version, komunikat: null }); });
  autoUpdater.on('update-not-available', (info) => { log('info', 'update-not-available, aktualna wersja to', info && info.version); ustaw({ status: 'aktualna', wersja: null, komunikat: null }); });
  autoUpdater.on('download-progress', (p) => ustaw({ status: 'pobieranie', procent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => { log('info', 'update-downloaded', info && info.version); ustaw({ status: 'pobrana', wersja: info.version, komunikat: null }); });
  autoUpdater.on('error', (err) => { log('error', 'error event:', err && (err.stack || err.message)); ustaw({ status: 'blad', komunikat: (err && err.message) || 'Nieznany błąd' }); });

  ustaw({ status: 'gotowa' });
  log('info', 'init() koniec, autoUpdater gotowy');
}

async function sprawdz(zrodlo) {
  log('info', 'sprawdz() wywolane, zrodlo=', zrodlo || '(brak)', 'autoUpdater gotowy=', !!autoUpdater);
  if (!autoUpdater) return stanAktualizacji;
  try {
    const wynik = await autoUpdater.checkForUpdates();
    log('info', 'checkForUpdates() zakonczone, updateInfo.version=', wynik && wynik.updateInfo && wynik.updateInfo.version);
  } catch (err) {
    log('error', 'checkForUpdates() rzucilo wyjatek:', err && (err.stack || err.message));
    ustaw({ status: 'blad', komunikat: err.message });
  }
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

/* Zamyka Nazune, instaluje po cichu (bez okienka instalatora) i sama
   otwiera ja z powrotem - to samo co zainstaluj(), tylko bez widocznego
   okna instalatora, do uzycia automatycznie, zanim uzytkownik cokolwiek
   zobaczy. */
function zainstalujCicho() {
  if (!autoUpdater) return;
  log('info', 'zainstalujCicho(): zamykam, instaluje po cichu i wracam');
  autoUpdater.quitAndInstall(true, true);
}

/* Sprawdzenie tuz przy starcie, zanim pokaze sie okno - tak jak Chrome:
   znajdzie nowa wersje, pobierze ja i zainstaluje, zanim uzytkownik w ogole
   zobaczy przegladarke, a potem otworzy ja juz zaktualizowana. Zwraca true,
   jesli aktualizacja zostala pobrana i wolajacy powinien wywolac
   zainstalujCicho() i nie budowac juz okna w tym uruchomieniu (program i tak
   zaraz sie zamknie i otworzy na nowo). Zwraca false w kazdym innym
   przypadku (brak aktualizacji, blad, albo zwyczajnie zabrako czasu) -
   wtedy program ma ruszyc normalnie, pobieranie leci dalej w tle i
   zainstaluje sie przy nastepnej okazji (patrz autoInstallOnAppQuit). Limit
   czasu jest tylko siatka bezpieczenstwa na wypadek zlego polaczenia -
   nigdy nie chcemy, zeby przegladarka odmowila otwarcia sie przez sam
   problem z siecia. */
function sprawdzPrzedStartem(limitMs) {
  return new Promise((resolve) => {
    if (!autoUpdater) { resolve(false); return; }
    let zakonczone = false;
    const koniec = (zainstalowano) => {
      if (zakonczone) return;
      zakonczone = true;
      clearTimeout(zegar);
      autoUpdater.removeListener('update-downloaded', naPobrana);
      autoUpdater.removeListener('update-not-available', naBrak);
      autoUpdater.removeListener('error', naBlad);
      resolve(zainstalowano);
    };
    const naPobrana = () => { log('info', 'sprawdzPrzedStartem: aktualizacja pobrana przed otwarciem okna'); koniec(true); };
    const naBrak = () => koniec(false);
    const naBlad = () => koniec(false);
    autoUpdater.once('update-downloaded', naPobrana);
    autoUpdater.once('update-not-available', naBrak);
    autoUpdater.once('error', naBlad);
    const zegar = setTimeout(() => {
      log('warn', 'sprawdzPrzedStartem: limit czasu (', limitMs, 'ms) minal, otwieram bez czekania');
      koniec(false);
    }, limitMs);
    sprawdz('start-przed-oknem').catch(() => koniec(false));
  });
}

function stan() { return stanAktualizacji; }

module.exports = { init, sprawdz, pobierz, zainstaluj, zainstalujCicho, sprawdzPrzedStartem, stan, dostepny };
