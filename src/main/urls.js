'use strict';
const { SEARCH_ENGINES } = require('./constants');
const data = require('./data');

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
/* Litera dysku ("C:\Users\...") tez pasuje do SCHEME_RE - jedna litera to
   przeciez poprawny prefiks schematu wedlug tej definicji. Bez wyjatku
   wklejona sciezka do pliku na Windows byla brana za adres z nieznanym
   protokolem "c" i ladowanie konczylo sie bledem zamiast otwarciem pliku. */
const WIN_PATH_RE = /^[a-z]:[\\/]/i;
const LOCALHOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;
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
  if (SCHEME_RE.test(value)) {
    if (/^(javascript|data):/i.test(value)) return searchUrl(value);
    return value;
  }
  if (looksLikeUrl(value)) return `https://${value}`;
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

module.exports = { resolve, searchUrl, looksLikeUrl, prettyHost, hostOf, engine };
