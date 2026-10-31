'use strict';
const path = require('path');
const { app, session, webContents } = require('electron');
const { chromeUserAgent, acceptLanguages, PRELOAD_DIR } = require('./constants');
const protocolHelper = require('./protocol');
const adblock = require('./adblock');
const downloads = require('./downloads');
const data = require('./data');
const { getDomain } = require('tldts-experimental');
const extensions = require('./extensions');

const prepared = new Set();

// Wszystko, co stale, liczymy raz przy starcie. Ten kod biegnie przy KAZDYM
// zapytaniu sieciowym, wiec nie ma tu miejsca na zbedna prace.
const UA = chromeUserAgent();
const CHROME_MAJOR = (process.versions.chrome || '120').split('.')[0];
const CHROME_FULL = process.versions.chrome || '120.0.0.0';
const GIVEAWAY = /Electron|Nazuna/i;

/* Podpowiedzi klienta (naglowki sec-ch-ua) to dzis wazniejsza wizytowka niz
   stary User-Agent. Chromium wpisuje tam siebie i losowa mars-mark, ale nie
   wpisuje "Google Chrome", bo nim nie jest. Powstawala przez to sprzecznosc:
   User-Agent mowil Chrome, a sec-ch-ua mowil "nie Chrome". Dopisujemy wiec
   brakujaca marke do tego, co Chromium wygenerowalo, zamiast podmieniac calosc.
   Dzieki temu zachowujemy jego losowa mars-mark i kolejnosc, czyli wygladamy
   dokladnie tak jak Chrome, a nie jak sztywna podrobka.

   Wazne: nigdy nie DODAJEMY tego naglowka tam, gdzie Chromium go nie wyslalo.
   Chrome pomija go np. przy nawigacjach po zwyklym http, i gdybysmy go tam
   dopisali, stworzylibysmy nowa niespojnosc zamiast usunac stara. */
const CHROME_BRAND = 'Google Chrome';
function withChromeBrand(value, version) {
  const raw = String(value || '');
  if (!raw) return raw;
  if (raw.includes(`"${CHROME_BRAND}"`)) return raw;
  return `${raw}, "${CHROME_BRAND}";v="${version}"`;
}
const chUaCache = new Map();
function patchHint(value, version) {
  let out = chUaCache.get(value);
  if (out === undefined) {
    out = withChromeBrand(value, version);
    if (chUaCache.size > 32) chUaCache.clear();   // realnie sa tu 2-3 wartosci
    chUaCache.set(value, out);
  }
  return out;
}
// keyboardLock celowo poza lista: pozwala stronie przejac Escape w pelnym ekranie.
const AUTO_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'background-sync', 'pointerLock', 'accessibility-events', 'top-level-storage-access']);
// window-management/window-placement (getScreenDetails - uklad wszystkich monitorow, nie
// tylko jednego ekranu) to realny sygnal do rozpoznawania urzadzenia - prawdziwy Chrome
// tez o to pyta, wiec u nas rowniez idzie przez ASK, a nie ciche przyznanie.
// fileSystem - odczyt/zapis pliku lub folderu wskazanego przez uzytkownika w oknie
// wyboru (File System Access API, np. vscode.dev "Open Folder" i potem Ctrl+S).
// Bez tego bylo odrzucane bez pytania i zapis konczyl sie bledem NotAllowedError.
const ASK = new Set(['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'midiSysex', 'hid', 'serial', 'usb', 'display-capture', 'idle-detection', 'storage-access', 'window-management', 'window-placement', 'fileSystem']);

let permissionPrompt = null;   // set by the window layer
function setPermissionPrompt(fn) { permissionPrompt = fn; }

let dntEnabled = true;
let obceCiasteczka = true;   // czy blokujemy ciasteczka podmiotow trzecich
let webrtcProtekcja = true;  // czy WebRTC ma ukrywac lokalny adres IP
function refreshFlags() {
  dntEnabled = data.settings.get('doNotTrack', true) !== false;
  obceCiasteczka = data.settings.get('blockThirdPartyCookies', true) !== false;
  webrtcProtekcja = data.settings.get('webrtcLeakProtection', true) !== false;
}

/* WebRTC potrafi ujawnic adres IP z Twojej lokalnej sieci nawet stronie,
   ktora go w ogole nie potrzebuje - wystarczy ukryta proba polaczenia peer-to-peer,
   a przegladarka sama zglasza kandydatow ICE ze wszystkich swoich interfejsow
   sieciowych. "default_public_interface_only" ogranicza to do interfejsu
   uzywanego do wyjscia w internet, wiec strona nadal moze nawiazac prawdziwe
   polaczenie (rozmowa wideo dziala), tylko nie widzi juz adresow z sieci
   domowej czy firmowej. Wylaczenie w Ustawieniach wraca do zachowania
   Chromium bez zadnych ograniczen. */
function stosujWebRtc(ses) {
  try { ses.setWebRTCIPHandlingPolicy(webrtcProtekcja ? 'default_public_interface_only' : 'default'); } catch (_) {}
}

/* Wywolane z ipc.js po przelaczeniu ustawienia - dziala od razu, bez potrzeby
   przeladowania karty czy restartu przegladarki, bo polityka WebRTC jest
   sprawdzana przez Chromium przy kazdej nowej probie polaczenia. */
function applyWebRtcToAll() {
  for (const ses of prepared) stosujWebRtc(ses);
}

/* Domena strony, na ktorej jestesmy, dla kazdej karty. Trzymamy ja w pamieci,
   bo inaczej trzeba by ja wyliczac przy KAZDYM zapytaniu sieciowym, a przez ten
   kod przechodzi caly ruch przegladarki. */
const domenyKart = new Map();
function ustawDomeneKarty(id, url) {
  const d = getDomain(String(url || '')) || '';
  if (d) domenyKart.set(id, d); else domenyKart.delete(id);
}
function zapomnijKarte(id) { domenyKart.delete(id); }

/* Wyjatki od blokady obcych ciasteczek, przyznane przez uzytkownika w okienku
   "Dostep do danych witryny". Klucz to PARA: strona w pasku adresu i domena
   osadzona w srodku. Dzieki temu zgoda dla google.com na facebook.com nie
   otwiera google.com dostepu wszedzie indziej.

   Trzymamy je OSOBNO dla kazdej sesji (kazdej partycji), a nie w jednym
   wspolnym zbiorze - inaczej zgoda przyznana w oknie prywatnym dzialalaby
   tez w zwyklym oknie i odwrotnie, mimo ze to z zalozenia oddzielne
   przegladanie. */
const wyjatkiPoSesji = new WeakMap();
function wyjatkiDlaSesji(ses) {
  let s = wyjatkiPoSesji.get(ses);
  if (!s) { s = new Set(); wyjatkiPoSesji.set(ses, s); }
  return s;
}
/* Rozdzielamy znakiem ">", a nie kreska pionowa, bo kreska rozdziela czlony
   klucza uprawnienia i para rozjechalaby sie przy zapamietywaniu wyboru. */
function kluczPary(strona, osadzona) { return `${strona}>${osadzona}`; }
function dodajWyjatek(ses, strona, osadzona) {
  if (strona && osadzona) wyjatkiDlaSesji(ses).add(kluczPary(strona, osadzona));
}
function maWyjatek(ses, strona, osadzona) {
  return wyjatkiDlaSesji(ses).has(kluczPary(strona, osadzona));
}
function wczytajWyjatki(ses) {
  // Zapamietane wybory wracaja po ponownym uruchomieniu przegladarki - ale
  // tylko w zwyklych oknach, bo tylko tam cokolwiek trwale zapisujemy.
  try {
    const zapisane = data.siteStore.data.permissions || {};
    const zbior = wyjatkiDlaSesji(ses);
    for (const klucz of Object.keys(zapisane)) {
      if (zapisane[klucz] && zapisane[klucz]['storage-access'] === 'allow' && klucz.includes('>')) zbior.add(klucz);
    }
  } catch (_) {}
}

/* Zapytanie jest "obce", gdy idzie do innej domeny niz ta, ktora widzisz
   w pasku adresu. Wlasnie tedy plynie sledzenie miedzy stronami. */
function obce(ses, details) {
  if (details.webContentsId === undefined) return false;
  // Sama nawigacja karty (wpisany adres, klikniety link, przekierowanie
  // logowania) nigdy nie jest obca - to strona, na ktora wlasnie wchodzisz.
  if (details.resourceType === 'mainFrame') return false;
  const strona = domenyKart.get(details.webContentsId);
  if (!strona) return false;
  const cel = getDomain(details.url || '');
  if (!cel || cel === strona) return false;
  // Uzytkownik moze swiadomie wpuscic konkretna osadzona domene na konkretnej
  // stronie. Bez tego okienko z prosba o zgode obiecywalo cos, czego nie
  // dowozilo: zezwalales, a ciasteczka i tak byly wycinane pietro nizej.
  if (maWyjatek(ses, strona, cel)) return false;
  return true;
}

/* Strony, ktore Chromium samo nie umie pokazac ladnie (PDF), albo pokazuje
   surowym, nieforemnym tekstem (JSON, zwykly .txt) - patrz nazuna://pdf i
   nazuna://textview w src/ui/pages. Dotyczy tylko GLOWNEJ ramki (kliknietego
   linku czy wpisanego adresu), nigdy zasobow WEWNATRZ strony (obrazkow,
   zapytan fetch/XHR jakiejs aplikacji) - inaczej kazda strona korzystajaca
   z JSON-a przez fetch zaczelaby sama nawigowac gdzies indziej. */
const VIEWER_TYPES = { 'application/pdf': 'pdf', 'application/json': 'textview', 'text/plain': 'textview' };
const doPodgladu = new Set();   // id kart, ktorych nawigacje wlasnie podmieniamy na podglad
/* Czy blad ladowania tej karty to tylko skutek podmiany na podglad (a nie
   prawdziwy problem do pokazania). Jednorazowe - zdejmuje znacznik. */
function bladOdPodgladu(wcId) { return doPodgladu.delete(wcId); }
function naglowek(headers, nazwa) {
  if (!headers) return '';
  for (const klucz of Object.keys(headers)) {
    if (klucz.toLowerCase() === nazwa) {
      const wartosc = headers[klucz];
      return String(Array.isArray(wartosc) ? wartosc[0] : wartosc || '');
    }
  }
  return '';
}
function typZasobu(headers) {
  return naglowek(headers, 'content-type').split(';')[0].trim().toLowerCase();
}
function podmienNaPodglad(details) {
  if (details.resourceType !== 'mainFrame') return false;
  if (/^nazuna:/i.test(details.url)) return false;
  // Tylko prawdziwa tresc (2xx). Przekierowanie (3xx) tez potrafi miec typ
  // text/plain, a jego przechwycenie zrywalo przekierowanie i podglad
  // pokazywal pozniej docelowa strone jako surowy tekst.
  if (!(details.statusCode >= 200 && details.statusCode < 300)) return false;
  // Podglad pobiera plik jeszcze raz, zwyklym GET-em. Odpowiedz na wyslany
  // formularz (POST) dostalby wtedy inna, albo zadna.
  if (details.method && details.method !== 'GET') return false;
  // Strona sama poprosila o pobranie (Content-Disposition: attachment) - to
  // jej swiadoma decyzja, ze plik ma trafic na dysk, a nie do podgladu.
  // Chrome i Firefox tak samo respektuja ten naglowek nawet dla PDF-ow.
  if (/attachment/i.test(naglowek(details.responseHeaders, 'content-disposition'))) return false;
  const widok = VIEWER_TYPES[typZasobu(details.responseHeaders)];
  if (!widok) return false;
  const wc = webContents.fromId(details.webContentsId);
  if (!wc || wc.isDestroyed()) return false;
  const cel = `nazuna://${widok}?src=${encodeURIComponent(details.url)}`;
  // Anulowanie ponizej konczy oryginalna nawigacje bledem ERR_BLOCKED_BY_CLIENT,
  // a karta (did-fail-load w window.js) reaguje na blad strona nazuna://error.
  // Bez tego znacznika to, ktora nawigacja wygra, bylo kwestia przypadku -
  // czasem zamiast podgladu pliku zostawala strona bledu.
  doPodgladu.add(wc.id);
  setTimeout(() => doPodgladu.delete(wc.id), 5000);
  // Nawigacja startuje dopiero po zakonczeniu tego callbacku (cancel:true) -
  // inaczej wchodzilibysmy w drugie zadanie sieciowe w trakcie obslugi
  // pierwszego.
  setImmediate(() => { try { wc.loadURL(cel); } catch (_) {} });
  return true;
}

function forPartition(partition) {
  const ses = partition ? session.fromPartition(partition) : session.defaultSession;
  // Partycje bez przedrostka "persist:" Electron trzyma tylko w pamieci - to
  // wlasnie takich uzywaja okna prywatne (patrz AppWindow.partition).
  const efemeryczna = !!partition && !partition.startsWith('persist:');
  prepare(ses, efemeryczna);
  return ses;
}

function prepare(ses, efemeryczna) {
  if (prepared.has(ses)) return ses;
  prepared.add(ses);

  // Drugi argument ustawia tez navigator.languages po stronie strony, wiec
  // jezyk zgadza sie w naglowku i w JavaScripcie.
  ses.setUserAgent(UA, acceptLanguages());
  // Bez tego Chromium sam zgaduje jezyk slownika (czesto wychodzi angielski),
  // a sprawdzanie pisowni po angielsku w polskim tekscie tylko podkresla
  // wszystko na czerwono. Ustawiamy go tylko, gdy uzytkownik w ogole wlaczyl
  // sprawdzanie pisowni w Ustawieniach - patrz spellcheckEnabled w data.js.
  if (data.settings.get('spellcheckEnabled', false)) {
    try { ses.setSpellCheckerLanguages([app.getLocale() || 'pl']); } catch (_) {}
  }
  protocolHelper.handleFor(ses);
  downloads.attach(ses);

  // Usuwamy naglowek, po ktorym niektore strony wyluskuja Electrona, i
  // dopisujemy Do Not Track, gdy uzytkownik go chce.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    // Chromium czeka na ten callback BEZ LIMITU CZASU - jesli cokolwiek tu
    // rzuci wyjatek zanim go wywolamy, to jedno zadanie sieciowe wisi w
    // nieskonczonosc, a jesli trafi to na glowny dokument strony, wyglada to
    // dla uzytkownika jak "strona laduje sie w nieskonczonosc" (zlapane
    // realnie w diagnostyce na zwyklym przeladowaniu youtube.com). Dlatego,
    // tak jak w adblock.js, blad w naszym kodzie nigdy nie moze zablokowac
    // zadania - w najgorszym razie puszczamy je z oryginalnymi naglowkami.
    try {
      const headers = details.requestHeaders;
      const ua = headers['User-Agent'];
      if (ua !== undefined && GIVEAWAY.test(ua)) headers['User-Agent'] = UA;
      const hint = headers['sec-ch-ua'] !== undefined ? 'sec-ch-ua' : (headers['Sec-CH-UA'] !== undefined ? 'Sec-CH-UA' : null);
      if (hint) headers[hint] = patchHint(headers[hint], CHROME_MAJOR);
      const full = headers['sec-ch-ua-full-version-list'] !== undefined
        ? 'sec-ch-ua-full-version-list'
        : (headers['Sec-CH-UA-Full-Version-List'] !== undefined ? 'Sec-CH-UA-Full-Version-List' : null);
      if (full) headers[full] = patchHint(headers[full], CHROME_FULL);
      if (dntEnabled) headers['DNT'] = '1';
      /* Global Privacy Control. W czesci stanow USA respektowanie go jest
         obowiazkiem prawnym. W Europie nie zdejmuje banera, ale nic nie kosztuje
         i mowi wprost: nie zgadzam sie na handel moimi danymi. */
      headers['Sec-GPC'] = '1';
      if (obceCiasteczka && obce(ses, details)) {
        delete headers['Cookie'];
        delete headers['cookie'];
      }
      callback({ requestHeaders: headers });
    } catch (_) {
      callback({});
    }
  });

  /* Druga polowa blokowania obcych ciasteczek: nie dosc, ze ich nie wysylamy,
     to jeszcze nie pozwalamy ich sobie zakladac. */
  ses.webRequest.onHeadersReceived((details, callback) => {
    // Ta sama zasada co wyzej w onBeforeSendHeaders - callback musi zostac
    // wywolany zawsze, inaczej to zadanie wisi w nieskonczonosc.
    try {
      if (podmienNaPodglad(details)) return callback({ cancel: true });
      if (!obceCiasteczka || !obce(ses, details)) return callback({});
      const h = details.responseHeaders;
      if (!h) return callback({});
      let ruszone = false;
      for (const klucz of Object.keys(h)) {
        if (klucz.toLowerCase() === 'set-cookie') { delete h[klucz]; ruszone = true; }
      }
      callback(ruszone ? { responseHeaders: h } : {});
    } catch (_) {
      callback({});
    }
  });

  ses.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    const origin = (() => {
      try { return new URL(details && details.requestingUrl ? details.requestingUrl : webContents.getURL()).hostname; }
      catch (_) { return ''; }
    })();
    if (AUTO_ALLOW.has(permission)) return callback(true);
    if (!ASK.has(permission)) return callback(false);

    /* Dostep do wlasnych danych przez element osadzony w cudzej stronie.
       Pytanie dotyczy PARY stron, wiec i zapamietujemy je parami. */
    if (permission === 'storage-access') {
      const strona = domenyKart.get(webContents.id) || '';
      const osadzona = getDomain(details && details.requestingUrl ? details.requestingUrl : '') || origin;
      const para = kluczPary(strona, osadzona);
      const pamiec = data.permissionFor(para, permission);
      if (pamiec === 'allow') { dodajWyjatek(ses, strona, osadzona); return callback(true); }
      if (pamiec === 'deny') return callback(false);
      if (!permissionPrompt) return callback(false);
      try {
        const odp = await permissionPrompt({ webContents, permission, origin: para, details, strona, osadzona });
        if (odp === 'allow') dodajWyjatek(ses, strona, osadzona);
        return callback(odp === 'allow');
      } catch (_) { return callback(false); }
    }

    /* Dostep do pliku/folderu: zgoda dotyczy KONKRETNEJ sciezki i rodzaju
       dostepu, a nie calej strony - "zapamietaj" przy jednym pliku nie moze
       otwierac stronie zapisu wszedzie. Dlatego klucz to strona + sciezka. */
    if (permission === 'fileSystem') {
      const sciezka = details && details.filePath ? String(details.filePath) : '';
      const rodzaj = details && details.fileAccessType === 'readable' ? 'odczyt' : 'zapis';
      const klucz = `${origin}>${rodzaj}: ${sciezka}`;
      const pamiec = data.permissionFor(klucz, permission);
      if (pamiec === 'allow') return callback(true);
      if (pamiec === 'deny') return callback(false);
      if (!permissionPrompt) return callback(false);
      try {
        const odp = await permissionPrompt({ webContents, permission, origin: klucz, details });
        return callback(odp === 'allow');
      } catch (_) { return callback(false); }
    }

    const remembered = data.permissionFor(origin, permission);
    if (remembered === 'allow') return callback(true);
    if (remembered === 'deny') return callback(false);
    if (!permissionPrompt) return callback(false);
    try {
      const answer = await permissionPrompt({ webContents, permission, origin, details });
      callback(answer === 'allow');
    } catch (_) { callback(false); }
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (AUTO_ALLOW.has(permission)) return true;
    let host = '';
    try { host = new URL(requestingOrigin).hostname; } catch (_) {}
    return data.permissionFor(host, permission) === 'allow';
  });

  refreshFlags();
  stosujWebRtc(ses);
  // Zapamietane wyjatki wczytujemy tylko do trwalych sesji - okno prywatne
  // startuje z czystym kontem i tak samo je zostawia.
  if (!efemeryczna) wczytajWyjatki(ses);
  if (data.settings.get('adblockEnabled', true)) adblock.enableFor(ses);

  return ses;
}

async function loadExtensions(ses) {
  if (!data.settings.get('extensionsEnabled', true)) return [];
  const loaded = [];
  for (const rec of extensions.records()) {
    if (rec.enabled === false) continue;
    try {
      const host = ses.extensions || ses;      // w nowszym Electronie przeniesione do session.extensions
      const ext = await host.loadExtension(rec.path, { allowFileAccess: false });
      // Chromium sam wylicza swoje id; zapamietujemy je, zeby adresy chrome-extension:// dzialaly.
      if (ext && ext.id && rec.runtimeId !== ext.id) rec.runtimeId = ext.id;
      rec.loadError = null;
      loaded.push(ext);
    } catch (err) {
      console.warn(`[ext] ${rec.name || rec.id} nie wczytało się: ${err.message}`);
      rec.loadError = err.message;
    }
  }
  data.extensionsStore.save();
  return loaded;
}

module.exports = { forPartition, prepare, loadExtensions, bladOdPodgladu, setPermissionPrompt, refreshFlags, applyWebRtcToAll, ustawDomeneKarty, zapomnijKarte, prepared };
