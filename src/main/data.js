'use strict';
const path = require('path');
const { app } = require('electron');
const { Store } = require('./store');

let settings, bookmarks, history, downloads, extensionsStore, siteStore;

const DEFAULT_SETTINGS = {
  searchEngine: 'google',
  homepage: 'nazuna://newtab',
  startup: 'newtab',            // newtab | restore | homepage
  newTabBackground: 'aurora',
  adblockEnabled: true,
  adblockMode: 'safe',
  showBookmarksBar: true,
  showSuggestions: true,
  askWhereToSave: false,
  downloadDir: '',
  doNotTrack: true,
  passkeys: false,
  blockThirdPartyCookies: true,
  securityWarningsEnabled: true,
  hardwareAcceleration: true,
  // Domyslnie wylaczone: Chromium laduje slownik sprawdzania pisowni do
  // KAZDEJ karty osobno (to osobny, zywy proces), a bez jawnego ustawienia
  // jezyka i tak dobiera go automatycznie, wiec czesto wcale nie po polsku.
  // Kto chce, wlacza w Ustawieniach - wtedy dobieramy tez jezyk (patrz session.js).
  spellcheckEnabled: false,
  // Karta w tle, o ktorej uzytkownik zapomnial na dluzej, usypia sama -
  // zamyka jej proces renderujacy, a budzi go z powrotem (przeladowaniem)
  // dopiero gdy karta znow stanie sie aktywna. Patrz progUsypiania() w window.js.
  tabSleepEnabled: true,
  // Gdy wlaczone, kazde okno trzyma w tle jedna gotowa, juz zaladowana karte
  // nowej karty - klikniecie "+" bierze ja od razu zamiast czekac na budowe
  // calkiem nowego procesu renderujacego od zera (to wlasnie ten widoczny,
  // krotki blysk pustej karty). Koszt to jeden dodatkowy proces na okno,
  // caly czas w tle - kto woli oszczedzac pamiec, wylacza w Ustawieniach.
  tabPrewarmEnabled: true,
  // Gdy wlaczone, pasek Nazuny lekko przebarwia sie na kolor wyliczony z
  // favicony aktywnej strony (jak w Vivaldim) - czysto kosmetyczne, wylacza
  // sie w Ustawieniach dla kogos, kto woli staly, jeden akcent kolorystyczny.
  siteAccentEnabled: true,
  extensionsEnabled: true,
  defaultZoom: 1,
  theme: 'dark',            // dark | light | system
  accent: 'violet',
  restoreSession: null,
  // Ukrywanie lokalnego adresu IP w WebRTC (WEBRTC_IP_HANDLING_POLICY) - patrz
  // stosujWebRtc() w session.js. Wlaczone domyslnie, bo to czysta higiena bez
  // realnego kosztu: strony i tak dostaja publiczny adres, gdy WebRTC
  // faktycznie tego potrzebuje (np. rozmowa wideo), tylko nie widza juz
  // adresow z Twojej sieci domowej/firmowej.
  webrtcLeakProtection: true,
  // DNS przez HTTPS - patrz DOH_PROVIDERS w constants.js i applySecureDns()
  // w privacy.js. 'off' zostawia DNS systemowi, tak jak dzis.
  secureDns: 'cloudflare',
  // Utrudnianie rozpoznawania przegladarki po odczycie z canvasu, WebGL i
  // Web Audio - patrz preload/web.js. Kazda strona (po swojej domenie)
  // dostaje spojny, ale lekko przesuniety odczyt, wiec nie da sie po nim
  // odrozniac Cie od innych ani sledzic miedzy stronami, a jednoczesnie ten
  // sam odczyt nie skacze przy kazdym przeladowaniu tej samej strony.
  fingerprintProtection: true
};

function init() {
  const dir = app.getPath('userData');
  settings = new Store(path.join(dir, 'settings.json'), DEFAULT_SETTINGS);
  bookmarks = new Store(path.join(dir, 'bookmarks.json'), { items: [], nextId: 1 });
  history = new Store(path.join(dir, 'history.json'), { items: [] });
  downloads = new Store(path.join(dir, 'downloads.json'), { items: [] });
  extensionsStore = new Store(path.join(dir, 'extensions.json'), { installed: [] });
  siteStore = new Store(path.join(dir, 'sites.json'), { adblockOff: [], zoom: {}, permissions: {}, skroty: [], skrotyUkryte: [], httpZaakceptowane: [], sleepExempt: [] });
}

/* ------------------------------------------------------------------ history */

const HISTORY_CAP = 30000;

function addHistory(url, title) {
  if (!url || /^(nazuna|about|chrome-extension|devtools|data|blob):/i.test(url)) return;
  const items = history.data.items;
  const now = Date.now();
  const last = items[0];
  if (last && last.url === url && now - last.ts < 30000) {
    last.title = title || last.title;
    last.ts = now;
    history.save();
    return;
  }
  items.unshift({ url, title: title || url, ts: now });
  if (items.length > HISTORY_CAP) items.length = HISTORY_CAP;
  history.save();
}

function updateHistoryTitle(url, title) {
  if (!title) return;
  const hit = history.data.items.find((i) => i.url === url);
  if (hit && hit.title !== title) { hit.title = title; history.save(); }
}

/* Pasek adresu odpytuje searchHistory() przy kazdym wcisnietym klawiszu, wiec
   liczenie .toLowerCase() od nowa dla kazdego z (do 30 tysiecy) wpisow przy
   kazdej literce potrafilo byc wyczuwalne. Cache trzyma juz policzone,
   malutkie napisy pod adresem obiektu wpisu (WeakMap - znika sam, gdy wpis
   wypadnie z historii), a "title" w kluczu cache'a wystarcza za znacznik
   swiezosci: to jedyne pole, ktore potrafi sie zmienic pod tym samym wpisem. */
const lowerCache = new WeakMap();
function lowered(item) {
  const cached = lowerCache.get(item);
  if (cached && cached.title === item.title) return cached;
  const fresh = { title: item.title, urlLower: item.url.toLowerCase(), titleLower: (item.title || '').toLowerCase() };
  lowerCache.set(item, fresh);
  return fresh;
}

function searchHistory(query, limit = 300) {
  const q = (query || '').trim().toLowerCase();
  const out = [];
  for (const item of history.data.items) {
    if (!q) {
      out.push(item);
      if (out.length >= limit) break;
      continue;
    }
    const low = lowered(item);
    if (low.urlLower.includes(q) || low.titleLower.includes(q)) {
      out.push(item);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function clearHistory(sinceMs) {
  if (!sinceMs) history.data.items = [];
  else {
    const cut = Date.now() - sinceMs;
    history.data.items = history.data.items.filter((i) => i.ts < cut);
  }
  history.flush();
}

function removeHistory(urls) {
  const set = new Set(urls);
  history.data.items = history.data.items.filter((i) => !set.has(i.url));
  history.save();
}

/* ---------------------------------------------------------------- bookmarks */

function bookmarkList() { return bookmarks.data.items; }

/* Dwa niezalezne miejsca na zakladki, tak jak w Firefoksie: "bar" to pasek
   pod paskiem adresu, "menu" to lista pod przyciskiem zakladek (tam trafia
   gwiazdka i Ctrl+D). Ta sama strona moze byc w obu naraz i usuniecie jej z
   jednego miejsca nie rusza drugiego. "other" to stara nazwa z wczesniejszych
   wersji, liczona jako menu. Folder nalezy tam, gdzie jego folder nadrzedny. */
function miejsceZakladki(parent) {
  const items = bookmarks.data.items;
  let p = parent;
  for (let i = 0; i < 50 && p; i++) {
    if (p === 'bar') return 'bar';
    if (p === 'menu' || p === 'other') return 'menu';
    const nad = items.find((b) => b.id === p);
    if (!nad) break;
    p = nad.parent;
  }
  return 'bar';
}

function linkiW(gdzie) {
  return bookmarks.data.items.filter((b) => b.type === 'link' && miejsceZakladki(b.parent) === gdzie);
}

function isBookmarked(url, gdzie = 'menu') { return linkiW(gdzie).some((b) => b.url === url); }

function addBookmark({ title, url, parent = 'menu' }) {
  const gdzie = miejsceZakladki(parent);
  const existing = linkiW(gdzie).find((b) => b.url === url);
  if (existing) { existing.title = title || existing.title; bookmarks.save(); return existing; }
  const item = { id: String(bookmarks.data.nextId++), type: 'link', title: title || url, url, parent, ts: Date.now() };
  bookmarks.data.items.push(item);
  bookmarks.save();
  return item;
}

function addFolder(title, parent = 'bar') {
  const item = { id: String(bookmarks.data.nextId++), type: 'folder', title: title || 'Nowy folder', parent, ts: Date.now() };
  bookmarks.data.items.push(item);
  bookmarks.save();
  return item;
}

function addSeparator(parent = 'bar') {
  const item = { id: String(bookmarks.data.nextId++), type: 'separator', parent, ts: Date.now() };
  bookmarks.data.items.push(item);
  bookmarks.save();
  return item;
}

function updateBookmark(id, patch) {
  const item = bookmarks.data.items.find((b) => b.id === id);
  if (!item) return null;
  Object.assign(item, patch);
  bookmarks.save();
  return item;
}

function removeBookmark(id) {
  const drop = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of bookmarks.data.items) {
      if (b.parent && drop.has(b.parent) && !drop.has(b.id)) { drop.add(b.id); changed = true; }
    }
  }
  bookmarks.data.items = bookmarks.data.items.filter((b) => !drop.has(b.id));
  bookmarks.save();
}

function removeBookmarkByUrl(url, gdzie = 'menu') {
  const hit = linkiW(gdzie).find((b) => b.url === url);
  if (hit) removeBookmark(hit.id);
}

function moveBookmark(id, parent, beforeId) {
  const items = bookmarks.data.items;
  const idx = items.findIndex((b) => b.id === id);
  if (idx < 0) return;
  if (!parent) return;
  if (beforeId === id) return;
  /* Folder nie moze trafic do samego siebie ani do swojego podfolderu -
     przy przeciaganiu myszka latwo go upuscic na wlasne dziecko, a wtedy
     cala galaz odcinalaby sie od paska i menu i znikala z widoku. */
  for (let p = parent, i = 0; p && i < 50; i++) {
    if (p === id) return;
    const nad = items.find((b) => b.id === p);
    p = nad ? nad.parent : null;
  }
  const [item] = items.splice(idx, 1);
  item.parent = parent;
  const at = beforeId ? items.findIndex((b) => b.id === beforeId) : -1;
  if (at >= 0) items.splice(at, 0, item); else items.push(item);
  bookmarks.save();
}

/* ------------------------------------------------------------------- sites */

/* Ustawienia stron zmienione w oknie prywatnym (powiekszenie, bloker,
   usypianie, "przejdz mimo to" na http) trzymamy tylko w pamieci - okno
   prywatne nie zostawia nic na dysku. Dzialaja do zamkniecia ostatniego
   okna prywatnego (wyczyscPrywatneStrony z window.js). */
const prywatneStrony = { zoom: new Map(), adblockOff: new Set(), sleepExempt: new Set(), http: new Set() };
function wyczyscPrywatneStrony() {
  prywatneStrony.zoom.clear(); prywatneStrony.adblockOff.clear();
  prywatneStrony.sleepExempt.clear(); prywatneStrony.http.clear();
}

function adblockAllowed(hostname) {
  return !siteStore.data.adblockOff.includes(hostname) && !prywatneStrony.adblockOff.has(hostname);
}
function setAdblockForSite(hostname, enabled, prywatnie = false) {
  if (prywatnie) {
    if (enabled) prywatneStrony.adblockOff.delete(hostname); else prywatneStrony.adblockOff.add(hostname);
    return;
  }
  const list = siteStore.data.adblockOff;
  const i = list.indexOf(hostname);
  if (enabled && i >= 0) list.splice(i, 1);
  if (!enabled && i < 0) list.push(hostname);
  siteStore.save();
}
/* Strony recznie wylaczone z usypiania w tle (patrz tabMenu w shell.js,
   "Nie usypiaj tej strony") - np. web-owy komunikator, ktory ma dalej
   dostawac powiadomienia mimo ze karta stoi bezczynnie. UsypianieCheck()
   w window.js pomija takie hosty, ale reczne "Usnij karte teraz" i tak
   dziala - to reczna akcja uzytkownika, nie automat. */
function isSleepExempt(hostname) {
  return !!hostname && (siteStore.data.sleepExempt.includes(hostname) || prywatneStrony.sleepExempt.has(hostname));
}
function setSleepExempt(hostname, exempt, prywatnie = false) {
  if (!hostname) return;
  if (prywatnie) {
    if (exempt) prywatneStrony.sleepExempt.add(hostname); else prywatneStrony.sleepExempt.delete(hostname);
    return;
  }
  const list = siteStore.data.sleepExempt;
  const i = list.indexOf(hostname);
  if (!exempt && i >= 0) list.splice(i, 1);
  if (exempt && i < 0) list.push(hostname);
  siteStore.save();
}
function siteZoom(hostname) {
  return prywatneStrony.zoom.has(hostname) ? prywatneStrony.zoom.get(hostname) : siteStore.data.zoom[hostname];
}
function setSiteZoom(hostname, factor, prywatnie = false) {
  if (!hostname) return;
  if (prywatnie) { prywatneStrony.zoom.set(hostname, factor || 1); return; }
  if (!factor || Math.abs(factor - 1) < 0.001) delete siteStore.data.zoom[hostname];
  else siteStore.data.zoom[hostname] = factor;
  siteStore.save();
}
/* Strony http, ktorym uzytkownik raz kazal "przejdz mimo to" na ostrzezeniu
   o braku szyfrowania - dla nich nazuna://warning juz sie wiecej nie pokaze,
   tak jak ustalilismy (pytamy raz, nie za kazdym razem). Ostrzezenia o
   zlosliwych domenach tego NIE uzywaja - tam pytamy zawsze. */
function httpZaakceptowany(hostname) {
  return siteStore.data.httpZaakceptowane.includes(hostname) || prywatneStrony.http.has(hostname);
}
function zaakceptujHttp(hostname, prywatnie = false) {
  if (!hostname) return;
  if (prywatnie) { prywatneStrony.http.add(hostname); return; }
  const list = siteStore.data.httpZaakceptowane;
  if (!list.includes(hostname)) { list.push(hostname); siteStore.save(); }
}

function permissionFor(hostname, kind) {
  return (siteStore.data.permissions[hostname] || {})[kind];
}
function setPermission(hostname, kind, value) {
  const p = siteStore.data.permissions;
  p[hostname] = p[hostname] || {};
  p[hostname][kind] = value;
  siteStore.save();
}

/* --------------------------------------------------------- kafelki nowej karty */

/* Kafelki na nowej karcie to domyslnie najczesciej odwiedzane strony z historii.
   "skroty" to te dopiete recznie przez uzytkownika (na koncu listy wlasnych
   kafelkow, w kolejnosci dodawania). "skrotyUkryte" to hosty schowane przez
   usuniecie kafelka - nie maja wracac same z siebie, dopoki ktos ich znowu
   nie doda. */
function skrotyStan() {
  const s = siteStore.data;
  if (!Array.isArray(s.skroty)) s.skroty = [];
  if (!Array.isArray(s.skrotyUkryte)) s.skrotyUkryte = [];
  return { przypiete: s.skroty, ukryte: s.skrotyUkryte };
}

function dodajSkrot({ origin, host, label }) {
  const { przypiete, ukryte } = skrotyStan();
  const czystaEtykieta = String(label || '').trim().slice(0, 40);
  const i = przypiete.findIndex((s) => s.origin === origin);
  if (i >= 0) przypiete[i] = { origin, host, label: czystaEtykieta || przypiete[i].label || '' };
  else przypiete.push({ origin, host, label: czystaEtykieta });
  const hi = ukryte.indexOf(host);
  if (hi >= 0) ukryte.splice(hi, 1);
  siteStore.save();
  return skrotyStan();
}

function usunSkrot({ origin, host }) {
  const { przypiete, ukryte } = skrotyStan();
  const i = przypiete.findIndex((s) => s.origin === origin);
  if (i >= 0) przypiete.splice(i, 1);
  if (host && !ukryte.includes(host)) ukryte.push(host);
  siteStore.save();
  return skrotyStan();
}

module.exports = {
  init,
  get settings() { return settings; },
  get bookmarksStore() { return bookmarks; },
  get historyStore() { return history; },
  get downloadsStore() { return downloads; },
  get extensionsStore() { return extensionsStore; },
  get siteStore() { return siteStore; },
  addHistory, updateHistoryTitle, searchHistory, clearHistory, removeHistory,
  bookmarkList, isBookmarked, miejsceZakladki, addBookmark, addFolder, addSeparator, updateBookmark, removeBookmark, removeBookmarkByUrl, moveBookmark,
  adblockAllowed, setAdblockForSite, siteZoom, setSiteZoom, permissionFor, setPermission,
  isSleepExempt, setSleepExempt,
  httpZaakceptowany, zaakceptujHttp, wyczyscPrywatneStrony,
  skrotyStan, dodajSkrot, usunSkrot,
  DEFAULT_SETTINGS
};
