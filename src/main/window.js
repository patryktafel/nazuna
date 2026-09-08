'use strict';
const path = require('path');
const crypto = require('crypto');
const { BaseWindow, WebContentsView, BrowserWindow, shell, screen, clipboard, nativeImage, nativeTheme, net } = require('electron');
const { LAYOUT, UI_DIR, PRELOAD_DIR, ASSETS_DIR, APP_NAME, rozstrzygnijMotyw, TLA } = require('./constants');
const data = require('./data');
const urls = require('./urls');
const sessions = require('./session');
const adblock = require('./adblock');
const extensions = require('./extensions');
const security = require('./security');

const windows = new Set();
let nextWindowId = 1;
let nextTabId = 1;
let privatePartitionCounter = 0;
const closedTabs = [];

const NEW_TAB = 'nazuna://newtab';

/* Klucze dostepu (passkeys). Gdy sa wylaczone, przegladarka odpowiada stronom,
   ze na tym urzadzeniu nie ma czym sie zalogowac, zamiast milczec i puszczac
   pytanie dalej do Windows Hello. To wlasnie milczenie powodowalo, ze przy
   logowaniu wyskakiwalo okno "Zabezpieczenia Windows", takze u kogos, kto
   zadnego klucza nie ma skonfigurowanego. */
function pageFlags() {
  const flags = [];
  if (!data.settings.get('passkeys', false)) flags.push('--nazuna-bez-kluczy');
  return flags;
}

function motywTeraz() {
  return rozstrzygnijMotyw(data.settings.get('theme', 'dark'));
}

/* Kolor malowany pod strona, zanim zdazy sie wyrysowac. Zwykle strony sa biale,
   wiec bialy; nasze wlasne strony ida za motywem, zeby przy otwieraniu karty
   nie mrugalo przeciwnym kolorem. */
function pageBackground(url) {
  if (!/^(nazuna|devtools):/i.test(String(url || ''))) return '#ffffff';
  return TLA[motywTeraz()].wewnetrzne;
}

/* Znacznik losowany przy starcie przegladarki. Przeciaganie karty miedzy
   oknami idzie przez systemowy mechanizm przenoszenia, ktorym poslugiwac sie
   moze rowniez zwykla strona internetowa. Bez znacznika strona moglaby podrzucic
   cos, co pasek kart wzialby za nasza karte. Znacznika nie zna nikt poza
   wnetrzem programu. */
const ZETON = crypto.randomBytes(16).toString('hex');

let czasStartu = null;
function startMs() { return czasStartu; }

/* Karty aktualnie przeciagane. Sluzy do rozstrzygania kolejnosci: puszczenie
   karty nad drugim oknem i zakonczenie przeciagania w pierwszym to dwie osobne
   wiadomosci, ktore moga przyjsc w dowolnej kolejnosci. Pierwsza, ktora dojdzie,
   zabiera wpis, przez co druga nie ma juz czego zrobic. */
const przeciagane = new Set();
function zacznijPrzeciaganie(id) { przeciagane.add(Number(id)); }
function odbierzPrzeciaganie(id) {
  const n = Number(id);
  if (!przeciagane.has(n)) return false;
  przeciagane.delete(n);
  return true;
}

function allWindows() { return [...windows]; }
function focusedWindow() {
  return [...windows].find((w) => w.win && !w.win.isDestroyed() && w.win.isFocused()) || [...windows][0] || null;
}

/* Kolor akcentu wyliczony na podstawie favicony danej strony - patrz
   extractSiteAccent() nizej. Klucz to hostname, wartosc to obiekt czterech
   kolorow (albo null, gdy wyliczenie sie nie udalo - zeby nie probowac w
   kolko tej samej zepsutej favicony). */
const siteAccentCache = new Map();

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  ];
}

function hex([r, g, b]) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');
}

/* Wyciaga przyjemny kolor akcentu z favicony strony - tak jak Vivaldi robi
   to ze zdjeciem zakladki. Usredniamy piksele favicony pomijajac
   przezroczyste, prawie-czarne, prawie-biale i nienasycone (szare), zeby nie
   wyszedl brudny/szary kolor, a potem podbijamy nasycenie i przycinamy
   jasnosc do przyjemnego zakresu, zeby akcent byl zywy, ale nadal czytelny
   i na ciemnym, i na jasnym motywie. Wynik trzymamy w cache per-hostname,
   bo ta sama strona ma zawsze te sama favicone. */
async function extractSiteAccent(faviconUrl) {
  if (!/^https?:\/\//i.test(String(faviconUrl || ''))) return null;
  let host;
  try { host = new URL(faviconUrl).hostname; } catch (_) { return null; }
  if (siteAccentCache.has(host)) return siteAccentCache.get(host);
  try {
    const res = await net.fetch(faviconUrl, { redirect: 'follow' });
    if (!res.ok) { siteAccentCache.set(host, null); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) { siteAccentCache.set(host, null); return null; }
    const bitmap = img.toBitmap(); // BGRA na win32
    let rSum = 0, gSum = 0, bSum = 0, n = 0;
    for (let i = 0; i + 3 < bitmap.length; i += 4) {
      const b = bitmap[i], g = bitmap[i + 1], r = bitmap[i + 2], a = bitmap[i + 3];
      if (a < 80) continue;
      const [, s, l] = rgbToHsl(r, g, b);
      if (s < 0.15 || l < 0.08 || l > 0.92) continue;
      rSum += r; gSum += g; bSum += b; n++;
    }
    if (n < 4) { siteAccentCache.set(host, null); return null; }
    const [h, sRaw, lRaw] = rgbToHsl(rSum / n, gSum / n, bSum / n);
    const s = Math.max(sRaw, 0.45);
    const l = Math.min(0.66, Math.max(0.52, lRaw));
    const base = hslToRgb(h, s, l);
    const strong = hslToRgb(h, Math.min(1, s + 0.05), Math.min(0.78, l + 0.10));
    const accent = {
      accent: hex(base),
      accentStrong: hex(strong),
      accentDim: `rgba(${base[0]}, ${base[1]}, ${base[2]}, 0.16)`,
      accentRing: `rgba(${base[0]}, ${base[1]}, ${base[2]}, 0.3)`
    };
    siteAccentCache.set(host, accent);
    return accent;
  } catch (_) {
    siteAccentCache.set(host, null);
    return null;
  }
}

class Tab {
  constructor(appWindow, { url, background = false }) {
    this.id = nextTabId++;
    this.owner = appWindow;
    this.title = 'Nowa karta';
    this.favicon = null;
    this.loading = false;
    this.audible = false;
    // Raz ustawione na true juz takie zostaje (patrz media-started-playing
    // nizej) - dzieki temu zapauzowany film nie wyglada dla usypianieCheck()
    // tak samo jak zwykla, zapomniana karta (patrz nizej).
    this.hadAudio = false;
    // Kolor akcentu wyliczony z favicony tej karty (patrz extractSiteAccent()) -
    // null, dopoki sie nie wyliczy albo gdy strona nie ma sensownej favicony.
    this.siteAccent = null;
    this.muted = false;
    this.errorUrl = null;
    this.warnUrl = null;
    this.zoom = 1;
    this.findState = null;
    this.url = url || NEW_TAB;
    this.sleeping = false;
    // Od kiedy ta karta ostatnio byla aktywna - usypianie w tle patrzy na
    // ten znacznik (patrz usypianieCheck() nizej), zeby nie tykac karty,
    // z ktorej ktos wlasnie korzystal.
    this.lastActiveAt = Date.now();

    this._createView();
    this.otworz(this.url);
  }

  /* Buduje WebContentsView od zera. Wywolane raz w konstruktorze i ponownie
     przy kazdym wake() - karta usypiajaca (sleep(), nizej) traci swoj widok
     calkowicie, wiec obudzenie jej znaczy zbudowanie go na nowo, dokladnie
     tak samo jak za pierwszym razem. */
  _createView() {
    this.view = new WebContentsView({
      webPreferences: {
        preload: path.join(PRELOAD_DIR, 'web.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        // Bez tego skrypt wyrownujacy tozsamosc przegladarki dziala tylko w
        // glownej ramce, a strony logowania (w tym Google) czesc sprawdzen
        // robia w ramkach osadzonych. Bezpieczenstwa to nie rusza: mostek do
        // programu dostaja wylacznie strony nazuna:// bedace ramka najwyzsza,
        // a ramka podrzedna nigdy nia nie jest.
        nodeIntegrationInSubFrames: true,
        // Flagi czytane przez preload z process.argv. Kosztuja zero: nie ma
        // tu zadnej komunikacji miedzy procesami przy wczytywaniu strony.
        additionalArguments: pageFlags(),
        spellcheck: data.settings.get('spellcheckEnabled', false),
        partition: this.owner.partition,
        backgroundThrottling: true,
        safeDialogs: true,          // strona nie zasypie okienkami alert
        v8CacheOptions: 'code'
      }
    });
    this.view.setBackgroundColor(pageBackground(this.url));
    this.wc = this.view.webContents;
    this.wire();
  }

  /* Usypia karte w tle: zamyka jej proces renderujacy (patrz destroy()),
     wiec przestaje zajmowac pamiec, ale zostaje na pasku kart - tytul,
     favicona i adres sa juz zapamietane we wlasnych polach obiektu, wiec
     pasek wyglada tak samo jak przed usnieciem. Budzi sie sama przy
     kliknieciu (patrz wake() i AppWindow.selectTab). */
  sleep() {
    if (this.sleeping || !this.wc || this.wc.isDestroyed()) return;
    try { this.owner.win.contentView.removeChildView(this.view); } catch (_) {}
    this.destroy();
    this.view = null;
    this.wc = null;
    this.sleeping = true;
    this.loading = false;
    this.audible = false;
  }

  /* Odwrotnosc sleep() - odtwarza widok i wraca na ten sam adres. Krotkie
     przeladowanie przy pierwszym kliknieciu w obudzona karte jest tu
     oczekiwane (tak samo dzieje sie w Chrome/Edge przy ich usypianiu kart). */
  wake() {
    if (!this.sleeping) return;
    this.sleeping = false;
    this._createView();
    // Wyciszenie to preferencja, nie stan strony - nowy widok rodzi sie
    // niewyciszony, wiec trzeba to odtworzyc, gdyby ktos wyciszyl te karte,
    // zanim zdazyla usnac.
    if (this.muted) { try { this.wc.setAudioMuted(true); } catch (_) {} }
    this.owner.win.contentView.addChildView(this.view, 0);
    this.otworz(this.url);
  }

  get displayUrl() { return this.errorUrl || this.warnUrl || this.url; }

  /* Jedyne miejsce, ktore faktycznie odpala loadURL na docelowy adres.
     Nowa karta, pasek adresu, klikniecie linku i przekierowanie - wszystkie
     przechodza przez ta metode (patrz will-navigate/will-redirect nizej i
     AppWindow.navigate), zeby security.sprawdz() nie dalo sie ominac zadna
     z tych sciezek. */
  otworz(target) {
    const zagrozenie = security.sprawdz(target);
    if (zagrozenie) {
      this.warnUrl = target;
      this.wc.loadURL(security.adresOstrzezenia(zagrozenie.typ, target)).catch(() => {});
    } else {
      this.warnUrl = null;
      this.wc.loadURL(target).catch(() => {});
    }
  }

  wire() {
    const wc = this.wc;
    const sync = () => this.owner.scheduleSync();

    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      data.updateHistoryTitle(this.url, title);
      sync();
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.favicon = favicons && favicons.length ? favicons[favicons.length - 1] : null;
      sync();
      this._updateSiteAccent();
    });
    wc.on('did-start-loading', () => { this.loading = true; sync(); });
    wc.on('did-stop-loading', () => { this.loading = false; sync(); });
    wc.on('will-navigate', (event, target) => {
      if (/^nazuna:/i.test(target) && !/^nazuna:/i.test(wc.getURL())) { event.preventDefault(); return; }
      const zagrozenie = security.sprawdz(target);
      if (zagrozenie) {
        event.preventDefault();
        this.warnUrl = target;
        wc.loadURL(security.adresOstrzezenia(zagrozenie.typ, target)).catch(() => {});
      }
    });
    // Przekierowanie po drodze (np. skrocony link prowadzacy na zlosliwa
    // domene) - to samo sprawdzenie co przy zwyklej nawigacji, tylko zanim
    // przekierowanie zdazy sie dokonac.
    wc.on('will-redirect', (event) => {
      if (!event.isMainFrame) return;
      const zagrozenie = security.sprawdz(event.url);
      if (zagrozenie) {
        event.preventDefault();
        this.warnUrl = event.url;
        wc.loadURL(security.adresOstrzezenia(zagrozenie.typ, event.url)).catch(() => {});
      }
    });
    wc.on('did-start-navigation', (event) => {
      if (!event.isMainFrame) return;
      // Zerujemy adres pokazywany zamiast strony wewnetrznej TYLKO, gdy ta
      // nawigacja nie jest naszym wlasnym przekierowaniem na nazuna://error
      // albo nazuna://warning - inaczej ta sama nawigacja, ktora go ustawila
      // chwile wczesniej, zaraz by go skasowala i pasek adresu pokazalby
      // brzydki wewnetrzny adres zamiast prawdziwego.
      if (!(this.errorUrl && event.url.startsWith('nazuna://error/'))) this.errorUrl = null;
      if (!(this.warnUrl && event.url.startsWith('nazuna://warning/'))) this.warnUrl = null;
      try { this.view.setBackgroundColor(pageBackground(event.url)); } catch (_) {}
      adblock.resetCount(wc.id);
      adblock.setDocumentHost(wc.id, event.url);
      sessions.ustawDomeneKarty(wc.id, event.url);
    });
    wc.on('did-redirect-navigation', (event) => {
      if (!event.isMainFrame) return;
      /* Przekierowanie w trakcie nawigacji zmienia host, ale nie odpala
         did-start-navigation jeszcze raz - bez tego adblock i blokada obcych
         ciasteczek dzialalyby chwile na podstawie hosta sprzed przekierowania. */
      adblock.setDocumentHost(wc.id, event.url);
      sessions.ustawDomeneKarty(wc.id, event.url);
    });
    wc.on('dom-ready', () => { adblock.applyCosmetics(wc, wc.getURL()); });
    wc.on('did-navigate', (_e, url) => {
      this.url = url;
      this.applyZoom();
      this.hadAudio = false;
      this.siteAccent = null;
      if (!this.owner.isPrivate) data.addHistory(url, this.title);
      sync();
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.url = url;
      if (!this.owner.isPrivate) data.addHistory(url, this.title);
      sync();
    });
    wc.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === -3 || !validatedURL) return;
      this.errorUrl = validatedURL;
      const params = new URLSearchParams({ url: validatedURL, code: String(code), description: description || '' });
      wc.loadURL(`nazuna://error/?${params.toString()}`).catch(() => {});
      sync();
    });
    wc.on('media-started-playing', () => { this.audible = wc.isCurrentlyAudible(); this.hadAudio = true; sync(); });
    wc.on('media-paused', () => { this.audible = false; sync(); });
    wc.on('found-in-page', (_e, result) => {
      this.findState = { matches: result.matches, active: result.activeMatchOrdinal };
      this.owner.send('find:result', this.findState);
    });
    wc.on('enter-html-full-screen', () => this.owner.setContentFullScreen(true));
    wc.on('leave-html-full-screen', () => this.owner.setContentFullScreen(false));
    wc.on('context-menu', (_e, params) => this.owner.showContextMenu(this, params));
    wc.on('before-input-event', (event, input) => this.owner.handleShortcut(event, input));
    wc.on('render-process-gone', () => { this.title = 'Karta przestała odpowiadać'; this.loading = false; sync(); });
    wc.on('destroyed', () => { adblock.forget(wc.id); sessions.zapomnijKarte(wc.id); sync(); });

    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (disposition === 'save-to-disk') return { action: 'allow' };
      const wantsPopup = disposition === 'new-window' && /width=|height=|popup/i.test(features || '');
      if (wantsPopup) {
        return {
          action: 'allow',
          outlivesOpener: false,
          overrideBrowserWindowOptions: {
            width: 520,
            height: 640,
            backgroundColor: '#101116',
            autoHideMenuBar: true,
            title: APP_NAME,
            webPreferences: {
              preload: path.join(PRELOAD_DIR, 'web.js'),
              contextIsolation: true,
              sandbox: true,
              nodeIntegrationInSubFrames: true,
              additionalArguments: pageFlags(),
              partition: this.owner.partition
            }
          }
        };
      }
      this.owner.newTab({ url, background: disposition === 'background-tab' });
      return { action: 'deny' };
    });

    wc.on('did-create-window', (child) => {
      child.setMenuBarVisibility(false);
      child.webContents.setWindowOpenHandler(({ url }) => {
        this.owner.newTab({ url });
        return { action: 'deny' };
      });
    });
  }

  /* Odpala wyliczenie koloru akcentu dla aktualnej favicony, w tle - nie
     blokuje niczego, a wynik dociera przez sync() gdy juz gotowy. Strazniczka
     na url pilnuje, zeby szybka kolejna nawigacja nie nadpisala akcentu
     nowej strony wynikiem liczonym jeszcze dla poprzedniej. */
  _updateSiteAccent() {
    if (!data.settings.get('siteAccentEnabled', true)) return;
    if (/^nazuna:/i.test(this.url)) return;
    const favicon = this.favicon;
    const urlPrzy = this.url;
    extractSiteAccent(favicon).then((accent) => {
      if (this.url !== urlPrzy || this.favicon !== favicon) return;
      this.siteAccent = accent;
      this.owner.scheduleSync();
    }).catch(() => {});
  }

  applyZoom() {
    const host = urls.hostOf(this.url);
    const stored = data.siteZoom(host);
    const factor = stored || data.settings.get('defaultZoom', 1) || 1;
    this.zoom = factor;
    try { this.wc.setZoomFactor(factor); } catch (_) {}
  }

  serialise(active) {
    const wc = this.wc && !this.wc.isDestroyed() ? this.wc : null;
    return {
      id: this.id,
      title: this.title || urls.prettyHost(this.displayUrl) || 'Nowa karta',
      url: this.displayUrl,
      favicon: this.favicon,
      loading: this.loading,
      audible: this.audible,
      muted: this.muted,
      active: !!active,
      internal: /^nazuna:/.test(this.displayUrl),
      sleeping: !!this.sleeping,
      siteAccent: this.siteAccent,
      canGoBack: wc ? wc.navigationHistory.canGoBack() : false,
      canGoForward: wc ? wc.navigationHistory.canGoForward() : false
    };
  }

  destroy() {
    try { this.wc.stop(); } catch (_) {}
    try { this.wc.close(); } catch (_) {}
    try { this.view.webContents.destroy && this.view.webContents.destroy(); } catch (_) {}
  }
}

class AppWindow {
  constructor({ isPrivate = false, urls: startUrls = [], bounds = null, puste = false } = {}) {
    this.id = nextWindowId++;
    this.isPrivate = isPrivate;
    this.partition = isPrivate ? `nazuna-private-${++privatePartitionCounter}` : 'persist:nazuna';
    this.session = sessions.forPartition(this.partition);
    this.tabs = [];
    this.activeTabId = null;
    this.findOpen = false;
    this.contentFullScreen = false;
    this.popover = null;
    this.expanded = false;
    this.fullscreenHintUntil = 0;
    this._fsTimer = null;
    this.extensionPopup = null;
    this._syncQueued = false;
    this._permissionResolvers = new Map();
    // Karta trzymana "na zapas", patrz _prepareSpare() i newTab() nizej.
    this._spareTab = null;

    const saved = bounds || data.settings.get('windowBounds', null);
    const opts = {
      width: (saved && saved.width) || 1280,
      height: (saved && saved.height) || 820,
      minWidth: 620,
      minHeight: 420,
      frame: false,
      backgroundColor: TLA[motywTeraz()].okno,
      show: false,
      title: isPrivate ? `${APP_NAME} - okno prywatne` : APP_NAME,
      icon: path.join(ASSETS_DIR, 'icon.png')
    };
    if (process.platform === 'darwin') {
      /* macOS ma wlasne kropki zamykania w lewym gornym rogu i uzytkownicy ich
         tam szukaja. Wlaczamy je zamiast naszych przyciskow z prawej strony,
         a pasek kart odsuwamy, zeby karty pod nimi nie ladowaly. */
      delete opts.frame;
      opts.titleBarStyle = 'hiddenInset';
      opts.trafficLightPosition = { x: 14, y: 13 };
    }

    if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
      /* Pozycja podana wprost (np. wyrwanie karty na inny monitor). Bierzemy
         ja tak, jak przyszla - to wspolrzedne ekranu, ktore Electron sam
         przypisze do wlasciwego monitora. Poprzednio ta galaz w ogole sie
         nie wykonywala (dawny warunek mial "&& !bounds"), wiec podane x/y
         bylo ignorowane i okno zawsze ladowalo na glownym monitorze. */
      opts.x = bounds.x; opts.y = bounds.y;
    } else if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const area = screen.getDisplayMatching(saved).workArea;
      if (saved.x < area.x + area.width && saved.y < area.y + area.height) {
        opts.x = saved.x; opts.y = saved.y;
      }
    }

    this.win = new BaseWindow(opts);

    /* Jesli ostatnio zamkniete okno bylo zmaksymalizowane, nowe startuje tak
       samo - ale tylko gdy nikt nie podal pozycji na sztywno (wyrwana karta
       na przyklad ma stanac dokladnie tam, gdzie ja puszczono, nie na cale
       ekran). Robimy to przed pokazaniem okna, wiec nic nie miga. */
    if (!bounds && data.settings.get('windowMaximized', false)) this.win.maximize();

    this.shellView = new WebContentsView({
      webPreferences: {
        preload: path.join(PRELOAD_DIR, 'shell.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        transparent: true
      }
    });
    this.shellView.setBackgroundColor('#00000000');
    this.shell = this.shellView.webContents;
    this.win.contentView.addChildView(this.shellView);   // stays on top; pages are inserted below it
    this.shell.loadFile(path.join(UI_DIR, 'shell.html'), { query: { win: String(this.id), private: String(isPrivate) } });

    this.shell.on('before-input-event', (event, input) => this.handleShortcut(event, input, true));

    /* Menu pod prawym przyciskiem bylo podpiete tylko do stron internetowych.
       Pasek adresu, pasek wyszukiwania i pasek zakladek naleza do interfejsu
       samej przegladarki, wiec klikniecie w nich prawym nie robilo nic. */
    this.shell.on('context-menu', (_e, params) => this.showShellContextMenu(params));
    this.shell.setWindowOpenHandler(({ url }) => { if (urls.bezpieczneZewnetrzne(url)) shell.openExternal(url); return { action: 'deny' }; });

    this.win.on('resize', () => this.layout());
    this.win.on('maximize', () => { this.layout(); this.scheduleSync(); });
    this.win.on('unmaximize', () => { this.layout(); this.scheduleSync(); });
    this.win.on('enter-full-screen', () => { this.layout(); this.scheduleSync(); });
    this.win.on('leave-full-screen', () => { this.layout(); this.scheduleSync(); });
    this.win.on('focus', () => this.scheduleSync());
    this.win.on('close', () => this.rememberBounds());
    this.win.on('closed', () => this.dispose());

    windows.add(this);

    this.shell.once('did-finish-load', () => {
      // Okno "puste" powstaje po to, zeby przyjac karte wyrwana z innego okna.
      // Nie tworzymy w nim nowej karty, bo za chwile dostanie gotowa.
      const list = puste ? [] : (startUrls.length ? startUrls : [data.settings.get('homepage', NEW_TAB) || NEW_TAB]);
      for (const url of list) this.newTab({ url, background: true });
      if (this.tabs.length) this.selectTab(this.tabs[0].id);
      this.layout();
      this._prepareSpare();
      /* Okno "puste" czeka na karte i pokazuje sie dopiero, gdy ja dostanie.
         Inaczej mignelo by najpierw jako pusta rama, a przy okazji drugie
         pokazanie gubilo je pod oknem, z ktorego karta wyszla. */
      if (!puste) this.win.show();
      /* Ile minelo od startu PROCESU do pokazania okna. Nie obejmuje czasu,
         ktory Windows spedza na rozpakowaniu jednoplikowej wersji, i wlasnie
         dlatego jest przydatne: gdy tu jest 400 ms, a od klikniecia ikony
         mijaja sekundy, wiadomo, ze wolne jest rozpakowywanie, nie program. */
      if (czasStartu === null) czasStartu = Math.round(process.uptime() * 1000);
      if (process.env.NAZUNA_DEBUG) console.log('[start] okno widoczne po', czasStartu, 'ms');
      this.scheduleSync();
    });
  }

  /* --------------------------------------------------------------- layout */

  chromeHeight() {
    if (this.contentFullScreen) return 0;
    let h = LAYOUT.tabStrip + LAYOUT.toolbar;
    if (data.settings.get('showBookmarksBar', true)) h += LAYOUT.bookmarksBar;
    if (this.findOpen) h += LAYOUT.findBar;
    return h;
  }

  layout() {
    if (!this.win || this.win.isDestroyed()) return;
    const { width, height } = this.win.getContentBounds();
    const top = this.chromeHeight();
    const hintVisible = !top && this.fullscreenHintUntil > Date.now();
    const shellHeight = this.expanded ? height : (top || (hintVisible ? 96 : 0));
    this.shellView.setBounds({ x: 0, y: 0, width: shellHeight ? width : 0, height: shellHeight });
    const active = this.activeTab();
    for (const tab of this.tabs) {
      // Usypiajaca karta (patrz Tab.sleep) nie ma juz swojego widoku - nie ma
      // wiec czego tu ustawiac, i nie moze byc kartą aktywna (patrz
      // usypianieCheck/selectTab), wiec zawsze wpada w ta galaz bez szkody.
      if (!tab.view) continue;
      if (tab === active) { tab.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) }); continue; }
      if (tab.audible || tab.hadAudio) {
        // Karta grajaca dzwiek w tle (patrz hadAudio wyzej) dostaje
        // prawdziwy rozmiar, tylko wysunięty poza widoczny obszar okna,
        // zamiast splaszczenia do 0x0 jak zwykla, cicha karta w tle. Widok o
        // zerowej powierzchni potrafil sprawic, ze YouTube (i pewnie inne
        // strony z wideo) po jakims czasie same resetowaly odtwarzacz, jakby
        // strona wcale nie byla wczytana - zerowy rozmiar to dla Chromium
        // znacznie mocniejszy sygnal "nikt tego nie oglada" niz zwykle
        // przelaczenie karty w prawdziwej przegladarce.
        tab.view.setBounds({ x: -width, y: top, width, height: Math.max(0, height - top) });
      } else {
        tab.view.setBounds({ x: 0, y: top, width: 0, height: 0 });
      }
    }
    this.positionExtensionPopup();
  }

  /** Interfejs to przezroczysta warstwa nad strona. Rozciaga sie na cale okno
      tylko wtedy, gdy pokazuje sie menu, lista podpowiedzi albo okienko. */
  setExpanded(on) {
    const next = !!on;
    if (this.expanded === next) return;
    this.expanded = next;
    this.layout();
  }

  rememberBounds() {
    try {
      if (this.isPrivate || this.win.isDestroyed()) return;
      const zmaksymalizowane = this.win.isMaximized() && !this.win.isFullScreen();
      /* Flaga "bylo zmaksymalizowane" zapisuje sie zawsze, niezaleznie od tego
         w jakim stanie jest teraz okno. Sam rozmiar/pozycje aktualizujemy tylko
         gdy okno jest w trybie normalnym - inaczej nadpisalibysmy zapamietany
         "zwykly" rozmiar wymiarami pelnoekranowymi. */
      data.settings.set('windowMaximized', zmaksymalizowane);
      if (!this.win.isMaximized() && !this.win.isFullScreen()) data.settings.set('windowBounds', this.win.getBounds());
      data.settings.flush();
    } catch (_) {}
  }

  /* ----------------------------------------------------------------- tabs */

  activeTab() { return this.tabs.find((t) => t.id === this.activeTabId) || null; }
  tabById(id) { return this.tabs.find((t) => t.id === id) || null; }

  /* Buduje jedna karte "na zapas" - juz zaladowana strone nowej karty,
     ale jeszcze nie dopieta do paska ani do widoku okna, wiec zupelnie
     niewidoczna. Nastepne wywolanie newTab() bierze ja gotowa (patrz nizej)
     zamiast czekac na budowe nowego procesu renderujacego od zera, co jest
     glownym powodem krotkiego mrugniecia pusta karta przy kazdym "+".
     Kosztuje to jeden dodatkowy, biezacy w tle proces na okno - kto woli
     oszczedzac pamiec, wylacza to w Ustawieniach (tabPrewarmEnabled). */
  _prepareSpare() {
    if (this._spareTab || this.win.isDestroyed()) return;
    if (!data.settings.get('tabPrewarmEnabled', true)) return;
    this._spareTab = new Tab(this, { url: NEW_TAB });
  }

  newTab({ url = NEW_TAB, background = false, index = null } = {}) {
    const resolved = url ? (urls.resolve(url) || NEW_TAB) : NEW_TAB;
    let tab;
    if (this._spareTab) {
      // Karta z zapasu jest juz zbudowana i zaladowana na nazuna://newtab -
      // gdy potrzebny jest inny adres, dokladamy jedna nawigacje na goracym
      // juz procesie zamiast budowac wszystko od zera.
      tab = this._spareTab;
      this._spareTab = null;
      tab.lastActiveAt = Date.now();
      if (resolved !== NEW_TAB) { tab.url = resolved; tab.otworz(resolved); }
    } else {
      tab = new Tab(this, { url: resolved });
    }
    if (index === null || index < 0 || index > this.tabs.length) this.tabs.push(tab);
    else this.tabs.splice(index, 0, tab);
    this.win.contentView.addChildView(tab.view, 0);
    if (!background || this.activeTabId === null) this.selectTab(tab.id);
    else this.layout();
    this.scheduleSync();
    this._prepareSpare();
    return tab;
  }

  /* Odpiecie karty od tego okna, bez zamykania jej. Karta zachowuje historie,
     przewiniecie i wszystko inne, bo przenosimy ten sam, zywy widok. */
  odepnijKarte(id) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index < 0) return null;
    const tab = this.tabs[index];
    this.tabs.splice(index, 1);
    try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
    if (this.activeTabId === id) {
      const next = this.tabs[index] || this.tabs[index - 1];
      this.activeTabId = next ? next.id : null;
      if (next) this.selectTab(next.id);
    }
    this.layout();
    this.scheduleSync();
    // Okno bez kart nie ma po co istniec. Przy wyrywaniu ten przypadek jest
    // zablokowany, ale przy przenoszeniu miedzy oknami zdarza sie normalnie.
    if (!this.tabs.length) { try { this.win.close(); } catch (_) {} }
    return tab;
  }

  /* Przyjecie karty odpietej od innego okna. Jesli karta spala (patrz
     Tab.sleep), nie ma teraz czego dopinac do widoku - selectTab() nizej i
     tak ja zaraz obudzi, a wake() sam doda swiezy widok do WLASCIWEGO okna,
     bo tab.owner jest juz ustawiony na "this" linijke wyzej. */
  przyjmijKarte(tab, index = null) {
    tab.owner = this;
    if (index === null || index < 0 || index > this.tabs.length) this.tabs.push(tab);
    else this.tabs.splice(index, 0, tab);
    if (tab.view) this.win.contentView.addChildView(tab.view, 0);
    this.selectTab(tab.id);
    this.scheduleSync();
    return tab;
  }

  selectTab(id) {
    const tab = this.tabById(id);
    if (!tab) return;
    if (tab.sleeping) tab.wake();
    tab.lastActiveAt = Date.now();
    this.activeTabId = id;
    this.closePopover();
    this.closeExtensionPopup();
    if (this.findOpen) this.findOpen = false;
    this.layout();
    try { tab.wc.focus(); } catch (_) {}
    this.scheduleSync();
  }

  closeTab(id) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const tab = this.tabs[index];
    if (!this.isPrivate && tab.url && !/^nazuna:/.test(tab.url)) {
      closedTabs.push({ url: tab.url, title: tab.title });
      if (closedTabs.length > 25) closedTabs.shift();
    }
    this.tabs.splice(index, 1);
    try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
    tab.destroy();
    if (this.activeTabId === id) {
      const next = this.tabs[index] || this.tabs[index - 1];
      this.activeTabId = next ? next.id : null;
      if (next) this.selectTab(next.id);
    }
    if (!this.tabs.length) {
      if (windows.size > 1 || this.isPrivate) this.win.close();
      else this.newTab({ url: NEW_TAB });
    }
    this.layout();
    this.scheduleSync();
  }

  moveTab(id, toIndex) {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(Math.max(0, Math.min(toIndex, this.tabs.length)), 0, tab);
    this.scheduleSync();
  }

  cycleTab(delta) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeTabId);
    const next = (i + delta + this.tabs.length) % this.tabs.length;
    this.selectTab(this.tabs[next].id);
  }

  reopenClosedTab() {
    const last = closedTabs.pop();
    if (last) this.newTab({ url: last.url });
  }

  /* ----------------------------------------------------------- navigation */

  navigate(input, tabId = null) {
    const tab = tabId ? this.tabById(tabId) : this.activeTab();
    if (!tab) return this.newTab({ url: input });
    const target = urls.resolve(input);
    if (!target) return;
    tab.errorUrl = null;
    tab.otworz(target);
  }

  /* Wstecz/dalej w historii NIE odpalaja will-navigate (Electron pomija ten
     event dla nawigacji programowej typu navigationHistory.goBack/goForward),
     wiec bez tego omijalyby security.sprawdz() - np. gdy strona trafi na
     liste zlosliwych domen dopiero PO tym, jak juz ja odwiedziles i wciaz
     jest w historii tej karty. Sprawdzamy wiec adres z historii sami, zanim
     tam faktycznie przejdziemy, zamiast wolac goBack/goForward wprost. */
  idzWHistorii(kierunek) {
    const t = this.activeTab();
    if (!t) return;
    const hist = t.wc.navigationHistory;
    const mozna = kierunek < 0 ? hist.canGoBack() : hist.canGoForward();
    if (!mozna) return;
    const cel = hist.getEntryAtIndex(hist.getActiveIndex() + kierunek);
    const zagrozenie = cel && cel.url ? security.sprawdz(cel.url) : null;
    if (zagrozenie) {
      t.warnUrl = cel.url;
      t.wc.loadURL(security.adresOstrzezenia(zagrozenie.typ, cel.url)).catch(() => {});
      return;
    }
    if (kierunek < 0) hist.goBack(); else hist.goForward();
  }

  goBack() { this.idzWHistorii(-1); }
  goForward() { this.idzWHistorii(1); }
  reload(hard = false) {
    const t = this.activeTab();
    if (!t) return;
    t.errorUrl ? t.wc.loadURL(t.errorUrl).catch(() => {}) : (hard ? t.wc.reloadIgnoringCache() : t.wc.reload());
  }
  stop() { const t = this.activeTab(); if (t) t.wc.stop(); }
  goHome() { this.navigate(data.settings.get('homepage', NEW_TAB) || NEW_TAB); }

  /* ------------------------------------------------------------- zoom etc */

  setZoom(factor) {
    const t = this.activeTab();
    if (!t) return;
    const clamped = Math.max(0.25, Math.min(5, factor));
    t.zoom = clamped;
    try { t.wc.setZoomFactor(clamped); } catch (_) {}
    data.setSiteZoom(urls.hostOf(t.url), clamped);
    this.scheduleSync();
  }

  stepZoom(direction) {
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
    const t = this.activeTab();
    if (!t) return;
    const current = t.zoom || 1;
    let idx = steps.findIndex((s) => Math.abs(s - current) < 0.01);
    if (idx < 0) idx = steps.findIndex((s) => s > current) - 1;
    idx = Math.max(0, Math.min(steps.length - 1, idx + direction));
    this.setZoom(steps[idx]);
  }

  toggleMute() {
    const t = this.activeTab();
    if (!t) return;
    t.muted = !t.muted;
    t.wc.setAudioMuted(t.muted);
    this.scheduleSync();
  }

  setContentFullScreen(on) {
    this.contentFullScreen = on;
    clearTimeout(this._fsTimer);
    if (on) {
      // Strona nie moze udawac przegladarki bez slowa. Pokazujemy, jak wyjsc.
      this.fullscreenHintUntil = Date.now() + 4000;
      this.send('fullscreen:hint');
      this._fsTimer = setTimeout(() => { this.fullscreenHintUntil = 0; this.layout(); }, 4200);
    } else {
      this.fullscreenHintUntil = 0;
    }
    this.layout();
    this.scheduleSync();
  }

  toggleFullScreen() {
    this.win.setFullScreen(!this.win.isFullScreen());
  }

  /* ------------------------------------------------------------- find bar */

  openFind() {
    this.findOpen = true;
    this.layout();
    this.scheduleSync();
    try { this.shell.focus(); } catch (_) {}
    this.send('find:focus');
  }

  closeFind() {
    if (!this.findOpen) return;
    this.findOpen = false;
    const t = this.activeTab();
    if (t) { try { t.wc.stopFindInPage('clearSelection'); } catch (_) {} t.findState = null; }
    this.layout();
    this.scheduleSync();
  }

  /* Uwaga na Electrona: findNext:true zaczyna NOWA sesje wyszukiwania,
     findNext:false przechodzi do kolejnego trafienia w już trwającej. */
  find(text, options = {}) {
    const t = this.activeTab();
    if (!t || t.wc.isDestroyed()) return;
    if (!text) { try { t.wc.stopFindInPage('clearSelection'); } catch (_) {} return; }
    try {
      t.wc.findInPage(text, {
        forward: options.forward !== false,
        findNext: options.newSession !== false,
        matchCase: !!options.matchCase
      });
    } catch (err) {
      console.warn('[find]', err.message);
    }
  }

  /* -------------------------------------------------------------- popovers */

  openPopover(name, payload = {}) {
    this.popover = name;
    this.setExpanded(true);
    this.send('popover:show', { name, payload });
    try { this.shell.focus(); } catch (_) {}
  }

  closePopover() {
    const had = !!this.popover;
    this.popover = null;
    this.send('popover:hide');          // zawsze, zeby interfejs nie zostal z wiszacym okienkiem
    this.setExpanded(false);
    this.scheduleSync();
    if (!had) return;
    /* Po zamknieciu zwyklego okienka kursor wraca na strone. Ale gdy menu
       wyszlo z paska adresu, ma wrocic wlasnie tam, inaczej po wklejeniu nie
       dalo by sie wcisnac Enter. */
    if (this._menuZPaska) {
      this._menuZPaska = false;
      try { this.shell.focus(); } catch (_) {}
      return;
    }
    const t = this.activeTab();
    if (t) { try { t.wc.focus(); } catch (_) {} }
  }

  showShellContextMenu(params) {
    const items = buildShellContextMenu(params);
    if (!items.length) return;
    this._contextParams = { tab: null, params, wc: this.shell };
    this._menuZPaska = true;
    // Wspolrzedne sa juz liczone wzgledem interfejsu, wiec bez przesuniecia.
    this.openPopover('context', { x: params.x, y: params.y, items });
  }

  showContextMenu(tab, params) {
    const items = buildContextMenu(this, tab, params);
    this._contextParams = { tab, params, wc: tab.wc };
    this.openPopover('context', { x: params.x, y: params.y + this.chromeHeight(), items });
  }

  async requestPermission({ permission, origin, strona, osadzona }) {
    return new Promise((resolve) => {
      const key = `${origin}|${permission}|${Date.now()}`;
      this._permissionResolvers.set(key, resolve);
      this.openPopover('permission', { key, permission, origin, strona, osadzona });
    });
  }

  resolvePermission(key, answer, remember) {
    const resolve = this._permissionResolvers.get(key);
    if (!resolve) return;
    this._permissionResolvers.delete(key);
    const [origin, permission] = key.split('|');
    /* W oknie prywatnym nic nie zapisujemy na stale - inaczej "zapamietaj"
       zaznaczone w trybie prywatnym przetrwaloby zamkniecie okna i wplywalo
       na zwykle przegladanie, co jest dokladnie tym, czego tryb prywatny ma
       unikac. */
    if (remember && !this.isPrivate) data.setPermission(origin, permission, answer);
    this.closePopover();
    resolve(answer);
  }

  /* ----------------------------------------------------- extension popups */

  async openExtensionPopup(id, rect) {
    const record = extensions.records().find((e) => e.id === id);
    if (!record) return;
    const info = extensions.describe(record);
    if (!info.popup) return;
    this.closeExtensionPopup();

    const view = new WebContentsView({
      webPreferences: {
        partition: this.partition,
        // Popup nie ma wlasnego preloadu, a chrome.* dostarcza natywnie
        // session.loadExtension() (patrz session.js) - wiec bezpieczne
        // domyslne ustawienia Electrona nic tu nie psuja. Tak samo robi to
        // referencyjna biblioteka electron-chrome-extensions.
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });
    view.setBackgroundColor('#ffffff');
    this.extensionPopup = { view, rect, id, width: 380, height: 560 };
    this.win.contentView.addChildView(view);
    this.positionExtensionPopup();
    const target = `chrome-extension://${info.runtimeId || id}/${String(info.popup).replace(/^\/+/, '')}`;
    view.webContents.loadURL(target).catch(() => this.closeExtensionPopup());
    view.webContents.setWindowOpenHandler(({ url }) => { this.newTab({ url }); this.closeExtensionPopup(); return { action: 'deny' }; });
    view.webContents.once('did-finish-load', async () => {
      try {
        const size = await view.webContents.executeJavaScript(`(() => {
          const body = document.body;
          if (!body) return null;
          const rect = body.getBoundingClientRect();
          const styles = getComputedStyle(body);
          const explicit = styles.width && styles.width !== 'auto' && !styles.width.includes('%');
          return {
            w: Math.ceil(Math.max(rect.width, body.scrollWidth)),
            h: Math.ceil(Math.max(rect.height, body.scrollHeight)),
            explicit: !!explicit
          };
        })()`);
        if (this.extensionPopup && size) {
          const width = size.explicit && size.w > 40 ? size.w : Math.max(320, Math.min(760, size.w || 380));
          this.extensionPopup.width = Math.min(780, Math.max(200, width));
          this.extensionPopup.height = Math.min(640, Math.max(90, size.h || 400));
          this.positionExtensionPopup();
        }
      } catch (_) {}
      try { view.webContents.focus(); } catch (_) {}
    });
    // Rozwiniecie warstwy interfejsu daje nam obszar wylapujacy klikniecia za okienkiem.
    this.popover = 'ext-popup';
    this.setExpanded(true);
    this.send('popover:show', { name: 'ext-popup', payload: { id } });
  }

  positionExtensionPopup() {
    if (!this.extensionPopup || !this.win || this.win.isDestroyed()) return;
    const { width: winW, height: winH } = this.win.getContentBounds();
    const { rect, width, height, view } = this.extensionPopup;
    const anchorRight = rect && rect.x !== undefined ? rect.x + (rect.width || 0) : winW - 8;
    const anchorBottom = rect && rect.y !== undefined ? rect.y + (rect.height || 0) : this.chromeHeight();
    const x = Math.max(8, Math.min(winW - width - 8, Math.round(anchorRight - width)));
    const y = Math.max(0, Math.min(winH - height - 8, Math.round(anchorBottom + 6)));
    view.setBounds({ x, y, width, height });
  }

  closeExtensionPopup() {
    if (!this.extensionPopup) return;
    const { view } = this.extensionPopup;
    this.extensionPopup = null;
    try { this.win.contentView.removeChildView(view); } catch (_) {}
    try { view.webContents.close(); } catch (_) {}
    if (this.popover === 'ext-popup') { this.popover = null; this.send('popover:hide'); this.setExpanded(false); }
  }

  /* ------------------------------------------------------------ shortcuts */

  handleShortcut(event, input, fromChrome = false) {
    if (input.type !== 'keyDown') return;
    const ctrl = process.platform === 'darwin' ? input.meta : input.control;
    const shift = input.shift;
    const alt = input.alt;
    const key = (input.key || '').toLowerCase();
    const stop = () => { event.preventDefault(); };

    if (key === 'escape') {
      if (fromChrome) {
        // Interfejs obsluguje wlasny Escape, ale warstwa ma sie zwinac tak czy siak.
        if (this.extensionPopup) this.closeExtensionPopup();
        else if (this.expanded) this.closePopover();
        return;
      }
      if (this.extensionPopup) { this.closeExtensionPopup(); return stop(); }
      if (this.popover) { this.closePopover(); return stop(); }
      if (this.findOpen) { this.closeFind(); return stop(); }
      if (this.contentFullScreen) { this.setContentFullScreen(false); return stop(); }
      return;
    }

    if (ctrl && !shift && !alt) {
      switch (key) {
        case 't': this.newTab({ url: NEW_TAB }); return stop();
        case 'w': this.closeTab(this.activeTabId); return stop();
        case 'n': createWindow({ isPrivate: false }); return stop();
        case 'l': this.send('focus:address'); return stop();
        case 'f': this.openFind(); return stop();
        case 'r': this.reload(false); return stop();
        case 'd': this.toggleBookmark(); return stop();
        case 'h': this.newTab({ url: 'nazuna://history' }); return stop();
        case 'j': this.toggleDownloadsPanel(); return stop();
        case 'p': { const t = this.activeTab(); if (t) t.wc.print({}, () => {}); return stop(); }
        case 'tab': this.cycleTab(1); return stop();
        case '0': this.setZoom(1); return stop();
        case '+': case '=': this.stepZoom(1); return stop();
        case '-': this.stepZoom(-1); return stop();
        default: break;
      }
      if (/^[1-8]$/.test(key)) { const t = this.tabs[parseInt(key, 10) - 1]; if (t) this.selectTab(t.id); return stop(); }
      if (key === '9') { const t = this.tabs[this.tabs.length - 1]; if (t) this.selectTab(t.id); return stop(); }
    }

    if (ctrl && shift && !alt) {
      switch (key) {
        case 't': this.reopenClosedTab(); return stop();
        case 'n': createWindow({ isPrivate: true }); return stop();
        case 'r': this.reload(true); return stop();
        case 'i': { const t = this.activeTab(); if (t) t.wc.toggleDevTools(); return stop(); }
        case 'tab': this.cycleTab(-1); return stop();
        case 'o': this.newTab({ url: 'nazuna://bookmarks' }); return stop();
        case 'm': this.toggleMute(); return stop();
        case 'delete': this.newTab({ url: 'nazuna://settings' }); return stop();
        default: break;
      }
    }

    if (alt && !ctrl) {
      if (key === 'arrowleft') { this.goBack(); return stop(); }
      if (key === 'arrowright') { this.goForward(); return stop(); }
      if (key === 'home') { this.goHome(); return stop(); }
    }

    if (key === 'f5') { this.reload(shift); return stop(); }
    if (key === 'f11') { this.toggleFullScreen(); return stop(); }
    if (key === 'f12') { const t = this.activeTab(); if (t) t.wc.toggleDevTools(); return stop(); }
    if (key === 'f3') { this.openFind(); return stop(); }
    if (key === 'browserback') { this.goBack(); return stop(); }
    if (key === 'browserforward') { this.goForward(); return stop(); }
  }

  /* ------------------------------------------------------------ bookmarks */

  toggleBookmark() {
    const t = this.activeTab();
    if (!t || /^nazuna:/.test(t.url)) return;
    if (data.isBookmarked(t.url)) data.removeBookmarkByUrl(t.url);
    else data.addBookmark({ title: t.title, url: t.url });
    this.scheduleSync();
    broadcastAll('bookmarks:changed');
  }

  toggleDownloadsPanel() {
    if (this.popover === 'downloads') this.closePopover();
    else this.openPopover('downloads', {});
  }

  /* ----------------------------------------------------------------- sync */

  send(channel, payload) {
    if (this.shell && !this.shell.isDestroyed()) this.shell.send(channel, payload);
  }

  scheduleSync() {
    if (this._syncQueued) return;
    this._syncQueued = true;
    setTimeout(() => {
      this._syncQueued = false;
      this.sync();
    }, 16);
  }

  state() {
    const active = this.activeTab();
    const bounds = this.win && !this.win.isDestroyed() ? this.win.getContentBounds() : { width: 1280, height: 800 };
    const host = active ? urls.hostOf(active.displayUrl) : '';
    return {
      windowId: this.id,
      isPrivate: this.isPrivate,
      maximized: this.win && !this.win.isDestroyed() ? this.win.isMaximized() : false,
      fullscreen: this.win && !this.win.isDestroyed() ? this.win.isFullScreen() : false,
      contentFullScreen: this.contentFullScreen,
      tabs: this.tabs.map((t) => t.serialise(t.id === this.activeTabId)),
      activeTabId: this.activeTabId,
      url: active ? active.displayUrl : '',
      host,
      secure: active ? /^https:/.test(active.displayUrl) : false,
      // Etykieta "Niezabezpieczona" idzie razem z przelacznikiem ostrzezen w
      // Ustawieniach - wylaczona ochrona, wylaczona i etykieta, zeby jedno
      // nie przeczylo drugiemu.
      insecure: active && data.settings.get('securityWarningsEnabled', true) ? /^http:/i.test(active.displayUrl) : false,
      internal: active ? /^nazuna:/.test(active.displayUrl) : false,
      loading: active ? active.loading : false,
      canGoBack: active && !active.wc.isDestroyed() ? active.wc.navigationHistory.canGoBack() : false,
      canGoForward: active && !active.wc.isDestroyed() ? active.wc.navigationHistory.canGoForward() : false,
      bookmarked: active ? data.isBookmarked(active.displayUrl) : false,
      zoom: active ? active.zoom : 1,
      findOpen: this.findOpen,
      showBookmarksBar: data.settings.get('showBookmarksBar', true),
      bookmarks: data.bookmarkList(),
      adblockEnabled: data.settings.get('adblockEnabled', true),
      adblockMode: data.settings.get('adblockMode', 'safe'),
      adblockSite: host ? data.adblockAllowed(host) : true,
      blockedCount: active && !active.wc.isDestroyed() ? adblock.getCount(active.wc.id) : 0,
      muted: active ? active.muted : false,
      siteAccent: active ? active.siteAccent : null,
      extensions: (!this.isPrivate && data.settings.get('extensionsEnabled', true)) ? extensions.list().filter((e) => e.enabled) : [],
      settings: data.settings.data,
      motyw: rozstrzygnijMotyw(data.settings.get('theme', 'dark')),
      przeciaganie: !!this.przeciaganieKarty,
      zeton: ZETON,
      viewport: { width: bounds.width, height: bounds.height },
      popover: this.popover,
      expanded: this.expanded,
      chromeHeight: this.chromeHeight(),
      layout: LAYOUT
    };
  }

  sync() {
    if (!this.win || this.win.isDestroyed()) return;
    const state = this.state();
    this.send('state', state);
    const active = this.activeTab();
    try {
      // Okno prywatne mowi to o sobie w tytule, zeby dalo sie je odroznic na
      // pasku zadan, gdy oba wygladaja tak samo.
      const nazwa = this.isPrivate ? `${APP_NAME} - okno prywatne` : APP_NAME;
      this.win.setTitle(active ? `${active.title || 'Nowa karta'} - ${nazwa}` : nazwa);
    } catch (_) {}
  }

  dispose() {
    for (const tab of this.tabs) tab.destroy();
    this.tabs = [];
    if (this._spareTab) { this._spareTab.destroy(); this._spareTab = null; }
    windows.delete(this);
  }
}

/* ------------------------------------------------------------ context menu */

/* Menu dla interfejsu samej przegladarki: pasek adresu, wyszukiwanie na
   stronie, pasek zakladek. Celowo waskie, bo w naszym pasku nie ma linkow ani
   obrazkow, sa tylko pola tekstowe i etykiety. */
function buildShellContextMenu(params) {
  const items = [];
  const flags = params.editFlags || {};
  if (params.isEditable) {
    items.push({ id: 'undo', label: 'Cofnij', accel: 'Ctrl+Z', enabled: !!flags.canUndo });
    items.push({ id: 'redo', label: 'Ponów', accel: 'Ctrl+Y', enabled: !!flags.canRedo });
    items.push({ type: 'separator' });
    items.push({ id: 'cut', label: 'Wytnij', accel: 'Ctrl+X', enabled: !!flags.canCut });
    items.push({ id: 'copy', label: 'Kopiuj', accel: 'Ctrl+C', enabled: !!flags.canCopy });
    items.push({ id: 'paste', label: 'Wklej', accel: 'Ctrl+V', enabled: !!flags.canPaste });
    if (flags.canPaste && String(clipboard.readText() || '').trim()) {
      items.push({ id: 'paste-go', label: 'Wklej i przejdź' });
    }
    items.push({ type: 'separator' });
    items.push({ id: 'select-all', label: 'Zaznacz wszystko', accel: 'Ctrl+A', enabled: !!flags.canSelectAll });
    return items;
  }
  if (params.selectionText && params.selectionText.trim()) {
    items.push({ id: 'copy', label: 'Kopiuj', accel: 'Ctrl+C' });
  }
  return items;
}

function buildContextMenu(appWindow, tab, params) {
  const items = [];
  const add = (item) => items.push(item);
  const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') add({ type: 'separator' }); };

  if (params.linkURL) {
    add({ id: 'open-link-tab', label: 'Otwórz w nowej karcie' });
    add({ id: 'open-link-window', label: 'Otwórz w nowym oknie' });
    add({ id: 'open-link-private', label: 'Otwórz w oknie prywatnym' });
    add({ id: 'copy-link', label: 'Kopiuj adres linku' });
    add({ id: 'save-link', label: 'Zapisz link jako...' });
    sep();
  }
  if (params.mediaType === 'image') {
    add({ id: 'open-image', label: 'Otwórz obraz w nowej karcie' });
    add({ id: 'copy-image', label: 'Kopiuj obraz' });
    add({ id: 'copy-image-url', label: 'Kopiuj adres obrazu' });
    add({ id: 'save-image', label: 'Zapisz obraz jako...' });
    sep();
  }
  if (params.mediaType === 'video' || params.mediaType === 'audio') {
    add({ id: 'copy-media-url', label: 'Kopiuj adres multimediów' });
    add({ id: 'save-media', label: 'Zapisz jako...' });
    sep();
  }
  if (params.isEditable) {
    add({ id: 'undo', label: 'Cofnij', accel: 'Ctrl+Z', enabled: params.editFlags.canUndo });
    add({ id: 'redo', label: 'Ponów', accel: 'Ctrl+Y', enabled: params.editFlags.canRedo });
    sep();
    add({ id: 'cut', label: 'Wytnij', accel: 'Ctrl+X', enabled: params.editFlags.canCut });
    add({ id: 'copy', label: 'Kopiuj', accel: 'Ctrl+C', enabled: params.editFlags.canCopy });
    add({ id: 'paste', label: 'Wklej', accel: 'Ctrl+V', enabled: params.editFlags.canPaste });
    add({ id: 'select-all', label: 'Zaznacz wszystko', accel: 'Ctrl+A', enabled: params.editFlags.canSelectAll });
    sep();
  } else if (params.selectionText) {
    add({ id: 'copy', label: 'Kopiuj', accel: 'Ctrl+C' });
    const snippet = params.selectionText.trim().slice(0, 28);
    add({ id: 'search-selection', label: `Szukaj: "${snippet}${params.selectionText.trim().length > 28 ? '...' : ''}"` });
    sep();
  }
  if (!params.linkURL && !params.isEditable && params.mediaType === 'none' && !params.selectionText) {
    add({ id: 'back', label: 'Wstecz', accel: 'Alt+\u2190', enabled: tab.wc.navigationHistory.canGoBack() });
    add({ id: 'forward', label: 'Dalej', accel: 'Alt+\u2192', enabled: tab.wc.navigationHistory.canGoForward() });
    add({ id: 'reload', label: 'Odśwież', accel: 'F5' });
    sep();
    add({ id: 'save-page', label: 'Zapisz stronę jako...' });
    add({ id: 'print', label: 'Drukuj...', accel: 'Ctrl+P' });
    sep();
  }
  add({ id: 'inspect', label: 'Zbadaj element', accel: 'F12' });
  return items;
}

function runContextAction(appWindow, id) {
  const ctx = appWindow._contextParams;
  if (!ctx) return;
  const { tab, params } = ctx;
  const wc = ctx.wc || (tab && tab.wc);
  if (!wc) return;
  switch (id) {
    case 'open-link-tab': appWindow.newTab({ url: params.linkURL, background: true }); break;
    case 'open-link-window': createWindow({ urls: [params.linkURL] }); break;
    case 'open-link-private': createWindow({ isPrivate: true, urls: [params.linkURL] }); break;
    case 'copy-link': clipboard.writeText(params.linkURL); break;
    case 'save-link': wc.downloadURL(params.linkURL); break;
    case 'open-image': appWindow.newTab({ url: params.srcURL, background: true }); break;
    case 'copy-image': wc.copyImageAt(params.x, params.y); break;
    case 'copy-image-url': clipboard.writeText(params.srcURL); break;
    case 'save-image': case 'save-media': wc.downloadURL(params.srcURL); break;
    case 'copy-media-url': clipboard.writeText(params.srcURL); break;
    case 'undo': wc.undo(); break;
    case 'redo': wc.redo(); break;
    case 'cut': wc.cut(); break;
    case 'copy': wc.copy(); break;
    case 'paste': wc.paste(); break;
    case 'select-all': wc.selectAll(); break;
    case 'paste-go': {
      const tekst = String(clipboard.readText() || '').trim();
      if (tekst) appWindow.navigate(tekst);   // navigate sam rozwiazuje adres
      break;
    }
    case 'search-selection': appWindow.newTab({ url: urls.searchUrl(params.selectionText.trim()), background: false }); break;
    case 'back': appWindow.goBack(); break;
    case 'forward': appWindow.goForward(); break;
    case 'reload': appWindow.reload(); break;
    case 'save-page': wc.downloadURL(wc.getURL()); break;
    case 'print': wc.print({}, () => {}); break;
    case 'inspect': wc.inspectElement(params.x, params.y); break;
    default: break;
  }
  appWindow.closePopover();
}

/* Wyrwanie karty do osobnego okna, zeby dalo sie ja przerzucic na drugi ekran.
   Okno pojawia sie tam, gdzie puscisz karte. Gdy w oknie zrodlowym jest tylko
   ta jedna karta, nie robimy nic: powstaloby okno identyczne z obecnym. */
function wyrwijKarte(zrodlo, tabId, x, y) {
  if (!zrodlo || zrodlo.tabs.length <= 1) return null;
  const stare = zrodlo.win.getBounds();
  const tab = zrodlo.odepnijKarte(tabId);
  if (!tab) return null;

  // Nowe okno ma rozmiar poprzedniego i siedzi kursorem mniej wiecej tam,
  // gdzie karta byla trzymana.
  const bounds = {
    width: stare.width,
    height: stare.height,
    x: Math.round(x - stare.width * 0.25),
    y: Math.round(y - 16)
  };
  const nowe = new AppWindow({ isPrivate: zrodlo.isPrivate, puste: true, bounds });
  const podepnij = () => {
    nowe.przyjmijKarte(tab);
    nowe.layout();
    try {
      nowe.win.show();
      // Samo show() nie zawsze wynosi okno na wierzch, gdy poprzednie wlasnie
      // oddaje mysz. moveTop() robi to wprost.
      nowe.win.moveTop();
      nowe.win.focus();
    } catch (_) {}
  };
  if (nowe.shell.isLoading()) nowe.shell.once('did-finish-load', () => setTimeout(podepnij, 0));
  else podepnij();
  return nowe;
}

/* Przeniesienie karty do innego, juz istniejacego okna. */
/* Ktore okno lezy pod danym punktem ekranu. Uzywane przy przeciaganiu karty:
   przegladarka prowadzi je sama, bo systemowe przenoszenie nie donosi zdarzen
   miedzy dwoma jej wlasnymi oknami. Gdy okna zachodza na siebie, wybieramy to,
   ktorego srodek jest blizej kursora. */
function oknoPodPunktem(x, y) {
  let najlepsze = null;
  let najblizej = Infinity;
  for (const w of windows) {
    if (!w.win || w.win.isDestroyed()) continue;
    let b;
    try { b = w.win.getBounds(); } catch (_) { continue; }
    if (x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height) continue;
    const dx = x - (b.x + b.width / 2);
    const dy = y - (b.y + b.height / 2);
    const d = dx * dx + dy * dy;
    if (d < najblizej) { najblizej = d; najlepsze = w; }
  }
  return najlepsze;
}

/* Czy punkt trafia w pasek kart tego okna. */
function wPasku(w, y) {
  try {
    const b = w.win.getBounds();
    return y >= b.y && y <= b.y + LAYOUT.tabStrip + 6;
  } catch (_) { return false; }
}

function przeniesKarte(tabId, celWin, index) {
  const id = Number(tabId);
  const zrodlo = [...windows].find((w) => w.tabs.some((t) => t.id === id));
  if (!zrodlo || !celWin || celWin.win.isDestroyed()) return null;
  if (zrodlo === celWin) { celWin.moveTab(id, index); return celWin; }
  /* Okno prywatne ma wlasny, ulotny magazyn danych. Karta przeniesiona do
     zwyklego okna wygladalaby na zwykla, bedac dalej prywatna, i odwrotnie.
     Mieszania nie ma, w obie strony. */
  if (zrodlo.isPrivate !== celWin.isPrivate) return null;
  const tab = zrodlo.odepnijKarte(id);
  if (!tab) return null;
  celWin.przyjmijKarte(tab, index);
  try { celWin.win.focus(); } catch (_) {}
  return celWin;
}

function createWindow(opts = {}) {
  const w = new AppWindow(opts);
  return w;
}

/* -------------------------------------------------------- usypianie kart */

// Karta w tle dluzej niz tyle usypia sama (patrz Tab.sleep/Tab.wake wyzej).
// Sprawdzamy co minute - i tak dosc czesto, zeby nikt nie zauwazyl opoznienia,
// a nie ma sensu robic tego czesciej.
const TAB_SLEEP_MS = 20 * 60 * 1000;
const TAB_SLEEP_CHECK_MS = 60 * 1000;

function usypianieCheck() {
  if (!data.settings.get('tabSleepEnabled', true)) return;
  const now = Date.now();
  for (const win of windows) {
    if (win.tabs.length <= 1) continue;
    for (const tab of win.tabs) {
      if (tab.sleeping || tab.id === win.activeTabId || tab.audible || tab.loading) continue;
      // Karta, ktora choc raz odtworzyla dzwiek (film, muzyka), zostaje
      // wylaczona z usypiania na dobre, nawet gdy w danej chwili jest tylko
      // zapauzowana - to wlasnie taka karta ("obejrze to pozniej") najbardziej
      // chcemy zostawic w spokoju, a usniecie oznacza dla niej pelne
      // przeladowanie i zgubienie miejsca w odtwarzaczu (patrz hadAudio wyzej).
      if (tab.hadAudio) continue;
      // Strony nazuna:// (nowa karta, historia, ustawienia...) same w sobie
      // sa tanie - nie ma czego tu oszczedzac, a usypianie panelu, ktory
      // zyje z odswiezania na biezaco (np. pobrane), tylko by przeszkadzalo.
      if (/^nazuna:/.test(tab.url)) continue;
      if (now - tab.lastActiveAt < TAB_SLEEP_MS) continue;
      tab.sleep();
    }
  }
}

function startTabSleep() {
  setInterval(usypianieCheck, TAB_SLEEP_CHECK_MS);
}

/* Po zmianie motywu trzeba przemalowac to, co maluje sie poza stronami:
   tlo okna i tla naszych wlasnych kart. Inaczej stary kolor siedzi tam az do
   ponownego uruchomienia i przy przelaczaniu kart widac blysk. */
function repaintTheme() {
  const tlo = TLA[motywTeraz()].okno;
  for (const w of windows) {
    try { w.win.setBackgroundColor(tlo); } catch (_) {}
    for (const t of w.tabs) {
      try { t.view.setBackgroundColor(pageBackground(t.url)); } catch (_) {}
    }
  }
}

// Gdy uzytkownik wybral "jak w systemie", zmiana w Windowsie ma dzialac od razu.
try {
  nativeTheme.on('updated', () => {
    if (data.settings.get('theme', 'dark') !== 'system') return;
    repaintTheme();
    for (const w of windows) w.scheduleSync();
    broadcastAll('settings:changed');
  });
} catch (_) {}

/* Kanaly, ktore musza dotrzec tez do tresci naszych wlasnych kart (nazuna://),
   nie tylko do samej ramki przegladarki: przelaczenie motywu ma byc widac od
   razu we wszystkich otwartych kartach, tak samo zmiana kafelkow nowej karty,
   gdy kilka okien ma otwarte "Nowa karta" naraz. */
const DO_WLASNYCH_KART = new Set(['settings:changed', 'skroty:zmiana', 'update:status']);

function broadcastAll(channel, payload) {
  for (const w of windows) {
    w.send(channel, payload);
    if (channel === 'bookmarks:changed' || channel === 'settings:changed') w.scheduleSync();
    if (!DO_WLASNYCH_KART.has(channel)) continue;
    for (const t of w.tabs) {
      if (!t.wc || t.wc.isDestroyed()) continue;
      if (!/^nazuna:/i.test(String(t.url || ''))) continue;
      try { t.wc.send(channel, payload); } catch (_) {}
    }
  }
}

module.exports = { AppWindow, createWindow, wyrwijKarte, przeniesKarte, oknoPodPunktem, wPasku, startMs, ZETON, zacznijPrzeciaganie, odbierzPrzeciaganie, allWindows, focusedWindow, windows, runContextAction, broadcastAll, repaintTheme, NEW_TAB, closedTabs, startTabSleep };
