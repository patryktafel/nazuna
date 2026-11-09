'use strict';
const path = require('path');
const crypto = require('crypto');
const { app, BaseWindow, WebContentsView, BrowserWindow, shell, screen, clipboard, nativeImage, nativeTheme, net, dialog } = require('electron');
const { LAYOUT, PRELOAD_DIR, ASSETS_DIR, APP_NAME, rozstrzygnijMotyw, zrodloMotywuStron, TLA } = require('./constants');
const data = require('./data');
const urls = require('./urls');
const sessions = require('./session');
const adblock = require('./adblock');
const extensions = require('./extensions');
const security = require('./security');
const starttrace = require('./starttrace');
const diagnostics = require('./diagnostics');
const monitory = require('./monitory');
const downloads = require('./downloads');

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
/* Ziarno losowe do domykania odcisku przegladarki (fingerprintingu) w
   preload/web.js - jedno na cale uruchomienie programu, wspolne dla
   wszystkich kart i okien. Preload miesza je z domena kazdej odwiedzanej
   strony, wiec kazda strona dostaje inny, ale za to STALY (nie skaczacy przy
   kazdym przeladowaniu) odczyt z canvasu/WebGL/audio - to wlasnie ta
   stalosc w obrebie jednej domeny odroznia sensowna ochrone od czegos, co
   psuloby zwykle strony. Nowe ziarno przy kazdym starcie Nazuny znaczy, ze
   ten "fałszywy" odcisk tez sie zmienia miedzy uruchomieniami. */
const fpSeed = crypto.randomBytes(8).toString('hex');

/* Okno prywatne dostaje wlasne ziarno, osobne dla kazdej partycji. Przy wspolnym
   ta sama strona widziala identyczny odcisk w oknie zwyklym i prywatnym, wiec
   mogla polaczyc wizyte prywatna z kontem. Wyliczane z ziarna i nazwy partycji:
   wszystkie karty partycji (tez wyrwane i obudzone) maja ten sam, staly odczyt. */
function ziarnoOdcisku(partition) {
  if (!partition || partition.startsWith('persist:')) return fpSeed;
  return crypto.createHash('sha256').update(`${fpSeed}|${partition}`).digest('hex').slice(0, 16);
}

function pageFlags(partition) {
  const flags = [];
  if (!data.settings.get('passkeys', false)) flags.push('--nazuna-bez-kluczy');
  if (data.settings.get('fingerprintProtection', true)) flags.push(`--nazuna-fp-seed=${ziarnoOdcisku(partition)}`);
  flags.push(...sessions.flagiObcychCiasteczek(partition));
  return flags;
}

/* Adresy zakladek z menu do gwiazdki w pasku. state() idzie przy kazdym
   odswiezeniu paska, a data.isBookmarked liczy cala liste od nowa, wiec przy
   tysiacach zakladek przycinalo. Kasowane w broadcastAll('bookmarks:changed'). */
let adresyMenuZakladek = null;
function wMenuZakladek(url) {
  if (!adresyMenuZakladek) {
    adresyMenuZakladek = new Set(data.bookmarkList()
      .filter((b) => b.type === 'link' && data.miejsceZakladki(b.parent) === 'menu')
      .map((b) => b.url));
  }
  return adresyMenuZakladek.has(url);
}

function motywTeraz() {
  return rozstrzygnijMotyw(data.settings.get('theme', 'dark'), data.settings.get('wyglad', 'mgla'));
}

/* Kolor malowany pod strona, zanim zdazy sie wyrysowac. Zwykle strony sa biale,
   wiec bialy; nasze wlasne strony ida za motywem, zeby przy otwieraniu karty
   nie mrugalo przeciwnym kolorem. */
function pageBackground(url, prywatne = false) {
  if (!/^(nazuna|devtools):/i.test(String(url || ''))) return '#ffffff';
  return tloOkna(prywatne);
}

/* Okno prywatne w mgle ma ciemniejsze, chlodne tlo (jak jego pasek, koniec
   shell.css i pages.css) - tu kolor malowany, zanim strona sie narysuje. */
function tloOkna(prywatne = false) {
  const motyw = motywTeraz();
  if (prywatne && motyw === 'mgla') return '#0a0b12';
  return TLA[motyw].okno;
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
  /* Bez fokusu najpierw okno widoczne: okno jeszcze niepokazane (w trakcie
     budowania albo czekajace na wyrwana karte) nie powinno lapac linkow
     z innych programow, bo ich nie widac. */
  const zywe = [...windows].filter((w) => w.win && !w.win.isDestroyed());
  return zywe.find((w) => w.win.isFocused()) || zywe.find((w) => w.win.isVisible()) || [...windows][0] || null;
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
async function extractSiteAccent(faviconUrl, ses) {
  if (!/^https?:\/\//i.test(String(faviconUrl || ''))) return null;
  let host;
  try { host = new URL(faviconUrl).hostname; } catch (_) { return null; }
  if (siteAccentCache.has(host)) return siteAccentCache.get(host);
  try {
    /* Przez sesje tej samej karty, nie przez domyslna. Inaczej ikona strony
       otwartej w oknie prywatnym szla przez zwykly profil, z jego
       ciasteczkami i pamiecia podreczna - zostawal wiec po niej slad. */
    const res = await (ses ? ses.fetch(faviconUrl, { redirect: 'follow' }) : net.fetch(faviconUrl, { redirect: 'follow' }));
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

/* ------------------------------------------------ blokada wyskakujacych okien
   Electron, w odroznieniu od Chrome, nie ma wlasnej blokady: dowolny skrypt
   (najczesciej reklama) mogl w kazdej chwili otworzyc nowa karte albo okno,
   bez zadnego klikniecia. Robimy to tak jak Chrome: strona moze otworzyc
   nowe okno/karte tylko chwile (AKTYWACJA_MS) po prawdziwym kliknieciu albo
   nacisnieciu klawisza w niej samej, i tylko jedno na jedno klikniecie
   (klikniecie sie "zuzywa"). Kliknieciem jest tylko prawdziwe wejscie z
   myszy/klawiatury, ktore przechodzi przez proces glowny - strona nie
   podrobi go zdarzeniem wygenerowanym w JavaScripcie. Zablokowane okno
   mozna otworzyc z powiadomienia w rogu (patrz 'popup-blocked' w shell.js). */
const AKTYWACJA_MS = 5000;
const aktywacje = new WeakMap();   // webContents -> czas ostatniego prawdziwego wejscia
function sledzAktywnosc(wc) {
  wc.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key !== 'Escape') aktywacje.set(wc, Date.now());
  });
  wc.on('before-mouse-event', (_e, mysz) => {
    if (mysz && (mysz.type === 'mouseDown' || mysz.type === 'mouseUp')) aktywacje.set(wc, Date.now());
  });
}
/* Protokoly, ktorych strona nigdy nie odpali w Windows (lista jak w Chrome
   plus znane z atakow: ms-msdt "Follina", search-ms, ms-officecmd). */
const ZAKAZANE_PROTOKOLY = new Set([
  'shell', 'vbscript', 'hcp', 'ms-help', 'res', 'ie.http', 'afp', 'disk', 'disks', 'mk',
  'its', 'ms-its', 'ms-msdt', 'search-ms', 'search', 'ms-officecmd', 'ms-cxh', 'ms-cxh-full'
]);

function zuzyjAktywnosc(wc) {
  const t = aktywacje.get(wc);
  if (!t || Date.now() - t > AKTYWACJA_MS) return false;
  aktywacje.delete(wc);
  return true;
}

/* ---------------------------------------------- strony nie przeciagaja okna
   Okno Nazuny nie ma systemowej ramki, a w takim oknie Electron traktuje
   KAZDY obszar oznaczony przez strone stylem -webkit-app-region: drag jako
   uchwyt calego okna. Niektore serwisy maja tak oznaczony gorny pasek (ten
   sam kod sluzy ich aplikacji na komputer). Klikniecie w ten pas lapalo
   wtedy okno zamiast strony, a co gorsza obszar zostawal w oknie takze po
   przejsciu w tej karcie na inna strone (zmierzone: pas 52 px pod paskiem
   zakladek) - stad "nie da sie kliknac logo YouTube" ani menu na jbzd.
   W zwyklej przegladarce strona nigdy nie przeciaga okna, wiec wylaczamy to
   kazdej stronie w karcie: styl z poziomu uzytkownika z !important jest
   silniejszy niz wszystko, co ustawi strona (patrz tez preload/web.js, ktory
   robi to samo, zanim strona zdazy cokolwiek narysowac). Pasek kart Nazuny
   (shell) dalej przeciaga okno, bo to osobny widok. */
const BEZ_UCHWYTU_OKNA = 'html, html *, html *::before, html *::after { -webkit-app-region: no-drag !important; app-region: no-drag !important; }';
function zablokujUchwytOkna(wc) {
  try {
    if (!wc || wc.isDestroyed() || /^nazuna:/i.test(wc.getURL())) return;
    wc.insertCSS(BEZ_UCHWYTU_OKNA, { cssOrigin: 'user' }).catch(() => {});
  } catch (_) {}
}

/* Wstecz/dalej po kolejnych wpisach historii karty, bez przeskakiwania
   stron (patrz idzWHistorii). canGoBack() Chromium liczy z pominieciem
   stron "bez klikniecia", wiec liczymy sami po indeksie. */
function moznaWstecz(wc) {
  try { return wc.navigationHistory.getActiveIndex() > 0; } catch (_) { return false; }
}
function moznaDalej(wc) {
  try { const h = wc.navigationHistory; return h.getActiveIndex() < h.length() - 1; } catch (_) { return false; }
}

/* Boczne przyciski myszy (wstecz/dalej, te pod kciukiem). Chromium obsluguje
   je sam, przez goBack() z przeskakiwaniem stron "bez klikniecia" - przy
   takich stronach jedno nacisniecie wyrzucalo od razu na nowa karte.
   Zatrzymujemy je, zanim dotra do strony, i cofamy karte przez
   idzWHistorii (zawsze o jedna strone). Dziala tez nad paskiem przegladarki. */
function przyciskiWsteczDalej(wc, okno) {
  wc.on('before-mouse-event', (event, mysz) => {
    if (!mysz || (mysz.button !== 'back' && mysz.button !== 'forward')) return;
    if (mysz.type !== 'mouseDown' && mysz.type !== 'mouseUp') return;
    event.preventDefault();
    if (mysz.type !== 'mouseUp') return;
    const w = okno();
    if (!w) return;
    if (mysz.button === 'back') w.goBack(); else w.goForward();
  });
}

class Tab {
  constructor(appWindow, { url, background = false, lazy = false }) {
    this.id = nextTabId++;
    this.owner = appWindow;
    // Karta z przywracania sesji nie ma jeszcze prawdziwego tytulu (patrz
    // nizej, lazy) - pusty string, zeby serialise() sam pokazal nazwe hosta
    // zamiast mylacego "Nowa karta" na karcie, ktora wcale nie jest nowa.
    this.title = lazy ? '' : 'Nowa karta';
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

    if (lazy) {
      // Karta odtworzona z sesji przy starcie, ale jeszcze nie kliknieta -
      // od razu w stanie "spi", dokladnie tak jak zwykla karta usypiona z
      // bezczynnosci (patrz sleep()/wake() nizej), tylko nigdy nie zdazyla
      // sie obudzic. Bez tego przywrocenie np. 15 kart odpalaloby 15
      // procesow renderujacych naraz, wszystkie na starcie walczace o CPU i
      // siec - dokladnie tak, jak robi to Chrome/Edge przy przywracaniu
      // sesji, buduje sie tylko ta karta, w ktora ktos faktycznie kliknie.
      this.view = null;
      this.wc = null;
      this.sleeping = true;
    } else {
      this._createView();
      this.otworz(this.url);
    }
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
        additionalArguments: pageFlags(this.owner.partition),
        spellcheck: data.settings.get('spellcheckEnabled', false),
        partition: this.owner.partition,
        backgroundThrottling: true,
        safeDialogs: true,          // strona nie zasypie okienkami alert
        v8CacheOptions: 'code'
      }
    });
    this.view.setBackgroundColor(pageBackground(this.url, this.owner && this.owner.isPrivate));
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
    diagnostics.usypianie(this.id);
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
    diagnostics.budzenie(this.id);
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

  /* Proces strony padl (brak pamieci, blad GPU, zabity): widok zostawal bialy,
     bez slowa wyjasnienia. Karta w tle po prostu zasypia i odbuduje sie po
     kliknieciu. Karta na wierzchu pokazuje strone bledu z "Sprobuj ponownie".
     Zadna z tych drog nie przeladowuje sama, wiec strona padajaca przy kazdym
     wczytaniu nie zapetli sie. */
  _poAwarii(wc, powod) {
    if (wc !== this.wc || wc.isDestroyed()) return;
    const okno = this.owner;
    // Karta "na zapas" z martwym procesem dalaby biala nowa karte - newTab zbuduje swieza.
    if (okno._spareTab === this) { okno._spareTab = null; this.destroy(); return; }
    if (!okno.tabs.includes(this)) return;
    if (this.id !== okno.activeTabId) { this.sleep(); okno.scheduleSync(); return; }
    /* Padla sama strona bledu albo ostrzezenia: bez ponownego ladowania (petla).
       Przy ostrzezeniu tym bardziej: "Sprobuj ponownie" poszedlby wprost na grozny adres. */
    if (this.errorUrl || this.warnUrl) { this.title = 'Karta przestała odpowiadać'; okno.scheduleSync(); return; }
    this.errorUrl = this.url;
    // Kody Electrona po angielsku ("oom", "crashed") nic uzytkownikowi nie mowia.
    const powodPoPolsku = {
      oom: 'brak pamięci',
      'memory-eviction': 'brak pamięci',
      crashed: 'błąd strony lub przeglądarki',
      'abnormal-exit': 'błąd strony lub przeglądarki',
      killed: 'proces został zamknięty z zewnątrz',
      'launch-failed': 'nie udało się uruchomić procesu',
      'integrity-failure': 'nie udało się uruchomić procesu'
    }[powod] || 'nieznany';
    const params = new URLSearchParams({
      url: this.url,
      code: 'awaria',
      description: `Proces tej karty przestał działać. Powód: ${powodPoPolsku}`
    });
    wc.loadURL(`nazuna://error/?${params.toString()}`).catch(() => {});
    okno.scheduleSync();
  }

  wire() {
    const wc = this.wc;
    const sync = () => this.owner.scheduleSync();
    // Dziennik diagnostyczny (patrz diagnostics.js) - osobne nasluchiwanie
    // zdarzen tej karty, niezalezne od reszty wire() ponizej, zeby ewentualny
    // blad w nim nigdy nie ruszal prawdziwej logiki przegladarki.
    diagnostics.sledzKarte(this);

    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      // Okno prywatne nic na dysk - adres odwiedzony wczesniej normalnie
      // dostawal w zwyklej historii tytul z sesji prywatnej.
      if (!this.owner.isPrivate) data.updateHistoryTitle(this.url, title);
      sync();
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.favicon = favicons && favicons.length ? favicons[favicons.length - 1] : null;
      this.faviconPrywatna = null;
      if (this.owner.isPrivate) this._faviconPrywatna(this.favicon);
      sync();
      this._updateSiteAccent();
    });
    wc.on('did-start-loading', () => { this.loading = true; sync(); });
    wc.on('did-stop-loading', () => { this.loading = false; sync(); });
    /* Klikniecie w strone (np. skrot na nowej karcie) przenosi systemowy
       fokus do widoku karty, ale samo pole adresu w powloce o tym nie wie -
       jesli bylo akurat aktywne (np. po otwarciu pustej nowej karty, ktora
       sama je fokusuje), renderToolbar() dalej traktuje je jako "ktos w nim
       cos pisze" i nie nadpisuje jego wartosci, mimo ze naprawde nikt juz w
       nim nie pisze. Efekt: pasek zostaje pusty na stale po takiej nawigacji,
       mimo ze karta poprawnie przechodzi na nowy adres. */
    wc.on('focus', () => {
      if (this.owner.activeTabId !== this.id) return;
      if (this._pasekMaFokus && Date.now() < this._pasekMaFokus) {
        // Strona przejela klawiature sama, nie przez klikniecie - wraca do paska.
        try { this.owner.shell.focus(); } catch (_) {}
        return;
      }
      this.owner.send('address:blur');
    });
    // Klikniecie w strone (albo przejscie na inna strone) konczy ochrone
    // fokusu paska z newTab() - od tej chwili strona moze go normalnie miec.
    wc.on('before-mouse-event', (_e, mysz) => { if (mysz && mysz.type === 'mouseDown') this._pasekMaFokus = 0; });
    wc.on('did-start-navigation', (ev) => { if (ev.isMainFrame && !/^nazuna:\/\/newtab/i.test(ev.url)) this._pasekMaFokus = 0; });
    wc.on('will-navigate', (event, target) => {
      if (/^nazuna:/i.test(target) && !/^nazuna:/i.test(wc.getURL())) { event.preventDefault(); return; }
      if (urls.zewnetrznyProtokol(target)) { event.preventDefault(); this.owner.handleExternalProtocol(target); return; }
      const zagrozenie = security.sprawdz(target);
      if (zagrozenie) {
        event.preventDefault();
        this.warnUrl = target;
        wc.loadURL(security.adresOstrzezenia(zagrozenie.typ, target)).catch(() => {});
      }
    });
    // Przekierowanie po drodze (np. skrocony link prowadzacy na zlosliwa
    // domene, albo koncowka logowania SSO wracajaca do innej aplikacji
    // przez jej wlasny protokol) - to samo sprawdzenie co przy zwyklej
    // nawigacji, tylko zanim przekierowanie zdazy sie dokonac.
    wc.on('will-redirect', (event) => {
      if (!event.isMainFrame) return;
      if (urls.zewnetrznyProtokol(event.url)) { event.preventDefault(); this.owner.handleExternalProtocol(event.url); return; }
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
      try { this.view.setBackgroundColor(pageBackground(event.url, this.owner.isPrivate)); } catch (_) {}
      adblock.resetCount(wc.id);
      adblock.setDocumentHost(wc.id, event.url);
    });
    wc.on('did-redirect-navigation', (event) => {
      if (!event.isMainFrame) return;
      /* Przekierowanie w trakcie nawigacji zmienia host, ale nie odpala
         did-start-navigation jeszcze raz - bez tego adblock i blokada obcych
         ciasteczek dzialalyby chwile na podstawie hosta sprzed przekierowania. */
      adblock.setDocumentHost(wc.id, event.url);
    });
    /* Domene karty dla blokady obcych ciasteczek zmieniamy dopiero, gdy
       nawigacja sie zatwierdzi. Wczesniej (na starcie nawigacji) klikniecie
       linku do pobrania z innej domeny zostawialo ja w pamieci, mimo ze karta
       dalej pokazywala stara strone - jej wlasne ciasteczka byly wtedy
       wycinane (wylogowanie), a obce przepuszczane. */
    wc.on('did-navigate', (_e, url) => sessions.ustawDomeneKarty(wc.id, url));
    wc.on('dom-ready', () => { zablokujUchwytOkna(wc); adblock.applyCosmetics(wc, wc.getURL()); });
    wc.on('did-navigate', () => zablokujUchwytOkna(wc));
    wc.on('did-navigate', (_e, url) => {
      this.url = url;
      this.applyZoom();
      this.hadAudio = false;
      this.siteAccent = null;
      // Bez tytulu: this.title to w tej chwili jeszcze tytul POPRZEDNIEJ
      // strony, a nowy dochodzi dopiero w page-title-updated (wtedy
      // updateHistoryTitle go dopisze). Strona bez <title> zostawala w
      // historii z cudzym tytulem.
      if (!this.owner.isPrivate) data.addHistory(url, '');
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
      // -20 (ERR_BLOCKED_BY_CLIENT) po podmianie na nazuna://pdf lub
      // nazuna://textview - podglad juz sie laduje, to nie jest blad.
      if (code === -20 && sessions.bladOdPodgladu(wc.id)) return;
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
    wc.on('render-process-gone', (_e, szczegoly) => {
      this.loading = false;
      this.audible = false;
      const powod = szczegoly && szczegoly.reason;
      if (powod === 'clean-exit') this.title = 'Karta przestała odpowiadać';
      // Odroczone: niszczenie widoku albo nowa nawigacja w trakcie tego zdarzenia
      // bywa zawodne, a karta mogla w tej chwili zostac zamknieta.
      else setImmediate(() => this._poAwarii(wc, powod));
      sync();
    });
    wc.on('destroyed', () => { adblock.forget(wc.id); sessions.zapomnijKarte(wc.id); sync(); });

    sledzAktywnosc(wc);
    przyciskiWsteczDalej(wc, () => this.owner);
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (disposition === 'save-to-disk') return { action: 'allow' };
      if (!urls.dozwoloneZeStrony(url, wc.getURL())) return { action: 'deny' };
      if (!zuzyjAktywnosc(wc)) { this.owner.zablokowanoOkno(url); return { action: 'deny' }; }
      const wantsPopup = disposition === 'new-window' && /width=|height=|popup/i.test(features || '');
      // Okienko na zlosliwa domene albo http: ostrzezenie pokazuje sie tylko
      // w karcie (nazuna://warning w okienku nie ma okna Nazuny dla IPC), wiec
      // taki adres idzie do zwyklej karty, ktora sama go sprawdzi w otworz().
      if (wantsPopup && !security.sprawdz(url)) {
        /* Okienko (np. logowanie przez Google) na srodku okna Nazuny, na tym
           samym monitorze. Bez podanej pozycji Electron stawial je na
           glownym ekranie - przy Nazunie na drugim monitorze logowanie
           wyskakiwalo na laptopie. Rozmiar, o ktory prosi strona, w
           rozsadnych granicach. */
        const liczba = (klucz, domyslna) => {
          const m = new RegExp('(?:^|,)\\s*' + klucz + '\\s*=\\s*(\\d+)', 'i').exec(features || '');
          return m ? Math.max(300, Math.min(1400, parseInt(m[1], 10))) : domyslna;
        };
        let nad;
        try { nad = this.owner.win.getBounds(); } catch (_) { nad = monitory.domyslne(); }
        const cel = monitory.naSrodku(nad, liczba('width', 520), liczba('height', 640));
        this._granicePopupu = cel;
        return {
          action: 'allow',
          outlivesOpener: false,
          overrideBrowserWindowOptions: {
            x: cel.x,
            y: cel.y,
            width: cel.width,
            height: cel.height,
            backgroundColor: '#101116',
            autoHideMenuBar: true,
            title: APP_NAME,
            webPreferences: {
              preload: path.join(PRELOAD_DIR, 'web.js'),
              contextIsolation: true,
              sandbox: true,
              nodeIntegrationInSubFrames: true,
              additionalArguments: pageFlags(this.owner.partition),
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
      // Ta sama poprawka rozmiaru co przy zwyklym oknie (monitory.js).
      if (this._granicePopupu) { monitory.ustawGranice(child, this._granicePopupu); this._granicePopupu = null; }
      sledzAktywnosc(child.webContents);
      /* Straz nawigacji jak w karcie (will-navigate/will-redirect wyzej).
         Bez niej okienko logowania moglo przejsc albo przekierowac na
         zlosliwa domene bez slowa, a powrot SSO do aplikacji przez jej
         protokol cicho przepadal. Ostrzezenia nie da sie pokazac w samym
         okienku (strona nazuna://warning nie ma tu okna Nazuny), wiec
         grozny adres trafia do zwyklej karty, ktora pokaze ostrzezenie,
         a okienko sie zamyka. Zwykle logowanie (https) idzie bez zmian. */
      const strazOkienka = (event, cel) => {
        if (urls.zewnetrznyProtokol(cel)) { event.preventDefault(); this.owner.handleExternalProtocol(cel); return; }
        if (!security.sprawdz(cel)) return;
        event.preventDefault();
        this.owner.newTab({ url: cel });
        try { child.close(); } catch (_) {}
      };
      child.webContents.on('will-navigate', (event, cel) => strazOkienka(event, cel));
      child.webContents.on('will-redirect', (event) => { if (event.isMainFrame) strazOkienka(event, event.url); });
      child.webContents.setWindowOpenHandler(({ url }) => {
        if (!urls.dozwoloneZeStrony(url, child.webContents.getURL())) return { action: 'deny' };
        if (!zuzyjAktywnosc(child.webContents)) { this.owner.zablokowanoOkno(url); return { action: 'deny' }; }
        this.owner.newTab({ url });
        return { action: 'deny' };
      });
      // Okienko (np. logowanie) nie ma paska Nazuny ani jej skrotow - Ctrl+W
      // nic w nim nie robilo. Zamyka je tak samo jak karte.
      child.webContents.on('before-input-event', (ev, input) => {
        const ctrl = process.platform === 'darwin' ? input.meta : input.control;
        if (input.type === 'keyDown' && ctrl && !input.shift && !input.alt && (input.key || '').toLowerCase() === 'w') {
          ev.preventDefault();
          try { child.close(); } catch (_) {}
        }
      });
    });
  }

  _faviconPrywatna(adres) {
    if (!/^https?:\/\//i.test(String(adres || ''))) { this.faviconPrywatna = /^data:image\//i.test(String(adres || '')) ? adres : null; return; }
    this.owner.session.fetch(adres, { redirect: 'follow' })
      .then(async (res) => {
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length || buf.length > 256 * 1024) return;
        const typ = (res.headers.get('content-type') || 'image/x-icon').split(';')[0].trim();
        if (!/^image\//i.test(typ)) return;
        if (this.favicon !== adres) return;
        this.faviconPrywatna = `data:${typ};base64,${buf.toString('base64')}`;
        this.owner.scheduleSync();
      })
      .catch(() => {});
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
    extractSiteAccent(favicon, this.owner.session).then((accent) => {
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
      // Okno prywatne: pasek dostaje ikone jako data:, pobrana sesja karty -
      // sam pasek pobieralby ja przez zwykla sesje zapisywana na dysku.
      favicon: this.owner.isPrivate ? this.faviconPrywatna : this.favicon,
      loading: this.loading,
      audible: this.audible,
      muted: this.muted,
      active: !!active,
      internal: /^nazuna:/.test(this.displayUrl),
      sleeping: !!this.sleeping,
      sleepExempt: data.isSleepExempt(urls.hostOf(this.displayUrl)),
      siteAccent: this.siteAccent,
      canGoBack: wc ? moznaWstecz(wc) : false,
      canGoForward: wc ? moznaDalej(wc) : false
    };
  }

  destroy() {
    try { this.wc.stop(); } catch (_) {}
    try { this.wc.close(); } catch (_) {}
    try { this.view.webContents.destroy && this.view.webContents.destroy(); } catch (_) {}
  }
}

class AppWindow {
  constructor({ isPrivate = false, urls: startUrls = [], aktywna = 0, bounds = null, puste = false, partition = null } = {}) {
    this.id = nextWindowId++;
    this.isPrivate = isPrivate;
    // partition podana wprost: okno prywatne powstale z wyrwanej karty musi
    // dzielic sesje z oknem, z ktorego karta wyszla. Z nowa, pusta sesja
    // karta zaczynala zyc w innym magazynie niz kolejne karty tego okna i
    // po uspieniu budzila sie wylogowana.
    this.partition = partition || (isPrivate ? `nazuna-private-${++privatePartitionCounter}` : 'persist:nazuna');
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
    this._wyborKontaResolvers = new Map();
    // Karta trzymana "na zapas", patrz _prepareSpare() i newTab() nizej.
    this._spareTab = null;
    // Warstwa powiadomien w rogu (patrz pokazToast nizej) - tworzona dopiero,
    // gdy jest co pokazac.
    this.toastView = null;
    this._toastGotowy = false;
    this._toastKolejka = [];
    this._toastRozmiar = { w: 0, h: 0 };

    /* Gdzie stanie okno (patrz monitory.js):
       - pozycja podana wprost (wyrwana karta): na ekranie, nad ktorym puszczono
         karte, w calosci na nim;
       - kolejne okno (Ctrl+N, nowe okno prywatne) przy juz otwartym: na tym
         samym monitorze co okno, z ktorego je otwarto, lekko przesuniete, jak
         w Chrome. Wczesniej kazde nowe okno ladowalo dokladnie w miejscu
         ostatnio zamknietego - czesto na innym monitorze i jedno na drugim.
         Przy menu ikony na pasku zadan zadne okno nie ma fokusu - wtedy
         zrodlem jest ostatnio aktywne (zrodloNowegoOkna);
       - pierwsze okno: tam, gdzie bylo ostatnio, o ile ten monitor dalej
         istnieje. Okno zapamietane na odlaczonym monitorze trafia na srodek
         glownego ekranu zamiast poza ekran. */
    let cel;
    let maksymalizuj = false;
    const zrodlo = bounds ? null : zrodloNowegoOkna();
    if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
      const punkt = bounds.punkt || { x: bounds.x + 40, y: bounds.y + 10 };
      cel = monitory.dopasuj({ x: bounds.x, y: bounds.y, width: bounds.width || 1280, height: bounds.height || 820 }, monitory.ekranPunktu(punkt));
    } else if (zrodlo) {
      const nb = monitory.normalne(zrodlo.win) || monitory.domyslne();
      cel = monitory.dopasuj({ x: nb.x + 30, y: nb.y + 30, width: nb.width, height: nb.height }, monitory.ekranOkna(nb));
      maksymalizuj = zrodlo.czyZmaksymalizowane();
    } else {
      const saved = data.settings.get('windowBounds', null);
      cel = saved && monitory.widoczne(saved) ? monitory.dopasuj(saved) : monitory.domyslne();
      maksymalizuj = !!data.settings.get('windowMaximized', false);
    }
    const opts = {
      x: cel.x,
      y: cel.y,
      width: cel.width,
      height: cel.height,
      minWidth: 620,
      minHeight: 420,
      frame: false,
      backgroundColor: tloOkna(isPrivate),
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

    this.win = new BaseWindow(opts);
    // Poprawka rozmiaru na monitorze o innej skali niz glowny (monitory.js).
    monitory.ustawGranice(this.win, cel);
    this._granice = cel;

    /* Zmaksymalizowane, gdy takie bylo ostatnie okno (albo okno, z ktorego
       otwarto to nowe) - na tym monitorze, na ktorym stoi. Wyrwana karta ma
       stanac dokladnie tam, gdzie ja puszczono, wiec jej to nie dotyczy.
       Robimy to przed pokazaniem okna, wiec nic nie miga. */
    if (maksymalizuj) this.win.maximize();
    this._zmaksymalizowane = maksymalizuj;

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
    /* Pasek (shell.html) ladowal sie kiedys przez zwykle file://, jako
       jedyny element calej Nazuny - reszta wewnetrznych stron (nowa
       karta, historia, ustawienia...) od dawna chodzi przez wlasny
       protokol nazuna://. Trasa 'ui' w protocol.js wskazuje dokladnie
       na ten sam folder co UI_DIR, wiec relatywne odwolania w samym
       shell.html (theme.css, shell.css, icons.js, shell.js) dzialaja
       bez zadnych zmian. */
    const shellParams = new URLSearchParams({ win: String(this.id), private: String(isPrivate) });
    this.shell.loadURL(`nazuna://ui/shell.html?${shellParams.toString()}`);

    this.shell.on('before-input-event', (event, input) => this.handleShortcut(event, input, true));
    przyciskiWsteczDalej(this.shell, () => this);

    /* Menu pod prawym przyciskiem bylo podpiete tylko do stron internetowych.
       Pasek adresu, pasek wyszukiwania i pasek zakladek naleza do interfejsu
       samej przegladarki, wiec klikniecie w nich prawym nie robilo nic. */
    this.shell.on('context-menu', (_e, params) => this.showShellContextMenu(params));
    this.shell.setWindowOpenHandler(({ url }) => { if (urls.bezpieczneZewnetrzne(url)) shell.openExternal(url); return { action: 'deny' }; });

    this.win.on('resize', () => { this.layout(); this._zapamietajPozniej(); });
    this.win.on('moved', () => this._zapamietajPozniej());
    this.win.on('maximize', () => { this._zmaksymalizowane = true; this.layout(); this.scheduleSync(); this._zapamietajPozniej(); });
    this.win.on('unmaximize', () => { this._zmaksymalizowane = false; this.layout(); this.scheduleSync(); this._zapamietajPozniej(); });
    this.win.on('enter-full-screen', () => { this.layout(); this.scheduleSync(); });
    this.win.on('leave-full-screen', () => {
      // Okno wyszlo z pelnego ekranu (np. przez Windows), a strona dalej
      // jest w swoim - wyprowadzamy z niego i strone, inaczej zostaje bez paska.
      if (this.contentFullScreen) this.wyjdzZPelnegoEkranuStrony();
      this.layout(); this.scheduleSync();
    });
    /* Po dluzszej nieaktywnosci (okno bez fokusu godzinami, zminimalizowane,
       albo caly system usypiony - patrz tez powerMonitor w index.js) karta
       na wierzchu potrafi zostac pusta/biala, mimo ze jej proces wcale nie
       padl (render-process-gone by to zlapalo, patrz nizej) - to sam
       kompozytor Chromium nie odmalowal ostatniej klatki po odwieszeniu.
       invalidate() to oficjalny sposob Electrona na wymuszenie takiego
       przemalowania - tanie, bez przeladowania strony i bez utraty stanu. */
    this.win.on('focus', () => {
      if (!this.isPrivate) ostatnioAktywneZwykle = this;
      ostatnioAktywneOkno = this;
      this.scheduleSync(); this.invalidateActiveTab();
    });
    this.win.on('restore', () => this.invalidateActiveTab());
    this.win.on('show', () => this.invalidateActiveTab());
    this.win.on('close', (e) => {
      /* Ostatnie okno, a w tle trwa pobieranie: pytamy, jak Firefox. Po
         "Zamknij" zamykamy juz bez pytania (flaga), po "Anuluj" okno zostaje. */
      if (!zamykanieProgramu && !this._pobraniaPotwierdzone && windows.size === 1 && downloads.ileAktywnych() > 0) {
        e.preventDefault();
        const n = downloads.ileAktywnych();
        dialog.showMessageBox(this.win, {
          type: 'warning', buttons: ['Zamknij', 'Anuluj'], defaultId: 1, cancelId: 1, noLink: true,
          title: 'Trwa pobieranie',
          message: n === 1 ? 'Trwa pobieranie pliku. Zamknąć mimo to?' : `Trwa pobieranie plików (${n}). Zamknąć mimo to?`,
          detail: 'Niepobrane pliki zostaną przerwane.'
        }).then(({ response }) => {
          if (response !== 0 || !this.win || this.win.isDestroyed()) return;
          this._pobraniaPotwierdzone = true;
          this.win.close();
        }).catch(() => {});
        return;
      }
      this.rememberBounds();
      /* Ostatnie zwykle okno zamykane krzyzykiem. Zapis sesji w index.js
         (before-quit) przychodzi dopiero PO zamknieciu wszystkich okien,
         kiedy nie ma juz z czego czytac kart - wiec "Karty z poprzedniej
         sesji" przywracaly cos sprzed wielu dni, a nie to, co bylo otwarte
         przed chwila. */
      if (!zamykanieProgramu && !this.isPrivate && ![...windows].some((w) => w !== this && !w.isPrivate)) zapamietajSesje(this);
    });
    this.win.on('closed', () => {
      this.dispose();
      if (ostatnioAktywneZwykle === this) ostatnioAktywneZwykle = null;
      if (ostatnioAktywneOkno === this) ostatnioAktywneOkno = null;
      // Zamkniete krzyzykiem (nie ostatnie) zwykle okno wypada z sesji, jak w Chrome.
      if (!this.isPrivate) zaplanujZapisSesji();
    });
    /* Wylaczanie, restart albo wylogowanie z Windows: Electron nie wysyla
       wtedy before-quit ani 'close' okien, a proces moze zostac ubity zaraz
       potem. Zapisujemy karty od razu i synchronicznie. */
    // Licznik blokad z ostatniej minuty jest jeszcze tylko w pamieci (data.js
    // zapisuje go raz na minute i w before-quit, ktorego tu nie ma) - wkladamy
    // go do ustawien przed synchronicznym zapisem, inaczej by przepadl.
    const zapiszPrzyWylaczaniu = () => {
      try { data.zapiszLicznikBlokad(); } catch (_) {}
      zapamietajSesje(null, { synchronicznie: true });
    };
    this.win.on('query-session-end', zapiszPrzyWylaczaniu);
    this.win.on('session-end', () => {
      zapiszPrzyWylaczaniu();
      // Windows i tak konczy proces - zamykane potem okna (albo zapis okresowy)
      // nie moga nadpisac pelnej sesji kartami jednego, ostatniego okna.
      zamykanieProgramu = true;
      clearTimeout(zapisSesjiTimer); zapisSesjiTimer = null;
    });

    windows.add(this);

    this.shell.once('did-finish-load', () => {
      // Okno "puste" powstaje po to, zeby przyjac karte wyrwana z innego okna.
      // Nie tworzymy w nim nowej karty, bo za chwile dostanie gotowa.
      const list = puste ? [] : (startUrls.length ? startUrls : [data.settings.get('homepage', NEW_TAB) || NEW_TAB]);
      // lazy: przy przywracaniu calej sesji na starcie buduje sie proces
      // renderujacy tylko dla karty, ktora faktycznie sie zaraz pokaze
      // (patrz selectTab() ponizej i Tab constructor) - reszta czeka spiaca,
      // dokladnie jak w Chrome/Edge. Dla pojedynczego adresu (zwykly start)
      // ta karta i tak od razu sie budzi w tej samej linijce, wiec dla niej
      // nic sie nie zmienia.
      // aktywna > 0: pierwsza karta nie moze sie obudzic "po drodze" - wczytywalaby
      // sie w tle bez potrzeby, a film albo muzyka z niej graly bez slowa.
      for (const url of list) this.newTab({ url, background: true, lazy: true, bezWyboru: aktywna > 0 });
      // Od teraz karty tego okna ida do zapisu sesji. Wczesniej okno ma zero
      // kart i nadpisaloby zapisana sesje pusta lista.
      this._kartyGotowe = true;
      if (!this.isPrivate) zaplanujZapisSesji();
      // Wszystkie karty przy starcie ida przez background:true (patrz
      // newTab() wyzej), wiec normalny mechanizm "pusta karta = kursor od
      // razu w pasku adresu" sie tu nie odpala. Gdy domowa strona to wlasnie
      // pusta nowa karta, doganiamy to recznie - tak samo jak Chrome i
      // Firefox robia przy pierwszym oknie.
      const pustaNaStarcie = this.tabs.length > 0 && this.tabs[0].url === NEW_TAB;
      if (this.tabs.length) this.selectTab((this.tabs[aktywna] || this.tabs[0]).id);
      this.layout();
      this._prepareSpare();
      /* Okno "puste" czeka na karte i pokazuje sie dopiero, gdy ja dostanie.
         Inaczej mignelo by najpierw jako pusta rama, a przy okazji drugie
         pokazanie gubilo je pod oknem, z ktorego karta wyszla. */
      if (!puste) { this.win.show(); try { this.win.focus(); } catch (_) {} }
      // Fokus paska adresu musi isc PO show(), ale samo "po" w tym samym
      // takcie kodu (0.1.56) dalej nie wystarczalo - Windows/Electron
      // najwyrazniej finalizuje realne, systemowe przekazanie klawiatury do
      // dopiero co pokazanego okna dopiero w kolejnym przebiegu petli
      // zdarzen, wiec wolanie shell.focus() w tym samym miejscu co show()
      // wciaz bywalo za wczesne i ginelo. Std stad odroczenie o jeden takt
      // (setTimeout 0 - i tak czeka na petle zdarzen Electrona, nie na
      // uplyw czasu) - dopiero wtedy okno faktycznie jest aktywne i
      // przekazanie klawiatury do paska sie utrzymuje. Dotyczy to zarowno
      // pierwszego okna przy starcie programu, jak i kazdego kolejnego
      // (Ctrl+N) - oba ida przez ta sama sciezke.
      if (pustaNaStarcie) {
        const dogonFokus = () => {
          if (!this.win || this.win.isDestroyed()) return;
          try { this.shell.focus(); } catch (_) {}
          this.send('focus:address', { clear: true });
        };
        // Druga proba pare klatek pozniej to zabezpieczenie - gdyby Windows
        // akurat na tym komputerze aktywowal okno wolniej niz jeden takt
        // petli zdarzen, pierwsza proba nic nie zepsuje (ponowne "wejscie"
        // do juz pustego, juz aktywnego paska to tylko ponowny focus+select).
        setTimeout(dogonFokus, 0);
        setTimeout(dogonFokus, 150);
      }
      /* Ile minelo od startu PROCESU do pokazania okna. Nie obejmuje czasu,
         ktory Windows spedza na rozpakowaniu jednoplikowej wersji, i wlasnie
         dlatego jest przydatne: gdy tu jest 400 ms, a od klikniecia ikony
         mijaja sekundy, wiadomo, ze wolne jest rozpakowywanie, nie program. */
      if (czasStartu === null) czasStartu = Math.round(process.uptime() * 1000);
      if (process.env.NAZUNA_DEBUG) console.log('[start] okno widoczne po', czasStartu, 'ms');
      starttrace.znacznik('okno widoczne (shell zaladowany)');
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
      if (tab.audible) {
        // Karta AKTUALNIE grajaca dzwiek w tle dostaje prawdziwy rozmiar,
        // tylko wysunięty poza widoczny obszar okna, zamiast splaszczenia do
        // 0x0 jak zwykla, cicha karta w tle. Widok o zerowej powierzchni
        // potrafil sprawic, ze YouTube (i pewnie inne strony z wideo) po
        // jakims czasie same resetowaly odtwarzacz, jakby strona wcale nie
        // byla wczytana - zerowy rozmiar to dla Chromium znacznie mocniejszy
        // sygnal "nikt tego nie oglada" niz zwykle przelaczenie karty w
        // prawdziwej przegladarce. Celowo NIE uzywamy tu hadAudio (ktore
        // zostaje true na stale, dopoki karta sie nie przeladuje) - to
        // kosztowny, prawdziwy widok w tle, wiec ma go dostawac tylko karta,
        // ktora naprawde cos teraz gra, a nie kazda, ktora kiedykolwiek
        // cokolwiek zagrala. hadAudio samo w sobie dalej chroni karte przed
        // usypianiem (patrz usypianieCheck), to tam jego koszt jest zerowy.
        tab.view.setBounds({ x: -width, y: top, width, height: Math.max(0, height - top) });
      } else {
        tab.view.setBounds({ x: 0, y: top, width: 0, height: 0 });
      }
    }
    this.positionExtensionPopup();
    this.positionToast();
  }

  /** Interfejs to przezroczysta warstwa nad strona. Rozciaga sie na cale okno
      tylko wtedy, gdy pokazuje sie menu, lista podpowiedzi albo okienko. */
  setExpanded(on) {
    const next = !!on;
    if (this.expanded === next) return;
    this.expanded = next;
    this.layout();
  }

  /* Zminimalizowane okno Windows raportuje jako niezmaksymalizowane, nawet gdy
     po przywroceniu wroci na caly ekran. Przy zamknieciu z paska zadan gubilo
     to maksymalizacje - w tym stanie wierzymy zdarzeniom maximize/unmaximize. */
  czyZmaksymalizowane() {
    return this.win.isMinimized() ? !!this._zmaksymalizowane : this.win.isMaximized();
  }

  rememberBounds(odRazu = true) {
    try {
      if (this.isPrivate || this.win.isDestroyed()) return;
      const zmaksymalizowane = this.czyZmaksymalizowane() && !this.win.isFullScreen();
      /* Flaga "bylo zmaksymalizowane" zapisuje sie zawsze. Pozycje bierzemy
         "normalna" (getNormalBounds) takze u zmaksymalizowanego okna - to
         ona mowi, na KTORYM monitorze okno stoi. Wczesniej przy
         zmaksymalizowanym oknie pozycja sie nie zapisywala i okno
         zmaksymalizowane na drugim monitorze wracalo po starcie na tym, na
         ktorym ostatnio bylo w normalnym rozmiarze. */
      data.settings.set('windowMaximized', zmaksymalizowane);
      const nb = monitory.normalne(this.win);
      if (nb && monitory.widoczne(nb)) data.settings.set('windowBounds', nb);
      if (odRazu) data.settings.flush();
    } catch (_) {}
  }

  /* Zapis pozycji chwile po przesunieciu albo zmianie rozmiaru, a nie tylko
     przy zamykaniu - po awarii czy wylaczeniu komputera okno i tak wraca na
     swoj monitor. Opoznienie, zeby przeciaganie okna nie pisalo co klatke. */
  _zapamietajPozniej() {
    if (this.isPrivate) return;
    clearTimeout(this._zapisGranic);
    this._zapisGranic = setTimeout(() => this.rememberBounds(false), 1500);
  }

  /* ----------------------------------------------------------------- tabs */

  activeTab() { return this.tabs.find((t) => t.id === this.activeTabId) || null; }

  /* Patrz komentarz przy this.win.on('focus', ...) w konstruktorze. Karta
     usypiajaca (Tab.sleep) nie ma juz swojego widoku, wiec nie ma czego tu
     odmalowywac - i tak zaraz dostanie swiezy widok od selectTab()/wake(). */
  invalidateActiveTab() {
    const tab = this.activeTab();
    if (tab && !tab.sleeping && tab.wc && !tab.wc.isDestroyed()) {
      try { tab.wc.invalidate(); } catch (_) {}
    }
  }

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

  newTab({ url = NEW_TAB, background = false, index = null, lazy = false, bezWyboru = false } = {}) {
    const resolved = url ? (urls.resolve(url) || NEW_TAB) : NEW_TAB;
    // Link mailto:, tel: albo protokol innej aplikacji otwierany "w nowej
    // karcie" (target="_blank", srodkowy klik, menu) - tego i tak nie da sie
    // pokazac w karcie, a pusta, biala karta zostawala po nim na pasku.
    if (!lazy && urls.zewnetrznyProtokol(resolved)) { this.handleExternalProtocol(resolved); return null; }
    let tab;
    if (lazy) {
      // Ominiecie karty z zapasu jest tu celowe - lazy sluzy do przywracania
      // calej sesji naraz (patrz konstruktor AppWindow nizej), a karta z
      // zapasu i tak zaraz dostalaby prawdziwy adres i od razu by go
      // wczytala, co jest dokladnie tym, czego lazy ma unikac.
      tab = new Tab(this, { url: resolved, lazy: true });
    } else if (this._spareTab) {
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
    // Karta lazy nie ma jeszcze widoku (patrz konstruktor Tab) - nie ma wiec
    // czego doczepiac do okna, dopoki sama sie nie obudzi (wake()).
    if (tab.view) this.win.contentView.addChildView(tab.view, 0);
    // Pusta nowa karta na wierzchu: klawiatura ma isc do paska adresu, nie do
    // strony (patrz nizej i _pasekMaFokus w Tab).
    const doPaska = !background && resolved === NEW_TAB;
    if (!bezWyboru && (!background || this.activeTabId === null)) this.selectTab(tab.id, { fokusStrony: !doPaska });
    else this.layout();
    // Pusta nowa karta w tle nie ma czego pokazywac, wiec od razu przenosimy
    // kursor do paska adresu na gorze - tak samo jak Chrome i Firefox, zeby
    // dalo sie od razu pisac. Dla kart z konkretnym adresem (zakladki,
    // historia, link otwarty w nowej karcie) tego nie robimy - tam ma sens
    // patrzec na strone, nie na pasek.
    //
    // Samo selectTab() wyzej juz przelaczylo klawiature na widok karty
    // (tab.wc.focus()) - el.address.focus() w renderer to tylko DOM w
    // powloce, bez shell.focus() klawisze i tak leciałyby dalej do (pustej)
    // strony, nie do paska. Stad shell.focus() TUTAJ, po selectTab().
    // Payload clear:true czysci pasek natychmiast, zamiast czekac na
    // nastepny sync() - inaczej przez chwile widac tam jeszcze adres
    // poprzedniej aktywnej karty, bo renderToolbar() celowo nie nadpisuje
    // wartosci pola, ktore ma akurat fokus (zeby nie kasowac tego, co ktos
    // sam wpisuje).
    if (doPaska) {
      /* Swiezo zbudowana karta (bez karty "na zapas", czyli przy wylaczonym
         szybszym otwieraniu) po zaladowaniu strony sama zabierala klawiature
         paskowi adresu - Ctrl+T, a potem pisanie, trafialo w pustke i trzeba
         bylo kliknac w pasek. Przez kilka sekund od otwarcia (albo do
         pierwszego klikniecia w strone) oddajemy wiec fokus z powrotem
         paskowi, gdyby karta go przejela. */
      tab._pasekMaFokus = Date.now() + 5000;
      const oddaj = () => {
        if (!tab._pasekMaFokus || Date.now() > tab._pasekMaFokus || this.activeTabId !== tab.id) return;
        if (!this.win || this.win.isDestroyed()) return;
        try { this.shell.focus(); } catch (_) {}
        this.send('focus:address', { zachowaj: true });
      };
      // Strona przejmuje klawiature w roznych chwilach ladowania (nie zawsze
      // z jakimkolwiek zdarzeniem), wiec sprawdzamy kilka razy: zaraz, w
      // trakcie i po zaladowaniu. Gdy pasek ma juz fokus, to nic nie zmienia.
      for (const ms of [30, 120, 300, 700, 1500]) setTimeout(oddaj, ms);
      if (tab.wc) { tab.wc.once('dom-ready', oddaj); tab.wc.once('did-stop-loading', oddaj); }
      try { this.shell.focus(); } catch (_) {}
      this.send('focus:address', { clear: true });
    }
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

  selectTab(id, { fokusStrony = true } = {}) {
    const tab = this.tabById(id);
    if (!tab) return;
    if (tab.sleeping) tab.wake();
    tab.lastActiveAt = Date.now();
    this.activeTabId = id;
    diagnostics.przelaczenieKarty(this, id);
    this.closePopover();
    this.closeExtensionPopup();
    if (this.findOpen) this.findOpen = false;
    this.layout();
    if (fokusStrony) { try { tab.wc.focus(); } catch (_) {} }
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

  navigate(input, tabId = null, forceSearch = false) {
    // forceSearch: dla wyszukiwarki na srodku nowej karty - tam, w
    // przeciwienstwie do gornego paska adresu, kazdy wpisany tekst ma isc
    // do wyszukiwarki, nawet jesli wyglada jak adres (np. "jakas domena.pl"
    // wpisana jako pytanie, a nie jako adres do odwiedzenia).
    const tab = tabId ? this.tabById(tabId) : this.activeTab();
    const target = forceSearch ? urls.searchUrl(input) : urls.resolve(input);
    if (!target) return;
    // Wpisane w pasek "mailto:..." albo inny protokol aplikacji - loadURL
    // konczyl sie na nim bledem zamiast otworzyc program pocztowy.
    if (urls.zewnetrznyProtokol(target)) { this.handleExternalProtocol(target); return; }
    if (!tab) return this.newTab({ url: target });
    tab.errorUrl = null;
    /* Uspiona karta w tle nie ma widoku, wiec otworz() rzucalo wyjatek i polecenie
       przepadalo. Zapamietujemy adres: wczyta sie (po sprawdzeniu w otworz) przy
       obudzeniu, bez stawiania procesu dla karty, na ktora nikt nie patrzy. */
    if (tab.sleeping) {
      tab.warnUrl = null;
      tab.url = target;
      tab.title = '';
      tab.favicon = null;
      tab.faviconPrywatna = null;
      tab.siteAccent = null;
      this.scheduleSync();
      return;
    }
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
    if (!t || !t.wc || t.wc.isDestroyed()) return;
    const hist = t.wc.navigationHistory;
    const mozna = kierunek < 0 ? moznaWstecz(t.wc) : moznaDalej(t.wc);
    if (!mozna) return;
    const indeks = hist.getActiveIndex() + kierunek;
    const cel = hist.getEntryAtIndex(indeks);
    const zagrozenie = cel && cel.url ? security.sprawdz(cel.url) : null;
    if (zagrozenie) {
      t.warnUrl = cel.url;
      t.wc.loadURL(security.adresOstrzezenia(zagrozenie.typ, cel.url)).catch(() => {});
      return;
    }
    /* Zawsze dokladnie o jedna strone, jak w Firefoksie. goBack()/goForward()
       Chromium przeskakuja strony, ktore dodaly sie do historii "bez
       klikniecia" (ochrona Chrome przed stronami zasmiecajacymi historie) -
       na stronach, ktore same zmieniaja adres (np. YouTube przy
       autoodtwarzaniu), "wstecz" wyrzucalo przez to od razu na nowa karte
       zamiast na poprzednia strone. */
    hist.goToIndex(indeks);
  }

  goBack() { this.idzWHistorii(-1); }
  goForward() { this.idzWHistorii(1); }
  reload(hard = false, tabId = null) {
    const t = tabId ? this.tabById(tabId) : this.activeTab();
    if (!t) return;
    // Uspiona karta w tle nie ma czego przeladowac - obudzi sie sama
    // (i wczyta od nowa) przy kliknieciu.
    if (!t.wc || t.wc.isDestroyed()) return;
    t.errorUrl ? t.wc.loadURL(t.errorUrl).catch(() => {}) : (hard ? t.wc.reloadIgnoringCache() : t.wc.reload());
  }
  stop() { const t = this.activeTab(); if (t && t.wc && !t.wc.isDestroyed()) t.wc.stop(); }
  goHome() { this.navigate(data.settings.get('homepage', NEW_TAB) || NEW_TAB); }

  /* ------------------------------------------------------------- zoom etc */

  setZoom(factor) {
    const t = this.activeTab();
    if (!t) return;
    const clamped = Math.max(0.25, Math.min(5, factor));
    t.zoom = clamped;
    try { t.wc.setZoomFactor(clamped); } catch (_) {}
    data.setSiteZoom(urls.hostOf(t.url), clamped, this.isPrivate);
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
    // Uspiona karta nie ma procesu - wake() odtworzy wyciszenie z t.muted.
    if (t.wc && !t.wc.isDestroyed()) t.wc.setAudioMuted(t.muted);
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
    /* F11 w trakcie filmu na pelnym ekranie: wychodzimy z pelnego ekranu
       strony (tak jak Chrome). Wczesniej okno wracalo do zwyklego rozmiaru,
       ale strona zostawala w swoim trybie pelnoekranowym - bez paska Nazuny,
       z gornym pasem strony przykrytym przez niewidoczna warstwe. */
    if (this.contentFullScreen) { this.wyjdzZPelnegoEkranuStrony(); return; }
    this.win.setFullScreen(!this.win.isFullScreen());
  }

  wyjdzZPelnegoEkranuStrony() {
    const t = this.activeTab();
    if (t && t.wc && !t.wc.isDestroyed()) {
      t.wc.executeJavaScript('document.fullscreenElement ? document.exitFullscreen().then(() => true, () => false) : false', true).catch(() => {});
    }
    // Na wypadek, gdyby strona nie odpowiedziala - nasz stan i tak wraca.
    setTimeout(() => { if (this.contentFullScreen) this.setContentFullScreen(false); if (this.win && !this.win.isDestroyed() && this.win.isFullScreen()) this.win.setFullScreen(false); }, 800);
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
    // Zamkniete okienko wyboru konta (Esc, klik obok) = anulowane logowanie.
    for (const [k, r] of this._wyborKontaResolvers) { this._wyborKontaResolvers.delete(k); r(null); }
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

  /* Logowanie kluczem dostepu, gdy na kluczu/urzadzeniu jest kilka kont:
     okienko z lista kont w stylu Nazuny (jak wybor konta w Chrome). */
  wybierzKontoKlucza({ rp, konta }) {
    return new Promise((resolve) => {
      for (const [k, r] of this._wyborKontaResolvers) { this._wyborKontaResolvers.delete(k); r(null); }
      const key = `klucz|${Date.now()}`;
      this._wyborKontaResolvers.set(key, resolve);
      this.openPopover('wybor-konta', {
        key, rp,
        konta: konta.map((k) => ({ id: k.credentialId, nazwa: k.displayName || '', login: k.name || '' }))
      });
    });
  }

  odpowiedzWyborKonta(key, id) {
    const resolve = this._wyborKontaResolvers.get(key);
    if (!resolve) return;
    this._wyborKontaResolvers.delete(key);
    resolve(id || null);
    this.closePopover();
  }

  async requestPermission({ permission, origin, strona, osadzona }) {
    return new Promise((resolve) => {
      const key = `${origin}|${permission}|${Date.now()}`;
      this._permissionResolvers.set(key, resolve);
      this.openPopover('permission', { key, permission, origin, strona, osadzona });
    });
  }

  /* Diagnostyka zgloszenia "na stronie nie da sie kliknac niektorych
     przyciskow" (pazdziernik 2026), ktorego nie udalo sie odtworzyc u nas.
     Uzytkownik wciska Ctrl+Shift+Alt+D z kursorem nad przyciskiem, ktory nie
     dziala - zapisujemy uklad wszystkich warstw okna i to, co strona ma pod
     kursorem (elementy na wierzchu, niewidoczne nakladki). */
  async zrzutKlikania() {
    const fs = require('fs');
    const wynik = { czas: new Date().toISOString(), wersja: app.getVersion() };
    try {
      const kursor = screen.getCursorScreenPoint();
      const tresc = this.win.getContentBounds();
      const wOknie = { x: kursor.x - tresc.x, y: kursor.y - tresc.y };
      const t = this.activeTab();
      Object.assign(wynik, {
        okno: this.win.getBounds(), tresc, maksymalizowane: this.win.isMaximized(), pelnyEkran: this.win.isFullScreen(),
        ekran: (() => { const d = monitory.ekranOkna(this.win.getBounds()); return d ? { skala: d.scaleFactor, obszar: d.workArea } : null; })(),
        kursor, wOknie,
        stan: { expanded: this.expanded, popover: this.popover, findOpen: this.findOpen, contentFullScreen: this.contentFullScreen, hint: this.fullscreenHintUntil > Date.now(), chromeHeight: this.chromeHeight(), przeciaganie: !!this.przeciaganieKarty, rozszerzenie: !!this.extensionPopup },
        widoki: this.win.contentView.children.map((v) => { let url = ''; try { url = v.webContents ? v.webContents.getURL().slice(0, 80) : ''; } catch (_) {} return { url: this.isPrivate && !/^nazuna:/.test(url) ? '(prywatne)' : url, bounds: v.getBounds() }; }),
        pasekWarstwa: await this.shell.executeJavaScript(`({ h: innerHeight, expandedCss: document.body.classList.contains('expanded'), warstwa: [...document.getElementById('layer').children].map((n) => n.className), pod: (document.elementFromPoint(${wOknie.x}, ${wOknie.y}) || {}).tagName || null })`).catch((e) => String(e))
      });
      if (t && t.wc && !t.wc.isDestroyed()) {
        const py = wOknie.y - this.chromeHeight();
        wynik.strona = await t.wc.executeJavaScript(`(() => {
          const opis = (e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return e.tagName + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(' ').filter(Boolean).slice(0, 2).join('.') : '') + ' [' + [cs.position, 'z' + cs.zIndex, 'op' + cs.opacity, 'pe:' + cs.pointerEvents, cs.display, cs.visibility].join(' ') + ' ' + [r.left, r.top, r.width, r.height].map(Math.round).join(',') + ']'; };
          const pod = (x, y) => document.elementsFromPoint(x, y).slice(0, 6).map(opis);
          const nakladki = [...document.querySelectorAll('body *')].filter((e) => { const cs = getComputedStyle(e); if (cs.position !== 'fixed' && cs.position !== 'absolute') return false; const r = e.getBoundingClientRect(); return r.width >= innerWidth * 0.6 && r.height >= 40 && cs.pointerEvents !== 'none' && cs.display !== 'none' && (parseFloat(cs.opacity) < 0.05 || cs.visibility === 'hidden' || cs.backgroundColor === 'rgba(0, 0, 0, 0)'); }).slice(0, 15).map(opis);
          return { url: ${this.isPrivate ? "'(prywatne)'" : 'location.hostname'}, kursor: [${wOknie.x}, ${py}], podKursorem: pod(${wOknie.x}, ${py}), gornyPas: [10, 30, 60].map((y) => y + ': ' + pod(innerWidth / 3, y).join(' > ')), nakladki, fullscreen: !!document.fullscreenElement };
        })()`, true).catch((e) => String(e));
      }
    } catch (err) { wynik.blad = String(err && err.stack); }
    try {
      const plik = path.join(diagnostics.folder(), `klikanie-${wynik.czas.replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(plik, JSON.stringify(wynik, null, 2));
      dialog.showMessageBox(this.win, { type: 'info', buttons: ['OK'], noLink: true, title: 'Diagnostyka', message: 'Zapisano informacje o tym, co jest pod kursorem.', detail: plik }).catch(() => {});
    } catch (_) {}
  }

  /* Strona probowala otworzyc okno/karte bez klikniecia (patrz blokada
     wyskakujacych okien wyzej) - krotkie powiadomienie z mozliwoscia
     otwarcia mimo to. */
  zablokowanoOkno(url) {
    if (!/^https?:/i.test(String(url || ''))) return;
    this.send('popup-blocked', { url: String(url).slice(0, 2000), host: urls.prettyHost(url) });
  }

  /* Strona probuje przejsc na adres, ktorego Nazuna sama nie umie wyswietlic
     (patrz urls.zewnetrznyProtokol) - najczesciej to koncowka logowania SSO
     wracajaca do jakiejs aplikacji desktopowej jej wlasnym protokolem
     (np. po zalogowaniu przez Google w przegladarce). Chrome i Firefox
     oddaja to systemowi automatycznie, z krotkim potwierdzeniem - u nas
     nikt tego nie robil, wiec klikniecie takiego linku nie dawalo nic.
     Samo potwierdzenie to tez zabezpieczenie: bez niego dowolna strona
     mogłaby po cichu odpalac zarejestrowane w Windows aplikacje. */
  handleExternalProtocol(target) {
    // Jedno pytanie naraz. Strona ponawiajaca przekierowanie w petli
    // otwierala inaczej cala serie identycznych okienek, jedno na drugim.
    if (this._pytanieOProtokol || !this.win || this.win.isDestroyed()) return;
    let schemat = target;
    try { schemat = new URL(target).protocol.replace(/:$/, ''); } catch (_) { /* zostaw surowy adres */ }
    // Schematy uzywane w atakach na Windows (jak w Chrome) - bez pytania, nigdy.
    if (ZAKAZANE_PROTOKOLY.has(String(schemat).toLowerCase())) return;
    // Po "Anuluj" strona nie moze od razu zasypac nas kolejnym pytaniem.
    if (Date.now() < (this._protokolCiszaDo || 0)) return;
    this._pytanieOProtokol = true;
    dialog.showMessageBox(this.win, {
      type: 'question',
      buttons: ['Otwórz', 'Anuluj'],
      // Enter nie moze od razu odpalic obcej aplikacji.
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'Otworzyć w innej aplikacji?',
      message: `Ta strona chce otworzyć aplikację obsługującą adresy "${schemat}:".`,
      detail: target.length > 200 ? `${target.slice(0, 200)}…` : target
    }).then((res) => {
      if (res.response === 0) shell.openExternal(target).catch(() => {});
      else this._protokolCiszaDo = Date.now() + 10000;
    }).catch(() => {}).finally(() => { this._pytanieOProtokol = false; });
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
    if (remember && this.isPrivate) sessions.zapamietajWSesji(this.session, origin, permission, answer);
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
        // Sprawdzamy i popover, i expanded (nie tylko expanded) - to dwie osobne
        // flagi, ktore w rzadkich przypadkach (np. przebudowanie zawartosci
        // panelu po kliknieciu w nim) moga sie na chwile rozjechac, a wtedy
        // samo "expanded" potrafilo zostawic panel Pobranych czy inny
        // wiszacy na ekranie mimo Escape.
        if (this.extensionPopup) this.closeExtensionPopup();
        else if (this.popover || this.expanded) this.closePopover();
        return;
      }
      if (this.extensionPopup) { this.closeExtensionPopup(); return stop(); }
      if (this.popover) { this.closePopover(); return stop(); }
      if (this.findOpen) { this.closeFind(); return stop(); }
      // Tak jak F11: wyjscie musi objac tez sama strone (document.exitFullscreen),
      // inaczej strona zostaje w swoim trybie pelnoekranowym.
      if (this.contentFullScreen) { this.wyjdzZPelnegoEkranuStrony(); return stop(); }
      return;
    }

    if (ctrl && !shift && !alt) {
      switch (key) {
        case 't': this.newTab({ url: NEW_TAB }); return stop();
        case 'w': this.closeTab(this.activeTabId); return stop();
        case 'n': createWindow({ isPrivate: false }); return stop();
        // shell.focus() jest tu konieczne z tego samego powodu co w newTab():
        // bez niego klawiatura zostaje przy stronie, a pasek tylko WYGLADA
        // na aktywny.
        case 'l': try { this.shell.focus(); } catch (_) {} this.send('focus:address'); return stop();
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

    // Ctrl+Shift+Alt+D - zapis diagnostyki "nie da sie kliknac" (patrz zrzutKlikania).
    if (ctrl && shift && alt && key === 'd') { this.zrzutKlikania(); return stop(); }

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
    // Gwiazdka i Ctrl+D dzialaja tylko na menu zakladek - pasek ma swoje
    // wlasne zakladki (przeciagniecie karty albo prawy przycisk na pasku).
    if (data.isBookmarked(t.url, 'menu')) data.removeBookmarkByUrl(t.url, 'menu');
    else data.addBookmark({ title: t.title, url: t.url, parent: 'menu' });
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
    if (KANALY_POWIADOMIEN.has(channel)) this.pokazToast(channel, payload);
    else if (channel === 'settings:changed' && this.toastView && this._toastGotowy) { try { this.toastView.webContents.send(channel, payload); } catch (_) {} }
  }

  /* Powiadomienia w rogu okna maja wlasna, mala warstwe (src/ui/toast.html).
     Warstwa paska konczy sie na dole paska zakladek, wiec rysowane w niej
     powiadomienie nigdy nie bylo widac, a rozciagniecie calej warstwy paska
     w dol zaslonilby niewidocznie pas strony na cala szerokosc okna. Ta
     warstwa ma dokladnie rozmiar powiadomienia (toast.rozmiar z toast.js),
     a bez powiadomienia - zero, wiec niczego na stronie nie zaslania. */
  pokazToast(channel, payload) {
    if (!this.win || this.win.isDestroyed()) return;
    // Zwykle sprawdzanie aktualizacji (bez nowej wersji) nie potrzebuje warstwy.
    if (!this.toastView && channel === 'update:status' && !['dostepna', 'pobieranie', 'pobrana', 'blad'].includes(payload && payload.status)) return;
    if (!this.toastView) {
      this.toastView = new WebContentsView({
        webPreferences: { preload: path.join(PRELOAD_DIR, 'shell.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, transparent: true }
      });
      this.toastView.setBackgroundColor('#00000000');
      this.toastView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      this.win.contentView.addChildView(this.toastView);
      this.toastView.webContents.loadURL('nazuna://ui/toast.html').catch(() => {});
    }
    if (!this._toastGotowy) { this._toastKolejka.push([channel, payload]); return; }
    try { this.toastView.webContents.send(channel, payload); } catch (_) {}
  }

  toastGotowy() {
    this._toastGotowy = true;
    const kolejka = this._toastKolejka;
    this._toastKolejka = [];
    for (const [c, p] of kolejka) { try { this.toastView.webContents.send(c, p); } catch (_) {} }
  }

  ustawRozmiarToastu(w, h) {
    this._toastRozmiar = { w: Math.max(0, Math.min(600, Number(w) || 0)), h: Math.max(0, Math.min(500, Number(h) || 0)) };
    this.positionToast();
  }

  positionToast() {
    if (!this.toastView || !this.win || this.win.isDestroyed()) return;
    const { w, h } = this._toastRozmiar;
    if (!w || !h) { this.toastView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); return; }
    const { width } = this.win.getContentBounds();
    this.toastView.setBounds({ x: Math.max(0, width - w), y: this.chromeHeight(), width: Math.min(w, width), height: h });
    // Na wierzch, ponad karte i ewentualne okienko rozszerzenia.
    try { this.win.contentView.addChildView(this.toastView); } catch (_) {}
  }

  scheduleSync() {
    if (this._syncQueued) return;
    this._syncQueued = true;
    setTimeout(() => {
      this._syncQueued = false;
      this.sync();
      // Kazda zmiana kart (nowa, zamknieta, przesunieta, nawigacja) przechodzi
      // tedy - zapis sesji z opoznieniem, tylko dla okien zwyklych.
      if (!this.isPrivate) zaplanujZapisSesji();
    }, 16);
  }

  /* Licznik blokad w tarczy: bloker potrafi zglaszac setki zmian na sekunde przy
     ciezkiej stronie, a kazdy pelny sync to cala lista kart i zakladek przez IPC.
     Do oka wystarczy kilka razy na sekunde. */
  scheduleSyncLicznika() {
    if (this._licznikTimer) return;
    this._licznikTimer = setTimeout(() => { this._licznikTimer = null; this.scheduleSync(); }, 250);
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
      // errorUrl ustawiony oznacza, ze wyswietlamy wewnetrzna strone bledu
      // (nazuna://error) pod adresem, ktory sie nie zaladowal - nie mozemy
      // wtedy pokazywac zamknietej klodki, bo zadne polaczenie nie doszlo do
      // skutku (dotyczy tez bledow certyfikatu, ktore i tak zaczynaja sie od
      // https:).
      secure: active ? (!active.errorUrl && /^https:/.test(active.displayUrl)) : false,
      // Etykieta "Niezabezpieczona" idzie razem z przelacznikiem ostrzezen w
      // Ustawieniach - wylaczona ochrona, wylaczona i etykieta, zeby jedno
      // nie przeczylo drugiemu.
      insecure: active && data.settings.get('securityWarningsEnabled', true) ? (/^http:/i.test(active.displayUrl) && !security.lokalny(host)) : false,
      internal: active ? /^nazuna:/.test(active.displayUrl) : false,
      loading: active ? active.loading : false,
      canGoBack: active && !active.wc.isDestroyed() ? moznaWstecz(active.wc) : false,
      canGoForward: active && !active.wc.isDestroyed() ? moznaDalej(active.wc) : false,
      bookmarked: active ? wMenuZakladek(active.displayUrl) : false,
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
      motyw: motywTeraz(),
      // Czy strony dostaja teraz ciemny tryb - ikona slonca/ksiezyca na pasku.
      ciemneStrony: (() => { try { return nativeTheme.shouldUseDarkColors; } catch (_) { return false; } })(),
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
    for (const [k, r] of this._wyborKontaResolvers) { this._wyborKontaResolvers.delete(k); r(null); }
    clearTimeout(this._zapisGranic);
    clearTimeout(this._licznikTimer);
    if (this.toastView) { try { this.toastView.webContents.close(); } catch (_) {} this.toastView = null; }
    for (const tab of this.tabs) tab.destroy();
    this.tabs = [];
    if (this._spareTab) { this._spareTab.destroy(); this._spareTab = null; }
    windows.delete(this);
    /* Sesja okna prywatnego siedzi tylko w pamieci, ale Electron trzyma ja
       tam az do zamkniecia calego programu - ciasteczka i logowania z
       zamknietego okna prywatnego zylyby wiec dalej w tle. Czyscimy ja,
       gdy zamyka sie ostatnie okno, ktore z niej korzystalo. */
    if (this.isPrivate && ![...windows].some((w) => w.partition === this.partition)) {
      const ses = this.session;
      Promise.resolve()
        .then(() => ses.clearStorageData())
        .then(() => ses.clearCache())
        .then(() => ses.clearAuthCache && ses.clearAuthCache())
        .catch(() => {});
    }
    if (this.isPrivate && ![...windows].some((w) => w.isPrivate)) data.wyczyscPrywatneStrony();
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
    add({ id: 'back', label: 'Wstecz', accel: 'Alt+\u2190', enabled: moznaWstecz(tab.wc) });
    add({ id: 'forward', label: 'Dalej', accel: 'Alt+\u2192', enabled: moznaDalej(tab.wc) });
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
  // Linki i obrazki ze strony WWW: bez nazuna://, file:// itp. (patrz urls.dozwoloneZeStrony).
  const zeStrony = wc.getURL();
  if (/^open-(link|image)/.test(id) && !urls.dozwoloneZeStrony(id === 'open-image' ? params.srcURL : params.linkURL, zeStrony)) return;
  switch (id) {
    case 'open-link-tab': appWindow.newTab({ url: params.linkURL, background: true }); break;
    case 'open-link-window': createWindow({ urls: [params.linkURL] }); break;
    case 'open-link-private': createWindow({ isPrivate: true, urls: [params.linkURL] }); break;
    case 'copy-link': clipboard.writeText(params.linkURL); break;
    case 'save-link': downloads.zapiszJako(wc); wc.downloadURL(params.linkURL); break;
    case 'open-image': appWindow.newTab({ url: params.srcURL, background: true }); break;
    case 'copy-image': wc.copyImageAt(params.x, params.y); break;
    case 'copy-image-url': clipboard.writeText(params.srcURL); break;
    case 'save-image': case 'save-media': downloads.zapiszJako(wc); wc.downloadURL(params.srcURL); break;
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
    case 'save-page': downloads.zapiszJako(wc); wc.downloadURL(wc.getURL()); break;
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
  // Rozmiar "normalny" - z okna zmaksymalizowanego getBounds dawalby caly
  // ekran, i to ekranu zrodlowego, ktory moze miec inny rozmiar niz docelowy.
  const stare = monitory.normalne(zrodlo.win) || zrodlo.win.getBounds();
  const tab = zrodlo.odepnijKarte(tabId);
  if (!tab) return null;

  // Nowe okno ma rozmiar poprzedniego i siedzi kursorem mniej wiecej tam,
  // gdzie karta byla trzymana - na tym monitorze, na ktorym jest kursor
  // (punkt), i w calosci na nim (patrz konstruktor AppWindow).
  const bounds = {
    width: stare.width,
    height: stare.height,
    x: Math.round(x - stare.width * 0.25),
    y: Math.round(y - 16),
    punkt: { x, y }
  };
  const nowe = new AppWindow({ isPrivate: zrodlo.isPrivate, partition: zrodlo.partition, puste: true, bounds });
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
    const b = w.win.getContentBounds();
    return y >= b.y && y <= b.y + LAYOUT.tabStrip + 6;
  } catch (_) { return false; }
}

/* Punkt ekranu przeliczony na wspolrzedne wewnatrz okna (te same, ktore zna
   pasek w shell.html). Liczone tutaj, z polozenia okna wedlug Electrona -
   pasek liczyl to sam z window.screenX, co przy roznych skalach monitorow
   rozjezdzalo sie z tym, gdzie naprawde jest kursor. */
function punktWOknie(w, x, y) {
  try {
    const b = w.win.getContentBounds();
    return { x: x - b.x, y: y - b.y };
  } catch (_) { return { x: 0, y: 0 }; }
}

/* Gdzie teraz jest kursor - wedlug procesu glownego (patrz monitory.js). */
function kursor() {
  try { return screen.getCursorScreenPoint(); } catch (_) { return null; }
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
  // Dwa osobno otwarte okna prywatne maja dwie osobne sesje - karta
  // przeniesiona miedzy nimi mieszalaby jedna z druga.
  if (zrodlo.partition !== celWin.partition) return null;
  const tab = zrodlo.odepnijKarte(id);
  if (!tab) return null;
  celWin.przyjmijKarte(tab, index);
  try { celWin.win.focus(); } catch (_) {}
  return celWin;
}

// Przy zamykaniu calego programu (menu, aktualizacja) sesje zapisuje juz
// before-quit w index.js, z okna, ktore bylo na wierzchu - zamykane po kolei
// okna nie moga tego potem nadpisac.
let zamykanieProgramu = false;
let zapisSesjiTimer = null;
try { app.on('before-quit', () => { zamykanieProgramu = true; clearTimeout(zapisSesjiTimer); zapisSesjiTimer = null; }); } catch (_) {}

// Ostatnio aktywne zwykle okno - idzie jako pierwsze w zapisanej sesji.
let ostatnioAktywneZwykle = null;
// Ostatnio aktywne okno dowolnego rodzaju - zrodlo pozycji nowego okna.
let ostatnioAktywneOkno = null;

/* Wzgledem ktorego okna ustawic nowe: z fokusem, a bez fokusu (menu ikony na
   pasku zadan) ostatnio aktywne. Inaczej nowe okno bralo zapisana pozycje i
   stawalo dokladnie na istniejacym. Bez ostatnio aktywnego tylko okna juz
   zbudowane (_kartyGotowe): okna z sesji powstajace razem przy starcie maja
   dalej wracac na zapisana pozycje, a nie przesuwac sie przy kazdym starcie. */
function zrodloNowegoOkna() {
  const zywe = [...windows].filter((w) => w.win && !w.win.isDestroyed());
  const zFokusem = zywe.find((w) => w.win.isFocused());
  if (zFokusem) return zFokusem;
  if (zywe.includes(ostatnioAktywneOkno)) return ostatnioAktywneOkno;
  return zywe.filter((w) => w._kartyGotowe).pop() || null;
}

/* Zapis sesji na biezaco (po awarii, zabiciu procesu czy zaniku pradu
   zostawala lista z ostatniego czystego zamkniecia). Najwyzej raz na 5 s
   i tylko gdy lista sie zmienila, zeby nie mielic dysku. */
const ZAPIS_SESJI_MS = 5000;
function zaplanujZapisSesji() {
  if (zamykanieProgramu || zapisSesjiTimer) return;
  zapisSesjiTimer = setTimeout(() => {
    zapisSesjiTimer = null;
    if (!zamykanieProgramu) zapamietajSesje();
  }, ZAPIS_SESJI_MS);
}

/* Adres karty do zapisu sesji. Podglad pliku z sieci (nazuna://pdf?src=https://...)
   zapisuje adres zrodlowy, po wczytaniu podglad wlaczy sie sam; bez tego karta
   z PDF-em znikala po restarcie. Inne strony nazuna: (tez pliki z dysku: src to
   jednorazowy token nazuna-local:) nie wracaja. */
function adresDoSesji(tab) {
  const u = tab.displayUrl;
  if (!u) return null;
  if (!/^nazuna:/i.test(u)) return u;
  if (!/^nazuna:\/\/(?:pdf|textview)\b/i.test(u)) return null;
  try {
    const src = new URL(u).searchParams.get('src');
    return src && /^https?:\/\//i.test(src) ? src : null;
  } catch (_) { return null; }
}

/* Adresy kart okna i numer aktywnej na tej liscie (karty nazuna: nie wchodza na
   liste, wiec numer liczymy po odsianiu). Aktywna strona wewnetrzna: sasiednia karta. */
function kartyDoSesji(w) {
  const adresy = [];
  let aktywna = 0;
  for (const t of w.tabs) {
    const adres = adresDoSesji(t);
    if (t.id === w.activeTabId) aktywna = adres ? adresy.length : Math.max(0, adresy.length - 1);
    if (adres) adresy.push(adres);
  }
  return { adresy, aktywna };
}

/* Karty do przywrocenia przy nastepnym starcie, osobno dla kazdego zwyklego
   okna (prywatne nigdy). Wczesniej szlo tylko jedno okno i przy "Zakoncz"
   z kilkoma oknami karty pozostalych przepadaly. pierwsze = okno, ktore ma
   wrocic jako glowne (na wierzchu). displayUrl, a nie url: karta pokazujaca
   strone bledu (np. chwilowy brak sieci) ma w url adres nazuna://error
   i inaczej wypadalaby z listy. Okna jeszcze bez kart (w trakcie budowania)
   pomijamy, a gdy nie ma zadnego zwyklego okna, nic nie nadpisujemy.
   restoreSessionAktywne: numer aktywnej karty kazdego okna, osobny klucz, zeby
   format list zostal zrozumialy dla starszych wersji po cofnieciu. */
function zapamietajSesje(pierwsze = null, { synchronicznie = false } = {}) {
  try {
    const zwykle = [...windows].filter((w) => !w.isPrivate && w._kartyGotowe);
    // Bez zwyklych okien sesji nie nadpisujemy, ale przy wylaczaniu Windows
    // reszta ustawien (np. licznik blokad) i tak ma trafic na dysk od razu.
    if (!zwykle.length) { if (synchronicznie) zapiszUstawieniaOdRazu(); return; }
    let glowne = pierwsze && !pierwsze.isPrivate ? pierwsze : null;
    if (!glowne) glowne = zwykle.find((w) => w.win && !w.win.isDestroyed() && w.win.isFocused()) || ostatnioAktywneZwykle;
    if (glowne && zwykle.includes(glowne)) zwykle.sort((a, b) => (a === glowne ? -1 : b === glowne ? 1 : 0));
    const zapisy = zwykle.map(kartyDoSesji).filter((z) => z.adresy.length);
    const okna = zapisy.map((z) => z.adresy);
    const aktywne = zapisy.map((z) => z.aktywna);
    const zmiana = JSON.stringify(okna) !== JSON.stringify(data.settings.get('restoreSessionOkna', null))
      || JSON.stringify(aktywne) !== JSON.stringify(data.settings.get('restoreSessionAktywne', null))
      || JSON.stringify(okna[0] || []) !== JSON.stringify(data.settings.get('restoreSession', null));
    if (zmiana) {
      data.settings.set('restoreSessionOkna', okna);
      data.settings.set('restoreSessionAktywne', aktywne);
      // Plaska lista pierwszego okna - dla starszych wersji po ewentualnym cofnieciu.
      data.settings.set('restoreSession', okna[0] || []);
      if (!synchronicznie) data.settings.flush();
    }
    if (synchronicznie) zapiszUstawieniaOdRazu();
  } catch (_) {}
}

/* Synchroniczny zapis settings.json (store.flush() jest asynchroniczny i przy
   wylaczaniu Windows moze nie zdazyc). Tak samo atomowo: plik tymczasowy
   i podmiana. Potem zwykly flush, zeby ewentualny starszy zapis w toku
   nie zostal na dysku jako ostatni. */
function zapiszUstawieniaOdRazu() {
  try {
    const fs = require('fs');
    const s = data.settings;
    fs.mkdirSync(path.dirname(s.file), { recursive: true });
    const tmp = `${s.file}.sesja.tmp`;
    // fsync przed rename, jak w store.js - inaczej przy wylaczaniu plik bywa pusty.
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, JSON.stringify(s.data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, s.file);
    s.flush();
  } catch (_) {}
}

function createWindow(opts = {}) {
  const w = new AppWindow(opts);
  return w;
}

/* -------------------------------------------------------- usypianie kart */

// Karta w tle dluzej niz ten prog usypia sama (patrz Tab.sleep/Tab.wake
// wyzej). Sprawdzamy co minute - i tak dosc czesto, zeby nikt nie zauwazyl
// opoznienia, a nie ma sensu robic tego czesciej.
//
// Prog nie jest stały jak dawniej - dostosowuje sie do tego, ile wolnej
// pamieci zostalo w systemie (dokladnie to robi Chromowy Memory Saver: im
// mniej wolnej pamieci, tym szybciej usypia karty w tle). Gdy pamieci jest
// pod dostatkiem, nie ma po co ruszac kart wczesniej niz trzeba - kazde
// usniecie to pelne przeladowanie strony przy powrocie.
const TAB_SLEEP_CHECK_MS = 60 * 1000;
const TAB_SLEEP_TIERS = [
  // Mniej niz 15% wolnej pamieci - realna presja, usypiaj agresywnie.
  { wolnegoNiezej: 0.15, poMs: 3 * 60 * 1000 },
  // Mniej niz 35% wolnej - umiarkowana presja, posredni prog.
  { wolnegoNiezej: 0.35, poMs: 10 * 60 * 1000 },
  // Pamieci pod dostatkiem - dotychczasowy, spokojny prog.
  { wolnegoNiezej: 1, poMs: 20 * 60 * 1000 }
];

/* Ulamek wolnej pamieci fizycznej w systemie (0-1). process.getSystemMemoryInfo()
   liczy w KB i jest dostepne tylko w procesie glownym - dokladnie tu, gdzie
   trzeba. Gdy sie nie uda (np. platforma tego nie wspiera), zwracamy 1, czyli
   "pamieci pod dostatkiem" - bezpieczny domysl, bo wtedy dzialamy tak jak
   dotychczasowa, stala wersja usypiania. */
function wolnaPamiecUlamek() {
  try {
    const info = process.getSystemMemoryInfo();
    if (info && info.total > 0) return info.free / info.total;
  } catch (_) {}
  return 1;
}

function progUsypiania() {
  const wolnego = wolnaPamiecUlamek();
  for (const tier of TAB_SLEEP_TIERS) {
    if (wolnego <= tier.wolnegoNiezej) return tier.poMs;
  }
  return TAB_SLEEP_TIERS[TAB_SLEEP_TIERS.length - 1].poMs;
}

function usypianieCheck() {
  if (!data.settings.get('tabSleepEnabled', true)) return;
  const now = Date.now();
  const prog = progUsypiania();
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
      // Strony reczne wylaczone z usypiania (patrz data.isSleepExempt) -
      // uzytkownik sam zdecydowal, ze ta karta ma zyc dalej w tle.
      if (data.isSleepExempt(urls.hostOf(tab.url))) continue;
      if (now - tab.lastActiveAt < prog) continue;
      uspijJesliBezFormularza(tab);
    }
  }
}

/* Uspienie = przeladowanie strony po powrocie, wiec tekst wpisany w
   formularz (komentarz, mail, ogloszenie) by przepadl. Jak Chrome Memory
   Saver: karta z wypelnionym polem albo edytowanym tekstem nie zasypia.
   Sprawdzamy wszystkie ramki (formularze bywaja w iframe). Jak sie nie da
   sprawdzic - na wszelki wypadek nie usypiamy. */
const SKRYPT_FORMULARZA = `(() => {
  try {
    for (const el of document.querySelectorAll('input, textarea')) {
      const t = (el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(t)) continue;
      if (t === 'checkbox' || t === 'radio') { if (el.checked !== el.defaultChecked) return true; continue; }
      if (el.value !== el.defaultValue) return true;
    }
    for (const el of document.querySelectorAll('select')) {
      for (const o of el.options) if (o.selected !== o.defaultSelected) return true;
    }
    const ed = document.activeElement;
    if (ed && ed.isContentEditable && (ed.textContent || '').trim()) return true;
  } catch (_) {}
  return false;
})()`;
function uspijJesliBezFormularza(tab) {
  const wc = tab.wc;
  if (!wc || wc.isDestroyed()) return;
  let ramki = [];
  try { ramki = wc.mainFrame.framesInSubtree; } catch (_) { return; }
  Promise.all(ramki.map((f) => f.executeJavaScript(SKRYPT_FORMULARZA).catch(() => false)))
    .then((wyniki) => {
      if (wyniki.some(Boolean)) return;
      if (tab.sleeping || tab.wc !== wc || !tab.owner || tab.id === tab.owner.activeTabId) return;
      tab.sleep();
    })
    .catch(() => {});
}

function startTabSleep() {
  setInterval(usypianieCheck, TAB_SLEEP_CHECK_MS);
}

/* Odpala watchdog diagnostyczny (patrz diagnostics.js) - osobno od reszty
   startu, zeby dalo sie go wywolac z index.js w tym samym miejscu, co
   startTabSleep(). */
function startDiagnostics() {
  diagnostics.start(() => windows);
}

/* Zmiana monitorow w trakcie pracy: odlaczony monitor, inna skala, inny
   uklad ekranow w Ustawieniach Windows, laptop wyjety ze stacji dokujacej.
   Windows zwykle sam przenosi okna z odlaczonego ekranu, ale nie zawsze
   (okno zmaksymalizowane, zapamietana pozycja "normalna" dalej na starym
   ekranie) - wtedy okno albo jego przywrocony rozmiar zostawal poza
   ekranem. Po kazdej takiej zmianie sprawdzamy kazde okno i w razie
   potrzeby przestawiamy je na najblizszy istniejacy ekran. Przy okazji
   przeliczamy uklad (zmiana skali zmienia wymiary w punktach). */
let monitoryTimer = null;
function sprawdzOknaPoZmianieEkranow() {
  clearTimeout(monitoryTimer);
  // Windows wysyla kilka zdarzen pod rzad i sam jeszcze przesuwa okna -
  // dajemy mu chwile, zanim cokolwiek poprawimy.
  monitoryTimer = setTimeout(() => {
    for (const w of windows) {
      if (!w.win || w.win.isDestroyed()) continue;
      try {
        if (!w.win.isFullScreen()) {
          const nb = monitory.normalne(w.win);
          if (nb && !monitory.widoczne(nb)) {
            const bylo = w.win.isMaximized();
            const cel = monitory.dopasuj(nb, monitory.ekranOkna(nb) || monitory.glowny());
            const naEkranie = monitory.widoczne(cel) ? cel : monitory.domyslne(nb.width, nb.height);
            if (bylo) w.win.unmaximize();
            monitory.ustawGranice(w.win, naEkranie);
            if (bylo) w.win.maximize();
          }
        }
        w.layout();
        w.invalidateActiveTab();
        w.scheduleSync();
      } catch (_) {}
    }
  }, 600);
}

function startMonitory() {
  try {
    screen.on('display-removed', sprawdzOknaPoZmianieEkranow);
    screen.on('display-added', sprawdzOknaPoZmianieEkranow);
    screen.on('display-metrics-changed', sprawdzOknaPoZmianieEkranow);
  } catch (_) {}
}

/* Dla ekranu Ustawien - ile kart aktualnie spi i jaki prog bezczynnosci
   obowiazuje teraz (patrz refreshTabSleepInfo() w settings.js). */
function tabSleepStatus() {
  let sleeping = 0;
  let total = 0;
  for (const win of windows) {
    for (const tab of win.tabs) {
      total++;
      if (tab.sleeping) sleeping++;
    }
  }
  return { sleeping, total, progMs: progUsypiania(), wolnaPamiecUlamek: wolnaPamiecUlamek() };
}

/* Jasny/ciemny tryb dla stron (patrz zrodloMotywuStron w constants.js).
   rozstrzygnijMotyw przy 'system' pyta nativeTheme.shouldUseDarkColors, a to
   przy themeSource 'system' dalej odpowiada wedlug Windowsa - zgodnie. */
function ustawMotywStron() {
  try {
    const zrodlo = zrodloMotywuStron(data.settings.get('motywStron', 'system'));
    // Tylko przy zmianie - przypisanie emituje 'updated', a nasluch nizej wola repaintTheme.
    if (nativeTheme.themeSource !== zrodlo) nativeTheme.themeSource = zrodlo;
  } catch (_) {}
}

/* Po kliknieciu slonca/ksiezyca: aktywna karta kazdego okna przeladowuje sie
   sama, zeby strona od razu przyszla w nowym trybie (serwer dostaje nowy
   naglowek Sec-CH-Prefers-Color-Scheme, patrz session.js). Karty w tle
   zostawiamy - przeladowanie moglo by zgubic wpisany w nich tekst. */
function przeladujPoZmianieMotywuStron() {
  for (const w of windows) {
    const t = w.activeTab();
    if (!t || !t.wc || t.wc.isDestroyed()) continue;
    if (!/^https?:/i.test(t.wc.getURL())) continue;
    try { t.wc.reload(); } catch (_) {}
  }
}

/* Po zmianie motywu trzeba przemalowac to, co maluje sie poza stronami:
   tlo okna i tla naszych wlasnych kart. Inaczej stary kolor siedzi tam az do
   ponownego uruchomienia i przy przelaczaniu kart widac blysk. */
function repaintTheme() {
  ustawMotywStron();
  for (const w of windows) {
    try { w.win.setBackgroundColor(tloOkna(w.isPrivate)); } catch (_) {}
    for (const t of w.tabs) {
      try { t.view.setBackgroundColor(pageBackground(t.url, w.isPrivate)); } catch (_) {}
    }
  }
}

// Gdy uzytkownik wybral "jak w systemie", zmiana w Windowsie ma dzialac od razu.
try {
  nativeTheme.on('updated', () => {
    // Zmiana w Windows: wazna dla motywu Klasyczny 'jak w systemie' i dla stron
    // 'jak w Windows' (ikona slonca/ksiezyca na pasku).
    if (data.settings.get('theme', 'dark') !== 'system' && data.settings.get('motywStron', 'system') !== 'system') return;
    repaintTheme();
    for (const w of windows) w.scheduleSync();
    broadcastAll('settings:changed');
  });
} catch (_) {}

/* Kanaly, ktore musza dotrzec tez do tresci naszych wlasnych kart (nazuna://),
   nie tylko do samej ramki przegladarki: przelaczenie motywu ma byc widac od
   razu we wszystkich otwartych kartach, tak samo zmiana kafelkow nowej karty,
   gdy kilka okien ma otwarte "Nowa karta" naraz. */
/* Kanaly, ktore pokazuja powiadomienie w rogu okna (patrz pokazToast). */
const KANALY_POWIADOMIEN = new Set(['update:status', 'download-blocked', 'popup-blocked', 'toast:rozszerzenie']);

const DO_WLASNYCH_KART = new Set([
  'settings:changed', 'skroty:zmiana', 'update:status', 'bookmarks:changed',
  'download-started', 'download-updated', 'download-done',
  'history:changed', 'downloads:changed'
]);

/* filtr (opcjonalny) wybiera okna, do ktorych wiadomosc ma trafic - np.
   pobranie z okna prywatnego nie ma sie pokazywac w zwyklych oknach. */
function broadcastAll(channel, payload, filtr = null) {
  if (channel === 'bookmarks:changed') adresyMenuZakladek = null;
  for (const w of windows) {
    if (filtr && !filtr(w)) continue;
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

module.exports = { AppWindow, createWindow, punktWOknie, kursor, zapamietajSesje, wyrwijKarte, przeniesKarte, oknoPodPunktem, wPasku, startMs, ZETON, zacznijPrzeciaganie, odbierzPrzeciaganie, allWindows, focusedWindow, windows, runContextAction, broadcastAll, repaintTheme, ustawMotywStron, przeladujPoZmianieMotywuStron, NEW_TAB, closedTabs, startTabSleep, tabSleepStatus, startDiagnostics, startMonitory };
