'use strict';
const path = require('path');
const fs = require('fs');
const { ipcMain, app, shell, net, clipboard, dialog, session } = require('electron');
const data = require('./data');
const localFiles = require('./localFiles');
const urls = require('./urls');
const adblock = require('./adblock');
const extensions = require('./extensions');
const downloads = require('./downloads');
const sessions = require('./session');
const catalog = require('./catalog.json');
const widevine = require('./widevine');
const defaultBrowser = require('./defaultBrowser');
const updater = require('./updater');
const security = require('./security');
const privacy = require('./privacy');
const { SEARCH_ENGINES, APP_NAME, rozstrzygnijMotyw } = require('./constants');
const W = require('./window');

/* Polozenie kursora przy przeciaganiu karty. Bierzemy je z procesu glownego,
   w tym samym ukladzie co pozycje okien. Wspolrzedne ekranu z paska (strony)
   przy monitorach o roznej skali (np. laptop 150% i monitor 100%) potrafily
   wskazywac inne miejsce niz to, gdzie naprawde byl kursor - karta wpadala
   wtedy do zlego okna albo wyrwana ladowala obok. */
function gdzieKursor(p) {
  const k = W.kursor();
  if (k && Number.isFinite(k.x) && Number.isFinite(k.y)) return { x: k.x, y: k.y };
  return { x: Number(p.x), y: Number(p.y) };
}

/* Srodek okna, gdy karta trafia do osobnego okna z menu, a nie z przeciagania. */
function srodekOkna(win) {
  try {
    const b = win.win.getBounds();
    return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 3)];
  } catch (_) { return [120, 120]; }
}

function ownerOf(sender) {
  for (const win of W.windows) {
    if (win.shell === sender) return win;
    if (win.tabs.some((t) => t.wc === sender)) return win;
    // Karta na zapas (patrz _prepareSpare() w window.js) czeka na promocje
    // poza tabs - jej strona (np. nowa karta) juz dziala i sama odpytuje
    // API (skroty, historia) dlugo przed tym, jak ktokolwiek w nia kliknie,
    // wiec bez tego kazde jej zapytanie trafialoby w brak okna i wracalo
    // puste, jakby nic sie nie udalo.
    if (win._spareTab && win._spareTab.wc === sender) return win;
    if (win.extensionPopup && win.extensionPopup.view.webContents === sender) return win;
  }
  // Brak dopasowania to sygnal, ze nadawca akurat nie nalezy do zadnego
  // znanego okna (np. karta w trakcie przenoszenia miedzy oknami) - zamiast
  // zgadywac i dzialac na przypadkowym, skupionym oknie, wolimy nic nie
  // robic. register() nizej juz i tak liczy sie z brakiem okna.
  return null;
}

async function suggest(query) {
  const q = String(query || '').trim();
  const results = [];
  if (!q) return results;

  const seen = new Set();
  const push = (item) => {
    const key = `${item.kind}:${item.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(item);
  };

  if (urls.looksLikeUrl(q) || /^[a-z]+:\/\//i.test(q)) {
    push({ kind: 'url', title: q, value: urls.resolve(q), subtitle: 'Otwórz adres' });
  }

  const lower = q.toLowerCase();
  const bookmarks = data.bookmarkList()
    .filter((b) => b.type === 'link' && ((b.title || '').toLowerCase().includes(lower) || b.url.toLowerCase().includes(lower)))
    .slice(0, 3);
  for (const b of bookmarks) push({ kind: 'bookmark', title: b.title, value: b.url, subtitle: urls.prettyHost(b.url) });

  for (const h of data.searchHistory(q, 5)) {
    push({ kind: 'history', title: h.title, value: h.url, subtitle: urls.prettyHost(h.url) });
  }

  if (data.settings.get('showSuggestions', true)) {
    const engine = urls.engine();
    if (engine.suggest) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        const res = await net.fetch(engine.suggest.replace('%s', encodeURIComponent(q)), { signal: controller.signal });
        clearTimeout(timer);
        const text = await res.text();
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed[1]) ? parsed[1] : [];
        for (const s of list.slice(0, 6)) {
          if (typeof s !== 'string') continue;
          push({ kind: 'search', title: s, value: urls.searchUrl(s), subtitle: engine.name });
        }
      } catch (_) { /* offline or blocked: history alone is fine */ }
    }
  }

  push({ kind: 'search', title: q, value: urls.searchUrl(q), subtitle: `Szukaj w ${urls.engine().name}` });
  return results.slice(0, 10);
}

async function clearBrowsingData(win, options) {
  const opts = options || {};
  const targets = new Set();
  for (const w of W.windows) targets.add(w.session);
  targets.add(session.defaultSession);
  for (const ses of targets) {
    if (opts.cache) await ses.clearCache().catch(() => {});
    if (opts.cookies) await ses.clearStorageData({ storages: ['cookies'] }).catch(() => {});
    if (opts.storage) await ses.clearStorageData({ storages: ['localstorage', 'indexdb', 'websql', 'cachestorage', 'serviceworkers', 'shadercache'] }).catch(() => {});
  }
  if (opts.history) data.clearHistory(0);
  if (opts.downloads) downloads.clearFinished();
  return true;
}

const handlers = {
  /* ------------------------------------------------------------- window */
  'window.minimize': (win) => win.win.minimize(),
  'window.maximize': (win) => (win.win.isMaximized() ? win.win.unmaximize() : win.win.maximize()),
  'window.close': (win) => win.win.close(),
  'window.new': () => W.createWindow({}),
  'window.newPrivate': () => W.createWindow({ isPrivate: true }),
  'window.fullscreen': (win) => win.toggleFullScreen(),

  /* ---------------------------------------------------------------- tabs */
  'tab.new': (win, p = {}) => { win.newTab({ url: p.url || W.NEW_TAB, background: !!p.background }); },
  'tab.close': (win, p) => win.closeTab(p.id),
  'tab.select': (win, p) => win.selectTab(p.id),
  'tab.move': (win, p) => win.moveTab(p.id, p.index),
  'tab.reload': (win, p = {}) => win.reload(!!p.hard, p.id || null),
  'tab.stop': (win) => win.stop(),
  'tab.duplicate': (win, p) => { const t = win.tabById(p.id); if (t) win.newTab({ url: t.url }); },
  // Srodkowy przycisk myszy na linku (patrz auxclick w preload/web.js) -
  // nowa karta w tle, bez przelaczania sie na nia, tak jak w kazdej innej
  // przegladarce.
  'link.middleClick': (win, p) => {
    const url = String((p && p.url) || '');
    if (/^https?:\/\//i.test(url)) win.newTab({ url, background: true });
  },
  // t.wc moze byc null, gdy karta spi w tle (patrz Tab.sleep w window.js) -
  // sam przelacznik i tak sie zapamietuje, a Tab.wake() dopilnuje wyciszenia
  // na nowo zbudowanym widoku, gdy karta sie obudzi.
  'tab.mute': (win, p) => { const t = win.tabById(p.id) || win.activeTab(); if (t) { t.muted = !t.muted; if (t.wc) t.wc.setAudioMuted(t.muted); win.scheduleSync(); } },
  // Reczne usypianie z menu karty (patrz tabMenu w shell.js) - dziala tylko
  // na karcie w tle, usypianie aktywnej, wyswietlanej wlasnie karty nie ma
  // sensu (i tak trzeba by ja czyms zaslonic).
  'tab.sleep': (win, p) => {
    const t = win.tabById(p.id);
    if (t && t.id !== win.activeTabId) { t.sleep(); win.scheduleSync(); }
  },
  // Wlacza/wylacza dla hosta biezacej karty wyjatek od automatycznego
  // usypiania (patrz data.isSleepExempt / usypianieCheck w window.js).
  'tab.toggleSleepExempt': (win, p) => {
    const t = win.tabById(p.id);
    if (!t) return;
    const host = urls.hostOf(t.url);
    if (!host) return;
    data.setSleepExempt(host, !data.isSleepExempt(host));
    win.scheduleSync();
  },
  'tab.reopen': (win) => win.reopenClosedTab(),
  'tab.closeOthers': (win, p) => {
    if (!win.tabById(p.id)) return;   // tak samo jak nizej: nie zamykamy wszystkiego przez pomylke
    for (const t of [...win.tabs]) if (t.id !== p.id) win.closeTab(t.id);
  },
  'tab.closeRight': (win, p) => {
    const idx = win.tabs.findIndex((t) => t.id === p.id);
    // Karta mogla juz zniknac (np. zamknieta chwile wczesniej) - przy -1
    // slice(0) zamykal wszystkie karty w oknie.
    if (idx < 0) return;
    for (const t of win.tabs.slice(idx + 1)) win.closeTab(t.id);
  },

  /* ---------------------------------------------------------- navigation */
  'nav.back': (win) => win.goBack(),
  'nav.forward': (win) => win.goForward(),
  'nav.home': (win) => win.goHome(),
  'nav.go': (win, p) => win.navigate(p.input, p.tabId || null),
  // Wyszukiwarka na srodku nowej karty - w odroznieniu od gornego paska
  // adresu, tutaj kazdy wpisany tekst ma trafic do wyszukiwarki, nawet
  // jesli wyglada jak adres strony (patrz forceSearch w navigate()).
  'nav.search': (win, p) => win.navigate(p.input, p.tabId || null, true),

  /* Przycisk "przejdz mimo to" na nazuna://warning. Uzytkownik swiadomie
     omija ostrzezenie, wiec ladujemy prawdziwy adres wprost, bez ponownego
     pytania security.sprawdz() (patrz komentarz w window.js/Tab.otworz). */
  'security.proceed': (win, p, sender) => {
    // Karta, na ktorej kliknieto przycisk - nie zawsze ta aktywna.
    const tab = (sender && win.tabs.find((t) => t.wc === sender)) || win.activeTab();
    if (!tab || !p.url) return;
    security.zapamietajWyjatek(p.typ, p.url); // http - zapamietuje, zlosliwe domeny - nic nie robi
    tab.errorUrl = null;
    tab.warnUrl = null;
    tab.wc.loadURL(p.url).catch(() => {});
  },

  /* ---------------------------------------------------------------- find */
  'find.open': (win) => win.openFind(),
  'find.close': (win) => win.closeFind(),
  'find.query': (win, p) => win.find(p.text, { forward: true, newSession: true, matchCase: p.matchCase }),
  'find.next': (win, p) => win.find(p.text, { forward: true, newSession: false, matchCase: p.matchCase }),
  'find.prev': (win, p) => win.find(p.text, { forward: false, newSession: false, matchCase: p.matchCase }),

  /* ---------------------------------------------------------------- zoom */
  'zoom.set': (win, p) => win.setZoom(p.factor),
  'zoom.step': (win, p) => win.stepZoom(p.direction),
  'zoom.reset': (win) => win.setZoom(1),

  /* ------------------------------------------------------------- overlay */
  'menu.open': (win, p) => win.openPopover(p.name, p.payload || {}),
  'menu.close': (win) => { win.closePopover(); win.closeExtensionPopup(); },
  'ui.expand': (win) => win.setExpanded(true),
  'ui.collapse': (win) => { if (!win.popover) win.setExpanded(false); },
  'ui.popover': (win, p) => { win.popover = p.name || null; win.setExpanded(!!p.name); },
  'menu.action': (win, p) => menuAction(win, p.id, p.value),
  'context.action': (win, p) => W.runContextAction(win, p.id),
  'permission.answer': (win, p) => win.resolvePermission(p.key, p.answer, p.remember),

  /* ----------------------------------------------------------- bookmarks */
  'bookmarks.toggle': (win) => win.toggleBookmark(),
  'bookmarks.list': () => data.bookmarkList(),
  'bookmarks.add': (win, p) => { const r = data.addBookmark(p); W.broadcastAll('bookmarks:changed'); return r; },
  'bookmarks.addFolder': (win, p) => { const r = data.addFolder(p.title, p.parent); W.broadcastAll('bookmarks:changed'); return r; },
  'bookmarks.addSeparator': (win, p) => { const r = data.addSeparator(p.parent); W.broadcastAll('bookmarks:changed'); return r; },
  'bookmarks.update': (win, p) => { const r = data.updateBookmark(p.id, p.patch); W.broadcastAll('bookmarks:changed'); return r; },
  'bookmarks.remove': (win, p) => { data.removeBookmark(p.id); W.broadcastAll('bookmarks:changed'); },
  'bookmarks.move': (win, p) => { data.moveBookmark(p.id, p.parent, p.beforeId); W.broadcastAll('bookmarks:changed'); },
  'bookmarks.openAll': (win, p) => {
    for (const b of data.bookmarkList().filter((x) => x.type === 'link' && x.parent === p.parent)) win.newTab({ url: b.url, background: true });
  },

  /* ------------------------------------------------------------- history */
  'history.search': (win, p = {}) => data.searchHistory(p.query, p.limit || 300),
  'history.remove': (win, p) => { data.removeHistory(p.urls || []); return data.searchHistory('', 300); },
  'history.clear': (win, p = {}) => { data.clearHistory(p.since || 0); return []; },

  /* ---------------------------------------------------- kafelki nowej karty */
  'newtab.skroty': () => data.skrotyStan(),
  'newtab.skroty.dodaj': (win, p) => {
    const raw = String((p && p.url) || '').trim();
    if (!raw) return { error: 'Podaj adres strony.' };
    const wyglądaJakUrl = urls.looksLikeUrl(raw) || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
    if (!wyglądaJakUrl) return { error: 'To nie wygląda na adres strony.' };
    let origin, host;
    try {
      const u = new URL(urls.resolve(raw));
      if (!/^https?:$/.test(u.protocol)) return { error: 'To nie wygląda na adres strony.' };
      origin = u.origin;
      host = u.hostname.replace(/^www\./, '');
    } catch (_) { return { error: 'To nie wygląda na adres strony.' }; }
    const stan = data.dodajSkrot({ origin, host, label: (p && p.label) || '' });
    W.broadcastAll('skroty:zmiana');
    return stan;
  },
  'newtab.skroty.usun': (win, p) => {
    const stan = data.usunSkrot({ origin: (p && p.origin) || '', host: (p && p.host) || '' });
    W.broadcastAll('skroty:zmiana');
    return stan;
  },

  /* ----------------------------------------------------------- downloads */
  'downloads.list': (win) => downloads.list(win.isPrivate),
  'downloads.control': (win, p) => downloads.control(p.id, p.action, win.isPrivate),
  'downloads.clear': (win) => downloads.clearFinished(win.isPrivate),
  'downloads.panel': (win) => win.toggleDownloadsPanel(),
  'downloads.chooseDir': (win) => downloads.chooseDir(win.win),
  'downloads.dir': () => downloads.defaultDir(),

  /* ---------------------------------------------------------- extensions */
  'extensions.list': () => extensions.list(),
  'extensions.catalog': () => catalog,
  'extensions.install': async (win, p) => {
    const record = await extensions.install(p.input);
    await reloadExtensions();
    W.broadcastAll('extensions:changed');
    return extensions.describe(record);
  },
  'extensions.installFolder': async (win) => {
    const res = await dialog.showOpenDialog(win.win, { title: 'Wybierz folder rozszerzenia', properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths.length) return null;
    const record = await extensions.installFromFolder(res.filePaths[0]);
    await reloadExtensions();
    W.broadcastAll('extensions:changed');
    return extensions.describe(record);
  },
  'extensions.remove': async (win, p) => {
    extensions.remove(p.id);
    await reloadExtensions();
    W.broadcastAll('extensions:changed');
    return extensions.list();
  },
  'extensions.toggle': async (win, p) => {
    extensions.setEnabled(p.id, p.enabled);
    await reloadExtensions();
    W.broadcastAll('extensions:changed');
    return extensions.list();
  },
  'extensions.popup': (win, p) => win.openExtensionPopup(p.id, p.rect),
  'extensions.options': (win, p) => {
    const info = extensions.list().find((e) => e.id === p.id);
    if (info && info.optionsPage) win.newTab({ url: `chrome-extension://${info.runtimeId || p.id}/${info.optionsPage.replace(/^\/+/, '')}` });
  },
  'extensions.store': (win, p) => win.newTab({ url: p && p.id ? `https://chromewebstore.google.com/detail/${p.id}` : 'https://chromewebstore.google.com/' }),

  /* ------------------------------------------------------------ settings */
  /* Karty */
  'tab.doNowegoOkna': (win, p) => { W.wyrwijKarte(win, Number(p.id), ...srodekOkna(win)); },
  'tab.dragStart': (win, p) => {
    W.zacznijPrzeciaganie(p.id);
    /* Warstwa interfejsu rozciaga sie na cale okno, zeby trzymana karta mogla
       za kursorem wyjsc poza pasek. Warstwa jest przezroczysta i nie lapie
       klikniec, wiec strona pod spodem zachowuje sie normalnie.

       Znacznik przeciagania jest konieczny: interfejs ma wlasne zabezpieczenie,
       ktore zwija rozwinieta warstwe, gdy nie ma w niej zadnego okienka.
       Bez tego znacznika zwijal ja natychmiast i trzymana karta znikala. */
    for (const w of W.windows) { w.przeciaganieKarty = true; w.setExpanded(true); w.scheduleSync(); }
  },

  /* Przeciaganie karty prowadzimy sami, po wspolrzednych ekranu. Systemowe
     przenoszenie nie donosilo zdarzen miedzy dwoma oknami tej samej
     przegladarki: karta zamiast wladowac sie do drugiego okna wyrywala sie
     w trzecie. Tutaj proces glowny wie, gdzie stoja wszystkie okna, wiec sam
     rozstrzyga, nad ktorym jestes. */
  'tab.dragRuch': (win, p) => {
    const { x, y } = gdzieKursor(p);
    const cel = (Number.isFinite(x) && Number.isFinite(y)) ? W.oknoPodPunktem(x, y) : null;
    const nadPaskiem = cel && W.wPasku(cel, y);
    const karta = win ? win.tabById(Number(p.id)) : null;
    const tytul = karta ? (karta.title || 'Nowa karta') : 'Karta';
    for (const w of W.windows) {
      const moje = nadPaskiem && w === cel;
      // Wspolrzedne juz wewnatrz danego okna (W.punktWOknie), nie ekranowe.
      const wOknie = W.punktWOknie(w, x, y);
      w.send('pasek:podswietl', { on: !!moje, x: wOknie.x });
      // Trzymana karta rysuje sie w tym oknie, nad ktorym akurat jestes.
      w.send('pasek:duch', w === cel ? { on: true, x: wOknie.x, y: wOknie.y, tytul } : { on: false });
    }
  },

  'tab.dragKoniecP': (win, p) => {
    const { x, y } = gdzieKursor(p);
    for (const w of W.windows) {
      w.send('pasek:podswietl', { on: false });
      w.send('pasek:duch', { on: false });
      w.przeciaganieKarty = false;
      w.setExpanded(false);
      w.scheduleSync();
    }
    if (!W.odbierzPrzeciaganie(p.id)) return;
    /* Karta puszczona na pasku zakladek wlasnego okna (pasek sam to
       rozpoznaje, bo zna swoje polozenie) - zostaje na miejscu, a jej strona
       trafia na pasek zakladek, tak jak w Firefoksie. Tylko na pasek, nie do
       menu pod przyciskiem zakladek. */
    if (p.naZakladki && win) {
      const tab = win.tabById(Number(p.id));
      const url = tab ? tab.displayUrl : '';
      if (url && !/^nazuna:/i.test(url)) {
        const z = data.addBookmark({ title: tab.title || url, url, parent: 'bar' });
        if (z) data.moveBookmark(z.id, 'bar', p.naZakladki.beforeId || null);
        W.broadcastAll('bookmarks:changed');
      }
      return;
    }
    const cel = (Number.isFinite(x) && Number.isFinite(y)) ? W.oknoPodPunktem(x, y) : null;
    if (cel && W.wPasku(cel, y)) {
      // Pasek docelowego okna sam policzy miejsce wstawienia, bo tylko on wie,
      // gdzie dokladnie leza jego karty.
      cel.send('pasek:upusc', { id: Number(p.id), x: W.punktWOknie(cel, x, y).x });
      return;
    }
    // Poza jakimkolwiek paskiem: osobne okno w tym miejscu.
    if (win) W.wyrwijKarte(win, Number(p.id), x, y);
  },
  /* Karta puszczona na pasku innego okna. Znacznik potwierdza, ze przeciaganie
     wyszlo z wnetrza przegladarki, a nie ze strony internetowej podszywajacej
     sie pod karte. */
  'tab.przenies': (win, p) => {
    if (p.zeton !== W.ZETON) return;
    /* Wpis o przeciaganiu zabiera juz tab.dragKoniecP, ktory jako jedyny
       rozstrzyga, czy karta ma sie przeniesc czy wyrwac. Tutaj wystarczy
       znacznik potwierdzajacy, ze prosba wyszla z wnetrza przegladarki. */
    W.przeniesKarte(Number(p.id), win, Number.isFinite(Number(p.index)) ? Number(p.index) : null);
  },

  'settings.get': () => ({ values: data.settings.data, motyw: rozstrzygnijMotyw(data.settings.get('theme', 'dark')), engines: SEARCH_ENGINES, downloadDir: downloads.defaultDir() }),
  'settings.set': (win, p) => {
    const patch = (p.patch && typeof p.patch === 'object') ? p.patch : {};
    data.settings.assign(patch);
    data.settings.flush();
    zastosujZmianyUstawien(Object.keys(patch));
    return data.settings.data;
  },
  /* Przywrocenie domyslnych dotad tylko podmienialo plik - bloker, motyw,
     DNS, WebRTC i reszta dalej dzialaly po staremu az do restartu, a
     otwarte karty ustawien nie wiedzialy o zmianie. Teraz idzie ta sama
     droga co zwykla zmiana ustawienia. Okno, jego rozmiar i zapamietana
     sesja to nie preferencje, wiec zostaja. */
  'settings.reset': () => {
    const zostaw = {};
    for (const klucz of ['windowBounds', 'windowMaximized', 'restoreSession']) {
      if (data.settings.data[klucz] !== undefined) zostaw[klucz] = data.settings.data[klucz];
    }
    data.settings.data = Object.assign(JSON.parse(JSON.stringify(data.DEFAULT_SETTINGS)), zostaw);
    data.settings.flush();
    zastosujZmianyUstawien(Object.keys(data.DEFAULT_SETTINGS));
    return data.settings.data;
  },
  'settings.clearData': (win, p) => clearBrowsingData(win, p),

  /* ----------------------------------------------------------------- app */
  'app.state': (win) => win.state(),
  'app.suggest': (win, p) => suggest(p.query),
  'app.openExternal': (win, p) => { if (urls.bezpieczneZewnetrzne(p.url)) shell.openExternal(p.url); },
  'app.copy': (win, p) => clipboard.writeText(p.text || ''),
  'app.devtools': (win) => { const t = win.activeTab(); if (t) t.wc.toggleDevTools(); },
  'app.print': (win) => { const t = win.activeTab(); if (t) t.wc.print({}, () => {}); },
  'app.info': () => ({
    name: APP_NAME,
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    userData: app.getPath('userData'),
    adblockReady: adblock.ready,
    adblock: adblock.status(),
    widevine: widevine.info(),
    portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
    startMs: W.startMs()
  }),
  'app.openUserData': () => shell.openPath(app.getPath('userData')),
  'app.adblockStatus': () => adblock.status(),
  'app.adblockUpdate': async () => {
    const result = await adblock.refresh(true);
    return { ...result, status: adblock.status() };
  },
  'app.securityStatus': () => security.status(),
  'app.securityUpdate': async () => {
    const result = await security.refresh(true);
    return { ...result, status: security.status() };
  },
  'app.adblockSite': (win, p) => {
    win.closePopover();               // najpierw zwin okienko, dopiero potem przeladuj
    adblock.setSiteEnabled(p.host, p.enabled);
    win.reload();
    win.scheduleSync();
  },
  'app.tabSleepStatus': () => W.tabSleepStatus(),
  'app.defaultBrowserStatus': () => defaultBrowser.status(),
  'app.setDefaultBrowser': () => defaultBrowser.otworzUstawienia(),

  /* Uzywane przez nazuna://pdf i nazuna://textview (patrz podmienNaPodglad()
     w session.js) - te strony nie moga pobrac oryginalnego pliku same przez
     fetch(), bo jako wlasny protokol nazuna:// zawsze trafialyby na CORS.
     Pobieramy wiec za nie tutaj, w procesie glownym (ktorego CORS nie
     dotyczy), przez WLASCIWA sesje danego okna - zeby dzialalo tez dla
     plikow za logowaniem, ktorych ciasteczka trzyma ta sama sesja.

     Adres "nazuna-local:<token>" to osobna sciezka dla lokalnego pliku PDF
     otwartego z Eksploratora (patrz argToStartUrl w index.js i
     localFiles.js) - token wskazuje na sciezke zarejestrowana wylacznie
     przez main process, wiec zadna strona nie moze tedy wymusic odczytu
     dowolnego pliku z dysku, podajac wprost "src=file:///...". */
  'viewer.fetch': async (win, p) => {
    const url = String((p && p.url) || '');
    if (url.startsWith('nazuna-local:')) {
      const sciezka = localFiles.pobierzSciezke(url.slice('nazuna-local:'.length));
      if (!sciezka) return { ok: false, error: 'Nieprawidłowy albo nieaktualny odnośnik do pliku' };
      try {
        const buf = await fs.promises.readFile(sciezka);
        return { ok: true, status: 200, contentType: 'application/pdf', bytes: new Uint8Array(buf) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Zły adres' };
    try {
      const resp = await win.session.fetch(url);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      return {
        ok: resp.ok,
        status: resp.status,
        contentType: resp.headers.get('content-type') || '',
        bytes
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
  /* "Pobierz" w nazuna://pdf i nazuna://textview - zwykle wc.downloadURL(),
     dokladnie to samo, co "Zapisz link jako" z menu prawego przycisku (patrz
     'save-link' w window.js), tylko wywolane z poziomu samego podgladu.
     Lokalny plik (patrz wyzej) juz lezy na dysku - zamiast go "pobierac"
     jeszcze raz, po prostu pokazujemy go w Eksploratorze. */
  'viewer.download': (win, p, sender) => {
    const url = String((p && p.url) || '');
    if (url.startsWith('nazuna-local:')) {
      const sciezka = localFiles.pobierzSciezke(url.slice('nazuna-local:'.length));
      if (sciezka) shell.showItemInFolder(sciezka);
      return;
    }
    if (url && sender && !sender.isDestroyed()) sender.downloadURL(url);
  },
  'app.updateAvailable': () => updater.dostepny(),
  'app.updateStatus': () => updater.stan(),
  'app.updateCheck': async () => updater.sprawdz('reczne'),
  'app.updateDownload': () => updater.pobierz(),
  'app.updateInstall': () => updater.zainstaluj(),
  'app.quit': () => app.quit()
};

/* Wszystko, co trzeba zrobic od razu po zmianie ustawien (bez restartu). */
function zastosujZmianyUstawien(klucze) {
  const zmienione = new Set(klucze);
  const sessionList = [...new Set([...W.windows].map((w) => w.session))];
  if (zmienione.has('adblockEnabled')) adblock.setGlobal(data.settings.get('adblockEnabled', true), sessionList);
  if (zmienione.has('adblockMode')) adblock.setMode(data.settings.get('adblockMode', 'safe'), sessionList);
  if (zmienione.has('extensionsEnabled')) reloadExtensions();
  if (zmienione.has('theme')) W.repaintTheme();
  if (zmienione.has('doNotTrack') || zmienione.has('blockThirdPartyCookies') || zmienione.has('webrtcLeakProtection')) sessions.refreshFlags();
  if (zmienione.has('webrtcLeakProtection')) sessions.applyWebRtcToAll();
  if (zmienione.has('secureDns')) privacy.applySecureDns();
  for (const w of W.windows) { w.layout(); w.scheduleSync(); }
  W.broadcastAll('settings:changed');
}

function menuAction(win, id, value) {
  switch (id) {
    case 'new-tab': win.newTab({ url: W.NEW_TAB }); break;
    case 'new-window': W.createWindow({}); break;
    case 'new-private': W.createWindow({ isPrivate: true }); break;
    case 'history': win.newTab({ url: 'nazuna://history' }); break;
    case 'bookmarks': win.newTab({ url: 'nazuna://bookmarks' }); break;
    case 'downloads': win.newTab({ url: 'nazuna://downloads' }); break;
    case 'extensions': win.newTab({ url: 'nazuna://extensions' }); break;
    case 'settings': win.newTab({ url: 'nazuna://settings' }); break;
    case 'about': win.newTab({ url: 'nazuna://about' }); break;
    case 'find': win.openFind(); break;
    case 'print': { const t = win.activeTab(); if (t) t.wc.print({}, () => {}); break; }
    case 'devtools': { const t = win.activeTab(); if (t) t.wc.toggleDevTools(); break; }
    case 'fullscreen': win.toggleFullScreen(); break;
    case 'zoom-in': win.stepZoom(1); break;
    case 'zoom-out': win.stepZoom(-1); break;
    case 'zoom-reset': win.setZoom(1); break;
    case 'bookmark-page': win.toggleBookmark(); break;
    case 'toggle-bookmarks-bar':
      data.settings.set('showBookmarksBar', !data.settings.get('showBookmarksBar', true));
      // Przez to samo co zmiana w Ustawieniach, zeby otwarta karta ustawien
      // tez pokazala nowy stan przelacznika.
      zastosujZmianyUstawien(['showBookmarksBar']);
      break;
    case 'quit': app.quit(); break;
    default: break;
  }
  if (id !== 'zoom-in' && id !== 'zoom-out' && id !== 'zoom-reset' && id !== 'toggle-bookmarks-bar') win.closePopover();
  else win.scheduleSync();
}

let reloading = null;
async function reloadExtensions() {
  if (reloading) return reloading;
  reloading = (async () => {
    for (const ses of sessions.prepared) {
      const host = ses.extensions || ses;
      try {
        for (const ext of host.getAllExtensions()) host.removeExtension(ext.id);
      } catch (_) {}
    }
    const done = new Set();
    for (const w of W.windows) {
      if (w.isPrivate || done.has(w.session)) continue;   // rozszerzenia nie wchodzą do okien prywatnych
      done.add(w.session);
      await sessions.loadExtensions(w.session).catch(() => {});
    }
  })();
  try { await reloading; } finally { reloading = null; }
}

/* Druga linia obrony, po preload/web.js. Preload daje mostek tylko stronom
   nazuna:// bedacym ramka najwyzsza, ale proces glowny dotad wierzyl kazdej
   wiadomosci od dowolnej karty. Wystarczylby jeden blad w preloadzie (albo
   w Electronie), zeby zwykla strona internetowa mogla zmieniac ustawienia,
   czytac historie czy instalowac rozszerzenia. Teraz sprawdzamy to tutaj,
   po prawdziwej ramce nadawcy, ktorej strona nie podrobi. Pasek przegladarki
   (shell) przechodzi zawsze, a z dowolnej strony tylko srodkowy klik w link
   (patrz auxclick w preload/web.js). */
const Z_KAZDEJ_STRONY = new Set(['link.middleClick']);
function nadawcaDozwolony(event, win, method) {
  if (win.shell === event.sender) return true;
  if (Z_KAZDEJ_STRONY.has(method)) return true;
  try {
    const ramka = event.senderFrame;
    return !!ramka && !ramka.parent && /^nazuna:/i.test(String(ramka.url || ''));
  } catch (_) { return false; }
}

function register() {
  ipcMain.handle('nazuna:invoke', async (event, method, payload) => {
    const win = ownerOf(event.sender);
    const handler = handlers[method];
    if (!handler) throw new Error(`Nieznana metoda: ${method}`);
    // Bez okna wiekszosc handlerow siega po jego pola i by sie wysypala - a
    // brak jakiegokolwiek okna znaczy, ze i tak nie ma gdzie pokazac wyniku.
    if (!win) return null;
    if (!nadawcaDozwolony(event, win, method)) return null;
    return handler(win, payload || {}, event.sender);
  });

  ipcMain.on('nazuna:send', (event, method, payload) => {
    const win = ownerOf(event.sender);
    const handler = handlers[method];
    if (!handler || !win || !nadawcaDozwolony(event, win, method)) return;
    try {
      // Handler moze byc async - jego odrzucona obietnica nie ma prawa
      // wywrocic procesu glownego jako nieobsluzony wyjatek.
      const wynik = handler(win, payload || {}, event.sender);
      if (wynik && typeof wynik.catch === 'function') wynik.catch((err) => console.error(method, err && err.message));
    } catch (err) { console.error(method, err.message); }
  });
}

module.exports = { register, reloadExtensions, suggest };
