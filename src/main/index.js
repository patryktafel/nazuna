'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app, session, dialog, Menu, powerMonitor } = require('electron');
// Wymagane jak najwyzej, zeby zlapac t0 mozliwie najblizej faktycznego
// startu procesu - ale sam pierwszy zapis (znacznik) czeka az nizej, po
// wybraniu folderu danych (chooseProfileDir), inaczej ladowalby do innego
// pliku niz reszta dziennika.
const starttrace = require('./starttrace');

app.setName('Nazuna');

// Wlasny pasek zakladek i przycisk menu zastepuja standardowe menu Electrona -
// bez tego kazde okno mialoby jeszcze gorny pasek z File/Edit/View po angielsku.
Menu.setApplicationMenu(null);

/* Jeden podpis dla calego programu. Electron ma wlasny domyslny User-Agent z
   napisami "Nazuna/x.y" i "Electron/x.y", i wystarczy jeden kanal, ktoremu
   zapomnimy podmienic naglowek, zeby przegladarka sie zdradzila. Do 0.1.5 tak
   wlasnie wychodzily zapytania po ikony stron z paska zakladek. Ustawienie
   fallbacku zalatwia wszystkie kanaly naraz, takze te, o ktorych nie wiemy. */
app.userAgentFallback = require('./constants').chromeUserAgent();

/* ------------------------------------------------------------------ profil
   Wszystko, co przegladarka zapisuje, siedzi w jednym folderze pod
   %LOCALAPPDATA%. Wrzucenie pliku portable.txt obok pliku wykonywalnego
   przenosi ten folder tuz obok niego - o to chodzi na pendrivie. */
(function chooseProfileDir() {
  try {
    const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
    const portableMarker = path.join(exeDir, 'portable.txt');
    if (fs.existsSync(portableMarker)) {
      const dir = path.join(exeDir, 'Nazuna-Data');
      fs.mkdirSync(dir, { recursive: true });
      app.setPath('userData', dir);
      return;
    }
  } catch (_) { /* fall through to the default */ }

  const base = process.env.LOCALAPPDATA
    || (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local') : app.getPath('appData'));
  try {
    const dir = path.join(base, 'Nazuna');
    fs.mkdirSync(dir, { recursive: true });
    app.setPath('userData', dir);
  } catch (_) { /* keep Electron's default if that folder is not writable */ }
})();

starttrace.znacznik('index.js: start (po wybraniu folderu danych)');

const protocolHelper = require('./protocol');
const adblock = require('./adblock');
const downloads = require('./downloads');
const sessions = require('./session');
const ipc = require('./ipc');
const widevine = require('./widevine');
const updater = require('./updater');
const security = require('./security');
const privacy = require('./privacy');
const W = require('./window');
const localFiles = require('./localFiles');

protocolHelper.registerSchemes();

app.setAppUserModelId('com.tafel.nazuna');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

// Ustawienia trzeba wczytac zanim aplikacja bedzie gotowa, bo wylaczenie
// przyspieszenia sprzetowego da sie zrobic tylko na tym etapie.
const data = require('./data');
data.init();
if (!data.settings.get('hardwareAcceleration', true)) app.disableHardwareAcceleration();

/* Argument uruchomienia zamieniony na adres, ktory da sie otworzyc w karcie.
   Zwykly http(s)-owy link przechodzi bez zmian. Lokalny plik .pdf (tak
   wlasnie wyglada argv, gdy ktos w Eksploratorze klika PDF-a skojarzonego
   z Nazuna - patrz build/installer.nsh, ProgId "NazunaPDF") trafia od razu
   do wlasnej przegladarki PDF pod nazuna://pdf - nie ma sensu wpierw
   nawigowac na surowy plik://, skoro i tak zaraz mielibysmy go stamtad
   przekierowac. existsSync to tylko zabezpieczenie przed potraktowaniem
   jakiejs losowej flagi konczacej sie na ".pdf" jako sciezki do pliku. */
function argToStartUrl(arg) {
  if (/^https?:\/\//i.test(arg)) return arg;
  if (/\.pdf$/i.test(arg)) {
    try {
      const pelna = path.resolve(arg);
      if (fs.existsSync(pelna) && fs.statSync(pelna).isFile()) {
        const token = localFiles.zarejestruj(pelna);
        const nazwa = encodeURIComponent(path.basename(pelna));
        return `nazuna://pdf?src=${encodeURIComponent('nazuna-local:' + token)}&name=${nazwa}`;
      }
    } catch (_) { /* nieprawidlowa sciezka - ignorujemy */ }
  }
  return null;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const win = W.focusedWindow() || W.allWindows()[0];
    const url = argv.slice(1).map(argToStartUrl).find(Boolean);
    if (win) {
      if (win.win.isMinimized()) win.win.restore();
      win.win.focus();
      if (url) win.newTab({ url });
    } else {
      W.createWindow({ urls: url ? [url] : [] });
    }
  });

  app.whenReady().then(async () => {
    starttrace.znacznik('app.whenReady');
    // Aktualizacje (tylko spakowana wersja dla Windows - patrz updater.js).
    // Tak jak Chrome: sprawdzamy zanim pokaze sie cokolwiek. Jesli jest nowa
    // wersja, pobieramy ja i instalujemy po cichu, zanim uzytkownik zobaczy
    // przegladarke - a potem program sam otwiera sie juz zaktualizowany.
    // Limit czasu (60s) to tylko siatka bezpieczenstwa: przy zlym polaczeniu
    // przegladarka i tak ma sie otworzyc, aktualizacja doleci pozniej w tle.
    updater.init((stan) => W.broadcastAll('update:status', stan));
    if (updater.dostepny()) {
      starttrace.znacznik('przed sprawdzeniem aktualizacji (limit 60s)');
      const zainstalowano = await updater.sprawdzPrzedStartem(60 * 1000);
      starttrace.znacznik('po sprawdzeniu aktualizacji, zainstalowano=' + zainstalowano);
      if (zainstalowano) {
        updater.zainstalujCicho();
        return; // program zaraz sie zamknie i otworzy na nowo - nie budujemy juz okna
      }
      // Nic nie znaleziono (albo zabraklo czasu) - program rusza normalnie.
      // Regularne sprawdzanie w tle co kilka godzin, dla okna otwartego
      // caly dzien - inaczej samo nigdy by sie nie dowiedzialo o nowej
      // wersji az do nastepnego pelnego restartu.
      setInterval(() => { updater.sprawdz('auto-6h').catch(() => {}); }, 6 * 60 * 60 * 1000);
    }

    /* Przez broadcastAll, zeby dotarlo tez do otwartej karty nazuna://downloads
       (wczesniej dostawal to tylko pasek u gory, a sama strona Pobranych
       stala w miejscu, dopoki ktos jej nie odswiezyl). Pobranie z okna
       prywatnego widza tylko okna prywatne. */
    downloads.setBroadcaster((channel, payload) => {
      W.broadcastAll(channel, payload, payload && payload.prywatne ? (w) => w.isPrivate : null);
    });

    adblock.onCountChanged((webContentsId) => {
      for (const win of W.allWindows()) {
        const active = win.activeTab();
        if (active && !active.wc.isDestroyed() && active.wc.id === webContentsId) win.scheduleSync();
      }
    });

    sessions.setPermissionPrompt(async ({ webContents, permission, origin, strona, osadzona }) => {
      const win = W.allWindows().find((w) => w.tabs.some((t) => t.wc === webContents)) || W.focusedWindow();
      if (!win) return 'deny';
      return win.requestPermission({ permission, origin, strona, osadzona });
    });

    ipc.register();

    /* Sesja domyslna obsluguje interfejs przegladarki, a ten pobiera ikony stron
       do paska zakladek i historii. Do 0.1.5 nikt jej nie przygotowywal, wiec
       te zapytania szly w swiat z oryginalnym User-Agentem Electrona, bez DNT
       i bez blokera. Teraz przechodza tak samo jak reszta ruchu. */
    sessions.forPartition(null);

    // Lista zlosliwych domen - wczytujemy cache z dysku (jesli jest) zanim
    // powstanie pierwsza karta, zeby ochrona dzialala juz od pierwszej
    // nawigacji. Swieza lista z sieci i tak dociagnie sie dopiero w tle.
    security.init();
    privacy.applySecureDns();
    W.startTabSleep();
    W.startDiagnostics();

    /* Po wybudzeniu z uspienia albo odblokowaniu ekranu karta na wierzchu
       potrafi zostac biala, mimo ze nic w niej nie padlo - patrz szerszy
       komentarz przy invalidateActiveTab() w window.js. Fokus okna (patrz
       tam tez) lapie wiekszosc takich przypadkow, ale nie ten, gdy Nazuna
       byla ostatnio aktywnym oknem PRZED usypieniem calego systemu -
       wtedy po powrocie okno nigdy na nowo nie dostaje zdarzenia "focus". */
    powerMonitor.on('resume', () => { for (const win of W.allWindows()) win.invalidateActiveTab(); });
    powerMonitor.on('unlock-screen', () => { for (const win of W.allWindows()) win.invalidateActiveTab(); });
    starttrace.znacznik('po ipc.register/sessions.forPartition/security.init/privacy/tabSleep');

    const startUrls = process.argv.slice(1).map(argToStartUrl).filter(Boolean);
    if (process.env.NAZUNA_START) startUrls.push(...process.env.NAZUNA_START.split('|'));
    const startup = data.settings.get('startup', 'newtab');
    let initial = startUrls;
    if (!initial.length && startup === 'restore') {
      const saved = data.settings.get('restoreSession', null);
      if (Array.isArray(saved) && saved.length) initial = saved;
    }
    if (!initial.length && startup === 'homepage') initial = [data.settings.get('homepage', W.NEW_TAB)];

    starttrace.znacznik('przed createWindow');
    const win = W.createWindow({ urls: initial });
    starttrace.znacznik('po createWindow (okno jeszcze niewidoczne - buduje sie async)');
    sessions.loadExtensions(win.session).catch((err) => console.warn('[ext]', err.message));

    // Modul odszyfrowywania DRM dociaga sie z serwerow Google przy pierwszym
    // uruchomieniu. Nigdy nie blokujemy tym startu: gdy sie nie uda, przegladarka
    // dziala normalnie, tylko bez serwisow z DRM.
    widevine.start();

    // Listy filtrow wczytuja sie rownolegle z otwieraniem okna, zeby start byl
    // szybszy. Sa gotowe zanim pierwsza strona zdazy wyslac zapytania.
    adblock.load()
      .then((ok) => {
        if (!ok) return;
        for (const w of W.allWindows()) adblock.enableFor(w.session);
        adblock.enableFor(session.defaultSession);
      })
      .catch(() => {});

    app.on('activate', () => {
      if (!W.allWindows().length) W.createWindow({});
    });
  });

  // Store.flush() zapisuje teraz asynchronicznie (patrz store.js), zeby duza
  // historia nie zamrazala programu przy zwyklym uzyciu - ale to znaczy, ze
  // przy zamykaniu trzeba poczekac az zapisy naprawde skoncza sie na dysku,
  // zanim proces faktycznie zniknie. stopujemy wiec pierwsze 'before-quit'
  // (event.preventDefault) i wywolujemy app.quit() ponownie, gdy wszystko juz
  // zapisane - flaga 'zamykanie' pilnuje, zeby nie zapetlic tego w kolko.
  let zamykanie = false;
  app.on('before-quit', (event) => {
    if (zamykanie) return;
    try {
      // Okno prywatne moze byc akurat na wierzchu - wtedy bierzemy zwykle.
      const zwykle = W.allWindows().filter((w) => !w.isPrivate);
      const focused = W.focusedWindow();
      const win = focused && !focused.isPrivate ? focused : zwykle[0];
      // Brak zwyklych okien = ostatnie zamkniete juz zapisalo swoje karty.
      if (win) W.zapamietajSesje(win);
    } catch (_) {}
    zamykanie = true;
    event.preventDefault();
    Promise.allSettled([
      data.settings.flush(),
      data.historyStore.flush(),
      data.bookmarksStore.flush(),
      data.downloadsStore.flush(),
      data.siteStore.flush()
    ]).finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (contents.getType() !== 'window') return;
      if (/^(javascript|file):/i.test(url)) { event.preventDefault(); return; }
      /* Karty maja wlasnego straznika w Tab.wire(), ale okna popup (np. z
         target="_blank") go nie maja - dostaja preload web.js, wiec strona
         mogłaby probowac przejsc na nazuna:// i dostac most IPC do reszty
         przegladarki. Ten sam warunek co przy zwyklej karcie zamyka i te
         droge. */
      if (/^nazuna:/i.test(url) && !/^nazuna:/i.test(contents.getURL())) event.preventDefault();
    });
  });

  process.on('uncaughtException', (err) => {
    console.error('[main] nieobsługiwany błąd:', err);
  });
}
