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

function engine() {
  const key = data.settings.get('searchEngine', 'google');
  return SEARCH_ENGINES[key] || SEARCH_ENGINES.google;
}

function searchUrl(query) {
  return engine().search.replace('%s', encodeURIComponent(query));
}

function looksLikeUrl(input) {
  const value = input.trim();
  if (!value || /\s/.test(value)) return false;
  if (LOCALHOST_RE.test(value) || IP_RE.test(value)) return true;
  return DOMAIN_RE.test(value);
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

module.exports = { resolve, searchUrl, looksLikeUrl, prettyHost, hostOf, engine, bezpieczneZewnetrzne, zewnetrznyProtokol };
