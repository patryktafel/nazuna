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
const extensions = require('./extensions');
const privacy = require('./privacy');
const W = require('./window');
const localFiles = require('./localFiles');
const jumplist = require('./jumplist');

protocolHelper.registerSchemes();

app.setAppUserModelId('com.tafel.nazuna');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

// Ustawienia trzeba wczytac zanim aplikacja bedzie gotowa, bo wylaczenie
// przyspieszenia sprzetowego da sie zrobic tylko na tym etapie.
const data = require('./data');
data.init();
if (!data.settings.get('hardwareAcceleration', true)) app.disableHardwareAcceleration();
/* Sloiki ciasteczek (jak Total Cookie Protection w Firefoksie): Chromium sam
   ukrywa przed osadzonymi elementami ich zwykle ciasteczka, a przepuszcza tylko
   ciasteczka "Partitioned" - trzymane osobno dla kazdej strony w pasku adresu.
   Zwykle ciasteczka osadzonych elementow zamieniamy na takie w session.js
   (naglowki) i preload/web.js (document.cookie). Dziala od startu programu. */
if (data.settings.get('slojkiCiasteczek', true) !== false) app.commandLine.appendSwitch('test-third-party-cookie-phaseout');

/* Argument uruchomienia zamieniony na adres, ktory da sie otworzyc w karcie.
   Zwykly http(s)-owy link przechodzi bez zmian. Lokalny plik .pdf (tak
   wlasnie wyglada argv, gdy ktos w Eksploratorze klika PDF-a skojarzonego
   z Nazuna - patrz build/installer.nsh, ProgId "NazunaPDF") trafia od razu
   do wlasnej przegladarki PDF pod nazuna://pdf - nie ma sensu wpierw
   nawigowac na surowy plik://, skoro i tak zaraz mielibysmy go stamtad
   przekierowac. existsSync to tylko zabezpieczenie przed potraktowaniem
   jakiejs losowej flagi konczacej sie na ".pdf" jako sciezki do pliku.
   katalog: folder roboczy uruchomienia (second-instance podaje go osobno),
   zeby wzgledna sciezka nie liczyla sie od folderu pierwszej Nazuny. */
function argToStartUrl(arg, katalog) {
  if (typeof arg !== 'string') return null;
  if (/^https?:\/\//i.test(arg)) return arg;
  /* Instalator kojarzy z Nazuna tez .htm/.html (ProgId "NazunaHTML"), wiec
     dwuklik zapisanej strony w Eksploratorze przychodzi tu jako sciezka.
     Bez tej galezi otwierala sie pusta karta. */
  if (/\.(html?|xhtml)$/i.test(arg)) {
    try {
      const pelna = path.resolve(katalog || '', arg);
      if (fs.existsSync(pelna) && fs.statSync(pelna).isFile()) return require('url').pathToFileURL(pelna).href;
    } catch (_) { /* nieprawidlowa sciezka - ignorujemy */ }
    return null;
  }
  if (/\.pdf$/i.test(arg)) {
    try {
      const pelna = path.resolve(katalog || '', arg);
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
  /* Drugie uruchomienie, zanim pierwsze skonczylo start (np. przez do 60 s
     czeka na sprawdzenie aktualizacji). Wtedy nie ma jeszcze IPC ani obslugi
     nazuna:// w sesji paska, wiec okno utworzone w tej chwili nigdy by sie
     nie pokazalo i zostaloby niewidocznym "zombie" trzymajacym proces.
     Do konca startu tylko zapamietujemy argumenty, a whenReady je obsluzy. */
  let startGotowy = false;
  const czekajaceUruchomienia = [];

  function obsluzDrugieUruchomienie(argv, katalog) {
    /* Pozycje z menu ikony w pasku zadan (jumplist.js) przy dzialajacej juz
       Nazunie. Nowa karta trafia do zwyklego okna, nie do prywatnego. */
    const zadanie = jumplist.zadanieZArgumentow(argv);
    if (zadanie === 'prywatne') { W.createWindow({ isPrivate: true }); return; }
    if (zadanie === 'noweOkno') { W.createWindow({}); return; }
    const focused = W.focusedWindow();
    const win = (focused && !focused.isPrivate ? focused : W.allWindows().find((w) => !w.isPrivate)) || null;
    if (zadanie === 'nowaKarta') {
      if (!win) { W.createWindow({}); return; }
      if (win.win.isMinimized()) win.win.restore();
      win.win.focus();
      win.newTab({ url: W.NEW_TAB });
      return;
    }
    const url = argv.slice(1).map((a) => argToStartUrl(a, katalog)).find(Boolean);
    if (win) {
      if (win.win.isMinimized()) win.win.restore();
      win.win.focus();
      if (url) win.newTab({ url });
    } else {
      W.createWindow({ urls: url ? [url] : [] });
    }
  }

  app.on('second-instance', (_event, argv, katalog) => {
    if (!startGotowy) { czekajaceUruchomienia.push({ argv, katalog }); return; }
    obsluzDrugieUruchomienie(argv, katalog);
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

    downloads.ustawOknoDla((wc) => {
      const { BrowserWindow } = require('electron');
      const nasze = W.allWindows().find((w) => w.tabs.some((t) => t.wc === wc) || (w._spareTab && w._spareTab.wc === wc));
      if (nasze && nasze.win && !nasze.win.isDestroyed()) return nasze.win;
      const popup = wc ? BrowserWindow.fromWebContents(wc) : null;
      if (popup) return popup;
      const aktywne = W.focusedWindow();
      return aktywne && aktywne.win && !aktywne.win.isDestroyed() ? aktywne.win : null;
    });

    adblock.onCountChanged((webContentsId) => {
      for (const win of W.allWindows()) {
        const active = win.activeTab();
        if (active && !active.wc.isDestroyed() && active.wc.id === webContentsId) win.scheduleSyncLicznika();
      }
    });

    sessions.setPermissionPrompt(async ({ webContents, permission, origin, strona, osadzona }) => {
      const win = W.allWindows().find((w) => w.tabs.some((t) => t.wc === webContents)) || W.focusedWindow();
      if (!win) return 'deny';
      return win.requestPermission({ permission, origin, strona, osadzona });
    });
    sessions.setWyborKontaKlucza(({ frame, rp, konta }) => {
      let wc = null;
      try { wc = frame ? require('electron').webContents.fromFrame(frame) : null; } catch (_) {}
      const win = (wc && W.allWindows().find((w) => w.tabs.some((t) => t.wc === wc))) || W.focusedWindow();
      if (!win) return null;
      return win.wybierzKontoKlucza({ rp, konta });
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
    W.startMonitory();

    /* Po wybudzeniu z uspienia albo odblokowaniu ekranu karta na wierzchu
       potrafi zostac biala, mimo ze nic w niej nie padlo - patrz szerszy
       komentarz przy invalidateActiveTab() w window.js. Fokus okna (patrz
       tam tez) lapie wiekszosc takich przypadkow, ale nie ten, gdy Nazuna
       byla ostatnio aktywnym oknem PRZED usypieniem calego systemu -
       wtedy po powrocie okno nigdy na nowo nie dostaje zdarzenia "focus". */
    powerMonitor.on('resume', () => { for (const win of W.allWindows()) win.invalidateActiveTab(); });
    powerMonitor.on('unlock-screen', () => { for (const win of W.allWindows()) win.invalidateActiveTab(); });
    starttrace.znacznik('po ipc.register/sessions.forPartition/security.init/privacy/tabSleep');

    const startUrls = process.argv.slice(1).map((a) => argToStartUrl(a)).filter(Boolean);
    if (process.env.NAZUNA_START) startUrls.push(...process.env.NAZUNA_START.split('|'));
    // "Nowe okno prywatne" z menu ikony przy zamknietej Nazunie - otwiera sie
    // tylko okno prywatne, jak w Firefoksie. Rozszerzenia i tak wczytujemy do
    // zwyklej sesji, zeby byly gotowe w pozniej otwartym zwyklym oknie.
    const tylkoPrywatne = jumplist.zadanieZArgumentow(process.argv) === 'prywatne';
    /* Linki z uruchomien, ktore przyszly w trakcie startu, ida od razu do
       pierwszego okna (jak linki z wlasnej linii polecen). Zadania z menu
       ikony (nowe okno, okno prywatne) obslugujemy dopiero po createWindow.
       "Nowa karta" pomijamy - pierwsze okno i tak otwiera sie z karta. */
    const poStarcie = [];
    const linkiZKolejki = [];
    for (const u of czekajaceUruchomienia.splice(0)) {
      const zadanie = jumplist.zadanieZArgumentow(u.argv);
      if (zadanie === 'prywatne' || zadanie === 'noweOkno') { poStarcie.push(u); continue; }
      if (zadanie) continue;
      const link = u.argv.slice(1).map((a) => argToStartUrl(a, u.katalog)).find(Boolean);
      if (link) linkiZKolejki.push(link);
    }
    if (!tylkoPrywatne) startUrls.push(...linkiZKolejki);
    const startup = data.settings.get('startup', 'newtab');
    let initial = startUrls;
    let aktywna = 0;
    let dodatkoweOkna = [];
    /* Start z linkiem z innego programu (Nazuna jako domyslna przegladarka)
       nie moze pomijac przywracania - inaczej okno mialo jedna karte, a po
       zamknieciu ta jedna karta nadpisywala zapisana sesje i reszta kart
       przepadala. Jak w Chrome: zapisane karty, a link na koncu i aktywny. */
    if (startup === 'restore') {
      /* restoreSessionOkna: karty kazdego zwyklego okna osobno (pierwsze to
         okno, ktore bylo na wierzchu). Wczesniej zapisywalo sie tylko jedno
         okno i przy "Zakoncz" z dwoma oknami karty drugiego przepadaly.
         restoreSession (plaska lista) zostaje dla zapisow ze starszych wersji. */
      const okna = data.settings.get('restoreSessionOkna', null);
      const plaska = data.settings.get('restoreSession', null);
      let poprawne = Array.isArray(okna)
        ? okna.filter((l) => Array.isArray(l) && l.length).map((l) => l.filter((u) => typeof u === 'string' && u))
          .filter((l) => l.length)
        : [];
      // Lista okien niezgodna z plaska (np. zapis starszej wersji po niej) - wierzymy plaskiej.
      if (poprawne.length && JSON.stringify(poprawne[0]) !== JSON.stringify(plaska)) poprawne = [];
      const saved = poprawne.length ? poprawne[0] : plaska;
      const zapisaneAktywne = data.settings.get('restoreSessionAktywne', null);
      const aktywnaOkna = (i, lista) => {
        const n = Array.isArray(zapisaneAktywne) ? zapisaneAktywne[i] : 0;
        return Number.isInteger(n) && n >= 0 && n < lista.length ? n : 0;
      };
      if (Array.isArray(saved) && saved.length) {
        initial = [...saved, ...startUrls];
        // Karta, na ktorej skonczono. Zapis plaski ze starszych wersji nie ma tej informacji.
        aktywna = startUrls.length ? saved.length : (poprawne.length ? aktywnaOkna(0, saved) : 0);
      }
      dodatkoweOkna = poprawne.slice(1).map((urls, i) => ({ urls, aktywna: aktywnaOkna(i + 1, urls) }));
    }
    if (!initial.length && startup === 'homepage') initial = [data.settings.get('homepage', W.NEW_TAB)];

    starttrace.znacznik('przed createWindow');
    /* Pozostale okna z zapisanej sesji tworzymy przed glownym, zeby to z
       linkiem (albo ostatnio aktywne) pokazalo sie na koncu, na wierzchu. */
    if (!tylkoPrywatne) for (const okno of dodatkoweOkna) W.createWindow(okno);
    W.ustawMotywStron(); // strony dostaja ciemny/jasny tryb zgodny z wygladem Nazuny
    W.createWindow(tylkoPrywatne ? { isPrivate: true } : { urls: initial, aktywna });
    // Linki nie trafiaja do okna prywatnego - dostaja jedno zwykle okno.
    if (tylkoPrywatne && linkiZKolejki.length) W.createWindow({ urls: linkiZKolejki });
    starttrace.znacznik('po createWindow (okno jeszcze niewidoczne - buduje sie async)');
    startGotowy = true;
    for (const u of poStarcie) obsluzDrugieUruchomienie(u.argv, u.katalog);
    // Aktualizacje rozszerzen pobrane w poprzedniej sesji wchodza przed wczytaniem.
    try { extensions.zastosujAktualizacje(); } catch (err) { console.warn('[ext] aktualizacje:', err.message); }
    sessions.loadExtensions(sessions.forPartition('persist:nazuna')).catch((err) => console.warn('[ext]', err.message));
    // Sprawdzanie nowych wersji rozszerzen w sklepie - samo pilnuje "raz na dobe".
    const sprawdzRozszerzenia = () => extensions.sprawdzAktualizacje().then(() => W.broadcastAll('extensions:changed')).catch(() => {});
    setTimeout(sprawdzRozszerzenia, 2 * 60 * 1000).unref();
    setInterval(sprawdzRozszerzenia, 6 * 60 * 60 * 1000).unref();
    jumplist.start();

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
  let pytanieOPobrania = false;
  app.on('before-quit', (event) => {
    if (zamykanie) return;
    /* Trwa pobieranie - jak w Firefoksie pytamy, zanim zamkniemy (inaczej
       pliki przerywaly sie bez slowa). */
    const okno = W.allWindows().find((w) => w.win && !w.win.isDestroyed());
    // Bez otwartego okna nie ma gdzie wrocic po "Anuluj" - ostatnie okno
    // pyta samo przy zamykaniu (patrz 'close' w window.js).
    if (!pytanieOPobrania && okno && downloads.ileAktywnych() > 0) {
      event.preventDefault();
      pytanieOPobrania = true;
      const n = downloads.ileAktywnych();
      dialog.showMessageBox(okno ? okno.win : undefined, {
        type: 'warning', buttons: ['Zamknij', 'Anuluj'], defaultId: 1, cancelId: 1, noLink: true,
        title: 'Trwa pobieranie',
        message: n === 1 ? 'Trwa pobieranie pliku. Zamknąć mimo to?' : `Trwa pobieranie plików (${n}). Zamknąć mimo to?`,
        detail: 'Niepobrane pliki zostaną przerwane.'
      }).then(({ response }) => {
        if (response === 0) app.quit();
        else pytanieOPobrania = false;
      }).catch(() => { pytanieOPobrania = false; });
      return;
    }
    try {
      // Karty wszystkich zwyklych okien (prywatne pomija zapamietajSesje),
      // okno na wierzchu albo ostatnio aktywne jako pierwsze. Brak zwyklych
      // okien = ostatnie zamkniete juz zapisalo swoje karty i nic tu nie nadpisze.
      W.zapamietajSesje();
    } catch (_) {}
    zamykanie = true;
    event.preventDefault();
    Promise.allSettled([
      data.settings.flush(),
      data.historyStore.flush(),
      data.bookmarksStore.flush(),
      data.downloadsStore.flush(),
      data.siteStore.flush(),
      data.extensionsStore.flush()
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
