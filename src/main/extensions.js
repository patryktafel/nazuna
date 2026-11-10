'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, net } = require('electron');
const AdmZip = require('adm-zip');
const crx = require('./crx');
const data = require('./data');

const ID_RE = /^[a-p]{32}$/;

function extensionsDir() {
  return path.join(app.getPath('userData'), 'Extensions');
}

function parseIdOrUrl(input) {
  const value = String(input || '').trim();
  if (ID_RE.test(value)) return value;
  const m = value.match(/([a-p]{32})/);
  return m ? m[1] : null;
}

function downloadUrl(id, platform = process.platform, architecture = process.arch) {
  const version = process.versions.chrome || '120.0.0.0';
  const arch = ({ arm64: 'arm64', arm: 'arm', ia32: 'x86', x64: 'x86-64' })[architecture] || architecture;
  const params = new URLSearchParams({
    response: 'redirect',
    os: ({ darwin: 'mac', win32: 'win', linux: 'linux' })[platform] || platform,
    arch,
    os_arch: arch === 'x86-64' ? 'x86_64' : arch,
    nacl_arch: arch,
    prod: 'chromiumcrx',
    prodchannel: 'unknown',
    prodversion: version,
    acceptformat: 'crx2,crx3',
    x: `id=${id}&uc`
  });
  return `https://clients2.google.com/service/update2/crx?${params.toString()}`;
}

async function fetchBuffer(url) {
  const res = await net.fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`serwer odpowiedział ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function rmrf(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) {}
}

/** Niektore paczki ze sklepu maja smieci, ktorych Chromium nie wczyta rozpakowanych. */
function tidyUnpacked(dir) {
  rmrf(path.join(dir, '_metadata'));
  const manifestPath = path.join(dir, 'manifest.json');
  let raw = fs.readFileSync(manifestPath, 'utf8');
  raw = raw.replace(/^﻿/, '');
  const manifest = JSON.parse(raw);
  return { manifest, manifestPath };
}

/* Uprawnienia z manifestu opisane po ludzku (N41). Uzytkownik ma widziec,
   na co sie zgadza, zanim i po tym, jak rozszerzenie trafi do Nazuny. Te
   z listy CICHE nie daja dostepu do danych - nie pokazujemy ich i nie
   blokuja automatycznej aktualizacji, gdy nowa wersja je doda. */
const OPISY_UPRAWNIEN = {
  tabs: 'widzi adresy i tytuły otwartych kart',
  cookies: 'odczytuje i zmienia ciasteczka',
  history: 'czyta i zmienia historię przeglądania',
  bookmarks: 'czyta i zmienia zakładki',
  topSites: 'widzi najczęściej odwiedzane strony',
  downloads: 'zarządza pobranymi plikami',
  webRequest: 'podgląda ruch sieciowy',
  webRequestBlocking: 'blokuje i zmienia ruch sieciowy',
  declarativeNetRequest: 'blokuje lub zmienia żądania sieciowe',
  declarativeNetRequestWithHostAccess: 'blokuje lub zmienia żądania sieciowe',
  declarativeNetRequestFeedback: 'widzi, które żądania sieciowe zablokowało',
  webNavigation: 'widzi, jakie strony otwierasz',
  scripting: 'wstrzykuje własne skrypty do stron',
  clipboardRead: 'czyta schowek',
  clipboardWrite: 'zapisuje do schowka',
  nativeMessaging: 'rozmawia z programami zainstalowanymi na komputerze',
  management: 'zarządza innymi rozszerzeniami',
  proxy: 'zmienia ustawienia serwera proxy',
  privacy: 'zmienia ustawienia prywatności',
  contentSettings: 'zmienia ustawienia stron (np. JavaScript, ciasteczka)',
  debugger: 'ma dostęp do debugera stron',
  geolocation: 'zna Twoją lokalizację',
  desktopCapture: 'może nagrywać ekran',
  tabCapture: 'może nagrywać zawartość kart',
  pageCapture: 'może zapisywać całe strony',
  sessions: 'widzi ostatnio zamknięte karty',
  identity: 'może logować się do kont w Twoim imieniu',
  notifications: 'pokazuje powiadomienia'
};
const CICHE = new Set(['storage', 'unlimitedStorage', 'alarms', 'contextMenus', 'activeTab', 'offscreen',
  'sidePanel', 'idle', 'power', 'fontSettings', 'i18n', 'runtime', 'tts', 'ttsEngine', 'dns', 'search',
  'favicon', 'background', 'gcm', 'commands', 'action', 'browsingData', 'system.cpu', 'system.memory',
  'system.display', 'system.storage', 'userScripts', 'readingList', 'tabGroups', 'theme']);

function wzorStron(p) { return typeof p === 'string' && (p === '<all_urls>' || p.includes('://')); }
function wszystkieStrony(p) { return p === '<all_urls>' || /^(\*|https?):\/\/\*\//.test(p); }

function uprawnienia(manifest) {
  const m = manifest || {};
  const perms = Array.isArray(m.permissions) ? m.permissions.filter((p) => typeof p === 'string') : [];
  const wzory = perms.filter(wzorStron)
    .concat(Array.isArray(m.host_permissions) ? m.host_permissions.filter(wzorStron) : []);
  for (const cs of Array.isArray(m.content_scripts) ? m.content_scripts : []) {
    if (cs && Array.isArray(cs.matches)) wzory.push(...cs.matches.filter(wzorStron));
  }
  const wszystkie = wzory.some(wszystkieStrony);
  const strony = [...new Set(wzory.map((w) => {
    const h = w.replace(/^[^:]*:\/\//, '').split('/')[0];
    return h.replace(/^\*\./, '');
  }).filter(Boolean))].sort();
  const nazwy = [...new Set(perms.filter((p) => !wzorStron(p) && !CICHE.has(p)))].sort();
  const opisy = [...new Set(nazwy.map((p) => OPISY_UPRAWNIEN[p] || p))];
  // Klucze do porownania wersji przy aktualizacji: nazwy uprawnien i strony.
  const klucze = nazwy.concat(wszystkie ? ['<wszystkie strony>'] : strony.map((s) => `host:${s}`));
  return { wszystkieStrony: wszystkie, strony: wszystkie ? [] : strony, opisy, klucze };
}

/** Linie tekstu do okna potwierdzenia albo listy na stronie rozszerzen. */
function tekstUprawnien(u) {
  const linie = [];
  if (u.wszystkieStrony) linie.push('ma dostęp do wszystkich stron, które otwierasz');
  else if (u.strony.length) {
    const pokaz = u.strony.slice(0, 5).join(', ');
    linie.push(`ma dostęp do stron: ${pokaz}${u.strony.length > 5 ? ` i ${u.strony.length - 5} innych` : ''}`);
  }
  return linie.concat(u.opisy);
}

/** Uprawnienia, ktorych nowa wersja chce, a stara nie miala. */
function noweUprawnienia(stare, nowe) {
  if (!stare) return nowe.klucze;
  const s = new Set(stare.klucze);
  return nowe.klucze.filter((k) => !s.has(k) && !(stare.wszystkieStrony && k.startsWith('host:')));
}

function manifestZZipa(zip) {
  const entry = zip.getEntry('manifest.json');
  if (!entry) throw new Error('W pobranej paczce brakuje pliku manifest.json. Instalacja przerwana.');
  return JSON.parse(entry.getData().toString('utf8').replace(/^﻿/, ''));
}

/* Nazwa do okna potwierdzenia, zanim cokolwiek trafi na dysk. */
function nazwaZZipa(zip, manifest) {
  const raw = manifest.name || '';
  if (!raw.startsWith('__MSG_')) return raw;
  const key = raw.slice(6, -2);
  const locales = [app.getLocale().replace('-', '_'), manifest.default_locale, 'en', 'en_US'].filter(Boolean);
  for (const loc of locales) {
    const e = zip.getEntry(`_locales/${loc}/messages.json`);
    if (!e) continue;
    try {
      const b = JSON.parse(e.getData().toString('utf8').replace(/^﻿/, ''));
      const hit = b[key] || Object.entries(b).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
      if (hit && hit.message) return hit.message;
    } catch (_) {}
  }
  return key;
}

/** Pobiera CRX ze sklepu i sprawdza podpis oraz zgodnosc identyfikatora. */
async function pobierzPaczke(id) {
  const buffer = await fetchBuffer(downloadUrl(id));
  const parsed = crx.parse(buffer);
  if (!parsed.verified) {
    throw new Error(`Podpis pobranego rozszerzenia jest niepoprawny (${parsed.reason || 'brak podpisu'}). Instalacja przerwana.`);
  }
  if (parsed.id && parsed.id !== id) {
    throw new Error('Pobrany plik należy do innego rozszerzenia niż wskazany identyfikator. Instalacja przerwana.');
  }
  const zip = new AdmZip(Buffer.from(parsed.zip));
  return { parsed, zip, manifest: manifestZZipa(zip) };
}

function rozpakuj(paczka, target) {
  rmrf(target);
  fs.mkdirSync(target, { recursive: true });
  paczka.zip.extractAllTo(target, true);
  const { manifest, manifestPath } = tidyUnpacked(target);
  if (paczka.parsed.publicKey) {
    manifest.key = Buffer.from(paczka.parsed.publicKey).toString('base64');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
  return manifest;
}

function opisZManifestu(dir, manifest) {
  return {
    name: manifest.name && manifest.name.startsWith('__MSG_') ? localisedName(dir, manifest) : manifest.name,
    version: manifest.version,
    description: manifest.description && manifest.description.startsWith('__MSG_')
      ? localisedValue(dir, manifest, manifest.description) : (manifest.description || ''),
    manifestVersion: manifest.manifest_version || 2
  };
}

/* opts.potwierdz(info) - opcjonalne okno zgody wolane PO sprawdzeniu podpisu,
   a PRZED zapisem na dysk. Zwraca false, gdy uzytkownik odmowi. */
async function install(input, opts = {}) {
  const id = parseIdOrUrl(input);
  if (!id) throw new Error('Nie rozpoznaje tego adresu. Wklej link ze sklepu Chrome albo 32-znakowy identyfikator rozszerzenia.');

  const paczka = await pobierzPaczke(id);
  if (typeof opts.potwierdz === 'function') {
    const u = uprawnienia(paczka.manifest);
    const zgoda = await opts.potwierdz({
      id,
      nazwa: nazwaZZipa(paczka.zip, paczka.manifest) || id,
      wersja: paczka.manifest.version || '',
      uprawnienia: u,
      linie: tekstUprawnien(u)
    });
    if (!zgoda) throw new Error('Instalacja anulowana.');
  }
  const target = path.join(extensionsDir(), id);
  const manifest = rozpakuj(paczka, target);

  const record = Object.assign({ id, dirId: id }, opisZManifestu(target, manifest), {
    enabled: true,
    installedAt: Date.now(),
    path: target,
    // Reczna instalacja zastepuje wszystko, co znalazlo sprawdzanie aktualizacji.
    oczekujaca: null,
    aktualizacjaWymagaZgody: null,
    brakWSklepie: null
  });
  rmrf(path.join(extensionsDir(), '_nowe', id));

  const list = data.extensionsStore.data.installed;
  const idx = list.findIndex((e) => e.id === id);
  if (idx >= 0) list[idx] = Object.assign(list[idx], record);
  else list.push(record);
  data.extensionsStore.flush();
  return record;
}

/* ------------------------------------------------ aktualizacje ze sklepu (N41)
   Chrome sam co kilka godzin pyta sklep o nowe wersje. Tu robimy to samo, ale
   nie czesciej niz raz na dobe. Nowa wersja jest pobierana, sprawdzana tym samym
   podpisem co przy instalacji i rozpakowywana obok (_nowe/<id>). Podmiana na dysku
   dzieje sie dopiero w zastosujAktualizacje(), wolanym przed wczytaniem rozszerzen
   - inaczej dzialajace rozszerzenie mialoby pod soba pliki z dwoch wersji.
   Gdy nowa wersja chce wiecej uprawnien, niczego nie podmieniamy, tylko zaznaczamy
   to na stronie rozszerzen (jak Chrome, ktory wtedy prosi o zgode). */
const DOBA = 24 * 60 * 60 * 1000;
let trwaSprawdzanie = null;

function updateCheckUrl(id, version) {
  const u = new URL(downloadUrl(id));
  u.searchParams.set('response', 'updatecheck');
  u.searchParams.set('x', `id=${id}&v=${version || '0'}&uc`);
  return u.toString();
}

function porownajWersje(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function atrybut(tag, nazwa) {
  const m = tag && tag.match(new RegExp(`\\s${nazwa}="([^"]*)"`));
  return m ? m[1] : null;
}

/** Odpowiedz serwera: { app: status aplikacji, status: status updatecheck, version }. */
function czytajOdpowiedz(xml) {
  const appTag = (xml.match(/<app\b[^>]*>/) || [])[0];
  const ucTag = (xml.match(/<updatecheck\b[^>]*>/) || [])[0];
  return { app: atrybut(appTag, 'status'), status: atrybut(ucTag, 'status'), version: atrybut(ucTag, 'version') };
}

async function sprawdzJedno(rec) {
  const res = await net.fetch(updateCheckUrl(rec.id, rec.version));
  if (!res.ok) throw new Error(`serwer odpowiedział ${res.status}`);
  const odp = czytajOdpowiedz(await res.text());
  // Sklep nie zna juz tego identyfikatora - zwykle znaczy, ze rozszerzenie
  // zostalo usuniete (takze za zlosliwosc). Nie wylaczamy go sami, ale strona
  // rozszerzen wyraznie to pokazuje.
  if (odp.app === 'error-unknownApplication') { rec.brakWSklepie = Date.now(); return; }
  if (odp.app !== 'ok') return;                     // chwilowy blad serwera - sprobujemy jutro
  rec.brakWSklepie = null;
  if (odp.status !== 'ok' || !odp.version || porownajWersje(odp.version, rec.version) <= 0) return;
  if (rec.oczekujaca && rec.oczekujaca.version === odp.version) return;
  // Ta sama wersja juz czeka na zgode - nie pobieramy jej codziennie od nowa.
  if (rec.aktualizacjaWymagaZgody && rec.aktualizacjaWymagaZgody.version === odp.version) return;

  const paczka = await pobierzPaczke(rec.id);
  const nowaWersja = paczka.manifest.version;
  if (porownajWersje(nowaWersja, rec.version) <= 0) return;
  const dodane = noweUprawnienia(uprawnienia(readManifest(rec.path)), uprawnienia(paczka.manifest));
  if (dodane.length) {
    const u = uprawnienia(paczka.manifest);
    rec.aktualizacjaWymagaZgody = { version: nowaWersja, linie: tekstUprawnien(u) };
    rec.oczekujaca = null;
    rmrf(path.join(extensionsDir(), '_nowe', rec.id));
    return;
  }
  const staging = path.join(extensionsDir(), '_nowe', rec.id);
  rozpakuj(paczka, staging);
  rec.oczekujaca = { version: nowaWersja };
  rec.aktualizacjaWymagaZgody = null;
}

/** Sprawdza nowe wersje rozszerzen ze sklepu (najwyzej raz na dobe, chyba ze wymus). */
function sprawdzAktualizacje({ wymus = false } = {}) {
  if (trwaSprawdzanie) return trwaSprawdzanie;
  trwaSprawdzanie = (async () => {
    const store = data.extensionsStore.data;
    if (!wymus && store.ostatnieSprawdzenie && Date.now() - store.ostatnieSprawdzenie < DOBA) return;
    // Tylko paczki ze sklepu, ktore sami rozpakowalismy. Wczytane z folderu
    // nie maja w sklepie odpowiednika i nie wysylamy o nich nic do Google.
    const zeSklepu = records().filter((r) => !r.unpacked && ID_RE.test(r.id) && wNaszymFolderze(r.path));
    if (!zeSklepu.length) return;
    let udane = 0;
    for (const rec of zeSklepu) {
      try { await sprawdzJedno(rec); udane++; }
      catch (err) { console.warn(`[ext] aktualizacja ${rec.name || rec.id}: ${err.message}`); }
    }
    // Bez sieci (wszystko padlo) nie odkladamy sprawdzania o cala dobe.
    if (udane) store.ostatnieSprawdzenie = Date.now();
    data.extensionsStore.flush();
  })();
  return trwaSprawdzanie.finally(() => { trwaSprawdzanie = null; });
}

/* Podmienia pobrane wersje. Wolac tylko wtedy, gdy rozszerzenia nie sa wczytane
   (na starcie albo w reloadExtensions po removeExtension). Najpierw stary folder
   odsuwamy w bok, dopiero potem wstawiamy nowy - gdy cos jest zablokowane przez
   system, zostaje stara, dzialajaca wersja, a nie polowa plikow. */
function zastosujAktualizacje() {
  const stare = path.join(extensionsDir(), '_stare');
  rmrf(stare);
  let zmiany = false;
  for (const rec of data.extensionsStore.data.installed) {
    if (!rec.oczekujaca || rec.unpacked || !wNaszymFolderze(rec.path)) continue;
    const staging = path.join(extensionsDir(), '_nowe', rec.id);
    const manifest = readManifest(staging);
    if (!manifest || porownajWersje(manifest.version, rec.version) <= 0) {
      rmrf(staging); rec.oczekujaca = null; zmiany = true; continue;
    }
    const kopia = path.join(stare, `${rec.id}-${Date.now()}`);
    try {
      fs.mkdirSync(stare, { recursive: true });
      // Brak starego folderu (np. przerwana podmiana) - po prostu wstawiamy nowy.
      if (fs.existsSync(rec.path)) fs.renameSync(rec.path, kopia);
    } catch (err) {
      console.warn(`[ext] nie mogę podmienić ${rec.name || rec.id}: ${err.message}`);
      continue;                                       // sprobujemy przy nastepnym starcie
    }
    try {
      fs.renameSync(staging, rec.path);
    } catch (err) {
      console.warn(`[ext] nie mogę wstawić nowej wersji ${rec.name || rec.id}: ${err.message}`);
      try { fs.renameSync(kopia, rec.path); } catch (_) {}
      continue;
    }
    Object.assign(rec, opisZManifestu(rec.path, manifest), { installedAt: Date.now(), oczekujaca: null });
    describeCache.delete(rec.id);
    zmiany = true;
  }
  rmrf(stare);
  if (zmiany) data.extensionsStore.flush();
  return zmiany;
}

function messageBundle(dir, manifest) {
  const locales = [app.getLocale().replace('-', '_'), manifest.default_locale, 'en', 'en_US'].filter(Boolean);
  for (const loc of locales) {
    const file = path.join(dir, '_locales', loc, 'messages.json');
    if (fs.existsSync(file)) {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
    }
  }
  return null;
}

function localisedValue(dir, manifest, raw) {
  const key = raw.slice(6, -2);
  const bundle = messageBundle(dir, manifest);
  if (bundle && bundle[key] && bundle[key].message) return bundle[key].message;
  return key;
}

function localisedName(dir, manifest) {
  return localisedValue(dir, manifest, manifest.name);
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
  } catch (_) { return null; }
}

function iconDataUrl(dir, manifest) {
  if (!manifest) return null;
  const action = manifest.action || manifest.browser_action || manifest.page_action || {};
  const sources = [];
  const push = (icons) => {
    if (!icons) return;
    if (typeof icons === 'string') { sources.push([32, icons]); return; }
    for (const [size, file] of Object.entries(icons)) sources.push([parseInt(size, 10) || 0, file]);
  };
  push(action.default_icon);
  push(manifest.icons);
  if (!sources.length) return null;
  sources.sort((a, b) => {
    const score = (s) => (s >= 32 ? s : 1000 - s);
    return score(a[0]) - score(b[0]);
  });
  for (const [, rel] of sources) {
    const file = path.join(dir, rel.replace(/^\/+/, ''));
    if (!fs.existsSync(file)) continue;
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    try {
      return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
    } catch (_) {}
  }
  return null;
}

/* describe() czyta manifest.json i ikone z dysku - dla tego samego
   zainstalowanego rozszerzenia wynik sie nie zmienia, a state() (i przez to
   describe()) potrafi wywolywac sie dziesiatki razy na minute przy zwyklym
   przegladaniu (kazda zmiana tytulu/favicony karty, itp). Cache trzyma wiec
   policzony wynik dopoki rozszerzenie nie zostanie zainstalowane/zaktualizowane
   ponownie (klucz cache zmienia sie razem ze sciezka i wersja) - jedyne, co
   naprawde zmienia sie z sesji na sesje (enabled), doklejamy na zywo z rekordu. */
const describeCache = new Map();

function describe(record) {
  const cacheKey = `${record.path}|${record.version || ''}|${record.installedAt || ''}`;
  const cached = describeCache.get(record.id);
  if (cached && cached.key === cacheKey) return { ...cached.data, ...stanNaZywo(record) };
  const manifest = readManifest(record.path);
  const upr = uprawnienia(manifest);
  const action = manifest ? (manifest.action || manifest.browser_action || manifest.page_action || null) : null;
  const stale = {
    id: record.id,
    runtimeId: record.runtimeId || record.id,
    name: record.name || record.id,
    version: record.version,
    description: record.description,
    manifestVersion: record.manifestVersion,
    icon: iconDataUrl(record.path, manifest),
    hasPopup: !!(action && action.default_popup),
    popup: action && action.default_popup ? action.default_popup : null,
    title: (action && (action.default_title || record.name)) || record.name,
    optionsPage: manifest ? (manifest.options_page || (manifest.options_ui && manifest.options_ui.page) || null) : null,
    storeUrl: `https://chromewebstore.google.com/detail/${record.id}`,
    // N41: strona rozszerzen pokazuje, do czego rozszerzenie ma dostep.
    uprawnienia: tekstUprawnien(upr),
    wszystkieStrony: upr.wszystkieStrony
  };
  describeCache.set(record.id, { key: cacheKey, data: stale });
  return { ...stale, ...stanNaZywo(record) };
}

/* Pola zmieniajace sie bez ponownej instalacji - doklejane zawsze z rekordu. */
function stanNaZywo(record) {
  return {
    enabled: record.enabled !== false,
    unpacked: !!record.unpacked,
    oczekujacaWersja: record.oczekujaca ? record.oczekujaca.version : null,
    wymagaZgody: record.aktualizacjaWymagaZgody || null,
    brakWSklepie: !!record.brakWSklepie
  };
}

function list() {
  return data.extensionsStore.data.installed
    .filter((e) => fs.existsSync(e.path))
    .map(describe);
}

function records() { return data.extensionsStore.data.installed.filter((e) => fs.existsSync(e.path)); }

function setEnabled(id, enabled) {
  const rec = data.extensionsStore.data.installed.find((e) => e.id === id);
  if (rec) { rec.enabled = !!enabled; data.extensionsStore.flush(); }
  return rec;
}

/* Kasujemy z dysku tylko wlasne kopie z folderu Extensions. Rozszerzenie
   wczytane "z folderu" lezy u uzytkownika (np. jego projekt na Pulpicie) -
   takie tylko odpinamy, pliki zostaja. Wczesniej rmrf szedl po kazdej
   sciezce i potrafil skasowac cudzy folder bez Kosza. */
function wNaszymFolderze(p) {
  const rel = path.relative(extensionsDir(), path.resolve(p));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function remove(id) {
  const rec = data.extensionsStore.data.installed.find((e) => e.id === id);
  if (rec && !rec.unpacked && wNaszymFolderze(rec.path)) rmrf(rec.path);
  if (ID_RE.test(String(id))) rmrf(path.join(extensionsDir(), '_nowe', id));   // pobrana, niewstawiona aktualizacja
  data.extensionsStore.data.installed = data.extensionsStore.data.installed.filter((e) => e.id !== id);
  describeCache.delete(id);
  data.extensionsStore.flush();
}

/* Chromium wymaga identyfikatora zlozonego z 32 liter a-p. Dla rozpakowanych
   rozszerzen sami musimy taki wymyslic - i musi byc taki sam przy kazdym
   ponownym wczytaniu tego samego folderu. Wczesniej brano tu nazwe folderu i
   zamieniano kazda spoza a-p na "a", co dawalo bardzo krotki, latwy do
   zderzenia alfabet: "moj-plugin-1" i "moj-plugin-2" wychodzily identycznie.
   Zderzenie identyfikatorow jest powazne - usuniecie jednego rozszerzenia
   kasowalo wtedy oba, bo dzielily to samo id. Haszujemy wiec cala sciezke i
   przekladamy szesnastkowe cyfry 1:1 na litery a-p, co realnie eliminuje
   zderzenia. */
function idFromPath(dir) {
  const hex = crypto.createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 32);
  return hex.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

async function installFromFolder(dir) {
  const manifest = readManifest(dir);
  if (!manifest) throw new Error('W tym folderze nie ma pliku manifest.json');
  const id = idFromPath(dir);
  const record = {
    id,
    name: manifest.name && manifest.name.startsWith('__MSG_') ? localisedName(dir, manifest) : manifest.name,
    version: manifest.version,
    description: manifest.description || '',
    manifestVersion: manifest.manifest_version || 2,
    enabled: true,
    installedAt: Date.now(),
    path: dir,
    unpacked: true
  };
  const list = data.extensionsStore.data.installed;
  const idx = list.findIndex((e) => e.path === dir);
  if (idx >= 0) list[idx] = Object.assign(list[idx], record); else list.push(record);
  data.extensionsStore.flush();
  return record;
}

module.exports = {
  install, installFromFolder, list, records, describe, setEnabled, remove,
  extensionsDir, parseIdOrUrl, downloadUrl, readManifest, iconDataUrl,
  uprawnienia, tekstUprawnien, sprawdzAktualizacje, zastosujAktualizacje
};
