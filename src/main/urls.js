'use strict';
const { SEARCH_ENGINES } = require('./constants');
const data = require('./data');

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
/* Litera dysku ("C:\Users\...") tez pasuje do SCHEME_RE - jedna litera to
   przeciez poprawny prefiks schematu wedlug tej definicji. Bez wyjatku
   wklejona sciezka do pliku na Windows byla brana za adres z nieznanym
   protokolem "c" i ladowanie konczylo sie bledem zamiast otwarciem pliku. */
const WIN_PATH_RE = /^[a-z]:[\\/]/i;
/* "localhost:3000" albo "strona.pl:8080/x" tez pasuja do SCHEME_RE (przed
   dwukropkiem stoi cos, co wyglada jak nazwa schematu), wiec bez tego
   wyjatku byly brane za adres z protokolem "localhost:" i Nazuna probowala
   oddac je systemowi jak link do innej aplikacji. Nazwa hosta z samym
   numerem portu po dwukropku to zawsze zwykla strona. */
const HOST_PORT_RE = /^[a-z0-9.-]+:\d{1,5}([/?#]|$)/i;
const LOCALHOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i;
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/;
const DOMAIN_RE = /^[^\s/?#@]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i;
/* Koncowki plikow, ktore nie sa prawdziwymi domenami. Wprost, bo biblioteka
   tldts-experimental nie zna domen jednoczlonowych (dla .pl i .js zwraca to
   samo). Zadnej z tych koncowek nie ma na liscie IANA; .md, .py, .rs, .sh,
   .zip czy .mov sa tam, wiec nie moga tu trafic (point.md, docs.rs). */
const KONCOWKI_PLIKOW = new Set(('html htm xhtml shtml js mjs cjs jsx ts tsx vue svelte css scss sass less '
  + 'json xml yml yaml toml ini cfg conf log txt rtf csv tsv tmp bak lock markdown mdx pdf doc docx xls xlsx '
  + 'ppt pptx odt ods odp epub tex exe msi dll bat cmd sys lnk jpg jpeg png gif bmp webp svg ico tif tiff heic psd '
  + 'wav flac ogg aac wma opus avi mkv webm wmv flv rar tar gz tgz xz iso apk deb rpm dmg jar class '
  + 'kt php rb go cpp hpp cxx cs lua swift sql db sqlite bin dat ipynb pyc pyw ttf otf woff eot').split(' '));
/* .md, .py i .sh to prawdziwe domeny krajowe, wiec tylko typowe nazwy plikow. */
const NAZWA_PLIKU_RE = /^((readme|changelog|license|contributing|todo)\.md|(main|setup)\.py|install\.sh)$/i;
// Schematy, w ktorych spacja w tresci jest normalna (np. temat maila).
const SCHEMATY_ZE_SPACJA = new Set(['mailto:', 'tel:', 'sms:', 'magnet:', 'callto:']);

function engine() {
  const key = data.settings.get('searchEngine', 'google');
  return SEARCH_ENGINES[key] || SEARCH_ENGINES.google;
}

function searchUrl(query) {
  return engine().search.replace('%s', encodeURIComponent(query));
}

/* "node.js" czy "index.html" konczyly sie bledem DNS zamiast wyszukiwania. Port
   albo sciezka ("node.js/", "plik.txt:8080") to swiadomy adres, wiec zostaja. */
function toNazwaPliku(value) {
  const host = value.match(/^[^/?#]+/)[0];
  if (/:\d+$/.test(host) || value[host.length] === '/') return false;
  return NAZWA_PLIKU_RE.test(host) || KONCOWKI_PLIKOW.has(host.slice(host.lastIndexOf('.') + 1).toLowerCase());
}

function looksLikeUrl(input) {
  const value = input.trim();
  if (!value || /\s/.test(value)) return false;
  if (LOCALHOST_RE.test(value) || IP_RE.test(value)) return true;
  return DOMAIN_RE.test(value) && !toNazwaPliku(value);
}

/** Zamienia to, co wpisal uzytkownik, na cos, co da sie wczytac. */
function resolve(input) {
  const value = String(input || '').trim();
  if (!value) return null;
  if (/^(nazuna|about|chrome|file|devtools|chrome-extension|view-source):/i.test(value)) return value;
  if (WIN_PATH_RE.test(value)) return `file:///${encodeURI(value.replace(/\\/g, '/'))}`;
  if (HOST_PORT_RE.test(value) && !/\s/.test(value)) {
    const lokalny = LOCALHOST_RE.test(value) || IP_RE.test(value);
    return `${lokalny ? 'http' : 'https'}://${value}`;
  }
  if (SCHEME_RE.test(value)) {
    if (/^(javascript|data):/i.test(value)) return searchUrl(value);
    /* Zwykly tekst ze spacja i dwukropkiem ("re: spotkanie", "python: listy")
       tez pasuje do SCHEME_RE - byl brany za adres z protokolem "re:" i
       zamiast wyszukiwania pokazywalo sie okno "inna aplikacja" albo blad.
       Ze spacja przepuszczamy tylko znane schematy z tresca (mailto: z
       tematem itp.) i adresy z "//", ktore naprawde sie parsuja. */
    if (/\s/.test(value)) {
      const schemat = value.slice(0, value.indexOf(':') + 1).toLowerCase();
      const reszta = value.slice(schemat.length);
      if (SCHEMATY_ZE_SPACJA.has(schemat)) return value;
      if (!reszta.startsWith('//')) return searchUrl(value);
      try { new URL(value); } catch (_) { return searchUrl(value); }
    }
    return value;
  }
  // Serwer na wlasnym komputerze albo router pod adresem IP prawie nigdy nie
  // ma certyfikatu, wiec https:// konczylo sie tam bledem polaczenia.
  if (looksLikeUrl(value)) return `${LOCALHOST_RE.test(value) || IP_RE.test(value) ? 'http' : 'https'}://${value}`;
  return searchUrl(value);
}

function prettyHost(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'nazuna:') return `nazuna://${u.hostname}`;
    return u.hostname.replace(/^www\./, '');
  } catch (_) { return url; }
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (_) { return ''; }
}

/* Zanim cokolwiek oddamy systemowi przez shell.openExternal (otwiera domyslna
   aplikacje dla danego protokolu), sprawdzamy schemat. Bez tego dowolny kod,
   ktory trafi do tej sciezki, moglby probowac odpalic dowolny zarejestrowany
   w Windows handler protokolu (znany wektor w innych aplikacjach Electron). */
const ZEWNETRZNE_SCHEMATY = new Set(['http:', 'https:', 'mailto:']);
function bezpieczneZewnetrzne(url) {
  try { return ZEWNETRZNE_SCHEMATY.has(new URL(url).protocol); } catch (_) { return false; }
}

/* Schematy, ktore Nazuna umie wyswietlic sama, jako zwykla strone/karte.
   Wszystko inne - mailto:, tel:, ale tez wlasne protokoly innych aplikacji,
   takie jak te, ktorymi strony logowania (SSO) wracaja do aplikacji
   desktopowej po zalogowaniu - trzeba oddac systemowi (patrz
   handleExternalProtocol w window.js). Chrome i Firefox robia to same z
   automatu; w Electronie main-frame nawigacja na nieznany protokol po
   prostu nic nie robi, chyba ze ktos jawnie to obsluzy. */
const PRZEGLADALNE_SCHEMATY = new Set([
  'http:', 'https:', 'nazuna:', 'file:', 'about:', 'data:', 'blob:',
  'filesystem:', 'devtools:', 'chrome-extension:', 'view-source:', 'javascript:'
]);
function zewnetrznyProtokol(url) {
  try { return !PRZEGLADALNE_SCHEMATY.has(new URL(url).protocol); } catch (_) { return false; }
}

/* Adres, ktory zwykla strona WWW chce otworzyc w nowej karcie/oknie
   (window.open, target=_blank, menu "Otworz w nowej karcie"). Straz
   will-navigate tego nie widzi, a karta z nazuna:// dostaje most do
   przegladarki - wiec strony wewnetrzne, pliki lokalne i adresy Chromium
   moze otwierac tylko inna strona nazuna://. */
const ZAKAZANE_ZE_STRONY = /^\s*(nazuna|file|chrome|chrome-extension|devtools|view-source|javascript):/i;
function dozwoloneZeStrony(cel, zrodlo) {
  cel = String(cel || ''); zrodlo = String(zrodlo || '');
  if (!ZAKAZANE_ZE_STRONY.test(cel)) return true;
  if (/^nazuna:/i.test(zrodlo)) return true;
  // Rozszerzenie otwierajace wlasne strony (np. opcje) z karty rozszerzenia.
  return /^chrome-extension:/i.test(zrodlo) && /^\s*chrome-extension:/i.test(cel);
}

module.exports = { dozwoloneZeStrony, resolve, searchUrl, looksLikeUrl, prettyHost, hostOf, engine, bezpieczneZewnetrzne, zewnetrznyProtokol };
